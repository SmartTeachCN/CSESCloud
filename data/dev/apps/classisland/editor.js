// ClassIsland 平台侧实例应用
// 通过 window.CSES.request 与平台通信：controlApi（设备/注册码/命令）、listCiProfiles/openProfile 等（档案文件）。

var currentPage = 'connect';
var selectedProfileId = null;
var deployProfileId = null;
var lastEnrollCode = null;
var configCache = {};
var autoSaveEnabled = true;    // 平台 Ribbon「自动保存」开关（由宿主经 __ceseAutoSave 同步）
var configDirty = false;       // 自动保存关闭时，配置有未写入的更改

// ===== 初始化 =====
(function init() {
  loadConfig().then(function () { switchPage('connect'); });
  listenCommands();
})();

function listenCommands() {
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    // 平台自动保存开关同步：重新开启时冲销未保存的配置更改
    if (typeof e.data.__ceseAutoSave === 'boolean') {
      var prev = autoSaveEnabled;
      autoSaveEnabled = e.data.__ceseAutoSave;
      if (!prev && autoSaveEnabled && configDirty) saveConfig();
      return;
    }
    if (!e.data.__ceseCommand) return;
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

// ===== 设备管理（卡片化列表 + 多选 + 设备管理模态框） =====
var deviceMultiSelect = false;
var selectedDevices = new Set();
var openMenuDeviceId = null;
var modalDevice = null;       // 当前模态框设备（device_get 结果）
var modalDeviceTab = 'basic';
var cachedProfiles = [];      // 档案列表缓存（供设备模态框“活动课表”使用）

async function refreshDevices() {
  try {
    var devices = await window.CSES.request('controlApi', { action: 'device_list', payload: {} }) || [];
    var profilePlaying = {};
    try {
      cachedProfiles = await window.CSES.request('listCiProfiles') || [];
      document.getElementById('ciaStatProfiles').textContent = cachedProfiles.length;
      cachedProfiles.forEach(function (p) {
        (p.playing || []).forEach(function (devId) { profilePlaying[devId] = p; });
      });
    } catch (e) { /* 忽略 */ }
    renderDeviceCards(devices, profilePlaying);
    updateDeviceStats(devices);
  } catch (e) { console.error('获取设备列表失败:', e); }
}

/** 在线判定：优先使用服务端按协议/轮询间隔计算的 is_online；缺失时按协议放宽窗口回退 */
function deviceOnline(d) {
  if (d && typeof d.is_online === 'boolean') return d.is_online;
  if (!d || !d.last_seen_at) return false;
  var t = Date.parse(String(d.last_seen_at).replace(' ', 'T'));
  if (isNaN(t)) return false;
  var threshold = d.protocol === 'ws' ? 90000 : 630000; // 长轮询默认间隔 300 秒，放宽到 2 倍以上
  return (Date.now() - t) < threshold;
}

function renderDeviceCards(devices, profilePlaying) {
  var container = document.getElementById('ciaDeviceGrid');
  if (!devices || devices.length === 0) {
    container.innerHTML = '<div class="cia-empty">暂无设备连接，请生成注册码并在 ClassIsland 客户端的「CSES Cloud 适配器」中导入凭据（或填写服务器地址与注册码）</div>';
    return;
  }
  container.innerHTML = devices.map(function (d) {
    var lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
    var isOnline = deviceOnline(d);
    var notes = d.notes || '';
    var rep = d.last_reported_state || {};
    var curProfile = rep.profile || null;
    var playing = profilePlaying[d.device_id];
    var profileLine = curProfile
      ? escHtml(curProfile.name || curProfile.profile_name || '未命名') + (curProfile.version ? '（' + escHtml(String(curProfile.version).slice(0, 8)) + '）' : '')
      : (playing ? '部署中: ' + escHtml(playing.profile_name || playing.name || '未命名') : '');
    var checked = selectedDevices.has(d.device_id);
    var meta = escHtml(d.platform || 'ClassIsland') + ' · ' + escHtml(d.app_version || '') + ' · ' +
      (isOnline ? '在线' : '离线') + ' · ' + (d.protocol === 'ws' ? 'WebSocket' : '长轮询') +
      (lastSeen ? '<br>最后在线 ' + escHtml(String(d.last_seen_at).slice(5, 16)) : '');
    return '<div class="cia-device-card' + (checked && deviceMultiSelect ? ' selected' : '') + (deviceMultiSelect ? ' with-check' : '') + '" id="ciacard_' + escAttr(d.device_id) + '"' +
      (deviceMultiSelect
        ? ' onclick="toggleDeviceSelect(\'' + d.device_id + '\')"'
        : ' onclick="openDeviceModal(\'' + d.device_id + '\')"') +
      ' oncontextmenu="event.preventDefault(); event.stopPropagation(); toggleDeviceMenu(\'' + d.device_id + '\')"' +
      ' title="点击查看/编辑设备，右键打开菜单">' +
      (deviceMultiSelect ? '<span class="cia-device-card-check"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onclick="event.stopPropagation();toggleDeviceSelect(\'' + d.device_id + '\')" /></span>' : '') +
      '<div class="cia-device-card-head">' +
        '<span class="cia-device-status ' + (isOnline ? 'online' : 'offline') + '"></span>' +
        '<span class="cia-device-name" title="' + escAttr(d.display_name) + '">' + escHtml(d.display_name) + '</span>' +
        '<button class="cia-device-card-menu-btn" title="设备菜单" onclick="event.stopPropagation();toggleDeviceMenu(\'' + d.device_id + '\')">&#8943;</button>' +
      '</div>' +
      '<div class="cia-device-card-meta">' + meta + '</div>' +
      '<div class="cia-device-card-profile">' + (profileLine || '<span style="color:var(--text-tertiary)">未应用档案</span>') + '</div>' +
      (notes ? '<div class="cia-device-card-notes">' + escHtml(notes) + '</div>' : '') +
      '<div class="cia-device-menu" id="ciamenu_' + escAttr(d.device_id) + '" style="display:none" onclick="event.stopPropagation()">' +
        '<button class="cia-device-menu-item" onclick="closeDeviceMenu();openDeviceModal(\'' + d.device_id + '\')">查看 / 编辑设备</button>' +
        '<button class="cia-device-menu-item" onclick="closeDeviceMenu();openDeviceModal(\'' + d.device_id + '\', \'broadcast\')">发送广播</button>' +
        '<button class="cia-device-menu-item" onclick="closeDeviceMenu();restartClient(\'' + d.device_id + '\')">重启客户端</button>' +
        '<button class="cia-device-menu-item danger" onclick="closeDeviceMenu();unregisterDevice(\'' + d.device_id + '\', \'' + escAttr(d.display_name) + '\')">删除设备</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/** 卡片 ⋯ 菜单开关（同一时间只开一个；点击其他区域自动关闭） */
function toggleDeviceMenu(deviceId) {
  if (openMenuDeviceId === deviceId) { closeDeviceMenu(); return; }
  closeDeviceMenu();
  openMenuDeviceId = deviceId;
  var menu = document.getElementById('ciamenu_' + deviceId);
  if (menu) menu.style.display = '';
}

function closeDeviceMenu() {
  if (!openMenuDeviceId) return;
  var menu = document.getElementById('ciamenu_' + openMenuDeviceId);
  if (menu) menu.style.display = 'none';
  openMenuDeviceId = null;
}

document.addEventListener('click', function () { closeDeviceMenu(); });

// ---- 多选 ----
function toggleDeviceMultiSelect() {
  deviceMultiSelect = !deviceMultiSelect;
  if (!deviceMultiSelect) selectedDevices.clear();
  document.getElementById('ciaDeviceMultiBar').style.display = deviceMultiSelect ? 'flex' : 'none';
  refreshDevices();
}

function toggleDeviceSelect(deviceId) {
  if (!deviceMultiSelect) return;
  if (selectedDevices.has(deviceId)) selectedDevices.delete(deviceId);
  else selectedDevices.add(deviceId);
  updateDeviceMultiBar();
  var card = document.getElementById('ciacard_' + deviceId);
  if (card) card.classList.toggle('selected', selectedDevices.has(deviceId));
  var check = card ? card.querySelector('input[type="checkbox"]') : null;
  if (check) check.checked = selectedDevices.has(deviceId);
}

function updateDeviceMultiBar() {
  document.getElementById('ciaDeviceMultiCount').textContent = '已选 ' + selectedDevices.size + ' 台设备';
}

function batchBroadcastDevices() {
  if (selectedDevices.size === 0) { alert('请先选择设备'); return; }
  showBroadcastDialog(Array.from(selectedDevices).join(','), selectedDevices.size + ' 台已选设备');
}

async function batchNotesDevices() {
  if (selectedDevices.size === 0) { alert('请先选择设备'); return; }
  var notes = prompt('为选中的 ' + selectedDevices.size + ' 台设备设置备注：');
  if (notes === null) return;
  var failed = 0;
  for (var deviceId of Array.from(selectedDevices)) {
    try {
      await window.CSES.request('controlApi', { action: 'device_update_notes', payload: { device_id: deviceId, notes: notes } });
    } catch (e) { failed++; }
  }
  alert(failed > 0 ? ('已完成，' + failed + ' 台设备备注更新失败') : '备注已更新');
  refreshDevices();
}

async function batchDeleteDevices() {
  if (selectedDevices.size === 0) { alert('请先选择设备'); return; }
  if (!confirm('确认删除选中的 ' + selectedDevices.size + ' 台设备？此操作会解除绑定并清除其待执行命令。')) return;
  for (var deviceId of Array.from(selectedDevices)) {
    try { await window.CSES.request('controlApi', { action: 'device_unregister', payload: { device_id: deviceId } }); } catch (e) { /* 忽略 */ }
  }
  selectedDevices.clear();
  updateDeviceMultiBar();
  refreshDevices();
}

function updateDeviceStats(devices) {
  var online = (devices || []).filter(deviceOnline).length;
  document.getElementById('ciaStatTotal').textContent = (devices || []).length;
  document.getElementById('ciaStatOnline').textContent = online;
}

/** 切换设备连接协议（WS 设备立即生效；长轮询设备在下次轮询时生效） */
async function setDeviceProtocol(deviceId, protocol) {
  if (!confirm('确认将该设备切换为 ' + (protocol === 'ws' ? 'WebSocket' : '长轮询(REST)') + ' 连接协议？')) {
    renderDeviceNetworkTab();
    refreshDevices();
    return;
  }
  try {
    var res = await window.CSES.request('controlApi', { action: 'device_set_protocol', payload: { device_id: deviceId, protocol: protocol } });
    alert((res && res.notice) || '协议已切换');
    modalDevice = await window.CSES.request('controlApi', { action: 'device_get', payload: { device_id: deviceId } });
    renderDeviceNetworkTab();
    setTimeout(refreshDevices, 1500);
  } catch (e) {
    alert('切换协议失败: ' + e.message);
    refreshDevices();
  }
}

// ===== 设备管理模态框（基本 / 网络 / 广播 / 历史命令） =====
async function openDeviceModal(deviceId, tab) {
  try {
    modalDevice = await window.CSES.request('controlApi', { action: 'device_get', payload: { device_id: deviceId } });
  } catch (e) { alert('获取设备信息失败: ' + e.message); return; }
  document.getElementById('ciaDeviceModalTitle').textContent = modalDevice.display_name || deviceId;
  modalDeviceTab = tab || 'basic';
  switchDeviceTab(modalDeviceTab);
  document.getElementById('ciaDeviceModal').style.display = '';
}

function closeDeviceModal() {
  document.getElementById('ciaDeviceModal').style.display = 'none';
  modalDevice = null;
  refreshDevices();
}

function switchDeviceTab(tab) {
  modalDeviceTab = tab;
  var tabs = document.querySelectorAll('#ciaDeviceModal .cia-modal-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
  if (tab === 'basic') renderDeviceBasicTab();
  else if (tab === 'network') renderDeviceNetworkTab();
  else if (tab === 'broadcast') renderDeviceBroadcastTab();
  else if (tab === 'commands') renderDeviceCommandsTab();
}

function renderDeviceBasicTab() {
  var box = document.getElementById('ciaDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  var rep = modalDevice.last_reported_state || {};
  var curProfile = rep.profile || null;
  var currentProfileName = curProfile ? (curProfile.name || curProfile.profile_name || '未命名') : '';
  box.innerHTML =
    // 档案 / 设置 两个左右并列的入口卡片
    '<div class="cia-jump-cards">' +
      '<div class="cia-jump-card">' +
        '<div class="cia-jump-title">课表档案</div>' +
        '<div class="cia-jump-value" title="' + escAttr(currentProfileName) + '">' + (currentProfileName ? escHtml(currentProfileName) : '未应用档案') + '</div>' +
        '<button class="cia-jump-btn" onclick="openProfilePickerModal()">' +
          '<span>选择档案应用</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="cia-jump-card">' +
        '<div class="cia-jump-title">应用设置</div>' +
        '<div class="cia-jump-value">同步 / 通知 / 客户端设置</div>' +
        '<button class="cia-jump-btn" onclick="jumpToConfig()">' +
          '<span>前往设置</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +

    '<div class="cia-modal-section-title">基本信息</div>' +
    '<table class="cia-device-info-table">' +
      '<tr><th>设备 ID</th><td><code class="cia-code-chip">' + escHtml(modalDevice.device_id) + '</code></td></tr>' +
      '<tr><th>平台 / 版本</th><td>' + escHtml(modalDevice.platform || 'ClassIsland') + ' · ' + escHtml(modalDevice.architecture || '') + ' · ' + escHtml(modalDevice.app_version || '') + '</td></tr>' +
      '<tr><th>连接协议</th><td>' + (modalDevice.protocol === 'ws' ? 'WebSocket' : '长轮询') + '</td></tr>' +
      '<tr><th>注册时间</th><td>' + escHtml(String(modalDevice.enrolled_at || '').slice(0, 19)) + '</td></tr>' +
      '<tr><th>最后在线</th><td>' + escHtml(String(modalDevice.last_seen_at || '').slice(0, 19)) + (deviceOnline(modalDevice) ? '（在线）' : '') + '</td></tr>' +
      '<tr><th>备注</th><td><div class="cia-inline-row"><input type="text" id="ciaDevNotes" value="' + escAttr(modalDevice.notes || '') + '" placeholder="设备备注" /><button class="cia-btn small" onclick="saveDeviceNotes()">保存</button></div></td></tr>' +
    '</div>';
}

/** 广播 Tab（独立页签，含显示时长） */
function renderDeviceBroadcastTab() {
  var box = document.getElementById('ciaDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  box.innerHTML =
    '<div class="cia-tip-box" style="margin-bottom:var(--spacer-3)">向该设备发送广播，客户端将以提醒（遮罩 + 正文）形式显示。</div>' +
    '<div class="cia-field"><label>标题</label><input type="text" id="ciaDevBroadcastTitle" placeholder="通知标题" /></div>' +
    '<div class="cia-field"><label>内容</label><textarea id="ciaDevBroadcastBody" rows="3" placeholder="广播正文（可选）"></textarea></div>' +
    '<div class="cia-inline-row">' +
      '<select id="ciaDevBroadcastSeverity"><option value="info">信息</option><option value="success">成功</option><option value="warning">警告</option><option value="error">错误</option></select>' +
      '<input type="number" id="ciaDevBroadcastDuration" value="' + escAttr(getConfigField('notification.durationSeconds', 10)) + '" min="3" max="120" title="显示时长（秒）" />' +
      '<span style="font-size:11px;color:var(--text-tertiary)">显示时长（秒）</span>' +
      '<button class="cia-btn small primary" onclick="sendDeviceBroadcast()">发送广播</button>' +
    '</div>' +
    '<div class="cia-inline-row" style="margin-top:var(--spacer-3)">' +
      '<button class="cia-btn small danger" onclick="dismissBroadcast(modalDevice.device_id)">撤回当前广播</button>' +
    '</div>';
}

function renderDeviceNetworkTab() {
  var box = document.getElementById('ciaDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  var protocol = modalDevice.protocol || 'poll';
  var serverUrl = window.location.origin;
  var uid = (window.CSES.instance && window.CSES.instance.uid) || '';
  box.innerHTML =
    '<div class="cia-modal-section-title">连接协议</div>' +
    '<div class="cia-config-item" style="border:1px solid var(--divider-stroke);border-radius:var(--radius-md)">' +
      '<div class="cia-config-item-main"><div class="cia-config-item-title">传输协议</div><div class="cia-config-item-desc">长轮询为 REST 轮询；WebSocket 为实时推送（客户端断线自动回退长轮询）。</div></div>' +
      '<div class="cia-config-item-action"><select class="cia-protocol-select" id="ciaDevProtoSel">' +
        '<option value="poll"' + (protocol !== 'ws' ? ' selected' : '') + '>长轮询</option>' +
        '<option value="ws"' + (protocol === 'ws' ? ' selected' : '') + '>WebSocket</option>' +
      '</select><button class="cia-btn small" onclick="applyDeviceProtocol()">应用</button></div>' +
    '</div>' +
    '<div class="cia-modal-section-title">连接信息</div>' +
    '<table class="cia-device-info-table">' +
      '<tr><th>REST 控制端点</th><td><code class="cia-code-chip">' + escHtml(serverUrl + '/api/rest-control?instance_uid=' + uid) + '</code></td></tr>' +
      '<tr><th>WebSocket 网关</th><td><code class="cia-code-chip">' + escHtml(serverUrl + '/api/ws-control') + '</code></td></tr>' +
      '<tr><th>轮询间隔限制</th><td id="ciaDevPollCell">读取中…</td></tr>' +
    '</table>';
  window.CSES.request('controlApi', { action: 'instance_protocol_get', payload: {} }).then(function (res) {
    var cell = document.getElementById('ciaDevPollCell');
    if (cell && res && res.poll_interval_seconds) cell.textContent = res.poll_interval_seconds + ' 秒（客户端按此限制自适应）';
  }).catch(function () { });
}

function renderDeviceCommandsTab() {
  var box = document.getElementById('ciaDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="cia-modal-section-title">历史命令（最近 100 条）</div><div id="ciaDevCmdList"><div class="cia-empty cia-empty-compact">加载中...</div></div>';
  window.CSES.request('controlApi', { action: 'command_list', payload: { device_id: modalDevice.device_id } }).then(function (cmds) {
    var list = cmds || [];
    var target = document.getElementById('ciaDevCmdList');
    if (!target) return;
    if (list.length === 0) {
      target.innerHTML = '<div class="cia-empty">暂无命令记录</div>';
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
    target.innerHTML = '<table class="cia-cmd-table"><thead><tr><th>类型</th><th>参数</th><th>状态</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }).catch(function (e) {
    var target = document.getElementById('ciaDevCmdList');
    if (target) target.innerHTML = '<div class="cia-empty">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function saveDeviceNotes() {
  if (!modalDevice) return;
  var notes = document.getElementById('ciaDevNotes').value;
  window.CSES.request('controlApi', { action: 'device_update_notes', payload: { device_id: modalDevice.device_id, notes: notes } })
    .then(function () {
      modalDevice.notes = notes;
      alert('备注已保存');
      refreshDevices();
    })
    .catch(function (e) { alert('更新备注失败: ' + e.message); });
}

/** 应用设置：跳转到应用配置界面（左侧栏选中该设备） */
function jumpToConfig() {
  var deviceId = modalDevice ? modalDevice.device_id : null;
  closeDeviceModal();
  switchPage('config');
  if (!deviceId) return;
  // 页面渲染后把左侧栏设备选择器定位到该设备
  setTimeout(function () {
    var sel = document.getElementById('ciaConfigDeviceSel');
    if (!sel) return;
    var optExists = Array.prototype.some.call(sel.options, function (o) { return o.value === deviceId; });
    if (optExists) {
      sel.value = deviceId;
      switchConfigDevice(deviceId);
    }
  }, 300);
}

function sendDeviceBroadcast() {
  if (!modalDevice) return;
  var title = document.getElementById('ciaDevBroadcastTitle').value.trim();
  var body = document.getElementById('ciaDevBroadcastBody').value.trim();
  var severity = document.getElementById('ciaDevBroadcastSeverity').value;
  var duration = parseInt(document.getElementById('ciaDevBroadcastDuration').value, 10) || 10;
  duration = Math.min(Math.max(duration, 3), 120);
  if (!title) { alert('请输入广播标题'); return; }
  window.CSES.request('controlApi', {
    action: 'command_create',
    payload: {
      command_type: 'broadcast.show',
      device_id: modalDevice.device_id,
      payload: {
        broadcast_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        title: title, body: body, severity: severity, duration_seconds: duration,
        expires_at: new Date(Date.now() + 3600000).toISOString()
      }
    }
  }).then(function () { alert('广播已下发'); })
    .catch(function (e) { alert('广播下发失败: ' + e.message); });
}

async function applyDeviceProtocol() {
  if (!modalDevice) return;
  var protocol = document.getElementById('ciaDevProtoSel').value;
  await setDeviceProtocol(modalDevice.device_id, protocol);
}

function deleteDeviceFromModal() {
  if (!modalDevice) return;
  if (!confirm('确认删除设备「' + (modalDevice.display_name || modalDevice.device_id) + '」？此操作会解除绑定并清除其待执行命令。')) return;
  var deviceId = modalDevice.device_id;
  window.CSES.request('controlApi', { action: 'device_unregister', payload: { device_id: deviceId } })
    .then(function () {
      closeDeviceModal();
      alert('设备已删除');
    })
    .catch(function (e) { alert('删除失败: ' + e.message); });
}

/** 重启客户端（下发 client.restart，客户端适配器收到后调用 AppBase.Restart 自动重启） */
async function restartClient(deviceId) {
  if (!deviceId) return;
  if (!confirm('确认向该设备发送重启客户端指令？客户端收到命令后将立即重启。')) return;
  try {
    await window.CSES.request('controlApi', {
      action: 'command_create',
      payload: { command_type: 'client.restart', device_id: deviceId, payload: { source: 'platform' } }
    });
    alert('重启指令已下发，客户端将在收到命令后自动重启');
  } catch (e) { alert('重启指令下发失败: ' + e.message); }
}

function restartClientFromModal() {
  if (modalDevice) restartClient(modalDevice.device_id);
}

// ===== 档案选择弹框（课表档案「编辑」：弹出选一个档案并应用） =====
var pickerDeviceId = null;
var pickerSelectedProfileId = null;

function openProfilePickerModal() {
  if (!modalDevice) return;
  pickerDeviceId = modalDevice.device_id;
  pickerSelectedProfileId = null;
  var rep = modalDevice.last_reported_state || {};
  var currentId = rep.profile && rep.profile.config_id ? String(rep.profile.config_id) : '';
  document.getElementById('ciaProfilePickerModal').style.display = '';
  var list = document.getElementById('ciaProfilePickerList');
  list.innerHTML = '<div class="cia-empty cia-empty-compact">加载中...</div>';
  // 实时拉取档案列表，避免陈旧缓存导致“当前档案”标记/关联失效
  window.CSES.request('listCiProfiles').then(function (profiles) {
    cachedProfiles = profiles || [];
    if (pickerDeviceId !== modalDevice?.device_id) return; // 弹框已被关闭/切换
    if (!cachedProfiles.length) {
      list.innerHTML = '<div class="cia-empty">暂无档案，请先在「档案管理」页面创建</div>';
      return;
    }
    list.innerHTML = cachedProfiles.map(function (p) {
      var checked = String(p.id) === currentId;
      if (checked) pickerSelectedProfileId = String(p.id);
      return '<label class="cia-picker-item' + (checked ? ' selected' : '') + '" data-id="' + p.id + '">' +
        '<input type="radio" name="ciaProfilePicker" value="' + p.id + '"' + (checked ? ' checked' : '') + ' onchange="pickerSelectedProfileId = String(this.value); markPickerSelection()" />' +
        '<span class="cia-picker-main"><b>' + escHtml(p.profile_name || p.name) + '</b>' +
        '<small>' + p.subjects + ' 科目 · ' + p.layouts + ' 时间表 · ' + p.plans + ' 课表</small></span>' +
        (checked ? '<span class="cia-picker-current">当前</span>' : '') +
        '</label>';
    }).join('');
  }).catch(function (e) {
    list.innerHTML = '<div class="cia-empty">档案列表加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function markPickerSelection() {
  var items = document.querySelectorAll('#ciaProfilePickerList .cia-picker-item');
  for (var i = 0; i < items.length; i++) {
    var radio = items[i].querySelector('input');
    items[i].classList.toggle('selected', radio && radio.checked);
  }
}

function closeProfilePicker() {
  document.getElementById('ciaProfilePickerModal').style.display = 'none';
  pickerDeviceId = null;
  pickerSelectedProfileId = null;
}

async function confirmApplyProfile() {
  if (!pickerDeviceId) return;
  if (!pickerSelectedProfileId) { alert('请先选择一个档案'); return; }
  var deviceId = pickerDeviceId;
  try {
    var res = await window.CSES.request('controlApi', {
      action: 'profile_deploy',
      payload: { profile_config_id: pickerSelectedProfileId, device_ids: [deviceId] }
    });
    closeProfilePicker();
    alert('已下发档案应用命令（' + (res.profile_name || '档案') + '），客户端将在下次轮询/推送时应用。');
    refreshDevices();
    // 延迟刷新设备模态框数据，客户端应用并上报后「课表档案」即显示新关联
    setTimeout(async function () {
      if (!modalDevice || modalDevice.device_id !== deviceId) return;
      try {
        modalDevice = await window.CSES.request('controlApi', { action: 'device_get', payload: { device_id: deviceId } });
        if (modalDeviceTab === 'basic' && document.getElementById('ciaDeviceModal').style.display !== 'none') {
          renderDeviceBasicTab();
        }
      } catch (e) { /* 忽略 */ }
    }, 3000);
  } catch (e) { alert('应用失败: ' + e.message); }
}

async function unregisterDevice(deviceId, displayName) {
  if (!confirm('确认删除设备「' + (displayName || deviceId) + '」？此操作会解除绑定并清除其待执行命令。')) return;
  try {
    await window.CSES.request('controlApi', { action: 'device_unregister', payload: { device_id: deviceId } });
    refreshDevices();
  } catch (e) { alert('删除失败: ' + e.message); }
}

// ===== 广播（通知接口：broadcast.show / broadcast.dismiss） =====
var broadcastTargetIds = null; // null = 所有设备；数组 = 指定设备

/** 打开广播弹窗（deviceIds 为空 = 广播到所有设备；数组 = 指定多台设备） */
function showBroadcastDialog(deviceIds, displayName) {
  broadcastTargetIds = deviceIds ? String(deviceIds).split(',').filter(Boolean) : null;
  document.getElementById('ciaBroadcastTarget').textContent = displayName || (deviceIds ? deviceIds : '所有设备');
  document.getElementById('ciaBroadcastTitle').value = '通知';
  document.getElementById('ciaBroadcastBody').value = '';
  document.getElementById('ciaBroadcastSeverity').value = 'info';
  document.getElementById('ciaBroadcastDuration').value = getConfigField('notification.durationSeconds', 10);
  document.getElementById('ciaBroadcastModal').style.display = '';
}

function closeBroadcastDialog() {
  document.getElementById('ciaBroadcastModal').style.display = 'none';
  broadcastTargetIds = null;
}

async function sendBroadcast() {
  var title = document.getElementById('ciaBroadcastTitle').value.trim();
  var body = document.getElementById('ciaBroadcastBody').value.trim();
  var severity = document.getElementById('ciaBroadcastSeverity').value;
  var duration = parseInt(document.getElementById('ciaBroadcastDuration').value, 10) || 10;
  duration = Math.min(Math.max(duration, 3), 120);
  if (!title) { alert('请输入广播标题'); return; }
  var targets = broadcastTargetIds;
  var payload = {
    broadcast_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    title: title,
    body: body,
    severity: severity,
    duration_seconds: duration,
    expires_at: new Date(Date.now() + 3600000).toISOString()
  };
  try {
    if (targets && targets.length > 1) {
      // 多设备：逐台定向下发
      for (var i = 0; i < targets.length; i++) {
        await window.CSES.request('controlApi', {
          action: 'command_create',
          payload: { command_type: 'broadcast.show', device_id: targets[i], payload: payload }
        });
      }
      alert('广播已下发到 ' + targets.length + ' 台设备');
    } else {
      var cmdPayload = { command_type: 'broadcast.show', payload: payload };
      if (targets && targets.length === 1) cmdPayload.device_id = targets[0];
      var res = await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
      alert('广播已下发' + (res && res.max_delay_seconds > 0 ? '（长轮询设备最长延迟 ' + res.max_delay_seconds + ' 秒收到）' : ''));
    }
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
          '<span>· ' + escHtml((p.updated_at || '').slice(0, 10)) + '</span>' +
        '</div>' +
        playingHtml +
        (!multiSelectMode ? '<div class="cia-profile-card-actions">' +
          '<button class="cia-btn small primary" onclick="event.stopPropagation();editProfile(\'' + p.id + '\')">编辑</button>' +
          '<button class="cia-btn small" onclick="event.stopPropagation();openDeployDialog(\'' + p.id + '\')">部署</button>' +
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

// ===== 应用设置（左侧栏对齐 ClassIsland 设置窗口：通用 / 主界面 / 适配器，全局 + 设备分层，保存后经 settings.apply 实时同步到客户端） =====
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
  if (!autoSaveEnabled) {
    // 自动保存关闭：仅记录更改，待平台 Ribbon「保存」时再写入并下发
    configDirty = true;
    updateConfigDirtyBadge();
    return;
  }
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
    configDirty = false;
    updateConfigDirtyBadge();
  } catch (e) { console.error('保存配置失败:', e); }
}

/** 配置页「未保存更改」提示（自动保存关闭时） */
function updateConfigDirtyBadge() {
  var el = document.getElementById('ciaCfgDirtyBadge');
  if (el) el.style.display = configDirty ? '' : 'none';
}

/**
 * 配置同步：把配置展开为扁平的 "a.b.c" 键值后经 settings.apply 下发。
 * 全局配置保存时广播到所有设备；设备覆盖保存时仅定向该设备（受影响的设备）。
 * 客户端适配器按扁平键白名单写入适配器设置（sync.* / notification.*）与 ClassIsland 客户端设置（client.*）。
 */
function flattenSettings(obj, prefix, out) {
  for (var k in obj) {
    var v = obj[k];
    var key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenSettings(v, key, out);
    else out.push({ key: key, value: v });
  }
}

async function dispatchSettings() {
  // 重新合并：saveConfigField 直接写入层对象，configCache 若不刷新会下发旧值
  configCache = mergedConfig();
  var settings = [];
  for (var k in configCache) {
    if (k !== 'server') flattenSettings(configCache[k], k, settings);
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

/** 折叠/展开设置左栏导航组（对齐客户端 NavigationView 分组交互） */
function toggleConfigNavGroup(headEl) {
  headEl.parentElement.classList.toggle('open');
}

function renderConfigPage() {
  refreshConfigDeviceSelector();
  switchConfigTab('general');
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
    var count = document.getElementById('ciaConfigDeviceCount');
    if (count) count.textContent = '包含全部 ' + (devices || []).length + ' 台设备';
  }).catch(function () { });
}

// ---- 设置行构建工具（生成与 ClassIsland 设置项一致的行/卡片控件） ----
function cfgRow(title, desc, actionHtml) {
  return '<div class="cia-config-item"><div class="cia-config-item-main"><div class="cia-config-item-title">' + title + '</div><div class="cia-config-item-desc">' + desc + '</div></div><div class="cia-config-item-action">' + actionHtml + '</div></div>';
}

function cfgCard(title, rows) {
  return '<div class="cia-config-card">' + (title ? '<div class="cia-section-title">' + title + '</div>' : '') + rows.join('<div class="cia-config-divider"></div>') + '</div>';
}

/** 可展开设置项（对齐客户端 SettingsExpander：页眉标题+控件，点击展开显示子项） */
function cfgExpander(title, desc, footerHtml, childRows) {
  return '<div class="cia-expander">' +
    '<div class="cia-expander-head" onclick="toggleCfgExpander(this)">' +
      '<span class="cia-expander-chevron">&#9662;</span>' +
      '<div class="cia-config-item-main" style="flex:1"><div class="cia-config-item-title">' + title + '</div><div class="cia-config-item-desc">' + desc + '</div></div>' +
      (footerHtml ? '<div class="cia-config-item-action" onclick="event.stopPropagation()">' + footerHtml + '</div>' : '') +
    '</div>' +
    '<div class="cia-expander-body">' + childRows.join('<div class="cia-config-divider"></div>') + '</div>' +
  '</div>';
}

function toggleCfgExpander(headEl) {
  headEl.parentElement.classList.toggle('open');
}

/** 开关型设置（bool） */
function cfgBoolSelect(key, def) {
  return cfgSelect(key, def, [[true, '开启'], [false, '关闭']], 'this.value === \'true\'');
}

/** 下拉设置：options 为 [值, 显示文本] 数组；conv 为 onchange 中的取值表达式 */
function cfgSelect(key, def, options, conv) {
  var cur = getConfigField(key, def);
  var html = '<select onchange="saveConfigField(\'' + key + '\', ' + (conv || 'this.value') + ')">';
  options.forEach(function (o) {
    html += '<option value="' + escAttr(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + escHtml(o[1]) + '</option>';
  });
  return html + '</select>';
}

/** 数字输入：opts: {min,max,step,float} */
function cfgNumber(key, def, opts) {
  opts = opts || {};
  var cur = getConfigField(key, def);
  var conv = (opts.float ? 'parseFloat(this.value)' : 'parseInt(this.value)') + '||' + def;
  var attr = '';
  if (opts.min !== undefined) attr += ' min="' + opts.min + '"';
  if (opts.max !== undefined) attr += ' max="' + opts.max + '"';
  if (opts.step !== undefined) attr += ' step="' + opts.step + '"';
  return '<input type="number" value="' + escAttr(cur) + '"' + attr + ' onchange="saveConfigField(\'' + key + '\', ' + conv + ')" style="width:100px" />';
}

function cfgText(key, def, width) {
  var cur = getConfigField(key, def);
  return '<input type="text" value="' + escAttr(cur) + '" placeholder="' + escAttr(def) + '" onchange="saveConfigField(\'' + key + '\', this.value)" style="width:' + (width || 160) + 'px" />';
}

/** 日期输入（写回 yyyy-MM-dd 字符串，客户端以 DateTime 解析） */
function cfgDate(key, def) {
  var cur = String(getConfigField(key, def) || def || '');
  return '<input type="date" value="' + escAttr(cur.slice(0, 10)) + '" onchange="saveConfigField(\'' + key + '\', this.value)" style="width:150px" />';
}

/** 颜色输入（写回 #RRGGBB，客户端以 Avalonia Color 解析） */
function cfgColor(key, def) {
  var cur = String(getConfigField(key, def) || def);
  if (cur.charAt(0) === '#' && cur.length === 9) cur = '#' + cur.slice(3); // #AARRGGBB → #RRGGBB
  if (cur.charAt(0) !== '#') cur = def;
  return '<input type="color" value="' + escAttr(cur) + '" onchange="saveConfigField(\'' + key + '\', this.value)" />';
}

/** 单周开始时间默认值：本周周日（与 ClassIsland 默认一致） */
function weekStartDefault() {
  var d = new Date(Date.now() - new Date().getDay() * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderConfigTab(tab) {
  var container = document.getElementById('ciaConfigContent');
  var uid = (window.CSES.instance && window.CSES.instance.uid) || '';
  var serverUrl = window.location.origin;
  var isGlobal = configDeviceId === '__global__';
  var scopeTag = isGlobal ? '（全局）' : '（设备覆盖）';
  var html = '';
  switch (tab) {
    case 'general':
      html = '<h2>基本 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('主界面显示', [
          cfgExpander('隐藏模式', '基础模式按下方开关隐藏主界面；规则模式按条件规则隐藏。', cfgSelect('client.hideMode', 0, [[0, '基础模式'], [1, '规则模式']], 'parseInt(this.value)'), [
            cfgRow('上课时隐藏', '上课时间自动隐藏主界面。', cfgBoolSelect('client.hideOnClass', false)),
            cfgRow('前台是最大化窗口时隐藏', '', cfgBoolSelect('client.hideOnMaxWindow', false)),
            cfgRow('前台是全屏窗口时隐藏', '', cfgBoolSelect('client.hideOnFullscreen', false)),
          ]),
        ]) +
        cfgCard('周次', [
          cfgRow('单周开始时间', '单周轮换模式的起始日期（默认取本周周日）。', cfgDate('client.singleWeekStartTime', weekStartDefault())),
          cfgRow('多周轮换周期', '多周轮换的总周期长度（周）。', cfgNumber('client.multiWeekRotationMaxCycle', 4, { min: 1, max: 99 })),
        ]) +
        cfgCard('启动与任务栏', [
          cfgRow('显示启动画面', '客户端启动时显示 Splash 启动画面。', cfgBoolSelect('client.isSplashEnabled', false)),
          cfgRow('启动画面显示详细信息', '在启动画面上显示加载项详情。', cfgBoolSelect('client.showDetailedStatusOnSplash', false)),
          cfgRow('降低加载进度精度', '启动画面进度条以低精度推进，观感更平滑。', cfgBoolSelect('client.reduceProgressAccuracy', true)),
          cfgRow('任务栏图标点击行为', '点击客户端任务栏图标时执行的操作。', cfgSelect('client.taskBarIconClickBehavior', 0, [[0, '打开主菜单'], [1, '打开档案编辑窗口'], [2, '显示/隐藏主界面'], [3, '打开换课窗口'], [4, '打开设置窗口']], 'parseInt(this.value)')),
        ]);
      break;
    case 'clock':
      html = '<h2>时钟 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('精确时间', [
          cfgExpander('使用精确时间', '从 NTP 服务器获取精确时间进行课程计算。', cfgBoolSelect('client.exactTimeEnabled', true), [
            cfgRow('NTP 服务器', '精确时间使用的 NTP 服务器地址。', cfgText('client.exactTimeServer', 'ntp.aliyun.com', 150)),
            cfgRow('自动校时', '定期与 NTP 服务器校准时间。', cfgBoolSelect('client.timeAutoAdjust', false)),
            cfgRow('校时间隔（秒）', '自动校时的时间间隔。', cfgNumber('client.timeAutoAdjustSeconds', 0, { min: 0, max: 86400, float: true })),
            cfgRow('手动时间偏移（秒）', '在精确时间基础上手动调整的偏移量。', cfgNumber('client.timeOffsetSeconds', 0, { float: true })),
          ]),
        ]) +
        cfgCard('时间线显示', [
          cfgRow('时间点附加信息', '时间点上显示的附加信息类型。', cfgSelect('client.extraInfoType', 0, [[0, '持续时间'], [1, '已过/持续'], [2, '剩余/持续'], [3, '已过百分比'], [4, '剩余时间'], [5, '倒计时']], 'parseInt(this.value)')),
          cfgRow('结束倒计时', '时间点结束前显示倒计时。', cfgBoolSelect('client.countdownEnabled', true)),
          cfgRow('倒计时触发（秒）', '课程结束前多少秒开始显示倒计时。', cfgNumber('client.countdownSeconds', 60, { min: 1, max: 3600 })),
        ]) +
        cfgCard('默认时长', [
          cfgRow('默认上课时长（分钟）', '新建时间点时的默认上课时长。', cfgNumber('client.defaultOnClassMinutes', 40, { min: 1, max: 600 })),
          cfgRow('默认课间时长（分钟）', '新建时间点时的默认课间时长。', cfgNumber('client.defaultBreakingMinutes', 10, { min: 0, max: 600 })),
        ]);
      break;
    case 'storage':
      html = '<h2>存储 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('自动备份', [
          cfgRow('自动备份', '客户端定期自动备份数据。', cfgBoolSelect('client.autoBackupEnabled', true)),
          cfgRow('备份间隔（天）', '自动备份的间隔天数。', cfgNumber('client.autoBackupIntervalDays', 7, { min: 1, max: 365 })),
          cfgRow('备份保留数量', '最多保留的备份文件数量。', cfgNumber('client.autoBackupLimit', 16, { min: 1, max: 999 })),
        ]);
      break;
    case 'privacy':
      html = '<h2>隐私 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('隐私', [
          cfgRow('匿名使用情况统计', '向开发者上报匿名使用数据以改进 ClassIsland。', cfgBoolSelect('client.isReportingEnabled', true)),
          cfgRow('Sentry 错误上报', '客户端出错时向 Sentry 上报错误信息。', cfgBoolSelect('client.isSentryEnabled', true)),
        ]);
      break;
    case 'refreshing':
      html = '<h2>翻新与迎新 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('翻新提醒', [
          cfgRow('翻新提醒', '在关键时间节点显示翻新提醒横幅。', cfgBoolSelect('client.isRefreshingToastEnabled', true)),
          cfgRow('提醒阈值（天）', '距离关键时间节点多少天时开始显示提醒。', cfgNumber('client.refreshingToastThresholdDays', 20, { min: 1, max: 365 })),
          cfgRow('最多提醒次数', '整个翻新周期内最多显示的提醒次数。', cfgNumber('client.maxRefreshingToastCounts', 5, { min: 1, max: 99 })),
          cfgRow('剩余提醒次数', '当前周期内剩余的提醒次数。', cfgNumber('client.leftRefreshingToastCounts', 0, { min: 0, max: 99 })),
          cfgRow('下次启动显示迎新引导', '下次启动客户端时显示迎新引导。', cfgBoolSelect('client.showRefreshingToastOnNextStart', false)),
        ]);
      break;
    case 'advanced':
      html = '<h2>高级 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('插件', [
          cfgRow('自动禁用损坏的插件', '启动时检测并禁用加载失败的插件。', cfgBoolSelect('client.autoDisableCorruptPlugins', true)),
        ]) +
        cfgCard('调试', [
          cfgRow('显示调试选项', '在客户端设置窗口中显示调试页面。', cfgBoolSelect('client.isDebugOptionsEnabled', false)),
        ]);
      break;
    case 'components':
      html = '<h2>组件 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        '<div class="cia-tip-box">主界面组件（课程、日期、天气等）的添加与排列需在客户端主界面「编辑模式」中完成；整体显示样式可在「外观」页调整。此处暂无可远程下发的组件项。</div>';
      break;
    case 'appearance':
      html = '<h2>外观 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('主题', [
          cfgRow('应用主题', '客户端界面主题。', cfgSelect('client.theme', 2, [[0, '跟随系统'], [1, '明亮'], [2, '黑暗']], 'parseInt(this.value)')),
          cfgRow('主题亮度', '自定义主题的目标亮度（0-1）。', cfgNumber('client.targetLightValue', 0.6, { min: 0, max: 1, step: 0.05, float: true })),
          cfgRow('颜色回退模式', '主题颜色计算异常时使用回退方案。', cfgBoolSelect('client.isFallbackModeEnabled', true)),
        ]) +
        cfgCard('颜色', [
          cfgRow('主题色', '主界面强调颜色。', cfgColor('client.primaryColor', '#0067C0')),
          cfgRow('背景色', '主界面背景颜色（需开启自定义背景色）。', cfgColor('client.backgroundColor', '#FFFFFF')),
          cfgRow('自定义背景色', '启用上方自定义背景颜色。', cfgBoolSelect('client.isCustomBackgroundColorEnabled', false)),
        ]) +
        cfgCard('布局与缩放', [
          cfgRow('界面缩放（倍）', '客户端界面缩放倍率。', cfgNumber('client.scale', 1, { min: 0.5, max: 2, step: 0.05, float: true })),
          cfgRow('背景不透明度（%）', '主界面背景不透明度（0-100）。', '<input type="number" min="0" max="100" value="' + escAttr(Math.round(getConfigField('client.opacity', 0.5) * 100)) + '" onchange="saveConfigField(\'client.opacity\', (parseInt(this.value)||50)/100)" style="width:100px" />'),
          cfgRow('界面圆角（px）', '主界面圆角半径。', cfgNumber('client.radiusX', 8, { min: 0, max: 32, float: true })),
          cfgRow('动画效果级别', '0 完整 / 1 减少 / 2 关闭。', cfgSelect('client.animationLevel', 1, [[0, '完整'], [1, '减少'], [2, '关闭']], 'parseInt(this.value)')),
          cfgRow('分开显示信息岛', '主界面各组件以独立窗口显示。', cfgBoolSelect('client.isIslandSeperated', false)),
        ]) +
        cfgCard('字体', [
          cfgRow('主界面字体', '主界面使用的字体族。', cfgText('client.mainWindowFont', 'MiSans', 150)),
          cfgRow('次要字体大小', '', cfgNumber('client.mainWindowSecondaryFontSize', 14, { min: 8, max: 40, float: true })),
          cfgRow('正文字体大小', '', cfgNumber('client.mainWindowBodyFontSize', 16, { min: 8, max: 48, float: true })),
          cfgRow('强调字体大小', '', cfgNumber('client.mainWindowEmphasizedFontSize', 18, { min: 8, max: 48, float: true })),
          cfgRow('大号字体大小', '', cfgNumber('client.mainWindowLargeFontSize', 20, { min: 8, max: 64, float: true })),
          cfgRow('字体字重', '', cfgSelect('client.mainWindowFontWeight2', 500, [[400, '常规'], [500, '中等'], [600, '半粗'], [700, '粗体']], 'parseInt(this.value)')),
          cfgRow('行垂直边距（px）', '时间线每行文字的垂直边距。', cfgNumber('client.mainWindowLineVerticalMargin', 5, { min: 0, max: 20, float: true })),
        ]);
      break;
    case 'notification':
      html = '<h2>提醒 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('通知服务', [
          cfgRow('启用通知服务', '关闭后客户端不再弹出任何提醒。', cfgBoolSelect('client.isNotificationEnabled', true)),
          cfgRow('提醒效果', '启用提醒弹出动画效果。', cfgBoolSelect('client.isNotificationEffectEnabled', true)),
          cfgRow('允许提醒使用效果', '提醒提供方可使用弹出效果。', cfgBoolSelect('client.allowNotificationEffect', true)),
          cfgRow('提醒置顶', '提醒弹出时临时置顶显示。', cfgBoolSelect('client.isNotificationTopmostEnabled', true)),
          cfgRow('允许提醒置顶', '提醒提供方可请求置顶显示。', cfgBoolSelect('client.allowNotificationTopmost', true)),
        ]) +
        cfgCard('声音', [
          cfgExpander('提醒音效', '启用提醒音效。', cfgBoolSelect('client.isNotificationSoundEnabled', true), [
            cfgRow('允许提醒使用音效', '提醒提供方可播放音效。', cfgBoolSelect('client.allowNotificationSound', false)),
            cfgRow('提醒音量', '', cfgNumber('client.notificationSoundVolume', 1, { min: 0, max: 1, step: 0.05, float: true })),
          ]),
        ]) +
        cfgCard('语音', [
          cfgExpander('提醒语音', '启用提醒语音朗读。', cfgBoolSelect('client.isSpeechEnabled', true), [
            cfgRow('允许提醒使用语音', '提醒提供方可朗读内容。', cfgBoolSelect('client.allowNotificationSpeech', false)),
            cfgRow('语音音量', '', cfgNumber('client.speechVolume', 1, { min: 0, max: 1, step: 0.05, float: true })),
          ]),
        ]) +
        cfgCard('课程提醒', [
          cfgRow('准备上课提醒', '上课前指定时间发出提醒。', cfgBoolSelect('client.classPrepareEnabled', true)),
          cfgRow('提醒提前量（秒）', '准备上课提醒的提前秒数。', cfgNumber('client.classPrepareSeconds', 60, { min: 10, max: 3600 })),
          cfgRow('下课提醒', '下课时发出提醒。', cfgBoolSelect('client.classOffEnabled', true)),
          cfgRow('课程切换提醒', '课程切换时发出提醒。', cfgBoolSelect('client.classChangingEnabled', true)),
        ]);
      break;
    case 'window':
      html = '<h2>窗口 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('停靠位置', [
          cfgRow('停靠位置', '主界面在屏幕上的停靠位置。', cfgSelect('client.windowDockingLocation', 1, [[0, '上左'], [1, '上中'], [2, '上右'], [3, '下左'], [4, '下中'], [5, '下右']], 'parseInt(this.value)')),
          cfgRow('停靠显示器', '多显示器时主界面停靠的显示器编号（从 0 开始）。', cfgNumber('client.windowDockingMonitorIndex', 0, { min: 0, max: 9 })),
          cfgRow('水平偏移（px）', '相对停靠位置的水平偏移。', cfgNumber('client.windowDockingOffsetX', 0)),
          cfgRow('垂直偏移（px）', '相对停靠位置的垂直偏移。', cfgNumber('client.windowDockingOffsetY', 0)),
        ]) +
        cfgCard('窗口层级', [
          cfgRow('窗口层级', '置底显示在所有窗口后方，置顶显示在所有窗口前方。', cfgSelect('client.windowLayer', 1, [[0, '置底'], [1, '置顶']], 'parseInt(this.value)')),
          cfgRow('层级重设频率', '重新设置置顶/置底状态的时机，较高的频率会增加性能占用。', cfgSelect('client.windowTopmostRecheckMode', 0, [[0, '窗口层级变化时'], [1, '前台窗口变化时']], 'parseInt(this.value)')),
        ]) +
        cfgCard('交互与显示', [
          cfgRow('启用鼠标点击', '启用时鼠标可与主界面元素交互；禁用时点击将穿透到后方窗口。', cfgBoolSelect('client.isMouseClickingEnabled', true)),
          cfgExpander('指针移入淡化', '鼠标移入或触屏点击主界面区域时淡化主界面。', cfgBoolSelect('client.isMouseInFadingEnabled', true), [
            cfgRow('触屏点击后自动恢复时间（ms）', '触屏点击主界面后自动恢复显示的延时，0 为禁用。', cfgNumber('client.touchInFadingDurationMs', 0, { min: 0, float: true })),
          ]),
          cfgRow('阻止截图', '开启后其他应用无法截取主界面窗口内容。', cfgBoolSelect('client.isWindowCaptureBlockingEnabled', false)),
          cfgRow('使用原始输入', '使用 RawInput 接收鼠标/触屏事件，可区分鼠标与触摸；不兼容时可禁用。', cfgBoolSelect('client.useRawInput', false)),
        ]);
      break;
    case 'weather':
      html = '<h2>天气 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('城市与位置', [
          cfgRow('城市名称', '天气信息显示的城市名称。', cfgText('client.cityName', '北京 (北京, 中国)', 180)),
          cfgRow('城市 ID', '天气数据源的城市标识（如 weathercn:101010100）。', cfgText('client.cityId', 'weathercn:101010100', 180)),
          cfgRow('纬度', '', cfgNumber('client.weatherLatitude', 39.9, { min: -90, max: 90, step: 0.0001, float: true })),
          cfgRow('经度', '', cfgNumber('client.weatherLongitude', 116.4, { min: -180, max: 180, step: 0.0001, float: true })),
          cfgRow('自动刷新天气位置', '定期根据定位自动刷新天气位置。', cfgBoolSelect('client.autoRefreshWeatherLocation', false)),
        ]);
      break;
    case 'automation':
      html = '<h2>自动化 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('自动化', [
          cfgRow('启用自动化', '启用客户端的课表自动化规则。', cfgBoolSelect('client.isAutomationEnabled', false)),
        ]);
      break;
    case 'update':
      html = '<h2>更新</h2>' +
        '<div class="cia-tip-box">客户端更新请在客户端内进行（ClassIsland 设置 → 更新）。平台侧不远程管理客户端版本。</div>';
      break;
    case 'plugins':
      html = '<h2>插件</h2>' +
        '<div class="cia-tip-box">插件安装与管理在客户端设置 → 插件 中进行。平台侧可通过「CSES Cloud 适配器」页远程配置适配器插件的同步与提醒行为。</div>';
      break;
    case 'themes':
      html = '<h2>主题</h2>' +
        '<div class="cia-tip-box">主题包在客户端设置 → 主题 中管理。可通过「外观」页远程下发主题模式、颜色与字体等显示设置。</div>';
      break;
    case 'adapter':
      html = '<h2>CSES Cloud 适配器 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        '<div class="cia-tip-box" style="margin-bottom:var(--spacer-3)">本页对应客户端「CSES Cloud 适配器」插件的设置，保存后经 settings.apply 即时下发。</div>' +
        cfgCard('同步', [
          cfgRow('自动同步', '客户端后台定期向平台拉取命令与档案更新。', cfgBoolSelect('sync.autoSync', true)),
          cfgRow('同步间隔（秒）', '客户端向平台拉取命令与档案版本的最小间隔，实际以服务器限制为准。', cfgNumber('sync.pollInterval', 300, { min: 5, max: 86400 })),
          cfgRow('档案应用方式', '热替换立即生效；写入文件则在客户端重启或手动切换档案后生效。', cfgSelect('sync.applyMode', 'hotswap', [['hotswap', '热替换（立即生效）'], ['file', '写入档案文件']])),
          cfgRow('默认目标档案名', '部署时客户端默认保存的档案文件名。', cfgText('sync.targetProfile', 'CSES-Cloud.json', 170)),
          cfgRow('连接传输', '长轮询为 REST 轮询；WebSocket 为实时推送（断线自动回退长轮询）。', cfgSelect('sync.transport', 'poll', [['poll', '长轮询'], ['ws', 'WebSocket']])),
        ]) +
        cfgCard('广播提醒', [
          cfgRow('平台广播提醒', '客户端收到广播命令时弹出提醒。', cfgBoolSelect('notification.enabled', true)),
          cfgRow('广播提醒时长（秒）', '广播提醒在屏幕上停留的时间（3-120）。', cfgNumber('notification.durationSeconds', 10, { min: 3, max: 120 })),
        ]) +
        cfgCard('接入信息', [
          cfgRow('服务器地址', '客户端适配器设置中填写的服务器地址。', '<code class="cia-code-chip">' + escHtml(serverUrl) + '</code>'),
          cfgRow('实例 UID', '与注册码二选一填写；填写后客户端无需通过注册码解析实例。', '<code class="cia-code-chip">' + escHtml(uid) + '</code>'),
          cfgRow('WebSocket 网关', '客户端 WebSocket 实时通信网关地址。', '<code class="cia-code-chip">' + escHtml(serverUrl + '/api/ws-control') + '</code>'),
          cfgRow('REST 轮询频率限制（秒）', '长轮询设备的命令轮询间隔，客户端按此限制自适应调整。', '<input type="number" id="ciaPollInterval" value="300" min="5" max="86400" style="width:110px" /><button class="cia-btn small" onclick="savePollInterval()">保存</button>'),
        ]);
      loadServerProtocolConfig();
      break;
    default:
      switchConfigTab('general');
      return;
  }
  container.innerHTML = '<div class="cia-config-tab">' + html +
    '<div id="ciaCfgDirtyBadge" style="display:none;margin-top:var(--spacer-3);padding:var(--spacer-2) var(--spacer-3);border-radius:var(--radius-md);background:rgba(202,143,4,0.08);border:1px solid rgba(202,143,4,0.2);font-size:var(--font-size-xs);color:var(--status-warning)">有未保存的更改——平台「自动保存」已关闭，点击 Ribbon「保存」后才会写入并下发到设备。</div></div>';
  updateConfigDirtyBadge();
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
