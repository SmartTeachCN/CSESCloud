// 课表编辑器 - 参照 OrbiTeach 课表方案移植，适配 CSES 编辑器插件架构
// 数据以 JSON 存于文件内容，通过 window.CSEditor 与平台通信。
// 加载：CSEditor.file.content；保存：saveConfig() 调用 CSEditor.emitSave(json)。

var DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
var ROTATION_LABELS = { double: ['单周', '双周'], triple: ['单周组', '双周组', '余0组'], quad: ['A周', 'B周', 'C周', 'D周'] };
var ROTATION_NAMES = { double: '双周轮换', triple: '三周轮换', quad: '四周轮换' };
var COURSE_COLORS = ['#4f8ff7', '#34a853', '#ea4335', '#fbbc04', '#9c27b0', '#00bcd4', '#ff6d00', '#607d8b', '#e91e63', '#009688'];

var PRESET_COURSES = [
  { name: '语文', abbr: '语', color: '#ea4335' },
  { name: '数学', abbr: '数', color: '#4f8ff7' },
  { name: '英语', abbr: '英', color: '#34a853' },
  { name: '物理', abbr: '物', color: '#9c27b0' },
  { name: '化学', abbr: '化', color: '#00bcd4' },
  { name: '生物', abbr: '生', color: '#009688' },
  { name: '历史', abbr: '史', color: '#fbbc04' },
  { name: '地理', abbr: '地', color: '#ff6d00' },
  { name: '政治', abbr: '政', color: '#e91e63' },
  { name: '体育', abbr: '体', color: '#607d8b' },
  { name: '音乐', abbr: '音', color: '#ab47bc' },
  { name: '美术', abbr: '美', color: '#26a69a' },
  { name: '信息技术', abbr: '信', color: '#42a5f5' },
  { name: '劳动', abbr: '劳', color: '#8d6e63' },
  { name: '心理健康', abbr: '心', color: '#ec407a' },
  { name: '班会', abbr: '班', color: '#78909c' },
  { name: '自习', abbr: '自', color: '#546e7a' },
  { name: '综合实践', abbr: '综', color: '#66bb6a' }
];

// ---- 数据（内存态）----
var timetables = [];
var courses = [];
var schedule = {};
var dayTimetables = {};
var dayRotations = {};
var nextCourseId = 1;
var nextTimetableId = 1;
var selectedDay = 0;
var editingSelection = {};
var currentRotationWeek = 0;
var rotationOffset = 0;
var semesterStart = '';
var scheduleViewMode = 'full';
var dirty = false;

var selectedTimetableId = null;
var activeTab = 'schedule';
var focusCell = null;
var libSearchQuery = '';
var libSelectedIds = {};
var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

function el(id) { return document.getElementById(id); }

// 从文件内容加载数据
function loadData() {
  var raw = (window.CSEditor && window.CSEditor.file && window.CSEditor.file.content) || '';
  var obj = null;
  if (raw) { try { obj = JSON.parse(raw); } catch (e) { } }
  obj = (obj && typeof obj === 'object') ? obj : {};
  timetables = Array.isArray(obj.timetables) ? obj.timetables : [];
  courses = Array.isArray(obj.courses) ? obj.courses : [];
  schedule = (obj.schedule && typeof obj.schedule === 'object') ? obj.schedule : {};
  dayTimetables = (obj.dayTimetables && typeof obj.dayTimetables === 'object') ? obj.dayTimetables : {};
  dayRotations = (obj.dayRotations && typeof obj.dayRotations === 'object') ? obj.dayRotations : {};
  nextCourseId = obj.nextCourseId || 1;
  nextTimetableId = obj.nextTimetableId || 1;
  selectedDay = (obj.selectedDay == null) ? 0 : obj.selectedDay;
  editingSelection = (obj.editingSelection && typeof obj.editingSelection === 'object') ? obj.editingSelection : {};
  currentRotationWeek = obj.currentRotationWeek || 0;
  rotationOffset = obj.rotationOffset || 0;
  semesterStart = obj.semesterStart || '';
  scheduleViewMode = obj.scheduleViewMode || 'full';

  if (!timetables.length) {
    timetables.push({
      id: nextTimetableId++, name: '默认时间表',
      periods: [
        { name: '第1节', start: '08:00', end: '08:45' }, { name: '第2节', start: '08:55', end: '09:40' },
        { name: '第3节', start: '10:00', end: '10:45' }, { name: '第4节', start: '10:55', end: '11:40' },
        { name: '第5节', start: '14:00', end: '14:45' }, { name: '第6节', start: '14:55', end: '15:40' },
        { name: '第7节', start: '16:00', end: '16:45' }, { name: '第8节', start: '16:55', end: '17:40' }
      ]
    });
  }
  if (Object.keys(editingSelection).length === 0) editingSelection[String(selectedDay)] = true;
}

function markDirty() {
  dirty = true;
  var s = el('csn-status');
  if (s) { s.className = 'csn-status dirty'; s.textContent = '● 未保存修改 (Ctrl+S)'; }
}

// 保存：将完整课表 JSON 写回文件
function saveConfig() {
  var schema = {
    timetables: timetables,
    courses: courses,
    schedule: schedule,
    dayTimetables: dayTimetables,
    dayRotations: dayRotations,
    nextCourseId: nextCourseId,
    nextTimetableId: nextTimetableId,
    selectedDay: selectedDay,
    editingSelection: editingSelection,
    currentRotationWeek: currentRotationWeek,
    rotationOffset: rotationOffset,
    semesterStart: semesterStart,
    scheduleViewMode: scheduleViewMode
  };
  var json = JSON.stringify(schema, null, 2);
  if (window.CSEditor) {
    if (window.CSEditor.emitSave) window.CSEditor.emitSave(json);
    else if (window.CSEditor.saveContent) window.CSEditor.saveContent(json);
    else if (window.CSEditor.request) window.CSEditor.request('save', { content: json });
  }
  dirty = false;
  var s = el('csn-status');
  if (s) { s.className = 'csn-status ok'; s.textContent = '✓ 已保存'; setTimeout(function () { if (el('csn-status')) { el('csn-status').textContent = ''; el('csn-status').className = 'csn-status'; } }, 2000); }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

// ==================== Tab 切换 ====================
function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.csn-panel').forEach(function (p) { p.classList.remove('active'); });
  el('csn-panel-' + name).classList.add('active');
  document.querySelectorAll('.csn-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.panel === name); });
  el('csn-ribbon-schedule').style.display = name === 'schedule' ? 'flex' : 'none';
  el('csn-ribbon-courselib').style.display = name === 'courselib' ? 'flex' : 'none';
  el('csn-ribbon-timetable').style.display = name === 'timetable' ? 'flex' : 'none';
  el('csn-editing-bar').style.display = name === 'schedule' ? 'flex' : 'none';
  if (name === 'schedule') { renderSchedule(); renderCourseLibrary(); renderEditingAreaBar(); populateDayTimetableSelect(); updateEditingCard(); renderRotationWeekSelector(); renderViewToggle(); }
  if (name === 'courselib') renderCourseLibraryPanel();
  if (name === 'timetable') { renderTimetableList(); if (selectedTimetableId) renderTimetableEditor(); }
}

document.querySelectorAll('.csn-tab').forEach(function (t) {
  t.addEventListener('click', function () { switchTab(t.dataset.panel); });
});

// ==================== 右键菜单 ====================
var contextMenu = el('csn-ctx');
function showContextMenu(items, x, y) {
  contextMenu.innerHTML = items.map(function (item) {
    var cls = 'csn-ctx-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
    return '<div class="' + cls + '" data-action="' + item.action + '">' +
      (item.icon ? '<i class="' + item.icon + '"></i>' : '') + '<span>' + item.label + '</span></div>';
  }).join('');
  contextMenu.style.left = '0px'; contextMenu.style.top = '0px';
  contextMenu.classList.remove('hidden');
  var mw = contextMenu.offsetWidth, mh = contextMenu.offsetHeight;
  var vw = window.innerWidth, vh = window.innerHeight;
  if (x + mw > vw - 4) x = Math.max(4, vw - mw - 4);
  if (y + mh > vh - 4) y = Math.max(4, vh - mh - 4);
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  contextMenu.style.left = x + 'px'; contextMenu.style.top = y + 'px';
  contextMenu.querySelectorAll('.csn-ctx-item:not(.disabled)').forEach(function (menuEl) {
    menuEl.addEventListener('click', function (e) {
      e.stopPropagation(); hideContextMenu();
      var action = menuEl.dataset.action;
      items.forEach(function (item) { if (item.action === action && item.handler) item.handler(); });
    });
  });
  setTimeout(function () { document.addEventListener('click', hideContextMenu, { once: true }); }, 0);
}
function hideContextMenu() { contextMenu.classList.add('hidden'); }

// ==================== 弹窗 ====================
function showModal(title, bodyHtml, onSave) {
  el('csn-modal-title').textContent = title;
  el('csn-modal-body').innerHTML = bodyHtml;
  el('csn-modal').classList.remove('hidden');
  el('csn-modal-save').onclick = function () { onSave(); el('csn-modal').classList.add('hidden'); };
}
el('csn-modal-close').addEventListener('click', function () { el('csn-modal').classList.add('hidden'); });
el('csn-modal-cancel').addEventListener('click', function () { el('csn-modal').classList.add('hidden'); });
el('csn-modal-overlay').addEventListener('click', function () { el('csn-modal').classList.add('hidden'); });

// ==================== 课程库（侧栏）====================
function renderCourseLibrary() {
  var list = el('csn-library-list'); if (!list) return;
  if (!courses.length) {
    list.innerHTML = '<div style="color:var(--csn-text3);text-align:center;padding:16px;font-size:12px;">暂无课程，点击 + 添加</div>';
    return;
  }
  list.innerHTML = courses.map(function (c) {
    return '<div class="csn-lib-item" data-cid="' + c.id + '" draggable="true">' +
      '<span class="course-color" style="background:' + esc(c.color) + '"></span>' +
      '<span class="course-name">' + esc(c.name) + '</span>' +
      '<button class="course-del" data-cid="' + c.id + '" title="删除课程"><i class="ri-close-line"></i></button></div>';
  }).join('');
  list.querySelectorAll('.csn-lib-item').forEach(function (item) {
    item.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/course-id', item.dataset.cid);
      e.dataTransfer.setData('text/from', 'library'); e.dataTransfer.effectAllowed = 'copyMove';
    });
  });
  list.querySelectorAll('.course-del').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); deleteCourse(parseInt(btn.dataset.cid)); });
  });
}

