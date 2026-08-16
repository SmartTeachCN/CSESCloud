<?php
/**
 * 数据空间 API
 * 统一管理用户在服务器上活动产生的所有文件
 *
 * 数据来源：
 *  - web_hosting_files  (网页空间文件)
 *  - cloud_files        (实例文件 + 轻编辑器文件)
 *  - instance_storage_data (实例存储数据)
 *  - cloud_file_history (操作记录)
 *  - cloud_file_versions (版本历史)
 *
 * 虚拟目录结构：
 *  / 实例文件/        - 实例管理文件（不可删除）
 *  / 云文件/          - 轻编辑器文件（不可删除）
 *  / 网页空间/        - 用户创建的网页空间
 *  / 版本历史/        - 版本历史记录（不可删除）
 *  / 操作记录/        - 操作记录（不可删除）
 */
require_once __DIR__ . '/../lib/bootstrap.php';
Auth::requireAlliance();
$username = Auth::allianceUsername();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

// ===== 系统目录定义 =====
define('DS_INSTANCES', '/实例文件');
define('DS_CLOUD', '/云文件');
define('DS_WEBSPACES', '/网页空间');
define('DS_VERSIONS', '/版本历史');
define('DS_HISTORY', '/操作记录');

$systemDirs = [DS_INSTANCES, DS_CLOUD, DS_WEBSPACES, DS_VERSIONS, DS_HISTORY];

