<template>
  <div class="web-homepage" :class="{ immersive }">
    <!-- 左侧导航栏 -->
    <aside class="homepage-sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon">
          <Icon icon="ri-home-6-line" :size="22" />
        </div>
        <div class="brand-texts">
          <div class="brand-title">班级主页</div>
          <div class="brand-sub" v-if="space">/site/{{ space.slug }}</div>
          <div class="brand-sub" v-else>加载中...</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-item"
          :class="{ active: activePage === item.id }"
          @click="activePage = item.id"
        >
          <Icon :icon="item.icon" :size="16" />
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div v-if="space" class="space-preview">
          <a :href="`/site/${space.slug}`" target="_blank" class="preview-link">
            <Icon icon="ri-external-link-line" :size="12" />
            预览站点
          </a>
          <button class="copy-btn" @click="copyUrl" title="复制链接">
            <Icon icon="ri-file-copy-line" :size="12" />
          </button>
        </div>
        <!-- 管理员禁用标签 -->
        <div v-if="space?.disabled_by_admin" class="admin-disabled-badge">
          <Icon icon="ri-forbid-line" :size="12" />
          <span>已被管理员停用</span>
          <div v-if="space?.disabled_reason" class="disabled-reason">{{ space.disabled_reason }}</div>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <div class="homepage-content" :class="{ 'content-immersive': activePage === 'files' }">
      <div v-if="loading" class="loading-state">
        <div class="loading-ring"></div>
        <span>加载中...</span>
      </div>

      <!-- 审查状态横幅 -->
      <div v-else-if="space?.review_status === 'pending_review' && activePage !== 'files'" class="review-banner">
        <Icon icon="ri-error-warning-line" :size="16" />
        <span>已于 {{ space.updated_at }} 编辑，新版本待管理员审查</span>
        <span class="review-separator">|</span>
        <span>当前版本修改时间：{{ space.updated_at }}</span>
        <a :href="`/site/${space.slug}?preview=1`" target="_blank" class="review-preview-link">查看最新版本（仅编辑者）</a>
      </div>

      <div v-else-if="!isAlliance" class="error-state">
        <div class="error-card">
          <Icon icon="ri-shield-user-line" :size="48" />
          <h2>需要智教联盟账户</h2>
          <p>班级主页功能仅限智教联盟登录的用户使用。</p>
          <button class="primary-btn" @click="goToLogin">前往登录</button>
        </div>
      </div>

      <!-- 概览 -->
      <template v-else-if="activePage === 'overview'">
        <div class="page-header">
          <div>
            <h1 class="page-title">空间概览</h1>
            <span class="page-subtitle">查看你的网页托管空间使用情况</span>
          </div>
        </div>
        <div class="stats-row">
          <div class="stat-card" v-for="s in statsItems" :key="s.label">
            <div class="stat-icon"><Icon :icon="s.icon" :size="24" /></div>
            <div class="stat-info">
              <span class="stat-label">{{ s.label }}</span>
              <span class="stat-value">{{ s.value }}</span>
            </div>
            <div v-if="s.bar" class="usage-bar"><div class="usage-fill" :style="{ width: usage.percent + '%' }"></div></div>
          </div>
        </div>
        <div class="overview-actions">
          <button class="primary-btn" @click="activePage = 'files'"><Icon icon="ri-folder-open-line" :size="16" />进入文件管理</button>
          <button class="secondary-btn" @click="activePage = 'settings'"><Icon icon="ri-settings-3-line" :size="16" />空间设置</button>
        </div>
      </template>

      <!-- 文件管理（沉浸式编辑器） -->
      <template v-else-if="activePage === 'files'">
        <div class="files-immersion">
          <RibbonToolbar
            :editor-info="activeTab ? { title: activeTab.name, type: activeTab.type, icon: fileIcon(activeTab.path), lastUpdated: activeTab.data?.updated_at || '', lastEditor: '', editButtonLabel: '重命名' } : { title: '文件管理', type: 'Web Hosting', icon: 'ri-folder-open-line', editButtonLabel: '新建文件' }"
            :saving="saving"
            :is-instance="false"
            :show-view-ribbon="true"
            :manifest="ribbonManifest"
            :system-right-tools="systemRightTools"
            :system-right-selected-tool="isSourceView ? 'toggle-view' : ''"
            :selected-tool="immersive ? 'immersive' : ''"
            :can-undo="!!activeTab"
            :can-redo="!!activeTab"
            :can-save="!!activeTab"
            :can-auto-save="!!activeTab"
            :right-actions="[
              { id: 'share', label: '分享', icon: 'ri-share-forward-line', enabled: !!activeTab },
              { id: 'history', label: '操作记录', icon: 'ri-history-line', enabled: !!activeTab },
              { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', enabled: !!activeTab },
              { id: 'import', label: '导入', icon: 'ri-download-line', enabled: !!activeTab },
              { id: 'export', label: '导出', icon: 'ri-upload-2-line', enabled: !!activeTab },
            ]"
            @save="saveCurrentTab"
            @undo="handleUndo"
            @redo="handleRedo"
            @tool-click="onRibbonTool"
            @autosize-change="onAutoSaveChange"
            @edit-click="activeFilePanel = 'props'"
          />

          <!-- 标签页（在 Ribbon 下方） -->
          <div class="editor-tabs-row" v-if="hostingEditorTabs.length > 0">
            <div class="editor-tabs">
              <div
                v-for="(tab, gi) in hostingEditorTabs"
                :key="tab.id"
                class="editor-tab"
                :class="{ active: tab.id === (activeTab?.path || ''), dirty: tab.dirty }"
                @click="switchTab(tab.id)"
                @contextmenu.prevent="onOpenTabMenu(tab.id, $event)"
                draggable="true"
                @dragstart="onTabDragStart(gi, $event)"
                @dragover.prevent="onTabDragOver(gi)"
                @drop="onTabDrop"
                @dragend="onTabDragEnd"
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

          <div class="immersion-body">
            <!-- 文件树 -->
            <div class="file-tree-panel">
              <div class="panel-header">
                <span class="panel-title">文件列表</span>
                <div class="panel-actions">
                  <button class="icon-btn" @click="triggerUpload" title="上传文件">
                    <Icon icon="ri-upload-2-line" :size="16" />
                  </button>
                  <button class="icon-btn" @click="showNewFileDialog = true" title="新建文件">
                    <Icon icon="ri-file-add-line" :size="16" />
                  </button>
                  <button class="icon-btn" @click="showNewDirDialog = true" title="新建目录">
                    <Icon icon="ri-folder-add-line" :size="16" />
                  </button>
                  <button class="icon-btn" @click="refreshFiles" title="刷新">
                    <Icon icon="ri-refresh-line" :size="16" />
                  </button>
                </div>
              </div>
              <div class="file-tree" @click.self="ctxMenuNode = null">
                <div
                  v-for="node in visibleFileTree"
                  :key="node.path"
                  class="tree-node"
                  :class="{ 'is-active': activeTab?.path === node.path, 'is-dir': node.is_directory }"
                  :style="{ paddingLeft: (node.depth * 16 + 8) + 'px' }"
                  @click="node.is_directory ? toggleDir(node.path) : openFileInTab(node)"
                  @contextmenu.prevent="ctxMenuNode = node; ctxMenuPos = { x: $event.clientX, y: $event.clientY }"
                >
                  <Icon
                    v-if="node.is_directory"
                    :icon="expandedDirs.has(node.path) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"
                    :size="12"
                    class="node-chevron"
                  />
                  <Icon :icon="node.is_directory ? (expandedDirs.has(node.path) ? 'ri-folder-open-line' : 'ri-folder-3-line') : fileIcon(node.name)" :size="16" class="node-icon" />
                  <span class="node-name">{{ node.name }}</span>
                  <span v-if="!node.is_directory && node.data?.size" class="node-size">{{ formatBytes(node.data.size) }}</span>
                </div>
                <div v-if="fileTree.length === 0" class="ft-empty">
                  <Icon icon="ri-inbox-line" :size="20" />
                  <span>暂无文件</span>
                </div>
              </div>
            </div>

            <!-- 分隔条 -->
            <div class="editor-splitter" @mousedown="startDragFiles"></div>

            <!-- 右列 -->
            <div class="editor-right-col" :style="{ flex: `0 0 ${fileRightWidth}%` }">
              <div class="editor-right-body">
                <!-- 编辑区 -->
                <div class="editor-area" @contextmenu.prevent="onEditorContextMenu">
                  <EditorPane
                    ref="editorPaneRef"
                    :tabs="hostingEditorTabs"
                    :active-tab-id="activeTabPath"
                    :read-only="false"
                    :show-source="isSourceView"
                    :hide-tabs="true"
                    @tab-click="switchTab"
                    @tab-close="closeTab"
                    @update:content="onContentUpdate"
                    @plugin-save="onPluginSave"
                    @plugin-change="onEditorPluginChange"
                    @plugin-ribbon="onPluginRibbon"
                    @monaco-save="saveCurrentTab"
                    @monaco-find="openFilePanel('find')"
                    @monaco-replace="openFilePanel('find')"
                  >
                    <template #empty-actions>
                      <div class="empty-actions">
                        <button class="primary-btn" @click="showNewFileDialog = true">新建文件</button>
                        <button class="secondary-btn" @click="triggerUpload">上传文件</button>
                      </div>
                    </template>
                    <template #binary-actions="{ tab }">
                      <button class="secondary-btn" style="margin-top:12px" @click="downloadFile(tab.name)">下载文件</button>
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
                          v-for="(panel, idx) in visibleFilePanels"
                          :key="panel.id"
                          class="right-tab"
                          :class="{ active: activeFilePanel === panel.id }"
                          @click="activeFilePanel = panel.id"
                          :title="panel.label"
                          draggable="true"
                          @dragstart="onPanelDragStart(idx, $event)"
                          @dragover.prevent="onPanelDragOver(idx)"
                          @drop="onPanelDrop(idx)"
                          @dragend="onPanelDragEnd"
                        >
                          <Icon :icon="panel.icon" :size="14" />
                          <span class="tab-label">{{ panel.label }}</span>
                          <button class="tab-close-btn" @click.stop="closeFilePanel(panel.id)" v-if="panel.closable">
                            <Icon icon="ri-close-line" :size="10" />
                          </button>
                        </button>
                      </div>
                      <button class="right-tab add-tab" title="添加面板" @click="showFilePanelPicker = !showFilePanelPicker">
                        <Icon icon="ri-add-line" :size="14" />
                      </button>
                      <div v-if="showFilePanelPicker" class="panel-picker" @click.stop>
                        <div class="panel-picker-title">选择面板</div>
                        <button
                          v-for="p in availableFilePanels"
                          :key="p.id"
                          class="panel-picker-item"
                          :class="{ disabled: visibleFilePanels.some(vp => vp.id === p.id) }"
                          :disabled="visibleFilePanels.some(vp => vp.id === p.id)"
                          @click="addFilePanel(p); showFilePanelPicker = false"
                        >
                          <Icon :icon="p.icon" :size="14" />
                          <span>{{ p.label }}</span>
                          <Icon v-if="visibleFilePanels.some(vp => vp.id === p.id)" icon="ri-check-line" :size="12" class="check-icon" />
                        </button>
                      </div>
                    </div>
                    <div class="right-panel-content">
                      <AiAssistantPanel
                        v-if="activeFilePanel === 'ai'"
                        scope="global"
                        :editor-context="aiEditorContext"
                        @apply-edit="onAiApplyEdit"
                      />
                      <OperationHistoryPanel
                        v-else-if="activeFilePanel === 'history'"
                        :file-id="activeTab?.source === 'cloud' ? activeTab.path : ''"
                        :file-name="activeTab?.name || ''"
                        :local-history="localHistory"
                        :is-logged-in="isAlliance"
                        @restore="onHistoryRestore"
                      />
                      <VersionHistoryPanel
                        v-else-if="activeFilePanel === 'version'"
                        :file-id="activeTab?.source === 'cloud' ? activeTab.path : ''"
                        :file-name="activeTab?.name || ''"
                        @restore="onVersionRestore"
                      />
                    <div v-else-if="activeFilePanel === 'props'" class="props-panel">
                      <div v-if="!activeTab" class="panel-empty"><Icon icon="ri-settings-3-line" :size="36" /><span>选择文件查看属性</span></div>
                      <div v-else class="property-list">
                        <div class="property-item"><label>路径</label><span class="mono">{{ activeTab.path }}</span></div>
                        <div class="property-item"><label>大小</label><span>{{ formatBytes(activeTab.data?.size || 0) }}</span></div>
                        <div class="property-item"><label>类型</label><span>{{ activeTab.data?.content_type || '未知' }}</span></div>
                        <div class="property-item"><label>行数</label><span>{{ activeTab.isText ? (activeTab.content || '').split('\n').length : '-' }}</span></div>
                        <div class="property-item"><label>字符数</label><span>{{ activeTab.isText ? (activeTab.content || '').length : '-' }}</span></div>
                      </div>
                    </div>
                    <div v-else-if="activeFilePanel === 'find'" class="find-panel">
                      <div class="find-section">
                        <div class="find-row"><Icon icon="ri-search-line" :size="14" /><input v-model="findText" @keyup.enter="doFind" placeholder="查找..." /><button class="find-btn" @click="doFind">查找</button></div>
                        <div class="find-row"><Icon icon="ri-replace-line" :size="14" /><input v-model="replaceText" placeholder="替换为..." /><button class="find-btn" @click="doReplace">替换</button><button class="find-btn" @click="doReplaceAll">全部</button></div>
                      </div>
                    </div>
                    <div v-else-if="activeFilePanel === 'actions'" class="actions-panel">
                      <div v-if="!activeTab" class="panel-empty"><Icon icon="ri-settings-3-line" :size="36" /><span>选择文件查看操作</span></div>
                      <div v-else class="action-list">
                        <button class="action-item" @click="saveCurrentTab" :disabled="saving"><Icon icon="ri-save-line" :size="16" /><div><div class="action-title">保存</div><div class="action-desc">保存到云端</div></div></button>
                        <button class="action-item" @click="downloadFile(activeTab.path)"><Icon icon="ri-download-2-line" :size="16" /><div><div class="action-title">下载</div><div class="action-desc">下载到本地</div></div></button>
                        <button class="action-item" @click="confirmDeleteByPath"><Icon icon="ri-delete-bin-line" :size="16" /><div><div class="action-title">删除</div><div class="action-desc">删除此文件</div></div></button>
                      </div>
                    </div>
                  </div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- 状态栏 -->
          <footer class="immersion-status">
            <div class="status-left">
              <span class="status-item"><Icon icon="ri-file-2-line" :size="10" />{{ activeTab ? activeTab.path : '未选择文件' }}</span>
              <span class="status-item" v-if="activeTab?.isText">UTF-8</span>
              <span v-if="activeTab?.dirty" class="status-item dirty"><Icon icon="ri-circle-fill" :size="8" />未保存</span>
              <span v-if="reviewStatus?.pending_count > 0" class="status-item pending-review"><Icon icon="ri-error-warning-line" :size="10" />{{ reviewStatus.pending_count }} 个文件待审查</span>
            </div>
            <div class="status-right">
              <span class="status-item">{{ autoSave ? '自动保存' : '手动保存' }}</span>
              <span class="status-item" v-if="activeTab?.isText">行 {{ (activeTab.content || '').split('\n').length }} · {{ (activeTab.content || '').length }} 字符</span>
            </div>
          </footer>
        </div>
      </template>

      <!-- 设置 -->
      <template v-else-if="activePage === 'settings'">
        <div class="page-header"><div><h1 class="page-title">空间设置</h1><span class="page-subtitle">配置你的班级主页信息</span></div></div>
        <div class="settings-card">
          <div class="settings-grid">
            <div class="setting-item"><label class="setting-label">站点标题</label><input type="text" v-model="spaceForm.title" class="setting-input" /></div>
            <div class="setting-item"><label class="setting-label">站点描述</label><input type="text" v-model="spaceForm.description" class="setting-input" /></div>
            <div class="setting-item">
              <label class="setting-label">访问路径</label>
              <div class="slug-input-group"><span class="slug-prefix">/site/</span><input type="text" v-model="spaceForm.slug" class="setting-input slug-input" /></div>
            </div>
            <div class="setting-item">
              <label class="setting-label">启用状态</label>
              <label class="toggle-label"><input type="checkbox" v-model="spaceForm.is_enabled" class="toggle-input" /><span class="toggle-switch"></span><span class="toggle-text">{{ spaceForm.is_enabled ? '已启用' : '已禁用' }}</span></label>
            </div>
          </div>
          <div class="settings-footer"><button class="primary-btn" @click="saveSettings" :disabled="savingSettings">{{ savingSettings ? '保存中...' : '保存设置' }}</button></div>
        </div>
      </template>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenuNode" class="ctx-overlay" @click.self="ctxMenuNode = null" @contextmenu.prevent="ctxMenuNode = null">
        <div class="ctx-menu" :style="{ left: ctxMenuPos.x + 'px', top: ctxMenuPos.y + 'px' }">
          <button v-if="!ctxMenuNode.is_directory" class="ctx-item" @click="openFileInTab(ctxMenuNode); ctxMenuNode = null"><Icon icon="ri-file-edit-line" :size="14" />打开</button>
          <button v-if="!ctxMenuNode.is_directory" class="ctx-item" @click="downloadFile(ctxMenuNode.path); ctxMenuNode = null"><Icon icon="ri-download-2-line" :size="14" />下载</button>
          <button v-if="!ctxMenuNode.is_directory" class="ctx-item" @click="openFileInTab(ctxMenuNode); showShareDialog = true; ctxMenuNode = null"><Icon icon="ri-share-line" :size="14" />分享</button>
          <button v-if="ctxMenuNode.is_directory" class="ctx-item" @click="toggleDir(ctxMenuNode.path); ctxMenuNode = null"><Icon :icon="expandedDirs.has(ctxMenuNode.path) ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" :size="14" />{{ expandedDirs.has(ctxMenuNode.path) ? '折叠' : '展开' }}</button>
          <button class="ctx-item" @click="showNewFileDialog = true; ctxMenuNode = null"><Icon icon="ri-file-add-line" :size="14" />新建文件</button>
          <button class="ctx-item" @click="showNewDirDialog = true; ctxMenuNode = null"><Icon icon="ri-folder-add-line" :size="14" />新建目录</button>
          <div class="ctx-divider"></div>
          <button class="ctx-item danger" @click="confirmDelete(ctxMenuNode); ctxMenuNode = null"><Icon icon="ri-delete-bin-line" :size="14" />删除</button>
        </div>
      </div>
    </Teleport>

    <!-- 编辑器右键菜单 -->
    <Teleport to="body">
      <div v-if="editorCtxMenu.visible" class="ctx-overlay" @click="editorCtxMenu.visible = false" @contextmenu.prevent="editorCtxMenu.visible = false">
        <div class="ctx-menu" :style="{ left: editorCtxMenu.x + 'px', top: editorCtxMenu.y + 'px' }">
          <button class="ctx-item" @click="saveCurrentTab(); editorCtxMenu.visible = false" v-if="activeTab">
            <Icon icon="ri-save-line" :size="14" />保存
          </button>
          <button class="ctx-item" @click="downloadFile(activeTab?.path || ''); editorCtxMenu.visible = false" v-if="activeTab">
            <Icon icon="ri-download-2-line" :size="14" />下载
          </button>
          <button class="ctx-item" @click="showShareDialog = true; editorCtxMenu.visible = false" v-if="activeTab">
            <Icon icon="ri-share-forward-line" :size="14" />分享
          </button>
          <div class="ctx-divider" v-if="activeTab"></div>
          <button class="ctx-item" @click="openFilePanel('find'); editorCtxMenu.visible = false">
            <Icon icon="ri-search-line" :size="14" />查找替换
          </button>
        </div>
      </div>
    </Teleport>

    <!-- 分享对话框 -->
    <ShareDialog
      :visible="showShareDialog"
      resource-type="cloud_file"
      :resource-id="activeTab?.data?.id || ''"
      :resource-name="activeTab?.name || ''"
      resource-icon="ri-file-line"
      resource-label="文件"
      @close="showShareDialog = false"
      @created="refreshFiles"
      @updated="refreshFiles"
    />

    <!-- 隐藏的上传 input -->
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
    <div v-if="deleteTarget" class="dialog-overlay" @click.self="deleteTarget = null">
      <div class="dialog-card">
        <h3>确认删除</h3>
        <p class="delete-message">确定要删除<strong>{{ deleteTarget.is_directory ? '目录' : '文件' }}</strong><code>{{ deleteTarget.path }}</code>吗？<span v-if="deleteTarget.is_directory" class="delete-warning">此操作将同时删除目录下的所有文件。</span></p>
        <div class="dialog-actions"><button class="secondary-btn" @click="deleteTarget = null">取消</button><button class="danger-btn" @click="executeDelete">确认删除</button></div>
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
import { hostingApi } from '../../api';
import { useAuth } from '../../composables/useAuth';
import { useTabContextMenu } from '../../composables/useTabContextMenu';
import RibbonToolbar from '../../components/editor/RibbonToolbar.vue';
import EditorPane from '../../components/editor/EditorPane.vue';
import type { TabInfo } from '../../components/editor/EditorPane.vue';
import AiAssistantPanel from '../../components/editor/panels/AiAssistantPanel.vue';
import ShareDialog from '../../components/editor/panels/ShareDialog.vue';
import OperationHistoryPanel from '../../components/editor/panels/OperationHistoryPanel.vue';
import VersionHistoryPanel from '../../components/editor/panels/VersionHistoryPanel.vue';

