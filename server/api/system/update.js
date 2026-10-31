/**
 * 生产端同步管理接口（文件即端点：/api/system/update?action=...）
 *
 * 前置条件：服务器环境变量 UPDATE_SYNC_ENABLED=1（未启用时一律 403，并提示如何开启）。
 * 鉴权：任选其一
 *   - 请求头 X-Update-Token: <UPDATE_SYNC_TOKEN>（或 Authorization: Bearer <token>）—— 用 timingSafeEqual 校验
 *   - 以最高管理员账号登录后的会话 Cookie
 *
 * 操作：
 *   GET  action=version    当前部署版本/提交/构建时间/运行时长 + 同步配置概况 + 最近一次任务状态
 *   GET  action=check      查询 GitHub 最新 Release / 分支最新提交，与本地 build-info 对比（可带 tag 指定 Release）
 *   GET  action=status     最近一次同步任务的状态 + 日志尾部 + 备份列表 + 是否正在运行
 *   GET  action=backups    备份列表
 *   POST action=apply      触发后台更新任务（下载 → 校验 → 备份 → 替换 → 重启 → 健康检查，失败自动回滚）
 *   POST action=rollback   触发后台回滚任务（默认回滚到最近一次备份，可传 backup 指定）
 *
 * 写操作都会写审计日志（Auth.logAudit）；apply/rollback 立即返回 job_id，
 * 后续通过 action=status 轮询进度与日志。
 */
const crypto = require('crypto');
const buildInfo = require('../../lib/build-info');
const updateSync = require('../../lib/update-sync');

/** 恒定时间比较：先取 sha256 摘要，避免长度差异泄漏信息 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** 从请求中提取同步凭据（优先请求头，其次请求体/查询参数以便调试） */
function extractToken(req, body) {
  const headers = req.headers || {};
  const headerToken = String(headers['x-update-token'] || '').trim();
  if (headerToken) return headerToken;

  const auth = String(headers.authorization || '');
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();

  if (body && typeof body.token === 'string' && body.token.trim()) return body.token.trim();
  const query = req.query || {};
  if (typeof query.token === 'string' && query.token.trim()) return query.token.trim();
  return '';
}

/** 允许的标签/备份名（直接作为命令行参数传给脚本，先做白名单校验） */
function isSafeName(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ''));
}

