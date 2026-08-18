<template>
  <div class="editor-pane">
    <!-- 标签栏 -->
    <div class="ep-tabs-row" v-if="tabs.length > 0 && !hideTabs">
      <div class="ep-tabs">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="ep-tab"
          :class="{ active: tab.id === activeTabId, dirty: tab.dirty }"
          @click="$emit('tab-click', tab.id)"
        >
          <Icon :icon="tab.icon" :size="14" class="tab-icon" />
          <span class="tab-title" :title="tab.name">{{ tab.name }}</span>
          <span v-if="tab.dirty" class="dirty-dot"></span>
          <button class="tab-close" @click.stop="$emit('tab-close', tab.id)" title="关闭">
            <Icon icon="ri-close-line" :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑内容区 -->
    <div class="ep-content">
      <!-- 空状态 -->
      <div v-if="!activeTab" class="ep-empty">
        <Icon icon="ri-file-edit-line" :size="48" />
        <h3>选择文件开始编辑</h3>
        <p>从左侧文件列表中选择一个文件进行编辑，或创建新文件</p>
        <slot name="empty-actions"></slot>
      </div>

      <!-- 插件编辑器 -->
      <PluginEditorFrame
        v-else-if="activePlugin && !showSource"
        :key="pluginReloadKey"
        ref="pluginEditorRef"
        :plugin="activePlugin"
        :file-info="pluginFileInfo"
        @ready="onPluginReady"
        @save="onPluginSave"
        @notify="onPluginNotify"
        @set-ribbon="onPluginSetRibbon"
      />

      <!-- Diff 差异查看器 -->
      <div v-else-if="activeTab.isDiff" class="ep-diff-viewer">
        <div class="diff-header-bar">
          <Icon icon="ri-contrast-2-line" :size="14" />
          <span>{{ activeTab.diffLabel || activeTab.name }}</span>
          <span class="diff-summary-badge">
            <span class="diff-add">+{{ diffAddCount }}</span>
            <span class="diff-del">-{{ diffDelCount }}</span>
          </span>
        </div>
        <div class="diff-lines-container">
          <div
            v-for="(line, li) in (activeTab.diffLines || [])"
            :key="li"
            class="diff-row"
            :class="line.type"
          >
            <span class="diff-row-num old">{{ line.oldNum || '' }}</span>
            <span class="diff-row-num new">{{ line.newNum || '' }}</span>
            <span class="diff-row-sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span>
            <span class="diff-row-text">{{ line.text }}</span>
          </div>
        </div>
      </div>

      <!-- 非文本文件预览 -->
      <div v-else-if="!activeTab.isText" class="ep-binary">
        <Icon icon="ri-file-image-line" :size="48" />
        <p>无法预览此文件类型</p>
        <span>{{ activeTab.name }}</span>
        <slot name="binary-actions" :tab="activeTab"></slot>
      </div>

      <!-- Monaco 代码编辑器 -->
      <MonacoEditor
        v-else
        ref="monacoEditorRef"
        :model-value="activeTab.content"
        :language="activeTab.language"
        :read-only="readOnly"
        @update:model-value="onContentChange"
        @save="$emit('monaco-save')"
        @find="$emit('monaco-find')"
        @replace="$emit('monaco-replace')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import MonacoEditor from './MonacoEditor.vue';
import PluginEditorFrame from './PluginEditorFrame.vue';
import { pluginApi } from '../../api';

export interface TabInfo {
  id: string;
  name: string;
  icon: string;
  isText: boolean;
  content: string;
  dirty: boolean;
  language: string;
  ext?: string;
  /** Diff 标签：差异行数据 */
  diffLines?: Array<{ type: string; oldNum: number | null; newNum: number | null; text: string }>;
  /** 是否为 diff 查看标签 */
  isDiff?: boolean;
  /** Diff 标签的版本标签 */
  diffLabel?: string;
}

const props = defineProps<{
  tabs: TabInfo[];
  activeTabId: string;
  readOnly?: boolean;
  hideTabs?: boolean;
  /** 强制显示源文件（跳过插件可视化编辑器，用 Monaco 展示原始内容） */
  showSource?: boolean;
}>();

const emit = defineEmits<{
  (e: 'tab-click', tabId: string): void;
  (e: 'tab-close', tabId: string): void;
  (e: 'update:content', payload: { tabId: string; content: string }): void;
  (e: 'plugin-save', content: string): void;
  (e: 'monaco-save'): void;
  (e: 'monaco-find'): void;
  (e: 'monaco-replace'): void;
  (e: 'plugin-change', plugin: any | null): void;
  (e: 'plugin-ribbon', groups: any[]): void;
}>();

const activePlugin = ref<any>(null);
const pluginEditorRef = ref<InstanceType<typeof PluginEditorFrame> | null>(null);
const monacoEditorRef = ref<InstanceType<typeof MonacoEditor> | null>(null);
const pluginReloadKey = ref(0);

