/** 控制台仪表盘数据 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const stats = {
    classes: parseInt(DB.scalar("SELECT COUNT(*) FROM classes WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0,
    students: parseInt(DB.scalar("SELECT COUNT(*) FROM students WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0,
    services: parseInt(DB.scalar("SELECT COUNT(*) FROM services WHERE school_id = ? AND status = 'running'", [schoolId]) ?? 0, 10) || 0,
    sub_users: parseInt(DB.scalar("SELECT COUNT(*) FROM users WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0,
    instances: parseInt(DB.scalar("SELECT COUNT(*) FROM instances WHERE school_id = ?", [schoolId]) ?? 0, 10) || 0,
    instances_running: parseInt(DB.scalar("SELECT COUNT(*) FROM instances WHERE school_id = ? AND status = 'running'", [schoolId]) ?? 0, 10) || 0,
  };

  const activities = DB.all(
    "SELECT * FROM audit_logs WHERE school_id = ? ORDER BY id DESC LIMIT 6",
    [schoolId]
  );

  const classes = DB.all(
    `SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
     FROM classes c WHERE c.school_id = ? ORDER BY c.id DESC LIMIT 5`,
    [schoolId]
  );

  const services = DB.all("SELECT * FROM services WHERE school_id = ? ORDER BY id ASC", [schoolId]);

  Response.success({
    stats: stats,
    activities: activities,
    recent_classes: classes,
    services: services,
  });
};