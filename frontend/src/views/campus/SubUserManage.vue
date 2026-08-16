<template>
  <div class="sub-user-manage">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">子用户管理</h1>
        <p class="page-description">管理校园子用户、权限与联盟账户绑定</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-ghost" @click="showBindModal = true">
          <Icon icon="ri-link" :size="14" />
          <span>联盟绑定</span>
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <Icon icon="ri-add-line" :size="14" />
          <span>添加子用户</span>
        </button>
      </div>
    </div>

    <!-- 统计 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon"><Icon icon="ri-team-line" :size="20" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ users.length }}</div>
          <div class="stat-label">子用户总数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Icon icon="ri-admin-line" :size="20" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ admins.length }}</div>
          <div class="stat-label">管理员</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Icon icon="ri-teacher-line" :size="20" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ teachers.length }}</div>
          <div class="stat-label">教师</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Icon icon="ri-graduation-cap-line" :size="20" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ students.length }}</div>
          <div class="stat-label">学生</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Icon icon="ri-link" :size="20" /></div>
        <div class="stat-info">
          <div class="stat-value">{{ totalBindings }}</div>
          <div class="stat-label">联盟绑定</div>
        </div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <div class="search-box">
        <Icon icon="ri-search-line" :size="14" />
        <input v-model="keyword" type="text" placeholder="搜索用户名、姓名、邮箱..." @input="loadUsers" />
      </div>
      <select v-model="roleFilter" @change="loadUsers">
        <option value="">全部角色</option>
        <option value="admin">管理员</option>
        <option value="teacher">教师</option>
        <option value="student">学生</option>
      </select>
      <button class="btn btn-ghost btn-sm" @click="loadUsers">
        <Icon icon="ri-refresh-line" :size="14" />
        <span>刷新</span>
      </button>
    </div>

    <!-- 列表 -->
    <div class="user-table">
      <div class="table-header">
        <div class="col-username">用户名</div>
        <div class="col-name">姓名</div>
        <div class="col-role">角色</div>
        <div class="col-bindings">联盟绑定</div>
        <div class="col-perms">权限</div>
        <div class="col-status">状态</div>
        <div class="col-actions">操作</div>
      </div>
      <div v-if="loading" class="table-loading">
        <Icon icon="ri-loader-4-line" :size="20" class="spin" />
        <span>加载中...</span>
      </div>
      <div v-else-if="filteredUsers.length === 0" class="table-empty">
        <Icon icon="ri-inbox-line" :size="32" />
        <p>暂无子用户</p>
      </div>
      <div v-else>
        <div v-for="u in filteredUsers" :key="u.id" class="table-row">
          <div class="col-username">
            <Icon icon="ri-user-line" :size="14" />
            <span>{{ u.username }}</span>
          </div>
          <div class="col-name">{{ u.display_name }}</div>
          <div class="col-role">
            <span class="role-badge" :class="u.role">{{ roleLabel(u.role) }}</span>
          </div>
          <div class="col-bindings">
            <span v-if="!u.bindings || u.bindings.length === 0" class="muted">—</span>
            <div v-else class="binding-tags">
              <span v-for="b in u.bindings" :key="b.binding_id" class="binding-tag" :title="`绑定到 ${b.alliance_username}`">
                <Icon icon="ri-link" :size="10" />
                <span>{{ b.alias || b.alliance_username }}</span>
              </span>
            </div>
          </div>
          <div class="col-perms">
            <span v-if="!u.permissions" class="muted">默认</span>
            <span v-else class="perm-summary" :title="permSummary(u.permissions)">
              {{ permSummary(u.permissions) }}
            </span>
          </div>
          <div class="col-status">
            <span class="status-badge" :class="u.status">
              <span class="status-dot"></span>
              {{ u.status === 'active' ? '启用' : '禁用' }}
            </span>
          </div>
          <div class="col-actions">
            <button class="row-btn" @click="openEdit(u)" title="编辑">
              <Icon icon="ri-edit-line" :size="12" />
            </button>
            <button class="row-btn" @click="resetPassword(u)" title="重置密码">
              <Icon icon="ri-lock-password-line" :size="12" />
            </button>
            <button class="row-btn danger" @click="deleteUser(u)" title="删除">
              <Icon icon="ri-delete-bin-line" :size="12" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增/编辑模态框 -->
    <Teleport to="body">
      <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
        <div class="modal-card">
          <div class="modal-header">
            <h3>{{ editing ? '编辑子用户' : '添加子用户' }}</h3>
            <button class="modal-close" @click="showForm = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label>用户名 <span class="required">*</span></label>
                <input v-model="form.username" type="text" :disabled="editing" placeholder="登录用户名" />
              </div>
              <div class="form-group">
                <label>姓名 <span class="required">*</span></label>
                <input v-model="form.display_name" type="text" placeholder="真实姓名" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group" v-if="!editing">
                <label>密码 <span class="required">*</span></label>
                <input v-model="form.password" type="password" placeholder="至少 6 位" />
              </div>
              <div class="form-group">
                <label>角色</label>
                <select v-model="form.role">
                  <option value="admin">管理员</option>
                  <option value="teacher">教师</option>
                  <option value="student">学生</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>邮箱</label>
                <input v-model="form.email" type="email" placeholder="邮箱地址" />
              </div>
              <div class="form-group">
                <label>电话</label>
                <input v-model="form.phone" type="text" placeholder="联系电话" />
              </div>
            </div>
            <div class="form-group" v-if="editing">
              <label>状态</label>
              <select v-model="form.status">
                <option value="active">启用</option>
                <option value="inactive">禁用</option>
              </select>
            </div>

            <!-- 权限配置 -->
            <div class="perms-section">
              <div class="perms-title">
                <Icon icon="ri-shield-keyhole-line" :size="14" />
                <span>权限配置</span>
                <span class="perms-hint">绑定到联盟账户后，联盟用户将遵循此权限</span>
              </div>
              <div class="perms-grid">
                <label v-for="p in permissionItems" :key="p.key" class="perm-check">
                  <input type="checkbox" v-model="form.permissions[p.key]" />
                  <span class="perm-label">{{ p.label }}</span>
                  <span class="perm-desc">{{ p.desc }}</span>
                </label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showForm = false">取消</button>
            <button class="btn btn-primary" :disabled="submitting" @click="submit">
              <Icon v-if="submitting" icon="ri-loader-4-line" :size="14" class="spin" />
              <span>{{ editing ? '保存' : '添加' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 联盟绑定模态框：学校级所有绑定 -->
    <Teleport to="body">
      <div v-if="showBindModal" class="modal-overlay" @click.self="showBindModal = false">
        <div class="modal-card modal-lg">
          <div class="modal-header">
            <h3>联盟账户绑定</h3>
            <button class="modal-close" @click="showBindModal = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-tip">
              <Icon icon="ri-information-line" :size="14" />
              <span>子用户绑定到智教联盟账户后，可在联盟账户的实例集控列表中直接添加（遵循子用户的权限设置）。</span>
            </p>
            <div v-if="loadingBindings" class="table-loading">
              <Icon icon="ri-loader-4-line" :size="20" class="spin" />
              <span>加载中...</span>
            </div>
            <div v-else-if="allBindings.length === 0" class="empty-bindings">
              <Icon icon="ri-link-unlink-m" :size="32" />
              <p>暂无绑定关系</p>
              <span class="muted">子用户在智教联盟账户登录后可主动绑定到此账户</span>
            </div>
            <div v-else class="binding-list">
              <div v-for="b in allBindings" :key="b.id" class="binding-item">
                <div class="binding-info">
                  <div class="binding-username">
                    <Icon icon="ri-user-line" :size="12" />
                    <span>{{ b.sub_username }}</span>
                    <span class="muted">({{ b.sub_display_name }})</span>
                    <span class="role-badge" :class="b.sub_role">{{ roleLabel(b.sub_role) }}</span>
                  </div>
                  <div class="binding-meta">
                    <span class="tag">
                      <Icon icon="ri-link" :size="10" />
                      绑定到 {{ b.alliance_username }}
                    </span>
                    <span class="tag" v-if="b.alias">别名：{{ b.alias }}</span>
                    <span class="muted">{{ b.created_at }}</span>
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm" @click="schoolUnbind(b)">
                  <Icon icon="ri-link-unlink-m" :size="12" /> 解绑
                </button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showBindModal = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { subUsersApi } from '../../api';

const loading = ref(false);
const loadingBindings = ref(false);
const submitting = ref(false);
const users = ref<any[]>([]);
const allBindings = ref<any[]>([]);
const keyword = ref('');
const roleFilter = ref('');

const showForm = ref(false);
const showBindModal = ref(false);
const editing = ref(false);

// 权限项配置
const permissionItems = [
  { key: 'instance_create', label: '创建实例', desc: '可在实例云控中新建实例' },
  { key: 'instance_edit', label: '编辑实例', desc: '可编辑实例配置与数据' },
  { key: 'instance_delete', label: '删除实例', desc: '可删除自己拥有的实例' },
  { key: 'instance_share', label: '共享实例', desc: '可将实例共享给其他用户' },
  { key: 'campus_view', label: '查看校园', desc: '可访问校园集控概览' },
  { key: 'campus_manage', label: '管理校园', desc: '可修改校园设置' },
  { key: 'sub_user_manage', label: '管理子用户', desc: '可添加、修改、删除子用户' }
];

function defaultPermissions() {
  const p: Record<string, boolean> = {};
  permissionItems.forEach(i => { p[i.key] = false; });
  return p;
}

const form = ref({
  id: 0,
  username: '',
  display_name: '',
  password: '',
  role: 'teacher',
  email: '',
  phone: '',
  status: 'active',
  permissions: defaultPermissions()
});

const filteredUsers = computed(() => {
  let list = users.value;
  if (roleFilter.value) list = list.filter(u => u.role === roleFilter.value);
  return list;
});

const admins = computed(() => users.value.filter(u => u.role === 'admin'));
const teachers = computed(() => users.value.filter(u => u.role === 'teacher'));
const students = computed(() => users.value.filter(u => u.role === 'student'));
const totalBindings = computed(() =>
  users.value.reduce((sum, u) => sum + (u.bindings?.length || 0), 0)
);

function roleLabel(role: string): string {
  return ({ admin: '管理员', teacher: '教师', student: '学生' } as any)[role] || role;
}

function permSummary(perms: any): string {
  if (!perms || typeof perms !== 'object') return '默认';
  const enabled = Object.keys(perms).filter(k => perms[k]);
  if (enabled.length === 0) return '无权限';
  if (enabled.length === permissionItems.length) return '全部权限';
  return `${enabled.length}/${permissionItems.length} 项`;
}

async function loadUsers() {
  loading.value = true;
  try {
    users.value = await subUsersApi.list();
  } catch (e: any) {
    alert(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadAllBindings() {
  loadingBindings.value = true;
  try {
    allBindings.value = await subUsersApi.schoolBindings();
  } catch (e: any) {
    allBindings.value = [];
  } finally {
    loadingBindings.value = false;
  }
}

function openCreate() {
  editing.value = false;
  form.value = {
    id: 0, username: '', display_name: '', password: '',
    role: 'teacher', email: '', phone: '', status: 'active',
    permissions: defaultPermissions()
  };
  showForm.value = true;
}

function openEdit(u: any) {
  editing.value = true;
  // 加载用户已有的权限，合并默认值
  const perms = defaultPermissions();
  if (u.permissions && typeof u.permissions === 'object') {
    Object.keys(u.permissions).forEach(k => {
      if (k in perms) perms[k] = !!u.permissions[k];
    });
  }
  form.value = {
    id: u.id, username: u.username, display_name: u.display_name,
    password: '', role: u.role, email: u.email || '', phone: u.phone || '',
    status: u.status, permissions: perms
  };
  showForm.value = true;
}

async function submit() {
  if (!form.value.username || !form.value.display_name) return;
  if (!editing.value && (!form.value.password || form.value.password.length < 6)) {
    alert('密码至少 6 位');
    return;
  }
  submitting.value = true;
  try {
    if (editing.value) {
      await subUsersApi.update(form.value.id, {
        display_name: form.value.display_name,
        role: form.value.role,
        email: form.value.email,
        phone: form.value.phone,
        status: form.value.status,
        permissions: form.value.permissions
      });
    } else {
      await subUsersApi.create({
        username: form.value.username,
        display_name: form.value.display_name,
        password: form.value.password,
        role: form.value.role,
        email: form.value.email,
        phone: form.value.phone,
        permissions: form.value.permissions
      });
    }
    showForm.value = false;
    await loadUsers();
  } catch (e: any) {
    alert(e.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function deleteUser(u: any) {
  if (!confirm(`确认删除子用户「${u.display_name}」？此操作不可恢复，且会解除其所有联盟绑定。`)) return;
  try {
    await subUsersApi.delete(u.id);
    await loadUsers();
  } catch (e: any) {
    alert(e.message || '删除失败');
  }
}

async function resetPassword(u: any) {
  const pwd = prompt(`重置 ${u.display_name} 的密码（至少 6 位）：`, '');
  if (!pwd || pwd.length < 6) {
    if (pwd !== null) alert('密码至少 6 位');
    return;
  }
  try {
    await subUsersApi.resetPassword(u.id, pwd);
    alert('密码已重置');
  } catch (e: any) {
    alert(e.message || '重置失败');
  }
}

async function schoolUnbind(b: any) {
  if (!confirm(`确认解绑 ${b.sub_username} 与 ${b.alliance_username} 的绑定关系？`)) return;
  try {
    await subUsersApi.schoolUnbind(b.id);
    await loadAllBindings();
    await loadUsers();
  } catch (e: any) {
    alert(e.message || '解绑失败');
  }
}

onMounted(() => {
  loadUsers();
});

watch(showBindModal, (v) => {
  if (v) loadAllBindings();
});
</script>

<style scoped>
.sub-user-manage {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-4);
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
  margin: 4px 0 0;
}

.page-header-right {
  display: flex;
  gap: var(--spacer-2);
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-4);
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
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--subtle-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-base);
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.filter-bar {
  display: flex;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-3);
  align-items: center;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
}

.search-box input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.filter-bar select {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.user-table {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-header, .table-row {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 0.9fr 1.5fr 1fr 0.8fr 0.9fr;
  padding: var(--spacer-2) var(--spacer-3);
  align-items: center;
  gap: var(--spacer-2);
}

.table-header {
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.table-row {
  border-top: 1px solid var(--divider-stroke);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.table-row:hover {
  background: var(--subtle-secondary);
}

.col-username {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-family: var(--font-mono, monospace);
}

.col-name {
  font-weight: 500;
}

.muted {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.binding-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.binding-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: rgba(0, 103, 192, 0.1);
  color: var(--accent-base);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.perm-summary {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: var(--subtle-secondary);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.role-badge {
  display: inline-block;
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.role-badge.admin { background: var(--accent-bg); color: var(--accent-base); }
.role-badge.teacher { background: rgba(16,124,16,0.1); color: var(--status-success); }
.role-badge.student { background: rgba(230,126,34,0.1); color: #e67e22; }

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
}

.status-badge.active { background: rgba(16,124,16,0.1); color: var(--status-success); }
.status-badge.inactive { background: var(--subtle-secondary); color: var(--text-tertiary); }

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.col-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.row-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.row-btn:hover { background: var(--subtle-pressed); color: var(--accent-base); }
.row-btn.danger:hover { color: var(--status-error); }

.table-loading, .table-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-5);
  color: var(--text-tertiary);
  gap: var(--spacer-2);
}

.btn {
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
}

.btn-primary { background: var(--accent-base); color: white; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--divider-stroke); }
.btn-ghost:hover { background: var(--subtle-secondary); }
.btn-sm { padding: 4px var(--spacer-2); font-size: var(--font-size-xs); }

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
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  width: 560px;
  max-width: 92vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-lg { width: 640px; }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.modal-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.modal-close {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.modal-close:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.modal-body {
  padding: var(--spacer-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  overflow-y: auto;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-3);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.form-group label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  font-weight: 500;
}

.required { color: var(--status-error); }

.form-group input,
.form-group select {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--accent-base);
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 权限配置 */
.perms-section {
  margin-top: var(--spacer-2);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.perms-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacer-3);
}

.perms-hint {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 400;
}

.perms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--spacer-2);
}

.perm-check {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  background: var(--card-bg);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.perm-check:hover {
  background: var(--subtle-pressed);
}

.perm-check input[type="checkbox"] {
  margin-top: 2px;
  cursor: pointer;
}

.perm-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  flex-shrink: 0;
}

.perm-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-left: var(--spacer-1);
}

.modal-tip {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  padding: var(--spacer-2);
  border-radius: var(--radius-md);
  margin: 0;
}

.empty-bindings {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--spacer-5);
  color: var(--text-tertiary);
  gap: var(--spacer-2);
  text-align: center;
}

.binding-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.binding-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.binding-info {
  flex: 1;
}

.binding-username {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.binding-meta {
  display: flex;
  gap: var(--spacer-2);
  margin-top: 4px;
  flex-wrap: wrap;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  background: var(--subtle-pressed);
  color: var(--text-secondary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
