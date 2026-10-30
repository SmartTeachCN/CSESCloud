/**
 * 公开配置与静态集控接口（Express handler，无需登录）。
 *
 * 由 `server/index.js` 挂载：
 *   - GET /classisland/manifest?id=<实例组标识>             ClassIsland 2.0 静态集控清单
 *   - GET /classisland/file?id=<实例组标识>/<实例标识>&key=  六类数据源
 *   - GET /config/<实例组标识>/<实例标识>.<扩展名>            CSES / ExamAware 原始配置
 *
 * 约定：
 *   - 成功：对应 Content-Type（JSON / YAML / 原始文本），原始内容，无 `{code}` 包装；
 *   - 失败：HTTP 400/404 + `{ "error": "中文错误信息" }`；
 *   - `Cache-Control: no-store`、`Access-Control-Allow-Origin: *`；
 *   - 基础地址优先取 `X-Forwarded-Proto` / `X-Forwarded-Host`。
 *
 * 所有地址均使用 NodeJS 原生路径。
 */
'use strict';

const DB = require('./db');
const convert = require('./classisland-convert');
const formats = require('./distribution-formats');
const apps = require('../apps');
const rawConfig = require('../apps/lib/raw-config');

// ────────────────────────────── HTTP 辅助 ──────────────────────────────

function headerFirst(value) {
  if (value === undefined || value === null) return '';
  const raw = Array.isArray(value) ? value[0] : String(value);
  return raw.split(',')[0].trim();
}

/** 由当前请求推导站点根地址（不含末尾斜杠）。 */
function baseUrlFromRequest(req) {
  const headers = (req && req.headers) || {};
  const forwardedProto = headerFirst(headers['x-forwarded-proto']);
  const protoRaw = forwardedProto || (req && req.protocol) || 'http';
  const proto = String(protoRaw).toLowerCase().indexOf('https') === 0 ? 'https' : 'http';

  let host = headerFirst(headers['x-forwarded-host']) || headerFirst(headers.host);
  host = host.replace(/[^A-Za-z0-9.\-:\[\]]/g, '');
  if (host === '') host = 'cloud.smart-teach.cn';

  return proto + '://' + host;
}

/** 输出原始响应。 */
function sendBody(res, status, contentType, body, options) {
  const opts = options || {};
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.status(status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Length', payload.length);
  if (opts.contentDisposition) res.setHeader('Content-Disposition', opts.contentDisposition);
  res.end(payload);
}

/** 输出 JSON 响应（原始 JSON，无 {code} 包装）。 */
function sendJson(res, status, data) {
  sendBody(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

/** 输出错误 JSON。 */
function sendError(res, status, message, extra) {
  const payload = { error: String(message) };
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) payload[key] = value;
  }
  sendJson(res, status, payload);
}

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

function internalError(res, scope, err) {
  console.error('[public-config] ' + scope + ' 失败:', err);
  return sendError(res, 500, '服务器内部错误：' + (err && err.message ? err.message : err));
}

function queryString(req, key) {
  const query = (req && req.query) || {};
  const value = query[key];
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? String(value[0] ?? '') : String(value);
}

function splitInstancePath(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw);
  const index = text.indexOf('/');
  if (index <= 0 || index === text.length - 1) return null;
  return { dirId: text.slice(0, index), instanceId: text.slice(index + 1) };
}

// ────────────────────────────── handlers ──────────────────────────────

/** ClassIsland 静态集控清单。 */
function manifestHandler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const dirId = queryString(req, 'id');
    if (!convert.validDirId(dirId)) return sendError(res, 400, '缺少或非法的实例组标识（id）');

    const app = apps.get('classisland');
    if (!app) return sendError(res, 500, '静态集控云应用未注册');
    const result = app.manifest(DB, dirId, baseUrlFromRequest(req) + '/classisland/file');
    if (result.error) return sendError(res, result.status || 404, result.error);

    return sendJson(res, 200, result.json);
  } catch (err) {
    return internalError(res, 'classisland-manifest', err);
  }
}

/** ClassIsland 六类数据源。 */
function fileHandler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const idRaw = queryString(req, 'id');
    const key = queryString(req, 'key');

    if (idRaw === '') return sendError(res, 400, '缺少实例参数（id）');
    const parts = splitInstancePath(idRaw);
    if (!parts) return sendError(res, 400, '实例参数格式应为「实例组标识/实例标识」');

    const app = apps.get('classisland');
    if (!app) return sendError(res, 500, '静态集控云应用未注册');
    const result = app.payload(DB, parts.dirId, parts.instanceId, key);
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
    return internalError(res, 'classisland-file', err);
  }
}

/** CSES / ExamAware 原始配置。 */
function rawConfigHandler(req, res) {
  if (handlePreflight(req, res)) return;
  try {
    const dirId = String((req.params && req.params.dirId) || '');
    const fileName = String((req.params && req.params.fileName) || '');
    if (fileName === '') return sendError(res, 400, '缺少实例标识');

    const result = rawConfig.resolvePublic(DB, dirId, fileName);
    if (result.error) return sendError(res, result.status || 404, result.error);

    const contentType = formats.contentTypeOf(result.ext);
    const downloadName = String(result.instance.name || 'config') + formats.dotExt(result.ext);
    return sendBody(res, 200, contentType, result.text, {
      contentDisposition: "inline; filename*=UTF-8''" + encodeURIComponent(downloadName),
    });
  } catch (err) {
    return internalError(res, 'raw-config', err);
  }
}

/** 挂载到 Express app（可选便捷入口）。 */
function register(app) {
  app.get('/classisland/manifest', manifestHandler);
  app.get('/classisland/file', fileHandler);
  app.get('/config/:dirId/:fileName', rawConfigHandler);
}

module.exports = {
  manifestHandler,
  fileHandler,
  rawConfigHandler,
  register,
  baseUrlFromRequest,
  sendJson,
  sendError,
  sendBody,
};
