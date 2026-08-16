<template>
  <div class="standard-editor">
    <!-- 顶栏 -->
    <header class="editor-top-bar">
      <div class="editor-brand">
        <BrandLogo :size="20" marginRight="8px" marginBottom="-2px" />
        <span class="brand-text">CSES Cloud · 标准编辑器</span>
      </div>
      <div class="editor-actions">
        <span class="file-type-badge" v-if="currentFile">{{ currentFileType }}</span>
      </div>
    </header>

    <!-- 标签页（在 Ribbon 上方） -->
    <div class="editor-tabs-row" v-if="openTabs.length > 0">
      <div class="editor-tabs">
        <div
          v-for="tab in openTabs"
          :key="tab.id"
          class="editor-tab"
          :class="{ active: activeTab === tab.id, dirty: tab.dirty }"
          @click="activeTab = tab.id"
        >
          <span class="tab-icon"><Icon :icon="tab.icon" :size="14" /></span>
          <span class="tab-title">{{ tab.title }}</span>
          <span class="tab-close" @click.stop="closeTab(tab)">×</span>
        </div>
        <button class="new-tab-btn" @click="addNewTab" title="新建标签页">+</button>
      </div>
    </div>

    <!-- Ribbon 工具栏 -->
    <RibbonToolbar
      :editor-info="editorInfo"
      :saving="saving"
      :can-undo="!!currentFile"
      :can-redo="!!currentFile"
      :can-save="!!currentFile"
      :can-auto-save="!!currentFile"
      :right-actions="[
        { id: 'history', label: '操作记录', icon: 'ri-history-line', enabled: !!currentFile },
        { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', enabled: !!currentFile },
        { id: 'import', label: '导入', icon: 'ri-download-line', enabled: !!currentFile },
        { id: 'export', label: '导出', icon: 'ri-upload-2-line', enabled: !!currentFile },
      ]"
      @save="saveCurrent"
      @undo="handleUndo"
      @redo="handleRedo"
      @tool-click="onRibbonTool"
      @autosize-change="onAutoSaveChange"
      @edit-click="addNewTab"
    />

    <div class="editor-body">
      <div class="editor-area">
        <div class="editor-content">
          <template v-if="currentFile">
            <div class="code-editor">
              <div class="line-numbers">
                <div v-for="n in lineCount" :key="n" class="line-number">{{ n }}</div>
              </div>
              <textarea
                v-model="currentFile.content"
                class="code-textarea"
                spellcheck="false"
                :data-language="currentFile.language"
              ></textarea>
            </div>
          </template>
          <div v-else class="empty-editor">
            <div class="empty-icon"><Icon icon="ri-file-2-line" :size="48" /></div>
            <div class="empty-text">选择一个文件开始编辑</div>
          </div>
        </div>
      </div>

      <div class="editor-splitter" @mousedown="startDrag"></div>

      <div class="split-area" :style="{ width: rightPanelWidth + '%' }">
        <div class="split-tabs">
          <button
            v-for="panel in sidePanels"
            :key="panel.id"
            class="split-tab"
            :class="{ active: activePanel === panel.id }"
            @click="activePanel = panel.id"
          >
            <Icon :icon="panel.icon" :size="14" /> {{ panel.label }}
          </button>
        </div>
        <div class="split-content">
          <div v-if="activePanel === 'preview'" class="preview-panel">
            <div class="panel-placeholder">
              <div class="placeholder-icon"><Icon icon="ri-eye-line" :size="48" /></div>
              <div class="placeholder-title">预览面板</div>
              <div class="placeholder-desc">在此处预览当前文件的渲染效果</div>
            </div>
          </div>
          <div v-else-if="activePanel === 'console'" class="console-panel">
            <div class="panel-placeholder">
              <div class="placeholder-icon"><Icon icon="ri-code-s-slash-line" :size="48" /></div>
              <div class="placeholder-title">控制台</div>
              <div class="placeholder-desc">查看运行时输出和错误信息</div>
            </div>
          </div>
          <div v-else-if="activePanel === 'properties'" class="properties-panel">
            <div class="property-item" v-for="prop in properties" :key="prop.label">
              <label>{{ prop.label }}</label>
              <input type="text" :value="prop.value" readonly />
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer class="editor-status-bar">
      <div class="status-left">
        <span class="status-item">行 {{ currentLine }}, 列 {{ currentColumn }}</span>
        <span class="status-item">{{ currentFile?.language || 'plaintext' }}</span>
        <span class="status-item">UTF-8</span>
        <StatusBarExtensions />
      </div>
      <div class="status-right">
        <span class="status-item">{{ autoSave ? '自动保存: 开' : '自动保存: 关' }}</span>
        <span class="status-item" v-if="currentFile">字符数: {{ currentFile.content?.length || 0 }}</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import BrandLogo from '../../components/BrandLogo.vue';
import RibbonToolbar from '../../components/editor/RibbonToolbar.vue';
import StatusBarExtensions from '../../components/editor/panels/StatusBarExtensions.vue';

interface EditorTab {
  id: string;
  title: string;
  icon: string;
  type: string;
  language: string;
  content: string;
  dirty: boolean;
  lastEdit: string;
  editor: string;
}

const activeTab = ref('tab-1');
const autoSave = ref(true);
const saving = ref(false);
const rightPanelWidth = ref(30);
const activePanel = ref('preview');
const currentLine = ref(1);
const currentColumn = ref(1);

