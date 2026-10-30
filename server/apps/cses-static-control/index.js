/**
 * CSES 静态集控 —— NodeJS 云应用模块（app_key = `cses_static_control`）。
 *
 * 一条 `instances` 记录 = 一个配置实例：
 *   - `instance_groups.dir_id`          对外公开的实例组标识（ClassIsland 清单 URL 参数）
 *   - `instances.name`                  ClassIsland 侧填写的「实例标识」
 *   - `instances.source_file_id`        轻编辑器源文件（web_hosting_files.id，/.cloud/ 下）
 *   - `instances.config`                `{ "format": "classisland", "organization_name": "...", "file_name": "..." }`
 *
 * 源文件内容实时读取（不复制），CSES 文档 → ClassIsland 2.0 结构的转换全部在
 * `server/lib/classisland-convert.js` 中完成（convert.php 的 1:1 移植）。
 *
 * 错误约定（与 PHP 参考实现一致）：失败返回 `{ error, status }`，成功返回对应数据对象；
 * 公开接口（server/lib/static-control-public.js）根据 status/error 输出 400/404。
 */
'use strict';

const yaml = require('js-yaml');
const convert = require('../../lib/classisland-convert');

const appKey = 'cses_static_control';
const name = 'CSES 静态集控';
const description = '把轻编辑器中的 CSES 配置文件分发为 ClassIsland 2.0 静态集控数据源（集控清单 + 六类数据源）';

/** 轻编辑器云文件所在隐藏目录前缀（与 server/api/cloud-files.js 一致）。 */
const CLOUD_PREFIX = '/.cloud/';

// ────────────────────────────── 基础工具 ──────────────────────────────

function fail(error, status) {
  return { error: error, status: status || 400 };
}