function renderColorPresets(selectedColor) {
  return COURSE_COLORS.map(function (clr) {
    return '<div class="csn-form-color' + (clr === selectedColor ? ' active' : '') + '" data-color="' + clr + '" style="background:' + clr + '"></div>';
  }).join('') + '<input type="hidden" id="f-course-color" value="' + esc(selectedColor || COURSE_COLORS[0]) + '">';
}

function bindColorPresets() {
  setTimeout(function () {
    var presets = document.querySelectorAll('#f-color-presets .csn-form-color');
    presets.forEach(function (p) {
      p.addEventListener('click', function () {
        presets.forEach(function (pp) { pp.classList.remove('active'); });
        p.classList.add('active'); el('f-course-color').value = p.dataset.color;
      });
    });
  }, 50);
}

function addCourse() {
  showModal('添加课程',
    '<div class="csn-form-group"><label>课程名称</label><input id="f-course-name" placeholder="如：语文"></div>' +
    '<div class="csn-form-row">' +
      '<div class="csn-form-group"><label>简称（1-2字）</label><input id="f-course-abbr" maxlength="2" placeholder="如：语"></div>' +
      '<div class="csn-form-group"><label>任课教师（可选）</label><input id="f-course-teacher" placeholder="如：张老师"></div>' +
    '</div>' +
    '<div class="csn-form-group"><label>颜色标识</label><div class="csn-form-color-presets" id="f-color-presets">' + renderColorPresets(COURSE_COLORS[0]) + '</div></div>',
    function () {
      var name = el('f-course-name').value.trim(); if (!name) return;
      var abbr = el('f-course-abbr').value.trim() || name.charAt(0);
      courses.push({ id: nextCourseId++, name: name, abbr: abbr, color: el('f-course-color').value, teacher: el('f-course-teacher').value.trim() });
      markDirty(); renderCourseLibrary(); renderSchedule();
      if (activeTab === 'courselib') renderCourseLibraryPanel();
    });
  bindColorPresets();
}

function editCourse(cid) {
  var c = courses.find(function (co) { return co.id === cid; }); if (!c) return;
  showModal('编辑课程',
    '<div class="csn-form-group"><label>课程名称</label><input id="f-course-name" value="' + esc(c.name) + '"></div>' +
    '<div class="csn-form-row">' +
      '<div class="csn-form-group"><label>简称（1-2字）</label><input id="f-course-abbr" maxlength="2" value="' + esc(c.abbr || '') + '" placeholder="' + esc(c.name.charAt(0)) + '"></div>' +
      '<div class="csn-form-group"><label>任课教师</label><input id="f-course-teacher" value="' + esc(c.teacher || '') + '"></div>' +
    '</div>' +
    '<div class="csn-form-group"><label>颜色标识</label><div class="csn-form-color-presets" id="f-color-presets">' + renderColorPresets(c.color) + '</div></div>',
    function () {
      var name = el('f-course-name').value.trim(); if (!name) return;
      c.name = name; c.abbr = el('f-course-abbr').value.trim() || name.charAt(0);
      c.color = el('f-course-color').value; c.teacher = el('f-course-teacher').value.trim();
      markDirty(); renderCourseLibrary(); renderSchedule();
      if (activeTab === 'courselib') renderCourseLibraryPanel();
    });
  bindColorPresets();
}

function deleteCourse(cid) {
  var c = courses.find(function (co) { return co.id === cid; }); if (!c) return;
  if (!confirm('确定删除课程"' + c.name + '"？课表中该课程也将被移除。')) return;
  courses = courses.filter(function (co) { return co.id !== cid; });
  Object.keys(schedule).forEach(function (k) { if (schedule[k] === cid) delete schedule[k]; });
  markDirty(); renderCourseLibrary(); renderSchedule();
  if (activeTab === 'courselib') renderCourseLibraryPanel();
}

el('csn-add-course').addEventListener('click', addCourse);
el('csn-library-add').addEventListener('click', addCourse);
el('csn-lib-add-course').addEventListener('click', function () {
  addCourse();
  setTimeout(function () { if (activeTab === 'courselib') renderCourseLibraryPanel(); }, 200);
});

el('csn-preset-courses').addEventListener('click', function () {
  var existingNames = courses.map(function (c) { return c.name; });
  var newPresets = PRESET_COURSES.filter(function (p) { return existingNames.indexOf(p.name) === -1; });
  if (!newPresets.length) { alert('预设课程已全部存在，无需导入。'); return; }
  if (!confirm('将导入 ' + newPresets.length + ' 门预设课程（已存在的将跳过），确定？')) return;
  newPresets.forEach(function (p) { courses.push({ id: nextCourseId++, name: p.name, abbr: p.abbr, color: p.color, teacher: '' }); });
  markDirty(); renderCourseLibrary(); renderSchedule();
  if (activeTab === 'courselib') renderCourseLibraryPanel();
});

el('csn-clear-schedule').addEventListener('click', function () {
  if (!confirm('确定清空整个课表的所有课程？')) return;
  schedule = {}; markDirty(); renderSchedule();
});

