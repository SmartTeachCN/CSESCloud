/**
 * CSES Cloud - SQLite 数据库封装（NodeJS 版，移植自旧实现）
 *
 * 使用 Node.js 内置的 node:sqlite（Node >= 22.5），无需原生编译（Node-GYP），
 * Windows / Linux 开箱即用，便于在 Linux 服务器上部署。
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

let _db = null;

/** 递归净化参数：SQLite 绑定不接受 boolean/undefined，转为 1/0/null（对齐 PDO 行为） */
function sanitize(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = sanitize(val);
    return out;
  }
  return v;
}

/** node:sqlite 的 BLOB 返回 Uint8Array，归一化为 Buffer（零拷贝视图），对齐 better-sqlite3 行为 */
function normalizeValue(v) {
  if (v instanceof Uint8Array && !Buffer.isBuffer(v)) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  return v;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) row[k] = normalizeValue(row[k]);
  return row;
}

/** 获取数据库单例 */
function pdo() {
  if (_db !== null) return _db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbPath = path.join(DATA_DIR, 'cses.db');
  const isNew = !fs.existsSync(dbPath);

  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');

  if (isNew) {
    migrate();
    seed();
    // 新建数据库同样补齐增量列/索引，保证 schema.sql 与迁移逻辑一致
    ensureSchema();
  } else {
    // 已有数据库：执行增量迁移（补充新表/新字段）
    ensureSchema();
  }

  return _db;
}

/**
 * 增量迁移：保证已有数据库具备最新结构
 * 使用 CREATE TABLE IF NOT EXISTS 与 try-catch ALTER TABLE，安全可重复执行
 */
