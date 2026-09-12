<template>
  <div class="unified-editor" :class="{ immersive }">
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
        <!-- 云文件区域 -->
        <div class="cloud-section">
          <div class="cloud-divider">
            <span>云文件</span>
            <div class="cloud-divider-line"></div>
            <div class="cloud-plus-menu-wrapper">
              <button class="cloud-plus-btn" @click="showCloudPlusMenu = !showCloudPlusMenu" title="操作">
                <Icon icon="ri-add-line" :size="14" />
              </button>
              <div v-if="showCloudPlusMenu" class="cloud-plus-menu" @click.stop>
                <button class="plus-item" @click="showCloudNewDialog = true; showCloudPlusMenu = false">
                  <Icon icon="ri-file-add-line" :size="14" />
                  <span>新建文件</span>
                </button>
                <button class="plus-item" @click="showCloudNewDirDialog = true; showCloudPlusMenu = false">
                  <Icon icon="ri-folder-add-line" :size="14" />
                  <span>新建目录</span>
                </button>
                <button class="plus-item" @click="triggerCloudUpload(); showCloudPlusMenu = false">
                  <Icon icon="ri-upload-2-line" :size="14" />
                  <span>上传文件</span>
                </button>
                <div class="plus-divider"></div>
                <button class="plus-item" @click="refreshCloudFiles(); showCloudPlusMenu = false">
                  <Icon icon="ri-refresh-line" :size="14" />
                  <span>刷新</span>
                </button>
              </div>
            </div>
          </div>
          <input type="file" ref="cloudUploadInput" @change="handleCloudUpload" hidden />
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
              :class="{ active: currentFile?.id === file.id, 'shared-from-other': file.source === 'shared' }"
              @click="openCloudFile(file)"
              @contextmenu.prevent="onCloudFileCtxMenu(file, $event)"
            >
              <span class="cloud-file-icon"><Icon :icon="file.icon" :size="16" /></span>
              <span class="cloud-file-name">{{ file.name }}</span>
              <span v-if="file.is_shared && file.source !== 'shared'" class="cloud-file-shared-badge" title="已分享">
                <Icon icon="ri-share-line" :size="10" />
              </span>
              <span v-if="file.source === 'shared'" class="cloud-file-shared-from-badge" :title="'来自 ' + file.shared_from + ' 的分享'">
                <Icon icon="ri-share-forward-line" :size="10" /> 来自分享
              </span>
              <span class="cloud-file-size">{{ file.size }}</span>
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
            <AppIcon :icon="activePlugin.icon" :plugin-key="activePlugin.plugin_key" :size="16" fallback="ri-plug-line" />
            {{ activePlugin.name }}
          </span>
          <span class="file-type-badge" v-if="currentFile">{{ currentFileType }}</span>
        </div>
      </header>

      <!-- 标签页（在 Ribbon 上方） -->
      <div class="editor-tabs-row" v-if="editorTabs.length > 0">
        <div class="editor-tabs">
          <div
            v-for="(tab, gi) in editorTabs"
            :key="tab.id"
            class="editor-tab"
            :class="{ active: tab.id === activeEditorTabId, dirty: tab.dirty, 'diff-tab': tab.isDiff }"
            @click="onTabClick(tab.id)"
            @contextmenu.prevent="!tab.isDiff && onOpenTabMenu(tab.id, $event)"
            :draggable="!tab.isDiff"
            @dragstart="onTabDragStart(gi, $event)"
            @dragover.prevent="onTabDragOver(gi)"
            @drop="onTabDrop"
            @dragend="onTabDragEnd"
          >
            <Icon :icon="tab.icon" :size="14" class="tab-icon" />
            <span class="tab-title" :title="tab.name">{{ tab.name }}</span>
            <span v-if="tab.dirty" class="dirty-dot"></span>
            <button class="tab-close" @click.stop="onTabClose(tab.id)" title="关闭">
              <Icon icon="ri-close-line" :size="12" />
            </button>
          </div>
        </div>
      </div>

      <!-- 标签右键菜单 -->
      <Teleport to="body">
        <div v-if="tabCtx.menu.visible" class="tab-menu-overlay" @click="tabCtx.close" @contextmenu.prevent="tabCtx.close">
          <div class="tab-menu" :style="{ left: tabCtx.menu.x + 'px', top: tabCtx.menu.y + 'px' }">
            <button class="tm-item" @click="tabCtx.run('close')">
              <Icon icon="ri-close-line" :size="14" /> 关闭
            </button>
            <div class="tm-divider"></div>
            <button class="tm-item" @click="tabCtx.run('closeAll')">
              <Icon icon="ri-close-circle-line" :size="14" /> 关闭所有标签
            </button>
            <button class="tm-item" @click="tabCtx.run('closeOthers')">
              <Icon icon="ri-file-close-line" :size="14" /> 关闭其他标签
            </button>
            <button class="tm-item" @click="tabCtx.run('closeLeft')">
              <Icon icon="ri-arrow-left-s-line" :size="14" /> 关闭左侧标签
            </button>
            <button class="tm-item" @click="tabCtx.run('closeRight')">
              <Icon icon="ri-arrow-right-s-line" :size="14" /> 关闭右侧标签
            </button>
          </div>
        </div>
      </Teleport>

      <!-- Ribbon 工具栏 -->
      <RibbonToolbar
        :editor-info="editorInfo"
        :saving="saving"
        :is-instance="false"
        :show-view-ribbon="true"
        :manifest="ribbonManifest"
        :system-right-tools="systemRightTools"
        :system-right-selected-tool="isSourceView ? 'toggle-view' : ''"
        :selected-tool="immersive ? 'immersive' : ''"
        :can-undo="!!currentFile"
        :can-redo="!!currentFile"
        :can-save="!!currentFile"
        :can-auto-save="!!currentFile"
        :right-actions="diffTabs.length > 0 && !currentFile
          ? [{ id: 'export', label: '导出', icon: 'ri-upload-2-line', command: 'export', enabled: true }]
          : [
          { id: 'share', label: '分享', icon: 'ri-share-forward-line', command: 'share', enabled: !!currentFile },
          { id: 'history', label: '操作记录', icon: 'ri-history-line', command: 'history', enabled: !!currentFile },
          { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', command: 'version', enabled: !!currentFile && currentFile?.source === 'cloud' },
          { id: 'import', label: '导入', icon: 'ri-download-line', command: 'import', enabled: !!currentFile },
          { id: 'export', label: '导出', icon: 'ri-upload-2-line', command: 'export', enabled: !!currentFile },
        ]"
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
            :active-tab-id="activeEditorTabId"
            :read-only="false"
            :show-source="isSourceView"
            :hide-tabs="true"
            @tab-click="onTabClick"
            @tab-close="onTabClose"
            @update:content="onContentUpdate"
            @plugin-save="onPluginSave"
            @plugin-change="onEditorPluginChange"
            @plugin-ribbon="onPluginRibbon"
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
                <button class="ctx-item" @click="handleShare(); contextMenu.visible = false" v-if="currentFile">
                  <Icon icon="ri-share-forward-line" :size="14" /> 分享
                </button>
              </div>
            </div>
          </Teleport>

          <!-- 云文件右键菜单 -->
          <Teleport to="body">
            <div v-if="cloudCtxMenu.visible" class="context-menu-overlay" @click="cloudCtxMenu.visible = false" @contextmenu.prevent="cloudCtxMenu.visible = false">
              <div class="context-menu" :style="{ left: cloudCtxMenu.x + 'px', top: cloudCtxMenu.y + 'px' }">
                <button class="ctx-item" @click="openCloudFile(cloudCtxMenu.file!); cloudCtxMenu.visible = false">
                  <Icon icon="ri-folder-open-line" :size="14" /> 打开
                </button>
                <button class="ctx-item" @click="handleShareCloudFile(cloudCtxMenu.file!); cloudCtxMenu.visible = false" v-if="cloudCtxMenu.file && cloudCtxMenu.file.source !== 'shared'">
                  <Icon icon="ri-share-forward-line" :size="14" /> 分享
                </button>
                <button class="ctx-item" @click="downloadCloudFile(cloudCtxMenu.file!); cloudCtxMenu.visible = false">
                  <Icon icon="ri-download-line" :size="14" /> 下载
                </button>
                <div class="ctx-divider"></div>
                <button class="ctx-item" @click="renameCloudFile(cloudCtxMenu.file!); cloudCtxMenu.visible = false" v-if="cloudCtxMenu.file && cloudCtxMenu.file.source !== 'shared'">
                  <Icon icon="ri-edit-line" :size="14" /> 重命名
                </button>
                <button class="ctx-item danger" @click="deleteCloudFile(cloudCtxMenu.file!); cloudCtxMenu.visible = false" v-if="cloudCtxMenu.file && cloudCtxMenu.file.source !== 'shared'">
                  <Icon icon="ri-delete-bin-line" :size="14" /> 删除
                </button>
              </div>
            </div>
          </Teleport>
        </div>

        <!-- 分隔条 -->
        <div v-if="!effectiveRightPanelCollapsed" class="editor-splitter" @mousedown="startDrag"></div>

        <!-- 右侧面板 -->
        <div class="split-area" :class="{ collapsed: effectiveRightPanelCollapsed }" :style="effectiveRightPanelCollapsed ? {} : { width: rightPanelWidth + '%' }">
          <button class="panel-collapse-btn" @click="rightPanelCollapsed = !rightPanelCollapsed" :title="effectiveRightPanelCollapsed ? '展开面板' : '收起面板'">
            <Icon :icon="effectiveRightPanelCollapsed ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'" :size="14" />
          </button>

          <template v-if="!effectiveRightPanelCollapsed">
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
                ref="operationHistoryRef"
                :file-id="currentFile?.source === 'cloud' ? currentFile.id : ''"
                :file-name="currentFile?.name || ''"
                :local-history="localHistory"
                :is-logged-in="isLoggedIn"
                workspace-key="light_editor"
                @restore="onHistoryRestore"
                @open-workspace-config="openPanel('workspace')"
              />
              <VersionHistoryPanel
                v-else-if="activePanel === 'version'"
                ref="versionHistoryRef"
                :key="currentFile?.id || 'no-file'"
                :file-id="currentFile?.source === 'cloud' ? currentFile.id : ''"
                :file-name="currentFile?.name || ''"
                :is-owner="currentFile?.source !== 'shared'"
                workspace-key="light_editor"
                @restore="onVersionRestore"
                @open-workspace-config="openPanel('workspace')"
                @view-diff="openDiffTab"
                @preview-version="openPreviewTab"
              />
              <WorkspaceConfig
                v-else-if="activePanel === 'workspace'"
                workspace-key="light_editor"
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

  <!-- 新建云目录对话框 -->
  <Teleport to="body">
    <div v-if="showCloudNewDirDialog" class="dialog-overlay" @click.self="showCloudNewDirDialog = false">
      <div class="dialog-card">
        <h3>新建目录</h3>
        <div class="dialog-field">
          <label>目录名</label>
          <input type="text" v-model="newCloudDirName" class="dialog-input" placeholder="例如：images" @keyup.enter="createCloudDir" />
        </div>
        <div class="dialog-actions">
          <button class="secondary-btn" @click="showCloudNewDirDialog = false">取消</button>
          <button class="primary-btn" @click="createCloudDir">创建</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 重命名对话框 -->
  <Teleport to="body">
    <div v-if="showRenameDialog" class="dialog-overlay" @click.self="showRenameDialog = false">
      <div class="dialog-card">
        <h3>重命名</h3>
        <div class="dialog-field">
          <label>新名称</label>
          <input type="text" v-model="renameFileName" class="dialog-input" @keyup.enter="confirmRename" />
        </div>
        <div class="dialog-actions">
          <button class="secondary-btn" @click="showRenameDialog = false">取消</button>
          <button class="primary-btn" @click="confirmRename">确定</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 分享对话框 -->
  <ShareDialog
    :visible="showShareDialog"
    resource-type="cloud_file"
    :resource-id="currentFile?.source === 'cloud' ? currentFile.id : ''"
    :resource-name="currentFile?.name || ''"
    resource-icon="ri-file-2-line"
    resource-label="文件"
    @close="onShareDialogClose"
    @created="loadCloudFiles"
    @updated="loadCloudFiles"
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
import WorkspaceConfig from '../../components/editor/panels/WorkspaceConfig.vue';
import StatusBarExtensions from '../../components/editor/panels/StatusBarExtensions.vue';
import { pluginApi } from '../../api';
import { useAuth } from '../../composables/useAuth';
import { useTabContextMenu } from '../../composables/useTabContextMenu';
import { api } from '../../api/client';

const router = useRouter();
const { user } = useAuth();

// ===== 侧栏 =====
const sidebarOpen = ref(true);
const fileInput = ref<HTMLInputElement | null>(null);
const cloudUploadInput = ref<HTMLInputElement | null>(null);
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
  source: 'local' | 'cloud' | 'shared';
  content?: string;
  ext?: string;
  readOnly?: boolean;
}

