<template>
  <div class="instance-overview">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">实例概览</h1>
        <p class="page-description">云端实例整体状态 · 快速创建与最近实例</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-ghost" @click="goList">
          <Icon icon="ri-list-check" :size="14" />
          <span>查看全部实例</span>
        </button>
        <button class="btn btn-primary" @click="goCreate">
          <Icon icon="ri-add-line" :size="14" />
          <span>新建实例</span>
        </button>
      </div>
    </div>

    <!-- 概览统计卡片 -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(0,103,192,0.1); color: var(--accent-base);">
          <Icon icon="ri-cloud-line" :size="28" />
        </div>
        <div class="metric-meta">
          <div class="metric-value">{{ stats.total }}</div>
          <div class="metric-label">实例总数</div>
        </div>
        <div class="metric-trend">
          <Icon icon="ri-arrow-up-line" :size="12" />
          <span>{{ stats.owned }} 自有</span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(16,124,16,0.1); color: var(--status-success);">
          <Icon icon="ri-play-circle-line" :size="28" />
        </div>
        <div class="metric-meta">
          <div class="metric-value">{{ stats.running }}</div>
          <div class="metric-label">运行中</div>
        </div>
        <div class="metric-trend">
          <span class="dot dot-success"></span>
          <span>{{ stats.total > 0 ? Math.round(stats.running / stats.total * 100) : 0 }}% 在线</span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(196,43,28,0.1); color: var(--status-error);">
          <Icon icon="ri-pause-circle-line" :size="28" />
        </div>
        <div class="metric-meta">
          <div class="metric-value">{{ stats.stopped }}</div>
          <div class="metric-label">已停止</div>
        </div>
        <div class="metric-trend">
          <span class="dot dot-error"></span>
          <span>需要关注</span>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(120,90,240,0.1); color: #785AF0;">
          <Icon icon="ri-folder-line" :size="28" />
        </div>
        <div class="metric-meta">
          <div class="metric-value">{{ stats.groups }}</div>
          <div class="metric-label">实例分组</div>
        </div>
        <div class="metric-trend">
          <Icon icon="ri-share-line" :size="12" />
          <span>{{ stats.shared }} 共享给我</span>
        </div>
      </div>
    </div>

    <!-- 主体两栏 -->
    <div class="overview-body">
      <!-- 左：最近实例 -->
      <div class="overview-section">
        <div class="section-header">
          <h2 class="section-title">
            <Icon icon="ri-history-line" :size="16" />
            <span>最近实例</span>
          </h2>
          <button class="link-btn" @click="goList">
            查看全部
            <Icon icon="ri-arrow-right-s-line" :size="14" />
          </button>
        </div>

        <div v-if="loading" class="loading-state">
          <Icon icon="ri-loader-4-line" :size="24" class="spin" />
          <span>加载中...</span>
        </div>

        <div v-else-if="recentInstances.length === 0" class="empty-state">
          <div class="empty-icon"><Icon icon="ri-cloud-off-line" :size="48" /></div>
          <div class="empty-text">暂无可见实例</div>
          <div class="empty-sub">点击「新建实例」开始创建你的第一个实例</div>
          <button class="btn btn-primary" @click="goCreate">
            <Icon icon="ri-add-line" :size="14" />
            <span>新建实例</span>
          </button>
        </div>

        <div v-else class="recent-list">
          <div
            v-for="inst in recentInstances"
            :key="inst.id"
            class="recent-item"
            @click="enterEditor(inst)"
          >
            <div class="recent-icon" :class="inst.status">
              <Icon :icon="inst.status === 'running' ? 'ri-play-circle-fill' : 'ri-pause-circle-fill'" :size="22" />
            </div>
            <div class="recent-meta">
              <div class="recent-name">
                {{ inst.name }}
                <span v-if="inst.relation === 'shared'" class="relation-tag shared">
                  <Icon icon="ri-share-line" :size="10" /> 共享
                </span>
                <span v-else-if="inst.relation === 'owned'" class="relation-tag owned">自有</span>
              </div>
              <div class="recent-sub">
                <span v-if="inst.app_name">{{ inst.app_name }}</span>
                <span v-else>{{ inst.service_type || '通用服务' }}</span>
                <span class="sep">·</span>
                <span v-if="inst.group_name" class="group-chip">
                  <Icon icon="ri-folder-line" :size="10" /> {{ inst.group_name }}
                </span>
                <span v-else class="group-chip muted">未分组</span>
              </div>
            </div>
            <div class="recent-time">
              <Icon icon="ri-time-line" :size="12" />
              <span>{{ formatTime(inst.created_at) }}</span>
            </div>
            <button class="recent-action" title="进入编辑器" @click.stop="enterEditor(inst)">
              <Icon icon="ri-arrow-right-s-line" :size="18" />
            </button>
          </div>
        </div>
      </div>

      <!-- 右：快捷操作 + 应用清单 -->
      <div class="overview-side">
        <!-- 快捷操作 -->
        <div class="side-card">
          <h3 class="side-title">
            <Icon icon="ri-flashlight-line" :size="14" />
            <span>快捷操作</span>
          </h3>
          <div class="quick-actions">
            <button class="quick-action" @click="goCreate">
              <div class="qa-icon" style="background: rgba(0,103,192,0.1); color: var(--accent-base);">
                <Icon icon="ri-add-line" :size="22" />
              </div>
              <div class="qa-meta">
                <div class="qa-title">新建实例</div>
                <div class="qa-sub">基于已发布应用创建</div>
              </div>
            </button>
            <button class="quick-action" @click="goList">
              <div class="qa-icon" style="background: rgba(16,124,16,0.1); color: var(--status-success);">
                <Icon icon="ri-list-check" :size="22" />
              </div>
              <div class="qa-meta">
                <div class="qa-title">实例列表</div>
                <div class="qa-sub">查看、分组与批量操作</div>
              </div>
            </button>
            <button class="quick-action" @click="goDevMarket">
              <div class="qa-icon" style="background: rgba(120,90,240,0.1); color: #785AF0;">
                <Icon icon="ri-share-circle-line" :size="22" />
              </div>
              <div class="qa-meta">
                <div class="qa-title">应用市场</div>
                <div class="qa-sub">浏览开发者共享应用</div>
              </div>
            </button>
            <button class="quick-action" @click="openAi">
              <div class="qa-icon" style="background: rgba(204,102,40,0.1); color: var(--status-warning);">
                <Icon icon="ri-brain-line" :size="22" />
              </div>
              <div class="qa-meta">
                <div class="qa-title">询问 AI 助理</div>
                <div class="qa-sub">实例使用与配置建议</div>
              </div>
            </button>
          </div>
        </div>

        <!-- 应用类型分布 -->
        <div class="side-card">
          <h3 class="side-title">
            <Icon icon="ri-pie-chart-line" :size="14" />
            <span>应用类型分布</span>
          </h3>
          <div v-if="categoryStats.length === 0" class="side-empty">暂无实例数据</div>
          <div v-else class="category-list">
            <div v-for="cat in categoryStats" :key="cat.name" class="category-item">
              <div class="cat-info">
                <span class="cat-name">{{ cat.name }}</span>
                <span class="cat-count">{{ cat.count }} 个</span>
              </div>
              <div class="cat-bar">
                <div
                  class="cat-bar-fill"
                  :style="{ width: (stats.total > 0 ? (cat.count / stats.total * 100) : 0) + '%', background: cat.color }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 实例 ID 提示 -->
        <div class="side-card side-hint">
          <div class="hint-icon">
            <Icon icon="ri-information-line" :size="20" />
          </div>
          <div class="hint-content">
            <div class="hint-title">实例子用户登录</div>
            <div class="hint-desc">
              在登录页选择「实例子用户」并输入实例 ID 即可仅访问该实例；登录后可在登录页选择保留以便下次直接登录。
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { instancesApi, groupsApi } from '../../api';

