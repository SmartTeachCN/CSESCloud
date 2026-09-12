<template>
  <div class="instance-editor">
    <header class="editor-top-bar">
      <div class="top-bar-left">
        <button class="back-btn" @click="goBack" title="返回控制台" style="width:auto" >
          <Icon icon="ri-arrow-left-s-line" :size="18" />
          <span class="back-text">返回控制台</span>
        </button>
      </div>
      <div class="top-bar-right">
        <span class="instance-status" :class="instance?.status">
          <span class="status-dot"></span>
          {{ statusLabel }}
        </span>
        <span class="instance-name">{{ instance?.name || '加载中...' }}</span>
        <span v-if="instance?.relation === 'shared'" class="shared-badge">
          <Icon icon="ri-share-line" :size="10" /> 共享
        </span>
        <span v-if="isInstanceSub" class="sub-user-badge">
          <Icon icon="ri-user-line" :size="10" /> 子用户
        </span>
      </div>
    </header>

    <RibbonToolbar
      :editor-info="editorInfo"
      :manifest="effectiveRibbonManifest"
      :selected-tool="activeRibbonTool"
      :system-right-tools="systemRightTools"
      :saving="saving"
      :is-instance="true"
      :can-undo="true"
      :can-redo="true"
      :can-save="true"
      :can-auto-save="true"
      :right-actions="instanceRightActions"
      @save="saveAll"
      @undo="handleUndo"
      @redo="handleRedo"
      @tool-click="onRibbonTool"
      @autosize-change="onAutoSaveChange"
      @edit-click="goToProperties"
    />

    <div class="editor-body">
      <!-- Diff 标签栏（仅在有 diff 标签时显示） -->
      <div v-if="diffTabs.length > 0" class="editor-tabs-row">
        <div class="editor-tabs">
          <div
            v-for="tab in diffTabs"
            :key="tab.id"
            class="editor-tab diff-tab"
            :class="{ active: tab.id === activeDiffTabId }"
            @click="activeDiffTabId = tab.id"
          >
            <Icon icon="ri-contrast-2-line" :size="14" class="tab-icon" />
            <span class="tab-title" :title="tab.name">{{ tab.name }}</span>
            <button class="tab-close" @click.stop="closeDiffTab(tab.id)" title="关闭">
              <Icon icon="ri-close-line" :size="12" />
            </button>
          </div>
        </div>
      </div>

      <div class="editor-area" @contextmenu.prevent="onEditorContextMenu">
        <!-- 版本预览 -->
        <div v-if="previewContent" class="preview-view">
          <div class="preview-header">
            <Icon icon="ri-eye-line" :size="14" />
            <span>{{ previewContent.name }}</span>
            <button class="preview-close" @click="closePreview" title="关闭预览">
              <Icon icon="ri-close-line" :size="14" />
            </button>
          </div>
          <textarea
            class="preview-textarea"
            :value="previewContent.content"
            readonly
            spellcheck="false"
          ></textarea>
        </div>

        <!-- Diff 查看器 -->
        <div v-else-if="isDiffTabActive && activeDiffTab" class="ep-diff-viewer">
          <div class="diff-header-bar">
            <Icon icon="ri-contrast-2-line" :size="14" />
            <span>{{ activeDiffTab.label1 }} → {{ activeDiffTab.label2 }}</span>
            <span class="diff-summary-badge">
              <span class="diff-add">+{{ activeDiffTab.additions }}</span>
              <span class="diff-del">-{{ activeDiffTab.deletions }}</span>
            </span>
          </div>
          <div class="diff-lines-container">
            <div
              v-for="(line, li) in activeDiffTab.diffLines"
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

        <!-- 考试档案编辑器模式 -->
        <div v-else-if="examEditorMode" class="exam-editor-view">
          <div class="exam-editor-topbar">
            <button class="exam-editor-back" @click="closeExamEditor">
              <Icon icon="ri-arrow-left-s-line" :size="16" />
              <span>{{ examEditorBackLabel }}</span>
            </button>
            <span class="exam-editor-title">{{ examEditorFile?.name || '考试档案' }}</span>
          </div>
          <div class="exam-editor-body">
            <PluginEditorFrame
              v-if="examEditorPlugin"
              ref="examPluginFrame"
              :key="'exam-editor-' + (examEditorFile?.id || 'new')"
              :plugin="examEditorPlugin"
              :file-info="{ name: examEditorFile?.name || '', content: examEditorFile?.content || '', path: (examEditorFile?.directory || '') + (examEditorFile?.name || '') }"
              @save="onExamPluginSave"
              @ready="() => {}"
              @notify="(msg: string) => console.log('[exam-editor]', msg)"
              @plugin-request="onPluginFrameRequest"
            />
            <div v-else class="exam-editor-fallback">
              <textarea
                :value="examEditorFile?.content || ''"
                @input="(e: any) => { if (examEditorFile) examEditorFile.content = e.target.value }"
                class="fpe-textarea"
                spellcheck="false"
              ></textarea>
            </div>
          </div>
        </div>

        <iframe
          v-else-if="hasCustomEditor"
          ref="editorFrame"
          class="editor-iframe"
          :srcdoc="editorSrcDoc"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          @load="onIframeLoad"
        ></iframe>

        <div v-else class="config-manager">
          <div class="cm-toolbar">
            <div class="cm-tabs">
              <button
                v-for="col in collections"
                :key="col.key"
                class="cm-tab"
                :class="{ active: activeCollection === col.key }"
                @click="activeCollection = col.key"
              >
                <Icon :icon="col.icon || 'ri-table-line'" :size="14" />
                {{ col.label || col.key }}
                <span class="tab-count">{{ col.record_count ?? 0 }}</span>
              </button>
            </div>
            <div class="cm-search">
              <Icon icon="ri-search-line" :size="12" />
              <input v-model="searchKeyword" type="text" placeholder="搜索记录..." @input="loadRecords" />
              <button class="cm-add" @click="addRecord">
                <Icon icon="ri-add-line" :size="12" /> 新增
              </button>
            </div>
          </div>
          <div class="cm-content">
            <div v-if="recordsLoading" class="cm-loading">
              <Icon icon="ri-loader-4-line" :size="20" class="spin" />
              <span>加载记录...</span>
            </div>
            <div v-else-if="records.length === 0" class="cm-empty">
              <Icon icon="ri-inbox-line" :size="32" />
              <p>暂无记录，点击「新增」创建第一条</p>
            </div>
            <table v-else class="cm-table">
              <thead>
                <tr>
                  <th v-for="f in activeFields" :key="f.key">{{ f.label || f.key }}</th>
                  <th class="th-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in records" :key="r.id ?? i">
                  <td v-for="f in activeFields" :key="f.key">
                    <input v-model="r.data[f.key]" :type="fieldInputType(f)" :disabled="!canWrite" class="cell-input" />
                  </td>
                  <td class="td-actions">
                    <button class="row-btn" @click="saveRecord(r)" :disabled="!canWrite"><Icon icon="ri-save-line" :size="12" /></button>
                    <button class="row-btn danger" @click="deleteRecord(r)" :disabled="!canWrite"><Icon icon="ri-delete-bin-line" :size="12" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-if="!rightPanelCollapsed && !isDiffTabActive && !previewContent" class="editor-splitter" @mousedown="startDrag"></div>

      <div class="split-area" :class="{ collapsed: rightPanelCollapsed || isDiffTabActive || !!previewContent }" :style="(rightPanelCollapsed || isDiffTabActive || previewContent) ? {} : { width: rightPanelWidth + '%' }">
        <button class="panel-collapse-btn" @click="rightPanelCollapsed = !rightPanelCollapsed" :title="rightPanelCollapsed ? '展开面板' : '收起面板'">
          <Icon :icon="rightPanelCollapsed ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'" :size="14" />
        </button>
        <template v-if="!rightPanelCollapsed && !isDiffTabActive && !previewContent">
          <div class="split-tabs">
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
              <button v-for="p in availablePanels" :key="p.id" class="panel-picker-item"
                :class="{ disabled: visiblePanels.some(vp => vp.id === p.id) }"
                :disabled="visiblePanels.some(vp => vp.id === p.id)"
                @click="addPanel(p); showPanelPicker = false">
                <Icon :icon="p.icon" :size="14" />
                <span>{{ p.label }}</span>
                <Icon v-if="visiblePanels.some(vp => vp.id === p.id)" icon="ri-check-line" :size="12" class="check-icon" />
              </button>
            </div>
          </div>
          <div class="split-content">
            <AiAssistantPanel v-if="activePanel === 'ai'" scope="instance" :scope-ref="instanceId" :editor-context="aiEditorContext" @apply-edit="onAiApplyEdit" />
            <EditHistoryPanel v-else-if="activePanel === 'history_old'" :instance-id="instanceId" />
            <OperationHistoryPanel
              v-else-if="activePanel === 'history'"
              :file-id="selectedFile?.id ? String(selectedFile.id) : String(instanceId)"
              :file-name="selectedFile?.name || instance?.name || '实例'"
              :local-history="[]"
              :is-logged-in="true"
              workspace-key="instance_editor"
              @open-workspace-config="openPanel('workspace')"
            />
            <VersionHistoryPanel
              v-else-if="activePanel === 'version'"
              :key="(selectedFile?.id || instanceId) + '-ver'"
              :file-id="selectedFile?.id ? String(selectedFile.id) : String(instanceId)"
              :file-name="selectedFile?.name || instance?.name || '实例'"
              :is-owner="true"
              workspace-key="instance_editor"
              @open-workspace-config="openPanel('workspace')"
              @view-diff="openDiffTab"
              @preview-version="openPreviewTab"
            />
            <WorkspaceConfig
              v-else-if="activePanel === 'workspace'"
              workspace-key="instance_editor"
            />
            <FindReplacePanel v-else-if="activePanel === 'find'" :content="findReplaceContent" @replace="onReplace" @find="onFind" />
            <InstancePropertiesPanel v-else-if="activePanel === 'props'" :instance="instance" :can-write="canWrite" @saved="onPropsSaved" />
            <!-- 文件面板 -->
            <div v-else-if="activePanel === 'files'" class="file-panel">
              <div class="file-panel-header">
                <button class="fp-action-btn" @click="showNewFileDialog = true" title="新建文件">
                  <Icon icon="ri-file-add-line" :size="12" /><span>新建</span>
                </button>
                <button class="fp-action-btn" @click="showNewDirDialog = true" title="新建目录">
                  <Icon icon="ri-folder-add-line" :size="12" /><span>目录</span>
                </button>
                <span class="fp-stats" v-if="storageStats">
                  {{ storageStats.file_count ?? 0 }} 文件 · {{ formatFileSize(storageStats.total_size ?? 0) }}
                </span>
              </div>
              <div class="file-panel-tree">
                <div v-for="dir in fileTree.directories || []" :key="dir" class="ft-item ft-dir" :class="{ active: currentDir === dir }" @click="navigateDir(dir)">
                  <Icon icon="ri-folder-line" :size="14" /><span class="ft-name">{{ dir }}</span>
                </div>
                <div v-if="currentDir !== ''" class="ft-item ft-dir ft-back" @click="navigateDir('')">
                  <Icon icon="ri-arrow-left-s-line" :size="14" /><span class="ft-name">.. (返回根目录)</span>
                </div>
                <div v-for="file in fileTree.files || []" :key="file.id" class="ft-item ft-file" :class="{ active: selectedFile?.id === file.id }" @click="selectFile(file)" @contextmenu.prevent="onFileContextMenu($event, file)">
                  <Icon :icon="getFileIcon(file.file_type)" :size="14" /><span class="ft-name">{{ file.name }}</span>
                  <span class="ft-size">{{ formatFileSize(file.file_size) }}</span>
                </div>
                <div v-if="(fileTree.files || []).length === 0 && (fileTree.directories || []).length === 0 && currentDir === ''" class="ft-empty">
                  <Icon icon="ri-inbox-line" :size="16" /><span>暂无文件</span>
                </div>
              </div>
              <!-- 文件编辑内联 -->
              <div v-if="selectedFile" class="file-panel-editor">
                <div class="fpe-toolbar">
                  <span class="fpe-title">{{ selectedFile.name }}</span>
                  <button class="fpe-btn" @click="saveCurrentFile" :disabled="!canWrite"><Icon icon="ri-save-line" :size="12" /> 保存</button>
                  <button class="fpe-btn" @click="selectedFile = null; selectedFilePlugin = null"><Icon icon="ri-close-line" :size="12" /> 关闭</button>
                </div>
                <PluginEditorFrame
                  v-if="selectedFilePlugin"
                  ref="filePluginFrame"
                  :key="'plugin-' + selectedFile.id"
                  :plugin="selectedFilePlugin"
                  :file-info="{ name: selectedFile.name, content: selectedFile.content || '', path: selectedFile.directory + selectedFile.name }"
                  @save="onPluginFileSave"
                  @ready="onPluginFileReady"
                  @notify="(msg: string) => console.log('[file-editor]', msg)"
                  @plugin-request="onPluginFrameRequest"
                />
                <textarea v-else class="fpe-textarea" :value="selectedFile.content || ''" @input="onFileContentChange" spellcheck="false"></textarea>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <footer class="editor-status-bar">
      <div class="status-left">
        <span class="status-item" :class="instance?.status"><span class="status-dot"></span> {{ statusLabel }}</span>
        <span class="status-item"><Icon icon="ri-hashtag" :size="10" /> {{ instance?.instance_uid || ('#' + (instance?.id || '')) }}</span>
        <span class="status-item"><Icon icon="ri-apps-2-line" :size="10" /> {{ instance?.app_name || '—' }}</span>
        <button v-if="instance && canWrite" class="status-action-btn" @click="toggleStatus" :disabled="statusBusy" :title="instance?.status === 'running' ? '停止' : '启动'">
          <Icon :icon="statusBusy ? 'ri-loader-4-line' : (instance?.status === 'running' ? 'ri-pause-line' : 'ri-play-line')" :size="10" :class="{ spin: statusBusy }" />
          {{ instance?.status === 'running' ? '停止' : '启动' }}
        </button>
        <button v-if="instance && canWrite" class="status-action-btn" @click="restartInstance" :disabled="!canWrite || statusBusy" title="重启">
          <Icon icon="ri-refresh-line" :size="10" /> 重启
        </button>
        <StatusBarExtensions />
      </div>
      <div class="status-right">
        <span v-if="isInstanceSub" class="status-item"><Icon icon="ri-user-line" :size="10" /> 子用户：{{ user?.display_name || user?.username }}</span>
        <span class="status-item">{{ autoSave ? '自动保存: 开' : '自动保存: 关' }}</span>
      </div>
    </footer>

    <SubUserModal :visible="subModalVisible" :user="user" :instance="instance" @close="subModalVisible = false" @saved="onSubModalSaved" />

    <ShareDialog
      :visible="showShareDialog"
      resource-type="instance"
      :resource-id="instanceId"
      :resource-name="instance?.name || ''"
      resource-icon="ri-cloud-line"
      resource-label="实例"
      @close="showShareDialog = false"
      @created="loadInstance"
      @updated="loadInstance"
    />

    <Teleport to="body">
      <div v-if="showNewFileDialog" class="modal-overlay" @click.self="showNewFileDialog = false">
        <div class="modal-card">
          <div class="modal-header"><h3>新建文件</h3><button class="modal-close" @click="showNewFileDialog = false"><Icon icon="ri-close-line" :size="18" /></button></div>
          <div class="modal-body">
            <div class="form-group"><label>文件名（含后缀）</label><input v-model="newFileName" type="text" placeholder="例如：config.ea2" @keyup.enter="createNewFile" /></div>
            <div class="form-group"><label>文件类型</label>
              <select v-model="newFileType">
                <option value="ea2">EA2 考试档案 (.ea2)</option><option value="json">JSON 配置 (.json)</option><option value="php">PHP 后端 (.php)</option>
                <option value="html">HTML 页面 (.html)</option><option value="js">JavaScript (.js)</option><option value="css">样式表 (.css)</option>
                <option value="md">Markdown (.md)</option><option value="txt">纯文本 (.txt)</option>
              </select>
            </div>
            <div class="form-group"><label>分类</label>
              <select v-model="newFileCategory">
                <option value="instance_config">配置文件</option><option value="instance_php">PHP 后端</option><option value="instance_asset">静态资源</option>
              </select>
            </div>
          </div>
          <div class="modal-footer"><button class="btn btn-ghost" @click="showNewFileDialog = false">取消</button><button class="btn btn-primary" @click="createNewFile">创建</button></div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showNewDirDialog" class="modal-overlay" @click.self="showNewDirDialog = false">
        <div class="modal-card">
          <div class="modal-header"><h3>新建目录</h3><button class="modal-close" @click="showNewDirDialog = false"><Icon icon="ri-close-line" :size="18" /></button></div>
          <div class="modal-body"><div class="form-group"><label>目录名称</label><input v-model="newDirName" type="text" placeholder="例如：php" @keyup.enter="createNewDir" /></div></div>
          <div class="modal-footer"><button class="btn btn-ghost" @click="showNewDirDialog = false">取消</button><button class="btn btn-primary" @click="createNewDir">创建</button></div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="fileContextMenu.visible" class="context-menu-overlay" @click="fileContextMenu.visible = false" @contextmenu.prevent="fileContextMenu.visible = false">
        <div class="context-menu-card" :style="{ left: fileContextMenu.x + 'px', top: fileContextMenu.y + 'px' }">
          <button class="ctx-item" @click="onFileContextDelete"><Icon icon="ri-delete-bin-line" :size="14" /> 删除文件</button>
          <button class="ctx-item" @click="onFileContextDownload"><Icon icon="ri-download-line" :size="14" /> 下载文件</button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="editorCtxMenu.visible" class="context-menu-overlay" @click="editorCtxMenu.visible = false" @contextmenu.prevent="editorCtxMenu.visible = false">
        <div class="context-menu-card" :style="{ left: editorCtxMenu.x + 'px', top: editorCtxMenu.y + 'px' }">
          <button class="ctx-item" @click="saveAll(); editorCtxMenu.visible = false"><Icon icon="ri-save-line" :size="14" /> 保存</button>
          <button class="ctx-item" @click="handleUndo(); editorCtxMenu.visible = false"><Icon icon="ri-arrow-go-back-line" :size="14" /> 撤销</button>
          <button class="ctx-item" @click="handleRedo(); editorCtxMenu.visible = false"><Icon icon="ri-arrow-go-forward-line" :size="14" /> 重做</button>
          <div class="ctx-divider"></div>
          <button class="ctx-item" @click="openPanel('find'); editorCtxMenu.visible = false"><Icon icon="ri-search-line" :size="14" /> 查找替换</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { instancesApi, storageApi, instanceFilesApi, pluginApi } from '../../api';
