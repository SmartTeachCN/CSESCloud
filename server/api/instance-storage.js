/**
 * 实例存储数据 API
 * 按实例存储清单（storage_manifest）格式存储数据
 * 平台自动生成的多类型编辑器（带Tab和搜索框）通过此 API 读写数据
 *
 * 操作：
 *  - GET  action=list&instance_id=N&collection_key=K    列出某集合的记录
 *  - GET  action=collections&instance_id=N              列出实例所有集合及字段定义
 *  - POST action=save                                    保存/更新一条记录
 *  - POST action=delete                                  删除一条记录
 */
const crypto = require('crypto');
const DB = require('../lib/db');
const { nowStr } = require('../lib/response');

// 校验实例归属
function assertInstance(Response, instanceId, schoolId) {
  const ins = DB.one("SELECT * FROM instances WHERE id = ? AND school_id = ?", [instanceId, schoolId]);
  if (!ins) Response.error('实例不存在');
  return ins;
}

// 取实例的存储清单
function getStorageManifest(instanceId) {
  const ins = DB.one("SELECT app_key FROM instances WHERE id = ?", [instanceId]);
  if (!ins || !ins.app_key) return { collections: [] };
  try {
    const { AppFS } = require('../lib/dev-fs');
    const app = AppFS.readByKey(ins.app_key);
    if (app && app.storage_manifest) return app.storage_manifest;
  } catch (e) { /* ignore */ }
  return { collections: [] };
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;
  Auth.requireLogin();
  const schoolId = Auth.schoolId();

  const method = req.method;
  const action = query.action ?? '';
  // body 即 Helpers::jsonBody()

  // ===== 列出实例的所有集合及字段定义（供自动生成编辑器渲染 Tab） =====
  if (method === 'GET' && action === 'collections') {
    const instanceId = parseInt(query.instance_id ?? 0, 10) || 0;
    assertInstance(Response, instanceId, schoolId);
    const manifest = getStorageManifest(instanceId);
    const collections = manifest.collections ?? [];
    // 为每个集合附带记录数
    Object.keys(collections).forEach(k => {
      const col = collections[k];
      const key = col.key ?? '';
      col.record_count = key ? parseInt(DB.scalar("SELECT COUNT(*) FROM instance_storage_data WHERE instance_id = ? AND collection_key = ?", [instanceId, key]), 10) || 0 : 0;
      collections[k] = col;
    });
    Response.success({ collections: collections });
  }

  // ===== 列出某集合的记录（支持搜索） =====
  if (method === 'GET' && action === 'list') {
    const instanceId = parseInt(query.instance_id ?? 0, 10) || 0;
    const collectionKey = query.collection_key ?? '';
    const keyword = String(query.keyword ?? '').trim();
    assertInstance(Response, instanceId, schoolId);
    if (collectionKey === '') Response.error('collection_key 不能为空');
    const rows = DB.all(
      "SELECT * FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? ORDER BY id DESC",
      [instanceId, collectionKey]
    );
    // 解析 data JSON 并按关键字过滤
    const list = [];
    for (const r of rows) {
      let d = null;
      if (r.data !== null && r.data !== undefined) { try { d = JSON.parse(r.data); } catch (_) { d = null; } }
      if (!d || (typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 0)) d = [];
      r.data = d;
      if (keyword !== '') {
        const hay = JSON.stringify(d);
        if (!hay.toLowerCase().includes(keyword.toLowerCase())) continue;
      }
      list.push(r);
    }
    Response.success(list);
  }

  // ===== 保存/更新记录 =====
  if (method === 'POST' && action === 'save') {
    const instanceId = parseInt(body.instance_id ?? 0, 10) || 0;
    const collectionKey = String(body.collection_key ?? '').trim();
    // 兼容两种格式：{ record: { record_id, data } } 或 { record_id, data }
    const record = body.record ?? null;
    let recordId;
    let data;
    if (record && typeof record === 'object') {
      recordId = String(record.record_id ?? '').trim();
      data = record.data ?? [];
    } else {
      recordId = String(body.record_id ?? '').trim();
      data = body.data ?? [];
    }
    assertInstance(Response, instanceId, schoolId);
    if (collectionKey === '') Response.error('collection_key 不能为空');
    const now = nowStr();
    if (recordId === '') recordId = 'r_' + crypto.createHash('md5').update(String(instanceId) + String(collectionKey) + String(Date.now() / 1000)).digest('hex').slice(0, 10);
    // 检查是否存在
    const exist = DB.one("SELECT id FROM instance_storage_data WHERE instance_id = ? AND collection_key = ? AND record_id = ?", [instanceId, collectionKey, recordId]);
    if (exist) {
      DB.update('instance_storage_data', { data: JSON.stringify(data), updated_at: now }, 'id = ?', [exist.id]);
    } else {
      DB.insert('instance_storage_data', {
        instance_id: instanceId,
        collection_key: collectionKey,
        record_id: recordId,
        data: JSON.stringify(data),
        created_at: now,
        updated_at: now,
      });
    }
    Response.success({ record_id: recordId }, '已保存');
  }

  // ===== 删除记录 =====
  if (method === 'POST' && action === 'delete') {
    const instanceId = parseInt(body.instance_id ?? 0, 10) || 0;
    const recordId = String(body.record_id ?? '').trim();
    const collectionKey = String(body.collection_key ?? '').trim();
    assertInstance(Response, instanceId, schoolId);
    DB.delete('instance_storage_data', 'instance_id = ? AND collection_key = ? AND record_id = ?', [instanceId, collectionKey, recordId]);
    Response.success(null, '已删除');
  }

  Response.error('未知的操作');
};
