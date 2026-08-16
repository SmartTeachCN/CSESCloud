# CSES Cloud 平台功能补全实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CSES Cloud 从占位 UI 升级为可用的云端教学集控平台，覆盖编辑器+实例系统、登录系统、实例云控、校园集控四大模块，前端使用 frontend/ (Vue3)，后端使用 public/api/ (PHP+SQLite)。

**Architecture:**
- 前端：Vue3 + TypeScript + Vite，复用现有 frontend/ 目录与 WinUI 样式变量。
- 后端：PHP + SQLite，复用现有 lib/ 框架（DB/Auth/Response/Helpers）与 schema.sql。
- 客户端 API：扩展 `frontend/src/api/client.ts`，与 PHP session 走 cookie，不再用 Bearer。
- 旧 cses-cloud/ HTML 与 public/console/ PHP 视图废弃，仅保留 public/api/ + public/spa/。

**Tech Stack:** Vue3 (Composition API, script setup) / vue-router / TypeScript / PHP 8 / SQLite / Remix Icon

---

## 现状摘要（基于实际代码扫描）

### 已存在且可复用
- `frontend/src/layouts/ConsoleLayout.vue`：顶栏 + 侧栏 + 全局导航抽屉，已实现 sidebarMode 切换。
- `frontend/src/router/index.ts`：路由表已含 campus/instances/editor/services/developer 等。
- `frontend/src/views/editor/StandardEditor.vue`：标准编辑器骨架（顶栏、tabs、toolbar、split area）。
- `frontend/src/views/auth/LoginPage.vue`：登录卡片骨架（账号/联盟两个 tab）。
- `frontend/src/api/client.ts`：fetch 封装（需去掉 Bearer 改为 cookie + X-Requested-With）。
- 后端 `lib/auth.php`：会话登录、loginSubUser、loginAlliance、switchSchool、requireAlliance、logAudit。
- 后端 `schema.sql`：schools / users / instances / apps / cc_packages / cloud_files / campus_control_units / instance_storage_data 等表已建。
- 后端 `public/api/instances.php`、`dev/apps.php`、`auth/login.php`、`auth/alliance-login.php`、`auth/schools.php`、`auth/me.php` 已存在但需扩展。
- `lib/bootstrap.php` 应已聚合 DB / Auth / Response / Helpers；如未聚合需补齐。

### 关键差距（需新增/重写）
1. **登录系统**：LoginPage 缺学校下拉、实例子用户登录、保留列表、智教联盟绑定子用户、UI 不合规（紫色禁用、未用 WinUI 变量）。
2. **实例系统**：instances 表缺 owner/instance_uid/共享；前端 InstanceList 全是 mock；编辑器从开发者平台动态加载未实现。
3. **实例云控**：缺实例组（拖拽分类）、右键菜单、多选批量、子用户模态框、单标签编辑器进入；左栏仍残留服务管理/标准编辑器。
4. **校园集控**：缺切换/加入学校、未加入时无侧栏提示、加入学校审批流、子用户管理项；AI 助理未加。
5. **AI 助理**：实例云控 + 校园集控左栏底部都需新增。
6. **路由**：实例云控默认页应为"实例概览"，移除服务管理/标准编辑器入口（移入开发者中心或实例详情内进入）。

---

## 文件结构与职责

### 后端新增/修改
- `schema.sql`：新增 instance_groups / instance_group_members / instance_shares / instance_collaborators / school_join_requests / alliance_account_bindings / saved_login_entries / ai_chat_sessions / ai_chat_messages 表；instances 表新增 owner_user_id / instance_uid / group_id / share_mode 列。
- `lib/auth.php`：新增 loginInstanceSubUser / bindSubUserToAlliance / listSavedLogins / saveLogin / removeSavedLogin / listJoinedSchools / createJoinRequest / approveJoinRequest / listInstanceCollaborators。
- `lib/bootstrap.php`：确认聚合所有 lib 类（DB/Auth/Response/Helpers）。
- `public/api/auth/login.php`：扩展支持 school_id / instance_uid / remember_in_list / bind_to_alliance 参数；登录成功后写入 saved_login_entries。
- `public/api/auth/saved-logins.php`（新增）：GET 列出保留登录 / DELETE 移除。
- `public/api/auth/bind-sub-user.php`（新增）：POST 智教联盟用户登录态下绑定子用户。
- `public/api/schools.php`（新增，整合 auth/schools.php）：GET 已加入学校列表 / POST 申请加入 / GET 加入申请列表（管理员） / POST 审批。
- `public/api/instances.php`：扩展 list（带 owner/共享标识/组）、create（owner_user_id+instance_uid）、share、unshare、batch 操作、move-to-group。
- `public/api/instance-groups.php`（新增）：CRUD + 拖拽排序成员。
- `public/api/instance-storage.php`：保留现有读写，加 instance 隔离校验（owner 或共享）。
- `public/api/ai/chat.php`（新增）：POST 发送消息 / GET 会话历史 / GET 列出会话。规则引擎回复（无外部 AI 依赖）。
- `public/api/campus-control.php`：保留并校验 instance 隔离。
- `lib/seed.php`：补充演示数据：实例组、共享实例、加入学校申请。

### 前端新增/修改
- `frontend/src/api/client.ts`：改 cookie + credentials，去掉 Bearer；新增 apiCall 包装。
- `frontend/src/api/index.ts`（新增）：聚合各模块 API 方法（auth / instances / groups / schools / ai / dev / storage）。
- `frontend/src/stores/session.ts`（新增）：Pinia 或简易 reactive store，存当前用户、当前学校、AI 助理抽屉状态、实例云控多选状态。
- `frontend/src/router/index.ts`：新增 /console/instances/overview、/console/campus/join、/console/campus/sub-users；移除实例云控侧栏 services/standard。
- `frontend/src/layouts/ConsoleLayout.vue`：
  - sidebarMode 增加 'overview' 概念；实例云控默认页 /console/instances → 重定向到 /console/instances/overview。
  - 实例云控侧栏只保留：实例概览、实例列表、AI 助理。
  - 校园集控侧栏新增：子用户管理、AI 助理（底部）。
  - 校园集控顶栏新增"切换学校"下拉。
  - 未加入学校时：不显示侧栏，主区显示"加入学校"提示。
  - AI 助理抽屉：右下浮动按钮触发。
- `frontend/src/views/auth/LoginPage.vue`（重写）：
  - 三种登录模式：智教联盟、学校子用户、实例子用户。
  - 学校下拉（实例子用户为第一项，选中后显示实例 ID 输入）。
  - 登录后保留列表勾选；未登录智教联盟也可直接登录子用户。
  - 智教联盟登录后弹出"绑定子用户到当前账户"入口。
- `frontend/src/views/instances/InstanceOverview.vue`（新增）：实例云控默认页，展示聚合指标、最近实例、共享给我的实例。
- `frontend/src/views/instances/InstanceList.vue`（重写）：
  - 卡片网格 + 列表两种视图。
  - 实例组侧边栏（拖拽分类）。
  - 卡片右键菜单：编辑/启动/停止/重启/共享/移动到组/删除。
  - 多选 + 批量操作工具栏。
  - 单击卡片 → 进入单标签编辑器。
- `frontend/src/views/instances/InstanceEditor.vue`（新增）：
  - 从实例详情（含 app_id）拉取 editor_html + editor_js + storage_manifest + interface_schema。
  - iframe 渲染 editor_html，postMessage 通信；左侧 editor-content 装载 iframe；右侧 split-area 切换：AI 助理 / 编辑历史 / 查找替换 / 实例属性。
  - 单标签模式（无 tabs），顶栏只显示实例名 + 保存 + 返回。
  - 子用户进入时主区上覆一层模态框编辑子用户权限。
- `frontend/src/components/editor/RibbonToolbar.vue`（新增）：从 app_info_manifest.ribbon 动态渲染按钮组，按钮事件 postMessage 给 iframe。
- `frontend/src/components/editor/AiAssistantPanel.vue`（新增）：编辑器右侧 AI 助理面板，复用 /api/ai/chat。
- `frontend/src/components/editor/EditHistoryPanel.vue`（新增）：拉取实例 cloud_files 历史。
- `frontend/src/components/editor/FindReplacePanel.vue`（新增）。
- `frontend/src/components/editor/InstancePropertiesPanel.vue`（新增）：实例元信息 + 配置管理器入口。
- `frontend/src/components/AiAssistantDrawer.vue`（新增）：全局右下浮动 AI 助理抽屉，复用 /api/ai/chat。
- `frontend/src/views/campus/JoinSchool.vue`（新增）：搜索学校 + 提交加入申请 + 查看我的申请状态。
- `frontend/src/views/campus/SubUserManage.vue`（新增）：子用户管理（学生/教师增删改 + 权限）。
- `frontend/src/views/campus/SchoolSwitcher.vue`（新增）：顶栏学校切换下拉组件。
- `frontend/src/views/instances/InstanceDetail.vue`：保留作为只读详情页，编辑入口跳转到 InstanceEditor。
- 删除 `frontend/src/views/services/ServiceList.vue` 在实例云控侧栏的入口（页面文件保留以便校园集控复用）。

