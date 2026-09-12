/**
 * ClassIsland 档案编辑器（.json 通用注册 + 关键格式识别）
 *
 * - 文件为 ClassIsland 档案（TimeLayouts / ClassPlans / Subjects 关键结构）时进入结构化编辑；
 * - 否则回退为通用 JSON 编辑器。
 * - 编辑体验对齐 ClassIsland 2 档案设置窗口：课表（按课表群分组、Classes 与时间表上课点对应）、
 *   时间表（按类型插入时间点、复制、分割线查重）、科目（增删复制）。
 * - 保存通过平台 Ribbon「保存」按钮（save 命令 / Ctrl+S），不设独立保存按钮；
 *   撤销/重做对接平台 Ribbon 的 undo/redo 命令。
 * - 视图与选择状态随文件持久化，刷新后回到刷新前页面。
 * - 兼容 1.x（StartSecond）与 2.x（StartTime）时间格式，保存时两种表示都写齐，未知字段原样保留。
 */
var profile = null;            // 档案对象（保存时原样序列化，未知字段不丢）
var isProfile = false;         // 是否识别为 ClassIsland 档案
var profileFmt = '2x';         // 时间字段主格式：2x=StartTime / 1x=StartSecond
var view = 'classplans';
var selectedTimeLayoutId = null;
var selectedClassPlanId = null;
var selectedItemIdx = -1;      // 时间表当前选中时间点
var dirty = false;
var rawDirty = false;          // 源码视图手动改过、尚未载入
var validationErrors = [];
var validationWarnings = [];

var DEFAULT_GROUP_GUID = 'acaf4ef0-e261-4262-b941-34ea93cb4369';
var EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
var TIME_ANCHOR = '2000-01-01';
var TIME_TYPES = { 0: '上课', 1: '课间', 2: '分割', 3: '行动' };
// ClassIsland 2 的默认时间点时长（分钟）：上课 40 / 课间 10 / 分割与行动 0
var DEFAULT_DURATION_MIN = { 0: 40, 1: 10, 2: 0, 3: 0 };

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
      selectedTimeLayoutId: selectedTimeLayoutId,
      selectedClassPlanId: selectedClassPlanId,
      selectedItemIdx: selectedItemIdx,
    }));
  } catch (e) { /* ignore */ }
}
function restoreViewState() {
  try {
    var raw = localStorage.getItem(stateStorageKey());
    if (!raw) return;
    var st = JSON.parse(raw);
    if (st && typeof st === 'object') {
      if (['classplans', 'timelayouts', 'subjects', 'raw'].indexOf(st.view) >= 0) view = st.view;
      if (st.selectedTimeLayoutId) selectedTimeLayoutId = st.selectedTimeLayoutId;
      if (st.selectedClassPlanId) selectedClassPlanId = st.selectedClassPlanId;
      if (typeof st.selectedItemIdx === 'number') selectedItemIdx = st.selectedItemIdx;
    }
  } catch (e) { /* ignore */ }
}

// ================= 载入 / 保存 =================
function loadFromContent(content) {
  var parsed = null;
  try { parsed = JSON.parse(content); }
  catch (e) {
    isProfile = false;
    profile = null;
    enterGenericMode('JSON 解析失败：' + e.message);
    return false;
  }
  var det = detectClassIslandProfile(parsed);
  if (det.ok) {
    isProfile = true;
    profileFmt = det.fmt || '2x';
    profile = normalizeProfile(parsed);
    enterProfileMode();
  } else {
    isProfile = false;
    profile = parsed;
    enterGenericMode(det.reason);
  }
  return true;
}

function buildOutput() {
  if (isProfile) return JSON.stringify(profile, null, 4);
  var el = $('ciGeneric');
  var text = el ? el.value : (window.CSEditor && window.CSEditor.file ? window.CSEditor.file.content : '');
  // 非 ClassIsland JSON：尽量格式化，失败则原样保存
  try { return JSON.stringify(JSON.parse(text), null, 4); } catch (e) { return text; }
}

function saveConfig() {
  if (isProfile) {
    runValidation();
    if (validationErrors.length > 0) {
      var msg = validationErrors.slice(0, 5).join('\n');
      if (!confirm('存在 ' + validationErrors.length + ' 个验证错误，仍要保存吗？\n\n' + msg)) return;
    }
    persistViewState();
  }
  var text = buildOutput();
  if (window.CSEditor) {
    if (window.CSEditor.emitSave) window.CSEditor.emitSave(text);
    else if (window.CSEditor.saveContent) window.CSEditor.saveContent(text);
  }
  dirty = false;
  rawDirty = false;
  lastSnapshot = snapshot();
  updateStats();
}

