/**
 * 云文件分享权限（V3）。
 *
 * 四档权限（按能力递增）：
 *   view_file     查看文件：读取文件内容
 *   view_instance 查看实例：读取文件 + 查看该文件的分发实例
 *   edit_file     编辑文件：读取/编辑文件 + 查看分发实例
 *   edit_instance 编辑实例：读取/编辑文件 + 管理分发实例
 *
 * 兼容旧值：view → view_file，edit → edit_file。
 */
'use strict';

const VALUES = ['view_file', 'view_instance', 'edit_file', 'edit_instance'];

const LABELS = {
  view_file: '查看文件',
  view_instance: '查看实例',
  edit_file: '编辑文件',
  edit_instance: '编辑实例',
};

const RANK = {
  view_file: 1,
  view_instance: 2,
  edit_file: 3,
  edit_instance: 4,
};

/** 规范化权限值（兼容旧 view/edit，未知值回退 view_file）。 */
function normalizePermission(raw) {
  const value = String(raw === undefined || raw === null ? '' : raw).trim();
  if (value === 'view') return 'view_file';
  if (value === 'edit') return 'edit_file';
  return VALUES.includes(value) ? value : 'view_file';
}

/** 是否合法权限值（含旧值）。 */
function isValidPermission(raw) {
  const value = String(raw === undefined || raw === null ? '' : raw).trim();
  return value === 'view' || value === 'edit' || VALUES.includes(value);
}

function rankOf(permission) {
  return RANK[normalizePermission(permission)] || 1;
}

/** 权限是否允许某能力：read_file / write_file / view_instance / edit_instance。 */
function allows(permission, capability) {
  const rank = rankOf(permission);
  switch (capability) {
    case 'read_file':
    case 'download':
      return rank >= 1;
    case 'view_instance':
      return rank >= 2;
    case 'write_file':
    case 'edit_file':
      return rank >= 3;
    case 'edit_instance':
      return rank >= 4;
    default:
      return false;
  }
}

function labelOf(permission) {
  return LABELS[normalizePermission(permission)] || LABELS.view_file;
}

module.exports = {
  VALUES,
  LABELS,
  normalizePermission,
  isValidPermission,
  rankOf,
  allows,
  labelOf,
};
