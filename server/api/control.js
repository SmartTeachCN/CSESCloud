/**
 * CSES Cloud 通用 REST 设备控制 API (v1)（NodeJS 版，1:1 复刻 api/control.php）
 *
 * 为实例侧应用提供内置的 REST 设备控制能力，支持：
 * - 设备注册（注册码验证）
 * - 设备管理（列表、详情、注销）
 * - 命令调度（创建、轮询、结果上报）
 * - 心跳上报
 * - 设备错误上报
 * - 注册码管理
 * - SSE 事件流
 *
 * 路由: /api/control.php?instance_uid={uid}&action={action}
 *
 * 认证方式（v1 协议）:
 * - 设备注册: 注册码验证
 * - 其他操作: x-device-id + x-device-credential 请求头（或 body 参数兼容旧版）
 * - 管理操作: 需实例管理员权限
 *
 * 这是 CSES Cloud 平台内置的通用设备控制能力。
 * 任何实例侧应用（如 ExamAware 2 适配器）均可通过此 API 实现客户端远程控制。
 */
const crypto = require('crypto');
const { dateStr, nowStr, parseDate } = require('../lib/response');

// ===== 辅助函数 =====

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** PHP date('c')：ISO 8601 带上海时区偏移 */
const isoC = (d = new Date()) => dateStr(d).replace(' ', 'T') + '+08:00';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PHP json_decode(s, true)：解析失败返回 def */
function jsonDecodeSafe(s, def = null) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return def;
  }
}

/** PHP `json_decode(s, true) ?: def`：解析结果为 falsy（含空数组/空对象）时返回 def */
function jsonDecodeOr(s, def) {
  let v;
  try {
    v = JSON.parse(s);
  } catch (_) {
    return def;
  }
  if (v === null || v === undefined || v === false) return def;
  if (typeof v === 'number') return v === 0 ? def : v;
  if (typeof v === 'string') return (v === '' || v === '0') ? def : v;
  if (Array.isArray(v)) return v.length === 0 ? def : v;
  if (typeof v === 'object') return Object.keys(v).length === 0 ? def : v;
  return v;
}

