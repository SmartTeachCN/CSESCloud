<?php
require_once __DIR__ . '/../lib/bootstrap.php';

$uid = 'inst-ea2demo';
$inst = DB::one("SELECT * FROM instances WHERE instance_uid = ?", [$uid]);
if (!$inst) { echo "实例不存在\n"; exit(1); }
echo "实例: {$inst['name']} (id={$inst['id']})\n";

function apiCall($action, $payload = []) {
    global $uid;
    $url = "http://127.0.0.1:8000/api/ea2-control.php?instance_uid={$uid}&action={$action}";
    $opts = [
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]
    ];
    $ctx = stream_context_create($opts);
    return file_get_contents($url, false, $ctx);
}

// 测试 command_create
echo "--- 测试 command_create ---\n";
$resp = apiCall('command_create', [
    'command_type' => 'playback.activate',
    'device_id' => '550e8400-e29b-41d4-a716-446655440001',
    'payload' => [
        'deployment_id' => '11111111-1111-4111-8111-111111111111',
        'exam_config_version_id' => '22222222-2222-4222-8222-222222222222',
    ],
]);
echo $resp . "\n";

// 测试 command_poll (device polls for commands)
echo "\n--- 测试 command_poll ---\n";
echo apiCall('command_poll', [
    'device_id' => '550e8400-e29b-41d4-a716-446655440001',
]) . "\n";

// 测试 command_list
echo "\n--- 测试 command_list ---\n";
echo apiCall('command_list') . "\n";

// 测试 exam_config_list
echo "\n--- 测试 exam_config_list ---\n";
echo apiCall('exam_config_list') . "\n";

echo "\n=== 所有测试完成 ===\n";