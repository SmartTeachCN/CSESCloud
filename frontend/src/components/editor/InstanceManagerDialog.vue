<template>
  <Teleport to="body">
    <div v-if="visible && instance" class="im-overlay" @click.self="onClose">
      <div class="im-card">
        <div class="im-header">
          <div class="im-title">
            <Icon icon="ri-settings-3-line" :size="16" />
            <span>编辑配置实例</span>
          </div>
          <button class="im-close" title="关闭" @click="onClose">
            <Icon icon="ri-close-line" :size="16" />
          </button>
        </div>

        <div class="im-body">
          <!-- 实例信息 -->
          <div class="im-meta">
            <div class="im-meta-row">
              <span class="im-meta-label">实例组标识</span>
              <span class="im-meta-value mono">{{ groupDirId || instance.group_dir_id || '-' }}</span>
              <button
                class="im-icon-btn"
                :disabled="!(groupDirId || instance.group_dir_id)"
                title="复制实例组标识"
                @click="copyText(groupDirId || instance.group_dir_id || '', 'group')"
              >
                <Icon :icon="copied === 'group' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
              </button>
            </div>
            <div class="im-meta-row">
              <span class="im-meta-label">状态</span>
              <span class="im-status" :class="instance.valid === false ? 'warn' : 'ok'" :title="instance.warning || ''">
                <Icon :icon="instance.valid === false ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'" :size="12" />
                <span>{{ instance.valid === false ? (instance.warning || '源文件异常') : '正常' }}</span>
              </span>
            </div>
            <div class="im-meta-row">
              <span class="im-meta-label">更新时间</span>
              <span class="im-meta-value">{{ formatTime(instance.updated_at) }}</span>
            </div>
            <div class="im-meta-row" v-if="instance.instance_uid">
              <span class="im-meta-label">实例 UID</span>
              <span class="im-meta-value mono">{{ instance.instance_uid }}</span>
            </div>
          </div>

          <!-- 表单 -->
          <div class="im-field">
            <label class="im-label">实例标识 <span class="im-required">*</span></label>
            <input
              v-model="instanceName"
              class="im-input"
              :class="{ invalid: !!instanceNameError }"
              type="text"
              maxlength="60"
              placeholder="例如：高一1班"
              :disabled="saving"
              @keyup.enter="save"
            />
            <div v-if="instanceNameError" class="im-field-error">{{ instanceNameError }}</div>
            <div v-else class="im-field-hint">允许中文与空格，禁止 / \ : * ? " &lt; &gt; | 与「..」；ClassIsland 中填写的 ID 需与此一致。</div>
          </div>

          <div class="im-field">
            <label class="im-label">源文件</label>
            <select v-model="fileId" class="im-select" :disabled="saving">
              <option v-for="f in fileOptions" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <div class="im-field-hint">修改源文件后，ClassIsland 同步时会读取新文件的内容。</div>
          </div>

          <div class="im-field">
            <label class="im-label">组织名称</label>
            <input
              v-model="organizationName"
              class="im-input"
              type="text"
              maxlength="100"
              placeholder="例如：CSES Cloud (实例组标识)"
              :disabled="saving"
              @keyup.enter="save"
            />
          </div>

          <!-- 清单地址 -->
          <div class="im-field" v-if="manifestUrl">
            <label class="im-label">清单地址</label>
            <div class="im-url-row">
              <input class="im-url" :value="manifestUrl" readonly />
              <button class="im-copy-btn" @click="copyText(manifestUrl, 'manifest')">
                <Icon :icon="copied === 'manifest' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                <span>{{ copied === 'manifest' ? '已复制' : '复制' }}</span>
              </button>
              <a v-if="downloadHref" class="im-download-btn" :href="downloadHref" target="_blank" rel="noopener" title="下载 ClassIsland 清单文件">
                <Icon icon="ri-download-line" :size="13" />
              </a>
            </div>
          </div>

          <div v-if="error" class="im-error">
            <Icon icon="ri-error-warning-line" :size="14" />
            <span>{{ error }}</span>
          </div>
          <div v-else-if="successMessage" class="im-success">
            <Icon icon="ri-checkbox-circle-line" :size="14" />
            <span>{{ successMessage }}</span>
          </div>
        </div>

        <div class="im-footer">
          <template v-if="successMessage">
            <button class="im-btn ghost" @click="onClose">关闭</button>
          </template>
          <template v-else>
            <button class="im-btn ghost" :disabled="saving" @click="onClose">取消</button>
            <button class="im-btn primary" :disabled="!canSave" @click="save">
              <Icon v-if="saving" icon="ri-loader-4-line" :size="14" class="spin" />
              <span>{{ saving ? '保存中...' : '保存修改' }}</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { distributionsApi } from '../../api';

interface DistributionInstance {
  id: number;
  instance_uid?: string;
  name: string;
  source_file_id?: number;
  source_file_name?: string;
  group_dir_id?: string;
  organization_name?: string;
  status?: string;
  updated_at?: string;
  version?: number;
  urls?: { manifest?: string; file_template?: string };
  valid?: boolean;
  warning?: string;
}

interface CloudFileOption {
  id: string;
  name: string;
}

