<?php
/**
 * 统一分享功能 API
 *
 * 操作：
 *  - POST action=share                    创建分享（按用户或预览链接）
 *  - POST action=update-permission        更新单个被分享用户的权限
 *  - POST action=remove-user              移除被分享用户
 *  - POST action=accept                   接受分享（用户名分享）
 *  - POST action=reject                   拒绝分享（用户名分享）
 *  - POST action=toggle-preview-link      开关预览链接
 *  - GET  action=list-shared-by-me        列出我分享的
 *  - GET  action=list-shared-to-me        列出分享给我的
 *  - GET  action=get-share-detail         获取分享详情（含已授权用户列表）
 *  - GET  action=get-preview              通过预览链接获取分享内容（需登录）
 *  - POST action=accept-preview-link      通过链接接受分享
 *  - POST action=delete-share             删除分享
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== 通过预览链接获取分享内容（需登录）=====
if ($method === 'GET' && $action === 'get-preview') {
    Auth::requireLogin();
    $user = Auth::user();
    $token = trim($_GET['token'] ?? '');
    if ($token === '') Response::error('缺少 token 参数');

    $link = DB::one(
        "SELECT spl.*, si.* FROM share_preview_links spl
         JOIN share_items si ON si.id = spl.share_id
         WHERE spl.token = ? AND spl.is_enabled = 1 AND si.is_deleted = 0",
        [$token]
    );
    if (!$link) Response::error('预览链接不存在或已关闭');

    $now = date('Y-m-d H:i:s');
    if ($link['expires_at'] < $now) Response::error('分享已过期');

    // 返回资源内容
    $resourceData = getShareResourceData($link['resource_type'], $link['resource_id']);
    if (!$resourceData) Response::error('资源不存在或已被删除');

    Response::success([
        'share_id' => $link['share_id'],
        'resource_type' => $link['resource_type'],
        'resource_name' => $link['resource_name'],
        'permission' => $link['permission'],
        'owner_username' => $link['owner_username'],
        'resource' => $resourceData,
    ]);
}

// ===== 通过链接接受分享 =====
if ($method === 'POST' && $action === 'accept-preview-link') {
    Auth::requireLogin();
    $user = Auth::user();
    $ownerKey = Auth::ownerKey();
    $token = trim($body['token'] ?? '');
    if ($token === '') Response::error('缺少 token 参数');

    $link = DB::one(
        "SELECT spl.*, si.* FROM share_preview_links spl
         JOIN share_items si ON si.id = spl.share_id
         WHERE spl.token = ? AND spl.is_enabled = 1 AND si.is_deleted = 0",
        [$token]
    );
    if (!$link) Response::error('预览链接不存在或已关闭');

    // 不能接受自己的分享
    if ($link['owner_key'] === $ownerKey) Response::error('不能接受自己的分享');

    // 检查是否已经接受过
    $existing = DB::one(
        "SELECT * FROM share_user_permissions WHERE share_id = ? AND target_user_id = ?",
        [$link['share_id'], $user['user_id'] ?? 0]
    );
    if ($existing && $existing['status'] === 'accepted') {
        Response::success(['already_accepted' => true], '已接受过此分享');
    }

    $now = date('Y-m-d H:i:s');
    if ($existing) {
        DB::update('share_user_permissions', [
            'status' => 'accepted',
            'accepted_at' => $now,
        ], 'id = ?', [$existing['id']]);
    } else {
        DB::insert('share_user_permissions', [
            'share_id' => $link['share_id'],
            'target_user_id' => $user['user_id'] ?? 0,
            'target_username' => $user['username'] ?? '',
            'permission' => $link['permission'],
            'status' => 'accepted',
            'accepted_at' => $now,
            'created_at' => $now,
        ]);
    }

    Response::success(null, '已接受分享');
}

// ===== 以下操作需要登录 =====
Auth::requireLogin();
$user = Auth::user();
$ownerKey = Auth::ownerKey();
$username = $user['username'] ?? '';
$userId = $user['user_id'] ?? 0;

// ===== 创建分享 =====
if ($method === 'POST' && $action === 'share') {
    $resourceType = trim($body['resource_type'] ?? 'cloud_file');
    $resourceId = (int)($body['resource_id'] ?? 0);
    $resourceName = trim($body['resource_name'] ?? '');
    $shareType = trim($body['share_type'] ?? 'user'); // 'user' or 'link'
    $permission = trim($body['permission'] ?? 'view');
    $expiryDays = (int)($body['expiry_days'] ?? 7);
    $targetUsers = $body['target_users'] ?? []; // 用户名数组
    $enablePreviewLink = !empty($body['enable_preview_link']);

    if ($resourceName === '') Response::error('资源名称不能为空');
    if ($expiryDays < 1 || $expiryDays > 90) Response::error('有效期必须在 1-90 天之间');
    if (!in_array($resourceType, ['cloud_file', 'instance'])) Response::error('无效的资源类型');
    if (!in_array($permission, ['view', 'edit'])) Response::error('无效的权限设置');

    // 验证资源是否存在且属于当前用户
    $resource = getShareResourceData($resourceType, $resourceId);
    if (!$resource) Response::error('资源不存在');

    // 检查是否是资源所有者
    if ($resourceType === 'cloud_file') {
        $ownerCheck = DB::one("SELECT id FROM cloud_files WHERE id = ? AND school_id = ?", [$resourceId, Auth::schoolId()]);
        if (!$ownerCheck) {
            // 也检查 web_hosting_files 表
            $ownerCheck = DB::one("SELECT id FROM web_hosting_files WHERE id = ?", [$resourceId]);
        }
        if (!$ownerCheck) Response::error('无权分享此文件');
    } elseif ($resourceType === 'instance') {
        if (!Auth::canWriteInstance($resourceId)) Response::error('无权分享此实例');
    }

    $now = date('Y-m-d H:i:s');
    $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expiryDays} days"));

    // 检查是否已有分享记录（复用）
    $existingShare = DB::one(
        "SELECT * FROM share_items WHERE resource_type = ? AND resource_id = ? AND owner_key = ? AND is_deleted = 0",
        [$resourceType, $resourceId, $ownerKey]
    );

    $shareId = null;
    if ($existingShare) {
        // 更新现有分享
        $shareId = $existingShare['id'];
        DB::update('share_items', [
            'resource_name' => $resourceName,
            'permission' => $permission,
            'expires_at' => $expiresAt,
            'updated_at' => $now,
        ], 'id = ?', [$shareId]);
    } else {
        $shareId = DB::insert('share_items', [
            'owner_key' => $ownerKey,
            'owner_username' => $username,
            'resource_type' => $resourceType,
            'resource_id' => $resourceId,
            'resource_name' => $resourceName,
            'share_type' => $shareType,
            'permission' => $permission,
            'expires_at' => $expiresAt,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    // 处理按用户分享
    $addedUsers = [];
    if ($shareType === 'user' && is_array($targetUsers) && count($targetUsers) > 0) {
        foreach ($targetUsers as $targetUser) {
            $targetUsername = is_string($targetUser) ? trim($targetUser) : (trim($targetUser['username'] ?? ''));
            $targetPermission = is_string($targetUser) ? $permission : (trim($targetUser['permission'] ?? $permission));
            if ($targetUsername === '' || $targetUsername === $username) continue;

            // 查找目标用户
            $targetUserRow = DB::one("SELECT id, username FROM users WHERE username = ?", [$targetUsername]);
            if (!$targetUserRow) {
                // 尝试在所有用户中查找
                $targetUserRow = DB::one("SELECT id, username FROM users WHERE username = ?", [$targetUsername]);
            }

            $targetUid = $targetUserRow ? (int)$targetUserRow['id'] : 0;

            // 检查是否已有该用户的权限记录
            $existingPerm = DB::one(
                "SELECT * FROM share_user_permissions WHERE share_id = ? AND target_username = ?",
                [$shareId, $targetUsername]
            );

            if ($existingPerm) {
                if ($existingPerm['status'] === 'rejected') {
                    // 重新邀请
                    DB::update('share_user_permissions', [
                        'permission' => $targetPermission,
                        'status' => 'pending',
                        'accepted_at' => null,
                    ], 'id = ?', [$existingPerm['id']]);
                } else {
                    DB::update('share_user_permissions', [
                        'permission' => $targetPermission,
                    ], 'id = ?', [$existingPerm['id']]);
                }
            } else {
                DB::insert('share_user_permissions', [
                    'share_id' => $shareId,
                    'target_user_id' => $targetUid,
                    'target_username' => $targetUsername,
                    'permission' => $targetPermission,
                    'status' => 'pending',
                    'created_at' => $now,
                ]);
            }

            $addedUsers[] = $targetUsername;

            // 发送通知给被分享者
            if ($targetUid > 0) {
                sendShareNotification(
                    $targetUid,
                    $targetUsername,
                    $username,
                    $resourceName,
                    $resourceType,
                    $shareId,
                    'share_invite'
                );
            }
        }
    }

    // 处理预览链接
    $previewLink = null;
    if ($enablePreviewLink) {
        // 检查是否已有预览链接
        $existingLink = DB::one(
            "SELECT * FROM share_preview_links WHERE share_id = ?",
            [$shareId]
        );

        if ($existingLink) {
            DB::update('share_preview_links', ['is_enabled' => 1], 'id = ?', [$existingLink['id']]);
            $previewLink = $existingLink['token'];
        } else {
            $token = bin2hex(random_bytes(16));
            DB::insert('share_preview_links', [
                'share_id' => $shareId,
                'token' => $token,
                'is_enabled' => 1,
                'created_at' => $now,
            ]);
            $previewLink = $token;
        }
    }

    // 更新 share_type
    if ($enablePreviewLink && count($addedUsers) > 0) {
        DB::update('share_items', ['share_type' => 'both'], 'id = ?', [$shareId]);
    } elseif ($enablePreviewLink) {
        DB::update('share_items', ['share_type' => 'link'], 'id = ?', [$shareId]);
    } else {
        DB::update('share_items', ['share_type' => 'user'], 'id = ?', [$shareId]);
    }

    // 标记资源为已分享
    if ($resourceType === 'cloud_file') {
        DB::update('cloud_files', ['status' => 'shared'], 'id = ?', [$resourceId]);
    }

    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';

    $result = [
        'share_id' => $shareId,
        'added_users' => $addedUsers,
        'expires_at' => $expiresAt,
    ];

    if ($previewLink) {
        $result['preview_link'] = "{$protocol}://{$host}/share/preview?token={$previewLink}";
        $result['preview_token'] = $previewLink;
    }

    $msg = $existingShare ? '分享已更新' : '分享已创建';
    Response::success($result, $msg);
}

// ===== 更新单个用户权限 =====
if ($method === 'POST' && $action === 'update-permission') {
    $permId = (int)($body['permission_id'] ?? 0);
    $newPermission = trim($body['permission'] ?? '');
    if ($permId <= 0) Response::error('缺少权限记录 ID');
    if (!in_array($newPermission, ['view', 'edit'])) Response::error('无效的权限');

    $perm = DB::one("SELECT sup.*, si.owner_key FROM share_user_permissions sup JOIN share_items si ON si.id = sup.share_id WHERE sup.id = ?", [$permId]);
    if (!$perm) Response::error('权限记录不存在');
    if ($perm['owner_key'] !== $ownerKey) Response::error('无权修改此权限', 403);

    DB::update('share_user_permissions', ['permission' => $newPermission], 'id = ?', [$permId]);
    Response::success(null, '权限已更新');
}

// ===== 移除被分享用户 =====
if ($method === 'POST' && $action === 'remove-user') {
    $permId = (int)($body['permission_id'] ?? 0);
    if ($permId <= 0) Response::error('缺少权限记录 ID');

    $perm = DB::one("SELECT sup.*, si.owner_key FROM share_user_permissions sup JOIN share_items si ON si.id = sup.share_id WHERE sup.id = ?", [$permId]);
    if (!$perm) Response::error('权限记录不存在');
    if ($perm['owner_key'] !== $ownerKey) Response::error('无权移除此用户', 403);

    DB::delete('share_user_permissions', 'id = ?', [$permId]);
    Response::success(null, '用户已移除');
}

// ===== 接受分享（用户名分享） =====
if ($method === 'POST' && $action === 'accept') {
    $shareId = (int)($body['share_id'] ?? 0);
    if ($shareId <= 0) Response::error('缺少分享 ID');

    $perm = DB::one(
        "SELECT * FROM share_user_permissions WHERE share_id = ? AND target_user_id = ? AND status = 'pending'",
        [$shareId, $userId]
    );
    if (!$perm) Response::error('没有待处理的分享邀请');

    $now = date('Y-m-d H:i:s');
    DB::update('share_user_permissions', [
        'status' => 'accepted',
        'accepted_at' => $now,
    ], 'id = ?', [$perm['id']]);

    // 通知分享者
    $share = DB::one("SELECT * FROM share_items WHERE id = ?", [$shareId]);
    if ($share) {
        $sharerUser = DB::one("SELECT id, username FROM users WHERE username = ?", [$share['owner_username']]);
        if ($sharerUser) {
            sendShareNotification(
                $sharerUser['id'],
                $sharerUser['username'],
                $username,
                $share['resource_name'],
                $share['resource_type'],
                $shareId,
                'share_accepted'
            );
        }
    }

    Response::success(null, '已接受分享');
}

// ===== 拒绝分享（用户名分享） =====
if ($method === 'POST' && $action === 'reject') {
    $shareId = (int)($body['share_id'] ?? 0);
    if ($shareId <= 0) Response::error('缺少分享 ID');

    $perm = DB::one(
        "SELECT * FROM share_user_permissions WHERE share_id = ? AND target_user_id = ? AND status = 'pending'",
        [$shareId, $userId]
    );
    if (!$perm) Response::error('没有待处理的分享邀请');

    $now = date('Y-m-d H:i:s');
    DB::update('share_user_permissions', [
        'status' => 'rejected',
    ], 'id = ?', [$perm['id']]);

    // 通知分享者
    $share = DB::one("SELECT * FROM share_items WHERE id = ?", [$shareId]);
    if ($share) {
        $sharerUser = DB::one("SELECT id, username FROM users WHERE username = ?", [$share['owner_username']]);
        if ($sharerUser) {
            sendShareNotification(
                $sharerUser['id'],
                $sharerUser['username'],
                $username,
                $share['resource_name'],
                $share['resource_type'],
                $shareId,
                'share_rejected'
            );
        }
    }

    Response::success(null, '已拒绝分享');
}

// ===== 开关预览链接 =====
if ($method === 'POST' && $action === 'toggle-preview-link') {
    $shareId = (int)($body['share_id'] ?? 0);
    $enable = !empty($body['enable']);
    if ($shareId <= 0) Response::error('缺少分享 ID');

    $share = DB::one("SELECT * FROM share_items WHERE id = ? AND owner_key = ?", [$shareId, $ownerKey]);
    if (!$share) Response::error('分享不存在或无权操作');

    $existingLink = DB::one("SELECT * FROM share_preview_links WHERE share_id = ?", [$shareId]);
    $now = date('Y-m-d H:i:s');

    if ($enable) {
        if ($existingLink) {
            DB::update('share_preview_links', ['is_enabled' => 1], 'id = ?', [$existingLink['id']]);
        } else {
            $token = bin2hex(random_bytes(16));
            DB::insert('share_preview_links', [
                'share_id' => $shareId,
                'token' => $token,
                'is_enabled' => 1,
                'created_at' => $now,
            ]);
            $existingLink = ['token' => $token];
        }
        $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        Response::success([
            'enabled' => true,
            'preview_link' => "{$protocol}://{$host}/share/preview?token={$existingLink['token']}",
            'preview_token' => $existingLink['token'],
        ], '预览链接已开启');
    } else {
        if ($existingLink) {
            DB::update('share_preview_links', ['is_enabled' => 0], 'id = ?', [$existingLink['id']]);
        }
        Response::success(['enabled' => false], '预览链接已关闭');
    }
}

// ===== 列出我分享的 =====
if ($method === 'GET' && $action === 'list-shared-by-me') {
    $shares = DB::all(
        "SELECT si.*, spl.token AS preview_token, spl.is_enabled AS preview_enabled
         FROM share_items si
         LEFT JOIN share_preview_links spl ON spl.share_id = si.id
         WHERE si.owner_key = ? AND si.is_deleted = 0
         ORDER BY si.created_at DESC",
        [$ownerKey]
    );

    $result = [];
    foreach ($shares as $share) {
        $users = DB::all(
            "SELECT * FROM share_user_permissions WHERE share_id = ? ORDER BY created_at ASC",
            [$share['id']]
        );

        $result[] = [
            'id' => $share['id'],
            'resource_type' => $share['resource_type'],
            'resource_id' => $share['resource_id'],
            'resource_name' => $share['resource_name'],
            'share_type' => $share['share_type'],
            'permission' => $share['permission'],
            'expires_at' => $share['expires_at'],
            'created_at' => $share['created_at'],
            'preview_token' => $share['preview_token'],
            'preview_enabled' => (int)($share['preview_enabled'] ?? 0),
            'users' => array_map(function ($u) {
                return [
                    'id' => $u['id'],
                    'target_user_id' => $u['target_user_id'],
                    'target_username' => $u['target_username'],
                    'permission' => $u['permission'],
                    'status' => $u['status'],
                    'accepted_at' => $u['accepted_at'],
                ];
            }, $users),
        ];
    }

    Response::success($result);
}

// ===== 列出分享给我的 =====
if ($method === 'GET' && $action === 'list-shared-to-me') {
    $type = $_GET['type'] ?? 'all'; // 'all' / 'cloud_file' / 'instance'

    $typeFilter = '';
    $params = [$userId];
    if ($type !== 'all') {
        $typeFilter = 'AND si.resource_type = ?';
        $params[] = $type;
    }

    $perms = DB::all(
        "SELECT sup.*, si.resource_type, si.resource_id, si.resource_name, si.owner_username, si.expires_at, si.permission AS share_permission
         FROM share_user_permissions sup
         JOIN share_items si ON si.id = sup.share_id
         WHERE sup.target_user_id = ? AND sup.status = 'accepted' AND si.is_deleted = 0 {$typeFilter}
         ORDER BY sup.accepted_at DESC",
        $params
    );

    $result = array_map(function ($p) {
        return [
            'permission_id' => $p['id'],
            'share_id' => $p['share_id'],
            'resource_type' => $p['resource_type'],
            'resource_id' => $p['resource_id'],
            'resource_name' => $p['resource_name'],
            'owner_username' => $p['owner_username'],
            'permission' => $p['permission'],
            'expires_at' => $p['expires_at'],
            'accepted_at' => $p['accepted_at'],
        ];
    }, $perms);

    Response::success($result);
}

// ===== 获取分享详情（含已授权用户列表） =====
if ($method === 'GET' && $action === 'get-share-detail') {
    $shareId = (int)($_GET['share_id'] ?? 0);
    if ($shareId <= 0) Response::error('缺少分享 ID');

    $share = DB::one(
        "SELECT si.*, spl.token AS preview_token, spl.is_enabled AS preview_enabled
         FROM share_items si
         LEFT JOIN share_preview_links spl ON spl.share_id = si.id
         WHERE si.id = ? AND si.owner_key = ? AND si.is_deleted = 0",
        [$shareId, $ownerKey]
    );
    if (!$share) Response::error('分享不存在或无权访问');

    $users = DB::all(
        "SELECT * FROM share_user_permissions WHERE share_id = ? ORDER BY created_at ASC",
        [$shareId]
    );

    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';

    Response::success([
        'id' => $share['id'],
        'resource_type' => $share['resource_type'],
        'resource_id' => $share['resource_id'],
        'resource_name' => $share['resource_name'],
        'share_type' => $share['share_type'],
        'permission' => $share['permission'],
        'expires_at' => $share['expires_at'],
        'created_at' => $share['created_at'],
        'preview_token' => $share['preview_token'],
        'preview_enabled' => (int)($share['preview_enabled'] ?? 0),
        'preview_link' => $share['preview_token'] ? "{$protocol}://{$host}/share/preview?token={$share['preview_token']}" : null,
        'users' => array_map(function ($u) {
            return [
                'id' => $u['id'],
                'target_user_id' => $u['target_user_id'],
                'target_username' => $u['target_username'],
                'permission' => $u['permission'],
                'status' => $u['status'],
                'accepted_at' => $u['accepted_at'],
            ];
        }, $users),
    ]);
}

// ===== 删除分享 =====
if ($method === 'POST' && $action === 'delete-share') {
    $shareId = (int)($body['share_id'] ?? 0);
    if ($shareId <= 0) Response::error('缺少分享 ID');

    $share = DB::one("SELECT * FROM share_items WHERE id = ? AND owner_key = ?", [$shareId, $ownerKey]);
    if (!$share) Response::error('分享不存在或无权操作');

    // 软删除
    DB::update('share_items', ['is_deleted' => 1, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$shareId]);

    // 更新资源状态
    if ($share['resource_type'] === 'cloud_file') {
        // 检查是否还有其他活跃分享
        $otherShares = DB::scalar(
            "SELECT COUNT(*) FROM share_items WHERE resource_type = 'cloud_file' AND resource_id = ? AND is_deleted = 0 AND id != ?",
            [$share['resource_id'], $shareId]
        );
        if ($otherShares == 0) {
            DB::update('cloud_files', ['status' => 'synced'], 'id = ?', [$share['resource_id']]);
        }
    }

    Response::success(null, '分享已删除');
}

// ===== 搜索用户（用于分享时选择用户） =====
if ($method === 'GET' && $action === 'search-users') {
    $keyword = trim($_GET['keyword'] ?? '');
    if ($keyword === '') {
        Response::success([]);
    }

    $users = DB::all(
        "SELECT id, username, display_name, role FROM users
         WHERE (username LIKE ? OR display_name LIKE ?) AND status = 'active' AND username != ?
         LIMIT 20",
        ["%{$keyword}%", "%{$keyword}%", $username]
    );

    $result = array_map(function ($u) {
        return [
            'id' => $u['id'],
            'username' => $u['username'],
            'display_name' => $u['display_name'],
            'role' => $u['role'],
        ];
    }, $users);

    Response::success($result);
}

// ===== 获取分享给我的待处理列表（用于通知） =====
if ($method === 'GET' && $action === 'pending-shares') {
    $perms = DB::all(
        "SELECT sup.*, si.resource_type, si.resource_id, si.resource_name, si.owner_username, si.expires_at
         FROM share_user_permissions sup
         JOIN share_items si ON si.id = sup.share_id
         WHERE sup.target_user_id = ? AND sup.status = 'pending' AND si.is_deleted = 0 AND si.expires_at > datetime('now','localtime')
         ORDER BY sup.created_at DESC",
        [$userId]
    );

    $result = array_map(function ($p) {
        return [
            'permission_id' => $p['id'],
            'share_id' => $p['share_id'],
            'resource_type' => $p['resource_type'],
            'resource_name' => $p['resource_name'],
            'owner_username' => $p['owner_username'],
            'permission' => $p['permission'],
            'expires_at' => $p['expires_at'],
            'created_at' => $p['created_at'],
        ];
    }, $perms);

    Response::success($result);
}

// ===== 辅助函数 =====

/**
 * 获取分享资源的实际数据
 */
