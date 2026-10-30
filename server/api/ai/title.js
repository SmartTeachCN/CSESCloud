/**
 * CSES Cloud —— AI 会话自动标题（v4）。
 *
 * 契约见 docs/AI-assistant-v4-spec.md（需求 2「AI 自动生成会话标题」，title.js）。
 *
 * 导出：
 *   - deriveTitle(text) → string
 *       规则兜底：去掉「[编辑器上下文]...」片段，压缩空白，截断 24 字。
 *       任何情况下都返回非空字符串（最差为「新对话」）。
 *   - async generateTitle({ modelRow, userText, assistantText, request }) → Promise<string>
 *       让模型生成 ≤ 16 字中文标题；失败 / 无 key / 超时 → 回退 deriveTitle。
 *       - request: 调用方注入的补全函数（chat.js 注入 Agent.completeText 包装），
 *         形如 async (messages: Array<{role,content}> | {messages,...}) => string。
 *       - 未注入 request 时自行用 fetch 请求上游，强制 8s 超时。
 *       - 永不抛异常。
 *
 * 设计要点：本模块不依赖数据库、不依赖 HTTP 框架，便于被 chat.js / agent.js 直接复用。
 */
'use strict';

// ────────────────────────────── 常量 ──────────────────────────────

/** 模型生成标题的字数上限（spec：≤ 16 字） */
const TITLE_MAX_CHARS = 16;
/** 规则兜底标题的字数上限（spec：截断 24 字） */
const FALLBACK_MAX_CHARS = 24;
/** 自建请求的超时（毫秒）：8 秒 */
const REQUEST_TIMEOUT_MS = 8000;
/** 默认标题 */
const DEFAULT_TITLE = '新对话';

const EDITOR_CONTEXT_MARK = '[编辑器上下文]';
const USER_QUESTION_MARK = '[用户问题]';

// ────────────────────────────── 文本清理 ──────────────────────────────

/** 按码点截断 */
function clipChars(text, max) {
  return Array.from(String(text === undefined || text === null ? '' : text)).slice(0, max).join('');
}

/**
 * 去掉客户端塞进消息里的「[编辑器上下文]...」片段。
 * 有「[用户问题]」标记时取其后内容；否则整段删除。
 */
function stripEditorContext(text) {
  let s = String(text === undefined || text === null ? '' : text);
  if (s.indexOf(EDITOR_CONTEXT_MARK) === -1) return s;

  const questionIdx = s.indexOf(USER_QUESTION_MARK);
  if (questionIdx >= 0) {
    s = s.slice(questionIdx + USER_QUESTION_MARK.length);
  } else {
    // 没有 [用户问题] 标记：截掉 [编辑器上下文] 之后的内容（通常是文件内容，不适合做标题）
    s = s.slice(0, s.indexOf(EDITOR_CONTEXT_MARK));
  }
  return s;
}