interface CloudFile {
  id: string;
  name: string;
  icon: string;
  size: string;
  url: string;
  is_shared?: number;
  source?: string;
  shared_from?: string;
  shared_permission?: string;
}

const openTabs = ref<EditorFile[]>([]);
const currentFile = ref<EditorFile | null>(null);
const dirty = ref(false);

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
const versionHistoryRef = ref<InstanceType<typeof VersionHistoryPanel> | null>(null);
const operationHistoryRef = ref<InstanceType<typeof OperationHistoryPanel> | null>(null);

function onAiApplyEdit(payload: { content: string; replaceAll?: boolean }) {
  if (!currentFile.value) return;
  currentFile.value.content = payload.content;
  dirty.value = true;
  if (editorPaneRef.value) {
    editorPaneRef.value.setValue(payload.content);
  }
  if (autoSave.value) saveCurrentFile();
}

// ===== 右侧面板 =====
const rightPanelCollapsed = ref(false);
const showShareDialog = ref(false);

// 当 diff 标签激活时强制折叠右侧面板
const effectiveRightPanelCollapsed = computed(() => {
  return rightPanelCollapsed.value || (diffTabs.value.length > 0 && !currentFile.value);
});

// ===== 本地操作记录 =====
interface HistoryEntry {
  id: number;
  action_type: string;
  action_label: string;
  content_snapshot?: string;
  time: string;
}
const localHistory = ref<HistoryEntry[]>([]);
let localHistoryStep = 0;

