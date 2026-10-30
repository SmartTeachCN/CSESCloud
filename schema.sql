-- CSES Cloud 数据库结构

-- 学校
CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    admin_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    address TEXT,
    contact TEXT,
    created_at TEXT NOT NULL
);

-- 用户（子用户：管理员 / 教师 / 学生）
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    permissions TEXT,
    is_super_admin INTEGER NOT NULL DEFAULT 0,   -- 最高管理员（0/1），可禁用临时管理员模式
    created_at TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    UNIQUE (school_id, username)
);

-- 班级
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    head_teacher TEXT,
    student_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- 学生
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    student_no TEXT NOT NULL,
    gender TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- 服务（校园已开通的服务）
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    version TEXT,
    endpoint TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- 实例（配置实例 / 实例云应用）
-- V3：实例用于承载“配置文件分发”等云应用，不再提供动态设备云控
CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    name TEXT NOT NULL,                         -- 实例标识（对外可见，静态集控的实例 ID）
    service_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'stopped',
    cpu TEXT,
    memory TEXT,
    disk TEXT,
    uptime TEXT,
    ip TEXT,
    app_id INTEGER,                             -- 关联的应用（实例侧应用模板）
    app_key TEXT,                               -- 应用唯一标识（如 cses_static_control）
    owner_user_id INTEGER,                      -- 实例所有者用户 ID
    owner_type TEXT NOT NULL DEFAULT 'sub',      -- 所有者类型：sub / alliance
    owner_key TEXT NOT NULL DEFAULT '',          -- 所有者键（用于隔离数据）
    instance_uid TEXT,                          -- 实例唯一 ID（外部可见）
    group_id INTEGER,                           -- 所属实例分组
    source_file_id INTEGER,                     -- 轻编辑器源文件（web_hosting_files.id）
    config TEXT,                                -- 实例配置（JSON）
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_instances_owner ON instances(owner_key);
CREATE INDEX IF NOT EXISTS idx_instances_school ON instances(school_id);
CREATE INDEX IF NOT EXISTS idx_instances_group ON instances(group_id);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL DEFAULT 0,
    username TEXT,
    action TEXT NOT NULL,
    target TEXT,
    ip TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    created_at TEXT NOT NULL
);

-- 通知
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL DEFAULT 0,
    sender_id INTEGER,                          -- 发送者用户 ID（0 = 系统）
    sender_name TEXT,                           -- 发送者名称
    type TEXT NOT NULL DEFAULT 'system',        -- system / info / warning / success
    title TEXT NOT NULL,
    content TEXT,
    target_type TEXT NOT NULL DEFAULT 'all',    -- all / role / class / user / share_invite / share_accepted / share_rejected
    target_id TEXT,                             -- 目标 ID（role 值时存角色名如 'admin'，class 时存班级 ID，user 时存用户 ID）
    share_id INTEGER DEFAULT NULL,              -- 关联的分享 ID（share_items.id）
    created_at TEXT NOT NULL
);

-- 通知已读状态（每用户）
CREATE TABLE IF NOT EXISTS notification_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    read_at TEXT,
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    UNIQUE (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notif_reads_user ON notification_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_reads_notif ON notification_reads(notification_id);

-- 数据导出记录
CREATE TABLE IF NOT EXISTS data_exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    user_id INTEGER,
    type TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'csv',
    status TEXT NOT NULL DEFAULT 'completed',
    file_path TEXT,
    created_at TEXT NOT NULL
);

