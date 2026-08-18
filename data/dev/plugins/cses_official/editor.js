// ============================================================
// CSES 编辑器 - 官方版（移植自旧版 CSESCloud 平台 CsesWebEditor）
// 支持：课程表可视化编辑、科目管理、表格视图、文件预览
// 输出格式：YAML / JSON / ClassIsland / ExamSchedule
// 通过 window.CSEditor 与平台通信
// ============================================================

var currentData = null;          // 归一化后的 CSES 数据
var sourceFormat = 'yaml';       // 载入时的原始格式
var currentScheduleIndex = -1;   // 当前选中的课程表
var currentClassIndex = -1;      // 当前选中的课程
var currentSubjectIndex = -1;    // 当前选中的科目
var currentView = 'schedule';    // 当前视图
var changeMode = 'odd';          // 表格视图周类型
var dirty = false;

// ---------------- 小工具 ----------------
function $(id) { return document.getElementById(id); }

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function setStatus(msg, type, hold) {
  var el = $('csesStatus');
  el.textContent = msg;
  el.className = 'cses-status-msg' + (type ? ' ' + type : '');
  if (type === 'success' && !hold) {
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(function () { el.textContent = '就绪'; el.className = 'cses-status-msg'; }, 3000);
  }
}
function markDirty() {
  dirty = true;
  setStatus('有未保存的更改', 'warn', true);
  updateStats();
}
function nowStr() {
  var d = new Date();
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------------- YAML 引擎（精简实现） ----------------
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

// ---------------- 数据模型 ----------------
var DEFAULT_SUBJECTS = [
  { name: '语文', simplified_name: '语', teacher: '', room: '' },
  { name: '数学', simplified_name: '数', teacher: '', room: '' },
  { name: '英语', simplified_name: '英', teacher: '', room: '' },
  { name: '物理', simplified_name: '物', teacher: '', room: '' },
  { name: '化学', simplified_name: '化', teacher: '', room: '' },
  { name: '生物', simplified_name: '生', teacher: '', room: '' },
  { name: '历史', simplified_name: '历', teacher: '', room: '' },
  { name: '地理', simplified_name: '地', teacher: '', room: '' },
  { name: '政治', simplified_name: '政', teacher: '', room: '' },
  { name: '体育', simplified_name: '体', teacher: '', room: '' },
  { name: '早读', simplified_name: '早', teacher: '', room: '' },
  { name: '晚读', simplified_name: '晚', teacher: '', room: '' },
  { name: '听力', simplified_name: '听', teacher: '', room: '' },
  { name: '美术', simplified_name: '美', teacher: '', room: '' },
  { name: '音乐', simplified_name: '音', teacher: '', room: '' },
  { name: '信息技术', simplified_name: '信', teacher: '', room: '' },
  { name: '通用技术', simplified_name: '通', teacher: '', room: '' },
  { name: '班会', simplified_name: '班', teacher: '', room: '' }
];
var WEEK_MAP = { odd: '单周', even: '双周', all: '通用' };
var DAY_MAP = { 1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四', 5: '星期五', 6: '星期六', 7: '星期日' };

function normalizeData(obj) {
  if (!obj || typeof obj !== 'object') obj = {};
  if (!Array.isArray(obj.subjects)) obj.subjects = [];
  if (!Array.isArray(obj.schedules)) obj.schedules = [];
  if (obj.version == null) obj.version = 1;
  // 保证每个课程表有 classes
  obj.schedules.forEach(function (s) {
    if (!Array.isArray(s.classes)) s.classes = [];
  });
  return obj;
}

// 载入文件内容
function initData() {
  var content = (window.CSEditor && window.CSEditor.file && window.CSEditor.file.content) || '';
  var obj = null;
  var fmt = 'yaml';
  if (content && content.trim()) {
    var trimmed = content.trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try { obj = JSON.parse(content); fmt = 'json'; } catch (e) { obj = null; }
    } else {
      try { obj = parseYaml(content); fmt = 'yaml'; } catch (e) { obj = null; }
    }
    if (obj === null) {
      try { obj = JSON.parse(content); fmt = 'json'; } catch (e2) { obj = null; }
    }
    if (obj === null) {
      setStatus('文件解析失败，已初始化为空档案', 'error');
    }
  }
  // ClassIsland 格式 → CSES（参照旧版 CiToCsesFromat）
  if (obj && isCiFormat(obj)) {
    obj = CiToCsesFromat(obj);
    fmt = 'json';
  }
  currentData = normalizeData(obj);
  if (currentData.subjects.length === 0 && currentData.schedules.length === 0) {
    // 空档案：填充默认科目
    currentData.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
  }
  sourceFormat = fmt;
  // 初始化输出模式
  var out = fmt === 'json' ? 'cj' : 'cy';
  if ($('csesOutputMode')) $('csesOutputMode').value = out;
}

// ---------------- 视图切换 ----------------
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.cses-view-tab').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-view') === view);
  });
  ['schedule', 'subject', 'change', 'source'].forEach(function (v) {
    var el = $('cses-' + v + '-view');
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  var actions = $('csesExplorerActions');
  var titles = { schedule: '课程表', subject: '科目', change: '课程表预览', source: '文件预览' };
  $('csesExplorerTitle').textContent = titles[view];
  if (view === 'schedule') {
    actions.style.display = '';
    actions.innerHTML = '<button class="cses-btn small" onclick="addSchedule()">+ 新建</button>';
    renderScheduleList();
    renderScheduleEditor();
  } else if (view === 'subject') {
    actions.style.display = '';
    actions.innerHTML = '<button class="cses-btn small" onclick="addSubject()">+ 新增</button>';
    renderSubjectList();
    renderSubjectEditor();
  } else if (view === 'change') {
    actions.style.display = 'none';
    renderChangeTable(changeMode);
  } else {
    actions.style.display = 'none';
    renderSource();
  }
}

// ---------------- 课程表编辑器 ----------------
function renderScheduleList() {
  var list = $('csesExplorerList');
  list.innerHTML = '';
  if (!currentData.schedules.length) {
    list.innerHTML = '<div class="cses-empty-hint">暂无课程表，点击右上角「+ 新建」</div>';
    return;
  }
  currentData.schedules.forEach(function (s, idx) {
    var item = document.createElement('div');
    item.className = 'cses-explorer-item' + (idx === currentScheduleIndex ? ' selected' : '');
    var label = scheduleLabel(s, idx);
    item.innerHTML = '<i class="ri-calendar-line"></i><span class="cses-item-label">' + escHtml(label) + '</span>' +
      '<span class="cses-item-sub">' + escHtml(s.classes.length + ' 课时') + '</span>';
    item.onclick = function () { loadSchedule(idx); };
    item.oncontextmenu = function (e) {
      e.preventDefault();
      if (confirm('确定要删除课程表「' + label + '」吗？')) {
        currentData.schedules.splice(idx, 1);
        if (currentScheduleIndex >= currentData.schedules.length) currentScheduleIndex = currentData.schedules.length - 1;
        if (currentScheduleIndex === idx) currentScheduleIndex = -1;
        currentClassIndex = -1;
        markDirty();
        renderScheduleList();
        renderScheduleEditor();
      }
    };
    list.appendChild(item);
  });
}

function scheduleLabel(s, idx) {
  if (s.date) return s.date;
  if (WEEK_MAP[s.weeks] && DAY_MAP[s.enable_day]) return WEEK_MAP[s.weeks] + '_' + DAY_MAP[s.enable_day];
  return '无规则计划 ' + (idx + 1);
}

function loadSchedule(idx) {
  currentScheduleIndex = idx;
  currentClassIndex = -1;
  document.querySelectorAll('.cses-explorer-item').forEach(function (el) { el.classList.remove('selected'); });
  renderScheduleList();
  renderScheduleEditor();
}

function renderScheduleEditor() {
  var s = currentData.schedules[currentScheduleIndex];
  if (!s) {
    $('csesWeekMode').value = 'all';
    $('csesDayMode').value = '1';
    $('csesScheduleDate').value = '';
    $('csesScheduleName').value = '';
    $('csesClassList').innerHTML = '<div class="cses-empty-hint">请先选择或新建课程表</div>';
    $('csesCurrentSubject').innerHTML = '';
    $('csesTimeStart').value = '';
    $('csesTimeEnd').value = '';
    return;
  }
  $('csesWeekMode').value = s.weeks || 'all';
  $('csesDayMode').value = String(s.enable_day || 1);
  $('csesScheduleDate').value = s.date || '';
  $('csesScheduleName').value = s.name || '';
  // es 模式显示日期，其它显示周/天
  var esMode = $('csesOutputMode').value === 'es';
  $('csesDateFieldWrap').style.display = esMode ? '' : 'none';
  $('csesWeekMode').closest('.cses-field').style.display = esMode ? 'none' : '';
  $('csesDayMode').closest('.cses-field').style.display = esMode ? 'none' : '';
  fillSubjectSelect();
  renderClassList();
  loadClassIntoEditor(-1);
}

function fillSubjectSelect() {
  var sel = $('csesCurrentSubject');
  sel.innerHTML = '';
  currentData.subjects.forEach(function (sub) {
    var opt = document.createElement('option');
    opt.value = sub.name;
    opt.textContent = sub.name;
    sel.appendChild(opt);
  });
  if (!currentData.subjects.length) {
    var o = document.createElement('option');
    o.value = '';
    o.textContent = '（请先在科目中添加）';
    sel.appendChild(o);
  }
}

function renderClassList() {
  var list = $('csesClassList');
  var s = currentData.schedules[currentScheduleIndex];
  list.innerHTML = '';
  if (!s) return;
  if (!s.classes.length) {
    list.innerHTML = '<div class="cses-empty-hint">暂无课时，点击「+ 添加课程」</div>';
    return;
  }
  s.classes.forEach(function (cls, idx) {
    var item = document.createElement('div');
    item.className = 'cses-class-item' + (idx === currentClassIndex ? ' selected' : '');
    item.innerHTML = '<span class="cses-class-idx">' + (idx + 1) + '</span>' +
      '<span class="cses-class-subject">' + escHtml(cls.subject || '未命名') + '</span>' +
      '<span class="cses-class-time">' + escHtml(cls.start_time || '--:--') + ' - ' + escHtml(cls.end_time || '--:--') + '</span>';
    item.onclick = function () { loadClassIntoEditor(idx); };
    list.appendChild(item);
  });
}

function loadClassIntoEditor(idx) {
  currentClassIndex = idx;
  var s = currentData.schedules[currentScheduleIndex];
  document.querySelectorAll('.cses-class-item').forEach(function (el, i) {
    el.classList.toggle('selected', i === idx);
  });
  if (!s || idx < 0 || !s.classes[idx]) {
    $('csesCurrentSubject').value = s && s.classes.length ? s.classes[0].subject : '';
    $('csesTimeStart').value = '';
    $('csesTimeEnd').value = '';
    return;
  }
  var cls = s.classes[idx];
  $('csesCurrentSubject').value = cls.subject || '';
  $('csesTimeStart').value = cls.start_time || '';
  $('csesTimeEnd').value = cls.end_time || '';
}

function addClass() {
  var s = currentData.schedules[currentScheduleIndex];
  if (!s) { setStatus('请先选择或新建课程表', 'error'); return; }
  var subject = currentData.subjects.length ? currentData.subjects[0].name : '';
  s.classes.push({ subject: subject, start_time: '', end_time: '' });
  currentClassIndex = s.classes.length - 1;
  markDirty();
  renderClassList();
  loadClassIntoEditor(currentClassIndex);
}

function delClass() {
  var s = currentData.schedules[currentScheduleIndex];
  if (!s || currentClassIndex < 0 || !s.classes[currentClassIndex]) { setStatus('请先选中要删除的课程', 'error'); return; }
  s.classes.splice(currentClassIndex, 1);
  currentClassIndex = -1;
  markDirty();
  renderClassList();
  loadClassIntoEditor(-1);
}

function moveClass(dir) {
  var s = currentData.schedules[currentScheduleIndex];
  if (!s || currentClassIndex < 0) return;
  var target = currentClassIndex + dir;
  if (target < 0 || target >= s.classes.length) return;
  var tmp = s.classes[currentClassIndex];
  s.classes[currentClassIndex] = s.classes[target];
  s.classes[target] = tmp;
  currentClassIndex = target;
  markDirty();
  renderClassList();
  loadClassIntoEditor(currentClassIndex);
}

function onClassField(field, value) {
  var s = currentData.schedules[currentScheduleIndex];
  if (!s || currentClassIndex < 0 || !s.classes[currentClassIndex]) return;
  s.classes[currentClassIndex][field] = value;
  markDirty();
  renderClassList();
}

function onScheduleMetaChange(field, value) {
  var s = currentData.schedules[currentScheduleIndex];
  if (!s) return;
  s[field] = value;
  markDirty();
  renderScheduleList();
  if (field === 'weeks' || field === 'enable_day') renderChangeTable(changeMode);
}

function addSchedule() {
  var esMode = $('csesOutputMode').value === 'es';
  var ns = esMode
    ? { name: '新课程表', date: '', classes: [] }
    : { name: '新课程表', enable_day: 1, weeks: 'all', classes: [] };
  currentData.schedules.push(ns);
  currentScheduleIndex = currentData.schedules.length - 1;
  currentClassIndex = -1;
  markDirty();
  renderScheduleList();
  renderScheduleEditor();
}

function delSchedule() {
  if (currentScheduleIndex < 0) { setStatus('请先选择课程表', 'error'); return; }
  var label = scheduleLabel(currentData.schedules[currentScheduleIndex], currentScheduleIndex);
  if (!confirm('确定要删除课程表「' + label + '」吗？')) return;
  currentData.schedules.splice(currentScheduleIndex, 1);
  currentScheduleIndex = currentData.schedules.length - 1;
  currentClassIndex = -1;
  markDirty();
  renderScheduleList();
  renderScheduleEditor();
}

function cloneSchedule() {
  if (currentScheduleIndex < 0) { setStatus('请先选择课程表', 'error'); return; }
  var copy = JSON.parse(JSON.stringify(currentData.schedules[currentScheduleIndex]));
  copy.name = (copy.name || '课程表') + ' 副本';
  currentData.schedules.push(copy);
  currentScheduleIndex = currentData.schedules.length - 1;
  currentClassIndex = -1;
  markDirty();
  renderScheduleList();
  renderScheduleEditor();
}

// ---------------- 科目编辑器 ----------------
function renderSubjectList() {
  var list = $('csesExplorerList');
  list.innerHTML = '';
  if (!currentData.subjects.length) {
    list.innerHTML = '<div class="cses-empty-hint">暂无科目</div>';
    return;
  }
  currentData.subjects.forEach(function (sub, idx) {
    var item = document.createElement('div');
    item.className = 'cses-explorer-item' + (idx === currentSubjectIndex ? ' selected' : '');
    item.innerHTML = '<i class="ri-bookmark-line"></i><span class="cses-item-label">' + escHtml(sub.name || '未命名') + '</span>' +
      (sub.simplified_name ? '<span class="cses-item-tag">' + escHtml(sub.simplified_name) + '</span>' : '');
    item.onclick = function () { loadSubject(idx); };
    item.oncontextmenu = function (e) {
      e.preventDefault();
      if (confirm('确定要删除科目「' + sub.name + '」吗？')) {
        currentData.subjects.splice(idx, 1);
        if (currentSubjectIndex >= currentData.subjects.length) currentSubjectIndex = -1;
        markDirty();
        renderSubjectList();
        renderSubjectEditor();
      }
    };
    list.appendChild(item);
  });
}

function loadSubject(idx) {
  currentSubjectIndex = idx;
  document.querySelectorAll('.cses-explorer-item').forEach(function (el) { el.classList.remove('selected'); });
  renderSubjectList();
  renderSubjectEditor();
}

function renderSubjectEditor() {
  var sub = currentData.subjects[currentSubjectIndex];
  $('csesSubjectName').value = sub ? (sub.name || '') : '';
  $('csesSubjectSimple').value = sub ? (sub.simplified_name || '') : '';
  $('csesSubjectTeacher').value = sub ? (sub.teacher || '') : '';
  $('csesSubjectRoom').value = sub ? (sub.room || '') : '';
}

function saveSubject() {
  var name = $('csesSubjectName').value.trim();
  if (!name) { setStatus('请填写科目名称', 'error'); return; }
  var simple = $('csesSubjectSimple').value.trim();
  var teacher = $('csesSubjectTeacher').value.trim();
  var room = $('csesSubjectRoom').value.trim();
  var idx = currentData.subjects.findIndex(function (s) { return s.name === name; });
  if (idx !== -1) {
    // 更新现有科目；重命名时同步课程表中的引用
    var oldName = currentData.subjects[idx].name;
    if (oldName !== name) {
      currentData.schedules.forEach(function (sc) {
        sc.classes.forEach(function (c) { if (c.subject === oldName) c.subject = name; });
      });
    }
    currentData.subjects[idx].simplified_name = simple;
    currentData.subjects[idx].teacher = teacher;
    currentData.subjects[idx].room = room;
    currentSubjectIndex = idx;
  } else {
    currentData.subjects.push({ name: name, simplified_name: simple, teacher: teacher, room: room });
    currentSubjectIndex = currentData.subjects.length - 1;
  }
  markDirty();
  renderSubjectList();
  renderSubjectEditor();
  fillSubjectSelect();
  setStatus('科目「' + name + '」已保存', 'success');
}

function addSubject() {
  var name = prompt('请输入科目名称');
  if (!name || !name.trim()) return;
  name = name.trim();
  if (currentData.subjects.some(function (s) { return s.name === name; })) {
    setStatus('科目「' + name + '」已存在', 'error');
    return;
  }
  currentData.subjects.push({ name: name, simplified_name: '', teacher: '', room: '' });
  currentSubjectIndex = currentData.subjects.length - 1;
  markDirty();
  renderSubjectList();
  renderSubjectEditor();
  fillSubjectSelect();
}

function delSubject() {
  if (currentSubjectIndex < 0) { setStatus('请先选中要删除的科目', 'error'); return; }
  var sub = currentData.subjects[currentSubjectIndex];
  if (!confirm('确定要删除科目「' + sub.name + '」吗？')) return;
  currentData.subjects.splice(currentSubjectIndex, 1);
  currentSubjectIndex = -1;
  markDirty();
  renderSubjectList();
  renderSubjectEditor();
  fillSubjectSelect();
}

function fillDefaultSubjects() {
  if (currentData.subjects.length > 0 && !confirm('将使用默认科目列表替换当前科目列表（共 ' + currentData.subjects.length + ' 个），是否继续？')) return;
  currentData.subjects = JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
  currentSubjectIndex = -1;
  markDirty();
  renderSubjectList();
  renderSubjectEditor();
  fillSubjectSelect();
}

// ---------------- 表格视图 ----------------
function renderChangeTable(mode) {
  changeMode = mode || 'odd';
  document.querySelectorAll('.change-mode-btn').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-mode') === changeMode);
  });
  var body = $('csesChangeBody');
  body.innerHTML = '';
  var days = [1, 2, 3, 4, 5, 6, 7];
  var dayClasses = days.map(function (day) {
    var matches = currentData.schedules.filter(function (s) {
      if (s.enable_day !== day) return false;
      if (changeMode === 'odd' && s.weeks === 'odd') return true;
      if (changeMode === 'even' && s.weeks === 'even') return true;
      if (s.weeks === 'all') return true;
      return false;
    });
    var last = matches[matches.length - 1];
    return {
      classes: last ? last.classes.slice().sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); }) : [],
      scheduleIndex: last ? currentData.schedules.indexOf(last) : -1
    };
  });
  var maxRows = Math.max.apply(null, dayClasses.map(function (d) { return d.classes.length; }));
  if (maxRows === 0) {
    body.innerHTML = '<tr><td colspan="8" class="cses-change-empty">当前周类型下暂无课程，请先在课程表中添加</td></tr>';
    return;
  }
  for (var r = 0; r < maxRows; r++) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.textContent = '第 ' + (r + 1) + ' 节';
    tr.appendChild(th);
    dayClasses.forEach(function (dayData, di) {
      var td = document.createElement('td');
      var cls = dayData.classes[r];
      td.textContent = cls ? cls.subject : '';
      if (cls && dayData.scheduleIndex >= 0) {
        td.classList.add('clickable');
        var sIdx = dayData.scheduleIndex;
        var cIdx = currentData.schedules[sIdx].classes.indexOf(cls);
        td.onclick = function (ev) { openCellSubjectPicker(ev, sIdx, cIdx, td); };
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

function openCellSubjectPicker(ev, sIdx, cIdx, td) {
  // 关闭已有
  var old = document.getElementById('csesCellPicker');
  if (old) old.remove();
  var picker = document.createElement('div');
  picker.id = 'csesCellPicker';
  picker.className = 'cses-cell-picker';
  currentData.subjects.forEach(function (sub) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cses-btn small';
    btn.textContent = sub.name;
    btn.onclick = function () {
      currentData.schedules[sIdx].classes[cIdx].subject = sub.name;
      markDirty();
      picker.remove();
      renderChangeTable(changeMode);
      if (currentView === 'schedule') renderClassList();
    };
    picker.appendChild(btn);
  });
  if (!currentData.subjects.length) {
    picker.innerHTML = '<div class="cses-empty-hint">请先在「科目」中添加科目</div>';
  }
  document.body.appendChild(picker);
  var rect = td.getBoundingClientRect();
  var x = rect.left;
  var y = rect.bottom + 4;
  if (x + 200 > window.innerWidth) x = window.innerWidth - 200;
  if (y + picker.offsetHeight > window.innerHeight) y = Math.max(4, rect.top - picker.offsetHeight - 4);
  picker.style.left = Math.max(4, x) + 'px';
  picker.style.top = y + 'px';
  picker.style.display = 'flex';
  // 点击外部关闭
  setTimeout(function () {
    document.addEventListener('click', function handler(ev2) {
      if (!picker.contains(ev2.target)) { picker.remove(); document.removeEventListener('click', handler); }
    });
  }, 0);
}

// ---------------- 文件预览 / 输出 ----------------
function onOutputModeChange() {
  var esMode = $('csesOutputMode').value === 'es';
  var s = currentData.schedules[currentScheduleIndex];
  $('csesDateFieldWrap').style.display = esMode ? '' : 'none';
  $('csesWeekMode').closest('.cses-field').style.display = esMode ? 'none' : '';
  $('csesDayMode').closest('.cses-field').style.display = esMode ? 'none' : '';
  if (currentView === 'source') renderSource();
  else if (currentView === 'change') renderChangeTable(changeMode);
}

function buildOutput() {
  var mode = $('csesOutputMode').value || 'cy';
  var data = currentData;
  if (mode === 'cy') return yamlDump(data);
  if (mode === 'cj') return JSON.stringify(data, null, 2);
  if (mode === 'ci') return JSON.stringify(toCi(data), null, 2);
  if (mode === 'es') return JSON.stringify(toEs(data), null, 2);
  return JSON.stringify(data, null, 2);
}

function renderSource() {
  try {
    $('csesSourceOutput').value = buildOutput();
  } catch (e) {
    $('csesSourceOutput').value = '生成预览失败: ' + e.message;
  }
}

function exportFile() {
  var content = buildOutput();
  var mode = $('csesOutputMode').value;
  var ext = mode === 'cy' ? 'yaml' : 'json';
  var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'cses-config.' + ext;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copySource() {
  var content = $('csesSourceOutput').value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(content).then(function () { setStatus('已复制到剪贴板', 'success'); }, function () { fallbackCopy(content); });
  } else {
    fallbackCopy(content);
  }
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); setStatus('已复制到剪贴板', 'success'); }
  catch (e) { setStatus('复制失败', 'error'); }
  document.body.removeChild(ta);
}

