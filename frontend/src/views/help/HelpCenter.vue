<template>
  <div class="doc-center">
    <!-- 顶部：标题 + 搜索 -->
    <header class="doc-header">
      <div class="doc-header-left">
        <h1 class="doc-title">文档中心</h1>
        <p class="doc-subtitle">帮助文档与使用教程</p>
      </div>
      <div class="doc-search">
        <Icon icon="ri-search-line" :size="15" class="doc-search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索文档..."
          aria-label="搜索帮助文档"
          @input="onSearchInput"
        />
        <button v-if="searchQuery" class="doc-search-clear" @click="clearSearch" title="清除">
          <Icon icon="ri-close-line" :size="14" />
        </button>
      </div>
    </header>

    <div class="doc-body">
      <!-- 左栏：双级目录 -->
      <aside class="doc-sidebar">
        <!-- 二级视图：上方返回一级目录 -->
        <div v-if="activeCategory" class="doc-sidebar-back">
          <button class="doc-back-btn" @click="goBackToCategories">
            <Icon icon="ri-arrow-left-s-line" :size="16" />
            <span>返回目录</span>
          </button>
        </div>

        <!-- 一级目录（大） -->
        <nav v-if="!activeCategory" class="doc-nav">
          <div class="doc-nav-title">目录</div>
          <button
            v-for="cat in filteredCategories"
            :key="cat.id"
            class="doc-nav-item level-1"
            @click="selectCategory(cat)"
          >
            <span class="doc-nav-icon"><Icon :icon="cat.icon || 'ri-article-line'" :size="18" /></span>
            <span class="doc-nav-label">{{ cat.title }}</span>
            <span class="doc-nav-count">{{ cat.article_count }}</span>
          </button>
          <div v-if="filteredCategories.length === 0" class="doc-nav-empty">
            <Icon icon="ri-search-line" :size="20" />
            <span>未找到匹配的目录</span>
          </div>
        </nav>

        <!-- 二级文章（小） -->
        <nav v-else class="doc-nav">
          <div class="doc-nav-current">
            <span class="doc-nav-icon"><Icon :icon="activeCategory.icon || 'ri-article-line'" :size="18" /></span>
            <span class="doc-nav-label">{{ activeCategory.title }}</span>
          </div>
          <div class="doc-nav-divider"></div>
          <button
            v-for="art in filteredArticles"
            :key="art.id"
            class="doc-nav-item level-2"
            :class="{ active: activeArticle && activeArticle.id === art.id }"
            @click="selectArticle(art)"
          >
            <Icon icon="ri-file-text-line" :size="13" class="doc-nav-file-icon" />
            <span class="doc-nav-label">{{ art.title }}</span>
          </button>
          <div v-if="filteredArticles.length === 0" class="doc-nav-empty">
            <Icon icon="ri-search-line" :size="20" />
            <span>未找到匹配的文章</span>
          </div>
        </nav>
      </aside>

      <!-- 主内容区 -->
      <main class="doc-content">
        <!-- 未选择目录：欢迎 + 分类卡片 -->
        <template v-if="!activeCategory">
          <div class="doc-hero">
            <h2>欢迎使用 CSES Cloud 智教云</h2>
            <p>这里汇集了平台的使用指南与常见问题，帮助你快速上手</p>
          </div>
          <div v-if="filteredCategories.length === 0" class="doc-empty">
            <Icon icon="ri-book-open-line" :size="48" />
            <p>暂无帮助文档</p>
            <span>请稍后再来查看，或联系管理员获取帮助</span>
          </div>
          <div v-else class="doc-cards">
            <button
              v-for="cat in filteredCategories"
              :key="cat.id"
              class="doc-card"
              @click="selectCategory(cat)"
            >
              <span class="doc-card-icon"><Icon :icon="cat.icon || 'ri-article-line'" :size="26" /></span>
              <div class="doc-card-info">
                <div class="doc-card-title">{{ cat.title }}</div>
                <div class="doc-card-summary">{{ cat.summary || '查看该分类下的文档' }}</div>
                <div class="doc-card-count">{{ cat.article_count }} 篇文章</div>
              </div>
              <Icon icon="ri-arrow-right-s-line" :size="20" class="doc-card-arrow" />
            </button>
          </div>
        </template>

        <!-- 已选目录但未选文章：目录简介 + 文章列表 -->
        <template v-else-if="!activeArticle">
          <div class="doc-category-hero">
            <span class="doc-category-icon"><Icon :icon="activeCategory.icon || 'ri-article-line'" :size="28" /></span>
            <div>
              <h2>{{ activeCategory.title }}</h2>
              <p>{{ activeCategory.summary || '选择下方文章查看详细内容' }}</p>
            </div>
          </div>
          <div v-if="filteredArticles.length === 0" class="doc-empty">
            <Icon icon="ri-file-text-line" :size="40" />
            <p>该分类下暂无文章</p>
          </div>
          <div v-else class="doc-article-list">
            <button
              v-for="art in filteredArticles"
              :key="art.id"
              class="doc-article-item"
              @click="selectArticle(art)"
            >
              <Icon icon="ri-file-text-line" :size="18" class="doc-article-icon" />
              <span class="doc-article-title">{{ art.title }}</span>
              <Icon icon="ri-arrow-right-s-line" :size="18" class="doc-article-arrow" />
            </button>
          </div>
        </template>

        <!-- 文章内容 -->
        <template v-else>
          <div class="doc-breadcrumb">
            <button class="doc-breadcrumb-link" @click="goBackToCategories">文档中心</button>
            <Icon icon="ri-arrow-right-s-line" :size="14" class="doc-breadcrumb-sep" />
            <button class="doc-breadcrumb-link" @click="selectCategory(activeCategory)">{{ activeCategory.title }}</button>
            <Icon icon="ri-arrow-right-s-line" :size="14" class="doc-breadcrumb-sep" />
            <span class="doc-breadcrumb-current">{{ activeArticle.title }}</span>
          </div>

          <div v-if="articleLoading" class="doc-article-loading">
            <Icon icon="ri-loader-4-line" :size="24" class="spin" />
            <span>加载中...</span>
          </div>

          <article v-else class="doc-article">
            <h1 class="doc-article-heading">{{ activeArticle.title }}</h1>
            <div v-if="activeArticle.updated_at" class="doc-article-meta">
              更新于 {{ String(activeArticle.updated_at).slice(0, 10) }}
            </div>
            <div v-if="activeArticle.content" class="doc-article-body" v-html="renderedContent"></div>
            <div v-else class="doc-article-empty">该文章暂无内容</div>
            <div class="doc-article-footer">
              <span class="doc-feedback-label">这篇文章对你有帮助吗？</span>
              <button class="doc-feedback-btn" @click="feedback = true" :disabled="feedback">
                <Icon icon="ri-thumb-up-line" :size="14" />
                {{ feedback ? '感谢反馈' : '有帮助' }}
              </button>
            </div>
          </article>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { marked } from 'marked';
