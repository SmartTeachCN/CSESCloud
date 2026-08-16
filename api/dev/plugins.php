<?php
/**
 * 开发者中心 - 编辑器插件 API
 *
 * 公开操作（无需登录）：
 *  - GET  action=resolver&ext=xxx        根据文件后缀解析对应的编辑器插件
 *  - GET  action=published               列出已发布插件（供编辑器使用）
 *  - GET  action=shared-list             列出共享市场插件
 *
 * 需要智教联盟登录：
 *  - GET  action=list                    列出当前开发者的插件
 *  - GET  action=get&id=N                获取插件详情
 *  - POST action=create                  创建插件
 *  - POST action=update                  更新插件
 *  - POST action=publish                 发布插件
 *  - POST action=archive                 归档插件
 *  - POST action=delete                  删除插件
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== [公开] 根据文件后缀解析编辑器插件 =====
if ($method === 'GET' && $action === 'resolver') {
    $ext = strtolower(trim($_GET['ext'] ?? ''));
    if ($ext === '') Response::error('缺少文件后缀');
    $rows = DB::all(
        "SELECT id, plugin_key, name, editor_html, editor_js, editor_css, icon, is_official, extensions
         FROM editor_plugins WHERE status = 'published' ORDER BY is_official DESC, id ASC"
    );
    foreach ($rows as $r) {
        $extensions = $r['extensions'] ? json_decode($r['extensions'], true) : [];
        if (is_array($extensions) && in_array($ext, $extensions)) {
            $r['extensions'] = $extensions;
            Response::success($r);
            exit;
        }
    }
    Response::success(null);
}

// ===== [公开] 列出已发布插件 =====
if ($method === 'GET' && $action === 'published') {
    $rows = DB::all(
        "SELECT id, plugin_key, name, version, description, extensions, editor_html, editor_js, editor_css, icon, is_official
         FROM editor_plugins WHERE status = 'published' ORDER BY is_official DESC, id ASC"
    );
    foreach ($rows as &$r) {
        $r['extensions'] = $r['extensions'] ? json_decode($r['extensions'], true) : [];
    }
    Response::success($rows);
}

// ===== [公开] 列出共享市场插件 =====
if ($method === 'GET' && $action === 'shared-list') {
    $keyword = trim($_GET['keyword'] ?? '');
    $sql = "SELECT id, plugin_key, name, version, description, extensions, icon, status,
                   developer_username, is_official, created_at, updated_at
            FROM editor_plugins WHERE status = 'published' ";
    $params = [];
    if ($keyword !== '') {
        $sql .= " AND (name LIKE ? OR description LIKE ? OR plugin_key LIKE ?) ";
        $kw = '%' . $keyword . '%';
        $params = [$kw, $kw, $kw];
    }
    $sql .= " ORDER BY is_official DESC, updated_at DESC";
    $rows = DB::all($sql, $params);
    foreach ($rows as &$r) {
        $r['extensions'] = $r['extensions'] ? json_decode($r['extensions'], true) : [];
    }
    Response::success($rows);
}

// ===== 以下需要联盟登录 =====
Auth::requireAlliance();
$developer = Auth::allianceUsername();

// ===== 列出我的插件 =====
if ($method === 'GET' && $action === 'list') {
    $rows = DB::all(
        "SELECT id, plugin_key, name, version, description, extensions, icon, status, is_official, created_at, updated_at
         FROM editor_plugins WHERE developer_username = ? ORDER BY id DESC",
        [$developer]
    );
    // 解析 extensions JSON
    foreach ($rows as &$r) {
        $r['extensions'] = $r['extensions'] ? json_decode($r['extensions'], true) : [];
    }
    Response::success($rows);
}

// ===== 获取插件详情 =====
if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $plugin = DB::one("SELECT * FROM editor_plugins WHERE id = ? AND (developer_username = ? OR is_official = 1)", [$id, $developer]);
    if (!$plugin) Response::error('插件不存在');
    $plugin['extensions'] = $plugin['extensions'] ? json_decode($plugin['extensions'], true) : [];
    Response::success($plugin);
}

// ===== 创建插件 =====
if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    if ($name === '') Response::error('插件名称不能为空');
    $extensions = $body['extensions'] ?? [];
    if (!is_array($extensions) || count($extensions) === 0) Response::error('至少注册一个文件后缀');
    $now = date('Y-m-d H:i:s');
    $pluginKey = 'plugin_' . substr(md5($developer . $name . microtime(true)), 0, 12);
    $id = DB::insert('editor_plugins', [
        'developer_username' => $developer,
        'plugin_key' => $pluginKey,
        'name' => $name,
        'version' => $body['version'] ?? '1.0.0',
        'description' => $body['description'] ?? '',
        'extensions' => json_encode($extensions),
        'editor_html' => $body['editor_html'] ?? '<div id="app"></div>',
        'editor_js' => $body['editor_js'] ?? '// 自定义编辑器 JS',
        'editor_css' => $body['editor_css'] ?? '',
        'icon' => $body['icon'] ?? 'ri-plug-line',
        'status' => 'draft',
        'is_official' => 0,
        'created_at' => $now,
        'updated_at' => $now
    ]);
    Response::success(['id' => $id, 'plugin_key' => $pluginKey]);
}

// ===== 更新插件 =====
if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    $plugin = DB::one("SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$plugin) Response::error('插件不存在或无权编辑');
    $now = date('Y-m-d H:i:s');
    $updates = ['updated_at' => $now];
    foreach (['name', 'version', 'description', 'editor_html', 'editor_js', 'editor_css', 'icon'] as $k) {
        if (isset($body[$k])) $updates[$k] = $body[$k];
    }
    if (isset($body['extensions']) && is_array($body['extensions'])) {
        $updates['extensions'] = json_encode($body['extensions']);
    }
    DB::update('editor_plugins', $updates, 'id = :id', ['id' => $id]);
    Response::success(['ok' => true]);
}

// ===== 发布插件 =====
if ($method === 'POST' && $action === 'publish') {
    $id = (int)($body['id'] ?? 0);
    $plugin = DB::one("SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$plugin) Response::error('插件不存在或无权编辑');
    DB::update('editor_plugins', ['status' => 'published', 'updated_at' => date('Y-m-d H:i:s')], 'id = :id', ['id' => $id]);
    Response::success(['ok' => true]);
}

// ===== 归档插件 =====
if ($method === 'POST' && $action === 'archive') {
    $id = (int)($body['id'] ?? 0);
    $plugin = DB::one("SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$plugin) Response::error('插件不存在或无权编辑');
    DB::update('editor_plugins', ['status' => 'archived', 'updated_at' => date('Y-m-d H:i:s')], 'id = :id', ['id' => $id]);
    Response::success(['ok' => true]);
}

// ===== 删除插件 =====
if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    $plugin = DB::one("SELECT id FROM editor_plugins WHERE id = ? AND developer_username = ?", [$id, $developer]);
    if (!$plugin) Response::error('插件不存在或无权编辑');
    DB::delete('editor_plugins', 'id = :id', ['id' => $id]);
    Response::success(['ok' => true]);
}

Response::error('未知操作');