/**
 * 临时管理员登录 API
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  if (!Helpers.isPost()) {
    Response.error('仅支持 POST 请求', 405, 405);
  }

  const b = Helpers.jsonBody();
  const username = String(b.username ?? '').trim();
  const password = b.password ?? '';

  if (!username || !password) {
    Response.error('请填写用户名和密码');
  }

  const ok = Auth.loginTempAdmin(username, password);
  if (!ok) {
    Response.error('临时管理员模式未开启或用户名/密码错误', 1, 400);
  }

  Response.success({ redirect: '/console/admin' }, '临时管理员登录成功');
};