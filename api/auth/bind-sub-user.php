<?php
/**
 * 联盟账户绑定/解绑子用户 API
 *  GET  -> list：当前联盟账户已绑定的子用户列表
 *  POST -> bind：{ sub_user_id, alias?, permissions? } 或 { action: 'unbind', binding_id }
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireLogin();

if (!Auth::isAlliance()) {
    Response::error('仅智教联盟账户可绑定子用户', 403, 403);
}

$allianceUsername = Auth::allianceUsername();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    Response::success(Auth::listBindings($allianceUsername));
}

if ($method === 'POST') {
    $body = Helpers::jsonBody();
    $action = $body['action'] ?? 'bind';

    if ($action === 'unbind') {
        $bindingId = (int)($body['binding_id'] ?? 0);
        if (!$bindingId) Response::error('缺少 binding_id');
        $ok = Auth::unbindSubUser($allianceUsername, $bindingId);
        Response::success(['ok' => $ok], $ok ? '已解绑' : '条目不存在');
    }

    // 默认：绑定
    $subUserId = (int)($body['sub_user_id'] ?? 0);
    $alias = trim($body['alias'] ?? '');
    $permissions = $body['permissions'] ?? [];
    if (!$subUserId) Response::error('缺少 sub_user_id');
    $ok = Auth::bindSubUser($allianceUsername, $subUserId, $alias, $permissions);
    Response::success(['ok' => $ok], $ok ? '绑定成功' : '绑定失败：子用户不存在');
}

Response::error('未知的操作', 405, 405);
