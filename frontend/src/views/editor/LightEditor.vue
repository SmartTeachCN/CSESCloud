<template>
  <div class="unified-editor">
    <!-- ===== 左侧文件栏 ===== -->
    <aside class="file-sidebar" :class="{ collapsed: !sidebarOpen }">
      <div class="sidebar-header">
        <button v-if="sidebarOpen" class="open-local-btn" @click="openLocalFile">
          <Icon icon="ri-folder-open-line" :size="16" />
          <span>打开本地文件</span>
        </button>
        <input type="file" ref="fileInput" @change="handleFileSelect" hidden />
        <button class="sidebar-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? '收起侧栏' : '展开侧栏'">
          <Icon :icon="sidebarOpen ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'" :size="16" />
        </button>
      </div>

      <template v-if="sidebarOpen">
        <!-- 当前文件 -->
        <div class="current-file-section" v-if="currentFile">
          <div class="current-file-card">
            <div class="file-icon"><Icon :icon="currentFile.icon" :size="20" /></div>
            <div class="file-info">
              <div class="file-name" :title="currentFile.name">{{ currentFile.name }}</div>
              <div class="file-meta">{{ currentFile.size }} · {{ currentFile.modified }}</div>
            </div>
            <span class="dirty-indicator" v-if="dirty">●</span>
          </div>
          <div class="file-actions">
            <button class="file-action-btn" title="保存" @click="saveFile"><Icon icon="ri-save-line" :size="16" /></button>
            <button class="file-action-btn" title="关闭" @click="closeFile"><Icon icon="ri-close-line" :size="16" /></button>
          </div>
        </div>
        <div class="current-file-section empty" v-else>
          <div class="no-file-placeholder">
            <div class="no-file-icon"><Icon icon="ri-file-2-line" :size="32" /></div>
            <div class="no-file-text">未打开文件</div>
            <div class="no-file-hint">点击上方按钮打开文件</div>
          </div>
        </div>

        <!-- 云文件区域 -->
        <div class="cloud-section">
          <div class="cloud-divider">
            <span>云文件</span>
            <button v-if="isLoggedIn" class="cloud-add-btn" @click="showCloudNewDialog = true" title="新建云文件">
              <Icon icon="ri-add-line" :size="14" />
            </button>
          </div>
          <div v-if="!isLoggedIn" class="cloud-login-prompt">
            <div class="login-icon"><Icon icon="ri-cloud-line" :size="36" /></div>
            <div class="login-text">登录以使用云文件</div>
            <button class="login-btn" @click="goLogin">登录</button>
          </div>
          <div v-else class="cloud-file-list">
            <div v-if="cloudLoading" class="cloud-loading">加载中...</div>
            <div
              v-for="file in cloudFiles"
              :key="file.id"
              class="cloud-file-item"
              :class="{ active: currentFile?.id === file.id }"
              @click="openCloudFile(file)"
            >
              <span class="cloud-file-icon"><Icon :icon="file.icon" :size="16" /></span>
              <span class="cloud-file-name">{{ file.name }}</span>
              <span class="cloud-file-size">{{ file.size }}</span>
              <button class="cloud-file-delete" @click.stop="deleteCloudFile(file)" title="删除">
                <Icon icon="ri-close-line" :size="12" />
              </button>
            </div>
            <div v-if="!cloudLoading && cloudFiles.length === 0" class="cloud-empty">
              <span>暂无云文件</span>
            </div>
          </div>
        </div>

        <!-- 存储信息 -->
        <div class="sidebar-footer">
          <div class="storage-info">
            <div class="storage-label">云存储</div>
            <div class="storage-bar"><div class="storage-fill" :style="{ width: storagePercent + '%' }"></div></div>
            <div class="storage-text">{{ storageUsed }} / {{ storageTotal }}</div>
          </div>
        </div>
      </template>
    </aside>

    <!-- ===== 主编辑区 ===== -->
    <div class="editor-main">
      <!-- 顶栏 -->
      <header class="editor-top-bar">
        <div class="top-bar-left">
          <div class="editor-brand">
            <BrandLogo :size="20" marginRight="8px" marginBottom="-2px" />
            <span class="brand-text">CSES Cloud · 轻编辑器</span>
          </div>
        </div>
        <div class="top-bar-right">
          <span v-if="activePlugin" class="plugin-indicator">
            <Icon :icon="activePlugin.icon || 'ri-plug-line'" :size="14" />
            {{ activePlugin.name }}
          </span>
          <span class="file-type-badge" v-if="currentFile">{{ currentFileType }}</span>
        </div>
      </header>

      <!-- Ribbon 工具栏 -->
      <RibbonToolbar
        :editor-info="editorInfo"
        :saving="saving"
        @save="saveFile"
        @undo="handleUndo"
        @redo="handleRedo"
        @tool-click="onRibbonTool"
        @autosize-change="onAutoSaveChange"
        @edit-click="openLocalFile"
      />

      <!-- 编辑器主体 -->
      <div class="editor-body">
        <div class="editor-area" @contextmenu.prevent="onEditorContextMenu">
          <EditorPane
            ref="editorPaneRef"
            :tabs="editorTabs"
            :active-tab-id="currentFile?.id || ''"
            :read-only="false"
            @tab-click="onTabClick"
            @tab-close="onTabClose"
            @update:content="onContentUpdate"
            @plugin-save="onPluginSave"
            @monaco-save="saveFile"
            @monaco-find="openPanel('find')"
            @monaco-replace="openPanel('find')"
          >
            <template #empty-actions>
              <div class="welcome-actions">
                <button class="welcome-btn primary" @click="openLocalFile">
                  <Icon icon="ri-folder-open-line" :size="16" /> 打开本地文件
                </button>
                <button class="welcome-btn secondary" @click="goLogin">
                  <Icon icon="ri-cloud-line" :size="16" /> 登录云服务
                </button>
              </div>
            </template>
          </EditorPane>

          <!-- 右键菜单 -->
          <Teleport to="body">
            <div v-if="contextMenu.visible" class="context-menu-overlay" @click="contextMenu.visible = false" @contextmenu.prevent="contextMenu.visible = false">
              <div class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }">
                <button class="ctx-item" @click="handleUndo(); contextMenu.visible = false">
                  <Icon icon="ri-arrow-go-back-line" :size="14" /> 撤销
                </button>
                <button class="ctx-item" @click="handleRedo(); contextMenu.visible = false">
                  <Icon icon="ri-arrow-go-forward-line" :size="14" /> 重做
                </button>
                <div class="ctx-divider"></div>
                <button class="ctx-item" @click="saveFile(); contextMenu.visible = false">
                  <Icon icon="ri-save-line" :size="14" /> 保存
                </button>
                <button class="ctx-item" @click="handleImport(); contextMenu.visible = false">
                  <Icon icon="ri-download-line" :size="14" /> 导入
                </button>
                <button class="ctx-item" @click="handleExport(); contextMenu.visible = false">
                  <Icon icon="ri-upload-2-line" :size="14" /> 导出
                </button>
                <div class="ctx-divider"></div>
                <button class="ctx-item" @click="openPanel('find'); contextMenu.visible = false">
                  <Icon icon="ri-search-line" :size="14" /> 查找替换
                </button>
                <button class="ctx-item" @click="showShareDialog = true; contextMenu.visible = false" v-if="currentFile">
                  <Icon icon="ri-share-forward-line" :size="14" /> 分享
                </button>
              </div>
            </div>
          </Teleport>
        </div>

        <!-- 分隔条 -->
        <div v-if="!rightPanelCollapsed" class="editor-splitter" @mousedown="startDrag"></div>

        <!-- 右侧面板 -->
        <div class="split-area" :class="{ collapsed: rightPanelCollapsed }" :style="rightPanelCollapsed ? {} : { width: rightPanelWidth + '%' }">
          <!-- 折叠按钮 -->
          <button class="panel-collapse-btn" @click="rightPanelCollapsed = !rightPanelCollapsed" :title="rightPanelCollapsed ? '展开面板' : '收起面板'">
            <Icon :icon="rightPanelCollapsed ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'" :size="14" />
          </button>

          <template v-if="!rightPanelCollapsed">
            <div class="split-tabs" ref="splitTabsRef">
              <div class="split-tabs-scroll">
                <button
                  v-for="(panel, idx) in visiblePanels"
                  :key="panel.id"
                  class="split-tab"
                  :class="{ active: activePanel === panel.id }"
                  @click="activePanel = panel.id"
                  :title="panel.label"
                  draggable="true"
                  @dragstart="onPanelDragStart(idx, $event)"
                  @dragover.prevent="onPanelDragOver(idx)"
                  @drop="onPanelDrop(idx)"
                  @dragend="onPanelDragEnd"
                >
                  <Icon :icon="panel.icon" :size="14" />
                  <span class="tab-label">{{ panel.label }}</span>
                  <button class="tab-close-btn" @click.stop="closePanel(panel.id)" v-if="panel.closable">
                    <Icon icon="ri-close-line" :size="10" />
                  </button>
                </button>
              </div>
              <button class="split-tab add-tab" title="添加面板" @click="showPanelPicker = !showPanelPicker">
                <Icon icon="ri-add-line" :size="14" />
              </button>
              <!-- 面板选择器 -->
              <div v-if="showPanelPicker" class="panel-picker" @click.stop>
                <div class="panel-picker-title">选择面板</div>
                <button
                  v-for="p in availablePanels"
                  :key="p.id"
                  class="panel-picker-item"
                  :class="{ disabled: visiblePanels.some(vp => vp.id === p.id) }"
                  :disabled="visiblePanels.some(vp => vp.id === p.id)"
                  @click="addPanel(p); showPanelPicker = false"
                >
                  <Icon :icon="p.icon" :size="14" />
                  <span>{{ p.label }}</span>
                  <Icon v-if="visiblePanels.some(vp => vp.id === p.id)" icon="ri-check-line" :size="12" class="check-icon" />
                </button>
              </div>
            </div>
            <div class="split-content">
              <AiAssistantPanel
                v-show="activePanel === 'ai'"
                scope="global"
                :editor-context="aiEditorContext"
                @apply-edit="onAiApplyEdit"
              />
              <div v-if="activePanel === 'outline'" class="outline-panel">
                <div class="panel-placeholder" v-if="!currentFile">
                  <div class="placeholder-icon"><Icon icon="ri-list-unordered" :size="48" /></div>
                  <div class="placeholder-title">大纲</div>
                  <div class="placeholder-desc">打开文件后显示内容大纲</div>
                </div>
                <div v-else class="outline-content">
                  <div class="outline-hint">当前文件: {{ currentFile.name }}</div>
                  <div class="outline-hint">行数: {{ lineCount }}</div>
                  <div class="outline-hint">字符数: {{ charCount }}</div>
                </div>
              </div>
              <div v-else-if="activePanel === 'find'" class="find-panel">
                <div class="find-section">
                  <div class="find-row">
                    <Icon icon="ri-search-line" :size="14" />
                    <input v-model="findText" @keyup.enter="doFind" placeholder="查找..." />
                    <button class="find-btn" @click="doFind">查找</button>
                  </div>
                  <div class="find-row">
                    <Icon icon="ri-replace-line" :size="14" />
                    <input v-model="replaceText" placeholder="替换为..." />
                    <button class="find-btn" @click="doReplace">替换</button>
                    <button class="find-btn" @click="doReplaceAll">全部替换</button>
                  </div>
                </div>
              </div>
              <OperationHistoryPanel
                v-else-if="activePanel === 'history'"
                :file-id="currentFile?.source === 'cloud' ? currentFile.id : ''"
                :file-name="currentFile?.name || ''"
                :local-history="localHistory"
                :is-logged-in="isLoggedIn"
                @restore="onHistoryRestore"
              />
              <VersionHistoryPanel
                v-else-if="activePanel === 'version'"
                :file-id="currentFile?.source === 'cloud' ? currentFile.id : ''"
                :file-name="currentFile?.name || ''"
                @restore="onVersionRestore"
              />
              <div v-else-if="activePanel === 'props'" class="props-panel">
                <div class="panel-placeholder" v-if="!currentFile">
                  <div class="placeholder-icon"><Icon icon="ri-settings-3-line" :size="48" /></div>
                  <div class="placeholder-title">文件属性</div>
                  <div class="placeholder-desc">打开文件后显示属性</div>
                </div>
                <div v-else class="property-list">
                  <div class="property-item" v-for="prop in fileProperties" :key="prop.label">
                    <label>{{ prop.label }}</label>
                    <span>{{ prop.value }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 状态栏 -->
      <footer class="editor-status-bar">
        <div class="status-left">
          <span class="status-item" v-if="currentFile">{{ currentFileType }}</span>
          <span class="status-item">UTF-8</span>
          <span class="status-item" v-if="activePlugin">插件: {{ activePlugin.name }}</span>
          <StatusBarExtensions />
        </div>
        <div class="status-right">
          <span class="status-item">{{ autoSave ? '自动保存: 开' : '自动保存: 关' }}</span>
          <span class="status-item" v-if="currentFile">行 {{ lineCount }} · {{ charCount }} 字符</span>
        </div>
      </footer>
    </div>
  </div>

  <!-- 新建云文件对话框 -->
  <Teleport to="body">
    <div v-if="showCloudNewDialog" class="dialog-overlay" @click.self="showCloudNewDialog = false">
      <div class="dialog-card">
        <h3>新建云文件</h3>
        <div class="dialog-field">
          <label>文件名</label>
          <input type="text" v-model="newCloudFileName" class="dialog-input" placeholder="例如：config.json" @keyup.enter="createCloudFile" />
        </div>
        <div class="dialog-actions">
          <button class="secondary-btn" @click="showCloudNewDialog = false">取消</button>
          <button class="primary-btn" @click="createCloudFile">创建</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 分享对话框 -->
  <ShareDialog
    :visible="showShareDialog"
    :file-id="currentFile?.source === 'cloud' ? currentFile.id : ''"
    :file-name="currentFile?.name || ''"
    :file-content="currentFile?.content || ''"
    @close="showShareDialog = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import BrandLogo from '../../components/BrandLogo.vue';
import EditorPane from '../../components/editor/EditorPane.vue';
import type { TabInfo } from '../../components/editor/EditorPane.vue';
import RibbonToolbar from '../../components/editor/RibbonToolbar.vue';
import AiAssistantPanel from '../../components/editor/panels/AiAssistantPanel.vue';
import ShareDialog from '../../components/editor/panels/ShareDialog.vue';
import OperationHistoryPanel from '../../components/editor/panels/OperationHistoryPanel.vue';
import VersionHistoryPanel from '../../components/editor/panels/VersionHistoryPanel.vue';
import StatusBarExtensions from '../../components/editor/panels/StatusBarExtensions.vue';
import { pluginApi } from '../../api';
import { useAuth } from '../../composables/useAuth';
import { api } from '../../api/client';

const router = useRouter();
const { user } = useAuth();

// ===== 侧栏 =====
const sidebarOpen = ref(true);
const fileInput = ref<HTMLInputElement | null>(null);
const isLoggedIn = computed(() => user.value?.type === 'alliance');
const storageUsed = ref('0 B');
const storageTotal = ref('100 MB');

const storagePercent = computed(() => {
  const used = parseFloat(storageUsed.value);
  const total = parseFloat(storageTotal.value);
  return total > 0 ? (used / total) * 100 : 0;
});

// ===== 文件管理 =====
interface EditorFile {
  id: string;
  name: string;
  icon: string;
  size: string;
  modified: string;
  dirty: boolean;
  source: 'local' | 'cloud';
  content?: string;
  ext?: string;
}

interface CloudFile {
  id: string;
  name: string;
  icon: string;
  size: string;
  url: string;
}

const openTabs = ref<EditorFile[]>([]);
const currentFile = ref<EditorFile | null>(null);
const dirty = ref(false);

// AI 编辑器上下文
const aiEditorContext = computed(() => {
  if (!currentFile.value) return undefined;
  return {
    fileName: currentFile.value.name,
    fileContent: currentFile.value.content,
    language: currentFile.value.ext || '',
  };
});
const saving = ref(false);
const autoSave = ref(true);
const editorPaneRef = ref<InstanceType<typeof EditorPane> | null>(null);

// AI 应用编辑
function onAiApplyEdit(payload: { content: string; replaceAll?: boolean }) {
  if (!currentFile.value) return;
  currentFile.value.content = payload.content;
  dirty.value = true;
  // 刷新编辑器内容
  if (editorPaneRef.value) {
    editorPaneRef.value.setValue(payload.content);
  }
  if (autoSave.value) saveCurrentFile();
}

// ===== 右侧面板 =====
const rightPanelCollapsed = ref(false);
const showShareDialog = ref(false);

// ===== 本地操作记录 =====
interface HistoryEntry {
  step: number;
  content: string;
  time: string;
}
const localHistory = ref<HistoryEntry[]>([]);
let localHistoryStep = 0;

// ===== EditorPane 标签映射 =====
const editorTabs = computed<TabInfo[]>(() => openTabs.value.map(t => ({
  id: t.id,
  name: t.name,
  icon: t.icon,
  isText: true, // EditorPane handles non-text separately
  content: t.content || '',
  dirty: t.dirty,
  language: t.ext || 'plaintext',
  ext: t.ext,
})));

const cloudFiles = ref<CloudFile[]>([]);
const cloudLoading = ref(false);

// ===== 云文件 API 封装 =====
const cloudApi = {
  list: () => api.get<any[]>('/cloud-files.php?action=list'),
  get: (id: number) => api.get<any>(`/cloud-files.php?action=get&id=${id}`),
  create: (body: any) => api.post('/cloud-files.php?action=create', body),
  update: (body: any) => api.post('/cloud-files.php?action=update', body),
  delete: (id: number) => api.post('/cloud-files.php?action=delete', { id }),
};

async function loadCloudFiles() {
  if (!isLoggedIn.value) return;
  cloudLoading.value = true;
  try {
    const data = await cloudApi.list();
    cloudFiles.value = (data || []).map((f: any) => ({
      id: String(f.id),
      name: f.name,
      icon: iconMap[f.file_type] || 'ri-file-2-line',
      size: formatFileSize(f.file_size || 0),
      url: '#',
      file_type: f.file_type,
      updated_at: f.updated_at,
    }));
  } catch {
    cloudFiles.value = [];
  } finally {
    cloudLoading.value = false;
  }
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ===== 新建云文件 =====
const showCloudNewDialog = ref(false);
const newCloudFileName = ref('');

async function createCloudFile() {
  const name = newCloudFileName.value.trim();
  if (!name) return;
  showCloudNewDialog.value = false;
  newCloudFileName.value = '';
  try {
    await cloudApi.create({ name, content: '', file_type: name.split('.').pop() || 'txt' });
    await loadCloudFiles();
  } catch (e: any) {
    console.error('创建云文件失败', e);
  }
}

async function deleteCloudFile(file: CloudFile) {
  if (!confirm(`确定删除云文件 "${file.name}" 吗？`)) return;
  try {
    await cloudApi.delete(Number(file.id));
    // 如果当前打开的是这个文件，关闭它
    if (currentFile.value?.id === file.id) {
      closeTab(currentFile.value);
    }
    await loadCloudFiles();
  } catch (e: any) {
    console.error('删除云文件失败', e);
  }
}

// ===== 插件系统（仅用于顶栏指示器） =====
const activePlugin = ref<any>(null);
const allPlugins = ref<any[]>([]);

// ===== 编辑器语言 =====
const currentFileType = computed(() => {
  const ext = currentFile.value?.ext || '';
  const typeMap: Record<string, string> = {
    json: 'JSON', xml: 'XML', yaml: 'YAML', yml: 'YAML', txt: '文本',
    js: 'JavaScript', ts: 'TypeScript', html: 'HTML', css: 'CSS',
    md: 'Markdown', php: 'PHP', csv: 'CSV', sql: 'SQL', py: 'Python'
  };
  return typeMap[ext] || ext.toUpperCase() || '文本';
});

// ===== Ribbon 编辑器信息 =====
const editorInfo = computed(() => {
  if (!currentFile.value) return undefined;
  return {
    title: currentFile.value.name,
    type: currentFileType.value,
    icon: currentFile.value.icon,
    lastUpdated: currentFile.value.modified,
    lastEditor: currentFile.value.source === 'local' ? '本地文件' : '云端文件',
    editButtonLabel: '打开文件',
  };
});

const editorLanguage = computed(() => currentFile.value?.ext || 'plaintext');

const lineCount = computed(() => currentFile.value?.content ? currentFile.value.content.split('\n').length : 0);
const charCount = computed(() => currentFile.value?.content ? currentFile.value.content.length : 0);

// ===== EditorPane 事件处理 =====
function onTabClick(tabId: string) {
  const tab = openTabs.value.find(t => t.id === tabId);
  if (tab) selectTab(tab);
}

function onTabClose(tabId: string) {
  const tab = openTabs.value.find(t => t.id === tabId);
  if (tab) closeTab(tab);
}

function onContentUpdate(payload: { tabId: string; content: string }) {
  const tab = openTabs.value.find(t => t.id === payload.tabId);
  if (tab) {
    tab.content = payload.content;
    tab.dirty = true;
    dirty.value = true;
    addLocalHistory(payload.content);
  }
}

function onPluginSave(content: string) {
  if (currentFile.value) {
    currentFile.value.content = content;
    currentFile.value.dirty = false;
    dirty.value = false;
  }
}

// ===== 右侧面板 =====
interface PanelDef {
  id: string;
  label: string;
  icon: string;
  closable: boolean;
}
const allAvailablePanels: PanelDef[] = [
  { id: 'ai', label: 'AI助理', icon: 'ri-brain-line', closable: false },
  { id: 'props', label: '属性', icon: 'ri-settings-3-line', closable: false },
  { id: 'outline', label: '大纲', icon: 'ri-list-unordered', closable: true },
  { id: 'find', label: '查找替换', icon: 'ri-search-line', closable: true },
  { id: 'history', label: '操作记录', icon: 'ri-history-line', closable: true },
  { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', closable: true },
];
const visiblePanels = ref<PanelDef[]>([
  allAvailablePanels[0], // AI助理
  allAvailablePanels[1], // 属性
]);
const activePanel = ref('ai');
const showPanelPicker = ref(false);

const availablePanels = computed(() => allAvailablePanels.filter(p => !visiblePanels.value.some(vp => vp.id === p.id)));

function openPanel(id: string) {
  const panel = allAvailablePanels.find(p => p.id === id);
  if (!panel) return;
  if (!visiblePanels.value.some(vp => vp.id === id)) {
    visiblePanels.value.push(panel);
  }
  activePanel.value = id;
  if (rightPanelCollapsed.value) rightPanelCollapsed.value = false;
}

function closePanel(id: string) {
  const panel = visiblePanels.value.find(p => p.id === id);
  if (!panel?.closable) return;
  visiblePanels.value = visiblePanels.value.filter(p => p.id !== id);
  if (activePanel.value === id) {
    activePanel.value = visiblePanels.value[0]?.id || 'ai';
  }
}

function addPanel(panel: PanelDef) {
  if (visiblePanels.value.some(vp => vp.id === panel.id)) return;
  visiblePanels.value.push(panel);
  activePanel.value = panel.id;
}

// 拖拽排序
let dragSrcIdx = -1;
function onPanelDragStart(idx: number, e: DragEvent) {
  dragSrcIdx = idx;
  e.dataTransfer!.effectAllowed = 'move';
}
function onPanelDragOver(idx: number) {
  if (dragSrcIdx < 0 || dragSrcIdx === idx) return;
  const panels = [...visiblePanels.value];
  const [item] = panels.splice(dragSrcIdx, 1);
  panels.splice(idx, 0, item);
  visiblePanels.value = panels;
  dragSrcIdx = idx;
}
function onPanelDrop(_idx: number) {
  dragSrcIdx = -1;
}
function onPanelDragEnd() {
  dragSrcIdx = -1;
}

// 查找替换
const findText = ref('');
const replaceText = ref('');
const rightPanelWidth = ref(25);

// ===== 右键菜单 =====
const contextMenu = ref({ visible: false, x: 0, y: 0 });
function onEditorContextMenu(e: MouseEvent) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY };
}

// ===== 文件属性 =====
const fileProperties = computed(() => {
  if (!currentFile.value) return [];
  return [
    { label: '文件名', value: currentFile.value.name },
    { label: '大小', value: currentFile.value.size },
    { label: '类型', value: currentFileType.value },
    { label: '修改时间', value: currentFile.value.modified },
    { label: '来源', value: currentFile.value.source === 'local' ? '本地' : '云端' }
  ];
});

// ===== 图标映射 =====
const iconMap: Record<string, string> = {
  json: 'ri-file-2-line', xml: 'ri-file-list-3-line', yaml: 'ri-settings-3-line', yml: 'ri-settings-3-line',
  txt: 'ri-file-edit-line', js: 'ri-code-s-slash-line', ts: 'ri-code-s-slash-line',
  html: 'ri-globe-line', css: 'ri-palette-line', md: 'ri-file-edit-line', php: 'ri-database-2-line',
  csv: 'ri-bar-chart-line', sql: 'ri-database-2-line', py: 'ri-code-s-slash-line'
};

// ===== 加载插件列表 =====
async function loadPlugins() {
  try {
    allPlugins.value = await pluginApi.published();
  } catch {
    allPlugins.value = [];
  }
}

// ===== 根据后缀查找插件（用于顶栏指示器） =====
async function resolvePlugin(ext: string): Promise<any | null> {
  if (!ext) return null;
  try {
    const plugin = await pluginApi.resolver(ext);
    return plugin;
  } catch {
    return null;
  }
}

// ===== 文件操作 =====
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function openLocalFile() {
  fileInput.value?.click();
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target?.result as string;
    const editorFile: EditorFile = {
      id: `local-${Date.now()}`,
      name: file.name,
      icon: iconMap[ext] || 'ri-file-2-line',
      size: formatSize(file.size),
      modified: new Date().toLocaleString(),
      dirty: false,
      source: 'local',
      content,
      ext
    };
    openFile(editorFile);
  };
  reader.readAsText(file);
  target.value = '';
}