import { helpApi } from '../../api';

marked.use({ breaks: true, gfm: true });

interface HelpCategory {
  id: number;
  title: string;
  summary: string;
  icon: string;
  article_count: number;
  articles: { id: number; title: string; sort_order: number }[];
}

const route = useRoute();
const router = useRouter();

const searchQuery = ref('');
const categories = ref<HelpCategory[]>([]);
const loading = ref(true);
const articleLoading = ref(false);
const activeCategory = ref<HelpCategory | null>(null);
const activeArticle = ref<any>(null);
const feedback = ref(false);

// 搜索过滤：一级视图过滤目录，二级视图过滤文章
const filteredCategories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return categories.value;
  return categories.value.filter(c =>
    c.title.toLowerCase().includes(q) ||
    (c.summary || '').toLowerCase().includes(q)
  );
});

const filteredArticles = computed(() => {
  if (!activeCategory.value) return [];
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return activeCategory.value.articles;
  return activeCategory.value.articles.filter(a => a.title.toLowerCase().includes(q));
});

const renderedContent = computed(() => {
  const c = activeArticle.value?.content || '';
  return marked.parse(c, { breaks: true, gfm: true }) as string;
});

async function loadTree() {
  loading.value = true;
  try {
    categories.value = await helpApi.tree();
  } catch (e: any) {
    categories.value = [];
    console.error('加载帮助文档失败:', e);
  } finally {
    loading.value = false;
  }
}

