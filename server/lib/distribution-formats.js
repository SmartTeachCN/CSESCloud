/**
 * CSES Cloud V3 —— 配置分发格式识别与校验。
 *
 * 轻编辑器「分发配置」根据源文件内容自动判定分发格式：
 *   - classisland  ：ClassIsland 档案（Profile，含 ClassPlans / TimeLayouts / Subjects）
 *                    → 以实例应用 `classisland` 提供静态集控（清单 + 六类数据源）
 *   - cses         ：CSES 课程表配置（version / subjects / schedules / extraKey）
 *                    → 以实例应用 `cses_config` 提供公开配置地址（原文件内容）
 *   - examaware    ：ExamAware 2 考试配置（examName / examInfos，或 .ea2）
 *                    → 以实例应用 `examaware` 提供公开配置地址（原文件内容）
 *
 * 本模块只做纯解析/校验，不访问数据库；数据库相关逻辑在各云应用模块中。
 */
'use strict';

const yaml = require('js-yaml');
const convert = require('./classisland-convert');

/** 分发格式定义（顺序即前端展示顺序）。 */
const FORMATS = {
  classisland: {
    format: 'classisland',
    appKey: 'classisland',
    label: 'ClassIsland 配置',
    mode: 'static',
    description: 'ClassIsland 档案 → 静态集控清单与六类数据源',
  },
  cses: {
    format: 'cses',
    appKey: 'cses_config',
    label: 'CSES 配置',
    mode: 'url',
    description: 'CSES 课程表配置 → 公开配置地址（原文件内容）',
  },
  examaware: {
    format: 'examaware',
    appKey: 'examaware',
    label: 'ExamAware 配置',
    mode: 'url',
    description: 'ExamAware 2 考试配置 → 公开配置地址（原文件内容）',
  },
};

/** app_key → 分发格式。 */
const APP_FORMAT = {
  classisland: 'classisland',
  cses_config: 'cses',
  examaware: 'examaware',
};

/** 所有分发格式的 app_key。 */
const ALL_APP_KEYS = Object.keys(APP_FORMAT);

/** 取文件扩展名（小写，不含点）。 */
function extOfPath(filePath) {
  const base = String(filePath === undefined || filePath === null ? '' : filePath).split(/[\\/]/).pop() || '';
  const pos = base.lastIndexOf('.');
  if (pos <= 0) return '';
  return base.slice(pos + 1).toLowerCase();
}

/** 取文件名（不含路径）。 */
function basename(filePath) {
  const parts = String(filePath === undefined || filePath === null ? '' : filePath).split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/** web_hosting_files.content（BLOB / TEXT）转 UTF-8 文本。 */
function textOfContent(content) {
  if (content === null || content === undefined) return '';
  if (Buffer.isBuffer(content)) return content.toString('utf8');
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('utf8');
  }
  return String(content);
}

/** '.' 开头的扩展名文本（用于公开地址）。 */
function dotExt(ext) {
  const clean = String(ext === undefined || ext === null ? '' : ext).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return clean ? '.' + clean : '';
}

/**
 * 解析源文件内容：.json 先按 JSON 解析，其余按 YAML 解析（YAML 是 JSON 超集）。
 * @returns {{ok:true, document:object, text:string}|{ok:false, error:string}}
 */
function parseContent(content, fileName) {
  const text = textOfContent(content);
  if (text.trim() === '') return { ok: false, error: '源文件内容为空' };
  const ext = extOfPath(fileName);

  if (ext === 'json' || ext === 'ea2') {
    try {
      const parsed = JSON.parse(text);
      if (!convert.isPhpArray(parsed)) return { ok: false, error: '源文件不是合法的 JSON 对象' };
      return { ok: true, document: parsed, text: text };
    } catch (e) {
      return { ok: false, error: '源文件不是合法的 JSON：' + (e && e.message ? e.message : e) };
    }
  }

  try {
    const parsed = yaml.load(text);
    if (convert.isPhpArray(parsed)) return { ok: true, document: parsed, text: text };
  } catch (_) { /* 继续尝试 JSON */ }
  try {
    const parsed = JSON.parse(text);
    if (convert.isPhpArray(parsed)) return { ok: true, document: parsed, text: text };
  } catch (_) { /* 忽略 */ }

  return { ok: false, error: '源文件不是合法的 YAML / JSON 文档' };
}

