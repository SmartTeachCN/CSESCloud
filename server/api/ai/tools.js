/**
 * CSES Cloud —— AI 助理 v4 服务端工具层。
 *
 * 契约见 docs/AI-assistant-v4-spec.md §3。对外只暴露：
 *   - definitions(opts?: { hasEditor?: boolean })   → ToolDef[]
 *   - labelOf(name)                                  → 前端工具卡标题
 *   - execute(name, args, ctx)                       → { ok, summary, result?, image?, patch? }
 *
 * ctx = { ownerKey, user, sessionId, scope, editorContext, DB, client: { hasEditor } }
 *
 * 设计要点：
 *   - 直接复用 server/lib 与 server/api 的真实数据语义，不绕 HTTP 自调用；
 *     轻编辑器「云文件」实际存放在 web_hosting_files 的 `/.cloud/` 隐藏目录
 *     （空间由 web_hosting_spaces.alliance_username 归属联盟账户），
 *     「配置实例」即 instances 表中 app_key ∈ distribution-formats.ALL_APP_KEYS 的行。
 *   - 所有写操作先按 ownerKey 校验归属；写操作返回 patch 告诉前端刷新什么。
 *   - execute 永不抛异常（内部 catch 后返回 ok:false），避免打断 Agent 循环。
 *
 * 注意：本文件与 title.js / models.js 同属 A 侧写作用域；不要在此修改数据库结构，
 * 缺列一律通过 `ctx.DB.addMissingColumn` 兜底（由 Lead 维护 schema.sql / db.js）。
 */
'use strict';

const crypto = require('crypto');
const DB_DEFAULT = require('../../lib/db');
const { nowStr } = require('../../lib/response');
const formats = require('../../lib/distribution-formats');
const convert = require('../../lib/classisland-convert');

// ────────────────────────────── 常量 ──────────────────────────────

/** 轻编辑器云文件在 web_hosting_files 中的隐藏目录前缀 */
const CLOUD_PREFIX = '/.cloud/';
/** 分享占位条目内容前缀（与 server/lib/cloud-share.js 的 MARKER_PREFIX 保持一致） */
const SHARE_MARKER_PREFIX = 'CSES_CLOUD_SHARE:';
/** 云文件内容读取上限（字符） */
const MAX_READ_CHARS = 8000;
/** 列表类工具最多返回条数 */
const MAX_LIST_ITEMS = 200;
/** 配置实例应用的 app_key（来自 distribution-formats，顺序固定） */
const APP_KEYS = formats.ALL_APP_KEYS;
/** 默认分发实例组名称（对齐 distributions.js） */
const DEFAULT_GROUP_NAME = '配置分发';
const DIR_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// ────────────────────────────── 基础工具函数 ──────────────────────────────

/** 取 DB 模块（ctx.DB 优先，保证与调用方共享同一单例） */
function dbOf(ctx) {
  return (ctx && ctx.DB) || DB_DEFAULT;
}

/** 字符数（按码点，CJK 计 1） */
function charLen(text) {
  return Array.from(String(text === undefined || text === null ? '' : text)).length;
}

/** 人类可读字节数（对齐 data-space.js formatBytes） */
function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return (Math.round((n / Math.pow(k, i)) * 10) / 10) + ' ' + (sizes[i] || '');
}

/** 截断长文本并附说明 */
function clipText(text, max) {
  const s = String(text === undefined || text === null ? '' : text);
  if (charLen(s) <= max) return s;
  return Array.from(s).slice(0, max).join('') + '\n…（内容已截断，共 ' + charLen(s) + ' 字符）';
}

/** 归属 key（与 Auth.ownerKey() 完全一致，供 ctx 未带 ownerKey 时兜底） */
function ownerKeyOf(user) {
  const u = user || {};
  const type = u.type || 'sub';
  if (type === 'alliance') return 'alliance:' + (u.username || '');
  return 'sub:school:' + (u.school_id || 0) + ':' + (u.user_id || 0);
}

/**
 * 标准化当前用户上下文。
 *
 * agent.js 调 execute 时可能传入 `user: null`（只有 ownerKey / sessionId），
 * 因此这里在 user 缺失时按 ownerKey 反推身份，并对子用户回查 users 表补全显示名与角色。
 */
function userContext(ctx) {
  let user = (ctx && ctx.user) || null;
  let ownerKey = String((ctx && ctx.ownerKey) || (user ? ownerKeyOf(user) : ''));

  if (!user) {
    if (ownerKey.indexOf('alliance:') === 0) {
      const allianceName = ownerKey.slice('alliance:'.length);
      user = {
        type: 'alliance', username: allianceName, display_name: allianceName,
        role: 'alliance', user_id: 0, school_id: 0,
      };
    } else {
      const m = /^sub:school:(\d+):(\d+)$/.exec(ownerKey);
      user = m
        ? { type: 'sub', school_id: parseInt(m[1], 10) || 0, user_id: parseInt(m[2], 10) || 0, username: '', display_name: '', role: '' }
        : {};
    }
  }

  // 子用户资料补齐（调用方未传完整 user 时）
  if ((user.type || '') === 'sub' && user.user_id && !user.display_name) {
    try {
      const row = dbOf(ctx).one(
        'SELECT username, display_name, role, school_id FROM users WHERE id = ?',
        [user.user_id]
      );
      if (row) {
        user = Object.assign({}, user, {
          username: row.username || user.username,
          display_name: row.display_name || user.display_name,
          role: row.role || user.role,
          school_id: parseInt(row.school_id, 10) || user.school_id,
        });
      }
    } catch (_) { /* 查询失败时保持最小身份 */ }
  }

  if (!ownerKey) ownerKey = ownerKeyOf(user);

  let allianceUsername = '';
  if ((user.type || '') === 'alliance' && user.username) {
    allianceUsername = String(user.username);
  } else if (ownerKey.indexOf('alliance:') === 0) {
    allianceUsername = ownerKey.slice('alliance:'.length);
  }

  return {
    user: user,
    ownerKey: ownerKey,
    allianceUsername: allianceUsername,
    displayName: String(user.display_name || user.username || allianceUsername || '用户'),
    role: String(user.role || user.type || ''),
    type: String(user.type || ''),
    schoolId: parseInt(user.school_id ?? 0, 10) || 0,
    userId: parseInt(user.user_id ?? 0, 10) || 0,
  };
}

/** 角色中文名 */
function roleLabel(role) {
  const map = {
    alliance: '智教联盟用户',
    admin: '管理员',
    teacher: '教师',
    student: '学生',
    super_admin: '最高管理员',
    temp_admin: '临时管理员',
  };
  return map[role] || (role || '未知角色');
}

/** 写审计日志（ctx.Auth 可选，缺失时静默跳过） */
function audit(ctx, action, target) {
  try {
    if (ctx && ctx.Auth && typeof ctx.Auth.logAudit === 'function') {
      const u = userContext(ctx);
      ctx.Auth.logAudit(u.schoolId, u.userId, action, target);
    }
  } catch (_) { /* 审计失败不影响业务 */ }
}

// ────────────────────────────── 数据空间 / 路径工具 ──────────────────────────────

/** 查找联盟账户的数据空间（is_web_space=0 优先，回退首个空间） */
function findDataSpace(DB, username) {
  if (!username) return null;
  return DB.one(
    "SELECT * FROM web_hosting_spaces WHERE alliance_username = ? AND (is_web_space IS NULL OR is_web_space = 0) ORDER BY id ASC LIMIT 1",
    [username]
  ) || DB.one(
    'SELECT * FROM web_hosting_spaces WHERE alliance_username = ? ORDER BY id ASC LIMIT 1',
    [username]
  );
}

/** 确保数据空间存在（写操作兜底；对齐 cloud-files.js ensureCloudSpace 的最小语义；now 为时间字符串） */
function ensureDataSpace(DB, username, now) {
  let space = findDataSpace(DB, username);
  if (space) return space;
  let slug = String(username);
  let counter = 1;
  while (DB.scalar('SELECT 1 FROM web_hosting_spaces WHERE slug = ?', [slug])) {
    slug = username + '-' + (counter++);
  }
  const id = DB.insert('web_hosting_spaces', {
    alliance_username: username,
    slug: slug,
    title: username + ' 的数据空间',
    description: '',
    storage_quota: 100 * 1024 * 1024,
    is_enabled: 1,
    is_web_space: 0,
    created_at: now,
    updated_at: now,
  });
  return DB.one('SELECT * FROM web_hosting_spaces WHERE id = ?', [id]);
}

/**
 * 解析一个真实存在的 school_id。
 * instances.school_id 是指向 schools 的外键，而智教联盟账户的 school_id 可能是 0
 * 或指向已不存在的学校（会话里只带了 ownerKey 时尤其如此），这里做兜底，
 * 依次尝试：用户 school_id → 数据空间 school_id → 第一所学校。
 */
function resolveSchoolId(DB, u, space) {
  const candidates = [u && u.schoolId, space && space.school_id];
  for (const c of candidates) {
    const id = parseInt(c === undefined || c === null ? 0 : c, 10) || 0;
    if (id > 0 && DB.scalar('SELECT 1 FROM schools WHERE id = ?', [id])) return id;
  }
  const first = DB.scalar('SELECT id FROM schools ORDER BY id ASC LIMIT 1');
  return parseInt(first === undefined || first === null ? 0 : first, 10) || 0;
}

