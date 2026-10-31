#!/usr/bin/env node
/**
 * CSES Cloud - 生产端更新同步脚本（纯 Node ESM，零新增依赖）
 *
 * 作用：让生产服务器上的维护者能「检查上游是否有新版本」并「一键拉取更新」：
 *   下载 CI 产物 → 校验 SHA256 → 解包到 staging → 备份现有部署 → 替换代码（保留 data/ 等运行期目录）
 *   → 按需安装依赖 → 重启服务 → 健康检查；任一步失败自动回滚到刚创建的备份。
 *
 * 用法：
 *   node scripts/sync-production.mjs --check              # 检查上游 Release / 分支提交
 *   node scripts/sync-production.mjs --check --json       # 机器可读输出（日志走 stderr）
 *   node scripts/sync-production.mjs --apply --dry-run    # 演练：只打印将要执行的步骤
 *   node scripts/sync-production.mjs --apply --yes        # 正式更新（非交互环境必须加 --yes）
 *   node scripts/sync-production.mjs --rollback --yes     # 回滚到最近一次备份
 *   node scripts/sync-production.mjs --help               # 查看全部参数
 *
 * 配置全部来自环境变量（也可写在仓库根 .env，由 server/lib/env-load.js 加载）；
 * 详见 docs/生产端同步.md 与 server/lib/update-sync.js 的 getConfig()。
 *
 * 退出码：0 成功 / 1 失败 / 2 参数错误 / 10 有新版本（配合 --exit-code）/ 11 已是最新（配合 --exit-code）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import updateSync from '../server/lib/update-sync.js';
import buildInfoLib from '../server/lib/build-info.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/** 解析后的命令行参数（main 中填充） */
const opts = {
  action: 'check',
  json: false,
  dryRun: false,
  yes: false,
  help: false,
  verbose: false,
  exitCode: false,
  tag: '',
  jobId: '',
  backup: '',
  noInstall: false,
  forceInstall: false,
  skipVerify: false,
  allowMissingDist: false,
};

/** 是否给终端输出上色（--json / 非 TTY / NO_COLOR 时关闭） */
const USE_COLOR = !process.stdout.isTTY ? false : !process.env.NO_COLOR;

const COLOR = {
  gray: (s) => (USE_COLOR ? `\x1b[90m${s}\x1b[0m` : s),
  red: (s) => (USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s) => (USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s),
  bold: (s) => (USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s),
};

// ── 输出 ──

/** 当前时间 HH:mm:ss（人类可读日志前缀） */
function clock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 打印一行日志。
 * --json 模式下写 stderr，保证 stdout 只有一段可解析的 JSON。
 */
function log(message, level = 'info') {
  const glyph = {
    info: COLOR.gray('·'),
    step: COLOR.cyan('▶'),
    ok: COLOR.green('✔'),
    warn: COLOR.yellow('!'),
    fail: COLOR.red('✘'),
  }[level] || '·';
  const line = `${COLOR.gray('[' + clock() + ']')} ${glyph} ${message}`;
  if (opts.json || level === 'fail') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const info = (m) => log(m, 'info');
const ok = (m) => log(m, 'ok');
const warn = (m) => log(m, 'warn');
const fail = (m) => log(m, 'fail');

/** 输出最终结果（--json 时输出到 stdout） */
function emitResult(result) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (result.ok) {
    log(COLOR.green(`完成：${result.summary || '成功'}`), 'ok');
  } else {
    log(COLOR.red(`失败：${result.error || '未知错误'}`), 'fail');
  }
}

/** 人类可读的字节数 */
function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 本地时间字符串 YYYY-MM-DD HH:mm:ss（展示构建时间等） */
function fmtTime(value) {
  if (!value) return '未知';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 时间戳（用于备份/临时目录命名，本地时间，字典序即时间序） */
function stampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-`
    + `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 读取 JSON 文件，失败返回 null（自动去掉 UTF-8 BOM） */
function readJsonSafe(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (_) {
    return null;
  }
}

/** 路径是否存在 */
function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; } }

/** 删除文件或目录（不存在则忽略） */
function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
}

/** 计算文件 SHA256（流式，避免大文件占内存） */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ── 参数解析 ──

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw Object.assign(new Error(`参数 ${arg} 缺少取值`), { code: 2 });
      return v;
    };
    switch (arg) {
      case '--check': opts.action = 'check'; break;
      case '--apply': case '--update': opts.action = 'apply'; break;
      case '--rollback': opts.action = 'rollback'; break;
      case '--json': opts.json = true; break;
      case '--dry-run': case '--dryrun': opts.dryRun = true; break;
      case '--yes': case '-y': opts.yes = true; break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--exit-code': opts.exitCode = true; break;
      case '--tag': opts.tag = next(); break;
      case '--job-id': opts.jobId = next(); break;
      case '--backup': opts.backup = next(); break;
      case '--no-install': opts.noInstall = true; break;
      case '--force-install': opts.forceInstall = true; break;
      case '--skip-verify': opts.skipVerify = true; break;
      case '--allow-missing-dist': opts.allowMissingDist = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        throw Object.assign(new Error(`未知参数: ${arg}（用 --help 查看用法）`), { code: 2 });
    }
  }
  return opts;
}

