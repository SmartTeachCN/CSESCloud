/**
 * AI 助理 API（V4）
 *
 *  会话
 *   GET  action=sessions            列出当前用户的会话（置顶优先）
 *   GET  action=messages            列出会话消息（含 meta 展示块）
 *   POST action=send                发送消息（非流式，兼容旧调用方）
 *   POST action=stream              发送消息并逐 token 流式返回（SSE，Agent + 工具）
 *   POST action=resume              客户端工具/提问执行完后续跑（SSE）
 *   POST action=rename              重命名会话
 *   POST action=pin                 置顶 / 取消置顶
 *   POST action=generate-title      重新生成标题
 *   POST action=clear               清空会话消息
 *   POST action=delete              删除会话
 *   POST action=upload-shot         上传编辑器截图（客户端工具结果）
 *   GET  action=shot&id=            读取截图（校验归属）
 *
 * 流式协议见 docs/AI-assistant-v4-spec.md
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const DB = require('../../lib/db');
const { nowStr, HttpSent } = require('../../lib/response');
const Agent = require('./agent');
const Runs = require('./runs');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHOTS_DIR = path.join(ROOT, 'data', 'ai-shots');
const MAX_SHOT_BYTES = 6 * 1024 * 1024;

/** PHP empty() 等价 */
function phpEmpty(v) {
  return v === undefined || v === null || v === '' || v === 0 || v === false
    || v === '0' || (Array.isArray(v) && v.length === 0);
}

function jsonParseSafe(s, def = null) {
  try { return JSON.parse(s); } catch (_) { return def; }
}

/**
 * 用户消息里可能被客户端拼进「[编辑器上下文]」片段（当前文件 / 云文件路径 / 整个文件内容）。
 * 这段内容是给模型看的上下文，**不应该出现在聊天气泡里**，也不该以用户消息形式入库。
 * 这里统一剥出真正的用户问题。
 */
function cleanUserText(content) {
  const raw = String(content ?? '');
  const m = /\[用户问题\]\s*\n?([\s\S]*)$/.exec(raw);
  if (m) return m[1].trim();
  // 老版本消息没有 [用户问题] 标记：整段都是编辑器上下文 → 正文里不展示
  if (/^\s*\[编辑器上下文\]/.test(raw)) return '';
  return raw.trim();
}

function ownerHash(ownerKey) {
  return crypto.createHash('sha1').update(String(ownerKey || '')).digest('hex').slice(0, 16);
}

/**
 * 从请求推导站点 base URL（用于给用户生成可点开的完整链接）。
 * 支持反向代理的 X-Forwarded-* 头；拿不到时返回空串（退化为相对路径）。
 */
function requestBaseUrl(req) {
  try {
    const proto = String((req.headers['x-forwarded-proto'] || '') || (req.secure ? 'https' : 'http'))
      .split(',')[0].trim() || 'http';
    const host = String((req.headers['x-forwarded-host'] || '') || req.headers.host || '')
      .split(',')[0].trim();
    if (!host) return '';
    return proto + '://' + host;
  } catch (_) {
    return '';
  }
}

