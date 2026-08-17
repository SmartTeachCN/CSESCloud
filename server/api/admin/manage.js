/**
 * 管理后台 API（1:1 转换自 api/admin/manage.php）
 * 仅临时管理员或最高管理员可访问
 *
 * 操作：
 *  - GET  action=users                    列出所有用户
 *  - GET  action=config                   获取服务器配置状态
 *  - POST action=set-super-admin          设置用户为最高管理员
 *  - POST action=set-role                 设置用户角色
 *  - POST action=toggle-temp-admin        启用/禁用临时管理员模式
 *  - POST action=reset-password           重置用户密码
 *  - GET  action=schools                  列出所有学校
 *  - POST action=create-notification      创建通知（系统管理员）
 *  - GET  action=ai-config                获取 AI 配置
 *  - POST action=save-ai-config           保存 AI 配置
 *  - GET  action=list-ai-models           列出系统 AI 模型
 *  - POST action=create-ai-model          创建系统 AI 模型
 *  - POST action=update-ai-model          更新系统 AI 模型
 *  - POST action=delete-ai-model          删除系统 AI 模型
 *  - GET  action=list-kb                  列出知识库条目
 *  - POST action=create-kb                创建知识库条目
 *  - POST action=update-kb                更新知识库条目
 *  - POST action=delete-kb                删除知识库条目
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { nowStr } = require('../../lib/response');

/**
 * 等价 PHP file_put_contents + var_export：将配置写回 server/lib/server-config.js
 * （Auth.serverConfig() 返回的是模块导出对象，写回后重启依然生效）
 */
