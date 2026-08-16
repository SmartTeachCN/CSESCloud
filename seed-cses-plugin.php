<?php
/**
 * CSES Cloud - 官方编辑器插件初始化脚本
 * 
 * 将旧版 CSESCloud 平台的编辑器功能移植为插件
 * 注册 .cses 后缀，在轻编辑器中自动调用
 * 
 * 运行方式：php seed-cses-plugin.php
 */

require_once __DIR__ . '/lib/bootstrap.php';

// 检查是否已存在
$existing = DB::one(
    "SELECT id FROM editor_plugins WHERE plugin_key = ?",
    ['cses_official']
);

if ($existing) {
    echo "CSES 官方插件已存在 (id={$existing['id']})，跳过创建。\n";
    exit;
}

$now = date('Y-m-d H:i:s');

// CSES 编辑器 HTML：JSON 配置编辑器
$editorHtml = <<<'HTML'
<div class="cses-editor">
  <div class="cses-toolbar">
    <button class="cses-btn" onclick="formatJson()">格式化</button>
    <button class="cses-btn" onclick="validateJson()">验证</button>
    <button class="cses-btn" onclick="minifyJson()">压缩</button>
    <button class="cses-btn primary" onclick="saveContent()">保存</button>
  </div>
  <div class="cses-status" id="csesStatus"></div>
  <textarea id="csesTextarea" class="cses-textarea" spellcheck="false"></textarea>
  <div class="cses-stats" id="csesStats"></div>
</div>
HTML;

// CSES 编辑器 CSS
$editorCss = <<<'CSS'
.cses-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}
.cses-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: #252526;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}
.cses-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  background: #3c3c3c;
  color: #cccccc;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.cses-btn:hover { background: #4c4c4c; }
.cses-btn.primary { background: #0067C0; color: white; border-color: #0067C0; }
.cses-btn.primary:hover { background: #005aaf; }
.cses-status {
  padding: 4px 12px;
  font-size: 11px;
  color: #888;
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}
.cses-status.error { color: #f48771; }
.cses-status.success { color: #89d185; }
.cses-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px;
  resize: none;
  tab-size: 2;
}
.cses-stats {
  padding: 4px 12px;
  font-size: 11px;
  color: #888;
  background: #2d2d2d;
  border-top: 1px solid #3c3c3c;
  flex-shrink: 0;
}
CSS;

// CSES 编辑器 JS
$editorJs = <<<'JS'
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
JS;

// 插入数据库
$id = DB::insert('editor_plugins', [
    'developer_username' => 'system',
    'plugin_key' => 'cses_official',
    'name' => 'CSES 编辑器',
    'version' => '1.0.0',
    'description' => '官方 CSES 配置文件编辑器，移植自旧版 CSESCloud 平台。支持 JSON 格式化、验证、压缩，快捷键保存。',
    'extensions' => json_encode(['cses']),
    'editor_html' => $editorHtml,
    'editor_js' => $editorJs,
    'editor_css' => $editorCss,
    'icon' => 'ri-file-code-line',
    'status' => 'published',
    'is_official' => 1,
    'created_at' => $now,
    'updated_at' => $now
]);

echo "CSES 官方插件创建成功！\n";
echo "  ID: {$id}\n";
echo "  Plugin Key: cses_official\n";
echo "  状态: published\n";
echo "  注册后缀: .cses\n";
echo "  在轻编辑器中打开 .cses 文件即可自动调用此插件。\n";