const openTabs = ref<EditorTab[]>([
  {
    id: 'tab-1',
    title: 'config.json',
    icon: 'ri-file-2-line',
    type: 'JSON 配置',
    language: 'json',
    content: '{\n  "name": "CSES Cloud",\n  "version": "1.0.0",\n  "features": {\n    "editor": true,\n    "cloud": true\n  }\n}',
    dirty: false,
    lastEdit: '5 分钟前',
    editor: '管理员'
  },
  {
    id: 'tab-2',
    title: 'index.html',
    icon: 'ri-globe-line',
    type: 'HTML 页面',
    language: 'html',
    content: '<!DOCTYPE html>\n<html>\n<head>\n  <title>示例</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>',
    dirty: false,
    lastEdit: '10 分钟前',
    editor: '张老师'
  },
  {
    id: 'tab-3',
    title: 'style.css',
    icon: 'ri-palette-line',
    type: 'CSS 样式',
    language: 'css',
    content: 'body {\n  margin: 0;\n  padding: 0;\n  font-family: sans-serif;\n}\n\nh1 {\n  color: #0067C0;\n}',
    dirty: true,
    lastEdit: '1 分钟前',
    editor: '管理员'
  }
]);

const sidePanels = [
  { id: 'preview', icon: 'ri-eye-line', label: '预览' },
  { id: 'console', icon: 'ri-code-s-slash-line', label: '控制台' },
  { id: 'properties', icon: 'ri-settings-3-line', label: '属性' }
];

const properties = ref([
  { label: '文件路径', value: '/projects/example/config.json' },
  { label: '文件大小', value: '256 字节' },
  { label: '创建时间', value: '2024-01-15 10:30' },
  { label: '修改时间', value: '2024-01-15 14:22' }
]);

const currentFile = computed(() => {
  return openTabs.value.find(t => t.id === activeTab.value);
});

const currentFileType = computed(() => {
  const lang = currentFile.value?.language || 'plaintext';
  return lang.toUpperCase();
});

const editorInfo = computed(() => {
  if (!currentFile.value) return undefined;
  return {
    title: currentFile.value.title,
    type: currentFile.value.type,
    icon: currentFile.value.icon,
    lastUpdated: currentFile.value.lastEdit,
    lastEditor: currentFile.value.editor,
    editButtonLabel: '新建文件',
  };
});

const lineCount = computed(() => {
  if (!currentFile.value) return 1;
  return currentFile.value.content.split('\n').length;
});

function addNewTab() {
  const newTab: EditorTab = {
    id: `tab-${Date.now()}`,
    title: '未命名文件',
    icon: 'ri-file-2-line',
    type: '文本文件',
    language: 'plaintext',
    content: '',
    dirty: false,
    lastEdit: '刚刚',
    editor: '当前用户'
  };
  openTabs.value.push(newTab);
  activeTab.value = newTab.id;
}

function closeTab(tab: EditorTab) {
  const index = openTabs.value.findIndex(t => t.id === tab.id);
  openTabs.value.splice(index, 1);
  if (activeTab.value === tab.id) {
    activeTab.value = openTabs.value[0]?.id || '';
  }
}

function handleUndo() {
  // placeholder
}

function handleRedo() {
  // placeholder
}

function saveCurrent() {
  saving.value = true;
  if (currentFile.value) {
    currentFile.value.dirty = false;
    currentFile.value.lastEdit = '刚刚';
  }
  setTimeout(() => { saving.value = false; }, 500);
}

function onRibbonTool(tool: any) {
  if (tool.command === 'find') { /* open find */ }
  else if (tool.command === 'replace') { /* open replace */ }
  else if (tool.command === 'history') { /* open history */ }
  else if (tool.command === 'version') { /* open version */ }
  else if (tool.command === 'import') { /* handle import */ }
  else if (tool.command === 'export') { /* handle export */ }
  else if (tool.command === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
}

function onAutoSaveChange(v: boolean) {
  autoSave.value = v;
}

function startDrag(e: MouseEvent) {
  const startX = e.clientX;
  const startWidth = rightPanelWidth.value;

  const onMouseMove = (ev: MouseEvent) => {
    const containerWidth = (e.target as HTMLElement).parentElement?.clientWidth || 800;
    const delta = startX - ev.clientX;
    const deltaPercent = (delta / containerWidth) * 100;
    rightPanelWidth.value = Math.min(50, Math.max(15, startWidth + deltaPercent));
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
</script>

<style scoped>
.standard-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
  overflow: hidden;
}

.editor-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3);
  gap: var(--spacer-3);
  flex-shrink: 0;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.new-tab-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 18px;
  transition: background var(--fast-duration), color var(--fast-duration);
  flex-shrink: 0;
}

.new-tab-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.code-editor {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.line-numbers {
  width: 48px;
  background: var(--subtle-secondary);
  border-right: 1px solid var(--divider-stroke);
  padding: var(--spacer-2) var(--spacer-1);
  text-align: right;
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--text-tertiary);
  user-select: none;
  overflow: hidden;
}

.line-number {
  height: 20px;
  line-height: 20px;
}

.code-textarea {
  flex: 1;
  padding: var(--spacer-2);
  background: var(--ctrl-fill-input-active);
  border: none;
  outline: none;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  line-height: 20px;
  color: var(--text-primary);
  resize: none;
  tab-size: 2;
  overflow: auto;
}

.properties-panel {
  padding: var(--spacer-3);
}
</style>