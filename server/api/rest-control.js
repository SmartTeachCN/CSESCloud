/**
 * EA2 控制服务器 API（NodeJS 版，1:1 复刻 api/rest-control.php）
 *
 * 基于 EA2 控制协议 v1，提供 REST API 进行设备管理、命令调度和考试配置下发。
 * 由于 PHP 限制无法运行持久 WebSocket，采用 REST + 轮询/SSE 模式间接集控。
 *
 * 路由：/api/rest-control.php?instance_uid={uid}&action={action}
 *
 * 端点：
 *   === 设备管理 ===
 *   device_list              列出所有设备
 *   device_get                获取单个设备详情
 *   device_register          注册设备（生成 credential）
 *   device_unregister        注销设备
 *   device_update_state      更新设备状态
 *   device_update_notes      更新设备备注
 *
 *   === 注册码管理 ===
 *   enrollment_create        创建注册码
 *   enrollment_list          列出注册码
 *   enrollment_revoke        吊销注册码
 *
 *   === 命令管理 ===
 *   command_create           创建命令（下发到设备）
 *   command_poll             设备轮询待执行命令
 *   command_report           设备上报命令执行结果
 *   command_list             列出所有命令
 *   command_get              获取单个命令详情
 *
 *   === 考试配置 ===
 *   exam_config_deploy       部署考试配置到设备
 *   exam_config_list         列出考试配置部署记录
 *
 *   === 错误上报 (v1) ===
 *   device_errors           上报设备错误
 *
 *   === 监考呼叫 (v1) ===
 *   proctor_calls           设备呼叫监考
 *
 *   === 实时事件 ===
 *   events_stream            SSE 事件流
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

/**
 * 从请求中获取 device_id（支持官方 x-device-id 请求头和 body 参数）
 */
function getDeviceIdFromRequest(req, body) {
  const header = req.headers['x-device-id'] ?? '';
  if (header !== '') return String(header).trim();
  return body.deviceId ?? (body.device_id ?? '');
}

/**
 * 从请求中获取 credential（支持官方 x-device-credential 请求头和 body 参数）
 */
function getCredentialFromRequest(req, body) {
  const header = req.headers['x-device-credential'] ?? '';
  if (header !== '') return String(header).trim();
  return body.credential ?? '';
}

/**
 * 验证设备凭证
 */
function verifyDeviceCredential(DB, Response, instanceId, deviceId, credential) {
  if (deviceId === '') {
    Response.error('缺少 deviceId', 401, 401);
  }
  if (credential === '') {
    Response.error('缺少 credential', 401, 401);
  }

  const device = DB.one(
    "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
    [instanceId, deviceId]
  );
  if (!device) {
    Response.error('设备未注册或已吊销', 401, 401);
  }

  const credHash = sha256(credential);
  const cred = DB.one(
    'SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL',
    [deviceId, credHash]
  );
  if (!cred) {
    Response.error('凭证无效', 401, 401);
  }

  // 更新最后使用时间
  DB.update('ea2_device_credentials', { last_used_at: nowStr() }, 'id = ?', [parseInt(cred.id, 10) || 0]);
}