import { useAuth } from '../../composables/useAuth';
import RibbonToolbar from '../../components/editor/RibbonToolbar.vue';
import PluginEditorFrame from '../../components/editor/PluginEditorFrame.vue';
import AiAssistantPanel from '../../components/editor/panels/AiAssistantPanel.vue';
import EditHistoryPanel from '../../components/editor/panels/EditHistoryPanel.vue';
import VersionHistoryPanel from '../../components/editor/panels/VersionHistoryPanel.vue';
import OperationHistoryPanel from '../../components/editor/panels/OperationHistoryPanel.vue';
import WorkspaceConfig from '../../components/editor/panels/WorkspaceConfig.vue';
import FindReplacePanel from '../../components/editor/panels/FindReplacePanel.vue';
import InstancePropertiesPanel from '../../components/editor/panels/InstancePropertiesPanel.vue';
import StatusBarExtensions from '../../components/editor/panels/StatusBarExtensions.vue';
import SubUserModal from '../../components/instances/SubUserModal.vue';
import ShareDialog from '../../components/editor/panels/ShareDialog.vue';

const route = useRoute();
const router = useRouter();
const { user } = useAuth();

const instanceId = computed(() => Number(route.params.id || 0));

const instance = ref<any>(null);
const loading = ref(false);

// AI 编辑器上下文
const aiEditorContext = computed(() => {
  if (!instance.value) return undefined;
  return {
    fileName: `实例配置: ${instance.value.name || ''}`,
    fileContent: JSON.stringify({
      name: instance.value.name,
      service_type: instance.value.service_type,
      status: instance.value.status,
      collections: collections.value.map(c => `${c.key} (${c.record_count ?? 0}条记录)`),
    }, null, 2),
    language: 'json',
  };
});
const saving = ref(false);
const statusBusy = ref(false);
const autoSave = ref(true);

