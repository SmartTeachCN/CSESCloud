<template>
  <div class="profile-page">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">个人中心</h1>
        <p class="page-description">管理您的账户信息、安全设置和偏好</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-primary" :disabled="saving" @click="saveProfile">
          <Icon icon="ri-save-line" :size="14" />
          {{ saving ? '保存中...' : '保存更改' }}
        </button>
      </div>
    </div>

    <div class="profile-layout">
      <div class="profile-sidebar">
        <div class="avatar-section">
          <div class="avatar-large" v-if="!profile.avatar">
            {{ displayInitial }}
          </div>
          <img v-else class="avatar-img" :src="profile.avatar" :alt="profile.display_name" />
          <div class="avatar-actions">
            <label class="btn btn-ghost-sm">
              <Icon icon="ri-camera-line" :size="14" />
              更换头像
              <input type="file" hidden accept="image/*" @change="onAvatarFileChange" />
            </label>
          </div>
        </div>
        <div class="user-summary">
          <div class="user-name">{{ profile.display_name }}</div>
          <div class="user-role">{{ roleLabel }}</div>
          <div class="user-meta">{{ profile.email }}</div>
        </div>
        <div class="sidebar-nav">
          <button
            v-for="section in sections"
            :key="section.key"
            class="nav-item"
            :class="{ active: activeSection === section.key }"
            @click="activeSection = section.key"
          >
            <span class="nav-icon"><Icon :icon="section.icon" :size="18" /></span>
            <span class="nav-label">{{ section.label }}</span>
          </button>
        </div>
      </div>

      <div class="profile-content">
        <!-- 个人信息 -->
        <div class="panel" v-show="activeSection === 'info'">
          <div class="panel-header">
            <h3 class="panel-title">个人信息</h3>
          </div>
          <div class="panel-body form-grid">
            <div class="form-group">
              <label class="form-label">姓名</label>
              <input v-model="profile.display_name" type="text" class="form-input" placeholder="请输入姓名" />
            </div>
            <div class="form-group">
              <label class="form-label">邮箱</label>
              <input v-model="profile.email" type="email" class="form-input" placeholder="请输入邮箱" />
            </div>
            <div class="form-group">
              <label class="form-label">手机</label>
              <input v-model="profile.phone" type="tel" class="form-input" placeholder="请输入手机号" />
            </div>
            <div class="form-group">
              <label class="form-label">部门</label>
              <input v-model="profile.department" type="text" class="form-input" placeholder="请输入部门" />
            </div>
          </div>
        </div>

        <!-- 安全设置 -->
        <div class="panel" v-show="activeSection === 'security'">
          <div class="panel-header">
            <h3 class="panel-title">安全设置</h3>
          </div>
          <div class="panel-body security-section">
            <div class="security-card">
              <div class="security-info">
                <div class="security-icon"><Icon icon="ri-key-2-line" :size="24" /></div>
                <div>
                  <div class="security-title">密码</div>
                  <div class="security-desc">定期更换密码以保护账户安全</div>
                </div>
              </div>
              <button class="btn btn-ghost-sm" @click="showPasswordDialog = true">修改密码</button>
            </div>

            <div class="security-card">
              <div class="security-info">
                <div class="security-icon"><Icon icon="ri-shield-check-line" :size="24" /></div>
                <div>
                  <div class="security-title">双因素认证 (2FA)</div>
                  <div class="security-desc">使用身份验证器应用提供额外的账户保护</div>
                </div>
              </div>
              <button class="toggle" :class="{ on: twoFAEnabled }" @click="twoFAEnabled = !twoFAEnabled">
                <span class="toggle-thumb"></span>
              </button>
            </div>

            <div class="security-card">
              <div class="security-info">
                <div class="security-icon"><Icon icon="ri-smartphone-line" :size="24" /></div>
                <div>
                  <div class="security-title">可信设备</div>
                  <div class="security-desc">管理已信任此账户的设备</div>
                </div>
              </div>
              <button class="btn btn-ghost-sm">管理设备</button>
            </div>

            <div class="security-card">
              <div class="security-info">
                <div class="security-icon"><Icon icon="ri-file-list-3-line" :size="24" /></div>
                <div>
                  <div class="security-title">登录历史</div>
                  <div class="security-desc">查看最近的账户登录活动</div>
                </div>
              </div>
              <button class="btn btn-ghost-sm">查看详情</button>
            </div>
          </div>
        </div>

        <!-- 偏好设置 -->
        <div class="panel" v-show="activeSection === 'preferences'">
          <div class="panel-header">
            <h3 class="panel-title">偏好设置</h3>
          </div>
          <div class="panel-body preferences-section">
            <div class="pref-item">
              <div>
                <div class="pref-title">界面语言</div>
                <div class="pref-desc">选择系统显示语言</div>
              </div>
              <select v-model="preferences.language" class="form-select" @change="savePreferences">
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
                <option value="zh-TW">繁體中文</option>
              </select>
            </div>

            <div class="pref-item">
              <div>
                <div class="pref-title">主题模式</div>
                <div class="pref-desc">选择明亮或深色主题</div>
              </div>
              <div class="theme-toggle">
                <button
                  class="theme-btn"
                  :class="{ active: preferences.theme === 'light' }"
                  @click="setTheme('light')"
                ><Icon icon="ri-sun-line" :size="14" /> 明亮</button>
                <button
                  class="theme-btn"
                  :class="{ active: preferences.theme === 'dark' }"
                  @click="setTheme('dark')"
                ><Icon icon="ri-moon-line" :size="14" /> 深色</button>
              </div>
            </div>

            <div class="pref-item">
              <div>
                <div class="pref-title">邮件通知</div>
                <div class="pref-desc">接收重要事件和更新的邮件通知</div>
              </div>
              <button class="toggle" :class="{ on: preferences.emailNotify }" @click="togglePref('emailNotify')">
                <span class="toggle-thumb"></span>
              </button>
            </div>

            <div class="pref-item">
              <div>
                <div class="pref-title">每周报告</div>
                <div class="pref-desc">每周一收到运行数据摘要</div>
              </div>
              <button class="toggle" :class="{ on: preferences.weeklyReport }" @click="togglePref('weeklyReport')">
                <span class="toggle-thumb"></span>
              </button>
            </div>

            <div class="pref-item">
              <div>
                <div class="pref-title">数据导出格式</div>
                <div class="pref-desc">选择导出数据时的默认文件格式</div>
              </div>
              <select v-model="preferences.exportFormat" class="form-select" @change="savePreferences">
                <option value="csv">CSV</option>
                <option value="xlsx">Excel</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 修改密码对话框 -->
    <Teleport to="body">
      <div v-if="showPasswordDialog" class="modal-overlay" @click.self="showPasswordDialog = false">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>修改密码</h3>
            <button class="modal-close" @click="showPasswordDialog = false"><Icon icon="ri-close-line" :size="20" /></button>
          </div>
          <div class="modal-body">
            <div class="form-group" style="margin-bottom: var(--spacer-3)">
              <label class="form-label">旧密码</label>
              <input v-model="passwordForm.oldPassword" type="password" class="form-input" placeholder="请输入旧密码" />
            </div>
            <div class="form-group" style="margin-bottom: var(--spacer-3)">
              <label class="form-label">新密码</label>
              <input v-model="passwordForm.newPassword" type="password" class="form-input" placeholder="至少 6 位" />
            </div>
            <div class="form-group">
              <label class="form-label">确认新密码</label>
              <input v-model="passwordForm.confirmPassword" type="password" class="form-input" placeholder="再次输入新密码" />
            </div>
            <p v-if="passwordError" class="form-error">{{ passwordError }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost-sm" @click="showPasswordDialog = false">取消</button>
            <button class="btn btn-primary" :disabled="changingPassword" @click="changePassword">
              {{ changingPassword ? '修改中...' : '确认修改' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast 提示 -->
    <Teleport to="body">
      <div v-if="toast.show" class="toast" :class="toast.type">{{ toast.message }}</div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { profileApi } from '../../api';
import { useAuth } from '../../composables/useAuth';

const { user } = useAuth();
const activeSection = ref<'info' | 'security' | 'preferences'>('info');
const twoFAEnabled = ref(false);
const saving = ref(false);
const loading = ref(true);

// 用户资料
const profile = reactive({
  display_name: '',
  email: '',
  phone: '',
  department: '',
  avatar: '',
  role: ''
});

// 偏好设置
const preferences = reactive({
  language: 'zh-CN',
  theme: 'light',
  emailNotify: true,
  weeklyReport: false,
  exportFormat: 'xlsx'
});

// 密码修改
const showPasswordDialog = ref(false);
const changingPassword = ref(false);
const passwordError = ref('');
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
});

// Toast
const toast = reactive({ show: false, message: '', type: 'success' as 'success' | 'error' });

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.show = true;
  toast.message = message;
  toast.type = type;
  setTimeout(() => { toast.show = false; }, 2500);
}

