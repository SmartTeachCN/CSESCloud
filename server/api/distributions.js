/**
 * 配置分发 / 实例管理 API（V3 · 多格式）。
 *
 * 轻编辑器「分发配置」与「配置实例管理」共用：
 *   - GET  action=overview   当前所有者的分发概览（实例组 + 地址模板 + 实例列表）
 *   - GET  action=list       配置实例列表（InstanceDTO[]）
 *   - GET  action=get&id=N   配置实例详情（InstanceDTO）
 *   - POST action=create     { file_id, instance_id?, organization_name?, group_name? } → InstanceDTO
 *   - POST action=update     { id, instance_id?, organization_name?, file_id? }        → InstanceDTO
 *   - POST action=delete     { id }                                                    → null
 *   - POST action=validate   { file_id } → 格式识别 / 校验统计 / 地址预览
 *   - GET  action=manifest&id=N → ClassIsland「加入管理」清单（附件下载，仅 classisland 格式）
 *
 * 分发格式（由源文件内容自动识别，见 server/lib/distribution-formats.js）：
 *   - classisland  ClassIsland 档案 → 实例应用 classisland，静态集控（清单 + 六类数据源）
 *   - cses         CSES 配置       → 实例应用 cses_config，公开配置地址（原文件内容）
 *   - examaware    ExamAware 配置  → 实例应用 examaware，公开配置地址（原文件内容）
 *
 * 数据模型：
 *   - 每个所有者只有一个默认实例组（惰性创建，`dir_id` 为 12 位小写字母/数字）；
 *   - 一条 `instances` 记录 = 一个配置实例；
 *   - 源文件必须是当前联盟用户 `/.cloud/` 目录下的 `web_hosting_files`；
 *   - 源文件内容实时读取，地址版本号取源文件/组内源文件 updated_at 的 Unix 秒。
 */
'use strict';

const crypto = require('crypto');
const { nowStr } = require('../lib/response');
const convert = require('../lib/classisland-convert');
const formats = require('../lib/distribution-formats');
const classislandApp = require('../apps/classisland');
const { baseUrlFromRequest } = require('../lib/static-control-public');

const CLOUD_PREFIX = '/.cloud/';
const DEFAULT_GROUP_NAME = '配置分发';
const APP_KEYS = formats.ALL_APP_KEYS;
const DIR_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// ────────────────────────────── 辅助函数 ──────────────────────────────

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
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
  return ('a' + crypto.randomBytes(8).toString('hex')).slice(0, 12);
}

function findGroup(DB, ownerKey) {
  return DB.one(
    "SELECT * FROM instance_groups WHERE owner_key = ? AND dir_id IS NOT NULL AND dir_id != '' ORDER BY id ASC LIMIT 1",
    [ownerKey]
  );
}

/** 惰性创建 / 获取默认分发实例组。 */
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

  if (desiredName && desiredName !== group.name) {
    DB.update('instance_groups', { name: desiredName, updated_at: now }, 'id = ?', [group.id]);
    group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [group.id]);
  }
  return group;
}

/** 校验源文件：当前联盟用户 `/.cloud/` 下的文件。 */
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

/** 实例标识清洗（与 convert.validInstanceId 规则一致）。 */
function sanitizeInstanceName(value) {
  let result = String(value === undefined || value === null ? '' : value);
  result = result.replace(/[\/\\:*?"<>|\x00-\x1F]/g, '-').replace(/\.\./g, '-').replace(/^\.+/, '-').trim();
  while (Buffer.byteLength(result, 'utf8') > 180) result = result.slice(0, -1);
  result = result.trim();
  return result === '' ? 'instance' : result;
}

/** 由文件名生成默认实例标识（去掉扩展名并清洗）。 */
function defaultInstanceName(filePath) {
  const base = formats.basename(filePath);
  const pos = base.lastIndexOf('.');
  return sanitizeInstanceName(pos > 0 ? base.slice(0, pos) : base);
}

/** 实例标识组内去重。 */
function uniqueInstanceName(DB, groupId, baseName) {
  const base = sanitizeInstanceName(baseName || 'instance');
  let candidate = base;
  let counter = 2;
  while (DB.one('SELECT id FROM instances WHERE group_id = ? AND name = ?', [groupId, candidate])) {
    const suffix = '-' + counter;
    let stem = base;
    while (Buffer.byteLength(stem + suffix, 'utf8') > 180) stem = stem.slice(0, -1);
    candidate = stem + suffix;
    counter++;
    if (counter > 9999) {
      candidate = sanitizeInstanceName(base + '-' + crypto.randomBytes(2).toString('hex'));
      break;
    }
  }
  return candidate;
}

function normalizeOrganizationName(value, dirId) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text !== '') return text.slice(0, 200);
  return convert.defaultOrganizationName(dirId);
}

