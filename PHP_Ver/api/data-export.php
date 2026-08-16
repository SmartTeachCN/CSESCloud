<?php
/** 数据导出 API */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'history') {
    Response::success(DB::all("SELECT * FROM data_exports WHERE school_id = ? ORDER BY id DESC LIMIT 50", [$schoolId]));
}

if ($method === 'POST' && $action === 'export') {
    $type = $body['type'] ?? '';
    $format = $body['format'] ?? 'csv';
    $validTypes = ['班级数据' => 'classes', '学生数据' => 'students', '服务数据' => 'services', '子用户数据' => 'users'];
    if (!isset($validTypes[$type])) Response::error('无效的导出类型');

    $tableName = $validTypes[$type];
    $rows = DB::all("SELECT * FROM {$tableName} WHERE school_id = ?", [$schoolId]);

    // 生成文件内容
    $content = '';
    $filename = $type . '_' . date('Ymd_His') . '.' . $format;
    $filepath = '/exports/' . $filename;

    if ($format === 'json') {
        $content = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    } else {
        // CSV / Excel 均输出 CSV
        if (!empty($rows)) {
            $headers = array_keys($rows[0]);
            // BOM + 表头
            $content = "\xEF\xBB\xBF" . implode(',', $headers) . "\n";
            foreach ($rows as $row) {
                $line = [];
                foreach ($headers as $h) {
                    $val = $row[$h] ?? '';
                    $val = str_replace(['"', "\n", "\r"], ['""', ' ', ' '], $val);
                    $line[] = '"' . $val . '"';
                }
                $content .= implode(',', $line) . "\n";
            }
        }
    }

    // 保存到 public/exports 目录（可直接通过 HTTP 下载）
    $exportsDir = __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'exports';
    if (!is_dir($exportsDir)) mkdir($exportsDir, 0777, true);
    file_put_contents($exportsDir . DIRECTORY_SEPARATOR . $filename, $content);

    $id = DB::insert('data_exports', [
        'school_id' => $schoolId,
        'user_id' => Auth::user()['user_id'] ?? 0,
        'type' => $type,
        'format' => $format,
        'status' => 'completed',
        'file_path' => $filepath,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'export', "导出 {$type}");

    Response::success(['id' => $id, 'download_url' => '/exports/' . rawurlencode($filename), 'filename' => $filename], '导出成功');
}

Response::error('未知的操作');
