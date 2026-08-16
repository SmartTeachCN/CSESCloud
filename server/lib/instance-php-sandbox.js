/**
 * CSES Cloud - 实例自定义 PHP 后端沙箱（NodeJS 版）
 *
 * 1:1 复刻 api/instance-php.php 中 InstancePhpSandbox 的执行语义：
 * 开发者在实例 php/ 目录下的 PHP 代码通过 PHP CLI 子进程执行，
 * 享有与原版相同的 $instance 上下文 API（config/saveConfig/storage/readFile/log/request/response）。
 *
 * 进程间协议（stdout 输出一个 JSON 信封）：
 *   { __sandbox_response: {code,message,data}, __http?: number }   // 调用了 response()/responseError()
 *   { result: <include返回值>, output: "<缓冲区输出>" }             // 正常返回
 *   { error: { message, line } }                                    // 执行出错
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const serverConfig = require('./server-config');

const ROOT = path.join(__dirname, '..', '..');
const TMP_DIR = path.join(ROOT, 'data', 'tmp', 'instance-php');

// ── PHP CLI 定位（带缓存） ──
let _phpBin = null;
let _extDir = null;

function phpCandidates() {
  const list = [];
  if (process.env.PHP_BIN) list.push(process.env.PHP_BIN);
  list.push(serverConfig.php?.bin || 'php');
  // 常见安装路径（与原 start.bat / package.json 中的机器路径一致）
  list.push('D:\\phps\\php-8.5.9-nts-Win32-vs17-x64\\php.exe');
  list.push('C:\\php\\php.exe', 'D:\\php\\php.exe', 'E:\\php\\php.exe');
  list.push('C:\\xampp\\php\\php.exe', 'D:\\xampp\\php\\php.exe');
  return list;
}

function runCmd(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 8000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout || ''));
    });
  });
}

async function resolvePhp() {
  if (_phpBin) return { bin: _phpBin, extDir: _extDir };
  for (const bin of phpCandidates()) {
    const ver = await runCmd(bin, ['-v']);
    if (ver && ver.startsWith('PHP')) {
      _phpBin = bin;
      // 探测 pdo_sqlite 扩展
      let mods = await runCmd(bin, ['-m']);
      if (mods && /pdo_sqlite/i.test(mods)) {
        _extDir = process.env.PHP_EXTENSION_DIR || serverConfig.php?.extension_dir || '';
        return { bin: _phpBin, extDir: _extDir };
      }
      // 尝试显式指定 extension_dir（与 PHP 版路径同目录下的 ext）
      const base = path.dirname(bin);
      for (const ext of [process.env.PHP_EXTENSION_DIR, serverConfig.php?.extension_dir, path.join(base, 'ext')]) {
        if (!ext) continue;
        mods = await runCmd(bin, [`-d`, `extension_dir=${ext}`, '-m']);
        if (mods && /pdo_sqlite/i.test(mods)) {
          _extDir = ext;
          return { bin: _phpBin, extDir: _extDir };
        }
      }
      _extDir = '';
      return { bin: _phpBin, extDir: '' };
    }
  }
  return null;
}

// ── 沙箱包装器（PHP） ──
const WRAPPER_PHP = `<?php
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
`;

let _wrapperFile = null;
function getWrapperFile() {
  if (_wrapperFile) return _wrapperFile;
  fs.mkdirSync(TMP_DIR, { recursive: true });
  _wrapperFile = path.join(TMP_DIR, '_sandbox_wrapper.php');
  fs.writeFileSync(_wrapperFile, WRAPPER_PHP, 'utf8');
  return _wrapperFile;
}

/**
 * 执行实例 PHP 沙箱
 * @param {object} inst  实例行
 * @param {object} phpFile cloud_files 行（含 content）
 * @param {string} method
 * @param {object} query
 * @param {object|null} body
 * @param {object} headers
 * @returns {Promise<{kind:'response',http:number,body:object}|{kind:'result',result:any,output:string|null}|{kind:'error',message:string,line?:number}>}
 */
async function executeSandbox(inst, phpFile, method, query, body, headers = {}) {
  const php = await resolvePhp();
  if (!php) {
    return { kind: 'error', message: '服务器未配置 PHP 运行环境（实例自定义 PHP 后端不可用）' };
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tag = crypto.randomBytes(8).toString('hex');
  const codeFile = path.join(TMP_DIR, `code_${tag}.php`);
  const envFile = path.join(TMP_DIR, `env_${tag}.json`);

  fs.writeFileSync(codeFile, phpFile.content ?? '', 'utf8');
  fs.writeFileSync(envFile, JSON.stringify({
    db_path: path.join(ROOT, 'data', 'cses.db'),
    instance: { id: inst.id, instance_uid: inst.instance_uid, name: inst.name, school_id: inst.school_id },
    method,
    query: query || {},
    body: body ?? null,
    headers,
    code_file: codeFile,
  }), 'utf8');

  const args = [];
  if (php.extDir) args.push('-d', `extension_dir=${php.extDir}`);
  args.push(getWrapperFile(), envFile);

  return new Promise((resolve) => {
    execFile(php.bin, args, { timeout: 20000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      // 清理临时文件
      try { fs.unlinkSync(codeFile); } catch (_) {}
      try { fs.unlinkSync(envFile); } catch (_) {}

      const out = String(stdout || '');
      const marker = out.lastIndexOf('__SANDBOX_RESULT__');
      if (marker < 0) {
        // response()/responseError() 会直接 exit —— 信封在 marker 之前输出且无 marker
        const headTrim = out.trim();
        if (headTrim.startsWith('{') && headTrim.includes('__sandbox_response')) {
          try {
            const r = JSON.parse(headTrim);
            resolve({ kind: 'response', http: r.__http || 200, body: r.__sandbox_response });
            return;
          } catch (_) {}
        }
        resolve({
          kind: 'error',
          message: 'PHP 执行错误: ' + ((stderr || err?.message || '无输出') + '').split('\n').filter(Boolean).pop(),
        });
        return;
      }
      const head = out.slice(0, marker).replace(/^\s*[\r\n]+/, '');
      let envelope = null;
      try {
        envelope = JSON.parse(out.slice(marker + '__SANDBOX_RESULT__'.length).trim());
      } catch (_) {
        resolve({ kind: 'error', message: '沙箱输出解析失败' });
        return;
      }
      if (envelope.error) {
        resolve({ kind: 'error', message: envelope.error.message, line: envelope.error.line });
        return;
      }
      if (head.includes('__sandbox_response') ) {
        // response() 直接输出的信封（无标记前缀时也兼容）
      }
      // response()/responseError() 直接 exit，未经 marker 封装
      if (envelope.result && typeof envelope.result === 'object' && '__sandbox_response' in envelope.result) {
        const r = envelope.result;
        resolve({ kind: 'response', http: r.__http || 200, body: r.__sandbox_response });
        return;
      }
      // head 本身就是 response() 的信封 JSON
      const headTrim = head.trim();
      if (headTrim.startsWith('{') && headTrim.includes('__sandbox_response')) {
        try {
          const r = JSON.parse(headTrim);
          resolve({ kind: 'response', http: r.__http || 200, body: r.__sandbox_response });
          return;
        } catch (_) {}
      }
      resolve({ kind: 'result', result: envelope.result ?? null, output: envelope.output ?? null });
    });
  });
}

module.exports = { executeSandbox };
