<?php
/**
 * CSES Cloud - 班级主页（网页托管）API
 */

require __DIR__ . '/../lib/bootstrap.php';

// 必须是智教联盟登录用户
Auth::requireAlliance();
$username = Auth::allianceUsername();
$action = Helpers::input('action', '');

switch ($action) {
    case 'get':
        // 获取当前用户的空间信息
        getSpace($username);
        break;

    case 'update':
        // 更新空间信息
        updateSpace($username);
        break;

    case 'list-files':
        // 列出文件
        listFiles($username);
        break;

    case 'get-file':
        // 获取文件内容
        getFile($username);
        break;

    case 'save-file':
        // 保存文件
        saveFile($username);
        break;

    case 'delete-file':
        // 删除文件
        deleteFile($username);
        break;

    case 'create-directory':
        // 创建目录
        createDirectory($username);
        break;

    case 'usage':
        // 获取存储空间使用情况
        getUsage($username);
        break;

    case 'upload':
        // 上传文件
        uploadFile($username);
        break;

    case 'download':
        // 下载文件
        downloadFile($username);
        break;

    default:
        Response::error('未知操作');
}

// 获取当前用户空间信息（自动创建如果不存在）
function getSpace($username)
{
    $space = ensureSpace($username);
    Response::success($space);
}

