<template>
  <div class="console-layout" :class="{ 'editor-mode': isFullPageMode }">
    <header class="console-top-bar">
      <div class="top-bar-left">
        <button
          class="nav-menu-btn"
          @click="showNavMenu = !showNavMenu"
          aria-label="全局导航"
        >
          <Icon icon="ri-menu-line" :size="18" />
        </button>

        <button
          v-if="canGoBack"
          class="back-btn"
          @click="goBack"
          aria-label="返回"
        >
          <Icon icon="ri-arrow-left-s-line" :size="18" />
        </button>

        <button
          v-if="hasSidebar"
          class="sidebar-toggle-btn"
          @click="sidebarOpen = !sidebarOpen"
          :aria-label="sidebarOpen ? '收起侧栏' : '展开侧栏'"
        >
          <Icon :icon="sidebarOpen ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'" :size="16" />
        </button>

        <div class="brand" v-if="!isFullPageMode">
          <BrandLogo :size="20" marginRight="10px" marginBottom="-2px" />
          <span class="brand-logo">CSES Cloud</span>
          <span class="brand-subtitle">智教云</span>
        </div>

        <div class="brand" v-else>
          <BrandLogo :size="20" marginRight="10px" marginBottom="-2px" />
          <span class="brand-logo">CSES Cloud</span>
          <span class="brand-subtitle">{{ editorModeLabel }}</span>
        </div>
      </div>

      <div class="top-bar-center">
        <div class="search-box">
          <Icon icon="ri-search-line" class="search-icon" :size="14" />
          <input
            type="text"
            v-model="searchQuery"
            class="search-input"
            placeholder="搜索页面、功能..."
            @focus="showSearchResults = true"
          />
          <div v-if="showSearchResults && filteredSearchResults.length > 0" class="search-results">
            <div
              v-for="result in filteredSearchResults"
              :key="result.path"
              class="search-result-item"
              @click="navigateTo(result.path)"
            >
              <Icon :icon="result.icon" class="result-icon" :size="18" />
              <span class="result-title">{{ result.title }}</span>
              <span class="result-tag">{{ result.tag }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="top-bar-right">
        <button class="icon-btn" title="通知中心" @click="navigateTo('/console/notifications')">
          <Icon icon="ri-notification-3-line" :size="18" />
          <span class="badge" v-if="unreadCount > 0">{{ unreadCount }}</span>
        </button>
        <div class="user-menu-trigger" @click="showUserMenu = !showUserMenu">
          <div class="avatar">{{ userInitial }}</div>
          <span class="username">{{ userName }}</span>
          <Icon icon="ri-arrow-down-s-line" :size="12" />
          <div v-if="showUserMenu" class="user-dropdown">
            <div class="user-info">
              <div class="user-name">{{ userName }}</div>
              <div class="user-role">{{ userRole }}</div>
            </div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" @click="navigateTo('/console/profile')">
              <Icon icon="ri-user-line" :size="14" />
              <span>个人中心</span>
            </button>
            <button class="dropdown-item" @click="navigateTo('/console/notifications')">
              <Icon icon="ri-notification-3-line" :size="14" />
              <span>通知中心</span>
            </button>
            <button class="dropdown-item" @click="navigateTo('/console/help')">
              <Icon icon="ri-question-line" :size="14" />
              <span>帮助中心</span>
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item logout" @click="logout">
              <Icon icon="ri-logout-box-line" :size="14" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="console-body">
      <aside
        v-if="hasSidebar && !isFullPageMode"
        class="console-sidebar"
        :class="{ collapsed: !sidebarOpen }"
      >
        <!-- 顶部：校园切换器（仅校园模式显示） -->
        <SchoolSwitcher
          v-if="sidebarMode === 'campus' && hasJoinedSchool"
          :expanded="sidebarOpen"
        />

        <div class="sidebar-section">
          <div class="sidebar-section-title">{{ currentModeLabel }}</div>
          <router-link
            v-for="item in sidebarItems"
            :key="item.path"
            :to="item.path"
            class="sidebar-item"
            :class="{ active: isItemActive(item.path) }"
          >
            <Icon :icon="item.icon" class="sidebar-icon" :size="18" />
            <span v-if="sidebarOpen" class="sidebar-label">{{ item.title }}</span>
          </router-link>
        </div>

        <!-- 底部：AI助理 + 校园切换 -->
        <div v-if="sidebarOpen && showAiInSidebar" class="sidebar-section sidebar-section-bottom">
          <button class="sidebar-item sidebar-action" @click="openAiDrawer">
            <Icon icon="ri-brain-line" class="sidebar-icon" :size="18" />
            <span class="sidebar-label">AI 助理</span>
          </button>
        </div>
      </aside>

      <AiAssistantDrawer
        :visible="aiDrawerVisible"
        :scope="aiScope"
        :scope-ref="aiScopeRef"
        @close="aiDrawerVisible = false"
      />

      <main class="console-main" :class="{ 'full-width': !hasSidebar }">
        <!-- 校园模式但未加入学校时，覆盖整个内容区显示加入学校提示 -->
        <template v-if="sidebarMode === 'campus' && !hasJoinedSchool">
          <div class="no-school-state">
            <div class="no-school-card">
              <div class="no-school-icon">
                <Icon icon="ri-school-line" :size="48" />
              </div>
              <h2 class="no-school-title">尚未加入任何学校</h2>
              <p class="no-school-desc">
                你还未加入任何学校，加入学校后即可使用校园集控功能。<br/>
                加入学校需要学校管理员审批。
              </p>
              <button class="no-school-btn" @click="joinVisible = true">
                <Icon icon="ri-add-line" :size="16" />
                <span>加入学校</span>
              </button>
            </div>
          </div>
        </template>
        <router-view v-else v-slot="{ Component }">
          <keep-alive :include="keepAliveComponents">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>

    <JoinSchool
      :visible="joinVisible"
      @close="joinVisible = false"
      @joined="onJoinedSchool"
    />

    <Teleport to="body">
      <div
        v-if="showNavMenu"
        class="nav-menu-overlay"
        @click.self="showNavMenu = false"
      >
        <div class="nav-menu-panel">
          <div class="nav-menu-header">
            <div class="nav-menu-brand">
              <BrandLogo :size="24" marginRight="10px" marginBottom="-4px" />
              <span class="nav-menu-title">CSES Cloud</span>
            </div>
            <div class="nav-menu-subtitle">智教云控制台</div>
          </div>
          <nav class="nav-menu-list">
            <button
              v-for="item in filteredNavMenuItems"
              :key="item.path"
              class="nav-menu-item"
              @click="navigateTo(item.path)"
            >
              <Icon :icon="item.icon" class="nav-menu-icon" :size="22" />
              <span class="nav-menu-label">
                {{ item.title }}
                <span v-if="item.subtitle" class="nav-menu-subtitle-text">{{ item.subtitle }}</span>
              </span>
              <Icon v-if="item.external" icon="ri-external-link-line" class="nav-menu-external" :size="14" />
            </button>
          </nav>
          <div class="nav-menu-footer">
            <div class="nav-menu-version">CSES Cloud v1.0</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandLogo from '../components/BrandLogo.vue';
import AiAssistantDrawer from '../components/AiAssistantDrawer.vue';
import SchoolSwitcher from '../components/campus/SchoolSwitcher.vue';
import JoinSchool from '../components/campus/JoinSchool.vue';
import { useAuth } from '../composables/useAuth';
import { useSchool } from '../composables/useSchool';
import { notificationsApi } from '../api';

const route = useRoute();
const router = useRouter();

const sidebarOpen = ref(true);
const showNavMenu = ref(false);
const showUserMenu = ref(false);
const showSearchResults = ref(false);
const searchQuery = ref('');
const unreadCount = ref(0);

// AI 助理抽屉
const aiDrawerVisible = ref(false);

// 加入学校弹窗
const joinVisible = ref(false);

const { fetchMe } = useAuth();
const { hasJoinedSchool, refreshJoinedSchools } = useSchool();

// 当前用户认证信息（用于权限控制）
const authUser = ref<any>(null);
const isAlliance = computed(() => authUser.value?.is_alliance || false);
const isSuperAdmin = computed(() => authUser.value?.is_super_admin || false);
const isAdmin = computed(() => isSuperAdmin.value || authUser.value?.role === 'admin');

// KeepAlive 保留状态的组件（导航离开后不销毁）
const keepAliveComponents = ['LightEditor', 'StandardEditor', 'DataSpace'];

async function onJoinedSchool() {
  joinVisible.value = false;
  await refreshJoinedSchools();
}

const user = ref({
  name: '管理员',
  role: '管理员',
  initial: 'A'
});

const navMenuItems = [
  { path: '/console', icon: 'ri-home-5-line', title: '首页', subtitle: '控制台首页' },
  { path: '/console/campus', icon: 'ri-school-line', title: '校园集控', subtitle: '连接与管理校园' },
  { path: '/console/instances', icon: 'ri-cloud-line', title: '实例云控', subtitle: '在云端管理单个实例' },
  { path: '/console/dataspace', icon: 'ri-folder-3-line', title: '数据空间', subtitle: '云文件与网页空间管理' },
  { path: '/console/ai', icon: 'ri-brain-line', title: 'AI 助理', subtitle: '智能问答与辅助' },
  { path: '/console/editor/light', icon: 'ri-edit-2-line', title: '轻编辑器', subtitle: '快速编辑配置文件' },
  { path: '/console/help', icon: 'ri-question-line', title: '文档 & 使用教程', subtitle: '查看帮助文档' },
  { path: 'https://example.com/teaching-tools', icon: 'ri-tools-line', title: '教学工具', subtitle: '工具助力教学', external: true },
  { path: '/console/developer', icon: 'ri-key-2-line', title: '开发者中心', subtitle: '接入平台' },
  { path: '/console/admin', icon: 'ri-shield-keyhole-line', title: '管理后台', subtitle: '系统管理', adminOnly: true }
];

// 过滤后的导航项（隐藏非管理员的管理后台）
const filteredNavMenuItems = computed(() => {
  return navMenuItems.filter(item => {
    if (item.adminOnly && !isAdmin.value) return false;
    return true;
  });
});

// 当前侧栏模式：campus / instance / developer / default
// 仅 /console/instances 触发实例模式；/console/developer 触发开发者模式
// /console/campus 触发校园模式；其余为默认模式（无侧栏）
const sidebarMode = computed<'campus' | 'instance' | 'developer' | 'admin' | 'ai' | 'default'>(() => {
  const path = route.path;
  if (path.startsWith('/console/instances')) {
    return 'instance';
  }
  if (path.startsWith('/console/developer')) {
    return 'developer';
  }
  if (path.startsWith('/console/admin')) {
    return 'admin';
  }
  if (path.startsWith('/console/ai')) {
    return 'ai';
  }
  if (path.startsWith('/console/campus')) {
    return 'campus';
  }
  return 'default';
});

const sidebarItems = computed(() => {
  if (sidebarMode.value === 'instance') {
    return [
      { path: '/console/instances/overview', icon: 'ri-dashboard-line', title: '实例概览' },
      { path: '/console/instances/list', icon: 'ri-cloud-line', title: '实例列表' }
    ];
  }
  if (sidebarMode.value === 'developer') {
    // 非联盟用户仅显示共享市场，联盟用户和管理员显示全部
    if (isAlliance.value || isSuperAdmin.value) {
      return [
        { path: '/console/developer', icon: 'ri-key-2-line', title: '开发者中心' },
        { path: '/console/developer/apps', icon: 'ri-apps-2-line', title: '实例侧应用' },
        { path: '/console/developer/packages', icon: 'ri-box-3-line', title: '集控侧套餐' },
        { path: '/console/developer/plugins', icon: 'ri-plug-line', title: '编辑器插件' },
        { path: '/console/developer/market', icon: 'ri-store-2-line', title: '共享市场' }
      ];
    }
    return [
      { path: '/console/developer/market', icon: 'ri-store-2-line', title: '共享市场' }
    ];
  }
  if (sidebarMode.value === 'admin') {
    return [
      { path: '/console/admin', icon: 'ri-shield-keyhole-line', title: '系统配置' },
      { path: '/console/admin/users', icon: 'ri-team-line', title: '用户管理' },
      { path: '/console/admin/notifications', icon: 'ri-notification-3-line', title: '通知管理' },
      { path: '/console/admin/ai-config', icon: 'ri-brain-line', title: 'AI 配置' }
    ];
  }
  return [
    { path: '/console/campus', icon: 'ri-school-line', title: '校园概览' },
    { path: '/console/campus/manage', icon: 'ri-settings-3-line', title: '校园管理' },
    { path: '/console/campus/classes', icon: 'ri-group-line', title: '班级列表' },
    { path: '/console/campus/sub-users', icon: 'ri-team-line', title: '子用户管理' },
    { path: '/console/campus/settings', icon: 'ri-tools-line', title: '校园设置' }
  ];
});

// AI 助理是否在侧栏显示（仅实例云控与校园集控模式）
const showAiInSidebar = computed(() => {
  return sidebarMode.value === 'instance' || sidebarMode.value === 'campus';
});

// AI 助理的 scope 与 scopeRef（依据当前所在页面动态切换）
const aiScope = computed(() => {
  if (sidebarMode.value === 'instance') return 'instance';
  if (sidebarMode.value === 'campus') return 'campus';
  return 'global';
});

const aiScopeRef = computed(() => {
  if (sidebarMode.value === 'instance') {
    // 从路径 /console/instances/:id/edit 提取 id
    const m = route.path.match(/^\/console\/instances\/(\d+)/);
    return m ? Number(m[1]) : undefined;
  }
  if (sidebarMode.value === 'campus') {
    return undefined; // 校园级 AI 助理
  }
  return undefined;
});

function openAiDrawer() {
  aiDrawerVisible.value = true;
}

const currentModeLabel = computed(() => {
  if (sidebarMode.value === 'instance') return '实例云控';
  if (sidebarMode.value === 'developer') return '开发者中心';
  if (sidebarMode.value === 'admin') return '管理后台';
  return '校园集控';
});

const editorModeLabel = computed(() => {
  if (route.path.startsWith('/console/editor/standard')) return '标准编辑器';
  if (route.path.startsWith('/console/editor/light')) return '轻编辑器';
  if (route.path.startsWith('/console/ai')) return 'AI 助理';
  return '编辑器';
});

// 无侧栏的页面：帮助中心、通知中心、个人中心、轻编辑器等独立页面
const noSidebarPaths = [
  '/console/help',
  '/console/notifications',
  '/console/profile',
  '/console/audit-log',
  '/console/data-export'
];

const isFullPageMode = computed(() => {
  return route.path.startsWith('/console/editor/standard') || route.path.startsWith('/console/editor/light') || route.path.startsWith('/console/ai');
});

const isEditorMode = computed(() => {
  return route.path.startsWith('/console/editor/standard') || route.path.startsWith('/console/editor/light');
});

const hasSidebar = computed(() => {
  const path = route.path;
  if (isFullPageMode.value) return false;
  // 默认模式（首页、帮助中心、个人中心等）不显示侧栏
  if (sidebarMode.value === 'default') return false;
  if (noSidebarPaths.some(p => path === p || path.startsWith(p + '/'))) return false;
  // 校园模式且未加入学校：整个页面无侧栏
  if (sidebarMode.value === 'campus' && !hasJoinedSchool.value) return false;
  return true;
});

const canGoBack = computed(() => {
  return window.history.length > 1;
});

const filteredSearchResults = computed(() => {
  if (!searchQuery.value.trim()) return [];
  const query = searchQuery.value.toLowerCase();
  return filteredNavMenuItems.value
    .filter(item =>
      item.title.toLowerCase().includes(query) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(query))
    )
    .map(item => ({ ...item, tag: getTagForPath(item.path) }));
});

