/**
 * CSES Cloud - 班级主页（网页托管）API（NodeJS 版，移植自旧实现）
 */
const { nowStr } = require('../lib/response');

// === 辅助函数（对齐 PHP 文件内函数） ===

/** PHP strlen：字节长度（兼容 Buffer） */
function phpStrlen(v) {
  if (v === null || v === undefined) return 0;
  if (Buffer.isBuffer(v)) return v.length;
  return Buffer.byteLength(String(v), 'utf8');
}

/** BLOB 兼容：Buffer -> utf8 字符串，其余原样返回 */
function blobText(v) {
  return Buffer.isBuffer(v) ? v.toString('utf8') : v;
}

/** PHP pathinfo($p, PATHINFO_EXTENSION) */
function extOf(p) {
  const base = String(p).split('/').pop();
  const pos = base.lastIndexOf('.');
  if (pos <= 0) return '';
  return base.slice(pos + 1);
}

/** PHP basename() */
function phpBasename(p) {
  const s = String(p).replace(/\/+$/, '');
  if (s === '') return '';
  const idx = s.lastIndexOf('/');
  return idx === -1 ? s : s.slice(idx + 1);
}

/** PHP dirname() */
function phpDirname(p) {
  const s = String(p).replace(/\/+$/, '');
  if (s === '') return '/';
  const idx = s.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return s.slice(0, idx);
}

// 标准化路径（确保以 / 开头，不包含末尾斜杠，除了根目录）
function normalizePath(path) {
  path = String(path ?? '').trim();
  if (path === '') {
    return '/';
  }
  // 替换反斜杠为正斜杠
  path = path.split('\\').join('/');
  // 移除多个连续斜杠
  path = path.replace(/\/+/g, '/');
  // 确保以 / 开头
  if (path[0] !== '/') {
    path = '/' + path;
  }
  // 移除末尾斜杠（除非是根目录）
  if (path.length > 1 && path.endsWith('/')) {
    path = path.replace(/\/+$/, '');
  }
  return path;
}

// 根据文件扩展名猜测 MIME 类型
function guessContentType(path) {
  const ext = extOf(path).toLowerCase();
  const types = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'json': 'application/json',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
  };
  return types[ext] ?? 'application/octet-stream';
}

// 确保父目录存在（递归创建）
function ensureDirectoryExists(ctx, spaceId, dirPath, now) {
  const { DB } = ctx;
  dirPath = normalizePath(dirPath);
  if (dirPath === '/') {
    return;
  }

  const exists = DB.scalar(
    "SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1",
    [spaceId, dirPath]
  );
  if (!exists) {
    const parent = phpDirname(dirPath);
    if (parent !== '' && parent !== '.') {
      ensureDirectoryExists(ctx, spaceId, parent, now);
    }
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: dirPath,
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

// 构建文件树形结构
function buildFileTree(files) {
  const tree = {
    name: '/',
    path: '/',
    is_directory: true,
    children: [],
  };

  for (const file of files) {
    const parts = String(file.file_path).replace(/^\/+|\/+$/g, '').split('/');
    let current = tree;
    let currentPath = '';

    parts.forEach((part, i) => {
      currentPath += '/' + part;
      if (i === parts.length - 1) {
        // 叶子节点
        current.children.push({
          name: part,
          path: currentPath,
          is_directory: !!file.is_directory,
          size: file.file_size,
          content_type: file.content_type,
          updated_at: file.updated_at,
          children: [],
        });
      } else {
        // 中间节点（目录），检查是否已存在
        let found = null;
        for (const child of current.children) {
          if (child.name === part && child.is_directory) {
            current = child;
            found = child;
            break;
          }
        }
        if (!found) {
          // 创建目录节点
          const newDir = {
            name: part,
            path: currentPath,
            is_directory: true,
            children: [],
          };
          current.children.push(newDir);
          current = newDir;
        }
      }
    });
  }

  return tree;
}

// 确保空间存在，返回空间记录（自动创建）
function ensureSpace(ctx, username) {
  const { DB, Auth } = ctx;
  let space = DB.one(
    "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
    [username]
  );

  if (!space) {
    // 自动创建初始空间
    let slug = username;
    // 确保 slug 唯一（如果重复，添加数字后缀）
    let counter = 1;
    while (DB.scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ?", [slug])) {
      slug = username + '-' + (counter++);
    }

    const now = nowStr();
    const spaceId = DB.insert('web_hosting_spaces', {
      alliance_username: username,
      slug: slug,
      title: username + ' 的班级主页',
      description: '',
      storage_quota: 100 * 1024 * 1024, // 100MB
      is_enabled: 1,
      created_at: now,
      updated_at: now,
    });

    space = DB.one("SELECT * FROM web_hosting_spaces WHERE id = ?", [spaceId]);

    // 创建默认 index.html
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/index.html',
      file_size: 0,
      content_type: 'text/html',
      content: getDefaultIndexHtml(ctx, username),
      is_directory: 0,
      created_at: now,
      updated_at: now,
    });

    Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_create', `创建网页空间: ${username}`);
  }

  return space;
}

