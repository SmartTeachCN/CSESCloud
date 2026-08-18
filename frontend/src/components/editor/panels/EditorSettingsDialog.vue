<template>
  <Teleport to="body">
    <div v-if="visible" class="esd-overlay" @click.self="emit('close')">
      <div class="esd-card">
        <div class="esd-header">
          <h3>编辑器设置</h3>
          <button class="esd-close" @click="emit('close')" title="关闭">
            <Icon icon="ri-close-line" :size="18" />
          </button>
        </div>

        <div class="esd-body">
          <!-- 编辑主题 -->
          <div class="esd-section">
            <div class="esd-label">编辑器主题</div>
            <div class="esd-radio-row">
              <button
                v-for="opt in themeOptions"
                :key="opt.value"
                class="esd-radio"
                :class="{ active: settings.state.theme === opt.value }"
                @click="settings.set('theme', opt.value)"
              >
                <Icon :icon="opt.icon" :size="14" />
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- 字号 -->
          <div class="esd-section">
            <div class="esd-label-row">
              <span class="esd-label">字号</span>
              <div class="esd-fontsize">
                <button class="esd-step" @click="changeFont(-1)" title="减小字号">
                  <Icon icon="ri-subtract-line" :size="14" /> A
                </button>
                <span class="esd-fontsize-val">{{ settings.state.fontSize }}</span>
                <button class="esd-step" @click="changeFont(1)" title="增大字号">
                  <Icon icon="ri-add-line" :size="14" /> A
                </button>
              </div>
            </div>
          </div>

          <!-- 开关项 -->
          <div class="esd-section">
            <label v-for="item in toggles" :key="item.key" class="esd-toggle">
              <span class="esd-toggle-text">
                {{ item.label }}
                <em v-if="item.default !== undefined" class="esd-hint">默认{{ item.default ? '开' : '关' }}</em>
              </span>
              <input
                type="checkbox"
                :checked="settings.state[item.key]"
                @change="settings.set(item.key, $event.target.checked)"
              />
              <span class="esd-switch"></span>
            </label>
          </div>
        </div>

        <div class="esd-footer">
          <button class="esd-btn ghost" @click="settings.reset()">恢复默认</button>
          <button class="esd-btn primary" @click="emit('close')">完成</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useEditorSettings, type EditorSettings } from '../../../composables/useEditorSettings';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const settings = useEditorSettings();

const themeOptions = [
  { value: 'system', label: '跟随系统', icon: 'ri-computer-line' },
  { value: 'light', label: '浅色', icon: 'ri-sun-line' },
  { value: 'dark', label: '深色', icon: 'ri-moon-line' },
] as const;

const toggles: Array<{ key: keyof EditorSettings; label: string; default?: boolean }> = [
  { key: 'wordWrap', label: '自动换行', default: true },
  { key: 'suggest', label: '代码自动完成', default: true },
  { key: 'snippets', label: '启动代码段', default: true },
  { key: 'renderWhitespace', label: '显示隐藏字符', default: true },
  { key: 'lineNumbers', label: '显示行号', default: true },
];

function changeFont(delta: number) {
  const next = settings.state.fontSize + delta;
  settings.set('fontSize', Math.min(40, Math.max(8, next)));
}
</script>

<style scoped>
.esd-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
  padding: var(--spacer-4);
}
.esd-card {
  width: 420px; max-width: 100%;
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
  overflow: hidden;
  display: flex; flex-direction: column;
}
.esd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}
.esd-header h3 { margin: 0; font-size: var(--font-size-base); color: var(--text-primary); }
.esd-close {
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--text-tertiary); cursor: pointer;
}
.esd-close:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.esd-body { padding: var(--spacer-3) var(--spacer-4); overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: var(--spacer-4); }
.esd-section { display: flex; flex-direction: column; gap: var(--spacer-2); }
.esd-label-row { display: flex; align-items: center; justify-content: space-between; }
.esd-label { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-secondary); }

.esd-radio-row { display: flex; gap: var(--spacer-1); }
.esd-radio {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: var(--spacer-2); background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest); border-radius: var(--radius-sm);
  font-size: var(--font-size-xs); color: var(--text-secondary); cursor: pointer;
}
.esd-radio:hover { background: var(--subtle-secondary); }
.esd-radio.active { background: var(--accent-bg); border-color: var(--accent-base); color: var(--accent-base); font-weight: 500; }

.esd-fontsize { display: flex; align-items: center; gap: var(--spacer-1); }
.esd-step {
  display: inline-flex; align-items: center; gap: 2px; padding: 4px 10px;
  background: var(--ctrl-fill-default); border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--text-secondary); cursor: pointer;
}
.esd-step:hover { background: var(--subtle-secondary); color: var(--text-primary); }
.esd-fontsize-val { min-width: 28px; text-align: center; font-size: var(--font-size-sm); color: var(--text-primary); font-family: var(--font-mono, monospace); }

.esd-section:nth-child(3) { gap: var(--spacer-1); }
.esd-toggle {
  display: flex; align-items: center; justify-content: space-between; gap: var(--spacer-2);
  padding: var(--spacer-2) 0; cursor: pointer;
}
.esd-toggle-text { font-size: var(--font-size-sm); color: var(--text-primary); }
.esd-hint { font-style: normal; font-size: 10px; color: var(--text-tertiary); margin-left: 4px; }
.esd-toggle input { display: none; }
.esd-switch { width: 40px; height: 22px; background: var(--ctrl-fill-disabled); border-radius: var(--radius-full); position: relative; transition: background var(--fast-duration); flex-shrink: 0; }
.esd-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: white; border-radius: 50%; transition: transform var(--fast-duration); }
.esd-toggle input:checked + .esd-switch { background: var(--accent-base); }
.esd-toggle input:checked + .esd-switch::after { transform: translateX(18px); }

.esd-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-top: 1px solid var(--divider-stroke); flex-shrink: 0;
}
.esd-btn { padding: var(--spacer-2) var(--spacer-4); border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; }
.esd-btn.ghost { background: transparent; border: 1px solid var(--ctrl-border-rest); color: var(--text-secondary); }
.esd-btn.ghost:hover { background: var(--subtle-secondary); }
.esd-btn.primary { background: var(--accent-base); color: white; border: none; }
.esd-btn.primary:hover { background: var(--accent-hover); }
</style>