function selectCategory(cat: HelpCategory, syncUrl = true) {
  activeCategory.value = cat;
  activeArticle.value = null;
  feedback.value = false;
  if (syncUrl) syncDocQuery();
}

function goBackToCategories() {
  activeCategory.value = null;
  activeArticle.value = null;
  feedback.value = false;
  syncDocQuery();
}

async function selectArticle(art: { id: number; title: string }, syncUrl = true) {
  activeArticle.value = { id: art.id, title: art.title, content: '', updated_at: '' };
  articleLoading.value = true;
  feedback.value = false;
  if (syncUrl) syncDocQuery();
  try {
    const detail = await helpApi.get(art.id);
    activeArticle.value = { ...detail };
  } catch (e: any) {
    activeArticle.value = { id: art.id, title: art.title, content: '', updated_at: '' };
    console.error('加载文章失败:', e);
  } finally {
    articleLoading.value = false;
  }
}

/* ===== URL 深链（?doc=<id> / ?q=<关键词>） ===== */

function queryText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : '';
  return typeof value === 'string' ? value : '';
}

function queryDocId(): number {
  const id = Number.parseInt(queryText(route.query.doc), 10);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

// 当前展示节点的 ID（文章优先，其次一级目录），用于同步 ?doc=
function currentDocId(): number {
  const articleId = Number(activeArticle.value?.id);
  if (Number.isFinite(articleId) && articleId > 0) return articleId;
  const categoryId = Number(activeCategory.value?.id);
  return Number.isFinite(categoryId) && categoryId > 0 ? categoryId : 0;
}

// 把当前打开的分类/文章写回 URL，保证刷新与复制链接都能还原
function syncDocQuery() {
  const target = currentDocId();
  if (queryDocId() === target) return;
  const nextQuery = { ...route.query };
  if (target) nextQuery.doc = String(target);
  else delete nextQuery.doc;
  router.replace({ path: route.path, query: nextQuery }).catch(() => {
    // 重复导航等错误无需提示
  });
}

// 按 ID 打开文档：先按文章 ID 匹配，未命中再回退为一级目录 ID
function openDocById(id: number): boolean {
  if (!id) return false;
  for (const cat of categories.value) {
    const article = (cat.articles || []).find((item) => item.id === id);
    if (article) {
      if (Number(activeArticle.value?.id) === id) return true;
      selectCategory(cat, false);
      selectArticle(article, false);
      return true;
    }
  }
  const category = categories.value.find((cat) => cat.id === id);
  if (category) {
    const alreadyOpen = activeCategory.value?.id === category.id && !activeArticle.value;
    if (!alreadyOpen) selectCategory(category, false);
    return true;
  }
  return false;
}

// 读取路由上的 q / doc 查询参数（直接访问与刷新都会走到这里）
function applyRouteQuery() {
  const keyword = queryText(route.query.q);
  if (keyword && keyword !== searchQuery.value) searchQuery.value = keyword;
  const docId = queryDocId();
  if (docId && !openDocById(docId)) {
    console.warn(`[HelpCenter] 未找到 doc=${docId} 对应的帮助文档`);
  }
}

// 手动输入搜索词时回到列表视图，避免文章内容与筛选结果不一致
function onSearchInput() {
  if (activeCategory.value && activeArticle.value) {
    activeArticle.value = null;
    syncDocQuery();
  }
}

function clearSearch() {
  searchQuery.value = '';
  if (activeCategory.value) {
    activeArticle.value = null;
    syncDocQuery();
  }
}

// 顶栏搜索在帮助页内跳转时只有 query 变化，同样要打开对应文档
watch(
  () => route.query.doc,
  () => {
    if (!categories.value.length) return;
    const docId = queryDocId();
    if (docId) {
      openDocById(docId);
      return;
    }
    // doc 被移除（例如从顶栏跳到帮助首页）时回到目录视图
    if (activeArticle.value || activeCategory.value) {
      activeArticle.value = null;
      activeCategory.value = null;
      feedback.value = false;
    }
  }
);

watch(
  () => route.query.q,
  (value) => {
    const keyword = queryText(value);
    if (keyword !== searchQuery.value) searchQuery.value = keyword;
  }
);

onMounted(async () => {
  await loadTree();
  applyRouteQuery();
});
</script>

<style scoped>
.doc-center {
  padding: var(--spacer-5);
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
  min-height: 100%;
}

/* ===== 顶部 ===== */
.doc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacer-4);
  padding: var(--spacer-2) 0;
  flex-wrap: wrap;
}

