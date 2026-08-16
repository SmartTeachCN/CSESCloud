<?php
/**
 * CSES Cloud 通用 REST 设备控制 API (v1)
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

require_once __DIR__ . '/../lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// 获取实例
$instanceUid = trim($_GET['instance_uid'] ?? '');
$instanceId = null;

// device_register 支持无 instance_uid 模式：通过注册码查找实例
if ($method === 'POST' && $action === 'device_register') {
    $enrollmentCode = trim($body['enrollmentCode'] ?? '');
    if ($enrollmentCode !== '') {
        $codeHash = hash('sha256', $enrollmentCode);
        $code = DB::one(
            "SELECT ec.*, i.instance_uid FROM ea2_enrollment_codes ec
             JOIN instances i ON ec.instance_id = i.id
             WHERE ec.code_hash = ?",
            [$codeHash]
        );
        if ($code) {
            $instanceId = (int)$code['instance_id'];
            $instanceUid = $code['instance_uid'];
        }
    }
    if (!$instanceId) {
        // 回退：没有注册码或注册码无效，尝试 instance_uid
        if ($instanceUid === '') {
            Response::error('缺少 instance_uid 参数或注册码无效');
        }
    }
}

if ($instanceId === null) {
    if ($instanceUid === '') {
        Response::error('缺少 instance_uid 参数');
    }
    $inst = DB::one("SELECT * FROM instances WHERE instance_uid = ?", [$instanceUid]);
    if (!$inst) {
        Response::error('实例不存在', 404, 404);
    }
    $instanceId = (int)$inst['id'];
}

// ===== 公开操作 =====

// 设备注册（v1 协议）
if ($method === 'POST' && $action === 'device_register') {
    _handleDeviceRegister($instanceId);
}

// ===== 需要设备凭证认证的操作 =====

// 所有需要认证的操作在进入前验证
$needsAuth = [
    'device_list', 'device_get', 'device_unregister',
    'device_update_state', 'command_poll', 'command_report',
    'device_errors',
    'command_list', 'command_get', 'enrollment_list',
    'events_stream'
];

if (in_array($action, $needsAuth, true)) {
    // 管理类操作需要实例权限
    $mgmtOps = ['device_list', 'device_get', 'device_unregister', 'command_list', 'command_get', 'enrollment_list'];
    if (!in_array($action, $mgmtOps, true)) {
        // 客户端操作：验证设备凭证
        $deviceId = _getDeviceIdFromRequest($body);
        $credential = _getCredentialFromRequest($body);
        if ($deviceId !== '' || $credential !== '') {
            _verifyDeviceCredential($instanceId, $deviceId, $credential);
        }
    }
}

// 管理类操作需要实例管理权限
$needsAdmin = ['device_list', 'device_get', 'device_unregister', 'enrollment_create', 'enrollment_revoke',
    'command_create', 'command_list', 'command_get', 'exam_config_list', 'events_stream'];

if (in_array($action, $needsAdmin, true)) {
    Auth::requireLogin();
    $instAdmin = DB::one(
        "SELECT * FROM instance_members WHERE instance_id = ? AND user_id = ? AND role IN ('owner','admin')",
        [$instanceId, Auth::userId()]
    );
    if (!$instAdmin && !Auth::isSuperAdmin()) {
        Response::error('需要实例管理权限', 403, 403);
    }
}

// ===== 路由处理 =====
switch ($action) {
    // ===== 设备管理 =====
    case 'device_list':
        $rows = DB::all(
            "SELECT device_id, display_name, platform, architecture, app_version,
                    lifecycle_status, labels, last_seen_at, enrolled_at, created_at
             FROM ea2_devices WHERE instance_id = ? ORDER BY enrolled_at DESC",
            [$instanceId]
        );
        foreach ($rows as &$r) {
            $r['labels'] = json_decode($r['labels'] ?? '[]', true);
        }
        Response::success($rows);

    case 'device_get':
        $deviceId = $body['deviceId'] ?? ($body['device_id'] ?? '');
        if ($deviceId === '') Response::error('缺少 deviceId');
        $device = DB::one(
            "SELECT device_id, display_name, platform, architecture, app_version,
                    lifecycle_status, labels, last_seen_at, last_reported_state, enrolled_at, created_at
             FROM ea2_devices WHERE instance_id = ? AND device_id = ?",
            [$instanceId, $deviceId]
        );
        if (!$device) Response::error('设备不存在');
        $device['labels'] = json_decode($device['labels'] ?? '[]', true);
        $device['last_reported_state'] = json_decode($device['last_reported_state'] ?? '{}', true);
        Response::success($device);

    case 'device_unregister':
        $deviceId = $body['deviceId'] ?? ($body['device_id'] ?? '');
        if ($deviceId === '') Response::error('缺少 deviceId');
        DB::update('ea2_devices', [
            'lifecycle_status' => 'revoked',
            'updated_at' => date('Y-m-d H:i:s'),
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        Response::success(null, '设备已注销');

    case 'device_update_state':
        $deviceId = $body['deviceId'] ?? ($body['device_id'] ?? '');
        $state = $body['state'] ?? [];
        $now = date('Y-m-d H:i:s');
        DB::update('ea2_devices', [
            'last_seen_at' => $now,
            'last_reported_state' => is_array($state) ? json_encode($state, JSON_UNESCAPED_UNICODE) : $state,
            'updated_at' => $now,
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        Response::success(['ok' => true]);

    // ===== 注册码管理 =====
    case 'enrollment_create':
        $maxUses = max(1, (int)($body['max_uses'] ?? 1));
        $validityHours = max(1, (int)($body['validity_hours'] ?? 24));
        $label = trim($body['label'] ?? '');
        $code = 'EA2-' . _randomCode();
        $codeHash = hash('sha256', $code);
        $now = date('Y-m-d H:i:s');
        DB::insert('ea2_enrollment_codes', [
            'instance_id' => $instanceId,
            'code_hash' => $codeHash,
            'max_uses' => $maxUses,
            'used_count' => 0,
            'label' => $label,
            'expires_at' => date('Y-m-d H:i:s', time() + $validityHours * 3600),
            'created_at' => $now,
        ]);
        Response::success(['code' => $code, 'max_uses' => $maxUses, 'validity_hours' => $validityHours], '注册码已创建');

    case 'enrollment_list':
        $rows = DB::all(
            "SELECT id, code_hash, label, max_uses, used_count, revoked_at, expires_at, created_at
             FROM ea2_enrollment_codes WHERE instance_id = ? ORDER BY created_at DESC",
            [$instanceId]
        );
        // 不返回完整哈希，只返回掩码
        foreach ($rows as &$r) {
            $r['code_masked'] = 'EA2-****' . substr($r['code_hash'], -4);
            unset($r['code_hash']);
        }
        Response::success($rows);

    case 'enrollment_revoke':
        $id = (int)($body['id'] ?? 0);
        DB::update('ea2_enrollment_codes', ['revoked_at' => date('Y-m-d H:i:s')], 'id = ? AND instance_id = ?', [$id, $instanceId]);
        Response::success(null, '注册码已吊销');

    // ===== 命令管理 =====
    case 'command_create':
        $commandType = trim($body['command_type'] ?? '');
        $payload = $body['payload'] ?? [];
        $targetDeviceId = $body['device_id'] ?? null; // null = 广播
        $expiresMinutes = (int)($body['expires_minutes'] ?? 5);
        if ($commandType === '') Response::error('缺少 command_type');
        $now = date('Y-m-d H:i:s');
        $expiresAt = date('Y-m-d H:i:s', time() + $expiresMinutes * 60);

        if ($targetDeviceId) {
            // 单设备命令
            DB::insert('ea2_commands', [
                'command_id' => Helpers::uuid(),
                'instance_id' => $instanceId,
                'device_id' => $targetDeviceId,
                'command_type' => $commandType,
                'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
                'status' => 'pending',
                'issued_at' => $now,
                'expires_at' => $expiresAt,
                'created_at' => $now,
            ]);
        } else {
            // 广播命令：为所有活跃设备创建
            $devices = DB::all(
                "SELECT device_id FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active'",
                [$instanceId]
            );
            foreach ($devices as $dev) {
                DB::insert('ea2_commands', [
                    'command_id' => Helpers::uuid(),
                    'instance_id' => $instanceId,
                    'device_id' => $dev['device_id'],
                    'command_type' => $commandType,
                    'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
                    'status' => 'pending',
                    'issued_at' => $now,
                    'expires_at' => $expiresAt,
                    'created_at' => $now,
                ]);
            }
        }
        Response::success(null, '命令已下发');

    case 'command_poll':
        // 官方协议：返回 server.command 格式
        $deviceId = $body['deviceId'] ?? ($body['device_id'] ?? '');
        $now = date('Y-m-d H:i:s');
        $commands = DB::all(
            "SELECT command_id, command_type, payload, issued_at, expires_at
             FROM ea2_commands
             WHERE instance_id = ? AND device_id = ? AND status = 'pending'
               AND expires_at > ?
             ORDER BY issued_at ASC
             LIMIT 20",
            [$instanceId, $deviceId, $now]
        );
        $result = array_map(function ($cmd) {
            $payload = json_decode($cmd['payload'], true) ?: [];
            return [
                'commandId' => $cmd['command_id'],
                'issuedAt' => date('c', strtotime($cmd['issued_at'])),
                'expiresAt' => date('c', strtotime($cmd['expires_at'])),
                'command' => [
                    'type' => $cmd['command_type'],
                    'payload' => $payload,
                ],
            ];
        }, $commands);
        Response::success($result, 'ok');

    case 'command_report':
        $commandId = $body['commandId'] ?? ($body['command_id'] ?? '');
        $status = $body['status'] ?? 'succeeded';
        $error = $body['error'] ?? null;
        $state = $body['state'] ?? null;
        $occurredAt = $body['occurredAt'] ?? ($body['occurred_at'] ?? date('c'));
        if ($commandId === '') Response::error('缺少 commandId');

        $updates = [
            'status' => 'completed',
            'result_status' => $status,
            'result_error' => $error ? json_encode($error, JSON_UNESCAPED_UNICODE) : null,
            'result_state' => $state ? json_encode($state, JSON_UNESCAPED_UNICODE) : null,
            'result_occurred_at' => $occurredAt,
        ];
        DB::update('ea2_commands', $updates, 'command_id = ? AND instance_id = ?', [$commandId, $instanceId]);
        Response::success(['ok' => true]);

    case 'command_list':
        $filterDeviceId = $_GET['device_id'] ?? '';
        $filterStatus = $_GET['status'] ?? '';
        $sql = "SELECT * FROM ea2_commands WHERE instance_id = ?";
        $params = [$instanceId];
        if ($filterDeviceId) {
            $sql .= " AND device_id = ?";
            $params[] = $filterDeviceId;
        }
        if ($filterStatus) {
            $sql .= " AND status = ?";
            $params[] = $filterStatus;
        }
        $sql .= " ORDER BY issued_at DESC LIMIT 100";
        $rows = DB::all($sql, $params);
        foreach ($rows as &$r) {
            $r['payload'] = json_decode($r['payload'] ?? '{}', true);
            $r['result_error'] = json_decode($r['result_error'] ?? 'null', true);
            $r['result_state'] = json_decode($r['result_state'] ?? 'null', true);
        }
        Response::success($rows);

    case 'command_get':
        $commandId = $body['commandId'] ?? ($body['command_id'] ?? '');
        $cmd = DB::one("SELECT * FROM ea2_commands WHERE command_id = ? AND instance_id = ?", [$commandId, $instanceId]);
        if (!$cmd) Response::error('命令不存在');
        $cmd['payload'] = json_decode($cmd['payload'] ?? '{}', true);
        $cmd['result_error'] = json_decode($cmd['result_error'] ?? 'null', true);
        $cmd['result_state'] = json_decode($cmd['result_state'] ?? 'null', true);
        Response::success($cmd);

    // ===== 设备错误上报 (v1) =====
    case 'device_errors':
        $deviceId = _getDeviceIdFromRequest($body);
        $source = $body['source'] ?? '';
        $message = $body['message'] ?? '';
        $severity = $body['severity'] ?? 'warning';
        if (!$source || !$message) Response::error('source 和 message 不能为空');
        $now = date('Y-m-d H:i:s');
        DB::insert('ea2_commands', [
            'command_id' => Helpers::uuid(),
            'instance_id' => $instanceId,
            'device_id' => $deviceId,
            'command_type' => 'device.error',
            'payload' => json_encode([
                'severity' => $severity,
                'source' => $source,
                'code' => $body['code'] ?? '',
                'message' => $message,
                'stack' => $body['stack'] ?? null,
                'context' => $body['context'] ?? null,
                'occurredAt' => $body['occurredAt'] ?? date('c'),
            ], JSON_UNESCAPED_UNICODE),
            'status' => 'succeeded',
            'result_status' => 'succeeded',
            'result_occurred_at' => $body['occurredAt'] ?? date('c'),
            'issued_at' => $now,
            'expires_at' => date('Y-m-d H:i:s', time() + 86400),
            'created_at' => $now,
        ]);
        DB::update('ea2_devices', [
            'last_seen_at' => $now,
            'updated_at' => $now,
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        Response::success(['ok' => true]);

    // ===== 考试配置列表 =====
    case 'exam_config_list':
        $rows = DB::all(
            "SELECT id, name, file_path, file_size, created_at, updated_at
             FROM cloud_files WHERE instance_id = ? AND file_name LIKE '%.ea2' ORDER BY updated_at DESC",
            [$instanceId]
        );
        Response::success($rows);

    // ===== SSE 事件流 =====
    case 'events_stream':
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('Connection: keep-alive');
        header('X-Accel-Buffering: no');
        while (ob_get_level() > 0) { @ob_end_clean(); }
        ob_implicit_flush(true);
        $lastId = 0;
        set_time_limit(0);
        while (true) {
            if (connection_aborted()) break;
            $rows = DB::all(
                "SELECT c.command_id, c.command_type, c.payload, c.issued_at, c.device_id,
                        d.display_name AS device_name
                 FROM ea2_commands c
                 LEFT JOIN ea2_devices d ON c.device_id = d.device_id AND c.instance_id = d.instance_id
                 WHERE c.instance_id = ? AND c.id > ?
                 ORDER BY c.id ASC LIMIT 10",
                [$instanceId, $lastId]
            );
            foreach ($rows as $row) {
                $lastId = max($lastId, (int)($row['id'] ?? 0));
                $payload = json_decode($row['payload'] ?? '{}', true);
                echo "id: {$row['command_id']}\n";
                echo "event: command\n";
                echo "data: " . json_encode([
                    'commandId' => $row['command_id'],
                    'commandType' => $row['command_type'],
                    'payload' => $payload,
                    'deviceId' => $row['device_id'],
                    'deviceName' => $row['device_name'],
                    'issuedAt' => date('c', strtotime($row['issued_at'])),
                ], JSON_UNESCAPED_UNICODE) . "\n\n";
                flush();
            }
            sleep(2);
        }
        exit;

    // ===== 设备注册（v1 协议） =====
    case 'device_register':
        // 已在前面处理
        break;

    default:
        Response::error('未知 action: ' . $action, 400, 400);
}

// ===== 设备注册处理函数 =====
function _handleDeviceRegister(int $instanceId): void {
    global $body;

    $enrollmentCode = trim($body['enrollmentCode'] ?? '');
    $displayName = trim($body['displayName'] ?? '');
    $platform = trim($body['platform'] ?? '');
    $architecture = trim($body['architecture'] ?? '');
    $appVersion = trim($body['appVersion'] ?? '');
    $protocolVersion = $body['protocolVersion'] ?? null;

    // 验证注册码
    if ($enrollmentCode === '') Response::error('缺少 enrollmentCode');
    if (!preg_match('/^EA2-[A-Za-z0-9_-]{16,128}$/', $enrollmentCode)) {
        Response::error('enrollmentCode 格式无效，需匹配 EA2-[A-Za-z0-9_-]{16,128}', 400, 400);
    }
    if ($displayName === '') Response::error('缺少 displayName');
    if (mb_strlen($displayName) > 120) Response::error('displayName 不能超过 120 个字符');
    $validPlatforms = ['win32', 'darwin', 'linux', 'openharmony'];
    if (!in_array($platform, $validPlatforms, true)) Response::error('platform 无效');
    $validArchs = ['x64', 'arm64'];
    if (!in_array($architecture, $validArchs, true)) Response::error('architecture 无效');
    if ($appVersion === '' || strlen($appVersion) > 64) Response::error('appVersion 无效');
    if ($protocolVersion !== 1) Response::error('protocolVersion 必须为 1');

    // 验证注册码
    $codeHash = hash('sha256', $enrollmentCode);
    $code = DB::one(
        "SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? AND code_hash = ?",
        [$instanceId, $codeHash]
    );
    if (!$code) Response::error('注册码无效', 401, 401);
    if ($code['revoked_at']) Response::error('注册码已被吊销', 401, 401);
    if ((int)$code['used_count'] >= (int)$code['max_uses']) Response::error('注册码已用完', 401, 401);
    if (strtotime($code['expires_at']) < time()) Response::error('注册码已过期', 401, 401);

    // 生成设备 ID 和凭证
    $deviceId = Helpers::uuid();
    $credential = _generateCredential();
    $credentialHash = hash('sha256', $credential);
    $now = date('Y-m-d H:i:s');

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

    DB::insert('ea2_device_credentials', [
        'device_id' => $deviceId,
        'credential_hash' => $credentialHash,
        'version' => 1,
        'issued_at' => $now,
    ]);

    DB::update('ea2_enrollment_codes', [
        'used_count' => (int)$code['used_count'] + 1,
    ], 'id = ?', [(int)$code['id']]);

    // 构造响应
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $baseUrl = $protocol . '://' . $host;
    $pollUrl = $baseUrl . '/api/control.php?instance_uid=' . urlencode($instanceUid) . '&action=command_poll';

    Response::success([
        'deviceId' => $deviceId,
        'credential' => $credential,
        'instanceUid' => $instanceUid,
        'websocketUrl' => $pollUrl,
        'protocolVersion' => 1,
    ]);
}

// ===== 辅助函数 =====

function _getDeviceIdFromRequest(array $body): string {
    $header = $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
    if ($header !== '') return trim($header);
    return $body['deviceId'] ?? ($body['device_id'] ?? '');
}

function _getCredentialFromRequest(array $body): string {
    $header = $_SERVER['HTTP_X_DEVICE_CREDENTIAL'] ?? '';
    if ($header !== '') return trim($header);
    return $body['credential'] ?? '';
}

function _verifyDeviceCredential(int $instanceId, string $deviceId, string $credential): void {
    if ($deviceId === '') Response::error('缺少 deviceId', 401, 401);
    if ($credential === '') Response::error('缺少 credential', 401, 401);

    $device = DB::one(
        "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
        [$instanceId, $deviceId]
    );
    if (!$device) Response::error('设备未注册或已吊销', 401, 401);

    $credHash = hash('sha256', $credential);
    $cred = DB::one(
        "SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL",
        [$deviceId, $credHash]
    );
    if (!$cred) Response::error('凭证无效', 401, 401);

    DB::update('ea2_device_credentials', ['last_used_at' => date('Y-m-d H:i:s')], 'id = ?', [(int)$cred['id']]);
}

function _generateCredential(): string {
    $bytes = random_bytes(48);
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function _randomCode(): string {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    $code = '';
    for ($i = 0; $i < 24; $i++) {
        $code .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $code;
}