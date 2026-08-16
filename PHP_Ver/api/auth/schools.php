<?php
/** 学校列表查询（用于登录页学校选择） */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

$schools = DB::all("SELECT id, name, short_name, admin_username, status, address FROM schools ORDER BY id ASC");
Response::success($schools);