/** 云文件名校验（对齐 cloud-files.js validCloudName） */
function validCloudName(name) {
  const value = String(name === undefined || name === null ? '' : name).trim();
  if (value === '' || value === '.' || value === '..') return false;
  if (Buffer.byteLength(value, 'utf8') > 180) return false;
  return !/[\/\\:*?"<>|\x00-\x1F]/.test(value);
}

/** 规范化云目录（相对 `/.cloud/`；根目录返回 ''，非法返回 null） */
function normalizeCloudDir(dir) {
  if (dir === undefined || dir === null) return '';
  let result = String(dir).replace(/\\/g, '/').trim();
  result = result.replace(/^\/+|\/+$/g, '');
  if (result === '' || result === '.') return '';
  if (result.indexOf('/.cloud') === 0) result = result.slice('/.cloud'.length).replace(/^\/+/, '');
  const parts = result.split('/').filter(Boolean);
  for (const part of parts) {
    if (!validCloudName(part)) return null;
  }
  return parts.join('/');
}

/** 由父目录（相对）与名称生成完整 cloud 路径 */
function cloudPathFor(name, dir) {
  const cleanDir = dir ? String(dir).replace(/^\/+|\/+$/g, '') : '';
  return CLOUD_PREFIX + (cleanDir ? cleanDir + '/' : '') + name;
}

/**
 * 把模型/用户给的 path 归一化成「相对 `/.cloud/` 的路径」。
 *
 * 兼容真实使用里各种写法（模型经常复用它上一轮回复里的路径）：
 *   `/.cloud/web/a.html`、`.cloud/web/a.html`、`/web/a.html`、`web\a.html`、
 *   `/.cloud`（无尾斜杠）、多余斜杠、首尾空格。
 *
 * @returns {{rel:string, valid:boolean}} rel 不含首尾斜杠（根目录为 ''）；
 *   valid=false 表示路径含非法片段（如 `..`、`:`、`*` 等），解析器会按 file_missing 处理。
 */
function cleanCloudRelPath(pathArg) {
  let s = String(pathArg === undefined || pathArg === null ? '' : pathArg).trim();
  s = s.replace(/\\/g, '/').replace(/\/+/g, '/');
  s = s.replace(/^\/+/, '');
  // 反复剥离 `.cloud` / `.cloud/` 前缀（兼容带与不带前导斜杠的写法）
  let guard = 0;
  while (guard++ < 4 && (s === '.cloud' || s.indexOf('.cloud/') === 0)) {
    s = s === '.cloud' ? '' : s.slice('.cloud/'.length);
    s = s.replace(/^\/+/, '');
  }
  s = s.replace(/^\/+|\/+$/g, '');
  if (s === '') return { rel: '', valid: true };
  const parts = s.split('/').filter(Boolean);
  if (!parts.length) return { rel: '', valid: true };
  const valid = parts.every((part) => validCloudName(part));
  return { rel: parts.join('/'), valid: valid };
}

/** 完整路径 → 相对 `/.cloud/` 的父目录（根为 ''） */
function parentDirOfCloudPath(filePath) {
  const p = String(filePath === undefined || filePath === null ? '' : filePath);
  const idx = p.lastIndexOf('/');
  if (idx < 0) return '';
  const dir = p.slice(0, idx);
  if (dir === '/.cloud') return '';
  return dir.indexOf(CLOUD_PREFIX) === 0 ? dir.slice(CLOUD_PREFIX.length) : '';
}

/** 完整路径 → 相对 `/.cloud/` 的路径 */
function relCloudPath(filePath) {
  const p = String(filePath === undefined || filePath === null ? '' : filePath);
  return p.indexOf(CLOUD_PREFIX) === 0 ? p.slice(CLOUD_PREFIX.length) : p;
}

/** 文件扩展名（小写，不含点） */
function fileExt(name) {
  const base = formats.basename(name);
  const pos = base.lastIndexOf('.');
  if (pos <= 0) return '';
  return base.slice(pos + 1).toLowerCase();
}

/** 扩展名 → Content-Type（对齐 cloud-files.js guessCloudContentType） */
function guessCloudContentType(name) {
  const ext = fileExt(name);
  const types = {
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json', txt: 'text/plain', md: 'text/markdown',
    xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
    csv: 'text/csv', php: 'text/plain', py: 'text/plain',
    sql: 'text/plain', ts: 'application/javascript',
  };
  return types[ext] || 'application/octet-stream';
}

/** 确保 `/.cloud` 根目录存在（now 为时间字符串） */
function ensureCloudRoot(DB, spaceId, now) {
  const exists = DB.scalar(
    'SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1',
    [spaceId, '/.cloud']
  );
  if (!exists) {
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/.cloud',
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

/** 逐级确保云目录存在（now 为时间字符串；AI 写入时自动补目录，避免因缺目录失败） */
function ensureCloudDirs(DB, spaceId, dir, now) {
  if (!dir) return;
  const parts = String(dir).split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur = cur ? cur + '/' + part : part;
    const path = CLOUD_PREFIX + cur;
    const exists = DB.scalar(
      'SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1',
      [spaceId, path]
    );
    if (!exists) {
      DB.insert('web_hosting_files', {
        space_id: spaceId,
        file_path: path,
        file_size: 0,
        content_type: null,
        content: null,
        is_directory: 1,
        created_at: now,
        updated_at: now,
      });
    }
  }
}

/**
 * 诊断式云文件解析（read/update/rename/delete/create_instance 共用）。
 *
 * 解析顺序（逐步放宽，避免模型因路径写法不同而「改一次就改不了」）：
 *   1) file_id → 全局查；存在但 space_id 不同 → `id_other_space`
 *   2) 精确路径
 *   3) 归一化前缀后（`/.cloud/`、`.cloud/`、`/`、`\`、首尾空格）
 *   4) 大小写不敏感精确匹配
 *   5) 祖先目录缺失 → `dir_missing`
 *   6) basename 匹配（先同目录、再全局）：唯一 → ok；多个 → `ambiguous` + 候选相对路径
 *   7) 否则 → `file_missing`
 *
 * @param {object} DB DB 模块
 * @param {number} spaceId 当前用户数据空间 id
 * @param {{file_id?:number, path?:string, file_path?:string, name?:string}} args
 * @returns {{row:object|null, reason:'ok'|'id_not_found'|'id_other_space'|'dir_missing'|'file_missing'|'ambiguous', candidates:string[]}}
 */
function resolveCloudFile(DB, spaceId, args) {
  const a = args || {};
  const sid = parseInt(spaceId, 10) || 0;

  // 1) file_id
  const fileId = parseInt(a.file_id ?? 0, 10) || 0;
  if (fileId > 0) {
    const byId = DB.one('SELECT * FROM web_hosting_files WHERE id = ?', [fileId]);
    if (!byId) return { row: null, reason: 'id_not_found', candidates: [] };
    if ((parseInt(byId.space_id, 10) || 0) !== sid) {
      return { row: null, reason: 'id_other_space', candidates: [] };
    }
    return { row: byId, reason: 'ok', candidates: [] };
  }

  // 2) path 归一化
  const pathArg = a.path ?? a.file_path ?? a.name;
  if (pathArg === undefined || pathArg === null || String(pathArg).trim() === '') {
    return { row: null, reason: 'file_missing', candidates: [] };
  }
  const cleaned = cleanCloudRelPath(pathArg);
  if (!cleaned.valid || cleaned.rel === '') {
    return { row: null, reason: 'file_missing', candidates: [] };
  }
  const rel = cleaned.rel;
  const canonical = CLOUD_PREFIX + rel;

  // 3) 精确路径
  let row = DB.one(
    'SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ?',
    [sid, canonical]
  );
  if (row) return { row: row, reason: 'ok', candidates: [] };

  // 4) 大小写不敏感精确匹配
  row = DB.one(
    'SELECT * FROM web_hosting_files WHERE space_id = ? AND LOWER(file_path) = LOWER(?)',
    [sid, canonical]
  );
  if (row) return { row: row, reason: 'ok', candidates: [] };

  // 5) 祖先目录是否存在
  if (!cloudAncestorsExist(DB, sid, rel)) {
    return { row: null, reason: 'dir_missing', candidates: [] };
  }

  // 6) basename 兜底：先同目录、再全局（大小写不敏感）
  const base = formats.basename(rel).toLowerCase();
  if (!base) return { row: null, reason: 'file_missing', candidates: [] };
  const parentRel = parentDirOfCloudPath(canonical);
  const parentDirPath = parentRel ? CLOUD_PREFIX + parentRel : '/.cloud';
  const allRows = DB.all(
    'SELECT * FROM web_hosting_files WHERE space_id = ? ORDER BY is_directory DESC, file_path ASC',
    [sid]
  );
  const sameBaseAll = allRows.filter((r) => formats.basename(r.file_path).toLowerCase() === base);
  const inDir = sameBaseAll.filter((r) => {
    const p = parentDirOfCloudPath(r.file_path);
    return (p ? CLOUD_PREFIX + p : '/.cloud') === parentDirPath;
  });
  const pool = inDir.length ? inDir : sameBaseAll;
  if (pool.length === 1) return { row: pool[0], reason: 'ok', candidates: [] };
  if (pool.length > 1) {
    return {
      row: null,
      reason: 'ambiguous',
      candidates: pool.slice(0, 20).map((r) => relCloudPath(r.file_path)),
    };
  }

  // 7) 目录存在但没有同名文件
  return { row: null, reason: 'file_missing', candidates: [] };
}

/** 检查 rel 的所有祖先目录在空间内是否存在（一级文件 / 根目录视为存在）。 */
function cloudAncestorsExist(DB, spaceId, rel) {
  const parts = String(rel).split('/').filter(Boolean);
  if (parts.length <= 1) return true;
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + '/' + parts[i] : parts[i];
    const exists = DB.scalar(
      'SELECT 1 FROM web_hosting_files WHERE space_id = ? AND LOWER(file_path) = LOWER(?) AND is_directory = 1',
      [spaceId, CLOUD_PREFIX + cur]
    );
    if (!exists) return false;
  }
  return true;
}

/** 现有云文件清单（失败提示用，最多 30 条，带目录层级缩进）。 */
function cloudFileInventory(DB, spaceId, limit) {
  const max = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 30;
  const rows = DB.all(
    "SELECT file_path, is_directory FROM web_hosting_files WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND file_path != '/.cloud' ORDER BY file_path ASC",
    [spaceId]
  );
  if (!rows.length) return '（当前数据空间还没有云文件，可用 create_cloud_file 新建）';
  const lines = [];
  let shown = 0;
  for (const r of rows) {
    if (shown >= max) {
      lines.push('…（还有 ' + (rows.length - shown) + ' 条未显示，可用 list_cloud_files 查看全部）');
      break;
    }
    shown++;
    const rel = relCloudPath(r.file_path);
    const depth = rel.split('/').length - 1;
    const isDir = parseInt(r.is_directory, 10) === 1;
    lines.push('  '.repeat(depth) + rel + (isDir ? '/' : ''));
  }
  return lines.join('\n');
}

/** 失败提示里描述「用户想操作的目标」。 */
function cloudTargetDesc(args) {
  const a = args || {};
  const fileId = parseInt(a.file_id ?? 0, 10) || 0;
  if (fileId > 0) return 'file_id=' + fileId;
  const pathArg = a.path ?? a.file_path ?? a.name;
  if (pathArg === undefined || pathArg === null || String(pathArg).trim() === '') {
    return '目标（未提供 file_id 或 path）';
  }
  const cleaned = cleanCloudRelPath(pathArg);
  return cleaned.rel ? CLOUD_PREFIX + cleaned.rel : '目标（路径为空）';
}

/**
 * 统一的、可自救的云文件解析失败结果。
 * 不再出现「不存在或不属于当前用户」这种把「不存在 / 不属于当前空间」混在一起、会误导模型反复 list 的文案。
 * @param {object} DB
 * @param {number} spaceId
 * @param {{reason:string, candidates?:string[]}} resolution
 * @param {string} targetDesc cloudTargetDesc(args) 的结果
 * @returns {{ok:false, summary:string, result:string}}
 */
function cloudResolveFailureResult(DB, spaceId, resolution, targetDesc) {
  const reason = (resolution && resolution.reason) || 'file_missing';
  const candidates = (resolution && resolution.candidates) || [];
  const target = targetDesc || '目标文件';
  const inventory = cloudFileInventory(DB, spaceId, 30);

  if (reason === 'id_not_found') {
    return {
      ok: false,
      summary: '该云文件 ID 不存在',
      result: target + ' 在当前数据空间不存在（可能文件已删除，或 ID 来自其它账号/其它会话）。'
        + '请用 list_cloud_files 获取当前空间最新的 file_id，或改用 path。\n现有文件清单：\n' + inventory,
    };
  }
  if (reason === 'id_other_space') {
    return {
      ok: false,
      summary: '该文件 ID 不属于当前数据空间',
      result: target + ' 确实存在，但属于其他数据空间（不属于当前数据空间 / 不是当前账号可操作的空间），因此不能读写。'
        + '请用 list_cloud_files 获取当前空间的 file_id，或改用 path；不要复用其它账号/其它会话里的文件 ID。\n现有文件清单：\n' + inventory,
    };
  }
  if (reason === 'ambiguous') {
    return {
      ok: false,
      summary: '有多个同名文件，需要更精确的路径',
      result: target + ' 匹配到 ' + candidates.length + ' 个同名文件，无法确定要操作哪一个。'
        + '请改用带目录的完整相对路径（或 file_id）重试，候选：\n'
        + candidates.map((p) => '- ' + p).join('\n'),
    };
  }
  if (reason === 'dir_missing') {
    return {
      ok: false,
      summary: '该目录不存在',
      result: target + ' 所在的目录不存在。create_cloud_file 会自动创建目录；'
        + '如要新建请用 create_cloud_file（directory 可指定新目录）。\n现有文件清单：\n' + inventory,
    };
  }
  return {
    ok: false,
    summary: '该目录存在但没有这个文件',
    result: target + '：该目录存在但没有这个文件。'
      + '如需新建请用 create_cloud_file（会自动创建目录），或 update_cloud_file 并传 create_if_missing=true。'
      + '\n现有文件清单：\n' + inventory,
  };
}


/** 云文件内容的文本化（BLOB / TEXT 都兼容） */
function contentText(content) {
  return formats.parseContentText(content);
}

/**
 * 检测分享占位条目（防御式）。
 *
 * 「分享占位」是其他用户的云文件分享到本空间后生成的影子行：content 为
 * `CSES_CLOUD_SHARE:{...}` 标记文本，代表分享关系而不是真实文件内容。
 * 对它的写操作会破坏分享关系（server/api/cloud-files.js 对占位符是重定向写源文件或直接 403），
 * 因此 AI 工具层一律只读拒绝。
 *
 * 判断规则：content 文本以 `CSES_CLOUD_SHARE:` 开头即视为占位符；
 * 即使标记 JSON 解析失败也按占位符处理（宁可不做，不可误写）。
 *
 * @param {object} row web_hosting_files 行
 * @returns {{sharedFrom:string}|null} null=普通文件；否则 sharedFrom 为分享者用户名（可能为空）
 */
function sharePlaceholderOf(row) {
  if (!row) return null;
  const text = contentText(row.content);
  if (text.indexOf(SHARE_MARKER_PREFIX) !== 0) return null;
  let sharedFrom = '';
  try {
    const cloudShare = require('../../lib/cloud-share');
    const marker = cloudShare.parseMarker(text);
    if (marker) sharedFrom = String(marker.owner_username || '').trim();
  } catch (_) {
    sharedFrom = '';
  }
  return { sharedFrom: sharedFrom };
}

/** 占位条目在前端/AI 展示与拒绝文案里的来源描述 */
function sharePlaceholderLabel(info) {
  const from = info && info.sharedFrom ? String(info.sharedFrom).trim() : '';
  return from ? '分享自 ' + from : '外部分享占位';
}

/** 数据空间用量（口径对齐 data-space.js?action=usage） */
function computeUsage(DB, u, space) {
  const out = { used: 0, quota: 0, percent: 0, web_hosting: 0, instance_storage: 0, versions: 0, history: 0 };
  if (space) {
    const spaceId = space.id;
    out.web_hosting = parseInt(DB.scalar(
      'SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?',
      [spaceId]
    ) ?? 0, 10) || 0;
  }
  if (u.schoolId) {
    out.instance_storage = parseInt(DB.scalar(
      "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM instance_storage_data isd JOIN instances i ON i.id = isd.instance_id WHERE i.school_id = ?",
      [u.schoolId]
    ) ?? 0, 10) || 0;
  }
  if (u.allianceUsername) {
    out.versions = parseInt(DB.scalar(
      'SELECT COALESCE(SUM(LENGTH(content)), 0) FROM cloud_file_versions WHERE created_by = ?',
      [u.allianceUsername]
    ) ?? 0, 10) || 0;
    out.history = parseInt(DB.scalar(
      'SELECT COALESCE(SUM(LENGTH(content_snapshot)), 0) FROM cloud_file_history WHERE created_by = ?',
      [u.allianceUsername]
    ) ?? 0, 10) || 0;
  }
  out.used = out.web_hosting + out.instance_storage + out.versions + out.history;
  out.quota = space ? (parseInt(space.storage_quota || 0, 10) || (10 * 1024 * 1024)) : 0;
  out.percent = out.quota > 0 ? Math.round((out.used / out.quota) * 1000) / 10 : 0;
  return out;
}

/** 配额校验：超出返回错误文案，否则 null */
function quotaProblem(DB, u, space, addBytes) {
  if (!space) return null;
  const usage = computeUsage(DB, u, space);
  if (usage.used + Math.max(0, Number(addBytes) || 0) > usage.quota) {
    return '数据空间配额不足（已用 ' + fmtBytes(usage.used) + ' / ' + fmtBytes(usage.quota) + '）';
  }
  return null;
}

// ────────────────────────────── 配置实例（分发）工具 ──────────────────────────────

/** 解析实例 config JSON */
function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** 生成唯一的 12 位小写字母/数字实例组标识（对齐 distributions.js） */
function generateDirId(DB) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = crypto.randomBytes(12);
    let dirId = '';
    for (let i = 0; i < 12; i++) dirId += DIR_ID_CHARS[bytes[i] % DIR_ID_CHARS.length];
    if (!DB.scalar('SELECT 1 FROM instance_groups WHERE dir_id = ?', [dirId])) return dirId;
  }
  return ('a' + crypto.randomBytes(8).toString('hex')).slice(0, 12);
}

function findDistributionGroup(DB, ownerKey) {
  return DB.one(
    "SELECT * FROM instance_groups WHERE owner_key = ? AND dir_id IS NOT NULL AND dir_id != '' ORDER BY id ASC LIMIT 1",
    [ownerKey]
  );
}

/** 惰性创建 / 获取默认分发实例组（对齐 distributions.js ensureGroup） */
function ensureDistributionGroup(DB, ownerKey, user) {
  const now = nowStr();
  let group = findDistributionGroup(DB, ownerKey);
  if (group) return group;

  const legacy = DB.one(
    "SELECT * FROM instance_groups WHERE owner_key = ? AND name = ? AND (dir_id IS NULL OR dir_id = '') ORDER BY id ASC LIMIT 1",
    [ownerKey, DEFAULT_GROUP_NAME]
  );
  const dirId = generateDirId(DB);
  if (legacy) {
    DB.update('instance_groups', { dir_id: dirId, updated_at: now }, 'id = ?', [legacy.id]);
    group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [legacy.id]);
  } else {
    const id = DB.insert('instance_groups', {
      owner_user_id: (user && user.user_id) ? user.user_id : 0,
      owner_type: (user && user.type) || 'alliance',
      owner_key: ownerKey,
      name: DEFAULT_GROUP_NAME,
      dir_id: dirId,
      sort_order: 0,
      created_at: now,
      updated_at: now,
    });
    group = DB.one('SELECT * FROM instance_groups WHERE id = ?', [id]);
  }
  return group;
}

/** 实例标识清洗（对齐 distributions.js sanitizeInstanceName） */
function sanitizeInstanceName(value) {
  let result = String(value === undefined || value === null ? '' : value);
  result = result.replace(/[\/\\:*?"<>|\x00-\x1F]/g, '-').replace(/\.\./g, '-').replace(/^\.+/, '-').trim();
  while (Buffer.byteLength(result, 'utf8') > 180) result = result.slice(0, -1);
  result = result.trim();
  return result === '' ? 'instance' : result;
}

/** 由文件名生成默认实例标识（去扩展名 + 清洗） */
function defaultInstanceName(filePath) {
  const base = formats.basename(filePath);
  const pos = base.lastIndexOf('.');
  return sanitizeInstanceName(pos > 0 ? base.slice(0, pos) : base);
}

/** 实例标识组内去重 */
function uniqueInstanceName(DB, groupId, baseName) {
  const base = sanitizeInstanceName(baseName || 'instance');
  let candidate = base;
  let counter = 2;
  while (DB.one('SELECT id FROM instances WHERE group_id = ? AND name = ?', [groupId, candidate])) {
    const suffix = '-' + counter;
    let stem = base;
    while (Buffer.byteLength(stem + suffix, 'utf8') > 180) stem = stem.slice(0, -1);
    candidate = stem + suffix;
    counter++;
    if (counter > 9999) {
      candidate = sanitizeInstanceName(base + '-' + crypto.randomBytes(2).toString('hex'));
      break;
    }
  }
  return candidate;
}

/** 组织名称规范化（空值回退默认值） */
function normalizeOrganizationName(value, dirId) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text !== '') return text.slice(0, 200);
  return convert.defaultOrganizationName(dirId);
}

/** 实例状态白名单 */
function normalizeInstanceStatus(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (s === 'running' || s === 'stopped') return s;
  return null;
}

/** 源文件（web_hosting_files）→ 实例格式信息 */
function formatInfoOfInstance(row) {
  return formats.formatOfApp(row.app_key) || formats.getFormatInfo('classisland');
}

/**
 * 生成实例公开地址（base_url 由 ctx.req 推导，缺失时用相对路径）。
 * @returns {{kind:string, manifest?:string, file_template?:string, source?:string}|null}
 */
