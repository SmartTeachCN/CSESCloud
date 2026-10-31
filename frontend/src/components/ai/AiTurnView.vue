<template>
  <div class="ai-turn" :class="[`turn-${displayStatus}`, { live: isLive }]">
    <template v-for="(block, i) in blocks" :key="blockKey(block, i)">
      <div v-if="block.type === 'reasoning'" class="turn-block">
        <AiReasoningBlock
          :text="block.text"
          :done="block.done"
          :seconds="block.seconds"
        />
      </div>

      <div v-else-if="block.type === 'text'" class="turn-block turn-text">
        <div
          class="md-body"
          v-html="renderText(block.text, showCursorAt(i))"
        ></div>
      </div>

      <div v-else-if="block.type === 'tool'" class="turn-block">
        <AiToolCard :block="block" />
      </div>

      <div v-else-if="block.type === 'ask'" class="turn-block">
        <AiAskCard :block="block" @submit="onAskSubmit" />
      </div>
    </template>

    <AiWaitIndicator v-if="waitLabel" :label="waitLabel" class="turn-wait" />

    <div v-if="displayStatus === 'error'" class="turn-error">
      <Icon icon="ri-error-warning-line" :size="13" />
      <span class="turn-error-text">{{ errorText }}</span>
    </div>

    <div v-if="showMeta" class="turn-meta">
      <div class="meta-info">
        <span v-if="modelLabel" class="meta-chip">{{ modelLabel }}</span>
        <span v-if="reasoningLabel" class="meta-item">推理：{{ reasoningLabel }}</span>
        <span v-if="usageLabel" class="meta-item" :title="usageTitle">{{ usageLabel }}</span>
        <span v-if="elapsedLabel" class="meta-item">用时 {{ elapsedLabel }}</span>
      </div>

      <div v-if="showActions" class="meta-actions">
        <div
          v-if="variantTotal > 1"
          class="variant-switcher"
          :title="variantTitle"
        >
          <button
            type="button"
            class="meta-btn icon"
            :disabled="variantIndex === 0"
            aria-label="上一个版本"
            @click="variantIndex -= 1"
          >‹</button>
          <span class="variant-badge" :class="{ current: variantIndex === 0 }">{{ variantTag }}</span>
          <span class="variant-count">{{ variantIndex + 1 }}/{{ variantTotal }}</span>
          <button
            type="button"
            class="meta-btn icon"
            :disabled="variantIndex >= variantTotal - 1"
            aria-label="下一个版本"
            @click="variantIndex += 1"
          >›</button>
        </div>

        <button
          v-if="copyText"
          type="button"
          class="meta-btn"
          title="复制回答正文"
          @click="onCopy"
        >
          <Icon icon="ri-file-copy-line" :size="12" />
          <span>复制</span>
        </button>

        <button
          v-if="showRetry"
          type="button"
          class="meta-btn retry"
          title="用上一条提问重新生成"
          @click="onRetry"
        >
          <Icon icon="ri-refresh-line" :size="12" />
          <span>重试</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { marked } from 'marked';
import AiToolCard from './AiToolCard.vue';
import AiAskCard from './AiAskCard.vue';
import AiReasoningBlock from './AiReasoningBlock.vue';
import AiWaitIndicator from './AiWaitIndicator.vue';
import type { AiBlock, AiTurn, AiVariant } from '../../composables/useAiStream';

/**
 * 一轮 AI 回复的展示组件：按 blocks 顺序渲染 text / reasoning / tool / ask，
 * 并处理流式光标、等待动画、错误条、完成角标（模型 / 推理等级 / Tokens / 用时）、
 * 重试按钮、复制按钮与「重试前/当前」版本切换器。
 * 对 turn 未就绪 / blocks 非数组做了防御，渲染层不会因数据未就绪抛错。
 */
const props = withDefaults(
  defineProps<{
    turn: AiTurn;
    /** 是否正在实时流式渲染（false=历史消息，不显示光标/等待动画/计时） */
    live?: boolean;
    /** 是否显示「重试」按钮（父组件保证：最后一条 AI 回复且不在流式中） */
    canRetry?: boolean;
  }>(),
  { live: true, canRetry: false }
);

const emit = defineEmits<{
  (e: 'answer-ask', id: string, answers: string[]): void;
  (e: 'retry'): void;
  (e: 'copy', text: string): void;
}>();

marked.use({ breaks: true, gfm: true });

const EMPTY_TURN: AiTurn = {
  id: '',
  role: 'assistant',
  blocks: [],
  status: 'done',
  startedAt: 0,
};

/** turn 为 undefined/null 时的安全兜底 */
const safeTurn = computed<AiTurn>(() => props.turn || EMPTY_TURN);

