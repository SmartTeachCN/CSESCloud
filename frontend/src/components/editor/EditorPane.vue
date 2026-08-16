<template>
  <div class="editor-pane">
    <!-- 标签栏 -->
    <div class="ep-tabs-row" v-if="tabs.length > 0">
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
        v-else-if="activePlugin"
        ref="pluginEditorRef"
        :plugin="activePlugin"
        :file-info="pluginFileInfo"
        @ready="onPluginReady"
        @save="onPluginSave"
        @notify="onPluginNotify"
      />

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
}

const props = defineProps<{
  tabs: TabInfo[];
  activeTabId: string;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'tab-click', tabId: string): void;
  (e: 'tab-close', tabId: string): void;
  (e: 'update:content', payload: { tabId: string; content: string }): void;
  (e: 'plugin-save', content: string): void;
  (e: 'monaco-save'): void;
  (e: 'monaco-find'): void;
  (e: 'monaco-replace'): void;
}>();

const activePlugin = ref<any>(null);
const pluginEditorRef = ref<InstanceType<typeof PluginEditorFrame> | null>(null);
const monacoEditorRef = ref<InstanceType<typeof MonacoEditor> | null>(null);

// 暴露方法给父组件
defineExpose({
  undo: () => {
    if (activePlugin.value) {
      pluginEditorRef.value?.postMessage?.({ type: 'command', command: 'undo' });
    } else {
      monacoEditorRef.value?.undo();
    }
  },
  redo: () => {
    if (activePlugin.value) {
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
    if (!activePlugin.value) monacoEditorRef.value?.setValue(v);
  },
  focus: () => monacoEditorRef.value?.focus(),
  sendCommand: (cmd: string, data?: any) => {
    if (activePlugin.value) {
      pluginEditorRef.value?.postMessage?.({ type: 'command', command: cmd, data });
    }
  },
});

const activeTab = computed(() => props.tabs.find(t => t.id === props.activeTabId) || null);

const pluginFileInfo = computed(() => ({
  name: activeTab.value?.name || '',
  content: activeTab.value?.content || '',
  path: activeTab.value?.name || ''
}));

// 当 activeTab 变化时解析插件
watch(() => props.activeTabId, async (newId) => {
  activePlugin.value = null;
  const tab = props.tabs.find(t => t.id === newId);
  if (!tab || !tab.ext) return;
  try {
    const plugin = await pluginApi.resolver(tab.ext);
    activePlugin.value = plugin;
  } catch {
    activePlugin.value = null;
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

.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-warning);
  flex-shrink: 0;
}

.tab-close {
  /* width: 18px; */
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
  margin-left: 2px;
}

.tab-close:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
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
</style>