const router = useRouter();
const { user } = useAuth();

// ===== 导航 =====
const navItems = [
  { id: 'overview', icon: 'ri-dashboard-line', label: '概览' },
  { id: 'files', icon: 'ri-folder-open-line', label: '文件管理' },
  { id: 'settings', icon: 'ri-settings-3-line', label: '空间设置' },
];
const activePage = ref('files');

// ===== 右侧面板（与轻编辑器同步） =====
interface FilePanelDef {
  id: string;
  label: string;
  icon: string;
  closable: boolean;
}
const allFilePanels: FilePanelDef[] = [
  { id: 'ai', label: 'AI助理', icon: 'ri-brain-line', closable: false },
  { id: 'props', label: '属性', icon: 'ri-settings-3-line', closable: false },
  { id: 'find', label: '查找替换', icon: 'ri-search-line', closable: true },
  { id: 'history', label: '操作记录', icon: 'ri-history-line', closable: true },
  { id: 'version', label: '版本历史', icon: 'ri-git-branch-line', closable: true },
];
const visibleFilePanels = ref<FilePanelDef[]>([
  allFilePanels[0], // AI助理
  allFilePanels[1], // 属性
]);
const activeFilePanel = ref('ai');
const showFilePanelPicker = ref(false);

const availableFilePanels = computed(() => allFilePanels.filter(p => !visibleFilePanels.value.some(vp => vp.id === p.id)));

