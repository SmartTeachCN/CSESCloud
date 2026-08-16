<?php
require_once __DIR__ . '/lib/bootstrap.php';

$r = DB::one("SELECT id, version, updated_at, SUBSTRING(editor_html, 1, 300) as preview FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if ($r) {
    echo "=== editor_plugins (ea2_exam_editor) ===\n";
    echo "ID: " . $r['id'] . "\n";
    echo "Version: " . $r['version'] . "\n";
    echo "Updated: " . $r['updated_at'] . "\n";
    echo "HTML preview: " . $r['preview'] . "\n";
} else {
    echo "ea2_exam_editor NOT FOUND in editor_plugins\n";
}

echo "\n=== instances with custom editor_html ===\n";
$instances = DB::all("SELECT id, instance_uid, SUBSTRING(editor_html, 1, 200) as preview FROM instances WHERE editor_html IS NOT NULL AND editor_html != '' LIMIT 5");
if ($instances) {
    foreach ($instances as $inst) {
        echo "ID: {$inst['id']}, UID: {$inst['instance_uid']}\n";
        echo "HTML preview: {$inst['preview']}\n\n";
    }
} else {
    echo "No custom editor instances found\n";
}