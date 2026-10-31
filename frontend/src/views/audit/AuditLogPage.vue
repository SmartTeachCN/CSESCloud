<template>
  <div class="audit-log-page">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">操作日志</h1>
        <p class="page-description">查看系统操作记录和审计追踪</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-ghost" @click="resetFilters">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2C4.68623 2 2 4.68623 2 8C2 11.3138 4.68623 14 8 14C11.3138 14 14 11.3138 14 8C14 4.68623 11.3138 2 8 2ZM8 3C10.7614 3 13 5.23858 13 8C13 10.7614 10.7614 13 8 13C5.23858 13 3 10.7614 3 8C3 5.23858 5.23858 3 8 3ZM7.5 4.5C7.22386 4.5 7 4.72386 7 5V8C7 8.06566 7.51293 8.12955 7.53626 8.18896L9.03626 11.689C9.17989 12.0241 9.57459 12.1779 9.90957 12.0342C10.2445 11.8906 10.3984 11.4959 10.2547 11.1609L8.75472 7.66088C8.69394 7.51077 8.55708 7.41667 8.40068 7.41667H8.5C8.22386 7.41667 8 7.19281 8 6.91667V5C8 4.72386 7.77614 4.5 7.5 4.5Z" />
          </svg>
          重置筛选
        </button>
        <button class="btn btn-primary" @click="exportLogs">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1.5C8.27614 1.5 8.5 1.72386 8.5 2V7.69058L10.9976 5.19305C11.1928 4.99779 11.5094 4.99779 11.7047 5.19305C11.9 5.38831 11.9 5.7049 11.7047 5.90016L8.59017 9.01465C8.39491 9.20991 8.07832 9.20991 7.88306 9.01465L4.76858 5.90016C4.57332 5.7049 4.57332 5.38831 4.76858 5.19305C4.96384 4.99779 5.28043 4.99779 5.47569 5.19305L7.97322 7.69058V2C7.97322 1.72386 8.19708 1.5 8.47322 1.5H8ZM2.5 13.5C2.5 13.2239 2.72386 13 3 13H13C13.2761 13 13.5 13.2239 13.5 13.5C13.5 13.7761 13.2761 14 13 14H3C2.72386 14 2.5 13.7761 2.5 13.5Z" />
          </svg>
          导出日志
        </button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">日期范围</span>
        <input type="date" v-model="filters.startDate" class="filter-input" />
        <span class="filter-sep">至</span>
        <input type="date" v-model="filters.endDate" class="filter-input" />
      </div>
      <div class="filter-group">
        <span class="filter-label">操作类型</span>
        <CustomSelect
          v-model="filters.action"
          :options="actionFilterOptions"
          inline
          width="110px"
          height="32px"
          class="filter-select"
        />
      </div>
      <div class="filter-group">
        <span class="filter-label">用户</span>
        <input type="text" v-model="filters.user" class="filter-input" placeholder="搜索用户名..." />
      </div>
      <div class="filter-group">
        <span class="filter-label">状态</span>
        <CustomSelect
          v-model="filters.status"
          :options="statusFilterOptions"
          inline
          width="110px"
          height="32px"
          class="filter-select"
        />
      </div>
      <div class="filter-group">
        <button class="btn btn-primary" @click="applyFilters">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 2C1.5 1.72386 1.72386 1.5 2 1.5H14C14.2761 1.5 14.5 1.72386 14.5 2V4.37868C14.5 4.61478 14.4074 4.84247 14.2419 5.00438L9.25 9.81952V14C9.25 14.2761 9.02614 14.5 8.75 14.5H7.25C6.97386 14.5 6.75 14.2761 6.75 14V9.81952L1.75812 5.00438C1.59265 4.84247 1.5 4.61478 1.5 4.37868V2ZM3 2.5V4.27496L7.61554 8.77353C7.82334 8.97475 8.17658 8.97475 8.38438 8.77353L13 4.27496V2.5H3Z" />
          </svg>
          筛选
        </button>
      </div>
    </div>

    <div class="table-panel">
      <div class="table-wrapper">
        <table class="log-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>操作</th>
              <th>目标</th>
              <th>IP 地址</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in paginatedLogs" :key="log.id">
              <td class="col-time">{{ log.timestamp }}</td>
              <td class="col-user">
                <div class="user-cell">
                  <div class="user-avatar">{{ log.user.charAt(0) }}</div>
                  <span>{{ log.user }}</span>
                </div>
              </td>
              <td class="col-action">
                <span class="action-badge" :class="log.action">
                  {{ getActionLabel(log.action) }}
                </span>
              </td>
              <td class="col-target">{{ log.target }}</td>
              <td class="col-ip">{{ log.ip }}</td>
              <td class="col-status">
                <span class="status-badge" :class="log.status">
                  <span class="status-dot"></span>
                  {{ log.status === 'success' ? '成功' : '失败' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="filteredLogs.length === 0" class="empty-state">
        <div class="empty-icon"><Icon icon="ri-inbox-line" :size="48" /></div>
        <div class="empty-text">暂无符合条件的日志</div>
      </div>

      <div class="pagination">
        <div class="page-info">
          共 {{ filteredLogs.length }} 条记录，当前第 {{ currentPage }} / {{ totalPages }} 页
        </div>
        <div class="page-controls">
          <button class="btn btn-ghost-sm" :disabled="currentPage <= 1" @click="currentPage--">上一页</button>
          <button
            v-for="page in visiblePages"
            :key="page"
            class="page-btn"
            :class="{ active: page === currentPage }"
            @click="currentPage = page"
          >{{ page }}</button>
          <button class="btn btn-ghost-sm" :disabled="currentPage >= totalPages" @click="currentPage++">下一页</button>
        </div>
        <CustomSelect
          v-model="pageSize"
          :options="pageSizeOptions"
          inline
          width="92px"
          height="32px"
          class="page-size-select"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import CustomSelect from '../../components/CustomSelect.vue';

type ActionType = 'create' | 'update' | 'delete' | 'login' | 'export';
type StatusType = 'success' | 'failed';

interface LogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: ActionType;
  target: string;
  ip: string;
  status: StatusType;
}

interface Filters {
  startDate: string;
  endDate: string;
  action: string;
  user: string;
  status: string;
}

const currentPage = ref(1);
const pageSize = ref(20);

const filters = reactive<Filters>({
  startDate: '',
  endDate: '',
  action: '',
  user: '',
  status: ''
});

const appliedFilters = reactive<Filters>({ ...filters });

const actionFilterOptions = [
  { value: '', label: '全部' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'login', label: '登录' },
  { value: 'export', label: '导出' },
];

const statusFilterOptions = [
  { value: '', label: '全部' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
];

const pageSizeOptions = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 50, label: '50 条/页' },
];