// ================= 模式切换 =================
function enterProfileMode() {
  var badge = $('ciFormatBadge');
  badge.className = 'ci-badge ci-is-profile';
  $('ciFormatText').textContent = 'ClassIsland 档案（' + (profileFmt === '1x' ? '1.x 时间格式' : '2.x 时间格式') + '）';
  $('ciViewTabs').style.display = '';
  $('ciGenericView').style.display = 'none';
  var tabs = document.querySelectorAll('#ciViewTabs .ci-view-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('disabled');
  revalidateSelections();
  lastSnapshot = snapshot();
  switchView(view === 'raw' ? 'raw' : view);
  renderAll();
  runValidation();
}

function enterGenericMode(reason) {
  var badge = $('ciFormatBadge');
  badge.className = 'ci-badge ci-not-profile';
  $('ciFormatText').textContent = '通用 JSON（未识别为 ClassIsland 档案）';
  $('ciViewTabs').style.display = 'none';
  $('ciGenericView').style.display = '';
  var views = document.querySelectorAll('.ci-view:not(#ciGenericView):not(#ciViewRaw)');
  for (var i = 0; i < views.length; i++) views[i].style.display = 'none';
  var el = $('ciGeneric');
  if (el && !el.value) el.value = window.CSEditor && window.CSEditor.file ? (window.CSEditor.file.content || '') : '';
  var nameInput = $('ciProfileName');
  if (nameInput) { nameInput.value = isPlainObject(profile) && typeof profile.Name === 'string' ? profile.Name : ''; nameInput.disabled = true; }
  updateStats(isPlainObject(profile) ? ('原因：' + reason) : '');
  validationErrors = []; validationWarnings = []; renderIssues();
}

function redetect() {
  var text = (window.CSEditor && window.CSEditor.file ? (window.CSEditor.file.content || '') : '');
  var rawEl = $('ciRaw');
  if (rawEl && rawEl.value) text = rawEl.value;
  var genericEl = $('ciGeneric');
  if (!isProfile && genericEl && genericEl.value) text = genericEl.value;
  if (rawDirty && rawEl && rawEl.value) text = rawEl.value;
  $('ciProfileName').disabled = false;
  var prevView = view;
  if (!loadFromContent(text)) return;
  if (isProfile && view !== prevView) switchView(prevView === 'raw' ? 'raw' : prevView);
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
  view = v;
  var map = { classplans: 'ciViewClassPlans', timelayouts: 'ciViewTimeLayouts', subjects: 'ciViewSubjects', raw: 'ciViewRaw' };
  for (var key in map) { $(map[key]).style.display = key === v ? '' : 'none'; }
  var tabs = document.querySelectorAll('#ciViewTabs .ci-view-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === v);
  if (v === 'raw' && !rawDirty && profile) $('ciRaw').value = JSON.stringify(profile, null, 4);
  persistViewState();
  renderAll();
}

function renderAll() {
  if (!isProfile || !profile) return;
  var nameInput = $('ciProfileName');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = profile.Name || '';
  renderSubjects();
  renderTimeLayoutList();
  renderTimeLayoutDetail();
  renderClassPlanList();
  renderClassPlanDetail();
  updateStats();
}

// ================= 科目 =================
function renderSubjects() {
  var body = $('ciSubjectsBody');
  var keys = Object.keys(profile.Subjects);
  $('ciSubjectsEmpty').style.display = keys.length === 0 ? '' : 'none';
  var html = '';
  keys.forEach(function (id) {
    var sub = profile.Subjects[id] || {};
    html += '<tr>' +
      '<td><input class="ci-cell-input" value="' + escAttr(sub.Name || '') + '" placeholder="如：数学" oninput="onSubjectChange(\'' + id + '\',\'Name\',this.value)" /></td>' +
      '<td><input class="ci-cell-input" value="' + escAttr(sub.Initial || '') + '" placeholder="如：数" oninput="onSubjectChange(\'' + id + '\',\'Initial\',this.value)" /></td>' +
      '<td><input class="ci-cell-input" value="' + escAttr(sub.TeacherName || '') + '" placeholder="教师姓名" oninput="onSubjectChange(\'' + id + '\',\'TeacherName\',this.value)" /></td>' +
      '<td><input class="ci-cell-check" type="checkbox" ' + (sub.IsOutDoor ? 'checked' : '') + ' onchange="onSubjectChange(\'' + id + '\',\'IsOutDoor\',this.checked)" /></td>' +
      '<td style="white-space:nowrap">' +
        '<button class="ci-btn small" onclick="duplicateSubject(\'' + id + '\')">复制</button> ' +
        '<button class="ci-btn small danger" onclick="removeSubject(\'' + id + '\')">删除</button>' +
      '</td>' +
      '</tr>';
  });
  body.innerHTML = html;
}

function onSubjectChange(id, field, value) {
  if (!profile || !profile.Subjects[id]) return;
  profile.Subjects[id][field] = value;
  dirty = true;
  queueUndo();
  updateStats();
}

function addSubject() {
  ensureProfileMode();
  var id = guid();
  profile.Subjects[id] = { Name: '新科目', Initial: '', TeacherName: '', IsOutDoor: false, AttachedObjects: {} };
  dirty = true;
  commitUndo();
  switchView('subjects');
  renderAll(); runValidation();
}

function duplicateSubject(id) {
  if (!profile || !profile.Subjects[id]) return;
  var src = profile.Subjects[id];
  var copy = JSON.parse(JSON.stringify(src));
  copy.Name = (src.Name || '科目') + ' 副本';
  profile.Subjects[guid()] = copy;
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
}

function removeSubject(id) {
  if (!profile || !profile.Subjects[id]) return;
  var name = profile.Subjects[id].Name || id;
  if (!confirm('确认删除科目「' + name + '」？时间表与课表中对该科目的引用将失效。')) return;
  delete profile.Subjects[id];
  dirty = true;
  commitUndo();
  renderAll(); runValidation();
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
  renderTimeLayoutList(); renderTimeLayoutDetail();
}

function renderTimeLayoutDetail() {
  var box = $('ciTimeLayoutDetail');
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl) { box.innerHTML = '<div class="ci-empty">选择左侧时间表以编辑时间点</div>'; return; }
  var items = Array.isArray(tl.Layouts) ? tl.Layouts : [];
  var html = '<h3 class="ci-detail-title">时间表设置</h3>' +
    '<div class="ci-form-grid">' +
    '<div class="ci-field"><label>时间表名称</label><input value="' + escAttr(tl.Name || '') + '" oninput="onTimeLayoutField(\'Name\',this.value)" /></div>' +
    '<div class="ci-field"><label>GUID</label><input class="ci-guid" value="' + escAttr(selectedTimeLayoutId) + '" readonly /></div>' +
    '</div>' +
    // 对齐 ClassIsland 2：按类型插入时间点 + 复制当前时间点
    '<div class="ci-items-head"><span class="ci-panel-title">时间点（' + items.length + '）</span>' +
    '<div class="ci-items-actions">' +
    '<button class="ci-btn small" onclick="insertTimeItem(0)" title="在选中时间点后插入一节上课（默认 40 分钟）">+ 上课</button>' +
    '<button class="ci-btn small" onclick="insertTimeItem(1)" title="在选中时间点后插入课间（默认 10 分钟）">+ 课间</button>' +
    '<button class="ci-btn small" onclick="insertTimeItem(2)" title="在选中时间点后插入分割线">+ 分割</button>' +
    '<button class="ci-btn small" onclick="insertTimeItem(3)" title="在选中时间点后插入行动时间点">+ 行动</button>' +
    '<button class="ci-btn small" onclick="duplicateTimeItem()" title="复制选中的时间点">复制</button>' +
    '<button class="ci-btn small" onclick="removeTimeItem()" title="删除选中的时间点">删除</button>' +
    '</div></div>';
  if (items.length === 0) html += '<div class="ci-empty" style="padding:10px">暂无时间点，点击上方「+ 上课」从 08:00 开始排一天的时间。</div>';
  items.forEach(function (item, i) {
    var t = itemTimes(item);
    var type = typeof item.TimeType === 'number' ? item.TimeType : 0;
    var thirdCol = type === 0
      ? '<select onchange="onTimeItemChange(' + i + ',\'DefaultClassId\',this.value)">' + subjectOptionsHtml(item.DefaultClassId, true) + '</select>'
      : (type === 1
        ? '<input value="' + escAttr(item.BreakName || '') + '" placeholder="课间名称（可选）" oninput="onTimeItemChange(' + i + ',\'BreakName\',this.value)" />'
        : '<span class="ci-tt-badge ci-tt-' + type + '">' + (TIME_TYPES[type] || '?') + '</span>');
    html += '<div class="ci-time-row' + (i === selectedItemIdx ? ' selected' : '') + '">' +
      '<span class="ci-idx" title="点击选中此时间点" onclick="selectTimeItem(' + i + ')">' + (i + 1) + '</span>' +
      '<input type="time" step="1" value="' + escAttr(t.start.slice(0, 8)) + '" onchange="onTimeItemTime(' + i + ',\'start\',this.value)" onclick="selectTimeItem(' + i + ')" />' +
      '<input type="time" step="1" value="' + escAttr(t.end.slice(0, 8)) + '" onchange="onTimeItemTime(' + i + ',\'end\',this.value)" onclick="selectTimeItem(' + i + ')" />' +
      '<select onchange="onTimeItemType(' + i + ',this.value)" onclick="selectTimeItem(' + i + ')">' + timeTypeOptions(type) + '</select>' +
      thirdCol +
      '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--ci-text-3)"><input type="checkbox" ' + (item.IsHideDefault ? 'checked' : '') + ' onchange="onTimeItemChange(' + i + ',\'IsHideDefault\',this.checked)" />隐藏</label>' +
      '<button class="ci-row-del" title="删除" onclick="removeTimeItem(' + i + ')">×</button>' +
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
  selectedItemIdx = i;
  renderTimeLayoutDetail();
  persistViewState();
}

function onTimeLayoutField(field, value) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl) return;
  tl[field] = value;
  dirty = true;
  queueUndo();
  renderTimeLayoutList();
}

function onTimeItemChange(idx, field, value) {
  var tl = selectedTimeLayoutId ? profile.TimeLayouts[selectedTimeLayoutId] : null;
  if (!tl || !tl.Layouts || !tl.Layouts[idx]) return;
  tl.Layouts[idx][field] = value;
  dirty = true;
  queueUndo();
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
  renderTimeLayoutDetail(); runValidation();
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
  runValidation();
}

/** 对齐 ClassIsland 2：在选中时间点后插入（默认时长：上课 40 / 课间 10 / 分割与行动 0） */
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
  var durMin = DEFAULT_DURATION_MIN[type] || 0;
  var item = { TimeType: type, IsHideDefault: false, AttachedObjects: {} };
  setItemTimes(item, start, addSeconds(start, durMin));
  if (type === 0) item.DefaultClassId = EMPTY_GUID;
  items.splice(at, 0, item);
  selectedItemIdx = at;
  dirty = true;
  commitUndo();
  renderTimeLayoutDetail(); runValidation();
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
  renderTimeLayoutDetail(); runValidation();
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
  renderTimeLayoutDetail(); runValidation();
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
  renderTimeLayoutDetail();
  alert(added > 0 ? ('已添加 ' + added + ' 个课间') : '没有可插入课间的相邻课程段');
}

