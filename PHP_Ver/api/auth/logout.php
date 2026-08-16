<?php
/** 退出登录 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

Auth::logout();
Response::success(null, '已退出登录');