const isLive = computed(() => props.live !== false);

// ─────────────────────────── 版本（重试前/当前） ───────────────────────────

const variantIndex = ref(0);

const alternatives = computed<AiVariant[]>(() =>
  Array.isArray(safeTurn.value.alternatives) ? safeTurn.value.alternatives : []
);

/** 1 = 只有当前版本；n = 当前 + (n-1) 个重试前版本 */
const variantTotal = computed(() => alternatives.value.length + 1);

/** 索引 0 = 当前版本（turn 本身），i>=1 = alternatives[i-1] */
const activeVariant = computed<AiVariant | null>(() => {
  if (variantIndex.value <= 0) return null;
  return alternatives.value[variantIndex.value - 1] || null;
});

const variantTag = computed(() => (variantIndex.value === 0 ? '当前版本' : '重试前的版本'));

const variantTitle = computed(() => {
  const v = activeVariant.value;
  if (!v) return '当前版本（最新回答）';
  return v.created_at ? `重试前的版本 · ${v.created_at}` : '重试前的版本';
});

// turn 变化（重试/切换会话/刷新历史）时回到当前版本
watch(
  () => [safeTurn.value.id, alternatives.value.length] as const,
  () => {
    variantIndex.value = 0;
  }
);

/** 当前渲染的块：切换版本时整体替换 */
const blocks = computed<AiBlock[]>(() => {
  const v = activeVariant.value;
  if (v) {
    const list = Array.isArray(v.blocks) ? v.blocks : [];
    if (list.length) return list;
    if (v.content) return [{ type: 'text', text: v.content }];
    return [];
  }
  return Array.isArray(safeTurn.value.blocks) ? safeTurn.value.blocks : [];
});

/** 当前渲染版本的状态（历史版本一律视为已完成） */
const displayStatus = computed<'streaming' | 'waiting' | 'done' | 'error'>(() =>
  activeVariant.value ? 'done' : safeTurn.value.status
);

const errorText = computed(() =>
  activeVariant.value ? '' : safeTurn.value.error || '请求失败，请重试'
);

const streaming = computed(() => displayStatus.value === 'streaming');
const waiting = computed(() => displayStatus.value === 'waiting');

const hasText = computed(() =>
  blocks.value.some((b) => b.type === 'text' && b.text.trim().length > 0)
);

/** 最后一个非空 text 块的索引（光标只加在它后面） */
const lastTextIndex = computed(() => {
  const list = blocks.value;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    if (b.type === 'text' && b.text.trim()) return i;
  }
  return -1;
});

function showCursorAt(i: number): boolean {
  if (activeVariant.value) return false;
  return streaming.value && isLive.value && i === lastTextIndex.value && i === blocks.value.length - 1;
}

function lastBlock<T extends AiBlock['type']>(type: T): Extract<AiBlock, { type: T }> | null {
  const list = blocks.value;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === type) return list[i] as Extract<AiBlock, { type: T }>;
  }
  return null;
}

/** 等待文案；空字符串表示不显示 */
const waitLabel = computed(() => {
  if (!isLive.value || activeVariant.value) return '';
  const list = blocks.value;
  const last = list[list.length - 1];

  if (waiting.value) {
    const ask = lastBlock('ask');
    if (ask && ask.status === 'pending') return '等待你的回答';
    const tool = lastBlock('tool');
    if (tool && tool.status === 'awaiting') return '等待工具执行';
    return '正在思考';
  }

  if (!streaming.value) return '';
  if (!last) return '正在思考';
  if (last.type === 'text') return last.text.trim() ? '' : '正在思考';
  if (last.type === 'tool') {
    if (last.status === 'running' || last.status === 'awaiting') return '';
    return hasText.value ? '正在生成' : '正在思考';
  }
  if (last.type === 'reasoning') return last.done ? '正在思考' : '';
  if (last.type === 'ask') {
    return last.status === 'pending' ? '等待你的回答' : hasText.value ? '正在生成' : '正在思考';
  }
  return hasText.value ? '正在生成' : '正在思考';
});

// ─────────────────────────── meta（模型 / 推理 / Tokens / 用时） ───────────────────────────

const modelLabel = computed(() => {
  const v = activeVariant.value;
  if (v) return v.model || safeTurn.value.model || '';
  return safeTurn.value.model || '';
});

const reasoningValue = computed(() => {
  const v = activeVariant.value;
  if (v) return v.reasoning_level || safeTurn.value.reasoning || '';
  return safeTurn.value.reasoning || '';
});

const reasoningLabel = computed(() => {
  const r = reasoningValue.value;
  if (!r) return '';
  const map: Record<string, string> = {
    auto: '自动',
    off: '关闭',
    low: '低',
    medium: '中',
    high: '高',
    max: '最高',
  };
  return map[r] || r;
});

