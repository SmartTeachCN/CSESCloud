/**
 * CSES Cloud 静态集控（ClassIsland）数据转换 —— NodeJS 版。
 *
 * 本文件是 `E:\CsesWebEditor\classisland\convert.php` 的 1:1 移植（纯函数，无 I/O），
 * 由 NodeJS 云应用 `server/apps/cses-static-control` 与公开静态集控接口复用。
 *
 * 云端保存的是 CSES 文档（`subjects` / `schedules` / `extraKey`），而 ClassIsland 的集控
 * 数据源要求 ClassIsland 自己的 JSON 结构，因此这里在服务端做一次转换：
 *
 *   - ClassPlans / TimeLayouts / Subjects → ClassIsland 档案（Profile）
 *   - Policy                             → ClassIsland 限制策略（ManagementPolicy）
 *   - Credentials                        → ClassIsland 凭据设置（ManagementCredentialConfig）
 *   - Settings                           → ClassIsland 应用设置（Settings）
 *
 * 目标为 ClassIsland 2.0（核心版本 2.0.0.0）：
 *   - 时间点使用 TimeSpan（`StartTime` / `EndTime`，形如 `08:00:00`），旧版的
 *     `StartSecond` / `EndSecond`（ISO 日期时间）同时输出，以兼容 2.0 之前的客户端；
 *   - 2.0 中 `ExcludedFullscreenWindow` 为集合（数组），而 CSES 里是逗号分隔的文本；
 *   - 2.0 中 `Theme` 的 0/1/2 依次为「跟随系统 / 浅色 / 深色」。
 *
 * 为了兼容「按数据源分开拉取」的集控协议，所有 GUID 必须是稳定的：优先使用 CSES 文档
 * 中已有的 `uuid`，没有时用 UUID v5（SHA-1）从名称/序号推导，否则不同数据源之间的
 * 科目引用会错位（课表里出现空科目）。
 */
'use strict';

const crypto = require('node:crypto');

/** 集控数据核心版本，需与 ClassIsland 的 IAppHost.CoreVersion 主版本一致。 */
const CORE_VERSION = '2.0.0.0';

/** 集控数据源名称（顺序与 ClassIsland 清单一致）。 */
const DATA_SOURCE_KEYS = ['ClassPlans', 'TimeLayouts', 'Subjects', 'Policy', 'Credentials', 'Settings'];

/** 用于识别 CSES 文档的顶层字段（validateContent 使用）。 */
const CSES_MARKERS = ['version', 'subjects', 'schedules', 'extraKey'];

// ────────────────────────────── 通用辅助函数 ──────────────────────────────

/** PHP is_array() 等价：纯对象或数组（排除 null / Buffer / Date）。 */
function isPhpArray(value) {
  return Array.isArray(value)
    || (value !== null && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date));
}

/** PHP (string) 强制转换的等价实现（覆盖本项目会遇到的标量类型）。 */
function phpStr(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? '1' : '';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object') return '[object Object]';
  return String(value);
}

/** PHP is_numeric() 等价（数字或数字字符串）。 */
function isNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value.trim());
}

/** PHP (int)round($number) 等价（四舍五入、远离 0）。 */
function phpRoundToInt(number) {
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.sign(number) * Math.round(Math.abs(number));
  return Math.trunc(rounded) || 0; // 消除 -0
}

/** PHP empty($value) 的常用子集判断。 */
function isEmptyValue(value) {
  if (value === null || value === undefined || value === false) return true;
  if (value === 0 || value === '0' || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPhpArray(value)) return Object.keys(value).length === 0;
  return false;
}

/**
 * 空数组/空对象在 JSON 中必须输出 `{}`（ClassIsland 的字典/对象不能是 `[]`）。
 * JS 中普通对象自然序列化为 `{}`，这里额外把空数组归一为 `{}`，与 PHP new stdClass 等价。
 */