const displayInitial = computed(() => {
  return profile.display_name ? profile.display_name.charAt(0).toUpperCase() : '?';
});

const roleLabel = computed(() => {
  const roleMap: Record<string, string> = {
    admin: '管理员',
    teacher: '教师',
    student: '学生'
  };
  return roleMap[profile.role] || user.value?.role || '普通用户';
});

const sections = [
  { key: 'info' as const, icon: 'ri-user-line', label: '个人信息' },
  { key: 'security' as const, icon: 'ri-lock-line', label: '安全设置' },
  { key: 'preferences' as const, icon: 'ri-settings-3-line', label: '偏好设置' }
];

// 加载用户资料
async function loadProfile() {
  try {
    loading.value = true;
    const data = await profileApi.get();
    profile.display_name = data.display_name || '';
    profile.email = data.email || '';
    profile.phone = data.phone || '';
    profile.department = data.department || '';
    profile.avatar = data.avatar || '';
    profile.role = data.role || '';

    // 加载偏好设置
    if (data.preferences && typeof data.preferences === 'object' && Object.keys(data.preferences).length > 0) {
      Object.assign(preferences, data.preferences);
    }
  } catch (e: any) {
    showToast(e.message || '加载失败', 'error');
  } finally {
    loading.value = false;
  }
}

