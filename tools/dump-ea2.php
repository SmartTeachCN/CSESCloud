<?php
require_once __DIR__ . '/../lib/bootstrap.php';
$p = DB::one("SELECT editor_html, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
file_put_contents(__DIR__ . '/ea2-html.txt', $p['editor_html']);
file_put_contents(__DIR__ . '/ea2-js.txt', $p['editor_js']);
echo "OK\n";