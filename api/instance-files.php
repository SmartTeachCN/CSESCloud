<?php
/**
 * 实例文件系统 API
 *
 * 实例的所有配置文件存储在 cloud_files 表中，通过 directory 字段隔离：
 *   /instances/{instance_uid}/          配置根目录
 *   /instances/{instance_uid}/php/      PHP 后端目录
 *
 * 操作：
 *  - GET  action=list&instance_id=N&dir=        列出指定目录下的文件
 *  - GET  action=get&id=N                        获取单个文件（含内容）
 *  - POST action=save                            创建或更新文件
 *  - POST action=delete                          删除文件
 *  - GET  action=resolve-editor&ext=xxx          根据文件后缀解析编辑器插件
 *  - GET  action=storage-stats&instance_id=N     获取实例存储统计
 *  - GET  action=file-tree&instance_id=N         获取实例文件树（含目录结构）
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== [公开] 根据后缀解析编辑器插件 =====
if ($method === 'GET' && $action === 'resolve-editor') {
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

Auth::requireLogin();

// ===== 列出实例目录下的文件 =====
if ($method === 'GET' && $action === 'list') {
    $instanceId = (int)($_GET['instance_id'] ?? 0);
    $dir = trim($_GET['dir'] ?? '');
    if ($instanceId <= 0) Response::error('缺少实例 ID');
    if (!Auth::canAccessInstance($instanceId)) Response::error('无权访问该实例', 403, 403);

    $inst = DB::one("SELECT instance_uid FROM instances WHERE id = ?", [$instanceId]);
    if (!$inst) Response::error('实例不存在');

    $instanceUid = $inst['instance_uid'];
    $baseDir = '/instances/' . $instanceUid . '/';
    $searchDir = $baseDir . ($dir !== '' ? ltrim($dir, '/') . '/' : '');

    $rows = DB::all(
        "SELECT id, directory, name, file_type, file_category, file_size, status, created_at, updated_at
         FROM cloud_files
         WHERE instance_id = ? AND directory = ?
         ORDER BY file_category ASC, name ASC",
        [$instanceId, $searchDir]
    );

    // 统计子目录（通过 directory 前缀匹配）
    $subDirs = DB::all(
        "SELECT DISTINCT directory
         FROM cloud_files
         WHERE instance_id = ? AND directory LIKE ? AND directory != ?",
        [$instanceId, $searchDir . '%', $searchDir]
    );

    $dirs = [];
    foreach ($subDirs as $sd) {
        $rel = substr($sd['directory'], strlen($baseDir));
        $rel = rtrim($rel, '/');
        if ($rel !== '' && $rel !== $dir) {
            $parts = explode('/', $rel);
            // 只取直接子目录
            $depth = substr_count($dir, '/') + ($dir !== '' ? 1 : 0);
            if (count($parts) === $depth || ($dir === '' && count($parts) === 1)) {
                $dirs[] = $parts[count($parts) - 1];
            }
        }
    }
    $dirs = array_unique($dirs);

    Response::success([
        'files' => $rows,
        'directories' => array_values($dirs),
        'current_dir' => $dir !== '' ? $dir : '',
        'base_dir' => $baseDir,
    ]);
}

// ===== 获取单个文件 =====
if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $file = DB::one("SELECT * FROM cloud_files WHERE id = ?", [$id]);
    if (!$file) Response::error('文件不存在');
    if ($file['instance_id'] && !Auth::canAccessInstance((int)$file['instance_id'])) {
        Response::error('无权访问该文件', 403, 403);
    }
    Response::success($file);
}

// ===== 创建或更新文件 =====
if ($method === 'POST' && $action === 'save') {
    $id = (int)($body['id'] ?? 0);
    $instanceId = (int)($body['instance_id'] ?? 0);
    $directory = trim($body['directory'] ?? '');
    $name = trim($body['name'] ?? '');
    $content = $body['content'] ?? '';
    $fileType = $body['file_type'] ?? 'json';
    $fileCategory = $body['file_category'] ?? 'instance_config';

    if ($instanceId <= 0) Response::error('缺少实例 ID');
    if (!Auth::canWriteInstance($instanceId)) Response::error('无权操作该实例', 403, 403);
    if ($name === '') Response::error('文件名不能为空');
    if (!preg_match('/^[a-zA-Z0-9_\-\.]+$/', $name)) {
        Response::error('文件名只能包含字母、数字、下划线、连字符和点');
    }

    // 自动推断 file_type
    if ($fileType === 'json' && str_contains($name, '.')) {
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($ext !== '') $fileType = $ext;
    }

    $inst = DB::one("SELECT instance_uid, school_id FROM instances WHERE id = ?", [$instanceId]);
    if (!$inst) Response::error('实例不存在');

    $baseDir = '/instances/' . $inst['instance_uid'] . '/';
    // 如果 directory 为空，使用根目录；否则拼接为完整路径
    if ($directory === '') {
        $directory = $baseDir;
    } elseif (!str_starts_with($directory, '/instances/')) {
        // 相对路径 → 补全为绝对路径
        $directory = $baseDir . ltrim($directory, '/');
    }
    // 确保 directory 以 / 结尾
    if (!str_ends_with($directory, '/')) {
        $directory .= '/';
    }

    // 安全检查：确保 directory 在实例目录内
    if (!str_starts_with($directory, $baseDir)) {
        Response::error('无效的目录路径', 400, 400);
    }

    $now = date('Y-m-d H:i:s');
    $schoolId = Auth::schoolId() ?: $inst['school_id'];

    if ($id > 0) {
        // 更新已有文件
        $existing = DB::one("SELECT * FROM cloud_files WHERE id = ? AND instance_id = ?", [$id, $instanceId]);
        if (!$existing) Response::error('文件不存在或无权编辑');
        $updates = [
            'name' => $name,
            'content' => $content,
            'file_size' => strlen($content),
            'file_type' => $fileType,
            'file_category' => $fileCategory,
            'updated_at' => $now,
        ];
        if (isset($body['directory']) && $body['directory'] !== '') {
            $updates['directory'] = $directory;
        }
        DB::update('cloud_files', $updates, 'id = ?', [$id]);
        Response::success(['id' => $id, 'name' => $name], '已保存');
    } else {
        // 创建新文件 — 检查同名冲突
        $exists = DB::one(
            "SELECT id FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?",
            [$instanceId, $directory, $name]
        );
        if ($exists) Response::error('同名文件已存在');

        $newId = DB::insert('cloud_files', [
            'instance_id' => $instanceId,
            'school_id' => $schoolId,
            'directory' => $directory,
            'name' => $name,
            'content' => $content,
            'file_size' => strlen($content),
            'file_type' => $fileType,
            'file_category' => $fileCategory,
            'status' => 'synced',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $u = Auth::user();
        Auth::logAudit($schoolId, $u['user_id'] ?? 0, 'instance_file_create',
            "创建实例文件: {$directory}{$name} (实例 uid={$inst['instance_uid']})");
        Response::success(['id' => $newId, 'name' => $name], '文件已创建');
    }
}

// ===== 删除文件 =====
if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    $file = DB::one("SELECT * FROM cloud_files WHERE id = ?", [$id]);
    if (!$file) Response::error('文件不存在');
    if ($file['instance_id'] && !Auth::canWriteInstance((int)$file['instance_id'])) {
        Response::error('无权删除该文件', 403, 403);
    }
    DB::delete('cloud_files', 'id = ?', [$id]);
    $u = Auth::user();
    Auth::logAudit($file['school_id'], $u['user_id'] ?? 0, 'instance_file_delete',
        "删除实例文件: {$file['directory']}{$file['name']}");
    Response::success(null, '已删除');
}

// ===== 存储统计 =====
if ($method === 'GET' && $action === 'storage-stats') {
    $instanceId = (int)($_GET['instance_id'] ?? 0);
    if ($instanceId <= 0) Response::error('缺少实例 ID');
    if (!Auth::canAccessInstance($instanceId)) Response::error('无权访问该实例', 403, 403);

    $totalSize = DB::scalar(
        "SELECT COALESCE(SUM(file_size), 0) FROM cloud_files WHERE instance_id = ?",
        [$instanceId]
    );
    $fileCount = DB::scalar(
        "SELECT COUNT(*) FROM cloud_files WHERE instance_id = ?",
        [$instanceId]
    );
    $categorySizes = DB::all(
        "SELECT file_category, COALESCE(SUM(file_size), 0) AS total_size, COUNT(*) AS file_count
         FROM cloud_files WHERE instance_id = ?
         GROUP BY file_category",
        [$instanceId]
    );

    Response::success([
        'total_size' => (int)$totalSize,
        'file_count' => (int)$fileCount,
        'categories' => $categorySizes,
    ]);
}

// ===== 文件树（含目录结构） =====
if ($method === 'GET' && $action === 'file-tree') {
    $instanceId = (int)($_GET['instance_id'] ?? 0);
    if ($instanceId <= 0) Response::error('缺少实例 ID');
    if (!Auth::canAccessInstance($instanceId)) Response::error('无权访问该实例', 403, 403);

    $rows = DB::all(
        "SELECT id, directory, name, file_type, file_category, file_size, status, created_at, updated_at
         FROM cloud_files
         WHERE instance_id = ?
         ORDER BY directory ASC, file_category ASC, name ASC",
        [$instanceId]
    );

    // 构建目录树
    $tree = [];
    $inst = DB::one("SELECT instance_uid FROM instances WHERE id = ?", [$instanceId]);
    $baseDir = '/instances/' . ($inst['instance_uid'] ?? '') . '/';

    foreach ($rows as $row) {
        $relDir = $row['directory'];
        if (str_starts_with($relDir, $baseDir)) {
            $relDir = substr($relDir, strlen($baseDir));
        }
        $relDir = rtrim($relDir, '/');

        if (!isset($tree[$relDir])) {
            $tree[$relDir] = [];
        }
        $tree[$relDir][] = $row;
    }

    Response::success([
        'tree' => $tree,
        'base_dir' => $baseDir,
        'total_files' => count($rows),
    ]);
}

Response::error('未知操作', 405, 405);