const props = defineProps<{
  visible: boolean;
  instance: DistributionInstance | null;
  groupDirId: string;
  cloudFiles: CloudFileOption[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', instance: DistributionInstance): void;
}>();

const instanceName = ref('');
const organizationName = ref('');
const fileId = ref('');
const saving = ref(false);
const error = ref('');
const successMessage = ref('');
const copied = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const fileOptions = computed<CloudFileOption[]>(() => {
  const list: CloudFileOption[] = (props.cloudFiles || []).map((f) => ({ id: String(f.id), name: f.name }));
  const current = props.instance?.source_file_id;
  if (current !== undefined && current !== null && !list.some((f) => Number(f.id) === Number(current))) {
    list.unshift({
      id: String(current),
      name: `${props.instance?.source_file_name || '未知文件'}（源文件不可用）`,
    });
  }
  return list;
});

const instanceNameError = computed(() => validateInstanceName(instanceName.value));
const manifestUrl = computed(() => props.instance?.urls?.manifest || '');
const downloadHref = computed(() => {
  const id = props.instance?.id;
  return typeof id === 'number' && Number.isFinite(id) ? distributionsApi.manifestUrl(id) : '';
});
const canSave = computed(() => {
  return !!props.instance && !instanceNameError.value && !!fileId.value && !saving.value;
});

/** 实例标识校验：允许中文/空格，规则与后端 convert.validInstanceId 保持一致 */
function validateInstanceName(raw: string): string {
  const name = raw.trim();
  if (!name) return '实例标识不能为空';
  if (name.startsWith('.')) return '实例标识不能以「.」开头';
  if (name.includes('..')) return '实例标识不能包含「..」';
  // eslint-disable-next-line no-control-regex
  if (/[\/\\:*?"<>|\u0000-\u001f]/.test(name)) return '实例标识不能包含 / \\ : * ? " < > | 等字符';
  if (new TextEncoder().encode(name).length > 180) return '实例标识过长（最多 180 字节）';
  return '';
}

function reset() {
  const instance = props.instance;
  error.value = '';
  successMessage.value = '';
  saving.value = false;
  copied.value = '';
  if (copiedTimer) {
    clearTimeout(copiedTimer);
    copiedTimer = null;
  }
  instanceName.value = instance?.name || '';
  organizationName.value = instance?.organization_name || '';
  fileId.value = instance?.source_file_id !== undefined && instance?.source_file_id !== null
    ? String(instance.source_file_id)
    : (props.cloudFiles?.[0]?.id || '');
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) reset();
  }
);

watch(
  () => props.instance,
  () => {
    if (props.visible) reset();
  }
);

async function copyText(text: string, key: string) {
  if (!text) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      ok = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    error.value = '复制失败，请手动选择文本复制：' + text;
    return;
  }
  copied.value = key;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    if (copied.value === key) copied.value = '';
  }, 2000);
}

async function save() {
  if (!props.instance || saving.value) return;
  if (instanceNameError.value) return;
  const parsedFileId = Number(fileId.value);
  if (!Number.isFinite(parsedFileId)) {
    error.value = '请选择有效的源文件。';
    return;
  }
  error.value = '';
  successMessage.value = '';
  saving.value = true;
  try {
    const dto = await distributionsApi.update(props.instance.id, {
      instance_id: instanceName.value.trim(),
      organization_name: organizationName.value.trim(),
      file_id: parsedFileId,
    });
    if (!dto || typeof dto !== 'object') {
      throw new Error('服务端未返回配置实例信息，请稍后重试。');
    }
    successMessage.value = '已保存';
    const savedInstance: DistributionInstance = { ...dto, id: Number(dto.id) };
    emit('saved', savedInstance);
  } catch (e: any) {
    error.value = e?.message || '保存失败，请稍后重试。';
  } finally {
    saving.value = false;
  }
}

function formatTime(value?: string): string {
  if (!value) return '未知';
  return String(value).slice(0, 19);
}

function onClose() {
  if (saving.value) return;
  emit('close');
}
</script>

<style scoped>
.im-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-4);
}

.im-card {
  width: 500px;
  max-width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.im-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.im-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.im-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.im-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.im-body {
  padding: var(--spacer-3) var(--spacer-4);
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.im-meta {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
}

.im-meta-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-xs);
  min-height: 20px;
}

.im-meta-label {
  width: 76px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.im-meta-value {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.im-meta-value.mono {
  font-family: var(--font-family-mono);
  font-size: 11px;
}

.im-icon-btn {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  cursor: pointer;
}

.im-icon-btn:hover:not(:disabled) {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.im-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.im-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.im-status.ok {
  color: var(--status-success);
}

.im-status.warn {
  color: var(--status-warning);
}

.im-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.im-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.im-required {
  color: var(--status-error);
}

.im-input,
.im-select {
  width: 100%;
  height: 34px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--fast-duration);
}

.im-input:focus,
.im-select:focus {
  border-color: var(--accent-base);
}

.im-input.invalid {
  border-color: var(--status-error);
}

.im-select {
  cursor: pointer;
}

.im-field-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.im-field-error {
  font-size: 11px;
  color: var(--status-error);
}

.im-url-row {
  display: flex;
  gap: 6px;
}

.im-url {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  outline: none;
  box-sizing: border-box;
}

.im-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 var(--spacer-2);
  flex-shrink: 0;
  background: var(--accent-base);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.im-copy-btn:hover {
  background: var(--accent-hover);
}

.im-download-btn {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
}

.im-download-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.im-error,
.im-success {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.im-error {
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  color: var(--status-error);
}

.im-success {
  background: rgba(16, 124, 16, 0.08);
  border: 1px solid rgba(16, 124, 16, 0.18);
  color: var(--status-success);
}

.im-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.im-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.im-btn.ghost {
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  color: var(--text-secondary);
}

.im-btn.ghost:hover:not(:disabled) {
  background: var(--subtle-secondary);
}

.im-btn.primary {
  background: var(--accent-base);
  color: var(--accent-text);
  border: none;
}

.im-btn.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.im-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
