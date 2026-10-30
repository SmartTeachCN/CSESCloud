/**
 * ClassIsland 档案编辑器（.json 通用注册 + 关键格式识别）
 *
 * - 文件为 ClassIsland 档案（TimeLayouts / ClassPlans / Subjects 关键结构）时进入结构化编辑；
 *   否则调用 CSEditor.fallback() 交给平台默认编辑器（不再内置通用 JSON / 源码视图）。
 * - 编辑体验对齐 ClassIsland 2 档案设置窗口：
 *   · 科目：左表格 + 右详情，支持 ClassIsland 默认预设科目（与客户端同 GUID）；
 *   · 课表：列表 / 周视图 / 月视图（月视图支持预定课表 OrderedSchedules）、临时层、课程快速选择面板、
 *           设置区可收起（收起状态存于浏览器，每个列表视图独立配置）；
 *   · 时间表：列表 / 可视化视图。
 * - 保存通过平台 Ribbon「保存」按钮（save 命令 / Ctrl+S），不设独立保存按钮；
 *   撤销/重做对接平台 Ribbon 的 undo/redo 命令。
 * - 视图与选择状态随文件持久化，刷新后回到刷新前页面。
 * - 兼容 1.x（StartSecond）与 2.x（StartTime）时间格式，保存时两种表示都写齐，未知字段原样保留。
 */
var profile = null;            // 档案对象（保存时原样序列化，未知字段不丢）
var isProfile = false;         // 是否识别为 ClassIsland 档案
var profileFmt = '2x';         // 时间字段主格式：2x=StartTime / 1x=StartSecond
var view = 'classplans';
var classPlanSubView = 'list';     // 课表：list / week / month
var timeLayoutSubView = 'list';    // 时间表：list / visual
var monthCursor = null;            // 月视图当前月份 {y, m}（m: 0-11）
var selectedTimeLayoutId = null;
var selectedClassPlanId = null;
var selectedItemIdx = -1;          // 时间表当前选中时间点
var selectedSubjectId = null;      // 科目当前选中
var uiState = { collapse: { classplans: false, timelayouts: false }, durClass: 40, durBreak: 10 }; // 收起状态与时间点时长（每个列表视图/时长独立配置）
var quickSelectCtx = null;         // 快速选择面板上下文 {type:'subject',planId,idx} / {type:'plan',dateKey}
var quickDockTarget = null;        // 常驻快速选择菜单的当前目标 {type:'lesson'|'week', planId, idx}
var dirty = false;
var validationErrors = [];
var validationWarnings = [];

// ================= 平台回退（非 ClassIsland 档案） =================
// 文件未识别为 ClassIsland 档案时，不再由插件内部提供通用 JSON 编辑器，
// 而是请求平台回退：EditorPane 收到 __csesPluginFallback 后停用本插件并改用默认编辑器。
var fallbackActive = false;     // 已请求回退：停止渲染与保存
var fallbackRequested = false;  // 避免重复请求
function requestPlatformFallback(reason) {
  fallbackActive = true;
  if (fallbackRequested) return;
  fallbackRequested = true;
  var msg = reason || '未识别为 ClassIsland 档案';
  try {
    if (window.CSEditor && typeof window.CSEditor.fallback === 'function') {
      window.CSEditor.fallback(msg);
    } else if (window.parent && window.parent !== window) {
      // 兼容尚未注入 fallback SDK 的宿主
      window.parent.postMessage({ __csesPluginFallback: true, reason: msg }, '*');
    }
  } catch (e) { /* ignore */ }
}

var DEFAULT_GROUP_GUID = 'acaf4ef0-e261-4262-b941-34ea93cb4369';
var EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
var TIME_ANCHOR = '2000-01-01';
var TIME_TYPES = { 0: '上课', 1: '课间', 2: '分割', 3: '行动' };
// ClassIsland 2 的默认时间点时长（分钟）：上课 40 / 课间 10 / 分割与行动 0
var DEFAULT_DURATION_MIN = { 0: 40, 1: 10, 2: 0, 3: 0 };
var WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 周视图列顺序：周一…周日
var WEEKDAY_NAMES = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };

// ClassIsland 客户端默认科目（与 Assets/default-subjects.json 同 GUID，保证档案在客户端识别一致）
var PRESET_SUBJECTS = [
  { id: '97d0bf3f-137f-4f8a-87d6-ff387063bbd3', name: '语文', initial: '语' },
  { id: '1154d452-5ede-4194-b4dd-cb40c956c8ed', name: '数学', initial: '数' },
  { id: '3bbed0c0-bcf3-4dfe-a78d-5da9b02cf8bd', name: '英语', initial: '英' },
  { id: '44ec22d3-3dde-40e6-8eb7-a1f4cd378a04', name: '历史', initial: '历' },
  { id: '9f0d71b7-b4da-4040-a3d5-64da7573c6dd', name: '政治', initial: '政' },
  { id: 'a4a76e77-29d8-4103-882c-2f4c9d1e8077', name: '物理', initial: '物' },
  { id: 'd18e9906-0210-4f00-9dd6-b919f0dd8287', name: '化学', initial: '化' },
  { id: 'a41cc849-b4bc-4dfd-a464-7f4fa3e317ca', name: '生物', initial: '生' },
  { id: '7b7aea95-30ad-4490-8d98-0c9179c47a10', name: '地理', initial: '地' },
  { id: '66d1c380-d292-46e1-86d5-d403e2a4f200', name: '信息技术', initial: '信', outdoor: true },
  { id: '0ed2307b-4d9b-48fa-97ed-94bd2213c84e', name: '体育', initial: '体', outdoor: true },
  { id: '923f4a8b-51eb-468b-971d-bb02e7db0163', name: '自习', initial: '自' },
  { id: '0d412099-dac6-4616-b6a7-c4fb76b12063', name: '通用技术', initial: '技' },
  { id: '91a88ebb-8ecb-493e-b09c-e35718f01dce', name: '音乐', initial: '音' },
  { id: '742b00dc-901b-496f-ae33-6714a13fa465', name: '美术', initial: '美' },
  { id: '353c420e-c256-4e28-9f9c-283333ba6e62', name: '选修课', initial: '选' },
  { id: 'cc826063-bdb7-492b-baf3-3c6877e8c4bf', name: '社团', initial: '社' },
  { id: '31380edc-400d-46c2-b993-a5c4a43db126', name: '心理', initial: '心' },
  { id: '9875b24c-470d-4195-8a6a-73925ea4808b', name: '早读', initial: '早' },
  { id: 'cf251cd8-2aab-4aa1-8211-50f4e6919a3d', name: '班会', initial: '班' },
  { id: '95dd61cd-5d2e-4f23-80e8-99be8aa97028', name: '周测', initial: '测' },
];

// ================= 工具 =================
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function $(id) { return document.getElementById(id); }

function guid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function subjectName(id) {
  var s = profile && profile.Subjects ? profile.Subjects[id] : null;
  return s ? (s.Name || id) : null;
}
function subjectInitial(id) {
  var s = profile && profile.Subjects ? profile.Subjects[id] : null;
  if (!s) return '';
  return s.Initial || s.Name || '';
}

// ================= 关键格式识别 =================
/**
 * 识别 ClassIsland 档案：
 * 必须同时存在 TimeLayouts / ClassPlans / Subjects 三个对象（字典，可为空），
 * 时间点/课表/科目条目按 2.x（StartTime）或 1.x（StartSecond）字段形态校验。
 */
function detectClassIslandProfile(obj) {
  if (!isPlainObject(obj)) return { ok: false, reason: '不是 JSON 对象' };
  if (!isPlainObject(obj.TimeLayouts)) return { ok: false, reason: '缺少 TimeLayouts 时间表集合' };
  if (!isPlainObject(obj.ClassPlans)) return { ok: false, reason: '缺少 ClassPlans 课表集合' };
  if (!isPlainObject(obj.Subjects)) return { ok: false, reason: '缺少 Subjects 科目集合' };

  var fmt = null, sawLayout = false;
  for (var tlId in obj.TimeLayouts) {
    var tl = obj.TimeLayouts[tlId];
    if (!isPlainObject(tl)) return { ok: false, reason: 'TimeLayouts 存在非法条目' };
    if (!Array.isArray(tl.Layouts)) return { ok: false, reason: '时间表缺少 Layouts 数组' };
    sawLayout = true;
    for (var i = 0; i < tl.Layouts.length; i++) {
      var it = tl.Layouts[i];
      if (!isPlainObject(it)) return { ok: false, reason: '时间点条目非法' };
      if (typeof it.StartTime === 'string' && typeof it.EndTime === 'string') fmt = fmt || '2x';
      else if (typeof it.StartSecond === 'string' && typeof it.EndSecond === 'string') fmt = fmt || '1x';
      else if (typeof it.TimeType !== 'number') return { ok: false, reason: '时间点缺少时间字段（StartTime/StartSecond）' };
    }
  }
  var sawPlan = false;
  for (var cpId in obj.ClassPlans) {
    var cp = obj.ClassPlans[cpId];
    if (!isPlainObject(cp)) return { ok: false, reason: 'ClassPlans 存在非法条目' };
    sawPlan = true;
    if (isPlainObject(cp.TimeRule) && typeof cp.TimeRule.WeekDay === 'number') fmt = fmt || '2x';
  }
  var sawSubject = false;
  for (var sId in obj.Subjects) {
    var sub = obj.Subjects[sId];
    if (!isPlainObject(sub) || typeof sub.Name !== 'string') return { ok: false, reason: 'Subjects 存在非法条目' };
    sawSubject = true;
  }
  if (!sawLayout && !sawPlan && !sawSubject && !isPlainObject(obj.ClassPlanGroups)) {
    return { ok: false, reason: '档案内容为空且缺少 ClassPlanGroups 标记' };
  }
  return { ok: true, fmt: fmt || '2x' };
}

/** 确保档案结构完整（容器缺失补齐，课表群缺省补默认群） */
function normalizeProfile(obj) {
  if (!isPlainObject(obj)) obj = {};
  if (typeof obj.Name !== 'string') obj.Name = '';
  if (!isPlainObject(obj.TimeLayouts)) obj.TimeLayouts = {};
  if (!isPlainObject(obj.ClassPlans)) obj.ClassPlans = {};
  if (!isPlainObject(obj.Subjects)) obj.Subjects = {};
  if (!isPlainObject(obj.ClassPlanGroups)) obj.ClassPlanGroups = {};
  if (!(DEFAULT_GROUP_GUID in obj.ClassPlanGroups)) {
    obj.ClassPlanGroups[DEFAULT_GROUP_GUID] = { Name: '默认课表群', IsGlobal: false };
  }
  if (typeof obj.SelectedClassPlanGroupId !== 'string' || !(obj.SelectedClassPlanGroupId in obj.ClassPlanGroups)) {
    obj.SelectedClassPlanGroupId = DEFAULT_GROUP_GUID;
  }
  if (typeof obj.Id !== 'string' || obj.Id.length < 32) obj.Id = guid();
  return obj;
}

// ================= 时间字段（1.x / 2.x 双写） =================
/** 提取时间点的 HH:MM(:SS)，兼容 TimeSpan（"08:00:00"/"1.02:03:04"）与 datetime（"2000-01-01T08:00:00"） */
function parseTimeField(v) {
  var s = String(v == null ? '' : v).trim();
  if (s === '') return '';
  var t = s;
  if (s.indexOf('T') >= 0) t = s.split('T')[1];
  else if (/^\d+(\.\d+)?\:/.test(s)) t = s.split('.')[1] || s.split('.')[0]; // "1.02:03:04"
  if (/^\d{2}:\d{2}$/.test(t)) t += ':00';
  return t;
}
function timeAnchorOf(item) {
  var s = String(item.StartSecond || item.EndSecond || '');
  if (s.indexOf('T') > 0) return s.split('T')[0];
  return TIME_ANCHOR;
}
/** 读取时间点的起止时间（HH:MM:SS） */
function itemTimes(item) {
  if (typeof item.StartTime === 'string' && item.StartTime !== '') {
    return { start: parseTimeField(item.StartTime), end: parseTimeField(item.EndTime), anchor: timeAnchorOf(item) };
  }
  return { start: parseTimeField(item.StartSecond), end: parseTimeField(item.EndSecond), anchor: timeAnchorOf(item) };
}
/** 写回时间点（按档案主格式写一份 + 兼容格式补写一份） */
function setItemTimes(item, start, end) {
  var anchor = timeAnchorOf(item);
  var s = (start || '00:00:00'); if (/^\d{2}:\d{2}$/.test(s)) s += ':00';
  var e = (end || s); if (/^\d{2}:\d{2}$/.test(e)) e += ':00';
  item.StartTime = s;
  item.EndTime = e;
  item.StartSecond = anchor + 'T' + s;
  item.EndSecond = anchor + 'T' + e;
  if (item.TimeType === 2 || item.TimeType === 3) {
    // 分割线/行动：结束时间与开始时间一致
    item.EndTime = s;
    item.EndSecond = anchor + 'T' + s;
  }
}

