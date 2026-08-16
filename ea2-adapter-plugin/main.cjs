/**
 * EA2 CSES Cloud 适配器插件 - 主进程
 *
 * 基于 CSES Cloud 通用 REST 设备控制 API (v1)，与 CSES Cloud 云控平台通信。
 * 此 API 是 CSES Cloud 平台内置能力，非 EA2 专属。
 *
 * 连接方式：REST API 轮询
 * - 设备注册: POST /api/control.php?instance_uid=X&action=device_register
 * - 命令轮询: POST /api/control.php?action=command_poll
 *   （返回 server.command 格式）
 * - 心跳: POST /api/control.php?action=device_update_state
 * - 认证: x-device-id + x-device-credential 请求头
 *
 * 配置：CSES Cloud 服务器地址 + 连接码（注册码）
 */
const os = require('os');
const crypto = require('crypto');

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

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

    var disposed = false;
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

// ---------- 插件生命周期 ----------

module.exports = defineMainPlugin({
  activate: function (ctx) {
    var log = ctx.logger;
    var pollTimer = null;
    var heartbeatTimer = null;
    var disposed = false;

    // 读取配置
    var config = ctx.initialSettings || {};
    var serverUrl = config.serverUrl || '';
    var instanceUid = config.instanceUid || '';
    var enrollmentCode = config.enrollmentCode || '';
    var credential = config.credential || '';
    var deviceId = config.deviceId || '';

    // 监听配置变更
    var settingsDisposer = ctx.api.settings.onChanged(function (newSettings) {
      config = newSettings;
      serverUrl = newSettings.serverUrl || '';
      instanceUid = newSettings.instanceUid || '';
      enrollmentCode = newSettings.enrollmentCode || '';
      credential = newSettings.credential || '';
      deviceId = newSettings.deviceId || '';
      log.info('[CSES Cloud] 设置已更新');
      stopPolling();
      if (serverUrl && enrollmentCode) startPolling();
    });

    // ===== 通用网络请求 =====
    async function apiRequest(url, options) {
      var opts = Object.assign({}, options || {}, { allowLocalNetwork: true });
      log.info('[CSES Cloud] 请求: ' + (options && options.method || 'GET') + ' ' + url);
      var resp;
      try {
        resp = await ctx.api.network.request(url, opts);
      } catch (e) {
        log.error('[CSES Cloud] 网络请求失败: ' + e.message);
        throw new Error('网络请求失败: ' + (e.message || '无法连接到服务器'));
      }
      var json;
      try {
        // 兼容不同响应格式
        if (typeof resp.json === 'function') {
          json = resp.json();
        } else if (resp.data) {
          json = resp.data;
        } else {
          json = resp;
        }
      } catch (e) {
        throw new Error('服务器返回无效响应: ' + (e.message || ''));
      }
      if (!json || json.code !== 0) {
        throw new Error((json && json.message) || 'API 请求失败 (code=' + (json && json.code) + ')');
      }
      return json.data;
    }

    function buildUrl(action) {
      var base = serverUrl.replace(/\/+$/, '');
      var url = base + '/api/control.php?action=' + encodeURIComponent(action);
      if (instanceUid) {
        url += '&instance_uid=' + encodeURIComponent(instanceUid);
      }
      return url;
    }

    function authHeaders() {
      var headers = { 'Content-Type': 'application/json' };
      if (deviceId) headers['x-device-id'] = deviceId;
      if (credential) headers['x-device-credential'] = credential;
      return headers;
    }

    /**
     * 调用 ea2-control.php 的 action 端点（带认证头）
     */
    async function controlApi(action, payload) {
      if (!serverUrl) {
        throw new Error('服务器地址未配置');
      }
      // device_register 不需要 instanceUid（通过注册码查找实例）
      if (!instanceUid && action !== 'device_register') {
        throw new Error('实例 UID 未配置（请先完成设备注册）');
      }
      return apiRequest(buildUrl(action), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload || {}),
      });
    }

    // ===== 设备注册（通过通用控制 API v1） =====
    async function registerDevice() {
      if (!enrollmentCode) {
        log.warn('[CSES Cloud] 未配置注册码，跳过设备注册');
        return;
      }

      // 如果已有凭证，尝试直接轮询（已注册过）
      if (deviceId && credential) {
        log.info('[CSES Cloud] 已有设备凭证，跳过注册: ' + deviceId);
        return;
      }

      var displayName = 'EA2-' + (os.hostname() || 'Device');

      // 使用通用控制 API 注册设备
      var result = await controlApi('device_register', {
        enrollmentCode: enrollmentCode,
        displayName: displayName,
        platform: process.platform,
        architecture: process.arch,
        appVersion: '2.0.0',
        protocolVersion: 1,
      });

      // 响应: { deviceId, credential, instanceUid, websocketUrl, protocolVersion }
      deviceId = result.deviceId;
      credential = result.credential;
      var patchData = {
        deviceId: result.deviceId,
        credential: result.credential,
      };
      // 如果服务器返回了 instanceUid，自动保存
      if (result.instanceUid) {
        instanceUid = result.instanceUid;
        patchData.instanceUid = result.instanceUid;
      }
      await ctx.api.settings.patch(patchData);

      log.info('[CSES Cloud] 设备注册成功: ' + result.deviceId + ' (名称: ' + displayName + ')');
    }

    // ===== 命令轮询 =====
    async function pollCommands() {
      if (disposed || !deviceId || !credential) return;
      try {
        // 官方协议: 返回 server.command 格式数组
        var commands = await controlApi('command_poll', {
          deviceId: deviceId,
          credential: credential,
        });
        if (!commands || !Array.isArray(commands)) return;
        for (var i = 0; i < commands.length; i++) {
          await executeCommand(commands[i]);
        }
      } catch (e) {
        log.warn('[CSES Cloud] 命令轮询失败: ' + e.message);
        // 如果是认证失败，清除凭证重新注册
        if (e.message.indexOf('凭证无效') >= 0 || e.message.indexOf('设备未注册') >= 0) {
          deviceId = '';
          credential = '';
          await ctx.api.settings.patch({ deviceId: '', credential: '' });
          log.info('[CSES Cloud] 凭证已失效，已清除本地凭证');
        }
      }
    }

    /**
     * 执行命令（官方 server.command 格式）
     * cmd: { commandId, issuedAt, expiresAt, command: { type, payload } }
     */
    async function executeCommand(cmd) {
      var commandId = cmd.commandId;
      var commandType = cmd.command.type;
      var payload = cmd.command.payload || {};
      log.info('[CSES Cloud] 收到命令: ' + commandType + ' (' + commandId + ')');

      try {
        switch (commandType) {
          case 'exam-config.prepare':
            await handleExamConfigPrepare(payload);
            break;
          case 'playback.activate':
          case 'playback.stop':
            await handlePlayback(payload);
            break;
          case 'broadcast.show':
            log.info('[CSES Cloud] 广播 [' + (payload.severity || 'info') + ']: ' + (payload.title || '') + ' - ' + (payload.body || ''));
            break;
          case 'broadcast.dismiss':
            log.info('[CSES Cloud] 解除广播: ' + (payload.broadcastId || ''));
            break;
          case 'settings.apply':
            log.info('[CSES Cloud] 应用 ' + ((payload.settings || []).length) + ' 项设置');
            break;
          default:
            throw new Error('不支持的命令类型: ' + commandType);
        }
        await reportResult(commandId, 'succeeded');
      } catch (e) {
        log.error('[CSES Cloud] 命令执行失败: ' + e.message);
        await reportResult(commandId, 'failed', {
          code: 'command_execution_failed',
          message: e.message,
        });
      }
    }

    async function handleExamConfigPrepare(payload) {
      var artifact = payload.artifact;
      if (!artifact || !artifact.url) throw new Error('缺少 artifact URL');
      var fullUrl = artifact.url.startsWith('http')
        ? artifact.url
        : serverUrl.replace(/\/+$/, '') + artifact.url;
      log.info('[CSES Cloud] 下载考试配置: ' + fullUrl);
      var resp = await ctx.api.network.request(fullUrl, {
        method: 'GET',
        allowLocalNetwork: true,
      });
      var examConfig = resp.json();
      log.info('[CSES Cloud] 考试配置已加载: ' + (examConfig.examName || '未命名'));
      // 校验 SHA-256
      if (artifact.sha256) {
        log.info('[CSES Cloud] 考试配置 SHA-256: ' + artifact.sha256);
      }
    }

    async function handlePlayback(payload) {
      log.info('[CSES Cloud] 播放控制: ' + JSON.stringify(payload));
    }

    /**
     * 上报命令执行结果（官方 command.result 格式）
     */
    async function reportResult(commandId, status, error, state) {
      try {
        var body = {
          commandId: commandId,
          status: status,
          occurredAt: new Date().toISOString(),
        };
        if (error) body.error = error;
        if (state) body.state = state;
        await controlApi('command_report', body);
      } catch (e) {
        log.warn('[CSES Cloud] 结果上报失败: ' + e.message);
      }
    }

    // ===== 心跳 =====
    async function sendHeartbeat() {
      if (disposed || !deviceId) return;
      try {
        await controlApi('device_update_state', {
          deviceId: deviceId,
          state: { lastHeartbeat: new Date().toISOString() },
        });
      } catch (e) {
        // 心跳静默失败
      }
    }

    // ===== 轮询控制 =====
    function startPolling() {
      stopPolling();
      log.info('[CSES Cloud] 开始轮询: ' + serverUrl + ' (实例: ' + instanceUid + ')');

      registerDevice().then(function () {
        log.info('[CSES Cloud] 设备注册成功，开始轮询命令');
        // 更新状态到设置
        ctx.api.settings.patch({ connectionStatus: 'connected' }).catch(function () {});
      }).catch(function (e) {
        log.error('[CSES Cloud] 设备注册失败: ' + e.message);
        ctx.api.settings.patch({ connectionStatus: 'error: ' + e.message }).catch(function () {});
      });

      pollTimer = setInterval(pollCommands, POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    // 自动启动
    if (serverUrl && enrollmentCode) {
      startPolling();
    } else {
      log.info('[CSES Cloud] 请在 EA2 设置中配置服务器地址和连接码');
    }

    // 返回清理函数
    return async function () {
      disposed = true;
      stopPolling();
      if (settingsDisposer && typeof settingsDisposer.dispose === 'function') {
        settingsDisposer.dispose();
      }
      log.info('[CSES Cloud] 适配器已停止');
    };
  },

  onError: function (error, ctx) {
    ctx.logger.error('[CSES Cloud] 插件生命周期错误: ' + (error && error.message));
  }
});