function buildInstanceConfig(format, appKey, organizationName, fileName, ext) {
  return {
    format: format,
    app_key: appKey,
    organization_name: organizationName,
    file_name: fileName,
    ext: ext || '',
  };
}

/** 当前所有者可见的配置实例（三种分发应用）。 */
function listRows(DB, ownerKey) {
  const placeholders = APP_KEYS.map(() => '?').join(',');
  return DB.all(
    `SELECT * FROM instances WHERE owner_key = ? AND app_key IN (${placeholders}) ORDER BY id ASC`,
    [ownerKey, ...APP_KEYS]
  );
}

function fileOfInstance(DB, row, caches) {
  const fileId = parseInt(row.source_file_id, 10) || 0;
  if (!fileId) return null;
  if (!caches.files.has(fileId)) {
    caches.files.set(fileId, DB.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [fileId]));
  }
  return caches.files.get(fileId);
}

function formatInfoOfRow(row) {
  const byApp = formats.formatOfApp(row.app_key);
  if (byApp) return byApp;
  const config = parseConfig(row.config);
  return formats.getFormatInfo(config.format) || formats.getFormatInfo('classisland');
}

/** 构造 InstanceDTO。 */
function buildDTO(DB, row, group, baseUrl, caches) {
  const config = parseConfig(row.config);
  const file = fileOfInstance(DB, row, caches);
  const info = formatInfoOfRow(row) || formats.getFormatInfo('classisland');
  const format = info.format;
  const mode = info.mode;
  const ext = file ? formats.extOfPath(file.file_path) : (config.ext || '');

  let valid = false;
  let warning = '';
  if (!file) {
    warning = '源文件不存在或已被删除，请重新选择源文件';
  } else {
    if (!caches.validations.has(file.id)) {
      caches.validations.set(file.id, formats.validateContent(file.content, file.file_path));
    }
    const validation = caches.validations.get(file.id);
    valid = validation.ok === true;
    warning = validation.ok ? (validation.warnings || []).join('；') : (validation.error || '源文件不是可分发的配置');
  }

  const groupDirId = group && group.dir_id ? group.dir_id : '';
  let version = 0;
  if (file) version = classislandApp.toUnixSeconds(file.updated_at);
  if (mode === 'static' && group && group.id) {
    if (!caches.versions.has(group.id)) {
      caches.versions.set(group.id, groupDirId ? classislandApp.version(DB, group.id) : 0);
    }
    version = caches.versions.get(group.id);
  }

  let urls = { kind: mode };
  if (groupDirId) {
    if (mode === 'static') {
      urls = classislandApp.urls(baseUrl, groupDirId);
    } else {
      urls = {
        kind: 'url',
        source: formats.rawConfigUrl(baseUrl, groupDirId, row.name, ext),
      };
    }
  }

  return {
    id: row.id,
    instance_uid: row.instance_uid || '',
    name: row.name,
    app_key: row.app_key,
    format: format,
    format_label: info.label,
    format_mode: mode,
    source_file_id: file ? file.id : (parseInt(row.source_file_id, 10) || null),
    source_file_name: file ? formats.basename(file.file_path) : '',
    source_file_type: ext,
    source_updated_at: file ? (file.updated_at || '') : '',
    group_id: row.group_id,
    group_dir_id: groupDirId,
    organization_name: (config.organization_name && String(config.organization_name).trim())
      || (groupDirId ? convert.defaultOrganizationName(groupDirId) : ''),
    status: row.status || 'running',
    created_at: row.created_at || '',
    updated_at: row.updated_at || row.created_at || '',
    version: version,
    urls: urls,
    valid: valid,
    warning: warning,
  };
}

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

