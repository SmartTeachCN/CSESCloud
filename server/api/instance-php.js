/**
 * 实例 PHP 后端调度器
 *
 * 允许开发者在实例的 php/ 目录下放置 PHP 文件，实现自定义后端逻辑。
 * 路由：/api/instance-php.php?instance_uid={uid}&path={file}
 *
 * 示例：
 *   GET  /api/instance-php.php?instance_uid=inst-abc&path=exams.php
 *   POST /api/instance-php.php?instance_uid=inst-abc&path=exams.php
 *
 * 沙箱内的 PHP 代码可访问：
 *   $instance->id        实例 ID
 *   $instance->uid       实例 UID
 *   $instance->name      实例名称
 *   $instance->config()            获取实例配置（JSON）
 *   $instance->saveConfig($data)   保存实例配置
 *   $instance->storage($key)       获取集合存储操作对象
 *   $instance->log($msg)           写入审计日志
 *   $instance->request()           获取当前请求信息
 *   $instance->response($data)     返回 JSON 响应
 *   $instance->responseError($msg) 返回错误响应
 *
 * 沙箱执行（InstancePhpSandbox/InstanceContext/InstanceStorageCollection）
 * 由 server/lib/instance-php-sandbox.js 通过 PHP CLI 子进程实现。
 */
const { executeSandbox } = require('../lib/instance-php-sandbox');

/** PHP basename() 等价 */
function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const instanceUid = String(query.instance_uid ?? '').trim();
  const phpPath = String(query.path ?? 'index.php').trim();

  if (instanceUid === '') {
    Response.error('缺少 instance_uid 参数');
  }

  // 查找实例
  const inst = DB.one("SELECT * FROM instances WHERE instance_uid = ?", [instanceUid]);
  if (!inst) {
    Response.error('实例不存在', 404, 404);
  }

  // 校验访问权限（公开可访问，但需要实例存在且状态为 running）
  if (inst.status !== 'running') {
    Response.error('实例未运行', 503, 503);
  }

  // 查找 PHP 文件
  const phpFile = DB.one(
    `SELECT * FROM cloud_files
     WHERE instance_id = ? AND file_category = 'instance_php' AND name = ?
     LIMIT 1`,
    [inst.id, basename(phpPath)]
  );

  if (!phpFile) {
    Response.error('PHP 文件不存在: ' + basename(phpPath), 404, 404);
  }

  if (Helpers.empty(phpFile.content)) {
    Response.error('PHP 文件为空', 500, 500);
  }

  // ===== 沙箱执行 =====
  const result = await executeSandbox(inst, phpFile, req.method, query, body, req.headers);

  // 输出结果
  if (result.kind === 'response') {
    // 开发者代码调用了 $instance->response()/responseError()
    res.status(result.http).json(result.body);
    throw new ctx.HttpSent();
  }

  if (result.kind === 'error') {
    Response.error(result.message, 500, 500);
  }

  // kind === 'result'：include 的返回值 / 缓冲输出（对齐 PHP：result 为 null 且 output 非空时回传 output）
  if (result.result !== null && result.result !== undefined) {
    if (result.result && typeof result.result === 'object') {
      res.set('Content-Type', 'application/json; charset=utf-8');
      res.json(result.result);
    } else if (typeof result.result === 'string') {
      res.end(result.result);
    } else {
      // 其它标量类型与 PHP is_array/is_string 均不匹配，不输出（空 200 响应）
      res.end();
    }
  } else if (typeof result.output === 'string' && result.output !== '') {
    res.end(result.output);
  } else {
    res.end();
  }
  throw new ctx.HttpSent();
};
