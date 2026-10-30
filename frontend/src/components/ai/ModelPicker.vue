<template>
  <div class="model-picker" :class="{ 'is-disabled': disabled }">
    <button
      ref="modelTriggerEl"
      type="button"
      class="mp-trigger"
      :disabled="disabled"
      :title="`模型：${currentLabel}`"
      @click.stop="togglePanel('model')"
    >
      <Icon icon="ri-cpu-line" :size="15" class="mp-trigger-icon" />
      <span class="mp-trigger-label">{{ currentLabel }}</span>
      <Icon icon="ri-arrow-down-s-line" :size="14" class="mp-caret" :class="{ open: panel === 'model' }" />
    </button>

    <button
      ref="reasoningTriggerEl"
      type="button"
      class="mp-trigger mp-trigger-reasoning"
      :class="{ 'is-unsupported': !supportsThinking }"
      :disabled="disabled"
      :aria-disabled="supportsThinking ? 'false' : 'true'"
      :title="reasoningHint"
      @click.stop="togglePanel('reasoning')"
    >
      <Icon icon="ri-brain-line" :size="14" class="mp-trigger-icon" />
      <span class="mp-trigger-label">{{ reasoningTriggerLabel }}</span>
      <Icon icon="ri-arrow-down-s-line" :size="14" class="mp-caret" :class="{ open: panel === 'reasoning' }" />
    </button>

    <Teleport to="body">
      <div
        v-if="panel === 'model'"
        ref="panelEl"
        class="mp-panel"
        :style="panelStyle"
        @pointerdown.stop
        @click.stop
      >
        <div class="mp-panel-title">选择模型</div>
        <div class="mp-panel-body">
          <template v-for="group in choiceGroups" :key="group.label">
            <div class="mp-group-label">{{ group.label }}</div>
            <button
              v-for="choice in group.items"
              :key="choice.value"
              type="button"
              class="mp-option"
              :class="{ active: choice.value === resolvedModel }"
              :title="choice.meta || choice.label"
              @click="chooseModel(choice)"
            >
              <Icon :icon="choice.icon" :size="15" class="mp-option-icon" />
              <span class="mp-option-main">
                <span class="mp-option-label">{{ choice.label }}</span>
                <span v-if="choice.meta" class="mp-option-meta">{{ choice.meta }}</span>
              </span>
              <Icon v-if="choice.value === resolvedModel" icon="ri-check-line" :size="15" class="mp-check" />
            </button>
          </template>
          <div v-if="!choiceGroups.length" class="mp-empty">暂无可用模型</div>
        </div>
        <div class="mp-panel-footer">
          <Icon icon="ri-information-line" :size="13" />
          <span>预设模型需先在「模型设置」里配置 API Key，未配置时会回落到规则引擎</span>
        </div>
      </div>

      <div
        v-else-if="panel === 'reasoning'"
        ref="panelEl"
        class="mp-panel mp-reasoning-panel"
        :style="panelStyle"
        @pointerdown.stop
        @click.stop
      >
        <div class="mp-panel-title">推理等级</div>
        <div class="mp-panel-subtitle">{{ currentLabel }}</div>
        <div v-if="!supportsThinking" class="mp-hint">
          <Icon icon="ri-information-line" :size="14" />
          <span>该模型不支持推理等级</span>
        </div>
        <div v-else class="mp-panel-body">
          <button
            v-for="level in availableLevels"
            :key="level"
            type="button"
            class="mp-option"
            :class="{ active: level === effectiveReasoning }"
            @click="chooseReasoning(level)"
          >
            <Icon :icon="levelIcon(level)" :size="15" class="mp-option-icon" />
            <span class="mp-option-main">
              <span class="mp-option-label">{{ reasoningLabel(level) }}</span>
              <span class="mp-option-meta">{{ reasoningDescription(level) }}</span>
            </span>
            <Icon v-if="level === effectiveReasoning" icon="ri-check-line" :size="15" class="mp-check" />
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
/** localStorage 键：与页面共享，避免两处各写一套 */
export const AI_MODEL_STORAGE_KEY = 'cses.ai.model';
export const AI_REASONING_STORAGE_KEY = 'cses.ai.reasoning';

/** 服务端 preset 项（GET /api/ai/models?action=presets） */
export interface AiModelPreset {
  key: string;
  label?: string;
  provider?: string;
  model_id?: string;
  /** 可用推理等级子集，如 ["auto","off","low","medium","high","max"] */
  levels?: string[];
  /** 默认推理等级 */
  default?: string;
  capabilities?: { thinking?: boolean; reasoning_effort?: boolean };
}

