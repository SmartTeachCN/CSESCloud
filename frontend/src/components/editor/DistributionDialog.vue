<template>
  <Teleport to="body" :disabled="!!embedded">
    <div v-if="visible" :class="embedded ? 'dd-embedded' : 'dd-overlay'" @click.self="embedded ? undefined : onClose()">
      <div :class="embedded ? 'dd-embedded-inner' : 'dd-card'">
        <div class="dd-header" v-if="!embedded">
          <div class="dd-title">
            <Icon icon="ri-git-branch-line" :size="16" />
            <span>分发配置</span>
          </div>
          <button class="dd-close" title="关闭" @click="onClose">
            <Icon icon="ri-close-line" :size="16" />
          </button>
        </div>

        <div class="dd-body">
          <!-- 源文件 -->
          <div class="dd-source">
            <Icon icon="ri-file-2-line" :size="14" />
            <span class="dd-source-name">{{ file?.name || '未选择文件' }}</span>
            <span class="dd-source-tag">源文件</span>
          </div>

          <!-- 源文件格式校验 -->
          <div class="dd-section">
            <div class="dd-section-title">
              <Icon icon="ri-shield-check-line" :size="13" />
              <span>配置校验</span>
            </div>
            <div v-if="validateState === 'loading'" class="dd-validate loading">
              <Icon icon="ri-loader-4-line" :size="14" class="spin" />
              <span>正在校验源文件...</span>
            </div>
            <div v-else-if="validateState === 'error'" class="dd-validate error">
              <Icon icon="ri-error-warning-line" :size="14" />
              <div class="dd-validate-body">
                <div>{{ validateError }}</div>
                <button class="dd-link-btn" @click="runValidate">重新校验</button>
              </div>
            </div>
            <div v-else class="dd-validate ok">
              <div class="dd-validate-summary">
                <Icon icon="ri-checkbox-circle-line" :size="14" />
                <span>配置校验通过</span>
                <span class="dd-format-badge" :class="formatClass(validateFormat)">{{ validateFormatLabel }}</span>
                <span class="dd-mode-tag">{{ modeLabel }}</span>
              </div>
              <div class="dd-validate-stats">
                <span v-for="item in statItems" :key="item.label" class="dd-stat">
                  <em>{{ item.label }}</em>{{ item.value }}
                </span>
              </div>
              <ul v-if="warnings.length" class="dd-warnings">
                <li v-for="(warning, i) in warnings" :key="i">
                  <Icon icon="ri-alert-line" :size="11" />
                  <span>{{ warning }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- 成功视图 -->
          <template v-if="result">
            <div class="dd-success">
              <div class="dd-success-title">
                <Icon icon="ri-checkbox-circle-fill" :size="15" />
                <span>{{ updatedExisting ? '已更新现有配置实例' : '配置实例创建成功' }}</span>
                <span class="dd-format-badge" :class="formatClass(resultFormat)">{{ resultFormatLabel }}</span>
              </div>
              <div class="dd-success-meta">
                <span>实例标识：<b>{{ result.name }}</b></span>
                <span>实例组标识：<b>{{ groupDirId || '-' }}</b></span>
                <span v-if="result.organization_name">组织名称：<b>{{ result.organization_name }}</b></span>
              </div>
            </div>

            <!-- 静态集控（ClassIsland）：清单地址 + 数据源模板 + 接入步骤 -->
            <template v-if="resultMode === 'static'">
              <div class="dd-section">
                <div class="dd-section-title">
                  <Icon icon="ri-link" :size="13" />
                  <span>清单地址</span>
                </div>
                <div class="dd-url-row">
                  <input class="dd-url" :value="manifestAddress" readonly placeholder="服务端未返回清单地址" />
                  <button class="dd-copy-btn" :disabled="!manifestAddress" @click="copyText(manifestAddress, 'manifest')">
                    <Icon :icon="copied === 'manifest' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                    <span>{{ copied === 'manifest' ? '已复制' : '复制' }}</span>
                  </button>
                </div>
                <div class="dd-url-hint">ClassIsland 通过该地址获取实例组的最新清单。</div>
              </div>

              <div class="dd-section">
                <div class="dd-section-title">
                  <Icon icon="ri-database-2-line" :size="13" />
                  <span>数据源模板</span>
                </div>
                <div class="dd-url-row">
                  <input class="dd-url" :value="templateAddress" readonly placeholder="服务端未返回数据源模板" />
                  <button class="dd-copy-btn" :disabled="!templateAddress" @click="copyText(templateAddress, 'template')">
                    <Icon :icon="copied === 'template' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                    <span>{{ copied === 'template' ? '已复制' : '复制' }}</span>
                  </button>
                </div>
                <div class="dd-url-hint">ClassIsland 同步时会替换其中的 {id}（实例标识）与 {key}（数据源）后逐项请求。</div>
              </div>

              <div class="dd-section">
                <div class="dd-section-title">
                  <Icon icon="ri-book-open-line" :size="13" />
                  <span>在 ClassIsland 中接入</span>
                </div>
                <ol class="dd-steps">
                  <li>下载清单文件并保存到本机可访问的位置。</li>
                  <li>打开 ClassIsland 设置页面，点右上角菜单 →「加入管理」。</li>
                  <li>点击「配置文件」左侧的文件夹图标，选择刚下载的清单文件并「打开」。</li>
                  <li>在「ID」处填写本实例的实例标识：<b>{{ result.name }}</b>（必填，无需带实例组标识）。</li>
                  <li>之后在 CSES Cloud 修改并保存配置后，到 ClassIsland「集控」设置页点「立即同步」即可。</li>
                </ol>
                <a
                  v-if="downloadHref"
                  class="dd-download-btn"
                  :href="downloadHref"
                  target="_blank"
                  rel="noopener"
                  title="下载 ClassIsland 管理清单文件"
                >
                  <Icon icon="ri-download-line" :size="14" />
                  <span>下载清单文件</span>
                </a>
              </div>
            </template>

            <!-- 配置地址（CSES / ExamAware 等） -->
            <template v-else>
              <div class="dd-section">
                <div class="dd-section-title">
                  <Icon icon="ri-link" :size="13" />
                  <span>配置地址</span>
                </div>
                <div class="dd-url-row">
                  <input class="dd-url source-url" :value="resultConfigUrl" readonly placeholder="服务端未返回配置地址" />
                  <button class="dd-copy-btn" :disabled="!resultConfigUrl" @click="copyText(resultConfigUrl, 'source')">
                    <Icon :icon="copied === 'source' ? 'ri-check-line' : 'ri-file-copy-line'" :size="13" />
                    <span>{{ copied === 'source' ? '已复制' : '复制' }}</span>
                  </button>
                </div>
                <div class="dd-url-actions">
                  <a v-if="resultConfigUrl" class="dd-open-btn" :href="resultConfigUrl" target="_blank" rel="noopener">
                    <Icon icon="ri-external-link-line" :size="13" />
                    <span>打开链接</span>
                  </a>
                </div>
                <div class="dd-url-hint">{{ urlModeHint }}</div>
              </div>
            </template>
          </template>

          <!-- 表单视图 -->
          <template v-else>
            <div class="dd-section">
              <label class="dd-label">实例标识 <span class="dd-required">*</span></label>
              <input
                v-model="instanceName"
                class="dd-input"
                :class="{ invalid: !!instanceNameError }"
                type="text"
                maxlength="60"
                placeholder="例如：高一1班"
                :disabled="submitting"
                @input="instanceNameTouched = true"
                @keyup.enter="submit"
              />
              <div v-if="instanceNameError" class="dd-field-error">{{ instanceNameError }}</div>
              <div v-else class="dd-field-hint">允许中文与空格，禁止 / \ : * ? " &lt; &gt; | 与「..」；用于标识该分发实例（ClassIsland 中填写的 ID 需与此一致）。</div>
              <div v-if="matchedInstance" class="dd-existing-hint">
                <Icon icon="ri-refresh-line" :size="13" />
                <span>已存在同名实例「{{ matchedInstance.name }}」，提交后将更新该实例。</span>
              </div>
            </div>

            <div class="dd-section">
              <label class="dd-label">组织名称</label>
              <input
                v-model="organizationName"
                class="dd-input"
                type="text"
                maxlength="100"
                placeholder="例如：CSES Cloud (实例组标识)"
                :disabled="submitting"
                @keyup.enter="submit"
              />
              <div class="dd-field-hint">在实例列表与集控信息中展示的组织名称。</div>
            </div>

            <div class="dd-section">
              <label class="dd-label">实例组标识</label>
              <div class="dd-readonly-row">
                <input class="dd-input readonly" :value="groupDirId || '加载中...'" readonly />
                <button class="dd-icon-btn" :disabled="!groupDirId" title="复制实例组标识" @click="copyText(groupDirId, 'group')">
                  <Icon :icon="copied === 'group' ? 'ri-check-line' : 'ri-file-copy-line'" :size="14" />
                </button>
              </div>
              <div class="dd-field-hint">同一实例组共用该标识，由服务端自动创建且只读。</div>
            </div>

            <div v-if="submitError" class="dd-error">
              <Icon icon="ri-error-warning-line" :size="14" />
              <span>{{ submitError }}</span>
            </div>
          </template>
        </div>

        <div class="dd-footer">
          <template v-if="result">
            <button class="dd-btn ghost" @click="onClose">关闭</button>
          </template>
          <template v-else>
            <button class="dd-btn ghost" :disabled="submitting" @click="onClose">取消</button>
            <button class="dd-btn primary" :disabled="!canSubmit" @click="submit">
              <Icon v-if="submitting" icon="ri-loader-4-line" :size="14" class="spin" />
              <span>{{ submitting ? '提交中...' : (matchedInstance ? '更新现有实例' : '创建分发实例') }}</span>
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

/** 分发模式：static=静态集控（ClassIsland 清单），url=公开配置地址（CSES / ExamAware） */
type DistributionMode = 'static' | 'url';

/** 分发地址（新契约 urls.kind；旧接口只有 manifest/file_template） */
interface DistributionUrls {
  kind?: string;
  manifest?: string;
  file_template?: string;
  source?: string;
}

/** 配置实例 DTO（对应 spec 3.4 的 InstanceDTO，字段缺失时降级展示） */
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
  group_id?: number;
  group_dir_id?: string;
  organization_name?: string;
  status?: string;
  updated_at?: string;
  version?: number;
  urls?: DistributionUrls;
  valid?: boolean;
  warning?: string;
}

