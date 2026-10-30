/**
 * CSES 配置分发 —— NodeJS 实例云应用模块（app_key = `cses_config`）。
 *
 * 源文件为 CSES 配置（version / subjects / schedules / extraKey）。
 * V3 起 CSES 分发不再转换为 ClassIsland 数据源，而是把源文件原样通过公开地址提供：
 *   GET /config/<实例组标识>/<实例标识>.<扩展名>
 */
'use strict';

const { createRawConfigApp } = require('../lib/raw-config');

module.exports = createRawConfigApp({
  appKey: 'cses_config',
  name: 'CSES 配置分发',
  description: '把 CSES 配置（YAML / JSON）以公开地址提供给支持 CSES 的程序与集控系统',
  format: 'cses',
});