function instanceUrlsOf(ctx, row, group) {
  const dirId = group && group.dir_id ? group.dir_id : '';
  if (!dirId) return null;
  let baseUrl = '';
  try {
    if (ctx && ctx.req) {
      const { baseUrlFromRequest } = require('../../lib/static-control-public');
      baseUrl = baseUrlFromRequest(ctx.req);
    }
  } catch (_) { /* 无请求上下文时退化为相对地址 */ }

  const info = formatInfoOfInstance(row);
  if (info && info.mode === 'static') {
    const classislandApp = require('../../apps/classisland');
    return classislandApp.urls(baseUrl, dirId);
  }
  const fileId = parseInt(row.source_file_id ?? 0, 10) || 0;
  let ext = '';
  if (fileId) {
    const file = dbOf(ctx).one('SELECT file_path FROM web_hosting_files WHERE id = ?', [fileId]);
    if (file) ext = formats.extOfPath(file.file_path);
  }
  if (!ext) ext = parseConfig(row.config).ext || '';
  return { kind: 'url', source: formats.rawConfigUrl(baseUrl, dirId, row.name, ext) };
}

// ────────────────────────────── 工具定义 ──────────────────────────────

/** 空参数 JSON Schema */
const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false };

/** 网页空间定位参数（space_id / slug 二选一；都省略时用当前账号的默认空间） */
const WEB_SPACE_REF_PROPS = {
  space_id: { type: 'number', description: '网页空间 ID（list_web_spaces 返回）；省略则用默认空间' },
  slug: { type: 'string', description: '网页空间 slug（访问地址 /site/{slug}/ 中的一段）' },
};

/** 全部工具定义（按 spec §3 顺序）。hasEditor 控制浏览器端编辑器工具是否下发。 */
function buildDefinitions(hasEditor) {
  const defs = [
    // ── server / read ──
    {
      name: 'get_user_info',
      label: '读取用户信息',
      scope: 'server',
      risk: 'read',
      description: '获取当前登录账号的信息：显示名、角色、所有者标识、云文件数量与总大小、实例数量、数据空间已用/配额。',
      parameters: NO_PARAMS,
    },
    {
      name: 'list_cloud_files',
      label: '列出云文件',
      scope: 'server',
      risk: 'read',
      description: '列出当前用户在轻编辑器 `/.cloud/` 目录下的云文件（含子目录、大小、类型、是否已被配置实例分发）。',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: '相对 `/.cloud/` 的目录路径，如 "sub" 或 "/"；省略表示整个云文件目录（递归）' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'read_cloud_file',
      label: '读取云文件',
      scope: 'server',
      risk: 'read',
      description: '读取云文件的文本内容（超过 8000 字符会截断）。可用 file_id 或 path（如 "高二课表.yml"）定位。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'number', description: '云文件 ID（list_cloud_files 返回）' },
          path: { type: 'string', description: '相对 `/.cloud/` 的路径或文件名' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'list_instances',
      label: '列出配置实例',
      scope: 'server',
      risk: 'read',
      description: '列出当前用户的配置实例（ClassIsland / CSES / ExamAware 分发），含名称、类型、源文件、状态与公开地址。',
      parameters: NO_PARAMS,
    },
    {
      name: 'get_dataspace_info',
      label: '读取数据空间',
      scope: 'server',
      risk: 'read',
      description: '查看数据空间的文件树概览与用量（云文件、网页空间、版本历史、操作记录）。',
      parameters: NO_PARAMS,
    },
    // ── server / read（网页空间） ──
    {
      name: 'list_web_spaces',
      label: '列出网页空间',
      scope: 'server',
      risk: 'read',
      description: '列出当前账号的网页空间（id / slug / 标题 / 文件数与总大小 / 是否启用 / 审查状态 / 访问地址）。',
      parameters: NO_PARAMS,
    },
    {
      name: 'list_web_space_files',
      label: '列出网页空间文件',
      scope: 'server',
      risk: 'read',
      description: '列出指定网页空间的文件树（路径 / 是否目录 / 大小 / 更新时间 / 审查状态）。省略 space_id/slug 时使用默认空间。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS),
        additionalProperties: false,
      },
    },
    {
      name: 'read_web_space_file',
      label: '读取网页空间文件',
      scope: 'server',
      risk: 'read',
      description: '读取网页空间里的文本文件内容（二进制文件会拒绝；超过 200KB 截断）。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS, {
          path: { type: 'string', description: '网页空间内的文件路径，如 /index.html' },
        }),
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_web_space_preview_url',
      label: '获取网页预览地址',
      scope: 'server',
      risk: 'read',
      description: '返回网页空间/某个文件的公开访问地址与预览地址（预览地址会显示待审查的最新草稿）。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS, {
          path: { type: 'string', description: '文件路径；省略表示站点根路径 /' },
        }),
        additionalProperties: false,
      },
    },
    // ── server / write ──
    {
      name: 'create_cloud_file',
      label: '创建云文件',
      scope: 'server',
      risk: 'write',
      description: '在轻编辑器云文件目录中新建文本文件；目录不存在会自动创建；文件名不带扩展名时补 .txt。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名（可含中文，不能含 / \\ : * ? " < > |）' },
          directory: { type: 'string', description: '相对 `/.cloud/` 的目录，默认根目录' },
          content: { type: 'string', description: '文件内容，默认空' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'update_cloud_file',
      label: '保存云文件',
      scope: 'server',
      risk: 'write',
      description: '用新内容覆盖云文件（可用 file_id 或 path 定位，路径写法宽容）。文件不存在时可传 create_if_missing=true 新建。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'number', description: '云文件 ID' },
          path: { type: 'string', description: '相对 `/.cloud/` 的路径或文件名' },
          content: { type: 'string', description: '新的完整文件内容' },
          create_if_missing: {
            type: 'boolean',
            description: '默认 false；为 true 且文件不存在时按 create_cloud_file 语义新建（要求目录已存在）',
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
    {
      name: 'rename_cloud_file',
      label: '重命名云文件',
      scope: 'server',
      risk: 'write',
      description: '重命名云文件或云目录（目录会连同子孙路径一起改名）。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'number', description: '云文件 ID' },
          path: { type: 'string', description: '相对 `/.cloud/` 的路径或文件名' },
          new_name: { type: 'string', description: '新名称（不含路径）' },
        },
        required: ['new_name'],
        additionalProperties: false,
      },
    },
    {
      name: 'delete_cloud_file',
      label: '删除云文件',
      scope: 'server',
      risk: 'write',
      description: '删除云文件（目录会递归删除其下全部文件）。若文件已被配置实例引用，实例会因此失效。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'number', description: '云文件 ID' },
          path: { type: 'string', description: '相对 `/.cloud/` 的路径或文件名' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'create_instance',
      label: '创建配置实例',
      scope: 'server',
      risk: 'write',
      description: '把一个可分发的云配置文件（ClassIsland 档案 / CSES 配置 / ExamAware 配置）创建为配置实例并生成公开地址。',
      parameters: {
        type: 'object',
        properties: {
          file_id: { type: 'number', description: '源云文件 ID' },
          path: { type: 'string', description: '源云文件路径或文件名' },
          name: { type: 'string', description: '实例标识（组内唯一，可含中文，不能含 / \\ : * ? " < > | 或 ..）；省略则按文件名自动生成' },
          organization_name: { type: 'string', description: '组织名称（显示在集控清单/页面），省略用默认值' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'update_instance',
      label: '更新配置实例',
      scope: 'server',
      risk: 'write',
      description: '修改配置实例的实例标识、组织名称或运行状态。',
      parameters: {
        type: 'object',
        properties: {
          instance_id: { type: 'number', description: '配置实例 ID' },
          name: { type: 'string', description: '新的实例标识（组内唯一）' },
          organization_name: { type: 'string', description: '新的组织名称' },
          status: { type: 'string', enum: ['running', 'stopped'], description: '运行状态' },
        },
        required: ['instance_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'delete_instance',
      label: '删除配置实例',
      scope: 'server',
      risk: 'write',
      description: '删除配置实例（不会删除源云文件）。',
      parameters: {
        type: 'object',
        properties: {
          instance_id: { type: 'number', description: '配置实例 ID' },
        },
        required: ['instance_id'],
        additionalProperties: false,
      },
    },
    // ── 会话 ──
    {
      name: 'set_session_title',
      label: '修改对话标题',
      scope: 'server',
      risk: 'write',
      description: '把当前对话的标题改成更贴合内容的短标题（不超过 16 个中文字符）。'
        + '当用户明确要求改名，或对话主题已经明显切换（例如从「看课表」转到「发布网页」）时主动调用；'
        + '普通追问、同一主题的继续讨论不要频繁改标题。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '新的对话标题：简洁、抓住主题关键词，不超过 16 个中文字符，不要带引号或标点结尾',
          },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    // ── server / write（网页空间） ──
    {
      name: 'create_web_space',
      label: '创建网页空间',
      scope: 'server',
      risk: 'write',
      description: '为当前账号新建一个网页空间（独立站点），返回空间 id/slug 与访问地址 /site/{slug}/。'
        + '之后用 write_web_space_file 写入页面。**不要猜测不存在的 slug**：要发布到新站点就先调用本工具创建。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '空间名称（显示在控制台），如「汇率计算器」' },
          slug: { type: 'string', description: '可选：访问路径 /site/{slug}/ 中的一段，仅小写字母/数字/连字符；省略时自动生成' },
          description: { type: 'string', description: '可选：空间描述' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    {
      name: 'update_web_space',
      label: '修改网页空间',
      scope: 'server',
      risk: 'write',
      description: '修改网页空间的名称、描述或启用状态（不会改 slug）。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS, {
          title: { type: 'string', description: '新的空间名称' },
          description: { type: 'string', description: '新的描述' },
          enabled: { type: 'boolean', description: '是否启用该空间（false=关闭访问）' },
        }),
        additionalProperties: false,
      },
    },
    {
      name: 'write_web_space_file',
      label: '写入网页空间文件',
      scope: 'server',
      risk: 'write',
      description: '创建或覆盖网页空间里的文本文件。写入后文件与空间都会进入待审查（pending_review）状态，'
        + '公开页在管理员审核通过前仍显示上一次已发布版本；不能写 /.published 目录。'
        + '单次 content 建议不超过 4000 字符，大文件请分文件写或分次覆盖。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS, {
          path: { type: 'string', description: '网页空间内的文件路径，如 /index.html 或 /css/style.css' },
          content: { type: 'string', description: '完整的文件内容（文本）' },
          create: { type: 'boolean', description: '默认 true；为 false 时仅允许覆盖已有文件' },
        }),
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'delete_web_space_file',
      label: '删除网页空间文件',
      scope: 'server',
      risk: 'write',
      description: '删除网页空间里的文件；目标是目录时必须显式传 recursive=true 才会递归删除。/.published 目录由审核流程维护，不能用此工具删除。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS, {
          path: { type: 'string', description: '要删除的文件或目录路径' },
          recursive: { type: 'boolean', description: '目标是目录时需显式传 true 才会递归删除' },
        }),
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'publish_cloud_file',
      label: '发布云文件到网页空间',
      scope: 'server',
      risk: 'write',
      description: '把云文件（`/.cloud/` 下）的内容复制到网页空间的指定路径，常用于把 index.html 发布成站点。'
        + '走与网页空间写文件相同的审核流程（pending_review）。',
      parameters: {
        type: 'object',
        properties: Object.assign({}, WEB_SPACE_REF_PROPS, {
          file_id: { type: 'number', description: '云文件 ID' },
          path: { type: 'string', description: '云文件路径或文件名（与 file_id 二选一）' },
          target_path: { type: 'string', description: '网页空间内的目标路径，默认 /<云文件名>' },
        }),
        additionalProperties: false,
      },
    },
  ];

  // ── client / read + write（浏览器端执行，需要编辑器就绪） ──
  if (hasEditor) {
    defs.push(
      {
        name: 'get_editor_state',
        label: '读取编辑器状态',
        scope: 'client',
        risk: 'read',
        description: '读取当前轻编辑器状态：打开的标签、当前文件、语言、选区、脏状态、当前面板。',
        parameters: NO_PARAMS,
      },
      {
        name: 'read_editor_elements',
        label: '读取编辑器元素',
        scope: 'client',
        risk: 'read',
        description: '读取编辑器可见界面元素：文件树条目、Ribbon 工具组、右侧面板标题、按钮文案。',
        parameters: NO_PARAMS,
      },
      {
        name: 'screenshot_editor',
        label: '截图编辑器',
        scope: 'client',
        risk: 'read',
        description: '截取当前编辑器区域并返回图片地址，用于视觉确认。',
        parameters: NO_PARAMS,
      },
      {
        name: 'operate_editor',
        label: '操作编辑器',
        scope: 'client',
        risk: 'write',
        description: '在浏览器里操作轻编辑器：打开文件、切换/关闭标签、插入或替换文本、整体替换内容、保存、切换面板、跳转行、执行 Ribbon 工具。',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['open_file', 'switch_tab', 'close_tab', 'insert_text', 'replace_selection', 'set_content', 'save', 'set_panel', 'goto_line', 'run_ribbon'],
              description: '要执行的动作',
            },
            name: { type: 'string', description: '文件名 / 标签名 / Ribbon 工具名（按动作决定）' },
            path: { type: 'string', description: '云文件相对路径（open_file 可用）' },
            tab: { type: 'string', description: '标签名（switch_tab / close_tab）' },
            content: { type: 'string', description: '完整内容（set_content）' },
            text: { type: 'string', description: '插入/替换的文本（insert_text / replace_selection）' },
            panel: { type: 'string', description: '面板标识（set_panel）' },
            line: { type: 'number', description: '行号，从 1 开始（goto_line）' },
            tool: { type: 'string', description: 'Ribbon 工具标识（run_ribbon）' },
          },
          required: ['action'],
          additionalProperties: true,
        },
      }
    );
  }

  // ── meta：向用户提问 ──
  defs.push({
    name: 'ask_user',
    label: '向用户提问',
    scope: 'client',
    risk: 'read',
    description: '当需要用户做选择或补充信息时，向用户展示提问卡并等待回答。单选题用户点击即回答；多选题需要点提交。',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '要提出的问题（1 个或多个）',
          items: {
            type: 'object',
            properties: {
              header: { type: 'string', description: '问题的小标题（可选）' },
              question: { type: 'string', description: '问题正文' },
              multiSelect: { type: 'boolean', description: '是否多选，默认 false' },
              options: {
                type: 'array',
                description: '选项列表',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: '选项文案' },
                    description: { type: 'string', description: '选项补充说明（可选）' },
                  },
                  required: ['label'],
                },
              },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
  });

  return defs;
}

/** 工具名 → 前端展示标签 */
const LABELS = (function () {
  const map = {};
  for (const def of buildDefinitions(true)) map[def.name] = def.label;
  return map;
})();

/** 客户端工具名集合（agent.js 用其判断需要浏览器执行） */
const CLIENT_TOOL_NAMES = new Set([
  'get_editor_state', 'read_editor_elements', 'screenshot_editor', 'operate_editor', 'ask_user',
]);

/**
 * 返回工具定义列表。
 * @param {{hasEditor?: boolean}} [opts] hasEditor=false 时不下发编辑器类客户端工具（ask_user 始终保留）
 * @returns {Array<{name:string,label:string,scope:'server'|'client',risk:'read'|'write',description:string,parameters:object}>}
 */
function definitions(opts) {
  const hasEditor = !(opts && opts.hasEditor === false);
  return buildDefinitions(hasEditor);
}

/** 工具名 → 展示标签 */
function labelOf(name) {
  return LABELS[name] || String(name || '工具');
}

// ────────────────────────────── server / read 实现 ──────────────────────────────

