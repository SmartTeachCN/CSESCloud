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
        <div class="cloud-section" @contextmenu.prevent="onCloudAreaCtxMenu($event)">
          <div class="cloud-divider">
            <span>{{ sidebarView === 'files' ? '云文件' : '配置实例' }}</span>
            <div class="cloud-divider-line"></div>
            <div class="sidebar-view-switch">
              <button
                class="view-switch-btn"
                :class="{ active: sidebarView === 'files' }"
                title="云文件"
                @click="switchSidebarView('files')"
              >文件</button>
              <button
                class="view-switch-btn"
                :class="{ active: sidebarView === 'instances' }"
                title="配置实例"
                @click="switchSidebarView('instances')"
              >实例</button>
            </div>
            <div class="cloud-plus-menu-wrapper" v-if="sidebarView === 'files'">
              <button class="cloud-plus-btn" @click="showCloudPlusMenu = !showCloudPlusMenu" title="新建 / 上传">
                <Icon icon="ri-add-line" :size="14" />
              </button>
              <div v-if="showCloudPlusMenu" class="cloud-plus-menu" @click.stop>
                <button class="plus-item" @click="startDraft('file'); showCloudPlusMenu = false">
                  <Icon icon="ri-file-add-line" :size="14" />
                  <span>新建文件</span>
                </button>
                <button class="plus-item" @click="startDraft('dir'); showCloudPlusMenu = false">
                  <Icon icon="ri-folder-add-line" :size="14" />
                  <span>新建文件夹</span>
                </button>
                <button class="plus-item" @click="triggerCloudUpload(); showCloudPlusMenu = false">
                  <Icon icon="ri-upload-2-line" :size="14" />
                  <span>上传文件</span>
                </button>
                <button class="plus-item" @click="openTplDialog(); showCloudPlusMenu = false">
                  <Icon icon="ri-magic-line" :size="14" />
                  <span>从模板新建</span>
                </button>
                <div class="plus-divider"></div>
                <button class="plus-item" @click="refreshCloudFiles(); showCloudPlusMenu = false">
                  <Icon icon="ri-refresh-line" :size="14" />
                  <span>刷新</span>
                </button>
              </div>
            </div>
            <button
              v-else
              class="cloud-plus-btn"
              :disabled="overviewLoading"
              title="刷新实例列表"
              @click="loadOverview()"
            >
              <Icon :icon="overviewLoading ? 'ri-loader-4-line' : 'ri-refresh-line'" :size="14" :class="{ spin: overviewLoading }" />
            </button>
          </div>
          <input type="file" ref="cloudUploadInput" @change="handleCloudUpload" hidden />
          <div v-if="!isLoggedIn" class="cloud-login-prompt">
            <div class="login-icon"><Icon icon="ri-cloud-line" :size="36" /></div>
            <div class="login-text">登录以使用云文件</div>
            <button class="login-btn" @click="goLogin">登录</button>
          </div>
          <template v-else-if="sidebarView === 'files'">
            <!-- 当前目录面包屑 -->
            <div class="cloud-breadcrumb">
              <button class="cloud-crumb" :class="{ active: !currentDir }" title="根目录" @click="navigateDir('')">
                <Icon icon="ri-database-2-line" :size="11" />
                <span>根目录</span>
              </button>
              <template v-for="(seg, idx) in dirSegments" :key="'crumb-' + idx">
                <Icon icon="ri-arrow-right-s-line" :size="12" class="cloud-crumb-sep" />
                <button
                  class="cloud-crumb"
                  :class="{ active: idx === dirSegments.length - 1 }"
                  :title="seg"
                  @click="navigateDir(dirPathAt(idx))"
                >{{ seg }}</button>
              </template>
            </div>
            <div class="cloud-file-list" @contextmenu.prevent="onCloudAreaCtxMenu($event)">
              <div v-if="cloudLoading" class="cloud-loading">加载中...</div>
              <!-- 新建草稿行（行内输入，Enter 提交，Esc 取消） -->
              <div v-if="draft" class="cloud-file-item draft" :class="{ directory: draft.kind === 'dir' }">
                <span class="cloud-file-icon"><Icon :icon="draft.kind === 'dir' ? 'ri-folder-3-line' : 'ri-file-2-line'" :size="16" /></span>
                <input
                  ref="draftInputRef"
                  v-model="draft.name"
                  class="cloud-inline-input"
                  :placeholder="draft.kind === 'dir' ? '新建文件夹' : '新建文件.txt'"
                  @keyup.enter="onDraftEnter"
                  @keyup.esc="cancelDraft"
                  @blur="onDraftBlur"
                  @click.stop
                />
                <span class="cloud-file-size draft-hint">{{ draft.kind === 'dir' ? '文件夹' : '文件' }}</span>
              </div>
              <div
                v-for="item in visibleCloudFiles"
                :key="item.id"
                class="cloud-file-item"
                :class="{ active: currentFile?.id === item.id, directory: item.is_directory, 'shared-from-other': item.source === 'shared', renaming: renamingId === item.id }"
                @click="onCloudItemClick(item)"
                @contextmenu.prevent.stop="onCloudItemCtxMenu(item, $event)"
              >
                <span class="cloud-file-icon"><Icon :icon="item.icon" :size="16" /></span>
                <input
                  v-if="renamingId === item.id"
                  v-model="renameValue"
                  class="cloud-inline-input"
                  @keyup.enter="commitInlineRename(item)"
                  @keyup.esc="cancelInlineRename"
                  @blur="onRenameBlur(item)"
                  @click.stop
                />
                <span v-else class="cloud-file-name" :title="item.name">{{ item.name }}</span>
                <template v-if="!item.is_directory">
                  <span
                    v-if="distributedCount(item) > 0"
                    class="cloud-file-dist-badge"
                    :title="'已分发 ' + distributedCount(item) + ' 个配置实例'"
                  >
                    <Icon icon="ri-git-branch-line" :size="9" /> 已分发
                  </span>
                  <span v-if="item.is_shared && item.source !== 'shared'" class="cloud-file-shared-badge" title="已分享">
                    <Icon icon="ri-share-line" :size="10" />
                  </span>
                  <span v-if="item.source === 'shared'" class="cloud-file-shared-from-badge" :title="'来自 ' + item.shared_from + ' 的分享'">
                    <Icon icon="ri-share-forward-line" :size="10" /> 来自分享
                  </span>
                  <span class="cloud-file-size">{{ item.size }}</span>
                </template>
                <span v-else class="cloud-file-size">{{ dirChildCount(item) }} 项</span>
              </div>
              <div v-if="!cloudLoading && visibleCloudFiles.length === 0 && !draft" class="cloud-empty">
                <div class="cloud-empty-title">{{ currentDir ? '此文件夹为空' : '暂无云文件' }}</div>
                <div class="cloud-empty-hint">右键或点「+」新建文件 / 文件夹</div>
              </div>
            </div>
          </template>

          <!-- 配置实例视图（文件 / 实例切换） -->
          <div v-else class="instance-panel">
            <div v-if="overviewLoading && instances.length === 0" class="cloud-loading">加载中...</div>
            <div v-else-if="overviewError && instances.length === 0" class="instance-error">
              <Icon icon="ri-error-warning-line" :size="16" />
              <span class="instance-error-text">{{ overviewError }}</span>
              <button class="instance-retry" @click="loadOverview()">重试</button>
            </div>
            <div v-else-if="instances.length === 0" class="cloud-empty instance-empty">
              <div class="instance-empty-icon"><Icon icon="ri-git-branch-line" :size="28" /></div>
              <div>暂无配置实例</div>
              <div class="instance-empty-hint">在文件上右键 →「分发配置」</div>
            </div>
            <template v-else>
              <div class="instance-list">
                <div v-for="inst in instances" :key="inst.id" class="instance-item">
                  <div class="instance-item-head">
                    <span class="instance-name" :title="inst.name">{{ inst.name }}</span>
                    <span class="instance-format" :class="instanceFormatClass(inst)" :title="'分发类型：' + instanceFormatLabel(inst)">{{ instanceFormatLabel(inst) }}</span>
                    <span
                      class="instance-status"
                      :class="inst.valid ? 'ok' : 'warn'"
                      :title="inst.valid ? '源文件校验正常' : (inst.warning || '源文件异常')"
                    >
                      <Icon :icon="inst.valid ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'" :size="10" />
                      <span>{{ inst.valid ? '正常' : '警告' }}</span>
                    </span>
                  </div>
                  <div class="instance-file" :title="inst.source_file_name || '源文件已删除'">
                    <Icon icon="ri-file-2-line" :size="10" />
                    <span>{{ inst.source_file_name || '源文件已删除' }}</span>
                  </div>
                  <div class="instance-meta">
                    <button
                      class="instance-group"
                      :title="'实例组标识：' + (inst.group_dir_id || '-') + '（点击复制）'"
                      @click.stop="copyInstanceGroupId(inst)"
                    >
                      <Icon :icon="copiedInstanceKey === 'group-' + inst.id ? 'ri-check-line' : 'ri-file-copy-line'" :size="9" />
                      <span>{{ inst.group_dir_id || '-' }}</span>
                    </button>
                    <span class="instance-time">{{ formatInstanceTime(inst.updated_at) }}</span>
                  </div>
                  <div class="instance-actions">
                    <button title="打开源文件" @click.stop="openInstanceSourceFile(inst)">
                      <Icon icon="ri-folder-open-line" :size="13" />
                    </button>
                    <button title="编辑实例" @click.stop="openInstanceEditor(inst)">
                      <Icon icon="ri-edit-line" :size="13" />
                    </button>
                    <button
                      :title="instanceMode(inst) === 'url' ? '复制配置地址' : '复制清单地址'"
                      @click.stop="copyInstanceAddress(inst)"
                    >
                      <Icon :icon="copiedInstanceKey === 'copy-' + inst.id ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                    </button>
                    <button v-if="instanceMode(inst) === 'static'" title="下载 ClassIsland 清单文件" @click.stop="downloadInstanceManifest(inst)">
                      <Icon icon="ri-download-line" :size="13" />
                    </button>
                    <button v-else title="打开配置地址" @click.stop="openInstanceConfigUrl(inst)">
                      <Icon icon="ri-external-link-line" :size="13" />
                    </button>
                    <button class="danger" title="删除实例" @click.stop="deleteInstance(inst)">
                      <Icon icon="ri-delete-bin-line" :size="13" />
                    </button>
                  </div>
                </div>
              </div>
              <div class="instance-refresh-row">
                <button class="instance-refresh-btn" :disabled="overviewLoading" @click="loadOverview()">
                  <Icon :icon="overviewLoading ? 'ri-loader-4-line' : 'ri-refresh-line'" :size="12" :class="{ spin: overviewLoading }" />
                  <span>{{ overviewLoading ? '刷新中...' : '刷新实例列表' }}</span>
                </button>
              </div>
            </template>
          </div>
        </div>

        <!-- 云存储用量 -->
        <div class="sidebar-footer">
          <div class="storage-info" :title="'已用 ' + storageUsed + ' / 配额 ' + storageTotal">
            <div class="storage-label">
              <span>云存储</span>
              <span class="storage-percent">{{ storagePercentText }}</span>
            </div>
            <div class="storage-bar"><div class="storage-fill" :class="{ warning: storagePercent >= 90 }" :style="{ width: storagePercent + '%' }"></div></div>
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
        :editable-title="canRenameCurrentFile"
        :distributed="currentFileDistributed"
        :edit-button-icon="cardEditButtonIcon"
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
        @edit-click="onFileCardActionClick"
        @title-change="onFileCardTitleChange"
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

          <!-- 云文件区域右键菜单（空白 / 文件 / 目录） -->
          <Teleport to="body">
            <div v-if="cloudCtxMenu.visible" class="context-menu-overlay" @click="closeCloudCtxMenu" @contextmenu.prevent="closeCloudCtxMenu">
              <div class="context-menu" :style="{ left: cloudCtxMenu.x + 'px', top: cloudCtxMenu.y + 'px' }" @contextmenu.prevent.stop>
                <template v-if="cloudCtxMenu.type === 'blank'">
                  <button class="ctx-item" @click="startDraft('file'); closeCloudCtxMenu()">
                    <Icon icon="ri-file-add-line" :size="14" /> 新建文件
                  </button>
                  <button class="ctx-item" @click="startDraft('dir'); closeCloudCtxMenu()">
                    <Icon icon="ri-folder-add-line" :size="14" /> 新建文件夹
                  </button>
                  <div class="ctx-divider"></div>
                  <button class="ctx-item" @click="triggerCloudUpload(); closeCloudCtxMenu()">
                    <Icon icon="ri-upload-2-line" :size="14" /> 上传文件
                  </button>
                  <button class="ctx-item" @click="refreshCloudFiles(); closeCloudCtxMenu()">
                    <Icon icon="ri-refresh-line" :size="14" /> 刷新
                  </button>
                </template>
                <template v-else-if="cloudCtxMenu.file && cloudCtxMenu.file.is_directory">
                  <button class="ctx-item" @click="enterDirectory(cloudCtxMenu.file!); closeCloudCtxMenu()">
                    <Icon icon="ri-folder-open-line" :size="14" /> 打开
                  </button>
                  <div class="ctx-divider"></div>
                  <button class="ctx-item" @click="startInlineRename(cloudCtxMenu.file!); closeCloudCtxMenu()">
                    <Icon icon="ri-edit-line" :size="14" /> 重命名
                  </button>
                  <button class="ctx-item danger" @click="deleteCloudItem(cloudCtxMenu.file!); closeCloudCtxMenu()">
                    <Icon icon="ri-delete-bin-line" :size="14" /> 删除
                  </button>
                </template>
                <template v-else-if="cloudCtxMenu.file">
                  <button class="ctx-item" @click="openCloudFile(cloudCtxMenu.file!); closeCloudCtxMenu()">
                    <Icon icon="ri-folder-open-line" :size="14" /> 打开
                  </button>
                  <button class="ctx-item" @click="openFileProperties(cloudCtxMenu.file!); closeCloudCtxMenu()">
                    <Icon icon="ri-information-line" :size="14" /> 属性
                  </button>
                  <button
                    class="ctx-item"
                    v-if="isDistributable(cloudCtxMenu.file)"
                    @click="openFileDistribution(cloudCtxMenu.file!); closeCloudCtxMenu()"
                  >
                    <Icon icon="ri-git-branch-line" :size="14" /> 分发配置
                  </button>
                  <button
                    class="ctx-item"
                    v-if="cloudCtxMenu.file.source !== 'shared'"
                    @click="handleShareCloudFile(cloudCtxMenu.file!); closeCloudCtxMenu()"
                  >
                    <Icon icon="ri-share-forward-line" :size="14" /> 分享
                  </button>
                  <button class="ctx-item" @click="downloadCloudFile(cloudCtxMenu.file!); closeCloudCtxMenu()">
                    <Icon icon="ri-download-line" :size="14" /> 下载
                  </button>
                  <div class="ctx-divider"></div>
                  <button
                    class="ctx-item"
                    v-if="cloudCtxMenu.file.source !== 'shared'"
                    @click="startInlineRename(cloudCtxMenu.file!); closeCloudCtxMenu()"
                  >
                    <Icon icon="ri-edit-line" :size="14" /> 重命名
                  </button>
                  <button
                    class="ctx-item danger"
                    v-if="cloudCtxMenu.file.source !== 'shared'"
                    @click="deleteCloudItem(cloudCtxMenu.file!); closeCloudCtxMenu()"
                  >
                    <Icon icon="ri-delete-bin-line" :size="14" /> 删除
                  </button>
                </template>
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

  <!-- 从模板新建对话框（选择插件后释放其示例文件） -->
  <Teleport to="body">
    <div v-if="showTplDialog" class="dialog-overlay" @click.self="showTplDialog = false">
      <div class="dialog-card">
        <h3>从模板新建</h3>
        <div class="tpl-tip">选择一个提供示例文件的编辑器插件，其示例文件将释放到你的云文件。</div>
        <div v-if="tplLoading" class="tpl-state">加载中...</div>
        <div v-else-if="tplPlugins.length === 0" class="tpl-state">暂无提供示例文件的编辑器插件</div>
        <div v-else class="tpl-plugin-list">
          <button
            v-for="p in tplPlugins"
            :key="p.plugin_key"
            class="tpl-plugin-item"
            :disabled="tplReleasing"
            @click="releasePluginSamples(p)"
          >
            <AppIcon :icon="p.icon" :plugin-key="p.plugin_key" :size="28" fallback="ri-plug-line" />
            <span class="tpl-plugin-info">
              <span class="tpl-plugin-name">{{ p.name }}</span>
              <span class="tpl-plugin-desc">{{ p.description }}</span>
            </span>
            <span v-if="tplReleasingKey === p.plugin_key" class="tpl-releasing">释放中…</span>
            <Icon v-else icon="ri-arrow-right-s-line" :size="16" />
          </button>
        </div>
        <div class="dialog-actions">
          <button class="secondary-btn" @click="showTplDialog = false">取消</button>
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

  <!-- 文件属性对话框（属性 / 分发配置 Tab） -->
  <FilePropertiesDialog
    :visible="showPropertiesDialog"
    :info="propertiesInfo"
    :initial-tab="propertiesTab"
    :distribution-file="propertiesDistributionFile"
    :overview="distributionOverview"
    :can-distribute="!!propertiesDistributionFile"
    @close="showPropertiesDialog = false"
    @saved="onDistributionSaved"
  />

  <!-- 配置实例编辑对话框（实例视图 → 编辑） -->
  <InstanceManagerDialog
    :visible="showInstanceDialog"
    :instance="editingInstance"
    :group-dir-id="groupDirId"
    :cloud-files="ownedCloudFiles"
    @close="showInstanceDialog = false"
    @saved="onInstanceSaved"
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
import FilePropertiesDialog from '../../components/editor/FilePropertiesDialog.vue';
import InstanceManagerDialog from '../../components/editor/InstanceManagerDialog.vue';
import { pluginApi, distributionsApi } from '../../api';
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
const storageTotal = ref('0 B');
const storagePercent = ref(0);
const storagePercentText = computed(() => `${Math.round(storagePercent.value * 10) / 10}%`);

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
  /** 云端文件编辑者（后端 owner）/ 本地文件为“本地文件” */
  owner?: string;
  /** 云端文件完整路径或本地文件名 */
  path?: string;
  createdAt?: string;
  updatedAt?: string;
  isShared?: number;
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
  /** 是否目录（后端 is_directory=1） */
  is_directory: boolean;
  /** 相对 /.cloud/ 的父目录（''=根目录；shared 文件为 ''） */
  parent_dir: string;
  file_path: string;
  file_type: string;
  file_size_raw: number;
  content_type?: string;
  owner: string;
  owner_username: string;
  created_at?: string;
  updated_at?: string;
}

