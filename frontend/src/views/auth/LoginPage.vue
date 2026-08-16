<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <div class="login-logo">
          <BrandLogo :size="40" marginRight="12px" marginBottom="-6px" />
          <span>CSES Cloud</span>
        </div>
        <div class="login-subtitle">智教云控制台</div>
      </div>

      <div class="login-card">
        <div class="login-tabs">
          <button class="tab" :class="{ active: activeTab === 'alliance' }" @click="switchTab('alliance')">
            <Icon icon="ri-shield-check-line" :size="16" />
            <span>智教联盟账户</span>
          </button>
          <button class="tab" :class="{ active: activeTab === 'sub' }" @click="switchTab('sub')">
            <Icon icon="ri-user-line" :size="16" />
            <span>子用户登录</span>
          </button>
          <button class="tab tab-hidden" :class="{ active: activeTab === 'temp_admin' }" @click="switchTab('temp_admin')" title="临时管理员模式">
            <Icon icon="ri-shield-keyhole-line" :size="16" />
          </button>
        </div>

        <!-- 智教联盟账户 -->
        <form v-if="activeTab === 'alliance'" @submit.prevent="handleAllianceLogin" class="login-form">
          <div class="form-group">
            <label for="alliance-username">联盟用户名</label>
            <div class="input-wrapper">
              <Icon icon="ri-shield-user-line" class="input-icon" />
              <input
                id="alliance-username"
                v-model="allianceUsername"
                type="text"
                placeholder="请输入智教联盟账户用户名"
                autocomplete="username"
              />
            </div>
          </div>
          <div class="alliance-tip">
            <Icon icon="ri-information-line" :size="14" />
            <span>通过智教联盟平台授权登录，登录后可在控制台将子用户绑定至本账户。</span>
          </div>
          <button type="submit" class="login-btn" :disabled="loading">
            <template v-if="!loading">
              <Icon icon="ri-login-box-line" :size="18" />
              <span>授权登录</span>
            </template>
            <span v-else class="loading-spinner"></span>
          </button>
        </form>

        <!-- 子用户登录 -->
        <form v-else-if="activeTab === 'sub'" @submit.prevent="handleSubLogin" class="login-form">
          <div class="form-group">
            <label for="school-select">登录身份</label>
            <div class="input-wrapper">
              <Icon icon="ri-building-line" class="input-icon" />
              <select id="school-select" v-model="selectedSchoolValue" @change="onSchoolChange">
                <option value="__instance__">实例子用户</option>
                <option v-for="s in schools" :key="s.id" :value="String(s.id)">{{ s.name }}</option>
              </select>
              <Icon icon="ri-arrow-down-s-line" class="select-caret" />
            </div>
          </div>

          <div v-if="selectedSchoolValue === '__instance__'" class="form-group">
            <label for="instance-uid">实例 ID</label>
            <div class="input-wrapper">
              <Icon icon="ri-hashtag" class="input-icon" />
              <input
                id="instance-uid"
                v-model="instanceUid"
                type="text"
                placeholder="请输入实例唯一 ID"
                autocomplete="off"
              />
            </div>
          </div>
          <div v-else class="form-group">
            <label>学校</label>
            <div class="school-badge">
              <Icon icon="ri-school-line" :size="14" />
              <span>{{ selectedSchoolName }}</span>
            </div>
          </div>

          <div class="form-group">
            <label for="sub-username">用户名</label>
            <div class="input-wrapper">
              <Icon icon="ri-user-line" class="input-icon" />
              <input
                id="sub-username"
                v-model="subUsername"
                type="text"
                placeholder="请输入用户名"
                autocomplete="username"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="sub-password">密码</label>
            <div class="input-wrapper">
              <Icon icon="ri-lock-line" class="input-icon" />
              <input
                id="sub-password"
                v-model="subPassword"
                :type="showPassword ? 'text' : 'password'"
                placeholder="请输入密码"
                autocomplete="current-password"
              />
              <button type="button" class="toggle-password" @click="showPassword = !showPassword">
                <Icon :icon="showPassword ? 'ri-eye-line' : 'ri-eye-off-line'" :size="16" />
              </button>
            </div>
          </div>

          <div class="form-options">
            <label class="remember">
              <input type="checkbox" v-model="rememberInList" />
              <span>保留在登录列表中</span>
            </label>
          </div>

          <button type="submit" class="login-btn" :disabled="loading">
            <template v-if="!loading">
              <Icon icon="ri-login-box-line" :size="18" />
              <span>登录</span>
            </template>
            <span v-else class="loading-spinner"></span>
          </button>
        </form>

        <!-- 临时管理员登录 -->
        <form v-else-if="activeTab === 'temp_admin'" @submit.prevent="handleTempAdminLogin" class="login-form">
          <div class="form-group">
            <label for="temp-username">管理员用户名</label>
            <div class="input-wrapper">
              <Icon icon="ri-shield-user-line" class="input-icon" />
              <input
                id="temp-username"
                v-model="tempAdminUsername"
                type="text"
                placeholder="请输入临时管理员用户名"
                autocomplete="off"
              />
            </div>
          </div>
          <div class="form-group">
            <label for="temp-password">管理员密码</label>
            <div class="input-wrapper">
              <Icon icon="ri-lock-line" class="input-icon" />
              <input
                id="temp-password"
                v-model="tempAdminPassword"
                :type="showTempPassword ? 'text' : 'password'"
                placeholder="请输入密码"
                autocomplete="off"
              />
              <button type="button" class="toggle-password" @click="showTempPassword = !showTempPassword">
                <Icon :icon="showTempPassword ? 'ri-eye-line' : 'ri-eye-off-line'" :size="16" />
              </button>
            </div>
          </div>
          <button type="submit" class="login-btn temp-admin-btn" :disabled="loading">
            <template v-if="!loading">
              <Icon icon="ri-login-box-line" :size="18" />
              <span>管理员登录</span>
            </template>
            <span v-else class="loading-spinner"></span>
          </button>
        </form>

        <div v-if="errorMessage" class="error-tip">
          <Icon icon="ri-error-warning-line" :size="14" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- 保留登录列表 -->
        <div v-if="savedLogins.length > 0 && activeTab !== 'temp_admin'" class="saved-section">
          <div class="saved-header">
            <Icon icon="ri-history-line" :size="14" />
            <span>保留的登录</span>
          </div>
          <div class="saved-list">
            <button
              v-for="entry in savedLogins"
              :key="entry.id"
              type="button"
              class="saved-item"
              @click="applySavedEntry(entry)"
            >
              <Icon :icon="entry.entry_type === 'instance_sub' ? 'ri-cloud-line' : 'ri-school-line'" :size="16" />
              <div class="saved-meta">
                <div class="saved-label">{{ entry.display_label }}</div>
                <div class="saved-sub">
                  <span v-if="entry.entry_type === 'instance_sub'">实例子用户</span>
                  <span v-else>学校子用户</span>
                </div>
              </div>
              <button
                type="button"
                class="saved-remove"
                @click.stop="removeSavedEntry(entry)"
                title="从列表移除"
              >
                <Icon icon="ri-close-line" :size="14" />
              </button>
            </button>
          </div>
        </div>

        <div v-if="activeTab !== 'temp_admin'" class="login-footer">
          <span>还没有账号？</span>
          <a href="/contact">联系管理员</a>
        </div>
      </div>

      <div class="back-to-home">
        <a href="/">
          <Icon icon="ri-arrow-left-line" :size="14" />
          返回首页
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import BrandLogo from '../../components/BrandLogo.vue';
import { authApi } from '../../api';
import { useAuth } from '../../composables/useAuth';