// 暴露方法给父组件
defineExpose({
  undo: () => {
    if (activePlugin.value && !props.showSource) {
      pluginEditorRef.value?.postMessage?.({ type: 'command', command: 'undo' });
    } else {
      monacoEditorRef.value?.undo();
    }
  },
  redo: () => {
    if (activePlugin.value && !props.showSource) {
      pluginEditorRef.value?.postMessage?.({ type: 'command', command: 'redo' });
    } else {
      monacoEditorRef.value?.redo();
    }
  },
  getValue: () => {
    if (activePlugin.value) return '';
    return monacoEditorRef.value?.getValue() || '';
  },
  setValue: (v: string) => {
    if (!activePlugin.value || props.showSource) monacoEditorRef.value?.setValue(v);
  },
  focus: () => monacoEditorRef.value?.focus(),
  sendCommand: (cmd: string, data?: any) => {
    if (activePlugin.value && !props.showSource) {
      // 向插件 iframe 发送平台命令（如 save / undo / redo / find / replace）
      pluginEditorRef.value?.pluginFrame?.contentWindow?.postMessage({ __ceseCommand: cmd, ...(data || {}) }, '*');
    }
  },
  /** 重载当前插件编辑器（强制重新挂载 iframe） */
  reloadPlugin: () => {
    pluginReloadKey.value++;
  },
  /** 打开 Monaco 原生“转到行” */
  gotoLine: () => {
    monacoEditorRef.value?.gotoLine();
  },
});

const activeTab = computed(() => props.tabs.find(t => t.id === props.activeTabId) || null);

const diffAddCount = computed(() => {
  if (!activeTab.value?.isDiff || !activeTab.value.diffLines) return 0;
  return activeTab.value.diffLines.filter(l => l.type === 'add').length;
});
const diffDelCount = computed(() => {
  if (!activeTab.value?.isDiff || !activeTab.value.diffLines) return 0;
  return activeTab.value.diffLines.filter(l => l.type === 'del').length;
});

const pluginFileInfo = computed(() => ({
  name: activeTab.value?.name || '',
  content: activeTab.value?.content || '',
  path: activeTab.value?.name || ''
}));

// 当 activeTab 变化时解析插件
watch(() => props.activeTabId, async (newId) => {
  activePlugin.value = null;
  pluginReloadKey.value++;
  const tab = props.tabs.find(t => t.id === newId);
  if (!tab || !tab.ext) {
    emit('plugin-change', null);
    return;
  }
  try {
    const plugin = await pluginApi.resolver(tab.ext);
    activePlugin.value = plugin;
  } catch {
    activePlugin.value = null;
  } finally {
    emit('plugin-change', activePlugin.value);
  }
}, { immediate: true });

function onContentChange(value: string) {
  if (activeTab.value) {
    emit('update:content', { tabId: activeTab.value.id, content: value });
  }
}

function onPluginReady() {
  console.log('[EditorPane] plugin ready');
}

function onPluginSave(content: string) {
  emit('plugin-save', content);
}

function onPluginNotify(msg: string) {
  console.log('[EditorPane] plugin notify:', msg);
}

function onPluginSetRibbon(groups: any[]) {
  emit('plugin-ribbon', groups);
}
</script>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
}

/* 标签栏 */
.ep-tabs-row {
  border-bottom: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
  flex-shrink: 0;
}

.ep-tabs {
  display: flex;
  overflow-x: auto;
  scrollbar-width: thin;
}

.ep-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--fast-duration), color var(--fast-duration);
  margin-left: var(--spacer-1);
  margin-top: var(--spacer-1);
  margin-bottom: -1px;
  user-select: none;
}

.ep-tab:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.ep-tab.active {
  background: var(--ctrl-fill-default);
  border-color: var(--divider-stroke);
  color: var(--text-primary);
  font-weight: 500;
}

.ep-tab .tab-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.ep-tab.active .tab-icon {
  color: var(--accent-base);
}

.ep-tab .tab-title {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}



/* 内容区 */
.ep-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}

.ep-content > * {
  flex: 1;
}

.ep-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--spacer-2);
  color: var(--text-tertiary);
}

.ep-empty > svg {
  width: 48px;
  height: 48px;
}

.ep-empty h3 {
  color: var(--text-primary);
  margin: 0;
  font-size: var(--font-size-lg);
}

.ep-empty p {
  margin: 0;
  font-size: var(--font-size-sm);
}

.ep-binary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--spacer-2);
  color: var(--text-tertiary);
}

.ep-binary p {
  color: var(--text-primary);
  margin: 0;
  font-size: var(--font-size-base);
}

.ep-binary span {
  font-size: var(--font-size-sm);
  font-family: var(--font-mono, monospace);
}

/* Diff 查看器 */
.ep-diff-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
}

.diff-header-bar {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.diff-summary-badge {
  margin-left: auto;
  display: flex;
  gap: var(--spacer-2);
  font-size: 11px;
  font-weight: 600;
}
.diff-summary-badge .diff-add { color: var(--status-success); }
.diff-summary-badge .diff-del { color: var(--status-error); }

.diff-lines-container {
  flex: 1;
  overflow: auto;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 4;
}

.diff-row {
  display: flex;
  min-height: 22px;
  border-bottom: 1px solid transparent;
}
.diff-row.add {
  background: rgba(16, 124, 16, 0.1);
  border-bottom-color: rgba(16, 124, 16, 0.15);
}
.diff-row.del {
  background: rgba(196, 43, 28, 0.1);
  border-bottom-color: rgba(196, 43, 28, 0.15);
}
.diff-row.context {
  background: transparent;
}

.diff-row-num {
  width: 44px;
  min-width: 44px;
  text-align: right;
  padding: 0 8px;
  color: var(--text-tertiary);
  font-size: 11px;
  user-select: none;
  border-right: 1px solid var(--divider-stroke);
  line-height: 22px;
}

.diff-row-sign {
  width: 20px;
  min-width: 20px;
  text-align: center;
  font-weight: 700;
  user-select: none;
  line-height: 22px;
}
.diff-row.add .diff-row-sign { color: var(--status-success); }
.diff-row.del .diff-row-sign { color: var(--status-error); }

.diff-row-text {
  flex: 1;
  padding: 0 8px;
  white-space: pre;
  overflow-x: auto;
  color: var(--text-primary);
  line-height: 22px;
}
</style>