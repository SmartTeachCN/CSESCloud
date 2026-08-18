<template>
  <div class="data-export-page">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">数据空间导出</h1>
        <p class="page-description">按数据空间文件架构，多选目录或文件打包导出</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-secondary btn-sm" @click="checkAll" :disabled="loading">全选</button>
        <button class="btn btn-secondary btn-sm" @click="clearAll" :disabled="loading">清空</button>
        <button class="btn btn-secondary btn-sm" @click="toggleExpandAll">
          {{ allExpanded ? '全部折叠' : '全部展开' }}
        </button>
      </div>
    </div>

    <div class="export-layout">
      <!-- 左侧：文件树多选 -->
      <div class="export-form">
        <div class="panel">
          <div class="panel-header">
            <h3 class="panel-title">选择要导出的内容</h3>
            <span class="panel-hint">{{ loading ? '加载中...' : `已选 ${selectedCount} 项` }}</span>
          </div>
          <div class="panel-body tree-body">
            <template v-for="node in visibleTree" :key="node.path">
              <div
                class="tree-node"
                :class="{ 'is-dir': node.is_directory }"
                :style="{ paddingLeft: (node.depth * 18 + 8) + 'px' }"
              >
                <label class="check" @click.stop>
                  <input type="checkbox" :checked="isChecked(node.path)" @change="toggleNode(node)" />
                </label>
                <button v-if="node.is_directory" class="chev" @click="toggleExpand(node.path)">
                  <Icon :icon="expanded.has(node.path) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'" :size="14" />
                </button>
                <span v-else class="chev-placeholder"></span>
                <Icon
                  :icon="node.is_directory ? (expanded.has(node.path) ? 'ri-folder-open-line' : 'ri-folder-3-line') : fileIcon(node)"
                  :size="16"
                  class="node-icon"
                />
                <span class="node-name" :title="node.path">{{ node.name }}</span>
                <span v-if="node.badge" class="node-badge">{{ node.badge }}</span>
                <span v-if="node.size && !node.is_directory" class="node-size">{{ formatBytes(node.size) }}</span>
              </div>
            </template>
            <div v-if="!loading && treeData.length === 0" class="empty-state-sm">暂无数据空间内容</div>
            <div v-if="loading" class="ft-loading"><div class="loading-ring"></div><span>加载中...</span></div>
          </div>
        </div>
      </div>

      <!-- 右侧：导出操作 + 历史 -->
      <div class="export-sidebar">
        <div class="panel">
          <div class="panel-header"><h3 class="panel-title">导出配置</h3></div>
          <div class="panel-body">
            <div class="sel-summary">
              <div class="sel-row">已选目录/文件 <strong>{{ selectedCount }}</strong> 项</div>
              <div class="sel-row">包含文件 <strong>{{ selectedFilesCount }}</strong> 个</div>
              <div class="sel-row">预计大小 <strong>{{ totalSize }}</strong></div>
              <template v-if="visibleSelectedDirs.length > 0">
                <div class="sel-label">已选目录</div>
                <div class="sel-list">
                  <div v-for="d in visibleSelectedDirs" :key="d" class="sel-item" :title="d">{{ d }}</div>
                </div>
              </template>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary btn-large" :disabled="isExporting || selectedFilesCount === 0" @click="startExport">
                <Icon v-if="!isExporting" icon="ri-download-2-line" :size="16" />
                <Icon v-else icon="ri-loader-4-line" :size="16" class="spinning" />
                {{ isExporting ? '导出中...' : '开始导出' }}
              </button>
            </div>
            <div class="export-note">将按数据空间目录结构打包为 ZIP 文件。</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h3 class="panel-title">导出历史</h3></div>
          <div class="panel-body history-list">
            <div v-for="item in exportHistory" :key="item.id" class="history-item">
              <div class="history-icon completed"><Icon icon="ri-checkbox-circle-line" :size="14" /></div>
              <div class="history-content">
                <div class="history-name">{{ item.type }}</div>
                <div class="history-meta">{{ item.created_at }} · ZIP</div>
              </div>
              <button v-if="item.file_path" class="icon-btn-sm" title="下载" @click="downloadPath(item.file_path)">
                <Icon icon="ri-download-2-line" :size="14" />
              </button>
            </div>
            <div v-if="exportHistory.length === 0" class="empty-state-sm">暂无导出记录</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="'toast-' + toast.type">
      <Icon :icon="toast.type === 'success' ? 'ri-check-line' : 'ri-error-warning-line'" :size="16" />
      <span>{{ toast.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { dataSpaceApi, dataExportApi } from '../../api';

const route = useRoute();

const loading = ref(false);
const treeData = ref<any[]>([]);
const isExporting = ref(false);
const exportHistory = ref<any[]>([]);

const expanded = ref<Set<string>>(new Set(['/实例文件', '/云文件', '/网页空间', '/版本历史', '/操作记录']));
const checked = ref<Set<string>>(new Set());

// ===== 文件树 =====
const visibleTree = computed(() => {
  const result: any[] = [];
  function walk(nodes: any[], depth: number) {
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.is_directory && node.children?.length && expanded.value.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(treeData.value, 0);
  return result;
});

const allDirs = computed(() => {
  const result: string[] = [];
  function walk(nodes: any[]) {
    for (const node of nodes) {
      if (node.is_directory) {
        result.push(node.path);
        if (node.children) walk(node.children);
      }
    }
  }
  walk(treeData.value);
  return result;
});

const allExpanded = computed(() => allDirs.value.every((p) => expanded.value.has(p)));

function toggleExpand(path: string) {
  const s = new Set(expanded.value);
  if (s.has(path)) s.delete(path);
  else s.add(path);
  expanded.value = s;
}

function toggleExpandAll() {
  expanded.value = allExpanded.value ? new Set() : new Set(allDirs.value);
}

function findNodeByPath(path: string, nodes: any[] = treeData.value): any {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const r = findNodeByPath(path, n.children);
      if (r) return r;
    }
  }
  return null;
}

function getDescendantPaths(node: any): string[] {
  const paths: string[] = [];
  function walk(nodes: any[]) {
    for (const n of nodes) {
      paths.push(n.path);
      if (n.children) walk(n.children);
    }
  }
  walk([node]);
  return paths;
}

// ===== 选择状态 =====
function isChecked(path: string) {
  return checked.value.has(path);
}

function toggleNode(node: any) {
  const s = new Set(checked.value);
  if (s.has(node.path)) {
    if (node.is_directory) {
      getDescendantPaths(node).forEach((p) => s.delete(p));
    } else {
      s.delete(node.path);
    }
  } else if (node.is_directory) {
    getDescendantPaths(node).forEach((p) => s.add(p));
  } else {
    s.add(node.path);
  }
  checked.value = s;
}

function checkAll() {
  const s = new Set<string>();
  function walk(nodes: any[]) {
    for (const n of nodes) {
      s.add(n.path);
      if (n.children) walk(n.children);
    }
  }
  walk(treeData.value);
  checked.value = s;
}

function clearAll() {
  checked.value = new Set();
}

// 选中路径排序（目录在前）
const selectedPaths = computed(() => {
  const paths = [...checked.value];
  const nodeDir = (p: string) => !!(findNodeByPath(p)?.is_directory);
  return paths.sort((a, b) => {
    if (nodeDir(a) !== nodeDir(b)) return nodeDir(a) ? -1 : 1;
    return a.localeCompare(b);
  });
});

const selectedCount = computed(() => checked.value.size);
const selectedFilesCount = computed(() => [...checked.value].filter((p) => findNodeByPath(p) && !findNodeByPath(p).is_directory).length);
const visibleSelectedDirs = computed(() => selectedPaths.value.filter((p) => findNodeByPath(p)?.is_directory).slice(0, 6));
const totalSize = computed(() => {
  let sum = 0;
  for (const p of checked.value) {
    const n = findNodeByPath(p);
    if (n && !n.is_directory && n.size) sum += Number(n.size) || 0;
  }
  return formatBytes(sum);
});

// ===== 导出 =====
function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '';
  return p.slice(0, i);
}