// AI 应用编辑（实例编辑器不直接编辑文件，记录日志）
function onAiApplyEdit(payload: { content: string; replaceAll?: boolean }) {
  console.log('[InstanceEditor] AI 应用编辑:', payload.content.substring(0, 100) + '...');
}

const isInstanceSub = computed(() => user.value?.type === 'instance_sub' || user.value?.is_instance_sub);
const subModalVisible = ref(false);
const showShareDialog = ref(false);

// ===== 文件树 =====
const treeLoading = ref(false);
const fileTree = ref<{ files: any[]; directories: string[]; current_dir: string }>({ files: [], directories: [], current_dir: '' });
const currentDir = ref('');
const storageStats = ref<any>(null);
const selectedFile = ref<any>(null);
const selectedFilePlugin = ref<any>(null);
const dirtyFileContent = ref('');

// ===== Diff 标签支持 =====
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
const activeDiffTabId = ref('');

const isDiffTabActive = computed(() => diffTabs.value.length > 0 && !!activeDiffTabId.value);

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
  activeDiffTabId.value = id;
  rightPanelCollapsed.value = true;
}

function closeDiffTab(tabId: string) {
  diffTabs.value = diffTabs.value.filter(dt => dt.id !== tabId);
  if (activeDiffTabId.value === tabId) {
    activeDiffTabId.value = diffTabs.value.length > 0 ? diffTabs.value[diffTabs.value.length - 1].id : '';
  }
}

const activeDiffTab = computed(() => diffTabs.value.find(dt => dt.id === activeDiffTabId.value) || null);

// 版本预览
const previewContent = ref<{ content: string; name: string } | null>(null);

function openPreviewTab(payload: { content: string; label: string; fileName: string }) {
  previewContent.value = { content: payload.content, name: `版本预览: ${payload.fileName}` };
  rightPanelCollapsed.value = true;
}

function closePreview() {
  previewContent.value = null;
}

const showNewFileDialog = ref(false);
const showNewDirDialog = ref(false);
const newFileName = ref('config.ea2');
const newFileType = ref('ea2');
const newFileCategory = ref('instance_config');
const newDirName = ref('');

const fileContextMenu = ref<{ visible: boolean; x: number; y: number; file: any | null }>({ visible: false, x: 0, y: 0, file: null });

// ===== 考试档案编辑器模式 =====
const examEditorMode = ref(false);
const examEditorFile = ref<any>(null);
const examEditorPlugin = ref<any>(null);
const examPluginFrame = ref<any>(null);
const filePluginFrame = ref<any>(null);

/** 会话内记住当前打开的插件编辑文件（刷新后恢复） */
function rememberExamEditor() {
  try {
    if (examEditorFile.value) {
      sessionStorage.setItem('cses-exam-editor-' + instanceId.value, JSON.stringify({ fileId: examEditorFile.value.id }));
    } else {
      sessionStorage.removeItem('cses-exam-editor-' + instanceId.value);
    }
  } catch { /* ignore */ }
}

/** 刷新/重进后恢复上一次打开的插件编辑文件 */
async function restoreExamEditor() {
  try {
    const raw = sessionStorage.getItem('cses-exam-editor-' + instanceId.value);
    if (!raw) return;
    const { fileId } = JSON.parse(raw);
    if (!fileId) return;
    const full = await instanceFilesApi.get(fileId);
    const ext = (full.file_type || '').toLowerCase() || (full.name || '').split('.').pop()?.toLowerCase() || '';
    let plugin: any = null;
    try { plugin = await instanceFilesApi.resolveEditor(ext); } catch { }
    examEditorFile.value = { id: full.id, name: full.name, content: full.content || '', file_type: full.file_type || ext, directory: full.directory || '' };
    examEditorPlugin.value = plugin;
    examEditorMode.value = true;
  } catch {
    try { sessionStorage.removeItem('cses-exam-editor-' + instanceId.value); } catch { }
  }
}

// ===== 编辑器 =====
const editorFrame = ref<HTMLIFrameElement | null>(null);
const iframeReady = ref(false);

const hasCustomEditor = computed(() => !!((instance.value?.editor_html || '').trim()));

