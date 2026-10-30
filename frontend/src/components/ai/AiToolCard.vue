<template>
  <div
    class="ai-tool"
    :class="[`status-${block.status}`, block.risk === 'write' ? 'risk-write' : 'risk-read']"
  >
    <button
      type="button"
      class="tool-head"
      :aria-expanded="expanded"
      :title="block.label || block.name"
      @click="expanded = !expanded"
    >
      <span class="tool-status" :class="`status-${block.status}`">
        <span v-if="block.status === 'running'" class="spinner" aria-hidden="true"></span>
        <Icon v-else-if="block.status === 'done'" icon="ri-check-line" :size="13" />
        <Icon v-else-if="block.status === 'error'" icon="ri-error-warning-line" :size="13" />
        <Icon v-else icon="ri-time-line" :size="13" class="awaiting-icon" />
      </span>

      <span class="tool-label">{{ block.label || block.name }}</span>
      <span v-if="argSummary" class="tool-args" :title="argFull">{{ argSummary }}</span>
      <span class="tool-spacer"></span>

      <span v-if="elapsedLabel" class="tool-elapsed">{{ elapsedLabel }}</span>
      <span v-if="block.risk === 'write'" class="tool-badge write">写</span>
      <span v-else-if="block.scope === 'client'" class="tool-badge">浏览器</span>

      <Icon
        :icon="expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"
        :size="14"
        class="tool-arrow"
      />
    </button>

    <transition name="tool-expand">
      <div v-if="expanded" class="tool-body">
        <template v-if="block.status === 'running'">
          <div class="tool-state-line">正在执行…</div>
        </template>
        <template v-else-if="block.status === 'awaiting'">
          <div class="tool-state-line awaiting">等待浏览器/用户完成该操作…</div>
        </template>
        <div v-if="block.summary" class="tool-summary" :class="{ error: block.status === 'error' }">
          {{ block.summary }}
        </div>
        <div v-if="hasArgs" class="tool-section">
          <div class="section-label">参数</div>
          <pre class="tool-pre args-pre">{{ prettyArgs }}</pre>
        </div>
        <div v-if="displayResult" class="tool-section">
          <div class="section-label">
            结果
            <span class="section-count">{{ resultChars }} 字符</span>
          </div>
          <pre class="tool-pre result-pre">{{ displayResult }}</pre>
          <div v-if="resultTruncated" class="section-hint">内容较长，仅显示前 {{ RESULT_LIMIT }} 字符</div>
        </div>
        <div v-if="block.image" class="tool-section">
          <div class="section-label">截图</div>
          <img
            class="tool-image"
            :src="block.image"
            alt="工具截图"
            @click="openPreview(block.image)"
          />
        </div>
      </div>
    </transition>

    <Teleport to="body">
      <div v-if="previewSrc" class="ai-image-overlay" @click="previewSrc = null">
        <img class="ai-image-preview" :src="previewSrc" alt="截图预览" />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AiToolBlock } from '../../composables/useAiStream';

/**
 * 工具调用卡片：折叠一行摘要（状态图标 + label + 参数摘要 + 耗时），展开看参数/结果/截图。
 * risk=write 的卡片带警示色左侧强调条。
 */
const props = defineProps<{
  block: AiToolBlock;
}>();

const RESULT_LIMIT = 8000;

const expanded = ref(false);
const previewSrc = ref<string | null>(null);

const startedAt = ref<number | null>(null);
const finishedAt = ref<number | null>(null);
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

const active = computed(
  () => props.block.status === 'running' || props.block.status === 'awaiting'
);

const shortVal = (v: any): string => {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 37)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} 项]`;
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 37)}…` : s;
  } catch {
    return '{…}';
  }
};

const argEntries = computed<string[]>(() => {
  const args = props.block.args;
  if (!args || typeof args !== 'object') return [];
  return Object.entries(args).map(([k, v]) => `${k}=${shortVal(v)}`);
});

const argFull = computed(() => argEntries.value.join(' · '));
const argSummary = computed(() => {
  const s = argFull.value;
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
});
const hasArgs = computed(
  () =>
    argEntries.value.length > 0 ||
    (typeof props.block.args === 'string' && props.block.args.trim() !== '')
);

const prettyArgs = computed(() => {
  const args = props.block.args;
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
});

const resultChars = computed(() => (props.block.result || '').length);
const resultTruncated = computed(() => resultChars.value > RESULT_LIMIT);
const displayResult = computed(() => {
  const r = props.block.result || '';
  return resultTruncated.value ? r.slice(0, RESULT_LIMIT) : r;
});

