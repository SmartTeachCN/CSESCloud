/**
 * CSES Cloud - 服务器配置
 *
 * 安全约定：**仓库内不保存任何凭据**。
 *   - 临时管理员密码哈希：TEMP_ADMIN_PASSWORD_HASH（生产必须显式配置）
 *   - 智教联盟 OAuth：ALLIANCE_OAUTH_CLIENT_ID / ALLIANCE_OAUTH_CLIENT_SECRET
 *   以上一律从环境变量读取；本地开发可写在仓库根 `.env`（已忽略，示例见 `.env.example`），
 *   生产环境由部署环境（systemd EnvironmentFile / pm2 env / 面板环境变量）注入。
 *
 * 运行时可改项（管理后台「启用/禁用临时管理员」「默认 AI 模型」）写入
 * `server/lib/server-config.local.js`，该文件在 .gitignore 中，不会入库。
 *
 * 所有环境变量：
 *   TEMP_ADMIN_ENABLED             1/0，是否启用临时管理员模式（默认：有密码哈希时启用）
 *   TEMP_ADMIN_USERNAME            临时管理员用户名（默认 admin）
 *   TEMP_ADMIN_PASSWORD_HASH       临时管理员密码哈希（bcrypt，cost≥10）
 *   AI_DEFAULT_MODEL               默认 AI 模型名（默认 DeepSeek）
 *   ALLIANCE_OAUTH_ENABLED         1/0，是否启用联盟 OAuth（默认 1）
 *   ALLIANCE_OAUTH_AUTHORIZE_URL   授权地址
 *   ALLIANCE_OAUTH_TOKEN_URL       换取 token 地址
 *   ALLIANCE_OAUTH_USERINFO_URL    用户信息地址
 *   ALLIANCE_OAUTH_SCOPE           授权 scope（默认 openid profile email）
 *   ALLIANCE_OAUTH_CLIENT_ID       联盟 OAuth client_id（必填，否则不可登录）
 *   ALLIANCE_OAUTH_CLIENT_SECRET   联盟 OAuth client_secret
 *   ALLIANCE_OAUTH_REDIRECT_URI    回调地址（留空按请求自动推导）
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..', '..');
const DEBUG_FLAG = path.join(ROOT, 'debug.flag');
const LOCAL_CONFIG_PATH = path.join(__dirname, 'server-config.local.js');

/**
 * dev 模式判定：项目根存在 debug.flag（与 alliance-oauth.js 的判定保持一致）。
 * 注意该文件在 .gitignore 中，生产环境不会有它。
 */
function isDevMode() {
  return fs.existsSync(DEBUG_FLAG);
}

/** 读取字符串型环境变量（空串视为未设置） */
function envString(name, dflt = '') {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : dflt;
}

/** 读取布尔型环境变量 */
function envFlag(name, dflt) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

/** 读取管理后台写回的本地运行时配置（缺失或损坏时退化为空对象，不影响启动） */
function readLocalConfig() {
  try {
    if (!fs.existsSync(LOCAL_CONFIG_PATH)) return {};
    delete require.cache[require.resolve(LOCAL_CONFIG_PATH)];
    return require(LOCAL_CONFIG_PATH) || {};
  } catch (e) {
    console.warn('[server-config] server-config.local.js 读取失败，已忽略：' + e.message);
    return {};
  }
}

const devMode = isDevMode();
const local = readLocalConfig();

// ── 临时管理员 ──────────────────────────────────────────────
// 生产环境必须显式提供密码哈希；dev 模式（存在 debug.flag）保留 admin/admin 的便利，
// 哈希在启动时即时生成，不落盘、不入库。
const tempAdminUsername = envString('TEMP_ADMIN_USERNAME', 'admin');
let tempAdminPasswordHash = envString('TEMP_ADMIN_PASSWORD_HASH', '');
if (!tempAdminPasswordHash && devMode) {
  tempAdminPasswordHash = bcrypt.hashSync('admin', 10);
}

const tempAdminDefaultEnabled = tempAdminPasswordHash !== '';
const tempAdminEnabled = envFlag(
  'TEMP_ADMIN_ENABLED',
  local.temp_admin && local.temp_admin.enabled !== undefined
    ? !!local.temp_admin.enabled
    : tempAdminDefaultEnabled
);