function object(value) {
  if (Array.isArray(value)) return value.length === 0 ? {} : value;
  if (value === null || value === undefined) return {};
  return value;
}

/** PHP rawurlencode() 等价（encodeURIComponent 额外放过 !'()*，需补编码）。 */
function rawUrlEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) => (
    '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  ));
}

// ────────────────────────────── 标识与校验 ──────────────────────────────

/**
 * 实例组标识校验。规则与 function/tool.php 的 cses_ci_valid_dir_id() 一致：
 * 由 user::getDir() 生成（10 位小写字母/数字），这里放宽到 4~64 位。
 */
function validDirId(id) {
  if (typeof id !== 'string') return false;
  return /^[A-Za-z0-9_-]{4,64}$/.test(id);
}

/**
 * 实例标识校验。规则与 function/tool.php 的 cses_ci_valid_instance_id() 一致：
 * 允许中文等宽字符，但禁止路径分隔符、`..` 与首字符为 `.` 的隐藏文件。
 */
function validInstanceId(id) {
  if (typeof id !== 'string' || id === '') return false;
  if (Buffer.byteLength(id, 'utf8') > 180) return false; // PHP strlen 按字节计
  if (id[0] === '.') return false;
  if (id.includes('..')) return false;
  return /^[^/\\:*?"<>|\x00-\x1F]+$/u.test(id);
}

/** 校验 GUID 字符串。CSES 文档里的 uuid 只有在合法时才能当作 ClassIsland 的字典键。 */
function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

/** 生成一个随机 UUID（v4）。仅用于无法推导稳定标识的兜底场景。 */
function uuidV4() {
  return crypto.randomUUID();
}

/**
 * 由命名空间与名称确定性地生成 GUID（UUID v5 风格）。
 * 与 PHP 的 `substr(sha1($namespace . "\x00" . $name), 0, 32)` 完全一致：
 * 取 SHA-1 前 32 个十六进制字符，改写版本位/变体位后按 8-4-4-4-12 分组。
 */
function stableUuid(namespace, name) {
  const hex = crypto
    .createHash('sha1')
    .update(String(namespace) + '\x00' + String(name), 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5'; // 版本位
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // 变体位
  const h = hex.join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-'
    + h.slice(16, 20) + '-' + h.slice(20, 32);
}

// ────────────────────────────── 时间 / 星期归一化 ──────────────────────────────

/**
 * 时间统一为 ClassIsland 2.0 的 TimeSpan 文本（HH:MM:SS）。
 * 接受 `8:00`、`08:00:00`、ISO 日期时间（`2025-01-01T08:00:00`）等写法，
 * 无法解析时返回空字符串。
 */
function normTime(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const match = String(value).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const second = match[3] !== undefined ? parseInt(match[3], 10) : 0;
  if (hour > 23 || minute > 59 || second > 59) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return pad(hour) + ':' + pad(minute) + ':' + pad(second);
}

/**
 * 启用日统一为 1~7 的整数数组（CSES v1 为整数，v2 为数组）。
 * 0 表示周日，与 ClassIsland 的 WeekDay 语义在 profile() 中换算。
 */
function normDays(value) {
  if (value === null || value === undefined || value === '' || value === false) return [];
  const items = Array.isArray(value) ? value : [value];
  const days = [];
  for (const item of items) {
    if (!isNumeric(item)) continue;
    const day = Math.trunc(Number(item));
    if (day >= 1 && day <= 7 && !days.includes(day)) days.push(day);
  }
  return days;
}

/** 时间点。同时输出 2.0 的 TimeSpan 与旧版的 ISO 日期时间。 */
function timePoint(start, end, timeType, defaultClassId) {
  return {
    StartTime: start,
    EndTime: end,
    StartSecond: '2025-01-01T' + start,
    EndSecond: '2025-01-01T' + end,
    TimeType: timeType,
    DefaultClassId: defaultClassId,
  };
}

// ────────────────────────────── CSES 文档区块读取 ──────────────────────────────

/**
 * 在 CSES 文档中按名称查找区块（先顶层，再 extraKey），不区分大小写。
 * 与 PHP `cses_ci_section()` 一致：只返回数组/对象，找不到时返回 `{}`。
 */
function section(document, name) {
  if (!isPhpArray(document)) return {};
  const scopes = [document];
  if (isPhpArray(document.extraKey)) scopes.push(document.extraKey);
  const target = String(name).toLowerCase();
  for (const scope of scopes) {
    for (const [key, value] of Object.entries(scope)) {
      if (typeof key === 'string' && key.toLowerCase() === target && isPhpArray(value)) {
        return value;
      }
    }
  }
  return {};
}

// ────────────────────────────── 档案（Subjects / TimeLayouts / ClassPlans） ──────────────────────────────

/**
 * CSES 文档 → ClassIsland 档案数据。
 *
 * @param {object} document  CSES 文档
 * @param {string} namespace 稳定 GUID 的命名空间（应包含实例组与实例标识）
 * @param {string|null} onlySection 只输出指定数据源（`ClassPlans` / `TimeLayouts` / `Subjects`），null 表示全部
 */
function profile(document, namespace, onlySection = null) {
  const subjects = {};
  const timeLayouts = {};
  const classPlans = {};
  const subjectIdsByName = {};

  const doc = isPhpArray(document) ? document : {};
  const rawSubjects = isPhpArray(doc.subjects) ? doc.subjects : {};
  for (const subject of Object.values(rawSubjects)) {
    if (!isPhpArray(subject)) continue;
    const name = subject.name === undefined || subject.name === null ? '' : phpStr(subject.name);
    const uuid = subject.uuid === undefined ? null : subject.uuid;
    const id = validUuid(uuid) ? uuid : stableUuid(namespace + '/subject', name);
    subjectIdsByName[name] = id;
    subjects[id] = {
      Name: name,
      Initial: subject.simplified_name === undefined || subject.simplified_name === null
        ? '' : phpStr(subject.simplified_name),
      TeacherName: subject.teacher === undefined || subject.teacher === null
        ? '' : phpStr(subject.teacher),
      IsOutDoor: false,
    };
  }

  const rawSchedules = isPhpArray(doc.schedules) ? doc.schedules : {};
  const scheduleList = Array.isArray(rawSchedules) ? rawSchedules : Object.values(rawSchedules);
  scheduleList.forEach((schedule, scheduleIndex) => {
    if (!isPhpArray(schedule)) return;

    const scheduleName = schedule.name === undefined || schedule.name === null
      ? '' : phpStr(schedule.name);
    const timeLayoutUuid = schedule.time_layout_uuid === undefined ? null : schedule.time_layout_uuid;
    const timeLayoutId = validUuid(timeLayoutUuid)
      ? timeLayoutUuid
      : stableUuid(namespace + '/timelayout', 'schedule-' + scheduleIndex);

    let days = normDays(schedule.enable_day === undefined ? null : schedule.enable_day);
    if (!days.length) days = [1];
    const weeks = schedule.weeks === undefined || schedule.weeks === null
      ? 'all' : phpStr(schedule.weeks);
    const weekCountDiv = weeks === 'even' ? 2 : (weeks === 'odd' ? 1 : 0);

    const layouts = [];
    const classOrder = [];
    let lastEnd = '';
    const rawClasses = isPhpArray(schedule.classes) ? schedule.classes : {};
    for (const cls of Object.values(rawClasses)) {
      if (!isPhpArray(cls)) continue;
      const start = normTime(cls.start_time === undefined ? null : cls.start_time);
      const end = normTime(cls.end_time === undefined ? null : cls.end_time);
      if (start === '' || end === '') continue;

      const subjectName = cls.subject === undefined || cls.subject === null
        ? '' : phpStr(cls.subject);
      if (subjectName !== '' && !Object.prototype.hasOwnProperty.call(subjectIdsByName, subjectName)) {
        // 课表里出现了科目列表中没有的科目：补一个，避免课表里出现空科目
        const newId = stableUuid(namespace + '/subject', subjectName);
        subjectIdsByName[subjectName] = newId;
        subjects[newId] = {
          Name: subjectName,
          Initial: '',
          TeacherName: '',
          IsOutDoor: false,
        };
      }
      const subjectId = Object.prototype.hasOwnProperty.call(subjectIdsByName, subjectName)
        ? subjectIdsByName[subjectName]
        : stableUuid(namespace + '/subject', 'unknown-' + start);

      if (lastEnd !== '') {
        // 两节课之间的空隙作为课间
        layouts.push(timePoint(lastEnd, start, 1, subjectId));
      }
      lastEnd = end;
      layouts.push(timePoint(start, end, 0, subjectId));
      classOrder.push(subjectId);
    }

    timeLayouts[timeLayoutId] = {
      Name: scheduleName,
      Layouts: layouts,
    };

    const classes = classOrder.map((subjectId) => ({ SubjectId: subjectId }));

    // CSES v2 中一张课表可以对应多个启用日，为每个启用日生成一个课程计划
    days.forEach((day, dayIndex) => {
      const scheduleUuid = schedule.uuid === undefined ? null : schedule.uuid;
      const classPlanId = dayIndex === 0 && validUuid(scheduleUuid)
        ? scheduleUuid
        : stableUuid(namespace + '/classplan', 'schedule-' + scheduleIndex + '-day-' + day);
      classPlans[classPlanId] = {
        TimeLayoutId: timeLayoutId,
        TimeRule: {
          WeekDay: day === 7 ? 0 : day, // ClassIsland 中 0 代表周日
          WeekCountDiv: weekCountDiv,
          WeekCountDivTotal: weekCountDiv > 0 ? 2 : 0,
        },
        Classes: classes,
        Name: days.length > 1 ? (scheduleName + ' (' + day + ')') : scheduleName,
        IsOverlay: false,
        IsEnabled: true,
      };
    });
  });

  return {
    Name: '',
    ClassPlans: onlySection === null || onlySection === 'ClassPlans' ? object(classPlans) : {},
    TimeLayouts: onlySection === null || onlySection === 'TimeLayouts' ? object(timeLayouts) : {},
    Subjects: onlySection === null || onlySection === 'Subjects' ? object(subjects) : {},
  };
}

// ────────────────────────────── 类型转换辅助 ──────────────────────────────

/** 将值转换为布尔值，无法转换时返回 null。 */
function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  }
  return null;
}

