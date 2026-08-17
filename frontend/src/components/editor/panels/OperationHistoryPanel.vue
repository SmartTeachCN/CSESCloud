<template>
  <div class="op-history-panel">
    <div class="panel-header">
      <Icon icon="ri-history-line" :size="14" />
      <span>操作记录</span>
      <span class="op-count" v-if="totalCount">{{ totalCount }} 条记录</span>
      <button class="refresh-btn" @click="loadCloudHistory" title="刷新" v-if="fileId && isLoggedIn">
        <Icon icon="ri-refresh-line" :size="12" />
      </button>
    </div>

    <div class="op-history-body">
      <!-- 云备份区域 -->
      <div v-if="fileId && isLoggedIn" class="section">
        <div class="section-title">
          <Icon icon="ri-cloud-line" :size="12" />
          <span>云备份</span>
          <span class="section-badge">最近 {{ cloudLimit }} 条</span>
        </div>
        <div v-if="loadingCloud" class="loading-state">
          <Icon icon="ri-loader-4-line" :size="16" class="spin" />
          <span>加载中...</span>
        </div>
        <div v-else-if="cloudHistory.length === 0" class="empty-hint">
          <span>暂无云备份记录</span>
        </div>
        <div v-else class="history-list">
          <div
            v-for="(item, i) in cloudHistory"
            :key="'cloud-' + (item.id ?? i)"
            class="history-item cloud-item"
            :class="{ active: restoringId === item.id }"
            @click="previewRestore('cloud', item)"
          >
            <div class="item-icon">
              <Icon :icon="getActionIcon(item.action_type)" :size="14" />
            </div>
            <div class="item-content">
              <div class="item-action">{{ item.action_label || item.action_type }}</div>
              <div class="item-time">
                <Icon icon="ri-time-line" :size="10" />
                {{ formatTime(item.created_at || item.time) }}
              </div>
            </div>
            <div v-if="restoringId === item.id" class="item-actions">
              <button class="action-btn restore-btn" @click.stop="confirmRestore('cloud', item)" v-if="item.content_snapshot">
                <Icon icon="ri-arrow-go-back-line" :size="12" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 本地记录区域 -->
      <div class="section">
        <div class="section-title">
          <Icon icon="ri-computer-line" :size="12" />
          <span>本地记录</span>
          <span class="section-badge">最近 {{ localLimit }} 条</span>
        </div>
        <div v-if="localHistory.length === 0" class="empty-hint">
          <span>暂无本地记录</span>
        </div>
        <div v-else class="history-list">
          <div
            v-for="(item, i) in localHistory"
            :key="'local-' + (item.id ?? i)"
            class="history-item local-item"
            :class="{ active: restoringId === item.id }"
            @click="previewRestore('local', item)"
          >
            <div class="item-icon">
              <Icon :icon="getActionIcon(item.action_type)" :size="14" />
            </div>
            <div class="item-content">
              <div class="item-action">{{ item.action_label || item.action_type }}</div>
              <div class="item-time">
                <Icon icon="ri-time-line" :size="10" />
                {{ formatTime(item.time || item.created_at) }}
              </div>
            </div>
            <div v-if="restoringId === item.id && item.content_snapshot" class="item-actions">
              <button class="action-btn restore-btn" @click.stop="confirmRestore('local', item)">
                <Icon icon="ri-arrow-go-back-line" :size="12" />
              </button>
            </div>
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

    <!-- 恢复确认弹窗 -->
    <div v-if="showConfirm" class="confirm-overlay" @click.self="showConfirm = false">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <Icon icon="ri-alert-line" :size="16" />
          <span>恢复确认</span>
        </div>
        <div class="confirm-body">
          <p>确定要恢复到此操作记录吗？</p>
          <p class="confirm-warning">
            <Icon icon="ri-error-warning-line" :size="12" />
            当前编辑器内容将被替换为此快照内容
          </p>
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
import { ref, onMounted, watch } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{
  fileId: string;
  fileName: string;
  localHistory: Array<{ id?: number; action_type: string; action_label: string; content_snapshot?: string; time: string }>;
  isLoggedIn: boolean;
  workspaceKey?: string;
}>();

const emit = defineEmits<{
  restore: [content: string];
  /** 请求记录操作日志到云端 */
  logOperation: [payload: { action_type: string; action_label: string; content_snapshot?: string }];
  /** 打开工作区配置 */
  openWorkspaceConfig: [];
}>();

const cloudHistory = ref<any[]>([]);
const loadingCloud = ref(false);
const restoringId = ref<number | null>(null);
const showConfirm = ref(false);
const pendingRestore = ref<{ type: 'cloud' | 'local'; item: any } | null>(null);

const cloudLimit = ref(50);
const localLimit = ref(100);
const totalCount = ref(0);

