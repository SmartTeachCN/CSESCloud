<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-card">
        <div class="modal-header">
          <h3>新建实例</h3>
          <button class="modal-close" @click="$emit('close')">
            <Icon icon="ri-close-line" :size="18" />
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>实例名称 <span class="required">*</span></label>
            <input v-model="form.name" type="text" placeholder="例如：教学课件实例" />
          </div>
          <div class="form-group">
            <label>从应用市场选择</label>
            <select v-model.number="form.app_id" @change="onAppChange">
              <option :value="0">不使用应用，自定义实例</option>
              <option v-for="app in apps" :key="app.id" :value="app.id">
                {{ app.name }} · {{ app.category }}（{{ app.status === 'published' ? '已发布' : '草稿' }}）
              </option>
            </select>
            <p v-if="selectedApp" class="form-hint">
              <Icon icon="ri-information-line" :size="12" />
              {{ selectedApp.description || '该应用将绑定到该实例并提供编辑器、存储清单等能力' }}
            </p>
          </div>
          <div v-if="!form.app_id" class="form-group">
            <label>自定义服务类型</label>
            <input v-model="form.service_type" type="text" placeholder="例如：nginx / mysql / 自定义" />
          </div>
          <div class="form-group">
            <label>分组</label>
            <select v-model.number="form.group_id">
              <option :value="0">未分组</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="$emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submit">
            <Icon v-if="submitting" icon="ri-loader-4-line" :size="14" class="spin" />
            <span>创建</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { instancesApi, devApi } from '../../api';

const props = defineProps<{ groups: any[] }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', instance: any): void;
}>();

const submitting = ref(false);
const apps = ref<any[]>([]);
const form = ref({
  name: '',
  app_id: 0,
  service_type: '',
  group_id: 0
});

const selectedApp = computed(() => apps.value.find(a => a.id === form.value.app_id));

function onAppChange() {
  if (selectedApp.value && !form.value.service_type) {
    form.value.service_type = selectedApp.value.category;
  }
}

async function loadApps() {
  try {
    apps.value = await devApi.sharedList();
  } catch {
    apps.value = [];
  }
}

async function submit() {
  if (!form.value.name.trim()) return;
  submitting.value = true;
  try {
    const res = await instancesApi.create({
      name: form.value.name,
      app_id: form.value.app_id,
      service_type: form.value.service_type,
      group_id: form.value.group_id
    });
    emit('created', res);
    emit('close');
  } catch (e: any) {
    alert(e.message || '创建失败');
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  loadApps();
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-card {
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  width: 480px;
  max-width: 92vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

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

.modal-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--spacer-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  overflow-y: auto;
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

.required {
  color: var(--status-error);
}

.form-group input,
.form-group select {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--accent-base);
}

.form-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
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
  transition: background var(--fast-duration), color var(--fast-duration);
}

.btn-primary {
  background: var(--accent-base);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--divider-stroke);
}

.btn-ghost:hover {
  background: var(--subtle-secondary);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