function openFilePanel(id: string) {
  const panel = allFilePanels.find(p => p.id === id);
  if (!panel) return;
  if (!visibleFilePanels.value.some(vp => vp.id === id)) {
    visibleFilePanels.value.push(panel);
  }
  activeFilePanel.value = id;
  if (rightPanelCollapsed.value) rightPanelCollapsed.value = false;
}

function closeFilePanel(id: string) {
  const panel = visibleFilePanels.value.find(p => p.id === id);
  if (!panel?.closable) return;
  visibleFilePanels.value = visibleFilePanels.value.filter(p => p.id !== id);
  if (activeFilePanel.value === id) {
    activeFilePanel.value = visibleFilePanels.value[0]?.id || 'ai';
  }
}

function addFilePanel(panel: FilePanelDef) {
  if (visibleFilePanels.value.some(vp => vp.id === panel.id)) return;
  visibleFilePanels.value.push(panel);
  activeFilePanel.value = panel.id;
}

// 拖拽排序
let fileDragSrcIdx = -1;
function onPanelDragStart(idx: number, e: DragEvent) {
  fileDragSrcIdx = idx;
  e.dataTransfer!.effectAllowed = 'move';
}
function onPanelDragOver(idx: number) {
  if (fileDragSrcIdx < 0 || fileDragSrcIdx === idx) return;
  const panels = [...visibleFilePanels.value];
  const [item] = panels.splice(fileDragSrcIdx, 1);
  panels.splice(idx, 0, item);
  visibleFilePanels.value = panels;
  fileDragSrcIdx = idx;
}
function onPanelDrop(_idx: number) {
  fileDragSrcIdx = -1;
}
function onPanelDragEnd() {
  fileDragSrcIdx = -1;
}

