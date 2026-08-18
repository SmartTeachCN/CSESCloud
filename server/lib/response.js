/**
 * CSES Cloud - API 响应与工具函数（NodeJS 版，1:1 复刻 lib/response.php）
 */

/** 响应已发送哨兵：模拟 PHP exit 语义（Response::json 之后的代码不再执行） */
class HttpSent extends Error {
  constructor() {
    super('HTTP_RESPONSE_SENT');
    this.isHttpSent = true;
  }
}

// ── 日期工具（Asia/Shanghai 时区，对齐 date_default_timezone_set） ──
const TZ = 'Asia/Shanghai';

/** 格式化为 PHP date('Y-m-d H:i:s') 等价字符串 */
function dateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** 当前时间字符串 */
function nowStr() {
  return dateStr(new Date());
}

/** 解析 'Y-m-d H:i:s' 字符串为 Date（按上海时区） */
function parseDate(s) {
  if (s instanceof Date) return s;
  if (typeof s !== 'string') return new Date(NaN);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return new Date(s);
  // 构造该时刻对应的时间戳：先按本地时区假设再校正
  const asLocal = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const asShanghai = new Date(asLocal.toLocaleString('en-US', { timeZone: TZ }));
  const diff = asLocal.getTime() - asShanghai.getTime();
  return new Date(asLocal.getTime() - diff);
}

// ── 绑定到 res 的 Response 对象（对齐 PHP Response 类） ──
function makeResponse(res) {
  return {
    /** JSON 成功响应（可选 meta 元数据，如轮询间隔、协议等） */
    success(data = null, message = 'ok', meta = null) {
      const payload = { code: 0, message, data };
      if (meta && typeof meta === 'object') payload.meta = meta;
      this.json(payload);
    },
    /** JSON 错误响应（可选 data 载荷，如 retry_after 等） */
    error(message, code = 1, httpStatus = 400, data = null) {
      if (!res.headersSent) res.status(httpStatus);
      const payload = { code, message, data };
      this.json(payload);
    },
    /** 输出 JSON 并终止（抛出 HttpSent 模拟 exit） */
    json(payload) {
      if (!res.headersSent) {
        if (!res.statusCode) res.status(200);
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.json(payload);
      } else {
        // 流式响应已开始（SSE），仅终止执行
        try { res.end(); } catch (_) {}
      }
      throw new HttpSent();
    },
  };
}

// ── 绑定到 req 的 Helpers 对象（对齐 PHP Helpers 类） ──
function makeHelpers(req) {
  return {
    /** HTML 转义 */
    e(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    /** 取输入（body 优先，其次 query） */
    input(key, def = null) {
      if (req.body && typeof req.body === 'object' && key in req.body) return req.body[key];
      if (key in req.query) return req.query[key];
      return def;
    },
    /** 取 JSON 请求体 */
    jsonBody() {
      return req.body && typeof req.body === 'object' ? req.body : {};
    },
    /** 当前请求是否 POST */
    isPost() {
      return req.method === 'POST';
    },
    /** PHP empty() 等价（'0' 视为空，对齐 PHP truthiness） */
    empty(v) {
      return v === undefined || v === null || v === '' || v === 0 || v === false
        || v === '0' || (Array.isArray(v) && v.length === 0);
    },
    /** PHP !empty() 等价 */
    filled(v) {
      return !this.empty(v);
    },
    /** 生成随机字符串（hex） */
    randomStr(length = 16) {
      const bytes = require('crypto').randomBytes(Math.ceil(length / 2));
      return bytes.toString('hex').slice(0, length);
    },
    /** 生成 UUID v4 */
    uuid() {
      return require('crypto').randomUUID();
    },
    /** 格式化数字（千分位） */
    formatNum(n) {
      return Number(n).toLocaleString('en-US');
    },
    /** 相对时间 */
    timeAgo(datetime) {
      const now = Math.floor(Date.now() / 1000);
      const ts = Math.floor(parseDate(datetime).getTime() / 1000);
      const diff = now - ts;
      if (diff < 60) return '刚刚';
      if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
      if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
      if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
      return datetime.slice(0, 10);
    },
  };
}

module.exports = { HttpSent, makeResponse, makeHelpers, dateStr, nowStr, parseDate };
