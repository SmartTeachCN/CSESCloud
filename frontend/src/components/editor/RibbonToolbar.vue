<template>
  <div class="ribbon-toolbar" ref="ribbonToolbarRef">
    <!-- ===== 左：编辑内容信息（两行） ===== -->
    <div class="ribbon-left" :class="{ 'no-sub': !hasSubInfo }">
      <!-- 大行1：图标 + 标题/类型 + 编辑按钮 -->
      <div class="left-row-main">
        <div class="info-icon" v-if="editorInfo" :class="{ asset: editorInfo.iconAssetUrl }">
          <img v-if="editorInfo.iconAssetUrl" :src="editorInfo.iconAssetUrl" class="info-icon-img" alt="" />
          <Icon v-else :icon="editorInfo.icon || 'ri-file-edit-line'" :size="26" />
        </div>
        <div class="info-texts" v-if="editorInfo">
          <span class="info-title" :title="editorInfo.title">{{ editorInfo.title }}</span>
          <span class="info-type">{{ editorInfo.type }}</span>
        </div>
        <button
          v-if="editorInfo?.editButtonLabel"
          class="info-edit-btn"
          @click="$emit('edit-click')"
          :title="editorInfo.editButtonLabel"
        >
          <Icon icon="ri-pencil-line" :size="14" />
        </button>
      </div>
      <!-- 小行2：更新时间 + 编辑人 -->
      <div class="left-row-sub" v-if="editorInfo?.lastUpdated || editorInfo?.lastEditor">
        <Icon icon="ri-time-line" :size="10" />
        <span class="sub-text" v-if="editorInfo.lastUpdated">{{ editorInfo.lastUpdated }}</span>
        <span class="sub-sep" v-if="editorInfo.lastUpdated && editorInfo.lastEditor">·</span>
        <Icon icon="ri-user-line" :size="10" v-if="editorInfo.lastEditor" />
        <span class="sub-text" v-if="editorInfo.lastEditor">{{ editorInfo.lastEditor }}</span>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="ribbon-divider-v"></div>

    <!-- ===== 中：编辑器工具区（跨两行） ===== -->
    <div class="ribbon-center">
      <template v-for="(group, gi) in ribbonGroups" :key="gi">
        <div class="ribbon-group">
          <div class="ribbon-group-tools">
            <button
              v-for="tool in group.tools"
              :key="tool.id"
              class="ribbon-tool"
              :class="{
                active: tool.type === 'select' && activeTool === tool.id,
                'select-type': tool.type === 'select'
              }"
              :title="tool.label"
              @click="onToolClick(tool)"
            >
              <Icon :icon="tool.icon" :size="18" />
              <span class="tool-label">{{ tool.label }}</span>
            </button>
          </div>
          <div class="ribbon-group-label">{{ group.label }}</div>
        </div>
        <div v-if="gi < ribbonGroups.length - 1" class="ribbon-divider-v"></div>
      </template>

      <!-- 靠右的中间“视图”工具区 -->
      <template v-if="showViewRibbon">
        <div class="ribbon-view-spacer"></div>
        <div class="ribbon-group">
          <div class="ribbon-group-tools">
            <button
              v-for="tool in viewGroup.tools"
              :key="tool.id"
              class="ribbon-tool"
              :class="{
                active: tool.type === 'select' && activeTool === tool.id,
                'select-type': tool.type === 'select'
              }"
              :title="tool.label"
              @click="onToolClick(tool)"
            >
              <Icon :icon="tool.icon" :size="18" />
              <span class="tool-label">{{ tool.label }}</span>
            </button>
          </div>
          <div class="ribbon-group-label">{{ viewGroup.label }}</div>
        </div>
      </template>
    </div>

    <!-- 分隔线 -->
    <div class="ribbon-divider-v"></div>

    <!-- ===== 靠右系统 Ribbon（插件编辑器：重载/视图切换等） ===== -->
    <template v-if="systemRightToolList.length">
      <div class="ribbon-system-right">
        <div class="ribbon-group">
          <div class="ribbon-group-tools">
            <button
              v-for="tool in systemRightToolList"
              :key="tool.id"
              class="ribbon-tool compact"
              :class="{
                active: tool.type === 'select' && systemRightSelectedTool === tool.id,
                'select-type': tool.type === 'select'
              }"
              :title="tool.label"
              @click="onToolClick(tool)"
            >
              <Icon :icon="tool.icon" :size="16" />
              <span class="tool-label">{{ tool.label }}</span>
            </button>
          </div>
          <div class="ribbon-group-label">系统</div>
        </div>
      </div>
      <div class="ribbon-divider-v"></div>
    </template>

    <!-- ===== 右：文件操作（两行） ===== -->
    <div class="ribbon-right">
      <!-- 小行1：靠左撤销/恢复（纯图标），靠右自动保存/保存（横向加宽） -->
      <div class="right-row-top">
        <div class="right-row-top-left">
          <button class="ribbon-tool icon-only" title="撤销 (Ctrl+Z)" @click="$emit('undo')" :disabled="!canUndo">
            <Icon icon="ri-arrow-go-back-line" :size="16" />
          </button>
          <button class="ribbon-tool icon-only" title="重做 (Ctrl+Shift+Z)" @click="$emit('redo')" :disabled="!canRedo">
            <Icon icon="ri-arrow-go-forward-line" :size="16" />
          </button>
        </div>
        <div class="right-row-top-right">
          <button class="ribbon-tool wide" title="自动保存" @click="autoSave = !autoSave" :disabled="!canAutoSave">
            <Icon :icon="autoSave ? 'ri-save-2-fill' : 'ri-save-2-line'" :size="14" />
            <span class="tool-label">自动保存</span>
            <span class="tool-state" :class="{ on: autoSave }">{{ autoSave ? '开' : '关' }}</span>
          </button>
          <button class="ribbon-tool wide primary" :disabled="saving || !canSave" @click="emitSave">
            <Icon :icon="saving ? 'ri-loader-4-line' : 'ri-download-cloud-2-line'" :size="14" :class="{ spin: saving }" />
            <span class="tool-label">保存</span>
          </button>
        </div>
      </div>
      <!-- 大行2：分享、操作记录、版本历史、导入/导出 -->
      <div class="right-row-main">
        <button
          v-for="action in rightActions"
          :key="action.id"
          class="ribbon-tool compact"
          :title="action.label"
          @click="$emit('tool-click', action)"
          :disabled="!action.enabled"
        >
          <Icon :icon="action.icon" :size="14" />
          <span class="tool-label">{{ action.label }}</span>
        </button>
      </div>
    </div>

    <!-- 字号弹层 -->
    <Teleport to="body">
      <div v-if="showFontPopover" class="fontsize-overlay" @click="showFontPopover = false"></div>
      <div v-if="showFontPopover" class="fontsize-popover" :style="fontPopoverStyle" @click.stop>
        <button class="fs-row" @click="changeFont(-1)" title="减小字号">
          <Icon icon="ri-subtract-line" :size="14" />
          <span>A-</span>
        </button>
        <div class="fs-value">{{ fontSize }}</div>
        <button class="fs-row" @click="changeFont(1)" title="增大字号">
          <Icon icon="ri-add-line" :size="14" />
          <span>A+</span>
        </button>
      </div>
    </Teleport>

    <!-- 设置 / 快捷键弹窗 -->
    <EditorSettingsDialog :visible="showSettings" @close="showSettings = false" />
    <ShortcutsDialog :visible="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import EditorSettingsDialog from './panels/EditorSettingsDialog.vue';