el('csn-export-schedule').addEventListener('click', function () {
  var output = '课表导出\n\n';
  DAY_NAMES.forEach(function (day, di) {
    var rot = getRotationCount(di);
    output += day + (rot > 1 ? ' [' + (ROTATION_NAMES[getRotationType(di)] || '') + ']' : '') + ':\n';
    var subCols = rot;
    for (var w = 0; w < subCols; w++) {
      var prefix = subCols > 1 ? '  ' + (ROTATION_LABELS[getRotationType(di)] || [])[w] + ':\n' : '';
      var periods = getPeriodsForDayWeek(di, w);
      if (prefix) output += prefix;
      if (periods.length) {
        var tt = getTimetableForDayWeek(di, w);
        if (tt && subCols > 1) output += '    时间表：' + tt.name + '\n';
        periods.forEach(function (p, pi) {
          var key = getScheduleKey(di, pi, w);
          var cid = schedule[key];
          var c = cid ? courses.find(function (co) { return co.id === cid; }) : null;
          output += '    ' + p.name + ' (' + p.start + '-' + p.end + '): ' + (c ? c.name : '（空）') + '\n';
        });
      }
    }
    output += '\n';
  });
  navigator.clipboard.writeText(output).then(function () { alert('课表已复制到剪贴板！'); }).catch(function () { alert(output); });
});

// ==================== 课程库面板 ====================
function getCourseUsageCount(cid) {
  var count = 0;
  Object.keys(schedule).forEach(function (k) { if (schedule[k] === cid) count++; });
  return count;
}

function renderCourseLibraryPanel() {
  var grid = el('csn-courselib-grid'); if (!grid) return;
  var search = (libSearchQuery || '').toLowerCase();
  var filtered = courses.filter(function (c) {
    if (!search) return true;
    return c.name.toLowerCase().indexOf(search) >= 0 || (c.teacher || '').toLowerCase().indexOf(search) >= 0;
  });
  if (!filtered.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--csn-text3);">' +
      '<i class="ri-book-open-line" style="font-size:40px;display:block;margin-bottom:12px;"></i>' +
      (courses.length ? '没有匹配的课程' : '暂无课程，点击上方"添加课程"按钮开始创建') + '</div>';
    el('csn-courselib-count').textContent = '共 0 门课程';
    return;
  }
  grid.innerHTML = filtered.map(function (c) {
    var usage = getCourseUsageCount(c.id);
    var checked = !!libSelectedIds[c.id];
    return '<div class="csn-courselib-card' + (checked ? ' selected' : '') + '" data-cid="' + c.id + '">' +
      '<div class="clib-check' + (checked ? ' checked' : '') + '" data-cid="' + c.id + '">' + (checked ? '<i class="ri-check-line"></i>' : '') + '</div>' +
      '<div class="clib-color" style="background:' + esc(c.color) + '"></div>' +
      '<div class="clib-info"><div class="clib-name">' + esc(c.name) + '</div>' +
      (c.teacher ? '<div class="clib-teacher">' + esc(c.teacher) + '</div>' : '') + '</div>' +
      '<span class="clib-usage">课表 ' + usage + ' 节</span>' +
      '<div class="clib-actions">' +
        '<button class="clib-btn" data-action="edit" data-cid="' + c.id + '" title="编辑课程"><i class="ri-edit-line"></i></button>' +
        '<button class="clib-btn danger" data-action="del" data-cid="' + c.id + '" title="删除课程"><i class="ri-delete-bin-line"></i></button>' +
      '</div></div>';
  }).join('');
  el('csn-courselib-count').textContent = '共 ' + filtered.length + ' 门课程' + (search ? '（搜索过滤）' : '');

  grid.querySelectorAll('.clib-check').forEach(function (chk) {
    chk.addEventListener('click', function (e) {
      e.stopPropagation();
      var cid = parseInt(chk.dataset.cid);
      if (libSelectedIds[cid]) delete libSelectedIds[cid]; else libSelectedIds[cid] = true;
      renderCourseLibraryPanel(); updateLibBatchDeleteBtn();
    });
  });
  grid.querySelectorAll('.csn-courselib-card').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('.clib-btn') || e.target.closest('.clib-check')) return;
      var cid = parseInt(card.dataset.cid);
      if (libSelectedIds[cid]) delete libSelectedIds[cid]; else libSelectedIds[cid] = true;
      renderCourseLibraryPanel(); updateLibBatchDeleteBtn();
    });
  });
  grid.querySelectorAll('.clib-btn[data-action="edit"]').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); editCourse(parseInt(btn.dataset.cid)); });
  });
  grid.querySelectorAll('.clib-btn[data-action="del"]').forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.stopPropagation(); deleteCourse(parseInt(btn.dataset.cid)); });
  });
}

function updateLibBatchDeleteBtn() {
  var count = Object.keys(libSelectedIds).length;
  var btn = el('csn-lib-batch-del');
  btn.disabled = count === 0;
  var btn2 = el('csn-sel-del');
  if (btn2) { btn2.disabled = count === 0; btn2.innerHTML = count > 0 ? '<i class="ri-delete-bin-line"></i> 删除选中（' + count + '）' : '<i class="ri-delete-bin-line"></i> 删除选中'; }
}

function batchDeleteCourses() {
  var ids = Object.keys(libSelectedIds);
  if (!ids.length) return;
  var count = ids.length;
  if (!confirm('确定删除选中的 ' + count + ' 门课程？课表中这些课程也将被移除。')) return;
  ids.forEach(function (idStr) {
    var cid = parseInt(idStr);
    courses = courses.filter(function (co) { return co.id !== cid; });
    Object.keys(schedule).forEach(function (k) { if (schedule[k] === cid) delete schedule[k]; });
  });
  libSelectedIds = {};
  markDirty(); renderCourseLibraryPanel(); renderCourseLibrary(); renderSchedule();
}

el('csn-lib-batch-del').addEventListener('click', batchDeleteCourses);
el('csn-sel-del').addEventListener('click', batchDeleteCourses);
el('csn-sel-all').addEventListener('click', function () {
  var allSelected = courses.every(function (c) { return !!libSelectedIds[c.id]; });
  libSelectedIds = {};
  if (!allSelected) courses.forEach(function (c) { libSelectedIds[c.id] = true; });
  renderCourseLibraryPanel(); updateLibBatchDeleteBtn();
});
el('csn-lib-search').addEventListener('input', function () {
  libSearchQuery = this.value;
  if (activeTab === 'courselib') renderCourseLibraryPanel();
});

// ==================== 轮换辅助 ====================
function getRotationCount(dayIndex) {
  var type = dayRotations[String(dayIndex)];
  if (type === 'double') return 2; if (type === 'triple') return 3; if (type === 'quad') return 4;
  return 1;
}
function getRotationType(dayIndex) { return dayRotations[String(dayIndex)] || null; }

function getScheduleKey(dayIndex, periodIndex, weekIndex) {
  var rot = getRotationCount(dayIndex);
  if (rot > 1) return dayIndex + '-' + periodIndex + '-' + weekIndex;
  return dayIndex + '-' + periodIndex;
}

function getTimetableForDayWeek(dayIndex, weekIndex) {
  var wkKey = String(dayIndex) + '-' + String(weekIndex);
  var ttId = dayTimetables[wkKey];
  if (ttId) return timetables.find(function (t) { return t.id === ttId; });
  var dayKey = String(dayIndex);
  ttId = dayTimetables[dayKey];
  if (ttId) return timetables.find(function (t) { return t.id === ttId; });
  return timetables.length ? timetables[0] : null;
}

function getTimetableForDay(dayIndex) {
  var ttId = dayTimetables[String(dayIndex)];
  if (ttId) return timetables.find(function (t) { return t.id === ttId; });
  return timetables.length ? timetables[0] : null;
}

function getPeriodsForDayWeek(dayIndex, weekIndex) {
  var tt = getTimetableForDayWeek(dayIndex, weekIndex);
  return tt ? tt.periods : [];
}

function getTimetableIdForDayWeek(dayIndex, weekIndex) {
  var wkKey = String(dayIndex) + '-' + String(weekIndex);
  if (dayTimetables[wkKey] != null) return dayTimetables[wkKey];
  var dayKey = String(dayIndex);
  if (dayTimetables[dayKey] != null) return dayTimetables[dayKey];
  return timetables.length ? timetables[0].id : null;
}

function getTimetableIdForDay(dayIndex) {
  if (dayTimetables[String(dayIndex)] != null) return dayTimetables[String(dayIndex)];
  return timetables.length ? timetables[0].id : null;
}

