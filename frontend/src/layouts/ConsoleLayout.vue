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
        <div ref="searchBoxRef" class="search-box" :class="{ 'has-hint': !searchQuery }">
          <Icon icon="ri-search-line" class="search-icon" :size="14" />
          <input
            ref="searchInputRef"
            type="text"
            v-model="searchQuery"
            class="search-input"
            placeholder="搜索页面、文档与资源..."
            aria-label="搜索页面、文档与资源，输入 @ 筛选类型、> 进入命令模式"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="topbar-search-results"
            :aria-expanded="searchPanelOpen ? 'true' : 'false'"
            :aria-activedescendant="ariaActiveDescendant"
            @focus="onSearchFocus"
            @input="onSearchInput"
            @keydown="onSearchKeydown"
          />
          <span v-if="!searchQuery" class="search-kbd-hint" aria-hidden="true">
            <kbd>{{ shortcutModifier }}</kbd><kbd>K</kbd>
          </span>
          <div v-if="searchPanelOpen" class="search-results" aria-label="搜索面板">
            <div v-if="!isCommandMode" class="search-filter-bar" role="group" aria-label="按类型筛选">
              <button
                type="button"
                class="search-filter-chip"
                :class="{ active: activeFilters.length === 0 }"
                :aria-pressed="activeFilters.length === 0 ? 'true' : 'false'"
                @mousedown.prevent
                @click="clearFilters"
              >
                全部
              </button>
              <button
                v-for="def in FILTER_DEFS"
                :key="def.type"
                type="button"
                class="search-filter-chip"
                :class="{ active: activeFilters.includes(def.type) }"
                :aria-pressed="activeFilters.includes(def.type) ? 'true' : 'false'"
                @mousedown.prevent
                @click="toggleFilter(def.type)"
              >
                {{ def.label }}
              </button>
              <span v-if="resourceLoading" class="search-filter-loading">资源索引加载中…</span>
            </div>
            <div
              v-if="searchGroups.length > 0"
              id="topbar-search-results"
              class="search-results-list"
              role="listbox"
              aria-label="搜索结果"
            >
              <div
                v-for="group in searchGroups"
                :key="group.key"
                class="search-result-group"
                role="group"
                :aria-label="group.label"
              >
                <div class="search-result-group-title">
                  <span>{{ group.label }}</span>
                  <span class="search-result-group-count">
                    {{ group.items.length }}{{ group.hidden > 0 ? ` / ${group.items.length + group.hidden}` : '' }}
                  </span>
                </div>
                <div
                  v-for="entry in group.items"
                  :id="`topbar-search-option-${entry.index}`"
                  :key="entry.result.key"
                  class="search-result-item"
                  :class="{ active: entry.index === activeIndex }"
                  role="option"
                  :aria-selected="entry.index === activeIndex ? 'true' : 'false'"
                  @click="openSearchResult(entry.result)"
                  @mouseenter="activeIndex = entry.index"
                >
                  <Icon :icon="entry.result.icon" class="result-icon" :size="18" />
                  <span class="result-main">
                    <span class="result-title">
                      <template v-for="(part, i) in highlightParts(entry.result.title, highlightTokens)" :key="i">
                        <mark v-if="part.hit" class="search-highlight">{{ part.text }}</mark>
                        <template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <span v-if="entry.result.subtitle" class="result-subtitle">
                      <template v-for="(part, i) in highlightParts(entry.result.subtitle, highlightTokens)" :key="i">
                        <mark v-if="part.hit" class="search-highlight">{{ part.text }}</mark>
                        <template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                  </span>
                  <span class="result-tag">
                    <template v-for="(part, i) in highlightParts(entry.result.tag, highlightTokens)" :key="i">
                      <mark v-if="part.hit" class="search-highlight">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </div>
              </div>
            </div>
            <div v-else-if="isCommandMode" class="search-empty">
              <Icon icon="ri-terminal-line" class="search-empty-icon" :size="20" />
              <span class="search-empty-text">{{ commandEmptyText }}</span>
            </div>
            <div v-else-if="displayKeyword.trim() || activeFilters.length" class="search-empty">
              <Icon icon="ri-search-line" class="search-empty-icon" :size="20" />
              <span class="search-empty-text">{{ emptyStateText }}</span>
            </div>
            <div v-else class="search-hint">
              <span class="search-hint-text">{{ canSearchResources ? '输入关键词，搜索页面、文档与资源' : '输入关键词，搜索页面与帮助文档' }}</span>
              <span v-if="helpDocsLoading" class="search-hint-doc">正在加载帮助文档索引…</span>
              <span v-if="resourceLoading" class="search-hint-doc">正在加载云文件 / 网页空间 / 配置实例…</span>
              <span v-else-if="helpDocsError || resourceError" class="search-hint-doc">部分索引加载失败，可稍后重试</span>
            </div>
            <div v-if="!canSearchResources" class="search-resource-gate">
              云文件 / 网页空间 / 配置实例仅智教联盟账户可搜索
            </div>
            <div class="search-footer" aria-hidden="true">
              <span class="search-footer-keys">
                <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
                <span><kbd>Enter</kbd>打开</span>
                <span><kbd>Esc</kbd>关闭</span>
              </span>
              <span class="search-footer-tip">输入 @ 筛选类型 · &gt; 命令</span>
            </div>
          </div>
        </div>
      </div>

      <div class="top-bar-right">
        <button
          class="icon-btn notification-btn"
          :title="unreadCount > 0 ? `通知中心（${unreadCount} 条未读）` : '通知中心'"
          :aria-label="unreadCount > 0 ? `通知中心，${unreadCount} 条未读` : '通知中心'"
          @click="navigateTo('/console/notifications')"
        >
          <Icon icon="ri-notification-3-line" :size="18" />
          <span v-if="unreadCount > 0" class="badge" aria-hidden="true">{{ unreadBadgeText }}</span>
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
      </aside>

      <AiAssistantDrawer
        :visible="aiDrawerVisible"
        @close="aiDrawerVisible = false"
      />

      <main class="console-main" :class="{ 'full-width': !hasSidebar }">
        <router-view v-slot="{ Component }">
          <keep-alive :include="keepAliveComponents">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>

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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandLogo from '../components/BrandLogo.vue';
import AiAssistantDrawer from '../components/AiAssistantDrawer.vue';
import { useAuth } from '../composables/useAuth';
import { notificationsApi, helpApi, dataSpaceApi, distributionsApi, authApi } from '../api';
import { api } from '../api/client';

