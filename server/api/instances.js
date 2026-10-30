/**
 * 实例管理 API
 *
 *  - GET  action=list                     当前所有者可见实例（含共享给本用户的）
 *  - GET  action=get&id=N                 实例详情（带应用清单）
 *  - GET  action=export                   导出实例元数据 JSON
 *  - POST action=create                   创建实例（写入 owner_key + instance_uid）
 *  - POST action=import                    批量导入
 *  - POST action=start|stop|restart       实例状态切换
 *  - POST action=delete                    删除实例（仅所有者/管理员）
 *  - POST action=share                    共享给目标用户
 *  - POST action=batch                    批量操作（start/stop/restart/delete/move）
 *  - POST action=set-config               保存实例配置（仅实例所有者）
 */
const crypto = require('crypto');
const { nowStr } = require('../lib/response');

/** 从 FS 读取应用数据，合并到实例行 */
function enrichWithApp(row) {
  if (!row || !row.app_key) return row;
  try {
    const { AppFS } = require('../lib/dev-fs');
    const app = AppFS.readByKey(row.app_key);
    if (app) {
      row.app_name = app.name;
      row.app_category = app.category;
      if (row._withManifest) {
        row.app_info_manifest = app.app_info_manifest;
        row.storage_manifest = app.storage_manifest;
        row.editor_html = app.editor_html;
        row.editor_js = app.editor_js;
        row.interface_schema = app.interface_schema;
      }
    }
  } catch (e) { /* ignore */ }
  return row;
}

/**
 * 当前可见实例列表：
 *  - 联盟账户：自己创建的实例 + 已加入学校的实例
 *  - 学校子用户：本校实例（按 school_id 过滤）
 */
