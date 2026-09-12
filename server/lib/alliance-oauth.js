/**
 * CSES Cloud - 智教联盟 OAuth2 SSO（对齐 CsesWebEditor 的真实登录实现）
 *
 * dev 模式（项目根存在 debug.flag，同 CsesWebEditor 的判定方式）：联盟账户走
 * "仅输入用户名"的本地模拟登录；非 dev 模式：通过 auth.smart-teach.cn 的
 * Casdoor 风格 SSO 走标准授权码流程（authorize → code → access_token → userinfo）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const serverConfig = require('./server-config');

const ROOT = path.join(__dirname, '..', '..');
const DEBUG_FLAG = path.join(ROOT, 'debug.flag');

/** dev 模式判定：项目根存在 debug.flag 即为开发环境（模拟登录） */
function isDevMode() {
  return fs.existsSync(DEBUG_FLAG);
}

function oauthConfig() {
  return serverConfig.alliance_oauth || {};
}

/** 真实 OAuth 登录是否启用（非 dev 模式且配置未关闭） */
function oauthEnabled() {
  const c = oauthConfig();
  return !isDevMode() && c.enabled !== false && !!c.client_id;
}

/** 从请求推导回调地址（反代优先取 X-Forwarded-*；可用配置 redirect_uri 强制指定） */
function resolveRedirectUri(req) {
  const c = oauthConfig();
  if (c.redirect_uri) return c.redirect_uri;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}/api/auth/alliance-callback`;
}

/** 构造授权跳转 URL（对齐 CsesWebEditor pages/login.html 的授权地址） */
function buildAuthorizeUrl(req, state) {
  const c = oauthConfig();
  const params = new URLSearchParams({
    client_id: c.client_id,
    response_type: 'code',
    redirect_uri: resolveRedirectUri(req),
    scope: c.scope || 'openid profile email',
  });
  if (state) params.set('state', state);
  return `${c.authorize_url}?${params.toString()}`;
}

/** 授权码换 access_token（表单编码 POST，对齐 function/user.php::handleLogin） */
async function exchangeToken(code, redirectUri) {
  const c = oauthConfig();
  const body = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret || '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const resp = await fetch(c.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (!resp.ok || !data.access_token) {
    const detail = data.error_description || data.error || data.message || `HTTP ${resp.status}`;
    throw new Error(`获取访问令牌失败: ${detail}`);
  }
  return data.access_token;
}

/** 拉取联盟用户信息（Bearer，对齐 function/user.php::getUserInfo） */
async function fetchUserInfo(accessToken) {
  const c = oauthConfig();
  const resp = await fetch(c.userinfo_url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (!resp.ok || (!data.sub && !data.preferred_username)) {
    const detail = data.error_description || data.error || data.message || `HTTP ${resp.status}`;
    throw new Error(`获取联盟用户信息失败: ${detail}`);
  }
  return data;
}

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { isDevMode, oauthEnabled, buildAuthorizeUrl, resolveRedirectUri, exchangeToken, fetchUserInfo, randomState };
