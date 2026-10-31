/**
 * CSES Cloud - 构建信息读取（生产端同步用）
 *
 * 优先级：
 *   1. 仓库根 `build-info.json`（由 CI 在打包时写入，字段：commit / branch / buildTime / version / tag）
 *   2. git 命令（git rev-parse / git log / git status，部署目录保留了 .git 时可用）
 *   3. 根 package.json 的 version
 *
 * 结果按文件 mtime 缓存，避免每个请求都 spawn git；需要强制刷新时传 { refresh: true }。
 * 任何一步失败都不会抛异常：该字段留空并在 `sources` 中记录实际来源，便于页面/日志展示。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 部署目录：允许用 UPDATE_INSTALL_DIR 指定（与 server/lib/update-sync.js 的 install_dir 保持一致），
// 未指定时默认为本文件所在仓库根。
const ROOT = process.env.UPDATE_INSTALL_DIR
  ? path.resolve(process.env.UPDATE_INSTALL_DIR)
  : path.join(__dirname, '..', '..');
const BUILD_INFO_FILE = path.join(ROOT, 'build-info.json');
const PACKAGE_FILE = path.join(ROOT, 'package.json');

/** 执行外部命令，失败返回 null（不抛异常，避免污染 API） */
function run(cmd, args, timeout = 3000) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: ROOT,
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      encoding: 'utf8',
    });
    return String(out).trim();
  } catch (_) {
    return null;
  }
}

// ── .git 直读（不 spawn 外部进程，服务器上更稳、更快） ──

/** 解析 .git 目录（支持 .git 文件指向真实 gitdir 的 worktree 场景） */
function resolveGitDir(root = ROOT) {
  const dotGit = path.join(root, '.git');
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isDirectory()) return dotGit;
  } catch (_) {
    return '';
  }
  try {
    const content = fs.readFileSync(dotGit, 'utf8').trim();
    const m = content.match(/^gitdir:\s*(.+)$/m);
    if (m) return path.resolve(root, m[1].trim());
  } catch (_) {}
  return '';
}

/** 读取一个 ref 指向的 commit sha（先查 refs 文件，再查 packed-refs） */
function readRef(gitDir, ref) {
  const file = path.join(gitDir, ref);
  try {
    const sha = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase();
  } catch (_) {}
  try {
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    for (const line of packed.split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{40})\s+(.+)$/i);
      if (m && m[2].trim() === ref) return m[1].toLowerCase();
    }
  } catch (_) {}
  return '';
}

/** 列出全部 refs（refs/heads/*、refs/tags/*），用于推断分支/标签 */
function listRefs(gitDir) {
  const out = [];
  const walk = (rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(gitDir, rel), { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const childRel = rel + '/' + entry.name;
      if (entry.isDirectory()) walk(childRel);
      else {
        const sha = readRef(gitDir, childRel);
        if (sha) out.push({ ref: childRel, sha });
      }
    }
  };
  walk('refs');
  try {
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    for (const line of packed.split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{40})\s+(refs\/.+)$/i);
      if (m && !out.some((r) => r.ref === m[2].trim())) {
        out.push({ ref: m[2].trim(), sha: m[1].toLowerCase() });
      }
    }
  } catch (_) {}
  return out;
}

/**
 * 从 .git 目录直接读取当前 HEAD 信息
 * @returns {{commit:string, branch:string, tag:string, buildTime:string}|null}
 */