/** 文件属性对话框数据（属性页） */
interface FilePropertyInfo {
  name: string;
  typeLabel: string;
  size: string;
  sourceLabel: string;
  owner: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  sharedLabel: string;
  distributedCount: number;
}

/** 配置实例 DTO（对应 spec 3.4 的 InstanceDTO，接口未就绪时字段可缺失） */
interface DistributionInstance {
  id: number;
  instance_uid?: string;
  name: string;
  app_key?: string;
  format?: string;
  format_label?: string;
  format_mode?: string;
  source_file_id?: number;
  source_file_name?: string;
  source_file_type?: string;
  source_updated_at?: string;
  group_id?: number;
  group_dir_id?: string;
  organization_name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  version?: number;
  urls?: { kind?: string; manifest?: string; file_template?: string; source?: string };
  valid?: boolean;
  warning?: string;
}

/** 分发模式：static=静态集控（ClassIsland 清单），url=公开配置地址（CSES / ExamAware） */
type DistributionMode = 'static' | 'url';

/** GET /distributions?action=overview 的返回结构 */
interface DistributionOverview {
  group?: { id?: number; dir_id?: string; name?: string } | null;
  base_url?: string;
  manifest_url?: string;
  file_url_template?: string;
  instances?: DistributionInstance[];
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

// ===== 当前目录（相对 /.cloud/，'' = 根目录） =====
const currentDir = ref('');
const dirSegments = computed(() => (currentDir.value ? currentDir.value.split('/') : []));

/** 云文件/目录名规则（与后端一致）：允许中文/空格，禁止路径分隔符与控制字符 */
function isValidCloudName(raw: string): boolean {
  const value = (raw || '').trim();
  if (value === '' || value === '.' || value === '..') return false;
  if (new TextEncoder().encode(value).length > 180) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\/\\:*?"<>|\u0000-\u001f]/.test(value);
}

function dirPathAt(index: number): string {
  return dirSegments.value.slice(0, index + 1).join('/');
}

function dirRelativePath(dir: CloudFile): string {
  const parent = dir.parent_dir || '';
  return parent ? `${parent}/${dir.name}` : dir.name;
}

function dirChildCount(dir: CloudFile): number {
  const rel = dirRelativePath(dir);
  return cloudFiles.value.filter((f) => (f.parent_dir || '') === rel).length;
}

function navigateDir(dir: string) {
  if (!isLoggedIn.value) return;
  cancelDraft();
  cancelInlineRename();
  currentDir.value = dir;
}

function enterDirectory(dir: CloudFile) {
  navigateDir(dirRelativePath(dir));
}

/** 当前目录的直接子项：目录优先 + 名称排序；分享文件仅出现在根目录 */
const visibleCloudFiles = computed<CloudFile[]>(() => {
  const dir = currentDir.value;
  const items = cloudFiles.value.filter((f) => {
    if (f.source === 'shared') return dir === '';
    return (f.parent_dir || '') === dir;
  });
  return [...items].sort((a, b) => {
    if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
});

function onCloudItemClick(item: CloudFile) {
  if (item.is_directory) enterDirectory(item);
  else openCloudFile(item);
}

/** 同步已打开标签的名称/扩展名（currentFile 与 tab 为同一对象） */
function updateOpenTabName(id: string, name: string) {
  const tab = openTabs.value.find((t) => t.id === id);
  if (!tab) return;
  tab.name = name;
  tab.ext = name.split('.').pop()?.toLowerCase() || '';
}

// ===== 行内新建（draft 行） =====
const draft = ref<{ kind: 'file' | 'dir'; name: string } | null>(null);
const draftInputRef = ref<HTMLInputElement | null>(null);
let draftBusy = false;

function focusDraftInput() {
  requestAnimationFrame(() => {
    draftInputRef.value?.focus();
    draftInputRef.value?.select();
  });
}

function startDraft(kind: 'file' | 'dir') {
  if (!isLoggedIn.value) {
    alert('请先登录后再新建');
    return;
  }
  showCloudPlusMenu.value = false;
  closeCloudCtxMenu();
  cancelInlineRename();
  draft.value = { kind, name: kind === 'dir' ? '新建文件夹' : '新建文件.txt' };
  focusDraftInput();
}

function cancelDraft() {
  draft.value = null;
}

async function submitDraft(): Promise<boolean> {
  if (draftBusy) return false;
  const current = draft.value;
  if (!current) return true;
  const name = current.name.trim();
  if (!name) return false;
  if (!isValidCloudName(name)) {
    alert('名称不能包含 / \\ : * ? " < > | 等字符，且不能为空，请修改后重试');
    return false;
  }
  draftBusy = true;
  try {
    if (current.kind === 'dir') {
      await api.post('/cloud-files?action=create-dir', { name, dir: currentDir.value });
    } else {
      const ext = name.split('.').pop() || 'txt';
      await cloudApi.create({ name, content: '', file_type: ext, dir: currentDir.value });
    }
    draft.value = null;
    await loadCloudFiles();
    return true;
  } catch (e: any) {
    alert('新建失败：' + (e?.message || '未知错误'));
    return false;
  } finally {
    draftBusy = false;
  }
}

async function onDraftEnter() {
  const ok = await submitDraft();
  if (!ok && draft.value) focusDraftInput();
}

async function onDraftBlur() {
  if (!draft.value) return;
  // 空名称视为取消；其余情况失焦提交，失败时重新聚焦继续编辑
  if (!draft.value.name.trim()) {
    cancelDraft();
    return;
  }
  const ok = await submitDraft();
  if (!ok && draft.value) focusDraftInput();
}

// ===== 行内重命名 =====
const renamingId = ref<string | null>(null);
const renameValue = ref('');
let renameBusy = false;

/** v-for 内不能使用普通 ref，聚焦通过 class 查询当前行内输入框 */
function focusRenameInput() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.cloud-file-item.renaming .cloud-inline-input');
    input?.focus();
    input?.select();
  });
}