/** 确保 AI 相关表存在（老库升级兜底） */
function ensureAiTables() {
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        scope_ref INTEGER,
        title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_at TEXT,
        title_generated INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        reasoning TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
    )`);
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_pending_runs (
        id TEXT PRIMARY KEY,
        owner_key TEXT NOT NULL,
        session_id INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
  for (const [col, type] of [
    ['pinned', 'INTEGER NOT NULL DEFAULT 0'],
    ['pinned_at', 'TEXT'],
    ['title_generated', 'INTEGER NOT NULL DEFAULT 0'],
    ['model', 'TEXT'],
    ['reasoning', 'TEXT'],
  ]) {
    DB.addMissingColumn('ai_chat_sessions', col, type);
  }
  DB.addMissingColumn('ai_chat_messages', 'meta', 'TEXT');
  // v4.5：用户上传附件（文本抽取结果存 text，原文件落盘）
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        text TEXT,
        stored_path TEXT,
        truncated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )`);
  try { DB.pdo().exec('CREATE INDEX IF NOT EXISTS idx_ai_attachments_owner ON ai_attachments(owner_key)'); } catch (_) { /* ignore */ }
  // 懒清理：7 天前的附件记录（原文件一并清掉）
  try {
    const stale = DB.all("SELECT id, stored_path FROM ai_attachments WHERE created_at < datetime('now', '-7 days')");
    const AI = require('../../lib/ai-attachments');
    for (const row of stale) {
      if (row.stored_path) {
        try { fs.unlinkSync(path.join(AI.UPLOAD_DIR, row.stored_path)); } catch (_) { /* ignore */ }
      }
      DB.delete('ai_attachments', 'id = ?', [row.id]);
    }
  } catch (_) { /* ignore */ }
}

/** 取会话（校验归属） */
function getSession(sessionId, ownerKey) {
  if (!sessionId) return null;
  return DB.one('SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?', [sessionId, ownerKey]);
}

/** 创建会话 */
function createSession({ ownerKey, scope, scopeRef, title, model, reasoning }) {
  const now = nowStr();
  const id = Number(DB.insert('ai_chat_sessions', {
    owner_key: ownerKey,
    scope: scope || 'global',
    scope_ref: phpEmpty(scopeRef) ? null : scopeRef,
    title: title || '新对话',
    pinned: 0,
    title_generated: 0,
    model: model || null,
    reasoning: reasoning || null,
    created_at: now,
    updated_at: now,
  }));
  return getSession(id, ownerKey);
}

/** 保存一条消息，返回 id */
function saveMessage(sessionId, role, content, meta) {
  return Number(DB.insert('ai_chat_messages', {
    session_id: sessionId,
    role,
    content: content ?? '',
    meta: meta ? JSON.stringify(meta) : null,
    created_at: nowStr(),
  }));
}

/** 读取上下文窗口（最近 N 条，正序） */
function loadHistory(sessionId, limit = 20) {
  const rows = DB.all(
    'SELECT role, content, meta FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?',
    [sessionId, limit]
  ).reverse();
  return rows.map((r) => ({
    role: r.role,
    // 历史里的用户消息同样剥掉编辑器上下文，避免把旧文件内容反复喂给模型
    content: r.role === 'user' ? cleanUserText(r.content) : r.content,
    meta: jsonParseSafe(r.meta, null),
  })).filter((r) => r.role !== 'user' || String(r.content || '') !== '');
}

/**
 * 读取指定消息之前的上下文（正序），用于「重试」时把历史截断到那条用户消息之前。
 */
function loadHistoryBefore(sessionId, beforeMessageId, limit = 20) {
  const rows = DB.all(
    'SELECT role, content, meta FROM ai_chat_messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
    [sessionId, beforeMessageId, limit]
  ).reverse();
  return rows.map((r) => ({
    role: r.role,
    content: r.role === 'user' ? cleanUserText(r.content) : r.content,
    meta: jsonParseSafe(r.meta, null),
  })).filter((r) => r.role !== 'user' || String(r.content || '') !== '');
}

/**
 * 把一条 assistant 消息拍成「版本快照」（重试时可以切回旧版本）
 */
function variantOfMessage(msg) {
  if (!msg) return null;
  const meta = jsonParseSafe(msg.meta, null) || {};
  return {
    message_id: msg.id,
    content: String(msg.content || ''),
    blocks: Array.isArray(meta.blocks) ? meta.blocks : [],
    reasoning: String(meta.reasoning || ''),
    usage: meta.usage || null,
    model: String(meta.model || ''),
    reasoning_level: String(meta.reasoning_level || ''),
    created_at: String(msg.created_at || ''),
    interrupted: !!meta.interrupted,
  };
}

/**
 * 删除会话里从某条消息开始的全部消息（含或不含该条）
 * @returns {number} 删除条数
 */
