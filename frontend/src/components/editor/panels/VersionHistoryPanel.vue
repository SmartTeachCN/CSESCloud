<template>
  <div class="version-panel">
    <div class="panel-header">
      <Icon icon="ri-git-branch-line" :size="14" />
      <span>版本历史</span>
      <span class="version-count" v-if="versions.length">{{ versions.length }} 个版本</span>
      <button class="refresh-btn" @click="loadVersions" title="刷新">
        <Icon icon="ri-refresh-line" :size="12" />
      </button>
    </div>

    <div class="version-body">
      <div v-if="loading" class="loading-state">
        <Icon icon="ri-loader-4-line" :size="20" class="spin" />
        <span>加载中...</span>
      </div>
      <div v-else-if="versions.length === 0" class="empty-state">
        <Icon icon="ri-inbox-line" :size="32" />
        <p>暂无版本历史</p>
        <p class="empty-hint">保存文件后将自动创建版本</p>
      </div>
      <div v-else class="version-content">
        <!-- 版本列表 -->
        <div class="version-list">
          <div
            v-for="(ver, i) in versions"
            :key="ver.id ?? i"
            class="version-item"
            :class="{
              expanded: expandedId === ver.id,
              selected: diffSelected.includes(ver.id),
              latest: i === 0,
            }"
          >
            <div class="version-row" @click="toggleVersion(ver)">
              <div class="version-check" @click.stop="toggleDiffSelect(ver.id)" v-if="diffMode">
                <Icon :icon="diffSelected.includes(ver.id) ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'" :size="14" />
              </div>
              <div class="version-dot" :class="{ current: i === 0 }"></div>
              <div class="version-info">
                <div class="version-label">
                  {{ ver.version_label || ver.label || 'v' + (versions.length - i) }}
                  <span v-if="i === 0" class="latest-badge">最新</span>
                </div>
                <div class="version-time">
                  <Icon icon="ri-time-line" :size="10" />
                  {{ formatTime(ver.created_at || ver.time) }}
                </div>
              </div>
              <div class="version-actions-compact" v-if="expandedId === ver.id">
                <button class="mini-btn restore" @click.stop="confirmRestore(ver)" title="恢复到此版本">
                  <Icon icon="ri-arrow-go-back-line" :size="12" />
                </button>
                <button class="mini-btn" :class="{ active: diffSelected.includes(ver.id) }" @click.stop="toggleDiffSelect(ver.id)" title="选择对比">
                  <Icon icon="ri-contrast-2-line" :size="12" />
                </button>
                <button v-if="isOwner" class="mini-btn danger" @click.stop="confirmDelete(ver)" title="删除版本">
                  <Icon icon="ri-delete-bin-line" :size="12" />
                </button>
              </div>
              <Icon
                :icon="expandedId === ver.id ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"
                :size="14"
                class="expand-icon"
              />
            </div>

            <div v-if="expandedId === ver.id" class="version-preview">
              <div v-if="loadingPreview" class="preview-loading">
                <Icon icon="ri-loader-4-line" :size="14" class="spin" />
                <span>加载内容...</span>
              </div>
              <div v-else-if="!ver.hasContent" class="preview-archived">
                <Icon icon="ri-archive-line" :size="14" />
                <span>内容已归档（仅保留条目）</span>
              </div>
              <div v-else class="preview-content">
                <pre>{{ previewContent }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Diff 模式工具栏 -->
        <div v-if="diffMode && diffSelected.length === 2" class="diff-toolbar">
          <div class="diff-toolbar-info">
            <span>对比: </span>
            <strong>{{ getVersionLabel(diffSelected[0]) }}</strong>
            <Icon icon="ri-arrow-right-line" :size="12" />
            <strong>{{ getVersionLabel(diffSelected[1]) }}</strong>
          </div>
          <div class="diff-toolbar-actions">
            <button class="diff-btn" @click="loadDiff" :disabled="diffLoading">
              <Icon icon="ri-contrast-2-line" :size="12" />
              {{ diffLoading ? '加载中...' : '查看差异' }}
            </button>
            <button class="diff-btn secondary" @click="clearDiff">
              <Icon icon="ri-close-line" :size="12" />
            </button>
          </div>
        </div>
      </div>

      <!-- 工作区配置链接 -->
      <div class="panel-footer-link">
        <button class="config-link" @click="$emit('openWorkspaceConfig')">
          <Icon icon="ri-settings-3-line" :size="12" />
          <span>工作区配置</span>
        </button>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteConfirm" class="confirm-overlay" @click.self="showDeleteConfirm = false">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <Icon icon="ri-alert-line" :size="16" />
          <span>删除确认</span>
        </div>
        <div class="confirm-body">
          <p>确定要删除版本 <strong>{{ pendingDelete?.version_label || '未知版本' }}</strong> 吗？</p>
          <p class="confirm-warning">此操作不可撤销。</p>
        </div>
        <div class="confirm-footer">
          <button class="btn-cancel" @click="showDeleteConfirm = false">取消</button>
          <button class="btn-confirm-danger" @click="doDelete">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 恢复确认弹窗 -->
    <div v-if="showRestoreConfirm" class="confirm-overlay" @click.self="showRestoreConfirm = false">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <Icon icon="ri-alert-line" :size="16" />
          <span>恢复确认</span>
        </div>
        <div class="confirm-body">
          <p>确定要恢复到版本 <strong>{{ pendingRestore?.version_label || '未知版本' }}</strong> 吗？</p>
          <p class="confirm-warning">当前内容将被替换，建议先保存当前版本。</p>
        </div>
        <div class="confirm-footer">
          <button class="btn-cancel" @click="showRestoreConfirm = false">取消</button>
          <button class="btn-confirm" @click="doRestore">确认恢复</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{
  fileId: string;
  fileName: string;
  /** 当前文件内容（用于自动保存版本） */
  currentContent?: string;
  /** 是否为持有者（可删除版本） */
  isOwner?: boolean;
  /** 工作区标识 */
  workspaceKey?: string;
}>();

const emit = defineEmits<{
  restore: [content: string, versionLabel: string];
  /** 请求保存版本 */
  saveVersion: [content: string, label: string];
  /** 打开工作区配置 */
  openWorkspaceConfig: [];
  /** 在编辑器区域打开 diff 标签 */
  viewDiff: [payload: { label1: string; label2: string; diffLines: any[]; additions: number; deletions: number }];
}>();

const versions = ref<any[]>([]);
const loading = ref(false);
const expandedId = ref<number | null>(null);
const previewContent = ref('');
const loadingPreview = ref(false);

// Diff 模式
const diffMode = ref(false);
const diffSelected = ref<number[]>([]);
const diffLoading = ref(false);

// 删除/恢复
const showDeleteConfirm = ref(false);
const pendingDelete = ref<any>(null);
const showRestoreConfirm = ref(false);
const pendingRestore = ref<any>(null);

// 工作区配置
const config = ref({
  version_entry_limit: 30,
  version_file_limit: 10,
});

// 确保 isOwner 默认为 true
const isOwner = computed(() => props.isOwner !== false);

function formatTime(t: string): string {
  if (!t) return '';
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return t; }
}

