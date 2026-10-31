<template>
  <div
    ref="rootEl"
    class="custom-select"
    :class="{ open: isOpen, disabled, 'is-inline': inline }"
    :style="width ? { width } : undefined"
  >
    <button
      ref="triggerEl"
      :id="id"
      type="button"
      class="select-trigger"
      :style="height ? { height } : undefined"
      :disabled="disabled"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="isOpen ? 'true' : 'false'"
      :aria-controls="isOpen ? listId : undefined"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="trigger-text" :class="{ placeholder: !selectedLabel }">
        {{ selectedLabel || placeholder || '请选择' }}
      </span>
      <Icon icon="ri-arrow-down-s-line" class="trigger-arrow" :size="16" />
    </button>

    <Teleport to="body">
      <transition name="drop-fade">
        <div
          v-if="isOpen"
          :id="listId"
          ref="dropEl"
          class="select-dropdown"
          :style="dropStyle"
          role="listbox"
          :aria-activedescendant="activeOptionId"
          tabindex="-1"
          @pointerdown.stop
          @click.stop
        >
          <div
            v-for="(opt, idx) in options"
            :id="`${listId}-opt-${idx}`"
            :key="`${opt.value}`"
            class="select-option"
            role="option"
            :class="{ selected: opt.value === modelValue, disabled: opt.disabled, active: idx === activeIndex }"
            :aria-selected="opt.value === modelValue ? 'true' : 'false'"
            :aria-disabled="opt.disabled ? 'true' : 'false'"
            @mouseenter="focusOption(idx)"
            @click="choose(opt)"
          >
            <Icon v-if="opt.icon" :icon="opt.icon" :size="14" class="option-icon" />
            <span class="option-label">{{ opt.label }}</span>
            <Icon v-if="opt.value === modelValue" icon="ri-check-line" :size="14" class="option-check" />
          </div>
          <div v-if="options.length === 0" class="select-empty">
            {{ emptyText || '暂无选项' }}
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

