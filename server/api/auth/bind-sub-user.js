/**
 * 联盟账户绑定/解绑子用户 API
 *  GET  -> list：当前联盟账户已绑定的子用户列表
 *  POST -> bind：{ sub_user_id, alias?, permissions? } 或 { action: 'unbind', binding_id }
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();

  if (!Auth.isAlliance()) {
    Response.error('仅智教联盟账户可绑定子用户', 403, 403);
  }

  const allianceUsername = Auth.allianceUsername();
  const method = req.method;

  if (method === 'GET') {
    Response.success(Auth.listBindings(allianceUsername));
  }

  if (method === 'POST') {
    const b = Helpers.jsonBody();
    const action = b.action ?? 'bind';

    if (action === 'unbind') {
      const bindingId = parseInt(b.binding_id ?? 0, 10) || 0;
      if (!bindingId) Response.error('缺少 binding_id');
      const ok = Auth.unbindSubUser(allianceUsername, bindingId);
      Response.success({ ok }, ok ? '已解绑' : '条目不存在');
    }

    // 默认：绑定
    const subUserId = parseInt(b.sub_user_id ?? 0, 10) || 0;
    const alias = String(b.alias ?? '').trim();
    const permissions = b.permissions ?? [];
    if (!subUserId) Response.error('缺少 sub_user_id');
    const ok = Auth.bindSubUser(allianceUsername, subUserId, alias, permissions);
    Response.success({ ok }, ok ? '绑定成功' : '绑定失败：子用户不存在');
  }

  Response.error('未知的操作', 405, 405);
};