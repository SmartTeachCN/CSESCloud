<?php
/**
 * 分享功能 API
 *
 * 操作：
 *  - POST action=create   创建分享链接
 *  - GET  action=get      获取分享详情（无需登录）
 *  - POST action=delete   删除分享（需登录，创建者或管理员）
 *  - GET  action=list     列出当前用户的分享列表
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// === action=get：无需登录，公开访问 ===
if ($method === 'GET' && $action === 'get') {
    $token = trim($_GET['token'] ?? '');
    if ($token === '') {
        Response::error('缺少 token 参数');
    }

    $share = DB::one(
        "SELECT * FROM share_links WHERE token = ?",
        [$token]
    );
    if (!$share) {
        Response::error('分享链接不存在');
    }

    $now = date('Y-m-d H:i:s');
    if ($share['expires_at'] < $now) {
        Response::error('分享链接已过期');
    }

    Response::success([
        'id' => $share['id'],
        'token' => $share['token'],
        'file_id' => $share['file_id'],
        'file_name' => $share['file_name'],
        'file_content' => $share['file_content'],
        'created_by' => $share['created_by'],
        'permission' => $share['permission'],
        'allow_guests' => (int)$share['allow_guests'],
        'expiry_days' => (int)$share['expiry_days'],
        'expires_at' => $share['expires_at'],
        'created_at' => $share['created_at'],
    ]);
}

// === 以下操作需要登录 ===
Auth::requireLogin();
$user = Auth::user();
$username = $user['username'] ?? '';
$role = $user['role'] ?? '';

if ($method === 'POST' && $action === 'create') {
    $fileId = (int)($body['file_id'] ?? 0);
    $fileName = trim($body['file_name'] ?? '');
    $fileContent = $body['file_content'] ?? '';
    $expiryDays = (int)($body['expiry_days'] ?? 7);
    $permission = trim($body['permission'] ?? 'all');
    $allowGuests = !empty($body['allow_guests']) ? 1 : 0;

    if ($fileName === '') {
        Response::error('文件名不能为空');
    }
    if ($expiryDays < 1 || $expiryDays > 7) {
        Response::error('有效期必须在 1-7 天之间');
    }

    $token = md5(uniqid($username . '_', true));
    $now = date('Y-m-d H:i:s');
    $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expiryDays} days"));

    DB::insert('share_links', [
        'token' => $token,
        'file_id' => $fileId,
        'file_name' => $fileName,
        'file_content' => $fileContent,
        'created_by' => $username,
        'permission' => $permission,
        'allow_guests' => $allowGuests,
        'expiry_days' => $expiryDays,
        'expires_at' => $expiresAt,
        'created_at' => $now,
    ]);

    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $url = "{$protocol}://{$host}/api/share.php?action=get&token={$token}";

    Response::success([
        'token' => $token,
        'url' => $url,
        'expires_at' => $expiresAt,
    ], '分享链接已创建');
}

if ($method === 'POST' && $action === 'delete') {
    $token = trim($body['token'] ?? '');
    if ($token === '') {
        Response::error('缺少 token 参数');
    }

    $share = DB::one("SELECT * FROM share_links WHERE token = ?", [$token]);
    if (!$share) {
        Response::error('分享链接不存在');
    }

    // 创建者或管理员可删除
    $isAdmin = ($role === 'admin' || $role === 'super_admin');
    if ($share['created_by'] !== $username && !$isAdmin) {
        Response::error('无权删除此分享链接');
    }

    DB::delete('share_links', 'token = ?', [$token]);
    Response::success(null, '分享链接已删除');
}

if ($method === 'GET' && $action === 'list') {
    $shares = DB::all(
        "SELECT * FROM share_links WHERE created_by = ? ORDER BY created_at DESC",
        [$username]
    );

    $result = array_map(function ($row) {
        return [
            'id' => $row['id'],
            'token' => $row['token'],
            'file_id' => $row['file_id'],
            'file_name' => $row['file_name'],
            'permission' => $row['permission'],
            'allow_guests' => (int)$row['allow_guests'],
            'expiry_days' => (int)$row['expiry_days'],
            'expires_at' => $row['expires_at'],
            'created_at' => $row['created_at'],
        ];
    }, $shares);

    Response::success($result);
}

Response::error('未知的操作');