const fileRightWidth = ref(70);
const rightPanelWidth = ref(28);
const rightPanelCollapsed = ref(false);
const showShareDialog = ref(false);
const editorPaneRef = ref<InstanceType<typeof EditorPane> | null>(null);

// 编辑器右键菜单
const editorCtxMenu = ref({ visible: false, x: 0, y: 0 });
function onEditorContextMenu(e: MouseEvent) {
  editorCtxMenu.value = { visible: true, x: e.clientX, y: e.clientY };
}

// 本地操作记录
interface HistoryEntry { step: number; content: string; time: string; }
const localHistory = ref<HistoryEntry[]>([]);
let localHistoryStep = 0;
function addLocalHistory(content: string) {
  localHistoryStep++;
  localHistory.value.push({ step: localHistoryStep, content, time: new Date().toLocaleTimeString() });
  if (localHistory.value.length > 30) localHistory.value = localHistory.value.slice(-30);
}
function onHistoryRestore(content: string) {
  if (!activeTab.value) return;
  if (!confirm('恢复到此步骤？若此时编辑将删除更新的记录')) return;
  activeTab.value.content = content;
  activeTab.value.dirty = true;
  editorPaneRef.value?.setValue(content);
  addLocalHistory(content);
}
function onVersionRestore(content: string, versionLabel: string) {
  if (!activeTab.value) return;
  if (!confirm(`恢复到版本 "${versionLabel}"？当前未保存的更改将丢失`)) return;
  activeTab.value.content = content;
  activeTab.value.dirty = true;
  editorPaneRef.value?.setValue(content);
  addLocalHistory(content);
}

// ===== 拖拽 =====
function startDragFiles(e: MouseEvent) {
  const startX = e.clientX; const startW = fileRightWidth.value;
  const parent = (e.target as HTMLElement).parentElement!;
  const move = (ev: MouseEvent) => { fileRightWidth.value = Math.min(90, Math.max(35, startW - (ev.clientX - startX) / parent.clientWidth * 100)); };
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

// ===== 基础数据 =====
const loading = ref(true);
const isAlliance = computed(() => user.value?.type === 'alliance');
const space = ref<any>(null);
const files = ref<any[]>([]);
const fileTree = ref<any[]>([]);
const expandedDirs = ref<Set<string>>(new Set());
const saving = ref(false);
const savingSettings = ref(false);
const autoSave = ref(true);
const uploadInput = ref<HTMLInputElement>();

// ===== 多标签页 =====
interface Tab {
  path: string;
  name: string;
  type: string;
  isText: boolean;
  content: string;
  dirty: boolean;
  data: any;
}
const openTabs = ref<Tab[]>([]);
const activeTabPath = ref('');
const activeTab = computed(() => openTabs.value.find(t => t.path === activeTabPath.value) || null);

// AI 编辑器上下文
const aiEditorContext = computed(() => {
  if (!activeTab.value || !activeTab.value.isText) return undefined;
  return {
    fileName: activeTab.value.name,
    fileContent: activeTab.value.content || '',
    language: activeTab.value.path?.split('.').pop() || '',
  };
});

// AI 应用编辑
function onAiApplyEdit(payload: { content: string; replaceAll?: boolean }) {
  if (!activeTab.value || !activeTab.value.isText) return;
  activeTab.value.content = payload.content;
  activeTab.value.dirty = true;
  if (editorPaneRef.value) {
    editorPaneRef.value.setValue(payload.content);
  }
}

// ===== EditorPane 标签映射 =====
const hostingEditorTabs = computed<TabInfo[]>(() => openTabs.value.map(t => ({
  id: t.path,
  name: t.name,
  icon: fileIcon(t.path),
  isText: t.isText,
  content: t.content,
  dirty: t.dirty,
  language: t.type.toLowerCase(),
  ext: t.path.split('.').pop()?.toLowerCase(),
})));

function onContentUpdate(payload: { tabId: string; content: string }) {
  const tab = openTabs.value.find(t => t.path === payload.tabId);
  if (tab) {
    tab.content = payload.content;
    tab.dirty = true;
    addLocalHistory(payload.content);
  }
}

function onPluginSave(content: string) {
  const tab = activeTab.value;
  if (tab) {
    tab.content = content;
    tab.dirty = false;
  }
}

const usage = ref({ usedBytes: 0, quotaBytes: 0, usedDisplay: '0 B', quotaDisplay: '100 MB', percent: 0, fileCount: 0 });
const reviewStatus = ref<any>(null);
const statsItems = computed(() => [
  { icon: 'ri-hard-drive-2-line', label: '已用空间', value: usage.value.usedDisplay, bar: false },
  { icon: 'ri-stack-line', label: '总配额', value: usage.value.quotaDisplay, bar: false },
  { icon: 'ri-file-line', label: '文件数量', value: usage.value.fileCount.toString(), bar: false },
  { icon: 'ri-pie-chart-line', label: '使用率', value: usage.value.percent + '%', bar: true },
]);

// 对话框
const showNewFileDialog = ref(false);
const showNewDirDialog = ref(false);
const newFileName = ref('');
const newDirName = ref('');
const deleteTarget = ref<any>(null);
const toast = ref<{ type: string; message: string } | null>(null);
const findText = ref('');
const replaceText = ref('');

// 右键菜单
const ctxMenuNode = ref<any>(null);
const ctxMenuPos = ref({ x: 0, y: 0 });

// 空间表单
const spaceForm = ref({ title: '', description: '', slug: '', is_enabled: true });

function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => { toast.value = null; }, 3000);
}

