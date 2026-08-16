/**
 * 云文件 API（轻编辑器使用）
 * 文件存储在班级主页（web_hosting_files）的 /.cloud/ 隐藏目录下
 * 该目录无法通过 /site/{slug}/.cloud/ 从外部访问
 *
 * 操作：
 *  - GET  action=list                   列出当前用户的云文件
 *  - GET  action=get&id=N              获取云文件内容（id 为 web_hosting_files 的 id）
 *  - POST action=create                 创建云文件
 *  - POST action=update                 更新云文件内容/名称
 *  - POST action=delete                 删除云文件
 */
const { nowStr } = require('../lib/response');
const DB = require('../lib/db');

// 隐藏目录前缀
const CLOUD_PREFIX = '/.cloud/';

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireAlliance();
  const username = Auth.allianceUsername();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  // $body = Helpers::jsonBody(); → body

  // 确保空间存在并获取 spaceId
  const space = ensureCloudSpace(username);
  const spaceId = space.id;

  if (method === 'GET' && action === 'list') {
    const rows = DB.all(
      `SELECT id, file_path, file_size, content_type, created_at, updated_at
       FROM web_hosting_files
       WHERE space_id = ? AND file_path LIKE ? AND is_directory = 0
       ORDER BY file_path ASC`,
      [spaceId, CLOUD_PREFIX + '%']
    );
    // 转换为轻编辑器期望的格式
    const result = rows.map((row) => {
      const name = basename(row.file_path);
      // 检查是否已分享
      const shared = DB.scalar(
        `SELECT COUNT(*) FROM share_items
         WHERE resource_type = 'cloud_file' AND resource_id = ? AND is_deleted = 0`,
        [row.id]
      ) > 0;
      return {
        id: row.id,
        name: name,
        file_path: row.file_path,
        file_type: fileExt(name),
        file_size: row.file_size,
        content_type: row.content_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_shared: shared ? 1 : 0,
        source: 'owned',
      };
    });

    // 获取分享给我的文件
    let userId = 0;
    const user = Auth.user();
    if (user) userId = parseInt(user.user_id ?? 0, 10) || 0;
    if (userId > 0) {
      const sharedRows = DB.all(
        `SELECT DISTINCT whf.*, sup.permission AS shared_permission, si.owner_username AS shared_from
         FROM share_items si
         JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
         JOIN web_hosting_files whf ON whf.id = si.resource_id
         WHERE si.resource_type = 'cloud_file' AND si.is_deleted = 0 AND si.expires_at > datetime('now','localtime')
         ORDER BY whf.file_path ASC`,
        [userId]
      );
      for (const row of sharedRows) {
        const name = basename(row.file_path);
        result.push({
          id: row.id,
          name: name,
          file_path: row.file_path,
          file_type: fileExt(name),
          file_size: row.file_size,
          content_type: row.content_type,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_shared: 0,
          source: 'shared',
          shared_from: row.shared_from,
          shared_permission: row.shared_permission,
        });
      }
    }

    Response.success(result);
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) {
      // 检查是否是分享给我的文件
      const userId = parseInt(Auth.user()?.user_id ?? 0, 10) || 0;
      if (userId > 0) {
        const sharedRow = DB.one(
          `SELECT whf.*, sup.permission AS shared_permission
           FROM web_hosting_files whf
           JOIN share_items si ON si.resource_id = whf.id AND si.resource_type = 'cloud_file' AND si.is_deleted = 0
           JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
           WHERE whf.id = ? AND si.expires_at > datetime('now','localtime')`,
          [userId, id]
        );
        if (sharedRow) {
          // 只读权限时提示
          const isReadOnly = (sharedRow.shared_permission ?? 'view') === 'view';
          Response.success({
            id: sharedRow.id,
            name: basename(sharedRow.file_path),
            file_path: sharedRow.file_path,
            file_type: fileExt(sharedRow.file_path),
            file_size: sharedRow.file_size,
            content: sharedRow.content ?? '',
            content_type: sharedRow.content_type,
            created_at: sharedRow.created_at,
            updated_at: sharedRow.updated_at,
            source: 'shared',
            permission: sharedRow.shared_permission,
          });
        }
      }
      Response.error('云文件不存在');
    }
    Response.success({
      id: row.id,
      name: basename(row.file_path),
      file_path: row.file_path,
      file_type: fileExt(row.file_path),
      file_size: row.file_size,
      content: row.content ?? '',
      content_type: row.content_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: 'owned',
    });
  }

  if (method === 'POST' && action === 'create') {
    let name = String(body.name ?? '').trim();
    const fileType = body.file_type ?? 'json';
    const content = body.content ?? '';

    if (name === '') Response.error('文件名不能为空');
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) Response.error('文件名只能包含字母、数字、下划线、连字符和点');

    // 自动添加扩展名
    if (!name.includes('.')) {
      name += '.' + fileType;
    }

    const filePath = CLOUD_PREFIX + name;
    const now = nowStr();

    // 确保 /.cloud/ 目录存在
    ensureCloudDir(spaceId, now);

    // 检查是否已存在
    const exists = DB.one(
      `SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?`,
      [spaceId, filePath]
    );
    if (exists) Response.error('同名文件已存在');

    const contentSize = Buffer.byteLength(String(content));
    const contentType = guessCloudContentType(name);

    const id = DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: filePath,
      file_size: contentSize,
      content_type: contentType,
      content: content,
      is_directory: 0,
      created_at: now,
      updated_at: now,
    });

    Auth.logAudit(schoolId, 0, 'cloud_file_create', `创建云文件: ${username} -> ${filePath}`);
    Response.success({ id: id, name: name, file_path: filePath }, '云文件已创建');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    let row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) {
      // 检查是否是分享给我的文件（需有编辑权限）
      const userId = parseInt(Auth.user()?.user_id ?? 0, 10) || 0;
      if (userId > 0) {
        const sharedRow = DB.one(
          `SELECT whf.*, sup.permission AS shared_permission
           FROM web_hosting_files whf
           JOIN share_items si ON si.resource_id = whf.id AND si.resource_type = 'cloud_file' AND si.is_deleted = 0
           JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
           WHERE whf.id = ? AND si.expires_at > datetime('now','localtime')`,
          [userId, id]
        );
        if (sharedRow && (sharedRow.shared_permission ?? 'view') === 'edit') {
          row = sharedRow;
        } else {
          Response.error('云文件不存在或无权编辑');
        }
      } else {
        Response.error('云文件不存在');
      }
    }

    const updates = { updated_at: nowStr() };
    if (body.name !== undefined && body.name !== null) {
      const newName = String(body.name).trim();
      if (newName === '') Response.error('文件名不能为空');
      const newPath = CLOUD_PREFIX + newName;
      // 检查新路径是否冲突
      if (newPath !== row.file_path) {
        const conflict = DB.one(
          `SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND id != ?`,
          [spaceId, newPath, id]
        );
        if (conflict) Response.error('同名文件已存在');
        updates.file_path = newPath;
      }
    }
    if (body.content !== undefined && body.content !== null) {
      updates.content = body.content;
      updates.file_size = Buffer.byteLength(String(body.content));
    }
    if (body.file_type !== undefined && body.file_type !== null) {
      updates.content_type = guessCloudContentType(row.file_path);
    }

    DB.update('web_hosting_files', updates, 'id = ?', [id]);
    Response.success(null, '已保存');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) Response.error('云文件不存在');

    DB.delete('web_hosting_files', 'id = ?', [id]);
    Auth.logAudit(schoolId, 0, 'cloud_file_delete', `删除云文件: ${username} -> ${row.file_path}`);
    Response.success(null, '已删除');
  }

  // === 操作记录（history） ===

  if (method === 'POST' && action === 'history-save') {
    const fileId = parseInt(body.file_id ?? 0, 10) || 0;
    const fileName = String(body.file_name ?? '').trim();
    const contentSnapshot = body.content_snapshot ?? '';
    const step = parseInt(body.step ?? 0, 10) || 0;

    if (fileId <= 0) Response.error('缺少 file_id 参数');
    const now = nowStr();

    DB.insert('cloud_file_history', {
      file_id: fileId,
      file_name: fileName,
      content_snapshot: contentSnapshot,
      step: step,
      created_by: username,
      created_at: now,
    });

    // 每个文件最多保留 5 条记录，超出时删除最旧的
    const count = DB.scalar(
      `SELECT COUNT(*) FROM cloud_file_history WHERE file_id = ? AND created_by = ?`,
      [fileId, username]
    );
    if (count > 5) {
      const limit = count - 5;
      DB.delete(
        'cloud_file_history',
        `id IN (SELECT id FROM cloud_file_history WHERE file_id = ? AND created_by = ? ORDER BY created_at ASC LIMIT ?)`,
        [fileId, username, limit]
      );
    }

    Response.success(null, '操作记录已保存');
  }

  if (method === 'GET' && action === 'history-list') {
    const fileId = parseInt(query.file_id ?? 0, 10) || 0;
    if (fileId <= 0) Response.error('缺少 file_id 参数');

    const rows = DB.all(
      `SELECT * FROM cloud_file_history WHERE file_id = ? AND created_by = ? ORDER BY step ASC, created_at ASC LIMIT 5`,
      [fileId, username]
    );

    const result = rows.map((row) => {
      return {
        id: row.id,
        file_id: row.file_id,
        file_name: row.file_name,
        content_snapshot: row.content_snapshot,
        step: row.step,
        created_by: row.created_by,
        created_at: row.created_at,
      };
    });

    Response.success(result);
  }

  if (method === 'POST' && action === 'history-restore') {
    const historyId = parseInt(body.history_id ?? 0, 10) || 0;
    if (historyId <= 0) Response.error('缺少 history_id 参数');

    const row = DB.one(
      `SELECT * FROM cloud_file_history WHERE id = ? AND created_by = ?`,
      [historyId, username]
    );
    if (!row) Response.error('操作记录不存在');

    Response.success({
      id: row.id,
      file_id: row.file_id,
      file_name: row.file_name,
      content_snapshot: row.content_snapshot,
      step: row.step,
      created_at: row.created_at,
    });
  }

  // === 版本管理（version） ===

  if (method === 'POST' && action === 'version-save') {
    const fileId = parseInt(body.file_id ?? 0, 10) || 0;
    const fileName = String(body.file_name ?? '').trim();
    const content = body.content ?? '';
    const versionLabel = String(body.version_label ?? '').trim();

    if (fileId <= 0) Response.error('缺少 file_id 参数');
    const now = nowStr();

    DB.insert('cloud_file_versions', {
      file_id: fileId,
      file_name: fileName,
      content: content,
      version_label: versionLabel,
      created_by: username,
      created_at: now,
    });

    // 每个文件最多保留 10 个版本元数据，但只保留最近 3 个版本的文件内容
    const count = DB.scalar(
      `SELECT COUNT(*) FROM cloud_file_versions WHERE file_id = ? AND created_by = ?`,
      [fileId, username]
    );

    // 清理超出 10 个的版本记录
    if (count > 10) {
      const limit = count - 10;
      DB.delete(
        'cloud_file_versions',
        `id IN (SELECT id FROM cloud_file_versions WHERE file_id = ? AND created_by = ? ORDER BY created_at ASC LIMIT ?)`,
        [fileId, username, limit]
      );
    }

    // 只保留最近 3 个版本的内容，其余清空内容字段
    const allVersions = DB.all(
      `SELECT id FROM cloud_file_versions WHERE file_id = ? AND created_by = ? ORDER BY created_at DESC`,
      [fileId, username]
    );
    const keepContent = 3;
    let index = 0;
    for (const v of allVersions) {
      index++;
      if (index > keepContent) {
        DB.update('cloud_file_versions', { content: null }, 'id = ?', [v.id]);
      }
    }

    Response.success(null, '版本已保存');
  }

  if (method === 'GET' && action === 'version-list') {
    const fileId = parseInt(query.file_id ?? 0, 10) || 0;
    if (fileId <= 0) Response.error('缺少 file_id 参数');

    const rows = DB.all(
      `SELECT id, file_id, file_name, version_label, created_by, created_at FROM cloud_file_versions WHERE file_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 10`,
      [fileId, username]
    );

    const result = rows.map((row) => {
      return {
        id: row.id,
        file_id: row.file_id,
        file_name: row.file_name,
        version_label: row.version_label,
        created_by: row.created_by,
        created_at: row.created_at,
      };
    });

    Response.success(result);
  }

  if (method === 'GET' && action === 'version-get') {
    const versionId = parseInt(query.version_id ?? 0, 10) || 0;
    if (versionId <= 0) Response.error('缺少 version_id 参数');

    const row = DB.one(
      `SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?`,
      [versionId, username]
    );
    if (!row) Response.error('版本不存在');

    Response.success({
      id: row.id,
      file_id: row.file_id,
      file_name: row.file_name,
      content: row.content ?? '',
      version_label: row.version_label,
      created_by: row.created_by,
      created_at: row.created_at,
    });
  }

  // === 存储规则 ===

  if (method === 'GET' && action === 'storage-rules') {
    Response.success({
      history_limit: 5,
      version_limit: 10,
      version_file_limit: 3,
    });
  }

  if (method === 'POST' && action === 'storage-rules-update') {
    const user = Auth.user();
    const isAdmin = (user?.role ?? '') === 'admin' || (user?.role ?? '') === 'super_admin' || (user?.type ?? '') === 'alliance';
    if (!isAdmin) {
      Response.error('仅管理员可更新存储规则');
    }

    const historyLimit = parseInt(body.history_limit ?? 5, 10) || 0;
    const versionLimit = parseInt(body.version_limit ?? 10, 10) || 0;
    const versionFileLimit = parseInt(body.version_file_limit ?? 3, 10) || 0;

    // 存储规则目前返回固定值，如需持久化可存入配置表
    // 这里返回确认后的值
    Response.success({
      history_limit: historyLimit,
      version_limit: versionLimit,
      version_file_limit: versionFileLimit,
    }, '存储规则已更新');
  }

  Response.error('未知的操作');
};