function getMaxPeriodCount() {
  var max = 0;
  for (var d = 0; d < 7; d++) {
    var rot = getRotationCount(d);
    for (var w = 0; w < rot; w++) { var p = getPeriodsForDayWeek(d, w); if (p.length > max) max = p.length; }
  }
  return max;
}

function getTimeRangeForPeriodIndex(pi) {
  var ranges = [];
  for (var d = 0; d < 7; d++) {
    var rot = getRotationCount(d);
    for (var w = 0; w < rot; w++) {
      var periods = getPeriodsForDayWeek(d, w);
      if (pi < periods.length) { var key = periods[pi].start + '-' + periods[pi].end; if (ranges.indexOf(key) === -1) ranges.push(key); }
    }
  }
  return ranges;
}

function getDayTimeRange(dayIndex, pi) {
  var ranges = [];
  var rot = getRotationCount(dayIndex);
  for (var w = 0; w < rot; w++) {
    var periods = getPeriodsForDayWeek(dayIndex, w);
    if (pi < periods.length) { var key = periods[pi].start + '-' + periods[pi].end; if (ranges.indexOf(key) === -1) ranges.push(key); }
  }
  return ranges;
}

// ==================== 编辑区域栏 ====================
function renderEditingAreaBar() {
  var chips = el('csn-chips'); if (!chips) return;
  var html = '';
  var allSelected = true;
  for (var d = 0; d < 7; d++) {
    var rot = getRotationCount(d);
    for (var w = 0; w < rot; w++) {
      var key = rot > 1 ? (d + '-' + w) : String(d);
      if (!editingSelection[key]) { allSelected = false; break; }
    }
    if (!allSelected) break;
  }
  html += '<button class="csn-chip' + (allSelected ? ' active' : '') + '" data-ea="all">全选</button>';
  for (var di = 0; di < 7; di++) {
    var rot2 = getRotationCount(di);
    var daySel = true;
    for (var w2 = 0; w2 < rot2; w2++) { var k2 = rot2 > 1 ? (di + '-' + w2) : String(di); if (!editingSelection[k2]) { daySel = false; break; } }
    html += '<button class="csn-chip day' + (daySel ? ' active' : '') + '" data-ea="d' + di + '">' + DAY_NAMES[di] + '</button>';
    if (rot2 > 1) {
      var labels = ROTATION_LABELS[getRotationType(di)] || [];
      for (var w3 = 0; w3 < rot2; w3++) {
        var k3 = di + '-' + w3;
        var sel3 = !!editingSelection[k3];
        var tt = getTimetableForDayWeek(di, w3);
        html += '<button class="csn-chip week' + (sel3 ? ' active' : '') + '" data-ea="' + k3 + '" title="' + (tt ? tt.name : '') + '">' + esc(labels[w3]) + '</button>';
      }
    }
  }
  chips.innerHTML = html;
  chips.querySelectorAll('.csn-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var target = chip.dataset.ea;
      if (target === 'all') {
        var anyOff = false;
        for (var d = 0; d < 7; d++) { var rot = getRotationCount(d); for (var w = 0; w < rot; w++) { var key = rot > 1 ? (d + '-' + w) : String(d); if (!editingSelection[key]) { anyOff = true; break; } } if (anyOff) break; }
        for (var dd = 0; dd < 7; dd++) { var rot2 = getRotationCount(dd); for (var w2 = 0; w2 < rot2; w2++) { var k = rot2 > 1 ? (dd + '-' + w2) : String(dd); editingSelection[k] = anyOff ? true : false; } }
      } else if (target.indexOf('-') >= 0) {
        editingSelection[target] = !editingSelection[target];
      } else if (target.indexOf('d') === 0) {
        var dayIdx = parseInt(target.substring(1));
        var rot3 = getRotationCount(dayIdx);
        var dayAnyOff = false;
        for (var w4 = 0; w4 < rot3; w4++) { var k4 = rot3 > 1 ? (dayIdx + '-' + w4) : String(dayIdx); if (!editingSelection[k4]) { dayAnyOff = true; break; } }
        for (var w5 = 0; w5 < rot3; w5++) { var k5 = rot3 > 1 ? (dayIdx + '-' + w5) : String(dayIdx); editingSelection[k5] = dayAnyOff ? true : false; }
      }
      markDirty(); renderEditingAreaBar(); updateEditingCard(); populateDayTimetableSelect();
    });
  });
}

function updateEditingCard() {
  var card = el('csn-editing-text'); if (!card) return;
  var parts = [];
  for (var d = 0; d < 7; d++) {
    var rot = getRotationCount(d);
    for (var w = 0; w < rot; w++) {
      var key = rot > 1 ? (d + '-' + w) : String(d);
      if (editingSelection[key]) {
        var tt = getTimetableForDayWeek(d, w);
        var label = DAY_NAMES[d];
        if (rot > 1) label += (ROTATION_LABELS[getRotationType(d)] || [])[w];
        parts.push(label + '[' + (tt ? tt.name : '无') + ']');
      }
    }
  }
  if (!parts.length) card.textContent = '未选择编辑区域';
  else if (parts.length <= 2) card.textContent = '编辑：' + parts.join('、');
  else card.textContent = '编辑 ' + parts.length + ' 个区域';
}

