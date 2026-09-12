// 实例编辑器

var currentPage = 'connect';
var selectedExamId = null;
var deployExamId = null;
var configCache = {};
var lastEnrollCode = null;

// ===== 初始化 =====
(function init() {
  loadConfig();
  switchPage('connect');
  listenCommands();
})();

function listenCommands() {
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.__ceseCommand) return;
    var cmd = e.data.__ceseCommand;
    switch (cmd) {
      case 'page_connect': switchPage('connect'); break;
      case 'page_exams': switchPage('exams'); break;
      case 'page_config': switchPage('config'); break;
      case 'new_exam': createNewExam(); break;
      case 'multi_edit': toggleMultiSelect(); break;
      case 'group_mgmt': showGroupManager(); break;
      case 'save': saveConfig(); break;
      case 'back_to_list': switchPage('exams'); break;
      case 'page_exams': switchPage('exams'); break;
      case 'show_enrollment': showEnrollmentDialog(); break;
      case 'refresh_devices': refreshDevices(); refreshEnrollments(); break;
    }
  });
}

// ===== 页面切换 =====
function switchPage(page) {
  currentPage = page;
  document.getElementById('ea2PageConnect').style.display = page === 'connect' ? '' : 'none';
  document.getElementById('ea2PageExams').style.display = page === 'exams' ? '' : 'none';
  document.getElementById('ea2PageConfig').style.display = page === 'config' ? '' : 'none';

  if (page === 'connect') { refreshDevices(); refreshEnrollments(); }
  if (page === 'exams') refreshExamList();
  if (page === 'config') renderConfigPage();
  // 通知父窗口当前页面
  window.parent.postMessage({ __ceseReportPage: page }, '*');
}

// ===== 设备管理 =====
async function refreshDevices() {
  try {
    var res = await window.CSES.request('controlApi', { action: 'device_list', payload: {} });
    var devices = res || [];
    renderDeviceList(devices);
    updateDeviceStats(devices);
  } catch (e) { console.error('获取设备列表失败:', e); }
}