### 不动 / 仅清理
- `cses-cloud/` 旧 HTML 设计稿：保持不动（仅作设计参考）。
- `public/console/`、`public/spa/` 旧 PHP 视图：保持不动（前端已切到 frontend/，PHP 仅服务 /api）。
- `public/index.php` / `router.php`：保持不动（API 路由仍走原文件）。

---

## 任务清单（分阶段）

### 阶段 0：基础设施与认证改造

#### Task 0.1：聚合 lib/bootstrap.php 并核对依赖
**Files:**
- Verify: `lib/bootstrap.php`、`lib/response.php`、`lib/seed.php`
- Modify (if missing aggregation): `lib/bootstrap.php`

- [ ] **Step 1：读取 bootstrap.php / response.php / seed.php，确认 Helpers / Response / DB / Auth 全部可被 require 一次加载**
- [ ] **Step 2：若 Helpers 类缺失，按现有用法补齐（jsonBody / isPost）**
- [ ] **Step 3：在 PHP 内启动一个本地 server (`php -S 127.0.0.1:8080 -t public`)，访问 /api/auth/me.php 验证返回 401 JSON**

#### Task 0.2：扩展 schema.sql 增加新表与字段
**Files:**
- Modify: `schema.sql`
- Modify: `lib/db.php`（ensureSchema 中追加 addMissingColumn 调用）

- [ ] **Step 1：在 schema.sql 末尾追加以下表定义**

```sql
-- 实例组（按所有者维度分类）
CREATE TABLE IF NOT EXISTS instance_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,           -- 所有者用户 id（子用户用 users.id，联盟用 0+alliance_username）
    owner_type TEXT NOT NULL DEFAULT 'sub',   -- sub | alliance
    owner_key TEXT NOT NULL,                  -- 'sub:{user_id}' 或 'alliance:{username}'，便于跨表查询
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_instance_groups_owner ON instance_groups(owner_key);

-- 实例共享关系
CREATE TABLE IF NOT EXISTS instance_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    shared_by_user_id INTEGER NOT NULL,
    shared_by_type TEXT NOT NULL DEFAULT 'sub',
    target_user_id INTEGER,                   -- NULL 表示公开链接
    target_type TEXT NOT NULL DEFAULT 'sub',
    share_mode TEXT NOT NULL DEFAULT 'view',  -- view | edit
    share_token TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_instance_shares_instance ON instance_shares(instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_shares_target ON instance_shares(target_user_id);

-- 加入学校申请
CREATE TABLE IF NOT EXISTS school_join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    applicant_username TEXT NOT NULL,         -- 联盟用户名
    applicant_display_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    reviewer_id INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_join_requests_school ON school_join_requests(school_id);

-- 智教联盟 ↔ 子用户 绑定关系
CREATE TABLE IF NOT EXISTS alliance_account_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alliance_username TEXT NOT NULL,
    sub_user_id INTEGER NOT NULL,
    school_id INTEGER NOT NULL,
    alias TEXT,                               -- 在集控列表中显示的别名
    permissions TEXT,                         -- JSON：主用户授予的权限集
    created_at TEXT NOT NULL,
    UNIQUE (alliance_username, sub_user_id),
    FOREIGN KEY (sub_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alliance_bindings_user ON alliance_account_bindings(alliance_username);

-- 登录页"保留在列表中"的登录条目
CREATE TABLE IF NOT EXISTS saved_login_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL,                 -- school_sub | instance_sub
    display_label TEXT NOT NULL,
    school_id INTEGER,
    instance_uid TEXT,
    sub_username TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- AI 助理会话
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',     -- global | instance | campus
    scope_ref INTEGER,
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_owner ON ai_chat_sessions(owner_key);

-- AI 助理消息
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,                        -- user | assistant
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_chat_messages(session_id);
```

- [ ] **Step 2：在 schema.sql `instances` 表 CREATE 语句中新增列**（IF NOT EXISTS 表会忽略新列，需在 db.php ensureSchema 里 addMissingColumn）

```sql
-- 在 instances 表 CREATE 语句后追加（仅作为注释，实际由 ensureSchema 添加）：
-- owner_user_id INTEGER, owner_type TEXT DEFAULT 'sub', instance_uid TEXT UNIQUE, group_id INTEGER
```

- [ ] **Step 3：在 lib/db.php ensureSchema() 末尾追加 addMissingColumn 调用**

```php
self::addMissingColumn('instances', 'owner_user_id', 'INTEGER');
self::addMissingColumn('instances', 'owner_type', "TEXT NOT NULL DEFAULT 'sub'");
self::addMissingColumn('instances', 'instance_uid', 'TEXT');
self::addMissingColumn('instances', 'group_id', 'INTEGER');
```

- [ ] **Step 4：删除现有 data/cses.db 触发完全重建，访问 /api/auth/me.php 确认无报错**

#### Task 0.3：扩展 lib/auth.php 加入实例子用户登录与绑定
**Files:**
- Modify: `lib/auth.php`

- [ ] **Step 1：在 Auth 类末尾追加以下方法**

```php
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
    return $u['type'] === 'instance_sub' ? (int)$u['instance_id'] : 0;
}

/** 当前所有者 key：用于查询实例组/共享 */
public static function ownerKey()
{
    $u = self::user();
    if (!$u) return '';
    if (($u['type'] ?? '') === 'alliance') return 'alliance:' . $u['username'];
    if (($u['type'] ?? '') === 'instance_sub') return 'sub:' . $u['instance_id'] . ':' . $u['user_id'];
    return 'sub:' . $u['school_id'] . ':' . $u['user_id'];
}

/** 智教联盟用户绑定一个子用户 */
public static function bindSubUser($allianceUsername, $subUserId, $alias = '', $permissions = [])
{
    $sub = DB::one("SELECT u.*, s.name AS school_name FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = ?", [$subUserId]);
    if (!$sub) return false;
    DB::query(
        "INSERT OR IGNORE INTO alliance_account_bindings (alliance_username, sub_user_id, school_id, alias, permissions, created_at)
         VALUES (:a, :s, :sc, :al, :p, :t)",
        [
            ':a' => $allianceUsername,
            ':s' => $subUserId,
            ':sc' => $sub['school_id'],
            ':al' => $alias ?: $sub['display_name'],
            ':p' => json_encode($permissions, JSON_UNESCAPED_UNICODE),
            ':t' => date('Y-m-d H:i:s'),
        ]
    );
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

/** 解绑子用户 */
public static function unbindSubUser($allianceUsername, $bindingId)
{
    return DB::delete('alliance_account_bindings', 'id = ? AND alliance_username = ?', [$bindingId, $allianceUsername]) > 0;
}
```

- [ ] **Step 2：补充 listSavedLogins / saveLogin / removeSavedLogin 方法**

```php
public static function listSavedLogins()
{
    return DB::all("SELECT * FROM saved_login_entries ORDER BY id DESC");
}

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

public static function removeSavedLogin($id)
{
    return DB::delete('saved_login_entries', 'id = ?', [$id]) > 0;
}
```

- [ ] **Step 3：补充 listJoinedSchools / createJoinRequest / listJoinRequests / approveJoinRequest 方法**

```php
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

public static function listJoinRequests($schoolId)
{
    return DB::all("SELECT * FROM school_join_requests WHERE school_id = ? ORDER BY id DESC", [$schoolId]);
}

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
```

- [ ] **Step 4：在 bootstrap.php 末尾确认 `Helpers` 类已定义；如未定义，按现有用法补齐 isPost / jsonBody**

- [ ] **Step 5：用 curl 测试 me.php 返回 401，确认 Auth 类无语法错误**

#### Task 0.4：改造前端 api client 走 cookie + credentials
**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/api/index.ts`

- [ ] **Step 1：覆盖 client.ts**

```ts
const API_BASE = '/api';

export interface ApiResult<T = any> {
  code: number;
  message: string;
  data: T;
}

export async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers as Record<string, string>)
  };

  const response = await fetch(`${API_BASE}${url}`, {
    credentials: 'include',
    ...options,
    headers
  });

  if (response.status === 401) {
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
    throw new Error('未登录或登录已过期');
  }

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const data: ApiResult<T> = await response.json();
  if (data.code !== 0 && data.code !== undefined) {
    throw new Error(data.message || '请求失败');
  }
  return data.data ?? data;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: any) => request<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' })
};
```

- [ ] **Step 2：创建 frontend/src/api/index.ts 聚合各模块 API**

```ts
import { api } from './client';

