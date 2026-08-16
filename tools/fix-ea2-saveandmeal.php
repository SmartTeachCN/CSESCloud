<?php
require_once __DIR__ . '/../lib/bootstrap.php';
$p = DB::one("SELECT id, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
$js = $p['editor_js'];

$hasFuncDef = preg_match('/function\s+wizSaveAndGoMeal/', $js);
$hasButtonRef = strpos($js, 'wizSaveAndGoMeal') !== false;

if (!$hasFuncDef && $hasButtonRef) {
    // Insert function definition after wizGoMeal
    $needle = "function wizGoMeal(type){wizard.step=type;renderAll()}";
    $pos = strpos($js, $needle);
    if ($pos !== false) {
        $end = $pos + strlen($needle);
        $before = substr($js, 0, $end);
        $after = substr($js, $end);
        $newFunc = "\n\nfunction wizSaveAndGoMeal(type){\n  var subj=document.getElementById('wizSubject').value.trim();\n  if(subj){wizNextSubject()}\n  wizard.step=type;renderAll();\n}";
        $js = $before . $newFunc . $after;
        DB::update('editor_plugins', ['editor_js' => $js, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$p['id']]);
        file_put_contents(__DIR__ . '/ea2-js-now.txt', $js);
        echo "Added wizSaveAndGoMeal function definition\n";
    } else {
        echo "Could not find wizGoMeal function\n";
    }
} else {
    echo "Already OK: funcDef=" . ($hasFuncDef ? "YES" : "NO") . " btnRef=" . ($hasButtonRef ? "YES" : "NO") . "\n";
}