// 默认首页 HTML
function getDefaultIndexHtml(ctx, username) {
  const { req, Helpers } = ctx;
  const title = Helpers.e(username + ' 的班级主页');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 16px;
            padding: 48px 32px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        h1 {
            color: #1a1a1a;
            font-size: 28px;
            margin-bottom: 16px;
        }
        p {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
        }
        .powered {
            color: #999;
            font-size: 14px;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #eee;
        }
        .btn {
            display: inline-block;
            background: #667eea;
            color: white;
            text-decoration: none;
            padding: 12px 32px;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s;
        }
        .btn:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>${title}</h1>
        <p>欢迎来到我的班级主页！这是一个由 CSES Cloud 提供的免费网页托管空间。</p>
        <a href="https://${req.headers.host}/console/web-homepage" target="_blank" class="btn">开始编辑</a>
        <div class="powered">
            Powered by CSES Cloud 智教云
        </div>
    </div>
</body>
</html>`;
}

// 获取当前用户空间信息（自动创建如果不存在）
function getSpace(ctx, username) {
  const { DB, Response } = ctx;
  const space = ensureSpace(ctx, username);
  // 查询审查状态
  const pendingCount = DB.scalar(
    "SELECT COUNT(*) FROM web_hosting_files WHERE space_id = ? AND review_status = 'pending_review' AND is_directory = 0",
    [space.id]
  ) || 0;
  Response.success({
    ...space,
    pending_review_count: pendingCount,
  });
}

// 更新空间信息
function updateSpace(ctx, username) {
  const { DB, Auth, Response, Helpers } = ctx;
  const data = ctx.body; // Helpers::jsonBody()
  const space = ensureSpace(ctx, username);

  const isset = (k) => data[k] !== undefined && data[k] !== null;
  const update = {};
  if (isset('title')) {
    update.title = String(data.title).trim();
  }
  if (isset('description')) {
    update.description = String(data.description).trim();
  }
  if (isset('slug')) {
    const slug = String(data.slug).trim();
    if (!/^[a-z0-9-]+$/i.test(slug)) {
      Response.error('路径别名只能包含字母、数字和连字符');
    }
    // 检查 slug 是否被其他用户占用
    const exists = DB.scalar(
      "SELECT 1 FROM web_hosting_spaces WHERE slug = ? AND alliance_username != ?",
      [slug, username]
    );
    if (exists) {
      Response.error('该路径别名已被占用，请选择其他名称');
    }
    update.slug = slug;
  }
  if (isset('is_enabled')) {
    // 如果被管理员禁用，用户不能自行启用
    if (space.disabled_by_admin && !Helpers.empty(data.is_enabled)) {
      Response.error('您的网页空间已被管理员停用，无法自行启用。请编辑新版本等待管理员审查。');
    }
    update.is_enabled = Helpers.empty(data.is_enabled) ? 0 : 1;
  }

  update.updated_at = nowStr();

  if (!Helpers.empty(update)) {
    DB.update(
      'web_hosting_spaces',
      update,
      'alliance_username = ?',
      [username]
    );
    Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_update', `更新网页空间配置: ${username}`);
  }

  Response.success({
    ok: true,
    space: DB.one(
      "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
      [username]
    ),
  });
}

// 列出文件（树形结构）
function listFiles(ctx, username) {
  const { DB, Response } = ctx;
  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const files = DB.all(
    "SELECT id, space_id, file_path, file_size, content_type, review_status, is_directory, created_at, updated_at \
     FROM web_hosting_files WHERE space_id = ? AND file_path NOT LIKE '/.published%' \
     ORDER BY file_path ASC",
    [spaceId]
  );

  // 构建树形结构
  const tree = buildFileTree(files);
  Response.success({
    files: files,
    tree: tree,
  });
}

// 获取文件内容
function getFile(ctx, username) {
  const { DB, Response, Helpers } = ctx;
  const data = ctx.body; // Helpers::jsonBody()
  const filePath = normalizePath(data.path ?? '');
  if (Helpers.empty(filePath)) {
    Response.error('缺少文件路径');
  }

  // 确保空间存在（与 getSpace 一致，自动创建）
  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const file = DB.one(
    "SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
    [spaceId, normalizePath(filePath)]
  );

  if (!file) {
    // 调试：列出当前空间所有文件，帮助定位问题
    const allFiles = DB.all(
      "SELECT file_path FROM web_hosting_files WHERE space_id = ?",
      [spaceId]
    );
    const paths = allFiles.map(f => f.file_path);
    Response.error(`文件不存在: ${normalizePath(filePath)} (space_id=${spaceId}, 现有文件: ${paths.join(', ') || '无'})`, 404);
  }

  Response.success({
    id: file.id,
    file_path: file.file_path,
    file_size: file.file_size,
    content_type: file.content_type,
    content: file.is_directory ? '' : blobText(file.content),
    is_directory: file.is_directory,
    review_status: file.review_status || 'published',
    published_size: file.published_size || 0,
    updated_at: file.updated_at,
  });
}

// 保存文件（新建或覆盖）
function saveFile(ctx, username) {
  const { DB, Auth, Response, Helpers } = ctx;
  const data = ctx.body; // Helpers::jsonBody()
  const filePath = normalizePath(data.path ?? '');
  const content = data.content ?? '';
  const contentType = data.content_type ?? guessContentType(filePath);

  if (Helpers.empty(filePath)) {
    Response.error('缺少文件路径');
  }

  if (filePath === '/') {
    Response.error('不能保存到根路径');
  }

  // 禁止编辑 /.published/ 目录下的已公开版本文件
  if (filePath.startsWith('/.published')) {
    Response.error('已公开版本文件不可编辑，仅可查看或删除');
  }

  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  // 检查配额
  const contentSize = typeof content === 'string' ? phpStrlen(content) : 0;
  let currentUsage = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
    [spaceId]
  ) ?? 0, 10) || 0;
  // 如果是更新已有文件，减去原文件大小
  const existing = DB.one(
    "SELECT file_size FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
    [spaceId, filePath]
  );
  if (existing) {
    currentUsage -= existing.file_size;
  }
  if (currentUsage + contentSize > space.storage_quota) {
    Response.error('存储空间不足，请清理文件后重试');
  }

  const now = nowStr();

  if (existing) {
    // 更新
    DB.update(
      'web_hosting_files',
      {
        file_size: contentSize,
        content_type: contentType,
        content: content,
        review_status: 'pending_review',
        updated_at: now,
      },
      'space_id = ? AND file_path = ?',
      [spaceId, filePath]
    );
    Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_update_file', `更新文件: ${username}${filePath}`);
  } else {
    // 确保父目录存在
    const parentPath = phpDirname(filePath);
    if (parentPath !== '' && parentPath !== '.') {
      ensureDirectoryExists(ctx, spaceId, parentPath, now);
    }

    // 新建
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: filePath,
      file_size: contentSize,
      content_type: contentType,
      content: content,
      is_directory: 0,
      review_status: 'pending_review',
      created_at: now,
      updated_at: now,
    });
    Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_create_file', `创建文件: ${username}${filePath}`);
  }

  // 标记空间为待审查
  DB.update('web_hosting_spaces', { review_status: 'pending_review', updated_at: now }, 'id = ?', [spaceId]);

  // 验证：读取刚保存的内容确认持久化成功
  const saved = DB.one(
    "SELECT file_size, content FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
    [spaceId, filePath]
  );
  const actualSize = saved ? phpStrlen(saved.content ?? '') : -1;

  Response.success({
    ok: true,
    size: contentSize,
    actual_size: actualSize,
    path: filePath,
    space_id: spaceId,
  });
}

// 删除文件
function deleteFile(ctx, username) {
  const { DB, Auth, Response, Helpers } = ctx;
  const data = ctx.body; // Helpers::jsonBody()
  const filePath = normalizePath(data.path ?? '');

  if (Helpers.empty(filePath)) {
    Response.error('缺少文件路径');
  }

  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const file = DB.one(
    "SELECT is_directory FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
    [spaceId, filePath]
  );

  if (!file) {
    Response.error('文件不存在');
  }

  if (file.is_directory) {
    // 删除目录及所有子文件
    const prefix = String(filePath).replace(/\/+$/, '') + '/';
    DB.delete(
      'web_hosting_files',
      'space_id = ? AND (file_path = ? OR file_path LIKE ?)',
      [spaceId, filePath, prefix + '%']
    );
    Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_delete_dir', `删除目录: ${username}${filePath}`);
  } else {
    DB.delete(
      'web_hosting_files',
      'space_id = ? AND file_path = ?',
      [spaceId, filePath]
    );
    Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_delete_file', `删除文件: ${username}${filePath}`);
  }

  Response.success({ ok: true });
}

// 创建目录
function createDirectory(ctx, username) {
  const { DB, Auth, Response, Helpers } = ctx;
  const data = ctx.body; // Helpers::jsonBody()
  const dirPath = normalizePath(data.path ?? '');

  if (Helpers.empty(dirPath) || dirPath === '/') {
    Response.error('目录路径无效');
  }

  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const exists = DB.scalar(
    "SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
    [spaceId, dirPath]
  );
  if (exists) {
    Response.error('目录已存在');
  }

  // 确保父目录存在
  const parentPath = phpDirname(dirPath);
  const now = nowStr();
  if (parentPath !== '' && parentPath !== '.') {
    ensureDirectoryExists(ctx, spaceId, parentPath, now);
  }

  DB.insert('web_hosting_files', {
    space_id: spaceId,
    file_path: dirPath,
    file_size: 0,
    content_type: null,
    content: null,
    is_directory: 1,
    created_at: now,
    updated_at: now,
  });

  Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_create_dir', `创建目录: ${username}${dirPath}`);
  Response.success({ ok: true });
}

// 获取存储使用情况
function getUsage(ctx, username) {
  const { DB, Response } = ctx;
  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const used = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
    [spaceId]
  ) ?? 0, 10) || 0;
  const fileCount = parseInt(DB.scalar(
    "SELECT COUNT(*) FROM web_hosting_files WHERE space_id = ? AND is_directory = 0",
    [spaceId]
  ) ?? 0, 10) || 0;

  Response.success({
    used_bytes: used,
    quota_bytes: space.storage_quota,
    remaining_bytes: space.storage_quota - used,
    used_percent: space.storage_quota > 0 ? Math.round((used / space.storage_quota) * 1000) / 10 : 0,
    file_count: fileCount,
  });
}

// 上传文件
function uploadFile(ctx, username) {
  const { DB, Auth, Response, Helpers } = ctx;
  if (Helpers.empty(ctx.files.file)) {
    Response.error('未选择文件');
  }

  const file = ctx.files.file;
  const dir = Helpers.input('dir', '/');

  if (file.error !== 0) {
    Response.error('文件上传失败，错误代码: ' + file.error);
  }

  const name = phpBasename(file.name);
  const targetPath = normalizePath(String(dir).replace(/\/+$/, '') + '/' + name);

  // 禁止上传到 /.published/ 目录
  if (targetPath.startsWith('/.published')) {
    Response.error('已公开版本文件不可编辑，仅可查看或删除');
  }

  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const content = file.tmp_name; // 内存 Buffer，即 PHP file_get_contents($file['tmp_name'])
  const contentSize = phpStrlen(content);
  const contentType = file.type || guessContentType(name);

  // 检查配额
  let currentUsage = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
    [spaceId]
  ) ?? 0, 10) || 0;
  const existing = DB.one(
    "SELECT file_size FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
    [spaceId, targetPath]
  );
  if (existing) {
    currentUsage -= existing.file_size;
  }
  if (currentUsage + contentSize > space.storage_quota) {
    Response.error('存储空间不足，请清理文件后重试');
  }

  const now = nowStr();

  if (existing) {
    DB.update('web_hosting_files', {
      file_size: contentSize,
      content_type: contentType,
      content: content,
      review_status: 'pending_review',
      updated_at: now,
    }, 'space_id = ? AND file_path = ?', [spaceId, targetPath]);
  } else {
    const parentPath = phpDirname(targetPath);
    if (parentPath !== '' && parentPath !== '.') {
      ensureDirectoryExists(ctx, spaceId, parentPath, now);
    }
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: targetPath,
      file_size: contentSize,
      content_type: contentType,
      content: content,
      is_directory: 0,
      review_status: 'pending_review',
      created_at: now,
      updated_at: now,
    });
  }

  // 标记空间为待审查
  DB.update('web_hosting_spaces', { review_status: 'pending_review', updated_at: now }, 'id = ?', [spaceId]);

  Auth.logAudit(Auth.schoolId(), 0, 'web_hosting_upload', `上传文件: ${username}${targetPath}`);
  Response.success({
    ok: true,
    path: targetPath,
    size: contentSize,
  });
}

// 下载文件
function downloadFile(ctx, username) {
  const { req, res, DB, Response, Helpers } = ctx;
  let filePath = Helpers.input('path', '');
  if (Helpers.empty(filePath)) {
    const data = ctx.body; // Helpers::jsonBody()
    filePath = data.path ?? '';
  }
  filePath = normalizePath(filePath);
  if (Helpers.empty(filePath) || filePath === '/') {
    Response.error('缺少文件路径');
  }

  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const file = DB.one(
    "SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0",
    [spaceId, filePath]
  );

  if (!file) {
    Response.error('文件不存在', 404);
  }

  const contentType = file.content_type ?? 'application/octet-stream';
  const fileName = phpBasename(filePath);
  const content = file.content ?? '';

  res.set('Content-Type', contentType);
  res.set('Content-Disposition', 'attachment; filename="' + fileName + '"');
  res.set('Content-Length', String(phpStrlen(content)));
  res.set('Cache-Control', 'no-cache');
  res.end(Buffer.isBuffer(content) ? content : String(content));
  throw new ctx.HttpSent();
}

// 获取审查状态（用户查看自己的空间审查状态）
function getReviewStatus(ctx, username) {
  const { DB, Response } = ctx;
  const space = ensureSpace(ctx, username);
  const spaceId = space.id;

  const pendingFiles = DB.all(
    "SELECT id, file_path, file_size, published_size, review_status, updated_at FROM web_hosting_files WHERE space_id = ? AND review_status = 'pending_review' AND is_directory = 0",
    [spaceId]
  );

  Response.success({
    space_id: spaceId,
    review_status: space.review_status || 'published',
    disabled_by_admin: space.disabled_by_admin || 0,
    disabled_reason: space.disabled_reason || '',
    pending_files: pendingFiles,
    pending_count: pendingFiles.length,
  });
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  // 必须是智教联盟登录用户
  Auth.requireAlliance();
  const username = Auth.allianceUsername();
  const action = Helpers.input('action', '');

  switch (action) {
    case 'get':
      // 获取当前用户的空间信息
      getSpace(ctx, username);
      break;

    case 'update':
      // 更新空间信息
      updateSpace(ctx, username);
      break;

    case 'list-files':
      // 列出文件
      listFiles(ctx, username);
      break;

    case 'get-file':
      // 获取文件内容
      getFile(ctx, username);
      break;

    case 'save-file':
      // 保存文件
      saveFile(ctx, username);
      break;

    case 'delete-file':
      // 删除文件
      deleteFile(ctx, username);
      break;

    case 'create-directory':
      // 创建目录
      createDirectory(ctx, username);
      break;

    case 'usage':
      // 获取存储空间使用情况
      getUsage(ctx, username);
      break;

    case 'upload':
      // 上传文件
      uploadFile(ctx, username);
      break;

    case 'download':
      // 下载文件
      downloadFile(ctx, username);
      break;

    case 'get-review-status':
      // 获取审查状态
      getReviewStatus(ctx, username);
      break;

    default:
      Response.error('未知操作');
  }
};
