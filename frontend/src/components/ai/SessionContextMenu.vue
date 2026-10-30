<template>
  <Teleport to="body">
    <Transition name="ctx-pop">
      <div
        v-if="show"
        ref="menuEl"
        class="ctx-menu"
        role="menu"
        tabindex="-1"
        :style="positionStyle"
        @contextmenu.prevent
        @pointerdown.stop
        @keydown="onKeydown"
      >
        <div v-if="title" class="ctx-menu-title" :title="title">{{ title }}</div>
        <template v-for="(item, index) in items" :key="item.key || `item-${index}`">
          <div v-if="item.type === 'separator'" class="ctx-menu-separator" role="separator" />
          <button
            v-else
            type="button"
            class="ctx-menu-item"
            :class="{
              danger: item.danger,
              'is-disabled': item.disabled,
              'is-active': activeIndex === index,
            }"
            role="menuitem"
            :aria-disabled="item.disabled ? 'true' : 'false'"
            @mouseenter="activeIndex = item.disabled ? activeIndex : index"
            @click="selectItem(item)"
          >
            <Icon v-if="item.icon" :icon="item.icon" :size="15" class="ctx-item-icon" />
            <span class="ctx-item-label">{{ item.label }}</span>
            <span v-if="item.shortcut" class="ctx-item-shortcut">{{ item.shortcut }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
export interface ContextMenuItem {
  /** 菜单项唯一标识，select 事件回传 */
  key: string;
  /** 文案；type === 'separator' 时忽略 */
  label: string;
  /** 可选 Remix Icon 名称，如 ri-pushpin-2-line */
  icon?: string;
  /** 右侧快捷键/提示文案，例如会话 ID */
  shortcut?: string;
  /** 危险操作（删除等），红色强调 */
  danger?: boolean;
  /** 禁用态 */
  disabled?: boolean;
  /** 'separator' 渲染为分割线 */
  type?: 'item' | 'separator';
}
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 是否显示 */
    show: boolean;
    /** 鼠标位置 x（clientX） */
    x: number;
    /** 鼠标位置 y（clientY） */
    y: number;
    /** 菜单项 */
    items: ContextMenuItem[];
    /** 顶部标题（可为空），常用于显示被右键的会话名 */
    title?: string;
  }>(),
  { title: '' },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select', key: string): void;
}>();

const menuEl = ref<HTMLElement | null>(null);
const positionStyle = ref<Record<string, string>>({ left: '0px', top: '0px' });
const activeIndex = ref(-1);

const actionableIndexes = computed(() =>
  props.items.map((item, index) => ({ item, index })).filter(({ item }) => item.type !== 'separator' && !item.disabled).map(({ index }) => index),
);

/** 贴鼠标定位，并夹紧到视口内，避免溢出 */
async function updatePosition() {
  positionStyle.value = {
    left: `${Math.max(0, Math.round(props.x))}px`,
    top: `${Math.max(0, Math.round(props.y))}px`,
  };
  await nextTick();
  const el = menuEl.value;
  if (!el) return;
  const pad = 8;
  const width = el.offsetWidth || 0;
  const height = el.offsetHeight || 0;
  const maxLeft = Math.max(pad, window.innerWidth - width - pad);
  const maxTop = Math.max(pad, window.innerHeight - height - pad);
  positionStyle.value = {
    left: `${Math.min(Math.max(pad, Math.round(props.x)), maxLeft)}px`,
    top: `${Math.min(Math.max(pad, Math.round(props.y)), maxTop)}px`,
  };
}

function onDocumentPointerDown(event: PointerEvent) {
  const el = menuEl.value;
  const target = event.target as Node | null;
  if (el && target && el.contains(target)) return;
  emit('close');
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}

function onViewportChange() {
  emit('close');
}

function addListeners() {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
}

function removeListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
}

async function mountMenu() {
  activeIndex.value = -1;
  await updatePosition();
  addListeners();
  await nextTick();
  menuEl.value?.focus({ preventScroll: true });
}

function unmountMenu() {
  removeListeners();
  activeIndex.value = -1;
}

watch(
  () => props.show,
  (visible) => {
    if (visible) mountMenu();
    else unmountMenu();
  },
);

// 菜单已展开时换位置（同一菜单在别处再次右键）也要跟随
watch(
  () => [props.x, props.y],
  () => {
    if (props.show) updatePosition();
  },
);

function selectItem(item: ContextMenuItem) {
  if (item.disabled || item.type === 'separator') return;
  emit('select', item.key);
  emit('close');
}

/** 键盘导航：↑↓ 移动，Enter/Space 触发，Esc 关闭 */
function onKeydown(event: KeyboardEvent) {
  const list = actionableIndexes.value;
  if (!list.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const currentPos = list.indexOf(activeIndex.value);
    let nextPos: number;
    if (event.key === 'ArrowDown') nextPos = currentPos < 0 ? 0 : (currentPos + 1) % list.length;
    else nextPos = currentPos <= 0 ? list.length - 1 : currentPos - 1;
    activeIndex.value = list[nextPos];
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    if (activeIndex.value < 0) return;
    const item = props.items[activeIndex.value];
    if (!item) return;
    event.preventDefault();
    selectItem(item);
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    emit('close');
  }
}

onBeforeUnmount(unmountMenu);
</script>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 208px;
  max-width: 300px;
  padding: 4px;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  outline: none;
  user-select: none;
  box-sizing: border-box;
  font-family: inherit;
}

.ctx-menu-title {
  padding: 6px 10px 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-xs);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.ctx-menu-item:hover,
.ctx-menu-item.is-active {
  background: var(--subtle-secondary);
}

.ctx-menu-item:active {
  background: var(--subtle-pressed);
}

.ctx-item-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.ctx-menu-item:hover .ctx-item-icon,
.ctx-menu-item.is-active .ctx-item-icon {
  color: var(--text-primary);
}

.ctx-item-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-item-shortcut {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.ctx-menu-item.danger,
.ctx-menu-item.danger .ctx-item-icon {
  color: var(--status-error);
}

.ctx-menu-item.danger:hover,
.ctx-menu-item.danger.is-active {
  background: color-mix(in srgb, var(--status-error) 12%, transparent);
}

.ctx-menu-item.is-disabled {
  opacity: 0.45;
  cursor: default;
}

.ctx-menu-item.is-disabled:hover {
  background: transparent;
}

.ctx-menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--divider-stroke);
}

.ctx-pop-enter-active,
.ctx-pop-leave-active {
  transition: opacity var(--fast-duration) var(--fast-out-slow-in), transform var(--fast-duration) var(--fast-out-slow-in);
}

.ctx-pop-enter-from,
.ctx-pop-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