// ---------------- 输出格式转换 ----------------
function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// CSES → ClassIsland
function toCi(target) {
  var extraKey = target.extraKey || {};
  var output = { TimeLayouts: {}, ClassPlans: {}, Subjects: {}, extraKey: extraKey };
  var subjectMap = {};
  (target.subjects || []).forEach(function (sub) {
    var sid = sub.uuid || guid();
    subjectMap[sub.name] = sid;
    output.Subjects[sid] = {
      Name: sub.name || '',
      Initial: sub.simplified_name || '',
      TeacherName: sub.teacher || '',
      IsOutDoor: false
    };
  });
  (target.schedules || []).forEach(function (schedule) {
    var tlId = schedule.time_layout_uuid || guid();
    var cpId = schedule.uuid || guid();
    var timeLayout = { Name: schedule.name || '', Layouts: [] };
    var classPlan = {
      TimeLayoutId: tlId,
      TimeRule: {
        WeekDay: schedule.enable_day == 7 ? 0 : (schedule.enable_day || 1),
        WeekCountDiv: schedule.weeks === 'even' ? 2 : (schedule.weeks === 'odd' ? 1 : 0),
        WeekCountDivTotal: (schedule.weeks === 'even' || schedule.weeks === 'odd') ? 2 : 0,
        IsActive: false
      },
      Classes: [],
      Name: schedule.name || '',
      IsOverlay: false,
      IsEnabled: true
    };
    var lastEnd = '';
    (schedule.classes || []).forEach(function (cls) {
      var subjectId = subjectMap[cls.subject] || guid();
      if (lastEnd) {
        timeLayout.Layouts.push({ StartSecond: lastEnd, EndSecond: '2025-01-01T' + cls.start_time, TimeType: 1, DefaultClassId: subjectId });
      }
      lastEnd = '2025-01-01T' + cls.end_time;
      timeLayout.Layouts.push({ StartSecond: '2025-01-01T' + cls.start_time, EndSecond: lastEnd, TimeType: 0, DefaultClassId: subjectId });
      classPlan.Classes.push({ SubjectId: subjectId });
    });
    output.TimeLayouts[tlId] = timeLayout;
    output.ClassPlans[cpId] = classPlan;
  });
  return output;
}