const router = useRouter();

const loading = ref(false);
const instances = ref<any[]>([]);
const groups = ref<any[]>([]);

const stats = computed(() => {
  const total = instances.value.length;
  const running = instances.value.filter(i => i.status === 'running').length;
  const stopped = instances.value.filter(i => i.status === 'stopped').length;
  const owned = instances.value.filter(i => i.relation !== 'shared').length;
  const shared = instances.value.filter(i => i.relation === 'shared').length;
  return { total, running, stopped, owned, shared, groups: groups.value.length };
});

// 应用类型分布（按 app_category 或 service_type 聚合）
const categoryColors = ['#0067C0', '#107C10', '#785AF0', '#CC6628', '#C42B1C', '#038387'];
const categoryStats = computed(() => {
  const map: Record<string, number> = {};
  for (const inst of instances.value) {
    const cat = inst.app_category || inst.service_type || '通用服务';
    map[cat] = (map[cat] || 0) + 1;
  }
  return Object.entries(map)
    .map(([name, count], idx) => ({ name, count, color: categoryColors[idx % categoryColors.length] }))
    .sort((a, b) => b.count - a.count);
});

// 最近 6 个实例（按创建时间倒序）
const recentInstances = computed(() => {
  return [...instances.value]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 6);
});

function formatTime(time?: string): string {
  if (!time) return '—';
  const d = new Date(time.replace(' ', 'T'));
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
  return time.substring(0, 10);
}

