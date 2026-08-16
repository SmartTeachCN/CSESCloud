<?php
require_once __DIR__ . '/../lib/db.php';
$p = DB::one("SELECT id, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "NOT FOUND - plugin was deleted!\n"; exit; }
$js = $p['editor_js'];
// Check wizEndDay
if (preg_match('/function wizEndDay\(\)\{(.*?)\nfunction /s', $js, $m)) {
    echo "=== wizEndDay ===\n" . $m[1] . "\n";
}
// Check wizNextSubject
if (preg_match('/function wizNextSubject\(\)\{(.*?)\nfunction /s', $js, $m)) {
    echo "=== wizNextSubject ===\n" . $m[1] . "\n";
}