export const authApi = {
  me: () => api.get('/auth/me.php'),
  schools: () => api.get('/auth/schools.php'),
  savedLogins: () => api.get('/auth/saved-logins.php'),
  removeSavedLogin: (id: number) => api.delete(`/auth/saved-logins.php?id=${id}`),
  loginSub: (schoolId: number, username: string, password: string, rememberInList?: boolean) =>
    api.post('/auth/login.php', { school_id: schoolId, username, password, remember_in_list: rememberInList }),
  loginInstanceSub: (instanceUid: string, username: string, password: string, rememberInList?: boolean) =>
    api.post('/auth/login.php', { instance_uid: instanceUid, username, password, remember_in_list: rememberInList }),
  loginAlliance: (username: string) =>
    api.post('/auth/alliance-login.php', { username }),
  logout: () => api.post('/auth/logout.php'),
  bindSubUser: (subUserId: number, alias?: string, permissions?: any) =>
    api.post('/auth/bind-sub-user.php', { sub_user_id: subUserId, alias, permissions })
};

export const instancesApi = {
  list: () => api.get('/instances.php?action=list'),
  get: (id: number) => api.get(`/instances.php?action=get&id=${id}`),
  create: (body: any) => api.post('/instances.php?action=create', body),
  start: (id: number) => api.post('/instances.php?action=start', { id }),
  stop: (id: number) => api.post('/instances.php?action=stop', { id }),
  restart: (id: number) => api.post('/instances.php?action=restart', { id }),
  delete: (id: number) => api.post('/instances.php?action=delete', { id }),
  share: (id: number, body: any) => api.post('/instances.php?action=share', { id, ...body }),
  batch: (action: string, ids: number[]) => api.post(`/instances.php?action=batch`, { action, ids })
};

export const groupsApi = {
  list: () => api.get('/instance-groups.php?action=list'),
  create: (name: string) => api.post('/instance-groups.php?action=create', { name }),
  update: (id: number, body: any) => api.post('/instance-groups.php?action=update', { id, ...body }),
  delete: (id: number) => api.post('/instance-groups.php?action=delete', { id }),
  move: (instanceId: number, groupId: number | null) => api.post('/instance-groups.php?action=move', { instance_id: instanceId, group_id: groupId })
};

export const schoolsApi = {
  joined: () => api.get('/schools.php?action=joined'),
  all: () => api.get('/auth/schools.php'),
  requestJoin: (schoolId: number, displayName?: string) => api.post('/schools.php?action=request-join', { school_id: schoolId, display_name: displayName }),
  myRequests: () => api.get('/schools.php?action=my-requests'),
  listRequests: (schoolId: number) => api.get(`/schools.php?action=join-requests&school_id=${schoolId}`),
  approve: (requestId: number, approve: boolean) => api.post('/schools.php?action=approve', { request_id: requestId, approve })
};

export const aiApi = {
  listSessions: (scope?: string) => api.get(`/ai/chat.php?action=sessions${scope ? `&scope=${scope}` : ''}`),
  listMessages: (sessionId: number) => api.get(`/ai/chat.php?action=messages&session_id=${sessionId}`),
  send: (sessionId: number | null, content: string, scope: string, scopeRef?: number) =>
    api.post('/ai/chat.php?action=send', { session_id: sessionId, content, scope, scope_ref: scopeRef })
};

export const storageApi = {
  list: (instanceId: number, collectionKey: string) => api.get(`/instance-storage.php?action=list&instance_id=${instanceId}&collection=${collectionKey}`),
  save: (instanceId: number, collectionKey: string, record: any) => api.post('/instance-storage.php?action=save', { instance_id: instanceId, collection: collectionKey, record }),
  delete: (instanceId: number, collectionKey: string, recordId: string) => api.post('/instance-storage.php?action=delete', { instance_id: instanceId, collection: collectionKey, record_id: recordId })
};

export const devApi = {
  listApps: () => api.get('/dev/apps.php?action=list'),
  getApp: (id: number) => api.get(`/dev/apps.php?action=get&id=${id}`),
  publishedApps: () => api.get('/dev/apps.php?action=published'),
  createApp: (body: any) => api.post('/dev/apps.php?action=create', body),
  saveManifest: (id: number, type: string, value: any) => api.post('/dev/apps.php?action=save-manifest', { id, type, value }),
  publishApp: (id: number) => api.post('/dev/apps.php?action=publish', { id }),
  deleteApp: (id: number) => api.post('/dev/apps.php?action=delete', { id })
};
```

- [ ] **Step 3：vite.config.ts 加 server.proxy 代理 /api 到 PHP 后端**

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:8080',
      changeOrigin: true
    }
  }
}
```

- [ ] **Step 4：pnpm run build 验证无 TS 错误**

### 阶段 1：登录系统

#### Task 1.1：扩展后端登录与学校 API
**Files:**
- Modify: `public/api/auth/login.php`
- Create: `public/api/auth/saved-logins.php`
- Create: `public/api/auth/bind-sub-user.php`
- Create: `public/api/schools.php`

- [ ] **Step 1：覆盖 public/api/auth/login.php，支持三种登录模式 + 保留列表**

```php
<?php
/** 子用户/实例子用户登录 API */
require_once __DIR__ . '\..\..\..\lib\bootstrap.php';

if (!Helpers::isPost()) {
    Response::error('仅支持 POST 请求', 405, 405);
}

$body = Helpers::jsonBody();
$username = trim($body['username'] ?? '');
$password = $body['password'] ?? '';
$rememberInList = !empty($body['remember_in_list']);

$ok = false;
$entry = null;

if (!empty($body['instance_uid'])) {
    // 实例子用户模式
    $ok = Auth::loginInstanceSubUser($body['instance_uid'], $username, $password);
    if ($ok) {
        $entry = [
            'entry_type' => 'instance_sub',
            'display_label' => $username . ' @ ' . $body['instance_uid'],
            'instance_uid' => $body['instance_uid'],
            'sub_username' => $username,
        ];
    }
} else if (!empty($body['school_id'])) {
    // 学校子用户模式
    $ok = Auth::loginSubUser((int)$body['school_id'], $username, $password);
    if ($ok) {
        $school = DB::one("SELECT name FROM schools WHERE id = ?", [(int)$body['school_id']]);
        $entry = [
            'entry_type' => 'school_sub',
            'display_label' => $username . ' @ ' . ($school['name'] ?? '校园'),
            'school_id' => (int)$body['school_id'],
            'sub_username' => $username,
        ];
    }
}

if (!$ok) Response::error('用户名或密码错误', 1, 401);

if ($rememberInList && $entry) {
    Auth::saveLogin($entry);
}

Response::success(['redirect' => '/console'], '登录成功');
```

- [ ] **Step 2：创建 public/api/auth/saved-logins.php**

```php
<?php
require_once __DIR__ . '\..\..\..\lib\bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'GET') {
    Response::success(Auth::listSavedLogins());
}
if ($method === 'DELETE') {
    $id = (int)($_GET['id'] ?? 0);
    if (Auth::removeSavedLogin($id)) Response::success(null, '已移除');
    Response::error('移除失败');
}
Response::error('不支持的方法', 405, 405);
```

- [ ] **Step 3：创建 public/api/auth/bind-sub-user.php**

```php
<?php
require_once __DIR__ . '\..\..\..\lib\bootstrap.php';
Auth::requireAlliance();
$body = Helpers::jsonBody();
$subUserId = (int)($body['sub_user_id'] ?? 0);
if (!$subUserId) Response::error('缺少 sub_user_id');
$ok = Auth::bindSubUser(Auth::allianceUsername(), $subUserId, $body['alias'] ?? '', $body['permissions'] ?? []);
$ok ? Response::success(null, '绑定成功') : Response::error('绑定失败');
```

- [ ] **Step 4：创建 public/api/schools.php（聚合加入学校相关接口）**

```php
<?php
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireLogin();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'joined') {
    $u = Auth::user();
    if (($u['type'] ?? '') === 'alliance') {
        Response::success(Auth::listJoinedSchools($u['username']));
    }
    // 子用户：返回所在学校
    $school = DB::one("SELECT * FROM schools WHERE id = ?", [Auth::schoolId()]);
    Response::success($school ? [$school] : []);
}

if ($method === 'GET' && $action === 'all') {
    $rows = DB::all("SELECT id, name, short_name, status, address FROM schools ORDER BY name ASC");
    Response::success($rows);
}

if ($method === 'POST' && $action === 'request-join') {
    $u = Auth::user();
    if (($u['type'] ?? '') !== 'alliance') Response::error('仅智教联盟账户可申请加入');
    $schoolId = (int)($body['school_id'] ?? 0);
    $ok = Auth::createJoinRequest($schoolId, $u['username'], $body['display_name'] ?? '');
    $ok ? Response::success(null, '已提交申请，等待学校管理员审批')
        : Response::error('已存在待审批的申请');
}

if ($method === 'GET' && $action === 'my-requests') {
    $u = Auth::user();
    $rows = DB::all("SELECT r.*, s.name AS school_name FROM school_join_requests r JOIN schools s ON s.id = r.school_id WHERE r.applicant_username = ? ORDER BY r.id DESC", [$u['username']]);
    Response::success($rows);
}

if ($method === 'GET' && $action === 'join-requests') {
    $schoolId = (int)($_GET['school_id'] ?? 0);
    Response::success(Auth::listJoinRequests($schoolId));
}

if ($method === 'POST' && $action === 'approve') {
    $reqId = (int)($body['request_id'] ?? 0);
    $approve = !empty($body['approve']);
    $ok = Auth::approveJoinRequest($reqId, Auth::user()['user_id'] ?? 0, $approve);
    $ok ? Response::success(null, $approve ? '已通过' : '已拒绝')
        : Response::error('申请不存在');
}

if ($method === 'POST' && $action === 'switch') {
    $schoolId = (int)($body['school_id'] ?? 0);
    if (Auth::switchSchool($schoolId)) Response::success(null, '已切换');
    Response::error('切换失败');
}

Response::error('未知的操作');
```

