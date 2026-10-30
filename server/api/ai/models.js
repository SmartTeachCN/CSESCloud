/**
 * AI 自定义模型管理 API（移植自旧实现）
 *
 *  GET  action=list              列出当前用户的模型
 *  POST action=create            创建模型
 *  POST action=update            更新模型
 *  POST action=delete            删除模型
 *  POST action=test              测试模型连接
 */
const { nowStr } = require('../../lib/response');

/** PHP json_decode(s, true) 等价：失败返回 null */
function jsonDecodeSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

/** PHP empty() 等价（供文件级辅助函数使用，语义与 Helpers.empty 一致） */
function phpEmpty(v) {
  return v === undefined || v === null || v === '' || v === 0 || v === false
    || v === '0' || (Array.isArray(v) && v.length === 0);
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();

  const method = req.method;
  const action = query.action ?? '';
  const ownerKey = Auth.ownerKey();

  // 确保表存在
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_models (
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
)`);

  // 列出模型
  if (method === 'GET' && action === 'list') {
    // 同时返回用户模型和系统模型
    const models = DB.all("SELECT * FROM ai_models WHERE owner_key = ? OR owner_key = 'system' ORDER BY owner_key DESC, id ASC", [ownerKey]);
    // 隐藏 API Key 完整值
    for (const m of models) {
      if (!Helpers.empty(m.api_key)) {
        const len = m.api_key.length;
        m.api_key_masked = len > 8 ? m.api_key.slice(0, 4) + '****' + m.api_key.slice(-4) : '****';
      }
    }
    Response.success(models);
  }

  // 创建模型
  if (method === 'POST' && action === 'create') {
    const name = String(body.name ?? '').trim();
    const provider = String(body.provider ?? '').trim();
    const endpoint = String(body.endpoint ?? '').trim();
    const apiKey = String(body.api_key ?? '').trim();
    const modelId = String(body.model_id ?? '').trim();

    if (Helpers.empty(name)) Response.error('模型名称不能为空');
    if (Helpers.empty(provider)) Response.error('模型提供商不能为空');

    const now = nowStr();
    const id = DB.insert('ai_models', {
      owner_key: ownerKey,
      name: name,
      provider: provider,
      endpoint: endpoint,
      api_key: apiKey,
      model_id: modelId,
      is_enabled: 1,
      created_at: now,
      updated_at: now,
    });
    Response.success({ id: id, name: name });
  }

  // 更新模型
  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少模型 ID');

    const model = DB.one('SELECT * FROM ai_models WHERE id = ? AND owner_key = ?', [id, ownerKey]);
    if (!model) Response.error('模型不存在或无权限', 403, 403);

    const data = {};
    if ('name' in body) data.name = String(body.name).trim();
    if ('provider' in body) data.provider = String(body.provider).trim();
    if ('endpoint' in body) data.endpoint = String(body.endpoint).trim();
    if ('api_key' in body) data.api_key = String(body.api_key).trim();
    if ('model_id' in body) data.model_id = String(body.model_id).trim();
    if ('is_enabled' in body) data.is_enabled = body.is_enabled ? 1 : 0; // PHP (int)bool 语义
    data.updated_at = nowStr();

    if (!Helpers.empty(data)) {
      DB.update('ai_models', data, 'id = ?', [id]);
    }
    Response.success({ updated: true });
  }

  // 删除模型
  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少模型 ID');

    const model = DB.one('SELECT * FROM ai_models WHERE id = ? AND owner_key = ?', [id, ownerKey]);
    if (!model) Response.error('模型不存在或无权限', 403, 403);

    DB.delete('ai_models', 'id = ?', [id]);
    Response.success({ deleted: true });
  }

  // 测试模型连接
  if (method === 'POST' && action === 'test') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少模型 ID');

    const model = DB.one('SELECT * FROM ai_models WHERE id = ? AND owner_key = ?', [id, ownerKey]);
    if (!model) Response.error('模型不存在或无权限', 403, 403);

    const result = await testModelConnection(model);
    Response.success(result);
  }

  Response.error('未知的操作', 405, 405);
};

/**
 * 测试模型连接
 */
async function testModelConnection(model) {
  const provider = model.provider;
  const endpoint = model.endpoint;
  const apiKey = model.api_key;
  const modelId = model.model_id;

  if (phpEmpty(apiKey)) {
    return { ok: false, error: 'API Key 未设置' };
  }

  try {
    switch (provider) {
      case 'openai':
      case 'openai_compatible':
      case 'deepseek': {
        const url = !phpEmpty(endpoint)
          ? endpoint
          : (provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');
        const resp = await httpPost(url, {
          model: !phpEmpty(modelId) ? modelId : 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }, [
          'Authorization: Bearer ' + apiKey,
          'Content-Type: application/json',
        ]);
        const json = jsonDecodeSafe(resp);
        if (json && json.error != null) { // PHP isset($json['error'])
          return { ok: false, error: json.error.message ?? '未知错误' };
        }
        return { ok: true, message: '连接成功' };
      }
      case 'anthropic': {
        const url = !phpEmpty(endpoint) ? endpoint : 'https://api.anthropic.com/v1/messages';
        const resp = await httpPost(url, {
          model: !phpEmpty(modelId) ? modelId : 'claude-3-sonnet-20240229',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }],
        }, [
          'x-api-key: ' + apiKey,
          'anthropic-version: 2023-06-01',
          'Content-Type: application/json',
        ]);
        const json = jsonDecodeSafe(resp);
        if (json && json.error != null) {
          return { ok: false, error: json.error.message ?? '未知错误' };
        }
        return { ok: true, message: '连接成功' };
      }
      case 'google': {
        const url = !phpEmpty(endpoint)
          ? endpoint
          : 'https://generativelanguage.googleapis.com/v1beta/models/' + (!phpEmpty(modelId) ? modelId : 'gemini-pro') + ':generateContent?key=' + apiKey;
        const resp = await httpPost(url, {
          contents: [{ parts: [{ text: 'Hi' }] }],
        }, ['Content-Type: application/json']);
        const json = jsonDecodeSafe(resp);
        if (json && json.error != null) {
          return { ok: false, error: json.error.message ?? '未知错误' };
        }
        return { ok: true, message: '连接成功' };
      }
      default:
        return { ok: false, error: '不支持的提供商: ' + provider };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 发送 HTTP POST 请求
 */
async function httpPost(url, data, headers = []) {
  const headerObj = {};
  for (const h of headers) {
    const idx = h.indexOf(':');
    if (idx > 0) headerObj[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }
  let resp;
  try {
    // PHP: timeout=30 + ignore_errors=true（HTTP 非 2xx 不抛错，仅返回响应体）
    resp = await fetch(url, {
      method: 'POST',
      headers: headerObj,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    // 对齐 PHP: file_get_contents 失败时 throw new Exception('请求失败：无法连接到 ' . $url)
    throw new Error('请求失败：无法连接到 ' + url);
  }
  return resp.text();
}