function getVersionLabel(id: number): string {
  const v = versions.value.find(x => x.id === id);
  return v?.version_label || v?.label || 'v?';
}

async function loadConfig() {
  try {
    const wk = props.workspaceKey || 'light_editor';
    const result = await api.get<any>(`/cloud-files?action=workspace-config&workspace=${wk}`);
    if (result) {
      config.value = {
        version_entry_limit: result.version_entry_limit ?? 30,
        version_file_limit: result.version_file_limit ?? 10,
      };
    }
  } catch { /* use defaults */ }
}

async function loadVersions() {
  if (!props.fileId) return;
  loading.value = true;
  try {
    const result = await api.get<any[]>(`/cloud-files?action=version-list&file_id=${props.fileId}`);
    versions.value = Array.isArray(result) ? result : [];
  } catch {
    versions.value = [];
  } finally {
    loading.value = false;
  }
}

async function toggleVersion(ver: any) {
  if (expandedId.value === ver.id) {
    expandedId.value = null;
    previewContent.value = '';
    return;
  }
  expandedId.value = ver.id;
  loadingPreview.value = true;
  previewContent.value = '';
  try {
    const result = await api.get<any>(`/cloud-files?action=version-get&version_id=${ver.id}`);
    const content = result?.content;
    if (content === null || content === undefined) {
      ver.hasContent = false;
      previewContent.value = '';
    } else {
      ver.hasContent = true;
      previewContent.value = content || '';
    }
  } catch {
    previewContent.value = '[加载失败]';
  } finally {
    loadingPreview.value = false;
  }
}