function printHelp() {
  const text = `
${COLOR.bold('CSES Cloud 生产端同步脚本')}

用法：
  node scripts/sync-production.mjs [--check|--apply|--rollback] [选项]

动作：
  --check                检查上游 Release / 分支最新提交与本地构建信息的差异（默认动作，只读）
  --apply                下载产物并更新当前部署（会备份、替换代码、重启、健康检查，失败自动回滚）
  --rollback             回滚到最近一次备份（或用 --backup 指定）

选项：
  --dry-run              演练模式：只做只读检查并打印将要执行的步骤，不下载/不替换/不重启
  --yes, -y              非交互确认（无 TTY 时必须显式提供）
  --json                 以 JSON 输出结果（日志改走 stderr）
  --exit-code            配合 --check：有新版本退出码 10，已是最新退出码 11
  --tag <tag>            指定 Release 标签（默认取 Latest Release）
  --backup <名称|路径>   回滚时指定备份（默认最近一份）
  --no-install           跳过后端依赖安装（pnpm install）
  --force-install        强制安装依赖（即使 lockfile 未变化）
  --skip-verify          跳过 SHA256 校验（不推荐）
  --allow-missing-dist   允许产物缺少 dist/index.html（仅用于特殊场景）
  --job-id <id>          指定任务 ID（管理接口触发时使用）
  --verbose, -v          打印更详细的进度
  --help, -h             显示本帮助

环境变量（也可写入仓库根 .env）：
  UPDATE_SYNC_ENABLED=1          启用管理接口（1/true/yes）
  UPDATE_SYNC_TOKEN=<随机串>     管理接口调用凭据
  UPDATE_REPO=SmartTeachCN/CSESCloud
  UPDATE_BRANCH=CSES-Cloud-V3
  UPDATE_GITHUB_TOKEN=<可选>     GitHub API 限流/私有仓库
  UPDATE_INSTALL_DIR=<部署目录>  默认 = 脚本所在仓库根
  UPDATE_BACKUP_DIR / UPDATE_LOG_DIR / UPDATE_TMP_DIR
  UPDATE_RESTART_CMD="pm2 restart cses-cloud"（或 UPDATE_SERVICE）
  UPDATE_HEALTHCHECK_URL=http://127.0.0.1:8000/api/system/health
  UPDATE_MAX_BACKUPS=3           保留备份份数
  UPDATE_INSTALL_CMD="pnpm install --frozen-lockfile"
  UPDATE_HEALTHCHECK_TIMEOUT_MS=120000

退出码：0 成功 / 1 失败 / 2 参数错误 / 10 有更新 / 11 已最新
`;
  process.stdout.write(text);
}

// ── 本地信息 ──

/** 采集本地部署信息（构建信息 + 目录 + 运行环境） */
function collectLocal() {
  const build = buildInfoLib.getBuildInfo({ refresh: true });
  return {
    version: build.version,
    commit: build.commit,
    short_commit: build.shortCommit,
    branch: build.branch,
    tag: build.tag,
    build_time: build.buildTime,
    dirty: build.dirty,
    sources: build.sources,
  };
}

/** 打印本地概况（人类可读模式） */
function printLocalSummary(cfg, local) {
  info(`部署目录：${cfg.installDir}`);
  info(`上游仓库：${cfg.repo}  分支：${cfg.branch}`);
  info(`当前版本：${local.version || '未知'}  提交：${local.short_commit || '未知'}`
    + `  分支：${local.branch || '未知'}  构建时间：${fmtTime(local.build_time)}`);
  if (local.tag) info(`当前标签：${local.tag}`);
  if (local.dirty) warn('当前部署目录存在未提交改动（git 工作区不干净），更新会覆盖这些改动');
  if (!local.commit) warn('未读到 git 提交信息且没有 build-info.json，无法精确判断是否需要更新');
}

// ── 拉取/下载 ──

/**
 * 流式下载 URL 到本地文件
 * @returns {Promise<{bytes:number, elapsedMs:number}>}
 */
