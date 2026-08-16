<?php
/** 学生 CRUD API */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'list') {
    $classId = (int)($_GET['class_id'] ?? 0);
    $keyword = trim($_GET['keyword'] ?? '');
    $sql = "SELECT * FROM students WHERE school_id = ?";
    $params = [$schoolId];
    if ($classId > 0) { $sql .= " AND class_id = ?"; $params[] = $classId; }
    if ($keyword !== '') { $sql .= " AND (name LIKE ? OR student_no LIKE ?)"; $params[] = "%{$keyword}%"; $params[] = "%{$keyword}%"; }
    $sql .= " ORDER BY id DESC";
    Response::success(DB::all($sql, $params));
}

if ($method === 'GET' && $action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $stu = DB::one("SELECT s.*, c.name AS class_name, c.grade
                    FROM students s LEFT JOIN classes c ON c.id = s.class_id
                    WHERE s.id = ? AND s.school_id = ?", [$id, $schoolId]);
    if (!$stu) Response::error('学生不存在');
    Response::success($stu);
}

if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    $classId = (int)($body['class_id'] ?? 0);
    $gender = $body['gender'] ?? '男';
    if (!$name || !$classId) Response::error('请填写学生姓名和班级');
    // 生成学号
    $count = (int)DB::scalar("SELECT COUNT(*) FROM students WHERE class_id = ?", [$classId]) + 1;
    $studentNo = sprintf('S%04d%03d', $classId, $count);
    $id = DB::insert('students', [
        'school_id' => $schoolId, 'class_id' => $classId, 'name' => $name,
        'student_no' => $studentNo, 'gender' => $gender, 'status' => 'active',
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'create', "新增学生 {$name}");
    Response::success(['id' => $id, 'student_no' => $studentNo], '学生添加成功');
}

if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    $name = trim($body['name'] ?? '');
    $classId = (int)($body['class_id'] ?? 0);
    $gender = $body['gender'] ?? '男';
    if (!$id || !$name) Response::error('参数错误');
    DB::update('students', ['name' => $name, 'class_id' => $classId, 'gender' => $gender], 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'update', "修改学生 {$name}");
    Response::success(null, '更新成功');
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('参数错误');
    $stu = DB::one("SELECT * FROM students WHERE id = ? AND school_id = ?", [$id, $schoolId]);
    if (!$stu) Response::error('学生不存在');
    DB::delete('students', 'id = ? AND school_id = ?', [$id, $schoolId]);
    Auth::logAudit($schoolId, Auth::user()['user_id'] ?? 0, 'delete', "删除学生 {$stu['name']}");
    Response::success(null, '删除成功');
}

Response::error('未知的操作');
