/**
 * 用户设置 API（控制台首页快捷导航/快捷工具编辑）
 * 配置存储在数据空间 /.cloud/用户配置/ 目录下
 */
const { nowStr } = require('../lib/response');

const CONFIG_DIR = '/.cloud/用户配置';

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const username = Auth.allianceUsername();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';

  // 确保云空间和数据空间存在
  const space = ensureCloudSpace(DB, username);
  const spaceId = space.id;

  // 确保 /.cloud/用户配置/ 目录存在
  ensureConfigDir(DB, spaceId);

  // 获取设置
  if (method === 'GET' && action === 'get') {
    const key = String(query.key ?? '').trim();
    if (!key) Response.error('缺少设置键名');

    const filePath = CONFIG_DIR + '/' + key + '.json';
    const row = DB.one(
      "SELECT id, content FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0",
      [spaceId, filePath]
    );

    if (row && row.content) {
      try {
        const config = JSON.parse(typeof row.content === 'string' ? row.content : row.content.toString('utf8'));
        Response.success({ config: config });
      } catch (_) {
        Response.success({ config: null });
      }
    } else {
      Response.success({ config: null });
    }
  }

  // 保存设置
  if (method === 'POST' && action === 'save') {
    const key = String(body.key ?? '').trim();
    const config = body.config;
    if (!key) Response.error('缺少设置键名');

    const configStr = typeof config === 'string' ? config : JSON.stringify(config);
    const filePath = CONFIG_DIR + '/' + key + '.json';
    const now = nowStr();

    const exists = DB.one(
      "SELECT id FROM web_hosting_files WHERE space_id = ? AND file_path = ?",
      [spaceId, filePath]
    );

    if (exists) {
      DB.update('web_hosting_files', {
        content: configStr,
        file_size: Buffer.byteLength(configStr),
        content_type: 'application/json',
        updated_at: now,
      }, 'id = ?', [exists.id]);
    } else {
      DB.insert('web_hosting_files', {
        space_id: spaceId,
        file_path: filePath,
        file_size: Buffer.byteLength(configStr),
        content_type: 'application/json',
        content: configStr,
        is_directory: 0,
        created_at: now,
        updated_at: now,
      });
    }

    Auth.logAudit(schoolId, 0, 'user_settings_save', `保存用户配置: ${username} -> ${key}`);
    Response.success({ ok: true }, '设置已保存');
  }

  Response.error('未知的操作');
};

// ===== 辅助函数 =====

// 确保云空间存在
function ensureCloudSpace(DB, username) {
  let space = DB.one(
    "SELECT * FROM web_hosting_spaces WHERE alliance_username = ?",
    [username]
  );
  if (!space) {
    let slug = username;
    let counter = 1;
    while (DB.scalar("SELECT 1 FROM web_hosting_spaces WHERE slug = ?", [slug])) {
      slug = username + '-' + (counter++);
    }
    const now = nowStr();
    const spaceId = DB.insert('web_hosting_spaces', {
      alliance_username: username,
      slug: slug,
      title: username + ' 的数据空间',
      description: '',
      storage_quota: 100 * 1024 * 1024,
      is_enabled: 1,
      created_at: now,
      updated_at: now,
    });
    space = DB.one("SELECT * FROM web_hosting_spaces WHERE id = ?", [spaceId]);
  }
  return space;
}

// 确保 /.cloud/ 目录存在
function ensureCloudDir(DB, spaceId) {
  const exists = DB.scalar(
    "SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = '/.cloud' AND is_directory = 1",
    [spaceId]
  );
  if (!exists) {
    const now = nowStr();
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

// 确保 /.cloud/用户配置/ 目录存在
function ensureConfigDir(DB, spaceId) {
  ensureCloudDir(DB, spaceId);
  const exists = DB.scalar(
    "SELECT 1 FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 1",
    [spaceId, CONFIG_DIR]
  );
  if (!exists) {
    const now = nowStr();
    DB.insert('web_hosting_files', {
      space_id: spaceId,
      file_path: CONFIG_DIR,
      file_size: 0,
      content_type: null,
      content: null,
      is_directory: 1,
      created_at: now,
      updated_at: now,
    });
  }
}