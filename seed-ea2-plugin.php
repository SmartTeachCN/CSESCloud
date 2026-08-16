<?php
/**
 * CSES Cloud - EA2 考试档案编辑器插件初始化脚本
 *
 * 注册 .ea2 后缀，提供结构化考试配置编辑器
 * 映射 ExamAware2 的 ExamConfig 数据模型
 *
 * 运行方式：php seed-ea2-plugin.php
 */

require_once __DIR__ . '/lib/bootstrap.php';

// 检查是否已存在
$existing = DB::one(
    "SELECT id FROM editor_plugins WHERE plugin_key = ?",
    ['ea2_exam_editor']
);

if ($existing) {
    echo "EA2 编辑器插件已存在 (id={$existing['id']})，跳过创建。\n";
    exit;
}

$now = date('Y-m-d H:i:s');

// ===== 编辑器 HTML =====
$editorHtml = <<<'HTML'
<div class="ea2-editor">
  <div class="ea2-toolbar">
    <span class="ea2-title">EA2 考试档案编辑器</span>
    <div class="ea2-toolbar-actions">
      <button class="ea2-btn" onclick="formatConfig()">格式化</button>
      <button class="ea2-btn" onclick="validateConfig()">验证</button>
      <button class="ea2-btn primary" onclick="saveConfig()">保存</button>
    </div>
  </div>

  <div class="ea2-body">
    <!-- 考试基本信息 -->
    <div class="ea2-section">
      <div class="ea2-section-title">考试信息</div>
      <div class="ea2-field-row">
        <div class="ea2-field">
          <label>考试名称 <span class="required">*</span></label>
          <input type="text" id="ea2ExamName" placeholder="例如：2026年秋季期末考试" oninput="onFieldChange()" />
        </div>
      </div>
      <div class="ea2-field-row">
        <div class="ea2-field">
          <label>提示信息</label>
          <textarea id="ea2Message" rows="2" placeholder="考试提示信息，将在客户端显示" oninput="onFieldChange()"></textarea>
        </div>
      </div>
    </div>

    <!-- 考试场次列表 -->
    <div class="ea2-section">
      <div class="ea2-section-title">
        <span>考试场次</span>
        <button class="ea2-btn small" onclick="addExamInfo()">+ 添加场次</button>
      </div>
      <div id="ea2ExamInfos" class="ea2-exam-list">
        <!-- 动态生成 -->
      </div>
      <div class="ea2-empty-hint" id="ea2EmptyHint">
        暂无场次，点击「添加场次」创建第一场考试
      </div>
    </div>
  </div>

  <!-- 状态栏 -->
  <div class="ea2-status-bar">
    <span id="ea2Status" class="ea2-status">EA2 编辑器就绪</span>
    <span class="ea2-status-hint">Ctrl+S 保存 · Shift+Alt+F 格式化</span>
  </div>
</div>
HTML;

// ===== 编辑器 CSS =====
$editorCss = <<<'CSS'
.ea2-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
}
.ea2-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #252526;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}
.ea2-title {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
}
.ea2-toolbar-actions {
  display: flex;
  gap: 6px;
}
.ea2-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 14px;
  background: #3c3c3c;
  color: #cccccc;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.ea2-btn:hover { background: #4c4c4c; }
