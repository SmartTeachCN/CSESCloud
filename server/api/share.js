/**
 * 统一分享功能 API
 *
 * 操作：
 *  - POST action=share                    创建分享（按用户或分享链接）
 *  - POST action=update-permission        更新单个被分享用户的权限
 *  - POST action=remove-user              移除被分享用户
 *  - POST action=accept                   接受分享（用户名分享）
 *  - POST action=reject                   拒绝分享（用户名分享）
 *  - POST action=toggle-preview-link      开关分享链接（原「预览链接」，action 名保留兼容）
 *  - POST action=update-link-settings     更新分享链接策略（仅 owner）
 *  - POST action=save-preview             分享链接内容保存（游客编辑，按链接策略）
 *  - GET  action=list-shared-by-me        列出我分享的
 *  - GET  action=list-shared-to-me        列出分享给我的
 *  - GET  action=get-share-detail         获取分享详情（含已授权用户列表与链接策略）
 *  - GET  action=get-preview              通过分享链接获取分享内容（按链接策略允许游客）
 *  - POST action=accept-preview-link      通过链接接受分享
 *  - POST action=delete-share             删除分享
 *
 * 分享链接策略（share_preview_links 四列，响应中同时提供 share_settings 与平铺字段）：
 *  - require_login    仅允许已登录用户查看（默认 1）
 *  - preview_only     链接仅用作预览：不可接收、不可编辑（默认 0）
 *  - allow_accept     允许通过链接接收分享（默认 1）
 *  - allow_guest_edit 允许未登录用户编辑（默认 0；为 1 时强制 require_login=0）
 * 约束：preview_only=1 时 allow_accept/allow_guest_edit 强制 0。
 */
const crypto = require('crypto');
const { nowStr, dateStr } = require('../lib/response');
const DB = require('../lib/db');
const cloudShare = require('../lib/cloud-share');
const sharePermissions = require('../lib/share-permissions');

// ────────────────────── 分享链接策略（四档开关） ──────────────────────

const LINK_SETTING_KEYS = ['require_login', 'preview_only', 'allow_accept', 'allow_guest_edit'];

/** 默认策略：需登录查看、非仅预览、允许接收、不允许游客编辑（与升级前行为一致）。 */
const LINK_SETTING_DEFAULTS = Object.freeze({
  require_login: true,
  preview_only: false,
  allow_accept: true,
  allow_guest_edit: false,
});

/** 宽松布尔解析：兼容 true/false、1/0、'1'/'0'、'true'/'false'。 */
function toLinkBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return fallback;
}

/** 从库行 / 已归一化对象读取四档策略（缺失字段回退默认值）。 */
function readLinkSettings(source) {
  const row = source && typeof source === 'object' ? source : {};
  return {
    require_login: toLinkBool(row.require_login, LINK_SETTING_DEFAULTS.require_login),
    preview_only: toLinkBool(row.preview_only, LINK_SETTING_DEFAULTS.preview_only),
    allow_accept: toLinkBool(row.allow_accept, LINK_SETTING_DEFAULTS.allow_accept),
    allow_guest_edit: toLinkBool(row.allow_guest_edit, LINK_SETTING_DEFAULTS.allow_guest_edit),
  };
}

/**
 * 统一设置归一化：input 覆盖 base，再按联动约束修正。
 *  - preview_only=true 时强制 allow_accept=false、allow_guest_edit=false（仅预览优先）；
 *  - allow_guest_edit=true 时强制 require_login=false（游客可编辑必然游客可查看）。
 */
function normalizeLinkSettings(input, base) {
  const raw = input && typeof input === 'object' ? input : {};
  const prev = readLinkSettings(base);
  const settings = {};
  for (const key of LINK_SETTING_KEYS) {
    settings[key] = Object.prototype.hasOwnProperty.call(raw, key)
      ? toLinkBool(raw[key], prev[key])
      : prev[key];
  }
  if (settings.preview_only) {
    settings.allow_accept = false;
    settings.allow_guest_edit = false;
  }
  if (settings.allow_guest_edit) {
    settings.require_login = false;
  }
  return settings;
}

/** 从请求体提取策略输入：兼容 link_settings 嵌套对象与平铺字段（嵌套优先）。 */
function pickLinkSettingsInput(body) {
  const source = body && typeof body === 'object' ? body : {};
  const input = {};
  for (const key of LINK_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) input[key] = source[key];
  }
  const nested = source.link_settings;
  if (nested && typeof nested === 'object') {
    for (const key of LINK_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(nested, key)) input[key] = nested[key];
    }
  }
  return input;
}

/** 分享链接 URL（新路由 /share/link，旧 /share/preview 路由仍可用）。 */
function shareUrlOf(req, token) {
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  const host = req.headers.host ?? 'localhost';
  return `${protocol}://${host}/share/link?token=${encodeURIComponent(token)}`;
}

/** 链接基础字段：share_* 为正式命名，preview_* 保留作为兼容别名。 */
function linkPayloadOf(req, token, enabled) {
  const url = token ? shareUrlOf(req, token) : null;
  return {
    share_token: token || null,
    share_enabled: !!enabled,
    share_link: url,
    preview_token: token || null,
    preview_enabled: !!enabled,
    preview_link: url,
  };
}

/** 策略字段：share_settings / link_settings + 平铺四档。 */
function settingsPayloadOf(settings) {
  const value = readLinkSettings(settings);
  return {
    share_settings: value,
    link_settings: value,
    require_login: value.require_login,
    preview_only: value.preview_only,
    allow_accept: value.allow_accept,
    allow_guest_edit: value.allow_guest_edit,
  };
}

/** 由库行构造分享链接完整对外字段（token 缺失时返回关闭态 + 默认策略）。 */
function linkStatePayloadOf(req, linkRow) {
  const token = linkRow ? (linkRow.preview_token ?? linkRow.token ?? null) : null;
  const enabledRaw = linkRow ? (linkRow.preview_enabled ?? linkRow.is_enabled ?? 0) : 0;
  const enabled = token ? (parseInt(enabledRaw ?? 0, 10) || 0) === 1 : false;
  return Object.assign(linkPayloadOf(req, token, enabled), settingsPayloadOf(readLinkSettings(linkRow)));
}