// 保存个人资料
async function saveProfile() {
  try {
    saving.value = true;
    await profileApi.update({
      display_name: profile.display_name,
      email: profile.email,
      phone: profile.phone,
      department: profile.department
    });
    showToast('资料已保存');

    // 刷新当前用户信息
    if (user.value) {
      user.value.display_name = profile.display_name;
    }
  } catch (e: any) {
    showToast(e.message || '保存失败', 'error');
  } finally {
    saving.value = false;
  }
}

// 修改密码
async function changePassword() {
  passwordError.value = '';
  if (!passwordForm.oldPassword) { passwordError.value = '请输入旧密码'; return; }
  if (passwordForm.newPassword.length < 6) { passwordError.value = '新密码至少 6 位'; return; }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) { passwordError.value = '两次输入的新密码不一致'; return; }

  try {
    changingPassword.value = true;
    await profileApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
    showToast('密码修改成功');
    showPasswordDialog.value = false;
    passwordForm.oldPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
  } catch (e: any) {
    passwordError.value = e.message || '密码修改失败';
  } finally {
    changingPassword.value = false;
  }
}

// 头像上传
async function onAvatarFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const result = await profileApi.uploadAvatar(file);
    profile.avatar = result.url;
    showToast('头像上传成功');
  } catch (e: any) {
    showToast(e.message || '上传失败', 'error');
  } finally {
    input.value = '';
  }
}