import ShortcutsDialog from './panels/ShortcutsDialog.vue';
import { useEditorSettings } from '../../composables/useEditorSettings';

interface RibbonTool {
  id: string;
  label: string;
  icon: string;
  command?: string;
  /** 按钮类型：action=点击即释放, select=选中保持激活态 */
  type?: 'action' | 'select';
}

interface RibbonGroup {
  label: string;
  tools: RibbonTool[];
}

interface EditorInfo {
  title: string;
  type: string;
  icon: string;
  /** 应用真实图标资源地址，存在时优先于 icon 渲染 */
  iconAssetUrl?: string;
  lastUpdated?: string;
  lastEditor?: string;
  editButtonLabel?: string;
}

const props = defineProps<{
  editorInfo?: EditorInfo;
  manifest?: RibbonGroup[];
  saving?: boolean;
  saveLabel?: string;
  /** 外部指定的当前选中工具 ID（用于 select 型按钮） */
  selectedTool?: string;
  /** 实例编辑器始终显示操作区 */
  isInstance?: boolean;
  /** 是否有可撤销的操作 */
  canUndo?: boolean;
  /** 是否有可重做的操作 */
  canRedo?: boolean;
  /** 是否可保存 */
  canSave?: boolean;
  /** 是否可自动保存 */
  canAutoSave?: boolean;
  /** 右侧操作区按钮，含 enabled 控制禁用状态 */
  rightActions?: Array<Partial<RibbonTool> & { enabled?: boolean; id: string; label: string; icon: string }>;
  /** 靠右的系统 Ribbon 工具（插件编辑器：重载、视图切换等） */
  systemRightTools?: RibbonTool[];
  /** 靠右系统 Ribbon 的选中工具 ID（用于 select 型按钮） */
  systemRightSelectedTool?: string;
  /** 是否展示靠右的中间“视图”工具区（真正文件编辑器开启，实例编辑器不开启） */
  showViewRibbon?: boolean;
}>();