interface UsagePair {
  prompt: number | null;
  completion: number | null;
}

const activeUsage = computed<UsagePair | null>(() => {
  const v = activeVariant.value;
  const u = v ? v.usage : safeTurn.value.usage;
  if (!u) return null;
  const prompt = typeof u.prompt_tokens === 'number' && Number.isFinite(u.prompt_tokens)
    ? u.prompt_tokens
    : null;
  const completion = typeof u.completion_tokens === 'number' && Number.isFinite(u.completion_tokens)
    ? u.completion_tokens
    : null;
  if (prompt == null && completion == null) return null;
  return { prompt, completion };
});

/** 1200 → 1.2k，999 → 999 */
function formatTokens(n: number): string {
  const value = Math.max(0, Math.round(n));
  if (value < 1000) return String(value);
  const k = value / 1000;
  if (k >= 100) return `${Math.round(k)}k`;
  const rounded = Math.round(k * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
}

const usageLabel = computed(() => {
  const u = activeUsage.value;
  if (!u) return '';
  const parts: string[] = [];
  if (u.prompt != null) parts.push(`↑ ${formatTokens(u.prompt)}`);
  if (u.completion != null) parts.push(`↓ ${formatTokens(u.completion)}`);
  return `${parts.join(' ')} tokens`;
});

const usageTitle = computed(() => {
  const u = activeUsage.value;
  if (!u) return '';
  const parts: string[] = [];
  if (u.prompt != null) parts.push(`输入 ${u.prompt} tokens`);
  if (u.completion != null) parts.push(`输出 ${u.completion} tokens`);
  return parts.join(' / ');
});

const elapsedLabel = computed(() => {
  if (activeVariant.value) return '';
  const { startedAt, finishedAt } = safeTurn.value;
  if (!startedAt || !finishedAt) return '';
  const ms = finishedAt - startedAt;
  if (ms < 0) return '';
  const sec = ms / 1000;
  if (sec < 1) return '<1s';
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const min = Math.floor(sec / 60);
  const rest = Math.round(sec % 60);
  return `${min}m${rest ? ` ${rest}s` : ''}`;
});

/** 当前显示版本的全部正文（复制用） */
const copyText = computed(() =>
  blocks.value.reduce((acc, b) => {
    if (b.type !== 'text') return acc;
    const text = String(b.text ?? '');
    if (!text.trim()) return acc;
    return acc ? `${acc}\n\n${text}` : text;
  }, '')
);

const showRetry = computed(() => !!props.canRetry && !isLive.value);

const showActions = computed(() => variantTotal.value > 1 || !!copyText.value || showRetry.value);

const showMeta = computed(() => {
  const s = displayStatus.value;
  if (s !== 'done' && s !== 'error') return false;
  return !!(
    modelLabel.value ||
    reasoningLabel.value ||
    usageLabel.value ||
    elapsedLabel.value ||
    showActions.value
  );
});

function blockKey(block: AiBlock, i: number): string {
  if (block.type === 'tool' || block.type === 'ask') return `${block.type}-${block.id}`;
  return `${block.type}-${i}`;
}

function onAskSubmit(id: string, answers: string[]) {
  emit('answer-ask', id, answers);
}

function onRetry() {
  if (!showRetry.value) return;
  emit('retry');
}

function onCopy() {
  if (!copyText.value) return;
  emit('copy', copyText.value);
}

// ===== Markdown 渲染 + XSS 基础防护 =====
const CURSOR_HTML = '<span class="stream-cursor" aria-hidden="true"></span>';

function renderText(text: string, withCursor: boolean): string {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!raw) return withCursor ? CURSOR_HTML : '';
  let html: string;
  try {
    html = marked.parse(raw, { breaks: true, gfm: true }) as string;
  } catch {
    html = escapeHtml(raw);
  }
  const safe = sanitizeHtml(html);
  return withCursor ? safe + CURSOR_HTML : safe;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 极简 sanitize：移除脚本/样式/iframe、内联事件、javascript: 链接 */
function sanitizeHtml(html: string): string {
  if (!html) return '';
  let out = String(html);
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<\/?(object|embed|link|meta|base|form|input|button|textarea|select|svg|math)\b[^>]*>/gi, '');
  // 内联事件属性 on*（双引号/单引号/无引号三种写法）
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // javascript: 协议
  out = out.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  out = out.replace(/(href|src)\s*=\s*javascript:[^\s>]*/gi, '$1="#"');
  // 外链统一新窗口打开
  out = out.replace(/<a\b([^>]*)>/gi, (_m, attrs: string) => {
    if (!/\bhref\s*=/i.test(attrs)) return `<a${attrs}>`;
    if (/\btarget\s*=/i.test(attrs)) return `<a${attrs}>`;
    return `<a${attrs} target="_blank" rel="noopener noreferrer">`;
  });
  return out;
}
</script>