const route = useRoute();
const router = useRouter();

const sidebarOpen = ref(true);
const showNavMenu = ref(false);
const showUserMenu = ref(false);
const searchQuery = ref('');
const searchPanelOpen = ref(false);
const activeIndex = ref(-1);
const searchBoxRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const unreadCount = ref(0);

// AI 助理抽屉
const aiDrawerVisible = ref(false);

const { fetchMe, user: sessionUser, clear: clearSession } = useAuth();

// 当前用户认证信息（用于权限控制）
const authUser = ref<any>(null);
const isAlliance = computed(() => authUser.value?.is_alliance || false);
const isSuperAdmin = computed(() => authUser.value?.is_super_admin || false);
const isAdmin = computed(() => isSuperAdmin.value || authUser.value?.role === 'admin');
// 资源搜索（云文件 / 网页空间 / 配置实例）仅智教联盟账户可搜索
const canSearchResources = computed(
  () => authUser.value?.type === 'alliance'
    || isAlliance.value
    || sessionUser.value?.type === 'alliance'
    || !!sessionUser.value?.is_alliance
);

// KeepAlive 保留状态的组件（导航离开后不销毁）
const keepAliveComponents = ['LightEditor', 'StandardEditor', 'DataSpace'];

const user = ref({
  name: '管理员',
  role: '管理员',
  initial: 'A'
});

