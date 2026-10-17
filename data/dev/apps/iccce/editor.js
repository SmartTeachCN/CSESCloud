// ICC CE 平台侧实例应用
// 通过 window.CSES.request 与平台通信：controlApi（设备/注册码/命令）、loadConfigFile/saveConfigFile（配置分层存储）。
// 设置经 settings.apply 下发，客户端插件（CSES Cloud 适配器）按 icc.* / adapter.* 前缀应用到 ICC CE。

var currentPage = 'connect';
var lastEnrollCode = null;
var configCache = {};
var autoSaveEnabled = true;    // 平台 Ribbon「自动保存」开关（由宿主经 __ceseAutoSave 同步）
var configDirty = false;       // 自动保存关闭时，配置有未写入的更改

// ===== icc:// 远程命令清单（对齐客户端 MainWindow.HandleUriCommand）=====
var ICC_COMMANDS = [
  { group: '界面与工具栏', items: [
    { cmd: 'fold', label: '收纳工具栏' },
    { cmd: 'unfold', label: '展开工具栏' },
    { cmd: 'toggle', label: '切换收纳状态' },
    { cmd: 'thoroughhideon', label: '开启彻底隐藏' },
    { cmd: 'thoroughhideoff', label: '关闭彻底隐藏' },
    { cmd: 'thoroughhidetoggle', label: '切换彻底隐藏' }
  ]},
  { group: '工具切换', items: [
    { cmd: 'tool/pen', label: '画笔' },
    { cmd: 'tool/cursor', label: '光标模式' },
    { cmd: 'tool/eraser', label: '橡皮擦' },
    { cmd: 'tool/select', label: '套索选择' }
  ]},
  { group: '白板', items: [
    { cmd: 'whiteboard', label: '白板模式' },
    { cmd: 'newpage', label: '新建页' },
    { cmd: 'previouspage', label: '上一页' },
    { cmd: 'nextpage', label: '下一页' },
    { cmd: 'deletepage', label: '删除页' },
    { cmd: 'clear', label: '清空墨迹' },
    { cmd: 'clearall', label: '清空墨迹与历史' },
    { cmd: 'undo', label: '撤销' },
    { cmd: 'redo', label: '重做' },
    { cmd: 'freeze', label: '冻结墨迹' },
    { cmd: 'unfreeze', label: '解除冻结' }
  ]},
  { group: '课堂工具', items: [
    { cmd: 'randone', label: '一次点名' },
    { cmd: 'rand', label: '随机点名' },
    { cmd: 'timer', label: '计时器' },
    { cmd: 'booth', label: '展台' },
    { cmd: 'annotate', label: '批注模式' },
    { cmd: 'screenshot', label: '截图' }
  ]},
  { group: '生命周期', items: [
    { cmd: 'restart', label: '重启应用' },
    { cmd: 'restart/normal', label: '普通权限重启' },
    { cmd: 'restart/admin', label: '管理员重启' },
    { cmd: 'exit', label: '退出应用' }
  ]}
];
var ICC_DANGEROUS_COMMANDS = { 'restart': 1, 'restart/admin': 1, 'restart/normal': 1, 'exit': 1, 'quit': 1, 'clearall': 1, 'deletepage': 1 };

// ===== 初始化 =====
(function init() {
  loadConfig().then(function () { switchPage('connect'); });
  listenCommands();
})();

function listenCommands() {
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (typeof e.data.__ceseAutoSave === 'boolean') {
      var prev = autoSaveEnabled;
      autoSaveEnabled = e.data.__ceseAutoSave;
      if (!prev && autoSaveEnabled && configDirty) saveConfig();
      return;
    }
    if (!e.data.__ceseCommand) return;
    switch (e.data.__ceseCommand) {
      case 'page_connect': switchPage('connect'); break;
      case 'page_commands': switchPage('commands'); break;
      case 'page_config': switchPage('config'); break;
      case 'save': saveConfig(); break;
      case 'show_enrollment': showEnrollmentDialog(); break;
      case 'refresh_devices': refreshDevices(); refreshEnrollments(); break;
      case 'refresh': refreshDevices(); refreshEnrollments(); if (currentPage === 'commands') refreshCmdTargets(); break;
    }
  });
}