function getTagForPath(path: string): string {
  if (path.startsWith('/console/editor')) return '编辑器';
  if (path.startsWith('/console/campus')) return '校园';
  if (path.startsWith('/console/instances')) return '实例';
  if (path.startsWith('/console/developer')) return '开发';
  if (path.startsWith('/console/help')) return '帮助';
  if (path.startsWith('/console/notifications')) return '通知';
  return '功能';
}

const userInitial = computed(() => user.value.initial);
const userName = computed(() => user.value.name);
const userRole = computed(() => user.value.role);

function isItemActive(itemPath: string) {
  const currentPath = route.path;
  // 精确匹配根路径
  if (itemPath === '/console') {
    return currentPath === '/console' || currentPath === '/console/';
  }
  // 精确匹配父级项目（仅当路径完全相同时激活）
  if (itemPath === '/console/campus') {
    return currentPath === '/console/campus';
  }
  if (itemPath === '/console/instances/overview') {
    return currentPath === '/console/instances/overview' || currentPath === '/console/instances' || currentPath === '/console/instances/';
  }
  if (itemPath === '/console/instances/list') {
    return currentPath === '/console/instances/list';
  }
  if (itemPath === '/console/developer') {
    return currentPath === '/console/developer';
  }
  if (itemPath === '/console/developer/market') {
    return currentPath === '/console/developer/market';
  }
  if (itemPath === '/console/admin') {
    return currentPath === '/console/admin';
  }
  // 其他项目：精确匹配或前缀匹配
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/');
}