interface DistributionOverview {
  group?: { id?: number; dir_id?: string; name?: string } | null;
  base_url?: string;
  manifest_url?: string;
  file_url_template?: string;
  instances?: DistributionInstance[];
}

const props = defineProps<{
  visible: boolean;
  file: { id: string; name: string; icon?: string } | null;
  overview: DistributionOverview | null;
  /** 嵌入模式（FilePropertiesDialog 的分发配置 Tab）：不渲染遮罩与标题栏 */
  embedded?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', instance: DistributionInstance): void;
}>();

type ValidateState = 'loading' | 'ok' | 'error';

const validateState = ref<ValidateState>('loading');
const validateResult = ref<any>(null);
const validateError = ref('');
const instanceName = ref('');
const organizationName = ref('');
const instanceNameTouched = ref(false);
const submitting = ref(false);
const submitError = ref('');
const result = ref<DistributionInstance | null>(null);
const updatedExisting = ref(false);
const copied = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const groupDirId = computed(() => {
  return props.overview?.group?.dir_id || validateResult.value?.group?.dir_id || '';
});

const warnings = computed<string[]>(() => {
  const list = validateResult.value?.warnings;
  if (!Array.isArray(list)) return [];
  return list
    .map((warning: any) => {
      if (typeof warning === 'string') return warning;
      if (warning && typeof warning === 'object') {
        return String(warning.message || warning.text || warning.warning || JSON.stringify(warning));
      }
      return String(warning ?? '');
    })
    .filter(Boolean);
});