const router = useRouter();
const route = useRoute();
const { fetchMe } = useAuth();

const activeTab = ref<'alliance' | 'sub' | 'temp_admin'>('alliance');
const loading = ref(false);
const errorMessage = ref('');

// 联盟登录
const allianceUsername = ref('');

// 子用户登录
const schools = ref<any[]>([]);
const selectedSchoolValue = ref<string>('__instance__'); // __instance__ | schoolId
const instanceUid = ref('');
const subUsername = ref('');
const subPassword = ref('');
const rememberInList = ref(false);
const showPassword = ref(false);

// 保留登录列表
const savedLogins = ref<any[]>([]);

// 临时管理员
const tempAdminUsername = ref('');
const tempAdminPassword = ref('');
const showTempPassword = ref(false);

const selectedSchoolName = computed(() => {
  const id = Number(selectedSchoolValue.value);
  return schools.value.find(s => s.id === id)?.name || '';
});

function switchTab(tab: 'alliance' | 'sub' | 'temp_admin') {
  activeTab.value = tab;
  errorMessage.value = '';
}

function onSchoolChange() {
  errorMessage.value = '';
}

async function loadInitData() {
  try {
    const [schoolList, me] = await Promise.all([
      authApi.schools().catch(() => []),
      authApi.me().catch(() => null)
    ]);
    schools.value = schoolList || [];
    if (me?.saved_logins) {
      savedLogins.value = me.saved_logins;
    }
  } catch {
    // 未登录时也允许拉取学校列表
  }
}