/** 将值转换为整数，无法转换时返回 null。 */
function toInt(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return null;
  if (!isNumeric(value)) return null;
  return phpRoundToInt(Number(value));
}

/** 将值转换为浮点数，无法转换时返回 null。 */
function toFloat(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return null;
  if (!isNumeric(value)) return null;
  return Number(value);
}

/** 把对象键统一为小写，便于「忽略大小写」读取。 */
function lowerKeyMap(raw) {
  const values = {};
  if (!isPhpArray(raw)) return values;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string') values[key.toLowerCase()] = value;
  }
  return values;
}

// ────────────────────────────── Settings / Policy / Credentials ──────────────────────────────

/**
 * extraKey 中的设置项 → ClassIsland 2.0 的对应字段。
 *
 * 只输出 ClassIsland 2.0 中确实存在且类型兼容的条目：ClassIsland 反序列化应用设置时
 * 是严格的，一旦某个字段类型不匹配，整份设置都会读取失败并回退到默认值。
 */
function settings(document) {
  const raw = section(document, 'Settings');
  if (isEmptyValue(raw)) return {};

  const values = lowerKeyMap(raw);
  const output = {};

  const boolKeys = [
    'IsMainWindowVisible', 'IsWelcomeWindowShowed',
    'IsClassPrepareNotificationEnabled', 'IsClassChangingNotificationEnabled',
    'IsClassOffNotificationEnabled', 'HideOnFullscreen', 'AutoInstallUpdateNextStartup',
  ];
  const intKeys = ['ClassPrepareNotifySeconds', 'Theme', 'HideMode', 'UpdateMode'];
  const floatKeys = ['MainWindowBodyFontSize', 'MainWindowEmphasizedFontSize'];
  const stringKeys = ['SelectedProfile', 'MainWindowFont'];

  for (const key of boolKeys) {
    const name = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = toBool(values[name]);
    if (value !== null) output[key] = value;
  }
  for (const key of intKeys) {
    const name = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = toInt(values[name]);
    if (value !== null) output[key] = value;
  }
  for (const key of floatKeys) {
    const name = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = toFloat(values[name]);
    if (value !== null) output[key] = value;
  }
  for (const key of stringKeys) {
    const name = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    if (typeof values[name] === 'string') output[key] = values[name];
  }

  // 2.0 中该字段是集合，CSES 控制面板里是逗号分隔的文本
  const excludedKey = 'excludedfullscreenwindow';
  if (Object.prototype.hasOwnProperty.call(values, excludedKey)) {
    const rawExcluded = values[excludedKey];
    if (Array.isArray(rawExcluded)) {
      output.ExcludedFullscreenWindow = rawExcluded.filter((item) => typeof item === 'string');
    } else if (typeof rawExcluded === 'string') {
      output.ExcludedFullscreenWindow = rawExcluded.trim() === ''
        ? []
        : rawExcluded.trim().split(/[,，\s]+/u).filter((item) => item !== '');
    }
  }

  // 2.0 中该字段是 DateTime，非法值会让整份设置读取失败
  const lastCheckKey = 'lastcheckupdatetime';
  if (Object.prototype.hasOwnProperty.call(values, lastCheckKey) && typeof values[lastCheckKey] === 'string') {
    const text = values[lastCheckKey].trim();
    if (text !== '' && validDateTimeText(text)) {
      output.LastCheckUpdateTime = text;
    }
  }

  return object(output);
}