const navMenuItems = [
  { path: '/console', icon: 'ri-home-5-line', title: '首页', subtitle: '控制台首页' },
  { path: '/console/editor/light', icon: 'ri-edit-2-line', title: '轻编辑器', subtitle: '文件与配置实例' },
  { path: '/console/dataspace', icon: 'ri-folder-3-line', title: '数据空间', subtitle: '云文件与网页空间管理' },
  { path: '/console/ai', icon: 'ri-brain-line', title: 'AI 助理', subtitle: '智能问答与辅助' },
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

// 当前侧栏模式：developer / admin / ai / default
// /console/developer 触发开发者模式，/console/admin 触发管理模式，
// /console/ai 触发 AI 模式；其余为默认模式（无侧栏）
const sidebarMode = computed<'developer' | 'admin' | 'ai' | 'default'>(() => {
  const path = route.path;
  if (path.startsWith('/console/developer')) {
    return 'developer';
  }
  if (path.startsWith('/console/admin')) {
    return 'admin';
  }
  if (path.startsWith('/console/ai')) {
    return 'ai';
  }
  return 'default';
});

const sidebarItems = computed(() => {
  if (sidebarMode.value === 'developer') {
    // 非联盟用户仅显示共享市场，联盟用户和管理员显示全部
    if (isAlliance.value || isSuperAdmin.value) {
      return [
        { path: '/console/developer', icon: 'ri-key-2-line', title: '开发者中心' },
        { path: '/console/developer/apps', icon: 'ri-apps-2-line', title: '实例侧应用' },
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
      { path: '/console/admin/ai-config', icon: 'ri-brain-line', title: 'AI 配置' },
      { path: '/console/admin/web-hosting', icon: 'ri-global-line', title: '网页空间' },
      { path: '/console/admin/dataspace', icon: 'ri-hard-drive-2-line', title: '数据空间' },
      { path: '/console/admin/help', icon: 'ri-book-open-line', title: '帮助中心' }
    ];
  }
  return [];
});

// 侧栏标题：开发者中心 / 管理后台 / AI 助理 / 控制台
const currentModeLabel = computed(() => {
  if (sidebarMode.value === 'developer') return '开发者中心';
  if (sidebarMode.value === 'admin') return '管理后台';
  if (sidebarMode.value === 'ai') return 'AI 助理';
  return '控制台';
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
  return true;
});

const canGoBack = computed(() => {
  return window.history.length > 1;
});

/* ===== 顶栏搜索：页面 + 帮助文档 ===== */

interface SearchPageItem {
  path: string;
  icon: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  external?: boolean;
}

interface HelpDocEntry {
  id: number;
  title: string;
  category: string;
  categoryId: number;
  icon: string;
}

type ResultKind = 'page' | 'doc' | 'cloud' | 'webspace' | 'instance' | 'command';
type FilterType = 'page' | 'doc' | 'cloud' | 'webspace' | 'instance';
type SearchMode = 'search' | 'command';

interface SearchResult {
  key: string;
  kind: ResultKind;
  title: string;
  tag: string;
  icon: string;
  path?: string;
  subtitle?: string;
  external?: boolean;
  docId?: number;
  cloudFileId?: number;
  instanceId?: number;
  spacePath?: string;
  commandId?: CommandId;
}

interface SearchGroupEntry {
  result: SearchResult;
  index: number;
}

interface SearchGroup {
  key: ResultKind;
  label: string;
  items: SearchGroupEntry[];
  /** 因数量上限未展示的结果数 */
  hidden: number;
}

interface HighlightPart {
  text: string;
  hit: boolean;
}

interface CloudFileEntry {
  id: number;
  name: string;
  subtitle: string;
  fileType: string;
}

interface WebSpaceEntry {
  name: string;
  path: string;
  subtitle: string;
  isDirectory: boolean;
  fileType: string;
}

interface InstanceEntry {
  id: number;
  name: string;
  subtitle: string;
}

type CommandId =
  | 'home'
  | 'light-editor'
  | 'dataspace'
  | 'ai'
  | 'help'
  | 'notifications'
  | 'profile'
  | 'audit-log'
  | 'data-export'
  | 'developer'
  | 'admin'
  | 'new-file'
  | 'new-dir'
  | 'mark-all-read'
  | 'logout';

interface SearchCommandItem {
  id: CommandId;
  title: string;
  icon: string;
  tag: string;
  keywords: string;
  adminOnly?: boolean;
}

interface ParsedSearchQuery {
  mode: SearchMode;
  /** 普通搜索关键词（已剔除 @ 筛选 token，保留原始大小写） */
  keyword: string;
  /** 命令模式下的命令关键字（> 之后的内容） */
  commandKeyword: string;
  filters: FilterType[];
}

interface SearchGroupBuildInput {
  mode: SearchMode;
  keywordTokens: string[];
  filters: FilterType[];
  pages: SearchPageItem[];
  docs: HelpDocEntry[];
  cloudFiles: CloudFileEntry[];
  webSpaces: WebSpaceEntry[];
  instances: InstanceEntry[];
  commands: SearchCommandItem[];
  limit: number;
}

// 除全局导航外补充的常用页面（仅作为搜索源，不改变全局导航菜单）
const extraSearchPages: SearchPageItem[] = [
  { path: '/console/editor/standard', icon: 'ri-code-s-slash-line', title: '标准编辑器', subtitle: '代码与配置文件编辑', keywords: 'standard editor 代码 编辑 文件' },
  { path: '/console/profile', icon: 'ri-user-line', title: '个人中心', subtitle: '账号资料与偏好设置', keywords: 'profile 账号 头像 密码 昵称 偏好 设置' },
  { path: '/console/notifications', icon: 'ri-notification-3-line', title: '通知中心', subtitle: '系统通知与消息', keywords: 'notification 消息 未读 提醒' },
  { path: '/console/audit-log', icon: 'ri-file-list-3-line', title: '操作日志', subtitle: '账号操作记录查询', keywords: 'audit log 日志 记录 审计' },
  { path: '/console/data-export', icon: 'ri-download-line', title: '数据导出', subtitle: '导出个人数据与文件', keywords: 'export 导出 下载 备份' }
];

// 页面关键词（别名/标签），用于扩展搜索命中范围
const pageKeywords: Record<string, string> = {
  '/console': '首页 home 控制台 dashboard 工作台 概览',
  '/console/editor/light': '轻编辑器 light editor 配置 实例 文件',
  '/console/dataspace': '数据空间 dataspace 云文件 网页空间 网盘',
  '/console/ai': 'ai 助理 assistant 智能问答 模型 对话',
  '/console/help': '帮助 文档 教程 使用说明 help doc',
  '/console/developer': '开发者 应用 插件 api 接入',
  '/console/admin': '管理后台 系统配置 管理员 admin'
};

// 帮助文档索引：懒加载 + 缓存（同一布局实例只请求一次）
const helpDocs = ref<HelpDocEntry[]>([]);
const helpDocsLoading = ref(false);
const helpDocsError = ref(false);
let helpDocsLoaded = false;

async function ensureHelpDocs() {
  if (helpDocsLoaded || helpDocsLoading.value) return;
  helpDocsLoading.value = true;
  helpDocsError.value = false;
  try {
    const tree = await helpApi.tree();
    const docs: HelpDocEntry[] = [];
    for (const cat of tree || []) {
      for (const art of cat?.articles || []) {
        docs.push({
          id: Number(art?.id),
          title: art?.title || '未命名文档',
          category: cat?.title || '帮助文档',
          categoryId: Number(cat?.id),
          icon: cat?.icon || 'ri-file-text-line'
        });
      }
    }
    helpDocs.value = docs.filter((doc) => Number.isFinite(doc.id) && doc.id > 0);
    helpDocsLoaded = true;
  } catch (e) {
    helpDocsError.value = true;
    console.error('加载帮助文档索引失败:', e);
  } finally {
    helpDocsLoading.value = false;
  }
}

// 可搜索页面 = 全局导航（按权限过滤）+ 常用页面
const searchablePages = computed<SearchPageItem[]>(() => {
  const navPages: SearchPageItem[] = filteredNavMenuItems.value.map((item) => ({
    path: item.path,
    icon: item.icon,
    title: item.title,
    subtitle: item.subtitle,
    keywords: pageKeywords[item.path] || '',
    external: !!item.external
  }));
  return [...navPages, ...extraSearchPages];
});

/* ---------- 资源索引（云文件 / 网页空间 / 配置实例，仅智教联盟账户） ---------- */

// 云文件列表 → 搜索结果条目（只索引文件，目录不参与）
function mapCloudFileEntries(list: any[]): CloudFileEntry[] {
  const result: CloudFileEntry[] = [];
  for (const raw of list || []) {
    if (!raw || typeof raw !== 'object') continue;
    if (Number(raw.is_directory) === 1) continue;
    const id = Number(raw.id);
    const name = String(raw.name || '');
    if (!Number.isFinite(id) || id <= 0 || !name) continue;
    const parent = typeof raw.parent_dir === 'string' ? raw.parent_dir : '';
    const isShared = String(raw.source || '') === 'shared';
    const subtitle = isShared
      ? `来自分享${raw.owner ? ' · ' + String(raw.owner) : ''}`
      : (parent || '根目录');
    result.push({ id, name, subtitle, fileType: String(raw.file_type || '') });
  }
  return result;
}

// 网页空间路径（/网页空间/<空间名>/<相对路径>）→ “空间名 · /相对路径”
function webSpaceFileSubtitle(path: string): string {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== '网页空间') return path;
  const spaceName = parts[1];
  const relative = '/' + parts.slice(2).join('/');
  return `${spaceName} · ${relative}`;
}

// 递归收集网页空间节点及其文件 / 目录（其它 source 节点只做向下遍历）
function collectWebSpaceEntries(nodes: any[], out: WebSpaceEntry[]): void {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    const source = String(node.source || '');
    const name = String(node.name || '');
    const path = String(node.path || '');
    if (source === 'webspace' && path) {
      out.push({
        name: name || '网页空间',
        path,
        subtitle: '我的网页空间',
        isDirectory: true,
        fileType: 'dir'
      });
    } else if (source === 'webspace_file' && name && path) {
      out.push({
        name,
        path,
        subtitle: webSpaceFileSubtitle(path),
        isDirectory: !!node.is_directory,
        fileType: String(node.file_type || '')
      });
    }
    if (Array.isArray(node.children) && node.children.length) {
      collectWebSpaceEntries(node.children, out);
    }
  }
}

