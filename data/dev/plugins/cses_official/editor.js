// ============================================================
// CSES 编辑器 - 官方版（UI 样板：ClassIsland 档案编辑器）
// - 注册 .yml 后缀：按 CSES 模板自动识别格式（V1.0 / V2.0），
//   匹配成功进入结构化编辑；否则调用 CSEditor.fallback() 交给平台默认编辑器。
// - 不提供「YAML 源码」视图：源码编辑统一由平台的默认编辑器（Monaco）承担。
// - 编辑体验对齐 ClassIsland 2 档案设置窗口：
//   · 课程表：列表 / 周视图、课程快速选择面板（常驻 Dock + 弹窗）；
//   · 科目：左表格 + 右详情，预设常用科目；
//   · 配置（V2.0）：description + 周期 cycle（work/rest 计数与 spans 分配）。
// - 保存通过平台 Ribbon「保存」按钮（save 命令 / Ctrl+S），统一输出 YAML，
//   不再提供多格式导出；撤销/重做对接平台 Ribbon 的 undo/redo 命令。
// - 视图与选择状态随文件持久化，刷新后回到刷新前页面；未知字段原样回写。
// ============================================================

var cses = null;               // CSES 数据对象（保存时原样序列化，未知字段不丢）
var isCses = false;            // 是否识别为 CSES 课表
var csesVersion = 2;           // 识别到的模板版本：1 / 2
var view = 'schedules';
var scheduleSubView = 'list';  // 课程表：list / week
var weekMode = '';             // V1 周视图周类型：'' 全部 / all / odd / even
var selectedScheduleIdx = -1;  // 当前选中的课程表
var selectedClassIdx = -1;     // 当前选中的课程
var selectedSubjectIdx = -1;   // 当前选中的科目
var uiState = { collapse: { schedules: false, config: false }, durClass: 40, autoNextLesson: false };
var quickSelectCtx = null;     // 快速选择面板上下文 {schedIdx, clsIdx}
var quickDockTarget = null;    // 常驻快速选择菜单的当前目标 {schedIdx, clsIdx}
var dirty = false;
var validationErrors = [];
var validationWarnings = [];
var presetOpen = false;

// ================= 平台回退（非 CSES 文件） =================
// 文件未识别为 CSES 模板时，不再由插件内部提供通用 YAML 编辑器，
// 而是请求平台回退：EditorPane 收到 __csesPluginFallback 后停用本插件并改用默认编辑器。
var fallbackActive = false;     // 已请求回退：停止渲染与保存
var fallbackRequested = false;  // 避免重复请求
function requestPlatformFallback(reason) {
  fallbackActive = true;
  if (fallbackRequested) return;
  fallbackRequested = true;
  var msg = reason || '未识别为 CSES 课表模板';
  try {
    if (window.CSEditor && typeof window.CSEditor.fallback === 'function') {
      window.CSEditor.fallback(msg);
    } else if (window.parent && window.parent !== window) {
      // 兼容尚未注入 fallback SDK 的宿主
      window.parent.postMessage({ __csesPluginFallback: true, reason: msg }, '*');
    }
  } catch (e) { /* ignore */ }
}

var WEEK_MAP = { all: '通用', odd: '单周', even: '双周' };
var DAY_NAMES = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

// 常用预设科目（写入 subjects；V1.0 用 room，V2.0 用 location）
var PRESET_SUBJECTS = [
  { name: '语文', simplified: '语' }, { name: '数学', simplified: '数' },
  { name: '英语', simplified: '英' }, { name: '物理', simplified: '物' },
  { name: '化学', simplified: '化' }, { name: '生物', simplified: '生' },
  { name: '历史', simplified: '历' }, { name: '地理', simplified: '地' },
  { name: '政治', simplified: '政' }, { name: '体育', simplified: '体' },
  { name: '早读', simplified: '早' }, { name: '晚读', simplified: '晚' },
  { name: '自习', simplified: '自' }, { name: '班会', simplified: '班' },
  { name: '音乐', simplified: '音' }, { name: '美术', simplified: '美' },
  { name: '信息技术', simplified: '信' }, { name: '通用技术', simplified: '通' }
];

// ================= 工具 =================
function $(id) { return document.getElementById(id); }
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function dayName(d) { return DAY_NAMES[d] || ('第' + d + '日'); }
function shortTime(hhmmss) {
  var p = String(hhmmss || '').split(':');
  return p.length >= 2 ? (p[0] + ':' + p[1]) : hhmmss;
}
function toSec(hhmmss) {
  var p = String(hhmmss || '00:00:00').split(':');
  return (parseInt(p[0], 10) || 0) * 3600 + (parseInt(p[1], 10) || 0) * 60 + (parseInt(p[2], 10) || 0);
}
function addSeconds(hhmmss, seconds) {
  var p = String(hhmmss || '00:00:00').split(':');
  var total = (parseInt(p[0], 10) || 0) * 3600 + (parseInt(p[1], 10) || 0) * 60 + (parseInt(p[2], 10) || 0) + seconds;
  if (total < 0) total = 0;
  var h = Math.floor(total / 3600) % 24, m = Math.floor((total % 3600) / 60), s = total % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}
function addMinutes(hhmmss, minutes) { return addSeconds(hhmmss, minutes * 60); }
function normalizeTime(t) {
  var s = String(t == null ? '' : t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) s += ':00';
  return s;
}

/** 读取课程表启用日数组（V1: enable_day 整数；V2: enable_day 整数数组） */
function daysOf(s) {
  if (!isPlainObject(s)) return [];
  if (csesVersion === 1) {
    var d = parseInt(s.enable_day, 10);
    return isNaN(d) ? [] : [d];
  }
  return Array.isArray(s.enable_day) ? s.enable_day.map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); }) : [];
}

/** 课程表摘要（列表 meta / 周视图标题） */
function scheduleMeta(s) {
  var days = daysOf(s).map(dayName).join('、');
  if (csesVersion === 1) {
    return (WEEK_MAP[s.weeks] || '通用') + ' · ' + (days || '未启用');
  }
  return days || '未启用';
}
function scheduleTitle(s, idx) {
  return (s && s.name) ? s.name : ('未命名课程表 ' + (idx + 1));
}

