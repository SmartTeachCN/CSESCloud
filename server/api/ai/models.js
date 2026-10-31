/**
 * AI 自定义模型管理 API（移植自旧实现）
 *
 *  GET  action=list              列出当前用户的模型（每项附 capabilities）
 *  GET  action=presets           内置模型预设（DeepSeek 优先，供前端模型选择框使用）
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

// ────────────────────────────── 模型能力 / 推理等级 ──────────────────────────────

/** 推理等级取值（与 spec §5、agent.js reasoningParams 一致） */
const REASONING_LEVELS = ['auto', 'off', 'low', 'medium', 'high', 'max'];

/** 推理等级中文标签（供预设给前端展示用） */
const REASONING_LABELS = {
  auto: '自动', off: '关闭', low: '低', medium: '中', high: '高', max: '最高',
};

/**
 * 按 provider / model_id 推断模型能力。
 * 与 agent.js#reasoningSupported 语义保持一致：能力为 true 时推理等级才真正生效。
 * @returns {{thinking:boolean, reasoning_effort:boolean}}
 */
function inferCapabilities(provider, modelId) {
  const p = String(provider || '').toLowerCase();
  const mid = String(modelId || '');
  const isDeepSeek = p === 'deepseek' || /deepseek/i.test(mid);
  const isOpenAIReasoning = /^(o1|o3|o4|gpt-5)/i.test(mid);
  const isAnthropic = p === 'anthropic';
  const isGoogleThinking = p === 'google' && /gemini-(2\.5|3)/i.test(mid);
  return {
    // thinking = 模型具备思维链；reasoning_effort = 支持 reasoning_effort 档位参数
    thinking: isDeepSeek || isOpenAIReasoning || isAnthropic || isGoogleThinking,
    reasoning_effort: isDeepSeek || isOpenAIReasoning,
  };
}

/** 能力 → 可选的推理等级列表（不支持推理能力时只给 auto） */
function levelsOf(capabilities) {
  if (capabilities && (capabilities.thinking || capabilities.reasoning_effort)) {
    return REASONING_LEVELS.slice();
  }
  return ['auto'];
}

/** 规范化推理等级：合法值返回小写值，空值返回 ''，非法返回 null */
function normalizeReasoning(value) {
  const v = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (v === '') return '';
  return REASONING_LEVELS.indexOf(v) >= 0 ? v : null;
}

/** 给模型行补 capabilities（列表接口用） */
function withCapabilities(model) {
  const capabilities = inferCapabilities(model.provider, model.model_id || model.name);
  return Object.assign({}, model, {
    capabilities: capabilities,
    levels: levelsOf(capabilities),
    default_level: model.default_reasoning || model.reasoning || 'auto',
  });
}

/**
 * 内置模型预设（DeepSeek 优先）。
 * 形如 spec §5：[{ key, label, provider, model_id, levels, default }]
 */
