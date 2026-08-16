<?php
/**
 * 临时管理员登录 API
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

if (!Helpers::isPost()) {
    Response::error('仅支持 POST 请求', 405, 405);
}

$body = Helpers::jsonBody();
$username = trim($body['username'] ?? '');
$password = $body['password'] ?? '';

if (!$username || !$password) {
    Response::error('请填写用户名和密码');
}

$ok = Auth::loginTempAdmin($username, $password);
if (!$ok) {
    Response::error('临时管理员模式未开启或用户名/密码错误', 1, 400);
}

Response::success(['redirect' => '/console/admin'], '临时管理员登录成功');