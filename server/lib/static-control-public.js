/**
 * 公开静态集控路由（ClassIsland 静态集控协议）—— Express handler。
 *
 * 由 `server/index.js` 挂载（见文件末尾注释中的路由清单）：
 *   - `manifestHandler`      GET /classisland/manifest.php  /classisland/manifest
 *   - `fileHandler`          GET /classisland/file.php      /classisland/file
 *   - `controlFileHandler`   GET /control/file.php          /control/file（format=ci 兼容）
 *
 * 约定（与 PHP 参考实现一致）：
 *   - 成功：`application/json; charset=utf-8`，原始 JSON（无 `{code}` 包装）；
 *   - 失败：HTTP 400/404 + `{ "error": "中文错误信息" }`；
 *   - `Cache-Control: no-store`、`Access-Control-Allow-Origin: *`；
 *   - 基础地址优先取 `X-Forwarded-Proto` / `X-Forwarded-Host`，否则 `req.protocol` / Host。
 */
'use strict';

const DB = require('./db');
const convert = require('./classisland-convert');
const staticControlApp = require('../apps/cses-static-control');

// ────────────────────────────── HTTP 辅助 ──────────────────────────────

/** 取请求头首个值（兼容数组 / 逗号分隔）。 */
function headerFirst(value) {
  if (value === undefined || value === null) return '';
  const raw = Array.isArray(value) ? value[0] : String(value);
  return raw.split(',')[0].trim();
}

/**
 * 由当前请求推导站点根地址（不含末尾斜杠），避免写死域名。
 * 与 PHP `cses_ci_base_url()` 等价，并支持反向代理的 X-Forwarded-* 头。
 */
function baseUrlFromRequest(req) {
  const headers = (req && req.headers) || {};
  const forwardedProto = headerFirst(headers['x-forwarded-proto']);
  const protoRaw = forwardedProto || (req && req.protocol) || 'http';
  const proto = String(protoRaw).toLowerCase().indexOf('https') === 0 ? 'https' : 'http';

  let host = headerFirst(headers['x-forwarded-host']) || headerFirst(headers.host);
  host = host.replace(/[^A-Za-z0-9.\-:\[\]]/g, ''); // 与 PHP 端同样的过滤
  if (host === '') host = 'cloud.smart-teach.cn';

  return proto + '://' + host;
}

/** 输出 JSON 响应（原始 JSON，无 {code} 包装）。 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Forwarded-Proto, X-Forwarded-Host');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

/** 输出错误 JSON：`{ error }`（可附加 validKeys 等字段）。 */
function sendError(res, status, message, extra) {
  const payload = { error: String(message) };
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) payload[key] = value;
  }
  sendJson(res, status, payload);
}

/** CORS 预检请求直接返回 204。 */
function handlePreflight(req, res) {
  if (!req || String(req.method || '').toUpperCase() !== 'OPTIONS') return false;
  res.status(204);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Length', '0');
  res.end();
  return true;
}

/** 内部异常统一转 JSON（避免公开接口返回 HTML 500）。 */
function internalError(res, scope, err) {
  console.error('[static-control] ' + scope + ' 失败:', err);
  return sendError(res, 500, '服务器内部错误：' + (err && err.message ? err.message : err));
}

/** 读取 query 字符串参数（兼容 undefined / 数组）。 */
function queryString(req, key) {
  const query = (req && req.query) || {};
  const value = query[key];
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? String(value[0] ?? '') : String(value);
}

/** 解析 `实例组标识/实例标识`（等价 PHP explode('/', $id, 2) 且两段非空）。 */
function splitInstancePath(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw);
  const index = text.indexOf('/');
  if (index <= 0 || index === text.length - 1) return null;
  return { dirId: text.slice(0, index), instanceId: text.slice(index + 1) };
}

// ────────────────────────────── handlers ──────────────────────────────

/**
 * 集控清单：GET /classisland/manifest.php?id=<实例组标识>
 * 对应 CsesWebEditor `classisland/manifest.php`。
 */