// CSES → ExamSchedule
function toEs(target) {
  var examInfos = [];
  (target.schedules || []).forEach(function (element) {
    var day = element.date || new Date().toISOString().slice(0, 10);
    (element.classes || []).forEach(function (c) {
      examInfos.push({ name: c.subject, start: day + 'T' + c.start_time, end: day + 'T' + c.end_time });
    });
  });
  var timetableInfo = (target.schedules || []).map(function (s) {
    return { scheduleName: s.name, timetableName: s.timetable_name || null };
  });
  return {
    subjects: target.subjects || [],
    schedules: target.schedules || [],
    examInfos: examInfos,
    examName: target.examName,
    message: target.message,
    room: target.room,
    timetableInfo: timetableInfo
  };
}

// ---------------- 校验 ----------------
function validateData() {
  var errors = [], warnings = [];
  if (!currentData.subjects.length) warnings.push('尚未添加任何科目');
  // 科目重名
  var seen = {};
  currentData.subjects.forEach(function (s) {
    if (s.name && seen[s.name]) errors.push('存在重复科目：' + s.name);
    seen[s.name] = true;
  });
  if (!currentData.schedules.length) warnings.push('尚未添加任何课程表');
  var keySet = {};
  currentData.schedules.forEach(function (s, si) {
    if (!s.name) errors.push('第 ' + (si + 1) + ' 个课程表缺少名称');
    var key = s.enable_day + '-' + s.weeks;
    if (keySet[key]) warnings.push('多个课程表使用相同的星期/周类型组合');
    keySet[key] = true;
    s.classes.forEach(function (c, ci) {
      if (!c.subject) errors.push('课程表「' + (s.name || si + 1) + '」第 ' + (ci + 1) + ' 节课缺少科目');
      if (c.start_time && c.end_time && c.end_time <= c.start_time) {
        errors.push('课程表「' + (s.name || si + 1) + '」第 ' + (ci + 1) + ' 节课结束时间早于开始时间');
      }
    });
  });
  return { errors: errors, warnings: warnings };
}