function renderDeviceList(devices) {
  var container = document.getElementById('ea2DeviceList');
  if (!devices || devices.length === 0) {
    container.innerHTML = '<div class="ea2-empty">暂无设备连接，请生成注册码并让设备注册</div>';
    return;
  }
  var now = Date.now();
  container.innerHTML = devices.map(function(d) {
    var lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
    var isOnline = (now - lastSeen) < 60000;
    var statusClass = isOnline ? 'online' : 'offline';
    var statusText = isOnline ? '在线' : '离线';
    var notes = d.notes || '';
    var protocol = d.protocol || 'poll';
    var protocolLabel = protocol === 'ws' ? 'WebSocket' : '长轮询';
    var rep = d.last_reported_state || {};
    var cur = rep.currentExam && rep.currentExam.status === 'playing' ? rep.currentExam : null;
    var playingHtml = cur
      ? '<div class="ea2-device-playing">&#9654; 播放中: ' + escHtml(cur.exam_name || '未命名') + (cur.started_at ? '（' + fmtTime(cur.started_at) + '）' : '') + '</div>'
      : (isOnline ? '<div class="ea2-device-idle">空闲</div>' : '');
    var stopBtn = cur
      ? '<button class="ea2-btn small danger" onclick="stopDisplay(\'' + d.device_id + '\',\'' + escAttr(cur.deployment_id || '') + '\')">停止显示</button>'
      : '';
    return '<div class="ea2-device-item">' +
      '<span class="ea2-device-status ' + statusClass + '"></span>' +
      '<div class="ea2-device-info">' +
        '<div class="ea2-device-name">' + escHtml(d.display_name) + '</div>' +
        '<div class="ea2-device-meta">' + (d.platform || '未知平台') + ' · ' + (d.app_version || '') + ' · ' + statusText + ' · 协议: ' + protocolLabel + '</div>' +
        playingHtml +
        (notes ? '<div class="ea2-device-notes">' + escHtml(notes) + '</div>' : '') +
      '</div>' +
      '<div class="ea2-device-actions">' +
        '<select class="ea2-protocol-select" onchange="setDeviceProtocol(\'' + d.device_id + '\', this.value)" title="切换连接协议">' +
          '<option value="poll"' + (protocol === 'poll' ? ' selected' : '') + '>长轮询</option>' +
          '<option value="ws"' + (protocol === 'ws' ? ' selected' : '') + '>WebSocket</option>' +
        '</select>' +
        stopBtn +
        '<button class="ea2-btn small" onclick="editDeviceNotes(\'' + d.device_id + '\',\'' + escAttr(notes) + '\')">备注</button>' +
        '<button class="ea2-btn small" onclick="showDeviceCommands(\'' + d.device_id + '\')">命令</button>' +
        '<button class="ea2-btn small" onclick="sendCommandTo(\'' + d.device_id + '\')">发送命令</button>' +
        '<button class="ea2-btn small danger" onclick="unregisterDevice(\'' + d.device_id + '\')">注销</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/** 格式化 ISO 时间为 HH:MM */
function fmtTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var h = ('0' + d.getHours()).slice(-2);
  var m = ('0' + d.getMinutes()).slice(-2);
  return h + ':' + m;
}

/** 查看某设备的命令列表 */
function showDeviceCommands(deviceId) {
  document.getElementById('ea2CmdTitle').textContent = '设备命令 - ' + deviceId;
  document.getElementById('ea2CmdBody').innerHTML = '<div class="ea2-empty">加载中...</div>';
  document.getElementById('ea2CmdModal').style.display = '';
  window.CSES.request('controlApi', { action: 'command_list', payload: { device_id: deviceId } }).then(function(cmds) {
    var list = cmds || [];
    if (list.length === 0) {
      document.getElementById('ea2CmdBody').innerHTML = '<div class="ea2-empty">暂无命令记录</div>';
      return;
    }
    var rows = list.map(function(c) {
      var p = c.payload || [];
      var ptext = '';
      try { ptext = JSON.stringify(p); } catch (e) { ptext = String(p); }
      if (ptext && ptext.length > 80) ptext = ptext.slice(0, 80) + '…';
      var st = c.result_status || c.status || '';
      var stClass = st === 'succeeded' ? 'ea2-st-succeeded' : (st === 'failed' ? 'ea2-st-failed' : (st ? 'ea2-st-pending' : 'ea2-st-muted'));
      return '<tr><td>' + escHtml(c.command_type || '') + '</td>' +
        '<td title="' + escAttr(ptext) + '">' + escHtml(ptext || '—') + '</td>' +
        '<td><span class="' + stClass + '">' + escHtml(st) + '</span></td>' +
        '<td>' + escHtml((c.created_at || '').slice(0, 19)) + '</td></tr>';
    }).join('');
    document.getElementById('ea2CmdBody').innerHTML =
      '<table class="ea2-cmd-table"><thead><tr><th>类型</th><th>参数</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }).catch(function(e) {
    document.getElementById('ea2CmdBody').innerHTML = '<div class="ea2-empty">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function closeCmdModal() {
  document.getElementById('ea2CmdModal').style.display = 'none';
}

/** 停止某设备正在显示的考试 */
function stopDisplay(deviceId, deploymentId) {
  if (!confirm('确认停止该设备正在显示的考试？部署后需重新下发才会继续显示。')) return;
  var payload = {};
  if (deploymentId) payload.deployment_id = deploymentId;
  window.CSES.request('controlApi', {
    action: 'command_create',
    payload: { command_type: 'playback.stop', device_id: deviceId, payload: payload }
  }).then(function(res) {
    alert((res && res.notice) || '已发送停止显示指令，客户端将退出当前考试');
    setTimeout(refreshDevices, 1500);
  }).catch(function(e) { alert('操作失败: ' + e.message); });
}

/** 切换设备连接协议（实时协调客户端插件） */
function setDeviceProtocol(deviceId, protocol) {
  if (!confirm('确认将该设备切换为 ' + (protocol === 'ws' ? 'WebSocket' : '长轮询(REST)') + ' 连接协议？')) {
    refreshDevices();
    return;
  }
  window.CSES.request('controlApi', { action: 'device_set_protocol', payload: { device_id: deviceId, protocol: protocol } }).then(function(res) {
            var msg = (res && res.notice)
              ? res.notice
              : ('已切换协议: ' + (res && res.protocol ? (res.protocol === 'ws' ? 'WebSocket' : '长轮询') : protocol));
            alert(msg);
            // WS 设备立即生效；REST 设备将在其下次轮询时生效
            setTimeout(refreshDevices, 1500);
          }).catch(function(e) {
            alert('切换协议失败: ' + e.message);
            refreshDevices();
          });
}

function editDeviceNotes(deviceId, currentNotes) {
  var notes = prompt('请输入设备备注：', currentNotes || '');
  if (notes === null) return;
  window.CSES.request('controlApi', {
    action: 'device_update_notes',
    payload: { device_id: deviceId, notes: notes }
  }).then(function() {
    refreshDevices();
  }).catch(function(e) { alert('更新备注失败: ' + e.message); });
}

function updateDeviceStats(devices) {
  var now = Date.now();
  var online = devices.filter(function(d) {
    return d.last_seen_at && (now - new Date(d.last_seen_at).getTime()) < 60000;
  }).length;
  document.getElementById('ea2StatTotal').textContent = devices.length;
  document.getElementById('ea2StatOnline').textContent = online;
}

async function unregisterDevice(deviceId) {
  if (!confirm('确认注销设备 ' + deviceId + '？')) return;
  try {
    await window.CSES.request('controlApi', { action: 'device_unregister', payload: { device_id: deviceId } });
    refreshDevices();
  } catch (e) { alert('注销失败: ' + e.message); }
}

// ===== 注册码管理 =====
function showEnrollmentDialog() {
  document.getElementById('ea2EnrollmentModal').style.display = '';
  document.getElementById('ea2EnrollResult').style.display = 'none';
  document.getElementById('ea2EnrollGenerateBtn').style.display = '';
  document.getElementById('ea2EnrollName').value = '';
  document.getElementById('ea2EnrollMaxUses').value = '1';
  document.getElementById('ea2EnrollExpiry').value = '86400';
}

function closeEnrollmentDialog() {
  document.getElementById('ea2EnrollmentModal').style.display = 'none';
}

var generatingCode = false;

async function generateEnrollmentCode() {
  if (generatingCode) return;
  generatingCode = true;
  try {
    var res = await window.CSES.request('controlApi', {
      action: 'enrollment_create',
      payload: {
        display_name: document.getElementById('ea2EnrollName').value,
        max_uses: parseInt(document.getElementById('ea2EnrollMaxUses').value) || 1,
        expires_in_seconds: parseInt(document.getElementById('ea2EnrollExpiry').value) || 86400
      }
    });
    lastEnrollCode = res.code;
    document.getElementById('ea2EnrollCode').textContent = res.code;
    document.getElementById('ea2EnrollResult').style.display = '';
    document.getElementById('ea2EnrollGenerateBtn').style.display = 'none';
    refreshEnrollments();
  } catch (e) { alert('生成失败: ' + e.message); }
  finally { generatingCode = false; }
}

function copyEnrollCode() {
  if (lastEnrollCode) {
    navigator.clipboard.writeText(lastEnrollCode).then(function() {
      alert('注册码已复制到剪贴板');
    });
  }
}

async function refreshEnrollments() {
  try {
    var res = await window.CSES.request('controlApi', { action: 'enrollment_list', payload: {} });
    var codes = res || [];
    var container = document.getElementById('ea2EnrollmentList');
    if (!codes || codes.length === 0) {
      container.innerHTML = '<div class="ea2-empty">暂无有效注册码</div>';
      return;
    }
    container.innerHTML = codes.map(function(c) {
      var isRevoked = !!c.revoked_at;
      var isExpired = new Date(c.expires_at).getTime() < Date.now();
      var status = isRevoked ? '已吊销' : (isExpired ? '已过期' : '有效');
      var statusClass = isRevoked || isExpired ? 'ea2-st-muted' : 'ea2-st-succeeded';
      return '<div class="ea2-enrollment-item">' +
        '<div class="ea2-enrollment-code" style="flex:1">' + (c.display_name || '未命名') + '</div>' +
        '<div class="ea2-enrollment-meta">' + c.used_count + '/' + c.max_uses + ' · <span class="' + statusClass + '">' + status + '</span></div>' +
        (!isRevoked
          ? '<button class="ea2-btn small danger" onclick="revokeEnrollment(' + c.id + ')">吊销</button>'
          : '<button class="ea2-btn small danger" onclick="deleteEnrollment(' + c.id + ')">删除</button>') +
      '</div>';
    }).join('');
  } catch (e) { console.error('获取注册码列表失败:', e); }
}

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

// ===== 考试管理 =====
async function refreshExamList() {
  // 获取当前各设备播放中的考试，映射到考试（exam_config_id 即文件 id）
  var playingByExam = {};
  try {
    var devs = await window.CSES.request('controlApi', { action: 'device_list', payload: {} }) || [];
    devs.forEach(function(d) {
      var rep = d.last_reported_state || {};
      var cur = rep.currentExam;
      if (cur && cur.status === 'playing' && cur.exam_config_id) {
        var eid = String(cur.exam_config_id);
        if (!playingByExam[eid]) playingByExam[eid] = [];
        playingByExam[eid].push({ name: d.display_name || d.device_id, device_id: d.device_id });
      }
    });
  } catch (e) { /* 忽略设备查询失败 */ }
  try {
    var res = await window.CSES.request('listEa2Files');
    var exams = res || [];
    var container = document.getElementById('ea2ExamGrid');
    if (!exams || exams.length === 0) {
      container.innerHTML = '<div class="ea2-empty">暂无考试配置，点击"新建考试"创建</div>';
      return;
    }
    container.innerHTML = exams.map(function(exam) {
      var data = exam.data || {};
      var name = data.examName || exam.name || '未命名考试';
      var count = (data.examInfos || []).length;
      var groups = getExamGroups(exam.id);
      var groupTags = groups.map(function(g) { return '<span class="ea2-group-tag">' + escHtml(g) + '</span>'; }).join('');
      var isChecked = selectedExams.has(exam.id);
      var playing = playingByExam[String(exam.id)];
      var playingHtml = playing && playing.length > 0
        ? '<div class="ea2-exam-playing"><span class="ea2-dot"></span>' + playing.length + ' 台设备在播放' + (!multiSelectMode ? '（' + playing.map(function(p) { return escHtml(p.name); }).join('、') + '）' : '') + '</div>'
        : '';
      return '<div class="ea2-exam-card' + (isChecked ? ' selected' : '') + '" onclick="' + (multiSelectMode ? 'toggleExamSelect(\'' + exam.id + '\')' : 'viewExamDetail(\'' + exam.id + '\')') + '">' +
        (multiSelectMode ? '<div class="ea2-exam-card-check"><input type="checkbox" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation();toggleExamSelect(\'' + exam.id + '\')" /></div>' : '') +
        '<div class="ea2-exam-card-name">' + escHtml(name) + '</div>' +
        '<div class="ea2-exam-card-meta">' +
          '<span>' + count + ' 场考试</span>' +
          '<span>' + (exam.name || '') + '</span>' +
        '</div>' +
        playingHtml +
        (groupTags ? '<div class="ea2-exam-card-groups">' + groupTags + '</div>' : '') +
        (!multiSelectMode ? '<div class="ea2-exam-card-actions">' +
          '<button class="ea2-btn small" onclick="event.stopPropagation();viewExamDetail(\'' + exam.id + '\')">查看</button>' +
          '<button class="ea2-btn small" onclick="event.stopPropagation();editExam(\'' + exam.id + '\')">编辑</button>' +
          '<button class="ea2-btn small primary" onclick="event.stopPropagation();openDeployDialog(\'' + exam.id + '\')">部署</button>' +
          '<button class="ea2-btn small danger" onclick="event.stopPropagation();deleteExamConfirm(\'' + exam.id + '\',\'' + escAttr(exam.name) + '\')">删除</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
    updateMultiSelectBar();
  } catch (e) { console.error('获取考试列表失败:', e); }
}

function createNewExam() {
  var examName = prompt('请输入考试名称：');
  if (!examName) return;
  var rand = Math.random().toString(36).substring(2, 8);
  var fileName = 'exam-' + rand + '.ea2';
  var examData = { examName: examName, message: '', examInfos: [] };
  window.CSES.request('openExam', {
    examData: examData,
    examName: examName,
    record_id: 'exam-' + rand,
    fileName: fileName
  }).then(function() {
    // 编辑器已打开，稍后刷新列表
    setTimeout(refreshExamList, 1000);
  }).catch(function(e) {
    alert('创建失败: ' + e.message);
  });
}

function editExam(fileId) {
  window.CSES.request('listEa2Files').then(function(exams) {
    var exam = (exams || []).find(function(e) { return e.id == fileId; });
    if (!exam) { alert('考试配置不存在'); return; }
    window.CSES.request('openExam', {
      examData: exam.data,
      examName: exam.data.examName || '未命名考试',
      record_id: exam.record_id,
      fileName: exam.name
    });
  }).catch(function(e) { alert('无法打开编辑: ' + e.message); });
}

function viewExamDetail(fileId) {
  selectedExamId = fileId;
  window.CSES.request('listEa2Files').then(function(exams) {
    var exam = (exams || []).find(function(e) { return e.id == fileId; });
    if (!exam) { alert('考试配置不存在'); return; }
    var data = exam.data || {};
    var infos = data.examInfos || [];
    var html = '<div class="ea2-exam-detail-section">' +
      '<h4>基本信息</h4>' +
      '<table class="ea2-exam-info-table">' +
        '<tr><th>考试名称</th><td>' + escHtml(data.examName || '未命名') + '</td></tr>' +
        '<tr><th>提示信息</th><td>' + escHtml(data.message || '无') + '</td></tr>' +
        '<tr><th>文件</th><td>' + escHtml(exam.name) + '</td></tr>' +
      '</table>' +
    '</div>' +
    '<div class="ea2-exam-detail-section">' +
      '<h4>考试场次 (' + infos.length + ')</h4>' +
      '<table class="ea2-exam-info-table">' +
        '<tr><th>#</th><th>名称</th><th>开始</th><th>结束</th><th>材料</th></tr>' +
        infos.map(function(info, idx) {
          return '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td>' + escHtml(info.name || '') + '</td>' +
            '<td>' + escHtml(info.start || '') + '</td>' +
            '<td>' + escHtml(info.end || '') + '</td>' +
            '<td>' + (info.materials || []).length + ' 项</td>' +
          '</tr>';
        }).join('') +
      '</table>' +
    '</div>';
    document.getElementById('ea2ExamDetailTitle').textContent = data.examName || '考试详情';
    document.getElementById('ea2ExamDetailBody').innerHTML = html;
    document.getElementById('ea2ExamDetailModal').style.display = '';
  });
}

function closeExamDetail() {
  document.getElementById('ea2ExamDetailModal').style.display = 'none';
  selectedExamId = null;
}

function deleteExamConfirm(fileId, name) {
  if (!confirm('确认删除考试配置 "' + name + '"？此操作不可撤销。')) return;
  window.CSES.request('deleteEa2File', { name: name.replace(/\.ea2$/i, '') }).then(function() {
    refreshExamList();
  }).catch(function(e) { alert('删除失败: ' + e.message); });
}

// ===== 部署考试配置 =====
function openDeployDialog(fileId) {
  deployExamId = fileId;
  window.CSES.request('controlApi', { action: 'device_list', payload: {} }).then(function(devices) {
    var container = document.getElementById('ea2DeployDevices');
    if (!devices || devices.length === 0) {
      container.innerHTML = '<div class="ea2-empty ea2-empty-compact">暂无可用设备，请先在"连接应用"页面注册设备</div>';
      hideDeployWarning();
    } else {
      container.innerHTML = devices.map(function(d) {
        var notes = d.notes || '';
        var rep = d.last_reported_state || {};
        var cur = rep.currentExam && rep.currentExam.status === 'playing' ? rep.currentExam : null;
        var playingTag = cur
          ? ' <span class="ea2-playing-badge" data-dev="' + d.device_id + '">播放中: ' + escHtml(cur.exam_name || '考试') + '</span>'
          : '';
        var dataPlaying = cur ? '1' : '0';
        return '<div class="ea2-device-checkbox">' +
          '<input type="checkbox" value="' + d.device_id + '" checked id="dev_' + d.device_id + '" data-playing="' + dataPlaying + '" onchange="updateDeployWarning()">' +
          '<label for="dev_' + d.device_id + '">' + escHtml(d.display_name) + ' (' + (d.platform || '?') + ')' + playingTag +
          (notes ? ' <span class="ea2-device-notes">' + escHtml(notes) + '</span>' : '') + '</label></div>';
      }).join('');
    }
    updateDeployWarning();
    document.getElementById('ea2DeployModal').style.display = '';
  }).catch(function(e) { alert('获取设备列表失败: ' + e.message); });
}

/** 依据勾选的设备播放状态，控制部署警告显示 */
function updateDeployWarning() {
  var warn = document.getElementById('ea2DeployWarn');
  if (!warn) return;
  var boxes = document.querySelectorAll('#ea2DeployDevices input[type="checkbox"]:checked');
  var any = Array.prototype.some.call(boxes, function(cb) { return cb.getAttribute('data-playing') === '1'; });
  warn.style.display = any ? '' : 'none';
}

function hideDeployWarning() {
  var warn = document.getElementById('ea2DeployWarn');
  if (warn) warn.style.display = 'none';
}

function closeDeployDialog() {
  document.getElementById('ea2DeployModal').style.display = 'none';
  deployExamId = null;
}

async function confirmDeploy() {
  var checkboxes = document.querySelectorAll('#ea2DeployDevices input[type="checkbox"]:checked');
  var deviceIds = Array.from(checkboxes).map(function(cb) { return cb.value; });
  try {
    var res = await window.CSES.request('controlApi', {
      action: 'exam_config_deploy',
      payload: { exam_config_id: deployExamId, device_ids: deviceIds }
    });
    alert('已部署到 ' + (res.device_count || 0) + ' 台设备');
    closeDeployDialog();
  } catch (e) { alert('部署失败: ' + e.message); }
}

function deployExamConfig() {
  if (selectedExamId) {
    closeExamDetail();
    openDeployDialog(selectedExamId);
  }
}

// ===== 命令管理 =====
function sendCommandTo(deviceId) {
  var cmdType = prompt('选择命令类型：\n1. exam-config.prepare\n2. playback.activate\n3. playback.stop\n4. broadcast.show\n5. broadcast.dismiss\n6. settings.apply\n\n输入序号：');
  var types = ['exam-config.prepare', 'playback.activate', 'playback.stop', 'broadcast.show', 'broadcast.dismiss', 'settings.apply'];
  var type = types[parseInt(cmdType) - 1];
  if (!type) return;
  var payload = {};
  if (type === 'broadcast.show') {
    payload = { broadcast_id: crypto.randomUUID(), title: '测试通知', body: '这是一条测试广播', severity: 'info', expires_at: new Date(Date.now() + 3600000).toISOString() };
  } else if (type === 'settings.apply') {
    payload = { revision: crypto.randomUUID(), settings: [{ key: 'appearance.theme', value: 'dark' }] };
  } else {
    payload = { deployment_id: crypto.randomUUID(), exam_config_id: crypto.randomUUID(), exam_config_version_id: crypto.randomUUID() };
    if (type === 'playback.stop') payload = { deployment_id: crypto.randomUUID(), reason: '手动停止' };
  }
  window.CSES.request('controlApi', {
    action: 'command_create',
    payload: { command_type: type, device_id: deviceId, payload: payload }
  }).then(function(res) {
    var msg = '命令已下发';
    if (res && res.notice) msg += '\n' + res.notice;
    else if (res && res.max_delay_seconds > 0) msg += '\n（目标设备为长轮询连接，命令最长延迟 ' + res.max_delay_seconds + ' 秒送达）';
    alert(msg);
    refreshDevices();
  }).catch(function(e) { alert('命令下发失败: ' + e.message); });
}

// ===== 通讯协议配置（管理后台） =====
function loadServerProtocolConfig() {
  var input = document.getElementById('ea2PollInterval');
  if (!input) return;
  window.CSES.request('controlApi', { action: 'instance_protocol_get', payload: {} }).then(function(res) {
    if (res && res.poll_interval_seconds) input.value = res.poll_interval_seconds;
  }).catch(function(e) { /* 忽略 */ });
}

function savePollInterval() {
  var input = document.getElementById('ea2PollInterval');
  if (!input) return;
  var secs = parseInt(input.value, 10) || 0;
  window.CSES.request('controlApi', {
    action: 'instance_protocol_set',
    payload: { poll_interval_seconds: secs }
  }).then(function(res) {
    alert('已保存，REST 轮询间隔: ' + res.poll_interval_seconds + ' 秒');
    input.value = res.poll_interval_seconds;
  }).catch(function(e) { alert('保存失败: ' + e.message); });
}

// ===== 配置管理 =====
var configDeviceId = '__global__';
var configCache = {};
var deviceConfigs = {};

async function loadConfig() {
  try {
    configCache = await window.CSES.request('loadConfigFile', { file: 'ea2-config.json' });
    if (!configCache || typeof configCache !== 'object') configCache = {};
  } catch (e) { configCache = {}; }
}

async function loadDeviceConfig(deviceId) {
  if (deviceId === '__global__') { await loadConfig(); return; }
  try {
    var cfg = await window.CSES.request('loadConfigFile', { file: 'device-' + deviceId + '.json' });
    if (!cfg || typeof cfg !== 'object') cfg = {};
    var merged = {};
    for (var k in configCache) { merged[k] = configCache[k]; }
    for (var k2 in cfg) { merged[k2] = cfg[k2]; }
    deviceConfigs[deviceId] = merged;
    configCache = merged;
  } catch (e) {
    var merged2 = {};
    for (var k3 in configCache) { merged2[k3] = configCache[k3]; }
    deviceConfigs[deviceId] = merged2;
    configCache = merged2;
  }
}

function getConfigField(path, def) {
  var keys = path.split('.');
  var obj = configCache;
  for (var i = 0; i < keys.length; i++) {
    if (obj == null || typeof obj !== 'object') return def;
    obj = obj[keys[i]];
  }
  return obj !== undefined ? obj : def;
}

async function saveConfigField(path, value) {
  var keys = path.split('.');
  var obj = configCache;
  for (var i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  await saveConfig();
}

async function saveConfig() {
  try {
    var fileName = configDeviceId === '__global__' ? 'ea2-config.json' : ('device-' + configDeviceId + '.json');
    await window.CSES.request('saveConfigFile', { file: fileName, content: configCache });
    await dispatchSettings(configDeviceId);
  } catch (e) { console.error('保存配置失败:', e); }
}

async function dispatchSettings(deviceId) {
  var settings = [];
  for (var k in configCache) { settings.push({ key: k, value: configCache[k] }); }
  try {
    if (deviceId === '__global__') {
      await window.CSES.request('controlApi', {
        action: 'command_create',
        payload: { command_type: 'settings.apply', payload: { settings: settings, revision: Date.now().toString() } }
      });
    } else {
      await window.CSES.request('controlApi', {
        action: 'command_create',
        payload: { command_type: 'settings.apply', device_id: deviceId, payload: { settings: settings, revision: Date.now().toString() } }
      });
    }
  } catch (e) { console.error('下发配置失败:', e); }
}

function switchConfigDevice(deviceId) {
  configDeviceId = deviceId;
  loadDeviceConfig(deviceId).then(function() { renderConfigPage(); });
}

function switchConfigTab(tab) {
  document.querySelectorAll('.ea2-config-nav-item').forEach(function(el) { el.classList.toggle('active', el.dataset.cfg === tab); });
  renderConfigTab(tab);
}

function renderConfigPage() {
  refreshConfigDeviceSelector();
  switchConfigTab('basic');
}

function refreshConfigDeviceSelector() {
  var sel = document.getElementById('ea2ConfigDeviceSel');
  if (!sel) return;
  var currentVal = sel.value;
  window.CSES.request('controlApi', { action: 'device_list', payload: {} }).then(function(devices) {
    var html = '<option value="__global__">全局配置（所有设备）</option>';
    (devices || []).forEach(function(d) {
      html += '<option value="' + d.device_id + '"' + (currentVal === d.device_id ? ' selected' : '') + '>' + escHtml(d.display_name) + '</option>';
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  }).catch(function() {});
}

function renderConfigTab(tab) {
  var container = document.getElementById('ea2ConfigContent');
  var html = '';
  switch (tab) {
    case 'basic':
      html = '<h2>基本</h2><div class="ea2-config-card">' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">学校名称</div><div class="ea2-config-item-desc">显示在考试管理页面和设备上的学校标识。</div></div><div class="ea2-config-item-action"><input type="text" value="' + escAttr(getConfigField('schoolName', '')) + '" placeholder="学校名称" onchange="saveConfigField(\'schoolName\', this.value)" /></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">学期开始时间</div><div class="ea2-config-item-desc">设置学期首日，该日期将作为多周轮换计算起点。</div></div><div class="ea2-config-item-action"><input type="date" value="' + escAttr(getConfigField('termStart', '')) + '" onchange="saveConfigField(\'termStart\', this.value)" /></div></div>' +
      '</div>';
      break;
    case 'appearance':
      html = '<h2>外观</h2><div class="ea2-config-card">' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">界面主题</div><div class="ea2-config-item-desc">浅色、深色或跟随系统自动切换。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'appearance.theme\', this.value)"><option value="auto"' + (getConfigField('appearance.theme') === 'auto' ? ' selected' : '') + '>跟随系统</option><option value="light"' + (getConfigField('appearance.theme') === 'light' ? ' selected' : '') + '>浅色</option><option value="dark"' + (getConfigField('appearance.theme') === 'dark' ? ' selected' : '') + '>深色</option></select></div></div>' +
      '</div>';
      break;
    case 'player':
      html = '<h2>播放器</h2><div class="ea2-config-card">' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">默认考场号</div><div class="ea2-config-item-desc">用于播放器窗口首次打开时的默认考场号。</div></div><div class="ea2-config-item-action"><input type="text" value="' + escAttr(getConfigField('player.defaultRoom', '')) + '" placeholder="例如：01" maxlength="8" onchange="saveConfigField(\'player.defaultRoom\', this.value)" /></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">默认界面缩放</div><div class="ea2-config-item-desc">调整播放器内 UI 的默认缩放倍率，范围 50%-200%。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('player.uiScale', 1)) + '" min="0.5" max="2" step="0.05" placeholder="1" onchange="saveConfigField(\'player.uiScale\', parseFloat(this.value)||1)" style="width:90px" /><span class="ea2-config-item-suffix">倍</span></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">大时钟模式</div><div class="ea2-config-item-desc">开启后隐藏时钟右侧提示文字，仅保留更大的时间显示。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'player.largeClockEnabled\', this.value)"><option value="false"' + (getConfigField('player.largeClockEnabled') === true ? ' selected' : '') + '>关闭</option><option value="true"' + (getConfigField('player.largeClockEnabled') === true ? ' selected' : '') + '>开启</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">界面密度</div><div class="ea2-config-item-desc">调整播放器信息区域的默认紧凑程度。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'player.uiDensity\', this.value)"><option value="comfortable"' + (getConfigField('player.uiDensity') === 'comfortable' ? ' selected' : '') + '>舒适</option><option value="cozy"' + (getConfigField('player.uiDensity') === 'cozy' ? ' selected' : '') + '>紧凑</option><option value="compact"' + (getConfigField('player.uiDensity') === 'compact' ? ' selected' : '') + '>最紧凑</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">大时钟字号</div><div class="ea2-config-item-desc">调整大时钟模式下时间文字的缩放倍率。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('player.largeClockScale', 1)) + '" min="0.5" max="1.8" step="0.05" placeholder="1" onchange="saveConfigField(\'player.largeClockScale\', parseFloat(this.value)||1)" style="width:90px" /></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">考试信息大字号</div><div class="ea2-config-item-desc">放大当前考试信息卡片中的主要文字。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'player.examInfoLargeFont\', this.value)"><option value="false"' + (getConfigField('player.examInfoLargeFont') === true ? ' selected' : '') + '>关闭</option><option value="true"' + (getConfigField('player.examInfoLargeFont') === true ? ' selected' : '') + '>开启</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">HDR 高亮提醒</div><div class="ea2-config-item-desc">彩色全屏提醒为白色文字时启用 P3 HDR 亮度高亮。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'player.hdrHighlight\', this.value)"><option value="false"' + (getConfigField('player.hdrHighlight') === true ? ' selected' : '') + '>关闭</option><option value="true"' + (getConfigField('player.hdrHighlight') === true ? ' selected' : '') + '>开启</option></select></div></div>' +
      '</div>';
      break;
    case 'reminder':
      html = '<h2>提醒铃声</h2><div class="ea2-config-card">' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">提醒铃声</div><div class="ea2-config-item-desc">彩色提醒亮起时播放铃声。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'reminderSound.enabled\', this.value)"><option value="true"' + (getConfigField('reminderSound.enabled') !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('reminderSound.enabled') === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">铃声音量</div><div class="ea2-config-item-desc">统一调整提醒铃声和试听音量。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('reminderSound.volume', 70)) + '" min="0" max="100" placeholder="70" onchange="saveConfigField(\'reminderSound.volume\', parseInt(this.value)||70)" style="width:90px" /><span class="ea2-config-item-suffix">%</span></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">开考铃声</div><div class="ea2-config-item-desc">考试开始时播放。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'reminderSound.start\', this.value)"><option value="true"' + (getConfigField('reminderSound.start') !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('reminderSound.start') === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">即将结束铃声</div><div class="ea2-config-item-desc">考试进入提醒阈值时播放。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'reminderSound.alert\', this.value)"><option value="true"' + (getConfigField('reminderSound.alert') !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('reminderSound.alert') === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">结束铃声</div><div class="ea2-config-item-desc">考试结束时播放。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'reminderSound.end\', this.value)"><option value="true"' + (getConfigField('reminderSound.end') !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('reminderSound.end') === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
      '</div>';
      break;
    case 'connect':
      html = '<h2>连接</h2><div class="ea2-config-card">' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">服务器地址</div><div class="ea2-config-item-desc">客户端连接控制服务器的地址，由系统自动生成。</div></div><div class="ea2-config-item-action"><code class="ea2-code-chip">' + escHtml(window.location.origin + '/api/rest-control?instance_uid=' + (window.CSES.instance ? window.CSES.instance.uid : '')) + '</code></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">WebSocket 网关</div><div class="ea2-config-item-desc">客户端 WebSocket 实时通信网关地址。</div></div><div class="ea2-config-item-action"><code class="ea2-code-chip">' + escHtml(window.location.origin + '/api/ws-control') + '</code></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">REST 轮询频率限制</div><div class="ea2-config-item-desc">长轮询设备的命令轮询间隔（秒）。默认 300（5 分钟）。客户端不写死，按此限制自适应调整。</div></div><div class="ea2-config-item-action"><input type="number" id="ea2PollInterval" value="300" min="5" max="86400" placeholder="300" style="width:110px" /><button class="ea2-btn small" onclick="savePollInterval()">保存</button></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">监听端口</div><div class="ea2-config-item-desc">控制服务器监听端口，端口占用时会自动上移尝试。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('server.port', 8000)) + '" min="1" max="65535" placeholder="8000" onchange="saveConfigField(\'server.port\', parseInt(this.value)||8000)" style="width:90px" /></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">访问令牌</div><div class="ea2-config-item-desc">留空则不校验；推荐在远程访问时设置。</div></div><div class="ea2-config-item-action"><input type="text" value="' + escAttr(getConfigField('server.token', '')) + '" placeholder="（留空不校验）" onchange="saveConfigField(\'server.token\', this.value)" /></div></div>' +
      '</div>';
      // 加载当前服务端协议配置
      loadServerProtocolConfig();
      break;
    case 'time':
      html = '<h2>时间同步</h2><div class="ea2-config-card">' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">NTP 服务器</div><div class="ea2-config-item-desc">用于时间同步的 NTP 服务器地址。</div></div><div class="ea2-config-item-action"><input type="text" value="' + escAttr(getConfigField('time.ntpServer', 'ntp.aliyun.com')) + '" placeholder="ntp.aliyun.com" onchange="saveConfigField(\'time.ntpServer\', this.value)" /></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">自动校时</div><div class="ea2-config-item-desc">定期自动与 NTP 服务器同步时间。</div></div><div class="ea2-config-item-action"><select onchange="saveConfigField(\'time.autoSync\', this.value)"><option value="true"' + (getConfigField('time.autoSync') !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('time.autoSync') === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">校时间隔</div><div class="ea2-config-item-desc">两次自动校时之间的间隔时间。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('time.syncIntervalMinutes', 60)) + '" min="10" max="1440" placeholder="60" onchange="saveConfigField(\'time.syncIntervalMinutes\', parseInt(this.value)||60)" style="width:90px" /><span class="ea2-config-item-suffix">分钟</span></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">手动偏移</div><div class="ea2-config-item-desc">手动调整系统时间的偏移量。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('time.manualOffsetSeconds', 0)) + '" placeholder="0" onchange="saveConfigField(\'time.manualOffsetSeconds\', parseInt(this.value)||0)" style="width:90px" /><span class="ea2-config-item-suffix">秒</span></div></div>' +
      '</div>';
      break;
  }
  container.innerHTML = '<div class="ea2-config-tab active">' + html + '</div>';
}

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

// ===== 工具函数 =====
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}