const emit = defineEmits<{
  (e: 'tool-click', tool: RibbonTool): void;
  (e: 'save'): void;
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'autosize-change', value: boolean): void;
  (e: 'edit-click'): void;
}>();

const editorSettings = useEditorSettings();
const showFontPopover = ref(false);
const showSettings = ref(false);
const showShortcuts = ref(false);
const fontSize = computed(() => editorSettings.state.fontSize);
const ribbonToolbarRef = ref<HTMLElement | null>(null);
const fontPopoverStyle = ref<{ top: string; left: string }>({ top: '100px', left: '280px' });

const autoSave = ref(true);
const activeTool = ref(props.selectedTool || '');
const saving = ref(!!props.saving);

const hasSubInfo = computed(() => !!(props.editorInfo?.lastUpdated || props.editorInfo?.lastEditor));

watch(() => props.saving, v => saving.value = v);
watch(autoSave, v => emit('autosize-change', v));
watch(() => props.selectedTool, v => { activeTool.value = v || ''; });

// 靠右系统 Ribbon 工具
const systemRightToolList = computed(() => props.systemRightTools || []);

function changeFont(delta: number) {
  const next = editorSettings.state.fontSize + delta;
  editorSettings.set('fontSize', Math.min(40, Math.max(8, next)));
}

// 默认中间工具组（非插件编辑器的正式编辑 Ribbon，靠左）
const defaultGroups: RibbonGroup[] = [
  {
    label: '编辑',
    tools: [
      { id: 'find', label: '查找', icon: 'ri-search-line', command: 'find' },
      { id: 'replace', label: '替换', icon: 'ri-find-replace-line', command: 'replace' },
      { id: 'goto', label: '跳转行', icon: 'ri-arrow-down-s-line', command: 'goto' },
      { id: 'fontsize', label: '字号', icon: 'ri-font-size', command: 'fontsize' },
      { id: 'refresh', label: '刷新', icon: 'ri-refresh-line', command: 'refresh' },
    ]
  },
  {
    label: '工具',
    tools: [
      { id: 'settings', label: '设置', icon: 'ri-settings-3-line', command: 'settings' },
      { id: 'shortcuts', label: '快捷键', icon: 'ri-keyboard-box-line', command: 'shortcuts' },
    ]
  },
];

// 靠右的中间“视图”工具区（非插件与插件编辑器均展示）
const viewGroup: RibbonGroup = {
  label: '视图',
  tools: [
    { id: 'fullscreen', label: '全屏', icon: 'ri-fullscreen-line', command: 'fullscreen' },
    { id: 'immersive', label: '沉浸模式', icon: 'ri-focus-2-line', command: 'immersive', type: 'select' },
  ],
};

// 默认右侧操作区按钮
const defaultRightActions: Array<Partial<RibbonTool> & { enabled?: boolean; id: string; label: string; icon: string }> = [
  { id: 'share', label: '分享', icon: 'ri-share-forward-line', command: 'share', enabled: true },
  { id: 'history', label: '操作记录', icon: 'ri-history-line', command: 'history', enabled: true },
  { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', command: 'version', enabled: true },
  { id: 'import', label: '导入', icon: 'ri-download-line', command: 'import', enabled: true },
  { id: 'export', label: '导出', icon: 'ri-upload-2-line', command: 'export', enabled: true },
];

const rightActions = computed(() => {
  if (props.rightActions) return props.rightActions;
  return defaultRightActions.map(a => ({ ...a, enabled: a.enabled !== undefined ? a.enabled : !!props.editorInfo }));
});

const ribbonGroups = computed(() => props.manifest && props.manifest.length > 0 ? props.manifest : defaultGroups);

function onToolClick(tool: RibbonTool) {
  // 由 Ribbon 内部直接处理的工具（全局偏好），不向上冒泡
  if (tool.id === 'settings') { showSettings.value = true; return; }
  if (tool.id === 'shortcuts') { showShortcuts.value = true; return; }
  if (tool.id === 'fontsize') {
    const rect = ribbonToolbarRef.value?.getBoundingClientRect?.();
    if (rect) {
      fontPopoverStyle.value = { top: `${rect.bottom + 6}px`, left: `${rect.left + 16}px` };
    }
    showFontPopover.value = !showFontPopover.value;
    return;
  }
  if (tool.type === 'select') {
    activeTool.value = tool.id;
  }
  emit('tool-click', tool);
}

function emitSave() {
  emit('save');
}
</script>

<style scoped>
.ribbon-toolbar {
  display: flex;
  align-items: stretch;
  background: var(--ctrl-fill-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0;
  flex-shrink: 0;
  overflow: hidden;
  height: 92px;
}

/* ===== 左：编辑内容信息 ===== */
.ribbon-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 var(--spacer-3);
  min-width: 180px;
  max-width: 300px;
  flex-shrink: 0;
  gap: var(--spacer-1);
}

.left-row-main {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
}

.info-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-accent);
  border-radius: var(--radius-md);
  color: var(--accent-base);
  flex-shrink: 0;
}