/** 当前用户的云文件统计 */
function cloudFileStats(DB, space) {
  if (!space) return { count: 0, bytes: 0 };
  const row = DB.one(
    "SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM web_hosting_files WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND is_directory = 0",
    [space.id]
  ) || { n: 0, bytes: 0 };
  return { count: parseInt(row.n, 10) || 0, bytes: parseInt(row.bytes, 10) || 0 };
}

async function toolGetUserInfo(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const space = findDataSpace(DB, u.allianceUsername);
  const usage = computeUsage(DB, u, space);
  const files = cloudFileStats(DB, space);

  const ownedInstances = u.ownerKey
    ? (parseInt(DB.scalar('SELECT COUNT(*) FROM instances WHERE owner_key = ?', [u.ownerKey]) ?? 0, 10) || 0)
    : 0;
  const configInstances = u.ownerKey
    ? (parseInt(DB.scalar(
      'SELECT COUNT(*) FROM instances WHERE owner_key = ? AND app_key IN (' + APP_KEYS.map(() => '?').join(',') + ')',
      [u.ownerKey, ...APP_KEYS]
    ) ?? 0, 10) || 0)
    : 0;
  const schoolInstances = u.schoolId
    ? (parseInt(DB.scalar('SELECT COUNT(*) FROM instances WHERE school_id = ?', [u.schoolId]) ?? 0, 10) || 0)
    : 0;
  const sessionCount = u.ownerKey
    ? (parseInt(DB.scalar('SELECT COUNT(*) FROM ai_chat_sessions WHERE owner_key = ?', [u.ownerKey]) ?? 0, 10) || 0)
    : 0;

  const lines = [
    '显示名：' + u.displayName,
    '角色：' + roleLabel(u.role) + (u.type ? '（' + u.type + '）' : ''),
    '账号：' + (u.user.username || u.allianceUsername || '未知'),
    'owner_key：' + (u.ownerKey || '（未登录）'),
    '学校 ID：' + (u.schoolId || '—'),
    '云文件：' + files.count + ' 个 / ' + fmtBytes(files.bytes)
      + (u.allianceUsername ? '' : '（当前账户没有智教联盟云文件空间）'),
  ];
  if (space) {
    lines.push('数据空间：' + fmtBytes(usage.used) + ' / ' + fmtBytes(usage.quota) + '（' + usage.percent + '%）');
    lines.push('  ├ 网页空间/云文件：' + fmtBytes(usage.web_hosting));
    lines.push('  ├ 实例存储：' + fmtBytes(usage.instance_storage));
    lines.push('  ├ 版本历史：' + fmtBytes(usage.versions));
    lines.push('  └ 操作记录：' + fmtBytes(usage.history));
  } else {
    lines.push('数据空间：未开通（仅智教联盟账户拥有数据空间）');
  }
  lines.push('实例：名下 ' + ownedInstances + ' 个（其中配置实例 ' + configInstances + ' 个）；本校 ' + schoolInstances + ' 个');
  lines.push('AI 会话数：' + sessionCount);

  return {
    ok: true,
    summary: u.displayName + ' · ' + roleLabel(u.role) + ' · 云文件 ' + files.count + ' 个 · 配置实例 ' + configInstances + ' 个',
    result: lines.join('\n'),
  };
}

async function toolListCloudFiles(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件空间', result: '轻编辑器云文件仅对智教联盟账户开放（需要联盟登录）。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) {
    return { ok: true, summary: '暂无云文件', result: '当前账户还没有数据空间或云文件。' };
  }
  const dir = normalizeCloudDir((args || {}).directory);
  if (dir === null) {
    return { ok: false, summary: '目录路径不合法', result: '目录只能是 `/.cloud/` 下的相对路径，且不能包含 / \\ : * ? " < > | 或 ..' };
  }
  if (dir !== '') {
    const dirPath = CLOUD_PREFIX + dir;
    const exists = DB.scalar(
      'SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1',
      [space.id, dirPath]
    );
    if (!exists) {
      return { ok: false, summary: '目录不存在：' + dir, result: '请先用 list_cloud_files 查看现有目录结构。' };
    }
  }

  const prefix = dir ? CLOUD_PREFIX + dir + '/' : CLOUD_PREFIX;
  const rows = DB.all(
    `SELECT id, file_path, file_size, content_type, is_directory, updated_at,
            (typeof(content) = 'text' AND content LIKE 'CSES_CLOUD_SHARE:%') AS is_share_placeholder
     FROM web_hosting_files
     WHERE space_id = ? AND file_path LIKE ? AND file_path != ?
     ORDER BY is_directory DESC, file_path ASC`,
    [space.id, prefix + '%', '/.cloud']
  );

  // 分享占位条目：仅对标记行回查完整 content 以解析分享者名称（避免把大文件内容带进列表）
  const placeholderInfo = new Map();
  const placeholderIds = rows
    .filter((r) => parseInt(r.is_share_placeholder, 10) === 1)
    .map((r) => parseInt(r.id, 10) || 0)
    .filter(Boolean);
  if (placeholderIds.length) {
    const marked = DB.all(
      `SELECT id, content FROM web_hosting_files
       WHERE space_id = ? AND id IN (${placeholderIds.map(() => '?').join(',')})`,
      [space.id, ...placeholderIds]
    );
    for (const m of marked) {
      // 已按前缀命中；解析失败也按占位符处理（sharePlaceholderOf 返回 { sharedFrom: '' }）
      placeholderInfo.set(parseInt(m.id, 10) || 0, sharePlaceholderOf(m) || { sharedFrom: '' });
    }
  }

  // 已分发统计：source_file_id → 引用实例数
  const distMap = new Map();
  const fileIds = rows
    .filter((r) => parseInt(r.is_directory, 10) !== 1 && parseInt(r.is_share_placeholder, 10) !== 1)
    .map((r) => parseInt(r.id, 10) || 0)
    .filter(Boolean);
  if (fileIds.length) {
    const rows2 = DB.all(
      `SELECT source_file_id, COUNT(*) AS n FROM instances
       WHERE owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})
         AND source_file_id IN (${fileIds.map(() => '?').join(',')})
       GROUP BY source_file_id`,
      [u.ownerKey, ...APP_KEYS, ...fileIds]
    );
    for (const r of rows2) distMap.set(parseInt(r.source_file_id, 10) || 0, parseInt(r.n, 10) || 0);
  }

  const lines = [];
  let totalBytes = 0;
  let shown = 0;
  let placeholderCount = 0;
  for (const row of rows) {
    if (shown >= MAX_LIST_ITEMS) {
      lines.push('…（还有 ' + (rows.length - shown) + ' 项未显示）');
      break;
    }
    shown++;
    const rel = relCloudPath(row.file_path);
    const isDir = parseInt(row.is_directory, 10) === 1;
    if (isDir) {
      lines.push('[dir id=' + row.id + '] ' + rel + '/');
      continue;
    }
    // 分享占位条目：只读影子行，明确标注来源，不参与大小/已分发统计
    const phInfo = placeholderInfo.get(parseInt(row.id, 10) || 0);
    if (phInfo) {
      placeholderCount++;
      lines.push('[id=' + row.id + '] ' + rel + '（' + sharePlaceholderLabel(phInfo) + '）');
      continue;
    }
    const size = parseInt(row.file_size, 10) || 0;
    totalBytes += size;
    const ext = fileExt(row.file_path) || '—';
    const dist = distMap.get(parseInt(row.id, 10) || 0) || 0;
    lines.push(
      '[id=' + row.id + '] ' + rel + '（' + fmtBytes(size) + '，' + ext + (dist ? '，已分发×' + dist : '') + '）'
    );
  }

  const where = dir ? '目录 ' + dir : '根目录';
  const placeholderNote = placeholderCount > 0 ? '，其中 ' + placeholderCount + ' 个分享占位（只读）' : '';
  return {
    ok: true,
    summary: '云文件 ' + rows.length + ' 项 / ' + fmtBytes(totalBytes) + '（' + where + '）' + placeholderNote,
    result: lines.length ? lines.join('\n') : '（空）',
  };
}

async function toolReadCloudFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件空间', result: '轻编辑器云文件仅对智教联盟账户开放。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) return { ok: false, summary: '云文件不存在', result: '当前账户还没有数据空间。' };

  const resolution = resolveCloudFile(DB, space.id, args);
  if (resolution.reason !== 'ok') {
    return cloudResolveFailureResult(DB, space.id, resolution, cloudTargetDesc(args));
  }
  const row = resolution.row;
  const rel = relCloudPath(row.file_path);
  if (parseInt(row.is_directory, 10) === 1) {
    return { ok: false, summary: '目标是一个目录：' + rel, result: '请用 list_cloud_files 指定 directory 查看目录内容。' };
  }
  // 分享占位条目：只是分享关系的影子行，不读取（权限语义复杂，交给轻编辑器）
  const sharePlaceholder = sharePlaceholderOf(row);
  if (sharePlaceholder) {
    return {
      ok: false,
      summary: '这是分享占位条目，无法直接读取',
      result: '这是其他用户分享的占位条目，请让用户在轻编辑器里打开后操作/复制为副本。',
    };
  }
  const text = contentText(row.content);
  const bytes = parseInt(row.file_size, 10) || Buffer.byteLength(text, 'utf8');
  return {
    ok: true,
    summary: '已读取 ' + rel + '（' + fmtBytes(bytes) + '）',
    result: clipText(text, MAX_READ_CHARS) || '（空文件）',
  };
}

async function toolListInstances(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.ownerKey) {
    return { ok: false, summary: '无法确定当前用户身份', result: '缺少 ownerKey，无法查询配置实例。' };
  }
  const rows = DB.all(
    `SELECT i.*, g.name AS group_name, g.dir_id AS group_dir_id
     FROM instances i
     LEFT JOIN instance_groups g ON g.id = i.group_id
     WHERE i.owner_key = ? AND i.app_key IN (${APP_KEYS.map(() => '?').join(',')})
     ORDER BY i.id ASC`,
    [u.ownerKey, ...APP_KEYS]
  );
  if (!rows.length) {
    return { ok: true, summary: '暂无配置实例', result: '当前账户还没有配置实例。可用 create_instance 从云文件创建。' };
  }

  const fileCache = new Map();
  const lines = [];
  let dirId = '';
  for (const row of rows) {
    const info = formatInfoOfInstance(row);
    const group = { dir_id: row.group_dir_id || '' };
    if (!dirId && group.dir_id) dirId = group.dir_id;
    const fileId = parseInt(row.source_file_id ?? 0, 10) || 0;
    let fileName = '';
    if (fileId) {
      if (!fileCache.has(fileId)) {
        fileCache.set(fileId, DB.one('SELECT file_path FROM web_hosting_files WHERE id = ?', [fileId]));
      }
      const file = fileCache.get(fileId);
      fileName = file ? formats.basename(file.file_path) : '';
    }
    const cfg = parseConfig(row.config);
    const urls = instanceUrlsOf(ctx, row, group);
    const urlText = urls ? (urls.manifest || urls.source || '') : '';
    lines.push(
      '# ' + row.id + ' 「' + row.name + '」'
      + '｜' + (info ? info.label : (row.app_key || '未知类型'))
      + '｜源文件 ' + (fileName || (fileId ? '（已缺失）' : '（未关联）'))
      + '｜状态 ' + (row.status || 'running')
      + '｜组织 ' + (cfg.organization_name || '—')
      + (urlText ? '｜地址 ' + urlText : '')
    );
  }

  return {
    ok: true,
    summary: '配置实例 ' + rows.length + ' 个' + (dirId ? '（实例组 dir_id=' + dirId + '）' : ''),
    result: lines.join('\n'),
  };
}

async function toolGetDataspaceInfo(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有数据空间', result: '数据空间仅对智教联盟账户开放（需要联盟登录）。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) {
    return { ok: true, summary: '数据空间未开通', result: '当前联盟账户还没有数据空间；创建云文件后会自动开通。' };
  }
  const usage = computeUsage(DB, u, space);

  // 云文件
  const cloudRows = DB.all(
    "SELECT id, file_path, file_size, is_directory FROM web_hosting_files WHERE space_id = ? AND file_path LIKE '/.cloud/%' AND file_path != '/.cloud' ORDER BY is_directory DESC, file_path ASC",
    [space.id]
  );
  // 网页空间
  const webSpaces = DB.all(
    'SELECT id, title, slug FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1 ORDER BY id ASC',
    [u.allianceUsername]
  );
  // 版本历史 / 操作记录
  const versionRow = DB.one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS bytes FROM cloud_file_versions WHERE created_by = ?',
    [u.allianceUsername]
  ) || { n: 0, bytes: 0 };
  const historyRow = DB.one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content_snapshot)), 0) AS bytes FROM cloud_file_history WHERE created_by = ?',
    [u.allianceUsername]
  ) || { n: 0, bytes: 0 };

  const lines = [
    '用量：' + fmtBytes(usage.used) + ' / ' + fmtBytes(usage.quota) + '（' + usage.percent + '%）',
    '├─ 云文件（' + cloudRows.length + ' 项）',
  ];
  let shown = 0;
  for (const row of cloudRows) {
    if (shown >= 30) { lines.push('│  …（还有 ' + (cloudRows.length - shown) + ' 项）'); break; }
    shown++;
    const isDir = parseInt(row.is_directory, 10) === 1;
    lines.push('│  ├ ' + relCloudPath(row.file_path) + (isDir ? '/' : '（' + fmtBytes(row.file_size) + '）'));
  }
  if (!cloudRows.length) lines.push('│  └ （空）');

  lines.push('├─ 网页空间（' + webSpaces.length + ' 个）');
  for (const ws of webSpaces) {
    const fileRow = DB.one(
      'SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM web_hosting_files WHERE space_id = ? AND is_directory = 0',
      [ws.id]
    ) || { n: 0, bytes: 0 };
    lines.push('│  ├ ' + (ws.title || ws.slug) + '（' + (parseInt(fileRow.n, 10) || 0) + ' 文件 / ' + fmtBytes(fileRow.bytes) + '）');
  }
  if (!webSpaces.length) lines.push('│  └ （无）');

  lines.push('├─ 版本历史：' + (parseInt(versionRow.n, 10) || 0) + ' 条 / ' + fmtBytes(versionRow.bytes));
  lines.push('└─ 操作记录：' + (parseInt(historyRow.n, 10) || 0) + ' 条 / ' + fmtBytes(historyRow.bytes));

  return {
    ok: true,
    summary: '数据空间 ' + fmtBytes(usage.used) + ' / ' + fmtBytes(usage.quota) + '（' + usage.percent + '%）',
    result: lines.join('\n'),
  };
}

// ────────────────────────────── server / write 实现 ──────────────────────────────

async function toolCreateCloudFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件空间', result: '轻编辑器云文件仅对智教联盟账户开放。' };
  }
  let name = String(a.name ?? '').trim();
  if (name === '') return { ok: false, summary: '文件名不能为空', result: '请提供 name。' };
  if (!name.includes('.')) name += '.txt';
  if (!validCloudName(name)) {
    return { ok: false, summary: '文件名不合法', result: '文件名不能包含 / \\ : * ? " < > | 等字符，且不能是 . 或 ..' };
  }
  const dir = normalizeCloudDir(a.directory);
  if (dir === null) return { ok: false, summary: '目录路径不合法', result: '目录只能是 `/.cloud/` 下的相对路径。' };

  const now = nowStr();
  const space = ensureDataSpace(DB, u.allianceUsername, now);
  const path = cloudPathFor(name, dir);
  const exists = DB.one('SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?', [space.id, path]);
  if (exists) {
    return { ok: false, summary: '同名文件已存在：' + relCloudPath(path), result: '请换一个文件名，或用 update_cloud_file 覆盖已有文件。' };
  }
  const content = a.content === undefined || a.content === null ? '' : String(a.content);
  const bytes = Buffer.byteLength(content, 'utf8');
  const quotaErr = quotaProblem(DB, u, space, bytes);
  if (quotaErr) return { ok: false, summary: quotaErr, result: '请先清理数据空间后再创建文件。' };

  ensureCloudRoot(DB, space.id, now);
  ensureCloudDirs(DB, space.id, dir, now);

  const id = DB.insert('web_hosting_files', {
    space_id: space.id,
    file_path: path,
    file_size: bytes,
    content_type: guessCloudContentType(name),
    content: content,
    is_directory: 0,
    created_at: now,
    updated_at: now,
  });
  audit(ctx, 'cloud_file_create', 'AI 创建云文件: ' + u.allianceUsername + ' -> ' + path);

  return {
    ok: true,
    summary: '已创建云文件 ' + relCloudPath(path) + '（' + fmtBytes(bytes) + '）',
    result: 'id=' + id + '\npath=' + relCloudPath(path) + '\nsize=' + bytes + ' B',
    patch: { refresh: 'cloud-files' },
  };
}

