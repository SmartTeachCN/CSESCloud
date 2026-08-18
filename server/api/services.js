/** 服务详情 API */
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const API_DIR = path.join(__dirname);
const DATA_DIR = path.join(ROOT, 'data');

const round = (ms) => Math.round(ms * 100) / 100;

/** 探测任意 SQL 查询：计时 + 提取详情 */
function probe(DB, sql, params, describe) {
  const t = performance.now();
  try {
    const row = DB.scalar(sql, params);
    const detail = typeof describe === 'function' ? describe(row) : String(row ?? '');
    return { status: 'running', latency: round(performance.now() - t), detail: detail || '正常' };
  } catch (e) {
    return { status: 'error', latency: round(performance.now() - t), detail: (e && e.message) || '异常' };
  }
}

/** 探测接口模块文件是否可装载 */
function fileProbe(rel) {
  const t = performance.now();
  const fp = path.join(API_DIR, rel);
  try {
    const ok = fs.existsSync(fp);
    return { status: ok ? 'running' : 'error', latency: round(performance.now() - t), detail: ok ? '接口模块已装载' : '接口模块缺失' };
  } catch (e) {
    return { status: 'error', latency: round(performance.now() - t), detail: (e && e.message) || '异常' };
  }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body, files } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  const b = Helpers.jsonBody();

  // ── 服务器后端运行概览 ──
  if (method === 'GET' && action === 'overview') {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const load = os.loadavg();
    const cpus = os.cpus();

    // 磁盘（项目根目录所在盘）
    let disk = null;
    try {
      const st = fs.statfsSync(ROOT);
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      disk = { total, free, path: ROOT };
    } catch (_) { disk = null; }

    const mem = process.memoryUsage();
    const server = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      pid: process.pid,
      processUptime: Math.floor(process.uptime()),
      osUptime: Math.floor(os.uptime()),
      cpuCount: cpus.length,
      loadAvg: load.map((v) => round(v)),
      totalMem,
      freeMem,
      memUsage: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      disk,
    };

    // 数据库状态
    const dbFile = path.join(DATA_DIR, 'cses.db');
    let database = { engine: 'SQLite', ok: false, tables: 0, sizeBytes: 0, path: dbFile };
    try {
      database.ok = DB.scalar('SELECT 1') === 1;
      database.tables = parseInt(DB.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") ?? 0, 10) || 0;
      if (fs.existsSync(dbFile)) database.sizeBytes = fs.statSync(dbFile).size;
    } catch (_) { database.ok = false; }

    // WebSocket 网关状态
    const ws = global.wsControl || null;
    let wsInfo = { enabled: !!ws, ok: !!ws };
    if (ws) {
      try { wsInfo.sockets = ws.clients ? ws.clients.size : (ws.getClientCount ? ws.getClientCount() : 0); } catch (_) { wsInfo.sockets = 0; }
    }

    // 平台各模块运行情况
    const services = [
      { id: 'svc-http', name: '平台 HTTP 服务', type: 'Node.js / Express', group: '平台核心', icon: 'ri-server-line', color: '#0067C0', check: () => ({ status: 'running', latency: 0, detail: `PID ${process.pid}` }) },
      { id: 'svc-auth', name: '认证与会话', type: 'OAuth2 / 会话', group: '平台核心', icon: 'ri-shield-keyhole-line', color: '#C2550B', check: () => probe(DB, 'SELECT COUNT(*) FROM users', [], (n) => `已注册 ${n} 个账户`) },
      { id: 'svc-db', name: '数据库引擎', type: 'SQLite / WAL', group: '平台核心', icon: 'ri-database-2-line', color: '#00897B', check: () => { const t = performance.now(); try { const ok = DB.scalar('SELECT 1') === 1; return { status: ok ? 'running' : 'error', latency: round(performance.now() - t), detail: ok ? `${database.tables} 张数据表` : '连接失败' }; } catch (e) { return { status: 'error', latency: round(performance.now() - t), detail: (e && e.message) || '异常' }; } } },
      { id: 'svc-ws', name: 'WebSocket 网关', type: '实时控制通道', group: '平台核心', icon: 'ri-wireless-line', color: '#5E60CE', check: () => ({ status: wsInfo.enabled ? 'running' : 'error', latency: 0, detail: wsInfo.enabled ? `已挂载 · 活跃连接 ${wsInfo.sockets ?? 0}` : '未挂载' }) },
      { id: 'svc-instance', name: '实例服务', type: '实例编排', group: '业务服务', icon: 'ri-apps-line', color: '#2E7D32', check: () => probe(DB, 'SELECT COUNT(*) FROM instances', [], (n) => `运行中 ${n} 个实例`) },
      { id: 'svc-cloud-fs', name: '云文件系统', type: '云端存储', group: '业务服务', icon: 'ri-folder-cloud-line', color: '#1976D2', check: () => probe(DB, 'SELECT COUNT(*) FROM cloud_files', [], (n) => `共 ${n} 个文件`) },
      { id: 'svc-ea2', name: 'EA2 考试配置', type: '考试编排', group: '业务服务', icon: 'ri-file-list-3-line', color: '#6A1B9A', check: () => probe(DB, "SELECT COUNT(*) FROM cloud_files WHERE file_type = 'ea2'", [], (n) => `${n} 个考试配置`) },
      { id: 'svc-control', name: '设备控制 REST', type: '长轮询 / 双协议', group: '业务服务', icon: 'ri-cpu-line', color: '#0080FF', check: () => probe(DB, 'SELECT COUNT(*) FROM ea2_devices', [], (n) => `已注册 ${n} 台设备`) },
      { id: 'svc-notify', name: '通知服务', type: '站内信', group: '业务服务', icon: 'ri-notification-3-line', color: '#E65100', check: () => probe(DB, 'SELECT COUNT(*) FROM notifications', [], (n) => `共 ${n} 条通知`) },
      { id: 'svc-audit', name: '审计日志', type: '操作留痕', group: '业务服务', icon: 'ri-file-search-line', color: '#455A64', check: () => probe(DB, 'SELECT COUNT(*) FROM audit_logs', [], (n) => `共 ${n} 条记录`) },
      { id: 'svc-hosting', name: '网页托管', type: '站点服务', group: '业务服务', icon: 'ri-global-line', color: '#00836D', check: () => probe(DB, 'SELECT COUNT(*) FROM web_hosting_spaces', [], (n) => `${n} 个站点`) },
      { id: 'svc-ai', name: 'AI 智能服务', type: '大模型通道', group: '集成服务', icon: 'ri-robot-2-line', color: '#C2185B', check: () => fileProbe(path.join('ai', 'chat.js')) },
      { id: 'svc-dataspace', name: '数据空间', type: '用户数据', group: '集成服务', icon: 'ri-stack-line', color: '#00695C', check: () => fileProbe('data-space.js') },
      { id: 'svc-export', name: '数据导出', type: '数据导出', group: '集成服务', icon: 'ri-download-cloud-2-line', color: '#F57C00', check: () => fileProbe('data-export.js') },
      { id: 'svc-dev', name: '开发者中心', type: '应用与插件', group: '集成服务', icon: 'ri-code-s-slash-line', color: '#283593', check: () => fileProbe(path.join('dev', 'apps.js')) },
    ].map((s) => Object.assign({}, s, (typeof s.check === 'function' ? s.check() : {}), { check: undefined }));

    Response.success({ server, database, ws: wsInfo, services });
  }

  if (method === 'GET' && action === 'list') {
    Response.success(DB.all("SELECT * FROM services WHERE school_id = ? ORDER BY id ASC", [schoolId]));
  }

  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    const svc = DB.one("SELECT * FROM services WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!svc) Response.error('服务不存在');
    Response.success(svc);
  }

  if (method === 'POST' && action === 'update-status') {
    const id = parseInt(b.id ?? 0, 10) || 0;
    const status = b.status ?? '';
    if (!['running', 'stopped', 'maintenance'].includes(status)) Response.error('无效状态');
    const svc = DB.one("SELECT * FROM services WHERE id = ? AND school_id = ?", [id, schoolId]);
    if (!svc) Response.error('服务不存在');
    DB.update('services', { status: status }, 'id = ? AND school_id = ?', [id, schoolId]);
    Auth.logAudit(schoolId, (Auth.user() || {}).user_id ?? 0, 'update', `修改服务 ${svc.name} 状态为 ${status}`);
    Response.success(null, '状态已更新');
  }

  Response.error('未知的操作');
};