const editorSrcDoc = computed(() => {
  const html = instance.value?.editor_html || '';
  const js = instance.value?.editor_js || '';

  // CSES SDK 脚本
  const sdkScript = `<script>
window.CSES={instance:${JSON.stringify({id:instanceId.value,name:instance.value?.name||'',uid:instance.value?.instance_uid||''})},config:${JSON.stringify(instance.value?.config||{})},storageManifest:${JSON.stringify(instance.value?.storage_manifest||{})},interfaceSchema:${JSON.stringify(instance.value?.interface_schema||{})},
request:(action,payload)=>new Promise((resolve,reject)=>{const id=Date.now()+Math.random();const handler=(e)=>{if(e.data&&e.data.__ceseResponse===id){window.removeEventListener('message',handler);if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.result)}};window.addEventListener('message',handler);window.parent.postMessage({__ceseRequest:id,action,payload},'*')}),
saveConfig:(c)=>window.CSES.request('saveConfig',c),loadConfig:()=>window.CSES.request('loadConfig'),
listStorage:(c)=>window.CSES.request('listStorage',{collection:c}),saveStorage:(c,r)=>window.CSES.request('saveStorage',{collection:c,record:r}),
deleteStorage:(c,rid)=>window.CSES.request('deleteStorage',{collection:c,recordId:rid}),notify:(m)=>window.CSES.request('notify',{msg:m})};
<\/script>`;

  // 如果 editor_html 是完整的 HTML 文档，直接使用并注入 SDK
  if (html.trim().startsWith('<!DOCTYPE') || html.trim().startsWith('<html')) {
    // 在 </body> 前注入 SDK 和 editor_js（不包裹 try/catch，避免函数声明无法提升到全局作用域）
    const injected = html.replace('</body>', sdkScript + '<script>' + js + '<\/script></body>');
    return injected;
  }

  // 否则用默认包装（不包裹 try/catch，避免函数声明无法提升到全局作用域）
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Instance Editor</title>
<style>*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--app-bg,#fff);color:var(--text-primary,#1a1a1a)}body{overflow:auto}.dev-editor{padding:0; height:100%}</style></head>
<body><div class="dev-editor" id="app">${html}</div>
${sdkScript}
<script>${js||'// '}<\/script>
</body></html>`;
});

// ===== 配置管理器 =====
const collections = ref<any[]>([]);
const activeCollection = ref('');
const records = ref<any[]>([]);
const recordsLoading = ref(false);
const searchKeyword = ref('');

const activeFields = computed(() => { const col = collections.value.find(c => c.key === activeCollection.value); return col?.fields || []; });

const ribbonManifest = ref<any[] | undefined>(undefined);
const activeRibbonTool = ref('');
const activeRibbonPage = ref(''); // 当前 EA2 平台应用页面: connect/exams/config

// 通用“视图组”（宿主级，非插件配置）：追加在中间工具区最右侧
const viewRibbonGroup: any = {
  label: '视图',
  tools: [
    { id: 'view-fresh', label: '刷新', icon: 'ri-refresh-line', command: 'refresh' },
    { id: 'view-fullscreen', label: '全屏', icon: 'ri-fullscreen-line', command: 'fullscreen' },
    { id: 'view-immersive', label: '沉浸模式', icon: 'ri-focus-2-line', command: 'immersive', type: 'select' },
  ],
};

// 宿主级会自己处理的命令（不转发给插件）
const hostRibbonCommands = ['find', 'history', 'version', 'fullscreen', 'refresh', 'immersive', 'reload', 'share', 'import', 'export', 'save', 'undo', 'redo'];

// EA2 / ClassIsland 等平台应用各页面 Ribbon 操作组
const ea2PageRibbonGroups: Record<string, any[]> = {
  connect: [{
    label: '设备操作',
    tools: [
      { id: 'ea2-enroll', label: '生成注册码', icon: 'ri-qr-code-line', command: 'show_enrollment' },
      { id: 'ea2-refresh-devices', label: '刷新设备', icon: 'ri-refresh-line', command: 'refresh_devices' },
    ]
  }],
  exams: [{
    label: '考试操作',
    tools: [
      { id: 'ea2-new-exam', label: '新建考试', icon: 'ri-add-line', type: 'action', command: 'new_exam' },
      { id: 'ea2-multi-edit', label: '多选编辑', icon: 'ri-checkbox-multiple-line', command: 'multi_edit' },
      { id: 'ea2-group-mgmt', label: '分组管理', icon: 'ri-folder-line', command: 'group_mgmt' },
    ]
  }],
  profiles: [{
    label: '档案操作',
    tools: [
      { id: 'ci-new-profile', label: '新建档案', icon: 'ri-add-line', type: 'action', command: 'new_profile' },
      { id: 'ci-deploy-profile', label: '部署档案', icon: 'ri-send-plane-line', command: 'deploy_profile' },
      { id: 'ci-multi-edit', label: '多选编辑', icon: 'ri-checkbox-multiple-line', command: 'multi_edit' },
    ]
  }],
  config: [{
    label: '配置操作',
    tools: [
      { id: 'ea2-config-save', label: '保存配置', icon: 'ri-save-line', type: 'action', command: 'save' },
    ]
  }],
};

// 考试编辑器（插件）视图组：透传插件自身 Ribbon + 宿主视图组；非插件页面：实例 Ribbon + 页面操作组 + 视图组
const effectiveRibbonManifest = computed(() => {
  const view = [viewRibbonGroup];
  if (examEditorMode.value) {
    const pluginR = (examEditorPlugin.value?.ribbon) || [];
    return [...pluginR, ...view];
  }
  const instanceRibbon = ribbonManifest.value || [];
  const pageGroups = ea2PageRibbonGroups[activeRibbonPage.value] || [];
  return [...instanceRibbon, ...pageGroups, ...view];
});

// 靠右系统 Ribbon（仅插件编辑器模式下显示：重新加载插件）
const systemRightTools = computed(() => {
  if (!examEditorMode.value) return [];
  return [
    { id: 'exam-reload', label: '重新加载', icon: 'ri-refresh-line', command: 'reload' },
  ];
});

// ===== 右侧面板 =====
interface PanelDef { id: string; label: string; icon: string; closable: boolean; }
const allPanels: PanelDef[] = [
  { id: 'ai', label: 'AI助理', icon: 'ri-brain-line', closable: false },
  { id: 'files', label: '文件', icon: 'ri-folder-open-line', closable: false },
  { id: 'props', label: '实例属性', icon: 'ri-settings-3-line', closable: false },
  { id: 'history', label: '操作记录', icon: 'ri-history-line', closable: true },
  { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', closable: true },
  { id: 'find', label: '查找替换', icon: 'ri-search-line', closable: true },
  { id: 'workspace', label: '工作区配置', icon: 'ri-settings-3-line', closable: true },
];
const visiblePanels = ref<PanelDef[]>([allPanels[0], allPanels[1]]);
const activePanel = ref('ai');
const rightPanelWidth = ref(30);
const rightPanelCollapsed = ref(false);
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

const editorCtxMenu = ref({ visible: false, x: 0, y: 0 });
function onEditorContextMenu(e: MouseEvent) { editorCtxMenu.value = { visible: true, x: e.clientX, y: e.clientY }; }

const findReplaceContent = computed(() => JSON.stringify(instance.value?.config || {}, null, 2));

const canWrite = computed(() => instance.value?.can_write !== false);
const statusLabel = computed(() => {
  const s = instance.value?.status;
  if (s === 'running') return '运行中'; if (s === 'stopped') return '已停止'; if (s === 'error') return '错误'; return s || '未知';
});
const iconName = computed(() => {
  const t = (instance.value?.service_type || instance.value?.app_category || '').toLowerCase();
  if (t.includes('web')) return 'ri-globe-line'; if (t.includes('数据库')) return 'ri-database-2-line';
  if (t.includes('ai')) return 'ri-brain-line'; return 'ri-cloud-line';
});
const editorInfo = computed(() => ({
  title: instance.value?.name || '加载中...', type: instance.value?.app_name || '实例配置',
  icon: iconName.value, lastUpdated: instance.value?.updated_at || '', lastEditor: instance.value?.owner_name || '', editButtonLabel: '编辑属性',
}));

// 实例右侧操作区按钮
const instanceRightActions = computed(() => {
  if (isDiffTabActive.value) {
    return [{ id: 'export', label: '导出', icon: 'ri-upload-2-line', command: 'export', enabled: true }];
  }
  return [
    { id: 'share', label: '分享', icon: 'ri-share-forward-line', command: 'share', enabled: true },
    { id: 'history', label: '操作记录', icon: 'ri-history-line', command: 'history', enabled: true },
    { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', command: 'version', enabled: true },
    { id: 'import', label: '导入', icon: 'ri-download-line', command: 'import', enabled: true },
    { id: 'export', label: '导出', icon: 'ri-upload-2-line', command: 'export', enabled: true },
  ];
});

// ===== 加载实例 =====
async function loadInstance() {
  loading.value = true;
  try {
    const res = await instancesApi.get(instanceId.value);
    instance.value = res;
    ribbonManifest.value = res?.app_info_manifest?.ribbon;
    // 默认选中第一个 select 型工具
    const firstSelect = (ribbonManifest.value || []).flatMap((g: any) => g.tools || []).find((t: any) => t.type === 'select');
    activeRibbonTool.value = firstSelect?.id || '';
    await Promise.all([loadFileTree(), loadStorageStats()]);
    if (!hasCustomEditor.value) await loadCollections();
  } catch (e: any) {
    alert(e.message || '加载实例失败');
    router.push('/console/instances');
  } finally { loading.value = false; }
}

// ===== 文件树 =====
async function loadFileTree(dir?: string) {
  treeLoading.value = true;
  try { const result = await instanceFilesApi.list(instanceId.value, dir || currentDir.value); fileTree.value = result; currentDir.value = result.current_dir || ''; }
  catch (e: any) { console.error('加载文件树失败', e); fileTree.value = { files: [], directories: [], current_dir: '' }; }
  finally { treeLoading.value = false; }
}
async function loadStorageStats() { try { storageStats.value = await instanceFilesApi.storageStats(instanceId.value); } catch { storageStats.value = null; } }
function navigateDir(dir: string) { currentDir.value = dir; loadFileTree(dir); selectedFile.value = null; selectedFilePlugin.value = null; }
async function selectFile(file: any) {
  try {
    const fullFile = await instanceFilesApi.get(file.id);
    selectedFile.value = fullFile; dirtyFileContent.value = fullFile.content || '';
    const ext = (fullFile.file_type || '').toLowerCase() || (fullFile.name || '').split('.').pop()?.toLowerCase() || '';
    try { selectedFilePlugin.value = await instanceFilesApi.resolveEditor(ext); } catch { selectedFilePlugin.value = null; }
  } catch (e: any) { alert(e.message || '加载文件失败'); }
}
function onPluginFileSave(content: string) {
  if (!selectedFile.value || !canWrite.value) return;
  saving.value = true;
  instanceFilesApi.save({ id: selectedFile.value.id, instance_id: instanceId.value, name: selectedFile.value.name, content, file_type: selectedFile.value.file_type, file_category: selectedFile.value.file_category })
    .then(() => { selectedFile.value.content = content; selectedFile.value.file_size = content.length; loadFileTree(); loadStorageStats(); })
    .catch((e: any) => alert(e.message || '保存失败'))
    .finally(() => { saving.value = false; });
}
function onPluginFileReady() {}
function onFileContentChange(e: Event) { dirtyFileContent.value = (e.target as HTMLTextAreaElement).value; }

/** 判断保存的文件是否为 ClassIsland 档案（.json 且含 TimeLayouts/ClassPlans/Subjects 关键结构） */
function isClassIslandProfileFile(file: any, content: string): boolean {
  if (!file || (file.file_type || '').toLowerCase() !== 'json') return false;
  try { return isClassIslandProfileData(JSON.parse(content)); } catch { return false; }
}

/**
 * 档案保存后向已部署该档案的设备同步：查询设备上报状态中档案 config_id 与本文件一致的设备，
 * 重新下发 profile.prepare（与平台「部署档案」相同指令），使客户端拉取最新版本。
 */
async function syncProfileToDeployedDevices(fileId: number, fileName: string) {
  try {
    const devices = ((await callControlApi('device_list', {})) || []) as any[];
    const targets = devices
      .filter((d) => {
        const profile = d.last_reported_state?.profile;
        return profile && profile.config_id && String(profile.config_id) === String(fileId);
      })
      .map((d) => d.device_id);
    if (!targets.length) return;
    const res = await callControlApi('profile_deploy', {
      profile_config_id: String(fileId),
      device_ids: targets,
      profile_name: fileName,
    });
    alert(`档案已保存，并已向 ${res?.device_count || targets.length} 台已部署设备发送同步命令`);
  } catch (e: any) {
    console.error('同步档案到已部署设备失败', e);
  }
}

async function saveCurrentFile() {
  if (!selectedFile.value || !canWrite.value) return;
  saving.value = true;
  try {
    await instanceFilesApi.save({ id: selectedFile.value.id, instance_id: instanceId.value, name: selectedFile.value.name, content: dirtyFileContent.value, file_type: selectedFile.value.file_type, file_category: selectedFile.value.file_category });
    selectedFile.value.content = dirtyFileContent.value; selectedFile.value.file_size = dirtyFileContent.value.length;
    await loadFileTree(); await loadStorageStats();
    if (isClassIslandProfileFile(selectedFile.value, dirtyFileContent.value)) {
      await syncProfileToDeployedDevices(selectedFile.value.id, selectedFile.value.name);
    }
  } catch (e: any) { alert(e.message || '保存失败'); }
  finally { saving.value = false; }
}
async function createNewFile() {
  if (!newFileName.value.trim()) return;
  saving.value = true;
  try {
    await instanceFilesApi.save({ instance_id: instanceId.value, directory: currentDir.value || '', name: newFileName.value.trim(), content: '', file_type: newFileType.value, file_category: newFileCategory.value });
    showNewFileDialog.value = false; newFileName.value = 'config.ea2';
    await loadFileTree(currentDir.value); await loadStorageStats();
  } catch (e: any) { alert(e.message || '创建失败'); }
  finally { saving.value = false; }
}
async function createNewDir() {
  if (!newDirName.value.trim()) return;
  saving.value = true;
  try {
    await instanceFilesApi.save({ instance_id: instanceId.value, directory: currentDir.value ? currentDir.value + '/' + newDirName.value.trim() : newDirName.value.trim(), name: '.gitkeep', content: '', file_type: 'txt', file_category: 'instance_config' });
    showNewDirDialog.value = false; newDirName.value = '';
    await loadFileTree(currentDir.value); await loadStorageStats();
  } catch (e: any) { alert(e.message || '创建失败'); }
  finally { saving.value = false; }
}
function onFileContextMenu(e: MouseEvent, file: any) { fileContextMenu.value = { visible: true, x: e.clientX, y: e.clientY, file }; }
async function onFileContextDelete() {
  const file = fileContextMenu.value.file; if (!file) return;
  fileContextMenu.value.visible = false;
  if (!confirm(`确认删除文件「${file.name}」？`)) return;
  try { await instanceFilesApi.delete(file.id); if (selectedFile.value?.id === file.id) { selectedFile.value = null; selectedFilePlugin.value = null; } await loadFileTree(); await loadStorageStats(); }
  catch (e: any) { alert(e.message || '删除失败'); }
}
async function onFileContextDownload() {
  const file = fileContextMenu.value.file; if (!file) return;
  fileContextMenu.value.visible = false;
  // 通过 fetch + Blob 下载，避免 SPA 路由拦截
  try {
    const resp = await fetch(`/api/instance-files?action=download&id=${file.id}`, {
      credentials: 'include',
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: '下载失败' }));
      throw new Error(err.message || '下载失败');
    }
    const blob = await resp.blob();
    if (blob.size === 0) {
      throw new Error('文件内容为空');
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e: any) {
    alert('下载失败: ' + (e.message || '未知错误'));
  }
}
function getFileIcon(fileType: string): string {
  const icons: Record<string, string> = { ea2: 'ri-file-settings-line', json: 'ri-braces-line', php: 'ri-code-line', html: 'ri-html5-line', js: 'ri-javascript-line', css: 'ri-css3-line', md: 'ri-markdown-line', txt: 'ri-file-text-line' };
  return icons[fileType] || 'ri-file-line';
}
function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadCollections() {
  try {
    const resp = await fetch(`/api/instance-storage?action=collections&instance_id=${instanceId.value}`, { credentials: 'include' });
    const json = await resp.json(); const data = json.data?.collections || [];
    collections.value = data;
    if (data.length > 0 && !activeCollection.value) { activeCollection.value = data[0].key; await loadRecords(); }
  } catch { collections.value = []; }
}
async function loadRecords() {
  if (!activeCollection.value) return;
  recordsLoading.value = true;
  try {
    const url = `/api/instance-storage?action=list&instance_id=${instanceId.value}&collection_key=${encodeURIComponent(activeCollection.value)}&keyword=${encodeURIComponent(searchKeyword.value)}`;
    const resp = await fetch(url, { credentials: 'include' }); const json = await resp.json(); records.value = json.data || [];
  } catch { records.value = []; }
  finally { recordsLoading.value = false; }
}
watch(activeCollection, () => { loadRecords(); });

function onIframeLoad() {
  iframeReady.value = true;
  editorFrame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify({ __ceseInit: true, instance: { id: instanceId.value, name: instance.value?.name, uid: instance.value?.instance_uid }, config: instance.value?.config || {}, storageManifest: instance.value?.storage_manifest || {}, interfaceSchema: instance.value?.interface_schema || {} })), '*');
}
window.addEventListener('message', async (e) => {
  if (!e.data) return;
  // 监听 iframe 页面切换
  if (e.data.__ceseReportPage) {
    activeRibbonPage.value = e.data.__ceseReportPage;
    return;
  }
  if (!e.data.__ceseRequest) return;
  const { __ceseRequest: id, action, payload } = e.data;
  try {
    let result: any;
    if (action === 'loadConfig') result = instance.value?.config || {};
    else if (action === 'saveConfig') { if (!canWrite.value) throw new Error('无写权限'); await instancesApi.setConfig(instanceId.value, payload); instance.value.config = payload; result = { ok: true }; }
    else if (action === 'loadConfigFile') { result = await loadConfigFile(payload.file); }
    else if (action === 'saveConfigFile') { if (!canWrite.value) throw new Error('无写权限'); result = await saveConfigFile(payload.file, payload.content); }
    else if (action === 'listStorage') result = await storageApi.list(instanceId.value, payload.collection);
    else if (action === 'saveStorage') { if (!canWrite.value) throw new Error('无写权限'); result = await storageApi.save(instanceId.value, payload.collection, payload.record); }
    else if (action === 'deleteStorage') { if (!canWrite.value) throw new Error('无写权限'); result = await storageApi.delete(instanceId.value, payload.collection, payload.recordId); }
    else if (action === 'openExam') { await openExamInEditor(payload); result = { ok: true }; }
    else if (action === 'listEa2Files') { result = await listEa2Files(); }
    else if (action === 'saveEa2File') { result = await saveEa2File(payload); }
    else if (action === 'deleteEa2File') { result = await deleteEa2File(payload); }
    else if (action === 'openProfile') { await openProfileInEditor(payload); result = { ok: true }; }
    else if (action === 'listCiProfiles') { result = await listCiProfiles(); }
    else if (action === 'saveCiProfile') { result = await saveCiProfile(payload); }
    else if (action === 'deleteCiProfile') { result = await deleteCiProfile(payload); }
    else if (action === 'downloadFile') { downloadGeneratedFile(payload); result = { ok: true }; }
    else if (action === 'notify') { console.log('[editor notify]', payload.msg); result = { ok: true }; }
    else if (action === 'controlApi') { result = await callControlApi(payload.action, payload.payload ?? {}); }
    else throw new Error('未知 action: ' + action);
    editorFrame.value?.contentWindow?.postMessage({ __ceseResponse: id, result }, '*');
  } catch (err: any) { editorFrame.value?.contentWindow?.postMessage({ __ceseResponse: id, error: err.message }, '*'); }
});

function onRibbonTool(tool: any) {
  if (tool.type === 'select') activeRibbonTool.value = tool.id;
  // 插件编辑器模式下：非宿主级命令转发到插件 iframe（透传插件工具组）
  if (examEditorMode.value && tool.command && examEditorPlugin.value && hostRibbonCommands.indexOf(tool.command) < 0) {
    triggerExamPluginCommand(tool.command);
    return;
  }
  if (tool.command === 'reload') { reloadExamPlugin(); return; }
  if (iframeReady.value && editorFrame.value) {
    editorFrame.value.contentWindow?.postMessage({ __ceseCommand: tool.command || tool.id }, '*');
  }
  if (tool.command === 'find') openPanel('find');
  else if (tool.command === 'history') openPanel('history');
  else if (tool.command === 'version') openPanel('version');
  else if (tool.command === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
  else if (tool.command === 'refresh') loadInstance();
  else if (tool.command === 'immersive') { /* 沉浸模式占位，选中态由 activeRibbonTool 控制 */ }
  else if (tool.command === 'share') showShareDialog.value = true;
}
function handleUndo() {
  if (examEditorMode.value) { triggerExamPluginCommand('undo'); return; }
  if (iframeReady.value && editorFrame.value) editorFrame.value.contentWindow?.postMessage({ __ceseCommand: 'undo' }, '*');
}
function handleRedo() {
  if (examEditorMode.value) { triggerExamPluginCommand('redo'); return; }
  if (iframeReady.value && editorFrame.value) editorFrame.value.contentWindow?.postMessage({ __ceseCommand: 'redo' }, '*');
}
function onAutoSaveChange(v: boolean) { autoSave.value = v; }

async function openExamInEditor(payload: any) {
  const examData = payload.examData || {};
  const examName = payload.examName || '未命名考试';
  const recordId = payload.record_id || '';
  const existingName = payload.fileName || null;
  const rand = Math.random().toString(36).substring(2, 8);
  const fileName = existingName
    ? (existingName.endsWith('.ea2') ? existingName : existingName + '.ea2')
    : ('exam-' + rand + '.ea2');
  const ea2Content = JSON.stringify(examData, null, 2);
  const examDir = 'exams';
  try {
    await loadFileTree(examDir);
    const existing = (fileTree.value.files || []).find((f: any) => f.name === fileName);
    let fileId: number;
    if (existing) {
      fileId = existing.id;
    } else {
      const saveRes = await instanceFilesApi.save({ instance_id: instanceId.value, directory: examDir, name: fileName, content: ea2Content, file_type: 'ea2', file_category: 'instance_config' });
      fileId = saveRes.id;
    }
    let plugin = null;
    try { plugin = await instanceFilesApi.resolveEditor('ea2'); } catch { }
    examEditorFile.value = { id: fileId, name: fileName, content: ea2Content, file_type: 'ea2', directory: examDir + '/' };
    examEditorPlugin.value = plugin;
    examEditorMode.value = true;
    rememberExamEditor();
    await loadFileTree(examDir);
  } catch (e: any) {
    alert('打开编辑器失败: ' + (e.message || '未知错误'));
  }
}

/** 插件编辑器返回按钮标签：按实例应用区分（ClassIsland → 返回设备列表，EA2 → 返回考试列表） */
const examEditorBackLabel = computed(() =>
  instance.value?.app_key === 'classisland' ? '返回设备列表' : '返回考试列表'
);

function closeExamEditor() {
  examEditorMode.value = false;
  examEditorFile.value = null;
  examEditorPlugin.value = null;
  rememberExamEditor();
  if (iframeReady.value && editorFrame.value) {
    // 返回发起编辑的列表页：ClassIsland 回设备列表，EA2 回考试列表
    const backCommand = instance.value?.app_key === 'classisland' ? 'page_connect' : 'page_exams';
    editorFrame.value.contentWindow?.postMessage({ __ceseCommand: backCommand }, '*');
  }
}

// 重新挂载考试编辑器插件 iframe
function reloadExamPlugin() {
  if (!examEditorMode.value) return;
  const f = examEditorFile.value;
  examEditorMode.value = false;
  nextTick(() => { if (f) { examEditorMode.value = true; examEditorFile.value = f; } });
}

function triggerExamPluginSave() {
  // 通过 PluginEditorFrame 暴露的 iframe 元素发送保存命令
  const frame = examPluginFrame.value;
  if (!frame) return;
  const iframe = frame.pluginFrame;
  if (iframe) {
    iframe.contentWindow?.postMessage({ __ceseCommand: 'save' }, '*');
  }
}

function triggerExamPluginCommand(command: string) {
  const frame = examPluginFrame.value;
  if (!frame) return;
  const iframe = frame.pluginFrame;
  if (iframe) {
    iframe.contentWindow?.postMessage({ __ceseCommand: command }, '*');
  }
}

async function listEa2Files() {
  await loadFileTree('exams');
  const ea2Files = (fileTree.value.files || []).filter((f: any) => (f.file_type || '').toLowerCase() === 'ea2' || (f.name || '').endsWith('.ea2'));
  const result = [];
  for (const f of ea2Files) {
    try {
      const full = await instanceFilesApi.get(f.id);
      const data = JSON.parse(full.content || '{}');
      result.push({ record_id: full.name.replace(/\.ea2$/i, ''), id: full.id, name: full.name, data, _fileId: full.id });
    } catch { /* skip malformed */ }
  }
  return result;
}

async function saveEa2File(payload: any) {
  if (!canWrite.value) throw new Error('无写权限');
  const name = (payload.name || 'exam') + '.ea2';
  const content = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data || {}, null, 2);
  const existing = (fileTree.value.files || []).find((f: any) => f.name === name);
  if (existing) {
    await instanceFilesApi.save({ id: existing.id, instance_id: instanceId.value, name, content, file_type: 'ea2', file_category: 'instance_config' });
    return { fileId: existing.id, name };
  }
  const res = await instanceFilesApi.save({ instance_id: instanceId.value, directory: 'exams', name, content, file_type: 'ea2', file_category: 'instance_config' });
  await loadFileTree('exams');
  return { fileId: res.id, name };
}

async function deleteEa2File(payload: any) {
  if (!canWrite.value) throw new Error('无写权限');
  const name = (payload.name || '') + '.ea2';
  const existing = (fileTree.value.files || []).find((f: any) => f.name === name);
  if (existing) { await instanceFilesApi.delete(existing.id); await loadFileTree('exams'); }
  return { ok: true };
}

// ===== ClassIsland 档案（.json + 关键格式识别） =====
/** 识别 ClassIsland 档案关键结构（与档案编辑器插件的识别规则一致） */
function isClassIslandProfileData(obj: any): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const isDict = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isDict(obj.TimeLayouts) || !isDict(obj.ClassPlans) || !isDict(obj.Subjects)) return false;
  for (const id of Object.keys(obj.Subjects)) {
    const s = obj.Subjects[id];
    if (!s || typeof s !== 'object' || typeof s.Name !== 'string') return false;
  }
  for (const id of Object.keys(obj.TimeLayouts)) {
    const tl = obj.TimeLayouts[id];
    if (!tl || typeof tl !== 'object' || !Array.isArray(tl.Layouts)) return false;
  }
  return true;
}

function countProfileItems(data: any) {
  return {
    subjects: Object.keys(data?.Subjects || {}).length,
    layouts: Object.keys(data?.TimeLayouts || {}).length,
    plans: Object.keys(data?.ClassPlans || {}).length,
  };
}

async function openProfileInEditor(payload: any) {
  const profileData = payload.profileData || {};
  const profileName = payload.profileName || '未命名档案';
  const recordId = payload.record_id || '';
  const existingName = payload.fileName || null;
  const rand = Math.random().toString(36).substring(2, 8);
  const fileName = existingName
    ? (existingName.endsWith('.json') ? existingName : existingName + '.json')
    : ('profile-' + rand + '.json');
  const profileDir = 'profiles';
  try {
    await loadFileTree(profileDir);
    const existing = (fileTree.value.files || []).find((f: any) => f.name === fileName);
    let fileId: number;
    if (existing) {
      fileId = existing.id;
    } else {
      const saveRes = await instanceFilesApi.save({ instance_id: instanceId.value, directory: profileDir, name: fileName, content: JSON.stringify(profileData, null, 4), file_type: 'json', file_category: 'instance_config' });
      fileId = saveRes.id;
    }
    let plugin = null;
    try { plugin = await instanceFilesApi.resolveEditor('json'); } catch { }
    examEditorFile.value = { id: fileId, name: fileName, content: JSON.stringify(profileData, null, 4), file_type: 'json', directory: profileDir + '/' };
    examEditorPlugin.value = plugin;
    examEditorMode.value = true;
    rememberExamEditor();
    await loadFileTree(profileDir);
  } catch (e: any) {
    alert('打开档案编辑器失败: ' + (e.message || '未知错误'));
  }
}

async function listCiProfiles() {
  await loadFileTree('profiles');
  const jsonFiles = (fileTree.value.files || []).filter((f: any) =>
    (f.name || '').toLowerCase().endsWith('.json') &&
    ((f.file_type || '').toLowerCase() === 'json' || (f.name || '').toLowerCase().endsWith('.json'))
  );
  const result: any[] = [];
  for (const f of jsonFiles) {
    try {
      const full = await instanceFilesApi.get(f.id);
      const data = JSON.parse(full.content || '{}');
      if (!isClassIslandProfileData(data)) continue;
      const counts = countProfileItems(data);
      result.push({
        id: full.id,
        name: full.name,
        record_id: full.name.replace(/\.json$/i, ''),
        profile_name: data.Name || full.name,
        data,
        subjects: counts.subjects,
        layouts: counts.layouts,
        plans: counts.plans,
        updated_at: full.updated_at,
      });
    } catch { /* skip malformed */ }
  }
  return result;
}

async function saveCiProfile(payload: any) {
  if (!canWrite.value) throw new Error('无写权限');
  let name = payload.name || payload.fileName || '';
  if (name && !name.endsWith('.json')) name += '.json';
  if (!name) name = 'profile-' + Math.random().toString(36).substring(2, 8) + '.json';
  const content = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data || {}, null, 4);
  await loadFileTree('profiles');
  const existing = (fileTree.value.files || []).find((f: any) => f.name === name);
  if (existing) {
    await instanceFilesApi.save({ id: existing.id, instance_id: instanceId.value, name, content, file_type: 'json', file_category: 'instance_config' });
    return { fileId: existing.id, name };
  }
  const res = await instanceFilesApi.save({ instance_id: instanceId.value, directory: 'profiles', name, content, file_type: 'json', file_category: 'instance_config' });
  await loadFileTree('profiles');
  return { fileId: res.id, name };
}

async function deleteCiProfile(payload: any) {
  if (!canWrite.value) throw new Error('无写权限');
  const name = (payload.name || '').endsWith('.json') ? payload.name : (payload.name || '') + '.json';
  await loadFileTree('profiles');
  const existing = (fileTree.value.files || []).find((f: any) => f.name === name);
  if (existing) { await instanceFilesApi.delete(existing.id); await loadFileTree('profiles'); }
  return { ok: true };
}

/** 触发浏览器下载（供实例应用生成凭据/导出文件使用） */
function downloadGeneratedFile(payload: { name?: string; content?: string; mime?: string }) {
  const name = payload.name || 'download.json';
  const blob = new Blob([payload.content || ''], { type: payload.mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 加载配置文件（从实例存储空间的 config/ 子目录）
async function loadConfigFile(fileName: string) {
  await loadFileTree('config');
  const existing = (fileTree.value.files || []).find((f: any) => f.name === fileName);
  if (!existing) return {};
  try {
    const full = await instanceFilesApi.get(existing.id);
    return JSON.parse(full.content || '{}');
  } catch { return {}; }
}

// 保存配置文件（到实例存储空间的 config/ 子目录）
async function saveConfigFile(fileName: string, content: any) {
  await loadFileTree('config');
  const existing = (fileTree.value.files || []).find((f: any) => f.name === fileName);
  const contentStr = JSON.stringify(content, null, 2);
  if (existing) {
    await instanceFilesApi.save({ id: existing.id, instance_id: instanceId.value, name: fileName, content: contentStr, file_type: 'json', file_category: 'instance_config' });
  } else {
    await instanceFilesApi.save({ instance_id: instanceId.value, directory: 'config', name: fileName, content: contentStr, file_type: 'json', file_category: 'instance_config' });
  }
  await loadFileTree('config');
  return { ok: true };
}

async function callControlApi(action: string, payload: any = {}) {
  const uid = instance.value?.instance_uid;
  if (!uid) throw new Error('实例 UID 不可用');
  const params = new URLSearchParams({ instance_uid: uid, action });
  const resp = await fetch(`/api/rest-control?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(json.message || 'API 请求失败');
  }
  return json.data ?? json;
}

