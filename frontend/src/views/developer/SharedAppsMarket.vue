<template>
  <div class="shared-market">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">
          <Icon icon="ri-store-2-line" :size="20" />
          共享市场
        </h1>
        <p class="page-description">浏览官方与社区开发者共享的应用和插件，可直接 Fork 使用</p>
      </div>
      <button class="btn btn-ghost" @click="goBack">
        <Icon icon="ri-arrow-left-s-line" :size="14" />
        返回开发者中心
      </button>
    </div>

    <!-- 分类标签 -->
    <div class="category-tabs">
      <button
        v-for="cat in categoryTabs"
        :key="cat.key"
        class="cat-tab"
        :class="{ active: activeCategory === cat.key }"
        @click="activeCategory = cat.key"
      >
        <Icon :icon="cat.icon" :size="14" />
        {{ cat.label }}
        <span class="cat-count">{{ getCategoryCount(cat.key) }}</span>
      </button>
    </div>

    <div class="filter-bar">
      <div class="filter-search">
        <Icon icon="ri-search-line" :size="14" />
        <input v-model="keyword" placeholder="搜索名称、描述或 Key..." @input="onSearch" />
      </div>
      <button class="btn btn-ghost" @click="loadAll">
        <Icon icon="ri-refresh-line" :size="14" />
        刷新
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      <Icon icon="ri-loader-4-line" :size="24" class="spin" />
      <span>加载中...</span>
    </div>

    <div v-else-if="currentList.length === 0" class="empty-state">
      <Icon icon="ri-inbox-line" :size="48" />
      <p>{{ emptyText }}</p>
    </div>

    <!-- 统一卡片列表 -->
    <div v-else class="cards-grid">
      <template v-for="item in currentList" :key="(item._type || activeCategory) + '-' + item.id">
        <!-- 应用卡片 -->
        <div v-if="item._type === 'app' || activeCategory === 'apps'" class="item-card">
          <div class="card-head">
            <div class="item-icon" :class="item.is_official ? 'official' : ''" :style="{ background: getCatColor(item.category) }">
              <Icon icon="ri-apps-2-line" :size="20" />
            </div>
            <div class="head-meta">
              <div class="head-title">
                <span class="item-name">{{ item.name }}</span>
                <span v-if="item.is_official" class="official-badge" title="官方项目">
                  <Icon icon="ri-verified-badge-fill" :size="14" />
                </span>
                <span class="status-pill" :class="item.status">{{ getStatusLabel(item.status) }}</span>
              </div>
              <div class="head-sub">
                <code>{{ item.app_key }}</code>
                <span class="meta-tag">{{ item.category || '通用' }}</span>
                <span class="meta-tag">v{{ item.version }}</span>
              </div>
            </div>
          </div>
          <div class="card-desc">{{ item.description || '暂无描述' }}</div>
          <div class="card-foot">
            <div class="author">
              <Icon icon="ri-user-3-line" :size="12" />
              <span>{{ item.developer_username }}</span>
              <span v-if="item.forked_by" class="fork-from">
                <Icon icon="ri-git-branch-line" :size="10" />
                Fork: {{ item.forked_by }}
              </span>
            </div>
            <div class="actions">
              <button class="btn-sm" @click="viewAppDetail(item)" title="查看详情">
                <Icon icon="ri-eye-line" :size="12" />
                查看
              </button>
              <button class="btn-sm primary" @click="forkApp(item)" :disabled="busy">
                <Icon icon="ri-git-branch-line" :size="12" />
                Fork
              </button>
            </div>
          </div>
        </div>

        <!-- 插件卡片 -->
        <div v-else-if="item._type === 'plugin' || activeCategory === 'plugins'" class="item-card">
          <div class="card-head">
            <div class="item-icon" :class="item.is_official ? 'official' : ''" style="background: rgba(120, 90, 240, 0.1); color: #785AF0;">
              <Icon :icon="item.icon || 'ri-plug-line'" :size="20" />
            </div>
            <div class="head-meta">
              <div class="head-title">
                <span class="item-name">{{ item.name }}</span>
                <span v-if="item.is_official" class="official-badge" title="官方插件">
                  <Icon icon="ri-verified-badge-fill" :size="14" />
                </span>
                <span class="status-pill published">已发布</span>
              </div>
              <div class="head-sub">
                <code>{{ item.plugin_key }}</code>
                <span v-for="ext in item.extensions" :key="ext" class="ext-tag">.{{ ext }}</span>
                <span class="meta-tag">v{{ item.version }}</span>
              </div>
            </div>
          </div>
          <div class="card-desc">{{ item.description || '暂无描述' }}</div>
          <div class="card-foot">
            <div class="author">
              <Icon icon="ri-user-3-line" :size="12" />
              <span>{{ item.developer_username }}</span>
            </div>
            <div class="actions">
              <button class="btn-sm" @click="viewPluginDetail(item)" title="查看详情">
                <Icon icon="ri-eye-line" :size="12" />
                查看
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { devApi } from '../../api';

