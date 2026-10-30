/**
 * 云文件 API（轻编辑器使用）
 * 文件存储在班级主页（web_hosting_files）的 /.cloud/ 隐藏目录下
 * 该目录无法通过 /site/{slug}/.cloud/ 从外部访问
 *
 * 操作：
 *  - GET  action=list                   列出当前用户的云文件
 *  - GET  action=get&id=N              获取云文件内容（id 为 web_hosting_files 的 id）
 *  - POST action=create                 创建云文件
 *  - POST action=update                 更新云文件内容/名称
 *  - POST action=delete                 删除云文件
 */
const { nowStr } = require('../lib/response');
const DB = require('../lib/db');

// 隐藏目录前缀
const CLOUD_PREFIX = '/.cloud/';

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireAlliance();
  const username = Auth.allianceUsername();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  // $body = Helpers::jsonBody(); → body

  // 确保空间存在并获取 spaceId
  const space = ensureCloudSpace(username);
  const spaceId = space.id;

  if (method === 'GET' && action === 'list') {
    const rows = DB.all(
      `SELECT id, file_path, file_size, content_type, created_at, updated_at, is_directory
       FROM web_hosting_files
       WHERE space_id = ? AND file_path LIKE ? AND file_path != ?
       ORDER BY is_directory DESC, file_path ASC`,
      [spaceId, CLOUD_PREFIX + '%', '/.cloud']
    );
    const ownerDisplay = username;
    // 转换为轻编辑器期望的格式
    const result = rows.map((row) => {
      const name = basename(row.file_path);
      const isDirectory = parseInt(row.is_directory, 10) === 1;
      // 检查是否已分享
      const shared = isDirectory ? 0 : DB.scalar(
        `SELECT COUNT(*) FROM share_items
         WHERE resource_type = 'cloud_file' AND resource_id = ? AND is_deleted = 0`,
        [row.id]
      ) > 0;
      return {
        id: row.id,
        name: name,
        file_path: row.file_path,
        parent_dir: parentDirOf(row.file_path),
        is_directory: isDirectory ? 1 : 0,
        file_type: isDirectory ? 'dir' : fileExt(name),
        file_size: row.file_size,
        content_type: row.content_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_shared: shared ? 1 : 0,
        source: 'owned',
        owner: ownerDisplay,
        owner_username: username,
      };
    });

    // 获取分享给我的文件（统一展示在根目录）
    let userId = 0;
    const user = Auth.user();
    if (user) userId = parseInt(user.user_id ?? 0, 10) || 0;
    if (userId > 0) {
      const sharedRows = DB.all(
        `SELECT DISTINCT whf.*, sup.permission AS shared_permission, si.owner_username AS shared_from
         FROM share_items si
         JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
         JOIN web_hosting_files whf ON whf.id = si.resource_id
         WHERE si.resource_type = 'cloud_file' AND si.is_deleted = 0 AND si.expires_at > datetime('now','localtime')
         ORDER BY whf.file_path ASC`,
        [userId]
      );
      for (const row of sharedRows) {
        const name = basename(row.file_path);
        result.push({
          id: row.id,
          name: name,
          file_path: row.file_path,
          parent_dir: '',
          is_directory: 0,
          file_type: fileExt(name),
          file_size: row.file_size,
          content_type: row.content_type,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_shared: 0,
          source: 'shared',
          shared_from: row.shared_from,
          shared_permission: row.shared_permission,
          owner: row.shared_from,
          owner_username: row.shared_from,
        });
      }
    }

    Response.success(result);
  }

  // 云存储用量（轻编辑器左下角）
  if (method === 'GET' && action === 'usage') {
    const used = parseInt(DB.scalar(
      `SELECT COALESCE(SUM(file_size), 0) FROM web_hosting_files
       WHERE space_id = ? AND file_path LIKE ? AND is_directory = 0`,
      [spaceId, CLOUD_PREFIX + '%']
    ) ?? 0, 10) || 0;
    const quota = parseInt(space.storage_quota ?? 0, 10) || (100 * 1024 * 1024);
    Response.success({
      used: used,
      quota: quota,
      percent: quota > 0 ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 0,
    });
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) {
      // 检查是否是分享给我的文件
      const userId = parseInt(Auth.user()?.user_id ?? 0, 10) || 0;
      if (userId > 0) {
        const sharedRow = DB.one(
          `SELECT whf.*, sup.permission AS shared_permission
           FROM web_hosting_files whf
           JOIN share_items si ON si.resource_id = whf.id AND si.resource_type = 'cloud_file' AND si.is_deleted = 0
           JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
           WHERE whf.id = ? AND si.expires_at > datetime('now','localtime')`,
          [userId, id]
        );
        if (sharedRow) {
          // 只读权限时提示
          const isReadOnly = (sharedRow.shared_permission ?? 'view') === 'view';
          Response.success({
            id: sharedRow.id,
            name: basename(sharedRow.file_path),
            file_path: sharedRow.file_path,
            parent_dir: '',
            is_directory: 0,
            file_type: fileExt(sharedRow.file_path),
            file_size: sharedRow.file_size,
            content: sharedRow.content ?? '',
            content_type: sharedRow.content_type,
            created_at: sharedRow.created_at,
            updated_at: sharedRow.updated_at,
            source: 'shared',
            permission: sharedRow.shared_permission,
            owner: sharedRow.shared_from || '',
            owner_username: sharedRow.shared_from || '',
          });
        }
      }
      Response.error('云文件不存在');
    }
    Response.success({
      id: row.id,
      name: basename(row.file_path),
      file_path: row.file_path,
      parent_dir: parentDirOf(row.file_path),
      is_directory: parseInt(row.is_directory, 10) === 1 ? 1 : 0,
      file_type: parseInt(row.is_directory, 10) === 1 ? 'dir' : fileExt(row.file_path),
      file_size: row.file_size,
      content: row.content ?? '',
      content_type: row.content_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: 'owned',
      owner: Auth.user()?.display_name || Auth.allianceUsername(),
      owner_username: Auth.allianceUsername(),
    });
  }

  if (method === 'POST' && action === 'create') {
    let name = String(body.name ?? '').trim();
    const fileType = body.file_type ?? 'json';
    const content = body.content ?? '';
    const dir = normalizeCloudDir(body.dir);
    if (dir === null) Response.error('目录路径不合法');

    if (name === '') Response.error('文件名不能为空');
    if (!validCloudName(name)) Response.error('文件名不能包含 / \\ : * ? " < > | 等字符');
    if (dir !== '' && !cloudDirExists(spaceId, dir)) Response.error('目标目录不存在');

    // 自动添加扩展名
    if (!name.includes('.')) {
      name += '.' + fileType;
    }

    const filePath = cloudPathFor(name, dir);
    const now = nowStr();

    // 确保 /.cloud/ 目录存在
    ensureCloudDir(spaceId, now);

    // 检查是否已存在
    const exists = DB.one(
      `SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?`,
      [spaceId, filePath]
    );
    if (exists) Response.error('同名文件已存在');

    const contentSize = Buffer.byteLength(String(content));
    const contentType = guessCloudContentType(name);

    const id = DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: filePath,
      file_size: contentSize,
      content_type: contentType,
      content: content,
      is_directory: 0,
      created_at: now,
      updated_at: now,
    });

    Auth.logAudit(schoolId, 0, 'cloud_file_create', `创建云文件: ${username} -> ${filePath}`);
    Response.success({
      id: id, name: name, file_path: filePath, parent_dir: dir, is_directory: 0,
    }, '云文件已创建');
  }

  if (method === 'POST' && action === 'update') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    let row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) {
      // 检查是否是分享给我的文件（需有编辑权限）
      const userId = parseInt(Auth.user()?.user_id ?? 0, 10) || 0;
      if (userId > 0) {
        const sharedRow = DB.one(
          `SELECT whf.*, sup.permission AS shared_permission
           FROM web_hosting_files whf
           JOIN share_items si ON si.resource_id = whf.id AND si.resource_type = 'cloud_file' AND si.is_deleted = 0
           JOIN share_user_permissions sup ON sup.share_id = si.id AND sup.target_user_id = ? AND sup.status = 'accepted'
           WHERE whf.id = ? AND si.expires_at > datetime('now','localtime')`,
          [userId, id]
        );
        if (sharedRow && (sharedRow.shared_permission ?? 'view') === 'edit') {
          row = sharedRow;
        } else {
          Response.error('云文件不存在或无权编辑');
        }
      } else {
        Response.error('云文件不存在');
      }
    }

    const updates = { updated_at: nowStr() };
    if (parseInt(row.is_directory, 10) === 1) {
      Response.error('目录请使用重命名操作（action=rename）');
    }
    if (body.name !== undefined && body.name !== null) {
      const newName = String(body.name).trim();
      if (newName === '') Response.error('文件名不能为空');
      if (!validCloudName(newName)) Response.error('文件名不能包含 / \\ : * ? " < > | 等字符');
      const newPath = cloudPathFor(newName, parentDirOf(row.file_path));
      // 检查新路径是否冲突
      if (newPath !== row.file_path) {
        const conflict = DB.one(
          `SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND id != ?`,
          [spaceId, newPath, id]
        );
        if (conflict) Response.error('同名文件已存在');
        updates.file_path = newPath;
      }
    }
    if (body.content !== undefined && body.content !== null) {
      updates.content = body.content;
      updates.file_size = Buffer.byteLength(String(body.content));
    }
    if (body.file_type !== undefined && body.file_type !== null) {
      updates.content_type = guessCloudContentType(row.file_path);
    }

    DB.update('web_hosting_files', updates, 'id = ?', [id]);
    Response.success(null, '已保存');
  }

  if (method === 'POST' && action === 'rename') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const newName = String(body.name ?? '').trim();
    if (id <= 0) Response.error('缺少文件 ID');
    if (newName === '') Response.error('名称不能为空');
    if (!validCloudName(newName)) Response.error('名称不能包含 / \\ : * ? " < > | 等字符');

    const row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) Response.error('云文件不存在');

    const isDirectory = parseInt(row.is_directory, 10) === 1;
    const oldPath = row.file_path;
    const newPath = isDirectory
      ? cloudPathFor(newName, parentDirOf(oldPath))
      : cloudPathFor(newName, parentDirOf(oldPath));

    if (newPath !== oldPath) {
      const conflict = DB.one(
        `SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND id != ?`,
        [spaceId, newPath, id]
      );
      if (conflict) Response.error(isDirectory ? '同名目录已存在' : '同名文件已存在');

      if (isDirectory) {
        // 目录改名：同步更新所有子孙路径
        const prefix = oldPath + '/';
        const children = DB.all(
          `SELECT id, file_path FROM web_hosting_files WHERE space_id = ? AND file_path LIKE ?`,
          [spaceId, prefix + '%']
        );
        DB.update('web_hosting_files', {
          file_path: newPath,
          content_type: null,
          updated_at: nowStr(),
        }, 'id = ?', [id]);
        for (const child of children) {
          DB.update('web_hosting_files', {
            file_path: newPath + child.file_path.slice(oldPath.length),
            updated_at: nowStr(),
          }, 'id = ?', [child.id]);
        }
      } else {
        DB.update('web_hosting_files', {
          file_path: newPath,
          content_type: guessCloudContentType(newName),
          updated_at: nowStr(),
        }, 'id = ?', [id]);
      }
    }

    Auth.logAudit(schoolId, 0, 'cloud_file_rename', `重命名云文件: ${username} -> ${newPath}`);
    Response.success({
      id: id,
      name: newName,
      file_path: newPath,
      parent_dir: parentDirOf(newPath),
      is_directory: isDirectory ? 1 : 0,
    }, '已重命名');
  }

  if (method === 'POST' && action === 'create-dir') {
    const name = String(body.name ?? '').trim();
    const dir = normalizeCloudDir(body.dir);
    if (name === '') Response.error('目录名不能为空');
    if (!validCloudName(name)) Response.error('目录名不能包含 / \\ : * ? " < > | 等字符');
    if (dir === null) Response.error('目录路径不合法');
    if (dir !== '' && !cloudDirExists(spaceId, dir)) Response.error('目标目录不存在');

    const now = nowStr();
    ensureCloudDir(spaceId, now);
    const dirPath = cloudPathFor(name, dir);
    const exists = DB.one(
      `SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?`,
      [spaceId, dirPath]
    );
    if (exists) Response.error('同名目录已存在');

    const id = DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: dirPath,
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
    Auth.logAudit(schoolId, 0, 'cloud_file_mkdir', `创建云目录: ${username} -> ${dirPath}`);
    Response.success({
      id: id, name: name, file_path: dirPath, parent_dir: dir, is_directory: 1,
    }, '目录已创建');
  }

  if (method === 'POST' && action === 'delete') {
    const id = parseInt(body.id ?? 0, 10) || 0;
    const row = DB.one(
      `SELECT * FROM web_hosting_files WHERE id = ? AND space_id = ? AND file_path LIKE ?`,
      [id, spaceId, CLOUD_PREFIX + '%']
    );
    if (!row) Response.error('云文件不存在');

    if (parseInt(row.is_directory, 10) === 1) {
      // 目录：递归删除所有子孙条目
      DB.delete(
        'web_hosting_files',
        `space_id = ? AND (file_path = ? OR file_path LIKE ?)`,
        [spaceId, row.file_path, row.file_path + '/%']
      );
      Auth.logAudit(schoolId, 0, 'cloud_file_delete', `删除云目录: ${username} -> ${row.file_path}`);
      Response.success(null, '目录已删除');
    }

    DB.delete('web_hosting_files', 'id = ?', [id]);
    Auth.logAudit(schoolId, 0, 'cloud_file_delete', `删除云文件: ${username} -> ${row.file_path}`);
    Response.success(null, '已删除');
  }

  // === 操作记录（history） ===

  if (method === 'POST' && action === 'history-save') {
    const fileId = parseInt(body.file_id ?? 0, 10) || 0;
    const fileName = String(body.file_name ?? '').trim();
    const contentSnapshot = body.content_snapshot ?? '';
    const step = parseInt(body.step ?? 0, 10) || 0;

    if (fileId <= 0) Response.error('缺少 file_id 参数');
    const now = nowStr();

    DB.insert('cloud_file_history', {
      file_id: fileId,
      file_name: fileName,
      content_snapshot: contentSnapshot,
      step: step,
      created_by: username,
      created_at: now,
    });

    // 每个文件最多保留 5 条记录，超出时删除最旧的
    const count = DB.scalar(
      `SELECT COUNT(*) FROM cloud_file_history WHERE file_id = ? AND created_by = ?`,
      [fileId, username]
    );
    if (count > 5) {
      const limit = count - 5;
      DB.delete(
        'cloud_file_history',
        `id IN (SELECT id FROM cloud_file_history WHERE file_id = ? AND created_by = ? ORDER BY created_at ASC LIMIT ?)`,
        [fileId, username, limit]
      );
    }

    Response.success(null, '操作记录已保存');
  }

  if (method === 'GET' && action === 'history-list') {
    const fileId = parseInt(query.file_id ?? 0, 10) || 0;
    if (fileId <= 0) Response.error('缺少 file_id 参数');

    const rows = DB.all(
      `SELECT * FROM cloud_file_history WHERE file_id = ? AND created_by = ? ORDER BY step ASC, created_at ASC LIMIT 5`,
      [fileId, username]
    );

    const result = rows.map((row) => {
      return {
        id: row.id,
        file_id: row.file_id,
        file_name: row.file_name,
        content_snapshot: row.content_snapshot,
        step: row.step,
        created_by: row.created_by,
        created_at: row.created_at,
      };
    });

    Response.success(result);
  }

  if (method === 'POST' && action === 'history-restore') {
    const historyId = parseInt(body.history_id ?? 0, 10) || 0;
    if (historyId <= 0) Response.error('缺少 history_id 参数');

    const row = DB.one(
      `SELECT * FROM cloud_file_history WHERE id = ? AND created_by = ?`,
      [historyId, username]
    );
    if (!row) Response.error('操作记录不存在');

    Response.success({
      id: row.id,
      file_id: row.file_id,
      file_name: row.file_name,
      content_snapshot: row.content_snapshot,
      step: row.step,
      created_at: row.created_at,
    });
  }

  // === 版本管理（version） ===

  if (method === 'POST' && action === 'version-save') {
    const fileId = parseInt(body.file_id ?? 0, 10) || 0;
    const fileName = String(body.file_name ?? '').trim();
    const content = body.content ?? '';
    const versionLabel = String(body.version_label ?? '').trim();

    if (fileId <= 0) Response.error('缺少 file_id 参数');
    const now = nowStr();

    DB.insert('cloud_file_versions', {
      file_id: fileId,
      file_name: fileName,
      content: content,
      version_label: versionLabel,
      created_by: username,
      created_at: now,
    });

    // 从工作区配置读取限制
    const config = getWorkspaceConfig(username, 'light_editor');
    const versionEntryLimit = parseInt(config?.version_entry_limit ?? 30, 10) || 30;
    const versionFileLimit = parseInt(config?.version_file_limit ?? 10, 10) || 10;

    const count = DB.scalar(
      `SELECT COUNT(*) FROM cloud_file_versions WHERE file_id = ? AND created_by = ?`,
      [fileId, username]
    );

    // 清理超出条目限制的版本记录（删除最旧的）
    if (count > versionEntryLimit) {
      const limit = count - versionEntryLimit;
      DB.delete(
        'cloud_file_versions',
        `id IN (SELECT id FROM cloud_file_versions WHERE file_id = ? AND created_by = ? ORDER BY created_at ASC LIMIT ?)`,
        [fileId, username, limit]
      );
    }

    // 只保留最近 N 个版本的完整内容，其余清空内容字段（仅保留条目）
    const allVersions = DB.all(
      `SELECT id FROM cloud_file_versions WHERE file_id = ? AND created_by = ? ORDER BY created_at DESC`,
      [fileId, username]
    );
    let index = 0;
    for (const v of allVersions) {
      index++;
      if (index > versionFileLimit) {
        DB.update('cloud_file_versions', { content: null }, 'id = ?', [v.id]);
      }
    }

    Response.success(null, '版本已保存');
  }

  if (method === 'GET' && action === 'version-list') {
    const fileId = parseInt(query.file_id ?? 0, 10) || 0;
    if (fileId <= 0) Response.error('缺少 file_id 参数');

    const rows = DB.all(
      `SELECT id, file_id, file_name, version_label, created_by, created_at FROM cloud_file_versions WHERE file_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 10`,
      [fileId, username]
    );

    const result = rows.map((row) => {
      return {
        id: row.id,
        file_id: row.file_id,
        file_name: row.file_name,
        version_label: row.version_label,
        created_by: row.created_by,
        created_at: row.created_at,
      };
    });

    Response.success(result);
  }

  if (method === 'GET' && action === 'version-get') {
    const versionId = parseInt(query.version_id ?? 0, 10) || 0;
    if (versionId <= 0) Response.error('缺少 version_id 参数');

    const row = DB.one(
      `SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?`,
      [versionId, username]
    );
    if (!row) Response.error('版本不存在');

    Response.success({
      id: row.id,
      file_id: row.file_id,
      file_name: row.file_name,
      content: row.content ?? '',
      version_label: row.version_label,
      created_by: row.created_by,
      created_at: row.created_at,
    });
  }

  // === 版本删除（仅持有者可删除） ===

  if (method === 'POST' && action === 'version-delete') {
    const versionId = parseInt(body.version_id ?? 0, 10) || 0;
    if (versionId <= 0) Response.error('缺少 version_id 参数');

    const row = DB.one(
      "SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?",
      [versionId, username]
    );
    if (!row) Response.error('版本不存在或无权删除');

    DB.delete('cloud_file_versions', 'id = ?', [versionId]);
    Auth.logAudit(schoolId, 0, 'version_delete', `删除版本: ${username} -> v${versionId}`);
    Response.success(null, '版本已删除');
  }

  // === 版本对比（diff） ===

  if (method === 'GET' && action === 'version-diff') {
    const versionId1 = parseInt(query.v1 ?? 0, 10) || 0;
    const versionId2 = parseInt(query.v2 ?? 0, 10) || 0;
    if (versionId1 <= 0 || versionId2 <= 0) Response.error('缺少版本参数');

    const v1 = DB.one("SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?", [versionId1, username]);
    const v2 = DB.one("SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?", [versionId2, username]);
    if (!v1 || !v2) Response.error('版本不存在');

    const content1 = v1.content ?? '';
    const content2 = v2.content ?? '';

    Response.success({
      v1: { id: v1.id, label: v1.version_label, created_at: v1.created_at },
      v2: { id: v2.id, label: v2.version_label, created_at: v2.created_at },
      content1: content1,
      content2: content2,
    });
  }

  // === 操作日志（每次操作都记录） ===

  if (method === 'POST' && action === 'operation-log') {
    const fileId = parseInt(body.file_id ?? 0, 10) || 0;
    const fileName = String(body.file_name ?? '').trim();
    const actionType = String(body.action_type ?? 'edit').trim();
    const actionLabel = String(body.action_label ?? '').trim();
    const contentSnapshot = body.content_snapshot ?? '';
    const details = body.details ?? '';

    const now = nowStr();

    DB.insert('cloud_operation_logs', {
      file_id: fileId,
      file_name: fileName,
      action_type: actionType,
      action_label: actionLabel,
      content_snapshot: contentSnapshot,
      details: details,
      created_by: username,
      created_at: now,
    });

    // 清理超出限制的旧记录
    const config = getWorkspaceConfig(username, 'light_editor');
    const opLimit = parseInt(config?.operation_cloud_limit ?? 50, 10) || 50;
    const count = DB.scalar(
      "SELECT COUNT(*) FROM cloud_operation_logs WHERE file_id = ? AND created_by = ?",
      [fileId, username]
    );
    if (count > opLimit) {
      const limit = count - opLimit;
      DB.delete(
        'cloud_operation_logs',
        "id IN (SELECT id FROM cloud_operation_logs WHERE file_id = ? AND created_by = ? ORDER BY created_at ASC LIMIT ?)",
        [fileId, username, limit]
      );
    }

    Response.success(null, '操作已记录');
  }

  if (method === 'GET' && action === 'operation-list') {
    const fileId = parseInt(query.file_id ?? 0, 10) || 0;
    const limit = parseInt(query.limit ?? 50, 10) || 50;
    if (fileId <= 0) Response.error('缺少 file_id 参数');

    const rows = DB.all(
      "SELECT * FROM cloud_operation_logs WHERE file_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT ?",
      [fileId, username, limit]
    );

    const result = rows.map((row) => ({
      id: row.id,
      file_id: row.file_id,
      file_name: row.file_name,
      action_type: row.action_type,
      action_label: row.action_label,
      content_snapshot: row.content_snapshot,
      details: row.details,
      created_by: row.created_by,
      created_at: row.created_at,
    }));

    Response.success(result);
  }

  // === 工作区配置 ===

  if (method === 'GET' && action === 'workspace-config') {
    const workspaceKey = String(query.workspace ?? 'light_editor').trim();
    const config = getWorkspaceConfig(username, workspaceKey);
    Response.success(config);
  }

  if (method === 'POST' && action === 'workspace-config-update') {
    const workspaceKey = String(body.workspace ?? 'light_editor').trim();
    const config = body.config ?? {};

    if (typeof config !== 'object' || Array.isArray(config)) Response.error('config 必须为对象');

    saveWorkspaceConfig(username, workspaceKey, config);
    Auth.logAudit(schoolId, 0, 'workspace_config_update', `更新工作区配置: ${username} -> ${workspaceKey}`);
    Response.success(config, '工作区配置已更新');
  }

  // === 存储规则（兼容旧接口） ===

  if (method === 'GET' && action === 'storage-rules') {
    const config = getWorkspaceConfig(username, 'light_editor');
    Response.success({
      history_limit: parseInt(config?.operation_cloud_limit ?? 50, 10) || 50,
      version_limit: parseInt(config?.version_entry_limit ?? 30, 10) || 30,
      version_file_limit: parseInt(config?.version_file_limit ?? 10, 10) || 10,
      operation_local_limit: parseInt(config?.operation_local_limit ?? 100, 10) || 100,
    });
  }

  if (method === 'POST' && action === 'storage-rules-update') {
    const user = Auth.user();
    const isAdmin = (user?.role ?? '') === 'admin' || (user?.role ?? '') === 'super_admin' || (user?.type ?? '') === 'alliance';
    if (!isAdmin) {
      Response.error('仅管理员可更新存储规则');
    }

    const config = {
      operation_cloud_limit: parseInt(body.history_limit ?? 50, 10) || 50,
      version_entry_limit: parseInt(body.version_limit ?? 30, 10) || 30,
      version_file_limit: parseInt(body.version_file_limit ?? 10, 10) || 10,
      operation_local_limit: parseInt(body.operation_local_limit ?? 100, 10) || 100,
    };

    saveWorkspaceConfig(username, 'light_editor', config);
    Response.success(config, '存储规则已更新');
  }

  Response.error('未知的操作');
};

