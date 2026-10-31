/**
 * CSES Cloud - 零依赖 .env 加载器
 *
 * 用途：在服务启动最早阶段读取仓库根目录的 `.env` 文件，把配置写入 process.env，
 *       供 server/lib/server-config.js（联盟 OAuth 密钥）与生产端同步（UPDATE_*）使用。
 *       不引入 dotenv 等依赖，只使用 node:fs / node:path。
 *
 * 语法支持（对齐常见的 dotenv 子集）：
 *   - 空行、`#` 开头的整行注释
 *   - 行内注释：未加引号的值中，` #`（井号前有空白）之后视为注释
 *   - `KEY=VALUE`、`export KEY=VALUE`
 *   - 单引号值（原样保留）、双引号值（支持 \\n \\r \\t \\" \\\\ 转义）
 *   - 不覆盖已存在的 process.env（真实环境变量优先级最高）
 *
 * 注意：本模块被 require 时会自动加载一次；重复 require / 多次调用均幂等。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env');

/** 合法的环境变量名（避免把随意文本写进 process.env） */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 去掉一组包裹引号；双引号内做常见转义还原 */
function unquote(raw) {
  const v = String(raw).trim();
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
    return v.slice(1, -1);
  }
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    const body = v.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch !== '\\') { out += ch; continue; }
      const next = body[i + 1];
      if (next === undefined) { out += '\\'; break; }
      if (next === 'n') { out += '\n'; i++; }
      else if (next === 'r') { out += '\r'; i++; }
      else if (next === 't') { out += '\t'; i++; }
      else if (next === '"') { out += '"'; i++; }
      else if (next === '\\') { out += '\\'; i++; }
      else { out += '\\' + next; i++; }
    }
    return out;
  }
  // 未加引号：去掉行内注释（` #` 起）后 trim
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

/**
 * 解析 .env 文本为键值对象（不写入 process.env）
 * @param {string} content .env 文件内容
 * @returns {Record<string, string>}
 */
function parseEnv(content) {
  const out = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    // 允许 `export KEY=VALUE`
    const body = text.startsWith('export ') ? text.slice(7).trim() : text;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!KEY_RE.test(key)) continue;
    out[key] = unquote(body.slice(eq + 1));
  }
  return out;
}

let _lastResult = null;

/**
 * 加载 .env 到 process.env（不覆盖已存在的变量）
 * @param {object} [opts]
 * @param {string} [opts.file]  自定义 .env 路径（默认仓库根 .env）
 * @param {boolean} [opts.override] 是否覆盖已存在变量（默认 false）
 * @param {boolean} [opts.silent] 是否静默（默认 true；设为 false 时打印加载结果）
 * @returns {{loaded: boolean, file: string, count: number, keys: string[]}}
 */
function loadEnv(opts = {}) {
  const file = opts.file || ENV_FILE;
  const override = opts.override === true;
  const result = { loaded: false, file, count: 0, keys: [] };

  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
    // 去掉 UTF-8 BOM（Windows 记事本保存的 .env 常带 BOM，否则首个键名会带上 \uFEFF）
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  } catch (_) {
    // 没有 .env 是完全正常的情况（生产环境推荐用真实环境变量 / systemd Environment）
    _lastResult = result;
    return result;
  }

  const parsed = parseEnv(content);
  for (const [key, value] of Object.entries(parsed)) {
    result.keys.push(key);
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
    result.count++;
  }
  result.loaded = true;
  _lastResult = result;

  if (opts.silent === false) {
    const shown = result.keys.map((k) => k).join(', ');
    console.log(`[env] 已加载 ${path.relative(ROOT, file) || file}（${result.count}/${result.keys.length} 项生效）${shown ? '：' + shown : ''}`);
  }
  return result;
}

module.exports = {
  ENV_FILE,
  parseEnv,
  loadEnv,
  /** 最近一次加载结果（诊断用） */
  lastResult: () => _lastResult,
};

// 被 require 即自动加载一次（server/index.js 在文件最顶部 require 本模块）
loadEnv();
