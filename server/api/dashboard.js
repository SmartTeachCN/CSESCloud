/** 控制台仪表盘数据（当前用户维度） */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();
  const username = Auth.allianceUsername();

  // 核心统计数据（当前用户维度）
  const stats = {
    classes: parseInt(DB.scalar("SELECT COUNT(*) FROM classes WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0,
    students: parseInt(DB.scalar("SELECT COUNT(*) FROM students WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0,
    instances: parseInt(DB.scalar("SELECT COUNT(*) FROM instances WHERE school_id = ? AND owner_key = ?", [schoolId, username]) ?? 0, 10) || 0,
    instances_running: parseInt(DB.scalar("SELECT COUNT(*) FROM instances WHERE school_id = ? AND owner_key = ? AND status = 'running'", [schoolId, username]) ?? 0, 10) || 0,
    today_operations: parseInt(DB.scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND username = ? AND date(created_at) = date('now')", [schoolId, username]) ?? 0, 10) || 0,
    services: parseInt(DB.scalar("SELECT COUNT(*) FROM services WHERE school_id = ? AND status = 'running'", [schoolId]) ?? 0, 10) || 0,
    web_spaces: parseInt(DB.scalar("SELECT COUNT(*) FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1", [username]) ?? 0, 10) || 0,
  };

  // 最近活动：仅显示当前用户的操作
  const activities = DB.all(
    "SELECT id, username, action, target, status, created_at FROM audit_logs WHERE school_id = ? AND username = ? ORDER BY id DESC LIMIT 10",
    [schoolId, username]
  );

  // 最近班级
  const classes = DB.all(
    `SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
     FROM classes c WHERE c.school_id = ? ORDER BY c.id DESC LIMIT 5`,
    [schoolId]
  );

  // 服务列表
  const services = DB.all("SELECT * FROM services WHERE school_id = ? ORDER BY id ASC", [schoolId]);

  Response.success({
    stats: stats,
    activities: activities,
    recent_classes: classes,
    services: services,
  });
};