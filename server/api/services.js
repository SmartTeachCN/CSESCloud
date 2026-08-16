/** 服务详情 API */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  if (method === 'GET' && action === 'list') {
    Response.success(DB.all("SELECT * FROM services WHERE school_id = ? ORDER BY id ASC", [schoolId]));
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const svc = DB.one("SELECT * FROM services WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!svc) Response.error('服务不存在');
    Response.success(svc);
  }

  if (method === 'POST' && action === 'update-status') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    const status = b.status ?? '';
    if (!['running', 'stopped', 'maintenance'].includes(status)) Response.error('无效状态');
    const svc = DB.one("SELECT * FROM services WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!svc) Response.error('服务不存在');
    DB.update('services', { status: status }, 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'update', `修改服务 ${svc.name} 状态为 ${status}`);
    Response.success(null, '状态已更新');
  }

  Response.error('未知的操作');
};