/**
 * CSES Cloud - 会话与认证（NodeJS 版，1:1 复刻 lib/auth.php）
 *
 * 会话实现：文件型会话（data/sessions/{sid}.json），对齐 PHP session 持久化行为。
 * 通过 makeAuth(req, res) 创建绑定到当前请求的 Auth 对象。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const DB = require('./db');
const serverConfig = require('./server-config');
const { nowStr } = require('./response');

const ROOT = path.join(__dirname, '..', '..');
const SESSIONS_DIR = path.join(ROOT, 'data', 'sessions');
const COOKIE_NAME = 'CSES_SID';

// ── 会话存取 ──
function loadSession(sid) {
  if (!/^[a-f0-9]{32}$/.test(sid)) return {};
  const file = path.join(SESSIONS_DIR, sid + '.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveSession(sid, data) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const file = path.join(SESSIONS_DIR, sid + '.json');
  fs.writeFileSync(file, JSON.stringify(data));
}

function destroySession(sid) {
  if (!sid) return;
  try { fs.unlinkSync(path.join(SESSIONS_DIR, sid + '.json')); } catch (_) {}
}

/** 解析请求 Cookie（轻量实现） */
function parseCookies(header = '') {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** 初始化会话：解析/创建 sid，挂载 req.session */
function initSession(req, res) {
  if (req.session) return;
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies[COOKIE_NAME];
  if (!sid || !/^[a-f0-9]{32}$/.test(sid)) {
    sid = crypto.randomBytes(16).toString('hex');
    res.append('Set-Cookie',
      `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  req.sessionId = sid;
  req.session = loadSession(sid);
  req.sessionDirty = false;
  // 代理写入：$_SESSION['auth'] = [...] 形式自动标记 dirty
  req.session = new Proxy(req.session, {
    set(target, prop, value) {
      target[prop] = value;
      req.sessionDirty = true;
      return true;
    },
    deleteProperty(target, prop) {
      delete target[prop];
      req.sessionDirty = true;
      return true;
    },
  });
  res.on('finish', () => {
    if (req.sessionDirty) saveSession(req.sessionId, req.session);
  });
}

// ── 认证对象工厂（对齐 PHP Auth 静态类的全部方法） ──
function makeAuth(req, res) {
  const { HttpSent, makeResponse } = require('./response');
  const Response = makeResponse(res);

  const self = {
    /** 初始化会话 */
    init() {
      initSession(req, res);
    },

    /** 子用户登录（按学校 + 用户名 + 密码） */
    loginSubUser(schoolId, username, password) {
      const user = DB.one(
        `SELECT u.*, s.name AS school_name FROM users u
         JOIN schools s ON s.id = u.school_id
         WHERE u.school_id = ? AND u.username = ? AND u.status = 'active'`,
        [schoolId, username]
      );

      if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
        return false;
      }

      self.init();
      req.session.auth = {
        type: 'sub',
        user_id: user.id,
        school_id: user.school_id,
        school_name: user.school_name,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        email: user.email,
      };

      self.logAudit(user.school_id, user.id, 'login', '子用户登录', 'success');
      return true;
    },

    /** 智教联盟登录（按用户名直接登录，临时弹框方案） */
    loginAlliance(username) {
      username = String(username || '').trim();
      if (username === '') return false;

      // 联盟账户登录：默认绑定第一所学校作为当前上下文，可在控制台切换
      const school = DB.one('SELECT * FROM schools ORDER BY id ASC LIMIT 1');
      const schoolId = school ? school.id : 1;
      const schoolName = school ? school.name : '默认校园';

      self.init();
      req.session.auth = {
        type: 'alliance',
        user_id: 0,
        school_id: schoolId,
        school_name: schoolName,
        username,
        display_name: username,
        role: 'alliance',
        email: username + '@alliance.cses',
      };

      self.logAudit(schoolId, 0, 'login', `智教联盟登录: ${username}`, 'success');
      return true;
    },

    /** 智教联盟 OAuth 登录（真实 SSO，非 dev 模式；userInfo 为 SSO /api/userinfo 返回） */
    loginAllianceOauth(userInfo) {
      const info = userInfo || {};
      const username = String(info.preferred_username || info.name || info.sub || '').trim();
      if (!username) return false;

      // 联盟账户登录：默认绑定第一所学校作为当前上下文，可在控制台切换
      const school = DB.one('SELECT * FROM schools ORDER BY id ASC LIMIT 1');
      const schoolId = school ? school.id : 1;
      const schoolName = school ? school.name : '默认校园';

      self.init();
      req.session.auth = {
        type: 'alliance',
        user_id: 0,
        school_id: schoolId,
        school_name: schoolName,
        username,
        display_name: String(info.name || username),
        role: 'alliance',
        email: String(info.email || ''),
        alliance_sub: String(info.sub || ''),
      };

      self.logAudit(schoolId, 0, 'login', `智教联盟登录: ${username}`, 'success');
      return true;
    },

    /** 临时管理员登录 */
    loginTempAdmin(username, password) {
      const config = self.serverConfig();
      const ta = config.temp_admin || {};
      if (!ta.enabled) return false;
      if (username !== ta.username) return false;
      if (!bcrypt.compareSync(String(password), ta.password_hash)) return false;

      const school = DB.one('SELECT * FROM schools ORDER BY id ASC LIMIT 1');
      const schoolId = school ? school.id : 1;
      const schoolName = school ? school.name : '默认校园';

      self.init();
      req.session.auth = {
        type: 'temp_admin',
        user_id: 0,
        school_id: schoolId,
        school_name: schoolName,
        username,
        display_name: '临时管理员',
        role: 'super_admin',
        email: '',
        is_temp_admin: true,
      };

      self.logAudit(schoolId, 0, 'login', '临时管理员登录', 'success');
      return true;
    },

    /** 读取服务器配置 */
    serverConfig() {
      return serverConfig;
    },

    /** 当前是否临时管理员 */
    isTempAdmin() {
      const u = self.user();
      return !!(u && u.is_temp_admin);
    },

    /** 当前是否最高管理员（数据库中的 is_super_admin=1 的用户） */
    isSuperAdmin() {
      const u = self.user();
      if (!u) return false;
      if (u.is_temp_admin) return true;
      if (u.type === 'sub' && (u.user_id || 0) > 0) {
        const user = DB.one('SELECT is_super_admin FROM users WHERE id = ?', [u.user_id]);
        return !!(user && user.is_super_admin);
      }
      return false;
    },

    /** 设置用户为最高管理员（仅临时管理员可操作） */
    setSuperAdmin(userId, isSuper) {
      if (!self.isTempAdmin()) return false;
      return DB.update('users', { is_super_admin: isSuper ? 1 : 0 }, 'id = ?', [userId]) > 0;
    },

    /** 获取所有用户列表（管理后台用） */
    listAllUsers() {
      return DB.all(
        `SELECT u.*, s.name AS school_name FROM users u
         JOIN schools s ON s.id = u.school_id
         ORDER BY u.is_super_admin DESC, u.id ASC`
      );
    },

    /** 将用户设置为管理员 */
    setUserRole(userId, role) {
      return DB.update('users', { role }, 'id = ?', [userId]) > 0;
    },

    /** 退出登录 */
    logout() {
      self.init();
      if (req.session.auth) {
        self.logAudit(
          req.session.auth.school_id || 0,
          req.session.auth.user_id || 0,
          'logout',
          '用户退出登录',
          'success'
        );
      }
      const sid = req.sessionId;
      req.session.auth = null;
      destroySession(sid);
    },

    /** 当前是否已登录 */
    check() {
      self.init();
      return !!(req.session && req.session.auth);
    },

    /** 获取当前用户信息 */
    user() {
      self.init();
      return (req.session && req.session.auth) || null;
    },

    /** 要求登录，否则 401 JSON（API） */
    requireLogin() {
      if (!self.check()) {
        res.status(401);
        Response.json({ code: 401, message: '未登录', data: null });
      }
    },

    /** 当前学校 ID */
    schoolId() {
      const u = self.user();
      return u ? parseInt(u.school_id, 10) : 0;
    },

    /** 当前是否智教联盟登录（开发者中心仅允许联盟登录访问） */
    isAlliance() {
      const u = self.user();
      return !!(u && (u.type || '') === 'alliance');
    },

    /** 当前联盟用户名（开发者身份标识） */
    allianceUsername() {
      const u = self.user();
      return (u && (u.type || '') === 'alliance') ? (u.username || '') : '';
    },

    /** 要求联盟登录，否则 403 */
    requireAlliance() {
      self.requireLogin();
      if (!self.isAlliance() && !self.isSuperAdmin()) {
        res.status(403);
        Response.json({ code: 403, message: '此功能仅限智教联盟账户或系统管理员访问', data: null });
      }
    },

    /** 写审计日志 */
    logAudit(schoolId, userId, action, target, status = 'success', extra = {}) {
      try {
        DB.insert('audit_logs', {
          school_id: schoolId,
          user_id: userId,
          username: (self.user() || {}).username || 'system',
          action,
          target,
          ip: req.socket?.remoteAddress || 'cli',
          status,
          created_at: nowStr(),
        });
      } catch (_) {
        // 忽略日志写入失败
      }
    },

    /** 当前所有者 key：用于查询实例组/共享 */
    ownerKey() {
      const u = self.user();
      if (!u) return '';
      const type = u.type || 'sub';
      if (type === 'alliance') return 'alliance:' + (u.username || '');
      return 'sub:school:' + (u.school_id || 0) + ':' + (u.user_id || 0);
    },

    /** 智教联盟用户绑定一个子用户 */
    bindSubUser(allianceUsername, subUserId, alias = '', permissions = []) {
      const sub = DB.one(
        'SELECT u.*, s.name AS school_name FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = ?',
        [subUserId]
      );
      if (!sub) return false;
      const exists = DB.one(
        'SELECT id FROM alliance_account_bindings WHERE alliance_username = ? AND sub_user_id = ?',
        [allianceUsername, subUserId]
      );
      if (exists) return true;
      DB.insert('alliance_account_bindings', {
        alliance_username: allianceUsername,
        sub_user_id: subUserId,
        school_id: sub.school_id,
        alias: alias || sub.display_name,
        permissions: JSON.stringify(permissions),
        created_at: nowStr(),
      });
      self.logAudit(sub.school_id, 0, 'bind', `联盟 ${allianceUsername} 绑定子用户 ${sub.username}`);
      return true;
    },

    /** 当前联盟用户已绑定的子用户列表 */
    listBindings(allianceUsername) {
      return DB.all(
        `SELECT b.*, u.username AS sub_username, u.display_name, u.role, s.name AS school_name
         FROM alliance_account_bindings b
         JOIN users u ON u.id = b.sub_user_id
         JOIN schools s ON s.id = b.school_id
         WHERE b.alliance_username = ? ORDER BY b.id DESC`,
        [allianceUsername]
      );
    },

    /** 解绑子用户 */
    unbindSubUser(allianceUsername, bindingId) {
      return DB.delete('alliance_account_bindings', 'id = ? AND alliance_username = ?', [bindingId, allianceUsername]) > 0;
    },

    /** 列出保留登录条目 */
    listSavedLogins() {
      return DB.all('SELECT * FROM saved_login_entries ORDER BY id DESC');
    },

    /** 保存保留登录条目（按类型 + 学校 + 用户名去重） */
    saveLogin(entry) {
      const exists = DB.one(
        `SELECT id FROM saved_login_entries WHERE entry_type = ? AND sub_username = ?
         AND COALESCE(school_id,0) = ?`,
        [entry.entry_type, entry.sub_username, parseInt(entry.school_id || 0, 10)]
      );
      if (exists) return exists.id;
      return DB.insert('saved_login_entries', {
        entry_type: entry.entry_type,
        display_label: entry.display_label,
        school_id: entry.school_id ?? null,
        instance_uid: null,
        sub_username: entry.sub_username,
        created_at: nowStr(),
      });
    },

    /** 移除保留登录条目 */
    removeSavedLogin(id) {
      return DB.delete('saved_login_entries', 'id = ?', [id]) > 0;
    },

    /** 联盟用户已加入的学校列表（含其绑定子用户所在的学校 + 自身管理的学校） */
    listJoinedSchools(allianceUsername) {
      return DB.all(
        `SELECT s.* FROM schools s
         WHERE s.id IN (SELECT school_id FROM alliance_account_bindings WHERE alliance_username = ?)
            OR s.admin_username = ?
         ORDER BY s.id ASC`,
        [allianceUsername, allianceUsername]
      );
    },

    /** 校验当前用户对实例的访问权限（owner 或共享给当前用户） */
    canAccessInstance(instanceId) {
      const u = self.user();
      if (!u) return false;
      const inst = DB.one('SELECT * FROM instances WHERE id = ?', [instanceId]);
      if (!inst) return false;
      // 所有者
      if (parseInt(inst.owner_user_id, 10) === parseInt(u.user_id || 0, 10) && inst.owner_type === (u.type || 'sub')) {
        return true;
      }
      // 学校管理员可访问本校实例
      if ((u.type || '') === 'sub' && u.role === 'admin' && parseInt(inst.school_id, 10) === parseInt(u.school_id, 10)) {
        return true;
      }
      // 共享给当前用户
      const share = DB.one(
        'SELECT 1 AS x FROM instance_shares WHERE instance_id = ? AND target_user_id = ? AND target_type = ?',
        [instanceId, u.user_id || 0, u.type || 'sub']
      );
      return !!share;
    },

    /** 校验当前用户对实例的写权限 */
    canWriteInstance(instanceId) {
      return self.canAccessInstance(instanceId);
    },
  };

  return self;
}

module.exports = { makeAuth, initSession, COOKIE_NAME };