const router = useRouter();

const loading = ref(false);
const busy = ref(false);
const appsList = ref<any[]>([]);
const pluginsList = ref<any[]>([]);
const keyword = ref('');
let searchTimer: any = null;

const categoryTabs = [
  { key: 'all', label: '全部', icon: 'ri-apps-2-line' },
  { key: 'apps', label: '应用', icon: 'ri-apps-2-line' },
  { key: 'plugins', label: '插件', icon: 'ri-plug-line' },
];

const activeCategory = ref('all');

const currentList = computed(() => {
  if (activeCategory.value === 'apps') return appsList.value;
  if (activeCategory.value === 'plugins') return pluginsList.value;
  // 'all' - merge both
  const apps = appsList.value.map(a => ({ ...a, _type: 'app' }));
  const plugins = pluginsList.value.map(p => ({ ...p, _type: 'plugin' }));
  // Sort: official first, then by updated_at
  return [...apps, ...plugins].sort((a, b) => {
    if (a.is_official !== b.is_official) return b.is_official - a.is_official;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });
});

const emptyText = computed(() => {
  if (activeCategory.value === 'apps') return '暂无共享应用';
  if (activeCategory.value === 'plugins') return '暂无共享插件';
  return '暂无共享项目';
});

function getCategoryCount(key: string): number {
  if (key === 'apps') return appsList.value.length;
  if (key === 'plugins') return pluginsList.value.length;
  return appsList.value.length + pluginsList.value.length;
}

async function loadApps() {
  try {
    appsList.value = await devApi.sharedList(keyword.value || undefined);
  } catch (e: any) {
    console.error('加载共享应用失败', e);
  }
}

async function loadPlugins() {
  try {
    pluginsList.value = await devApi.pluginSharedList(keyword.value || undefined);
  } catch (e: any) {
    console.error('加载共享插件失败', e);
  }
}

async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([loadApps(), loadPlugins()]);
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadAll(), 300);
}

function getStatusLabel(status?: string): string {
  const labels: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };
  return labels[status || ''] || status || '';
}

function getCatColor(category?: string): string {
  const c = (category || '').toLowerCase();
  if (c.includes('教学')) return 'rgba(0, 103, 192, 0.1)';
  if (c.includes('评测')) return 'rgba(202, 143, 4, 0.1)';
  if (c.includes('ai')) return 'rgba(120, 90, 240, 0.1)';
  return 'rgba(16, 124, 16, 0.1)';
}

function formatJson(obj: any): string {
  if (!obj) return '// 空';
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

async function viewAppDetail(app: any) {
  // 导航到只读编辑器页面
  router.push(`/console/developer/apps/${app.id}/edit?readonly=1`);
}

function viewPluginDetail(plugin: any) {
  // 插件详情：跳转到插件编辑器（只读模式）
  router.push(`/console/developer/plugins/${plugin.id}/edit`);
}

async function forkApp(app: any) {
  if (!app) return;
  if (!confirm(`确认 Fork 应用「${app.name}」到我的应用列表？\n\nFork 后可在「我的应用」中修改和发布。`)) return;
  busy.value = true;
  try {
    const res = await devApi.forkApp(app.id);
    alert(`已 Fork 到我的应用，新 app_key: ${res.app_key}`);
    detailVisible.value = false;
    router.push(`/console/developer/apps/${res.id}/edit`);
  } catch (e: any) {
    alert(e.message || 'Fork 失败');
  } finally {
    busy.value = false;
  }
}

function goBack() {
  router.push('/console/developer');
}

onMounted(() => {
  loadAll();
});
</script>

<style scoped>
.shared-market {
  padding: var(--spacer-5);
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-4);
  gap: var(--spacer-3);
  flex-wrap: wrap;
}