async function openCloudFile(cloudFile: CloudFile) {
  try {
    const data = await cloudApi.get(Number(cloudFile.id));
    const ext = cloudFile.name.split('.').pop()?.toLowerCase() || '';
    const editorFile: EditorFile = {
      id: cloudFile.id,
      name: cloudFile.name,
      icon: cloudFile.icon,
      size: cloudFile.size,
      modified: data.updated_at || '未知',
      dirty: false,
      source: 'cloud',
      content: data.content || '',
      ext
    };
    openFile(editorFile);
  } catch (e: any) {
    console.error('加载云文件失败', e);
  }
}

async function openFile(file: EditorFile) {
  const existing = openTabs.value.find(t => t.id === file.id);
  if (existing) {
    currentFile.value = existing;
    dirty.value = existing.dirty;
    updatePluginIndicator(existing.ext);
    return;
  }

  openTabs.value.push(file);
  currentFile.value = file;
  dirty.value = false;
  updatePluginIndicator(file.ext);
}

async function updatePluginIndicator(ext?: string) {
  if (ext) {
    const plugin = await resolvePlugin(ext);
    activePlugin.value = plugin;
  } else {
    activePlugin.value = null;
  }
}

function selectTab(tab: EditorFile) {
  if (currentFile.value?.id === tab.id) return;
  currentFile.value = tab;
  dirty.value = tab.dirty;
  updatePluginIndicator(tab.ext);
}

