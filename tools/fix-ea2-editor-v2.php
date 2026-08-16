<?php
/**
 * 修复 EA2 编辑器插件：
 * 1. 添加保存按钮到 HTML
 * 2. 修复向导跨天时间顺延问题
 * 3. 修复 wizEndDay 不清除 startTime
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$p = DB::one("SELECT id, editor_html, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "未找到 EA2 编辑器插件\n"; exit(1); }

$html = $p['editor_html'];
$js = $p['editor_js'];
$changes = 0;

// ===== 修复1：添加保存按钮到 HTML 左栏顶 =====
$oldHeader = '<div class="ea2-panel-header-actions">';
$newHeader = '<div class="ea2-panel-header-actions"><button class="ea2-btn small primary" onclick="saveConfig()" title="Ctrl+S">保存</button> ';
if (strpos($html, $oldHeader) !== false && strpos($html, 'saveConfig()') === false) {
    $html = str_replace($oldHeader, $newHeader, $html);
    $changes++;
    echo "  1. 已添加保存按钮到 HTML\n";
}

// ===== 修复2：wizEndDay 不清除 startTime =====
$oldEndDay = "wizard.dayDate=formatLocalDate(d);wizard.startTime='';wizard.lunchSkipped=false;";
$newEndDay = "wizard.dayDate=formatLocalDate(d);wizard.lunchSkipped=false;";
if (strpos($js, $oldEndDay) !== false) {
    $js = str_replace($oldEndDay, $newEndDay, $js);
    $changes++;
    echo "  2. 已修复 wizEndDay 不清除 startTime\n";
}

// ===== 修复3：wizNextSubject 跨天判断 =====
// 读取当前 JS 确认格式
$p2 = DB::one("SELECT editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
$js2 = $p2['editor_js'];

$oldNextSubj = "if(wizard.subjects.length>0){var last=wizard.subjects[wizard.subjects.length-1];var lastEnd=new Date(last.end);curStart=new Date(lastEnd.getTime()+(last.break||0)*60000)}";
$newNextSubj = "if(wizard.subjects.length>0){var last=wizard.subjects[wizard.subjects.length-1];var lastDay=last.start.substring(0,10);if(lastDay!==wizard.dayDate){curStart=new Date(wizard.dayDate+'T'+wizard.startTime)}else{var lastEnd=new Date(last.end);curStart=new Date(lastEnd.getTime()+(last.break||0)*60000)}}";
if (strpos($js2, $oldNextSubj) !== false) {
    $js2 = str_replace($oldNextSubj, $newNextSubj, $js2);
    $changes++;
    echo "  3. 已修复 wizNextSubject 跨天判断\n";
} else {
    echo "  3. [跳过] 未找到目标代码\n";
    // 尝试查找相似代码
    $pos = strpos($js2, 'wizard.subjects.length>0){var last=wizard.subjects');
    if ($pos !== false) {
        echo "     找到相似代码: " . substr($js2, $pos, 100) . "\n";
    }
}

// ===== 修复4：wizNextSubject 中 wizEndDay 后不清除 startTime 的重复调用 =====
// wizEndDay 已经不清除 startTime 了，但 wizNextSubject 中还有一行 wizard.startTime=formatLocalTime(nextStart)
// 这行在 wizEndDay 之前执行，不受影响

if ($changes > 0) {
    DB::update('editor_plugins', [
        'editor_html' => $html,
        'editor_js' => $js2,
        'updated_at' => date('Y-m-d H:i:s'),
    ], 'id = ?', [$p['id']]);
    echo "\n已应用 {$changes} 处修复\n";
} else {
    echo "未找到需要修复的代码\n";
}