function writeServerConfig(config) {
  const configPath = path.join(__dirname, '..', '..', 'lib', 'server-config.js');
  const exportStr = `/**
 * CSES Cloud - 服务器配置文件（由管理后台自动写回，等价 lib/server-config.php 的 var_export 导出）
 */
module.exports = ${JSON.stringify(config, null, 2)};
`;
  fs.writeFileSync(configPath, exportStr);
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();

  if (!Auth.isSuperAdmin()) {
    res.status(403);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code: 403, message: '仅最高管理员可访问', data: null }));
    throw new ctx.HttpSent();
  }

  const method = req.method;
  const action = query.action ?? '';

  // ===== 列出所有用户 =====
  if (method === 'GET' && action === 'users') {
    const users = Auth.listAllUsers();
    Response.success(users);
  }

  // ===== 获取服务器配置 =====
  if (method === 'GET' && action === 'config') {
    const config = Auth.serverConfig();
    const ta = config.temp_admin ?? {};
    Response.success({
      temp_admin_enabled: !Helpers.empty(ta.enabled),
      temp_admin_username: ta.username ?? '',
    });
  }

  // ===== 设置最高管理员 =====
  if (method === 'POST' && action === 'set-super-admin') {
    const userId = parseInt(body.user_id ?? 0, 10) || 0;
    const isSuper = !Helpers.empty(body.is_super_admin);
    if (!userId) Response.error('缺少用户 ID');
    const ok = Auth.setSuperAdmin(userId, isSuper);
    if (!ok) Response.error('操作失败');
    Auth.logAudit(0, 0, 'set_super_admin',
      (isSuper ? '授予' : '撤销') + `最高管理员: user_id=${userId}`,
      'success');
    Response.success({ ok: true });
  }

  // ===== 设置用户角色 =====
  if (method === 'POST' && action === 'set-role') {
    const userId = parseInt(body.user_id ?? 0, 10) || 0;
    const role = String(body.role ?? '').trim();
    if (!userId || Helpers.empty(role)) Response.error('缺少参数');
    const ok = Auth.setUserRole(userId, role);
    if (!ok) Response.error('操作失败');
    Auth.logAudit(0, 0, 'set_role',
      `设置角色: user_id=${userId} role=${role}`,
      'success');
    Response.success({ ok: true });
  }

  // ===== 启用/禁用临时管理员模式 =====
  if (method === 'POST' && action === 'toggle-temp-admin') {
    // 仅最高管理员（非临时管理员本身）可操作
    if (Auth.isTempAdmin()) {
      Response.error('临时管理员不能禁用自身模式');
    }
    const enabled = !Helpers.empty(body.enabled);
    const config = Auth.serverConfig();
    config.temp_admin.enabled = enabled;
    writeServerConfig(config);
    Auth.logAudit(0, 0, 'toggle_temp_admin',
      (enabled ? '启用' : '禁用') + '临时管理员模式',
      'success');
    Response.success({ ok: true, enabled: enabled });
  }

  // ===== 重置用户密码 =====
  if (method === 'POST' && action === 'reset-password') {
    const userId = parseInt(body.user_id ?? 0, 10) || 0;
    const newPassword = String(body.password ?? '').trim();
    if (!userId || Helpers.empty(newPassword)) Response.error('缺少参数');
    if (newPassword.length < 6) Response.error('密码至少 6 位');
    // PHP password_hash($pwd, PASSWORD_DEFAULT) = bcrypt（cost 10）
    const hash = bcrypt.hashSync(newPassword, 10);
    DB.update('users', { password_hash: hash }, 'id = ?', [userId]);
    Auth.logAudit(0, 0, 'reset_password',
      `重置密码: user_id=${userId}`,
      'success');
    Response.success({ ok: true });
  }

  // ===== 列出所有学校 =====
  if (method === 'GET' && action === 'schools') {
    const schools = DB.all('SELECT id, name, short_name, status FROM schools ORDER BY id ASC');
    Response.success(schools);
  }

  // ===== 创建通知（系统管理员） =====
  if (method === 'POST' && action === 'create-notification') {
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    let type = String(body.type ?? 'info').trim();
    let targetType = String(body.target_type ?? 'all').trim();
    const targetId = body.target_id ?? null;
    const schoolId = parseInt(body.school_id ?? 0, 10) || 0;

    if (Helpers.empty(title)) Response.error('通知标题不能为空');
    if (!['system', 'info', 'warning', 'success'].includes(type)) {
      type = 'info';
    }
    if (!['all', 'role', 'class', 'user'].includes(targetType)) {
      Response.error('无效的目标类型');
    }

    if (targetType === 'all' && !schoolId && schoolId !== 0) {
      Response.error('请选择目标学校');
    }
    // school_id = 0 表示全体人员（所有学校）

    const notifId = DB.insert('notifications', {
      school_id: schoolId,
      sender_id: 0,
      sender_name: '系统管理员',
      type: type,
      title: title,
      content: content,
      target_type: targetType,
      target_id: targetId !== null ? String(targetId) : null,
      created_at: nowStr(),
    });

    Auth.logAudit(schoolId, Auth.user()?.user_id ?? 0, 'admin_send_notification',
      `系统管理员发送通知: ${title} (target=${targetType}:${targetId})`,
      'success');

    Response.success({ id: notifId }, '通知已发送');
  }

  // ===== AI 配置 =====
  if (method === 'GET' && action === 'ai-config') {
    const config = Auth.serverConfig();
    const ai = config.ai ?? {};
    Response.success({
      default_model: ai.default_model ?? 'default',
    });
  }

  if (method === 'POST' && action === 'save-ai-config') {
    const defaultModel = String(body.default_model ?? 'default').trim();
    const config = Auth.serverConfig();
    config.ai = { default_model: defaultModel };
    writeServerConfig(config);
    Auth.logAudit(0, 0, 'save_ai_config', `设置默认 AI 模型: ${defaultModel}`, 'success');
    Response.success({ ok: true });
  }

  // ===== 系统 AI 模型管理 =====
  if (method === 'GET' && action === 'list-ai-models') {
    const models = DB.all("SELECT * FROM ai_models WHERE owner_key = 'system' ORDER BY id ASC");
    Response.success(models);
  }

  if (method === 'POST' && action === 'create-ai-model') {
    const name = String(body.name ?? '').trim();
    const provider = String(body.provider ?? '').trim();
    const modelId = String(body.model_id ?? '').trim();
    const endpoint = String(body.endpoint ?? '').trim();
    const apiKey = String(body.api_key ?? '').trim();
    if (Helpers.empty(name) || Helpers.empty(provider)) Response.error('模型名称和提供商不能为空');
    const id = DB.insert('ai_models', {
      owner_key: 'system',
      name: name,
      provider: provider,
      model_id: modelId,
      endpoint: endpoint,
      api_key: apiKey,
      is_enabled: 1,
      created_at: nowStr(),
      updated_at: nowStr(),
    });
    Auth.logAudit(0, 0, 'create_ai_model', `添加系统 AI 模型: ${name}`, 'success');
    Response.success({ id: id });
  }

  if (method === 'POST' && action === 'update-ai-model') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少模型 ID');
    const existing = DB.one("SELECT * FROM ai_models WHERE id = ? AND owner_key = 'system'", [id]);
    if (!existing) Response.error('模型不存在');
    const updates = {};
    for (const f of ['name', 'provider', 'model_id', 'endpoint', 'api_key']) {
      if (f in body) updates[f] = String(body[f]).trim();
    }
    if ('is_enabled' in body) updates.is_enabled = body.is_enabled ? 1 : 0; // PHP (int)bool 语义
    updates.updated_at = nowStr();
    DB.update('ai_models', updates, 'id = ?', [id]);
    Auth.logAudit(0, 0, 'update_ai_model', `更新系统 AI 模型: id=${id}`, 'success');
    Response.success({ ok: true });
  }

  if (method === 'POST' && action === 'delete-ai-model') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少模型 ID');
    DB.delete('ai_models', "id = ? AND owner_key = 'system'", [id]);
    Auth.logAudit(0, 0, 'delete_ai_model', `删除系统 AI 模型: id=${id}`, 'success');
    Response.success({ ok: true });
  }

  // ===== 知识库管理 =====
  if (method === 'GET' && action === 'list-kb') {
    const entries = DB.all('SELECT * FROM ai_knowledge_base ORDER BY id DESC LIMIT 100');
    Response.success(entries);
  }

  if (method === 'POST' && action === 'create-kb') {
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    const category = String(body.category ?? '').trim();
    if (Helpers.empty(title) || Helpers.empty(content)) Response.error('标题和内容不能为空');
    const now = nowStr();
    const id = DB.insert('ai_knowledge_base', {
      title: title,
      content: content,
      category: category,
      created_at: now,
      updated_at: now,
    });
    Auth.logAudit(0, 0, 'create_kb', `添加知识库条目: ${title}`, 'success');
    Response.success({ id: id });
  }

  if (method === 'POST' && action === 'update-kb') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少条目 ID');
    const existing = DB.one('SELECT * FROM ai_knowledge_base WHERE id = ?', [id]);
    if (!existing) Response.error('条目不存在');
    const updates = { updated_at: nowStr() };
    for (const f of ['title', 'content', 'category']) {
      if (f in body) updates[f] = String(body[f]).trim();
    }
    DB.update('ai_knowledge_base', updates, 'id = ?', [id]);
    Auth.logAudit(0, 0, 'update_kb', `更新知识库条目: id=${id}`, 'success');
    Response.success({ ok: true });
  }

  if (method === 'POST' && action === 'delete-kb') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少条目 ID');
    DB.delete('ai_knowledge_base', 'id = ?', [id]);
    Auth.logAudit(0, 0, 'delete_kb', `删除知识库条目: id=${id}`, 'success');
    Response.success({ ok: true });
  }

  // ===== 网页空间管理 =====
  // 列出所有网页空间
  if (method === 'GET' && action === 'list-web-spaces') {
    const spaces = DB.all(
      "SELECT s.*, (SELECT COUNT(*) FROM web_hosting_files WHERE space_id = s.id AND is_directory = 0) AS file_count, (SELECT COUNT(*) FROM web_hosting_files WHERE space_id = s.id AND review_status = 'pending_review' AND is_directory = 0) AS pending_count FROM web_hosting_spaces s ORDER BY s.created_at DESC"
    );
    Response.success(spaces);
  }

  // 管理员禁用/启用网页空间
  if (method === 'POST' && action === 'toggle-web-space-admin') {
    const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
    const disabled = !Helpers.empty(body.disabled);
    const reason = String(body.reason ?? '').trim();
    if (!spaceId) Response.error('缺少空间 ID');
    const space = DB.one('SELECT * FROM web_hosting_spaces WHERE id = ?', [spaceId]);
    if (!space) Response.error('网页空间不存在');
    const updates = {
      disabled_by_admin: disabled ? 1 : 0,
      disabled_reason: disabled ? reason : null,
      updated_at: nowStr(),
    };
    // 如果管理员禁用，同时取消 is_enabled
    if (disabled) {
      updates.is_enabled = 0;
    }
    DB.update('web_hosting_spaces', updates, 'id = ?', [spaceId]);
    Auth.logAudit(0, 0, 'web_space_admin_toggle',
      `${disabled ? '禁用' : '启用'}网页空间: ${space.alliance_username} (reason: ${reason})`,
      'success');
    Response.success({ ok: true, disabled: disabled });
  }

  // 列出待审查的网页空间（仅显示有 pending 审核的）
  if (method === 'GET' && action === 'list-pending-reviews') {
    const spaces = DB.all(
      "SELECT s.* FROM web_hosting_spaces s WHERE s.review_status = 'pending_review' ORDER BY s.updated_at DESC"
    );
    // 为每个空间获取待审查文件列表
    const result = [];
    for (const space of spaces) {
      const pendingFiles = DB.all(
        "SELECT id, file_path, file_size, published_size, content, published_content, updated_at FROM web_hosting_files WHERE space_id = ? AND review_status = 'pending_review' AND is_directory = 0",
        [space.id]
      );
      result.push({
        ...space,
        pending_files: pendingFiles.map(f => ({
          id: f.id,
          file_path: f.file_path,
          file_size: f.file_size,
          published_size: f.published_size,
          content: f.content ? (Buffer.isBuffer(f.content) ? f.content.toString('utf8') : String(f.content)) : '',
          published_content: f.published_content ? (Buffer.isBuffer(f.published_content) ? f.published_content.toString('utf8') : String(f.published_content)) : '',
          updated_at: f.updated_at,
        })),
      });
    }
    Response.success(result);
  }

  // 审批通过网页空间（将所有 pending_review 文件同步到 published_content）
  if (method === 'POST' && action === 'approve-review') {
    const spaceId = parseInt(body.space_id ?? 0, 10) || 0;
    if (!spaceId) Response.error('缺少空间 ID');
    const space = DB.one('SELECT * FROM web_hosting_spaces WHERE id = ?', [spaceId]);
    if (!space) Response.error('网页空间不存在');
    const now = nowStr();
    // 将所有 pending_review 文件的内容同步到 published_content
    const pendingFiles = DB.all(
      "SELECT id FROM web_hosting_files WHERE space_id = ? AND review_status = 'pending_review' AND is_directory = 0",
      [spaceId]
    );
    for (const file of pendingFiles) {
      DB.update('web_hosting_files', {
        published_content: DB.scalar("SELECT content FROM web_hosting_files WHERE id = ?", [file.id]),
        published_size: DB.scalar("SELECT file_size FROM web_hosting_files WHERE id = ?", [file.id]) || 0,
        review_status: 'published',
        updated_at: now,
      }, 'id = ?', [file.id]);
    }
    // 更新空间状态
    DB.update('web_hosting_spaces', { review_status: 'published', updated_at: now }, 'id = ?', [spaceId]);
    Auth.logAudit(0, 0, 'web_space_approve_review',
      `审批通过网页空间: ${space.alliance_username}`,
      'success');
    Response.success({ ok: true });
  }

  // 获取审查文件 diff
  if (method === 'GET' && action === 'get-review-diff') {
    const fileId = parseInt(query.file_id ?? 0, 10) || 0;
    if (!fileId) Response.error('缺少文件 ID');
    const file = DB.one(
      "SELECT * FROM web_hosting_files WHERE id = ? AND review_status = 'pending_review' AND is_directory = 0",
      [fileId]
    );
    if (!file) Response.error('文件不存在或无需审查');
    const content = file.content ? (Buffer.isBuffer(file.content) ? file.content.toString('utf8') : String(file.content)) : '';
    const published = file.published_content ? (Buffer.isBuffer(file.published_content) ? file.published_content.toString('utf8') : String(file.published_content)) : '';
    Response.success({
      id: file.id,
      file_path: file.file_path,
      content: content,
      published_content: published,
      file_size: file.file_size,
      published_size: file.published_size,
      updated_at: file.updated_at,
    });
  }

  Response.error('未知操作');
};
