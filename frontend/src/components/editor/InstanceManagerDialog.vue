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
              <span class="im-meta-label">分发类型</span>
              <span class="im-format-badge" :class="formatClass(instanceFormat)">{{ instanceFormatLabel }}</span>
            </div>
            <div class="im-meta-row" v-if="sharedInstance">
              <span class="im-meta-label">来源</span>
              <span class="im-meta-value">来自分享 · {{ instance?.shared_from || '分享者' }}</span>
            </div>
            <div class="im-meta-row">
              <span class="im-meta-label">实例组标识</span>
              <span class="im-meta-value mono">{{ groupDirId || displayInstance?.group_dir_id || '-' }}</span>
              <button
                class="im-icon-btn"
                :disabled="!(groupDirId || displayInstance?.group_dir_id)"
                title="复制实例组标识"
                @click="copyText(groupDirId || displayInstance?.group_dir_id || '', 'group')"
              >
                <Icon :icon="copied === 'group' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
              </button>
            </div>
            <div class="im-meta-row">
              <span class="im-meta-label">状态</span>
              <span class="im-status" :class="displayInstance?.valid === false ? 'warn' : 'ok'" :title="displayInstance?.warning || ''">
                <Icon :icon="displayInstance?.valid === false ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'" :size="12" />
                <span>{{ displayInstance?.valid === false ? (displayInstance?.warning || '源文件异常') : '正常' }}</span>
              </span>
            </div>
            <div class="im-meta-row">
              <span class="im-meta-label">更新时间</span>
              <span class="im-meta-value">{{ formatTime(displayInstance?.updated_at) }}</span>
            </div>
            <div class="im-meta-row" v-if="displayInstance?.instance_uid">
              <span class="im-meta-label">实例 UID</span>
              <span class="im-meta-value mono">{{ displayInstance?.instance_uid }}</span>
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
            <div v-else class="im-field-hint">允许中文与空格，禁止 / \ : * ? " &lt; &gt; | 与「..」；用于标识该分发实例（ClassIsland 中填写的 ID 需与此一致）。</div>
          </div>

          <div class="im-field">
            <label class="im-label">源文件</label>
            <template v-if="sourceLocked">
              <input class="im-input" :value="lockedSourceName" readonly disabled />
              <div class="im-field-hint">源文件由分享者提供，接收者不能更换；文件只读或可编辑取决于分享权限。</div>
            </template>
            <template v-else>
              <CustomSelect
                v-model="fileId"
                :options="sourceFileOptions"
                class="im-select"
                height="34px"
                :disabled="saving"
              />
              <div class="im-field-hint">修改源文件后，分发配置将随新文件内容更新（格式可能随之变化）。</div>
            </template>
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

          <!-- 静态集控：清单地址 -->
          <div class="im-field" v-if="instanceMode === 'static'">
            <label class="im-label">清单地址</label>
            <div class="im-url-row">
              <input class="im-url" :value="manifestUrl" readonly placeholder="服务端未返回清单地址" />
              <button class="im-copy-btn" :disabled="!manifestUrl" @click="copyText(manifestUrl, 'manifest')">
                <Icon :icon="copied === 'manifest' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                <span>{{ copied === 'manifest' ? '已复制' : '复制' }}</span>
              </button>
              <a
                v-if="downloadHref && !sharedInstance"
                class="im-download-btn"
                :href="downloadHref"
                target="_blank"
                rel="noopener"
                title="下载 ClassIsland 清单文件"
              >
                <Icon icon="ri-download-line" :size="13" />
              </a>
            </div>
            <div class="im-field-hint">{{ modeHint }}</div>
          </div>

          <!-- URL 格式：公开配置地址 -->
          <div class="im-field" v-else>
            <label class="im-label">配置地址</label>
            <div class="im-url-row">
              <input class="im-url" :value="configUrl" readonly placeholder="服务端未返回配置地址" />
              <button class="im-copy-btn" :disabled="!configUrl" @click="copyText(configUrl, 'source')">
                <Icon :icon="copied === 'source' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                <span>{{ copied === 'source' ? '已复制' : '复制' }}</span>
              </button>
              <a v-if="configUrl" class="im-download-btn" :href="configUrl" target="_blank" rel="noopener" title="打开配置地址">
                <Icon icon="ri-external-link-line" :size="13" />
              </a>
            </div>
            <div class="im-field-hint">{{ modeHint }}</div>
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
import CustomSelect from '../CustomSelect.vue';
import { distributionsApi } from '../../api';

/** 分发模式：static=静态集控（ClassIsland 清单），url=公开配置地址（CSES / ExamAware） */
type DistributionMode = 'static' | 'url';

interface DistributionUrls {
  kind?: string;
  manifest?: string;
  file_template?: string;
  source?: string;
}

