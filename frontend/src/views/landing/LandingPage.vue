<template>
  <div class="landing-page">
    <header class="landing-header">
      <div class="header-content">
        <div class="header-brand">
          <BrandLogo :size="28" marginRight="10px" marginBottom="-4px" />
          <span class="brand-name">CSES Cloud</span>
          <span class="brand-sub">智教云</span>
        </div>
        <nav class="header-nav">
          <a href="#features">功能特性</a>
          <a href="#solutions">解决方案</a>
          <a href="#docs">文档中心</a>
        </nav>
        <div class="header-actions">
          <button class="btn-text" @click="goLogin">登录</button>
          <button class="btn btn-primary" @click="goConsole">进入控制台</button>
        </div>
      </div>
    </header>

    <section class="hero">
      <div class="hero-content">
        <div class="hero-badge">
          <Icon icon="ri-sparkling-2-line" :size="16" />
          <span>全新一代智慧教育云平台</span>
        </div>
        <h1 class="hero-title">
          连接校园与云端<br />
          让教学管理更智能
        </h1>
        <p class="hero-desc">
          CSES Cloud 智教云控制台，提供校园集控、实例云控、在线编辑等一体化解决方案，
          助力教育机构实现数字化转型。
        </p>
        <div class="hero-actions">
          <button class="btn-primary-lg" @click="goConsole">
            <Icon icon="ri-rocket-line" :size="18" />
            开始使用
          </button>
          <button class="btn-secondary-lg" @click="scrollTo('features')">
            <Icon icon="ri-information-line" :size="18" />
            了解更多
          </button>
        </div>
      </div>
      <div class="hero-visual">
        <div class="visual-card">
          <div class="visual-header">
            <BrandLogo :size="20" marginRight="8px" />
            <span>控制台预览</span>
          </div>
          <div class="visual-mock">
            <div class="mock-sidebar">
              <div class="mock-item active"></div>
              <div class="mock-item"></div>
              <div class="mock-item"></div>
              <div class="mock-item"></div>
            </div>
            <div class="mock-main">
              <div class="mock-bar"></div>
              <div class="mock-grid">
                <div class="mock-card"></div>
                <div class="mock-card"></div>
                <div class="mock-card"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="features" class="features-section">
      <div class="section-header">
        <h2 class="section-title">核心功能</h2>
        <p class="section-desc">为教育场景量身打造的云端管理工具</p>
      </div>
      <div class="features-grid">
        <div class="feature-card" v-for="feature in features" :key="feature.title">
          <div class="feature-icon">
            <Icon :icon="feature.icon" :size="28" />
          </div>
          <h3 class="feature-title">{{ feature.title }}</h3>
          <p class="feature-desc">{{ feature.desc }}</p>
          <ul class="feature-list">
            <li v-for="item in feature.items" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </section>

    <section id="solutions" class="solutions-section">
      <div class="section-header">
        <h2 class="section-title">解决方案</h2>
        <p class="section-desc">覆盖教学管理的全链路场景</p>
      </div>
      <div class="solutions-grid">
        <div class="solution-item" v-for="solution in solutions" :key="solution.title">
          <Icon :icon="solution.icon" :size="24" />
          <div class="solution-info">
            <div class="solution-title">{{ solution.title }}</div>
            <div class="solution-desc">{{ solution.desc }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="cta-section">
      <div class="cta-content">
        <h2 class="cta-title">准备好开始了吗？</h2>
        <p class="cta-desc">立即进入控制台，体验智慧教育云平台的强大功能</p>
        <button class="btn-primary-lg" @click="goConsole">
          <Icon icon="ri-arrow-right-line" :size="18" />
          进入控制台
        </button>
      </div>
    </section>

    <footer class="landing-footer">
      <div class="footer-content">
        <div class="footer-brand">
          <BrandLogo :size="20" marginRight="8px" />
          <span>CSES Cloud 智教云</span>
        </div>
        <div class="footer-links">
          <a href="#features">功能特性</a>
          <a href="#docs">文档中心</a>
          <a href="#solutions">解决方案</a>
        </div>
        <div class="footer-copy">CSES Cloud v1.0</div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import BrandLogo from '../../components/BrandLogo.vue';

const router = useRouter();

const features = [
  {
    icon: 'ri-school-line',
    title: '校园集控',
    desc: '统一管理校园内的所有教学资源和班级',
    items: ['班级管理与监控', '校园配置管理', '学生状态追踪', '通知与公告']
  },
  {
    icon: 'ri-cloud-line',
    title: '实例云控',
    desc: '在云端管理单个教学实例的完整生命周期',
    items: ['实例创建与部署', '服务管理', '资源监控', '日志审计']
  },
  {
    icon: 'ri-code-s-slash-line',
    title: '在线编辑器',
    desc: '标准编辑器与轻编辑器满足不同开发需求',
    items: ['多标签页编辑', '实时预览', '文件管理', '自动保存']
  },
  {
    icon: 'ri-key-2-line',
    title: '开发者中心',
    desc: '为开发者提供完整的应用开发与发布平台',
    items: ['实例侧应用管理', '集控侧套餐管理', '可视化编辑器', 'API 接入']
  }
];

const solutions = [
  { icon: 'ri-folder-3-line', title: '数据空间', desc: '统一管理云文件与网页空间' },
  { icon: 'ri-tools-line', title: '教学工具', desc: '丰富的工具集助力教学活动' },
  { icon: 'ri-shield-check-line', title: '安全审计', desc: '完整的操作日志与数据导出' },
  { icon: 'ri-notification-3-line', title: '通知中心', desc: '实时推送系统通知与告警' }
];

function goLogin() {
  router.push('/login');
}

function goConsole() {
  const token = localStorage.getItem('auth_token');
  if (token) {
    router.push('/console');
  } else {
    router.push('/login');
  }
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}
</script>

<style scoped>
.landing-page {
  height: 100%;
  min-height: 100%;
  background: var(--app-bg);
  overflow-y: auto;
  overflow-x: hidden;
}

.landing-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--layer-default);
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  border-bottom: 1px solid var(--divider-stroke);
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 var(--spacer-5);
}