// dataSpaceApi.tree() 返回 { nodes: [...] }（兼容直接返回数组）
function mapWebSpaceEntries(tree: any): WebSpaceEntry[] {
  const nodes = Array.isArray(tree) ? tree : (tree && Array.isArray(tree.nodes) ? tree.nodes : []);
  const out: WebSpaceEntry[] = [];
  collectWebSpaceEntries(nodes, out);
  return out;
}

// 配置实例列表 → 搜索结果条目
function mapInstanceEntries(list: any[]): InstanceEntry[] {
  const result: InstanceEntry[] = [];
  for (const raw of list || []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = Number(raw.id);
    const name = String(raw.name || '');
    if (!Number.isFinite(id) || id <= 0 || !name) continue;
    const formatLabel = String(raw.format_label || raw.format || '配置');
    const sourceName = String(raw.source_file_name || '');
    result.push({
      id,
      name,
      subtitle: sourceName ? `${formatLabel} · 源文件 ${sourceName}` : formatLabel
    });
  }
  return result;
}

function iconForFileType(fileType: string): string {
  const map: Record<string, string> = {
    md: 'ri-markdown-line',
    json: 'ri-braces-line',
    html: 'ri-html5-line',
    htm: 'ri-html5-line',
    css: 'ri-css3-line',
    js: 'ri-javascript-line',
    mjs: 'ri-javascript-line',
    ts: 'ri-javascript-line',
    txt: 'ri-file-text-line',
    config: 'ri-settings-3-line',
    yml: 'ri-file-code-line',
    yaml: 'ri-file-code-line',
    xml: 'ri-file-code-line',
    csv: 'ri-file-excel-line'
  };
  return map[String(fileType || '').toLowerCase()] || 'ri-file-2-line';
}

const cloudFileEntries = ref<CloudFileEntry[]>([]);
const webSpaceEntries = ref<WebSpaceEntry[]>([]);
const instanceEntries = ref<InstanceEntry[]>([]);
const resourceLoading = ref(false);
const resourceError = ref(false);
let resourceLoaded = false;
let resourceLoadPromise: Promise<void> | null = null;

