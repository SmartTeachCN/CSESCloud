/**
 * 实例分组 API
 *  - GET  action=list         当前所有者的分组列表
 *  - POST action=create       { name, sort_order? }
 *  - POST action=update       { id, name?, sort_order? }
 *  - POST action=delete       { id }
 *  - POST action=move         { instance_id, group_id }  将实例移至分组（group_id=0 表示移出分组）
 */
const { nowStr } = require('../lib/response');

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;
  Auth.requireLogin();
  const user = Auth.user();
  const ownerKey = Auth.ownerKey();

  const method = req.method;
  const action = query.action ?? '';
  // body 即 Helpers::jsonBody()

  if (method === 'GET' && action === 'list') {
    const rows = DB.all(
      `SELECT g.*,
              (SELECT COUNT(*) FROM instances i WHERE i.group_id = g.id AND i.owner_key = g.owner_key) AS instance_count
       FROM instance_groups g
       WHERE g.owner_key = ?
       ORDER BY g.sort_order ASC, g.id ASC`,
      [ownerKey]
    );
    Response.success(rows);
  }

  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    const sortOrder = parseInt(body.sort_order ?? 0, 10) || 0;
    if (name === '') Response.error('分组名称不能为空');
    const id = DB.insert('instance_groups', {
      owner_user_id: user.user_id ?? 0,
      owner_type: user.type ?? 'sub',
      owner_key: ownerKey,
      name: name,
      sort_order: sortOrder,
      created_at: nowStr(),
    });
    Response.success({ id: id }, '分组已创建');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少 id');
    const row = DB.one("SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?", [id, ownerKey]);
    if (!row) Response.error('分组不存在或无权修改', 403, 403);
    const updates = {};
    if ('name' in body) updates.name = String(body.name).trim();
    if ('sort_order' in body) updates.sort_order = parseInt(body.sort_order, 10) || 0;
    if (!Object.keys(updates).length) Response.error('无更新字段');
    DB.update('instance_groups', updates, 'id = ? AND owner_key = ?', [id, ownerKey]);
    Response.success(null, '分组已更新');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少 id');
    const row = DB.one("SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?", [id, ownerKey]);
    if (!row) Response.error('分组不存在或无权删除', 403, 403);
    DB.delete('instance_groups', 'id = ? AND owner_key = ?', [id, ownerKey]);
    // 将该分组下的实例的 group_id 置空（仅当前所有者）
    DB.query("UPDATE instances SET group_id = NULL WHERE group_id = ? AND owner_key = ?", [id, ownerKey]);
    Response.success(null, '分组已删除');
  }

  if (method === 'POST' && action === 'move') {
    const instanceId = parseInt(body.instance_id ?? 0, 10) || 0;
    const groupId = parseInt(body.group_id ?? 0, 10) || 0;
    if (!instanceId) Response.error('缺少 instance_id');
    if (!Auth.canWriteInstance(instanceId)) Response.error('无权移动该实例', 403, 403);
    if (groupId > 0) {
      const g = DB.one("SELECT id FROM instance_groups WHERE id = ? AND owner_key = ?", [groupId, ownerKey]);
      if (!g) Response.error('目标分组不存在');
    }
    DB.update('instances', { group_id: groupId > 0 ? groupId : null }, 'id = ?', [instanceId]);
    Response.success(null, '已移动');
  }

  Response.error('未知的操作', 405, 405);
};
