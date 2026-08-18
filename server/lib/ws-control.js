/**
 * 通用 WebSocket 设备控制网关
 *
 * 与 REST 设备控制 API 一一对应，提供 WebSocket 长连接通道，实现命令实时推送。
 * 通用性：本模块不依赖任何特定实例侧应用（如 EA2），任何已注册设备均可使用。
 *
 * 连接地址：ws://{host}/api/ws-control
 * 认证流程：
 *   1. 建立连接后，客户端发送 auth 消息：
 *      { type: 'auth', instance_uid, device_id, credential }
 *   2. 服务端校验 device+credential，通过后发送 hello：
 *      { type: 'hello', protocol: 'ws', heartbeat_interval, poll_interval_seconds }
 *   3. 之后双方通过 JSON 消息通信：
 *      - 服务端 → 客户端：command / heartbeat / protocol.switch / close
 *      - 客户端 → 服务端：command_report / device_update / ping / pong
 *
 * 命令消息格式与 REST command_poll 一致（server.command 数组）。
 */

const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** dateStr 已含 +08:00 偏移的字符串（复用 rest-control 的 ISO 格式） */
function isoCStr(dateStr) {
  return String(dateStr).replace(' ', 'T') + '+08:00';
}

function jsonDecodeOr(s, def) {
  try {
    const v = JSON.parse(s);
    if (v === null || v === undefined || v === false) return def;
    if (typeof v === 'number') return v === 0 ? def : v;
    if (typeof v === 'string') return (v === '' || v === '0') ? def : v;
    if (Array.isArray(v)) return v.length === 0 ? def : v;
    if (typeof v === 'object') return Object.keys(v).length === 0 ? def : v;
    return v;
  } catch (_) {
    return def;
  }
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

const DEFAULT_POLL_INTERVAL = 300; // 5 分钟

let DB = null; // 延迟注入（由 attach 时传入）

// 索引：deviceId -> Set<WebSocket>（一台设备可多连接，取活跃者）
const deviceSockets = new Map();
// deviceId -> 注册信息 { instanceUid, instanceId }
const deviceInfo = new Map();

function key(deviceId) {
  return String(deviceId);
}

/** 取实例当前轮询间隔（秒） */
function getPollInterval(instanceId) {
  if (!DB) return DEFAULT_POLL_INTERVAL;
  try {
    const inst = DB.one('SELECT ea2_poll_interval_seconds FROM instances WHERE id = ?', [instanceId]);
    const n = parseInt(inst && inst.ea2_poll_interval_seconds, 10);
    return n > 0 ? n : DEFAULT_POLL_INTERVAL;
  } catch (_) {
    return DEFAULT_POLL_INTERVAL;
  }
}

/** 校验设备凭证，成功返回设备行 */
function verifyDevice(instanceUid, deviceId, credential) {
  if (!DB) return null;
  const inst = DB.one('SELECT * FROM instances WHERE instance_uid = ?', [instanceUid]);
  if (!inst) return null;
  const instanceId = parseInt(inst.id, 10) || 0;
  const device = DB.one(
    "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
    [instanceId, deviceId]
  );
  if (!device) return null;
  if (!credential) return null;
  const credHash = sha256(credential);
  const cred = DB.one(
    'SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL',
    [deviceId, credHash]
  );
  if (!cred) return null;
  return { instance: inst, instanceId, device, cred };
}

/** 读取设备待执行命令（与 REST command_poll 相同）并标记为 sent */
function fetchPendingCommands(instanceId, deviceId) {
  if (!DB) return [];
  const now = nowStr();
  const commands = DB.all(
    `SELECT * FROM ea2_commands
     WHERE instance_id = ? AND device_id = ? AND status = 'pending'
     AND expires_at > ?
     ORDER BY created_at ASC LIMIT 50`,
    [instanceId, deviceId, now]
  );
  for (const cmd of commands) {
    DB.update('ea2_commands', { status: 'sent' }, 'id = ?', [cmd.id]);
  }
  // 更新最后在线时间
  DB.update('ea2_devices', { last_seen_at: now, updated_at: now }, 'id = ?', [deviceId]);
  return commands.map((cmd) => ({
    commandId: cmd.command_id,
    issuedAt: isoCStr(cmd.issued_at),
    expiresAt: isoCStr(cmd.expires_at),
    command: {
      type: cmd.command_type,
      payload: jsonDecodeOr(cmd.payload, []),
    },
  }));
}

/** 向设备推送命令（供 REST 层在创建命令后调用） */
function notifyDevice(instanceId, deviceId) {
  const sockets = deviceSockets.get(key(deviceId));
  if (!sockets || sockets.size === 0) return false;
  let pushed = false;
  for (const ws of sockets) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const commands = fetchPendingCommands(instanceId, deviceId);
    if (commands.length > 0) {
      send(ws, { type: 'command', commands });
      pushed = true;
    }
  }
  return pushed;
}

function broadcast(instanceId, deviceId, msg) {
  const sockets = deviceSockets.get(key(deviceId));
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) send(ws, msg);
  }
}

function send(ws, msg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch (_) {}
}

