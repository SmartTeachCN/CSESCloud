/** 控制台仪表盘数据（当前用户维度，V3：配置实例 / 数据空间 / 云服务） */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();
  const ownerKey = Auth.ownerKey();
  const username = Auth.allianceUsername() || (Auth.user() || {}).username || '';

  // 核心统计（当前用户维度）
  const stats = {
    // 配置实例（轻编辑器「分发配置」创建的实例，按所有者隔离）
    instances: parseInt(DB.scalar('SELECT COUNT(*) FROM instances WHERE owner_key = ?', [ownerKey]) ?? 0, 10) || 0,
    instances_running: parseInt(DB.scalar("SELECT COUNT(*) FROM instances WHERE owner_key = ? AND status = 'running'", [ownerKey]) ?? 0, 10) || 0,
    // 网页空间 / 数据空间
    web_spaces: parseInt(DB.scalar('SELECT COUNT(*) FROM web_hosting_spaces WHERE alliance_username = ? AND is_web_space = 1', [username]) ?? 0, 10) || 0,
    // 今日操作（审计日志，当前用户）
    today_operations: parseInt(DB.scalar("SELECT COUNT(*) FROM audit_logs WHERE school_id = ? AND username = ? AND date(created_at) = date('now')", [schoolId, username]) ?? 0, 10) || 0,
    // 云服务（运行中）
    services: parseInt(DB.scalar("SELECT COUNT(*) FROM services WHERE school_id = ? AND status = 'running'", [schoolId]) ?? 0, 10) || 0,
  };

  // 最近活动：仅显示当前用户的操作
  const activities = DB.all(
    'SELECT id, username, action, target, status, created_at FROM audit_logs WHERE school_id = ? AND username = ? ORDER BY id DESC LIMIT 10',
    [schoolId, username]
  );

  Response.success({ stats: stats, activities: activities });
};