// ================= 撤销 / 重做（对接平台 Ribbon undo/redo 命令） =================
var undoStack = [];
var redoStack = [];
var lastSnapshot = null;
var undoTimer = null;

function snapshot() { return profile ? JSON.stringify(profile) : ''; }

function commitUndo() {
  if (!isProfile || !profile) return;
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
  if (!isProfile || undoStack.length === 0) return;
  redoStack.push(snapshot());
  profile = JSON.parse(undoStack.pop());
  lastSnapshot = snapshot();
  revalidateSelections();
  dirty = true;
  renderAll(); runValidation();
}

function redo() {
  if (!isProfile || redoStack.length === 0) return;
  undoStack.push(snapshot());
  profile = JSON.parse(redoStack.pop());
  lastSnapshot = snapshot();
  revalidateSelections();
  dirty = true;
  renderAll(); runValidation();
}

function revalidateSelections() {
  if (!profile) return;
  if (!selectedTimeLayoutId || !(selectedTimeLayoutId in profile.TimeLayouts)) {
    var tlIds = Object.keys(profile.TimeLayouts);
    selectedTimeLayoutId = tlIds.length ? tlIds[0] : null;
  } else {
    var items = profile.TimeLayouts[selectedTimeLayoutId].Layouts || [];
    if (selectedItemIdx >= items.length) selectedItemIdx = items.length - 1;
  }
  if (!selectedClassPlanId || !(selectedClassPlanId in profile.ClassPlans)) {
    var cpIds = Object.keys(profile.ClassPlans);
    selectedClassPlanId = cpIds.length ? cpIds[0] : null;
  }
  if (selectedSubjectId && !(selectedSubjectId in profile.Subjects)) {
    var sIds = Object.keys(profile.Subjects);
    selectedSubjectId = sIds.length ? sIds[0] : null;
  }
}

// ================= 视图状态持久化（刷新后回到刷新前页面） =================
function stateStorageKey() {
  var name = (window.CSEditor && window.CSEditor.file && window.CSEditor.file.name) || '';
  return 'ciProfileEditorState:' + name;
}
function persistViewState() {
  try {
    localStorage.setItem(stateStorageKey(), JSON.stringify({
      view: view,
      classPlanSubView: classPlanSubView,
      timeLayoutSubView: timeLayoutSubView,
      selectedTimeLayoutId: selectedTimeLayoutId,
      selectedClassPlanId: selectedClassPlanId,
      selectedSubjectId: selectedSubjectId,
    selectedItemIdx: selectedItemIdx,
    collapse: uiState.collapse,   // 收起/展开状态（每个列表视图一个配置）
    durClass: uiState.durClass,   // 时间点时长：上课（分钟）
    durBreak: uiState.durBreak,   // 时间点时长：课间（分钟）
    autoNextLesson: !!uiState.autoNextLesson,
  }));
  } catch (e) { /* ignore */ }
}
function restoreViewState() {
  try {
    var raw = localStorage.getItem(stateStorageKey());
    if (!raw) return;
    var st = JSON.parse(raw);
    if (!st || typeof st !== 'object') return;
    if (['classplans', 'timelayouts', 'subjects'].indexOf(st.view) >= 0) view = st.view;
    if (['list', 'week', 'month'].indexOf(st.classPlanSubView) >= 0) classPlanSubView = st.classPlanSubView;
    if (['list', 'visual'].indexOf(st.timeLayoutSubView) >= 0) timeLayoutSubView = st.timeLayoutSubView;
    if (st.selectedTimeLayoutId) selectedTimeLayoutId = st.selectedTimeLayoutId;
    if (st.selectedClassPlanId) selectedClassPlanId = st.selectedClassPlanId;
    if (st.selectedSubjectId) selectedSubjectId = st.selectedSubjectId;
    if (typeof st.selectedItemIdx === 'number') selectedItemIdx = st.selectedItemIdx;
    if (st.collapse && typeof st.collapse === 'object') {
      uiState.collapse = {
        classplans: !!st.collapse.classplans,
        timelayouts: !!st.collapse.timelayouts,
      };
    }
    uiState.autoNextLesson = !!st.autoNextLesson;
    if (typeof st.durClass === 'number' && st.durClass > 0) uiState.durClass = st.durClass;
    if (typeof st.durBreak === 'number' && st.durBreak >= 0) uiState.durBreak = st.durBreak;
  } catch (e) { /* ignore */ }
}

// ================= 载入 / 保存 =================
function loadFromContent(content) {
  var parsed = null;
  try { parsed = JSON.parse(content); }
  catch (e) {
    isProfile = false;
    profile = null;
    requestPlatformFallback('JSON 解析失败：' + e.message);
    return false;
  }
  var det = detectClassIslandProfile(parsed);
  if (det.ok) {
    isProfile = true;
    profileFmt = det.fmt || '2x';
    profile = normalizeProfile(parsed);
    enterProfileMode();
    return true;
  }
  // 非 ClassIsland 档案：交给平台默认编辑器，插件停止渲染与保存
  isProfile = false;
  profile = null;
  requestPlatformFallback(det.reason);
  return false;
}

/** 保存统一输出格式化 JSON（仅 Profile 模式；回退后本插件不再保存） */
function buildOutput() {
  if (!isProfile || !profile) return '';
  return JSON.stringify(profile, null, 4);
}