// === 辅助函数 ===

/** basename() 等价 */
function basename(p) {
  return String(p).split('/').pop();
}

/** 云文件/目录名：允许中文/空格，禁止路径分隔符、控制字符、.. 与首尾空白；最多 180 字节 */
function validCloudName(name) {
  const value = String(name ?? '').trim();
  if (value === '' || value === '.' || value === '..') return false;
  if (Buffer.byteLength(value, 'utf8') > 180) return false;
  return !/[\/\\:*?"<>|\x00-\x1F]/.test(value);
}

/** 规范化云目录（相对 `/.cloud/` 的路径；根目录返回 ''）。非法返回 null。 */
function normalizeCloudDir(dir) {
  if (dir === undefined || dir === null) return '';
  let result = String(dir).replace(/\\/g, '/').trim();
  result = result.replace(/^\/+|\/+$/g, '');
  if (result === '' || result === '.') return '';
  if (result.indexOf('/.cloud') === 0) result = result.slice('/.cloud'.length).replace(/^\/+/, '');
  const parts = result.split('/').filter(Boolean);
  for (const part of parts) {
    if (!validCloudName(part)) return null;
  }
  return parts.join('/');
}

/** 由父目录与名称生成完整 cloud 路径。 */
function cloudPathFor(name, dir) {
  const cleanDir = dir ? String(dir).replace(/^\/+|\/+$/g, '') : '';
  return CLOUD_PREFIX + (cleanDir ? cleanDir + '/' : '') + name;
}

/** 完整路径 → 相对 `/.cloud/` 的父目录（根为 ''）。 */
function parentDirOf(filePath) {
  const p = String(filePath === undefined || filePath === null ? '' : filePath);
  const idx = p.lastIndexOf('/');
  if (idx < 0) return '';
  const dir = p.slice(0, idx);
  if (dir === '/.cloud') return '';
  return dir.indexOf(CLOUD_PREFIX) === 0 ? dir.slice(CLOUD_PREFIX.length) : '';
}

/** 判断云目录是否存在。 */
function cloudDirExists(spaceId, dir) {
  if (!dir) return true;
  const row = DB.one(
    `SELECT 1 AS x FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1`,
    [spaceId, CLOUD_PREFIX + dir]
  );
  return !!row;
}

/** pathinfo($name, PATHINFO_EXTENSION) 等价（以点开头的隐藏文件无扩展名） */
function fileExt(name) {
  const base = basename(name);
  const pos = base.lastIndexOf('.');
  if (pos <= 0) return '';
  return base.slice(pos + 1);
}

/** htmlspecialchars() 等价（ENT_QUOTES） */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 确保云存储空间存在（复用班级主页的 ensureSpace 逻辑）
function ensureCloudSpace(username)
{
  // 直接复用旧版中的 ensureSpace 逻辑
  let space = DB.one(
    `SELECT * FROM web_hosting_spaces WHERE alliance_username = ?`,
    [username]
  );

  if (!space) {
    let slug = username;
    let counter = 1;
    while (DB.scalar(`SELECT 1 FROM web_hosting_spaces WHERE slug = ?`, [slug])) {
      slug = username + '-' + (counter++);
    }
    const now = nowStr();
    const spaceId = DB.insert('web_hosting_spaces', {
      alliance_username: username,
      slug: slug,
      title: username + ' 的班级主页',
      description: '',
      storage_quota: 100 * 1024 * 1024,
      is_enabled: 1,
      created_at: now,
      updated_at: now,
    });
    space = DB.one(`SELECT * FROM web_hosting_spaces WHERE id = ?`, [spaceId]);

    // 创建默认 index.html
    const defaultHtml = getDefaultCloudIndexHtml(username);
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/index.html',
      file_size: Buffer.byteLength(defaultHtml),
      content_type: 'text/html',
      content: defaultHtml,
      is_directory: 0,
      created_at: now,
      updated_at: now,
    });
  }

  return space;
}

