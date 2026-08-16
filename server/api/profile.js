/** 个人中心 API */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { nowStr } = require('../lib/response');

const ROOT = path.join(__dirname, '..', '..');

/** PHP json_decode(s, true) 等价：失败返回 null */
function jsonDecodeSafe(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  let user = Auth.user() || {};

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  // 获取完整用户资料（含 department、avatar、preferences）
  if (method === 'GET' && action === 'profile') {
    const userId = user.user_id;
    if (user.type === 'sub') {
      const row = DB.one('SELECT id, username, display_name, email, phone, department, avatar, preferences, role FROM users WHERE id = ?', [userId]);
      if (row) {
        row.preferences = row.preferences ? jsonDecodeSafe(row.preferences) : {};
        user = { ...user, ...row };
      }
    }
    // 联盟账户无数据库记录，返回 session 数据
    if (!('department' in user)) user.department = '';
    if (!('avatar' in user)) user.avatar = '';
    if (!('preferences' in user)) user.preferences = {};
    else if (typeof user.preferences === 'string') user.preferences = jsonDecodeSafe(user.preferences);
    if (!('phone' in user)) user.phone = '';
    Response.success(user);
  }

  // 更新个人资料
  if (method === 'POST' && action === 'update-profile') {
    const displayName = String(b.display_name ?? '').trim();
    const email = String(b.email ?? '').trim();
    const phone = String(b.phone ?? '').trim();
    const department = String(b.department ?? '').trim();
    if (Helpers.empty(displayName)) Response.error('请填写姓名');

    if (user.type === 'sub') {
      DB.update('users', {
        display_name: displayName,
        email: email,
        phone: phone,
        department: department,
      }, 'id = ?', [user.user_id]);
    }
    req.session.auth.display_name = displayName;
    req.session.auth.email = email;
    req.sessionDirty = true;
    Response.success(null, '资料已更新');
  }

  // 修改密码
  if (method === 'POST' && action === 'change-password') {
    const oldPwd = b.old_password ?? '';
    const newPwd = b.new_password ?? '';
    if (Buffer.byteLength(String(newPwd), 'utf8') < 6) Response.error('新密码至少 6 位');

    if (user.type === 'sub') {
      // 验证旧密码
      const row = DB.one('SELECT password_hash FROM users WHERE id = ?', [user.user_id]);
      if (!row || !bcrypt.compareSync(String(oldPwd), row.password_hash)) {
        Response.error('旧密码不正确');
      }
      DB.update('users', { password_hash: bcrypt.hashSync(newPwd, 10) }, 'id = ?', [user.user_id]);
      Auth.logAudit(user.school_id, user.user_id, 'update', '修改个人密码');
    } else {
      // 联盟账户/临时管理员不支持修改密码
      Response.error('当前账户类型不支持修改密码');
    }
    Response.success(null, '密码已修改');
  }

  // 更新头像
  if (method === 'POST' && action === 'update-avatar') {
    const avatar = String(b.avatar ?? '').trim();
    if (user.type === 'sub') {
      DB.update('users', { avatar: avatar }, 'id = ?', [user.user_id]);
    }
    req.session.auth.avatar = avatar;
    req.sessionDirty = true;
    Response.success(null, '头像已更新');
  }

  // 上传头像文件
  if (method === 'POST' && action === 'upload-avatar') {
    if (!files.file || files.file.error !== 0) {
      Response.error('上传失败');
    }
    const file = files.file;
    const ext = path.extname(file.name).slice(1).toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      Response.error('仅支持 JPG、PNG、GIF、WebP 格式');
    }
    if (file.size > 2 * 1024 * 1024) {
      Response.error('头像文件不能超过 2MB');
    }

    const uploadDir = path.join(ROOT, 'data', 'avatars');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filename = 'avatar_' + user.user_id + '_' + Math.floor(Date.now() / 1000) + '.' + ext;
    const destPath = path.join(uploadDir, filename);

    if (!ctx.moveUploadedFile(file, destPath)) {
      Response.error('文件保存失败');
    }

    const avatarUrl = '/api/avatar.php?file=' + encodeURIComponent(filename);
    if (user.type === 'sub') {
      DB.update('users', { avatar: avatarUrl }, 'id = ?', [user.user_id]);
    }
    req.session.auth.avatar = avatarUrl;
    req.sessionDirty = true;
    Response.success({ url: avatarUrl }, '头像上传成功');
  }

  // 保存偏好设置
  if (method === 'POST' && action === 'save-preferences') {
    const preferences = b.preferences ?? [];
    const prefsJson = JSON.stringify(preferences);
    if (user.type === 'sub') {
      DB.update('users', { preferences: prefsJson }, 'id = ?', [user.user_id]);
    }
    Response.success(null, '偏好已保存');
  }

  Response.error('未知的操作');
};