/** 查询启用中的分享链接（按 token），同时带出分享主表字段。 */
function findShareLinkByToken(token) {
  return DB.one(
    `SELECT si.*, spl.token AS link_token, spl.is_enabled AS link_enabled,
            spl.require_login, spl.preview_only, spl.allow_accept, spl.allow_guest_edit
     FROM share_preview_links spl
     JOIN share_items si ON si.id = spl.share_id
     WHERE spl.token = ? AND spl.is_enabled = 1 AND si.is_deleted = 0`,
    [token]
  );
}

/** 文本化内容（兼容 TEXT / BLOB / Uint8Array）。 */
function textOfContent(content) {
  if (content === null || content === undefined) return '';
  if (Buffer.isBuffer(content)) return content.toString('utf8');
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('utf8');
  }
  return String(content);
}


/** 文件黑名单检查（按资源 + 用户名）。 */
function isBlacklisted(DB, resourceType, resourceId, targetUsername) {
  const name = String(targetUsername || '').trim();
  if (!name) return false;
  return !!DB.one(
    `SELECT id FROM share_blacklist WHERE resource_type = ? AND resource_id = ? AND target_username = ?`,
    [resourceType, resourceId, name]
  );
}

/** 当前用户的分享目标上下文：自身 user_id + 联盟账户绑定的子用户 ID + 联盟用户名。 */
function shareTargetContext(DB, Auth) {
  const user = Auth.user() || {};
  const username = user.username || '';
  const ids = new Set();
  const userId = parseInt(user.user_id || 0, 10) || 0;
  if (userId > 0) ids.add(userId);
  if (Auth.isAlliance() && username) {
    const bindings = DB.all('SELECT sub_user_id FROM alliance_account_bindings WHERE alliance_username = ?', [username]);
    for (const b of bindings) {
      const id = parseInt(b.sub_user_id, 10) || 0;
      if (id > 0) ids.add(id);
    }
  }
  return { username: username, ids: Array.from(ids) };
}

/** 构造 target_user_id / target_username 匹配条件与参数。 */
function shareTargetClause(alias, ctx) {
  const clauses = [];
  const params = [];
  if (ctx.ids.length) {
    clauses.push(alias + '.target_user_id IN (' + ctx.ids.map(() => '?').join(',') + ')');
    params.push(...ctx.ids);
  }
  if (ctx.username) {
    clauses.push(alias + '.target_username = ?');
    params.push(ctx.username);
  }
  return { sql: clauses.length ? '(' + clauses.join(' OR ') + ')' : '0', params: params };
}

