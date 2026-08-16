<template>
  <div class="props-panel" v-if="instance">
    <div class="panel-header">
      <Icon icon="ri-settings-3-line" :size="14" />
      <span>实例属性</span>
      <button class="save-btn" :disabled="!canWrite || saving" @click="saveConfig">
        <Icon :icon="saving ? 'ri-loader-4-line' : 'ri-save-line'" :size="12" :class="{ spin: saving }" />
        保存
      </button>
    </div>
    <div class="panel-body">
      <div class="prop-section">
        <div class="section-title">基本信息</div>
        <div class="prop-item">
          <label>实例名称</label>
          <input v-model="form.name" :disabled="!canWrite" type="text" />
        </div>
        <div class="prop-item">
          <label>实例 UID</label>
          <input :value="instance.instance_uid" readonly type="text" />
        </div>
        <div class="prop-item">
          <label>服务类型</label>
          <input v-model="form.service_type" :disabled="!canWrite" type="text" />
        </div>
        <div class="prop-item">
          <label>状态</label>
          <select v-model="form.status" :disabled="!canWrite">
            <option value="running">运行中</option>
            <option value="stopped">已停止</option>
            <option value="error">错误</option>
          </select>
        </div>
      </div>
      <div class="prop-section">
        <div class="section-title">运行参数</div>
        <div class="prop-item">
          <label>CPU</label>
          <input v-model="form.cpu" :disabled="!canWrite" type="text" />
        </div>
        <div class="prop-item">
          <label>内存</label>
          <input v-model="form.memory" :disabled="!canWrite" type="text" />
        </div>
        <div class="prop-item">
          <label>磁盘</label>
          <input v-model="form.disk" :disabled="!canWrite" type="text" />
        </div>
        <div class="prop-item">
          <label>IP 地址</label>
          <input v-model="form.ip" :disabled="!canWrite" type="text" />
        </div>
      </div>
      <div class="prop-section">
        <div class="section-title">配置 (JSON)</div>
        <div class="prop-item">
          <textarea
            v-model="configText"
            :disabled="!canWrite"
            class="config-textarea"
            spellcheck="false"
          ></textarea>
        </div>
        <p v-if="configError" class="config-error">
          <Icon icon="ri-error-warning-line" :size="12" />
          {{ configError }}
        </p>
      </div>
      <div v-if="instance.app_name" class="prop-section">
        <div class="section-title">关联应用</div>
        <div class="app-info">
          <Icon icon="ri-apps-2-line" :size="20" />
          <div>
            <div class="app-name">{{ instance.app_name }}</div>
            <div class="app-key">{{ instance.app_key }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { instancesApi } from '../../../api';

const props = defineProps<{
  instance: any;
  canWrite?: boolean;
}>();

const emit = defineEmits<{ (e: 'saved'): void }>();

const saving = ref(false);
const form = ref({
  name: '',
  service_type: '',
  status: 'running',
  cpu: '',
  memory: '',
  disk: '',
  ip: ''
});

const configText = ref('{}');
const configError = ref('');

const canWrite = computed(() => !!props.canWrite);

function syncFromInstance() {
  const i = props.instance || {};
  form.value = {
    name: i.name || '',
    service_type: i.service_type || '',
    status: i.status || 'running',
    cpu: i.cpu || '',
    memory: i.memory || '',
    disk: i.disk || '',
    ip: i.ip || ''
  };
  configText.value = i.config ? JSON.stringify(i.config, null, 2) : '{}';
  configError.value = '';
}

watch(() => props.instance, syncFromInstance, { immediate: true, deep: true });

async function saveConfig() {
  // 校验 JSON
  try {
    const config = JSON.parse(configText.value || '{}');
    configError.value = '';
    saving.value = true;
    await instancesApi.setConfig(props.instance.id, {
      name: form.value.name,
      service_type: form.value.service_type,
      status: form.value.status,
      cpu: form.value.cpu,
      memory: form.value.memory,
      disk: form.value.disk,
      ip: form.value.ip,
      config
    });
    emit('saved');
  } catch (e: any) {
    if (e instanceof SyntaxError) {
      configError.value = 'JSON 格式错误：' + e.message;
    } else {
      alert(e.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.props-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--layer-default);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.save-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--spacer-2);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.save-btn:hover { background: var(--accent-hover); }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-3);
}

.prop-section {
  margin-bottom: var(--spacer-4);
}

.section-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--spacer-2);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--divider-stroke);
}

.prop-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: var(--spacer-2);
}

.prop-item label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 500;
}

.prop-item input,
.prop-item select {
  padding: 4px var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
}

.prop-item input:disabled,
.prop-item select:disabled,
.config-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.prop-item input:focus,
.prop-item select:focus {
  border-color: var(--accent-base);
}

.config-textarea {
  width: 100%;
  min-height: 160px;
  resize: vertical;
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
}

.config-error {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--status-error);
  margin-top: 4px;
}

.app-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.app-name {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-weight: 500;
}

.app-key {
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
}

</style>
