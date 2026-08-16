<template>
  <Teleport to="body">
    <transition name="drawer-slide">
      <div v-if="visible" class="ai-drawer-overlay" @click.self="close">
        <div class="ai-drawer">
          <div class="drawer-header">
            <div class="header-title">
              <Icon icon="ri-brain-line" :size="18" />
              <span>AI 助理</span>
              <span class="scope-badge">{{ scopeLabel }}</span>
            </div>
            <button class="close-btn" @click="close">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="drawer-body">
            <AiAssistantPanel :scope="scope" :scope-ref="scopeRef" />
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AiAssistantPanel from './editor/panels/AiAssistantPanel.vue';

const props = defineProps<{
  visible: boolean;
  scope?: string;
  scopeRef?: number;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const scope = computed(() => props.scope || 'global');
const scopeRef = computed(() => props.scopeRef);

const scopeLabel = computed(() => {
  switch (scope.value) {
    case 'instance': return '实例';
    case 'campus': return '校园';
    case 'global': return '全局';
    default: return scope.value;
  }
});

function close() {
  emit('close');
}
</script>

<style scoped>
.ai-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1100;
  display: flex;
  justify-content: flex-end;
}

.ai-drawer {
  width: 420px;
  max-width: 90vw;
  height: 100%;
  background: var(--layer-default);
  border-left: 1px solid var(--divider-stroke);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(20px);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  background: var(--layer-default);
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.scope-badge {
  font-size: var(--font-size-xs);
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  font-weight: 500;
}

.close-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.close-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.drawer-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.drawer-body > * {
  flex: 1;
  min-height: 0;
}

.drawer-slide-enter-active, .drawer-slide-leave-active {
  transition: opacity var(--fast-duration);
}

.drawer-slide-enter-active .ai-drawer,
.drawer-slide-leave-active .ai-drawer {
  transition: transform var(--normal-duration);
}

.drawer-slide-enter-from, .drawer-slide-leave-to {
  opacity: 0;
}

.drawer-slide-enter-from .ai-drawer,
.drawer-slide-leave-to .ai-drawer {
  transform: translateX(100%);
}
</style>
