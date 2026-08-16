<?php
// CSES Cloud 实例 PHP 沙箱包装器（由 Node 服务生成调用）
error_reporting(E_ALL);
ini_set('display_errors', '0');
date_default_timezone_set('Asia/Shanghai');

$__envFile = $argv[1];
$__env = json_decode(file_get_contents($__envFile), true);
$__dbPath = $__env['db_path'];
$__inst = $__env['instance'];
$__method = $__env['method'];
$__query = $__env['query'] ?: array();
$__body = $__env['body'];
$__headers = $__env['headers'] ?: array();
$__codeFile = $__env['code_file'];

class SandboxDB {
    private static $pdo = null;
    public static function pdo($path) {
        if (self::$pdo === null) {
            self::$pdo = new PDO('sqlite:' . $path);
            self::$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            self::$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            self::$pdo->exec('PRAGMA foreign_keys = ON');
        }
        return self::$pdo;
    }
}

class InstanceStorageCollection {
    private $instanceId;
    private $collectionKey;
    public function __construct($instanceId, $collectionKey) {
        $this->instanceId = (int)$instanceId;
        $this->collectionKey = $collectionKey;
    }
    public function list() {
        global $__dbPath;
        $rows = SandboxDB::pdo($__dbPath)->query(
            "SELECT * FROM instance_storage_data WHERE instance_id = " . $this->instanceId .
            " AND collection_key = " . SandboxDB::pdo($__dbPath)->quote($this->collectionKey) .
            " ORDER BY id DESC")->fetchAll();
        return array_map(function ($r) {
            $r['data'] = $r['data'] ? json_decode($r['data'], true) : null;
            return $r;
        }, $rows);
    }
    public function get($recordId) {
        global $__dbPath;
        $st = SandboxDB::pdo($__dbPath)->prepare(
            "SELECT * FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?");
        $st->execute([$this->instanceId, $this->collectionKey, $recordId]);
        $row = $st->fetch();
        if (!$row) return null;
        $row['data'] = $row['data'] ? json_decode($row['data'], true) : null;
        return $row;
    }
    public function save($recordId, $data) {
        global $__dbPath;
        $now = date('Y-m-d H:i:s');
        $pdo = SandboxDB::pdo($__dbPath);
        $st = $pdo->prepare(
            "SELECT id FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?");
        $st->execute([$this->instanceId, $this->collectionKey, $recordId]);
        $exists = $st->fetch();
        if ($exists) {
            $st = $pdo->prepare("UPDATE instance_storage_data SET data = ?, updated_at = ? WHERE id = ?");
            $st->execute([json_encode($data, JSON_UNESCAPED_UNICODE), $now, $exists['id']]);
            return ['record_id' => $recordId, 'updated' => true];
        }
        $st = $pdo->prepare(
            "INSERT INTO instance_storage_data (instance_id, collection_key, record_id, data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)");
        $st->execute([$this->instanceId, $this->collectionKey, $recordId, json_encode($data, JSON_UNESCAPED_UNICODE), $now, $now]);
        return ['record_id' => $recordId, 'created' => true];
    }
    public function delete($recordId) {
        global $__dbPath;
        $st = SandboxDB::pdo($__dbPath)->prepare(
            "DELETE FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?");
        $st->execute([$this->instanceId, $this->collectionKey, $recordId]);
        return $st->rowCount() > 0;
    }
}

class InstanceContext {
    private $inst;
    private $instanceId;
    private $instanceUid;
    public function __construct($inst, $dbPath) {
        $this->inst = $inst;
        $this->instanceId = (int)$inst['id'];
        $this->instanceUid = $inst['instance_uid'];
    }
    public function __get($name) {
        switch ($name) {
            case 'id': return $this->instanceId;
            case 'uid': return $this->instanceUid;
            case 'name': return isset($this->inst['name']) ? $this->inst['name'] : '';
            default: return null;
        }
    }
    public function config() {
        global $__dbPath;
        $st = SandboxDB::pdo($__dbPath)->prepare("SELECT config FROM instances WHERE id = ?");
        $st->execute([$this->instanceId]);
        $row = $st->fetch();
        if (!$row || empty($row['config'])) return [];
        $decoded = json_decode($row['config'], true);
        return is_array($decoded) ? $decoded : [];
    }
    public function saveConfig($data) {
        global $__dbPath;
        $st = SandboxDB::pdo($__dbPath)->prepare("UPDATE instances SET config = ? WHERE id = ?");
        $st->execute([json_encode($data, JSON_UNESCAPED_UNICODE), $this->instanceId]);
        return true;
    }
    public function storage($collectionKey) {
        return new InstanceStorageCollection($this->instanceId, $collectionKey);
    }
    public function readFile($fileName) {
        global $__dbPath;
        $baseDir = '/instances/' . $this->instanceUid . '/';
        $st = SandboxDB::pdo($__dbPath)->prepare(
            "SELECT content FROM cloud_files WHERE instance_id = ? AND directory = ? AND name = ?");
        $st->execute([$this->instanceId, $baseDir, $fileName]);
        $row = $st->fetch();
        return $row ? $row['content'] : null;
    }
    public function log($message) {
        global $__dbPath;
        $schoolId = isset($this->inst['school_id']) ? $this->inst['school_id'] : 0;
        $st = SandboxDB::pdo($__dbPath)->prepare(
            "INSERT INTO audit_logs (school_id, user_id, username, action, target, ip, status, created_at)
             VALUES (?, 0, 'system', 'instance_php', ?, 'sandbox', 'success', ?)");
        $st->execute([$schoolId, '[PHP:' . $this->instanceUid . '] ' . $message, date('Y-m-d H:i:s')]);
    }
    public function request() {
        global $__method, $__query, $__headers;
        return ['method' => $__method, 'query' => $__query, 'headers' => $__headers];
    }
    public function response($data, $message = 'ok') {
        echo json_encode([
            '__sandbox_response' => ['code' => 0, 'message' => $message, 'data' => $data],
            '__http' => 200,
        ], JSON_UNESCAPED_UNICODE);
        exit(0);
    }
    public function responseError($message, $code = 400) {
        echo json_encode([
            '__sandbox_response' => ['code' => $code, 'message' => $message, 'data' => null],
            '__http' => $code >= 100 && $code < 600 ? $code : 400,
        ], JSON_UNESCAPED_UNICODE);
        exit(0);
    }
}

$instance = new InstanceContext($__inst, $__dbPath);
$method = $__method;
$query = $__query;
$body = $__body;
$headers = $__headers;

ob_start();
try {
    $__result = include $__codeFile;
    // 对齐 eval() 语义：无 return 的文件 include 返回 1，eval 返回 null
    if ($__result === 1) { $__result = null; }
    $__output = ob_get_clean();
    $__payload = [
        'result' => ($__result instanceof InstanceContext) ? null : $__result,
        'output' => $__output === '' ? null : $__output,
    ];
} catch (Throwable $e) {
    ob_end_clean();
    $__payload = ['error' => ['message' => 'PHP 执行错误: ' . $e->getMessage(), 'line' => $e->getLine()]];
}

function __sandbox_json_safe($v) {
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
}

// 结果序列化失败时降级
$__json = __sandbox_json_safe($__payload);
if ($__json === false) {
    $__json = __sandbox_json_safe(['result' => null, 'output' => '[不可序列化的返回值]']);
}
echo PHP_EOL . '__SANDBOX_RESULT__' . PHP_EOL . $__json;
