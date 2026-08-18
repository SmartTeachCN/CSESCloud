/**
 * EA2 CSES Cloud 适配器插件 - 主进程
 *
 * 基于 CSES Cloud 通用设备控制 API，同时支持两种连接协议：
 *  - poll：长 REST 轮询（轮询频率由服务端限制决定，默认 5 分钟，客户端自适应）
 *  - ws  ：WebSocket 长连接（命令实时推送）
 *
 * 协议切换：
 *  - 服务端通过 REST 响应（meta.protocol）或 WS 消息（protocol.switch）下发期望协议
 *  - 客户端根据服务端指令实时切换，若 WS 不可用则自动回退 REST 轮询
 *
 * REST API 端点：
 *  - device_register / command_poll / command_report / device_update_state
 *  - 认证: x-device-id + x-device-credential 请求头
 * WS 端点：/api/ws-control（auth 后走 JSON 消息）
 */
const os = require('os');
const crypto = require('crypto');

// ---------- defineMainPlugin 本地实现（等效于 @dsz-examaware/plugin-sdk） ----------

function defineMainPlugin(lifecycle) {
  var entry = async function (context) {
    var activation;
    try {
      if (lifecycle.onLoad) await lifecycle.onLoad(context);
      activation = await lifecycle.activate(context);
      if (lifecycle.onReady) await lifecycle.onReady(context);
    } catch (error) {
      try { context.scope.dispose(); } catch (e) { /* ignore */ }
      try { if (lifecycle.onUnload) await lifecycle.onUnload(context); } catch (e) { /* ignore */ }
      if (lifecycle.onError) {
        try { await lifecycle.onError(error, context); } catch (e) { /* ignore */ }
      }
      throw error;
    }
    return async function () {
      if (disposed) return;
      disposed = true;
      try { if (lifecycle.deactivate) await lifecycle.deactivate(context); } catch (e) { /* ignore */ }
      try {
        if (typeof activation === 'function') await activation();
        else if (activation && typeof activation.dispose === 'function') await activation.dispose();
      } catch (e) { /* ignore */ }
      try { context.scope.dispose(); } catch (e) { /* ignore */ }
      try { if (lifecycle.onUnload) await lifecycle.onUnload(context); } catch (e) { /* ignore */ }
    };
  };
  Object.defineProperties(entry, {
    apiVersion: { value: 2, enumerable: true },
    process: { value: 'main', enumerable: true }
  });
  return entry;
}

