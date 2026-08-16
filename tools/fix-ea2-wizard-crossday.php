<?php
/**
 * 修复向导跨天时间顺延问题
 * wizEndDay 调用 wizNextSubject 保存待处理的科目时，
 * wizNextSubject 会更新 wizard.startTime 为下一场开始时间，
 * 导致第二天的时间被错误地设置为第一天最后一场的结束时间+休息。
 * 修复：在调用 wizNextSubject 前保存 wizard.startTime，调用后恢复。
 */
require_once __DIR__ . '/../lib/db.php';

$p = DB::one("SELECT id, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "NOT FOUND\n"; exit(1); }

$js = $p['editor_js'];
$changes = 0;

// 修复 wizEndDay：在调用 wizNextSubject 前保存 wizard.startTime，调用后恢复
$old = "if(subj&&subj.value.trim()&&wizard.editIdx<0){wizNextSubject();return}";
$new = "if(subj&&subj.value.trim()&&wizard.editIdx<0){var savedTime=wizard.startTime;wizNextSubject();wizard.startTime=savedTime;return}";

if (strpos($js, $old) !== false) {
    $js = str_replace($old, $new, $js);
    $changes++;
    echo "1. 已修复 wizEndDay 保存并恢复 startTime\n";
} else {
    echo "1. 未找到目标字符串: " . $old . "\n";
    // Show what we have
    if (preg_match('/if\(subj&&subj\.value\.trim\(\)&&wizard\.editIdx<0\)\{[^}]+\}/', $js, $m)) {
        echo "   当前: " . $m[0] . "\n";
    }
}

if ($changes > 0) {
    DB::update('editor_plugins', ['editor_js' => $js], 'id = ?', [$p['id']]);
    echo "\n已保存，共 $changes 处修改\n";
} else {
    echo "\n无修改\n";
}