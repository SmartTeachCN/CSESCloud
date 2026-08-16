<template>
  <div class="data-export-page">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">数据导出</h1>
        <p class="page-description">选择数据类型和条件，生成导出文件</p>
      </div>
    </div>

    <div class="export-layout">
      <div class="export-form">
        <div class="panel">
          <div class="panel-header">
            <h3 class="panel-title">导出配置</h3>
          </div>
          <div class="panel-body">
            <div class="form-section">
              <label class="section-label">选择导出类型</label>
              <div class="type-grid">
                <button
                  v-for="type in exportTypes"
                  :key="type.key"
                  class="type-card"
                  :class="{ active: form.type === type.key }"
                  @click="form.type = type.key"
                >
                  <div class="type-icon"><Icon :icon="type.icon" :size="20" /></div>
                  <div class="type-info">
                    <div class="type-name">{{ type.label }}</div>
                    <div class="type-desc">{{ type.desc }}</div>
                  </div>
                  <div class="type-check" v-if="form.type === type.key">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.7803 4.28033C13.9756 4.47559 13.9756 4.79218 13.7803 4.98744L6.78033 11.9874C6.58507 12.1827 6.26848 12.1827 6.07322 11.9874L2.79773 8.71195C2.60247 8.51669 2.60247 8.2001 2.79773 8.00484C2.99299 7.80958 3.30958 7.80958 3.50484 8.00484L6.42678 10.9268L12.0732 4.28033C12.2684 4.08507 12.585 4.08507 12.7803 4.28033L13.7803 4.28033Z" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>

            <div class="form-section">
              <label class="section-label">日期范围</label>
              <div class="date-row">
                <input type="date" v-model="form.startDate" class="form-input" />
                <span class="date-sep">至</span>
                <input type="date" v-model="form.endDate" class="form-input" />
              </div>
              <div class="quick-ranges">
                <button
                  v-for="range in quickRanges"
                  :key="range.key"
                  class="chip"
                  :class="{ active: form.quickRange === range.key }"
                  @click="setQuickRange(range.key)"
                >{{ range.label }}</button>
              </div>
            </div>

            <div class="form-section">
              <label class="section-label">格式选项</label>
              <div class="format-options">
                <button
                  v-for="fmt in formats"
                  :key="fmt.key"
                  class="format-card"
                  :class="{ active: form.format === fmt.key }"
                  @click="form.format = fmt.key"
                >
                  <div class="format-icon"><Icon :icon="fmt.icon" :size="28" /></div>
                  <div class="format-name">{{ fmt.label }}</div>
                </button>
              </div>
            </div>

            <div class="form-section">
              <label class="section-label">包含字段</label>
              <div class="fields-list">
                <label v-for="field in exportFields" :key="field.key" class="field-item">
                  <input type="checkbox" v-model="field.selected" />
                  <span class="field-label">{{ field.label }}</span>
                </label>
              </div>
            </div>

            <div class="form-actions">
              <button class="btn btn-primary btn-large" :disabled="isExporting" @click="startExport">
                <svg v-if="!isExporting" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5C8.27614 1.5 8.5 1.72386 8.5 2V7.69058L10.9976 5.19305C11.1928 4.99779 11.5094 4.99779 11.7047 5.19305C11.9 5.38831 11.9 5.7049 11.7047 5.90016L8.59017 9.01465C8.39491 9.20991 8.07832 9.20991 7.88306 9.01465L4.76858 5.90016C4.57332 5.7049 4.57332 5.38831 4.76858 5.19305C4.96384 4.99779 5.28043 4.99779 5.47569 5.19305L7.97322 7.69058V2ZM2.5 13.5C2.5 13.2239 2.72386 13 3 13H13C13.2761 13 13.5 13.2239 13.5 13.5C13.5 13.7761 13.2761 14 13 14H3C2.72386 14 2.5 13.7761 2.5 13.5Z" />
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="spinning">
                  <path d="M8 1.5C8 1.22386 8.22386 1 8.5 1C12.6421 1 16 4.35786 16 8.5C16 12.6421 12.6421 16 8.5 16C4.35786 16 1 12.6421 1 8.5C1 8.22386 1.22386 8 1.5 8C1.77614 8 2 8.22386 2 8.5C2 12.0817 4.91828 15 8.5 15C12.0817 15 15 12.0817 15 8.5C15 4.91828 12.0817 2 8.5 2C8.22386 2 8 1.77614 8 1.5Z" />
                </svg>
                {{ isExporting ? '导出中...' : '开始导出' }}
              </button>
              <span class="form-hint">{{ estimatedSize }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="export-sidebar">
        <div class="panel">
          <div class="panel-header">
            <h3 class="panel-title">导出历史</h3>
          </div>
          <div class="panel-body history-list">
            <div v-for="item in exportHistory" :key="item.id" class="history-item">
              <div class="history-icon" :class="item.status">{{ getHistoryIcon(item.status) }}</div>
              <div class="history-content">
                <div class="history-name">{{ item.name }}</div>
                <div class="history-meta">{{ item.time }} · {{ item.size }}</div>
              </div>
              <button v-if="item.status === 'completed'" class="icon-btn-sm" title="下载">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5C8.27614 1.5 8.5 1.72386 8.5 2V7.69058L10.9976 5.19305C11.1928 4.99779 11.5094 4.99779 11.7047 5.19305C11.9 5.38831 11.9 5.7049 11.7047 5.90016L8.59017 9.01465C8.39491 9.20991 8.07832 9.20991 7.88306 9.01465L4.76858 5.90016C4.57332 5.7049 4.57332 5.38831 4.76858 5.19305C4.96384 4.99779 5.28043 4.99779 5.47569 5.19305L7.97322 7.69058V2ZM2.5 13.5C2.5 13.2239 2.72386 13 3 13H13C13.2761 13 13.5 13.2239 13.5 13.5C13.5 13.7761 13.2761 14 13 14H3C2.72386 14 2.5 13.7761 2.5 13.5Z" />
                </svg>
              </button>
            </div>
            <div v-if="exportHistory.length === 0" class="empty-state-sm">
              暂无导出记录
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h3 class="panel-title">导出说明</h3>
          </div>
          <div class="panel-body help-content">
            <ul class="help-list">
              <li>导出任务通常在后台处理，完成后会出现在历史记录中。</li>
              <li>CSV 格式适合数据迁移和简单分析。</li>
              <li>Excel 格式包含完整数据和格式支持。</li>
              <li>PDF 格式适合生成正式报告。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';

type ExportType = 'class' | 'student' | 'audit' | 'service';
type ExportFormat = 'csv' | 'xlsx' | 'pdf';

interface FormState {
  type: ExportType;
  startDate: string;
  endDate: string;
  format: ExportFormat;
  quickRange: string;
}

const isExporting = ref(false);

const form = reactive<FormState>({
  type: 'class',
  startDate: '',
  endDate: '',
  format: 'xlsx',
  quickRange: ''
});

const exportTypes = [
  { key: 'class' as const, icon: 'ri-book-open-line', label: '班级数据', desc: '班级配置与学生名单' },
  { key: 'student' as const, icon: 'ri-graduation-cap-line', label: '学生数据', desc: '学生详细信息与成绩' },
  { key: 'audit' as const, icon: 'ri-file-list-3-line', label: '操作日志', desc: '系统操作审计记录' },
  { key: 'service' as const, icon: 'ri-plug-line', label: '服务状态', desc: '服务运行指标快照' }
];

const quickRanges = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'quarter', label: '本季度' }
];

