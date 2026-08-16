<?php
require_once __DIR__ . '/../lib/bootstrap.php';

$app = DB::one("SELECT id FROM apps WHERE app_key = 'examaware2'");
if (!$app) { echo "未找到 EA2 应用\n"; exit(1); }

$ribbon = [
    [
        'label' => '页面',
        'tools' => [
            ['id' => 'page_connect', 'label' => '连接应用', 'icon' => 'ri-link', 'command' => 'page_connect', 'type' => 'select'],
            ['id' => 'page_exams', 'label' => '考试管理', 'icon' => 'ri-file-list-3-line', 'command' => 'page_exams', 'type' => 'select'],
            ['id' => 'page_config', 'label' => '应用配置', 'icon' => 'ri-settings-3-line', 'command' => 'page_config', 'type' => 'select'],
        ]
    ],
    [
        'label' => '操作',
        'tools' => [
            ['id' => 'new_exam', 'label' => '新建考试', 'icon' => 'ri-add-line', 'command' => 'new_exam', 'type' => 'action'],
            ['id' => 'multi_edit', 'label' => '多选编辑', 'icon' => 'ri-checkbox-multiple-line', 'command' => 'multi_edit', 'type' => 'action'],
            ['id' => 'group_mgmt', 'label' => '分组管理', 'icon' => 'ri-folder-line', 'command' => 'group_mgmt', 'type' => 'action'],
        ]
    ]
];

DB::update('apps', [
    'app_info_manifest' => json_encode(['ribbon' => $ribbon], JSON_UNESCAPED_UNICODE),
    'updated_at' => date('Y-m-d H:i:s'),
], 'id = ?', [$app['id']]);

echo "已更新 EA2 Ribbon 配置（select/action 类型分离）\n";