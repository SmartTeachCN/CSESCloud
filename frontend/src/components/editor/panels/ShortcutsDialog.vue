<template>
  <Teleport to="body">
    <div v-if="visible" class="scd-overlay" @click.self="emit('close')">
      <div class="scd-card">
        <div class="scd-header">
          <h3>键盘快捷键</h3>
          <button class="scd-close" @click="emit('close')" title="关闭">
            <Icon icon="ri-close-line" :size="18" />
          </button>
        </div>
        <div class="scd-body">
          <div class="scd-group-title">编辑</div>
          <div v-for="row in editShortcuts" :key="row.label" class="scd-row">
            <span class="scd-label">{{ row.label }}</span>
            <span class="scd-keys"><kbd v-for="k in row.keys" :key="k">{{ k }}</kbd></span>
          </div>

          <div class="scd-group-title">文件</div>
          <div v-for="row in fileShortcuts" :key="row.label" class="scd-row">
            <span class="scd-label">{{ row.label }}</span>
            <span class="scd-keys"><kbd v-for="k in row.keys" :key="k">{{ k }}</kbd></span>
          </div>
        </div>
        <div class="scd-footer">
          <button class="scd-btn primary" @click="emit('close')">知道了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const editShortcuts = [
  { label: '撤销', keys: ['Ctrl', 'Z'] },
  { label: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
  { label: '查找', keys: ['Ctrl', 'F'] },
  { label: '替换', keys: ['Ctrl', 'H'] },
  { label: '全选', keys: ['Ctrl', 'A'] },
  { label: '复制', keys: ['Ctrl', 'C'] },
  { label: '粘贴', keys: ['Ctrl', 'V'] },
];
const fileShortcuts = [
  { label: '保存', keys: ['Ctrl', 'S'] },
];
</script>

<style scoped>
.scd-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  padding: var(--spacer-4);
}
.scd-card {
  width: 420px; max-width: 100%;
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
  overflow: hidden; display: flex; flex-direction: column;
}
.scd-header { display: flex; align-items: center; justify-content: space-between; padding: var(--spacer-3) var(--spacer-4); border-bottom: 1px solid var(--divider-stroke); }
.scd-header h3 { margin: 0; font-size: var(--font-size-base); color: var(--text-primary); }
.scd-close { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: var(--radius-sm); color: var(--text-tertiary); cursor: pointer; }
.scd-close:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.scd-body { flex: 1; overflow-y: auto; padding: var(--spacer-3) var(--spacer-4); }
.scd-group-title { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin: var(--spacer-3) 0 var(--spacer-1); }
.scd-group-title:first-child { margin-top: 0; }
.scd-row { display: flex; align-items: center; justify-content: space-between; padding: var(--spacer-1) 0; }
.scd-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.scd-keys { display: flex; gap: 4px; }
.scd-keys kbd {
  min-width: 24px; padding: 2px 6px; text-align: center;
  background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border-rest);
  border-bottom-width: 2px; border-radius: var(--radius-xs);
  font-size: 11px; font-family: var(--font-mono, Consolas, monospace); color: var(--text-primary);
}
.scd-footer { display: flex; justify-content: flex-end; padding: var(--spacer-3) var(--spacer-4); border-top: 1px solid var(--divider-stroke); }
.scd-btn { padding: var(--spacer-2) var(--spacer-4); border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; }
.scd-btn.primary { background: var(--accent-base); color: white; border: none; }
.scd-btn.primary:hover { background: var(--accent-hover); }
</style>