/** 接收者对应的云空间用户名：联盟账户自身，或子用户绑定的联盟账户。 */
function recipientCloudUsername(DB, Auth, perm) {
  if (Auth.isAlliance()) return Auth.allianceUsername();
  const subUserId = parseInt(perm && perm.target_user_id, 10) || 0;
  if (subUserId > 0) {
    const binding = DB.one(
      'SELECT alliance_username FROM alliance_account_bindings WHERE sub_user_id = ? ORDER BY id ASC LIMIT 1',
      [subUserId]
    );
    if (binding && binding.alliance_username) return String(binding.alliance_username);
  }
  return '';
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  const method = req.method;
  const action = query.action ?? '';
  // $body = Helpers::jsonBody(); → body

  // ===== 通过分享链接获取分享内容（登录/游客按链接策略）=====
  if (method === 'GET' && action === 'get-preview') {
    const token = String(query.token ?? '').trim();
    if (token === '') Response.error('缺少 token 参数');

    const link = findShareLinkByToken(token);
    if (!link) Response.error('分享链接不存在或已关闭');
    if (String(link.expires_at || '') < nowStr()) Response.error('分享已过期');

    const settings = readLinkSettings(link);
    const loggedIn = Auth.check();
    const currentUser = loggedIn ? Auth.user() : null;
    const currentOwnerKey = loggedIn ? Auth.ownerKey() : '';

    // 黑名单只对已登录用户生效（游客无法识别身份）
    if (loggedIn && isBlacklisted(DB, link.resource_type, link.resource_id, currentUser?.username)) {
      Response.error('你已被该文件加入黑名单，无法查看此分享', 403, 403);
    }
    // 链接要求登录 → 未登录直接 401（前端据此展示「前往登录」）
    if (settings.require_login && !loggedIn) {
      Response.error('请先登录后查看此分享链接', 401, 401);
    }

    const resourceData = getShareResourceData(link.resource_type, link.resource_id);
    if (!resourceData) Response.error('资源不存在或已被删除');

    let alreadyAccepted = false;
    if (loggedIn) {
      const target = shareTargetContext(DB, Auth);
      const targetWhere = shareTargetClause('sup', target);
      alreadyAccepted = !!DB.one(
        `SELECT sup.id FROM share_user_permissions sup
         WHERE sup.share_id = ? AND sup.status = 'accepted' AND ${targetWhere.sql}
         ORDER BY sup.id DESC LIMIT 1`,
        [link.id, ...targetWhere.params]
      );
    }

    const content = textOfContent(resourceData.content);
    Response.success(Object.assign({
      share_id: link.id,
      resource_type: link.resource_type,
      resource_name: link.resource_name,
      permission: sharePermissions.normalizePermission(link.permission),
      owner_username: link.owner_username,
      resource: Object.assign({}, resourceData, { content: content }),
      content: content,
      // 仅预览 / 未允许接收时不能接受
      can_accept: !settings.preview_only && settings.allow_accept,
      can_guest_edit: settings.allow_guest_edit && !settings.preview_only,
      already_accepted: alreadyAccepted,
      is_owner: !!currentOwnerKey && link.owner_key === currentOwnerKey,
    }, settingsPayloadOf(settings)));
  }

  // ===== 分享链接内容保存（游客编辑 / 登录用户编辑）=====
  if (method === 'POST' && action === 'save-preview') {
    const token = String(body.token ?? '').trim();
    if (token === '') Response.error('缺少 token 参数');

    const link = findShareLinkByToken(token);
    if (!link) Response.error('分享链接不存在或已关闭');
    if (String(link.expires_at || '') < nowStr()) Response.error('分享已过期');

    const settings = readLinkSettings(link);
    const loggedIn = Auth.check();
    const currentUser = loggedIn ? Auth.user() : null;

    if (loggedIn && isBlacklisted(DB, link.resource_type, link.resource_id, currentUser?.username)) {
      Response.error('你已被该文件加入黑名单，无法编辑此分享内容', 403, 403);
    }
    if (settings.require_login && !loggedIn) {
      Response.error('请先登录后编辑此分享内容', 401, 401);
    }
    if (settings.preview_only) {
      Response.error('该分享链接仅用于预览，不能编辑内容');
    }
    if (!settings.allow_guest_edit) {
      Response.error('分享者未允许通过此链接编辑内容', 403, 403);
    }

    const content = typeof body.content === 'string'
      ? body.content
      : (body.content === undefined || body.content === null ? null : String(body.content));
    if (content === null) Response.error('缺少内容参数（content）');
    const size = Buffer.byteLength(content, 'utf8');
    if (size > 1024 * 1024) Response.error('内容过大，单次保存不能超过 1MB');

    // 写回分享者源文件（占位文件内容保持不变）
    const ownerFile = cloudShare.ownerFileOf(DB, link.resource_id);
    if (!ownerFile) Response.error('源文件不存在或已被删除', 404, 404);

    const now = nowStr();
    DB.update('web_hosting_files', {
      content: content,
      file_size: size,
      updated_at: now,
    }, 'id = ?', [ownerFile.id]);

    // 审计：登录用户记录其用户名，游客记录 guest
    try {
      DB.insert('audit_logs', {
        school_id: parseInt((currentUser || {}).school_id ?? 0, 10) || 0,
        user_id: parseInt((currentUser || {}).user_id ?? 0, 10) || 0,
        username: loggedIn ? String((currentUser || {}).username || '') : 'guest',
        action: 'share_link_edit',
        target: `${link.resource_name || ''}（分享 #${link.id}，${size} 字节）`,
        ip: req.socket?.remoteAddress || 'cli',
        status: 'success',
        created_at: now,
      });
    } catch (_) { /* 审计失败不影响保存 */ }

    Response.success({ ok: true, updated_at: now, size: size }, '内容已保存');
  }

  // ===== 通过链接接受分享 =====
  if (method === 'POST' && action === 'accept-preview-link') {
    Auth.requireLogin();
    const user = Auth.user();
    const ownerKey = Auth.ownerKey();
    const token = String(body.token ?? '').trim();
    if (token === '') Response.error('缺少 token 参数');

    const link = findShareLinkByToken(token);
    if (!link) Response.error('分享链接不存在或已关闭');
    if (String(link.expires_at || '') < nowStr()) Response.error('分享已过期');

    // 链接策略：仅预览 / 未允许接收时不能接收
    const settings = readLinkSettings(link);
    if (settings.preview_only) Response.error('该分享链接仅用于预览，不能接收');
    if (!settings.allow_accept) Response.error('分享者未允许通过链接接收此文件');

    // 不能接受自己的分享
    if (link.owner_key === ownerKey) Response.error('不能接受自己的分享');
    if (isBlacklisted(DB, link.resource_type, link.resource_id, user?.username)) {
      Response.error('你已被该文件加入黑名单，无法接受此分享', 403, 403);
    }

    // 检查是否已经接受过（联盟账户也可能通过子用户绑定收到分享）
    const target = shareTargetContext(DB, Auth);
    const targetWhere = shareTargetClause('sup', target);
    const existing = DB.one(
      `SELECT * FROM share_user_permissions sup WHERE sup.share_id = ? AND ${targetWhere.sql}
       ORDER BY sup.id DESC LIMIT 1`,
      [link.id, ...targetWhere.params]
    );
    if (existing && existing.status === 'accepted') {
      const cloudUsername = recipientCloudUsername(DB, Auth, existing);
      if (cloudUsername) cloudShare.ensurePlaceholderForShare(DB, link, cloudUsername);
      Response.success({ already_accepted: true }, '已接受过此分享');
    }

    const now = nowStr();
    if (existing) {
      DB.update('share_user_permissions', {
        status: 'accepted',
        accepted_at: now,
        target_user_id: user.user_id ?? 0,
        target_username: user.username ?? '',
      }, 'id = ?', [existing.id]);
    } else {
      DB.insert('share_user_permissions', {
        share_id: link.id,
        target_user_id: user.user_id ?? 0,
        target_username: user.username ?? '',
        permission: sharePermissions.normalizePermission(link.permission),
        status: 'accepted',
        accepted_at: now,
        created_at: now,
      });
    }

    // 在接收者云空间创建同名分享占位文件
    const acceptedPerm = DB.one(
      `SELECT * FROM share_user_permissions sup WHERE sup.share_id = ? AND ${targetWhere.sql}
       ORDER BY sup.id DESC LIMIT 1`,
      [link.id, ...targetWhere.params]
    );
    const cloudUsername = recipientCloudUsername(DB, Auth, acceptedPerm);
    if (cloudUsername) cloudShare.ensurePlaceholderForShare(DB, link, cloudUsername);

    Response.success(null, '已接受分享');
  }

  // ===== 以下操作需要登录 =====
  Auth.requireLogin();
  const user = Auth.user();
  const ownerKey = Auth.ownerKey();
  const username = user?.username ?? '';
  const userId = user?.user_id ?? 0;

  // ===== 创建分享 =====
  if (method === 'POST' && action === 'share') {
    const resourceType = String(body.resource_type ?? 'cloud_file').trim();
    const resourceId = parseInt(body.resource_id ?? 0, 10) || 0;
    const resourceName = String(body.resource_name ?? '').trim();
    const shareType = String(body.share_type ?? 'user').trim(); // 'user' or 'link'
    const permission = sharePermissions.normalizePermission(body.permission ?? 'view_file');
    const expiryDays = parseInt(body.expiry_days ?? 7, 10) || 0;
    const targetUsers = body.target_users ?? []; // 用户名数组
    const enablePreviewLink = !Helpers.empty(body.enable_preview_link);
    const linkSettingsInput = pickLinkSettingsInput(body);

    if (resourceName === '') Response.error('资源名称不能为空');
    if (expiryDays < 1 || expiryDays > 90) Response.error('有效期必须在 1-90 天之间');
    if (resourceType !== 'cloud_file') Response.error('无效的资源类型');
    if (!sharePermissions.isValidPermission(body.permission ?? 'view_file')) Response.error('无效的权限设置');

    // 验证资源是否存在且属于当前用户
    const resource = getShareResourceData(resourceType, resourceId);
    if (!resource) Response.error('资源不存在');

    // 检查是否是资源所有者
    if (resourceType === 'cloud_file') {
      const ownedFile = DB.one(
        `SELECT f.id, f.content FROM web_hosting_files f
         JOIN web_hosting_spaces s ON s.id = f.space_id
         WHERE f.id = ? AND s.alliance_username = ?`,
        [resourceId, username]
      );
      let ownerCheck = !!ownedFile;
      if (!ownerCheck) {
        // 兼容旧版 cloud_files 表（学校空间）
        ownerCheck = !!DB.one(`SELECT id FROM cloud_files WHERE id = ? AND school_id = ?`, [resourceId, Auth.schoolId()]);
      }
      if (!ownerCheck) Response.error('无权分享此文件');
      if (ownedFile && cloudShare.isPlaceholder(ownedFile)) Response.error('分享占位文件不能再次分享');
    }

    const now = nowStr();
    const expiresAt = dateStr(new Date(Date.now() + expiryDays * 86400e3));

    // 检查是否已有分享记录（复用）
    const existingShare = DB.one(
      `SELECT * FROM share_items WHERE resource_type = ? AND resource_id = ? AND owner_key = ? AND is_deleted = 0`,
      [resourceType, resourceId, ownerKey]
    );

    let shareId = null;
    if (existingShare) {
      // 更新现有分享
      shareId = existingShare.id;
      DB.update('share_items', {
        resource_name: resourceName,
        permission: permission,
        expires_at: expiresAt,
        updated_at: now,
      }, 'id = ?', [shareId]);
    } else {
      shareId = DB.insert('share_items', {
        owner_key: ownerKey,
        owner_username: username,
        resource_type: resourceType,
        resource_id: resourceId,
        resource_name: resourceName,
        share_type: shareType,
        permission: permission,
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      });
    }

    // 处理按用户分享
    const addedUsers = [];
    if (shareType === 'user' && Array.isArray(targetUsers) && targetUsers.length > 0) {
      for (const targetUser of targetUsers) {
        const targetUsername = typeof targetUser === 'string' ? targetUser.trim() : String((targetUser ?? {}).username ?? '').trim();
        const targetPermission = targetUser && typeof targetUser === 'object' && targetUser.permission
          ? sharePermissions.normalizePermission(targetUser.permission)
          : permission;
        if (targetUsername === '' || targetUsername === username) continue;
        if (isBlacklisted(DB, resourceType, resourceId, targetUsername)) continue; // 黑名单用户不再发放权限

        // 查找目标用户
        let targetUserRow = DB.one(`SELECT id, username FROM users WHERE username = ?`, [targetUsername]);
        if (!targetUserRow) {
          // 尝试在所有用户中查找
          targetUserRow = DB.one(`SELECT id, username FROM users WHERE username = ?`, [targetUsername]);
        }

        const targetUid = targetUserRow ? parseInt(targetUserRow.id, 10) || 0 : 0;

        // 检查是否已有该用户的权限记录
        const existingPerm = DB.one(
          `SELECT * FROM share_user_permissions WHERE share_id = ? AND target_username = ?`,
          [shareId, targetUsername]
        );

        if (existingPerm) {
          if (existingPerm.status === 'rejected') {
            // 重新邀请
            DB.update('share_user_permissions', {
              permission: targetPermission,
              status: 'pending',
              accepted_at: null,
            }, 'id = ?', [existingPerm.id]);
          } else {
            DB.update('share_user_permissions', {
              permission: targetPermission,
            }, 'id = ?', [existingPerm.id]);
          }
        } else {
          DB.insert('share_user_permissions', {
            share_id: shareId,
            target_user_id: targetUid,
            target_username: targetUsername,
            permission: targetPermission,
            status: 'pending',
            created_at: now,
          });
        }

        addedUsers.push(targetUsername);

        // 发送通知给被分享者
        if (targetUid > 0) {
          sendShareNotification(
            targetUid,
            targetUsername,
            username,
            resourceName,
            resourceType,
            shareId,
            'share_invite'
          );
        }
      }
    }

    // 处理分享链接（原「预览链接」）：写入四档可配置策略
    let previewLink = null;
    let previewSettings = null;
    if (enablePreviewLink) {
      // 检查是否已有分享链接（复用时保留未显式下发的设置）
      const existingLink = DB.one(
        `SELECT * FROM share_preview_links WHERE share_id = ?`,
        [shareId]
      );

      if (existingLink) {
        previewSettings = normalizeLinkSettings(linkSettingsInput, existingLink);
        DB.update(
          'share_preview_links',
          Object.assign({ is_enabled: 1 }, previewSettings),
          'id = ?',
          [existingLink.id]
        );
        previewLink = existingLink.token;
      } else {
        const token = crypto.randomBytes(16).toString('hex');
        previewSettings = normalizeLinkSettings(linkSettingsInput, null);
        DB.insert('share_preview_links', Object.assign({
          share_id: shareId,
          token: token,
          is_enabled: 1,
          created_at: now,
        }, previewSettings));
        previewLink = token;
      }
    }

    // 更新 share_type
    if (enablePreviewLink && addedUsers.length > 0) {
      DB.update('share_items', { share_type: 'both' }, 'id = ?', [shareId]);
    } else if (enablePreviewLink) {
      DB.update('share_items', { share_type: 'link' }, 'id = ?', [shareId]);
    } else {
      DB.update('share_items', { share_type: 'user' }, 'id = ?', [shareId]);
    }

    // 标记资源为已分享
    if (resourceType === 'cloud_file') {
      DB.update('cloud_files', { status: 'shared' }, 'id = ?', [resourceId]);
    }

    const result = Object.assign({
      share_id: shareId,
      added_users: addedUsers,
      expires_at: expiresAt,
    }, linkPayloadOf(req, previewLink, !!previewLink));
    if (previewLink && previewSettings) {
      Object.assign(result, settingsPayloadOf(previewSettings));
    } else {
      result.share_settings = null;
      result.link_settings = null;
    }

    const msg = existingShare ? '分享已更新' : '分享已创建';
    Response.success(result, msg);
  }

  // ===== 更新单个用户权限 =====
  if (method === 'POST' && action === 'update-permission') {
    const permId = parseInt(body.permission_id ?? 0, 10) || 0;
    const newPermissionRaw = String(body.permission ?? '').trim();
    if (permId <= 0) Response.error('缺少权限记录 ID');
    if (!sharePermissions.isValidPermission(newPermissionRaw)) Response.error('无效的权限');
    const newPermission = sharePermissions.normalizePermission(newPermissionRaw);

    const perm = DB.one(`SELECT sup.*, si.owner_key FROM share_user_permissions sup JOIN share_items si ON si.id = sup.share_id WHERE sup.id = ?`, [permId]);
    if (!perm) Response.error('权限记录不存在');
    if (perm.owner_key !== ownerKey) Response.error('无权修改此权限', 403);

    DB.update('share_user_permissions', { permission: newPermission }, 'id = ?', [permId]);
    Response.success(null, '权限已更新');
  }

  // ===== 移除被分享用户 =====
  if (method === 'POST' && action === 'remove-user') {
    const permId = parseInt(body.permission_id ?? 0, 10) || 0;
    if (permId <= 0) Response.error('缺少权限记录 ID');

    const perm = DB.one(`SELECT sup.*, si.owner_key FROM share_user_permissions sup JOIN share_items si ON si.id = sup.share_id WHERE sup.id = ?`, [permId]);
    if (!perm) Response.error('权限记录不存在');
    if (perm.owner_key !== ownerKey) Response.error('无权移除此用户', 403);

    DB.delete('share_user_permissions', 'id = ?', [permId]);
    // 清理该接收者（可能是绑定子用户的联盟账户）云空间中的占位文件
    let cloudUsername = perm.target_username || '';
    const subUserId = parseInt(perm.target_user_id, 10) || 0;
    if (subUserId > 0) {
      const binding = DB.one(
        'SELECT alliance_username FROM alliance_account_bindings WHERE sub_user_id = ? ORDER BY id ASC LIMIT 1',
        [subUserId]
      );
      if (binding && binding.alliance_username) cloudUsername = binding.alliance_username;
    }
    if (cloudUsername) cloudShare.removePlaceholdersForShare(DB, perm.share_id, cloudUsername);
    Response.success(null, '用户已移除');
  }

  // ===== 接受分享（用户名分享） =====
  if (method === 'POST' && action === 'accept') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    if (shareId <= 0) Response.error('缺少分享 ID');

    const target = shareTargetContext(DB, Auth);
    const targetWhere = shareTargetClause('sup', target);
    const perm = DB.one(
      `SELECT sup.* FROM share_user_permissions sup
       WHERE sup.share_id = ? AND sup.status = 'pending' AND ${targetWhere.sql}`,
      [shareId, ...targetWhere.params]
    );
    if (!perm) Response.error('没有待处理的分享邀请');

    const share = DB.one(`SELECT * FROM share_items WHERE id = ?`, [shareId]);
    if (!share) Response.error('分享不存在或已删除');
    if (isBlacklisted(DB, share.resource_type, share.resource_id, username)) {
      Response.error('你已被该文件加入黑名单，无法接受此分享', 403, 403);
    }

    const now = nowStr();
    DB.update('share_user_permissions', {
      status: 'accepted',
      accepted_at: now,
      target_user_id: userId,
      target_username: username,
    }, 'id = ?', [perm.id]);

    // 通知分享者
    if (share) {
    // 在接收者云空间创建同名分享占位文件
    const cloudUsername = recipientCloudUsername(DB, Auth, perm);
    if (cloudUsername) cloudShare.ensurePlaceholderForShare(DB, share, cloudUsername);
      const sharerUser = DB.one(`SELECT id, username FROM users WHERE username = ?`, [share.owner_username]);
      if (sharerUser) {
        sendShareNotification(
          sharerUser.id,
          sharerUser.username,
          username,
          share.resource_name,
          share.resource_type,
          shareId,
          'share_accepted'
        );
      }
    }

    Response.success(null, '已接受分享');
  }

  // ===== 拒绝分享（用户名分享） =====
  if (method === 'POST' && action === 'reject') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    if (shareId <= 0) Response.error('缺少分享 ID');

    const target = shareTargetContext(DB, Auth);
    const targetWhere = shareTargetClause('sup', target);
    const perm = DB.one(
      `SELECT sup.* FROM share_user_permissions sup
       WHERE sup.share_id = ? AND sup.status = 'pending' AND ${targetWhere.sql}`,
      [shareId, ...targetWhere.params]
    );
    if (!perm) Response.error('没有待处理的分享邀请');

    const now = nowStr();
    DB.update('share_user_permissions', {
      status: 'rejected',
    }, 'id = ?', [perm.id]);

    // 通知分享者
    const share = DB.one(`SELECT * FROM share_items WHERE id = ?`, [shareId]);
    if (share) {
      const sharerUser = DB.one(`SELECT id, username FROM users WHERE username = ?`, [share.owner_username]);
      if (sharerUser) {
        sendShareNotification(
          sharerUser.id,
          sharerUser.username,
          username,
          share.resource_name,
          share.resource_type,
          shareId,
          'share_rejected'
        );
      }
    }

    Response.success(null, '已拒绝分享');
  }

  // ===== 开关分享链接（action 名保留预览链接时期的兼容命名）=====
  if (method === 'POST' && action === 'toggle-preview-link') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    const enable = !Helpers.empty(body.enable);
    if (shareId <= 0) Response.error('缺少分享 ID');

    const share = DB.one(`SELECT * FROM share_items WHERE id = ? AND owner_key = ?`, [shareId, ownerKey]);
    if (!share) Response.error('分享不存在或无权操作');

    let existingLink = DB.one(`SELECT * FROM share_preview_links WHERE share_id = ?`, [shareId]);
    const now = nowStr();
    const linkSettingsInput = pickLinkSettingsInput(body);

    if (enable) {
      let settings;
      if (existingLink) {
        settings = normalizeLinkSettings(linkSettingsInput, existingLink);
        DB.update(
          'share_preview_links',
          Object.assign({ is_enabled: 1 }, settings),
          'id = ?',
          [existingLink.id]
        );
      } else {
        const token = crypto.randomBytes(16).toString('hex');
        settings = normalizeLinkSettings(linkSettingsInput, null);
        DB.insert('share_preview_links', Object.assign({
          share_id: shareId,
          token: token,
          is_enabled: 1,
          created_at: now,
        }, settings));
        existingLink = { token: token };
      }
      Response.success(Object.assign({
        enabled: true,
      }, linkPayloadOf(req, existingLink.token, true), settingsPayloadOf(settings)), '分享链接已开启');
    } else {
      const settings = readLinkSettings(existingLink);
      if (existingLink) {
        DB.update('share_preview_links', { is_enabled: 0 }, 'id = ?', [existingLink.id]);
      }
      Response.success(Object.assign({
        enabled: false,
      }, linkPayloadOf(req, existingLink ? existingLink.token : null, false), settingsPayloadOf(settings)), '分享链接已关闭');
    }
  }

  // ===== 更新分享链接策略（仅 owner）=====
  if (method === 'POST' && action === 'update-link-settings') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    if (shareId <= 0) Response.error('缺少分享 ID');

    const share = DB.one(
      `SELECT * FROM share_items WHERE id = ? AND owner_key = ? AND is_deleted = 0`,
      [shareId, ownerKey]
    );
    if (!share) Response.error('分享不存在或无权操作', 403, 403);

    const link = DB.one(`SELECT * FROM share_preview_links WHERE share_id = ?`, [shareId]);
    if (!link) Response.error('该分享尚未开启分享链接');

    const input = pickLinkSettingsInput(body);
    if (Object.keys(input).length === 0) Response.error('缺少要更新的分享链接设置');

    const settings = normalizeLinkSettings(input, link);
    DB.update('share_preview_links', settings, 'id = ?', [link.id]);

    let enabled = (parseInt(link.is_enabled ?? 0, 10) || 0) === 1;
    if (Object.prototype.hasOwnProperty.call(body, 'is_enabled')) {
      // 允许顺带开关（可选，便于管理页一次性提交）
      enabled = toLinkBool(body.is_enabled, enabled);
      DB.update('share_preview_links', { is_enabled: enabled ? 1 : 0 }, 'id = ?', [link.id]);
    }

    Response.success(Object.assign({
      share_id: shareId,
      enabled: enabled,
    }, linkPayloadOf(req, link.token, enabled), settingsPayloadOf(settings)), '分享链接设置已更新');
  }

  // ===== 列出我分享的 =====
  if (method === 'GET' && action === 'list-shared-by-me') {
    const shares = DB.all(
      `SELECT si.*, spl.token AS preview_token, spl.is_enabled AS preview_enabled,
              spl.require_login, spl.preview_only, spl.allow_accept, spl.allow_guest_edit
       FROM share_items si
       LEFT JOIN share_preview_links spl ON spl.share_id = si.id
       WHERE si.owner_key = ? AND si.is_deleted = 0
       ORDER BY si.created_at DESC`,
      [ownerKey]
    );

    const result = [];
    for (const share of shares) {
      const users = DB.all(
        `SELECT * FROM share_user_permissions WHERE share_id = ? ORDER BY created_at ASC`,
        [share.id]
      );

      result.push(Object.assign({
        id: share.id,
        resource_type: share.resource_type,
        resource_id: share.resource_id,
        resource_name: share.resource_name,
        share_type: share.share_type,
        permission: sharePermissions.normalizePermission(share.permission),
        expires_at: share.expires_at,
        created_at: share.created_at,
        users: users.map((u) => {
          return {
            id: u.id,
            target_user_id: u.target_user_id,
            target_username: u.target_username,
            permission: sharePermissions.normalizePermission(u.permission),
            status: u.status,
            accepted_at: u.accepted_at,
          };
        }),
      }, linkStatePayloadOf(req, share)));
    }

    Response.success(result);
  }

  // ===== 列出分享给我的 =====
  if (method === 'GET' && action === 'list-shared-to-me') {
    const type = query.type ?? 'all'; // 'all' / 'cloud_file'
    const target = shareTargetContext(DB, Auth);
    const targetWhere = shareTargetClause('sup', target);

    let typeFilter = '';
    const params = [...targetWhere.params];
    if (type !== 'all') {
      typeFilter = 'AND si.resource_type = ?';
      params.push(type);
    }

    const perms = DB.all(
      `SELECT sup.*, si.resource_type, si.resource_id, si.resource_name, si.owner_username, si.expires_at, si.permission AS share_permission
       FROM share_user_permissions sup
       JOIN share_items si ON si.id = sup.share_id
       WHERE sup.status = 'accepted' AND si.is_deleted = 0
         AND ${targetWhere.sql} ${typeFilter}
       ORDER BY sup.accepted_at DESC`,
      params
    );

    const result = perms.map((p) => {
      return {
        permission_id: p.id,
        share_id: p.share_id,
        resource_type: p.resource_type,
        resource_id: p.resource_id,
        resource_name: p.resource_name,
        owner_username: p.owner_username,
        permission: sharePermissions.normalizePermission(p.permission),
        expires_at: p.expires_at,
        accepted_at: p.accepted_at,
      };
    });

    Response.success(result);
  }

  // ===== 获取分享详情（含已授权用户列表） =====
  if (method === 'GET' && action === 'get-share-detail') {
    const shareId = parseInt(query.share_id ?? 0, 10) || 0;
    if (shareId <= 0) Response.error('缺少分享 ID');

    const share = DB.one(
      `SELECT si.*, spl.token AS preview_token, spl.is_enabled AS preview_enabled,
              spl.require_login, spl.preview_only, spl.allow_accept, spl.allow_guest_edit
       FROM share_items si
       LEFT JOIN share_preview_links spl ON spl.share_id = si.id
       WHERE si.id = ? AND si.owner_key = ? AND si.is_deleted = 0`,
      [shareId, ownerKey]
    );
    if (!share) Response.error('分享不存在或无权访问');

    const users = DB.all(
      `SELECT * FROM share_user_permissions WHERE share_id = ? ORDER BY created_at ASC`,
      [shareId]
    );

    Response.success(Object.assign({
      id: share.id,
      resource_type: share.resource_type,
      resource_id: share.resource_id,
      resource_name: share.resource_name,
      share_type: share.share_type,
      permission: sharePermissions.normalizePermission(share.permission),
      expires_at: share.expires_at,
      created_at: share.created_at,
      users: users.map((u) => {
        return {
          id: u.id,
          target_user_id: u.target_user_id,
          target_username: u.target_username,
          permission: sharePermissions.normalizePermission(u.permission),
          status: u.status,
          accepted_at: u.accepted_at,
        };
      }),
    }, linkStatePayloadOf(req, share)));
  }

  // ===== 删除分享 =====
  if (method === 'POST' && action === 'delete-share') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    if (shareId <= 0) Response.error('缺少分享 ID');

    const share = DB.one(`SELECT * FROM share_items WHERE id = ? AND owner_key = ?`, [shareId, ownerKey]);
    if (!share) Response.error('分享不存在或无权操作');

    // 软删除
    DB.update('share_items', { is_deleted: 1, updated_at: nowStr() }, 'id = ?', [shareId]);
    // 删除接收者云空间中的分享占位文件
    cloudShare.removePlaceholdersForShareAnywhere(DB, shareId);

    // 更新资源状态
    if (share.resource_type === 'cloud_file') {
      // 检查是否还有其他活跃分享
      const otherShares = DB.scalar(
        `SELECT COUNT(*) FROM share_items WHERE resource_type = 'cloud_file' AND resource_id = ? AND is_deleted = 0 AND id != ?`,
        [share.resource_id, shareId]
      );
      if (Number(otherShares) === 0) {
        DB.update('cloud_files', { status: 'synced' }, 'id = ?', [share.resource_id]);
      }
    }

    Response.success(null, '分享已删除');
  }

  // ===== 分享黑名单（按文件维度） =====
  if (method === 'GET' && action === 'get-blacklist') {
    const shareId = parseInt(query.share_id ?? 0, 10) || 0;
    if (shareId <= 0) Response.error('缺少分享 ID');
    const share = DB.one(`SELECT * FROM share_items WHERE id = ? AND owner_key = ?`, [shareId, ownerKey]);
    if (!share) Response.error('分享不存在或无权操作');
    const rows = DB.all(
      'SELECT id, target_username AS username, created_at FROM share_blacklist WHERE resource_type = ? AND resource_id = ? ORDER BY id DESC',
      [share.resource_type, share.resource_id]
    );
    Response.success(rows);
  }

  if (method === 'POST' && action === 'add-blacklist') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    const targetUsername = String(body.username ?? '').trim();
    if (shareId <= 0) Response.error('缺少分享 ID');
    if (!targetUsername) Response.error('请输入要拉黑的用户名');
    const share = DB.one(`SELECT * FROM share_items WHERE id = ? AND owner_key = ?`, [shareId, ownerKey]);
    if (!share) Response.error('分享不存在或无权操作');

    const now = nowStr();
    const targetUser = DB.one('SELECT id FROM users WHERE username = ?', [targetUsername]);
    const existing = DB.one(
      'SELECT id FROM share_blacklist WHERE resource_type = ? AND resource_id = ? AND target_username = ?',
      [share.resource_type, share.resource_id, targetUsername]
    );
    if (!existing) {
      DB.insert('share_blacklist', {
        resource_type: share.resource_type,
        resource_id: share.resource_id,
        owner_key: ownerKey,
        target_username: targetUsername,
        target_user_id: targetUser ? (parseInt(targetUser.id, 10) || 0) : 0,
        created_at: now,
      });
    }
    // 立即撤销该用户的已有权限与占位文件
    const perms = DB.all(
      'SELECT * FROM share_user_permissions WHERE share_id = ? AND target_username = ?',
      [shareId, targetUsername]
    );
    for (const perm of perms) {
      DB.delete('share_user_permissions', 'id = ?', [perm.id]);
    }
    // 清理接收者云空间中的占位文件（联盟账户可能是子用户绑定的账户）
    let placeholderUser = targetUsername;
    if (targetUser) {
      const binding = DB.one(
        'SELECT alliance_username FROM alliance_account_bindings WHERE sub_user_id = ? ORDER BY id ASC LIMIT 1',
        [targetUser.id]
      );
      if (binding && binding.alliance_username) placeholderUser = binding.alliance_username;
    }
    cloudShare.removePlaceholdersForShare(DB, shareId, placeholderUser);
    Response.success({ username: targetUsername }, '已加入文件黑名单');
  }

  if (method === 'POST' && action === 'remove-blacklist') {
    const shareId = parseInt(body.share_id ?? 0, 10) || 0;
    const targetUsername = String(body.username ?? '').trim();
    if (shareId <= 0) Response.error('缺少分享 ID');
    if (!targetUsername) Response.error('缺少用户名');
    const share = DB.one(`SELECT * FROM share_items WHERE id = ? AND owner_key = ?`, [shareId, ownerKey]);
    if (!share) Response.error('分享不存在或无权操作');
    DB.delete(
      'share_blacklist',
      'resource_type = ? AND resource_id = ? AND target_username = ?',
      [share.resource_type, share.resource_id, targetUsername]
    );
    Response.success(null, '已移出黑名单');
  }

  // ===== 搜索用户（用于分享时选择用户） =====
  if (method === 'GET' && action === 'search-users') {
    const keyword = String(query.keyword ?? '').trim();
    if (keyword === '') {
      Response.success([]);
    }

    const users = DB.all(
      `SELECT id, username, display_name, role FROM users
       WHERE (username LIKE ? OR display_name LIKE ?) AND status = 'active' AND username != ?
       LIMIT 20`,
      [`%${keyword}%`, `%${keyword}%`, username]
    );

    // 联盟账户也可作为分享接收者（其与子用户的绑定关系保存在 alliance_account_bindings）
    const allianceUsers = DB.all(
      `SELECT DISTINCT alliance_username AS username FROM alliance_account_bindings
       WHERE alliance_username LIKE ? AND alliance_username != ? LIMIT 20`,
      [`%${keyword}%`, username]
    );

    const result = users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      role: u.role,
    }));
    for (const a of allianceUsers) {
      if (!result.some((r) => r.username === a.username)) {
        result.push({
          id: 0,
          username: a.username,
          display_name: a.username,
          role: 'alliance',
        });
      }
    }

    Response.success(result);
  }

  // ===== 获取分享给我的待处理列表（用于通知） =====
  if (method === 'GET' && action === 'pending-shares') {
    const target = shareTargetContext(DB, Auth);
    const targetWhere = shareTargetClause('sup', target);
    const perms = DB.all(
      `SELECT sup.*, si.resource_type, si.resource_id, si.resource_name, si.owner_username, si.expires_at
       FROM share_user_permissions sup
       JOIN share_items si ON si.id = sup.share_id
       WHERE sup.status = 'pending' AND si.is_deleted = 0 AND si.expires_at > datetime('now','localtime')
         AND ${targetWhere.sql}
       ORDER BY sup.created_at DESC`,
      targetWhere.params
    );

    const result = perms.map((p) => {
      return {
        permission_id: p.id,
        share_id: p.share_id,
        resource_type: p.resource_type,
        resource_name: p.resource_name,
        owner_username: p.owner_username,
        permission: sharePermissions.normalizePermission(p.permission),
        expires_at: p.expires_at,
        created_at: p.created_at,
      };
    });

    Response.success(result);
  }

  Response.error('未知的操作');
};