if (tempAdminEnabled && !tempAdminPasswordHash) {
  console.warn(
    '[server-config] 已启用临时管理员但未配置 TEMP_ADMIN_PASSWORD_HASH：' +
    '请设置环境变量后重启，否则临时管理员无法登录。'
  );
}
if (devMode) {
  console.warn(
    `[server-config] dev 模式（存在 debug.flag）：临时管理员 ${tempAdminUsername} 默认密码为 admin；` +
    '生产部署请删除 debug.flag 并配置 TEMP_ADMIN_PASSWORD_HASH。'
  );
}

// ── AI 默认模型 ─────────────────────────────────────────────
const aiDefaultModel = envString(
  'AI_DEFAULT_MODEL',
  local.ai && local.ai.default_model ? String(local.ai.default_model) : 'DeepSeek'
);

// ── 智教联盟 OAuth2 SSO ─────────────────────────────────────
const allianceOauth = {
  enabled: envFlag('ALLIANCE_OAUTH_ENABLED', true),
  authorize_url: envString('ALLIANCE_OAUTH_AUTHORIZE_URL', 'https://auth.smart-teach.cn/login/oauth/authorize'),
  token_url: envString('ALLIANCE_OAUTH_TOKEN_URL', 'https://auth.smart-teach.cn/api/login/oauth/access_token'),
  userinfo_url: envString('ALLIANCE_OAUTH_USERINFO_URL', 'https://auth.smart-teach.cn/api/userinfo'),
  scope: envString('ALLIANCE_OAUTH_SCOPE', 'openid profile email'),
  client_id: envString('ALLIANCE_OAUTH_CLIENT_ID', ''),
  client_secret: envString('ALLIANCE_OAUTH_CLIENT_SECRET', ''),
  // 留空则按请求自动推导 {origin}/api/auth/alliance-callback；反代环境可显式指定
  redirect_uri: envString('ALLIANCE_OAUTH_REDIRECT_URI', ''),
};

if (allianceOauth.enabled && !allianceOauth.client_id && !devMode) {
  console.warn(
    '[server-config] 未配置 ALLIANCE_OAUTH_CLIENT_ID：联盟 OAuth 登录不可用' +
    '（dev 模式走本地模拟登录，不受影响）。'
  );
}

// ── 运行时配置写回（仅非敏感项） ────────────────────────────
/**
 * 把管理后台可运行时修改的项写回 server-config.local.js（已忽略，不入库）。
 * 只允许写非敏感字段：临时管理员开关、默认 AI 模型。凭据永远不落盘到仓库文件。
 * @param {object} patch 形如 { temp_admin: { enabled: true } } / { ai: { default_model: 'X' } }
 * @returns {object} 合并后的本地配置
 */
function persistRuntime(patch) {
  const current = readLocalConfig();
  const next = JSON.parse(JSON.stringify(current));
  for (const [section, values] of Object.entries(patch || {})) {
    if (values && typeof values === 'object') {
      next[section] = Object.assign({}, next[section] || {}, values);
    } else {
      next[section] = values;
    }
  }
  const header =
    '/**\n' +
    ' * CSES Cloud - 本地运行时配置（由管理后台写回，替换后立即生效）\n' +
    ' * 该文件在 .gitignore 中，不参与版本控制，请在部署机上各自维护。\n' +
    ' * 凭据（密码哈希 / OAuth client_secret）只从环境变量读取，不会写到这里。\n' +
    ' */\n';
  fs.writeFileSync(LOCAL_CONFIG_PATH, header + 'module.exports = ' + JSON.stringify(next, null, 2) + ';\n', 'utf8');
  return next;
}

module.exports = {
  dev_mode: devMode,
  temp_admin: {
    enabled: tempAdminEnabled,
    username: tempAdminUsername,
    password_hash: tempAdminPasswordHash,
  },
  ai: {
    default_model: aiDefaultModel,
  },
  alliance_oauth: allianceOauth,
  /** 运行时写回（见上方说明） */
  persistRuntime,
  /** 本地运行时配置路径（诊断/文档用） */
  local_config_path: LOCAL_CONFIG_PATH,
};
