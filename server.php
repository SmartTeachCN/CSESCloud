<?php
/**
 * CSES Cloud - PHP 内置服务器路由
 *
 * 开发模式：仅处理 /api/ 请求（前端由 Vite 开发服务器代理）
 * 生产模式：处理 /api/ 请求 + 提供 frontend/dist/ 静态文件（SPA 回退）
 *
 * 启动：
 *   php -S 127.0.0.1:8000 server.php
 */

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// ── 网页托管路由（/site/{slug}） ──
if (preg_match('#^/site/([a-z0-9-]+)(/.*)?$#i', $uri, $matches)) {
    require __DIR__ . '/lib/bootstrap.php';
    $slug = $matches[1];
    $filePath = $matches[2] ?? '/';

    $space = DB::one(
        "SELECT s.id, s.is_enabled
         FROM web_hosting_spaces s
         WHERE s.slug = ?",
        [$slug]
    );

    if (!$space || !$space['is_enabled']) {
        http_response_code(404);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>未找到</title></head><body><h1>404 - 站点未找到</h1><p>该班级主页不存在或已被禁用。</p></body></html>';
        return true;
    }

    // 标准化文件路径
    $filePath = '/' . trim($filePath, '/');
    if ($filePath === '' || $filePath === '/') {
        $filePath = '/index.html';
    }

    // 阻止访问隐藏目录（/.cloud/ 等）
    if (preg_match('#/\.#', $filePath)) {
        http_response_code(404);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>404</title></head><body><h1>404 - 文件未找到</h1></body></html>';
        return true;
    }

    // 查找文件
    $file = DB::one(
        "SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0",
        [$space['id'], $filePath]
    );

    if (!$file) {
        // 尝试用 index.html 作为目录索引
        $dirPath = $filePath;
        if ($dirPath !== '/') {
            $dirPath = rtrim($dirPath, '/');
        }
        $indexPath = $dirPath . '/index.html';
        $file = DB::one(
            "SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0",
            [$space['id'], $indexPath]
        );
    }

    if (!$file) {
        http_response_code(404);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>404</title></head><body><h1>404 - 文件未找到</h1></body></html>';
        return true;
    }

    $contentType = $file['content_type'] ?? 'application/octet-stream';
    $rawContent = $file['content'] ?? '';
    // 确保 BLOB 数据被正确处理为字符串
    if (is_resource($rawContent)) {
        $rawContent = stream_get_contents($rawContent);
    }
    $contentLen = strlen($rawContent);
    // 文本类型才加 charset=utf-8
    $isText = preg_match('#^(text/|application/(javascript|json|xml)|image/svg)#', $contentType);
    header('Content-Type: ' . $contentType . ($isText ? '; charset=utf-8' : ''));
    header('Cache-Control: public, max-age=300');
    header('X-Debug-Size: ' . $contentLen . ' bytes');
    if ($contentLen === 0 && $isText) {
        echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>空文件</title></head><body><h1>文件内容为空</h1><p>该文件（' . htmlspecialchars($filePath) . '）内容为空。</p></body></html>';
    } else {
        echo $rawContent;
    }
    return true;
}

// ── API 路由 ──
if (preg_match('#^/api/(.+)$#', $uri, $matches)) {
    $apiPath = $matches[1];
    // 如果 URL 已包含 .php，直接使用；否则追加 .php
    $apiFile = __DIR__ . '/api/' . $apiPath;
    if (!str_ends_with($apiPath, '.php')) {
        $apiFile .= '.php';
    }
    if (file_exists($apiFile)) {
        require $apiFile;
        return true;
    }
    // 如果 API 文件不存在，返回 404 JSON
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['code' => 404, 'message' => 'API 端点不存在'], JSON_UNESCAPED_UNICODE);
    return true;
}

// ── 生产模式：提供 dist/ 静态文件（npm run build 的输出目录） ──
$distDir = __DIR__ . '/dist';

// 如果请求的是具体文件且存在，直接返回
$filePath = $distDir . $uri;
if ($uri !== '/' && is_file($filePath)) {
    // 根据扩展名设置 MIME 类型
    $ext = pathinfo($filePath, PATHINFO_EXTENSION);
    $mimeTypes = [
        'html' => 'text/html', 'css' => 'text/css', 'js' => 'application/javascript',
        'json' => 'application/json', 'svg' => 'image/svg+xml', 'png' => 'image/png',
        'jpg' => 'image/jpeg', 'ico' => 'image/x-icon', 'woff2' => 'font/woff2',
    ];
    header('Content-Type: ' . ($mimeTypes[$ext] ?? 'application/octet-stream'));
    readfile($filePath);
    return true;
}

// SPA 回退：所有非 API 请求返回 index.html
$indexPath = $distDir . '/index.html';
if (file_exists($indexPath)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($indexPath);
    return true;
}

// 如果没有 dist 目录（开发模式），返回提示
http_response_code(200);
header('Content-Type: text/plain; charset=utf-8');
echo "CSES Cloud API Server\n";
echo "开发模式：前端由 Vite 开发服务器提供，请通过 Vite 端口访问\n";
return true;