/**
 * 处理 PluginEditorFrame 转发的自定义请求（如 controlApi）
 * 由父组件异步处理并通过 postMessage 返回结果
 */
async function onPluginFrameRequest(requestId: number, action: string, payload: any) {
  try {
    let result: any;
    if (action === 'controlApi') {
      result = await callControlApi(payload.action, payload.payload ?? {});
    } else {
      throw new Error('未知 action: ' + action);
    }
    // 响应到任意活跃的 PluginEditorFrame
    const frame = examPluginFrame.value?.pluginFrame || filePluginFrame.value?.pluginFrame;
    if (frame) {
      frame.contentWindow?.postMessage({ __csesPluginResponse: requestId, result }, '*');
    }
  } catch (err: any) {
    const frame = examPluginFrame.value?.pluginFrame || filePluginFrame.value?.pluginFrame;
    if (frame) {
      frame.contentWindow?.postMessage({ __csesPluginResponse: requestId, error: err.message }, '*');
    }
  }
}

function onExamPluginSave(content: string) {
  if (!examEditorFile.value || !canWrite.value) return;
  saving.value = true;
  const fileType = examEditorFile.value.file_type || 'ea2';
  instanceFilesApi.save({
    id: examEditorFile.value.id,
    instance_id: instanceId.value,
    name: examEditorFile.value.name,
    content,
    file_type: fileType,
    file_category: 'instance_config',
  })
    .then(() => {
      examEditorFile.value.content = content;
      examEditorFile.value.file_size = content.length;
      loadFileTree(currentDir.value);
      loadStorageStats();
      // ClassIsland 档案保存后，向已部署该档案的设备发送同步命令
      if (isClassIslandProfileFile(examEditorFile.value, content)) {
        syncProfileToDeployedDevices(examEditorFile.value.id, examEditorFile.value.name);
      }
    })
    .catch((e: any) => alert(e.message || '保存失败'))
    .finally(() => { saving.value = false; });
}

