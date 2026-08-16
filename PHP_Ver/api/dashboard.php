<?php
/** 控制台仪表盘数据 */
require_once __DIR__ . '\..\lib\bootstrap.php';
Auth::requireLogin();
$schoolId = Auth::schoolId();

$stats = [
    'classes' => (int)DB::scalar("SELECT COUNT(*) FROM classes WHERE school_id = ?", [$schoolId]),
    'students' => (int)DB::scalar("SELECT COUNT(*) FROM students WHERE school_id = ?", [$schoolId]),
    'services' => (int)DB::scalar("SELECT COUNT(*) FROM services WHERE school_id = ? AND status = 'running'", [$schoolId]),
    'sub_users' => (int)DB::scalar("SELECT COUNT(*) FROM users WHERE school_id = ?", [$schoolId]),
    'instances' => (int)DB::scalar("SELECT COUNT(*) FROM instances WHERE school_id = ?", [$schoolId]),
    'instances_running' => (int)DB::scalar("SELECT COUNT(*) FROM instances WHERE school_id = ? AND status = 'running'", [$schoolId]),
];

$activities = DB::all(
    "SELECT * FROM audit_logs WHERE school_id = ? ORDER BY id DESC LIMIT 6",
    [$schoolId]
);

$classes = DB::all(
    "SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
     FROM classes c WHERE c.school_id = ? ORDER BY c.id DESC LIMIT 5",
    [$schoolId]
);

$services = DB::all("SELECT * FROM services WHERE school_id = ? ORDER BY id ASC", [$schoolId]);

Response::success([
    'stats' => $stats,
    'activities' => $activities,
    'recent_classes' => $classes,
    'services' => $services,
]);
