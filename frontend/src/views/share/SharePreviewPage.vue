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
          <span>CSES Cloud 分享</span>
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
              <span>由 {{ shareData.owner_username }} 分享</span>
            </div>
          </div>
        </div>

        <div class="preview-card-body">
          <div class="preview-info">
            <div class="info-row">
              <span class="info-label">资源类型</span>
              <span class="info-value">{{ resourceTypeLabel }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">分享权限</span>
              <span class="info-value">{{ shareData.permission === 'edit' ? '可查看和编辑' : '仅查看' }}</span>
            </div>
          </div>

          <div class="preview-actions">
            <template v-if="!isLoggedIn">
              <p class="action-hint">请先登录以接受此分享</p>
              <button class="btn btn-primary" @click="goLogin">前往登录</button>
            </template>
            <template v-else-if="isOwner">
              <p class="action-hint">这是你自己的分享</p>
              <button class="btn btn-primary" @click="goToResource">查看资源</button>
            </template>
            <template v-else-if="alreadyAccepted">
              <div class="accepted-badge">
                <Icon icon="ri-check-line" :size="16" />
                <span>已接受此分享</span>
              </div>
              <button class="btn btn-primary" @click="goToResource">查看资源</button>
            </template>
            <template v-else>
              <p class="action-hint">{{ shareData.owner_username }} 邀请你查看{{ resourceTypeLabel }}</p>
              <div class="action-buttons">
                <button class="btn btn-primary" @click="acceptShare" :disabled="accepting">
                  <Icon :icon="accepting ? 'ri-loader-4-line' : 'ri-check-line'" :size="14" :class="{ spin: accepting }" />
                  {{ accepting ? '处理中...' : '接受' }}
                </button>
                <button class="btn btn-ghost" @click="rejectShare" :disabled="accepting">
                  <Icon icon="ri-close-line" :size="14" />
                  拒绝
                </button>
              </div>
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
import { useAuth } from '../../composables/useAuth';

const route = useRoute();
const router = useRouter();
const { user, isLoggedIn } = useAuth();

const loading = ref(true);
const error = ref('');
const errorTitle = ref('');
const errorIcon = ref('ri-error-warning-line');
const authRequired = ref(false);
const shareData = ref<any>(null);
const alreadyAccepted = ref(false);
const accepting = ref(false);

const token = computed(() => (route.query.token as string) || '');

const resourceIcon = computed(() => {
  if (shareData.value?.resource_type === 'instance') return 'ri-cloud-line';
  return 'ri-file-line';
});

const resourceTypeLabel = computed(() => {
  if (shareData.value?.resource_type === 'instance') return '实例';
  return '文件';
});

const isOwner = computed(() => {
  if (!user.value || !shareData.value) return false;
  return user.value.username === shareData.value.owner_username;
});

async function loadShare() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get<any>(`/share?action=get-preview&token=${encodeURIComponent(token.value)}`);
    shareData.value = data;
    if (data?.share_id && user.value) {
      try {
        const accepted = await api.get<any>(`/share?action=get-share-detail&share_id=${data.share_id}`);
        alreadyAccepted.value = !!accepted;
      } catch {
        alreadyAccepted.value = false;
      }
    }
  } catch (e: any) {
    const msg = e.message || '加载失败';
    if (msg.includes('登录') || msg.includes('认证')) {
      error.value = '请先登录后再访问此分享链接';
      errorTitle.value = '未登录';
      errorIcon.value = 'ri-user-line';
      authRequired.value = true;
    } else if (msg.includes('过期')) {
      error.value = '此分享链接已过期，请联系分享者重新分享';
      errorTitle.value = '分享已过期';
      errorIcon.value = 'ri-time-line';
    } else if (msg.includes('不存在') || msg.includes('删除')) {
      error.value = '此分享链接不存在或已被删除';
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
  const data = shareData.value;
  if (!data) return;
  if (data.resource_type === 'instance') {
    router.push(`/instance/${data.resource_id}/edit`);
  } else {
    router.push('/console/editor/light');
  }
}

onMounted(() => {
  if (token.value) {
    loadShare();
  } else {
    error.value = '缺少分享 token';
    errorTitle.value = '无效链接';
    errorIcon.value = 'ri-link-unlink';
    loading.value = false;
  }
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
  max-width: 560px;
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
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-4);
  padding-bottom: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
}



.preview-actions {
  text-align: center;
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