/**
 * update_cloud_file 的 create_if_missing 分支：按 create_cloud_file 语义新建文件
 * （同样的名称/目录校验、同名冲突检查与配额检查）。
 * @returns {{id:number, rel:string, bytes:number}|{error:string, detail?:string}}
 */
function createCloudFileForUpdate(DB, u, space, args, ctx) {
  const a = args || {};
  const pathArg = a.path ?? a.file_path ?? a.name;
  if (pathArg === undefined || pathArg === null || String(pathArg).trim() === '') {
    return { error: 'create_if_missing 需要 path', detail: '只给了 file_id 时无法推断新文件名，请改用 path 指定文件路径。' };
  }
  const cleaned = cleanCloudRelPath(pathArg);
  if (!cleaned.valid || cleaned.rel === '') {
    return { error: '目标路径不合法', detail: '路径不能包含 / \\ : * ? " < > | 等字符，也不能包含 ..。' };
  }
  const rel = cleaned.rel;
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');
  if (!validCloudName(name)) {
    return { error: '文件名不合法', detail: '文件名不能包含 / \\ : * ? " < > | 等字符，且不能是 . 或 ..' };
  }
  const path = CLOUD_PREFIX + rel;
  if (DB.scalar('SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ?', [space.id, path])) {
    return { error: '同名文件已存在', detail: '该路径已有同名文件，请直接更新（去掉 create_if_missing）或换一个文件名。' };
  }
  const content = a.content === undefined || a.content === null ? '' : String(a.content);
  const bytes = Buffer.byteLength(content, 'utf8');
  const quotaErr = quotaProblem(DB, u, space, bytes);
  if (quotaErr) return { error: quotaErr, detail: '请先清理数据空间后再保存。' };

  const now = nowStr();
  ensureCloudRoot(DB, space.id, now);
  ensureCloudDirs(DB, space.id, dir, now);
  const id = DB.insert('web_hosting_files', {
    space_id: space.id,
    file_path: path,
    file_size: bytes,
    content_type: guessCloudContentType(name),
    content: content,
    is_directory: 0,
    created_at: now,
    updated_at: now,
  });
  audit(ctx, 'cloud_file_create', 'AI 创建云文件(create_if_missing): ' + u.allianceUsername + ' -> ' + path);
  return { id: id, rel: rel, bytes: bytes };
}

async function toolUpdateCloudFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件空间', result: '轻编辑器云文件仅对智教联盟账户开放。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) return { ok: false, summary: '云文件不存在', result: '当前账户还没有数据空间。' };
  const resolution = resolveCloudFile(DB, space.id, a);
  let row = resolution.reason === 'ok' ? resolution.row : null;

  // create_if_missing：仅在「目录存在但没有这个文件」时按 create_cloud_file 语义新建，
  // 歧义 / 目录缺失等情况仍要求模型先澄清（避免瞎猜路径）。
  if (!row && a.create_if_missing === true && resolution.reason === 'file_missing') {
    const created = createCloudFileForUpdate(DB, u, space, a, ctx);
    if (created.error) {
      return { ok: false, summary: created.error, result: created.detail || '' };
    }
    return {
      ok: true,
      summary: '原文件不存在，已新建并写入 ' + created.rel + '（' + fmtBytes(created.bytes) + '）',
      result: 'id=' + created.id + '\npath=' + created.rel + '\nsize=' + created.bytes
        + ' B\n（create_if_missing=true：原文件不存在，已按 create_cloud_file 语义新建）',
      patch: { refresh: 'cloud-files' },
    };
  }
  if (!row) {
    return cloudResolveFailureResult(DB, space.id, resolution, cloudTargetDesc(a));
  }
  const rel = relCloudPath(row.file_path);
  if (parseInt(row.is_directory, 10) === 1) {
    return { ok: false, summary: '目标是一个目录：' + rel, result: 'update_cloud_file 只能写入文件。' };
  }
  // 分享占位条目：写入会覆盖标记、破坏分享关系，一律拒绝
  if (sharePlaceholderOf(row)) {
    return {
      ok: false,
      summary: '分享占位条目不支持 AI 写入',
      result: '这是其他用户分享的占位条目，写入会破坏分享关系；请让用户在轻编辑器中打开分享源文件修改，或先复制为副本再改。',
    };
  }
  if (a.content === undefined || a.content === null) {
    return { ok: false, summary: '缺少 content', result: '请提供要写入的完整文件内容。' };
  }
  const content = String(a.content);
  const bytes = Buffer.byteLength(content, 'utf8');
  const oldBytes = parseInt(row.file_size, 10) || 0;
  const quotaErr = quotaProblem(DB, u, space, bytes - oldBytes);
  if (quotaErr) return { ok: false, summary: quotaErr, result: '请先清理数据空间后再保存。' };

  DB.update('web_hosting_files', {
    content: content,
    file_size: bytes,
    updated_at: nowStr(),
  }, 'id = ?', [row.id]);
  audit(ctx, 'cloud_file_update', 'AI 保存云文件: ' + u.allianceUsername + ' -> ' + rel);

  return {
    ok: true,
    summary: '已保存 ' + rel + '（' + fmtBytes(bytes) + '）',
    result: 'id=' + row.id + '\npath=' + rel + '\nsize=' + bytes + ' B',
    patch: { refresh: 'cloud-files' },
  };
}

async function toolRenameCloudFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件空间', result: '轻编辑器云文件仅对智教联盟账户开放。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) return { ok: false, summary: '云文件不存在', result: '当前账户还没有数据空间。' };
  const resolution = resolveCloudFile(DB, space.id, a);
  if (resolution.reason !== 'ok') {
    return cloudResolveFailureResult(DB, space.id, resolution, cloudTargetDesc(a));
  }
  const row = resolution.row;

  // 分享占位条目：重命名会破坏分享关系，一律拒绝
  if (sharePlaceholderOf(row)) {
    return {
      ok: false,
      summary: '分享占位条目不支持 AI 重命名',
      result: '这是其他用户分享的占位条目，重命名会破坏分享关系；请在轻编辑器中操作。',
    };
  }

  const newName = String(a.new_name ?? '').trim();
  if (newName === '') return { ok: false, summary: '新名称不能为空', result: '请提供 new_name。' };
  if (!validCloudName(newName)) {
    return { ok: false, summary: '新名称不合法', result: '名称不能包含 / \\ : * ? " < > | 等字符，且不能是 . 或 ..' };
  }

  const isDir = parseInt(row.is_directory, 10) === 1;
  const oldPath = row.file_path;
  const dir = parentDirOfCloudPath(oldPath);
  const newPath = cloudPathFor(newName, dir);
  const now = nowStr();
  if (newPath !== oldPath) {
    const conflict = DB.one(
      'SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND id != ?',
      [space.id, newPath, row.id]
    );
    if (conflict) return { ok: false, summary: '同名' + (isDir ? '目录' : '文件') + '已存在', result: '请换一个名称。' };

    if (isDir) {
      const children = DB.all(
        'SELECT id, file_path FROM web_hosting_files WHERE space_id = ? AND file_path LIKE ?',
        [space.id, oldPath + '/%']
      );
      DB.update('web_hosting_files', { file_path: newPath, content_type: null, updated_at: now }, 'id = ?', [row.id]);
      for (const child of children) {
        DB.update('web_hosting_files', {
          file_path: newPath + child.file_path.slice(oldPath.length),
          updated_at: now,
        }, 'id = ?', [child.id]);
      }
    } else {
      DB.update('web_hosting_files', {
        file_path: newPath,
        content_type: guessCloudContentType(newName),
        updated_at: now,
      }, 'id = ?', [row.id]);
    }
  }
  audit(ctx, 'cloud_file_rename', 'AI 重命名云文件: ' + u.allianceUsername + ' -> ' + newPath);

  return {
    ok: true,
    summary: '已重命名 ' + relCloudPath(oldPath) + ' → ' + relCloudPath(newPath),
    result: 'id=' + row.id + '\npath=' + relCloudPath(newPath),
    patch: { refresh: 'cloud-files' },
  };
}

async function toolDeleteCloudFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件空间', result: '轻编辑器云文件仅对智教联盟账户开放。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) return { ok: false, summary: '云文件不存在', result: '当前账户还没有数据空间。' };
  const resolution = resolveCloudFile(DB, space.id, args);
  if (resolution.reason !== 'ok') {
    return cloudResolveFailureResult(DB, space.id, resolution, cloudTargetDesc(args));
  }
  const row = resolution.row;

  // 分享占位条目：删除会破坏分享关系（cloud-files.js 同样拒绝），一律拒绝
  if (sharePlaceholderOf(row)) {
    return {
      ok: false,
      summary: '分享占位条目不支持 AI 删除',
      result: '这是其他用户分享的占位条目，删除会破坏分享关系；请在轻编辑器中操作。',
    };
  }

  const rel = relCloudPath(row.file_path);
  const isDir = parseInt(row.is_directory, 10) === 1;
  // 引用该文件的配置实例（删除后这些实例会失效，仅提示不阻断）
  const fileIds = isDir
    ? DB.all(
      'SELECT id FROM web_hosting_files WHERE space_id = ? AND is_directory = 0 AND (file_path = ? OR file_path LIKE ?)',
      [space.id, row.file_path, row.file_path + '/%']
    ).map((r) => parseInt(r.id, 10) || 0).filter(Boolean)
    : [parseInt(row.id, 10) || 0];
  let referenced = 0;
  if (fileIds.length) {
    referenced = parseInt(DB.scalar(
      `SELECT COUNT(*) FROM instances WHERE owner_key = ? AND source_file_id IN (${fileIds.map(() => '?').join(',')})`,
      [u.ownerKey, ...fileIds]
    ) ?? 0, 10) || 0;
  }

  if (isDir) {
    DB.delete('web_hosting_files', 'space_id = ? AND (file_path = ? OR file_path LIKE ?)', [
      space.id, row.file_path, row.file_path + '/%',
    ]);
  } else {
    DB.delete('web_hosting_files', 'id = ?', [row.id]);
  }
  audit(ctx, 'cloud_file_delete', 'AI 删除云文件: ' + u.allianceUsername + ' -> ' + rel);

  const warning = referenced > 0 ? '\n注意：有 ' + referenced + ' 个配置实例引用该' + (isDir ? '目录' : '文件') + '，删除后它们将失效。' : '';
  return {
    ok: true,
    summary: '已删除 ' + rel + (isDir ? '（目录及内容）' : ''),
    result: 'path=' + rel + warning,
    patch: { refresh: 'cloud-files' },
  };
}

async function toolCreateInstance(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '创建配置实例需要智教联盟账户', result: '源文件必须来自当前用户的 `/.cloud/` 云文件目录。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) return { ok: false, summary: '云文件不存在', result: '当前账户还没有数据空间。' };
  const resolution = resolveCloudFile(DB, space.id, a);
  if (resolution.reason !== 'ok') {
    return cloudResolveFailureResult(DB, space.id, resolution, cloudTargetDesc(a));
  }
  const file = resolution.row;
  if (parseInt(file.is_directory, 10) === 1) {
    return { ok: false, summary: '源文件必须是文件而不是目录', result: '请选择一个配置文件（.json / .yml / .ea2 等）。' };
  }
  if (String(file.file_path || '').indexOf(CLOUD_PREFIX) !== 0) {
    return { ok: false, summary: '源文件必须是轻编辑器云文件', result: '源文件需位于当前用户 `/.cloud/` 目录下。' };
  }
  // 分享占位条目不能作为分发源文件（内容是分享标记而不是真实配置）
  if (sharePlaceholderOf(file)) {
    return {
      ok: false,
      summary: '源文件是分享占位条目',
      result: '这是其他用户分享的占位条目，不能作为配置实例的源文件；请让用户先复制为副本，或使用自己创建的配置文件。',
    };
  }

  const validation = formats.validateContent(file.content, file.file_path);
  if (!validation.ok) {
    return { ok: false, summary: '源文件不是可分发配置', result: validation.error || '无法识别配置格式。' };
  }
  const info = validation.formatInfo;
  const group = ensureDistributionGroup(DB, u.ownerKey, u.user);
  const now = nowStr();

  let instanceName;
  const explicit = a.name !== undefined && a.name !== null && String(a.name).trim() !== '';
  if (explicit) {
    instanceName = String(a.name).trim();
    if (!convert.validInstanceId(instanceName)) {
      return { ok: false, summary: '实例标识不合法', result: '不能包含 / \\ : * ? " < > |、不能包含 .. 且不能以 . 开头。' };
    }
    const duplicate = DB.one('SELECT id, name FROM instances WHERE group_id = ? AND name = ?', [group.id, instanceName]);
    if (duplicate) {
      return {
        ok: false,
        summary: '实例标识「' + instanceName + '」已存在',
        result: '请修改实例标识，或用 update_instance 更新现有实例（id=' + duplicate.id + '）。',
      };
    }
  } else {
    instanceName = uniqueInstanceName(DB, group.id, defaultInstanceName(file.file_path));
  }

  const organizationName = normalizeOrganizationName(a.organization_name, group.dir_id);
  const instanceUid = 'inst-' + crypto.randomBytes(6).toString('hex');
  const fileName = formats.basename(file.file_path);
  const ext = formats.extOfPath(file.file_path);
  const config = {
    format: validation.format,
    app_key: info.appKey,
    organization_name: organizationName,
    file_name: fileName,
    ext: ext || '',
  };

  const id = DB.insert('instances', {
    school_id: resolveSchoolId(DB, u, space),
    app_id: null,
    app_key: info.appKey,
    name: instanceName,
    service_type: info.label,
    status: 'running',
    owner_user_id: u.userId,
    owner_type: u.type || 'alliance',
    owner_key: u.ownerKey,
    instance_uid: instanceUid,
    group_id: group.id,
    source_file_id: file.id,
    config: JSON.stringify(config),
    created_at: now,
    updated_at: now,
  });
  DB.update('instance_groups', { updated_at: now }, 'id = ?', [group.id]);
  audit(ctx, 'distribution_create', 'AI 创建' + info.label + '实例 ' + instanceName + '（源文件 ' + file.file_path + '）');

  const row = DB.one('SELECT * FROM instances WHERE id = ?', [id]);
  const urls = instanceUrlsOf(ctx, row, group);
  const urlText = urls ? (urls.manifest || urls.source || '') : '';
  const lines = [
    'id=' + id,
    '实例标识=' + instanceName,
    '格式=' + info.label + '（' + validation.format + '）',
    '源文件=' + relCloudPath(file.file_path),
    '组织名称=' + organizationName,
    '实例组 dir_id=' + group.dir_id,
  ];
  if (urlText) lines.push('公开地址=' + urlText);
  if (validation.warnings && validation.warnings.length) lines.push('提示：' + validation.warnings.join('；'));

  return {
    ok: true,
    summary: '已创建' + info.label + '实例「' + instanceName + '」',
    result: lines.join('\n'),
    patch: { refresh: 'instances' },
  };
}

