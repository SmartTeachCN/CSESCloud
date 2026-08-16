/**
 * 学校集控切换 / 加入 / 申请管理 API
 *  GET  action=joined          当前联盟账户已加入的学校
 *  GET  action=all             所有可申请加入的学校
 *  GET  action=my-requests     我提交的加入申请
 *  GET  action=join-requests   某学校的待审申请（管理员）
 *  POST action=request-join    提交加入申请
 *  POST action=approve         审批加入申请
 *  POST action=switch         切换当前学校（联盟账户）
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();
  const user = Auth.user() || {};

  if (method === 'GET' && action === 'joined') {
    if (!Auth.isAlliance()) {
      // 子用户：仅返回当前所在学校
      Response.success([
        { id: user.school_id, name: user.school_name, is_current: true }
      ]);
    }
    Response.success(Auth.listJoinedSchools(user.username));
  }

  if (method === 'GET' && action === 'all') {
    // 所有可被申请加入的学校（已加入的不返回，避免重复申请）
    const joined = Auth.isAlliance() ? Auth.listJoinedSchools(user.username) : [];
    const joinedIds = joined.map(s => parseInt(s.id, 10) || 0);
    let sql = "SELECT id, name, short_name, admin_username, status, address FROM schools WHERE status = 'active'";
    let params = [];
    if (joinedIds.length) {
      sql += ' AND id NOT IN (' + joinedIds.map(() => '?').join(',') + ')';
      params = joinedIds;
    }
    sql += ' ORDER BY id ASC';
    Response.success(DB.all(sql, params));
  }

  if (method === 'GET' && action === 'my-requests') {
    if (!Auth.isAlliance()) Response.success([]);
    const rows = DB.all(
      `SELECT r.*, s.name AS school_name, s.short_name
         FROM school_join_requests r JOIN schools s ON s.id = r.school_id
         WHERE r.applicant_username = ? ORDER BY r.id DESC`,
      [user.username]
    );
    Response.success(rows);
  }

  if (method === 'GET' && action === 'join-requests') {
    const schoolId = parseInt(query.school_id ?? 0, 10) || 0;
    if (!schoolId) Response.error('缺少 school_id');
    // 仅允许学校管理员查看
    const school = DB.one("SELECT * FROM schools WHERE id = ?", [schoolId]);
    if (!school) Response.error('学校不存在');
    const isSchoolAdmin = Auth.isAlliance()
      ? (school.admin_username === user.username)
      : (user.role === 'admin' && parseInt(user.school_id, 10) === schoolId);
    if (!isSchoolAdmin) Response.error('无权限查看加入申请', 403, 403);
    Response.success(Auth.listJoinRequests(schoolId));
  }

  if (method === 'POST' && action === 'request-join') {
    if (!Auth.isAlliance()) Response.error('仅智教联盟账户可申请加入学校', 403, 403);
    const schoolId = parseInt(b.school_id ?? 0, 10) || 0;
    const displayName = String(b.display_name ?? '').trim();
    if (!schoolId) Response.error('缺少 school_id');
    const ok = Auth.createJoinRequest(schoolId, user.username, displayName);
    Response.success({ created: ok }, ok ? '已提交加入申请，等待学校管理员审批' : '已存在待审申请');
  }

  if (method === 'POST' && action === 'approve') {
    const requestId = parseInt(b.request_id ?? 0, 10) || 0;
    const approve = !Helpers.empty(b.approve);
    if (!requestId) Response.error('缺少 request_id');
    // 取申请记录判断权限
    const requestRow = DB.one("SELECT * FROM school_join_requests WHERE id = ?", [requestId]);
    if (!requestRow) Response.error('申请记录不存在');
    const school = DB.one("SELECT * FROM schools WHERE id = ?", [requestRow.school_id]);
    const isSchoolAdmin = Auth.isAlliance()
      ? (school.admin_username === user.username)
      : (user.role === 'admin' && parseInt(user.school_id, 10) === parseInt(requestRow.school_id, 10));
    if (!isSchoolAdmin) Response.error('无权限审批', 403, 403);
    const ok = Auth.approveJoinRequest(requestId, user.user_id ?? 0, approve);
    Response.success({ ok }, approve ? '已通过申请' : '已拒绝申请');
  }

  if (method === 'POST' && action === 'switch') {
    const schoolId = parseInt(b.school_id ?? 0, 10) || 0;
    if (!schoolId) Response.error('缺少 school_id');
    // 校验：联盟账户需已加入该校；子用户只允许切换到所属学校
    if (Auth.isAlliance()) {
      const joined = Auth.listJoinedSchools(user.username);
      const allowed = joined.filter(s => parseInt(s.id, 10) === schoolId);
      if (Helpers.empty(allowed)) Response.error('尚未加入该学校', 403, 403);
    } else if (parseInt(user.school_id, 10) !== schoolId) {
      Response.error('子用户无法切换到非所属学校', 403, 403);
    }
    const ok = Auth.switchSchool(schoolId);
    Response.success({ ok }, ok ? '已切换学校' : '切换失败');
  }

  Response.error('未知的操作', 405, 405);
};