const versionText = computed(() => {
  const data = validateResult.value || {};
  const v = data.document?.version !== undefined && data.document?.version !== null
    ? data.document.version
    : data.stats?.version;
  return v === undefined || v === null || v === '' ? '—' : `v${v}`;
});

/** 校验响应里的格式（旧接口无该字段时按静态集控/CSES 处理） */
const validateFormat = computed(() => String(validateResult.value?.format || ''));
const validateFormatLabel = computed(() => formatLabelOf(validateFormat.value, validateResult.value?.format_label));
const validateMode = computed<DistributionMode>(() => normalizeMode(validateResult.value?.mode));
const modeLabel = computed(() => (validateMode.value === 'static' ? '静态集控' : '配置地址'));

/** 校验统计：按格式展示对应数量（classisland / cses / examaware） */
const statItems = computed<Array<{ label: string; value: string }>>(() => {
  const data = validateResult.value || {};
  const doc = data.document || {};
  const pick = (value: unknown) => formatCount(value);
  if (validateFormat.value === 'classisland') {
    return [
      { label: '科目', value: pick(doc.subjects) },
      { label: '时间表', value: pick(doc.timelayouts) },
      { label: '课表', value: pick(doc.classplans) },
    ];
  }
  if (validateFormat.value === 'examaware') {
    return [{ label: '考试场次', value: pick(doc.exams) }];
  }
  const items: Array<{ label: string; value: string }> = [
    { label: '版本', value: versionText.value },
    { label: '科目', value: pick(doc.subjects) },
    { label: '课表', value: pick(doc.schedules) },
  ];
  // 兼容旧版静态集控返回的顶层统计
  if (data.classplans !== undefined && data.classplans !== null) {
    items.push({ label: '班级计划', value: pick(data.classplans) });
  }
  if (data.timelayouts !== undefined && data.timelayouts !== null) {
    items.push({ label: '时间表', value: pick(data.timelayouts) });
  }
  return items;
});