async function toolUpdateInstance(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  const id = parseInt(a.instance_id ?? 0, 10) || 0;
  if (!id) return { ok: false, summary: '缺少实例实例 ID', result: '请提供 instance_id（可用 list_instances 查询）。' };
  if (!u.ownerKey) return { ok: false, summary: '无法确定当前用户身份', result: '缺少 ownerKey。' };

  const row = DB.one(
    `SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})`,
    [id, u.ownerKey, ...APP_KEYS]
  );
  if (!row) return { ok: false, summary: '配置实例不存在或无权修改', result: '只能用当前账户自己的配置实例。' };
  const group = DB.one('SELECT * FROM instance_groups WHERE id = ? AND owner_key = ?', [row.group_id, u.ownerKey]);
  if (!group) return { ok: false, summary: '配置实例所属实例组不存在', result: '请重新创建分发。' };

  const updates = {};
  const config = parseConfig(row.config);
  let changed = false;

  if (a.name !== undefined && a.name !== null && String(a.name).trim() !== '') {
    const nextName = String(a.name).trim();
    if (nextName !== row.name) {
      if (!convert.validInstanceId(nextName)) {
        return { ok: false, summary: '实例标识不合法', result: '不能包含 / \\ : * ? " < > |、不能包含 .. 且不能以 . 开头。' };
      }
      const duplicate = DB.one(
        'SELECT id, name FROM instances WHERE group_id = ? AND name = ? AND id != ?',
        [group.id, nextName, id]
      );
      if (duplicate) {
        return { ok: false, summary: '实例标识「' + nextName + '」已被占用', result: '请使用其他名称（占用者 id=' + duplicate.id + '）。' };
      }
      updates.name = nextName;
      changed = true;
    }
  }

  if (a.organization_name !== undefined) {
    const nextOrg = normalizeOrganizationName(a.organization_name, group.dir_id);
    if (nextOrg !== config.organization_name) {
      config.organization_name = nextOrg;
      changed = true;
    }
  }

  if (a.status !== undefined) {
    const nextStatus = normalizeInstanceStatus(a.status);
    if (!nextStatus) return { ok: false, summary: '状态不合法', result: 'status 只能是 running 或 stopped。' };
    if (nextStatus !== row.status) {
      updates.status = nextStatus;
      changed = true;
    }
  }

  if (!changed) {
    return { ok: true, summary: '配置实例未变化', result: '没有需要更新的字段（实例标识/组织名称/状态均未改变）。' };
  }

  const now = nowStr();
  updates.config = JSON.stringify(config);
  updates.updated_at = now;
  DB.update('instances', updates, 'id = ? AND owner_key = ?', [id, u.ownerKey]);
  DB.update('instance_groups', { updated_at: now }, 'id = ?', [group.id]);
  audit(ctx, 'distribution_update', 'AI 更新配置实例 ' + (updates.name || row.name) + '（id=' + id + '）');

  const updated = DB.one('SELECT * FROM instances WHERE id = ?', [id]);
  const urls = instanceUrlsOf(ctx, updated, group);
  const urlText = urls ? (urls.manifest || urls.source || '') : '';
  const lines = [
    'id=' + id,
    '实例标识=' + updated.name,
    '组织名称=' + config.organization_name,
    '状态=' + (updated.status || 'running'),
  ];
  if (urlText) lines.push('公开地址=' + urlText);

  return {
    ok: true,
    summary: '已更新配置实例「' + updated.name + '」',
    result: lines.join('\n'),
    patch: { refresh: 'instances' },
  };
}

async function toolDeleteInstance(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  const id = parseInt(a.instance_id ?? 0, 10) || 0;
  if (!id) return { ok: false, summary: '缺少实例 ID', result: '请提供 instance_id（可用 list_instances 查询）。' };
  if (!u.ownerKey) return { ok: false, summary: '无法确定当前用户身份', result: '缺少 ownerKey。' };

  const row = DB.one(
    `SELECT * FROM instances WHERE id = ? AND owner_key = ? AND app_key IN (${APP_KEYS.map(() => '?').join(',')})`,
    [id, u.ownerKey, ...APP_KEYS]
  );
  if (!row) return { ok: false, summary: '配置实例不存在或无权删除', result: '只能用当前账户自己的配置实例。' };

  DB.delete('instances', 'id = ? AND owner_key = ?', [id, u.ownerKey]);
  if (row.group_id) DB.update('instance_groups', { updated_at: nowStr() }, 'id = ?', [row.group_id]);
  audit(ctx, 'distribution_delete', 'AI 删除配置实例 ' + row.name + '（id=' + id + '）');

  return {
    ok: true,
    summary: '已删除配置实例「' + row.name + '」',
    result: 'id=' + id + '\n源云文件未删除。',
    patch: { refresh: 'instances' },
  };
}

// ────────────────────────────── 网页空间（web hosting）工具 ──────────────────────────────

/** 已公开版本目录（审核流程维护，AI 不可写/不可删） */
const WEB_PUBLISHED_PREFIX = '/.published';
/** 网页空间文本文件读取上限（字节） */
const WEB_MAX_READ_BYTES = 200 * 1024;

/** 网页空间路径归一化（对齐 server/api/web-hosting.js#normalizePath） */
function normalizeWebPath(input) {
  let s = String(input === undefined || input === null ? '' : input).trim();
  if (s === '') return '/';
  s = s.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (s[0] !== '/') s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s;
}

/** 网页空间路径安全检查；返回错误文案，空串表示通过。 */
function webPathProblem(filePath, opts) {
  const p = String(filePath === undefined || filePath === null ? '/' : filePath);
  const o = opts || {};
  if (p === '/' && o.allowRoot !== true) return '不能对根路径 / 执行该操作，请指定文件路径';
  if (p.split('/').some((seg) => seg === '..')) return '路径不能包含 ..（防止越出网页空间）';
  if (/[\x00-\x1F]/.test(p)) return '路径包含非法控制字符';
  if (o.writable === true && (p === WEB_PUBLISHED_PREFIX || p.indexOf(WEB_PUBLISHED_PREFIX + '/') === 0)) {
    return '已公开版本（/.published）文件不可编辑，仅可查看或删除';
  }
  return '';
}

/** 列出账号名下的全部空间（网页空间 + 数据空间/班级主页），按 id 升序。 */
function userWebSpaces(DB, username) {
  return DB.all('SELECT * FROM web_hosting_spaces WHERE alliance_username = ? ORDER BY id ASC', [username]);
}

/**
 * 解析目标网页空间：space_id / slug 二选一，都省略时取默认空间（id 最小的那个，语义等价于
 * web-hosting.js#ensureSpace 取到的第一行）。
 * @returns {{space:object|null, reason:'ok'|'not_found'|'other_user'|'no_space', spaces:object[]}}
 */
function resolveWebSpace(DB, username, args) {
  const spaces = userWebSpaces(DB, username || '');
  const a = args || {};
  const spaceId = parseInt(a.space_id ?? 0, 10) || 0;
  const slug = String(a.slug ?? '').trim();

  if (spaceId > 0) {
    const hit = spaces.find((s) => (parseInt(s.id, 10) || 0) === spaceId);
    if (hit) return { space: hit, reason: 'ok', spaces: spaces };
    const other = DB.one('SELECT id FROM web_hosting_spaces WHERE id = ?', [spaceId]);
    return { space: null, reason: other ? 'other_user' : 'not_found', spaces: spaces };
  }
  if (slug !== '') {
    const hit = spaces.find((s) => String(s.slug || '').toLowerCase() === slug.toLowerCase());
    if (hit) return { space: hit, reason: 'ok', spaces: spaces };
    const other = DB.one('SELECT id FROM web_hosting_spaces WHERE LOWER(slug) = LOWER(?)', [slug]);
    return { space: null, reason: other ? 'other_user' : 'not_found', spaces: spaces };
  }
  if (!spaces.length) return { space: null, reason: 'no_space', spaces: spaces };
  return { space: spaces[0], reason: 'ok', spaces: spaces };
}

/** 网页空间解析失败的可自救结果（区分「不存在」与「不属于当前账号」）。 */
function webSpaceResolveFailure(resolution, targetDesc) {
  const reason = (resolution && resolution.reason) || 'not_found';
  const spaces = (resolution && resolution.spaces) || [];
  const target = targetDesc || '目标网页空间';
  const list = spaces.length
    ? spaces.map((s) => '- id=' + s.id + ' slug=' + s.slug + ' 「' + (s.title || s.slug) + '」（'
      + (parseInt(s.is_web_space, 10) === 1 ? '网页空间' : '数据空间/班级主页') + '）').join('\n')
    : '（当前账号还没有任何网页空间）';

  if (reason === 'other_user') {
    return {
      ok: false,
      summary: '该网页空间不属于当前账号',
      result: target + ' 存在，但属于其他账号的网页空间，不能读写。\n当前账号的空间：\n' + list,
    };
  }
  if (reason === 'not_found') {
    return {
      ok: false,
      summary: '网页空间不存在',
      result: target + ' 不存在（id/slug 可能有误，或空间已被删除）。\n当前账号的空间：\n' + list,
    };
  }
  return {
    ok: false,
    summary: '当前账号还没有网页空间',
    result: '当前账号还没有网页空间。请先在控制台「网页空间」里创建，或让用户确认要操作哪个空间。\n当前账号的空间：\n' + list,
  };
}

/** 写操作前的空间状态检查（is_enabled / disabled_by_admin）。 */
function webSpaceWriteProblem(space) {
  if (!space) return '网页空间不存在';
  if (parseInt(space.disabled_by_admin, 10) === 1) {
    return '该网页空间已被管理员停用（' + (space.disabled_reason || '违反相关规定') + '），不能写入。';
  }
  if (parseInt(space.is_enabled, 10) === 0) {
    return '该网页空间的「启用」开关处于关闭状态（is_enabled=0），请用户先在控制台启用后再写入。';
  }
  return '';
}

/** 网页空间内父目录路径。 */
function parentWebDir(filePath) {
  const s = String(filePath || '').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  if (i <= 0) return '/';
  return s.slice(0, i);
}

/** 递归确保网页空间目录存在（对齐 web-hosting.js#ensureDirectoryExists）。 */
function ensureWebParentDirs(DB, spaceId, dirPath, now) {
  const p = normalizeWebPath(dirPath);
  if (p === '/') return;
  const exists = DB.scalar(
    'SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1',
    [spaceId, p]
  );
  if (!exists) {
    const parent = parentWebDir(p);
    if (parent && parent !== '/') ensureWebParentDirs(DB, spaceId, parent, now);
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: p,
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

/** 现有网页空间文件清单（失败提示用，最多 30 条）。 */
function webFileInventory(DB, spaceId, limit) {
  const max = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 30;
  const rows = DB.all(
    "SELECT file_path, is_directory FROM web_hosting_files WHERE space_id = ? AND file_path NOT LIKE '/.published%' ORDER BY file_path ASC",
    [spaceId]
  );
  if (!rows.length) return '（该网页空间还没有文件，可用 write_web_space_file 新建）';
  const lines = [];
  let shown = 0;
  for (const r of rows) {
    if (shown >= max) {
      lines.push('…（还有 ' + (rows.length - shown) + ' 条未显示，可用 list_web_space_files 查看全部）');
      break;
    }
    shown++;
    const depth = String(r.file_path).split('/').filter(Boolean).length - 1;
    lines.push('  '.repeat(depth) + r.file_path + (parseInt(r.is_directory, 10) === 1 ? '/' : ''));
  }
  return lines.join('\n');
}

/** 生成网页空间的访问 / 预览地址（base 地址由 ctx.req 推导，缺失时用相对路径）。 */
function siteUrls(ctx, space, filePath) {
  let baseUrl = '';
  try {
    if (ctx && ctx.req) {
      const { baseUrlFromRequest } = require('../../lib/static-control-public');
      baseUrl = baseUrlFromRequest(ctx.req);
    }
  } catch (_) { /* 无请求上下文时退化为相对地址 */ }
  const slug = String(space && space.slug ? space.slug : '');
  const clean = normalizeWebPath(filePath);
  const suffix = clean === '/' ? '' : clean.replace(/^\/+/, '');
  const publicUrl = baseUrl + '/site/' + encodeURIComponent(slug) + '/' + suffix;
  const previewUrl = publicUrl + '?preview=1';
  return { public: publicUrl, preview: previewUrl, slug: slug };
}

/**
 * 把文本转成可用的 slug 片段（只保留 ASCII 字母数字；纯中文标题会返回空串，由调用方兜底）
 */
function slugifyAscii(text) {
  const s = String(text === undefined || text === null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 32);
}

/** 生成一个未被占用的空间 slug */
function ensureUniqueSpaceSlug(DB, base) {
  const seed = String(base || '').trim().toLowerCase();
  let root = /^[a-z0-9][a-z0-9-]{1,31}$/.test(seed) ? seed : 'site';
  let candidate = root;
  let n = 1;
  while (DB.scalar('SELECT 1 FROM web_hosting_spaces WHERE LOWER(slug) = LOWER(?)', [candidate])) {
    n += 1;
    candidate = root + '-' + n;
    if (n > 200) {
      candidate = root + '-' + Date.now().toString(36);
      break;
    }
  }
  return candidate;
}

/**
 * 创建网页空间（AI 需要「新建站点」时使用；避免模型去猜一个不存在的 slug）
 */
async function toolCreateWebSpace(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '创建网页空间需要智教联盟账户', result: '请用智教联盟账号登录后再创建网页空间。' };
  }

  const title = String(a.title === undefined || a.title === null ? '' : a.title).trim();
  if (title === '') return { ok: false, summary: '空间名称不能为空', result: '请提供 title（空间名称，如「汇率计算器」）。' };
  if (Array.from(title).length > 40) {
    return { ok: false, summary: '空间名称过长', result: 'title 请控制在 40 个字符以内。' };
  }

  let slug = String(a.slug === undefined || a.slug === null ? '' : a.slug).trim().toLowerCase();
  if (slug !== '') {
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(slug)) {
      return {
        ok: false,
        summary: 'slug 不合法',
        result: 'slug 只能由小写字母、数字、连字符组成，长度 2-32，且不能以连字符开头（例如 fx-rate）。',
      };
    }
    const dup = DB.one('SELECT id, alliance_username FROM web_hosting_spaces WHERE LOWER(slug) = ?', [slug]);
    if (dup) {
      const mine = String(dup.alliance_username || '') === u.allianceUsername;
      return {
        ok: false,
        summary: 'slug 已被占用：' + slug,
        result: mine
          ? '你名下已有该 slug 的空间，可直接用 list_web_spaces 查看并写入文件，或换一个 slug。'
          : '该 slug 属于其他账号，请换一个 slug。',
      };
    }
  } else {
    slug = ensureUniqueSpaceSlug(DB, slugifyAscii(title) || u.allianceUsername);
  }

  const now = nowStr();
  const spaceId = DB.insert('web_hosting_spaces', {
    alliance_username: u.allianceUsername,
    slug: slug,
    title: title,
    description: String(a.description === undefined || a.description === null ? '' : a.description).trim(),
    storage_quota: 100 * 1024 * 1024,
    is_enabled: 1,
    is_web_space: 1,
    review_status: 'published',
    created_at: now,
    updated_at: now,
  });
  const space = DB.one('SELECT * FROM web_hosting_spaces WHERE id = ?', [spaceId]);

  // 默认 index.html（与 web-hosting.js#ensureSpace 一致：直接可用，不走待审）
  const indexHtml = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>' + title.replace(/[<>&]/g, '') + '</title>\n</head>\n'
    + '<body style="font-family:system-ui,sans-serif;padding:40px">\n'
    + '  <h1>' + title.replace(/[<>&]/g, '') + '</h1>\n'
    + '  <p>这个页面还没有内容。可以让 AI 用 write_web_space_file 写入 /index.html。</p>\n'
    + '</body>\n</html>\n';
  try {
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/index.html',
      file_size: Buffer.byteLength(indexHtml, 'utf8'),
      content_type: 'text/html',
      content: indexHtml,
      published_content: indexHtml,
      published_size: Buffer.byteLength(indexHtml, 'utf8'),
      review_status: 'published',
      is_directory: 0,
      created_at: now,
      updated_at: now,
    });
  } catch (_) { /* 默认首页失败不影响空间创建 */ }

  const urls = siteUrls(ctx, space, '/');
  audit(ctx, 'web_hosting_create', 'AI 创建网页空间: ' + u.allianceUsername + ' -> ' + slug);

  return {
    ok: true,
    summary: '已创建网页空间「' + title + '」（slug=' + slug + '）',
    result: 'id=' + spaceId + '\nslug=' + slug + '\n访问地址=' + urls.public,
    patch: { refresh: 'web-space' },
  };
}

