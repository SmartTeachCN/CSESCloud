<?php
require_once __DIR__ . '/../lib/bootstrap.php';
$p = DB::one("SELECT editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
$js = $p['editor_js'];

echo "wizSaveAndGoMeal in DB: " . (strpos($js, 'wizSaveAndGoMeal') !== false ? "YES" : "NO") . "\n";
echo "wizSaveAndGoMeal( in DB: " . (strpos($js, "wizSaveAndGoMeal(") !== false ? "YES" : "NO") . "\n";
echo "function wizSaveAndGoMeal in DB: " . (preg_match('/function\s+wizSaveAndGoMeal/', $js) ? "YES" : "NO") . "\n";

// Show context
$pos = strpos($js, 'wizSaveAndGoMeal');
if ($pos !== false) {
    echo "\nContext: " . substr($js, max(0, $pos - 20), 100) . "\n";
} else {
    // Check if the button was added
    $pos = strpos($js, '保存并配置');
    if ($pos !== false) {
        echo "\nFound '保存并配置' at: " . $pos . "\n";
        echo substr($js, max(0, $pos - 20), 100) . "\n";
    }
}