async function saveAll() {
  saving.value = true;
  try {
    if (selectedFile.value && !selectedFilePlugin.value) await saveCurrentFile();
    if (examEditorMode.value) triggerExamPluginSave();
    if (iframeReady.value && editorFrame.value) editorFrame.value.contentWindow?.postMessage({ __ceseCommand: 'save' }, '*');
  } finally { saving.value = false; }
}

async function toggleStatus() {
  if (!instance.value) return;
  statusBusy.value = true;
  try { if (instance.value.status === 'running') await instancesApi.stop(instanceId.value); else await instancesApi.start(instanceId.value); await loadInstance(); }
  catch (e: any) { alert(e.message || '操作失败'); }
  finally { statusBusy.value = false; }
}
async function restartInstance() {
  if (!instance.value) return; statusBusy.value = true;
  try { await instancesApi.restart(instanceId.value); await loadInstance(); }
  catch (e: any) { alert(e.message || '操作失败'); }
  finally { statusBusy.value = false; }
}

function fieldInputType(field: any): string {
  const t = (field.type || '').toLowerCase();
  if (t === 'number') return 'number'; if (t === 'date') return 'date'; if (t === 'boolean' || t === 'bool') return 'checkbox'; return 'text';
}
function addRecord() {
  if (!activeCollection.value) return;
  const newData: any = {}; activeFields.value.forEach(f => { newData[f.key] = ''; });
  records.value.unshift({ id: null, record_id: '', data: newData, _new: true });
}
async function saveRecord(r: any) {
  try { const result = await storageApi.save(instanceId.value, activeCollection.value, { record_id: r.record_id, data: r.data }); r.record_id = result.record_id; r._new = false; await loadRecords(); }
  catch (e: any) { alert(e.message || '保存失败'); }
}
async function deleteRecord(r: any) {
  if (!confirm('确认删除该记录？')) return;
  try { if (r.record_id) await storageApi.delete(instanceId.value, activeCollection.value, r.record_id); await loadRecords(); }
  catch (e: any) { alert(e.message || '删除失败'); }
}
function onFind(text: string) { if (iframeReady.value && editorFrame.value) editorFrame.value.contentWindow?.postMessage({ __ceseCommand: 'find', text }, '*'); }
function onReplace(findText: string, replaceText: string, replaceAll: boolean) { if (iframeReady.value && editorFrame.value) editorFrame.value.contentWindow?.postMessage({ __ceseCommand: 'replace', findText, replaceText, replaceAll }, '*'); }
function onPropsSaved() { loadInstance(); }
function onSubModalSaved(payload: any) { console.log('[sub-user saved]', payload); }
function goBack() { router.push('/console/instances'); }
function goToProperties() { activePanel.value = 'props'; }
function startDrag(e: MouseEvent) {
  const startX = e.clientX; const startWidth = rightPanelWidth.value;
  const onMouseMove = (ev: MouseEvent) => { const containerWidth = (e.target as HTMLElement).parentElement?.clientWidth || 800; const delta = startX - ev.clientX; const deltaPercent = (delta / containerWidth) * 100; rightPanelWidth.value = Math.min(50, Math.max(15, startWidth + deltaPercent)); };
  const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
  document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
}