module.exports = defineMainPlugin({
  activate: function (ctx) {
    var log = ctx.logger;
    var disposed = false;

    // ===== 配置 =====
    var config = ctx.initialSettings || {};
    var serverUrl = config.serverUrl || '';
    var instanceUid = config.instanceUid || '';
    var enrollmentCode = config.enrollmentCode || '';
    var credential = config.credential || '';
    var deviceId = config.deviceId || '';
    // 当前连接协议（与服务端协商后更新）：poll / ws
    var protocol = 'poll';
    // 服务端 REST 轮询频率限制（秒），客户端据此自适应
    var serverPollInterval = 300;
    var registered = false;
    // 当前正在播放的考试（含部署信息），用于心跳上报给平台
    var currentPlayback = null; // { deployment_id, exam_config_id, exam_name, status, started_at }
    var currentSession = null;  // ctx.api.player.startFromConfig 返回的会话句柄

    // ===== 运行时状态 =====
    var pollTimer = null;
    var heartbeatTimer = null;
    var wsConn = null;        // 当前 WS 连接
    var wsReady = false;
    var reconnectTimer = null;
    var _updatingFromPolling = false;

    // ===== 协议/状态工具 =====
    function canStart() {
      if (!serverUrl) return false;
      if (enrollmentCode) return true;
      if (deviceId && credential) return true;
      return false;
    }

    function setStatus(status) {
      _updatingFromPolling = true;
      ctx.api.settings.patch({ connectionStatus: status }).catch(function () {});
      _updatingFromPolling = false;
    }

    // ===== 通用网络请求 =====
    async function apiRequest(url, options) {
      var opts = Object.assign({}, options || {}, { allowLocalNetwork: true });
      var resp;
      try {
        resp = await ctx.api.network.request(url, opts);
      } catch (e) {
        throw new Error('网络请求失败: ' + (e.message || '无法连接到服务器'));
      }
      var json;
      try {
        if (typeof resp.json === 'function') json = resp.json();
        else if (resp.data) json = resp.data;
        else json = resp;
      } catch (e) {
        throw new Error('服务器返回无效响应');
      }
      return json;
    }

    function buildUrl(action) {
      var base = serverUrl.replace(/\/+$/, '');
      var url = base + '/api/rest-control?action=' + encodeURIComponent(action);
      if (instanceUid) url += '&instance_uid=' + encodeURIComponent(instanceUid);
      return url;
    }

    function authHeaders() {
      var headers = { 'Content-Type': 'application/json' };
      if (deviceId) headers['x-device-id'] = deviceId;
      if (credential) headers['x-device-credential'] = credential;
      return headers;
    }

    async function controlApi(action, payload) {
      if (!serverUrl) throw new Error('服务器地址未配置');
      if (!instanceUid && action !== 'device_register') throw new Error('实例 UID 未配置');
      var json = await apiRequest(buildUrl(action), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload || {}),
      });
      if (!json || json.code !== 0) {
        var err = new Error((json && json.message) || 'API 请求失败');
        err.code = (json && json.code);
        err.meta = (json && json.meta) || (json && json.data) || null;
        throw err;
      }
      return { data: json.data, meta: json.meta };
    }

    // ===== 设备注册 =====
    async function registerDevice() {
      if (deviceId && credential) {
        registered = true;
        return;
      }
      if (!enrollmentCode) {
        log.warn('[CSES Cloud] 未配置注册码，跳过设备注册');
        return;
      }
      // 首次注册：生成本机稳定 device_id（后续复用）
      if (!deviceId) {
        deviceId = 'dev-' + (os.hostname() || 'device') + '-' + crypto.randomBytes(6).toString('hex');
      }
      var displayName = 'EA2-' + (os.hostname() || 'Device');
      var result = await controlApi('device_register', {
        device_id: deviceId,
        display_name: displayName,
        platform: process.platform,
        architecture: process.arch,
        app_version: '2.0.0',
        protocol_version: 1,
        enrollment_code: enrollmentCode,
        protocol: protocol,
      });
      var d = result.data;
      deviceId = d.device_id;
      credential = d.credential;
      var patchData = { deviceId: d.device_id, credential: d.credential };
      if (d.instance_uid) { instanceUid = d.instance_uid; patchData.instanceUid = d.instance_uid; }
      if (d.protocol) protocol = d.protocol;
      if (d.poll_interval_seconds) serverPollInterval = Math.max(1, parseInt(d.poll_interval_seconds, 10) || 300);
      _updatingFromPolling = true;
      ctx.api.settings.patch(patchData).catch(function () {});
      _updatingFromPolling = false;
      registered = true;
      log.info('[CSES Cloud] 设备注册成功: ' + deviceId + ' (协议: ' + protocol + ')');
    }

    // ===== 启动协议检查 =====
    // 已注册设备启动时向服务端确认当前期望协议与轮询间隔，避免本地状态与服务端不一致
    async function syncProtocolFromServer() {
      if (!deviceId || !credential) return;
      if (!instanceUid) return; // 尚未持有实例 UID，跳过（首次注册后已回填）
      try {
        var { data } = await controlApi('device_get', { device_id: deviceId, credential: credential });
        if (data) {
          if (data.protocol === 'ws' || data.protocol === 'poll') {
            log.info('[CSES Cloud] 服务端期望协议: ' + data.protocol + '，当前本地: ' + protocol);
            protocol = data.protocol;
          }
        }
      } catch (e) {
        log.warn('[CSES Cloud] 启动协议检查失败: ' + e.message + '，沿用本地协议 ' + protocol);
      }
    }

    // ===== 上线状态上报 =====
    // 组装设备状态（含当前播放考试），供心跳/上线上报
    function buildDeviceState() {
      var st = { online: true, protocol: protocol, lastHeartbeat: new Date().toISOString() };
      st.currentExam = currentPlayback;
      return st;
    }

    // 启动/重连成功后立即上报一次在线状态，回到 true 表示上报成功
    async function reportOnline() {
      if (!deviceId) return false;
      var state = buildDeviceState();
      try {
        if (wsReady && wsConn) {
          wsConn.send(JSON.stringify({ type: 'device_update', state: state }));
          return true;
        }
        await controlApi('device_update_state', { device_id: deviceId, credential: credential, state: state });
        return true;
      } catch (e) {
        log.warn('[CSES Cloud] 上线状态上报失败: ' + e.message);
        return false;
      }
    }

    // ===== WS 连接 =====
    function buildWsUrl() {
      var base = serverUrl.replace(/\/+$/, '');
      var wsBase = base.replace(/^http/i, 'ws');
      return wsBase + '/api/ws-control?instance_uid=' + encodeURIComponent(instanceUid) + '&protocol=ws';
    }

    function hasWebSocket() {
      return typeof globalThis !== 'undefined' && typeof globalThis.WebSocket === 'function';
    }

    function openWs() {
      stopPollTimer();
      if (wsConn) { try { wsConn.close(); } catch (e) {} wsConn = null; }
      wsReady = false;
      if (!hasWebSocket()) {
        log.warn('[CSES Cloud] 当前环境不支持 WebSocket，回退 REST 轮询');
        protocol = 'poll';
        startPollTimer();
        return;
      }
      var url = buildWsUrl();
      log.info('[CSES Cloud] 正在建立 WebSocket 连接: ' + url);
      var ws;
      try {
        ws = new globalThis.WebSocket(url);
      } catch (e) {
        log.error('[CSES Cloud] WebSocket 创建失败: ' + e.message);
        protocol = 'poll';
        startPollTimer();
        return;
      }
      wsConn = ws;
      var authed = false;

      ws.onopen = function () {
        log.info('[CSES Cloud] WebSocket 已连接，发送认证...');
        ws.send(JSON.stringify({ type: 'auth', instance_uid: instanceUid, device_id: deviceId, credential: credential }));
      };
      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        handleWsMessage(msg);
      };
      ws.onerror = function (e) {
        log.error('[CSES Cloud] WebSocket 错误');
      };
      ws.onclose = function (e) {
        var wasReady = wsReady;
        wsConn = null;
        wsReady = false;
        if (disposed) return;
        if (!authed) {
          // 认证失败：回退 poll
          log.warn('[CSES Cloud] WebSocket 认证失败(' + (e && e.code) + ')，回退 REST 轮询');
          protocol = 'poll';
        } else if (protocol === 'ws') {
          log.warn('[CSES Cloud] WebSocket 断开 (' + (e && e.code) + ')，尝试重连');
          scheduleWsReconnect();
        }
        if (wasReady === false) startPollTimer();
      };

      function handleWsMessage(msg) {
        switch (msg.type) {
          case 'hello':
            authed = true;
            wsReady = true;
            registered = true;
            protocol = 'ws';
            if (msg.poll_interval_seconds) serverPollInterval = Math.max(1, parseInt(msg.poll_interval_seconds, 10) || 300);
            stopPollTimer();
            setStatus('connected');
            log.info('[CSES Cloud] WebSocket 认证成功（心跳间隔 ' + (msg.heartbeat_interval || 30) + 's）');
            break;
          case 'command':
            if (msg.commands && Array.isArray(msg.commands)) {
              msg.commands.forEach(function (c) { executeCommand(c).catch(function () {}); });
            }
            break;
          case 'protocol.switch':
            log.info('[CSES Cloud] 服务端要求切换协议 → ' + msg.protocol);
            if (msg.protocol === 'poll') switchToPoll();
            else if (msg.protocol === 'ws') { /* 已在 ws */ }
            break;
          case 'protocol.want':
            // 服务端希望回退 poll（可选提示）
            break;
          case 'command.report_ack':
          case 'device_update_ack':
          case 'pong':
          case 'heartbeat':
            break;
          case 'close':
            if (authed) { try { ws.close(); } catch (e) {} }
            break;
          case 'error':
            log.warn('[CSES Cloud] 服务端错误: ' + (msg.error || ''));
            break;
        }
      }
    }

    function scheduleWsReconnect() {
      if (disposed) return;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (protocol === 'ws' && canStart()) openWs();
        else if (protocol !== 'ws') startPollTimer();
      }, 3000);
    }

    function closeWs() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (wsConn) { try { wsConn.close(); } catch (e) {} wsConn = null; }
      wsReady = false;
    }

    // ===== REST 轮询 =====
    function startPollTimer() {
      stopPollTimer();
      var intervalMs = Math.max(serverPollInterval || 300, 1) * 1000;
      log.info('[CSES Cloud] 开始 REST 轮询（间隔: ' + intervalMs + 'ms）');
      pollCommands();
      pollTimer = setInterval(pollCommands, intervalMs);
    }

    function stopPollTimer() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    async function pollCommands() {
      if (disposed || protocol !== 'poll' || !deviceId || !credential) return;
      try {
        var { data, meta } = await controlApi('command_poll', { deviceId, credential });
        // 服务端自适应：更新轮询间隔与协议
        if (meta && meta.poll_interval_seconds) {
          var newInterval = Math.max(1, parseInt(meta.poll_interval_seconds, 10) || 300);
          if (newInterval !== serverPollInterval) {
            serverPollInterval = newInterval;
            // 重新调度，使下次按新间隔
          }
        }
        if (meta && meta.protocol === 'ws') {
          log.info('[CSES Cloud] 服务端要求使用 WebSocket，切换连接');
          protocol = 'ws';
          openWs();
          return;
        }
        setStatus('connected');
        if (data && Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            await executeCommand(data[i]);
          }
        }
      } catch (e) {
        handlePollError(e);
      }
    }

    function handlePollError(e) {
      var msg = e.message || '';
      if (e.code === 429) {
        // 服务端轮询频率限制：按 retry_after 调整
        var retry = (e.meta && e.meta.retry_after) || 0;
        if (retry > 0) serverPollInterval = Math.max(retry, serverPollInterval || 300);
        if (e.meta && e.meta.protocol === 'ws') { protocol = 'ws'; openWs(); return; }
        return;
      }
      log.warn('[CSES Cloud] 命令轮询失败: ' + msg);
      // 设备被清除或凭证失效：保留 device_id 身份，仅清空凭证后重绑恢复。
      // 服务端遇到已存在的 device_id 会直接重绑、不再消耗连接码，从而避免单次码耗尽导致的死循环。
      if (msg.indexOf('实例不存在') >= 0 || msg.indexOf('设备未注册') >= 0 || msg.indexOf('已吊销') >= 0 ||
          msg.indexOf('凭证无效') >= 0 || msg.indexOf('缺少 instance_uid') >= 0) {
        stopPollTimer();
        credential = '';
        ctx.api.settings.patch({ credential: '' }).catch(function () {});
        if (deviceId && enrollmentCode) restartConnection();
        else setStatus('error: ' + msg);
      }
    }

    // ===== 协议切换 =====
    function switchToPoll() {
      if (protocol === 'poll') return;
      protocol = 'poll';
      closeWs();
      startPollTimer();
    }

    function switchProtocol(p) {
      if (p === 'ws') { if (protocol !== 'ws') { protocol = 'ws'; openWs(); } }
      else if (p === 'poll') switchToPoll();
    }

    // ===== 命令执行 =====
    async function executeCommand(cmd) {
      var commandId = cmd.commandId;
      var commandType = cmd.command.type;
      var payload = cmd.command.payload || {};
      log.info('[CSES Cloud] 收到命令: ' + commandType + ' (' + commandId + ')');
      try {
        switch (commandType) {
          case 'exam-config.prepare': await handleExamConfigPrepare(payload); break;
          case 'playback.activate': await handlePlayback('activate', payload); break;
          case 'playback.stop': await handlePlayback('stop', payload); break;
          case 'broadcast.show':
            log.info('[CSES Cloud] 广播 [' + (payload.severity || 'info') + ']: ' + (payload.title || '') + ' - ' + (payload.body || ''));
            break;
          case 'broadcast.dismiss':
            log.info('[CSES Cloud] 解除广播: ' + (payload.broadcastId || ''));
            break;
          case 'settings.apply': await handleSettingsApply(payload); break;
          default: throw new Error('不支持的命令类型: ' + commandType);
        }
        await reportResult(commandId, 'succeeded');
      } catch (e) {
        log.error('[CSES Cloud] 命令执行失败: ' + e.message);
        await reportResult(commandId, 'failed', { code: 'command_execution_failed', message: e.message });
      }
    }

    async function handleExamConfigPrepare(payload) {
      var artifact = payload.artifact;
      if (!artifact || !artifact.url) throw new Error('缺少 artifact URL');
      var fullUrl = artifact.url.startsWith('http') ? artifact.url : serverUrl.replace(/\/+$/, '') + artifact.url;
      log.info('[CSES Cloud] 下载考试配置: ' + fullUrl);
      var resp = await ctx.api.network.request(fullUrl, { method: 'GET', allowLocalNetwork: true });
      var examConfig = resp.json();
      log.info('[CSES Cloud] 考试配置已加载: ' + (examConfig.examName || '未命名'));
      var session = await ctx.api.player.startFromConfig(examConfig);
      log.info('[CSES Cloud] 考试已打开, session: ' + session.id);
      currentSession = session;
      currentPlayback = {
        deployment_id: payload.deployment_id || '',
        exam_config_id: String(payload.exam_config_id || ''),
        exam_name: examConfig.examName || '未命名',
        status: 'playing',
        started_at: new Date().toISOString(),
      };
      trackSessionClose(session); // 设备端手动退出/关闭时同步云端
      sendHeartbeat(); // 立即上报当前播放状态
      await session.focus().catch(function () {});
    }

    // 设备端会话被用户手动关闭/退出时，将云端播放状态同步为已停止
    function trackSessionClose(session) {
      if (!session) return;
      function onClosed() {
        if (currentSession !== session) return;
        log.info('[CSES Cloud] 设备端会话已关闭，同步云端状态');
        currentSession = null;
        currentPlayback = null;
        sendHeartbeat();
      }
      // 防御式挂载几种常见生命周期回调（具体以宿主 SDK 提供的为准）
      try { if (typeof session.onDidClose === 'function') session.onDidClose(onClosed); } catch (e) {}
      try { if (typeof session.onClosed === 'function') session.onClosed(onClosed); } catch (e) {}
      try { if (typeof session.onDidDispose === 'function') session.onDidDispose(onClosed); } catch (e) {}
      try {
        if (typeof session.on === 'function') {
          ['closed', 'close', 'ended'].forEach(function (ev) { try { session.on(ev, onClosed); } catch (e) {} });
        }
      } catch (e) {}
    }

    async function handlePlayback(type, payload) {
      if (type === 'stop') {
        log.info('[CSES Cloud] 停止考试显示');
        if (currentSession) {
          try {
            if (typeof currentSession.stop === 'function') await currentSession.stop();
            else if (typeof currentSession.close === 'function') await currentSession.close();
          } catch (e) { log.warn('[CSES Cloud] 关闭会话失败: ' + e.message); }
        }
        currentSession = null;
        currentPlayback = null;
        sendHeartbeat(); // 立即上报已停止
        return;
      }
      // activate
      log.info('[CSES Cloud] 激活考试显示: ' + JSON.stringify(payload));
      if (currentPlayback) {
        currentPlayback.status = 'playing';
        sendHeartbeat();
      }
    }

    async function handleSettingsApply(payload) {
      var settings = payload.settings || [];
      if (settings.length === 0) return;
      log.info('[CSES Cloud] 应用 ' + settings.length + ' 项配置设置');
      try {
        var currentSettings = ctx.api.settings.getAll ? ctx.api.settings.getAll() : {};
        var updated = {};
        for (var k in currentSettings) updated[k] = currentSettings[k];
        for (var i = 0; i < settings.length; i++) {
          var item = settings[i];
          if (item && item.key) updated[item.key] = item.value;
        }
        await ctx.api.settings.patch(updated);
      } catch (e) {
        log.error('[CSES Cloud] 配置同步失败: ' + e.message);
        throw e;
      }
    }

    // 结果上报：WS 模式走 ws 消息，否则走 REST
    async function reportResult(commandId, status, error, state) {
      var body = { commandId, status, occurredAt: new Date().toISOString() };
      if (error) body.error = error;
      if (state) body.state = state;
      try {
        if (wsReady && wsConn) {
          wsConn.send(JSON.stringify(Object.assign({ type: 'command_report' }, body)));
        } else {
          await controlApi('command_report', body);
        }
      } catch (e) {
        log.warn('[CSES Cloud] 结果上报失败: ' + e.message);
      }
    }

    // ===== 心跳 =====
    function sendHeartbeat() {
      if (disposed || !deviceId) return;
      var state = buildDeviceState();
      try {
        if (wsReady && wsConn) {
          wsConn.send(JSON.stringify({ type: 'device_update', state: state }));
        } else {
          // 服务端 device_update_state 读取 device_id（蛇形），必须匹配才能刷新在线时间
          controlApi('device_update_state', { device_id: deviceId, credential: credential, state: state }).catch(function () {});
        }
      } catch (e) { /* 静默 */ }
    }

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, 30000);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    // ===== 连接控制 =====
    var connectingNow = false;
    async function ensureConnected() {
      if (connectingNow) return; // 避免重复并发连接
      connectingNow = true;
      try {
        stopPollTimer();
        closeWs();
        startHeartbeat();
        try {
          await registerDevice();               // 已注册设备直接跳过
          await syncProtocolFromServer();       // 启动/刷新时与服务端协商协议
          var online = await reportOnline();    // 立即上报在线状态
          if (protocol === 'ws') openWs();
          else startPollTimer();
          if (online) setStatus('connected');   // 上报成功则同步设置页为已连接
        } catch (e) {
          log.error('[CSES Cloud] 连接失败: ' + e.message);
          setStatus('error: ' + e.message);
        }
      } finally {
        connectingNow = false;
      }
    }

    function restartConnection() {
      ensureConnected();
    }

    function stopAll() {
      stopPollTimer();
      stopHeartbeat();
      closeWs();
    }

    // ===== 监听配置变更 =====
    var settingsDisposer = ctx.api.settings.onChanged(function (newSettings) {
      if (_updatingFromPolling) return;
      // 渲染层刷新信号：重新连接 + 上报在线状态 + 协商协议
      if (newSettings.connectionStatus === '__refresh__') {
        config = newSettings;
        serverUrl = newSettings.serverUrl || '';
        instanceUid = newSettings.instanceUid || '';
        enrollmentCode = newSettings.enrollmentCode || '';
        credential = newSettings.credential || '';
        deviceId = newSettings.deviceId || '';
        stopAll();
        if (canStart()) restartConnection();
        return;
      }
      var prevServerUrl = serverUrl, prevEnrollment = enrollmentCode, prevDeviceId = deviceId, prevCredential = credential;
      config = newSettings;
      serverUrl = newSettings.serverUrl || '';
      instanceUid = newSettings.instanceUid || '';
      enrollmentCode = newSettings.enrollmentCode || '';
      credential = newSettings.credential || '';
      deviceId = newSettings.deviceId || '';
      if (prevServerUrl !== serverUrl || prevEnrollment !== enrollmentCode || prevDeviceId !== deviceId || prevCredential !== credential) {
        stopAll();
        if (canStart()) restartConnection();
      }
    });

    // ===== 断开 / 重连（供渲染层调用） =====
    async function disconnect() {
      stopAll();
      deviceId = ''; credential = ''; instanceUid = ''; enrollmentCode = '';
      try {
        await ctx.api.settings.patch({ deviceId: '', credential: '', instanceUid: '', enrollmentCode: '', connectionStatus: 'disconnected' });
      } catch (e) {}
      log.info('[CSES Cloud] 已断开连接');
    }

    async function reconnect() {
      stopAll();
      deviceId = ''; credential = '';
      try {
        await ctx.api.settings.patch({ deviceId: '', credential: '', connectionStatus: 'reconnecting' });
      } catch (e) {}
      if (canStart()) restartConnection();
    }

    // ===== 启动 =====
    if (canStart()) {
      startHeartbeat();
      restartConnection();
    } else {
      log.info('[CSES Cloud] 请在 EA2 设置中配置服务器地址和连接码');
    }

    // ===== 清理 =====
    return async function () {
      disposed = true;
      stopAll();
      if (settingsDisposer && typeof settingsDisposer.dispose === 'function') settingsDisposer.dispose();
      log.info('[CSES Cloud] 适配器已停止');
    };
  },

  onError: function (error, ctx) {
    ctx.logger.error('[CSES Cloud] 插件生命周期错误: ' + (error && error.message));
  }
});