interface DistributionInstance {
  id: number;
  instance_uid?: string;
  name: string;
  app_key?: string;
  format?: string;
  format_label?: string;
  format_mode?: string;
  source_file_id?: number;
  source_file_name?: string;
  group_dir_id?: string;
  organization_name?: string;
  status?: string;
  updated_at?: string;
  version?: number;
  urls?: DistributionUrls;
  valid?: boolean;
  warning?: string;
  /** 来自分享的实例字段（后端新契约） */
  is_shared?: boolean;
  shared_from?: string;
  shared_permission?: string;
  can_edit_instance?: boolean;
  owner_source_file_id?: number;
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
  /** 源文件锁定（共享实例：源文件由分享者提供，接收者不能更换） */
  sourceLocked?: boolean;
  /** 共享实例（来自分享：隐藏 owner-only 的清单下载入口） */
  sharedInstance?: boolean;
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
const savedInstance = ref<DistributionInstance | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

/** 保存后优先展示服务端返回的新 DTO（换源文件/格式后地址随之更新） */
const displayInstance = computed<DistributionInstance | null>(() => savedInstance.value || props.instance);

function normalizeMode(value: unknown): DistributionMode {
  return String(value || '') === 'url' ? 'url' : 'static';
}

function deriveFormat(instance: DistributionInstance | null): string {
  if (!instance) return '';
  if (instance.format) return instance.format;
  if (instance.app_key === 'cses_config') return 'cses';
  if (instance.app_key === 'examaware') return 'examaware';
  return 'classisland';
}

function formatLabelOf(format?: string, label?: string): string {
  const explicit = String(label || '').trim();
  if (explicit) return explicit;
  switch (format) {
    case 'classisland': return 'ClassIsland';
    case 'cses': return 'CSES';
    case 'examaware': return 'ExamAware';
    default: return '配置';
  }
}

function formatClass(format?: string): string {
  return format === 'classisland' || format === 'cses' || format === 'examaware'
    ? `fmt-${format}`
    : 'fmt-unknown';
}

const instanceFormat = computed(() => deriveFormat(displayInstance.value));
const instanceFormatLabel = computed(() => {
  return formatLabelOf(instanceFormat.value, displayInstance.value?.format_label);
});
const instanceMode = computed<DistributionMode>(() => {
  return normalizeMode(displayInstance.value?.urls?.kind || displayInstance.value?.format_mode);
});
const modeHint = computed(() => {
  if (instanceFormat.value === 'examaware') {
    return '在 ExamAware 2 中使用该配置地址获取最新配置。';
  }
  if (instanceFormat.value === 'classisland') {
    return 'ClassIsland 通过该清单地址同步实例组配置。';
  }
  return '将该配置地址添加到支持 CSES 配置的程序中使用。';
});

const manifestUrl = computed(() => displayInstance.value?.urls?.manifest || '');
const configUrl = computed(() => displayInstance.value?.urls?.source || '');
const downloadHref = computed(() => {
  if (instanceMode.value !== 'static') return '';
  const id = displayInstance.value?.id;
  return typeof id === 'number' && Number.isFinite(id) ? distributionsApi.manifestUrl(id) : '';
});

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

/** 源文件下拉的 CustomSelect 选项 */
const sourceFileOptions = computed(() => fileOptions.value.map((f) => ({ value: f.id, label: f.name })));

const instanceNameError = computed(() => validateInstanceName(instanceName.value));
/** 锁定态下展示的源文件名（仅用于只读展示） */
const lockedSourceName = computed(() => {
  return displayInstance.value?.source_file_name
    || props.instance?.source_file_name
    || '来自分享的源文件';
});
const canSave = computed(() => {
  if (!props.instance || instanceNameError.value || saving.value) return false;
  // 共享实例源文件锁定：不要求选择源文件
  return !!props.sourceLocked || !!fileId.value;
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
  savedInstance.value = null;
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
  error.value = '';
  successMessage.value = '';
  saving.value = true;
  try {
    const body: { instance_id: string; organization_name: string; file_id?: number } = {
      instance_id: instanceName.value.trim(),
      organization_name: organizationName.value.trim(),
    };
    if (props.sourceLocked) {
      // 共享实例：源文件由分享者锁定，只提交实例标识与组织名称
    } else {
      const parsedFileId = Number(fileId.value);
      if (!Number.isFinite(parsedFileId)) {
        error.value = '请选择有效的源文件。';
        saving.value = false;
        return;
      }
      body.file_id = parsedFileId;
    }
    const dto = await distributionsApi.update(props.instance.id, body);
    if (!dto || typeof dto !== 'object') {
      throw new Error('服务端未返回配置实例信息，请稍后重试。');
    }
    successMessage.value = '已保存';
    const saved: DistributionInstance = { ...dto, id: Number(dto.id) };
    savedInstance.value = saved;
    emit('saved', saved);
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
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
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
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
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

/* 分发类型徽标 */
.im-format-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  line-height: 1.5;
  font-weight: 500;
  white-space: nowrap;
}
.im-format-badge.fmt-classisland { color: var(--accent-base); background: var(--accent-bg); }
.im-format-badge.fmt-cses { color: var(--status-success); background: rgba(16, 124, 16, 0.1); }
.im-format-badge.fmt-examaware { color: #7A5AF8; background: rgba(122, 90, 248, 0.12); }
.im-format-badge.fmt-unknown { color: var(--text-secondary); background: var(--subtle-secondary); }

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

.im-input {
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

.im-input:focus {
  border-color: var(--accent-base);
}

.im-input.invalid {
  border-color: var(--status-error);
}

/* 源文件下拉（CustomSelect）：只保留布局宽度，皮肤由组件提供 */
.im-select {
  width: 100%;
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
