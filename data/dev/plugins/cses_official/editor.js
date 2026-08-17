// CSES 编辑器 - 移植自旧版 CSESCloud 平台
// 通过 window.CSEditor 与平台通信

var textarea = document.getElementById('csesTextarea');
var statusEl = document.getElementById('csesStatus');
var statsEl = document.getElementById('csesStats');

// 初始化：加载文件内容
if (window.CSEditor && window.CSEditor.file && window.CSEditor.file.content) {
  textarea.value = window.CSEditor.file.content;
  updateStats();
}

textarea.addEventListener('input', updateStats);

function updateStats() {
  var content = textarea.value;
  var lines = content ? content.split('\n').length : 0;
  var chars = content.length;
  statsEl.textContent = '行: ' + lines + ' | 字符: ' + chars + ' | CSES 编辑器 v1.0';
}

// 格式化 JSON
function formatJson() {
  try {
    var obj = JSON.parse(textarea.value);
    textarea.value = JSON.stringify(obj, null, 2);
    setStatus('JSON 格式化成功', 'success');
    updateStats();
  } catch (e) {
    setStatus('JSON 格式错误: ' + e.message, 'error');
  }
}

// 验证 JSON
function validateJson() {
  try {
    JSON.parse(textarea.value);
    setStatus('JSON 验证通过', 'success');
  } catch (e) {
    setStatus('JSON 验证失败: ' + e.message, 'error');
  }
}

// 压缩 JSON
function minifyJson() {
  try {
    var obj = JSON.parse(textarea.value);
    textarea.value = JSON.stringify(obj);
    setStatus('JSON 已压缩', 'success');
    updateStats();
  } catch (e) {
    setStatus('JSON 格式错误: ' + e.message, 'error');
  }
}

// 保存内容
function saveContent() {
  if (window.CSEditor) {
    window.CSEditor.emitSave(textarea.value);
    setStatus('已保存', 'success');
  }
}

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'cses-status ' + (type || '');
  if (type === 'success') {
    setTimeout(function() { statusEl.textContent = ''; statusEl.className = 'cses-status'; }, 3000);
  }
}

// 键盘快捷键
textarea.addEventListener('keydown', function(e) {
  // Ctrl+S / Cmd+S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveContent();
  }
  // Shift+Alt+F 格式化
  if (e.shiftKey && e.altKey && e.key === 'f') {
    e.preventDefault();
    formatJson();
  }
});

// 初始状态
setStatus('CSES 编辑器就绪 (Ctrl+S 保存, Shift+Alt+F 格式化)', '');
updateStats();