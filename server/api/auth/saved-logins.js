/**
 * 保留登录条目 API
 *  GET  -> list 返回所有保留登录
 *  POST -> save 新增（已存在则返回原 id）
 *  DELETE -> remove
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();

  const method = req.method;

  if (method === 'GET') {
    Response.success(Auth.listSavedLogins());
  }

  if (method === 'POST') {
    const b = Helpers.jsonBody();
    const entryType = String(b.entry_type ?? '').trim();
    const displayLabel = String(b.display_label ?? '').trim();
    const subUsername = String(b.sub_username ?? '').trim();
    const schoolId = b.school_id ?? null;
    if (entryType !== 'school_sub' || !subUsername) {
      Response.error('参数错误');
    }
    const id = Auth.saveLogin({
      'entry_type': entryType,
      'display_label': Helpers.filled(displayLabel) ? displayLabel : (subUsername + '@SID:' + schoolId),
      'school_id': schoolId ? parseInt(schoolId, 10) : null,
      'instance_uid': null,
      'sub_username': subUsername,
    });
    Response.success({ id }, '已保留到登录列表');
  }

  if (method === 'DELETE') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少 id');
    Auth.removeSavedLogin(id);
    Response.success(null, '已从列表移除');
  }

  Response.error('未知的操作', 405, 405);
};
