/** 数据导出 API */
const fs = require('fs');
const path = require('path');
const { nowStr } = require('../lib/response');

const ROOT = path.join(__dirname, '..', '..');

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  if (method === 'GET' && action === 'history') {
    Response.success(DB.all("SELECT * FROM data_exports WHERE school_id = ? ORDER BY id DESC LIMIT 50", [schoolId]));
  }

  if (method === 'POST' && action === 'export') {
    const type = b.type ?? '';
    const format = b.format ?? 'csv';
    const validTypes = { '班级数据': 'classes', '学生数据': 'students', '服务数据': 'services', '子用户数据': 'users' };
    if (!(type in validTypes)) Response.error('无效的导出类型');

    const tableName = validTypes[type];
    const rows = DB.all(`SELECT * FROM ${tableName} WHERE school_id = ?`, [schoolId]);

    // 生成文件内容
    let content = '';
    const ts = nowStr();
    const stamp = ts.slice(0, 4) + ts.slice(5, 7) + ts.slice(8, 10) + '_' + ts.slice(11, 13) + ts.slice(14, 16) + ts.slice(17, 19);
    const filename = type + '_' + stamp + '.' + format;
    const filepath = '/exports/' + filename;

    if (format === 'json') {
      content = JSON.stringify(rows, null, 4);
    } else {
      // CSV / Excel 均输出 CSV
      if (!Helpers.empty(rows)) {
        const headers = Object.keys(rows[0]);
        // BOM + 表头
        content = '\uFEFF' + headers.join(',') + "\n";
        for (const row of rows) {
          const line = [];
          for (const h of headers) {
            let val = row[h] ?? '';
            val = String(val).replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, ' ');
            line.push('"' + val + '"');
          }
          content += line.join(',') + "\n";
        }
      }
    }

    // 保存到 public/exports 目录（可直接通过 HTTP 下载）
    const exportsDir = path.join(ROOT, 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(path.join(exportsDir, filename), content);

    const id = DB.insert('data_exports', {
      school_id: schoolId,
      user_id: (Auth.user() || {}).user_id ?? 0,
      type: type,
      format: format,
      status: 'completed',
      file_path: filepath,
      created_at: nowStr(),
    });
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'export', `导出 ${type}`);

    Response.success({ id, download_url: '/exports/' + encodeURIComponent(filename), filename }, '导出成功');
  }

  Response.error('未知的操作');
};