// 首次聚焦搜索框时与帮助文档并行懒加载三类资源；任一失败只降级该组
function ensureResources(): void {
  if (!canSearchResources.value || resourceLoaded || resourceLoadPromise) return;
  resourceLoading.value = true;
  resourceError.value = false;
  const tasks = [
    api.get<any[]>('/cloud-files?action=list')
      .then((data) => { cloudFileEntries.value = mapCloudFileEntries(data); })
      .catch((e) => { resourceError.value = true; console.warn('云文件索引加载失败:', e); }),
    dataSpaceApi.tree()
      .then((data) => { webSpaceEntries.value = mapWebSpaceEntries(data); })
      .catch((e) => { resourceError.value = true; console.warn('网页空间索引加载失败:', e); }),
    distributionsApi.list()
      .then((data) => { instanceEntries.value = mapInstanceEntries(data); })
      .catch((e) => { resourceError.value = true; console.warn('配置实例索引加载失败:', e); })
  ];
  resourceLoadPromise = Promise.all(tasks).then(() => {
    resourceLoaded = true;
    resourceLoading.value = false;
    resourceLoadPromise = null;
  });
}

/* ---------- 查询解析：@ 类型筛选 / > 命令模式 ---------- */

const FILTER_DEFS: { type: FilterType; label: string; aliases: string[] }[] = [
  { type: 'page', label: '页面', aliases: ['页面', 'page'] },
  { type: 'doc', label: '文档', aliases: ['文档', 'doc'] },
  { type: 'cloud', label: '云文件', aliases: ['文件', 'file', '云文件', 'cloud'] },
  { type: 'webspace', label: '网页空间', aliases: ['空间', 'web', 'webspace', '网页空间'] },
  { type: 'instance', label: '配置实例', aliases: ['实例', 'instance', '配置实例'] }
];

function resolveFilterType(alias: string): FilterType | null {
  const value = String(alias || '').trim().toLowerCase();
  if (!value) return null;
  for (const def of FILTER_DEFS) {
    if (def.aliases.some((item) => item.toLowerCase() === value)) return def.type;
  }
  return null;
}

// 解析搜索框文本：> 开头为命令模式；@xxx 为类型筛选（未知 @ 词保留为普通关键词）
function parseSearchQuery(raw: string): ParsedSearchQuery {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('>')) {
    return { mode: 'command', keyword: '', commandKeyword: trimmed.slice(1).trim(), filters: [] };
  }
  const filters: FilterType[] = [];
  const words: string[] = [];
  for (const token of trimmed.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('@')) {
      const type = resolveFilterType(token.slice(1));
      if (type) {
        if (!filters.includes(type)) filters.push(type);
        continue;
      }
    }
    words.push(token);
  }
  return { mode: 'search', keyword: words.join(' '), commandKeyword: '', filters };
}

const parsedQuery = computed<ParsedSearchQuery>(() => parseSearchQuery(searchQuery.value));
const isCommandMode = computed(() => parsedQuery.value.mode === 'command');
const activeFilters = computed<FilterType[]>(() => parsedQuery.value.filters);
const displayKeyword = computed(() =>
  isCommandMode.value ? parsedQuery.value.commandKeyword : parsedQuery.value.keyword
);