// ===== 页面切换 =====
function switchPage(page) {
  currentPage = page;
  document.getElementById('icxPageConnect').style.display = page === 'connect' ? '' : 'none';
  document.getElementById('icxPageCommands').style.display = page === 'commands' ? '' : 'none';
  document.getElementById('icxPageConfig').style.display = page === 'config' ? '' : 'none';
  if (page === 'connect') { refreshDevices(); refreshEnrollments(); }
  if (page === 'commands') { refreshCmdTargets(); renderCommandGroups(); }
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

async function refreshDevices() {
  try {
    var devices = await window.CSES.request('controlApi', { action: 'device_list', payload: {} }) || [];
    renderDeviceCards(devices);
    updateDeviceStats(devices);
  } catch (e) { console.error('获取设备列表失败:', e); }
}

/** 在线判定：优先使用服务端按协议/轮询间隔计算的 is_online；缺失时按协议放宽窗口回退 */
function deviceOnline(d) {
  if (d && typeof d.is_online === 'boolean') return d.is_online;
  if (!d || !d.last_seen_at) return false;
  var t = Date.parse(String(d.last_seen_at).replace(' ', 'T'));
  if (isNaN(t)) return false;
  var threshold = d.protocol === 'ws' ? 90000 : 630000;
  return (Date.now() - t) < threshold;
}

function renderDeviceCards(devices) {
  var container = document.getElementById('icxDeviceGrid');
  if (!devices || devices.length === 0) {
    container.innerHTML = '<div class="icx-empty">暂无设备连接，请生成注册码并在 ICC CE 客户端的「CSES Cloud 适配器」插件中填入服务器地址与注册码（或导入凭据文件）</div>';
    return;
  }
  container.innerHTML = devices.map(function (d) {
    var lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
    var isOnline = deviceOnline(d);
    var notes = d.notes || '';
    var rep = d.last_reported_state || {};
    var appVer = (rep.app && rep.app.version) || d.app_version || '';
    var uriScheme = rep.settings && typeof rep.settings.uriScheme === 'boolean' ? rep.settings.uriScheme : null;
    var stateLine = rep.settings
      ? 'URI命令' + (uriScheme === true ? '已开启' : (uriScheme === false ? '未开启' : '')) +
        (typeof rep.settings.nibMode === 'boolean' ? ' · ' + (rep.settings.nibMode ? '笔尖' : '手指') + '模式' : '')
      : '';
    var checked = selectedDevices.has(d.device_id);
    var meta = escHtml(d.platform || 'ICCCE') + ' · ' + escHtml(appVer) + ' · ' +
      (isOnline ? '在线' : '离线') + ' · ' + (d.protocol === 'ws' ? 'WebSocket' : '长轮询') +
      (lastSeen ? '<br>最后在线 ' + escHtml(String(d.last_seen_at).slice(5, 16)) : '');
    return '<div class="icx-device-card' + (checked && deviceMultiSelect ? ' selected' : '') + (deviceMultiSelect ? ' with-check' : '') + '" id="icxcard_' + escAttr(d.device_id) + '"' +
      (deviceMultiSelect
        ? ' onclick="toggleDeviceSelect(\'' + d.device_id + '\')"'
        : ' onclick="openDeviceModal(\'' + d.device_id + '\')"') +
      ' oncontextmenu="event.preventDefault(); event.stopPropagation(); toggleDeviceMenu(\'' + d.device_id + '\')"' +
      ' title="点击查看/编辑设备，右键打开菜单">' +
      (deviceMultiSelect ? '<span class="icx-device-card-check"><input type="checkbox" ' + (checked ? 'checked' : '') + ' onclick="event.stopPropagation();toggleDeviceSelect(\'' + d.device_id + '\')" /></span>' : '') +
      '<div class="icx-device-card-head">' +
        '<span class="icx-device-status ' + (isOnline ? 'online' : 'offline') + '"></span>' +
        '<span class="icx-device-name" title="' + escAttr(d.display_name) + '">' + escHtml(d.display_name) + '</span>' +
        '<button class="icx-device-card-menu-btn" title="设备菜单" onclick="event.stopPropagation();toggleDeviceMenu(\'' + d.device_id + '\')">&#8943;</button>' +
      '</div>' +
      '<div class="icx-device-card-meta">' + meta + '</div>' +
      '<div class="icx-device-card-state">' + (stateLine ? escHtml(stateLine) : '<span style="color:var(--text-tertiary)">尚未上报状态</span>') + '</div>' +
      (notes ? '<div class="icx-device-card-notes">' + escHtml(notes) + '</div>' : '') +
      '<div class="icx-device-menu" id="icxmenu_' + escAttr(d.device_id) + '" style="display:none" onclick="event.stopPropagation()">' +
        '<button class="icx-device-menu-item" onclick="closeDeviceMenu();openDeviceModal(\'' + d.device_id + '\')">查看 / 编辑设备</button>' +
        '<button class="icx-device-menu-item" onclick="closeDeviceMenu();openDeviceModal(\'' + d.device_id + '\', \'broadcast\')">发送通知</button>' +
        '<button class="icx-device-menu-item" onclick="closeDeviceMenu();restartClient(\'' + d.device_id + '\')">重启客户端</button>' +
        '<button class="icx-device-menu-item danger" onclick="closeDeviceMenu();unregisterDevice(\'' + d.device_id + '\', \'' + escAttr(d.display_name) + '\')">删除设备</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleDeviceMenu(deviceId) {
  if (openMenuDeviceId === deviceId) { closeDeviceMenu(); return; }
  closeDeviceMenu();
  openMenuDeviceId = deviceId;
  var menu = document.getElementById('icxmenu_' + deviceId);
  if (menu) menu.style.display = '';
}

function closeDeviceMenu() {
  if (!openMenuDeviceId) return;
  var menu = document.getElementById('icxmenu_' + openMenuDeviceId);
  if (menu) menu.style.display = 'none';
  openMenuDeviceId = null;
}

document.addEventListener('click', function () { closeDeviceMenu(); });

// ---- 多选 ----
function toggleDeviceMultiSelect() {
  deviceMultiSelect = !deviceMultiSelect;
  if (!deviceMultiSelect) selectedDevices.clear();
  document.getElementById('icxDeviceMultiBar').style.display = deviceMultiSelect ? 'flex' : 'none';
  refreshDevices();
}

function toggleDeviceSelect(deviceId) {
  if (!deviceMultiSelect) return;
  if (selectedDevices.has(deviceId)) selectedDevices.delete(deviceId);
  else selectedDevices.add(deviceId);
  updateDeviceMultiBar();
  var card = document.getElementById('icxcard_' + deviceId);
  if (card) card.classList.toggle('selected', selectedDevices.has(deviceId));
  var check = card ? card.querySelector('input[type="checkbox"]') : null;
  if (check) check.checked = selectedDevices.has(deviceId);
}

function updateDeviceMultiBar() {
  document.getElementById('icxDeviceMultiCount').textContent = '已选 ' + selectedDevices.size + ' 台设备';
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
  document.getElementById('icxStatTotal').textContent = (devices || []).length;
  document.getElementById('icxStatOnline').textContent = online;
}

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
  document.getElementById('icxDeviceModalTitle').textContent = modalDevice.display_name || deviceId;
  modalDeviceTab = tab || 'basic';
  switchDeviceTab(modalDeviceTab);
  document.getElementById('icxDeviceModal').style.display = '';
}

function closeDeviceModal() {
  document.getElementById('icxDeviceModal').style.display = 'none';
  modalDevice = null;
  refreshDevices();
}

function switchDeviceTab(tab) {
  modalDeviceTab = tab;
  var tabs = document.querySelectorAll('#icxDeviceModal .icx-modal-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
  if (tab === 'basic') renderDeviceBasicTab();
  else if (tab === 'network') renderDeviceNetworkTab();
  else if (tab === 'broadcast') renderDeviceBroadcastTab();
  else if (tab === 'commands') renderDeviceCommandsTab();
}

function renderDeviceBasicTab() {
  var box = document.getElementById('icxDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  box.innerHTML =
    '<div class="icx-jump-cards">' +
      '<div class="icx-jump-card">' +
        '<div class="icx-jump-title">远程控制</div>' +
        '<div class="icx-jump-value">收纳 / 白板 / 点名 / 计时器</div>' +
        '<button class="icx-jump-btn" onclick="closeDeviceModal();switchPage(\'commands\')">' +
          '<span>前往远程控制</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="icx-jump-card">' +
        '<div class="icx-jump-title">应用设置</div>' +
        '<div class="icx-jump-value">启动 / 外观 / 画笔 / 自动化</div>' +
        '<button class="icx-jump-btn" onclick="jumpToConfig()">' +
          '<span>前往设置</span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="icx-modal-section-title">基本信息</div>' +
    '<table class="icx-device-info-table">' +
      '<tr><th>设备 ID</th><td><code class="icx-code-chip">' + escHtml(modalDevice.device_id) + '</code></td></tr>' +
      '<tr><th>平台 / 版本</th><td>' + escHtml(modalDevice.platform || 'ICCCE') + ' · ' + escHtml(modalDevice.architecture || '') + ' · ' + escHtml(modalDevice.app_version || '') + '</td></tr>' +
      '<tr><th>连接协议</th><td>' + (modalDevice.protocol === 'ws' ? 'WebSocket' : '长轮询') + '</td></tr>' +
      '<tr><th>注册时间</th><td>' + escHtml(String(modalDevice.enrolled_at || '').slice(0, 19)) + '</td></tr>' +
      '<tr><th>最后在线</th><td>' + escHtml(String(modalDevice.last_seen_at || '').slice(0, 19)) + (deviceOnline(modalDevice) ? '（在线）' : '') + '</td></tr>' +
      '<tr><th>备注</th><td><div class="icx-inline-row"><input type="text" id="icxDevNotes" value="' + escAttr(modalDevice.notes || '') + '" placeholder="设备备注" /><button class="icx-btn small" onclick="saveDeviceNotes()">保存</button></div></td></tr>' +
    '</div>';
}

function renderDeviceBroadcastTab() {
  var box = document.getElementById('icxDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  box.innerHTML =
    '<div class="icx-tip-box" style="margin-bottom:var(--spacer-3)">向该设备发送应用内通知，客户端将以 ICC CE 通知中心提醒形式显示。</div>' +
    '<div class="icx-field"><label>标题</label><input type="text" id="icxDevBroadcastTitle" placeholder="通知标题" /></div>' +
    '<div class="icx-field"><label>内容</label><textarea id="icxDevBroadcastBody" rows="3" placeholder="通知正文（可选）"></textarea></div>' +
    '<div class="icx-inline-row">' +
      '<select id="icxDevBroadcastSeverity"><option value="info">信息</option><option value="success">成功</option><option value="warning">警告</option><option value="error">错误</option></select>' +
      '<button class="icx-btn small primary" onclick="sendDeviceBroadcast()">发送通知</button>' +
    '</div>';
}

function renderDeviceNetworkTab() {
  var box = document.getElementById('icxDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  var protocol = modalDevice.protocol || 'poll';
  var serverUrl = window.location.origin;
  var uid = (window.CSES.instance && window.CSES.instance.uid) || '';
  box.innerHTML =
    '<div class="icx-modal-section-title">连接协议</div>' +
    '<div class="icx-config-item" style="border:1px solid var(--divider-stroke);border-radius:var(--radius-md)">' +
      '<div class="icx-config-item-main"><div class="icx-config-item-title">传输协议</div><div class="icx-config-item-desc">长轮询为 REST 轮询；WebSocket 为实时推送（客户端断线自动回退长轮询）。</div></div>' +
      '<div class="icx-config-item-action"><select class="icx-protocol-select" id="icxDevProtoSel">' +
        '<option value="poll"' + (protocol !== 'ws' ? ' selected' : '') + '>长轮询</option>' +
        '<option value="ws"' + (protocol === 'ws' ? ' selected' : '') + '>WebSocket</option>' +
      '</select><button class="icx-btn small" onclick="applyDeviceProtocol()">应用</button></div>' +
    '</div>' +
    '<div class="icx-modal-section-title">连接信息</div>' +
    '<table class="icx-device-info-table">' +
      '<tr><th>REST 控制端点</th><td><code class="icx-code-chip">' + escHtml(serverUrl + '/api/rest-control?instance_uid=' + uid) + '</code></td></tr>' +
      '<tr><th>WebSocket 网关</th><td><code class="icx-code-chip">' + escHtml(serverUrl + '/api/ws-control') + '</code></td></tr>' +
      '<tr><th>轮询间隔限制</th><td id="icxDevPollCell">读取中…</td></tr>' +
    '</table>';
  window.CSES.request('controlApi', { action: 'instance_protocol_get', payload: {} }).then(function (res) {
    var cell = document.getElementById('icxDevPollCell');
    if (cell && res && res.poll_interval_seconds) cell.textContent = res.poll_interval_seconds + ' 秒（客户端按此限制自适应）';
  }).catch(function () { });
}

function renderDeviceCommandsTab() {
  var box = document.getElementById('icxDeviceTabBody');
  if (!modalDevice) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="icx-modal-section-title">历史命令（最近 100 条）</div><div id="icxDevCmdList"><div class="icx-empty icx-empty-compact">加载中...</div></div>';
  window.CSES.request('controlApi', { action: 'command_list', payload: { device_id: modalDevice.device_id } }).then(function (cmds) {
    var list = cmds || [];
    var target = document.getElementById('icxDevCmdList');
    if (!target) return;
    if (list.length === 0) {
      target.innerHTML = '<div class="icx-empty">暂无命令记录</div>';
      return;
    }
    var rows = list.map(function (c) {
      var p = c.payload || [];
      var ptext = '';
      try { ptext = JSON.stringify(p); } catch (e) { ptext = String(p); }
      if (ptext && ptext.length > 80) ptext = ptext.slice(0, 80) + '…';
      var st = c.result_status || c.status || '';
      var stClass = st === 'succeeded' ? 'icx-st-succeeded' : (st === 'failed' ? 'icx-st-failed' : (st ? 'icx-st-pending' : 'icx-st-muted'));
      return '<tr><td>' + escHtml(c.command_type || '') + '</td>' +
        '<td title="' + escAttr(ptext) + '">' + escHtml(ptext || '—') + '</td>' +
        '<td><span class="' + stClass + '">' + escHtml(st) + '</span></td>' +
        '<td>' + escHtml((c.created_at || '').slice(0, 19)) + '</td></tr>';
    }).join('');
    target.innerHTML = '<table class="icx-cmd-table"><thead><tr><th>类型</th><th>参数</th><th>状态</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }).catch(function (e) {
    var target = document.getElementById('icxDevCmdList');
    if (target) target.innerHTML = '<div class="icx-empty">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function saveDeviceNotes() {
  if (!modalDevice) return;
  var notes = document.getElementById('icxDevNotes').value;
  window.CSES.request('controlApi', { action: 'device_update_notes', payload: { device_id: modalDevice.device_id, notes: notes } })
    .then(function () {
      modalDevice.notes = notes;
      alert('备注已保存');
      refreshDevices();
    })
    .catch(function (e) { alert('更新备注失败: ' + e.message); });
}

function jumpToConfig() {
  var deviceId = modalDevice ? modalDevice.device_id : null;
  closeDeviceModal();
  switchPage('config');
  if (!deviceId) return;
  setTimeout(function () {
    var sel = document.getElementById('icxConfigDeviceSel');
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
  var title = document.getElementById('icxDevBroadcastTitle').value.trim();
  var body = document.getElementById('icxDevBroadcastBody').value.trim();
  var severity = document.getElementById('icxDevBroadcastSeverity').value;
  if (!title) { alert('请输入通知标题'); return; }
  window.CSES.request('controlApi', {
    action: 'command_create',
    payload: {
      command_type: 'broadcast.show',
      device_id: modalDevice.device_id,
      payload: {
        broadcast_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        title: title, body: body, severity: severity,
        expires_at: new Date(Date.now() + 3600000).toISOString()
      }
    }
  }).then(function () { alert('通知已下发'); })
    .catch(function (e) { alert('通知下发失败: ' + e.message); });
}

async function applyDeviceProtocol() {
  if (!modalDevice) return;
  var protocol = document.getElementById('icxDevProtoSel').value;
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

async function restartClient(deviceId) {
  if (!deviceId) return;
  if (!confirm('确认向该设备发送重启 ICC CE 指令？客户端收到命令后将立即重启。')) return;
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

async function unregisterDevice(deviceId, displayName) {
  if (!confirm('确认删除设备「' + (displayName || deviceId) + '」？此操作会解除绑定并清除其待执行命令。')) return;
  try {
    await window.CSES.request('controlApi', { action: 'device_unregister', payload: { device_id: deviceId } });
    refreshDevices();
  } catch (e) { alert('删除失败: ' + e.message); }
}

// ===== 远程控制（icc.command：icc:// 命令路径，客户端插件经 IPluginUriService.OpenUri 执行） =====
var cmdTargetDeviceId = null; // null = 所有设备

async function refreshCmdTargets() {
  var sel = document.getElementById('icxCmdTargetSel');
  if (!sel) return;
  var current = cmdTargetDeviceId;
  try {
    var devices = await window.CSES.request('controlApi', { action: 'device_list', payload: {} }) || [];
    var html = '<option value="">所有设备（广播）</option>';
    (devices || []).forEach(function (d) {
      html += '<option value="' + escAttr(d.device_id) + '">' + escHtml(d.display_name) + (deviceOnline(d) ? '' : '（离线）') + '</option>';
    });
    sel.innerHTML = html;
    if (current && Array.prototype.some.call(sel.options, function (o) { return o.value === current; })) {
      sel.value = current;
    } else {
      cmdTargetDeviceId = sel.value || null;
    }
    updateCmdTargetHint();
  } catch (e) { /* 忽略 */ }
}

function updateCmdTargetHint() {
  var sel = document.getElementById('icxCmdTargetSel');
  if (!sel) return;
  cmdTargetDeviceId = sel.value || null;
  var hint = document.getElementById('icxCmdTargetHint');
  if (hint) hint.textContent = cmdTargetDeviceId ? '仅发送到所选设备' : '广播到所有已接入设备';
}

function renderCommandGroups() {
  var container = document.getElementById('icxCmdGroups');
  if (!container || container.dataset.rendered) return;
  container.innerHTML = ICC_COMMANDS.map(function (g) {
    var btns = g.items.map(function (item) {
      var isDanger = ICC_DANGEROUS_COMMANDS[item.cmd];
      return '<button class="icx-cmd-btn' + (isDanger ? ' danger' : '') + '" onclick="sendIccCommand(\'' + escAttr(item.cmd) + '\')">' +
        '<span>' + escHtml(item.label) + '</span>' +
        '<span class="icx-cmd-path">' + escHtml(item.cmd) + '</span>' +
      '</button>';
    }).join('');
    return '<div class="icx-cmd-group"><div class="icx-cmd-group-title">' + escHtml(g.group) + '</div><div class="icx-cmd-grid">' + btns + '</div></div>';
  }).join('');
  container.dataset.rendered = '1';
}

/** 下发 icc.command 命令（deviceIds 为空 = 广播所有设备） */
async function dispatchIccCommand(cmdPath) {
  var cmdPayload = {
    command_type: 'icc.command',
    payload: { command: cmdPath, source: 'platform' }
  };
  if (cmdTargetDeviceId) cmdPayload.device_id = cmdTargetDeviceId;
  var res = await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
  return res;
}

async function sendIccCommand(cmdPath) {
  if (ICC_DANGEROUS_COMMANDS[cmdPath] && !confirm('确认向' + (cmdTargetDeviceId ? '所选设备' : '所有设备') + '发送命令「' + cmdPath + '」？')) return;
  try {
    var res = await dispatchIccCommand(cmdPath);
    alert('命令已下发' + (res && res.max_delay_seconds > 0 ? '（长轮询设备最长延迟 ' + res.max_delay_seconds + ' 秒收到）' : ''));
  } catch (e) { alert('命令下发失败: ' + e.message); }
}

async function sendCustomCommand() {
  var input = document.getElementById('icxCustomCmdInput');
  var cmd = (input.value || '').trim().replace(/^icc:\/\//i, '');
  if (!cmd) { alert('请输入命令路径'); return; }
  if (ICC_DANGEROUS_COMMANDS[cmd] && !confirm('确认向' + (cmdTargetDeviceId ? '所选设备' : '所有设备') + '发送命令「' + cmd + '」？')) return;
  try {
    var res = await dispatchIccCommand(cmd);
    alert('命令已下发' + (res && res.max_delay_seconds > 0 ? '（长轮询设备最长延迟 ' + res.max_delay_seconds + ' 秒收到）' : ''));
  } catch (e) { alert('命令下发失败: ' + e.message); }
}

async function switchConfigProfile() {
  var input = document.getElementById('icxProfileNameInput');
  var name = (input.value || '').trim();
  if (!name) { alert('请输入配置方案名'); return; }
  try {
    var res = await dispatchIccCommand('config-profile/switch?name=' + encodeURIComponent(name));
    alert('切换指令已下发' + (res && res.max_delay_seconds > 0 ? '（长轮询设备最长延迟 ' + res.max_delay_seconds + ' 秒收到）' : '') + '，客户端将热重载配置方案「' + name + '」');
  } catch (e) { alert('下发失败: ' + e.message); }
}

// ===== 广播（通知接口：broadcast.show / broadcast.dismiss） =====
var broadcastTargetIds = null;

function showBroadcastDialog(deviceIds, displayName) {
  broadcastTargetIds = deviceIds ? String(deviceIds).split(',').filter(Boolean) : null;
  document.getElementById('icxBroadcastTarget').textContent = displayName || (deviceIds ? deviceIds : '所有设备');
  document.getElementById('icxBroadcastTitle').value = '通知';
  document.getElementById('icxBroadcastBody').value = '';
  document.getElementById('icxBroadcastSeverity').value = 'info';
  document.getElementById('icxBroadcastModal').style.display = '';
}

function closeBroadcastDialog() {
  document.getElementById('icxBroadcastModal').style.display = 'none';
  broadcastTargetIds = null;
}

async function sendBroadcast() {
  var title = document.getElementById('icxBroadcastTitle').value.trim();
  var body = document.getElementById('icxBroadcastBody').value.trim();
  var severity = document.getElementById('icxBroadcastSeverity').value;
  if (!title) { alert('请输入通知标题'); return; }
  var targets = broadcastTargetIds;
  var payload = {
    broadcast_id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
    title: title,
    body: body,
    severity: severity,
    expires_at: new Date(Date.now() + 3600000).toISOString()
  };
  try {
    if (targets && targets.length > 1) {
      for (var i = 0; i < targets.length; i++) {
        await window.CSES.request('controlApi', {
          action: 'command_create',
          payload: { command_type: 'broadcast.show', device_id: targets[i], payload: payload }
        });
      }
      alert('通知已下发到 ' + targets.length + ' 台设备');
    } else {
      var cmdPayload = { command_type: 'broadcast.show', payload: payload };
      if (targets && targets.length === 1) cmdPayload.device_id = targets[0];
      await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
      alert('通知已下发');
    }
    closeBroadcastDialog();
  } catch (e) { alert('通知下发失败: ' + e.message); }
}

// ===== 注册码管理 =====
function showEnrollmentDialog() {
  document.getElementById('icxEnrollmentModal').style.display = '';
  document.getElementById('icxEnrollResult').style.display = 'none';
  document.getElementById('icxEnrollGenerateBtn').style.display = '';
  document.getElementById('icxEnrollName').value = '';
  document.getElementById('icxEnrollMaxUses').value = '1';
  document.getElementById('icxEnrollExpiry').value = '86400';
}

function closeEnrollmentDialog() {
  document.getElementById('icxEnrollmentModal').style.display = 'none';
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
        display_name: document.getElementById('icxEnrollName').value,
        max_uses: parseInt(document.getElementById('icxEnrollMaxUses').value) || 1,
        expires_in_seconds: parseInt(document.getElementById('icxEnrollExpiry').value) || 86400,
        prefix: 'ICCCE-'
      }
    });
    lastEnrollCode = res.code;
    lastEnrollInfo = {
      code: res.code,
      display_name: res.display_name || document.getElementById('icxEnrollName').value,
      instance_uid: (window.CSES.instance && window.CSES.instance.uid) || '',
      server_url: window.location.origin,
      expires_at: res.expires_at,
      created_at: new Date().toISOString()
    };
    document.getElementById('icxEnrollCode').textContent = res.code;
    document.getElementById('icxEnrollResult').style.display = '';
    document.getElementById('icxEnrollGenerateBtn').style.display = 'none';
    refreshEnrollments();
  } catch (e) { alert('生成失败: ' + e.message); }
  finally { generatingCode = false; }
}

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
    var container = document.getElementById('icxEnrollmentList');
    if (!codes.length) {
      container.innerHTML = '<div class="icx-empty">暂无有效注册码</div>';
      return;
    }
    container.innerHTML = codes.map(function (c) {
      var isRevoked = !!c.revoked_at;
      var isExpired = new Date(c.expires_at).getTime() < Date.now();
      var status = isRevoked ? '已吊销' : (isExpired ? '已过期' : '有效');
      var statusClass = isRevoked || isExpired ? 'icx-st-muted' : 'icx-st-succeeded';
      return '<div class="icx-enrollment-item">' +
        '<div class="icx-enrollment-code" style="flex:1">' + escHtml(c.display_name || '未命名') + '</div>' +
        '<div class="icx-enrollment-meta">' + c.used_count + '/' + c.max_uses + ' · <span class="' + statusClass + '">' + status + '</span></div>' +
        (!isRevoked
          ? '<button class="icx-btn small danger" onclick="revokeEnrollment(' + c.id + ')">吊销</button>'
          : '<button class="icx-btn small danger" onclick="deleteEnrollment(' + c.id + ')">删除</button>') +
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

// ===== 应用设置（左侧栏对齐 ICC CE 设置窗口：icc.* 键 + adapter.* 键，全局 + 设备分层，保存后经 settings.apply 同步） =====
var configDeviceId = '__global__';
var globalConfig = {};       // 全局配置（iccce-config.json）
var deviceConfigRaw = {};    // 当前设备的覆盖配置（device-<id>.json）

async function loadConfig() {
  try {
    globalConfig = await window.CSES.request('loadConfigFile', { file: 'iccce-config.json' });
    if (!globalConfig || typeof globalConfig !== 'object') globalConfig = {};
  } catch (e) { globalConfig = {}; }
  configCache = mergedConfig();
}

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
  var target = configDeviceId === '__global__' ? globalConfig : deviceConfigRaw;
  var obj = target;
  for (var i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  if (!autoSaveEnabled) {
    configDirty = true;
    updateConfigDirtyBadge();
    return;
  }
  await saveConfig();
}

async function saveConfig() {
  try {
    if (configDeviceId === '__global__') {
      await window.CSES.request('saveConfigFile', { file: 'iccce-config.json', content: globalConfig });
    } else {
      await window.CSES.request('saveConfigFile', { file: 'device-' + configDeviceId + '.json', content: deviceConfigRaw });
    }
    await dispatchSettings();
    configDirty = false;
    updateConfigDirtyBadge();
  } catch (e) { console.error('保存配置失败:', e); }
}

function updateConfigDirtyBadge() {
  var el = document.getElementById('icxCfgDirtyBadge');
  if (el) el.style.display = configDirty ? '' : 'none';
}

/**
 * 配置同步：把配置展开为扁平的 "a.b.c" 键值后经 settings.apply 下发。
 * icc.* 键由客户端插件合并进 Configs/Settings.json 并通过配置方案热重载立即生效；
 * adapter.* 键由客户端插件写入适配器自身设置。
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
  configCache = mergedConfig();
  var settings = [];
  flattenSettings(configCache, '', settings);
  var cmdPayload = { command_type: 'settings.apply', payload: { settings: settings, revision: Date.now().toString() } };
  if (configDeviceId !== '__global__') cmdPayload.device_id = configDeviceId;
  try {
    await window.CSES.request('controlApi', { action: 'command_create', payload: cmdPayload });
  } catch (e) { console.error('下发配置失败:', e); }
}

function switchConfigTab(tab) {
  document.querySelectorAll('.icx-config-nav-item').forEach(function (el) { el.classList.toggle('active', el.dataset.cfg === tab); });
  renderConfigTab(tab);
}

function toggleConfigNavGroup(headEl) {
  headEl.parentElement.classList.toggle('open');
}

function renderConfigPage() {
  refreshConfigDeviceSelector();
  switchConfigTab('startup');
}

function switchConfigDevice(deviceId) {
  configDeviceId = deviceId;
  loadDeviceConfig(deviceId).then(function () { renderConfigPage(); });
}

function refreshConfigDeviceSelector() {
  var sel = document.getElementById('icxConfigDeviceSel');
  if (!sel) return;
  var currentVal = sel.value;
  window.CSES.request('controlApi', { action: 'device_list', payload: {} }).then(function (devices) {
    var html = '<option value="__global__">全局配置（所有设备）</option>';
    (devices || []).forEach(function (d) {
      html += '<option value="' + d.device_id + '"' + (currentVal === d.device_id ? ' selected' : '') + '>' + escHtml(d.display_name) + '</option>';
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
    var count = document.getElementById('icxConfigDeviceCount');
    if (count) count.textContent = '包含全部 ' + (devices || []).length + ' 台设备';
  }).catch(function () { });
}

// ---- 设置行构建工具 ----
function cfgRow(title, desc, actionHtml) {
  return '<div class="icx-config-item"><div class="icx-config-item-main"><div class="icx-config-item-title">' + title + '</div><div class="icx-config-item-desc">' + desc + '</div></div><div class="icx-config-item-action">' + actionHtml + '</div></div>';
}

function cfgCard(title, rows) {
  return '<div class="icx-config-card">' + (title ? '<div class="icx-section-title">' + title + '</div>' : '') + rows.join('<div class="icx-config-divider"></div>') + '</div>';
}

function cfgExpander(title, desc, footerHtml, childRows) {
  return '<div class="icx-expander">' +
    '<div class="icx-expander-head" onclick="toggleCfgExpander(this)">' +
      '<span class="icx-expander-chevron">&#9662;</span>' +
      '<div class="icx-config-item-main" style="flex:1"><div class="icx-config-item-title">' + title + '</div><div class="icx-config-item-desc">' + desc + '</div></div>' +
      (footerHtml ? '<div class="icx-config-item-action" onclick="event.stopPropagation()">' + footerHtml + '</div>' : '') +
    '</div>' +
    '<div class="icx-expander-body">' + childRows.join('<div class="icx-config-divider"></div>') + '</div>' +
  '</div>';
}

function toggleCfgExpander(headEl) {
  headEl.parentElement.classList.toggle('open');
}

function cfgBoolSelect(key, def) {
  return cfgSelect(key, def, [[true, '开启'], [false, '关闭']], 'this.value === \'true\'');
}

function cfgSelect(key, def, options, conv) {
  var cur = getConfigField(key, def);
  var html = '<select onchange="saveConfigField(\'' + key + '\', ' + (conv || 'this.value') + ')">';
  options.forEach(function (o) {
    html += '<option value="' + escAttr(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + escHtml(o[1]) + '</option>';
  });
  return html + '</select>';
}

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

function cfgColor(key, def) {
  var cur = String(getConfigField(key, def) || def);
  if (cur.charAt(0) !== '#' || (cur.length !== 7 && cur.length !== 9)) cur = def;
  if (cur.length === 9) cur = '#' + cur.slice(3);
  return '<input type="color" value="' + escAttr(cur) + '" onchange="saveConfigField(\'' + key + '\', this.value)" />';
}

function renderConfigTab(tab) {
  var container = document.getElementById('icxConfigContent');
  var uid = (window.CSES.instance && window.CSES.instance.uid) || '';
  var serverUrl = window.location.origin;
  var isGlobal = configDeviceId === '__global__';
  var scopeTag = isGlobal ? '（全局）' : '（设备覆盖）';
  var html = '';
  switch (tab) {
    case 'startup':
      html = '<h2>启动 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('启动模式', [
          cfgRow('启动模式', 'Default 默认加载 / Faster 快速启动 / Fastest 极速启动。', cfgSelect('icc.startup.startupMode', 0, [[0, '默认'], [1, '更快'], [2, '最快']], 'parseInt(this.value)')),
          cfgRow('笔尖模式', '启用后按笔尖宽度处理墨迹边界，否则按手指模式。', cfgBoolSelect('icc.startup.isEnableNibMode', false)),
          cfgRow('启动时收纳', '启动时自动收纳浮动工具栏。', cfgBoolSelect('icc.startup.isFoldAtStartup', false)),
        ]) +
        cfgCard('更新', [
          cfgExpander('自动更新', '启动时自动检查并安装新版本。', cfgBoolSelect('icc.startup.isAutoUpdate', true), [
            cfgRow('静默更新', '在指定时间段内静默下载安装更新。', cfgBoolSelect('icc.startup.isAutoUpdateWithSilence', false)),
            cfgRow('静默更新开始时间', '格式 HH:mm。', cfgText('icc.startup.isAutoUpdateWithSilenceStartTime', '06:00', 90)),
            cfgRow('静默更新结束时间', '格式 HH:mm。', cfgText('icc.startup.isAutoUpdateWithSilenceEndTime', '22:00', 90)),
            cfgRow('更新通道', 'Release 正式版 / Preview 预览版 / Beta 测试版。', cfgSelect('icc.startup.updateChannel', 0, [[0, 'Release'], [1, 'Preview'], [2, 'Beta']], 'parseInt(this.value)')),
          ]),
        ]);
      break;
    case 'mode':
      html = '<h2>模式 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('运行模式', [
          cfgRow('仅 PPT 模式', '隐藏桌面批注等入口，仅在 PPT 放映时提供墨迹功能。', cfgBoolSelect('icc.modeSettings.isPPTOnlyMode', false)),
        ]);
      break;
    case 'appearance':
      html = '<h2>外观 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('主题', [
          cfgRow('应用主题', 'ICC CE 界面主题。', cfgSelect('icc.appearance.theme', 2, [[0, '明亮'], [1, '黑暗'], [2, '跟随系统']], 'parseInt(this.value)')),
          cfgRow('窗口背景材质', '窗口背景效果（Mica / Acrylic 等，None 为关闭）。', cfgSelect('icc.appearance.windowBackdrop', 'Mica', [['None', '无'], ['Mica', 'Mica'], ['Acrylic', 'Acrylic'], ['Tabbed', 'Tabbed'], ['Transient', 'Transient'], ['Acrylic10', 'Acrylic10'], ['Acrylic11', 'Acrylic11']])),
        ]) +
        cfgCard('工具栏', [
          cfgRow('工具栏位置', '浮动工具栏停靠的屏幕位置。', cfgSelect('icc.appearance.toolbarPosition', 0, [[0, '右侧'], [1, '左侧'], [2, '顶部'], [3, '底部']], 'parseInt(this.value)')),
          cfgRow('浮动栏不透明度', '浮动工具栏的不透明度（0-1）。', cfgNumber('icc.appearance.viewboxFloatingBarOpacityValue', 1, { min: 0.1, max: 1, step: 0.05, float: true })),
          cfgRow('彩色浮动栏图标', '浮动工具栏图标使用彩色渲染。', cfgBoolSelect('icc.appearance.isColorfulViewboxFloatingBar', false)),
          cfgRow('紧凑浮动栏', '浮动工具栏使用更紧凑的布局。', cfgBoolSelect('icc.appearance.compactFloatingBar', false)),
        ]) +
        cfgCard('快速面板与托盘', [
          cfgRow('显示快速面板', '显示侧边快速面板。', cfgBoolSelect('icc.appearance.isShowQuickPanel', true)),
          cfgRow('浮动快速面板', '快速面板以浮动窗口显示。', cfgBoolSelect('icc.appearance.useFloatingQuickPanel', true)),
          cfgRow('显示托盘图标', '在系统托盘显示 ICC CE 图标。', cfgBoolSelect('icc.appearance.enableTrayIcon', true)),
        ]) +
        cfgCard('白板显示', [
          cfgRow('白板时间显示', '白板模式下显示时间。', cfgBoolSelect('icc.appearance.enableTimeDisplayInWhiteboardMode', true)),
          cfgRow('白板一言', '白板模式下显示一言/名言。', cfgBoolSelect('icc.appearance.enableChickenSoupInWhiteboardMode', true)),
        ]) +
        cfgCard('启动画面', [
          cfgExpander('显示启动画面', '客户端启动时显示 Splash 启动画面。', cfgBoolSelect('icc.appearance.enableSplashScreen', false), [
            cfgRow('启动画面样式', '0 随机 / 1 跟随四季 / 2-5 四季 / 6 马年限定。', cfgSelect('icc.appearance.splashScreenStyle', 1, [[0, '随机'], [1, '跟随四季'], [2, '春季'], [3, '夏季'], [4, '秋季'], [5, '冬季'], [6, '马年限定']], 'parseInt(this.value)')),
          ]),
        ]);
      break;
    case 'canvas':
      html = '<h2>画笔与墨迹 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('笔与荧光笔', [
          cfgRow('笔宽度', '画笔默认宽度。', cfgNumber('icc.canvas.inkWidth', 2.5, { min: 0.5, max: 20, step: 0.5, float: true })),
          cfgRow('荧光笔宽度', '荧光笔默认宽度。', cfgNumber('icc.canvas.highlighterWidth', 20, { min: 5, max: 80, step: 1, float: true })),
          cfgRow('墨迹不透明度', '画笔墨迹不透明度（1-255）。', cfgNumber('icc.canvas.inkAlpha', 255, { min: 1, max: 255 })),
        ]) +
        cfgCard('光标', [
          cfgRow('书写时显示光标', '墨迹书写时显示笔尖光标。', cfgBoolSelect('icc.canvas.isShowCursor', false)),
          cfgRow('画笔光标类型', '0 系统光标 / 1 软件内置光标 / 2 用户自定义。', cfgSelect('icc.canvas.penCursorType', 1, [[0, '系统光标'], [1, '内置光标'], [2, '自定义光标']], 'parseInt(this.value)')),
        ]) +
        cfgCard('橡皮擦', [
          cfgRow('橡皮擦类型', '0 图标切换模式 / 1 面积擦 / 2 线条擦。', cfgSelect('icc.canvas.eraserType', 0, [[0, '图标切换'], [1, '面积擦'], [2, '线条擦']], 'parseInt(this.value)')),
          cfgRow('橡皮擦形状', '0 圆形擦 / 1 黑板擦。', cfgSelect('icc.canvas.eraserShapeType', 1, [[0, '圆形擦'], [1, '黑板擦']], 'parseInt(this.value)')),
          cfgExpander('橡皮自动切回', '使用橡皮后指定秒数自动切回画笔。', cfgBoolSelect('icc.canvas.enableEraserAutoSwitchBack', false), [
            cfgRow('切回延时（秒）', '使用橡皮后多少秒切回画笔。', cfgNumber('icc.canvas.eraserAutoSwitchBackDelaySeconds', 10, { min: 1, max: 120 })),
          ]),
          cfgRow('掌压擦除', '手掌按压屏幕时自动进入擦除。', cfgBoolSelect('icc.canvas.enablePalmEraser', true)),
        ]) +
        cfgCard('平滑与拉直', [
          cfgRow('高级贝塞尔平滑', '启用高级贝塞尔曲线墨迹平滑。', cfgBoolSelect('icc.canvas.useAdvancedBezierSmoothing', true)),
          cfgRow('直线自动拉直', '绘制接近直线的笔迹时自动拉直。', cfgBoolSelect('icc.canvas.autoStraightenLine', true)),
          cfgRow('拉直阈值（px）', '直线自动拉直的长度阈值。', cfgNumber('icc.canvas.autoStraightenLineThreshold', 80, { min: 10, max: 500 })),
        ]) +
        cfgCard('墨迹渐隐', [
          cfgExpander('启用墨迹渐隐', '书写后墨迹在指定时间自动消失（可用于临时讲解）。', cfgBoolSelect('icc.canvas.enableInkFade', false), [
            cfgRow('渐隐时间（ms）', '墨迹显示多久后开始渐隐。', cfgNumber('icc.canvas.inkFadeTime', 3000, { min: 500, max: 60000 })),
          ]),
        ]) +
        cfgCard('白板背景', [
          cfgRow('白板背景色', '白板模式的背景颜色。', cfgColor('icc.canvas.customBackgroundColor', '#162924')),
          cfgRow('清屏同时清空历史', '清空画布时同时清空撤销历史（不可恢复）。', cfgBoolSelect('icc.canvas.clearCanvasAndClearTimeMachine', false)),
        ]);
      break;
    case 'gesture':
      html = '<h2>手势 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('桌面模式', [
          cfgRow('多点触控模式', '以多点触控方式处理多指输入。', cfgBoolSelect('icc.gesture.isEnableMultiTouchMode', false)),
          cfgRow('双指缩放', '双指捏合缩放画布。', cfgBoolSelect('icc.gesture.isEnableTwoFingerZoom', true)),
          cfgRow('双指移动', '双指拖动平移画布。', cfgBoolSelect('icc.gesture.isEnableTwoFingerTranslate', true)),
          cfgRow('双指旋转', '双指旋转画布。', cfgBoolSelect('icc.gesture.isEnableTwoFingerRotation', false)),
        ]) +
        cfgCard('白板模式', [
          cfgRow('多点触控模式', '白板下的多点触控模式。', cfgBoolSelect('icc.gesture.isEnableMultiTouchModeBoard', false)),
          cfgRow('双指缩放', '白板下双指捏合缩放。', cfgBoolSelect('icc.gesture.isEnableTwoFingerZoomBoard', true)),
          cfgRow('双指移动', '白板下双指拖动平移。', cfgBoolSelect('icc.gesture.isEnableTwoFingerTranslateBoard', true)),
          cfgRow('双指旋转', '白板下双指旋转。', cfgBoolSelect('icc.gesture.isEnableTwoFingerRotationBoard', false)),
        ]);
      break;
    case 'behavior':
      html = '<h2>PPT 联动 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('PPT 支持', [
          cfgRow('PPT 联动', '与 PowerPoint 放映联动显示墨迹工具。', cfgBoolSelect('icc.behavior.powerPointSupport', true)),
          cfgRow('支持 WPS', '同时支持 WPS 演示联动。', cfgBoolSelect('icc.behavior.isSupportWPS', false)),
          cfgRow('联动模式', 'COM 组件 / ROT 轮询 / Agent 进程。', cfgSelect('icc.behavior.pptLinkMode', 0, [[0, 'COM'], [1, 'ROT'], [2, 'Agent']], 'parseInt(this.value)')),
          cfgRow('显示 PPT 按钮', 'PPT 放映时显示翻页按钮。', cfgBoolSelect('icc.behavior.showPPTButton', true)),
        ]) +
        cfgCard('放映行为', [
          cfgRow('新放映显示画布', '进入放映时自动显示画布。', cfgBoolSelect('icc.behavior.isShowCanvasAtNewSlideShow', false)),
          cfgRow('自动保存放映笔迹', '放映中的墨迹自动按页保存。', cfgBoolSelect('icc.behavior.isAutoSaveStrokesInPowerPoint', true)),
          cfgRow('手指手势翻页', '放映时支持手指滑动翻页。', cfgBoolSelect('icc.behavior.isEnableFingerGestureSlideShowControl', true)),
          cfgRow('自动结束希沃放影进程', '放映结束后自动结束后台进程。', cfgBoolSelect('icc.behavior.enableWppProcessKill', true)),
          cfgRow('智能模式', '启用 PPT 智能模式。', cfgBoolSelect('icc.behavior.enableSmartMode', false)),
        ]);
      break;
    case 'automation':
      html = '<h2>自动化 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('自动收纳与隐藏', [
          cfgRow('PPT 放映时收纳', '进入 PPT 放映自动收纳工具栏。', cfgBoolSelect('icc.automation.isAutoFoldInPPTSlideShow', false)),
          cfgRow('退出白板时收纳', '退出白板模式自动收纳工具栏。', cfgBoolSelect('icc.automation.isAutoFoldWhenExitWhiteboard', false)),
          cfgRow('收纳时彻底隐藏', '收纳后完全隐藏主窗口（隐蔽部署常用）。', cfgBoolSelect('icc.automation.thoroughlyHideWhenFolded', false)),
          cfgRow('退出收纳进入批注', '退出收纳模式后自动进入批注模式。', cfgBoolSelect('icc.automation.isAutoEnterAnnotationModeWhenExitFoldMode', false)),
        ]) +
        cfgCard('自动清理进程', [
          cfgRow('自动结束希沃白板', '检测到希沃白板时自动结束其进程。', cfgBoolSelect('icc.automation.isAutoKillEasiNote', false)),
          cfgRow('自动结束鸿合批注', '检测到鸿合批注时自动结束其进程。', cfgBoolSelect('icc.automation.isAutoKillHiteAnnotation', false)),
        ]) +
        cfgCard('笔迹保存与清屏', [
          cfgExpander('自动保存笔迹', '定期自动保存白板笔迹。', cfgBoolSelect('icc.automation.isEnableAutoSaveStrokes', true), [
            cfgRow('保存间隔（分钟）', '自动保存笔迹的时间间隔。', cfgNumber('icc.automation.autoSaveStrokesIntervalMinutes', 5, { min: 1, max: 60 })),
          ]),
          cfgRow('退出书写模式自动清屏', '退出书写模式时自动清空墨迹。', cfgBoolSelect('icc.automation.isAutoClearWhenExitingWritingMode', false)),
          cfgRow('最少笔数', '自动清屏所需的最少笔迹数。', cfgNumber('icc.automation.minimumAutomationStrokeNumber', 0, { min: 0, max: 99 })),
        ]);
      break;
    case 'rand':
      html = '<h2>点名与计时 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('点名', [
          cfgRow('显示随机/一次点名', '工具栏显示随机与一次点名入口。', cfgBoolSelect('icc.randSettings.showRandomAndSingleDraw', true)),
          cfgRow('新版点名界面', '使用新版随机点名窗口。', cfgBoolSelect('icc.randSettings.useNewRollCallUI', true)),
          cfgRow('一次点名人数上限', '一次点名窗口最多抽取的学生数。', cfgNumber('icc.randSettings.randWindowOnceMaxStudents', 10, { min: 1, max: 60 })),
          cfgExpander('重复规避', '点名时优先抽取未被点过的学生。', cfgBoolSelect('icc.randSettings.enableMLAvoidance', true), [
            cfgRow('历史记录数', '参与规避统计的历史抽取条数。', cfgNumber('icc.randSettings.mlAvoidanceHistoryCount', 50, { min: 5, max: 200 })),
          ]),
        ]) +
        cfgCard('快速抽取', [
          cfgRow('启用快抽', '启用快速随机抽取。', cfgBoolSelect('icc.randSettings.enableQuickDraw', true)),
        ]) +
        cfgCard('计时器', [
          cfgRow('计时器音量', '计时器提醒音量（0-1）。', cfgNumber('icc.randSettings.timerVolume', 1, { min: 0, max: 1, step: 0.05, float: true })),
          cfgRow('超时正计时', '计时结束后继续正计时。', cfgBoolSelect('icc.randSettings.enableOvertimeCountUp', false)),
          cfgRow('超时红色提醒', '超时后计时器显示为红色。', cfgBoolSelect('icc.randSettings.enableOvertimeRedText', false)),
        ]);
      break;
    case 'notification':
      html = '<h2>通知 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('通知服务', [
          cfgRow('动态通知', '启用应用内动态通知。', cfgBoolSelect('icc.notification.isDynamicNotificationEnabled', true)),
          cfgRow('Windows 系统通知', '允许发送 Windows 通知中心 toast。', cfgBoolSelect('icc.notification.isWindowsToastEnabled', true)),
          cfgRow('强制弹出', '通知在其他应用前台时也强制弹出。', cfgBoolSelect('icc.notification.isForcePopupEnabled', true)),
          cfgRow('官方公告', '接收 ICC CE 官方公告。', cfgBoolSelect('icc.notification.isAnnouncementEnabled', true)),
        ]);
      break;
    case 'advanced':
      html = '<h2>高级 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('窗口', [
          cfgRow('窗口置顶', '主窗口始终置顶。', cfgBoolSelect('icc.advanced.isAlwaysOnTop', true)),
          cfgRow('无焦点模式', '主窗口不抢夺前台焦点。', cfgBoolSelect('icc.advanced.isNoFocusMode', true)),
          cfgRow('多屏支持', '启用多显示器支持。', cfgBoolSelect('icc.advanced.enableMultiScreenSupport', true)),
          cfgRow('全屏检测', '启用全屏窗口检测辅助。', cfgBoolSelect('icc.advanced.isEnableFullScreenHelper', false)),
          cfgRow('避让全屏辅助', '全屏应用自动避让（Win11）。', cfgBoolSelect('icc.advanced.isEnableAvoidFullScreenHelper', true)),
        ]) +
        cfgCard('远程控制通道', [
          cfgRow('启用 icc:// 命令协议', '开启后 ICC CE 接受 icc:// URI 命令（远程控制依赖；也可在适配器页设置自动开启）。', cfgBoolSelect('icc.advanced.isEnableUriScheme', false)),
        ]) +
        cfgCard('备份与日志', [
          cfgExpander('自动备份', '定期自动备份设置数据。', cfgBoolSelect('icc.advanced.isAutoBackupEnabled', true), [
            cfgRow('备份间隔（天）', '自动备份的间隔天数。', cfgNumber('icc.advanced.autoBackupIntervalDays', 7, { min: 1, max: 365 })),
          ]),
          cfgRow('启用日志', '记录运行日志。', cfgBoolSelect('icc.advanced.isLogEnabled', true)),
          cfgRow('关闭应用二次确认', '退出应用时弹出二次确认。', cfgBoolSelect('icc.advanced.isSecondConfirmWhenShutdownApp', false)),
        ]);
      break;
    case 'inkToShape':
      html = '<h2>墨迹识别 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('墨迹转形状', [
          cfgRow('墨迹转形状', '自动把接近几何图形的笔迹转为形状。', cfgBoolSelect('icc.inkToShape.isInkToShapeEnabled', true)),
          cfgRow('三角形', '识别三角形。', cfgBoolSelect('icc.inkToShape.isInkToShapeTriangle', true)),
          cfgRow('矩形', '识别矩形。', cfgBoolSelect('icc.inkToShape.isInkToShapeRectangle', true)),
          cfgRow('圆角矩形', '识别圆角矩形。', cfgBoolSelect('icc.inkToShape.isInkToShapeRounded', true)),
        ]);
      break;
    case 'miniWhiteboard':
      html = '<h2>小白板 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        cfgCard('小白板', [
          cfgRow('启用小白板', '启用屏幕角落的小白板。', cfgBoolSelect('icc.miniWhiteboard.isEnabled', true)),
          cfgRow('默认宽度', '小白板默认宽度（px）。', cfgNumber('icc.miniWhiteboard.defaultWidth', 400, { min: 200, max: 1200 })),
          cfgRow('默认高度', '小白板默认高度（px）。', cfgNumber('icc.miniWhiteboard.defaultHeight', 300, { min: 150, max: 900 })),
          cfgRow('默认不透明度', '小白板背景不透明度（0-1）。', cfgNumber('icc.miniWhiteboard.defaultOpacity', 0.95, { min: 0.3, max: 1, step: 0.05, float: true })),
          cfgRow('笔宽', '小白板默认笔宽。', cfgNumber('icc.miniWhiteboard.penWidth', 3, { min: 1, max: 20, step: 0.5, float: true })),
          cfgRow('跟随 PPT 翻页', 'PPT 翻页时自动清空小白板。', cfgBoolSelect('icc.miniWhiteboard.syncWithPPTPages', true)),
        ]);
      break;
    case 'adapter':
      html = '<h2>CSES Cloud 适配器 <span style="font-size:12px;color:var(--text-tertiary)">' + scopeTag + '</span></h2>' +
        '<div class="icx-tip-box" style="margin-bottom:var(--spacer-3)">本页对应 ICC CE 客户端「CSES Cloud 适配器」插件的设置，保存后经 settings.apply 即时下发。</div>' +
        cfgCard('同步', [
          cfgRow('自动同步', '客户端后台定期向平台拉取命令与设置更新。', cfgBoolSelect('adapter.autoSync', true)),
          cfgRow('同步间隔（秒）', '客户端向平台拉取命令的最小间隔，实际以服务器限制为准。', cfgNumber('adapter.pollInterval', 30, { min: 5, max: 86400 })),
          cfgRow('连接传输', '长轮询为 REST 轮询；WebSocket 为实时推送（断线自动回退长轮询）。', cfgSelect('adapter.transport', 'poll', [['poll', '长轮询'], ['ws', 'WebSocket']])),
        ]) +
        cfgCard('远程控制', [
          cfgRow('自动开启 icc:// 协议', '应用设置/远程命令前自动打开 ICC CE 的「启用 URI 协议」开关（远程控制依赖此项）。', cfgBoolSelect('adapter.ensureUriScheme', true)),
        ]) +
        cfgCard('通知提醒', [
          cfgRow('平台通知提醒', '客户端收到平台通知命令时弹出提醒。', cfgBoolSelect('adapter.showNotifications', true)),
        ]) +
        cfgCard('接入信息', [
          cfgRow('服务器地址', '客户端适配器设置中填写的服务器地址。', '<code class="icx-code-chip">' + escHtml(serverUrl) + '</code>'),
          cfgRow('实例 UID', '与注册码二选一填写；填写后客户端无需通过注册码解析实例。', '<code class="icx-code-chip">' + escHtml(uid) + '</code>'),
          cfgRow('WebSocket 网关', '客户端 WebSocket 实时通信网关地址。', '<code class="icx-code-chip">' + escHtml(serverUrl + '/api/ws-control') + '</code>'),
          cfgRow('REST 轮询频率限制（秒）', '长轮询设备的命令轮询间隔，客户端按此限制自适应调整。', '<input type="number" id="icxPollInterval" value="30" min="5" max="86400" style="width:110px" /><button class="icx-btn small" onclick="savePollInterval()">保存</button>'),
        ]);
      loadServerProtocolConfig();
      break;
    default:
      switchConfigTab('startup');
      return;
  }
  container.innerHTML = '<div class="icx-config-tab">' + html +
    '<div id="icxCfgDirtyBadge" style="display:none;margin-top:var(--spacer-3);padding:var(--spacer-2) var(--spacer-3);border-radius:var(--radius-md);background:rgba(202,143,4,0.08);border:1px solid rgba(202,143,4,0.2);font-size:var(--font-size-xs);color:var(--status-warning)">有未保存的更改——平台「自动保存」已关闭，点击 Ribbon「保存」后才会写入并下发到设备。</div></div>';
  updateConfigDirtyBadge();
}

function loadServerProtocolConfig() {
  var input = document.getElementById('icxPollInterval');
  if (!input) return;
  window.CSES.request('controlApi', { action: 'instance_protocol_get', payload: {} }).then(function (res) {
    if (res && res.poll_interval_seconds) input.value = res.poll_interval_seconds;
  }).catch(function () { });
}

async function savePollInterval() {
  var input = document.getElementById('icxPollInterval');
  if (!input) return;
  var secs = parseInt(input.value, 10) || 0;
  try {
    var res = await window.CSES.request('controlApi', { action: 'instance_protocol_set', payload: { poll_interval_seconds: secs } });
    alert('已保存，REST 轮询间隔: ' + res.poll_interval_seconds + ' 秒');
    input.value = res.poll_interval_seconds;
  } catch (e) { alert('保存失败: ' + e.message); }
}