/** ClassIsland 的 DateTime 字段：只接受可被解析的日期时间文本。 */
function validDateTimeText(text) {
  if (Number.isNaN(Date.parse(text))) {
    // PHP strtotime 还接受无时间部分 / 非 ISO 的日期写法，做一次宽松兜底
    return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text) || /^\d{1,2}:\d{2}/.test(text);
  }
  return true;
}

/**
 * extraKey 中的策略项 → ClassIsland 限制策略。字段名与 2.0 的 ManagementPolicy 一一对应。
 */
function policy(document) {
  const raw = section(document, 'Policy');
  const keys = [
    'DisableProfileClassPlanEditing', 'DisableProfileTimeLayoutEditing',
    'DisableProfileSubjectsEditing', 'DisableProfileEditing', 'DisableSettingsEditing',
    'DisableSplashCustomize', 'DisableDebugMenu', 'AllowExitManagement', 'DisableEasterEggs',
  ];

  const values = lowerKeyMap(raw);
  const output = {};
  for (const key of keys) {
    const name = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = toBool(values[name]);
    if (value !== null) output[key] = value;
  }
  return object(output);
}

/**
 * extraKey 中的认证项 → ClassIsland 凭据设置。字段名与 2.0 的 ManagementCredentialConfig 一一对应。
 */
