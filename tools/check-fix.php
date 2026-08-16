<?php
require_once __DIR__ . '/../lib/bootstrap.php';
$p = DB::one("SELECT editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
$js = $p['editor_js'];
file_put_contents(__DIR__ . '/ea2-js-now.txt', $js);
echo "Dumped. Searching for wizNextSubject...\n";
$pos = strpos($js, 'wizNextSubject');
if ($pos !== false) {
    echo substr($js, $pos, 500) . "\n";
}