// 工具函数
function fileNameOf(path: string) { return path.split('/').filter(Boolean).pop() || path; }
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'ri-html5-line', htm: 'ri-html5-line', css: 'ri-css3-line',
    js: 'ri-javascript-line', mjs: 'ri-javascript-line', json: 'ri-braces-line',
    md: 'ri-markdown-line', txt: 'ri-file-text-line',
    png: 'ri-image-line', jpg: 'ri-image-line', jpeg: 'ri-image-line',
    gif: 'ri-image-line', svg: 'ri-image-line', ico: 'ri-image-line',
    pdf: 'ri-file-pdf-line', zip: 'ri-file-zip-line',
  };
  return map[ext] || 'ri-file-line';
}
function isTextFile(path: string): boolean {
  const textExts = ['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'svg', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'ts', 'tsx', 'jsx', 'vue', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'sh', 'bat', 'ps1', 'env', 'gitignore', 'editorconfig', 'csv', 'log', 'cses'];
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return !path.includes('.') || textExts.includes(ext);
}
function buildFileTree(fileList: any[]): any[] {
  // 构建层级树结构
  const result: any[] = [];
  const dirMap = new Map<string, any[]>();

  // 先按路径排序
  const sorted = [...fileList].sort((a, b) => {
    const aPath = a.file_path || '';
    const bPath = b.file_path || '';
    const aIsDir = a.is_directory ? 1 : 0;
    const bIsDir = b.is_directory ? 1 : 0;
    if (aIsDir !== bIsDir) return bIsDir - aIsDir; // 目录在前
    return aPath.localeCompare(bPath);
  });

  for (const file of sorted) {
    const path = file.file_path || '';
    const parts = path.split('/').filter(Boolean);
    const name = parts[parts.length - 1] || path;
    const depth = parts.length - 1;
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

    const node: any = {
      path,
      name,
      is_directory: !!file.is_directory,
      depth,
      data: file,
      children: file.is_directory ? [] : undefined,
    };

    if (file.is_directory) {
      dirMap.set(path, node.children!);
    }

    if (parentPath && dirMap.has(parentPath)) {
      dirMap.get(parentPath)!.push(node);
    } else {
      result.push(node);
    }
  }

  return result;
}

// 可见文件树（根据展开状态过滤）
const visibleFileTree = computed(() => {
  const result: any[] = [];
  function walk(nodes: any[]) {
    for (const node of nodes) {
      result.push(node);
      if (node.is_directory && node.children && expandedDirs.value.has(node.path)) {
        walk(node.children);
      }
    }
  }
  walk(fileTree.value);
  return result;
});

function toggleDir(path: string) {
  const s = new Set(expandedDirs.value);
  if (s.has(path)) {
    s.delete(path);
  } else {
    s.add(path);
  }
  expandedDirs.value = s;
}

// ===== 标签页管理 =====
async function openFileInTab(node: any) {
  if (node.is_directory) {
    toggleDir(node.path);
    return;
  }
  // 检查是否已打开
  const existing = openTabs.value.find(t => t.path === node.path);
  if (existing) {
    activeTabPath.value = existing.path;
    return;
  }
  // 加载文件内容
  try {
    const data = await hostingApi.getFile(node.path);
    const isText = isTextFile(node.path);
    const tab: Tab = {
      path: node.path,
      name: node.name,
      type: node.path.split('.').pop()?.toUpperCase() || '文件',
      isText,
      content: isText ? (data.content || '') : '',
      dirty: false,
      data,
    };
    openTabs.value.push(tab);
    activeTabPath.value = tab.path;
  } catch (e: any) {
    showToast('error', '无法加载文件: ' + (e.message || '未知错误'));
  }
}

function switchTab(path: string) {
  activeTabPath.value = path;
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

// ===== 标签页右键菜单 + 拖动排序 =====
const tabCtx = useTabContextMenu({
  getTabs: () => openTabs.value,
  getActiveId: () => activeTabPath.value,
  setActive: (id) => { activeTabPath.value = id; },
  removeTabs: (ids) => removeTabsBulk(ids),
  saveActive: saveTabActive,
});
function onOpenTabMenu(id: string, e: MouseEvent) { tabCtx.open(id, e); }

function removeTabsBulk(ids: string[]) {
  const idSet = new Set(ids);
  const hadActive = activeTabPath.value && idSet.has(activeTabPath.value);
  const prevIdx = activeTabPath.value ? openTabs.value.findIndex(t => t.path === activeTabPath.value) : -1;
  openTabs.value = openTabs.value.filter(t => !idSet.has(t.path));
  if (hadActive) {
    if (openTabs.value.length === 0) {
      activeTabPath.value = '';
    } else {
      const idx = Math.min(prevIdx, openTabs.value.length - 1);
      activeTabPath.value = (openTabs.value[Math.max(0, idx)] || openTabs.value[0]).path;
    }
  }
}

async function saveTabActive(): Promise<boolean> {
  if (!activeTab.value) return false;
  await saveCurrentTab();
  return true;
}

// 拖动排序
let dragTabIdx = -1;
function onTabDragStart(i: number, e: DragEvent) { dragTabIdx = i; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }
function onTabDragOver(i: number) {
  if (dragTabIdx < 0 || dragTabIdx === i) return;
  const arr = [...openTabs.value];
  const [item] = arr.splice(dragTabIdx, 1);
  arr.splice(i, 0, item);
  openTabs.value = arr;
  dragTabIdx = i;
}
function onTabDrop() { dragTabIdx = -1; }
function onTabDragEnd() { dragTabIdx = -1; }

async function saveCurrentTab() {
  const tab = activeTab.value;
  if (!tab || !tab.isText || saving.value) return;
  saving.value = true;
  try {
    const result = await hostingApi.saveFile({ path: tab.path, content: tab.content });
    tab.dirty = false;
    const dbSize = result.actual_size !== undefined ? ` (数据库: ${result.actual_size})` : '';
    showToast('success', `文件已保存: ${tab.content.length} 字符${dbSize}`);
    await loadFiles();
    await loadUsage();
    await loadReviewStatus();
  } catch (e: any) {
    showToast('error', e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

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
const ribbonManifest = computed(() => dynamicPluginRibbon.value);
const systemRightTools = computed(() => {
  if (!editorPlugin.value) return [];
  return [
    { id: 'reload', label: '重载编辑器', icon: 'ri-refresh-line', command: 'reload' },
    { id: 'toggle-view', label: isSourceView.value ? '可视化编辑器' : '查看源文件', icon: isSourceView.value ? 'ri-eye-line' : 'ri-code-box-line', type: 'select', command: 'toggle-view' },
  ];
});

// ===== Ribbon 回调 =====
function onRibbonTool(tool: any) {
  if (tool.command === 'find') openFilePanel('find');
  else if (tool.command === 'replace') openFilePanel('find');
  else if (tool.command === 'goto') editorPaneRef.value?.gotoLine();
  else if (tool.command === 'history') openFilePanel('history');
  else if (tool.command === 'version') openFilePanel('version');
  else if (tool.command === 'share') { if (activeTab.value) showShareDialog.value = true; }
  else if (tool.command === 'import') handleImport();
  else if (tool.command === 'export') handleExport();
  else if (tool.command === 'fullscreen') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
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
  const tab = activeTab.value;
  if (!tab) return;
  if (tab.dirty && !confirm('刷新将丢弃未保存的内容，是否继续？')) return;
  try {
    const data = await hostingApi.getFile(tab.path);
    tab.content = data.content || '';
    tab.dirty = false;
    editorPaneRef.value?.setValue(tab.content);
  } catch (e: any) {
    showToast('error', '刷新失败: ' + (e.message || '未知错误'));
  }
}
function onAutoSaveChange(v: boolean) { autoSave.value = v; }

// ===== 撤销/重做/导入/导出 =====
function handleUndo() { editorPaneRef.value?.undo(); }
function handleRedo() { editorPaneRef.value?.redo(); }
function handleImport() {
  if (!activeTab.value) return;
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
      activeTab.value!.content = content;
      activeTab.value!.dirty = true;
      editorPaneRef.value?.setValue(content);
      addLocalHistory(content);
    };
    reader.readAsText(file);
  };
  input.click();
}
function handleExport() {
  if (!activeTab.value) return;
  const blob = new Blob([activeTab.value.content || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = activeTab.value.name;
  a.click();
  URL.revokeObjectURL(url);
}

// 查找替换
function doFind() {
  const tab = activeTab.value;
  if (!tab || !findText.value) { showToast('error', '未找到'); return; }
  const idx = tab.content.indexOf(findText.value);
  if (idx === -1) showToast('error', '未找到');
  else showToast('success', `找到匹配项（位置 ${idx}）`);
}
function doReplace() {
  const tab = activeTab.value;
  if (!tab || !findText.value) return;
  tab.content = tab.content.replace(findText.value, replaceText.value);
  tab.dirty = true;
}
function doReplaceAll() {
  const tab = activeTab.value;
  if (!tab || !findText.value) return;
  tab.content = tab.content.split(findText.value).join(replaceText.value);
  tab.dirty = true;
}

// ===== 数据加载 =====
async function loadSpace() {
  try {
    const data = await hostingApi.getSpace();
    space.value = data;
    spaceForm.value = { title: data.title || '', description: data.description || '', slug: data.slug || '', is_enabled: !!data.is_enabled };
  } catch (e: any) { showToast('error', e.message || '加载空间信息失败'); }
}
async function loadFiles() {
  try {
    const data = await hostingApi.listFiles();
    files.value = data.files || [];
    fileTree.value = buildFileTree(files.value);
  } catch (e: any) { showToast('error', e.message || '加载文件列表失败'); }
}
async function loadUsage() {
  try {
    const data = await hostingApi.getUsage();
    usage.value = { usedBytes: data.used_bytes || 0, quotaBytes: data.quota_bytes || 0, usedDisplay: formatBytes(data.used_bytes || 0), quotaDisplay: formatBytes(data.quota_bytes || 0), percent: data.used_percent || 0, fileCount: data.file_count || 0 };
  } catch { /* ignore */ }
}

async function loadReviewStatus() {
  try {
    reviewStatus.value = await hostingApi.getReviewStatus();
  } catch { /* ignore */ }
}

async function createNewFile() {
  const name = newFileName.value.trim();
  if (!name) { showToast('error', '请输入文件名'); return; }
  if (!name.includes('.')) { showToast('error', '文件名需要包含扩展名（如 .html）'); return; }
  const path = '/' + name;
  showNewFileDialog.value = false;
  newFileName.value = '';
  try {
    await hostingApi.saveFile({ path, content: '', content_type: null });
    showToast('success', '文件已创建');
    await loadFiles();
    await loadUsage();
    await nextTick();
    const node = visibleFileTree.value.find(n => n.path === path);
    if (node) openFileInTab(node);
  } catch (e: any) { showToast('error', e.message || '创建失败'); }
}
async function createNewDir() {
  const name = newDirName.value.trim();
  if (!name) { showToast('error', '请输入目录名'); return; }
  const path = '/' + name;
  showNewDirDialog.value = false;
  newDirName.value = '';
  try {
    await hostingApi.createDirectory(path);
    showToast('success', '目录已创建');
    await loadFiles();
    await loadUsage();
    // 自动展开新建的目录
    const s = new Set(expandedDirs.value);
    s.add(path);
    expandedDirs.value = s;
  } catch (e: any) { showToast('error', e.message || '创建失败'); }
}
function confirmDelete(node: any) { deleteTarget.value = node; }
function confirmDeleteByPath() {
  const tab = activeTab.value;
  if (!tab) return;
  const node = fileTree.value.find(n => n.path === tab.path);
  if (node) confirmDelete(node);
}
async function executeDelete() {
  if (!deleteTarget.value) return;
  const path = deleteTarget.value.path;
  deleteTarget.value = null;
  try {
    await hostingApi.deleteFile(path);
    showToast('success', '已删除');
    closeTab(path);
    await loadFiles();
    await loadUsage();
  } catch (e: any) { showToast('error', e.message || '删除失败'); }
}
async function refreshFiles() { await loadFiles(); await loadUsage(); }

// ===== 上传/下载 =====
function triggerUpload() { uploadInput.value?.click(); }
async function onUploadFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await hostingApi.upload(file, '/');
    showToast('success', '文件已上传');
    await loadFiles();
    await loadUsage();
  } catch (err: any) { showToast('error', err.message || '上传失败'); }
  input.value = '';
}
function downloadFile(path: string) {
  window.open(hostingApi.downloadUrl(path), '_blank');
}

// ===== 设置 =====
async function saveSettings() {
  if (savingSettings.value) return;
  savingSettings.value = true;
  try {
    const data = await hostingApi.updateSpace({ title: spaceForm.value.title, description: spaceForm.value.description, slug: spaceForm.value.slug, is_enabled: spaceForm.value.is_enabled });
    space.value = data.space || data;
    showToast('success', '设置已保存');
    await loadUsage();
  } catch (e: any) { showToast('error', e.message || '保存设置失败'); }
  finally { savingSettings.value = false; }
}
function copyUrl() {
  if (!space.value) return;
  const url = window.location.origin + '/site/' + space.value.slug;
  navigator.clipboard.writeText(url).then(() => showToast('success', '链接已复制'), () => showToast('error', '复制失败'));
}
function goToLogin() { router.push('/login'); }

onMounted(async () => {
  loading.value = true;
  if (isAlliance.value) {
    await Promise.all([loadSpace(), loadFiles(), loadUsage(), loadReviewStatus()]);
  }
  loading.value = false;
});
</script>

<style scoped>
.web-homepage { display: flex; height: 100%; min-height: 0; background: var(--app-bg); overflow: hidden; }
.homepage-sidebar { width: 220px; flex-shrink: 0; background: var(--layer-default); border-right: 1px solid var(--divider-stroke); display: flex; flex-direction: column; }
.sidebar-brand { padding: var(--spacer-4) var(--spacer-3); display: flex; align-items: center; gap: var(--spacer-2); border-bottom: 1px solid var(--divider-stroke); }
.brand-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--accent-bg); color: var(--accent-base); border-radius: var(--radius-md); flex-shrink: 0; }
.brand-texts { flex: 1; min-width: 0; }
.brand-title { font-size: var(--font-size-base); font-weight: 700; color: var(--text-primary); line-height: 1.2; }
.brand-sub { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 2px; font-family: var(--font-mono, monospace); }
.sidebar-nav { flex: 1; padding: var(--spacer-2); display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.nav-item { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-3); background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-secondary); font-size: var(--font-size-sm); cursor: pointer; text-align: left; transition: background var(--fast-duration), color var(--fast-duration); }
.nav-item:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.nav-item.active { background: var(--subtle-accent); color: var(--accent-base); font-weight: 600; }
.sidebar-footer { padding: var(--spacer-3); border-top: 1px solid var(--divider-stroke); background: var(--subtle-secondary); }
.space-preview { display: flex; align-items: center; gap: var(--spacer-1); background: var(--ctrl-fill-default); border: 1px solid var(--divider-stroke); border-radius: var(--radius-sm); padding: var(--spacer-1) var(--spacer-2); font-size: var(--font-size-xs); }
.preview-link { flex: 1; min-width: 0; color: var(--accent-base); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview-link:hover { text-decoration: underline; }
.copy-btn { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: var(--radius-xs); color: var(--text-tertiary); cursor: pointer; }
.copy-btn:hover { background: var(--subtle-pressed); color: var(--text-primary); }

.homepage-content { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: auto; padding: var(--spacer-5); gap: var(--spacer-4); }
.homepage-content.content-immersive { padding: 0; overflow: hidden; gap: 0; }

.stats-row { display: flex; gap: var(--spacer-3); flex-wrap: wrap; }
.stat-card { flex: 1; min-width: 180px; display: flex; align-items: center; gap: var(--spacer-3); padding: var(--spacer-3) var(--spacer-4); background: var(--card-bg); border: 1px solid var(--card-stroke); border-radius: var(--radius-lg); position: relative; }
.stat-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--subtle-secondary); border-radius: var(--radius-md); color: var(--accent-base); flex-shrink: 0; }
.stat-info { display: flex; flex-direction: column; gap: 2px; }
.stat-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.stat-value { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); }
.usage-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: var(--subtle-secondary); border-radius: 0 0 var(--radius-lg) var(--radius-lg); overflow: hidden; }
.usage-fill { height: 100%; background: var(--accent-base); border-radius: 0 0 var(--radius-lg) var(--radius-lg); transition: width var(--normal-duration); }
.overview-actions { display: flex; gap: var(--spacer-2); }