// ===== EditorPane 标签映射 =====
interface DiffTab {
  id: string;
  name: string;
  label1: string;
  label2: string;
  diffLines: any[];
  additions: number;
  deletions: number;
}
const diffTabs = ref<DiffTab[]>([]);

const isDiffTabActive = computed(() => {
  if (!currentFile.value) {
    // 检查是否有 diff tab 激活
    return diffTabs.value.some(dt => dt.id === (currentFile.value?.id || ''));
  }
  return false;
});

// 当前激活的 EditorPane tab ID
const activeEditorTabId = computed(() => {
  if (currentFile.value) return currentFile.value.id;
  // 检查 diff tabs
  if (diffTabs.value.length > 0) {
    // 返回最后一个 diff tab（最新打开的）
    return diffTabs.value[diffTabs.value.length - 1].id;
  }
  return '';
});

const editorTabs = computed<TabInfo[]>(() => {
  const fileTabs = openTabs.value.map(t => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    isText: true,
    content: t.content || '',
    dirty: t.dirty,
    language: t.ext || 'plaintext',
    ext: t.ext,
  }));
  const dTabs = diffTabs.value.map(dt => ({
    id: dt.id,
    name: dt.name,
    icon: 'ri-contrast-2-line',
    isText: false,
    content: '',
    dirty: false,
    language: 'diff',
    isDiff: true,
    diffLines: dt.diffLines,
    diffLabel: `${dt.label1} → ${dt.label2}`,
  }));
  return [...fileTabs, ...dTabs];
});

