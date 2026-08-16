<?php
/**
 * 通知 API
 *
 * 操作：
 *  - GET  action=list            获取当前用户的通知列表
 *  - GET  action=stats           获取通知统计（未读/今日/本周/总计）
 *  - POST action=mark-read       标记通知为已读
 *  - POST action=delete          删除通知（移除当前用户的已读记录）
 *  - POST action=create          创建通知（校园管理员 / 有权限者）
 *  - GET  action=recipients      获取可通知的目标（用户 / 角色 / 班级）
 */

require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();

$user = Auth::user();
$userId = (int)($user['user_id'] ?? 0);
$schoolId = Auth::schoolId();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== 获取通知列表 =====
if ($method === 'GET' && $action === 'list') {
    $type = $_GET['type'] ?? 'all';
    $page = max(1, (int)($_GET['page'] ?? 1));
    $perPage = 50;
    $offset = ($page - 1) * $perPage;

    // 获取当前用户应该看到的通知：目标为全体、同角色、同班级、或直接指定该用户
    $userRole = $user['role'] ?? '';
    $userClassId = 0;
    if ($userRole === 'student') {
        $student = DB::one("SELECT class_id FROM students WHERE school_id = ? AND name = (SELECT display_name FROM users WHERE id = ?)", [$schoolId, $userId]);
        $userClassId = $student ? (int)$student['class_id'] : 0;
    }

    $where = "(
        n.school_id = :school_id
        OR n.school_id = 0
    ) AND (
        n.target_type = 'all'
        OR (n.target_type = 'role' AND n.target_id = :role)
        OR (n.target_type = 'user' AND n.target_id = :uid)
        OR (n.target_type = 'share_invite' AND n.target_id = :uid)
        OR (n.target_type = 'share_accepted' AND n.target_id = :uid)
        OR (n.target_type = 'share_rejected' AND n.target_id = :uid)
    )";
    $params = [
        'school_id' => $schoolId,
        'role' => $userRole,
        'uid' => (string)$userId,
    ];

    if ($userClassId > 0) {
        $where .= " OR (n.target_type = 'class' AND n.target_id = :class_id)";
        $params['class_id'] = (string)$userClassId;
    }

    if ($type !== 'all') {
        $where .= " AND n.type = :type";
        $params['type'] = $type;
    }

    $sql = "SELECT n.*, nr.is_read, nr.read_at
            FROM notifications n
            LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = :user_id
            WHERE {$where} AND (nr.is_read IS NULL OR nr.is_read >= 0)
            ORDER BY n.id DESC
            LIMIT :limit OFFSET :offset";

    $params['user_id'] = $userId;
    $params['limit'] = $perPage;
    $params['offset'] = $offset;

    // 使用 PDO 直接查询以支持 LIMIT/OFFSET 参数绑定
    $pdo = DB::pdo();
    $stmt = $pdo->prepare($sql);
    foreach ($params as $k => $v) {
        $type = is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR;
        $stmt->bindValue(':' . $k, $v, $type);
    }
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    Response::success($rows);
}

// ===== 获取通知统计 =====
if ($method === 'GET' && $action === 'stats') {
    $userRole = $user['role'] ?? '';
    $userClassId = 0;
    if ($userRole === 'student') {
        $student = DB::one("SELECT class_id FROM students WHERE school_id = ? AND name = (SELECT display_name FROM users WHERE id = ?)", [$schoolId, $userId]);
        $userClassId = $student ? (int)$student['class_id'] : 0;
    }

    $targetWhere = "(
        n.school_id = ?
        OR n.school_id = 0
    ) AND (
        n.target_type = 'all'
        OR (n.target_type = 'role' AND n.target_id = ?)
        OR (n.target_type = 'user' AND n.target_id = ?)
        OR (n.target_type = 'share_invite' AND n.target_id = ?)
        OR (n.target_type = 'share_accepted' AND n.target_id = ?)
        OR (n.target_type = 'share_rejected' AND n.target_id = ?)
    )";
    $targetParams = [$schoolId, $userRole, (string)$userId, (string)$userId, (string)$userId, (string)$userId];

    if ($userClassId > 0) {
        $targetWhere .= " OR (n.target_type = 'class' AND n.target_id = ?)";
        $targetParams[] = (string)$userClassId;
    }

    $unread = (int)DB::scalar(
        "SELECT COUNT(*) FROM notifications n
         LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
         WHERE {$targetWhere} AND (nr.is_read IS NULL OR nr.is_read = 0)",
        array_merge([$userId], $targetParams)
    );

    $today = (int)DB::scalar(
        "SELECT COUNT(*) FROM notifications n WHERE {$targetWhere} AND date(n.created_at) = date('now')",
        $targetParams
    );

    $week = (int)DB::scalar(
        "SELECT COUNT(*) FROM notifications n WHERE {$targetWhere} AND n.created_at >= datetime('now','-7 days')",
        $targetParams
    );

    $total = (int)DB::scalar(
        "SELECT COUNT(*) FROM notifications n WHERE {$targetWhere}",
        $targetParams
    );

    Response::success(['unread' => $unread, 'today' => $today, 'week' => $week, 'total' => $total]);
}

