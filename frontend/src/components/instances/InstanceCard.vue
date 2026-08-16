<template>
  <div
    class="instance-card"
    :class="{ selected, 'is-shared': instance.relation === 'shared' }"
    draggable="true"
    @click="$emit('click', instance)"
    @contextmenu="$emit('contextmenu', $event, instance)"
    @dragstart="$emit('dragstart', $event, instance)"
    @dragend="$emit('dragend', $event)"
  >
    <div class="card-header">
      <div class="card-checkbox" @click.stop="$emit('toggle-select')">
        <Icon v-if="selected" icon="ri-checkbox-line" :size="18" />
        <Icon v-else icon="ri-checkbox-blank-line" :size="18" />
      </div>
      <div class="instance-icon" :style="{ background: iconBg }">
        <Icon :icon="iconName" :size="24" />
      </div>
      <div class="instance-status" :class="instance.status">
        <span class="status-dot"></span>
        {{ statusLabel }}
      </div>
    </div>

    <div class="card-body">
      <div class="instance-name" :title="instance.name">{{ instance.name }}</div>
      <div class="instance-uid" :title="instance.instance_uid">
        <Icon icon="ri-hashtag" :size="11" />
        <span>{{ instance.instance_uid || ('#' + instance.id) }}</span>
      </div>
      <div v-if="instance.relation === 'shared'" class="shared-badge">
        <Icon icon="ri-share-line" :size="11" />
        <span>共享给我</span>
      </div>
    </div>

    <div class="card-footer">
      <span class="app-name">
        <Icon icon="ri-apps-2-line" :size="12" />
        {{ instance.app_name || instance.service_type || '自定义实例' }}
      </span>
      <Icon icon="ri-arrow-right-s-line" :size="16" class="enter-icon" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  instance: any;
  selected?: boolean;
}>();

defineEmits<{
  (e: 'click', instance: any): void;
  (e: 'contextmenu', event: MouseEvent, instance: any): void;
  (e: 'toggle-select'): void;
  (e: 'dragstart', event: DragEvent, instance: any): void;
  (e: 'dragend', event: DragEvent): void;
}>();

const statusLabel = computed(() => {
  switch (props.instance.status) {
    case 'running': return '运行中';
    case 'stopped': return '已停止';
    case 'error': return '错误';
    default: return props.instance.status || '未知';
  }
});

const iconName = computed(() => {
  const t = (props.instance.service_type || props.instance.app_category || '').toLowerCase();
  if (t.includes('nginx') || t.includes('web')) return 'ri-globe-line';
  if (t.includes('mysql') || t.includes('redis') || t.includes('数据库')) return 'ri-database-2-line';
  if (t.includes('cache')) return 'ri-flashlight-line';
  if (t.includes('mq') || t.includes('queue')) return 'ri-mail-line';
  if (t.includes('file') || t.includes('minio')) return 'ri-folder-line';
  if (t.includes('log')) return 'ri-bar-chart-line';
  if (t.includes('ai')) return 'ri-brain-line';
  return 'ri-cloud-line';
});

const iconBg = computed(() => {
  const colors = [
    'rgba(0,103,192,0.1)',
    'rgba(16,124,16,0.1)',
    'rgba(120,90,240,0.1)',
    'rgba(230,126,34,0.1)',
    'rgba(41,128,185,0.1)'
  ];
  const id = Number(props.instance.id) || 0;
  return colors[id % colors.length];
});
</script>

<style scoped>
.instance-card {
  position: relative;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
  cursor: pointer;
  transition: box-shadow var(--fast-duration), border-color var(--fast-duration), transform var(--fast-duration);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  user-select: none;
}

.instance-card:hover {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
  border-color: var(--accent-base);
}

.instance-card.selected {
  border-color: var(--accent-base);
  background: var(--accent-bg);
}

.instance-card.is-shared {
  border-style: dashed;
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.card-checkbox {
  color: var(--text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 2px;
}

.card-checkbox:hover {
  color: var(--accent-base);
}

.instance-card.selected .card-checkbox {
  color: var(--accent-base);
}

.instance-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.instance-status {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  font-weight: 500;
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-full);
  margin-left: auto;
}

.instance-status.running {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.instance-status.stopped {
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.instance-status.error {
  background: rgba(196, 43, 28, 0.1);
  color: var(--status-error);
}

.instance-status.running .status-dot {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.instance-name {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.instance-uid {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shared-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--accent-base);
  background: var(--accent-bg);
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  align-self: flex-start;
  margin-top: 2px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.app-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.enter-icon {
  color: var(--text-tertiary);
  transition: transform var(--fast-duration), color var(--fast-duration);
}

.instance-card:hover .enter-icon {
  transform: translateX(2px);
  color: var(--accent-base);
}
</style>