<style scoped>
.ai-turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--font-size-xs);
  /* 正文可鼠标选中复制（不要阻止选择） */
  user-select: text;
  -webkit-user-select: text;
}

.turn-block {
  min-width: 0;
}

.turn-text {
  min-width: 0;
}

.turn-wait {
  margin-top: 2px;
}

.turn-error {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  padding: 6px 8px;
  background: var(--subtle-secondary);
  border: 1px solid var(--status-error);
  border-left-width: 2px;
  border-radius: var(--radius-sm);
  color: var(--status-error);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.turn-error > :first-child {
  flex-shrink: 0;
  margin-top: 1px;
}

.turn-error-text {
  min-width: 0;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ===== 底部 meta 行 ===== */
.turn-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  column-gap: 8px;
  row-gap: 4px;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  line-height: 1.4;
}

.meta-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.meta-chip {
  padding: 1px 5px;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.meta-item {
  white-space: nowrap;
}

.meta-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-left: auto;
}

.variant-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 2px;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  background: var(--subtle-secondary);
}

.variant-badge {
  padding: 0 3px;
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-size: 10px;
  white-space: nowrap;
}

.variant-badge.current {
  color: var(--accent-base);
  background: var(--accent-bg);
}

.variant-count {
  color: var(--text-tertiary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.meta-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 6px;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-family: inherit;
  font-size: 10.5px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration), border-color var(--fast-duration);
}

.meta-btn:hover:not(:disabled) {
  background: var(--subtle-secondary);
  border-color: var(--ctrl-border-accent);
  color: var(--text-secondary);
}

.meta-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.meta-btn.icon {
  width: 18px;
  height: 18px;
  padding: 0;
  justify-content: center;
  border-color: transparent;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
}

.meta-btn.icon:hover:not(:disabled) {
  background: var(--subtle-pressed);
}

.meta-btn.retry {
  color: var(--accent-base);
}

.meta-btn.retry:hover:not(:disabled) {
  background: var(--accent-bg);
  border-color: var(--accent-base);
  color: var(--accent-base);
}

/* ===== Markdown ===== */
.md-body {
  min-width: 0;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}

.md-body :deep(p) {
  margin: 0 0 0.5em;
}

.md-body :deep(p:last-child) {
  margin-bottom: 0;
}

.md-body :deep(code) {
  padding: 1px 4px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.md-body :deep(pre) {
  margin: 0.4em 0;
  padding: 8px 10px;
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  line-height: 1.5;
}

.md-body :deep(pre code) {
  padding: 0;
  background: transparent;
}

.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.3em 0;
  padding-left: 1.3em;
}

.md-body :deep(li) {
  margin: 0.1em 0;
}

.md-body :deep(blockquote) {
  margin: 0.4em 0;
  padding: 0.1em 0.6em;
  border-left: 2px solid var(--accent-base);
  color: var(--text-secondary);
}

.md-body :deep(table) {
  margin: 0.4em 0;
  border-collapse: collapse;
  font-size: 0.95em;
}

.md-body :deep(th),
.md-body :deep(td) {
  padding: 3px 6px;
  border: 1px solid var(--divider-stroke);
}

.md-body :deep(th) {
  background: var(--subtle-secondary);
  font-weight: 600;
}

.md-body :deep(a) {
  color: var(--accent-base);
  text-decoration: underline;
}

.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4) {
  margin: 0.6em 0 0.2em;
  font-weight: 600;
  line-height: 1.35;
}

.md-body :deep(h1) { font-size: 1.15em; }
.md-body :deep(h2) { font-size: 1.08em; }
.md-body :deep(h3) { font-size: 1em; }
.md-body :deep(h1:first-child),
.md-body :deep(h2:first-child),
.md-body :deep(h3:first-child) {
  margin-top: 0;
}

.md-body :deep(strong) {
  font-weight: 600;
}

.md-body :deep(hr) {
  margin: 0.6em 0;
  border: none;
  border-top: 1px solid var(--divider-stroke);
}

.md-body :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.md-body :deep(del) {
  color: var(--text-tertiary);
}

/* 流式光标 */
.md-body :deep(.stream-cursor) {
  display: inline-block;
  width: 6px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.15em;
  background: var(--accent-base);
  border-radius: 1px;
  animation: ai-turn-blink 1.05s steps(2, start) infinite;
}

@keyframes ai-turn-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .md-body :deep(.stream-cursor) {
    animation: none;
  }
}
</style>
