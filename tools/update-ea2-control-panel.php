<?php
/**
 * 更新 EA2 应用编辑器 - 控制面板 UI
 * 包含三个页面：连接应用、考试管理、应用配置
 * 通过 window.CSES.request('controlApi', ...) 与 PHP 后端通信
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$app = DB::one("SELECT id FROM apps WHERE app_key = 'examaware2'");
if (!$app) { echo "未找到 EA2 应用\n"; exit(1); }

$editorHtml = <<<'HTML'
<div class="ea2-app">
  <!-- ===== 连接应用页面 ===== -->
  <div class="ea2-page" id="ea2PageConnect">
    <div class="ea2-page-header">
      <h2>设备连接</h2>
      <div class="ea2-page-actions">
        <button class="ea2-btn primary" onclick="showEnrollmentDialog()">+ 生成注册码</button>
        <button class="ea2-btn" onclick="refreshDevices()">刷新</button>
      </div>
    </div>
    <div class="ea2-page-body">
      <div class="ea2-device-stats" id="ea2DeviceStats">
        <div class="ea2-stat-card"><span class="ea2-stat-value" id="ea2StatTotal">0</span><span class="ea2-stat-label">总设备</span></div>
        <div class="ea2-stat-card active"><span class="ea2-stat-value" id="ea2StatOnline">0</span><span class="ea2-stat-label">在线</span></div>
        <div class="ea2-stat-card"><span class="ea2-stat-value" id="ea2StatPending">0</span><span class="ea2-stat-label">待执行命令</span></div>
      </div>
      <div class="ea2-section">
        <div class="ea2-section-title">设备列表</div>
        <div class="ea2-device-list" id="ea2DeviceList">
          <div class="ea2-empty">暂无设备连接，请生成注册码并让设备注册</div>
        </div>
      </div>
      <div class="ea2-section">
        <div class="ea2-section-title">注册码</div>
        <div class="ea2-enrollment-list" id="ea2EnrollmentList">
          <div class="ea2-empty">暂无有效注册码</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== 考试管理页面 ===== -->
  <div class="ea2-page" id="ea2PageExams" style="display:none">
    <div class="ea2-page-header">
      <h2>考试管理</h2>
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
  </div>

  <!-- ===== 应用配置页面 ===== -->
  <div class="ea2-page" id="ea2PageConfig" style="display:none">
    <div class="ea2-config-shell">
      <div class="ea2-config-sidebar">
        <div class="ea2-config-nav">
          <button class="ea2-config-nav-item active" data-cfg="basic" onclick="switchConfigTab('basic')">基本</button>
          <button class="ea2-config-nav-item" data-cfg="appearance" onclick="switchConfigTab('appearance')">外观</button>
          <button class="ea2-config-nav-item" data-cfg="player" onclick="switchConfigTab('player')">播放器</button>
          <button class="ea2-config-nav-item" data-cfg="reminder" onclick="switchConfigTab('reminder')">提醒铃声</button>
          <button class="ea2-config-nav-item" data-cfg="connect" onclick="switchConfigTab('connect')">连接</button>
          <button class="ea2-config-nav-item" data-cfg="time" onclick="switchConfigTab('time')">时间同步</button>
        </div>
      </div>
      <div class="ea2-config-content" id="ea2ConfigContent">
        <!-- 动态渲染 -->
      </div>
    </div>
  </div>

  <!-- ===== 注册码弹窗 ===== -->
  <div class="ea2-modal-overlay" id="ea2EnrollmentModal" style="display:none" onclick="if(event.target===this)closeEnrollmentDialog()">
    <div class="ea2-modal">
      <div class="ea2-modal-header">
        <h3>生成注册码</h3>
        <button class="ea2-modal-close" onclick="closeEnrollmentDialog()">&times;</button>
      </div>
      <div class="ea2-modal-body">
        <div class="ea2-field">
          <label>设备名称（可选）</label>
          <input type="text" id="ea2EnrollName" placeholder="例如：考场01" />
        </div>
        <div class="ea2-field">
          <label>最大使用次数</label>
          <input type="number" id="ea2EnrollMaxUses" value="1" min="1" max="100" />
        </div>
        <div class="ea2-field">
          <label>有效期</label>
          <select id="ea2EnrollExpiry">
            <option value="3600">1 小时</option>
            <option value="86400" selected>24 小时</option>
            <option value="604800">7 天</option>
            <option value="2592000">30 天</option>
          </select>
        </div>
        <div class="ea2-enroll-result" id="ea2EnrollResult" style="display:none">
          <div class="ea2-enroll-code-label">注册码（仅显示一次，请妥善保存）：</div>
          <div class="ea2-enroll-code" id="ea2EnrollCode"></div>
          <button class="ea2-btn small" onclick="copyEnrollCode()">复制</button>
        </div>
      </div>
      <div class="ea2-modal-footer">
        <button class="ea2-btn" onclick="closeEnrollmentDialog()">取消</button>
        <button class="ea2-btn primary" id="ea2EnrollGenerateBtn" onclick="generateEnrollmentCode()">生成</button>
      </div>
    </div>
  </div>

  <!-- ===== 考试详情弹窗 ===== -->
  <div class="ea2-modal-overlay" id="ea2ExamDetailModal" style="display:none" onclick="if(event.target===this)closeExamDetail()">
    <div class="ea2-modal ea2-modal-lg">
      <div class="ea2-modal-header">
        <h3 id="ea2ExamDetailTitle">考试详情</h3>
        <button class="ea2-modal-close" onclick="closeExamDetail()">&times;</button>
      </div>
      <div class="ea2-modal-body" id="ea2ExamDetailBody">
        <!-- 动态渲染 -->
      </div>
      <div class="ea2-modal-footer">
        <button class="ea2-btn" onclick="closeExamDetail()">关闭</button>
        <button class="ea2-btn primary" id="ea2ExamDeployBtn" onclick="deployExamConfig()">部署到设备</button>
      </div>
    </div>
  </div>

  <!-- ===== 部署确认弹窗 ===== -->
  <div class="ea2-modal-overlay" id="ea2DeployModal" style="display:none" onclick="if(event.target===this)closeDeployDialog()">
    <div class="ea2-modal">
      <div class="ea2-modal-header">
        <h3>部署考试配置</h3>
        <button class="ea2-modal-close" onclick="closeDeployDialog()">&times;</button>
      </div>
      <div class="ea2-modal-body">
        <p>将考试配置下发到所有活跃设备？</p>
        <div class="ea2-device-checkboxes" id="ea2DeployDevices"></div>
      </div>
      <div class="ea2-modal-footer">
        <button class="ea2-btn" onclick="closeDeployDialog()">取消</button>
        <button class="ea2-btn primary" onclick="confirmDeploy()">确认部署</button>
      </div>
    </div>
  </div>
</div>
HTML;

$editorCss = <<<'CSS'
/* ===== EA2 控制面板 ===== */
.ea2-app {
  display: flex; flex-direction: column; height: 100%;
  background: var(--app-bg, #1e1e1e); color: var(--text-primary, #d4d4d4);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 13px; overflow: hidden;
}
.ea2-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.ea2-page-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px; background: var(--card-bg, #252526);
  border-bottom: 1px solid var(--border-color, #3c3c3c); flex-shrink: 0;
}
.ea2-page-header h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary, #e0e0e0); }
.ea2-page-actions { display: flex; gap: 8px; }
.ea2-page-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.ea2-empty { text-align: center; padding: 40px; color: var(--text-secondary, #888); font-size: 13px; }

/* 按钮 */
.ea2-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; background: var(--btn-bg, #3c3c3c); color: var(--text-primary, #ccc);
  border: 1px solid var(--border-color, #555); border-radius: 4px;
  font-size: 12px; cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.ea2-btn:hover { background: var(--btn-hover-bg, #4c4c4c); }
.ea2-btn.primary { background: #0067C0; color: white; border-color: #0067C0; }
.ea2-btn.primary:hover { background: #005aaf; }
.ea2-btn.small { padding: 3px 10px; font-size: 11px; }
.ea2-btn.danger { color: #f48771; border-color: #5a2a2a; }
.ea2-btn.danger:hover { background: #5a2a2a; }
.ea2-btn.success { background: #107c10; color: white; border-color: #107c10; }

/* 统计卡片 */
.ea2-device-stats { display: flex; gap: 12px; margin-bottom: 16px; }
.ea2-stat-card {
  flex: 1; padding: 14px; background: var(--card-bg, #252526);
  border: 1px solid var(--border-color, #3c3c3c); border-radius: 6px; text-align: center;
}
.ea2-stat-card.active { border-color: #0067C0; }
.ea2-stat-value { display: block; font-size: 24px; font-weight: 700; color: var(--text-primary, #e0e0e0); }
.ea2-stat-label { display: block; font-size: 11px; color: var(--text-secondary, #888); margin-top: 4px; }

/* 区域 */
.ea2-section { background: var(--card-bg, #252526); border: 1px solid var(--border-color, #3c3c3c); border-radius: 6px; margin-bottom: 12px; overflow: hidden; }
.ea2-section-title {
  padding: 10px 16px; font-size: 12px; font-weight: 600; color: var(--text-primary, #e0e0e0);
  background: var(--section-header-bg, #2d2d2d); border-bottom: 1px solid var(--border-color, #3c3c3c);
}

/* 设备列表 */
.ea2-device-list { padding: 0; }
.ea2-device-item {
  display: flex; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border-color, #333);
  gap: 12px;
}
.ea2-device-item:last-child { border-bottom: none; }
.ea2-device-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ea2-device-status.online { background: #4caf50; }
.ea2-device-status.offline { background: #888; }
.ea2-device-info { flex: 1; min-width: 0; }
.ea2-device-name { font-size: 13px; font-weight: 500; }
.ea2-device-meta { font-size: 11px; color: var(--text-secondary, #888); margin-top: 2px; }
.ea2-device-actions { display: flex; gap: 6px; }

/* 注册码列表 */
.ea2-enrollment-list { padding: 0; }
.ea2-enrollment-item {
  display: flex; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border-color, #333);
  gap: 12px;
}
.ea2-enrollment-item:last-child { border-bottom: none; }
.ea2-enrollment-code { font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; color: #0067C0; flex: 1; word-break: break-all; }
.ea2-enrollment-meta { font-size: 11px; color: var(--text-secondary, #888); white-space: nowrap; }

/* 考试网格 */
.ea2-exam-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.ea2-exam-card {
  background: var(--card-bg, #252526); border: 1px solid var(--border-color, #3c3c3c);
  border-radius: 6px; padding: 16px; cursor: pointer; transition: border-color 0.15s;
}
.ea2-exam-card:hover { border-color: #0067C0; }
.ea2-exam-card-name { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.ea2-exam-card-meta { font-size: 11px; color: var(--text-secondary, #888); display: flex; gap: 12px; }
.ea2-exam-card-actions { display: flex; gap: 6px; margin-top: 10px; }

/* 配置 */
.ea2-config-shell { display: flex; height: 100%; overflow: hidden; }
.ea2-config-sidebar { width: 160px; background: var(--card-bg, #252526); border-right: 1px solid var(--border-color, #3c3c3c); flex-shrink: 0; overflow-y: auto; }
.ea2-config-nav { padding: 4px 0; }
.ea2-config-nav-item {
  display: block; width: 100%; padding: 10px 16px; text-align: left; background: none; border: none;
  color: var(--text-primary, #ccc); font-size: 13px; cursor: pointer; font-family: inherit;
  transition: background 0.15s; border-left: 3px solid transparent;
}
.ea2-config-nav-item:hover { background: var(--btn-hover-bg, #333); }
.ea2-config-nav-item.active { background: var(--btn-hover-bg, #333); border-left-color: #0067C0; color: #fff; }
.ea2-config-content { flex: 1; overflow-y: auto; padding: 20px; }
.ea2-config-tab { display: none; }
.ea2-config-tab.active { display: block; }
.ea2-config-tab h2 { margin: 0 0 16px; font-size: 16px; font-weight: 600; }
.ea2-config-card { background: var(--card-bg, #252526); border: 1px solid var(--border-color, #3c3c3c); border-radius: 6px; overflow: hidden; }
.ea2-config-item {
  display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; gap: 16px;
}
.ea2-config-item-main { flex: 1; }
.ea2-config-item-title { font-size: 13px; font-weight: 500; }
.ea2-config-item-desc { font-size: 11px; color: var(--text-secondary, #888); margin-top: 2px; }
.ea2-config-item-action { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ea2-config-item-action input[type="text"],
.ea2-config-item-action input[type="number"],
.ea2-config-item-action input[type="date"],
.ea2-config-item-action select {
  padding: 6px 10px; background: var(--input-bg, #1e1e1e); color: var(--text-primary, #d4d4d4);
  border: 1px solid var(--border-color, #3c3c3c); border-radius: 4px; font-size: 12px; font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.ea2-config-item-action input:focus, .ea2-config-item-action select:focus { border-color: #0067C0; }
.ea2-config-item-suffix { font-size: 12px; color: var(--text-secondary, #888); }
.ea2-config-divider { height: 1px; background: var(--border-color, #3c3c3c); margin: 0; }

/* 弹窗 */
.ea2-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center;
  justify-content: center; z-index: 1000;
}
.ea2-modal { background: var(--card-bg, #252526); border: 1px solid var(--border-color, #3c3c3c); border-radius: 8px; width: 440px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
.ea2-modal-lg { width: 640px; }
.ea2-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border-color, #3c3c3c); }
.ea2-modal-header h3 { margin: 0; font-size: 14px; }
.ea2-modal-close { background: none; border: none; color: var(--text-secondary, #888); font-size: 18px; cursor: pointer; }
.ea2-modal-body { padding: 18px; overflow-y: auto; flex: 1; }
.ea2-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px; border-top: 1px solid var(--border-color, #3c3c3c); }
.ea2-field { margin-bottom: 12px; }
.ea2-field label { display: block; font-size: 11px; color: var(--text-secondary, #999); margin-bottom: 4px; }
.ea2-field input, .ea2-field select {
  width: 100%; padding: 7px 10px; background: var(--input-bg, #1e1e1e); color: var(--text-primary, #d4d4d4);
  border: 1px solid var(--border-color, #3c3c3c); border-radius: 4px; font-size: 12px; font-family: inherit;
  outline: none; box-sizing: border-box;
}
.ea2-field input:focus, .ea2-field select:focus { border-color: #0067C0; }
.ea2-enroll-result { margin-top: 12px; padding: 12px; background: var(--input-bg, #1e1e1e); border-radius: 6px; text-align: center; }
.ea2-enroll-code-label { font-size: 11px; color: var(--text-secondary, #888); margin-bottom: 6px; }
.ea2-enroll-code { font-family: 'Consolas', monospace; font-size: 14px; font-weight: 600; color: #0067C0; padding: 8px; background: var(--card-bg, #252526); border-radius: 4px; word-break: break-all; margin-bottom: 8px; }

/* 考试详情 */
.ea2-exam-detail-section { margin-bottom: 16px; }
.ea2-exam-detail-section h4 { font-size: 12px; font-weight: 600; color: var(--text-secondary, #888); margin: 0 0 8px; text-transform: uppercase; }
.ea2-exam-info-table { width: 100%; border-collapse: collapse; }
.ea2-exam-info-table th, .ea2-exam-info-table td {
  padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border-color, #333); font-size: 12px;
}
.ea2-exam-info-table th { color: var(--text-secondary, #888); font-weight: 500; width: 100px; }

/* 设备选择勾选框 */
.ea2-device-checkboxes { max-height: 200px; overflow-y: auto; margin-top: 8px; }
.ea2-device-checkbox { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 12px; }
.ea2-device-checkbox input { accent-color: #0067C0; }

/* 滚动条 */
.ea2-page-body::-webkit-scrollbar, .ea2-config-content::-webkit-scrollbar { width: 6px; }
.ea2-page-body::-webkit-scrollbar-track, .ea2-config-content::-webkit-scrollbar-track { background: transparent; }
.ea2-page-body::-webkit-scrollbar-thumb, .ea2-config-content::-webkit-scrollbar-thumb { background: #424242; border-radius: 3px; }

/* 深色模式适配 */
@media (prefers-color-scheme: light) {
  .ea2-app { background: #f5f5f5; color: #1a1a1a; }
  .ea2-page-header { background: #fff; border-bottom-color: #e0e0e0; }
  .ea2-page-header h2 { color: #1a1a1a; }
  .ea2-stat-card { background: #fff; border-color: #e0e0e0; }
  .ea2-stat-value { color: #1a1a1a; }
  .ea2-section { background: #fff; border-color: #e0e0e0; }
  .ea2-section-title { background: #fafafa; border-bottom-color: #e0e0e0; color: #1a1a1a; }
  .ea2-btn { background: #f0f0f0; color: #333; border-color: #d0d0d0; }
  .ea2-btn:hover { background: #e0e0e0; }
  .ea2-config-sidebar { background: #fff; border-right-color: #e0e0e0; }
  .ea2-config-nav-item { color: #333; }
  .ea2-config-nav-item:hover { background: #f0f0f0; }
  .ea2-config-nav-item.active { background: #f0f0f0; color: #1a1a1a; }
  .ea2-config-card { background: #fff; border-color: #e0e0e0; }
  .ea2-field input, .ea2-field select, .ea2-config-item-action input, .ea2-config-item-action select { background: #fff; color: #1a1a1a; border-color: #d0d0d0; }
  .ea2-modal { background: #fff; border-color: #e0e0e0; }
  .ea2-exam-card { background: #fff; border-color: #e0e0e0; }
  .ea2-exam-info-table th, .ea2-exam-info-table td { border-bottom-color: #e0e0e0; }
}
CSS;

$editorJs = <<<'JS'
// EA2 控制面板
// 通过 window.CSES.request('controlApi', ...) 与 PHP 后端通信

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
      case 'group_mgmt': alert('分组管理功能开发中'); break;
      case 'save': saveConfig(); break;
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
    return '<div class="ea2-device-item">' +
      '<span class="ea2-device-status ' + statusClass + '"></span>' +
      '<div class="ea2-device-info">' +
        '<div class="ea2-device-name">' + escHtml(d.display_name) + '</div>' +
        '<div class="ea2-device-meta">' + (d.platform || '未知平台') + ' · ' + (d.app_version || '') + ' · ' + statusText + '</div>' +
      '</div>' +
      '<div class="ea2-device-actions">' +
        '<button class="ea2-btn small" onclick="sendCommandTo(\'' + d.device_id + '\')">发送命令</button>' +
        '<button class="ea2-btn small danger" onclick="unregisterDevice(\'' + d.device_id + '\')">注销</button>' +
      '</div>' +
    '</div>';
  }).join('');
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

async function generateEnrollmentCode() {
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
      var statusColor = isRevoked || isExpired ? '#888' : '#4caf50';
      return '<div class="ea2-enrollment-item">' +
        '<div class="ea2-enrollment-code" style="flex:1">' + (c.display_name || '未命名') + '</div>' +
        '<div class="ea2-enrollment-meta">' + c.used_count + '/' + c.max_uses + ' · ' + status + '</div>' +
        (!isRevoked ? '<button class="ea2-btn small danger" onclick="revokeEnrollment(' + c.id + ')">吊销</button>' : '') +
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

// ===== 考试管理 =====
async function refreshExamList() {
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
      container.innerHTML = '<p style="color:#888">暂无可用设备，请先在"连接应用"页面注册设备</p>';
    } else {
      container.innerHTML = devices.map(function(d) {
        return '<div class="ea2-device-checkbox"><input type="checkbox" value="' + d.device_id + '" checked id="dev_' + d.device_id + '"><label for="dev_' + d.device_id + '">' + escHtml(d.display_name) + ' (' + (d.platform || '?') + ')</label></div>';
      }).join('');
    }
    document.getElementById('ea2DeployModal').style.display = '';
  }).catch(function(e) { alert('获取设备列表失败: ' + e.message); });
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
  }).then(function() {
    alert('命令已下发');
    refreshDevices();
  }).catch(function(e) { alert('命令下发失败: ' + e.message); });
}

// ===== 配置管理 =====
async function loadConfig() {
  try {
    configCache = await window.CSES.request('loadConfig');
    if (!configCache || typeof configCache !== 'object') configCache = {};
  } catch (e) { configCache = {}; }
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
  try {
    await window.CSES.request('saveConfig', configCache);
  } catch (e) { console.error('保存配置失败:', e); }
}

async function saveConfig() {
  try {
    await window.CSES.request('saveConfig', configCache);
  } catch (e) { console.error('保存配置失败:', e); }
}

function switchConfigTab(tab) {
  document.querySelectorAll('.ea2-config-nav-item').forEach(function(el) { el.classList.toggle('active', el.dataset.cfg === tab); });
  renderConfigTab(tab);
}

function renderConfigPage() {
  switchConfigTab('basic');
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
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">服务器地址</div><div class="ea2-config-item-desc">客户端连接控制服务器的地址，由系统自动生成。</div></div><div class="ea2-config-item-action"><code style="font-size:10px;padding:4px 8px;background:var(--input-bg,#1e1e1e);border-radius:4px">' + escHtml(window.location.origin + '/api/ea2-control.php?instance_uid=' + (window.CSES.instance ? window.CSES.instance.uid : '')) + '</code></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">监听端口</div><div class="ea2-config-item-desc">控制服务器监听端口，端口占用时会自动上移尝试。</div></div><div class="ea2-config-item-action"><input type="number" value="' + escAttr(getConfigField('server.port', 8000)) + '" min="1" max="65535" placeholder="8000" onchange="saveConfigField(\'server.port\', parseInt(this.value)||8000)" style="width:90px" /></div></div>' +
        '<div class="ea2-config-divider"></div>' +
        '<div class="ea2-config-item"><div class="ea2-config-item-main"><div class="ea2-config-item-title">访问令牌</div><div class="ea2-config-item-desc">留空则不校验；推荐在远程访问时设置。</div></div><div class="ea2-config-item-action"><input type="text" value="' + escAttr(getConfigField('server.token', '')) + '" placeholder="（留空不校验）" onchange="saveConfigField(\'server.token\', this.value)" /></div></div>' +
      '</div>';
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
function toggleMultiSelect() {
  multiSelectMode = !multiSelectMode;
  alert('多选编辑模式: ' + (multiSelectMode ? '开启' : '关闭'));
}

// ===== 工具函数 =====
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
JS;

// 将 CSS 内嵌到 HTML 中（apps 表没有 editor_css 列）
$combinedHtml = '<style>' . $editorCss . '</style>' . $editorHtml;

// 更新数据库
DB::update('apps', [
    'editor_html' => $combinedHtml,
    'editor_js' => $editorJs,
    'updated_at' => date('Y-m-d H:i:s'),
], 'id = ?', [$app['id']]);

echo "EA2 应用编辑器已更新：\n";
echo "  - editor_html: " . number_format(strlen($combinedHtml)) . " 字节（含 CSS）\n";
echo "  - editor_js: " . number_format(strlen($editorJs)) . " 字节\n";
echo "  - 支持页面：连接应用 / 考试管理 / 应用配置\n";
echo "  - 通过 controlApi 代理与 PHP 后端通信\n";