async function downloadToFile(cfg, url, dest, label) {
  const headers = Object.assign({}, updateSync.githubHeaders(cfg), { Accept: 'application/octet-stream' });
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (e) {
    throw new Error(`${label} 下载失败: ${e && e.message ? e.message : e}`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`${label} 下载失败: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length') || 0);
  info(`${label} 开始下载${total ? `（${fmtBytes(total)}）` : ''} → ${path.basename(dest)}`);

  let received = 0;
  let lastLog = 0;
  const reader = Readable.fromWeb(res.body);
  const writer = fs.createWriteStream(dest);
  reader.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (opts.verbose && now - lastLog > 3000) {
      lastLog = now;
      const pct = total ? `（${((received / total) * 100).toFixed(0)}%）` : '';
      info(`  已接收 ${fmtBytes(received)}${pct}`);
    }
  });
  await new Promise((resolve, reject) => {
    reader.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
    reader.pipe(writer);
  });
  const elapsedMs = Date.now() - startedAt;
  info(`${label} 下载完成：${fmtBytes(received)}，耗时 ${(elapsedMs / 1000).toFixed(1)}s`);
  return { bytes: received, elapsedMs };
}

/**
 * 下载 Release 的产物与 SHA256SUMS.txt 到临时目录
 * @returns {Promise<{artifactFile:string, artifactAsset:object, sumsFile:string|null, sumsAsset:object|null}>}
 */
async function downloadReleaseArtifacts(cfg, release, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const assets = release.assets || {};
  const artifactAsset = assets.tarGz || assets.zip;
  if (!artifactAsset) {
    throw new Error('该 Release 没有 .tar.gz / .zip 产物，无法自动更新（请检查 CI 产物命名）');
  }
  const artifactName = path.basename(artifactAsset.name || 'artifact.tar.gz');
  const artifactFile = path.join(workDir, artifactName);
  await downloadToFile(cfg, artifactAsset.url, artifactFile, '产物');

  let sumsFile = null;
  if (assets.sums) {
    sumsFile = path.join(workDir, path.basename(assets.sums.name || 'SHA256SUMS.txt'));
    await downloadToFile(cfg, assets.sums.url, sumsFile, '校验清单');
  } else if (!opts.skipVerify) {
    throw new Error('Release 缺少 SHA256SUMS.txt 校验清单；如确需跳过校验请加 --skip-verify');
  }
  return { artifactFile, artifactAsset: { name: artifactName, size: artifactAsset.size || 0 }, sumsFile, sumsAsset: assets.sums || null };
}

/**
 * 按 SHA256SUMS.txt 校验产物
 * @returns {Promise<{ok:boolean, expected:string, actual:string, message:string}>}
 */
async function verifyChecksum(artifactFile, sumsFile) {
  if (!sumsFile) {
    return { ok: false, skipped: true, expected: '', actual: '', message: '未提供 SHA256SUMS.txt' };
  }
  const base = path.basename(artifactFile);
  const rawSums = fs.readFileSync(sumsFile, 'utf8');
  const text = rawSums.charCodeAt(0) === 0xfeff ? rawSums.slice(1) : rawSums;
  let expected = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // 兼容 "hash  file" 与 "hash *file" 两种格式
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) continue;
    if (path.basename(match[2].trim()) === base) {
      expected = match[1].toLowerCase();
      break;
    }
  }
  if (!expected) {
    return { ok: false, skipped: false, expected: '', actual: '', message: `SHA256SUMS.txt 中没有找到 ${base} 的记录` };
  }
  const actual = await sha256File(artifactFile);
  return { ok: actual === expected, expected, actual, message: actual === expected ? '校验通过' : 'SHA256 不一致' };
}

// ── 解包 ──

/** 系统命令是否可用 */
function hasCommand(cmd, args = ['--version']) {
  try {
    const res = spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout: 8000 });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * 执行外部命令并用「真实文件 fd」捕获输出。
 * 不用管道的原因：管道在某些受限环境/容器里可能不可用，且大输出可能阻塞；
 * 这里把 stdout/stderr 都写进 tmpDir 下的日志文件，失败时读取末尾几行做提示。
 */
function runCommandCapture(cmd, args, { timeoutMs = 10 * 60 * 1000, logDir } = {}) {
  const dir = logDir || os.tmpdir();
  let logFile = '';
  let fd = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, `cmd-${Date.now()}-${crypto.randomBytes(2).toString('hex')}.log`);
    fd = fs.openSync(logFile, 'w');
    const res = spawnSync(cmd, args, { stdio: ['ignore', fd, fd], windowsHide: true, timeout: timeoutMs });
    let output = '';
    try { output = fs.readFileSync(logFile, 'utf8'); } catch (_) {}
    return { status: res.error ? -1 : res.status, error: res.error || null, output };
  } catch (e) {
    return { status: -1, error: e, output: '' };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    if (logFile) {
      try { fs.unlinkSync(logFile); } catch (_) {}
    }
  }
}

/** 选择解包方式：Windows 用自带 bsdtar（支持 tar.gz / zip），Linux 用 tar + unzip */
function detectExtractor() {
  if (!hasCommand('tar', ['--version'])) return null;
  return {
    tarAvailable: true,
    unzipAvailable: hasCommand('unzip', ['-v']),
    platform: process.platform,
  };
}

/** 解包产物到 staging 目录 */
function extractArchive(cfg, file, stagingDir, extractor) {
  fs.mkdirSync(stagingDir, { recursive: true });
  const isZip = /\.zip$/i.test(file);
  let cmd;
  let args;
  if (isZip) {
    // Windows 自带的 bsdtar / libarchive 能直接解 zip；Linux 的 GNU tar 不能，改用 unzip
    if (extractor.platform === 'win32') {
      cmd = 'tar';
      args = ['-xf', file, '-C', stagingDir];
    } else if (extractor.unzipAvailable) {
      cmd = 'unzip';
      args = ['-q', '-o', file, '-d', stagingDir];
    } else {
      throw new Error('系统缺少 unzip，无法解包 .zip 产物（建议发布/下载 .tar.gz）');
    }
  } else {
    cmd = 'tar';
    args = ['-xzf', file, '-C', stagingDir];
  }
  const res = runCommandCapture(cmd, args, { logDir: cfg.tmpDir });
  if (res.error) {
    const reason = res.error.code === 'EPERM'
      ? '无权执行解包命令（EPERM）'
      : (res.error.message || String(res.error));
    throw new Error(`解包失败（${cmd}）：${reason}`);
  }
  if (res.status !== 0) {
    const tail = String(res.output || '').trim().split(/\r?\n/).slice(-3).join(' / ');
    throw new Error(`解包失败（${cmd} 退出码 ${res.status}）：${tail}`);
  }
}

/**
 * 归档里若只有单一顶层目录（含 package.json），把它当作源码根
 * @returns {string} 源码根目录
 */
function resolveSourceRoot(stagingDir) {
  let root = stagingDir;
  for (let depth = 0; depth < 3; depth++) {
    const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.name !== '__MACOSX');
    if (entries.length === 1 && entries[0].isDirectory()) {
      const candidate = path.join(root, entries[0].name);
      if (exists(path.join(candidate, 'package.json'))) {
        root = candidate;
        continue;
      }
    }
    break;
  }
  return root;
}

/** 校验解包出来的目录结构是否像一份可部署的 CSES Cloud */
function validateSourceRoot(sourceRoot, { allowMissingDist = false } = {}) {
  const problems = [];
  if (!exists(path.join(sourceRoot, 'package.json'))) problems.push('缺少 package.json');
  if (!exists(path.join(sourceRoot, 'server', 'index.js'))) problems.push('缺少 server/index.js');
  if (!exists(path.join(sourceRoot, 'schema.sql'))) problems.push('缺少 schema.sql');
  const distIndex = path.join(sourceRoot, 'dist', 'index.html');
  if (!exists(distIndex) && !allowMissingDist) problems.push('缺少 dist/index.html（前端未构建）');
  return { ok: problems.length === 0, problems, distPresent: exists(distIndex) };
}

// ── 备份 ──

/** 递归复制目录（跳过保留名单中的任意层级条目；实现在 server/lib/update-sync.js，便于复用与单测） */
function copyTreeFiltered(cfg, srcRoot, destRoot, options = {}) {
  return updateSync.copyTreeFiltered(cfg, srcRoot, destRoot, options);
}

/**
 * 创建备份：把当前部署的「代码部分」复制到 data/update/backups/<stamp>-<commit>/，
 * 并写入 meta.json 供回滚识别。data/、node_modules/、.git/、.env* 等运行期内容不备份。
 */
function createBackup(cfg, jobId, from, to) {
  const name = `${stampName()}-${(from && from.short_commit) || 'unknown'}`;
  const dir = path.join(cfg.backupDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const stats = copyTreeFiltered(cfg, cfg.installDir, dir);
  const meta = {
    name,
    created_at: new Date().toISOString(),
    action: 'apply',
    job_id: jobId,
    host: safeHostname(),
    install_dir: cfg.installDir,
    from: from || {},
    to: to || {},
    files: stats.files,
    bytes: stats.bytes,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return { name, dir, meta, stats };
}

function safeHostname() {
  try {
    return os.hostname();
  } catch (_) {
    return '';
  }
}

// ── 替换（镜像同步） ──

/**
 * 把 srcRoot 的代码镜像同步到 destRoot（实现在 server/lib/update-sync.js）：
 *   - src 有 dest 没有 → 复制；dest 有 src 没有 → 删除；两边都有 → 覆盖
 *   - 命中保留名单（data / node_modules / .git / .env* …）的任意层级条目不覆盖也不删除
 */
function mirrorInto(cfg, srcRoot, destRoot, options = {}) {
  return updateSync.mirrorInto(cfg, srcRoot, destRoot, options);
}

// ── 外部命令 / 健康检查 ──

/** 执行 shell 命令，输出继承到当前进程（会写进任务的日志文件） */
function runShellCommand(cmd, { cwd, timeoutMs = 120000, label = '' } = {}) {
  return new Promise((resolve) => {
    info(`$ ${label || '执行命令'}：${updateSync.maskCommand(cmd)}`);
    let child;
    try {
      child = spawn(cmd, { cwd, shell: true, windowsHide: true, stdio: 'inherit', env: process.env });
    } catch (e) {
      resolve({ ok: false, error: e && e.message ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, error: `命令超时（${Math.round(timeoutMs / 1000)}s）` });
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e && e.message ? e.message : String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, error: code === 0 ? '' : `退出码 ${code}` });
    });
  });
}

/**
 * 轮询健康检查地址，直到返回正常或超时
 * @returns {Promise<{ok:boolean, status:number, elapsed_ms:number, url:string, error:string}>}
 */
async function healthcheck(cfg) {
  const startedAt = Date.now();
  const url = cfg.healthcheckUrl;
  const timeoutMs = cfg.healthcheckTimeoutMs;
  let last = { ok: false, status: 0, error: '未执行' };
  info(`健康检查：${url}（最长等待 ${Math.round(timeoutMs / 1000)}s）`);
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'cses-cloud-update-sync' },
        signal: AbortSignal.timeout(Math.min(10000, timeoutMs)),
      });
      let data = null;
      const text = await res.text().catch(() => '');
      try { data = text ? JSON.parse(text) : null; } catch (_) {}
      const payloadOk = !data || data.code === undefined || data.code === 0;
      if (res.ok && payloadOk) {
        return { ok: true, status: res.status, elapsed_ms: Date.now() - startedAt, url, error: '' };
      }
      last = {
        ok: false,
        status: res.status,
        error: (data && data.message) ? String(data.message) : `HTTP ${res.status}`,
      };
    } catch (e) {
      last = { ok: false, status: 0, error: e && e.message ? e.message : String(e) };
    }
    await sleep(Math.max(500, cfg.healthcheckIntervalMs));
  }
  return Object.assign({ ok: false, elapsed_ms: Date.now() - startedAt, url }, last);
}

/** 重启服务（未配置重启命令时返回 skipped） */
async function restartService(cfg) {
  if (!cfg.restartCmd) {
    warn('未配置 UPDATE_RESTART_CMD / UPDATE_SERVICE，跳过服务重启（新代码将在下次手工重启后生效）');
    return { ok: true, skipped: true, message: '未配置重启命令' };
  }
  const res = await runShellCommand(cfg.restartCmd, {
    cwd: cfg.installDir,
    timeoutMs: 180000,
    label: '重启服务',
  });
  if (res.ok) info('服务重启命令执行成功');
  return res;
}

// ── 检查更新 ──

async function runCheck() {
  const cfg = updateSync.getConfig();
  const result = {
    ok: true,
    action: 'check',
    dry_run: opts.dryRun,
    started_at: new Date().toISOString(),
    finished_at: '',
    enabled: cfg.enabled,
    config: updateSync.publicConfig(cfg),
    local: collectLocal(),
    update_available: false,
    recommended_action: 'none',
    release: null,
    branch_head: null,
    notes: [],
    errors: [],
  };

  if (!opts.json) {
    log(COLOR.bold('检查上游更新'));
    printLocalSummary(cfg, result.local);
    if (!cfg.enabled) {
      warn('UPDATE_SYNC_ENABLED 未开启：管理接口不可用（命令行脚本不受此开关限制）');
    }
  }

  const remote = await updateSync.checkForUpdate(cfg, {
    version: result.local.version,
    commit: result.local.commit,
    shortCommit: result.local.short_commit,
    branch: result.local.branch,
    tag: result.local.tag,
    buildTime: result.local.build_time,
    dirty: result.local.dirty,
    sources: result.local.sources,
  }, { tag: opts.tag });

  result.update_available = remote.update_available;
  result.recommended_action = remote.recommended_action;
  result.release = remote.release;
  result.branch_head = remote.branch_head;
  result.notes = remote.notes;
  result.errors = remote.errors;
  result.ok = remote.ok !== false;
  result.finished_at = new Date().toISOString();
  if (!result.ok) {
    result.error = remote.message || '无法访问 GitHub API，检查更新失败（网络或限流问题）';
    result.summary = '';
  } else {
    result.summary = result.update_available
      ? (result.recommended_action === 'apply-release' ? '发现可部署的新版本' : '上游有更新（暂无可用 Release 产物）')
      : '当前部署已是最新';
  }

  if (!opts.json) {
    // ── 上游 Release ──
    if (remote.release) {
      const rel = remote.release;
      const asset = rel.artifact ? `${rel.artifact.name}（${fmtBytes(rel.artifact.size)}）` : '无可用产物';
      info(`上游 Release：${rel.tag}  发布 ${fmtTime(rel.publishedAt)}  产物 ${asset}`);
      info(`  ${rel.matches_local ? '与本地一致' : '与本地不同'}${rel.is_newer ? '（可更新）' : ''}`);
    }
    // ── 分支最新提交 ──
    if (remote.branch_head) {
      const head = remote.branch_head;
      info(`分支 ${cfg.branch} 最新提交：${head.shortSha}  ${fmtTime(head.date)}  ${head.message}`);
      info(`  ${head.matches_local_commit ? '与本地一致' : '与本地不同'}`);
    }
    for (const note of result.notes) warn(note);
    for (const error of result.errors) warn(error);
    if (!result.ok) {
      fail('结论：检查失败（无法访问 GitHub API，请检查网络/代理，或配置 UPDATE_GITHUB_TOKEN 提升限流上限）');
    } else if (result.recommended_action === 'apply-release') {
      log(COLOR.green('结论：有新版本可用 → 执行 `pnpm sync:apply` 或 `node scripts/sync-production.mjs --apply`'), 'ok');
    } else if (result.recommended_action === 'wait-release' || result.recommended_action === 'branch-ahead') {
      log(COLOR.yellow('结论：上游有更新，但当前没有可部署的 Release 产物（等 CI 发布 Release 后再执行 --apply）'), 'warn');
    } else if (result.update_available) {
      log(COLOR.yellow('结论：上游有更新，但无法确定可部署产物，请人工确认'), 'warn');
    } else {
      info('结论：当前部署已是最新');
    }
  }

  return result;
}

// ── 正式更新 ──

/** 收集步骤日志的简单计时器 */
function makeStepper(total) {
  let index = 0;
  const steps = [];
  return {
    steps,
    begin(title) {
      index++;
      const t0 = Date.now();
      if (!opts.json) log(COLOR.bold(`[${index}/${total}] ${title}`), 'step');
      return {
        done(extra = '') {
          const ms = Date.now() - t0;
          steps.push({ step: index, title, ok: true, ms });
          if (extra) info(extra);
        },
      };
    },
  };
}

/**
 * 从备份恢复到部署目录（保留 data/ 等运行期内容）
 */
async function restoreBackup(cfg, backup, { restart = true } = {}) {
  const stats = mirrorInto(cfg, backup.dir, cfg.installDir, { excludeTop: ['meta.json'] });
  info(`已从备份 ${backup.name} 恢复代码：写入/覆盖 ${stats.copied} 项，删除 ${stats.removed} 项`);
  const out = { restored: stats, restart: null, healthcheck: null };
  if (restart) {
    out.restart = await restartService(cfg);
    if (cfg.restartCmd) {
      out.healthcheck = await healthcheck(cfg);
      if (out.healthcheck.ok) ok('回滚后健康检查通过');
      else fail(`回滚后健康检查失败：${out.healthcheck.error}`);
    }
  }
  return out;
}

async function runApply(jobId) {
  const cfg = updateSync.getConfig();
  const T = 9; // 预检查 + 8 个步骤
  const stepper = makeStepper(T);
  const startedAt = new Date().toISOString();
  const result = {
    ok: false,
    action: 'apply',
    job_id: jobId,
    dry_run: opts.dryRun,
    started_at: startedAt,
    finished_at: '',
    install_dir: cfg.installDir,
    config: updateSync.publicConfig(cfg),
    local: null,
    target: null,
    backup: null,
    install: null,
    restart: null,
    healthcheck: null,
    steps: stepper.steps,
    rolled_back: false,
    error: '',
    summary: '',
  };

  // ── 0. 预检查 + 加锁 ──
  const pre = stepper.begin('预检查（目录 / 解包工具 / 并发锁 / 配置）');
  if (!exists(path.join(cfg.installDir, 'package.json'))) {
    throw new Error(`部署目录不像 CSES Cloud（缺少 package.json）：${cfg.installDir}`);
  }
  if (!exists(path.join(cfg.installDir, 'server', 'index.js'))) {
    throw new Error(`部署目录缺少 server/index.js：${cfg.installDir}`);
  }
  const extractor = detectExtractor();
  if (!extractor) {
    throw new Error('系统缺少 tar 命令，无法解包产物（Windows 10+ 自带 bsdtar，Linux 一般为 GNU tar）');
  }
  if (!cfg.restartCmd) {
    warn('未配置 UPDATE_RESTART_CMD / UPDATE_SERVICE：更新后不会自动重启服务');
  }
  result.local = collectLocal();
  if (!opts.json) printLocalSummary(cfg, result.local);

  if (!opts.dryRun) {
    const locked = updateSync.acquireLock(cfg, { job_id: jobId, action: 'apply' });
    if (!locked.ok) {
      const holder = locked.holder || {};
      throw new Error(`${locked.error}${holder.pid ? `（持有者 pid=${holder.pid} 主机=${holder.host || '?'} 开始于 ${holder.started_at || '?'}）` : ''}`);
    }
  } else {
    info('演练模式：不会下载/替换/重启（只做只读检查与步骤预览）');
  }
  pre.done();

  try {
    // ── 1. 查询上游 Release ──
    const s1 = stepper.begin('查询上游 Release');
    const releaseRes = await updateSync.getLatestRelease(cfg, { tag: opts.tag });
    if (!releaseRes.ok) throw new Error(releaseRes.error || '查询 Release 失败');
    if (!releaseRes.exists) {
      throw new Error(opts.tag
        ? `未找到 Release ${opts.tag}`
        : '上游暂无 Release（CI 可能尚未发布产物）；可先用 --check 查看分支是否有新提交');
    }
    const release = releaseRes.release;
    if (!release.assets.tarGz && !release.assets.zip) {
      throw new Error('Release 中没有 .tar.gz / .zip 产物，无法自动更新');
    }
    if (!release.assets.sums && !opts.skipVerify) {
      throw new Error('Release 缺少 SHA256SUMS.txt；如确需跳过校验请加 --skip-verify');
    }
    result.target = {
      tag: release.tag,
      name: release.name,
      published_at: release.publishedAt,
      artifact: (release.assets.tarGz || release.assets.zip).name,
      artifact_size: (release.assets.tarGz || release.assets.zip).size,
      url: release.url,
    };
    s1.done(`目标版本：${release.tag}（产物 ${result.target.artifact}）`);

    // ── 2. 下载产物（演练模式也下载，用于校验产物是否可用；但不改动部署目录） ──
    const s2 = stepper.begin('下载产物与校验清单');
    const workDir = path.join(cfg.tmpDir, `download-${jobId}`);
    const stagingDir = path.join(cfg.tmpDir, `staging-${jobId}`);
    result.tmp = { download_dir: workDir, staging_dir: stagingDir };
    let sourceRoot = '';
    let artifactReady = false;
    try {
      rmrf(workDir);
      rmrf(stagingDir);
      const downloaded = await downloadReleaseArtifacts(cfg, release, workDir);
      result.target.local_file = downloaded.artifactFile;
      result.target.sums_file = downloaded.sumsFile;
      artifactReady = true;
      s2.done(opts.dryRun ? '演练模式：已下载产物用于校验（不会替换部署）' : '');
    } catch (e) {
      if (!opts.dryRun) throw e;
      warn('演练模式：产物下载失败，跳过后续产物校验：' + (e && e.message ? e.message : e));
      s2.done('已跳过（下载失败）');
    }

    // ── 3. 校验 SHA256 ──
    const s3 = stepper.begin('校验产物完整性（SHA256）');
    if (!artifactReady) {
      s3.done('跳过（未拿到产物）');
    } else if (opts.skipVerify) {
      warn('已按 --skip-verify 跳过 SHA256 校验');
      s3.done('已跳过');
    } else {
      try {
        const verify = await verifyChecksum(result.target.local_file, result.target.sums_file);
        result.verify = verify;
        if (!verify.ok) throw new Error(`产物校验失败：${verify.message}`);
        s3.done(`校验通过（${verify.actual.slice(0, 16)}…）`);
      } catch (e) {
        if (!opts.dryRun) throw e;
        warn('演练模式：' + (e && e.message ? e.message : e));
        s3.done('校验未通过（演练模式继续）');
      }
    }

    // ── 4. 解包到 staging 并校验目录结构 ──
    const s4 = stepper.begin('解包到 staging 并校验目录结构');
    if (!artifactReady) {
      s4.done('跳过（未拿到产物）');
    } else {
      try {
        extractArchive(cfg, result.target.local_file, stagingDir, extractor);
        sourceRoot = resolveSourceRoot(stagingDir);
        const validation = validateSourceRoot(sourceRoot, { allowMissingDist: opts.allowMissingDist });
        result.validation = validation;
        if (!validation.ok) throw new Error('产物结构不完整：' + validation.problems.join('；'));
        const stagedInfo = readJsonSafe(path.join(sourceRoot, 'build-info.json')) || {};
        result.target.build_info = stagedInfo;
        result.target.commit = String(stagedInfo.commit || '');
        result.target.version = String(stagedInfo.version || '');
        s4.done(
          '解包完成，产物包含 '
          + [stagedInfo.version ? `版本 ${stagedInfo.version}` : '',
            stagedInfo.commit ? `提交 ${String(stagedInfo.commit).slice(0, 7)}` : '',
            stagedInfo.buildTime ? `构建于 ${fmtTime(stagedInfo.buildTime)}` : '']
            .filter(Boolean).join(' / ')
        );
      } catch (e) {
        if (!opts.dryRun) throw e;
        warn('演练模式：' + (e && e.message ? e.message : e));
        sourceRoot = '';
        s4.done('解包/结构校验失败（演练模式继续）');
      }
    }

    // ── 5. 备份当前部署 ──
    const s5 = stepper.begin('备份当前部署');
    let backup = null;
    if (opts.dryRun) {
      s5.done(`演练模式不创建备份（正式运行会备份到 ${cfg.backupDir}/${stampName()}-<commit>/）`);
    } else {
      backup = createBackup(cfg, jobId, result.local, result.target);
      result.backup = { name: backup.name, dir: backup.dir, files: backup.stats.files, bytes: backup.stats.bytes };
      s5.done(`备份完成：${backup.name}（${backup.stats.files} 个文件，${fmtBytes(backup.stats.bytes)}）`);
    }

    // ── 6. 替换代码（保留运行期目录） ──
    const s6 = stepper.begin('替换部署代码（保留 data/、node_modules/、.env、.git 等）');
    if (opts.dryRun) {
      if (sourceRoot) {
        // 演练：用真实产物预演差异（dryRun 不写盘）
        const preview = mirrorInto(cfg, sourceRoot, cfg.installDir, { dryRun: true });
        s6.done(`演练模式：预计写入/覆盖 ${preview.copied} 项、删除 ${preview.removed} 项、跳过保留 ${preview.skipped} 项`);
      } else {
        s6.done('演练模式：正式运行会按产物镜像覆盖代码，仅保留 ' + cfg.preserve.join(' / '));
      }
    } else {
      const oldLockHash = fileHash(path.join(cfg.installDir, 'pnpm-lock.yaml'));
      const stats = mirrorInto(cfg, sourceRoot, cfg.installDir);
      result.replace = stats;
      const newLockHash = fileHash(path.join(cfg.installDir, 'pnpm-lock.yaml'));
      result.lockfile_changed = oldLockHash !== newLockHash;
      s6.done(`替换完成：写入/覆盖 ${stats.copied} 项，删除 ${stats.removed} 项，跳过保留 ${stats.skipped} 项`);
    }

    // ── 7. 依赖安装 ──
    const s7 = stepper.begin('安装后端依赖（按需）');
    const nodeModulesExists = exists(path.join(cfg.installDir, 'node_modules'));
    const needInstall = opts.forceInstall
      || (!nodeModulesExists)
      || (result.lockfile_changed === true && !opts.noInstall);
    if (opts.dryRun) {
      if (!nodeModulesExists) {
        s7.done(`演练模式：node_modules 缺失，将执行「${cfg.installCmd}」`);
      } else {
        s7.done(`演练模式：lockfile 变化时才执行「${cfg.installCmd}」（当前 node_modules 已存在）`);
      }
    } else if (!needInstall) {
      s7.done('lockfile 未变化且 node_modules 存在，跳过依赖安装');
    } else if (opts.noInstall) {
      warn('按 --no-install 跳过依赖安装，请确认依赖仍然可用');
      s7.done('已跳过');
    } else {
      // 首次部署或 lockfile 变化时才安装；前端 dist 已由 CI 构建好，这里只装后端依赖
      const installRes = await runShellCommand(cfg.installCmd, {
        cwd: cfg.installDir,
        timeoutMs: 30 * 60 * 1000,
        label: '安装依赖',
      });
      result.install = installRes;
      if (!installRes.ok) throw new Error(`依赖安装失败：${installRes.error}`);
      s7.done('依赖安装完成');
    }

    // ── 8. 重启服务 + 健康检查 ──
    const s8 = stepper.begin('重启服务并做健康检查');
    if (opts.dryRun) {
      s8.done(`演练模式：${cfg.restartCmd ? `将执行「${updateSync.maskCommand(cfg.restartCmd)}」` : '未配置重启命令，将跳过重启'}`
        + `，然后请求 ${cfg.healthcheckUrl}`);
    } else {
      result.restart = await restartService(cfg);
      if (result.restart.ok === false) {
        throw new Error(`服务重启失败：${result.restart.error}`);
      }
      if (cfg.restartCmd) {
        result.healthcheck = await healthcheck(cfg);
        if (!result.healthcheck.ok) {
          throw new Error(`健康检查失败：${result.healthcheck.error}（${result.healthcheck.status || '无响应'}）`);
        }
        ok(`健康检查通过（${result.healthcheck.elapsed_ms}ms）`);
      } else {
        warn('未配置重启命令，跳过健康检查（新代码尚未生效）');
      }
      s8.done();
    }

    // ── 成功收尾 ──
    result.ok = true;
    if (opts.dryRun) {
      result.summary = '演练完成，未做任何改动';
    } else {
      const pruned = updateSync.pruneBackups(cfg);
      if (pruned.length) info(`已清理旧备份：${pruned.join(', ')}`);
      result.summary = `已更新到 ${result.target.tag}`
        + (result.target.commit ? `（${String(result.target.commit).slice(0, 7)}）` : '');
    }
    // 清理临时下载/解包目录（失败时保留，便于排查）
    if (result.tmp) {
      rmrf(result.tmp.download_dir);
      rmrf(result.tmp.staging_dir);
    }
    return result;
  } catch (e) {
    result.error = e && e.message ? e.message : String(e);
    // 失败自动回滚：仅当已经动过部署目录
    if (!opts.dryRun && result.backup && !result.rolled_back) {
      fail(`更新失败，开始自动回滚到备份 ${result.backup.name}`);
      try {
        result.rollback = await restoreBackup(cfg, { name: result.backup.name, dir: result.backup.dir });
        result.rolled_back = true;
        result.error += '（已自动回滚到更新前状态）';
        warn('已自动回滚，请检查上方失败原因后重试');
      } catch (rollbackError) {
        result.rolled_back = false;
        result.error += `；自动回滚也失败：${rollbackError && rollbackError.message ? rollbackError.message : rollbackError}`;
        fail('自动回滚失败！请手工用备份恢复：' + (result.backup ? result.backup.dir : ''));
      }
    }
    return result;
  } finally {
    result.finished_at = new Date().toISOString();
    if (!opts.dryRun) updateSync.releaseLock(cfg);
  }
}

/** 文件 sha256（不存在返回空串，用于判断 lockfile 是否变化） */
function fileHash(file) {
  try {
    if (!exists(file)) return '';
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return '';
  }
}

// ── 回滚 ──

async function runRollback(jobId) {
  const cfg = updateSync.getConfig();
  const T = 5; // 预检查 + 3 个步骤 + 收尾
  const stepper = makeStepper(T);
  const result = {
    ok: false,
    action: 'rollback',
    job_id: jobId,
    dry_run: opts.dryRun,
    started_at: new Date().toISOString(),
    finished_at: '',
    install_dir: cfg.installDir,
    config: updateSync.publicConfig(cfg),
    backup: null,
    restart: null,
    healthcheck: null,
    steps: stepper.steps,
    error: '',
    summary: '',
  };

  const pre = stepper.begin('预检查并选择备份');
  if (!exists(path.join(cfg.installDir, 'package.json'))) {
    throw new Error(`部署目录不像 CSES Cloud（缺少 package.json）：${cfg.installDir}`);
  }
  if (!opts.dryRun) {
    const locked = updateSync.acquireLock(cfg, { job_id: jobId, action: 'rollback' });
    if (!locked.ok) throw new Error(locked.error);
  }
  let backup;
  if (opts.backup) {
    const direct = path.isAbsolute(opts.backup) ? opts.backup : path.join(cfg.backupDir, opts.backup);
    const all = updateSync.listBackups(cfg);
    const matched = all.find((b) => b.name === opts.backup) || null;
    const dir = matched ? matched.dir : direct;
    if (!exists(dir)) throw new Error(`找不到备份：${opts.backup}`);
    backup = matched || { name: path.basename(dir), dir, createdAt: '', meta: readJsonSafe(path.join(dir, 'meta.json')) };
  } else {
    backup = updateSync.latestBackup(cfg);
  }
  if (!backup) throw new Error(`没有可用的备份（备份目录：${cfg.backupDir}）`);
  result.backup = {
    name: backup.name,
    dir: backup.dir,
    created_at: (backup.meta && backup.meta.created_at) || backup.createdAt || '',
    from: (backup.meta && backup.meta.from) || null,
    to: (backup.meta && backup.meta.to) || null,
  };
  pre.done(`将回滚到备份：${backup.name}`
    + (result.backup.from && result.backup.from.short_commit ? `（更新前提交 ${result.backup.from.short_commit}）` : ''));

  try {
    // ── 1. 恢复文件 ──
    const s1 = stepper.begin('从备份恢复部署代码');
    if (opts.dryRun) {
      const preview = mirrorInto(cfg, backup.dir, cfg.installDir, { excludeTop: ['meta.json'], dryRun: true });
      s1.done(`演练模式：预计写入/覆盖 ${preview.copied} 项、删除 ${preview.removed} 项`);
    } else {
      const stats = mirrorInto(cfg, backup.dir, cfg.installDir, { excludeTop: ['meta.json'] });
      result.restore = stats;
      s1.done(`恢复完成：写入/覆盖 ${stats.copied} 项，删除 ${stats.removed} 项`);
    }

    // ── 2. 依赖（备份不含 node_modules，通常无需重装） ──
    const s2 = stepper.begin('检查依赖');
    if (!exists(path.join(cfg.installDir, 'node_modules'))) {
      if (opts.dryRun) {
        s2.done(`演练模式：node_modules 缺失，将执行「${cfg.installCmd}」`);
      } else if (opts.noInstall) {
        warn('node_modules 缺失且指定了 --no-install，请手工安装依赖');
        s2.done('已跳过');
      } else {
        const installRes = await runShellCommand(cfg.installCmd, {
          cwd: cfg.installDir,
          timeoutMs: 30 * 60 * 1000,
          label: '安装依赖',
        });
        result.install = installRes;
        if (!installRes.ok) throw new Error(`依赖安装失败：${installRes.error}`);
        s2.done('依赖安装完成');
      }
    } else {
      s2.done('node_modules 存在，沿用现有依赖');
    }

    // ── 3. 重启 + 健康检查 ──
    const s3 = stepper.begin('重启服务并做健康检查');
    if (opts.dryRun) {
      s3.done(`演练模式：${cfg.restartCmd ? `将执行「${updateSync.maskCommand(cfg.restartCmd)}」` : '未配置重启命令，将跳过重启'}`
        + `，然后请求 ${cfg.healthcheckUrl}`);
    } else {
      result.restart = await restartService(cfg);
      if (result.restart.ok === false) throw new Error(`服务重启失败：${result.restart.error}`);
      if (cfg.restartCmd) {
        result.healthcheck = await healthcheck(cfg);
        if (!result.healthcheck.ok) throw new Error(`回滚后健康检查失败：${result.healthcheck.error}`);
        ok(`回滚后健康检查通过（${result.healthcheck.elapsed_ms}ms）`);
      } else {
        warn('未配置重启命令，跳过健康检查（旧代码将在下次手工重启后生效）');
      }
      s3.done();
    }

    const s4 = stepper.begin('收尾');
    result.ok = true;
    result.summary = opts.dryRun ? '演练完成，未做任何改动' : `已回滚到备份 ${backup.name}`;
    s4.done();
    return result;
  } catch (e) {
    result.error = e && e.message ? e.message : String(e);
    return result;
  } finally {
    result.finished_at = new Date().toISOString();
    if (!opts.dryRun) updateSync.releaseLock(cfg);
  }
}

// ── 入口 ──

async function main() {
  try {
    parseArgs(process.argv.slice(2));
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
    return 2;
  }

  if (opts.help) {
    printHelp();
    return 0;
  }

  // 检查模式：只读，不需要锁，不写状态
  if (opts.action === 'check') {
    try {
      const result = await runCheck();
      emitResult(result);
      if (!result.ok) return 1;
      if (opts.exitCode) return result.update_available ? 10 : 11;
      return 0;
    } catch (e) {
      fail(e && e.message ? e.message : String(e));
      emitResult({ ok: false, action: 'check', error: e && e.message ? e.message : String(e) });
      return 1;
    }
  }

  // 写操作：apply / rollback
  const cfg = updateSync.getConfig();
  const jobId = opts.jobId || updateSync.newJobId(opts.action);
  const logFile = updateSync.jobLogFile(cfg, jobId);
  updateSync.ensureDirs(cfg);

  if (!opts.yes && !opts.dryRun) {
    // 非交互环境不得卡在确认提示上
    if (!process.stdin.isTTY) {
      fail('非交互环境执行写操作必须显式加 --yes 确认');
      return 2;
    }
    info(`即将执行「${opts.action === 'apply' ? '更新部署' : '回滚'}」，5 秒后开始（Ctrl+C 取消）…`);
    await sleep(5000);
  }

  // 状态记录：running → finished（管理接口靠它展示进度）
  try {
    if (!opts.dryRun) {
      updateSync.markRunning(cfg, {
        job_id: jobId,
        action: opts.action,
        pid: process.pid,
        log_file: logFile,
        started_at: new Date().toISOString(),
      });
    }
  } catch (_) {
    // 状态写入失败不影响同步本身
  }

  let result;
  try {
    result = opts.action === 'apply' ? await runApply(jobId) : await runRollback(jobId);
  } catch (e) {
    result = {
      ok: false,
      action: opts.action,
      job_id: jobId,
      error: e && e.message ? e.message : String(e),
      finished_at: new Date().toISOString(),
    };
  }

  try {
    if (!opts.dryRun) {
      updateSync.markFinished(cfg, {
        jobId,
        action: opts.action,
        ok: result.ok === true,
        message: result.ok ? result.summary : result.error,
        logFile,
        result: {
          local: result.local,
          target: result.target,
          backup: result.backup,
          rolled_back: result.rolled_back === true,
          install_dir: result.install_dir,
        },
      });
    }
  } catch (_) {
    // 同上
  }

  emitResult(result);
  return result.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((e) => {
    fail((e && e.stack) || String(e));
    process.exit(1);
  });
