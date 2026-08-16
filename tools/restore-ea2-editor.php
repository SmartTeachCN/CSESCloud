<?php
/**
 * 恢复 EA2 考试档案编辑器（完整复杂版）
 * 包含：四象限布局、考试创建向导、饭空检测、可拖拽分割线、问题面板
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$now = date('Y-m-d H:i:s');

// ===== 编辑器 HTML（四象限布局 + 向导） =====
$editorHtml = <<<'HTML'
<div class="ea2-editor">
  <!-- 左栏：场次列表 + 考试信息 -->
  <div class="ea2-panel" id="ea2Left">
    <div id="ea2LeftTop">
      <div class="ea2-panel-header">
        <span>考试场次</span>
        <div class="ea2-panel-header-actions">
          <button class="ea2-btn small primary" onclick="saveConfig()" title="Ctrl+S">保存</button>
          <button class="ea2-btn small" id="ea2WizardBtn" onclick="startWizard()" style="display:none">添加向导</button>
          <button class="ea2-btn small" id="ea2AddBtn" onclick="addExamInfo()">+ 新建</button>
          <button class="ea2-btn small" id="ea2CascadeBtn" onclick="wizCascadeAll()" style="display:none">顺延</button>
        </div>
      </div>
      <div class="ea2-scroll" id="ea2ExamList"></div>
      <div class="ea2-empty-hint" id="ea2EmptyHint">暂无场次，点击「添加向导」或「+ 新建」</div>
    </div>
    <div class="ea2-splitter" id="ea2SplitterH1"></div>
    <div id="ea2LeftBottom">
      <div class="ea2-panel-header">考试信息</div>
      <div class="ea2-scroll">
        <div class="ea2-field"><label>考试名称 <span class="required">*</span></label><input type="text" id="ea2ExamName" placeholder="例如：2026年秋季期末考试" oninput="onFieldChange()" /></div>
        <div class="ea2-field"><label>提示信息</label><textarea id="ea2Message" rows="3" placeholder="考试提示信息" oninput="onFieldChange()"></textarea></div>
      </div>
    </div>
  </div>
  <div class="ea2-splitter" id="ea2SplitterV"></div>
  <!-- 右栏：编辑区域 + 问题栏 -->
  <div class="ea2-panel" id="ea2Right">
    <div id="ea2RightTop">
      <div class="ea2-panel-header" id="ea2DetailTitle">选择左侧场次以查看详情</div>
      <div class="ea2-scroll" id="ea2ExamDetail"></div>
    </div>
    <div class="ea2-splitter" id="ea2SplitterH2"></div>
    <div id="ea2RightBottom" class="collapsed">
      <div class="ea2-panel-header" onclick="toggleIssues()">
        <span>问题 (<span id="ea2IssueCount">0</span>)</span>
        <span class="ea2-toggle-icon" id="ea2ToggleIcon">▸</span>
      </div>
      <div class="ea2-issue-list" id="ea2IssueList"></div>
      <div class="ea2-empty-hint" id="ea2IssueEmpty" style="padding:8px">无问题</div>
    </div>
  </div>
  <!-- 移动端底部问题栏 -->
  <div class="ea2-mobile-bottom">
    <div class="ea2-mobile-bottom-bar" onclick="toggleMobileBottom()">
      <span id="ea2MobileBottomLabel">问题 (0)</span>
      <span class="ea2-toggle-icon" id="ea2MobileToggleIcon">▸</span>
    </div>
    <div class="ea2-mobile-bottom-body" id="ea2MobileBottomBody" style="display:none">
      <div class="ea2-issue-list" id="ea2MobileIssueList"></div>
      <div class="ea2-empty-hint" id="ea2MobileIssueEmpty" style="padding:4px">无问题</div>
    </div>
  </div>
</div>
HTML;

// ===== 编辑器 CSS（深色主题 + 四象限布局 + 向导样式） =====
$editorCss = <<<'CSS'
:root { --ea2-bg: #1e1e1e; --ea2-bg2: #252526; --ea2-bg3: #2d2d2d; --ea2-border: #3c3c3c; --ea2-text: #d4d4d4; --ea2-text2: #999; --ea2-text3: #666; --ea2-accent: #0067C0; --ea2-accent-hover: #005aaf; --ea2-error: #f48771; --ea2-warning: #d4a72c; --ea2-success: #4caf50; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--ea2-bg); color: var(--ea2-text); font-size: 13px; overflow: hidden; }
.ea2-editor { display: flex; height: 100%; width: 100%; overflow: hidden; }
.ea2-panel { display: flex; flex-direction: column; overflow: hidden; }
#ea2Left { flex: 0 0 280px; background: var(--ea2-bg2); border-right: 1px solid var(--ea2-border); }
#ea2Right { flex: 1; display: flex; flex-direction: column; }
#ea2LeftTop { flex: 2; min-height: 40px; overflow: hidden; display: flex; flex-direction: column; }
#ea2LeftBottom { flex: 1; min-height: 40px; overflow: hidden; display: flex; flex-direction: column; }
#ea2RightTop { flex: 2; min-height: 40px; overflow: hidden; display: flex; flex-direction: column; }
#ea2RightBottom { flex: 1; min-height: 20px; overflow: hidden; display: flex; flex-direction: column; }
#ea2RightBottom.collapsed { flex: 0 0 32px; }
#ea2RightBottom.collapsed .ea2-issue-list,
#ea2RightBottom.collapsed .ea2-empty-hint { display: none; }
.ea2-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; font-size: 12px; font-weight: 600; color: var(--ea2-text2); background: var(--ea2-bg3); border-bottom: 1px solid var(--ea2-border); flex-shrink: 0; cursor: default; }
.ea2-panel-header-actions { display: flex; gap: 4px; }
.ea2-scroll { flex: 1; overflow-y: auto; padding: 8px; }
.ea2-scroll::-webkit-scrollbar { width: 6px; }
.ea2-scroll::-webkit-scrollbar-track { background: transparent; }
.ea2-scroll::-webkit-scrollbar-thumb { background: #424242; border-radius: 3px; }
.ea2-splitter { background: transparent; z-index: 10; }
.ea2-splitter:hover, .ea2-splitter.active { background: var(--ea2-accent); }
#ea2SplitterV { width: 4px; cursor: col-resize; flex-shrink: 0; }
#ea2SplitterH1 { height: 4px; cursor: row-resize; flex-shrink: 0; background: var(--ea2-border); }
#ea2SplitterH2 { height: 4px; cursor: row-resize; flex-shrink: 0; background: var(--ea2-border); }
.ea2-btn { display: inline-flex; align-items: center; padding: 4px 10px; background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 4px; font-size: 11px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.ea2-btn:hover { background: #4c4c4c; }
.ea2-btn.primary { background: var(--ea2-accent); color: white; border-color: var(--ea2-accent); }
.ea2-btn.primary:hover { background: var(--ea2-accent-hover); }
.ea2-btn.small { padding: 2px 8px; font-size: 10px; }
.ea2-btn.danger { color: var(--ea2-error); border-color: #5a2a2a; }
.ea2-btn.danger:hover { background: #5a2a2a; }
.ea2-btn.large { padding: 8px 20px; font-size: 13px; }
.ea2-field { padding: 4px 0; }
.ea2-field label { display: block; font-size: 10px; font-weight: 500; color: var(--ea2-text2); margin-bottom: 2px; }
.ea2-field .required { color: var(--ea2-error); }
.ea2-field input[type="text"],
.ea2-field input[type="number"],
.ea2-field input[type="date"],
.ea2-field input[type="time"],
.ea2-field input[type="datetime-local"],
.ea2-field textarea,
.ea2-field select { width: 100%; padding: 5px 8px; background: var(--ea2-bg); color: var(--ea2-text); border: 1px solid var(--ea2-border); border-radius: 3px; font-size: 11px; font-family: inherit; outline: none; }
.ea2-field input:focus, .ea2-field textarea:focus, .ea2-field select:focus { border-color: var(--ea2-accent); }
.ea2-field textarea { resize: vertical; min-height: 48px; }
.ea2-field input[type="number"] { width: 80px; }
.ea2-empty-hint { padding: 16px; text-align: center; color: var(--ea2-text3); font-size: 11px; }

/* 场次列表 */
.ea2-exam-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #333; cursor: pointer; font-size: 11px; border-left: 3px solid transparent; }
.ea2-exam-item:hover { background: #2a2a2a; }
.ea2-exam-item.selected { background: #1a3a5c; border-left-color: var(--ea2-accent); }
.ea2-exam-item.wizard-item { color: #888; border-left-color: var(--ea2-warning); }
.ea2-exam-item-index { font-weight: 600; color: var(--ea2-accent); min-width: 28px; }
.ea2-exam-item.wizard-item .ea2-exam-item-index { color: var(--ea2-warning); }
.ea2-exam-item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ea2-exam-item-time { color: #888; font-size: 10px; white-space: nowrap; }
.ea2-exam-item-del { width: 18px; height: 18px; background: transparent; border: none; color: #888; cursor: pointer; font-size: 14px; line-height: 1; border-radius: 2px; flex-shrink: 0; }
.ea2-exam-item-del:hover { color: var(--ea2-error); background: #3a2020; }

/* 详情 */
.ea2-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
.ea2-detail-grid .ea2-field:first-child { grid-column: 1/-1; }
.ea2-materials { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--ea2-border); }
.ea2-materials-title { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--ea2-text2); margin-bottom: 4px; }
.ea2-material-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.ea2-material-row .ea2-field { flex: 1; }
.ea2-material-row .ea2-field label { display: none; }
.ea2-material-remove { width: 20px; height: 20px; background: transparent; border: 1px solid #5a2a2a; border-radius: 3px; color: var(--ea2-error); cursor: pointer; font-size: 12px; flex-shrink: 0; margin-top: 12px; }
.ea2-material-remove:hover { background: #5a2a2a; }

/* 向导 */
.ea2-wizard { padding: 8px; }
.ea2-wizard h3 { font-size: 14px; margin-bottom: 4px; color: var(--ea2-text); }
.ea2-wizard-subtitle { font-size: 11px; color: var(--ea2-text2); margin-bottom: 12px; }
.ea2-wizard-step { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; margin-bottom: 12px; color: var(--ea2-text); }
.ea2-wizard-step-icon { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: var(--ea2-accent); color: white; border-radius: 50%; font-size: 12px; flex-shrink: 0; }
.ea2-wizard-field { margin-bottom: 8px; }
.ea2-wizard-field label { display: block; font-size: 10px; color: var(--ea2-text2); margin-bottom: 2px; }
.ea2-wizard-field input[type="text"],
.ea2-wizard-field input[type="number"],
.ea2-wizard-field input[type="date"],
.ea2-wizard-field input[type="time"],
.ea2-wizard-field input[type="datetime-local"] { width: 100%; padding: 6px 10px; background: var(--ea2-bg); color: var(--ea2-text); border: 1px solid var(--ea2-border); border-radius: 4px; font-size: 12px; font-family: inherit; outline: none; }
.ea2-wizard-field input:focus { border-color: var(--ea2-accent); }
.ea2-wizard-row { display: flex; gap: 8px; margin-bottom: 8px; }
.ea2-wizard-field.narrow { flex: 1; }
.ea2-wizard-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }

/* 科目预设 */
.ea2-preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 4px; margin-bottom: 10px; }
.ea2-preset-chip { display: flex; flex-direction: column; align-items: center; padding: 6px 4px; background: var(--ea2-bg); border: 1px solid var(--ea2-border); border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit; color: var(--ea2-text); transition: all 0.15s; }
.ea2-preset-chip:hover { border-color: var(--ea2-accent); background: #1a2a3a; }
.ea2-preset-chip.selected { border-color: var(--ea2-accent); background: #1a3a5c; font-weight: 600; }
.preset-name { font-weight: 500; }
.preset-dur { font-size: 10px; color: var(--ea2-text2); margin-top: 1px; }

/* 休息预设 */
.ea2-preset-breaks { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.ea2-preset-break { padding: 3px 10px; background: var(--ea2-bg); border: 1px solid var(--ea2-border); border-radius: 4px; cursor: pointer; font-size: 11px; font-family: inherit; color: var(--ea2-text); }
.ea2-preset-break:hover { border-color: var(--ea2-accent); background: #1a2a3a; }
.ea2-preset-break.selected { border-color: var(--ea2-accent); background: #1a3a5c; font-weight: 600; }
.ea2-preset-break.clear { color: var(--ea2-text2); border-style: dashed; }
.ea2-preset-break.clear.selected { color: var(--ea2-text); }

/* 材料标签 */
.ea2-tag-list { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ea2-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: #2a2a2a; border: 1px solid #444; border-radius: 12px; font-size: 10px; }
.ea2-tag-remove { width: 14px; height: 14px; background: transparent; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 0; line-height: 1; }
.ea2-tag-remove:hover { color: var(--ea2-error); }
.ea2-tag-add { padding: 2px 8px; background: transparent; border: 1px dashed #555; border-radius: 12px; cursor: pointer; font-size: 10px; color: var(--ea2-text2); font-family: inherit; }
.ea2-tag-add:hover { border-color: var(--ea2-accent); color: var(--ea2-text); }

/* 问题列表 */
.ea2-issue-list { padding: 4px; overflow-y: auto; }
.ea2-issue-item { display: flex; align-items: flex-start; gap: 6px; padding: 3px 6px; font-size: 10px; line-height: 1.4; }
.ea2-issue-item.error { color: var(--ea2-error); }
.ea2-issue-item.warning { color: var(--ea2-warning); }
.ea2-issue-icon { flex-shrink: 0; margin-top: 1px; }
.ea2-toggle-icon { font-size: 10px; transition: transform 0.2s; }
.ea2-toggle-icon.open { transform: rotate(90deg); }

/* 移动端底部 */
.ea2-mobile-bottom { display: none; }
@media (max-width: 768px) {
  .ea2-mobile-bottom { display: flex; flex-direction: column; }
  #ea2Left { flex: 0 0 200px; }
  #ea2RightBottom { display: none; }
}
.ea2-mobile-bottom-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--ea2-bg3); border-top: 1px solid var(--ea2-border); cursor: pointer; font-size: 11px; color: var(--ea2-text2); }
.ea2-mobile-bottom-body { max-height: 150px; overflow-y: auto; }
CSS;

// ===== 编辑器 JS（完整版） =====
$editorJs = file_get_contents(__DIR__ . '/ea2-js-now.txt');

// ===== 写入数据库 =====
$existing = DB::one("SELECT id FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");

if ($existing) {
    DB::update('editor_plugins', [
        'editor_html' => $editorHtml,
        'editor_js' => $editorJs,
        'editor_css' => $editorCss,
        'version' => '2.0.0',
        'updated_at' => $now,
    ], 'id = ?', [$existing['id']]);
    echo "EA2 编辑器插件已恢复到 v2.0.0（四象限布局 + 向导 + 饭空检测）\n";
} else {
    DB::insert('editor_plugins', [
        'developer_username' => 'system',
        'plugin_key' => 'ea2_exam_editor',
        'name' => 'EA2 考试档案编辑器',
        'version' => '2.0.0',
        'description' => 'ExamAware2 考试档案结构化编辑器（完整版）。支持四象限布局、考试创建向导、饭空检测、时间顺延、可拖拽分割线。',
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
}

echo "  Plugin Key: ea2_exam_editor\n";
echo "  版本: 2.0.0\n";
echo "  功能: 四象限布局、考试创建向导、饭空检测、时间顺延\n";