/** 构造 validate 响应中的地址预览。 */
function buildPreviewUrls(baseUrl, dirId, instanceId, format, file) {
  const info = formats.getFormatInfo(format);
  if (!info) return { kind: 'static' };
  if (info.mode === 'static') return classislandApp.urls(baseUrl, dirId);
  const ext = file ? formats.extOfPath(file.file_path) : '';
  return { kind: 'url', source: formats.rawConfigUrl(baseUrl, dirId, instanceId, ext) };
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
    Response.success({
      group: {
        id: group.id,
        dir_id: group.dir_id,
        name: group.name,
        created_at: group.created_at,
        updated_at: group.updated_at || group.created_at,
      },
      base_url: baseUrl,
      formats: Object.values(formats.FORMATS),
      instances: buildDTOs(DB, rows, group, baseUrl),
    });
  }

  // ── 实例列表 / 详情 ──
  if (method === 'GET' && action === 'list') {
    const group = findGroup(DB, ownerKey);
    const rows = listRows(DB, ownerKey);
    Response.success(buildDTOs(DB, rows, group, baseUrl));
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少实例 ID（id）');
    const row = DB.one(
      `SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})`,
      [id, ownerKey, ...APP_KEYS]
    );
    if (!row) Response.error('配置实例不存在或无权访问', 403, 403);
    const group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [row.group_id]) || null;
    Response.success(buildDTO(DB, row, group, baseUrl, {
      files: new Map(), validations: new Map(), versions: new Map(),
    }));
  }

  // ── 源文件校验 / 格式识别 ──
  if (method === 'POST' && action === 'validate') {
    const resolved = resolveOwnedCloudFile(DB, body.file_id, username);
    if (resolved.error) Response.error(resolved.error, 1, resolved.status || 400);
    const file = resolved.file;

    const group = ensureGroup(DB, ownerKey, user, '');
    const validation = formats.validateContent(file.content, file.file_path);
    const fileName = formats.basename(file.file_path);
    const defaultId = defaultInstanceName(file.file_path);
    const existing = DB.one(
      'SELECT id, name FROM instances WHERE group_id = ? AND name = ?',
      [group.id, defaultId]
    );

    if (!validation.ok) {
      Response.success({
        ok: false,
        error: validation.error,
        file_id: file.id,
        file_name: fileName,
        file_path: file.file_path,
        file_updated_at: file.updated_at || '',
        format: null,
        format_label: '',
        mode: '',
        default_instance_id: defaultId,
        document: null,
        stats: null,
        warnings: [],
        group: { id: group.id, dir_id: group.dir_id, name: group.name },
        existing_instance: existing ? { id: existing.id, name: existing.name } : null,
        urls: null,
      });
    }

    const info = validation.formatInfo;
    Response.success({
      ok: true,
      error: null,
      file_id: file.id,
      file_name: fileName,
      file_path: file.file_path,
      file_updated_at: file.updated_at || '',
      format: validation.format,
      format_label: info.label,
      mode: info.mode,
      default_instance_id: defaultId,
      document: validation.stats,
      stats: validation.stats,
      warnings: validation.warnings,
      group: { id: group.id, dir_id: group.dir_id, name: group.name },
      existing_instance: existing ? { id: existing.id, name: existing.name } : null,
      urls: buildPreviewUrls(baseUrl, group.dir_id, defaultId, validation.format, file),
    });
  }

  // ── 新建分发 ──
  if (method === 'POST' && action === 'create') {
    const resolved = resolveOwnedCloudFile(DB, body.file_id, username);
    if (resolved.error) Response.error(resolved.error, 1, resolved.status || 400);
    const file = resolved.file;

    const validation = formats.validateContent(file.content, file.file_path);
    if (!validation.ok) Response.error('源文件不是可分发配置：' + validation.error);
    const info = validation.formatInfo;

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
      instanceName = uniqueInstanceName(DB, group.id, defaultInstanceName(file.file_path));
    }

    const organizationName = normalizeOrganizationName(body.organization_name, group.dir_id);
    const now = nowStr();
    const instanceUid = 'inst-' + crypto.randomBytes(6).toString('hex');
    const fileName = formats.basename(file.file_path);
    const ext = formats.extOfPath(file.file_path);
    const config = buildInstanceConfig(validation.format, info.appKey, organizationName, fileName, ext);

    const id = DB.insert('instances', {
      school_id: schoolId,
      app_id: null,
      app_key: info.appKey,
      name: instanceName,
      service_type: info.label,
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
      `创建${info.label}实例 ${instanceName}（源文件 ${file.file_path}，组 ${group.dir_id}）`
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
      `SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})`,
      [id, ownerKey, ...APP_KEYS]
    );
    if (!row) Response.error('配置实例不存在或无权修改', 403, 403);

    const group = DB.one('SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?', [row.group_id, ownerKey]);
    if (!group) Response.error('配置实例所属实例组不存在，请重新创建分发', 404, 404);

    const updates = {};
    const config = parseConfig(row.config);
    let changed = false;
    let newFormatInfo = formatInfoOfRow(row);
    let newFileName = config.file_name || '';
    let newExt = config.ext || '';

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
        const validation = formats.validateContent(file.content, file.file_path);
        if (!validation.ok) Response.error('源文件不是可分发配置：' + validation.error);
        newFormatInfo = validation.formatInfo;
        newFileName = formats.basename(file.file_path);
        newExt = formats.extOfPath(file.file_path);
        updates.source_file_id = file.id;
        updates.app_key = newFormatInfo.appKey;
        updates.service_type = newFormatInfo.label;
        config.format = validation.format;
        config.app_key = newFormatInfo.appKey;
        config.file_name = newFileName;
        config.ext = newExt;
        changed = true;
      }
    }

    if (!changed) {
      Response.success(buildDTO(DB, row, group, baseUrl, {
        files: new Map(), validations: new Map(), versions: new Map(),
      }), '分发配置未变化');
    }

    const now = nowStr();
    config.format = newFormatInfo.format;
    config.app_key = newFormatInfo.appKey;
    config.file_name = newFileName;
    config.ext = newExt;
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
      `SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})`,
      [id, ownerKey, ...APP_KEYS]
    );
    if (!row) Response.error('配置实例不存在或无权删除', 403, 403);

    DB.delete('instances', 'id = ? AND owner_key = ?', [id, ownerKey]);
    if (row.group_id) {
      DB.update('instance_groups', { updated_at: nowStr() }, 'id = ?', [row.group_id]);
    }
    Auth.logAudit(schoolId, userId, 'distribution_delete', `删除配置实例 ${row.name}（id=${id}）`);

    Response.success(null, '分发实例已删除');
  }

  // ── 下载 ClassIsland 管理清单（仅 classisland 格式） ──
  if (method === 'GET' && action === 'manifest') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少实例 ID（id）');

    const row = DB.one(
      `SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})`,
      [id, ownerKey, ...APP_KEYS]
    );
    if (!row) Response.error('配置实例不存在或无权访问', 403, 403);

    const info = formatInfoOfRow(row);
    if (!info || info.mode !== 'static') {
      Response.error('该分发类型不提供集控清单文件，请直接使用配置地址', 1, 400);
    }

    const group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [row.group_id]);
    if (!group || !group.dir_id) Response.error('配置实例所属实例组不存在，请重新创建分发', 404, 404);

    const manifestUrl = classislandApp.urls(baseUrl, group.dir_id).manifest;
    const profile = classislandApp.managementProfile(manifestUrl);
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
