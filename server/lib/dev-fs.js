/**
 * 开发者中心 - 纯文件系统存储层
 *
 * 所有应用和插件完全以文件形式存储，不再依赖数据库。
 *
 * 目录结构：
 *   data/dev/                     # 共享市场（官方/共享应用和插件）
 *     apps/{app_key}/
 *       manifest.json             # 基础元数据 + app_info_manifest
 *       editor.html / editor.js
 *       storage.json / interface.json / control.json
 *     plugins/{plugin_key}/
 *       manifest.json             # 基础元数据 + extensions
 *       editor.html / editor.js / editor.css
 *
 *   data/dev-users/               # 用户自己的应用和插件
 *     {username}/
 *       apps/{app_key}/
 *         manifest.json
 *         ...
 *       plugins/{plugin_key}/
 *         manifest.json
 *         ...
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEV_DIR = path.join(ROOT, 'data', 'dev');
const DEV_USERS_DIR = path.join(ROOT, 'data', 'dev-users');
const SHARED_APPS_DIR = path.join(DEV_DIR, 'apps');
const SHARED_PLUGINS_DIR = path.join(DEV_DIR, 'plugins');

// ========== 工具函数 ==========

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(content ?? ''), 'utf8');
}

function readText(filePath, def = '') {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return def; }
}

/** 从字符串生成稳定的正整数 ID（djb2 哈希） */
function stableId(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0x7fffffff; // 保持 31-bit 正整数
  }
  return hash;
}

/** 获取当前时间字符串 */
function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ========== 应用文件存储 ==========

const BASE_FIELDS = ['app_key', 'name', 'version', 'description', 'category', 'status',
  'developer_username', 'is_shared', 'is_official', 'forked_from', 'forked_by',
  'created_at', 'updated_at'];

