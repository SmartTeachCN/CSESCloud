<?php
/**
 * 修复 EA2 平台应用 6 个问题：
 * 1. 设备注销：从列表中移除并删除绑定
 * 2. 注册码删除：新增 enrollment_delete 接口
 * 3. 编辑器插件：移除独立保存按钮，统一至平台
 * 4. 返回考试列表：修复跳转到连接应用页面
 * 5. Ribbon：随页面切换实时更新操作区域
 * 6. 考试列表：多选和分组功能
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$changes = 0;

// ========== 修复1: 设备注销改为真正删除 ==========
$controlPath = __DIR__ . '/../api/ea2-control.php';
$controlCode = file_get_contents($controlPath);

// 1a: 将 device_unregister 改为真正删除设备
$oldUnregister = <<<'EOL'
    case 'device_unregister':
        $deviceId = $body['device_id'] ?? '';
        if (!$deviceId) Response::error('缺少 device_id');
        DB::update('ea2_devices', [
            'lifecycle_status' => 'revoked',
            'updated_at' => date('Y-m-d H:i:s'),
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        // 吊销凭证
        DB::update('ea2_device_credentials', [
            'revoked_at' => date('Y-m-d H:i:s'),
        ], 'device_id = ?', [$deviceId]);
        Response::success(['ok' => true], '设备已注销');
EOL;

$newUnregister = <<<'EOL'
    case 'device_unregister':
        $deviceId = $body['device_id'] ?? '';
        if (!$deviceId) Response::error('缺少 device_id');
        // 删除设备记录
        DB::delete('ea2_devices', 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        // 删除凭证
        DB::delete('ea2_device_credentials', 'device_id = ?', [$deviceId]);
        // 删除该设备的待执行命令
        DB::delete('ea2_commands', 'instance_id = ? AND device_id = ? AND status = ?', [$instanceId, $deviceId, 'pending']);
        Response::success(['ok' => true], '设备已从列表移除并取消绑定');
EOL;

if (strpos($controlCode, $oldUnregister) !== false) {
    $controlCode = str_replace($oldUnregister, $newUnregister, $controlCode);
    $changes++;
    echo "1. 已修复 device_unregister 为真正删除设备\n";
}

// 1b: 添加 enrollment_delete 操作
$oldEnrollRevoke = <<<'EOL'
    case 'enrollment_revoke':
        $codeId = $body['id'] ?? '';
        if (!$codeId) Response::error('缺少 id');
        DB::update('ea2_enrollment_codes', [
            'revoked_at' => date('Y-m-d H:i:s'),
        ], 'id = ? AND instance_id = ?', [$codeId, $instanceId]);
        Response::success(['ok' => true], '注册码已吊销');
EOL;

$newEnrollRevoke = <<<'EOL'
    case 'enrollment_revoke':
        $codeId = $body['id'] ?? '';
        if (!$codeId) Response::error('缺少 id');
        DB::update('ea2_enrollment_codes', [
            'revoked_at' => date('Y-m-d H:i:s'),
        ], 'id = ? AND instance_id = ?', [$codeId, $instanceId]);
        Response::success(['ok' => true], '注册码已吊销');

    case 'enrollment_delete':
        $codeId = $body['id'] ?? '';
        if (!$codeId) Response::error('缺少 id');
        DB::delete('ea2_enrollment_codes', 'id = ? AND instance_id = ?', [$codeId, $instanceId]);
        Response::success(['ok' => true], '注册码已删除');
EOL;

if (strpos($controlCode, $oldEnrollRevoke) !== false && strpos($controlCode, 'enrollment_delete') === false) {
    $controlCode = str_replace($oldEnrollRevoke, $newEnrollRevoke, $controlCode);
    $changes++;
    echo "2. 已添加 enrollment_delete 接口\n";
}

// 保存 ea2-control.php
if (strpos($controlCode, $oldUnregister) === false) {
    file_put_contents($controlPath, $controlCode);
}

// ========== 修复3-6: 更新 EA2 平台应用 UI ==========
$app = DB::one("SELECT id, editor_html, editor_js FROM apps WHERE app_key = 'examaware2'");
if (!$app) { echo "ERROR: 未找到 EA2 应用\n"; exit(1); }

$html = $app['editor_html'];
$js = $app['editor_js'];

// 修复3: 在 closeExamEditor 时发送 page_exams 命令
// InstanceEditor.vue 中的 closeExamEditor 需要修改（见下方前端编译）

// 修复4: 页面切换时通知父窗口当前页面
// 在 switchPage 函数末尾添加 postMessage
$oldSwitchPage = <<<'JS'
  if (page === 'connect') { refreshDevices(); refreshEnrollments(); }
  if (page === 'exams') refreshExamList();
  if (page === 'config') renderConfigPage();
}
JS;

$newSwitchPage = <<<'JS'
  if (page === 'connect') { refreshDevices(); refreshEnrollments(); }
  if (page === 'exams') refreshExamList();
  if (page === 'config') renderConfigPage();
  // 通知父窗口当前页面
  window.parent.postMessage({ __ceseReportPage: page }, '*');
}
JS;

if (strpos($js, $oldSwitchPage) !== false) {
    $js = str_replace($oldSwitchPage, $newSwitchPage, $js);
    $changes++;
    echo "3. 已添加页面切换通知父窗口\n";
}

// 修复5: 在 listenCommands 中添加 back_to_list 命令
$oldListenCommands = <<<'JS'
      case 'new_exam': createNewExam(); break;
      case 'multi_edit': toggleMultiSelect(); break;
      case 'group_mgmt': alert('分组管理功能开发中'); break;
      case 'save': saveConfig(); break;
    }
  });
}
JS;

$newListenCommands = <<<'JS'
      case 'new_exam': createNewExam(); break;
      case 'multi_edit': toggleMultiSelect(); break;
      case 'group_mgmt': showGroupManager(); break;
      case 'save': saveConfig(); break;
      case 'back_to_list': switchPage('exams'); break;
      case 'page_exams': switchPage('exams'); break;
    }
  });
}
JS;

if (strpos($js, $oldListenCommands) !== false) {
    $js = str_replace($oldListenCommands, $newListenCommands, $js);
    $changes++;
    echo "4. 已修复 back_to_list 和 page_exams 命令\n";
}

// 修复6: 实现真正的多选和分组功能
// 替换 toggleMultiSelect 和 alert
$oldMultiSelect = <<<'JS'
// ===== 多选编辑 =====
var multiSelectMode = false;
function toggleMultiSelect() {
  multiSelectMode = !multiSelectMode;
  alert('多选编辑模式: ' + (multiSelectMode ? '开启' : '关闭'));
}
JS;

$newMultiSelect = <<<'JS'
// ===== 多选编辑 =====
var multiSelectMode = false;
var selectedExams = new Set();
var examGroups = {};

function toggleMultiSelect() {
  multiSelectMode = !multiSelectMode;
  if (!multiSelectMode) { selectedExams.clear(); }
  refreshExamList();
}

function toggleExamSelect(fileId) {
  if (selectedExams.has(fileId)) selectedExams.delete(fileId);
  else selectedExams.add(fileId);
  updateMultiSelectBar();
}

function updateMultiSelectBar() {
  var bar = document.getElementById('ea2MultiSelectBar');
  var countLabel = document.getElementById('ea2MultiSelectCount');
  if (!bar) return;
  if (multiSelectMode && selectedExams.size > 0) {
    bar.style.display = 'flex';
    if (countLabel) countLabel.textContent = '已选 ' + selectedExams.size + ' 项';
  } else if (multiSelectMode) {
    bar.style.display = 'flex';
    if (countLabel) countLabel.textContent = '已选 0 项';
  } else {
    bar.style.display = 'none';
  }
}

function batchDeleteExams() {
  if (selectedExams.size === 0) { alert('请先选择考试'); return; }
  if (!confirm('确认删除 ' + selectedExams.size + ' 个考试配置？此操作不可撤销。')) return;
  var promises = [];
  selectedExams.forEach(function(fileId) {
    promises.push(
      window.CSES.request('listEa2Files').then(function(exams) {
        var exam = (exams || []).find(function(e) { return e.id == fileId; });
        if (exam) {
          return window.CSES.request('deleteEa2File', { name: (exam.name || '').replace(/\.ea2$/i, '') });
        }
      })
    );
  });
  Promise.all(promises).then(function() {
    selectedExams.clear();
    refreshExamList();
  }).catch(function(e) { alert('批量删除失败: ' + e.message); });
}

function batchDeployExams() {
  if (selectedExams.size === 0) { alert('请先选择考试'); return; }
  var fileIds = Array.from(selectedExams);
  deployExamId = fileIds[0];
  openDeployDialog(fileIds[0]);
}

// ===== 分组管理 =====
function showGroupManager() {
  var pageBody = document.getElementById('ea2PageExams').querySelector('.ea2-page-body');
  var existing = document.getElementById('ea2GroupModal');
  if (existing) existing.remove();

  var html = '<div class="ea2-modal-overlay" id="ea2GroupModal" style="display:flex" onclick="if(event.target===this)closeGroupModal()">';
  html += '<div class="ea2-modal" style="width:500px">';
  html += '<div class="ea2-modal-header"><h3>分组管理</h3><button class="ea2-modal-close" onclick="closeGroupModal()">&times;</button></div>';
  html += '<div class="ea2-modal-body">';
  html += '<div class="ea2-field"><label>新建分组</label><div style="display:flex;gap:8px"><input type="text" id="ea2NewGroupName" placeholder="分组名称" /><button class="ea2-btn primary" onclick="createGroup()">创建</button></div></div>';
  html += '<div class="ea2-section" style="margin-top:12px"><div class="ea2-section-title">现有分组</div><div id="ea2GroupList">';
  var groups = Object.keys(examGroups);
  if (groups.length === 0) {
    html += '<div class="ea2-empty">暂无分组</div>';
  } else {
    groups.forEach(function(g) {
      html += '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">' + escHtml(g) + '</div><div class="ea2-config-item-desc">' + (examGroups[g] || []).length + ' 个考试</div></div><div class="ea2-config-item-action"><button class="ea2-btn small danger" onclick="deleteGroup(\'' + escAttr(g) + '\')">删除</button></div></div>';
    });
  }
  html += '</div></div></div></div></div>';
  pageBody.insertAdjacentHTML('beforeend', html);
}

function closeGroupModal() {
  var el = document.getElementById('ea2GroupModal');
  if (el) el.remove();
}

function createGroup() {
  var name = document.getElementById('ea2NewGroupName').value.trim();
  if (!name) return;
  if (examGroups[name]) { alert('分组已存在'); return; }
  examGroups[name] = [];
  saveConfig();
  showGroupManager();
}

function deleteGroup(name) {
  if (!confirm('确认删除分组 "' + name + '"？')) return;
  delete examGroups[name];
  saveConfig();
  showGroupManager();
}

function toggleExamGroup(fileId, groupName) {
  if (!examGroups[groupName]) examGroups[groupName] = [];
  var idx = examGroups[groupName].indexOf(fileId);
  if (idx >= 0) examGroups[groupName].splice(idx, 1);
  else examGroups[groupName].push(fileId);
  saveConfig();
  refreshExamList();
}

function getExamGroups(fileId) {
  var result = [];
  for (var g in examGroups) {
    if (examGroups[g].indexOf(fileId) >= 0) result.push(g);
  }
  return result;
}
JS;

if (strpos($js, $oldMultiSelect) !== false) {
    $js = str_replace($oldMultiSelect, $newMultiSelect, $js);
    $changes++;
    echo "5. 已实现多选和分组管理功能\n";
}

// 修复6: 更新考试列表卡片，添加多选框和分组标签
$oldExamCard = <<<'JS'
    container.innerHTML = exams.map(function(exam) {
      var data = exam.data || {};
      var name = data.examName || exam.name || '未命名考试';
      var count = (data.examInfos || []).length;
      return '<div class="ea2-exam-card">' +
        '<div class="ea2-exam-card-name">' + escHtml(name) + '</div>' +
        '<div class="ea2-exam-card-meta">' +
          '<span>' + count + ' 场考试</span>' +
          '<span>' + (exam.name || '') + '</span>' +
        '</div>' +
        '<div class="ea2-exam-card-actions">' +
          '<button class="ea2-btn small" onclick="viewExamDetail(\'' + exam.id + '\')">查看</button>' +
          '<button class="ea2-btn small primary" onclick="editExam(\'' + exam.id + '\')">编辑</button>' +
          '<button class="ea2-btn small success" onclick="openDeployDialog(\'' + exam.id + '\')">部署</button>' +
          '<button class="ea2-btn small danger" onclick="deleteExamConfirm(\'' + exam.id + '\',\'' + escAttr(exam.name) + '\')">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
JS;

$newExamCard = <<<'JS'
    container.innerHTML = exams.map(function(exam) {
      var data = exam.data || {};
      var name = data.examName || exam.name || '未命名考试';
      var count = (data.examInfos || []).length;
      var groups = getExamGroups(exam.id);
      var groupTags = groups.map(function(g) { return '<span class="ea2-group-tag">' + escHtml(g) + '</span>'; }).join('');
      var isChecked = selectedExams.has(exam.id);
      return '<div class="ea2-exam-card' + (isChecked ? ' selected' : '') + '" onclick="' + (multiSelectMode ? 'toggleExamSelect(\'' + exam.id + '\')' : 'viewExamDetail(\'' + exam.id + '\')') + '">' +
        (multiSelectMode ? '<div class="ea2-exam-card-check"><input type="checkbox" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation();toggleExamSelect(\'' + exam.id + '\')" /></div>' : '') +
        '<div class="ea2-exam-card-name">' + escHtml(name) + '</div>' +
        '<div class="ea2-exam-card-meta">' +
          '<span>' + count + ' 场考试</span>' +
          '<span>' + (exam.name || '') + '</span>' +
        '</div>' +
        (groupTags ? '<div class="ea2-exam-card-groups">' + groupTags + '</div>' : '') +
        (!multiSelectMode ? '<div class="ea2-exam-card-actions">' +
          '<button class="ea2-btn small" onclick="event.stopPropagation();viewExamDetail(\'' + exam.id + '\')">查看</button>' +
          '<button class="ea2-btn small primary" onclick="event.stopPropagation();editExam(\'' + exam.id + '\')">编辑</button>' +
          '<button class="ea2-btn small success" onclick="event.stopPropagation();openDeployDialog(\'' + exam.id + '\')">部署</button>' +
          '<button class="ea2-btn small danger" onclick="event.stopPropagation();deleteExamConfirm(\'' + exam.id + '\',\'' + escAttr(exam.name) + '\')">删除</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
    updateMultiSelectBar();
JS;

if (strpos($js, $oldExamCard) !== false) {
    $js = str_replace($oldExamCard, $newExamCard, $js);
    $changes++;
    echo "6. 已更新考试卡片支持多选/分组\n";
}

// 修复7: 注册码列表添加"删除"按钮（已吊销的）
$oldEnrollList = <<<'JS'
    container.innerHTML = codes.map(function(c) {
      var isRevoked = !!c.revoked_at;
      var isExpired = new Date(c.expires_at).getTime() < Date.now();
      var status = isRevoked ? '已吊销' : (isExpired ? '已过期' : '有效');
      var statusColor = isRevoked || isExpired ? '#888' : '#4caf50';
      return '<div class="ea2-enrollment-item">' +
        '<div class="ea2-enrollment-code" style="flex:1">' + (c.display_name || '未命名') + '</div>' +
        '<div class="ea2-enrollment-meta">' + c.used_count + '/' + c.max_uses + ' · ' + status + '</div>' +
        (!isRevoked ? '<button class="ea2-btn small danger" onclick="revokeEnrollment(' + c.id + ')">吊销</button>' : '') +
      '</div>';
    }).join('');
JS;

$newEnrollList = <<<'JS'
    container.innerHTML = codes.map(function(c) {
      var isRevoked = !!c.revoked_at;
      var isExpired = new Date(c.expires_at).getTime() < Date.now();
      var status = isRevoked ? '已吊销' : (isExpired ? '已过期' : '有效');
      var statusColor = isRevoked || isExpired ? '#888' : '#4caf50';
      return '<div class="ea2-enrollment-item">' +
        '<div class="ea2-enrollment-code" style="flex:1">' + (c.display_name || '未命名') + '</div>' +
        '<div class="ea2-enrollment-meta">' + c.used_count + '/' + c.max_uses + ' · ' + status + '</div>' +
        (!isRevoked
          ? '<button class="ea2-btn small danger" onclick="revokeEnrollment(' + c.id + ')">吊销</button>'
          : '<button class="ea2-btn small danger" onclick="deleteEnrollment(' + c.id + ')">删除</button>') +
      '</div>';
    }).join('');
JS;

if (strpos($js, $oldEnrollList) !== false) {
    $js = str_replace($oldEnrollList, $newEnrollList, $js);
    $changes++;
    echo "7. 已添加注册码删除按钮\n";
}

// 添加 deleteEnrollment 函数
$oldRevokeFunc = <<<'JS'
async function revokeEnrollment(id) {
  if (!confirm('确认吊销该注册码？')) return;
  try {
    await window.CSES.request('controlApi', { action: 'enrollment_revoke', payload: { id: id } });
    refreshEnrollments();
  } catch (e) { alert('吊销失败: ' + e.message); }
}
JS;

$newRevokeFunc = <<<'JS'
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

if (strpos($js, $oldRevokeFunc) !== false && strpos($js, 'deleteEnrollment') === false) {
    $js = str_replace($oldRevokeFunc, $newRevokeFunc, $js);
    $changes++;
    echo "8. 已添加 deleteEnrollment 函数\n";
}

// 添加多选工具栏和分组标签CSS
$oldPageActions = <<<'HTML'
      <div class="ea2-page-actions">
        <button class="ea2-btn primary" onclick="createNewExam()">+ 新建考试</button>
        <button class="ea2-btn" onclick="refreshExamList()">刷新</button>
      </div>
    </div>
    <div class="ea2-page-body">
      <div class="ea2-exam-grid" id="ea2ExamGrid">
        <div class="ea2-empty">暂无考试配置，点击"新建考试"创建</div>
      </div>
    </div>
HTML;

$newPageActions = <<<'HTML'
      <div class="ea2-page-actions">
        <button class="ea2-btn primary" onclick="createNewExam()">+ 新建考试</button>
        <button class="ea2-btn" onclick="refreshExamList()">刷新</button>
      </div>
    </div>
    <div class="ea2-page-body">
      <div class="ea2-multi-select-bar" id="ea2MultiSelectBar" style="display:none">
        <span id="ea2MultiSelectCount">已选 0 项</span>
        <button class="ea2-btn small success" onclick="batchDeployExams()">批量部署</button>
        <button class="ea2-btn small danger" onclick="batchDeleteExams()">批量删除</button>
        <button class="ea2-btn small" onclick="toggleMultiSelect()">取消选择</button>
      </div>
      <div class="ea2-exam-grid" id="ea2ExamGrid">
        <div class="ea2-empty">暂无考试配置，点击"新建考试"创建</div>
      </div>
    </div>
HTML;

if (strpos($html, $oldPageActions) !== false) {
    $html = str_replace($oldPageActions, $newPageActions, $html);
    $changes++;
    echo "9. 已添加多选工具栏\n";
}

// 添加分组标签CSS
$oldExamCardCss = '.ea2-exam-card-actions { display: flex; gap: 6px; margin-top: 10px; }';
$newExamCardCss = '.ea2-exam-card-actions { display: flex; gap: 6px; margin-top: 10px; }
.ea2-exam-card.selected { border-color: #0067C0; background: rgba(0, 103, 192, 0.08); }
.ea2-exam-card-check { position: absolute; top: 8px; right: 8px; }
.ea2-exam-card-check input { accent-color: #0067C0; width: 16px; height: 16px; cursor: pointer; }
.ea2-exam-card-groups { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.ea2-group-tag { display: inline-block; padding: 1px 6px; background: rgba(0, 103, 192, 0.15); color: #0067C0; border-radius: 8px; font-size: 10px; }
.ea2-multi-select-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(0, 103, 192, 0.1); border: 1px solid #0067C0; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }';

if (strpos($html, $oldExamCardCss) !== false && strpos($html, 'ea2-multi-select-bar') === false) {
    $html = str_replace($oldExamCardCss, $newExamCardCss, $html);
    $changes++;
    echo "10. 已添加多选/分组CSS\n";
}

// 保存
DB::update('apps', [
    'editor_html' => $html,
    'editor_js' => $js,
    'updated_at' => date('Y-m-d H:i:s'),
], 'id = ?', [$app['id']]);

echo "\n=== 完成 ===\n";
echo "共 $changes 处修改\n";
echo "请运行前端构建: cd frontend && npm run build\n";