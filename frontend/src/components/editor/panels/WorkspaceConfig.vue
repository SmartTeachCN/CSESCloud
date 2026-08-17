<template>
  <div class="workspace-config-panel">
    <div class="panel-header">
      <Icon icon="ri-settings-3-line" :size="14" />
      <span>工作区配置</span>
    </div>

    <div class="config-body">
      <!-- 操作记录配置 -->
      <div class="config-section">
        <div class="section-title">
          <Icon icon="ri-history-line" :size="12" />
          <span>操作记录</span>
        </div>
        <div class="config-row">
          <label>云端最大保存条数</label>
          <div class="input-group">
            <input
              type="number"
              v-model.number="localConfig.operation_cloud_limit"
              min="10"
              max="500"
              step="10"
              class="config-input"
            />
            <span class="input-unit">条</span>
          </div>
        </div>
        <div class="config-hint">超出上限后自动删除最旧的记录</div>

        <div class="config-row">
          <label>本地最大保存条数</label>
          <div class="input-group">
            <input
              type="number"
              v-model.number="localConfig.operation_local_limit"
              min="10"
              max="1000"
              step="10"
              class="config-input"
            />
            <span class="input-unit">条</span>
          </div>
        </div>
        <div class="config-hint">本地记录仅在浏览器内存中，刷新后丢失</div>
      </div>

      <div class="config-divider"></div>

      <!-- 版本历史配置 -->
      <div class="config-section">
        <div class="section-title">
          <Icon icon="ri-git-branch-line" :size="12" />
          <span>版本历史</span>
        </div>
        <div class="config-row">
          <label>最大保留文件数</label>
          <div class="input-group">
            <input
              type="number"
              v-model.number="localConfig.version_file_limit"
              min="3"
              max="100"
              step="1"
              class="config-input"
            />
            <span class="input-unit">个</span>
          </div>
        </div>
        <div class="config-hint">保留完整内容的版本数，超出后仅保留条目（无数据）</div>

        <div class="config-row">
          <label>最大保存条目数</label>
          <div class="input-group">
            <input
              type="number"
              v-model.number="localConfig.version_entry_limit"
              min="10"
              max="500"
              step="10"
              class="config-input"
            />
            <span class="input-unit">条</span>
          </div>
        </div>
        <div class="config-hint">超出上限后自动删除最旧的条目</div>
      </div>

      <div class="config-actions">
        <button class="save-btn" @click="saveConfig" :disabled="saving">
          <Icon :icon="saving ? 'ri-loader-4-line' : 'ri-save-line'" :size="12" :class="{ spin: saving }" />
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
        <button class="reset-btn" @click="resetConfig">
          <Icon icon="ri-refresh-line" :size="12" />
          恢复默认
        </button>
      </div>

      <div v-if="saveMessage" class="save-message" :class="saveMessageType">
        <Icon :icon="saveMessageType === 'success' ? 'ri-check-line' : 'ri-error-warning-line'" :size="12" />
        {{ saveMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{
  workspaceKey?: string;
}>();

const emit = defineEmits<{
  updated: [config: Record<string, number>];
}>();

const defaultConfig = {
  operation_cloud_limit: 50,
  operation_local_limit: 100,
  version_entry_limit: 30,
  version_file_limit: 10,
};

const localConfig = reactive({ ...defaultConfig });
const saving = ref(false);
const saveMessage = ref('');
const saveMessageType = ref('success');

async function loadConfig() {
  try {
    const wk = props.workspaceKey || 'light_editor';
    const result = await api.get<any>(`/cloud-files?action=workspace-config&workspace=${wk}`);
    if (result) {
      localConfig.operation_cloud_limit = result.operation_cloud_limit ?? defaultConfig.operation_cloud_limit;
      localConfig.operation_local_limit = result.operation_local_limit ?? defaultConfig.operation_local_limit;
      localConfig.version_entry_limit = result.version_entry_limit ?? defaultConfig.version_entry_limit;
      localConfig.version_file_limit = result.version_file_limit ?? defaultConfig.version_file_limit;
    }
  } catch {
    // 使用默认值
  }
}

async function saveConfig() {
  saving.value = true;
  saveMessage.value = '';
  try {
    const wk = props.workspaceKey || 'light_editor';
    await api.post('/cloud-files?action=workspace-config-update', {
      workspace: wk,
      config: { ...localConfig },
    });
    saveMessage.value = '配置已保存';
    saveMessageType.value = 'success';
    emit('updated', { ...localConfig });
  } catch (e: any) {
    saveMessage.value = e?.message || '保存失败';
    saveMessageType.value = 'error';
  } finally {
    saving.value = false;
    setTimeout(() => { saveMessage.value = ''; }, 3000);
  }
}

function resetConfig() {
  Object.assign(localConfig, defaultConfig);
  saveMessage.value = '已恢复默认值，请点击保存';
  saveMessageType.value = 'success';
}

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.workspace-config-panel {
  display: flex;
  flex-direction: column;
  background: var(--layer-default);
  border-top: 1px solid var(--divider-stroke);
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
  flex-shrink: 0;
}

.config-body {
  padding: var(--spacer-3);
}

.config-section {
  margin-bottom: var(--spacer-3);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  margin-bottom: var(--spacer-2);
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.config-row label {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  font-weight: 500;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.config-input {
  width: 72px;
  height: 28px;
  padding: 0 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  text-align: center;
  font-family: inherit;
}
.config-input:focus {
  outline: none;
  border-color: var(--accent-base);
  box-shadow: 0 0 0 1px var(--accent-bg);
}
.input-unit {
  font-size: 10px;
  color: var(--text-tertiary);
  width: 20px;
}

.config-hint {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-bottom: var(--spacer-2);
  margin-left: 0;
  line-height: 1.4;
}

.config-divider {
  height: 1px;
  background: var(--divider-stroke);
  margin: var(--spacer-3) 0;
}

.config-actions {
  display: flex;
  gap: var(--spacer-2);
  margin-top: var(--spacer-3);
}

.save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: white;
  cursor: pointer;
}
.save-btn:hover {
  background: var(--accent-hover);
}
.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
}
.reset-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.save-message {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--spacer-2);
  font-size: 11px;
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-sm);
}
.save-message.success {
  color: var(--status-success);
  background: rgba(16, 124, 16, 0.08);
}
.save-message.error {
  color: var(--status-error);
  background: rgba(196, 43, 28, 0.08);
}
</style>