.doc-header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.doc-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
}

.doc-search {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 320px;
  max-width: 100%;
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-full);
  transition: border-color var(--fast-duration);
}

.doc-search:focus-within {
  border-color: var(--accent-base);
}

.doc-search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.doc-search input {
  flex: 1;
  min-width: 0;
  height: 30px;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-family: var(--font-family);
}

.doc-search input::placeholder {
  color: var(--text-tertiary);
}

.doc-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: var(--radius-full);
  cursor: pointer;
  flex-shrink: 0;
}

.doc-search-clear:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

/* ===== 主体布局 ===== */
.doc-body {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-4);
  flex: 1;
  min-height: 0;
}

/* ===== 左栏 ===== */
.doc-sidebar {
  width: 280px;
  flex-shrink: 0;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-3);
  position: sticky;
  top: 0;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.doc-sidebar-back {
  margin-bottom: var(--spacer-2);
}

.doc-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px var(--spacer-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--accent-base);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.doc-back-btn:hover {
  background: var(--subtle-secondary);
}

.doc-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-nav-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: var(--spacer-1) var(--spacer-2);
  margin-bottom: var(--spacer-1);
}

/* 一级目录：大 */
.doc-nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background var(--fast-duration), color var(--fast-duration);
  padding: var(--spacer-2);
}

.doc-nav-item.level-1 {
  padding: var(--spacer-3) var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.doc-nav-item.level-1:hover,
.doc-nav-item.level-1.active {
  background: var(--subtle-secondary);
}

.doc-nav-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  color: var(--accent-base);
  font-size: 18px;
}

.doc-nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-nav-count {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  font-weight: 400;
}

/* 二级文章：小 */
.doc-nav-current {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.doc-nav-divider {
  height: 1px;
  background: var(--divider-stroke);
  margin: var(--spacer-1) 0 var(--spacer-2);
}

.doc-nav-item.level-2 {
  padding: var(--spacer-2);
  padding-left: var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-secondary);
}

.doc-nav-item.level-2:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.doc-nav-item.level-2.active {
  background: var(--subtle-secondary);
  color: var(--accent-base);
  font-weight: 600;
}

.doc-nav-file-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.doc-nav-item.level-2.active .doc-nav-file-icon {
  color: var(--accent-base);
}

.doc-nav-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-8) var(--spacer-2);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

/* ===== 主内容区 ===== */
.doc-content {
  flex: 1;
  min-width: 0;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-6);
}

/* 欢迎页 */
.doc-hero {
  padding: var(--spacer-5) var(--spacer-4);
  margin-bottom: var(--spacer-5);
  background: var(--subtle-secondary);
  border-radius: var(--radius-lg);
}

.doc-hero h2 {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.doc-hero p {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
}

.doc-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacer-3);
}

.doc-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: border-color var(--fast-duration), box-shadow var(--fast-duration), transform var(--fast-duration);
}

.doc-card:hover {
  border-color: var(--accent-base);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

.doc-card-icon {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  color: var(--accent-base);
  font-size: 26px;
}

.doc-card-info {
  flex: 1;
  min-width: 0;
}

.doc-card-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.doc-card-summary {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-card-count {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 6px;
}

.doc-card-arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* 分类落地页 */
.doc-category-hero {
  display: flex;
  align-items: center;
  gap: var(--spacer-4);
  padding: var(--spacer-4);
  margin-bottom: var(--spacer-5);
  background: var(--subtle-secondary);
  border-radius: var(--radius-lg);
}

.doc-category-icon {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card-bg);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  color: var(--accent-base);
  font-size: 28px;
}

.doc-category-hero h2 {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-1);
}

.doc-category-hero p {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
}

