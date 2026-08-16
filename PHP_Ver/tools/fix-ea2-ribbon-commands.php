<?php
/**
 * 补充修复：添加 show_enrollment 和 refresh_devices 命令处理
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$app = DB::one("SELECT id, editor_js FROM apps WHERE app_key = 'examaware2'");
if (!$app) { echo "ERROR\n"; exit(1); }

$js = $app['editor_js'];
$changes = 0;

// 添加 show_enrollment 和 refresh_devices 命令
$oldListen = <<<'JS'
      case 'new_exam': createNewExam(); break;
      case 'multi_edit': toggleMultiSelect(); break;
      case 'group_mgmt': showGroupManager(); break;
      case 'save': saveConfig(); break;
      case 'back_to_list': switchPage('exams'); break;
      case 'page_exams': switchPage('exams'); break;
JS;

$newListen = <<<'JS'
      case 'new_exam': createNewExam(); break;
      case 'multi_edit': toggleMultiSelect(); break;
      case 'group_mgmt': showGroupManager(); break;
      case 'save': saveConfig(); break;
      case 'back_to_list': switchPage('exams'); break;
      case 'page_exams': switchPage('exams'); break;
      case 'show_enrollment': showEnrollmentDialog(); break;
      case 'refresh_devices': refreshDevices(); refreshEnrollments(); break;
JS;

if (strpos($js, $oldListen) !== false && strpos($js, 'show_enrollment') === false) {
    $js = str_replace($oldListen, $newListen, $js);
    $changes++;
    echo "已添加 show_enrollment 和 refresh_devices 命令\n";
}

if ($changes > 0) {
    DB::update('apps', ['editor_js' => $js, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$app['id']]);
    echo "已保存\n";
} else {
    echo "无修改\n";
}