function closeTab(tab: EditorFile) {
  const idx = openTabs.value.findIndex(t => t.id === tab.id);
  if (idx === -1) return;
  openTabs.value.splice(idx, 1);
  if (currentFile.value?.id === tab.id) {
    const next = openTabs.value[Math.max(0, idx - 1)] || null;
    currentFile.value = next;
    dirty.value = next?.dirty || false;
    if (next) updatePluginIndicator(next.ext);
    else activePlugin.value = null;
  }
}

function closeFile() {
  if (currentFile.value) {
    closeTab(currentFile.value);
  }
}

async function saveFile() {
  if (!currentFile.value) return;
  saving.value = true;

  try {
    if (currentFile.value.source === 'cloud') {
      await cloudApi.update({
        id: Number(currentFile.value.id),
        content: currentFile.value.content || '',
        file_type: currentFile.value.ext,
      });
    }
    currentFile.value.dirty = false;
    currentFile.value.modified = '刚刚';
    dirty.value = false;
  } catch (e: any) {
    console.error('保存失败', e);
  } finally {
    saving.value = false;
  }
}

// ===== Ribbon 工具回调 =====
function onRibbonTool(tool: any) {
  if (tool.command === 'find') openPanel('find');
  else if (tool.command === 'replace') openPanel('find');
  else if (tool.command === 'history') openPanel('history');
  else if (tool.command === 'version') openPanel('version');
  else if (tool.command === 'share') {
    if (currentFile.value) showShareDialog.value = true;
  }
  else if (tool.command === 'import') handleImport();
  else if (tool.command === 'export') handleExport();
  else if (tool.command === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
}

// ===== 撤销/重做 =====
function handleUndo() {
  editorPaneRef.value?.undo();
}

function handleRedo() {
  editorPaneRef.value?.redo();
}

// ===== 导入/导出 =====
function handleImport() {
  if (!currentFile.value) {
    openLocalFile();
    return;
  }
  if (!confirm('导入将替换当前文本内容，是否继续？')) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.json,.xml,.html,.css,.js,.ts,.md,.yaml,.yml,.php,.csv,.sql,.py,.ini,.env';
  input.onchange = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      currentFile.value!.content = content;
      currentFile.value!.dirty = true;
      dirty.value = true;
      editorPaneRef.value?.setValue(content);
      addLocalHistory(content);
    };
    reader.readAsText(file);
  };
  input.click();
}