const instanceNameError = computed(() => validateInstanceName(instanceName.value));

const matchedInstance = computed<DistributionInstance | null>(() => {
  const name = instanceName.value.trim();
  if (!name) return null;
  const list = props.overview?.instances;
  if (!Array.isArray(list)) return null;
  return list.find((item) => item && item.name === name) || null;
});

const canSubmit = computed(() => {
  return !!props.file && validateState.value === 'ok' && !instanceNameError.value && !submitting.value;
});

const manifestAddress = computed(() => {
  return result.value?.urls?.manifest || validateResult.value?.urls?.manifest || props.overview?.manifest_url || '';
});

const templateAddress = computed(() => {
  return result.value?.urls?.file_template || validateResult.value?.urls?.file_template || props.overview?.file_url_template || '';
});

/** URL 模式的公开配置地址（CSES / ExamAware） */
const resultConfigUrl = computed(() => {
  return result.value?.urls?.source || validateResult.value?.urls?.source || '';
});

/** 成功视图的分发模式：新契约 urls.kind / format_mode，缺失时按 static 降级 */
const resultMode = computed<DistributionMode>(() => {
  return normalizeMode(result.value?.urls?.kind || result.value?.format_mode || validateMode.value);
});

const resultFormat = computed(() => String(result.value?.format || validateFormat.value || ''));
const resultFormatLabel = computed(() => {
  return formatLabelOf(resultFormat.value, result.value?.format_label || validateResult.value?.format_label);
});

const downloadHref = computed(() => {
  if (resultMode.value !== 'static') return '';
  const id = result.value?.id;
  return typeof id === 'number' && Number.isFinite(id) ? distributionsApi.manifestUrl(id) : '';
});

/** URL 模式下按格式给出使用提示 */
const urlModeHint = computed(() => {
  if (resultFormat.value === 'examaware') {
    return '在 ExamAware 2 中使用该配置地址获取最新配置；之后在 CSES Cloud 修改并保存云文件，地址保持不变。';
  }
  return '将该地址添加到支持 CSES 配置的程序（或分享给他人）即可获取最新配置；之后修改并保存云文件，地址保持不变。';
});

/** 统一分发模式：新契约 mode / urls.kind，缺失时按 static 降级 */
function normalizeMode(value: unknown): DistributionMode {
  return String(value || '') === 'url' ? 'url' : 'static';
}

/** 由 format 推导展示标签（format_label 缺失时兜底） */
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

/** 格式徽标 CSS 类（未知格式使用中性色） */
function formatClass(format?: string): string {
  return format === 'classisland' || format === 'cses' || format === 'examaware'
    ? `fmt-${format}`
    : 'fmt-unknown';
}

/** 把校验返回的“数量”字段统一转成可展示文本（可能为数字/数组/对象/布尔） */
function formatCount(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return String(value.length);
  if (value && typeof value === 'object') return String(Object.keys(value).length);
  if (typeof value === 'boolean') return value ? '有' : '无';
  if (typeof value === 'string' && value.trim()) return value;
  return '-';
}

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