function navigateTo(path: string) {
  showNavMenu.value = false;
  showSearchResults.value = false;
  showUserMenu.value = false;
  searchQuery.value = '';
  if (path.startsWith('http')) {
    window.open(path, '_blank');
  } else {
    router.push(path);
  }
}

function goBack() {
  router.back();
}

function logout() {
  localStorage.removeItem('auth_token');
  window.location.href = '/login';
}

watch(searchQuery, () => {
  showSearchResults.value = searchQuery.value.trim().length > 0;
});

watch(() => route.path, () => {
  showNavMenu.value = false;
  showSearchResults.value = false;
  showUserMenu.value = false;
});

onMounted(async () => {
  const me = await fetchMe();
  if (me) {
    authUser.value = me;
    const displayName = me.display_name || me.username || '管理员';
    user.value.name = displayName;
    user.value.role = roleLabelFor(me.role, me.is_alliance);
    user.value.initial = displayName.charAt(0).toUpperCase();
  }
  // 拉取未读通知数
  fetchUnreadCount();
  // 每60秒刷新一次未读通知数
  unreadTimer = window.setInterval(fetchUnreadCount, 60000);
  // 监听页面派发的 AI 抽屉打开事件
  window.addEventListener('open-ai-drawer', onOpenAiDrawerEvent as EventListener);
});