// ================= YAML 引擎（精简实现） =================
function parseYaml(text) {
  var lines = String(text || '').split(/\r?\n/);
  var nodes = [];
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var trimmed = raw.replace(/^\s+/, '');
    if (!trimmed || trimmed.charAt(0) === '#') continue;
    nodes.push({ indent: raw.length - trimmed.length, content: trimmed });
  }
  var pos = 0;

  function scalarVal(s) {
    s = String(s).trim();
    if (s === '') return '';
    if (s === 'null' || s === '~' || s === 'Null' || s === 'NULL') return null;
    if (s === 'true' || s === 'True' || s === 'TRUE') return true;
    if (s === 'false' || s === 'False' || s === 'FALSE') return false;
    if (/^[-+]?\d+$/.test(s)) return parseInt(s, 10);
    if (/^[-+]?\d*\.\d+$/.test(s)) return parseFloat(s);
    if (s === '[]') return [];
    if (s === '{}') return {};
    if (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']') return parseFlowArray(s);
    if (s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') return parseFlowMap(s);
    if (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'") {
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
      try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
    }
    return s;
  }
  function unquoteKey(s) {
    if (s.length >= 2 &&
        ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
         (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'"))) {
      return scalarVal(s);
    }
    return s;
  }
  function splitKV(content) {
    var quote = null;
    for (var i = 0; i < content.length; i++) {
      var ch = content.charAt(i);
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === ':') {
        return [content.slice(0, i).trim(), content.slice(i + 1).trim()];
      }
    }
    return null;
  }
  function flowSplit(str) {
    var out = [], cur = '', quote = null, depth = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (quote) { cur += c; if (c === quote) quote = null; }
      else if (c === "'" || c === '"') { quote = c; cur += c; }
      else if (c === '[' || c === '{') { depth++; cur += c; }
      else if (c === ']' || c === '}') { depth--; cur += c; }
      else if (c === ',' && depth === 0) { out.push(cur); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  function parseFlowArray(s) {
    var inner = s.slice(1, s.lastIndexOf(']'));
    if (!inner.trim()) return [];
    return flowSplit(inner).map(function (t) { return scalarVal(t); });
  }
  function parseFlowMap(s) {
    var inner = s.slice(1, s.lastIndexOf('}'));
    if (!inner.trim()) return {};
    var obj = {};
    flowSplit(inner).forEach(function (pair) {
      var i = pair.indexOf(':');
      if (i < 0) return;
      obj[unquoteKey(pair.slice(0, i).trim())] = scalarVal(pair.slice(i + 1).trim());
    });
    return obj;
  }
  // 解析当前节点下的子块（缩进由实际子行决定）
  function nestedParse(minIndent) {
    if (pos >= nodes.length) return null;
    var childIndent = nodes[pos].indent;
    if (childIndent <= minIndent) return null;
    return parseBlock(childIndent);
  }
  function parseSeqItem(indent) {
    var n = nodes[pos];
    pos++;
    var rest = n.content === '-' ? '' : n.content.slice(2).trim();
    if (rest === '') return null;
    var kv = splitKV(rest);
    if (kv && (kv[1] === '' || kv[1] === '|' || kv[1] === '>')) {
      var item = {};
      item[unquoteKey(kv[0])] = nestedParse(indent) || '';
      return item;
    }
    if (kv) {
      var item2 = {};
      item2[unquoteKey(kv[0])] = scalarVal(kv[1]);
      var sub = nestedParse(indent);
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        for (var k in sub) item2[k] = sub[k];
      }
      return item2;
    }
    return scalarVal(rest);
  }
  function parseBlock(indent) {
    var result = null;
    while (pos < nodes.length) {
      var n = nodes[pos];
      if (n.indent < indent) break;
      if (n.indent > indent) throw new Error('YAML 缩进错误');
      if (n.content === '-' || n.content.indexOf('- ') === 0) {
        if (result === null) result = [];
        if (!Array.isArray(result)) throw new Error('YAML 结构错误');
        result.push(parseSeqItem(indent));
      } else {
        var kv = splitKV(n.content);
        if (!kv) { pos++; continue; }
        if (result === null) result = {};
        if (!Array.isArray(result)) {
          var val = kv[1];
          if (val === '' || val === '|' || val === '>') {
            pos++;
            var key = unquoteKey(kv[0]);
            result[key] = nestedParse(indent) || '';
          } else {
            result[unquoteKey(kv[0])] = scalarVal(val);
            pos++;
          }
        } else {
          pos++;
        }
      }
    }
    return result;
  }
  return parseBlock(0);
}

function yamlDump(obj) {
  function isScalar(v) { return v === null || v === undefined || typeof v !== 'object'; }
  function isEmptyObj(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0; }
  function scalar(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    var s = String(v);
    if (s === '') return "''";
    if (/^(null|true|false|yes|no|on|off|~|[-+]?[0-9])/.test(s) ||
        /^[!&*#|>%@`"'.,{}\[\]]/.test(s) ||
        /^\s|\s$/.test(s) || s.indexOf('\n') >= 0 ||
        /:\s/.test(s) || s.indexOf('#') >= 0 || s.indexOf("'") >= 0) {
      return JSON.stringify(s);
    }
    return s;
  }
  function emit(v, indent) {
    var pad = new Array(indent + 1).join('  ');
    if (isScalar(v)) return pad + scalar(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return pad + '[]';
      var lines = [];
      for (var i = 0; i < v.length; i++) {
        var item = v[i];
        if (isScalar(item)) {
          lines.push(pad + '- ' + scalar(item));
        } else if (Array.isArray(item)) {
          lines.push(pad + '-');
          lines.push(emit(item, indent + 1));
        } else if (isEmptyObj(item)) {
          lines.push(pad + '- {}');
        } else {
          var keys = Object.keys(item);
          for (var j = 0; j < keys.length; j++) {
            var k = keys[j];
            var ks = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k);
            var val = item[k];
            var prefix = pad + (j === 0 ? '- ' : '  ');
            if (isScalar(val) || (Array.isArray(val) && val.length === 0) || isEmptyObj(val)) {
              lines.push(prefix + ks + ': ' + (Array.isArray(val) ? '[]' : (isEmptyObj(val) ? '{}' : scalar(val))));
            } else {
              lines.push(prefix + ks + ':');
              lines.push(emit(val, indent + 2));
            }
          }
        }
      }
      return lines.join('\n');
    }
    var k2 = Object.keys(v);
    if (k2.length === 0) return pad + '{}';
    var lines2 = [];
    for (var m = 0; m < k2.length; m++) {
      var kk = k2[m];
      var kks = /^[A-Za-z_][A-Za-z0-9_]*$/.test(kk) ? kk : JSON.stringify(kk);
      var vv = v[kk];
      if (isScalar(vv) || (Array.isArray(vv) && vv.length === 0) || isEmptyObj(vv)) {
        lines2.push(pad + kks + ': ' + (Array.isArray(vv) ? '[]' : (isEmptyObj(vv) ? '{}' : scalar(vv))));
      } else {
        lines2.push(pad + kks + ':');
        lines2.push(emit(vv, indent + 1));
      }
    }
    return lines2.join('\n');
  }
  return emit(obj, 0);
}

// ================= CSES 模板识别 =================
/**
 * 按 CSES 模板识别格式：
 * - V1.0：version === 1，且 subjects / schedules 为数组；
 * - V2.0：version === 2，且 configuration 为对象、subjects / schedules 为数组。
 */
function detectCses(obj) {
  if (!isPlainObject(obj)) return { ok: false, reason: '文件为空或根节点不是对象' };
  var version = typeof obj.version === 'number' ? obj.version : parseInt(obj.version, 10);
  if (version !== 1 && version !== 2) return { ok: false, reason: '缺少 version 字段（应为 1 或 2）' };
  if (!Array.isArray(obj.subjects)) return { ok: false, reason: 'V' + version + '.0 缺少 subjects 数组' };
  if (!Array.isArray(obj.schedules)) return { ok: false, reason: 'V' + version + '.0 缺少 schedules 数组' };
  if (version === 2 && !isPlainObject(obj.configuration)) return { ok: false, reason: 'V2.0 缺少 configuration 对象' };
  return { ok: true, version: version };
}

/** 确保结构完整（容器缺失补齐，必需字段按模板补默认值，未知字段原样保留） */
function normalizeCses(obj, version) {
  if (!isPlainObject(obj)) obj = {};
  obj.version = version;
  if (!Array.isArray(obj.subjects)) obj.subjects = [];
  if (!Array.isArray(obj.schedules)) obj.schedules = [];
  if (version === 2) {
    if (!isPlainObject(obj.configuration)) obj.configuration = {};
    var cfg = obj.configuration;
    if (typeof cfg.name !== 'string') cfg.name = '';
    if (typeof cfg.description !== 'string') cfg.description = '';
    if (!isPlainObject(cfg.cycle)) cfg.cycle = {};
    var cyc = cfg.cycle;
    if (typeof cyc.work_count !== 'number') cyc.work_count = 5;
    if (typeof cyc.rest_count !== 'number') cyc.rest_count = 2;
    if (!Array.isArray(cyc.spans)) {
      cyc.spans = (typeof cyc.work_count === 'number')
        ? [{ activity: 'work', count: cyc.work_count }]
        : [{ activity: 'work', count: 5 }, { activity: 'rest', count: 2 }];
    }
  }
  obj.schedules.forEach(function (s) {
    if (!isPlainObject(s)) return;
    if (typeof s.name !== 'string') s.name = '';
    if (!Array.isArray(s.classes)) s.classes = [];
    if (version === 1) {
      if (typeof s.enable_day !== 'number') s.enable_day = parseInt(s.enable_day, 10) || 1;
      if (s.weeks !== 'odd' && s.weeks !== 'even') s.weeks = 'all';
    } else {
      if (!Array.isArray(s.enable_day)) s.enable_day = [1];
    }
  });
  return obj;
}

/** CSES 空白模板（新建 / 非识别文件初始化时使用） */
function presetSubjects(roomKey) {
  return PRESET_SUBJECTS.map(function (p) {
    var sub = { name: p.name, simplified_name: p.simplified, teacher: '' };
    sub[roomKey] = '';
    return sub;
  });
}
function blankCses(version) {
  if (version === 1) {
    return { version: 1, subjects: presetSubjects('room'), schedules: [] };
  }
  return {
    version: 2,
    configuration: {
      name: '新配置',
      description: '',
      cycle: { work_count: 5, rest_count: 2, spans: [{ activity: 'work', count: 5 }, { activity: 'rest', count: 2 }] }
    },
    subjects: presetSubjects('location'),
    schedules: []
  };
}

// ================= 撤销 / 重做（对接平台 Ribbon undo/redo 命令） =================
var undoStack = [];
var redoStack = [];
var lastSnapshot = null;
var undoTimer = null;

function snapshot() { return isCses && cses ? JSON.stringify(cses) : ''; }

function commitUndo() {
  if (!isCses || !cses) return;
  var now = snapshot();
  if (lastSnapshot !== null && lastSnapshot !== now) {
    undoStack.push(lastSnapshot);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }
  lastSnapshot = now;
}

/** 输入类变更用去抖提交，避免逐字符压栈 */
function queueUndo() {
  clearTimeout(undoTimer);
  undoTimer = setTimeout(commitUndo, 600);
}

function undo() {
  if (!isCses || undoStack.length === 0) return;
  redoStack.push(snapshot());
  cses = JSON.parse(undoStack.pop());
  csesVersion = cses.version === 1 ? 1 : 2;
  lastSnapshot = snapshot();
  revalidateSelections();
  dirty = true;
  renderAll(); runValidation();
}

function redo() {
  if (!isCses || redoStack.length === 0) return;
  undoStack.push(snapshot());
  cses = JSON.parse(redoStack.pop());
  csesVersion = cses.version === 1 ? 1 : 2;
  lastSnapshot = snapshot();
  revalidateSelections();
  dirty = true;
  renderAll(); runValidation();
}

function revalidateSelections() {
  if (!cses) return;
  if (selectedScheduleIdx >= cses.schedules.length) selectedScheduleIdx = cses.schedules.length - 1;
  var s = cses.schedules[selectedScheduleIdx];
  if (s && selectedClassIdx >= s.classes.length) selectedClassIdx = s.classes.length - 1;
  if (selectedSubjectIdx >= cses.subjects.length) selectedSubjectIdx = cses.subjects.length - 1;
  if (quickDockTarget) {
    var ts = cses.schedules[quickDockTarget.schedIdx];
    if (!ts || !ts.classes[quickDockTarget.clsIdx]) quickDockTarget = null;
  }
}

// ================= 视图状态持久化（刷新后回到刷新前页面） =================
function stateStorageKey() {
  var name = (window.CSEditor && window.CSEditor.file && window.CSEditor.file.name) || '';
  return 'csesEditorState:' + name;
}
function persistViewState() {
  try {
    localStorage.setItem(stateStorageKey(), JSON.stringify({
      view: view,
      scheduleSubView: scheduleSubView,
      selectedScheduleIdx: selectedScheduleIdx,
      selectedClassIdx: selectedClassIdx,
      selectedSubjectIdx: selectedSubjectIdx,
      collapse: uiState.collapse,
      durClass: uiState.durClass,
      autoNextLesson: !!uiState.autoNextLesson
    }));
  } catch (e) { /* ignore */ }
}
function restoreViewState() {
  try {
    var raw = localStorage.getItem(stateStorageKey());
    if (!raw) return;
    var st = JSON.parse(raw);
    if (!st || typeof st !== 'object') return;
    if (['schedules', 'subjects', 'config'].indexOf(st.view) >= 0) view = st.view;
    if (['list', 'week'].indexOf(st.scheduleSubView) >= 0) scheduleSubView = st.scheduleSubView;
    if (typeof st.selectedScheduleIdx === 'number') selectedScheduleIdx = st.selectedScheduleIdx;
    if (typeof st.selectedClassIdx === 'number') selectedClassIdx = st.selectedClassIdx;
    if (typeof st.selectedSubjectIdx === 'number') selectedSubjectIdx = st.selectedSubjectIdx;
    if (st.collapse && typeof st.collapse === 'object') {
      uiState.collapse = { schedules: !!st.collapse.schedules, config: !!st.collapse.config };
    }
    uiState.autoNextLesson = !!st.autoNextLesson;
    if (typeof st.durClass === 'number' && st.durClass > 0) uiState.durClass = st.durClass;
  } catch (e) { /* ignore */ }
}

// ================= 载入 / 保存 =================
function loadFromContent(content) {
  var parsed = null;
  var text = String(content || '');
  if (text.trim()) {
    var trimmed = text.trim();
    var looksJson = trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[';
    if (looksJson) {
      // 明确是 JSON：解析失败直接回退通用模式，避免精简 YAML 解析器误读 JSON 结构
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    } else {
      try { parsed = parseYaml(text); } catch (e) { parsed = null; }
    }
  }
  var det = detectCses(parsed);
  if (det.ok) {
    isCses = true;
    csesVersion = det.version;
    cses = normalizeCses(parsed, det.version);
    enterCsesMode();
    return true;
  }
  // 非 CSES：交给平台默认编辑器，插件停止渲染与保存
  isCses = false;
  cses = null;
  requestPlatformFallback(det.reason);
  return false;
}

/** 保存统一输出 YAML（仅 CSES 模式；回退后本插件不再保存） */
function buildOutput() {
  if (!isCses || !cses) return '';
  return yamlDump(cses);
}

function saveConfig() {
  if (fallbackActive || !isCses) return;
  runValidation();
  if (validationErrors.length > 0) {
    var msg = validationErrors.slice(0, 5).join('\n');
    if (!confirm('存在 ' + validationErrors.length + ' 个验证错误，仍要保存吗？\n\n' + msg)) return;
  }
  persistViewState();
  var text = buildOutput();
  if (window.CSEditor) {
    if (window.CSEditor.emitSave) window.CSEditor.emitSave(text);
    else if (window.CSEditor.saveContent) window.CSEditor.saveContent(text);
  }
  dirty = false;
  lastSnapshot = snapshot();
  updateStats();
}

/** 平台 Ctrl+S / Ribbon 保存与编辑器内 Ctrl+S 可能同时触发，去抖合并 */
var saveTimer = null;
function requestSave() {
  if (fallbackActive) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfig, 50);
}

/** 格式化：按 CSES 规范归一化当前模型并重绘（保存时统一输出规范 YAML，无源码视图） */
function formatModel() {
  if (!isCses || !cses) return;
  commitUndo();
  cses = normalizeCses(cses, csesVersion);
  dirty = true;
  revalidateSelections();
  renderAll();
  runValidation();
  commitUndo();
  updateStats('已格式化');
}

// ================= 模式切换 =================
function enterCsesMode() {
  var badge = $('csFormatBadge');
  badge.className = 'cs-badge cs-is-cses';
  $('csFormatText').textContent = 'CSES 模板 V' + csesVersion + '.0';
  $('csViewTabs').style.display = '';
  $('csConfigTab').style.display = csesVersion === 2 ? '' : 'none';
  $('csConfigName').style.display = csesVersion === 2 ? '' : 'none';
  $('csUpgradeBtn').style.display = csesVersion === 1 ? '' : 'none';
  var tabs = document.querySelectorAll('#csViewTabs .cs-view-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('disabled');
  revalidateSelections();
  lastSnapshot = snapshot();
  switchView(view);
  renderAll();
  runValidation();
}

function redetect() {
  var text = (window.CSEditor && window.CSEditor.file ? (window.CSEditor.file.content || '') : '');
  loadFromContent(text);
}

/** 非识别文件初始化为 CSES V2.0 空白模板（Ribbon 新建课程表/科目等命令入口） */
function ensureCsesMode() {
  if (!isCses) {
    if (!confirm('当前文件未识别为 CSES 课表，继续将把文件初始化为 CSES V2.0 空白模板（原内容将被覆盖）。是否继续？')) {
      throw new Error('cancelled');
    }
    cses = blankCses(2);
    csesVersion = 2;
    isCses = true;
    dirty = true;
    enterCsesMode();
  }
}

/** V1.0 → V2.0 模板升级：新增 configuration，room 映射为 location，enable_day 转数组 */
function upgradeToV2() {
  if (!isCses || csesVersion !== 1) return;
  if (!confirm('将当前 V1.0 课表升级为 V2.0 模板：\n\n· 新增 configuration（名称 / 描述 / 周期）\n· 科目的 room 映射为 location（room 作为未知字段保留）\n· 课程表 enable_day 转为数组，weeks 单双周信息保留为未知字段\n\n是否继续？')) return;
  commitUndo();
  cses.version = 2;
  if (!isPlainObject(cses.configuration)) {
    cses.configuration = {
      name: '',
      description: '',
      cycle: { work_count: 5, rest_count: 2, spans: [{ activity: 'work', count: 5 }, { activity: 'rest', count: 2 }] }
    };
  }
  cses.subjects.forEach(function (sub) {
    if (isPlainObject(sub) && sub.location == null && sub.room != null) sub.location = String(sub.room);
  });
  cses.schedules.forEach(function (s) {
    if (isPlainObject(s) && !Array.isArray(s.enable_day)) {
      var d = parseInt(s.enable_day, 10);
      s.enable_day = [isNaN(d) ? 1 : d];
    }
  });
  csesVersion = 2;
  cses = normalizeCses(cses, 2);
  dirty = true;
  commitUndo();
  enterCsesMode();
}

function updateStats(extra) {
  var s = '';
  if (isCses && cses) {
    var classCount = 0;
    cses.schedules.forEach(function (sc) { classCount += (sc.classes || []).length; });
    s = '科目 ' + cses.subjects.length + ' · 课程表 ' + cses.schedules.length + ' · 课时 ' + classCount + (dirty ? ' · 未保存' : '');
  }
  if (extra) s += (s ? ' · ' : '') + extra;
  $('csStats').textContent = s;
}

function switchView(v) {
  if (v === 'config' && csesVersion !== 2) v = 'schedules';
  var map = { schedules: 'csViewSchedules', subjects: 'csViewSubjects', config: 'csViewConfig' };
  if (!map[v]) v = 'schedules';
  view = v;
  for (var key in map) { $(map[key]).style.display = key === v ? '' : 'none'; }
  var tabs = document.querySelectorAll('#csViewTabs .cs-view-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === v);
  if (v === 'schedules') applyScheduleSubView();
  persistViewState();
  renderAll();
}

function switchScheduleSubView(sub) {
  scheduleSubView = sub;
  persistViewState();
  applyScheduleSubView();
  renderAll();
}

function applyScheduleSubView() {
  var tabs = document.querySelectorAll('#csSchedSubTabs .cs-subtab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-sub') === scheduleSubView);
  $('csSchedListWrap').style.display = scheduleSubView === 'list' ? '' : 'none';
  $('csWeekWrap').style.display = scheduleSubView === 'week' ? '' : 'none';
}

/** 收起/展开设置区（状态存于浏览器） */
function toggleCollapse(key) {
  uiState.collapse[key] = !uiState.collapse[key];
  persistViewState();
  renderAll();
}

function renderAll() {
  if (!isCses || !cses) return;
  var nameInput = $('csConfigName');
  if (nameInput && document.activeElement !== nameInput && csesVersion === 2) nameInput.value = cses.configuration.name || '';
  renderScheduleList();
  renderScheduleDetail();
  renderWeekView();
  renderSubjects();
  renderSubjectDetail();
  if (csesVersion === 2) renderConfig();
  updateQuickDock();
  updateStats();
}

// ================= 课程表（列表视图） =================
function renderScheduleList() {
  var list = $('csScheduleList');
  if (!list) return;
  if (!cses.schedules.length) {
    list.innerHTML = '<div class="cs-empty" style="padding:12px">暂无课程表，点击「+ 课程表」创建</div>';
    return;
  }
  var html = '';
  cses.schedules.forEach(function (s, idx) {
    var classCount = (s.classes || []).length;
    html += '<div class="cs-list-item' + (idx === selectedScheduleIdx ? ' selected' : '') + '" onclick="selectSchedule(' + idx + ')" title="' + escAttr(scheduleTitle(s, idx) + '（' + scheduleMeta(s) + '）') + '">' +
      '<span class="cs-item-name">' + escHtml(scheduleTitle(s, idx)) + '</span>' +
      '<span class="cs-li-meta">' + escHtml(scheduleMeta(s)) + ' · ' + classCount + ' 课时</span>' +
      '<button class="cs-li-del" title="删除课程表" onclick="event.stopPropagation();removeSchedule(' + idx + ')">×</button>' +
      '</div>';
  });
  list.innerHTML = html;
}

function selectSchedule(idx) {
  selectedScheduleIdx = idx;
  selectedClassIdx = -1;
  quickDockTarget = null;
  persistViewState();
  renderScheduleList();
  renderScheduleDetail();
  renderQuickDock();
}

function renderScheduleDetail() {
  var box = $('csScheduleDetail');
  if (!box) return;
  var s = selectedScheduleIdx >= 0 ? cses.schedules[selectedScheduleIdx] : null;
  if (!s) { box.innerHTML = '<div class="cs-empty">选择左侧课程表以编辑</div>'; return; }
  if (!Array.isArray(s.classes)) s.classes = [];
  var collapsed = !!uiState.collapse.schedules;

  var metaHtml = '';
  if (csesVersion === 1) {
    var dayOpts = '';
    for (var d = 1; d <= 7; d++) dayOpts += '<option value="' + d + '"' + (parseInt(s.enable_day, 10) === d ? ' selected' : '') + '>' + DAY_NAMES[d] + '</option>';
    var weekOpts = '';
    ['all', 'odd', 'even'].forEach(function (w) {
      weekOpts += '<option value="' + w + '"' + (s.weeks === w ? ' selected' : '') + '>' + WEEK_MAP[w] + '</option>';
    });
    metaHtml =
      '<div class="cs-field"><label>启用星期（enable_day）</label><select onchange="onScheduleField(\'enable_day\', parseInt(this.value))">' + dayOpts + '</select></div>' +
      '<div class="cs-field"><label>周模式（weeks）</label><select onchange="onScheduleField(\'weeks\', this.value)">' + weekOpts + '</select></div>';
  } else {
    metaHtml =
      '<div class="cs-field" style="grid-column:1/-1"><label>启用日（enable_day，可多选）</label><div class="cs-day-chips">' + dayChipsHtml(s) + '</div></div>';
  }

  var classesHtml = '';
  if (s.classes.length === 0) {
    classesHtml = '<div class="cs-empty" style="padding:8px">暂无课程，点击「+ 添加课程」从 08:00 开始排一天的时间。</div>';
  }
  s.classes.forEach(function (cls, i) {
    var subjectOptions = subjectOptionsHtml(cls.subject);
    classesHtml += '<div class="cs-class-row' + (isDockRow(i) ? ' selected' : '') + '" onclick="selectLessonRow(' + i + ')" title="点击选中此课程，在右侧快速选择菜单中选择科目">' +
      '<span class="cs-idx" title="点击选中此课程" onclick="selectLessonRow(' + i + ')">' + (i + 1) + '</span>' +
      '<input type="time" step="1" value="' + escAttr(shortTime(normalizeTime(cls.start_time))) + '" onchange="onClassTime(' + i + ',\'start_time\',this.value)" onclick="selectLessonRow(' + i + ')" />' +
      '<input type="time" step="1" value="' + escAttr(shortTime(normalizeTime(cls.end_time))) + '" onchange="onClassTime(' + i + ',\'end_time\',this.value)" onclick="selectLessonRow(' + i + ')" />' +
      '<select onchange="onClassChange(' + i + ',\'subject\',this.value)" onclick="selectLessonRow(' + i + ')' + '" class="' + (cls.subject && !findSubject(cls.subject) ? 'cs-missing-subject' : '') + '">' + subjectOptions + '</select>' +
      '<span style="display:inline-flex;gap:2px">' +
        '<button class="cs-row-del" title="上移" onclick="event.stopPropagation();moveClass(' + i + ',-1)">&#8593;</button>' +
        '<button class="cs-row-del" title="下移" onclick="event.stopPropagation();moveClass(' + i + ',1)">&#8595;</button>' +
        '<button class="cs-row-del" title="删除" onclick="event.stopPropagation();removeClass(' + i + ')">×</button>' +
      '</span>' +
      '</div>';
  });

  var html = '<h3 class="cs-detail-title">课程表设置</h3>' +
    '<div class="cs-collapse' + (collapsed ? ' cs-collapsed' : '') + '">' +
    '<div class="cs-collapse-head" onclick="toggleCollapse(\'schedules\')">' +
    '<span class="cs-collapse-title">课程表信息（' + escHtml(scheduleMeta(s)) + '）</span><span class="cs-collapse-chevron">&#9662;</span>' +
    '</div>' +
    '<div class="cs-collapse-body"><div class="cs-form-grid">' +
    '<div class="cs-field" style="grid-column:1/-1"><label>名称（name）</label><input value="' + escAttr(s.name || '') + '" placeholder="课程表名称" oninput="onScheduleField(\'name\', this.value)" /></div>' +
    metaHtml +
    '</div></div></div>' +
    '<div class="cs-items-head"><span class="cs-panel-title">课程（classes，按时间顺序排列）</span>' +
    '<div class="cs-items-actions">' +
    '<span class="cs-dur-field" title="添加课程时使用的默认时长">时长<input type="number" min="1" max="600" value="' + escAttr(uiState.durClass) + '" onchange="onDurChange(this.value)" />分</span>' +
    '<button class="cs-btn small" onclick="addClass()">+ 添加课程</button>' +
    '</div></div>' +
    classesHtml;
  box.innerHTML = html;
}

/** V2 启用日多选 chips（已有超出 7 的启用日也会展示） */
function dayChipsHtml(s) {
  var days = daysOf(s);
  var pool = [1, 2, 3, 4, 5, 6, 7];
  days.forEach(function (d) { if (pool.indexOf(d) < 0) pool.push(d); });
  var html = '';
  pool.forEach(function (d) {
    var on = days.indexOf(d) >= 0;
    html += '<label class="cs-day-chip' + (on ? ' on' : '') + '" onclick="toggleScheduleDay(' + d + ')">' + escHtml(dayName(d)) + '</label>';
  });
  return html;
}

function toggleScheduleDay(day) {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s) return;
  var days = daysOf(s);
  var pos = days.indexOf(day);
  if (pos >= 0) days.splice(pos, 1); else days.push(day);
  days.sort(function (a, b) { return a - b; });
  if (csesVersion === 1) {
    s.enable_day = days.length ? days[0] : 1;
  } else {
    s.enable_day = days;
  }
  dirty = true;
  queueUndo();
  renderScheduleList();
  renderScheduleDetail();
  renderWeekView();
  runValidation();
}

function isDockRow(i) {
  return !!(quickDockTarget && quickDockTarget.schedIdx === selectedScheduleIdx && quickDockTarget.clsIdx === i);
}

function onScheduleField(field, value) {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s) return;
  s[field] = value;
  dirty = true;
  queueUndo();
  if (field === 'name') renderScheduleList();
  if (field === 'enable_day' || field === 'weeks') renderWeekView();
}

