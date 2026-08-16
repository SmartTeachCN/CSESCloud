<?php
/**
 * 开发者中心 - 集控侧套餐 API
 * 仅智教联盟登录可访问
 *
 * 支持操作：
 *  - GET  action=list              列出当前开发者的集控套餐
 *  - GET  action=get&id=N          获取套餐详情
 *  - GET  action=published         列出已发布套餐（供校园集控选择）
 *  - POST action=create            创建套餐
 *  - POST action=update            更新套餐基础信息
 *  - POST action=save-manifest     保存某类清单（package/calling_instances/editor_html/editor_js/variable）
 *  - POST action=publish           发布套餐
 *  - POST action=archive           归档套餐
 *  - POST action=delete            删除套餐
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireAlliance();
$developer = Auth::allianceUsername();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'list') {
    $rows = DB::all(
        "SELECT id, package_key, name, version, description, status, created_at, updated_at
         FROM cc_packages WHERE developer_username = ? ORDER BY id DESC",
        [$developer]
    );
    Response::success($rows);
}

if ($method === 'GET' && $action === 'published') {
    $rows = DB::all(
        "SELECT id, package_key, name, version, description
         FROM cc_packages WHERE status = 'published' ORDER BY name ASC"
    );
    Response::success($rows);
}

if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $pkg = DB::one("SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$pkg) Response::error('套餐不存在');
    foreach (['package_manifest', 'calling_instances_manifest', 'variable_manifest'] as $k) {
        $pkg[$k] = $pkg[$k] ? json_decode($pkg[$k], true) : null;
    }
    Response::success($pkg);
}

if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    if ($name === '') Response::error('套餐名称不能为空');
    $now = date('Y-m-d H:i:s');
    $packageKey = 'cc_' . substr(md5($developer . $name . microtime(true)), 0, 12);
    $id = DB::insert('cc_packages', [
        'developer_username' => $developer,
        'package_key' => $packageKey,
        'name' => $name,
        'version' => $body['version'] ?? '1.0.0',
        'description' => $body['description'] ?? '',
        'status' => 'draft',
        'package_manifest' => json_encode([
            'name' => $name,
            'version' => $body['version'] ?? '1.0.0',
            'description' => $body['description'] ?? '',
            'author' => $developer,
            'target_audience' => 'teacher',
            'tags' => [],
        ], JSON_UNESCAPED_UNICODE),
        'calling_instances_manifest' => json_encode(['instances' => []], JSON_UNESCAPED_UNICODE),
        'editor_html' => '',
        'editor_js' => '',
        'variable_manifest' => json_encode(['variables' => []], JSON_UNESCAPED_UNICODE),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    Auth::logAudit(0, 0, 'create', "开发者 {$developer} 创建集控套餐 {$name}");
    Response::success(['id' => $id, 'package_key' => $packageKey], '套餐创建成功');
}

if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    $pkg = DB::one("SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$pkg) Response::error('套餐不存在');
    $updates = [];
    if (isset($body['name'])) $updates['name'] = trim($body['name']);
    if (isset($body['version'])) $updates['version'] = trim($body['version']);
    if (isset($body['description'])) $updates['description'] = $body['description'];
    $updates['updated_at'] = date('Y-m-d H:i:s');
    DB::update('cc_packages', $updates, 'id = ? AND developer_username = ?', [$id, $developer]);
    Response::success(null, '已保存');
}

if ($method === 'POST' && $action === 'save-manifest') {
    $id = (int)($body['id'] ?? 0);
    $type = $body['type'] ?? ''; // package | calling_instances | editor_html | editor_js | variable
    $pkg = DB::one("SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$pkg) Response::error('套餐不存在');

    $fieldMap = [
        'package' => 'package_manifest',
        'calling_instances' => 'calling_instances_manifest',
        'editor_html' => 'editor_html',
        'editor_js' => 'editor_js',
        'variable' => 'variable_manifest',
    ];
    if (!isset($fieldMap[$type])) Response::error('未知的清单类型');
    $field = $fieldMap[$type];
    $value = $body['value'] ?? null;
    if (in_array($type, ['package', 'calling_instances', 'variable'], true)) {
        if (!is_array($value)) Response::error('清单数据格式无效');
        $value = json_encode($value, JSON_UNESCAPED_UNICODE);
    } else {
        $value = (string)$value;
    }
    DB::update('cc_packages', [$field => $value, 'updated_at' => date('Y-m-d H:i:s')], 'id = ? AND developer_username = ?', [$id, $developer]);
    Auth::logAudit(0, 0, 'update', "开发者 {$developer} 保存套餐清单 {$type} (pkg_id={$id})");
    Response::success(null, '清单已保存');
}

if ($method === 'POST' && $action === 'publish') {
    $id = (int)($body['id'] ?? 0);
    $pkg = DB::one("SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$pkg) Response::error('套餐不存在');
    if (empty($pkg['package_manifest'])) Response::error('发布前请先完成集控套餐清单');
    DB::update('cc_packages', ['status' => 'published', 'updated_at' => date('Y-m-d H:i:s')], 'id = ? AND developer_username = ?', [$id, $developer]);
    Auth::logAudit(0, 0, 'update', "开发者 {$developer} 发布套餐 {$pkg['name']}");
    Response::success(null, '套餐已发布');
}

if ($method === 'POST' && $action === 'archive') {
    $id = (int)($body['id'] ?? 0);
    DB::update('cc_packages', ['status' => 'archived', 'updated_at' => date('Y-m-d H:i:s')], 'id = ? AND developer_username = ?', [$id, $developer]);
    Response::success(null, '套餐已归档');
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    $pkg = DB::one("SELECT * FROM cc_packages WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$pkg) Response::error('套餐不存在');
    DB::delete('cc_packages', 'id = ? AND developer_username = ?', [$id, $developer]);
    Auth::logAudit(0, 0, 'delete', "开发者 {$developer} 删除套餐 {$pkg['name']}");
    Response::success(null, '套餐已删除');
}

Response::error('未知的操作');
