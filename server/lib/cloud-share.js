/**
 * 云文件分享占位符（V3）。
 *
 * 被分享者接受分享后，在其云空间 `/.cloud/` 下创建一个同名占位文件：
 *   - 文件内容为 CSES Cloud 内部标记（`CSES_CLOUD_SHARE:<json>`），用户不可见；
 *   - 列表读取时解析标记，并把展示/读写重定向到分享者的源文件；
 *   - 重命名/删除占位符不允许；保存/导入等写操作重定向到分享者文件（需 edit 权限），
 *     不会覆盖占位符内容。
 */
'use strict';

const { nowStr } = require('./response');

const CLOUD_PREFIX = '/.cloud/';
const MARKER_PREFIX = 'CSES_CLOUD_SHARE:';

function textOfContent(content) {
  if (content === null || content === undefined) return '';
  if (Buffer.isBuffer(content)) return content.toString('utf8');
  if (content instanceof Uint8Array) return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('utf8');
  return String(content);
}

/** 创建分享标记内容。 */
function makeMarker(shareId, ownerFileId, ownerUsername, name) {
  return MARKER_PREFIX + JSON.stringify({
    share_id: parseInt(shareId, 10) || 0,
    owner_file_id: parseInt(ownerFileId, 10) || 0,
    owner_username: String(ownerUsername || ''),
    name: String(name || ''),
    v: 1,
  });
}

/** 解析分享标记（非占位符返回 null）。 */
function parseMarker(content) {
  const text = textOfContent(content);
  if (!text.startsWith(MARKER_PREFIX)) return null;
  try {
    const data = JSON.parse(text.slice(MARKER_PREFIX.length));
    if (!data || typeof data !== 'object') return null;
    const shareId = parseInt(data.share_id, 10) || 0;
    const ownerFileId = parseInt(data.owner_file_id, 10) || 0;
    if (!shareId || !ownerFileId) return null;
    return {
      share_id: shareId,
      owner_file_id: ownerFileId,
      owner_username: String(data.owner_username || ''),
      name: String(data.name || ''),
    };
  } catch (_) {
    return null;
  }
}

function isPlaceholder(row) {
  return !!parseMarker(row && row.content);
}

