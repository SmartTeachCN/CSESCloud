/**
 * 数据空间 API（NodeJS 版，移植自旧实现）
 * 统一管理用户在服务器上活动产生的所有文件
 */
const { nowStr } = require('../lib/response');

// ===== 系统目录定义 =====
// V3：实例文件目录已移除（实例文件不再出现在数据空间）
const DS_CLOUD = '/云文件';
const DS_WEBSPACES = '/网页空间';
const DS_VERSIONS = '/版本历史';
const DS_HISTORY = '/操作记录';

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

function ensureDataSpace(DB, username) {
  let space = DB.one(
    "SELECT * FROM web_hosting_spaces WHERE alliance_username = ? AND (is_web_space IS NULL OR is_web_space = 0)",
    [username]
  );
  if (space) return space;

  // 为兼容旧数据，查找第一个非 web_space 的空间
  space = DB.one(
    "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
    [username]
  );
  if (space) return space;

  const slug = username;
  const now = nowStr();
  const spaceId = DB.insert('web_hosting_spaces', {
    alliance_username: username,
    slug: slug,
    title: username + ' 的数据空间',
    description: '',
    storage_quota: 10 * 1024 * 1024, // 10MB
    is_enabled: 1,
    is_web_space: 0,
    created_at: now,
    updated_at: now,
  });
  return DB.one("SELECT * FROM web_hosting_spaces WHERE id = ?", [spaceId]);
}

/** 检查数据空间配额，超出时抛出错误 */
function checkQuota(ctx, username, schoolId) {
  const { DB, Response } = ctx;
  const space = ensureDataSpace(DB, username);
  const spaceId = space.id;
  const quota = space.storage_quota || (10 * 1024 * 1024);

  const webHostingUsed = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
    [spaceId]
  ) ?? 0, 10) || 0;
  const instanceStorageUsed = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM instance_storage_data isd \
     JOIN instances i ON i.id = isd.instance_id \
     WHERE i.school_id = ?",
    [schoolId]
  ) ?? 0, 10) || 0;
  const versionUsed = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(LENGTH(content)), 0) FROM cloud_file_versions WHERE created_by = ?",
    [username]
  ) ?? 0, 10) || 0;
  const historyUsed = parseInt(DB.scalar(
    "SELECT COALESCE(SUM(LENGTH(content_snapshot)), 0) FROM cloud_file_history WHERE created_by = ?",
    [username]
  ) ?? 0, 10) || 0;

  const totalUsed = webHostingUsed + instanceStorageUsed + versionUsed + historyUsed;
  if (totalUsed >= quota) {
    const usedDisplay = formatBytes(totalUsed);
    const quotaDisplay = formatBytes(quota);
    Response.error(`数据空间已满（${usedDisplay} / ${quotaDisplay}），请清理数据空间后再继续操作`);
  }
}

function normalizePath(path) {
  path = String(path ?? '').trim();
  if (path === '') return '/';
  path = path.split('\\').join('/');
  path = path.replace(/\/+/g, '/');
  if (path[0] !== '/') path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
  return path;
}

