<template>
  <div class="instance-detail">
    <div v-if="instanceLoading" class="loading-state">加载中...</div>
    <template v-else-if="instance">
    <div class="detail-header">
      <div class="detail-header-left">
        <div class="instance-icon-lg" :style="{ background: instance.color || '#0067C0' }">
          <Icon :icon="instance.icon || 'ri-globe-line'" :size="28" />
        </div>
        <div class="instance-title">
          <h1>{{ instance.name }}</h1>
          <div class="instance-subtitle">{{ instance.service_type || instance.app_name || '实例' }} · {{ instance.instance_uid }}</div>
        </div>
      </div>
      <div class="detail-header-right">
        <span class="status-badge" :class="instance.status || 'running'">
          <span class="status-dot"></span>
          {{ instance.status === 'running' ? '运行中' : instance.status === 'stopped' ? '已停止' : '运行中' }}
        </span>
      </div>
    </div>

    <div class="detail-content">
      <div class="detail-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="detail-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <Icon :icon="tab.icon" :size="16" /> {{ tab.label }}
        </button>
      </div>

      <div class="detail-panel" v-if="activeTab === 'overview'">
        <div class="info-card">
          <h3>实例信息</h3>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">类型</span><span class="info-value">{{ instance.service_type || '未指定' }}</span></div>
            <div class="info-item"><span class="info-label">应用</span><span class="info-value">{{ instance.app_name || '未绑定' }}</span></div>
            <div class="info-item"><span class="info-label">实例 UID</span><code class="info-value">{{ instance.instance_uid }}</code></div>
            <div class="info-item"><span class="info-label">创建时间</span><span class="info-value">{{ instance.created_at }}</span></div>
          </div>
        </div>
      </div>

      <div class="detail-panel" v-if="activeTab === 'control'">
        <div class="control-section">
          <div class="control-header">
            <h3>REST 设备控制 API</h3>
            <span class="control-badge">v1</span>
          </div>
          <p class="control-desc">
            此实例提供内置 REST 设备控制能力。客户端可通过以下 API 实现设备注册、命令下发、状态上报等功能。
            此 API 非 EA2 专属，任何实例侧应用均可使用。
          </p>

          <div class="control-cards">
            <div class="ctrl-card">
              <div class="ctrl-card-icon">
                <Icon icon="ri-link" :size="20" />
              </div>
              <div class="ctrl-card-body">
                <h4>API 端点</h4>
                <code class="ctrl-url">{{ controlBaseUrl }}</code>
                <p class="ctrl-hint">传递 action 参数选择操作</p>
              </div>
            </div>

            <div class="ctrl-card">
              <div class="ctrl-card-icon enroll">
                <Icon icon="ri-user-add-line" :size="20" />
              </div>
              <div class="ctrl-card-body">
                <h4>设备注册</h4>
                <p class="ctrl-hint">客户端通过注册码注册设备，获取 deviceId 和 credential</p>
                <div class="ctrl-actions">
                  <button class="ctrl-btn" @click="showEnrollmentDialog = true">
                    <Icon icon="ri-key-2-line" :size="14" /> 生成注册码
                  </button>
                </div>
              </div>
            </div>

            <div class="ctrl-card">
              <div class="ctrl-card-icon">
                <Icon icon="ri-smartphone-line" :size="20" />
              </div>
              <div class="ctrl-card-body">
                <h4>在线设备</h4>
                <div class="ctrl-stat">
                  <span class="ctrl-stat-num">{{ devices.length }}</span>
                  <span class="ctrl-stat-label">台已注册</span>
                </div>
                <button class="ctrl-btn" @click="loadDevices">
                  <Icon icon="ri-refresh-line" :size="14" /> 刷新
                </button>
              </div>
            </div>
          </div>

          <!-- 注册码管理 -->
          <div v-if="showEnrollmentDialog" class="enrollment-panel">
            <div class="enrollment-header">
              <h4>注册码管理</h4>
              <button class="dialog-close" @click="showEnrollmentDialog = false">
                <Icon icon="ri-close-line" :size="18" />
              </button>
            </div>
            <div class="enrollment-create">
              <label>标签（可选）</label>
              <div class="enrollment-row">
                <input v-model="enrollmentForm.label" placeholder="如：EA2 教室机器" />
                <input v-model.number="enrollmentForm.maxUses" type="number" min="1" placeholder="最大使用次数" style="width:120px" />
                <input v-model.number="enrollmentForm.validityHours" type="number" min="1" placeholder="有效期(小时)" style="width:120px" />
                <button class="btn btn-primary btn-sm" @click="createEnrollmentCode" :disabled="busy">
                  <Icon icon="ri-add-line" :size="14" /> 生成
                </button>
              </div>
            </div>
            <div v-if="newCode" class="new-code-display">
              <Icon icon="ri-key-2-line" :size="16" />
              <code>{{ newCode }}</code>
              <button class="copy-btn" @click="copyCode" title="复制">
                <Icon icon="ri-file-copy-line" :size="14" />
              </button>
            </div>
            <div v-if="enrollmentCodes.length > 0" class="enrollment-list">
              <div class="table-header">
                <div class="col-label">标签</div>
                <div class="col-uses">使用次数</div>
                <div class="col-expires">过期时间</div>
                <div class="col-status">状态</div>
                <div class="col-actions">操作</div>
              </div>
              <div v-for="code in enrollmentCodes" :key="code.id" class="table-row">
                <div class="col-label"><code>{{ code.code_masked }}</code></div>
                <div class="col-uses">{{ code.used_count }} / {{ code.max_uses }}</div>
                <div class="col-expires">{{ code.expires_at }}</div>
                <div class="col-status">
                  <span class="status-pill" :class="code.revoked_at ? 'archived' : 'published'">
                    {{ code.revoked_at ? '已吊销' : '有效' }}
                  </span>
                </div>
                <div class="col-actions">
                  <button v-if="!code.revoked_at" class="icon-btn-sm danger" @click="revokeCode(code)" :disabled="busy" title="吊销">
                    <Icon icon="ri-close-circle-line" :size="14" />
                  </button>
                  <button v-if="code.revoked_at" class="icon-btn-sm danger" @click="deleteCode(code)" :disabled="busy" title="删除">
                    <Icon icon="ri-delete-bin-line" :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 命令下发 -->
          <div class="command-section">
            <div class="command-header">
              <h4>命令下发</h4>
              <button class="btn btn-primary btn-sm" @click="showCommandPanel = !showCommandPanel" :disabled="!supportedCommands.length">
                <Icon :icon="showCommandPanel ? 'ri-arrow-up-s-line' : 'ri-add-line'" :size="14" />
                {{ showCommandPanel ? '收起' : '新建命令' }}
              </button>
            </div>
            <p v-if="!supportedCommands.length" class="ctrl-hint" style="margin: 0 0 12px;">
              此应用尚未配置支持的命令类型。请在开发者中心编辑应用的「设备控制」清单。
            </p>
            <div v-if="showCommandPanel" class="command-form">
              <div class="form-row">
                <label>命令类型</label>
                <select v-model="commandForm.command_type" class="form-select">
                  <option value="" disabled>选择命令...</option>
                  <option v-for="cmd in supportedCommands" :key="cmd" :value="cmd">{{ cmd }}</option>
                </select>
              </div>
              <div class="form-row">
                <label>目标设备（留空=广播）</label>
                <select v-model="commandForm.device_id" class="form-select">
                  <option value="">广播到所有设备</option>
                  <option v-for="dev in devices" :key="dev.device_id" :value="dev.device_id">{{ dev.display_name }} ({{ dev.device_id.substring(0, 8) }}...)</option>
                </select>
              </div>
              <div class="form-row">
                <label>Payload (JSON)</label>
                <textarea v-model="commandForm.payload" class="form-textarea" rows="4" placeholder='{"key": "value"}'></textarea>
              </div>
              <div class="form-row">
                <label>过期时间（分钟）</label>
                <input v-model.number="commandForm.expires_minutes" type="number" min="1" max="60" class="form-input" style="width:100px" />
              </div>
              <button class="btn btn-primary" @click="sendCommand" :disabled="busy || !commandForm.command_type">
                <Icon icon="ri-send-plane-line" :size="14" /> 下发命令
              </button>
            </div>
          </div>

          <!-- 命令历史 -->
          <div v-if="commands.length > 0" class="command-history">
            <h4>命令历史</h4>
            <div class="table-header">
              <div class="col-type">命令类型</div>
              <div class="col-device">目标设备</div>
              <div class="col-status">状态</div>
              <div class="col-time">下发时间</div>
            </div>
            <div v-for="cmd in commands" :key="cmd.command_id" class="table-row">
              <div class="col-type"><code>{{ cmd.command_type }}</code></div>
              <div class="col-device"><code>{{ cmd.device_id ? cmd.device_id.substring(0, 8) + '...' : '广播' }}</code></div>
              <div class="col-status">
                <span class="status-pill" :class="cmd.status === 'completed' ? 'published' : cmd.status === 'pending' ? 'draft' : 'archived'">
                  {{ cmd.status === 'completed' ? '已完成' : cmd.status === 'pending' ? '等待中' : cmd.status === 'failed' ? '失败' : cmd.status }}
                </span>
              </div>
              <div class="col-time">{{ cmd.issued_at || cmd.created_at }}</div>
            </div>
          </div>

          <!-- 设备列表 -->
          <div v-if="devices.length > 0" class="device-list">
            <h4>已注册设备</h4>
            <div class="table-header">
              <div class="col-name">设备名称</div>
              <div class="col-id">设备 ID</div>
              <div class="col-platform">平台</div>
              <div class="col-status">状态</div>
              <div class="col-last-seen">最后在线</div>
              <div class="col-actions">操作</div>
            </div>
            <div v-for="dev in devices" :key="dev.device_id" class="table-row">
              <div class="col-name">{{ dev.display_name }}</div>
              <div class="col-id"><code>{{ dev.device_id.substring(0, 8) }}...</code></div>
              <div class="col-platform">{{ dev.platform }} / {{ dev.architecture }}</div>
              <div class="col-status">
                <span class="status-pill" :class="dev.lifecycle_status === 'active' ? 'published' : 'archived'">
                  {{ dev.lifecycle_status === 'active' ? '在线' : '已注销' }}
                </span>
              </div>
              <div class="col-last-seen">{{ dev.last_seen_at || '从未' }}</div>
              <div class="col-actions">
                <button class="icon-btn-sm danger" @click="unregisterDevice(dev)" :disabled="busy" title="注销">
                  <Icon icon="ri-delete-bin-line" :size="14" />
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <div class="empty-icon"><Icon icon="ri-smartphone-line" :size="48" /></div>
            <div class="empty-text">暂无已注册设备</div>
            <p class="empty-hint">生成注册码后，客户端可使用注册码连接此实例</p>
          </div>
        </div>
      </div>

      <div class="detail-panel" v-if="activeTab === 'logs'">
        <div class="log-viewer">
          <div class="log-toolbar">
            <span class="log-count">{{ logs.length }} 条日志</span>
            <div class="log-filters">
              <button v-for="level in ['全部', '信息', '警告', '错误']" :key="level" class="filter-btn">{{ level }}</button>
            </div>
          </div>
          <div class="log-list">
            <div v-for="(log, i) in logs" :key="i" class="log-item" :class="log.level">
              <span class="log-time">{{ log.time }}</span>
              <span class="log-level">{{ log.level }}</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-panel" v-if="activeTab === 'config'">
        <div class="config-section">
          <h3>运行配置</h3>
          <div class="config-list">
            <div v-for="(value, key) in config" :key="key" class="config-item">
              <code class="config-key">{{ key }}</code>
              <code class="config-value">{{ value }}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>
    <div v-else class="empty-state">
      <div class="empty-text">实例不存在</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { instancesApi } from '../../api';

