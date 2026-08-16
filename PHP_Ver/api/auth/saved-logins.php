<?php
/**
 * 保留登录条目 API
 *  GET  -> list 返回所有保留登录
 *  POST -> save 新增（已存在则返回原 id）
 *  DELETE -> remove
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireLogin();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    Response::success(Auth::listSavedLogins());
}

if ($method === 'POST') {
    $body = Helpers::jsonBody();
    $entryType = trim($body['entry_type'] ?? '');
    $displayLabel = trim($body['display_label'] ?? '');
    $subUsername = trim($body['sub_username'] ?? '');
    $schoolId = $body['school_id'] ?? null;
    $instanceUid = trim($body['instance_uid'] ?? '');
    if (!in_array($entryType, ['school_sub', 'instance_sub'], true) || !$subUsername) {
        Response::error('参数错误');
    }
    $id = Auth::saveLogin([
        'entry_type' => $entryType,
        'display_label' => $displayLabel ?: ($subUsername . '@' . ($instanceUid ?: ('SID:' . $schoolId))),
        'school_id' => $schoolId ? (int)$schoolId : null,
        'instance_uid' => $instanceUid ?: null,
        'sub_username' => $subUsername,
    ]);
    Response::success(['id' => $id], '已保留到登录列表');
}

if ($method === 'DELETE') {
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) Response::error('缺少 id');
    Auth::removeSavedLogin($id);
    Response::success(null, '已从列表移除');
}

Response::error('未知的操作', 405, 405);
