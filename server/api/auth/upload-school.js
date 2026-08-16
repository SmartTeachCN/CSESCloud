// 上传学校申请 - 接收学校申请并保存到数据库
module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;

  res.set('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.status(405);
    res.end(JSON.stringify({ code: 405, message: '仅支持 POST 请求' }));
    throw new ctx.HttpSent();
  }

  let b = {};
  try { b = JSON.parse(req.rawBody?.toString('utf8') ?? '') || {}; } catch (_) { b = {}; }
  const name = String(b.name ?? '').trim();
  const contact = String(b.contact ?? '').trim();
  const phone = String(b.phone ?? '').trim();
  const description = String(b.description ?? '').trim();

  if (name === '') {
    res.status(400);
    res.end(JSON.stringify({ code: 400, message: '学校名称不能为空' }));
    throw new ctx.HttpSent();
  }

  try {
    // 自动建表（若不存在）
    DB.pdo().exec(`CREATE TABLE IF NOT EXISTS school_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT,
        phone TEXT,
        description TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);
    DB.insert('school_applications', { name, contact, phone, description });
    res.end(JSON.stringify({ code: 0, message: '申请已提交' }));
  } catch (e) {
    res.status(500);
    res.end(JSON.stringify({ code: 500, message: '提交失败：' + (e?.message || String(e)) }));
  }
};