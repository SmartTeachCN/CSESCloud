/**
 * AI 助理 —— 上传附件处理
 *
 * 支持把用户上传的文档抽取成纯文本给模型阅读：
 *   - docx / xlsx / pptx：本质是 ZIP + XML，这里用内置 zlib 手写最小 ZIP 读取（不引第三方依赖）
 *   - md / txt / csv / tsv / json / yaml / xml / html / 代码文件：直接读文本
 *   - pdf：暂不支持文本抽取（返回明确提示，让用户贴文本或转 docx）
 *
 * 原始文件落盘到 data/ai-uploads/<ownerHash>/，抽取结果存 ai_attachments.text。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const UPLOAD_DIR = path.join(ROOT, 'data', 'ai-uploads');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_CHARS = 60000; // 单个附件最多存 6 万字文本

const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'log', 'json', 'jsonc', 'yaml', 'yml',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'vue', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat',
  'ini', 'toml', 'cfg', 'conf', 'env', 'sql', 'srt', 'properties',
]);
const OOXML_EXTS = new Set(['docx', 'xlsx', 'pptx']);

const MIME_BY_EXT = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
  json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html', htm: 'text/html',
  xml: 'application/xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function extOf(name) {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(i + 1).toLowerCase() : '';
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&amp;/g, '&');
}

function stripTags(xml) {
  return String(xml || '').replace(/<[^>]*>/g, '');
}

function collapseBlank(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 读取 ZIP（OOXML）中央目录，返回 name → 解压函数 */
function readZip(buf) {
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 Office 文档（ZIP 结构缺失）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === 0x04034b50) {
      const lhNameLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      const data = buf.slice(dataStart, dataStart + compSize);
      entries.set(name, () => {
        if (method === 0) return data;
        try { return zlib.inflateRawSync(data); } catch (_) { return Buffer.alloc(0); }
      });
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipText(entries, name) {
  const fn = entries.get(name);
  if (!fn) return '';
  try { return fn().toString('utf8'); } catch (_) { return ''; }
}

/** docx → 文本（段落/制表/换行） */
function extractDocx(buf) {
  const entries = readZip(buf);
  const xml = readZipText(entries, 'word/document.xml');
  if (!xml) throw new Error('docx 里没有找到 word/document.xml');
  let text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t');
  text = decodeEntities(stripTags(text));
  return collapseBlank(text);
}

/** xlsx → 文本（每个工作表输出为 TSV） */
function extractXlsx(buf) {
  const entries = readZip(buf);
  // 共享字符串表
  const sharedXml = readZipText(entries, 'xl/sharedStrings.xml');
  const shared = [];
  if (sharedXml) {
    const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(sharedXml))) {
      const texts = [];
      const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tre.exec(m[1]))) texts.push(decodeEntities(stripTags(tm[1])));
      shared.push(texts.join(''));
    }
  }
  const sheetNames = [...entries.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number((/sheet(\d+)/.exec(a) || [])[1] || 0) - Number((/sheet(\d+)/.exec(b) || [])[1] || 0));
  if (!sheetNames.length) throw new Error('xlsx 里没有找到工作表');
  const out = [];
  for (let si = 0; si < sheetNames.length; si += 1) {
    const xml = readZipText(entries, sheetNames[si]);
    out.push('## 工作表 ' + (si + 1));
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    let rowCount = 0;
    while ((rm = rowRe.exec(xml))) {
      const cells = [];
      const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1] || '';
        const body = cm[2] || '';
        const vMatch = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
        let value = '';
        if (vMatch) {
          value = decodeEntities(stripTags(vMatch[1]));
          if (/\bt="s"/.test(attrs)) {
            const idx = parseInt(value, 10);
            value = Number.isFinite(idx) && shared[idx] !== undefined ? shared[idx] : value;
          }
        } else {
          const tMatch = /<is[^>]*>([\s\S]*?)<\/is>/.exec(body) || /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
          if (tMatch) value = decodeEntities(stripTags(tMatch[1]));
        }
        cells.push(String(value).replace(/\t/g, ' ').replace(/\n/g, ' '));
      }
      if (cells.some((c) => c !== '')) {
        out.push(cells.join('\t'));
        rowCount += 1;
      }
      if (rowCount >= 500) { out.push('…（该工作表超过 500 行，已截断）'); break; }
    }
  }
  return collapseBlank(out.join('\n'));
}

/** pptx → 文本（按幻灯片分节） */
function extractPptx(buf) {
  const entries = readZip(buf);
  const slides = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number((/slide(\d+)/.exec(a) || [])[1] || 0) - Number((/slide(\d+)/.exec(b) || [])[1] || 0));
  if (!slides.length) throw new Error('pptx 里没有找到幻灯片');
  const out = [];
  for (let i = 0; i < slides.length; i += 1) {
    const xml = readZipText(entries, slides[i]);
    const texts = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml))) texts.push(decodeEntities(stripTags(m[1])));
    out.push('## 幻灯片 ' + (i + 1));
    out.push(texts.join(' ').trim());
  }
  return collapseBlank(out.join('\n'));
}

function extractHtml(html) {
  let text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  text = decodeEntities(stripTags(text));
  return collapseBlank(text);
}

/**
 * 从上传的二进制内容抽取文本
 * @returns {{ok:boolean, text?:string, error?:string, ext:string, kind:string}}
 */