let unreadTimer: number | undefined;

async function fetchUnreadCount() {
  try {
    const stats = await notificationsApi.stats();
    unreadCount.value = stats.unread || 0;
  } catch {
    // 静默失败
  }
}

function onOpenAiDrawerEvent(e: Event) {
  const detail = (e as CustomEvent).detail || {};
  aiDrawerVisible.value = true;
  // scope 由当前路由自动推导，detail.scope 可作为提示忽略
}

onUnmounted(() => {
  window.removeEventListener('open-ai-drawer', onOpenAiDrawerEvent as EventListener);
  if (unreadTimer) clearInterval(unreadTimer);
});

function roleLabelFor(role: string, isAlliance: boolean): string {
  if (isAlliance) return '智教联盟';
  if (role === 'admin') return '学校管理员';
  if (role === 'teacher') return '教师';
  if (role === 'student') return '学生';
  return role || '用户';
}
</script>

<style scoped>
.console-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--app-bg);
}

.console-top-bar {
  display: flex;
  align-items: center;
  height: 48px;
  background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-4);
  gap: var(--spacer-4);
  flex-shrink: 0;
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  z-index: 100;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.nav-menu-btn,
.sidebar-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--fast-duration) var(--fast-out-slow-in), color var(--fast-duration) var(--fast-out-slow-in);
}