function saveConfig() {
  if (fallbackActive || !isProfile) return;
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

// ================= 模式切换 =================
/** 格式化：按档案规范归一化当前 profile 并重绘（保存时统一输出格式化 JSON，无源码视图） */
function formatProfile() {
  if (!isProfile || !profile) return;
  commitUndo();
  profile = normalizeProfile(profile);
  dirty = true;
  revalidateSelections();
  renderAll();
  runValidation();
  commitUndo();
  updateStats('已格式化');
}

function enterProfileMode() {
  var badge = $('ciFormatBadge');
  badge.className = 'ci-badge ci-is-profile';
  $('ciFormatText').textContent = 'ClassIsland 档案（' + (profileFmt === '1x' ? '1.x 时间格式' : '2.x 时间格式') + '）';
  $('ciViewTabs').style.display = '';
  var tabs = document.querySelectorAll('#ciViewTabs .ci-view-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('disabled');
  revalidateSelections();
  lastSnapshot = snapshot();
  switchView(view);
  renderAll();
  runValidation();
}

function redetect() {
  var text = (window.CSEditor && window.CSEditor.file ? (window.CSEditor.file.content || '') : '');
  $('ciProfileName').disabled = false;
  var prevView = view;
  if (!loadFromContent(text)) return;
  if (view !== prevView) switchView(prevView);
}

function updateStats(extra) {
  var s = '';
  if (isProfile && profile) {
    var subjects = Object.keys(profile.Subjects).length;
    var layouts = Object.keys(profile.TimeLayouts).length;
    var plans = Object.keys(profile.ClassPlans).length;
    var groups = Object.keys(profile.ClassPlanGroups).length;
    s = '科目 ' + subjects + ' · 时间表 ' + layouts + ' · 课表 ' + plans + ' · 课表群 ' + groups + (dirty ? ' · 未保存' : '');
  }
  if (extra) s += (s ? ' · ' : '') + extra;
  $('ciStats').textContent = s;
}

function switchView(v) {
  var map = { classplans: 'ciViewClassPlans', timelayouts: 'ciViewTimeLayouts', subjects: 'ciViewSubjects' };
  if (!map[v]) v = 'classplans';
  view = v;
  for (var key in map) { $(map[key]).style.display = key === v ? '' : 'none'; }
  var tabs = document.querySelectorAll('#ciViewTabs .ci-view-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === v);
  // 应用子视图（列表/周视图/月视图、列表/可视化）的持久化状态
  if (v === 'classplans') applyClassPlanSubView();
  if (v === 'timelayouts') applyTimeLayoutSubView();
  persistViewState();
  renderAll();
}

function switchClassPlanSubView(sub) {
  classPlanSubView = sub;
  if (sub === 'month') quickDockTarget = null; // 月视图无课程位置选择
  persistViewState();
  applyClassPlanSubView();
  renderAll();
}

function applyClassPlanSubView() {
  var tabs = document.querySelectorAll('#ciCpSubTabs .ci-subtab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-sub') === classPlanSubView);
  $('ciCpListWrap').style.display = classPlanSubView === 'list' ? '' : 'none';
  $('ciCpWeekWrap').style.display = classPlanSubView === 'week' ? '' : 'none';
  $('ciCpMonthWrap').style.display = classPlanSubView === 'month' ? '' : 'none';
}

function switchTimeLayoutSubView(sub) {
  timeLayoutSubView = sub;
  persistViewState();
  applyTimeLayoutSubView();
  renderAll();
}

function applyTimeLayoutSubView() {
  var tabs = document.querySelectorAll('#ciTlSubTabs .ci-subtab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-sub') === timeLayoutSubView);
  $('ciTlListWrap').style.display = timeLayoutSubView === 'list' ? '' : 'none';
  $('ciTlVisualWrap').style.display = timeLayoutSubView === 'visual' ? '' : 'none';
}

/** 收起/展开设置区（状态存于浏览器，每个列表视图一个配置） */
function toggleCollapse(key) {
  uiState.collapse[key] = !uiState.collapse[key];
  persistViewState();
  renderAll();
}

function renderAll() {
  if (!isProfile || !profile) return;
  var nameInput = $('ciProfileName');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = profile.Name || '';
  renderSubjects();
  renderSubjectDetail();
  renderTimeLayoutList();
  renderTimeLayoutDetail();
  renderTimeLayoutVisual();
  renderClassPlanList();
  renderClassPlanDetail();
  renderWeekView();
  renderMonthView();
  updateQuickDock();
  renderActivePlanBar();
  updateStats();
}

// ================= 科目（左表格 + 右详情，预设科目） =================
function renderSubjects() {
  var body = $('ciSubjectsBody');
  var keys = Object.keys(profile.Subjects);
  $('ciSubjectsEmpty').style.display = keys.length === 0 ? '' : 'none';
  var html = '';
  keys.forEach(function (id) {
    var sub = profile.Subjects[id] || {};
    html += '<tr class="ci-subject-row' + (id === selectedSubjectId ? ' selected' : '') + '" data-subject-id="' + escAttr(id) + '" onclick="selectSubject(\'' + id + '\')">' +
      '<td><input class="ci-cell-input" value="' + escAttr(sub.Name || '') + '" placeholder="如：数学" onclick="event.stopPropagation();selectSubject(\'' + id + '\')" oninput="onSubjectChange(\'' + id + '\',\'Name\',this.value)" /></td>' +
      '<td><input class="ci-cell-input" value="' + escAttr(sub.Initial || '') + '" placeholder="如：数" onclick="event.stopPropagation()" oninput="onSubjectChange(\'' + id + '\',\'Initial\',this.value)" /></td>' +
      '<td><input class="ci-cell-input" value="' + escAttr(sub.TeacherName || '') + '" placeholder="教师姓名" onclick="event.stopPropagation()" oninput="onSubjectChange(\'' + id + '\',\'TeacherName\',this.value)" /></td>' +
      '</tr>';
  });
  body.innerHTML = html;
}

function selectSubject(id) {
  // 只切换高亮与详情，不重建科目表格——避免点击单元格输入框时 DOM 被替换导致无法输入
  selectedSubjectId = id;
  persistViewState();
  var rows = document.querySelectorAll('#ciSubjectsBody .ci-subject-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('selected', rows[i].getAttribute('data-subject-id') === id);
  }
  renderSubjectDetail();
}

function renderSubjectDetail() {
  var box = $('ciSubjectDetail');
  if (!isProfile) { box.innerHTML = ''; return; }
  var sub = selectedSubjectId ? profile.Subjects[selectedSubjectId] : null;
  if (!sub) { box.innerHTML = '<div class="ci-empty">选择左侧科目以编辑详情</div>'; return; }
  var html = '<h3 class="ci-detail-title">科目详情</h3>' +
    '<div class="ci-form-grid">' +
    '<div class="ci-field"><label>科目名称（Name）</label><input value="' + escAttr(sub.Name || '') + '" oninput="onSubjectChange(\'' + selectedSubjectId + '\',\'Name\',this.value)" /></div>' +
    '<div class="ci-field"><label>简称（Initial，时间线上显示）</label><input value="' + escAttr(sub.Initial || '') + '" oninput="onSubjectChange(\'' + selectedSubjectId + '\',\'Initial\',this.value)" /></div>' +
    '<div class="ci-field"><label>教师姓名（TeacherName）</label><input value="' + escAttr(sub.TeacherName || '') + '" oninput="onSubjectChange(\'' + selectedSubjectId + '\',\'TeacherName\',this.value)" /></div>' +
    '<div class="ci-field"><label>户外课程（IsOutDoor）</label><label style="display:inline-flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" ' + (sub.IsOutDoor ? 'checked' : '') + ' onchange="onSubjectChange(\'' + selectedSubjectId + '\',\'IsOutDoor\',this.checked)" />在时间线上带户外标识</label></div>' +
    '<div class="ci-field" style="grid-column:1/-1"><label>GUID</label><input class="ci-guid" value="' + escAttr(selectedSubjectId) + '" readonly /></div>' +
    '</div>' +
    '<div id="ciPresetWrap"></div>';
  box.innerHTML = html;
  renderPresetPanel();
}

function onSubjectChange(id, field, value) {
  if (!profile || !profile.Subjects[id]) return;
  profile.Subjects[id][field] = value;
  dirty = true;
  queueUndo();
  updateStats();
  // 名称/简称变化时刷新引用它的视图
  if (field === 'Name' || field === 'Initial') {
    renderTimeLayoutDetail(); renderClassPlanDetail(); renderWeekView(); renderTimeLayoutVisual();
  }
}

function addSubject() {
  ensureProfileMode();
  var id = guid();
  profile.Subjects[id] = { Name: '新科目', Initial: '', TeacherName: '', IsOutDoor: false, AttachedObjects: {} };
  selectedSubjectId = id;
  dirty = true;
  commitUndo();
  switchView('subjects');
  renderAll(); runValidation();
}

function duplicateSubject(id) {
  var target = id || selectedSubjectId;
  if (!profile || !target || !profile.Subjects[target]) { alert('请先选择一个科目'); return; }
  var src = profile.Subjects[target];
  var copy = JSON.parse(JSON.stringify(src));
  copy.Name = (src.Name || '科目') + ' 副本';
  var newId = guid();
  profile.Subjects[newId] = copy;
  selectedSubjectId = newId;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

function removeSelectedSubject(id) {
  var target = id || selectedSubjectId;
  if (!profile || !target || !profile.Subjects[target]) { alert('请先选择一个科目'); return; }
  removeSubject(target);
}

function removeSubject(id) {
  if (!profile || !profile.Subjects[id]) return;
  var name = profile.Subjects[id].Name || id;
  if (!confirm('确认删除科目「' + name + '」？时间表与课表中对该科目的引用将失效。')) return;
  delete profile.Subjects[id];
  if (selectedSubjectId === id) selectedSubjectId = null;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

/** 预设科目面板（ClassIsland 默认科目，同 GUID） */
var presetOpen = false;
function showPresetPanel() {
  presetOpen = !presetOpen;
  renderPresetPanel();
}
function renderPresetPanel() {
  var wrap = $('ciPresetWrap');
  if (!wrap) return;
  if (!presetOpen) { wrap.innerHTML = ''; return; }
  var html = '<div class="ci-preset-wrap">' +
    '<div class="ci-panel-title">ClassIsland 默认科目（与客户端相同的 GUID，已添加的科目会置灰）</div>' +
    '<div class="ci-preset-grid">';
  PRESET_SUBJECTS.forEach(function (p) {
    var added = (p.id in profile.Subjects);
    html += '<button class="ci-preset-chip' + (added ? ' added' : '') + '" ' + (added ? 'disabled' : 'onclick="addPresetSubject(\'' + p.id + '\')"') + '>' +
      '<span class="p-init">' + escHtml(p.initial) + '</span>' +
      '<span class="p-name">' + escHtml(p.name) + '</span>' +
      (added ? '<span class="p-added">已添加</span>' : '') +
      '</button>';
  });
  html += '</div>' +
    '<div style="margin-top:8px"><button class="ci-btn small primary" onclick="addAllPresetSubjects()">添加全部未添加科目</button></div>' +
    '</div>';
  wrap.innerHTML = html;
}
function addPresetSubject(presetId) {
  var p = null;
  PRESET_SUBJECTS.forEach(function (x) { if (x.id === presetId) p = x; });
  if (!p || (p.id in profile.Subjects)) return;
  profile.Subjects[p.id] = { Name: p.name, Initial: p.initial, TeacherName: '', IsOutDoor: !!p.outdoor, AttachedObjects: {} };
  selectedSubjectId = p.id;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}
function addAllPresetSubjects() {
  var added = 0;
  PRESET_SUBJECTS.forEach(function (p) {
    if (!(p.id in profile.Subjects)) {
      profile.Subjects[p.id] = { Name: p.name, Initial: p.initial, TeacherName: '', IsOutDoor: !!p.outdoor, AttachedObjects: {} };
      added++;
    }
  });
  if (added > 0) { dirty = true; commitUndo(); renderAll(); runValidation(); }
  alert(added > 0 ? ('已添加 ' + added + ' 个预设科目') : '全部预设科目均已添加');
}

function subjectOptionsHtml(selectedId, includeEmpty) {
  var html = includeEmpty ? '<option value="' + EMPTY_GUID + '"' + (selectedId === EMPTY_GUID ? ' selected' : '') + '>（未设置）</option>' : '';
  Object.keys(profile.Subjects).forEach(function (id) {
    html += '<option value="' + id + '"' + (id === selectedId ? ' selected' : '') + '>' + escHtml(profile.Subjects[id].Name || id) + '</option>';
  });
  return html;
}

// ================= 时间表 =================
function renderTimeLayoutList() {
  var list = $('ciTimeLayoutList');
  var ids = Object.keys(profile.TimeLayouts);
  var html = '';
  ids.forEach(function (id) {
    var tl = profile.TimeLayouts[id] || {};
    var count = Array.isArray(tl.Layouts) ? tl.Layouts.length : 0;
    html += '<div class="ci-list-item' + (id === selectedTimeLayoutId ? ' selected' : '') + '" onclick="selectTimeLayout(\'' + id + '\')">' +
      '<span>' + escHtml(tl.Name || '未命名时间表') + '</span>' +
      '<span class="ci-li-meta">' + count + ' 点</span>' +
      '<button class="ci-li-del" title="删除时间表" onclick="event.stopPropagation();removeTimeLayout(\'' + id + '\')">×</button>' +
      '</div>';
  });
  list.innerHTML = html || '<div class="ci-empty">暂无时间表</div>';
}

function selectTimeLayout(id) {
  selectedTimeLayoutId = id;
  selectedItemIdx = -1;
  persistViewState();
  renderTimeLayoutList(); renderTimeLayoutDetail(); renderTimeLayoutVisual();
}

function renderTimeLayoutDetail() {
  var box = $('ciTimeLayoutDetail');
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl) { box.innerHTML = '<div class="ci-empty">选择左侧时间表以编辑时间点</div>'; return; }
  var items = Array.isArray(tl.Layouts) ? tl.Layouts : [];
  var collapsed = !!uiState.collapse.timelayouts;
  var html = '<h3 class="ci-detail-title">时间表设置</h3>' +
    // 可收起设置区（状态存于浏览器）
    '<div class="ci-collapse' + (collapsed ? ' ci-collapsed' : '') + '">' +
    '<div class="ci-collapse-head" onclick="toggleCollapse(\'timelayouts\')">' +
    '<span class="ci-collapse-title">时间表信息</span><span class="ci-collapse-chevron">&#9662;</span>' +
    '</div>' +
    '<div class="ci-collapse-body"><div class="ci-form-grid">' +
    '<div class="ci-field"><label>时间表名称</label><input value="' + escAttr(tl.Name || '') + '" oninput="onTimeLayoutField(\'Name\',this.value)" /></div>' +
    '<div class="ci-field"><label>GUID</label><input class="ci-guid" value="' + escAttr(selectedTimeLayoutId) + '" readonly /></div>' +
    '</div></div></div>' +
    // 对齐 ClassIsland 2：按类型插入时间点 + 时间点时长（快速创建指定长度的上课/课间）+ 复制当前时间点
    '<div class="ci-items-head"><span class="ci-panel-title">时间点（' + items.length + '）</span>' +
    '<div class="ci-items-actions">' +
    '<span class="ci-dur-field" title="插入上课时间点时使用的时长">上课<input type="number" min="1" max="600" value="' + escAttr(uiState.durClass) + '" onchange="onDurChange(\'durClass\', this.value)" />分</span>' +
    '<span class="ci-dur-field" title="插入课间时间点时使用的时长">课间<input type="number" min="0" max="600" value="' + escAttr(uiState.durBreak) + '" onchange="onDurChange(\'durBreak\', this.value)" />分</span>' +
    '<button class="ci-btn small" onclick="insertTimeItem(0)" title="在选中时间点后插入一节上课（使用上课时长）">+ 上课</button>' +
    '<button class="ci-btn small" onclick="insertTimeItem(1)" title="在选中时间点后插入课间（使用课间时长）">+ 课间</button>' +
    '<button class="ci-btn small" onclick="insertTimeItem(2)" title="在选中时间点后插入分割线">+ 分割</button>' +
    '<button class="ci-btn small" onclick="insertTimeItem(3)" title="在选中时间点后插入行动时间点">+ 行动</button>' +
    '<button class="ci-btn small" onclick="duplicateTimeItem()" title="复制选中的时间点">复制</button>' +
    '<button class="ci-btn small" onclick="removeTimeItem()" title="删除选中的时间点">删除</button>' +
    '</div></div>';
  if (items.length === 0) html += '<div class="ci-empty" style="padding:10px">暂无时间点，点击上方「+ 上课」从 08:00 开始排一天的时间。</div>';
  // 表头（与 .ci-time-row 网格列对齐）
  html += '<div class="ci-time-row ci-time-head">' +
    '<span>#</span><span>开始</span><span>结束</span><span>类型</span><span>科目 / 名称</span><span>隐藏</span><span></span>' +
    '</div>';
  items.forEach(function (item, i) {
    var t = itemTimes(item);
    var type = typeof item.TimeType === 'number' ? item.TimeType : 0;
    var thirdCol = type === 0
      ? '<select onchange="onTimeItemChange(' + i + ',\'DefaultClassId\',this.value)" onclick="selectTimeItem(' + i + ')">' + subjectOptionsHtml(item.DefaultClassId, true) + '</select>'
      : (type === 1
        ? '<input value="' + escAttr(item.BreakName || '') + '" placeholder="课间名称（可选）" onclick="selectTimeItem(' + i + ')" oninput="onTimeItemChange(' + i + ',\'BreakName\',this.value)" />'
        : '<span class="ci-tt-badge ci-tt-' + type + '">' + (TIME_TYPES[type] || '?') + '</span>');
    html += '<div class="ci-time-row' + (i === selectedItemIdx ? ' selected' : '') + '">' +
      '<span class="ci-idx" title="点击选中此时间点" onclick="selectTimeItem(' + i + ')">' + (i + 1) + '</span>' +
      '<input type="time" step="1" value="' + escAttr(t.start.slice(0, 8)) + '" onchange="onTimeItemTime(' + i + ',\'start\',this.value)" onclick="selectTimeItem(' + i + ')" />' +
      '<input type="time" step="1" value="' + escAttr(t.end.slice(0, 8)) + '" onchange="onTimeItemTime(' + i + ',\'end\',this.value)" onclick="selectTimeItem(' + i + ')" />' +
      '<select onchange="onTimeItemType(' + i + ',this.value)" onclick="selectTimeItem(' + i + ')">' + timeTypeOptions(type) + '</select>' +
      thirdCol +
      '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--ci-text-3)"><input type="checkbox" ' + (item.IsHideDefault ? 'checked' : '') + ' onchange="onTimeItemChange(' + i + ',\'IsHideDefault\',this.checked)" />隐藏</label>' +
      '<span style="display:inline-flex;gap:2px">' +
        '<button class="ci-row-del" title="上移" onclick="moveTimeItem(' + i + ',-1)">&#8593;</button>' +
        '<button class="ci-row-del" title="下移" onclick="moveTimeItem(' + i + ',1)">&#8595;</button>' +
        '<button class="ci-row-del" title="删除" onclick="removeTimeItem(' + i + ')">×</button>' +
      '</span>' +
      '</div>';
  });
  box.innerHTML = html;
}

function timeTypeOptions(selected) {
  var html = '';
  [0, 1, 2, 3].forEach(function (t) {
    html += '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + TIME_TYPES[t] + '</option>';
  });
  return html;
}

function selectTimeItem(i) {
  // 只切换高亮与可视化，不重建时间点行——避免点击行内输入框时 DOM 被替换导致无法输入
  selectedItemIdx = i;
  renderTimeLayoutVisual();
  persistViewState();
}

function onTimeLayoutField(field, value) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl) return;
  tl[field] = value;
  dirty = true;
  queueUndo();
  renderTimeLayoutList();
  renderTimeLayoutVisual();
}

