/**
 * ClassIsland 静态集控 —— NodeJS 实例云应用模块（app_key = `classisland`）。
 *
 * 源文件为 ClassIsland 档案（Profile JSON，含 `ClassPlans` / `TimeLayouts` / `Subjects`）：
 *   一条 `instances` 记录 = 一个配置实例（`app_key = 'classisland'`），
 *   对外提供 ClassIsland 2.0 静态集控清单与六类数据源：
 *     GET /classisland/manifest?id=<实例组标识>
 *     GET /classisland/file?id=<实例组标识>/<实例标识>&key=<数据源>
 *
 * 与 CSES 分发不同：本应用不再做 CSES → ClassIsland 的转换，而是直接读取档案内容；
 * 若档案中带有 Settings / Policy / Credentials 区块则原样输出，否则输出空对象。
 */
'use strict';

const convert = require('../../lib/classisland-convert');
const formats = require('../../lib/distribution-formats');

const appKey = 'classisland';
const name = 'ClassIsland 静态集控';
const description = '把 ClassIsland 档案作为实例应用分发，提供 ClassIsland 2.0 静态集控清单与六类数据源';

const CLOUD_PREFIX = '/.cloud/';

function fail(error, status) {
  return { error: error, status: status || 400 };
}

/** 'YYYY-MM-DD HH:mm:ss'（Asia/Shanghai）或 Date 转 Unix 秒；无法解析返回 0。 */
function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
  }
  const text = String(value);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  const ms = m
    ? Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00')
    : Date.parse(text);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/** 按对外实例组标识查实例组。 */
function resolveGroup(db, dirId) {
  if (!convert.validDirId(dirId)) return fail('实例组标识不合法', 400);
  const group = db.one('SELECT * FROM instance_groups WHERE dir_id = ?', [dirId]);
  if (!group) {
    return fail('实例组不存在或还没有任何 ClassIsland 配置实例', 404);
  }
  return { group: group };
}

/** 解析「实例组标识 + 实例标识」对应实例与源文件。 */
function resolveInstance(db, dirId, instanceId) {
  const groupResult = resolveGroup(db, dirId);
  if (groupResult.error) return groupResult;
  if (!convert.validInstanceId(instanceId)) return fail('实例标识不合法', 400);

  const group = groupResult.group;
  const instance = db.one(
    'SELECT * FROM instances WHERE group_id = ? AND name = ? AND app_key = ?',
    [group.id, instanceId, appKey]
  );
  if (!instance) {
    return fail('找不到该 ClassIsland 配置实例，请确认实例标识是否与 CSES Cloud 中的一致', 404);
  }

  const sourceFileId = parseInt(instance.source_file_id, 10) || 0;
  const file = sourceFileId > 0
    ? db.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [sourceFileId])
    : null;
  if (!file) return fail('找不到该实例的源文件，请重新选择源文件', 404);

  const parsed = formats.parseContent(file.content, file.file_path);
  if (!parsed.ok) return fail(parsed.error, 404);

  return { instance: instance, group: group, file: file, document: parsed.document };
}

/** 实例组静态集控版本：组内 ClassIsland 实例源文件 updated_at 最大值的 Unix 秒。 */
function version(db, groupId) {
  let rows = [];
  try {
    rows = db.all(
      `SELECT f.updated_at AS updated_at
       FROM instances i
       JOIN web_hosting_files f ON f.id = i.source_file_id
       WHERE i.group_id = ? AND i.app_key = ?`,
      [groupId, appKey]
    );
  } catch (_) {
    rows = [];
  }
  let max = 0;
  for (const row of rows) {
    const ts = toUnixSeconds(row.updated_at);
    if (ts > max) max = ts;
  }
  return max;
}

/** 取实例组的管理组织名称（优先实例 config 中的 organization_name）。 */
function organizationNameOfGroup(db, group) {
  try {
    const row = db.one(
      'SELECT config FROM instances WHERE group_id = ? AND app_key = ? ORDER BY id ASC LIMIT 1',
      [group.id, appKey]
    );
    if (row && row.config) {
      const cfg = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
      const org = cfg && typeof cfg.organization_name === 'string' ? cfg.organization_name.trim() : '';
      if (org !== '') return org;
    }
  } catch (_) { /* 回退默认 */ }
  return convert.defaultOrganizationName(group.dir_id);
}