function openDiffTab(payload: { label1: string; label2: string; diffLines: any[]; additions: number; deletions: number }) {
  const id = `diff-${Date.now()}`;
  const name = `差异: ${payload.label1} → ${payload.label2}`;
  diffTabs.value.push({
    id,
    name,
    label1: payload.label1,
    label2: payload.label2,
    diffLines: payload.diffLines,
    additions: payload.additions,
    deletions: payload.deletions,
  });
  // 取消当前文件选中，激活 diff 标签
  currentFile.value = null;
  // 折叠右侧面板
  rightPanelCollapsed.value = true;
}

function openPreviewTab(payload: { content: string; label: string; fileName: string }) {
  const id = `preview-${Date.now()}`;
  const name = `版本预览: ${payload.fileName}`;
  const editorFile: EditorFile = {
    id,
    name,
    icon: 'ri-eye-line',
    size: formatSize(new TextEncoder().encode(payload.content).length),
    modified: payload.fileName,
    dirty: false,
    source: 'local',
    content: payload.content,
    ext: 'txt',
    readOnly: true,
  };
  openFile(editorFile);
}

function closeDiffTab(tabId: string) {
  diffTabs.value = diffTabs.value.filter(dt => dt.id !== tabId);
  // 如果 diff 标签全部关闭，恢复第一个文件标签
  if (diffTabs.value.length === 0 && openTabs.value.length > 0) {
    currentFile.value = openTabs.value[0];
  }
}

const cloudFiles = ref<CloudFile[]>([]);
const cloudLoading = ref(false);

// ===== 标签页右键菜单 + 拖动排序 =====
const tabCtx = useTabContextMenu({
  getTabs: () => openTabs.value,
  getActiveId: () => currentFile.value?.id || '',
  setActive: (id) => { const t = openTabs.value.find(x => x.id === id); if (t) selectTab(t); },
  removeTabs: (ids) => removeTabsBulk(ids),
  saveActive: saveTabActive,
});
function onOpenTabMenu(id: string, e: MouseEvent) { tabCtx.open(id, e); }

function removeTabsBulk(ids: string[]) {
  const idSet = new Set(ids);
  const hadActive = currentFile.value ? idSet.has(currentFile.value.id) : false;
  const prevIdx = currentFile.value ? openTabs.value.findIndex(t => t.id === currentFile.value.id) : -1;
  openTabs.value = openTabs.value.filter(t => !idSet.has(t.id));
  if (hadActive) {
    if (openTabs.value.length === 0) {
      currentFile.value = null;
      dirty.value = false;
      activePlugin.value = null;
    } else {
      const idx = Math.min(prevIdx, openTabs.value.length - 1);
      const next = openTabs.value[Math.max(0, idx)] || openTabs.value[0];
      currentFile.value = next;
      dirty.value = next.dirty;
      updatePluginIndicator(next.ext);
    }
  }
}

async function saveTabActive(): Promise<boolean> {
  if (!currentFile.value) return false;
  if (currentFile.value.readOnly) return false;
  await saveFile();
  return true;
}