export interface AiModelPrefs {
  model: string;
  reasoning: string;
}

/** 读取上次选择的模型 / 推理等级（无记录时返回空串，由页面决定回退值） */
export function loadModelPrefs(): AiModelPrefs {
  try {
    return {
      model: localStorage.getItem(AI_MODEL_STORAGE_KEY) || '',
      reasoning: localStorage.getItem(AI_REASONING_STORAGE_KEY) || '',
    };
  } catch {
    return { model: '', reasoning: '' };
  }
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { aiApi } from '../../api';

const ALL_LEVELS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const;

const REASONING_LABELS: Record<string, string> = {
  auto: '自动',
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  max: '最高',
};

const REASONING_DESCRIPTIONS: Record<string, string> = {
  auto: '跟随模型默认设置',
  off: '不进行深度思考，响应更快',
  low: '少量思考，速度优先',
  medium: '平衡速度与推理深度',
  high: '充分推理，适合复杂问题',
  max: '最大推理预算，最慢但最深入',
};

interface ModelChoice {
  value: string;
  label: string;
  meta?: string;
  icon: string;
  group: 'builtin' | 'preset' | 'custom';
  levels: string[];
  defaultReasoning: string;
  supportsThinking: boolean;
}

const props = withDefaults(
  defineProps<{
    /** 已选模型：'default' | 预设 key | 自定义模型 name（v-model:model） */
    model?: string;
    /** 推理等级：auto|off|low|medium|high|max|''（v-model:reasoning） */
    reasoning?: string;
    /** 自定义模型列表（aiApi.listModels() 结果） */
    models?: any[];
    /** 外部禁用（如正在生成） */
    disabled?: boolean;
    /** 是否把选择写入 localStorage，默认 true */
    persist?: boolean;
  }>(),
  { model: '', reasoning: '', models: () => [], disabled: false, persist: true },
);

const emit = defineEmits<{
  (e: 'update:model', value: string): void;
  (e: 'update:reasoning', value: string): void;
  (e: 'change', payload: { model: string; reasoning: string | undefined; supportsThinking: boolean }): void;
}>();

// ===== 面板开关与浮层定位 =====
type PanelKind = 'model' | 'reasoning' | null;
const panel = ref<PanelKind>(null);
const modelTriggerEl = ref<HTMLElement | null>(null);
const reasoningTriggerEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

async function updatePanelPosition() {
  await nextTick();
  const trigger = panel.value === 'model' ? modelTriggerEl.value : reasoningTriggerEl.value;
  const el = panelEl.value;
  if (!trigger || !el) return;
  const rect = trigger.getBoundingClientRect();
  const pad = 8;
  const width = el.offsetWidth || 260;
  const height = el.offsetHeight || 260;
  let left = rect.left;
  if (left + width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - width);
  // 输入框在页面底部：优先向上展开，上方空间不足时改为向下
  const spaceAbove = rect.top - pad;
  if (spaceAbove >= height || spaceAbove >= window.innerHeight - rect.bottom - pad) {
    const bottom = Math.max(pad, window.innerHeight - rect.top + 6);
    panelStyle.value = { left: `${Math.round(left)}px`, bottom: `${Math.round(bottom)}px` };
  } else {
    panelStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(rect.bottom + 6)}px` };
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (panelEl.value?.contains(target)) return;
  if (modelTriggerEl.value?.contains(target) || reasoningTriggerEl.value?.contains(target)) return;
  panel.value = null;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  panel.value = null;
}

function onViewportChange() {
  panel.value = null;
}

function bindGlobalListeners() {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
}

function unbindGlobalListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
}

async function togglePanel(kind: Exclude<PanelKind, null>) {
  if (props.disabled) return;
  if (panel.value === kind) {
    panel.value = null;
    return;
  }
  panel.value = kind;
  await updatePanelPosition();
}

watch(panel, (value) => {
  if (value) bindGlobalListeners();
  else unbindGlobalListeners();
});

onBeforeUnmount(unbindGlobalListeners);

// ===== 模型列表（内置 + 服务器预设 + 自定义） =====
const presets = ref<AiModelPreset[]>([]);

async function loadPresets() {
  try {
    const list = await aiApi.presets();
    presets.value = Array.isArray(list) ? list : [];
  } catch {
    presets.value = [];
  }
}

onMounted(() => {
  loadPresets();
});

function detectPresetThinking(preset: AiModelPreset): boolean {
  if (typeof preset.capabilities?.thinking === 'boolean') return preset.capabilities.thinking;
  const levels = Array.isArray(preset.levels) ? preset.levels : [];
  return levels.some(level => level !== 'auto' && level !== 'off');
}

/** 自定义模型是否支持 thinking：优先用服务端 capabilities，其次按 provider/model_id 推断 */
function detectCustomThinking(model: any): boolean {
  if (typeof model?.capabilities?.thinking === 'boolean') return model.capabilities.thinking;
  const provider = String(model?.provider || '').toLowerCase();
  const modelId = String(model?.model_id || '').toLowerCase();
  if (provider === 'deepseek') return modelId.includes('reasoner') || modelId.includes('r1');
  if (provider === 'openai') return /^(o1|o3|o4|gpt-5)/.test(modelId);
  if (provider === 'anthropic') return modelId.includes('thinking') || /claude-(3-7|4|sonnet-4|opus-4)/.test(modelId);
  if (provider === 'google') return /gemini-(2\.5|3)/.test(modelId);
  return false;
}

const builtinChoices: ModelChoice[] = [
  {
    value: 'default',
    label: '默认规则引擎',
    meta: '内置规则，无需模型',
    icon: 'ri-brain-line',
    group: 'builtin',
    levels: [],
    defaultReasoning: 'auto',
    supportsThinking: false,
  },
];

const presetChoices = computed<ModelChoice[]>(() =>
  presets.value.map((preset) => {
    const levels = Array.isArray(preset.levels) && preset.levels.length ? [...preset.levels] : [...ALL_LEVELS];
    return {
      value: preset.key,
      label: preset.label || preset.key,
      meta: [preset.provider, preset.model_id || preset.key].filter(Boolean).join(' · '),
      icon: 'ri-sparkling-2-line',
      group: 'preset' as const,
      levels,
      defaultReasoning: preset.default || 'auto',
      supportsThinking: detectPresetThinking(preset),
    };
  }),
);

const customChoices = computed<ModelChoice[]>(() =>
  (props.models || []).map((model: any) => ({
    value: model.name,
    label: model.name,
    meta: [model.provider, model.model_id].filter(Boolean).join(' · '),
    icon: 'ri-cpu-line',
    group: 'custom' as const,
    levels: [...ALL_LEVELS],
    defaultReasoning: 'auto',
    supportsThinking: detectCustomThinking(model),
  })),
);

const choices = computed<ModelChoice[]>(() => [
  ...builtinChoices,
  ...presetChoices.value,
  ...customChoices.value,
]);

const choiceGroups = computed(() => {
  const groups = [
    { label: '内置', items: builtinChoices },
    { label: '服务器预设', items: presetChoices.value },
    { label: '自定义模型', items: customChoices.value },
  ];
  return groups.filter(group => group.items.length > 0);
});

// ===== 当前选择 =====
const currentChoice = computed<ModelChoice | null>(
  () => choices.value.find(choice => choice.value === props.model) || null,
);

const resolvedModel = computed(() => currentChoice.value?.value ?? (props.model || 'default'));
const currentLabel = computed(() => currentChoice.value?.label ?? (props.model || '默认规则引擎'));
const supportsThinking = computed(() => !!currentChoice.value?.supportsThinking);

const availableLevels = computed<string[]>(() => {
  const levels = currentChoice.value?.levels;
  if (!levels || !levels.length) return [...ALL_LEVELS];
  // 按固定顺序输出，避免服务端数组顺序不稳定
  return ALL_LEVELS.filter(level => levels.includes(level));
});

/** 实际生效的推理等级；不支持 thinking 时为空串（发送时传 undefined） */
const effectiveReasoning = computed(() => {
  if (!supportsThinking.value) return '';
  const levels = availableLevels.value;
  const wanted = props.reasoning;
  if (wanted && levels.includes(wanted)) return wanted;
  const fallback = currentChoice.value?.defaultReasoning || 'auto';
  return levels.includes(fallback) ? fallback : levels[0] || 'auto';
});

const reasoningTriggerLabel = computed(() =>
  supportsThinking.value ? reasoningLabel(effectiveReasoning.value) : '不支持',
);
const reasoningHint = computed(() =>
  supportsThinking.value
    ? `推理等级：${reasoningLabel(effectiveReasoning.value)}`
    : '该模型不支持推理等级',
);

function reasoningLabel(level: string): string {
  return REASONING_LABELS[level] || level || '自动';
}

function reasoningDescription(level: string): string {
  return REASONING_DESCRIPTIONS[level] || '';
}

function levelIcon(level: string): string {
  if (level === 'off') return 'ri-stop-circle-line';
  if (level === 'auto') return 'ri-magic-line';
  return 'ri-speed-up-line';
}

function persistPrefs(model: string, reasoning: string) {
  if (!props.persist) return;
  try {
    localStorage.setItem(AI_MODEL_STORAGE_KEY, model);
    localStorage.setItem(AI_REASONING_STORAGE_KEY, reasoning || 'auto');
  } catch {
    /* localStorage 不可用时静默忽略 */
  }
}

function emitChange(model: string, reasoning: string, thinking: boolean) {
  emit('change', { model, reasoning: thinking && reasoning ? reasoning : undefined, supportsThinking: thinking });
}

function chooseModel(choice: ModelChoice) {
  panel.value = null;
  emit('update:model', choice.value);

  const levels = choice.levels.length ? choice.levels : [...ALL_LEVELS];
  let nextReasoning = props.reasoning;
  if (!choice.supportsThinking) {
    nextReasoning = '';
  } else if (!nextReasoning || !levels.includes(nextReasoning)) {
    const fallback = choice.defaultReasoning && levels.includes(choice.defaultReasoning) ? choice.defaultReasoning : 'auto';
    nextReasoning = fallback;
  }
  if (nextReasoning !== props.reasoning) emit('update:reasoning', nextReasoning);

  persistPrefs(choice.value, nextReasoning);
  emitChange(choice.value, nextReasoning, choice.supportsThinking);
}

function chooseReasoning(level: string) {
  panel.value = null;
  if (!supportsThinking.value) return;
  if (level !== props.reasoning) emit('update:reasoning', level);
  persistPrefs(resolvedModel.value, level);
  emitChange(resolvedModel.value, level, true);
}

// 外部切换模型（如预设列表延迟加载后）导致当前等级不可用时，回落到该模型的默认等级
watch(
  () => [props.model, supportsThinking.value, availableLevels.value.join(',')],
  () => {
    if (!supportsThinking.value) {
      if (props.reasoning) emit('update:reasoning', '');
      return;
    }
    const levels = availableLevels.value;
    if (props.reasoning && !levels.includes(props.reasoning)) {
      emit('update:reasoning', effectiveReasoning.value);
    }
  },
);

defineExpose({ reloadPresets: loadPresets });
</script>

<style scoped>
.model-picker {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.model-picker.is-disabled {
  opacity: 0.7;
}

.mp-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 8px;
  max-width: 168px;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--fast-duration), border-color var(--fast-duration), color var(--fast-duration);
}

.mp-trigger:hover:not(:disabled) {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.mp-trigger:disabled {
  cursor: default;
}

.mp-trigger-reasoning {
  max-width: 104px;
}

.mp-trigger.is-unsupported {
  color: var(--text-tertiary);
  border-style: dashed;
}

.mp-trigger-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.mp-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-caret {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform var(--fast-duration);
}

.mp-caret.open {
  transform: rotate(180deg);
}

/* ===== 浮层 ===== */
.mp-panel {
  position: fixed;
  z-index: 9998;
  width: 272px;
  max-width: calc(100vw - 16px);
  padding: 4px;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  box-sizing: border-box;
  animation: mp-fade-in var(--fast-duration) var(--fast-out-slow-in);
}

@keyframes mp-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.mp-panel-title {
  padding: 8px 10px 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-primary);
}

.mp-panel-subtitle {
  padding: 0 10px 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-panel-body {
  max-height: 320px;
  overflow-y: auto;
  padding: 2px 2px 4px;
}

.mp-group-label {
  padding: 6px 8px 2px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.mp-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  text-align: left;
  cursor: pointer;
  transition: background var(--fast-duration);
}

.mp-option:hover {
  background: var(--subtle-secondary);
}

.mp-option.active {
  background: var(--accent-bg);
}

.mp-option-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.mp-option.active .mp-option-icon,
.mp-option.active .mp-check {
  color: var(--accent-base);
}

.mp-option-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mp-option-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-option-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-check {
  flex-shrink: 0;
  color: var(--accent-base);
}

.mp-empty {
  padding: 16px 10px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.mp-panel-footer {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 2px;
  padding: 8px 10px;
  border-top: 1px solid var(--divider-stroke);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.mp-panel-footer :deep(svg) {
  flex-shrink: 0;
  margin-top: 1px;
}

.mp-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 6px 6px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}
</style>