function onDurChange(value) {
  var v = parseInt(value, 10);
  if (isNaN(v) || v < 0) v = 40;
  uiState.durClass = Math.min(v, 600);
  persistViewState();
}

function subjectOptionsHtml(selected) {
  var html = '';
  var found = false;
  cses.subjects.forEach(function (sub, i) {
    if (!isPlainObject(sub)) return;
    var name = sub.name || '';
    if (name === selected) found = true;
    html += '<option value="' + escAttr(name) + '"' + (name === selected ? ' selected' : '') + '>' + escHtml(name || ('科目 ' + (i + 1))) + '</option>';
  });
  if (selected && !found) {
    html = '<option value="' + escAttr(selected) + '" selected>' + escHtml(selected) + '（未知科目）</option>' + html;
  }
  if (!html) html = '<option value="">（请先在「科目」中添加）</option>';
  return html;
}

function findSubject(name) {
  for (var i = 0; i < cses.subjects.length; i++) {
    var sub = cses.subjects[i];
    if (isPlainObject(sub) && sub.name === name) return sub;
  }
  return null;
}

function addClass() {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s) { alert('请先创建/选择一个课程表'); return; }
  if (!Array.isArray(s.classes)) s.classes = [];
  var prev = s.classes.length ? s.classes[s.classes.length - 1] : null;
  var start = prev && normalizeTime(prev.end_time) ? normalizeTime(prev.end_time) : '08:00:00';
  var firstSubject = '';
  for (var i = 0; i < cses.subjects.length; i++) {
    if (isPlainObject(cses.subjects[i]) && cses.subjects[i].name) { firstSubject = cses.subjects[i].name; break; }
  }
  s.classes.push({ subject: firstSubject, start_time: start, end_time: addMinutes(start, parseInt(uiState.durClass, 10) || 40) });
  selectedClassIdx = s.classes.length - 1;
  dirty = true;
  commitUndo();
  renderScheduleDetail(); runValidation();
}