const formats = [
  { key: 'csv' as const, icon: 'ri-file-2-line', label: 'CSV' },
  { key: 'xlsx' as const, icon: 'ri-bar-chart-line', label: 'Excel' },
  { key: 'pdf' as const, icon: 'ri-book-2-line', label: 'PDF' }
];

const exportFields = reactive([
  { key: 'id', label: '编号', selected: true },
  { key: 'name', label: '名称', selected: true },
  { key: 'created', label: '创建时间', selected: true },
  { key: 'updated', label: '更新时间', selected: true },
  { key: 'operator', label: '操作人', selected: false },
  { key: 'metadata', label: '元数据', selected: false }
]);

const estimatedSize = computed(() => {
  const base = exportFields.filter(f => f.selected).length * 50;
  return `预计大小约 ${base}KB - ${base * 2}KB`;
});

const exportHistory = ref([
  { id: 'h1', name: '2024春季学生数据', time: '2 小时前', size: '2.3MB', status: 'completed' },
  { id: 'h2', name: '系统操作日志(1月)', time: '昨天', size: '856KB', status: 'completed' },
  { id: 'h3', name: '服务运行状态报告', time: '3 天前', size: '128KB', status: 'failed' }
]);

function setQuickRange(key: string) {
  form.quickRange = key;
  const now = new Date();
  const start = new Date();
  switch (key) {
    case 'today': break;
    case 'week': start.setDate(now.getDate() - 7); break;
    case 'month': start.setMonth(now.getMonth() - 1); break;
    case 'quarter': start.setMonth(now.getMonth() - 3); break;
  }
  form.startDate = start.toISOString().slice(0, 10);
  form.endDate = now.toISOString().slice(0, 10);
}