// ================= 课表（按课表群分组，Classes 与时间表上课点对应） =================
function renderClassPlanList() {
  var list = $('ciClassPlanList');
  var html = '';
  var seen = {};
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
      return (cp.AssociatedGroup || DEFAULT_GROUP_GUID) === gid;
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
  persistViewState();
  renderClassPlanList(); renderClassPlanDetail();
}

var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function renderClassPlanDetail() {
  var box = $('ciClassPlanDetail');
  var cp = selectedClassPlanId ? profile.ClassPlans[selectedClassPlanId] : null;
  if (!cp) { box.innerHTML = '<div class="ci-empty">选择左侧课表以编辑</div>'; return; }
  if (!isPlainObject(cp.TimeRule)) cp.TimeRule = { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 0 };
  var rule = cp.TimeRule;
  if (!Array.isArray(cp.Classes)) cp.Classes = [];
  var tl = profile.TimeLayouts[cp.TimeLayoutId];
  var classPoints = tl && Array.isArray(tl.Layouts) ? tl.Layouts.filter(function (i) { return i.TimeType === 0; }) : [];

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
    classesHtml += '<div class="ci-class-row">' +
      '<span class="ci-idx">' + (i + 1) + '</span>' +
      timeCol +
      (cls
        ? '<select onchange="onClassChange(' + i + ',\'SubjectId\',this.value)">' + subjectOptionsHtml(cls.SubjectId, false) + '</select>'
        : '<span class="ci-class-extra">—</span>') +
      (cls
        ? '<button class="ci-row-del" title="删除此课程" onclick="removeClass(' + i + ')">×</button>'
        : '<span></span>') +
      '</div>';
  }

  var html = '<h3 class="ci-detail-title">课表设置</h3>' +
    '<div class="ci-form-grid">' +
    '<div class="ci-field"><label>课表名称</label><input value="' + escAttr(cp.Name || '') + '" oninput="onClassPlanField(\'Name\',this.value)" /></div>' +
    '<div class="ci-field"><label>关联时间表（TimeLayoutId）</label><select onchange="onClassPlanField(\'TimeLayoutId\',this.value)">' + timeLayoutOptions(cp.TimeLayoutId) + '</select></div>' +
    '<div class="ci-field"><label>启用星期（WeekDay）</label><select onchange="onRuleChange(\'WeekDay\',parseInt(this.value)||0)">' + weekdayOptions(rule.WeekDay) + '</select></div>' +
    '<div class="ci-field"><label>轮换总周数（WeekCountDivTotal）</label><select onchange="onRuleChange(\'WeekCountDivTotal\',parseInt(this.value)||0)">' + rotateTotalOptions(rule.WeekCountDivTotal) + '</select></div>' +
    '<div class="ci-field"><label>轮换第几周（WeekCountDiv）</label><select ' + (rule.WeekCountDivTotal > 0 ? '' : 'disabled') + ' onchange="onRuleChange(\'WeekCountDiv\',parseInt(this.value)||0)">' + rotateDivOptions(rule) + '</select></div>' +
    '<div class="ci-field"><label>所属课表群（AssociatedGroup）</label><select onchange="onClassPlanField(\'AssociatedGroup\',this.value)">' + groupOptions(cp.AssociatedGroup) + '</select></div>' +
    '<div class="ci-field"><label>启用（IsEnabled）</label><label style="display:inline-flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" ' + (cp.IsEnabled !== false ? 'checked' : '') + ' onchange="onClassPlanField(\'IsEnabled\',this.checked)" />在时间线上显示</label></div>' +
    '<div class="ci-field"><label>GUID</label><input class="ci-guid" value="' + escAttr(selectedClassPlanId) + '" readonly /></div>' +
    '</div>' +
    '<div class="ci-items-head"><span class="ci-panel-title">课程（Classes，与时间表上课点按顺序对应）</span>' +
    '<div class="ci-items-actions">' +
    '<button class="ci-btn small" onclick="syncClassesToLayout()" title="按时间表上课点数量补齐/保留课程行">对齐时间表</button>' +
    '<button class="ci-btn small" onclick="addClass()">+ 添加课程</button>' +
    '</div></div>' +
    classesHtml;
  box.innerHTML = html;
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
    html += '<option value="' + d + '"' + (d === selected ? ' selected' : '') + '>' + WEEKDAYS[d] + '</option>';
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
  renderAll();
}