function onTimeItemChange(idx, field, value) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !tl.Layouts || !tl.Layouts[idx]) return;
  tl.Layouts[idx][field] = value;
  dirty = true;
  queueUndo();
  if (field === 'DefaultClassId' || field === 'BreakName') renderTimeLayoutVisual();
}

function onTimeItemType(idx, value) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !tl.Layouts || !tl.Layouts[idx]) return;
  var item = tl.Layouts[idx];
  item.TimeType = parseInt(value, 10) || 0;
  if (item.TimeType === 2 || item.TimeType === 3) {
    var t = itemTimes(item);
    setItemTimes(item, t.start, t.start);
  }
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); renderTimeLayoutVisual(); runValidation();
}

function onTimeItemTime(idx, which, value) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !tl.Layouts || !tl.Layouts[idx]) return;
  var item = tl.Layouts[idx];
  var t = itemTimes(item);
  if (which === 'start') t.start = value || t.start;
  else t.end = value || t.end;
  setItemTimes(item, t.start, t.end);
  dirty = true;
  queueUndo();
  renderTimeLayoutVisual();
  runValidation();
}

/** 修改时间点时长（对齐 ClassIsland 2 的“时间点时长”，用于快速创建指定长度的上课/课间） */
function onDurChange(key, value) {
  var v = parseInt(value, 10);
  if (isNaN(v) || v < 0) v = key === 'durClass' ? 40 : 10;
  uiState[key] = Math.min(v, 600);
  persistViewState();
}

/** 对齐 ClassIsland 2：在选中时间点后插入（时长取上方“时间点时长”，上课默认 40 / 课间默认 10，分割与行动 0） */
function insertTimeItem(type) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl) { alert('请先创建/选择一个时间表'); return; }
  if (!Array.isArray(tl.Layouts)) tl.Layouts = [];
  var items = tl.Layouts;
  var at = (selectedItemIdx >= 0 && selectedItemIdx < items.length) ? selectedItemIdx + 1 : items.length;
  var prev = at > 0 ? items[at - 1] : null;
  var start = prev && itemTimes(prev).end ? itemTimes(prev).end : '08:00:00';
  // 分割线查重（与 ClassIsland 2 行为一致）
  if (type === 2 && items.some(function (i) { return i.TimeType === 2 && itemTimes(i).start === start; })) {
    alert('这里已经存在一条分割线。');
    return;
  }
  if (type === 3 && items.some(function (i) { return i.TimeType === 3 && itemTimes(i).start === start; })) {
    alert('这里已经存在一个行动时间点。');
    return;
  }
  var durMin = type === 0 ? (parseInt(uiState.durClass, 10) || 40)
    : type === 1 ? (parseInt(uiState.durBreak, 10) || 0)
    : 0;
  var item = { TimeType: type, IsHideDefault: false, AttachedObjects: {} };
  setItemTimes(item, start, addSeconds(start, durMin));
  if (type === 0) item.DefaultClassId = EMPTY_GUID;
  items.splice(at, 0, item);
  selectedItemIdx = at;
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); renderTimeLayoutVisual(); runValidation();
  persistViewState();
}

function duplicateTimeItem(idx) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !Array.isArray(tl.Layouts)) return;
  var i = (typeof idx === 'number') ? idx : selectedItemIdx;
  if (i < 0 || i >= tl.Layouts.length) { alert('请先点击时间点序号选中一行'); return; }
  var copy = JSON.parse(JSON.stringify(tl.Layouts[i]));
  tl.Layouts.splice(i + 1, 0, copy);
  selectedItemIdx = i + 1;
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); renderTimeLayoutVisual(); runValidation();
}

function moveTimeItem(idx, delta) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !Array.isArray(tl.Layouts)) return;
  var j = idx + delta;
  if (j < 0 || j >= tl.Layouts.length) return;
  var items = tl.Layouts;
  var tmp = items[idx];
  items[idx] = items[j];
  items[j] = tmp;
  selectedItemIdx = j;
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); renderTimeLayoutVisual(); runValidation();
}

function removeTimeItem(idx) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !tl.Layouts) return;
  var i = (typeof idx === 'number') ? idx : selectedItemIdx;
  if (i < 0 || i >= tl.Layouts.length) { alert('请先点击时间点序号选中一行'); return; }
  tl.Layouts.splice(i, 1);
  if (selectedItemIdx >= tl.Layouts.length) selectedItemIdx = tl.Layouts.length - 1;
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); renderTimeLayoutVisual(); runValidation();
}

function addTimeLayout() {
  ensureProfileMode();
  var id = guid();
  profile.TimeLayouts[id] = { Name: '新时间表', Layouts: [], AttachedObjects: {} };
  selectedTimeLayoutId = id;
  selectedItemIdx = -1;
  dirty = true;
  commitUndo();
  switchView('timelayouts');
  renderAll();
}

function removeTimeLayout(id) {
  if (!profile || !profile.TimeLayouts[id]) return;
  var usedBy = Object.keys(profile.ClassPlans).filter(function (cpId) { return profile.ClassPlans[cpId] && profile.ClassPlans[cpId].TimeLayoutId === id; });
  var msg = '确认删除时间表「' + (profile.TimeLayouts[id].Name || id) + '」？';
  if (usedBy.length) msg += '\n\n有 ' + usedBy.length + ' 个课表正在引用它，删除后这些课表将失效。';
  if (!confirm(msg)) return;
  delete profile.TimeLayouts[id];
  if (selectedTimeLayoutId === id) { selectedTimeLayoutId = null; selectedItemIdx = -1; }
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

/** 在相邻两个上课时间点之间自动补课间 */
function fillBreaks() {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !Array.isArray(tl.Layouts)) { alert('请先选择时间表'); return; }
  var added = 0;
  var items = tl.Layouts;
  for (var i = items.length - 1; i > 0; i--) {
    var prev = items[i - 1], cur = items[i];
    if (prev.TimeType !== 0 || cur.TimeType !== 0) continue;
    var pt = itemTimes(prev), ct = itemTimes(cur);
    var gap = diffMinutes(pt.end, ct.start);
    if (gap <= 0) continue;
    var brkLen = gap >= 20 ? 10 : Math.max(0, gap - 2);
    if (brkLen <= 0) continue;
    var brk = { TimeType: 1, IsHideDefault: false, BreakName: '' };
    setItemTimes(brk, pt.end, addMinutes(pt.end, brkLen));
    items.splice(i, 0, brk);
    added++;
  }
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); renderTimeLayoutVisual();
  alert(added > 0 ? ('已添加 ' + added + ' 个课间') : '没有可插入课间的相邻课程段');
}

// ================= 时间表可视化视图（对齐客户端时间线：类型图标 / 时长 / 当前时刻指示） =================
var VIZ_ICONS = {
  0: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
  2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>',
  3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
};

function renderTimeLayoutVisual() {
  var box = $('ciTlVisualWrap');
  if (!box) return;
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl) { box.innerHTML = '<div class="ci-empty">选择左侧时间表后可查看可视化时间线</div>'; return; }
  var items = Array.isArray(tl.Layouts) ? tl.Layouts : [];
  if (items.length === 0) { box.innerHTML = '<div class="ci-empty">该时间表暂无时间点</div>'; return; }

  // 当前时刻指示：定位包含当前时间的时间点（对齐客户端时间线的“现在”概念）
  var now = new Date();
  var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  var nowIdx = -1;
  items.forEach(function (item, i) {
    var t = itemTimes(item);
    var s = toSec(t.start), e = toSec(t.end);
    if (nowIdx < 0 && s <= nowSec && nowSec < e) nowIdx = i;
  });

  // 以最长时长为基准计算各块高度（分割线固定窄条）
  var maxMin = 1;
  items.forEach(function (it) {
    var t = itemTimes(it);
    var m = diffMinutes(t.start, t.end);
    if (m > maxMin) maxMin = m;
  });
  var html = '<div class="ci-tl-visual-wrap">';
  items.forEach(function (item, i) {
    var t = itemTimes(item);
    var type = typeof item.TimeType === 'number' ? item.TimeType : 0;
    var dur = Math.max(0, diffMinutes(t.start, t.end));
    var minH = type === 2 ? 0 : 34;
    var height = type === 2 ? 0 : Math.round(minH + (dur / maxMin) * 56);
    var name = type === 0 ? (subjectName(item.DefaultClassId) || '未设置科目')
      : (type === 1 ? (item.BreakName || '课间休息')
        : (type === 2 ? '分割线' : '行动'));
    var sub = type === 2 ? t.start : (dur + ' 分钟' + (item.IsHideDefault ? ' · 默认隐藏' : ''));
    var isNow = i === nowIdx;
    html += '<div class="ci-viz-item ci-viz-' + type + (i === selectedItemIdx ? ' selected' : '') + (isNow ? ' now' : '') + '"' +
      ' style="' + (type !== 2 ? ('min-height:' + minH + 'px;height:' + height + 'px') : '') + '"' +
      ' onclick="selectTimeItem(' + i + ')" title="' + escAttr(name + ' ' + t.start + '-' + t.end) + '">' +
      '<span class="ci-viz-icon">' + (VIZ_ICONS[type] || '') + '</span>' +
      '<span class="ci-viz-time">' + escHtml(shortTime(t.start)) + '<br>' + escHtml(shortTime(t.end)) + '</span>' +
      '<span class="ci-viz-main"><span class="ci-viz-name">' + escHtml(name) +
      (isNow ? '<span class="ci-viz-now-badge">现在</span>' : '') +
      '</span><span class="ci-viz-sub">' + escHtml(sub) + '</span></span>' +
      '</div>';
  });
  html += '</div>';
  box.innerHTML = html;
}

function toSec(hhmmss) {
  var p = String(hhmmss || '00:00:00').split(':');
  return (parseInt(p[0], 10) || 0) * 3600 + (parseInt(p[1], 10) || 0) * 60 + (parseInt(p[2], 10) || 0);
}

// ================= 课表（按课表群分组，Classes 与时间表上课点对应） =================
function renderClassPlanList() {
  var list = $('ciClassPlanList');
  if (!list) return;
  var html = '';
  var seen = {};
  // 临时层课表置顶显示（作为新项，可清除）
  var overlays = Object.keys(profile.ClassPlans).filter(function (pid) { return profile.ClassPlans[pid] && profile.ClassPlans[pid].IsOverlay; });
  if (overlays.length) {
    html += '<div class="ci-plan-group-head"><span>临时层</span><span class="ci-group-count">(' + overlays.length + ')</span></div>';
    overlays.forEach(function (pid) {
      var cp = profile.ClassPlans[pid] || {};
      seen[pid] = true;
      html += '<div class="ci-list-item ci-temp-item' + (pid === selectedClassPlanId ? ' selected' : '') + '" onclick="selectClassPlan(\'' + pid + '\')">' +
        '<span>' + escHtml(cp.Name || '未命名临时层') + '</span>' +
        '<span class="ci-li-meta">' + escHtml(String(profile.TempClassPlanSetupTime || '').slice(0, 10) || '临时') + '</span>' +
        '<button class="ci-li-del" title="清除临时层" onclick="event.stopPropagation();clearTempLayer()">×</button>' +
        '</div>';
    });
  }
  var groupIds = Object.keys(profile.ClassPlanGroups);
  // 默认课表群置顶（与 ClassIsland 2 一致）
  groupIds.sort(function (a, b) {
    if (a.toLowerCase() === DEFAULT_GROUP_GUID) return -1;
    if (b.toLowerCase() === DEFAULT_GROUP_GUID) return 1;
    return (profile.ClassPlanGroups[a].Name || '').localeCompare(profile.ClassPlanGroups[b].Name || '');
  });
  groupIds.forEach(function (gid) {
    var g = profile.ClassPlanGroups[gid] || {};
    var plans = Object.keys(profile.ClassPlans).filter(function (pid) {
      var cp = profile.ClassPlans[pid];
      return cp && !cp.IsOverlay && (cp.AssociatedGroup || DEFAULT_GROUP_GUID) === gid;
    });
    plans.forEach(function (p) { seen[p] = true; });
    var isDefault = gid.toLowerCase() === DEFAULT_GROUP_GUID;
    html += '<div class="ci-plan-group-head">' +
      '<span>' + escHtml(g.Name || '未命名课表群') + '</span>' +
      '<span class="ci-group-count">(' + plans.length + ')</span>' +
      '<span class="ci-group-ops">' +
        '<button class="ci-group-op" title="重命名课表群" onclick="renameGroup(\'' + gid + '\')">重命名</button>' +
        (isDefault ? '' : '<button class="ci-group-op danger" title="删除课表群" onclick="removeGroup(\'' + gid + '\')">删除</button>') +
      '</span>' +
    '</div>';
    plans.forEach(function (pid) {
      var cp = profile.ClassPlans[pid] || {};
      var tl = profile.TimeLayouts[cp.TimeLayoutId];
      html += '<div class="ci-list-item' + (pid === selectedClassPlanId ? ' selected' : '') + '" onclick="selectClassPlan(\'' + pid + '\')">' +
        '<span>' + escHtml(cp.Name || '未命名课表') + '</span>' +
        '<span class="ci-li-meta">' + (tl ? escHtml(tl.Name || '时间表') : '未关联时间表') + '</span>' +
        '<button class="ci-li-del" title="删除课表" onclick="event.stopPropagation();removeClassPlan(\'' + pid + '\')">×</button>' +
        '</div>';
    });
    if (plans.length === 0) html += '<div class="ci-list-item" style="opacity:0.5;cursor:default"><span>（空）</span></div>';
  });
  // 群引用失效的课表
  var orphans = Object.keys(profile.ClassPlans).filter(function (pid) { return !seen[pid]; });
  if (orphans.length) {
    html += '<div class="ci-plan-group-head"><span>未分组</span><span class="ci-group-count">(' + orphans.length + ')</span></div>';
    orphans.forEach(function (pid) {
      var cp = profile.ClassPlans[pid] || {};
      html += '<div class="ci-list-item' + (pid === selectedClassPlanId ? ' selected' : '') + '" onclick="selectClassPlan(\'' + pid + '\')">' +
        '<span>' + escHtml(cp.Name || '未命名课表') + '</span>' +
        '<button class="ci-li-del" title="删除课表" onclick="event.stopPropagation();removeClassPlan(\'' + pid + '\')">×</button>' +
        '</div>';
    });
  }
  list.innerHTML = html || '<div class="ci-empty">暂无课表</div>';
}