/** 路径取 basename（兼容 `/` 与 `\`）。 */
function basename(filePath) {
  const p = String(filePath === undefined || filePath === null ? '' : filePath);
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/** 路径取扩展名（小写，无扩展名返回 ''）。 */
function extOfPath(filePath) {
  const base = basename(filePath);
  const pos = base.lastIndexOf('.');
  if (pos <= 0) return '';
  return base.slice(pos + 1).toLowerCase();
}

/** web_hosting_files.content（BLOB / TEXT）转 UTF-8 文本。 */
function textOfContent(content) {
  if (content === null || content === undefined) return '';
  if (Buffer.isBuffer(content)) return content.toString('utf8');
  if (content instanceof Uint8Array) return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('utf8');
  return String(content);
}

/** 由文件名生成默认实例标识（去掉扩展名并清洗非法字符）。 */
function defaultInstanceName(filePath) {
  const base = basename(filePath);
  const pos = base.lastIndexOf('.');
  const stem = pos > 0 ? base.slice(0, pos) : base;
  return sanitizeInstanceName(stem);
}

/**
 * 实例标识清洗：
 *   - 禁止 `/ \ : * ? " < > |` 与控制字符；
 *   - 禁止 `..`、禁止首字符为 `.`；
 *   - 空名称回退为 `instance`；
 *   - 超过 180 字节按 UTF-8 截断（与 cses_ci_valid_instance_id 的限制一致）。
 */
function sanitizeInstanceName(value) {
  let result = String(value === undefined || value === null ? '' : value);
  result = result.replace(/[\/\\:*?"<>|\x00-\x1F]/g, '-');
  result = result.replace(/\.\./g, '-');
  result = result.replace(/^\.+/, '-');
  result = result.trim();
  while (Buffer.byteLength(result, 'utf8') > 180) result = result.slice(0, -1);
  result = result.trim();
  if (result === '') result = 'instance';
  return result;
}

/** 文档是否为 CSES 文档（含 version 或 subjects / schedules / extraKey）。 */
function isCsesDocument(doc) {
  if (!convert.isPhpArray(doc)) return false;
  return ('version' in doc)
    || convert.isPhpArray(doc.subjects)
    || convert.isPhpArray(doc.schedules)
    || convert.isPhpArray(doc.extraKey);
}

/**
 * 解析源文件内容。
 * `.json` 用 JSON.parse；其他（含 `.yml` / `.yaml`）用 js-yaml 解析（YAML 是 JSON 的超集，
 * 因此无扩展名/混淆扩展名的 JSON 内容也能解析）。
 *
 * @returns {{document: object}|{error: string}}
 */
function parseDocument(content, fileName) {
  const text = textOfContent(content);
  if (text.trim() === '') return { error: '实例配置内容为空' };
  const ext = extOfPath(fileName);

  if (ext === 'json') {
    try {
      const parsed = JSON.parse(text);
      if (!convert.isPhpArray(parsed)) return { error: '实例配置不是合法的 JSON 文档' };
      return { document: parsed };
    } catch (e) {
      return { error: '实例配置不是合法的 JSON 文档：' + (e && e.message ? e.message : e) };
    }
  }

  try {
    const parsed = yaml.load(text);
    if (convert.isPhpArray(parsed)) return { document: parsed };
  } catch (e) {
    // 继续尝试 JSON（部分 .cses/.txt 内容是纯 JSON）
  }
  try {
    const parsed = JSON.parse(text);
    if (convert.isPhpArray(parsed)) return { document: parsed };
  } catch (e) { /* 忽略 */ }

  return { error: '实例配置不是合法的 YAML / JSON 文档' };
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

// ────────────────────────────── DB 解析 ──────────────────────────────

/**
 * 按对外实例组标识查实例组。
 * @returns {{group: object}|{error: string, status: number}}
 */
function resolveGroup(db, dirId) {
  if (!convert.validDirId(dirId)) return fail('实例组标识不合法', 400);
  const group = db.one('SELECT * FROM instance_groups WHERE dir_id = ?', [dirId]);
  if (!group) {
    return fail('实例组不存在或还没有任何实例，请先在 CSES Cloud 中保存一次实例配置', 404);
  }
  return { group: group };
}

/**
 * 解析「实例组标识 + 实例标识」对应的配置实例与源文件。
 * @returns {{instance: object, group: object, file: object}|{error: string, status: number}}
 */
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
    return fail('找不到该实例的配置，请确认实例名称是否与 CSES Cloud 中的一致', 404);
  }

  const sourceFileId = parseInt(instance.source_file_id, 10) || 0;
  const file = sourceFileId > 0
    ? db.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [sourceFileId])
    : null;
  if (!file) {
    return fail('找不到该实例的配置，请确认实例名称是否与 CSES Cloud 中的一致', 404);
  }

  return { instance: instance, group: group, file: file };
}

/**
 * 实例组集控数据版本：组内所有源文件 updated_at 的最大值的 Unix 秒。
 * 没有任何实例/源文件时返回 0（公开清单接口据此返回 404）。
 */
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
  } catch (e) {
    rows = [];
  }

  let max = 0;
  for (const row of rows) {
    const ts = toUnixSeconds(row.updated_at);
    if (ts > max) max = ts;
  }
  return max;
}

/** 取实例组的管理组织名称（优先第一个实例 config 中的 organization_name）。 */
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
  } catch (e) { /* 忽略：回退默认组织名 */ }
  return convert.defaultOrganizationName(group.dir_id);
}

// ────────────────────────────── 清单 / 数据源 ──────────────────────────────

/**
 * 生成 ClassIsland 2.0 集控清单。
 *
 * @param {object} db
 * @param {string} dirId    实例组标识
 * @param {string} baseUrl  数据源接口地址（如 `https://host/classisland/file.php`）
 * @param {{organizationName?:string, extraQuery?:string}} [options]
 *        extraQuery 供 `/control/file.php?format=ci` 兼容地址使用。
 * @returns {{json: object}|{error: string, status: number}}
 */