/**
 * 修改网页空间（名称 / 描述 / 启用状态）
 */
async function toolUpdateWebSpace(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放。' };
  }
  const resolution = resolveWebSpace(DB, u.allianceUsername, a);
  if (resolution.reason !== 'ok') {
    return webSpaceResolveFailure(resolution, (a.space_id || a.slug) ? 'space_id=' + (a.space_id || '-') + ' slug=' + (a.slug || '-') : '默认网页空间');
  }
  const space = resolution.space;

  const data = {};
  const changed = [];
  if ('title' in a) {
    const title = String(a.title === undefined || a.title === null ? '' : a.title).trim();
    if (title === '') return { ok: false, summary: '空间名称不能为空', result: '请提供非空 title。' };
    data.title = title;
    changed.push('名称→' + title);
  }
  if ('description' in a) {
    data.description = String(a.description === undefined || a.description === null ? '' : a.description).trim();
    changed.push('描述已更新');
  }
  if ('enabled' in a) {
    const enabled = !!(a.enabled === true || a.enabled === 1 || a.enabled === 'true' || a.enabled === '1');
    data.is_enabled = enabled ? 1 : 0;
    changed.push(enabled ? '已启用' : '已关闭');
  }
  if (!changed.length) {
    return { ok: false, summary: '没有要修改的内容', result: '请至少提供 title / description / enabled 之一。' };
  }
  data.updated_at = nowStr();
  DB.update('web_hosting_spaces', data, 'id = ?', [space.id]);
  audit(ctx, 'web_hosting_update', 'AI 修改网页空间: ' + u.allianceUsername + ' -> ' + space.slug);
  return {
    ok: true,
    summary: '已更新网页空间「' + (data.title || space.title || space.slug) + '」：' + changed.join('，'),
    result: 'id=' + space.id + '\nslug=' + space.slug,
    patch: { refresh: 'web-space' },
  };
}

/**
 * 保存网页空间文件（创建或覆盖）。
 *
 * 严格对齐 server/api/web-hosting.js#saveFile 的审查语义，不绕过审核：
 *   - 写入后文件 review_status 一律置 pending_review；
 *   - 不改动 published_content / published_size（那是管理员审核通过时的动作）；
 *   - 同时把 web_hosting_spaces.review_status 置 pending_review；
 *   - 禁止写 /.published 目录、禁止写根路径；
 *   - 配额口径与 save-file 一致（更新已有文件时先减去原大小）。
 *
 * @returns {{ok:boolean, summary:string, result:string, patch?:object, path?:string, isNew?:boolean, urls?:object}}
 */
function saveWebFile(ctx, DB, u, space, filePathRaw, content, options) {
  const opts = options || {};
  const filePath = normalizeWebPath(filePathRaw);
  const pathProblem = webPathProblem(filePath, { writable: true });
  if (pathProblem) return { ok: false, summary: '路径不可写入', result: pathProblem };

  const contentValue = content === undefined || content === null ? '' : String(content);
  const contentSize = Buffer.byteLength(contentValue, 'utf8');
  const existing = DB.one(
    'SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ?',
    [space.id, filePath]
  );
  if (existing && parseInt(existing.is_directory, 10) === 1) {
    return { ok: false, summary: '目标路径是目录', result: filePath + ' 是一个目录，不能写入文件内容；请换一个文件路径。' };
  }
  if (!existing && opts.create === false) {
    return { ok: false, summary: '文件不存在且未允许新建', result: filePath + ' 不存在；如需新建请传 create=true。' };
  }

  const quota = parseInt(space.storage_quota || 0, 10) || 0;
  let used = parseInt(DB.scalar(
    'SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files WHERE space_id = ?',
    [space.id]
  ) ?? 0, 10) || 0;
  if (existing) used -= (parseInt(existing.file_size, 10) || 0);
  if (quota > 0 && used + contentSize > quota) {
    return {
      ok: false,
      summary: '网页空间配额不足',
      result: '网页空间储存不足（已用 ' + fmtBytes(used) + ' / ' + fmtBytes(quota) + '），请先清理文件后重试。',
    };
  }

  const now = nowStr();
  const contentType = guessCloudContentType(filePath);
  if (existing) {
    // 对齐 save-file：只改内容 + 置待审，绝不触碰 published_content / published_size
    DB.update('web_hosting_files', {
      file_size: contentSize,
      content_type: contentType,
      content: contentValue,
      review_status: 'pending_review',
      updated_at: now,
    }, 'space_id = ? AND file_path = ?', [space.id, filePath]);
  } else {
    const parent = parentWebDir(filePath);
    if (parent && parent !== '/') ensureWebParentDirs(DB, space.id, parent, now);
    DB.insert('web_hosting_files', {
      space_id: space.id,
      file_path: filePath,
      file_size: contentSize,
      content_type: contentType,
      content: contentValue,
      is_directory: 0,
      review_status: 'pending_review',
      created_at: now,
      updated_at: now,
    });
  }
  // 对齐 save-file：空间整体置为待审查
  DB.update('web_hosting_spaces', { review_status: 'pending_review', updated_at: now }, 'id = ?', [space.id]);
  audit(ctx, existing ? 'web_hosting_update_file' : 'web_hosting_create_file',
    'AI ' + (existing ? '更新' : '创建') + '网页空间文件: ' + u.allianceUsername + filePath);

  const urls = siteUrls(ctx, space, filePath);
  return {
    ok: true,
    summary: (existing ? '已保存（待审查）' : '已创建（待审查）') + ' ' + filePath,
    result: [
      'path=' + filePath,
      'size=' + contentSize + ' B',
      'review_status=pending_review（管理员审核通过前，公开页仍显示上一次已发布版本）',
      'public_url=' + urls.public,
      'preview_url=' + urls.preview,
    ].join('\n'),
    patch: { refresh: 'web-space' },
    path: filePath,
    isNew: !existing,
    urls: urls,
  };
}

// ── 网页空间工具实现 ──

async function toolListWebSpaces(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放（需要联盟登录）。' };
  }
  const spaces = userWebSpaces(DB, u.allianceUsername);
  if (!spaces.length) {
    return { ok: true, summary: '当前账号还没有网页空间', result: '当前账号还没有网页空间（可在控制台「网页空间」里创建）。' };
  }
  const lines = [];
  for (const s of spaces) {
    const fileRow = DB.one(
      'SELECT COUNT(*) AS n, COALESCE(SUM(file_size), 0) AS bytes FROM web_hosting_files WHERE space_id = ? AND is_directory = 0',
      [s.id]
    ) || { n: 0, bytes: 0 };
    const pending = parseInt(DB.scalar(
      "SELECT COUNT(*) FROM web_hosting_files WHERE space_id = ? AND review_status = 'pending_review' AND is_directory = 0",
      [s.id]
    ) ?? 0, 10) || 0;
    const urls = siteUrls(ctx, s, '/');
    lines.push(
      '#' + s.id + ' 「' + (s.title || s.slug) + '」 slug=' + s.slug
      + '｜' + (parseInt(s.is_web_space, 10) === 1 ? '网页空间' : '数据空间/班级主页')
      + '｜文件 ' + (parseInt(fileRow.n, 10) || 0) + ' 个 / ' + fmtBytes(fileRow.bytes)
      + '｜' + (parseInt(s.is_enabled, 10) === 0 ? '已关闭' : '已启用')
      + (parseInt(s.disabled_by_admin, 10) === 1 ? '｜被管理员停用' : '')
      + '｜审查 ' + (s.review_status || 'published') + (pending ? '（待审 ' + pending + '）' : '')
      + '｜' + urls.public
    );
  }
  return {
    ok: true,
    summary: '网页空间 ' + spaces.length + ' 个',
    result: lines.join('\n'),
  };
}

async function toolListWebSpaceFiles(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放。' };
  }
  const resolution = resolveWebSpace(DB, u.allianceUsername, args);
  if (resolution.reason !== 'ok') {
    return webSpaceResolveFailure(resolution, (args && (args.space_id || args.slug))
      ? 'space_id=' + (args.space_id || '-') + ' slug=' + (args.slug || '-')
      : '默认网页空间');
  }
  const space = resolution.space;
  const rows = DB.all(
    "SELECT id, file_path, file_size, content_type, is_directory, review_status, updated_at FROM web_hosting_files WHERE space_id = ? AND file_path NOT LIKE '/.published%' ORDER BY file_path ASC",
    [space.id]
  );
  const lines = [];
  let totalBytes = 0;
  let pending = 0;
  let shown = 0;
  for (const r of rows) {
    if (shown >= MAX_LIST_ITEMS) {
      lines.push('…（还有 ' + (rows.length - shown) + ' 项未显示）');
      break;
    }
    shown++;
    const p = String(r.file_path);
    const depth = p.split('/').filter(Boolean).length - 1;
    const indent = '  '.repeat(depth);
    const isDir = parseInt(r.is_directory, 10) === 1;
    if (isDir) {
      lines.push(indent + p + '/');
      continue;
    }
    totalBytes += parseInt(r.file_size, 10) || 0;
    if ((r.review_status || 'published') === 'pending_review') pending++;
    lines.push(indent + p + '（' + fmtBytes(r.file_size) + '，' + (fileExt(p) || '—') + '，' + (r.review_status || 'published') + '）');
  }
  const urls = siteUrls(ctx, space, '/');
  return {
    ok: true,
    summary: '网页空间「' + (space.title || space.slug) + '」：' + rows.length + ' 项 / ' + fmtBytes(totalBytes)
      + (pending ? '（待审 ' + pending + '）' : ''),
    result: 'space_id=' + space.id + ' slug=' + space.slug + ' 访问地址=' + urls.public + '\n'
      + (lines.length ? lines.join('\n') : '（空）'),
  };
}

async function toolReadWebSpaceFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放。' };
  }
  const pathProblem = webPathProblem(normalizeWebPath(a.path), {});
  const resolution = resolveWebSpace(DB, u.allianceUsername, a);
  if (resolution.reason !== 'ok') {
    return webSpaceResolveFailure(resolution, (a.space_id || a.slug) ? 'space_id=' + (a.space_id || '-') + ' slug=' + (a.slug || '-') : '默认网页空间');
  }
  const space = resolution.space;
  const filePath = normalizeWebPath(a.path);
  if (pathProblem) return { ok: false, summary: '路径不合法', result: pathProblem };

  const row = DB.one(
    'SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ?',
    [space.id, filePath]
  );
  if (!row) {
    return {
      ok: false,
      summary: '网页空间里没有这个文件',
      result: filePath + ' 不存在。如需新建请用 write_web_space_file；'
        + '如是路径写法问题，可从下面的现有文件清单里复制路径。\n现有文件清单：\n' + webFileInventory(DB, space.id, 30),
    };
  }
  if (parseInt(row.is_directory, 10) === 1) {
    return { ok: false, summary: '目标是一个目录', result: filePath + ' 是目录，请用 list_web_space_files 查看目录内容。' };
  }

  const contentType = String(row.content_type || '');
  const ext = fileExt(filePath);
  const textLike = /^(text\/|application\/(javascript|json|xml)|image\/svg)/i.test(contentType)
    || ['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'markdown', 'xml', 'yaml', 'yml', 'csv', 'svg', 'cses'].indexOf(ext) >= 0;
  if (!textLike) {
    return {
      ok: false,
      summary: '二进制文件不支持 AI 读取',
      result: filePath + ' 的类型是 ' + (contentType || ext || '未知') + '，不是文本文件，AI 无法安全读取；'
        + '请在网页空间中下载，或用编辑器/浏览器打开。',
    };
  }

  const text = contentText(row.content);
  const bytes = parseInt(row.file_size, 10) || Buffer.byteLength(text, 'utf8');
  const reviewStatus = row.review_status || 'published';
  const truncated = bytes > WEB_MAX_READ_BYTES;
  let body = text;
  if (truncated) {
    body = Buffer.from(text, 'utf8').subarray(0, WEB_MAX_READ_BYTES).toString('utf8')
      + '\n…（文件较大，已截断到前 ' + fmtBytes(WEB_MAX_READ_BYTES) + '，完整内容请在网页空间中下载）';
  }
  const header = [
    'path=' + filePath,
    'size=' + fmtBytes(bytes),
    'review_status=' + reviewStatus + (reviewStatus === 'pending_review'
      ? '（最新草稿；公开地址在审核通过前仍显示上一次已发布版本，预览请加 ?preview=1）'
      : ''),
  ].join('\n');
  return {
    ok: true,
    summary: '已读取 ' + filePath + '（' + fmtBytes(bytes) + '，' + reviewStatus + '）',
    result: header + '\n\n' + (body || '（空文件）'),
  };
}

async function toolWriteWebSpaceFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放。' };
  }
  if (a.path === undefined || a.path === null || String(a.path).trim() === '') {
    return { ok: false, summary: '缺少 path', result: '请提供要写入的文件路径，例如 /index.html。' };
  }
  if (a.content === undefined || a.content === null) {
    return { ok: false, summary: '缺少 content', result: '请提供完整的文件内容。' };
  }
  const resolution = resolveWebSpace(DB, u.allianceUsername, a);
  if (resolution.reason !== 'ok') {
    return webSpaceResolveFailure(resolution, (a.space_id || a.slug) ? 'space_id=' + (a.space_id || '-') + ' slug=' + (a.slug || '-') : '默认网页空间');
  }
  const space = resolution.space;
  const writeProblem = webSpaceWriteProblem(space);
  if (writeProblem) return { ok: false, summary: '该网页空间不可写入', result: writeProblem };

  return saveWebFile(ctx, DB, u, space, a.path, a.content, { create: a.create !== false });
}

async function toolDeleteWebSpaceFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放。' };
  }
  const resolution = resolveWebSpace(DB, u.allianceUsername, a);
  if (resolution.reason !== 'ok') {
    return webSpaceResolveFailure(resolution, (a.space_id || a.slug) ? 'space_id=' + (a.space_id || '-') + ' slug=' + (a.slug || '-') : '默认网页空间');
  }
  const space = resolution.space;
  const writeProblem = webSpaceWriteProblem(space);
  if (writeProblem) return { ok: false, summary: '该网页空间不可写入', result: writeProblem };

  const filePath = normalizeWebPath(a.path);
  const pathProblem = webPathProblem(filePath, {});
  if (pathProblem) return { ok: false, summary: '路径不合法', result: pathProblem };
  if (filePath === WEB_PUBLISHED_PREFIX || filePath.indexOf(WEB_PUBLISHED_PREFIX + '/') === 0) {
    return {
      ok: false,
      summary: '已公开版本目录不支持 AI 删除',
      result: filePath + ' 位于 /.published（审核流程维护的「最后允许公开的版本」），AI 不能删除；'
        + '如确需清理，请在网页空间控制台操作。',
    };
  }

  const row = DB.one(
    'SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ?',
    [space.id, filePath]
  );
  if (!row) {
    return {
      ok: false,
      summary: '网页空间里没有这个文件',
      result: filePath + ' 不存在，无法删除。\n现有文件清单：\n' + webFileInventory(DB, space.id, 30),
    };
  }
  const isDir = parseInt(row.is_directory, 10) === 1;
  if (isDir && a.recursive !== true) {
    return {
      ok: false,
      summary: '目标是目录，需要显式确认递归删除',
      result: filePath + ' 是目录。确认要连带删除其中所有文件时，请重新调用并传 recursive=true。',
    };
  }
  if (isDir) {
    const prefix = filePath.replace(/\/+$/, '') + '/';
    DB.delete('web_hosting_files', 'space_id = ? AND (file_path = ? OR file_path LIKE ?)',
      [space.id, filePath, prefix + '%']);
  } else {
    DB.delete('web_hosting_files', 'space_id = ? AND file_path = ?', [space.id, filePath]);
  }
  audit(ctx, isDir ? 'web_hosting_delete_dir' : 'web_hosting_delete_file',
    'AI 删除网页空间' + (isDir ? '目录: ' : '文件: ') + u.allianceUsername + filePath);
  return {
    ok: true,
    summary: '已删除 ' + filePath + (isDir ? '（目录及内容）' : ''),
    result: 'path=' + filePath + '\n（删除的是最新草稿/文件；已公开版本不受影响）',
    patch: { refresh: 'web-space' },
  };
}

