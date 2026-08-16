/** 学校列表查询（用于登录页学校选择） */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  const schools = DB.all("SELECT id, name, short_name, admin_username, status, address FROM schools ORDER BY id ASC");
  Response.success(schools);
};