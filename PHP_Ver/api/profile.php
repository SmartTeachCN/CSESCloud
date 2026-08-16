<?php
/** 个人中心 API */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$user = Auth::user();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// 获取完整用户资料（含 department、avatar、preferences）
if ($method === 'GET' && $action === 'profile') {
    $userId = $user['user_id'];
    if ($user['type'] === 'sub') {
        $row = DB::query('SELECT id, username, display_name, email, phone, department, avatar, preferences, role FROM users WHERE id = ?', [$userId])->fetch();
        if ($row) {
            $row['preferences'] = $row['preferences'] ? json_decode($row['preferences'], true) : new stdClass();
            $user = array_merge($user, $row);
        }
    }
    // 联盟账户无数据库记录，返回 session 数据
    if (!isset($user['department'])) $user['department'] = '';
    if (!isset($user['avatar'])) $user['avatar'] = '';
    if (!isset($user['preferences'])) $user['preferences'] = new stdClass();
    else if (is_string($user['preferences'])) $user['preferences'] = json_decode($user['preferences'], true);
    if (!isset($user['phone'])) $user['phone'] = '';
    Response::success($user);
}

// 更新个人资料
if ($method === 'POST' && $action === 'update-profile') {
    $displayName = trim($body['display_name'] ?? '');
    $email = trim($body['email'] ?? '');
    $phone = trim($body['phone'] ?? '');
    $department = trim($body['department'] ?? '');
    if (!$displayName) Response::error('请填写姓名');

    if ($user['type'] === 'sub') {
        DB::update('users', [
            'display_name' => $displayName,
            'email' => $email,
            'phone' => $phone,
            'department' => $department,
        ], 'id = ?', [$user['user_id']]);
    }
    $_SESSION['auth']['display_name'] = $displayName;
    $_SESSION['auth']['email'] = $email;
    Response::success(null, '资料已更新');
}

// 修改密码
if ($method === 'POST' && $action === 'change-password') {
    $oldPwd = $body['old_password'] ?? '';
    $newPwd = $body['new_password'] ?? '';
    if (strlen($newPwd) < 6) Response::error('新密码至少 6 位');

    if ($user['type'] === 'sub') {
        // 验证旧密码
        $row = DB::query('SELECT password_hash FROM users WHERE id = ?', [$user['user_id']])->fetch();
        if (!$row || !password_verify($oldPwd, $row['password_hash'])) {
            Response::error('旧密码不正确');
        }
        DB::update('users', ['password_hash' => password_hash($newPwd, PASSWORD_DEFAULT)], 'id = ?', [$user['user_id']]);
        Auth::logAudit($user['school_id'], $user['user_id'], 'update', '修改个人密码');
    } else {
        // 联盟账户/临时管理员不支持修改密码
        Response::error('当前账户类型不支持修改密码');
    }
    Response::success(null, '密码已修改');
}

// 更新头像
if ($method === 'POST' && $action === 'update-avatar') {
    $avatar = trim($body['avatar'] ?? '');
    if ($user['type'] === 'sub') {
        DB::update('users', ['avatar' => $avatar], 'id = ?', [$user['user_id']]);
    }
    $_SESSION['auth']['avatar'] = $avatar;
    Response::success(null, '头像已更新');
}

// 上传头像文件
if ($method === 'POST' && $action === 'upload-avatar') {
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        Response::error('上传失败');
    }
    $file = $_FILES['file'];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
        Response::error('仅支持 JPG、PNG、GIF、WebP 格式');
    }
    if ($file['size'] > 2 * 1024 * 1024) {
        Response::error('头像文件不能超过 2MB');
    }

    $uploadDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'avatars';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0777, true);

    $filename = 'avatar_' . $user['user_id'] . '_' . time() . '.' . $ext;
    $destPath = $uploadDir . DIRECTORY_SEPARATOR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        Response::error('文件保存失败');
    }

    $avatarUrl = '/api/avatar.php?file=' . urlencode($filename);
    if ($user['type'] === 'sub') {
        DB::update('users', ['avatar' => $avatarUrl], 'id = ?', [$user['user_id']]);
    }
    $_SESSION['auth']['avatar'] = $avatarUrl;
    Response::success(['url' => $avatarUrl], '头像上传成功');
}

// 保存偏好设置
if ($method === 'POST' && $action === 'save-preferences') {
    $preferences = $body['preferences'] ?? [];
    $prefsJson = json_encode($preferences, JSON_UNESCAPED_UNICODE);
    if ($user['type'] === 'sub') {
        DB::update('users', ['preferences' => $prefsJson], 'id = ?', [$user['user_id']]);
    }
    Response::success(null, '偏好已保存');
}

Response::error('未知的操作');