function credentials(document) {
  const raw = section(document, 'Credentials');
  const stringKeys = ['UserCredential', 'AdminCredential'];
  const levelKeys = [
    'EditAuthorizeSettingsAuthorizeLevel', 'EditPolicyAuthorizeLevel', 'ExitManagementAuthorizeLevel',
    'EditProfileAuthorizeLevel', 'EditSettingsAuthorizeLevel', 'ExitApplicationAuthorizeLevel',
    'ChangeLessonsAuthorizeLevel',
  ];

  const values = lowerKeyMap(raw);
  const output = {};
  for (const key of stringKeys) {
    const name = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(values, name) && typeof values[name] === 'string') {
      output[key] = values[name];
    }
  }
  for (const key of levelKeys) {
    const name = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = toInt(values[name]);
    if (value !== null && value >= 0 && value <= 2) { // 0 无 / 1 用户 / 2 管理员
      output[key] = value;
    }
  }
  return object(output);
}

// ────────────────────────────── 数据源分发与清单 ──────────────────────────────

/**
 * 按数据源名称取出对应的 ClassIsland 文档。不支持时返回 null。
 */
function document(document_, key, namespace) {
  switch (String(key === undefined || key === null ? '' : key).toLowerCase()) {
    case 'classplans':
      return profile(document_, namespace, 'ClassPlans');
    case 'timelayouts':
      return profile(document_, namespace, 'TimeLayouts');
    case 'subjects':
      return profile(document_, namespace, 'Subjects');
    case 'policy':
      return policy(document_);
    case 'credentials':
      return credentials(document_);
    case 'settings':
      return settings(document_);
    default:
      return null;
  }
}