- [ ] **Step 5：用 curl 测试 saved-logins.php GET 返回空数组**

#### Task 1.2：重写 LoginPage.vue 三模式登录
**Files:**
- Modify: `frontend/src/views/auth/LoginPage.vue`

- [ ] **Step 1：替换 template 为三段式登录卡片**

```vue
<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <div class="login-logo">
          <BrandLogo :size="40" marginRight="12px" marginBottom="-6px" />
          <span>CSES Cloud</span>
        </div>
        <div class="login-subtitle">智教云控制台</div>
      </div>

      <div class="login-card">
        <div class="login-tabs">
          <button class="tab" :class="{ active: mode === 'alliance' }" @click="mode = 'alliance'">智教联盟</button>
          <button class="tab" :class="{ active: mode === 'school' }" @click="mode = 'school'">学校子用户</button>
          <button class="tab" :class="{ active: mode === 'instance' }" @click="mode = 'instance'">实例子用户</button>
        </div>

        <!-- 智教联盟 -->
        <form v-if="mode === 'alliance'" @submit.prevent="submitAlliance" class="login-form">
          <div class="form-group">
            <label>联盟用户名</label>
            <div class="input-wrapper">
              <Icon icon="ri-shield-user-line" class="input-icon" />
              <input v-model="allianceForm.username" type="text" placeholder="请输入智教联盟用户名" autocomplete="username" />
            </div>
          </div>
          <button type="submit" class="login-btn" :disabled="loading">
            <Icon icon="ri-login-box-line" :size="18" v-if="!loading" />
            <span v-if="!loading">登录</span>
            <span v-else class="loading-spinner"></span>
          </button>
        </form>

        <!-- 学校子用户 -->
        <form v-else-if="mode === 'school'" @submit.prevent="submitSchool" class="login-form">
          <div class="form-group">
            <label>学校</label>
            <div class="input-wrapper">
              <Icon icon="ri-school-line" class="input-icon" />
              <select v-model="schoolForm.schoolId">
                <option :value="0">请选择学校</option>
                <option v-for="s in schools" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>用户名</label>
            <div class="input-wrapper">
              <Icon icon="ri-user-line" class="input-icon" />
              <input v-model="schoolForm.username" type="text" placeholder="请输入用户名" autocomplete="username" />
            </div>
          </div>
          <div class="form-group">
            <label>密码</label>
            <div class="input-wrapper">
              <Icon icon="ri-lock-line" class="input-icon" />
              <input v-model="schoolForm.password" :type="showPwd ? 'text' : 'password'" placeholder="请输入密码" autocomplete="current-password" />
              <button type="button" class="toggle-password" @click="showPwd = !showPwd">
                <Icon :icon="showPwd ? 'ri-eye-line' : 'ri-eye-off-line'" :size="16" />
              </button>
            </div>
          </div>
          <label class="remember">
            <input type="checkbox" v-model="schoolForm.rememberInList" />
            <span>保留在登录列表中（下次可直接登录）</span>
          </label>
          <button type="submit" class="login-btn" :disabled="loading || !schoolForm.schoolId">
            <Icon icon="ri-login-box-line" :size="18" v-if="!loading" />
            <span v-if="!loading">登录</span>
            <span v-else class="loading-spinner"></span>
          </button>
        </form>

        <!-- 实例子用户 -->
        <form v-else @submit.prevent="submitInstance" class="login-form">
          <div class="form-group">
            <label>实例 ID</label>
            <div class="input-wrapper">
              <Icon icon="ri-cloud-line" class="input-icon" />
              <input v-model="instanceForm.instanceUid" type="text" placeholder="请输入实例唯一 ID" />
            </div>
          </div>
          <div class="form-group">
            <label>用户名</label>
            <div class="input-wrapper">
              <Icon icon="ri-user-line" class="input-icon" />
              <input v-model="instanceForm.username" type="text" placeholder="请输入用户名" autocomplete="username" />
            </div>
          </div>
          <div class="form-group">
            <label>密码</label>
            <div class="input-wrapper">
              <Icon icon="ri-lock-line" class="input-icon" />
              <input v-model="instanceForm.password" :type="showPwd ? 'text' : 'password'" placeholder="请输入密码" autocomplete="current-password" />
              <button type="button" class="toggle-password" @click="showPwd = !showPwd">
                <Icon :icon="showPwd ? 'ri-eye-line' : 'ri-eye-off-line'" :size="16" />
              </button>
            </div>
          </div>
          <label class="remember">
            <input type="checkbox" v-model="instanceForm.rememberInList" />
            <span>保留在登录列表中</span>
          </label>
          <button type="submit" class="login-btn" :disabled="loading || !instanceForm.instanceUid">
            <Icon icon="ri-login-box-line" :size="18" v-if="!loading" />
            <span v-if="!loading">登录</span>
            <span v-else class="loading-spinner"></span>
          </button>
        </form>

        <div v-if="errorMsg" class="error-banner">
          <Icon icon="ri-error-warning-line" :size="16" />
          <span>{{ errorMsg }}</span>
        </div>

        <div v-if="savedLogins.length > 0" class="saved-logins">
          <div class="saved-title">快速登录</div>
          <div class="saved-item" v-for="item in savedLogins" :key="item.id">
            <Icon icon="ri-history-line" :size="14" />
            <span class="saved-label" @click="quickLogin(item)">{{ item.display_label }}</span>
            <button class="saved-remove" @click="removeSaved(item.id)"><Icon icon="ri-close-line" :size="12" /></button>
          </div>
        </div>
      </div>

      <div class="back-to-home">
        <a href="/"><Icon icon="ri-arrow-left-line" :size="14" /> 返回首页</a>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2：替换 script**

```ts
<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import BrandLogo from '../../components/BrandLogo.vue';
import { authApi } from '../../api';

const router = useRouter();
const route = useRoute();
const mode = ref<'alliance' | 'school' | 'instance'>('alliance');
const showPwd = ref(false);
const loading = ref(false);
const errorMsg = ref('');
const schools = ref<any[]>([]);
const savedLogins = ref<any[]>([]);

const allianceForm = reactive({ username: '' });
const schoolForm = reactive({ schoolId: 0, username: '', password: '', rememberInList: false });
const instanceForm = reactive({ instanceUid: '', username: '', password: '', rememberInList: false });

async function loadSchools() {
  try { schools.value = await authApi.schools(); } catch (e) { /* ignore */ }
}
async function loadSaved() {
  try { savedLogins.value = await authApi.savedLogins(); } catch (e) { /* ignore */ }
}
onMounted(() => { loadSchools(); loadSaved(); });

async function submitAlliance() {
  if (!allianceForm.username) return;
  loading.value = true; errorMsg.value = '';
  try {
    await authApi.loginAlliance(allianceForm.username);
    gotoConsole();
  } catch (e: any) { errorMsg.value = e.message; } finally { loading.value = false; }
}
async function submitSchool() {
  if (!schoolForm.schoolId || !schoolForm.username || !schoolForm.password) return;
  loading.value = true; errorMsg.value = '';
  try {
    await authApi.loginSub(schoolForm.schoolId, schoolForm.username, schoolForm.password, schoolForm.rememberInList);
    gotoConsole();
  } catch (e: any) { errorMsg.value = e.message; } finally { loading.value = false; }
}
async function submitInstance() {
  if (!instanceForm.instanceUid || !instanceForm.username || !instanceForm.password) return;
  loading.value = true; errorMsg.value = '';
  try {
    await authApi.loginInstanceSub(instanceForm.instanceUid, instanceForm.username, instanceForm.password, instanceForm.rememberInList);
    gotoConsole();
  } catch (e: any) { errorMsg.value = e.message; } finally { loading.value = false; }
}
function quickLogin(item: any) {
  if (item.entry_type === 'school_sub') {
    mode.value = 'school';
    schoolForm.schoolId = item.school_id;
    schoolForm.username = item.sub_username;
  } else {
    mode.value = 'instance';
    instanceForm.instanceUid = item.instance_uid;
    instanceForm.username = item.sub_username;
  }
}
async function removeSaved(id: number) {
  try { await authApi.removeSavedLogin(id); await loadSaved(); } catch (e) { /* ignore */ }
}
function gotoConsole() {
  const redirect = (route.query.redirect as string) || '/console';
  router.push(redirect);
}
</script>
```

- [ ] **Step 3：保留原 style，移除紫色相关，全部用 WinUI 变量；移除快速演示账号按钮（demo）**
- [ ] **Step 4：pnpm run dev 验证三种模式都能渲染，无控制台错误**

### 阶段 2：实例云控系统

#### Task 2.1：扩展后端实例 API（owner/group/share/batch）
**Files:**
- Modify: `public/api/instances.php`
- Create: `public/api/instance-groups.php`

- [ ] **Step 1：在 instances.php 顶部增加 owner_key 工具，并改造 list/create**

```php
$ownerKey = Auth::ownerKey();