function tokenizeKeyword(keyword: string): string[] {
  return String(keyword || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

const searchTokens = computed(() => tokenizeKeyword(parsedQuery.value.keyword));
const commandTokens = computed(() => tokenizeKeyword(parsedQuery.value.commandKeyword));
const highlightTokens = computed(() => (isCommandMode.value ? commandTokens.value : searchTokens.value));

function matchesAllTokens(fields: (string | undefined)[], tokens: string[]): boolean {
  if (!tokens.length) return false;
  const haystack = fields.filter((field): field is string => !!field).join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/* ---------- 命令 ---------- */

const searchCommands: SearchCommandItem[] = [
  { id: 'home', title: '打开首页', icon: 'ri-home-5-line', tag: '导航', keywords: '首页 home 控制台 dashboard' },
  { id: 'light-editor', title: '打开轻编辑器', icon: 'ri-edit-2-line', tag: '导航', keywords: '轻编辑器 编辑器 light editor 文件' },
  { id: 'dataspace', title: '打开数据空间', icon: 'ri-folder-3-line', tag: '导航', keywords: '数据空间 dataspace 云文件 网页空间' },
  { id: 'ai', title: '打开 AI 助理', icon: 'ri-brain-line', tag: '导航', keywords: 'ai 助理 assistant 智能问答' },
  { id: 'help', title: '打开帮助中心', icon: 'ri-question-line', tag: '导航', keywords: '帮助 文档 教程 help doc' },
  { id: 'notifications', title: '打开通知中心', icon: 'ri-notification-3-line', tag: '导航', keywords: '通知 消息 notification' },
  { id: 'profile', title: '打开个人中心', icon: 'ri-user-line', tag: '导航', keywords: '个人中心 账号 profile' },
  { id: 'audit-log', title: '打开操作日志', icon: 'ri-file-list-3-line', tag: '导航', keywords: '操作日志 审计 audit log' },
  { id: 'data-export', title: '打开数据导出', icon: 'ri-download-line', tag: '导航', keywords: '数据导出 下载 export' },
  { id: 'developer', title: '打开开发者中心', icon: 'ri-key-2-line', tag: '导航', keywords: '开发者 应用 插件 developer' },
  { id: 'admin', title: '打开管理后台', icon: 'ri-shield-keyhole-line', tag: '导航', keywords: '管理后台 系统配置 admin', adminOnly: true },
  { id: 'new-file', title: '新建云文件', icon: 'ri-file-add-line', tag: '创建', keywords: '新建 云文件 创建 file new' },
  { id: 'new-dir', title: '新建文件夹', icon: 'ri-folder-add-line', tag: '创建', keywords: '新建 文件夹 目录 dir folder' },
  { id: 'mark-all-read', title: '全部标为已读', icon: 'ri-check-double-line', tag: '通知', keywords: '通知 全部 已读 标记 mark read' },
  { id: 'logout', title: '退出登录', icon: 'ri-logout-box-line', tag: '账户', keywords: '退出 登录 logout sign out' }
];

function filterSearchCommands(tokens: string[], isAdminUser: boolean): SearchCommandItem[] {
  const visible = searchCommands.filter((cmd) => !cmd.adminOnly || isAdminUser);
  if (!tokens.length) return visible;
  return visible.filter((cmd) => matchesAllTokens([cmd.title, cmd.tag, cmd.keywords], tokens));
}

/* ---------- 结果分组 ---------- */

function commandToResult(cmd: SearchCommandItem): SearchResult {
  return {
    key: `command:${cmd.id}`,
    kind: 'command',
    title: cmd.title,
    tag: cmd.tag,
    icon: cmd.icon,
    commandId: cmd.id
  };
}

// 纯函数：把各数据源映射为「页面 / 文档 / 云文件 / 网页空间 / 配置实例 / 命令」分组
function buildSearchGroups(input: SearchGroupBuildInput): SearchGroup[] {
  const filterSet = new Set<FilterType>(input.filters);
  const keywordEmpty = input.keywordTokens.length === 0;
  const limit = Math.max(1, input.limit || 40);
  const groups: SearchGroup[] = [];
  let index = 0;

  const pushGroup = (key: ResultKind, label: string, results: SearchResult[]) => {
    if (!results.length) return;
    const visible = results.slice(0, limit);
    groups.push({
      key,
      label,
      items: visible.map((result) => ({ result, index: index++ })),
      hidden: Math.max(0, results.length - visible.length)
    });
  };

  if (input.mode === 'command') {
    pushGroup('command', '命令', input.commands.map(commandToResult));
    return groups;
  }

  // 既无关键词也无筛选：由面板展示输入提示
  if (keywordEmpty && filterSet.size === 0) return [];

  const groupAllowed = (kind: FilterType): boolean => filterSet.size === 0 || filterSet.has(kind);
  const match = (fields: (string | undefined)[]): boolean =>
    keywordEmpty || matchesAllTokens(fields, input.keywordTokens);

  if (groupAllowed('page')) {
    const results: SearchResult[] = [];
    for (const item of input.pages) {
      if (!match([item.title, item.subtitle, item.keywords, getTagForPath(item.path)])) continue;
      results.push({
        key: `page:${item.path}`,
        kind: 'page',
        title: item.title,
        subtitle: item.subtitle,
        tag: getTagForPath(item.path),
        icon: item.icon,
        path: item.path,
        external: !!item.external
      });
    }
    pushGroup('page', '页面', results);
  }

  if (groupAllowed('doc')) {
    const results: SearchResult[] = [];
    for (const doc of input.docs) {
      if (!match([doc.title, doc.category])) continue;
      results.push({
        key: `doc:${doc.id}`,
        kind: 'doc',
        title: doc.title,
        tag: doc.category,
        icon: doc.icon,
        docId: doc.id
      });
    }
    pushGroup('doc', '文档', results);
  }

  if (groupAllowed('cloud')) {
    const results: SearchResult[] = [];
    for (const file of input.cloudFiles) {
      if (!match([file.name, file.subtitle])) continue;
      results.push({
        key: `cloud:${file.id}`,
        kind: 'cloud',
        title: file.name,
        subtitle: file.subtitle,
        tag: '云文件',
        icon: iconForFileType(file.fileType),
        cloudFileId: file.id
      });
    }
    pushGroup('cloud', '云文件', results);
  }

  if (groupAllowed('webspace')) {
    const results: SearchResult[] = [];
    for (const node of input.webSpaces) {
      if (!match([node.name, node.subtitle])) continue;
      results.push({
        key: `webspace:${node.path}`,
        kind: 'webspace',
        title: node.name,
        subtitle: node.subtitle,
        tag: '网页空间',
        icon: node.isDirectory ? 'ri-folder-3-line' : iconForFileType(node.fileType),
        spacePath: node.path
      });
    }
    pushGroup('webspace', '网页空间', results);
  }

  if (groupAllowed('instance')) {
    const results: SearchResult[] = [];
    for (const inst of input.instances) {
      if (!match([inst.name, inst.subtitle])) continue;
      results.push({
        key: `instance:${inst.id}`,
        kind: 'instance',
        title: inst.name,
        subtitle: inst.subtitle,
        tag: '配置实例',
        icon: 'ri-git-branch-line',
        instanceId: inst.id
      });
    }
    pushGroup('instance', '配置实例', results);
  }

  return groups;
}

// 结果分组；命令模式下只显示命令分组
const searchGroups = computed<SearchGroup[]>(() => buildSearchGroups({
  mode: parsedQuery.value.mode,
  keywordTokens: searchTokens.value,
  filters: activeFilters.value,
  pages: searchablePages.value,
  docs: helpDocs.value,
  cloudFiles: cloudFileEntries.value,
  webSpaces: webSpaceEntries.value,
  instances: instanceEntries.value,
  commands: isCommandMode.value ? filterSearchCommands(commandTokens.value, isAdmin.value) : [],
  limit: 40
}));

const flatSearchResults = computed<SearchResult[]>(() =>
  searchGroups.value.flatMap((group) => group.items.map((entry) => entry.result))
);

const shortcutModifier = computed(() => (/Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'));

const ariaActiveDescendant = computed(() =>
  searchPanelOpen.value && activeIndex.value >= 0 ? `topbar-search-option-${activeIndex.value}` : undefined
);

function getTagForPath(path: string): string {
  if (path.startsWith('/console/editor')) return '编辑器';
  if (path.startsWith('/console/ai')) return 'AI';
  if (path.startsWith('/console/dataspace')) return '数据';
  if (path.startsWith('/console/developer')) return '开发';
  if (path.startsWith('/console/admin')) return '管理';
  if (path.startsWith('/console/help')) return '帮助';
  if (path.startsWith('/console/notifications')) return '通知';
  if (path.startsWith('/console/profile')) return '账号';
  if (path.startsWith('/console/audit-log')) return '日志';
  if (path.startsWith('/console/data-export')) return '导出';
  return '功能';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 把标题按搜索词切分为「命中/未命中」片段，供模板高亮
function highlightParts(text: string, tokens: string[]): HighlightPart[] {
  if (!text) return [];
  const valid = tokens.filter(Boolean);
  if (!valid.length) return [{ text, hit: false }];
  const pattern = new RegExp(`(${valid.map(escapeRegExp).join('|')})`, 'gi');
  const parts: HighlightPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

function openSearchPanel() {
  searchPanelOpen.value = true;
  ensureHelpDocs();
  ensureResources();
}

function closeSearchPanel() {
  searchPanelOpen.value = false;
  searchQuery.value = '';
  activeIndex.value = -1;
}

function onSearchFocus() {
  openSearchPanel();
}

function onSearchInput() {
  openSearchPanel();
  activeIndex.value = -1;
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSearchPanel();
    return;
  }

  // Tab 离开输入框时收起面板（mousedown 外部点击逻辑覆盖不到键盘跳转）
  if (event.key === 'Tab') {
    searchPanelOpen.value = false;
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!searchPanelOpen.value) openSearchPanel();
    const total = flatSearchResults.value.length;
    if (!total) return;
    if (event.key === 'ArrowDown') {
      activeIndex.value = activeIndex.value + 1 >= total ? 0 : activeIndex.value + 1;
    } else {
      activeIndex.value = activeIndex.value <= 0 ? total - 1 : activeIndex.value - 1;
    }
    return;
  }

  if (event.key === 'Enter') {
    // 未用方向键选择时，默认打开第一条结果
    const current = flatSearchResults.value[activeIndex.value >= 0 ? activeIndex.value : 0];
    if (!current) return;
    event.preventDefault();
    openSearchResult(current);
  }
}

async function scrollActiveOptionIntoView() {
  await nextTick();
  const container = document.getElementById('topbar-search-results');
  const option = document.getElementById(`topbar-search-option-${activeIndex.value}`);
  if (!container || !option) return;
  // option/list 的 offsetTop 都相对 .search-results（绝对定位容器），相减得到列表内坐标
  const optionTop = option.offsetTop - container.offsetTop;
  const optionBottom = optionTop + option.offsetHeight;
  if (optionTop < container.scrollTop) {
    container.scrollTop = optionTop;
  } else if (optionBottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = optionBottom - container.clientHeight;
  }
}

function openSearchResult(result: SearchResult) {
  if (result.kind === 'command' && result.commandId) {
    runCommand(result.commandId);
    return;
  }
  closeSearchPanel();
  if (result.external && result.path) {
    window.open(result.path, '_blank');
    return;
  }
  if (result.kind === 'doc' && result.docId) {
    router.push({ path: '/console/help', query: { doc: String(result.docId) } });
    return;
  }
  if (result.kind === 'cloud' && result.cloudFileId) {
    router.push({ path: '/console/editor/light', query: { file: String(result.cloudFileId) } });
    return;
  }
  if (result.kind === 'instance' && result.instanceId) {
    router.push({ path: '/console/editor/light', query: { instance: String(result.instanceId) } });
    return;
  }
  if (result.kind === 'webspace' && result.spacePath) {
    router.push({ path: '/console/dataspace', query: { path: result.spacePath } });
    return;
  }
  if (result.path) router.push(result.path);
}

/* ---------- 命令执行 ---------- */

async function markAllNotificationsRead() {
  try {
    await notificationsApi.markRead(0);
    await fetchUnreadCount();
  } catch (e) {
    console.error('标记全部已读失败:', e);
  }
}

function runCommand(id: CommandId) {
  closeSearchPanel();
  switch (id) {
    case 'home': router.push('/console'); break;
    case 'light-editor': router.push('/console/editor/light'); break;
    case 'dataspace': router.push('/console/dataspace'); break;
    case 'ai': router.push('/console/ai'); break;
    case 'help': router.push('/console/help'); break;
    case 'notifications': router.push('/console/notifications'); break;
    case 'profile': router.push('/console/profile'); break;
    case 'audit-log': router.push('/console/audit-log'); break;
    case 'data-export': router.push('/console/data-export'); break;
    case 'developer': router.push('/console/developer'); break;
    case 'admin': router.push('/console/admin'); break;
    case 'new-file': router.push({ path: '/console/editor/light', query: { new: 'file' } }); break;
    case 'new-dir': router.push({ path: '/console/editor/light', query: { new: 'dir' } }); break;
    case 'mark-all-read': void markAllNotificationsRead(); break;
    case 'logout': void logout(); break;
    default: break;
  }
}

/* ---------- @ 类型筛选 chips ---------- */

function toggleFilter(type: FilterType) {
  const tokens = searchQuery.value.trim().split(/\s+/).filter(Boolean);
  let removed = false;
  const next: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('@') && resolveFilterType(token.slice(1)) === type) {
      removed = true;
      continue;
    }
    next.push(token);
  }
  if (!removed) {
    const def = FILTER_DEFS.find((item) => item.type === type);
    if (def) next.push('@' + def.label);
  }
  searchQuery.value = next.join(' ');
  activeIndex.value = -1;
  nextTick(() => searchInputRef.value?.focus());
}

function clearFilters() {
  const tokens = searchQuery.value.trim().split(/\s+/).filter(Boolean);
  const next = tokens.filter((token) => !(token.startsWith('@') && resolveFilterType(token.slice(1))));
  searchQuery.value = next.join(' ');
  activeIndex.value = -1;
  nextTick(() => searchInputRef.value?.focus());
}

const filterLabels = computed(() =>
  activeFilters.value
    .map((type) => FILTER_DEFS.find((def) => def.type === type)?.label || '')
    .filter(Boolean)
);

const emptyStateText = computed(() => {
  if (isCommandMode.value) return '输入命令关键字，例如：>轻编辑器、>新建云文件、>退出登录';
  if (filterLabels.value.length) return `未找到匹配的${filterLabels.value.join('、')}`;
  return `未找到与 “${displayKeyword.value.trim()}” 相关的页面或文档`;
});

const commandEmptyText = '输入命令关键字，例如：>轻编辑器、>新建云文件、>退出登录';

// Ctrl / Cmd + K 聚焦搜索框；Esc 在任意位置关闭结果面板
function onGlobalKeydown(event: KeyboardEvent) {
  const key = event.key ? event.key.toLowerCase() : '';
  if (key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey) {
    event.preventDefault();
    openSearchPanel();
    const input = searchInputRef.value;
    if (input) {
      input.focus();
      input.select();
    }
    return;
  }
  if (event.key === 'Escape' && searchPanelOpen.value) {
    closeSearchPanel();
  }
}

// 点击搜索框外部关闭结果
function onDocumentMouseDown(event: MouseEvent) {
  if (!searchPanelOpen.value) return;
  const target = event.target as Node | null;
  if (target && searchBoxRef.value && !searchBoxRef.value.contains(target)) {
    searchPanelOpen.value = false;
  }
}

// 结果变化时取消高亮，首次 ↓ / Enter 都从第一条开始
watch(searchGroups, () => {
  activeIndex.value = -1;
});

watch(activeIndex, () => {
  if (activeIndex.value < 0 || !searchPanelOpen.value) return;
  scrollActiveOptionIntoView();
});

// 认证信息加载完成（智教联盟账户）后补拉资源索引
watch(canSearchResources, (allowed) => {
  if (allowed && searchPanelOpen.value) ensureResources();
});

const userInitial = computed(() => user.value.initial);
const userName = computed(() => user.value.name);
const userRole = computed(() => user.value.role);
// 通知角标文案：超过 99 显示 99+，避免多位数撑破角标
const unreadBadgeText = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)));