.files-immersion { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--app-bg); overflow: hidden; }
.immersion-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.file-tree-panel { display: flex; flex-direction: column; background: var(--layer-default); border-right: 1px solid var(--divider-stroke); min-width: 180px; max-width: 45%; flex: 1 1 auto; }
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: var(--spacer-2) var(--spacer-3); border-bottom: 1px solid var(--divider-stroke); flex-shrink: 0; }
.panel-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); }
.panel-actions { display: flex; gap: 2px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: transparent; color: var(--text-tertiary); border-radius: var(--radius-sm); cursor: pointer; transition: background var(--fast-duration), color var(--fast-duration); }
.icon-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.file-tree { flex: 1; overflow-y: auto; padding: var(--spacer-1) 0; }
.tree-node { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-1) var(--spacer-3); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary); transition: background var(--fast-duration); user-select: none; }
.tree-node:hover { background: var(--subtle-secondary); }
.tree-node.is-active { background: var(--subtle-accent); color: var(--text-primary); }
.tree-node.is-active .node-icon { color: var(--accent-base); }
.tree-node.is-dir { font-weight: 500; color: var(--text-primary); }
.node-chevron { flex-shrink: 0; color: var(--text-tertiary); margin-left: -4px; }
.node-icon { flex-shrink: 0; color: var(--text-tertiary); }
.node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-size { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.ft-empty { display: flex; flex-direction: column; align-items: center; gap: var(--spacer-1); padding: var(--spacer-4); color: var(--text-tertiary); font-size: var(--font-size-xs); }

.editor-splitter { width: 4px; background: transparent; cursor: col-resize; flex-shrink: 0; position: relative; z-index: 5; }
.editor-splitter:hover { background: var(--accent-base); }
.editor-right-col { display: flex; flex-direction: column; min-width: 0; }
.editor-right-body { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.editor-area { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--app-bg); }

.right-panel { display: flex; flex-direction: column; background: var(--layer-default); border-left: 1px solid var(--divider-stroke); flex-shrink: 0; min-width: 0; position: relative; }
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

/* 面板选择器 */
.panel-picker { position: absolute; top: 100%; right: 0; min-width: 160px; background: var(--flyout-bg); border: 1px solid var(--flyout-border); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: 100; padding: var(--spacer-1); }
.panel-picker-title { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); padding: var(--spacer-1) var(--spacer-2); }
.panel-picker-item { display: flex; align-items: center; gap: var(--spacer-2); width: 100%; padding: var(--spacer-1) var(--spacer-2); border: none; background: transparent; color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-sm); }
.panel-picker-item:hover { background: var(--subtle-secondary); }
.panel-picker-item.disabled { opacity: 0.4; cursor: not-allowed; }
.check-icon { margin-left: auto; color: var(--status-success); }
.right-panel-content { flex: 1; overflow: auto; display: flex; flex-direction: column; }
.props-panel, .find-panel, .actions-panel { padding: var(--spacer-3); }
.panel-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: var(--spacer-2); color: var(--text-tertiary); padding: var(--spacer-6) var(--spacer-3); }
.property-list { display: flex; flex-direction: column; gap: var(--spacer-3); }
.property-item { display: flex; flex-direction: column; gap: var(--spacer-1); }
.property-item label { font-size: var(--font-size-xs); color: var(--text-tertiary); font-weight: 500; }
.property-item span { font-size: var(--font-size-sm); color: var(--text-primary); }
.property-item span.mono { font-family: var(--font-mono, monospace); word-break: break-all; }
.find-section { display: flex; flex-direction: column; gap: var(--spacer-2); }
.find-row { display: flex; align-items: center; gap: var(--spacer-2); }
.find-row input { flex: 1; padding: var(--spacer-1) var(--spacer-2); background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-primary); outline: none; }
.find-row input:focus { border-color: var(--accent-base); }
.find-btn { padding: var(--spacer-1) var(--spacer-2); background: var(--subtle-secondary); border: 1px solid var(--ctrl-border); border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-secondary); cursor: pointer; }
.find-btn:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.action-list { display: flex; flex-direction: column; gap: var(--spacer-1); }
.action-item { display: flex; align-items: flex-start; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-3); background: var(--subtle-secondary); border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; text-align: left; }
.action-item:hover:not(:disabled) { background: var(--subtle-pressed); border-color: var(--divider-stroke); }
.action-item:disabled { opacity: 0.5; cursor: not-allowed; }
.action-title { font-size: var(--font-size-sm); font-weight: 600; }
.action-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 2px; }

