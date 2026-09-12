// ClassIsland 平台侧实例应用
// 通过 window.CSES.request 与平台通信：controlApi（设备/注册码/命令）、listCiProfiles/openProfile 等（档案文件）。

var currentPage = 'connect';
var selectedProfileId = null;
var deployProfileId = null;
var lastEnrollCode = null;
var configCache = {};

// ===== 初始化 =====
(function init() {
  loadConfig().then(function () { switchPage('connect'); });
  listenCommands();
})();

function listenCommands() {
  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.__ceseCommand) return;
    switch (e.data.__ceseCommand) {
      case 'page_connect': switchPage('connect'); break;
      case 'page_profiles': switchPage('profiles'); break;
      case 'page_config': switchPage('config'); break;
      case 'new_profile': createNewProfile(); break;
      case 'deploy_profile': if (selectedProfileId) openDeployDialog(selectedProfileId); else alert('请先选择一个档案'); break;
      case 'multi_edit': toggleMultiSelect(); break;
      case 'save': saveConfig(); break;
      case 'show_enrollment': showEnrollmentDialog(); break;
      case 'refresh_devices': refreshDevices(); refreshEnrollments(); break;
      case 'refresh': refreshDevices(); refreshEnrollments(); if (currentPage === 'profiles') refreshProfileList(); break;
    }
  });
}

// ===== 页面切换 =====
function switchPage(page) {
  currentPage = page;
  document.getElementById('ciaPageConnect').style.display = page === 'connect' ? '' : 'none';
  document.getElementById('ciaPageProfiles').style.display = page === 'profiles' ? '' : 'none';
  document.getElementById('ciaPageConfig').style.display = page === 'config' ? '' : 'none';
  if (page === 'connect') { refreshDevices(); refreshEnrollments(); }
  if (page === 'profiles') refreshProfileList();
  if (page === 'config') renderConfigPage();
  window.parent.postMessage({ __ceseReportPage: page }, '*');
}

// ===== 工具 =====
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ===== 设备管理 =====
async function refreshDevices() {
  try {
    var devices = await window.CSES.request('controlApi', { action: 'device_list', payload: {} }) || [];
    var profilePlaying = {};
    try {
      var profiles = await window.CSES.request('listCiProfiles') || [];
      document.getElementById('ciaStatProfiles').textContent = profiles.length;
      profiles.forEach(function (p) {
        (p.playing || []).forEach(function (devId) { profilePlaying[devId] = p; });
      });
    } catch (e) { /* 忽略 */ }
    renderDeviceList(devices, profilePlaying);
    updateDeviceStats(devices);
  } catch (e) { console.error('获取设备列表失败:', e); }
}

function deviceOnline(d) {
  return d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 60000;
}

