<template>
  <div class="find-replace-panel">
    <div class="panel-header">
      <Icon icon="ri-search-line" :size="14" />
      <span>查找替换</span>
    </div>
    <div class="panel-body">
      <div class="form-row">
        <div class="input-wrap">
          <input
            v-model="findText"
            type="text"
            placeholder="查找内容"
            @input="onFindChange"
            @keydown.enter.prevent="findNext"
          />
          <button class="icon-action" title="上一个" @click="findPrev">
            <Icon icon="ri-arrow-up-line" :size="12" />
          </button>
          <button class="icon-action" title="下一个" @click="findNext">
            <Icon icon="ri-arrow-down-line" :size="12" />
          </button>
        </div>
      </div>
      <div class="form-row">
        <div class="input-wrap">
          <input
            v-model="replaceText"
            type="text"
            placeholder="替换为"
          />
        </div>
      </div>
      <div class="form-options">
        <label class="option">
          <input type="checkbox" v-model="caseSensitive" />
          <span>区分大小写</span>
        </label>
        <label class="option">
          <input type="checkbox" v-model="wholeWord" />
          <span>全字匹配</span>
        </label>
        <label class="option">
          <input type="checkbox" v-model="regex" />
          <span>正则</span>
        </label>
      </div>
      <div class="result-info">
        <span v-if="findText">匹配 {{ matchCount }} 处{{ currentIndex >= 0 ? ` · 当前 ${currentIndex + 1}` : '' }}</span>
        <span v-else>输入查找内容</span>
      </div>
      <div class="action-row">
        <button class="btn-action" @click="replaceCurrent" :disabled="!findText">
          <Icon icon="ri-replace-line" :size="12" /> 替换
        </button>
        <button class="btn-action" @click="replaceAll" :disabled="!findText">
          <Icon icon="ri-replace-all-line" :size="12" /> 全部替换
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  /** 编辑器内容（用于查找） */
  content?: string;
}>();

const emit = defineEmits<{
  (e: 'replace', findText: string, replaceText: string, replaceAll: boolean): void;
  (e: 'find', findText: string): void;
}>();

const findText = ref('');
const replaceText = ref('');
const caseSensitive = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const currentIndex = ref(-1);

const matchCount = computed(() => {
  if (!findText.value || !props.content) return 0;
  try {
    const flags = caseSensitive.value ? 'g' : 'gi';
    let pattern: string;
    if (regex.value) {
      pattern = findText.value;
    } else if (wholeWord.value) {
      pattern = `\\b${escapeRegex(findText.value)}\\b`;
    } else {
      pattern = escapeRegex(findText.value);
    }
    const re = new RegExp(pattern, flags);
    const matches = props.content.match(re);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function onFindChange() {
  currentIndex.value = -1;
  if (findText.value) emit('find', findText.value);
}

function findNext() {
  if (matchCount.value === 0) return;
  currentIndex.value = (currentIndex.value + 1) % matchCount.value;
  emit('find', findText.value);
}

function findPrev() {
  if (matchCount.value === 0) return;
  currentIndex.value = currentIndex.value <= 0 ? matchCount.value - 1 : currentIndex.value - 1;
  emit('find', findText.value);
}

function replaceCurrent() {
  if (!findText.value) return;
  emit('replace', findText.value, replaceText.value, false);
}

function replaceAll() {
  if (!findText.value) return;
  emit('replace', findText.value, replaceText.value, true);
}
</script>

<style scoped>
.find-replace-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--layer-default);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.panel-body {
  padding: var(--spacer-3);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.form-row {
  display: flex;
}

.input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.input-wrap input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  padding: var(--spacer-1) var(--spacer-2);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
}

.icon-action {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
}

.icon-action:hover {
  background: var(--subtle-pressed);
  color: var(--accent-base);
}

.form-options {
  display: flex;
  gap: var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.option input {
  accent-color: var(--accent-base);
}

.result-info {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  padding: var(--spacer-1) 0;
}

.action-row {
  display: flex;
  gap: var(--spacer-2);
  margin-top: var(--spacer-1);
}

.btn-action {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  cursor: pointer;
}

.btn-action:hover {
  background: var(--subtle-pressed);
}

.btn-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
