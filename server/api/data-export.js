/** 数据导出 API */
const fs = require('fs');
const path = require('path');
const { nowStr } = require('../lib/response');

const ROOT = path.join(__dirname, '..', '..');

// ── 极简 ZIP 写入器（STORE 无压缩，兼容 Windows Explorer / unzip） ──
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function msDosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** entries: [{ path, data(Buffer) }]，输出 ZIP Buffer */
function buildZip(entries) {
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = enc.encode(e.path);
    const data = e.data;
    const crc = crc32(data);
    const { time, date } = msDosDateTime(new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const lh = Buffer.concat([local, nameBuf, data]);
    localParts.push(lh);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuf]));
    offset += lh.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

/** 规范化相对路径（防目录穿越 + 非法字符），返回用 / 连接的相对路径，如 'dir/name.txt' */
function sanitizeRelPath(p) {
  const segs = String(p || '')
    .split(/[\\/]+/)
    .filter((s) => s && s !== '.' && s !== '..');
  return segs.map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim() || '_').join('/');
}

/** 统一转为 Buffer（保留二进制，避免文本化破坏上传文件） */
function toBuffer(v) {
  if (v === null || v === undefined) return Buffer.from([]);
  if (Buffer.isBuffer(v)) return v;
  return Buffer.from(String(v), 'utf8');
}

function blobText(v) {
  return Buffer.isBuffer(v) ? v.toString('utf8') : v;
}

/** 按来源读取单个文件内容，返回 Buffer；文件不存在返回 null */
function readEntryContent(ctx, item) {
  const { DB } = ctx;
  const source = item.source;
  const username = item._username;
  const schoolId = item._schoolId;

  if (source === 'instance_config') {
    const inst = DB.one('SELECT config FROM instances WHERE id = ? AND school_id = ?', [item.instance_id, schoolId]);
    if (!inst) return null;
    return toBuffer(inst.config ?? '{}');
  }
  if (source === 'instance_file') {
    const file = DB.one(
      'SELECT cf.* FROM cloud_files cf JOIN instances i ON i.id = cf.instance_id WHERE cf.id = ? AND i.school_id = ?',
      [item.file_id, schoolId]
    );
    if (!file) return null;
    return toBuffer(file.content);
  }
  if (source === 'cloud_file') {
    const file = DB.one(
      "SELECT * FROM web_hosting_files WHERE id = ? AND file_path LIKE '/.cloud/%' AND space_id = (SELECT id FROM web_hosting_spaces WHERE alliance_username = ?)",
      [item.file_id, username]
    );
    if (!file) return null;
    return toBuffer(file.content);
  }
  if (source === 'webspace_config') {
    const ws = DB.one('SELECT * FROM web_hosting_spaces WHERE id = ? AND alliance_username = ? AND is_web_space = 1', [item.space_id, username]);
    if (!ws) return null;
    return toBuffer(JSON.stringify({
      title: ws.title, description: ws.description, slug: ws.slug, is_enabled: ws.is_enabled,
    }, null, 2));
  }
  if (source === 'webspace_file') {
    const file = DB.one(
      'SELECT whf.* FROM web_hosting_files whf JOIN web_hosting_spaces whs ON whs.id = whf.space_id WHERE whf.id = ? AND whs.alliance_username = ?',
      [item.file_id, username]
    );
    if (!file) return null;
    return toBuffer(file.content);
  }
  if (source === 'version_record') {
    const v = DB.one('SELECT * FROM cloud_file_versions WHERE id = ? AND created_by = ?', [item.version_id, username]);
    if (!v) return null;
    return toBuffer(v.content ?? '(内容已归档)');
  }
  if (source === 'history_record') {
    const h = DB.one('SELECT * FROM cloud_operation_logs WHERE id = ? AND created_by = ?', [item.history_id, username]);
    if (!h) return null;
    return toBuffer(h.content_snapshot);
  }
  return null;
}

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

  // ===== 按数据空间文件架构导出（多选目录/文件，保留层次结构打包为 ZIP） =====
  if (method === 'POST' && action === 'export-dataspace') {
    Auth.requireAlliance();
    const username = Auth.allianceUsername();

    const rootName = sanitizeRelPath(b.name) || '数据空间导出';
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) Response.error('未选择任何文件');

    const entries = [];
    const seen = new Set();
    for (const it of items) {
      const rel = sanitizeRelPath(it.relPath);
      if (!rel) continue;
      const zipPath = rootName + '/' + rel;
      if (seen.has(zipPath)) continue;
      seen.add(zipPath);
      const content = readEntryContent(ctx, { ...it, _username: username, _schoolId: schoolId });
      if (content === null) continue;
      entries.push({ path: zipPath, data: content });
    }
    if (entries.length === 0) Response.error('所选内容均不存在或为空');

    const zipBuf = buildZip(entries);

    const ts = nowStr();
    const stamp = ts.slice(0, 4) + ts.slice(5, 7) + ts.slice(8, 10) + '_' + ts.slice(11, 13) + ts.slice(14, 16) + ts.slice(17, 19);
    const filename = rootName + '_' + stamp + '.zip';
    const filepath = '/exports/' + filename;

    const exportsDir = path.join(ROOT, 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(path.join(exportsDir, filename), zipBuf);

    const id = DB.insert('data_exports', {
      school_id: schoolId,
      user_id: (Auth.user() || {}).user_id ?? 0,
      type: '数据空间导出',
      format: 'zip',
      status: 'completed',
      file_path: filepath,
      created_at: nowStr(),
    });
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'export', `导出数据空间 ${rootName}（${entries.length} 个文件）`);

    Response.success({ id, download_url: '/exports/' + encodeURIComponent(filename), filename, count: entries.length }, '导出成功');
  }

  Response.error('未知的操作');
};