function selectClassPlan(id) {
  selectedClassPlanId = id;
  quickDockTarget = null; // 切换课表后原选中位置失效
  persistViewState();
  renderClassPlanList(); renderClassPlanDetail();
}

function renderClassPlanDetail() {
  var box = $('ciClassPlanDetail');
  if (!box) return;
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) { box.innerHTML = '<div class="ci-empty">选择左侧课表以编辑</div>'; return; }
  if (!isPlainObject(cp.TimeRule)) cp.TimeRule = { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 0 };
  var rule = cp.TimeRule;
  if (!Array.isArray(cp.Classes)) cp.Classes = [];
  var tl = profile.TimeLayouts[cp.TimeLayoutId];
  var classPoints = tl && Array.isArray(tl.Layouts) ? tl.Layouts.filter(function (i) { return i.TimeType === 0; }) : [];
  var collapsed = !!uiState.collapse.classplans;

  // 临时层：对齐 ClassIsland 2，当前课表仅保留“创建临时层”按钮（临时层作为新项显示在列表/周视图/月视图中）
  var isOverlayPlan = !!cp.IsOverlay;
  var tempSetup = typeof profile.TempClassPlanSetupTime === 'string' ? profile.TempClassPlanSetupTime.slice(0, 10) : '';
  var tempHtml = isOverlayPlan
    ? '<div class="ci-temp-card">' +
      '<div class="ci-temp-head"><span class="ci-temp-title"><span class="ci-temp-dot"></span>临时层（当日临时替换正常课表）</span>' +
      '<span class="ci-temp-active">' + escHtml(tempSetup) + '</span>' +
      '<button class="ci-btn small danger" onclick="clearTempLayer()">清除临时层</button>' +
      '</div></div>'
    : '<div class="ci-temp-card">' +
      '<div class="ci-temp-head"><span class="ci-temp-title">临时层</span>' +
      '<span style="font-size:11px;color:var(--ci-text-3)">复制当前课表创建临时层，作为新项显示并在当日临时替换</span>' +
      '<button class="ci-btn small" onclick="createTempLayer()">创建临时层</button>' +
      '</div></div>';

  var classesHtml = '';
  var rowCount = Math.max(cp.Classes.length, classPoints.length);
  if (rowCount === 0) {
    classesHtml = '<div class="ci-empty" style="padding:8px">' + (tl ? '关联的时间表中没有上课时间点' : '请先关联一个时间表') + '</div>';
  }
  for (var i = 0; i < rowCount; i++) {
    var point = classPoints[i];
    var cls = cp.Classes[i];
    var timeCol;
    if (point) {
      var pt = itemTimes(point);
      timeCol = '<span class="ci-class-time" title="对应时间表第 ' + (indexOfClassPoint(tl, point) + 1) + ' 个上课点">' + escHtml(shortTime(pt.start)) + ' - ' + escHtml(shortTime(pt.end)) + '</span>';
    } else {
      timeCol = '<span class="ci-class-extra" title="时间表中没有对应的上课点，此课程不会显示">多余课程</span>';
    }
    var chip = '';
    if (cls) {
      var sid = cls.SubjectId;
      var subj = sid && profile.Subjects[sid] ? profile.Subjects[sid] : null;
      chip = '<button class="ci-quick-chip' + (!subj ? ' ci-quick-missing' : '') + '" title="点击打开科目选择面板" onclick="event.stopPropagation();openQuickSelect(\'subject\',' + i + ')">' +
        (subj ? escHtml(subj.Initial || subj.Name || '?') + ' ' + escHtml(subj.Name || '') : '未设置') +
        '</button>';
    } else {
      chip = '<span class="ci-class-extra">—</span>';
    }
    // 行点击：选中当前课程（配合右侧常驻快速选择菜单）；科目编辑区保持打开选择面板
    var isRowSelected = !!(quickDockTarget && quickDockTarget.type === 'lesson' &&
      quickDockTarget.planId === selectedClassPlanId && quickDockTarget.idx === i);
    classesHtml += '<div class="ci-class-row' + (isRowSelected ? ' selected' : '') + '" onclick="selectLessonRow(' + i + ')" title="点击选中此课程，在右侧快速选择菜单中选择科目；点击科目块打开选择面板">' +
      '<span class="ci-idx">' + (i + 1) + '</span>' +
      timeCol +
      chip +
      (cls
        ? '<button class="ci-row-del" title="删除此课程" onclick="event.stopPropagation();removeClass(' + i + ')">×</button>'
        : '<span></span>') +
      '</div>';
  }

  var html = '<h3 class="ci-detail-title">课表设置</h3>' +
    tempHtml +
    // 可收起的课表设置（收起/展开状态存于浏览器）
    '<div class="ci-collapse' + (collapsed ? ' ci-collapsed' : '') + '">' +
    '<div class="ci-collapse-head" onclick="toggleCollapse(\'classplans\')">' +
    '<span class="ci-collapse-title">课表设置</span><span class="ci-collapse-chevron">&#9662;</span>' +
    '</div>' +
    '<div class="ci-collapse-body"><div class="ci-form-grid">' +
    '<div class="ci-field"><label>课表名称</label><input value="' + escAttr(cp.Name || '') + '" oninput="onClassPlanField(\'Name\',this.value)" /></div>' +
    '<div class="ci-field"><label>关联时间表（TimeLayoutId）</label><select onchange="onClassPlanField(\'TimeLayoutId\',this.value)">' + timeLayoutOptions(cp.TimeLayoutId) + '</select></div>' +
    '<div class="ci-field"><label>启用星期（WeekDay）</label><select onchange="onRuleChange(\'WeekDay\',parseInt(this.value)||0)">' + weekdayOptions(rule.WeekDay) + '</select></div>' +
    '<div class="ci-field"><label>轮换总周数（WeekCountDivTotal）</label><select onchange="onRuleChange(\'WeekCountDivTotal\',parseInt(this.value)||0)">' + rotateTotalOptions(rule.WeekCountDivTotal) + '</select></div>' +
    '<div class="ci-field"><label>轮换第几周（WeekCountDiv）</label><select ' + (rule.WeekCountDivTotal > 0 ? '' : 'disabled') + ' onchange="onRuleChange(\'WeekCountDiv\',parseInt(this.value)||0)">' + rotateDivOptions(rule) + '</select></div>' +
    '<div class="ci-field"><label>所属课表群（AssociatedGroup）</label><select onchange="onClassPlanField(\'AssociatedGroup\',this.value)">' + groupOptions(cp.AssociatedGroup) + '</select></div>' +
    '<div class="ci-field"><label>启用（IsEnabled）</label><label style="display:inline-flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" ' + (cp.IsEnabled !== false ? 'checked' : '') + ' onchange="onClassPlanField(\'IsEnabled\',this.checked)" />在时间线上显示</label></div>' +
    '<div class="ci-field"><label>GUID</label><input class="ci-guid" value="' + escAttr(selectedClassPlanId) + '" readonly /></div>' +
    '</div></div></div>' +
    '<div class="ci-items-head"><span class="ci-panel-title">课程（Classes，与时间表上课点按顺序对应，点击科目块可快速选择）</span>' +
    '<div class="ci-items-actions">' +
    '<button class="ci-btn small" onclick="syncClassesToLayout()" title="按时间表上课点数量补齐/保留课程行">对齐时间表</button>' +
    '<button class="ci-btn small" onclick="addClass()">+ 添加课程</button>' +
    '</div></div>' +
    classesHtml;
  box.innerHTML = html;
  renderQuickDock();
}

function classPlanOptionsHtml(selected, excludeOverlay) {
  var html = '<option value="">（选择课表）</option>';
  Object.keys(profile.ClassPlans).forEach(function (id) {
    var cp = profile.ClassPlans[id];
    if (excludeOverlay && cp && cp.IsOverlay) return;
    html += '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + escHtml(cp.Name || id) + '</option>';
  });
  return html;
}

function indexOfClassPoint(tl, item) {
  var n = 0;
  for (var i = 0; i < (tl.Layouts || []).length; i++) {
    if (tl.Layouts[i].TimeType === 0) {
      if (tl.Layouts[i] === item) return n;
      n++;
    }
  }
  return 0;
}

function shortTime(hhmmss) {
  var p = String(hhmmss || '').split(':');
  return p.length >= 2 ? (p[0] + ':' + p[1]) : hhmmss;
}

// ================= 课程快速选择面板 =================
function openQuickSelect(type, idx, planId) {
  if (type === 'subject') {
    var pid = planId || selectedClassPlanId;
    var cp = profile.ClassPlans[pid];
    if (!cp || !cp.Classes || !cp.Classes[idx]) return;
    quickSelectCtx = { type: 'subject', planId: pid, idx: idx };
    var fromWeek = planId ? ' · 周视图' : '';
    $('ciQuickTitle').textContent = '快速选择科目（第 ' + (idx + 1) + ' 节' + fromWeek + '）';
  } else if (type === 'plan') {
    quickSelectCtx = { type: 'plan', dateKey: idx }; // idx 传日期 key
    $('ciQuickTitle').textContent = '选择该日课表（' + idx.slice(0, 10) + '）';
  }
  $('ciQuickSelect').style.display = '';
  $('ciQuickSearch').value = '';
  renderQuickSelect();
  renderWeekView(); // 高亮当前正在编辑的课程
  $('ciQuickSearch').focus();
}

function closeQuickSelect() {
  $('ciQuickSelect').style.display = 'none';
  quickSelectCtx = null;
  renderWeekView();
}

function renderQuickSelect() {
  var grid = $('ciQuickGrid');
  if (!grid || !quickSelectCtx) return;
  var kw = ($('ciQuickSearch').value || '').trim().toLowerCase();
  var html = '';
  if (quickSelectCtx.type === 'subject') {
    var cp = profile.ClassPlans[quickSelectCtx.planId];
    var current = cp && cp.Classes ? cp.Classes[quickSelectCtx.idx] : null;
    var currentId = current ? current.SubjectId : null;
    var any = false;
    Object.keys(profile.Subjects).forEach(function (id) {
      var s = profile.Subjects[id];
      var name = s.Name || id;
      if (kw && (name + (s.Initial || '')).toLowerCase().indexOf(kw) < 0) return;
      any = true;
      html += '<button class="ci-quick-item' + (id === currentId ? ' current' : '') + '" onclick="quickPickSubject(\'' + id + '\')">' +
        '<span class="q-init">' + escHtml(s.Initial || (name.slice(0, 1))) + '</span>' +
        '<span class="q-name">' + escHtml(name) + '</span>' +
        (s.IsOutDoor ? '<span class="q-outdoor">户外</span>' : '') +
        '</button>';
    });
    if (!any) html = '<div class="ci-empty">没有匹配的科目</div>';
    // 对齐 ClassIsland 2：选完自动跳到下一节（状态存于浏览器）
    html += '<label class="ci-quick-autonext"><input type="checkbox" ' + (uiState.autoNextLesson ? 'checked' : '') + ' onchange="onAutoNextChange(this.checked)" />选完自动跳到下一节</label>';
  } else if (quickSelectCtx.type === 'plan') {
    Object.keys(profile.ClassPlans).forEach(function (id) {
      var cp = profile.ClassPlans[id];
      var name = cp.Name || id;
      if (kw && name.toLowerCase().indexOf(kw) < 0) return;
      html += '<button class="ci-quick-item" onclick="quickPickPlan(\'' + id + '\')">' +
        '<span class="q-init">' + escHtml((name.slice(0, 1))) + '</span>' +
        '<span class="q-name">' + escHtml(name) + '</span>' +
        '</button>';
    });
    html += '<button class="ci-quick-item" onclick="quickClearPlan()" title="移除该日的预定课表，恢复按星期轮换">' +
      '<span class="q-init" style="color:var(--ci-err)">×</span><span class="q-name">清除预定</span></button>';
  }
  grid.innerHTML = html;
}