function startInlineRename(item: CloudFile) {
  if (item.source === 'shared' || draft.value) return;
  renamingId.value = item.id;
  renameValue.value = item.name;
  focusRenameInput();
}

function cancelInlineRename() {
  renamingId.value = null;
  renameValue.value = '';
}

function isNameConflict(item: CloudFile, name: string): boolean {
  const dir = item.parent_dir || '';
  return cloudFiles.value.some(
    (f) => f.id !== item.id && f.name === name && (f.parent_dir || '') === dir
  );
}

async function commitInlineRename(item: CloudFile) {
  if (renameBusy || renamingId.value !== item.id) return;
  const newName = renameValue.value.trim();
  if (!newName) {
    cancelInlineRename();
    return;
  }
  if (!isValidCloudName(newName)) {
    alert('名称不能包含 / \\ : * ? " < > | 等字符，且不能为空，请修改后重试');
    focusRenameInput();
    return;
  }
  if (newName === item.name) {
    cancelInlineRename();
    return;
  }
  if (isNameConflict(item, newName)) {
    alert('当前目录已存在同名' + (item.is_directory ? '文件夹' : '文件'));
    focusRenameInput();
    return;
  }
  renameBusy = true;
  try {
    await cloudApi.rename({ id: Number(item.id), name: newName });
    updateOpenTabName(item.id, newName);
    if (item.is_directory) {
      // 目录改名后同步已打开标签的文件路径（供属性/递归删除等使用）
      const oldPath = item.file_path || '';
      const oldPrefix = oldPath.replace(/\/+$/, '') + '/';
      const newDirPath = oldPath.slice(0, oldPath.length - item.name.length) + newName;
      const newPrefix = newDirPath.replace(/\/+$/, '') + '/';
      for (const tab of openTabs.value) {
        if (tab.path && tab.path.startsWith(oldPrefix)) {
          tab.path = newPrefix + tab.path.slice(oldPrefix.length);
        }
      }
    }
    cancelInlineRename();
    await loadCloudFiles();
    // 源文件改名后同步刷新实例列表中展示的源文件名
    if (!item.is_directory) loadOverview(true);
  } catch (e: any) {
    alert('重命名失败：' + (e?.message || '未知错误'));
    cancelInlineRename();
  } finally {
    renameBusy = false;
  }
}

