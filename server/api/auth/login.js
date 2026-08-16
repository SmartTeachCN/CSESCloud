/**
 * 子用户登录 API
 *  - 学校子用户：school_id + username + password
 *  - 实例子用户：instance_uid + username + password
 *  - 可选 remember_in_list：登录成功后将该账号写入保留登录列表
 */
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  if (!Helpers.isPost()) {
    Response.error('仅支持 POST 请求', 405, 405);
  }

  const b = Helpers.jsonBody();
  const schoolId = parseInt(b.school_id ?? 0, 10) || 0;
  const instanceUid = String(b.instance_uid ?? '').trim();
  const username = String(b.username ?? '').trim();
  const password = b.password ?? '';
  const rememberInList = !Helpers.empty(b.remember_in_list);

  if (!username || !password) {
    Response.error('请填写完整信息');
  }

  // 路由：实例子用户 vs 学校子用户
  const isInstanceLogin = (instanceUid !== '');
  let entry;
  let redirect;
  if (isInstanceLogin) {
    const ok = Auth.loginInstanceSubUser(instanceUid, username, password);
    if (!ok) Response.error('实例 ID、用户名或密码错误', 1, 400);
    entry = {
      'entry_type': 'instance_sub',
      'display_label': username + ' @ ' + instanceUid,
      'school_id': (Auth.user() || {}).school_id ?? null,
      'instance_uid': instanceUid,
      'sub_username': username,
    };
    redirect = '/console/instances?from=instance_sub';
  } else {
    if (!schoolId) Response.error('请选择学校或填入实例 ID');
    const ok = Auth.loginSubUser(schoolId, username, password);
    if (!ok) Response.error('用户名或密码错误', 1, 400);
    entry = {
      'entry_type': 'school_sub',
      'display_label': username + ' @ ' + ((Auth.user() || {}).school_name ?? ('SID:' + schoolId)),
      'school_id': schoolId,
      'instance_uid': null,
      'sub_username': username,
    };
    redirect = '/console/campus';
  }

  if (rememberInList) {
    Auth.saveLogin(entry);
  }

  Response.success({ redirect, entry }, '登录成功');
};