/**
 * EA2 控制协议 v1 - 设备注册端点（NodeJS 版，1:1 复刻 api/v1/device-enrollments.php）
 *
 * 匹配 ExamAware2 官方集控协议：
 * POST /api/v1/device-enrollments?instance_uid={uid}
 *
 * 请求体：
 * {
 *   "enrollmentCode": "EA2-xxxxxxxxxxxx",  // 必需，模式 EA2-[A-Za-z0-9_-]{16,128}
 *   "displayName": "EA2-DeviceName",       // 必需
 *   "platform": "win32",                   // 必需: win32|darwin|linux|openharmony
 *   "architecture": "x64",                 // 必需: x64|arm64
 *   "appVersion": "2.0.0",                // 必需
 *   "protocolVersion": 1                   // 必需，固定为 1
 * }
 *
 * 响应：
 * {
 *   "code": 0,
 *   "data": {
 *     "deviceId": "uuid",
 *     "credential": "base64url-encoded-random",
 *     "websocketUrl": "ws://...",
 *     "protocolVersion": 1
 *   }
 * }
 */
const crypto = require('crypto');
const { nowStr, parseDate } = require('../../lib/response');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * 生成符合官方规范的凭证字符串
 * 长度 43-256 字符，使用 base64url 编码的随机字节
 */
function generateCredential() {
  const bytes = crypto.randomBytes(48);
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = async (ctx) => {
  const { req, DB, Response, Helpers, query, body } = ctx;

  if (req.method !== 'POST') {
    Response.error('仅支持 POST 请求', 405, 405);
  }

  const instanceUid = String(query.instance_uid ?? '').trim();
  if (instanceUid === '') {
    Response.error('缺少 instance_uid 参数');
  }

  // 查找实例
  const inst = DB.one('SELECT * FROM instances WHERE instance_uid = ?', [instanceUid]);
  if (!inst) {
    Response.error('实例不存在', 404, 404);
  }

  const instanceId = parseInt(inst.id, 10) || 0;

  // ===== 验证请求参数 =====
  const enrollmentCode = String(body.enrollmentCode ?? '').trim();
  const displayName = String(body.displayName ?? '').trim();
  const platform = String(body.platform ?? '').trim();
  const architecture = String(body.architecture ?? '').trim();
  const appVersion = String(body.appVersion ?? '').trim();
  const protocolVersion = body.protocolVersion ?? null;

  // 验证注册码（必需）
  if (enrollmentCode === '') {
    Response.error('缺少 enrollmentCode', 400, 400);
  }
  if (!/^EA2-[A-Za-z0-9_-]{16,128}$/.test(enrollmentCode)) {
    Response.error('enrollmentCode 格式无效，需匹配 EA2-[A-Za-z0-9_-]{16,128}', 400, 400);
  }

  // 验证 displayName
  if (displayName === '') {
    Response.error('缺少 displayName', 400, 400);
  }
  if ([...displayName].length > 120) {
    Response.error('displayName 不能超过 120 个字符', 400, 400);
  }

  // 验证 platform
  const validPlatforms = ['win32', 'darwin', 'linux', 'openharmony'];
  if (!validPlatforms.includes(platform)) {
    Response.error('platform 无效，需为: ' + validPlatforms.join(', '), 400, 400);
  }

  // 验证 architecture
  const validArchs = ['x64', 'arm64'];
  if (!validArchs.includes(architecture)) {
    Response.error('architecture 无效，需为: ' + validArchs.join(', '), 400, 400);
  }

  // 验证 appVersion
  if (appVersion === '' || appVersion.length > 64) {
    Response.error('appVersion 无效', 400, 400);
  }

  // 验证 protocolVersion
  if (protocolVersion !== 1) {
    Response.error('protocolVersion 必须为 1', 400, 400);
  }

  // ===== 验证注册码 =====
  const codeHash = sha256(enrollmentCode);
  const code = DB.one(
    'SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? AND code_hash = ?',
    [instanceId, codeHash]
  );
  if (!code) {
    Response.error('注册码无效', 401, 401);
  }
  if (code.revoked_at) {
    Response.error('注册码已被吊销', 401, 401);
  }
  if ((parseInt(code.used_count, 10) || 0) >= (parseInt(code.max_uses, 10) || 0)) {
    Response.error('注册码已用完', 401, 401);
  }
  if (parseDate(code.expires_at).getTime() < Date.now()) {
    Response.error('注册码已过期', 401, 401);
  }

  // ===== 生成设备 ID 和凭证 =====
  const deviceId = Helpers.uuid();
  const credential = generateCredential();
  const credentialHash = sha256(credential);
  const now = nowStr();

  // ===== 创建设备记录 =====
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

  // 存储凭证哈希
  DB.insert('ea2_device_credentials', {
    device_id: deviceId,
    credential_hash: credentialHash,
    version: 1,
    issued_at: now,
  });

  // 更新注册码使用次数
  DB.update('ea2_enrollment_codes', {
    used_count: (parseInt(code.used_count, 10) || 0) + 1,
  }, 'id = ?', [parseInt(code.id, 10) || 0]);

  // ===== 构造响应 =====
  // 由于 PHP 不支持持久 WebSocket，websocketUrl 指向轮询端点
  const protocol = req.secure ? 'https' : 'http';
  const host = req.headers.host ?? 'localhost';
  const baseUrl = protocol + '://' + host;
  const websocketUrl = baseUrl + '/api/rest-control.php?instance_uid=' + encodeURIComponent(instanceUid) + '&action=command_poll';

  Response.success({
    deviceId: deviceId,
    credential: credential,
    websocketUrl: websocketUrl,
    protocolVersion: 1,
  });
};
