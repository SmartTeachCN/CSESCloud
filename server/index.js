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

// ── 网页托管路由（/site/{slug}）——1:1 复刻 server.php ──
app.get(/^\/site\/([a-z0-9-]+)(\/.*)?$/i, (req, res) => {
  const slug = req.params[0];
  let filePath = req.params[1] || '/';

  const space = DB.one(
    'SELECT s.id, s.is_enabled FROM web_hosting_spaces s WHERE s.slug = ?',
    [slug]
  );

  const notFound = (msg) => {
    res.status(404).set('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>404</title></head><body><h1>404 - ${msg}</h1></body></html>`);
  };

  if (!space || !space.is_enabled) {
    res.status(404).set('Content-Type', 'text/html; charset=utf-8');
    res.end('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>未找到</title></head><body><h1>404 - 站点未找到</h1><p>该班级主页不存在或已被禁用。</p></body></html>');
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
  const rawContent = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? '');
  const contentLen = rawContent.length;
  const isText = /^(text\/|application\/(javascript|json|xml)|image\/svg)/.test(contentType);
  res.set('Content-Type', contentType + (isText ? '; charset=utf-8' : ''));
  res.set('Cache-Control', 'public, max-age=300');
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

app.listen(PORT, HOST, () => {
  console.log(`CSES Cloud API Server (NodeJS) listening on http://${HOST}:${PORT}`);
});