function onRenameBlur(item: CloudFile) {
  if (renamingId.value === item.id) void commitInlineRename(item);
}

// ===== 云文件区域右键菜单（空白 / 文件 / 目录） =====
type CloudCtxTarget = 'blank' | 'file' | 'dir';

const cloudCtxMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  type: CloudCtxTarget;
  file: CloudFile | null;
}>({ visible: false, x: 0, y: 0, type: 'blank', file: null });

function openCloudCtxMenu(type: CloudCtxTarget, file: CloudFile | null, e: MouseEvent) {
  cloudCtxMenu.value = { visible: true, x: e.clientX, y: e.clientY, type, file };
}

function onCloudItemCtxMenu(item: CloudFile, e: MouseEvent) {
  openCloudCtxMenu(item.is_directory ? 'dir' : 'file', item, e);
}

function onCloudAreaCtxMenu(e: MouseEvent) {
  if (sidebarView.value !== 'files' || draft.value) return;
  const target = e.target as HTMLElement | null;
  // 仅空白区域触发（行/按钮/面包屑/菜单各自处理或忽略）
  if (target?.closest('button, input, .cloud-file-item, .cloud-breadcrumb, .cloud-plus-menu, .context-menu')) return;
  openCloudCtxMenu('blank', null, e);
}

function closeCloudCtxMenu() {
  cloudCtxMenu.value.visible = false;
}

// ===== 云文件 API 封装 =====
const cloudApi = {
  list: () => api.get<any[]>('/cloud-files?action=list'),
  get: (id: number) => api.get<any>(`/cloud-files?action=get&id=${id}`),
  create: (body: any) => api.post('/cloud-files?action=create', body),
  update: (body: any) => api.post('/cloud-files?action=update', body),
  rename: (body: { id: number; name: string }) => api.post('/cloud-files?action=rename', body),
  delete: (id: number) => api.post('/cloud-files?action=delete', { id }),
  usage: () => api.get<any>('/cloud-files?action=usage'),
};

async function loadCloudFiles() {
  if (!isLoggedIn.value) return;
  cloudLoading.value = true;
  try {
    const data = await cloudApi.list();
    cloudFiles.value = (data || []).map((f: any) => {
      const isDirectory = Number(f.is_directory) === 1 || f.file_type === 'dir';
      const fileType = f.file_type || (isDirectory ? 'dir' : '');
      return {
        id: String(f.id),
        name: f.name,
        icon: isDirectory ? 'ri-folder-3-line' : (iconMap[fileType] || 'ri-file-2-line'),
        size: isDirectory ? '' : formatFileSize(f.file_size || 0),
        url: '#',
        file_type: fileType,
        is_directory: isDirectory,
        parent_dir: typeof f.parent_dir === 'string' ? f.parent_dir : '',
        file_path: f.file_path || '',
        file_size_raw: Number(f.file_size) || 0,
        content_type: f.content_type || '',
        owner: f.owner || f.shared_from || '',
        owner_username: f.owner_username || f.owner || f.shared_from || '',
        created_at: f.created_at || '',
        updated_at: f.updated_at || '',
        is_shared: f.is_shared || 0,
        source: f.source || 'owned',
        shared_from: f.shared_from || '',
        shared_permission: f.shared_permission || '',
      } as CloudFile;
    });
    // 当前目录若已不存在（被删除/改名），回到根目录
    if (currentDir.value && !cloudFiles.value.some((f) => f.is_directory && dirRelativePath(f) === currentDir.value)) {
      currentDir.value = '';
    }
    void loadUsage();
  } catch {
    cloudFiles.value = [];
  } finally {
    cloudLoading.value = false;
  }
}

/** 加载云存储用量：used/quota/percent（字节） */
async function loadUsage() {
  if (!isLoggedIn.value) return;
  try {
    const data = await cloudApi.usage();
    const used = Number(data?.used) || 0;
    const quota = Number(data?.quota) || 0;
    const percent = Number(data?.percent);
    storageUsed.value = formatStorageSize(used);
    storageTotal.value = formatStorageSize(quota);
    storagePercent.value = Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : (quota > 0 ? Math.min(100, (used / quota) * 100) : 0);
  } catch {
    /* 静默失败：保留上次用量 */
  }
}

