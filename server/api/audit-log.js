/** 审计日志 API */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';

  if (method === 'GET' && action === 'list') {
    const keyword = String(query.keyword ?? '').trim();
    const status = query.status ?? 'all';
    let sql = "SELECT * FROM audit_logs WHERE school_id = ?";
    const params = [schoolId];
    if (status !== 'all') { sql += " AND status = ?"; params.push(status); }
    if (keyword !== '') {
      sql += " AND (target LIKE ? OR username LIKE ? OR action LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    sql += " ORDER BY id DESC LIMIT 200";
    Response.success(DB.all(sql, params));
  }

  if (method === 'GET' && action === 'instance') {
    const instanceId = parseInt(query.id ?? 0, 10) || 0;
    if (instanceId <= 0) Response.error('实例 ID 无效');
    const ins = DB.one("SELECT name FROM instances WHERE id = ? AND school_id = ?", [instanceId, schoolId]);
    if (!ins) Response.error('实例不存在');
    const rows = DB.all(
      "SELECT * FROM audit_logs WHERE school_id = ? AND target LIKE ? ORDER BY id DESC LIMIT 100",
      [schoolId, `%${ins.name}%`]
    );
    Response.success(rows);
  }

  if (method === 'GET' && action === 'stats') {
    const today = parseInt(DB.scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND date(created_at) = date('now')", [schoolId]) ?? 0, 10) || 0;
    const week = parseInt(DB.scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND created_at >= datetime('now','-7 days')", [schoolId]) ?? 0, 10) || 0;
    const failed = parseInt(DB.scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND status = 'failed'", [schoolId]) ?? 0, 10) || 0;
    const total = parseInt(DB.scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0;
    Response.success({ today: today, week: week, failed: failed, total: total });
  }

  Response.error('未知的操作');
};