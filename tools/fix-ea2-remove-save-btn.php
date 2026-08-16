<?php
/**
 * 修复 #3: 移除编辑器插件中的独立保存按钮
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$p = DB::one("SELECT id, editor_html FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "ERROR\n"; exit(1); }

$html = $p['editor_html'];

// 移除保存按钮
$old = '<button class="ea2-btn small primary" onclick="saveConfig()" title="Ctrl+S">保存</button> ';
if (strpos($html, $old) !== false) {
    $html = str_replace($old, '', $html);
    DB::update('editor_plugins', ['editor_html' => $html, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$p['id']]);
    echo "已移除编辑器插件的独立保存按钮\n";
} else {
    echo "未找到保存按钮（可能已移除）\n";
}