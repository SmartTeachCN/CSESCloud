<?php
/**
 * EA2 控制服务器 API
 *
 * 基于 EA2 控制协议 v1，提供 REST API 进行设备管理、命令调度和考试配置下发。
 * 由于 PHP 限制无法运行持久 WebSocket，采用 REST + 轮询/SSE 模式间接集控。
 *
 * 路由：/api/ea2-control.php?instance_uid={uid}&action={action}
 *
 * 端点：
 *   === 设备管理 ===
 *   device_list              列出所有设备
 *   device_get                获取单个设备详情
 *   device_register          注册设备（生成 credential）
 *   device_unregister        注销设备
 *   device_update_state      更新设备状态
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

require_once __DIR__ . '/../lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$instanceUid = trim($_GET['instance_uid'] ?? '');
$action = trim($_GET['action'] ?? ($_POST['action'] ?? ''));

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

// ===== 路由 =====
switch ($action) {
    // ===== 设备管理 =====
    case 'device_list':
        $devices = DB::all(
            "SELECT * FROM ea2_devices WHERE instance_id = ? ORDER BY updated_at DESC",
            [$instanceId]
        );
        foreach ($devices as &$d) {
            $d['labels'] = json_decode($d['labels'] ?? '[]', true) ?: [];
            $d['last_reported_state'] = json_decode($d['last_reported_state'] ?? '{}', true) ?: [];
        }
        Response::success($devices);

    case 'device_get':
        $deviceId = $body['device_id'] ?? $_GET['device_id'] ?? '';
        if (!$deviceId) Response::error('缺少 device_id');
        $d = DB::one(
            "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ?",
            [$instanceId, $deviceId]
        );
        if (!$d) Response::error('设备不存在', 404, 404);
        $d['labels'] = json_decode($d['labels'] ?? '[]', true) ?: [];
        $d['last_reported_state'] = json_decode($d['last_reported_state'] ?? '{}', true) ?: [];
        Response::success($d);

    case 'device_register':
        // 模拟 EA2 设备注册流程
        $deviceId = $body['device_id'] ?? '';
        $displayName = $body['display_name'] ?? '';
        $platform = $body['platform'] ?? '';
        $architecture = $body['architecture'] ?? '';
        $appVersion = $body['app_version'] ?? '';
        $protocolVersion = $body['protocol_version'] ?? 1;
        $enrollmentCode = $body['enrollment_code'] ?? '';
        $capabilities = $body['capabilities'] ?? [];

        if (!$deviceId || !$displayName) {
            Response::error('device_id 和 display_name 不能为空');
        }

        // 验证注册码
        if ($enrollmentCode) {
            $codeHash = hash('sha256', $enrollmentCode);
            $code = DB::one(
                "SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? AND code_hash = ?",
                [$instanceId, $codeHash]
            );
            if (!$code) Response::error('注册码无效', 401, 401);
            if ($code['revoked_at']) Response::error('注册码已被吊销', 401, 401);
            if ($code['used_count'] >= $code['max_uses']) Response::error('注册码已用完', 401, 401);
            if (strtotime($code['expires_at']) < time()) Response::error('注册码已过期', 401, 401);
        }

        $now = date('Y-m-d H:i:s');
        $existing = DB::one("SELECT id FROM ea2_devices WHERE device_id = ?", [$deviceId]);

        if ($existing) {
            // 更新已有设备
            DB::update('ea2_devices', [
                'display_name' => $displayName,
                'platform' => $platform,
                'architecture' => $architecture,
                'app_version' => $appVersion,
                'protocol_version' => $protocolVersion,
                'lifecycle_status' => 'active',
                'last_seen_at' => $now,
                'last_reported_state' => json_encode($body['state'] ?? [], JSON_UNESCAPED_UNICODE),
                'updated_at' => $now,
            ], 'id = ?', [$existing['id']]);
        } else {
            DB::insert('ea2_devices', [
                'instance_id' => $instanceId,
                'device_id' => $deviceId,
                'display_name' => $displayName,
                'platform' => $platform,
                'architecture' => $architecture,
                'app_version' => $appVersion,
                'protocol_version' => $protocolVersion,
                'lifecycle_status' => 'active',
                'labels' => json_encode($body['labels'] ?? [], JSON_UNESCAPED_UNICODE),
                'last_seen_at' => $now,
                'last_reported_state' => json_encode($body['state'] ?? [], JSON_UNESCAPED_UNICODE),
                'enrolled_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // 生成凭证
        $credential = bin2hex(random_bytes(32));
        $credentialHash = hash('sha256', $credential);
        DB::insert('ea2_device_credentials', [
            'device_id' => $deviceId,
            'credential_hash' => $credentialHash,
            'version' => 1,
            'issued_at' => $now,
        ]);

        // 更新注册码使用次数
        if ($enrollmentCode) {
            DB::update('ea2_enrollment_codes', [
                'used_count' => $code['used_count'] + 1,
            ], 'id = ?', [$code['id']]);
        }

        Response::success([
            'device_id' => $deviceId,
            'credential' => $credential,
            'websocket_url' => '/api/ea2-control.php?instance_uid=' . $instanceUid . '&action=command_poll',
            'protocol_version' => 1,
        ]);

    case 'device_unregister':
        $deviceId = $body['device_id'] ?? '';
        if (!$deviceId) Response::error('缺少 device_id');
        DB::update('ea2_devices', [
            'lifecycle_status' => 'revoked',
            'updated_at' => date('Y-m-d H:i:s'),
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        // 吊销凭证
        DB::update('ea2_device_credentials', [
            'revoked_at' => date('Y-m-d H:i:s'),
        ], 'device_id = ?', [$deviceId]);
        Response::success(['ok' => true], '设备已注销');

    case 'device_update_state':
        $deviceId = $body['device_id'] ?? '';
        if (!$deviceId) Response::error('缺少 device_id');
        $now = date('Y-m-d H:i:s');
        DB::update('ea2_devices', [
            'last_seen_at' => $now,
            'last_reported_state' => json_encode($body['state'] ?? [], JSON_UNESCAPED_UNICODE),
            'updated_at' => $now,
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);
        Response::success(['ok' => true]);

    // ===== 注册码管理 =====
    case 'enrollment_create':
        $displayName = $body['display_name'] ?? '';
        $maxUses = (int)($body['max_uses'] ?? 1);
        $expiresIn = (int)($body['expires_in_seconds'] ?? 86400);
        $rawCode = 'EA2-' . bin2hex(random_bytes(16));
        $codeHash = hash('sha256', $rawCode);
        $now = date('Y-m-d H:i:s');
        DB::insert('ea2_enrollment_codes', [
            'instance_id' => $instanceId,
            'code_hash' => $codeHash,
            'display_name' => $displayName,
            'max_uses' => $maxUses,
            'used_count' => 0,
            'expires_at' => date('Y-m-d H:i:s', time() + $expiresIn),
            'created_at' => $now,
        ]);
        Response::success([
            'code' => $rawCode,
            'display_name' => $displayName,
            'max_uses' => $maxUses,
            'expires_at' => date('Y-m-d H:i:s', time() + $expiresIn),
        ], '注册码已创建');

    case 'enrollment_list':
        $codes = DB::all(
            "SELECT * FROM ea2_enrollment_codes WHERE instance_id = ? ORDER BY created_at DESC",
            [$instanceId]
        );
        Response::success($codes);

    case 'enrollment_revoke':
        $codeId = $body['id'] ?? '';
        if (!$codeId) Response::error('缺少 id');
        DB::update('ea2_enrollment_codes', [
            'revoked_at' => date('Y-m-d H:i:s'),
        ], 'id = ? AND instance_id = ?', [$codeId, $instanceId]);
        Response::success(['ok' => true], '注册码已吊销');

    // ===== 命令管理 =====
    case 'command_create':
        $commandType = $body['command_type'] ?? '';
        $payload = $body['payload'] ?? [];
        $deviceId = $body['device_id'] ?? null; // null = 广播
        $expiresIn = (int)($body['expires_in_seconds'] ?? 300);

        if (!$commandType || empty($payload)) {
            Response::error('command_type 和 payload 不能为空');
        }

        $now = date('Y-m-d H:i:s');
        $commandId = Helpers::uuid();

        if ($deviceId) {
            // 单设备命令
            DB::insert('ea2_commands', [
                'command_id' => $commandId,
                'instance_id' => $instanceId,
                'device_id' => $deviceId,
                'command_type' => $commandType,
                'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
                'status' => 'pending',
                'issued_at' => $now,
                'expires_at' => date('Y-m-d H:i:s', time() + $expiresIn),
                'created_at' => $now,
            ]);
        } else {
            // 广播：为每个活跃设备创建命令
            $devices = DB::all(
                "SELECT device_id FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active'",
                [$instanceId]
            );
            foreach ($devices as $d) {
                DB::insert('ea2_commands', [
                    'command_id' => Helpers::uuid(),
                    'instance_id' => $instanceId,
                    'device_id' => $d['device_id'],
                    'command_type' => $commandType,
                    'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
                    'status' => 'pending',
                    'issued_at' => $now,
                    'expires_at' => date('Y-m-d H:i:s', time() + $expiresIn),
                    'created_at' => $now,
                ]);
            }
            $commandId = 'broadcast';
        }

        Response::success([
            'command_id' => $commandId,
            'command_type' => $commandType,
            'issued_at' => $now,
            'expires_at' => date('Y-m-d H:i:s', time() + $expiresIn),
        ], '命令已创建');

    case 'command_poll':
        // 设备轮询待执行命令
        $deviceId = $body['device_id'] ?? $_GET['device_id'] ?? '';
        $credential = $body['credential'] ?? $_GET['credential'] ?? '';

        if (!$deviceId) Response::error('缺少 device_id', 401, 401);

        // 验证凭证
        $device = DB::one(
            "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
            [$instanceId, $deviceId]
        );
        if (!$device) Response::error('设备未注册或已吊销', 401, 401);

        if ($credential) {
            $credHash = hash('sha256', $credential);
            $cred = DB::one(
                "SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL",
                [$deviceId, $credHash]
            );
            if (!$cred) Response::error('凭证无效', 401, 401);
            // 更新最后使用时间
            DB::update('ea2_device_credentials', ['last_used_at' => date('Y-m-d H:i:s')], 'id = ?', [$cred['id']]);
        }

        // 获取待执行命令
        $now = date('Y-m-d H:i:s');
        $commands = DB::all(
            "SELECT * FROM ea2_commands 
             WHERE instance_id = ? AND device_id = ? AND status = 'pending'
             AND expires_at > ?
             ORDER BY created_at ASC LIMIT 10",
            [$instanceId, $deviceId, $now]
        );

        // 标记为已发送
        foreach ($commands as $cmd) {
            DB::update('ea2_commands', ['status' => 'sent'], 'id = ?', [$cmd['id']]);
        }

        // 更新设备最后在线时间
        DB::update('ea2_devices', [
            'last_seen_at' => $now,
            'updated_at' => $now,
        ], 'id = ?', [$device['id']]);

        // 返回官方协议格式: server.command 消息数组
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
        // 支持官方协议格式 (commandId) 和旧格式 (command_id)
        $commandId = $body['commandId'] ?? ($body['command_id'] ?? '');
        $status = $body['status'] ?? 'succeeded';
        $error = $body['error'] ?? null;
        $state = $body['state'] ?? null;
        $occurredAt = $body['occurredAt'] ?? ($body['occurred_at'] ?? date('c'));

        if (!$commandId) Response::error('缺少 command_id');

        DB::update('ea2_commands', [
            'status' => $status,
            'result_status' => $status,
            'result_error' => $error ? json_encode($error, JSON_UNESCAPED_UNICODE) : null,
            'result_occurred_at' => $occurredAt,
            'result_state' => $state ? json_encode($state, JSON_UNESCAPED_UNICODE) : null,
        ], 'command_id = ?', [$commandId]);

        Response::success(['ok' => true], '结果已记录');

    case 'command_list':
        $deviceId = $body['device_id'] ?? $_GET['device_id'] ?? '';
        $statusFilter = $body['status'] ?? $_GET['status'] ?? '';

        $where = 'instance_id = ?';
        $params = [$instanceId];
        if ($deviceId) {
            $where .= ' AND device_id = ?';
            $params[] = $deviceId;
        }
        if ($statusFilter) {
            $where .= ' AND status = ?';
            $params[] = $statusFilter;
        }

        $commands = DB::all(
            "SELECT * FROM ea2_commands WHERE {$where} ORDER BY created_at DESC LIMIT 100",
            $params
        );
        foreach ($commands as &$cmd) {
            $cmd['payload'] = json_decode($cmd['payload'], true) ?: [];
            $cmd['result_error'] = json_decode($cmd['result_error'] ?? 'null', true);
            $cmd['result_state'] = json_decode($cmd['result_state'] ?? 'null', true);
        }
        Response::success($commands);

    case 'command_get':
        $commandId = $body['command_id'] ?? $_GET['command_id'] ?? '';
        if (!$commandId) Response::error('缺少 command_id');
        $cmd = DB::one("SELECT * FROM ea2_commands WHERE command_id = ?", [$commandId]);
        if (!$cmd) Response::error('命令不存在', 404, 404);
        $cmd['payload'] = json_decode($cmd['payload'], true) ?: [];
        $cmd['result_error'] = json_decode($cmd['result_error'] ?? 'null', true);
        $cmd['result_state'] = json_decode($cmd['result_state'] ?? 'null', true);
        Response::success($cmd);

    // ===== 考试配置 =====
    case 'exam_config_deploy':
        $examConfigId = $body['exam_config_id'] ?? '';
        $deviceIds = $body['device_ids'] ?? []; // 空 = 所有设备

        if (!$examConfigId) {
            Response::error('缺少 exam_config_id');
        }

        // 从 .ea2 文件读取考试配置
        $fileName = $examConfigId;
        if (!str_ends_with($fileName, '.ea2')) {
            $fileName .= '.ea2';
        }
        $ea2File = DB::one(
            "SELECT * FROM cloud_files WHERE instance_id = ? AND file_type = 'ea2' AND name = ?",
            [$instanceId, $fileName]
        );
        if (!$ea2File) {
            // 尝试按 id 查找
            $ea2File = DB::one(
                "SELECT * FROM cloud_files WHERE instance_id = ? AND id = ?",
                [$instanceId, (int)$examConfigId]
            );
        }
        if (!$ea2File) {
            Response::error('考试配置文件不存在', 404, 404);
        }

        $examConfig = json_decode($ea2File['content'], true);
        if (!$examConfig) {
            Response::error('考试配置 JSON 解析失败', 400, 400);
        }

        $now = date('Y-m-d H:i:s');
        $deploymentId = Helpers::uuid();

        // 获取目标设备
        if (empty($deviceIds)) {
            $devices = DB::all(
                "SELECT device_id FROM ea2_devices WHERE instance_id = ? AND lifecycle_status = 'active'",
                [$instanceId]
            );
            $deviceIds = array_column($devices, 'device_id');
        }

        if (empty($deviceIds)) {
            Response::error('没有可用的活跃设备');
        }

        // 为每个设备创建 exam-config.prepare 命令
        foreach ($deviceIds as $did) {
            DB::insert('ea2_commands', [
                'command_id' => Helpers::uuid(),
                'instance_id' => $instanceId,
                'device_id' => $did,
                'command_type' => 'exam-config.prepare',
                'payload' => json_encode([
                    'deployment_id' => $deploymentId,
                    'exam_config_id' => (string)$ea2File['id'],
                    'exam_config_version_id' => $deploymentId,
                    'artifact' => [
                        'url' => '/api/instance-files.php?action=download&id=' . $ea2File['id'],
                        'media_type' => 'application/vnd.examaware.exam-config+json',
                        'size_bytes' => (int)($ea2File['file_size'] ?? 0),
                        'sha256' => hash('sha256', $ea2File['content']),
                        'expires_at' => date('c', time() + 3600),
                    ],
                ], JSON_UNESCAPED_UNICODE),
                'status' => 'pending',
                'issued_at' => $now,
                'expires_at' => date('Y-m-d H:i:s', time() + 3600),
                'created_at' => $now,
            ]);
        }

        Response::success([
            'deployment_id' => $deploymentId,
            'device_count' => count($deviceIds),
            'exam_name' => $examConfig['examName'] ?? '未命名考试',
        ], '考试配置已部署');

    case 'exam_config_list':
        // 返回所有 .ea2 文件作为可部署的考试配置
        $files = DB::all(
            "SELECT * FROM cloud_files WHERE instance_id = ? AND file_type = 'ea2' ORDER BY updated_at DESC",
            [$instanceId]
        );
        $result = array_map(function ($f) {
            $config = json_decode($f['content'] ?? '{}', true) ?: [];
            return [
                'id' => $f['id'],
                'name' => $f['name'],
                'exam_name' => $config['examName'] ?? '未命名考试',
                'exam_infos_count' => count($config['examInfos'] ?? []),
                'file_size' => $f['file_size'],
                'updated_at' => $f['updated_at'],
            ];
        }, $files);
        Response::success($result);

    // ===== 设备错误上报 (v1) =====
    case 'device_errors':
        // 官方协议: POST /api/v1/device-errors
        // 认证方式: x-device-id + x-device-credential 请求头
        $deviceId = _getDeviceIdFromRequest($body);
        $credential = _getCredentialFromRequest($body);
        _verifyDeviceCredential($instanceId, $deviceId, $credential);

        $severity = $body['severity'] ?? 'warning';
        $source = $body['source'] ?? '';
        $errorCode = $body['code'] ?? '';
        $message = $body['message'] ?? '';
        $stack = $body['stack'] ?? null;
        $context = $body['context'] ?? null;
        $occurredAt = $body['occurredAt'] ?? date('c');

        if (!$source || !$message) {
            Response::error('source 和 message 不能为空', 400, 400);
        }

        $validSeverities = ['warning', 'error', 'fatal'];
        if (!in_array($severity, $validSeverities, true)) {
            $severity = 'warning';
        }

        // 存储错误报告（可扩展：写入日志表或文件）
        $now = date('Y-m-d H:i:s');
        DB::insert('ea2_commands', [
            'command_id' => Helpers::uuid(),
            'instance_id' => $instanceId,
            'device_id' => $deviceId,
            'command_type' => 'device.error',
            'payload' => json_encode([
                'severity' => $severity,
                'source' => $source,
                'code' => $errorCode,
                'message' => $message,
                'stack' => $stack,
                'context' => $context,
                'occurredAt' => $occurredAt,
            ], JSON_UNESCAPED_UNICODE),
            'status' => 'succeeded',
            'result_status' => 'succeeded',
            'result_occurred_at' => $occurredAt,
            'issued_at' => $now,
            'expires_at' => date('Y-m-d H:i:s', time() + 86400),
            'created_at' => $now,
        ]);

        // 更新设备最后在线时间
        DB::update('ea2_devices', [
            'last_seen_at' => $now,
            'updated_at' => $now,
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);

        Response::success(['ok' => true]);

    // ===== 监考呼叫 (v1) =====
    case 'proctor_calls':
        // 官方协议: POST /api/v1/proctor-calls
        $deviceId = _getDeviceIdFromRequest($body);
        $credential = _getCredentialFromRequest($body);
        _verifyDeviceCredential($instanceId, $deviceId, $credential);

        $occurredAt = $body['occurredAt'] ?? date('c');
        $roomNumber = $body['roomNumber'] ?? '';
        $msg = $body['message'] ?? '';

        $now = date('Y-m-d H:i:s');
        DB::insert('ea2_commands', [
            'command_id' => Helpers::uuid(),
            'instance_id' => $instanceId,
            'device_id' => $deviceId,
            'command_type' => 'proctor.call',
            'payload' => json_encode([
                'occurredAt' => $occurredAt,
                'roomNumber' => $roomNumber,
                'message' => $msg,
            ], JSON_UNESCAPED_UNICODE),
            'status' => 'succeeded',
            'result_status' => 'succeeded',
            'result_occurred_at' => $occurredAt,
            'issued_at' => $now,
            'expires_at' => date('Y-m-d H:i:s', time() + 86400),
            'created_at' => $now,
        ]);

        DB::update('ea2_devices', [
            'last_seen_at' => $now,
            'updated_at' => $now,
        ], 'instance_id = ? AND device_id = ?', [$instanceId, $deviceId]);

        Response::success(['ok' => true]);

    // ===== 实时事件 =====
    case 'events_stream':
        // SSE 事件流
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('Connection: keep-alive');
        header('X-Accel-Buffering: no');

        while (ob_get_level() > 0) { @ob_end_clean(); }
        ob_implicit_flush(true);

        $lastCommandId = 0;
        $lastDeviceId = 0;

        while (true) {
            // 检查新命令
            $newCommands = DB::all(
                "SELECT * FROM ea2_commands WHERE instance_id = ? AND id > ? ORDER BY id ASC LIMIT 20",
                [$instanceId, $lastCommandId]
            );
            foreach ($newCommands as $cmd) {
                $lastCommandId = max($lastCommandId, (int)$cmd['id']);
                $cmd['payload'] = json_decode($cmd['payload'], true) ?: [];
                echo "event: command_update\n";
                echo "data: " . json_encode($cmd, JSON_UNESCAPED_UNICODE) . "\n\n";
                flush();
            }

            // 检查设备状态变化
            $newDevices = DB::all(
                "SELECT * FROM ea2_devices WHERE instance_id = ? AND id > ? ORDER BY id ASC LIMIT 20",
                [$instanceId, $lastDeviceId]
            );
            foreach ($newDevices as $d) {
                $lastDeviceId = max($lastDeviceId, (int)$d['id']);
                $d['labels'] = json_decode($d['labels'] ?? '[]', true) ?: [];
                echo "event: device_update\n";
                echo "data: " . json_encode($d, JSON_UNESCAPED_UNICODE) . "\n\n";
                flush();
            }

            // 发送心跳
            echo "event: heartbeat\n";
            echo "data: " . json_encode(['time' => date('c')]) . "\n\n";
            flush();

            if (connection_aborted()) break;
            sleep(2);
        }
        exit;

    default:
        Response::error('未知 action: ' . $action, 400, 400);
}

// ===== 辅助函数 =====

/**
 * 从请求中获取 device_id（支持官方 x-device-id 请求头和 body 参数）
 */
