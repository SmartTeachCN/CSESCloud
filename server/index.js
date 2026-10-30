/**
 * CSES Cloud - NodeJS 后端服务入口（1:1 复刻 server.php 路由）
 *
 * 开发模式：仅处理 /api/ 请求（前端由 Vite 开发服务器代理）
 * 生产模式：处理 /api/ 请求 + 提供 dist/ 静态文件（SPA 回退）
 *
 * 启动：
 *   node server/index.js            （默认 127.0.0.1:8000）
 *   PORT=9000 HOST=0.0.0.0 node server/index.js
 */
const express = require('express');
const multer = require('multer');
const qs = require('qs');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const API_DIR = path.join(__dirname, 'api');
const DIST_DIR = path.join(ROOT, 'dist');

const DB = require('./lib/db');
const { makeCtx } = require('./lib/context');
const { HttpSent } = require('./lib/response');

const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');

// ── 请求体解析（对齐 PHP 语义） ──
// multipart：$_FILES（tmp_name 为 Buffer）+ 文本字段进 $_POST
// urlencoded / JSON / 无类型：PHP 的 jsonBody(php://input) 与 $_POST 行为
const upload = multer({ storage: multer.memoryStorage() });

app.use((req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();

  if (ct.includes('multipart/form-data')) {
    upload.any()(req, res, (err) => {
      // multipart 解析失败时静默降级为无文件（保持 JSON 流程可用）
      if (err) console.warn('[upload] multipart 解析警告:', err.message);
      req.phpFiles = {};
      for (const f of req.files || []) {
        req.phpFiles[f.fieldname] = {
          name: f.originalname,
          tmp_name: f.buffer,
          size: f.size,
          type: f.mimetype,
          error: err ? 1 : 0,
        };
      }
      next();
    });
    return;
  }

  // 非 multipart：手动读取原始 body
  const chunks = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const raw = Buffer.concat(chunks);
    req.rawBody = raw;
    req.body = {};
    if (raw.length) {
      if (ct.includes('application/x-www-form-urlencoded')) {
        try { req.body = qs.parse(raw.toString('utf8'), { depth: 5 }); } catch (_) {}
      } else {
        const s = raw.toString('utf8').trim();
        if (s.startsWith('{') || s.startsWith('[')) {
          try { req.body = JSON.parse(s); } catch (_) { req.body = {}; }
        }
      }
    }
    next();
  };
  req.on('data', (c) => chunks.push(c));
  req.on('end', finish);
  req.on('error', finish);
  req.on('close', finish);
});

// ── 初始化数据库（首次自动建表 + seed） ──
DB.pdo();

// ── 初始化开发者中心文件系统目录 ──
try {
  const { initDirs, AppFS, PluginFS, DEV_USERS_DIR } = require('./lib/dev-fs');
  const fs = require('fs');
  const path = require('path');
  initDirs();

  // 一次性迁移：将 data/dev/apps/ 中非共享的用户应用迁移到 data/dev-users/
  const SHARED_APPS_DIR = path.join(__dirname, '..', 'data', 'dev', 'apps');
  const SHARED_PLUGINS_DIR = path.join(__dirname, '..', 'data', 'dev', 'plugins');
  if (fs.existsSync(SHARED_APPS_DIR)) {
    const entries = fs.readdirSync(SHARED_APPS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const appKey = entry.name;
      const app = AppFS.readShared(appKey);
      if (!app || !app.developer_username) continue;
      // 共享应用保留在 data/dev/apps/ 中
      if (app.is_shared) continue;
      // 用户应用迁移到 data/dev-users/{username}/apps/
      const srcDir = AppFS.sharedDir(appKey);
      const destDir = AppFS.userDir(app.developer_username, appKey);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.renameSync(srcDir, destDir);
        console.log(`[dev-fs] 已迁移用户应用: ${appKey} → ${app.developer_username}`);
      }
    }
  }
  if (fs.existsSync(SHARED_PLUGINS_DIR)) {
    const entries = fs.readdirSync(SHARED_PLUGINS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginKey = entry.name;
      const plugin = PluginFS.readShared(pluginKey);
      if (!plugin || !plugin.developer_username) continue;
      // 官方插件保留
      if (plugin.is_official) continue;
      // 用户插件迁移
      const srcDir = PluginFS.sharedDir(pluginKey);
      const destDir = PluginFS.userDir(plugin.developer_username, pluginKey);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.renameSync(srcDir, destDir);
        console.log(`[dev-fs] 已迁移用户插件: ${pluginKey} → ${plugin.developer_username}`);
      }
    }
  }
  console.log('[dev-fs] 文件系统目录已初始化');
} catch (e) {
  console.warn('[dev-fs] 初始化跳过:', e.message);
}