function readGitMeta(root = ROOT) {
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null;

  let head = '';
  try {
    head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch (_) {
    return null;
  }

  let branch = '';
  let commit = '';
  if (head.startsWith('ref:')) {
    const ref = head.slice(4).trim();
    branch = ref.replace(/^refs\/heads\//, '');
    commit = readRef(gitDir, ref);
  } else if (/^[0-9a-f]{40}$/i.test(head)) {
    commit = head.toLowerCase(); // 分离 HEAD
  }
  if (!commit) return { commit: '', branch, tag: '', buildTime: '' };

  // 分支刚刚提交、refs 尚未落盘时，从 logs/HEAD 的最后一条补齐
  let buildTime = '';
  try {
    const logs = fs.readFileSync(path.join(gitDir, 'logs', 'HEAD'), 'utf8').trim().split(/\r?\n/);
    const last = logs[logs.length - 1] || '';
    const m = last.match(/^[0-9a-f]{40}\s+([0-9a-f]{40})\s+.*?(\d{9,})\s+([+-]\d{4})/);
    if (m) {
      if (!commit && m[1]) commit = m[1].toLowerCase();
      buildTime = new Date(Number(m[2]) * 1000).toISOString();
    }
  } catch (_) {}

  // 标签：优先精确指向当前 commit 的 tag
  let tag = '';
  const refs = listRefs(gitDir);
  const tagRef = refs.find((r) => r.ref.startsWith('refs/tags/') && r.sha === commit);
  if (tagRef) tag = tagRef.ref.replace(/^refs\/tags\//, '');

  return { commit, branch, tag, buildTime };
}

/** 从多个候选字段名中取第一个非空值 */
function pick(obj, names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null && String(obj[name]).trim() !== '') {
      return String(obj[name]).trim();
    }
  }
  return '';
}

/** 去掉 UTF-8 BOM（Windows 记事本/Set-Content 写出的 JSON 可能带 BOM，JSON.parse 会失败） */
function stripBom(text) {
  const s = String(text || '');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 读取 build-info.json（不存在或损坏返回 null） */
function readBuildInfoFile() {
  try {
    const raw = stripBom(fs.readFileSync(BUILD_INFO_FILE, 'utf8'));
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (_) {
    return null;
  }
}

/** 读取 package.json 版本号 */
function readPackageVersion() {
  try {
    const pkg = JSON.parse(stripBom(fs.readFileSync(PACKAGE_FILE, 'utf8')));
    return String(pkg.version || '');
  } catch (_) {
    return '';
  }
}

/** 取 build-info.json 的 mtime（用于缓存失效判断） */
function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (_) {
    return 0;
  }
}

let _cache = null; // { stamp: number, info: object }

/**
 * 获取构建信息
 * @param {object} [opts]
 * @param {boolean} [opts.refresh] 跳过缓存重新采集
 * @returns {{
 *   ok: boolean, version: string, commit: string, shortCommit: string, branch: string,
 *   buildTime: string, tag: string, dirty: boolean|null, sources: Record<string,string>,
 *   buildInfoFile: string, collectedAt: string
 * }}
 */
function getBuildInfo(opts = {}) {
  const stamp = mtimeOf(BUILD_INFO_FILE) + ':' + mtimeOf(PACKAGE_FILE);
  if (!opts.refresh && _cache && _cache.stamp === stamp) return { ..._cache.info };

  const sources = {};
  const info = {
    ok: true,
    version: '',
    commit: '',
    shortCommit: '',
    branch: '',
    buildTime: '',
    tag: '',
    dirty: null,
    sources,
    buildInfoFile: BUILD_INFO_FILE,
    collectedAt: new Date().toISOString(),
  };

  // ── 1. CI 产物 build-info.json ──
  const fileInfo = readBuildInfoFile();
  if (fileInfo) {
    info.version = pick(fileInfo, ['version', 'pkgVersion', 'appVersion']);
    info.commit = pick(fileInfo, ['commit', 'commit_sha', 'commitSha', 'sha', 'gitCommit']);
    info.branch = pick(fileInfo, ['branch', 'ref', 'gitBranch']);
    info.buildTime = pick(fileInfo, ['buildTime', 'build_time', 'builtAt', 'built_at', 'time']);
    info.tag = pick(fileInfo, ['tag', 'release', 'releaseTag']);
    if (info.version) sources.version = 'build-info.json';
    if (info.commit) sources.commit = 'build-info.json';
    if (info.branch) sources.branch = 'build-info.json';
    if (info.buildTime) sources.buildTime = 'build-info.json';
    if (info.tag) sources.tag = 'build-info.json';
  } else {
    sources.buildInfoFile = 'missing';
  }

  // ── 2. git 回退：优先直读 .git（不依赖外部进程），失败再尝试 git 命令 ──
  const gitMeta = readGitMeta();
  if (gitMeta) {
    if (!info.commit && gitMeta.commit) {
      info.commit = gitMeta.commit;
      sources.commit = '.git';
    }
    if (!info.branch && gitMeta.branch) {
      info.branch = gitMeta.branch;
      sources.branch = '.git';
    }
    if (!info.buildTime && gitMeta.buildTime) {
      info.buildTime = gitMeta.buildTime;
      sources.buildTime = '.git/logs';
    }
    if (!info.tag && gitMeta.tag) {
      info.tag = gitMeta.tag;
      sources.tag = '.git';
    }
  }

  if (!info.commit) {
    const sha = run('git', ['rev-parse', 'HEAD']);
    if (sha && /^[0-9a-f]{7,40}$/i.test(sha)) {
      info.commit = sha;
      sources.commit = 'git';
    }
  }
  if (!info.branch) {
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    // 分离 HEAD 时 git 返回 "HEAD"，无意义
    if (branch && branch !== 'HEAD') {
      info.branch = branch;
      sources.branch = 'git';
    }
  }
  if (!info.buildTime) {
    const ct = run('git', ['log', '-1', '--format=%cI']);
    if (ct) {
      info.buildTime = ct;
      sources.buildTime = 'git-commit-time';
    }
  }
  if (!info.tag) {
    const tag = run('git', ['describe', '--tags', '--exact-match', 'HEAD']);
    if (tag) {
      info.tag = tag;
      sources.tag = 'git';
    }
  }

  // ── 3. 工作区是否脏（有未提交改动时同步需谨慎；仅在建有 .git 时尝试，失败跳过） ──
  if (info.commit && gitMeta) {
    const status = run('git', ['status', '--porcelain', '--untracked-files=no']);
    if (status !== null) {
      info.dirty = status.length > 0;
      sources.dirty = 'git';
    }
  }

  // ── 4. 版本号回退 package.json ──
  if (!info.version) {
    const v = readPackageVersion();
    if (v) {
      info.version = v;
      sources.version = 'package.json';
    }
  }

  info.shortCommit = info.commit ? info.commit.slice(0, 7) : '';
  if (!info.commit && !info.version) {
    // 完全没有可用信息（例如纯净部署目录且无 git）：仍然返回结构化对象，交由调用方提示
    info.ok = false;
  }

  _cache = { stamp, info };
  return { ...info };
}

/** 清空缓存（同步完成后可主动调用，让 /api/system/update?action=version 立即反映新版本） */
function invalidate() {
  _cache = null;
}

module.exports = {
  ROOT,
  BUILD_INFO_FILE,
  PACKAGE_FILE,
  getBuildInfo,
  invalidate,
  readBuildInfoFile,
  readPackageVersion,
};