function ensureSchema() {
  const db = pdo();
  const schema = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
  db.exec(schema);

  // instances 表新增 app_id 列（关联 apps）
  addMissingColumn('instances', 'app_id', 'INTEGER');
  addMissingColumn('instances', 'app_key', 'TEXT');

  // 实例所有者、唯一ID、组、配置
  addMissingColumn('instances', 'owner_user_id', 'INTEGER');
  addMissingColumn('instances', 'owner_type', "TEXT NOT NULL DEFAULT 'sub'");
  addMissingColumn('instances', 'instance_uid', 'TEXT');
  addMissingColumn('instances', 'group_id', 'INTEGER');
  addMissingColumn('instances', 'config', 'TEXT');
  // V3：配置实例（轻编辑器文件分发）使用的源文件与更新时间
  addMissingColumn('instances', 'source_file_id', 'INTEGER');
  addMissingColumn('instances', 'updated_at', 'TEXT');

  // V3：实例组对外公开标识（静态集控 URL 使用）
  addMissingColumn('instance_groups', 'dir_id', 'TEXT');
  addMissingColumn('instance_groups', 'updated_at', 'TEXT');

  // 子用户权限（JSON）
  addMissingColumn('users', 'permissions', 'TEXT');

  // 最高管理员标记（临时管理员可将其它用户提升为最高管理员）
  addMissingColumn('users', 'is_super_admin', 'INTEGER NOT NULL DEFAULT 0');

  // 通知表扩展字段
  addMissingColumn('notifications', 'sender_id', 'INTEGER');
  addMissingColumn('notifications', 'sender_name', 'TEXT');
  addMissingColumn('notifications', 'target_type', "TEXT NOT NULL DEFAULT 'all'");
  addMissingColumn('notifications', 'target_id', 'TEXT');
  addMissingColumn('notifications', 'share_id', 'INTEGER');

  // apps 表：共享与派生关系
  addMissingColumn('apps', 'is_shared', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('apps', 'forked_from', 'INTEGER');
  addMissingColumn('apps', 'forked_by', 'TEXT');
  addMissingColumn('apps', 'is_official', 'INTEGER NOT NULL DEFAULT 0');

  // users 表：个人中心扩展字段
  addMissingColumn('users', 'department', 'TEXT');
  addMissingColumn('users', 'avatar', 'TEXT');
  addMissingColumn('users', 'preferences', 'TEXT');

  // cloud_files 表：实例文件系统扩展字段
  addMissingColumn('cloud_files', 'directory', "TEXT NOT NULL DEFAULT '/'");
  addMissingColumn('cloud_files', 'file_size', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('cloud_files', 'file_category', "TEXT NOT NULL DEFAULT 'editor'");

  // cloud_files 目录索引
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_cloud_files_directory ON cloud_files(directory)'); } catch (_) {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_files_path ON cloud_files(instance_id, directory, name)'); } catch (_) {}

  // V3：配置实例 / 静态集控索引
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_groups_dir_id ON instance_groups(dir_id)'); } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_instances_source_file ON instances(source_file_id)'); } catch (_) {}
  try { db.exec("UPDATE instances SET updated_at = created_at WHERE updated_at IS NULL"); } catch (_) {}

  // 网页空间审查系统
  addMissingColumn('web_hosting_spaces', 'review_status', "TEXT NOT NULL DEFAULT 'published'");
  addMissingColumn('web_hosting_spaces', 'disabled_by_admin', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('web_hosting_spaces', 'disabled_reason', 'TEXT');
  addMissingColumn('web_hosting_files', 'published_content', 'BLOB');
  addMissingColumn('web_hosting_files', 'published_size', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('web_hosting_files', 'review_status', "TEXT NOT NULL DEFAULT 'published'");

  // V5：分享链接可配置策略（原「预览链接」升级为「分享链接」）
  // 旧数据默认值保持与升级前行为一致：需登录、允许接收、不可游客编辑、非仅预览
  addMissingColumn('share_preview_links', 'require_login', 'INTEGER NOT NULL DEFAULT 1');
  addMissingColumn('share_preview_links', 'preview_only', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('share_preview_links', 'allow_accept', 'INTEGER NOT NULL DEFAULT 1');
  addMissingColumn('share_preview_links', 'allow_guest_edit', 'INTEGER NOT NULL DEFAULT 0');

  // 初始化已存在的文件：将 content 同步到 published_content
  try {
    db.exec("UPDATE web_hosting_files SET published_content = content, published_size = file_size WHERE published_content IS NULL AND is_directory = 0");
  } catch (_) {}

  // V4：AI 助理 —— 会话置顶/自动标题/最近模型、消息结构化展示块、客户端工具续跑断点
  addMissingColumn('ai_chat_sessions', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('ai_chat_sessions', 'pinned_at', 'TEXT');
  addMissingColumn('ai_chat_sessions', 'title_generated', 'INTEGER NOT NULL DEFAULT 0');
  addMissingColumn('ai_chat_sessions', 'model', 'TEXT');
  addMissingColumn('ai_chat_sessions', 'reasoning', 'TEXT');
  addMissingColumn('ai_chat_messages', 'meta', 'TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_ai_pending_runs_owner ON ai_pending_runs(owner_key)'); } catch (_) {}
  // 过期断点清理（超过 2 小时）
  try { db.exec("DELETE FROM ai_pending_runs WHERE updated_at < datetime('now', '-2 hours')"); } catch (_) {}

  // V3：动态集控（EA2 设备/命令、校园集控单元、集控侧套餐）已整体移除。
  // 旧版本升级时清理遗留表，避免继续保留无消费方的动态集控数据（新库不会创建这些表）。
  for (const obsolete of [
    'ea2_commands', 'ea2_device_credentials', 'ea2_enrollment_codes', 'ea2_devices',
    'campus_control_units', 'cc_packages',
  ]) {
    try { db.exec('DROP TABLE IF EXISTS ' + obsolete); } catch (_) { /* 忽略清理失败 */ }
  }

  // 帮助中心内置文档：仅当 help_content 为空时写入（幂等 seed，不覆盖管理员编辑过的内容）。
  // require 放在函数内（惰性）避免模块加载期循环依赖；任何异常只告警，不影响启动。
  try {
    const { ensureHelpContent } = require('./seed-help');
    ensureHelpContent(db);
  } catch (err) {
    console.warn('[db] 初始化帮助中心文档失败:', err && err.message ? err.message : err);
  }
}

/** 为表添加缺失的列（SQLite 不支持 IF NOT EXISTS，用 try-catch） */
function addMissingColumn(table, column, type) {
  const db = pdo();
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (_) {
    // 列已存在，忽略
  }
}

/** 执行语句（内部） */
function _run(sql, params = []) {
  const db = pdo();
  const stmt = db.prepare(sql);
  const p = sanitize(params);
  if (Array.isArray(p)) return stmt.run(...p);
  return stmt.run(p);
}

function _all(sql, params = []) {
  const db = pdo();
  const stmt = db.prepare(sql);
  const p = sanitize(params);
  if (Array.isArray(p)) return stmt.all(...p);
  return stmt.all(p);
}

/** 查询单行 */
function one(sql, params = []) {
  const db = pdo();
  const stmt = db.prepare(sql);
  const p = sanitize(params);
  const row = Array.isArray(p) ? stmt.get(...p) : stmt.get(p);
  return row === undefined ? null : normalizeRow(row);
}

/** 查询多行 */
function all(sql, params = []) {
  return _all(sql, params).map(normalizeRow);
}

/** 查询单个标量值 */
function scalar(sql, params = []) {
  const db = pdo();
  const stmt = db.prepare(sql);
  const p = sanitize(params);
  const row = Array.isArray(p) ? stmt.get(...p) : stmt.get(p);
  if (row === undefined) return null;
  const keys = Object.keys(row);
  return keys.length ? normalizeValue(row[keys[0]]) : null;
}

/** 插入数据，返回 lastInsertId */
function insert(table, data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(c => ':' + c);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders.join(',')})`;
  const info = _run(sql, sanitize(data));
  return Number(info.lastInsertRowid);
}

/** 更新数据（对齐 PHP 版：SET 用 :set_x 命名占位符，WHERE 中 ? 转 :where_N） */
function update(table, data, where, whereParams = []) {
  const set = [];
  const params = {};
  for (const [col, value] of Object.entries(data)) {
    set.push(`${col} = :set_${col}`);
    params[`set_${col}`] = value;
  }
  let whereIdx = 0;
  const whereNormalized = String(where).replace(/\?/g, () => ':where_' + (whereIdx++));
  const whereParamsNorm = {};
  if (Array.isArray(whereParams)) {
    whereParams.forEach((v, i) => { whereParamsNorm['where_' + i] = v; });
  } else {
    for (const [k, v] of Object.entries(whereParams)) {
      whereParamsNorm[k.startsWith('where_') ? k : 'where_' + k] = v;
    }
  }
  const sql = `UPDATE ${table} SET ${set.join(',')} WHERE ${whereNormalized}`;
  Object.assign(params, whereParamsNorm);
  return _run(sql, params);
}

/** 删除数据 */
function del(table, where, params = []) {
  return _run(`DELETE FROM ${table} WHERE ${where}`, params);
}

/** 建表与初始结构 */
function migrate() {
  const db = pdo();
  const schema = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
  db.exec(schema);
}

/** 写入初始演示数据 */
function seed() {
  const seederPath = path.join(__dirname, 'seed.js');
  if (fs.existsSync(seederPath)) {
    require(seederPath)();
  }
}

module.exports = {
  pdo,
  ensureSchema,
  addMissingColumn,
  query: _all, // 兼容少数用法
  one,
  all,
  scalar,
  insert,
  update,
  delete: del,
};
