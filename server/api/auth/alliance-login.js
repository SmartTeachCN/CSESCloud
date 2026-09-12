/**
 * 智教联盟登录 API（dev 模式：仅输入用户名即可登录，对齐 CsesWebEditor 的 debug 用户方案）
 * 非 dev 模式（无 debug.flag）：联盟账户必须走真实 SSO 授权登录，此处拒绝模拟登录。
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  const allianceOauth = require('../../lib/alliance-oauth');

  if (!Helpers.isPost()) {
    Response.error('仅支持 POST 请求', 405, 405);
  }

  if (!allianceOauth.isDevMode()) {
    Response.error('当前为正式环境，请通过智教联盟平台授权登录', 403, 403);
  }

  const b = Helpers.jsonBody();
  const username = String(b.username ?? '').trim();

  if (username === '') {
    Response.error('请输入联盟用户名');
  }

  if (Auth.loginAlliance(username)) {
    // 联盟账户默认进入实例云控概览
    Response.success({ redirect: '/console/instances' }, '智教联盟登录成功');
  } else {
    Response.error('登录失败');
  }
};
