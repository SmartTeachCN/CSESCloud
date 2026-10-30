/**
 * 智教联盟 OAuth 回调（GET /api/auth/alliance-callback?code=...&state=...）
 *
 * 授权码换 access_token → 拉取用户信息 → 建立联盟会话 → 302 回前端。
 * 任何失败均 302 回 /login 并带 alliance_error 提示。
 */
module.exports = async (ctx) => {
  const { req, res, Auth, query } = ctx;
  const allianceOauth = require('../../lib/alliance-oauth');

  const fail = (msg) => {
    res.redirect('/login?alliance_error=' + encodeURIComponent(String(msg || '联盟登录失败')));
  };

  const oauthError = String(query.error_description || query.error || '');
  if (oauthError) {
    fail(oauthError);
    return;
  }

  const code = String(query.code || '');
  if (!code) {
    fail('缺少授权码');
    return;
  }

  // state 校验（alliance-login-config 下发时存入会话）
  Auth.init();
  const issued = req.session.alliance_oauth || null;
  if (issued && issued.state && String(query.state || '') !== issued.state) {
    fail('state 校验失败，请重新发起登录');
    return;
  }
  const redirect = (issued && issued.redirect) || '/console/editor/light';
  const redirectUri = (issued && issued.redirect_uri) || allianceOauth.resolveRedirectUri(req);
  delete req.session.alliance_oauth;

  try {
    const accessToken = await allianceOauth.exchangeToken(code, redirectUri);
    const userInfo = await allianceOauth.fetchUserInfo(accessToken);
    if (!Auth.loginAllianceOauth(userInfo)) {
      fail('联盟用户信息不完整，无法登录');
      return;
    }
    res.redirect(redirect);
  } catch (e) {
    console.error('[alliance-oauth] 登录失败:', e.message);
    fail(e.message);
  }
};
