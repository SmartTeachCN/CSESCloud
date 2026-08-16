<script setup lang="ts">
/**
 * 状态栏开发者扩展接口
 *
 * 插件可通过 window.__csesStatusBar.addItem(item) 注册状态栏项目
 * 注册的项目会显示在状态栏左侧，以分割线分隔
 *
 * item 格式: { id: string, label: string, icon?: string, onClick?: () => void, tooltip?: string }
 */
import { ref, onMounted, onUnmounted } from 'vue';

interface StatusBarItem {
  id: string;
  label: string;
  icon?: string;
  onClick?: () => void;
  tooltip?: string;
}

const items = ref<StatusBarItem[]>([]);

// 全局 API
const api = {
  addItem(item: StatusBarItem) {
    const existing = items.value.findIndex(i => i.id === item.id);
    if (existing >= 0) {
      items.value[existing] = item;
    } else {
      items.value.push(item);
    }
  },
  removeItem(id: string) {
    items.value = items.value.filter(i => i.id !== id);
  },
  clear() {
    items.value = [];
  },
  getItems() {
    return [...items.value];
  }
};

onMounted(() => {
  (window as any).__csesStatusBar = api;
});

onUnmounted(() => {
  if ((window as any).__csesStatusBar === api) {
    delete (window as any).__csesStatusBar;
  }
});
</script>

<template>
  <template v-if="items.length > 0">
    <span class="status-divider" />
    <template v-for="item in items" :key="item.id">
      <button
        v-if="item.onClick"
        class="status-item status-ext-item clickable"
        :title="item.tooltip || item.label"
        @click="item.onClick"
      >
        <Icon v-if="item.icon" :icon="item.icon" :size="10" />
        {{ item.label }}
      </button>
      <span v-else class="status-item status-ext-item" :title="item.tooltip || item.label">
        <Icon v-if="item.icon" :icon="item.icon" :size="10" />
        {{ item.label }}
      </span>
    </template>
  </template>
</template>

<style scoped>
.status-divider {
  width: 1px;
  height: 14px;
  background: var(--divider-stroke);
  align-self: center;
}
.status-ext-item {
  font-size: 10px;
  color: var(--text-tertiary);
}
.status-ext-item.clickable {
  cursor: pointer;
  background: transparent;
  border: none;
  padding: 0;
  font-family: inherit;
}
.status-ext-item.clickable:hover {
  color: var(--text-primary);
}
</style>