-- ===== 开发者中心：实例侧应用（云服务应用模板） =====
-- 实例侧开发者创建的应用，作为实例的模板
CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_username TEXT NOT NULL,           -- 智教联盟用户名
    app_key TEXT NOT NULL UNIQUE,               -- 应用唯一标识（自动生成）
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT,
    category TEXT NOT NULL DEFAULT '通用',       -- 教学服务/评测服务/AI服务/通用服务
    status TEXT NOT NULL DEFAULT 'draft',       -- draft/published/archived
    is_shared INTEGER NOT NULL DEFAULT 0,       -- 是否共享到共享市场（0/1）
    is_official INTEGER NOT NULL DEFAULT 0,    -- 是否为官方项目（0/1），仅管理员可设置
    forked_from INTEGER,                        -- 派生自哪个 app id（共享市场 fork 时填）
    forked_by TEXT,                             -- 派生此应用的开发者
    app_info_manifest TEXT,                     -- JSON：应用信息清单
    editor_html TEXT,                           -- 编辑器 HTML（与客户端/存储通信）
    editor_js TEXT,                             -- 编辑器 JS（与客户端/存储通信）
    storage_manifest TEXT,                      -- JSON：实例存储清单（数据存储格式）
    interface_schema TEXT,                      -- JSON：数据接口JSON格式
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ===== 云文件（轻编辑器 + 实例存储）- 文件ID与实例ID分离，便于备份 =====
-- directory 字段用于区分存储区域：
--   '/' 或 '/.cloud/'             → 轻编辑器云文件
--   '/instances/{uid}/'           → 实例配置文件
--   '/instances/{uid}/php/'       → 实例 PHP 后端
CREATE TABLE IF NOT EXISTS cloud_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER,                        -- 关联实例（轻编辑器文件可为 NULL）
    school_id INTEGER NOT NULL,
    directory TEXT NOT NULL DEFAULT '/',        -- 虚拟目录路径
    name TEXT NOT NULL,
    content TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,       -- 内容大小（字节），便于统计
    file_type TEXT NOT NULL DEFAULT 'html',     -- html/js/css/json/md/yml 等文本类型
    file_category TEXT NOT NULL DEFAULT 'editor', -- editor / instance_config / instance_php / instance_asset
    status TEXT NOT NULL DEFAULT 'synced',      -- synced/syncing/error
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cloud_files_instance ON cloud_files(instance_id);

