<template>
  <div class="campus-overview">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          {{ currentSchool?.name || '校园概览' }}
        </h1>
        <p class="page-description">查看校园整体运行状态和关键指标</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-ghost" :disabled="loading" @click="loadOverview">
          <Icon :icon="loading ? 'ri-loader-4-line' : 'ri-refresh-line'" :size="16" :class="{ spin: loading }" />
          刷新
        </button>
      </div>
    </div>

    <div class="metrics-grid">
      <div class="metric-card" v-for="metric in metrics" :key="metric.label">
        <div class="metric-icon" :style="{ background: metric.bgColor }">
          <Icon :icon="metric.icon" :size="28" />
        </div>
        <div class="metric-content">
          <div class="metric-value">{{ metric.value }}</div>
          <div class="metric-label">{{ metric.label }}</div>
        </div>
      </div>
    </div>

    <div class="content-grid">
      <div class="panel panel-main">
        <div class="panel-header">
          <h3 class="panel-title">班级状态总览</h3>
          <div class="panel-actions">
            <button class="chip" :class="{ active: tab === 'all' }" @click="tab = 'all'">全部</button>
            <button class="chip" :class="{ active: tab === 'online' }" @click="tab = 'online'">在线</button>
            <button class="chip" :class="{ active: tab === 'offline' }" @click="tab = 'offline'">离线</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="class-list">
            <div class="class-row" v-for="cls in filteredClasses" :key="cls.id">
              <div class="class-info">
                <div class="class-name">{{ cls.name }}</div>
                <div class="class-meta">{{ cls.student_count || 0 }} 名学生 · {{ cls.teacher || '未指定教师' }}</div>
              </div>
              <div class="class-status" :class="cls.status">
                <span class="status-dot"></span>
                {{ cls.status === 'online' ? '在线' : '离线' }}
              </div>
              <div class="class-actions">
                <button class="icon-btn-sm" title="查看详情">
                  <Icon icon="ri-eye-line" :size="14" />
                </button>
                <button class="icon-btn-sm" title="管理">
                  <Icon icon="ri-settings-3-line" :size="14" />
                </button>
              </div>
            </div>
            <div v-if="filteredClasses.length === 0" class="empty-state">
              <Icon icon="ri-inbox-line" class="empty-icon" :size="48" />
              <div class="empty-text">暂无班级数据</div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel panel-side">
        <div class="panel-header">
          <h3 class="panel-title">快捷操作</h3>
        </div>
        <div class="panel-body quick-actions">
          <button class="quick-action" v-for="action in quickActions" :key="action.label" @click="onQuick(action.path)">
            <Icon :icon="action.icon" class="quick-action-icon" :size="22" />
            <span class="quick-action-label">{{ action.label }}</span>
          </button>
        </div>

        <div class="panel-header" style="margin-top: var(--spacer-5);">
          <h3 class="panel-title">最近活动</h3>
        </div>
        <div class="panel-body activity-list">
          <div v-if="activities.length === 0" class="empty-state">
            <Icon icon="ri-history-line" class="empty-icon" :size="32" />
            <div class="empty-text">暂无活动</div>
          </div>
          <div class="activity-item" v-for="(activity, i) in activities" :key="i">
            <div class="activity-dot" :class="activity.type"></div>
            <div class="activity-content">
              <div class="activity-text">{{ activity.text }}</div>
              <div class="activity-time">{{ formatTime(activity.time) }}</div>
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
import { campusApi } from '../../api';
import { useSchool } from '../../composables/useSchool';

const router = useRouter();
const { currentSchool } = useSchool();

const tab = ref('all');
const loading = ref(false);
const overview = ref<any>({
  classes: 0,
  students: 0,
  teachers: 0,
  instances: 0,
  control_units: 0,
  today_ops: 0,
  class_status: [],
  recent_activities: []
});