function getHistoryIcon(status: string): string {
  return status === 'completed' ? 'ri-checkbox-circle-line' : status === 'failed' ? 'ri-close-circle-line' : 'ri-time-line';
}

function startExport() {
  isExporting.value = true;
  setTimeout(() => {
    isExporting.value = false;
    exportHistory.value.unshift({
      id: 'h' + Date.now(),
      name: `${exportTypes.find(t => t.key === form.type)?.label}导出`,
      time: '刚刚',
      size: '1.5MB',
      status: 'completed'
    });
  }, 2000);
}
</script>

<style scoped>
.data-export-page {
  padding: var(--spacer-5);
  max-width: 1300px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-5);
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

.export-layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--spacer-5);
}

@media (max-width: 1024px) {
  .export-layout {
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
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.panel-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.panel-body {
  padding: var(--spacer-4);
}

.form-section {
  margin-bottom: var(--spacer-5);
}

.form-section:last-child {
  margin-bottom: 0;
}

.section-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacer-2);
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacer-2);
}

.type-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: background var(--fast-duration), border-color var(--fast-duration);
  position: relative;
}

.type-card:hover {
  background: var(--subtle-pressed);
}

.type-card.active {
  border-color: var(--accent-base);
  background: rgba(0, 103, 192, 0.05);
}

.type-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.type-info {
  flex: 1;
}

.type-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.type-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.type-check {
  color: var(--accent-base);
}

.date-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-2);
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
  flex: 1;
}

.form-input:focus {
  border-color: var(--accent-base);
}

.date-sep {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.quick-ranges {
  display: flex;
  gap: var(--spacer-1);
}

.chip {
  padding: var(--spacer-1) var(--spacer-3);
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

.format-options {
  display: flex;
  gap: var(--spacer-3);
}

.format-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-4);
  background: var(--subtle-secondary);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--fast-duration), border-color var(--fast-duration);
}

.format-card:hover {
  background: var(--subtle-pressed);
}

.format-card.active {
  border-color: var(--accent-base);
  background: rgba(0, 103, 192, 0.05);
}

.format-icon {
  font-size: 32px;
}

.format-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.fields-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacer-2);
}

.field-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: background var(--fast-duration);
}

.field-item:hover {
  background: var(--subtle-pressed);
}

.field-item input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--accent-base);
}

.field-label {
  user-select: none;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-4);
  padding-top: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
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
  border: none;
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-large {
  padding: var(--spacer-3) var(--spacer-5);
  font-size: var(--font-size-base);
}

.form-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.export-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  max-height: 300px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  border-radius: var(--radius-sm);
  transition: background var(--fast-duration);
}

.history-item:hover {
  background: var(--subtle-secondary);
}

.history-icon {
  font-size: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.history-icon.completed {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
}

.history-icon.failed {
  background: rgba(196, 43, 28, 0.1);
  color: #C42B1C;
}

.history-icon.processing {
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
}

.history-content {
  flex: 1;
  min-width: 0;
}

.history-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
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
  color: var(--accent-base);
}

.empty-state-sm {
  text-align: center;
  padding: var(--spacer-4);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.help-content {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.help-list {
  margin: 0;
  padding-left: var(--spacer-4);
  line-height: 1.8;
}

.help-list li {
  margin-bottom: var(--spacer-1);
}
</style>