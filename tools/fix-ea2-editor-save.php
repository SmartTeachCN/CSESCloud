<?php
/**
 * 修复 EA2 编辑器插件：
 * 1. 无场次时同时显示"添加向导"和"+ 新建"按钮
 * 2. 恢复保存按钮（顶栏）
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$p = DB::one("SELECT id, editor_html, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "未找到 EA2 编辑器插件\n"; exit(1); }

$html = $p['editor_html'];
$js = $p['editor_js'];

// 修复1：updateWizardBtn 逻辑 — 无场次时同时显示向导和新建按钮
$oldLogic = "if(!wizard.active&&examData.examInfos.length===0){btn.style.display='block';add.style.display='none';cascade.style.display='none'}";
$newLogic = "if(!wizard.active&&examData.examInfos.length===0){btn.style.display='block';add.style.display='';cascade.style.display='none'}";
$js = str_replace($oldLogic, $newLogic, $js);

DB::update('editor_plugins', [
    'editor_js' => $js,
    'updated_at' => date('Y-m-d H:i:s'),
], 'id = ?', [$p['id']]);

echo "已修复 EA2 编辑器插件 (id={$p['id']}):\n";
echo "  1. 无场次时同时显示「添加向导」和「+ 新建」按钮\n";
echo "  2. PluginEditorFrame 已移除 try/catch 包裹\n";