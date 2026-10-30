/**
 * 配置分发 / 静态集控管理 API（V3）。
 *
 * 轻编辑器「分发配置」与「配置实例管理」共用的后端：
 *   - GET  action=overview   当前所有者的分发概览（实例组 + 地址模板 + 实例列表）
 *   - GET  action=list       配置实例列表（InstanceDTO[]）
 *   - GET  action=get&id=N   配置实例详情（InstanceDTO）
 *   - POST action=create     { file_id, instance_id?, organization_name?, group_name? } → InstanceDTO
 *   - POST action=update     { id, instance_id?, organization_name?, file_id? }        → InstanceDTO
 *   - POST action=delete     { id }                                                    → null
 *   - POST action=validate   { file_id } → 校验统计 / 警告
 *   - GET  action=manifest&id=N → ClassIsland「加入管理」清单 JSON（附件下载）
 *
 * 数据模型（V3 增量）：
 *   - 每个所有者只有一个默认实例组（惰性创建，`dir_id` 为 12 位小写字母/数字）；
 *   - 一条 `instances` 记录 = 一个配置实例（`app_key = cses_static_control`）；
 *   - 源文件必须属于当前联盟用户 `/.cloud/` 目录下的 `web_hosting_files`；
 *   - 源文件内容实时读取，清单版本号 = 组内源文件 updated_at 最大值的 Unix 秒。
 */
'use strict';

const crypto = require('crypto');
const { nowStr } = require('../lib/response');
const convert = require('../lib/classisland-convert');
const staticControlApp = require('../apps/cses-static-control');
const { baseUrlFromRequest } = require('../lib/static-control-public');

const APP_KEY = 'cses_static_control';
const CLOUD_PREFIX = '/.cloud/';
const DEFAULT_GROUP_NAME = '静态集控分发';
/** `dir_id` 允许的字符集（12 位小写字母/数字，排除易混淆字符由随机分布保证）。 */
const DIR_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// ────────────────────────────── 辅助函数 ──────────────────────────────

/** 解析实例 config JSON（失败返回 {}）。 */
function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** 生成唯一的 12 位小写字母/数字实例组标识。 */
function generateDirId(DB) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = crypto.randomBytes(12);
    let dirId = '';
    for (let i = 0; i < 12; i++) dirId += DIR_ID_CHARS[bytes[i] % DIR_ID_CHARS.length];
    if (!DB.scalar('SELECT 1 FROM instance_groups WHERE dir_id = ?', [dirId])) return dirId;
  }
  // 极小概率兜底：随机 hex（同样满足 [a-z0-9] 与长度要求）
  return ('a' + crypto.randomBytes(8).toString('hex')).slice(0, 12);
}

/** 当前所有者的默认分发实例组（取第一个已分配 dir_id 的组）。 */
function findGroup(DB, ownerKey) {
  return DB.one(
    "SELECT * FROM instance_groups WHERE owner_key = ? AND dir_id IS NOT NULL AND dir_id != '' ORDER BY id ASC LIMIT 1",
    [ownerKey]
  );
}

/**
 * 惰性创建 / 获取默认分发实例组。
 * 旧数据里若有同名但没有 dir_id 的组，优先复用并补上 dir_id。
 */
function ensureGroup(DB, ownerKey, user, groupName) {
  const now = nowStr();
  const desiredName = String(groupName === undefined || groupName === null ? '' : groupName).trim();
  let group = findGroup(DB, ownerKey);

  if (!group) {
    const reuseName = desiredName || DEFAULT_GROUP_NAME;
    const legacy = DB.one(
      "SELECT * FROM instance_groups WHERE owner_key = ? AND name = ? AND (dir_id IS NULL OR dir_id = '') ORDER BY id ASC LIMIT 1",
      [ownerKey, reuseName]
    );
    const dirId = generateDirId(DB);
    if (legacy) {
      DB.update('instance_groups', { dir_id: dirId, updated_at: now }, 'id = ?', [legacy.id]);
      group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [legacy.id]);
    } else {
      const id = DB.insert('instance_groups', {
        owner_user_id: user && user.user_id ? user.user_id : 0,
        owner_type: (user && user.type) || 'alliance',
        owner_key: ownerKey,
        name: reuseName,
        dir_id: dirId,
        sort_order: 0,
        created_at: now,
        updated_at: now,
      });
      group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [id]);
    }
    return group;
  }

  // 已存在默认组：允许通过 create 的 group_name 修改组名
  if (desiredName && desiredName !== group.name) {
    DB.update('instance_groups', { name: desiredName, updated_at: now }, 'id = ?', [group.id]);
    group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [group.id]);
  }
  return group;
}