function getShareResourceData(string $type, int $id): ?array
{
    if ($type === 'cloud_file') {
        // 先尝试 cloud_files 表
        $file = DB::one("SELECT * FROM cloud_files WHERE id = ?", [$id]);
        if ($file) {
            return [
                'id' => $file['id'],
                'name' => $file['name'],
                'content' => $file['content'],
                'file_type' => $file['file_type'],
                'file_size' => $file['file_size'],
                'updated_at' => $file['updated_at'],
            ];
        }
        // 再尝试 web_hosting_files 表（轻编辑器云文件）
        $wFile = DB::one("SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0", [$id]);
        if ($wFile) {
            return [
                'id' => $wFile['id'],
                'name' => basename($wFile['file_path']),
                'content' => is_string($wFile['content']) ? $wFile['content'] : '',
                'file_type' => pathinfo($wFile['file_path'], PATHINFO_EXTENSION),
                'file_size' => $wFile['file_size'],
                'updated_at' => $wFile['updated_at'],
            ];
        }
        return null;
    }

    if ($type === 'instance') {
        $ins = DB::one("SELECT * FROM instances WHERE id = ?", [$id]);
        if (!$ins) return null;
        return [
            'id' => $ins['id'],
            'name' => $ins['name'],
            'instance_uid' => $ins['instance_uid'],
            'service_type' => $ins['service_type'],
            'status' => $ins['status'],
            'created_at' => $ins['created_at'],
        ];
    }

    return null;
}

