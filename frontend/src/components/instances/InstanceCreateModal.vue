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

        <!-- 步骤指示器 -->
        <div class="wizard-steps">
          <button class="step-item" :class="{ active: step === 1, done: step > 1 }" @click="goStep(1)">
            <span class="step-num">
              <Icon v-if="step > 1" icon="ri-check-line" :size="12" />
              <template v-else>1</template>
            </span>
            <span class="step-label">基本信息</span>
          </button>
          <div class="step-line" :class="{ active: step > 1 }"></div>
          <button class="step-item" :class="{ active: step === 2 }" @click="goStep(2)" :disabled="!canGoStep2">
            <span class="step-num">2</span>
            <span class="step-label">选择应用</span>
          </button>
        </div>

        <div class="modal-body">
          <!-- 第一步：基本信息 -->
          <template v-if="step === 1">
            <div class="form-group">
              <label>实例名称 <span class="required">*</span></label>
              <input v-model="form.name" type="text" placeholder="例如：教学课件实例" @keyup.enter="goStep(2)" />
            </div>
            <div class="form-group">
              <label>分组</label>
              <select v-model.number="form.group_id">
                <option :value="0">未分组</option>
                <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </div>
          </template>

          <!-- 第二步：从应用市场选择 -->
          <template v-else>
            <div v-if="loadingApps" class="apps-loading">
              <Icon icon="ri-loader-4-line" :size="20" class="spin" />
              <span>正在加载应用市场...</span>
            </div>
            <template v-else>
              <div class="app-grid">
                <!-- 自定义实例卡片 -->
                <div class="app-card" :class="{ selected: form.app_id === 0 }" @click="selectApp(null)">
                  <div class="app-card-icon custom">
                    <Icon icon="ri-add-line" :size="22" />
                  </div>
                  <div class="app-card-name">不使用应用</div>
                  <div class="app-card-sub">自定义实例</div>
                  <div class="app-card-desc">不绑定市场应用，手动指定服务类型</div>
                  <span v-if="form.app_id === 0" class="check-badge">
                    <Icon icon="ri-check-line" :size="12" />
                  </span>
                </div>

                <!-- 应用市场卡片 -->
                <div
                  v-for="app in apps"
                  :key="app.id"
                  class="app-card"
                  :class="{ selected: form.app_id === app.id }"
                  @click="selectApp(app)"
                >
                  <div
                    class="app-card-icon"
                    :class="{ asset: isAssetIcon(app.icon) }"
                    :style="isAssetIcon(app.icon) ? undefined : getCatStyle(app.category)"
                  >
                    <AppIcon :icon="app.icon" :app-key="app.app_key" :size="26" fallback="ri-apps-2-line" />
                  </div>
                  <div class="app-card-name-row">
                    <span class="app-card-name">{{ app.name }}</span>
                    <span v-if="app.is_official" class="official-badge" title="官方应用">
                      <Icon icon="ri-verified-badge-fill" :size="13" />
                    </span>
                  </div>
                  <div class="app-card-sub">
                    <span class="cat-tag">{{ app.category || '通用' }}</span>
                    <span class="ver-tag">v{{ app.version }}</span>
                  </div>
                  <div class="app-card-desc">{{ app.description || '暂无描述' }}</div>
                  <span v-if="form.app_id === app.id" class="check-badge">
                    <Icon icon="ri-check-line" :size="12" />
                  </span>
                </div>
              </div>
              <div v-if="apps.length === 0" class="apps-empty">
                <Icon icon="ri-inbox-line" :size="28" />
                <span>应用市场暂无已发布应用，可选择「不使用应用」创建自定义实例</span>
              </div>

              <div v-if="form.app_id === 0" class="form-group">
                <label>自定义服务类型</label>
                <input v-model="form.service_type" type="text" placeholder="例如：nginx / mysql / 自定义" />
              </div>
              <p v-else-if="selectedApp" class="form-hint">
                <Icon icon="ri-information-line" :size="12" />
                {{ selectedApp.description || '该应用将绑定到该实例并提供编辑器、存储清单等能力' }}
              </p>
            </template>
          </template>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" @click="$emit('close')">取消</button>
          <button v-if="step === 2" class="btn btn-ghost" @click="goStep(1)">
            <Icon icon="ri-arrow-left-s-line" :size="14" />
            上一步
          </button>
          <button v-if="step === 1" class="btn btn-primary" :disabled="!canGoStep2" @click="goStep(2)">
            下一步
            <Icon icon="ri-arrow-right-s-line" :size="14" />
          </button>
          <button v-else class="btn btn-primary" :disabled="submitting" @click="submit">
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

