<template>
  <div class="custom-select" ref="rootEl" :class="{ open: isOpen, disabled }">
    <button
      class="select-trigger"
      @click="toggle"
      @keydown.enter="toggle"
      @keydown.space.prevent="toggle"
      :disabled="disabled"
      :style="{ height: height || undefined }"
    >
      <span class="trigger-text" :class="{ placeholder: !selectedLabel }">
        {{ selectedLabel || placeholder || '请选择' }}
      </span>
      <Icon icon="ri-arrow-down-s-line" class="trigger-arrow" :size="16" />
    </button>
    <Teleport to="body">
      <div v-if="isOpen" class="select-overlay" @click="close"></div>
    </Teleport>
    <transition name="drop-fade">
      <div v-if="isOpen" class="select-dropdown" :style="dropStyle">
        <div
          v-for="opt in options"
          :key="opt.value"
          class="select-option"
          :class="{ selected: modelValue === opt.value, disabled: opt.disabled }"
          @click="select(opt)"
        >
          <Icon v-if="opt.icon" :icon="opt.icon" :size="14" class="option-icon" />
          <span class="option-label">{{ opt.label }}</span>
          <Icon v-if="modelValue === opt.value" icon="ri-check-line" :size="14" class="option-check" />
        </div>
        <div v-if="options.length === 0" class="select-empty">
          {{ emptyText || '暂无选项' }}
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';

export interface SelectOption {
  value: string | number;
  label: string;
  icon?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<{
  modelValue: string | number;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  height?: string;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
}>();

const rootEl = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const dropStyle = ref({ top: '0px', left: '0px', width: '0px' });

const selectedLabel = computed(() => {
  return props.options.find(o => o.value === props.modelValue)?.label || '';
});

function toggle() {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    nextTick(() => updatePosition());
  }
}

function close() {
  isOpen.value = false;
}

function select(opt: SelectOption) {
  if (opt.disabled) return;
  emit('update:modelValue', opt.value);
  close();
}

function updatePosition() {
  if (!rootEl.value) return;
  const rect = rootEl.value.getBoundingClientRect();
  const gap = 4;
  dropStyle.value = {
    top: `${rect.bottom + gap + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
  };
}

function onResize() {
  if (isOpen.value) updatePosition();
}

function onScroll() {
  if (isOpen.value) updatePosition();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close();
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
.custom-select {
  position: relative;
  display: inline-block;
  min-width: 100px;
  user-select: none;
}

.custom-select.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 36px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  gap: var(--spacer-1);
  transition: border-color var(--fast-duration);
  font-family: inherit;
}

.select-trigger:hover {
  border-color: var(--ctrl-border-accent);
}

.custom-select.open .select-trigger {
  border-color: var(--accent-base);
}

.trigger-text {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trigger-text.placeholder {
  color: var(--text-tertiary);
}

.trigger-arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform var(--fast-duration);
}

.custom-select.open .trigger-arrow {
  transform: rotate(180deg);
}

.select-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
}

.select-dropdown {
  position: absolute;
  z-index: 401;
  max-height: 240px;
  overflow-y: auto;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: var(--spacer-1);
}

.select-option {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.select-option:hover {
  background: var(--subtle-secondary);
}

.select-option.selected {
  color: var(--accent-base);
  background: rgba(0, 103, 192, 0.06);
}

.select-option.disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.select-option.disabled:hover {
  background: transparent;
}

.option-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.option-label {
  flex: 1;
}

.option-check {
  color: var(--accent-base);
  flex-shrink: 0;
}

.select-empty {
  padding: var(--spacer-3);
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

/* 过渡动画 */
.drop-fade-enter-active,
.drop-fade-leave-active {
  transition: opacity var(--fast-duration), transform var(--fast-duration);
}

.drop-fade-enter-from,
.drop-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>