function handleExport() {
  if (!currentFile.value) return;
  const blob = new Blob([currentFile.value.content || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentFile.value.name;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== 本地操作记录 =====
function addLocalHistory(content: string) {
  localHistoryStep++;
  localHistory.value.push({
    step: localHistoryStep,
    content,
    time: new Date().toLocaleTimeString()
  });
  if (localHistory.value.length > 30) {
    localHistory.value = localHistory.value.slice(-30);
  }
}

function onHistoryRestore(content: string) {
  if (!currentFile.value) return;
  if (!confirm('恢复到此步骤？若此时编辑将删除更新的记录')) return;
  currentFile.value.content = content;
  currentFile.value.dirty = true;
  dirty.value = true;
  editorPaneRef.value?.setValue(content);
  addLocalHistory(content);
}

function onVersionRestore(content: string, versionLabel: string) {
  if (!currentFile.value) return;
  if (!confirm(`恢复到版本 "${versionLabel}"？当前未保存的更改将丢失`)) return;
  currentFile.value.content = content;
  currentFile.value.dirty = true;
  dirty.value = true;
  editorPaneRef.value?.setValue(content);
  addLocalHistory(content);
}

function onAutoSaveChange(v: boolean) {
  autoSave.value = v;
}

// ===== 查找替换 =====
function doFind() {
  const content = currentFile.value?.content;
  if (!findText.value || !content) return;
  const idx = content.indexOf(findText.value);
  if (idx === -1) {
    alert('未找到');
  }
}

function doReplace() {
  if (!findText.value || !currentFile.value) return;
  currentFile.value.content = currentFile.value.content.replace(findText.value, replaceText.value);
  currentFile.value.dirty = true;
  dirty.value = true;
}

function doReplaceAll() {
  if (!findText.value || !currentFile.value) return;
  currentFile.value.content = currentFile.value.content.split(findText.value).join(replaceText.value);
  currentFile.value.dirty = true;
  dirty.value = true;
}

// ===== 拖拽分隔条 =====
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

// ===== 导航 =====
function goLogin() {
  router.push('/login');
}

onMounted(() => {
  loadPlugins();
  if (isLoggedIn.value) loadCloudFiles();
});
</script>

<style scoped>
.unified-editor {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
  overflow: hidden;
}

/* ---- 侧栏 ---- */
.file-sidebar {
  width: 260px;
  display: flex;
  flex-direction: column;
  background: var(--layer-default);
  border-right: 1px solid var(--divider-stroke);
  flex-shrink: 0;
  transition: width var(--normal-duration) var(--fast-out-slow-in);
}
.file-sidebar.collapsed { width: 48px; }

.sidebar-header {
  padding: var(--spacer-2);
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}
.file-sidebar.collapsed .sidebar-header { justify-content: center; padding: var(--spacer-2); }
.file-sidebar.collapsed .open-local-btn { display: none; }

.sidebar-toggle {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--text-secondary); cursor: pointer;
  flex-shrink: 0;
}
.sidebar-toggle:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.open-local-btn {
  flex: 1; min-width: 0;
  display: flex; align-items: center; justify-content: center;
  gap: var(--spacer-2); width: 100%;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--accent-base); color: white;
  border: none; border-radius: var(--radius-md);
  font-size: var(--font-size-sm); font-weight: 500; cursor: pointer;
}
.open-local-btn:hover { background: var(--accent-hover); }

.current-file-section { padding: var(--spacer-3); border-bottom: 1px solid var(--divider-stroke); }
.current-file-section.empty { padding: var(--spacer-4) var(--spacer-3); }

.current-file-card {
  display: flex; align-items: center; gap: var(--spacer-2);
  padding: var(--spacer-2); background: var(--subtle-secondary);
  border-radius: var(--radius-md); margin-bottom: var(--spacer-2); position: relative;
}
.file-icon { font-size: 24px; flex-shrink: 0; }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-meta { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 2px; }
.dirty-indicator { color: var(--status-warning); font-size: 12px; }

.file-actions { display: flex; gap: var(--spacer-1); }
.file-action-btn {
  flex: 1; height: 32px; background: transparent;
  border: 1px solid var(--divider-stroke); border-radius: var(--radius-sm);
  cursor: pointer; font-size: 14px;
}
.file-action-btn:hover { background: var(--subtle-secondary); }

.no-file-placeholder { display: flex; flex-direction: column; align-items: center; gap: var(--spacer-1); text-align: center; color: var(--text-tertiary); }
.no-file-icon { font-size: 32px; margin-bottom: var(--spacer-2); }
.no-file-text { font-size: var(--font-size-sm); font-weight: 500; color: var(--text-secondary); }
.no-file-hint { font-size: var(--font-size-xs); }

.cloud-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: var(--spacer-2) var(--spacer-3); }
.cloud-divider { display: flex; align-items: center; gap: var(--spacer-2); margin: var(--spacer-3) 0 var(--spacer-3); }
.cloud-divider::before { content: ''; flex: 1; height: 1px; background: var(--divider-stroke); }
.cloud-divider::after { content: ''; width: 0; }
.cloud-divider span { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
.cloud-add-btn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius-xs); }
.cloud-add-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.cloud-loading { text-align: center; padding: var(--spacer-4); font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cloud-login-prompt { display: flex; flex-direction: column; align-items: center; padding: var(--spacer-4); text-align: center; }
.login-icon { font-size: 36px; margin-bottom: var(--spacer-2); }
.login-text { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacer-3); }
.login-btn { padding: var(--spacer-1) var(--spacer-4); background: var(--accent-base); color: white; border: none; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; cursor: pointer; }
.login-btn:hover { background: var(--accent-hover); }

