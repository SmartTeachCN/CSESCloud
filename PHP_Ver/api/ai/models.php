<?php
/**
 * AI 自定义模型管理 API
 *
 *  GET  action=list              列出当前用户的模型
 *  POST action=create            创建模型
 *  POST action=update            更新模型
 *  POST action=delete            删除模型
 *  POST action=test              测试模型连接
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireLogin();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();
$ownerKey = Auth::ownerKey();

// 确保表存在
DB::pdo()->exec("CREATE TABLE IF NOT EXISTS ai_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    endpoint TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)");

// 列出模型
if ($method === 'GET' && $action === 'list') {
    // 同时返回用户模型和系统模型
    $models = DB::all("SELECT * FROM ai_models WHERE owner_key = ? OR owner_key = 'system' ORDER BY owner_key DESC, id ASC", [$ownerKey]);
    // 隐藏 API Key 完整值
    foreach ($models as &$m) {
        if (!empty($m['api_key'])) {
            $len = strlen($m['api_key']);
            $m['api_key_masked'] = $len > 8 ? substr($m['api_key'], 0, 4) . '****' . substr($m['api_key'], -4) : '****';
        }
    }
    Response::success($models);
}

// 创建模型
if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    $provider = trim($body['provider'] ?? '');
    $endpoint = trim($body['endpoint'] ?? '');
    $apiKey = trim($body['api_key'] ?? '');
    $modelId = trim($body['model_id'] ?? '');

    if (empty($name)) Response::error('模型名称不能为空');
    if (empty($provider)) Response::error('模型提供商不能为空');

    $now = date('Y-m-d H:i:s');
    $id = DB::insert('ai_models', [
        'owner_key' => $ownerKey,
        'name' => $name,
        'provider' => $provider,
        'endpoint' => $endpoint,
        'api_key' => $apiKey,
        'model_id' => $modelId,
        'is_enabled' => 1,
        'created_at' => $now,
        'updated_at' => $now,
    ]);
    Response::success(['id' => $id, 'name' => $name]);
}

// 更新模型
if ($method === 'POST' && $action === 'update') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少模型 ID');

    $model = DB::one("SELECT * FROM ai_models WHERE id = ? AND owner_key = ?", [$id, $ownerKey]);
    if (!$model) Response::error('模型不存在或无权限', 403, 403);

    $data = [];
    if (isset($body['name'])) $data['name'] = trim($body['name']);
    if (isset($body['provider'])) $data['provider'] = trim($body['provider']);
    if (isset($body['endpoint'])) $data['endpoint'] = trim($body['endpoint']);
    if (isset($body['api_key'])) $data['api_key'] = trim($body['api_key']);
    if (isset($body['model_id'])) $data['model_id'] = trim($body['model_id']);
    if (isset($body['is_enabled'])) $data['is_enabled'] = (int)$body['is_enabled'];
    $data['updated_at'] = date('Y-m-d H:i:s');

    if (!empty($data)) {
        DB::update('ai_models', $data, 'id = ?', [$id]);
    }
    Response::success(['updated' => true]);
}

// 删除模型
if ($method === 'POST' && $action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少模型 ID');

    $model = DB::one("SELECT * FROM ai_models WHERE id = ? AND owner_key = ?", [$id, $ownerKey]);
    if (!$model) Response::error('模型不存在或无权限', 403, 403);

    DB::delete('ai_models', 'id = ?', [$id]);
    Response::success(['deleted' => true]);
}

// 测试模型连接
if ($method === 'POST' && $action === 'test') {
    $id = (int)($body['id'] ?? 0);
    if (!$id) Response::error('缺少模型 ID');

    $model = DB::one("SELECT * FROM ai_models WHERE id = ? AND owner_key = ?", [$id, $ownerKey]);
    if (!$model) Response::error('模型不存在或无权限', 403, 403);

    $result = testModelConnection($model);
    Response::success($result);
}

Response::error('未知的操作', 405, 405);

/**
 * 测试模型连接
 */
function testModelConnection($model)
{
    $provider = $model['provider'];
    $endpoint = $model['endpoint'];
    $apiKey = $model['api_key'];
    $modelId = $model['model_id'];

    if (empty($apiKey)) {
        return ['ok' => false, 'error' => 'API Key 未设置'];
    }

    try {
        switch ($provider) {
            case 'openai':
            case 'openai_compatible':
            case 'deepseek':
                $url = $endpoint ?: ($provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');
                $resp = httpPost($url, [
                    'model' => $modelId ?: 'gpt-4o-mini',
                    'messages' => [['role' => 'user', 'content' => 'Hi']],
                    'max_tokens' => 5
                ], [
                    'Authorization: Bearer ' . $apiKey,
                    'Content-Type: application/json'
                ]);
                $json = json_decode($resp, true);
                if (isset($json['error'])) {
                    return ['ok' => false, 'error' => $json['error']['message'] ?? '未知错误'];
                }
                return ['ok' => true, 'message' => '连接成功'];
            case 'anthropic':
                $url = $endpoint ?: 'https://api.anthropic.com/v1/messages';
                $resp = httpPost($url, [
                    'model' => $modelId ?: 'claude-3-sonnet-20240229',
                    'max_tokens' => 5,
                    'messages' => [['role' => 'user', 'content' => 'Hi']]
                ], [
                    'x-api-key: ' . $apiKey,
                    'anthropic-version: 2023-06-01',
                    'Content-Type: application/json'
                ]);
                $json = json_decode($resp, true);
                if (isset($json['error'])) {
                    return ['ok' => false, 'error' => $json['error']['message'] ?? '未知错误'];
                }
                return ['ok' => true, 'message' => '连接成功'];
            case 'google':
                $url = $endpoint ?: "https://generativelanguage.googleapis.com/v1beta/models/" . ($modelId ?: 'gemini-pro') . ":generateContent?key=" . $apiKey;
                $resp = httpPost($url, [
                    'contents' => [['parts' => [['text' => 'Hi']]]]
                ], ['Content-Type: application/json']);
                $json = json_decode($resp, true);
                if (isset($json['error'])) {
                    return ['ok' => false, 'error' => $json['error']['message'] ?? '未知错误'];
                }
                return ['ok' => true, 'message' => '连接成功'];
            default:
                return ['ok' => false, 'error' => '不支持的提供商: ' . $provider];
        }
    } catch (Exception $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/**
 * 发送 HTTP POST 请求
 */
function httpPost($url, $data, $headers = [])
{
    $options = [
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers) . "\r\n",
            'content' => json_encode($data),
            'timeout' => 30,
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ];
    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);
    if ($response === false) {
        throw new Exception('请求失败：无法连接到 ' . $url);
    }
    return $response;
}