function enterEditor(inst: any) {
  router.push(`/instance/${inst.id}/edit`);
}

function goList() {
  router.push('/console/instances/list');
}

function goCreate() {
  router.push('/console/instances/list?action=create');
}

function goDevMarket() {
  router.push('/console/developer/market');
}

function openAi() {
  // 触发全局 AI 抽屉打开事件
  window.dispatchEvent(new CustomEvent('open-ai-drawer', { detail: { scope: 'instance' } }));
}

async function loadOverview() {
  loading.value = true;
  try {
    const [list, groupList] = await Promise.all([
      instancesApi.list(),
      groupsApi.list().catch(() => [])
    ]);
    instances.value = list || [];
    groups.value = groupList || [];
  } catch (e) {
    console.error('加载实例概览失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadOverview);
</script>

<style scoped>
.instance-overview {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

/* 页头 */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacer-4);
  margin-bottom: var(--spacer-5);
}

.page-header-left {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.page-title {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.page-description {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
}

.page-header-right {
  display: flex;
  gap: var(--spacer-2);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--fast-duration), border-color var(--fast-duration);
  font-family: inherit;
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
  border-color: var(--accent-base);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--ctrl-border-rest);
}

.btn-ghost:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

/* 概览统计 */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-5);
}

.metric-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  position: relative;
}

.metric-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.metric-icon > svg {
  width: 32px;
  height: 32px;
}

.metric-meta {
  flex: 1;
  min-width: 0;
}

.metric-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.metric-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.metric-trend {
  position: absolute;
  top: var(--spacer-3);
  right: var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.dot-success {
  background: var(--status-success);
}

.dot-error {
  background: var(--status-error);
}

/* 主体 */
.overview-body {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--spacer-4);
}

.overview-section {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
  min-height: 400px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-3);
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
  color: var(--accent-base);
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.link-btn:hover {
  text-decoration: underline;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-8) var(--spacer-4);
  color: var(--text-tertiary);
}

.empty-state > svg {
  width: 32px;
  height: 32px;
}

.empty-icon {
  color: var(--text-tertiary);
  opacity: 0.5;
}

.empty-text {
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-secondary);
}

.empty-sub {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-bottom: var(--spacer-2);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 最近实例列表 */
.recent-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.recent-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--fast-duration);
  border: 1px solid transparent;
}

.recent-item:hover {
  background: var(--subtle-secondary);
  border-color: var(--card-stroke);
}

.recent-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.recent-icon.running {
  background: rgba(16,124,16,0.1);
  color: var(--status-success);
}

.recent-icon.stopped {
  background: rgba(196,43,28,0.1);
  color: var(--status-error);
}

.recent-meta {
  flex: 1;
  min-width: 0;
}

.recent-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.relation-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 500;
}

.relation-tag.shared {
  background: rgba(0,103,192,0.1);
  color: var(--accent-base);
}

.relation-tag.owned {
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.recent-sub {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.sep {
  color: var(--text-tertiary);
  opacity: 0.5;
}

.group-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.group-chip.muted {
  opacity: 0.6;
}

.recent-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  min-width: 80px;
}

.recent-action {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.recent-item:hover .recent-action {
  background: var(--subtle-tertiary);
  color: var(--accent-base);
}

/* 侧栏卡片 */
.overview-side {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.side-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
}

.side-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-3);
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.quick-action {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: inherit;
  transition: background var(--fast-duration);
}

.quick-action:hover {
  background: var(--subtle-secondary);
}

.qa-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qa-meta {
  flex: 1;
  min-width: 0;
}

.qa-title {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.qa-sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.side-empty {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  text-align: center;
  padding: var(--spacer-4) 0;
}

/* 类型分布 */
.category-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.category-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.cat-info {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
}

.cat-name {
  color: var(--text-secondary);
  font-weight: 500;
}

.cat-count {
  color: var(--text-tertiary);
}

.cat-bar {
  height: 6px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.cat-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width var(--normal-duration);
}

/* 提示卡片 */
.side-hint {
  display: flex;
  gap: var(--spacer-3);
  background: rgba(0,103,192,0.04);
  border-color: rgba(0,103,192,0.15);
}

.hint-icon {
  color: var(--accent-base);
  flex-shrink: 0;
}

.hint-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.hint-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  line-height: 1.6;
}

/* 响应式 */
@media (max-width: 1024px) {
  .overview-body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .recent-time {
    display: none;
  }
}
</style>
