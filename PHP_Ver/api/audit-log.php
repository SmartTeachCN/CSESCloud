<?php
/** 审计日志 API */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET' && $action === 'list') {
    $keyword = trim($_GET['keyword'] ?? '');
    $status = $_GET['status'] ?? 'all';
    $sql = "SELECT * FROM audit_logs WHERE school_id = ?";
    $params = [$schoolId];
    if ($status !== 'all') { $sql .= " AND status = ?"; $params[] = $status; }
    if ($keyword !== '') {
        $sql .= " AND (target LIKE ? OR username LIKE ? OR action LIKE ?)";
        array_push($params, "%{$keyword}%", "%{$keyword}%", "%{$keyword}%");
    }
    $sql .= " ORDER BY id DESC LIMIT 200";
    Response::success(DB::all($sql, $params));
}

if ($method === 'GET' && $action === 'instance') {
    $instanceId = (int)($_GET['id'] ?? 0);
    if ($instanceId <= 0) Response::error('实例 ID 无效');
    $ins = DB::one("SELECT name FROM instances WHERE id = ? AND school_id = ?", [$instanceId, $schoolId]);
    if (!$ins) Response::error('实例不存在');
    $rows = DB::all(
        "SELECT * FROM audit_logs WHERE school_id = ? AND target LIKE ? ORDER BY id DESC LIMIT 100",
        [$schoolId, "%{$ins['name']}%"]
    );
    Response::success($rows);
}

if ($method === 'GET' && $action === 'stats') {
    $today = (int)DB::scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND date(created_at) = date('now')", [$schoolId]);
    $week = (int)DB::scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND created_at >= datetime('now','-7 days')", [$schoolId]);
    $failed = (int)DB::scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND status = 'failed'", [$schoolId]);
    $total = (int)DB::scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ?", [$schoolId]);
    Response::success(['today' => $today, 'week' => $week, 'failed' => $failed, 'total' => $total]);
}

Response::error('未知的操作');