/** 对象是否为普通对象（排除数组/Buffer/Date）。 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && !Buffer.isBuffer(value) && !(value instanceof Date);
}

function hasObjectKey(doc, key) {
  return isPlainObject(doc) && isPlainObject(doc[key]);
}

/** 是否为 ClassIsland 档案（Profile）JSON。 */
function isClassIslandProfile(doc) {
  if (!isPlainObject(doc)) return false;
  return hasObjectKey(doc, 'ClassPlans') || hasObjectKey(doc, 'TimeLayouts') || hasObjectKey(doc, 'Subjects');
}

/** 是否为 ExamAware 2 考试配置。 */
function isExamAwareConfig(doc, ext) {
  if (!isPlainObject(doc)) return false;
  if (Array.isArray(doc.examInfos)) return true;
  if (typeof doc.examName === 'string' && doc.examName.trim() !== '') return true;
  return String(ext || '').toLowerCase() === 'ea2';
}

/** 是否为 CSES 配置。 */
function isCsesDocument(doc) {
  if (!isPlainObject(doc)) return false;
  return ('version' in doc)
    || convert.isPhpArray(doc.subjects)
    || convert.isPhpArray(doc.schedules)
    || convert.isPhpArray(doc.extraKey);
}

/**
 * 识别分发格式。
 * @returns {string|null} 'classisland' | 'cses' | 'examaware' | null
 */
function detectFormat(document, fileName) {
  const ext = extOfPath(fileName);
  if (isClassIslandProfile(document)) return 'classisland';
  if (isExamAwareConfig(document, ext)) return 'examaware';
  if (isCsesDocument(document)) return 'cses';
  return null;
}

/** 取格式定义（未知返回 null）。 */
function getFormatInfo(format) {
  return FORMATS[format] || null;
}

/** 取 app_key 对应的格式定义。 */
function formatOfApp(appKey) {
  const format = APP_FORMAT[appKey];
  return format ? FORMATS[format] : null;
}

/** 生成公开配置地址（NodeJS 原生路径）。 */
function rawConfigUrl(baseUrl, dirId, instanceId, ext) {
  const base = String(baseUrl === undefined || baseUrl === null ? '' : baseUrl).replace(/\/+$/, '');
  return base + '/config/' + encodeURIComponent(String(dirId))
    + '/' + encodeURIComponent(String(instanceId) + dotExt(ext));
}

/** 公开配置接口的地址模板（实例标识/扩展名占位）。 */
function rawConfigUrlTemplate(baseUrl, dirId) {
  const base = String(baseUrl === undefined || baseUrl === null ? '' : baseUrl).replace(/\/+$/, '');
  return base + '/config/' + encodeURIComponent(String(dirId)) + '/{id}{ext}';
}

/** 解析 `/config/<dir>/<fileName>` 中的文件名，拆出实例标识与扩展名。 */
function splitRawConfigFileName(fileName) {
  const name = String(fileName === undefined || fileName === null ? '' : fileName);
  const known = ['ea2', 'json', 'yml', 'yaml', 'cses', 'txt'];
  const pos = name.lastIndexOf('.');
  if (pos > 0) {
    const ext = name.slice(pos + 1).toLowerCase();
    if (known.includes(ext)) return { instanceId: name.slice(0, pos), ext: ext };
  }
  return { instanceId: name, ext: '' };
}

/** 扩展名 → Content-Type。 */
function contentTypeOf(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'json' || e === 'ea2') return 'application/json; charset=utf-8';
  if (e === 'yml' || e === 'yaml' || e === 'cses') return 'text/yaml; charset=utf-8';
  if (e === 'xml') return 'application/xml; charset=utf-8';
  if (e === 'html' || e === 'htm') return 'text/html; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

