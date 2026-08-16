<template>
  <div class="home-page">
    <div class="home-header">
      <div class="hero-section">
        <div class="hero-content">
          <div class="hero-badge">
            <Icon icon="ri-cloud-line" :size="28" />
            <span>CSES Cloud 智教云控制台</span>
          </div>
          <h1 class="hero-title">欢迎回来</h1>
          <p class="hero-subtitle">
            管理您的校园、实例和教学资源，一切尽在掌握之中
          </p>
          <div class="hero-actions">
            <button class="btn btn-primary" @click="navigate('/console/campus')">
              <Icon icon="ri-school-line" :size="18" />
              <span>进入校园集控</span>
            </button>
            <button class="btn btn-secondary" @click="navigate('/console/instances')">
              <Icon icon="ri-database-2-line" :size="18" />
              <span>进入实例云控</span>
            </button>
          </div>
        </div>
        <div class="hero-stats">
          <div class="stat-card">
            <div class="stat-value">24</div>
            <div class="stat-label">活跃班级</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">386</div>
            <div class="stat-label">在线学生</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">156</div>
            <div class="stat-label">运行实例</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">1,247</div>
            <div class="stat-label">今日操作</div>
          </div>
        </div>
      </div>
    </div>

    <div class="home-content">
      <section class="quick-section">
        <div class="section-header">
          <h2 class="section-title">快速导航</h2>
          <span class="section-desc">常用功能快捷入口</span>
        </div>
        <div class="nav-grid">
          <button
            v-for="item in navItems"
            :key="item.path"
            class="nav-card"
            @click="navigate(item.path)"
          >
            <div class="nav-icon" :style="{ background: item.bgColor, color: item.color }">
              <Icon :icon="item.icon" :size="28" />
            </div>
            <div class="nav-info">
              <div class="nav-title">{{ item.title }}</div>
              <div class="nav-desc">{{ item.desc }}</div>
            </div>
            <Icon icon="ri-arrow-right-s-line" class="nav-arrow" :size="20" />
          </button>
        </div>
      </section>

      <div class="content-row">
        <section class="recent-section">
          <div class="section-header">
            <h2 class="section-title">最近活动</h2>
            <button class="btn btn-ghost-sm">
              <Icon icon="ri-refresh-line" :size="14" />
              <span>刷新</span>
            </button>
          </div>
          <div class="activity-list">
            <div v-for="(activity, i) in activities" :key="i" class="activity-item">
              <div class="activity-icon" :class="activity.type">
                <Icon :icon="activity.icon" :size="16" />
              </div>
              <div class="activity-content">
                <div class="activity-text">{{ activity.text }}</div>
                <div class="activity-time">{{ activity.time }}</div>
              </div>
            </div>
          </div>
        </section>

        <section class="quick-tools">
          <div class="section-header">
            <h2 class="section-title">快捷工具</h2>
          </div>
          <div class="tools-grid">
            <button
              v-for="tool in tools"
              :key="tool.title"
              class="tool-card"
              @click="navigate(tool.path)"
            >
              <Icon :icon="tool.icon" :size="24" />
              <span>{{ tool.title }}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

