/**
 * 系统健康检查（公开只读接口）
 *
 * 地址：GET /api/system/health
 * 用途：
 *   - 生产端同步脚本更新后的健康检查（默认 UPDATE_HEALTHCHECK_URL 指向这里）
 *   - 进程守护 / 反向代理 / 监控探活
 *
 * 返回：{ code: 0, message: 'ok', data: { ok, service, version, uptime_seconds, started_at, now } }
 * 说明：不暴露提交哈希、账号、路径等敏感信息；需要这些请用带鉴权的
 *       /api/system/update?action=version。
 */
module.exports = async (ctx) => {
  const { res, Response } = ctx;
  const { getBuildInfo } = require('../../lib/build-info');

  if (res && typeof res.set === 'function') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  let version = '';
  try {
    version = getBuildInfo().version || '';
  } catch (_) {
    version = '';
  }

  const uptimeSeconds = Math.floor(process.uptime());

  Response.success({
    ok: true,
    service: 'cses-cloud',
    version,
    uptime_seconds: uptimeSeconds,
    started_at: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
    now: new Date().toISOString(),
  });
};