onMounted(async () => {
  await loadInstance();
  await restoreExamEditor();
  if (isInstanceSub.value) nextTick(() => { subModalVisible.value = true; });
});
</script>

<style scoped>
.instance-editor { display: flex; flex-direction: column; height: 100vh; background: var(--app-bg); overflow: hidden; }
.top-bar-left { display: flex; align-items: center; gap: var(--spacer-2); flex-shrink: 0; min-width: 0; }
.back-btn { height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; background: transparent; border: none; border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; padding: 0 var(--spacer-2); font-size: var(--font-size-sm); }
.back-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.back-text { font-weight: 500; }
.instance-name { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
.instance-status { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); padding: 2px var(--spacer-2); border-radius: var(--radius-full); font-weight: 500; }
.instance-status.running { background: rgba(16,124,16,0.1); color: var(--status-success); }
.instance-status.stopped { background: var(--subtle-secondary); color: var(--text-tertiary); }
.instance-status.error { background: rgba(196,43,28,0.1); color: var(--status-error); }
.status-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: currentColor; }
.instance-status.running .status-dot { animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.shared-badge,.sub-user-badge { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; padding: 1px 6px; border-radius: var(--radius-full); font-weight: 500; }
.shared-badge { background: var(--accent-bg); color: var(--accent-base); }
.sub-user-badge { background: var(--subtle-pressed); color: var(--text-primary); }
.top-bar-right { display: flex; align-items: center; gap: var(--spacer-2); flex-shrink: 0; }
.editor-iframe { width: 100%; height: 100%; border: none; background: var(--app-bg); }

/* 文件面板 */
.file-panel { display: flex; flex-direction: column; height: 100%; }
.file-panel-header { display: flex; align-items: center; gap: var(--spacer-1); padding: var(--spacer-1) var(--spacer-2); border-bottom: 1px solid var(--divider-stroke); flex-shrink: 0; }
.fp-action-btn { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; background: transparent; border: 1px solid var(--divider-stroke); border-radius: var(--radius-sm); font-size: 10px; color: var(--text-secondary); cursor: pointer; }
.fp-action-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.fp-stats { margin-left: auto; font-size: 9px; color: var(--text-tertiary); }
.file-panel-tree { flex: 0 0 auto; max-height: 40%; overflow-y: auto; border-bottom: 1px solid var(--divider-stroke); padding: var(--spacer-1) 0; }
.file-panel-editor { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.fpe-toolbar { display: flex; align-items: center; gap: var(--spacer-1); padding: 2px var(--spacer-2); background: var(--subtle-secondary); border-bottom: 1px solid var(--divider-stroke); flex-shrink: 0; }
.fpe-title { font-size: 10px; font-weight: 500; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fpe-btn { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; background: transparent; border: 1px solid var(--divider-stroke); border-radius: var(--radius-xs); font-size: 9px; color: var(--text-tertiary); cursor: pointer; }
.fpe-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.fpe-textarea { flex: 1; width: 100%; border: none; outline: none; background: var(--ctrl-fill-default); color: var(--text-primary); font-family: 'Consolas','Monaco',monospace; font-size: 11px; line-height: 1.5; padding: 8px; resize: none; }

.ft-item { display: flex; align-items: center; gap: var(--spacer-1); padding: 3px var(--spacer-2); font-size: 11px; color: var(--text-secondary); cursor: pointer; transition: background var(--fast-duration); white-space: nowrap; }
.ft-item:hover { background: var(--subtle-secondary); }
.ft-item.active { background: var(--accent-bg); color: var(--accent-base); font-weight: 500; }
.ft-dir { color: var(--text-primary); }
.ft-back { color: var(--text-tertiary); font-style: italic; }
.ft-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.ft-size { font-size: 9px; color: var(--text-tertiary); flex-shrink: 0; }
.ft-empty { display: flex; flex-direction: column; align-items: center; gap: var(--spacer-1); padding: var(--spacer-3); color: var(--text-tertiary); font-size: 11px; }

.config-manager { flex: 1; display: flex; flex-direction: column; background: var(--layer-default); min-width: 0; }
.cm-toolbar { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-3); border-bottom: 1px solid var(--divider-stroke); background: var(--subtle-secondary); flex-wrap: wrap; }
.cm-tabs { display: flex; gap: 2px; flex: 1; overflow-x: auto; }
.cm-tab { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--spacer-2); background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-tertiary); cursor: pointer; white-space: nowrap; }
.cm-tab:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.cm-tab.active { background: var(--ctrl-fill-default); border-color: var(--divider-stroke); color: var(--text-primary); font-weight: 500; }
.tab-count { font-size: 10px; padding: 0 4px; border-radius: var(--radius-full); background: var(--subtle-pressed); color: var(--text-tertiary); }
.cm-search { display: flex; align-items: center; gap: 4px; background: var(--ctrl-fill-default); border: 1px solid var(--divider-stroke); border-radius: var(--radius-sm); padding: 4px var(--spacer-2); }
.cm-search input { border: none; outline: none; background: transparent; font-size: var(--font-size-xs); color: var(--text-primary); width: 120px; }
.cm-add { display: inline-flex; align-items: center; gap: 4px; padding: 4px var(--spacer-2); background: var(--accent-base); color: white; border: none; border-radius: var(--radius-sm); font-size: var(--font-size-xs); cursor: pointer; }
.cm-add:hover { background: var(--accent-hover); }
.cm-content { flex: 1; overflow: auto; padding: var(--spacer-3); }
.cm-loading,.cm-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); gap: var(--spacer-2); font-size: var(--font-size-sm); }
.cm-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-xs); }
.cm-table th,.cm-table td { padding: 6px var(--spacer-2); text-align: left; border-bottom: 1px solid var(--divider-stroke); }
.cm-table th { font-weight: 600; color: var(--text-secondary); background: var(--subtle-secondary); position: sticky; top: 0; z-index: 1; }
.th-actions,.td-actions { width: 80px; text-align: right; }
.cell-input { width: 100%; border: 1px solid transparent; background: transparent; padding: 4px 6px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-primary); outline: none; font-family: inherit; }
.cell-input:focus { border-color: var(--accent-base); background: var(--ctrl-fill-default); }
.cell-input:disabled { opacity: 0.6; }
.row-btn { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-tertiary); cursor: pointer; margin-left: 4px; }
.row-btn:hover { background: var(--subtle-secondary); color: var(--accent-base); }
.row-btn.danger:hover { color: var(--status-error); }
.row-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.split-tab.add-tab { padding: var(--spacer-2) var(--spacer-2); border-left: 1px solid var(--divider-stroke); }
.check-icon { margin-left: auto; color: var(--status-success); }
.split-content > * { flex: 1; }