function isItemActive(itemPath: string) {
  const currentPath = route.path;
  // 精确匹配根路径
  if (itemPath === '/console') {
    return currentPath === '/console' || currentPath === '/console/';
  }
  // 精确匹配父级项目（仅当路径完全相同时激活）
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
  searchPanelOpen.value = false;
  showUserMenu.value = false;
  searchQuery.value = '';
  activeIndex.value = -1;
  if (path.startsWith('http')) {
    window.open(path, '_blank');
  } else {
    router.push(path);
  }
}

function goBack() {
  router.back();
}

async function logout() {
  try {
    // 必须通知服务端销毁会话，否则 cookie 仍在，登录页会被导航守卫送回控制台
    await authApi.logout();
  } catch {
    // 网络失败也继续本地清理，避免用户卡在已退出的界面
  }
  clearSession();
  localStorage.removeItem('auth_token');
  // replace 避免浏览器回退到已退出的控制台页面
  window.location.replace('/login');
}

watch(() => route.path, () => {
  showNavMenu.value = false;
  searchPanelOpen.value = false;
  showUserMenu.value = false;
  activeIndex.value = -1;
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
  // 全局快捷键 / 点击外部关闭搜索面板
  window.addEventListener('keydown', onGlobalKeydown);
  window.addEventListener('mousedown', onDocumentMouseDown);
  window.addEventListener('click', onDocumentMouseDown);
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
  window.removeEventListener('keydown', onGlobalKeydown);
  window.removeEventListener('mousedown', onDocumentMouseDown);
  window.removeEventListener('click', onDocumentMouseDown);
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
