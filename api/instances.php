<?php
/**
 * 实例管理 API
 *
 *  - GET  action=list                     当前所有者可见实例（含共享给本用户的）
 *  - GET  action=get&id=N                 实例详情（带应用清单）
 *  - GET  action=export                   导出实例元数据 JSON
 *  - POST action=create                   创建实例（写入 owner_key + instance_uid）
 *  - POST action=import                    批量导入
 *  - POST action=start|stop|restart       实例状态切换
 *  - POST action=delete                    删除实例（仅所有者/管理员）
 *  - POST action=share                    共享给目标用户
 *  - POST action=batch                    批量操作（start/stop/restart/delete/move）
 *  - POST action=set-config               保存实例配置（仅实例所有者）
 */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$user = Auth::user();
$ownerKey = Auth::ownerKey();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

/**
 * 当前可见实例列表：
 *  - 联盟账户：自己创建的实例 + 已加入学校的实例
 *  - 学校子用户：本校实例（按 school_id 过滤）
 *  - 实例子用户：仅本实例
 */
function listVisibleInstances(): array
{
    $user = Auth::user();
    $ownerKey = Auth::ownerKey();
    $rows = [];
    if (Auth::isInstanceSub()) {
        $rows = DB::all(
            "SELECT i.*, a.name AS app_name, a.app_key, a.category AS app_category,
                    g.name AS group_name, g.sort_order AS group_order
             FROM instances i
             LEFT JOIN apps a ON a.id = i.app_id
             LEFT JOIN instance_groups g ON g.id = i.group_id
             WHERE i.id = ?",
            [$user['instance_id']]
        );
    } elseif (Auth::isAlliance()) {
        $rows = DB::all(
            "SELECT i.*, a.name AS app_name, a.app_key, a.category AS app_category,
                    g.name AS group_name, g.sort_order AS group_order,
                    'owned' AS relation
             FROM instances i
             LEFT JOIN apps a ON a.id = i.app_id
             LEFT JOIN instance_groups g ON g.id = i.group_id
             WHERE i.owner_key = ?
             UNION ALL
             SELECT i.*, a.name AS app_name, a.app_key, a.category AS app_category,
                    NULL AS group_name, 0 AS group_order,
                    'shared' AS relation
             FROM instances i
             JOIN instance_shares s ON s.instance_id = i.id
             LEFT JOIN apps a ON a.id = i.app_id
             WHERE s.target_type = 'alliance' AND s.target_user_id = 0",
            [$ownerKey]
        );
    } else {
        $rows = DB::all(
            "SELECT i.*, a.name AS app_name, a.app_key, a.category AS app_category,
                    g.name AS group_name, g.sort_order AS group_order,
                    CASE WHEN i.owner_key = ? THEN 'owned' ELSE 'shared' END AS relation
             FROM instances i
             LEFT JOIN apps a ON a.id = i.app_id
             LEFT JOIN instance_groups g ON g.id = i.group_id
             LEFT JOIN instance_shares s ON s.instance_id = i.id AND s.target_user_id = ? AND s.target_type = 'sub'
             WHERE i.school_id = ? AND (i.owner_key = ? OR s.id IS NOT NULL)",
            [$ownerKey, $user['user_id'] ?? 0, $user['school_id'] ?? 0, $ownerKey]
        );
    }
    return $rows;
}

if ($method === 'GET' && $action === 'list') {
    $rows = listVisibleInstances();
    // 解析实例 config JSON
    foreach ($rows as &$r) {
        if (!empty($r['config'])) $r['config'] = json_decode($r['config'], true);
    }
    Response::success($rows);
}