const route = useRoute();
const activeTab = ref('overview');
const busy = ref(false);

const instanceId = computed(() => Number(route.params.id || 0));

const controlBaseUrl = computed(() => {
  const inst = instance.value as any;
  const uid = inst?.instance_uid || 'inst-xxx';
  return `/api/control.php?instance_uid=${uid}`;
});

const tabs = [
  { id: 'overview', icon: 'ri-bar-chart-line', label: '概览' },
  { id: 'control', icon: 'ri-remote-control-line', label: '设备控制' },
  { id: 'logs', icon: 'ri-file-list-3-line', label: '日志' },
  { id: 'config', icon: 'ri-settings-3-line', label: '配置' }
];

const instance = ref<any>(null);
const instanceLoading = ref(true);

// 从应用的 control_manifest 中提取支持的命令类型
const supportedCommands = computed(() => {
  const cm = instance.value?.control_manifest;
  if (cm && cm.supportedCommands && Array.isArray(cm.supportedCommands)) {
    return cm.supportedCommands;
  }
  return [];
});

async function loadInstance() {
  instanceLoading.value = true;
  try {
    instance.value = await instancesApi.get(instanceId.value);
  } catch (e: any) {
    console.error('加载实例失败', e);
  } finally {
    instanceLoading.value = false;
  }
}

