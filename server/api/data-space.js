/**
 * 数据空间 API（NodeJS 版，1:1 复刻 api/data-space.php）
 * 统一管理用户在服务器上活动产生的所有文件
 */
const { nowStr } = require('../lib/response');

// ===== 系统目录定义 =====
const DS_INSTANCES = '/实例文件';
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
    storage_quota: 100 * 1024 * 1024,
    is_enabled: 1,
    is_web_space: 0,
    created_at: now,
    updated_at: now,
  });
  return DB.one("SELECT * FROM web_hosting_spaces WHERE id = ?", [spaceId]);
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
    const child = {
      name: phpBasename(childPath),
      path: wsPrefix + '/' + childPath.replace(/^\/+/, ''),
      is_directory: !!f.is_directory,
      size: f.file_size,
      file_type: f.is_directory ? null : extOf(childPath),
      updated_at: f.updated_at,
      source: 'webspace_file',
      file_id: f.id,
      space_id: f.space_id ?? null,
      real_path: childPath,
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

  const systemDirs = [DS_INSTANCES, DS_CLOUD, DS_WEBSPACES, DS_VERSIONS, DS_HISTORY];
  void systemDirs;

  // ===== 列出文件树 =====
  if (method === 'GET' && action === 'tree') {
    const nodes = [];

    // 1. 实例文件目录
    const instances = DB.all(
      "SELECT i.id, i.name, i.instance_uid, i.config, i.status, i.created_at \
       FROM instances i \
       WHERE i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ? \
       ORDER BY i.name ASC",
      [schoolId, username]
    );
    const instanceChildren = [];
    for (const inst of instances) {
      const instanceUid = inst.instance_uid;
      const baseDir = '/instances/' + instanceUid + '/';
      const instFiles = DB.all(
        "SELECT id, name, file_type, file_size, file_category, created_at, updated_at \
         FROM cloud_files \
         WHERE directory = ? AND school_id = ? \
         ORDER BY name ASC",
        [baseDir, schoolId]
      );

      const fileChildren = [];
      // 实例配置虚拟文件
      fileChildren.push({
        name: '实例配置.json',
        path: DS_INSTANCES + '/' + inst.name + '/实例配置.json',
        is_directory: false,
        size: phpStrlen(inst.config ?? '{}'),
        file_type: 'json',
        updated_at: inst.created_at,
        source: 'instance_config',
        instance_id: inst.id,
        instance_uid: instanceUid,
        config: blobText(inst.config),
      });
      // 实例下的文件
      for (const f of instFiles) {
        fileChildren.push({
          name: f.name,
          path: DS_INSTANCES + '/' + inst.name + '/' + f.name,
          is_directory: false,
          size: f.file_size,
          file_type: f.file_type,
          updated_at: f.updated_at,
          source: 'instance_file',
          file_id: f.id,
          instance_id: inst.id,
          instance_uid: instanceUid,
        });
      }

      instanceChildren.push({
        name: inst.name,
        path: DS_INSTANCES + '/' + inst.name,
        is_directory: true,
        source: 'instance',
        instance_id: inst.id,
        instance_uid: instanceUid,
        children: fileChildren,
      });
    }
    nodes.push({
      name: '实例文件',
      path: DS_INSTANCES,
      is_directory: true,
      source: 'system',
      badge: '实例管理',
      protected: true,
      children: instanceChildren,
    });

    // 2. 云文件目录（轻编辑器）
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

    // 3. 网页空间目录
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

    // 4. 版本历史目录
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

    // 5. 操作记录目录
    const histories = DB.all(
      "SELECT ch.id, ch.file_id, ch.file_name, ch.step, ch.created_at \
       FROM cloud_file_history ch \
       WHERE ch.created_by = ? \
       ORDER BY ch.created_at DESC LIMIT 50",
      [username]
    );
    const historyChildren = [];
    for (const h of histories) {
      historyChildren.push({
        name: h.file_name + ' - 步骤' + h.step + ' (' + h.created_at + ')',
        path: DS_HISTORY + '/' + h.id,
        is_directory: false,
        size: 0,
        file_type: 'history',
        updated_at: h.created_at,
        source: 'history_record',
        history_id: h.id,
        file_id: h.file_id,
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

    // 实例配置
    if (source === 'instance_config') {
      const instanceId = parseInt(query.instance_id ?? 0, 10) || 0;
      const inst = DB.one(
        "SELECT config FROM instances WHERE id = ? AND school_id = ? AND owner_type = 'alliance' AND owner_key = ?",
        [instanceId, schoolId, username]
      );
      if (!inst) Response.error('实例不存在');
      Response.success({
        content: blobText(inst.config) ?? '{}',
        file_type: 'json',
        source: 'instance_config',
      });
    }

    // 实例文件
    if (source === 'instance_file') {
      const fileId = parseInt(query.file_id ?? 0, 10) || 0;
      const file = DB.one(
        "SELECT cf.* FROM cloud_files cf \
         JOIN instances i ON i.id = cf.instance_id \
         WHERE cf.id = ? AND i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
        [fileId, schoolId, username]
      );
      if (!file) Response.error('文件不存在');
      Response.success({
        content: blobText(file.content) ?? '',
        file_type: file.file_type,
        source: 'instance_file',
        file_id: file.id,
      });
    }

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

    // 操作记录
    if (source === 'history_record') {
      const historyId = parseInt(query.history_id ?? 0, 10) || 0;
      const h = DB.one(
        "SELECT * FROM cloud_file_history WHERE id = ? AND created_by = ?",
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
        "SELECT whf.* FROM web_hosting_files whf \
         JOIN web_hosting_spaces whs ON whs.id = whf.space_id \
         WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
        [fileId, username]
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

    // 实例文件保存
    if (source === 'instance_file') {
      const fileId = parseInt(body.file_id ?? 0, 10) || 0;
      const file = DB.one(
        "SELECT cf.* FROM cloud_files cf \
         JOIN instances i ON i.id = cf.instance_id \
         WHERE cf.id = ? AND i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
        [fileId, schoolId, username]
      );
      if (!file) Response.error('文件不存在');
      const now = nowStr();
      DB.update('cloud_files', {
        content: content,
        file_size: phpStrlen(content),
        updated_at: now,
      }, 'id = ?', [fileId]);
      Response.success({ ok: true, size: phpStrlen(content) }, '已保存');
    }

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

    // 实例目录
    if (source === 'instance') {
      const instanceId = parseInt(body.instance_id ?? 0, 10) || 0;
      const inst = DB.one(
        "SELECT * FROM instances WHERE id = ? AND school_id = ? AND owner_type = 'alliance' AND owner_key = ?",
        [instanceId, schoolId, username]
      );
      if (!inst) Response.error('实例不存在');
      // 删除实例及关联文件
      DB.delete('cloud_files', 'instance_id = ?', [instanceId]);
      DB.delete('instance_storage_data', 'instance_id = ?', [instanceId]);
      DB.delete('instances', 'id = ?', [instanceId]);
      Response.success(null, '实例已删除');
    }

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
        const prefix = String(file.file_path).replace(/\/+$/, '') + '/';
        DB.delete('web_hosting_files', 'space_id = ? AND (file_path = ? OR file_path LIKE ?)', [file.space_id, file.file_path, prefix + '%']);
      } else {
        DB.delete('web_hosting_files', 'id = ?', [fileId]);
      }
      Response.success(null, '已删除');
    }

    Response.error('不支持删除此类型');
  }

  // ===== 创建网页空间 =====
  if (method === 'POST' && action === 'create-webspace') {
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
      storage_quota: 100 * 1024 * 1024,
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
    if (isset('is_enabled')) updates.is_enabled = Helpers.empty(body.is_enabled) ? 0 : 1;

    DB.update('web_hosting_spaces', updates, 'id = ?', [spaceId]);
    Response.success({ ok: true }, '设置已保存');
  }

  // ===== 在网页空间中创建文件 =====
  if (method === 'POST' && action === 'webspace-create-file') {
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
        created_at: now,
        updated_at: now,
      });
    }
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
        created_at: now,
        updated_at: now,
      });
    }
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

    // 实例文件总大小
    const instanceFilesUsed = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(cf.file_size), 0) FROM cloud_files cf \
       JOIN instances i ON i.id = cf.instance_id \
       WHERE i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
      [schoolId, username]
    ) ?? 0, 10) || 0;

    // 实例存储数据总大小
    const instanceStorageUsed = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM instance_storage_data isd \
       JOIN instances i ON i.id = isd.instance_id \
       WHERE i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
      [schoolId, username]
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

    const totalUsed = webHostingUsed + instanceFilesUsed + instanceStorageUsed + versionUsed + historyUsed;
    const totalQuota = 500 * 1024 * 1024; // 500MB 总配额

    // 文件数量统计
    const instanceCount = parseInt(DB.scalar(
      "SELECT COUNT(*) FROM instances WHERE school_id = ? AND owner_type = 'alliance' AND owner_key = ?",
      [schoolId, username]
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
      total_used_display: formatBytes(totalUsed),
      total_quota_display: formatBytes(totalQuota),
      used_percent: totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 1000) / 10 : 0,
      breakdown: {
        web_hosting: { used: webHostingUsed, display: formatBytes(webHostingUsed) },
        instance_files: { used: instanceFilesUsed, display: formatBytes(instanceFilesUsed) },
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