function stripExtension(name: string): string {
  const trimmed = (name || '').trim();
  const dot = trimmed.lastIndexOf('.');
  return (dot > 0 ? trimmed.slice(0, dot) : trimmed).trim();
}

function resetState() {
  validateState.value = 'loading';
  validateResult.value = null;
  validateError.value = '';
  submitting.value = false;
  submitError.value = '';
  result.value = null;
  updatedExisting.value = false;
  copied.value = '';
  if (copiedTimer) {
    clearTimeout(copiedTimer);
    copiedTimer = null;
  }
  instanceName.value = stripExtension(props.file?.name || '');
  organizationName.value = groupDirId.value ? `CSES Cloud (${groupDirId.value})` : 'CSES Cloud';
  instanceNameTouched.value = false;
}

async function runValidate() {
  if (!props.file) return;
  const fileId = Number(props.file.id);
  if (!Number.isFinite(fileId)) {
    validateState.value = 'error';
    validateError.value = '源文件无效，无法校验。';
    return;
  }
  validateState.value = 'loading';
  validateResult.value = null;
  validateError.value = '';
  try {
    const data = await distributionsApi.validate(fileId);
    // 兼容两种失败表达：HTTP 错误（catch 分支）与 { ok: false, error } 业务失败
    if (!data || data.ok === false) {
      validateState.value = 'error';
      validateError.value = data?.error || '源文件不是有效的可分发配置，无法分发。';
    } else {
      validateResult.value = data;
      validateState.value = 'ok';
      // 使用后端清洗后的默认实例标识（与 create 的去重逻辑保持一致）
      if (!instanceNameTouched.value && typeof data.default_instance_id === 'string' && data.default_instance_id) {
        instanceName.value = data.default_instance_id;
      }
      // 若打开对话框时实例组尚未加载，校验响应里也带有 group.dir_id，用于回填默认组织名
      const dirId = data?.group?.dir_id;
      if (dirId && (!organizationName.value.trim() || organizationName.value === 'CSES Cloud')) {
        organizationName.value = `CSES Cloud (${dirId})`;
      }
    }
  } catch (e: any) {
    validateState.value = 'error';
    validateError.value = e?.message || '校验失败，请稍后重试。';
  }
}

function open() {
  resetState();
  void runValidate();
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) open();
  },
  { immediate: true }
);

// 嵌入模式下切换源文件时重新校验
watch(
  () => props.file?.id,
  () => {
    if (props.visible) open();
  }
);

async function submit() {
  if (submitting.value || !props.file) return;
  if (instanceNameError.value) return;
  const fileId = Number(props.file.id);
  if (!Number.isFinite(fileId)) {
    submitError.value = '源文件无效，请重新打开文件后再试。';
    return;
  }
  submitError.value = '';
  submitting.value = true;
  try {
    const name = instanceName.value.trim();
    const organization = organizationName.value.trim();
    const existing = matchedInstance.value;
    let dto: DistributionInstance;
    if (existing) {
      dto = await distributionsApi.update(existing.id, {
        file_id: fileId,
        instance_id: name,
        organization_name: organization,
      });
      updatedExisting.value = true;
    } else {
      dto = await distributionsApi.create({
        file_id: fileId,
        instance_id: name,
        organization_name: organization,
      });
      updatedExisting.value = false;
    }
    if (!dto || typeof dto !== 'object') {
      throw new Error('服务端未返回配置实例信息，请稍后重试。');
    }
    const savedInstance: DistributionInstance = { ...dto, id: Number(dto.id) };
    result.value = savedInstance;
    emit('saved', savedInstance);
  } catch (e: any) {
    submitError.value = e?.message || '分发失败，请稍后重试。';
  } finally {
    submitting.value = false;
  }
}

async function copyText(text: string, key: string) {
  if (!text) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // 浏览器不支持/非安全上下文时降级为 execCommand
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
    alert('复制失败，请手动选择文本复制：' + text);
    return;
  }
  copied.value = key;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    if (copied.value === key) copied.value = '';
  }, 2000);
}

function onClose() {
  if (submitting.value) return;
  emit('close');
}
</script>