// ── 回填现有实例的 app_key（从旧 apps 表映射） ──
try {
  const cnt = DB.pdo().prepare(
    "UPDATE instances SET app_key = (SELECT a.app_key FROM apps a WHERE a.id = instances.app_id) WHERE app_key IS NULL AND app_id IS NOT NULL AND app_id > 0"
  ).run();
  if (cnt.changes > 0) console.log(`[db] 已回填 ${cnt.changes} 个实例的 app_key`);
} catch (e) {
  console.warn('[db] app_key 回填跳过:', e.message);
}

// ── API 路由（/api/{path} 与 /api/{path}.php 均映射到 server/api/{path}.js） ──
const apiRouter = express.Router();

apiRouter.all(/.*/, (req, res) => {
  let apiPath = req.path.replace(/^\/+/, '');
  if (apiPath.endsWith('.php')) apiPath = apiPath.slice(0, -4);

  // 防目录穿越
  const handlerFile = path.normalize(path.join(API_DIR, apiPath + '.js'));
  if (!handlerFile.startsWith(API_DIR) || !fs.existsSync(handlerFile) || !fs.statSync(handlerFile).isFile()) {
    res.status(404).json({ code: 404, message: 'API 端点不存在' });
    return;
  }

  let handler;
  try {
    handler = require(handlerFile);
  } catch (e) {
    console.error(`[api] 加载失败 ${apiPath}:`, e);
    res.status(500).json({ code: 500, message: '服务端错误: ' + e.message, data: null });
    return;
  }

  const ctx = makeCtx(req, res);
  Promise.resolve()
    .then(() => handler(ctx))
    .catch((e) => {
      if (e instanceof HttpSent || e?.isHttpSent) return; // Response.json 已终止
      console.error(`[api] ${req.method} /api/${apiPath}:`, e);
      if (!res.headersSent) {
        res.status(500).json({ code: 500, message: '服务端错误: ' + (e?.message || e), data: null });
      } else {
        try { res.end(); } catch (_) {}
      }
    });
});
app.use('/api', apiRouter);

// ── 导出文件静态目录（/exports） ──
app.use('/exports', express.static(path.join(ROOT, 'exports'), { fallthrough: true }));

// ── 静态集控公开接口（ClassIsland 2.0 集控协议，无需登录） ──
// /classisland/manifest.php  → 集控清单
// /classisland/file.php      → 六类数据源（ClassPlans / TimeLayouts / Subjects / Settings / Policy / Credentials）
// /control/file.php          → 旧地址兼容（format=ci）
try {
  const staticControlPublic = require('./lib/static-control-public');
  app.get(['/classisland/manifest.php', '/classisland/manifest'], staticControlPublic.manifestHandler);
  app.get(['/classisland/file.php', '/classisland/file'], staticControlPublic.fileHandler);
  app.get(['/control/file.php', '/control/file'], staticControlPublic.controlFileHandler);
  console.log('[static-control] 静态集控接口已挂载 (/classisland/manifest.php, /classisland/file.php)');
} catch (e) {
  console.warn('[static-control] 静态集控接口挂载失败:', e.message);
}