function listVisibleInstances(Auth, DB) {
  const user = Auth.user();
  const ownerKey = Auth.ownerKey();
  let rows = [];
  if (Auth.isAlliance()) {
    rows = DB.all(
      `SELECT i.*, g.name AS group_name, g.sort_order AS group_order,
              'owned' AS relation
       FROM instances i
       LEFT JOIN instance_groups g ON g.id = i.group_id
       WHERE i.owner_key = ?
       UNION ALL
       SELECT i.*, NULL AS group_name, 0 AS group_order,
              'shared' AS relation
       FROM instances i
       JOIN instance_shares s ON s.instance_id = i.id
       WHERE s.target_type = 'alliance' AND s.target_user_id = 0
       UNION ALL
       SELECT i.*, NULL AS group_name, 0 AS group_order,
              'shared' AS relation
       FROM instances i
       JOIN share_items si ON si.resource_type = 'instance' AND si.resource_id = i.id AND si.is_deleted = 0
       JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'`,
      [ownerKey, user.user_id ?? 0]
    );
  } else {
    rows = DB.all(
      `SELECT i.*, g.name AS group_name, g.sort_order AS group_order,
              CASE WHEN i.owner_key = ? THEN 'owned' ELSE 'shared' END AS relation
       FROM instances i
       LEFT JOIN instance_groups g ON g.id = i.group_id
       LEFT JOIN instance_shares s ON s.instance_id = i.id AND s.target_user_id = ? AND s.target_type = 'sub'
       LEFT JOIN share_items si ON si.resource_type = 'instance' AND si.resource_id = i.id AND si.is_deleted = 0
       LEFT JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
       WHERE i.school_id = ? AND (i.owner_key = ? OR s.id IS NOT NULL OR sup.id IS NOT NULL)`,
      [ownerKey, user.user_id ?? 0, user.user_id ?? 0, user.school_id ?? 0, ownerKey]
    );
  }
  // 从 FS 读取应用数据
  for (const r of rows) {
    enrichWithApp(r);
  }
  return rows;
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;
  Auth.requireLogin();
  const user = Auth.user();
  const ownerKey = Auth.ownerKey();
  const method = req.method;
  const action = query.action ?? '';
  // body 即 Helpers::jsonBody()

  if (method === 'GET' && action === 'list') {
    const rows = listVisibleInstances(Auth, DB);
    // 解析实例 config JSON
    for (const r of rows) {
      if (!Helpers.empty(r.config)) r.config = JSON.parse(r.config);
    }
    Response.success(rows);
  }

  if (method === 'GET' && action === 'export') {
    const rows = listVisibleInstances(Auth, DB);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="cses-instances-export.json"');
    const pickKeys = ['name', 'service_type', 'status', 'created_at'];
    res.end(JSON.stringify({
      version: '1.0',
      exported_at: nowStr(),
      owner_key: ownerKey,
      instances: rows.map(r => Object.fromEntries(pickKeys.filter(k => k in r).map(k => [k, r[k]]))),
    }, null, 4));
    throw new ctx.HttpSent();
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!Auth.canAccessInstance(id)) Response.error('无权访问该实例', 403, 403);
    const ins = DB.one(
      `SELECT i.*, g.name AS group_name
       FROM instances i
       LEFT JOIN instance_groups g ON g.id = i.group_id
       WHERE i.id = ?`,
      [id]
    );
    if (!ins) Response.error('实例不存在');
    // 从 FS 读取应用清单数据
    ins._withManifest = true;
    enrichWithApp(ins);
    if (!Helpers.empty(ins.app_info_manifest) && typeof ins.app_info_manifest === 'object') {
      // already an object from FS
    } else if (!Helpers.empty(ins.app_info_manifest)) {
      ins.app_info_manifest = JSON.parse(ins.app_info_manifest);
    }
    if (!Helpers.empty(ins.storage_manifest) && typeof ins.storage_manifest === 'string') {
      ins.storage_manifest = JSON.parse(ins.storage_manifest);
    }
    if (!Helpers.empty(ins.interface_schema) && typeof ins.interface_schema === 'string') {
      ins.interface_schema = JSON.parse(ins.interface_schema);
    }
    if (!Helpers.empty(ins.config)) ins.config = JSON.parse(ins.config);
    ins.can_write = Auth.canWriteInstance(id);
    Response.success(ins);
  }

  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    let type = String(body.service_type ?? '').trim();
    const appId = parseInt(body.app_id ?? 0, 10) || 0;
    const groupId = parseInt(body.group_id ?? 0, 10) || 0;
    if (name === '') Response.error('实例名称不能为空');

    // 检查数据空间配额
    const username = Auth.allianceUsername();
    const schoolId = Auth.schoolId() || 0;
    if (username) {
      const space = DB.one("SELECT * FROM web_hosting_spaces WHERE alliance_username = ? AND (is_web_space IS NULL OR is_web_space = 0)", [username]);
      if (space) {
        const quota = space.storage_quota || (10 * 1024 * 1024);
        const totalUsed = parseInt(DB.scalar(
          "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
          [space.id]
        ) ?? 0, 10) || 0;
        const instFiles = parseInt(DB.scalar(
          "SELECT COALESCE(SUM(cf.file_size), 0) FROM cloud_files cf JOIN instances i ON i.id = cf.instance_id WHERE i.school_id = ?",
          [schoolId]
        ) ?? 0, 10) || 0;
        const instStorage = parseInt(DB.scalar(
          "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM instance_storage_data isd JOIN instances i ON i.id = isd.instance_id WHERE i.school_id = ?",
          [schoolId]
        ) ?? 0, 10) || 0;
        if (totalUsed + instFiles + instStorage >= quota) {
          Response.error('数据空间已满，请清理数据空间后再创建实例');
        }
      }
    }

    if (appId > 0) {
      const { AppFS } = require('../lib/dev-fs');
      const allApps = AppFS.listPublished();
      const app = allApps.find(a => a._id === appId);
      if (!app) Response.error('所选应用不存在或未发布');
      type = app.category;
      var appKey = app.app_key;
    } else {
      var appKey = null;
    }
    // 系统自动分配 instance_uid
    const instanceUid = 'inst-' + crypto.randomBytes(6).toString('hex');
    const now = nowStr();
    DB.insert('instances', {
      school_id: schoolId,
      app_id: appId > 0 ? appId : null,
      app_key: appKey,
      name: name,
      service_type: type,
      status: 'running',
      owner_user_id: user.user_id ?? 0,
      owner_type: user.type ?? 'sub',
      owner_key: ownerKey,
      instance_uid: instanceUid,
      group_id: groupId > 0 ? groupId : null,
      config: JSON.stringify(body.config ?? []),
      created_at: now,
    });
    Auth.logAudit(schoolId, user.user_id ?? 0, 'create', `创建实例 ${name} (uid=${instanceUid})`);
    Response.success({ instance_uid: instanceUid }, '实例创建成功');
  }

  if (method === 'POST' && action === 'import') {
    const payload = body.payload ?? null;
    if (!payload || !('instances' in payload)) Response.error('导入数据格式无效');
    let count = 0;
    const schoolId = Auth.schoolId() || 0;
    for (const row of payload.instances) {
      if (Helpers.empty(row.name) || Helpers.empty(row.service_type)) continue;
      const instanceUid = 'inst-' + crypto.randomBytes(6).toString('hex');
      DB.insert('instances', {
        school_id: schoolId,
        name: row.name,
        service_type: row.service_type,
        status: row.status ?? 'stopped',
        owner_user_id: user.user_id ?? 0,
        owner_type: user.type ?? 'sub',
        owner_key: ownerKey,
        instance_uid: instanceUid,
        created_at: row.created_at ?? nowStr(),
      });
      count++;
    }
    Auth.logAudit(schoolId, user.user_id ?? 0, 'import', `导入 ${count} 个实例`);
    Response.success({ count: count }, `成功导入 ${count} 个实例`);
  }

  // 状态切换统一处理
  if (['start', 'stop', 'restart'].includes(action) && method === 'POST') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!Auth.canWriteInstance(id)) Response.error('无权操作该实例', 403, 403);
    const ins = DB.one("SELECT * FROM instances WHERE id = ?", [id]);
    if (!ins) Response.error('实例不存在');
    const newStatus = action === 'stop' ? 'stopped' : 'running';
    const updates = { status: newStatus };
    if (action === 'stop') updates.uptime = '—';
    else if (action === 'start') updates.uptime = '99.9%';
    DB.update('instances', updates, 'id = ?', [id]);
    Auth.logAudit(ins.school_id, user.user_id ?? 0, action, `${action} 实例 ${ins.name}`);
    Response.success(null, '实例已' + (action === 'start' ? '启动' : (action === 'stop' ? '停止' : '重启')));
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!Auth.canWriteInstance(id)) Response.error('无权删除该实例', 403, 403);
    const ins = DB.one("SELECT * FROM instances WHERE id = ?", [id]);
    if (!ins) Response.error('实例不存在');
    DB.delete('instances', 'id = ?', [id]);
    Auth.logAudit(ins.school_id, user.user_id ?? 0, 'delete', `删除实例 ${ins.name}`);
    Response.success(null, '实例已删除');
  }

  if (method === 'POST' && action === 'share') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!Auth.canWriteInstance(id)) Response.error('无权共享该实例', 403, 403);
    const targetUserId = parseInt(body.target_user_id ?? 0, 10) || 0;
    const targetType = body.target_type ?? 'sub';
    const shareMode = body.share_mode ?? 'view';
    const shareToken = crypto.randomBytes(8).toString('hex');
    const sid = DB.insert('instance_shares', {
      instance_id: id,
      shared_by_user_id: user.user_id ?? 0,
      shared_by_type: user.type ?? 'sub',
      target_user_id: targetUserId,
      target_type: targetType,
      share_mode: shareMode,
      share_token: shareToken,
      created_at: nowStr(),
    });
    Auth.logAudit(Auth.schoolId(), user.user_id ?? 0, 'share', `共享实例 id=${id} 给 target=${targetUserId}`);
    Response.success({ id: sid, share_token: shareToken }, '已共享');
  }

  if (method === 'POST' && action === 'batch') {
    const batchAction = body.action ?? '';
    let ids = body.ids ?? [];
    if (!Array.isArray(ids) || !ids.length) Response.error('未选择任何实例');
    ids = ids.map(v => parseInt(v, 10) || 0);
    // 校验权限
    for (const bid of ids) {
      if (!Auth.canWriteInstance(bid)) Response.error(`实例 id=${bid} 无权操作`, 403, 403);
    }
    const idList = ids.join(',');
    if (['start', 'stop', 'restart'].includes(batchAction)) {
      const newStatus = batchAction === 'stop' ? 'stopped' : 'running';
      DB.query(`UPDATE instances SET status = ? WHERE id IN (${idList})`, [newStatus]);
      Auth.logAudit(Auth.schoolId(), user.user_id ?? 0, 'batch', `批量 ${batchAction} 实例 ids=${idList}`);
      Response.success({ count: ids.length }, '已批量执行');
    }
    if (batchAction === 'delete') {
      DB.query(`DELETE FROM instances WHERE id IN (${idList})`, []);
      Auth.logAudit(Auth.schoolId(), user.user_id ?? 0, 'batch', `批量删除实例 ids=${idList}`);
      Response.success({ count: ids.length }, '已批量删除');
    }
    if (batchAction === 'move') {
      const groupId = parseInt(body.group_id ?? 0, 10) || 0;
      DB.query(`UPDATE instances SET group_id = ? WHERE id IN (${idList})`, [groupId > 0 ? groupId : null]);
      Response.success({ count: ids.length }, '已移动到目标分组');
    }
    Response.error('未知的批量操作');
  }

  if (method === 'POST' && action === 'set-config') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!Auth.canWriteInstance(id)) Response.error('无权修改该实例配置', 403, 403);
    const config = body.config ?? [];
    DB.update('instances', { config: JSON.stringify(config) }, 'id = ?', [id]);
    Response.success(null, '实例配置已保存');
  }

  Response.error('未知的操作', 405, 405);
};