const elapsedLabel = computed(() => {
  // 服务端/历史记录带 ms（毫秒）时优先用它，避免历史卡片没有本地计时
  if (typeof props.block.ms === 'number' && props.block.ms >= 0) {
    return formatDuration(props.block.ms);
  }
  if (startedAt.value == null) return '';
  if (finishedAt.value != null) {
    return formatDuration(finishedAt.value - startedAt.value);
  }
  if (active.value) return formatDuration(now.value - startedAt.value);
  return '';
});

function formatDuration(ms: number): string {
  const sec = ms / 1000;
  if (sec < 0.1) return '<0.1s';
  if (sec < 10) return `${sec.toFixed(1)}s`;
  return `${Math.round(sec)}s`;
}

function startTicker() {
  if (ticker) return;
  now.value = Date.now();
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 500);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function openPreview(src: string | undefined) {
  if (!src) return;
  previewSrc.value = src;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') previewSrc.value = null;
}

watch(
  () => props.block.status,
  (status, prev) => {
    if (status === prev) return;
    if (status === 'running' || status === 'awaiting') {
      if (startedAt.value == null) startedAt.value = Date.now();
      startTicker();
      // 等待浏览器执行时自动展开，让用户看到即将执行的操作
      if (status === 'awaiting') expanded.value = true;
    } else {
      if (startedAt.value != null && finishedAt.value == null) finishedAt.value = Date.now();
      stopTicker();
      if (status === 'error') expanded.value = true;
    }
  }
);

watch(previewSrc, (val) => {
  if (val) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
});

onMounted(() => {
  if (active.value) {
    startedAt.value = Date.now();
    startTicker();
  }
  if (props.block.status === 'error') expanded.value = true;
  if (props.block.status === 'awaiting') expanded.value = true;
});

onBeforeUnmount(() => {
  stopTicker();
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.ai-tool {
  position: relative;
  min-width: 0;
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--fast-duration), background var(--fast-duration);
}

.ai-tool::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--divider-stroke);
}

.ai-tool.risk-write::before {
  background: var(--status-warning);
}

.ai-tool.status-error {
  border-color: var(--status-error);
}

.ai-tool.status-error::before {
  background: var(--status-error);
}

.ai-tool.status-awaiting {
  border-color: var(--status-warning);
}

.tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px 6px 10px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.tool-head:hover {
  background: var(--subtle-pressed);
}

.tool-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.tool-status.status-done { color: var(--status-success); }
.tool-status.status-error { color: var(--status-error); }
.tool-status.status-awaiting { color: var(--status-warning); }
.tool-status.status-running { color: var(--accent-base); }

.spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: ai-tool-spin 0.75s linear infinite;
}

.awaiting-icon {
  animation: ai-tool-pulse 1.4s ease-in-out infinite;
}

.tool-label {
  max-width: 45%;
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--text-primary);
}

.tool-args {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-spacer {
  flex: 0 0 2px;
}

.tool-elapsed {
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.tool-badge {
  flex-shrink: 0;
  padding: 0 4px;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.5;
}

.tool-badge.write {
  color: var(--status-warning);
  border-color: var(--status-warning);
}

.tool-arrow {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

/* 展开详情 */
.tool-body {
  padding: 6px 8px 8px 10px;
  border-top: 1px solid var(--divider-stroke);
  background: var(--subtle-tertiary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-state-line {
  color: var(--text-tertiary);
  font-size: 11.5px;
}

.tool-state-line.awaiting {
  color: var(--status-warning);
}

.tool-summary {
  color: var(--text-secondary);
  font-size: 11.5px;
  line-height: 1.5;
  word-break: break-word;
}

.tool-summary.error {
  color: var(--status-error);
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.section-count {
  color: var(--text-tertiary);
  opacity: 0.75;
}

.section-hint {
  color: var(--text-tertiary);
  font-size: 10.5px;
}

.tool-pre {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 6px 8px;
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
}

.args-pre {
  max-height: 140px;
}

.tool-image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  cursor: zoom-in;
}

/* 大图预览 */
.ai-image-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-6);
  background: rgba(0, 0, 0, 0.68);
  cursor: zoom-out;
  animation: ai-tool-fade-in var(--fast-duration) ease both;
}

.ai-image-preview {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}

/* 展开动画 */
.tool-expand-enter-active,
.tool-expand-leave-active {
  transition: opacity var(--fast-duration) ease;
}

.tool-expand-enter-from,
.tool-expand-leave-to {
  opacity: 0;
}

@keyframes ai-tool-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes ai-tool-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@keyframes ai-tool-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner,
  .awaiting-icon {
    animation: none;
  }
}
</style>
