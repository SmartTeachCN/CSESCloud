/**
 * 子用户管理 API（学校管理员侧）
 *
 *  GET  action=list                                当前学校所有子用户（含 permissions 与 bindings 聚合）
 *  GET  action=school-bindings                     当前学校所有子用户的联盟绑定关系
 *  POST action=create                              新增子用户
 *  POST action=update                              更新子用户（含 permissions）
 *  POST action=reset-password                      重置密码
 *  POST action=delete                             删除子用户
 *  POST action=school-unbind                       学校管理员解绑某子用户的联盟绑定
 */
const bcrypt = require('bcryptjs');
const { nowStr } = require('../lib/response');

/** PHP json_decode(s, true) 等价：失败返回 null */
function jsonDecodeSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  if (!schoolId) Response.error('当前未选择学校', 403, 403);

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  // 列出当前学校的子用户，附带权限 JSON 与已绑定的联盟账户
  if (method === 'GET' && action === 'list') {
    const keyword = String(query.keyword ?? '').trim();
    let sql = `SELECT id, school_id, username, display_name, role, email, phone, status, permissions, created_at
            FROM users WHERE school_id = ?`;
    const params = [schoolId];
    if (keyword !== '') {
      sql += " AND (username LIKE ? OR display_name LIKE ? OR email LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    sql += " ORDER BY id ASC";
    const rows = DB.all(sql, params);
    // 解析 permissions JSON
    for (const r of rows) {
      r.permissions = r.permissions ? jsonDecodeSafe(r.permissions) : null;
    }
    // 附加每个子用户的联盟绑定列表
    const bindings = Auth.listSchoolBindings(schoolId);
    const bindingMap = {};
    for (const bd of bindings) {
      (bindingMap[parseInt(bd.sub_user_id, 10)] ??= []).push({
        binding_id: parseInt(bd.id, 10) || 0,
        alliance_username: bd.alliance_username,
        alias: bd.alias,
        permissions: bd.permissions ? jsonDecodeSafe(bd.permissions) : null,
        created_at: bd.created_at,
      });
    }
    for (const r of rows) {
      r.bindings = bindingMap[parseInt(r.id, 10)] ?? [];
    }
    Response.success(rows);
  }

  // 列出当前学校所有子用户的联盟绑定（学校管理员视角）
  if (method === 'GET' && action === 'school-bindings') {
    const rows = Auth.listSchoolBindings(schoolId);
    for (const bd of rows) {
      bd.permissions = bd.permissions ? jsonDecodeSafe(bd.permissions) : null;
    }
    Response.success(rows);
  }

  if (method === 'POST' && action === 'create') {
    const username = String(b.username ?? '').trim();
    const displayName = String(b.display_name ?? '').trim();
    const password = b.password ?? '';
    const role = b.role ?? 'teacher';
    const email = String(b.email ?? '').trim();
    const phone = String(b.phone ?? '').trim();
    const permissions = b.permissions ?? null;
    if (Helpers.empty(username) || Helpers.empty(displayName) || Helpers.empty(password)) Response.error('请填写用户名、姓名和密码');
    if (Buffer.byteLength(String(password), 'utf8') < 6) Response.error('密码至少 6 位');
    const exists = DB.one("SELECT id FROM users WHERE school_id = ? AND username = ?", [schoolId, username]);
    if (exists) Response.error('用户名已存在');
    const id = DB.insert('users', {
      school_id: schoolId, username: username,
      password_hash: bcrypt.hashSync(password, 10),
      display_name: displayName, role: role,
      email: email, phone: phone,
      permissions: permissions !== null && permissions !== undefined ? JSON.stringify(permissions) : null,
      status: 'active', created_at: nowStr(),
    });
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'create', `新增子用户 ${username}`);
    Response.success({ id }, '子用户创建成功');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    const displayName = String(b.display_name ?? '').trim();
    const role = b.role ?? 'teacher';
    const email = String(b.email ?? '').trim();
    const phone = String(b.phone ?? '').trim();
    const status = b.status ?? 'active';
    const permissions = b.permissions ?? null;
    if (!id || Helpers.empty(displayName)) Response.error('参数错误');
    const updateData = {
      display_name: displayName, role: role,
      email: email, phone: phone, status: status,
    };
    // 仅当显式传入 permissions 字段时才更新（避免误清空）
    if ('permissions' in b) {
      updateData.permissions = permissions !== null && permissions !== undefined ? JSON.stringify(permissions) : null;
    }
    DB.update('users', updateData, 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'update', `修改子用户 ${displayName}`);
    Response.success(null, '更新成功');
  }

  if (method === 'POST' && action === 'reset-password') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    const password = b.password ?? '';
    if (!id || Buffer.byteLength(String(password), 'utf8') < 6) Response.error('密码至少 6 位');
    DB.update('users', { password_hash: bcrypt.hashSync(password, 10) }, 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'update', `重置子用户密码 ID:${id}`);
    Response.success(null, '密码已重置');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    if (!id) Response.error('参数错误');
    const u = DB.one("SELECT * FROM users WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!u) Response.error('用户不存在');
    DB.delete('users', 'id = ? AND school_id = ?', [id, schoolId]);
    // 同步删除该子用户的联盟绑定
    DB.delete('alliance_account_bindings', 'sub_user_id = ?', [id]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'delete', `删除子用户 ${u.username}`);
    Response.success(null, '删除成功');
  }

  // 学校管理员解绑某子用户的联盟绑定
  if (method === 'POST' && action === 'school-unbind') {
    const bindingId = parseInt(b.binding_id ?? 0, 10) || 0;
    if (!bindingId) Response.error('缺少 binding_id');
    const ok = Auth.schoolUnbind(schoolId, bindingId);
    Response.success({ ok }, ok ? '已解绑' : '条目不存在');
  }

  Response.error('未知的操作');
};