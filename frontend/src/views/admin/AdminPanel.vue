<template>
  <div class="admin-panel">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">{{ sectionTitle }}</h1>
        <p class="page-description">
          <span v-if="user?.is_temp_admin" class="admin-badge temp">
            <Icon icon="ri-shield-keyhole-line" :size="14" /> 临时管理员
          </span>
          <span v-else class="admin-badge super">
            <Icon icon="ri-vip-crown-line" :size="14" /> 最高管理员
          </span>
        </p>
      </div>
    </div>

    <!-- ===== 系统配置 ===== -->
    <template v-if="currentSection === 'overview'">
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-settings-3-line" :size="20" />
          系统配置
        </h2>
        <div class="config-cards">
          <div class="config-card">
            <div class="config-card-header">
              <Icon icon="ri-shield-keyhole-line" :size="24" />
              <div>
                <h3>临时管理员模式</h3>
                <p>允许使用服务器配置的账户登录，拥有全部权限</p>
              </div>
            </div>
            <div class="config-card-body">
              <div class="config-status">
                <span class="status-label">当前状态</span>
                <span class="status-value" :class="{ on: tempAdminEnabled }">
                  {{ tempAdminEnabled ? '已启用' : '已禁用' }}
                </span>
              </div>
              <div class="config-info">
                <span class="info-label">管理员用户名</span>
                <code>{{ tempAdminUser }}</code>
              </div>
              <button v-if="!user?.is_temp_admin" class="btn btn-primary" @click="toggleTempAdmin(!tempAdminEnabled)"
                :disabled="busy">
                {{ tempAdminEnabled ? '禁用临时管理员模式' : '启用临时管理员模式' }}
              </button>
              <p v-else class="config-note">
                <Icon icon="ri-information-line" :size="14" />
                临时管理员不能禁用自身模式，请由最高管理员操作
              </p>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ===== 用户管理 ===== -->
    <template v-if="currentSection === 'users'">
      <div class="filter-bar">
        <div class="filter-search">
          <Icon icon="ri-search-line" :size="14" />
          <input v-model="userSearch" placeholder="搜索用户名、显示名或学校..." />
        </div>
      </div>

      <div v-if="userLoading" class="loading-state">
        <Icon icon="ri-loader-4-line" :size="24" class="spin" />
        <span>加载中...</span>
      </div>

      <div v-else class="data-table">
        <div class="table-header">
          <div class="col-name">用户</div>
          <div class="col-school">学校</div>
          <div class="col-role">角色</div>
          <div class="col-super">最高管理员</div>
          <div class="col-status">状态</div>
          <div class="col-actions">操作</div>
        </div>
        <div v-if="filteredUsers.length > 0">
          <div v-for="u in filteredUsers" :key="'usr-' + u.id" class="table-row">
            <div class="col-name">
              <div class="user-avatar">{{ (u.display_name || u.username)[0] }}</div>
              <div class="user-info">
                <div class="user-name">{{ u.display_name }}</div>
                <div class="user-sub">{{ u.username }} <span class="user-school">@ {{ u.school_name }}</span></div>
              </div>
            </div>
            <div class="col-school">
              <span class="school-tag">{{ u.school_name }}</span>
            </div>
            <div class="col-role">
              <span class="role-pill" :class="u.role">{{ getRoleLabel(u.role) }}</span>
            </div>
            <div class="col-super">
              <button class="toggle-btn" :class="{ on: u.is_super_admin }" @click="toggleSuperAdmin(u)" :disabled="busy"
                :title="u.is_super_admin ? '撤销最高管理员' : '设为最高管理员'">
                {{ u.is_super_admin ? '是' : '否' }}
              </button>
            </div>
            <div class="col-status">
              <span class="status-pill" :class="u.status">{{ u.status === 'active' ? '正常' : '禁用' }}</span>
            </div>
            <div class="col-actions">
              <button class="icon-btn-sm" title="设置角色" @click="openRoleDialog(u)">
                <Icon icon="ri-user-settings-line" :size="14" />
              </button>
              <button class="icon-btn-sm" title="重置密码" @click="openResetPwdDialog(u)">
                <Icon icon="ri-key-2-line" :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon">
            <Icon icon="ri-user-search-line" :size="48" />
          </div>
          <div class="empty-text">暂无匹配用户</div>
        </div>
      </div>
    </template>

    <!-- ===== 通知管理 ===== -->
    <template v-if="currentSection === 'notifications'">
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-send-plane-line" :size="20" />
          下发系统通知
        </h2>
        <div class="config-cards">
          <div class="config-card">
            <div class="config-card-header">
              <Icon icon="ri-notification-3-line" :size="24" />
              <div>
                <h3>新建通知</h3>
                <p>向指定范围发送系统通知</p>
              </div>
            </div>
            <div class="config-card-body">
              <div class="form-group">
                <label>通知范围</label>
                <div class="type-options">
                  <label v-for="s in scopeOptions" :key="s.value" class="type-option"
                    :class="{ active: notifScope === s.value }">
                    <input type="radio" v-model="notifScope" :value="s.value" hidden />
                    <Icon :icon="s.icon" :size="16" />
                    {{ s.label }}
                  </label>
                </div>
              </div>
              <div class="form-group" v-if="notifScope === 'school'">
                <label>目标学校</label>
                <select v-model="adminNotifForm.school_id">
                  <option :value="0">-- 请选择学校 --</option>
                  <option v-for="s in schoolList" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>通知类型</label>
                <div class="type-options">
                  <label v-for="t in adminNotifTypes" :key="t.value" class="type-option"
                    :class="{ active: adminNotifForm.type === t.value }">
                    <input type="radio" v-model="adminNotifForm.type" :value="t.value" hidden />
                    <Icon :icon="t.icon" :size="16" />
                    {{ t.label }}
                  </label>
                </div>
              </div>
              <div class="form-group">
                <label>通知对象</label>
                <div class="type-options">
                  <label v-for="t in adminTargetOptions" :key="t.value" class="type-option"
                    :class="{ active: adminNotifForm.target_type === t.value }">
                    <input type="radio" v-model="adminNotifForm.target_type" :value="t.value" hidden />
                    <Icon :icon="t.icon" :size="16" />
                    {{ t.label }}
                  </label>
                </div>
              </div>
              <div class="form-group" v-if="adminNotifForm.target_type !== 'all'">
                <label>{{ adminNotifForm.target_type === 'role' ? '选择角色' : '选择用户' }}</label>
                <select v-model="adminNotifForm.target_id">
                  <option value="">-- 请选择 --</option>
                  <option v-for="r in adminNotifTargetList" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>通知标题 <span class="required">*</span></label>
                <input v-model="adminNotifForm.title" placeholder="输入通知标题" maxlength="100" />
              </div>
              <div class="form-group">
                <label>通知内容</label>
                <textarea v-model="adminNotifForm.content" placeholder="输入通知内容" rows="3" maxlength="500"></textarea>
              </div>
              <button class="btn btn-primary" @click="sendAdminNotification"
                :disabled="adminNotifBusy || !adminNotifForm.title">
                <Icon icon="ri-send-plane-line" :size="14" />
                {{ adminNotifBusy ? '发送中...' : '发送通知' }}
              </button>
              <p v-if="adminNotifMsg" class="admin-notif-msg" :class="{ error: adminNotifError }">
                {{ adminNotifMsg }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ===== AI 配置 ===== -->
    <template v-if="currentSection === 'ai-config'">
      <!-- 默认模型设置 -->
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-brain-line" :size="20" />
          默认模型
        </h2>
        <div class="config-cards">
          <div class="config-card">
            <div class="config-card-header">
              <Icon icon="ri-settings-3-line" :size="24" />
              <div>
                <h3>系统默认 AI 模型</h3>
                <p>设置所有用户默认使用的 AI 模型，用户可在对话中切换</p>
              </div>
            </div>
            <div class="config-card-body">
              <div class="form-group">
                <label>默认模型</label>
                <select v-model="aiConfigForm.default_model">
                  <option value="default">规则引擎（内置）</option>
                  <option v-for="m in aiModels" :key="m.id" :value="m.name">{{ m.name }} ({{ m.provider }})</option>
                </select>
              </div>
              <button class="btn btn-primary" @click="saveAiConfig" :disabled="aiConfigBusy">
                {{ aiConfigBusy ? '保存中...' : '保存设置' }}
              </button>
              <p v-if="aiConfigMsg" class="admin-notif-msg" :class="{ error: aiConfigError }">{{ aiConfigMsg }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 模型管理 -->
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-cpu-line" :size="20" />
          模型管理
        </h2>
        <div class="config-cards">
          <div class="config-card config-card-full">
            <div class="config-card-header">
              <Icon icon="ri-list-check" :size="24" />
              <div>
                <h3>已注册模型</h3>
                <p>管理系统级 AI 模型，所有用户均可使用</p>
              </div>
            </div>
            <div class="config-card-body">
              <div class="model-list">
                <div class="model-item add-new" v-if="!showAiModelForm">
                  <button class="add-new-btn" @click="openAiModelForm">
                    <Icon icon="ri-add-line" :size="18" />
                    <span>添加系统模型</span>
                  </button>
                </div>
                <div v-for="m in aiModels" :key="m.id" class="model-item" :class="{ disabled: !m.is_enabled }">
                  <div class="model-info">
                    <div class="model-name">
                      <span class="status-dot" :class="m.is_enabled ? 'enabled' : 'disabled'"></span>
                      {{ m.name }}
                      <span v-if="m.name === aiConfigForm.default_model" class="default-badge">默认</span>
                    </div>
                    <div class="model-meta">{{ m.provider }} · {{ m.model_id || '默认' }}</div>
                  </div>
                  <div class="model-actions">
                    <button class="icon-btn-sm" @click="editAiModel(m)" title="编辑">
                      <Icon icon="ri-edit-line" :size="14" />
                    </button>
                    <button class="icon-btn-sm" @click="toggleAiModel(m)" :title="m.is_enabled ? '禁用' : '启用'">
                      <Icon :icon="m.is_enabled ? 'ri-toggle-line' : 'ri-toggle-fill'" :size="14" />
                    </button>
                    <button class="icon-btn-sm danger" @click="deleteAiModelConfirm(m)" title="删除">
                      <Icon icon="ri-delete-bin-line" :size="14" />
                    </button>
                  </div>
                </div>
                <div v-if="aiModels.length === 0 && !showAiModelForm" class="model-empty">
                  <Icon icon="ri-brain-line" :size="32" />
                  <p>暂无系统模型</p>
                  <span>添加模型后所有用户均可使用</span>
                </div>
              </div>

              <!-- 模型表单 -->
              <div v-if="showAiModelForm" class="model-form">
                <div class="form-row">
                  <label>模型名称</label>
                  <input v-model="aiModelForm.name" type="text" placeholder="例如：GPT-4o" />
                </div>
                <div class="form-row">
                  <label>提供商</label>
                  <select v-model="aiModelForm.provider">
                    <option value="">选择提供商</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai_compatible">OpenAI 兼容</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="google">Google (Gemini)</option>
                  </select>
                </div>
                <div class="form-row">
                  <label>模型 ID</label>
                  <input v-model="aiModelForm.model_id" type="text" placeholder="例如：gpt-4o" />
                </div>
                <div class="form-row">
                  <label>API 端点（可选）</label>
                  <input v-model="aiModelForm.endpoint" type="text" placeholder="留空使用默认端点" />
                </div>
                <div class="form-row">
                  <label>API Key</label>
                  <input v-model="aiModelForm.api_key" type="password" placeholder="sk-..." />
                </div>
                <div class="form-actions">
                  <button class="secondary-btn" @click="cancelAiModelForm">取消</button>
                  <button class="primary-btn" @click="saveAiModel">{{ editingAiModelId ? '更新' : '添加' }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 知识库管理 -->
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-book-open-line" :size="20" />
          知识库管理
        </h2>
        <div class="config-cards">
          <div class="config-card config-card-full">
            <div class="config-card-header">
              <Icon icon="ri-database-2-line" :size="24" />
              <div>
                <h3>知识库条目</h3>
                <p>添加知识库内容，AI 将基于这些内容回答用户问题</p>
              </div>
              <button class="btn btn-primary"
                @click="showKbForm = true; editingKbId = null; kbForm = { title: '', content: '', category: '' }"
                style="margin-left: auto;">
                <Icon icon="ri-add-line" :size="14" />
                添加条目
              </button>
            </div>
            <div class="config-card-body">
              <!-- 知识库列表 -->
              <div v-if="kbLoading" class="loading-state">
                <Icon icon="ri-loader-4-line" :size="24" class="spin" />
                <span>加载中...</span>
              </div>
              <div v-else-if="kbEntries.length === 0" class="model-empty">
                <Icon icon="ri-book-open-line" :size="32" />
                <p>暂无知识库条目</p>
                <span>添加知识库内容后，AI 将能更准确地回答平台相关问题</span>
              </div>
              <div v-else class="kb-list">
                <div v-for="entry in kbEntries" :key="entry.id" class="kb-item">
                  <div class="kb-item-header">
                    <div class="kb-item-title">
                      <Icon icon="ri-file-text-line" :size="14" />
                      {{ entry.title }}
                    </div>
                    <span class="kb-item-category" v-if="entry.category">{{ entry.category }}</span>
                  </div>
                  <div class="kb-item-content">{{ entry.content?.substring(0, 200) }}{{ entry.content?.length > 200 ?
                    '...' : '' }}</div>
                  <div class="kb-item-footer">
                    <span class="kb-item-time">{{ entry.updated_at }}</span>
                    <div class="kb-item-actions">
                      <button class="icon-btn-sm" @click="editKbEntry(entry)" title="编辑">
                        <Icon icon="ri-edit-line" :size="14" />
                      </button>
                      <button class="icon-btn-sm danger" @click="deleteKbEntry(entry.id)" title="删除">
                        <Icon icon="ri-delete-bin-line" :size="14" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 知识库表单 -->
              <div v-if="showKbForm" class="model-form" style="margin-top: var(--spacer-3);">
                <div class="form-row">
                  <label>标题 <span class="required">*</span></label>
                  <input v-model="kbForm.title" type="text" placeholder="知识条目标题" />
                </div>
                <div class="form-row">
                  <label>分类</label>
                  <input v-model="kbForm.category" type="text" placeholder="例如：轻编辑器、静态集控、常见问题" />
                </div>
                <div class="form-row">
                  <label>内容 <span class="required">*</span></label>
                  <textarea v-model="kbForm.content" placeholder="知识条目内容，支持 Markdown 格式" rows="6"></textarea>
                </div>
                <div class="form-actions">
                  <button class="secondary-btn" @click="showKbForm = false; editingKbId = null">取消</button>
                  <button class="primary-btn" @click="saveKbEntry" :disabled="kbBusy">{{ editingKbId ? '更新' : '添加'
                    }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ===== 网页空间管理 ===== -->
    <template v-if="currentSection === 'web-hosting'">
      <!-- 审查项目 -->
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-shield-check-line" :size="20" />
          审查项目
        </h2>
        <div class="config-cards">
          <div class="config-card config-card-full">
            <div class="config-card-header">
              <Icon icon="ri-git-pull-request-line" :size="24" />
              <div>
                <h3>待审查网页空间</h3>
                <p>审查用户提交的网页空间更新，审批通过后公开展示</p>
              </div>
            </div>
            <div class="config-card-body">
              <div v-if="reviewLoading" class="loading-state">
                <Icon icon="ri-loader-4-line" :size="24" class="spin" />
                <span>加载中...</span>
              </div>
              <div v-else-if="pendingReviews.length === 0" class="model-empty">
                <Icon icon="ri-check-line" :size="32" />
                <p>暂无待审查项目</p>
                <span>所有网页空间均已通过审查</span>
              </div>
              <div v-else class="review-list">
                <div v-for="review in pendingReviews" :key="review.id" class="review-item">
                  <div class="review-item-header">
                    <div class="review-user">
                      <Icon icon="ri-user-line" :size="14" />
                      <span>{{ review.alliance_username }}</span>
                      <a :href="`/site/${review.slug}`" target="_blank" class="review-site-link">
                        <Icon icon="ri-external-link-line" :size="12" /> /site/{{ review.slug }}
                      </a>
                    </div>
                    <span class="review-time">{{ review.updated_at }}</span>
                  </div>
                  <div class="review-files">
                    <div v-for="file in review.pending_files" :key="file.id" class="review-file-item">
                      <div class="review-file-header">
                        <Icon :icon="fileIcon(file.file_path)" :size="14" />
                        <code class="review-file-path">{{ file.file_path }}</code>
                        <span class="review-file-size">{{ formatBytes(file.file_size) }}</span>
                        <span v-if="file.published_size > 0" class="review-file-diff">（已公开：{{
                          formatBytes(file.published_size) }}）</span>
                        <span v-else class="review-file-new">新文件</span>
                      </div>
                      <div class="review-file-actions">
                        <button class="secondary-btn" @click="showDiffDialog(file)" :disabled="diffBusy">
                          <Icon icon="ri-git-branch-line" :size="14" />
                          查看差异
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="review-item-actions">
                    <button class="primary-btn" @click="approveReviewSpace(review.id)" :disabled="reviewBusy">
                      <Icon icon="ri-check-line" :size="14" />
                      {{ reviewBusy ? '审批中...' : '审批通过' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 所有网页空间 -->
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-global-line" :size="20" />
          所有网页空间
        </h2>
        <div class="config-cards">
          <div class="config-card config-card-full">
            <div class="config-card-header">
              <Icon icon="ri-list-check" :size="24" />
              <div>
                <h3>用户网页空间列表</h3>
                <p>管理所有用户的网页空间，可随时暂停访问权限</p>
              </div>
            </div>
            <div class="config-card-body">
              <div v-if="webSpaceLoading" class="loading-state">
                <Icon icon="ri-loader-4-line" :size="24" class="spin" />
                <span>加载中...</span>
              </div>
              <div v-else-if="webSpaces.length === 0" class="model-empty">
                <Icon icon="ri-global-line" :size="32" />
                <p>暂无网页空间</p>
              </div>
              <div v-else class="webspace-list">
                <div v-for="ws in webSpaces" :key="ws.id" class="webspace-item"
                  :class="{ 'admin-disabled': ws.disabled_by_admin }">
                  <div class="webspace-info">
                    <div class="webspace-name">
                      <Icon icon="ri-home-6-line" :size="14" />
                      <span>{{ ws.alliance_username }}</span>
                      <a :href="`/site/${ws.slug}`" target="_blank" class="webspace-slug">/site/{{ ws.slug }}</a>
                      <span v-if="ws.review_status === 'pending_review'" class="review-pending-tag">待审查</span>
                      <span v-if="ws.disabled_by_admin" class="admin-disabled-tag">已停用</span>
                    </div>
                    <div class="webspace-meta">
                      <span>{{ ws.file_count || 0 }} 个文件</span>
                      <span v-if="ws.pending_count > 0" class="webspace-pending-count">{{ ws.pending_count }}
                        个待审查</span>
                      <span>{{ ws.title || '无标题' }}</span>
                    </div>
                  </div>
                  <div class="webspace-actions">
                    <button v-if="!ws.disabled_by_admin" class="secondary-btn danger-btn-outline"
                      @click="openDisableDialog(ws)">
                      <Icon icon="ri-forbid-line" :size="14" />
                      停用
                    </button>
                    <button v-else class="secondary-btn" @click="enableWebSpace(ws)" :disabled="reviewBusy">
                      <Icon icon="ri-check-line" :size="14" />
                      启用
                    </button>
                    <button class="secondary-btn danger-btn-outline" @click="deleteWebSpaceConfirm(ws)"
                      :disabled="reviewBusy">
                      <Icon icon="ri-delete-bin-line" :size="14" />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 差异查看器对话框 -->
      <Teleport to="body">
        <div v-if="diffDialog.visible" class="dialog-overlay" @click.self="diffDialog.visible = false">
          <div class="dialog diff-dialog">
            <div class="dialog-header">
              <h3>差异对比 - {{ diffDialog.filePath }}</h3>
              <button class="dialog-close" @click="diffDialog.visible = false">
                <Icon icon="ri-close-line" :size="18" />
              </button>
            </div>
            <div class="dialog-body diff-body">
              <div class="diff-panel">
                <div class="diff-panel-header">已公开版本 ({{ formatBytes(diffDialog.publishedSize) }})</div>
                <pre class="diff-content">{{ diffDialog.publishedContent }}</pre>
              </div>
              <div class="diff-divider"></div>
              <div class="diff-panel">
                <div class="diff-panel-header pending">待审查版本 ({{ formatBytes(diffDialog.fileSize) }})</div>
                <pre class="diff-content pending">{{ diffDialog.content }}</pre>
              </div>
            </div>
            <div class="dialog-footer">
              <button class="secondary-btn" @click="diffDialog.visible = false">关闭</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 禁用对话框 -->
      <Teleport to="body">
        <div v-if="disableDialog.visible" class="dialog-overlay" @click.self="disableDialog.visible = false">
          <div class="dialog">
            <div class="dialog-header">
              <h3>停用网页空间 - {{ disableDialog.username }}</h3>
              <button class="dialog-close" @click="disableDialog.visible = false">
                <Icon icon="ri-close-line" :size="18" />
              </button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label>停用原因 <span class="required">*</span></label>
                <textarea v-model="disableDialog.reason" placeholder="请输入停用原因（用户可见）" rows="3"></textarea>
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-ghost" @click="disableDialog.visible = false">取消</button>
              <button class="btn btn-primary danger-btn" @click="confirmDisable"
                :disabled="reviewBusy || !disableDialog.reason">确认停用</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <!-- ===== 数据空间管理 ===== -->
    <template v-if="currentSection === 'dataspace'">
      <section class="admin-section">
        <h2 class="section-title">
          <Icon icon="ri-hard-drive-2-line" :size="20" />
          用户数据空间占用
        </h2>
        <div class="config-cards">
          <div class="config-card config-card-full">
            <div class="config-card-header">
              <Icon icon="ri-database-2-line" :size="24" />
              <div>
                <h3>所有用户数据空间</h3>
                <p>查看每位用户的数据空间使用情况，按用户ID或占用排序</p>
              </div>
              <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
                <span style="font-size:12px;color:var(--text-tertiary)">排序：</span>
                <select v-model="dsSortBy" @change="loadDataSpaces"
                  style="padding:4px 8px;font-size:12px;background:var(--ctrl-fill-default);border:1px solid var(--ctrl-border);border-radius:4px;color:var(--text-primary)">
                  <option value="used">按占用</option>
                  <option value="username">按用户ID</option>
                </select>
                <button class="icon-btn-sm"
                  @click="dsSortOrder = dsSortOrder === 'desc' ? 'asc' : 'desc'; loadDataSpaces()"
                  :title="dsSortOrder === 'desc' ? '降序' : '升序'">
                  <Icon :icon="dsSortOrder === 'desc' ? 'ri-sort-desc' : 'ri-sort-asc'" :size="14" />
                </button>
              </div>
            </div>
            <div class="config-card-body">
              <div v-if="dsLoading" class="loading-state">
                <Icon icon="ri-loader-4-line" :size="24" class="spin" />
                <span>加载中...</span>
              </div>
              <div v-else-if="dataSpaces.length === 0" class="model-empty">
                <Icon icon="ri-hard-drive-2-line" :size="32" />
                <p>暂无数据空间</p>
              </div>
              <div v-else class="dataspace-list">
                <div v-for="ds in dataSpaces" :key="ds.space_id" class="dataspace-item"
                  :class="{ 'is-full': ds.is_full }">
                  <div class="dataspace-header">
                    <div class="dataspace-user">
                      <Icon icon="ri-user-line" :size="14" />
                      <span class="dataspace-username">{{ ds.username }}</span>
                    </div>
                    <div class="dataspace-summary">
                      <span class="dataspace-total">{{ formatBytes(ds.total_used) }} / {{ formatBytes(ds.quota)
                        }}</span>
                      <span class="dataspace-percent" :class="{ 'percent-full': ds.is_full }">{{ ds.used_percent
                        }}%</span>
                    </div>
                  </div>
                  <!-- 进度条 -->
                  <div class="dataspace-bar">
                    <div class="dataspace-bar-fill" :style="{ width: Math.min(ds.used_percent, 100) + '%' }"
                      :class="{ 'bar-full': ds.is_full }"></div>
                  </div>
                  <!-- 详细占比 -->
                  <div class="dataspace-breakdown">
                    <div class="breakdown-item">
                      <span class="breakdown-dot" style="background:#0067C0"></span>
                      <span class="breakdown-label">云文件</span>
                      <span class="breakdown-value">{{ formatBytes(ds.breakdown.web_hosting) }}</span>
                    </div>
                    <div class="breakdown-item">
                      <span class="breakdown-dot" style="background:#107C10"></span>
                      <span class="breakdown-label">实例文件</span>
                      <span class="breakdown-value">{{ formatBytes(ds.breakdown.instance_files) }}</span>
                    </div>
                    <div class="breakdown-item">
                      <span class="breakdown-dot" style="background:#CA8F04"></span>
                      <span class="breakdown-label">实例存储</span>
                      <span class="breakdown-value">{{ formatBytes(ds.breakdown.instance_storage) }}</span>
                    </div>
                    <div class="breakdown-item">
                      <span class="breakdown-dot" style="background:#8764B8"></span>
                      <span class="breakdown-label">版本记录</span>
                      <span class="breakdown-value">{{ formatBytes(ds.breakdown.versions) }}</span>
                    </div>
                    <div class="breakdown-item">
                      <span class="breakdown-dot" style="background:#E74856"></span>
                      <span class="breakdown-label">操作记录</span>
                      <span class="breakdown-value">{{ formatBytes(ds.breakdown.history) }}</span>
                    </div>
                  </div>
                  <!-- 文件数量 -->
                  <div class="dataspace-counts">
                    <span>{{ ds.counts.instances }} 个实例</span>
                    <span>{{ ds.counts.web_spaces }} 个网页空间</span>
                    <span>{{ ds.counts.cloud_files }} 个云文件</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ===== 帮助中心管理 ===== -->
    <template v-if="currentSection === 'help'">
      <section class="admin-section">
        <div class="help-admin-header">
          <h2 class="section-title">
            <Icon icon="ri-book-open-line" :size="20" />
            帮助中心文档
          </h2>
          <button class="btn btn-primary" @click="openHelpCategoryForm(null)">
            <Icon icon="ri-add-line" :size="14" />
            新增一级目录
          </button>
        </div>
        <div class="config-cards">
          <div class="config-card config-card-full">
            <div class="config-card-header">
              <Icon icon="ri-file-list-3-line" :size="24" />
              <div>
                <h3>文档目录</h3>
                <p>一级目录下的文章作为第二层展示，管理帮助中心内容</p>
              </div>
            </div>
            <div class="config-card-body">
              <div v-if="helpLoading" class="loading-state">
                <Icon icon="ri-loader-4-line" :size="24" class="spin" />
                <span>加载中...</span>
              </div>
              <div v-else-if="helpCategories.length === 0" class="model-empty">
                <Icon icon="ri-book-open-line" :size="32" />
                <p>暂无文档目录</p>
                <span>点击「新增一级目录」创建帮助文档</span>
              </div>
              <div v-else class="help-admin-list">
                <div v-for="cat in helpCategories" :key="cat.id" class="help-admin-category">
                  <div class="help-admin-cat-header">
                    <span class="help-admin-cat-icon">
                      <Icon :icon="cat.icon || 'ri-article-line'" :size="18" />
                    </span>
                    <div class="help-admin-cat-info">
                      <div class="help-admin-cat-title">
                        {{ cat.title }}
                        <span v-if="cat.is_published" class="review-pending-tag">已发布</span>
                        <span v-else class="admin-disabled-tag">未发布</span>
                        <span class="help-admin-count">{{ cat.articles?.length || 0 }} 篇文章</span>
                      </div>
                      <div class="help-admin-cat-summary">{{ cat.summary || '暂无简介' }}</div>
                    </div>
                    <div class="help-admin-cat-actions">
                      <button class="secondary-btn" @click="openHelpArticleForm(cat, null)">
                        <Icon icon="ri-add-line" :size="14" /> 新增文章
                      </button>
                      <button class="icon-btn-sm" title="编辑目录" @click="openHelpCategoryForm(cat)">
                        <Icon icon="ri-edit-line" :size="14" />
                      </button>
                      <button class="icon-btn-sm danger" title="删除目录" @click="deleteHelpCategory(cat)">
                        <Icon icon="ri-delete-bin-line" :size="14" />
                      </button>
                    </div>
                  </div>

                  <div v-if="cat.articles && cat.articles.length > 0" class="help-admin-articles">
                    <div v-for="art in cat.articles" :key="art.id" class="help-admin-article">
                      <div class="help-admin-art-info">
                        <Icon icon="ri-file-text-line" :size="14" />
                        <span class="help-admin-art-title">{{ art.title }}</span>
                        <span v-if="art.is_published" class="review-pending-tag">已发布</span>
                        <span v-else class="admin-disabled-tag">未发布</span>
                        <span class="help-admin-art-preview">{{ (art.content || '').replace(/\s+/g, ' ').substring(0,
                          60) }}</span>
                      </div>
                      <div class="help-admin-art-actions">
                        <button class="icon-btn-sm" title="编辑文章" @click="openHelpArticleForm(cat, art)">
                          <Icon icon="ri-edit-line" :size="14" />
                        </button>
                        <button class="icon-btn-sm danger" title="删除文章" @click="deleteHelpArticle(art)">
                          <Icon icon="ri-delete-bin-line" :size="14" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div v-else class="help-admin-articles empty">
                    <span>该目录下暂无文章</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 一级目录编辑对话框 -->
      <Teleport to="body">
        <div v-if="helpCategoryDialog.visible" class="dialog-overlay" @click.self="helpCategoryDialog.visible = false">
          <div class="dialog">
            <div class="dialog-header">
              <h3>{{ helpCategoryDialog.editingId ? '编辑一级目录' : '新增一级目录' }}</h3>
              <button class="dialog-close" @click="helpCategoryDialog.visible = false">
                <Icon icon="ri-close-line" :size="18" />
              </button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label>目录名称 <span class="required">*</span></label>
                <input v-model="helpCategoryForm.title" type="text" placeholder="例如：快速开始" />
              </div>
              <div class="form-group">
                <label>图标（RemixIcon 图标名）</label>
                <input v-model="helpCategoryForm.icon" type="text" placeholder="例如：ri-rocket-line" />
                <div class="help-icon-tips">
                  <button v-for="ic in helpIconPresets" :key="ic" type="button" class="help-icon-chip"
                    :class="{ active: helpCategoryForm.icon === ic }" @click="helpCategoryForm.icon = ic">
                    <Icon :icon="ic" :size="14" /> {{ ic }}
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label>目录简介</label>
                <textarea v-model="helpCategoryForm.summary" rows="2" placeholder="一句话说明该目录内容"></textarea>
              </div>
              <div class="form-group">
                <label>排序（数字越小越靠前）</label>
                <input v-model.number="helpCategoryForm.sort_order" type="number" placeholder="0" />
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-ghost" @click="helpCategoryDialog.visible = false">取消</button>
              <button class="btn btn-primary" @click="saveHelpCategory" :disabled="helpBusy">保存</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 二级文章编辑对话框 -->
      <Teleport to="body">
        <div v-if="helpArticleDialog.visible" class="dialog-overlay" @click.self="helpArticleDialog.visible = false">
          <div class="dialog help-article-dialog">
            <div class="dialog-header">
              <h3>{{ helpArticleDialog.editingId ? '编辑文章' : '新增文章' }} - {{ helpArticleDialog.categoryTitle }}</h3>
              <button class="dialog-close" @click="helpArticleDialog.visible = false">
                <Icon icon="ri-close-line" :size="18" />
              </button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label>文章标题 <span class="required">*</span></label>
                <input v-model="helpArticleForm.title" type="text" placeholder="例如：如何首次登录系统？" />
              </div>
              <div class="form-group">
                <label>内容（支持 Markdown 格式）</label>
                <textarea v-model="helpArticleForm.content" class="help-article-content" rows="16"
                  placeholder="# 标题&#10;&#10;支持 **加粗**、`代码`、列表、链接等 Markdown 语法"></textarea>
              </div>
              <div class="form-group">
                <label>排序（数字越小越靠前）</label>
                <input v-model.number="helpArticleForm.sort_order" type="number" placeholder="0" />
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn btn-ghost" @click="helpArticleDialog.visible = false">取消</button>
              <button class="btn btn-primary" @click="saveHelpArticle" :disabled="helpBusy">保存</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <!-- 角色设置对话框 -->
    <Teleport to="body">
      <div v-if="roleDialogUser" class="dialog-overlay" @click.self="roleDialogUser = null">
        <div class="dialog">
          <div class="dialog-header">
            <h3>设置角色 - {{ roleDialogUser.display_name }}</h3>
            <button class="dialog-close" @click="roleDialogUser = null">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="role-options">
              <label v-for="r in availableRoles" :key="r.value" class="role-option"
                :class="{ active: selectedRole === r.value }">
                <input type="radio" v-model="selectedRole" :value="r.value" hidden />
                <Icon :icon="r.icon" :size="20" />
                <div class="role-info">
                  <div class="role-name">{{ r.label }}</div>
                  <div class="role-desc">{{ r.desc }}</div>
                </div>
              </label>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click="roleDialogUser = null">取消</button>
            <button class="btn btn-primary" @click="saveRole" :disabled="busy">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 重置密码对话框 -->
    <Teleport to="body">
      <div v-if="resetPwdUser" class="dialog-overlay" @click.self="resetPwdUser = null">
        <div class="dialog">
          <div class="dialog-header">
            <h3>重置密码 - {{ resetPwdUser.display_name }}</h3>
            <button class="dialog-close" @click="resetPwdUser = null">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>新密码（至少 6 位）</label>
              <input v-model="newPassword" type="text" placeholder="输入新密码" />
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click="resetPwdUser = null">取消</button>
            <button class="btn btn-primary" @click="saveResetPwd" :disabled="busy || !newPassword">确认重置</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { adminApi, helpApi } from '../../api';
import { useAuth } from '../../composables/useAuth';

const route = useRoute();
const { user } = useAuth();

const busy = ref(false);
const userSearch = ref('');
const userLoading = ref(false);

// 当前子页面
const currentSection = computed(() => {
  if (route.path.endsWith('/users')) return 'users';
  if (route.path.endsWith('/notifications')) return 'notifications';
  if (route.path.endsWith('/ai-config')) return 'ai-config';
  if (route.path.endsWith('/web-hosting')) return 'web-hosting';
  if (route.path.endsWith('/dataspace')) return 'dataspace';
  if (route.path.endsWith('/help')) return 'help';
  return 'overview';
});

const sectionTitle = computed(() => {
  if (currentSection.value === 'users') return '用户管理';
  if (currentSection.value === 'notifications') return '通知管理';
  if (currentSection.value === 'ai-config') return 'AI 配置';
  if (currentSection.value === 'web-hosting') return '网页空间';
  if (currentSection.value === 'dataspace') return '数据空间';
  if (currentSection.value === 'help') return '帮助中心';
  return '系统配置';
});

// 系统配置
const tempAdminEnabled = ref(false);
const tempAdminUser = ref('');

// 用户列表
const users = ref<any[]>([]);

const filteredUsers = computed(() => {
  if (!userSearch.value.trim()) return users.value;
  const q = userSearch.value.toLowerCase();
  return users.value.filter(u =>
    (u.username || '').toLowerCase().includes(q) ||
    (u.display_name || '').toLowerCase().includes(q) ||
    (u.school_name || '').toLowerCase().includes(q)
  );
});

// 角色对话框
const roleDialogUser = ref<any>(null);
const selectedRole = ref('');

const availableRoles = [
  { value: 'admin', label: '管理员', icon: 'ri-shield-star-line', desc: '拥有学校管理权限' },
  { value: 'teacher', label: '教师', icon: 'ri-user-star-line', desc: '拥有教学管理权限' },
  { value: 'student', label: '学生', icon: 'ri-user-line', desc: '仅查看权限' }
];

// 重置密码对话框
const resetPwdUser = ref<any>(null);
const newPassword = ref('');

// 通知管理
const notifScope = ref('all'); // 'all' | 'school'
const schoolList = ref<any[]>([]);
const adminNotifBusy = ref(false);
const adminNotifMsg = ref('');
const adminNotifError = ref(false);
const adminNotifForm = ref({
  school_id: 0,
  type: 'info',
  target_type: 'all',
  target_id: '',
  title: '',
  content: '',
});

const scopeOptions = [
  { value: 'all', label: '全体人员（所有学校）', icon: 'ri-global-line' },
  { value: 'school', label: '指定学校', icon: 'ri-school-line' },
];

const adminNotifTypes = [
  { value: 'info', label: '信息', icon: 'ri-information-line' },
  { value: 'success', label: '成功', icon: 'ri-checkbox-circle-line' },
  { value: 'warning', label: '警告', icon: 'ri-error-warning-line' },
  { value: 'system', label: '系统', icon: 'ri-settings-3-line' },
];

const adminTargetOptions = [
  { value: 'all', label: '全体成员', icon: 'ri-group-line' },
  { value: 'role', label: '按角色', icon: 'ri-shield-user-line' },
  { value: 'user', label: '指定用户', icon: 'ri-user-line' },
];

const adminNotifRoles = [
  { value: 'admin', label: '管理员' },
  { value: 'teacher', label: '教师' },
  { value: 'student', label: '学生' },
];

const adminNotifTargetList = computed(() => {
  if (adminNotifForm.value.target_type === 'role') return adminNotifRoles;
  if (adminNotifForm.value.target_type === 'user') {
    return users.value.map(u => ({
      value: String(u.id),
      label: u.display_name + ' (' + u.school_name + ')'
    }));
  }
  return [];
});

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
  return labels[role] || role;
}

async function loadConfig() {
  try {
    const config = await adminApi.config();
    tempAdminEnabled.value = config.temp_admin_enabled;
    tempAdminUser.value = config.temp_admin_username;
  } catch (e: any) {
    console.error('加载配置失败:', e);
  }
}

async function loadUsers() {
  userLoading.value = true;
  try {
    const userList = await adminApi.users();
    users.value = userList;
  } catch (e: any) {
    alert(e.message || '加载用户失败');
  } finally {
    userLoading.value = false;
  }
}

async function loadSchools() {
  try {
    schoolList.value = await adminApi.schools();
  } catch (e) {
    console.error('加载学校列表失败:', e);
  }
}

async function toggleTempAdmin(enabled: boolean) {
  if (!confirm(`确认${enabled ? '启用' : '禁用'}临时管理员模式？`)) return;
  busy.value = true;
  try {
    const res = await adminApi.toggleTempAdmin(enabled);
    tempAdminEnabled.value = res.enabled;
    alert(`临时管理员模式已${enabled ? '启用' : '禁用'}`);
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function toggleSuperAdmin(u: any) {
  const newVal = !u.is_super_admin;
  if (!confirm(`确认${newVal ? '设为' : '撤销'}最高管理员「${u.display_name}」？`)) return;
  busy.value = true;
  try {
    await adminApi.setSuperAdmin(u.id, newVal);
    u.is_super_admin = newVal ? 1 : 0;
    alert('已更新');
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

function openRoleDialog(u: any) {
  roleDialogUser.value = u;
  selectedRole.value = u.role;
}

async function saveRole() {
  if (!roleDialogUser.value || busy.value) return;
  busy.value = true;
  try {
    await adminApi.setRole(roleDialogUser.value.id, selectedRole.value);
    roleDialogUser.value.role = selectedRole.value;
    roleDialogUser.value = null;
    alert('角色已更新');
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

function openResetPwdDialog(u: any) {
  resetPwdUser.value = u;
  newPassword.value = '';
}

async function saveResetPwd() {
  if (!resetPwdUser.value || !newPassword.value || busy.value) return;
  if (newPassword.value.length < 6) { alert('密码至少 6 位'); return; }
  busy.value = true;
  try {
    await adminApi.resetPassword(resetPwdUser.value.id, newPassword.value);
    resetPwdUser.value = null;
    alert('密码已重置');
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function sendAdminNotification() {
  if (!adminNotifForm.value.title) return;
  // 确定 school_id
  let schoolId = 0;
  if (notifScope.value === 'school') {
    if (adminNotifForm.value.school_id === 0) {
      adminNotifMsg.value = '请选择目标学校';
      adminNotifError.value = true;
      return;
    }
    schoolId = adminNotifForm.value.school_id;
  }
  // school_id = 0 表示全体人员（所有学校）

  adminNotifBusy.value = true;
  adminNotifMsg.value = '';
  adminNotifError.value = false;
  try {
    await adminApi.createNotification({
      school_id: schoolId,
      type: adminNotifForm.value.type,
      title: adminNotifForm.value.title,
      content: adminNotifForm.value.content,
      target_type: adminNotifForm.value.target_type,
      target_id: adminNotifForm.value.target_id || null,
    });
    adminNotifMsg.value = '通知已发送';
    adminNotifError.value = false;
    adminNotifForm.value = { school_id: 0, type: 'info', target_type: 'all', target_id: '', title: '', content: '' };
    setTimeout(() => { adminNotifMsg.value = ''; }, 3000);
  } catch (e: any) {
    adminNotifMsg.value = e.message || '发送失败';
    adminNotifError.value = true;
  } finally {
    adminNotifBusy.value = false;
  }
}

// ===== AI 配置 =====
const aiConfigBusy = ref(false);
const aiConfigMsg = ref('');
const aiConfigError = ref(false);
const aiConfigForm = ref({ default_model: 'default' });
const aiModels = ref<any[]>([]);
const showAiModelForm = ref(false);
const editingAiModelId = ref<number | null>(null);
const aiModelForm = ref({ name: '', provider: '', model_id: '', endpoint: '', api_key: '' });

// 知识库
const kbLoading = ref(false);
const kbBusy = ref(false);
const kbEntries = ref<any[]>([]);
const showKbForm = ref(false);
const editingKbId = ref<number | null>(null);
const kbForm = ref({ title: '', content: '', category: '' });

// 网页空间管理
const webSpaceLoading = ref(false);
const reviewLoading = ref(false);
const reviewBusy = ref(false);
const diffBusy = ref(false);
const webSpaces = ref<any[]>([]);
const pendingReviews = ref<any[]>([]);
const diffDialog = ref({ visible: false, filePath: '', content: '', publishedContent: '', fileSize: 0, publishedSize: 0 });
const disableDialog = ref({ visible: false, spaceId: 0, username: '', reason: '' });

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fileIcon(name: string): string {
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    html: 'ri-html5-line', htm: 'ri-html5-line', css: 'ri-css3-line',
    js: 'ri-javascript-line', json: 'ri-braces-line',
    md: 'ri-markdown-line', txt: 'ri-file-text-line',
    png: 'ri-image-line', jpg: 'ri-image-line', jpeg: 'ri-image-line',
    gif: 'ri-image-line', svg: 'ri-image-line', ico: 'ri-image-line',
  };
  return map[ext] || 'ri-file-line';
}

async function loadWebSpaces() {
  webSpaceLoading.value = true;
  try {
    webSpaces.value = await adminApi.listWebSpaces();
  } catch { webSpaces.value = []; }
  finally { webSpaceLoading.value = false; }
}

async function loadPendingReviews() {
  reviewLoading.value = true;
  try {
    pendingReviews.value = await adminApi.listPendingReviews();
  } catch { pendingReviews.value = []; }
  finally { reviewLoading.value = false; }
}

async function approveReviewSpace(spaceId: number) {
  if (!confirm('确认审批通过此网页空间？通过后最新版本将公开展示。')) return;
  reviewBusy.value = true;
  try {
    await adminApi.approveReview(spaceId);
    alert('审批通过');
    await loadPendingReviews();
    await loadWebSpaces();
  } catch (e: any) {
    alert(e.message || '审批失败');
  } finally {
    reviewBusy.value = false;
  }
}

function showDiffDialog(file: any) {
  diffDialog.value = {
    visible: true,
    filePath: file.file_path,
    content: file.content || '',
    publishedContent: file.published_content || '',
    fileSize: file.file_size,
    publishedSize: file.published_size,
  };
}

function openDisableDialog(ws: any) {
  disableDialog.value = {
    visible: true,
    spaceId: ws.id,
    username: ws.alliance_username,
    reason: '',
  };
}

async function confirmDisable() {
  if (!disableDialog.value.reason.trim()) return;
  reviewBusy.value = true;
  try {
    await adminApi.toggleWebSpaceAdmin(disableDialog.value.spaceId, true, disableDialog.value.reason);
    alert('已停用该网页空间');
    disableDialog.value.visible = false;
    await loadWebSpaces();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    reviewBusy.value = false;
  }
}

async function enableWebSpace(ws: any) {
  if (!confirm(`确认启用「${ws.alliance_username}」的网页空间？`)) return;
  reviewBusy.value = true;
  try {
    await adminApi.toggleWebSpaceAdmin(ws.id, false, '');
    alert('已启用该网页空间');
    await loadWebSpaces();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    reviewBusy.value = false;
  }
}

async function deleteWebSpaceConfirm(ws: any) {
  if (!confirm(`确认删除「${ws.alliance_username}」的网页空间（/site/${ws.slug}）？\n\n此操作将删除该空间下的所有文件，且不可恢复！`)) return;
  reviewBusy.value = true;
  try {
    await adminApi.deleteWebSpace(ws.id);
    alert('已删除网页空间');
    await loadWebSpaces();
    await loadPendingReviews();
  } catch (e: any) {
    alert(e.message || '删除失败');
  } finally {
    reviewBusy.value = false;
  }
}

// 数据空间管理
const dsLoading = ref(false);
const dsSortBy = ref('used');
const dsSortOrder = ref('desc');
const dataSpaces = ref<any[]>([]);

async function loadDataSpaces() {
  dsLoading.value = true;
  try {
    dataSpaces.value = await adminApi.listDataSpaces(dsSortBy.value, dsSortOrder.value);
  } catch { dataSpaces.value = []; }
  finally { dsLoading.value = false; }
}

// 帮助中心文档管理
const helpLoading = ref(false);
const helpBusy = ref(false);
const helpCategories = ref<any[]>([]);
const helpCategoryDialog = ref({ visible: false, editingId: 0 as number | null });
const helpArticleDialog = ref({ visible: false, editingId: 0 as number | null, categoryId: 0, categoryTitle: '' });
const helpCategoryForm = ref({ title: '', icon: 'ri-article-line', summary: '', sort_order: 0 });
const helpArticleForm = ref({ title: '', content: '', sort_order: 0 });

const helpIconPresets = [
  'ri-rocket-line', 'ri-graduation-cap-line', 'ri-settings-3-line',
  'ri-cloud-line', 'ri-user-line', 'ri-shield-keyhole-line',
  'ri-developer-board-line', 'ri-question-answer-line', 'ri-article-line',
];

async function loadHelpCategories() {
  helpLoading.value = true;
  try {
    helpCategories.value = await helpApi.list();
  } catch { helpCategories.value = []; }
  finally { helpLoading.value = false; }
}

function openHelpCategoryForm(cat: any) {
  if (cat) {
    helpCategoryDialog.value = { visible: true, editingId: cat.id };
    helpCategoryForm.value = {
      title: cat.title,
      icon: cat.icon || 'ri-article-line',
      summary: cat.summary || '',
      sort_order: cat.sort_order || 0,
    };
  } else {
    helpCategoryDialog.value = { visible: true, editingId: null };
    helpCategoryForm.value = { title: '', icon: 'ri-article-line', summary: '', sort_order: 0 };
  }
}

async function saveHelpCategory() {
  if (!helpCategoryForm.value.title.trim()) { alert('请输入目录名称'); return; }
  helpBusy.value = true;
  try {
    const data = {
      title: helpCategoryForm.value.title.trim(),
      icon: helpCategoryForm.value.icon.trim() || 'ri-article-line',
      summary: helpCategoryForm.value.summary.trim(),
      sort_order: helpCategoryForm.value.sort_order || 0,
    };
    if (helpCategoryDialog.value.editingId) {
      await helpApi.updateCategory(helpCategoryDialog.value.editingId, data);
    } else {
      await helpApi.createCategory(data);
    }
    helpCategoryDialog.value.visible = false;
    await loadHelpCategories();
  } catch (e: any) { alert(e.message || '保存失败'); }
  finally { helpBusy.value = false; }
}

async function deleteHelpCategory(cat: any) {
  const count = cat.articles?.length || 0;
  if (!confirm(`确认删除目录「${cat.title}」？\n${count > 0 ? `该目录下的 ${count} 篇文章将一并删除，且不可恢复！` : '此操作不可恢复！'}`)) return;
  helpBusy.value = true;
  try {
    await helpApi.deleteCategory(cat.id);
    await loadHelpCategories();
  } catch (e: any) { alert(e.message || '删除失败'); }
  finally { helpBusy.value = false; }
}

function openHelpArticleForm(cat: any, art: any) {
  if (art) {
    helpArticleDialog.value = { visible: true, editingId: art.id, categoryId: cat.id, categoryTitle: cat.title };
    helpArticleForm.value = { title: art.title, content: art.content || '', sort_order: art.sort_order || 0 };
  } else {
    helpArticleDialog.value = { visible: true, editingId: null, categoryId: cat.id, categoryTitle: cat.title };
    helpArticleForm.value = { title: '', content: '', sort_order: 0 };
  }
}

async function saveHelpArticle() {
  if (!helpArticleForm.value.title.trim()) { alert('请输入文章标题'); return; }
  helpBusy.value = true;
  try {
    const data = {
      parent_id: helpArticleDialog.value.categoryId,
      title: helpArticleForm.value.title.trim(),
      content: helpArticleForm.value.content,
      sort_order: helpArticleForm.value.sort_order || 0,
    };
    if (helpArticleDialog.value.editingId) {
      await helpApi.updateArticle(helpArticleDialog.value.editingId, data);
    } else {
      await helpApi.createArticle(data);
    }
    helpArticleDialog.value.visible = false;
    await loadHelpCategories();
  } catch (e: any) { alert(e.message || '保存失败'); }
  finally { helpBusy.value = false; }
}

async function deleteHelpArticle(art: any) {
  if (!confirm(`确认删除文章「${art.title}」？此操作不可恢复！`)) return;
  helpBusy.value = true;
  try {
    await helpApi.deleteArticle(art.id);
    await loadHelpCategories();
  } catch (e: any) { alert(e.message || '删除失败'); }
  finally { helpBusy.value = false; }
}

async function loadAiConfig() {
  try {
    const res = await adminApi.aiConfig();
    aiConfigForm.value.default_model = res.default_model || 'default';
  } catch { /* ignore */ }
}

async function saveAiConfig() {
  aiConfigBusy.value = true;
  aiConfigMsg.value = '';
  aiConfigError.value = false;
  try {
    await adminApi.saveAiConfig(aiConfigForm.value);
    aiConfigMsg.value = 'AI 配置已保存';
    setTimeout(() => { aiConfigMsg.value = ''; }, 3000);
  } catch (e: any) {
    aiConfigMsg.value = e.message || '保存失败';
    aiConfigError.value = true;
  } finally {
    aiConfigBusy.value = false;
  }
}

async function loadAiModels() {
  try {
    aiModels.value = await adminApi.listAiModels();
  } catch { aiModels.value = []; }
}

function openAiModelForm() {
  editingAiModelId.value = null;
  aiModelForm.value = { name: '', provider: '', model_id: '', endpoint: '', api_key: '' };
  showAiModelForm.value = true;
}

function editAiModel(m: any) {
  editingAiModelId.value = m.id;
  aiModelForm.value = {
    name: m.name,
    provider: m.provider,
    model_id: m.model_id || '',
    endpoint: m.endpoint || '',
    api_key: ''
  };
  showAiModelForm.value = true;
}

function cancelAiModelForm() {
  showAiModelForm.value = false;
  editingAiModelId.value = null;
}

async function saveAiModel() {
  const { name, provider, model_id, endpoint, api_key } = aiModelForm.value;
  if (!name.trim()) { alert('请输入模型名称'); return; }
  if (!provider) { alert('请选择提供商'); return; }
  try {
    if (editingAiModelId.value) {
      const data: any = { name: name.trim(), provider, model_id: model_id.trim(), endpoint: endpoint.trim() };
      if (api_key.trim()) data.api_key = api_key.trim();
      await adminApi.updateAiModel(editingAiModelId.value, data);
    } else {
      await adminApi.createAiModel({
        name: name.trim(), provider, model_id: model_id.trim(),
        endpoint: endpoint.trim(), api_key: api_key.trim()
      });
    }
    showAiModelForm.value = false;
    editingAiModelId.value = null;
    await loadAiModels();
  } catch (e: any) { alert(e.message || '保存失败'); }
}

async function toggleAiModel(m: any) {
  try {
    await adminApi.updateAiModel(m.id, { is_enabled: m.is_enabled ? 0 : 1 });
    await loadAiModels();
  } catch (e: any) { alert(e.message || '操作失败'); }
}

async function deleteAiModelConfirm(m: any) {
  if (!confirm(`确认删除系统模型 "${m.name}"？`)) return;
  try {
    await adminApi.deleteAiModel(m.id);
    await loadAiModels();
  } catch (e: any) { alert(e.message || '删除失败'); }
}

// 知识库操作
async function loadKbEntries() {
  kbLoading.value = true;
  try {
    kbEntries.value = await adminApi.listKbEntries();
  } catch { kbEntries.value = []; }
  finally { kbLoading.value = false; }
}

function editKbEntry(entry: any) {
  editingKbId.value = entry.id;
  kbForm.value = { title: entry.title, content: entry.content, category: entry.category || '' };
  showKbForm.value = true;
}

async function saveKbEntry() {
  if (!kbForm.value.title.trim() || !kbForm.value.content.trim()) {
    alert('标题和内容不能为空'); return;
  }
  kbBusy.value = true;
  try {
    if (editingKbId.value) {
      await adminApi.updateKbEntry(editingKbId.value, kbForm.value);
    } else {
      await adminApi.createKbEntry(kbForm.value);
    }
    showKbForm.value = false;
    editingKbId.value = null;
    await loadKbEntries();
  } catch (e: any) { alert(e.message || '保存失败'); }
  finally { kbBusy.value = false; }
}

async function deleteKbEntry(id: number) {
  if (!confirm('确认删除此知识库条目？')) return;
  try {
    await adminApi.deleteKbEntry(id);
    await loadKbEntries();
  } catch (e: any) { alert(e.message || '删除失败'); }
}

// 按需加载数据
watch(currentSection, (section) => {
  if (section === 'users') loadUsers();
  if (section === 'notifications') { loadSchools(); loadUsers(); }
  if (section === 'ai-config') { loadAiConfig(); loadAiModels(); loadKbEntries(); }
  if (section === 'web-hosting') { loadWebSpaces(); loadPendingReviews(); }
  if (section === 'dataspace') { loadDataSpaces(); }
  if (section === 'help') { loadHelpCategories(); }
}, { immediate: true });

onMounted(loadConfig);
</script>

<style scoped>
.admin-panel {
  padding: var(--spacer-5);
  max-width: 1200px;
  margin: 0 auto;
}

.admin-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.admin-badge.temp {
  background: rgba(202, 143, 4, 0.1);
  color: #CA8F04;
}

.admin-badge.super {
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
}

.admin-section {
  margin-bottom: var(--spacer-6);
}

.config-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: var(--spacer-4);
}

.config-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.config-card-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
  color: var(--accent-base);
}

.config-card-header h3 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.config-card-header p {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: var(--spacer-1) 0 0;
}

.config-card-body {
  padding: var(--spacer-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.config-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.status-value {
  font-size: var(--font-size-sm);
  font-weight: 600;
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.status-value.on {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
}

.config-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
}

.info-label {
  color: var(--text-tertiary);
}

.config-info code {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: var(--subtle-secondary);
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-xs);
}

.config-note {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: 0;
}

.filter-bar {
  margin-bottom: var(--spacer-3);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-12);
  color: var(--text-tertiary);
}

.data-table {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 2fr 1.2fr 0.8fr 0.8fr 0.7fr 1fr;
  gap: var(--spacer-3);
  padding: var(--spacer-3) var(--spacer-4);
  align-items: center;
}

.table-header {
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table-row {
  border-top: 1px solid var(--divider-stroke);
  transition: background var(--fast-duration);
}

.table-row:hover {
  background: var(--subtle-secondary);
}

.col-name {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  min-width: 0;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background: var(--accent-base);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  flex-shrink: 0;
}

.user-info {
  min-width: 0;
}

.user-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.user-school {
  color: var(--accent-base);
  font-weight: 500;
}

.school-tag {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  padding: 2px var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.role-pill {
  display: inline-flex;
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.role-pill.admin {
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
}

.role-pill.teacher {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
}

.role-pill.student {
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.toggle-btn {
  display: inline-flex;
  padding: 2px var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.toggle-btn.on {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
  border-color: rgba(16, 124, 16, 0.3);
}

.toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-pill {
  display: inline-flex;
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.status-pill.active {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
}

.status-pill.inactive {
  background: rgba(196, 43, 28, 0.1);
  color: #C42B1C;
}

.col-actions {
  display: flex;
  gap: var(--spacer-1);
  justify-content: flex-end;
}

.icon-btn-sm {
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
}

.icon-btn-sm:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.role-options {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.role-option {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--fast-duration);
  color: var(--text-secondary);
}

.role-option:hover {
  background: var(--subtle-pressed);
}

.role-option.active {
  border-color: var(--accent-base);
  background: var(--accent-bg, rgba(0, 103, 192, 0.04));
  color: var(--accent-base);
}

.role-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.role-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.type-options {
  display: flex;
  gap: var(--spacer-2);
  flex-wrap: wrap;
}

.type-option {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.type-option:hover {
  background: var(--subtle-secondary);
}

.type-option.active {
  border-color: var(--accent-base);
  background: var(--accent-bg, rgba(0, 103, 192, 0.04));
  color: var(--accent-base);
}

.admin-notif-msg {
  font-size: var(--font-size-sm);
  color: #107C10;
  margin: 0;
}

.admin-notif-msg.error {
  color: var(--status-error, #C42B1C);
}

.required {
  color: var(--status-error, #C42B1C);
}

/* ===== AI 配置样式 ===== */
.config-card-full {
  grid-column: 1 / -1;
}

.default-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: var(--accent-bg);
  color: var(--accent-base);
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
  margin-left: 6px;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.model-item.disabled {
  opacity: 0.5;
}

.model-item.add-new {
  background: transparent;
  border: 1px dashed var(--divider-stroke);
  justify-content: center;
}

.add-new-btn {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  background: transparent;
  border: none;
  color: var(--accent-base);
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: var(--spacer-1);
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.model-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.model-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.model-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-6) var(--spacer-3);
  color: var(--text-tertiary);
  gap: var(--spacer-2);
}

.model-empty p {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.model-empty span {
  font-size: var(--font-size-xs);
}

.model-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.form-row label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-secondary);
}

.form-row input,
.form-row select,
.form-row textarea {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  font-family: inherit;
}

.form-row textarea {
  resize: vertical;
}

.form-row input:focus,
.form-row select:focus,
.form-row textarea:focus {
  border-color: var(--accent-base);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  margin-top: var(--spacer-2);
}

/* 知识库列表 */
.kb-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.kb-item {
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  transition: border-color var(--fast-duration);
}

.kb-item:hover {
  border-color: var(--divider-stroke);
}

.kb-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-1);
}

.kb-item-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.kb-item-category {
  font-size: 10px;
  padding: 1px 8px;
  background: var(--accent-bg);
  color: var(--accent-base);
  border-radius: var(--radius-full);
  font-weight: 500;
}

.kb-item-content {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: var(--spacer-2);
}

.kb-item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kb-item-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

.kb-item-actions {
  display: flex;
  gap: 2px;
}

/* ===== 网页空间管理 ===== */
.review-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.review-item {
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  padding: var(--spacer-3);
  border: 1px solid var(--divider-stroke);
}

.review-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-2);
}

.review-user {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.review-site-link {
  font-size: var(--font-size-xs);
  color: var(--accent-base);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 400;
}

.review-site-link:hover {
  text-decoration: underline;
}

.review-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

.review-files {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  margin-bottom: var(--spacer-2);
}

.review-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--ctrl-fill-default);
  border-radius: var(--radius-sm);
}

.review-file-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  flex: 1;
  min-width: 0;
}

.review-file-path {
  font-family: monospace;
  font-size: 11px;
  color: var(--text-primary);
  background: var(--subtle-secondary);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}

.review-file-size {
  color: var(--text-tertiary);
}

.review-file-diff {
  color: var(--text-tertiary);
  font-size: 11px;
}

.review-file-new {
  color: #107C10;
  font-size: 11px;
  font-weight: 500;
}

.review-file-actions {
  display: flex;
  gap: var(--spacer-1);
  flex-shrink: 0;
}

.review-item-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
}

/* 差异查看器 */
.diff-dialog {
  max-width: 900px;
  width: 90vw;
}

.diff-body {
  display: flex;
  gap: 0;
  max-height: 60vh;
  overflow: hidden;
}

.diff-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.diff-panel-header {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  flex-shrink: 0;
}

.diff-panel-header.pending {
  background: rgba(217, 119, 6, 0.1);
  color: #92400e;
}

.diff-content {
  flex: 1;
  overflow: auto;
  padding: var(--spacer-3);
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--app-bg);
  border: 1px solid var(--divider-stroke);
  border-top: none;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
}

.diff-content.pending {
  border-color: #f59e0b;
}

.diff-divider {
  width: 4px;
  flex-shrink: 0;
  background: var(--divider-stroke);
}

/* 网页空间列表 */
.webspace-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.webspace-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  transition: border-color var(--fast-duration);
}

.webspace-item:hover {
  border-color: var(--divider-stroke);
}

.webspace-item.admin-disabled {
  opacity: 0.7;
  background: rgba(196, 43, 28, 0.04);
}

.webspace-info {
  flex: 1;
  min-width: 0;
}

.webspace-name {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.webspace-slug {
  font-size: var(--font-size-xs);
  color: var(--accent-base);
  text-decoration: none;
  font-family: monospace;
  font-weight: 400;
}

.webspace-slug:hover {
  text-decoration: underline;
}

.webspace-meta {
  display: flex;
  gap: var(--spacer-3);
  font-size: 11px;
  color: var(--text-tertiary);
}

.review-pending-tag {
  display: inline-flex;
  padding: 1px 8px;
  background: rgba(217, 119, 6, 0.1);
  color: #92400e;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
}

.admin-disabled-tag {
  display: inline-flex;
  padding: 1px 8px;
  background: rgba(196, 43, 28, 0.1);
  color: #C42B1C;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
}

.webspace-pending-count {
  color: #d97706;
  font-weight: 500;
}

.webspace-actions {
  display: flex;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.danger-btn-outline {
  border: 1px solid rgba(196, 43, 28, 0.3);
  color: #C42B1C;
  background: transparent;
}

.danger-btn-outline:hover {
  background: rgba(196, 43, 28, 0.08);
  border-color: rgba(196, 43, 28, 0.5);
}

.danger-btn {
  background: var(--status-error, #C42B1C);
  color: white;
}

.danger-btn:hover:not(:disabled) {
  opacity: 0.9;
}

/* ===== 帮助中心文档管理 ===== */
.help-admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-4);
}

.help-admin-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.help-admin-category {
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.help-admin-cat-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
}

.help-admin-cat-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card-bg);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  color: var(--accent-base);
  font-size: 18px;
}

.help-admin-cat-info {
  flex: 1;
  min-width: 0;
}

.help-admin-cat-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  flex-wrap: wrap;
}

.help-admin-cat-summary {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.help-admin-count {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 400;
}

.help-admin-cat-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.help-admin-articles {
  border-top: 1px solid var(--divider-stroke);
  padding: var(--spacer-2) var(--spacer-3);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  background: var(--card-bg);
}

.help-admin-articles.empty {
  align-items: center;
  padding: var(--spacer-3);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.help-admin-article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-2);
  border-radius: var(--radius-sm);
  transition: background var(--fast-duration);
}

.help-admin-article:hover {
  background: var(--subtle-secondary);
}

.help-admin-art-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  min-width: 0;
  flex: 1;
  color: var(--text-secondary);
}

.help-admin-art-title {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.help-admin-art-preview {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.help-admin-art-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.help-article-dialog {
  max-width: 720px;
  width: 90vw;
}

.help-article-content {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  line-height: 1.6;
}

.help-icon-tips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacer-1);
  margin-top: var(--spacer-1);
}

.help-icon-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.help-icon-chip:hover {
  color: var(--text-primary);
}

.help-icon-chip.active {
  background: var(--accent-bg);
  border-color: var(--accent-base);
  color: var(--accent-base);
}

/* ===== 数据空间管理 ===== */
.dataspace-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.dataspace-item {
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
}

.dataspace-item.is-full {
  border-color: var(--status-error);
  background: rgba(196, 43, 43, 0.06);
}

.dataspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-2);
  gap: var(--spacer-2);
}

.dataspace-user {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  color: var(--text-tertiary);
  min-width: 0;
}

.dataspace-username {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dataspace-summary {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.dataspace-total {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
}

.dataspace-percent {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.dataspace-percent.percent-full {
  color: var(--status-error);
}

.dataspace-bar {
  height: 6px;
  background: var(--divider-stroke);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: var(--spacer-2);
}

.dataspace-bar-fill {
  height: 100%;
  background: var(--accent-base);
  border-radius: var(--radius-full);
  transition: width var(--normal-duration);
}

.dataspace-bar-fill.bar-full {
  background: var(--status-error);
}

.dataspace-breakdown {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--spacer-1) var(--spacer-3);
  margin-bottom: var(--spacer-2);
}

.breakdown-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.breakdown-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.breakdown-label {
  flex-shrink: 0;
}

.breakdown-value {
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
}

.dataspace-counts {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  flex-wrap: wrap;
  padding-top: var(--spacer-2);
  border-top: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
</style>