.cloud-file-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--spacer-1); }
.cloud-file-item { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2); background: transparent; border-radius: var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer; }
.cloud-file-item:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.cloud-file-item:hover .cloud-file-delete { display: flex; }
.cloud-file-item.active { background: var(--subtle-pressed); color: var(--text-primary); }
.cloud-file-icon { font-size: 16px; }
.cloud-file-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cloud-file-size { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.cloud-file-delete { display: none; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius-xs); flex-shrink: 0; }
.cloud-file-delete:hover { color: var(--status-error); background: rgba(196, 43, 43, 0.08); }
.cloud-empty { text-align: center; padding: var(--spacer-4); font-size: var(--font-size-xs); color: var(--text-tertiary); }

.sidebar-footer { padding: var(--spacer-3); border-top: 1px solid var(--divider-stroke); background: var(--subtle-secondary); }
.storage-info { display: flex; flex-direction: column; gap: var(--spacer-1); }
.storage-label { font-size: var(--font-size-xs); font-weight: 500; color: var(--text-tertiary); }
.storage-bar { height: 4px; background: var(--divider-stroke); border-radius: var(--radius-full); overflow: hidden; }
.storage-fill { height: 100%; background: var(--accent-base); border-radius: var(--radius-full); transition: width var(--fast-duration); }
.storage-text { font-size: var(--font-size-xs); color: var(--text-tertiary); }

