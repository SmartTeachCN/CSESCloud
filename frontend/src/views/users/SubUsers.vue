<template>
  <div class="sub-users-page">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">子用户管理</h1>
        <p class="page-description">管理团队成员及其角色权限</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-ghost">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2C4.68623 2 2 4.68623 2 8C2 11.3138 4.68623 14 8 14C11.3138 14 14 11.3138 14 8C14 4.68623 11.3138 2 8 2ZM8 3C10.7614 3 13 5.23858 13 8C13 10.7614 10.7614 13 8 13C5.23858 13 3 10.7614 3 8C3 5.23858 5.23858 3 8 3Z" />
          </svg>
          搜索
        </button>
        <button class="btn btn-primary" @click="showAddModal = true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8.5 1.5C8.5 1.22386 8.27614 1 8 1C7.72386 1 7.5 1.22386 7.5 1.5V7H1.5C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H7.5V14C7.5 14.2761 7.72386 14.5 8 14.5C8.27614 14.5 8.5 14.2761 8.5 14V8H14.5C14.7761 8 15 7.77614 15 7.5C15 7.22386 14.7761 7 14.5 7H8.5V1.5Z" />
          </svg>
          添加用户
        </button>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon total"><Icon icon="ri-team-line" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ users.length }}</div>
          <div class="stat-label">总用户</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon active"><Icon icon="ri-checkbox-circle-line" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ activeCount }}</div>
          <div class="stat-label">活跃用户</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon pending"><Icon icon="ri-time-line" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ pendingCount }}</div>
          <div class="stat-label">待激活</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon roles"><Icon icon="ri-shield-check-line" :size="24" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ roles.length }}</div>
          <div class="stat-label">角色类型</div>
        </div>
      </div>
    </div>

    <div class="table-panel">
      <div class="table-header">
        <div class="table-filters">
          <select v-model="filterRole" class="filter-select">
            <option value="">全部角色</option>
            <option v-for="role in roles" :key="role.key" :value="role.key">{{ role.label }}</option>
          </select>
          <select v-model="filterStatus" class="filter-select">
            <option value="">全部状态</option>
            <option value="active">活跃</option>
            <option value="pending">待激活</option>
            <option value="disabled">已禁用</option>
          </select>
        </div>
      </div>

      <div class="table-wrapper">
        <table class="users-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>状态</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id">
              <td class="col-user">
                <div class="user-cell">
                  <div class="user-avatar" :style="{ background: user.color }">
                    {{ user.name.charAt(0) }}
                  </div>
                  <div>
                    <div class="user-name">{{ user.name }}</div>
                    <div class="user-id">ID: {{ user.id }}</div>
                  </div>
                </div>
              </td>
              <td class="col-email">{{ user.email }}</td>
              <td class="col-role">
                <span class="role-badge" :class="user.role">{{ getRoleLabel(user.role) }}</span>
              </td>
              <td class="col-status">
                <span class="status-pill" :class="user.status">
                  <span class="pill-dot"></span>
                  {{ getStatusLabel(user.status) }}
                </span>
              </td>
              <td class="col-login">{{ user.lastLogin }}</td>
              <td class="col-actions">
                <button class="icon-btn-sm" title="编辑">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.5 1.5C13.7761 1.5 14 1.72386 14 2V3.5C14 3.77614 13.7761 4 13.5 4H12L12.5 4.5L5.5 11.5L4 12L4.5 10.5L11.5 3.5L12 4V2C12 1.72386 12.2239 1.5 12.5 1.5H13.5ZM2 13.5H5.5L12 7L9 4L2.5 10.5L2 13.5Z" />
                  </svg>
                </button>
                <button class="icon-btn-sm" title="权限">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1L14 3.5V7.5C14 11.1 11.4 14.4 8 15.5C4.6 14.4 2 11.1 2 7.5V3.5L8 1ZM7.25 5C7.25 4.58579 7.58579 4.25 8 4.25C8.41421 4.25 8.75 4.58579 8.75 5C8.75 5.41421 8.41421 5.75 8 5.75C7.58579 5.75 7.25 5.41421 7.25 5ZM7 7.25C7 6.97386 7.22386 6.75 7.5 6.75H8.5C8.77614 6.75 9 6.97386 9 7.25V10.5C9 10.7761 8.77614 11 8.5 11H7.5C7.22386 11 7 10.7761 7 10.5V7.25Z" />
                  </svg>
                </button>
                <button class="icon-btn-sm danger" title="删除" @click="deleteUser(user)">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 2C5.22386 2 5 2.22386 5 2.5V3H2.5C2.22386 3 2 3.22386 2 3.5C2 3.77614 2.22386 4 2.5 4H3V13.5C3 13.7761 3.22386 14 3.5 14H12.5C12.7761 14 13 13.7761 13 13.5V4H13.5C13.7761 4 14 3.77614 14 3.5C14 3.22386 13.7761 3 13.5 3H11V2.5C11 2.22386 10.7761 2 10.5 2H5.5Z" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="filteredUsers.length === 0" class="empty-state">
        <div class="empty-icon"><Icon icon="ri-team-line" :size="48" /></div>
        <div class="empty-text">暂无符合条件的用户</div>
      </div>
    </div>

    <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">添加新用户</h3>
          <button class="icon-btn-sm" @click="showAddModal = false">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.28033 3.27975C4.47559 3.08449 4.79218 3.08449 4.98744 3.27975L8 6.29231L11.0126 3.27975C11.2078 3.08449 11.5244 3.08449 11.7197 3.27975C11.9149 3.47501 11.9149 3.7916 11.7197 3.98686L8.70711 7.00003L11.7197 10.0126C11.9149 10.2079 11.9149 10.5244 11.7197 10.7197C11.5244 10.9149 11.2078 10.9149 11.0126 10.7197L8 7.70715L4.98744 10.7197C4.79218 10.9149 4.47559 10.9149 4.28033 10.7197C4.08507 10.5244 4.08507 10.2079 4.28033 10.0126L7.29289 7.00003L4.28033 3.98686C4.08507 3.7916 4.08507 3.47501 4.28033 3.27975Z" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">姓名</label>
            <input type="text" v-model="newUser.name" class="form-input" placeholder="输入用户姓名" />
          </div>
          <div class="form-group">
            <label class="form-label">邮箱</label>
            <input type="email" v-model="newUser.email" class="form-input" placeholder="输入邮箱地址" />
          </div>
          <div class="form-group">
            <label class="form-label">角色</label>
            <select v-model="newUser.role" class="form-input">
              <option v-for="role in roles" :key="role.key" :value="role.key">{{ role.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">权限范围</label>
            <select v-model="newUser.scope" class="form-input">
              <option value="all">全部校区</option>
              <option value="campus">指定校区</option>
              <option value="self">仅个人</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showAddModal = false">取消</button>
          <button class="btn btn-primary" @click="addUser">发送邀请</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';

type UserRole = 'admin' | 'teacher' | 'student' | 'viewer';
type UserStatus = 'active' | 'pending' | 'disabled';

interface SubUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLogin: string;
  color: string;
}

const showAddModal = ref(false);
const filterRole = ref('');
const filterStatus = ref('');

const newUser = reactive({
  name: '',
  email: '',
  role: 'teacher' as UserRole,
  scope: 'all'
});

const roles = [
  { key: 'admin' as const, label: '管理员' },
  { key: 'teacher' as const, label: '教师' },
  { key: 'student' as const, label: '学生' },
  { key: 'viewer' as const, label: '观察者' }
];

const users = ref<SubUser[]>([
  { id: 'U001', name: '张三', email: 'zhangsan@cses.edu.cn', role: 'admin', status: 'active', lastLogin: '5 分钟前', color: '#0067C0' },
  { id: 'U002', name: '李四', email: 'lisi@cses.edu.cn', role: 'teacher', status: 'active', lastLogin: '1 小时前', color: '#6A1B9A' },
  { id: 'U003', name: '王五', email: 'wangwu@cses.edu.cn', role: 'teacher', status: 'active', lastLogin: '昨天', color: '#00897B' },
  { id: 'U004', name: '赵六', email: 'zhaoliu@cses.edu.cn', role: 'student', status: 'pending', lastLogin: '从未', color: '#E65100' },
  { id: 'U005', name: '孙七', email: 'sunqi@cses.edu.cn', role: 'viewer', status: 'disabled', lastLogin: '3 天前', color: '#455A64' },
  { id: 'U006', name: '周八', email: 'zhouba@cses.edu.cn', role: 'teacher', status: 'active', lastLogin: '2 小时前', color: '#2E7D32' }
]);

const activeCount = computed(() => users.value.filter(u => u.status === 'active').length);
const pendingCount = computed(() => users.value.filter(u => u.status === 'pending').length);

const filteredUsers = computed(() => {
  return users.value.filter(u => {
    if (filterRole.value && u.role !== filterRole.value) return false;
    if (filterStatus.value && u.status !== filterStatus.value) return false;
    return true;
  });
});

function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = { admin: '管理员', teacher: '教师', student: '学生', viewer: '观察者' };
  return labels[role];
}