/** 统计 ClassIsland 档案内容。 */
function classislandStats(doc) {
  const classPlans = isPlainObject(doc) && isPlainObject(doc.ClassPlans) ? Object.keys(doc.ClassPlans).length : 0;
  const timeLayouts = isPlainObject(doc) && isPlainObject(doc.TimeLayouts) ? Object.keys(doc.TimeLayouts).length : 0;
  const subjects = isPlainObject(doc) && isPlainObject(doc.Subjects) ? Object.keys(doc.Subjects).length : 0;
  return { classplans: classPlans, timelayouts: timeLayouts, subjects: subjects };
}

/** 统计 ExamAware 配置内容。 */
function examawareStats(doc) {
  const infos = isPlainObject(doc) && Array.isArray(doc.examInfos) ? doc.examInfos.length : 0;
  return { exams: infos };
}

/**
 * 校验源文件是否为可分发配置，返回格式与统计信息。
 * @returns {{ok:true, format:string, formatInfo:object, document:object, stats:object, warnings:string[]}
 *          |{ok:false, error:string}}
 */
function validateContent(content, fileName) {
  const parsed = parseContent(content, fileName);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const doc = parsed.document;
  const format = detectFormat(doc, fileName);
  if (!format) {
    return {
      ok: false,
      error: '无法识别配置格式：支持 ClassIsland 档案（ClassPlans/TimeLayouts/Subjects）、CSES 配置（version/subjects/schedules）与 ExamAware 配置（examName/examInfos）',
    };
  }
  const info = FORMATS[format];
  const warnings = [];
  let stats = { subjects: 0, schedules: 0, classplans: 0, timelayouts: 0, exams: 0 };

  if (format === 'classisland') {
    const s = classislandStats(doc);
    stats = { subjects: s.subjects, schedules: 0, classplans: s.classplans, timelayouts: s.timelayouts, exams: 0 };
    if (s.classplans === 0) warnings.push('档案中没有课表（ClassPlans），ClassPlans 数据源将为空');
    if (s.timelayouts === 0) warnings.push('档案中没有时间表（TimeLayouts），TimeLayouts 数据源将为空');
    if (s.subjects === 0) warnings.push('档案中没有科目（Subjects），Subjects 数据源将为空');
    if (extOfPath(fileName) !== 'json') warnings.push('ClassIsland 档案通常为 JSON 文件，当前扩展名不是 .json');
  } else if (format === 'cses') {
    const versionNum = Number.isFinite(Number(doc.version)) && doc.version !== '' ? Math.trunc(Number(doc.version)) : null;
    const rawSubjects = Array.isArray(doc.subjects) ? doc.subjects : [];
    const rawSchedules = Array.isArray(doc.schedules) ? doc.schedules : [];
    stats = { version: versionNum, subjects: rawSubjects.length, schedules: rawSchedules.length, classplans: 0, timelayouts: 0, exams: 0 };
    if (!('version' in doc)) warnings.push('文档缺少 version 字段');
    else if (versionNum !== 1 && versionNum !== 2) warnings.push('未知的 CSES 版本：' + doc.version);
    if (rawSchedules.length === 0) warnings.push('文档中没有课表（schedules）');
    if (rawSubjects.length === 0) warnings.push('文档中没有科目（subjects）');
    warnings.push('CSES 配置将以原文件内容通过公开地址提供，不再转换为 ClassIsland 数据源');
  } else {
    const s = examawareStats(doc);
    stats = { subjects: 0, schedules: 0, classplans: 0, timelayouts: 0, exams: s.exams };
    if (s.exams === 0) warnings.push('考试配置中没有场次（examInfos）');
  }

  return {
    ok: true,
    format: format,
    formatInfo: info,
    document: doc,
    stats: stats,
    warnings: warnings,
  };
}

module.exports = {
  FORMATS,
  ALL_APP_KEYS,
  APP_FORMAT,
  detectFormat,
  getFormatInfo,
  formatOfApp,
  parseContent,
  parseContentText: textOfContent,
  validateContent,
  classislandStats,
  examawareStats,
  isClassIslandProfile,
  isExamAwareConfig,
  isCsesDocument,
  extOfPath,
  basename,
  dotExt,
  rawConfigUrl,
  rawConfigUrlTemplate,
  splitRawConfigFileName,
  contentTypeOf,
};
