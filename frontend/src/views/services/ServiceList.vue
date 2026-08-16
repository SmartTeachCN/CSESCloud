<template>
  <div class="service-list">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">服务管理</h1>
        <p class="page-description">管理后端微服务的运行状态与健康检查</p>
      </div>
      <div class="page-header-right">
        <div class="search-bar">
          <input type="text" v-model="searchQuery" placeholder="搜索服务..." />
        </div>
        <button class="btn btn-primary" @click="refreshAll">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2C4.68623 2 2 4.68623 2 8C2 11.3138 4.68623 14 8 14C11.3138 14 14 11.3138 14 8C14 4.68623 11.3138 2 8 2ZM8 3C10.7614 3 13 5.23858 13 8C13 10.7614 10.7614 13 8 13C5.23858 13 3 10.7614 3 8C3 5.23858 5.23858 3 8 3ZM7.5 4.5C7.22386 4.5 7 4.72386 7 5V8.5C7 8.77614 7.22386 9 7.5 9H10.5C10.7761 9 11 8.77614 11 8.5C11 8.22386 10.7761 8 10.5 8H8V5C8 4.72386 7.77614 4.5 7.5 4.5Z" />
          </svg>
          全部刷新
        </button>
      </div>
    </div>

    <div class="service-stats">
      <div class="stat-card" v-for="stat in stats" :key="stat.label">
        <div class="stat-value" :style="{ color: stat.color }">{{ stat.value }}</div>
        <div class="stat-label">{{ stat.label }}</div>
      </div>
    </div>

    <div class="service-grid">
      <div
        v-for="service in filteredServices"
        :key="service.id"
        class="service-card"
      >
        <div class="card-header">
          <div class="service-icon" :style="{ background: service.color }">
            <Icon :icon="service.icon" :size="22" />
          </div>
          <div class="service-info">
            <div class="service-name">{{ service.name }}</div>
            <div class="service-type">{{ service.type }}</div>
          </div>
          <div class="status-badge" :class="service.status">
            <span class="status-dot"></span>
            {{ getStatusLabel(service.status) }}
          </div>
        </div>

        <div class="card-body">
          <div class="metrics-row">
            <div class="metric-chip">
              <span class="chip-label">延迟</span>
              <span class="chip-value" :class="{ warn: service.latency > 200 }">{{ service.latency }}ms</span>
            </div>
            <div class="metric-chip">
              <span class="chip-label">QPS</span>
              <span class="chip-value">{{ service.qps }}</span>
            </div>
            <div class="metric-chip">
              <span class="chip-label">CPU</span>
              <span class="chip-value" :class="{ warn: service.cpu > 80 }">{{ service.cpu }}%</span>
            </div>
            <div class="metric-chip">
              <span class="chip-label">内存</span>
              <span class="chip-value">{{ service.memory }}MB</span>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <div class="uptime-info">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5C3.85786 1.5 0.5 4.85786 0.5 9C0.5 13.1421 3.85786 16.5 8 16.5C12.1421 16.5 15.5 13.1421 15.5 9C15.5 4.85786 12.1421 1.5 8 1.5ZM8 3C11.3137 3 14 5.68629 14 9C14 12.3137 11.3137 15 8 15C4.68629 15 2 12.3137 2 9C2 5.68629 4.68629 3 8 3ZM7.25 4.75C7.25 4.33579 7.58579 4 8 4C8.41421 4 8.75 4.33579 8.75 4.75V8.68934L11.7314 10.4056C12.0982 10.6186 12.1624 11.1348 11.9493 11.5016C11.7363 11.8684 11.2201 11.9326 10.8533 11.7196L7.54765 9.81079C7.33284 9.68654 7.2 9.45007 7.2 9.19678V4.75Z" />
            </svg>
            运行 {{ service.uptime }}
          </div>
          <div class="card-actions">
            <button
              class="btn btn-ghost-sm"
              :disabled="service.healthChecking"
              @click="runHealthCheck(service)"
            >
              <svg v-if="!service.healthChecking" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.7803 4.28033C13.9756 4.47559 13.9756 4.79218 13.7803 4.98744L6.78033 11.9874C6.58507 12.1827 6.26848 12.1827 6.07322 11.9874L2.79773 8.71195C2.60247 8.51669 2.60247 8.2001 2.79773 8.00484C2.99299 7.80958 3.30958 7.80958 3.50484 8.00484L6.42678 10.9268L12.0732 4.28033C12.2684 4.08507 12.585 4.08507 12.7803 4.28033L13.7803 4.28033Z" />
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="currentColor" class="spinning">
                <path d="M8 1.5C8 1.22386 8.22386 1 8.5 1C12.6421 1 16 4.35786 16 8.5C16 12.6421 12.6421 16 8.5 16C4.35786 16 1 12.6421 1 8.5C1 8.22386 1.22386 8 1.5 8C1.77614 8 2 8.22386 2 8.5C2 12.0817 4.91828 15 8.5 15C12.0817 15 15 12.0817 15 8.5C15 4.91828 12.0817 2 8.5 2C8.22386 2 8 1.77614 8 1.5Z" />
              </svg>
              {{ service.healthChecking ? '检查中...' : '健康检查' }}
            </button>
            <button
              class="btn"
              :class="service.status === 'running' ? 'btn-danger-sm' : 'btn-success-sm'"
              @click="toggleService(service)"
            >
              {{ service.status === 'running' ? '停止' : '启动' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="filteredServices.length === 0" class="empty-state">
      <div class="empty-icon"><Icon icon="ri-plug-line" :size="48" /></div>
      <div class="empty-text">未找到匹配的服务</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

type ServiceStatus = 'running' | 'stopped' | 'error';

interface ServiceItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  color: string;
  status: ServiceStatus;
  latency: number;
  qps: number;
  cpu: number;
  memory: number;
  uptime: string;
  healthChecking: boolean;
}

const searchQuery = ref('');

const services = ref<ServiceItem[]>([
  { id: 'svc-api-gw', name: 'API 网关', type: 'Kong Gateway', icon: 'ri-globe-line', color: '#0067C0', status: 'running', latency: 45, qps: 1240, cpu: 32, memory: 1024, uptime: '14d 6h', healthChecking: false },
  { id: 'svc-auth', name: '认证服务', type: 'OAuth2 / JWT', icon: 'ri-shield-keyhole-line', color: '#6A1B9A', status: 'running', latency: 32, qps: 890, cpu: 18, memory: 512, uptime: '14d 6h', healthChecking: false },
  { id: 'svc-db', name: '数据库服务', type: 'PostgreSQL 16', icon: 'ri-database-2-line', color: '#00897B', status: 'running', latency: 12, qps: 3450, cpu: 67, memory: 4096, uptime: '14d 6h', healthChecking: false },
  { id: 'svc-file', name: '文件服务', type: 'MinIO Object Storage', icon: 'ri-folder-line', color: '#2E7D32', status: 'error', latency: 520, qps: 89, cpu: 92, memory: 2048, uptime: '2h 14m', healthChecking: false }
]);

const filteredServices = computed(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return services.value;
  return services.value.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.type.toLowerCase().includes(query)
  );
});