/** PHP truthiness（'0'、空数组、空对象为 falsy，对齐 json_decode 关联数组语义） */
function phpTruthy(v) {
  if (v === undefined || v === null || v === false) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== '0';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function getDeviceIdFromRequest(req, body) {
  const header = req.headers['x-device-id'] ?? '';
  if (header !== '') return String(header).trim();
  return body.deviceId ?? (body.device_id ?? '');
}

function getCredentialFromRequest(req, body) {
  const header = req.headers['x-device-credential'] ?? '';
  if (header !== '') return String(header).trim();
  return body.credential ?? '';
}

function verifyDeviceCredential(DB, Response, instanceId, deviceId, credential) {
  if (deviceId === '') Response.error('缺少 deviceId', 401, 401);
  if (credential === '') Response.error('缺少 credential', 401, 401);

  const device = DB.one(
    "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
    [instanceId, deviceId]
  );
  if (!device) Response.error('设备未注册或已吊销', 401, 401);

  const credHash = sha256(credential);
  const cred = DB.one(
    'SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL',
    [deviceId, credHash]
  );
  if (!cred) Response.error('凭证无效', 401, 401);

  DB.update('ea2_device_credentials', { last_used_at: nowStr() }, 'id = ?', [parseInt(cred.id, 10) || 0]);
}

function generateCredential() {
  const bytes = crypto.randomBytes(48);
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let code = '';
  for (let i = 0; i < 24; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

// ===== 设备注册处理函数（对应 _handleDeviceRegister） =====
function handleDeviceRegister(ctx, instanceId, instanceUid) {
  const { req, DB, Response, Helpers, body } = ctx;

  const enrollmentCode = String(body.enrollmentCode ?? '').trim();
  const displayName = String(body.displayName ?? '').trim();
  const platform = String(body.platform ?? '').trim();
  const architecture = String(body.architecture ?? '').trim();
  const appVersion = String(body.appVersion ?? '').trim();
  const protocolVersion = body.protocolVersion ?? null;

  // 验证注册码
  if (enrollmentCode === '') Response.error('缺少 enrollmentCode');
  if (!/^EA2-[A-Za-z0-9_-]{16,128}$/.test(enrollmentCode)) {
    Response.error('enrollmentCode 格式无效，需匹配 EA2-[A-Za-z0-9_-]{16,128}', 400, 400);
  }
  if (displayName === '') Response.error('缺少 displayName');
  if ([...displayName].length > 120) Response.error('displayName 不能超过 120 个字符');
  const validPlatforms = ['win32', 'darwin', 'linux', 'openharmony'];
  if (!validPlatforms.includes(platform)) Response.error('platform 无效');
  const validArchs = ['x64', 'arm64'];
  if (!validArchs.includes(architecture)) Response.error('architecture 无效');
  if (appVersion === '' || appVersion.length > 64) Response.error('appVersion 无效');
  if (protocolVersion !== 1) Response.error('protocolVersion 必须为 1');

  // 验证注册码
  const codeHash = sha256(enrollmentCode);
  const code = DB.one(
    'SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? AND code_hash = ?',
    [instanceId, codeHash]
  );
  if (!code) Response.error('注册码无效', 401, 401);
  if (code.revoked_at) Response.error('注册码已被吊销', 401, 401);
  if ((parseInt(code.used_count, 10) || 0) >= (parseInt(code.max_uses, 10) || 0)) Response.error('注册码已用完', 401, 401);
  if (parseDate(code.expires_at).getTime() < Date.now()) Response.error('注册码已过期', 401, 401);

  // 生成设备 ID 和凭证
  const deviceId = Helpers.uuid();
  const credential = generateCredential();
  const credentialHash = sha256(credential);
  const now = nowStr();

  DB.insert('ea2_devices', {
    instance_id: instanceId,
    device_id: deviceId,
    display_name: displayName,
    platform: platform,
    architecture: architecture,
    app_version: appVersion,
    protocol_version: protocolVersion,
    lifecycle_status: 'active',
    labels: JSON.stringify([]),
    last_seen_at: now,
    last_reported_state: JSON.stringify([]),
    enrolled_at: now,
    created_at: now,
    updated_at: now,
  });

  DB.insert('ea2_device_credentials', {
    device_id: deviceId,
    credential_hash: credentialHash,
    version: 1,
    issued_at: now,
  });

  DB.update('ea2_enrollment_codes', {
    used_count: (parseInt(code.used_count, 10) || 0) + 1,
  }, 'id = ?', [parseInt(code.id, 10) || 0]);

  // 构造响应
  const protocol = req.secure ? 'https' : 'http';
  const host = req.headers.host ?? 'localhost';
  const baseUrl = protocol + '://' + host;
  const pollUrl = baseUrl + '/api/control.php?instance_uid=' + encodeURIComponent(instanceUid) + '&action=command_poll';

  Response.success({
    deviceId: deviceId,
    credential: credential,
    instanceUid: instanceUid,
    websocketUrl: pollUrl,
    protocolVersion: 1,
  });
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const action = query.action ?? '';

  // 获取实例
  let instanceUid = String(query.instance_uid ?? '').trim();
  let instanceId = null;

  // device_register 支持无 instance_uid 模式：通过注册码查找实例
  if (method === 'POST' && action === 'device_register') {
    const enrollmentCode = String(body.enrollmentCode ?? '').trim();
    if (enrollmentCode !== '') {
      const codeHash = sha256(enrollmentCode);
      const code = DB.one(
        `SELECT ec.*, i.instance_uid FROM ea2_enrollment_codes ec
         JOIN instances i ON ec.instance_id = i.id
         WHERE ec.code_hash = ?`,
        [codeHash]
      );
      if (code) {
        instanceId = parseInt(code.instance_id, 10) || 0;
        instanceUid = code.instance_uid;
      }
    }
    if (!instanceId) {
      // 回退：没有注册码或注册码无效，尝试 instance_uid
      if (instanceUid === '') {
        Response.error('缺少 instance_uid 参数或注册码无效');
      }
    }
  }

  if (instanceId === null) {
    if (instanceUid === '') {
      Response.error('缺少 instance_uid 参数');
    }
    const inst = DB.one('SELECT * FROM instances WHERE instance_uid = ?', [instanceUid]);
    if (!inst) {
      Response.error('实例不存在', 404, 404);
    }
    instanceId = parseInt(inst.id, 10) || 0;
  }

  // ===== 公开操作 =====

  // 设备注册（v1 协议）
  if (method === 'POST' && action === 'device_register') {
    handleDeviceRegister(ctx, instanceId, instanceUid);
  }

  // ===== 需要设备凭证认证的操作 =====

  // 所有需要认证的操作在进入前验证
  const needsAuth = [
    'device_list', 'device_get', 'device_unregister',
    'device_update_state', 'command_poll', 'command_report',
    'device_errors',
    'command_list', 'command_get', 'enrollment_list',
    'events_stream'
  ];

  if (needsAuth.includes(action)) {
    // 管理类操作需要实例权限
    const mgmtOps = ['device_list', 'device_get', 'device_unregister', 'command_list', 'command_get', 'enrollment_list'];
    if (!mgmtOps.includes(action)) {
      // 客户端操作：验证设备凭证
      const deviceId = getDeviceIdFromRequest(req, body);
      const credential = getCredentialFromRequest(req, body);
      if (deviceId !== '' || credential !== '') {
        verifyDeviceCredential(DB, Response, instanceId, deviceId, credential);
      }
    }
  }

  // 管理类操作需要实例管理权限
  const needsAdmin = ['device_list', 'device_get', 'device_unregister', 'device_update_notes', 'enrollment_create', 'enrollment_revoke',
    'enrollment_delete', 'command_create', 'command_list', 'command_get', 'exam_config_list', 'events_stream'];

  if (needsAdmin.includes(action)) {
    Auth.requireLogin();
    const instAdmin = DB.one(
      "SELECT * FROM instance_members WHERE instance_id = ? AND user_id = ? AND role IN ('owner','admin')",
      [instanceId, Auth.user()?.user_id ?? 0]
    );
    if (!instAdmin && !Auth.isSuperAdmin() && !Auth.isAlliance()) {
      Response.error('需要实例管理权限', 403, 403);
    }
  }

  // ===== 路由处理 =====
  switch (action) {
    // ===== 设备管理 =====
    case 'device_list': {
      const rows = DB.all(
        `SELECT device_id, display_name, platform, architecture, app_version,
                lifecycle_status, labels, notes, last_seen_at, enrolled_at, created_at
         FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active' ORDER BY enrolled_at DESC`,
        [instanceId]
      );
      for (const r of rows) {
        r.labels = jsonDecodeSafe(r.labels ?? '[]', null);
      }
      Response.success(rows);
    }

    case 'device_get': {
      const deviceId = body.deviceId ?? (body.device_id ?? '');
      if (deviceId === '') Response.error('缺少 deviceId');
      const device = DB.one(
        `SELECT device_id, display_name, platform, architecture, app_version,
                lifecycle_status, labels, last_seen_at, last_reported_state, enrolled_at, created_at
         FROM ea2_devices WHERE instance_id = ? AND device_id = ?`,
        [instanceId, deviceId]
      );
      if (!device) Response.error('设备不存在');
      device.labels = jsonDecodeSafe(device.labels ?? '[]', null);
      device.last_reported_state = jsonDecodeSafe(device.last_reported_state ?? '{}', null);
      Response.success(device);
    }

    case 'device_unregister': {
      const deviceId = body.deviceId ?? (body.device_id ?? '');
      if (deviceId === '') Response.error('缺少 deviceId');
      const affected = DB.update('ea2_devices', {
        lifecycle_status: 'revoked',
        updated_at: nowStr(),
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      if (affected.changes === 0) Response.error('设备不存在或已注销');
      Response.success(null, '设备已注销');
    }

    case 'device_update_state': {
      const deviceId = body.deviceId ?? (body.device_id ?? '');
      const state = body.state ?? [];
      const now = nowStr();
      DB.update('ea2_devices', {
        last_seen_at: now,
        last_reported_state: (state !== null && typeof state === 'object') ? JSON.stringify(state) : state,
        updated_at: now,
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      Response.success({ ok: true });
    }

    case 'device_update_notes': {
      const deviceId = body.device_id ?? '';
      const notes = String(body.notes ?? '').trim();
      if (deviceId === '') Response.error('缺少 device_id');
      DB.update('ea2_devices', {
        notes: notes,
        updated_at: nowStr(),
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      Response.success({ ok: true, notes: notes }, '备注已更新');
    }

    // ===== 注册码管理 =====
    case 'enrollment_create': {
      const maxUses = Math.max(1, parseInt(body.max_uses ?? 1, 10) || 0);
      const expiresInSeconds = parseInt(body.expires_in_seconds ?? 86400, 10) || 86400;
      const label = String(body.display_name ?? body.label ?? '').trim();
      const code = 'EA2-' + randomCode();
      const codeHash = sha256(code);
      const now = nowStr();
      DB.insert('ea2_enrollment_codes', {
        instance_id: instanceId,
        code_hash: codeHash,
        max_uses: maxUses,
        used_count: 0,
        display_name: label,
        label: label,
        expires_at: dateStr(new Date(Date.now() + expiresInSeconds * 1000)),
        created_at: now,
      });
      Response.success({ code: code, max_uses: maxUses, expires_in_seconds: expiresInSeconds }, '注册码已创建');
    }

    case 'enrollment_list': {
      const rows = DB.all(
        `SELECT id, code_hash, label, max_uses, used_count, revoked_at, expires_at, created_at
         FROM ea2_enrollment_codes WHERE instance_id = ? ORDER BY created_at DESC`,
        [instanceId]
      );
      // 不返回完整哈希，只返回掩码
      for (const r of rows) {
        r.code_masked = 'EA2-****' + String(r.code_hash).slice(-4);
        delete r.code_hash;
      }
      Response.success(rows);
    }

    case 'enrollment_revoke': {
      const id = parseInt(body.id ?? 0, 10) || 0;
      DB.update('ea2_enrollment_codes', { revoked_at: nowStr() }, 'id = ? AND instance_id = ?', [id, instanceId]);
      Response.success(null, '注册码已吊销');
    }

    case 'enrollment_delete': {
      const id = parseInt(body.id ?? 0, 10) || 0;
      const affected = DB.delete('ea2_enrollment_codes', 'id = ? AND instance_id = ?', [id, instanceId]);
      if (affected.changes === 0) Response.error('注册码不存在');
      Response.success(null, '注册码已删除');
    }

    // ===== 命令管理 =====
    case 'command_create': {
      const commandType = String(body.command_type ?? '').trim();
      const payload = body.payload ?? [];
      const targetDeviceId = body.device_id ?? null; // null = 广播
      const expiresMinutes = parseInt(body.expires_minutes ?? 5, 10) || 0;
      if (commandType === '') Response.error('缺少 command_type');
      const now = nowStr();
      const expiresAt = dateStr(new Date(Date.now() + expiresMinutes * 60 * 1000));

      if (phpTruthy(targetDeviceId)) {
        // 单设备命令
        DB.insert('ea2_commands', {
          command_id: Helpers.uuid(),
          instance_id: instanceId,
          device_id: targetDeviceId,
          command_type: commandType,
          payload: JSON.stringify(payload),
          status: 'pending',
          issued_at: now,
          expires_at: expiresAt,
          created_at: now,
        });
      } else {
        // 广播命令：为所有活跃设备创建
        const devices = DB.all(
          "SELECT device_id FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active'",
          [instanceId]
        );
        for (const dev of devices) {
          DB.insert('ea2_commands', {
            command_id: Helpers.uuid(),
            instance_id: instanceId,
            device_id: dev.device_id,
            command_type: commandType,
            payload: JSON.stringify(payload),
            status: 'pending',
            issued_at: now,
            expires_at: expiresAt,
            created_at: now,
          });
        }
      }
      Response.success(null, '命令已下发');
    }

    case 'command_poll': {
      // 官方协议：返回 server.command 格式
      const deviceId = body.deviceId ?? (body.device_id ?? '');
      const now = nowStr();
      const commands = DB.all(
        `SELECT id, command_id, command_type, payload, issued_at, expires_at
         FROM ea2_commands
         WHERE instance_id = ? AND device_id = ? AND status = 'pending'
           AND expires_at > ?
         ORDER BY issued_at ASC
         LIMIT 20`,
        [instanceId, deviceId, now]
      );
      // 标记为已发送，防止重复执行
      for (const cmd of commands) {
        DB.update('ea2_commands', { status: 'sent' }, 'id = ?', [parseInt(cmd.id, 10) || 0]);
      }
      const result = commands.map((cmd) => {
        const payload = jsonDecodeOr(cmd.payload, []);
        return {
          commandId: cmd.command_id,
          issuedAt: isoC(parseDate(cmd.issued_at)),
          expiresAt: isoC(parseDate(cmd.expires_at)),
          command: {
            type: cmd.command_type,
            payload: payload,
          },
        };
      });
      Response.success(result, 'ok');
    }

    case 'command_report': {
      const commandId = body.commandId ?? (body.command_id ?? '');
      const status = body.status ?? 'succeeded';
      const error = body.error ?? null;
      const state = body.state ?? null;
      const occurredAt = body.occurredAt ?? (body.occurred_at ?? isoC(new Date()));
      if (commandId === '') Response.error('缺少 commandId');

      const updates = {
        status: 'completed',
        result_status: status,
        result_error: phpTruthy(error) ? JSON.stringify(error) : null,
        result_state: phpTruthy(state) ? JSON.stringify(state) : null,
        result_occurred_at: occurredAt,
      };
      DB.update('ea2_commands', updates, 'command_id = ? AND instance_id = ?', [commandId, instanceId]);
      Response.success({ ok: true });
    }

    case 'command_list': {
      const filterDeviceId = query.device_id ?? '';
      const filterStatus = query.status ?? '';
      let sql = 'SELECT * FROM ea2_commands WHERE instance_id = ?';
      const params = [instanceId];
      if (filterDeviceId) {
        sql += ' AND device_id = ?';
        params.push(filterDeviceId);
      }
      if (filterStatus) {
        sql += ' AND status = ?';
        params.push(filterStatus);
      }
      sql += ' ORDER BY issued_at DESC LIMIT 100';
      const rows = DB.all(sql, params);
      for (const r of rows) {
        r.payload = jsonDecodeSafe(r.payload ?? '{}', null);
        r.result_error = jsonDecodeSafe(r.result_error ?? 'null', null);
        r.result_state = jsonDecodeSafe(r.result_state ?? 'null', null);
      }
      Response.success(rows);
    }

    case 'command_get': {
      const commandId = body.commandId ?? (body.command_id ?? '');
      const cmd = DB.one('SELECT * FROM ea2_commands WHERE command_id = ? AND instance_id = ?', [commandId, instanceId]);
      if (!cmd) Response.error('命令不存在');
      cmd.payload = jsonDecodeSafe(cmd.payload ?? '{}', null);
      cmd.result_error = jsonDecodeSafe(cmd.result_error ?? 'null', null);
      cmd.result_state = jsonDecodeSafe(cmd.result_state ?? 'null', null);
      Response.success(cmd);
    }

    // ===== 设备错误上报 (v1) =====
    case 'device_errors': {
      const deviceId = getDeviceIdFromRequest(req, body);
      const source = body.source ?? '';
      const message = body.message ?? '';
      const severity = body.severity ?? 'warning';
      if (!phpTruthy(source) || !phpTruthy(message)) Response.error('source 和 message 不能为空');
      const now = nowStr();
      DB.insert('ea2_commands', {
        command_id: Helpers.uuid(),
        instance_id: instanceId,
        device_id: deviceId,
        command_type: 'device.error',
        payload: JSON.stringify({
          severity: severity,
          source: source,
          code: body.code ?? '',
          message: message,
          stack: body.stack ?? null,
          context: body.context ?? null,
          occurredAt: body.occurredAt ?? isoC(new Date()),
        }),
        status: 'succeeded',
        result_status: 'succeeded',
        result_occurred_at: body.occurredAt ?? isoC(new Date()),
        issued_at: now,
        expires_at: dateStr(new Date(Date.now() + 86400 * 1000)),
        created_at: now,
      });
      DB.update('ea2_devices', {
        last_seen_at: now,
        updated_at: now,
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      Response.success({ ok: true });
    }

    // ===== 考试配置列表 =====
    case 'exam_config_list': {
      const rows = DB.all(
        `SELECT id, directory, name, content, file_type, file_size, file_category, created_at, updated_at
         FROM cloud_files WHERE instance_id = ? AND file_type = 'ea2' ORDER BY updated_at DESC`,
        [instanceId]
      );
      // 解析考试配置名称
      const result = rows.map((f) => {
        const content = Buffer.isBuffer(f.content) ? f.content.toString('utf8') : (f.content ?? '{}');
        const config = jsonDecodeOr(content, []);
        return {
          id: f.id,
          name: f.name,
          exam_name: config.examName ?? '未命名考试',
          exam_infos_count: (config.examInfos ?? []).length,
          file_size: f.file_size,
          updated_at: f.updated_at,
        };
      });
      Response.success(result);
    }

    // ===== SSE 事件流 =====
    case 'events_stream': {
      res.set('Content-Type', 'text/event-stream');
      res.set('Cache-Control', 'no-cache');
      res.set('Connection', 'keep-alive');
      res.set('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      let lastId = 0;
      // set_time_limit(0)：NodeJS 无需
      while (true) {
        if (req.socket.destroyed) break; // connection_aborted()
        const rows = DB.all(
          `SELECT c.command_id, c.command_type, c.payload, c.issued_at, c.device_id,
                  d.display_name AS device_name
           FROM ea2_commands c
           LEFT JOIN ea2_devices d ON c.device_id = d.device_id AND c.instance_id = d.instance_id
           WHERE c.instance_id = ? AND c.id > ?
           ORDER BY c.id ASC LIMIT 10`,
          [instanceId, lastId]
        );
        for (const row of rows) {
          // PHP：SELECT 未包含 c.id，$row['id'] ?? 0 恒为 0（1:1 保留该行为）
          lastId = Math.max(lastId, parseInt(row.id ?? 0, 10) || 0);
          const payload = jsonDecodeSafe(row.payload ?? '{}', null);
          res.write(`id: ${row.command_id}\n`);
          res.write('event: command\n');
          res.write('data: ' + JSON.stringify({
            commandId: row.command_id,
            commandType: row.command_type,
            payload: payload,
            deviceId: row.device_id,
            deviceName: row.device_name,
            issuedAt: isoC(parseDate(row.issued_at)),
          }) + '\n\n');
          if (typeof res.flush === 'function') res.flush();
        }
        await sleep(2000);
      }
      res.end();
      throw new ctx.HttpSent();
    }

    // ===== 设备注册（v1 协议） =====
    case 'device_register':
      // 已在前面处理
      break;

    default:
      Response.error('未知 action: ' + action, 400, 400);
  }

  // PHP：仅 device_register（非 POST）会落到此处，脚本结束输出空 200 响应
  res.status(200);
  res.end('');
};
