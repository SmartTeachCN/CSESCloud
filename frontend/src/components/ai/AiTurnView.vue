<template>
  <div class="ai-turn" :class="[`turn-${safeTurn.status}`, { live: isLive }]">
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

    <div v-if="safeTurn.status === 'error'" class="turn-error">
      <Icon icon="ri-error-warning-line" :size="13" />
      <span class="turn-error-text">{{ safeTurn.error || '请求失败，请重试' }}</span>
    </div>

    <div v-if="showMeta" class="turn-meta">
      <span v-if="safeTurn.model" class="meta-chip">{{ safeTurn.model }}</span>
      <span v-if="reasoningLabel" class="meta-item">推理：{{ reasoningLabel }}</span>
      <span v-if="elapsedLabel" class="meta-item">用时 {{ elapsedLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import AiToolCard from './AiToolCard.vue';
import AiAskCard from './AiAskCard.vue';
import AiReasoningBlock from './AiReasoningBlock.vue';
import AiWaitIndicator from './AiWaitIndicator.vue';
import type { AiBlock, AiTurn } from '../../composables/useAiStream';

/**
 * 一轮 AI 回复的展示组件：按 blocks 顺序渲染 text / reasoning / tool / ask，
 * 并处理流式光标、等待动画、错误条与完成角标。
 * 对 turn 未就绪 / blocks 非数组做了防御，渲染层不会因数据未就绪抛错。
 */
const props = withDefaults(
  defineProps<{
    turn: AiTurn;
    /** 是否正在实时流式渲染（false=历史消息，不显示光标/等待动画/计时） */
    live?: boolean;
  }>(),
  { live: true }
);

const emit = defineEmits<{
  (e: 'answer-ask', id: string, answers: string[]): void;
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

/** blocks 非数组（脏数据）时兜底为空数组 */
const blocks = computed<AiBlock[]>(() =>
  Array.isArray(safeTurn.value.blocks) ? safeTurn.value.blocks : []
);

const isLive = computed(() => props.live !== false);
const streaming = computed(() => safeTurn.value.status === 'streaming');
const waiting = computed(() => safeTurn.value.status === 'waiting');
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
  if (!isLive.value) return '';
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

const showMeta = computed(() => {
  const s = safeTurn.value.status;
  if (s !== 'done' && s !== 'error') return false;
  return !!(safeTurn.value.model || reasoningLabel.value || elapsedLabel.value);
});

const reasoningLabel = computed(() => {
  const r = safeTurn.value.reasoning;
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

const elapsedLabel = computed(() => {
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

function blockKey(block: AiBlock, i: number): string {
  if (block.type === 'tool' || block.type === 'ask') return `${block.type}-${block.id}`;
  return `${block.type}-${i}`;
}

function onAskSubmit(id: string, answers: string[]) {
  emit('answer-ask', id, answers);
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

.turn-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  line-height: 1.4;
}

.meta-chip {
  padding: 1px 5px;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
}

/* ===== Markdown ===== */
.md-body {
  min-width: 0;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: anywhere;
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