// ===== 辅助函数 =====

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

/**
 * 获取分享资源的实际数据
 */
function getShareResourceData(type, id)
{
  if (type === 'cloud_file') {
    // 先尝试 cloud_files 表
    const file = DB.one(`SELECT * FROM cloud_files WHERE id = ?`, [id]);
    if (file) {
      return {
        id: file.id,
        name: file.name,
        content: textOfContent(file.content),
        file_type: file.file_type,
        file_size: file.file_size,
        updated_at: file.updated_at,
      };
    }
    // 再尝试 web_hosting_files 表（轻编辑器云文件）
    const wFile = DB.one(`SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0`, [id]);
    if (wFile) {
      return {
        id: wFile.id,
        name: basename(wFile.file_path),
        content: textOfContent(wFile.content),
        file_type: fileExt(wFile.file_path),
        file_size: wFile.file_size,
        updated_at: wFile.updated_at,
      };
    }
    return null;
  }

  return null;
}

/**
 * 发送分享相关通知
 */
function sendShareNotification(targetUserId, targetUsername, fromUsername, resourceName, resourceType, shareId, notifType)
{
  let schoolId = 0;
  const targetUser = DB.one(`SELECT school_id FROM users WHERE id = ?`, [targetUserId]);
  if (targetUser) schoolId = parseInt(targetUser.school_id, 10) || 0;

  const typeLabels = { cloud_file: '文件' };
  const resourceLabel = typeLabels[resourceType] ?? '资源';

  let title = '';
  let content = '';
  const targetType = notifType; // share_invite / share_accepted / share_rejected

  switch (notifType) {
    case 'share_invite':
      title = `${fromUsername} 分享了一个${resourceLabel}给你`;
      content = `${fromUsername} 邀请你查看${resourceLabel}「${resourceName}」。请在消息中心处理此邀请。`;
      break;
    case 'share_accepted':
      title = `${targetUsername} 接受了你的分享`;
      content = `${targetUsername} 已接受你对${resourceLabel}「${resourceName}」的分享。`;
      break;
    case 'share_rejected':
      title = `${targetUsername} 拒绝了你的分享`;
      content = `${targetUsername} 拒绝了你对${resourceLabel}「${resourceName}」的分享邀请。`;
      break;
  }

  if (title === '') return;

  DB.insert('notifications', {
    school_id: schoolId,
    sender_id: 0,
    sender_name: fromUsername,
    type: 'info',
    title: title,
    content: content,
    target_type: targetType,
    target_id: String(targetUserId),
    share_id: shareId,
    created_at: nowStr(),
  });
}