// 确保 /.cloud/ 目录存在
function ensureCloudDir(spaceId, now)
{
  const exists = DB.scalar(
    `SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1`,
    [spaceId, '/.cloud']
  );
  if (!exists) {
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: '/.cloud',
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

// 根据文件名猜测 MIME 类型
function guessCloudContentType(name)
{
  const ext = fileExt(name).toLowerCase();
  const types = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'mjs': 'application/javascript',
    'json': 'application/json', 'txt': 'text/plain', 'md': 'text/markdown',
    'xml': 'application/xml', 'yaml': 'text/yaml', 'yml': 'text/yaml',
    'csv': 'text/csv', 'php': 'text/plain', 'py': 'text/plain',
    'sql': 'text/plain', 'ts': 'application/javascript',
  };
  return types[ext] ?? 'application/octet-stream';
}

// 默认首页 HTML
function getDefaultCloudIndexHtml(username)
{
  const title = escapeHtml(username + ' 的班级主页');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: white; border-radius: 16px; padding: 48px 32px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); max-width: 500px; width: 100%; text-align: center; }
        h1 { color: #1a1a1a; font-size: 28px; margin-bottom: 16px; }
        p { color: #666; font-size: 16px; line-height: 1.6; }
        .powered { color: #999; font-size: 14px; margin-top: 24px; padding-top: 24px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="card">
        <h1>${title}</h1>
        <p>欢迎来到我的班级主页！</p>
        <div class="powered">Powered by CSES Cloud 智教云</div>
    </div>
</body>
</html>`;
}

// 获取工作区配置（默认值）
function getWorkspaceConfig(username, workspaceKey) {
  const row = DB.one(
    "SELECT config FROM workspace_configs WHERE username = ? AND workspace_key = ?",
    [username, workspaceKey]
  );
  if (row && row.config) {
    try {
      const config = JSON.parse(row.config);
      if (config && typeof config === 'object' && !Array.isArray(config)) return config;
    } catch (_) {}
  }
  // 返回默认配置
  return {
    operation_cloud_limit: 50,
    operation_local_limit: 100,
    version_entry_limit: 30,
    version_file_limit: 10,
  };
}

// 保存工作区配置
function saveWorkspaceConfig(username, workspaceKey, config) {
  const configJson = JSON.stringify(config);
  const now = nowStr();

  const exists = DB.scalar(
    "SELECT 1 FROM workspace_configs WHERE username = ? AND workspace_key = ?",
    [username, workspaceKey]
  );

  if (exists) {
    DB.update('workspace_configs', {
      config: configJson,
      updated_at: now,
    }, 'username = ? AND workspace_key = ?', [username, workspaceKey]);
  } else {
    DB.insert('workspace_configs', {
      username: username,
      workspace_key: workspaceKey,
      config: configJson,
      created_at: now,
      updated_at: now,
    });
  }
}
