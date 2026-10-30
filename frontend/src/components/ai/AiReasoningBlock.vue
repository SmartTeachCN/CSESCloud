<template>
  <div class="ai-reasoning" :class="{ 'is-streaming': !done }">
    <button
      type="button"
      class="reasoning-header"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon
        :icon="done ? 'ri-lightbulb-line' : 'ri-loader-4-line'"
        :size="12"
        class="reasoning-icon"
        :class="{ spin: !done }"
      />
      <span class="reasoning-title" :class="{ pulse: !done }">{{ title }}</span>
      <Icon
        :icon="open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"
        :size="13"
        class="reasoning-arrow"
      />
    </button>
    <transition name="reasoning-expand">
      <div v-if="open" class="reasoning-body">
        <div class="reasoning-text">{{ text }}</div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 思考过程折叠块。默认折叠；streaming 时标题显示「正在思考…」并带脉动动画。
 */
const props = withDefaults(
  defineProps<{
    text: string;
    /** 思考是否结束（来自 AiReasoningBlock.done） */
    done?: boolean;
    /** 服务端/前端统计的思考秒数（来自 AiReasoningBlock.seconds） */
    seconds?: number;
    /** 是否默认展开（默认折叠） */
    defaultOpen?: boolean;
  }>(),
  { done: false, defaultOpen: false }
);

const open = ref(props.defaultOpen);

const title = computed(() => {
  if (!props.done) return '正在思考…';
  if (typeof props.seconds === 'number' && props.seconds > 0) {
    return `已思考 ${Math.round(props.seconds)}s`;
  }
  return '已思考';
});
</script>

<style scoped>
.ai-reasoning {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.reasoning-header {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 5px;
  max-width: 100%;
  padding: 2px 4px;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-size: 11.5px;
  font-family: inherit;
  line-height: 1.4;
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.reasoning-header:hover {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.reasoning-icon {
  flex-shrink: 0;
}

.reasoning-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reasoning-title.pulse {
  animation: ai-reasoning-pulse 1.5s ease-in-out infinite;
}

.reasoning-arrow {
  flex-shrink: 0;
  opacity: 0.7;
}

.reasoning-body {
  margin-top: 2px;
  padding: 2px 0 2px var(--spacer-2);
  border-left: 1px solid var(--divider-stroke);
  overflow: hidden;
}

.reasoning-text {
  max-height: 240px;
  overflow-y: auto;
  color: var(--text-tertiary);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
}

.spin {
  animation: ai-reasoning-spin 0.9s linear infinite;
}

.reasoning-expand-enter-active,
.reasoning-expand-leave-active {
  transition: opacity var(--fast-duration) ease, transform var(--fast-duration) ease;
}

.reasoning-expand-enter-from,
.reasoning-expand-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@keyframes ai-reasoning-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@keyframes ai-reasoning-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .reasoning-title.pulse,
  .spin {
    animation: none;
  }
}
</style>