function manifest(db, dirId, baseUrl, options) {
  const opts = options || {};
  const groupResult = resolveGroup(db, dirId);
  if (groupResult.error) return groupResult;

  const group = groupResult.group;
  const dataVersion = version(db, group.id);
  if (dataVersion === 0) {
    return fail('实例组不存在或还没有任何实例，请先在 CSES Cloud 中保存一次实例配置', 404);
  }

  const organizationName = opts.organizationName || organizationNameOfGroup(db, group);
  return {
    json: convert.manifest(dirId, dataVersion, baseUrl, organizationName, opts.extraQuery || ''),
    group: group,
    version: dataVersion,
  };
}

/**
 * 取指定数据源的 ClassIsland 文档。
 *
 * @param {object} db
 * @param {string} dirId
 * @param {string} instanceId
 * @param {string} key ClassPlans / TimeLayouts / Subjects / Policy / Credentials / Settings
 * @returns {{json: object, document: object, file: object, instance: object, group: object}|{error: string, status: number, validKeys?: string[]}}
 */
function payload(db, dirId, instanceId, key) {
  const resolved = resolveInstance(db, dirId, instanceId);
  if (resolved.error) return resolved;

  const parsed = parseDocument(resolved.file.content, resolved.file.file_path);
  if (parsed.error) return fail(parsed.error, 404);

  const namespace = 'cses-cloud/' + dirId + '/' + instanceId;
  const document = convert.document(parsed.document, key, namespace);
  if (document === null) {
    return {
      error: '不支持的数据源：' + key,
      status: 400,
      validKeys: convert.DATA_SOURCE_KEYS.slice(),
    };
  }

  return {
    json: document,
    document: parsed.document,
    file: resolved.file,
    instance: resolved.instance,
    group: resolved.group,
  };
}

/**
 * 生成实例组/实例的两类公开地址。
 * @returns {{manifest: string, file_template: string}}
 */
function urls(baseUrl, dirId, instanceId) {
  const base = String(baseUrl === undefined || baseUrl === null ? '' : baseUrl).replace(/\/+$/, '');
  const dir = convert.rawUrlEncode(dirId);
  return {
    manifest: base + '/classisland/manifest.php?id=' + dir,
    file_template: base + '/classisland/file.php?id=' + dir + '/{id}&key={key}',
  };
}

/**
 * ClassIsland「加入管理」使用的管理清单下载对象。
 * 格式参考 CsesWebEditor dev/scripts/storage.js 的「下载清单文件」。
 */
function managementProfile(manifestUrl) {
  return {
    ManagementServerKind: 0,
    ManagementServer: '',
    ManagementServerGrpc: '',
    ManifestUrlTemplate: String(manifestUrl === undefined || manifestUrl === null ? '' : manifestUrl),
  };
}

// ────────────────────────────── 内容校验 ──────────────────────────────

/**
 * 校验源文件内容是否为可用的 CSES 文档，并给出转换统计/警告。
 *
 * @param {Buffer|string} content
 * @param {string} fileName
 * @returns {{ok: true, document: object, stats: object, classplans: number, timelayouts: number, warnings: string[]}|{ok: false, error: string}}
 */