// === 辅助函数 ===

/** basename() 等价 */
function basename(p) {
  return String(p).split('/').pop();
}

/** pathinfo($name, PATHINFO_EXTENSION) 等价（以点开头的隐藏文件无扩展名） */
function fileExt(name) {
  const base = basename(name);
  const pos = base.lastIndexOf('.');
  if (pos <= 0) return '';
  return base.slice(pos + 1);
}

/** htmlspecialchars() 等价（ENT_QUOTES） */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 确保云存储空间存在（复用班级主页的 ensureSpace 逻辑）
function ensureCloudSpace(username)
{
  // 直接复用 web-hosting.php 中的 ensureSpace 逻辑
  let space = DB.one(
    `SELECT * FROM web_hosting_spaces WHERE alliance_username = ?`,
    [username]
  );

  if (!space) {
    let slug = username;
    let counter = 1;
    while (DB.scalar(`SELECT 1 FROM web_hosting_spaces WHERE slug = ?`, [slug])) {
      slug = username + '-' + (counter++);
    }
    const now = nowStr();
    const spaceId = DB.insert('web_hosting_spaces', {
      alliance_username: username,
      slug: slug,
      title: username + ' 的班级主页',
      description: '',
      storage_quota: 100 * 1024 * 1024,
      is_enabled: 1,
      created_at: now,
      updated_at: now,
    });
    space = DB.one(`SELECT * FROM web_hosting_spaces WHERE id = ?`, [spaceId]);

    // 创建默认 index.html
    const defaultHtml = getDefaultCloudIndexHtml(username);
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/index.html',
      file_size: Buffer.byteLength(defaultHtml),
      content_type: 'text/html',
      content: defaultHtml,
      is_directory: 0,
      created_at: now,
      updated_at: now,
    });
  }

  return space;
}