/**
 * 发送分享相关通知
 */
function sendShareNotification(int $targetUserId, string $targetUsername, string $fromUsername, string $resourceName, string $resourceType, int $shareId, string $notifType): void
{
    $schoolId = 0;
    $targetUser = DB::one("SELECT school_id FROM users WHERE id = ?", [$targetUserId]);
    if ($targetUser) $schoolId = (int)$targetUser['school_id'];

    $typeLabels = ['cloud_file' => '文件', 'instance' => '实例'];
    $resourceLabel = $typeLabels[$resourceType] ?? '资源';

    $title = '';
    $content = '';
    $targetType = $notifType; // share_invite / share_accepted / share_rejected

    switch ($notifType) {
        case 'share_invite':
            $title = "{$fromUsername} 分享了一个{$resourceLabel}给你";
            $content = "{$fromUsername} 邀请你查看{$resourceLabel}「{$resourceName}」。请在消息中心处理此邀请。";
            break;
        case 'share_accepted':
            $title = "{$targetUsername} 接受了你的分享";
            $content = "{$targetUsername} 已接受你对{$resourceLabel}「{$resourceName}」的分享。";
            break;
        case 'share_rejected':
            $title = "{$targetUsername} 拒绝了你的分享";
            $content = "{$targetUsername} 拒绝了你对{$resourceLabel}「{$resourceName}」的分享邀请。";
            break;
    }

    if ($title === '') return;

    DB::insert('notifications', [
        'school_id' => $schoolId,
        'sender_id' => 0,
        'sender_name' => $fromUsername,
        'type' => 'info',
        'title' => $title,
        'content' => $content,
        'target_type' => $targetType,
        'target_id' => (string)$targetUserId,
        'share_id' => $shareId,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
}

Response::error('未知的操作');