async function toolGetWebSpacePreviewUrl(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有网页空间', result: '网页空间仅对智教联盟账户开放。' };
  }
  const resolution = resolveWebSpace(DB, u.allianceUsername, a);
  if (resolution.reason !== 'ok') {
    return webSpaceResolveFailure(resolution, (a.space_id || a.slug) ? 'space_id=' + (a.space_id || '-') + ' slug=' + (a.slug || '-') : '默认网页空间');
  }
  const space = resolution.space;
  const hasPath = a.path !== undefined && a.path !== null && String(a.path).trim() !== '';
  const filePath = hasPath ? normalizeWebPath(a.path) : '/';

  if (hasPath) {
    const pathProblem = webPathProblem(filePath, { allowRoot: true });
    if (pathProblem) return { ok: false, summary: '路径不合法', result: pathProblem };
    const row = DB.one(
      'SELECT id, file_path, is_directory, review_status FROM web_hosting_files WHERE space_id = ? AND file_path = ?',
      [space.id, filePath]
    );
    if (!row) {
      return {
        ok: false,
        summary: '网页空间里没有这个文件',
        result: filePath + ' 不存在，暂无法生成该文件的预览地址。\n现有文件清单：\n' + webFileInventory(DB, space.id, 30),
      };
    }
    const urls = siteUrls(ctx, space, filePath);
    return {
      ok: true,
      summary: '预览地址：' + urls.preview,
      result: 'space_id=' + space.id + '\npath=' + filePath
        + '\nreview_status=' + (row.review_status || 'published')
        + '\npublic_url=' + urls.public
        + '\npreview_url=' + urls.preview
        + '\n（preview_url 会显示待审查的最新草稿；public_url 显示上一次审核通过的版本）',
    };
  }

  const urls = siteUrls(ctx, space, '/');
  const indexRow = DB.one(
    "SELECT review_status FROM web_hosting_files WHERE space_id = ? AND file_path = '/index.html'",
    [space.id]
  );
  return {
    ok: true,
    summary: '站点地址：' + urls.public,
    result: 'space_id=' + space.id + '\nslug=' + space.slug
      + '\npublic_url=' + urls.public
      + '\npreview_url=' + urls.preview
      + '\nindex.html=' + (indexRow ? (indexRow.review_status || 'published') : '不存在（访问根路径会 404）'),
  };
}

async function toolPublishCloudFile(args, ctx) {
  const DB = dbOf(ctx);
  const u = userContext(ctx);
  const a = args || {};
  if (!u.allianceUsername) {
    return { ok: false, summary: '当前账户没有云文件/网页空间', result: '该工具仅对智教联盟账户开放。' };
  }
  const space = findDataSpace(DB, u.allianceUsername);
  if (!space) return { ok: false, summary: '当前账户还没有数据空间', result: '还没有云文件空间，无法发布。' };

  const resolution = resolveCloudFile(DB, space.id, a);
  if (resolution.reason !== 'ok') {
    return cloudResolveFailureResult(DB, space.id, resolution, cloudTargetDesc(a));
  }
  const file = resolution.row;
  if (parseInt(file.is_directory, 10) === 1) {
    return { ok: false, summary: '源文件必须是文件而不是目录', result: '请选择一个云文件（如 index.html）。' };
  }
  if (sharePlaceholderOf(file)) {
    return {
      ok: false,
      summary: '源文件是分享占位条目',
      result: '这是其他用户分享的占位条目，不能作为发布源；请让用户先复制为副本。',
    };
  }

  const webResolution = resolveWebSpace(DB, u.allianceUsername, a);
  if (webResolution.reason !== 'ok') {
    return webSpaceResolveFailure(webResolution, (a.space_id || a.slug) ? 'space_id=' + (a.space_id || '-') + ' slug=' + (a.slug || '-') : '默认网页空间');
  }
  const webSpace = webResolution.space;
  const writeProblem = webSpaceWriteProblem(webSpace);
  if (writeProblem) return { ok: false, summary: '该网页空间不可写入', result: writeProblem };

  const sourceRel = relCloudPath(file.file_path);
  const targetPath = (a.target_path !== undefined && a.target_path !== null && String(a.target_path).trim() !== '')
    ? normalizeWebPath(a.target_path)
    : normalizeWebPath('/' + formats.basename(file.file_path));
  const written = saveWebFile(ctx, DB, u, webSpace, targetPath, contentText(file.content), { create: true });
  if (!written.ok) return written;
  return {
    ok: true,
    summary: '已把云文件 ' + sourceRel + ' 发布到网页空间 ' + targetPath + '（待审查）',
    result: 'source=' + sourceRel + '\n' + written.result,
    patch: { refresh: 'web-space' },
  };
}


// ────────────────────────────── 会话标题 ──────────────────────────────

/**
 * 修改当前对话标题（AI 主动重命名）
 * ctx.sessionId 由 agent.js 传入；只允许改当前用户自己的会话。
 */
async function toolSetSessionTitle(args, ctx) {
  const DB = dbOf(ctx);
  const safeCtx = ctx || {};
  const sessionId = parseInt(safeCtx.sessionId === undefined || safeCtx.sessionId === null ? 0 : safeCtx.sessionId, 10) || 0;
  if (!sessionId) {
    return { ok: false, summary: '当前没有可命名的对话', result: '该工具只能在 AI 对话里使用。' };
  }

  const rawTitle = String((args || {}).title === undefined || (args || {}).title === null ? '' : (args || {}).title)
    .trim()
    .replace(/^["'“”‘’「」『』]+/, '')
    .replace(/["'“”‘’「」『』]+$/, '')
    .replace(/[。！？!?.,，；;：:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (rawTitle === '') {
    return { ok: false, summary: '标题不能为空', result: '请提供 title（不超过 16 个中文字符）。' };
  }
  const title = Array.from(rawTitle).slice(0, 24).join('');

  const session = DB.one('SELECT * FROM ai_chat_sessions WHERE id = ?', [sessionId]);
  if (!session) {
    return { ok: false, summary: '对话不存在', result: 'session_id=' + sessionId };
  }
  const ownerKey = String(safeCtx.ownerKey || '');
  if (ownerKey !== '' && String(session.owner_key || '') !== ownerKey) {
    return { ok: false, summary: '无权修改该对话标题', result: '对话不属于当前用户。' };
  }
  if (String(session.title || '') === title) {
    return { ok: true, summary: '对话标题已经是「' + title + '」', result: 'title=' + title };
  }

  DB.update('ai_chat_sessions', { title: title, title_generated: 1, updated_at: nowStr() }, 'id = ?', [sessionId]);
  return {
    ok: true,
    summary: '已把对话标题改为「' + title + '」',
    result: 'title=' + title,
    // agent.js 会把它变成 SSE title 事件，前端即时刷新会话列表
    title: title,
    patch: { refresh: 'session-title' },
  };
}


// ────────────────────────────── 工具分发 ──────────────────────────────

/** 服务端工具实现表 */
const SERVER_HANDLERS = {
  get_user_info: toolGetUserInfo,
  list_cloud_files: toolListCloudFiles,
  read_cloud_file: toolReadCloudFile,
  list_instances: toolListInstances,
  get_dataspace_info: toolGetDataspaceInfo,
  list_web_spaces: toolListWebSpaces,
  list_web_space_files: toolListWebSpaceFiles,
  read_web_space_file: toolReadWebSpaceFile,
  get_web_space_preview_url: toolGetWebSpacePreviewUrl,
  create_cloud_file: toolCreateCloudFile,
  update_cloud_file: toolUpdateCloudFile,
  rename_cloud_file: toolRenameCloudFile,
  delete_cloud_file: toolDeleteCloudFile,
  create_instance: toolCreateInstance,
  update_instance: toolUpdateInstance,
  delete_instance: toolDeleteInstance,
  write_web_space_file: toolWriteWebSpaceFile,
  delete_web_space_file: toolDeleteWebSpaceFile,
  publish_cloud_file: toolPublishCloudFile,
  create_web_space: toolCreateWebSpace,
  update_web_space: toolUpdateWebSpace,
  set_session_title: toolSetSessionTitle,
};

/**
 * 执行工具。
 * @param {string} name 工具名
 * @param {object} args 模型给出的参数
 * @param {{ownerKey?:string,user?:object,sessionId?:number,scope?:string,editorContext?:object,DB?:object,client?:{hasEditor?:boolean},req?:object,Auth?:object}} ctx
 * @returns {Promise<{ok:boolean, summary:string, result?:string, image?:string, patch?:{refresh?:'cloud-files'|'instances'|'dataspace'|'web-space'}}>}
 */
// ────────────────────────────── 参数归一化 ──────────────────────────────

/**
 * 常见参数别名 → 规范名。
 * 不同模型（尤其 OpenAI 兼容实现）经常把 file_id 写成 fileId、把 path 写成 file_path，
 * 或把数字写成字符串。这里统一纠偏，避免「工具调用出错」其实是参数名/类型不对。
 */
const ARG_ALIASES = {
  fileid: 'file_id',
  file_id_: 'file_id',
  file: 'path',
  filename: 'name',
  file_name: 'name',
  file_path: 'path',
  filepath: 'path',
  new_name: 'new_name',
  newname: 'new_name',
  newspace: 'title',
  spaceid: 'space_id',
  space_slug: 'slug',
  instanceid: 'instance_id',
  instance: 'instance_id',
  new_content: 'content',
  newcontent: 'content',
  text: 'content',
  body: 'content',
  targetpath: 'target_path',
  target_file: 'target_path',
  directory_path: 'directory',
  dir: 'directory',
  panel_id: 'panel',
  line_no: 'line',
  linenumber: 'line',
};

/** 需要数字的参数（模型常传字符串 "355"） */
const NUMERIC_ARGS = new Set(['file_id', 'space_id', 'instance_id', 'line']);
/** 需要布尔的参数（模型常传 "true" / 1） */
const BOOLEAN_ARGS = new Set(['create', 'create_if_missing', 'recursive', 'enabled', 'pinned']);
/** 内容类参数不要 trim 掉内部空白/换行 */
const CONTENT_ARGS = new Set(['content', 'text', 'fileContent']);

function normalizeToolArgs(input) {
  const out = {};
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const [rawKey, rawValue] of Object.entries(src)) {
    if (rawValue === undefined || rawValue === null) continue;
    const lower = String(rawKey).toLowerCase().replace(/[\s-]/g, '_');
    const key = ARG_ALIASES[lower] || ARG_ALIASES[String(rawKey)] || rawKey;
    if (key === rawKey && lower !== rawKey && NUMERIC_ARGS.has(lower)) {
      // 例如 FileID → file_id 之外的变体，交给下面按类型处理
    }
    let value = rawValue;
    if (NUMERIC_ARGS.has(key)) {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) {
        // 数字参数给了非数字 → 保留原值，让具体工具的校验给出可读错误
        value = rawValue;
      } else {
        value = Math.trunc(n);
      }
    } else if (BOOLEAN_ARGS.has(key)) {
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        value = (v === 'true' || v === '1' || v === 'yes') ? true : (v === 'false' || v === '0' || v === 'no' ? false : value);
      } else {
        value = !!value;
      }
    } else if (typeof value === 'string' && !CONTENT_ARGS.has(key)) {
      value = value.trim();
    }
    out[key] = value;
  }
  // 同时兼容 snake_case / camelCase 两套写法（未在别名表里的）
  for (const [k, v] of Object.entries(out)) {
    const snake = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    if (snake !== k && out[snake] === undefined) out[snake] = v;
  }
  return out;
}

/**
 * 校验必填参数（用 definitions 里的 required 决定），返回可读错误。
 * 目的：让模型拿到「缺哪个参数、这个工具支持哪些参数」，而不是笼统失败。
 */
function missingRequiredArgs(toolName, args) {
  const defs = buildDefinitions(true);
  const def = defs.find((d) => d.name === toolName);
  if (!def) return '';
  const params = def.parameters || {};
  const required = Array.isArray(params.required) ? params.required : [];
  const missing = required.filter((k) => {
    const v = args[k];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (!missing.length) return '';
  const props = Object.keys(params.properties || {});
  return '缺少必填参数：' + missing.join('、')
    + '\n该工具支持参数：' + (props.length ? props.join('、') : '（无参数）')
    + '\n请补齐参数后重新调用一次本工具（不要改用其它工具绕开）。';
}

async function execute(name, args, ctx) {
  const toolName = String(name || '');
  const safeArgs = normalizeToolArgs(args);
  const safeCtx = ctx && typeof ctx === 'object' ? ctx : {};

  // 客户端工具由浏览器执行（agent.js 走 await_tool / await_user），这里只兜底
  if (CLIENT_TOOL_NAMES.has(toolName)) {
    if (toolName === 'ask_user') {
      return { ok: false, summary: 'ask_user 需要前端提问卡交互', result: '请通过 await_user 事件把问题交给浏览器渲染。' };
    }
    return { ok: false, summary: labelOf(toolName) + ' 需要浏览器端执行', result: '该工具为客户端工具，请通过 await_tool 事件交给浏览器执行。' };
  }

  const handler = SERVER_HANDLERS[toolName];
  if (typeof handler !== 'function') {
    return { ok: false, summary: '未知工具：' + toolName, result: '可用工具请参考 tools.definitions()。' };
  }

  const missProblem = missingRequiredArgs(toolName, safeArgs);
  if (missProblem) {
    return { ok: false, summary: '参数不完整：' + missProblem.split('\n')[0].replace('缺少必填参数：', ''), result: missProblem };
  }

  try {
    const out = await handler(safeArgs, safeCtx);
    if (!out || typeof out !== 'object') {
      return { ok: false, summary: labelOf(toolName) + ' 执行无返回值' };
    }
    return {
      ok: out.ok === true,
      summary: String(out.summary || ''),
      ...(out.result !== undefined ? { result: String(out.result) } : {}),
      ...(out.image !== undefined ? { image: out.image } : {}),
      ...(out.patch !== undefined ? { patch: out.patch } : {}),
      // set_session_title 等工具会带回 title，agent.js 转成 SSE title 事件
      ...(out.title !== undefined ? { title: String(out.title) } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      summary: labelOf(toolName) + ' 执行失败：' + ((e && e.message) || e),
      result: String((e && e.stack) || (e && e.message) || e || ''),
    };
  }
}

module.exports = {
  definitions,
  labelOf,
  execute,
  // 以下为 agent.js 集成的便利导出（非契约必需，纯附加）
  CLIENT_TOOL_NAMES,
  SERVER_TOOL_NAMES: Object.keys(SERVER_HANDLERS),
};