// ==================== 课表网格 ====================
function renderSchedule() {
  updateEditingCard();
  var maxPeriods = getMaxPeriodCount();
  var grid = el('csn-grid'); if (!grid) return;
  if (maxPeriods === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--csn-text3);font-size:14px;">尚未创建时间表，请先在「时间表」Tab 中创建</div>';
    return;
  }
  var dayCols = [];
  var totalSubCols = 0;
  var visibleDays = [];
  var acWeek = calcAcademicWeek();
  for (var d = 0; d < 7; d++) {
    var cnt = getRotationCount(d); dayCols.push(cnt);
    visibleDays.push(d);
    if (scheduleViewMode === 'compact' && cnt > 1) totalSubCols += 1; else totalSubCols += cnt;
  }
  if (totalSubCols === 0) totalSubCols = 7;
  grid.style.gridTemplateColumns = '90px repeat(' + totalSubCols + ', 1fr)';
  var html = '';

  // 行1：天头
  html += '<div class="csn-corner"></div>';
  for (var vi = 0; vi < visibleDays.length; vi++) {
    var di = visibleDays[vi];
    var sc = dayCols[di];
    var isCompact = scheduleViewMode === 'compact' && sc > 1;
    var span = isCompact ? 1 : sc;
    var style = span > 1 ? 'grid-column:span ' + span + ';' : '';
    var isActive = di === selectedDay ? ' active-day' : '';
    var tt = getTimetableForDay(di);
    var ttName = tt ? esc(tt.name) : '';
    html += '<div class="csn-day-header' + isActive + '" style="' + style + '" data-day="' + di + '" data-ttid="' + (tt ? tt.id : '') + '">' +
      '<span class="day-name">' + DAY_NAMES[di] + '</span>' +
      (ttName ? '<span class="day-tt">' + ttName + '</span>' : '') +
      '<button class="csn-day-menu" data-day="' + di + '"><i class="ri-arrow-down-s-line"></i></button></div>';
  }
  // 行2：子表头
  html += '<div class="csn-corner sub"></div>';
  for (var vi2 = 0; vi2 < visibleDays.length; vi2++) {
    var di2 = visibleDays[vi2];
    var sc2 = dayCols[di2];
    var rotType = getRotationType(di2);
    var isCompact2 = scheduleViewMode === 'compact' && sc2 > 1;
    if (sc2 === 1 || isCompact2) {
      var activeWk = 0;
      if (isCompact2 && acWeek >= 1) activeWk = ((acWeek + rotationOffset - 1) % sc2 + sc2) % sc2;
      var tt2 = getTimetableForDayWeek(di2, activeWk);
      var ttName2 = tt2 ? esc(tt2.name) : '';
      var refDay = getTimetableForDay(di2);
      if (sc2 === 1) {
        html += '<div class="csn-sub-header" data-day="' + di2 + '"><span class="sub-header-text">无轮换</span>' +
          (ttName2 && (tt2 ? tt2.name : '') !== '' ? '<span class="sub-header-tt">' + ttName2 + '</span>' : '') +
          '<button class="csn-sub-add" data-day="' + di2 + '"><i class="ri-add-line"></i></button></div>';
      } else {
        var labels = ROTATION_LABELS[rotType] || [];
        html += '<div class="csn-sub-header rot" data-day="' + di2 + '" data-week="' + activeWk + '"><span class="sub-header-text">' + esc(labels[activeWk]) + '</span>' +
          (ttName2 && refDay && tt2 && tt2.name !== refDay.name ? '<span class="sub-header-tt">' + ttName2 + '</span>' : '') +
          '<button class="csn-sub-menu" data-day="' + di2 + '"><i class="ri-arrow-down-s-line"></i></button></div>';
      }
    } else {
      var labels = ROTATION_LABELS[rotType] || [];
      var refDay2 = getTimetableForDay(di2);
      for (var w = 0; w < sc2; w++) {
        var ttWk = getTimetableForDayWeek(di2, w);
        html += '<div class="csn-sub-header rot" data-day="' + di2 + '" data-week="' + w + '"><span class="sub-header-text">' + esc(labels[w]) + '</span>' +
          (ttWk && refDay2 && ttWk.name !== refDay2.name ? '<span class="sub-header-tt">' + esc(ttWk.name) + '</span>' : '') +
          '<button class="csn-sub-menu" data-day="' + di2 + '"><i class="ri-arrow-down-s-line"></i></button></div>';
      }
    }
  }
  // 数据行
  for (var pi = 0; pi < maxPeriods; pi++) {
    var timeRanges = getTimeRangeForPeriodIndex(pi);
    var selDayRanges = getDayTimeRange(selectedDay, pi);
    var selRangeSet = {};
    selDayRanges.forEach(function (r) { selRangeSet[r] = true; });
    var timeHtml = timeRanges.map(function (tr) {
      var parts = tr.split('-');
      return '<span class="csnp-time' + (selRangeSet[tr] ? ' sel' : '') + '">' + esc(parts[0]) + ' - ' + esc(parts[1]) + '</span>';
    }).join('');
    var ttForDay = getTimetableForDayWeek(selectedDay, 0);
    html += '<div class="csn-period-header-cell" data-day="' + selectedDay + '" data-ttid="' + (ttForDay ? ttForDay.id : '') + '"><span class="csnp-name">第' + (pi + 1) + '节</span>' + timeHtml + '</div>';

    for (var vi3 = 0; vi3 < visibleDays.length; vi3++) {
      var di3 = visibleDays[vi3];
      var isActiveDay = di3 === selectedDay;
      var sc3 = dayCols[di3];
      var isCompact3 = scheduleViewMode === 'compact' && sc3 > 1;
      var maxW3 = isCompact3 ? 1 : sc3;
      for (var w3i = 0; w3i < maxW3; w3i++) {
        var w3 = (isCompact3 && acWeek >= 1) ? ((acWeek + rotationOffset - 1) % sc3 + sc3) % sc3 : w3i;
        var dPeriods = getPeriodsForDayWeek(di3, w3);
        if (pi < dPeriods.length) {
          var key = getScheduleKey(di3, pi, w3);
          var cid = schedule[key];
          var c = cid ? courses.find(function (co) { return co.id === cid; }) : null;
          var cellCls = 'csn-cell';
          if (isActiveDay) cellCls += ' active-col';
          if (sc3 > 1) { cellCls += ' rot'; if (w3 === 0) cellCls += ' first'; if (w3 === sc3 - 1) cellCls += ' last'; }
          if (focusCell && focusCell.day === di3 && focusCell.period === pi && focusCell.week === w3) cellCls += ' focused';
          html += '<div class="' + cellCls + '" data-day="' + di3 + '" data-period="' + pi + '" data-week="' + w3 + '"' + (c ? ' draggable="true"' : '') + '>' +
            (c ? '<div class="cell-course" style="background:' + esc(c.color) + '20;border-left:3px solid ' + esc(c.color) + '">' +
              '<span class="course-dot" style="background:' + esc(c.color) + '"></span>' +
              '<span class="course-text">' + esc(c.name) + '</span>' +
              '<button class="course-menu" data-day="' + di3 + '" data-period="' + pi + '" data-week="' + w3 + '"><i class="ri-more-fill"></i></button></div>' : '') + '</div>';
        } else {
          html += '<div class="csn-cell disabled" data-day="' + di3 + '" data-period="' + pi + '" data-week="' + w3 + '"></div>';
        }
      }
    }
  }
  grid.innerHTML = html;

  // 天头菜单
  grid.querySelectorAll('.csn-day-menu').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var d = parseInt(btn.dataset.day);
      var tt = getTimetableForDay(d);
      showContextMenu([
        { label: '编辑：' + DAY_NAMES[d], icon: 'ri-edit-line', action: 'edit', handler: function () { selectedDay = d; markDirty(); renderSchedule(); renderEditingAreaBar(); populateDayTimetableSelect(); } },
        { label: '跳转时间表' + (tt ? '（' + tt.name + '）' : ''), icon: 'ri-time-line', action: 'tt', handler: function () { selectedDay = d; markDirty(); if (tt) selectedTimetableId = tt.id; switchTab('timetable'); } },
        { label: '清除该天所有课程', icon: 'ri-delete-bin-line', action: 'clear', danger: true, handler: function () { clearDay(d); } }
      ], e.clientX, e.clientY);
    });
  });
  grid.querySelectorAll('.csn-day-header').forEach(function (hdr) {
    hdr.addEventListener('click', function (e) {
      if (e.target.closest('.csn-day-menu')) return;
      var d = parseInt(hdr.dataset.day);
      selectedDay = d; editingSelection = {};
      var rot = getRotationCount(d);
      if (rot > 1) for (var w = 0; w < rot; w++) editingSelection[d + '-' + w] = true; else editingSelection[String(d)] = true;
      markDirty(); renderSchedule(); renderEditingAreaBar(); populateDayTimetableSelect();
    });
  });
  // 子表头添加/菜单
  grid.querySelectorAll('.csn-sub-add').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var d = parseInt(btn.dataset.day);
      showContextMenu([
        { label: '双周轮换', icon: 'ri-arrow-left-right-line', action: 'double', handler: function () { setRotation(d, 'double'); } },
        { label: '三周轮换', icon: 'ri-arrow-left-right-line', action: 'triple', handler: function () { setRotation(d, 'triple'); } },
        { label: '四周轮换', icon: 'ri-arrow-left-right-line', action: 'quad', handler: function () { setRotation(d, 'quad'); } }
      ], e.clientX, e.clientY);
    });
  });
  grid.querySelectorAll('.csn-sub-menu').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var d = parseInt(btn.dataset.day);
      showContextMenu([
        { label: '修改为双周轮换', icon: 'ri-arrow-left-right-line', action: 'double', handler: function () { setRotation(d, 'double'); } },
        { label: '修改为三周轮换', icon: 'ri-arrow-left-right-line', action: 'triple', handler: function () { setRotation(d, 'triple'); } },
        { label: '修改为四周轮换', icon: 'ri-arrow-left-right-line', action: 'quad', handler: function () { setRotation(d, 'quad'); } },
        { label: '取消轮换', icon: 'ri-close-circle-line', action: 'none', danger: true, handler: function () { removeRotation(d); } }
      ], e.clientX, e.clientY);
    });
  });
  // 左列节次头：跳转时间表
  grid.querySelectorAll('.csn-period-header-cell').forEach(function (ph) {
    ph.addEventListener('click', function () {
      var d = parseInt(ph.dataset.day); var ttId = ph.dataset.ttid;
      selectedDay = d; markDirty();
      if (ttId) selectedTimetableId = parseInt(ttId);
      switchTab('timetable');
    });
  });
  // 数据单元格
  grid.querySelectorAll('.csn-cell:not(.disabled)').forEach(function (cell) {
    var day = parseInt(cell.dataset.day);
    var period = parseInt(cell.dataset.period);
    var week = parseInt(cell.dataset.week);
    var key = getScheduleKey(day, period, week);
    cell.addEventListener('click', function (e) {
      if (e.shiftKey) { handleCellShiftClick(day, period, week); return; }
      setFocusCell(day, period, week);
      focusCellToEditingArea();
      if (day !== selectedDay) selectedDay = day;
      markDirty();
      renderSchedule(); renderEditingAreaBar(); populateDayTimetableSelect();
    });
    cell.addEventListener('dblclick', function () {
      var liveCell = grid.querySelector('.csn-cell[data-day="' + day + '"][data-period="' + period + '"][data-week="' + week + '"]');
      var rect = (liveCell || cell).getBoundingClientRect();
      showQuickAssign(day, period, week, rect.left, rect.bottom);
    });
    cell.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      showQuickAssign(day, period, week, e.clientX, e.clientY);
    });
    var existingCid = schedule[key];
    if (existingCid) {
      cell.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/course-id', String(existingCid));
        e.dataTransfer.setData('text/from', 'cell');
        e.dataTransfer.setData('text/from-day', String(day)); e.dataTransfer.setData('text/from-period', String(period));
        e.dataTransfer.setData('text/from-week', String(week)); e.dataTransfer.effectAllowed = 'move';
      });
    }
    cell.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    cell.addEventListener('dragenter', function (e) { e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', function () { cell.classList.remove('drag-over'); });
    cell.addEventListener('drop', function (e) {
      e.preventDefault(); cell.classList.remove('drag-over');
      var cidStr = e.dataTransfer.getData('text/course-id');
      var from = e.dataTransfer.getData('text/from'); if (!cidStr) return;
      var cid = parseInt(cidStr);
      if (from === 'cell') {
        var fromDay = parseInt(e.dataTransfer.getData('text/from-day'));
        var fromPeriod = parseInt(e.dataTransfer.getData('text/from-period'));
        var fromWeek = parseInt(e.dataTransfer.getData('text/from-week'));
        var fromKey = getScheduleKey(fromDay, fromPeriod, fromWeek);
        if (fromKey === key) return;
        var targetCid = schedule[key];
        if (targetCid) schedule[fromKey] = targetCid; else delete schedule[fromKey];
        schedule[key] = cid;
      } else { schedule[key] = cid; }
      setFocusCell(day, period, week);
      markDirty(); renderSchedule(); renderCourseLibrary();
    });
    if (isTouchDevice) {
      cell.addEventListener('touchstart', function (e) { handleCellTouchStart(day, period, week, e); }, { passive: true });
      cell.addEventListener('touchend', handleCellTouchEnd, { passive: true });
      cell.addEventListener('touchmove', handleCellTouchEnd, { passive: true });
    }
  });
  // 单元格课程菜单
  grid.querySelectorAll('.course-menu').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var d = parseInt(btn.dataset.day); var p = parseInt(btn.dataset.period); var w = parseInt(btn.dataset.week);
      var key = getScheduleKey(d, p, w); var cid = schedule[key];
      var c = cid ? courses.find(function (co) { return co.id === cid; }) : null;
      showContextMenu([
        { label: '清除课程' + (c ? '（' + c.name + '）' : ''), icon: 'ri-close-circle-line', action: 'clear', danger: true, handler: function () { clearCell(d, p, w); } },
        { label: '编辑课程', icon: 'ri-edit-line', action: 'edit', handler: function () { if (cid) editCourse(cid); else addCourse(); } }
      ], e.clientX, e.clientY);
    });
  });
}

