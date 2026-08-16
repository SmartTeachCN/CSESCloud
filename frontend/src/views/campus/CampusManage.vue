<template>
  <div class="campus-manage">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">校园管理</h1>
        <p class="page-description">管理校园信息和配置</p>
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
          <h2 class="section-title">基本信息</h2>
          <div class="form-grid">
            <div class="form-item">
              <label>校园名称</label>
              <input type="text" value="CSES 实验学校" />
            </div>
            <div class="form-item">
              <label>校园代码</label>
              <input type="text" value="CSES-001" readonly />
            </div>
            <div class="form-item">
              <label>地址</label>
              <input type="text" value="北京市海淀区中关村大街 1 号" />
            </div>
            <div class="form-item">
              <label>联系电话</label>
              <input type="tel" value="010-12345678" />
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary">保存更改</button>
            <button class="btn btn-ghost">取消</button>
          </div>
        </div>

        <div v-if="activeSection === 'appearance'" class="settings-section">
          <h2 class="section-title">外观设置</h2>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">主题模式</div>
              <div class="setting-desc">选择浅色或深色主题</div>
            </div>
            <div class="setting-control">
              <button class="chip" :class="{ active: theme === 'light' }" @click="theme = 'light'"><Icon icon="ri-sun-line" :size="16" /> 浅色</button>
              <button class="chip" :class="{ active: theme === 'dark' }" @click="theme = 'dark'"><Icon icon="ri-moon-line" :size="16" /> 深色</button>
              <button class="chip" :class="{ active: theme === 'auto' }" @click="theme = 'auto'"><Icon icon="ri-computer-line" :size="16" /> 跟随系统</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">强调色</div>
              <div class="setting-desc">选择界面的主色调</div>
            </div>
            <div class="setting-control colors">
              <div
                v-for="color in accentColors"
                :key="color.name"
                class="color-swatch"
                :class="{ active: accentColor === color.name }"
                :style="{ background: color.value }"
                @click="accentColor = color.name"
              >
                <svg v-if="accentColor === color.name" width="14" height="14" viewBox="0 0 16 16" fill="white">
                  <path d="M6.5 11.591L3.394 8.485L2.78033 9.09878L6.5 12.818L13.56 5.75776L12.946 5.14355L6.5 11.591Z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeSection === 'notifications'" class="settings-section">
          <h2 class="section-title">通知设置</h2>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">邮件通知</div>
              <div class="setting-desc">接收重要事件的邮件通知</div>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="emailNotify" />
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">站内通知</div>
              <div class="setting-desc">在控制台内显示通知</div>
            </div>
            <label class="switch">
              <input type="checkbox" v-model="inAppNotify" />
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const activeSection = ref('general');
const theme = ref('auto');
const accentColor = ref('blue');
const emailNotify = ref(true);
const inAppNotify = ref(true);

const sections = [
  { id: 'general', label: '基本信息', icon: 'ri-list-check-line' },
  { id: 'appearance', label: '外观设置', icon: 'ri-palette-line' },
  { id: 'notifications', label: '通知设置', icon: 'ri-notification-3-line' }
];

const accentColors = [
  { name: 'blue', value: '#0067C0' },
  { name: 'teal', value: '#00897B' },
  { name: 'cyan', value: '#0277BD' },
  { name: 'orange', value: '#E65100' },
  { name: 'red', value: '#C62828' },
  { name: 'green', value: '#2E7D32' }
];
</script>

<style scoped>
.campus-manage {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.settings-layout {
  display: grid;
  grid-template-columns: 200px 1fr;
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacer-4);
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.form-item label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.form-item input {
  height: 36px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
}

.form-item input:focus {
  border-color: var(--accent-base);
}

.form-item input[readonly] {
  opacity: 0.7;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  gap: var(--spacer-2);
  margin-top: var(--spacer-5);
  padding-top: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-4) 0;
  border-bottom: 1px solid var(--divider-stroke);
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

.setting-control {
  display: flex;
  gap: var(--spacer-2);
  align-items: center;
}

.setting-control.colors {
  gap: var(--spacer-2);
}

.chip {
  padding: var(--spacer-1) var(--spacer-3);
  font-size: var(--font-size-sm);
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.chip.active {
  background: var(--accent-base);
  color: white;
}

.color-swatch {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--fast-duration), box-shadow var(--fast-duration);
  border: 2px solid transparent;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  border-color: var(--text-primary);
  box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--text-primary);
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
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
  border-radius: 24px;
  transition: background var(--fast-duration);
}

.switch-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
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
  transform: translateX(20px);
}
</style>
