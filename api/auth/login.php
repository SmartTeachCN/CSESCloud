<?php
/**
 * 子用户登录 API
 *  - 学校子用户：school_id + username + password
 *  - 实例子用户：instance_uid + username + password
 *  - 可选 remember_in_list：登录成功后将该账号写入保留登录列表
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

if (!Helpers::isPost()) {
    Response::error('仅支持 POST 请求', 405, 405);
}

$body = Helpers::jsonBody();
$schoolId = (int)($body['school_id'] ?? 0);
$instanceUid = trim($body['instance_uid'] ?? '');
$username = trim($body['username'] ?? '');
$password = $body['password'] ?? '';
$rememberInList = !empty($body['remember_in_list']);

if (!$username || !$password) {
    Response::error('请填写完整信息');
}

// 路由：实例子用户 vs 学校子用户
$isInstanceLogin = ($instanceUid !== '');
if ($isInstanceLogin) {
    $ok = Auth::loginInstanceSubUser($instanceUid, $username, $password);
    if (!$ok) Response::error('实例 ID、用户名或密码错误', 1, 400);
    $entry = [
        'entry_type' => 'instance_sub',
        'display_label' => $username . ' @ ' . $instanceUid,
        'school_id' => Auth::user()['school_id'] ?? null,
        'instance_uid' => $instanceUid,
        'sub_username' => $username,
    ];
    $redirect = '/console/instances?from=instance_sub';
} else {
    if (!$schoolId) Response::error('请选择学校或填入实例 ID');
    $ok = Auth::loginSubUser($schoolId, $username, $password);
    if (!$ok) Response::error('用户名或密码错误', 1, 400);
    $entry = [
        'entry_type' => 'school_sub',
        'display_label' => $username . ' @ ' . (Auth::user()['school_name'] ?? ('SID:' . $schoolId)),
        'school_id' => $schoolId,
        'instance_uid' => null,
        'sub_username' => $username,
    ];
    $redirect = '/console/campus';
}

if ($rememberInList) {
    Auth::saveLogin($entry);
}

Response::success(['redirect' => $redirect, 'entry' => $entry], '登录成功');
