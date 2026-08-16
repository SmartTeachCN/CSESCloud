<?php
/**
 * 实例 PHP 后端调度器
 *
 * 允许开发者在实例的 php/ 目录下放置 PHP 文件，实现自定义后端逻辑。
 * 路由：/api/instance-php.php?instance_uid={uid}&path={file}
 *
 * 示例：
 *   GET  /api/instance-php.php?instance_uid=inst-abc&path=exams.php
 *   POST /api/instance-php.php?instance_uid=inst-abc&path=exams.php
 *
 * 沙箱内的 PHP 代码可访问：
 *   $instance->id        实例 ID
 *   $instance->uid       实例 UID
 *   $instance->name      实例名称
 *   $instance->config()            获取实例配置（JSON）
 *   $instance->saveConfig($data)   保存实例配置
 *   $instance->storage($key)       获取集合存储操作对象
 *   $instance->log($msg)           写入审计日志
 *   $instance->request()           获取当前请求信息
 *   $instance->response($data)     返回 JSON 响应
 *   $instance->responseError($msg) 返回错误响应
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$instanceUid = trim($_GET['instance_uid'] ?? '');
$phpPath = trim($_GET['path'] ?? 'index.php');

if ($instanceUid === '') {
    Response::error('缺少 instance_uid 参数');
}

// 查找实例
$inst = DB::one("SELECT * FROM instances WHERE instance_uid = ?", [$instanceUid]);
if (!$inst) {
    Response::error('实例不存在', 404, 404);
}

// 校验访问权限（公开可访问，但需要实例存在且状态为 running）
if ($inst['status'] !== 'running') {
    Response::error('实例未运行', 503, 503);
}

// 查找 PHP 文件
$phpFile = DB::one(
    "SELECT * FROM cloud_files
     WHERE instance_id = ? AND file_category = 'instance_php' AND name = ?
     LIMIT 1",
    [$inst['id'], basename($phpPath)]
);

if (!$phpFile) {
    Response::error('PHP 文件不存在: ' . basename($phpPath), 404, 404);
}

if (empty($phpFile['content'])) {
    Response::error('PHP 文件为空', 500, 500);
}

// ===== 沙箱执行 =====
$result = InstancePhpSandbox::execute($inst, $phpFile, $_SERVER['REQUEST_METHOD'], $_GET, Helpers::jsonBody());

// 输出结果
if ($result !== null) {
    if (is_array($result) || is_object($result)) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    } elseif (is_string($result)) {
        echo $result;
    }
}


// ===== 沙箱类 =====
class InstancePhpSandbox
{
    /**
     * 在沙箱中执行实例 PHP 代码
     */
    public static function execute(array $inst, array $phpFile, string $method, array $query, ?array $body)
    {
        $code = $phpFile['content'];

        // 构建安全的 $instance 上下文
        $instanceContext = new InstanceContext($inst);

        // 在函数作用域中执行，隔离变量
        $executor = function ($__code, $__instance, $__method, $__query, $__body) {
            // 将 $instance 注入到执行作用域
            $instance = $__instance;
            $method = $__method;
            $query = $__query;
            $body = $__body;

            // 禁用输出缓冲中的错误泄露
            ob_start();
            try {
                $result = eval('?>' . $__code);
                $output = ob_get_clean();
                if ($result !== null) {
                    return $result;
                }
                if ($output !== '' && $output !== false) {
                    return $output;
                }
                return null;
            } catch (\Throwable $e) {
                ob_end_clean();
                return [
                    'error' => true,
                    'message' => 'PHP 执行错误: ' . $e->getMessage(),
                    'line' => $e->getLine(),
                ];
            }
        };

        return $executor($code, $instanceContext, $method, $query, $body);
    }
}


// ===== 实例上下文对象 =====
class InstanceContext
{
    private array $inst;
    private int $instanceId;
    private string $instanceUid;

    public function __construct(array $inst)
    {
        $this->inst = $inst;
        $this->instanceId = (int)$inst['id'];
        $this->instanceUid = $inst['instance_uid'] ?? '';
    }

    /**
     * 魔术访问器：$instance->id, $instance->uid, $instance->name
     */
    public function __get(string $name): mixed
    {
        return match ($name) {
            'id' => $this->instanceId,
            'uid' => $this->instanceUid,
            'name' => $this->inst['name'] ?? '',
            default => null,
        };
    }

