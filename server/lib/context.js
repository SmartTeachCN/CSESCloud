/**
 * CSES Cloud - 请求上下文工厂
 *
 * 每个请求创建 ctx = { req, res, DB, Response, Helpers, Auth, query, files, moveUploadedFile }
 * 转换自 PHP 端点的代码可直接使用与 PHP 相同的调用形态。
 */
const fs = require('fs');
const DB = require('./db');
const { makeResponse, makeHelpers, HttpSent } = require('./response');
const { makeAuth } = require('./auth');

function makeCtx(req, res) {
  const ctx = {
    req,
    res,
    DB,
    Response: makeResponse(res),
    Helpers: makeHelpers(req),
    HttpSent,
    // PHP $_GET 等价
    query: req.query,
  };
  ctx.Auth = makeAuth(req, res);

  // PHP $_FILES 等价（由 multer 中间件装配；字段名 -> {name, tmp_name(Buffer), size, error, type}）
  ctx.files = req.phpFiles || {};
  Object.defineProperty(ctx, 'body', {
    get: () => (req.body && typeof req.body === 'object' ? req.body : {}),
  });

  /** move_uploaded_file 等价 */
  ctx.moveUploadedFile = (fileObj, destPath) => {
    if (!fileObj || !Buffer.isBuffer(fileObj.tmp_name)) return false;
    fs.mkdirSync(require('path').dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, fileObj.tmp_name);
    return true;
  };

  return ctx;
}

module.exports = { makeCtx };
