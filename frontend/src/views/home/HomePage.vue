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
            <div class="stat-value">{{ stats.classes }}</div>
            <div class="stat-label">活跃班级</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ stats.students }}</div>
            <div class="stat-label">在校学生</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ stats.instances_running }}</div>
            <div class="stat-label">运行实例</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ formatNumber(stats.today_operations) }}</div>
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
          <button class="btn btn-ghost-sm" @click="openNavEditor">
            <Icon icon="ri-edit-line" :size="14" />
            <span>编辑</span>
          </button>
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
            <button class="btn btn-ghost-sm" @click="loadData">
              <Icon icon="ri-refresh-line" :size="14" />
              <span>刷新</span>
            </button>
          </div>
          <div class="activity-list">
            <div v-for="(activity, i) in activities" :key="i" class="activity-item">
              <div class="activity-icon" :class="activity._type">
                <Icon :icon="activity._icon" :size="16" />
              </div>
              <div class="activity-content">
                <div class="activity-text">{{ activity._text }}</div>
                <div class="activity-time">{{ activity._time }}</div>
              </div>
            </div>
            <div v-if="activities.length === 0" class="activity-empty">
              暂无最近活动记录
            </div>
          </div>
        </section>

        <section class="quick-tools">
          <div class="section-header">
            <h2 class="section-title">快捷工具</h2>
            <button class="btn btn-ghost-sm" @click="openToolsEditor">
              <Icon icon="ri-edit-line" :size="14" />
              <span>编辑</span>
            </button>
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

    <!-- 编辑导航弹窗 -->
    <Teleport to="body">
      <div v-if="showNavEditor" class="modal-overlay" @click.self="showNavEditor = false">
        <div class="modal-card">
          <div class="modal-header">
            <h3>编辑快速导航</h3>
            <button class="modal-close" @click="showNavEditor = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <div v-for="(item, idx) in editingNavItems" :key="idx" class="edit-item">
              <div class="edit-row">
                <input v-model="item.title" placeholder="名称" class="input-sm" />
                <input v-model="item.path" placeholder="路径" class="input-sm" />
                <input v-model="item.icon" placeholder="图标" class="input-sm" style="width:140px" />
                <button class="btn btn-danger-sm" @click="removeNavItem(idx)">
                  <Icon icon="ri-delete-bin-line" :size="14" />
                </button>
              </div>
              <div class="edit-row">
                <input v-model="item.desc" placeholder="描述" class="input-sm" style="flex:1" />
                <input v-model="item.bgColor" placeholder="背景色" class="input-sm" style="width:120px" />
                <input v-model="item.color" placeholder="图标色" class="input-sm" style="width:120px" />
              </div>
            </div>
            <button class="btn btn-ghost-sm" @click="addNavItem">
              <Icon icon="ri-add-line" :size="14" />
              <span>添加导航项</span>
            </button>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="resetNavItems">恢复默认</button>
            <button class="btn btn-primary" @click="saveNavItems">保存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 编辑工具弹窗 -->
    <Teleport to="body">
      <div v-if="showToolsEditor" class="modal-overlay" @click.self="showToolsEditor = false">
        <div class="modal-card">
          <div class="modal-header">
            <h3>编辑快捷工具</h3>
            <button class="modal-close" @click="showToolsEditor = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <div v-for="(tool, idx) in editingTools" :key="idx" class="edit-item">
              <div class="edit-row">
                <input v-model="tool.title" placeholder="名称" class="input-sm" />
                <input v-model="tool.path" placeholder="路径" class="input-sm" />
                <input v-model="tool.icon" placeholder="图标" class="input-sm" style="width:140px" />
                <button class="btn btn-danger-sm" @click="removeToolItem(idx)">
                  <Icon icon="ri-delete-bin-line" :size="14" />
                </button>
              </div>
            </div>
            <button class="btn btn-ghost-sm" @click="addToolItem">
              <Icon icon="ri-add-line" :size="14" />
              <span>添加工具项</span>
            </button>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="resetToolItems">恢复默认</button>
            <button class="btn btn-primary" @click="saveToolItems">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api/client';