// ===== 列出文件树 =====
if ($method === 'GET' && $action === 'tree') {
    $nodes = [];

    // 1. 实例文件目录
    $instances = DB::all(
        "SELECT i.id, i.name, i.instance_uid, i.config, i.status, i.created_at
         FROM instances i
         WHERE i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?
         ORDER BY i.name ASC",
        [$schoolId, $username]
    );
    $instanceChildren = [];
    foreach ($instances as $inst) {
        $instanceUid = $inst['instance_uid'];
        $baseDir = '/instances/' . $instanceUid . '/';
        $files = DB::all(
            "SELECT id, name, file_type, file_size, file_category, created_at, updated_at
             FROM cloud_files
             WHERE directory = ? AND school_id = ?
             ORDER BY name ASC",
            [$baseDir, $schoolId]
        );

        $fileChildren = [];
        // 实例配置虚拟文件
        $fileChildren[] = [
            'name' => '实例配置.json',
            'path' => DS_INSTANCES . '/' . $inst['name'] . '/实例配置.json',
            'is_directory' => false,
            'size' => strlen($inst['config'] ?? '{}'),
            'file_type' => 'json',
            'updated_at' => $inst['created_at'],
            'source' => 'instance_config',
            'instance_id' => $inst['id'],
            'instance_uid' => $instanceUid,
            'config' => $inst['config'],
        ];
        // 实例下的文件
        foreach ($files as $f) {
            $fileChildren[] = [
                'name' => $f['name'],
                'path' => DS_INSTANCES . '/' . $inst['name'] . '/' . $f['name'],
                'is_directory' => false,
                'size' => $f['file_size'],
                'file_type' => $f['file_type'],
                'updated_at' => $f['updated_at'],
                'source' => 'instance_file',
                'file_id' => $f['id'],
                'instance_id' => $inst['id'],
                'instance_uid' => $instanceUid,
            ];
        }

        $instanceChildren[] = [
            'name' => $inst['name'],
            'path' => DS_INSTANCES . '/' . $inst['name'],
            'is_directory' => true,
            'source' => 'instance',
            'instance_id' => $inst['id'],
            'instance_uid' => $instanceUid,
            'children' => $fileChildren,
        ];
    }
    $nodes[] = [
        'name' => '实例文件',
        'path' => DS_INSTANCES,
        'is_directory' => true,
        'source' => 'system',
        'badge' => '实例管理',
        'protected' => true,
        'children' => $instanceChildren,
    ];

    // 2. 云文件目录（轻编辑器）
    $space = ensureDataSpace($username);
    $spaceId = $space['id'];
    $cloudFiles = DB::all(
        "SELECT id, file_path, file_size, content_type, created_at, updated_at
         FROM web_hosting_files
         WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND is_directory = 0
         ORDER BY file_path ASC",
        [$spaceId]
    );
    $cloudChildren = [];
    foreach ($cloudFiles as $cf) {
        $name = basename($cf['file_path']);
        $cloudChildren[] = [
            'name' => $name,
            'path' => DS_CLOUD . '/' . $name,
            'is_directory' => false,
            'size' => $cf['file_size'],
            'file_type' => pathinfo($name, PATHINFO_EXTENSION),
            'updated_at' => $cf['updated_at'],
            'source' => 'cloud_file',
            'file_id' => $cf['id'],
            'real_path' => $cf['file_path'],
        ];
    }
    $nodes[] = [
        'name' => '云文件',
        'path' => DS_CLOUD,
        'is_directory' => true,
        'source' => 'system',
        'badge' => '轻编辑器',
        'protected' => true,
        'children' => $cloudChildren,
    ];

    // 3. 网页空间目录
    $webSpaces = DB::all(
        "SELECT * FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1
         ORDER BY created_at DESC",
        [$username]
    );
    $webSpaceChildren = [];
    foreach ($webSpaces as $ws) {
        $wsId = $ws['id'];
        $wsFiles = DB::all(
            "SELECT id, file_path, file_size, content_type, is_directory, created_at, updated_at
             FROM web_hosting_files
             WHERE space_id = ? AND file_path NOT LIKE '/.cloud/%'
             ORDER BY file_path ASC",
            [$wsId]
        );

        $wsFileChildren = [];
        // 空间配置虚拟文件
        $wsFileChildren[] = [
            'name' => '空间配置',
            'path' => DS_WEBSPACES . '/' . $ws['title'] . '/空间配置',
            'is_directory' => false,
            'size' => 0,
            'file_type' => 'config',
            'updated_at' => $ws['updated_at'],
            'source' => 'webspace_config',
            'space_id' => $wsId,
            'space_data' => [
                'title' => $ws['title'],
                'description' => $ws['description'],
                'slug' => $ws['slug'],
                'is_enabled' => $ws['is_enabled'],
            ],
        ];
        // 构建文件树
        $dirMap = [];
        foreach ($wsFiles as $f) {
            $path = $f['file_path'];
            if ($path === '/.cloud' && $f['is_directory']) continue; // 跳过隐藏目录
            $parent = dirname($path);
            if ($parent === '.') $parent = '/';
            if (!isset($dirMap[$parent])) $dirMap[$parent] = [];
            $dirMap[$parent][] = $f;
        }

        // 递归构建
        function buildWsTree($parentPath, $dirMap, $wsPrefix) {
            $result = [];
            $items = $dirMap[$parentPath] ?? [];
            foreach ($items as $f) {
                $childPath = $f['file_path'];
                $child = [
                    'name' => basename($childPath),
                    'path' => $wsPrefix . '/' . ltrim($childPath, '/'),
                    'is_directory' => (bool)$f['is_directory'],
                    'size' => $f['file_size'],
                    'file_type' => $f['is_directory'] ? null : pathinfo($childPath, PATHINFO_EXTENSION),
                    'updated_at' => $f['updated_at'],
                    'source' => 'webspace_file',
                    'file_id' => $f['id'],
                    'space_id' => $f['space_id'],
                    'real_path' => $childPath,
                ];
                if ($f['is_directory'] && isset($dirMap[$childPath])) {
                    $child['children'] = buildWsTree($childPath, $dirMap, $wsPrefix);
                }
                $result[] = $child;
            }
            return $result;
        }
        $wsPrefixPath = DS_WEBSPACES . '/' . $ws['title'];
        $wsFileChildren = array_merge($wsFileChildren, buildWsTree('/', $dirMap, $wsPrefixPath));

        $webSpaceChildren[] = [
            'name' => $ws['title'],
            'path' => DS_WEBSPACES . '/' . $ws['title'],
            'is_directory' => true,
            'source' => 'webspace',
            'space_id' => $wsId,
            'children' => $wsFileChildren,
        ];
    }
    $nodes[] = [
        'name' => '网页空间',
        'path' => DS_WEBSPACES,
        'is_directory' => true,
        'source' => 'system',
        'badge' => '网页托管',
        'protected' => false,
        'children' => $webSpaceChildren,
    ];

    // 4. 版本历史目录
    $versions = DB::all(
        "SELECT cv.id, cv.file_id, cv.file_name, cv.version_label, cv.created_at
         FROM cloud_file_versions cv
         WHERE cv.created_by = ?
         ORDER BY cv.created_at DESC LIMIT 50",
        [$username]
    );
    $versionChildren = [];
    foreach ($versions as $v) {
        $versionChildren[] = [
            'name' => $v['file_name'] . ' - ' . $v['version_label'] . ' (' . $v['created_at'] . ')',
            'path' => DS_VERSIONS . '/' . $v['id'],
            'is_directory' => false,
            'size' => 0,
            'file_type' => 'version',
            'updated_at' => $v['created_at'],
            'source' => 'version_record',
            'version_id' => $v['id'],
            'file_id' => $v['file_id'],
        ];
    }
    $nodes[] = [
        'name' => '版本历史',
        'path' => DS_VERSIONS,
        'is_directory' => true,
        'source' => 'system',
        'badge' => '版本记录',
        'protected' => true,
        'children' => $versionChildren,
    ];

    // 5. 操作记录目录
    $histories = DB::all(
        "SELECT ch.id, ch.file_id, ch.file_name, ch.step, ch.created_at
         FROM cloud_file_history ch
         WHERE ch.created_by = ?
         ORDER BY ch.created_at DESC LIMIT 50",
        [$username]
    );
    $historyChildren = [];
    foreach ($histories as $h) {
        $historyChildren[] = [
            'name' => $h['file_name'] . ' - 步骤' . $h['step'] . ' (' . $h['created_at'] . ')',
            'path' => DS_HISTORY . '/' . $h['id'],
            'is_directory' => false,
            'size' => 0,
            'file_type' => 'history',
            'updated_at' => $h['created_at'],
            'source' => 'history_record',
            'history_id' => $h['id'],
            'file_id' => $h['file_id'],
        ];
    }
    $nodes[] = [
        'name' => '操作记录',
        'path' => DS_HISTORY,
        'is_directory' => true,
        'source' => 'system',
        'badge' => '操作记录',
        'protected' => true,
        'children' => $historyChildren,
    ];

    Response::success(['nodes' => $nodes]);
}

