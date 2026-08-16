<?php
// 上传学校申请 - 接收学校申请并保存到数据库
require_once __DIR__ . '\..\..\lib\bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['code' => 405, 'message' => '仅支持 POST 请求']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$name = trim($body['name'] ?? '');
$contact = trim($body['contact'] ?? '');
$phone = trim($body['phone'] ?? '');
$description = trim($body['description'] ?? '');

if ($name === '') {
    http_response_code(400);
    echo json_encode(['code' => 400, 'message' => '学校名称不能为空']);
    exit;
}

try {
    $db = db();
    // 自动建表（若不存在）
    $db->exec("CREATE TABLE IF NOT EXISTS school_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT,
        phone TEXT,
        description TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )");
    $stmt = $db->prepare("INSERT INTO school_applications (name, contact, phone, description) VALUES (?, ?, ?, ?)");
    $stmt->execute([$name, $contact, $phone, $description]);
    echo json_encode(['code' => 0, 'message' => '申请已提交']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['code' => 500, 'message' => '提交失败：' . $e->getMessage()]);
}