.header-brand {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  color: var(--text-primary);
}

.brand-name {
  font-size: var(--font-size-lg);
  font-weight: 700;
}

.brand-sub {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-left: var(--spacer-1);
}

.header-nav {
  display: flex;
  gap: var(--spacer-6);
}

.header-nav a {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  text-decoration: none;
  transition: color var(--fast-duration);
}

.header-nav a:hover {
  color: var(--accent-base);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
}

.hero {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-8);
  align-items: center;
  padding: var(--spacer-12) var(--spacer-5);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    text-align: center;
  }
  .header-nav {
    display: none;
  }
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-3);
  background: rgba(0, 103, 192, 0.08);
  border: 1px solid rgba(0, 103, 192, 0.15);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--accent-base);
  font-weight: 500;
  margin-bottom: var(--spacer-4);
}

.hero-title {
  font-size: 48px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-4);
  letter-spacing: -1px;
}

.hero-desc {
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 var(--spacer-5);
  max-width: 480px;
}

@media (max-width: 900px) {
  .hero-desc {
    margin: 0 auto var(--spacer-5);
  }
}

.hero-actions {
  display: flex;
  gap: var(--spacer-3);
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .hero-actions {
    justify-content: center;
  }
}

.hero-visual {
  display: flex;
  justify-content: center;
}

.visual-card {
  width: 100%;
  max-width: 480px;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
}

.visual-header {
  display: flex;
  align-items: center;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.visual-mock {
  display: flex;
  height: 300px;
}

.mock-sidebar {
  width: 48px;
  background: var(--subtle-secondary);
  padding: var(--spacer-2);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.mock-item {
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--subtle-pressed);
}

.mock-item.active {
  background: var(--accent-base);
  opacity: 0.6;
}

.mock-main {
  flex: 1;
  padding: var(--spacer-3);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.mock-bar {
  height: 32px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.mock-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-2);
  flex: 1;
}

.mock-card {
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.features-section,
.solutions-section {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacer-10) var(--spacer-5);
}

.section-header {
  text-align: center;
  margin-bottom: var(--spacer-8);
}

.section-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.section-desc {
  font-size: var(--font-size-lg);
  color: var(--text-tertiary);
  margin: 0;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--spacer-4);
}

.feature-card {
  padding: var(--spacer-5);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  transition: box-shadow var(--fast-duration), transform var(--fast-duration);
}

.feature-card:hover {
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
  transform: translateY(-4px);
}

.feature-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: rgba(0, 103, 192, 0.08);
  color: var(--accent-base);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--spacer-4);
}

.feature-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.feature-desc {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 var(--spacer-3);
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.feature-list li {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  padding-left: var(--spacer-4);
  position: relative;
}

.feature-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent-base);
}

.solutions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacer-3);
}

.solution-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  color: var(--accent-base);
}

.solution-info {
  flex: 1;
}

.solution-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.solution-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.cta-section {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacer-12) var(--spacer-5);
  text-align: center;
}

.cta-content {
  padding: var(--spacer-10) var(--spacer-5);
  background: linear-gradient(135deg, rgba(0, 103, 192, 0.08), rgba(76, 194, 255, 0.05));
  border: 1px solid rgba(0, 103, 192, 0.12);
  border-radius: var(--radius-xl);
}

.cta-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.cta-desc {
  font-size: var(--font-size-lg);
  color: var(--text-secondary);
  margin: 0 0 var(--spacer-5);
}

.landing-footer {
  border-top: 1px solid var(--divider-stroke);
  background: var(--layer-default);
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-5);
  flex-wrap: wrap;
  gap: var(--spacer-3);
}

.footer-brand {
  display: flex;
  align-items: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.footer-links {
  display: flex;
  gap: var(--spacer-4);
}

.footer-links a {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  text-decoration: none;
  transition: color var(--fast-duration);
}

.footer-links a:hover {
  color: var(--accent-base);
}

.footer-copy {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
</style>