function validateContent(content, fileName) {
  const parsed = parseDocument(content, fileName);
  if (parsed.error) return { ok: false, error: parsed.error };

  const doc = parsed.document;
  if (!isCsesDocument(doc)) {
    return { ok: false, error: '源文件不是 CSES 配置文件（缺少 version / subjects / schedules / extraKey）' };
  }

  const warnings = [];
  const versionNum = Number.isFinite(Number(doc.version)) && doc.version !== ''
    ? Math.trunc(Number(doc.version))
    : null;

  if (!('version' in doc)) {
    warnings.push('文档缺少 version 字段，将按通用 CSES 文档转换');
  } else if (versionNum !== 1 && versionNum !== 2) {
    warnings.push('未知的 CSES 版本：' + doc.version);
  }

  const rawSchedules = Array.isArray(doc.schedules) ? doc.schedules : [];
  const rawSubjects = Array.isArray(doc.subjects) ? doc.subjects : [];
  if (rawSchedules.length === 0) warnings.push('文档中没有课表（schedules），ClassPlans / TimeLayouts 将为空');
  if (rawSubjects.length === 0 && rawSchedules.length > 0) {
    warnings.push('文档中没有科目（subjects），课表中的科目将按名称自动补充');
  }

  if (versionNum === 2) {
    warnings.push('CSES v2 的 configuration（配置名称/描述/周期）不会同步到 ClassIsland，周次使用课表的 weeks 字段（若存在）');
    const hasWeeks = rawSchedules.some((s) => convert.isPhpArray(s) && s.weeks !== undefined && s.weeks !== null);
    if (hasWeeks) {
      warnings.push('CSES v2 文档中的 weeks（单双周）字段不属于 v2 规范，ClassIsland 仍会按该字段转换为单双周');
    }
  }

  // 统计被忽略的课程 / 自动补充的科目 / 周末启用日
  const knownSubjects = new Set(rawSubjects.filter((s) => convert.isPhpArray(s)).map((s) => convert.phpStr(s.name)));
  const missingSubjects = new Set();
  let skippedClasses = 0;
  let weekendSchedules = 0;
  for (const schedule of rawSchedules) {
    if (!convert.isPhpArray(schedule)) continue;
    const days = convert.normDays(schedule.enable_day === undefined ? null : schedule.enable_day);
    if (days.some((d) => d === 6 || d === 7)) weekendSchedules++;
    const classes = Array.isArray(schedule.classes) ? schedule.classes : [];
    for (const cls of classes) {
      if (!convert.isPhpArray(cls)) { skippedClasses++; continue; }
      const start = convert.normTime(cls.start_time === undefined ? null : cls.start_time);
      const end = convert.normTime(cls.end_time === undefined ? null : cls.end_time);
      if (start === '' || end === '') { skippedClasses++; continue; }
      const subjectName = cls.subject === undefined || cls.subject === null ? '' : convert.phpStr(cls.subject);
      if (subjectName !== '' && !knownSubjects.has(subjectName)) missingSubjects.add(subjectName);
    }
  }
  if (skippedClasses > 0) warnings.push('有 ' + skippedClasses + ' 节课程因时间格式不合法被忽略');
  if (missingSubjects.size > 0) {
    warnings.push('课表引用了 subjects 中不存在的科目：' + Array.from(missingSubjects).join('、') + '（将自动补充）');
  }
  if (weekendSchedules > 0) warnings.push('有 ' + weekendSchedules + ' 张课表启用了周末（第 6/7 天）');

  // 用临时命名空间做一次完整转换，得到与公开接口一致的数据量
  const profile = convert.profile(doc, 'cses-cloud/validate/' + sanitizeInstanceName(fileName));
  const classplans = Object.keys(profile.ClassPlans).length;
  const timelayouts = Object.keys(profile.TimeLayouts).length;
  const subjects = Object.keys(profile.Subjects).length;

  return {
    ok: true,
    document: {
      version: versionNum,
      subjects: subjects,
      schedules: rawSchedules.length,
    },
    stats: {
      version: versionNum,
      subjects: subjects,
      schedules: rawSchedules.length,
      classplans: classplans,
      timelayouts: timelayouts,
    },
    classplans: classplans,
    timelayouts: timelayouts,
    warnings: warnings,
  };
}

module.exports = {
  appKey: appKey,
  name: name,
  description: description,
  CLOUD_PREFIX: CLOUD_PREFIX,
  // spec 3.2 导出
  resolveGroup: resolveGroup,
  resolveInstance: resolveInstance,
  version: version,
  manifest: manifest,
  payload: payload,
  urls: urls,
  managementProfile: managementProfile,
  validateContent: validateContent,
  // 供 API 层 / 测试复用
  parseDocument: parseDocument,
  isCsesDocument: isCsesDocument,
  defaultInstanceName: defaultInstanceName,
  sanitizeInstanceName: sanitizeInstanceName,
  organizationNameOfGroup: organizationNameOfGroup,
  extOfPath: extOfPath,
  basename: basename,
  textOfContent: textOfContent,
  toUnixSeconds: toUnixSeconds,
};