/* 应用自带真实图标时不使用底色 */
.info-icon.asset {
  background: transparent;
  overflow: hidden;
}

.info-icon-img {
  width: 30px;
  height: 30px;
  object-fit: contain;
  border-radius: 4px;
  display: block;
}

.info-texts {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.info-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.info-type {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  line-height: 1.3;
}

.info-edit-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 2px;
}
.info-edit-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  border-color: var(--accent-base);
}

.left-row-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  padding-left: 2px;
}

/* 无子行信息时，大行1撑满空间 */
.ribbon-left.no-sub .left-row-main {
  flex: 1;
  align-items: center;
}
.ribbon-left.no-sub .info-icon {
  width: 48px;
  height: 48px;
}
.ribbon-left.no-sub .info-icon :deep(svg) {
  width: 28px;
  height: 28px;
}
.ribbon-left.no-sub .info-title {
  font-size: var(--font-size-lg);
}

.sub-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub-sep {
  color: var(--divider-stroke);
}

/* ===== 中：编辑器工具区 ===== */
.ribbon-center {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  justify-content: left;
  padding: var(--spacer-1) var(--spacer-2);
  gap: 0;
  overflow-x: auto;
}

.ribbon-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 var(--spacer-2);
  gap: 2px;
}

/* 将中间“视图”工具区推到最右侧 */
.ribbon-view-spacer {
  flex: 1 1 auto;
  min-width: 8px;
}

.ribbon-group-tools {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.ribbon-tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-1) var(--spacer-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), border-color var(--fast-duration);
  min-width: 50px;
  min-height: 50px;
  gap: 2px;
}

.ribbon-tool.small {
  min-width: 44px;
  min-height: 32px;
  padding: 2px var(--spacer-1);
}

.ribbon-tool.icon-only {
  min-width: 28px;
  min-height: 28px;
  padding: 4px;
  border-radius: var(--radius-sm);
}

.ribbon-tool.wide {
  flex-direction: row;
  min-width: 72px;
  min-height: 28px;
  padding: 3px var(--spacer-2);
  gap: var(--spacer-1);
  border-radius: var(--radius-sm);
}

.ribbon-tool.compact {
  min-width: 56px;
  min-height: 36px;
  padding: 2px var(--spacer-2);
  gap: 1px;
}
.ribbon-tool.compact .tool-label {
  font-size: 9px;
}

.ribbon-tool:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

/* 通用激活态（仅用于非 select 型按钮） */
.ribbon-tool.active:not(.select-type) {
  background: var(--subtle-pressed);
  color: var(--accent-base);
  border-color: var(--accent-base);
}

/* select 型按钮：底边高亮，更像标签页 */
.ribbon-tool.select-type {
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  border-bottom: 2px solid transparent;
  min-height: 54px;
}
.ribbon-tool.select-type.active {
  border-color: transparent;
  border-bottom-color: var(--accent-base);
  background: var(--accent-bg);
  color: var(--accent-base);
  font-weight: 600;
}

.ribbon-tool.primary {
  background: var(--accent-base);
  color: white;
}

.ribbon-tool.primary:hover {
  background: var(--accent-hover);
}

.ribbon-tool.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ribbon-tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  color: var(--text-tertiary);
}

.tool-label {
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}

.tool-state {
  font-size: 8px;
  color: var(--text-tertiary);
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--subtle-secondary);
  line-height: 1.4;
}

.tool-state.on {
  color: white;
  background: var(--status-success);
}

.ribbon-group-label {
  text-align: center;
  font-size: 9px;
  color: var(--text-tertiary);
}

.ribbon-divider-v {
  width: 1px;
  background: var(--divider-stroke);
  flex-shrink: 0;
  margin: var(--spacer-2) 0;
}

/* ===== 右：文件操作 ===== */
.ribbon-right {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 var(--spacer-3);
  gap: var(--spacer-1);
  flex-shrink: 0;
}

.right-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacer-2);
}

.right-row-top-left {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.right-row-top-right {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.right-row-main {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.spin {
  animation: spin 1s linear infinite;
}

/* ===== 靠右系统 Ribbon ===== */
.ribbon-system-right {
  display: flex;
  align-items: center;
  padding: var(--spacer-1) var(--spacer-2);
  flex-shrink: 0;
}

/* ===== 字号弹层 ===== */
.fontsize-popover {
  position: fixed;
  top: 96px;
  left: 280px;
  z-index: 1500;
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2);
  background: var(--flyout-bg);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
}
.fontsize-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: transparent;
}
.fs-row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px 10px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
}
.fs-row:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}
.fs-value {
  min-width: 32px;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-family: var(--font-mono, Consolas, monospace);
}


</style>