if ($method === 'GET' && $action === 'export') {
    $rows = listVisibleInstances();
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="cses-instances-export.json"');
    echo json_encode([
        'version' => '1.0',
        'exported_at' => date('Y-m-d H:i:s'),
        'owner_key' => $ownerKey,
        'instances' => array_map(fn($r) => array_intersect_key($r, array_flip(['name', 'service_type', 'status', 'created_at'])), $rows)
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    if (!Auth::canAccessInstance($id)) Response::error('无权访问该实例', 403, 403);
    $ins = DB::one(
        "SELECT i.*, a.name AS app_name, a.app_key, a.category AS app_category,
                a.app_info_manifest, a.storage_manifest, a.editor_html, a.editor_js, a.interface_schema,
                a.control_manifest,
                g.name AS group_name
         FROM instances i
         LEFT JOIN apps a ON a.id = i.app_id
         LEFT JOIN instance_groups g ON g.id = i.group_id
         WHERE i.id = ?",
        [$id]
    );
    if (!$ins) Response::error('实例不存在');
    if (!empty($ins['app_info_manifest'])) $ins['app_info_manifest'] = json_decode($ins['app_info_manifest'], true);
    if (!empty($ins['storage_manifest'])) $ins['storage_manifest'] = json_decode($ins['storage_manifest'], true);
    if (!empty($ins['interface_schema'])) $ins['interface_schema'] = json_decode($ins['interface_schema'], true);
    if (!empty($ins['control_manifest'])) $ins['control_manifest'] = json_decode($ins['control_manifest'], true);
    if (!empty($ins['config'])) $ins['config'] = json_decode($ins['config'], true);
    $ins['can_write'] = Auth::canWriteInstance($id);
    Response::success($ins);
}

if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    $type = trim($body['service_type'] ?? '');
    $appId = (int)($body['app_id'] ?? 0);
    $groupId = (int)($body['group_id'] ?? 0);
    if ($name === '') Response::error('实例名称不能为空');
    if ($appId > 0) {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND status = 'published'", [$appId]);
        if (!$app) Response::error('所选应用不存在或未发布');
        $type = $app['category'];
    }
    $schoolId = Auth::schoolId() ?: 0;
    // 系统自动分配 instance_uid
    $instanceUid = 'inst-' . strtolower(bin2hex(random_bytes(6)));
    $now = date('Y-m-d H:i:s');
    DB::insert('instances', [
        'school_id' => $schoolId,
        'app_id' => $appId > 0 ? $appId : null,
        'name' => $name,
        'service_type' => $type,
        'status' => 'running',
        'owner_user_id' => $user['user_id'] ?? 0,
        'owner_type' => $user['type'] ?? 'sub',
        'owner_key' => $ownerKey,
        'instance_uid' => $instanceUid,
        'group_id' => $groupId > 0 ? $groupId : null,
        'config' => json_encode($body['config'] ?? [], JSON_UNESCAPED_UNICODE),
        'created_at' => $now,
    ]);
    Auth::logAudit($schoolId, $user['user_id'] ?? 0, 'create', "创建实例 {$name} (uid={$instanceUid})");
    Response::success(['instance_uid' => $instanceUid], '实例创建成功');
}

if ($method === 'POST' && $action === 'import') {
    $payload = $body['payload'] ?? null;
    if (!$payload || !isset($payload['instances'])) Response::error('导入数据格式无效');
    $count = 0;
    $schoolId = Auth::schoolId() ?: 0;
    foreach ($payload['instances'] as $row) {
        if (empty($row['name']) || empty($row['service_type'])) continue;
        $instanceUid = 'inst-' . strtolower(bin2hex(random_bytes(6)));
        DB::insert('instances', [
            'school_id' => $schoolId,
            'name' => $row['name'],
            'service_type' => $row['service_type'],
            'status' => $row['status'] ?? 'stopped',
            'owner_user_id' => $user['user_id'] ?? 0,
            'owner_type' => $user['type'] ?? 'sub',
            'owner_key' => $ownerKey,
            'instance_uid' => $instanceUid,
            'created_at' => $row['created_at'] ?? date('Y-m-d H:i:s'),
        ]);
        $count++;
    }
    Auth::logAudit($schoolId, $user['user_id'] ?? 0, 'import', "导入 {$count} 个实例");
    Response::success(['count' => $count], "成功导入 {$count} 个实例");
}

// 状态切换统一处理
if (in_array($action, ['start', 'stop', 'restart'], true) && $method === 'POST') {
    $id = (int)($body['id'] ?? 0);
    if (!Auth::canWriteInstance($id)) Response::error('无权操作该实例', 403, 403);
    $ins = DB::one("SELECT * FROM instances WHERE id = ?", [$id]);
    if (!$ins) Response::error('实例不存在');
    $newStatus = $action === 'stop' ? 'stopped' : 'running';
    $updates = ['status' => $newStatus];
    if ($action === 'stop') $updates['uptime'] = '—';
    elseif ($action === 'start') $updates['uptime'] = '99.9%';
    DB::update('instances', $updates, 'id = ?', [$id]);
    Auth::logAudit($ins['school_id'], $user['user_id'] ?? 0, $action, "{$action} 实例 {$ins['name']}");
    Response::success(null, '实例已' . ($action === 'start' ? '启动' : ($action === 'stop' ? '停止' : '重启')));
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!Auth::canWriteInstance($id)) Response::error('无权删除该实例', 403, 403);
    $ins = DB::one("SELECT * FROM instances WHERE id = ?", [$id]);
    if (!$ins) Response::error('实例不存在');
    DB::delete('instances', 'id = ?', [$id]);
    Auth::logAudit($ins['school_id'], $user['user_id'] ?? 0, 'delete', "删除实例 {$ins['name']}");
    Response::success(null, '实例已删除');
}