// 拖动排序（仅对文件标签生效）
let dragTabIdx = -1;
function onTabDragStart(i: number, e: DragEvent) {
  const total = openTabs.value.length;
  if (i >= total) return; // diff 标签不可拖
  dragTabIdx = i;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onTabDragOver(i: number) {
  const total = openTabs.value.length;
  if (dragTabIdx < 0 || dragTabIdx === i) return;
  if (dragTabIdx >= total || i >= total) return; // 仅文件标签之间排序
  const arr = [...openTabs.value];
  const [item] = arr.splice(dragTabIdx, 1);
  arr.splice(i, 0, item);
  openTabs.value = arr;
  dragTabIdx = i;
}
function onTabDrop() { dragTabIdx = -1; }
function onTabDragEnd() { dragTabIdx = -1; }

// ===== 云文件加号菜单 =====
const showCloudPlusMenu = ref(false);

// ===== 云文件右键菜单 =====
const cloudCtxMenu = ref<{ visible: boolean; x: number; y: number; file: CloudFile | null }>({ visible: false, x: 0, y: 0, file: null });

function onCloudFileCtxMenu(file: CloudFile, e: MouseEvent) {
  cloudCtxMenu.value = { visible: true, x: e.clientX, y: e.clientY, file };
}

// ===== 云文件 API 封装 =====
const cloudApi = {
  list: () => api.get<any[]>('/cloud-files?action=list'),
  get: (id: number) => api.get<any>(`/cloud-files?action=get&id=${id}`),
  create: (body: any) => api.post('/cloud-files?action=create', body),
  update: (body: any) => api.post('/cloud-files?action=update', body),
  delete: (id: number) => api.post('/cloud-files?action=delete', { id }),
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
      is_shared: f.is_shared || 0,
      source: f.source || 'owned',
      shared_from: f.shared_from || '',
      shared_permission: f.shared_permission || '',
    }));
  } catch {
    cloudFiles.value = [];
  } finally {
    cloudLoading.value = false;
  }
}

function refreshCloudFiles() {
  loadCloudFiles();
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ===== 新建云文件/目录 =====
const showCloudNewDialog = ref(false);
const newCloudFileName = ref('');
const showCloudNewDirDialog = ref(false);
const newCloudDirName = ref('');

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

async function createCloudDir() {
  const name = newCloudDirName.value.trim();
  if (!name) return;
  showCloudNewDirDialog.value = false;
  newCloudDirName.value = '';
  try {
    await api.post('/cloud-files?action=create-dir', { name });
    await loadCloudFiles();
  } catch (e: any) {
    console.error('创建目录失败', e);
  }
}

function triggerCloudUpload() {
  cloudUploadInput.value?.click();
}

function handleCloudUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  // Upload via cloud files API
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target?.result as string;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    try {
      await cloudApi.create({ name: file.name, content, file_type: ext });
      await loadCloudFiles();
    } catch (err: any) {
      console.error('上传失败', err);
    }
  };
  reader.readAsText(file);
  target.value = '';
}

async function deleteCloudFile(file: CloudFile) {
  if (!confirm(`确定删除云文件 "${file.name}" 吗？`)) return;
  try {
    await cloudApi.delete(Number(file.id));
    if (currentFile.value?.id === file.id) {
      closeTab(currentFile.value);
    }
    await loadCloudFiles();
  } catch (e: any) {
    console.error('删除云文件失败', e);
  }
}

