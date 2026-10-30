/**
 * 智教联盟登录配置（GET /api/auth/alliance-login-config）
 *
 * 返回联盟登录方式：
 *   - oauth：非 dev 模式，真实智教联盟 SSO（前端跳转 authorize_url）
 *   - local：dev 模式（存在 debug.flag），保留"仅输入用户名"模拟登录
 */
module.exports = async (ctx) => {
  const { req, Auth, Response } = ctx;
  const allianceOauth = require('../../lib/alliance-oauth');

  if (!allianceOauth.oauthEnabled()) {
    Response.success({ mode: 'local' });
  }

  // 预生成 state（回调时校验，防 CSRF），并记住登录后的跳转目标（仅允许站内路径）
  const state = allianceOauth.randomState();
  const redirect = String(req.query.redirect || '');
  Auth.init();
  req.session.alliance_oauth = {
    state,
    redirect: /^\/(?!\/)/.test(redirect) ? redirect : '/console/editor/light',
    redirect_uri: allianceOauth.resolveRedirectUri(req),
  };

  Response.success({
    mode: 'oauth',
    authorize_url: allianceOauth.buildAuthorizeUrl(req, state),
  });
};