const logs = ref<LogEntry[]>([
  { id: '1', timestamp: '2024-01-15 14:32:18', user: '张三', action: 'create', target: '班级 CS-2024-1', ip: '192.168.1.105', status: 'success' },
  { id: '2', timestamp: '2024-01-15 14:28:45', user: '李四', action: 'update', target: '用户配置', ip: '192.168.1.112', status: 'success' },
  { id: '3', timestamp: '2024-01-15 13:55:22', user: '王五', action: 'login', target: '系统登录', ip: '10.0.0.23', status: 'success' },
  { id: '4', timestamp: '2024-01-15 13:42:10', user: '张三', action: 'delete', target: '临时文件', ip: '192.168.1.105', status: 'success' },
  { id: '5', timestamp: '2024-01-15 12:18:33', user: '赵六', action: 'export', target: '学生数据', ip: '172.16.0.8', status: 'success' },
  { id: '6', timestamp: '2024-01-15 11:05:47', user: '李四', action: 'update', target: '服务配置', ip: '192.168.1.112', status: 'success' },
  { id: '7', timestamp: '2024-01-15 10:33:12', user: '系统', action: 'create', target: '自动备份任务', ip: '127.0.0.1', status: 'success' },
  { id: '8', timestamp: '2024-01-15 09:51:04', user: '王五', action: 'login', target: '系统登录', ip: '10.0.0.23', status: 'failed' },
  { id: '9', timestamp: '2024-01-14 17:22:58', user: '张三', action: 'export', target: '操作日志', ip: '192.168.1.105', status: 'success' },
  { id: '10', timestamp: '2024-01-14 16:45:30', user: '孙七', action: 'update', target: '权限配置', ip: '192.168.1.118', status: 'failed' },
  { id: '11', timestamp: '2024-01-14 15:18:22', user: '李四', action: 'create', target: '新课程', ip: '192.168.1.112', status: 'success' },
  { id: '12', timestamp: '2024-01-14 14:02:15', user: '周八', action: 'delete', target: '过期记录', ip: '10.0.0.45', status: 'success' },
  { id: '13', timestamp: '2024-01-14 11:30:08', user: '张三', action: 'update', target: '个人资料', ip: '192.168.1.105', status: 'success' },
  { id: '14', timestamp: '2024-01-13 18:55:42', user: '系统', action: 'export', target: '系统报告', ip: '127.0.0.1', status: 'success' },
  { id: '15', timestamp: '2024-01-13 16:40:19', user: '王五', action: 'login', target: '系统登录', ip: '10.0.0.23', status: 'success' }
]);

