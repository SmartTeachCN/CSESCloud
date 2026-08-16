<?php
/**
 * 获取当前登录用户信息（含上下文：绑定子用户 / 已加入学校 / 保留登录条目）
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

if (!Auth::check()) {
    Response::error('未登录', 401, 401);
}

$user = Auth::user();
$payload = [
    'type' => $user['type'] ?? 'sub',
    'user_id' => (int)($user['user_id'] ?? 0),
    'school_id' => (int)($user['school_id'] ?? 0),
    'school_name' => $user['school_name'] ?? '',
    'instance_id' => (int)($user['instance_id'] ?? 0),
    'instance_uid' => $user['instance_uid'] ?? '',
    'username' => $user['username'] ?? '',
    'display_name' => $user['display_name'] ?? '',
    'role' => $user['role'] ?? '',
    'email' => $user['email'] ?? '',
    'is_alliance' => Auth::isAlliance(),
    'is_instance_sub' => Auth::isInstanceSub(),
    'is_temp_admin' => Auth::isTempAdmin(),
    'is_super_admin' => Auth::isSuperAdmin(),
    'owner_key' => Auth::ownerKey(),
];

// 联盟账户附加信息
if (Auth::isAlliance()) {
    $payload['bindings'] = Auth::listBindings($user['username']);
    $payload['joined_schools'] = Auth::listJoinedSchools($user['username']);
}

// 实例子用户附加信息：实例 UID 与所属学校
if (Auth::isInstanceSub()) {
    $payload['instance_uid'] = $user['instance_uid'] ?? '';
}

// 保留登录条目（任何登录态都可读，前端登录页据此渲染列表）
$payload['saved_logins'] = Auth::listSavedLogins();

Response::success($payload);