// 设备控制
const showEnrollmentDialog = ref(false);
const enrollmentForm = ref({ label: '', maxUses: 1, validityHours: 24 });
const newCode = ref('');
const enrollmentCodes = ref<any[]>([]);
const devices = ref<any[]>([]);

// 命令下发
const showCommandPanel = ref(false);
const commandForm = ref({
  command_type: '',
  payload: '{}',
  device_id: '',
  expires_minutes: 5,
});
const commands = ref<any[]>([]);

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data;
}

async function loadDevices() {
  try {
    devices.value = await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=device_list');
  } catch (e) {
    console.error('加载设备列表失败', e);
  }
}

async function loadEnrollmentCodes() {
  try {
    enrollmentCodes.value = await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=enrollment_list');
  } catch (e) {
    console.error('加载注册码列表失败', e);
  }
}

async function loadCommands() {
  try {
    commands.value = await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=command_list');
  } catch (e) {
    console.error('加载命令列表失败', e);
  }
}

async function sendCommand() {
  if (!commandForm.value.command_type) {
    alert('请选择命令类型');
    return;
  }
  let payload: any;
  try {
    payload = JSON.parse(commandForm.value.payload);
  } catch {
    alert('payload 格式错误，请输入有效 JSON');
    return;
  }
  busy.value = true;
  try {
    await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=command_create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_type: commandForm.value.command_type,
        payload,
        device_id: commandForm.value.device_id || null,
        expires_minutes: commandForm.value.expires_minutes,
      }),
    });
    alert('命令已下发');
    commandForm.value.payload = '{}';
    commandForm.value.command_type = '';
    commandForm.value.device_id = '';
    await loadCommands();
  } catch (e: any) {
    alert(e.message || '下发失败');
  } finally {
    busy.value = false;
  }
}