function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const digits = index === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function refreshCloudFiles() {
  loadCloudFiles();
  // 同步刷新实例徽标（失败静默）
  if (isLoggedIn.value) loadOverview(true);
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ===== 从模板新建（选择插件后释放其示例文件到云文件） =====
const showTplDialog = ref(false);
const tplLoading = ref(false);
const tplReleasing = ref(false);
const tplReleasingKey = ref('');
const tplPlugins = ref<any[]>([]);

async function openTplDialog() {
  if (!isLoggedIn.value) {
    alert('请先登录后再使用「从模板新建」');
    return;
  }
  showTplDialog.value = true;
  tplLoading.value = true;
  try {
    const published = await pluginApi.published();
    tplPlugins.value = (published || []).filter(p => p.has_samples);
  } catch (e) {
    console.error('加载插件列表失败', e);
    tplPlugins.value = [];
  } finally {
    tplLoading.value = false;
  }
}

/** 云文件名仅允许字母/数字/下划线/连字符/点，且不能与已有文件重名 */
function uniqueCloudName(rawName: string, existing: Set<string>): string {
  const raw = (rawName || 'sample.txt').trim().replace(/^\/+/, '');
  const dot = raw.lastIndexOf('.');
  const ext = (dot > 0 ? raw.slice(dot + 1) : '').replace(/[^a-zA-Z0-9]/g, '') || 'txt';
  let base = dot > 0 ? raw.slice(0, dot) : raw;
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(base)) base = 'sample-' + base.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!base) base = 'sample';
  let candidate = `${base}.${ext}`;
  let i = 1;
  while (existing.has(candidate)) {
    candidate = `${base}-${i}.${ext}`;
    i++;
  }
  return candidate;
}

async function releasePluginSamples(plugin: any) {
  if (tplReleasing.value) return;
  tplReleasing.value = true;
  tplReleasingKey.value = plugin.plugin_key;
  try {
    const data = await pluginApi.samples(plugin.plugin_key);
    const files = (data && data.files) || [];
    if (files.length === 0) {
      alert(`插件「${plugin.name}」没有可用的示例文件`);
      return;
    }
    const existing = new Set(
      visibleCloudFiles.value.filter((f) => !f.is_directory).map((f) => f.name)
    );
    const created: string[] = [];
    for (const f of files) {
      const name = uniqueCloudName(f.name, existing);
      existing.add(name);
      const ext = name.includes('.') ? name.split('.').pop()! : 'txt';
      await cloudApi.create({ name, content: f.content || '', file_type: ext, dir: currentDir.value });
      created.push(name);
    }
    showTplDialog.value = false;
    await loadCloudFiles();
    // 释放后打开第一个示例文件（当前目录内）
    const first = cloudFiles.value.find(
      (f) => f.name === created[0] && !f.is_directory && (f.parent_dir || '') === currentDir.value
    );
    if (first) await openCloudFile(first);
    alert(`已从「${plugin.name}」释放 ${created.length} 个示例文件：\n${created.join('\n')}`);
  } catch (e: any) {
    console.error('释放示例文件失败', e);
    alert('释放示例文件失败：' + (e?.message || '未知错误'));
  } finally {
    tplReleasing.value = false;
    tplReleasingKey.value = '';
  }
}

function triggerCloudUpload() {
  cloudUploadInput.value?.click();
}

function handleCloudUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  // 上传到当前目录
  const uploadDir = currentDir.value;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target?.result as string;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    try {
      await cloudApi.create({ name: file.name, content, file_type: ext, dir: uploadDir });
      await loadCloudFiles();
    } catch (err: any) {
      alert('上传失败：' + (err?.message || '未知错误'));
    }
  };
  reader.readAsText(file);
  target.value = '';
}