// ===== 标记已读 =====
if ($method === 'POST' && $action === 'mark-read') {
    $id = (int)($body['id'] ?? 0);
    if ($id) {
        // 确保该通知对当前用户可见
        $notif = DB::one("SELECT id FROM notifications WHERE id = ? AND school_id = ?", [$id, $schoolId]);
        if (!$notif) Response::error('通知不存在');
        // 插入或更新已读记录
        DB::query(
            "INSERT INTO notification_reads (notification_id, user_id, is_read, read_at)
             VALUES (?, ?, 1, datetime('now','localtime'))
             ON CONFLICT(notification_id, user_id) DO UPDATE SET is_read = 1, read_at = datetime('now','localtime')",
            [$id, $userId]
        );
    } else {
        // 全部标记已读：获取当前用户所有未读通知
        $userRole = $user['role'] ?? '';
        $targetParams = [$schoolId, $userRole, (string)$userId];
        $targetWhere = "n.school_id = ? AND (
            n.target_type = 'all'
            OR (n.target_type = 'role' AND n.target_id = ?)
            OR (n.target_type = 'user' AND n.target_id = ?)
        )";
        $unreadIds = DB::all(
            "SELECT n.id FROM notifications n
             LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
             WHERE {$targetWhere} AND (nr.is_read IS NULL OR nr.is_read = 0)",
            array_merge([$userId], $targetParams)
        );
        foreach ($unreadIds as $row) {
            DB::query(
                "INSERT INTO notification_reads (notification_id, user_id, is_read, read_at)
                 VALUES (?, ?, 1, datetime('now','localtime'))
                 ON CONFLICT(notification_id, user_id) DO UPDATE SET is_read = 1, read_at = datetime('now','localtime')",
                [(int)$row['id'], $userId]
            );
        }
    }
    Response::success(null, '已标记为已读');
}

// ===== 删除通知（移除当前用户的已读记录，相当于"不再显示"） =====
if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('参数错误');
    // 删除该用户的已读记录（之后该通知不再出现在列表中）
    DB::delete('notification_reads', 'notification_id = ? AND user_id = ?', [$id, $userId]);
    // 插入一条 deleted 标记（is_read = -1 表示已删除）
    DB::query(
        "INSERT INTO notification_reads (notification_id, user_id, is_read, read_at)
         VALUES (?, ?, -1, datetime('now','localtime'))
         ON CONFLICT(notification_id, user_id) DO UPDATE SET is_read = -1, read_at = datetime('now','localtime')",
        [$id, $userId]
    );
    Response::success(null, '已删除');
}

// ===== 创建通知（校园管理员 / 有权限者） =====
if ($method === 'POST' && $action === 'create') {
    // 权限检查：校园管理员（admin 角色）、有通知权限的用户、或系统管理员
    $isAdmin = ($user['role'] ?? '') === 'admin';
    $isSuperAdmin = Auth::isSuperAdmin();
    // 检查用户是否有通知下发权限
    $hasNotifyPerm = false;
    if (!$isAdmin && !$isSuperAdmin && $userId > 0) {
        $userPerms = DB::scalar("SELECT permissions FROM users WHERE id = ?", [$userId]);
        if ($userPerms) {
            $perms = json_decode($userPerms, true);
            $hasNotifyPerm = !empty($perms['can_send_notification']);
        }
    }

    if (!$isAdmin && !$isSuperAdmin && !$hasNotifyPerm) {
        Response::error('没有通知下发权限', 0, 403);
    }

    $title = trim($body['title'] ?? '');
    $content = trim($body['content'] ?? '');
    $type = trim($body['type'] ?? 'info');
    $targetType = trim($body['target_type'] ?? 'all');
    $targetId = $body['target_id'] ?? null;

    if (!$title) Response::error('通知标题不能为空');
    if (!in_array($type, ['system', 'info', 'warning', 'success'])) {
        $type = 'info';
    }
    if (!in_array($targetType, ['all', 'role', 'class', 'user'])) {
        Response::error('无效的目标类型');
    }

    if ($targetType === 'user' && !$targetId) {
        Response::error('请选择目标用户');
    }
    if ($targetType === 'role' && !$targetId) {
        Response::error('请选择目标角色');
    }
    if ($targetType === 'class' && !$targetId) {
        Response::error('请选择目标班级');
    }

    $senderName = $user['display_name'] ?? $user['username'] ?? '系统';

    $notifId = DB::insert('notifications', [
        'school_id' => $schoolId,
        'sender_id' => $userId,
        'sender_name' => $senderName,
        'type' => $type,
        'title' => $title,
        'content' => $content,
        'target_type' => $targetType,
        'target_id' => $targetId !== null ? (string)$targetId : null,
        'created_at' => date('Y-m-d H:i:s'),
    ]);

    Auth::logAudit($schoolId, $userId, 'send_notification',
        "发送通知: {$title} (target={$targetType}:{$targetId})",
        'success');

    Response::success(['id' => $notifId], '通知已发送');
}

// ===== 获取可通知的目标列表 =====
if ($method === 'GET' && $action === 'recipients') {
    $result = [
        'roles' => [
            ['value' => 'admin', 'label' => '管理员'],
            ['value' => 'teacher', 'label' => '教师'],
            ['value' => 'student', 'label' => '学生'],
        ],
        'classes' => [],
        'users' => [],
    ];

    // 获取班级列表
    $classes = DB::all("SELECT id, name, grade FROM classes WHERE school_id = ? AND status = 'active' ORDER BY grade, name", [$schoolId]);
    $result['classes'] = array_map(function($c) {
        return ['value' => (string)$c['id'], 'label' => $c['grade'] . ' - ' . $c['name']];
    }, $classes);

    // 获取用户列表
    $users = DB::all("SELECT id, username, display_name, role FROM users WHERE school_id = ? AND status = 'active' ORDER BY display_name", [$schoolId]);
    $result['users'] = array_map(function($u) {
        $roleLabel = ['admin' => '管理员', 'teacher' => '教师', 'student' => '学生'][$u['role']] ?? $u['role'];
        return ['value' => (string)$u['id'], 'label' => $u['display_name'] . ' (' . $roleLabel . ')'];
    }, $users);

    Response::success($result);
}

Response::error('未知的操作');