/* ---- 主编辑区 ---- */
.editor-main {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  overflow: hidden; background: var(--app-bg);
}

.editor-top-bar {
  display: flex; align-items: center; justify-content: space-between;
  height: 44px; background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3); gap: var(--spacer-3); flex-shrink: 0;
}
.top-bar-left { display: flex; align-items: center; gap: var(--spacer-3); flex: 1; min-width: 0; }
.editor-brand { display: flex; align-items: center; gap: var(--spacer-2); flex-shrink: 0; padding-right: var(--spacer-3); border-right: 1px solid var(--divider-stroke); }
.brand-text { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); }

.top-bar-right { display: flex; align-items: center; gap: var(--spacer-2); flex-shrink: 0; }
.plugin-indicator { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); color: var(--accent-base); padding: 2px var(--spacer-2); background: var(--accent-bg); border-radius: var(--radius-full); }
.file-type-badge { font-size: var(--font-size-xs); color: var(--text-tertiary); padding: 2px var(--spacer-2); background: var(--subtle-secondary); border-radius: var(--radius-full); }

/* ---- 编辑器主体 ---- */
.editor-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.editor-area { flex: 1; min-width: 0; background: var(--app-bg); position: relative; }

/* empty-actions slot 按钮 */
.welcome-actions { display: flex; flex-direction: column; gap: var(--spacer-2); margin-top: var(--spacer-3); }
.welcome-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--spacer-2); padding: var(--spacer-3) var(--spacer-5); border-radius: var(--radius-md); font-size: var(--font-size-base); font-weight: 500; cursor: pointer; border: none; }
.welcome-btn.primary { background: var(--accent-base); color: white; }
.welcome-btn.primary:hover { background: var(--accent-hover); }
.welcome-btn.secondary { background: var(--subtle-secondary); color: var(--text-primary); }
.welcome-btn.secondary:hover { background: var(--subtle-pressed); }

