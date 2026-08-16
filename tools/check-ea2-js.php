<?php
require_once __DIR__ . '/../lib/db.php';
$p = DB::one("SELECT editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "NOT FOUND\n"; exit; }
$js = $p['editor_js'];
// Find wizEndDay function
preg_match('/function wizEndDay\(\)\{(.*?)\nfunction /s', $js, $m);
if ($m) echo "wizEndDay:\n" . $m[1] . "\n\n";
// Find wizNextSubject 
preg_match('/function wizNextSubject\(\)\{(.*?)\nfunction /s', $js, $m);
if ($m) echo "wizNextSubject:\n" . $m[1] . "\n";