    /**
     * 获取实例配置
     */
    public function config(): array
    {
        $row = DB::one("SELECT config FROM instances WHERE id = ?", [$this->instanceId]);
        if (!$row || empty($row['config'])) return [];
        $decoded = json_decode($row['config'], true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * 保存实例配置
     */
    public function saveConfig(array $data): bool
    {
        DB::update('instances', [
            'config' => json_encode($data, JSON_UNESCAPED_UNICODE)
        ], 'id = ?', [$this->instanceId]);
        return true;
    }

    /**
     * 获取实例存储集合操作对象
     *
     * @param string $collectionKey 集合键名
     * @return InstanceStorageCollection
     */
    public function storage(string $collectionKey): InstanceStorageCollection
    {
        return new InstanceStorageCollection($this->instanceId, $collectionKey);
    }

    /**
     * 读取实例文件内容
     *
     * @param string $fileName 文件名（相对于实例根目录）
     * @return string|null
     */
    public function readFile(string $fileName): ?string
    {
        // 查找实例根目录下的文件
        $baseDir = '/instances/' . $this->instanceUid . '/';
        $row = DB::one(
            "SELECT content FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?",
            [$this->instanceId, $baseDir, $fileName]
        );
        return $row ? $row['content'] : null;
    }

    /**
     * 写入审计日志
     */
    public function log(string $message): void
    {
        $schoolId = $this->inst['school_id'] ?? 0;
        Auth::logAudit($schoolId, 0, 'instance_php', '[PHP:' . $this->instanceUid . '] ' . $message);
    }

    /**
     * 获取当前请求信息
     */
    public function request(): array
    {
        return [
            'method' => $_SERVER['REQUEST_METHOD'] ?? 'GET',
            'query' => $_GET,
            'headers' => getallheaders(),
        ];
    }

    /**
     * 返回 JSON 成功响应并终止执行
     */
    public function response(mixed $data, string $message = 'ok'): never
    {
        Response::success($data, $message);
        exit;
    }

    /**
     * 返回 JSON 错误响应并终止执行
     */
    public function responseError(string $message, int $code = 400): never
    {
        Response::error($message, $code, $code);
        exit;
    }
}


// ===== 实例存储集合操作类 =====
class InstanceStorageCollection
{
    private int $instanceId;
    private string $collectionKey;

    public function __construct(int $instanceId, string $collectionKey)
    {
        $this->instanceId = $instanceId;
        $this->collectionKey = $collectionKey;
    }

    /**
     * 列出所有记录
     */
    public function list(): array
    {
        $rows = DB::all(
            "SELECT * FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? ORDER BY id DESC",
            [$this->instanceId, $this->collectionKey]
        );
        return array_map(function ($r) {
            $r['data'] = $r['data'] ? json_decode($r['data'], true) : null;
            return $r;
        }, $rows);
    }

    /**
     * 获取单条记录
     */
    public function get(string $recordId): ?array
    {
        $row = DB::one(
            "SELECT * FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?",
            [$this->instanceId, $this->collectionKey, $recordId]
        );
        if (!$row) return null;
        $row['data'] = $row['data'] ? json_decode($row['data'], true) : null;
        return $row;
    }

    /**
     * 保存记录（存在则更新，不存在则创建）
     */
    public function save(string $recordId, array $data): array
    {
        $now = date('Y-m-d H:i:s');
        $exists = DB::one(
            "SELECT id FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?",
            [$this->instanceId, $this->collectionKey, $recordId]
        );
        if ($exists) {
            DB::update('instance_storage_data', [
                'data' => json_encode($data, JSON_UNESCAPED_UNICODE),
                'updated_at' => $now,
            ], 'id = ?', [$exists['id']]);
            return ['record_id' => $recordId, 'updated' => true];
        } else {
            DB::insert('instance_storage_data', [
                'instance_id' => $this->instanceId,
                'collection_key' => $this->collectionKey,
                'record_id' => $recordId,
                'data' => json_encode($data, JSON_UNESCAPED_UNICODE),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            return ['record_id' => $recordId, 'created' => true];
        }
    }

    /**
     * 删除记录
     */
    public function delete(string $recordId): bool
    {
        return DB::delete(
            'instance_storage_data',
            'instance_id = ? AND collection_key = ? AND record_id = ?',
            [$this->instanceId, $this->collectionKey, $recordId]
        ) > 0;
    }
}