.doc-article-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.doc-article-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3) var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: border-color var(--fast-duration), background var(--fast-duration);
}

.doc-article-item:hover {
  border-color: var(--accent-base);
  background: var(--subtle-secondary);
}

.doc-article-icon {
  color: var(--accent-base);
  flex-shrink: 0;
}

.doc-article-title {
  flex: 1;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.doc-article-arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* 文章页 */
.doc-breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: var(--spacer-4);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  flex-wrap: wrap;
}

.doc-breadcrumb-link {
  background: transparent;
  border: none;
  padding: 2px 4px;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-xs);
  border-radius: var(--radius-xs);
  transition: color var(--fast-duration);
}

.doc-breadcrumb-link:hover {
  color: var(--accent-base);
}

.doc-breadcrumb-sep {
  flex-shrink: 0;
}

.doc-breadcrumb-current {
  color: var(--text-primary);
  font-weight: 500;
  padding: 2px 4px;
}

.doc-article-heading {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
  line-height: 1.4;
}

.doc-article-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding-bottom: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  margin-bottom: var(--spacer-5);
}

.doc-article-body {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  line-height: 1.8;
}

.doc-article-body :deep(h1),
.doc-article-body :deep(h2),
.doc-article-body :deep(h3),
.doc-article-body :deep(h4) {
  color: var(--text-primary);
  font-weight: 700;
  margin: 1.6em 0 0.6em;
  line-height: 1.4;
}

.doc-article-body :deep(h1) { font-size: 1.6em; }
.doc-article-body :deep(h2) { font-size: 1.4em; }
.doc-article-body :deep(h3) { font-size: 1.2em; }
.doc-article-body :deep(h4) { font-size: 1.05em; }

.doc-article-body :deep(h1:first-child),
.doc-article-body :deep(h2:first-child),
.doc-article-body :deep(h3:first-child),
.doc-article-body :deep(h4:first-child) {
  margin-top: 0;
}

.doc-article-body :deep(p) {
  margin: 0.8em 0;
}

.doc-article-body :deep(ul),
.doc-article-body :deep(ol) {
  padding-left: 1.6em;
  margin: 0.8em 0;
}

.doc-article-body :deep(li) {
  margin: 0.3em 0;
}

.doc-article-body :deep(a) {
  color: var(--accent-base);
  text-decoration: none;
}

.doc-article-body :deep(a:hover) {
  text-decoration: underline;
}

.doc-article-body :deep(blockquote) {
  margin: 1em 0;
  padding: 0.6em 1em;
  border-left: 3px solid var(--accent-base);
  background: var(--subtle-secondary);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text-secondary);
}

.doc-article-body :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  background: var(--subtle-secondary);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  color: var(--text-primary);
}

.doc-article-body :deep(pre) {
  background: var(--app-bg);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-3);
  overflow-x: auto;
  margin: 1em 0;
}

.doc-article-body :deep(pre code) {
  background: transparent;
  padding: 0;
}

.doc-article-body :deep(table) {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}

.doc-article-body :deep(th),
.doc-article-body :deep(td) {
  border: 1px solid var(--divider-stroke);
  padding: 0.5em 0.8em;
  text-align: left;
}

.doc-article-body :deep(th) {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  font-weight: 600;
}

.doc-article-body :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-md);
}

.doc-article-empty {
  padding: var(--spacer-8);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.doc-article-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-12);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.doc-article-footer {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  margin-top: var(--spacer-8);
  padding-top: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.doc-feedback-label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.doc-feedback-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.doc-feedback-btn:hover:not(:disabled) {
  background: var(--accent-base);
  color: var(--accent-text);
  border-color: var(--accent-base);
}

.doc-feedback-btn:disabled {
  color: #107C10;
  border-color: rgba(16, 124, 16, 0.3);
  background: rgba(16, 124, 16, 0.08);
  cursor: default;
}

.doc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-12);
  color: var(--text-tertiary);
}

.doc-empty p {
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.doc-empty span {
  font-size: var(--font-size-xs);
}

@media (max-width: 860px) {
  .doc-body {
    flex-direction: column;
  }

  .doc-sidebar {
    width: 100%;
    position: static;
    max-height: none;
  }
}
</style>
