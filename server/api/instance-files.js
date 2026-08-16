/**
 * 实例文件系统 API
 *
 * 实例的所有配置文件存储在 cloud_files 表中，通过 directory 字段隔离：
 *   /instances/{instance_uid}/          配置根目录
 *   /instances/{instance_uid}/php/      PHP 后端目录
 *
 * 操作：
 *  - GET  action=list&instance_id=N&dir=        列出指定目录下的文件
 *  - GET  action=get&id=N                        获取单个文件（含内容）
 *  - POST action=save                            创建或更新文件
 *  - POST action=delete                          删除文件
 *  - GET  action=resolve-editor&ext=xxx          根据文件后缀解析编辑器插件
 *  - GET  action=storage-stats&instance_id=N     获取实例存储统计
 *  - GET  action=file-tree&instance_id=N         获取实例文件树（含目录结构）
 */
const { nowStr } = require('../lib/response');

/** PHP addslashes 等价 */
function addslashes(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\0/g, '\\0');
}

/** PHP pathinfo($name, PATHINFO_EXTENSION) 等价（取小写扩展名，无扩展名返回 ''） */
function extOf(name) {
  const dot = String(name).lastIndexOf('.');
  if (dot <= 0) return '';
  return String(name).slice(dot + 1).toLowerCase();
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const action = query.action ?? '';
  // body 即 Helpers::jsonBody()

  // ===== [公开] 根据后缀解析编辑器插件 =====
  if (method === 'GET' && action === 'resolve-editor') {
    const ext = String(query.ext ?? '').trim().toLowerCase();
    if (ext === '') Response.error('缺少文件后缀');
    const rows = DB.all(
      `SELECT id, plugin_key, name, editor_html, editor_js, editor_css, icon, is_official, extensions
       FROM editor_plugins WHERE status = 'published' ORDER BY is_official DESC, id ASC`
    );
    for (const r of rows) {
      let extensions = [];
      if (r.extensions) { try { extensions = JSON.parse(r.extensions); } catch (_) { extensions = []; } }
      if (Array.isArray(extensions) && extensions.includes(ext)) {
        r.extensions = extensions;
        Response.success(r);
      }
    }
    Response.success(null);
  }

  Auth.requireLogin();

  // ===== 列出实例目录下的文件 =====
  if (method === 'GET' && action === 'list') {
    const instanceId = parseInt(query.instance_id ?? 0, 10) || 0;
    const dir = String(query.dir ?? '').trim();
    if (instanceId <= 0) Response.error('缺少实例 ID');
    if (!Auth.canAccessInstance(instanceId)) Response.error('无权访问该实例', 403, 403);

    const inst = DB.one("SELECT instance_uid FROM instances WHERE id = ?", [instanceId]);
    if (!inst) Response.error('实例不存在');

    const instanceUid = inst.instance_uid;
    const baseDir = '/instances/' + instanceUid + '/';
    const searchDir = baseDir + (dir !== '' ? dir.replace(/^\/+/, '') + '/' : '');

    const rows = DB.all(
      `SELECT id, directory, name, file_type, file_category, file_size, status, created_at, updated_at
       FROM cloud_files
       WHERE instance_id = ? AND directory = ?
       ORDER BY file_category ASC, name ASC`,
      [instanceId, searchDir]
    );

    // 统计子目录（通过 directory 前缀匹配）
    const subDirs = DB.all(
      `SELECT DISTINCT directory
       FROM cloud_files
       WHERE instance_id = ? AND directory LIKE ? AND directory != ?`,
      [instanceId, searchDir + '%', searchDir]
    );

    let dirs = [];
    for (const sd of subDirs) {
      let rel = String(sd.directory).slice(baseDir.length);
      rel = rel.replace(/\/+$/, '');
      if (rel !== '' && rel !== dir) {
        const parts = rel.split('/');
        // 只取直接子目录
        const depth = (dir.match(/\//g) || []).length + (dir !== '' ? 1 : 0);
        if (parts.length === depth || (dir === '' && parts.length === 1)) {
          dirs.push(parts[parts.length - 1]);
        }
      }
    }
    dirs = [...new Set(dirs)];

    Response.success({
      files: rows,
      directories: dirs,
      current_dir: dir !== '' ? dir : '',
      base_dir: baseDir,
    });
  }

  // ===== 获取单个文件 =====
  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const file = DB.one("SELECT * FROM cloud_files WHERE id = ?", [id]);
    if (!file) Response.error('文件不存在');
    if (file.instance_id && !Auth.canAccessInstance(parseInt(file.instance_id, 10) || 0)) {
      Response.error('无权访问该文件', 403, 403);
    }
    Response.success(file);
  }

  // ===== 创建或更新文件 =====
  if (method === 'POST' && action === 'save') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const instanceId = parseInt(body.instance_id ?? 0, 10) || 0;
    let directory = String(body.directory ?? '').trim();
    const name = String(body.name ?? '').trim();
    const content = body.content ?? '';
    let fileType = body.file_type ?? 'json';
    const fileCategory = body.file_category ?? 'instance_config';

    if (instanceId <= 0) Response.error('缺少实例 ID');
    if (!Auth.canWriteInstance(instanceId)) Response.error('无权操作该实例', 403, 403);
    if (name === '') Response.error('文件名不能为空');
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
      Response.error('文件名只能包含字母、数字、下划线、连字符和点');
    }

    // 自动推断 file_type
    if (fileType === 'json' && name.includes('.')) {
      const ext = extOf(name);
      if (ext !== '') fileType = ext;
    }

    const inst = DB.one("SELECT instance_uid, school_id FROM instances WHERE id = ?", [instanceId]);
    if (!inst) Response.error('实例不存在');

    const baseDir = '/instances/' + inst.instance_uid + '/';
    // 如果 directory 为空，使用根目录；否则拼接为完整路径
    if (directory === '') {
      directory = baseDir;
    } else if (!directory.startsWith('/instances/')) {
      // 相对路径 → 补全为绝对路径
      directory = baseDir + directory.replace(/^\/+/, '');
    }
    // 确保 directory 以 / 结尾
    if (!directory.endsWith('/')) {
      directory += '/';
    }

    // 安全检查：确保 directory 在实例目录内
    if (!directory.startsWith(baseDir)) {
      Response.error('无效的目录路径', 400, 400);
    }

    const now = nowStr();
    const schoolId = Auth.schoolId() || inst.school_id;

    if (id > 0) {
      // 更新已有文件
      const existing = DB.one("SELECT * FROM cloud_files WHERE id = ? AND instance_id = ?", [id, instanceId]);
      if (!existing) Response.error('文件不存在或无权编辑');
      const updates = {
        name: name,
        content: content,
        file_size: Buffer.byteLength(String(content), 'utf8'),
        file_type: fileType,
        file_category: fileCategory,
        updated_at: now,
      };
      if ('directory' in body && body.directory !== '') {
        updates.directory = directory;
      }
      DB.update('cloud_files', updates, 'id = ?', [id]);
      Response.success({ id: id, name: name }, '已保存');
    } else {
      // 创建新文件 — 检查同名冲突
      const exists = DB.one(
        "SELECT id FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?",
        [instanceId, directory, name]
      );
      if (exists) Response.error('同名文件已存在');

      const newId = DB.insert('cloud_files', {
        instance_id: instanceId,
        school_id: schoolId,
        directory: directory,
        name: name,
        content: content,
        file_size: Buffer.byteLength(String(content), 'utf8'),
        file_type: fileType,
        file_category: fileCategory,
        status: 'synced',
        created_at: now,
        updated_at: now,
      });

      const u = Auth.user();
      Auth.logAudit(schoolId, u.user_id ?? 0, 'instance_file_create',
        `创建实例文件: ${directory}${name} (实例 uid=${inst.instance_uid})`);
      Response.success({ id: newId, name: name }, '文件已创建');
    }
  }

  // ===== 删除文件 =====
  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const file = DB.one("SELECT * FROM cloud_files WHERE id = ?", [id]);
    if (!file) Response.error('文件不存在');
    if (file.instance_id && !Auth.canWriteInstance(parseInt(file.instance_id, 10) || 0)) {
      Response.error('无权删除该文件', 403, 403);
    }
    DB.delete('cloud_files', 'id = ?', [id]);
    const u = Auth.user();
    Auth.logAudit(file.school_id, u.user_id ?? 0, 'instance_file_delete',
      `删除实例文件: ${file.directory}${file.name}`);
    Response.success(null, '已删除');
  }

  // ===== 存储统计 =====
  if (method === 'GET' && action === 'storage-stats') {
    const instanceId = parseInt(query.instance_id ?? 0, 10) || 0;
    if (instanceId <= 0) Response.error('缺少实例 ID');
    if (!Auth.canAccessInstance(instanceId)) Response.error('无权访问该实例', 403, 403);

    const totalSize = DB.scalar(
      "SELECT COALESCE(SUM(file_size), 0) FROM cloud_files WHERE instance_id = ?",
      [instanceId]
    );
    const fileCount = DB.scalar(
      "SELECT COUNT(*) FROM cloud_files WHERE instance_id = ?",
      [instanceId]
    );
    const categorySizes = DB.all(
      `SELECT file_category, COALESCE(SUM(file_size), 0) AS total_size, COUNT(*) AS file_count
       FROM cloud_files WHERE instance_id = ?
       GROUP BY file_category`,
      [instanceId]
    );

    Response.success({
      total_size: parseInt(totalSize, 10) || 0,
      file_count: parseInt(fileCount, 10) || 0,
      categories: categorySizes,
    });
  }

  // ===== 文件树（含目录结构） =====
  if (method === 'GET' && action === 'file-tree') {
    const instanceId = parseInt(query.instance_id ?? 0, 10) || 0;
    if (instanceId <= 0) Response.error('缺少实例 ID');
    if (!Auth.canAccessInstance(instanceId)) Response.error('无权访问该实例', 403, 403);

    const rows = DB.all(
      `SELECT id, directory, name, file_type, file_category, file_size, status, created_at, updated_at
       FROM cloud_files
       WHERE instance_id = ?
       ORDER BY directory ASC, file_category ASC, name ASC`,
      [instanceId]
    );

    // 构建目录树
    const tree = {};
    const inst = DB.one("SELECT instance_uid FROM instances WHERE id = ?", [instanceId]);
    const baseDir = '/instances/' + (inst ? (inst.instance_uid ?? '') : '') + '/';

    for (const row of rows) {
      let relDir = row.directory;
      if (relDir.startsWith(baseDir)) {
        relDir = relDir.slice(baseDir.length);
      }
      relDir = relDir.replace(/\/+$/, '');

      if (!(relDir in tree)) {
        tree[relDir] = [];
      }
      tree[relDir].push(row);
    }

    Response.success({
      tree: tree,
      base_dir: baseDir,
      total_files: rows.length,
    });
  }

  // ===== 下载文件 =====
  if (method === 'GET' && action === 'download') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (id <= 0) Response.error('缺少文件 ID');
    const file = DB.one("SELECT * FROM cloud_files WHERE id = ?", [id]);
    if (!file) Response.error('文件不存在');
    if (file.instance_id && !Auth.canAccessInstance(parseInt(file.instance_id, 10) || 0)) {
      Response.error('无权下载该文件', 403, 403);
    }
    const content = file.content ?? '';
    const name = file.name ?? 'download';
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="' + addslashes(name) + '"');
    res.set('Content-Length', String(Buffer.byteLength(String(content), 'utf8')));
    res.set('Cache-Control', 'no-cache');
    res.end(content);
    throw new ctx.HttpSent();
  }

  Response.error('未知操作', 405, 405);
};