function removeClass(idx) {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s || !s.classes || !s.classes[idx]) return;
  s.classes.splice(idx, 1);
  if (quickDockTarget && quickDockTarget.schedIdx === selectedScheduleIdx && quickDockTarget.clsIdx === idx) quickDockTarget = null;
  selectedClassIdx = -1;
  dirty = true;
  commitUndo();
  renderScheduleDetail(); renderWeekView(); runValidation();
}

function moveClass(idx, delta) {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s || !Array.isArray(s.classes)) return;
  var j = idx + delta;
  if (j < 0 || j >= s.classes.length) return;
  var items = s.classes;
  var tmp = items[idx];
  items[idx] = items[j];
  items[j] = tmp;
  selectedClassIdx = j;
  dirty = true;
  commitUndo();
  renderScheduleDetail(); renderWeekView(); runValidation();
}

function onClassChange(idx, field, value) {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s || !s.classes || !s.classes[idx]) return;
  s.classes[idx][field] = value;
  dirty = true;
  queueUndo();
  renderWeekView();
  runValidation();
}

function onClassTime(idx, field, value) {
  var s = cses.schedules[selectedScheduleIdx];
  if (!s || !s.classes || !s.classes[idx]) return;
  s.classes[idx][field] = normalizeTime(value) || '00:00:00';
  dirty = true;
  queueUndo();
  renderWeekView();
  runValidation();
}