const AppFS = {
  // ---- 路径工具 ----

  /** 共享市场应用目录 */
  sharedDir(appKey) {
    return path.join(SHARED_APPS_DIR, appKey);
  },

  /** 用户应用目录 */
  userDir(username, appKey) {
    return path.join(DEV_USERS_DIR, username, 'apps', appKey);
  },

  /** 根据 app_key 查找应用所在目录（先查共享市场，再查所有用户） */
  findDir(appKey) {
    const shared = this.sharedDir(appKey);
    if (fs.existsSync(shared)) return shared;
    // 查找用户目录
    if (fs.existsSync(DEV_USERS_DIR)) {
      const users = fs.readdirSync(DEV_USERS_DIR, { withFileTypes: true });
      for (const u of users) {
        if (u.isDirectory()) {
          const userDir = this.userDir(u.name, appKey);
          if (fs.existsSync(userDir)) return userDir;
        }
      }
    }
    return null;
  },

  // ---- 读取 ----

  /** 从指定目录读取应用完整数据 */
  _readFromDir(dir, appKey) {
    if (!fs.existsSync(dir)) return null;
    const manifest = readJson(path.join(dir, 'manifest.json'));
    if (!manifest) return null;

    const appInfo = {};
    for (const [k, v] of Object.entries(manifest)) {
      if (!BASE_FIELDS.includes(k)) appInfo[k] = v;
    }

    const result = {
      _id: stableId(manifest.app_key || appKey),
      app_key: manifest.app_key || appKey,
      name: manifest.name || '',
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      category: manifest.category || '通用',
      status: manifest.status || 'draft',
      developer_username: manifest.developer_username || '',
      is_shared: manifest.is_shared ? 1 : 0,
      is_official: manifest.is_official ? 1 : 0,
      forked_from: manifest.forked_from || null,
      forked_by: manifest.forked_by || null,
      created_at: manifest.created_at || '',
      updated_at: manifest.updated_at || '',
      app_info_manifest: appInfo,
      editor_html: readText(path.join(dir, 'editor.html')),
      editor_js: readText(path.join(dir, 'editor.js')),
      storage_manifest: readJson(path.join(dir, 'storage.json')),
      interface_schema: readJson(path.join(dir, 'interface.json')),
      control_manifest: readJson(path.join(dir, 'control.json')),
    };
    return result;
  },

  /** 从共享市场读取 */
  readShared(appKey) {
    return this._readFromDir(this.sharedDir(appKey), appKey);
  },

  /** 从用户目录读取 */
  readUser(username, appKey) {
    return this._readFromDir(this.userDir(username, appKey), appKey);
  },

  /** 根据 app_key 自动查找并读取 */
  readByKey(appKey) {
    return this._readFromDir(this.findDir(appKey), appKey);
  },

  /** 获取基础元数据 */
  readMeta(appKey) {
    const dir = this.findDir(appKey);
    if (!dir) return null;
    const manifest = readJson(path.join(dir, 'manifest.json'));
    if (!manifest) return null;
    manifest._id = stableId(manifest.app_key || appKey);
    return manifest;
  },

  // ---- 写入 ----

  /** 写入应用数据到指定目录 */
  _writeToDir(dir, appKey, data) {
    ensureDir(dir);

    const manifestData = data.app_info_manifest;
    const hasManifestUpdate = manifestData !== undefined || data.name !== undefined || data.version !== undefined
      || data.description !== undefined || data.category !== undefined || data.status !== undefined
      || data.developer_username !== undefined || data.is_shared !== undefined || data.is_official !== undefined
      || data.updated_at !== undefined || data.created_at !== undefined;

    if (hasManifestUpdate) {
      const existing = readJson(path.join(dir, 'manifest.json')) || {};
      const merged = { ...existing };
      if (data.name !== undefined) merged.name = data.name;
      if (data.version !== undefined) merged.version = data.version;
      if (data.description !== undefined) merged.description = data.description;
      if (data.category !== undefined) merged.category = data.category;
      if (data.status !== undefined) merged.status = data.status;
      if (data.developer_username !== undefined) merged.developer_username = data.developer_username;
      if (data.is_shared !== undefined) merged.is_shared = data.is_shared ? true : false;
      if (data.is_official !== undefined) merged.is_official = data.is_official ? true : false;
      if (data.updated_at !== undefined) merged.updated_at = data.updated_at;
      if (data.created_at !== undefined) merged.created_at = data.created_at;
      if (manifestData !== undefined) {
        const appInfo = typeof manifestData === 'string' ? JSON.parse(manifestData) : manifestData;
        if (appInfo && typeof appInfo === 'object') Object.assign(merged, appInfo);
      }
      writeJson(path.join(dir, 'manifest.json'), merged);
    }

    if (data.editor_html !== undefined) writeText(path.join(dir, 'editor.html'), data.editor_html);
    if (data.editor_js !== undefined) writeText(path.join(dir, 'editor.js'), data.editor_js);
    if (data.storage_manifest !== undefined) {
      writeJson(path.join(dir, 'storage.json'),
        typeof data.storage_manifest === 'string' ? JSON.parse(data.storage_manifest) : data.storage_manifest);
    }
    if (data.interface_schema !== undefined) {
      writeJson(path.join(dir, 'interface.json'),
        typeof data.interface_schema === 'string' ? JSON.parse(data.interface_schema) : data.interface_schema);
    }
    if (data.control_manifest !== undefined) {
      writeJson(path.join(dir, 'control.json'),
        typeof data.control_manifest === 'string' ? JSON.parse(data.control_manifest) : data.control_manifest);
    }
  },

  /** 写入用户应用 */
  writeUser(username, appKey, data) {
    this._writeToDir(this.userDir(username, appKey), appKey, data);
  },

  /** 写入共享市场应用 */
  writeShared(appKey, data) {
    this._writeToDir(this.sharedDir(appKey), appKey, data);
  },

  /** 创建新应用（写入完整初始数据） */
  createUserApp(username, appKey, data) {
    const dir = this.userDir(username, appKey);
    ensureDir(dir);

    const now = data.created_at || nowStr();
    const manifest = {
      app_key: appKey,
      name: data.name || '',
      version: data.version || '1.0.0',
      description: data.description || '',
      category: data.category || '通用',
      status: 'draft',
      developer_username: username,
      is_shared: false,
      is_official: data.is_official ? true : false,
      forked_from: data.forked_from || null,
      forked_by: data.forked_by || null,
      created_at: now,
      updated_at: now,
      ...(data.app_info_manifest || {}),
    };
    writeJson(path.join(dir, 'manifest.json'), manifest);
    writeText(path.join(dir, 'editor.html'), data.editor_html || '');
    writeText(path.join(dir, 'editor.js'), data.editor_js || '');
    writeJson(path.join(dir, 'storage.json'), data.storage_manifest || { collections: [] });
    writeJson(path.join(dir, 'interface.json'), data.interface_schema || { endpoints: [] });
    writeJson(path.join(dir, 'control.json'), data.control_manifest || { enabled: false, protocolVersion: 1, supportedCommands: [], description: '' });
    return this._readFromDir(dir, appKey);
  },

  // ---- 删除 ----

  deleteApp(appKey) {
    const dir = this.findDir(appKey);
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  deleteUserApp(username, appKey) {
    const dir = this.userDir(username, appKey);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  // ---- 列表 ----

  /** 列出共享市场应用（is_shared = true） */
  listShared() {
    ensureDir(SHARED_APPS_DIR);
    const apps = [];
    if (!fs.existsSync(SHARED_APPS_DIR)) return apps;
    const entries = fs.readdirSync(SHARED_APPS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = this._readFromDir(path.join(SHARED_APPS_DIR, entry.name), entry.name);
      if (full && full.is_shared) apps.push(full);
    }
    apps.sort((a, b) => {
      if (a.is_official !== b.is_official) return b.is_official - a.is_official;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
    return apps;
  },

  /** 列出所有已发布应用（共享市场 + 用户已发布） */
  listPublished() {
    const apps = this.listShared().filter(a => a.status === 'published');
    // 也列出用户已发布且共享的应用
    if (fs.existsSync(DEV_USERS_DIR)) {
      const users = fs.readdirSync(DEV_USERS_DIR, { withFileTypes: true });
      for (const u of users) {
        if (!u.isDirectory()) continue;
        const userAppsDir = path.join(DEV_USERS_DIR, u.name, 'apps');
        if (!fs.existsSync(userAppsDir)) continue;
        const entries = fs.readdirSync(userAppsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const full = this._readFromDir(path.join(userAppsDir, entry.name), entry.name);
          if (full && full.status === 'published' && full.is_shared) {
            if (!apps.find(a => a.app_key === full.app_key)) apps.push(full);
          }
        }
      }
    }
    return apps;
  },

  /** 列出用户自己的应用 */
  listByUser(username) {
    const apps = [];
    const userAppsDir = path.join(DEV_USERS_DIR, username, 'apps');
    if (!fs.existsSync(userAppsDir)) return apps;
    const entries = fs.readdirSync(userAppsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = this._readFromDir(path.join(userAppsDir, entry.name), entry.name);
      if (full) apps.push(full);
    }
    apps.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return apps;
  },

  /** 列出所有应用（系统管理员） */
  listAll() {
    const apps = this.listShared();
    if (fs.existsSync(DEV_USERS_DIR)) {
      const users = fs.readdirSync(DEV_USERS_DIR, { withFileTypes: true });
      for (const u of users) {
        if (!u.isDirectory()) continue;
        const userApps = this.listByUser(u.name);
        for (const a of userApps) {
          if (!apps.find(x => x.app_key === a.app_key)) apps.push(a);
        }
      }
    }
    apps.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return apps;
  },

  /** 复制应用目录（用于 fork） */
  copyApp(srcAppKey, destUsername, destAppKey, overrides) {
    const srcDir = this.findDir(srcAppKey);
    if (!srcDir) throw new Error('源应用不存在');
    const destDir = this.userDir(destUsername, destAppKey);
    ensureDir(destDir);

    // 复制所有文件
    const files = fs.readdirSync(srcDir);
    for (const f of files) {
      const srcPath = path.join(srcDir, f);
      const destPath = path.join(destDir, f);
      fs.copyFileSync(srcPath, destPath);
    }

    // 更新 manifest
    const manifest = readJson(path.join(destDir, 'manifest.json')) || {};
    manifest.app_key = destAppKey;
    manifest.developer_username = destUsername;
    manifest.is_shared = false;
    manifest.is_official = false;
    if (overrides) Object.assign(manifest, overrides);
    const now = nowStr();
    manifest.created_at = now;
    manifest.updated_at = now;
    writeJson(path.join(destDir, 'manifest.json'), manifest);

    return this._readFromDir(destDir, destAppKey);
  },
};

// ========== 插件文件存储 ==========

const PluginFS = {
  // ---- 路径工具 ----

  sharedDir(pluginKey) {
    return path.join(SHARED_PLUGINS_DIR, pluginKey);
  },

  userDir(username, pluginKey) {
    return path.join(DEV_USERS_DIR, username, 'plugins', pluginKey);
  },

  findDir(pluginKey) {
    const shared = this.sharedDir(pluginKey);
    if (fs.existsSync(shared)) return shared;
    if (fs.existsSync(DEV_USERS_DIR)) {
      const users = fs.readdirSync(DEV_USERS_DIR, { withFileTypes: true });
      for (const u of users) {
        if (u.isDirectory()) {
          const userDir = this.userDir(u.name, pluginKey);
          if (fs.existsSync(userDir)) return userDir;
        }
      }
    }
    return null;
  },

  // ---- 读取 ----

  _readFromDir(dir, pluginKey) {
    if (!fs.existsSync(dir)) return null;
    const manifest = readJson(path.join(dir, 'manifest.json'));
    if (!manifest) return null;

    return {
      _id: stableId(manifest.plugin_key || pluginKey),
      plugin_key: manifest.plugin_key || pluginKey,
      name: manifest.name || '',
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      extensions: manifest.extensions || [],
      icon: manifest.icon || 'ri-plug-line',
      status: manifest.status || 'draft',
      developer_username: manifest.developer_username || '',
      is_official: manifest.is_official ? 1 : 0,
      created_at: manifest.created_at || '',
      updated_at: manifest.updated_at || '',
      editor_html: readText(path.join(dir, 'editor.html')),
      editor_js: readText(path.join(dir, 'editor.js')),
      editor_css: readText(path.join(dir, 'editor.css')),
    };
  },

  readShared(pluginKey) {
    return this._readFromDir(this.sharedDir(pluginKey), pluginKey);
  },

  readUser(username, pluginKey) {
    return this._readFromDir(this.userDir(username, pluginKey), pluginKey);
  },

  readByKey(pluginKey) {
    return this._readFromDir(this.findDir(pluginKey), pluginKey);
  },

  readMeta(pluginKey) {
    const dir = this.findDir(pluginKey);
    if (!dir) return null;
    const manifest = readJson(path.join(dir, 'manifest.json'));
    if (!manifest) return null;
    manifest._id = stableId(manifest.plugin_key || pluginKey);
    return manifest;
  },

  // ---- 写入 ----

  _writeToDir(dir, pluginKey, data) {
    ensureDir(dir);
    const existing = readJson(path.join(dir, 'manifest.json')) || {};
    const merged = { ...existing };

    if (data.name !== undefined) merged.name = data.name;
    if (data.version !== undefined) merged.version = data.version;
    if (data.description !== undefined) merged.description = data.description;
    if (data.extensions !== undefined) {
      merged.extensions = Array.isArray(data.extensions)
        ? data.extensions : (typeof data.extensions === 'string' ? JSON.parse(data.extensions) : []);
    }
    if (data.icon !== undefined) merged.icon = data.icon;
    if (data.status !== undefined) merged.status = data.status;
    if (data.developer_username !== undefined) merged.developer_username = data.developer_username;
    if (data.is_official !== undefined) merged.is_official = data.is_official ? true : false;
    if (data.updated_at !== undefined) merged.updated_at = data.updated_at;
    if (data.created_at !== undefined) merged.created_at = data.created_at;

    writeJson(path.join(dir, 'manifest.json'), merged);

    if (data.editor_html !== undefined) writeText(path.join(dir, 'editor.html'), data.editor_html);
    if (data.editor_js !== undefined) writeText(path.join(dir, 'editor.js'), data.editor_js);
    if (data.editor_css !== undefined) writeText(path.join(dir, 'editor.css'), data.editor_css);
  },

  writeUser(username, pluginKey, data) {
    this._writeToDir(this.userDir(username, pluginKey), pluginKey, data);
  },

  writeShared(pluginKey, data) {
    this._writeToDir(this.sharedDir(pluginKey), pluginKey, data);
  },

  createUserPlugin(username, pluginKey, data) {
    const dir = this.userDir(username, pluginKey);
    ensureDir(dir);
    const now = data.created_at || nowStr();
    const manifest = {
      plugin_key: pluginKey,
      name: data.name || '',
      version: data.version || '1.0.0',
      description: data.description || '',
      extensions: data.extensions || [],
      icon: data.icon || 'ri-plug-line',
      status: 'draft',
      developer_username: username,
      is_official: false,
      created_at: now,
      updated_at: now,
    };
    writeJson(path.join(dir, 'manifest.json'), manifest);
    writeText(path.join(dir, 'editor.html'), data.editor_html || '<div id="app"></div>');
    writeText(path.join(dir, 'editor.js'), data.editor_js || '// 自定义编辑器 JS');
    writeText(path.join(dir, 'editor.css'), data.editor_css || '');
    return this._readFromDir(dir, pluginKey);
  },

  // ---- 删除 ----

  deletePlugin(pluginKey) {
    const dir = this.findDir(pluginKey);
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  deleteUserPlugin(username, pluginKey) {
    const dir = this.userDir(username, pluginKey);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  // ---- 列表 ----

  listShared() {
    ensureDir(SHARED_PLUGINS_DIR);
    const plugins = [];
    if (!fs.existsSync(SHARED_PLUGINS_DIR)) return plugins;
    const entries = fs.readdirSync(SHARED_PLUGINS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = this._readFromDir(path.join(SHARED_PLUGINS_DIR, entry.name), entry.name);
      if (full) plugins.push(full);
    }
    plugins.sort((a, b) => {
      if (a.is_official !== b.is_official) return b.is_official - a.is_official;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
    return plugins;
  },

  listByUser(username) {
    const plugins = [];
    const userPluginsDir = path.join(DEV_USERS_DIR, username, 'plugins');
    if (!fs.existsSync(userPluginsDir)) return plugins;
    const entries = fs.readdirSync(userPluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = this._readFromDir(path.join(userPluginsDir, entry.name), entry.name);
      if (full) plugins.push(full);
    }
    plugins.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return plugins;
  },

  listAll() {
    const plugins = this.listShared();
    if (fs.existsSync(DEV_USERS_DIR)) {
      const users = fs.readdirSync(DEV_USERS_DIR, { withFileTypes: true });
      for (const u of users) {
        if (!u.isDirectory()) continue;
        const userPlugins = this.listByUser(u.name);
        for (const p of userPlugins) {
          if (!plugins.find(x => x.plugin_key === p.plugin_key)) plugins.push(p);
        }
      }
    }
    return plugins;
  },

  /** 列出所有已发布插件 */
  listPublished() {
    return this.listAll().filter(p => p.status === 'published');
  },

  /** 根据文件后缀解析插件 */
  resolveByExt(ext) {
    const published = this.listPublished();
    for (const p of published) {
      if (Array.isArray(p.extensions) && p.extensions.includes(ext)) {
        return p;
      }
    }
    return null;
  },
};

// ========== 初始化：确保目录存在 ==========

function initDirs() {
  ensureDir(DEV_DIR);
  ensureDir(SHARED_APPS_DIR);
  ensureDir(SHARED_PLUGINS_DIR);
  ensureDir(DEV_USERS_DIR);
}

module.exports = {
  AppFS,
  PluginFS,
  initDirs,
  stableId,
  DEV_DIR,
  DEV_USERS_DIR,
  SHARED_APPS_DIR,
  SHARED_PLUGINS_DIR,
};