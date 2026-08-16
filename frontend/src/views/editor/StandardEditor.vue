<template>
  <div class="standard-editor">
    <header class="editor-top-bar">
      <div class="editor-brand">
        <BrandLogo :size="20" marginRight="8px" marginBottom="-2px" />
        <span class="brand-text">CSES Cloud · 标准编辑器</span>
      </div>
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
      <div class="editor-actions">
      </div>
    </header>

    <div class="editor-toolbar">
      <div class="toolbar-section editor-desc">
        <div class="editor-icon"><Icon :icon="currentFile?.icon || 'ri-file-2-line'" :size="24" /></div>
        <div class="editor-info">
          <div class="editor-title-row">
            <span class="editor-title">{{ currentFile?.title || '未命名文件' }}</span>
            <span class="editor-type">{{ currentFile?.type || '文本文件' }}</span>
          </div>
          <div class="editor-meta">
            <span v-if="currentFile?.lastEdit">上次编辑: {{ currentFile.lastEdit }}</span>
            <span v-if="currentFile?.editor">编辑人: {{ currentFile.editor }}</span>
          </div>
        </div>
        <button class="btn-sm">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.741 1.759C12.939 1.957 12.939 2.273 12.741 2.471L11.471 3.741L13.75 6.02C14.135 6.405 14.135 7.027 13.75 7.412L7.9145 13.247C7.721 13.441 7.409 13.441 7.215 13.247L4.693 10.725C4.5 10.531 4.5 10.219 4.693 10.025L10.529 4.189L9.658 3.318C9.463 3.123 9.463 2.808 9.658 2.613L11.106 1.165C11.301 0.97 11.616 0.97 11.811 1.165L12.741 1.759Z" />
          </svg>
          编辑
        </button>
        <button class="btn-sm">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.5 4.5C2.5 4.22386 2.72386 4 3 4H13C13.2761 4 13.5 4.22386 13.5 4.5C13.5 4.77614 13.2761 5 13 5H3C2.72386 5 2.5 4.77614 2.5 4.5Z M2.5 8C2.5 7.72386 2.72386 7.5 3 7.5H13C13.2761 7.5 13.5 7.72386 13.5 8C13.5 8.27614 13.2761 8.5 13 8.5H3C2.72386 8.5 2.5 8.27614 2.5 8Z M2.5 11.5C2.5 11.2239 2.72386 11 3 11H13C13.2761 11 13.5 11.2239 13.5 11.5C13.5 11.7761 13.2761 12 13 12H3C2.72386 12 2.5 11.7761 2.5 11.5Z" />
          </svg>
          菜单
        </button>
      </div>

      <div class="toolbar-section developer-tools">
        <button class="tool-btn" title="加粗">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.5 3H7.5C9.433 3 11 4.567 11 6.5C11 7.577 10.503 8.516 9.737 9.132C10.615 9.794 11.25 10.928 11.25 12.25C11.25 14.084 9.784 15.5 8 15.5H4.5C4.22386 15.5 4 15.2761 4 15V1C4 0.723858 4.22386 0.5 4.5 0.5H7C9.20914 0.5 11 2.29086 11 4.5C11 5.56014 10.585 6.55556 9.87867 7.25C10.7537 7.9375 11.25 8.97099 11.25 10.125C11.25 11.75 10.1776 13 8.5 13H5.5V5H7C7.82843 5 8.5 5.67157 8.5 6.5C8.5 7.32843 7.82843 8 7 8H5.5V15H4.5V3Z" />
          </svg>
        </button>
        <button class="tool-btn" title="斜体">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8.75 3H3.25C2.97386 3 2.75 3.22386 2.75 3.5C2.75 3.77614 2.97386 4 3.25 4H7.79L6.44 12H3.25C2.97386 12 2.75 12.2239 2.75 12.5C2.75 12.7761 2.97386 13 3.25 13H8.75C9.02614 13 9.25 12.7761 9.25 12.5C9.25 12.2239 9.02614 12 8.75 12H4.21L5.56 4H8.75C9.02614 4 9.25 3.77614 9.25 3.5C9.25 3.22386 9.02614 3 8.75 3Z" />
          </svg>
        </button>
        <button class="tool-btn" title="下划线">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.5 1.75C4.5 1.47386 4.72386 1.25 5 1.25C5.27614 1.25 5.5 1.47386 5.5 1.75V7C5.5 8.933 7.067 10.5 9 10.5C10.933 10.5 12.5 8.933 12.5 7V1.75C12.5 1.47386 12.7239 1.25 13 1.25C13.2761 1.25 13.5 1.47386 13.5 1.75V7C13.5 9.76142 11.2614 12 8.5 12C5.73858 12 3.5 9.76142 3.5 7V1.75C3.5 1.47386 3.72386 1.25 4 1.25C4.27614 1.25 4.5 1.47386 4.5 1.75Z M3.75 13.5C3.75 13.2239 3.97386 13 4.25 13H12.75C13.0261 13 13.25 13.2239 13.25 13.5C13.25 13.7761 13.0261 14 12.75 14H4.25C3.97386 14 3.75 13.7761 3.75 13.5Z" />
          </svg>
        </button>
        <div class="toolbar-divider"></div>
        <button class="tool-btn" title="撤销">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 3C8.53757 3 11 5.46243 11 8.5C11 11.5376 8.53757 14 5.5 14H4.75C4.47386 14 4.25 13.7761 4.25 13.5C4.25 13.2239 4.47386 13 4.75 13H5.5C7.62294 13 9.25 11.3729 9.25 9.25C9.25 7.12706 7.62294 5.5 5.5 5.5H6.25C6.52614 5.5 6.75 5.27614 6.75 5C6.75 4.72386 6.52614 4.5 6.25 4.5H4.25C3.97386 4.5 3.75 4.72386 3.75 5V7C3.75 7.27614 3.97386 7.5 4.25 7.5C4.52614 7.5 4.75 7.27614 4.75 7V5.75C4.75 5.74794 4.75 5.74653 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513C4.75 5.74513 4.75 5.74513 4.75 5.74513Z" />
          </svg>
        </button>
        <button class="tool-btn" title="重做">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.5 3C7.46243 3 5 5.46243 5 8.5C5 11.5376 7.46243 14 10.5 14H11.25C11.5261 14 11.75 13.7761 11.75 13.5C11.75 13.2239 11.5261 13 11.25 13H10.5C8.37706 13 6.75 11.3729 6.75 9.25C6.75 7.12706 8.37706 5.5 10.5 5.5H9.75C9.47386 5.5 9.25 5.27614 9.25 5C9.25 4.72386 9.47386 4.5 9.75 4.5H11.75C12.0261 4.5 12.25 4.72386 12.25 5V7C12.25 7.27614 12.0261 7.5 11.75 7.5C11.4739 7.5 11.25 7.27614 11.25 7V5.75H10.5C10.5 5.74794 10.5 5.74653 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513C10.5 5.74513 10.5 5.74513 10.5 5.74513Z" />
          </svg>
        </button>
        <div class="toolbar-divider"></div>
        <button class="tool-btn" title="查找">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.5 2C4.01472 2 2 4.01472 2 6.5C2 8.98528 4.01472 11 6.5 11C8.98528 11 11 8.98528 11 6.5C11 4.01472 8.98528 2 6.5 2ZM1.25 6.5C1.25 3.57752 3.57752 1.25 6.5 1.25C9.42248 1.25 11.75 3.57752 11.75 6.5C11.75 7.97105 11.1403 9.26552 10.1774 10.1092L13.9774 13.9092C14.2171 14.1489 14.2171 14.5311 13.9774 14.7708C13.7377 15.0105 13.3555 15.0105 13.1158 14.7708L9.31579 10.9708C8.4721 11.9336 7.17763 12.5 6.5 12.5C3.57752 12.5 1.25 10.1725 1.25 7.25V6.5Z" />
          </svg>
        </button>
        <button class="tool-btn" title="替换">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3.75C2 3.54013 2.17013 3.37 2.38 3.37H9.62C9.82987 3.37 10 3.54013 10 3.75V7.5C10 7.70987 9.82987 7.88 9.62 7.88H2.38C2.17013 7.88 2 7.70987 2 7.5V3.75Z M0.75 2.38C0.75 1.71172 1.28172 1.18 1.95 1.18H10.05C10.7183 1.18 11.25 1.71172 11.25 2.38V8.87C11.25 9.53828 10.7183 10.07 10.05 10.07H1.95C1.28172 10.07 0.75 9.53828 0.75 8.87V2.38Z M16 12.25C16 12.4599 15.8299 12.63 15.62 12.63H8.38C8.17013 12.63 8 12.4599 8 12.25V8.5C8 8.29013 8.17013 8.12 8.38 8.12H15.62C15.8299 8.12 16 8.29013 16 8.5V12.25Z M16 13.62C16 14.2883 15.4683 14.82 14.8 14.82H6.81C6.14172 14.82 5.61 14.2883 5.61 13.62V7.13C5.61 6.46172 6.14172 5.93 6.81 5.93H14.8C15.4683 5.93 16 6.46172 16 7.13V13.62Z" />
          </svg>
        </button>
      </div>

      <div class="toolbar-section file-ops">
        <div class="file-op-group">
          <button class="tool-btn" title="撤销">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 3C8.53757 3 11 5.46243 11 8.5C11 11.5376 8.53757 14 5.5 14H4.75C4.47386 14 4.25 13.7761 4.25 13.5C4.25 13.2239 4.47386 13 4.75 13H5.5C7.62294 13 9.25 11.3729 9.25 9.25C9.25 7.12706 7.62294 5.5 5.5 5.5H6.25C6.52614 5.5 6.75 5.27614 6.75 5C6.75 4.72386 6.52614 4.5 6.25 4.5H4.25C3.97386 4.5 3.75 4.72386 3.75 5V7C3.75 7.27614 3.97386 7.5 4.25 7.5C4.52614 7.5 4.75 7.27614 4.75 7V5.75C4.75 5.74794 4.75 5.74653 4.75 5.74513" />
            </svg>
          </button>
          <button class="tool-btn" title="重做">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 3C7.46243 3 5 5.46243 5 8.5C5 11.5376 7.46243 14 10.5 14H11.25C11.5261 14 11.75 13.7761 11.75 13.5C11.75 13.2239 11.5261 13 11.25 13H10.5C8.37706 13 6.75 11.3729 6.75 9.25C6.75 7.12706 8.37706 5.5 10.5 5.5H9.75" />
            </svg>
          </button>
          <div class="toolbar-divider"></div>
          <button class="tool-btn" title="操作历史"><Icon icon="ri-history-line" :size="16" /></button>
          <button class="tool-btn" title="导入"><Icon icon="ri-download-line" :size="16" /></button>
          <button class="tool-btn" title="导出"><Icon icon="ri-upload-2-line" :size="16" /></button>
        </div>
        <div class="save-group">
          <label class="switch-sm">
            <input type="checkbox" v-model="autoSave" />
            <span>自动保存</span>
          </label>
          <button class="save-btn-lg" @click="saveCurrent">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.5 3.5C2.5 2.67157 3.17157 2 4 2H12C12.8284 2 13.5 2.67157 13.5 3.5V13.5C13.5 14.3284 12.8284 15 12 15H4C3.17157 15 2.5 14.3284 2.5 13.5V3.5Z M4 3H12V5.5C12 5.77614 11.7761 6 11.5 6H4.5C4.22386 6 4 5.77614 4 5.5V3Z M4 7.5C4 7.22386 4.22386 7 4.5 7H11.5C11.7761 7 12 7.22386 12 7.5V13H4V7.5Z" />
            </svg>
            保存
          </button>
        </div>
      </div>
    </div>

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