const router = useRouter();

// 默认导航项
const defaultNavItems = [
  { path: '/console/campus', icon: 'ri-school-line', title: '校园集控', desc: '连接与管理校园', bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' },
  { path: '/console/instances', icon: 'ri-cloud-line', title: '实例云控', desc: '在云端管理实例', bgColor: 'rgba(16, 124, 16, 0.1)', color: '#107C10' },
  { path: '/console/dataspace', icon: 'ri-folder-3-line', title: '数据空间', desc: '云文件与网页空间管理', bgColor: 'rgba(202, 143, 4, 0.1)', color: '#CA8F04' },
  { path: '/console/editor/light', icon: 'ri-edit-2-line', title: '轻编辑器', desc: '快速编辑配置文件', bgColor: 'rgba(196, 43, 28, 0.1)', color: '#C42B1C' },
  { path: '/console/editor/standard', icon: 'ri-code-s-slash-line', title: '标准编辑器', desc: '完整实例开发环境', bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' },
  { path: '/console/developer', icon: 'ri-key-2-line', title: '开发者中心', desc: '平台接入与管理', bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' }
];

// 默认工具项
const defaultToolItems = [
  { icon: 'ri-database-line', title: '服务管理', path: '/console/services' },
  { icon: 'ri-user-line', title: '个人中心', path: '/console/profile' },
  { icon: 'ri-notification-3-line', title: '通知中心', path: '/console/notifications' },
  { icon: 'ri-file-list-3-line', title: '操作日志', path: '/console/audit-log' },
  { icon: 'ri-download-line', title: '数据导出', path: '/console/data-export' },
  { icon: 'ri-question-line', title: '帮助中心', path: '/console/help' }
];

// 统计数据
const stats = reactive({
  classes: 0,
  students: 0,
  instances_running: 0,
  today_operations: 0
});

// 活动列表
const activities = ref<any[]>([]);

// 导航项
const navItems = ref([...defaultNavItems]);
const showNavEditor = ref(false);
const editingNavItems = ref<any[]>([]);

// 工具项
const tools = ref([...defaultToolItems]);
const showToolsEditor = ref(false);
const editingTools = ref<any[]>([]);

// 格式化数字
function formatNumber(n: number) {
  if (n >= 1000) {
    return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
  }
  return String(n);
}

// 计算相对时间
function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const date = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return dateStr.slice(0, 10);
}

// 活动类型映射
const activityTypeMap: Record<string, { icon: string; type: string }> = {
  login: { icon: 'ri-login-box-line', type: 'info' },
  logout: { icon: 'ri-logout-box-line', type: 'info' },
  create: { icon: 'ri-add-circle-line', type: 'success' },
  update: { icon: 'ri-edit-line', type: 'warning' },
  delete: { icon: 'ri-delete-bin-line', type: 'error' },
  save: { icon: 'ri-save-line', type: 'success' },
  upload: { icon: 'ri-upload-line', type: 'info' },
  download: { icon: 'ri-download-line', type: 'info' },
  start: { icon: 'ri-play-circle-line', type: 'success' },
  stop: { icon: 'ri-stop-circle-line', type: 'error' },
  error: { icon: 'ri-error-warning-line', type: 'error' },
  failed: { icon: 'ri-close-circle-line', type: 'error' },
  success: { icon: 'ri-checkbox-circle-line', type: 'success' },
};

function enrichActivity(raw: any) {
  const action = (raw.action || '').toLowerCase();
  let match: { icon: string; type: string } | undefined;
  for (const [key, val] of Object.entries(activityTypeMap)) {
    if (action.includes(key)) {
      match = val;
      break;
    }
  }
  if (!match) {
    match = { icon: 'ri-information-line', type: 'info' };
  }
  return {
    ...raw,
    _icon: match.icon,
    _type: match.type,
    _text: `${raw.username || '系统'} - ${raw.action || ''}${raw.target ? ' - ' + raw.target : ''}`,
    _time: timeAgo(raw.created_at),
  };
}

// 加载数据
async function loadData() {
  try {
    const data = await api.get<any>('/dashboard');
    if (data && data.stats) {
      Object.assign(stats, data.stats);
      activities.value = (data.activities || []).map(enrichActivity);
    }
  } catch (e) {
    console.error('加载仪表盘数据失败', e);
  }
}

// 加载用户设置
async function loadUserSettings() {
  try {
    const navData = await api.get<any>('/user-settings?action=get&key=nav');
    if (navData && navData.config) {
      navItems.value = navData.config;
    }
  } catch (_) {}
  try {
    const toolsData = await api.get<any>('/user-settings?action=get&key=tools');
    if (toolsData && toolsData.config) {
      tools.value = toolsData.config;
    }
  } catch (_) {}
}

// 导航编辑
function openNavEditor() {
  editingNavItems.value = JSON.parse(JSON.stringify(navItems.value));
  showNavEditor.value = true;
}
function addNavItem() {
  editingNavItems.value.push({
    path: '', icon: 'ri-link', title: '', desc: '',
    bgColor: 'rgba(0, 103, 192, 0.1)', color: '#0067C0'
  });
}
function removeNavItem(idx: number) {
  editingNavItems.value.splice(idx, 1);
}
function resetNavItems() {
  editingNavItems.value = JSON.parse(JSON.stringify(defaultNavItems));
}
async function saveNavItems() {
  navItems.value = JSON.parse(JSON.stringify(editingNavItems.value));
  showNavEditor.value = false;
  try {
    await api.post('/user-settings?action=save', { key: 'nav', config: navItems.value });
  } catch (_) {}
}

// 工具编辑
function openToolsEditor() {
  editingTools.value = JSON.parse(JSON.stringify(tools.value));
  showToolsEditor.value = true;
}
function addToolItem() {
  editingTools.value.push({ icon: 'ri-link', title: '', path: '' });
}
function removeToolItem(idx: number) {
  editingTools.value.splice(idx, 1);
}
function resetToolItems() {
  editingTools.value = JSON.parse(JSON.stringify(defaultToolItems));
}
async function saveToolItems() {
  tools.value = JSON.parse(JSON.stringify(editingTools.value));
  showToolsEditor.value = false;
  try {
    await api.post('/user-settings?action=save', { key: 'tools', config: tools.value });
  } catch (_) {}
}

function navigate(path: string) {
  router.push(path);
}

onMounted(() => {
  loadData();
  loadUserSettings();
});
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
  align-items: center;
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-3);
}

.section-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.section-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  flex: 1;
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

.activity-icon.error {
  background: rgba(196, 43, 28, 0.1);
  color: var(--status-error, #C42B1C);
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

.activity-empty {
  padding: var(--spacer-4);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
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

/* 弹窗样式（Teleport 到 body，复用项目 modal 模式） */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  width: 640px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--card-stroke);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--text-primary);
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 4px;
  border-radius: var(--radius-sm);
}

.modal-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--spacer-4);
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4);
  border-top: 1px solid var(--card-stroke);
}

.edit-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.edit-row {
  display: flex;
  gap: var(--spacer-2);
  align-items: center;
}

.input-sm {
  padding: 6px 10px;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  flex: 1;
  min-width: 0;
}

.input-sm:focus {
  outline: none;
  border-color: var(--accent-base);
}

.btn-danger-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  background: rgba(196, 43, 28, 0.1);
  color: #C42B1C;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
}

.btn-danger-sm:hover {
  background: rgba(196, 43, 28, 0.2);
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