if ($method === 'POST' && $action === 'share') {
    $id = (int)($body['id'] ?? 0);
    if (!Auth::canWriteInstance($id)) Response::error('无权共享该实例', 403, 403);
    $targetUserId = (int)($body['target_user_id'] ?? 0);
    $targetType = $body['target_type'] ?? 'sub';
    $shareMode = $body['share_mode'] ?? 'view';
    $shareToken = bin2hex(random_bytes(8));
    $sid = DB::insert('instance_shares', [
        'instance_id' => $id,
        'shared_by_user_id' => $user['user_id'] ?? 0,
        'shared_by_type' => $user['type'] ?? 'sub',
        'target_user_id' => $targetUserId,
        'target_type' => $targetType,
        'share_mode' => $shareMode,
        'share_token' => $shareToken,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Auth::logAudit(Auth::schoolId(), $user['user_id'] ?? 0, 'share', "共享实例 id={$id} 给 target={$targetUserId}");
    Response::success(['id' => $sid, 'share_token' => $shareToken], '已共享');
}

if ($method === 'POST' && $action === 'batch') {
    $batchAction = $body['action'] ?? '';
    $ids = $body['ids'] ?? [];
    if (!is_array($ids) || !$ids) Response::error('未选择任何实例');
    $ids = array_map('intval', $ids);
    // 校验权限
    foreach ($ids as $bid) {
        if (!Auth::canWriteInstance($bid)) Response::error("实例 id={$bid} 无权操作", 403, 403);
    }
    $idList = implode(',', $ids);
    if (in_array($batchAction, ['start', 'stop', 'restart'], true)) {
        $newStatus = $batchAction === 'stop' ? 'stopped' : 'running';
        DB::query("UPDATE instances SET status = ? WHERE id IN ({$idList})", [$newStatus]);
        Auth::logAudit(Auth::schoolId(), $user['user_id'] ?? 0, 'batch', "批量 {$batchAction} 实例 ids={$idList}");
        Response::success(['count' => count($ids)], '已批量执行');
    }
    if ($batchAction === 'delete') {
        DB::query("DELETE FROM instances WHERE id IN ({$idList})", []);
        Auth::logAudit(Auth::schoolId(), $user['user_id'] ?? 0, 'batch', "批量删除实例 ids={$idList}");
        Response::success(['count' => count($ids)], '已批量删除');
    }
    if ($batchAction === 'move') {
        $groupId = (int)($body['group_id'] ?? 0);
        DB::query("UPDATE instances SET group_id = ? WHERE id IN ({$idList})", [$groupId > 0 ? $groupId : null]);
        Response::success(['count' => count($ids)], '已移动到目标分组');
    }
    Response::error('未知的批量操作');
}

if ($method === 'POST' && $action === 'set-config') {
    $id = (int)($body['id'] ?? 0);
    if (!Auth::canWriteInstance($id)) Response::error('无权修改该实例配置', 403, 403);
    $config = $body['config'] ?? [];
    DB::update('instances', ['config' => json_encode($config, JSON_UNESCAPED_UNICODE)], 'id = ?', [$id]);
    Response::success(null, '实例配置已保存');
}

Response::error('未知的操作', 405, 405);