function extractText(buffer, fileName) {
  const ext = extOf(fileName);
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return { ok: false, error: '文件内容为空', ext, kind: 'unknown' };
    }
    if (OOXML_EXTS.has(ext)) {
      const text = ext === 'docx' ? extractDocx(buffer) : ext === 'xlsx' ? extractXlsx(buffer) : extractPptx(buffer);
      if (!text) return { ok: false, error: '文档里没有可提取的文字内容', ext, kind: ext };
      return { ok: true, text, ext, kind: ext };
    }
    if (ext === 'pdf') {
      return {
        ok: false,
        error: '暂不支持 PDF 文本抽取：请把 PDF 内容另存为 docx/txt/md 后上传，或直接把需要阅读的片段粘贴到对话里。',
        ext,
        kind: 'pdf',
      };
    }
    if (TEXT_EXTS.has(ext)) {
      let text = buffer.toString('utf8').replace(/^\uFEFF/, '');
      if (ext === 'html' || ext === 'htm') text = extractHtml(text);
      text = collapseBlank(text);
      if (!text) return { ok: false, error: '文件里没有可提取的文字内容', ext, kind: 'text' };
      return { ok: true, text, ext, kind: 'text' };
    }
    return {
      ok: false,
      error: '不支持的文件类型：' + (ext ? '.' + ext : '未知') + '。支持 docx / xlsx / pptx / md / txt / csv / json / yaml / html / 常见代码文件。',
      ext,
      kind: 'unsupported',
    };
  } catch (e) {
    return { ok: false, error: '解析失败：' + (e && e.message ? e.message : e), ext, kind: ext };
  }
}

function safeFileName(name) {
  const base = String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 120);
  return base || 'file';
}

/**
 * 保存上传文件 + 抽取文本，写入 ai_attachments
 * @param {{DB:object, ownerKey:string, ownerHash:string, file:{name,buffer,size,mime}}} args
 * @returns {{ok:boolean, id?:number, name?:string, chars?:number, truncated?:boolean, error?:string, kind?:string}}
 */
function saveAttachment({ DB, ownerKey, ownerHash, file }) {
  const name = safeFileName(file && file.name);
  const buffer = file && file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, error: '没有收到文件内容' };
  if (buffer.length > MAX_FILE_BYTES) {
    return { ok: false, error: '文件过大（上限 10MB），当前 ' + (buffer.length / 1024 / 1024).toFixed(1) + 'MB' };
  }
  const extracted = extractText(buffer, name);
  if (!extracted.ok) return { ok: false, error: extracted.error, kind: extracted.kind };

  let text = extracted.text;
  let truncated = 0;
  if ([...text].length > MAX_TEXT_CHARS) {
    text = [...text].slice(0, MAX_TEXT_CHARS).join('');
    truncated = 1;
  }

  const relDir = path.join(String(ownerHash || 'anon'));
  const dir = path.join(UPLOAD_DIR, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = crypto.randomUUID() + '-' + name;
  const abs = path.join(dir, storedName);
  try { fs.writeFileSync(abs, buffer); } catch (_) { /* 落盘失败不影响文本使用 */ }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const id = Number(DB.insert('ai_attachments', {
    owner_key: ownerKey,
    file_name: name,
    mime: (MIME_BY_EXT[extracted.ext] || (file && file.mime) || 'application/octet-stream'),
    size: buffer.length,
    text,
    stored_path: path.join(relDir, storedName).replace(/\\/g, '/'),
    truncated,
    created_at: now,
  }));

  return { ok: true, id, name, chars: [...text].length, truncated: !!truncated, kind: extracted.kind };
}

/** 按 id 读取当前用户的附件（返回附带文本），找不到的忽略 */
function loadAttachments(DB, ownerKey, ids) {
  const list = [];
  for (const raw of Array.isArray(ids) ? ids.slice(0, 8) : []) {
    const id = parseInt(raw && typeof raw === 'object' ? raw.id : raw, 10) || 0;
    if (!id) continue;
    const row = DB.one('SELECT * FROM ai_attachments WHERE id = ? AND owner_key = ?', [id, ownerKey]);
    if (row) list.push(row);
  }
  return list;
}

/** 把附件拼成系统提示词里的一段（限制单文件与总长度） */
function buildAttachmentContext(rows, opts) {
  const options = opts || {};
  const perFile = options.perFileChars || 8000;
  const total = options.totalChars || 24000;
  const files = Array.isArray(rows) ? rows : [];
  if (!files.length) return '';
  const parts = [];
  let used = 0;
  for (const row of files) {
    if (used >= total) {
      parts.push('（其余附件因总长度限制未展开，需要细节请让用户分段提供）');
      break;
    }
    const chars = [...String(row.text || '')];
    const budget = Math.min(perFile, total - used);
    const body = chars.slice(0, budget).join('');
    used += Math.min(chars.length, budget);
    const cut = chars.length > budget ? '\n…（附件内容已截断，完整内容共 ' + chars.length + ' 字符）' : '';
    parts.push('### 附件：' + row.file_name + '\n```\n' + body + cut + '\n```');
  }
  return parts.join('\n\n');
}

module.exports = {
  extractText,
  saveAttachment,
  loadAttachments,
  buildAttachmentContext,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  UPLOAD_DIR,
};
