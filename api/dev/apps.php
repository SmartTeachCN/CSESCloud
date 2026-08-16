<?php
/**
 * 开发者中心 - 实例侧应用 API
 *
 * 公开操作（无需联盟登录）：
 *  - GET  action=published         列出已发布应用（供实例创建选择）
 *  - GET  action=shared-list       列出共享市场中的应用
 *  - GET  action=shared-get&id=N   获取共享市场应用详情（只读）
 *
 * 需要智教联盟登录：
 *  - GET  action=list              列出当前开发者的应用
 *  - GET  action=get&id=N          获取应用详情
 *  - POST action=create            创建应用
 *  - POST action=update            更新应用基础信息
 *  - POST action=save-manifest     保存某类清单（app_info/editor/storage/interface/control）
 *  - POST action=publish           发布应用
 *  - POST action=archive           归档应用
 *  - POST action=delete            删除应用
 *  - POST action=share              切换共享状态（共享到市场 / 取消共享）
 *  - POST action=fork               fork 共享市场应用到自己的应用列表
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== [公开] 列出已发布应用（供实例创建时选择） =====
if ($method === 'GET' && $action === 'published') {
    $rows = DB::all(
        "SELECT id, app_key, name, version, description, category
         FROM apps WHERE status = 'published' ORDER BY name ASC"
    );
    Response::success($rows);
}

// ===== [公开] 列出共享市场应用 =====
if ($method === 'GET' && $action === 'shared-list') {
    $keyword = trim($_GET['keyword'] ?? '');
    $sql = "SELECT id, app_key, name, version, description, category, status,
                   developer_username, is_official, forked_from, forked_by, created_at, updated_at
            FROM apps WHERE is_shared = 1 ";
    $params = [];
    if ($keyword !== '') {
        $sql .= " AND (name LIKE ? OR description LIKE ? OR app_key LIKE ?) ";
        $kw = '%' . $keyword . '%';
        $params = [$kw, $kw, $kw];
    }
    $sql .= " ORDER BY is_official DESC, updated_at DESC";
    $rows = DB::all($sql, $params);
    Response::success($rows);
}

// ===== [公开] 获取共享市场应用详情（只读） =====
if ($method === 'GET' && $action === 'shared-get') {
    $id = (int)($_GET['id'] ?? 0);
    $app = DB::one(
        "SELECT id, app_key, name, version, description, category, status,
                developer_username, forked_from, forked_by, created_at, updated_at,
                app_info_manifest, editor_html, editor_js, storage_manifest, interface_schema, control_manifest
         FROM apps WHERE id = ? AND is_shared = 1",
        [$id]
    );
    if (!$app) Response::error('共享应用不存在或未公开');
    foreach (['app_info_manifest', 'storage_manifest', 'interface_schema', 'control_manifest'] as $k) {
        $app[$k] = $app[$k] ? json_decode($app[$k], true) : null;
    }
    Response::success($app);
}

// ===== 以下需要联盟登录 =====
Auth::requireAlliance();
$developer = Auth::allianceUsername();
$isSuperAdmin = Auth::isSuperAdmin();
// 系统管理员使用自身用户名作为开发者标识
$effectiveDeveloper = $developer !== '' ? $developer : (Auth::user()['username'] ?? 'super_admin');

// ===== 列出我的应用 =====
if ($method === 'GET' && $action === 'list') {
    if ($isSuperAdmin) {
        $rows = DB::all(
            "SELECT id, app_key, name, version, description, category, status, is_shared, is_official, created_at, updated_at
             FROM apps ORDER BY id DESC"
        );
    } else {
        $rows = DB::all(
            "SELECT id, app_key, name, version, description, category, status, is_shared, is_official, created_at, updated_at
             FROM apps WHERE developer_username = ? ORDER BY id DESC",
            [$developer]
        );
    }
    Response::success($rows);
}

// ===== 获取应用详情 =====
if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    if ($isSuperAdmin) {
        $app = DB::one("SELECT * FROM apps WHERE id = ?", [$id]);
    } else {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND developer_username = ?", [$id, $developer]);
    }
    if (!$app) Response::error('应用不存在');
    // 解析 JSON 字段
    foreach (['app_info_manifest', 'storage_manifest', 'interface_schema', 'control_manifest'] as $k) {
        $app[$k] = $app[$k] ? json_decode($app[$k], true) : null;
    }
    Response::success($app);
}

// ===== 创建应用 =====
if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    if ($name === '') Response::error('应用名称不能为空');
    $now = date('Y-m-d H:i:s');
    $appKey = 'app_' . substr(md5($effectiveDeveloper . $name . microtime(true)), 0, 12);
    $isOfficial = 0;
    if (!empty($body['is_official']) && Auth::isSuperAdmin()) {
        $isOfficial = 1;
    }
    $id = DB::insert('apps', [
        'developer_username' => $effectiveDeveloper,
        'app_key' => $appKey,
        'name' => $name,
        'version' => $body['version'] ?? '1.0.0',
        'description' => $body['description'] ?? '',
        'category' => $body['category'] ?? '通用',
        'status' => 'draft',
        'is_official' => $isOfficial,
        'app_info_manifest' => json_encode([
            'name' => $name,
            'version' => $body['version'] ?? '1.0.0',
            'description' => $body['description'] ?? '',
            'category' => $body['category'] ?? '通用',
            'author' => $effectiveDeveloper,
            'homepage' => '',
            'tags' => [],
            'icon' => 'ri-apps-2-line',
        ], JSON_UNESCAPED_UNICODE),
        'editor_html' => '',
        'editor_js' => '',
        'storage_manifest' => json_encode(['collections' => []], JSON_UNESCAPED_UNICODE),
        'interface_schema' => json_encode(['endpoints' => []], JSON_UNESCAPED_UNICODE),
        'control_manifest' => json_encode(['enabled' => false, 'protocolVersion' => 1, 'supportedCommands' => [], 'description' => ''], JSON_UNESCAPED_UNICODE),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    Auth::logAudit(0, 0, 'create', "开发者 {$effectiveDeveloper} 创建应用 {$name}");
    Response::success(['id' => $id, 'app_key' => $appKey], '应用创建成功');
}

// ===== 更新基础信息 =====
if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    if ($isSuperAdmin) {
        $app = DB::one("SELECT * FROM apps WHERE id = ?", [$id]);
    } else {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND developer_username = ?", [$id, $developer]);
    }
    if (!$app) Response::error('应用不存在');
    $updates = [];
    if (isset($body['name'])) $updates['name'] = trim($body['name']);
    if (isset($body['version'])) $updates['version'] = trim($body['version']);
    if (isset($body['description'])) $updates['description'] = $body['description'];
    if (isset($body['category'])) $updates['category'] = $body['category'];
    $updates['updated_at'] = date('Y-m-d H:i:s');
    DB::update('apps', $updates, 'id = ?', [$id]);
    Response::success(null, '已保存');
}

// ===== 保存某类清单 =====
if ($method === 'POST' && $action === 'save-manifest') {
    $id = (int)($body['id'] ?? 0);
    $type = $body['type'] ?? ''; // app_info | editor_html | editor_js | storage | interface
    if ($isSuperAdmin) {
        $app = DB::one("SELECT * FROM apps WHERE id = ?", [$id]);
    } else {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND developer_username = ?", [$id, $developer]);
    }
    if (!$app) Response::error('应用不存在');

    $fieldMap = [
        'app_info' => 'app_info_manifest',
        'editor_html' => 'editor_html',
        'editor_js' => 'editor_js',
        'storage' => 'storage_manifest',
        'interface' => 'interface_schema',
        'control' => 'control_manifest',
    ];
    if (!isset($fieldMap[$type])) Response::error('未知的清单类型');
    $field = $fieldMap[$type];
    $value = $body['value'] ?? null;
    // JSON 类清单需编码
    if (in_array($type, ['app_info', 'storage', 'interface', 'control'], true)) {
        if (!is_array($value)) Response::error('清单数据格式无效');
        $value = json_encode($value, JSON_UNESCAPED_UNICODE);
    } else {
        $value = (string)$value;
    }
    DB::update('apps', [$field => $value, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'update', "开发者 {$developer} 保存应用清单 {$type} (app_id={$id})");
    Response::success(null, '清单已保存');
}

// ===== 发布应用 =====
if ($method === 'POST' && $action === 'publish') {
    $id = (int)($body['id'] ?? 0);
    if ($isSuperAdmin) {
        $app = DB::one("SELECT * FROM apps WHERE id = ?", [$id]);
    } else {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND developer_username = ?", [$id, $developer]);
    }
    if (!$app) Response::error('应用不存在');
    // 校验必填清单
    if (empty($app['app_info_manifest']) || empty($app['storage_manifest'])) {
        Response::error('发布前请先完成应用信息清单与实例存储清单');
    }
    DB::update('apps', ['status' => 'published', 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'update', "开发者 {$developer} 发布应用 {$app['name']}");
    Response::success(null, '应用已发布');
}

// ===== 归档应用 =====
if ($method === 'POST' && $action === 'archive') {
    $id = (int)($body['id'] ?? 0);
    DB::update('apps', ['status' => 'archived', 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$id]);
    Response::success(null, '应用已归档');
}

// ===== 删除应用 =====
if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if ($isSuperAdmin) {
        $app = DB::one("SELECT * FROM apps WHERE id = ?", [$id]);
    } else {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND developer_username = ?", [$id, $developer]);
    }
    if (!$app) Response::error('应用不存在');
    DB::delete('apps', 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'delete', "开发者 {$developer} 删除应用 {$app['name']}");
    Response::success(null, '应用已删除');
}

// ===== 切换共享状态（共享到市场/取消共享） =====
if ($method === 'POST' && $action === 'share') {
    $id = (int)($body['id'] ?? 0);
    if ($isSuperAdmin) {
        $app = DB::one("SELECT * FROM apps WHERE id = ?", [$id]);
    } else {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND developer_username = ?", [$id, $developer]);
    }
    if (!$app) Response::error('应用不存在');
    $newShared = $app['is_shared'] ? 0 : 1;
    DB::update('apps', [
        'is_shared' => $newShared,
        'updated_at' => date('Y-m-d H:i:s'),
    ], 'id = ?', [$id]);
    Auth::logAudit(0, 0, 'update', "开发者 {$developer} " . ($newShared ? '共享' : '取消共享') . " 应用 {$app['name']}");
    Response::success(['is_shared' => $newShared], $newShared ? '已共享到市场' : '已取消共享');
}

// ===== Fork 共享市场应用到自己的应用列表 =====
if ($method === 'POST' && $action === 'fork') {
    $id = (int)($body['id'] ?? 0);
    $src = DB::one("SELECT * FROM apps WHERE id = ? AND is_shared = 1", [$id]);
    if (!$src) Response::error('源应用不存在或未共享');
    if ($src['developer_username'] === $effectiveDeveloper) Response::error('不能 fork 自己的应用');
    $now = date('Y-m-d H:i:s');
    $newKey = 'app_' . substr(md5($effectiveDeveloper . $src['name'] . microtime(true)), 0, 12);
    $newId = DB::insert('apps', [
        'developer_username' => $effectiveDeveloper,
        'app_key' => $newKey,
        'name' => $src['name'],
        'version' => $src['version'],
        'description' => $src['description'],
        'category' => $src['category'],
        'status' => 'draft',
        'is_shared' => 0,
        'forked_from' => $src['id'],
        'forked_by' => $src['developer_username'],
        'app_info_manifest' => $src['app_info_manifest'],
        'editor_html' => $src['editor_html'],
        'editor_js' => $src['editor_js'],
        'storage_manifest' => $src['storage_manifest'],
        'interface_schema' => $src['interface_schema'],
        'control_manifest' => $src['control_manifest'],
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    Auth::logAudit(0, 0, 'create', "开发者 {$effectiveDeveloper} fork 应用 {$src['name']} (源 id={$id})");
    Response::success(['id' => $newId, 'app_key' => $newKey], '已 fork 到我的应用列表');
}

Response::error('未知的操作');
