/**
 * 开发者中心 - 编辑器插件 API（1:1 转换自 api/dev/plugins.php）
 *
 * 公开操作（无需登录）：
 *  - GET  action=resolver&ext=xxx        根据文件后缀解析对应的编辑器插件
 *  - GET  action=published               列出已发布插件（供编辑器使用）
 *  - GET  action=shared-list             列出共享市场插件
 *
 * 需要智教联盟登录：
 *  - GET  action=list                    列出当前开发者的插件
 *  - GET  action=get&id=N                获取插件详情
 *  - POST action=create                  创建插件
 *  - POST action=update                  更新插件
 *  - POST action=publish                 发布插件
 *  - POST action=archive                 归档插件
 *  - POST action=delete                  删除插件
 */
const crypto = require('crypto');
const { nowStr } = require('../../lib/response');

/** PHP json_decode(s, true) 等价：失败返回 null */
function jsonDecodeSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  const method = req.method;
  const action = query.action ?? '';

  // ===== [公开] 根据文件后缀解析编辑器插件 =====
  if (method === 'GET' && action === 'resolver') {
    const ext = String(query.ext ?? '').trim().toLowerCase();
    if (ext === '') Response.error('缺少文件后缀');
    const rows = DB.all(
      `SELECT id, plugin_key, name, editor_html, editor_js, editor_css, icon, is_official, extensions
       FROM editor_plugins WHERE status = 'published' ORDER BY is_official DESC, id ASC`
    );
    for (const r of rows) {
      const extensions = r.extensions ? jsonDecodeSafe(r.extensions) : [];
      if (Array.isArray(extensions) && extensions.includes(ext)) {
        r.extensions = extensions;
        Response.success(r); // 内部抛 HttpSent，等价 PHP Response+exit
      }
    }
    Response.success(null);
  }

  // ===== [公开] 列出已发布插件 =====
  if (method === 'GET' && action === 'published') {
    const rows = DB.all(
      `SELECT id, plugin_key, name, version, description, extensions, editor_html, editor_js, editor_css, icon, is_official
       FROM editor_plugins WHERE status = 'published' ORDER BY is_official DESC, id ASC`
    );
    for (const r of rows) {
      r.extensions = r.extensions ? jsonDecodeSafe(r.extensions) : [];
    }
    Response.success(rows);
  }

  // ===== [公开] 列出共享市场插件 =====
  if (method === 'GET' && action === 'shared-list') {
    const keyword = String(query.keyword ?? '').trim();
    let sql = `SELECT id, plugin_key, name, version, description, extensions, icon, status,
                   developer_username, is_official, created_at, updated_at
            FROM editor_plugins WHERE status = 'published' `;
    let params = [];
    if (keyword !== '') {
      sql += ` AND (name LIKE ? OR description LIKE ? OR plugin_key LIKE ?) `;
      const kw = '%' + keyword + '%';
      params = [kw, kw, kw];
    }
    sql += ` ORDER BY is_official DESC, updated_at DESC`;
    const rows = DB.all(sql, params);
    for (const r of rows) {
      r.extensions = r.extensions ? jsonDecodeSafe(r.extensions) : [];
    }
    Response.success(rows);
  }

  // ===== 以下需要联盟登录 =====
  Auth.requireAlliance();
  const developer = Auth.allianceUsername();

  // ===== 列出我的插件 =====
  if (method === 'GET' && action === 'list') {
    const rows = DB.all(
      `SELECT id, plugin_key, name, version, description, extensions, icon, status, is_official, created_at, updated_at
       FROM editor_plugins WHERE developer_username = ? ORDER BY id DESC`,
      [developer]
    );
    // 解析 extensions JSON
    for (const r of rows) {
      r.extensions = r.extensions ? jsonDecodeSafe(r.extensions) : [];
    }
    Response.success(rows);
  }

  // ===== 获取插件详情 =====
  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const plugin = DB.one('SELECT * FROM editor_plugins WHERE id = ? AND (developer_username = ? OR is_official = 1)', [id, developer]);
    if (!plugin) Response.error('插件不存在');
    plugin.extensions = plugin.extensions ? jsonDecodeSafe(plugin.extensions) : [];
    Response.success(plugin);
  }

  // ===== 创建插件 =====
  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    if (name === '') Response.error('插件名称不能为空');
    const extensions = body.extensions ?? [];
    if (!Array.isArray(extensions) || extensions.length === 0) Response.error('至少注册一个文件后缀');
    const now = nowStr();
    // PHP: 'plugin_' . substr(md5($developer . $name . microtime(true)), 0, 12)
    const pluginKey = 'plugin_' + crypto.createHash('md5')
      .update(developer + name + (Date.now() / 1000))
      .digest('hex').slice(0, 12);
    const id = DB.insert('editor_plugins', {
      developer_username: developer,
      plugin_key: pluginKey,
      name: name,
      version: body.version ?? '1.0.0',
      description: body.description ?? '',
      extensions: JSON.stringify(extensions),
      editor_html: body.editor_html ?? '<div id="app"></div>',
      editor_js: body.editor_js ?? '// 自定义编辑器 JS',
      editor_css: body.editor_css ?? '',
      icon: body.icon ?? 'ri-plug-line',
      status: 'draft',
      is_official: 0,
      created_at: now,
      updated_at: now,
    });
    Response.success({ id: id, plugin_key: pluginKey });
  }

  // ===== 更新插件 =====
  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const plugin = DB.one('SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!plugin) Response.error('插件不存在或无权编辑');
    const now = nowStr();
    const updates = { updated_at: now };
    for (const k of ['name', 'version', 'description', 'editor_html', 'editor_js', 'editor_css', 'icon']) {
      if (k in body) updates[k] = body[k];
    }
    if ('extensions' in body && Array.isArray(body.extensions)) {
      updates.extensions = JSON.stringify(body.extensions);
    }
    // PHP 原文为 'id = :id' + ['id' => $id]；Node 版 DB.update 仅支持 ? 占位符，语义等价
    DB.update('editor_plugins', updates, 'id = ?', [id]);
    Response.success({ ok: true });
  }

  // ===== 发布插件 =====
  if (method === 'POST' && action === 'publish') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const plugin = DB.one('SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!plugin) Response.error('插件不存在或无权编辑');
    // PHP 原文为 'id = :id' + ['id' => $id]；Node 版 DB.update 仅支持 ? 占位符，语义等价
    DB.update('editor_plugins', { status: 'published', updated_at: nowStr() }, 'id = ?', [id]);
    Response.success({ ok: true });
  }

  // ===== 归档插件 =====
  if (method === 'POST' && action === 'archive') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const plugin = DB.one('SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!plugin) Response.error('插件不存在或无权编辑');
    // PHP 原文为 'id = :id' + ['id' => $id]；Node 版 DB.update 仅支持 ? 占位符，语义等价
    DB.update('editor_plugins', { status: 'archived', updated_at: nowStr() }, 'id = ?', [id]);
    Response.success({ ok: true });
  }

  // ===== 删除插件 =====
  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const plugin = DB.one('SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?', [id, developer]);
    if (!plugin) Response.error('插件不存在或无权编辑');
    // PHP 原文为 'id = :id' + ['id' => $id]；Node 版等价 ? 占位符
    DB.delete('editor_plugins', 'id = ?', [id]);
    Response.success({ ok: true });
  }

  Response.error('未知操作');
};
