<template>
  <div class="ai-ask" :class="{ answered: isAnswered }">
    <div class="ask-head">
      <Icon icon="ri-question-line" :size="13" class="ask-icon" />
      <span class="ask-title">{{ headTitle }}</span>
      <span v-if="isAnswered" class="ask-done">
        <Icon icon="ri-check-line" :size="12" />
        已作答
      </span>
    </div>

    <div
      v-for="(q, qi) in block.questions"
      :key="qi"
      class="ask-q"
    >
      <div v-if="q.header" class="q-header">{{ q.header }}</div>
      <div class="q-text">
        {{ q.question }}
        <span v-if="q.multiSelect" class="q-hint">可多选</span>
      </div>

      <div class="q-options">
        <button
          v-for="opt in (q.options || [])"
          :key="opt.label"
          type="button"
          class="opt-btn"
          :class="{ selected: isSelected(qi, opt.label) }"
          :disabled="isAnswered"
          @click="pick(qi, opt.label, q)"
        >
          <span class="opt-check">
            <Icon v-if="isSelected(qi, opt.label)" icon="ri-check-line" :size="12" />
          </span>
          <span class="opt-body">
            <span class="opt-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="opt-desc">{{ opt.description }}</span>
          </span>
        </button>
      </div>

      <div v-if="!isAnswered" class="q-other">
        <button
          v-if="!otherOpen[qi]"
          type="button"
          class="opt-btn other-btn"
          @click="openOther(qi)"
        >
          <span class="opt-check"></span>
          <span class="opt-label">其他…</span>
        </button>
        <div v-else class="other-input-wrap">
          <input
            ref="otherInputs"
            v-model="otherText[qi]"
            class="other-input"
            type="text"
            placeholder="输入你的回答，回车提交"
            @keydown.enter.prevent="submitOther(qi, q)"
            @keydown.esc.prevent="closeOther(qi)"
          />
          <button
            type="button"
            class="other-submit"
            :disabled="!otherText[qi]?.trim()"
            @click="submitOther(qi, q)"
          >
            提交
          </button>
        </div>
      </div>

      <div v-if="isAnswered && answeredText(qi)" class="q-answered">
        <span v-for="ans in answeredChunks(qi)" :key="ans" class="answered-chip">{{ ans }}</span>
      </div>
    </div>

    <div v-if="!isAnswered && needsSubmit" class="ask-actions">
      <button type="button" class="submit-btn" :disabled="!allAnswered" @click="submitAll">
        提交
      </button>
      <span v-if="!allAnswered" class="ask-hint">请先完成全部选择</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { AiAskBlock, AiQuestion } from '../../composables/useAiStream';

/**
 * DSH 式提问卡：问题 + 选项按钮（可带副标题），支持多选、单选即时提交、「其他…」自由输入。
 * answered 状态回显用户选择并禁用交互。
 */
const props = defineProps<{
  block: AiAskBlock;
}>();

const emit = defineEmits<{
  (e: 'submit', id: string, answers: string[]): void;
}>();

const isAnswered = computed(() => props.block.status === 'answered');

/** qi -> 选中的答案文本数组（多选可多个） */
const selected = ref<Record<number, string[]>>({});
const otherOpen = ref<Record<number, boolean>>({});
const otherText = ref<Record<number, string>>({});
const otherInputs = ref<HTMLInputElement[]>([]);

const headTitle = computed(() => {
  if (isAnswered.value) return 'AI 的提问';
  return props.block.questions.length > 1
    ? `AI 有 ${props.block.questions.length} 个问题`
    : 'AI 需要你确认';
});

const needsSubmit = computed(() => {
  if (isAnswered.value) return false;
  const qs = props.block.questions;
  return !(qs.length === 1 && !qs[0].multiSelect);
});

const allAnswered = computed(() =>
  props.block.questions.every((_, qi) => (selected.value[qi] || []).length > 0)
);