function addSchedule() {
  ensureCsesMode();
  var ns = csesVersion === 1
    ? { name: '新课程表', enable_day: 1, weeks: 'all', classes: [] }
    : { name: '新课程表', enable_day: [1], classes: [] };
  cses.schedules.push(ns);
  selectedScheduleIdx = cses.schedules.length - 1;
  selectedClassIdx = -1;
  dirty = true;
  commitUndo();
  switchView('schedules');
  switchScheduleSubView('list');
  renderAll(); runValidation();
}

function duplicateSchedule() {
  var src = selectedScheduleIdx >= 0 ? cses.schedules[selectedScheduleIdx] : null;
  if (!src) { alert('请先选择一个课程表'); return; }
  var copy = JSON.parse(JSON.stringify(src));
  copy.name = (src.name || '课程表') + ' 副本';
  cses.schedules.push(copy);
  selectedScheduleIdx = cses.schedules.length - 1;
  selectedClassIdx = -1;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

function removeSchedule(idx) {
  var s = cses.schedules[idx];
  if (!s) return;
  if (!confirm('确认删除课程表「' + scheduleTitle(s, idx) + '」？')) return;
  cses.schedules.splice(idx, 1);
  if (selectedScheduleIdx === idx) { selectedScheduleIdx = cses.schedules.length - 1; selectedClassIdx = -1; quickDockTarget = null; }
  dirty = true;
  commitUndo();
  revalidateSelections();
  renderAll(); runValidation();
}

// ================= 周视图 =================
function schedulesForDay(day) {
  return cses.schedules.map(function (s, idx) { return { s: s, idx: idx }; }).filter(function (entry) {
    var s = entry.s;
    if (!isPlainObject(s)) return false;
    var days = daysOf(s);
    if (days.indexOf(day) < 0) return false;
    if (csesVersion === 1 && weekMode) {
      if (weekMode === 'odd' && s.weeks !== 'odd' && s.weeks !== 'all') return false;
      if (weekMode === 'even' && s.weeks !== 'even' && s.weeks !== 'all') return false;
      if (weekMode === 'all' && s.weeks !== 'all') return false;
    }
    return true;
  });
}

function renderWeekView() {
  var box = $('csWeekWrap');
  if (!box) return;
  if (!isCses || !cses) { box.innerHTML = ''; return; }

  var html = '<div class="cs-week-toolbar">';
  if (csesVersion === 1) {
    html += '<span>周类型</span><select onchange="weekMode=this.value; renderWeekView()">';
    html += '<option value=""' + (weekMode === '' ? ' selected' : '') + '>全部</option>';
    ['all', 'odd', 'even'].forEach(function (w) {
      html += '<option value="' + w + '"' + (weekMode === w ? ' selected' : '') + '>' + WEEK_MAP[w] + '</option>';
    });
    html += '</select>';
    html += '<span>按星期展示各课程表的课程安排（单周 / 双周模式额外包含通用课表）</span>';
  } else {
    html += '<span>按启用日（enable_day）展示各课程表的课程安排</span>';
  }
  html += '<label class="cs-week-autonext"><input type="checkbox" ' + (uiState.autoNextLesson ? 'checked' : '') + ' onchange="onAutoNextChange(this.checked)" />选完自动跳到下一节</label>';
  html += '<span>点击课程选中，再点打开科目面板</span></div>';

  var todayDow = new Date().getDay();
  var todayDay = todayDow === 0 ? 7 : todayDow;
  html += '<div class="cs-week-grid">';
  [1, 2, 3, 4, 5, 6, 7].forEach(function (day) {
    var entries = schedulesForDay(day);
    html += '<div class="cs-week-col">' +
      '<div class="cs-week-col-head' + (day === todayDay ? ' today' : '') + '"><span>' + DAY_NAMES[day] + '</span>' + (day === todayDay ? '<span>今天</span>' : '') + '</div>' +
      '<div class="cs-week-col-body">';
    if (entries.length === 0) html += '<div class="cs-week-empty">无课程表</div>';
    entries.forEach(function (entry) {
      var s = entry.s;
      var classes = Array.isArray(s.classes) ? s.classes.slice().sort(function (a, b) { return toSec(normalizeTime(a.start_time)) - toSec(normalizeTime(b.start_time)); }) : [];
      html += '<div class="cs-week-plan" onclick="selectSchedule(' + entry.idx + '); switchScheduleSubView(\'list\')" title="点击课程表名进入列表编辑">' +
        '<div class="cs-week-plan-name"><span>' + escHtml(scheduleTitle(s, entry.idx)) + '</span>' +
        (csesVersion === 1 && s.weeks && s.weeks !== 'all' ? '<span class="cs-week-rot">' + escHtml(WEEK_MAP[s.weeks]) + '</span>' : '') +
        '</div>';
      if (classes.length === 0) {
        html += '<div class="cs-week-empty">（无课程）</div>';
      } else {
        classes.forEach(function (cls) {
          var sIdx = entry.idx;
          var cIdx = s.classes.indexOf(cls);
          var sub = findSubject(cls.subject);
          var name = cls.subject || '—';
          var initial = sub && sub.simplified_name ? sub.simplified_name : name;
          var isSel = quickDockTarget && quickDockTarget.schedIdx === sIdx && quickDockTarget.clsIdx === cIdx;
          var isEditing = quickSelectCtx && quickSelectCtx.schedIdx === sIdx && quickSelectCtx.clsIdx === cIdx;
          html += '<button class="cs-week-lesson' + (isSel ? ' selected' : '') + (isEditing ? ' editing' : '') + '"' +
            ' title="点击选中此节次；再次点击打开科目选择面板"' +
            ' onclick="event.stopPropagation(); weekLessonClick(' + sIdx + ', ' + cIdx + ')">' +
            '<span class="cs-lesson-time">' + escHtml(shortTime(normalizeTime(cls.start_time))) + '</span>' +
            '<span class="cs-lesson-name">' + escHtml(initial) + '</span>' +
            '</button>';
        });
      }
      html += '</div>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  box.innerHTML = html;
}

/** 周视图：点击单元格选中；再次点击已选中的单元格打开科目选择面板 */
function weekLessonClick(schedIdx, clsIdx) {
  var t = quickDockTarget;
  if (t && t.schedIdx === schedIdx && t.clsIdx === clsIdx) {
    openQuickSelect(schedIdx, clsIdx);
    return;
  }
  quickDockTarget = { schedIdx: schedIdx, clsIdx: clsIdx };
  renderWeekView();
  renderQuickDock();
}

// ================= 常驻快速选择菜单（列表 / 周视图右侧，仅科目名称） =================
/** 列表视图：点击课程行选中当前课程，配合右侧快速选择菜单 */
function selectLessonRow(i) {
  if (selectedScheduleIdx < 0) return;
  quickDockTarget = { schedIdx: selectedScheduleIdx, clsIdx: i };
  var rows = document.querySelectorAll('#csScheduleDetail .cs-class-row');
  for (var k = 0; k < rows.length; k++) rows[k].classList.toggle('selected', k === i);
  renderQuickDock();
}

function onAutoNextChange(v) {
  uiState.autoNextLesson = !!v;
  persistViewState();
}

function updateQuickDock() {
  var dock = $('csQuickDock');
  if (!dock) return;
  var show = isCses && view === 'schedules' && (scheduleSubView === 'list' || scheduleSubView === 'week');
  dock.style.display = show ? 'flex' : 'none';
  var cb = $('csDockAutoNext');
  if (cb) cb.checked = !!uiState.autoNextLesson;
  if (show) renderQuickDock();
}

/** 渲染快速选择菜单（仅科目名称；高亮当前目标课程已设置的科目） */
function renderQuickDock() {
  var list = $('csQuickDockList');
  if (!list || !isCses || !cses) return;
  var currentSub = null;
  if (quickDockTarget) {
    var s = cses.schedules[quickDockTarget.schedIdx];
    var cls = s && s.classes ? s.classes[quickDockTarget.clsIdx] : null;
    currentSub = cls ? cls.subject : null;
  }
  var html = '';
  cses.subjects.forEach(function (sub, idx) {
    if (!isPlainObject(sub)) return;
    var name = sub.name || '';
    html += '<button class="cs-dock-item' + (name && name === currentSub ? ' current' : '') + '" onclick="quickDockAssign(' + idx + ')" title="应用到选中的课程">' + escHtml(name || '未命名') + '</button>';
  });
  list.innerHTML = html || '<div class="cs-empty">暂无科目</div>';
}

/** 应用快速选择：把科目写入当前选中的课程位置（可自动跳到下一节） */
function quickDockAssign(subjectIdx) {
  var t = quickDockTarget;
  if (!t) { alert('请先在列表或周视图中点击选择一个课程位置'); return; }
  var sub = cses.subjects[subjectIdx];
  if (!isPlainObject(sub)) return;
  var s = cses.schedules[t.schedIdx];
  if (!s || !s.classes || !s.classes[t.clsIdx]) {
    alert('课程位置已失效，请重新选择');
    quickDockTarget = null;
    renderQuickDock();
    return;
  }
  s.classes[t.clsIdx].subject = sub.name || '';
  dirty = true;
  commitUndo();
  runValidation();
  if (uiState.autoNextLesson && s.classes[t.clsIdx + 1]) {
    quickDockTarget = { schedIdx: t.schedIdx, clsIdx: t.clsIdx + 1 };
  } else {
    quickDockTarget = null;
  }
  renderScheduleDetail();
  renderWeekView();
  renderQuickDock();
}

// ================= 课程快速选择面板 =================
function openQuickSelect(schedIdx, clsIdx) {
  var s = cses.schedules[schedIdx];
  if (!s || !s.classes || !s.classes[clsIdx]) return;
  quickSelectCtx = { schedIdx: schedIdx, clsIdx: clsIdx };
  $('csQuickTitle').textContent = '快速选择科目（' + scheduleTitle(s, schedIdx) + ' 第 ' + (clsIdx + 1) + ' 节）';
  $('csQuickSelect').style.display = '';
  $('csQuickSearch').value = '';
  renderQuickSelect();
  renderWeekView(); // 高亮当前正在编辑的课程
  $('csQuickSearch').focus();
}

function closeQuickSelect() {
  $('csQuickSelect').style.display = 'none';
  quickSelectCtx = null;
  renderWeekView();
}

function renderQuickSelect() {
  var grid = $('csQuickGrid');
  if (!grid || !quickSelectCtx) return;
  var kw = ($('csQuickSearch').value || '').trim().toLowerCase();
  var s = cses.schedules[quickSelectCtx.schedIdx];
  var current = s && s.classes ? s.classes[quickSelectCtx.clsIdx].subject : null;
  var html = '';
  var any = false;
  cses.subjects.forEach(function (sub) {
    if (!isPlainObject(sub)) return;
    var name = sub.name || '';
    if (kw && (name + (sub.simplified_name || '')).toLowerCase().indexOf(kw) < 0) return;
    any = true;
    html += '<button class="cs-quick-item' + (name === current ? ' current' : '') + '" onclick="quickPickSubject(' + cses.subjects.indexOf(sub) + ')">' +
      '<span class="q-init">' + escHtml(sub.simplified_name || (name.slice(0, 1) || '?')) + '</span>' +
      '<span class="q-name">' + escHtml(name) + '</span>' +
      '</button>';
  });
  if (!any) html = '<div class="cs-empty">没有匹配的科目</div>';
  html += '<label class="cs-quick-autonext"><input type="checkbox" ' + (uiState.autoNextLesson ? 'checked' : '') + ' onchange="onAutoNextChange(this.checked)" />选完自动跳到下一节</label>';
  grid.innerHTML = html;
}

function quickPickSubject(subIdx) {
  if (!quickSelectCtx) return;
  var sub = cses.subjects[subIdx];
  var s = cses.schedules[quickSelectCtx.schedIdx];
  if (sub && s && s.classes && s.classes[quickSelectCtx.clsIdx]) {
    s.classes[quickSelectCtx.clsIdx].subject = sub.name || '';
    dirty = true;
    commitUndo();
    runValidation();
    // 对齐 ClassIsland 2：选完自动跳到下一节
    if (uiState.autoNextLesson && s.classes[quickSelectCtx.clsIdx + 1]) {
      quickSelectCtx.clsIdx += 1;
      $('csQuickTitle').textContent = '快速选择科目（' + scheduleTitle(s, quickSelectCtx.schedIdx) + ' 第 ' + (quickSelectCtx.clsIdx + 1) + ' 节）';
      $('csQuickSearch').value = '';
      renderQuickSelect();
      renderScheduleDetail();
      renderWeekView();
      renderQuickDock();
      return;
    }
  }
  closeQuickSelect();
  renderScheduleDetail();
  renderWeekView();
  renderQuickDock();
}

// ================= 科目（左表格 + 右详情，预设科目） =================
function renderSubjects() {
  var body = $('csSubjectsBody');
  var lastCol = $('csSubjectLastCol');
  if (lastCol) lastCol.textContent = csesVersion === 1 ? '教室 (room)' : '地点 (location)';
  $('csSubjectsEmpty').style.display = cses.subjects.length === 0 ? '' : 'none';
  var html = '';
  cses.subjects.forEach(function (sub, idx) {
    if (!isPlainObject(sub)) return;
    var lastKey = csesVersion === 1 ? 'room' : 'location';
    html += '<tr class="cs-subject-row' + (idx === selectedSubjectIdx ? ' selected' : '') + '" data-subject-idx="' + idx + '" onclick="selectSubject(' + idx + ')">' +
      '<td><input class="cs-cell-input" value="' + escAttr(sub.name || '') + '" placeholder="如：数学" onclick="event.stopPropagation();selectSubject(' + idx + ')" oninput="onSubjectChange(' + idx + ',\'name\',this.value)" /></td>' +
      '<td><input class="cs-cell-input" value="' + escAttr(sub.simplified_name || '') + '" placeholder="如：数" onclick="event.stopPropagation()" oninput="onSubjectChange(' + idx + ',\'simplified_name\',this.value)" /></td>' +
      '<td><input class="cs-cell-input" value="' + escAttr(sub.teacher || '') + '" placeholder="教师姓名" onclick="event.stopPropagation()" oninput="onSubjectChange(' + idx + ',\'teacher\',this.value)" /></td>' +
      '<td><input class="cs-cell-input" value="' + escAttr(sub[lastKey] || '') + '" placeholder="' + (csesVersion === 1 ? '上课教室' : '上课地点') + '" onclick="event.stopPropagation()" oninput="onSubjectChange(' + idx + ',\'' + lastKey + '\',this.value)" /></td>' +
      '</tr>';
  });
  body.innerHTML = html;
}

function selectSubject(idx) {
  // 只切换高亮与详情，不重建科目表格——避免点击单元格输入框时 DOM 被替换导致无法输入
  selectedSubjectIdx = idx;
  persistViewState();
  var rows = document.querySelectorAll('#csSubjectsBody .cs-subject-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('selected', parseInt(rows[i].getAttribute('data-subject-idx'), 10) === idx);
  }
  renderSubjectDetail();
}

function renderSubjectDetail() {
  var box = $('csSubjectDetail');
  if (!isCses) { box.innerHTML = ''; return; }
  var sub = selectedSubjectIdx >= 0 ? cses.subjects[selectedSubjectIdx] : null;
  if (!sub) { box.innerHTML = '<div class="cs-empty">选择左侧科目以编辑详情</div>'; return; }
  var lastKey = csesVersion === 1 ? 'room' : 'location';
  var html = '<h3 class="cs-detail-title">科目详情</h3>' +
    '<div class="cs-form-grid">' +
    '<div class="cs-field"><label>科目名称（name）</label><input value="' + escAttr(sub.name || '') + '" oninput="onSubjectChange(' + selectedSubjectIdx + ',\'name\',this.value)" /></div>' +
    '<div class="cs-field"><label>简称（simplified_name）</label><input value="' + escAttr(sub.simplified_name || '') + '" oninput="onSubjectChange(' + selectedSubjectIdx + ',\'simplified_name\',this.value)" /></div>' +
    '<div class="cs-field"><label>教师（teacher）</label><input value="' + escAttr(sub.teacher || '') + '" oninput="onSubjectChange(' + selectedSubjectIdx + ',\'teacher\',this.value)" /></div>' +
    '<div class="cs-field"><label>' + (csesVersion === 1 ? '教室（room）' : '地点（location）') + '</label><input value="' + escAttr(sub[lastKey] || '') + '" oninput="onSubjectChange(' + selectedSubjectIdx + ',\'' + lastKey + '\',this.value)" /></div>' +
    '</div>' +
    '<div class="cs-hint">课程表中的课程通过「名称」引用科目；重命名会自动同步所有引用。</div>' +
    '<div id="csPresetWrap"></div>';
  box.innerHTML = html;
  renderPresetPanel();
}

/**
 * 科目变更：重命名时同步课程表中对该科目的引用（课程通过名称引用科目）
 */
function onSubjectChange(idx, field, value) {
  var sub = cses.subjects[idx];
  if (!isPlainObject(sub)) return;
  var oldName = sub.name;
  sub[field] = value;
  if (field === 'name' && oldName !== value) {
    cses.schedules.forEach(function (s) {
      if (!isPlainObject(s) || !Array.isArray(s.classes)) return;
      s.classes.forEach(function (c) {
        if (c.subject === oldName) c.subject = value;
      });
    });
    renderWeekView();
    renderQuickDock();
  }
  dirty = true;
  queueUndo();
  updateStats();
}

function addSubject() {
  ensureCsesMode();
  var sub = { name: '新科目', simplified_name: '', teacher: '' };
  sub[csesVersion === 1 ? 'room' : 'location'] = '';
  cses.subjects.push(sub);
  selectedSubjectIdx = cses.subjects.length - 1;
  dirty = true;
  commitUndo();
  switchView('subjects');
  renderAll(); runValidation();
}

function duplicateSubject() {
  var idx = selectedSubjectIdx;
  if (idx < 0 || !isPlainObject(cses.subjects[idx])) { alert('请先选择一个科目'); return; }
  var copy = JSON.parse(JSON.stringify(cses.subjects[idx]));
  copy.name = (copy.name || '科目') + ' 副本';
  cses.subjects.push(copy);
  selectedSubjectIdx = cses.subjects.length - 1;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

function removeSelectedSubject() {
  var idx = selectedSubjectIdx;
  if (idx < 0 || !isPlainObject(cses.subjects[idx])) { alert('请先选择一个科目'); return; }
  var sub = cses.subjects[idx];
  if (!confirm('确认删除科目「' + (sub.name || '未命名') + '」？课程表中对它的引用将失效。')) return;
  cses.subjects.splice(idx, 1);
  if (selectedSubjectIdx === idx) selectedSubjectIdx = -1;
  dirty = true;
  commitUndo();
  revalidateSelections();
  renderAll(); runValidation();
}

/** 预设科目面板（常用科目，已添加的会置灰） */
function showPresetPanel() {
  presetOpen = !presetOpen;
  renderPresetPanel();
}

function renderPresetPanel() {
  var wrap = $('csPresetWrap');
  if (!wrap) return;
  if (!presetOpen) { wrap.innerHTML = ''; return; }
  var roomKey = csesVersion === 1 ? 'room' : 'location';
  var html = '<div class="cs-preset-wrap">' +
    '<div class="cs-panel-title">常用科目预设（已添加的科目会置灰）</div>' +
    '<div class="cs-preset-grid">';
  PRESET_SUBJECTS.forEach(function (p, i) {
    var added = !!findSubject(p.name);
    html += '<button class="cs-preset-chip' + (added ? ' added' : '') + '" ' + (added ? 'disabled' : 'onclick="addPresetSubject(' + i + ')"') + '>' +
      '<span class="p-init">' + escHtml(p.simplified) + '</span>' +
      '<span class="p-name">' + escHtml(p.name) + '</span>' +
      (added ? '<span class="p-added">已添加</span>' : '') +
      '</button>';
  });
  html += '</div>' +
    '<div style="margin-top:8px"><button class="cs-btn small primary" onclick="addAllPresetSubjects()">添加全部未添加科目</button></div>' +
    '</div>';
  wrap.innerHTML = html;
}

function addPresetSubject(presetIdx) {
  var p = PRESET_SUBJECTS[presetIdx];
  if (!p || findSubject(p.name)) return;
  var sub = { name: p.name, simplified_name: p.simplified, teacher: '' };
  sub[csesVersion === 1 ? 'room' : 'location'] = '';
  cses.subjects.push(sub);
  selectedSubjectIdx = cses.subjects.length - 1;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

function addAllPresetSubjects() {
  var roomKey = csesVersion === 1 ? 'room' : 'location';
  var added = 0;
  PRESET_SUBJECTS.forEach(function (p) {
    if (!findSubject(p.name)) {
      var sub = { name: p.name, simplified_name: p.simplified, teacher: '' };
      sub[roomKey] = '';
      cses.subjects.push(sub);
      added++;
    }
  });
  if (added > 0) { dirty = true; commitUndo(); renderAll(); runValidation(); }
  alert(added > 0 ? ('已添加 ' + added + ' 个预设科目') : '全部预设科目均已添加');
}

// ================= 配置（CSES V2.0 configuration / cycle） =================
function renderConfig() {
  if (csesVersion !== 2) return;
  var cfg = cses.configuration;
  var desc = $('csConfigDesc');
  if (desc && document.activeElement !== desc) desc.value = cfg.description || '';
  $('csConfigCollapse').classList.toggle('cs-collapsed', !!uiState.collapse.config);

  var cyc = cfg.cycle;
  $('csCycleGrid').innerHTML =
    '<div class="cs-field"><label>工作日总数（work_count）</label><input type="number" min="1" value="' + escAttr(cyc.work_count) + '" onchange="onCycleField(\'work_count\', this.value)" /></div>' +
    '<div class="cs-field"><label>休息日总数（rest_count）</label><input type="number" min="0" value="' + escAttr(cyc.rest_count) + '" onchange="onCycleField(\'rest_count\', this.value)" /></div>';

  var rows = '';
  (cyc.spans || []).forEach(function (span, i) {
    var act = span.activity === 'rest' ? 'rest' : 'work';
    rows += '<div class="cs-span-row">' +
      '<span class="cs-idx">' + (i + 1) + '</span>' +
      '<select onchange="onSpanChange(' + i + ',\'activity\',this.value)">' +
        '<option value="work"' + (act === 'work' ? ' selected' : '') + '>工作日（work）</option>' +
        '<option value="rest"' + (act === 'rest' ? ' selected' : '') + '>休息日（rest）</option>' +
      '</select>' +
      '<input type="number" min="1" value="' + escAttr(span.count) + '" onchange="onSpanChange(' + i + ',\'count\',this.value)" />' +
      '<button class="cs-row-del" title="删除此段" onclick="removeSpan(' + i + ')">×</button>' +
      '</div>';
  });
  $('csSpanRows').innerHTML = rows || '<div class="cs-empty" style="padding:10px">暂无周期分配，点击上方按钮添加</div>';

  var spanSum = 0;
  (cyc.spans || []).forEach(function (span) { spanSum += parseInt(span.count, 10) || 0; });
  var total = (parseInt(cyc.work_count, 10) || 0) + (parseInt(cyc.rest_count, 10) || 0);
  var hint = $('csCycleHint');
  hint.textContent = '周期总天数 = work_count + rest_count = ' + total + '；spans 计数之和 = ' + spanSum + '。' +
    '启用日 enable_day 的序号对应周期里的第 N 个工作日。';
  hint.className = 'cs-hint' + (spanSum !== total ? ' warn' : '');
}

function onConfigNameInput() {
  if (!isCses || csesVersion !== 2) return;
  cses.configuration.name = $('csConfigName').value;
  dirty = true;
  queueUndo();
}

function onConfigField(field, value) {
  if (!isCses || csesVersion !== 2) return;
  cses.configuration[field] = value;
  dirty = true;
  queueUndo();
}

function onCycleField(field, value) {
  if (!isCses || csesVersion !== 2) return;
  var v = parseInt(value, 10);
  cses.configuration.cycle[field] = isNaN(v) ? 0 : v;
  dirty = true;
  queueUndo();
  renderConfig();
  runValidation();
}

function addSpan(activity) {
  if (!isCses || csesVersion !== 2) return;
  cses.configuration.cycle.spans.push({ activity: activity, count: 1 });
  dirty = true;
  commitUndo();
  renderConfig();
  runValidation();
}

function removeSpan(idx) {
  if (!isCses || csesVersion !== 2) return;
  cses.configuration.cycle.spans.splice(idx, 1);
  dirty = true;
  commitUndo();
  renderConfig();
  runValidation();
}

function onSpanChange(idx, field, value) {
  if (!isCses || csesVersion !== 2) return;
  var span = cses.configuration.cycle.spans[idx];
  if (!isPlainObject(span)) return;
  if (field === 'activity') span.activity = value === 'rest' ? 'rest' : 'work';
  else span.count = parseInt(value, 10) || 1;
  dirty = true;
  queueUndo();
  renderConfig();
  runValidation();
}

// ================= 校验 =================
function runValidation() {
  validationErrors = []; validationWarnings = [];
  if (!isCses || !cses) { renderIssues(); return; }

  if (cses.subjects.length === 0) validationWarnings.push('尚未添加任何科目');
  if (cses.schedules.length === 0) validationWarnings.push('尚未添加任何课程表');

  var subjectNames = {};
  cses.subjects.forEach(function (sub, i) {
    if (!isPlainObject(sub)) {
      validationErrors.push('subjects 第 ' + (i + 1) + ' 项不是对象');
      return;
    }
    var name = sub.name || '';
    if (!String(name).trim()) validationWarnings.push('第 ' + (i + 1) + ' 个科目缺少名称');
    else if (subjectNames[name]) validationErrors.push('存在重复科目名称：' + name);
    subjectNames[name] = true;
  });

  cses.schedules.forEach(function (s, si) {
    if (!isPlainObject(s)) {
      validationErrors.push('schedules 第 ' + (si + 1) + ' 项不是对象');
      return;
    }
    var title = scheduleTitle(s, si);
    if (!String(s.name || '').trim()) validationErrors.push('课程表「' + title + '」缺少名称（name）');
    var days = daysOf(s);
    if (csesVersion === 1) {
      if (days.length === 0 || days[0] < 1 || days[0] > 7) validationErrors.push('课程表「' + title + '」enable_day 应为 1-7 的整数');
      if (['all', 'odd', 'even'].indexOf(s.weeks) < 0) validationErrors.push('课程表「' + title + '」weeks 应为 all / odd / even');
    } else {
      if (days.length === 0) validationErrors.push('课程表「' + title + '」未启用任何日期（enable_day）');
      days.forEach(function (d) {
        if (isNaN(d) || d < 1) validationErrors.push('课程表「' + title + '」enable_day 含无效日期：' + d);
      });
    }
    var prevEnd = -1;
    (s.classes || []).forEach(function (c, ci) {
      var where = '课程表「' + title + '」第 ' + (ci + 1) + ' 节课';
      if (!c.subject) validationErrors.push(where + '缺少科目（subject）');
      else if (!findSubject(c.subject)) validationErrors.push(where + '引用了不存在的科目：' + c.subject);
      var st = normalizeTime(c.start_time), et = normalizeTime(c.end_time);
      if (!st || !et) validationErrors.push(where + '缺少开始/结束时间');
      else {
        if (!TIME_RE.test(st) || !TIME_RE.test(et)) validationErrors.push(where + '时间格式应为 HH:MM:SS');
        else if (et <= st) validationErrors.push(where + '结束时间早于开始时间');
        else {
          var startSec = toSec(st);
          if (prevEnd >= 0 && startSec < prevEnd) {
            validationWarnings.push(where + '与上一节课程时间重叠');
          }
          prevEnd = Math.max(prevEnd, toSec(et));
        }
      }
    });
  });

  if (csesVersion === 2) {
    var cyc = cses.configuration.cycle;
    var wc = parseInt(cyc.work_count, 10), rc = parseInt(cyc.rest_count, 10);
    if (isNaN(wc) || wc < 2) validationErrors.push('configuration.cycle.work_count 应为不小于 2 的整数');
    if (isNaN(rc) || rc < 2) validationErrors.push('configuration.cycle.rest_count 应为不小于 2 的整数');
    if (!Array.isArray(cyc.spans) || cyc.spans.length === 0) {
      validationErrors.push('configuration.cycle.spans 缺少周期分配');
    } else {
      var spanSum = 0;
      cyc.spans.forEach(function (span, i) {
        if (span.activity !== 'work' && span.activity !== 'rest') validationErrors.push('spans 第 ' + (i + 1) + ' 段 activity 应为 work / rest');
        var cnt = parseInt(span.count, 10);
        if (isNaN(cnt) || cnt < 1) validationErrors.push('spans 第 ' + (i + 1) + ' 段 count 应为不小于 1 的整数');
        else spanSum += cnt;
      });
      if (!isNaN(wc) && !isNaN(rc) && spanSum !== wc + rc) {
        validationWarnings.push('spans 计数之和（' + spanSum + '）与周期总天数（' + (wc + rc) + '）不一致');
      }
    }
  }
  renderIssues();
}

function renderIssues() {
  var all = validationErrors.map(function (m) { return { type: 'error', msg: m }; })
    .concat(validationWarnings.map(function (m) { return { type: 'warning', msg: m }; }));
  $('csIssueCount').textContent = all.length;
  var list = $('csIssueList');
  if (all.length === 0) {
    list.innerHTML = '<div class="cs-issue-none">没有发现问题</div>';
  } else {
    list.innerHTML = all.map(function (iss) {
      return '<div class="cs-issue-item ' + iss.type + '"><span class="cs-issue-dot"></span><span>' + escHtml(iss.msg) + '</span></div>';
    }).join('');
  }
}

function toggleIssues() {
  $('csIssuesPanel').classList.toggle('collapsed');
}

// ================= Ribbon 命令（保存由平台保存按钮触发） =================
function handleCommand(cmd) {
  if (fallbackActive) return;
  try {
    switch (cmd) {
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'cs-detect': redetect(); break;
      case 'cs-add-schedule': ensureCsesMode(); addSchedule(); break;
      case 'cs-dup-schedule': if (isCses) duplicateSchedule(); break;
      case 'cs-add-class': if (isCses) { switchView('schedules'); switchScheduleSubView('list'); addClass(); } break;
      case 'cs-add-subject': ensureCsesMode(); addSubject(); break;
      case 'cs-preset-subject': ensureCsesMode(); switchView('subjects'); presetOpen = true; renderAll(); break;
      case 'cs-validate': if (isCses) { runValidation(); alert('校验完成：' + validationErrors.length + ' 个错误，' + validationWarnings.length + ' 个警告'); } break;
      case 'cs-format': if (isCses) { formatModel(); } break;
    }
  } catch (e) { /* 用户取消等 */ }
}

window.addEventListener('message', function (e) {
  if (!e.data || !e.data.__ceseCommand) return;
  handleCommand(e.data.__ceseCommand);
});

document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    requestSave();
  }
  if (e.key === 'Escape' && quickSelectCtx) {
    closeQuickSelect();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (isCses && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      undo();
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    if (isCses && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      redo();
    }
  }
});

window.addEventListener('beforeunload', function (e) {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ================= 初始化 =================
(function init() {
  var content = window.CSEditor && window.CSEditor.file ? (window.CSEditor.file.content || '') : '';
  restoreViewState();
  loadFromContent(content);
  // 非 CSES 文件已请求平台回退：不再渲染或接管保存
  if (fallbackActive || !isCses) return;
  revalidateSelections();
  runValidation();
  switchView(view);
})();
