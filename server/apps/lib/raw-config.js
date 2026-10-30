/**
 * 「公开配置地址」型实例云应用的公共实现。
 *
 * CSES 配置（app_key = cses_config）与 ExamAware 配置（app_key = examaware）
 * 不转换为其他结构，而是把轻编辑器中的源文件原样通过公开地址提供：
 *   GET /config/<实例组标识>/<实例标识>.<扩展名>
 */
'use strict';

const convert = require('../../lib/classisland-convert');
const formats = require('../../lib/distribution-formats');

/** 解析实例组 + 实例（限定 app_key）。 */
function resolveInstance(db, dirId, instanceId, appKey) {
  if (!convert.validDirId(dirId)) return { error: '实例组标识不合法', status: 400 };
  if (!convert.validInstanceId(instanceId)) return { error: '实例标识不合法', status: 400 };

  const group = db.one('SELECT * FROM instance_groups WHERE dir_id = ?', [dirId]);
  if (!group) return { error: '实例组不存在或还没有任何配置实例', status: 404 };

  const instance = db.one(
    'SELECT * FROM instances WHERE group_id = ? AND name = ? AND app_key = ?',
    [group.id, instanceId, appKey]
  );
  if (!instance) {
    return { error: '找不到该配置实例，请确认实例标识是否与 CSES Cloud 中的一致', status: 404 };
  }

  const sourceFileId = parseInt(instance.source_file_id, 10) || 0;
  const file = sourceFileId > 0
    ? db.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [sourceFileId])
    : null;
  if (!file) return { error: '找不到该实例的源文件，请重新选择源文件', status: 404 };

  return { group: group, instance: instance, file: file };
}

/**
 * 公开配置接口解析：`<实例组标识>/<文件名>`。
 * 允许文件名带扩展名（.json/.yml/.yaml/.ea2 等），按实例标识查实例。
 */
function resolvePublic(db, dirId, fileName) {
  if (!convert.validDirId(dirId)) return { error: '实例组标识不合法', status: 400 };
  const group = db.one('SELECT * FROM instance_groups WHERE dir_id = ?', [dirId]);
  if (!group) return { error: '实例组不存在或还没有任何配置实例', status: 404 };

  const split = formats.splitRawConfigFileName(fileName);
  if (split.instanceId === '') return { error: '缺少实例标识', status: 400 };

  const appKeys = Object.keys(formats.APP_FORMAT).filter((k) => formats.APP_FORMAT[k] !== 'classisland');
  const placeholders = appKeys.map(() => '?').join(',');
  const instance = db.one(
    `SELECT * FROM instances WHERE group_id = ? AND name = ? AND app_key IN (${placeholders})`,
    [group.id, split.instanceId, ...appKeys]
  );
  if (!instance) {
    return { error: '找不到该配置实例，请确认实例标识是否与 CSES Cloud 中的一致', status: 404 };
  }

  const sourceFileId = parseInt(instance.source_file_id, 10) || 0;
  const file = sourceFileId > 0
    ? db.one('SELECT * FROM web_hosting_files WHERE id = ? AND is_directory = 0', [sourceFileId])
    : null;
  if (!file) return { error: '找不到该实例的源文件，请重新选择源文件', status: 404 };

  const ext = formats.extOfPath(file.file_path) || split.ext || 'txt';
  return {
    group: group,
    instance: instance,
    file: file,
    ext: ext,
    text: formats.parseContentText(file.content),
  };
}

/**
 * 创建「公开配置地址」型云应用模块。
 * @param {{appKey:string,name:string,description:string,format:string}} options
 */
function createRawConfigApp(options) {
  const appKey = options.appKey;
  const format = options.format;

  function resolve(db, dirId, instanceId) {
    return resolveInstance(db, dirId, instanceId, appKey);
  }

  function urlInfo(baseUrl, dirId, instanceId, ext) {
    return {
      kind: 'url',
      source: formats.rawConfigUrl(baseUrl, dirId, instanceId, ext),
    };
  }

  return {
    appKey: appKey,
    name: options.name,
    description: options.description,
    format: format,
    resolveGroup: resolve,
    resolvePublic: resolvePublic,
    urls: urlInfo,
  };
}

module.exports = { createRawConfigApp, resolvePublic };