async function createEnrollmentCode() {
  if (busy.value) return;
  busy.value = true;
  try {
    const data = await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=enrollment_create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: enrollmentForm.value.label,
        max_uses: enrollmentForm.value.maxUses,
        validity_hours: enrollmentForm.value.validityHours,
      }),
    });
    newCode.value = data.code;
    await loadEnrollmentCodes();
  } catch (e: any) {
    alert(e.message || '生成失败');
  } finally {
    busy.value = false;
  }
}

async function revokeCode(code: any) {
  if (!confirm('确认吊销此注册码？')) return;
  busy.value = true;
  try {
    await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=enrollment_revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: code.id }),
    });
    await loadEnrollmentCodes();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function deleteCode(code: any) {
  if (!confirm('确认永久删除此注册码？此操作不可撤销。')) return;
  busy.value = true;
  try {
    await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=enrollment_delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: code.id }),
    });
    await loadEnrollmentCodes();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function unregisterDevice(dev: any) {
  if (!confirm(`确认注销设备 ${dev.display_name}？`)) return;
  busy.value = true;
  try {
    await apiFetch('/api/control.php?instance_uid=' + (instance.value as any).instance_uid + '&action=device_unregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: dev.device_id }),
    });
    await loadDevices();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

function copyCode() {
  if (newCode.value) {
    navigator.clipboard.writeText(newCode.value);
    alert('已复制到剪贴板');
  }
}

onMounted(async () => {
  await loadInstance();
  if (instance.value) {
    loadDevices();
    loadEnrollmentCodes();
    loadCommands();
  }
});

const logs = ref([
  { time: '2024-01-15 14:31:58', level: 'info', message: '加载配置文件' },
  { time: '2024-01-15 14:30:15', level: 'warning', message: '磁盘空间不足 70%' },
  { time: '2024-01-15 14:28:42', level: 'error', message: '连接超时: backend-02' },
  { time: '2024-01-15 14:25:10', level: 'info', message: '接收配置更新' },
  { time: '2024-01-15 14:20:33', level: 'info', message: '健康检查通过' }
]);

const config = ref({
  'server.port': '80',
  'server.workers': '4',
  'server.keepalive_timeout': '65',
  'server.gzip': 'on',
  'server.ssl': 'off',
  'database.host': 'localhost',
  'database.port': '3306'
});
</script>

<style scoped>
.instance-detail {
  padding: var(--spacer-5);
  max-width: 1200px;
  margin: 0 auto;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-5);
  flex-wrap: wrap;
  gap: var(--spacer-3);
}

