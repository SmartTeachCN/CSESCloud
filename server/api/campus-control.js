/**
 * 校园集控单元 API
 * 集控ID与实例ID分离，每个集控单元关联一个实例，便于按实例备份
 *
 * 操作：
 *  - GET  action=list                       列出当前学校的集控单元
 *  - GET  action=get&id=N                   获取集控单元详情
 *  - POST action=create                     创建集控单元
 *  - POST action=update                     更新集控单元
 *  - POST action=delete                     删除集控单元
 *  - POST action=save-variables             保存集控变量值
 */
const { nowStr } = require('../lib/response');

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  // body 即 Helpers::jsonBody()

  // 校园概览指标：班级 / 学生 / 教师 / 实例 / 集控单元 / 今日操作
  if (method === 'GET' && action === 'overview') {
    if (!schoolId) Response.success({
      classes: 0, students: 0, teachers: 0,
      instances: 0, control_units: 0, today_ops: 0,
      recent_activities: [], class_status: []
    });

    // 注：与 PHP 原版一致，占位符未绑定参数（PDO 缺省绑 NULL，条件不成立返回 0）
    const classes = (DB.one("SELECT COUNT(*) c FROM classes WHERE school_id = ?", [null]) || {})['c'] ?? 0;
    const students = (DB.one("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role = 'student'", [null]) || {})['c'] ?? 0;
    const teachers = (DB.one("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role IN ('teacher','admin')", [null]) || {})['c'] ?? 0;
    const instances = (DB.one("SELECT COUNT(*) c FROM instances WHERE school_id = ?", [null]) || {})['c'] ?? 0;
    const controlUnits = (DB.one("SELECT COUNT(*) c FROM campus_control_units WHERE school_id = ?", [null]) || {})['c'] ?? 0;
    const todayOps = (DB.one("SELECT COUNT(*) c FROM audit_logs WHERE school_id = ? AND DATE(created_at) = DATE('now')", [null]) || {})['c'] ?? 0;

    // 班级状态总览
    const classStatus = DB.all(
      `SELECT c.id, c.name, c.student_count, c.head_teacher AS teacher,
              CASE WHEN EXISTS (SELECT 1 FROM instances i WHERE i.school_id = c.school_id AND i.status = 'running') THEN 'online' ELSE 'offline' END AS status
       FROM classes c WHERE c.school_id = ? ORDER BY c.id DESC LIMIT 20`,
      [schoolId]
    );

    // 最近活动（审计日志最近 8 条）
    const recent = DB.all(
      `SELECT a.action, a.target, a.username, a.created_at, a.status
       FROM audit_logs a WHERE a.school_id = ? ORDER BY a.id DESC LIMIT 8`,
      [schoolId]
    );

    Response.success({
      classes: parseInt(classes, 10) || 0,
      students: parseInt(students, 10) || 0,
      teachers: parseInt(teachers, 10) || 0,
      instances: parseInt(instances, 10) || 0,
      control_units: parseInt(controlUnits, 10) || 0,
      today_ops: parseInt(todayOps, 10) || 0,
      class_status: classStatus,
      recent_activities: recent.map(function (r) {
        let type = 'info';
        if (r.status === 'success') type = 'success';
        else if (r.status === 'error' || r.status === 'failed') type = 'error';
        else if (['create', 'delete', 'update'].includes(r.action)) type = 'warning';
        return {
          text: `[${r.username}] ${r.action} - ${r.target}`,
          time: r.created_at,
          type: type
        };
      })
    });
  }

  if (method === 'GET' && action === 'list') {
    const rows = DB.all(
      `SELECT ccu.*, i.name AS instance_name, i.service_type,
              ccp.name AS package_name, ccp.package_key
       FROM campus_control_units ccu
       JOIN instances i ON i.id = ccu.instance_id
       LEFT JOIN cc_packages ccp ON ccp.id = ccu.cc_package_id
       WHERE ccu.school_id = ? ORDER BY ccu.id DESC`,
      [schoolId]
    );
    Response.success(rows);
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    let row = DB.one(
      `SELECT ccu.*, i.name AS instance_name, i.service_type,
              ccp.name AS package_name, ccp.package_key,
              ccp.package_manifest, ccp.calling_instances_manifest,
              ccp.variable_manifest, ccp.editor_html, ccp.editor_js
       FROM campus_control_units ccu
       JOIN instances i ON i.id = ccu.instance_id
       LEFT JOIN cc_packages ccp ON ccp.id = ccu.cc_package_id
       WHERE ccu.id = ? AND ccu.school_id = ?`,
      [id, schoolId]
    );
    if (!row) Response.error('集控单元不存在');
    for (const k of ['config', 'variables', 'package_manifest', 'calling_instances_manifest', 'variable_manifest']) {
      if (!Helpers.empty(row[k])) row[k] = JSON.parse(row[k]);
    }
    Response.success(row);
  }

  if (method === 'POST' && action === 'create') {
    const instanceId = parseInt(body.instance_id ?? 0, 10) || 0;
    const name = String(body.name ?? '').trim();
    const ccPackageId = parseInt(body.cc_package_id ?? 0, 10) || 0;
    if (instanceId <= 0 || name === '') Response.error('实例ID和名称不能为空');
    const ins = DB.one("SELECT * FROM instances WHERE id = ? AND school_id = ?", [instanceId, schoolId]);
    if (!ins) Response.error('实例不存在');
    const now = nowStr();
    const id = DB.insert('campus_control_units', {
      school_id: schoolId,
      instance_id: instanceId,
      cc_package_id: ccPackageId > 0 ? ccPackageId : null,
      name: name,
      config: JSON.stringify(body.config ?? []),
      variables: JSON.stringify([]),
      status: 'active',
      created_at: now,
    });
    Auth.logAudit(schoolId, (Auth.user() || {})['user_id'] ?? 0, 'create', `创建集控单元 ${name}`);
    Response.success({ id: id }, '集控单元已创建');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const row = DB.one("SELECT * FROM campus_control_units WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!row) Response.error('集控单元不存在');
    const updates = {};
    if ('name' in body) updates.name = String(body.name).trim();
    if ('cc_package_id' in body) updates.cc_package_id = (parseInt(body.cc_package_id, 10) || 0) > 0 ? (parseInt(body.cc_package_id, 10) || 0) : null;
    if ('config' in body) updates.config = JSON.stringify(body.config);
    if ('status' in body) updates.status = body.status;
    DB.update('campus_control_units', updates, 'id = ? AND school_id = ?', [id, schoolId]);
    Response.success(null, '已保存');
  }

  if (method === 'POST' && action === 'save-variables') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const row = DB.one("SELECT * FROM campus_control_units WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!row) Response.error('集控单元不存在');
    const variables = body.variables ?? [];
    DB.update('campus_control_units', { variables: JSON.stringify(variables) }, 'id = ? AND school_id = ?', [id, schoolId]);
    Response.success(null, '变量已保存');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const row = DB.one("SELECT * FROM campus_control_units WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!row) Response.error('集控单元不存在');
    DB.delete('campus_control_units', 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {})['user_id'] ?? 0, 'delete', `删除集控单元 ${row.name}`);
    Response.success(null, '已删除');
  }

  Response.error('未知的操作');
};
