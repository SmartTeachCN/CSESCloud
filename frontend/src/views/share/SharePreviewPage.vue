<template>
  <div class="share-preview-page">
    <div v-if="loading" class="loading-state">
      <Icon icon="ri-loader-4-line" :size="32" class="spin" />
      <span>加载中...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <div class="error-card">
        <Icon :icon="errorIcon" :size="48" />
        <h2>{{ errorTitle }}</h2>
        <p>{{ error }}</p>
        <button class="btn btn-primary" @click="goHome">返回首页</button>
        <button v-if="authRequired" class="btn btn-ghost" @click="goLogin">前往登录</button>
      </div>
    </div>

    <div v-else-if="shareData" class="preview-content">
      <div class="preview-header">
        <div class="preview-brand">
          <Icon icon="ri-share-forward-line" :size="24" />
          <span>CSES Cloud 分享链接</span>
        </div>
        <button class="btn btn-ghost" @click="goHome">
          <Icon icon="ri-home-line" :size="14" /> 返回首页
        </button>
      </div>

      <div class="preview-card">
        <div class="preview-card-header">
          <div class="preview-icon">
            <Icon :icon="resourceIcon" :size="32" />
          </div>
          <div class="preview-meta">
            <h1>{{ shareData.resource_name }}</h1>
            <div class="preview-owner">
              <Icon icon="ri-user-line" :size="12" />
              <span>由 {{ shareData.owner_username || '分享者' }} 分享</span>
            </div>
          </div>
        </div>

        <div class="preview-card-body">
          <!-- 文件内容预览（纯文本渲染，避免 v-html 注入） -->
          <div class="preview-file">
            <div class="preview-file-header">
              <Icon icon="ri-file-text-line" :size="14" />
              <span>文件内容</span>
              <span v-if="savedTip" class="preview-saved-tip">
                <Icon icon="ri-check-line" :size="12" />
                已保存
              </span>
            </div>
            <pre v-if="fileText !== null" class="preview-file-content">{{ fileText || '（空文件）' }}</pre>
            <div v-else class="preview-file-empty">该文件暂不支持在线预览</div>
          </div>

          <!-- 允许未登录编辑：编辑内容 -->
          <div v-if="canGuestEdit" class="preview-editor">
            <div v-if="!editing" class="preview-editor-actions">
              <button class="btn btn-ghost" @click="startEditing">
                <Icon icon="ri-edit-line" :size="14" />
                编辑内容
              </button>
              <span class="action-hint-inline">分享者允许通过此链接直接编辑文件内容</span>
            </div>
            <template v-else>
              <textarea
                v-model="draftContent"
                class="preview-textarea"
                spellcheck="false"
                placeholder="在此编辑文件内容…"
              ></textarea>
              <div class="preview-editor-actions">
                <button class="btn btn-primary" :disabled="savingContent" @click="saveContent">
                  <Icon v-if="savingContent" icon="ri-loader-4-line" :size="14" class="spin" />
                  <Icon v-else icon="ri-save-3-line" :size="14" />
                  {{ savingContent ? '保存中...' : '保存' }}
                </button>
                <button class="btn btn-ghost" :disabled="savingContent" @click="cancelEditing">取消</button>
              </div>
            </template>
          </div>

          <div class="preview-info">
            <div class="info-row">
              <span class="info-label">资源类型</span>
              <span class="info-value">{{ resourceTypeLabel }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">分享权限</span>
              <span class="info-value">{{ permissionLabel }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">链接设置</span>
              <span class="info-value">{{ linkSettingsSummary }}</span>
            </div>
          </div>

          <div class="preview-actions">
            <!-- 自己的分享 -->
            <template v-if="isOwner">
              <p class="action-hint">这是你自己的分享链接</p>
              <button class="btn btn-primary" @click="goToResource">打开资源</button>
            </template>
            <!-- 未登录（游客） -->
            <template v-else-if="!loggedIn">
              <template v-if="canAccept">
                <p class="action-hint">请先登录以接受此分享</p>
                <button class="btn btn-primary" @click="goLogin">前往登录</button>
              </template>
              <p v-else class="action-hint">{{ previewOnly ? '该分享链接仅用于预览' : '分享者未允许通过链接接收此文件' }}</p>
            </template>
            <!-- 已接受 -->
            <template v-else-if="alreadyAccepted">
              <div class="accepted-badge">
                <Icon icon="ri-check-line" :size="16" />
                <span>已接受此分享</span>
              </div>
              <button class="btn btn-primary" @click="goToResource">打开资源</button>
            </template>
            <!-- 可接收 -->
            <template v-else-if="canAccept">
              <p class="action-hint">
                {{ shareData.owner_username || '分享者' }} 邀请你{{ canEdit ? '编辑' : '查看' }}{{ resourceTypeLabel }}
              </p>
              <div class="action-buttons">
                <button class="btn btn-primary" :disabled="accepting" @click="acceptShare">
                  <Icon :icon="accepting ? 'ri-loader-4-line' : 'ri-check-line'" :size="14" :class="{ spin: accepting }" />
                  {{ accepting ? '处理中...' : '接受' }}
                </button>
                <button class="btn btn-ghost" :disabled="accepting" @click="rejectShare">
                  <Icon icon="ri-close-line" :size="14" />
                  拒绝
                </button>
              </div>
            </template>
            <!-- 仅预览 / 不允许接收 -->
            <template v-else>
              <p class="action-hint">{{ previewOnly ? '该分享链接仅用作预览，未开放接收与编辑' : '分享者未允许通过链接接收此文件' }}</p>
              <button v-if="loggedIn" class="btn btn-ghost" @click="goHome">返回首页</button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref('');
const errorTitle = ref('');
const errorIcon = ref('ri-error-warning-line');
const authRequired = ref(false);
const shareData = ref<any>(null);
const alreadyAccepted = ref(false);
const accepting = ref(false);

// 当前登录态（本地探测，避免全局 401 拦截把游客直接弹去登录页）
const currentUser = ref<any>(null);
const loggedIn = computed(() => !!currentUser.value);

// 游客编辑
const editing = ref(false);
const draftContent = ref('');
const savingContent = ref(false);
const savedTip = ref(false);
let savedTipTimer: ReturnType<typeof setTimeout> | null = null;

const token = computed(() => String(route.query.token || ''));

/** 与后端一致：/api 前缀 + JSON 信封；返回 data 字段 */
async function fetchApiData(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`/api${url}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || (payload && payload.code !== 0 && payload.code !== undefined)) {
    throw new Error(payload?.message || `请求失败 (HTTP ${response.status})`);
  }
  return payload?.data ?? payload;
}

/**
 * 探测登录态：不能用 useAuth().fetchMe()——其内部走 api/client，401 会把浏览器直接重定向到 /login，
 * 游客就无法查看「允许游客访问」的分享链接。
 */
async function detectSession(): Promise<any> {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.code !== 0 && payload?.code !== undefined) return null;
    return payload?.data ?? payload;
  } catch {
    return null;
  }
}

const resourceIcon = computed(() => {
  return shareData.value?.resource_type === 'instance' ? 'ri-git-branch-line' : 'ri-file-line';
});

const resourceTypeLabel = computed(() => {
  return shareData.value?.resource_type === 'instance' ? '配置实例' : '文件';
});

/** 四档权限中文标签（兼容旧值 view/edit） */
const PERMISSION_LABELS: Record<string, string> = {
  view_file: '查看文件',
  view_instance: '查看实例',
  edit_file: '可查看和编辑',
  edit_instance: '可查看编辑并管理实例',
};

const normalizedPermission = computed(() => {
  const raw = String(shareData.value?.permission ?? '').trim();
  if (raw === 'view') return 'view_file';
  if (raw === 'edit') return 'edit_file';
  return raw && raw in PERMISSION_LABELS ? raw : 'view_file';
});

const permissionLabel = computed(() => PERMISSION_LABELS[normalizedPermission.value] || '查看文件');

/** 是否具备编辑能力（edit_file / edit_instance） */
const canEdit = computed(() => normalizedPermission.value.startsWith('edit_'));

/** 链接四项设置（link_settings 新契约，兼容平铺与 share_settings） */
const linkSettings = computed(() => {
  const raw = shareData.value?.link_settings || shareData.value?.share_settings || {};
  const boolOf = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num !== 0 : fallback;
  };
  return {
    require_login: boolOf(raw.require_login ?? shareData.value?.require_login, true),
    preview_only: boolOf(raw.preview_only ?? shareData.value?.preview_only, false),
    allow_accept: boolOf(raw.allow_accept ?? shareData.value?.allow_accept, true),
    allow_guest_edit: boolOf(raw.allow_guest_edit ?? shareData.value?.allow_guest_edit, false),
  };
});

const previewOnly = computed(() => linkSettings.value.preview_only);

/** 是否允许通过链接接收：can_accept 优先，旧响应无此字段时按设置推导（默认允许，保持旧行为） */
const canAccept = computed(() => {
  if (typeof shareData.value?.can_accept === 'boolean') return shareData.value.can_accept;
  return !previewOnly.value && linkSettings.value.allow_accept;
});

const canGuestEdit = computed(() => {
  const explicit = shareData.value?.can_guest_edit;
  if (typeof explicit === 'boolean') return explicit;
  return linkSettings.value.allow_guest_edit && !previewOnly.value;
});

const isOwner = computed(() => {
  if (!shareData.value) return false;
  if (shareData.value.is_owner === true) return true;
  const me = currentUser.value;
  return !!me?.username && me.username === shareData.value.owner_username;
});

const fileText = computed<string | null>(() => {
  const raw = shareData.value?.content;
  if (typeof raw === 'string') return raw;
  if (raw !== undefined && raw !== null) return String(raw);
  return null;
});

const linkSettingsSummary = computed(() => {
  if (previewOnly.value) return '仅用作预览';
  const parts: string[] = [];
  parts.push(linkSettings.value.require_login ? '需登录查看' : '游客可查看');
  parts.push(linkSettings.value.allow_accept ? '允许接收' : '不允许接收');
  if (linkSettings.value.allow_guest_edit) parts.push('允许游客编辑');
  return parts.join(' · ');
});

async function loadShare() {
  loading.value = true;
  error.value = '';
  authRequired.value = false;
  try {
    // 统一走本页的 fetchApiData：游客遇到「需要登录」时只展示提示，不触发全局 401 跳转
    const data = await fetchApiData(`/share?action=get-preview&token=${encodeURIComponent(token.value)}`);
    shareData.value = data;
    // 已接受状态：优先使用新契约 already_accepted；旧响应回退到详情查询
    if (typeof data?.already_accepted === 'boolean') {
      alreadyAccepted.value = data.already_accepted;
    } else if (data?.share_id && loggedIn.value) {
      try {
        const accepted = await api.get<any>(`/share?action=get-share-detail&share_id=${data.share_id}`);
        alreadyAccepted.value = !!accepted;
      } catch {
        alreadyAccepted.value = false;
      }
    }
  } catch (e: any) {
    const msg = e?.message || '加载失败';
    if (msg.includes('登录') || msg.includes('认证')) {
      error.value = '请先登录后再查看此分享链接';
      errorTitle.value = '需要登录';
      errorIcon.value = 'ri-user-line';
      authRequired.value = true;
    } else if (msg.includes('仅用于预览') || msg.includes('仅用作预览')) {
      error.value = msg;
      errorTitle.value = '仅预览';
      errorIcon.value = 'ri-eye-line';
    } else if (msg.includes('过期')) {
      error.value = '此分享链接已过期，请联系分享者重新分享';
      errorTitle.value = '分享已过期';
      errorIcon.value = 'ri-time-line';
    } else if (msg.includes('不存在') || msg.includes('删除') || msg.includes('关闭')) {
      error.value = '此分享链接不存在或已被关闭';
      errorTitle.value = '分享不存在';
      errorIcon.value = 'ri-link-unlink';
    } else {
      error.value = msg;
      errorTitle.value = '加载失败';
      errorIcon.value = 'ri-error-warning-line';
    }
  } finally {
    loading.value = false;
  }
}

function showSavedTip() {
  savedTip.value = true;
  if (savedTipTimer) clearTimeout(savedTipTimer);
  savedTipTimer = setTimeout(() => { savedTip.value = false; }, 2500);
}

function startEditing() {
  draftContent.value = fileText.value ?? '';
  editing.value = true;
}

function cancelEditing() {
  editing.value = false;
  draftContent.value = '';
}

async function saveContent() {
  if (!shareData.value || savingContent.value) return;
  savingContent.value = true;
  try {
    const result = await api.post<any>('/share?action=save-preview', {
      token: token.value,
      content: draftContent.value,
    });
    shareData.value = {
      ...shareData.value,
      content: draftContent.value,
      updated_at: result?.updated_at || shareData.value.updated_at,
    };
    editing.value = false;
    showSavedTip();
  } catch (e: any) {
    alert(e?.message || '保存失败，请稍后重试');
  } finally {
    savingContent.value = false;
  }
}

async function acceptShare() {
  accepting.value = true;
  try {
    await api.post('/share?action=accept-preview-link', { token: token.value });
    alreadyAccepted.value = true;
  } catch (e: any) {
    alert(e.message || '接受失败');
  } finally {
    accepting.value = false;
  }
}

function rejectShare() {
  router.push('/');
}

function goLogin() {
  router.push('/login?redirect=' + encodeURIComponent(route.fullPath));
}

function goHome() {
  router.push('/');
}

function goToResource() {
  // V3 仅保留 cloud_file 分享，统一打开轻编辑器查看云文件
  router.push('/console/editor/light');
}

onMounted(async () => {
  if (!token.value) {
    error.value = '缺少分享 token';
    errorTitle.value = '无效链接';
    errorIcon.value = 'ri-link-unlink';
    loading.value = false;
    return;
  }
  currentUser.value = await detectSession();
  await loadShare();
});
</script>

<style scoped>
.share-preview-page {
  min-height: 100vh;
  background: var(--app-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-5);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-3);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.error-state {
  text-align: center;
}

.error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-8);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  max-width: 420px;
}

.error-card h2 {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.error-card p {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.5;
}

.preview-content {
  width: 100%;
  max-width: 640px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-4);
  padding: 0 var(--spacer-2);
}

.preview-brand {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.preview-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.preview-card-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-4);
  padding: var(--spacer-5);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
}

.preview-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: var(--accent-bg);
  color: var(--accent-base);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.preview-meta h1 {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  word-break: break-all;
}

.preview-owner {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.preview-card-body {
  padding: var(--spacer-5);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

/* ===== 文件内容预览 ===== */
.preview-file {
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.preview-file-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.preview-saved-tip {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 500;
  color: var(--status-success);
}

.preview-file-content {
  margin: 0;
  padding: var(--spacer-3);
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  tab-size: 4;
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--app-bg);
}

.preview-file-empty {
  padding: var(--spacer-5) var(--spacer-3);
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

/* ===== 游客/链接编辑 ===== */
.preview-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.preview-editor-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-wrap: wrap;
}

.action-hint-inline {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.preview-textarea {
  width: 100%;
  min-height: 220px;
  box-sizing: border-box;
  padding: var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  font-family: var(--font-family-mono, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
}

.preview-textarea:focus {
  border-color: var(--accent-base);
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  padding-top: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacer-3);
  font-size: var(--font-size-sm);
}

.info-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
}

.preview-actions {
  text-align: center;
  padding-top: var(--spacer-2);
}

.action-hint {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin: 0 0 var(--spacer-3);
}

.action-buttons {
  display: flex;
  justify-content: center;
  gap: var(--spacer-2);
}

.accepted-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  font-weight: 500;
  margin-bottom: var(--spacer-3);
}
</style>