/* ---- 分隔条 ---- */
.editor-splitter { width: 4px; background: transparent; cursor: col-resize; flex-shrink: 0; position: relative; z-index: 5; }
.editor-splitter:hover { background: var(--accent-base); }

/* ---- 右侧面板 ---- */
.split-area { display: flex; flex-direction: column; min-width: 200px; max-width: 50%; background: var(--layer-default); border-left: 1px solid var(--divider-stroke); flex-shrink: 0; position: relative; }
.split-area.collapsed { min-width: 32px; max-width: 32px; border-left: 1px solid var(--divider-stroke); }
.split-tabs { display: flex; border-bottom: 1px solid var(--divider-stroke); background: var(--subtle-secondary); flex-shrink: 0; position: relative; }
.split-tabs-scroll { display: flex; overflow-x: auto; flex: 1; scrollbar-width: none; }
.split-tabs-scroll::-webkit-scrollbar { display: none; }
.split-tab { display: inline-flex; align-items: center; gap: 4px; padding: var(--spacer-2) var(--spacer-3); background: transparent; border: none; border-bottom: 2px solid transparent; font-size: var(--font-size-xs); color: var(--text-tertiary); cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.split-tab:hover { color: var(--text-primary); }
.split-tab.active { color: var(--text-primary); border-bottom-color: var(--accent-base); font-weight: 500; }
.split-tab.add-tab { padding: var(--spacer-2) var(--spacer-2); border-left: 1px solid var(--divider-stroke); }
.tab-close-btn { height: 14px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: 2px; margin-left: 2px; }
.tab-close-btn:hover { background: var(--subtle-pressed); color: var(--status-error); }

/* 面板折叠按钮 */
.panel-collapse-btn { position: absolute; left: -16px; top: 50%; transform: translateY(-50%); width: 16px; height: 32px; padding: 2px; display: flex; align-items: center; justify-content: center; background: var(--layer-default); border: 1px solid var(--divider-stroke); border-right: none; border-radius: var(--radius-sm) 0 0 var(--radius-sm); color: var(--text-tertiary); cursor: pointer; z-index: 10; }
.split-area.collapsed .panel-collapse-btn { left: auto; right: 0; border-right: 1px solid var(--divider-stroke); border-left: none; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.panel-collapse-btn:hover { color: var(--text-primary); background: var(--subtle-secondary); }

/* 面板选择器 */
.panel-picker { position: absolute; top: 100%; right: 0; min-width: 160px; background: var(--flyout-bg); border: 1px solid var(--flyout-border); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: 100; padding: var(--spacer-1); }
.panel-picker-title { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); padding: var(--spacer-1) var(--spacer-2); }
.panel-picker-item { display: flex; align-items: center; gap: var(--spacer-2); width: 100%; padding: var(--spacer-1) var(--spacer-2); border: none; background: transparent; color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-sm); }
.panel-picker-item:hover { background: var(--subtle-secondary); }
.panel-picker-item.disabled { opacity: 0.4; cursor: not-allowed; }
.check-icon { margin-left: auto; color: var(--status-success); }
.split-content { flex: 1; overflow: auto; display: flex; flex-direction: column; }