function getActionIcon(type: string): string {
  const icons: Record<string, string> = {
    'edit': 'ri-edit-line',
    'save': 'ri-save-line',
    'open': 'ri-folder-open-line',
    'close': 'ri-close-line',
    'create': 'ri-file-add-line',
    'delete': 'ri-delete-bin-line',
    'undo': 'ri-arrow-go-back-line',
    'redo': 'ri-arrow-go-forward-line',
    'import': 'ri-download-line',
    'export': 'ri-upload-2-line',
    'restore': 'ri-arrow-go-back-line',
    'rename': 'ri-edit-line',
    'share': 'ri-share-forward-line',
    'auto_save': 'ri-save-3-line',
  };
  return icons[type] || 'ri-record-circle-line';
}

function formatTime(t: string): string {
  if (!t) return '';
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return t; }
}

async function loadConfig() {
  try {
    const wk = props.workspaceKey || 'light_editor';
    const result = await api.get<any>(`/cloud-files?action=workspace-config&workspace=${wk}`);
    if (result) {
      cloudLimit.value = result.operation_cloud_limit ?? 50;
      localLimit.value = result.operation_local_limit ?? 100;
    }
  } catch { /* use defaults */ }
}

async function loadCloudHistory() {
  if (!props.fileId || !props.isLoggedIn) return;
  loadingCloud.value = true;
  try {
    const result = await api.get<any[]>(`/cloud-files?action=operation-list&file_id=${props.fileId}&limit=${cloudLimit.value}`);
    cloudHistory.value = Array.isArray(result) ? result : [];
    totalCount.value = cloudHistory.value.length + (props.localHistory?.length || 0);
  } catch {
    cloudHistory.value = [];
  } finally {
    loadingCloud.value = false;
  }
}

/** 记录操作到云端 */
async function logOperation(payload: { action_type: string; action_label: string; content_snapshot?: string }) {
  if (!props.fileId || !props.isLoggedIn) return;
  try {
    await api.post('/cloud-files?action=operation-log', {
      file_id: parseInt(props.fileId),
      file_name: props.fileName,
      action_type: payload.action_type,
      action_label: payload.action_label,
      content_snapshot: payload.content_snapshot || '',
    });
  } catch {
    // 静默失败
  }
}

function previewRestore(type: 'cloud' | 'local', item: any) {
  restoringId.value = restoringId.value === item.id ? null : item.id;
}

function confirmRestore(type: 'cloud' | 'local', item: any) {
  pendingRestore.value = { type, item };
  showConfirm.value = true;
}

async function doRestore() {
  if (!pendingRestore.value) return;
  const { type, item } = pendingRestore.value;
  showConfirm.value = false;

  if (type === 'cloud' && item.content_snapshot) {
    emit('restore', item.content_snapshot);
  } else if (type === 'local' && item.content_snapshot) {
    emit('restore', item.content_snapshot);
  }

  pendingRestore.value = null;
  restoringId.value = null;
}

watch(() => props.fileId, () => {
  if (props.fileId && props.isLoggedIn) {
    loadCloudHistory();
    loadConfig();
  }
});

onMounted(() => {
  if (props.fileId && props.isLoggedIn) {
    loadCloudHistory();
    loadConfig();
  }
});

defineExpose({ logOperation, loadCloudHistory });
</script>

<style scoped>
.op-history-panel {
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

.op-count {
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

.op-history-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-2);
}

.section {
  margin-bottom: var(--spacer-3);
}
.section:last-child {
  margin-bottom: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  padding-bottom: var(--spacer-1);
  margin-bottom: var(--spacer-1);
  border-bottom: 1px solid var(--divider-stroke);
}

.section-badge {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-left: auto;
  text-transform: none;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-1);
  padding: var(--spacer-3);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.empty-hint {
  text-align: center;
  padding: var(--spacer-2);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: 6px var(--spacer-1);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--fast-duration);
}
.history-item:hover {
  background: var(--subtle-secondary);
}
.history-item.active {
  background: var(--accent-bg);
  border: 1px solid var(--accent-base);
}
.cloud-item {
  border-left: 2px solid var(--accent-base);
}
.local-item {
  border-left: 2px solid var(--text-tertiary);
}

.item-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}
.item-action {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
  line-height: 1.3;
}
.item-time {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.item-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.action-btn {
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
.restore-btn:hover {
  background: var(--accent-base);
  border-color: var(--accent-base);
  color: white;
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
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--status-warning) !important;
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

/* 工作区配置链接 */
.panel-footer-link {
  padding: var(--spacer-1) var(--spacer-2);
  border-top: 1px solid var(--divider-stroke);
  text-align: center;
  flex-shrink: 0;
  margin-top: auto;
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