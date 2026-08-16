/** 智教联盟登录 API（按用户要求：仅输入用户名即可登录） */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  if (!Helpers.isPost()) {
    Response.error('仅支持 POST 请求', 405, 405);
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