function clearDay(day) {
  if (!confirm('确定清除' + DAY_NAMES[day] + '的所有课程？')) return;
  var prefix = String(day) + '-';
  Object.keys(schedule).forEach(function (k) { if (k.indexOf(prefix) === 0) delete schedule[k]; });
  markDirty(); renderSchedule();
}

function clearCell(day, period, week) {
  var key = getScheduleKey(day, period, week); delete schedule[key];
  markDirty(); renderSchedule();
}

function setCell(day, period, week, cid) {
  var key = getScheduleKey(day, period, week); schedule[key] = cid;
  markDirty(); renderSchedule();
}

function setRotation(day, type) {
  if (!dayRotations[String(day)]) {
    var newKeys = {}; var dStr = String(day); var oldPrefix = dStr + '-';
    Object.keys(schedule).forEach(function (k) {
      if (k.indexOf(oldPrefix) === 0 && k.indexOf('-', oldPrefix.length) === -1) {
        var parts = k.split('-');
        if (parts.length === 2) newKeys[dStr + '-' + parts[1] + '-0'] = schedule[k];
      } else if (k.indexOf(oldPrefix) === 0) { newKeys[k] = schedule[k]; }
    });
    Object.keys(schedule).forEach(function (k) { if (k.indexOf(oldPrefix) === 0 && k.indexOf('-', oldPrefix.length) === -1) delete schedule[k]; });
    Object.keys(newKeys).forEach(function (k) { schedule[k] = newKeys[k]; });
  }
  dayRotations[String(day)] = type;
  markDirty(); renderSchedule(); renderEditingAreaBar(); renderRotationWeekSelector(); renderViewToggle();
}

function removeRotation(day) {
  var dStr = String(day); var oldPrefix = dStr + '-'; var newKeys = {};
  Object.keys(schedule).forEach(function (k) {
    if (k.indexOf(oldPrefix) === 0) {
      var parts = k.split('-');
      if (parts.length === 3 && parts[2] === '0') newKeys[dStr + '-' + parts[1]] = schedule[k];
      else if (parts.length === 2) newKeys[k] = schedule[k];
    }
  });
  Object.keys(schedule).forEach(function (k) { if (k.indexOf(oldPrefix) === 0) delete schedule[k]; });
  Object.keys(newKeys).forEach(function (k) { schedule[k] = newKeys[k]; });
  delete dayRotations[String(day)];
  markDirty(); renderSchedule(); renderEditingAreaBar(); renderRotationWeekSelector(); renderViewToggle();
}

// ==================== 当列时间表下拉 ====================
function populateDayTimetableSelect() {
  var sel = el('csn-day-timetable'); if (!sel) return;
  var selectedAreas = [];
  for (var d = 0; d < 7; d++) {
    var rot = getRotationCount(d);
    for (var w = 0; w < rot; w++) {
      var key = rot > 1 ? (d + '-' + w) : String(d);
      if (editingSelection[key]) selectedAreas.push({ d: d, w: w, key: key });
    }
  }
  var currentTTId = null;
  if (selectedAreas.length === 1) currentTTId = getTimetableIdForDayWeek(selectedAreas[0].d, selectedAreas[0].w);
  sel.innerHTML = '<option value="">-- 选择时间表 --</option>' +
    timetables.map(function (tt) {
      return '<option value="' + tt.id + '"' + (String(tt.id) === String(currentTTId) ? ' selected' : '') + '>' + esc(tt.name) + '</option>';
    }).join('');
  sel.onchange = function () {
    var ttId = sel.value; var ttIdParsed = ttId ? parseInt(ttId) : null;
    var areas = [];
    for (var dd2 = 0; dd2 < 7; dd2++) {
      var rot2 = getRotationCount(dd2);
      for (var w2 = 0; w2 < rot2; w2++) {
        var k2 = rot2 > 1 ? (dd2 + '-' + w2) : String(dd2);
        if (editingSelection[k2]) areas.push({ d: dd2, w: w2, key: k2 });
      }
    }
    areas.forEach(function (area) {
      var rot3 = getRotationCount(area.d);
      if (rot3 > 1) {
        var wkKey = String(area.d) + '-' + String(area.w);
        if (!ttIdParsed) delete dayTimetables[wkKey]; else dayTimetables[wkKey] = ttIdParsed;
      } else {
        if (!ttIdParsed) delete dayTimetables[String(area.d)]; else dayTimetables[String(area.d)] = ttIdParsed;
      }
    });
    markDirty(); renderSchedule(); renderEditingAreaBar();
  };
}