function commonPrefixSegs(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const split = (p: string) => p.split('/').filter(Boolean);
  let parts = split(dirOf(paths[0]));
  for (const p of paths) {
    const o = split(dirOf(p));
    let j = 0;
    while (j < parts.length && j < o.length && parts[j] === o[j]) j++;
    parts = parts.slice(0, j);
    if (!parts.length) break;
  }
  return parts;
}

function toItem(node: any, relPath: string): any {
  const it: any = { source: node.source, relPath };
  if (node.file_id) it.file_id = node.file_id;
  if (node.space_id) it.space_id = node.space_id;
  if (node.instance_id) it.instance_id = node.instance_id;
  if (node.version_id) it.version_id = node.version_id;
  if (node.history_id) it.history_id = node.history_id;
  return it;
}

async function startExport() {
  if (selectedFilesCount.value === 0 || isExporting.value) return;
  const filePaths = [...checked.value].filter((p) => findNodeByPath(p) && !findNodeByPath(p).is_directory);

  const segs = commonPrefixSegs(filePaths);
  const prefixStr = segs.length ? '/' + segs.join('/') : '';
  const name = segs.length ? segs[segs.length - 1] : '数据空间导出';

  const items: any[] = [];
  for (const p of filePaths) {
    const node = findNodeByPath(p);
    if (!node) continue;
    const rel = prefixStr ? p.slice(prefixStr.length) : p;
    items.push(toItem(node, rel));
  }

  isExporting.value = true;
  try {
    const result = await dataExportApi.exportDataspace({ name, items });
    showToast('success', `已导出 ${result.count || items.length} 个文件`);
    if (result.download_url) downloadPath(result.download_url);
    await loadHistory();
  } catch (e: any) {
    showToast('error', e.message || '导出失败');
  } finally {
    isExporting.value = false;
  }
}