/** 集控清单默认组织名称。 */
function defaultOrganizationName(dirId) {
  return 'CSES Cloud (' + dirId + ')';
}

/**
 * 生成 ClassIsland 2.0 格式的集控清单。
 *
 * 数据源地址中的 `{id}` 由 ClassIsland 用用户填写的实例标识替换（URL 模板占位符）。
 *
 * @param {string} dirId          实例组标识
 * @param {number} version        数据源版本（Unix 秒）
 * @param {string} baseUrl        数据源接口地址（如 https://host/classisland/file.php）
 * @param {string|null} organizationName 组织名称，null 时使用 `CSES Cloud (<dirId>)`
 * @param {string} extraQuery     额外查询参数（`/control/file.php` 兼容地址使用 `format=ci`）
 */
function manifest(dirId, version, baseUrl, organizationName = null, extraQuery = '') {
  const orgName = organizationName === null || organizationName === undefined
    ? defaultOrganizationName(dirId)
    : organizationName;
  const versionInt = Number.isFinite(Number(version)) ? Math.trunc(Number(version)) || 0 : 0;

  const result = {
    ServerKind: 0, // Serverless：静态清单
    CoreVersion: CORE_VERSION,
    OrganizationName: String(orgName),
  };

  const sources = {
    ClassPlanSource: 'ClassPlans',
    TimeLayoutSource: 'TimeLayouts',
    SubjectsSource: 'Subjects',
    DefaultSettingsSource: 'Settings',
    PolicySource: 'Policy',
    CredentialSource: 'Credentials',
  };

  const queryPrefix = extraQuery ? String(extraQuery).replace(/^\?/, '') + '&' : '';
  for (const [name, key] of Object.entries(sources)) {
    result[name] = {
      Value: baseUrl + '?' + queryPrefix + 'id=' + rawUrlEncode(dirId) + '/{id}&key=' + key,
      Version: versionInt,
    };
  }

  return result;
}

module.exports = {
  CORE_VERSION,
  DATA_SOURCE_KEYS,
  CSES_MARKERS,
  // 校验 / 标识
  validDirId,
  validInstanceId,
  validUuid,
  uuidV4,
  stableUuid,
  // 归一化
  normTime,
  normDays,
  timePoint,
  // 文档解析
  section,
  profile,
  policy,
  credentials,
  settings,
  document,
  // 清单
  manifest,
  defaultOrganizationName,
  // 工具（server 端复用 / 测试）
  object,
  rawUrlEncode,
  toBool,
  toInt,
  toFloat,
  phpStr,
  isPhpArray,
};
