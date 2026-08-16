<?php
/** 班级 CRUD API */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'list') {
    $keyword = trim($_GET['keyword'] ?? '');
    $sql = "SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
            FROM classes c WHERE c.school_id = ?";
    $params = [$schoolId];
    if ($keyword !== '') {
        $sql .= " AND c.name LIKE ?";
        $params[] = "%{$keyword}%";
    }
    $sql .= " ORDER BY c.id DESC";
    Response::success(DB::all($sql, $params));
}

if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $cls = DB::one("SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
                    FROM classes c WHERE c.id = ? AND c.school_id = ?", [$id, $schoolId]);
    if (!$cls) Response::error('班级不存在');
    Response::success($cls);
}

if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    $grade = trim($body['grade'] ?? '');
    $teacher = trim($body['head_teacher'] ?? '');
    if (!$name || !$grade) Response::error('请填写班级名称和年级');
    $id = DB::insert('classes', [
        'school_id' => $schoolId,
        'name' => $name,
        'grade' => $grade,
        'head_teacher' => $teacher,
        'student_count' => 0,
        'status' => 'active',
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'create', "新增班级 {$name}");
    Response::success(['id' => $id], '班级创建成功');
}

if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    $name = trim($body['name'] ?? '');
    $grade = trim($body['grade'] ?? '');
    $teacher = trim($body['head_teacher'] ?? '');
    if (!$id || !$name) Response::error('参数错误');
    DB::update('classes', ['name' => $name, 'grade' => $grade, 'head_teacher' => $teacher], 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'update', "修改班级 {$name}");
    Response::success(null, '更新成功');
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('参数错误');
    $cls = DB::one("SELECT * FROM classes WHERE id = ? AND school_id = ?", [$id, $schoolId]);
    if (!$cls) Response::error('班级不存在');
    DB::delete('classes', 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'delete', "删除班级 {$cls['name']}");
    Response::success(null, '删除成功');
}

Response::error('未知的操作');
