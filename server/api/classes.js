/** 班级 CRUD API */
const { nowStr } = require('../lib/response');

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  if (method === 'GET' && action === 'list') {
    const keyword = String(query.keyword ?? '').trim();
    let sql = `SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
            FROM classes c WHERE c.school_id = ?`;
    const params = [schoolId];
    if (keyword !== '') {
      sql += " AND c.name LIKE ?";
      params.push(`%${keyword}%`);
    }
    sql += " ORDER BY c.id DESC";
    Response.success(DB.all(sql, params));
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const cls = DB.one(`SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS actual_count
                    FROM classes c WHERE c.id = ? AND c.school_id = ?`, [id, schoolId]);
    if (!cls) Response.error('班级不存在');
    Response.success(cls);
  }

  if (method === 'POST' && action === 'create') {
    const name = String(b.name ?? '').trim();
    const grade = String(b.grade ?? '').trim();
    const teacher = String(b.head_teacher ?? '').trim();
    if (Helpers.empty(name) || Helpers.empty(grade)) Response.error('请填写班级名称和年级');
    const id = DB.insert('classes', {
      school_id: schoolId,
      name: name,
      grade: grade,
      head_teacher: teacher,
      student_count: 0,
      status: 'active',
      created_at: nowStr(),
    });
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'create', `新增班级 ${name}`);
    Response.success({ id }, '班级创建成功');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    const name = String(b.name ?? '').trim();
    const grade = String(b.grade ?? '').trim();
    const teacher = String(b.head_teacher ?? '').trim();
    if (!id || Helpers.empty(name)) Response.error('参数错误');
    DB.update('classes', { name: name, grade: grade, head_teacher: teacher }, 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'update', `修改班级 ${name}`);
    Response.success(null, '更新成功');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    if (!id) Response.error('参数错误');
    const cls = DB.one("SELECT * FROM classes WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!cls) Response.error('班级不存在');
    DB.delete('classes', 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'delete', `删除班级 ${cls.name}`);
    Response.success(null, '删除成功');
  }

  Response.error('未知的操作');
};