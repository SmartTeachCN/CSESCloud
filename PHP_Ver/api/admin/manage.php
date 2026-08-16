<?php
/**
 * 管理后台 API
 * 仅临时管理员或最高管理员可访问
 *
 * 操作：
 *  - GET  action=users                    列出所有用户
 *  - GET  action=config                   获取服务器配置状态
 *  - POST action=set-super-admin          设置用户为最高管理员
 *  - POST action=set-role                 设置用户角色
 *  - POST action=toggle-temp-admin        启用/禁用临时管理员模式
 *  - POST action=reset-password           重置用户密码
 *  - GET  action=schools                 列出所有学校
 *  - POST action=create-notification      创建通知（系统管理员）
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireLogin();

if (!Auth::isSuperAdmin()) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['code' => 403, 'message' => '仅最高管理员可访问', 'data' => null]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== 列出所有用户 =====
if ($method === 'GET' && $action === 'users') {
    $users = Auth::listAllUsers();
    Response::success($users);
}

// ===== 获取服务器配置 =====
if ($method === 'GET' && $action === 'config') {
    $config = Auth::serverConfig();
    $ta = $config['temp_admin'] ?? [];
    Response::success([
        'temp_admin_enabled' => !empty($ta['enabled']),
        'temp_admin_username' => $ta['username'] ?? '',
    ]);
}

// ===== 设置最高管理员 =====
if ($method === 'POST' && $action === 'set-super-admin') {
    $userId = (int)($body['user_id'] ?? 0);
    $isSuper = !empty($body['is_super_admin']);
    if (!$userId) Response::error('缺少用户 ID');
    $ok = Auth::setSuperAdmin($userId, $isSuper);
    if (!$ok) Response::error('操作失败');
    Auth::logAudit(0, 0, 'set_super_admin',
        ($isSuper ? '授予' : '撤销') . "最高管理员: user_id={$userId}",
        'success');
    Response::success(['ok' => true]);
}

// ===== 设置用户角色 =====
if ($method === 'POST' && $action === 'set-role') {
    $userId = (int)($body['user_id'] ?? 0);
    $role = trim($body['role'] ?? '');
    if (!$userId || !$role) Response::error('缺少参数');
    $ok = Auth::setUserRole($userId, $role);
    if (!$ok) Response::error('操作失败');
    Auth::logAudit(0, 0, 'set_role',
        "设置角色: user_id={$userId} role={$role}",
        'success');
    Response::success(['ok' => true]);
}

// ===== 启用/禁用临时管理员模式 =====
if ($method === 'POST' && $action === 'toggle-temp-admin') {
    // 仅最高管理员（非临时管理员本身）可操作
    if (Auth::isTempAdmin()) {
        Response::error('临时管理员不能禁用自身模式');
    }
    $enabled = !empty($body['enabled']);
    $configPath = __DIR__ . '\..\..\lib\server-config.php';
    $config = Auth::serverConfig();
    $config['temp_admin']['enabled'] = $enabled;
    $export = "<?php\n/**\n * CSES Cloud - 服务器配置文件\n */\n\nreturn " . var_export($config, true) . ";\n";
    file_put_contents($configPath, $export);
    Auth::logAudit(0, 0, 'toggle_temp_admin',
        ($enabled ? '启用' : '禁用') . '临时管理员模式',
        'success');
    Response::success(['ok' => true, 'enabled' => $enabled]);
}

// ===== 重置用户密码 =====
if ($method === 'POST' && $action === 'reset-password') {
    $userId = (int)($body['user_id'] ?? 0);
    $newPassword = trim($body['password'] ?? '');
    if (!$userId || !$newPassword) Response::error('缺少参数');
    if (strlen($newPassword) < 6) Response::error('密码至少 6 位');
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    DB::update('users', ['password_hash' => $hash], 'id = ?', [$userId]);
    Auth::logAudit(0, 0, 'reset_password',
        "重置密码: user_id={$userId}",
        'success');
    Response::success(['ok' => true]);
}

// ===== 列出所有学校 =====
if ($method === 'GET' && $action === 'schools') {
    $schools = DB::all("SELECT id, name, short_name, status FROM schools ORDER BY id ASC");
    Response::success($schools);
}

// ===== 创建通知（系统管理员） =====
if ($method === 'POST' && $action === 'create-notification') {
    $title = trim($body['title'] ?? '');
    $content = trim($body['content'] ?? '');
    $type = trim($body['type'] ?? 'info');
    $targetType = trim($body['target_type'] ?? 'all');
    $targetId = $body['target_id'] ?? null;
    $schoolId = (int)($body['school_id'] ?? 0);

    if (!$title) Response::error('通知标题不能为空');
    if (!in_array($type, ['system', 'info', 'warning', 'success'])) {
        $type = 'info';
    }
    if (!in_array($targetType, ['all', 'role', 'class', 'user'])) {
        Response::error('无效的目标类型');
    }

    if ($targetType === 'all' && !$schoolId && $schoolId !== 0) {
        Response::error('请选择目标学校');
    }
    // school_id = 0 表示全体人员（所有学校）

    $notifId = DB::insert('notifications', [
        'school_id' => $schoolId,
        'sender_id' => 0,
        'sender_name' => '系统管理员',
        'type' => $type,
        'title' => $title,
        'content' => $content,
        'target_type' => $targetType,
        'target_id' => $targetId !== null ? (string)$targetId : null,
        'created_at' => date('Y-m-d H:i:s'),
    ]);

    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'admin_send_notification',
        "系统管理员发送通知: {$title} (target={$targetType}:{$targetId})",
        'success');

    Response::success(['id' => $notifId], '通知已发送');
}