.nav-menu-btn:hover,
.sidebar-toggle-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.nav-menu-btn:active,
.sidebar-toggle-btn:active {
  background: var(--subtle-pressed);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  margin-left: var(--spacer-2);
  color: var(--text-primary);
}

.brand-logo {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.brand-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.top-bar-center {
  flex: 1;
  display: flex;
  justify-content: center;
  max-width: 500px;
  margin: 0 auto;
}

.search-box {
  position: relative;
  width: 100%;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.user-menu-trigger {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  position: relative;
  transition: background var(--fast-duration);
}

.user-menu-trigger:hover {
  background: var(--subtle-secondary);
}

.avatar {
  width: 28px;
  height: 28px;
  background: var(--accent-base);
  color: var(--accent-text);
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.username {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-weight: 500;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: var(--spacer-2);
  z-index: 300;
}

.user-info {
  padding: var(--spacer-2) var(--spacer-3);
}

.user-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.user-role {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.dropdown-divider {
  height: 1px;
  background: var(--divider-stroke);
  margin: var(--spacer-2) 0;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 100%;
  text-align: left;
  padding: var(--spacer-2) var(--spacer-3);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-decoration: none;
  transition: background var(--fast-duration);
}

.dropdown-item:hover {
  background: var(--subtle-secondary);
}

.dropdown-item.logout {
  color: var(--status-error);
}

.console-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.console-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--layer-default);
  border-right: 1px solid var(--divider-stroke);
  padding: var(--spacer-3) var(--spacer-2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  transition: width var(--normal-duration) var(--fast-out-slow-in);
}

.console-sidebar.collapsed {
  width: 52px;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.sidebar-section-bottom {
  margin-top: auto;
  padding-top: var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
}

.sidebar-action {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: inherit;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.sidebar-action:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.sidebar-action .sidebar-icon {
  color: var(--accent-base);
}

.sidebar-section-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: var(--spacer-1) var(--spacer-2);
  margin-bottom: var(--spacer-1);
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  text-decoration: none;
  transition: background var(--fast-duration), color var(--fast-duration);
  border-left: 3px solid transparent;
}

.sidebar-item:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.sidebar-item.active {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  border-left-color: var(--accent-base);
}

.sidebar-item.active .sidebar-icon {
  color: var(--accent-base);
}

.sidebar-icon {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}

.sidebar-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapsed .sidebar-section-title,
.collapsed .sidebar-label {
  display: none;
}

.collapsed .sidebar-item {
  justify-content: center;
  padding: var(--spacer-2);
}

.console-main {
  flex: 1;
  overflow-y: auto;
  background: var(--app-bg);
}

.console-main.full-width {
  width: 100%;
}

.editor-mode .console-main {
  overflow: hidden; /* 编辑器与AI模式需要精确控制溢出 */
}

/* 无学校状态：覆盖整个内容区 */
.no-school-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: var(--spacer-8);
  width: 100%;
}

.no-school-card {
  text-align: center;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-xl);
  padding: var(--spacer-8);
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
}

.no-school-icon {
  width: 96px;
  height: 96px;
  margin: 0 auto var(--spacer-5);
  border-radius: var(--radius-full);
  background: rgba(0, 103, 192, 0.08);
  color: var(--accent-base);
  display: flex;
  align-items: center;
  justify-content: center;
}

.no-school-icon > svg {
  width: 48px;
  height: 48px;
}

.no-school-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-3);
}