const filteredLogs = computed(() => {
  return logs.value.filter(log => {
    if (appliedFilters.action && log.action !== appliedFilters.action) return false;
    if (appliedFilters.status && log.status !== appliedFilters.status) return false;
    if (appliedFilters.user && !log.user.toLowerCase().includes(appliedFilters.user.toLowerCase())) return false;
    return true;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredLogs.value.length / pageSize.value)));

const paginatedLogs = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredLogs.value.slice(start, start + pageSize.value);
});

const visiblePages = computed(() => {
  const pages: number[] = [];
  const total = totalPages.value;
  const current = currentPage.value;
  const start = Math.max(1, current - 2);
  const end = Math.min(total, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});

function getActionLabel(action: ActionType): string {
  const labels: Record<ActionType, string> = { create: '创建', update: '更新', delete: '删除', login: '登录', export: '导出' };
  return labels[action];
}

function applyFilters() {
  Object.assign(appliedFilters, filters);
  currentPage.value = 1;
}

function resetFilters() {
  filters.startDate = '';
  filters.endDate = '';
  filters.action = '';
  filters.user = '';
  filters.status = '';
  Object.assign(appliedFilters, filters);
  currentPage.value = 1;
}

function exportLogs() {
  console.log('Exporting logs...');
}
</script>

<style scoped>
.audit-log-page {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.filter-bar {
  display: flex;
  gap: var(--spacer-4);
  flex-wrap: wrap;
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  margin-bottom: var(--spacer-4);
}

.filter-group {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.filter-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-tertiary);
}

.filter-input {
  height: 32px;
  padding: 0 var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
  font-family: var(--font-family);
}

.filter-input:focus {
  border-color: var(--accent-base);
}

.filter-select :deep(.select-trigger),
.page-size-select :deep(.select-trigger) {
  padding: 0 var(--spacer-2);
}

.filter-sep {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.table-panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-wrapper {
  overflow-x: auto;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.log-table th {
  text-align: left;
  padding: var(--spacer-3) var(--spacer-4);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
  white-space: nowrap;
}

.log-table td {
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  color: var(--text-primary);
  white-space: nowrap;
}

.log-table tbody tr {
  transition: background var(--fast-duration);
}

.log-table tbody tr:hover {
  background: var(--subtle-secondary);
}

.log-table tbody tr:last-child td {
  border-bottom: none;
}

.col-time {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.col-user {
  min-width: 120px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.user-avatar {
  width: 24px;
  height: 24px;
  background: var(--accent-base);
  color: var(--accent-text);
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  font-weight: 600;
  flex-shrink: 0;
}

.action-badge {
  display: inline-flex;
  padding: 2px var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  border-radius: var(--radius-sm);
}

.action-badge.create {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.action-badge.update {
  background: rgba(0, 103, 192, 0.1);
  color: var(--status-info);
}

.action-badge.delete {
  background: rgba(196, 43, 28, 0.1);
  color: var(--status-error);
}

.action-badge.login {
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
}

.action-badge.export {
  background: rgba(202, 143, 4, 0.1);
  color: var(--status-warning);
}

.col-target {
  color: var(--text-secondary);
}

.col-ip {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.empty-state {
  text-align: center;
  padding: var(--spacer-12);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: var(--spacer-3);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
  flex-wrap: wrap;
  gap: var(--spacer-3);
}

.page-info {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.page-controls {
  display: flex;
  gap: var(--spacer-1);
  align-items: center;
}

.page-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 var(--spacer-2);
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.page-btn:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.page-btn.active {
  background: var(--accent-base);
  color: var(--accent-text);
}

.page-size-select :deep(.select-trigger) {
  padding: 0 var(--spacer-2);
}
</style>