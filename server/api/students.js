/** 学生 CRUD API */
const { nowStr } = require('../lib/response');

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  if (method === 'GET' && action === 'list') {
    const classId = parseInt(query.class_id ?? 0, 10) || 0;
    const keyword = String(query.keyword ?? '').trim();
    let sql = "SELECT * FROM students WHERE school_id = ?";
    const params = [schoolId];
    if (classId > 0) { sql += " AND class_id = ?"; params.push(classId); }
    if (keyword !== '') { sql += " AND (name LIKE ? OR student_no LIKE ?)"; params.push(`%${keyword}%`); params.push(`%${keyword}%`); }
    sql += " ORDER BY id DESC";
    Response.success(DB.all(sql, params));
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const stu = DB.one(`SELECT s.*, c.name AS class_name, c.grade
                    FROM students s LEFT JOIN classes c ON c.id = s.class_id
                    WHERE s.id = ? AND s.school_id = ?`, [id, schoolId]);
    if (!stu) Response.error('学生不存在');
    Response.success(stu);
  }

  if (method === 'POST' && action === 'create') {
    const name = String(b.name ?? '').trim();
    const classId = parseInt(b.class_id ?? 0, 10) || 0;
    const gender = b.gender ?? '男';
    if (Helpers.empty(name) || !classId) Response.error('请填写学生姓名和班级');
    // 生成学号
    const count = (parseInt(DB.scalar("SELECT COUNT(*) FROM students WHERE class_id = ?", [classId]) ?? 0, 10) || 0) + 1;
    const studentNo = 'S' + String(classId).padStart(4, '0') + String(count).padStart(3, '0');
    const id = DB.insert('students', {
      school_id: schoolId, class_id: classId, name: name,
      student_no: studentNo, gender: gender, status: 'active',
      created_at: nowStr(),
    });
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'create', `新增学生 ${name}`);
    Response.success({ id, student_no: studentNo }, '学生添加成功');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    const name = String(b.name ?? '').trim();
    const classId = parseInt(b.class_id ?? 0, 10) || 0;
    const gender = b.gender ?? '男';
    if (!id || Helpers.empty(name)) Response.error('参数错误');
    DB.update('students', { name: name, class_id: classId, gender: gender }, 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'update', `修改学生 ${name}`);
    Response.success(null, '更新成功');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    if (!id) Response.error('参数错误');
    const stu = DB.one("SELECT * FROM students WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!stu) Response.error('学生不存在');
    DB.delete('students', 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'delete', `删除学生 ${stu.name}`);
    Response.success(null, '删除成功');
  }

  Response.error('未知的操作');
};