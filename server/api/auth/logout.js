/** 退出登录 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  Auth.logout();
  Response.success(null, '已退出登录');
};