const stats = computed(() => [
  { label: '运行中', value: services.value.filter(s => s.status === 'running').length, color: 'var(--status-success)' },
  { label: '已停止', value: services.value.filter(s => s.status === 'stopped').length, color: 'var(--text-tertiary)' },
  { label: '异常', value: services.value.filter(s => s.status === 'error').length, color: 'var(--status-error)' },
  { label: '总服务', value: services.value.length, color: 'var(--accent-base)' }
]);

function getStatusLabel(status: ServiceStatus): string {
  const map: Record<ServiceStatus, string> = { running: '运行中', stopped: '已停止', error: '异常' };
  return map[status];
}

function runHealthCheck(service: ServiceItem) {
  service.healthChecking = true;
  setTimeout(() => {
    service.healthChecking = false;
  }, 1500);
}

function toggleService(service: ServiceItem) {
  service.status = service.status === 'running' ? 'stopped' : 'running';
}

function refreshAll() {
  services.value.forEach(s => {
    s.healthChecking = true;
    setTimeout(() => { s.healthChecking = false; }, 1200);
  });
}
</script>

<style scoped>
.service-list {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.btn-success-sm {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.btn-success-sm:hover {
  background: rgba(16, 124, 16, 0.18);
}

.btn-danger-sm {
  background: rgba(196, 43, 28, 0.1);
  color: var(--status-error);
}

.btn-danger-sm:hover {
  background: rgba(196, 43, 28, 0.18);
}

.service-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-5);
}

.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
  text-align: center;
}

.stat-value {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--spacer-4);
}

.service-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: box-shadow var(--fast-duration), transform var(--fast-duration);
}

.service-card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.service-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.service-info {
  flex: 1;
  min-width: 0;
}

.service-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.service-type {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.card-body {
  padding: var(--spacer-4);
}

.metrics-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacer-2);
}

.metric-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  text-align: center;
}

.chip-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.chip-value {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.chip-value.warn {
  color: var(--status-warning);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.uptime-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.card-actions {
  display: flex;
  gap: var(--spacer-2);
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
</style>