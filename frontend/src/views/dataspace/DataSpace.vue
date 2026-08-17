<template>
  <div class="data-space">
    <!-- 左侧文件树 -->
    <aside class="file-tree-panel">
      <div class="panel-header">
        <span class="panel-title">数据空间</span>
        <div class="panel-actions">
          <button class="icon-btn" @click="refreshTree" title="刷新">
            <Icon icon="ri-refresh-line" :size="18" />
          </button>
          <div class="plus-menu-wrapper">
            <button class="icon-btn" @click="showPlusMenu = !showPlusMenu" title="更多操作">
              <Icon icon="ri-add-line" :size="18" />
            </button>
            <div v-if="showPlusMenu" class="plus-menu" @click.stop>
              <button v-if="canCreateInSelected" class="plus-item" @click="showNewFileDialog = true; showPlusMenu = false">
                <Icon icon="ri-file-add-line" :size="14" />
                <span>新建文件</span>
              </button>
              <button v-if="canCreateInSelected" class="plus-item" @click="showNewDirDialog = true; showPlusMenu = false">
                <Icon icon="ri-folder-add-line" :size="14" />
                <span>新建目录</span>
              </button>
              <button v-if="canCreateInSelected" class="plus-item" @click="triggerUpload">
                <Icon icon="ri-upload-2-line" :size="14" />
                <span>上传文件</span>
              </button>
              <div v-if="canCreateInSelected" class="plus-divider"></div>
              <button class="plus-item" @click="showCreateWebSpaceDialog = true; showPlusMenu = false">
                <Icon icon="ri-globe-line" :size="14" />
                <span>创建网页空间</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="file-tree" @click.self="ctxMenuNode = null">
        <template v-for="node in visibleTree" :key="node.path">
          <div
            class="tree-node"
            :class="{
              'is-active': activeTab?.path === node.path,
              'is-selected-dir': node.is_directory && selectedDir === node.path,
              'is-dir': node.is_directory,
              'is-protected': node.protected
            }"
            :style="{ paddingLeft: (node.depth * 16 + 8) + 'px' }"
            @click="node.is_directory ? toggleDir(node.path) : openFile(node)"
            @contextmenu.prevent="onCtxMenu(node, $event)"
          >
            <Icon
              v-if="node.is_directory"
              :icon="expandedDirs.has(node.path) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"
              :size="12"
              class="node-chevron"
            />
            <Icon :icon="node.is_directory ? (expandedDirs.has(node.path) ? 'ri-folder-open-line' : 'ri-folder-3-line') : fileIcon(node)" :size="16" class="node-icon" />
            <span class="node-name">{{ node.name }}</span>
            <span v-if="node.badge" class="node-badge">{{ node.badge }}</span>
            <span v-if="node.size && !node.is_directory" class="node-size">{{ formatBytes(node.size) }}</span>
          </div>
        </template>
        <div v-if="treeData.length === 0 && !loading" class="ft-empty">
          <Icon icon="ri-inbox-line" :size="20" />
          <span>暂无数据</span>
        </div>
        <div v-if="loading" class="ft-loading">
          <div class="loading-ring"></div>
          <span>加载中...</span>
        </div>
      </div>

      <!-- 云空间使用概览 -->
      <div class="usage-footer">
        <div class="usage-header">
          <Icon icon="ri-hard-drive-2-line" :size="14" />
          <span>云空间</span>
        </div>
        <div class="usage-bar"><div class="usage-fill" :style="{ width: usage.percent + '%' }"></div></div>
        <div class="usage-text">{{ usage.usedDisplay }} / {{ usage.quotaDisplay }}</div>
        <div class="usage-detail">
          <div class="usage-item">
            <span class="usage-dot" style="background:#107C10"></span>实例文件 {{ usage.breakdown?.instance_files?.display || '0 B' }}
          </div>
          <div class="usage-item">
            <span class="usage-dot" style="background:#0067C0"></span>云文件 {{ usage.breakdown?.web_hosting?.display || '0 B' }}
          </div>
          <div class="usage-item">
            <span class="usage-dot" style="background:#CA8F04"></span>版本记录 {{ usage.breakdown?.versions?.display || '0 B' }}
          </div>
        </div>
      </div>
    </aside>

    <!-- 分隔条 -->
    <div class="editor-splitter" @mousedown="startDragFiles"></div>

    <!-- 右列 -->
    <div class="editor-right-col" :style="{ flex: `0 0 ${rightWidth}%` }">
      <div class="editor-right-body">
        <!-- 标签页（在 Ribbon 上方） -->
        <div class="editor-tabs-row" v-if="editorTabs.length > 0">
          <div class="editor-tabs">
            <div
              v-for="tab in editorTabs"
              :key="tab.id"
              class="editor-tab"
              :class="{ active: tab.id === (activeTab?.path || ''), dirty: tab.dirty }"
              @click="switchTab(tab.id)"
            >
              <Icon :icon="tab.icon" :size="14" class="tab-icon" />
              <span class="tab-title" :title="tab.name">{{ tab.name }}</span>
              <span v-if="tab.dirty" class="dirty-dot"></span>
              <button class="tab-close" @click.stop="closeTab(tab.id)" title="关闭">
                <Icon icon="ri-close-line" :size="12" />
              </button>
            </div>
          </div>
        </div>

        <!-- Ribbon 工具栏 -->
        <RibbonToolbar
          :editor-info="editorInfo"
          :saving="saving"
          :is-instance="false"
          :can-undo="!!activeTab"
          :can-redo="!!activeTab"
          :can-save="!!activeTab && !isReadOnly"
          :can-auto-save="!!activeTab && !isReadOnly"
          :right-actions="[
            { id: 'share', label: '分享', icon: 'ri-share-forward-line', command: 'share', enabled: !!activeTab },
            { id: 'history', label: '操作记录', icon: 'ri-history-line', command: 'history', enabled: !!activeTab },
            { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', command: 'version', enabled: !!activeTab && activeTab?.source === 'webspace_file' },
            { id: 'import', label: '导入', icon: 'ri-download-line', command: 'import', enabled: !!activeTab },
            { id: 'export', label: '导出', icon: 'ri-upload-2-line', command: 'export', enabled: !!activeTab },
          ]"
          @save="saveCurrentTab"
          @undo="handleUndo"
          @redo="handleRedo"
          @tool-click="onRibbonTool"
          @autosize-change="onAutoSaveChange"
          @edit-click="triggerUpload"
        />

        <!-- 编辑区 + 右侧面板（水平布局） -->
        <div class="editor-body-row">
          <div class="editor-area" @contextmenu.prevent="onEditorContextMenu">
            <EditorPane
              ref="editorPaneRef"
              :tabs="editorTabs"
              :active-tab-id="activeTab?.path || ''"
              :read-only="isReadOnly"
              :hide-tabs="true"
              @tab-click="switchTab"
              @tab-close="closeTab"
              @update:content="onContentUpdate"
              @plugin-save="onPluginSave"
              @monaco-save="saveCurrentTab"
              @monaco-find="openPanel('find')"
              @monaco-replace="openPanel('find')"
            >
              <template #empty-actions>
                <div class="empty-actions">
                  <p class="empty-hint">从左侧文件树中选择文件打开</p>
                </div>
              </template>
            </EditorPane>
          </div>

          <!-- 分隔条 -->
          <div v-if="!rightPanelCollapsed" class="editor-splitter vertical-splitter" @mousedown="startDragRight"></div>

          <!-- 右侧面板 -->
          <div class="right-panel" :class="{ collapsed: rightPanelCollapsed }" :style="rightPanelCollapsed ? {} : { width: rightPanelWidth + '%' }">
            <button class="panel-collapse-btn" @click="rightPanelCollapsed = !rightPanelCollapsed" :title="rightPanelCollapsed ? '展开面板' : '收起面板'">
              <Icon :icon="rightPanelCollapsed ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'" :size="14" />
            </button>
            <template v-if="!rightPanelCollapsed">
              <div class="right-tabs">
                <div class="right-tabs-scroll">
                  <button
                    v-for="(panel, idx) in visiblePanels"
                    :key="panel.id"
                    class="right-tab"
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
                <button class="right-tab add-tab" title="添加面板" @click="showPanelPicker = !showPanelPicker">
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
              <div class="right-panel-content">
                <AiAssistantPanel
                  v-if="activePanel === 'ai'"
                  scope="global"
                  :editor-context="aiEditorContext"
                  @apply-edit="onAiApplyEdit"
                />
                <div v-else-if="activePanel === 'props'" class="props-panel">
                  <div v-if="!activeTab" class="panel-empty"><Icon icon="ri-settings-3-line" :size="36" /><span>选择文件查看属性</span></div>
                  <div v-else class="property-list">
                    <div class="property-item"><label>路径</label><span class="mono">{{ activeTab.path }}</span></div>
                    <div class="property-item"><label>大小</label><span>{{ formatBytes(activeTab.data?.size || 0) }}</span></div>
                    <div class="property-item"><label>类型</label><span>{{ activeTab.data?.file_type || '未知' }}</span></div>
                    <div class="property-item"><label>来源</label><span>{{ sourceLabel(activeTab.source) }}</span></div>
                    <div class="property-item" v-if="activeTab.isText"><label>行数</label><span>{{ (activeTab.content || '').split('\n').length }}</span></div>
                    <div class="property-item" v-if="activeTab.isText"><label>字符数</label><span>{{ (activeTab.content || '').length }}</span></div>
                  </div>
                </div>
                <div v-else-if="activePanel === 'find'" class="find-panel">
                  <div class="find-section">
                    <div class="find-row"><Icon icon="ri-search-line" :size="14" /><input v-model="findText" @keyup.enter="doFind" placeholder="查找..." /><button class="find-btn" @click="doFind">查找</button></div>
                    <div class="find-row"><Icon icon="ri-replace-line" :size="14" /><input v-model="replaceText" placeholder="替换为..." /><button class="find-btn" @click="doReplace">替换</button><button class="find-btn" @click="doReplaceAll">全部</button></div>
                  </div>
                </div>
                <div v-else-if="activePanel === 'actions'" class="actions-panel">
                  <div v-if="!activeTab" class="panel-empty"><Icon icon="ri-settings-3-line" :size="36" /><span>选择文件查看操作</span></div>
                  <div v-else class="action-list">
                    <button class="action-item" @click="saveCurrentTab" :disabled="saving || isReadOnly"><Icon icon="ri-save-line" :size="16" /><div><div class="action-title">保存</div><div class="action-desc">保存到云端</div></div></button>
                    <button class="action-item" @click="downloadFile()" v-if="activeTab.source !== 'instance_config' && activeTab.source !== 'webspace_config'"><Icon icon="ri-download-2-line" :size="16" /><div><div class="action-title">下载</div><div class="action-desc">下载到本地</div></div></button>
                    <button class="action-item danger" @click="confirmDeleteActive" v-if="!activeTab.protected"><Icon icon="ri-delete-bin-line" :size="16" /><div><div class="action-title">删除</div><div class="action-desc">删除此文件</div></div></button>
                  </div>
                </div>
                <OperationHistoryPanel
                  v-else-if="activePanel === 'history'"
                  :file-id="activeTab?.source === 'webspace_file' || activeTab?.source === 'cloud_file' ? String(activeTab?.data?.file_id || '') : ''"
                  :file-name="activeTab?.name || ''"
                  :local-history="[]"
                  :is-logged-in="isAlliance"
                  workspace-key="dataspace"
                  @open-workspace-config="openPanel('workspace')"
                />
                <VersionHistoryPanel
                  v-else-if="activePanel === 'version'"
                  :file-id="activeTab?.source === 'webspace_file' || activeTab?.source === 'cloud_file' ? String(activeTab?.data?.file_id || '') : ''"
                  :file-name="activeTab?.name || ''"
                  :is-owner="true"
                  workspace-key="dataspace"
                  @open-workspace-config="openPanel('workspace')"
                />
                <WorkspaceConfig
                  v-else-if="activePanel === 'workspace'"
                  workspace-key="dataspace"
                />
                <div v-else-if="activePanel === 'webspace-config'" class="webspace-config-panel">
                  <div v-if="!webspaceConfig" class="panel-empty"><Icon icon="ri-globe-line" :size="36" /><span>选择网页空间配置</span></div>
                  <div v-else class="settings-card">
                    <div class="settings-grid">
                      <div class="setting-item"><label>空间名称</label><input type="text" v-model="webspaceConfig.title" class="setting-input" /></div>
                      <div class="setting-item"><label>空间描述</label><input type="text" v-model="webspaceConfig.description" class="setting-input" /></div>
                      <div class="setting-item">
                        <label>访问路径</label>
                        <div class="slug-input-group"><span class="slug-prefix">/site/</span><input type="text" v-model="webspaceConfig.slug" class="setting-input slug-input" /></div>
                      </div>
                      <div class="setting-item">
                        <label>启用状态</label>
                        <label class="toggle-label"><input type="checkbox" v-model="webspaceConfig.is_enabled" class="toggle-input" /><span class="toggle-switch"></span><span class="toggle-text">{{ webspaceConfig.is_enabled ? '已启用' : '已禁用' }}</span></label>
                      </div>
                    </div>
                    <div class="settings-footer">
                      <button class="primary-btn" @click="saveWebspaceConfig" :disabled="savingConfig">{{ savingConfig ? '保存中...' : '保存设置' }}</button>
                      <button class="danger-btn" @click="confirmDeleteWebspace" style="margin-left:8px">删除空间</button>
                      <a v-if="webspaceConfig?.slug" :href="'/site/' + webspaceConfig.slug" target="_blank" class="preview-link" style="margin-left:auto">
                        <Icon icon="ri-external-link-line" :size="14" /> 预览网页
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenuNode" class="ctx-overlay" @click.self="ctxMenuNode = null" @contextmenu.prevent="ctxMenuNode = null">
        <div class="ctx-menu" :style="{ left: ctxMenuPos.x + 'px', top: ctxMenuPos.y + 'px' }">
          <template v-if="ctxMenuNode.is_directory">
            <button class="ctx-item" @click="toggleDir(ctxMenuNode.path); ctxMenuNode = null">
              <Icon :icon="expandedDirs.has(ctxMenuNode.path) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" :size="14" />
              {{ expandedDirs.has(ctxMenuNode.path) ? '折叠' : '展开' }}
            </button>
            <button v-if="ctxMenuNode.source === 'webspace' || ctxMenuNode.source === 'webspace_file'" class="ctx-item" @click="showNewFileDialog = true; ctxMenuNode = null">
              <Icon icon="ri-file-add-line" :size="14" />新建文件
            </button>
            <button v-if="ctxMenuNode.source === 'webspace' || ctxMenuNode.source === 'webspace_file'" class="ctx-item" @click="showNewDirDialog = true; ctxMenuNode = null">
              <Icon icon="ri-folder-add-line" :size="14" />新建目录
            </button>
            <div class="ctx-divider"></div>
            <button v-if="!ctxMenuNode.protected" class="ctx-item danger" @click="confirmDelete(ctxMenuNode); ctxMenuNode = null">
              <Icon icon="ri-delete-bin-line" :size="14" />删除
            </button>
          </template>
          <template v-else>
            <button class="ctx-item" @click="openFile(ctxMenuNode); ctxMenuNode = null">
              <Icon icon="ri-file-edit-line" :size="14" />打开
            </button>
            <button class="ctx-item" @click="downloadFile(ctxMenuNode); ctxMenuNode = null" v-if="ctxMenuNode.source !== 'instance_config' && ctxMenuNode.source !== 'webspace_config'">
              <Icon icon="ri-download-2-line" :size="14" />下载
            </button>
            <div class="ctx-divider"></div>
            <button v-if="!ctxMenuNode.protected" class="ctx-item danger" @click="confirmDelete(ctxMenuNode); ctxMenuNode = null">
              <Icon icon="ri-delete-bin-line" :size="14" />删除
            </button>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 隐藏上传 input -->
    <input ref="uploadInput" type="file" style="display:none" @change="onUploadFile" />

    <!-- 对话框 -->
    <div v-if="showNewFileDialog" class="dialog-overlay" @click.self="showNewFileDialog = false">
      <div class="dialog-card">
        <h3>新建文件</h3>
        <div class="dialog-field"><label>文件名</label><input type="text" v-model="newFileName" class="dialog-input" placeholder="例如：index.html" @keyup.enter="createNewFile" /></div>
        <div class="dialog-actions"><button class="secondary-btn" @click="showNewFileDialog = false">取消</button><button class="primary-btn" @click="createNewFile">创建</button></div>
      </div>
    </div>
    <div v-if="showNewDirDialog" class="dialog-overlay" @click.self="showNewDirDialog = false">
      <div class="dialog-card">
        <h3>新建目录</h3>
        <div class="dialog-field"><label>目录名</label><input type="text" v-model="newDirName" class="dialog-input" placeholder="例如：styles" @keyup.enter="createNewDir" /></div>
        <div class="dialog-actions"><button class="secondary-btn" @click="showNewDirDialog = false">取消</button><button class="primary-btn" @click="createNewDir">创建</button></div>
      </div>
    </div>
    <div v-if="showCreateWebSpaceDialog" class="dialog-overlay" @click.self="showCreateWebSpaceDialog = false">
      <div class="dialog-card">
        <h3>创建网页空间</h3>
        <div class="dialog-field"><label>空间名称</label><input type="text" v-model="webSpaceForm.title" class="dialog-input" placeholder="例如：我的班级主页" @keyup.enter="createWebSpace" /></div>
        <div class="dialog-field"><label>路径别名</label><div class="slug-input-group"><span class="slug-prefix">/site/</span><input type="text" v-model="webSpaceForm.slug" class="dialog-input slug-input" placeholder="例如：my-site" /></div></div>
        <div class="dialog-actions"><button class="secondary-btn" @click="showCreateWebSpaceDialog = false">取消</button><button class="primary-btn" @click="createWebSpace">创建</button></div>
      </div>
    </div>
    <div v-if="deleteTarget" class="dialog-overlay" @click.self="deleteTarget = null">
      <div class="dialog-card">
        <h3>确认删除</h3>
        <p class="delete-message">确定要删除<strong>{{ deleteTarget.is_directory ? '目录' : '文件' }}</strong><code>{{ deleteTarget.path }}</code>吗？<span v-if="deleteTarget.is_directory && deleteTarget.children?.length" class="delete-warning">此操作将同时删除目录下的所有内容。</span></p>
        <div class="dialog-actions"><button class="secondary-btn" @click="deleteTarget = null">取消</button><button class="danger-btn" @click="executeDelete">确认删除</button></div>
      </div>
    </div>
    <div v-if="deleteWebspaceTarget" class="dialog-overlay" @click.self="deleteWebspaceTarget = null">
      <div class="dialog-card">
        <h3>确认删除网页空间</h3>
        <p class="delete-message">确定要删除网页空间<strong>{{ webspaceConfig?.title }}</strong>吗？此操作不可撤销，所有文件将被永久删除。</p>
        <div class="dialog-actions"><button class="secondary-btn" @click="deleteWebspaceTarget = null">取消</button><button class="danger-btn" @click="executeDeleteWebspace">确认删除</button></div>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="'toast-' + toast.type">
      <Icon :icon="toast.type === 'success' ? 'ri-check-line' : 'ri-error-warning-line'" :size="16" />
      <span>{{ toast.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../../composables/useAuth';
import { dataSpaceApi } from '../../api';
import EditorPane from '../../components/editor/EditorPane.vue';
import type { TabInfo } from '../../components/editor/EditorPane.vue';
import RibbonToolbar from '../../components/editor/RibbonToolbar.vue';
import AiAssistantPanel from '../../components/editor/panels/AiAssistantPanel.vue';
import OperationHistoryPanel from '../../components/editor/panels/OperationHistoryPanel.vue';
import VersionHistoryPanel from '../../components/editor/panels/VersionHistoryPanel.vue';
import WorkspaceConfig from '../../components/editor/panels/WorkspaceConfig.vue';

const router = useRouter();
const { user } = useAuth();
const isAlliance = computed(() => user.value?.type === 'alliance');

// ===== 数据 =====
const loading = ref(false);
const treeData = ref<any[]>([]);
const expandedDirs = ref<Set<string>>(new Set(['/实例文件', '/云文件', '/网页空间', '/版本历史', '/操作记录']));
const selectedDir = ref<string>('');
const selectedDirNode = computed(() => {
  if (!selectedDir.value) return null;
  function find(nodes: any[]): any {
    for (const n of nodes) {
      if (n.path === selectedDir.value) return n;
      if (n.children) { const r = find(n.children); if (r) return r; }
    }
    return null;
  }
  return find(treeData.value);
});
const canCreateInSelected = computed(() => {
  const n = selectedDirNode.value;
  if (!n) return false;
  return n.source === 'webspace' || n.source === 'webspace_file' || n.source === 'cloud_file';
});
const usage = ref<any>({ usedDisplay: '0 B', quotaDisplay: '500 MB', percent: 0 });

// ===== 文件树 =====
const visibleTree = computed(() => {
  const result: any[] = [];
  function walk(nodes: any[], depth: number) {
    for (const node of nodes) {
      const n = { ...node, depth };
      result.push(n);
      if (node.is_directory && node.children?.length && expandedDirs.value.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(treeData.value, 0);
  return result;
});

function toggleDir(path: string) {
  const s = new Set(expandedDirs.value);
  if (s.has(path)) s.delete(path);
  else s.add(path);
  expandedDirs.value = s;
  selectedDir.value = path;
}

function findParentDir(filePath: string) {
  function walk(nodes: any[]): boolean {
    for (const n of nodes) {
      if (n.is_directory && n.children) {
        for (const child of n.children) {
          if (child.path === filePath) {
            // 展开父目录并选中
            const s = new Set(expandedDirs.value);
            s.add(n.path);
            expandedDirs.value = s;
            selectedDir.value = n.path;
            return true;
          }
        }
        if (walk(n.children)) return true;
      }
    }
    return false;
  }
  walk(treeData.value);
}

// ===== 多标签页 =====
interface Tab {
  path: string;
  name: string;
  source: string;
  isText: boolean;
  content: string;
  dirty: boolean;
  data: any;
  node: any;
  protected?: boolean;
}
const openTabs = ref<Tab[]>([]);
const activeTabPath = ref('');
const activeTab = computed(() => openTabs.value.find(t => t.path === activeTabPath.value) || null);
const isReadOnly = computed(() => {
  if (!activeTab.value) return false;
  return ['version_record', 'history_record'].includes(activeTab.value.source);
});
const saving = ref(false);
const autoSave = ref(true);
const editorPaneRef = ref<InstanceType<typeof EditorPane> | null>(null);

// Ribbon 编辑器信息
const editorInfo = computed(() => {
  if (!activeTab.value) return undefined;
  const tab = activeTab.value;
  return {
    title: tab.name,
    type: sourceLabel(tab.source),
    icon: fileIcon(tab.node || tab.data),
    lastUpdated: tab.data?.updated_at || '',
    lastEditor: tab.data?.editor || '云端',
    editButtonLabel: '打开文件',
  };
});

// AI 上下文
const aiEditorContext = computed(() => {
  if (!activeTab.value || !activeTab.value.isText) return undefined;
  return {
    fileName: activeTab.value.name,
    fileContent: activeTab.value.content || '',
    language: activeTab.value.data?.file_type || '',
  };
});

// ===== 右侧面板 =====
interface PanelDef { id: string; label: string; icon: string; closable: boolean; }
const allPanels: PanelDef[] = [
  { id: 'ai', label: 'AI助理', icon: 'ri-brain-line', closable: false },
  { id: 'props', label: '属性', icon: 'ri-settings-3-line', closable: false },
  { id: 'find', label: '查找替换', icon: 'ri-search-line', closable: true },
  { id: 'history', label: '操作记录', icon: 'ri-history-line', closable: true },
  { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', closable: true },
  { id: 'actions', label: '操作', icon: 'ri-tools-line', closable: true },
  { id: 'workspace', label: '工作区配置', icon: 'ri-settings-3-line', closable: true },
];
const visiblePanels = ref<PanelDef[]>([allPanels[0], allPanels[1]]);
const activePanel = ref('ai');
const showPanelPicker = ref(false);
const availablePanels = computed(() => allPanels.filter(p => !visiblePanels.value.some(vp => vp.id === p.id)));

function openPanel(id: string) {
  const panel = allPanels.find(p => p.id === id);
  if (!panel) return;
  if (!visiblePanels.value.some(vp => vp.id === id)) visiblePanels.value.push(panel);
  activePanel.value = id;
  if (rightPanelCollapsed.value) rightPanelCollapsed.value = false;
}
function closePanel(id: string) {
  const panel = visiblePanels.value.find(p => p.id === id);
  if (!panel?.closable) return;
  visiblePanels.value = visiblePanels.value.filter(p => p.id !== id);
  if (activePanel.value === id) activePanel.value = visiblePanels.value[0]?.id || 'ai';
}
function addPanel(panel: PanelDef) {
  if (visiblePanels.value.some(vp => vp.id === panel.id)) return;
  visiblePanels.value.push(panel);
  activePanel.value = panel.id;
}
let dragSrcIdx = -1;
function onPanelDragStart(idx: number, e: DragEvent) { dragSrcIdx = idx; e.dataTransfer!.effectAllowed = 'move'; }
function onPanelDragOver(idx: number) {
  if (dragSrcIdx < 0 || dragSrcIdx === idx) return;
  const panels = [...visiblePanels.value];
  const [item] = panels.splice(dragSrcIdx, 1);
  panels.splice(idx, 0, item);
  visiblePanels.value = panels;
  dragSrcIdx = idx;
}
function onPanelDrop(_idx: number) { dragSrcIdx = -1; }
function onPanelDragEnd() { dragSrcIdx = -1; }

const rightWidth = ref(75);
const rightPanelWidth = ref(25);
const rightPanelCollapsed = ref(false);

// 网页空间配置面板
const webspaceConfig = ref<any>(null);
const savingConfig = ref(false);
const deleteWebspaceTarget = ref(false);

// ===== 编辑器标签映射 =====
const editorTabs = computed<TabInfo[]>(() => openTabs.value.map(t => ({
  id: t.path,
  name: t.name,
  icon: fileIcon(t.node || t.data),
  isText: t.isText,
  content: t.content || '',
  dirty: t.dirty,
  language: t.data?.file_type || 'plaintext',
  ext: t.data?.file_type || '',
})));

function onContentUpdate(payload: { tabId: string; content: string }) {
  const tab = openTabs.value.find(t => t.path === payload.tabId);
  if (tab) { tab.content = payload.content; tab.dirty = true; }
}
function onPluginSave(content: string) {
  if (activeTab.value) { activeTab.value.content = content; activeTab.value.dirty = false; }
}
function onAiApplyEdit(payload: { content: string; replaceAll?: boolean }) {
  if (!activeTab.value || !activeTab.value.isText) return;
  activeTab.value.content = payload.content;
  activeTab.value.dirty = true;
  editorPaneRef.value?.setValue(payload.content);
}

// Ribbon 操作
function handleUndo() {
  editorPaneRef.value?.undo();
}
function handleRedo() {
  editorPaneRef.value?.redo();
}
function onRibbonTool(tool: any) {
  if (tool.command === 'find') openPanel('find');
  else if (tool.command === 'replace') openPanel('find');
  else if (tool.command === 'history') openPanel('history');
  else if (tool.command === 'version') openPanel('version');
  else if (tool.command === 'share') { /* share */ }
  else if (tool.command === 'import') { /* import */ }
  else if (tool.command === 'export') downloadFile();
  else if (tool.command === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
}
function onAutoSaveChange(v: boolean) {
  autoSave.value = v;
}

// ===== 工具函数 =====
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function fileIcon(node: any): string {
  const ft = node.file_type || (node.data && node.data.file_type) || '';
  const map: Record<string, string> = {
    html: 'ri-html5-line', css: 'ri-css3-line', js: 'ri-javascript-line', json: 'ri-braces-line',
    md: 'ri-markdown-line', txt: 'ri-file-text-line', png: 'ri-image-line', jpg: 'ri-image-line',
    jpeg: 'ri-image-line', gif: 'ri-image-line', svg: 'ri-image-line', pdf: 'ri-file-pdf-line',
    zip: 'ri-file-zip-line', config: 'ri-settings-3-line', version: 'ri-git-branch-line',
    history: 'ri-history-line', ea2: 'ri-file-list-3-line',
  };
  return map[ft] || 'ri-file-line';
}
function isTextFile(node: any): boolean {
  const ft = node.file_type || (node.data && node.data.file_type) || '';
  const textTypes = ['html', 'css', 'js', 'json', 'txt', 'md', 'xml', 'yaml', 'yml', 'csv', 'ts', 'py', 'php', 'sql', 'config', 'version', 'history', 'ea2', 'cses'];
  return textTypes.includes(ft) || !ft;
}
function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    instance_config: '实例配置', instance_file: '实例文件', instance: '实例',
    cloud_file: '云文件', webspace_config: '网页空间配置', webspace_file: '网页空间文件',
    webspace: '网页空间', version_record: '版本历史', history_record: '操作记录',
    system: '系统目录',
  };
  return map[source] || source;
}

// ===== 数据加载 =====
async function refreshTree() {
  loading.value = true;
  try {
    const data = await dataSpaceApi.tree();
    treeData.value = data.nodes || [];
    // 自动展开系统目录
    const s = new Set(expandedDirs.value);
    for (const node of treeData.value) {
      if (node.is_directory) s.add(node.path);
    }
    expandedDirs.value = s;
  } catch (e: any) {
    showToast('error', e.message || '加载失败');
    treeData.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadUsage() {
  try {
    usage.value = await dataSpaceApi.usage();
  } catch { /* ignore */ }
}

// ===== 文件操作 =====
async function openFile(node: any) {
  if (node.is_directory) {
    toggleDir(node.path);
    return;
  }
  // 选中文件所在目录
  findParentDir(node.path);
  // 检查是否已打开
  const existing = openTabs.value.find(t => t.path === node.path);
  if (existing) {
    activeTabPath.value = existing.path;
    // 网页空间配置
    if (node.source === 'webspace_config') {
      activePanel.value = 'webspace-config';
      webspaceConfig.value = node.space_data ? { ...node.space_data, space_id: node.space_id } : null;
    }
    return;
  }
  try {
    const params: any = { path: node.path, source: node.source };
    if (node.file_id) params.file_id = node.file_id;
    if (node.instance_id) params.instance_id = node.instance_id;
    if (node.space_id) params.space_id = node.space_id;
    if (node.version_id) params.version_id = node.version_id;
    if (node.history_id) params.history_id = node.history_id;
    const data = await dataSpaceApi.get(params);
    const isText = isTextFile(node);
    const tab: Tab = {
      path: node.path,
      name: node.name,
      source: node.source,
      isText,
      content: isText ? (data.content || '') : '',
      dirty: false,
      data,
      node,
      protected: node.protected || false,
    };
    openTabs.value.push(tab);
    activeTabPath.value = tab.path;
    // 网页空间配置
    if (node.source === 'webspace_config') {
      activePanel.value = 'webspace-config';
      webspaceConfig.value = data.space_data ? { ...data.space_data, space_id: data.space_id } : null;
    }
  } catch (e: any) {
    showToast('error', '无法加载: ' + (e.message || '未知错误'));
  }
}

function switchTab(path: string) {
  activeTabPath.value = path;
  const tab = openTabs.value.find(t => t.path === path);
  if (tab?.source === 'webspace_config') {
    activePanel.value = 'webspace-config';
    webspaceConfig.value = tab.node?.space_data ? { ...tab.node.space_data, space_id: tab.node.space_id } : null;
  }
}

function closeTab(path: string) {
  const idx = openTabs.value.findIndex(t => t.path === path);
  if (idx === -1) return;
  const tab = openTabs.value[idx];
  if (tab.dirty) {
    if (!confirm(`文件 "${tab.name}" 有未保存的更改，确定关闭吗？`)) return;
  }
  openTabs.value.splice(idx, 1);
  if (activeTabPath.value === path) {
    activeTabPath.value = openTabs.value.length > 0 ? openTabs.value[Math.min(idx, openTabs.value.length - 1)].path : '';
  }
}

async function saveCurrentTab() {
  const tab = activeTab.value;
  if (!tab || !tab.isText || saving.value || isReadOnly.value) return;
  saving.value = true;
  try {
    await dataSpaceApi.save({
      path: tab.path,
      source: tab.source,
      file_id: tab.data?.file_id,
      content: tab.content,
    });
    tab.dirty = false;
    showToast('success', '已保存');
    await refreshTree();
    await loadUsage();
  } catch (e: any) {
    showToast('error', e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

// ===== 网页空间操作 =====
const showCreateWebSpaceDialog = ref(false);
const webSpaceForm = ref({ title: '', slug: '' });

async function createWebSpace() {
  const title = webSpaceForm.value.title.trim();
  if (!title) { showToast('error', '请输入空间名称'); return; }
  showCreateWebSpaceDialog.value = false;
  try {
    await dataSpaceApi.createWebSpace({ title, slug: webSpaceForm.value.slug.trim() || undefined });
    webSpaceForm.value = { title: '', slug: '' };
    showToast('success', '网页空间已创建');
    await refreshTree();
    await loadUsage();
  } catch (e: any) {
    showToast('error', e.message || '创建失败');
  }
}

async function saveWebspaceConfig() {
  if (!webspaceConfig.value || savingConfig.value) return;
  savingConfig.value = true;
  try {
    await dataSpaceApi.updateWebSpace({
      space_id: webspaceConfig.value.space_id,
      title: webspaceConfig.value.title,
      description: webspaceConfig.value.description,
      slug: webspaceConfig.value.slug,
      is_enabled: webspaceConfig.value.is_enabled,
    });
    showToast('success', '设置已保存');
    await refreshTree();
  } catch (e: any) {
    showToast('error', e.message || '保存失败');
  } finally {
    savingConfig.value = false;
  }
}

function confirmDeleteWebspace() {
  deleteWebspaceTarget.value = true;
}

async function executeDeleteWebspace() {
  if (!webspaceConfig.value) return;
  deleteWebspaceTarget.value = false;
  try {
    await dataSpaceApi.delete({ path: webspaceConfig.value.title, source: 'webspace', space_id: webspaceConfig.value.space_id });
    showToast('success', '网页空间已删除');
    webspaceConfig.value = null;
    activePanel.value = 'ai';
    closeTab(activeTabPath.value);
    await refreshTree();
    await loadUsage();
  } catch (e: any) {
    showToast('error', e.message || '删除失败');
  }
}

// ===== 新建文件/目录 =====
const showNewFileDialog = ref(false);
const showNewDirDialog = ref(false);
const newFileName = ref('');
const newDirName = ref('');
const uploadInput = ref<HTMLInputElement>();

// 确定当前操作的网页空间
const currentWebSpace = computed(() => {
  const node = selectedDirNode.value;
  if (node && (node.source === 'webspace' || node.source === 'webspace_file' || node.source === 'cloud_file')) {
    return extractSpaceId(node);
  }
  const tab = activeTab.value;
  if (tab && (tab.source === 'webspace_file' || tab.source === 'webspace_config')) {
    return extractSpaceId(tab.node);
  }
  return null;
});

function extractSpaceId(node: any): number | null {
  if (!node) return null;
  if (node.space_id) return node.space_id;
  // 从路径中提取网页空间名称，然后查找 space_id
  return null;
}

async function createNewFile() {
  const name = newFileName.value.trim();
  if (!name) { showToast('error', '请输入文件名'); return; }
  if (!name.includes('.')) { showToast('error', '文件名需要包含扩展名'); return; }
  showNewFileDialog.value = false;
  newFileName.value = '';
  // 需要确定在哪个网页空间中创建
  const spaceId = currentWebSpace.value;
  if (!spaceId) {
    showToast('error', '请在网页空间内创建文件');
    return;
  }
  try {
    await dataSpaceApi.webspaceCreateFile({ space_id: spaceId, path: '/' + name, content: '' });
    showToast('success', '文件已创建');
    await refreshTree();
  } catch (e: any) {
    showToast('error', e.message || '创建失败');
  }
}

async function createNewDir() {
  const name = newDirName.value.trim();
  if (!name) { showToast('error', '请输入目录名'); return; }
  showNewDirDialog.value = false;
  newDirName.value = '';
  const spaceId = currentWebSpace.value;
  if (!spaceId) {
    showToast('error', '请在网页空间内创建目录');
    return;
  }
  try {
    await dataSpaceApi.webspaceCreateDir({ space_id: spaceId, path: '/' + name });
    showToast('success', '目录已创建');
    await refreshTree();
  } catch (e: any) {
    showToast('error', e.message || '创建失败');
  }
}

function triggerUpload() {
  uploadInput.value?.click();
}

async function onUploadFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const spaceId = currentWebSpace.value;
  if (!spaceId) {
    showToast('error', '请在网页空间内上传文件');
    input.value = '';
    return;
  }
  try {
    await dataSpaceApi.webspaceUpload(file, spaceId, '/');
    showToast('success', '文件已上传');
    await refreshTree();
    await loadUsage();
  } catch (err: any) {
    showToast('error', err.message || '上传失败');
  }
  input.value = '';
}

// ===== 删除 =====
const deleteTarget = ref<any>(null);
function confirmDelete(node: any) { deleteTarget.value = node; }
function confirmDeleteActive() {
  if (!activeTab.value) return;
  const node = activeTab.value.node;
  if (node) confirmDelete(node);
}
async function executeDelete() {
  if (!deleteTarget.value) return;
  const node = deleteTarget.value;
  deleteTarget.value = null;
  try {
    const params: any = { path: node.path, source: node.source };
    if (node.file_id) params.file_id = node.file_id;
    if (node.space_id) params.space_id = node.space_id;
    if (node.instance_id) params.instance_id = node.instance_id;
    await dataSpaceApi.delete(params);
    showToast('success', '已删除');
    closeTab(node.path);
    await refreshTree();
    await loadUsage();
  } catch (e: any) {
    showToast('error', e.message || '删除失败');
  }
}

// ===== 下载 =====
function downloadFile(node?: any) {
  const tab = node ? null : activeTab.value;
  const target = node || tab;
  if (!target) return;
  const content = tab?.content || '';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = target.name || 'file.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// ===== 查找替换 =====
const findText = ref('');
const replaceText = ref('');
function doFind() {
  if (!activeTab.value || !findText.value) { showToast('error', '未找到'); return; }
  const idx = activeTab.value.content.indexOf(findText.value);
  if (idx === -1) showToast('error', '未找到');
  else showToast('success', `找到匹配项（位置 ${idx}）`);
}
function doReplace() {
  if (!activeTab.value || !findText.value) return;
  activeTab.value.content = activeTab.value.content.replace(findText.value, replaceText.value);
  activeTab.value.dirty = true;
}
function doReplaceAll() {
  if (!activeTab.value || !findText.value) return;
  activeTab.value.content = activeTab.value.content.split(findText.value).join(replaceText.value);
  activeTab.value.dirty = true;
}

// ===== 右键菜单 =====
const ctxMenuNode = ref<any>(null);
const ctxMenuPos = ref({ x: 0, y: 0 });
const showPlusMenu = ref(false);
function onCtxMenu(node: any, e: MouseEvent) {
  ctxMenuNode.value = node;
  ctxMenuPos.value = { x: e.clientX, y: e.clientY };
  if (node.is_directory) {
    selectedDir.value = node.path;
  }
}
function onEditorContextMenu(e: MouseEvent) {
  // 编辑器右键菜单
}

// ===== 拖拽 =====
function startDragFiles(e: MouseEvent) {
  const startX = e.clientX; const startW = rightWidth.value;
  const parent = (e.target as HTMLElement).parentElement!;
  const move = (ev: MouseEvent) => { rightWidth.value = Math.min(90, Math.max(35, startW - (ev.clientX - startX) / parent.clientWidth * 100)); };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}
function startDragRight(e: MouseEvent) {
  const startX = e.clientX; const startW = rightPanelWidth.value;
  const parent = (e.target as HTMLElement).parentElement!;
  const move = (ev: MouseEvent) => { rightPanelWidth.value = Math.min(50, Math.max(15, startW + (startX - ev.clientX) / parent.clientWidth * 100)); };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}

// ===== Toast =====
const toast = ref<{ type: string; message: string } | null>(null);
function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => { toast.value = null; }, 3000);
}

// ===== 初始化 =====
onMounted(async () => {
  if (!isAlliance.value) {
    router.push('/login');
    return;
  }
  await Promise.all([refreshTree(), loadUsage()]);
});
</script>

<style scoped>
.data-space {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
  overflow: hidden;
}

/* 文件树面板 */
.file-tree-panel {
  display: flex;
  flex-direction: column;
  background: var(--layer-default);
  border-right: 1px solid var(--divider-stroke);
  min-width: 200px;
  max-width: 45%;
  flex: 1 1 auto;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}
.panel-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.panel-actions { display: flex; gap: 2px; }


/* 加号菜单 */
.plus-menu-wrapper { position: relative; }
.plus-menu {
  position: absolute;
  top: 100%; right: 0;
  min-width: 180px;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 100;
  padding: var(--spacer-1);
}
.plus-item {
  display: flex; align-items: center; gap: var(--spacer-2);
  width: 100%; padding: var(--spacer-2) var(--spacer-3);
  border: none; background: transparent;
  color: var(--text-primary); font-size: var(--font-size-sm);
  cursor: pointer; border-radius: var(--radius-sm); text-align: left;
}
.plus-item:hover { background: var(--subtle-secondary); }
.plus-divider { height: 1px; background: var(--divider-stroke); margin: var(--spacer-1) 0; }

/* 文件树 */
.file-tree { flex: 1; overflow-y: auto; padding: var(--spacer-1) 0; }
.tree-node {
  display: flex; align-items: center; gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-3); cursor: pointer;
  font-size: var(--font-size-sm); color: var(--text-secondary);
  transition: background var(--fast-duration); user-select: none;
}
.tree-node:hover { background: var(--subtle-secondary); }
.tree-node.is-active { background: var(--subtle-accent); color: var(--text-primary); }
.tree-node.is-active .node-icon { color: var(--accent-base); }
.tree-node.is-selected-dir { background: var(--subtle-accent); }
.tree-node.is-selected-dir .node-icon { color: var(--accent-base); }
.tree-node.is-dir { font-weight: 500; color: var(--text-primary); }
.tree-node.is-protected { cursor: default; }
.tree-node.is-protected .node-chevron { cursor: pointer; }
.node-chevron { flex-shrink: 0; color: var(--text-tertiary); margin-left: -4px; }
.node-icon { flex-shrink: 0; color: var(--text-tertiary); }
.node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-badge {
  font-size: 10px; font-weight: 500;
  padding: 0 6px; height: 18px; line-height: 18px;
  border-radius: var(--radius-full); flex-shrink: 0;
  background: var(--accent-bg); color: var(--accent-base);
}
.node-size { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.ft-empty, .ft-loading {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--spacer-1); padding: var(--spacer-4);
  color: var(--text-tertiary); font-size: var(--font-size-xs);
}


/* 云空间使用概览 */
.usage-footer {
  padding: var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
  flex-shrink: 0;
}
.usage-header {
  display: flex; align-items: center; gap: var(--spacer-2);
  font-size: var(--font-size-xs); font-weight: 600;
  color: var(--text-tertiary); margin-bottom: var(--spacer-2);
}
.usage-bar {
  height: 4px; background: var(--divider-stroke);
  border-radius: var(--radius-full); overflow: hidden; margin-bottom: var(--spacer-1);
}
.usage-fill {
  height: 100%; background: var(--accent-base);
  border-radius: var(--radius-full); transition: width var(--normal-duration);
}
.usage-text {
  font-size: var(--font-size-xs); color: var(--text-tertiary);
  margin-bottom: var(--spacer-2);
}
.usage-detail {
  display: flex; flex-direction: column; gap: 2px;
}
.usage-item {
  display: flex; align-items: center; gap: var(--spacer-1);
  font-size: 10px; color: var(--text-tertiary);
}
.usage-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

/* 编辑器分隔条 */
.editor-splitter { width: 4px; background: transparent; cursor: col-resize; flex-shrink: 0; position: relative; z-index: 5; }
.editor-splitter:hover { background: var(--accent-base); }
.vertical-splitter { width: 4px; }
.editor-right-col { display: flex; flex-direction: column; min-width: 0; }
.editor-right-body { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }

/* 标签页（在 Ribbon 上方） */
.editor-tabs-row {
  display: flex;
  align-items: center;
  background: var(--ctrl-fill-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-2);
  flex-shrink: 0;
  overflow: hidden;
}
.editor-tabs {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  flex: 1;
  overflow-x: auto;
  scrollbar-width: thin;
  padding: var(--spacer-1) 0;
}
.editor-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--fast-duration), color var(--fast-duration);
  margin-bottom: -1px;
  user-select: none;
}
.editor-tab:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.editor-tab.active { background: var(--ctrl-fill-default); border-color: var(--divider-stroke); border-bottom-color: transparent; color: var(--text-primary); font-weight: 500; }
.editor-tab .tab-icon { flex-shrink: 0; }
.editor-tab .tab-title { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.dirty-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--status-warning); flex-shrink: 0; }
.tab-close { height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: var(--radius-full); color: var(--text-tertiary); cursor: pointer; font-size: 14px; line-height: 1; flex-shrink: 0; margin-left: 2px; }
.tab-close:hover { background: var(--subtle-pressed); color: var(--text-primary); }

/* 编辑器主体行（编辑区 + 右侧面板） */
.editor-body-row { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.editor-area { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--app-bg); }

/* 右侧面板 */
.right-panel {
  display: flex; flex-direction: column;
  background: var(--layer-default); border-left: 1px solid var(--divider-stroke);
  flex-shrink: 0; min-width: 0; position: relative;
}
.right-panel.collapsed { width: 32px !important; min-width: 32px; }
.panel-collapse-btn { position: absolute; left: -16px; top: 50%; transform: translateY(-50%); width: 16px; height: 32px; padding: 2px; display: flex; align-items: center; justify-content: center; background: var(--layer-default); border: 1px solid var(--divider-stroke); border-right: none; border-radius: var(--radius-sm) 0 0 var(--radius-sm); color: var(--text-tertiary); cursor: pointer; z-index: 10; }

.right-panel.collapsed .panel-collapse-btn { left: auto; right: 0; border-right: 1px solid var(--divider-stroke); border-left: none; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.panel-collapse-btn:hover { color: var(--text-primary); background: var(--subtle-secondary); }
.right-tabs { display: flex; border-bottom: 1px solid var(--divider-stroke); background: var(--subtle-secondary); flex-shrink: 0; position: relative; }
.right-tabs-scroll { display: flex; overflow-x: auto; flex: 1; scrollbar-width: none; }
.right-tabs-scroll::-webkit-scrollbar { display: none; }
.right-tab { display: inline-flex; align-items: center; gap: 4px; padding: var(--spacer-2) var(--spacer-3); background: transparent; border: none; border-bottom: 2px solid transparent; font-size: var(--font-size-xs); color: var(--text-tertiary); cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.right-tab:hover { color: var(--text-primary); }
.right-tab.active { color: var(--text-primary); border-bottom-color: var(--accent-base); font-weight: 500; }
.right-tab.add-tab { padding: var(--spacer-2) var(--spacer-2); border-left: 1px solid var(--divider-stroke); }
.tab-close-btn { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: 2px; margin-left: 2px; }
.tab-close-btn:hover { background: var(--subtle-pressed); color: var(--status-error); }
.panel-picker { position: absolute; top: 100%; right: 0; min-width: 160px; background: var(--flyout-bg); border: 1px solid var(--flyout-border); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: 100; padding: var(--spacer-1); }
.panel-picker-title { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); padding: var(--spacer-1) var(--spacer-2); }
.panel-picker-item { display: flex; align-items: center; gap: var(--spacer-2); width: 100%; padding: var(--spacer-1) var(--spacer-2); border: none; background: transparent; color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-sm); }
.panel-picker-item:hover { background: var(--subtle-secondary); }
.panel-picker-item.disabled { opacity: 0.4; cursor: not-allowed; }
.check-icon { margin-left: auto; color: var(--status-success); }
.right-panel-content { flex: 1; overflow: auto; display: flex; flex-direction: column; }

/* 属性面板 */
.props-panel { padding: var(--spacer-3); }
.panel-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: var(--spacer-2); color: var(--text-tertiary); padding: var(--spacer-6) var(--spacer-3); }
.property-list { display: flex; flex-direction: column; gap: var(--spacer-3); }
.property-item { display: flex; flex-direction: column; gap: var(--spacer-1); }
.property-item label { font-size: var(--font-size-xs); color: var(--text-tertiary); font-weight: 500; }
.property-item span { font-size: var(--font-size-sm); color: var(--text-primary); }
.property-item span.mono { font-family: var(--font-mono, monospace); word-break: break-all; }

/* 查找面板 */
.find-panel { padding: var(--spacer-3); }
.find-section { display: flex; flex-direction: column; gap: var(--spacer-2); }
.find-row { display: flex; align-items: center; gap: var(--spacer-2); }
.find-row input { flex: 1; padding: var(--spacer-1) var(--spacer-2); background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-primary); outline: none; }
.find-row input:focus { border-color: var(--accent-base); }
.find-btn { padding: var(--spacer-1) var(--spacer-2); background: var(--subtle-secondary); border: 1px solid var(--ctrl-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-secondary); cursor: pointer; }
.find-btn:hover { background: var(--subtle-pressed); color: var(--text-primary); }

/* 操作面板 */
.actions-panel { padding: var(--spacer-3); }
.action-list { display: flex; flex-direction: column; gap: var(--spacer-1); }
.action-item { display: flex; align-items: flex-start; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-3); background: var(--subtle-secondary); border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; text-align: left; }
.action-item:hover:not(:disabled) { background: var(--subtle-pressed); border-color: var(--divider-stroke); }
.action-item:disabled { opacity: 0.5; cursor: not-allowed; }
.action-item.danger { color: var(--status-error); }
.action-item.danger:hover { background: rgba(196, 43, 43, 0.08); }
.action-title { font-size: var(--font-size-sm); font-weight: 600; }
.action-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 2px; }

