<?php
require_once __DIR__ . '/../lib/bootstrap.php';
$a = DB::one("SELECT id, editor_js FROM apps WHERE app_key = 'examaware2'");
$js = $a['editor_js'];
$changes = 0;

// 在 revokeEnrollment 函数后面插入 deleteEnrollment
$old = <<<'JS'
async function revokeEnrollment(id) {
  if (!confirm('确认吊销该注册码？')) return;
  try {
    await window.CSES.request('controlApi', { action: 'enrollment_revoke', payload: { id: id } });
    refreshEnrollments();
  } catch (e) { alert('吊销失败: ' + e.message); }
}
JS;

$new = <<<'JS'
async function revokeEnrollment(id) {
  if (!confirm('确认吊销该注册码？')) return;
  try {
    await window.CSES.request('controlApi', { action: 'enrollment_revoke', payload: { id: id } });
    refreshEnrollments();
  } catch (e) { alert('吊销失败: ' + e.message); }
}

async function deleteEnrollment(id) {
  if (!confirm('确认删除该注册码？此操作不可撤销。')) return;
  try {
    await window.CSES.request('controlApi', { action: 'enrollment_delete', payload: { id: id } });
    refreshEnrollments();
  } catch (e) { alert('删除失败: ' + e.message); }
}
JS;

if (strpos($js, $old) !== false) {
    $js = str_replace($old, $new, $js);
    $changes++;
    echo "已添加 deleteEnrollment 函数定义\n";
} else {
    echo "ERROR: 未找到 revokeEnrollment 函数\n";
    // dump context
    $pos = strpos($js, 'revokeEnrollment');
    if ($pos !== false) echo substr($js, $pos, 300) . "\n";
}

if ($changes > 0) {
    DB::update('apps', ['editor_js' => $js, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$a['id']]);
    echo "已保存\n";
}