/** 生成 ClassIsland 2.0 静态集控清单。 */
function manifest(db, dirId, baseUrl, options) {
  const opts = options || {};
  const groupResult = resolveGroup(db, dirId);
  if (groupResult.error) return groupResult;

  const group = groupResult.group;
  const dataVersion = version(db, group.id);
  if (dataVersion === 0) {
    return fail('该实例组还没有可用的 ClassIsland 配置实例，请先在轻编辑器中分发配置', 404);
  }

  const organizationName = opts.organizationName || organizationNameOfGroup(db, group);
  return {
    json: convert.manifest(dirId, dataVersion, baseUrl, organizationName),
    group: group,
    version: dataVersion,
  };
}

/** 忽略大小写读取对象键（只接受普通对象）。 */
function pickObjectValue(doc, candidates) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const keys = Object.keys(doc);
  for (const candidate of candidates) {
    const found = keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (found !== undefined && doc[found] && typeof doc[found] === 'object' && !Array.isArray(doc[found])) {
      return doc[found];
    }
  }
  return null;
}

/** 六类数据源 → ClassIsland 档案中的取数规则。 */
const SOURCE_FIELDS = {
  classplans: ['ClassPlans', 'ClassPlan'],
  timelayouts: ['TimeLayouts', 'TimeLayout'],
  subjects: ['Subjects', 'Subject'],
  settings: ['Settings', 'DefaultSettings'],
  policy: ['Policy', 'ManagementPolicy'],
  credentials: ['Credentials', 'Credential', 'ManagementCredentialConfig'],
};

/**
 * 按数据源取 ClassIsland 文档。
 *
 * 三个档案数据源（ClassPlans / TimeLayouts / Subjects）按 ClassIsland 静态集控协议返回
 * Profile 结构（只填充请求的区块，其余为空对象）；Policy / Credentials / Settings 直接返回。
 *
 * @returns {{json:object, ...}|{error:string, status:number, validKeys?:string[]}}
 */
function payload(db, dirId, instanceId, key) {
  const resolved = resolveInstance(db, dirId, instanceId);
  if (resolved.error) return resolved;

  const normalized = String(key === undefined || key === null ? '' : key).toLowerCase();
  const fields = SOURCE_FIELDS[normalized];
  if (!fields) {
    return {
      error: '不支持的数据源：' + key,
      status: 400,
      validKeys: convert.DATA_SOURCE_KEYS.slice(),
    };
  }

  let json;
  if (normalized === 'classplans' || normalized === 'timelayouts' || normalized === 'subjects') {
    const sectionName = normalized === 'classplans'
      ? 'ClassPlans'
      : (normalized === 'timelayouts' ? 'TimeLayouts' : 'Subjects');
    const out = {
      Name: typeof resolved.document.Name === 'string' ? resolved.document.Name : '',
      ClassPlans: {},
      TimeLayouts: {},
      Subjects: {},
    };
    out[sectionName] = pickObjectValue(resolved.document, fields) || {};
    json = out;
  } else {
    json = pickObjectValue(resolved.document, fields) || {};
  }

  return {
    json: json,
    document: resolved.document,
    file: resolved.file,
    instance: resolved.instance,
    group: resolved.group,
  };
}

/** 生成静态集控地址（NodeJS 原生路径）。 */
function urls(baseUrl, dirId) {
  const base = String(baseUrl === undefined || baseUrl === null ? '' : baseUrl).replace(/\/+$/, '');
  const dir = convert.rawUrlEncode(dirId);
  return {
    kind: 'static',
    manifest: base + '/classisland/manifest?id=' + dir,
    file_template: base + '/classisland/file?id=' + dir + '/{id}&key={key}',
  };
}

/** ClassIsland「加入管理」使用的管理清单下载对象。 */
function managementProfile(manifestUrl) {
  return {
    ManagementServerKind: 0,
    ManagementServer: '',
    ManagementServerGrpc: '',
    ManifestUrlTemplate: String(manifestUrl === undefined || manifestUrl === null ? '' : manifestUrl),
  };
}

module.exports = {
  appKey: appKey,
  name: name,
  description: description,
  CLOUD_PREFIX: CLOUD_PREFIX,
  resolveGroup: resolveGroup,
  resolveInstance: resolveInstance,
  version: version,
  manifest: manifest,
  payload: payload,
  urls: urls,
  managementProfile: managementProfile,
  organizationNameOfGroup: organizationNameOfGroup,
  toUnixSeconds: toUnixSeconds,
};
