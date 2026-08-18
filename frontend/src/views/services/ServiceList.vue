<template>
  <div class="service-list">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">服务概览</h1>
        <p class="page-description">服务器后端运行概况与各功能服务的实时状态</p>
      </div>
      <div class="page-header-right">
        <div class="meta-status">
          <span class="live-dot"></span>
          <span>自动刷新 · 每 15 秒</span>
        </div>
        <button class="btn btn-primary" @click="load" :disabled="loading">
          <svg v-if="loading" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="spinning">
            <path d="M8 1.5C8 1.22386 8.22386 1 8.5 1C12.6421 1 16 4.35786 16 8.5C16 12.6421 12.6421 16 8.5 16C4.35786 16 1 12.6421 1 8.5C1 8.22386 1.22386 8 1.5 8C1.77614 8 2 8.22386 2 8.5C2 12.0817 4.91828 15 8.5 15C12.0817 15 15 12.0817 15 8.5C15 4.91828 12.0817 2 8.5 2C8.22386 2 8 1.77614 8 1.5Z" />
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2C4.68623 2 2 4.68623 2 8C2 11.3138 4.68623 14 8 14C11.3138 14 14 11.3138 14 8C14 4.68623 11.3138 2 8 2ZM8 3C10.7614 3 13 5.23858 13 8C13 10.7614 10.7614 13 8 13C5.23858 13 3 10.7614 3 8C3 5.23858 5.23858 3 8 3ZM7.5 4.5C7.22386 4.5 7 4.72386 7 5V8.5C7 8.77614 7.22386 9 7.5 9H10.5C10.7761 9 11 8.77614 11 8.5C11 8.22386 10.7761 8 10.5 8H8V5C8 4.72386 7.77614 4.5 7.5 4.5Z" />
          </svg>
          刷新
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      <Icon icon="ri-alert-line" :size="16" />
      <span>{{ error }}</span>
    </div>

    <!-- 服务器资源 -->
    <section class="section">
      <div class="section-title">
        <Icon icon="ri-computer-line" :size="18" />
        <span>服务器资源</span>
      </div>
      <div class="resource-grid">
        <div class="resource-card">
          <div class="resource-head">
            <span class="resource-label">CPU 负载</span>
            <span class="resource-value" :class="{ warn: cpuPercent > 80 }">{{ cpuPercent }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="barClass(cpuPercent)" :style="{ width: cpuPercent + '%' }"></div>
          </div>
          <div class="resource-note">{{ server.cpuCount }} 核 · 1 分钟负载 {{ fmtLoad(server.loadAvg && server.loadAvg[0]) }}</div>
        </div>

        <div class="resource-card">
          <div class="resource-head">
            <span class="resource-label">内存使用</span>
            <span class="resource-value" :class="{ warn: memPercent > 85 }">{{ memPercent }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="barClass(memPercent)" :style="{ width: memPercent + '%' }"></div>
          </div>
          <div class="resource-note">已用 {{ formatBytes(usedMem) }} / 共 {{ formatBytes(server.totalMem) }}</div>
        </div>

        <div class="resource-card">
          <div class="resource-head">
            <span class="resource-label">磁盘使用</span>
            <span class="resource-value" :class="{ warn: diskPercent > 85 }">{{ diskPercent }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="barClass(diskPercent)" :style="{ width: diskPercent + '%' }"></div>
          </div>
          <div class="resource-note" v-if="server.disk">已用 {{ formatBytes(diskUsed) }} / 共 {{ formatBytes(server.disk.total) }}</div>
        </div>

        <div class="resource-card">
          <div class="resource-head">
            <span class="resource-label">进程占用</span>
            <span class="resource-value">{{ formatBytes(server.memUsage && server.memUsage.rss) }}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill bar-warn" :style="{ width: clamp(processPercent) + '%' }"></div>
          </div>
          <div class="resource-note">堆 {{ formatBytes(server.memUsage && server.memUsage.heapUsed) }} · 进程 PID {{ server.pid }}</div>
        </div>
      </div>
    </section>

    <!-- 运行信息 -->
    <section class="section">
      <div class="section-title">
        <Icon icon="ri-dashboard-line" :size="18" />
        <span>运行信息</span>
      </div>
      <div class="info-blocks">
        <div class="info-block">
          <Icon icon="ri-timer-flash-line" :size="20" />
          <div>
            <div class="info-label">已运行</div>
            <div class="info-value">{{ formatUptime(server.processUptime) }}</div>
          </div>
        </div>
        <div class="info-block">
          <Icon icon="ri-hashtag-line" :size="20" />
          <div>
            <div class="info-label">Node.js 版本</div>
            <div class="info-value">{{ server.nodeVersion }}</div>
          </div>
        </div>
        <div class="info-block">
          <Icon icon="ri-database-2-line" :size="20" />
          <div>
            <div class="info-label">数据库</div>
            <div class="info-value">
              <span class="status-text" :class="database.ok ? 'ok' : 'bad'">{{ database.ok ? '正常' : '异常' }}</span>
              <span class="info-sub">{{ database.tables }} 张表 · {{ formatBytes(database.sizeBytes) }}</span>
            </div>
          </div>
        </div>
        <div class="info-block">
          <Icon icon="ri-wifi-line" :size="20" />
          <div>
            <div class="info-label">WebSocket 网关</div>
            <div class="info-value">
              <span class="status-text" :class="ws.ok ? 'ok' : 'bad'">{{ ws.ok ? '已挂载' : '未挂载' }}</span>
              <span class="info-sub" v-if="ws.ok">活跃连接 {{ ws.sockets }}</span>
            </div>
          </div>
        </div>
        <div class="info-block">
          <Icon icon="ri-terminal-box-line" :size="20" />
          <div>
            <div class="info-label">运行环境</div>
            <div class="info-value">{{ server.platform }} / {{ server.arch }}</div>
          </div>
        </div>
        <div class="info-block">
          <Icon icon="ri-server-line" :size="20" />
          <div>
            <div class="info-label">主机名</div>
            <div class="info-value">{{ server.hostname }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 各服务运行情况 -->
    <section class="section" v-for="group in serviceGroups" :key="group.name">
      <div class="section-title">
        <Icon icon="ri-stack-line" :size="18" />
        <span>{{ group.name }}</span>
        <span class="section-count">{{ runningCount(group.items) }}/{{ group.items.length }} 运行中</span>
      </div>
      <div class="service-grid">
        <div v-for="service in group.items" :key="service.id" class="service-card">
          <div class="card-header">
            <div class="service-icon" :style="{ background: hexToRgba(service.color) , color: service.color }">
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
                <span class="chip-label">状态</span>
                <span class="chip-value" :class="{ warn: service.status === 'error' }">{{ getStatusLabel(service.status) }}</span>
              </div>
              <div class="metric-chip">
                <span class="chip-label">响应</span>
                <span class="chip-value">{{ service.latency }}ms</span>
              </div>
              <div class="metric-chip wide">
                <span class="chip-label">详情</span>
                <span class="chip-value chip-detail" :title="service.detail">{{ service.detail }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!loading && !error && serviceGroups.length === 0" class="empty-state">
      <div class="empty-icon"><Icon icon="ri-server-line" :size="48" /></div>
      <div class="empty-text">暂无服务数据</div>
    </div>

    <div v-if="loading && !server.data" class="loading-state">
      <div class="spinning big"><Icon icon="ri-loader-4-line" :size="40" /></div>
      <div class="loading-text">正在读取服务器运行数据...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '../../api/client';

type Status = 'running' | 'stopped' | 'error';

interface ServiceItem {
  id: string;
  name: string;
  type: string;
  group: string;
  icon: string;
  color: string;
  status: Status;
  latency: number;
  detail: string;
}

const error = ref('');
const loading = ref(false);
const server = ref<any>({});
const database = ref<any>({});
const ws = ref<any>({});
const services = ref<ServiceItem[]>([]);

let timer: ReturnType<typeof setInterval> | null = null;

const serviceGroups = computed(() => {
  const names: string[] = [];
  for (const s of services.value) {
    if (s.group && !names.includes(s.group)) names.push(s.group);
  }
  return names.map((name) => ({ name, items: services.value.filter((s) => s.group === name) }));
});

const cpuPercent = computed(() => {
  const load = server.value.loadAvg && server.value.loadAvg[0];
  const cores = server.value.cpuCount || 1;
  if (load === undefined) return 0;
  return clamp(Math.round((load / cores) * 100));
});

const memPercent = computed(() => {
  if (!server.value.totalMem) return 0;
  return clamp(Math.round(((server.value.totalMem - server.value.freeMem) / server.value.totalMem) * 100));
});

const usedMem = computed(() => (server.value.totalMem || 0) - (server.value.freeMem || 0));

const diskPercent = computed(() => {
  const d = server.value.disk;
  if (!d || !d.total) return 0;
  return clamp(Math.round(((d.total - d.free) / d.total) * 100));
});

const diskUsed = computed(() => {
  const d = server.value.disk;
  if (!d) return 0;
  return (d.total || 0) - (d.free || 0);
});

const processPercent = computed(() => {
  if (!server.value.totalMem) return 0;
  const rss = (server.value.memUsage && server.value.memUsage.rss) || 0;
  return clamp(Math.round((rss / server.value.totalMem) * 100));
});

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function fmtLoad(v: number | undefined): string {
  if (v === undefined || v === null) return '--';
  return String(v);
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatUptime(seconds: number): string {
  if (!seconds) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

function hexToRgba(hex?: string): string {
  const h = (hex || '#888').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

function barClass(pct: number): string {
  if (pct > 85) return 'bar-danger';
  if (pct > 70) return 'bar-warn';
  return 'bar-ok';
}

function getStatusLabel(status: Status): string {
  const map: Record<Status, string> = { running: '运行中', stopped: '已停止', error: '异常' };
  return map[status] || status;
}

function runningCount(items: ServiceItem[]): number {
  return items.filter((s) => s.status === 'running').length;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get<any>('/services?action=overview');
    server.value = data.server || {};
    database.value = data.database || {};
    ws.value = data.ws || {};
    services.value = data.services || [];
  } catch (e: any) {
    error.value = e?.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  timer = setInterval(load, 15000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.service-list {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
}

.meta-status {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-right: var(--spacer-3);
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-success);
  box-shadow: 0 0 0 0 rgba(16, 124, 16, 0.4);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 124, 16, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(16, 124, 16, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 124, 16, 0); }
}

.error-banner {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  background: rgba(196, 43, 28, 0.1);
  color: var(--status-error);
  border-radius: var(--radius-md);
  padding: var(--spacer-3) var(--spacer-4);
  margin-bottom: var(--spacer-4);
  font-size: var(--font-size-sm);
}

.section {
  margin-bottom: var(--spacer-5);
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacer-3);
}

.section-count {
  font-size: var(--font-size-xs);
  font-weight: 400;
  color: var(--text-tertiary);
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--spacer-3);
}

.resource-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
}

.resource-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--spacer-3);
}

.resource-label {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.resource-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.resource-value.warn { color: var(--status-warning); }

.progress-track {
  height: 8px;
  background: var(--subtle-secondary);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.5s ease, background 0.3s ease;
}

.bar-ok { background: var(--status-success); }
.bar-warn { background: var(--status-warning); }
.bar-danger { background: var(--status-error); }

.resource-note {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: var(--spacer-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-blocks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--spacer-3);
}

.info-block {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
  color: var(--accent-base);
}

.info-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.info-value {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 2px;
}

.info-sub {
  font-weight: 400;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-left: var(--spacer-2);
}

.status-text.ok { color: var(--status-success); }
.status-text.bad { color: var(--status-error); }

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

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  flex-shrink: 0;
}

.status-badge.running { background: rgba(16, 124, 16, 0.12); color: var(--status-success); }
.status-badge.stopped { background: var(--subtle-secondary); color: var(--text-tertiary); }
.status-badge.error { background: rgba(196, 43, 28, 0.12); color: var(--status-error); }

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.card-body {
  padding: var(--spacer-4);
}

.metrics-row {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: var(--spacer-2);
}

.metric-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
}

.metric-chip.wide {
  min-width: 0;
  flex: 1;
  grid-column: span 1;
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

.chip-value.warn { color: var(--status-error); }

.chip-detail {
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
  text-align: center;
  padding: var(--spacer-12);
}

.empty-icon {
  margin-bottom: var(--spacer-3);
  color: var(--text-tertiary);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.loading-state {
  text-align: center;
  padding: var(--spacer-12);
  color: var(--text-tertiary);
}

.spinning { animation: spin 1s linear infinite; }
.spinning.big { display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

.loading-text {
  margin-top: var(--spacer-3);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>