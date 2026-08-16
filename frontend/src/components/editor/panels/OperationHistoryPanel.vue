<template>
  <div class="op-history-panel">
    <div class="panel-header">
      <Icon icon="ri-history-line" :size="14" />
      <span>操作记录</span>
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
          <span class="section-badge">最近 5 步</span>
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
            <div class="item-index">#{{ i + 1 }}</div>
            <div class="item-content">
              <div class="item-time">
                <Icon icon="ri-time-line" :size="10" />
                {{ item.time || item.created_at }}
              </div>
              <div class="item-preview">{{ truncate(item.content, 50) }}</div>
            </div>
            <div v-if="restoringId === item.id" class="item-actions">
              <button class="action-btn restore-btn" @click.stop="confirmRestore('cloud', item)">
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
          <span class="section-badge">最近 30 步</span>
        </div>
        <div v-if="localHistory.length === 0" class="empty-hint">
          <span>暂无本地记录</span>
        </div>
        <div v-else class="history-list">
          <div
            v-for="(item, i) in localHistory"
            :key="'local-' + (item.step ?? i)"
            class="history-item local-item"
            :class="{ active: restoringStep === item.step }"
            @click="restoringStep === item.step ? (restoringStep = null) : (restoringStep = item.step)"
          >
            <div class="item-index">#{{ item.step }}</div>
            <div class="item-content">
              <div class="item-time">
                <Icon icon="ri-time-line" :size="10" />
                {{ item.time }}
              </div>
              <div class="item-preview">{{ truncate(item.content, 50) }}</div>
            </div>
            <div v-if="restoringStep === item.step" class="item-actions">
              <button class="action-btn restore-btn" @click.stop="confirmRestore('local', item)">
                <Icon icon="ri-arrow-go-back-line" :size="12" />
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
          <p>确定要恢复到此版本吗？</p>
          <p class="confirm-warning">
            <Icon icon="ri-error-warning-line" :size="12" />
            若此时编辑将删除更新的记录
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
  localHistory: Array<{ step: number; content: string; time: string }>;
  isLoggedIn: boolean;
}>();

const emit = defineEmits<{
  restore: [content: string];
}>();

const cloudHistory = ref<any[]>([]);
const loadingCloud = ref(false);
const restoringId = ref<number | null>(null);
const restoringStep = ref<number | null>(null);
const showConfirm = ref(false);
const pendingRestore = ref<{ type: 'cloud' | 'local'; item: any } | null>(null);

function truncate(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

async function loadCloudHistory() {
  if (!props.fileId || !props.isLoggedIn) return;
  loadingCloud.value = true;
  try {
    const result = await api.get<any[]>('/cloud-files.php?action=history-list&file_id=' + props.fileId);
    cloudHistory.value = Array.isArray(result) ? result.slice(0, 5) : [];
  } catch {
    cloudHistory.value = [];
  } finally {
    loadingCloud.value = false;
  }
}

function previewRestore(type: 'cloud' | 'local', item: any) {
  if (type === 'cloud') {
    restoringId.value = restoringId.value === item.id ? null : item.id;
    restoringStep.value = null;
  } else {
    restoringStep.value = restoringStep.value === item.step ? null : item.step;
    restoringId.value = null;
  }
}

function confirmRestore(type: 'cloud' | 'local', item: any) {
  pendingRestore.value = { type, item };
  showConfirm.value = true;
}

async function doRestore() {
  if (!pendingRestore.value) return;
  const { type, item } = pendingRestore.value;
  showConfirm.value = false;

  if (type === 'cloud') {
    try {
      const result = await api.post<any>('/cloud-files.php?action=history-restore', { history_id: item.id });
      if (result && result.content) {
        emit('restore', result.content);
      }
    } catch {
      // 静默失败
    }
  } else {
    emit('restore', item.content);
  }

  pendingRestore.value = null;
  restoringId.value = null;
  restoringStep.value = null;
}

watch(() => props.fileId, () => {
  if (props.fileId && props.isLoggedIn) {
    loadCloudHistory();
  }
});

onMounted(() => {
  if (props.fileId && props.isLoggedIn) {
    loadCloudHistory();
  }
});
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

.item-index {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  min-width: 24px;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-time {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.item-preview {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: monospace;
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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>