// ── 网页托管路由（/site/{slug}）——1:1 复刻 server.php ──
app.get(/^\/site\/([a-z0-9-]+)(\/.*)?$/i, (req, res) => {
  const slug = req.params[0];
  let filePath = req.params[1] || '/';
  const previewMode = req.query.preview === '1';

  const space = DB.one(
    'SELECT s.* FROM web_hosting_spaces s WHERE s.slug = ?',
    [slug]
  );

  const notFound = (msg) => {
    res.status(404).set('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>404</title></head><body><h1>404 - ${msg}</h1></body></html>`);
  };

  if (!space) {
    notFound('站点未找到');
    return;
  }

  // 检查是否被管理员禁用
  if (space.disabled_by_admin) {
    res.status(403).set('Content-Type', 'text/html; charset=utf-8');
    const reason = space.disabled_reason ? `<p>原因：${space.disabled_reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : '';
    res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>空间已停用 - ${slug}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#fff;border-radius:12px;padding:40px 32px;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:480px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px;color:#C42B1C}h1{color:#1a1a1a;font-size:22px;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.6}.tag{display:inline-block;background:rgba(196,43,28,0.1);color:#C42B1C;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:500;margin-top:16px}.reason{margin-top:8px;color:#999;font-size:13px}</style></head>
<body><div class="card"><div class="icon">&#x1F6AB;</div><h1>此网页空间已被管理员停用</h1><p>该空间因违反相关规定已被管理员暂停访问权限。</p>${reason}<div class="tag">已被管理员停用</div></div></body></html>`);
    return;
  }

  // 检查用户是否启用了空间
  if (!space.is_enabled) {
    res.status(404).set('Content-Type', 'text/html; charset=utf-8');
    res.end('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>未找到</title></head><body><h1>404 - 站点未找到</h1><p>该站点已被其所有者关闭。</p></body></html>');
    return;
  }

  // 标准化文件路径
  filePath = '/' + String(filePath).replace(/^\/+|\/+$/g, '');
  if (filePath === '' || filePath === '/') {
    filePath = '/index.html';
  }

  // 阻止访问隐藏目录（/.cloud/ 等）
  if (/\/\./.test(filePath)) {
    notFound('文件未找到');
    return;
  }

  // 查找文件
  let file = DB.one(
    'SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0',
    [space.id, filePath]
  );

  if (!file) {
    // 尝试用 index.html 作为目录索引
    let dirPath = filePath;
    if (dirPath !== '/') dirPath = dirPath.replace(/\/+$/, '');
    const indexPath = dirPath + '/index.html';
    file = DB.one(
      'SELECT * FROM web_hosting_files WHERE space_id = ? AND file_path = ? AND is_directory = 0',
      [space.id, indexPath]
    );
  }

  if (!file) {
    notFound('文件未找到');
    return;
  }

  const contentType = file.content_type || 'application/octet-stream';
  const isText = /^(text\/|application\/(javascript|json|xml)|image\/svg)/.test(contentType);

  // 判断是否为审查中的待审核版本
  const isPending = file.review_status === 'pending_review';
  // 审核中且非预览模式：仅显示已公开版本
  if (isPending && !previewMode) {
    const publishedContent = file.published_content;
    const hasPublished = publishedContent !== null && publishedContent !== undefined;
    const rawContent = hasPublished
      ? (Buffer.isBuffer(publishedContent) ? publishedContent : Buffer.from(publishedContent))
      : Buffer.from('');
    const contentLen = rawContent.length;
    res.set('Content-Type', contentType + (isText ? '; charset=utf-8' : ''));
    res.set('Cache-Control', 'no-cache');
    res.set('X-Review-Status', 'pending_review');
    if (isText) {
      let html = rawContent.toString('utf8');
      const updatedAt = file.updated_at || '';
      const bannerText = hasPublished
        ? `&#x26A0; 已于 ${updatedAt} 编辑，新版本待管理员审查，当前显示已公开版本`
        : `&#x26A0; 此页面尚未通过审查，暂无公开版本`;
      const banner = `
<!-- CSES Cloud Review Banner -->
<div id="cses-review-banner" style="position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#fef3c7,#fde68a);border-bottom:2px solid #f59e0b;padding:10px 16px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#92400e;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <span style="font-weight:600">${bannerText}</span>
  ${hasPublished ? `<span style="margin:0 8px;color:#d97706">|</span><span>当前版本修改时间：${updatedAt}</span><span style="margin:0 8px;color:#d97706">|</span><a href="?preview=1" style="color:#b45309;font-weight:600;text-decoration:underline">查看最新版本（仅编辑者）</a>` : ''}
</div>
<script>document.body.style.marginTop=(document.getElementById('cses-review-banner')?.offsetHeight||44)+'px';</script>`;
      if (html.includes('</head>')) {
        html = html.replace('</head>', '<style>body{margin-top:44px}</style></head>');
      } else if (html.includes('<body')) {
        html = html.replace(/<body[^>]*>/, '$&' + banner);
      } else {
        html = banner + html;
      }
      res.end(html);
    } else {
      res.end(rawContent);
    }
    return;
  }

  // 使用最新内容（已发布或预览模式）
  const rawContent = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? '');
  const contentLen = rawContent.length;
  res.set('Content-Type', contentType + (isText ? '; charset=utf-8' : ''));
  res.set('Cache-Control', 'public, max-age=300');
  if (isPending && previewMode) {
    res.set('X-Review-Status', 'preview');
  }
  res.set('X-Debug-Size', contentLen + ' bytes');
  if (contentLen === 0 && isText) {
    const esc = filePath.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>空文件</title></head><body><h1>文件内容为空</h1><p>该文件（${esc}）内容为空。</p></body></html>`);
  } else {
    res.end(rawContent);
  }
});

// ── 生产模式：提供 dist/ 静态文件（npm run build 的输出目录） ──
const mimeTypes = {
  html: 'text/html', css: 'text/css', js: 'application/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', ico: 'image/x-icon', woff2: 'font/woff2',
};

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const uri = req.path === '' ? '/' : req.path;
  // 如果请求的是具体文件且存在，直接返回
  const filePath = path.join(DIST_DIR, uri);
  if (uri !== '/' && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // SPA 回退：所有非 API 请求返回 index.html
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  // 如果没有 dist 目录（开发模式），返回提示
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send('CSES Cloud API Server\n开发模式：前端由 Vite 开发服务器提供，请通过 Vite 端口访问\n');
});

const server = app.listen(PORT, HOST, () => {
  console.log(`CSES Cloud API Server (NodeJS) listening on http://${HOST}:${PORT}`);
});
