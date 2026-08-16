/**
 * 通知 API
 *
 * 操作：
 *  - GET  action=list            获取当前用户的通知列表
 *  - GET  action=stats           获取通知统计（未读/今日/本周/总计）
 *  - POST action=mark-read       标记通知为已读
 *  - POST action=delete          删除通知（移除当前用户的已读记录）
 *  - POST action=create          创建通知（校园管理员 / 有权限者）
 *  - GET  action=recipients      获取可通知的目标（用户 / 角色 / 班级）
 */
const { nowStr } = require('../lib/response');

/** PHP json_decode(s, true) 等价：失败返回 null */
function jsonDecodeSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();

  const user = Auth.user() || {};
  const userId = parseInt(user.user_id ?? 0, 10) || 0;
  const schoolId = Auth.schoolId();
  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  // ===== 获取通知列表 =====
  if (method === 'GET' && action === 'list') {
    const type = query.type ?? 'all';
    const page = Math.max(1, parseInt(query.page ?? 1, 10) || 1);
    const perPage = 50;
    const offset = (page - 1) * perPage;

    // 获取当前用户应该看到的通知：目标为全体、同角色、同班级、或直接指定该用户
    const userRole = user.role ?? '';
    let userClassId = 0;
    if (userRole === 'student') {
      const student = DB.one("SELECT class_id FROM students WHERE school_id = ? AND name = (SELECT display_name FROM users WHERE id = ?)", [schoolId, userId]);
      userClassId = student ? (parseInt(student.class_id, 10) || 0) : 0;
    }

    let where = `(
        n.school_id = :school_id
        OR n.school_id = 0
    ) AND (
        n.target_type = 'all'
        OR (n.target_type = 'role' AND n.target_id = :role)
        OR (n.target_type = 'user' AND n.target_id = :uid)
        OR (n.target_type = 'share_invite' AND n.target_id = :uid)
        OR (n.target_type = 'share_accepted' AND n.target_id = :uid)
        OR (n.target_type = 'share_rejected' AND n.target_id = :uid)
    )`;
    const params = {
      school_id: schoolId,
      role: userRole,
      uid: String(userId),
    };

    if (userClassId > 0) {
      where += " OR (n.target_type = 'class' AND n.target_id = :class_id)";
      params.class_id = String(userClassId);
    }

    if (type !== 'all') {
      where += " AND n.type = :type";
      params.type = type;
    }

    const sql = `SELECT n.*, nr.is_read, nr.read_at
            FROM notifications n
            LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = :user_id
            WHERE ${where} AND (nr.is_read IS NULL OR nr.is_read >= 0)
            ORDER BY n.id DESC
            LIMIT :limit OFFSET :offset`;

    params.user_id = userId;
    params.limit = perPage;
    params.offset = offset;

    const rows = DB.all(sql, params);

    Response.success(rows);
  }

  // ===== 获取通知统计 =====
  if (method === 'GET' && action === 'stats') {
    const userRole = user.role ?? '';
    let userClassId = 0;
    if (userRole === 'student') {
      const student = DB.one("SELECT class_id FROM students WHERE school_id = ? AND name = (SELECT display_name FROM users WHERE id = ?)", [schoolId, userId]);
      userClassId = student ? (parseInt(student.class_id, 10) || 0) : 0;
    }

    let targetWhere = `(
        n.school_id = ?
        OR n.school_id = 0
    ) AND (
        n.target_type = 'all'
        OR (n.target_type = 'role' AND n.target_id = ?)
        OR (n.target_type = 'user' AND n.target_id = ?)
        OR (n.target_type = 'share_invite' AND n.target_id = ?)
        OR (n.target_type = 'share_accepted' AND n.target_id = ?)
        OR (n.target_type = 'share_rejected' AND n.target_id = ?)
    )`;
    let targetParams = [schoolId, userRole, String(userId), String(userId), String(userId), String(userId)];

    if (userClassId > 0) {
      targetWhere += " OR (n.target_type = 'class' AND n.target_id = ?)";
      targetParams.push(String(userClassId));
    }

    const unread = parseInt(DB.scalar(
      `SELECT COUNT(*) FROM notifications n
         LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
         WHERE ${targetWhere} AND (nr.is_read IS NULL OR nr.is_read = 0)`,
      [userId, ...targetParams]
    ) ?? 0, 10) || 0;

    const today = parseInt(DB.scalar(
      `SELECT COUNT(*) FROM notifications n WHERE ${targetWhere} AND date(n.created_at) = date('now')`,
      targetParams
    ) ?? 0, 10) || 0;

    const week = parseInt(DB.scalar(
      `SELECT COUNT(*) FROM notifications n WHERE ${targetWhere} AND n.created_at >= datetime('now','-7 days')`,
      targetParams
    ) ?? 0, 10) || 0;

    const total = parseInt(DB.scalar(
      `SELECT COUNT(*) FROM notifications n WHERE ${targetWhere}`,
      targetParams
    ) ?? 0, 10) || 0;

    Response.success({ unread: unread, today: today, week: week, total: total });
  }

  // ===== 标记已读 =====
  if (method === 'POST' && action === 'mark-read') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    if (id) {
      // 确保该通知对当前用户可见
      const notif = DB.one("SELECT id FROM notifications WHERE id = ? AND school_id = ?", [id, schoolId]);
      if (!notif) Response.error('通知不存在');
      // 插入或更新已读记录
      DB.pdo().prepare(
        `INSERT INTO notification_reads (notification_id, user_id, is_read, read_at)
             VALUES (?, ?, 1, datetime('now','localtime'))
             ON CONFLICT(notification_id, user_id) DO UPDATE SET is_read = 1, read_at = datetime('now','localtime')`
      ).run(id, userId);
    } else {
      // 全部标记已读：获取当前用户所有未读通知
      const userRole = user.role ?? '';
      const targetParams = [schoolId, userRole, String(userId)];
      const targetWhere = `n.school_id = ? AND (
            n.target_type = 'all'
            OR (n.target_type = 'role' AND n.target_id = ?)
            OR (n.target_type = 'user' AND n.target_id = ?)
        )`;
      const unreadIds = DB.all(
        `SELECT n.id FROM notifications n
             LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
             WHERE ${targetWhere} AND (nr.is_read IS NULL OR nr.is_read = 0)`,
        [userId, ...targetParams]
      );
      for (const row of unreadIds) {
        DB.pdo().prepare(
          `INSERT INTO notification_reads (notification_id, user_id, is_read, read_at)
                 VALUES (?, ?, 1, datetime('now','localtime'))
                 ON CONFLICT(notification_id, user_id) DO UPDATE SET is_read = 1, read_at = datetime('now','localtime')`
        ).run(parseInt(row.id, 10) || 0, userId);
      }
    }
    Response.success(null, '已标记为已读');
  }

  // ===== 删除通知（移除当前用户的已读记录，相当于"不再显示"） =====
  if (method === 'POST' && action === 'delete') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    if (!id) Response.error('参数错误');
    // 删除该用户的已读记录（之后该通知不再出现在列表中）
    DB.delete('notification_reads', 'notification_id = ? AND user_id = ?', [id, userId]);
    // 插入一条 deleted 标记（is_read = -1 表示已删除）
    DB.pdo().prepare(
      `INSERT INTO notification_reads (notification_id, user_id, is_read, read_at)
         VALUES (?, ?, -1, datetime('now','localtime'))
         ON CONFLICT(notification_id, user_id) DO UPDATE SET is_read = -1, read_at = datetime('now','localtime')`
    ).run(id, userId);
    Response.success(null, '已删除');
  }

  // ===== 创建通知（校园管理员 / 有权限者） =====
  if (method === 'POST' && action === 'create') {
    // 权限检查：校园管理员（admin 角色）、有通知权限的用户、或系统管理员
    const isAdmin = (user.role ?? '') === 'admin';
    const isSuperAdmin = Auth.isSuperAdmin();
    // 检查用户是否有通知下发权限
    let hasNotifyPerm = false;
    if (!isAdmin && !isSuperAdmin && userId > 0) {
      const userPerms = DB.scalar("SELECT permissions FROM users WHERE id = ?", [userId]);
      if (userPerms) {
        const perms = jsonDecodeSafe(userPerms);
        hasNotifyPerm = !!(perms && !Helpers.empty(perms.can_send_notification));
      }
    }

    if (!isAdmin && !isSuperAdmin && !hasNotifyPerm) {
      Response.error('没有通知下发权限', 0, 403);
    }

    const title = String(b.title ?? '').trim();
    const content = String(b.content ?? '').trim();
    let type = String(b.type ?? 'info').trim();
    const targetType = String(b.target_type ?? 'all').trim();
    let targetId = b.target_id ?? null;

    if (Helpers.empty(title)) Response.error('通知标题不能为空');
    if (!['system', 'info', 'warning', 'success'].includes(type)) {
      type = 'info';
    }
    if (!['all', 'role', 'class', 'user'].includes(targetType)) {
      Response.error('无效的目标类型');
    }

    if (targetType === 'user' && Helpers.empty(targetId)) {
      Response.error('请选择目标用户');
    }
    if (targetType === 'role' && Helpers.empty(targetId)) {
      Response.error('请选择目标角色');
    }
    if (targetType === 'class' && Helpers.empty(targetId)) {
      Response.error('请选择目标班级');
    }

    const senderName = user.display_name ?? user.username ?? '系统';

    const notifId = DB.insert('notifications', {
      school_id: schoolId,
      sender_id: userId,
      sender_name: senderName,
      type: type,
      title: title,
      content: content,
      target_type: targetType,
      target_id: targetId !== null && targetId !== undefined ? String(targetId) : null,
      created_at: nowStr(),
    });

    Auth.logAudit(schoolId, userId, 'send_notification',
      `发送通知: ${title} (target=${targetType}:${targetId})`,
      'success');

    Response.success({ id: notifId }, '通知已发送');
  }

  // ===== 获取可通知的目标列表 =====
  if (method === 'GET' && action === 'recipients') {
    const result = {
      roles: [
        { value: 'admin', label: '管理员' },
        { value: 'teacher', label: '教师' },
        { value: 'student', label: '学生' },
      ],
      classes: [],
      users: [],
    };

    // 获取班级列表
    const classes = DB.all("SELECT id, name, grade FROM classes WHERE school_id = ? AND status = 'active' ORDER BY grade, name", [schoolId]);
    result.classes = classes.map(c => {
      return { value: String(c.id), label: c.grade + ' - ' + c.name };
    });

    // 获取用户列表
    const users = DB.all("SELECT id, username, display_name, role FROM users WHERE school_id = ? AND status = 'active' ORDER BY display_name", [schoolId]);
    result.users = users.map(u => {
      const roleLabel = ({ admin: '管理员', teacher: '教师', student: '学生' })[u.role] ?? u.role;
      return { value: String(u.id), label: u.display_name + ' (' + roleLabel + ')' };
    });

    Response.success(result);
  }

  Response.error('未知的操作');
};