/** 通用文本清理：去代码块、Markdown 符号、压缩空白 */
function cleanPlainText(text) {
  let s = String(text === undefined || text === null ? '' : text);
  s = s.replace(/```[\s\S]*?```/g, ' '); // 围栏代码块
  s = s.replace(/~~~[\s\S]*?~~~/g, ' ');
  s = s.replace(/`[^`\n]*`/g, ' '); // 行内代码
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 图片
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 链接保留文字
  s = s.replace(/\[编辑器上下文\]/g, ' '); // 残留标记
  s = s.replace(/\[用户问题\]/g, ' ');
  s = s.replace(/[#>*_~\-+|[\]]+/g, ' '); // Markdown 标记（含方括号）
  s = s.replace(/\s+/g, ' '); // 换行 / 连续空白
  return s.trim();
}

/** 去掉标题首尾的引号、括号、标点与「标题：」之类前缀 */
function trimTitleDecorations(text) {
  let s = String(text === undefined || text === null ? '' : text).trim();
  s = s.replace(/^(会话标题|对话标题|标题|title)\s*[:：]\s*/i, '');
  s = s.replace(/^["'`“”‘’「」『』（(【\[]+/, '');
  s = s.replace(/["'`“”‘’「」『』）)】\]]+$/, '');
  // 首尾标点（中英文）
  s = s.replace(/^[\s,，.。:：;；!！?？、…·~～]+/, '');
  s = s.replace(/[\s,，.。:：;；!！?？、…·~～]+$/, '');
  return s.trim();
}

// ────────────────────────────── 规则兜底标题 ──────────────────────────────

/**
 * 规则兜底：从用户消息里提取一个标题。
 * - 去掉「[编辑器上下文]...」片段
 * - 去掉代码块 / Markdown / 多余空白
 * - 截断 24 字
 *
 * @param {string} text 用户消息（可含编辑器上下文）
 * @returns {string} 非空标题
 */
function deriveTitle(text) {
  const stripped = stripEditorContext(text);
  let title = cleanPlainText(stripped);
  title = trimTitleDecorations(title);
  // 若去掉标记后为空（例如用户只发了编辑器上下文），回退到去掉标记后的原文
  if (!title) {
    title = trimTitleDecorations(cleanPlainText(String(text).split(EDITOR_CONTEXT_MARK).join(' ')));
  }
  title = clipChars(title, FALLBACK_MAX_CHARS).trim();
  return title || DEFAULT_TITLE;
}

// ────────────────────────────── 模型生成标题 ──────────────────────────────

/** 去掉代码块并压缩空白，用于喂给模型的对话摘要 */
function promptText(text, maxChars) {
  const s = cleanPlainText(stripEditorContext(text));
  return clipChars(s, maxChars);
}

/** 构造标题生成提示词 */
function buildPrompt(userText, assistantText) {
  const user = promptText(userText, 600);
  const assistant = promptText(assistantText, 400);
  const lines = [
    '请根据下面的对话内容，生成一个简洁的中文会话标题。',
    '要求：不超过 16 个汉字；只输出标题本身，不要引号、句号、序号或任何解释。',
    '',
  ];
  if (user) lines.push('用户：' + user);
  if (assistant) lines.push('助理：' + assistant);
  return lines.join('\n');
}

/** 标题合法性收尾：单行、去装饰、限长 */
function sanitizeTitle(raw) {
  if (raw === undefined || raw === null) return '';
  let s = String(raw);
  // 只取第一行有效内容
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  s = lines[0];
  s = s.replace(/```/g, ' ');
  s = trimTitleDecorations(cleanPlainText(s));
  s = clipChars(s, TITLE_MAX_CHARS).trim();
  if (!s) return '';
  // 明显是解释/道歉而不是标题时，判定为失败
  if (/^(抱歉|无法|对不起|cannot|sorry)/i.test(s)) return '';
  return s;
}

/** Promise 超时包装（注入的 request 无法中止，只能竞速） */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('标题生成超时')), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** 从任意响应中尽力抽取文本内容 */
function extractText(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    // OpenAI 兼容
    const choice = (raw.choices || [])[0];
    if (choice && choice.message && choice.message.content !== undefined) {
      return String(choice.message.content);
    }
    // Anthropic
    if (Array.isArray(raw.content) && raw.content[0] && raw.content[0].text !== undefined) {
      return String(raw.content[0].text);
    }
    // Google
    const cand = (raw.candidates || [])[0];
    if (cand && cand.content && Array.isArray(cand.content.parts) && cand.content.parts[0]) {
      return String(cand.content.parts[0].text ?? '');
    }
    if (raw.text !== undefined) return String(raw.text);
  }
  return '';
}

/** 从上游响应体里解析标题文本（JSON 或纯文本） */
function extractFromResponseBody(bodyText) {
  const text = String(bodyText === undefined || bodyText === null ? '' : bodyText).trim();
  if (!text) return '';
  if (text.startsWith('{') || text.startsWith('[')) {
    try { return extractText(JSON.parse(text)); } catch (_) { return ''; }
  }
  return text;
}

/** 该 provider 是否可用内置默认端点 */
function defaultEndpointOf(provider, modelId, apiKey) {
  const p = String(provider || '').toLowerCase();
  if (p === 'deepseek') return 'https://api.deepseek.com/v1/chat/completions';
  if (p === 'openai' || p === 'openai_compatible') return 'https://api.openai.com/v1/chat/completions';
  if (p === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  if (p === 'google') {
    return 'https://generativelanguage.googleapis.com/v1beta/models/'
      + encodeURIComponent(String(modelId || 'gemini-pro'))
      + ':generateContent?key=' + encodeURIComponent(String(apiKey || ''));
  }
  return '';
}

/**
 * 自行请求上游补全（未注入 request 时使用）。永不抛异常，失败返回 ''。
 * @returns {Promise<string>} 模型原始输出文本
 */
async function requestCompletion(modelRow, messages) {
  try {
    const provider = String(modelRow.provider || '').toLowerCase();
    const modelId = String(modelRow.model_id || modelRow.name || '');
    const apiKey = String(modelRow.api_key || '');
    if (!apiKey) return '';

    const url = String(modelRow.endpoint || '').trim() || defaultEndpointOf(provider, modelId, apiKey);
    if (!url) return '';

    let headers = { 'Content-Type': 'application/json' };
    let body;

    if (provider === 'anthropic') {
      // Anthropic：system 单独传，messages 只保留 user/assistant
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const chat = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = { model: modelId, max_tokens: 64, messages: chat };
      if (system) body.system = system;
    } else if (provider === 'google') {
      const joined = messages.map((m) => (m.role === 'assistant' ? '助理：' : (m.role === 'system' ? '要求：' : '用户：')) + m.content).join('\n');
      body = { contents: [{ role: 'user', parts: [{ text: joined }] }] };
    } else if (provider === 'openai' || provider === 'openai_compatible' || provider === 'deepseek') {
      headers.Authorization = 'Bearer ' + apiKey;
      body = {
        model: modelId,
        messages: messages,
        max_tokens: 64,
        temperature: 0.3,
        stream: false,
      };
    } else {
      return '';
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    if (!resp.ok) return '';
    return extractFromResponseBody(text);
  } catch (_) {
    return '';
  }
}

/**
 * 用模型生成 ≤ 16 字的中文会话标题。
 *
 * @param {object} opts
 * @param {object} [opts.modelRow]        模型行（provider / endpoint / api_key / model_id）
 * @param {string} [opts.userText]        用户消息（可含「[编辑器上下文]」）
 * @param {string} [opts.assistantText]   助手回复
 * @param {(payload:any)=>Promise<string>} [opts.request] 注入的补全函数
 * @param {object} [opts.session]          会话行（保留参数，用于调用方透传）
 * @param {boolean} [opts.force]           是否强制生成（保留参数）
 * @returns {Promise<string>} 非空标题（最差为 deriveTitle 的结果）
 */
async function generateTitle(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const userText = options.userText;
  const assistantText = options.assistantText;
  // 兜底优先用用户消息；用户消息为空（例如只发了编辑器上下文）时用助手回复
  const fallback = (String(userText || '').trim() ? deriveTitle(userText) : '')
    || (String(assistantText || '').trim() ? deriveTitle(assistantText) : '')
    || DEFAULT_TITLE;

  try {
    const modelRow = options.modelRow;
    if (!modelRow || !modelRow.provider) return fallback;

    const messages = [
      {
        role: 'system',
        content: '你是会话标题生成助手。只输出一个简短的中文标题，不要任何解释、标点或引号。',
      },
      { role: 'user', content: buildPrompt(userText, assistantText) },
    ];

    let raw;
    if (typeof options.request === 'function') {
      // 注入的 request：再套一层超时兜底（调用方自身可能没有超时）
      raw = await withTimeout(options.request(messages), REQUEST_TIMEOUT_MS + 4000);
    } else {
      raw = await requestCompletion(modelRow, messages);
    }

    const title = sanitizeTitle(extractText(raw) || (typeof raw === 'string' ? raw : ''));
    return title || fallback;
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  deriveTitle,
  generateTitle,
  // 便利导出（非契约必需）：便于测试与调用方复用清理逻辑
  stripEditorContext,
  sanitizeTitle,
  TITLE_MAX_CHARS,
  FALLBACK_MAX_CHARS,
};