function toggleDiffSelect(id: number) {
  const idx = diffSelected.value.indexOf(id);
  if (idx >= 0) {
    diffSelected.value.splice(idx, 1);
  } else {
    diffSelected.value.push(id);
    if (diffSelected.value.length > 2) {
      diffSelected.value.shift();
    }
  }
  diffMode.value = diffSelected.value.length === 2;
}

function clearDiff() {
  diffSelected.value = [];
  diffMode.value = false;
}

async function loadDiff() {
  if (diffSelected.value.length !== 2) return;
  diffLoading.value = true;
  try {
    const [v1, v2] = diffSelected.value;
    const result = await api.get<any>(`/cloud-files?action=version-diff&v1=${v1}&v2=${v2}`);
    const diffLines = computeDiff(result?.content1 || '', result?.content2 || '');
    let additions = 0, deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'add') additions++;
      else if (line.type === 'del') deletions++;
    }
    const label1 = getVersionLabel(v1);
    const label2 = getVersionLabel(v2);
    emit('viewDiff', {
      label1, label2,
      diffLines, additions, deletions,
    });
    // 清除选择状态
    clearDiff();
  } catch {
    // 静默失败
  } finally {
    diffLoading.value = false;
  }
}

/**
 * 简单的行级 diff 算法（LCS-based unified diff）
 */
function computeDiff(oldText: string, newText: string): any[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // 构建 LCS 表
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成 diff
  const result: any[] = [];
  let i = m, j = n;
  const temp: any[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({ type: 'same', oldNum: i, newNum: j, text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: 'add', oldNum: null, newNum: j, text: newLines[j - 1] });
      j--;
    } else {
      temp.push({ type: 'del', oldNum: i, newNum: null, text: oldLines[i - 1] });
      i--;
    }
  }

  // 反转并添加上下文行（每段 diff 前后各 3 行）
  const reversed = temp.reverse();
  const withContext: any[] = [];
  const contextSize = 3;

  for (let k = 0; k < reversed.length; k++) {
    const line = reversed[k];
    if (line.type !== 'same') {
      // 向前添加 context
      const start = Math.max(0, k - contextSize);
      for (let c = start; c < k; c++) {
        if (reversed[c].type === 'same' && !withContext.includes(reversed[c])) {
          withContext.push({ ...reversed[c], type: 'context' });
        }
      }
      withContext.push(line);
      // 向后添加 context
      const end = Math.min(reversed.length, k + contextSize + 1);
      for (let c = k + 1; c < end; c++) {
        if (reversed[c].type === 'same') {
          withContext.push({ ...reversed[c], type: 'context' });
        } else {
          break; // 遇到下一个变更就停止
        }
      }
    }
  }

  return withContext;
}

function confirmDelete(ver: any) {
  pendingDelete.value = ver;
  showDeleteConfirm.value = true;
}

async function doDelete() {
  if (!pendingDelete.value) return;
  const ver = pendingDelete.value;
  showDeleteConfirm.value = false;
  try {
    await api.post('/cloud-files?action=version-delete', { version_id: ver.id });
    versions.value = versions.value.filter(v => v.id !== ver.id);
    if (expandedId.value === ver.id) {
      expandedId.value = null;
      previewContent.value = '';
    }
    diffSelected.value = diffSelected.value.filter(id => id !== ver.id);
    if (diffSelected.value.length < 2) {
      diffMode.value = false;
      diffLines.value = [];
    }
  } catch (e: any) {
    alert(e?.message || '删除失败');
  }
  pendingDelete.value = null;
}

function confirmRestore(ver: any) {
  pendingRestore.value = ver;
  showRestoreConfirm.value = true;
}

async function doRestore() {
  if (!pendingRestore.value) return;
  const ver = pendingRestore.value;
  showRestoreConfirm.value = false;

  if (!previewContent.value || previewContent.value === '[加载失败]') {
    try {
      const result = await api.get<any>(`/cloud-files?action=version-get&version_id=${ver.id}`);
      previewContent.value = result?.content || '';
    } catch {
      return;
    }
  }

  emit('restore', previewContent.value, ver.version_label || ver.label || '');
  expandedId.value = null;
  previewContent.value = '';
  pendingRestore.value = null;
}