.detail-header-left {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
}

.instance-icon-lg {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.instance-title h1 {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.instance-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.detail-header-right {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-5);
}

.metric-card {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
}

.metric-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 500;
}

.metric-value {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: var(--spacer-1) 0 var(--spacer-2);
}

.metric-bar {
  height: 4px;
  background: var(--divider-stroke);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.metric-bar-fill {
  height: 100%;
  background: var(--accent-base);
  border-radius: var(--radius-full);
  transition: width var(--normal-duration);
}

.metric-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: var(--spacer-2);
}

.log-viewer {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.log-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
}

.log-count {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.log-filters {
  display: flex;
  gap: var(--spacer-1);
}

.filter-btn {
  padding: var(--spacer-1) var(--spacer-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.filter-btn:hover { background: var(--card-bg); color: var(--text-primary); }

.log-list {
  max-height: 400px;
  overflow-y: auto;
  padding: var(--spacer-2) 0;
}

.log-item {
  display: flex;
  gap: var(--spacer-3);
  padding: var(--spacer-2) var(--spacer-3);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  border-left: 3px solid transparent;
}

.log-item.info { border-left-color: var(--accent-base); }
.log-item.warning { border-left-color: var(--status-warning); }
.log-item.error { border-left-color: var(--status-error); }

.log-time { color: var(--text-tertiary); flex-shrink: 0; }
.log-level { font-weight: 600; flex-shrink: 0; min-width: 40px; }
.log-item.info .log-level { color: var(--accent-base); }
.log-item.warning .log-level { color: var(--status-warning); }
.log-item.error .log-level { color: var(--status-error); }
.log-message { color: var(--text-primary); }

.config-section {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-4);
}

.config-section h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-3);
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.config-item {
  display: flex;
  gap: var(--spacer-3);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.config-key { color: var(--accent-base); min-width: 200px; }
.config-value { color: var(--text-primary); }

/* 设备控制 */
.control-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.control-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.control-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.control-badge {
  display: inline-flex;
  padding: 1px 8px;
  background: var(--accent-bg);
  color: var(--accent-base);
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
}

.control-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.5;
}

.control-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--spacer-3);
}