// ===== 获取文件内容 =====
if ($method === 'GET' && $action === 'get') {
    $path = trim($_GET['path'] ?? '');
    $source = trim($_GET['source'] ?? '');
    if (empty($path)) Response::error('缺少文件路径');

    // 实例配置
    if ($source === 'instance_config') {
        $instanceId = (int)($_GET['instance_id'] ?? 0);
        $inst = DB::one(
            "SELECT config FROM instances WHERE id = ? AND school_id = ? AND owner_type = 'alliance' AND owner_key = ?",
            [$instanceId, $schoolId, $username]
        );
        if (!$inst) Response::error('实例不存在');
        Response::success([
            'content' => $inst['config'] ?? '{}',
            'file_type' => 'json',
            'source' => 'instance_config',
        ]);
    }

    // 实例文件
    if ($source === 'instance_file') {
        $fileId = (int)($_GET['file_id'] ?? 0);
        $file = DB::one(
            "SELECT cf.* FROM cloud_files cf
             JOIN instances i ON i.id = cf.instance_id
             WHERE cf.id = ? AND i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
            [$fileId, $schoolId, $username]
        );
        if (!$file) Response::error('文件不存在');
        Response::success([
            'content' => $file['content'] ?? '',
            'file_type' => $file['file_type'],
            'source' => 'instance_file',
            'file_id' => $file['id'],
        ]);
    }

    // 云文件
    if ($source === 'cloud_file') {
        $fileId = (int)($_GET['file_id'] ?? 0);
        $space = ensureDataSpace($username);
        $file = DB::one(
            "SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE '/.cloud/%'",
            [$fileId, $space['id']]
        );
        if (!$file) Response::error('文件不存在');
        Response::success([
            'content' => $file['content'] ?? '',
            'file_type' => pathinfo($file['file_path'], PATHINFO_EXTENSION),
            'source' => 'cloud_file',
            'file_id' => $file['id'],
        ]);
    }

    // 网页空间配置
    if ($source === 'webspace_config') {
        $spaceId = (int)($_GET['space_id'] ?? 0);
        $ws = DB::one(
            "SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1",
            [$spaceId, $username]
        );
        if (!$ws) Response::error('网页空间不存在');
        Response::success([
            'content' => json_encode([
                'title' => $ws['title'],
                'description' => $ws['description'],
                'slug' => $ws['slug'],
                'is_enabled' => $ws['is_enabled'],
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
            'file_type' => 'config',
            'source' => 'webspace_config',
            'space_id' => $ws['id'],
            'space_data' => $ws,
        ]);
    }

    // 网页空间文件
    if ($source === 'webspace_file') {
        $fileId = (int)($_GET['file_id'] ?? 0);
        $file = DB::one(
            "SELECT whf.* FROM web_hosting_files whf
             JOIN web_hosting_spaces whs ON whs.id = whf.space_id
             WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
            [$fileId, $username]
        );
        if (!$file) Response::error('文件不存在');
        Response::success([
            'content' => $file['content'] ?? '',
            'file_type' => pathinfo($file['file_path'], PATHINFO_EXTENSION),
            'source' => 'webspace_file',
            'file_id' => $file['id'],
        ]);
    }

    // 版本历史
    if ($source === 'version_record') {
        $versionId = (int)($_GET['version_id'] ?? 0);
        $v = DB::one(
            "SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?",
            [$versionId, $username]
        );
        if (!$v) Response::error('版本记录不存在');
        Response::success([
            'content' => $v['content'] ?? '(内容已归档)',
            'file_type' => 'version',
            'source' => 'version_record',
            'version_id' => $v['id'],
        ]);
    }

    // 操作记录
    if ($source === 'history_record') {
        $historyId = (int)($_GET['history_id'] ?? 0);
        $h = DB::one(
            "SELECT * FROM cloud_file_history WHERE id = ? AND created_by = ?",
            [$historyId, $username]
        );
        if (!$h) Response::error('操作记录不存在');
        Response::success([
            'content' => $h['content_snapshot'] ?? '',
            'file_type' => 'history',
            'source' => 'history_record',
            'history_id' => $h['id'],
        ]);
    }

    Response::error('未知的文件来源');
}

// ===== 保存云文件内容 =====
if ($method === 'POST' && $action === 'save') {
    $path = trim($body['path'] ?? '');
    $source = trim($body['source'] ?? '');
    $content = $body['content'] ?? '';

    // 云文件保存
    if ($source === 'cloud_file') {
        $fileId = (int)($body['file_id'] ?? 0);
        $space = ensureDataSpace($username);
        $file = DB::one(
            "SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE '/.cloud/%'",
            [$fileId, $space['id']]
        );
        if (!$file) Response::error('文件不存在');
        $now = date('Y-m-d H:i:s');
        DB::update('web_hosting_files', [
            'content' => $content,
            'file_size' => strlen($content),
            'updated_at' => $now,
        ], 'id = ?', [$fileId]);
        Response::success(['ok' => true, 'size' => strlen($content)], '已保存');
    }

    // 网页空间文件保存
    if ($source === 'webspace_file') {
        $fileId = (int)($body['file_id'] ?? 0);
        $file = DB::one(
            "SELECT whf.* FROM web_hosting_files whf
             JOIN web_hosting_spaces whs ON whs.id = whf.space_id
             WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
            [$fileId, $username]
        );
        if (!$file) Response::error('文件不存在');
        $now = date('Y-m-d H:i:s');
        DB::update('web_hosting_files', [
            'content' => $content,
            'file_size' => strlen($content),
            'updated_at' => $now,
        ], 'id = ?', [$fileId]);
        Response::success(['ok' => true, 'size' => strlen($content)], '已保存');
    }

    // 实例文件保存
    if ($source === 'instance_file') {
        $fileId = (int)($body['file_id'] ?? 0);
        $file = DB::one(
            "SELECT cf.* FROM cloud_files cf
             JOIN instances i ON i.id = cf.instance_id
             WHERE cf.id = ? AND i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
            [$fileId, $schoolId, $username]
        );
        if (!$file) Response::error('文件不存在');
        $now = date('Y-m-d H:i:s');
        DB::update('cloud_files', [
            'content' => $content,
            'file_size' => strlen($content),
            'updated_at' => $now,
        ], 'id = ?', [$fileId]);
        Response::success(['ok' => true, 'size' => strlen($content)], '已保存');
    }

    Response::error('不支持保存此类型文件');
}

// ===== 删除文件/目录 =====
if ($method === 'POST' && $action === 'delete') {
    $path = trim($body['path'] ?? '');
    $source = trim($body['source'] ?? '');

    // 检查是否系统目录
    if ($source === 'system') {
        Response::error('系统目录不可删除');
    }

    // 实例目录
    if ($source === 'instance') {
        $instanceId = (int)($body['instance_id'] ?? 0);
        $inst = DB::one(
            "SELECT * FROM instances WHERE id = ? AND school_id = ? AND owner_type = 'alliance' AND owner_key = ?",
            [$instanceId, $schoolId, $username]
        );
        if (!$inst) Response::error('实例不存在');
        // 删除实例及关联文件
        DB::delete('cloud_files', 'instance_id = ?', [$instanceId]);
        DB::delete('instance_storage_data', 'instance_id = ?', [$instanceId]);
        DB::delete('instances', 'id = ?', [$instanceId]);
        Response::success(null, '实例已删除');
    }

    // 网页空间
    if ($source === 'webspace') {
        $spaceId = (int)($body['space_id'] ?? 0);
        $ws = DB::one(
            "SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1",
            [$spaceId, $username]
        );
        if (!$ws) Response::error('网页空间不存在');
        DB::delete('web_hosting_files', 'space_id = ?', [$spaceId]);
        DB::delete('web_hosting_spaces', 'id = ?', [$spaceId]);
        Response::success(null, '网页空间已删除');
    }

    // 云文件
    if ($source === 'cloud_file') {
        $fileId = (int)($body['file_id'] ?? 0);
        $space = ensureDataSpace($username);
        $file = DB::one(
            "SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE '/.cloud/%'",
            [$fileId, $space['id']]
        );
        if (!$file) Response::error('文件不存在');
        DB::delete('web_hosting_files', 'id = ?', [$fileId]);
        Response::success(null, '已删除');
    }

    // 网页空间文件
    if ($source === 'webspace_file') {
        $fileId = (int)($body['file_id'] ?? 0);
        $file = DB::one(
            "SELECT whf.* FROM web_hosting_files whf
             JOIN web_hosting_spaces whs ON whs.id = whf.space_id
             WHERE whf.id = ? AND whs.alliance_username = ? AND whs.is_web_space = 1",
            [$fileId, $username]
        );
        if (!$file) Response::error('文件不存在');
        if ($file['is_directory']) {
            $prefix = rtrim($file['file_path'], '/') . '/';
            DB::delete('web_hosting_files', 'space_id = ? AND (file_path = ? OR file_path LIKE ?)', [$file['space_id'], $file['file_path'], $prefix . '%']);
        } else {
            DB::delete('web_hosting_files', 'id = ?', [$fileId]);
        }
        Response::success(null, '已删除');
    }

    Response::error('不支持删除此类型');
}

// ===== 创建网页空间 =====
if ($method === 'POST' && $action === 'create-webspace') {
    $title = trim($body['title'] ?? '');
    if ($title === '') Response::error('请输入空间名称');
    $slug = trim($body['slug'] ?? '');
    if ($slug === '') $slug = $title;
    // 清理 slug
    $slug = preg_replace('/[^a-z0-9-]/i', '-', strtolower($slug));
    $slug = trim($slug, '-') ?: 'webspace';

    // 确保唯一
    $counter = 1;
    $baseSlug = $slug;
    while (DB::scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ? AND alliance_username = ?", [$slug, $username])) {
        $slug = $baseSlug . '-' . $counter++;
    }

    $now = date('Y-m-d H:i:s');
    $spaceId = DB::insert('web_hosting_spaces', [
        'alliance_username' => $username,
        'slug' => $slug,
        'title' => $title,
        'description' => $body['description'] ?? '',
        'storage_quota' => 100 * 1024 * 1024,
        'is_enabled' => 1,
        'is_web_space' => 1,
        'created_at' => $now,
        'updated_at' => $now,
    ]);

    Auth::logAudit($schoolId, 0, 'dataspace_create_webspace', "创建网页空间: {$username} -> {$title}");
    Response::success(['space_id' => $spaceId, 'slug' => $slug], '网页空间已创建');
}

// ===== 更新网页空间配置 =====
if ($method === 'POST' && $action === 'update-webspace') {
    $spaceId = (int)($body['space_id'] ?? 0);
    $ws = DB::one(
        "SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1",
        [$spaceId, $username]
    );
    if (!$ws) Response::error('网页空间不存在');

    $updates = ['updated_at' => date('Y-m-d H:i:s')];
    if (isset($body['title'])) $updates['title'] = trim($body['title']);
    if (isset($body['description'])) $updates['description'] = trim($body['description']);
    if (isset($body['slug'])) {
        $newSlug = trim($body['slug']);
        if (!preg_match('/^[a-z0-9-]+$/i', $newSlug)) Response::error('路径别名只能包含字母、数字和连字符');
        $exists = DB::scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ? AND id != ?", [$newSlug, $spaceId]);
        if ($exists) Response::error('该路径别名已被占用');
        $updates['slug'] = $newSlug;
    }
    if (isset($body['is_enabled'])) $updates['is_enabled'] = $body['is_enabled'] ? 1 : 0;

    DB::update('web_hosting_spaces', $updates, 'id = ?', [$spaceId]);
    Response::success(['ok' => true], '设置已保存');
}

// ===== 在网页空间中创建文件 =====
if ($method === 'POST' && $action === 'webspace-create-file') {
    $spaceId = (int)($body['space_id'] ?? 0);
    $filePath = normalizePath($body['path'] ?? '');
    $content = $body['content'] ?? '';

    $ws = DB::one("SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1", [$spaceId, $username]);
    if (!$ws) Response::error('网页空间不存在');

    if (empty($filePath) || $filePath === '/') Response::error('文件路径无效');

    $existing = DB::one("SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?", [$spaceId, $filePath]);
    $now = date('Y-m-d H:i:s');
    if ($existing) {
        DB::update('web_hosting_files', [
            'content' => $content,
            'file_size' => strlen($content),
            'updated_at' => $now,
        ], 'id = ?', [$existing['id']]);
    } else {
        $parentPath = dirname($filePath);
        if ($parentPath !== '.' && $parentPath !== '/') {
            ensureDirExists($spaceId, $parentPath, $now);
        }
        DB::insert('web_hosting_files', [
            'space_id' => $spaceId,
            'file_path' => $filePath,
            'file_size' => strlen($content),
            'content_type' => guessContentType($filePath),
            'content' => $content,
            'is_directory' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
    Response::success(['ok' => true], '文件已创建');
}

// ===== 在网页空间中创建目录 =====
if ($method === 'POST' && $action === 'webspace-create-dir') {
    $spaceId = (int)($body['space_id'] ?? 0);
    $dirPath = normalizePath($body['path'] ?? '');

    $ws = DB::one("SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1", [$spaceId, $username]);
    if (!$ws) Response::error('网页空间不存在');

    if (empty($dirPath) || $dirPath === '/') Response::error('目录路径无效');

    $exists = DB::scalar("SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ?", [$spaceId, $dirPath]);
    if ($exists) Response::error('目录已存在');

    $now = date('Y-m-d H:i:s');
    $parentPath = dirname($dirPath);
    if ($parentPath !== '.' && $parentPath !== '/') {
        ensureDirExists($spaceId, $parentPath, $now);
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
    Response::success(['ok' => true], '目录已创建');
}

// ===== 上传文件到网页空间 =====
if ($method === 'POST' && $action === 'webspace-upload') {
    $spaceId = (int)($_POST['space_id'] ?? 0);
    $dir = trim($_POST['dir'] ?? '/');

    if (empty($_FILES['file'])) Response::error('未选择文件');
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) Response::error('文件上传失败');

    $ws = DB::one("SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1", [$spaceId, $username]);
    if (!$ws) Response::error('网页空间不存在');

    $name = basename($file['name']);
    $targetPath = normalizePath(rtrim($dir, '/') . '/' . $name);
    $content = file_get_contents($file['tmp_name']);
    $contentSize = strlen($content);
    $contentType = $file['type'] ?: guessContentType($name);

    $now = date('Y-m-d H:i:s');
    $existing = DB::one("SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?", [$spaceId, $targetPath]);
    if ($existing) {
        DB::update('web_hosting_files', [
            'file_size' => $contentSize,
            'content_type' => $contentType,
            'content' => $content,
            'updated_at' => $now,
        ], 'id = ?', [$existing['id']]);
    } else {
        $parentPath = dirname($targetPath);
        if ($parentPath !== '.' && $parentPath !== '/') {
            ensureDirExists($spaceId, $parentPath, $now);
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
    Response::success(['path' => $targetPath, 'size' => $contentSize], '文件已上传');
}

// ===== 云空间使用情况概览 =====
if ($method === 'GET' && $action === 'usage') {
    $space = ensureDataSpace($username);
    $spaceId = $space['id'];

    // 网页空间文件总大小
    $webHostingUsed = (int)DB::scalar(
        "SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?",
        [$spaceId]
    );

    // 实例文件总大小
    $instanceFilesUsed = (int)DB::scalar(
        "SELECT COALESCE(SUM(cf.file_size), 0) FROM cloud_files cf
         JOIN instances i ON i.id = cf.instance_id
         WHERE i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
        [$schoolId, $username]
    );

    // 实例存储数据总大小
    $instanceStorageUsed = (int)DB::scalar(
        "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM instance_storage_data isd
         JOIN instances i ON i.id = isd.instance_id
         WHERE i.school_id = ? AND i.owner_type = 'alliance' AND i.owner_key = ?",
        [$schoolId, $username]
    );

    // 版本历史总大小
    $versionUsed = (int)DB::scalar(
        "SELECT COALESCE(SUM(LENGTH(content)), 0) FROM cloud_file_versions WHERE created_by = ?",
        [$username]
    );

    // 操作记录总大小
    $historyUsed = (int)DB::scalar(
        "SELECT COALESCE(SUM(LENGTH(content_snapshot)), 0) FROM cloud_file_history WHERE created_by = ?",
        [$username]
    );

    $totalUsed = $webHostingUsed + $instanceFilesUsed + $instanceStorageUsed + $versionUsed + $historyUsed;
    $totalQuota = 500 * 1024 * 1024; // 500MB 总配额

    // 文件数量统计
    $instanceCount = (int)DB::scalar(
        "SELECT COUNT(*) FROM instances WHERE school_id = ? AND owner_type = 'alliance' AND owner_key = ?",
        [$schoolId, $username]
    );
    $webSpaceCount = (int)DB::scalar(
        "SELECT COUNT(*) FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1",
        [$username]
    );
    $cloudFileCount = (int)DB::scalar(
        "SELECT COUNT(*) FROM web_hosting_files WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND is_directory = 0",
        [$spaceId]
    );

    Response::success([
        'total_used' => $totalUsed,
        'total_quota' => $totalQuota,
        'total_used_display' => formatBytes($totalUsed),
        'total_quota_display' => formatBytes($totalQuota),
        'used_percent' => $totalQuota > 0 ? round(($totalUsed / $totalQuota) * 100, 1) : 0,
        'breakdown' => [
            'web_hosting' => ['used' => $webHostingUsed, 'display' => formatBytes($webHostingUsed)],
            'instance_files' => ['used' => $instanceFilesUsed, 'display' => formatBytes($instanceFilesUsed)],
            'instance_storage' => ['used' => $instanceStorageUsed, 'display' => formatBytes($instanceStorageUsed)],
            'versions' => ['used' => $versionUsed, 'display' => formatBytes($versionUsed)],
            'history' => ['used' => $historyUsed, 'display' => formatBytes($historyUsed)],
        ],
        'counts' => [
            'instances' => $instanceCount,
            'web_spaces' => $webSpaceCount,
            'cloud_files' => $cloudFileCount,
        ],
    ]);
}

Response::error('未知的操作');

// === 辅助函数 ===

function ensureDataSpace($username) {
    $space = DB::one(
        "SELECT * FROM web_hosting_spaces WHERE alliance_username = ? AND (is_web_space IS NULL OR is_web_space = 0)",
        [$username]
    );
    if ($space) return $space;

    // 为兼容旧数据，查找第一个非 web_space 的空间
    $space = DB::one(
        "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
        [$username]
    );
    if ($space) return $space;

    $slug = $username;
    $now = date('Y-m-d H:i:s');
    $spaceId = DB::insert('web_hosting_spaces', [
        'alliance_username' => $username,
        'slug' => $slug,
        'title' => $username . ' 的数据空间',
        'description' => '',
        'storage_quota' => 100 * 1024 * 1024,
        'is_enabled' => 1,
        'is_web_space' => 0,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    return DB::one("SELECT * FROM web_hosting_spaces WHERE id = ?", [$spaceId]);
}

function normalizePath($path) {
    $path = trim($path);
    if ($path === '') return '/';
    $path = str_replace('\\', '/', $path);
    $path = preg_replace('#/+#', '/', $path);
    if ($path[0] !== '/') $path = '/' . $path;
    if (strlen($path) > 1 && str_ends_with($path, '/')) $path = rtrim($path, '/');
    return $path;
}

function ensureDirExists($spaceId, $dirPath, $now) {
    $dirPath = normalizePath($dirPath);
    if ($dirPath === '/') return;
    $exists = DB::scalar("SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1", [$spaceId, $dirPath]);
    if (!$exists) {
        $parent = dirname($dirPath);
        if ($parent !== '.' && $parent !== '/') ensureDirExists($spaceId, $parent, $now);
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

function guessContentType($path) {
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $types = [
        'html' => 'text/html', 'htm' => 'text/html', 'css' => 'text/css',
        'js' => 'application/javascript', 'mjs' => 'application/javascript',
        'json' => 'application/json', 'txt' => 'text/plain', 'md' => 'text/markdown',
        'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'svg' => 'image/svg+xml', 'ico' => 'image/x-icon',
        'pdf' => 'application/pdf', 'zip' => 'application/zip',
    ];
    return $types[$ext] ?? 'application/octet-stream';
}

function formatBytes($bytes) {
    if ($bytes <= 0) return '0 B';
    $k = 1024;
    $sizes = ['B', 'KB', 'MB', 'GB'];
    $i = floor(log($bytes) / log($k));
    return round($bytes / pow($k, $i), 1) . ' ' . $sizes[$i];
}