// ==================== 轮换周选择器 ====================
function calcAcademicWeek() {
  if (!semesterStart) return -1;
  try {
    var start = new Date(semesterStart + 'T00:00:00');
    if (isNaN(start.getTime())) return -1;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var dayOfWeek = now.getDay();
    var diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    now.setDate(now.getDate() - diffToMonday);
    var weekNum = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return weekNum > 0 ? weekNum : 0;
  } catch (e) { return -1; }
}

function getRotationCountFromType(type) {
  if (type === 'double') return 2; if (type === 'triple') return 3; if (type === 'quad') return 4;
  return 1;
}

function renderRotationWeekSelector() {
  var container = el('csn-rot-selector'); if (!container) return;
  var maxRot = 1; var firstType = null;
  for (var d = 0; d < 7; d++) {
    var rot = getRotationCount(d);
    if (rot > maxRot) { maxRot = rot; firstType = getRotationType(d); }
  }
  var acWeek = calcAcademicWeek();
  if (semesterStart && acWeek >= 1 && maxRot > 1) {
    var adjWeek = acWeek + rotationOffset;
    if (adjWeek < 1) adjWeek += Math.ceil((1 - adjWeek) / maxRot) * maxRot;
    currentRotationWeek = ((adjWeek - 1) % maxRot + maxRot) % maxRot;
  }
  var html = '';
  var labels = firstType ? (ROTATION_LABELS[firstType] || ['', '', '', '']) : ['', '', '', ''];
  if (semesterStart && acWeek >= 1 && maxRot > 1) {
    if (currentRotationWeek >= maxRot) currentRotationWeek = 0;
    var curLabel = labels[currentRotationWeek] || '第' + (currentRotationWeek + 1) + '周';
    var adjWeek2 = acWeek + rotationOffset;
    if (adjWeek2 < 1) adjWeek2 += Math.ceil((1 - adjWeek2) / maxRot) * maxRot;
    html += '<span class="rot-status">当前：' + esc(curLabel) + '（第' + adjWeek2 + '周）</span>';
  } else if (maxRot <= 1) {
    html += '<span class="rot-status" style="color:var(--csn-text3);">无轮换</span>';
  } else {
    html += '<span class="rot-status" style="color:#fbbc04;">请设置学期开始日期</span>';
  }
  html += '<span class="rot-sep">|</span>';
  html += '<span class="rot-offset-label">偏移</span>';
  html += '<button class="rot-offset-btn" data-offset="-1" title="下偏一周"><i class="ri-arrow-left-s-line"></i></button>';
  html += '<span class="rot-offset-val">' + (rotationOffset > 0 ? '+' : '') + rotationOffset + '</span>';
  html += '<button class="rot-offset-btn" data-offset="1" title="上偏一周"><i class="ri-arrow-right-s-line"></i></button>';
  html += '<span class="rot-sep">|</span>';
  html += '<input type="date" class="semester-start" id="semester-start-input" value="' + esc(semesterStart) + '" title="学期开始日期，用于计算当前周次">';
  container.innerHTML = html;
  container.querySelectorAll('.rot-offset-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      rotationOffset += parseInt(this.dataset.offset);
      if (rotationOffset > 10) rotationOffset = 10;
      if (rotationOffset < -10) rotationOffset = -10;
      markDirty(); renderRotationWeekSelector(); renderSchedule(); renderViewToggle();
    });
  });
  var dateInput = el('semester-start-input');
  if (dateInput) dateInput.addEventListener('change', function () {
    semesterStart = this.value;
    markDirty(); renderRotationWeekSelector(); renderSchedule(); renderViewToggle();
  });
}

// ==================== 视图切换 ====================
function renderViewToggle() {
  document.querySelectorAll('.csn-vt').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.mode === scheduleViewMode);
  });
}
function initViewToggleBar() {
  document.querySelectorAll('.csn-vt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      scheduleViewMode = this.dataset.mode;
      markDirty(); renderViewToggle(); renderSchedule();
    });
  });
}

// ==================== Excel 式单元格操作 ====================
function setFocusCell(day, period, week) {
  if (day == null || period == null) { focusCell = null; return; }
  var maxPeriods = 0; var rot = getRotationCount(day);
  for (var w = 0; w < rot; w++) { var p = getPeriodsForDayWeek(day, w); if (p.length > maxPeriods) maxPeriods = p.length; }
  if (period < 0) period = 0;
  if (period >= maxPeriods) period = maxPeriods - 1;
  if (period < 0) { focusCell = null; return; }
  focusCell = { day: day, period: period, week: week != null ? week : 0 };
}

function focusCellToEditingArea() {
  if (!focusCell) return;
  var d = focusCell.day, w = focusCell.week;
  var rot = getRotationCount(d);
  var key = rot > 1 ? (d + '-' + w) : String(d);
  if (!editingSelection[key]) {
    editingSelection = {};
    editingSelection[key] = true;
    markDirty();
    renderEditingAreaBar(); updateEditingCard(); populateDayTimetableSelect();
  }
}

var quickAssignPanel = null;
function ensureQuickAssignPanel() {
  if (!quickAssignPanel) {
    quickAssignPanel = document.createElement('div');
    quickAssignPanel.className = 'csn-qa';
    quickAssignPanel.id = 'csn-qa-panel';
    document.body.appendChild(quickAssignPanel);
  }
  return quickAssignPanel;
}

function showQuickAssign(day, period, week, x, y) {
  var panel = ensureQuickAssignPanel();
  var key = getScheduleKey(day, period, week);
  var existingCid = schedule[key];
  var existingC = existingCid ? courses.find(function (co) { return co.id === existingCid; }) : null;
  var html = '<div class="qa-bar">';
  html += '<div class="qa-btn' + (!existingCid ? ' active' : '') + '" data-action="clear"><i class="ri-close-circle-line"></i> 清除</div>';
  if (existingC) html += '<div class="qa-btn" data-action="edit"><i class="ri-edit-line"></i> 编辑</div>';
  html += '</div>';
  if (courses.length) {
    html += '<div class="qa-grid">';
    courses.forEach(function (c) {
      var sel = c.id === existingCid ? ' selected' : '';
      var abbr = c.abbr || c.name.charAt(0);
      html += '<div class="qa-cell' + sel + '" data-action="set" data-cid="' + c.id + '" title="' + esc(c.name) + '" style="background:' + esc(c.color) + '22;border-color:' + esc(c.color) + ';">' +
        '<span class="qa-text" style="color:' + esc(c.color) + '">' + esc(abbr) + '</span></div>';
    });
    html += '</div>';
  }
  panel.innerHTML = html;
  panel.style.left = '0px'; panel.style.top = '0px';
  panel.classList.add('show');
  var pw = panel.offsetWidth, ph = panel.offsetHeight;
  var vw = window.innerWidth, vh = window.innerHeight;
  if (x + pw > vw - 4) x = Math.max(4, x - pw);
  if (y + ph > vh - 4) y = Math.max(4, y - ph);
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  panel.style.left = x + 'px'; panel.style.top = y + 'px';
  panel.querySelectorAll('.qa-btn, .qa-cell').forEach(function (item) {
    item.addEventListener('click', function (e) {
      e.stopPropagation();
      var action = item.dataset.action;
      if (action === 'clear') { clearCell(day, period, week); }
      else if (action === 'edit') { if (existingCid) editCourse(existingCid); else addCourse(); }
      else if (action === 'set') { setCell(day, period, week, parseInt(item.dataset.cid)); }
      hideQuickAssign(); renderSchedule();
    });
  });
  setTimeout(function () { document.addEventListener('click', hideQuickAssign, { once: true }); }, 10);
}
function hideQuickAssign() { if (quickAssignPanel) quickAssignPanel.classList.remove('show'); }

