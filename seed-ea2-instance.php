<?php
/**
 * CSES Cloud - EA2 实例 + PHP 后端初始化
 * 创建示例 EA2 实例并附带示例 PHP 后端文件
 */
require_once __DIR__ . '/lib/bootstrap.php';

$now = date('Y-m-d H:i:s');

// ===== 1. 创建或获取 EA2 应用模板 =====
$app = DB::one("SELECT id FROM apps WHERE app_key = ?", ['examaware2']);
if (!$app) {
    $appId = DB::insert('apps', [
        'developer_username' => 'system',
        'app_key' => 'examaware2',
        'name' => 'ExamAware 2 考试管理',
        'version' => '1.0.0',
        'description' => 'ExamAware2 考试档案管理，支持考试场次配置、材料清单、时间验证。',
        'category' => '评测服务',
        'status' => 'published',
        'is_shared' => 1,
        'is_official' => 1,
        'app_info_manifest' => json_encode(['ribbon' => []], JSON_UNESCAPED_UNICODE),
        'storage_manifest' => json_encode([
            'collections' => [
                [
                    'key' => 'exams',
                    'label' => '考试配置',
                    'icon' => 'ri-file-settings-line',
                    'fields' => [
                        ['key' => 'examName', 'label' => '考试名称', 'type' => 'text'],
                        ['key' => 'message', 'label' => '提示信息', 'type' => 'text'],
                        ['key' => 'start', 'label' => '开始时间', 'type' => 'date'],
                        ['key' => 'end', 'label' => '结束时间', 'type' => 'date'],
                    ]
                ]
            ]
        ], JSON_UNESCAPED_UNICODE),
        'editor_html' => '',
        'editor_js' => '',
        'interface_schema' => json_encode([], JSON_UNESCAPED_UNICODE),
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    echo "创建 EA2 应用模板: id={$appId}\n";
} else {
    $appId = $app['id'];
    echo "EA2 应用模板已存在: id={$appId}\n";
}

// ===== 2. 创建示例实例 =====
$instanceUid = 'inst-ea2demo';
$instance = DB::one("SELECT id FROM instances WHERE instance_uid = ?", [$instanceUid]);
if (!$instance) {
    $instanceId = DB::insert('instances', [
        'school_id' => 1,
        'name' => 'EA2 示例考试实例',
        'service_type' => '评测服务',
        'status' => 'running',
        'app_id' => $appId,
        'owner_user_id' => 1,
        'owner_type' => 'alliance',
        'owner_key' => 'alliance:admin',
        'instance_uid' => $instanceUid,
        'config' => json_encode(['schoolName' => '示例学校', 'maxExamDuration' => 180], JSON_UNESCAPED_UNICODE),
        'created_at' => $now,
    ]);
    echo "创建 EA2 实例: id={$instanceId}, uid={$instanceUid}\n";
} else {
    $instanceId = $instance['id'];
    echo "EA2 实例已存在: id={$instanceId}\n";
}

// ===== 3. 创建示例 PHP 后端文件 =====
$phpFileName = 'exams.php';
$phpDir = '/instances/' . $instanceUid . '/php/';
$existing = DB::one(
    "SELECT id FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?",
    [$instanceId, $phpDir, $phpFileName]
);

if (!$existing) {
    $phpCode = <<<'PHP'
<?php
/**
 * EA2 考试管理 API
 * 路由: /api/instance-php.php?instance_uid=inst-ea2demo&path=exams.php
 *
 * 支持操作:
 *   GET  ?action=list             列出所有考试配置
 *   GET  ?action=get&id=RECORD_ID  获取单个考试配置
 *   POST ?action=create            创建考试配置
 *   POST ?action=update            更新考试配置
 *   POST ?action=delete            删除考试配置
 */

// 路由处理
$action = $_GET['action'] ?? ($body['action'] ?? 'list');

switch ($action) {
    case 'list':
        $rows = $instance->storage('exams')->list();
        $instance->response($rows, 'ok');

    case 'get':
        $recordId = $_GET['id'] ?? ($body['id'] ?? '');
        if (!$recordId) {
            $instance->responseError('缺少 id 参数');
        }
        $record = $instance->storage('exams')->get($recordId);
        if (!$record) {
            $instance->responseError('考试配置不存在', 404);
        }
        $instance->response($record, 'ok');

    case 'create':
        $examName = $body['examName'] ?? '';
        $start = $body['start'] ?? '';
        $end = $body['end'] ?? '';
        $message = $body['message'] ?? '';

        if (!$examName || !$start || !$end) {
            $instance->responseError('考试名称、开始时间、结束时间不能为空');
        }

        // 验证时间格式
        if (strtotime($start) === false || strtotime($end) === false) {
            $instance->responseError('时间格式无效');
        }

        if (strtotime($start) >= strtotime($end)) {
            $instance->responseError('开始时间必须早于结束时间');
        }

        $recordId = 'exam_' . time();
        $result = $instance->storage('exams')->save($recordId, [
            'examName' => $examName,
            'message' => $message,
            'start' => $start,
            'end' => $end,
            'created_at' => date('Y-m-d H:i:s'),
        ]);

        $instance->log("创建考试配置: {$examName}");
        $instance->response($result, '考试配置已创建');

    case 'update':
        $recordId = $body['id'] ?? '';
        if (!$recordId) {
            $instance->responseError('缺少 id 参数');
        }

        $existing = $instance->storage('exams')->get($recordId);
        if (!$existing) {
            $instance->responseError('考试配置不存在', 404);
        }

        $data = $existing['data'] ?? [];
        foreach (['examName', 'message', 'start', 'end'] as $field) {
            if (isset($body[$field])) {
                $data[$field] = $body[$field];
            }
        }
        $data['updated_at'] = date('Y-m-d H:i:s');

        $result = $instance->storage('exams')->save($recordId, $data);
        $instance->log("更新考试配置: {$recordId}");
        $instance->response($result, '考试配置已更新');

    case 'delete':
        $recordId = $body['id'] ?? '';
        if (!$recordId) {
            $instance->responseError('缺少 id 参数');
        }

        $instance->storage('exams')->delete($recordId);
        $instance->log("删除考试配置: {$recordId}");
        $instance->response(['ok' => true], '已删除');

    default:
        $instance->responseError('未知操作: ' . $action);
}
PHP;

    $fileId = DB::insert('cloud_files', [
        'instance_id' => $instanceId,
        'school_id' => 1,
        'directory' => $phpDir,
        'name' => $phpFileName,
        'content' => $phpCode,
        'file_size' => strlen($phpCode),
        'file_type' => 'php',
        'file_category' => 'instance_php',
        'status' => 'synced',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    echo "创建 PHP 后端文件: id={$fileId}, path={$phpDir}{$phpFileName}\n";
} else {
    echo "PHP 后端文件已存在: id={$existing['id']}\n";
}

// ===== 3.5. 创建 EA2 控制服务器 PHP 后端 =====
$controlFileName = 'control.php';
$controlExisting = DB::one(
    "SELECT id FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?",
    [$instanceId, $phpDir, $controlFileName]
);

if (!$controlExisting) {
    $controlCode = file_get_contents(__DIR__ . '/api/ea2-control.php');
    if ($controlCode) {
        $controlFileId = DB::insert('cloud_files', [
            'instance_id' => $instanceId,
            'school_id' => 1,
            'directory' => $phpDir,
            'name' => $controlFileName,
            'content' => $controlCode,
            'file_size' => strlen($controlCode),
            'file_type' => 'php',
            'file_category' => 'instance_php',
            'status' => 'synced',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        echo "创建 EA2 控制服务器 PHP: id={$controlFileId}, path={$phpDir}{$controlFileName}\n";
    }
} else {
    echo "EA2 控制服务器 PHP 已存在: id={$controlExisting['id']}\n";
}

// ===== 4. 创建示例 .ea2 配置文件 =====
$ea2FileName = 'config.ea2';
$ea2Dir = '/instances/' . $instanceUid . '/';
$ea2Existing = DB::one(
    "SELECT id FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?",
    [$instanceId, $ea2Dir, $ea2FileName]
);

if (!$ea2Existing) {
    $ea2Content = json_encode([
        'examName' => '2026年秋季期末考试',
        'message' => '请同学们认真答题，遵守考场纪律。',
        'examInfos' => [
            [
                'name' => '语文',
                'start' => '2026-09-15T08:00:00',
                'end' => '2026-09-15T10:00:00',
                'alertTime' => 5,
                'materials' => [
                    ['name' => '试卷', 'quantity' => 1, 'unit' => '份'],
                    ['name' => '答题卡', 'quantity' => 1, 'unit' => '张'],
                ]
            ],
            [
                'name' => '数学',
                'start' => '2026-09-15T14:00:00',
                'end' => '2026-09-15T16:00:00',
                'alertTime' => 5,
                'materials' => [
                    ['name' => '试卷', 'quantity' => 1, 'unit' => '份'],
                    ['name' => '草稿纸', 'quantity' => 2, 'unit' => '张'],
                ]
            ]
        ]
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

    $ea2FileId = DB::insert('cloud_files', [
        'instance_id' => $instanceId,
        'school_id' => 1,
        'directory' => $ea2Dir,
        'name' => $ea2FileName,
        'content' => $ea2Content,
        'file_size' => strlen($ea2Content),
        'file_type' => 'ea2',
        'file_category' => 'instance_config',
        'status' => 'synced',
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    echo "创建 EA2 配置文件: id={$ea2FileId}, path={$ea2Dir}{$ea2FileName}\n";
} else {
    echo "EA2 配置文件已存在: id={$ea2Existing['id']}\n";
}

echo "\n=== 初始化完成 ===\n";
echo "实例 UID: {$instanceUid}\n";
echo "PHP 后端: /api/instance-php.php?instance_uid={$instanceUid}&path=exams.php\n";
echo "EA2 配置: 在实例编辑器中打开 config.ea2\n";