/**
 * AI 助理 —— 待续跑断点存储
 *
 * 客户端工具（浏览器执行）与「向用户提问」会让 Agent 循环在服务端暂停。
 * 暂停时把完整对话状态序列化进 ai_pending_runs，前端执行完再带 run_id 续跑。
 *
 * 断点只在短时间内有效（默认 2 小时），过期由 db.ensureSchema 清理。
 */
const crypto = require('crypto');
const DB = require('../../lib/db');
const { nowStr } = require('../../lib/response');

const TTL_MS = 2 * 60 * 60 * 1000;

/** 创建断点，返回 run_id */
function create(ownerKey, sessionId, state) {
  const id = crypto.randomUUID();
  const now = nowStr();
  DB.insert('ai_pending_runs', {
    id,
    owner_key: ownerKey,
    session_id: sessionId,
    state: JSON.stringify(state || {}),
    created_at: now,
    updated_at: now,
  });
  return id;
}

/** 读取断点（校验归属与过期），不存在返回 null */
function load(id, ownerKey) {
  if (!id || typeof id !== 'string') return null;
  const row = DB.one('SELECT * FROM ai_pending_runs WHERE id = ? AND owner_key = ?', [id, ownerKey]);
  if (!row) return null;
  const updated = Date.parse(String(row.updated_at || '').replace(' ', 'T'));
  if (Number.isFinite(updated) && Date.now() - updated > TTL_MS) {
    try { DB.delete('ai_pending_runs', 'id = ?', [id]); } catch (_) { /* ignore */ }
    return null;
  }
  let state = null;
  try { state = JSON.parse(row.state); } catch (_) { state = null; }
  if (!state || typeof state !== 'object') return null;
  return { id: row.id, sessionId: row.session_id, state };
}

/** 更新断点状态 */
function save(id, state) {
  if (!id) return;
  DB.update('ai_pending_runs', { state: JSON.stringify(state || {}), updated_at: nowStr() }, 'id = ?', [id]);
}

/**
 * 写入或更新断点（调用方自带 run_id 时使用；断点首次创建走这里插入）
 */
function upsert(id, ownerKey, sessionId, state) {
  if (!id) return;
  const exists = DB.one('SELECT id FROM ai_pending_runs WHERE id = ?', [id]);
  if (exists) {
    save(id, state);
    return;
  }
  const now = nowStr();
  DB.insert('ai_pending_runs', {
    id,
    owner_key: String(ownerKey || ''),
    session_id: Number(sessionId) || 0,
    state: JSON.stringify(state || {}),
    created_at: now,
    updated_at: now,
  });
}

/** 删除断点（正常结束后调用） */
function remove(id) {
  if (!id) return;
  try { DB.delete('ai_pending_runs', 'id = ?', [id]); } catch (_) { /* ignore */ }
}

/** 清理某会话的所有断点（会话被删除时） */
function removeBySession(sessionId) {
  if (!sessionId) return;
  try { DB.delete('ai_pending_runs', 'session_id = ?', [sessionId]); } catch (_) { /* ignore */ }
}

module.exports = { create, load, save, upsert, remove, removeBySession, TTL_MS };