/**
 * 校验源文件：必须存在、属于当前联盟用户、是文件、位于 `/.cloud/` 下。
 * @returns {{file: object}|{error: string, status: number}}
 */
function resolveOwnedCloudFile(DB, fileId, username) {
  const id = parseInt(fileId, 10) || 0;
  if (!id) return { error: '缺少源文件（file_id）', status: 400 };

  const file = DB.one(
    `SELECT f.*, s.alliance_username AS space_owner
     FROM web_hosting_files f
     JOIN web_hosting_spaces s ON s.id = f.space_id
     WHERE f.id = ?`,
    [id]
  );
  if (!file) return { error: '源文件不存在', status: 404 };
  if (file.space_owner !== username) return { error: '源文件不存在或不属于当前用户', status: 403 };
  if (parseInt(file.is_directory, 10) === 1) return { error: '源文件必须是文件而不是目录', status: 400 };
  if (String(file.file_path || '').indexOf(CLOUD_PREFIX) !== 0) {
    return { error: '源文件必须是轻编辑器云文件（/.cloud/ 目录下）', status: 400 };
  }
  return { file: file };
}

/** 实例标识的去重后缀（组内唯一）。 */
function uniqueInstanceName(DB, groupId, baseName) {
  const base = staticControlApp.sanitizeInstanceName(baseName || 'instance');
  let candidate = base;
  let counter = 2;
  while (DB.one('SELECT id FROM instances WHERE group_id = ? AND name = ?', [groupId, candidate])) {
    let suffix = '-' + counter;
    let stem = base;
    while (Buffer.byteLength(stem + suffix, 'utf8') > 180) stem = stem.slice(0, -1);
    candidate = stem + suffix;
    counter++;
    if (counter > 9999) {
      candidate = staticControlApp.sanitizeInstanceName(base + '-' + crypto.randomBytes(2).toString('hex'));
      break;
    }
  }
  return candidate;
}

/** 组织名称：显式传入则使用，否则 `CSES Cloud (<dir_id>)`。 */
function normalizeOrganizationName(value, dirId) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text !== '') return text.slice(0, 200);
  return convert.defaultOrganizationName(dirId);
}

/** 实例 config（与 spec 2 一致）。 */
function buildInstanceConfig(organizationName, fileName) {
  return {
    format: 'classisland',
    organization_name: organizationName,
    file_name: fileName,
  };
}

/** 读取某实例组内所有实例（当前所有者 + 静态集控应用）。 */
function listRows(DB, ownerKey) {
  return DB.all(
    'SELECT * FROM instances WHERE owner_key = ? AND app_key = ? ORDER BY id ASC',
    [ownerKey, APP_KEY]
  );
}

/** 构造 InstanceDTO（spec 3.4）。 */
function buildDTO(DB, row, group, baseUrl, caches) {
  const config = parseConfig(row.config);
  const fileId = parseInt(row.source_file_id, 10) || 0;
  let file = null;
  if (fileId > 0) {
    if (!caches.files.has(fileId)) {
      caches.files.set(fileId, DB.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [fileId]));
    }
    file = caches.files.get(fileId);
  }

  let valid = false;
  let warning = '';
  if (!file) {
    warning = '源文件不存在或已被删除，请重新选择源文件';
  } else {
    if (!caches.validations.has(fileId)) {
      caches.validations.set(fileId, staticControlApp.validateContent(file.content, file.file_path));
    }
    const validation = caches.validations.get(fileId);
    valid = validation.ok === true;
    warning = validation.ok
      ? (validation.warnings || []).join('；')
      : (validation.error || '源文件不是有效的 CSES 文档');
  }

  const groupDirId = group && group.dir_id ? group.dir_id : '';
  let dataVersion = 0;
  if (group && group.id) {
    if (!caches.versions.has(group.id)) {
      caches.versions.set(group.id, groupDirId ? staticControlApp.version(DB, group.id) : 0);
    }
    dataVersion = caches.versions.get(group.id);
  }
  const urls = groupDirId
    ? staticControlApp.urls(baseUrl, groupDirId, row.name)
    : { manifest: '', file_template: '' };

  return {
    id: row.id,
    instance_uid: row.instance_uid || '',
    name: row.name,
    app_key: row.app_key,
    source_file_id: file ? file.id : (fileId || null),
    source_file_name: file ? staticControlApp.basename(file.file_path) : '',
    source_file_type: file ? staticControlApp.extOfPath(file.file_path) : '',
    source_updated_at: file ? (file.updated_at || '') : '',
    group_id: row.group_id,
    group_dir_id: groupDirId,
    organization_name: (config.organization_name && String(config.organization_name).trim())
      || (groupDirId ? convert.defaultOrganizationName(groupDirId) : ''),
    status: row.status || 'running',
    created_at: row.created_at || '',
    updated_at: row.updated_at || row.created_at || '',
    version: dataVersion,
    urls: urls,
    valid: valid,
    warning: warning,
  };
}

