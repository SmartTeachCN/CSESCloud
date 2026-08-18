/**
 * 开发者中心 - 编辑器插件 API（纯文件系统存储）
 *
 * 共享市场插件存储在 data/dev/plugins/{plugin_key}/ 下
 * 用户自己的插件存储在 data/dev-users/{username}/plugins/{plugin_key}/ 下
 *
 * 公开操作（无需登录）：
 *  - GET  action=resolver&ext=xxx        根据文件后缀解析对应的编辑器插件
 *  - GET  action=published               列出已发布插件
 *  - GET  action=shared-list             列出共享市场插件
 *
 * 需要智教联盟登录：
 *  - GET  action=list                    列出当前开发者的插件
 *  - GET  action=get&plugin_key=X        获取插件详情
 *  - POST action=create                  创建插件
 *  - POST action=update                  更新插件
 *  - POST action=publish                 发布插件
 *  - POST action=archive                 归档插件
 *  - POST action=delete                  删除插件
 */
const crypto = require('crypto');
const { nowStr } = require('../../lib/response');
const { PluginFS } = require('../../lib/dev-fs');

/** 按 plugin_key 查找插件（支持 id 兼容） */
function findPlugin(fs, query) {
  if (query.plugin_key) return fs.readByKey(query.plugin_key);
  if (query.id) {
    const id = parseInt(query.id, 10) || 0;
    const all = fs.listAll();
    return all.find(p => p._id === id) || null;
  }
  return null;
}

module.exports = async (ctx) => {
  const { req, res, Auth, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const action = query.action ?? '';

  // ===== [公开] 根据文件后缀解析编辑器插件 =====
  if (method === 'GET' && action === 'resolver') {
    const ext = String(query.ext ?? '').trim().toLowerCase();
    if (ext === '') Response.error('缺少文件后缀');
    const plugin = PluginFS.resolveByExt(ext);
    if (plugin) {
      Response.success(plugin);
    } else {
      Response.success(null);
    }
  }

  // ===== [公开] 列出已发布插件 =====
  if (method === 'GET' && action === 'published') {
    const plugins = PluginFS.listPublished();
    Response.success(plugins);
  }

  // ===== [公开] 列出共享市场插件 =====
  if (method === 'GET' && action === 'shared-list') {
    const keyword = String(query.keyword ?? '').trim().toLowerCase();
    let plugins = PluginFS.listShared();
    if (keyword) {
      plugins = plugins.filter(p =>
        (p.name || '').toLowerCase().includes(keyword) ||
        (p.description || '').toLowerCase().includes(keyword) ||
        (p.plugin_key || '').toLowerCase().includes(keyword)
      );
    }
    Response.success(plugins);
  }

  // ===== 以下需要联盟登录 =====
  Auth.requireAlliance();
  const developer = Auth.allianceUsername();
  const effectiveDeveloper = developer !== '' ? developer : (Auth.user()?.username ?? 'super_admin');

  // ===== 列出我的插件 =====
  if (method === 'GET' && action === 'list') {
    const plugins = PluginFS.listByUser(effectiveDeveloper);
    Response.success(plugins);
  }

  // ===== 获取插件详情 =====
  if (method === 'GET' && action === 'get') {
    const plugin = findPlugin(PluginFS, query);
    if (!plugin) Response.error('插件不存在');
    if (plugin.developer_username !== effectiveDeveloper && !plugin.is_official) {
      Response.error('无权访问此插件');
    }
    Response.success(plugin);
  }

  // ===== 创建插件 =====
  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    if (name === '') Response.error('插件名称不能为空');
    const extensions = body.extensions ?? [];
    if (!Array.isArray(extensions) || extensions.length === 0) Response.error('至少注册一个文件后缀');
    const pluginKey = 'plugin_' + crypto.createHash('md5')
      .update(effectiveDeveloper + name + (Date.now() / 1000))
      .digest('hex').slice(0, 12);
    const plugin = PluginFS.createUserPlugin(effectiveDeveloper, pluginKey, {
      name,
      version: body.version ?? '1.0.0',
      description: body.description ?? '',
      extensions,
      editor_html: body.editor_html ?? '<div id="app"></div>',
      editor_js: body.editor_js ?? '// 自定义编辑器 JS',
      editor_css: body.editor_css ?? '',
      icon: body.icon ?? 'ri-plug-line',
      ribbon: Array.isArray(body.ribbon) ? body.ribbon : [],
    });
    Response.success({ _id: plugin._id, plugin_key: plugin.plugin_key });
  }

  // ===== 更新插件 =====
  if (method === 'POST' && action === 'update') {
    const plugin = findPlugin(PluginFS, body);
    if (!plugin) Response.error('插件不存在');
    if (plugin.developer_username !== effectiveDeveloper) Response.error('无权编辑此插件');
    const now = nowStr();
    const fsUpdate = { updated_at: now };
    for (const k of ['name', 'version', 'description', 'editor_html', 'editor_js', 'editor_css', 'icon', 'ribbon']) {
      if (k in body) fsUpdate[k] = body[k];
    }
    if ('extensions' in body && Array.isArray(body.extensions)) {
      fsUpdate.extensions = body.extensions;
    }
    PluginFS.writeUser(effectiveDeveloper, plugin.plugin_key, fsUpdate);
    Response.success({ ok: true });
  }

  // ===== 发布插件 =====
  if (method === 'POST' && action === 'publish') {
    const plugin = findPlugin(PluginFS, body);
    if (!plugin) Response.error('插件不存在');
    if (plugin.developer_username !== effectiveDeveloper) Response.error('无权编辑此插件');
    PluginFS.writeUser(effectiveDeveloper, plugin.plugin_key, { status: 'published', updated_at: nowStr() });
    Response.success({ ok: true });
  }

  // ===== 归档插件 =====
  if (method === 'POST' && action === 'archive') {
    const plugin = findPlugin(PluginFS, body);
    if (!plugin) Response.error('插件不存在');
    if (plugin.developer_username !== effectiveDeveloper) Response.error('无权编辑此插件');
    PluginFS.writeUser(effectiveDeveloper, plugin.plugin_key, { status: 'archived', updated_at: nowStr() });
    Response.success({ ok: true });
  }

  // ===== 删除插件 =====
  if (method === 'POST' && action === 'delete') {
    const plugin = findPlugin(PluginFS, body);
    if (!plugin) Response.error('插件不存在');
    if (plugin.developer_username !== effectiveDeveloper) Response.error('无权删除此插件');
    PluginFS.deleteUserPlugin(effectiveDeveloper, plugin.plugin_key);
    Response.success({ ok: true });
  }

  Response.error('未知操作');
};