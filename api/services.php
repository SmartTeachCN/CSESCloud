<?php
/** 服务详情 API */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'list') {
    Response::success(DB::all("SELECT * FROM services WHERE school_id = ? ORDER BY id ASC", [$schoolId]));
}

if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $svc = DB::one("SELECT * FROM services WHERE id = ? AND school_id = ?", [$id, $schoolId]);
    if (!$svc) Response::error('服务不存在');
    Response::success($svc);
}

if ($method === 'POST' && $action === 'update-status') {
    $id = (int)($body['id'] ?? 0);
    $status = $body['status'] ?? '';
    if (!in_array($status, ['running', 'stopped', 'maintenance'])) Response::error('无效状态');
    $svc = DB::one("SELECT * FROM services WHERE id = ? AND school_id = ?", [$id, $schoolId]);
    if (!$svc) Response::error('服务不存在');
    DB::update('services', ['status' => $status], 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'update', "修改服务 {$svc['name']} 状态为 {$status}");
    Response::success(null, '状态已更新');
}

Response::error('未知的操作');
