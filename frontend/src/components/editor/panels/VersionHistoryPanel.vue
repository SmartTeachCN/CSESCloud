<template>
  <div class="version-panel">
    <div class="panel-header">
      <Icon icon="ri-git-branch-line" :size="14" />
      <span>版本历史</span>
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
      </div>
      <div v-else class="version-list">
        <div
          v-for="(ver, i) in versions"
          :key="ver.id ?? i"
          class="version-item"
          :class="{ expanded: expandedId === ver.id }"
        >
          <div class="version-row" @click="toggleVersion(ver)">
            <div class="version-dot" :class="{ current: i === 0 }"></div>
            <div class="version-info">
              <div class="version-label">{{ ver.label || ver.version || 'v' + (i + 1) }}</div>
              <div class="version-time">
                <Icon icon="ri-time-line" :size="10" />
                {{ ver.created_at || ver.time }}
              </div>
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
            <div v-else class="preview-content">
              <pre>{{ previewContent }}</pre>
            </div>
            <div class="preview-actions">
              <button class="btn-restore" @click="confirmRestore(ver)">
                <Icon icon="ri-arrow-go-back-line" :size="12" />
                <span>恢复到此版本</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 确认弹窗 -->
    <div v-if="showConfirm" class="confirm-overlay" @click.self="showConfirm = false">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <Icon icon="ri-alert-line" :size="16" />
          <span>恢复确认</span>
        </div>
        <div class="confirm-body">
          <p>确定要恢复到版本 <strong>{{ pendingVersion?.label || '未知版本' }}</strong> 吗？</p>
          <p class="confirm-warning">当前内容将被替换，此操作不可撤销。</p>
        </div>
        <div class="confirm-footer">
          <button class="btn-cancel" @click="showConfirm = false">取消</button>
          <button class="btn-confirm" @click="doRestore">确认恢复</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{
  fileId: string;
  fileName: string;
}>();

const emit = defineEmits<{
  restore: [content: string, versionLabel: string];
}>();

const versions = ref<any[]>([]);
const loading = ref(false);
const expandedId = ref<number | null>(null);
const previewContent = ref('');
const loadingPreview = ref(false);
const showConfirm = ref(false);
const pendingVersion = ref<any>(null);

async function loadVersions() {
  loading.value = true;
  try {
    const result = await api.get<any[]>('/cloud-files.php?action=version-list&file_id=' + props.fileId);
    versions.value = Array.isArray(result) ? result.slice(0, 10) : [];
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
    const result = await api.get<any>('/cloud-files.php?action=version-get&version_id=' + ver.id);
    previewContent.value = result?.content || result?.data || '';
  } catch {
    previewContent.value = '[加载失败]';
  } finally {
    loadingPreview.value = false;
  }
}

function confirmRestore(ver: any) {
  pendingVersion.value = ver;
  showConfirm.value = true;
}

async function doRestore() {
  if (!pendingVersion.value) return;
  const ver = pendingVersion.value;
  showConfirm.value = false;

  // 确保已加载内容
  if (!previewContent.value || previewContent.value === '[加载失败]') {
    try {
      const result = await api.get<any>('/cloud-files.php?action=version-get&version_id=' + ver.id);
      previewContent.value = result?.content || result?.data || '';
    } catch {
      return;
    }
  }

  emit('restore', previewContent.value, ver.label || ver.version || '');
  expandedId.value = null;
  previewContent.value = '';
  pendingVersion.value = null;
}

onMounted(() => {
  if (props.fileId) loadVersions();
});
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
  overflow-y: auto;
  padding: var(--spacer-2);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  gap: var(--spacer-2);
  font-size: var(--font-size-xs);
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-item {
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.version-item.expanded {
  background: var(--subtle-secondary);
}

.version-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: 8px var(--spacer-1);
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
}

.version-time {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
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

.preview-content {
  max-height: 200px;
  overflow-y: auto;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  padding: var(--spacer-1);
  margin-bottom: var(--spacer-1);
}

.preview-content pre {
  margin: 0;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-restore {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: white;
  cursor: pointer;
}

.btn-restore:hover {
  background: var(--accent-hover);
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

</style>