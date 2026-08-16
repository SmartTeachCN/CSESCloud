<?php
require_once __DIR__ . '/../lib/bootstrap.php';
$a = DB::one("SELECT id, editor_js FROM apps WHERE app_key = 'examaware2'");
$js = $a['editor_js'];

// Find deleteEnrollment and show surrounding context
$pos = strpos($js, 'deleteEnrollment');
if ($pos !== false) {
    $start = max(0, $pos - 100);
    $len = min(500, strlen($js) - $start);
    echo "=== Context around deleteEnrollment ===\n";
    echo substr($js, $start, $len) . "\n";
}

// Check for common JS errors
$line = 1;
foreach (explode("\n", $js) as $l) {
    if (strpos($l, 'deleteEnrollment') !== false) {
        echo "Line $line: " . $l . "\n";
    }
    $line++;
}