.page-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-2xl);
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
  border: none;
  transition: background var(--fast-duration);
}

.btn-ghost { background: var(--subtle-secondary); color: var(--text-secondary); }
.btn-ghost:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.btn-primary { background: var(--accent-base); color: white; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* 分类标签 */
.category-tabs {
  display: flex;
  gap: var(--spacer-1);
  margin-bottom: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-1);
  width: fit-content;
}

.cat-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.cat-tab:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.cat-tab.active {
  background: var(--accent-base);
  color: var(--accent-text);
}

.cat-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  border-radius: var(--radius-full);
}

.cat-tab.active .cat-count {
  background: var(--accent-text);
  color: var(--accent-base);
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacer-4);
  gap: var(--spacer-2);
  flex-wrap: wrap;
}

.filter-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 400px;
}

.filter-search > :first-child {
  position: absolute;
  left: var(--spacer-3);
  color: var(--text-tertiary);
  pointer-events: none;
}

.filter-search input {
  width: 100%;
  height: 36px;
  padding: 0 var(--spacer-3) 0 calc(var(--spacer-3) + 20px);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
}

.filter-search input:focus { border-color: var(--accent-base); }

.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-12);
  color: var(--text-tertiary);
}

.empty-state p { font-size: var(--font-size-sm); margin: 0; }

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--spacer-3);
}

.item-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-3);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  transition: box-shadow var(--fast-duration);
}

.item-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }

.card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
}

.item-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--accent-base);
  position: relative;
}

.item-icon.official {
  box-shadow: 0 0 0 2px var(--accent-base);
}

.head-meta { flex: 1; min-width: 0; }

.head-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.item-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.official-badge {
  display: inline-flex;
  color: var(--accent-base);
  flex-shrink: 0;
}

.status-pill {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
}

.status-pill.draft { background: rgba(202, 143, 4, 0.1); color: #CA8F04; }
.status-pill.published { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.status-pill.archived { background: rgba(0,0,0,0.08); color: var(--text-tertiary); }

.head-sub {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 4px;
  flex-wrap: wrap;
}

.head-sub code {
  font-family: var(--font-mono, monospace);
  background: var(--subtle-secondary);
  padding: 0 4px;
  border-radius: var(--radius-xs);
}

.meta-tag, .ext-tag {
  padding: 0 4px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-xs);
}

.ext-tag {
  font-family: var(--font-mono, monospace);
}

.card-desc {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  line-height: 1.5;
  min-height: 32px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacer-2);
  padding-top: var(--spacer-2);
  border-top: 1px solid var(--divider-stroke);
}

.author {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-tertiary);
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.fork-from {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--text-tertiary);
}

.actions {
  display: flex;
  gap: var(--spacer-1);
  flex-shrink: 0;
}

.btn-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
}

.btn-sm:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.btn-sm.primary { background: var(--accent-base); color: white; border-color: var(--accent-base); }
.btn-sm.primary:hover { background: var(--accent-hover); }
.btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }

/* 详情对话框 */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-4);
}

.dialog {
  width: 100%;
  max-width: 800px;
  max-height: 90vh;
  background: var(--flyout-bg, var(--card-bg));
  backdrop-filter: var(--flyout-backdrop, none);
  border: 1px solid var(--flyout-border, var(--card-stroke));
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-4) var(--spacer-5);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.dialog-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.dialog-close:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.dialog-body {
  padding: var(--spacer-4) var(--spacer-5);
  overflow-y: auto;
  flex: 1;
}

.detail-section {
  margin-bottom: var(--spacer-4);
}

.detail-section h4 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-1);
}

.detail-section h5 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 var(--spacer-1);
}

.detail-desc {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin: 0 0 var(--spacer-2);
  line-height: 1.5;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.detail-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.detail-meta code {
  font-family: var(--font-mono, monospace);
  background: var(--subtle-secondary);
  padding: 0 4px;
  border-radius: var(--radius-xs);
}

.code-block {
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-2) var(--spacer-3);
  font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  margin: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4) var(--spacer-5);
  border-top: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>