function removeClassPlan(id) {
  if (!profile || !profile.ClassPlans[id]) return;
  if (!confirm('确认删除课表「' + (profile.ClassPlans[id].Name || id) + '」？')) return;
  delete profile.ClassPlans[id];
  if (selectedClassPlanId === id) selectedClassPlanId = null;
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
  dirty = true;
  commitUndo();
  switchView('classplans');
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

// ================= 源码视图 =================
function onRawInput() { rawDirty = true; dirty = true; }
function syncFromRaw() {
  var text = $('ciRaw').value;
  $('ciProfileName').disabled = false;
  if (!loadFromContent(text)) return;
  dirty = true;
  commitUndo();
}
function onGenericInput() {
  dirty = true;
  try {
    var obj = JSON.parse($('ciGeneric').value);
    if (isPlainObject(obj) && typeof obj.Name === 'string') { $('ciProfileName').value = obj.Name; $('ciProfileName').disabled = false; }
  } catch (e) { /* 保留输入 */ }
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
      case 'ci-format': if (isProfile) { $('ciRaw').value = JSON.stringify(profile, null, 4); switchView('raw'); } break;
      case 'ci-toggle-raw': if (isProfile) switchView(view === 'raw' ? 'classplans' : 'raw'); break;
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
  if (isProfile) {
    revalidateSelections();
    runValidation();
    switchView(view);
  }
})();
