/** 头像文件服务 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  const file = query.file ?? '';
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    res.status(400);
    res.end();
    throw new ctx.HttpSent();
  }

  const filePath = path.join(ROOT, 'data', 'avatars', file);
  if (!fs.existsSync(filePath)) {
    res.status(404);
    res.end();
    throw new ctx.HttpSent();
  }

  const ext = path.extname(file).slice(1).toLowerCase();
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
  };
  const mime = mimeTypes[ext] ?? 'application/octet-stream';

  res.set('Content-Type', mime);
  res.set('Content-Length', fs.statSync(filePath).size);
  res.set('Cache-Control', 'public, max-age=86400');
  res.end(fs.readFileSync(filePath));
};