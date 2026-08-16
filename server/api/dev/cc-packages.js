/**
 * 开发者中心 - 集控侧套餐 API（1:1 转换自 api/dev/cc-packages.php）
 * 仅智教联盟登录可访问
 *
 * 支持操作：
 *  - GET  action=list              列出当前开发者的集控套餐
 *  - GET  action=get&id=N          获取套餐详情
 *  - GET  action=published         列出已发布套餐（供校园集控选择）
 *  - POST action=create            创建套餐
 *  - POST action=update            更新套餐基础信息
 *  - POST action=save-manifest     保存某类清单（package/calling_instances/editor_html/editor_js/variable）
 *  - POST action=publish           发布套餐
 *  - POST action=archive           归档套餐
 *  - POST action=delete            删除套餐
 */
const crypto = require('crypto');
const { nowStr } = require('../../lib/response');

/** PHP json_decode(s, true) 等价：失败返回 null */
function jsonDecodeSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireAlliance();
  const developer = Auth.allianceUsername();

  const method = req.method;
  const action = query.action ?? '';

  if (method === 'GET' && action === 'list') {
    const rows = DB.all(
      `SELECT id, package_key, name, version, description, status, created_at, updated_at
       FROM cc_packages WHERE developer_username = ? ORDER BY id DESC`,
      [developer]
    );
    Response.success(rows);
  }

  if (method === 'GET' && action === 'published') {
    const rows = DB.all(
      `SELECT id, package_key, name, version, description
       FROM cc_packages WHERE status = 'published' ORDER BY name ASC`
    );
    Response.success(rows);
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const pkg = DB.one('SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!pkg) Response.error('套餐不存在');
    for (const k of ['package_manifest', 'calling_instances_manifest', 'variable_manifest']) {
      pkg[k] = pkg[k] ? jsonDecodeSafe(pkg[k]) : null;
    }
    Response.success(pkg);
  }

  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    if (name === '') Response.error('套餐名称不能为空');
    const now = nowStr();
    // PHP: 'cc_' . substr(md5($developer . $name . microtime(true)), 0, 12)
    const packageKey = 'cc_' + crypto.createHash('md5')
      .update(developer + name + (Date.now() / 1000))
      .digest('hex').slice(0, 12);
    const id = DB.insert('cc_packages', {
      developer_username: developer,
      package_key: packageKey,
      name: name,
      version: body.version ?? '1.0.0',
      description: body.description ?? '',
      status: 'draft',
      package_manifest: JSON.stringify({
        name: name,
        version: body.version ?? '1.0.0',
        description: body.description ?? '',
        author: developer,
        target_audience: 'teacher',
        tags: [],
      }),
      calling_instances_manifest: JSON.stringify({ instances: [] }),
      editor_html: '',
      editor_js: '',
      variable_manifest: JSON.stringify({ variables: [] }),
      created_at: now,
      updated_at: now,
    });
    Auth.logAudit(0, 0, 'create', `开发者 ${developer} 创建集控套餐 ${name}`);
    Response.success({ id: id, package_key: packageKey }, '套餐创建成功');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const pkg = DB.one('SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!pkg) Response.error('套餐不存在');
    const updates = {};
    if ('name' in body) updates.name = String(body.name).trim();
    if ('version' in body) updates.version = String(body.version).trim();
    if ('description' in body) updates.description = body.description;
    updates.updated_at = nowStr();
    DB.update('cc_packages', updates, 'id = ? AND developer_username = ?', [id, developer]);
    Response.success(null, '已保存');
  }

  if (method === 'POST' && action === 'save-manifest') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const type = body.type ?? ''; // package | calling_instances | editor_html | editor_js | variable
    const pkg = DB.one('SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!pkg) Response.error('套餐不存在');

    const fieldMap = {
      package: 'package_manifest',
      calling_instances: 'calling_instances_manifest',
      editor_html: 'editor_html',
      editor_js: 'editor_js',
      variable: 'variable_manifest',
    };
    if (!(type in fieldMap)) Response.error('未知的清单类型');
    const field = fieldMap[type];
    let value = body.value ?? null;
    // JSON 类清单需编码（PHP is_array：关联数组与列表均可）
    if (['package', 'calling_instances', 'variable'].includes(type)) {
      if (value === null || typeof value !== 'object') Response.error('清单数据格式无效');
      value = JSON.stringify(value);
    } else {
      value = value === null ? '' : String(value); // PHP (string)null === ''
    }
    DB.update('cc_packages', { [field]: value, updated_at: nowStr() }, 'id = ? AND developer_username = ?', [id, developer]);
    Auth.logAudit(0, 0, 'update', `开发者 ${developer} 保存套餐清单 ${type} (pkg_id=${id})`);
    Response.success(null, '清单已保存');
  }

  if (method === 'POST' && action === 'publish') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const pkg = DB.one('SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!pkg) Response.error('套餐不存在');
    if (Helpers.empty(pkg.package_manifest)) Response.error('发布前请先完成集控套餐清单');
    DB.update('cc_packages', { status: 'published', updated_at: nowStr() }, 'id = ? AND developer_username = ?', [id, developer]);
    Auth.logAudit(0, 0, 'update', `开发者 ${developer} 发布套餐 ${pkg.name}`);
    Response.success(null, '套餐已发布');
  }

  if (method === 'POST' && action === 'archive') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    DB.update('cc_packages', { status: 'archived', updated_at: nowStr() }, 'id = ? AND developer_username = ?', [id, developer]);
    Response.success(null, '套餐已归档');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const pkg = DB.one('SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!pkg) Response.error('套餐不存在');
    DB.delete('cc_packages', 'id = ? AND developer_username = ?', [id, developer]);
    Auth.logAudit(0, 0, 'delete', `开发者 ${developer} 删除套餐 ${pkg.name}`);
    Response.success(null, '套餐已删除');
  }

  Response.error('未知的操作');
};