/* 网页空间配置面板 */
.webspace-config-panel { padding: var(--spacer-3); }
.settings-card { padding: var(--spacer-3); }
.settings-grid { display: flex; flex-direction: column; gap: var(--spacer-3); margin-bottom: var(--spacer-4); }
.setting-item { display: flex; flex-direction: column; gap: var(--spacer-1); }
.setting-label { font-size: var(--font-size-sm); font-weight: 500; color: var(--text-secondary); }
.setting-input { height: 36px; padding: 0 var(--spacer-3); background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border-rest); border-radius: var(--radius-sm); color: var(--text-primary); font-size: var(--font-size-sm); outline: none; }
.setting-input:focus { border-color: var(--accent-base); }
.slug-input-group { display: flex; align-items: center; }
.slug-prefix { height: 36px; display: flex; align-items: center; padding: 0 var(--spacer-3); background: var(--subtle-secondary); border: 1px solid var(--ctrl-border-rest); border-right: none; border-radius: var(--radius-sm) 0 0 var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-tertiary); font-family: monospace; }
.slug-input { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.toggle-label { display: flex; align-items: center; gap: var(--spacer-2); cursor: pointer; }
.toggle-input { display: none; }
.toggle-switch { width: 40px; height: 22px; background: var(--ctrl-fill-disabled); border-radius: var(--radius-full); position: relative; transition: background var(--fast-duration); }
.toggle-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: white; border-radius: 50%; transition: transform var(--fast-duration); }
.toggle-input:checked + .toggle-switch { background: var(--accent-base); }
.toggle-input:checked + .toggle-switch::after { transform: translateX(18px); }
.toggle-text { font-size: var(--font-size-sm); color: var(--text-secondary); }
.settings-footer { display: flex; justify-content: flex-start; align-items: center; }
.preview-link {
  display: inline-flex; align-items: center; gap: var(--spacer-1);
  font-size: var(--font-size-sm); color: var(--accent-base); text-decoration: none;
  padding: var(--spacer-2) var(--spacer-3); border-radius: var(--radius-sm);
  transition: background var(--fast-duration);
}
.preview-link:hover { background: var(--subtle-secondary); text-decoration: underline; }

.danger-btn { display: inline-flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); background: var(--status-error); color: white; border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; }
.danger-btn:hover { opacity: 0.9; }

.delete-message { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 var(--spacer-4); line-height: 1.6; }
.delete-message code { background: var(--subtle-secondary); padding: 1px var(--spacer-1); border-radius: var(--radius-xs); font-size: 12px; font-family: monospace; }
.delete-warning { display: block; color: var(--status-error); margin-top: var(--spacer-2); font-size: var(--font-size-xs); }

/* Toast */
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); z-index: 600; animation: slideUp var(--fast-duration); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); }
.toast-success { background: #10893e; color: white; }
.toast-error { background: var(--status-error); color: white; }
@keyframes slideUp { from { transform: translateX(-50%) translateY(16px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }

.empty-actions { padding: var(--spacer-4); text-align: center; }
.empty-hint { color: var(--text-tertiary); font-size: var(--font-size-sm); }
</style>