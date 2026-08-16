<?php
/**
 * 实例分组 API
 *  - GET  action=list         当前所有者的分组列表
 *  - POST action=create       { name, sort_order? }
 *  - POST action=update       { id, name?, sort_order? }
 *  - POST action=delete       { id }
 *  - POST action=move         { instance_id, group_id }  将实例移至分组（group_id=0 表示移出分组）
 */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$user = Auth::user();
$ownerKey = Auth::ownerKey();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'list') {
    $rows = DB::all(
        "SELECT g.*,
                (SELECT COUNT(*) FROM instances i WHERE i.group_id = g.id AND i.owner_key = g.owner_key) AS instance_count
         FROM instance_groups g
         WHERE g.owner_key = ?
         ORDER BY g.sort_order ASC, g.id ASC",
        [$ownerKey]
    );
    Response::success($rows);
}

if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    $sortOrder = (int)($body['sort_order'] ?? 0);
    if ($name === '') Response::error('分组名称不能为空');
    $id = DB::insert('instance_groups', [
        'owner_user_id' => $user['user_id'] ?? 0,
        'owner_type' => $user['type'] ?? 'sub',
        'owner_key' => $ownerKey,
        'name' => $name,
        'sort_order' => $sortOrder,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Response::success(['id' => $id], '分组已创建');
}

if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少 id');
    $row = DB::one("SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?", [$id, $ownerKey]);
    if (!$row) Response::error('分组不存在或无权修改', 403, 403);
    $updates = [];
    if (isset($body['name'])) $updates['name'] = trim($body['name']);
    if (isset($body['sort_order'])) $updates['sort_order'] = (int)$body['sort_order'];
    if (!$updates) Response::error('无更新字段');
    DB::update('instance_groups', $updates, 'id = ? AND owner_key = ?', [$id, $ownerKey]);
    Response::success(null, '分组已更新');
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少 id');
    $row = DB::one("SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?", [$id, $ownerKey]);
    if (!$row) Response::error('分组不存在或无权删除', 403, 403);
    DB::delete('instance_groups', 'id = ? AND owner_key = ?', [$id, $ownerKey]);
    // 将该分组下的实例的 group_id 置空（仅当前所有者）
    DB::query("UPDATE instances SET group_id = NULL WHERE group_id = ? AND owner_key = ?", [$id, $ownerKey]);
    Response::success(null, '分组已删除');
}

if ($method === 'POST' && $action === 'move') {
    $instanceId = (int)($body['instance_id'] ?? 0);
    $groupId = (int)($body['group_id'] ?? 0);
    if (!$instanceId) Response::error('缺少 instance_id');
    if (!Auth::canWriteInstance($instanceId)) Response::error('无权移动该实例', 403, 403);
    if ($groupId > 0) {
        $g = DB::one("SELECT id FROM instance_groups WHERE id = ? AND owner_key = ?", [$groupId, $ownerKey]);
        if (!$g) Response::error('目标分组不存在');
    }
    DB::update('instances', ['group_id' => $groupId > 0 ? $groupId : null], 'id = ?', [$instanceId]);
    Response::success(null, '已移动');
}

Response::error('未知的操作', 405, 405);