export interface SelectOption {
  value: string | number;
  label: string;
  icon?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<{
  /** 当前值；没有匹配项时显示 placeholder */
  modelValue?: string | number | null;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  /** 触发器高度（默认 36px），用于紧凑场景如 24px/28px */
  height?: string;
  /** 行内模式：宽度由内容/width 决定；默认块级占满一行 */
  inline?: boolean;
  /** 固定宽度（如 "110px"）；inline 模式下需要固定宽度时用（行内样式，优先级最高） */
  width?: string;
  /** 触发器 id，便于 <label for="..."> 关联 */
  id?: string;
}>(), {
  disabled: false,
  inline: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
  (e: 'change', value: string | number): void;
}>();

const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const dropEl = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const activeIndex = ref(-1);
const dropStyle = ref<Record<string, string>>({ top: '0px', left: '0px', width: '0px' });

const uid = useId();
const listId = `custom-select-list-${uid}`;

const selectedLabel = computed(() => {
  return props.options.find(o => o.value === props.modelValue)?.label || '';
});

const selectedIndex = computed(() => props.options.findIndex(o => o.value === props.modelValue));

const activeOptionId = computed(() => {
  return isOpen.value && activeIndex.value >= 0 ? `${listId}-opt-${activeIndex.value}` : undefined;
});

function toggle() {
  if (props.disabled) return;
  if (isOpen.value) close();
  else open();
}

function open() {
  if (props.disabled || isOpen.value) return;
  isOpen.value = true;
  activeIndex.value = selectedIndex.value >= 0
    ? selectedIndex.value
    : props.options.findIndex(o => !o.disabled);
  nextTick(() => updatePosition());
}

function close(returnFocus = false) {
  if (!isOpen.value) return;
  isOpen.value = false;
  activeIndex.value = -1;
  if (returnFocus) triggerEl.value?.focus();
}

function focusOption(idx: number) {
  if (idx < 0 || idx >= props.options.length) return;
  activeIndex.value = idx;
}

function moveActive(step: 1 | -1) {
  const len = props.options.length;
  if (!len) return;
  let idx = activeIndex.value;
  for (let i = 0; i < len; i++) {
    idx = (idx + step + len) % len;
    if (!props.options[idx].disabled) {
      activeIndex.value = idx;
      scrollActiveIntoView();
      return;
    }
  }
}

function moveActiveTo(edge: 'start' | 'end') {
  const indices = props.options
    .map((opt, idx) => (opt.disabled ? -1 : idx))
    .filter(idx => idx >= 0);
  if (!indices.length) return;
  activeIndex.value = edge === 'start' ? indices[0] : indices[indices.length - 1];
  scrollActiveIntoView();
}

function scrollActiveIntoView() {
  nextTick(() => {
    const options = dropEl.value?.querySelectorAll<HTMLElement>('.select-option');
    const el = activeIndex.value >= 0 ? options?.[activeIndex.value] : null;
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function choose(opt: SelectOption) {
  if (opt.disabled) return;
  const changed = opt.value !== props.modelValue;
  if (changed) {
    emit('update:modelValue', opt.value);
    emit('change', opt.value);
  }
  close(true);
}

function commitActive() {
  const opt = props.options[activeIndex.value];
  if (opt) choose(opt);
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (props.disabled) return;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (!isOpen.value) open();
      else moveActive(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (!isOpen.value) open();
      else moveActive(-1);
      break;
    case 'Home':
      if (!isOpen.value) return;
      e.preventDefault();
      moveActiveTo('start');
      break;
    case 'End':
      if (!isOpen.value) return;
      e.preventDefault();
      moveActiveTo('end');
      break;
    case 'Enter':
    case ' ':
      if (!isOpen.value) return;
      e.preventDefault();
      commitActive();
      break;
    case 'Escape':
      if (!isOpen.value) return;
      e.preventDefault();
      close(true);
      break;
    case 'Tab':
      // 让焦点自然离开，同时收起浮层
      if (isOpen.value) close();
      break;
  }
}

function updatePosition() {
  const anchor = triggerEl.value || rootEl.value;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const gap = 4;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const width = Math.min(Math.max(rect.width, 160), viewportW - 16);
  const maxPanelHeight = 320;
  const spaceBelow = viewportH - rect.bottom - gap;
  const spaceAbove = rect.top - gap;
  const left = Math.min(Math.max(rect.left, 8), Math.max(8, viewportW - width - 8));

  if (spaceBelow >= maxPanelHeight || spaceBelow >= spaceAbove) {
    // 向下展开
    dropStyle.value = {
      top: `${rect.bottom + gap}px`,
      left: `${left}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(120, Math.min(maxPanelHeight, spaceBelow))}px`,
      bottom: 'auto',
    };
  } else {
    // 向上展开
    const h = Math.max(120, Math.min(maxPanelHeight, spaceAbove));
    dropStyle.value = {
      top: 'auto',
      bottom: `${viewportH - rect.top + gap}px`,
      left: `${left}px`,
      width: `${width}px`,
      maxHeight: `${h}px`,
    };
  }
}

function isInside(el: Node | null): boolean {
  if (!el) return false;
  return !!rootEl.value?.contains(el) || !!dropEl.value?.contains(el);
}

function onDocumentPointerDown(e: PointerEvent) {
  if (!isOpen.value) return;
  if (isInside(e.target as Node)) return;
  close();
}

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close(true);
  }
}

function onWindowResize() {
  if (isOpen.value) updatePosition();
}

function onWindowScroll() {
  if (isOpen.value) updatePosition();
}

// 被外部条件禁用时收起浮层
watch(() => props.disabled, (val) => {
  if (val) close();
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('scroll', onWindowScroll, true);
  window.addEventListener('keydown', onWindowKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('scroll', onWindowScroll, true);
  window.removeEventListener('keydown', onWindowKeydown);
});
</script>

<style scoped>
.custom-select {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  user-select: none;
}

.custom-select.is-inline {
  display: inline-block;
  width: auto;
  min-width: 0;
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
  font-family: inherit;
  color: var(--text-primary);
  cursor: pointer;
  gap: var(--spacer-1);
  outline: none;
  text-align: left;
  transition: border-color var(--fast-duration), background var(--fast-duration), box-shadow var(--fast-duration);
}

.select-trigger:hover {
  border-color: var(--ctrl-border-accent);
}

.select-trigger:focus-visible {
  border-color: var(--accent-base);
  box-shadow: 0 0 0 3px var(--accent-bg);
}

.custom-select.open .select-trigger {
  border-color: var(--accent-base);
}

.trigger-text {
  flex: 1;
  min-width: 0;
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

.select-dropdown {
  position: fixed;
  z-index: 9998;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: var(--spacer-1);
  box-sizing: border-box;
}

.select-option {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: 7px var(--spacer-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.select-option.active,
.select-option:hover {
  background: var(--subtle-secondary);
}

.select-option.selected {
  color: var(--accent-base);
  background: var(--accent-bg);
}

.select-option.selected.active,
.select-option.selected:hover {
  background: var(--accent-bg);
}

.select-option.disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.select-option.disabled:hover,
.select-option.disabled.active {
  background: transparent;
}

.option-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
