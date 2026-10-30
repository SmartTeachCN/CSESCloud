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

/** 去掉「[编辑器上下文]」片段后的用户问题（用于标题） */
function cleanUserText(content) {
  const m = /\[用户问题\]\s*\n?([\s\S]*)$/.exec(String(content ?? ''));
  return (m ? m[1] : String(content ?? '')).trim();
}

function ownerHash(ownerKey) {
  return crypto.createHash('sha1').update(String(ownerKey || '')).digest('hex').slice(0, 16);
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
  return rows.map((r) => ({ role: r.role, content: r.content, meta: jsonParseSafe(r.meta, null) }));
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
      content: r.content,
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

  // ── 流式发送 ──
  if (method === 'POST' && action === 'stream') {
    const content = String(body.content ?? '').trim();
    const scope = body.scope ?? 'global';
    const scopeRef = body.scope_ref ?? null;
    let sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    const model = String(body.model ?? 'default');
    const reasoning = String(body.reasoning ?? 'auto');
    const hasEditor = !!body.has_editor;
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

    // 保存用户消息 + 更新会话
    const now = nowStr();
    saveMessage(sessionId, 'user', content, editorContext ? { editor_context: editorContext } : null);
    DB.update('ai_chat_sessions', { updated_at: now, model, reasoning }, 'id = ?', [sessionId]);

    const history = loadHistory(sessionId, 20).slice(0, -1); // 去掉刚存的这条用户消息

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

    saveMessage(sessionId, 'user', content, null);
    DB.update('ai_chat_sessions', { updated_at: nowStr(), model, reasoning }, 'id = ?', [sessionId]);
    const history = loadHistory(sessionId, 20).slice(0, -1);

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
   */
  async function finishStream({ sse, result, sessionId, session, ownerKey, model, reasoning, content }) {
    if (!result) result = { suspended: false, reply: '', blocks: [] };

    if (result.suspended) {
      // 暂停：先把当前状态告诉前端，但不落库（等续跑结束再统一保存）
      await sse.write({ type: 'waiting', run_id: result.runId || '' });
      await sse.flushAndEnd();
      return;
    }

    const reply = String(result.reply || '');
    const meta = {
      blocks: result.blocks || [],
      reasoning: result.reasoning || '',
      model: result.model?.name || model,
      reasoning_level: reasoning,
      usage: result.usage || null,
      interrupted: !!result.interrupted,
      error: result.error || '',
    };
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
    if (Number(session.title_generated) === 1) return '';
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
