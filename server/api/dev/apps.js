/**
 * 开发者中心 - 实例侧应用 API（纯文件系统存储）
 *
 * 共享市场应用存储在 data/dev/apps/{app_key}/ 下
 * 用户自己的应用存储在 data/dev-users/{username}/apps/{app_key}/ 下
 *
 * 公开操作（无需联盟登录）：
 *  - GET  action=published         列出已发布应用（供实例创建选择）
 *  - GET  action=shared-list       列出共享市场中的应用
 *  - GET  action=shared-get&app_key=X  获取共享市场应用详情（只读）
 *  - GET  action=icon&app_key=X    输出应用真实图标 PNG（icon 值为 asset:icon.png 时引用）
 *
 * 需要智教联盟登录：
 *  - GET  action=list              列出当前开发者的应用
 *  - GET  action=get&app_key=X     获取应用详情
 *  - POST action=create            创建应用
 *  - POST action=update            更新应用基础信息
 *  - POST action=save-manifest     保存某类清单
 *  - POST action=publish           发布应用
 *  - POST action=archive           归档应用
 *  - POST action=delete            删除应用
 *  - POST action=share             切换共享状态
 *  - POST action=fork              fork 共享市场应用到自己的应用列表
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { nowStr, HttpSent } = require('../../lib/response');
const { AppFS } = require('../../lib/dev-fs');

/** 按 app_key 查找应用（支持 id 兼容） */
function findApp(appFS, query) {
  if (query.app_key) return appFS.readByKey(query.app_key);
  if (query.id) {
    const id = parseInt(query.id, 10) || 0;
    const all = appFS.listAll();
    return all.find(a => a._id === id) || null;
  }
  return null;
}

/** 根据应用所在目录，写入到正确位置（共享市场或用户目录） */
function writeApp(app, data) {
  if (fs.existsSync(AppFS.sharedDir(app.app_key))) {
    AppFS.writeShared(app.app_key, data);
  } else {
    AppFS.writeUser(app.developer_username, app.app_key, data);
  }
}

/** 根据应用所在目录，删除正确位置 */
function deleteAppByKey(app) {
  if (fs.existsSync(AppFS.sharedDir(app.app_key))) {
    AppFS.deleteApp(app.app_key);
  } else {
    AppFS.deleteUserApp(app.developer_username, app.app_key);
  }
}