const step = ref<1 | 2>(1);
const submitting = ref(false);
const loadingApps = ref(false);
const apps = ref<any[]>([]);
const form = ref({
  name: '',
  app_id: 0,
  service_type: '',
  group_id: 0
});

const canGoStep2 = computed(() => !!form.value.name.trim());
const selectedApp = computed(() => apps.value.find(a => a.id === form.value.app_id));

function goStep(target: 1 | 2) {
  if (target === 2 && !canGoStep2.value) return;
  step.value = target;
}

function selectApp(app: any | null) {
  if (app) {
    form.value.app_id = app.id;
    form.value.service_type = app.category || '';
  } else {
    form.value.app_id = 0;
  }
}

/** 与应用市场一致的应用分类配色 */
function getCatStyle(category?: string): Record<string, string> {
  const c = (category || '').toLowerCase();
  if (c.includes('考试')) return { background: 'rgba(196, 43, 28, 0.1)', color: '#C42B1C' };
  if (c.includes('教学')) return { background: 'rgba(0, 103, 192, 0.1)', color: '#0067C0' };
  if (c.includes('评测')) return { background: 'rgba(202, 143, 4, 0.1)', color: '#CA8F04' };
  if (c.includes('ai')) return { background: 'rgba(120, 90, 240, 0.1)', color: '#785AF0' };
  return { background: 'rgba(16, 124, 16, 0.1)', color: '#107C10' };
}

/** icon 值以 asset: 开头表示应用自带真实图标（由 AppIcon 渲染） */
function isAssetIcon(icon?: string): boolean {
  return !!icon && icon.startsWith('asset:');
}

async function loadApps() {
  loadingApps.value = true;
  try {
    apps.value = await devApi.publishedApps();
  } catch {
    apps.value = [];
  } finally {
    loadingApps.value = false;
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
  width: 640px;
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

/* ===== 步骤指示器 ===== */
.wizard-steps {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.step-item {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: 4px var(--spacer-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.step-item:disabled { cursor: not-allowed; opacity: 0.7; }

.step-num {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  flex-shrink: 0;
}

.step-item.active { color: var(--text-primary); font-weight: 600; }
.step-item.active .step-num { background: var(--accent-base); color: var(--accent-text); }

.step-item.done { color: var(--text-secondary); }
.step-item.done .step-num { background: rgba(16, 124, 16, 0.12); color: #107C10; }

.step-line {
  flex: 1;
  height: 1px;
  background: var(--divider-stroke);
}

.step-line.active { background: var(--accent-base); }

.modal-body {
  padding: var(--spacer-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  overflow-y: auto;
  min-height: 240px;
}

.required {
  color: var(--status-error);
}

.form-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: 0;
}

/* ===== 第二步：应用卡片选择 ===== */
.apps-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-8) 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--spacer-3);
}

.app-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  padding: var(--spacer-3);
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--fast-duration), box-shadow var(--fast-duration);
}

.app-card:hover {
  border-color: var(--accent-base);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.app-card.selected {
  border-color: var(--accent-base);
  box-shadow: 0 0 0 1px var(--accent-base);
  background: var(--subtle-secondary);
}

.app-card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-bottom: var(--spacer-1);
}

.app-card-icon.custom {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
  border: 1px dashed var(--divider-stroke);
}

/* 应用自带真实图标时不使用分类底色 */
.app-card-icon.asset {
  background: transparent;
  overflow: hidden;
}

.app-card-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.app-card-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.official-badge {
  display: inline-flex;
  color: var(--accent-base);
  flex-shrink: 0;
}

.app-card-sub {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: 10px;
  color: var(--text-tertiary);
}

.cat-tag, .ver-tag {
  padding: 0 4px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-xs);
}

.ver-tag {
  font-family: var(--font-mono, monospace);
}

.app-card-desc {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.check-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-base);
  color: white;
  border-radius: var(--radius-full);
}

.apps-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-6) 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  text-align: center;
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
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