function splitAnswers(answer?: string): string[] {
  if (!answer) return [];
  return answer
    .split(/\s*[,，;；、]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

watch(
  () => [props.block.status, props.block.answers] as const,
  () => {
    if (props.block.status !== 'answered') return;
    const answers = props.block.answers || [];
    const next: Record<number, string[]> = {};
    props.block.questions.forEach((q, qi) => {
      const ans = answers[qi];
      // 多选答案用分隔符拼接，回显时拆成多个 chip；单选/自由输入保持整段文本
      next[qi] = q.multiSelect ? splitAnswers(ans) : ans ? [ans] : [];
    });
    selected.value = next;
  },
  { immediate: true, deep: true }
);

function isSelected(qi: number, label: string): boolean {
  return (selected.value[qi] || []).includes(label);
}

function pick(qi: number, label: string, q: AiQuestion) {
  if (isAnswered.value) return;
  const cur = selected.value[qi] || [];
  if (q.multiSelect) {
    selected.value = {
      ...selected.value,
      [qi]: cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label],
    };
    return;
  }
  selected.value = { ...selected.value, [qi]: [label] };
  // 只有一个单选问题时，点选项立即提交
  if (props.block.questions.length === 1) submitAll();
}

function answeredChunks(qi: number): string[] {
  const chunks = selected.value[qi] || [];
  return chunks.length ? chunks : [];
}

function answeredText(qi: number): string {
  return answeredChunks(qi).join('、');
}

function openOther(qi: number) {
  otherOpen.value = { ...otherOpen.value, [qi]: true };
  nextTick(() => {
    const inputs = otherInputs.value;
    if (inputs && inputs.length) inputs[Math.min(qi, inputs.length - 1)]?.focus();
  });
}

function closeOther(qi: number) {
  otherOpen.value = { ...otherOpen.value, [qi]: false };
}

function submitOther(qi: number, q: AiQuestion) {
  if (isAnswered.value) return;
  const text = (otherText.value[qi] || '').trim();
  if (!text) return;
  if (q.multiSelect) {
    const cur = selected.value[qi] || [];
    selected.value = { ...selected.value, [qi]: cur.includes(text) ? cur : [...cur, text] };
  } else {
    selected.value = { ...selected.value, [qi]: [text] };
  }
  otherOpen.value = { ...otherOpen.value, [qi]: false };
  if (props.block.questions.length === 1) submitAll();
}

function submitAll() {
  if (isAnswered.value) return;
  const answers = props.block.questions.map((_, qi) => (selected.value[qi] || []).join(', '));
  if (answers.every(a => !a)) return;
  emit('submit', props.block.id, answers);
}
</script>

<style scoped>
.ai-ask {
  min-width: 0;
  padding: 8px 10px;
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-left: 2px solid var(--accent-base);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
}

.ai-ask.answered {
  border-left-color: var(--status-success);
}

.ask-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.ask-icon {
  flex-shrink: 0;
  color: var(--accent-base);
}

.ask-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-primary);
  font-weight: 600;
}

.ask-done {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--status-success);
  font-size: 10.5px;
}

.ask-q {
  margin-top: 8px;
  min-width: 0;
}

.q-header {
  display: inline-block;
  margin-bottom: 2px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  letter-spacing: 0.03em;
}

.q-text {
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  word-break: break-word;
}

.q-hint {
  margin-left: 6px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 400;
}

.q-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.opt-btn {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  width: 100%;
  min-width: 0;
  padding: 5px 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background var(--fast-duration), border-color var(--fast-duration);
}

.opt-btn:hover:not(:disabled) {
  background: var(--subtle-pressed);
  border-color: var(--ctrl-border-accent);
}

.opt-btn.selected {
  background: var(--accent-bg);
  border-color: var(--accent-base);
}

.opt-btn:disabled {
  cursor: default;
  opacity: 0.72;
}

.opt-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-top: 1px;
  flex-shrink: 0;
  border: 1px solid var(--text-tertiary);
  border-radius: var(--radius-full);
  color: var(--accent-base);
  font-size: 10px;
}

.opt-btn.selected .opt-check {
  border-color: var(--accent-base);
  background: var(--accent-bg);
}

.opt-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.opt-label {
  color: var(--text-primary);
  word-break: break-word;
}

.opt-desc {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
}

.other-btn .opt-check {
  border-style: dashed;
  border-color: var(--text-tertiary);
  opacity: 0.7;
}

.q-other {
  margin-top: 4px;
}

.other-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.other-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  background: var(--ctrl-fill-input-active);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  outline: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-size-xs);
}

.other-input:focus {
  border-color: var(--accent-base);
}

.other-input::placeholder {
  color: var(--text-tertiary);
}

.other-submit {
  height: 28px;
  padding: 0 10px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  flex-shrink: 0;
}

.other-submit:disabled {
  opacity: 0.4;
  cursor: default;
}

.q-answered {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.answered-chip {
  padding: 1px 6px;
  background: var(--accent-bg);
  border-radius: var(--radius-xs);
  color: var(--accent-base);
  font-size: 11px;
  line-height: 1.5;
}

.ask-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.submit-btn {
  padding: 4px 12px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  font-family: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.submit-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.submit-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ask-hint {
  color: var(--text-tertiary);
  font-size: 10.5px;
}
</style>