function truncateMessagesFrom(sessionId, fromMessageId, inclusive = true) {
  const op = inclusive ? '>=' : '>';
  const info = DB.delete(
    'ai_chat_messages',
    'session_id = ? AND id ' + op + ' ?',
    [sessionId, fromMessageId]
  );
  DB.update('ai_chat_sessions', { updated_at: nowStr() }, 'id = ?', [sessionId]);
  Runs.removeBySession(sessionId);
  return Number((info && info.changes) || 0);
}

/** 生成标题（模型优先，规则兜底）；返回 { title, usedModel } */
async function makeTitle({ ownerKey, modelName, userText, assistantText, session, force }) {
  const titleMod = (() => {
    try { return require('./title'); } catch (_) { return null; }
  })();
  const model = Agent.resolveModel(ownerKey, modelName);
  let title = '';
  if (titleMod && model && !phpEmpty(model.api_key)) {
    const complete = async (arg) => {
      let messages;
      let opts = {};
      if (Array.isArray(arg)) messages = arg;
      else if (arg && Array.isArray(arg.messages)) messages = arg.messages;
      else messages = [{ role: 'user', content: String(arg ?? '') }];
      if (arg && !Array.isArray(arg) && typeof arg === 'object') {
        opts = { maxTokens: arg.maxTokens || arg.max_tokens || 64, temperature: 0.3 };
      } else {
        opts = { maxTokens: 64, temperature: 0.3 };
      }
      return Agent.completeText(model, messages, opts);
    };
    try {
      title = await titleMod.generateTitle({
        modelRow: model,
        userText,
        assistantText,
        request: complete,
        session,
        force: !!force,
      }) || '';
    } catch (e) {
      title = '';
    }
  }
  title = String(title || '').replace(/["'“”‘’\r\n\t]/g, '').trim();
  if (!title) {
    if (titleMod && typeof titleMod.deriveTitle === 'function') title = titleMod.deriveTitle(userText);
    else title = cleanUserText(userText).slice(0, 24);
  }
  title = [...String(title || '新对话')].slice(0, 40).join('');
  return title || '新对话';
}

/** 非流式收集器（给 action=send 复用 Agent 逻辑） */
function makeCollectorSSE() {
  const chunks = [];
  const ctl = new AbortController();
  return {
    signal: ctl.signal,
    closed: false,
    async write(payload) {
      if (payload && typeof payload.type === 'string') chunks.push(payload);
      return true;
    },
    end() { /* noop */ },
    async flushAndEnd() { /* noop */ },
    get events() { return chunks; },
  };
}

module.exports = async (ctx) => {
  const { req, res, Response, query, body } = ctx;

  const method = req.method;
  const action = query.action ?? '';

  // CORS 头必须最早设置，确保错误响应也包含
  const origin = req.headers.origin || 'http://localhost:5173';
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Credentials', 'true');

  // 处理 CORS 预检请求（必须在 Auth 之前）
  if (method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '86400');
    res.status(204);
    res.end();
    throw new HttpSent();
  }

  ctx.Auth.requireLogin();
  const ownerKey = ctx.Auth.ownerKey();
  const user = ctx.Auth.user();
  ensureAiTables();

  // ── 截图读取（GET，校验归属：文件名带 owner hash） ──
  if (method === 'GET' && action === 'shot') {
    const id = String(query.id ?? '');
    if (!/^[a-z0-9-]{8,64}$/i.test(id)) Response.error('参数不合法', 1, 400);
    const prefix = ownerHash(ownerKey) + '-';
    if (!id.startsWith(prefix)) Response.error('无权限访问该截图', 403, 403);
    const file = path.join(SHOTS_DIR, id + '.png');
    if (!fs.existsSync(file)) Response.error('截图不存在或已过期', 404, 404);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=600');
    res.send(fs.readFileSync(file));
    throw new HttpSent();
  }

  // ── 列出会话 ──
  if (method === 'GET' && action === 'sessions') {
    const scope = query.scope ?? null;
    let sql = 'SELECT id, owner_key, scope, scope_ref, title, pinned, pinned_at, title_generated, model, reasoning, created_at, updated_at'
      + ' FROM ai_chat_sessions WHERE owner_key = ?';
    const params = [ownerKey];
    if (!phpEmpty(scope)) {
      sql += ' AND scope = ?';
      params.push(scope);
    }
    sql += ' ORDER BY pinned DESC, COALESCE(pinned_at, \'\') DESC, updated_at DESC, id DESC LIMIT 100';
    Response.success(DB.all(sql, params));
  }

  // ── 列出消息 ──
  if (method === 'GET' && action === 'messages') {
    const sessionId = parseInt(query.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    const rows = DB.all('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC', [sessionId]);
    Response.success(rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      role: r.role,
      // 用户消息只回显真正的提问；[编辑器上下文] 片段不入正文（历史脏数据也在这里被折叠）
      content: r.role === 'user' ? (cleanUserText(r.content) || '（本轮只提供了编辑器上下文）') : r.content,
      meta: jsonParseSafe(r.meta, null),
      created_at: r.created_at,
    })));
  }

  // ── 重命名会话 ──
  if (method === 'POST' && action === 'rename') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    const title = [...String(body.title ?? '').trim()].slice(0, 80).join('');
    if (!sessionId) Response.error('缺少 session_id');
    if (!title) Response.error('标题不能为空');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    DB.update('ai_chat_sessions', { title, title_generated: 1, updated_at: nowStr() }, 'id = ?', [sessionId]);
    Response.success({ renamed: true, title });
  }

  // ── 置顶 / 取消置顶 ──
  if (method === 'POST' && action === 'pin') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    const pinned = body.pinned === undefined ? !session.pinned : !!body.pinned;
    DB.update('ai_chat_sessions', {
      pinned: pinned ? 1 : 0,
      pinned_at: pinned ? nowStr() : null,
    }, 'id = ?', [sessionId]);
    Response.success({ pinned: !!pinned });
  }

  // ── 清空会话消息 ──
  if (method === 'POST' && action === 'clear') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    DB.delete('ai_chat_messages', 'session_id = ?', [sessionId]);
    Runs.removeBySession(sessionId);
    DB.update('ai_chat_sessions', { updated_at: nowStr() }, 'id = ?', [sessionId]);
    Response.success({ cleared: true });
  }

  // ── 重新生成标题 ──
  if (method === 'POST' && action === 'generate-title') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    const rows = DB.all(
      'SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 6',
      [sessionId]
    );
    const userText = rows.find((r) => r.role === 'user')?.content || session.title || '新对话';
    const assistantText = rows.filter((r) => r.role === 'assistant').map((r) => r.content).join('\n').slice(0, 1500);
    const title = await makeTitle({
      ownerKey,
      modelName: body.model || session.model || 'default',
      userText: cleanUserText(userText),
      assistantText,
      session,
      force: true,
    });
    DB.update('ai_chat_sessions', { title, title_generated: 1, updated_at: nowStr() }, 'id = ?', [sessionId]);
    Response.success({ title });
  }

  // ── 删除会话 ──
  if (method === 'POST' && action === 'delete') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    DB.delete('ai_chat_messages', 'session_id = ?', [sessionId]);
    DB.delete('ai_chat_sessions', 'id = ?', [sessionId]);
    Runs.removeBySession(sessionId);
    Response.success({ deleted: true });
  }

  // ── 上传编辑器截图 ──
  if (method === 'POST' && action === 'upload-shot') {
    const dataUrl = String(body.data_url ?? '');
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) Response.error('截图数据格式不正确');
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (buf.length === 0) Response.error('截图内容为空');
    if (buf.length > MAX_SHOT_BYTES) Response.error('截图过大（上限 6MB）');
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const id = ownerHash(ownerKey) + '-' + crypto.randomUUID();
    const file = path.join(SHOTS_DIR, id + (m[1] === 'jpeg' ? '.jpg' : '.png'));
    fs.writeFileSync(file, buf);
    Response.success({ id, url: '/api/ai/chat?action=shot&id=' + encodeURIComponent(id), size: buf.length });
  }

  // ── 上传附件（docx / xlsx / pptx / md / txt / csv / json …）──
  if (method === 'POST' && action === 'upload-attachment') {
    const AIAttach = require('../../lib/ai-attachments');
    const file = ctx.files && (ctx.files.file || Object.values(ctx.files)[0]);
    if (!file || !Buffer.isBuffer(file.tmp_name)) {
      Response.error('没有收到文件（请用 multipart/form-data，字段名 file）');
    }
    const saved = AIAttach.saveAttachment({
      DB,
      ownerKey,
      ownerHash: ownerHash(ownerKey),
      file: { name: file.name, buffer: file.tmp_name, size: file.size, mime: file.type },
    });
    if (!saved.ok) Response.error(saved.error || '附件解析失败');
    Response.success(saved);
  }

  // ── 流式发送（普通发送 / 重试指定 AI 消息） ──
  if (method === 'POST' && action === 'stream') {
    const retryMessageId = parseInt(body.retry_message_id ?? 0, 10) || 0;
    const scope = body.scope ?? 'global';
    const scopeRef = body.scope_ref ?? null;
    let sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    let model = String(body.model ?? 'default');
    let reasoning = String(body.reasoning ?? 'auto');
    const hasEditor = !!body.has_editor;

    // ══ 重试：删掉该条 AI 回复及其后文，用同一条用户消息重新生成，旧回复存为版本快照 ══
    if (retryMessageId) {
      if (!sessionId) Response.error('缺少 session_id');
      const retrySession = getSession(sessionId, ownerKey);
      if (!retrySession) Response.error('会话不存在或无权限', 403, 403);
      const target = DB.one('SELECT * FROM ai_chat_messages WHERE id = ? AND session_id = ?', [retryMessageId, sessionId]);
      if (!target) Response.error('要重试的消息不存在', 404, 404);
      if (target.role !== 'assistant') Response.error('只能重试 AI 的回复', 400, 400);
      // 只允许重试最后一条 AI 回复，避免无提示地丢掉后面对话
      const after = Number(DB.scalar('SELECT COUNT(*) FROM ai_chat_messages WHERE session_id = ? AND id > ?', [sessionId, target.id])) || 0;
      if (after > 0) Response.error('只能重试最后一条 AI 回复；如需回到更早的位置，请先用「撤回到这里」', 400, 400);
      const lastUser = DB.one(
        "SELECT * FROM ai_chat_messages WHERE session_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1",
        [sessionId, retryMessageId]
      );
      if (!lastUser) Response.error('找不到可重试的用户消息', 400, 400);

      const oldMeta = jsonParseSafe(target.meta, null) || {};
      const oldVariant = variantOfMessage(target);
      const previousVariants = Array.isArray(oldMeta.alternatives) ? oldMeta.alternatives : [];
      const alternatives = [oldVariant].concat(previousVariants);

      // 丢弃目标回复（及其后文），保留用户消息本身作为本轮输入
      truncateMessagesFrom(sessionId, target.id, true);

      const userContent = cleanUserText(lastUser.content);
      const lastUserMeta = jsonParseSafe(lastUser.meta, null) || {};
      const editorContext = lastUserMeta.editor_context && typeof lastUserMeta.editor_context === 'object'
        ? lastUserMeta.editor_context
        : null;
      // 重试时沿用原消息的上传附件
      const AIAttachR = require('../../lib/ai-attachments');
      const retryAttachments = AIAttachR.loadAttachments(DB, ownerKey, (lastUserMeta.attachments || []).map((a) => a && a.id));
      const history = loadHistoryBefore(sessionId, lastUser.id, 20);
      if (body.model) model = String(body.model);
      if (body.reasoning) reasoning = String(body.reasoning);

      const sseRetry = Agent.createSSE(req, res);
      let retryResult;
      try {
        retryResult = await Agent.startTurn({
          user, ownerKey, sessionId, history,
          userMessage: userContent,
          modelName: model,
          reasoning,
          sse: sseRetry,
          editorContext,
          hasEditor,
          baseUrl: requestBaseUrl(req),
          attachmentRows: retryAttachments,
        });
      } catch (e) {
        console.error('[ai] retry startTurn 异常:', e);
        try { await sseRetry.write({ type: 'error', message: 'AI 重试失败：' + (e && e.message ? e.message : e) }); } catch (_) { /* ignore */ }
        retryResult = { suspended: false, reply: '', blocks: [], interrupted: true, error: String(e && e.message || e) };
      }

      await finishStream({
        ctx, sse: sseRetry, result: retryResult, sessionId, session: retrySession, ownerKey, model, reasoning,
        content: userContent, res,
        extraMeta: { alternatives, retried_from: target.id, retry_of_variant_count: alternatives.length },
      });
      throw new HttpSent();
    }

    // ══ 普通发送 ══
    const content = String(body.content ?? '').trim();
    const editorContext = body.editor_context && typeof body.editor_context === 'object'
      ? body.editor_context
      : Agent.parseEditorContext(content);

    if (content === '') Response.error('消息内容不能为空');

    // 会话装配
    let session;
    if (!sessionId) {
      session = createSession({
        ownerKey,
        scope,
        scopeRef,
        title: cleanUserText(content).slice(0, 30) || '新对话',
        model,
        reasoning,
      });
      sessionId = session.id;
    } else {
      session = getSession(sessionId, ownerKey);
      if (!session) Response.error('会话不存在或无权限', 403, 403);
    }

    // 上传附件：只取当前用户名下、本消息引用的那几个
    const AIAttach = require('../../lib/ai-attachments');
    const attachmentIds = Array.isArray(body.attachments)
      ? body.attachments.map((a) => (a && typeof a === 'object' ? a.id : a))
      : [];
    const attachmentRows = AIAttach.loadAttachments(DB, ownerKey, attachmentIds);
    const attachmentMeta = attachmentRows.map((r) => ({ id: r.id, name: r.file_name, size: r.size, truncated: !!r.truncated }));

    // 保存用户消息 + 更新会话
    // 注意：只存「用户真正问的话」，[编辑器上下文] 片段（可能含整份文件内容）放进 meta，
    // 否则会话历史与聊天气泡里会出现一大段上下文/系统提示词。
    const now = nowStr();
    const userQuestion = cleanUserText(content);
    const userMeta = {};
    if (editorContext) userMeta.editor_context = editorContext;
    if (attachmentMeta.length) userMeta.attachments = attachmentMeta;
    saveMessage(sessionId, 'user', userQuestion !== '' ? userQuestion : '（本轮只提供了编辑器上下文）',
      Object.keys(userMeta).length ? userMeta : null);
    DB.update('ai_chat_sessions', { updated_at: now, model, reasoning }, 'id = ?', [sessionId]);

    // 历史里最后一条就是刚存的用户消息（已清洗），去掉它；本轮问题单独用原始 content 交给 Agent
    const history = loadHistory(sessionId, 21).slice(0, -1);

    const sse = Agent.createSSE(req, res);
    let result;
    try {
      result = await Agent.startTurn({
        user,
        ownerKey,
        sessionId,
        history,
        userMessage: content,
        modelName: model,
        reasoning,
        sse,
        editorContext,
        hasEditor,
        baseUrl: requestBaseUrl(req),
        attachmentRows,
      });
    } catch (e) {
      console.error('[ai] startTurn 异常:', e);
      try { await sse.write({ type: 'error', message: 'AI 处理失败：' + (e && e.message ? e.message : e) }); } catch (_) { /* ignore */ }
      result = { suspended: false, reply: '', blocks: [], interrupted: true, error: String(e && e.message || e) };
    }

    await finishStream({
      ctx, sse, result, sessionId, session, ownerKey, model, reasoning, content, res,
    });
    throw new HttpSent();
  }

  // ── 撤回到某条消息（放弃其后对话） ──
  if (method === 'POST' && action === 'truncate') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    const fromMessageId = parseInt(body.from_message_id ?? 0, 10) || 0;
    const inclusive = body.inclusive === undefined ? true : !!body.inclusive;
    if (!sessionId) Response.error('缺少 session_id');
    if (!fromMessageId) Response.error('缺少 from_message_id');
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    const target = DB.one('SELECT * FROM ai_chat_messages WHERE id = ? AND session_id = ?', [fromMessageId, sessionId]);
    if (!target) Response.error('要撤回的消息不存在', 404, 404);

    const deleted = truncateMessagesFrom(sessionId, fromMessageId, inclusive);
    Response.success({
      session_id: sessionId,
      deleted,
      message: {
        id: target.id,
        role: target.role,
        content: target.role === 'user' ? cleanUserText(target.content) : String(target.content || ''),
      },
    });
  }

  // ── 续跑（客户端工具 / 用户回答） ──
  if (method === 'POST' && action === 'resume') {
    const runId = String(body.run_id ?? '');
    const results = Array.isArray(body.results) ? body.results : [];
    if (!runId) Response.error('缺少 run_id');
    const found = Runs.load(runId, ownerKey);
    if (!found) Response.error('运行状态已失效，请重新发送消息', 410, 410);

    const sessionId = Number(found.sessionId) || 0;
    const session = getSession(sessionId, ownerKey);
    if (!session) Response.error('会话不存在或无权限', 403, 403);

    const sse = Agent.createSSE(req, res);
    let result;
    try {
      result = await Agent.resumeTurn({ runId, ownerKey, user, results, sse });
    } catch (e) {
      console.error('[ai] resumeTurn 异常:', e);
      try { await sse.write({ type: 'error', message: '续跑失败：' + (e && e.message ? e.message : e) }); } catch (_) { /* ignore */ }
      result = { suspended: false, reply: '', blocks: [], interrupted: true, error: String(e && e.message || e) };
    }

    await finishStream({
      ctx, sse, result, sessionId, session, ownerKey,
      model: body.model || session.model || 'default',
      reasoning: body.reasoning || session.reasoning || 'auto',
      content: '', res,
    });
    throw new HttpSent();
  }

  // ── 非流式发送（兼容旧调用方） ──
  if (method === 'POST' && action === 'send') {
    const content = String(body.content ?? '').trim();
    const scope = body.scope ?? 'global';
    const scopeRef = body.scope_ref ?? null;
    let sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    const model = String(body.model ?? 'default');
    const reasoning = String(body.reasoning ?? 'auto');
    if (content === '') Response.error('消息内容不能为空');

    let session;
    if (!sessionId) {
      session = createSession({ ownerKey, scope, scopeRef, title: cleanUserText(content).slice(0, 30) || '新对话', model, reasoning });
      sessionId = session.id;
    } else {
      session = getSession(sessionId, ownerKey);
      if (!session) Response.error('会话不存在或无权限', 403, 403);
    }

    const userQuestion = cleanUserText(content);
    saveMessage(sessionId, 'user', userQuestion !== '' ? userQuestion : '（本轮只提供了编辑器上下文）', null);
    DB.update('ai_chat_sessions', { updated_at: nowStr(), model, reasoning }, 'id = ?', [sessionId]);
    const history = loadHistory(sessionId, 21).slice(0, -1);

    const collector = makeCollectorSSE();
    let result;
    try {
      result = await Agent.startTurn({
        user, ownerKey, sessionId, history, userMessage: content,
        modelName: model, reasoning, sse: collector, editorContext: Agent.parseEditorContext(content),
        hasEditor: false,
      });
    } catch (e) {
      result = { suspended: false, reply: '', blocks: [], interrupted: true, error: String(e && e.message || e) };
    }
    // 非流式路径不允许挂起（客户端工具一律降级为不可用）
    if (result && result.suspended) {
      result = { suspended: false, reply: result.reply || '', blocks: result.blocks || [], interrupted: true, error: '该操作需要流式通道' };
      Runs.remove(result.runId);
    }
    const reply = String(result?.reply || '');
    const messageId = saveMessage(sessionId, 'assistant', reply, {
      blocks: result?.blocks || [],
      reasoning: result?.reasoning || '',
      model: result?.model?.name || model,
      reasoning_level: reasoning,
      usage: result?.usage || null,
      interrupted: !!result?.interrupted,
    });
    const title = await maybeAutoTitle({ ownerKey, sessionId, session, modelName: model, content, reply });
    Response.success({ session_id: sessionId, message_id: messageId, reply, title });
  }

  Response.error('未知的操作', 405, 405);

  /**
   * 流式收尾：落库 + 自动标题 + 发 done
   * @param {object} extraMeta 额外的 meta 字段（如重试时的 alternatives 版本快照）
   */
  async function finishStream({ sse, result, sessionId, session, ownerKey, model, reasoning, content, extraMeta }) {
    if (!result) result = { suspended: false, reply: '', blocks: [] };

    if (result.suspended) {
      // 暂停：先把当前状态告诉前端，但不落库（等续跑结束再统一保存）
      await sse.write({ type: 'waiting', run_id: result.runId || '' });
      await sse.flushAndEnd();
      return;
    }

    const reply = String(result.reply || '');
    const meta = Object.assign({
      blocks: result.blocks || [],
      reasoning: result.reasoning || '',
      model: result.model?.name || model,
      reasoning_level: reasoning,
      usage: result.usage || null,
      interrupted: !!result.interrupted,
      error: result.error || '',
    }, extraMeta || {});
    let messageId = 0;
    // 空回复（且不是断连）也要留一条，避免会话看起来没反应
    if (reply !== '' || !result.interrupted) {
      messageId = saveMessage(sessionId, 'assistant', reply, meta);
      DB.update('ai_chat_sessions', { updated_at: nowStr() }, 'id = ?', [sessionId]);
    }

    const title = await maybeAutoTitle({ ownerKey, sessionId, session, modelName: model, content, reply });

    await sse.write({
      type: 'done',
      session_id: sessionId,
      message_id: messageId,
      reply,
      title: title || undefined,
      interrupted: !!result.interrupted,
    });
    await sse.flushAndEnd();
  }

  /**
   * 首轮回答后自动生成会话标题（已生成过则跳过）
   */
  async function maybeAutoTitle({ ownerKey, sessionId, session, modelName, content, reply }) {
    if (!session || !sessionId) return '';
    // 重新读一次：本轮 AI 可能已经用 set_session_title 改过标题（title_generated=1），
    // 不能拿任务开始前的旧 session 快照把它覆盖回去。
    const fresh = DB.one('SELECT title, title_generated FROM ai_chat_sessions WHERE id = ?', [sessionId]) || session;
    if (Number(fresh.title_generated) === 1) return '';
    const count = DB.scalar('SELECT COUNT(*) FROM ai_chat_messages WHERE session_id = ?', [sessionId]);
    if (Number(count) > 2) return ''; // 已有轮次，不再自动改标题
    const userText = cleanUserText(content) || session.title || '';
    if (!userText) return '';
    try {
      const title = await makeTitle({
        ownerKey,
        modelName: modelName || 'default',
        userText,
        assistantText: String(reply || '').slice(0, 1200),
        session,
      });
      DB.update('ai_chat_sessions', { title, title_generated: 1 }, 'id = ?', [sessionId]);
      if (!sse?.closed) await sse.write({ type: 'title', title });
      return title;
    } catch (_) {
      return '';
    }
  }
};