function downloadCloudFile(file: CloudFile) {
  // Find the file in openTabs or load it
  const existing = openTabs.value.find(t => t.id === file.id);
  if (existing && existing.content) {
    const blob = new Blob([existing.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    // Load from cloud
    cloudApi.get(Number(file.id)).then((data: any) => {
      const blob = new Blob([data.content || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => {});
  }
}

const showRenameDialog = ref(false);
const renameFileName = ref('');
let renameTargetFile: CloudFile | null = null;

function renameCloudFile(file: CloudFile) {
  renameTargetFile = file;
  renameFileName.value = file.name;
  showRenameDialog.value = true;
}

async function confirmRename() {
  const newName = renameFileName.value.trim();
  if (!newName || !renameTargetFile) return;
  showRenameDialog.value = false;
  try {
    await api.post('/cloud-files?action=rename', { id: Number(renameTargetFile.id), name: newName });
    // Update local tab if open
    const tab = openTabs.value.find(t => t.id === renameTargetFile!.id);
    if (tab) {
      tab.name = newName;
      tab.ext = newName.split('.').pop()?.toLowerCase() || '';
    }
    await loadCloudFiles();
    renameTargetFile = null;
  } catch (e: any) {
    console.error('重命名失败', e);
  }
}

function handleShareCloudFile(file: CloudFile) {
  // Open the file first, then share
  openCloudFile(file).then(() => {
    showShareDialog.value = true;
  });
}

// ===== 插件系统（仅用于顶栏指示器） =====
const activePlugin = ref<any>(null);
const allPlugins = ref<any[]>([]);
// 平台保存按钮已请求插件同步内容，避免与插件 emitSave 回调重复请求
const pluginSaveRequested = ref(false);

// ===== 正式化编辑 Ribbon：插件“靠左”Ribbon + 系统“靠右”Ribbon =====
const editorPlugin = ref<any>(null);
const dynamicPluginRibbon = ref<any[] | undefined>(undefined);
const isSourceView = ref(false);
const immersive = ref(false);

function onEditorPluginChange(plugin: any) {
  editorPlugin.value = plugin;
  dynamicPluginRibbon.value = plugin?.ribbon ? [...plugin.ribbon] : undefined;
  isSourceView.value = false;
}
function onPluginRibbon(groups: any[]) {
  dynamicPluginRibbon.value = groups;
}
// 左侧 Ribbon：插件编辑器 → 插件自定义；非插件 → 走 RibbonToolbar 内置编辑分组
const ribbonManifest = computed(() => dynamicPluginRibbon.value);
// 右侧系统 Ribbon：插件编辑器显示 重载 + 源文件/可视化 切换
const systemRightTools = computed(() => {
  if (!editorPlugin.value) return [];
  return [
    { id: 'reload', label: '重载编辑器', icon: 'ri-refresh-line', command: 'reload' },
    { id: 'toggle-view', label: isSourceView.value ? '可视化编辑器' : '查看源文件', icon: isSourceView.value ? 'ri-eye-line' : 'ri-code-box-line', type: 'select', command: 'toggle-view' },
  ];
});

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
  if (!currentFile.value) return {
    title: '未打开文件',
    type: '轻编辑器',
    icon: 'ri-file-2-line',
    editButtonLabel: '打开文件',
  };
  return {
    title: currentFile.value.name,
    type: currentFileType.value,
    icon: currentFile.value.icon,
    lastUpdated: currentFile.value.modified,
    lastEditor: currentFile.value.source === 'local' ? '本地文件' : '云端文件',
    editButtonLabel: '打开文件',
  };
});

const lineCount = computed(() => currentFile.value?.content ? currentFile.value.content.split('\n').length : 0);
const charCount = computed(() => currentFile.value?.content ? currentFile.value.content.length : 0);

// ===== EditorPane 事件处理 =====
function onTabClick(tabId: string) {
  const tab = openTabs.value.find(t => t.id === tabId);
  if (tab) {
    selectTab(tab);
    return;
  }
  // Check diff tabs
  const diffTab = diffTabs.value.find(dt => dt.id === tabId);
  if (diffTab) {
    currentFile.value = null;
    rightPanelCollapsed.value = true;
  }
}

function onTabClose(tabId: string) {
  const tab = openTabs.value.find(t => t.id === tabId);
  if (tab) {
    closeTab(tab);
    return;
  }
  // Check diff tabs
  closeDiffTab(tabId);
}

function onContentUpdate(payload: { tabId: string; content: string }) {
  const tab = openTabs.value.find(t => t.id === payload.tabId);
  if (tab) {
    tab.content = payload.content;
    tab.dirty = true;
    dirty.value = true;
    addLocalHistory(payload.content, 'edit', `编辑: ${tab.name}`);
  }
}

function onPluginSave(content: string) {
  if (currentFile.value) {
    currentFile.value.content = content;
    currentFile.value.dirty = false;
    dirty.value = false;
    pluginSaveRequested.value = false;
    doSaveFile();
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
  { id: 'workspace', label: '工作区配置', icon: 'ri-settings-3-line', closable: true },
];
const visiblePanels = ref<PanelDef[]>([
  allAvailablePanels[0],
  allAvailablePanels[1],
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

async function loadPlugins() {
  try {
    allPlugins.value = await pluginApi.published();
  } catch {
    allPlugins.value = [];
  }
}

async function resolvePlugin(ext: string): Promise<any | null> {
  if (!ext) return null;
  try {
    const plugin = await pluginApi.resolver(ext);
    return plugin;
  } catch {
    return null;
  }
}

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
    const isFromShare = cloudFile.source === 'shared';
    const isReadOnly = isFromShare && (data.permission || cloudFile.shared_permission) === 'view';
    const editorFile: EditorFile = {
      id: cloudFile.id,
      name: cloudFile.name,
      icon: cloudFile.icon,
      size: cloudFile.size,
      modified: data.updated_at || '未知',
      dirty: false,
      source: isFromShare ? 'shared' : 'cloud',
      content: data.content || '',
      ext,
      readOnly: isReadOnly,
    };
    if (isReadOnly) {
      alert('此文件为只读分享，无法编辑。');
    }
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

async function saveFile() {
  if (!currentFile.value) return;
  if (currentFile.value.readOnly) {
    alert('此文件为只读分享，无法保存。');
    return;
  }
  // 插件编辑器（且未切换为源文件视图）：先向插件发送保存命令，由 onPluginSave 同步内容后走 doSaveFile 上传
  if (activePlugin.value && !isSourceView.value && !pluginSaveRequested.value) {
    pluginSaveRequested.value = true;
    editorPaneRef.value?.sendCommand?.('save');
    // 插件若未响应（如保存校验被取消），自动复位以便下次可再次请求
    setTimeout(() => { pluginSaveRequested.value = false; }, 3000);
    return;
  }
  await doSaveFile();
}

async function doSaveFile() {
  if (!currentFile.value) return;
  saving.value = true;

  try {
    if (currentFile.value.source === 'cloud' || currentFile.value.source === 'shared') {
      await cloudApi.update({
        id: Number(currentFile.value.id),
        content: currentFile.value.content || '',
        file_type: currentFile.value.ext,
      });
      // 直接调用 API 保存版本历史（不依赖 panel ref）
      try {
        const versionLabel = `保存 ${new Date().toLocaleString('zh-CN')}`;
        await api.post('/cloud-files?action=version-save', {
          file_id: parseInt(currentFile.value.id),
          file_name: currentFile.value.name,
          content: currentFile.value.content || '',
          version_label: versionLabel,
        });
      } catch { /* 静默失败 */ }
      // 记录操作日志
      if (operationHistoryRef.value) {
        await operationHistoryRef.value.logOperation({
          action_type: 'save',
          action_label: `保存文件: ${currentFile.value.name}`,
          content_snapshot: currentFile.value.content || '',
        });
      }
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

function saveCurrentFile() {
  saveFile();
}

function onRibbonTool(tool: any) {
  if (tool.command === 'find') openPanel('find');
  else if (tool.command === 'replace') openPanel('find');
  else if (tool.command === 'goto') editorPaneRef.value?.gotoLine();
  else if (tool.command === 'history') openPanel('history');
  else if (tool.command === 'version') openPanel('version');
  else if (tool.command === 'share') {
    handleShare();
  }
  else if (tool.command === 'import') handleImport();
  else if (tool.command === 'export') handleExport();
  else if (tool.command === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  else if (tool.command === 'immersive') immersive.value = !immersive.value;
  else if (tool.command === 'refresh') handleRibbonRefresh();
  else if (tool.command === 'reload') editorPaneRef.value?.reloadPlugin();
  else if (tool.command === 'toggle-view') isSourceView.value = !isSourceView.value;
  else if (editorPlugin.value && tool.command) {
    // 插件自定义 Ribbon 命令 → 转发给插件 iframe
    editorPaneRef.value?.sendCommand?.(tool.command);
  }
}

async function handleRibbonRefresh() {
  const f = currentFile.value;
  if (!f) return;
  if (f.dirty && !confirm('刷新将丢弃未保存的内容，是否继续？')) return;
  if (f.source === 'cloud' || f.source === 'shared') {
    try {
      const data = await cloudApi.get(Number(f.id));
      f.content = data.content || '';
      f.dirty = false;
      dirty.value = false;
      editorPaneRef.value?.setValue(f.content || '');
    } catch (e: any) {
      alert('刷新失败: ' + (e.message || '未知错误'));
    }
  } else {
    f.dirty = false;
    dirty.value = false;
  }
}

function handleUndo() {
  editorPaneRef.value?.undo();
}

function handleRedo() {
  editorPaneRef.value?.redo();
}

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
  // 如果 diff 标签激活，导出 diff 内容
  if (diffTabs.value.length > 0 && !currentFile.value) {
    const activeDiff = diffTabs.value[diffTabs.value.length - 1];
    if (!activeDiff) return;
    let text = `差异对比: ${activeDiff.label1} → ${activeDiff.label2}\n`;
    text += `${'='.repeat(60)}\n`;
    for (const line of activeDiff.diffLines) {
      const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
      text += `${sign} ${line.text}\n`;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diff-${activeDiff.label1}-${activeDiff.label2}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (!currentFile.value) return;
  const blob = new Blob([currentFile.value.content || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentFile.value.name;
  a.click();
  URL.revokeObjectURL(url);
}

function addLocalHistory(content: string, actionType = 'edit', actionLabel = '编辑内容') {
  localHistoryStep++;
  localHistory.value.push({
    id: localHistoryStep,
    action_type: actionType,
    action_label: actionLabel,
    content_snapshot: content,
    time: new Date().toLocaleTimeString()
  });
  if (localHistory.value.length > 100) {
    localHistory.value = localHistory.value.slice(-100);
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

function onShareDialogClose() {
  showShareDialog.value = false;
}

async function handleShare() {
  if (!currentFile.value) return;
  if (currentFile.value.source !== 'cloud') {
    if (!confirm('当前文件尚未保存到云文件。\n\n确认分享将自动上传到云文件，是否继续？')) return;
    try {
      const ext = currentFile.value.ext || 'txt';
      const name = currentFile.value.name;
      await cloudApi.create({ name, content: currentFile.value.content || '', file_type: ext });
      await loadCloudFiles();
      const uploaded = cloudFiles.value.find(f => f.name === name && f.source === 'owned');
      if (uploaded) {
        currentFile.value.source = 'cloud';
        currentFile.value.id = uploaded.id;
        showShareDialog.value = true;
      }
    } catch (e: any) {
      alert('上传失败: ' + (e.message || '未知错误'));
    }
    return;
  }
  showShareDialog.value = true;
}

function doFind() {
  if (!findText.value || !currentFile.value?.content) return;
  const idx = currentFile.value.content.indexOf(findText.value);
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

.cloud-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: var(--spacer-2) var(--spacer-3); }

/* 云文件标题 + 横线 + 加号 */
.cloud-divider {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  margin: var(--spacer-2) 0 var(--spacer-3);
}
.cloud-divider > span {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.cloud-divider-line {
  flex: 1;
  height: 1px;
  background: var(--divider-stroke);
}

/* 加号菜单 */
.cloud-plus-menu-wrapper {
  position: relative;
  flex-shrink: 0;
}
.cloud-plus-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-xs);
}
.cloud-plus-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.cloud-plus-menu {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 160px;
  background: var(--flyout-bg);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 100;
  padding: var(--spacer-1);
}
.plus-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 100%;
  padding: var(--spacer-2) var(--spacer-3);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  text-align: left;
}
.plus-item:hover { background: var(--subtle-secondary); }
.plus-divider { height: 1px; background: var(--divider-stroke); margin: var(--spacer-1) 0; }

.cloud-loading { text-align: center; padding: var(--spacer-4); font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cloud-login-prompt { display: flex; flex-direction: column; align-items: center; padding: var(--spacer-4); text-align: center; }
.login-icon { font-size: 36px; margin-bottom: var(--spacer-2); }
.login-text { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacer-3); }
.login-btn { padding: var(--spacer-1) var(--spacer-4); background: var(--accent-base); color: white; border: none; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; cursor: pointer; }
.login-btn:hover { background: var(--accent-hover); }

.cloud-file-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--spacer-1); }
.cloud-file-item { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2); background: transparent; border-radius: var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer; }
.cloud-file-item:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.cloud-file-item.active { background: var(--subtle-pressed); color: var(--text-primary); }
.cloud-file-icon { font-size: 16px; }
.cloud-file-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cloud-file-size { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.cloud-file-shared-badge { display: inline-flex; align-items: center; color: var(--status-success); flex-shrink: 0; }
.cloud-file-shared-from-badge { display: inline-flex; align-items: center; gap: 2px; font-size: 9px; color: var(--accent-base); background: var(--accent-bg); padding: 0 4px; border-radius: var(--radius-xs); flex-shrink: 0; }
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

.top-bar-left { display: flex; align-items: center; gap: var(--spacer-3); flex: 1; min-width: 0; }

.top-bar-right { display: flex; align-items: center; gap: var(--spacer-2); flex-shrink: 0; }





.welcome-actions { display: flex; flex-direction: column; gap: var(--spacer-2); margin-top: var(--spacer-3); }
.welcome-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--spacer-2); padding: var(--spacer-3) var(--spacer-5); border-radius: var(--radius-md); font-size: var(--font-size-base); font-weight: 500; cursor: pointer; border: none; }
.welcome-btn.primary { background: var(--accent-base); color: white; }
.welcome-btn.primary:hover { background: var(--accent-hover); }
.welcome-btn.secondary { background: var(--subtle-secondary); color: var(--text-primary); }
.welcome-btn.secondary:hover { background: var(--subtle-pressed); }










.outline-content, .outline-hint { padding: var(--spacer-3); font-size: var(--font-size-xs); color: var(--text-tertiary); }



.props-panel { padding: var(--spacer-3); }
.property-list { display: flex; flex-direction: column; gap: var(--spacer-3); }

/* ===== 标签右键菜单 ===== */
.tab-menu-overlay { position: fixed; inset: 0; z-index: 2000; }
.tab-menu {
  position: fixed; min-width: 168px;
  background: var(--flyout-bg); border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  padding: var(--spacer-1); z-index: 2001;
}
.tm-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: var(--spacer-2) var(--spacer-3); border: none; background: transparent;
  color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer;
  border-radius: var(--radius-sm); text-align: left;
}
.tm-item:hover { background: var(--subtle-secondary); }
.tm-divider { height: 1px; background: var(--divider-stroke); margin: var(--spacer-1) 0; }
.editor-tab[draggable='true'] { cursor: grab; }
.editor-tab[draggable='true']:active { cursor: grabbing; }

/* ===== 沉浸模式 ===== */
.unified-editor.immersive .file-sidebar { display: none; }
.unified-editor.immersive .editor-main .editor-top-bar { display: none; }
.unified-editor.immersive .editor-main .editor-tabs-row { display: none; }
.unified-editor.immersive .editor-main .editor-splitter { display: none; }
.unified-editor.immersive .editor-main .split-area { display: none; }
.unified-editor.immersive .editor-status-bar { display: none; }







</style>