const navItems = [
  { path: '/console/campus', icon: 'ri-school-line', title: '校园集控', desc: '连接与管理校园', bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' },
  { path: '/console/instances', icon: 'ri-cloud-line', title: '实例云控', desc: '在云端管理实例', bgColor: 'rgba(16, 124, 16, 0.1)', color: '#107C10' },
  { path: '/console/classes', icon: 'ri-group-line', title: '班级主页', desc: '在线网页托管', bgColor: 'rgba(202, 143, 4, 0.1)', color: '#CA8F04' },
  { path: '/console/editor/light', icon: 'ri-edit-2-line', title: '轻编辑器', desc: '快速编辑配置文件', bgColor: 'rgba(196, 43, 28, 0.1)', color: '#C42B1C' },
  { path: '/console/editor/standard', icon: 'ri-code-s-slash-line', title: '标准编辑器', desc: '完整实例开发环境', bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' },
  { path: '/console/developer', icon: 'ri-key-2-line', title: '开发者中心', desc: '平台接入与管理', bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' }
];

const tools = [
  { icon: 'ri-database-line', title: '服务管理', path: '/console/services' },
  { icon: 'ri-user-line', title: '个人中心', path: '/console/profile' },
  { icon: 'ri-notification-3-line', title: '通知中心', path: '/console/notifications' },
  { icon: 'ri-file-list-3-line', title: '操作日志', path: '/console/audit-log' },
  { icon: 'ri-download-line', title: '数据导出', path: '/console/data-export' },
  { icon: 'ri-question-line', title: '帮助中心', path: '/console/help' }
];

const activities = [
  { icon: 'ri-checkbox-circle-line', text: '计算机 2024-1 班启动了新的教学实例', time: '5 分钟前', type: 'success' },
  { icon: 'ri-user-add-line', text: '3 名学生加入了软件工程 2024-2 班', time: '15 分钟前', type: 'info' },
  { icon: 'ri-settings-3-line', text: 'AI 配置助理生成了 5 个新配置', time: '1 小时前', type: 'warning' },
  { icon: 'ri-upload-line', text: '王教授更新了课程资料', time: '2 小时前', type: 'info' },
  { icon: 'ri-download-cloud-line', text: '数据导出任务完成', time: '3 小时前', type: 'success' }
];

function navigate(path: string) {
  router.push(path);
}
</script>

<style scoped>
.home-page {
  padding: 0;
  background: var(--app-bg);
  min-height: 100%;
}

.home-header {
  padding: var(--spacer-6) var(--spacer-5);
  background: linear-gradient(180deg, rgba(0, 103, 192, 0.06) 0%, transparent 100%);
}

.hero-section {
  max-width: 1400px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-6);
  align-items: center;
}

@media (max-width: 1024px) {
  .hero-section {
    grid-template-columns: 1fr;
  }
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--accent-base);
  font-weight: 500;
  margin-bottom: var(--spacer-4);
}

.hero-title {
  font-size: var(--font-size-5xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-3);
  line-height: 1.1;
}

.hero-subtitle {
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
  margin: 0 0 var(--spacer-5);
  max-width: 480px;
}

.hero-actions {
  display: flex;
  gap: var(--spacer-3);
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration), transform var(--fast-duration);
  text-decoration: none;
  border: none;
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--subtle-secondary);
}

.btn-ghost-sm {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.btn-ghost-sm:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacer-3);
}

.stat-card {
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  text-align: center;
}

.stat-value {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  color: var(--accent-base);
  line-height: 1.2;
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.home-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--spacer-5);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-6);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacer-3);
}

.section-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.section-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--spacer-3);
}

.nav-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: box-shadow var(--fast-duration), transform var(--fast-duration), background var(--fast-duration);
  text-align: left;
}

.nav-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
  background: var(--subtle-secondary);
}

.nav-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--accent-base);
}

.nav-icon > svg {
  width: 24px;
  height: 24px;
}

.nav-info {
  flex: 1;
  min-width: 0;
}

.nav-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.nav-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.nav-arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.content-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--spacer-4);
}

@media (max-width: 1024px) {
  .content-row {
    grid-template-columns: 1fr;
  }
}

.recent-section,
.quick-tools {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-3);
}

.activity-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.activity-icon.success {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.activity-icon.info {
  background: rgba(0, 103, 192, 0.1);
  color: var(--accent-base);
}

.activity-icon.warning {
  background: rgba(202, 143, 4, 0.1);
  color: var(--status-warning);
}

.activity-content {
  flex: 1;
}

.activity-text {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.activity-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacer-2);
}

.tool-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-2);
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 500;
  transition: background var(--fast-duration), transform var(--fast-duration);
}

.tool-card:hover {
  background: var(--subtle-pressed);
  transform: translateY(-2px);
  color: var(--text-primary);
}

.tool-card > svg {
  width: 18px;
  height: 18px;
}

@media (max-width: 640px) {
  .tools-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .hero-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
