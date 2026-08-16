<?php
/** 头像文件服务 */
require_once __DIR__ . '\..\lib\bootstrap.php';

$file = $_GET['file'] ?? '';
if (!$file || strpos($file, '..') !== false || strpos($file, '/') !== false || strpos($file, '\\') !== false) {
    http_response_code(400);
    exit;
}

$path = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'avatars' . DIRECTORY_SEPARATOR . $file;
if (!file_exists($path)) {
    http_response_code(404);
    exit;
}

$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
$mimeTypes = [
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
];
$mime = $mimeTypes[$ext] ?? 'application/octet-stream';

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($path));
header('Cache-Control: public, max-age=86400');
readfile($path);