module.exports = async (ctx) => {
  const { req, res, DB, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const instanceUid = String(query.instance_uid ?? '').trim();
  const action = String(query.action ?? (body.action ?? '')).trim();

  if (instanceUid === '') {
    Response.error('缺少 instance_uid 参数');
  }

  // 查找实例
  const inst = DB.one('SELECT * FROM instances WHERE instance_uid = ?', [instanceUid]);
  if (!inst) {
    Response.error('实例不存在', 404, 404);
  }

  const instanceId = parseInt(inst.id, 10) || 0;

  // ===== 路由 =====
  switch (action) {
    // ===== 设备管理 =====
    case 'device_list': {
      const devices = DB.all(
        'SELECT * FROM ea2_devices WHERE instance_id = ? ORDER BY updated_at DESC',
        [instanceId]
      );
      for (const d of devices) {
        d.labels = jsonDecodeOr(d.labels ?? '[]', []);
        d.last_reported_state = jsonDecodeOr(d.last_reported_state ?? '{}', []);
      }
      Response.success(devices);
    }

    case 'device_get': {
      const deviceId = body.device_id ?? query.device_id ?? '';
      if (!phpTruthy(deviceId)) Response.error('缺少 device_id');
      const d = DB.one(
        'SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ?',
        [instanceId, deviceId]
      );
      if (!d) Response.error('设备不存在', 404, 404);
      d.labels = jsonDecodeOr(d.labels ?? '[]', []);
      d.last_reported_state = jsonDecodeOr(d.last_reported_state ?? '{}', []);
      Response.success(d);
    }

    case 'device_register': {
      // 模拟 EA2 设备注册流程
      const deviceId = body.device_id ?? '';
      const displayName = body.display_name ?? '';
      const platform = body.platform ?? '';
      const architecture = body.architecture ?? '';
      const appVersion = body.app_version ?? '';
      const protocolVersion = body.protocol_version ?? 1;
      const enrollmentCode = body.enrollment_code ?? '';
      const capabilities = body.capabilities ?? [];

      if (!phpTruthy(deviceId) || !phpTruthy(displayName)) {
        Response.error('device_id 和 display_name 不能为空');
      }

      // 验证注册码
      let code = null;
      if (phpTruthy(enrollmentCode)) {
        const codeHash = sha256(enrollmentCode);
        code = DB.one(
          'SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? AND code_hash = ?',
          [instanceId, codeHash]
        );
        if (!code) Response.error('注册码无效', 401, 401);
        if (code.revoked_at) Response.error('注册码已被吊销', 401, 401);
        if (Number(code.used_count) >= Number(code.max_uses)) Response.error('注册码已用完', 401, 401);
        if (parseDate(code.expires_at).getTime() < Date.now()) Response.error('注册码已过期', 401, 401);
      }

      const now = nowStr();
      const existing = DB.one('SELECT id FROM ea2_devices WHERE device_id = ?', [deviceId]);

      if (existing) {
        // 更新已有设备
        DB.update('ea2_devices', {
          display_name: displayName,
          platform: platform,
          architecture: architecture,
          app_version: appVersion,
          protocol_version: protocolVersion,
          lifecycle_status: 'active',
          last_seen_at: now,
          last_reported_state: JSON.stringify(body.state ?? []),
          updated_at: now,
        }, 'id = ?', [existing.id]);
      } else {
        DB.insert('ea2_devices', {
          instance_id: instanceId,
          device_id: deviceId,
          display_name: displayName,
          platform: platform,
          architecture: architecture,
          app_version: appVersion,
          protocol_version: protocolVersion,
          lifecycle_status: 'active',
          labels: JSON.stringify(body.labels ?? []),
          last_seen_at: now,
          last_reported_state: JSON.stringify(body.state ?? []),
          enrolled_at: now,
          created_at: now,
          updated_at: now,
        });
      }

      // 生成凭证
      const credential = crypto.randomBytes(32).toString('hex');
      const credentialHash = sha256(credential);
      DB.insert('ea2_device_credentials', {
        device_id: deviceId,
        credential_hash: credentialHash,
        version: 1,
        issued_at: now,
      });

      // 更新注册码使用次数
      if (phpTruthy(enrollmentCode)) {
        DB.update('ea2_enrollment_codes', {
          used_count: Number(code.used_count) + 1,
        }, 'id = ?', [code.id]);
      }

      Response.success({
        device_id: deviceId,
        credential: credential,
        websocket_url: '/api/rest-control.php?instance_uid=' + instanceUid + '&action=command_poll',
        protocol_version: 1,
      });
    }

    case 'device_unregister': {
      const deviceId = body.device_id ?? '';
      if (!phpTruthy(deviceId)) Response.error('缺少 device_id');
      // 删除设备记录
      DB.delete('ea2_devices', 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      // 删除凭证
      DB.delete('ea2_device_credentials', 'device_id = ?', [deviceId]);
      // 删除该设备的待执行命令
      DB.delete('ea2_commands', 'instance_id = ? AND device_id = ? AND status = ?', [instanceId, deviceId, 'pending']);
      Response.success({ ok: true }, '设备已从列表移除并取消绑定');
    }

    case 'device_update_state': {
      const deviceId = body.device_id ?? '';
      if (!phpTruthy(deviceId)) Response.error('缺少 device_id');
      const now = nowStr();
      DB.update('ea2_devices', {
        last_seen_at: now,
        last_reported_state: JSON.stringify(body.state ?? []),
        updated_at: now,
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      Response.success({ ok: true });
    }

    case 'device_update_notes': {
      const deviceId = body.device_id ?? '';
      const notes = String(body.notes ?? '').trim();
      if (!phpTruthy(deviceId)) Response.error('缺少 device_id');
      DB.update('ea2_devices', {
        notes: notes,
        updated_at: nowStr(),
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);
      Response.success({ ok: true, notes: notes }, '备注已更新');
    }

    // ===== 注册码管理 =====
    case 'enrollment_create': {
      const displayName = body.display_name ?? '';
      const maxUses = parseInt(body.max_uses ?? 1, 10) || 0;
      const expiresIn = parseInt(body.expires_in_seconds ?? 86400, 10) || 0;
      const rawCode = 'EA2-' + crypto.randomBytes(16).toString('hex');
      const codeHash = sha256(rawCode);
      const now = nowStr();
      DB.insert('ea2_enrollment_codes', {
        instance_id: instanceId,
        code_hash: codeHash,
        display_name: displayName,
        max_uses: maxUses,
        used_count: 0,
        expires_at: dateStr(new Date(Date.now() + expiresIn * 1000)),
        created_at: now,
      });
      Response.success({
        code: rawCode,
        display_name: displayName,
        max_uses: maxUses,
        expires_at: dateStr(new Date(Date.now() + expiresIn * 1000)),
      }, '注册码已创建');
    }

    case 'enrollment_list': {
      const codes = DB.all(
        'SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? ORDER BY created_at DESC',
        [instanceId]
      );
      Response.success(codes);
    }

    case 'enrollment_revoke': {
      const codeId = body.id ?? '';
      if (!phpTruthy(codeId)) Response.error('缺少 id');
      DB.update('ea2_enrollment_codes', {
        revoked_at: nowStr(),
      }, 'id = ? AND instance_id = ?', [codeId, instanceId]);
      Response.success({ ok: true }, '注册码已吊销');
    }

    case 'enrollment_delete': {
      const codeId = body.id ?? '';
      if (!phpTruthy(codeId)) Response.error('缺少 id');
      DB.delete('ea2_enrollment_codes', 'id = ? AND instance_id = ?', [codeId, instanceId]);
      Response.success({ ok: true }, '注册码已删除');
    }

    // ===== 命令管理 =====
    case 'command_create': {
      const commandType = body.command_type ?? '';
      const payload = body.payload ?? [];
      const deviceId = body.device_id ?? null; // null = 广播
      const expiresIn = parseInt(body.expires_in_seconds ?? 300, 10) || 0;

      if (!phpTruthy(commandType) || Helpers.empty(payload)) {
        Response.error('command_type 和 payload 不能为空');
      }

      const now = nowStr();
      let commandId = Helpers.uuid();

      if (phpTruthy(deviceId)) {
        // 单设备命令
        DB.insert('ea2_commands', {
          command_id: commandId,
          instance_id: instanceId,
          device_id: deviceId,
          command_type: commandType,
          payload: JSON.stringify(payload),
          status: 'pending',
          issued_at: now,
          expires_at: dateStr(new Date(Date.now() + expiresIn * 1000)),
          created_at: now,
        });
      } else {
        // 广播：为每个活跃设备创建命令
        const devices = DB.all(
          "SELECT device_id FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active'",
          [instanceId]
        );
        for (const d of devices) {
          DB.insert('ea2_commands', {
            command_id: Helpers.uuid(),
            instance_id: instanceId,
            device_id: d.device_id,
            command_type: commandType,
            payload: JSON.stringify(payload),
            status: 'pending',
            issued_at: now,
            expires_at: dateStr(new Date(Date.now() + expiresIn * 1000)),
            created_at: now,
          });
        }
        commandId = 'broadcast';
      }

      Response.success({
        command_id: commandId,
        command_type: commandType,
        issued_at: now,
        expires_at: dateStr(new Date(Date.now() + expiresIn * 1000)),
      }, '命令已创建');
    }

    case 'command_poll': {
      // 设备轮询待执行命令
      const deviceId = body.device_id ?? query.device_id ?? '';
      const credential = body.credential ?? query.credential ?? '';

      if (!phpTruthy(deviceId)) Response.error('缺少 device_id', 401, 401);

      // 验证凭证
      const device = DB.one(
        "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
        [instanceId, deviceId]
      );
      if (!device) Response.error('设备未注册或已吊销', 401, 401);

      if (phpTruthy(credential)) {
        const credHash = sha256(credential);
        const cred = DB.one(
          'SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL',
          [deviceId, credHash]
        );
        if (!cred) Response.error('凭证无效', 401, 401);
        // 更新最后使用时间
        DB.update('ea2_device_credentials', { last_used_at: nowStr() }, 'id = ?', [cred.id]);
      }

      // 获取待执行命令
      const now = nowStr();
      const commands = DB.all(
        `SELECT * FROM ea2_commands
         WHERE instance_id = ? AND device_id = ? AND status = 'pending'
         AND expires_at > ?
         ORDER BY created_at ASC LIMIT 10`,
        [instanceId, deviceId, now]
      );

      // 标记为已发送
      for (const cmd of commands) {
        DB.update('ea2_commands', { status: 'sent' }, 'id = ?', [cmd.id]);
      }

      // 更新设备最后在线时间
      DB.update('ea2_devices', {
        last_seen_at: now,
        updated_at: now,
      }, 'id = ?', [device.id]);

      // 返回官方协议格式: server.command 消息数组
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
      // 支持官方协议格式 (commandId) 和旧格式 (command_id)
      const commandId = body.commandId ?? (body.command_id ?? '');
      const status = body.status ?? 'succeeded';
      const error = body.error ?? null;
      const state = body.state ?? null;
      const occurredAt = body.occurredAt ?? (body.occurred_at ?? isoC(new Date()));

      if (!phpTruthy(commandId)) Response.error('缺少 command_id');

      DB.update('ea2_commands', {
        status: status,
        result_status: status,
        result_error: phpTruthy(error) ? JSON.stringify(error) : null,
        result_occurred_at: occurredAt,
        result_state: phpTruthy(state) ? JSON.stringify(state) : null,
      }, 'command_id = ?', [commandId]);

      Response.success({ ok: true }, '结果已记录');
    }

    case 'command_list': {
      const deviceId = body.device_id ?? query.device_id ?? '';
      const statusFilter = body.status ?? query.status ?? '';

      let where = 'instance_id = ?';
      const params = [instanceId];
      if (phpTruthy(deviceId)) {
        where += ' AND device_id = ?';
        params.push(deviceId);
      }
      if (phpTruthy(statusFilter)) {
        where += ' AND status = ?';
        params.push(statusFilter);
      }

      const commands = DB.all(
        `SELECT * FROM ea2_commands WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
        params
      );
      for (const cmd of commands) {
        cmd.payload = jsonDecodeOr(cmd.payload, []);
        cmd.result_error = jsonDecodeSafe(cmd.result_error ?? 'null', null);
        cmd.result_state = jsonDecodeSafe(cmd.result_state ?? 'null', null);
      }
      Response.success(commands);
    }

    case 'command_get': {
      const commandId = body.command_id ?? query.command_id ?? '';
      if (!phpTruthy(commandId)) Response.error('缺少 command_id');
      const cmd = DB.one('SELECT * FROM ea2_commands WHERE command_id = ?', [commandId]);
      if (!cmd) Response.error('命令不存在', 404, 404);
      cmd.payload = jsonDecodeOr(cmd.payload, []);
      cmd.result_error = jsonDecodeSafe(cmd.result_error ?? 'null', null);
      cmd.result_state = jsonDecodeSafe(cmd.result_state ?? 'null', null);
      Response.success(cmd);
    }

    // ===== 考试配置 =====
    case 'exam_config_deploy': {
      const examConfigId = body.exam_config_id ?? '';
      let deviceIds = body.device_ids ?? []; // 空 = 所有设备

      if (!phpTruthy(examConfigId)) {
        Response.error('缺少 exam_config_id');
      }

      // 从 .ea2 文件读取考试配置
      let fileName = examConfigId;
      if (!String(fileName).endsWith('.ea2')) {
        fileName += '.ea2';
      }
      let ea2File = DB.one(
        "SELECT * FROM cloud_files WHERE instance_id = ? AND file_type = 'ea2' AND name = ?",
        [instanceId, fileName]
      );
      if (!ea2File) {
        // 尝试按 id 查找
        ea2File = DB.one(
          'SELECT * FROM cloud_files WHERE instance_id = ? AND id = ?',
          [instanceId, parseInt(examConfigId, 10) || 0]
        );
      }
      if (!ea2File) {
        Response.error('考试配置文件不存在', 404, 404);
      }

      // 兼容 better-sqlite3 返回 Buffer 的情况
      const ea2Content = Buffer.isBuffer(ea2File.content)
        ? ea2File.content.toString('utf8')
        : (ea2File.content ?? '');
      const examConfig = jsonDecodeSafe(ea2Content, null);
      if (!phpTruthy(examConfig)) {
        Response.error('考试配置 JSON 解析失败', 400, 400);
      }

      const now = nowStr();
      const deploymentId = Helpers.uuid();

      // 获取目标设备
      if (Helpers.empty(deviceIds)) {
        const devices = DB.all(
          "SELECT device_id FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active'",
          [instanceId]
        );
        deviceIds = devices.map((d) => d.device_id);
      }

      if (Helpers.empty(deviceIds)) {
        Response.error('没有可用的活跃设备');
      }

      // 为每个设备创建 exam-config.prepare 命令
      for (const did of deviceIds) {
        DB.insert('ea2_commands', {
          command_id: Helpers.uuid(),
          instance_id: instanceId,
          device_id: did,
          command_type: 'exam-config.prepare',
          payload: JSON.stringify({
            deployment_id: deploymentId,
            exam_config_id: String(ea2File.id),
            exam_config_version_id: deploymentId,
            artifact: {
              url: '/api/instance-files?action=download&id=' + ea2File.id,
              media_type: 'application/vnd.examaware.exam-config+json',
              size_bytes: Buffer.byteLength(ea2Content, 'utf8'),
              sha256: crypto.createHash('sha256').update(ea2Content, 'utf8').digest('hex'),
              expires_at: isoC(new Date(Date.now() + 3600 * 1000)),
            },
          }),
          status: 'pending',
          issued_at: now,
          expires_at: dateStr(new Date(Date.now() + 3600 * 1000)),
          created_at: now,
        });
      }

      Response.success({
        deployment_id: deploymentId,
        device_count: deviceIds.length,
        exam_name: examConfig.examName ?? '未命名考试',
      }, '考试配置已部署');
    }

    case 'exam_config_list': {
      // 返回所有 .ea2 文件作为可部署的考试配置
      const files = DB.all(
        "SELECT * FROM cloud_files WHERE instance_id = ? AND file_type = 'ea2' ORDER BY updated_at DESC",
        [instanceId]
      );
      const result = files.map((f) => {
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

    // ===== 设备错误上报 (v1) =====
    case 'device_errors': {
      // 官方协议: POST /api/v1/device-errors
      // 认证方式: x-device-id + x-device-credential 请求头
      const deviceId = getDeviceIdFromRequest(req, body);
      const credential = getCredentialFromRequest(req, body);
      verifyDeviceCredential(DB, Response, instanceId, deviceId, credential);

      let severity = body.severity ?? 'warning';
      const source = body.source ?? '';
      const errorCode = body.code ?? '';
      const message = body.message ?? '';
      const stack = body.stack ?? null;
      const context = body.context ?? null;
      const occurredAt = body.occurredAt ?? isoC(new Date());

      if (!phpTruthy(source) || !phpTruthy(message)) {
        Response.error('source 和 message 不能为空', 400, 400);
      }

      const validSeverities = ['warning', 'error', 'fatal'];
      if (!validSeverities.includes(severity)) {
        severity = 'warning';
      }

      // 存储错误报告（可扩展：写入日志表或文件）
      const now = nowStr();
      DB.insert('ea2_commands', {
        command_id: Helpers.uuid(),
        instance_id: instanceId,
        device_id: deviceId,
        command_type: 'device.error',
        payload: JSON.stringify({
          severity: severity,
          source: source,
          code: errorCode,
          message: message,
          stack: stack,
          context: context,
          occurredAt: occurredAt,
        }),
        status: 'succeeded',
        result_status: 'succeeded',
        result_occurred_at: occurredAt,
        issued_at: now,
        expires_at: dateStr(new Date(Date.now() + 86400 * 1000)),
        created_at: now,
      });

      // 更新设备最后在线时间
      DB.update('ea2_devices', {
        last_seen_at: now,
        updated_at: now,
      }, 'instance_id = ? AND device_id = ?', [instanceId, deviceId]);

      Response.success({ ok: true });
    }

    // ===== 监考呼叫 (v1) =====
    case 'proctor_calls': {
      // 官方协议: POST /api/v1/proctor-calls
      const deviceId = getDeviceIdFromRequest(req, body);
      const credential = getCredentialFromRequest(req, body);
      verifyDeviceCredential(DB, Response, instanceId, deviceId, credential);

      const occurredAt = body.occurredAt ?? isoC(new Date());
      const roomNumber = body.roomNumber ?? '';
      const msg = body.message ?? '';

      const now = nowStr();
      DB.insert('ea2_commands', {
        command_id: Helpers.uuid(),
        instance_id: instanceId,
        device_id: deviceId,
        command_type: 'proctor.call',
        payload: JSON.stringify({
          occurredAt: occurredAt,
          roomNumber: roomNumber,
          message: msg,
        }),
        status: 'succeeded',
        result_status: 'succeeded',
        result_occurred_at: occurredAt,
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

    // ===== 实时事件 =====
    case 'events_stream': {
      // SSE 事件流
      res.set('Content-Type', 'text/event-stream');
      res.set('Cache-Control', 'no-cache');
      res.set('Connection', 'keep-alive');
      res.set('X-Accel-Buffering', 'no');

      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      let lastCommandId = 0;
      let lastDeviceId = 0;

      while (true) {
        // 检查新命令
        const newCommands = DB.all(
          'SELECT * FROM ea2_commands WHERE instance_id = ? AND id > ? ORDER BY id ASC LIMIT 20',
          [instanceId, lastCommandId]
        );
        for (const cmd of newCommands) {
          lastCommandId = Math.max(lastCommandId, parseInt(cmd.id, 10) || 0);
          cmd.payload = jsonDecodeOr(cmd.payload, []);
          res.write('event: command_update\n');
          res.write('data: ' + JSON.stringify(cmd) + '\n\n');
          if (typeof res.flush === 'function') res.flush();
        }

        // 检查设备状态变化
        const newDevices = DB.all(
          'SELECT * FROM ea2_devices WHERE instance_id = ? AND id > ? ORDER BY id ASC LIMIT 20',
          [instanceId, lastDeviceId]
        );
        for (const d of newDevices) {
          lastDeviceId = Math.max(lastDeviceId, parseInt(d.id, 10) || 0);
          d.labels = jsonDecodeOr(d.labels ?? '[]', []);
          res.write('event: device_update\n');
          res.write('data: ' + JSON.stringify(d) + '\n\n');
          if (typeof res.flush === 'function') res.flush();
        }

        // 发送心跳
        res.write('event: heartbeat\n');
        res.write('data: ' + JSON.stringify({ time: isoC(new Date()) }) + '\n\n');
        if (typeof res.flush === 'function') res.flush();

        if (req.socket.destroyed) break; // connection_aborted()
        await sleep(2000);
      }
      res.end();
      throw new ctx.HttpSent();
    }

    default:
      Response.error('未知 action: ' + action, 400, 400);
  }
};