.immersion-status { display: flex; justify-content: space-between; align-items: center; height: 24px; background: var(--subtle-secondary); border-top: 1px solid var(--divider-stroke); padding: 0 var(--spacer-3); font-size: 10px; color: var(--text-tertiary); flex-shrink: 0; }
.status-left, .status-right { display: flex; gap: var(--spacer-3); align-items: center; }
.status-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.status-item.dirty { color: var(--status-warning); }

.settings-card { padding: var(--spacer-4); background: var(--card-bg); border: 1px solid var(--card-stroke); border-radius: var(--radius-lg); }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--spacer-3); margin-bottom: var(--spacer-4); }
.setting-item { display: flex; flex-direction: column; gap: var(--spacer-1); }
.setting-label { font-size: var(--font-size-sm); font-weight: 500; color: var(--text-secondary); }
.setting-input { height: 36px; padding: 0 var(--spacer-3); background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border-rest); border-radius: var(--radius-sm); color: var(--text-primary); font-size: var(--font-size-sm); outline: none; transition: border-color var(--fast-duration); }
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
.settings-footer { display: flex; justify-content: flex-start; }

.danger-btn { display: inline-flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); background: var(--status-error); color: white; border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; transition: opacity var(--fast-duration); }
.danger-btn:hover { opacity: 0.9; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--spacer-8); gap: var(--spacer-3); color: var(--text-tertiary); }