<style scoped>
.dd-overlay {
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

.dd-card {
  width: 560px;
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

/* 嵌入模式：仅渲染内容与底部按钮（用于 FilePropertiesDialog 的分发配置 Tab） */
.dd-embedded {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.dd-embedded-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}

.dd-embedded-inner .dd-body {
  padding-top: var(--spacer-3);
}

.dd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.dd-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.dd-close {
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

.dd-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.dd-body {
  padding: var(--spacer-3) var(--spacer-4);
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.dd-source {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.dd-source-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 500;
}

.dd-source-tag {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-tertiary);
}

.dd-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.dd-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

/* 校验状态 */
.dd-validate {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.dd-validate.loading {
  align-items: center;
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.dd-validate.ok {
  flex-direction: column;
  gap: var(--spacer-1);
  background: rgba(16, 124, 16, 0.08);
  border: 1px solid rgba(16, 124, 16, 0.18);
  color: var(--status-success);
}

.dd-validate.error {
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  color: var(--status-error);
}

.dd-validate-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.dd-validate-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

/* 分发类型徽标 / 模式标签 */
.dd-format-badge {
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
.dd-format-badge.fmt-classisland { color: var(--accent-base); background: var(--accent-bg); }
.dd-format-badge.fmt-cses { color: var(--status-success); background: rgba(16, 124, 16, 0.1); }
.dd-format-badge.fmt-examaware { color: #7A5AF8; background: rgba(122, 90, 248, 0.12); }
.dd-format-badge.fmt-unknown { color: var(--text-secondary); background: var(--subtle-secondary); }
.dd-mode-tag {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  font-size: 10px;
  line-height: 1.5;
  font-weight: 400;
  color: var(--text-tertiary);
}

.dd-validate-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacer-1) var(--spacer-3);
  color: var(--text-secondary);
}

.dd-stat {
  font-size: 11px;
}

.dd-stat em {
  font-style: normal;
  color: var(--text-tertiary);
  margin-right: 4px;
}

.dd-warnings {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--status-warning);
}

.dd-warnings li {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 11px;
}

.dd-link-btn {
  align-self: flex-start;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--accent-base);
  font-size: var(--font-size-xs);
  cursor: pointer;
  text-decoration: underline;
}

/* 表单 */
.dd-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.dd-required {
  color: var(--status-error);
}

.dd-input {
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

.dd-input:focus {
  border-color: var(--accent-base);
}

.dd-input.invalid {
  border-color: var(--status-error);
}

.dd-input.readonly {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
  cursor: default;
}

.dd-readonly-row {
  display: flex;
  gap: 6px;
}

.dd-icon-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.dd-icon-btn:hover:not(:disabled) {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.dd-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dd-field-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.dd-field-error {
  font-size: 11px;
  color: var(--status-error);
}

.dd-existing-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-1) var(--spacer-2);
  background: rgba(255, 140, 0, 0.08);
  border: 1px solid rgba(255, 140, 0, 0.2);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--status-warning);
}

.dd-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--status-error);
}

/* 成功视图 */
.dd-success {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(16, 124, 16, 0.08);
  border: 1px solid rgba(16, 124, 16, 0.18);
  border-radius: var(--radius-sm);
}

.dd-success-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--status-success);
}

.dd-success-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacer-1) var(--spacer-3);
  font-size: 11px;
  color: var(--text-secondary);
}

.dd-success-meta b {
  color: var(--text-primary);
  font-weight: 600;
}

.dd-url-row {
  display: flex;
  gap: 6px;
}

.dd-url {
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

.dd-copy-btn {
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

.dd-copy-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.dd-copy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dd-url-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

/* 配置地址（URL 模式） */
.dd-url.source-url {
  height: 40px;
  font-size: var(--font-size-sm);
}

.dd-url-actions {
  display: flex;
  gap: var(--spacer-2);
}

.dd-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  text-decoration: none;
}

.dd-open-btn:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.dd-steps {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  line-height: 1.6;
}

.dd-steps b {
  color: var(--text-primary);
}

.dd-download-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-2) var(--spacer-4);
  background: var(--accent-base);
  color: white;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  text-decoration: none;
}

.dd-download-btn:hover {
  background: var(--accent-hover);
}

/* 底部 */
.dd-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.dd-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.dd-btn.ghost {
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  color: var(--text-secondary);
}

.dd-btn.ghost:hover:not(:disabled) {
  background: var(--subtle-secondary);
}

.dd-btn.primary {
  background: var(--accent-base);
  color: var(--accent-text);
  border: none;
}

.dd-btn.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.dd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
