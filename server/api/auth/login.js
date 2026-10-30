/**
 * 子用户登录 API
 *  - 学校子用户：school_id + username + password
 *  - 可选 remember_in_list：登录成功后将该账号写入保留登录列表
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  if (!Helpers.isPost()) {
    Response.error('仅支持 POST 请求', 405, 405);
  }

  const b = Helpers.jsonBody();
  const schoolId = parseInt(b.school_id ?? 0, 10) || 0;
  const username = String(b.username ?? '').trim();
  const password = b.password ?? '';
  const rememberInList = !Helpers.empty(b.remember_in_list);

  if (!username || !password) {
    Response.error('请填写完整信息');
  }

  if (!schoolId) Response.error('请选择学校');
  const ok = Auth.loginSubUser(schoolId, username, password);
  if (!ok) Response.error('用户名或密码错误', 1, 400);
  const entry = {
    'entry_type': 'school_sub',
    'display_label': username + ' @ ' + ((Auth.user() || {}).school_name ?? ('SID:' + schoolId)),
    'school_id': schoolId,
    'instance_uid': null,
    'sub_username': username,
  };
  const redirect = '/console/editor/light';

  if (rememberInList) {
    Auth.saveLogin(entry);
  }

  Response.success({ redirect, entry }, '登录成功');
};
