<?php
/**
 * 实例存储数据 API
 * 按实例存储清单（storage_manifest）格式存储数据
 * 平台自动生成的多类型编辑器（带Tab和搜索框）通过此 API 读写数据
 *
 * 操作：
 *  - GET  action=list&instance_id=N&collection_key=K    列出某集合的记录
 *  - GET  action=collections&instance_id=N              列出实例所有集合及字段定义
 *  - POST action=save                                    保存/更新一条记录
 *  - POST action=delete                                  删除一条记录
 */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// 校验实例归属
function assertInstance($instanceId, $schoolId) {
    $ins = DB::one("SELECT * FROM instances WHERE id = ? AND school_id = ?", [$instanceId, $schoolId]);
    if (!$ins) Response::error('实例不存在');
    return $ins;
}

// 取实例的存储清单
function getStorageManifest($instanceId) {
    $app = DB::one("SELECT a.storage_manifest FROM instances i JOIN apps a ON a.id = i.app_id WHERE i.id = ?", [$instanceId]);
    if (!$app || empty($app['storage_manifest'])) return ['collections' => []];
    $m = json_decode($app['storage_manifest'], true);
    return $m ?: ['collections' => []];
}

// ===== 列出实例的所有集合及字段定义（供自动生成编辑器渲染 Tab） =====
if ($method === 'GET' && $action === 'collections') {
    $instanceId = (int)($_GET['instance_id'] ?? 0);
    assertInstance($instanceId, $schoolId);
    $manifest = getStorageManifest($instanceId);
    $collections = $manifest['collections'] ?? [];
    // 为每个集合附带记录数
    foreach ($collections as &$col) {
        $key = $col['key'] ?? '';
        $col['record_count'] = $key ? (int)DB::scalar("SELECT COUNT(*) FROM instance_storage_data WHERE instance_id = ? AND collection_key = ?", [$instanceId, $key]) : 0;
    }
    Response::success(['collections' => $collections]);
}

// ===== 列出某集合的记录（支持搜索） =====
if ($method === 'GET' && $action === 'list') {
    $instanceId = (int)($_GET['instance_id'] ?? 0);
    $collectionKey = $_GET['collection_key'] ?? '';
    $keyword = trim($_GET['keyword'] ?? '');
    assertInstance($instanceId, $schoolId);
    if ($collectionKey === '') Response::error('collection_key 不能为空');
    $rows = DB::all(
        "SELECT * FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? ORDER BY id DESC",
        [$instanceId, $collectionKey]
    );
    // 解析 data JSON 并按关键字过滤
    $list = [];
    foreach ($rows as $r) {
        $d = json_decode($r['data'], true) ?: [];
        $r['data'] = $d;
        if ($keyword !== '') {
            $hay = json_encode($d, JSON_UNESCAPED_UNICODE);
            if (stripos($hay, $keyword) === false) continue;
        }
        $list[] = $r;
    }
    Response::success($list);
}

// ===== 保存/更新记录 =====
if ($method === 'POST' && $action === 'save') {
    $instanceId = (int)($body['instance_id'] ?? 0);
    $collectionKey = trim($body['collection_key'] ?? '');
    // 兼容两种格式：{ record: { record_id, data } } 或 { record_id, data }
    $record = $body['record'] ?? null;
    if (is_array($record)) {
        $recordId = trim($record['record_id'] ?? '');
        $data = $record['data'] ?? [];
    } else {
        $recordId = trim($body['record_id'] ?? '');
        $data = $body['data'] ?? [];
    }
    assertInstance($instanceId, $schoolId);
    if ($collectionKey === '') Response::error('collection_key 不能为空');
    $now = date('Y-m-d H:i:s');
    if ($recordId === '') $recordId = 'r_' . substr(md5($instanceId . $collectionKey . microtime(true)), 0, 10);
    // 检查是否存在
    $exist = DB::one("SELECT id FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?", [$instanceId, $collectionKey, $recordId]);
    if ($exist) {
        DB::update('instance_storage_data', ['data' => json_encode($data, JSON_UNESCAPED_UNICODE), 'updated_at' => $now], 'id = ?', [$exist['id']]);
    } else {
        DB::insert('instance_storage_data', [
            'instance_id' => $instanceId,
            'collection_key' => $collectionKey,
            'record_id' => $recordId,
            'data' => json_encode($data, JSON_UNESCAPED_UNICODE),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
    Response::success(['record_id' => $recordId], '已保存');
}

// ===== 删除记录 =====
if ($method === 'POST' && $action === 'delete') {
    $instanceId = (int)($body['instance_id'] ?? 0);
    $recordId = trim($body['record_id'] ?? '');
    $collectionKey = trim($body['collection_key'] ?? '');
    assertInstance($instanceId, $schoolId);
    DB::delete('instance_storage_data', 'instance_id = ? AND collection_key = ? AND record_id = ?', [$instanceId, $collectionKey, $recordId]);
    Response::success(null, '已删除');
}

Response::error('未知的操作');
