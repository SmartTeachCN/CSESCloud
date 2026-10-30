/**
 * ExamAware 配置分发 —— NodeJS 实例云应用模块（app_key = `examaware`）。
 *
 * 源文件为 ExamAware 2 考试配置（examName / examInfos，通常为 `.ea2`）。
 * 以公开地址提供给 ExamAware 2 或其它考试编排程序：
 *   GET /config/<实例组标识>/<实例标识>.ea2
 */
'use strict';

const { createRawConfigApp } = require('../lib/raw-config');

module.exports = createRawConfigApp({
  appKey: 'examaware',
  name: 'ExamAware 配置分发',
  description: '把 ExamAware 2 考试配置（.ea2 / JSON）以公开地址提供给考试编排程序',
  format: 'examaware',
});