function downloadPath(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== 历史 =====
async function loadHistory() {
  try {
    exportHistory.value = await dataExportApi.history();
  } catch { /* ignore */ }
}

// ===== 数据加载 =====
async function refreshTree() {
  loading.value = true;
  try {
    const data = await dataSpaceApi.tree();
    treeData.value = data.nodes || [];
    const s = new Set<string>(['/实例文件', '/云文件', '/网页空间', '/版本历史', '/操作记录']);
    for (const node of treeData.value) {
      if (node.is_directory) s.add(node.path);
    }
    expanded.value = s;
    applyPreselect();
  } catch (e: any) {
    showToast('error', e.message || '加载失败');
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

function applyPreselect() {
  const dir = String(route.query.dir || '');
  const file = String(route.query.file || '');
  let target = dir || file;
  if (!target) return;
  const node = findNodeByPath(target);
  if (!node) return;
  // 展开目标所在路径的所有父级
  const exp = new Set(expanded.value);
  let cur = dir || (file ? dirOf(file) : '');
  while (cur && cur !== '/') {
    if (findNodeByPath(cur)) exp.add(cur);
    cur = dirOf(cur);
  }
  exp.add(node.path);
  expanded.value = exp;
  // 勾选目标：目录勾选整个子树，文件仅勾选自身
  const chk = new Set(checked.value);
  if (node.is_directory) getDescendantPaths(node).forEach((p) => chk.add(p));
  else chk.add(node.path);
  checked.value = chk;
}

// ===== 工具 =====
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fileIcon(node: any): string {
  const ft = node.file_type || (node.data && node.data.file_type) || '';
  const map: Record<string, string> = {
    html: 'ri-html5-line', css: 'ri-css3-line', js: 'ri-javascript-line', json: 'ri-braces-line',
    md: 'ri-markdown-line', txt: 'ri-file-text-line', png: 'ri-image-line', jpg: 'ri-image-line',
    jpeg: 'ri-image-line', gif: 'ri-image-line', svg: 'ri-image-line', pdf: 'ri-file-pdf-line',
    zip: 'ri-file-zip-line', config: 'ri-settings-3-line', version: 'ri-git-branch-line',
    history: 'ri-history-line', ea2: 'ri-file-list-3-line',
  };
  return map[ft] || 'ri-file-line';
}

const toast = ref<{ type: string; message: string } | null>(null);
function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => { toast.value = null; }, 3000);
}

onMounted(async () => {
  await Promise.all([refreshTree(), loadHistory()]);
});
</script>

<style scoped>
.data-export-page {
  padding: var(--spacer-5);
  max-width: 1300px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacer-4);
  margin-bottom: var(--spacer-5);
}

.page-title { font-size: var(--font-size-2xl); font-weight: 700; color: var(--text-primary); margin: 0; }
.page-description { font-size: var(--font-size-sm); color: var(--text-tertiary); margin-top: var(--spacer-1); }

.page-header-right { display: flex; gap: var(--spacer-2); }

.export-layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--spacer-5);
}

@media (max-width: 1024px) {
  .export-layout { grid-template-columns: 1fr; }
}

.panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}
.panel-title { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); margin: 0; }
.panel-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.panel-body { padding: var(--spacer-3); }

/* 文件树 */
.tree-body { max-height: 600px; overflow-y: auto; padding: var(--spacer-2); }
.tree-node {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-1);
  border-radius: var(--radius-sm);
  transition: background var(--fast-duration);
  user-select: none;
}
.tree-node:hover { background: var(--subtle-secondary); }
.tree-node.is-dir { font-weight: 500; color: var(--text-primary); }
.check { display: inline-flex; align-items: center; flex-shrink: 0; }
.check input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--accent-base); cursor: pointer; margin: 0; }
.chev { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; background: transparent; border: none; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; padding: 0; }
.chev-placeholder { width: 16px; height: 16px; flex-shrink: 0; }
.node-icon { flex-shrink: 0; color: var(--text-tertiary); }
.node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.tree-node.is-dir .node-name { color: var(--text-primary); }
.node-badge { font-size: 10px; font-weight: 500; padding: 0 6px; height: 18px; line-height: 18px; border-radius: var(--radius-full); flex-shrink: 0; background: var(--accent-bg); color: var(--accent-base); }
.node-size { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.ft-loading { display: flex; flex-direction: column; align-items: center; gap: var(--spacer-1); padding: var(--spacer-4); color: var(--text-tertiary); font-size: var(--font-size-xs); }
.empty-state-sm { text-align: center; padding: var(--spacer-4); font-size: var(--font-size-sm); color: var(--text-tertiary); }
.loading-ring { width: 20px; height: 20px; border: 2px solid var(--divider-stroke); border-top-color: var(--accent-base); border-radius: 50%; animation: spin 0.8s linear infinite; }

/* 右侧 */
.export-sidebar { display: flex; flex-direction: column; gap: var(--spacer-4); }
.sel-summary { display: flex; flex-direction: column; gap: var(--spacer-2); margin-bottom: var(--spacer-4); }
.sel-row { font-size: var(--font-size-sm); color: var(--text-secondary); }
.sel-row strong { color: var(--accent-base); font-weight: 600; }
.sel-label { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: var(--spacer-2); }
.sel-list { display: flex; flex-direction: column; gap: 2px; max-height: 140px; overflow-y: auto; }
.sel-item { font-size: var(--font-size-xs); color: var(--text-primary); background: var(--subtle-secondary); padding: var(--spacer-1) var(--spacer-2); border-radius: var(--radius-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.form-actions { padding-top: var(--spacer-4); border-top: 1px solid var(--divider-stroke); }
.btn-large { width: 100%; }
.export-note { margin-top: var(--spacer-3); font-size: var(--font-size-xs); color: var(--text-tertiary); }

/* 历史 */
.history-list { display: flex; flex-direction: column; gap: var(--spacer-2); max-height: 280px; overflow-y: auto; }
.history-item { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2); border-radius: var(--radius-sm); transition: background var(--fast-duration); }
.history-item:hover { background: var(--subtle-secondary); }
.history-icon { font-size: 16px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); flex-shrink: 0; }
.history-icon.completed { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.history-content { flex: 1; min-width: 0; }
.history-name { font-size: var(--font-size-sm); font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.history-meta { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 2px; }
.icon-btn-sm { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: var(--radius-sm); color: var(--text-tertiary); cursor: pointer; transition: background var(--fast-duration), color var(--fast-duration); }
.icon-btn-sm:hover { background: var(--subtle-secondary); color: var(--accent-base); }

/* 按钮 */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); font-size: var(--font-size-sm); font-weight: 600; border: none; border-radius: var(--radius-md); cursor: pointer; transition: background var(--fast-duration), opacity var(--fast-duration); font-family: var(--font-family); }
.btn-sm { padding: var(--spacer-1) var(--spacer-3); font-size: var(--font-size-xs); }
.btn-secondary { background: var(--subtle-secondary); color: var(--text-primary); }
.btn-secondary:hover:not(:disabled) { background: var(--subtle-pressed); }
.btn-primary { background: var(--accent-base); color: var(--accent-text); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Toast */
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); z-index: 600; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); animation: slideUp var(--fast-duration); }
.toast-success { background: #10893e; color: white; }
.toast-error { background: var(--status-error); color: white; }
@keyframes slideUp { from { transform: translateX(-50%) translateY(16px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
</style>