function ensureDirExists(DB, spaceId, dirPath, now) {
  dirPath = normalizePath(dirPath);
  if (dirPath === '/') return;
  const exists = DB.scalar("SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1", [spaceId, dirPath]);
  if (!exists) {
    const parent = phpDirname(dirPath);
    if (parent !== '.' && parent !== '/') ensureDirExists(DB, spaceId, parent, now);
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

function guessContentType(path) {
  const ext = extOf(path).toLowerCase();
  const types = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'mjs': 'application/javascript',
    'json': 'application/json', 'txt': 'text/plain', 'md': 'text/markdown',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
    'pdf': 'application/pdf', 'zip': 'application/zip',
  };
  return types[ext] ?? 'application/octet-stream';
}

function formatBytes(bytes) {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (Math.round((bytes / Math.pow(k, i)) * 10) / 10) + ' ' + (sizes[i] ?? '');
}

/** 递归构建网页空间文件树（对齐 PHP buildWsTree） */
function buildWsTree(parentPath, dirMap, wsPrefix) {
  const result = [];
  const items = dirMap[parentPath] ?? [];
  for (const f of items) {
    const childPath = f.file_path;
    const isPublished = childPath.startsWith('/.published');
    const child = {
      name: isPublished && childPath === '/.published' ? '最后允许公开的版本' : phpBasename(childPath),
      path: wsPrefix + '/' + childPath.replace(/^\/+/, ''),
      is_directory: !!f.is_directory,
      size: f.file_size,
      file_type: f.is_directory ? null : extOf(childPath),
      updated_at: f.updated_at,
      source: 'webspace_file',
      file_id: f.id,
      space_id: f.space_id ?? null,
      real_path: childPath,
      protected: isPublished && !f.is_directory, // 文件只读，目录可展开
    };
    if (f.is_directory && dirMap[childPath]) {
      child.children = buildWsTree(childPath, dirMap, wsPrefix);
    }
    result.push(child);
  }
  return result;
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireAlliance();
  const username = Auth.allianceUsername();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  // $body = Helpers::jsonBody() → ctx.body（框架已解析）

  const systemDirs = [DS_CLOUD, DS_WEBSPACES, DS_VERSIONS, DS_HISTORY];
  void systemDirs;

  // ===== 列出文件树 =====
  if (method === 'GET' && action === 'tree') {
    const nodes = [];

    // 1. 云文件目录（轻编辑器）
    const space = ensureDataSpace(DB, username);
    const spaceId = space.id;
    const cloudFiles = DB.all(
      "SELECT id, file_path, file_size, content_type, created_at, updated_at \
       FROM web_hosting_files \
       WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND is_directory = 0 \
       ORDER BY file_path ASC",
      [spaceId]
    );
    const cloudChildren = [];
    for (const cf of cloudFiles) {
      const name = phpBasename(cf.file_path);
      cloudChildren.push({
        name: name,
        path: DS_CLOUD + '/' + name,
        is_directory: false,
        size: cf.file_size,
        file_type: extOf(name),
        updated_at: cf.updated_at,
        source: 'cloud_file',
        file_id: cf.id,
        real_path: cf.file_path,
      });
    }
    nodes.push({
      name: '云文件',
      path: DS_CLOUD,
      is_directory: true,
      source: 'system',
      badge: '轻编辑器',
      protected: true,
      children: cloudChildren,
    });

    // 2. 网页空间目录
    const webSpaces = DB.all(
      "SELECT * FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1 \
       ORDER BY created_at DESC",
      [username]
    );
    const webSpaceChildren = [];
    for (const ws of webSpaces) {
      const wsId = ws.id;
      const wsFiles = DB.all(
        "SELECT id, file_path, file_size, content_type, is_directory, created_at, updated_at \
         FROM web_hosting_files \
         WHERE space_id = ? AND file_path NOT LIKE '/.cloud/%' \
         ORDER BY file_path ASC",
        [wsId]
      );

      const wsFileChildren = [];
      // 空间配置虚拟文件
      wsFileChildren.push({
        name: '空间配置',
        path: DS_WEBSPACES + '/' + ws.title + '/空间配置',
        is_directory: false,
        size: 0,
        file_type: 'config',
        updated_at: ws.updated_at,
        source: 'webspace_config',
        space_id: wsId,
        space_data: {
          title: ws.title,
          description: ws.description,
          slug: ws.slug,
          is_enabled: ws.is_enabled,
        },
      });
      // 构建文件树
      const dirMap = {};
      for (const f of wsFiles) {
        const path = f.file_path;
        if (path === '/.cloud' && f.is_directory) continue; // 跳过隐藏目录
        let parent = phpDirname(path);
        if (parent === '.') parent = '/';
        if (!dirMap[parent]) dirMap[parent] = [];
        dirMap[parent].push(f);
      }

      const wsPrefixPath = DS_WEBSPACES + '/' + ws.title;
      wsFileChildren.push(...buildWsTree('/', dirMap, wsPrefixPath));

      webSpaceChildren.push({
        name: ws.title,
        path: DS_WEBSPACES + '/' + ws.title,
        is_directory: true,
        source: 'webspace',
        space_id: wsId,
        children: wsFileChildren,
      });
    }
    nodes.push({
      name: '网页空间',
      path: DS_WEBSPACES,
      is_directory: true,
      source: 'system',
      badge: '网页托管',
      protected: false,
      children: webSpaceChildren,
    });

    // 3. 版本历史目录
    const versions = DB.all(
      "SELECT cv.id, cv.file_id, cv.file_name, cv.version_label, cv.created_at \
       FROM cloud_file_versions cv \
       WHERE cv.created_by = ? \
       ORDER BY cv.created_at DESC LIMIT 50",
      [username]
    );
    const versionChildren = [];
    for (const v of versions) {
      versionChildren.push({
        name: v.file_name + ' - ' + v.version_label + ' (' + v.created_at + ')',
        path: DS_VERSIONS + '/' + v.id,
        is_directory: false,
        size: 0,
        file_type: 'version',
        updated_at: v.created_at,
        source: 'version_record',
        version_id: v.id,
        file_id: v.file_id,
      });
    }
    nodes.push({
      name: '版本历史',
      path: DS_VERSIONS,
      is_directory: true,
      source: 'system',
      badge: '版本记录',
      protected: true,
      children: versionChildren,
    });

    // 4. 操作记录目录
    const historyChildren = [];

    // 4a. Global 全局操作日志（所有平台操作，来自 audit_logs）
    const globalLogs = DB.all(
      "SELECT id, username, action, target, status, created_at \
       FROM audit_logs \
       WHERE school_id = ? \
       ORDER BY id DESC LIMIT 100",
      [schoolId]
    );
    const globalChildren = [];
    for (const g of globalLogs) {
      const label = (g.username || 'system') + ' - ' + (g.action || '') + ' - ' + (g.target || '');
      globalChildren.push({
        name: label + ' (' + g.created_at + ')',
        path: DS_HISTORY + '/Global/' + g.id,
        is_directory: false,
        size: 0,
        file_type: 'global_log',
        updated_at: g.created_at,
        source: 'global_log',
        log_id: g.id,
        log_data: { username: g.username, action: g.action, target: g.target, status: g.status, created_at: g.created_at },
      });
    }
    historyChildren.push({
      name: 'Global',
      path: DS_HISTORY + '/Global',
      is_directory: true,
      source: 'global_logs_folder',
      badge: '全局操作',
      protected: true,
      children: globalChildren,
    });

    // 4b. 文件操作记录（来自 cloud_operation_logs）
    const fileHistories = DB.all(
      "SELECT id, file_id, file_name, action_type, action_label, created_at \
       FROM cloud_operation_logs \
       WHERE created_by = ? \
       ORDER BY created_at DESC LIMIT 50",
      [username]
    );
    const fileHistoryChildren = [];
    for (const h of fileHistories) {
      fileHistoryChildren.push({
        name: (h.file_name || '') + ' - ' + (h.action_label || h.action_type) + ' (' + h.created_at + ')',
        path: DS_HISTORY + '/文件操作/' + h.id,
        is_directory: false,
        size: 0,
        file_type: 'history',
        updated_at: h.created_at,
        source: 'history_record',
        history_id: h.id,
        file_id: h.file_id,
      });
    }
    if (fileHistoryChildren.length > 0) {
      historyChildren.push({
        name: '文件操作',
        path: DS_HISTORY + '/文件操作',
        is_directory: true,
        source: 'file_history_folder',
        badge: '文件操作',
        protected: true,
        children: fileHistoryChildren,
      });
    }

    nodes.push({
      name: '操作记录',
      path: DS_HISTORY,
      is_directory: true,
      source: 'system',
      badge: '操作记录',
      protected: true,
      children: historyChildren,
    });

    Response.success({ nodes: nodes });
  }

  // ===== 获取文件内容 =====
  if (method === 'GET' && action === 'get') {
    const path = String(query.path ?? '').trim();
    const source = String(query.source ?? '').trim();
    if (Helpers.empty(path)) Response.error('缺少文件路径');

    // V3：实例配置/实例文件来源已移除

    // 云文件
    if (source === 'cloud_file') {
      const fileId = parseInt(query.file_id ?? 0, 10) || 0;
      const space = ensureDataSpace(DB, username);
      const file = DB.one(
        "SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE '/.cloud/%'",
        [fileId, space.id]
      );
      if (!file) Response.error('文件不存在');
      Response.success({
        content: blobText(file.content) ?? '',
        file_type: extOf(file.file_path),
        source: 'cloud_file',
        file_id: file.id,
      });
    }

    // 网页空间配置
    if (source === 'webspace_config') {
      const spaceId = parseInt(query.space_id ?? 0, 10) || 0;
      const ws = DB.one(
        "SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1",
        [spaceId, username]
      );
      if (!ws) Response.error('网页空间不存在');
      Response.success({
        content: JSON.stringify({
          title: ws.title,
          description: ws.description,
          slug: ws.slug,
          is_enabled: ws.is_enabled,
        }, null, 4),
        file_type: 'config',
        source: 'webspace_config',
        space_id: ws.id,
        space_data: ws,
      });
    }

    // 网页空间文件
    if (source === 'webspace_file') {
      const fileId = parseInt(query.file_id ?? 0, 10) || 0;
      const file = DB.one(
        "SELECT whf.* FROM web_hosting_files whf \
         JOIN web_hosting_spaces whs ON whs.id = whf.space_id \
         WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
        [fileId, username]
      );
      if (!file) Response.error('文件不存在');
      Response.success({
        content: blobText(file.content) ?? '',
        file_type: extOf(file.file_path),
        source: 'webspace_file',
        file_id: file.id,
      });
    }

    // 版本历史
    if (source === 'version_record') {
      const versionId = parseInt(query.version_id ?? 0, 10) || 0;
      const v = DB.one(
        "SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?",
        [versionId, username]
      );
      if (!v) Response.error('版本记录不存在');
      Response.success({
        content: blobText(v.content) ?? '(内容已归档)',
        file_type: 'version',
        source: 'version_record',
        version_id: v.id,
      });
    }

    // 全局操作日志
    if (source === 'global_log') {
      const logId = parseInt(query.log_id ?? 0, 10) || 0;
      const g = DB.one(
        "SELECT * FROM audit_logs WHERE id = ? AND school_id = ?",
        [logId, schoolId]
      );
      if (!g) Response.error('操作日志不存在');
      Response.success({
        content: JSON.stringify({
          username: g.username,
          action: g.action,
          target: g.target,
          status: g.status,
          ip: g.ip,
          created_at: g.created_at,
        }, null, 2),
        file_type: 'global_log',
        source: 'global_log',
        log_id: g.id,
      });
    }

    // 操作记录
    if (source === 'history_record') {
      const historyId = parseInt(query.history_id ?? 0, 10) || 0;
      const h = DB.one(
        "SELECT * FROM cloud_operation_logs WHERE id = ? AND created_by = ?",
        [historyId, username]
      );
      if (!h) Response.error('操作记录不存在');
      Response.success({
        content: blobText(h.content_snapshot) ?? '',
        file_type: 'history',
        source: 'history_record',
        history_id: h.id,
      });
    }

    Response.error('未知的文件来源');
  }

  // ===== 保存云文件内容 =====
  if (method === 'POST' && action === 'save') {
    checkQuota(ctx, username, schoolId);
    const path = String(body.path ?? '').trim();
    const source = String(body.source ?? '').trim();
    const content = body.content ?? '';

    // 云文件保存
    if (source === 'cloud_file') {
      const fileId = parseInt(body.file_id ?? 0, 10) || 0;
      const space = ensureDataSpace(DB, username);
      const file = DB.one(
        "SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE '/.cloud/%'",
        [fileId, space.id]
      );
      if (!file) Response.error('文件不存在');
      const now = nowStr();
      DB.update('web_hosting_files', {
        content: content,
        file_size: phpStrlen(content),
        updated_at: now,
      }, 'id = ?', [fileId]);
      Response.success({ ok: true, size: phpStrlen(content) }, '已保存');
    }

    // 网页空间文件保存
    if (source === 'webspace_file') {
      const fileId = parseInt(body.file_id ?? 0, 10) || 0;
      const file = DB.one(
        "SELECT whf.*, whs.id AS space_id FROM web_hosting_files whf \
         JOIN web_hosting_spaces whs ON whs.id = whf.space_id \
         WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
        [fileId, username]
      );
      if (!file) Response.error('文件不存在');
      // 禁止编辑 /.published/ 目录下的文件
      if (String(file.file_path).startsWith('/.published')) {
        Response.error('已公开版本文件不可编辑，仅可查看或删除');
      }
      const now = nowStr();
      DB.update('web_hosting_files', {
        content: content,
        file_size: phpStrlen(content),
        review_status: 'pending_review',
        updated_at: now,
      }, 'id = ?', [fileId]);
      // 标记空间为待审查
      DB.update('web_hosting_spaces', { review_status: 'pending_review', updated_at: now }, 'id = ?', [file.space_id]);
      Response.success({ ok: true, size: phpStrlen(content) }, '已保存');
    }

    // V3：实例文件保存已移除

    Response.error('不支持保存此类型文件');
  }

  // ===== 删除文件/目录 =====
  if (method === 'POST' && action === 'delete') {
    const path = String(body.path ?? '').trim();
    const source = String(body.source ?? '').trim();

    // 检查是否系统目录
    if (source === 'system') {
      Response.error('系统目录不可删除');
    }

    // V3：实例目录删除已移除（实例管理不在数据空间）

    // 网页空间
    if (source === 'webspace') {
      const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
      const ws = DB.one(
        "SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1",
        [spaceId, username]
      );
      if (!ws) Response.error('网页空间不存在');
      DB.delete('web_hosting_files', 'space_id = ?', [spaceId]);
      DB.delete('web_hosting_spaces', 'id = ?', [spaceId]);
      Response.success(null, '网页空间已删除');
    }

    // 云文件
    if (source === 'cloud_file') {
      const fileId = parseInt(body.file_id ?? 0, 10) || 0;
      const space = ensureDataSpace(DB, username);
      const file = DB.one(
        "SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE '/.cloud/%'",
        [fileId, space.id]
      );
      if (!file) Response.error('文件不存在');
      DB.delete('web_hosting_files', 'id = ?', [fileId]);
      Response.success(null, '已删除');
    }

    // 网页空间文件
    if (source === 'webspace_file') {
      const fileId = parseInt(body.file_id ?? 0, 10) || 0;
      const file = DB.one(
        "SELECT whf.* FROM web_hosting_files whf \
         JOIN web_hosting_spaces whs ON whs.id = whf.space_id \
         WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
        [fileId, username]
      );
      if (!file) Response.error('文件不存在');
      if (file.is_directory) {
        // 删除 /.published 目录时，同时清除所有原始文件的 published_content
        if (String(file.file_path).startsWith('/.published')) {
          const prefix = String(file.file_path).replace(/\/+$/, '') + '/';
          // 获取所有将被删除的 published 文件
          const pubFiles = DB.all(
            "SELECT file_path FROM web_hosting_files WHERE space_id = ? AND (file_path = ? OR file_path LIKE ?)",
            [file.space_id, file.file_path, prefix + '%']
          );
          for (const pf of pubFiles) {
            if (pf.file_path === file.file_path) continue; // 跳过目录本身
            // 找到原始文件路径并清除 published_content
            const origPath = pf.file_path.replace('/.published', '');
            DB.update('web_hosting_files', { published_content: null, published_size: 0 }, 'space_id = ? AND file_path = ?', [file.space_id, origPath]);
          }
        }
        DB.delete('web_hosting_files', 'space_id = ? AND (file_path = ? OR file_path LIKE ?)', [file.space_id, file.file_path, prefix + '%']);
      } else {
        // 删除单个 published 文件时，清除原始文件的 published_content
        if (String(file.file_path).startsWith('/.published')) {
          const origPath = file.file_path.replace('/.published', '');
          DB.update('web_hosting_files', { published_content: null, published_size: 0 }, 'space_id = ? AND file_path = ?', [file.space_id, origPath]);
        }
        DB.delete('web_hosting_files', 'id = ?', [fileId]);
      }
      Response.success(null, '已删除');
    }

    Response.error('不支持删除此类型');
  }

  // ===== 创建网页空间 =====
  if (method === 'POST' && action === 'create-webspace') {
    checkQuota(ctx, username, schoolId);
    const title = String(body.title ?? '').trim();
    if (title === '') Response.error('请输入空间名称');
    let slug = String(body.slug ?? '').trim();
    if (slug === '') slug = title;
    // 清理 slug
    slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    slug = slug.replace(/^-+/, '').replace(/-+$/, '') || 'webspace';

    // 确保唯一
    let counter = 1;
    const baseSlug = slug;
    while (DB.scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ? AND alliance_username = ?", [slug, username])) {
      slug = baseSlug + '-' + (counter++);
    }

    const now = nowStr();
    const spaceId = DB.insert('web_hosting_spaces', {
      alliance_username: username,
      slug: slug,
      title: title,
      description: body.description ?? '',
      storage_quota: 10 * 1024 * 1024, // 10MB
      is_enabled: 1,
      is_web_space: 1,
      created_at: now,
      updated_at: now,
    });

    Auth.logAudit(schoolId, 0, 'dataspace_create_webspace', `创建网页空间: ${username} -> ${title}`);
    Response.success({ space_id: spaceId, slug: slug }, '网页空间已创建');
  }

  // ===== 更新网页空间配置 =====
  if (method === 'POST' && action === 'update-webspace') {
    const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
    const ws = DB.one(
      "SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1",
      [spaceId, username]
    );
    if (!ws) Response.error('网页空间不存在');

    const isset = (k) => body[k] !== undefined && body[k] !== null;
    const updates = { updated_at: nowStr() };
    if (isset('title')) updates.title = String(body.title).trim();
    if (isset('description')) updates.description = String(body.description).trim();
    if (isset('slug')) {
      const newSlug = String(body.slug).trim();
      if (!/^[a-z0-9-]+$/i.test(newSlug)) Response.error('路径别名只能包含字母、数字和连字符');
      const exists = DB.scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ? AND id != ?", [newSlug, spaceId]);
      if (exists) Response.error('该路径别名已被占用');
      updates.slug = newSlug;
    }
    if (isset('is_enabled')) {
      // 如果被管理员禁用，用户不能自行启用
      if (ws.disabled_by_admin && !Helpers.empty(body.is_enabled)) {
        Response.error('您的网页空间已被管理员停用，无法自行启用。请编辑新版本等待管理员审查。');
      }
      updates.is_enabled = Helpers.empty(body.is_enabled) ? 0 : 1;
    }

    DB.update('web_hosting_spaces', updates, 'id = ?', [spaceId]);
    Response.success({ ok: true }, '设置已保存');
  }

  // ===== 在网页空间中创建文件 =====
  if (method === 'POST' && action === 'webspace-create-file') {
    checkQuota(ctx, username, schoolId);
    const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
    const filePath = normalizePath(body.path ?? '');
    const content = body.content ?? '';

    const ws = DB.one("SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1", [spaceId, username]);
    if (!ws) Response.error('网页空间不存在');

    if (Helpers.empty(filePath) || filePath === '/') Response.error('文件路径无效');

    const existing = DB.one("SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?", [spaceId, filePath]);
    const now = nowStr();
    if (existing) {
      DB.update('web_hosting_files', {
        content: content,
        file_size: phpStrlen(content),
        review_status: 'pending_review',
        updated_at: now,
      }, 'id = ?', [existing.id]);
    } else {
      const parentPath = phpDirname(filePath);
      if (parentPath !== '.' && parentPath !== '/') {
        ensureDirExists(DB, spaceId, parentPath, now);
      }
      DB.insert('web_hosting_files', {
        space_id: spaceId,
        file_path: filePath,
        file_size: phpStrlen(content),
        content_type: guessContentType(filePath),
        content: content,
        is_directory: 0,
        review_status: 'pending_review',
        created_at: now,
        updated_at: now,
      });
    }
    // 标记空间为待审查
    DB.update('web_hosting_spaces', { review_status: 'pending_review', updated_at: now }, 'id = ?', [spaceId]);
    Response.success({ ok: true }, '文件已创建');
  }

  // ===== 在网页空间中创建目录 =====
  if (method === 'POST' && action === 'webspace-create-dir') {
    const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
    const dirPath = normalizePath(body.path ?? '');

    const ws = DB.one("SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1", [spaceId, username]);
    if (!ws) Response.error('网页空间不存在');

    if (Helpers.empty(dirPath) || dirPath === '/') Response.error('目录路径无效');

    const exists = DB.scalar("SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ?", [spaceId, dirPath]);
    if (exists) Response.error('目录已存在');

    const now = nowStr();
    const parentPath = phpDirname(dirPath);
    if (parentPath !== '.' && parentPath !== '/') {
      ensureDirExists(DB, spaceId, parentPath, now);
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
    Response.success({ ok: true }, '目录已创建');
  }

  // ===== 上传文件到网页空间 =====
  if (method === 'POST' && action === 'webspace-upload') {
    checkQuota(ctx, username, schoolId);
    const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
    const dir = String(body.dir ?? '/').trim();

    if (Helpers.empty(files.file)) Response.error('未选择文件');
    const file = files.file;
    if (file.error !== 0) Response.error('文件上传失败');

    const ws = DB.one("SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1", [spaceId, username]);
    if (!ws) Response.error('网页空间不存在');

    const name = phpBasename(file.name);
    const targetPath = normalizePath(String(dir).replace(/\/+$/, '') + '/' + name);
    const content = file.tmp_name; // 内存 Buffer，即 PHP file_get_contents($file['tmp_name'])
    const contentSize = phpStrlen(content);
    const contentType = file.type || guessContentType(name);

    const now = nowStr();
    const existing = DB.one("SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?", [spaceId, targetPath]);
    if (existing) {
      DB.update('web_hosting_files', {
        file_size: contentSize,
        content_type: contentType,
        content: content,
        review_status: 'pending_review',
        updated_at: now,
      }, 'id = ?', [existing.id]);
    } else {
      const parentPath = phpDirname(targetPath);
      if (parentPath !== '.' && parentPath !== '/') {
        ensureDirExists(DB, spaceId, parentPath, now);
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
    Response.success({ path: targetPath, size: contentSize }, '文件已上传');
  }

  // ===== 云空间使用情况概览 =====
  if (method === 'GET' && action === 'usage') {
    const space = ensureDataSpace(DB, username);
    const spaceId = space.id;

    // 网页空间文件总大小
    const webHostingUsed = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
      [spaceId]
    ) ?? 0, 10) || 0;

    // 实例存储数据总大小
    const instanceStorageUsed = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM instance_storage_data isd \
       JOIN instances i ON i.id = isd.instance_id \
       WHERE i.school_id = ?",
      [schoolId]
    ) ?? 0, 10) || 0;

    // 版本历史总大小
    const versionUsed = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(LENGTH(content)), 0) FROM cloud_file_versions WHERE created_by = ?",
      [username]
    ) ?? 0, 10) || 0;

    // 操作记录总大小
    const historyUsed = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(LENGTH(content_snapshot)), 0) FROM cloud_file_history WHERE created_by = ?",
      [username]
    ) ?? 0, 10) || 0;

    const totalUsed = webHostingUsed + instanceStorageUsed + versionUsed + historyUsed;
    const totalQuota = space.storage_quota || (10 * 1024 * 1024); // 使用空间实际配额，默认10MB

    // 文件数量统计
    const instanceCount = parseInt(DB.scalar(
      "SELECT COUNT(*) FROM instances WHERE school_id = ?",
      [schoolId]
    ) ?? 0, 10) || 0;
    const webSpaceCount = parseInt(DB.scalar(
      "SELECT COUNT(*) FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1",
      [username]
    ) ?? 0, 10) || 0;
    const cloudFileCount = parseInt(DB.scalar(
      "SELECT COUNT(*) FROM web_hosting_files WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND is_directory = 0",
      [spaceId]
    ) ?? 0, 10) || 0;

    Response.success({
      total_used: totalUsed,
      total_quota: totalQuota,
      usedDisplay: formatBytes(totalUsed),
      quotaDisplay: formatBytes(totalQuota),
      percent: totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 1000) / 10 : 0,
      isFull: totalUsed >= totalQuota,
      breakdown: {
        web_hosting: { used: webHostingUsed, display: formatBytes(webHostingUsed) },
        instance_storage: { used: instanceStorageUsed, display: formatBytes(instanceStorageUsed) },
        versions: { used: versionUsed, display: formatBytes(versionUsed) },
        history: { used: historyUsed, display: formatBytes(historyUsed) },
      },
      counts: {
        instances: instanceCount,
        web_spaces: webSpaceCount,
        cloud_files: cloudFileCount,
      },
    });
  }

  Response.error('未知的操作');
};
