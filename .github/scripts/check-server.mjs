#!/usr/bin/env node
/**
 * 校验服务端 JS 文件语法：对每个文件执行一次 `node --check`。
 *
 * 服务端是 CommonJS（server 目录下全部 .js，无打包、无类型检查），因此 `node --check`
 * 是提交阶段最轻量也最直接的防回归手段：能在 CI 里拦住「改了 server/ 却把
 * 括号/引号/语法写坏」这类问题，而不需要启动 Express 或连数据库。
 *
 * 用法：
 *   node .github/scripts/check-server.mjs              # 默认校验 server/ 下全部 .js/.cjs/.mjs
 *   node .github/scripts/check-server.mjs server/api   # 只校验指定目录（或单个文件）
 *
 * 退出码：0 = 全部通过；1 = 存在语法错误 / 目标路径不存在 / 没扫到文件。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

// 服务端源码后缀（目前实际只有 .js，保留 .cjs/.mjs 以防后续拆分）
const TARGET_EXTS = new Set(['.js', '.cjs', '.mjs']);
// 递归时跳过的目录（防御性：server 下正常不会出现这些）
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

const cliTargets = process.argv.slice(2);
const targets = cliTargets.length > 0
  ? cliTargets.map((p) => path.resolve(process.cwd(), p))
  : [path.join(REPO_ROOT, 'server')];

/** 递归收集目标路径下的待校验文件 */
function collect(entry, out) {
  const stat = statSync(entry);
  if (stat.isDirectory()) {
    for (const name of readdirSync(entry).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      collect(path.join(entry, name), out);
    }
    return;
  }
  if (TARGET_EXTS.has(path.extname(entry).toLowerCase())) out.push(entry);
}

const files = [];
const missing = [];
for (const target of targets) {
  if (!existsSync(target)) {
    missing.push(target);
    continue;
  }
  collect(target, files);
}

if (missing.length > 0) {
  for (const target of missing) console.error(`缺少目标路径：${target}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error('没有找到需要校验的 JS 文件，请检查目标路径。');
  process.exit(1);
}

const failures = [];
for (const file of files) {
  // stdio: 'inherit' —— 错误信息由 node --check 直接打到本进程 stderr（带文件路径），
  // 不自建管道：避免大量缓冲，也绕过某些受限环境下 pipe stdio 被拒绝的问题。
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    const reason = result.error ? result.error.message : `退出码 ${result.status}`;
    failures.push({ file: path.relative(process.cwd(), file) || file, reason });
  }
}

if (failures.length > 0) {
  console.error(`\n✗ 服务端语法校验失败：${failures.length}/${files.length} 个文件有问题\n`);
  for (const { file, reason } of failures) {
    console.error(`  - ${file}（${reason}）`);
  }
  process.exit(1);
}

console.log(`✓ 服务端语法校验通过：共 ${files.length} 个文件`);