function _getDeviceIdFromRequest(array $body): string {
    $header = $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
    if ($header !== '') return trim($header);
    return $body['deviceId'] ?? ($body['device_id'] ?? '');
}

/**
 * 从请求中获取 credential（支持官方 x-device-credential 请求头和 body 参数）
 */
function _getCredentialFromRequest(array $body): string {
    $header = $_SERVER['HTTP_X_DEVICE_CREDENTIAL'] ?? '';
    if ($header !== '') return trim($header);
    return $body['credential'] ?? '';
}

/**
 * 验证设备凭证
 */
function _verifyDeviceCredential(int $instanceId, string $deviceId, string $credential): void {
    if ($deviceId === '') {
        Response::error('缺少 deviceId', 401, 401);
    }
    if ($credential === '') {
        Response::error('缺少 credential', 401, 401);
    }

    $device = DB::one(
        "SELECT * FROM ea2_devices WHERE instance_id = ? AND device_id = ? AND lifecycle_status = 'active'",
        [$instanceId, $deviceId]
    );
    if (!$device) {
        Response::error('设备未注册或已吊销', 401, 401);
    }

    $credHash = hash('sha256', $credential);
    $cred = DB::one(
        "SELECT * FROM ea2_device_credentials WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL",
        [$deviceId, $credHash]
    );
    if (!$cred) {
        Response::error('凭证无效', 401, 401);
    }

    // 更新最后使用时间
    DB::update('ea2_device_credentials', ['last_used_at' => date('Y-m-d H:i:s')], 'id = ?', [(int)$cred['id']]);
}