function builtinPresets() {
  const items = [
    { key: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', model_id: 'deepseek-chat' },
    { key: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', model_id: 'deepseek-reasoner' },
    { key: 'gpt-4o', label: 'GPT-4o', provider: 'openai', model_id: 'gpt-4o' },
    { key: 'o3', label: 'OpenAI o3', provider: 'openai', model_id: 'o3' },
    { key: 'claude-sonnet-4', label: 'Claude Sonnet 4', provider: 'anthropic', model_id: 'claude-sonnet-4-20250514' },
    { key: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', model_id: 'gemini-2.5-pro' },
  ];
  return items.map((item) => {
    const capabilities = inferCapabilities(item.provider, item.model_id);
    const levels = levelsOf(capabilities);
    return {
      key: item.key,
      label: item.label,
      provider: item.provider,
      model_id: item.model_id,
      levels: levels,
      default: 'auto',
      capabilities: capabilities,
      level_labels: levels.map((lv) => ({ value: lv, label: REASONING_LABELS[lv] || lv })),
    };
  });
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

  // v4：推理等级持久化字段（schema 由 Lead 维护，这里对旧库兜底补列）
  DB.addMissingColumn('ai_models', 'reasoning', 'TEXT');
  DB.addMissingColumn('ai_models', 'default_reasoning', 'TEXT');

  // 内置模型预设（DeepSeek 优先；供前端模型选择框使用）
  // v4.1：额外返回 configured —— 平台是否真的配置了对应模型（有可用 API Key）。
  // 前端据此隐藏「未配置」的预设分组，避免用户选了一个必然回落到规则引擎的模型。
  if (method === 'GET' && action === 'presets') {
    const configuredKeys = new Set();
    try {
      const rows = DB.all(
        "SELECT name, model_id, api_key FROM ai_models WHERE (owner_key = ? OR owner_key = 'system') AND is_enabled = 1",
        [ownerKey]
      );
      for (const r of rows) {
        if (String(r.api_key || '').trim() === '') continue;
        if (r.name) configuredKeys.add(String(r.name).trim().toLowerCase());
        if (r.model_id) configuredKeys.add(String(r.model_id).trim().toLowerCase());
      }
    } catch (_) { /* 模型表缺失时视为未配置 */ }

    const envKeys = {
      deepseek: !!(process.env.DEEPSEEK_API_KEY || '').trim(),
      openai: !!(process.env.OPENAI_API_KEY || '').trim(),
      anthropic: !!(process.env.ANTHROPIC_API_KEY || '').trim(),
      google: !!(process.env.GOOGLE_API_KEY || '').trim(),
    };

    const list = builtinPresets().map((preset) => {
      const provider = String(preset.provider || '').toLowerCase();
      const configured = configuredKeys.has(String(preset.key || '').toLowerCase())
        || configuredKeys.has(String(preset.model_id || '').toLowerCase())
        || !!envKeys[provider];
      return { ...preset, configured };
    });
    Response.success(list);
  }

  // 列出模型
  if (method === 'GET' && action === 'list') {
    // 同时返回用户模型和系统模型
    const models = DB.all("SELECT * FROM ai_models WHERE owner_key = ? OR owner_key = 'system' ORDER BY owner_key DESC, id ASC", [ownerKey]);
    // 安全：不向前端返回明文 API Key（编辑表单 api_key 留空、仅在用户填写时提交），
    // 只提供 masked 展示值与 has_api_key 状态；系统模型的明文 key 由 admin/manage 另一套接口管理。
    for (const m of models) {
      const rawApiKey = String(m.api_key === undefined || m.api_key === null ? '' : m.api_key);
      delete m.api_key;
      m.has_api_key = rawApiKey !== '';
      if (rawApiKey !== '') {
        m.api_key_masked = rawApiKey.length > 8
          ? rawApiKey.slice(0, 4) + '****' + rawApiKey.slice(-4)
          : '****';
      }
      Object.assign(m, withCapabilities(m));
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

    // v4：推理等级（可选）
    const reasoning = normalizeReasoning(body.reasoning);
    const defaultReasoning = body.default_reasoning !== undefined
      ? normalizeReasoning(body.default_reasoning)
      : reasoning;
    if (reasoning === null || defaultReasoning === null) {
      Response.error('推理等级不合法，可选值：' + REASONING_LEVELS.join(' / '));
    }

    const now = nowStr();
    const id = DB.insert('ai_models', {
      owner_key: ownerKey,
      name: name,
      provider: provider,
      endpoint: endpoint,
      api_key: apiKey,
      model_id: modelId,
      is_enabled: 1,
      reasoning: reasoning || null,
      default_reasoning: defaultReasoning || reasoning || null,
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
    // v4：推理等级（空串表示清空）
    if ('reasoning' in body) {
      const reasoning = normalizeReasoning(body.reasoning);
      if (reasoning === null) Response.error('推理等级不合法，可选值：' + REASONING_LEVELS.join(' / '));
      data.reasoning = reasoning || null;
    }
    if ('default_reasoning' in body) {
      const defaultReasoning = normalizeReasoning(body.default_reasoning);
      if (defaultReasoning === null) Response.error('推理等级不合法，可选值：' + REASONING_LEVELS.join(' / '));
      data.default_reasoning = defaultReasoning || null;
    }
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