module.exports = async (ctx) => {
  const { req, res, Auth, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const action = query.action ?? '';

  // ===== [公开] 列出已发布应用（供实例创建时选择） =====
  if (method === 'GET' && action === 'published') {
    const apps = AppFS.listPublished()
      // 演示应用不进入“新建实例”的应用选择列表
      .filter(a => a.app_info_manifest?.hide_from_instances !== true)
      .map(a => ({
        _id: a._id, app_key: a.app_key, name: a.name,
        version: a.version, description: a.description, category: a.category, icon: a.icon,
        is_official: a.is_official,
      }));
    Response.success(apps);
  }

  // ===== [公开] 列出共享市场应用 =====
  if (method === 'GET' && action === 'shared-list') {
    const keyword = String(query.keyword ?? '').trim().toLowerCase();
    let apps = AppFS.listShared();
    if (keyword) {
      apps = apps.filter(a =>
        (a.name || '').toLowerCase().includes(keyword) ||
        (a.description || '').toLowerCase().includes(keyword) ||
        (a.app_key || '').toLowerCase().includes(keyword)
      );
    }
    const result = apps.map(a => ({
      _id: a._id, app_key: a.app_key, name: a.name, version: a.version,
      description: a.description, category: a.category, icon: a.icon, status: a.status,
      developer_username: a.developer_username, is_official: a.is_official,
      forked_from: a.forked_from, forked_by: a.forked_by,
      created_at: a.created_at, updated_at: a.updated_at,
      control_enabled: a.control_manifest?.enabled === true,
    }));
    Response.success(result);
  }

  // ===== [公开] 输出应用真实图标资源（icon 以 asset: 前缀引用） =====
  if (method === 'GET' && action === 'icon') {
    const app = findApp(AppFS, query);
    const dir = app ? AppFS.findDir(app.app_key) : null;
    const iconFile = dir ? path.join(dir, 'icon.png') : null;
    if (!iconFile || !fs.existsSync(iconFile)) {
      res.status(404).json({ code: 404, message: '图标不存在', data: null });
      return;
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(fs.readFileSync(iconFile));
    throw new HttpSent();
  }

  // ===== [公开] 获取共享市场应用详情（只读） =====
  if (method === 'GET' && action === 'shared-get') {
    const app = findApp(AppFS, query);
    if (!app || !app.is_shared) Response.error('共享应用不存在或未公开');
    Response.success(app);
  }

  // ===== 以下需要联盟登录 =====
  Auth.requireAlliance();
  const developer = Auth.allianceUsername();
  const isSuperAdmin = Auth.isSuperAdmin();
  const effectiveDeveloper = developer !== '' ? developer : (Auth.user()?.username ?? 'super_admin');

  // ===== 列出我的应用 =====
  if (method === 'GET' && action === 'list') {
    const apps = isSuperAdmin ? AppFS.listAll() : AppFS.listByUser(effectiveDeveloper);
    // 返回精简字段
    const result = apps.map(a => ({
      _id: a._id, app_key: a.app_key, name: a.name, version: a.version,
      description: a.description, category: a.category, icon: a.icon, status: a.status,
      is_shared: a.is_shared, is_official: a.is_official,
      developer_username: a.developer_username,
      created_at: a.created_at, updated_at: a.updated_at,
    }));
    Response.success(result);
  }

  // ===== 获取应用详情 =====
  if (method === 'GET' && action === 'get') {
    let app = findApp(AppFS, query);
    if (!app) Response.error('应用不存在');
    // 权限检查
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权访问此应用');
    }
    Response.success(app);
  }

  // ===== 创建应用 =====
  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    if (name === '') Response.error('应用名称不能为空');
    const appKey = 'app_' + crypto.createHash('md5')
      .update(effectiveDeveloper + name + (Date.now() / 1000))
      .digest('hex').slice(0, 12);
    let isOfficial = false;
    if (!Helpers.empty(body.is_official) && Auth.isSuperAdmin()) {
      isOfficial = true;
    }
    const app = AppFS.createUserApp(effectiveDeveloper, appKey, {
      name,
      version: body.version ?? '1.0.0',
      description: body.description ?? '',
      category: body.category ?? '通用',
      icon: body.icon ?? 'ri-apps-2-line',
      is_official: isOfficial,
      app_info_manifest: {
        name, version: body.version ?? '1.0.0',
        description: body.description ?? '',
        category: body.category ?? '通用',
        author: effectiveDeveloper, homepage: '', tags: [], icon: body.icon ?? 'ri-apps-2-line',
      },
      editor_html: '', editor_js: '',
      storage_manifest: { collections: [] },
      interface_schema: { endpoints: [] },
      control_manifest: { enabled: false, protocolVersion: 1, supportedCommands: [], description: '' },
    });
    Auth.logAudit(0, 0, 'create', `开发者 ${effectiveDeveloper} 创建应用 ${name}`);
    Response.success({ _id: app._id, app_key: app.app_key }, '应用创建成功');
  }

  // ===== 更新基础信息 =====
  if (method === 'POST' && action === 'update') {
    let app = findApp(AppFS, body);
    if (!app) Response.error('应用不存在');
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权编辑此应用');
    }
    const updates = { updated_at: nowStr() };
    if ('name' in body) updates.name = String(body.name).trim();
    if ('version' in body) updates.version = String(body.version).trim();
    if ('description' in body) updates.description = body.description;
    if ('category' in body) updates.category = body.category;
    if ('icon' in body) updates.icon = String(body.icon ?? '').trim();
    writeApp(app, updates);
    Response.success(null, '已保存');
  }

  // ===== 保存某类清单 =====
  if (method === 'POST' && action === 'save-manifest') {
    let app = findApp(AppFS, body);
    if (!app) Response.error('应用不存在');
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权编辑此应用');
    }
    const type = body.type ?? '';
    const fieldMap = {
      app_info: 'app_info_manifest',
      editor_html: 'editor_html',
      editor_js: 'editor_js',
      storage: 'storage_manifest',
      interface: 'interface_schema',
      control: 'control_manifest',
    };
    if (!(type in fieldMap)) Response.error('未知的清单类型');
    const field = fieldMap[type];
    let value = body.value ?? null;
    if (['app_info', 'storage', 'interface', 'control'].includes(type)) {
      if (value === null || typeof value !== 'object') Response.error('清单数据格式无效');
    }
    const fsUpdate = { updated_at: nowStr() };
    fsUpdate[field] = value;
    writeApp(app, fsUpdate);
    Auth.logAudit(0, 0, 'update', `开发者 ${effectiveDeveloper} 保存应用清单 ${type}`);
    Response.success(null, '清单已保存');
  }

  // ===== 发布应用 =====
  if (method === 'POST' && action === 'publish') {
    let app = findApp(AppFS, body);
    if (!app) Response.error('应用不存在');
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权编辑此应用');
    }
    if (!app.app_info_manifest || Object.keys(app.app_info_manifest).length === 0) {
      Response.error('发布前请先完成应用信息清单');
    }
    if (!app.storage_manifest || !app.storage_manifest.collections) {
      Response.error('发布前请先完成实例存储清单');
    }
    writeApp(app, { status: 'published', updated_at: nowStr() });
    Auth.logAudit(0, 0, 'update', `开发者 ${effectiveDeveloper} 发布应用 ${app.name}`);
    Response.success(null, '应用已发布');
  }

  // ===== 归档应用 =====
  if (method === 'POST' && action === 'archive') {
    let app = findApp(AppFS, body);
    if (!app) Response.error('应用不存在');
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权编辑此应用');
    }
    writeApp(app, { status: 'archived', updated_at: nowStr() });
    Response.success(null, '应用已归档');
  }

  // ===== 删除应用 =====
  if (method === 'POST' && action === 'delete') {
    let app = findApp(AppFS, body);
    if (!app) Response.error('应用不存在');
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权删除此应用');
    }
    deleteAppByKey(app);
    Auth.logAudit(0, 0, 'delete', `开发者 ${effectiveDeveloper} 删除应用 ${app.name}`);
    Response.success(null, '应用已删除');
  }

  // ===== 切换共享状态 =====
  if (method === 'POST' && action === 'share') {
    let app = findApp(AppFS, body);
    if (!app) Response.error('应用不存在');
    if (!isSuperAdmin && app.developer_username !== effectiveDeveloper) {
      Response.error('无权编辑此应用');
    }
    const newShared = app.is_shared ? 0 : 1;
    writeApp(app, { is_shared: newShared, updated_at: nowStr() });
    Auth.logAudit(0, 0, 'update', `开发者 ${effectiveDeveloper} ` + (newShared ? '共享' : '取消共享') + ` 应用 ${app.name}`);
    Response.success({ is_shared: newShared }, newShared ? '已共享到市场' : '已取消共享');
  }

  // ===== Fork 共享市场应用到自己的应用列表 =====
  if (method === 'POST' && action === 'fork') {
    const src = findApp(AppFS, body);
    if (!src || !src.is_shared) Response.error('源应用不存在或未共享');
    if (src.developer_username === effectiveDeveloper) Response.error('不能 fork 自己的应用');
    const newKey = 'app_' + crypto.createHash('md5')
      .update(effectiveDeveloper + src.name + (Date.now() / 1000))
      .digest('hex').slice(0, 12);
    const newApp = AppFS.copyApp(src.app_key, effectiveDeveloper, newKey, {
      forked_from: src._id,
      forked_by: src.developer_username,
    });
    Auth.logAudit(0, 0, 'create', `开发者 ${effectiveDeveloper} fork 应用 ${src.name}`);
    Response.success({ _id: newApp._id, app_key: newApp.app_key }, '已 fork 到我的应用列表');
  }

  Response.error('未知的操作');
};