function getStatusLabel(status: UserStatus): string {
  const labels: Record<UserStatus, string> = { active: '活跃', pending: '待激活', disabled: '已禁用' };
  return labels[status];
}

function addUser() {
  showAddModal.value = false;
  newUser.name = '';
  newUser.email = '';
  newUser.role = 'teacher';
  newUser.scope = 'all';
}

function deleteUser(user: SubUser) {
  console.log('Delete user:', user.id);
}
</script>

<style scoped>
.sub-users-page {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-5);
}

.stat-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
}

.stat-icon {
  font-size: 24px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--subtle-secondary);
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.table-panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.table-filters {
  display: flex;
  gap: var(--spacer-2);
}

.filter-select {
  height: 32px;
  padding: 0 var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;
  font-family: var(--font-family);
}

.table-wrapper {
  overflow-x: auto;
}

.users-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.users-table th {
  text-align: left;
  padding: var(--spacer-3) var(--spacer-4);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
  white-space: nowrap;
}

.users-table td {
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  color: var(--text-primary);
  white-space: nowrap;
}

.users-table tbody tr {
  transition: background var(--fast-duration);
}

.users-table tbody tr:hover {
  background: var(--subtle-secondary);
}

.users-table tbody tr:last-child td {
  border-bottom: none;
}

