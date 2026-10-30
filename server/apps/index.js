/**
 * NodeJS 云应用模块注册表。
 *
 * V3 起「配置实例」复用平台既有实例云应用模型，但服务端模块由 NodeJS 编写：
 * 每个内置云应用是一个目录（`server/apps/<app-key>/index.js`），导出 appKey/name/description
 * 以及按数据接口（DB 查询 / 文档转换）实现的纯函数。
 *
 * 当前内置：
 *   - cses_static_control  静态集控（CSES 配置文件 → ClassIsland 集控数据源）
 */
'use strict';

const registry = new Map();

/** 注册一个云应用模块（模块需提供 appKey/name/description）。 */
function register(mod) {
  if (!mod || typeof mod !== 'object' || !mod.appKey) return null;
  registry.set(String(mod.appKey), mod);
  return mod;
}

/**
 * 按 appKey 取云应用模块。
 * @param {string} appKey
 * @returns {object|null}
 */
function get(appKey) {
  if (appKey === undefined || appKey === null) return null;
  return registry.get(String(appKey)) || null;
}

/**
 * 列出全部云应用。
 * @returns {{appKey:string,name:string,description:string}[]}
 */
function list() {
  return Array.from(registry.values()).map((mod) => ({
    appKey: mod.appKey,
    name: mod.name,
    description: mod.description || '',
  }));
}

// ── 内置云应用 ──
// 注意：模块文件只做纯函数定义，不产生 DB / 文件系统副作用，require 即注册。
register(require('./cses-static-control'));

module.exports = { get, list, register };
