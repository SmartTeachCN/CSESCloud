<template>
  <div class="ai-wait" role="status" aria-live="polite">
    <span class="ai-wait-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="ai-wait-label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 等待动画：三点跳动 + 文案。
 * 文案取值约定：「正在思考」「正在生成」「等待工具执行」「等待你的回答」。
 */
withDefaults(
  defineProps<{
    label?: string;
  }>(),
  { label: '正在思考' }
);
</script>

<style scoped>
.ai-wait {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-1) 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.4;
  animation: ai-wait-fade-in var(--normal-duration) var(--fast-out-slow-in) both;
}

.ai-wait-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.ai-wait-dots i {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-full);
  background: currentColor;
  animation: ai-wait-bounce 1.2s infinite ease-in-out both;
}

.ai-wait-dots i:nth-child(1) { animation-delay: -0.24s; }
.ai-wait-dots i:nth-child(2) { animation-delay: -0.12s; }
.ai-wait-dots i:nth-child(3) { animation-delay: 0s; }

.ai-wait-label {
  animation: ai-wait-label-in var(--normal-duration) var(--fast-out-slow-in) both;
}

@keyframes ai-wait-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ai-wait-label-in {
  from { opacity: 0; transform: translateY(1px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes ai-wait-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ai-wait,
  .ai-wait-dots i,
  .ai-wait-label {
    animation: none;
  }
}
</style>