// ===== AI 配置 =====
if ($method === 'GET' && $action === 'ai-config') {
    $config = Auth::serverConfig();
    $ai = $config['ai'] ?? [];
    Response::success([
        'default_model' => $ai['default_model'] ?? 'default',
    ]);
}

if ($method === 'POST' && $action === 'save-ai-config') {
    $defaultModel = trim($body['default_model'] ?? 'default');
    $configPath = __DIR__ . '\..\..\lib\server-config.php';
    $config = Auth::serverConfig();
    $config['ai'] = ['default_model' => $defaultModel];
    $export = "<?php\n/**\n * CSES Cloud - 服务器配置文件\n */\n\nreturn " . var_export($config, true) . ";\n";
    file_put_contents($configPath, $export);
    Auth::logAudit(0, 0, 'save_ai_config', "设置默认 AI 模型: {$defaultModel}", 'success');
    Response::success(['ok' => true]);
}

// ===== 系统 AI 模型管理 =====
if ($method === 'GET' && $action === 'list-ai-models') {
    $models = DB::all("SELECT * FROM ai_models WHERE owner_key = 'system' ORDER BY id ASC");
    Response::success($models);
}

if ($method === 'POST' && $action === 'create-ai-model') {
    $name = trim($body['name'] ?? '');
    $provider = trim($body['provider'] ?? '');
    $modelId = trim($body['model_id'] ?? '');
    $endpoint = trim($body['endpoint'] ?? '');
    $apiKey = trim($body['api_key'] ?? '');
    if (!$name || !$provider) Response::error('模型名称和提供商不能为空');
    $id = DB::insert('ai_models', [
        'owner_key' => 'system',
        'name' => $name,
        'provider' => $provider,
        'model_id' => $modelId,
        'endpoint' => $endpoint,
        'api_key' => $apiKey,
        'is_enabled' => 1,
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    ]);
    Auth::logAudit(0, 0, 'create_ai_model', "添加系统 AI 模型: {$name}", 'success');
    Response::success(['id' => $id]);
}

if ($method === 'POST' && $action === 'update-ai-model') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少模型 ID');
    $existing = DB::one("SELECT * FROM ai_models WHERE id = ? AND owner_key = 'system'", [$id]);
    if (!$existing) Response::error('模型不存在');
    $updates = [];
    foreach (['name', 'provider', 'model_id', 'endpoint', 'api_key'] as $f) {
        if (isset($body[$f])) $updates[$f] = trim($body[$f]);
    }
    if (isset($body['is_enabled'])) $updates['is_enabled'] = (int)$body['is_enabled'];
    $updates['updated_at'] = date('Y-m-d H:i:s');
    DB::update('ai_models', $updates, 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'update_ai_model', "更新系统 AI 模型: id={$id}", 'success');
    Response::success(['ok' => true]);
}

if ($method === 'POST' && $action === 'delete-ai-model') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少模型 ID');
    DB::delete('ai_models', "id = ? AND owner_key = 'system'", [$id]);
    Auth::logAudit(0, 0, 'delete_ai_model', "删除系统 AI 模型: id={$id}", 'success');
    Response::success(['ok' => true]);
}

// ===== 知识库管理 =====
if ($method === 'GET' && $action === 'list-kb') {
    $entries = DB::all("SELECT * FROM ai_knowledge_base ORDER BY id DESC LIMIT 100");
    Response::success($entries);
}

if ($method === 'POST' && $action === 'create-kb') {
    $title = trim($body['title'] ?? '');
    $content = trim($body['content'] ?? '');
    $category = trim($body['category'] ?? '');
    if (!$title || !$content) Response::error('标题和内容不能为空');
    $now = date('Y-m-d H:i:s');
    $id = DB::insert('ai_knowledge_base', [
        'title' => $title,
        'content' => $content,
        'category' => $category,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    Auth::logAudit(0, 0, 'create_kb', "添加知识库条目: {$title}", 'success');
    Response::success(['id' => $id]);
}

if ($method === 'POST' && $action === 'update-kb') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少条目 ID');
    $existing = DB::one("SELECT * FROM ai_knowledge_base WHERE id = ?", [$id]);
    if (!$existing) Response::error('条目不存在');
    $updates = ['updated_at' => date('Y-m-d H:i:s')];
    foreach (['title', 'content', 'category'] as $f) {
        if (isset($body[$f])) $updates[$f] = trim($body[$f]);
    }
    DB::update('ai_knowledge_base', $updates, 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'update_kb', "更新知识库条目: id={$id}", 'success');
    Response::success(['ok' => true]);
}

if ($method === 'POST' && $action === 'delete-kb') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少条目 ID');
    DB::delete('ai_knowledge_base', 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'delete_kb', "删除知识库条目: id={$id}", 'success');
    Response::success(['ok' => true]);
}

Response::error('未知操作');