function manifestHandler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const dirId = queryString(req, 'id');
    if (!convert.validDirId(dirId)) {
      return sendError(res, 400, '缺少或非法的实例组标识（id）');
    }

    const result = staticControlApp.manifest(
      DB,
      dirId,
      baseUrlFromRequest(req) + '/classisland/file.php'
    );
    if (result.error) return sendError(res, result.status || 404, result.error);

    return sendJson(res, 200, result.json);
  } catch (err) {
    return internalError(res, 'manifest', err);
  }
}

/**
 * 数据源：GET /classisland/file.php?id=<实例组标识>/<实例标识>&key=<数据源>
 * 对应 CsesWebEditor `classisland/file.php`。
 */
function fileHandler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const idRaw = queryString(req, 'id');
    const key = queryString(req, 'key');

    if (idRaw === '') return sendError(res, 400, '缺少实例参数（id）');
    const parts = splitInstancePath(idRaw);
    if (!parts) return sendError(res, 400, '实例参数格式应为「实例组标识/实例标识」');

    const result = staticControlApp.payload(DB, parts.dirId, parts.instanceId, key);
    if (result.error) {
      return sendError(
        res,
        result.status || 404,
        result.error,
        result.validKeys ? { validKeys: result.validKeys } : null
      );
    }

    return sendJson(res, 200, result.json);
  } catch (err) {
    return internalError(res, 'file', err);
  }
}

/**
 * 旧地址兼容：GET /control/file.php?format=ci&id=<实例组标识>/<实例标识>&key=<数据源>
 * 不带 key 时按 `control/ci-config.json` 的模板返回集控清单（数据源地址指向 /control/file.php）。
 */
function controlFileHandler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const format = queryString(req, 'format') || 'ci';
    if (format !== 'ci') return sendError(res, 400, '不支持或缺少数据格式（format）');

    const idRaw = queryString(req, 'id');
    if (idRaw === '') return sendError(res, 400, '缺少实例参数（id）');
    const key = queryString(req, 'key');

    if (key !== '') {
      const parts = splitInstancePath(idRaw);
      if (!parts) return sendError(res, 400, '实例参数格式应为「实例组标识/实例标识」');

      const result = staticControlApp.payload(DB, parts.dirId, parts.instanceId, key);
      if (result.error) {
        return sendError(
          res,
          result.status || 404,
          result.error,
          result.validKeys ? { validKeys: result.validKeys } : null
        );
      }
      return sendJson(res, 200, result.json);
    }

    // 无 key：返回清单（对应 ci-config.json 的 manifestTemplete）
    const dirId = idRaw.split('/')[0];
    if (!convert.validDirId(dirId)) {
      return sendError(res, 400, '缺少或非法的实例组标识（id）');
    }
    const result = staticControlApp.manifest(
      DB,
      dirId,
      baseUrlFromRequest(req) + '/control/file.php',
      { extraQuery: 'format=ci' }
    );
    if (result.error) return sendError(res, result.status || 404, result.error);

    return sendJson(res, 200, result.json);
  } catch (err) {
    return internalError(res, 'control-file', err);
  }
}

/**
 * 把三组公开路由挂到 Express 应用上（可选便捷函数）。
 * 等价于在 `server/index.js` 中逐个 app.get，挂载位置应在 SPA 静态回退之前。
 */
function register(app) {
  app.get(['/classisland/manifest.php', '/classisland/manifest'], manifestHandler);
  app.get(['/classisland/file.php', '/classisland/file'], fileHandler);
  app.get(['/control/file.php', '/control/file'], controlFileHandler);
}

module.exports = {
  manifestHandler,
  fileHandler,
  controlFileHandler,
  register,
  // 供 server/index.js 挂载与 server/api/distributions.js 复用
  baseUrlFromRequest,
  sendJson,
  sendError,
};

/*
 * server/index.js 需要挂载的路由（放在 SPA 静态回退之前），二选一：
 *
 *   // 方式一：一行挂载
 *   require('./lib/static-control-public').register(app);
 *
 *   // 方式二：手动挂载
 *   const staticControlPublic = require('./lib/static-control-public');
 *   app.get(['/classisland/manifest.php', '/classisland/manifest'], staticControlPublic.manifestHandler);
 *   app.get(['/classisland/file.php', '/classisland/file'], staticControlPublic.fileHandler);
 *   app.get(['/control/file.php', '/control/file'], staticControlPublic.controlFileHandler);
 */