const metrics = computed(() => [
  { label: '班级总数', value: overview.value.classes ?? 0, icon: 'ri-book-open-line', bgColor: 'rgba(0,103,192,0.1)' },
  { label: '学生总数', value: overview.value.students ?? 0, icon: 'ri-user-star-line', bgColor: 'rgba(16,124,16,0.1)' },
  { label: '教师总数', value: overview.value.teachers ?? 0, icon: 'ri-team-line', bgColor: 'rgba(120,90,240,0.1)' },
  { label: '实例总数', value: overview.value.instances ?? 0, icon: 'ri-cloud-line', bgColor: 'rgba(2,119,189,0.1)' },
  { label: '集控单元', value: overview.value.control_units ?? 0, icon: 'ri-stack-line', bgColor: 'rgba(230,81,0,0.1)' },
  { label: '今日操作', value: overview.value.today_ops ?? 0, icon: 'ri-flashlight-line', bgColor: 'rgba(124,77,255,0.1)' }
]);

const filteredClasses = computed(() => {
  if (tab.value === 'all') return overview.value.class_status || [];
  return (overview.value.class_status || []).filter((c: any) => c.status === tab.value);
});

const activities = computed(() => overview.value.recent_activities || []);

const quickActions = [
  { icon: 'ri-add-line', label: '新建班级', path: '/console/campus/manage' },
  { icon: 'ri-team-line', label: '添加学生', path: '/console/campus/sub-users' },
  { icon: 'ri-cloud-line', label: '实例列表', path: '/console/instances' },
  { icon: 'ri-bar-chart-box-line', label: '查看报告', path: '/console/campus' },
  { icon: 'ri-tools-line', label: '批量设置', path: '/console/campus/settings' },
  { icon: 'ri-settings-3-line', label: '校园设置', path: '/console/campus/settings' }
];

function onQuick(path: string) {
  router.push(path);
}

function formatTime(t: string): string {
  if (!t) return '';
  try {
    const d = new Date(t.replace(' ', 'T'));
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  } catch {
    return t;
  }
}

async function loadOverview() {
  loading.value = true;
  try {
    const data = await campusApi.overview();
    overview.value = data || overview.value;
  } catch (e) {
    console.error('加载校园概览失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadOverview();
});
</script>

<style scoped>
.campus-overview {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-5);
  flex-wrap: wrap;
  gap: var(--spacer-3);
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

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
  text-decoration: none;
  border: none;
}

.btn-ghost {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.btn-ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacer-4);
  margin-bottom: var(--spacer-5);
}

.metric-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-4);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  transition: box-shadow var(--fast-duration), transform var(--fast-duration);
}

.metric-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.metric-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-base);
  flex-shrink: 0;
}

.metric-icon > svg {
  width: 32px;
  height: 32px;
}

.metric-content {
  flex: 1;
}

.metric-value {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.metric-label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.content-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--spacer-4);
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

.panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.panel-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.panel-actions {
  display: flex;
  gap: var(--spacer-1);
}

.chip {
  padding: var(--spacer-1) var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.chip.active {
  background: var(--accent-base);
  color: var(--accent-text);
}

.panel-body {
  padding: var(--spacer-3);
}

.class-list {
  display: flex;
  flex-direction: column;
}

.class-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.class-row:hover {
  background: var(--subtle-secondary);
}

.class-info {
  flex: 1;
  min-width: 0;
}

.class-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.class-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.class-status {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  font-weight: 500;
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-full);
}

.class-status.online {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.class-status.offline {
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.class-status.online .status-dot {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.class-actions {
  display: flex;
  gap: var(--spacer-1);
}

.icon-btn-sm {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: background var(--fast-duration), color var(--fast-duration);
}

.icon-btn-sm:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.empty-state {
  text-align: center;
  padding: var(--spacer-8) var(--spacer-4);
}

.empty-icon {
  margin-bottom: var(--spacer-3);
  color: var(--text-tertiary);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacer-2);
}

.quick-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-2);
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--fast-duration), transform var(--fast-duration);
  color: var(--accent-base);
}

.quick-action:hover {
  background: var(--subtle-pressed);
  transform: translateY(-2px);
}

.quick-action-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
}

.activity-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  margin-top: 6px;
  flex-shrink: 0;
}

.activity-dot.success {
  background: var(--status-success);
}

.activity-dot.info {
  background: var(--status-info);
}

.activity-dot.warning {
  background: var(--status-warning);
}

.activity-dot.error {
  background: var(--status-error);
}

.activity-content {
  flex: 1;
}

.activity-text {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  word-break: break-word;
}

.activity-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}
</style>
