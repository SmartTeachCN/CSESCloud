<template>
  <div class="history-panel">
    <div class="panel-header">
      <Icon icon="ri-history-line" :size="14" />
      <span>编辑历史</span>
      <button class="refresh-btn" @click="loadHistory" title="刷新">
        <Icon icon="ri-refresh-line" :size="12" />
      </button>
    </div>
    <div class="history-list">
      <div v-if="loading" class="history-loading">
        <Icon icon="ri-loader-4-line" :size="20" class="spin" />
        <span>加载中...</span>
      </div>
      <div v-else-if="history.length === 0" class="empty-state">
        <Icon icon="ri-inbox-line" :size="32" />
        <p>暂无编辑历史</p>
      </div>
      <div v-else>
        <div v-for="(item, i) in history" :key="item.id ?? i" class="history-item">
          <div class="item-dot" :class="item.action"></div>
          <div class="item-body">
            <div class="item-title">{{ item.target || item.action }}</div>
            <div class="item-meta">
              <span class="item-user">
                <Icon icon="ri-user-line" :size="10" />
                {{ item.username || '系统' }}
              </span>
              <span class="item-time">{{ item.created_at }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{ instanceId: number }>();

const loading = ref(false);
const history = ref<any[]>([]);

async function loadHistory() {
  loading.value = true;
  try {
    // 拉取该实例相关的审计日志
    const rows = await api.get<any[]>(`/audit-log.php?action=instance&id=${props.instanceId}`);
    history.value = rows || [];
  } catch {
    history.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadHistory();
});
</script>

<style scoped>
.history-panel {
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

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-2);
}

.history-loading,
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

.history-item {
  display: flex;
  gap: var(--spacer-2);
  padding: var(--spacer-2) 0;
  position: relative;
}

.history-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 18px;
  bottom: -8px;
  width: 1px;
  background: var(--divider-stroke);
}

.item-dot {
  width: 9px;
  height: 9px;
  border-radius: var(--radius-full);
  background: var(--accent-base);
  border: 2px solid var(--layer-default);
  flex-shrink: 0;
  margin-top: 4px;
  z-index: 1;
}

.item-dot.create { background: var(--status-success); }
.item-dot.update { background: var(--accent-base); }
.item-dot.delete { background: var(--status-error); }
.item-dot.share { background: var(--status-warning); }

.item-body {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  font-weight: 500;
  line-height: 1.4;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.item-user {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

</style>