-- ===== 实例存储数据（按存储清单格式存储的实例数据） =====
CREATE TABLE IF NOT EXISTS instance_storage_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    collection_key TEXT NOT NULL,               -- 存储清单中的 collection key
    record_id TEXT NOT NULL,                    -- 记录唯一ID
    data TEXT,                                  -- JSON：记录数据
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_instances_school ON instances(school_id);
CREATE INDEX IF NOT EXISTS idx_services_school ON services(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_notif_school ON notifications(school_id);
CREATE INDEX IF NOT EXISTS idx_apps_developer ON apps(developer_username);
CREATE INDEX IF NOT EXISTS idx_cloud_files_instance ON cloud_files(instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_storage_instance ON instance_storage_data(instance_id);

-- ===== 实例组（按所有者维度分类；V3 起用于“配置实例组”） =====
CREATE TABLE IF NOT EXISTS instance_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    owner_type TEXT NOT NULL DEFAULT 'sub',
    owner_key TEXT NOT NULL,
    name TEXT NOT NULL,
    dir_id TEXT,                                -- 对外公开的实例组标识（静态集控 URL 使用）
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_instance_groups_owner ON instance_groups(owner_key);

-- ===== 实例共享关系 =====
CREATE TABLE IF NOT EXISTS instance_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    shared_by_user_id INTEGER NOT NULL,
    shared_by_type TEXT NOT NULL DEFAULT 'sub',
    target_user_id INTEGER,
    target_type TEXT NOT NULL DEFAULT 'sub',
    share_mode TEXT NOT NULL DEFAULT 'view',
    share_token TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_instance_shares_instance ON instance_shares(instance_id);
CREATE INDEX IF NOT EXISTS idx_instance_shares_target ON instance_shares(target_user_id);

-- ===== 加入学校申请 =====
CREATE TABLE IF NOT EXISTS school_join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    applicant_username TEXT NOT NULL,
    applicant_display_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_id INTEGER,
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_join_requests_school ON school_join_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_applicant ON school_join_requests(applicant_username);

-- ===== 智教联盟 ↔ 子用户 绑定关系 =====
CREATE TABLE IF NOT EXISTS alliance_account_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alliance_username TEXT NOT NULL,
    sub_user_id INTEGER NOT NULL,
    school_id INTEGER NOT NULL,
    alias TEXT,
    permissions TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (alliance_username, sub_user_id),
    FOREIGN KEY (sub_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alliance_bindings_user ON alliance_account_bindings(alliance_username);

-- ===== 登录页"保留在列表中"的登录条目 =====
CREATE TABLE IF NOT EXISTS saved_login_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL,
    display_label TEXT NOT NULL,
    school_id INTEGER,
    instance_uid TEXT,
    sub_username TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ===== AI 助理会话 =====
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_ref INTEGER,
    title TEXT,
    -- V4：会话置顶、自动标题标记、最近使用的模型/推理等级
    pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at TEXT,
    title_generated INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    reasoning TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_owner ON ai_chat_sessions(owner_key);

-- ===== AI 助理消息 =====
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    -- V4：结构化展示块（思考过程 / 工具调用 / 提问卡）JSON
    meta TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_chat_messages(session_id);

-- ===== AI 助理待续跑（客户端工具 / 用户提问的 ReAct 断点） =====
CREATE TABLE IF NOT EXISTS ai_pending_runs (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    session_id INTEGER NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_pending_runs_owner ON ai_pending_runs(owner_key);

-- ===== 编辑器插件注册表 =====
-- 开发者注册文件后缀与自定义编辑器，轻编辑器根据后缀自动调用对应插件
CREATE TABLE IF NOT EXISTS editor_plugins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_username TEXT NOT NULL,           -- 开发者用户名
    plugin_key TEXT NOT NULL UNIQUE,            -- 插件唯一标识
    name TEXT NOT NULL,                         -- 插件名称
    version TEXT NOT NULL DEFAULT '1.0.0',      -- 版本号
    description TEXT,                           -- 插件描述
    extensions TEXT NOT NULL,                   -- 注册的文件后缀（JSON数组，如 ["yml","json"]）
    editor_html TEXT NOT NULL,                  -- 编辑器 HTML 模板
    editor_js TEXT NOT NULL,                    -- 编辑器 JS 逻辑
    editor_css TEXT,                            -- 编辑器 CSS 样式
    icon TEXT DEFAULT 'ri-plug-line',           -- 插件图标
    status TEXT NOT NULL DEFAULT 'draft',       -- draft / published / archived
    is_official INTEGER NOT NULL DEFAULT 0,     -- 是否为官方插件（0/1）
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_editor_plugins_developer ON editor_plugins(developer_username);
CREATE INDEX IF NOT EXISTS idx_editor_plugins_extensions ON editor_plugins(extensions);

-- ===== 班级主页（网页托管） =====
-- 用户网页空间（每个智教联盟用户一个空间）
CREATE TABLE IF NOT EXISTS web_hosting_spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alliance_username TEXT NOT NULL,           -- 智教联盟用户名（空间所有者）
    slug TEXT NOT NULL,                        -- URL 路径别名（/site/{slug} 访问）
    title TEXT,                                -- 站点标题
    description TEXT,                          -- 站点描述
    storage_quota INTEGER NOT NULL DEFAULT 104857600,  -- 存储配额（字节，默认 100MB）
    is_enabled INTEGER NOT NULL DEFAULT 1,     -- 是否启用（用户自控）
    is_web_space INTEGER DEFAULT 0,            -- 是否为网页空间（1=网页空间, 0/NULL=数据空间）
    review_status TEXT NOT NULL DEFAULT 'published',  -- 审查状态：published / pending_review
    disabled_by_admin INTEGER NOT NULL DEFAULT 0,      -- 是否被管理员禁用（0/1）
    disabled_reason TEXT,                               -- 管理员禁用原因
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (alliance_username, slug)
);
CREATE INDEX IF NOT EXISTS idx_web_hosting_spaces_user ON web_hosting_spaces(alliance_username);
CREATE INDEX IF NOT EXISTS idx_web_hosting_spaces_slug ON web_hosting_spaces(slug);

-- 托管文件表
CREATE TABLE IF NOT EXISTS web_hosting_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,                   -- 文件相对路径（以 / 开头，如 /index.html）
    file_size INTEGER NOT NULL DEFAULT 0,      -- 文件大小（字节）
    content_type TEXT,                         -- MIME 类型
    content BLOB,                              -- 文件内容（存储为 BLOB，最新版本）
    published_content BLOB,                    -- 已公开版本内容（管理员审查通过后同步）
    published_size INTEGER NOT NULL DEFAULT 0, -- 已公开版本大小
    review_status TEXT NOT NULL DEFAULT 'published',  -- 审查状态：published / pending_review
    is_directory INTEGER NOT NULL DEFAULT 0,   -- 是否为目录
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (space_id) REFERENCES web_hosting_spaces(id) ON DELETE CASCADE,
    UNIQUE (space_id, file_path)
);
CREATE INDEX IF NOT EXISTS idx_web_hosting_files_space ON web_hosting_files(space_id);
CREATE INDEX IF NOT EXISTS idx_web_hosting_files_path ON web_hosting_files(file_path);

-- ===== 统一分享系统 =====
-- 分享主表：记录分享的元数据（资源类型、分享者、有效期）
CREATE TABLE IF NOT EXISTS share_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key TEXT NOT NULL,                    -- 分享者的 owner_key
    owner_username TEXT NOT NULL,               -- 分享者用户名
    resource_type TEXT NOT NULL,                -- 'cloud_file' / 'instance'
    resource_id INTEGER NOT NULL,               -- 资源 ID（cloud_files.id 或 instances.id）
    resource_name TEXT NOT NULL,                -- 资源显示名称
    share_type TEXT NOT NULL DEFAULT 'user',    -- 'user'（按用户分享）/ 'link'（预览链接）
    permission TEXT NOT NULL DEFAULT 'view',    -- 'view' 或 'edit'
    expires_at TEXT NOT NULL,                   -- 过期时间
    is_deleted INTEGER NOT NULL DEFAULT 0,      -- 软删除标记
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_items_owner ON share_items(owner_key);
CREATE INDEX IF NOT EXISTS idx_share_items_resource ON share_items(resource_type, resource_id);

-- 分享用户权限表：记录每个被分享用户的独立权限
CREATE TABLE IF NOT EXISTS share_user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    target_user_id INTEGER,                     -- 目标用户 ID（可为 NULL 表示链接分享）
    target_username TEXT,                       -- 目标用户名
    permission TEXT NOT NULL DEFAULT 'view',    -- 'view' 或 'edit'
    status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' / 'accepted' / 'rejected'
    accepted_at TEXT,                           -- 接受时间
    created_at TEXT NOT NULL,
    FOREIGN KEY (share_id) REFERENCES share_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_share_user_perms_share ON share_user_permissions(share_id);
CREATE INDEX IF NOT EXISTS idx_share_user_perms_user ON share_user_permissions(target_user_id);

-- 预览链接表：记录分享的预览链接
CREATE TABLE IF NOT EXISTS share_preview_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,                 -- 预览链接唯一 token
    is_enabled INTEGER NOT NULL DEFAULT 1,      -- 是否启用预览链接
    created_at TEXT NOT NULL,
    FOREIGN KEY (share_id) REFERENCES share_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_share_preview_links_token ON share_preview_links(token);
CREATE INDEX IF NOT EXISTS idx_share_preview_links_share ON share_preview_links(share_id);

-- ===== 文件分享黑名单（按文件维度，阻止被拉黑用户通过链接/直邀重新获得权限） =====
CREATE TABLE IF NOT EXISTS share_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_type TEXT NOT NULL DEFAULT 'cloud_file',
    resource_id INTEGER NOT NULL,
    owner_key TEXT NOT NULL,
    target_username TEXT NOT NULL,
    target_user_id INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (resource_type, resource_id, target_username)
);
CREATE INDEX IF NOT EXISTS idx_share_blacklist_resource ON share_blacklist(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_share_blacklist_username ON share_blacklist(target_username);

-- 保留旧 share_links 表（兼容过渡）
CREATE TABLE IF NOT EXISTS share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  file_id INTEGER,
  file_name TEXT NOT NULL,
  file_content TEXT,
  created_by TEXT NOT NULL,
  permission TEXT DEFAULT 'all',
  allow_guests INTEGER DEFAULT 0,
  expiry_days INTEGER DEFAULT 7,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_created_by ON share_links(created_by);

-- 操作记录表
CREATE TABLE IF NOT EXISTS cloud_file_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  content_snapshot TEXT,
  step INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_file_history_file_id ON cloud_file_history(file_id);
CREATE INDEX IF NOT EXISTS idx_cloud_file_history_created_by ON cloud_file_history(created_by);

-- 版本历史表
CREATE TABLE IF NOT EXISTS cloud_file_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  content TEXT,
  version_label TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_file_versions_file_id ON cloud_file_versions(file_id);
CREATE INDEX IF NOT EXISTS idx_cloud_file_versions_created_by ON cloud_file_versions(created_by);

-- 操作日志表（记录每一步操作）
CREATE TABLE IF NOT EXISTS cloud_operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  file_name TEXT,
  action_type TEXT NOT NULL DEFAULT 'edit',
  action_label TEXT,
  content_snapshot TEXT,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_operation_logs_file ON cloud_operation_logs(file_id);
CREATE INDEX IF NOT EXISTS idx_cloud_operation_logs_created_by ON cloud_operation_logs(created_by);

-- 工作区配置表
CREATE TABLE IF NOT EXISTS workspace_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (username, workspace_key)
);
CREATE INDEX IF NOT EXISTS idx_workspace_configs_user ON workspace_configs(username);

-- ===== 帮助中心文档 =====
-- parent_id = 0 表示一级目录（分类），否则为所属一级目录 ID（二级文章）
CREATE TABLE IF NOT EXISTS help_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    content TEXT,                               -- Markdown 内容（仅二级文章使用）
    summary TEXT,                               -- 一级目录简介
    icon TEXT DEFAULT 'ri-article-line',        -- 一级目录图标（RemixIcon 图标名）
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_help_content_parent ON help_content(parent_id);
