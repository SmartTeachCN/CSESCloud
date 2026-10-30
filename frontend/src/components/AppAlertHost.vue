<template>
  <Teleport to="body">
    <Transition name="app-alert-fade">
      <div
        v-if="current"
        class="app-alert-overlay"
        @click.self="close"
      >
        <div
          class="app-alert-card"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="app-alert-title"
        >
          <div class="app-alert-header">
            <div class="app-alert-title" id="app-alert-title">
              <Icon icon="ri-information-line" :size="16" />
              <span>提示</span>
            </div>
            <button class="app-alert-close" type="button" title="关闭（Esc）" @click="close">
              <Icon icon="ri-close-line" :size="16" />
            </button>
          </div>

          <div class="app-alert-body">
            <p class="app-alert-message">{{ current.message }}</p>
          </div>

          <div class="app-alert-footer">
            <span v-if="queueLength > 1" class="app-alert-queue">还有 {{ queueLength - 1 }} 条提示</span>
            <button ref="okButton" class="app-alert-ok" type="button" @click="close">确定</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  appAlertQueue,
  closeCurrentAppAlert,
  currentAppAlert,
} from '../composables/useAppAlert';

const okButton = ref<HTMLButtonElement | null>(null);

const current = computed(() => currentAppAlert());
const queueLength = computed(() => appAlertQueue.value.length);

function close() {
  closeCurrentAppAlert();
}

function onKeydown(e: KeyboardEvent) {
  if (!current.value) return;
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

// 新提示出现时把焦点放到「确定」按钮，便于回车关闭
watch(
  () => current.value?.id,
  async (id) => {
    if (!id) return;
    await nextTick();
    okButton.value?.focus();
  }
);

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<style scoped>
.app-alert-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-4);
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}

.app-alert-card {
  width: 460px;
  max-width: min(92vw, 460px);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.app-alert-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.app-alert-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.app-alert-close {
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

.app-alert-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.app-alert-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacer-4);
}

.app-alert-message {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.app-alert-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacer-3);
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.app-alert-queue {
  margin-right: auto;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.app-alert-ok {
  height: 32px;
  min-width: 76px;
  padding: 0 var(--spacer-4);
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: #FFFFFF;
  cursor: pointer;
  transition: background var(--fast-duration);
}

.app-alert-ok:hover {
  background: var(--accent-hover);
}

.app-alert-ok:focus-visible {
  outline: 2px solid var(--accent-base);
  outline-offset: 2px;
}

.app-alert-fade-enter-active,
.app-alert-fade-leave-active {
  transition: opacity var(--fast-duration) var(--fast-out-slow-in);
}

.app-alert-fade-enter-from,
.app-alert-fade-leave-to {
  opacity: 0;
}
</style>