.ctrl-card {
  display: flex;
  gap: var(--spacer-3);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-3);
}

.ctrl-card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ctrl-card-icon.enroll {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
}

.ctrl-card-body {
  flex: 1;
  min-width: 0;
}

.ctrl-card-body h4 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-1);
}

.ctrl-url {
  font-size: 11px;
  font-family: var(--font-family-mono);
  background: var(--subtle-secondary);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  word-break: break-all;
}

.ctrl-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: var(--spacer-1) 0 0;
}

.ctrl-actions {
  margin-top: var(--spacer-2);
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
}

.ctrl-btn:hover { background: var(--subtle-pressed); }

.ctrl-stat {
  display: flex;
  align-items: baseline;
  gap: var(--spacer-1);
  margin-bottom: var(--spacer-2);
}

.ctrl-stat-num {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.ctrl-stat-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

/* 注册码面板 */
.enrollment-panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-4);
}

.enrollment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacer-3);
}

.enrollment-header h4 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.enrollment-create label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-bottom: var(--spacer-1);
  display: block;
}

.enrollment-row {
  display: flex;
  gap: var(--spacer-2);
  flex-wrap: wrap;
}

.enrollment-row input {
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
}

.enrollment-row input:focus { border-color: var(--accent-base); }

.btn-sm {
  padding: var(--spacer-1) var(--spacer-2);
  font-size: var(--font-size-xs);
}

.new-code-display {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  margin-top: var(--spacer-3);
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(16, 124, 16, 0.08);
  border: 1px solid rgba(16, 124, 16, 0.2);
  border-radius: var(--radius-md);
  color: #107C10;
}

.new-code-display code {
  font-size: var(--font-size-sm);
  font-family: var(--font-family-mono);
  font-weight: 600;
  flex: 1;
}

.copy-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.copy-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.enrollment-list {
  margin-top: var(--spacer-3);
}

.enrollment-list .table-header,
.enrollment-list .table-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 0.8fr 0.5fr;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  align-items: center;
}

.enrollment-list .table-header {
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
}

.enrollment-list .table-row {
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
}

/* 设备列表 */
.device-list {
  margin-top: var(--spacer-2);
}

.device-list h4 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.device-list .table-header,
.device-list .table-row {
  display: grid;
  grid-template-columns: 1.5fr 1.2fr 1fr 0.8fr 1fr 0.5fr;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  align-items: center;
}

.device-list .table-header {
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
}

.device-list .table-row {
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
}

.status-pill {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 500;
}

.status-pill.published { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.status-pill.archived { background: rgba(0, 0, 0, 0.08); color: var(--text-tertiary); }

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
}

.icon-btn-sm:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.icon-btn-sm.danger:hover { color: var(--status-error); }
.icon-btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.empty-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: var(--spacer-1) 0 0;
}

/* 命令下发 */
.command-section {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-3);
}

.command-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacer-2);
}

.command-header h4 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.command-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  margin-top: var(--spacer-3);
  padding-top: var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.form-row label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 500;
}

.form-select,
.form-input,
.form-textarea {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
}

.form-select:focus,
.form-input:focus,
.form-textarea:focus {
  border-color: var(--accent-base);
}

.form-textarea {
  resize: vertical;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
}

/* 命令历史 */
.command-history {
  margin-top: var(--spacer-2);
}

.command-history h4 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.command-history .table-header,
.command-history .table-row {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1fr 1.5fr;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  align-items: center;
}

.command-history .table-header {
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
}

.command-history .table-row {
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-xs);
}

.status-pill.draft { background: rgba(0, 103, 192, 0.1); color: var(--accent-base); }
</style>