/** 删除云文件 / 目录（目录递归删除） */
async function deleteCloudItem(item: CloudFile) {
  const isDir = item.is_directory;
  const message = isDir
    ? `确定删除文件夹「${item.name}」及其全部内容吗？此操作不可恢复。`
    : `确定删除云文件「${item.name}」吗？`;
  if (!confirm(message)) return;
  try {
    await cloudApi.delete(Number(item.id));
    if (isDir) {
      // 关闭被删除目录下的已打开标签
      const dirPrefix = (item.file_path || '').replace(/\/+$/, '') + '/';
      if (dirPrefix !== '/') {
        const toClose = openTabs.value.filter((t) => t.path && t.path.startsWith(dirPrefix));
        toClose.forEach((t) => closeTab(t));
      }
    } else if (currentFile.value?.id === item.id) {
      closeTab(currentFile.value);
    }
    await loadCloudFiles();
    // 源文件删除后实例可能变为警告状态，静默刷新实例列表
    loadOverview(true);
  } catch (e: any) {
    alert('删除失败：' + (e?.message || '未知错误'));
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

function handleShareCloudFile(file: CloudFile) {
  // Open the file first, then share
  openCloudFile(file).then(() => {
    showShareDialog.value = true;
  });
}

// ===== 配置实例（分发配置） =====
const sidebarView = ref<'files' | 'instances'>('files');
const distributionOverview = ref<DistributionOverview | null>(null);
const distributionOverviewLoaded = ref(false);
const overviewLoading = ref(false);
const overviewError = ref('');
// 文件属性 / 分发配置对话框
const showPropertiesDialog = ref(false);
const propertiesTab = ref<'props' | 'distribution'>('props');
const propertiesInfo = ref<FilePropertyInfo | null>(null);
const propertiesDistributionFile = ref<CloudFile | null>(null);
const showInstanceDialog = ref(false);
const editingInstance = ref<DistributionInstance | null>(null);
const copiedInstanceKey = ref('');
let copiedInstanceTimer: ReturnType<typeof setTimeout> | null = null;

const groupDirId = computed(() => distributionOverview.value?.group?.dir_id || '');

/** 实例列表（按更新时间倒序，缺失字段时降级） */
const instances = computed<DistributionInstance[]>(() => {
  const list = distributionOverview.value?.instances || [];
  return [...list].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
});

/** 每个云文件已分发的配置实例数量（用于文件列表徽标） */
const distributedCounts = computed<Map<number, number>>(() => {
  const map = new Map<number, number>();
  const list = distributionOverview.value?.instances || [];
  for (const inst of list) {
    const fileId = Number(inst.source_file_id);
    if (!Number.isFinite(fileId)) continue;
    map.set(fileId, (map.get(fileId) || 0) + 1);
  }
  return map;
});

/** 可用作分发源文件的云文件（仅自己拥有的文件，排除目录与分享文件） */
const ownedCloudFiles = computed(() => {
  return cloudFiles.value
    .filter((f) => f.source !== 'shared' && !f.is_directory)
    .map((f) => ({ id: f.id, name: f.name }));
});

function distributedCount(file: CloudFile): number {
  return distributedCounts.value.get(Number(file.id)) || 0;
}

function normalizeInstance(raw: any): DistributionInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;
  const sourceFileId = Number(raw.source_file_id);
  const urls = raw.urls && typeof raw.urls === 'object'
    ? {
        kind: typeof raw.urls.kind === 'string' ? raw.urls.kind : '',
        manifest: typeof raw.urls.manifest === 'string' ? raw.urls.manifest : '',
        file_template: typeof raw.urls.file_template === 'string' ? raw.urls.file_template : '',
        source: typeof raw.urls.source === 'string' ? raw.urls.source : '',
      }
    : undefined;
  return {
    id,
    instance_uid: typeof raw.instance_uid === 'string' ? raw.instance_uid : '',
    name: String(raw.name ?? ''),
    app_key: typeof raw.app_key === 'string' ? raw.app_key : '',
    format: typeof raw.format === 'string' ? raw.format : '',
    format_label: typeof raw.format_label === 'string' ? raw.format_label : '',
    format_mode: typeof raw.format_mode === 'string' ? raw.format_mode : '',
    source_file_id: Number.isFinite(sourceFileId) ? sourceFileId : undefined,
    source_file_name: typeof raw.source_file_name === 'string' ? raw.source_file_name : '',
    source_file_type: typeof raw.source_file_type === 'string' ? raw.source_file_type : '',
    source_updated_at: typeof raw.source_updated_at === 'string' ? raw.source_updated_at : '',
    group_id: typeof raw.group_id === 'number' ? raw.group_id : undefined,
    group_dir_id: typeof raw.group_dir_id === 'string' ? raw.group_dir_id : '',
    organization_name: typeof raw.organization_name === 'string' ? raw.organization_name : '',
    status: typeof raw.status === 'string' ? raw.status : '',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    version: typeof raw.version === 'number' ? raw.version : undefined,
    urls,
    // 接口缺失 valid 字段时按“正常”处理，避免误报警告
    valid: raw.valid !== false,
    warning: typeof raw.warning === 'string' ? raw.warning : '',
  };
}

function normalizeOverview(raw: any): DistributionOverview {
  const rawInstances = Array.isArray(raw?.instances) ? raw.instances : [];
  const normalized = rawInstances
    .map(normalizeInstance)
    .filter((item: DistributionInstance | null): item is DistributionInstance => !!item);
  return {
    group: raw?.group && typeof raw.group === 'object' ? raw.group : null,
    base_url: typeof raw?.base_url === 'string' ? raw.base_url : '',
    manifest_url: typeof raw?.manifest_url === 'string' ? raw.manifest_url : '',
    file_url_template: typeof raw?.file_url_template === 'string' ? raw.file_url_template : '',
    instances: normalized,
  };
}

/** 加载实例总览；silent=true 时用于后台刷新（失败不打断当前列表） */
async function loadOverview(silent = false) {
  if (!isLoggedIn.value) return;
  overviewLoading.value = true;
  if (!silent) overviewError.value = '';
  try {
    const data = await distributionsApi.overview();
    distributionOverview.value = normalizeOverview(data);
    distributionOverviewLoaded.value = true;
    overviewError.value = '';
  } catch (e: any) {
    distributionOverviewLoaded.value = true;
    if (!silent || !distributionOverview.value) {
      overviewError.value = e?.message || '配置实例加载失败，请稍后重试';
    }
  } finally {
    overviewLoading.value = false;
  }
}

function switchSidebarView(view: 'files' | 'instances') {
  sidebarView.value = view;
  if (view !== 'files') {
    cancelDraft();
    cancelInlineRename();
    showCloudPlusMenu.value = false;
  }
  if (view === 'instances' && (!distributionOverviewLoaded.value || overviewError.value)) {
    loadOverview();
  }
}

function setCopiedInstanceKey(key: string) {
  copiedInstanceKey.value = key;
  if (copiedInstanceTimer) clearTimeout(copiedInstanceTimer);
  copiedInstanceTimer = setTimeout(() => {
    if (copiedInstanceKey.value === key) copiedInstanceKey.value = '';
  }, 2000);
}

async function copyInstanceGroupId(inst: DistributionInstance) {
  const dirId = inst.group_dir_id || groupDirId.value;
  if (!dirId) return;
  try {
    await navigator.clipboard.writeText(dirId);
    setCopiedInstanceKey(`group-${inst.id}`);
  } catch {
    alert('复制失败，请手动复制实例组标识：' + dirId);
  }
}

function formatInstanceTime(value?: string): string {
  if (!value) return '未知';
  const text = String(value);
  return text.length > 16 ? text.slice(0, 16) : text;
}

// ===== 文件属性 / 分发配置对话框 =====
function cloudFileById(id: string): CloudFile | undefined {
  return cloudFiles.value.find((f) => f.id === id);
}

function isDistributable(file: CloudFile | null): boolean {
  return !!file && file.source === 'owned' && !file.is_directory;
}

function buildCloudFileInfo(file: CloudFile): FilePropertyInfo {
  const sourceLabel = file.source === 'shared'
    ? `来自分享${file.shared_from ? '（' + file.shared_from + '）' : ''}`
    : '云端文件';
  const sharedLabel = file.source === 'shared'
    ? '来自分享'
    : (file.is_shared ? '已分享' : '未分享');
  return {
    name: file.name,
    typeLabel: file.is_directory ? '文件夹' : (file.file_type ? file.file_type.toUpperCase() : '文件'),
    size: file.is_directory ? '—' : file.size,
    sourceLabel,
    owner: file.owner || file.owner_username || '—',
    path: file.file_path || '—',
    createdAt: file.created_at || '—',
    updatedAt: file.updated_at || '—',
    sharedLabel,
    distributedCount: file.is_directory ? 0 : distributedCount(file),
  };
}

function buildCurrentFileInfo(): FilePropertyInfo | null {
  const file = currentFile.value;
  if (!file) return null;
  const cloud = cloudFileById(file.id);
  if (cloud) return buildCloudFileInfo(cloud);
  return {
    name: file.name,
    typeLabel: currentFileType.value,
    size: file.size,
    sourceLabel: file.source === 'local' ? '本地文件' : (file.source === 'shared' ? '来自分享' : '云端文件'),
    owner: file.source === 'local' ? '本地文件' : (file.owner || '—'),
    path: file.path || file.name,
    createdAt: file.createdAt || '—',
    updatedAt: file.updatedAt || file.modified || '—',
    sharedLabel: file.source === 'shared' ? '来自分享' : '未分享',
    distributedCount: 0,
  };
}

function distributionFileForCurrent(): CloudFile | null {
  const file = currentFile.value;
  if (!file || file.source !== 'cloud') return null;
  const cloud = cloudFileById(file.id);
  return cloud && isDistributable(cloud) ? cloud : null;
}

/** 打开属性窗口（默认属性 Tab） */
function openFileProperties(file?: CloudFile) {
  const info = file ? buildCloudFileInfo(file) : buildCurrentFileInfo();
  if (!info) {
    openLocalFile();
    return;
  }
  propertiesInfo.value = info;
  // 分发配置 Tab 只对“正在查看的这个 own 文件”（或当前 own 文件）开放
  propertiesDistributionFile.value = file
    ? (isDistributable(file) ? file : null)
    : distributionFileForCurrent();
  propertiesTab.value = 'props';
  showPropertiesDialog.value = true;
  // 有分发能力时不阻塞地刷新实例总览（供分发 Tab 的同名判断/组信息）
  if (propertiesDistributionFile.value) {
    void loadOverview(true);
  }
}

/** 右键“分发配置”：打开属性窗口并定位到分发配置 Tab */
async function openFileDistribution(file: CloudFile) {
  if (!isDistributable(file)) {
    alert('仅自己拥有的云端文件可以配置分发');
    return;
  }
  propertiesInfo.value = buildCloudFileInfo(file);
  propertiesDistributionFile.value = file;
  propertiesTab.value = 'distribution';
  showPropertiesDialog.value = true;
  const hadOverview = !!distributionOverview.value;
  if (!hadOverview) {
    await loadOverview(true);
  } else {
    // 后台静默刷新，确保“同名实例 → 更新”的判断最新
    void loadOverview(true);
  }
}

/** Ribbon 文件卡片「属性」按钮 */
function onFileCardActionClick() {
  if (currentFile.value) openFileProperties();
  else openLocalFile();
}

async function onDistributionSaved() {
  await Promise.all([loadOverview(true), loadCloudFiles()]);
  // 属性页“分发实例数”同步刷新
  if (showPropertiesDialog.value && propertiesDistributionFile.value) {
    const cloud = cloudFileById(propertiesDistributionFile.value.id);
    if (cloud) propertiesInfo.value = buildCloudFileInfo(cloud);
  }
}

async function openInstanceSourceFile(inst: DistributionInstance) {
  const fileId = Number(inst.source_file_id);
  const target = cloudFiles.value.find(
    (f) => Number(f.id) === fileId && f.source !== 'shared' && !f.is_directory
  );
  if (!target) {
    alert('源文件不在当前云文件列表中，可能已被删除或尚未加载，请刷新后重试');
    return;
  }
  await openCloudFile(target);
}

function openInstanceEditor(inst: DistributionInstance) {
  editingInstance.value = inst;
  showInstanceDialog.value = true;
}

async function onInstanceSaved() {
  await Promise.all([loadOverview(true), loadCloudFiles()]);
}

function normalizeMode(value: unknown): DistributionMode {
  return String(value || '') === 'url' ? 'url' : 'static';
}

/** 实例分发模式：新契约 urls.kind / format_mode，缺失时按 static 降级 */
function instanceMode(inst: DistributionInstance): DistributionMode {
  return normalizeMode(inst.urls?.kind || inst.format_mode);
}

/** 由 format / app_key 推导格式标识（旧 DTO 只有 app_key） */
function instanceFormat(inst: DistributionInstance): string {
  if (inst.format) return inst.format;
  if (inst.app_key === 'cses_config') return 'cses';
  if (inst.app_key === 'examaware') return 'examaware';
  return 'classisland';
}

/** 侧栏徽标使用短格式名（ClassIsland / CSES / ExamAware） */
function instanceFormatLabel(inst: DistributionInstance): string {
  switch (instanceFormat(inst)) {
    case 'classisland': return 'ClassIsland';
    case 'cses': return 'CSES';
    case 'examaware': return 'ExamAware';
    default: return inst.format_label?.trim() || '配置';
  }
}

function instanceFormatClass(inst: DistributionInstance): string {
  const format = instanceFormat(inst);
  return format === 'classisland' || format === 'cses' || format === 'examaware'
    ? `fmt-${format}`
    : 'fmt-unknown';
}

/** 实例对外地址：静态集控=清单地址，URL 模式=公开配置地址 */
function instanceAddress(inst: DistributionInstance): string {
  if (instanceMode(inst) === 'url') return inst.urls?.source || '';
  return inst.urls?.manifest || distributionOverview.value?.manifest_url || '';
}

async function copyInstanceAddress(inst: DistributionInstance) {
  const url = instanceAddress(inst);
  if (!url) {
    alert((instanceMode(inst) === 'url' ? '配置地址' : '清单地址') + '暂不可用，请刷新实例列表后重试');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    setCopiedInstanceKey(`copy-${inst.id}`);
  } catch {
    alert('复制失败，请手动复制：' + url);
  }
}

/** URL 模式：在新窗口打开公开配置地址 */
function openInstanceConfigUrl(inst: DistributionInstance) {
  const url = inst.urls?.source || '';
  if (!url) {
    alert('配置地址暂不可用，请刷新实例列表后重试');
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function downloadInstanceManifest(inst: DistributionInstance) {
  if (instanceMode(inst) !== 'static') return;
  const id = Number(inst.id);
  if (!Number.isFinite(id)) return;
  const link = document.createElement('a');
  link.href = distributionsApi.manifestUrl(id);
  link.download = `ClassIsland-Management-${inst.group_dir_id || 'config'}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function deleteInstance(inst: DistributionInstance) {
  const consumer = instanceMode(inst) === 'url' ? '使用该配置地址的程序' : 'ClassIsland';
  if (!confirm(`确定删除配置实例「${inst.name}」吗？\n删除后${consumer}将无法再同步该实例的配置。`)) return;
  try {
    await distributionsApi.remove(Number(inst.id));
    if (editingInstance.value?.id === inst.id) {
      showInstanceDialog.value = false;
      editingInstance.value = null;
    }
    await Promise.all([loadOverview(true), loadCloudFiles()]);
  } catch (e: any) {
    alert('删除失败：' + (e?.message || '未知错误'));
  }
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
    md: 'Markdown', csv: 'CSV', sql: 'SQL', py: 'Python'
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
  const cloud = cloudFileById(currentFile.value.id);
  const isLocal = currentFile.value.source === 'local';
  return {
    title: currentFile.value.name,
    type: currentFileType.value,
    icon: currentFile.value.icon,
    lastUpdated: currentFile.value.modified,
    // 云端文件显示后端返回的真实编辑者；本地文件显示「本地文件」
    lastEditor: isLocal
      ? '本地文件'
      : (cloud?.owner || currentFile.value.owner || '云端文件'),
    editButtonLabel: '属性',
  };
});

/** 文件卡片「属性」按钮图标（未打开文件时保持“打开文件”语义） */
const cardEditButtonIcon = computed(() => (currentFile.value ? 'ri-information-line' : 'ri-pencil-line'));

/** 当前文件是否可在标题处行内重命名（仅云端自己拥有的文件） */
const canRenameCurrentFile = computed(() => {
  const file = currentFile.value;
  return !!file && file.source === 'cloud' && !file.readOnly;
});

/** 当前文件是否已分发（文件卡片「已分发」徽标） */
const currentFileDistributed = computed(() => {
  const file = currentFile.value;
  if (!file) return false;
  const cloud = cloudFileById(file.id);
  return cloud ? distributedCount(cloud) > 0 : false;
});

/** 文件卡片标题行内重命名 → 调用后端 rename，并同步标签/列表 */
async function onFileCardTitleChange(rawTitle: string) {
  const file = currentFile.value;
  if (!file || file.source !== 'cloud') return;
  const newName = rawTitle.trim();
  if (!newName) {
    alert('文件名不能为空');
    return;
  }
  if (!isValidCloudName(newName)) {
    alert('名称不能包含 / \\ : * ? " < > | 等字符，且不能为空，请修改后重试');
    return;
  }
  if (newName === file.name) return;
  const cloud = cloudFileById(file.id);
  const dir = cloud?.parent_dir || '';
  if (cloudFiles.value.some((f) => f.id !== file.id && f.name === newName && (f.parent_dir || '') === dir)) {
    alert('当前目录已存在同名文件');
    return;
  }
  try {
    await cloudApi.rename({ id: Number(file.id), name: newName });
    updateOpenTabName(file.id, newName);
    updatePluginIndicator(file.ext);
    await loadCloudFiles();
    loadOverview(true);
  } catch (e: any) {
    alert('重命名失败：' + (e?.message || '未知错误'));
  }
}

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
  const file = currentFile.value;
  if (!file) return [];
  const cloud = cloudFileById(file.id);
  return [
    { label: '文件名', value: file.name },
    { label: '大小', value: file.size },
    { label: '类型', value: currentFileType.value },
    { label: '修改时间', value: file.modified },
    { label: '来源', value: file.source === 'local' ? '本地' : (file.source === 'shared' ? '来自分享' : '云端') },
    { label: '编辑者', value: cloud?.owner || file.owner || (file.source === 'local' ? '本地文件' : '—') },
    { label: '路径', value: cloud?.file_path || file.path || '—' },
  ];
});

// ===== 图标映射 =====
const iconMap: Record<string, string> = {
  json: 'ri-file-2-line', xml: 'ri-file-list-3-line', yaml: 'ri-settings-3-line', yml: 'ri-settings-3-line',
  txt: 'ri-file-edit-line', js: 'ri-code-s-slash-line', ts: 'ri-code-s-slash-line',
  html: 'ri-globe-line', css: 'ri-palette-line', md: 'ri-file-edit-line',
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
      modified: data.updated_at || cloudFile.updated_at || '未知',
      dirty: false,
      source: isFromShare ? 'shared' : 'cloud',
      content: data.content || '',
      ext,
      readOnly: isReadOnly,
      owner: cloudFile.owner || cloudFile.owner_username || '',
      path: cloudFile.file_path || cloudFile.name,
      createdAt: cloudFile.created_at || '',
      updatedAt: data.updated_at || cloudFile.updated_at || '',
      isShared: cloudFile.is_shared || 0,
    };
    if (isReadOnly) {
      alert('此文件为只读分享，无法编辑。');
    }
    openFile(editorFile);
  } catch (e: any) {
    alert('加载云文件失败：' + (e?.message || '未知错误'));
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
  input.accept = '.txt,.json,.xml,.html,.css,.js,.ts,.md,.yaml,.yml,.csv,.sql,.py,.ini,.env';
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
  if (currentFile.value.source === 'shared') {
    alert('来自分享的文件不能再分享');
    return;
  }
  if (currentFile.value.source !== 'cloud') {
    if (!confirm('当前文件尚未保存到云文件。\n\n确认分享将自动上传到云文件，是否继续？')) return;
    try {
      const ext = currentFile.value.ext || 'txt';
      const name = currentFile.value.name;
      const uploadDir = currentDir.value;
      await cloudApi.create({ name, content: currentFile.value.content || '', file_type: ext, dir: uploadDir });
      await loadCloudFiles();
      const uploaded = cloudFiles.value.find(
        (f) => f.name === name && f.source === 'owned' && !f.is_directory && (f.parent_dir || '') === uploadDir
      );
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
  if (isLoggedIn.value) {
    loadCloudFiles();
    // 配置实例总览：失败静默（实例视图内会展示错误与重试入口）
    loadOverview(true);
  }
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

/* 云文件 / 配置实例 视图切换 */
.sidebar-view-switch {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 1px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
}
.view-switch-btn {
  padding: 2px 6px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-tertiary);
  cursor: pointer;
  white-space: nowrap;
}
.view-switch-btn:hover { color: var(--text-primary); }
.view-switch-btn.active {
  background: var(--layer-default);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
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

/* ===== 从模板新建对话框 ===== */
.tpl-tip { font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.6; margin-bottom: var(--spacer-3); }
.tpl-state { padding: var(--spacer-5) 0; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary); }
.tpl-plugin-list { display: flex; flex-direction: column; gap: var(--spacer-2); max-height: 320px; overflow-y: auto; margin-bottom: var(--spacer-2); }
.tpl-plugin-item {
  display: flex; align-items: center; gap: var(--spacer-3); padding: var(--spacer-3);
  text-align: left; font-family: inherit;
  background: var(--subtle-secondary); border: 1px solid var(--divider-stroke); border-radius: var(--radius-md);
  cursor: pointer; color: var(--text-primary); transition: border-color 0.15s, background 0.15s;
}
.tpl-plugin-item:hover { border-color: var(--accent-base); background: var(--accent-tint, rgba(0, 103, 192, 0.06)); }
.tpl-plugin-item:disabled { opacity: 0.6; cursor: default; }
.tpl-plugin-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tpl-plugin-name { font-size: var(--font-size-sm); font-weight: 600; }
.tpl-plugin-desc {
  font-size: var(--font-size-xs); color: var(--text-tertiary);
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.tpl-releasing { font-size: var(--font-size-xs); color: var(--accent-base); flex-shrink: 0; }

.cloud-loading { text-align: center; padding: var(--spacer-4); font-size: var(--font-size-xs); color: var(--text-tertiary); }

.cloud-login-prompt { display: flex; flex-direction: column; align-items: center; padding: var(--spacer-4); text-align: center; }
.login-icon { font-size: 36px; margin-bottom: var(--spacer-2); }
.login-text { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacer-3); }
.login-btn { padding: var(--spacer-1) var(--spacer-4); background: var(--accent-base); color: white; border: none; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; cursor: pointer; }
.login-btn:hover { background: var(--accent-hover); }

/* 当前目录面包屑 */
.cloud-breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 0 var(--spacer-2);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.cloud-breadcrumb::-webkit-scrollbar { display: none; }
.cloud-crumb {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 120px;
  padding: 2px 4px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  flex-shrink: 0;
}
.cloud-crumb:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.cloud-crumb.active { color: var(--text-primary); font-weight: 600; }
.cloud-crumb-sep { color: var(--text-tertiary); flex-shrink: 0; opacity: 0.6; }

.cloud-file-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; padding-bottom: var(--spacer-3); }
.cloud-file-item { display: flex; align-items: center; gap: var(--spacer-2); min-height: 30px; padding: var(--spacer-1) var(--spacer-2); background: transparent; border-radius: var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer; }
.cloud-file-item:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.cloud-file-item.active { background: var(--subtle-pressed); color: var(--text-primary); }
.cloud-file-item.directory .cloud-file-icon { color: var(--accent-base); }
.cloud-file-item.directory .cloud-file-name { color: var(--text-primary); }
.cloud-file-item.renaming { background: var(--subtle-secondary); }
.cloud-file-item.draft { border: 1px dashed var(--accent-base); background: var(--accent-bg); }
.cloud-file-icon { display: inline-flex; align-items: center; flex-shrink: 0; font-size: 16px; }
.cloud-file-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cloud-inline-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--accent-base);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  box-sizing: border-box;
}
.draft-hint { color: var(--accent-base) !important; }
.cloud-file-size { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.cloud-file-shared-badge { display: inline-flex; align-items: center; color: var(--status-success); flex-shrink: 0; }
.cloud-file-dist-badge {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  font-size: 9px;
  line-height: 1.4;
  color: var(--status-warning);
  background: rgba(255, 140, 0, 0.12);
  padding: 0 3px;
  border-radius: var(--radius-xs);
}
.cloud-file-shared-from-badge { display: inline-flex; align-items: center; gap: 2px; font-size: 9px; color: var(--accent-base); background: var(--accent-bg); padding: 0 4px; border-radius: var(--radius-xs); flex-shrink: 0; }
.cloud-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--spacer-4);
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.cloud-empty-title { color: var(--text-secondary); font-size: var(--font-size-xs); }
.cloud-empty-hint { font-size: 10px; color: var(--text-tertiary); }

/* ===== 配置实例视图（侧栏） ===== */
.instance-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.instance-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  padding-bottom: var(--spacer-2);
}
.instance-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
}
.instance-item:hover { border-color: var(--divider-stroke); }
.instance-item-head {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  min-width: 0;
}
.instance-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 分发类型徽标 */
.instance-format {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  font-size: 9px;
  line-height: 1.5;
  font-weight: 500;
  white-space: nowrap;
}
.instance-format.fmt-classisland { color: var(--accent-base); background: var(--accent-bg); }
.instance-format.fmt-cses { color: var(--status-success); background: rgba(16, 124, 16, 0.1); }
.instance-format.fmt-examaware { color: #7A5AF8; background: rgba(122, 90, 248, 0.12); }
.instance-format.fmt-unknown { color: var(--text-tertiary); background: var(--subtle-pressed); }
.instance-status {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  font-size: 9px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
}
.instance-status.ok { color: var(--status-success); background: rgba(16, 124, 16, 0.1); }
.instance-status.warn { color: var(--status-warning); background: rgba(255, 140, 0, 0.12); }
.instance-file {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-tertiary);
  min-width: 0;
}
.instance-file span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.instance-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacer-1);
  min-width: 0;
}
.instance-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 70%;
  padding: 0;
  border: none;
  background: transparent;
  font-family: var(--font-family-mono);
  font-size: 10px;
  color: var(--text-secondary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.instance-group:hover { color: var(--accent-base); }
.instance-group span { overflow: hidden; text-overflow: ellipsis; }
.instance-time {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--text-tertiary);
}
.instance-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}
.instance-actions button {
  width: 22px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.instance-actions button:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.instance-actions button.danger:hover { background: rgba(220, 38, 38, 0.08); color: var(--status-error); }
.instance-refresh-row {
  padding-top: var(--spacer-2);
  border-top: 1px solid var(--divider-stroke);
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}
.instance-refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px var(--spacer-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  font-size: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
}
.instance-refresh-btn:hover:not(:disabled) { background: var(--subtle-secondary); color: var(--text-primary); }
.instance-refresh-btn:disabled { opacity: 0.6; cursor: default; }
.instance-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.instance-empty-icon { color: var(--text-tertiary); opacity: 0.6; margin-bottom: var(--spacer-1); }
.instance-empty-hint { font-size: 10px; color: var(--text-tertiary); }
.instance-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-4) var(--spacer-2);
  text-align: center;
  color: var(--status-error);
  font-size: var(--font-size-xs);
}
.instance-error-text { line-height: 1.5; word-break: break-all; }
.instance-retry {
  padding: 2px var(--spacer-3);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.instance-retry:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.sidebar-footer { padding: var(--spacer-3); border-top: 1px solid var(--divider-stroke); background: var(--subtle-secondary); }
.storage-info { display: flex; flex-direction: column; gap: var(--spacer-1); }
.storage-label { display: flex; align-items: center; justify-content: space-between; gap: var(--spacer-2); font-size: var(--font-size-xs); font-weight: 500; color: var(--text-tertiary); }
.storage-percent { font-size: 10px; color: var(--text-tertiary); font-weight: 400; }
.storage-bar { height: 4px; background: var(--divider-stroke); border-radius: var(--radius-full); overflow: hidden; }
.storage-fill { height: 100%; background: var(--accent-base); border-radius: var(--radius-full); transition: width var(--fast-duration); }
.storage-fill.warning { background: var(--status-warning); }
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