function handleCellShiftClick(day, period, week) {
  if (!focusCell) { setFocusCell(day, period, week); focusCellToEditingArea(); renderSchedule(); return; }
  var fromDay = Math.min(focusCell.day, day);
  var toDay = Math.max(focusCell.day, day);
  for (var d = fromDay; d <= toDay; d++) {
    var rot = getRotationCount(d);
    for (var w = 0; w < rot; w++) {
      var periods = getPeriodsForDayWeek(d, w);
      for (var p = 0; p < periods.length; p++) { var key = rot > 1 ? (d + '-' + w) : String(d); editingSelection[key] = true; }
    }
  }
  setFocusCell(day, period, week);
  selectedDay = day;
  markDirty();
  renderSchedule(); renderEditingAreaBar(); updateEditingCard(); populateDayTimetableSelect();
}

var touchTimer = null;
function handleCellTouchStart(day, period, week, e) {
  touchTimer = setTimeout(function () {
    touchTimer = null;
    var touch = e.touches ? e.touches[0] : e;
    showQuickAssign(day, period, week, touch.clientX, touch.clientY);
  }, 500);
}
function handleCellTouchEnd() { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } }

// ==================== 时间表管理 ====================
function renderTimetableList() {
  var list = el('csn-tt-list'); if (!list) return;
  list.innerHTML = timetables.map(function (tt) {
    var sel = tt.id === selectedTimetableId ? ' selected' : '';
    return '<div class="csn-tt-item' + sel + '" data-ttid="' + tt.id + '"><i class="ri-time-line"></i><span>' + esc(tt.name) + '</span><span class="tt-count">' + (tt.periods ? tt.periods.length : 0) + '节</span></div>';
  }).join('');
  list.querySelectorAll('.csn-tt-item').forEach(function (item) {
    item.addEventListener('click', function () { selectedTimetableId = parseInt(item.dataset.ttid); renderTimetableList(); renderTimetableEditor(); });
  });
}

function renderTimetableEditor() {
  var editor = el('csn-tt-editor'); var empty = el('csn-tt-empty');
  if (!selectedTimetableId) { editor.style.display = 'none'; empty.style.display = 'flex'; return; }
  empty.style.display = 'none'; editor.style.display = 'flex';
  var tt = timetables.find(function (t) { return t.id === selectedTimetableId; }); if (!tt) return;
  el('csn-tt-name').value = tt.name;
  var periodList = el('csn-period-list');
  periodList.innerHTML = (tt.periods || []).map(function (p, i) {
    return '<div class="csn-period-row" data-pi="' + i + '">' +
      '<input class="p-name" type="text" value="' + esc(p.name) + '" data-pi="' + i + '" data-field="name">' +
      '<input class="p-time" type="time" value="' + esc(p.start) + '" data-pi="' + i + '" data-field="start" step="60">' +
      '<input class="p-time" type="time" value="' + esc(p.end) + '" data-pi="' + i + '" data-field="end" step="60">' +
      '<div class="period-actions">' +
        '<button class="period-btn" data-action="up" data-pi="' + i + '" title="上移"><i class="ri-arrow-up-line"></i></button>' +
        '<button class="period-btn" data-action="down" data-pi="' + i + '" title="下移"><i class="ri-arrow-down-line"></i></button>' +
        '<button class="period-btn del" data-action="del" data-pi="' + i + '" title="删除"><i class="ri-delete-bin-line"></i></button>' +
      '</div></div>';
  }).join('') + '<div class="csn-period-add-row"><button class="csn-btn" id="csn-add-period-inline"><i class="ri-add-line"></i> 添加节次</button></div>';
  periodList.querySelectorAll('input').forEach(function (input) {
    input.addEventListener('input', function () { var pi = parseInt(input.dataset.pi); var field = input.dataset.field; if (tt.periods[pi]) tt.periods[pi][field] = input.value; markDirty(); });
  });
  periodList.querySelectorAll('.period-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pi = parseInt(btn.dataset.pi); var action = btn.dataset.action;
      if (action === 'del') { tt.periods.splice(pi, 1); markDirty(); renderTimetableEditor(); savePeriods(); }
      else if (action === 'up' && pi > 0) { var tmp = tt.periods[pi]; tt.periods[pi] = tt.periods[pi - 1]; tt.periods[pi - 1] = tmp; markDirty(); renderTimetableEditor(); savePeriods(); }
      else if (action === 'down' && pi < tt.periods.length - 1) { var tmp2 = tt.periods[pi]; tt.periods[pi] = tt.periods[pi + 1]; tt.periods[pi + 1] = tmp2; markDirty(); renderTimetableEditor(); savePeriods(); }
    });
  });
  var addBtn = el('csn-add-period-inline');
  if (addBtn) addBtn.addEventListener('click', function () { tt.periods.push({ name: '第' + (tt.periods.length + 1) + '节', start: '08:00', end: '08:45' }); markDirty(); renderTimetableEditor(); savePeriods(); });
}

function savePeriods() { populateDayTimetableSelect(); renderTimetableList(); renderSchedule(); renderEditingAreaBar(); }

el('csn-tt-save').addEventListener('click', function () {
  if (!selectedTimetableId) return;
  var tt = timetables.find(function (t) { return t.id === selectedTimetableId; }); if (!tt) return;
  tt.name = el('csn-tt-name').value.trim() || tt.name;
  markDirty(); renderTimetableList(); populateDayTimetableSelect(); renderSchedule(); renderEditingAreaBar();
});

el('csn-add-period').addEventListener('click', function () {
  if (!selectedTimetableId) { alert('请先在左侧选择一个时间表'); return; }
  var tt = timetables.find(function (t) { return t.id === selectedTimetableId; }); if (!tt) return;
  tt.periods.push({ name: '第' + (tt.periods.length + 1) + '节', start: '08:00', end: '08:45' });
  markDirty(); renderTimetableEditor(); renderTimetableList(); populateDayTimetableSelect(); renderSchedule(); renderEditingAreaBar();
});

el('csn-add-timetable').addEventListener('click', function () {
  var name = prompt('请输入时间表名称：', '时间表 ' + (timetables.length + 1));
  if (!name || !name.trim()) return; name = name.trim();
  timetables.push({ id: nextTimetableId++, name: name,
    periods: [{ name: '第1节', start: '08:00', end: '08:45' }, { name: '第2节', start: '08:55', end: '09:40' },
      { name: '第3节', start: '10:00', end: '10:45' }, { name: '第4节', start: '10:55', end: '11:40' },
      { name: '第5节', start: '14:00', end: '14:45' }, { name: '第6节', start: '14:55', end: '15:40' }] });
  selectedTimetableId = timetables[timetables.length - 1].id;
  markDirty(); renderTimetableList(); renderTimetableEditor(); populateDayTimetableSelect(); renderEditingAreaBar();
});

el('csn-delete-timetable').addEventListener('click', function () {
  if (!selectedTimetableId) { alert('请先在左侧选择一个时间表'); return; }
  if (timetables.length <= 1) { alert('至少保留一个时间表'); return; }
  var tt = timetables.find(function (t) { return t.id === selectedTimetableId; }); if (!tt) return;
  if (!confirm('确定删除时间表"' + tt.name + '"？')) return;
  timetables = timetables.filter(function (t) { return t.id !== selectedTimetableId; });
  Object.keys(dayTimetables).forEach(function (k) { if (dayTimetables[k] === selectedTimetableId) delete dayTimetables[k]; });
  selectedTimetableId = timetables.length ? timetables[0].id : null;
  markDirty(); renderTimetableList(); renderTimetableEditor(); populateDayTimetableSelect(); renderSchedule(); renderEditingAreaBar();
});

// ==================== 初始化 ====================
// 注入 RemixIcon 图标库（iframe 内 CSS @import 会被忽略，改用 link 注入）
(function () {
  if (document.getElementById('csn-remixicon')) return;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.id = 'csn-remixicon';
  link.href = 'https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css';
  (document.head || document.documentElement).appendChild(link);
})();

loadData();
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveConfig(); }
  if (e.key === 'Escape') hideQuickAssign();
});

renderSchedule(); renderCourseLibrary(); renderTimetableList(); renderEditingAreaBar(); populateDayTimetableSelect(); renderRotationWeekSelector();
renderViewToggle(); initViewToggleBar();