// 确保 /.cloud/ 目录存在
function ensureCloudDir(spaceId, now)
{
  const exists = DB.scalar(
    `SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1`,
    [spaceId, '/.cloud']
  );
  if (!exists) {
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/.cloud',
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

// 根据文件名猜测 MIME 类型
function guessCloudContentType(name)
{
  const ext = fileExt(name).toLowerCase();
  const types = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'mjs': 'application/javascript',
    'json': 'application/json', 'txt': 'text/plain', 'md': 'text/markdown',
    'xml': 'application/xml', 'yaml': 'text/yaml', 'yml': 'text/yaml',
    'csv': 'text/csv', 'php': 'text/plain', 'py': 'text/plain',
    'sql': 'text/plain', 'ts': 'application/javascript',
  };
  return types[ext] ?? 'application/octet-stream';
}

// 默认首页 HTML
function getDefaultCloudIndexHtml(username)
{
  const title = escapeHtml(username + ' 的班级主页');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: white; border-radius: 16px; padding: 48px 32px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); max-width: 500px; width: 100%; text-align: center; }
        h1 { color: #1a1a1a; font-size: 28px; margin-bottom: 16px; }
        p { color: #666; font-size: 16px; line-height: 1.6; }
        .powered { color: #999; font-size: 14px; margin-top: 24px; padding-top: 24px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="card">
        <h1>${title}</h1>
        <p>欢迎来到我的班级主页！</p>
        <div class="powered">Powered by CSES Cloud 智教云</div>
    </div>
</body>
</html>`;
}