function onAutoNextChange(v) {
  uiState.autoNextLesson = !!v;
  persistViewState();
}

function quickPickSubject(id) {
  if (!quickSelectCtx || quickSelectCtx.type !== 'subject') return;
  var cp = profile.ClassPlans[quickSelectCtx.planId];
  if (cp && cp.Classes && cp.Classes[quickSelectCtx.idx]) {
    cp.Classes[quickSelectCtx.idx].SubjectId = id;
    dirty = true;
    commitUndo();
    runValidation();
    // 对齐 ClassIsland 2：选完自动跳到下一节
    if (uiState.autoNextLesson && cp.Classes[quickSelectCtx.idx + 1]) {
      quickSelectCtx.idx += 1;
      $('ciQuickTitle').textContent = '快速选择科目（第 ' + (quickSelectCtx.idx + 1) + '）';
      $('ciQuickSearch').value = '';
      renderQuickSelect();
      renderClassPlanDetail();
      renderWeekView();
      renderQuickDock();
      return;
    }
  }
  closeQuickSelect();
  renderClassPlanDetail();
  renderWeekView();
  renderQuickDock();
}

function quickPickPlan(id) {
  if (!quickSelectCtx || quickSelectCtx.type !== 'plan') return;
  if (!isPlainObject(profile.OrderedSchedules)) profile.OrderedSchedules = {};
  profile.OrderedSchedules[quickSelectCtx.dateKey] = { ClassPlanId: id };
  dirty = true;
  commitUndo();
  closeQuickSelect();
  renderMonthView();
}

function quickClearPlan() {
  if (!quickSelectCtx || quickSelectCtx.type !== 'plan') return;
  if (isPlainObject(profile.OrderedSchedules)) delete profile.OrderedSchedules[quickSelectCtx.dateKey];
  dirty = true;
  commitUndo();
  closeQuickSelect();
  renderMonthView();
}

// ================= 周视图 =================
function planForWeekday(weekday) {
  // 返回该星期启用的课表数组（考虑轮换的课表标注轮换信息）；临时层课表单独作为新项展示，不参与轮换
  var result = [];
  Object.keys(profile.ClassPlans).forEach(function (pid) {
    var cp = profile.ClassPlans[pid];
    if (!cp || cp.IsEnabled === false || cp.IsOverlay) return;
    var rule = isPlainObject(cp.TimeRule) ? cp.TimeRule : {};
    if ((rule.WeekDay === undefined ? 1 : rule.WeekDay) !== weekday) return;
    result.push({ id: pid, plan: cp });
  });
  return result;
}

/** 指定星期的临时层课表（IsOverlay，作为新项显示在周视图列中） */
function overlaysForWeekday(weekday) {
  return Object.keys(profile.ClassPlans).filter(function (pid) {
    var cp = profile.ClassPlans[pid];
    if (!cp || !cp.IsOverlay) return false;
    var rule = isPlainObject(cp.TimeRule) ? cp.TimeRule : {};
    return (rule.WeekDay === undefined ? 1 : rule.WeekDay) === weekday;
  });
}

