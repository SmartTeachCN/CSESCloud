<template>
  <div class="class-list">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">班级列表</h1>
        <p class="page-description">管理所有班级和学生</p>
      </div>
      <div class="page-header-right">
        <div class="search-bar">
          <input type="text" v-model="searchQuery" placeholder="搜索班级..." />
        </div>
        <button class="btn btn-primary" @click="showNewClass = true">
          <span>+</span> 新建班级
        </button>
      </div>
    </div>

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>班级名称</th>
            <th>班主任</th>
            <th>学生人数</th>
            <th>状态</th>
            <th>最近活动</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cls in filteredClasses" :key="cls.id" class="table-row">
            <td>
              <div class="class-name">{{ cls.name }}</div>
              <div class="class-code">{{ cls.code }}</div>
            </td>
            <td>{{ cls.teacher }}</td>
            <td>
              <span class="student-count">{{ cls.studentCount }}</span>
            </td>
            <td>
              <span class="status-badge" :class="cls.status">
                <span class="status-dot"></span>
                {{ cls.status === 'active' ? '活跃' : '暂停' }}
              </span>
            </td>
            <td class="time-cell">{{ cls.lastActive }}</td>
            <td>
              <div class="row-actions">
                <button class="action-btn" title="编辑"><Icon icon="ri-edit-2-line" :size="16" /></button>
                <button class="action-btn" title="删除"><Icon icon="ri-delete-bin-line" :size="16" /></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredClasses.length === 0" class="empty-state">
        <div class="empty-icon"><Icon icon="ri-inbox-archive-line" :size="48" /></div>
        <div class="empty-text">未找到匹配的班级</div>
      </div>
    </div>

    <div class="pagination">
      <button class="page-btn" :disabled="currentPage === 1">上一页</button>
      <button
        v-for="page in totalPages"
        :key="page"
        class="page-btn"
        :class="{ active: page === currentPage }"
        @click="currentPage = page"
      >
        {{ page }}
      </button>
      <button class="page-btn" :disabled="currentPage === totalPages">下一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const searchQuery = ref('');
const currentPage = ref(1);
const showNewClass = ref(false);

const classes = ref([
  { id: 1, name: '计算机科学 2024-1 班', code: 'CS24-1', teacher: '王教授', studentCount: 32, status: 'active', lastActive: '5 分钟前' },
  { id: 2, name: '软件工程 2024-2 班', code: 'SE24-2', teacher: '李教授', studentCount: 28, status: 'active', lastActive: '15 分钟前' },
  { id: 3, name: '人工智能 2024-1 班', code: 'AI24-1', teacher: '张教授', studentCount: 35, status: 'active', lastActive: '30 分钟前' },
  { id: 4, name: '网络安全 2023-2 班', code: 'NS23-2', teacher: '陈教授', studentCount: 30, status: 'paused', lastActive: '2 小时前' },
  { id: 5, name: '数据科学 2024-1 班', code: 'DS24-1', teacher: '刘教授', studentCount: 26, status: 'active', lastActive: '1 小时前' },
  { id: 6, name: '信息技术 2023-1 班', code: 'IT23-1', teacher: '赵教授', studentCount: 34, status: 'paused', lastActive: '3 小时前' },
  { id: 7, name: '游戏开发 2024-1 班', code: 'GD24-1', teacher: '孙教授', studentCount: 24, status: 'active', lastActive: '45 分钟前' },
  { id: 8, name: '机器人技术 2024-2 班', code: 'RT24-2', teacher: '周教授', studentCount: 22, status: 'active', lastActive: '1 小时前' }
]);

const itemsPerPage = 10;

const filteredClasses = computed(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return classes.value;
  return classes.value.filter(c =>
    c.name.toLowerCase().includes(query) ||
    c.code.toLowerCase().includes(query) ||
    c.teacher.toLowerCase().includes(query)
  );
});

const totalPages = computed(() => {
  return Math.max(1, Math.ceil(filteredClasses.value.length / itemsPerPage));
});
</script>

<style scoped>
.class-list {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.table-container {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  text-align: left;
  padding: var(--spacer-3) var(--spacer-4);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
}

.data-table td {
  padding: var(--spacer-3) var(--spacer-4);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  border-bottom: 1px solid var(--divider-stroke);
}

.table-row {
  transition: background var(--fast-duration);
}

.table-row:hover {
  background: var(--subtle-secondary);
}

.class-name {
  font-weight: 600;
}

.class-code {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.student-count {
  font-weight: 600;
}

.time-cell {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.row-actions {
  display: flex;
  gap: var(--spacer-1);
}

.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  transition: background var(--fast-duration);
}

.action-btn:hover {
  background: var(--subtle-secondary);
}

.empty-state {
  text-align: center;
  padding: var(--spacer-8);
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
  justify-content: center;
  gap: var(--spacer-1);
  margin-top: var(--spacer-4);
}

.page-btn {
  min-width: 36px;
  height: 36px;
  padding: 0 var(--spacer-3);
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--fast-duration), background var(--fast-duration);
}

.page-btn:hover:not(:disabled) {
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.page-btn.active {
  background: var(--accent-base);
  color: white;
  border-color: var(--accent-base);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