/** 保存新版本（由父组件在保存时调用） */
async function saveVersion(content: string, label?: string) {
  if (!props.fileId) return;
  const versionLabel = label || `自动保存 ${new Date().toLocaleString('zh-CN')}`;
  try {
    await api.post('/cloud-files?action=version-save', {
      file_id: parseInt(props.fileId),
      file_name: props.fileName,
      content,
      version_label: versionLabel,
    });
    // 重新加载版本列表
    await loadVersions();
  } catch {
    // 静默失败
  }
}

watch(() => props.fileId, () => {
  if (props.fileId) {
    loadVersions();
    loadConfig();
  }
});

onMounted(() => {
  if (props.fileId) {
    loadVersions();
    loadConfig();
  }
});

defineExpose({ saveVersion, loadVersions });
</script>

<style scoped>
.version-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--layer-default);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.version-count {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  padding: 0 6px;
  border-radius: var(--radius-full);
  margin-left: 4px;
}

.refresh-btn {
  margin-left: auto;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.refresh-btn:hover {
  background: var(--subtle-secondary);
  color: var(--accent-base);
}

.version-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-tertiary);
  gap: var(--spacer-2);
  font-size: var(--font-size-xs);
}
.empty-hint {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 0;
}

.version-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-2);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-item {
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid transparent;
}
.version-item.expanded {
  background: var(--subtle-secondary);
  border-color: var(--divider-stroke);
}
.version-item.latest {
  border-left: 2px solid var(--accent-base);
}

.version-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: 6px var(--spacer-1);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--fast-duration);
}
.version-row:hover {
  background: var(--subtle-secondary);
}
.version-item.expanded .version-row {
  background: transparent;
}

.version-check {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.version-check:hover {
  color: var(--accent-base);
}

.version-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-tertiary);
  flex-shrink: 0;
}
.version-dot.current {
  background: var(--accent-base);
}

.version-info {
  flex: 1;
  min-width: 0;
}
.version-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 4px;
}
.latest-badge {
  font-size: 9px;
  font-weight: 500;
  color: var(--accent-base);
  background: var(--accent-bg);
  padding: 0 4px;
  border-radius: var(--radius-xs);
}
.version-time {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.version-actions-compact {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.mini-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}
.mini-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}
.mini-btn.restore:hover {
  background: var(--accent-base);
  border-color: var(--accent-base);
  color: white;
}
.mini-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent-base);
  color: var(--accent-base);
}
.mini-btn.danger:hover {
  background: var(--status-error);
  border-color: var(--status-error);
  color: white;
}

.expand-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.version-preview {
  padding: 0 var(--spacer-1) var(--spacer-2);
}

.preview-loading {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.preview-archived {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  background: var(--ctrl-fill-default);
  border-radius: var(--radius-sm);
}

.preview-content {
  max-height: 180px;
  overflow-y: auto;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  padding: var(--spacer-1);
}
.preview-content pre {
  margin: 0;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

/* Diff 工具栏 */
.diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  gap: var(--spacer-2);
}
.diff-toolbar-info {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}
.diff-toolbar-actions {
  display: flex;
  gap: 4px;
}
.diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: white;
  cursor: pointer;
}
.diff-btn:hover {
  background: var(--accent-hover);
}
.diff-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.diff-btn.secondary {
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  color: var(--text-secondary);
  padding: 0 6px;
}
.diff-btn.secondary:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

/* 确认弹窗 */
.confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.confirm-dialog {
  width: 280px;
  background: var(--layer-default);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
.confirm-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--status-warning);
}
.confirm-body {
  padding: var(--spacer-2) var(--spacer-3);
}
.confirm-body p {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  margin: 0 0 var(--spacer-1);
}
.confirm-warning {
  color: var(--text-tertiary) !important;
  font-size: 11px !important;
}
.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
}
.btn-cancel {
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
}
.btn-cancel:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}
.btn-confirm {
  height: 28px;
  padding: 0 12px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: white;
  cursor: pointer;
}
.btn-confirm:hover {
  background: var(--accent-hover);
}
.btn-confirm-danger {
  height: 28px;
  padding: 0 12px;
  background: var(--status-error);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: white;
  cursor: pointer;
}
.btn-confirm-danger:hover {
  background: #a41e1e;
}

/* 工作区配置链接 */
.panel-footer-link {
  padding: var(--spacer-1) var(--spacer-2);
  border-top: 1px solid var(--divider-stroke);
  text-align: center;
  flex-shrink: 0;
}
.config-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
}
.config-link:hover {
  background: var(--subtle-secondary);
  color: var(--accent-base);
  border-color: var(--accent-base);
}
</style>