/** 批量构造 DTO（同一所有者可能历史遗留多个组，逐个解析组信息）。 */
function buildDTOs(DB, rows, defaultGroup, baseUrl) {
  const caches = { files: new Map(), validations: new Map(), versions: new Map() };
  const groups = new Map();
  if (rows.length) {
    const ownerKeys = Array.from(new Set(rows.map((row) => row.owner_key)));
    const placeholders = ownerKeys.map(() => '?').join(',');
    for (const group of DB.all(
      'SELECT * FROM instance_groups WHERE owner_key IN (' + placeholders + ')',
      ownerKeys
    )) {
      groups.set(String(group.id), group);
    }
  }
  return rows.map((row) => {
    const group = groups.get(String(row.group_id)) || defaultGroup;
    return buildDTO(DB, row, group, baseUrl, caches);
  });
}

// ────────────────────────────── 路由入口 ──────────────────────────────

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, query, body } = ctx;
  Auth.requireAlliance();

  const user = Auth.user() || {};
  const ownerKey = Auth.ownerKey();
  const username = Auth.allianceUsername();
  const schoolId = Auth.schoolId() || 0;
  const userId = parseInt(user.user_id ?? 0, 10) || 0;
  const baseUrl = baseUrlFromRequest(req);

  if (!username) {
    Response.error('此功能仅限智教联盟账户使用（需要网页/数据空间中的 /.cloud/ 云文件）', 403, 403);
  }

  const method = req.method;
  const action = query.action ?? '';

  // ── 概览 ──
  if (method === 'GET' && action === 'overview') {
    const group = ensureGroup(DB, ownerKey, user, '');
    const rows = listRows(DB, ownerKey);
    const urls = staticControlApp.urls(baseUrl, group.dir_id, null);
    Response.success({
      group: {
        id: group.id,
        dir_id: group.dir_id,
        name: group.name,
        created_at: group.created_at,
        updated_at: group.updated_at || group.created_at,
      },
      base_url: baseUrl,
      manifest_url: urls.manifest,
      file_url_template: urls.file_template,
      instances: buildDTOs(DB, rows, group, baseUrl),
    });
  }

  // ── 实例列表 ──
  if (method === 'GET' && action === 'list') {
    const group = findGroup(DB, ownerKey);
    const rows = listRows(DB, ownerKey);
    Response.success(buildDTOs(DB, rows, group, baseUrl));
  }

  // ── 实例详情 ──
  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少实例 ID（id）');
    const row = DB.one(
      'SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key = ?',
      [id, ownerKey, APP_KEY]
    );
    if (!row) Response.error('配置实例不存在或无权访问', 403, 403);
    const group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [row.group_id]) || null;
    Response.success(buildDTO(DB, row, group, baseUrl, {
      files: new Map(), validations: new Map(), versions: new Map(),
    }));
  }

  // ── 新建分发 ──
  if (method === 'POST' && action === 'create') {
    const resolved = resolveOwnedCloudFile(DB, body.file_id, username);
    if (resolved.error) Response.error(resolved.error, 1, resolved.status || 400);
    const file = resolved.file;

    const validation = staticControlApp.validateContent(file.content, file.file_path);
    if (!validation.ok) {
      Response.error('源文件不是有效的 CSES 文档：' + validation.error);
    }

    const group = ensureGroup(DB, ownerKey, user, body.group_name);
    const explicitId = body.instance_id !== undefined && body.instance_id !== null
      && String(body.instance_id).trim() !== '';

    let instanceName;
    if (explicitId) {
      instanceName = String(body.instance_id).trim();
      if (!convert.validInstanceId(instanceName)) {
        Response.error('实例标识不合法（不能包含 / \\ : * ? " < > |、不能包含 .. 且不能以 . 开头）');
      }
      const duplicate = DB.one(
        'SELECT id, name FROM instances WHERE group_id = ? AND name = ?',
        [group.id, instanceName]
      );
      if (duplicate) {
        Response.error(
          '实例标识「' + instanceName + '」已存在，请修改实例标识或更新现有实例',
          1,
          400,
          { existing_id: duplicate.id, existing_name: duplicate.name }
        );
      }
    } else {
      instanceName = uniqueInstanceName(DB, group.id, staticControlApp.defaultInstanceName(file.file_path));
    }

    const organizationName = normalizeOrganizationName(body.organization_name, group.dir_id);
    const now = nowStr();
    const instanceUid = 'inst-' + crypto.randomBytes(6).toString('hex');
    const config = buildInstanceConfig(organizationName, staticControlApp.basename(file.file_path));

    const id = DB.insert('instances', {
      school_id: schoolId,
      app_id: null,
      app_key: APP_KEY,
      name: instanceName,
      service_type: '静态集控',
      status: 'running',
      owner_user_id: userId,
      owner_type: user.type || 'alliance',
      owner_key: ownerKey,
      instance_uid: instanceUid,
      group_id: group.id,
      source_file_id: file.id,
      config: JSON.stringify(config),
      created_at: now,
      updated_at: now,
    });
    DB.update('instance_groups', { updated_at: now }, 'id = ?', [group.id]);

    Auth.logAudit(
      schoolId,
      userId,
      'distribution_create',
      `创建配置实例 ${instanceName}（源文件 ${file.file_path}，组 ${group.dir_id}）`
    );

    const row = DB.one('SELECT * FROM instances WHERE id = ?', [id]);
    Response.success(buildDTO(DB, row, group, baseUrl, {
      files: new Map(), validations: new Map(), versions: new Map(),
    }), '分发配置已创建');
  }

  // ── 更新分发 ──
  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少实例 ID（id）');

    const row = DB.one(
      'SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key = ?',
      [id, ownerKey, APP_KEY]
    );
    if (!row) Response.error('配置实例不存在或无权修改', 403, 403);

    const group = DB.one('SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?', [row.group_id, ownerKey]);
    if (!group) Response.error('配置实例所属实例组不存在，请重新创建分发', 404, 404);

    const updates = {};
    const config = parseConfig(row.config);
    let changed = false;

    if (body.instance_id !== undefined && body.instance_id !== null) {
      const nextName = String(body.instance_id).trim();
      if (nextName === '') Response.error('实例标识不能为空');
      if (nextName !== row.name) {
        if (!convert.validInstanceId(nextName)) {
          Response.error('实例标识不合法（不能包含 / \\ : * ? " < > |、不能包含 .. 且不能以 . 开头）');
        }
        const duplicate = DB.one(
          'SELECT id, name FROM instances WHERE group_id = ? AND name = ? AND id != ?',
          [group.id, nextName, id]
        );
        if (duplicate) {
          Response.error(
            '实例标识「' + nextName + '」已被占用，请使用其他名称',
            1,
            400,
            { existing_id: duplicate.id, existing_name: duplicate.name }
          );
        }
        updates.name = nextName;
        changed = true;
      }
    }

    if (body.organization_name !== undefined) {
      const nextOrganizationName = normalizeOrganizationName(body.organization_name, group.dir_id);
      if (nextOrganizationName !== config.organization_name) {
        config.organization_name = nextOrganizationName;
        changed = true;
      }
    }

    if (body.file_id !== undefined && body.file_id !== null && body.file_id !== '') {
      const nextFileId = parseInt(body.file_id, 10) || 0;
      if (nextFileId !== (parseInt(row.source_file_id, 10) || 0)) {
        const resolved = resolveOwnedCloudFile(DB, nextFileId, username);
        if (resolved.error) Response.error(resolved.error, 1, resolved.status || 400);
        const file = resolved.file;
        const validation = staticControlApp.validateContent(file.content, file.file_path);
        if (!validation.ok) {
          Response.error('源文件不是有效的 CSES 文档：' + validation.error);
        }
        updates.source_file_id = file.id;
        config.file_name = staticControlApp.basename(file.file_path);
        changed = true;
      }
    }

    if (!changed) {
      // 幂等：没有实际变化时直接返回当前实例（编辑器里仅点「保存」不应报错）
      Response.success(buildDTO(DB, row, group, baseUrl, {
        files: new Map(), validations: new Map(), versions: new Map(),
      }), '分发配置未变化');
    }

    const now = nowStr();
    config.format = 'classisland';
    updates.config = JSON.stringify(config);
    updates.updated_at = now;
    DB.update('instances', updates, 'id = ? AND owner_key = ?', [id, ownerKey]);
    DB.update('instance_groups', { updated_at: now }, 'id = ?', [group.id]);

    Auth.logAudit(schoolId, userId, 'distribution_update', `更新配置实例 ${updates.name || row.name}（组 ${group.dir_id}）`);

    const updated = DB.one('SELECT * FROM instances WHERE id = ?', [id]);
    Response.success(buildDTO(DB, updated, group, baseUrl, {
      files: new Map(), validations: new Map(), versions: new Map(),
    }), '分发配置已更新');
  }

  // ── 删除分发 ──
  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少实例 ID（id）');

    const row = DB.one(
      'SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key = ?',
      [id, ownerKey, APP_KEY]
    );
    if (!row) Response.error('配置实例不存在或无权删除', 403, 403);

    DB.delete('instances', 'id = ? AND owner_key = ?', [id, ownerKey]);
    if (row.group_id) {
      DB.update('instance_groups', { updated_at: nowStr() }, 'id = ?', [row.group_id]);
    }
    Auth.logAudit(schoolId, userId, 'distribution_delete', `删除配置实例 ${row.name}（id=${id}）`);

    Response.success(null, '分发实例已删除');
  }

  // ── 源文件校验 ──
  if (method === 'POST' && action === 'validate') {
    const resolved = resolveOwnedCloudFile(DB, body.file_id, username);
    if (resolved.error) Response.error(resolved.error, 1, resolved.status || 400);
    const file = resolved.file;

    const group = ensureGroup(DB, ownerKey, user, '');
    const validation = staticControlApp.validateContent(file.content, file.file_path);
    const fileName = staticControlApp.basename(file.file_path);
    const defaultInstanceId = staticControlApp.defaultInstanceName(file.file_path);
    const existing = DB.one(
      'SELECT id, name FROM instances WHERE group_id = ? AND name = ?',
      [group.id, defaultInstanceId]
    );

    Response.success({
      ok: validation.ok === true,
      error: validation.ok ? null : validation.error,
      file_id: file.id,
      file_name: fileName,
      file_path: file.file_path,
      file_updated_at: file.updated_at || '',
      default_instance_id: defaultInstanceId,
      document: validation.ok ? validation.document : null,
      stats: validation.ok ? validation.stats : null,
      classplans: validation.ok ? validation.classplans : 0,
      timelayouts: validation.ok ? validation.timelayouts : 0,
      warnings: validation.ok ? validation.warnings : [],
      group: { id: group.id, dir_id: group.dir_id, name: group.name },
      existing_instance: existing ? { id: existing.id, name: existing.name } : null,
    });
  }

  // ── 下载 ClassIsland 管理清单（附件） ──
  if (method === 'GET' && action === 'manifest') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少实例 ID（id）');

    const row = DB.one(
      'SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key = ?',
      [id, ownerKey, APP_KEY]
    );
    if (!row) Response.error('配置实例不存在或无权访问', 403, 403);

    const group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [row.group_id]);
    if (!group || !group.dir_id) Response.error('配置实例所属实例组不存在，请重新创建分发', 404, 404);

    const manifestUrl = staticControlApp.urls(baseUrl, group.dir_id, row.name).manifest;
    const profile = staticControlApp.managementProfile(manifestUrl);
    const fileName = 'ClassIsland-Management-' + group.dir_id + '.json';

    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + fileName + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileName)
    );
    res.end(JSON.stringify(profile, null, 2));
    throw new ctx.HttpSent();
  }

  Response.error('未知的操作', 405, 405);
};