.panel-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: var(--spacer-4); text-align: center; color: var(--text-tertiary); }
.placeholder-icon { font-size: 48px; margin-bottom: var(--spacer-3); }
.placeholder-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary); }
.placeholder-desc { font-size: var(--font-size-xs); margin-top: var(--spacer-1); }

.outline-content, .outline-hint { padding: var(--spacer-3); font-size: var(--font-size-xs); color: var(--text-tertiary); }

.find-panel { padding: var(--spacer-3); }
.find-section { display: flex; flex-direction: column; gap: var(--spacer-2); }
.find-row { display: flex; align-items: center; gap: var(--spacer-2); }
.find-row input { flex: 1; padding: var(--spacer-1) var(--spacer-2); background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-primary); outline: none; }
.find-row input:focus { border-color: var(--accent-base); }
.find-btn { padding: var(--spacer-1) var(--spacer-2); background: var(--subtle-secondary); border: 1px solid var(--ctrl-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-secondary); cursor: pointer; }
.find-btn:hover { background: var(--subtle-pressed); color: var(--text-primary); }

.props-panel { padding: var(--spacer-3); }
.property-list { display: flex; flex-direction: column; gap: var(--spacer-3); }
.property-item { display: flex; flex-direction: column; gap: var(--spacer-1); }
.property-item label { font-size: var(--font-size-xs); color: var(--text-tertiary); font-weight: 500; }
.property-item span { font-size: var(--font-size-sm); color: var(--text-primary); font-family: var(--font-mono, monospace); }

/* ---- 状态栏 ---- */
.editor-status-bar {
  display: flex; justify-content: space-between; align-items: center;
  height: 24px; background: var(--subtle-secondary);
  border-top: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3); font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0;
}
.status-left, .status-right { display: flex; gap: var(--spacer-3); align-items: center; }
.status-item { white-space: nowrap; }

/* ---- 对话框 ---- */
.dialog-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 500; display: flex; align-items: center; justify-content: center; }
.dialog-card { background: var(--flyout-bg); backdrop-filter: var(--flyout-backdrop); border: 1px solid var(--flyout-border); border-radius: var(--radius-lg); padding: var(--spacer-5); min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12); }
.dialog-card h3 { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0 0 var(--spacer-4); }
.dialog-field { display: flex; flex-direction: column; gap: var(--spacer-1); margin-bottom: var(--spacer-4); }
.dialog-field label { font-size: var(--font-size-sm); font-weight: 500; color: var(--text-secondary); }
.dialog-input { height: 36px; padding: 0 var(--spacer-3); background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border-rest); border-radius: var(--radius-sm); color: var(--text-primary); font-size: var(--font-size-sm); outline: none; }
.dialog-input:focus { border-color: var(--accent-base); }
.dialog-actions { display: flex; justify-content: flex-end; gap: var(--spacer-2); }
.primary-btn { display: inline-flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); background: var(--accent-base); color: var(--accent-text); border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-weight: 500; cursor: pointer; }
.primary-btn:hover { background: var(--accent-hover); }
.secondary-btn { display: inline-flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); background: var(--ctrl-fill-default); color: var(--text-primary); border: 1px solid var(--ctrl-border-rest); border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; }
.secondary-btn:hover { background: var(--subtle-secondary); }

/* ---- 右键菜单 ---- */
.context-menu-overlay { position: fixed; inset: 0; z-index: 1000; }
.context-menu { position: fixed; min-width: 180px; background: var(--flyout-bg); border: 1px solid var(--flyout-border); border-radius: var(--radius-md); box-shadow: 0 8px 32px rgba(0,0,0,0.18); padding: var(--spacer-1); z-index: 1001; }
.ctx-item { display: flex; align-items: center; gap: var(--spacer-2); width: 100%; padding: var(--spacer-2) var(--spacer-3); border: none; background: transparent; color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-sm); text-align: left; }
.ctx-item:hover { background: var(--subtle-secondary); }
.ctx-divider { height: 1px; background: var(--divider-stroke); margin: var(--spacer-1) 0; }
</style>