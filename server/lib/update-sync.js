/**
 * CSES Cloud - 生产端同步核心库（零新增依赖）
 *
 * 被两处复用：
 *   1. server/api/system/update.js    —— 管理接口（版本、检查更新、触发同步、查看状态、回滚）
 *   2. scripts/sync-production.mjs    —— 命令行同步脚本（--check / --apply / --rollback）
 *
 * 职责边界：本文件只做「配置读取 + 状态/锁/日志/备份索引 + GitHub API 查询」，
 *           真正会改动部署目录的下载/解包/替换/重启/健康检查流程在 scripts/sync-production.mjs，
 *           这样接口只需要 spawn 脚本，避免把长任务塞进 HTTP 进程。
 *
 * 配置全部来自环境变量（见 getConfig），缺省即功能关闭：不硬编码任何密钥。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// 触发 .env 加载（幂等，不覆盖真实环境变量）
require('./env-load');

const ROOT = path.join(__dirname, '..', '..');

/** 缺省值：可用环境变量覆盖，见 docs/生产端同步.md */
const DEFAULTS = {
  repo: 'SmartTeachCN/CSESCloud',
  branch: 'CSES-Cloud-V3',
  apiBase: 'https://api.github.com',
  maxBackups: 3,
  installCmd: 'pnpm install --frozen-lockfile',
  healthcheckTimeoutMs: 120000,
  healthcheckIntervalMs: 2000,
  requestTimeoutMs: 15000,
  userAgent: 'cses-cloud-update-sync',
};

/**
 * 更新替换时「保留不覆盖」的顶层名称（任意层级同名的目录/文件都不会被覆盖或删除）：
 * data/（数据库与运行期文件）、node_modules/（依赖）、.git/（部署目录是 git 检出时需要）、
 * .env*（站点密钥）、exports/（导出文件）、logs/（自定义日志目录）。
 */
const PRESERVE_NAMES = [
  'data',
  'node_modules',
  '.git',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'exports',
  'logs',
];

/** PHP 风格真值判断：'1' / 'true' / 'yes' / 'on' 视为启用 */
function isTruthy(v) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return false;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(v).trim().toLowerCase());
}