/** 确保用户名对应的云空间存在（web_hosting_spaces）。 */
function ensureCloudSpace(DB, username) {
  let space = DB.one('SELECT * FROM web_hosting_spaces WHERE alliance_username = ?', [username]);
  if (space) return space;

  let slug = username;
  let counter = 1;
  while (DB.scalar('SELECT 1 FROM web_hosting_spaces WHERE slug = ?', [slug])) {
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
  space = DB.one('SELECT * FROM web_hosting_spaces WHERE id = ?', [spaceId]);
  return space;
}

/** 确保 `/.cloud` 目录行存在。 */
function ensureCloudDir(DB, spaceId, now) {
  const exists = DB.scalar(
    'SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1',
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

/** 在指定空间内生成不冲突的路径。 */
function uniqueSharePath(DB, spaceId, desiredName) {
  const base = String(desiredName || 'shared').replace(/^\/+/, '');
  let candidate = base;
  let index = 2;
  while (DB.one('SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?', [spaceId, CLOUD_PREFIX + candidate])) {
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    candidate = stem + ' (' + index + ')' + ext;
    index++;
    if (index > 999) break;
  }
  return candidate;
}

/** 读取分享者源文件。 */
function ownerFileOf(DB, ownerFileId) {
  return DB.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [ownerFileId]);
}

/** 分享是否仍然有效（未删除、未过期）。 */
function shareIsActive(share) {
  if (!share || parseInt(share.is_deleted, 10) === 1) return false;
  return String(share.expires_at || '') >= nowStr();
}

/** 当前联盟用户对应的分享接收标识（自身 + 已绑定子用户）。 */
function shareTargetContext(DB, Auth) {
  const user = Auth.user() || {};
  const username = user.type === 'alliance' ? (user.username || '') : '';
  const ids = new Set();
  const userId = parseInt(user.user_id || 0, 10) || 0;
  if (userId > 0) ids.add(userId);
  if (username) {
    const bindings = DB.all('SELECT sub_user_id FROM alliance_account_bindings WHERE alliance_username = ?', [username]);
    for (const b of bindings) {
      const id = parseInt(b.sub_user_id, 10) || 0;
      if (id > 0) ids.add(id);
    }
  }
  return { username: username, ids: Array.from(ids) };
}

/** 用户可接收的、已接受的 cloud_file 分享。 */
function acceptedSharesForUser(DB, Auth) {
  const ctx = shareTargetContext(DB, Auth);
  if (!ctx.username && ctx.ids.length === 0) return [];
  const params = [];
  const clauses = [];
  if (ctx.ids.length) {
    clauses.push('sup.target_user_id IN (' + ctx.ids.map(() => '?').join(',') + ')');
    params.push(...ctx.ids);
  }
  if (ctx.username) {
    clauses.push('sup.target_username = ?');
    params.push(ctx.username);
  }
  const where = clauses.length ? '(' + clauses.join(' OR ') + ')' : '0';
  return DB.all(
    `SELECT sup.id AS permission_id, sup.permission AS user_permission, sup.status AS permission_status,
            si.*
     FROM share_user_permissions sup
     JOIN share_items si ON si.id = sup.share_id
     WHERE si.resource_type = 'cloud_file' AND si.is_deleted = 0
       AND si.expires_at > datetime('now','localtime')
       AND sup.status = 'accepted' AND ${where}
     ORDER BY sup.accepted_at DESC`,
    params
  );
}

/**
 * 为某个分享在接收者云空间创建占位文件（幂等）。
 * @returns {object|null} placeholder row
 */
function ensurePlaceholderForShare(DB, share, targetUsername) {
  if (!share || !targetUsername) return null;
  const ownerFile = ownerFileOf(DB, share.resource_id);
  if (!ownerFile) return null;
  const desiredName = String(share.resource_name || '').trim() ||
    (String(ownerFile.file_path || '').split('/').pop() || 'shared');

  const space = ensureCloudSpace(DB, targetUsername);
  const now = nowStr();
  ensureCloudDir(DB, space.id, now);

  // 已存在该分享的占位符 → 复用
  const rows = DB.all(
    `SELECT * FROM web_hosting_files WHERE space_id = ? AND is_directory = 0 AND file_path LIKE ?`,
    [space.id, CLOUD_PREFIX + '%']
  );
  for (const row of rows) {
    const marker = parseMarker(row.content);
    if (marker && marker.share_id === parseInt(share.id, 10)) return row;
  }

  const name = uniqueSharePath(DB, space.id, desiredName);
  const content = makeMarker(share.id, ownerFile.id, share.owner_username, name);
  const id = DB.insert('web_hosting_files', {
    space_id: space.id,
    file_path: CLOUD_PREFIX + name,
    file_size: Buffer.byteLength(content),
    content_type: ownerFile.content_type || 'text/plain',
    content: content,
    is_directory: 0,
    created_at: now,
    updated_at: now,
  });
  return DB.one('SELECT * FROM web_hosting_files WHERE id = ?', [id]);
}

/**
 * 查找某分享在接收者云空间中的占位文件（只读，不创建）。
 * 通过占位标记匹配 share_id（以及可选的 owner_file_id）。
 * @returns {object|null} placeholder row
 */
function findPlaceholderForShare(DB, shareId, targetUsername, ownerFileId) {
  const targetShareId = parseInt(shareId, 10) || 0;
  if (!targetShareId || !targetUsername) return null;
  const expectedOwnerFileId = parseInt(ownerFileId, 10) || 0;
  const space = DB.one('SELECT * FROM web_hosting_spaces WHERE alliance_username = ?', [targetUsername]);
  if (!space) return null;
  const rows = DB.all(
    `SELECT * FROM web_hosting_files WHERE space_id = ? AND is_directory = 0 AND file_path LIKE ?`,
    [space.id, CLOUD_PREFIX + '%']
  );
  for (const row of rows) {
    const marker = parseMarker(row.content);
    if (!marker || marker.share_id !== targetShareId) continue;
    if (expectedOwnerFileId && marker.owner_file_id !== expectedOwnerFileId) continue;
    return row;
  }
  return null;
}

/** 为当前用户所有已接受的 cloud_file 分享补齐占位符。 */
function ensurePlaceholdersForUser(DB, Auth) {
  const shares = acceptedSharesForUser(DB, Auth);
  for (const share of shares) {
    ensurePlaceholderForShare(DB, share, Auth.allianceUsername());
  }
  return shares.length;
}

/**
 * 解析占位符对应的分享与源文件。
 * @returns {{share:object, ownerFile:object, permission:string}|null}
 */
function resolvePlaceholder(DB, placeholderRow, Auth) {
  const marker = parseMarker(placeholderRow && placeholderRow.content);
  if (!marker) return null;
  const share = DB.one(
    `SELECT * FROM share_items WHERE id = ? AND resource_type = 'cloud_file' AND is_deleted = 0`,
    [marker.share_id]
  );
  if (!shareIsActive(share)) return null;
  const ownerFile = ownerFileOf(DB, marker.owner_file_id);
  if (!ownerFile) return null;

  const ctx = shareTargetContext(DB, Auth);
  if (!ctx.username) return null;
  const perm = DB.one(
    `SELECT * FROM share_user_permissions
     WHERE share_id = ? AND status = 'accepted'
       AND (target_username = ? ${ctx.ids.length ? 'OR target_user_id IN (' + ctx.ids.map(() => '?').join(',') + ')' : ''})
     ORDER BY id DESC LIMIT 1`,
    [marker.share_id, ctx.username, ...ctx.ids]
  );
  if (!perm) return null;

  return {
    share: share,
    ownerFile: ownerFile,
    permission: perm.permission || share.permission || 'view',
    shared_from: share.owner_username || marker.owner_username,
  };
}

/** 删除某分享在全部接收者空间的占位符（用于删除分享）。 */
function removePlaceholdersForShareAnywhere(DB, shareId) {
  const targetShareId = parseInt(shareId, 10) || 0;
  if (!targetShareId) return 0;
  const rows = DB.all(
    `SELECT id, content FROM web_hosting_files WHERE is_directory = 0 AND content LIKE ?`,
    [MARKER_PREFIX + '%']
  );
  let removed = 0;
  for (const row of rows) {
    const marker = parseMarker(row.content);
    if (marker && marker.share_id === targetShareId) {
      DB.delete('web_hosting_files', 'id = ?', [row.id]);
      removed++;
    }
  }
  return removed;
}

/** 删除某分享在接收者空间的占位符。 */
function removePlaceholdersForShare(DB, shareId, targetUsername) {
  if (!targetUsername) return 0;
  const space = DB.one('SELECT * FROM web_hosting_spaces WHERE alliance_username = ?', [targetUsername]);
  if (!space) return 0;
  const rows = DB.all(
    `SELECT id, content FROM web_hosting_files WHERE space_id = ? AND is_directory = 0 AND file_path LIKE ?`,
    [space.id, CLOUD_PREFIX + '%']
  );
  let removed = 0;
  for (const row of rows) {
    const marker = parseMarker(row.content);
    if (marker && marker.share_id === parseInt(shareId, 10)) {
      DB.delete('web_hosting_files', 'id = ?', [row.id]);
      removed++;
    }
  }
  return removed;
}

module.exports = {
  CLOUD_PREFIX,
  MARKER_PREFIX,
  makeMarker,
  parseMarker,
  isPlaceholder,
  ownerFileOf,
  ensureCloudSpace,
  ensureCloudDir,
  ensurePlaceholderForShare,
  findPlaceholderForShare,
  ensurePlaceholdersForUser,
  acceptedSharesForUser,
  shareTargetContext,
  resolvePlaceholder,
  removePlaceholdersForShare,
  removePlaceholdersForShareAnywhere,
};