onMounted(loadInitData);

async function handleAllianceLogin() {
  if (!allianceUsername.value.trim()) {
    errorMessage.value = '请输入联盟用户名';
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    const data: any = await authApi.loginAlliance(allianceUsername.value.trim());
    await fetchMe();
    const redirect = (route.query.redirect as string) || data?.redirect || '/console/instances';
    router.push(redirect);
  } catch (e: any) {
    errorMessage.value = e?.message || '登录失败';
  } finally {
    loading.value = false;
  }
}

async function handleTempAdminLogin() {
  if (!tempAdminUsername.value || !tempAdminPassword.value) {
    errorMessage.value = '请填写管理员用户名和密码';
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    const data: any = await authApi.loginTempAdmin(tempAdminUsername.value, tempAdminPassword.value);
    await fetchMe();
    const redirect = (route.query.redirect as string) || data?.redirect || '/console/admin';
    router.push(redirect);
  } catch (e: any) {
    errorMessage.value = e?.message || '登录失败';
  } finally {
    loading.value = false;
  }
}

async function handleSubLogin() {
  errorMessage.value = '';
  if (!subUsername.value || !subPassword.value) {
    errorMessage.value = '请填写用户名与密码';
    return;
  }
  if (selectedSchoolValue.value === '__instance__') {
    if (!instanceUid.value.trim()) {
      errorMessage.value = '请输入实例 ID';
      return;
    }
    loading.value = true;
    try {
      const data: any = await authApi.loginInstanceSub(
        instanceUid.value.trim(),
        subUsername.value,
        subPassword.value,
        rememberInList.value
      );
      await fetchMe();
      if (rememberInList.value && data?.entry) {
        savedLogins.value = await authApi.savedLogins().catch(() => savedLogins.value);
      }
      const redirect = (route.query.redirect as string) || data?.redirect || '/console/instances';
      router.push(redirect);
    } catch (e: any) {
      errorMessage.value = e?.message || '登录失败';
    } finally {
      loading.value = false;
    }
    return;
  }
  const schoolId = Number(selectedSchoolValue.value);
  if (!schoolId) {
    errorMessage.value = '请选择学校';
    return;
  }
  loading.value = true;
  try {
    const data: any = await authApi.loginSub(
      schoolId,
      subUsername.value,
      subPassword.value,
      rememberInList.value
    );
    await fetchMe();
    if (rememberInList.value && data?.entry) {
      savedLogins.value = await authApi.savedLogins().catch(() => savedLogins.value);
    }
    const redirect = (route.query.redirect as string) || data?.redirect || '/console/campus';
    router.push(redirect);
  } catch (e: any) {
    errorMessage.value = e?.message || '登录失败';
  } finally {
    loading.value = false;
  }
}

function applySavedEntry(entry: any) {
  if (entry.entry_type === 'instance_sub') {
    selectedSchoolValue.value = '__instance__';
    instanceUid.value = entry.instance_uid || '';
  } else {
    selectedSchoolValue.value = String(entry.school_id);
  }
  subUsername.value = entry.sub_username || '';
  subPassword.value = '';
  rememberInList.value = true;
  errorMessage.value = '';
}

async function removeSavedEntry(entry: any) {
  try {
    await authApi.removeSavedLogin(entry.id);
    savedLogins.value = savedLogins.value.filter(e => e.id !== entry.id);
  } catch (e: any) {
    errorMessage.value = e?.message || '移除失败';
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #0067C0 0%, #004578 100%);
  position: relative;
  overflow: hidden;
}

.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 20%, rgba(76, 194, 255, 0.15) 0%, transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(76, 194, 255, 0.1) 0%, transparent 50%);
}

.login-container {
  width: 100%;
  max-width: 460px;
  padding: var(--spacer-6);
  position: relative;
  z-index: 1;
}

.login-header {
  text-align: center;
  margin-bottom: var(--spacer-6);
}

.login-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: 32px;
  font-weight: 700;
  color: white;
  letter-spacing: -0.5px;
}

.login-subtitle {
  font-size: var(--font-size-base);
  color: rgba(255, 255, 255, 0.8);
  margin-top: var(--spacer-2);
}