// 偏好设置
function setTheme(theme: string) {
  preferences.theme = theme;
  savePreferences();
}

async function togglePref(key: string) {
  (preferences as any)[key] = !(preferences as any)[key];
  await savePreferences();
}

async function savePreferences() {
  try {
    await profileApi.savePreferences({ ...preferences });
  } catch (_) {
    // 静默失败
  }
}

onMounted(() => {
  loadProfile();
});
</script>

<style scoped>
.profile-page {
  padding: var(--spacer-5);
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-5);
  flex-wrap: wrap;
  gap: var(--spacer-3);
}

.page-title {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.page-description {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: var(--spacer-1) 0 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
  border: none;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-ghost-sm {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.btn-ghost-sm:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.profile-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--spacer-5);
}

@media (max-width: 900px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }
}

.profile-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.avatar-section {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-5);
  text-align: center;
}

.avatar-large {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-full);
  background: var(--accent-base);
  color: var(--accent-text);
  font-size: var(--font-size-3xl);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto var(--spacer-3);
}

.avatar-img {
  width: 96px;
  height: 96px;
  border-radius: var(--radius-full);
  object-fit: cover;
  margin: 0 auto var(--spacer-3);
  display: block;
}

.avatar-actions {
  display: flex;
  justify-content: center;
}

.avatar-actions label {
  cursor: pointer;
}

.user-summary {
  text-align: center;
  margin-bottom: var(--spacer-4);
}

.user-name {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.user-role {
  display: inline-block;
  margin-top: var(--spacer-1);
  padding: 2px var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  background: rgba(0, 103, 192, 0.1);
  color: var(--accent-base);
  border-radius: var(--radius-full);
}

.user-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 100%;
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
  text-align: left;
}

.nav-item:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  font-weight: 600;
}

.nav-icon {
  width: 20px;
  text-align: center;
}

.profile-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.panel-header {
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.panel-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.panel-body {
  padding: var(--spacer-4);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacer-4);
}

@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.form-input,
.form-select {
  height: 36px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
  font-family: var(--font-family);
}

.form-input:focus,
.form-select:focus {
  border-color: var(--accent-base);
}

.form-select {
  cursor: pointer;
}

.form-error {
  color: var(--danger-base);
  font-size: var(--font-size-xs);
  margin: var(--spacer-2) 0 0;
}

.security-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.security-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.security-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
}

.security-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card-bg);
  border-radius: var(--radius-md);
}

.security-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.security-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.toggle {
  position: relative;
  width: 44px;
  height: 24px;
  background: var(--subtle-secondary);
  border: 1px solid var(--toggle-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background var(--fast-duration);
  padding: 0;
}

.toggle.on {
  background: var(--accent-base);
  border-color: var(--accent-base);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: var(--toggle-thumb);
  border-radius: var(--radius-full);
  transition: transform var(--fast-duration), background var(--fast-duration);
}

.toggle.on .toggle-thumb {
  transform: translateX(20px);
  background: var(--accent-text);
}

.preferences-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.pref-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacer-4);
  padding-bottom: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.pref-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.pref-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.pref-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.theme-toggle {
  display: flex;
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  padding: 2px;
}

.theme-btn {
  padding: var(--spacer-1) var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.theme-btn.active {
  background: var(--card-bg);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-dialog {
  background: var(--layer-default);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);  
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-sm);
}

.modal-close:hover {
  color: var(--text-primary);
  background: var(--subtle-secondary);
}

.modal-body {
  padding: var(--spacer-4);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

/* Toast */
.toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: #fff;
  z-index: 10000;
  pointer-events: none;
  animation: toast-in 0.3s ease;
}

.toast.success {
  background: #16a34a;
}

.toast.error {
  background: #dc2626;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>