/** 解析正整数，非法时回退默认值 */
function toInt(v, fallback) {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 读取同步配置（每次调用都读 process.env，便于测试与热加载）
 * @param {Record<string,string>} [overrides] 覆盖项（测试用）
 */
function getConfig(overrides = {}) {
  const env = process.env;
  const installDir = path.resolve(overrides.installDir || env.UPDATE_INSTALL_DIR || ROOT);
  const stateDir = path.join(installDir, 'data', 'update');

  const cfg = {
    // ── 开关与凭据 ──
    enabled: isTruthy(env.UPDATE_SYNC_ENABLED),
    enabledRaw: env.UPDATE_SYNC_ENABLED ?? '',
    token: env.UPDATE_SYNC_TOKEN || '',
    githubToken: env.UPDATE_GITHUB_TOKEN || env.GITHUB_TOKEN || '',

    // ── 上游仓库 ──
    repo: env.UPDATE_REPO || DEFAULTS.repo,
    branch: env.UPDATE_BRANCH || DEFAULTS.branch,
    apiBase: String(env.UPDATE_API_BASE || DEFAULTS.apiBase).replace(/\/+$/, ''),

    // ── 目录 ──
    installDir,
    stateDir,
    backupDir: path.resolve(installDir, env.UPDATE_BACKUP_DIR || path.join('data', 'update', 'backups')),
    logDir: path.resolve(installDir, env.UPDATE_LOG_DIR || path.join('data', 'update', 'logs')),
    tmpDir: path.resolve(installDir, env.UPDATE_TMP_DIR || path.join('data', 'update', 'tmp')),

    // ── 行为参数 ──
    maxBackups: Math.max(0, Math.min(50, toInt(env.UPDATE_MAX_BACKUPS, DEFAULTS.maxBackups))),
    restartCmd: String(env.UPDATE_RESTART_CMD || env.UPDATE_SERVICE || '').trim(),
    installCmd: String(env.UPDATE_INSTALL_CMD || DEFAULTS.installCmd).trim(),
    healthcheckUrl: String(
      env.UPDATE_HEALTHCHECK_URL
      || `http://127.0.0.1:${env.PORT || 8000}/api/system/health`
    ).trim(),
    healthcheckTimeoutMs: toInt(env.UPDATE_HEALTHCHECK_TIMEOUT_MS, DEFAULTS.healthcheckTimeoutMs),
    healthcheckIntervalMs: toInt(env.UPDATE_HEALTHCHECK_INTERVAL_MS, DEFAULTS.healthcheckIntervalMs),
    requestTimeoutMs: toInt(env.UPDATE_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    preserve: PRESERVE_NAMES.concat(
      String(env.UPDATE_PRESERVE || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  };

  return Object.assign(cfg, overrides, { installDir, stateDir });
}

/** 功能是否启用（仅控制管理接口；命令行脚本由运维显式执行，不受此开关限制） */
function isEnabled(cfg = getConfig()) {
  return cfg.enabled === true;
}

/** 对外可见的配置视图（密钥一律只暴露「是否已配置」，命令中的凭据做脱敏） */
function publicConfig(cfg = getConfig()) {
  return {
    enabled: cfg.enabled,
    enabled_raw: cfg.enabledRaw,
    repo: cfg.repo,
    branch: cfg.branch,
    install_dir: cfg.installDir,
    backup_dir: cfg.backupDir,
    log_dir: cfg.logDir,
    max_backups: cfg.maxBackups,
    token_configured: !!cfg.token,
    github_token_configured: !!cfg.githubToken,
    restart: {
      configured: !!cfg.restartCmd,
      command: maskCommand(cfg.restartCmd),
    },
    install_cmd: cfg.installCmd,
    healthcheck_url: cfg.healthcheckUrl,
    preserve: cfg.preserve,
  };
}

/** 命令脱敏：URL 中的 userinfo 与 --token/--password 形式的值 */
function maskCommand(cmd) {
  if (!cmd) return '';
  return String(cmd)
    .replace(/(\/\/[^/@\s:]+):[^/@\s]+@/g, '$1:***@')
    .replace(/((?:--)?(?:token|password|passwd|secret|apikey|api-key)\s*[=:]\s*)(\S+)/gi, '$1***');
}

// ── 目录与路径 ──

/** 创建状态/日志/备份/临时目录 */
function ensureDirs(cfg) {
  for (const dir of [cfg.stateDir, cfg.logDir, cfg.backupDir, cfg.tmpDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {
      // 单个目录失败不阻断（后续操作会给出更明确的错误）
    }
  }
}

/** 任意层级路径是否命中保留名单（相对 installDir，使用 / 分隔） */
function isPreservedPath(cfg, relPath) {
  const segments = String(relPath || '').split(/[\\/]+/).filter(Boolean);
  return segments.some((seg) => cfg.preserve.includes(seg));
}

// ── 状态文件（data/update/state.json） ──

const STATE_FILE_NAME = 'state.json';

function stateFile(cfg) {
  return path.join(cfg.stateDir, STATE_FILE_NAME);
}

/** 去掉 UTF-8 BOM（手工编辑过的状态文件可能带 BOM） */
function stripBom(text) {
  const s = String(text || '');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 读取同步状态（损坏或缺失时返回空状态） */
function readState(cfg = getConfig()) {
  const empty = { version: 1, running: null, last: null, history: [] };
  try {
    const data = JSON.parse(stripBom(fs.readFileSync(stateFile(cfg), 'utf8')));
    if (!data || typeof data !== 'object') return empty;
    return {
      version: data.version || 1,
      running: data.running || null,
      last: data.last || null,
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch (_) {
    return empty;
  }
}

/** 原子写入状态文件（先写临时文件再 rename） */
function writeState(cfg, state) {
  ensureDirs(cfg);
  const file = stateFile(cfg);
  const tmp = file + '.tmp-' + process.pid;
  const payload = JSON.stringify(state, null, 2);
  try {
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, file);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    fs.writeFileSync(file, payload);
  }
}

/** 合并更新状态文件 */
function updateState(cfg, patch) {
  const state = readState(cfg);
  const next = Object.assign(state, patch);
  writeState(cfg, next);
  return next;
}

/** 标记任务开始（脚本/接口在任务启动时调用） */
function markRunning(cfg, info) {
  const state = readState(cfg);
  state.running = Object.assign(
    { job_id: info.jobId, action: info.action, pid: process.pid, started_at: new Date().toISOString() },
    info
  );
  if (info.logFile) state.running.log_file = info.logFile;
  writeState(cfg, state);
  return state.running;
}

/**
 * 标记任务结束：写入 last + 追加 history，并清空 running（仅当 jobId 匹配，避免覆盖新任务）
 * @param {object} cfg
 * @param {{jobId:string, action:string, ok:boolean, message?:string, result?:object, logFile?:string}} info
 */
function markFinished(cfg, info) {
  const state = readState(cfg);
  const finishedAt = new Date().toISOString();
  const record = {
    job_id: info.jobId,
    action: info.action,
    status: info.ok ? 'success' : 'failed',
    started_at: (state.running && state.running.job_id === info.jobId && state.running.started_at) || info.startedAt || '',
    finished_at: finishedAt,
    message: info.message || '',
    log_file: info.logFile || (state.running && state.running.log_file) || '',
    detail: info.result || null,
  };
  state.last = record;
  state.history = [record].concat(state.history || []).slice(0, 20);
  if (state.running && state.running.job_id === info.jobId) state.running = null;
  writeState(cfg, state);
  return record;
}

// ── 并发锁（data/update/sync.lock） ──

const LOCK_FILE_NAME = 'sync.lock';
const LOCK_STALE_MS = 6 * 60 * 60 * 1000; // 6 小时视为僵尸锁

function lockFile(cfg) {
  return path.join(cfg.stateDir, LOCK_FILE_NAME);
}

/** 进程是否存活（EPERM 说明进程在但无权限，按存活处理） */
function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

/** 读取当前锁（无锁返回 null） */
function readLock(cfg) {
  try {
    const lock = JSON.parse(stripBom(fs.readFileSync(lockFile(cfg), 'utf8')));
    return lock && typeof lock === 'object' ? lock : null;
  } catch (_) {
    return null;
  }
}

/** 锁是否仍然有效（持有进程存活且未超时） */
function isLockActive(cfg, lock = readLock(cfg)) {
  if (!lock) return false;
  const startedAt = Date.parse(lock.started_at || '') || 0;
  if (startedAt && Date.now() - startedAt > LOCK_STALE_MS) return false;
  if (!isPidAlive(lock.pid)) return false;
  return true;
}

/**
 * 申请同步锁
 * @returns {{ok:boolean, stale?:object|null, holder?:object, error?:string}}
 */
function acquireLock(cfg, meta = {}) {
  ensureDirs(cfg);
  const file = lockFile(cfg);
  const payload = JSON.stringify(Object.assign({
    pid: process.pid,
    host: safeHostname(),
    started_at: new Date().toISOString(),
  }, meta), null, 2);

  const tryWrite = () => {
    fs.writeFileSync(file, payload, { flag: 'wx' });
  };

  try {
    tryWrite();
    return { ok: true };
  } catch (e) {
    if (!e || e.code !== 'EEXIST') {
      return { ok: false, error: '创建同步锁失败: ' + (e && e.message ? e.message : e) };
    }
  }

  const holder = readLock(cfg);
  if (isLockActive(cfg, holder)) {
    return { ok: false, holder, error: '已有同步任务正在运行' };
  }

  // 僵尸锁：清理后重试一次
  try { fs.unlinkSync(file); } catch (_) {}
  try {
    tryWrite();
    return { ok: true, stale: holder };
  } catch (e) {
    return { ok: false, holder: readLock(cfg), error: '创建同步锁失败: ' + (e && e.message ? e.message : e) };
  }
}

/** 释放同步锁（只释放属于本进程的锁） */
function releaseLock(cfg) {
  const holder = readLock(cfg);
  if (holder && Number(holder.pid) !== process.pid) return false;
  try {
    fs.unlinkSync(lockFile(cfg));
    return true;
  } catch (_) {
    return false;
  }
}

function safeHostname() {
  try { return require('os').hostname(); } catch (_) { return ''; }
}

// ── 备份索引（data/update/backups/<stamp>/meta.json） ──

/**
 * 列出备份，最新在前
 * @returns {Array<{name:string, dir:string, createdAt:string, meta:object|null}>}
 */
function listBackups(cfg = getConfig()) {
  ensureDirs(cfg);
  let entries = [];
  try {
    entries = fs.readdirSync(cfg.backupDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(cfg.backupDir, entry.name);
    let meta = null;
    try {
      meta = JSON.parse(stripBom(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')));
    } catch (_) {
      meta = null;
    }
    backups.push({
      name: entry.name,
      dir,
      createdAt: (meta && meta.created_at) || '',
      meta,
    });
  }
  // 目录名带时间戳（YYYYMMDD-HHmmss），字典序即时间序
  backups.sort((a, b) => String(b.name).localeCompare(String(a.name)));
  return backups;
}

/** 最新一份备份（无备份返回 null） */
function latestBackup(cfg = getConfig()) {
  const all = listBackups(cfg);
  return all.length ? all[0] : null;
}

/**
 * 清理旧备份，仅保留最近 N 份（N=cfg.maxBackups，0 表示保留全部）
 * @returns {string[]} 被删除的备份目录名
 */
function pruneBackups(cfg = getConfig(), keep = cfg.maxBackups) {
  if (!keep || keep <= 0) return [];
  const all = listBackups(cfg);
  const removed = [];
  for (const backup of all.slice(keep)) {
    try {
      fs.rmSync(backup.dir, { recursive: true, force: true });
      removed.push(backup.name);
    } catch (_) {
      // 单个备份删除失败不影响其余
    }
  }
  return removed;
}

// ── 日志 ──

/** 生成任务 ID，如 apply-20261031-135001-ab12cd */
function newJobId(action) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`
    + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${action}-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

/** 任务日志文件路径 */
function jobLogFile(cfg, jobId) {
  return path.join(cfg.logDir, `${jobId}.log`);
}

/** 读取文件末尾若干字节（不会把整份大日志读进内存） */
function tailFile(file, maxBytes = 8000) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

/** 日志目录中最近修改的日志文件（无则 null） */
function latestLogFile(cfg = getConfig()) {
  let entries = [];
  try {
    entries = fs.readdirSync(cfg.logDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  let best = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
    const file = path.join(cfg.logDir, entry.name);
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch (_) { continue; }
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best ? best.file : null;
}

// ── 目录镜像 / 过滤复制（更新与回滚共用；被 scripts/sync-production.mjs 调用） ──

/**
 * 递归复制目录，跳过「保留名单」中的任意层级条目（data/、node_modules/、.env…）
 * 用于创建备份：只备份代码，不备份运行期数据与依赖。
 * @returns {{files:number, bytes:number, skipped:number}}
 */
function copyTreeFiltered(cfg, srcRoot, destRoot, { excludeTop = [] } = {}) {
  const stats = { files: 0, bytes: 0, skipped: 0 };
  const walk = (rel) => {
    const srcDir = rel ? path.join(srcRoot, rel) : srcRoot;
    const destDir = rel ? path.join(destRoot, rel) : destRoot;
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isPreservedPath(cfg, childRel)) { stats.skipped++; continue; }
      if (!rel && excludeTop.includes(entry.name)) { stats.skipped++; continue; }
      const src = path.join(srcDir, entry.name);
      const dest = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isSymbolicLink()) {
        try { fs.symlinkSync(fs.readlinkSync(src), dest); stats.files++; } catch (_) { stats.skipped++; }
      } else {
        fs.copyFileSync(src, dest);
        stats.files++;
        try { stats.bytes += fs.statSync(src).size; } catch (_) {}
      }
    }
  };
  walk('');
  return stats;
}

/**
 * 把 srcRoot 的代码镜像同步到 destRoot：
 *   - src 有 dest 没有 → 复制；dest 有 src 没有 → 删除；两边都有 → 覆盖
 *   - 命中保留名单（data / node_modules / .git / .env* …）的任意层级条目既不覆盖也不删除
 * @param {object} cfg 配置（用到 cfg.preserve）
 * @param {string} srcRoot 产物/备份目录
 * @param {string} destRoot 部署目录
 * @param {{excludeTop?: string[], dryRun?: boolean}} [options] excludeTop 仅在顶层跳过的名称；dryRun 只统计不写盘
 * @returns {{copied:number, removed:number, skipped:number, dirs:number}}
 */
function mirrorInto(cfg, srcRoot, destRoot, { excludeTop = [], dryRun = false } = {}) {
  const stats = { copied: 0, removed: 0, skipped: 0, dirs: 0 };
  const walk = (rel) => {
    const srcDir = rel ? path.join(srcRoot, rel) : srcRoot;
    const destDir = rel ? path.join(destRoot, rel) : destRoot;
    if (!dryRun) fs.mkdirSync(destDir, { recursive: true });

    const srcEntries = new Map();
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!rel && excludeTop.includes(entry.name)) continue;
      srcEntries.set(entry.name, entry);
    }

    let destEntries = [];
    try {
      destEntries = fs.readdirSync(destDir, { withFileTypes: true });
    } catch (_) {
      destEntries = [];
    }

    // 1) 删除目标中多余的条目（保留名单除外）
    for (const entry of destEntries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isPreservedPath(cfg, childRel)) { stats.skipped++; continue; }
      if (srcEntries.has(entry.name)) continue;
      if (!dryRun) fs.rmSync(path.join(destDir, entry.name), { recursive: true, force: true });
      stats.removed++;
    }

    // 2) 覆盖 / 新增
    for (const [name, entry] of srcEntries) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (isPreservedPath(cfg, childRel)) { stats.skipped++; continue; }
      const src = path.join(srcDir, name);
      const dest = path.join(destDir, name);
      let destStat = null;
      try { destStat = fs.lstatSync(dest); } catch (_) {}

      if (entry.isDirectory()) {
        if (destStat && !destStat.isDirectory()) {
          if (!dryRun) fs.rmSync(dest, { recursive: true, force: true });
          destStat = null;
        }
        stats.dirs++;
        walk(childRel);
      } else if (entry.isSymbolicLink()) {
        if (destStat && !dryRun) fs.rmSync(dest, { recursive: true, force: true });
        if (!dryRun) {
          try { fs.symlinkSync(fs.readlinkSync(src), dest); } catch (_) {}
        }
        stats.copied++;
      } else {
        if (destStat && destStat.isDirectory() && !dryRun) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        if (!dryRun) {
          fs.copyFileSync(src, dest);
          try { fs.chmodSync(dest, fs.statSync(src).mode & 0o777); } catch (_) {}
        }
        stats.copied++;
      }
    }
  };
  walk('');
  return stats;
}

// ── GitHub API ──

/** GitHub 请求头（有 token 时带上，主要用于限流与私有仓库） */
function githubHeaders(cfg) {
  const headers = {
    'User-Agent': DEFAULTS.userAgent,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (cfg.githubToken) headers.Authorization = `Bearer ${cfg.githubToken}`;
  return headers;
}

/**
 * 发起一次 GitHub API 请求
 * @returns {Promise<{ok:boolean, status:number, data:any, error:string}>}
 */
async function githubRequest(cfg, urlPath) {
  const url = urlPath.startsWith('http') ? urlPath : cfg.apiBase + urlPath;
  try {
    const res = await fetch(url, {
      headers: githubHeaders(cfg),
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
    });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

    if (res.ok) return { ok: true, status: res.status, data, error: '' };

    // 常见错误给出可读提示
    let error = `GitHub API ${res.status}`;
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      error = 'GitHub API 触发限流（未配置 UPDATE_GITHUB_TOKEN 时每小时仅 60 次）';
    } else if (res.status === 404) {
      error = '资源不存在（404）';
    } else if (data && data.message) {
      error = `GitHub API ${res.status}: ${data.message}`;
    }
    return { ok: false, status: res.status, data, error };
  } catch (e) {
    const name = (e && e.name) || 'Error';
    const msg = (e && e.message) || String(e);
    const error = name === 'TimeoutError' || name === 'AbortError'
      ? `请求 GitHub API 超时（${cfg.requestTimeoutMs}ms）`
      : `请求 GitHub API 失败: ${msg}`;
    return { ok: false, status: 0, data: null, error };
  }
}

/** 从 Release 的 assets 中挑选产物（tar.gz / zip / SHA256SUMS.txt），统一为 {name,size,url} */
function pickAssets(assets = []) {
  const normalize = (a) => (a ? { name: a.name || '', size: a.size || 0, url: a.browser_download_url || a.url || '' } : null);
  const byName = (re) => normalize(assets.find((a) => re.test(a.name || '')));
  return {
    tarGz: byName(/\.tar\.gz$/i),
    zip: byName(/\.zip$/i),
    sums: byName(/^SHA256SUMS(\.txt)?$/i) || byName(/sha256/i),
    all: assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url || a.url || '' })),
  };
}

/**
 * 查询最新 Release（配置了 tag 时查询指定 Release）
 * @returns {Promise<{ok:boolean, exists:boolean, release:object|null, error:string}>}
 */
async function getLatestRelease(cfg = getConfig(), opts = {}) {
  const apiPath = opts.tag
    ? `/repos/${cfg.repo}/releases/tags/${encodeURIComponent(opts.tag)}`
    : `/repos/${cfg.repo}/releases/latest`;
  const res = await githubRequest(cfg, apiPath);
  if (!res.ok) {
    // 404 = 上游还没有 Release，属于正常状态而非错误
    if (res.status === 404) {
      return { ok: true, exists: false, release: null, error: res.error };
    }
    return { ok: false, exists: false, release: null, error: res.error };
  }
  const data = res.data || {};
  const assets = Array.isArray(data.assets) ? data.assets : [];
  return {
    ok: true,
    exists: true,
    error: '',
    release: {
      tag: String(data.tag_name || ''),
      name: String(data.name || ''),
      publishedAt: String(data.published_at || ''),
      url: String(data.html_url || ''),
      prerelease: !!data.prerelease,
      draft: !!data.draft,
      assets: pickAssets(assets),
    },
  };
}

/** 查询分支最新提交 */
async function getLatestBranchCommit(cfg = getConfig(), branch = cfg.branch) {
  const res = await githubRequest(cfg, `/repos/${cfg.repo}/commits/${encodeURIComponent(branch)}`);
  if (!res.ok) {
    // 404/422 = 分支不存在（例如 V3 分支尚未推送）
    const soft = res.status === 404 || res.status === 422;
    return { ok: soft, exists: false, commit: null, error: res.error };
  }
  const data = res.data || {};
  const commit = data.commit || {};
  return {
    ok: true,
    exists: true,
    error: '',
    commit: {
      sha: String(data.sha || ''),
      shortSha: String(data.sha || '').slice(0, 7),
      date: String((commit.committer && commit.committer.date) || ''),
      message: String((commit.message || '').split('\n')[0]),
      url: String(data.html_url || ''),
    },
  };
}

/** 查询某个 tag / 分支名对应的 commit sha（尽力而为，失败返回 ''） */
async function resolveRefCommit(cfg, ref) {
  if (!ref) return '';
  const res = await githubRequest(cfg, `/repos/${cfg.repo}/commits/${encodeURIComponent(ref)}`);
  if (!res.ok) return '';
  return String((res.data && res.data.sha) || '');
}

/**
 * 检查更新：本地 build-info 与上游 Release / 分支最新提交对比
 * @param {object} [cfg]
 * @param {object} [local] 本地构建信息（默认取 build-info.js 的结果）
 * @param {object} [opts] {tag?: string}
 */
async function checkForUpdate(cfg = getConfig(), local = null, opts = {}) {
  const buildInfo = local || require('./build-info').getBuildInfo();
  const result = {
    ok: true,
    checked_at: new Date().toISOString(),
    repo: cfg.repo,
    branch: cfg.branch,
    local: {
      version: buildInfo.version || '',
      commit: buildInfo.commit || '',
      short_commit: buildInfo.shortCommit || '',
      branch: buildInfo.branch || '',
      tag: buildInfo.tag || '',
      build_time: buildInfo.buildTime || '',
      dirty: buildInfo.dirty,
      sources: buildInfo.sources || {},
    },
    release: null,
    branch_head: null,
    update_available: false,
    recommended_action: 'none',
    notes: [],
    errors: [],
  };

  // ── 上游 Release ──
  const releaseRes = await getLatestRelease(cfg, opts);
  if (!releaseRes.ok) {
    result.errors.push('Release 查询失败: ' + releaseRes.error);
  } else if (!releaseRes.exists) {
    result.notes.push(opts.tag
      ? `未找到 Release ${opts.tag}`
      : '上游暂无 Release（CI 可能尚未产出产物），只能对比分支提交');
  } else {
    const rel = releaseRes.release;
    const tagCommit = await resolveRefCommit(cfg, rel.tag);
    const matchesLocalCommit = !!(buildInfo.commit && tagCommit && buildInfo.commit === tagCommit);
    const matchesLocalTag = !!(buildInfo.tag && rel.tag && buildInfo.tag === rel.tag);
    result.release = Object.assign({}, rel, {
      commit: tagCommit,
      is_newer: !(matchesLocalCommit || matchesLocalTag),
      matches_local: matchesLocalCommit || matchesLocalTag,
      has_artifact: !!rel.assets.tarGz,
      artifact: rel.assets.tarGz
        ? { name: rel.assets.tarGz.name, size: rel.assets.tarGz.size, url: rel.assets.tarGz.url }
        : null,
    });
    if (!rel.assets.tarGz) {
      result.notes.push('Release 中未找到 .tar.gz 产物，无法自动更新（请检查 CI 产物命名）');
    }
    if (rel.draft) result.notes.push('该 Release 是草稿（draft），不建议部署');
    if (rel.prerelease) result.notes.push('该 Release 是预发布（prerelease），请谨慎部署');
  }

  // ── 分支最新提交 ──
  const branchRes = await getLatestBranchCommit(cfg);
  if (!branchRes.ok) {
    result.errors.push('分支查询失败: ' + branchRes.error);
  } else if (!branchRes.exists) {
    result.notes.push(`上游分支 ${cfg.branch} 不存在（404/422），请确认 UPDATE_BRANCH 配置`);
  } else {
    const head = branchRes.commit;
    const isNewer = buildInfo.commit ? head.sha !== buildInfo.commit : true;
    result.branch_head = Object.assign({}, head, {
      is_newer: isNewer,
      matches_local_commit: !!(buildInfo.commit && head.sha === buildInfo.commit),
    });
  }

  // ── 结论 ──
  const releaseNewer = !!(result.release && result.release.is_newer);
  const branchNewer = !!(result.branch_head && result.branch_head.is_newer);
  result.update_available = releaseNewer || branchNewer;
  if (result.release && result.release.is_newer) {
    // 有新 Release 但 Release 没带产物时无法自动更新
    result.recommended_action = result.release.has_artifact ? 'apply-release' : 'wait-release';
  } else if (branchNewer) {
    result.recommended_action = 'branch-ahead';
    result.notes.push('分支有新提交但尚未发布新 Release，自动更新只能部署 Release 产物');
  } else if (result.release && result.release.matches_local) {
    result.recommended_action = 'none';
  } else if (!result.release && !result.branch_head) {
    result.recommended_action = 'unknown';
  }

  // 本地分支与上游分支不一致时，比较结果可能失真（例如开发机在 V3、生产跟踪 CSES-Cloud-V3）
  if (buildInfo.branch && cfg.branch && buildInfo.branch !== cfg.branch) {
    result.notes.push(`本地分支 ${buildInfo.branch} 与上游分支 ${cfg.branch} 不一致，对比结果仅供参考`);
  }

  if (result.errors.length && !result.release && !result.branch_head) {
    result.ok = false;
    result.message = result.errors.join('；');
  }

  return result;
}

// ── 后台任务（接口触发，脚本执行） ──

/** 同步脚本路径（跟随当前运行代码；部署目录与代码目录不一致时回退） */
function scriptFile(cfg = getConfig()) {
  const candidates = [
    path.join(ROOT, 'scripts', 'sync-production.mjs'),
    path.join(cfg.installDir, 'scripts', 'sync-production.mjs'),
  ];
  for (const file of candidates) {
    try { if (fs.statSync(file).isFile()) return file; } catch (_) {}
  }
  return candidates[0];
}

/**
 * 后台启动同步脚本（detached，输出重定向到 data/update/logs/<jobId>.log）
 * @param {object} cfg
 * @param {'apply'|'rollback'} action
 * @param {string[]} [extraArgs]
 * @returns {{ok:boolean, jobId?:string, pid?:number, logFile?:string, error?:string}}
 */
function spawnTask(cfg = getConfig(), action, extraArgs = []) {
  if (action !== 'apply' && action !== 'rollback') {
    return { ok: false, error: '不支持的任务类型: ' + action };
  }
  ensureDirs(cfg);
  const script = scriptFile(cfg);
  if (!fs.existsSync(script)) {
    return { ok: false, error: '同步脚本不存在: ' + script };
  }
  // 已有任务在跑
  const lock = readLock(cfg);
  if (isLockActive(cfg, lock)) {
    return { ok: false, error: '已有同步任务正在运行', holder: lock };
  }
  const running = readState(cfg).running;
  if (running && isPidAlive(running.pid)) {
    return { ok: false, error: '已有同步任务正在运行', holder: running };
  }

  const jobId = newJobId(action);
  const logFile = jobLogFile(cfg, jobId);
  const args = [
    '--disable-warning=ExperimentalWarning',
    script,
    `--${action}`,
    '--yes',
    '--job-id', jobId,
    ...extraArgs,
  ];

  let fd = null;
  try {
    fd = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, args, {
      cwd: cfg.installDir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: Object.assign({}, process.env, {
        UPDATE_INSTALL_DIR: cfg.installDir,
        UPDATE_SYNC_JOB_ID: jobId,
      }),
    });
    child.on('error', () => {});
    child.unref();
    const pid = child.pid;
    // 先落 running 状态，接口立即返回后前端可轮询 status（演练任务不写状态，避免残留）
    if (!extraArgs.includes('--dry-run')) {
      markRunning(cfg, {
        job_id: jobId,
        action,
        pid,
        log_file: logFile,
        started_at: new Date().toISOString(),
      });
    }
    return { ok: true, jobId, pid, logFile, script, args };
  } catch (e) {
    try { fs.appendFileSync(logFile, `[spawn] 启动失败: ${e && e.message ? e.message : e}\n`); } catch (_) {}
    return { ok: false, error: '启动同步任务失败: ' + (e && e.message ? e.message : e) };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/** 任务状态视图（供接口 status 返回） */
function jobStatus(cfg = getConfig(), maxLogBytes = 8000) {
  const state = readState(cfg);
  const lock = readLock(cfg);
  const lockActive = isLockActive(cfg, lock);
  const running = state.running && (lockActive || isPidAlive(state.running.pid))
    ? state.running
    : (lockActive ? Object.assign({}, lock) : null);

  let logFile = (state.last && state.last.log_file) || (running && running.log_file) || '';
  if (!logFile || !fs.existsSync(logFile)) {
    logFile = latestLogFile(cfg) || '';
  }

  return {
    running,
    lock: lock ? { active: lockActive, pid: lock.pid, host: lock.host, started_at: lock.started_at, job_id: lock.job_id } : null,
    last: state.last,
    history: (state.history || []).slice(0, 10),
    log_file: logFile,
    log_tail: logFile ? tailFile(logFile, maxLogBytes) : '',
    backups: listBackups(cfg).slice(0, 10).map((b) => ({
      name: b.name,
      created_at: b.createdAt,
      from: (b.meta && b.meta.from) || null,
      to: (b.meta && b.meta.to) || null,
    })),
  };
}

module.exports = {
  ROOT,
  DEFAULTS,
  PRESERVE_NAMES,
  getConfig,
  isEnabled,
  publicConfig,
  isTruthy,
  maskCommand,
  ensureDirs,
  isPreservedPath,
  copyTreeFiltered,
  mirrorInto,
  stateFile,
  readState,
  writeState,
  updateState,
  markRunning,
  markFinished,
  lockFile,
  readLock,
  isLockActive,
  acquireLock,
  releaseLock,
  isPidAlive,
  listBackups,
  latestBackup,
  pruneBackups,
  newJobId,
  jobLogFile,
  tailFile,
  latestLogFile,
  githubHeaders,
  githubRequest,
  getLatestRelease,
  getLatestBranchCommit,
  resolveRefCommit,
  checkForUpdate,
  scriptFile,
  spawnTask,
  jobStatus,
};