.col-user {
  min-width: 200px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  color: var(--accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  flex-shrink: 0;
}

.user-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.user-id {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.col-email {
  color: var(--text-secondary);
}

.col-role {
  min-width: 100px;
}

.role-badge {
  display: inline-flex;
  padding: var(--spacer-1) var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  border-radius: var(--radius-full);
}

.role-badge.admin {
  background: rgba(196, 43, 28, 0.1);
  color: var(--status-error);
}

.role-badge.teacher {
  background: rgba(0, 103, 192, 0.1);
  color: var(--status-info);
}

.role-badge.student {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.role-badge.viewer {
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  border-radius: var(--radius-full);
}

.status-pill.active {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.status-pill.pending {
  background: rgba(202, 143, 4, 0.1);
  color: var(--status-warning);
}

.status-pill.disabled {
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.status-pill.active .pill-dot {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.col-login {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.col-actions {
  display: flex;
  gap: var(--spacer-1);
}

.icon-btn-sm {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.icon-btn-sm:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.icon-btn-sm.danger:hover {
  color: var(--status-error);
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

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn var(--fast-duration);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  width: 480px;
  max-width: 90vw;
  max-height: 90vh;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.modal-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal-body {
  padding: var(--spacer-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  overflow-y: auto;
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.form-input {
  height: 36px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
  font-family: var(--font-family);
}

.form-input:focus {
  border-color: var(--accent-base);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}
</style>