// 确保空间存在，返回空间记录（自动创建）
function ensureSpace($username)
{
    $space = DB::one(
        "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
        [$username]
    );

    if (!$space) {
        // 自动创建初始空间
        $slug = $username;
        // 确保 slug 唯一（如果重复，添加数字后缀）
        $counter = 1;
        while (DB::scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ?", [$slug])) {
            $slug = $username . '-' . $counter++;
        }

        $now = date('Y-m-d H:i:s');
        $spaceId = DB::insert('web_hosting_spaces', [
            'alliance_username' => $username,
            'slug' => $slug,
            'title' => $username . ' 的班级主页',
            'description' => '',
            'storage_quota' => 100 * 1024 * 1024, // 100MB
            'is_enabled' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $space = DB::one("SELECT * FROM web_hosting_spaces WHERE id = ?", [$spaceId]);

        // 创建默认 index.html
        DB::insert('web_hosting_files', [
            'space_id' => $spaceId,
            'file_path' => '/index.html',
            'file_size' => 0,
            'content_type' => 'text/html',
            'content' => getDefaultIndexHtml($username),
            'is_directory' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_create', "创建网页空间: {$username}");
    }

    return $space;
}

// 更新空间信息
function updateSpace($username)
{
    $data = Helpers::jsonBody();
    $space = ensureSpace($username);

    $update = [];
    if (isset($data['title'])) {
        $update['title'] = trim($data['title']);
    }
    if (isset($data['description'])) {
        $update['description'] = trim($data['description']);
    }
    if (isset($data['slug'])) {
        $slug = trim($data['slug']);
        if (!preg_match('/^[a-z0-9-]+$/i', $slug)) {
            Response::error('路径别名只能包含字母、数字和连字符');
        }
        // 检查 slug 是否被其他用户占用
        $exists = DB::scalar(
            "SELECT 1 FROM web_hosting_spaces WHERE slug = ? AND alliance_username != ?",
            [$slug, $username]
        );
        if ($exists) {
            Response::error('该路径别名已被占用，请选择其他名称');
        }
        $update['slug'] = $slug;
    }
    if (isset($data['is_enabled'])) {
        $update['is_enabled'] = $data['is_enabled'] ? 1 : 0;
    }

    $update['updated_at'] = date('Y-m-d H:i:s');

    if (!empty($update)) {
        DB::update(
            'web_hosting_spaces',
            $update,
            'alliance_username = ?',
            [$username]
        );
        Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_update', "更新网页空间配置: {$username}");
    }

    Response::success([
        'ok' => true,
        'space' => DB::one(
            "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
            [$username]
        )
    ]);
}

// 列出文件（树形结构）
function listFiles($username)
{
    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $files = DB::all(
        "SELECT id, space_id, file_path, file_size, content_type, is_directory, created_at, updated_at
         FROM web_hosting_files WHERE space_id = ? ORDER BY file_path ASC",
        [$spaceId]
    );

    // 构建树形结构
    $tree = buildFileTree($files);
    Response::success([
        'files' => $files,
        'tree' => $tree,
    ]);
}

// 获取文件内容
function getFile($username)
{
    $data = Helpers::jsonBody();
    $filePath = normalizePath($data['path'] ?? '');
    if (empty($filePath)) {
        Response::error('缺少文件路径');
    }

    // 确保空间存在（与 getSpace 一致，自动创建）
    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $file = DB::one(
        "SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
        [$spaceId, normalizePath($filePath)]
    );

    if (!$file) {
        // 调试：列出当前空间所有文件，帮助定位问题
        $allFiles = DB::all(
            "SELECT file_path FROM web_hosting_files WHERE space_id = ?",
            [$spaceId]
        );
        $paths = array_map(fn($f) => $f['file_path'], $allFiles);
        Response::error(sprintf(
            '文件不存在: %s (space_id=%d, 现有文件: %s)',
            normalizePath($filePath),
            $spaceId,
            implode(', ', $paths) ?: '无'
        ), 404);
    }

    Response::success([
        'id' => $file['id'],
        'file_path' => $file['file_path'],
        'file_size' => $file['file_size'],
        'content_type' => $file['content_type'],
        'content' => $file['is_directory'] ? '' : $file['content'],
        'is_directory' => $file['is_directory'],
        'updated_at' => $file['updated_at'],
    ]);
}

// 保存文件（新建或覆盖）
function saveFile($username)
{
    $data = Helpers::jsonBody();
    $filePath = normalizePath($data['path'] ?? '');
    $content = $data['content'] ?? '';
    $contentType = $data['content_type'] ?? guessContentType($filePath);

    if (empty($filePath)) {
        Response::error('缺少文件路径');
    }

    if ($filePath === '/') {
        Response::error('不能保存到根路径');
    }

    $space = ensureSpace($username);
    $spaceId = $space['id'];

    // 检查配额
    $contentSize = is_string($content) ? strlen($content) : 0;
    $currentUsage = (int)DB::scalar(
        "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
        [$spaceId]
    );
    // 如果是更新已有文件，减去原文件大小
    $existing = DB::one(
        "SELECT file_size FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
        [$spaceId, $filePath]
    );
    if ($existing) {
        $currentUsage -= $existing['file_size'];
    }
    if ($currentUsage + $contentSize > $space['storage_quota']) {
        Response::error('存储空间不足，请清理文件后重试');
    }

    $now = date('Y-m-d H:i:s');

    if ($existing) {
        // 更新
        DB::update(
            'web_hosting_files',
            [
                'file_size' => $contentSize,
                'content_type' => $contentType,
                'content' => $content,
                'updated_at' => $now,
            ],
            'space_id = ? AND file_path = ?',
            [$spaceId, $filePath]
        );
        Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_update_file', "更新文件: {$username}{$filePath}");
    } else {
        // 确保父目录存在
        $parentPath = dirname($filePath);
        if ($parentPath !== '' && $parentPath !== '.') {
            ensureDirectoryExists($spaceId, $parentPath, $now);
        }

        // 新建
        DB::insert('web_hosting_files', [
            'space_id' => $spaceId,
            'file_path' => $filePath,
            'file_size' => $contentSize,
            'content_type' => $contentType,
            'content' => $content,
            'is_directory' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_create_file', "创建文件: {$username}{$filePath}");
    }

    // 验证：读取刚保存的内容确认持久化成功
    $saved = DB::one(
        "SELECT file_size, content FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
        [$spaceId, $filePath]
    );
    $actualSize = $saved ? strlen($saved['content'] ?? '') : -1;

    Response::success([
        'ok' => true,
        'size' => $contentSize,
        'actual_size' => $actualSize,
        'path' => $filePath,
        'space_id' => $spaceId,
    ]);
}

// 删除文件
function deleteFile($username)
{
    $data = Helpers::jsonBody();
    $filePath = normalizePath($data['path'] ?? '');

    if (empty($filePath)) {
        Response::error('缺少文件路径');
    }

    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $file = DB::one(
        "SELECT is_directory FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
        [$spaceId, $filePath]
    );

    if (!$file) {
        Response::error('文件不存在');
    }

    if ($file['is_directory']) {
        // 删除目录及所有子文件
        $prefix = rtrim($filePath, '/') . '/';
        DB::delete(
            'web_hosting_files',
            'space_id = ? AND (file_path = ? OR file_path LIKE ?)',
            [$spaceId, $filePath, $prefix . '%']
        );
        Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_delete_dir', "删除目录: {$username}{$filePath}");
    } else {
        DB::delete(
            'web_hosting_files',
            'space_id = ? AND file_path = ?',
            [$spaceId, $filePath]
        );
        Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_delete_file', "删除文件: {$username}{$filePath}");
    }

    Response::success(['ok' => true]);
}

// 创建目录
function createDirectory($username)
{
    $data = Helpers::jsonBody();
    $dirPath = normalizePath($data['path'] ?? '');

    if (empty($dirPath) || $dirPath === '/') {
        Response::error('目录路径无效');
    }

    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $exists = DB::scalar(
        "SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
        [$spaceId, $dirPath]
    );
    if ($exists) {
        Response::error('目录已存在');
    }

    // 确保父目录存在
    $parentPath = dirname($dirPath);
    $now = date('Y-m-d H:i:s');
    if ($parentPath !== '' && $parentPath !== '.') {
        ensureDirectoryExists($spaceId, $parentPath, $now);
    }

    DB::insert('web_hosting_files', [
        'space_id' => $spaceId,
        'file_path' => $dirPath,
        'file_size' => 0,
        'content_type' => null,
        'content' => null,
        'is_directory' => 1,
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_create_dir', "创建目录: {$username}{$dirPath}");
    Response::success(['ok' => true]);
}

// 获取存储使用情况
function getUsage($username)
{
    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $used = (int)DB::scalar(
        "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
        [$spaceId]
    );
    $fileCount = (int)DB::scalar(
        "SELECT COUNT(*) FROM web_hosting_files WHERE space_id = ? AND is_directory = 0",
        [$spaceId]
    );

    Response::success([
        'used_bytes' => $used,
        'quota_bytes' => $space['storage_quota'],
        'remaining_bytes' => $space['storage_quota'] - $used,
        'used_percent' => $space['storage_quota'] > 0 ? round(($used / $space['storage_quota']) * 100, 1) : 0,
        'file_count' => $fileCount,
    ]);
}

// 上传文件
function uploadFile($username)
{
    if (empty($_FILES['file'])) {
        Response::error('未选择文件');
    }

    $file = $_FILES['file'];
    $dir = Helpers::input('dir', '/');

    if ($file['error'] !== UPLOAD_ERR_OK) {
        Response::error('文件上传失败，错误代码: ' . $file['error']);
    }

    $name = basename($file['name']);
    $targetPath = normalizePath(rtrim($dir, '/') . '/' . $name);

    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $content = file_get_contents($file['tmp_name']);
    $contentSize = strlen($content);
    $contentType = $file['type'] ?: guessContentType($name);

    // 检查配额
    $currentUsage = (int)DB::scalar(
        "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
        [$spaceId]
    );
    $existing = DB::one(
        "SELECT file_size FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
        [$spaceId, $targetPath]
    );
    if ($existing) {
        $currentUsage -= $existing['file_size'];
    }
    if ($currentUsage + $contentSize > $space['storage_quota']) {
        Response::error('存储空间不足，请清理文件后重试');
    }

    $now = date('Y-m-d H:i:s');

    if ($existing) {
        DB::update('web_hosting_files', [
            'file_size' => $contentSize,
            'content_type' => $contentType,
            'content' => $content,
            'updated_at' => $now,
        ], 'space_id = ? AND file_path = ?', [$spaceId, $targetPath]);
    } else {
        $parentPath = dirname($targetPath);
        if ($parentPath !== '' && $parentPath !== '.') {
            ensureDirectoryExists($spaceId, $parentPath, $now);
        }
        DB::insert('web_hosting_files', [
            'space_id' => $spaceId,
            'file_path' => $targetPath,
            'file_size' => $contentSize,
            'content_type' => $contentType,
            'content' => $content,
            'is_directory' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    Auth::logAudit(Auth::schoolId(), 0, 'web_hosting_upload', "上传文件: {$username}{$targetPath}");
    Response::success([
        'ok' => true,
        'path' => $targetPath,
        'size' => $contentSize,
    ]);
}

// 下载文件
function downloadFile($username)
{
    $filePath = Helpers::input('path', '');
    if (empty($filePath)) {
        $data = Helpers::jsonBody();
        $filePath = $data['path'] ?? '';
    }
    $filePath = normalizePath($filePath);
    if (empty($filePath) || $filePath === '/') {
        Response::error('缺少文件路径');
    }

    $space = ensureSpace($username);
    $spaceId = $space['id'];

    $file = DB::one(
        "SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0",
        [$spaceId, $filePath]
    );

    if (!$file) {
        Response::error('文件不存在', 404);
    }

    $contentType = $file['content_type'] ?? 'application/octet-stream';
    $fileName = basename($filePath);

    header('Content-Type: ' . $contentType);
    header('Content-Disposition: attachment; filename="' . $fileName . '"');
    header('Content-Length: ' . strlen($file['content'] ?? ''));
    header('Cache-Control: no-cache');
    echo $file['content'] ?? '';
    exit;
}

// === 辅助函数 ===

// 标准化路径（确保以 / 开头，不包含末尾斜杠，除了根目录）
function normalizePath($path)
{
    $path = trim($path);
    if ($path === '') {
        return '/';
    }
    // 替换反斜杠为正斜杠
    $path = str_replace('\\', '/', $path);
    // 移除多个连续斜杠
    $path = preg_replace('#/+#', '/', $path);
    // 确保以 / 开头
    if ($path[0] !== '/') {
        $path = '/' . $path;
    }
    // 移除末尾斜杠（除非是根目录）
    if (strlen($path) > 1 && str_ends_with($path, '/')) {
        $path = rtrim($path, '/');
    }
    return $path;
}

// 根据文件扩展名猜测 MIME 类型
function guessContentType($path)
{
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $types = [
        'html' => 'text/html',
        'htm' => 'text/html',
        'css' => 'text/css',
        'js' => 'application/javascript',
        'mjs' => 'application/javascript',
        'json' => 'application/json',
        'txt' => 'text/plain',
        'md' => 'text/markdown',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'pdf' => 'application/pdf',
        'zip' => 'application/zip',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf' => 'font/ttf',
    ];
    return $types[$ext] ?? 'application/octet-stream';
}

// 确保父目录存在（递归创建）
function ensureDirectoryExists($spaceId, $dirPath, $now)
{
    $dirPath = normalizePath($dirPath);
    if ($dirPath === '/') {
        return;
    }

    $exists = DB::scalar(
        "SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1",
        [$spaceId, $dirPath]
    );
    if (!$exists) {
        $parent = dirname($dirPath);
        if ($parent !== '' && $parent !== '.') {
            ensureDirectoryExists($spaceId, $parent, $now);
        }
        DB::insert('web_hosting_files', [
            'space_id' => $spaceId,
            'file_path' => $dirPath,
            'file_size' => 0,
            'content_type' => null,
            'content' => null,
            'is_directory' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
}

// 构建文件树形结构
function buildFileTree($files)
{
    $tree = [
        'name' => '/',
        'path' => '/',
        'is_directory' => true,
        'children' => [],
    ];

    $map = [];
    foreach ($files as $file) {
        $parts = explode('/', trim($file['file_path'], '/'));
        $current = &$tree;
        $currentPath = '';

        foreach ($parts as $i => $part) {
            $currentPath .= '/' . $part;
            if ($i === count($parts) - 1) {
                // 叶子节点
                $current['children'][] = [
                    'name' => $part,
                    'path' => $currentPath,
                    'is_directory' => (bool)$file['is_directory'],
                    'size' => $file['file_size'],
                    'content_type' => $file['content_type'],
                    'updated_at' => $file['updated_at'],
                    'children' => [],
                ];
            } else {
                // 中间节点（目录），检查是否已存在
                $found = false;
                foreach ($current['children'] as &$child) {
                    if ($child['name'] === $part && $child['is_directory']) {
                        $current = &$child;
                        $found = true;
                        break;
                    }
                }
                if (!$found) {
                    // 创建目录节点
                    $newDir = [
                        'name' => $part,
                        'path' => $currentPath,
                        'is_directory' => true,
                        'children' => [],
                    ];
                    $current['children'][] = $newDir;
                    $current = &$newDir;
                }
            }
        }
    }

    return $tree;
}

// 默认首页 HTML
function getDefaultIndexHtml($username)
{
    $title = htmlspecialchars($username . ' 的班级主页');
    return <<<HTML
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{$title}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 16px;
            padding: 48px 32px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        h1 {
            color: #1a1a1a;
            font-size: 28px;
            margin-bottom: 16px;
        }
        p {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
        }
        .powered {
            color: #999;
            font-size: 14px;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #eee;
        }
        .btn {
            display: inline-block;
            background: #667eea;
            color: white;
            text-decoration: none;
            padding: 12px 32px;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s;
        }
        .btn:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>{$title}</h1>
        <p>欢迎来到我的班级主页！这是一个由 CSES Cloud 提供的免费网页托管空间。</p>
        <a href="https://{$_SERVER['HTTP_HOST']}/console/web-homepage" target="_blank" class="btn">开始编辑</a>
        <div class="powered">
            Powered by CSES Cloud 智教云
        </div>
    </div>
</body>
</html>
HTML;
}