// ---------------- ClassIsland 格式检测与转换 ----------------
function isCiFormat(obj) {
  try {
    if (typeof obj !== 'object' || obj === null) return false;
    if (typeof obj.TimeLayouts !== 'object' || obj.TimeLayouts === null) return false;
    for (var tlId in obj.TimeLayouts) {
      var tl = obj.TimeLayouts[tlId];
      if (typeof tl !== 'object' || tl === null) return false;
      if (typeof tl.Name !== 'string') return false;
      if (!Array.isArray(tl.Layouts)) return false;
      for (var i = 0; i < tl.Layouts.length; i++) {
        var layout = tl.Layouts[i];
        if (typeof layout !== 'object' || layout === null) return false;
        if (typeof layout.StartSecond !== 'string') return false;
        if (typeof layout.EndSecond !== 'string') return false;
        if (typeof layout.TimeType !== 'number') return false;
      }
    }
    if (typeof obj.ClassPlans !== 'object' || obj.ClassPlans === null) return false;
    for (var cpId in obj.ClassPlans) {
      var cp = obj.ClassPlans[cpId];
      if (typeof cp !== 'object' || cp === null) return false;
      if (typeof cp.TimeLayoutId !== 'string') return false;
      if (typeof cp.TimeRule !== 'object' || cp.TimeRule === null) return false;
      if (typeof cp.TimeRule.WeekCountDiv !== 'number') return false;
      if (!Array.isArray(cp.Classes)) return false;
    }
    if (typeof obj.Subjects !== 'object' || obj.Subjects === null) return false;
    for (var sId in obj.Subjects) {
      var subject = obj.Subjects[sId];
      if (typeof subject !== 'object' || subject === null) return false;
      if (typeof subject.Name !== 'string') return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ClassIsland 格式 → CSES（参照旧版 CiToCsesFromat）
function CiToCsesFromat(target) {
  var extraKey = target.extraKey || {};
  var output = { subjects: [], schedules: [], extraKey: extraKey };
  var subjectMap = {};
  for (var subjectId in target.Subjects) {
    var subject = target.Subjects[subjectId];
    subjectMap[subjectId] = subject.Name;
    output.subjects.push({ uuid: subjectId, name: subject.Name, simplified_name: subject.Initial, teacher: subject.TeacherName });
  }
  for (var classPlanId in target.ClassPlans) {
    var classPlan = target.ClassPlans[classPlanId];
    var timeLayout = target.TimeLayouts[classPlan.TimeLayoutId] || { Name: '', Layouts: [] };
    var schedule = {
      uuid: classPlanId,
      time_layout_uuid: classPlan.TimeLayoutId,
      name: timeLayout.Name,
      enable_day: classPlan.TimeRule.WeekDay == 0 ? 7 : classPlan.TimeRule.WeekDay,
      weeks: classPlan.TimeRule.WeekCountDiv === 2 ? 'even' : (classPlan.TimeRule.WeekCountDiv === 1 ? 'odd' : 'all'),
      classes: []
    };
    (timeLayout.Layouts || []).forEach(function (layout) {
      var subjectName = subjectMap[layout.DefaultClassId];
      if (subjectName && layout.TimeType === 0) {
        schedule.classes.push({
          subject: subjectName,
          start_time: String(layout.StartSecond).split('T')[1] || '',
          end_time: String(layout.EndSecond).split('T')[1] || ''
        });
      }
    });
    output.schedules.push(schedule);
  }
  return output;
}

// ---------------- 保存 ----------------
function saveConfig() {
  var result = validateData();
  if (result.errors.length) {
    var msg = result.errors.slice(0, 5).join('\n');
    if (!confirm('存在 ' + result.errors.length + ' 个验证错误，仍要保存吗？\n\n' + msg)) {
      setStatus('已取消保存', 'error');
      return;
    }
  }
  var content = buildOutput();
  if (window.CSEditor) {
    if (window.CSEditor.emitSave) window.CSEditor.emitSave(content);
    else if (window.CSEditor.saveContent) window.CSEditor.saveContent(content);
  }
  dirty = false;
  setStatus('已保存（' + nowStr() + '）', 'success');
  updateStats();
}

// ---------------- 统计 / 状态栏 ----------------
function updateStats() {
  if (!currentData) return;
  var sCount = currentData.subjects.length;
  var schCount = currentData.schedules.length;
  var clsCount = 0;
  currentData.schedules.forEach(function (s) { clsCount += s.classes.length; });
  var mode = $('csesOutputMode') ? $('csesOutputMode').value : 'cy';
  var modeName = { cy: 'YAML', cj: 'JSON', ci: 'ClassIsland', es: 'ExamSchedule' }[mode] || 'YAML';
  $('csesStats').textContent = '科目 ' + sCount + ' | 课程表 ' + schCount + ' | 课时 ' + clsCount + ' | 输出 ' + modeName + (dirty ? ' | 未保存' : '');
}

// ---------------- 初始化 ----------------
(function init() {
  initData();
  switchView('schedule');
  updateStats();
  setStatus('CSES 编辑器就绪（Ctrl+S 保存）', '');
  // 快捷键
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveConfig();
    }
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (currentView === 'schedule') { loadSchedule(currentScheduleIndex); }
    }
  });
})();