function renderDeviceList(devices, profilePlaying) {
  var container = document.getElementById('ciaDeviceList');
  if (!devices || devices.length === 0) {
    container.innerHTML = '<div class="cia-empty">暂无设备连接，请生成注册码并在 ClassIsland 客户端的「CSES Cloud 适配器」设置中填入服务器地址与注册码</div>';
    return;
  }
  var now = Date.now();
  container.innerHTML = devices.map(function (d) {
    var lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
    var isOnline = (now - lastSeen) < 60000;
    var notes = d.notes || '';
    var rep = d.last_reported_state || {};
    var curProfile = rep.profile || null;
    var playing = profilePlaying[d.device_id];
    var profileHtml = curProfile
      ? '<div class="cia-device-profile"><span class="cia-dot"></span>当前档案: ' + escHtml(curProfile.name || curProfile.profile_name || '未命名') + (curProfile.version ? '（v' + escHtml(String(curProfile.version).slice(0, 8)) + '）' : '') + '</div>'
      : (playing ? '<div class="cia-device-profile"><span class="cia-dot"></span>部署中: ' + escHtml(playing.profile_name || playing.name || '未命名') + '</div>' : (isOnline ? '' : ''));
    return '<div class="cia-device-item">' +
      '<span class="cia-device-status ' + (isOnline ? 'online' : 'offline') + '"></span>' +
      '<div class="cia-device-info">' +
        '<div class="cia-device-name">' + escHtml(d.display_name) + '</div>' +
        '<div class="cia-device-meta">' + escHtml(d.platform || 'ClassIsland') + ' · ' + escHtml(d.app_version || '') + ' · ' + (isOnline ? '在线' : '离线') + ' · ' + (d.protocol === 'ws' ? 'WebSocket' : '长轮询') + '</div>' +
        profileHtml + (notes ? '<div class="cia-device-notes">' + escHtml(notes) + '</div>' : '') +
      '</div>' +
      '<div class="cia-device-actions">' +
        '<select class="cia-protocol-select" onchange="setDeviceProtocol(\'' + d.device_id + '\', this.value)" title="切换连接协议">' +
          '<option value="poll"' + (d.protocol !== 'ws' ? ' selected' : '') + '>长轮询</option>' +
          '<option value="ws"' + (d.protocol === 'ws' ? ' selected' : '') + '>WebSocket</option>' +
        '</select>' +
        '<button class="cia-btn small" onclick="editDeviceNotes(\'' + d.device_id + '\',\'' + escAttr(notes) + '\')">备注</button>' +
        '<button class="cia-btn small" onclick="showDeviceCommands(\'' + d.device_id + '\')">命令</button>' +
        '<button class="cia-btn small" onclick="showBroadcastDialog(\'' + d.device_id + '\',\'' + escAttr(d.display_name) + '\')">广播</button>' +
        '<button class="cia-btn small danger" onclick="unregisterDevice(\'' + d.device_id + '\')">注销</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/** 切换设备连接协议（WS 设备立即生效；长轮询设备在下次轮询时生效） */
async function setDeviceProtocol(deviceId, protocol) {
  if (!confirm('确认将该设备切换为 ' + (protocol === 'ws' ? 'WebSocket' : '长轮询(REST)') + ' 连接协议？')) {
    refreshDevices();
    return;
  }
  try {
    var res = await window.CSES.request('controlApi', { action: 'device_set_protocol', payload: { device_id: deviceId, protocol: protocol } });
    alert((res && res.notice) || '协议已切换');
    setTimeout(refreshDevices, 1500);
  } catch (e) {
    alert('切换协议失败: ' + e.message);
    refreshDevices();
  }
}

function updateDeviceStats(devices) {
  var online = (devices || []).filter(deviceOnline).length;
  document.getElementById('ciaStatTotal').textContent = (devices || []).length;
  document.getElementById('ciaStatOnline').textContent = online;
}

function editDeviceNotes(deviceId, currentNotes) {
  var notes = prompt('请输入设备备注：', currentNotes || '');
  if (notes === null) return;
  window.CSES.request('controlApi', { action: 'device_update_notes', payload: { device_id: deviceId, notes: notes } })
    .then(function () { refreshDevices(); })
    .catch(function (e) { alert('更新备注失败: ' + e.message); });
}

function showDeviceCommands(deviceId) {
  document.getElementById('ciaCmdTitle').textContent = '设备命令 - ' + deviceId;
  document.getElementById('ciaCmdBody').innerHTML = '<div class="cia-empty">加载中...</div>';
  document.getElementById('ciaCmdModal').style.display = '';
  window.CSES.request('controlApi', { action: 'command_list', payload: { device_id: deviceId } }).then(function (cmds) {
    var list = cmds || [];
    if (list.length === 0) {
      document.getElementById('ciaCmdBody').innerHTML = '<div class="cia-empty">暂无命令记录</div>';
      return;
    }
    var rows = list.map(function (c) {
      var p = c.payload || [];
      var ptext = '';
      try { ptext = JSON.stringify(p); } catch (e) { ptext = String(p); }
      if (ptext && ptext.length > 80) ptext = ptext.slice(0, 80) + '…';
      var st = c.result_status || c.status || '';
      var stClass = st === 'succeeded' ? 'cia-st-succeeded' : (st === 'failed' ? 'cia-st-failed' : (st ? 'cia-st-pending' : 'cia-st-muted'));
      return '<tr><td>' + escHtml(c.command_type || '') + '</td>' +
        '<td title="' + escAttr(ptext) + '">' + escHtml(ptext || '—') + '</td>' +
        '<td><span class="' + stClass + '">' + escHtml(st) + '</span></td>' +
        '<td>' + escHtml((c.created_at || '').slice(0, 19)) + '</td></tr>';
    }).join('');
    document.getElementById('ciaCmdBody').innerHTML =
      '<table class="cia-cmd-table"><thead><tr><th>类型</th><th>参数</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }).catch(function (e) {
    document.getElementById('ciaCmdBody').innerHTML = '<div class="cia-empty">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function closeCmdModal() {
  document.getElementById('ciaCmdModal').style.display = 'none';
}

async function unregisterDevice(deviceId) {
  if (!confirm('确认注销设备 ' + deviceId + '？')) return;
  try {
    await window.CSES.request('controlApi', { action: 'device_unregister', payload: { device_id: deviceId } });
    refreshDevices();
  } catch (e) { alert('注销失败: ' + e.message); }
}

// ===== 广播（通知接口：broadcast.show / broadcast.dismiss） =====
var broadcastTargetId = null;

/** 打开广播弹窗（deviceId 为空 = 广播到所有设备） */
function showBroadcastDialog(deviceId, displayName) {
  broadcastTargetId = deviceId || '';
  document.getElementById('ciaBroadcastTarget').textContent = deviceId ? (displayName || deviceId) : '所有设备';
  document.getElementById('ciaBroadcastTitle').value = '通知';
  document.getElementById('ciaBroadcastBody').value = '';
  document.getElementById('ciaBroadcastSeverity').value = 'info';
  document.getElementById('ciaBroadcastModal').style.display = '';
}

function closeBroadcastDialog() {
  document.getElementById('ciaBroadcastModal').style.display = 'none';
  broadcastTargetId = null;
}

async function sendBroadcast() {
  var title = document.getElementById('ciaBroadcastTitle').value.trim();
  var body = document.getElementById('ciaBroadcastBody').value.trim();
  var severity = document.getElementById('ciaBroadcastSeverity').value;
  if (!title) { alert('请输入广播标题'); return; }
  var payload = {
    broadcast_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    title: title,
    body: body,
    severity: severity,
    expires_at: new Date(Date.now() + 3600000).toISOString()
  };
  var cmdPayload = { command_type: 'broadcast.show', payload: payload };
  if (broadcastTargetId) cmdPayload.device_id = broadcastTargetId;
  try {
    var res = await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
    alert('广播已下发' + (res && res.max_delay_seconds > 0 ? '（长轮询设备最长延迟 ' + res.max_delay_seconds + ' 秒收到）' : ''));
    closeBroadcastDialog();
    refreshDevices();
  } catch (e) { alert('广播下发失败: ' + e.message); }
}

/** 撤回当前广播（向设备下发 broadcast.dismiss） */
async function dismissBroadcast(deviceId) {
  var cmdPayload = { command_type: 'broadcast.dismiss', payload: { broadcast_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) } };
  if (deviceId) cmdPayload.device_id = deviceId;
  try {
    await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
    alert('已下发撤回指令');
  } catch (e) { alert('撤回失败: ' + e.message); }
}

// ===== 注册码管理 =====
function showEnrollmentDialog() {
  document.getElementById('ciaEnrollmentModal').style.display = '';
  document.getElementById('ciaEnrollResult').style.display = 'none';
  document.getElementById('ciaEnrollGenerateBtn').style.display = '';
  document.getElementById('ciaEnrollName').value = '';
  document.getElementById('ciaEnrollMaxUses').value = '1';
  document.getElementById('ciaEnrollExpiry').value = '86400';
}

function closeEnrollmentDialog() {
  document.getElementById('ciaEnrollmentModal').style.display = 'none';
}

var generatingCode = false;
var lastEnrollInfo = null;

async function generateEnrollmentCode() {
  if (generatingCode) return;
  generatingCode = true;
  try {
    var res = await window.CSES.request('controlApi', {
      action: 'enrollment_create',
      payload: {
        display_name: document.getElementById('ciaEnrollName').value,
        max_uses: parseInt(document.getElementById('ciaEnrollMaxUses').value) || 1,
        expires_in_seconds: parseInt(document.getElementById('ciaEnrollExpiry').value) || 86400,
        prefix: 'CSES-'
      }
    });
    lastEnrollCode = res.code;
    lastEnrollInfo = {
      code: res.code,
      display_name: res.display_name || document.getElementById('ciaEnrollName').value,
      instance_uid: (window.CSES.instance && window.CSES.instance.uid) || '',
      server_url: window.location.origin,
      expires_at: res.expires_at,
      created_at: new Date().toISOString()
    };
    document.getElementById('ciaEnrollCode').textContent = res.code;
    document.getElementById('ciaEnrollResult').style.display = '';
    document.getElementById('ciaEnrollGenerateBtn').style.display = 'none';
    refreshEnrollments();
  } catch (e) { alert('生成失败: ' + e.message); }
  finally { generatingCode = false; }
}

/** 下载凭据文件（供客户端适配器「导入凭据」直接使用，无需手抄连接码） */
function downloadCredentials() {
  if (!lastEnrollInfo) return;
  var payload = {
    type: 'cses-cloud-credentials',
    version: 1,
    server_url: lastEnrollInfo.server_url,
    instance_uid: lastEnrollInfo.instance_uid,
    enrollment_code: lastEnrollInfo.code,
    display_name: lastEnrollInfo.display_name,
    created_at: lastEnrollInfo.created_at,
    expires_at: lastEnrollInfo.expires_at
  };
  window.CSES.request('downloadFile', {
    name: 'cses-cloud-credentials.json',
    mime: 'application/json',
    content: JSON.stringify(payload, null, 4)
  }).catch(function (e) { alert('下载失败: ' + e.message); });
}

function copyEnrollCode() {
  if (lastEnrollCode) {
    navigator.clipboard.writeText(lastEnrollCode).then(function () { alert('注册码已复制到剪贴板'); });
  }
}

async function refreshEnrollments() {
  try {
    var codes = await window.CSES.request('controlApi', { action: 'enrollment_list', payload: {} }) || [];
    var container = document.getElementById('ciaEnrollmentList');
    if (!codes.length) {
      container.innerHTML = '<div class="cia-empty">暂无有效注册码</div>';
      return;
    }
    container.innerHTML = codes.map(function (c) {
      var isRevoked = !!c.revoked_at;
      var isExpired = new Date(c.expires_at).getTime() < Date.now();
      var status = isRevoked ? '已吊销' : (isExpired ? '已过期' : '有效');
      var statusClass = isRevoked || isExpired ? 'cia-st-muted' : 'cia-st-succeeded';
      return '<div class="cia-enrollment-item">' +
        '<div class="cia-enrollment-code" style="flex:1">' + escHtml(c.display_name || '未命名') + '</div>' +
        '<div class="cia-enrollment-meta">' + c.used_count + '/' + c.max_uses + ' · <span class="' + statusClass + '">' + status + '</span></div>' +
        (!isRevoked
          ? '<button class="cia-btn small danger" onclick="revokeEnrollment(' + c.id + ')">吊销</button>'
          : '<button class="cia-btn small danger" onclick="deleteEnrollment(' + c.id + ')">删除</button>') +
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

// ===== 档案管理 =====
async function refreshProfileList() {
  var playingByProfile = {};
  try {
    var devs = await window.CSES.request('controlApi', { action: 'device_list', payload: {} }) || [];
    devs.forEach(function (d) {
      var rep = d.last_reported_state || {};
      var cur = rep.profile;
      if (cur && cur.config_id) {
        var pid = String(cur.config_id);
        if (!playingByProfile[pid]) playingByProfile[pid] = [];
        playingByProfile[pid].push(d.device_id);
      }
    });
  } catch (e) { /* 忽略 */ }
  try {
    var profiles = await window.CSES.request('listCiProfiles') || [];
    var container = document.getElementById('ciaProfileGrid');
    if (!profiles.length) {
      container.innerHTML = '<div class="cia-empty">暂无档案，点击"新建档案"创建（.json ClassIsland 档案）</div>';
      return;
    }
    container.innerHTML = profiles.map(function (p) {
      var isChecked = selectedProfiles.has(String(p.id));
      var playing = playingByProfile[String(p.id)] || [];
      var playingHtml = playing.length
        ? '<div class="cia-profile-playing"><span class="cia-dot"></span>' + playing.length + ' 台设备已应用</div>'
        : '';
      return '<div class="cia-profile-card' + (isChecked ? ' selected' : '') + '" onclick="' + (multiSelectMode ? 'toggleProfileSelect(\'' + p.id + '\')' : 'viewProfileDetail(\'' + p.id + '\')') + '">' +
        (multiSelectMode ? '<input type="checkbox" style="position:absolute;top:12px;right:12px;accent-color:var(--accent-base)" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation();toggleProfileSelect(\'' + p.id + '\')" />' : '') +
        '<div class="cia-profile-card-name">' + escHtml(p.profile_name || p.name) + '</div>' +
        '<div class="cia-profile-card-meta">' +
          '<span>' + p.subjects + ' 科目</span><span>' + p.layouts + ' 时间表</span><span>' + p.plans + ' 课表</span>' +
        '</div>' +
        '<div class="cia-profile-card-meta"><span class="cia-group-tag">' + escHtml(p.name) + '</span><span>' + escHtml((p.updated_at || '').slice(0, 19)) + '</span></div>' +
        playingHtml +
        (!multiSelectMode ? '<div class="cia-profile-card-actions">' +
          '<button class="cia-btn small" onclick="event.stopPropagation();viewProfileDetail(\'' + p.id + '\')">详情</button>' +
          '<button class="cia-btn small" onclick="event.stopPropagation();editProfile(\'' + p.id + '\')">编辑</button>' +
          '<button class="cia-btn small primary" onclick="event.stopPropagation();openDeployDialog(\'' + p.id + '\')">部署</button>' +
          '<button class="cia-btn small danger" onclick="event.stopPropagation();deleteProfileConfirm(\'' + p.id + '\')">删除</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
    updateMultiSelectBar();
  } catch (e) { console.error('获取档案列表失败:', e); }
}

function createNewProfile() {
  var name = prompt('档案名称：');
  if (!name) return;
  var rand = Math.random().toString(36).substring(2, 8);
  var fileName = 'profile-' + rand + '.json';
  var profileData = {
    Name: name,
    TimeLayouts: {},
    ClassPlans: {},
    Subjects: {},
    ClassPlanGroups: {},
    SelectedClassPlanGroupId: 'acaf4ef0-e261-4262-b941-34ea93cb4369'
  };
  window.CSES.request('openProfile', {
    profileData: profileData,
    profileName: name,
    record_id: 'profile-' + rand,
    fileName: fileName
  }).then(function () {
    setTimeout(refreshProfileList, 1000);
  }).catch(function (e) { alert('创建失败: ' + e.message); });
}

function editProfile(fileId) {
  window.CSES.request('listCiProfiles').then(function (profiles) {
    var p = (profiles || []).find(function (x) { return String(x.id) === String(fileId); });
    if (!p) { alert('档案不存在'); return; }
    window.CSES.request('openProfile', {
      profileData: p.data,
      profileName: p.profile_name || p.name,
      record_id: p.name.replace(/\.json$/i, ''),
      fileName: p.name
    });
  }).catch(function (e) { alert('无法打开编辑: ' + e.message); });
}

function viewProfileDetail(fileId) {
  selectedProfileId = fileId;
  window.CSES.request('listCiProfiles').then(function (profiles) {
    var p = (profiles || []).find(function (x) { return String(x.id) === String(fileId); });
    if (!p) { alert('档案不存在'); return; }
    var data = p.data || {};
    var layoutNames = Object.keys(data.TimeLayouts || {}).map(function (k) { return data.TimeLayouts[k].Name || k; });
    var planNames = Object.keys(data.ClassPlans || {}).map(function (k) { return data.ClassPlans[k].Name || k; });
    var html = '<div class="cia-tip-box" style="margin-bottom:12px">名称：' + escHtml(data.Name || p.profile_name || '未命名') + ' · 文件：' + escHtml(p.name) + '</div>' +
      '<table class="cia-profile-info-table">' +
        '<tr><th>科目</th><td>' + (Object.keys(data.Subjects || {}).map(function (k) { return escHtml(data.Subjects[k].Name || ''); }).filter(Boolean).join('、') || '—') + '</td></tr>' +
        '<tr><th>时间表</th><td>' + (layoutNames.map(escHtml).join('、') || '—') + '</td></tr>' +
        '<tr><th>课表</th><td>' + (planNames.map(escHtml).join('、') || '—') + '</td></tr>' +
      '</table>';
    document.getElementById('ciaProfileDetailTitle').textContent = data.Name || p.profile_name || '档案详情';
    document.getElementById('ciaProfileDetailBody').innerHTML = html;
    document.getElementById('ciaProfileDetailModal').style.display = '';
  });
}

function closeProfileDetail() {
  document.getElementById('ciaProfileDetailModal').style.display = 'none';
  selectedProfileId = null;
}

function deploySelectedProfile() {
  if (selectedProfileId) {
    closeProfileDetail();
    openDeployDialog(selectedProfileId);
  }
}

function deleteProfileConfirm(fileId) {
  window.CSES.request('listCiProfiles').then(function (profiles) {
    var p = (profiles || []).find(function (x) { return String(x.id) === String(fileId); });
    if (!p) return;
    if (!confirm('确认删除档案 "' + (p.profile_name || p.name) + '"？此操作不可撤销。')) return;
    window.CSES.request('deleteCiProfile', { name: p.name }).then(function () { refreshProfileList(); })
      .catch(function (e) { alert('删除失败: ' + e.message); });
  });
}

// ===== 部署档案 =====
function openDeployDialog(fileId) {
  deployProfileId = fileId;
  window.CSES.request('controlApi', { action: 'device_list', payload: {} }).then(function (devices) {
    var container = document.getElementById('ciaDeployDevices');
    if (!devices || devices.length === 0) {
      container.innerHTML = '<div class="cia-empty cia-empty-compact">暂无可用设备，请先在"连接应用"页面注册设备</div>';
    } else {
      container.innerHTML = devices.map(function (d) {
        var notes = d.notes || '';
        return '<div class="cia-device-checkbox">' +
          '<input type="checkbox" value="' + d.device_id + '" checked id="ciadev_' + d.device_id + '">' +
          '<label for="ciadev_' + d.device_id + '">' + escHtml(d.display_name) + ' (' + escHtml(d.platform || '?') + ')' +
          (notes ? ' <span class="cia-device-notes">' + escHtml(notes) + '</span>' : '') + '</label></div>';
      }).join('');
    }
    document.getElementById('ciaDeployModal').style.display = '';
  }).catch(function (e) { alert('获取设备列表失败: ' + e.message); });
}

function closeDeployDialog() {
  document.getElementById('ciaDeployModal').style.display = 'none';
  deployProfileId = null;
}

async function confirmDeploy() {
  var checkboxes = document.querySelectorAll('#ciaDeployDevices input[type="checkbox"]:checked');
  var deviceIds = Array.from(checkboxes).map(function (cb) { return cb.value; });
  var profileName = document.getElementById('ciaDeployProfileName').value.trim();
  try {
    var res = await window.CSES.request('controlApi', {
      action: 'profile_deploy',
      payload: { profile_config_id: deployProfileId, device_ids: deviceIds, profile_name: profileName }
    });
    alert('已部署到 ' + (res.device_count || 0) + ' 台设备' + (res.max_delay_seconds > 0 ? '\n（长轮询设备最长延迟 ' + res.max_delay_seconds + ' 秒收到命令）' : ''));
    closeDeployDialog();
  } catch (e) { alert('部署失败: ' + e.message); }
}

// ===== 多选 =====
var multiSelectMode = false;
var selectedProfiles = new Set();

function toggleMultiSelect() {
  multiSelectMode = !multiSelectMode;
  if (!multiSelectMode) selectedProfiles.clear();
  refreshProfileList();
}

function toggleProfileSelect(fileId) {
  fileId = String(fileId);
  if (selectedProfiles.has(fileId)) selectedProfiles.delete(fileId);
  else selectedProfiles.add(fileId);
  updateMultiSelectBar();
}

function updateMultiSelectBar() {
  var bar = document.getElementById('ciaMultiSelectBar');
  if (!bar) return;
  bar.style.display = multiSelectMode ? 'flex' : 'none';
  document.getElementById('ciaMultiSelectCount').textContent = '已选 ' + selectedProfiles.size + ' 项';
}

function batchDeleteProfiles() {
  if (selectedProfiles.size === 0) { alert('请先选择档案'); return; }
  if (!confirm('确认删除 ' + selectedProfiles.size + ' 个档案？此操作不可撤销。')) return;
  var promises = [];
  selectedProfiles.forEach(function (fileId) {
    promises.push(window.CSES.request('listCiProfiles').then(function (profiles) {
      var p = (profiles || []).find(function (x) { return String(x.id) === String(fileId); });
      if (p) return window.CSES.request('deleteCiProfile', { name: p.name });
    }));
  });
  Promise.all(promises).then(function () {
    selectedProfiles.clear();
    refreshProfileList();
  }).catch(function (e) { alert('批量删除失败: ' + e.message); });
}

function batchDeployProfiles() {
  if (selectedProfiles.size === 0) { alert('请先选择档案'); return; }
  deployProfileId = Array.from(selectedProfiles)[0];
  openDeployDialog(deployProfileId);
}

// ===== 应用配置（全局 + 设备分层，保存后经 settings.apply 同步到客户端） =====
var configDeviceId = '__global__';
var globalConfig = {};       // 全局配置（classisland-config.json）
var deviceConfigRaw = {};    // 当前设备的覆盖配置（device-<id>.json）

async function loadConfig() {
  try {
    globalConfig = await window.CSES.request('loadConfigFile', { file: 'classisland-config.json' });
    if (!globalConfig || typeof globalConfig !== 'object') globalConfig = {};
  } catch (e) { globalConfig = {}; }
  configCache = mergedConfig();
}

/** 当前设备配置 = 全局配置 + 设备覆盖 */
function mergedConfig() {
  if (configDeviceId === '__global__') return JSON.parse(JSON.stringify(globalConfig));
  var merged = JSON.parse(JSON.stringify(globalConfig));
  (function deepMerge(target, override) {
    for (var k in override) {
      if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])
        && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], override[k]);
      else target[k] = override[k];
    }
  })(merged, deviceConfigRaw);
  return merged;
}

async function loadDeviceConfig(deviceId) {
  if (deviceId === '__global__') { deviceConfigRaw = {}; configCache = mergedConfig(); return; }
  try {
    deviceConfigRaw = await window.CSES.request('loadConfigFile', { file: 'device-' + deviceId + '.json' });
    if (!deviceConfigRaw || typeof deviceConfigRaw !== 'object') deviceConfigRaw = {};
  } catch (e) { deviceConfigRaw = {}; }
  configCache = mergedConfig();
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
  // 写入当前编辑层：全局层写全局文件，设备层写设备覆盖文件
  var target = configDeviceId === '__global__' ? globalConfig : deviceConfigRaw;
  var obj = target;
  for (var i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  await saveConfig();
}

async function saveConfig() {
  try {
    if (configDeviceId === '__global__') {
      await window.CSES.request('saveConfigFile', { file: 'classisland-config.json', content: globalConfig });
    } else {
      await window.CSES.request('saveConfigFile', { file: 'device-' + configDeviceId + '.json', content: deviceConfigRaw });
    }
    await dispatchSettings();
  } catch (e) { console.error('保存配置失败:', e); }
}

/** 配置同步：全局配置广播 settings.apply，设备配置定向下发（与 EA2 相同的设置接口） */
async function dispatchSettings() {
  var settings = [];
  for (var k in configCache) {
    if (k !== 'server') settings.push({ key: k, value: configCache[k] });
  }
  var cmdPayload = { command_type: 'settings.apply', payload: { settings: settings, revision: Date.now().toString() } };
  if (configDeviceId !== '__global__') cmdPayload.device_id = configDeviceId;
  try {
    await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
  } catch (e) { console.error('下发配置失败:', e); }
}

function switchConfigTab(tab) {
  document.querySelectorAll('.cia-config-nav-item').forEach(function (el) { el.classList.toggle('active', el.dataset.cfg === tab); });
  renderConfigTab(tab);
}

function renderConfigPage() {
  refreshConfigDeviceSelector();
  switchConfigTab('sync');
}

function switchConfigDevice(deviceId) {
  configDeviceId = deviceId;
  loadDeviceConfig(deviceId).then(function () { renderConfigPage(); });
}

function refreshConfigDeviceSelector() {
  var sel = document.getElementById('ciaConfigDeviceSel');
  if (!sel) return;
  var currentVal = sel.value;
  window.CSES.request('controlApi', { action: 'device_list', payload: {} }).then(function (devices) {
    var html = '<option value="__global__">全局配置（所有设备）</option>';
    (devices || []).forEach(function (d) {
      html += '<option value="' + d.device_id + '"' + (currentVal === d.device_id ? ' selected' : '') + '>' + escHtml(d.display_name) + '</option>';
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  }).catch(function () { });
}

function renderConfigTab(tab) {
  var container = document.getElementById('ciaConfigContent');
  var uid = (window.CSES.instance && window.CSES.instance.uid) || '';
  var serverUrl = window.location.origin;
  var isGlobal = configDeviceId === '__global__';
  var scopeTag = isGlobal ? '（全局）' : '（设备覆盖）';
  var html = '';
  switch (tab) {
    case 'sync':
      html = '<h2>同步设置 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        '<div class="cia-config-card">' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">自动同步</div><div class="cia-config-item-desc">客户端后台定期向平台拉取命令与档案更新。</div></div><div class="cia-config-item-action"><select onchange="saveConfigField(\'sync.autoSync\', this.value === \'true\')"><option value="true"' + (getConfigField('sync.autoSync', true) !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('sync.autoSync', true) === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">同步间隔</div><div class="cia-config-item-desc">客户端向平台拉取命令与档案版本的最小间隔（秒），实际以服务器限制为准。</div></div><div class="cia-config-item-action"><input type="number" value="' + escAttr(getConfigField('sync.pollInterval', 300)) + '" min="5" max="86400" onchange="saveConfigField(\'sync.pollInterval\', parseInt(this.value)||300)" style="width:110px" /><span style="font-size:11px;color:var(--text-tertiary)">秒</span></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">档案应用方式</div><div class="cia-config-item-desc">热替换立即生效；写入文件则在客户端重启或手动切换档案后生效。</div></div><div class="cia-config-item-action"><select onchange="saveConfigField(\'sync.applyMode\', this.value)"><option value="hotswap"' + (getConfigField('sync.applyMode', 'hotswap') === 'hotswap' ? ' selected' : '') + '>热替换（立即生效）</option><option value="file"' + (getConfigField('sync.applyMode') === 'file' ? ' selected' : '') + '>写入档案文件</option></select></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">默认目标档案名</div><div class="cia-config-item-desc">部署时客户端默认保存的档案文件名（不含路径）。</div></div><div class="cia-config-item-action"><input type="text" value="' + escAttr(getConfigField('sync.targetProfile', 'CSES-Cloud.json')) + '" onchange="saveConfigField(\'sync.targetProfile\', this.value)" style="width:180px" /></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">连接传输</div><div class="cia-config-item-desc">长轮询为 REST 轮询；WebSocket 为实时推送（断线自动回退长轮询）。</div></div><div class="cia-config-item-action"><select onchange="saveConfigField(\'sync.transport\', this.value)"><option value="poll"' + (getConfigField('sync.transport', 'poll') !== 'ws' ? ' selected' : '') + '>长轮询</option><option value="ws"' + (getConfigField('sync.transport', 'poll') === 'ws' ? ' selected' : '') + '>WebSocket</option></select></div></div>' +
        '</div>';
      break;
    case 'notification':
      html = '<h2>通知 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        '<div class="cia-config-card">' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">平台广播提醒</div><div class="cia-config-item-desc">客户端收到 broadcast.show 命令时弹出 ClassIsland 提醒。</div></div><div class="cia-config-item-action"><select onchange="saveConfigField(\'notification.enabled\', this.value === \'true\')"><option value="true"' + (getConfigField('notification.enabled', true) !== false ? ' selected' : '') + '>开启</option><option value="false"' + (getConfigField('notification.enabled', true) === false ? ' selected' : '') + '>关闭</option></select></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">广播提醒时长</div><div class="cia-config-item-desc">广播提醒在屏幕上停留的时间。</div></div><div class="cia-config-item-action"><input type="number" value="' + escAttr(getConfigField('notification.durationSeconds', 10)) + '" min="3" max="120" onchange="saveConfigField(\'notification.durationSeconds\', parseInt(this.value)||10)" style="width:90px" /><span style="font-size:11px;color:var(--text-tertiary)">秒</span></div></div>' +
        '</div>' +
        '<div class="cia-config-card">' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">发送测试广播</div><div class="cia-config-item-desc">' + (isGlobal ? '向所有在线设备下发一条测试广播。' : '向该设备下发一条测试广播。') + '</div></div><div class="cia-config-item-action"><button class="cia-btn small" onclick="showBroadcastDialog(' + (isGlobal ? '' : ('\'' + configDeviceId + '\', \'\'') ) + ')">发送</button></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">撤回广播</div><div class="cia-config-item-desc">向客户端下发 broadcast.dismiss 关闭当前提醒。</div></div><div class="cia-config-item-action"><button class="cia-btn small danger" onclick="dismissBroadcast(' + (isGlobal ? '' : ('\'' + configDeviceId + '\'')) + ')">撤回</button></div></div>' +
        '</div>';
      break;
    case 'connect':
      html = '<h2>客户端接入</h2>' +
        '<div class="cia-config-card">' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">服务器地址</div><div class="cia-config-item-desc">ClassIsland「CSES Cloud 适配器」设置中填写的服务器地址。</div></div><div class="cia-config-item-action"><code class="cia-code-chip">' + escHtml(serverUrl) + '</code></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">实例 UID</div><div class="cia-config-item-desc">与注册码二选一填写；填写后客户端无需通过注册码解析实例。</div></div><div class="cia-config-item-action"><code class="cia-code-chip">' + escHtml(uid) + '</code></div></div>' +
        '</div>' +
        '<div class="cia-tip-box">' +
          '<strong>接入步骤：</strong><br>' +
          '1. 在 ClassIsland 客户端安装「CSES Cloud 适配器」插件（.cipx 包，见适配器 README）；<br>' +
          '2. 在「连接应用」页面生成注册码，可直接「下载凭据」文件；<br>' +
          '3. 在 ClassIsland 设置 → CSES Cloud 适配器 中「导入凭据」（或手动填写服务器地址与注册码），点击「连接」；<br>' +
          '4. 设备出现在「连接应用」页面后，即可在「档案管理」中向其部署档案。' +
        '</div>';
      break;
    case 'advanced':
      html = '<h2>高级</h2>' +
        '<div class="cia-config-card">' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">REST 轮询频率限制</div><div class="cia-config-item-desc">长轮询设备的命令轮询间隔（秒）。客户端按此限制自适应调整。</div></div><div class="cia-config-item-action"><input type="number" id="ciaPollInterval" value="300" min="5" max="86400" style="width:110px" /><button class="cia-btn small" onclick="savePollInterval()">保存</button></div></div>' +
          '<div class="cia-config-divider"></div>' +
          '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">WebSocket 网关</div><div class="cia-config-item-desc">客户端 WebSocket 实时通信网关地址（传输为 ws 时使用）。</div></div><div class="cia-config-item-action"><code class="cia-code-chip">' + escHtml(serverUrl + '/api/ws-control') + '</code></div></div>' +
        '</div>';
      loadServerProtocolConfig();
      break;
  }
  container.innerHTML = '<div class="cia-config-tab">' + html + '</div>';
}

function loadServerProtocolConfig() {
  var input = document.getElementById('ciaPollInterval');
  if (!input) return;
  window.CSES.request('controlApi', { action: 'instance_protocol_get', payload: {} }).then(function (res) {
    if (res && res.poll_interval_seconds) input.value = res.poll_interval_seconds;
  }).catch(function () { });
}

async function savePollInterval() {
  var input = document.getElementById('ciaPollInterval');
  if (!input) return;
  var secs = parseInt(input.value, 10) || 0;
  try {
    var res = await window.CSES.request('controlApi', { action: 'instance_protocol_set', payload: { poll_interval_seconds: secs } });
    alert('已保存，REST 轮询间隔: ' + res.poll_interval_seconds + ' 秒');
    input.value = res.poll_interval_seconds;
  } catch (e) { alert('保存失败: ' + e.message); }
}