.error-state { display: flex; align-items: center; justify-content: center; padding: var(--spacer-8); }
.error-card { text-align: center; max-width: 400px; padding: var(--spacer-6); background: var(--card-bg); border: 1px solid var(--card-stroke); border-radius: var(--radius-xl); color: var(--text-tertiary); }
.error-card h2 { color: var(--text-primary); margin: var(--spacer-3) 0 var(--spacer-2); }
.error-card p { margin: 0 0 var(--spacer-4); font-size: var(--font-size-sm); line-height: 1.6; }

.delete-message { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0 0 var(--spacer-4); line-height: 1.6; }
.delete-message code { background: var(--subtle-secondary); padding: 1px var(--spacer-1); border-radius: var(--radius-xs); font-size: 12px; font-family: monospace; }
.delete-warning { display: block; color: var(--status-error); margin-top: var(--spacer-2); font-size: var(--font-size-xs); }

.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) var(--spacer-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); z-index: 600; animation: slideUp var(--fast-duration); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); }
.toast-success { background: #10893e; color: white; }
.toast-error { background: var(--status-error); color: white; }
@keyframes slideUp { from { transform: translateX(-50%) translateY(16px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }

/* 审查横幅 */
.review-banner {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-4);
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 1px solid #f59e0b;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: #92400e;
  flex-shrink: 0;
}
.review-separator { color: #d97706; margin: 0 var(--spacer-1); }
.review-preview-link { color: #b45309; font-weight: 600; text-decoration: underline; margin-left: var(--spacer-1); }
.review-preview-link:hover { color: #92400e; }

/* 管理员禁用标签 */
.admin-disabled-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: var(--spacer-2);
  padding: var(--spacer-2);
  background: rgba(196, 43, 28, 0.08);
  border: 1px solid rgba(196, 43, 28, 0.2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: #C42B1C;
  font-weight: 500;
}
.admin-disabled-badge .disabled-reason {
  font-size: 11px;
  color: #999;
  font-weight: 400;
  font-style: italic;
}

/* 审查状态栏项 */
.status-item.pending-review {
  color: #d97706;
  font-weight: 500;
}

/* ===== 标签栏（Ribbon 下方） ===== */
.editor-tabs-row {
  display: flex; align-items: center;
  background: var(--ctrl-fill-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-2);
  flex-shrink: 0; overflow: hidden;
}
.editor-tabs { display: flex; align-items: center; gap: var(--spacer-1); flex: 1; overflow-x: auto; scrollbar-width: thin; padding: var(--spacer-1) 0; }
.editor-tab {
  display: inline-flex; align-items: center; gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--subtle-secondary); border: 1px solid transparent;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer;
  white-space: nowrap; margin-bottom: -1px; user-select: none;
}
.editor-tab:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.editor-tab.active { background: var(--ctrl-fill-default); border-color: var(--divider-stroke); border-bottom-color: transparent; color: var(--text-primary); font-weight: 500; }
.editor-tab .tab-icon { flex-shrink: 0; color: var(--text-tertiary); }
.editor-tab.active .tab-icon { color: var(--accent-base); }
.editor-tab .tab-title { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.dirty-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--status-warning); flex-shrink: 0; }
.tab-close { height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: var(--radius-full); color: var(--text-tertiary); cursor: pointer; font-size: 14px; line-height: 1; flex-shrink: 0; margin-left: 2px; }
.tab-close:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.editor-tab[draggable='true'] { cursor: grab; }
.editor-tab[draggable='true']:active { cursor: grabbing; }

/* ===== 标签右键菜单 ===== */
.tab-menu-overlay { position: fixed; inset: 0; z-index: 2000; }
.tab-menu {
  position: fixed; min-width: 168px;
  background: var(--flyout-bg); border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  padding: var(--spacer-1); z-index: 2001;
}
.tm-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: var(--spacer-2) var(--spacer-3); border: none; background: transparent; color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-sm); text-align: left; }
.tm-item:hover { background: var(--subtle-secondary); }
.tm-divider { height: 1px; background: var(--divider-stroke); margin: var(--spacer-1) 0; }

/* ===== 沉浸模式 ===== */
.web-homepage.immersive .homepage-sidebar { display: none; }
.web-homepage.immersive .content-immersive { padding: 0; }
.web-homepage.immersive .files-immersion .editor-tabs-row { display: none; }
.web-homepage.immersive .files-immersion .immersion-body .file-tree-panel { display: none; }
.web-homepage.immersive .files-immersion .immersion-body .editor-splitter { display: none; }
.web-homepage.immersive .files-immersion .immersion-body .right-panel { display: none; }
</style>