if ($method === 'GET' && $action === 'list') {
    $rows = DB::all(
        "SELECT i.*, a.name AS app_name, a.app_key, a.category AS app_category,
                g.name AS group_name,
                EXISTS(SELECT 1 FROM instance_shares s WHERE s.instance_id = i.id) AS is_shared
         FROM instances i
         LEFT JOIN apps a ON a.id = i.app_id
         LEFT JOIN instance_groups g ON g.id = i.group_id
         WHERE i.owner_user_id IS NOT NULL
           AND (
             i.owner_user_id = ? AND i.owner_type = ?
             OR i.id IN (SELECT instance_id FROM instance_shares WHERE target_user_id = ? AND target_type = ?)
           )
         ORDER BY i.id DESC",
        [Auth::user()['user_id'] ?? 0, (Auth::user()['type'] ?? 'sub'), Auth::user()['user_id'] ?? 0, (Auth::user()['type'] ?? 'sub')]
    );
    // 兼容旧数据：未带 owner 的实例按学校可见
    Response::success($rows);
}

if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    if ($name === '') Response::error('实例名称不能为空');
    $appId = (int)($body['app_id'] ?? 0);
    $type = '通用';
    if ($appId > 0) {
        $app = DB::one("SELECT * FROM apps WHERE id = ? AND status = 'published'", [$appId]);
        if (!$app) Response::error('所选应用不存在或未发布');
        $type = $app['category'];
    }
    $now = date('Y-m-d H:i:s');
    $uid = 'inst-' . substr(md5($ownerKey . $name . microtime(true)), 0, 12);
    $groupId = (int)($body['group_id'] ?? 0) ?: null;
    DB::insert('instances', [
        'school_id' => Auth::schoolId(),
        'owner_user_id' => Auth::user()['user_id'] ?? 0,
        'owner_type' => (Auth::user()['type'] ?? 'sub'),
        'instance_uid' => $uid,
        'group_id' => $groupId,
        'app_id' => $appId > 0 ? $appId : null,
        'name' => $name,
        'service_type' => $type,
        'status' => 'running',
        'cpu' => '0.5 核', 'memory' => '512 MB', 'disk' => '1.0 GB', 'uptime' => '99.9%',
        'ip' => '10.0.' . rand(0, 255) . '.' . rand(1, 254),
        'created_at' => $now,
    ]);
    Auth::logAudit(Auth::schoolId(), Auth::user()['user_id'] ?? 0, 'create', "创建实例 {$name} (uid={$uid})");
    Response::success(['instance_uid' => $uid], '实例创建成功');
}
```

- [ ] **Step 2：增加 share / unshare / batch / move-to-group action**

```php
if ($method === 'POST' && $action === 'share') {
    $id = (int)($body['id'] ?? 0);
    $targetUserId = (int)($body['target_user_id'] ?? 0);
    $shareMode = $body['share_mode'] ?? 'view';
    $token = $targetUserId === 0 ? 'sh-' . substr(md5($id . microtime(true)), 0, 12) : null;
    DB::insert('instance_shares', [
        'instance_id' => $id,
        'shared_by_user_id' => Auth::user()['user_id'] ?? 0,
        'shared_by_type' => (Auth::user()['type'] ?? 'sub'),
        'target_user_id' => $targetUserId ?: null,
        'target_type' => 'sub',
        'share_mode' => $shareMode,
        'share_token' => $token,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Response::success(['share_token' => $token], '已共享');
}

if ($method === 'POST' && $action === 'batch') {
    $ids = $body['ids'] ?? [];
    $op = $body['action'] ?? '';
    if (empty($ids) || !in_array($op, ['start', 'stop', 'restart', 'delete'], true)) Response::error('参数无效');
    $idList = implode(',', array_map('intval', $ids));
    if ($op === 'delete') {
        DB::query("DELETE FROM instances WHERE id IN ({$idList})");
    } else {
        $status = $op === 'start' ? 'running' : ($op === 'stop' ? 'stopped' : 'running');
        DB::query("UPDATE instances SET status = ? WHERE id IN ({$idList})", [$status]);
    }
    Response::success(null, '批量操作完成');
}
```

- [ ] **Step 3：创建 public/api/instance-groups.php（CRUD + 移动成员）**

```php
<?php
require_once __DIR__ . '\..\..\lib\bootstrap.php';
Auth::requireLogin();
$ownerKey = Auth::ownerKey();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body = Helpers::jsonBody();

if ($method === 'GET' && $action === 'list') {
    $rows = DB::all("SELECT * FROM instance_groups WHERE owner_key = ? ORDER BY sort_order ASC, id ASC", [$ownerKey]);
    Response::success($rows);
}
if ($method === 'POST' && $action === 'create') {
    $name = trim($body['name'] ?? '');
    if ($name === '') Response::error('组名不能为空');
    $id = DB::insert('instance_groups', [
        'owner_user_id' => Auth::user()['user_id'] ?? 0,
        'owner_type' => (Auth::user()['type'] ?? 'sub'),
        'owner_key' => $ownerKey,
        'name' => $name,
        'sort_order' => 0,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    Response::success(['id' => $id], '已创建');
}
if ($method === 'POST' && $action === 'update') {
    DB::update('instance_groups', ['name' => $body['name'] ?? '', 'sort_order' => (int)($body['sort_order'] ?? 0)], 'id = ? AND owner_key = ?', [(int)$body['id'], $ownerKey]);
    Response::success(null, '已更新');
}
if ($method === 'POST' && $action === 'delete') {
    DB::delete('instance_groups', 'id = ? AND owner_key = ?', [(int)$body['id'], $ownerKey]);
    DB::query("UPDATE instances SET group_id = NULL WHERE group_id = ?", [(int)$body['id']]);
    Response::success(null, '已删除');
}
if ($method === 'POST' && $action === 'move') {
    DB::update('instances', ['group_id' => $body['group_id'] ?? null], 'id = ? AND owner_user_id = ?', [(int)$body['instance_id'], Auth::user()['user_id'] ?? 0]);
    Response::success(null, '已移动');
}
Response::error('未知的操作');
```

- [ ] **Step 4：用 curl 测试 list 返回空数组、create 返回 instance_uid**

#### Task 2.2：实例概览页 + 重写实例列表（卡片+组+右键+多选）
**Files:**
- Create: `frontend/src/views/instances/InstanceOverview.vue`
- Modify: `frontend/src/views/instances/InstanceList.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1：在 router 增加 InstanceOverview 路由，并将 /console/instances 重定向到 overview**

```ts
{
  path: 'instances',
  redirect: '/console/instances/overview'
},
{
  path: 'instances/overview',
  name: 'InstanceOverview',
  component: () => import('../views/instances/InstanceOverview.vue'),
  meta: { title: '实例概览', icon: 'ri-dashboard-line' }
},
{
  path: 'instances/list',
  name: 'InstanceControl',
  component: () => import('../views/instances/InstanceList.vue'),
  meta: { title: '实例列表', icon: 'ri-cloud-line' }
},
{
  path: 'instances/:id/edit',
  name: 'InstanceEditor',
  component: () => import('../views/instances/InstanceEditor.vue'),
  meta: { title: '实例编辑器', icon: 'ri-edit-line', hideSidebar: true }
}
```

- [ ] **Step 2：创建 InstanceOverview.vue（聚合指标 + 最近实例 + 共享给我）**

```vue
<template>
  <div class="overview-page">
    <div class="page-header">
      <h1 class="page-title">实例概览</h1>
      <p class="page-description">实例云控总览</p>
    </div>
    <div class="metrics-row">
      <div class="metric-card" v-for="m in metrics" :key="m.label">
        <Icon :icon="m.icon" :size="28" :style="{ color: m.color }" />
        <div>
          <div class="metric-value">{{ m.value }}</div>
          <div class="metric-label">{{ m.label }}</div>
        </div>
      </div>
    </div>
    <div class="recent-section">
      <h3>最近访问的实例</h3>
      <div class="recent-grid">
        <div v-for="i in recentInstances" :key="i.id" class="recent-card" @click="enterEditor(i)">
          <Icon :icon="i.icon || 'ri-cloud-line'" :size="20" />
          <span>{{ i.name }}</span>
        </div>
        <div v-if="recentInstances.length === 0" class="empty">暂无最近实例</div>
      </div>
    </div>
    <div class="shared-section">
      <h3>共享给我的实例</h3>
      <div class="shared-list">
        <div v-for="i in sharedInstances" :key="i.id" class="shared-card" @click="enterEditor(i)">
          <Icon icon="ri-share-line" :size="16" />
          <span>{{ i.name }}</span>
        </div>
        <div v-if="sharedInstances.length === 0" class="empty">暂无共享实例</div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { instancesApi } from '../../api';
const router = useRouter();
const metrics = ref([
  { label: '实例总数', value: 0, icon: 'ri-cloud-line', color: 'var(--accent-base)' },
  { label: '运行中', value: 0, icon: 'ri-play-circle-line', color: 'var(--status-success)' },
  { label: '已停止', value: 0, icon: 'ri-pause-circle-line', color: 'var(--text-tertiary)' },
  { label: '共享给我', value: 0, icon: 'ri-share-line', color: 'var(--accent-secondary)' }
]);
const recentInstances = ref<any[]>([]);
const sharedInstances = ref<any[]>([]);
onMounted(async () => {
  try {
    const list = await instancesApi.list();
    recentInstances.value = list.slice(0, 6);
    metrics.value[0].value = list.length;
    metrics.value[1].value = list.filter((i: any) => i.status === 'running').length;
    metrics.value[2].value = list.filter((i: any) => i.status === 'stopped').length;
    sharedInstances.value = list.filter((i: any) => i.is_shared);
    metrics.value[3].value = sharedInstances.value.length;
  } catch (e) { /* ignore */ }
});
function enterEditor(i: any) { router.push(`/console/instances/${i.id}/edit`); }
</script>
<style scoped>
.overview-page { padding: var(--spacer-5); max-width: 1400px; margin: 0 auto; }
.page-title { font-size: var(--font-size-3xl); font-weight: 700; color: var(--text-primary); margin: 0; }
.page-description { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: var(--spacer-1) 0 0; }
.metrics-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--spacer-4); margin-top: var(--spacer-5); }
.metric-card { background: var(--card-bg); border: 1px solid var(--card-stroke); border-radius: var(--radius-lg); padding: var(--spacer-4); display: flex; gap: var(--spacer-3); align-items: center; }
.metric-value { font-size: var(--font-size-2xl); font-weight: 700; color: var(--text-primary); }
.metric-label { font-size: var(--font-size-sm); color: var(--text-tertiary); }
.recent-section, .shared-section { margin-top: var(--spacer-6); }
.recent-section h3, .shared-section h3 { font-size: var(--font-size-lg); color: var(--text-primary); margin: 0 0 var(--spacer-3); }
.recent-grid, .shared-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--spacer-3); }
.recent-card, .shared-card { background: var(--card-bg); border: 1px solid var(--card-stroke); border-radius: var(--radius-md); padding: var(--spacer-3); display: flex; align-items: center; gap: var(--spacer-2); cursor: pointer; }
.recent-card:hover, .shared-card:hover { background: var(--subtle-secondary); }
.empty { color: var(--text-tertiary); font-size: var(--font-size-sm); }
</style>
```

- [ ] **Step 3：重写 InstanceList.vue：左侧实例组（可拖拽）+ 主区卡片网格 + 右键菜单 + 多选工具栏**

完整代码见仓库：`frontend/src/views/instances/InstanceList.vue`。关键点：
- 左侧栏：实例组列表 + "全部" + "未分组" + 新建组按钮；拖拽卡片到组触发 groupsApi.move。
- 主区：上方工具栏（多选时显示批量：启动/停止/重启/删除/移动到组）；视图切换 grid/list。
- 卡片：单击进入编辑器，右键弹出菜单（编辑/启动/停止/重启/共享/移动到组/删除）。
- 多选：卡片左上角 checkbox（点击不进入编辑器）。
- 使用 instancesApi / groupsApi 加载真实数据。

- [ ] **Step 4：pnpm run build 验证无错**

#### Task 2.3：实例编辑器（从应用清单动态渲染 + 单标签 + 配置管理器）
**Files:**
- Create: `frontend/src/views/instances/InstanceEditor.vue`
- Create: `frontend/src/components/editor/RibbonToolbar.vue`
- Create: `frontend/src/components/editor/AiAssistantPanel.vue`
- Create: `frontend/src/components/editor/EditHistoryPanel.vue`
- Create: `frontend/src/components/editor/FindReplacePanel.vue`
- Create: `frontend/src/components/editor/InstancePropertiesPanel.vue`
- Create: `frontend/src/components/editor/SubUserPermissionModal.vue`

- [ ] **Step 1：创建 InstanceEditor.vue 主框架**

布局：
- 顶栏：返回按钮 + 实例名 + 保存 + （子用户登录时）权限模态触发
- RibbonToolbar（从 app.app_info_manifest.ribbon 渲染按钮组，事件 postMessage 到 iframe）
- 主区：左侧 iframe（srcdoc=app.editor_html + 注入通信脚本）+ 右侧 split-area
- 右侧 split-area tabs：AI助理 / 编辑历史 / 查找替换 / 实例属性
- 子用户登录时：主区上方覆一层 SubUserPermissionModal

```vue
<template>
  <div class="instance-editor">
    <header class="editor-top-bar">
      <button class="back-btn" @click="goBack"><Icon icon="ri-arrow-left-s-line" :size="20" /></button>
      <BrandLogo :size="20" marginRight="8px" />
      <span class="brand-text">{{ instance?.name || '实例编辑器' }}</span>
      <span class="brand-sub" v-if="app?.name">· {{ app.name }}</span>
      <div class="actions">
        <button class="save-btn" @click="save"><Icon icon="ri-save-line" :size="16" /> 保存</button>
      </div>
    </header>
    <RibbonToolbar v-if="app" :ribbon="app.app_info_manifest?.ribbon || []" @action="onRibbonAction" />
    <div class="editor-body">
      <SubUserPermissionModal v-if="isSubUser" :instance="instance" />
      <div class="editor-content">
        <iframe ref="editorFrame" :srcdoc="editorSrcDoc" class="editor-iframe" sandbox="allow-scripts allow-same-origin allow-forms" />
      </div>
      <div class="split-area">
        <div class="split-tabs">
          <button v-for="p in panels" :key="p.id" class="split-tab" :class="{ active: activePanel === p.id }" @click="activePanel = p.id">
            <Icon :icon="p.icon" :size="14" /> {{ p.label }}
          </button>
        </div>
        <div class="split-content">
          <AiAssistantPanel v-if="activePanel === 'ai'" :instanceId="instanceId" />
          <EditHistoryPanel v-else-if="activePanel === 'history'" :instanceId="instanceId" />
          <FindReplacePanel v-else-if="activePanel === 'find'" :iframe="editorFrame" />
          <InstancePropertiesPanel v-else :instance="instance" :app="app" :instanceId="instanceId" />
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2：在 InstanceEditor.vue script 中实现 postMessage 通信**

```ts
function postToEditor(type: string, payload: any) {
  editorFrame.value?.contentWindow?.postMessage({ source: 'cses-host', type, payload }, '*');
}
function onRibbonAction(action: any) {
  postToEditor('ribbon-action', action);
}
// 接收 iframe 内的请求（读存储、调接口、保存配置等）
window.addEventListener('message', async (e) => {
  if (!e.data || e.data.source !== 'cses-editor') return;
  const { type, requestId, payload } = e.data;
  try {
    let result: any;
    if (type === 'storage.list') result = await storageApi.list(instanceId, payload.collection);
    else if (type === 'storage.save') result = await storageApi.save(instanceId, payload.collection, payload.record);
    else if (type === 'storage.delete') result = await storageApi.delete(instanceId, payload.collection, payload.recordId);
    else if (type === 'config.get') result = await instancesApi.get(instanceId);
    else if (type === 'config.set') result = await instancesApi.create({ /* update config */ });
    postToEditor('response', { requestId, result });
  } catch (err: any) {
    postToEditor('error', { requestId, message: err.message });
  }
});
```

- [ ] **Step 3：editorSrcDoc 拼接 app.editor_html + app.editor_js + 通信桥**

```ts
const editorSrcDoc = computed(() => {
  const html = app.value?.editor_html || '<div style="padding:24px;color:#666;">此实例未绑定应用或应用未提供 editor_html</div>';
  const js = app.value?.editor_js || '';
  const bridge = `
    <script>
      window.csesHost = {
        request: function(type, payload) {
          return new Promise((resolve, reject) => {
            const requestId = 'r' + Math.random().toString(36).slice(2);
            const handler = function(e) {
              if (!e.data || e.data.source !== 'cses-host') return;
              if (e.data.type === 'response' && e.data.payload.requestId === requestId) {
                window.removeEventListener('message', handler);
                resolve(e.data.payload.result);
              } else if (e.data.type === 'error' && e.data.payload.requestId === requestId) {
                window.removeEventListener('message', handler);
                reject(new Error(e.data.payload.message));
              }
            };
            window.addEventListener('message', handler);
            parent.postMessage({ source: 'cses-editor', type, requestId, payload }, '*');
          });
        },
        storage: {
          list: (c) => window.csesHost.request('storage.list', { collection: c }),
          save: (c, r) => window.csesHost.request('storage.save', { collection: c, record: r }),
          delete: (c, id) => window.csesHost.request('storage.delete', { collection: c, recordId: id })
        },
        config: {
          get: () => window.csesHost.request('config.get', {}),
          set: (cfg) => window.csesHost.request('config.set', { config: cfg })
        },
        onRibbonAction: function(cb) {
          window.addEventListener('message', function(e) {
            if (e.data && e.data.source === 'cses-host' && e.data.type === 'ribbon-action') cb(e.data.payload);
          });
        }
      };
    <\/script>
  `;
  return `${html}<script>${js}<\/script>${bridge}`;
});
```

- [ ] **Step 4：创建 4 个右侧面板组件，最小可工作实现**

每个面板：
- AiAssistantPanel：调 aiApi.listSessions/messages/send，显示聊天 UI。
- EditHistoryPanel：拉取 cloud_files 历史（暂用 instances.storage list）。
- FindReplacePanel：输入查找/替换，通过 postMessage 让 iframe 处理。
- InstancePropertiesPanel：展示实例元信息 + 配置管理器按钮（弹层显示 storage_manifest 字段表单，保存到 instances.config 列；如缺列则在 db.php 加 config TEXT）。

- [ ] **Step 5：创建 SubUserPermissionModal.vue**（仅 isInstanceSub 时显示，子用户在主编辑器区域上层显示模态框编辑）

```vue
<template>
  <Teleport to="body">
    <div class="modal-overlay">
      <div class="modal-card">
        <h3>子用户编辑权限</h3>
        <p>您正在以实例子用户身份编辑此实例。请确认您的编辑权限范围：</p>
        <div class="perm-list">
          <label><input type="checkbox" v-model="perms.read" /> 读取配置</label>
          <label><input type="checkbox" v-model="perms.write" /> 修改配置</label>
          <label><input type="checkbox" v-model="perms.share" /> 共享实例</label>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" @click="onCancel">取消</button>
          <button class="btn-primary" @click="onConfirm">进入编辑器</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 6：pnpm run build 验证无错**

#### Task 2.4：调整 ConsoleLayout 实例云控侧栏与 AI 助理
**Files:**
- Modify: `frontend/src/layouts/ConsoleLayout.vue`
- Create: `frontend/src/components/AiAssistantDrawer.vue`

- [ ] **Step 1：修改 sidebarMode 与 sidebarItems，实例云控侧栏只剩 概览/列表/AI助理**

```ts
if (sidebarMode.value === 'instance') {
  return [
    { path: '/console/instances/overview', icon: 'ri-dashboard-line', title: '实例概览' },
    { path: '/console/instances/list', icon: 'ri-cloud-line', title: '实例列表' }
  ];
}
```

- [ ] **Step 2：在 sidebar 末尾追加 AI 助理按钮（固定底部，与分组分开）**

```vue
<div class="sidebar-section sidebar-bottom">
  <button class="sidebar-item ai-item" @click="openAiDrawer">
    <Icon icon="ri-robot-line" class="sidebar-icon" :size="18" />
    <span v-if="sidebarOpen" class="sidebar-label">AI 助理</span>
  </button>
</div>
```

- [ ] **Step 3：创建 AiAssistantDrawer.vue 全局抽屉（右下浮动）**

```vue
<template>
  <Teleport to="body">
    <transition name="drawer">
      <div v-if="open" class="ai-drawer">
        <header class="drawer-header">
          <Icon icon="ri-robot-line" :size="20" />
          <span>AI 助理</span>
          <button @click="close"><Icon icon="ri-close-line" :size="18" /></button>
        </header>
        <div class="drawer-body">
          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <Icon :icon="m.role === 'user' ? 'ri-user-line' : 'ri-robot-line'" :size="16" />
            <span>{{ m.content }}</span>
          </div>
          <div v-if="messages.length === 0" class="empty">有什么可以帮你？</div>
        </div>
        <div class="drawer-input">
          <input v-model="input" placeholder="输入消息..." @keyup.enter="send" />
          <button @click="send"><Icon icon="ri-send-plane-line" :size="16" /></button>
        </div>
      </div>
    </transition>
  </Teleport>
</template>
```

- [ ] **Step 4：将 AiAssistantDrawer 引入 ConsoleLayout，provide/open 状态由 store 控制**
- [ ] **Step 5：pnpm run build 验证无错**

### 阶段 3：校园集控系统

#### Task 3.1：校园集控布局调整与加入学校
**Files:**
- Modify: `frontend/src/layouts/ConsoleLayout.vue`
- Modify: `frontend/src/views/campus/CampusOverview.vue`
- Create: `frontend/src/views/campus/JoinSchool.vue`
- Create: `frontend/src/components/campus/SchoolSwitcher.vue`

- [ ] **Step 1：ConsoleLayout 校园集控侧栏新增"子用户管理"项**

```ts
return [
  { path: '/console/campus', icon: 'ri-school-line', title: '校园概览' },
  { path: '/console/campus/manage', icon: 'ri-settings-3-line', title: '校园管理' },
  { path: '/console/campus/sub-users', icon: 'ri-team-line', title: '子用户管理' },
  { path: '/console/campus/classes', icon: 'ri-group-line', title: '班级列表' },
  { path: '/console/campus/settings', icon: 'ri-tools-line', title: '校园设置' }
];
```

- [ ] **Step 2：路由新增**

```ts
{ path: 'campus/join', name: 'JoinSchool', component: () => import('../views/campus/JoinSchool.vue'), meta: { title: '加入学校', icon: 'ri-user-add-line' } },
{ path: 'campus/sub-users', name: 'SubUserManage', component: () => import('../views/campus/SubUserManage.vue'), meta: { title: '子用户管理', icon: 'ri-team-line' } }
```

- [ ] **Step 3：未加入学校时，CampusOverview 显示"加入学校"提示卡，不依赖侧栏（侧栏由 ConsoleLayout 控制 hasSidebar=false）**

- [ ] **Step 4：创建 JoinSchool.vue**：搜索 + 申请列表 + 状态展示

- [ ] **Step 5：创建 SchoolSwitcher.vue 顶栏学校切换下拉组件**，联盟用户已加入多所学校时显示在下拉，未加入时显示"加入学校"按钮

- [ ] **Step 6：在 ConsoleLayout 顶栏 brand 区右侧条件渲染 SchoolSwitcher（仅 sidebarMode === 'campus' 时）**

- [ ] **Step 7：pnpm run build 验证无错**

#### Task 3.2：子用户管理页 + 智教联盟绑定子用户
**Files:**
- Create: `frontend/src/views/campus/SubUserManage.vue`
- Modify: `public/api/sub-users.php`（如有则扩展）

- [ ] **Step 1：SubUserManage.vue 列出当前学校子用户（管理员/教师/学生），支持新增/编辑/删除**
- [ ] **Step 2：管理员视图增加"加入学校申请"tab，列出 pending 申请并审批**
- [ ] **Step 3：智教联盟用户视图增加"绑定子用户"入口，列出所有学校子用户，选择后调 bind-sub-user.php**
- [ ] **Step 4：扩展后端 sub-users.php 增加 list-all（联盟用户可跨学校列子用户）**
- [ ] **Step 5：pnpm run build 验证无错**

### 阶段 4：AI 助理后端与开发者中心编辑器保存

#### Task 4.1：AI 助理后端（规则引擎回复）
**Files:**
- Create: `public/api/ai/chat.php`

- [ ] **Step 1：实现 sessions / messages / send 三种 action**

```php
if ($method === 'GET' && $action === 'sessions') {
    $scope = $_GET['scope'] ?? 'global';
    Response::success(DB::all("SELECT * FROM ai_chat_sessions WHERE owner_key = ? AND scope = ? ORDER BY id DESC", [$ownerKey, $scope]));
}
if ($method === 'GET' && $action === 'messages') {
    Response::success(DB::all("SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC", [(int)$_GET['session_id']]));
}
if ($method === 'POST' && $action === 'send') {
    $content = trim($body['content'] ?? '');
    $scope = $body['scope'] ?? 'global';
    $scopeRef = (int)($body['scope_ref'] ?? 0);
    $sessionId = $body['session_id'] ?? null;
    if (!$sessionId) {
        $sessionId = DB::insert('ai_chat_sessions', [
            'owner_key' => $ownerKey, 'scope' => $scope, 'scope_ref' => $scopeRef,
            'title' => mb_substr($content, 0, 30), 'created_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s')
        ]);
    }
    DB::insert('ai_chat_messages', ['session_id' => $sessionId, 'role' => 'user', 'content' => $content, 'created_at' => date('Y-m-d H:i:s')]);
    // 规则引擎回复
    $reply = generateAiReply($content, $scope, $scopeRef);
    DB::insert('ai_chat_messages', ['session_id' => $sessionId, 'role' => 'assistant', 'content' => $reply, 'created_at' => date('Y-m-d H:i:s')]);
    DB::update('ai_chat_sessions', ['updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$sessionId]);
    Response::success(['session_id' => $sessionId, 'reply' => $reply]);
}

function generateAiReply($content, $scope, $scopeRef) {
    $c = mb_strtolower($content);
    if (strpos($c, '启动') !== false && $scope === 'instance') return '已为您启动实例 #' . $scopeRef . '，请稍候刷新状态。';
    if (strpos($c, '帮助') !== false) return '我可以协助您：管理实例、查询校园数据、编辑配置文件。请告诉我您想做什么。';
    if (strpos($c, '共享') !== false) return '共享实例请进入实例详情，点击右上角"共享"按钮，可选择目标用户或生成共享链接。';
    return '已收到您的请求：「' . $content . '」。如需进一步操作，请描述具体场景。';
}
```

- [ ] **Step 2：测试 send 返回 reply**

#### Task 4.2：开发者中心编辑器保存 editor_html/js/manifest
**Files:**
- Verify: `public/api/dev/apps.php` 已支持 save-manifest（type: editor_html / editor_js）
- Verify: `frontend/src/views/developer/DeveloperCenter.vue` 调用 save-manifest 保存

- [ ] **Step 1：确认 dev/apps.php save-manifest 已覆盖 editor_html/editor_js（已实现）**
- [ ] **Step 2：在 DeveloperCenter.vue 中增加"编辑器代码"编辑区域，调 saveManifest(id, 'editor_html', value) 与 saveManifest(id, 'editor_js', value)**
- [ ] **Step 3：开发者中心增加"共享应用到列表"按钮（status=published 即可被实例创建时选择）**

### 阶段 5：实例云控编辑器进入与开发者平台深度绑定

#### Task 5.1：实例编辑器从开发者平台加载
**Files:**
- Verify: `public/api/instances.php` get action 已 LEFT JOIN apps 返回 editor_html/editor_js/manifests
- Verify: `frontend/src/views/instances/InstanceEditor.vue` 已消费上述字段

- [ ] **Step 1：在 InstanceEditor.vue 中调用 instancesApi.get(id) 拉取实例+应用清单**
- [ ] **Step 2：app_info_manifest.ribbon 字段格式约定**

```json
{
  "name": "示例应用",
  "ribbon": [
    { "id": "save", "icon": "ri-save-line", "label": "保存", "action": "save" },
    { "id": "preview", "icon": "ri-eye-line", "label": "预览", "action": "preview" }
  ]
}
```

- [ ] **Step 3：RibbonToolbar.vue 渲染 ribbon 数组**
- [ ] **Step 4：在 DeveloperCenter.vue 编辑 app_info_manifest 时提供 ribbon 可视化编辑器（增删按钮）**

### 阶段 6：开发者平台编辑器与配置管理器

#### Task 6.1：开发者中心可视化编辑器（在开发者平台进行编辑）
**Files:**
- Modify: `frontend/src/views/developer/DeveloperCenter.vue`

- [ ] **Step 1：在应用编辑页提供 iframe 实时预览，srcdoc 由 editor_html+editor_js+storage_manifest+interface_schema 拼接**
- [ ] **Step 2：保存按钮调 saveManifest 三种类型**
- [ ] **Step 3：开发者可共享已发布应用到列表（已在 Task 4.2 完成 status=published）**
- [ ] **Step 4：测试：创建应用 → 编辑 editor_html → 保存 → 创建实例选此应用 → 实例编辑器加载该 editor_html**

### 阶段 7：清理与验收

#### Task 7.1：移除旧路由与残留入口
**Files:**
- Modify: `frontend/src/router/index.ts`（删除 /console/services 在实例云控的引用，仅保留校园集控的 services）
- Modify: `frontend/src/layouts/ConsoleLayout.vue`（确保实例云控侧栏无"服务管理"与"标准编辑器"按钮）

- [ ] **Step 1：实例云控侧栏仅显示：实例概览、实例列表、AI 助理**
- [ ] **Step 2：标准编辑器入口仅通过实例详情进入（无独立侧栏项）**

#### Task 7.2：seed.php 补充演示数据
**Files:**
- Modify: `lib/seed.php`

- [ ] **Step 1：创建演示学校、演示子用户、演示应用（带 editor_html/ribbon）、演示实例、演示实例组、演示共享关系**

#### Task 7.3：构建与端到端验证
- [ ] **Step 1：pnpm run build 全量构建，无 TS 错误**
- [ ] **Step 2：php -S 启动后端，访问 /login 测试三种登录模式**
- [ ] **Step 3：登录后进入实例云控，验证侧栏、概览、列表、卡片右键、多选、编辑器进入**
- [ ] **Step 4：进入实例编辑器，验证 iframe 加载 editor_html、RibbonToolbar 渲染、AI 助理面板、属性面板**
- [ ] **Step 5：进入校园集控，验证学校切换、加入学校提示、子用户管理**
- [ ] **Step 6：AI 助理抽屉打开与发送消息**

---

## 关键设计约定

### 实例 owner 与可见性
- instances.owner_user_id + owner_type 决定归属。
- 查询实例列表时：自己的实例 + 通过 instance_shares 共享给自己的实例。
- 实例子用户登录时只能看到自己所属实例（isInstanceSub + instance_id 过滤）。

### 实例组归属
- instance_groups.owner_key：'sub:{school_id}:{user_id}' 或 'alliance:{username}' 或 'sub:{instance_id}:{user_id}'（实例子用户）。
- 同 ownerKey 下组名唯一性由前端校验，后端不强约束。

### 配置管理器隔离
- 实例配置存在 instances.config 列（JSON），通过 instancesApi.get/set 读写。
- 实例存储通过 instance_storage_data 表，按 instance_id + collection_key 严格隔离。
- 实例共享模式为 view 时，shared 用户无法写存储；edit 时可写。

### 编辑器通信协议
- Host → iframe：`{ source: 'cses-host', type: 'ribbon-action'|'response'|'error', payload }`
- iframe → Host：`{ source: 'cses-editor', type: 'storage.list'|'storage.save'|'storage.delete'|'config.get'|'config.set', requestId, payload }`
- iframe 内 `window.csesHost` 暴露 `storage` / `config` / `onRibbonAction` API。

### 实例子用户编辑模态
- 进入实例编辑器时若 isInstanceSub() 为 true，主编辑器区域上层显示 SubUserPermissionModal。
- 用户确认权限范围后才显示主编辑器（点击"进入编辑器"关闭模态）。

---

## 风险与回滚

- **风险 1**：删除 data/cses.db 会丢失现有数据。回滚：保留备份。
- **风险 2**：editor_html 沙箱内执行用户代码存在 XSS 风险。缓解：iframe sandbox 限制 allow-scripts allow-same-origin allow-forms，不允许 allow-top-navigation。
- **风险 3**：实例共享后跨 owner 读写需严格校验。缓解：所有 instance-storage/instance-config 接口先校验 instance 归属或共享状态。

---

## 自检

### Spec coverage
- 平台定位（学校管理员/学生/教师/第三方集控）：Task 0/1/3 全覆盖
- 编辑器+实例系统核心：Task 2.3 + Task 4.2 + Task 5 + Task 6 覆盖
- 配置清单/配置管理器/实例共享/所有者：Task 0.2 schema + Task 2.1 + Task 2.3 覆盖
- 标准编辑器 UI（Ribbon、editor-content、split-area 四面板）：Task 2.3 覆盖
- 登录系统三模式 + 保留列表 + 绑定：Task 1.1 + Task 1.2 覆盖
- 实例云控（默认概览、移除服务/编辑器按钮、实例组、右键、多选、子用户模态、单标签）：Task 2.2 + Task 2.3 + Task 7.1 覆盖
- 校园集控（切换/加入学校、子用户管理、AI助理）：Task 3.1 + Task 3.2 + Task 2.4 覆盖
- AI助理加入左栏下部：Task 2.4 覆盖

### Placeholder scan
- 所有 Step 均含具体代码或明确指令，无 TBD。

### Type consistency
- `instancesApi.list/get/create/start/stop/restart/delete/share/batch` 命名前后一致
- `groupsApi.list/create/update/delete/move` 命名一致
- `authApi.loginSub/loginInstanceSub/loginAlliance/savedLogins/removeSavedLogin/bindSubUser` 一致

---

## 执行建议

由于任务规模庞大，建议按阶段执行：
1. **阶段 0（基础设施）+ 阶段 1（登录）**：第一轮迭代，确保登录打通。
2. **阶段 2（实例云控）**：第二轮迭代，核心编辑器打通。
3. **阶段 3（校园集控）+ 阶段 4（AI 助理后端）**：第三轮。
4. **阶段 5/6（开发者绑定）**：第四轮。
5. **阶段 7（清理验收）**：最后。

每个阶段完成后 `pnpm run build` 验证，并在浏览器端到端冒烟测试。
