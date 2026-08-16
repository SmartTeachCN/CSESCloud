<?php
/**
 * EA2 控制协议 v1 - 设备注册端点
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

require_once __DIR__ . '/../../lib/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('仅支持 POST 请求', 405, 405);
}

$instanceUid = trim($_GET['instance_uid'] ?? '');
if ($instanceUid === '') {
    Response::error('缺少 instance_uid 参数');
}

// 查找实例
$inst = DB::one("SELECT * FROM instances WHERE instance_uid = ?", [$instanceUid]);
if (!$inst) {
    Response::error('实例不存在', 404, 404);
}

$instanceId = (int)$inst['id'];
$body = Helpers::jsonBody();

// ===== 验证请求参数 =====
$enrollmentCode = trim($body['enrollmentCode'] ?? '');
$displayName = trim($body['displayName'] ?? '');
$platform = trim($body['platform'] ?? '');
$architecture = trim($body['architecture'] ?? '');
$appVersion = trim($body['appVersion'] ?? '');
$protocolVersion = $body['protocolVersion'] ?? null;

// 验证注册码（必需）
if ($enrollmentCode === '') {
    Response::error('缺少 enrollmentCode', 400, 400);
}
if (!preg_match('/^EA2-[A-Za-z0-9_-]{16,128}$/', $enrollmentCode)) {
    Response::error('enrollmentCode 格式无效，需匹配 EA2-[A-Za-z0-9_-]{16,128}', 400, 400);
}

// 验证 displayName
if ($displayName === '') {
    Response::error('缺少 displayName', 400, 400);
}
if (mb_strlen($displayName) > 120) {
    Response::error('displayName 不能超过 120 个字符', 400, 400);
}

// 验证 platform
$validPlatforms = ['win32', 'darwin', 'linux', 'openharmony'];
if (!in_array($platform, $validPlatforms, true)) {
    Response::error('platform 无效，需为: ' . implode(', ', $validPlatforms), 400, 400);
}

// 验证 architecture
$validArchs = ['x64', 'arm64'];
if (!in_array($architecture, $validArchs, true)) {
    Response::error('architecture 无效，需为: ' . implode(', ', $validArchs), 400, 400);
}

// 验证 appVersion
if ($appVersion === '' || strlen($appVersion) > 64) {
    Response::error('appVersion 无效', 400, 400);
}

// 验证 protocolVersion
if ($protocolVersion !== 1) {
    Response::error('protocolVersion 必须为 1', 400, 400);
}

// ===== 验证注册码 =====
$codeHash = hash('sha256', $enrollmentCode);
$code = DB::one(
    "SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? AND code_hash = ?",
    [$instanceId, $codeHash]
);
if (!$code) {
    Response::error('注册码无效', 401, 401);
}
if ($code['revoked_at']) {
    Response::error('注册码已被吊销', 401, 401);
}
if ((int)$code['used_count'] >= (int)$code['max_uses']) {
    Response::error('注册码已用完', 401, 401);
}
if (strtotime($code['expires_at']) < time()) {
    Response::error('注册码已过期', 401, 401);
}

// ===== 生成设备 ID 和凭证 =====
$deviceId = Helpers::uuid();
$credential = _generateCredential();
$credentialHash = hash('sha256', $credential);
$now = date('Y-m-d H:i:s');

// ===== 创建设备记录 =====
DB::insert('ea2_devices', [
    'instance_id' => $instanceId,
    'device_id' => $deviceId,
    'display_name' => $displayName,
    'platform' => $platform,
    'architecture' => $architecture,
    'app_version' => $appVersion,
    'protocol_version' => $protocolVersion,
    'lifecycle_status' => 'active',
    'labels' => json_encode([], JSON_UNESCAPED_UNICODE),
    'last_seen_at' => $now,
    'last_reported_state' => json_encode([], JSON_UNESCAPED_UNICODE),
    'enrolled_at' => $now,
    'created_at' => $now,
    'updated_at' => $now,
]);

// 存储凭证哈希
DB::insert('ea2_device_credentials', [
    'device_id' => $deviceId,
    'credential_hash' => $credentialHash,
    'version' => 1,
    'issued_at' => $now,
]);

// 更新注册码使用次数
DB::update('ea2_enrollment_codes', [
    'used_count' => (int)$code['used_count'] + 1,
], 'id = ?', [(int)$code['id']]);

// ===== 构造响应 =====
// 由于 PHP 不支持持久 WebSocket，websocketUrl 指向轮询端点
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$baseUrl = $protocol . '://' . $host;
$websocketUrl = $baseUrl . '/api/ea2-control.php?instance_uid=' . urlencode($instanceUid) . '&action=command_poll';

Response::success([
    'deviceId' => $deviceId,
    'credential' => $credential,
    'websocketUrl' => $websocketUrl,
    'protocolVersion' => 1,
]);

/**
 * 生成符合官方规范的凭证字符串
 * 长度 43-256 字符，使用 base64url 编码的随机字节
 */
function _generateCredential(): string {
    $bytes = random_bytes(48);
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}