.no-school-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  line-height: 1.6;
  margin: 0 0 var(--spacer-5);
}

.no-school-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-5);
  background: var(--accent-base);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--fast-duration);
}

.no-school-btn:hover {
  background: var(--accent-hover);
}

.page-enter-active,
.page-leave-active {
  transition: opacity var(--fast-duration), transform var(--fast-duration);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.nav-menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  animation: fadeIn var(--fast-duration);
}

.nav-menu-panel {
  width: 360px;
  height: 100%;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border-right: 1px solid var(--flyout-border);
  display: flex;
  flex-direction: column;
  animation: slideIn var(--normal-duration) var(--fast-out-slow-in);
}

.nav-menu-header {
  padding: var(--spacer-5) var(--spacer-4) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
}

.nav-menu-brand {
  display: flex;
  align-items: center;
  color: var(--text-primary);
}

.nav-menu-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
}

.nav-menu-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.nav-menu-list {
  flex: 1;
  padding: var(--spacer-3) var(--spacer-2);
  overflow-y: auto;
}

.nav-menu-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  width: 100%;
  padding: var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
  transition: background var(--fast-duration);
}

.nav-menu-item:hover {
  background: var(--subtle-secondary);
}

.nav-menu-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* background: var(--subtle-secondary); */
  border-radius: var(--radius-md);
  flex-shrink: 0;
  color: var(--accent-base);
}

.nav-menu-label {
  flex: 1;
  font-size: var(--font-size-base);
  font-weight: 500;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-menu-subtitle-text {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 400;
}

.nav-menu-external {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.nav-menu-footer {
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.nav-menu-version {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

@media (max-width: 640px) {
  .username {
    display: none;
  }
  .brand-subtitle {
    display: none;
  }
  .console-sidebar {
    width: 52px;
  }
  .sidebar-section-title,
  .sidebar-label {
    display: none;
  }
  .sidebar-item {
    justify-content: center;
    padding: var(--spacer-2);
  }
}
</style>
