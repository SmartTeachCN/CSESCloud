<template>
  <div class="campus-settings">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">校园设置</h1>
        <p class="page-description">配置校园系统的全局参数</p>
      </div>
    </div>

    <div class="settings-layout">
      <div class="settings-nav">
        <button
          v-for="section in sections"
          :key="section.id"
          class="nav-item"
          :class="{ active: activeSection === section.id }"
          @click="activeSection = section.id"
        >
          <span class="nav-icon"><Icon :icon="section.icon" :size="18" /></span>
          <span class="nav-label">{{ section.label }}</span>
        </button>
      </div>

      <div class="settings-content">
        <div v-if="activeSection === 'general'" class="settings-section">
          <h2 class="section-title">常规设置</h2>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">系统名称</div>
              <div class="setting-desc">显示在浏览器标签和标题栏中</div>
            </div>
            <input type="text" v-model="settings.systemName" class="setting-input" />
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">默认语言</div>
              <div class="setting-desc">界面默认显示的语言</div>
            </div>
            <select v-model="settings.language" class="setting-select">
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
              <option value="zh-TW">繁體中文</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">时区</div>
              <div class="setting-desc">系统默认使用的时区</div>
            </div>
            <select v-model="settings.timezone" class="setting-select">
              <option value="Asia/Shanghai">北京 (UTC+8)</option>
              <option value="Asia/Tokyo">东京 (UTC+9)</option>
              <option value="Europe/London">伦敦 (UTC+0)</option>
              <option value="America/New_York">纽约 (UTC-5)</option>
            </select>
          </div>
        </div>

        <div v-if="activeSection === 'security'" class="settings-section">
          <h2 class="section-title">安全设置</h2>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">登录验证</div>
              <div class="setting-desc">启用双重验证以增加账户安全</div>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="settings.twoFactor" />
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">会话超时</div>
              <div class="setting-desc">用户无操作后自动登出的时间</div>
            </div>
            <select v-model="settings.sessionTimeout" class="setting-select">
              <option value="15">15 分钟</option>
              <option value="30">30 分钟</option>
              <option value="60">1 小时</option>
              <option value="120">2 小时</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">密码强度</div>
              <div class="setting-desc">要求用户设置的密码强度</div>
            </div>
            <select v-model="settings.passwordStrength" class="setting-select">
              <option value="low">低 (仅字母数字)</option>
              <option value="medium">中 (字母+数字+符号)</option>
              <option value="high">高 (长度≥12 + 符号)</option>
            </select>
          </div>
        </div>

        <div v-if="activeSection === 'integration'" class="settings-section">
          <h2 class="section-title">集成设置</h2>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">API 接入</div>
              <div class="setting-desc">允许第三方应用通过 API 访问</div>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="settings.apiEnabled" />
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="setting-row" v-if="settings.apiEnabled">
            <div class="setting-info">
              <div class="setting-title">API 密钥</div>
              <div class="setting-desc">用于 API 认证的密钥</div>
            </div>
            <div class="key-display">
              <code>{{ settings.apiKey }}</code>
              <button class="btn-sm">复制</button>
              <button class="btn-sm">重新生成</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">Webhook 通知</div>
              <div class="setting-desc">事件发生时向指定 URL 发送通知</div>
            </div>
            <input type="text" v-model="settings.webhookUrl" class="setting-input" placeholder="https://example.com/webhook" />
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" @click="saveSettings">保存设置</button>
          <button class="btn btn-ghost" @click="resetSettings">恢复默认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const activeSection = ref('general');

const sections = [
  { id: 'general', label: '常规', icon: 'ri-settings-3-line' },
  { id: 'security', label: '安全', icon: 'ri-lock-line' },
  { id: 'integration', label: '集成', icon: 'ri-link' }
];

const settings = ref({
  systemName: 'CSES Cloud 智教云',
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  twoFactor: true,
  sessionTimeout: '30',
  passwordStrength: 'medium',
  apiEnabled: true,
  apiKey: 'sk-xxxxxxxxxxxxxxxxxxxx',
  webhookUrl: ''
});

function saveSettings() {
  console.log('Saving settings...');
}

function resetSettings() {
  console.log('Resetting settings...');
}
</script>

<style scoped>
.campus-settings {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--spacer-5);
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

.settings-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--spacer-5);
}

@media (max-width: 768px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background var(--fast-duration), color var(--fast-duration);
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
  font-size: 20px;
}

.settings-content {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-5);
  min-height: 400px;
}

.section-title {
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-4);
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-3) 0;
  border-bottom: 1px solid var(--divider-stroke);
  gap: var(--spacer-4);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
}

.setting-title {
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.setting-input,
.setting-select {
  min-width: 200px;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
}

.setting-input:focus,
.setting-select:focus {
  border-color: var(--accent-base);
}

.setting-select {
  cursor: pointer;
}

.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--subtle-secondary);
  border-radius: 26px;
  transition: background var(--fast-duration);
}

.switch-slider::before {
  content: '';
  position: absolute;
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: var(--radius-full);
  transition: transform var(--fast-duration);
}

.switch input:checked + .switch-slider {
  background: var(--accent-base);
}

.switch input:checked + .switch-slider::before {
  transform: translateX(22px);
}

.key-display {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.key-display code {
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--text-primary);
}

.btn-sm {
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.btn-sm:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.form-actions {
  display: flex;
  gap: var(--spacer-2);
  margin-top: var(--spacer-5);
  padding-top: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.btn {
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background var(--fast-duration);
}

.btn-primary {
  background: var(--accent-base);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-ghost {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--subtle-pressed);
}
</style>