function saveCurrent() {
  if (currentFile.value) {
    currentFile.value.dirty = false;
    currentFile.value.lastEdit = '刚刚';
  }
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
  height: 44px;
  background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3);
  gap: var(--spacer-3);
  flex-shrink: 0;
  backdrop-filter: var(--flyout-backdrop);
}

.editor-brand {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
  padding-right: var(--spacer-3);
  border-right: 1px solid var(--divider-stroke);
}

.brand-icon {
  font-size: 18px;
}

.brand-text {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.editor-tabs {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  flex: 1;
  overflow-x: auto;
  scrollbar-width: thin;
}

.editor-tab {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.editor-tab:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.editor-tab.active {
  background: var(--ctrl-fill-default);
  border-color: var(--divider-stroke);
  border-bottom-color: transparent;
  color: var(--text-primary);
  font-weight: 500;
}

.editor-tab.dirty .tab-title::after {
  content: '•';
  color: var(--status-warning);
  margin-left: 4px;
}

.tab-icon {
  font-size: 14px;
}

.tab-close {
  /* width: 16px; */
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  font-size: 16px;
  line-height: 1;
  transition: background var(--fast-duration);
}

.tab-close:hover {
  background: var(--subtle-pressed);
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

.editor-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  flex-shrink: 0;
}

.autosave-toggle {
  display: flex;
  align-items: center;
}

.switch-sm {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  cursor: pointer;
}

.switch-sm input {
  width: 14px;
  height: 14px;
  accent-color: var(--accent-base);
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
}

.save-btn:hover {
  background: var(--accent-hover);
}

.editor-toolbar {
  display: flex;
  align-items: stretch;
  height: 92px;
  background: var(--ctrl-fill-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0;
  gap: 0;
  flex-shrink: 0;
  overflow-x: auto;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
}

.toolbar-divider {
  width: 1px;
  height: 100%;
  background: var(--divider-stroke);
}

.editor-desc {
  flex: 0 0 280px;
  min-width: 280px;
  max-width: 280px;
  border-right: 1px solid var(--divider-stroke);
}

.editor-icon {
  font-size: 24px;
  margin-right: var(--spacer-2);
}

.editor-info {
  flex: 1;
  min-width: 0;
}

.editor-title-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.editor-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-type {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding: 1px var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-full);
}

.editor-meta {
  display: flex;
  gap: var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.btn-sm {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.btn-sm:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.developer-tools {
  flex: 1;
  min-width: 0;
  justify-content: flex-start;
  border-right: 1px solid var(--divider-stroke);
}

.tool-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.tool-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.file-ops {
  flex: 0 0 auto;
  gap: var(--spacer-3);
}

.file-op-group {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.save-group {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding-left: var(--spacer-2);
  border-left: 1px solid var(--divider-stroke);
}

.save-btn-lg {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
}

.save-btn-lg:hover {
  background: var(--accent-hover);
}

.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editor-area {
  flex: 1;
  display: flex;
  min-width: 0;
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

.empty-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: var(--spacer-3);
}

.empty-text {
  font-size: var(--font-size-sm);
}

.editor-splitter {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.editor-splitter:hover {
  background: var(--accent-base);
}

.split-area {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  max-width: 50%;
  background: var(--layer-default);
  border-left: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.split-tabs {
  display: flex;
  border-bottom: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
}

.split-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--fast-duration), border-color var(--fast-duration);
}

.split-tab:hover {
  color: var(--text-primary);
}

.split-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-base);
  font-weight: 500;
}

.split-content {
  flex: 1;
  overflow: auto;
}

.panel-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--spacer-4);
  text-align: center;
  color: var(--text-tertiary);
}

.placeholder-icon {
  font-size: 36px;
  margin-bottom: var(--spacer-2);
}

.placeholder-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.placeholder-desc {
  font-size: var(--font-size-xs);
  margin-top: var(--spacer-1);
}

.properties-panel {
  padding: var(--spacer-3);
}

.property-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  margin-bottom: var(--spacer-3);
}

.property-item label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 500;
}

.property-item input {
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  outline: none;
}

.editor-status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  background: var(--subtle-secondary);
  border-top: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.status-left,
.status-right {
  display: flex;
  gap: var(--spacer-3);
}

.status-item {
  white-space: nowrap;
}
</style>