.context-menu-card { position: fixed; min-width: 180px; background: var(--flyout-bg); border: 1px solid var(--flyout-border); border-radius: var(--radius-md); box-shadow: 0 8px 32px rgba(0,0,0,0.18); padding: var(--spacer-1); z-index: 1001; }
.status-item.running { color: var(--status-success); }
.status-item.stopped { color: var(--text-tertiary); }
.status-item.error { color: var(--status-error); }
.status-action-btn { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; background: transparent; border: 1px solid var(--divider-stroke); border-radius: var(--radius-xs); color: var(--text-tertiary); font-size: 10px; cursor: pointer; height: 18px; }
.status-action-btn:hover:not(:disabled) { background: var(--subtle-pressed); color: var(--text-primary); border-color: var(--accent-base); }
.status-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== 考试档案编辑器视图 ===== */
.exam-editor-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  background: var(--app-bg);
}
.exam-editor-topbar {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  height: 40px;
  padding: 0 var(--spacer-3);
  background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}
.exam-editor-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.exam-editor-back:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}
.exam-editor-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.exam-editor-body {
  flex: 1;
  overflow: hidden;
}
.exam-editor-body .plugin-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
.exam-editor-fallback {
  padding: 16px;
  height: 100%;
}
.exam-editor-fallback .fpe-textarea {
  width: 100%;
  height: 100%;
  min-height: 300px;
  background: var(--input-bg);
  color: var(--text-primary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  padding: 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
}

/* Diff 标签栏 */
.editor-tabs-row {
  border-bottom: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
  flex-shrink: 0;
}
.editor-tabs {
  display: flex;
  overflow-x: auto;
  scrollbar-width: thin;
}
.editor-tab {
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
  margin-left: var(--spacer-1);
  margin-top: var(--spacer-1);
  margin-bottom: -1px;
}
.editor-tab:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.editor-tab.active { background: var(--ctrl-fill-default); border-color: var(--divider-stroke); color: var(--text-primary); font-weight: 500; }
.editor-tab .tab-icon { flex-shrink: 0; color: var(--text-tertiary); }
.editor-tab.active .tab-icon { color: var(--accent-base); }
.editor-tab .tab-title { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.editor-tab .tab-close {
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: var(--radius-xs);
  color: var(--text-tertiary); cursor: pointer; flex-shrink: 0;
}
.editor-tab .tab-close:hover { background: var(--subtle-pressed); color: var(--text-primary); }

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
.diff-row.add { background: rgba(16, 124, 16, 0.1); border-bottom-color: rgba(16, 124, 16, 0.15); }
.diff-row.del { background: rgba(196, 43, 28, 0.1); border-bottom-color: rgba(196, 43, 28, 0.15); }
.diff-row.context { background: transparent; }
.diff-row-num {
  width: 44px; min-width: 44px;
  text-align: right; padding: 0 8px;
  color: var(--text-tertiary); font-size: 11px;
  user-select: none; border-right: 1px solid var(--divider-stroke);
  line-height: 22px;
}
.diff-row-sign {
  width: 20px; min-width: 20px;
  text-align: center; font-weight: 700;
  user-select: none; line-height: 22px;
}
.diff-row.add .diff-row-sign { color: var(--status-success); }
.diff-row.del .diff-row-sign { color: var(--status-error); }
.diff-row-text {
  flex: 1; padding: 0 8px;
  white-space: pre; overflow-x: auto;
  color: var(--text-primary); line-height: 22px;
}

/* 版本预览 */
.preview-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
}
.preview-header {
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
.preview-close {
  margin-left: auto;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--text-tertiary); cursor: pointer;
}
.preview-close:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.preview-textarea {
  flex: 1;
  width: 100%;
  padding: 16px;
  background: var(--app-bg);
  color: var(--text-primary);
  border: none;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  tab-size: 4;
}
</style>