/** 设备连接协议切换（REST 或 WS 通道均可触发） */
function switchDeviceProtocol(instanceId, deviceId, protocol, reason) {
  if (protocol !== 'poll' && protocol !== 'ws') return;
  if (!DB) return;
  // 持久化期望协议
  DB.update('ea2_devices', { protocol, updated_at: nowStr() }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
  // WS 连接设备：实时推送切换指令
  broadcast(instanceId, deviceId, {
    type: 'protocol.switch',
    protocol,
    reason: reason || 'admin',
  });
}

/** 关闭某设备的 WS 连接（注销/吊销时） */
function closeDevice(deviceId) {
  const sockets = deviceSockets.get(key(deviceId));
  if (sockets) {
    for (const ws of sockets) {
      try { send(ws, { type: 'close', reason: 'device_revoked' }); ws.close(); } catch (_) {}
    }
    deviceSockets.delete(key(deviceId));
  }
  deviceInfo.delete(key(deviceId));
}

function onMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { send(conn.ws, { type: 'error', error: 'invalid_json' }); return; }

  switch (msg.type) {
    case 'auth': {
      const ver = verifyDevice(msg.instance_uid, msg.device_id, msg.credential);
      if (!ver) {
        send(conn.ws, { type: 'error', error: 'auth_failed' });
        conn.ws.close(4001, 'auth_failed');
        return;
      }
      conn.authorized = true;
      conn.instanceId = ver.instanceId;
      conn.deviceId = msg.device_id;
      conn.instanceUid = msg.instance_uid;

      // 注册到索引
      let sockets = deviceSockets.get(key(msg.device_id));
      if (!sockets) { sockets = new Set(); deviceSockets.set(key(msg.device_id), sockets); }
      sockets.add(conn.ws);

      deviceInfo.set(key(msg.device_id), {
        instanceUid: msg.instance_uid,
        instanceId: ver.instanceId,
      });

      // 标记为 WS 连接，更新在线
      const now = nowStr();
      DB.update('ea2_devices', {
        last_seen_at: now,
        updated_at: now,
        protocol: 'ws',
      }, 'instance_id = ? AND device_id = ?', [ver.instanceId, msg.device_id]);

      // 发送 hello
      send(conn.ws, {
        type: 'hello',
        protocol: 'ws',
        heartbeat_interval: 30,
        poll_interval_seconds: getPollInterval(ver.instanceId),
        server_time: isoCStr(now),
      });

      // 立即推送待执行命令
      const commands = fetchPendingCommands(ver.instanceId, msg.device_id);
      if (commands.length > 0) send(conn.ws, { type: 'command', commands });

      // 若设备期望协议是 poll，通知其可在需要时回退（仅提示，不强制）
      if (ver.device.protocol === 'poll') {
        send(conn.ws, { type: 'protocol.want', protocol: 'poll' });
      }
      break;
    }

    case 'command_report': {
      if (!conn.authorized) break;
      const commandId = msg.commandId ?? (msg.command_id ?? '');
      const status = msg.status || 'succeeded';
      const error = msg.error || null;
      const state = msg.state || null;
      const occurredAt = msg.occurredAt || (msg.occurred_at || isoCStr(nowStr()));
      if (!commandId) { send(conn.ws, { type: 'error', error: 'missing_command_id' }); break; }
      DB.update('ea2_commands', {
        status,
        result_status: status,
        result_error: error ? JSON.stringify(error) : null,
        result_occurred_at: occurredAt,
        result_state: state ? JSON.stringify(state) : null,
      }, 'command_id = ?', [commandId]);
      send(conn.ws, { type: 'command.report_ack', commandId });
      break;
    }

    case 'device_update': {
      if (!conn.authorized) break;
      const now = nowStr();
      DB.update('ea2_devices', {
        last_seen_at: now,
        last_reported_state: JSON.stringify(msg.state ?? []),
        updated_at: now,
      }, 'instance_id = ? AND device_id = ?', [conn.instanceId, conn.deviceId]);
      send(conn.ws, { type: 'device_update_ack' });
      break;
    }

    case 'ping':
      send(conn.ws, { type: 'pong', server_time: isoCStr(nowStr()) });
      break;

    case 'pong':
      conn.alive = true;
      break;

    default:
      send(conn.ws, { type: 'error', error: 'unknown_type' });
  }
}

function onClose(conn) {
  if (conn.authorized && conn.deviceId) {
    const sockets = deviceSockets.get(key(conn.deviceId));
    if (sockets) {
      sockets.delete(conn.ws);
      if (sockets.size === 0) deviceSockets.delete(key(conn.deviceId));
    }
    if (deviceInfo.get(key(conn.deviceId))?.instanceUid === conn.instanceUid) {
      // 保留 deviceInfo（允许 REST 回退后再次连接）；仅当无任何连接时清理
      if (!deviceSockets.has(key(conn.deviceId))) deviceInfo.delete(key(conn.deviceId));
    }
  }
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/ws-control') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        // 连接建立后等待 auth；5 秒内未认证则关闭
        const conn = { ws, authorized: false, alive: true };
        ws.on('message', (raw) => onMessage(conn, raw));
        ws.on('close', () => onClose(conn));
        ws.on('pong', () => { conn.alive = true; });
        ws._conn = conn;
        setTimeout(() => {
          if (!conn.authorized) {
            try { ws.close(4001, 'auth_timeout'); } catch (_) {}
          }
        }, 8000);
      });
    } else {
      socket.destroy();
    }
  });

  // 心跳：每 30s ping 一次，未响应则终止
  const heartbeat = setInterval(() => {
    for (const sockets of deviceSockets.values()) {
      for (const ws of sockets) {
        const conn = ws._conn;
        if (!conn) continue;
        if (!conn.alive) {
          try { ws.terminate(); } catch (_) {}
          continue;
        }
        conn.alive = false;
        try { ws.ping(); } catch (_) {}
      }
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  console.log('[ws-control] WebSocket 控制网关已就绪 (/api/ws-control)');
  return {
    notifyDevice,
    broadcast,
    switchDeviceProtocol,
    closeDevice,
    setDB: (d) => { DB = d; },
    getPollInterval,
    DEFAULT_POLL_INTERVAL,
  };
}

module.exports = { attach, DEFAULT_POLL_INTERVAL };