.ea2-btn.primary { background: #0067C0; color: white; border-color: #0067C0; }
.ea2-btn.primary:hover { background: #005aaf; }
.ea2-btn.small { padding: 3px 10px; font-size: 11px; }
.ea2-btn.danger { color: #f48771; border-color: #5a2a2a; }
.ea2-btn.danger:hover { background: #5a2a2a; }

.ea2-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.ea2-section {
  margin-bottom: 20px;
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  overflow: hidden;
}
.ea2-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #e0e0e0;
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
}
.ea2-field-row {
  padding: 12px 16px;
  border-bottom: 1px solid #333;
}
.ea2-field-row:last-child { border-bottom: none; }
.ea2-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ea2-field label {
  font-size: 11px;
  font-weight: 500;
  color: #999;
}
.ea2-field .required { color: #f48771; }
.ea2-field input[type="text"],
.ea2-field input[type="number"],
.ea2-field input[type="date"],
.ea2-field input[type="time"],
.ea2-field textarea,
.ea2-field select {
  padding: 7px 10px;
  background: #1e1e1e;
  color: #d4d4d4;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.ea2-field input:focus,
.ea2-field textarea:focus,
.ea2-field select:focus {
  border-color: #0067C0;
}
.ea2-field input.error,
.ea2-field textarea.error {
  border-color: #f48771;
}
.ea2-field textarea { resize: vertical; min-height: 48px; }
.ea2-field input[type="number"] { width: 80px; }

/* 场次卡片 */
.ea2-exam-list {
  padding: 0;
}
.ea2-exam-card {
  padding: 14px 16px;
  border-bottom: 1px solid #333;
}
.ea2-exam-card:last-child { border-bottom: none; }
.ea2-exam-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ea2-exam-card-index {
  font-size: 12px;
  font-weight: 600;
  color: #0067C0;
}
.ea2-exam-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}
.ea2-exam-card-grid .ea2-field:first-child {
  grid-column: 1 / -1;
}
.ea2-time-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.ea2-time-row .ea2-field { flex: 1; }

/* 材料列表 */
.ea2-materials {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #3c3c3c;
}
.ea2-materials-title {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
}
.ea2-material-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ea2-material-row .ea2-field { flex: 1; }
.ea2-material-row .ea2-field label { display: none; }
.ea2-material-row input[type="text"] { width: 100%; }
.ea2-material-row input[type="number"] { width: 70px; }
.ea2-material-remove {
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid #5a2a2a;
  border-radius: 4px;
  color: #f48771;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 18px;
}
.ea2-material-remove:hover { background: #5a2a2a; }

.ea2-empty-hint {
  padding: 24px;
  text-align: center;
  color: #666;
  font-size: 12px;
}

/* 状态栏 */
.ea2-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px;
  background: #007acc;
  color: white;
  font-size: 11px;
  flex-shrink: 0;
  transition: background 0.3s;
}
.ea2-status-bar.error { background: #c42b1c; }
.ea2-status-bar.warning { background: #ca8f04; }
.ea2-status-bar.success { background: #107c10; }
.ea2-status-hint { opacity: 0.7; font-size: 10px; }

/* 验证提示 */
.ea2-validation-error {
  color: #f48771;
  font-size: 11px;
  margin-top: 2px;
}
.ea2-validation-warning {
  color: #d4a72c;
  font-size: 11px;
  margin-top: 2px;
}

/* 滚动条 */
.ea2-body::-webkit-scrollbar { width: 8px; }
.ea2-body::-webkit-scrollbar-track { background: #1e1e1e; }
.ea2-body::-webkit-scrollbar-thumb { background: #424242; border-radius: 4px; }
.ea2-body::-webkit-scrollbar-thumb:hover { background: #555; }

/* 加载/空状态 */
.ea2-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  font-size: 13px;
}
CSS;

// ===== 编辑器 JS =====
$editorJs = <<<'JS'
// EA2 考试档案编辑器
// 映射 ExamAware2 的 ExamConfig 数据模型
// 通过 window.CSEditor 与平台通信

var examData = {
  examName: '',
  message: '',
  examInfos: []
};

var dirty = false;
var validationErrors = [];
var validationWarnings = [];

// ===== 初始化 =====
(function init() {
  if (window.CSEditor && window.CSEditor.file && window.CSEditor.file.content) {
    try {
      var parsed = JSON.parse(window.CSEditor.file.content);
      if (parsed && typeof parsed === 'object') {
        examData.examName = parsed.examName || '';
        examData.message = parsed.message || '';
        examData.examInfos = Array.isArray(parsed.examInfos) ? parsed.examInfos : [];
      }
    } catch (e) {
      setStatus('无法解析文件内容，将创建新配置', 'warning');
    }
  }
  renderAll();
  setStatus('EA2 编辑器就绪', '');
})();

// ===== 渲染 =====
function renderAll() {
  document.getElementById('ea2ExamName').value = examData.examName;
  document.getElementById('ea2Message').value = examData.message;
  renderExamInfos();
}

function renderExamInfos() {
  var container = document.getElementById('ea2ExamInfos');
  var hint = document.getElementById('ea2EmptyHint');
  container.innerHTML = '';

  if (examData.examInfos.length === 0) {
    hint.style.display = 'block';
    return;
  }
  hint.style.display = 'none';

  examData.examInfos.forEach(function(info, idx) {
    var card = buildExamCard(info, idx);
    container.appendChild(card);
  });
}

function buildExamCard(info, idx) {
  var card = document.createElement('div');
  card.className = 'ea2-exam-card';

  var startDate = '', startTime = '', endDate = '', endTime = '';
  if (info.start) {
    var parts = info.start.split('T');
    startDate = parts[0] || '';
    startTime = (parts[1] || '').substring(0, 5);
  }
  if (info.end) {
    var parts = info.end.split('T');
    endDate = parts[0] || '';
    endTime = (parts[1] || '').substring(0, 5);
  }

  card.innerHTML =
    '<div class="ea2-exam-card-header">' +
      '<span class="ea2-exam-card-index">场次 ' + (idx + 1) + '</span>' +
      '<button class="ea2-btn small danger" onclick="removeExamInfo(' + idx + ')">× 删除</button>' +
    '</div>' +
    '<div class="ea2-exam-card-grid">' +
      '<div class="ea2-field">' +
        '<label>场次名称 <span class="required">*</span></label>' +
        '<input type="text" class="exam-name" value="' + escAttr(info.name || '') + '" placeholder="例如：语文" oninput="onExamFieldChange(' + idx + ', \'name\', this.value)" />' +
      '</div>' +
      '<div class="ea2-time-row">' +
        '<div class="ea2-field">' +
          '<label>开始日期 <span class="required">*</span></label>' +
          '<input type="date" class="exam-start-date" value="' + escAttr(startDate) + '" onchange="onExamTimeChange(' + idx + ')" />' +
        '</div>' +
        '<div class="ea2-field">' +
          '<label>开始时间</label>' +
          '<input type="time" class="exam-start-time" value="' + escAttr(startTime) + '" onchange="onExamTimeChange(' + idx + ')" />' +
        '</div>' +
      '</div>' +
      '<div class="ea2-time-row">' +
        '<div class="ea2-field">' +
          '<label>结束日期 <span class="required">*</span></label>' +
          '<input type="date" class="exam-end-date" value="' + escAttr(endDate) + '" onchange="onExamTimeChange(' + idx + ')" />' +
        '</div>' +
        '<div class="ea2-field">' +
          '<label>结束时间</label>' +
          '<input type="time" class="exam-end-time" value="' + escAttr(endTime) + '" onchange="onExamTimeChange(' + idx + ')" />' +
        '</div>' +
      '</div>' +
      '<div class="ea2-field">' +
        '<label>提前提醒（分钟）</label>' +
        '<input type="number" class="exam-alert-time" value="' + (info.alertTime || 5) + '" min="0" oninput="onExamFieldChange(' + idx + ', \'alertTime\', parseInt(this.value) || 0)" />' +
      '</div>' +
    '</div>' +
    '<div class="ea2-materials">' +
      '<div class="ea2-materials-title">' +
        '材料清单 ' +
        '<button class="ea2-btn small" onclick="addMaterial(' + idx + ')" style="margin-left:8px">+ 添加</button>' +
      '</div>' +
      '<div class="ea2-materials-list" id="ea2Materials_' + idx + '">' +
        buildMaterialsHTML(info.materials || [], idx) +
      '</div>' +
    '</div>';

  return card;
}

function buildMaterialsHTML(materials, examIdx) {
  if (!materials || materials.length === 0) {
    return '<div class="ea2-validation-warning" style="margin-top:4px">暂无材料</div>';
  }
  return materials.map(function(m, mi) {
    return '<div class="ea2-material-row">' +
      '<div class="ea2-field"><input type="text" value="' + escAttr(m.name || '') + '" placeholder="材料名称" oninput="onMaterialChange(' + examIdx + ',' + mi + ',\'name\',this.value)" /></div>' +
      '<div class="ea2-field"><input type="number" value="' + (m.quantity || 0) + '" placeholder="数量" min="0" oninput="onMaterialChange(' + examIdx + ',' + mi + ',\'quantity\',parseInt(this.value)||0)" /></div>' +
      '<div class="ea2-field"><input type="text" value="' + escAttr(m.unit || '') + '" placeholder="单位" oninput="onMaterialChange(' + examIdx + ',' + mi + ',\'unit\',this.value)" /></div>' +
      '<button class="ea2-material-remove" onclick="removeMaterial(' + examIdx + ',' + mi + ')" title="删除材料">×</button>' +
    '</div>';
  }).join('');
}

function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== 数据操作 =====
function onFieldChange() {
  examData.examName = document.getElementById('ea2ExamName').value;
  examData.message = document.getElementById('ea2Message').value;
  dirty = true;
}

function onExamFieldChange(idx, field, value) {
  if (!examData.examInfos[idx]) return;
  examData.examInfos[idx][field] = value;
  dirty = true;
}

function onExamTimeChange(idx) {
  if (!examData.examInfos[idx]) return;
  var card = document.querySelectorAll('.ea2-exam-card')[idx];
  if (!card) return;
  var startDate = card.querySelector('.exam-start-date').value;
  var startTime = card.querySelector('.exam-start-time').value || '00:00';
  var endDate = card.querySelector('.exam-end-date').value;
  var endTime = card.querySelector('.exam-end-time').value || '00:00';
  examData.examInfos[idx].start = startDate ? (startDate + 'T' + startTime + ':00') : '';
  examData.examInfos[idx].end = endDate ? (endDate + 'T' + endTime + ':00') : '';
  dirty = true;
}

function onMaterialChange(examIdx, materialIdx, field, value) {
  if (!examData.examInfos[examIdx]) return;
  if (!examData.examInfos[examIdx].materials) examData.examInfos[examIdx].materials = [];
  if (!examData.examInfos[examIdx].materials[materialIdx]) {
    examData.examInfos[examIdx].materials[materialIdx] = { name: '', quantity: 0, unit: '' };
  }
  examData.examInfos[examIdx].materials[materialIdx][field] = value;
  dirty = true;
}

function addExamInfo() {
  examData.examInfos.push({
    name: '',
    start: '',
    end: '',
    alertTime: 5,
    materials: []
  });
  renderExamInfos();
  dirty = true;
}

function removeExamInfo(idx) {
  examData.examInfos.splice(idx, 1);
  renderExamInfos();
  dirty = true;
}

function addMaterial(examIdx) {
  if (!examData.examInfos[examIdx]) return;
  if (!examData.examInfos[examIdx].materials) examData.examInfos[examIdx].materials = [];
  examData.examInfos[examIdx].materials.push({ name: '', quantity: 0, unit: '' });
  renderExamInfos();
  dirty = true;
}

function removeMaterial(examIdx, materialIdx) {
  if (!examData.examInfos[examIdx]) return;
  examData.examInfos[examIdx].materials.splice(materialIdx, 1);
  renderExamInfos();
  dirty = true;
}

// ===== 验证 =====
function validateConfig() {
  validationErrors = [];
  validationWarnings = [];

  if (!examData.examName.trim()) {
    validationErrors.push({ path: 'examName', message: '考试名称不能为空' });
  }
  if (examData.examInfos.length === 0) {
    validationErrors.push({ path: 'examInfos', message: '至少需要一场考试' });
  }

  var ranges = [];
  examData.examInfos.forEach(function(info, idx) {
    var base = '场次 ' + (idx + 1);
    if (!info.name.trim()) {
      validationErrors.push({ path: 'examInfos[' + idx + '].name', message: base + '：名称不能为空' });
    }
    if (!info.start) {
      validationErrors.push({ path: 'examInfos[' + idx + '].start', message: base + '：开始时间不能为空' });
    }
    if (!info.end) {
      validationErrors.push({ path: 'examInfos[' + idx + '].end', message: base + '：结束时间不能为空' });
    }

    var startMs = info.start ? new Date(info.start).getTime() : NaN;
    var endMs = info.end ? new Date(info.end).getTime() : NaN;

    if (info.start && isNaN(startMs)) {
      validationErrors.push({ path: 'examInfos[' + idx + '].start', message: base + '：开始时间格式无效' });
    }
    if (info.end && isNaN(endMs)) {
      validationErrors.push({ path: 'examInfos[' + idx + '].end', message: base + '：结束时间格式无效' });
    }
    if (!isNaN(startMs) && !isNaN(endMs)) {
      if (startMs >= endMs) {
        validationErrors.push({ path: 'examInfos[' + idx + ']', message: base + '：开始时间必须早于结束时间' });
      } else {
        ranges.push({ index: idx, startMs: startMs, endMs: endMs });
      }
      var durationMs = endMs - startMs;
      if (info.alertTime * 60000 > durationMs) {
        validationWarnings.push({ path: 'examInfos[' + idx + '].alertTime', message: base + '：提醒时间超过考试时长' });
      }
    }
    if (typeof info.alertTime !== 'number' || info.alertTime < 0 || isNaN(info.alertTime)) {
      validationErrors.push({ path: 'examInfos[' + idx + '].alertTime', message: base + '：提醒时间必须是非负数' });
    }
  });

  // 时间重叠检查
  var sorted = ranges.slice().sort(function(a, b) { return a.startMs - b.startMs; });
  for (var i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].endMs > sorted[i + 1].startMs) {
      validationErrors.push({
        path: 'examInfos',
        message: '场次 ' + (sorted[i].index + 1) + ' 和场次 ' + (sorted[i + 1].index + 1) + ' 时间重叠'
      });
    }
  }

  // 更新状态栏
  if (validationErrors.length > 0) {
    setStatus('✗ ' + validationErrors.length + ' 个错误', 'error');
  } else if (validationWarnings.length > 0) {
    setStatus('✓ 验证通过（' + validationWarnings.length + ' 个警告）', 'warning');
  } else {
    setStatus('✓ 验证通过', 'success');
  }

  return { errors: validationErrors, warnings: validationWarnings };
}

// ===== 格式化 =====
function formatConfig() {
  try {
    var config = buildConfig();
    var formatted = JSON.stringify(config, null, 2);
    // 更新显示并重新加载
    if (window.CSEditor && window.CSEditor.file) {
      window.CSEditor.file.content = formatted;
    }
    examData = config;
    renderAll();
    setStatus('JSON 格式化完成', 'success');
  } catch (e) {
    setStatus('格式化失败: ' + e.message, 'error');
  }
}

// ===== 保存 =====
function buildConfig() {
  return {
    examName: examData.examName,
    message: examData.message,
    examInfos: examData.examInfos
  };
}

function saveConfig() {
  var result = validateConfig();
  if (result.errors.length > 0) {
    if (!confirm('存在 ' + result.errors.length + ' 个验证错误，仍要保存吗？\n\n' +
      result.errors.slice(0, 3).map(function(e) { return e.message; }).join('\n'))) {
      return;
    }
  }
  var config = buildConfig();
  var json = JSON.stringify(config, null, 2);
  if (window.CSEditor) {
    window.CSEditor.emitSave(json);
    dirty = false;
    setStatus('已保存', 'success');
  }
}

// ===== 状态栏 =====
function setStatus(msg, type) {
  var el = document.getElementById('ea2Status');
  var bar = document.querySelector('.ea2-status-bar');
  el.textContent = msg;
  bar.className = 'ea2-status-bar ' + (type || '');
  if (type === 'success') {
    setTimeout(function() {
      bar.className = 'ea2-status-bar';
      el.textContent = 'EA2 编辑器就绪';
    }, 3000);
  }
}

// ===== 键盘快捷键 =====
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveConfig();
  }
  if (e.shiftKey && e.altKey && e.key === 'f') {
    e.preventDefault();
    formatConfig();
  }
});

// 离开前确认
window.addEventListener('beforeunload', function(e) {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
JS;

// ===== 插入数据库 =====
$id = DB::insert('editor_plugins', [
    'developer_username' => 'system',
    'plugin_key' => 'ea2_exam_editor',
    'name' => 'EA2 考试档案编辑器',
    'version' => '1.0.0',
    'description' => 'ExamAware2 考试档案结构化编辑器。支持考试场次管理、材料清单、时间重叠检查、实时验证。注册 .ea2 后缀。',
    'extensions' => json_encode(['ea2']),
    'editor_html' => $editorHtml,
    'editor_js' => $editorJs,
    'editor_css' => $editorCss,
    'icon' => 'ri-file-settings-line',
    'status' => 'published',
    'is_official' => 1,
    'created_at' => $now,
    'updated_at' => $now
]);

echo "EA2 考试档案编辑器创建成功！\n";
echo "  ID: {$id}\n";
echo "  Plugin Key: ea2_exam_editor\n";
echo "  状态: published\n";
echo "  注册后缀: .ea2\n";
echo "  在轻编辑器中打开 .ea2 文件即可自动调用此插件。\n";