function renderWeekView() {
  var box = $('ciCpWeekWrap');
  if (!box) return;
  var total = 0;
  // 轮换周选择：取所有课表的最大轮换周数
  Object.keys(profile.ClassPlans).forEach(function (pid) {
    var r = profile.ClassPlans[pid].TimeRule;
    if (isPlainObject(r) && (r.WeekCountDivTotal || 0) > total) total = r.WeekCountDivTotal;
  });
  var rot = typeof renderWeekView._rot === 'number' ? renderWeekView._rot : 0;
  if (rot >= total) rot = 0;

  var html = '<div class="ci-week-toolbar">' +
    '<span>按星期展示各课表的课程安排' + (total > 0 ? '，当前轮换：' : '') + '</span>';
  if (total > 0) {
    html += '<select onchange="renderWeekView._rot = parseInt(this.value)||0; renderWeekView()" style="height:26px;padding:0 8px;font-size:11px;background:var(--ci-card);color:var(--ci-text);border:1px solid var(--ci-border);border-radius:6px;outline:none">';
    html += '<option value="0"' + (rot === 0 ? ' selected' : '') + '>不轮换</option>';
    for (var w = 1; w < total; w++) {
      html += '<option value="' + w + '"' + (rot === w ? ' selected' : '') + '>第 ' + (w + 1) + ' 周</option>';
    }
    html += '</select>';
  }
  // 对齐 ClassIsland 2 周视图编辑体验：点击课程选中，再点打开科目面板；支持“选完自动跳到下一节”
  html += '<label class="ci-week-autonext"><input type="checkbox" ' + (uiState.autoNextLesson ? 'checked' : '') + ' onchange="onAutoNextChange(this.checked)" />选完自动跳到下一节</label>';
  html += '<span>点击课表名可跳转编辑</span></div>';

  var todayDow2 = new Date().getDay();
  html += '<div class="ci-week-grid">';
  WEEKDAY_ORDER.forEach(function (dow) {
    // 临时层课表作为新项置顶显示在对应星期列
    var entries = overlaysForWeekday(dow).map(function (pid) {
      return { id: pid, plan: profile.ClassPlans[pid], overlay: true };
    }).concat(planForWeekday(dow));
    var isToday = dow === todayDow2;
    html += '<div class="ci-week-col">' +
      '<div class="ci-week-col-head' + (isToday ? ' today' : '') + '"><span>' + WEEKDAY_NAMES[dow] + '</span>' +
      (isToday ? '<span>今天</span>' : '') + '</div>' +
      '<div class="ci-week-col-body">';
    if (entries.length === 0) {
      html += '<div class="ci-week-empty">无课表</div>';
    }
    entries.forEach(function (entry) {
      var cp = entry.plan;
      var rule = isPlainObject(cp.TimeRule) ? cp.TimeRule : {};
      var planTotal = rule.WeekCountDivTotal || 0;
      var planDiv = rule.WeekCountDiv || 0;
      var rotLabel = planTotal > 0 ? ('轮换第' + (planDiv + 1) + '周') : '';
      var dim = !entry.overlay && planTotal > 0 && rot > 0 && planDiv !== rot - 1;
      html += '<div class="ci-week-plan' + (dim ? ' dim' : '') + (entry.overlay ? ' overlay' : '') + '" onclick="selectClassPlan(\'' + entry.id + '\'); switchClassPlanSubView(\'list\')" title="点击课表名进入列表编辑">';
      html += '<div class="ci-week-plan-name"><span>' + escHtml(cp.Name || '未命名课表') + (entry.overlay ? '<em class="ci-week-overlay-badge">临时层</em>' : '') + '</span><span class="ci-week-rot">' + escHtml(rotLabel) + '</span></div>';
      var tl = profile.TimeLayouts[cp.TimeLayoutId];
      var classPoints = tl && Array.isArray(tl.Layouts) ? tl.Layouts.filter(function (x) { return x.TimeType === 0; }) : [];
      if (classPoints.length === 0) {
        html += '<div class="ci-week-empty">（无上课点）</div>';
      } else {
        classPoints.forEach(function (point, i) {
          var pt = itemTimes(point);
          var cls = (cp.Classes || [])[i];
          var sName = cls && cls.SubjectId ? (subjectInitial(cls.SubjectId) || '—') : '—';
          var isSel = quickDockTarget && quickDockTarget.type === 'week' &&
            quickDockTarget.planId === entry.id && quickDockTarget.idx === i;
          var isEditing = quickSelectCtx && quickSelectCtx.type === 'subject' &&
            quickSelectCtx.planId === entry.id && quickSelectCtx.idx === i;
          html += '<button class="ci-week-lesson' + (isSel ? ' selected' : '') + (isEditing ? ' editing' : '') + '"' +
            ' title="点击选中此节次；再次点击打开科目选择面板"' +
            ' onclick="event.stopPropagation(); weekLessonClick(\'' + entry.id + '\', ' + i + ')">' +
            '<span class="ci-lesson-time">' + escHtml(shortTime(pt.start)) + '</span>' +
            '<span class="ci-lesson-name">' + escHtml(sName) + '</span>' +
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

// ================= 月视图（含预定课表 OrderedSchedules） =================
function dateKeyOf(y, m, d) {
  return y + '-' + pad2(m + 1) + '-' + pad2(d) + 'T00:00:00';
}
function planNameForDate(y, m, d) {
  var key = dateKeyOf(y, m, d);
  // 临时层优先：TempClassPlanSetupTime 匹配当日时显示临时层课表
  var tempDate = String(profile.TempClassPlanSetupTime || '').slice(0, 10);
  var tempId = profile.TempClassPlanId;
  if (tempId && profile.ClassPlans[tempId] && profile.ClassPlans[tempId].IsOverlay &&
      tempDate && tempDate === key.slice(0, 10)) {
    return { name: profile.ClassPlans[tempId].Name || '临时层', overlay: true };
  }
  var ordered = isPlainObject(profile.OrderedSchedules) ? profile.OrderedSchedules[key] : null;
  if (ordered && ordered.ClassPlanId && profile.ClassPlans[ordered.ClassPlanId]) {
    return { name: profile.ClassPlans[ordered.ClassPlanId].Name || '未命名课表', ordered: true };
  }
  var dow = new Date(y, m, d).getDay();
  var plans = planForWeekday(dow);
  if (plans.length === 0) return { name: '', ordered: false };
  return { name: plans[0].plan.Name || '未命名课表', ordered: false };
}

function renderMonthView() {
  var box = $('ciCpMonthWrap');
  if (!box) return;
  if (!monthCursor) {
    var now = new Date();
    monthCursor = { y: now.getFullYear(), m: now.getMonth() };
  }
  var y = monthCursor.y, m = monthCursor.m;
  var first = new Date(y, m, 1);
  var startDow = first.getDay(); // 0=周日
  var startOffset = (startDow + 6) % 7; // 周一为第一列
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var today = new Date();

  var html = '<div class="ci-month-toolbar">' +
    '<button class="ci-btn small" onclick="monthCursor = prevMonth(monthCursor); renderMonthView()">上月</button>' +
    '<span class="ci-month-title">' + y + ' 年 ' + (m + 1) + ' 月</span>' +
    '<button class="ci-btn small" onclick="monthCursor = nextMonth(monthCursor); renderMonthView()">下月</button>' +
    '<button class="ci-btn small" onclick="var n=new Date(); monthCursor={y:n.getFullYear(),m:n.getMonth()}; renderMonthView()">今天</button>' +
    '<span style="font-size:11px;color:var(--ci-text-3)">点击日期可预定课表（写入 OrderedSchedules，优先于星期轮换）</span>' +
    '</div>';

  html += '<div class="ci-month-grid">';
  ['一', '二', '三', '四', '五', '六', '日'].forEach(function (d) {
    html += '<div class="ci-month-head">' + d + '</div>';
  });
  for (var i = 0; i < startOffset; i++) {
    html += '<div class="ci-month-cell dim" style="cursor:default"></div>';
  }
  for (var day = 1; day <= daysInMonth; day++) {
    var isToday = y === today.getFullYear() && m === today.getMonth() && day === today.getDate();
    var pn = planNameForDate(y, m, day);
    var key = dateKeyOf(y, m, day);
    html += '<div class="ci-month-cell' + (isToday ? ' today' : '') + (pn.ordered ? ' ordered' : '') + (pn.overlay ? ' overlay' : '') + '"' +
      ' onclick="openQuickSelect(\'plan\', \'' + key + '\')" title="点击预定该日课表">' +
      '<div class="ci-month-day">' + day + '</div>' +
      (pn.name ? '<div class="ci-month-plan' + (pn.ordered ? ' ordered-tag' : '') + (pn.overlay ? ' overlay-tag' : '') + '">' + escHtml(pn.name) + (pn.overlay ? ' ·临时层' : (pn.ordered ? ' ·预定' : '')) + '</div>' : '') +
      '</div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

function prevMonth(c) { return c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }; }
function nextMonth(c) { return c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function timeLayoutOptions(selected) {
  var html = '<option value="' + EMPTY_GUID + '"' + (!selected || selected === EMPTY_GUID ? ' selected' : '') + '>（未选择）</option>';
  Object.keys(profile.TimeLayouts).forEach(function (id) {
    html += '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + escHtml(profile.TimeLayouts[id].Name || id) + '</option>';
  });
  return html;
}

function weekdayOptions(selected) {
  var html = '';
  for (var d = 0; d <= 6; d++) {
    html += '<option value="' + d + '"' + (d === selected ? ' selected' : '') + '>' + WEEKDAY_NAMES[d] + '</option>';
  }
  return html;
}

function rotateTotalOptions(selected) {
  var opts = [[0, '不轮换'], [2, '双周轮换'], [3, '三周轮换'], [4, '四周轮换']];
  return opts.map(function (o) {
    return '<option value="' + o[0] + '"' + (o[0] === selected ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
}

function rotateDivOptions(rule) {
  var total = rule.WeekCountDivTotal || 0;
  var html = '';
  for (var w = 0; w < total; w++) {
    html += '<option value="' + w + '"' + (w === (rule.WeekCountDiv || 0) ? ' selected' : '') + '>第 ' + (w + 1) + ' 周</option>';
  }
  return html || '<option value="0">—</option>';
}

function groupOptions(selected) {
  var html = '';
  Object.keys(profile.ClassPlanGroups).forEach(function (id) {
    html += '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + escHtml(profile.ClassPlanGroups[id].Name || id) + '</option>';
  });
  return html;
}

function onClassPlanField(field, value) {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) return;
  cp[field] = value;
  dirty = true;
  queueUndo();
  if (field === 'Name') renderClassPlanList();
  if (field === 'TimeLayoutId') { renderClassPlanDetail(); }
  if (field === 'IsEnabled') runValidation();
}

function onRuleChange(field, value) {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) return;
  if (!isPlainObject(cp.TimeRule)) cp.TimeRule = {};
  cp.TimeRule[field] = value;
  dirty = true;
  queueUndo();
  renderClassPlanDetail();
}

function onClassChange(idx, field, value) {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp || !cp.Classes || !cp.Classes[idx]) return;
  cp.Classes[idx][field] = value;
  dirty = true;
  queueUndo();
  runValidation();
}

function addClass() {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) return;
  if (!Array.isArray(cp.Classes)) cp.Classes = [];
  var firstSubject = Object.keys(profile.Subjects)[0] || EMPTY_GUID;
  cp.Classes.push({ SubjectId: firstSubject, AttachedObjects: {} });
  dirty = true;
  commitUndo();
  renderClassPlanDetail(); runValidation();
}

function removeClass(idx) {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp || !cp.Classes || !cp.Classes[idx]) return;
  cp.Classes.splice(idx, 1);
  dirty = true;
  commitUndo();
  renderClassPlanDetail(); runValidation();
}

/** 对齐时间表：按关联时间表的上课点数量补齐课程行（不删除多余行，由用户决定） */
function syncClassesToLayout() {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) return;
  var tl = profile.TimeLayouts[cp.TimeLayoutId];
  var classPoints = tl && Array.isArray(tl.Layouts) ? tl.Layouts.filter(function (i) { return i.TimeType === 0; }) : [];
  if (!Array.isArray(cp.Classes)) cp.Classes = [];
  var added = 0;
  while (cp.Classes.length < classPoints.length) {
    cp.Classes.push({ SubjectId: Object.keys(profile.Subjects)[0] || EMPTY_GUID, AttachedObjects: {} });
    added++;
  }
  dirty = true;
  commitUndo();
  renderClassPlanDetail(); runValidation();
  alert(added > 0 ? ('已补齐 ' + added + ' 节课程') : '课程数量已与时间表上课点一致');
}

function addClassPlan() {
  ensureProfileMode();
  var id = guid();
  var firstLayout = Object.keys(profile.TimeLayouts)[0] || EMPTY_GUID;
  profile.ClassPlans[id] = {
    TimeLayoutId: firstLayout,
    TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 0 },
    Classes: [],
    Name: '新课表',
    IsActivated: false,
    IsOverlay: false,
    IsEnabled: true,
    AssociatedGroup: DEFAULT_GROUP_GUID,
    AttachedObjects: {}
  };
  selectedClassPlanId = id;
  dirty = true;
  commitUndo();
  switchView('classplans');
  switchClassPlanSubView('list');
  renderAll();
}

function removeClassPlan(id) {
  if (!profile || !profile.ClassPlans[id]) return;
  if (!confirm('确认删除课表「' + (profile.ClassPlans[id].Name || id) + '」？')) return;
  delete profile.ClassPlans[id];
  if (selectedClassPlanId === id) selectedClassPlanId = null;
  if (profile.TempClassPlanId === id) { profile.TempClassPlanId = null; profile.TempClassPlanSetupTime = null; }
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

/** 克隆当前选中的课表（含课程、时间规则与所属课表群） */
function duplicateClassPlan() {
  var src = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!src) { alert('请先选择一个课表'); return; }
  var id = guid();
  var copy = JSON.parse(JSON.stringify(src));
  copy.Name = (src.Name || '未命名课表') + ' 副本';
  copy.IsOverlay = false;
  profile.ClassPlans[id] = copy;
  selectedClassPlanId = id;
  quickDockTarget = null;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

// ================= 常驻快速选择菜单（列表 / 周视图右侧，仅科目名称） =================
/** 列表视图：点击课程行（非科目编辑区）选中当前课程，配合右侧快速选择菜单 */
function selectLessonRow(i) {
  if (!selectedClassPlanId) return;
  quickDockTarget = { type: 'lesson', planId: selectedClassPlanId, idx: i };
  var rows = document.querySelectorAll('#ciClassPlanDetail .ci-class-row');
  for (var k = 0; k < rows.length; k++) rows[k].classList.toggle('selected', k === i);
  renderQuickDock();
}

/** 周视图：点击单元格选中；再次点击已选中的单元格打开科目选择面板 */
function weekLessonClick(planId, idx) {
  var t = quickDockTarget;
  if (t && t.type === 'week' && t.planId === planId && t.idx === idx) {
    openQuickSelect('subject', idx, planId);
    return;
  }
  quickDockTarget = { type: 'week', planId: planId, idx: idx };
  renderWeekView();
  renderQuickDock();
}

function updateQuickDock() {
  var dock = $('ciQuickDock');
  if (!dock) return;
  var show = isProfile && view === 'classplans' && (classPlanSubView === 'list' || classPlanSubView === 'week');
  dock.style.display = show ? 'flex' : 'none';
  var cb = $('ciDockAutoNext');
  if (cb) cb.checked = !!uiState.autoNextLesson;
  if (show) renderQuickDock();
}

/** 渲染快速选择菜单（仅科目名称；高亮当前目标课程已设置的科目） */
function renderQuickDock() {
  var list = $('ciQuickDockList');
  if (!list || !isProfile || !profile) return;
  var currentSub = null;
  if (quickDockTarget) {
    var cp = profile.ClassPlans[quickDockTarget.planId];
    var cls = cp && cp.Classes ? cp.Classes[quickDockTarget.idx] : null;
    currentSub = cls ? cls.SubjectId : null;
  }
  var html = '';
  Object.keys(profile.Subjects).forEach(function (id) {
    html += '<button class="ci-dock-item' + (id === currentSub ? ' current' : '') + '" onclick="quickDockAssign(\'' + id + '\')" title="应用到选中的课程">' +
      escHtml(profile.Subjects[id].Name || id) + '</button>';
  });
  list.innerHTML = html || '<div class="ci-empty">暂无科目</div>';
}

/** 应用快速选择：把科目写入当前选中的课程位置（可自动跳到下一节） */
function quickDockAssign(subjectId) {
  var t = quickDockTarget;
  if (!t) { alert('请先在列表或周视图中点击选择一个课程位置'); return; }
  var cp = profile.ClassPlans[t.planId];
  if (!cp || !cp.Classes || !cp.Classes[t.idx]) {
    alert('课程位置已失效，请重新选择');
    quickDockTarget = null;
    renderQuickDock();
    return;
  }
  cp.Classes[t.idx].SubjectId = subjectId;
  dirty = true;
  commitUndo();
  runValidation();
  if (uiState.autoNextLesson && cp.Classes[t.idx + 1]) {
    quickDockTarget = { type: t.type, planId: t.planId, idx: t.idx + 1 };
  } else {
    quickDockTarget = null;
  }
  renderClassPlanDetail();
  renderWeekView();
  renderQuickDock();
}

// ================= 临时层（对齐 ClassIsland 2：IsOverlay 课表，作为新项显示） =================
/** 从当前选中课表创建临时层：复制课表（IsOverlay）并在当日临时替换正常课表 */
function createTempLayer() {
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) { alert('请先选择一个课表'); return; }
  if (cp.IsOverlay) return;
  var id = guid();
  var copy = JSON.parse(JSON.stringify(cp));
  copy.Name = (cp.Name || '未命名课表') + '（临时层）';
  copy.IsOverlay = true;
  copy.IsEnabled = true;
  profile.ClassPlans[id] = copy;
  profile.TempClassPlanId = id;
  profile.TempClassPlanSetupTime = todayStr() + 'T00:00:00';
  selectedClassPlanId = id;
  quickDockTarget = null;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

/** 清除临时层：删除 IsOverlay 课表并复位临时课表字段 */
function clearTempLayer() {
  if (!profile) return;
  var tempId = profile.TempClassPlanId;
  if (tempId && profile.ClassPlans[tempId] && profile.ClassPlans[tempId].IsOverlay) {
    delete profile.ClassPlans[tempId];
    if (selectedClassPlanId === tempId) selectedClassPlanId = null;
  }
  profile.TempClassPlanId = null;
  profile.TempClassPlanSetupTime = null;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

// ================= 课表群 =================
function addGroup() {
  ensureProfileMode();
  var name = prompt('课表群名称：', '新课表群');
  if (!name || !name.trim()) return;
  var id = guid();
  profile.ClassPlanGroups[id] = { Name: name.trim(), IsGlobal: false };
  profile.SelectedClassPlanGroupId = id;
  dirty = true;
  commitUndo();
  renderGroupModal();
  renderAll();
}

/** 课表群选择模态框（编辑器右上角「课表群」按钮） */
function openGroupModal() {
  if (!isProfile) { alert('当前文件未识别为 ClassIsland 档案'); return; }
  $('ciGroupModal').style.display = '';
  renderGroupModal();
}

function closeGroupModal() {
  $('ciGroupModal').style.display = 'none';
}

function renderGroupModal() {
  var list = $('ciGroupList');
  if (!list || !profile) return;
  var html = '';
  Object.keys(profile.ClassPlanGroups).forEach(function (gid) {
    var g = profile.ClassPlanGroups[gid] || {};
    var count = Object.keys(profile.ClassPlans).filter(function (pid) {
      var cp = profile.ClassPlans[pid];
      return cp && !cp.IsOverlay && (cp.AssociatedGroup || DEFAULT_GROUP_GUID) === gid;
    }).length;
    var selected = profile.SelectedClassPlanGroupId === gid;
    html += '<div class="ci-group-item' + (selected ? ' selected' : '') + '" onclick="selectClassPlanGroup(\'' + gid + '\')">' +
      '<span class="ci-group-name">' + escHtml(g.Name || gid) + (selected ? '<em>当前</em>' : '') + '</span>' +
      '<span class="ci-li-meta">' + count + ' 课表</span>' +
      '<span class="ci-group-ops" onclick="event.stopPropagation()">' +
        '<button class="ci-group-op" onclick="renameGroup(\'' + gid + '\');renderGroupModal();renderAll()">重命名</button>' +
        (gid.toLowerCase() === DEFAULT_GROUP_GUID ? '' : '<button class="ci-group-op danger" onclick="removeGroup(\'' + gid + '\');renderGroupModal();renderAll()">删除</button>') +
      '</span>' +
    '</div>';
  });
  list.innerHTML = html || '<div class="ci-empty">暂无课表群</div>';
}

function selectClassPlanGroup(gid) {
  if (!profile || !profile.ClassPlanGroups[gid]) return;
  profile.SelectedClassPlanGroupId = gid;
  dirty = true;
  queueUndo();
  renderGroupModal();
  renderAll();
}

function renameGroup(id) {
  if (!profile || !profile.ClassPlanGroups[id]) return;
  var name = prompt('课表群名称：', profile.ClassPlanGroups[id].Name || '');
  if (!name || !name.trim()) return;
  profile.ClassPlanGroups[id].Name = name.trim();
  dirty = true;
  queueUndo();
  renderAll();
}

function removeGroup(id) {
  if (!profile || !profile.ClassPlanGroups[id]) return;
  var used = Object.keys(profile.ClassPlans).filter(function (cpId) { return profile.ClassPlans[cpId] && profile.ClassPlans[cpId].AssociatedGroup === id; }).length;
  var msg = '确认删除课表群「' + (profile.ClassPlanGroups[id].Name || id) + '」？';
  if (used) msg += '\n\n有 ' + used + ' 个课表关联此群，删除后将移入「未分组」。';
  if (!confirm(msg)) return;
  delete profile.ClassPlanGroups[id];
  if (profile.SelectedClassPlanGroupId === id) profile.SelectedClassPlanGroupId = DEFAULT_GROUP_GUID;
  dirty = true;
  commitUndo();
  renderAll();
}

// ================= 当前启用的课表（对齐客户端：临时层 > 临时课表 > 星期轮换） =================
/** 解析当前生效的课表：临时层优先，其次临时课表，最后按今天星期轮换 */
function activePlanInfo() {
  if (!isProfile || !profile) return null;
  var tempId = profile.TempClassPlanId;
  if (tempId && profile.ClassPlans[tempId]) {
    return {
      id: tempId,
      plan: profile.ClassPlans[tempId],
      kind: profile.ClassPlans[tempId].IsOverlay ? 'overlay' : 'temp',
    };
  }
  var dow = new Date().getDay();
  var plans = planForWeekday(dow);
  if (plans.length) return { id: plans[0].id, plan: plans[0].plan, kind: 'weekday' };
  return null;
}

/** 渲染顶栏右侧「当前启用的课表」（点击展开临时课表与多周轮换设定） */
function renderActivePlanBar() {
  var bar = $('ciActivePlan');
  if (!bar) return;
  if (!isProfile || !profile) { bar.innerHTML = ''; return; }
  var info = activePlanInfo();
  var name = info ? (info.plan.Name || '未命名课表') : '无启用的课表';
  var kindTag = !info ? '' : info.kind === 'overlay' ? '临时层' : (info.kind === 'temp' ? '临时课表' : '按星期');
  var rule = info && isPlainObject(info.plan.TimeRule) ? info.plan.TimeRule : { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 0 };
  var html = '<button class="ci-active-plan-btn' + (info && info.kind !== 'weekday' ? ' temp' : '') + '" onclick="toggleActivePlanPanel()" title="查看/修改临时课表与多周轮换">' +
    '<span class="ci-active-plan-label">当前启用的课表</span>' +
    '<span class="ci-active-plan-name">' + escHtml(name) + (kindTag ? '<em>' + kindTag + '</em>' : '') + '</span>' +
    '<span class="ci-active-plan-chevron">&#9662;</span>' +
    '</button>' +
    '<div class="ci-active-plan-panel" id="ciActivePlanPanel" style="display:none">' +
      '<div class="ci-ap-row">' +
        '<span class="ci-ap-label">临时课表</span>' +
        '<select id="ciBarTempPlanSel">' + classPlanOptionsHtml('', true) + '</select>' +
        '<input type="date" id="ciBarTempDate" value="' + escAttr(todayStr()) + '" />' +
        '<button class="ci-btn small primary" onclick="applyTempPlanBar()">启用</button>' +
        (info && info.kind === 'temp' ? '<button class="ci-btn small danger" onclick="clearTempPlanBar()">清除</button>' : '') +
      '</div>' +
      (info
        ? '<div class="ci-ap-row">' +
          '<span class="ci-ap-label">多周轮换</span>' +
          '<select onchange="onActiveRuleChange(\'WeekCountDivTotal\', parseInt(this.value) || 0)">' + rotateTotalOptions(rule.WeekCountDivTotal || 0) + '</select>' +
          '<select ' + ((rule.WeekCountDivTotal || 0) > 0 ? '' : 'disabled') + ' onchange="onActiveRuleChange(\'WeekCountDiv\', parseInt(this.value) || 0)">' + rotateDivOptions(rule) + '</select>' +
          '<span class="ci-ap-hint">作用于「' + escHtml(name) + '」</span>' +
        '</div>'
        : '') +
    '</div>';
  bar.innerHTML = html;
}

function toggleActivePlanPanel() {
  var p = $('ciActivePlanPanel');
  if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
}

/** 顶栏临时课表：写入 TempClassPlanId + TempClassPlanSetupTime（与客户端字段一致） */
function applyTempPlanBar() {
  var sel = $('ciBarTempPlanSel');
  var date = $('ciBarTempDate');
  if (!sel || !sel.value) { alert('请选择要临时启用的课表'); return; }
  if (!date || !date.value) { alert('请选择生效日期'); return; }
  profile.TempClassPlanId = sel.value;
  profile.TempClassPlanSetupTime = date.value + 'T00:00:00';
  dirty = true;
  commitUndo();
  renderActivePlanBar();
  renderClassPlanDetail();
  renderWeekView();
  renderMonthView();
}

function clearTempPlanBar() {
  profile.TempClassPlanId = null;
  profile.TempClassPlanSetupTime = null;
  dirty = true;
  commitUndo();
  renderActivePlanBar();
  renderClassPlanDetail();
  renderWeekView();
  renderMonthView();
}

/** 顶栏多周轮换：修改当前启用课表的 TimeRule（与课表设置区同步） */
function onActiveRuleChange(field, value) {
  var info = activePlanInfo();
  if (!info) return;
  if (!isPlainObject(info.plan.TimeRule)) info.plan.TimeRule = {};
  info.plan.TimeRule[field] = value;
  dirty = true;
  queueUndo();
  renderActivePlanBar();
  if (selectedClassPlanId === info.id) renderClassPlanDetail();
  renderWeekView();
  renderMonthView();
}

// ================= 校验 =================
function runValidation() {
  validationErrors = []; validationWarnings = [];
  if (!isProfile || !profile) { renderIssues(); return; }
  if (Object.keys(profile.Subjects).length === 0) validationWarnings.push('尚未添加任何科目');
  if (Object.keys(profile.TimeLayouts).length === 0) validationWarnings.push('尚未添加任何时间表');
  if (Object.keys(profile.ClassPlans).length === 0) validationWarnings.push('尚未添加任何课表');

  var subjectNames = {};
  Object.keys(profile.Subjects).forEach(function (id) {
    var s = profile.Subjects[id];
    if (!s.Name || !String(s.Name).trim()) validationWarnings.push('科目 ' + id.slice(0, 8) + ' 缺少名称');
    else if (subjectNames[s.Name]) validationWarnings.push('存在重复科目名称：' + s.Name);
    subjectNames[s.Name] = true;
  });

  Object.keys(profile.TimeLayouts).forEach(function (tlId) {
    var tl = profile.TimeLayouts[tlId];
    var name = tl.Name || tlId.slice(0, 8);
    var classItems = [];
    (tl.Layouts || []).forEach(function (item, i) {
      var t = itemTimes(item);
      if (!t.start || !t.end) { validationErrors.push('时间表「' + name + '」第 ' + (i + 1) + ' 个时间点缺少时间'); return; }
      if (t.start >= t.end) validationErrors.push('时间表「' + name + '」第 ' + (i + 1) + ' 个时间点结束时间早于开始时间');
      if (item.TimeType === 0) {
        classItems.push({ i: i, t: t });
        var sid = item.DefaultClassId;
        if (!sid || sid === EMPTY_GUID) validationWarnings.push('时间表「' + name + '」第 ' + (i + 1) + ' 节课未设置科目');
        else if (!profile.Subjects[sid]) validationErrors.push('时间表「' + name + '」第 ' + (i + 1) + ' 节课引用了不存在的科目');
      }
    });
    for (var a = 0; a < classItems.length; a++) {
      for (var b = a + 1; b < classItems.length; b++) {
        if (classItems[a].t.end > classItems[b].t.start && classItems[b].t.end > classItems[a].t.start) {
          validationWarnings.push('时间表「' + name + '」第 ' + (classItems[a].i + 1) + ' 与第 ' + (classItems[b].i + 1) + ' 节课时间重叠');
        }
      }
    }
  });

  Object.keys(profile.ClassPlans).forEach(function (cpId) {
    var cp = profile.ClassPlans[cpId];
    var name = cp.Name || cpId.slice(0, 8);
    if (!cp.TimeLayoutId || !profile.TimeLayouts[cp.TimeLayoutId]) {
      validationErrors.push('课表「' + name + '」未关联有效的时间表');
    }
    (cp.Classes || []).forEach(function (cls, i) {
      if (!cls.SubjectId || !profile.Subjects[cls.SubjectId]) {
        validationErrors.push('课表「' + name + '」第 ' + (i + 1) + ' 节课程引用了不存在的科目');
      }
    });
  });
  renderIssues();
}

function renderIssues() {
  var all = validationErrors.map(function (m) { return { type: 'error', msg: m }; })
    .concat(validationWarnings.map(function (m) { return { type: 'warning', msg: m }; }));
  $('ciIssueCount').textContent = all.length;
  var list = $('ciIssueList');
  if (all.length === 0) {
    list.innerHTML = '<div class="ci-issue-none">没有发现问题</div>';
  } else {
    list.innerHTML = all.map(function (iss) {
      return '<div class="ci-issue-item ' + iss.type + '"><span class="ci-issue-dot"></span><span>' + escHtml(iss.msg) + '</span></div>';
    }).join('');
  }
}

function toggleIssues() {
  $('ciIssuesPanel').classList.toggle('collapsed');
}

function onNameInput() {
  if (!isProfile || !profile) return;
  profile.Name = $('ciProfileName').value;
  dirty = true;
  queueUndo();
}

// ================= Ribbon 命令（保存由平台保存按钮触发） =================
function ensureProfileMode() {
  if (!isProfile) {
    if (!confirm('当前文件未识别为 ClassIsland 档案，继续将把文件转为空白档案结构（原 JSON 将被覆盖）。是否继续？')) {
      throw new Error('cancelled');
    }
    profile = normalizeProfile({});
    isProfile = true;
    profileFmt = '2x';
    enterProfileMode();
  }
}

function handleCommand(cmd) {
  if (fallbackActive) return;
  try {
    switch (cmd) {
      case 'save': saveConfig(); break;
      case 'ci-save': saveConfig(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'ci-detect': redetect(); break;
      case 'ci-add-subject': ensureProfileMode(); switchView('subjects'); addSubject(); break;
      case 'ci-add-timelayout': addTimeLayout(); break;
      case 'ci-add-timeitem': if (isProfile) { switchView('timelayouts'); insertTimeItem(0); } break;
      case 'ci-fill-breaks': if (isProfile) fillBreaks(); break;
      case 'ci-add-classplan': addClassPlan(); break;
      case 'ci-add-group': addGroup(); break;
      case 'ci-validate': if (isProfile) { runValidation(); alert('校验完成：' + validationErrors.length + ' 个错误，' + validationWarnings.length + ' 个警告'); } break;
      case 'ci-format': if (isProfile) { formatProfile(); } break;
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
    saveConfig();
  }
  if (e.key === 'Escape' && quickSelectCtx) {
    closeQuickSelect();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (isProfile && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      undo();
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    if (isProfile && document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      redo();
    }
  }
});

window.addEventListener('beforeunload', function (e) {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ================= 时间计算 =================
function addMinutes(hhmmss, minutes) {
  return addSeconds(hhmmss, minutes * 60);
}
function addSeconds(hhmmss, seconds) {
  var p = String(hhmmss || '00:00:00').split(':');
  var total = (parseInt(p[0], 10) || 0) * 3600 + (parseInt(p[1], 10) || 0) * 60 + (parseInt(p[2], 10) || 0) + seconds;
  if (total < 0) total = 0;
  var h = Math.floor(total / 3600) % 24, m = Math.floor((total % 3600) / 60), s = total % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}
function diffMinutes(start, end) {
  var p1 = String(start || '00:00:00').split(':'), p2 = String(end || '00:00:00').split(':');
  var s1 = (parseInt(p1[0], 10) || 0) * 3600 + (parseInt(p1[1], 10) || 0) * 60 + (parseInt(p1[2], 10) || 0);
  var s2 = (parseInt(p2[0], 10) || 0) * 3600 + (parseInt(p2[1], 10) || 0) * 60 + (parseInt(p2[2], 10) || 0);
  return Math.round((s2 - s1) / 60);
}

// ================= 初始化 =================
(function init() {
  var content = window.CSEditor && window.CSEditor.file ? (window.CSEditor.file.content || '') : '';
  restoreViewState();
  loadFromContent(content);
  // 非 ClassIsland 档案已请求平台回退：不再渲染或接管保存
  if (fallbackActive || !isProfile) return;
  revalidateSelections();
  runValidation();
  switchView(view);
})();