.login-card {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: var(--radius-xl);
  padding: var(--spacer-6);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.login-tabs {
  display: flex;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-5);
  border-bottom: 1px solid var(--divider-stroke);
  padding-bottom: var(--spacer-3);
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-1);
  background: transparent;
  border: none;
  padding: var(--spacer-2) var(--spacer-3);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--fast-duration), border-color var(--fast-duration);
}

.tab.active {
  color: var(--accent-base);
  border-bottom-color: var(--accent-base);
}

.tab-hidden {
  flex: 0 0 auto;
  padding: var(--spacer-2) var(--spacer-2);
  opacity: 0.35;
  transition: opacity var(--fast-duration), color var(--fast-duration), border-color var(--fast-duration);
}

.tab-hidden:hover {
  opacity: 0.7;
}

.tab-hidden.active {
  opacity: 1;
  color: var(--accent-base);
  border-bottom-color: var(--accent-base);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}



.school-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: rgba(0, 103, 192, 0.08);
  border: 1px solid rgba(0, 103, 192, 0.2);
  color: var(--accent-base);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  font-weight: 500;
  align-self: flex-start;
}



.alliance-tip {
  display: flex;
  gap: var(--spacer-1);
  align-items: flex-start;
  color: rgba(0, 0, 0, 0.55);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(0, 103, 192, 0.04);
  border-radius: var(--radius-md);
}

.alliance-tip svg {
  margin-top: 2px;
  flex-shrink: 0;
}

.login-btn {
  width: 100%;
  height: 44px;
  background: var(--accent-base);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--fast-duration), transform var(--fast-duration);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
}

.login-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.login-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}



.saved-section {
  margin-top: var(--spacer-5);
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding-top: var(--spacer-4);
}

.saved-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: rgba(0, 0, 0, 0.62);
  margin-bottom: var(--spacer-2);
}

.saved-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.saved-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(249, 249, 249, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: rgba(0, 0, 0, 0.89);
  text-align: left;
  width: 100%;
  transition: background var(--fast-duration), border-color var(--fast-duration);
}

.saved-item:hover {
  background: #FFFFFF;
  border-color: var(--accent-base);
}

.saved-meta {
  flex: 1;
  min-width: 0;
}

.saved-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.saved-sub {
  font-size: var(--font-size-xs);
  color: rgba(0, 0, 0, 0.45);
}

.saved-remove {
  background: transparent;
  border: none;
  color: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: var(--radius-sm);
}

.saved-remove:hover {
  background: rgba(196, 43, 28, 0.08);
  color: #C42B1C;
}

.login-footer {
  text-align: center;
  margin-top: var(--spacer-4);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.login-footer a {
  color: var(--accent-base);
  text-decoration: none;
  margin-left: var(--spacer-1);
}

.login-footer a:hover {
  text-decoration: underline;
}

/* 临时管理员按钮 */
.temp-admin-btn {
  background: var(--subtle-pressed) !important;
  color: var(--text-secondary) !important;
}

.temp-admin-btn:hover:not(:disabled) {
  background: var(--ctrl-border-accent) !important;
}

.back-to-home {
  text-align: center;
  margin-top: var(--spacer-5);
}

.back-to-home a {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--font-size-sm);
  text-decoration: none;
  transition: color var(--fast-duration);
}

.back-to-home a:hover {
  color: white;
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
  .login-card {
    background: rgba(32, 32, 32, 0.96);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .login-tabs {
    border-bottom-color: var(--divider-stroke);
  }

  .tab {
    color: var(--text-tertiary);
  }

  .login-footer {
    color: var(--text-tertiary);
  }

  .alliance-tip {
    color: rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.04);
  }

  .saved-section {
    border-top-color: rgba(255, 255, 255, 0.08);
  }

  .saved-header {
    color: rgba(255, 255, 255, 0.62);
  }

  .saved-item {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.89);
  }

  .saved-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .saved-label {
    color: rgba(255, 255, 255, 0.89);
  }

  .saved-sub {
    color: rgba(255, 255, 255, 0.45);
  }

  .school-badge {
    background: rgba(0, 103, 192, 0.2);
    border-color: rgba(0, 103, 192, 0.4);
    color: rgba(120, 190, 255, 1);
  }

  .temp-admin-btn {
    background: var(--subtle-pressed) !important;
    color: var(--text-secondary) !important;
  }

  .temp-admin-btn:hover:not(:disabled) {
    background: var(--ctrl-border-accent) !important;
  }
}
</style>
