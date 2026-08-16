<?php
/**
 * CSES Cloud - 会话与认证
 */

class Auth
{
    /** 初始化会话 */
    public static function init()
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    /** 子用户登录（按学校 + 用户名 + 密码） */
    public static function loginSubUser($schoolId, $username, $password)
    {
        $user = DB::one(
            "SELECT u.*, s.name AS school_name FROM users u
             JOIN schools s ON s.id = u.school_id
             WHERE u.school_id = ? AND u.username = ? AND u.status = 'active'",
            [$schoolId, $username]
        );

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }

        self::init();
        $_SESSION['auth'] = [
            'type' => 'sub',
            'user_id' => $user['id'],
            'school_id' => $user['school_id'],
            'school_name' => $user['school_name'],
            'username' => $user['username'],
            'display_name' => $user['display_name'],
            'role' => $user['role'],
            'email' => $user['email'],
        ];

        self::logAudit($user['school_id'], $user['id'], 'login', '子用户登录', 'success');
        return true;
    }

    /** 智教联盟登录（按用户名直接登录，临时弹框方案） */
    public static function loginAlliance($username)
    {
        $username = trim($username);
        if ($username === '') {
            return false;
        }

        // 联盟账户登录：默认绑定第一所学校作为当前上下文，可在控制台切换
        $school = DB::one("SELECT * FROM schools ORDER BY id ASC LIMIT 1");
        $schoolId = $school ? $school['id'] : 1;
        $schoolName = $school ? $school['name'] : '默认校园';

        self::init();
        $_SESSION['auth'] = [
            'type' => 'alliance',
            'user_id' => 0,
            'school_id' => $schoolId,
            'school_name' => $schoolName,
            'username' => $username,
            'display_name' => $username,
            'role' => 'alliance',
            'email' => $username . '@alliance.cses',
        ];

        self::logAudit($schoolId, 0, 'login', "智教联盟登录: {$username}", 'success');
        return true;
    }

    /** 临时管理员登录 */
    public static function loginTempAdmin($username, $password)
    {
        $config = self::serverConfig();
        $ta = $config['temp_admin'] ?? [];
        if (empty($ta['enabled'])) return false;
        if ($username !== $ta['username']) return false;
        if (!password_verify($password, $ta['password_hash'])) return false;

        $school = DB::one("SELECT * FROM schools ORDER BY id ASC LIMIT 1");
        $schoolId = $school ? $school['id'] : 1;
        $schoolName = $school ? $school['name'] : '默认校园';

        self::init();
        $_SESSION['auth'] = [
            'type' => 'temp_admin',
            'user_id' => 0,
            'school_id' => $schoolId,
            'school_name' => $schoolName,
            'username' => $username,
            'display_name' => '临时管理员',
            'role' => 'super_admin',
            'email' => '',
            'is_temp_admin' => true,
        ];

        self::logAudit($schoolId, 0, 'login', '临时管理员登录', 'success');
        return true;
    }

    /** 读取服务器配置 */
    public static function serverConfig()
    {
        static $config = null;
        if ($config === null) {
            $path = __DIR__ . '/server-config.php';
            $config = file_exists($path) ? (require $path) : [];
        }
        return $config;
    }

    /** 当前是否临时管理员 */
    public static function isTempAdmin()
    {
        $u = self::user();
        return $u && !empty($u['is_temp_admin']);
    }

    /** 当前是否最高管理员（数据库中的 is_super_admin=1 的用户） */
    public static function isSuperAdmin()
    {
        $u = self::user();
        if (!$u) return false;
        if (!empty($u['is_temp_admin'])) return true;
        if ($u['type'] === 'sub' && ($u['user_id'] ?? 0) > 0) {
            $user = DB::one("SELECT is_super_admin FROM users WHERE id = ?", [$u['user_id']]);
            return !empty($user['is_super_admin']);
        }
        return false;
    }

    /** 设置用户为最高管理员（仅临时管理员可操作） */
    public static function setSuperAdmin($userId, $isSuper)
    {
        if (!self::isTempAdmin()) return false;
        return DB::update('users', ['is_super_admin' => $isSuper ? 1 : 0], 'id = ?', [$userId]) > 0;
    }

    /** 获取所有用户列表（管理后台用） */
    public static function listAllUsers()
    {
        return DB::all(
            "SELECT u.*, s.name AS school_name FROM users u
             JOIN schools s ON s.id = u.school_id
             ORDER BY u.is_super_admin DESC, u.id ASC"
        );
    }

    /** 将用户设置为管理员 */
    public static function setUserRole($userId, $role)
    {
        return DB::update('users', ['role' => $role], 'id = ?', [$userId]) > 0;
    }

    /** 退出登录 */
    public static function logout()
    {
        self::init();
        if (!empty($_SESSION['auth'])) {
            self::logAudit(
                $_SESSION['auth']['school_id'] ?? 0,
                $_SESSION['auth']['user_id'] ?? 0,
                'logout',
                '用户退出登录',
                'success'
            );
        }
        $_SESSION['auth'] = null;
        session_destroy();
    }

    /** 当前是否已登录 */
    public static function check()
    {
        self::init();
        return !empty($_SESSION['auth']);
    }

    /** 获取当前用户信息 */
    public static function user()
    {
        self::init();
        return $_SESSION['auth'] ?? null;
    }

    /** 要求登录，否则跳转（API 返回 JSON 401） */
    public static function requireLogin()
    {
        if (!self::check()) {
            $uri = $_SERVER['REQUEST_URI'] ?? '';
            if (preg_match('#^/api/#', $uri)) {
                http_response_code(401);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['code' => 401, 'message' => '未登录', 'data' => null]);
                exit;
            }
            header('Location: /login.php');
            exit;
        }
    }

    /** 当前学校 ID */
    public static function schoolId()
    {
        $u = self::user();
        return $u ? (int)$u['school_id'] : 0;
    }

    /** 当前是否智教联盟登录（开发者中心仅允许联盟登录访问） */
    public static function isAlliance()
    {
        $u = self::user();
        return $u && ($u['type'] ?? '') === 'alliance';
    }

    /** 当前联盟用户名（开发者身份标识） */
    public static function allianceUsername()
    {
        $u = self::user();
        return $u && ($u['type'] ?? '') === 'alliance' ? ($u['username'] ?? '') : '';
    }

    /** 要求联盟登录，否则 403 */
    public static function requireAlliance()
    {
        self::requireLogin();
        if (!self::isAlliance() && !self::isSuperAdmin()) {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['code' => 403, 'message' => '此功能仅限智教联盟账户或系统管理员访问', 'data' => null]);
            exit;
        }
    }

    /** 切换当前学校（联盟账户可用） */
    public static function switchSchool($schoolId)
    {
        self::init();
        if (empty($_SESSION['auth'])) {
            return false;
        }
        $school = DB::one("SELECT * FROM schools WHERE id = ?", [$schoolId]);
        if (!$school) {
            return false;
        }
        $_SESSION['auth']['school_id'] = $school['id'];
        $_SESSION['auth']['school_name'] = $school['name'];
        return true;
    }

    /** 写审计日志 */
    public static function logAudit($schoolId, $userId, $action, $target, $status = 'success', $extra = [])
    {
        try {
            DB::insert('audit_logs', [
                'school_id' => $schoolId,
                'user_id' => $userId,
                'username' => self::user()['username'] ?? 'system',
                'action' => $action,
                'target' => $target,
                'ip' => $_SERVER['REMOTE_ADDR'] ?? 'cli',
                'status' => $status,
                'created_at' => date('Y-m-d H:i:s'),
            ]);
        } catch (Throwable $e) {
            // 忽略日志写入失败
        }
    }

    /** 实例子用户登录：通过 instance_uid + username + password */
    public static function loginInstanceSubUser($instanceUid, $username, $password)
    {
        $instance = DB::one("SELECT * FROM instances WHERE instance_uid = ?", [$instanceUid]);
        if (!$instance) return false;
        $user = DB::one(
            "SELECT u.*, s.name AS school_name FROM users u
             JOIN schools s ON s.id = u.school_id
             WHERE u.school_id = ? AND u.username = ? AND u.status = 'active'",
            [$instance['school_id'], $username]
        );
        if (!$user || !password_verify($password, $user['password_hash'])) return false;
        self::init();
        $_SESSION['auth'] = [
            'type' => 'instance_sub',
            'user_id' => $user['id'],
            'school_id' => $user['school_id'],
            'school_name' => $user['school_name'],
            'instance_id' => $instance['id'],
            'instance_uid' => $instanceUid,
            'username' => $user['username'],
            'display_name' => $user['display_name'],
            'role' => $user['role'],
            'email' => $user['email'],
        ];
        self::logAudit($user['school_id'], $user['id'], 'login', "实例子用户登录 instance={$instanceUid}", 'success');
        return true;
    }

    /** 当前是否实例子用户 */
    public static function isInstanceSub()
    {
        $u = self::user();
        return $u && ($u['type'] ?? '') === 'instance_sub';
    }

    /** 当前实例 ID（实例子用户登录时） */
    public static function instanceId()
    {
        $u = self::user();
        return ($u && ($u['type'] ?? '') === 'instance_sub') ? (int)$u['instance_id'] : 0;
    }

    /** 当前所有者 key：用于查询实例组/共享 */
    public static function ownerKey()
    {
        $u = self::user();
        if (!$u) return '';
        $type = $u['type'] ?? 'sub';
        if ($type === 'alliance') return 'alliance:' . ($u['username'] ?? '');
        if ($type === 'instance_sub') return 'sub:inst:' . ($u['instance_id'] ?? 0) . ':' . ($u['user_id'] ?? 0);
        return 'sub:school:' . ($u['school_id'] ?? 0) . ':' . ($u['user_id'] ?? 0);
    }

    /** 智教联盟用户绑定一个子用户 */
    public static function bindSubUser($allianceUsername, $subUserId, $alias = '', $permissions = [])
    {
        $sub = DB::one("SELECT u.*, s.name AS school_name FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = ?", [$subUserId]);
        if (!$sub) return false;
        // INSERT OR IGNORE，避免重复绑定
        $exists = DB::one("SELECT id FROM alliance_account_bindings WHERE alliance_username = ? AND sub_user_id = ?", [$allianceUsername, $subUserId]);
        if ($exists) return true;
        DB::insert('alliance_account_bindings', [
            'alliance_username' => $allianceUsername,
            'sub_user_id' => $subUserId,
            'school_id' => $sub['school_id'],
            'alias' => $alias ?: $sub['display_name'],
            'permissions' => json_encode($permissions, JSON_UNESCAPED_UNICODE),
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        self::logAudit($sub['school_id'], 0, 'bind', "联盟 {$allianceUsername} 绑定子用户 {$sub['username']}");
        return true;
    }

    /** 当前联盟用户已绑定的子用户列表 */
    public static function listBindings($allianceUsername)
    {
        return DB::all(
            "SELECT b.*, u.username AS sub_username, u.display_name, u.role, s.name AS school_name
             FROM alliance_account_bindings b
             JOIN users u ON u.id = b.sub_user_id
             JOIN schools s ON s.id = b.school_id
             WHERE b.alliance_username = ? ORDER BY b.id DESC",
            [$allianceUsername]
        );
    }

    /** 列出某学校所有子用户的联盟绑定关系（供学校管理员查看） */
    public static function listSchoolBindings($schoolId)
    {
        return DB::all(
            "SELECT b.*, u.username AS sub_username, u.display_name AS sub_display_name, u.role AS sub_role
             FROM alliance_account_bindings b
             JOIN users u ON u.id = b.sub_user_id
             WHERE b.school_id = ? ORDER BY b.id DESC",
            [$schoolId]
        );
    }

    /** 解绑子用户 */
    public static function unbindSubUser($allianceUsername, $bindingId)
    {
        return DB::delete('alliance_account_bindings', 'id = ? AND alliance_username = ?', [$bindingId, $allianceUsername]) > 0;
    }

    /** 学校管理员解绑本校子用户的联盟绑定 */
    public static function schoolUnbind($schoolId, $bindingId)
    {
        return DB::delete('alliance_account_bindings', 'id = ? AND school_id = ?', [$bindingId, $schoolId]) > 0;
    }

    /** 列出保留登录条目 */
    public static function listSavedLogins()
    {
        return DB::all("SELECT * FROM saved_login_entries ORDER BY id DESC");
    }

    /** 保存保留登录条目（去重） */
    public static function saveLogin($entry)
    {
        $exists = DB::one(
            "SELECT id FROM saved_login_entries WHERE entry_type = ? AND sub_username = ? AND COALESCE(school_id,0) = ? AND COALESCE(instance_uid,'') = ?",
            [$entry['entry_type'], $entry['sub_username'], (int)($entry['school_id'] ?? 0), $entry['instance_uid'] ?? '']
        );
        if ($exists) return $exists['id'];
        return DB::insert('saved_login_entries', [
            'entry_type' => $entry['entry_type'],
            'display_label' => $entry['display_label'],
            'school_id' => $entry['school_id'] ?? null,
            'instance_uid' => $entry['instance_uid'] ?? null,
            'sub_username' => $entry['sub_username'],
            'created_at' => date('Y-m-d H:i:s'),
        ]);
    }

    /** 移除保留登录条目 */
    public static function removeSavedLogin($id)
    {
        return DB::delete('saved_login_entries', 'id = ?', [$id]) > 0;
    }

    /** 联盟用户已加入的学校列表（含其绑定子用户所在的学校 + 自身管理的学校） */
    public static function listJoinedSchools($allianceUsername)
    {
        return DB::all(
            "SELECT s.* FROM schools s
             WHERE s.id IN (SELECT school_id FROM alliance_account_bindings WHERE alliance_username = ?)
                OR s.admin_username = ?
             ORDER BY s.id ASC",
            [$allianceUsername, $allianceUsername]
        );
    }

    /** 创建加入学校申请（避免重复） */
    public static function createJoinRequest($schoolId, $allianceUsername, $displayName = '')
    {
        $exists = DB::one("SELECT id FROM school_join_requests WHERE school_id = ? AND applicant_username = ? AND status = 'pending'", [$schoolId, $allianceUsername]);
        if ($exists) return false;
        DB::insert('school_join_requests', [
            'school_id' => $schoolId,
            'applicant_username' => $allianceUsername,
            'applicant_display_name' => $displayName ?: $allianceUsername,
            'status' => 'pending',
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        return true;
    }

    /** 列出某学校的加入申请 */
    public static function listJoinRequests($schoolId)
    {
        return DB::all("SELECT * FROM school_join_requests WHERE school_id = ? ORDER BY id DESC", [$schoolId]);
    }

    /** 审批加入申请 */
    public static function approveJoinRequest($requestId, $reviewerId, $approve = true)
    {
        $req = DB::one("SELECT * FROM school_join_requests WHERE id = ?", [$requestId]);
        if (!$req) return false;
        DB::update('school_join_requests', [
            'status' => $approve ? 'approved' : 'rejected',
            'reviewer_id' => $reviewerId,
            'reviewed_at' => date('Y-m-d H:i:s'),
        ], 'id = ?', [$requestId]);
        return true;
    }

    /** 校验当前用户对实例的访问权限（owner 或共享给当前用户） */
    public static function canAccessInstance($instanceId)
    {
        $u = self::user();
        if (!$u) return false;
        if (self::isInstanceSub()) {
            return (int)$u['instance_id'] === (int)$instanceId;
        }
        $inst = DB::one("SELECT * FROM instances WHERE id = ?", [$instanceId]);
        if (!$inst) return false;
        // 所有者
        if ((int)$inst['owner_user_id'] === (int)($u['user_id'] ?? 0) && $inst['owner_type'] === ($u['type'] ?? 'sub')) {
            return true;
        }
        // 学校管理员可访问本校实例
        if (($u['type'] ?? '') === 'sub' && $u['role'] === 'admin' && (int)$inst['school_id'] === (int)$u['school_id']) {
            return true;
        }
        // 共享给当前用户
        $share = DB::one(
            "SELECT 1 FROM instance_shares WHERE instance_id = ? AND target_user_id = ? AND target_type = ?",
            [$instanceId, $u['user_id'] ?? 0, $u['type'] ?? 'sub']
        );
        return !!$share;
    }

    /** 校验当前用户对实例的写权限 */
    public static function canWriteInstance($instanceId)
    {
        if (!self::canAccessInstance($instanceId)) return false;
        $u = self::user();
        // 实例子用户默认只读，需主用户授权（这里简化：实例子用户有写权限，前端模态确认权限范围）
        return true;
    }
}