module.exports = async (ctx) => {
  const { req, Auth, Response, query, body } = ctx;
  const method = String(req.method || 'GET').toUpperCase();
  const action = String((query && query.action) || (body && body.action) || '').trim();

  // ── 1. 功能开关（未启用直接 403，并在消息里写清怎么开） ──
  const cfg = updateSync.getConfig();
  if (!updateSync.isEnabled(cfg)) {
    Response.error(
      '生产端同步未启用：请设置环境变量 UPDATE_SYNC_ENABLED=1（可写在仓库根 .env）后重启服务',
      40310,
      403
    );
  }

  // ── 2. 鉴权：同步凭据 或 最高管理员会话 ──
  let operator = '';
  const token = extractToken(req, body);
  if (cfg.token && token && safeEqual(token, cfg.token)) {
    operator = 'token';
  } else {
    if (!Auth.check()) {
      Response.error(
        token
          ? '同步凭据无效（与 UPDATE_SYNC_TOKEN 不匹配），且未以最高管理员账号登录'
          : '未登录：请携带 X-Update-Token 同步凭据，或以最高管理员账号登录后访问',
        40100,
        401
      );
    }
    if (!Auth.isSuperAdmin()) {
      Response.error('权限不足：生产端同步仅限最高管理员或持有同步凭据的调用方', 40301, 403);
    }
    operator = 'session:' + ((Auth.user() || {}).username || 'unknown');
  }

  // ── 3. 当前版本信息（GET 默认动作） ──
  if (method === 'GET' && (action === 'version' || action === '')) {
    const local = buildInfo.getBuildInfo();
    const state = updateSync.readState(cfg);
    const lock = updateSync.readLock(cfg);
    Response.success({
      version: local.version,
      commit: local.commit,
      short_commit: local.shortCommit,
      branch: local.branch,
      tag: local.tag,
      build_time: local.buildTime,
      dirty: local.dirty,
      sources: local.sources,
      build_info_file: local.buildInfoFile,
      runtime: {
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime_seconds: Math.floor(process.uptime()),
        started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        now: new Date().toISOString(),
      },
      sync: Object.assign(updateSync.publicConfig(cfg), {
        lock_active: updateSync.isLockActive(cfg, lock),
        running: state.running || null,
        last: state.last || null,
      }),
    });
  }

  // ── 4. 检查更新（只读网络请求） ──
  if (method === 'GET' && action === 'check') {
    const tag = typeof query.tag === 'string' ? query.tag.trim() : '';
    if (tag && !isSafeName(tag)) Response.error('tag 参数格式不合法', 40001, 400);
    const local = buildInfo.getBuildInfo({ refresh: true });
    const result = await updateSync.checkForUpdate(cfg, local, tag ? { tag } : {});
    if (result.ok === false) {
      Response.error(result.message || '检查更新失败（无法访问 GitHub API）', 50201, 502, result);
    }
    Response.success(result);
  }

  // ── 5. 任务状态（含日志尾部、备份列表） ──
  if (method === 'GET' && action === 'status') {
    const status = updateSync.jobStatus(cfg);
    Response.success(Object.assign(status, {
      current: (() => {
        const local = buildInfo.getBuildInfo();
        return {
          version: local.version,
          commit: local.commit,
          short_commit: local.shortCommit,
          branch: local.branch,
          build_time: local.buildTime,
        };
      })(),
      now: new Date().toISOString(),
    }));
  }

  // ── 6. 备份列表 ──
  if (method === 'GET' && action === 'backups') {
    Response.success(updateSync.listBackups(cfg).map((b) => ({
      name: b.name,
      created_at: b.createdAt,
      dir: b.dir,
      from: (b.meta && b.meta.from) || null,
      to: (b.meta && b.meta.to) || null,
      files: (b.meta && b.meta.files) || null,
      bytes: (b.meta && b.meta.bytes) || null,
    })));
  }

  // ── 7. 触发更新（POST，后台任务，立即返回 job_id） ──
  if (action === 'apply') {
    if (method !== 'POST') Response.error('apply 需要 POST 请求', 40501, 405);

    const extraArgs = [];
    const tag = body && typeof body.tag === 'string' ? body.tag.trim() : '';
    if (tag) {
      if (!isSafeName(tag)) Response.error('tag 参数格式不合法', 40001, 400);
      extraArgs.push('--tag', tag);
    }
    if (body && body.no_install) extraArgs.push('--no-install');
    if (body && body.skip_verify) extraArgs.push('--skip-verify');

    const job = updateSync.spawnTask(cfg, 'apply', extraArgs);
    if (!job.ok) {
      Response.error(job.error || '启动更新任务失败', 50001, 500, { holder: job.holder || null });
    }

    Auth.logAudit(
      0,
      0,
      'update_apply',
      `触发生产端更新: job=${job.jobId} repo=${cfg.repo} branch=${cfg.branch}`
        + (tag ? ` tag=${tag}` : '') + ` operator=${operator}`,
      'success'
    );
    Response.success({
      job_id: job.jobId,
      action: 'apply',
      pid: job.pid,
      log_file: job.logFile,
      poll: '/api/system/update?action=status',
    }, '已启动更新任务');
  }

  // ── 8. 触发回滚（POST，后台任务） ──
  if (action === 'rollback') {
    if (method !== 'POST') Response.error('rollback 需要 POST 请求', 40501, 405);

    const extraArgs = [];
    const backup = body && typeof body.backup === 'string' ? body.backup.trim() : '';
    if (backup) {
      // 只允许备份目录名（不允许路径分隔符，防止越权访问任意目录）
      if (!isSafeName(backup)) Response.error('backup 参数格式不合法（只允许备份目录名）', 40001, 400);
      extraArgs.push('--backup', backup);
    }

    const job = updateSync.spawnTask(cfg, 'rollback', extraArgs);
    if (!job.ok) {
      Response.error(job.error || '启动回滚任务失败', 50001, 500, { holder: job.holder || null });
    }

    Auth.logAudit(
      0,
      0,
      'update_rollback',
      `触发生产端回滚: job=${job.jobId}` + (backup ? ` backup=${backup}` : ' 最近备份') + ` operator=${operator}`,
      'success'
    );
    Response.success({
      job_id: job.jobId,
      action: 'rollback',
      pid: job.pid,
      log_file: job.logFile,
      poll: '/api/system/update?action=status',
    }, '已启动回滚任务');
  }

  Response.error(`未知操作: ${action || '(空)'}（可用：version / check / status / backups / apply / rollback）`);
};
