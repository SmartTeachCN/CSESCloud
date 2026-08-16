<?php
/**
 * 子用户管理 API（学校管理员侧）
 *
 *  GET  action=list                                当前学校所有子用户（含 permissions 与 bindings 聚合）
 *  GET  action=school-bindings                     当前学校所有子用户的联盟绑定关系
 *  POST action=create                              新增子用户
 *  POST action=update                              更新子用户（含 permissions）
 *  POST action=reset-password                      重置密码
 *  POST action=delete                             删除子用户
 *  POST action=school-unbind                       学校管理员解绑某子用户的联盟绑定
 */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

if (!$schoolId) Response::error('当前未选择学校', 403, 403);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// 列出当前学校的子用户，附带权限 JSON 与已绑定的联盟账户
if ($method === 'GET' && $action === 'list') {
    $keyword = trim($_GET['keyword'] ?? '');
    $sql = "SELECT id, school_id, username, display_name, role, email, phone, status, permissions, created_at
            FROM users WHERE school_id = ?";
    $params = [$schoolId];
    if ($keyword !== '') {
        $sql .= " AND (username LIKE ? OR display_name LIKE ? OR email LIKE ?)";
        array_push($params, "%{$keyword}%", "%{$keyword}%", "%{$keyword}%");
    }
    $sql .= " ORDER BY id ASC";
    $rows = DB::all($sql, $params);
    // 解析 permissions JSON
    foreach ($rows as &$r) {
        $r['permissions'] = $r['permissions'] ? json_decode($r['permissions'], true) : null;
    }
    unset($r);
    // 附加每个子用户的联盟绑定列表
    $bindings = Auth::listSchoolBindings($schoolId);
    $bindingMap = [];
    foreach ($bindings as $b) {
        $bindingMap[(int)$b['sub_user_id']][] = [
            'binding_id' => (int)$b['id'],
            'alliance_username' => $b['alliance_username'],
            'alias' => $b['alias'],
            'permissions' => $b['permissions'] ? json_decode($b['permissions'], true) : null,
            'created_at' => $b['created_at']
        ];
    }
    foreach ($rows as &$r) {
        $r['bindings'] = $bindingMap[(int)$r['id']] ?? [];
    }
    unset($r);
    Response::success($rows);
}

// 列出当前学校所有子用户的联盟绑定（学校管理员视角）
if ($method === 'GET' && $action === 'school-bindings') {
    $rows = Auth::listSchoolBindings($schoolId);
    foreach ($rows as &$b) {
        $b['permissions'] = $b['permissions'] ? json_decode($b['permissions'], true) : null;
    }
    unset($b);
    Response::success($rows);
}

if ($method === 'POST' && $action === 'create') {
    $username = trim($body['username'] ?? '');
    $displayName = trim($body['display_name'] ?? '');
    $password = $body['password'] ?? '';
    $role = $body['role'] ?? 'teacher';
    $email = trim($body['email'] ?? '');
    $phone = trim($body['phone'] ?? '');
    $permissions = $body['permissions'] ?? null;
    if (!$username || !$displayName || !$password) Response::error('请填写用户名、姓名和密码');
    if (strlen($password) < 6) Response::error('密码至少 6 位');
    $exists = DB::one("SELECT id FROM users WHERE school_id = ? AND username = ?", [$schoolId, $username]);
    if ($exists) Response::error('用户名已存在');
    $id = DB::insert('users', [
        'school_id' => $schoolId, 'username' => $username,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'display_name' => $displayName, 'role' => $role,
        'email' => $email, 'phone' => $phone,
        'permissions' => $permissions !== null ? json_encode($permissions, JSON_UNESCAPED_UNICODE) : null,
        'status' => 'active', 'created_at' => date('Y-m-d H:i:s'),
    ]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'create', "新增子用户 {$username}");
    Response::success(['id' => $id], '子用户创建成功');
}

if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    $displayName = trim($body['display_name'] ?? '');
    $role = $body['role'] ?? 'teacher';
    $email = trim($body['email'] ?? '');
    $phone = trim($body['phone'] ?? '');
    $status = $body['status'] ?? 'active';
    $permissions = $body['permissions'] ?? null;
    if (!$id || !$displayName) Response::error('参数错误');
    $updateData = [
        'display_name' => $displayName, 'role' => $role,
        'email' => $email, 'phone' => $phone, 'status' => $status,
    ];
    // 仅当显式传入 permissions 字段时才更新（避免误清空）
    if (array_key_exists('permissions', $body)) {
        $updateData['permissions'] = $permissions !== null ? json_encode($permissions, JSON_UNESCAPED_UNICODE) : null;
    }
    DB::update('users', $updateData, 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'update', "修改子用户 {$displayName}");
    Response::success(null, '更新成功');
}

if ($method === 'POST' && $action === 'reset-password') {
    $id = (int)($body['id'] ?? 0);
    $password = $body['password'] ?? '';
    if (!$id || strlen($password) < 6) Response::error('密码至少 6 位');
    DB::update('users', ['password_hash' => password_hash($password, PASSWORD_DEFAULT)], 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'update', "重置子用户密码 ID:{$id}");
    Response::success(null, '密码已重置');
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('参数错误');
    $u = DB::one("SELECT * FROM users WHERE id = ? AND school_id = ?", [$id, $schoolId]);
    if (!$u) Response::error('用户不存在');
    DB::delete('users', 'id = ? AND school_id = ?', [$id, $schoolId]);
    // 同步删除该子用户的联盟绑定
    DB::delete('alliance_account_bindings', 'sub_user_id = ?', [$id]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'delete', "删除子用户 {$u['username']}");
    Response::success(null, '删除成功');
}

// 学校管理员解绑某子用户的联盟绑定
if ($method === 'POST' && $action === 'school-unbind') {
    $bindingId = (int)($body['binding_id'] ?? 0);
    if (!$bindingId) Response::error('缺少 binding_id');
    $ok = Auth::schoolUnbind($schoolId, $bindingId);
    Response::success(['ok' => $ok], $ok ? '已解绑' : '条目不存在');
}

Response::error('未知的操作');
