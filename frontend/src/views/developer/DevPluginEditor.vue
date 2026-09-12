<template>
  <div class="plugin-editor">
    <!-- 顶栏 -->
    <header class="pe-header">
      <div class="pe-left">
        <button class="back-btn" @click="goBack" title="返回">
          <Icon icon="ri-arrow-left-s-line" :size="18" />
        </button>
        <div class="plugin-icon" :class="{ asset: isAssetIcon(plugin?.icon) }"><AppIcon :icon="plugin?.icon" :plugin-key="plugin?.plugin_key" :size="22" fallback="ri-plug-line" /></div>
        <div class="plugin-meta">
          <div class="plugin-title-row">
            <span class="plugin-name">{{ plugin?.name || '加载中...' }}</span>
            <span class="status-pill" :class="plugin?.status">{{ getStatusLabel(plugin?.status) }}</span>
          </div>
          <div class="plugin-sub">
            <Icon icon="ri-hashtag" :size="10" />
            <code>{{ plugin?.plugin_key }}</code>
          </div>
        </div>
      </div>
      <div class="pe-right">
        <button v-if="plugin?.status === 'draft'" class="top-action" @click="publish" :disabled="busy">
          <Icon icon="ri-rocket-line" :size="14" /> 发布
        </button>
        <button v-else-if="plugin?.status === 'published'" class="top-action" @click="archive" :disabled="busy">
          <Icon icon="ri-archive-line" :size="14" /> 归档
        </button>
        <button class="top-action primary" @click="saveCurrent" :disabled="busy || !dirty">
          <Icon :icon="busy ? 'ri-loader-4-line' : 'ri-save-line'" :size="14" :class="{ spin: busy }" />
          保存
        </button>
      </div>
    </header>

    <div v-if="loading" class="pe-loading">
      <Icon icon="ri-loader-4-line" :size="24" class="spin" />
      <span>加载插件...</span>
    </div>

    <template v-else>
      <!-- 标签栏 -->
      <nav class="pe-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="pe-tab"
          :class="{ active: activeTab === tab.id, dirty: dirtyTabs[tab.id] }"
          @click="switchTab(tab.id)"
        >
          <Icon :icon="tab.icon" :size="14" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <!-- 内容区 -->
      <div class="pe-body">
        <!-- 基础信息 -->
        <section v-show="activeTab === 'basic'" class="tab-pane">
          <div class="form-grid">
            <div class="form-group">
              <label>插件名称</label>
              <input v-model="basicForm.name" @input="markDirty('basic')" placeholder="插件名称" />
            </div>
            <div class="form-group">
              <label>版本</label>
              <input v-model="basicForm.version" @input="markDirty('basic')" placeholder="1.0.0" />
            </div>
            <div class="form-group">
              <label>图标 (RemixIcon)</label>
              <input v-model="basicForm.icon" @input="markDirty('basic')" placeholder="ri-plug-line" />
            </div>
            <div class="form-group full">
              <label>注册文件后缀（逗号分隔）</label>
              <input v-model="extensionsStr" @input="onExtensionsChange" placeholder="cses, json" />
              <div class="ext-preview">
                <span v-for="ext in currentExtensions" :key="ext" class="ext-chip">.{{ ext }}</span>
                <span v-if="currentExtensions.length === 0" class="ext-chip empty">未注册后缀</span>
              </div>
            </div>
            <div class="form-group full">
              <label>描述</label>
              <textarea v-model="basicForm.description" @input="markDirty('basic')" rows="2" placeholder="简短描述插件用途"></textarea>
            </div>
          </div>
        </section>

        <!-- 编辑器 HTML -->
        <section v-show="activeTab === 'editor_html'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>编辑器 HTML：会注入到 iframe 中作为编辑器主体结构。可使用 <code v-pre>window.CSEditor</code> 与平台通信。</span>
          </div>
          <textarea
            v-model="editorHtml"
            @input="markDirty('editor_html')"
            class="code-area"
            spellcheck="false"
            placeholder="<div id='app'><h1>自定义编辑器</h1></div>"
          ></textarea>
        </section>

        <!-- 编辑器 JS -->
        <section v-show="activeTab === 'editor_js'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>编辑器 JS：在 iframe 内执行。平台注入 <code>window.CSEditor</code> 全局对象，包含 <code>file</code>（文件信息）、<code>saveContent()</code>、<code>emitSave()</code>、<code>notify()</code> 等 API。</span>
          </div>
          <textarea
            v-model="editorJs"
            @input="markDirty('editor_js')"
            class="code-area code-js"
            spellcheck="false"
            placeholder="// 使用 window.CSEditor.emitSave(content) 保存文件"
          ></textarea>
        </section>

        <!-- 编辑器 CSS -->
        <section v-show="activeTab === 'editor_css'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>编辑器 CSS：注入到 iframe 中的样式。</span>
          </div>
          <textarea
            v-model="editorCss"
            @input="markDirty('editor_css')"
            class="code-area code-js"
            spellcheck="false"
            placeholder="/* 自定义编辑器样式 */"
          ></textarea>
        </section>

        <!-- 编辑 Ribbon（插件自定义靠左工具栏） -->
        <section v-show="activeTab === 'ribbon'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>插件自定义的“靠左”Ribbon 分组（JSON 数组）。结构：<code>[{"label":"分组名","tools":[{"id":"x","label":"按钮","icon":"ri-icon","command":"cmd","type":"action|select"}]}]</code>。运行时也可通过 <code>window.CSEditor.setRibbon(groups)</code> 动态更新。</span>
          </div>
          <textarea
            v-model="editorRibbon"
            @input="markDirty('ribbon')"
            class="code-area code-js"
            spellcheck="false"
            placeholder='[\n  { "label": "操作", "tools": [ { "id": "cmd1", "label": "我的按钮", "icon": "ri-settings-3-line", "command": "cmd1" } ] }\n]'
          ></textarea>
        </section>

        <!-- 实时预览 -->
        <section v-show="activeTab === 'preview'" class="tab-pane">
          <div class="preview-toolbar">
            <button class="prev-btn" @click="refreshPreview">
              <Icon icon="ri-refresh-line" :size="14" /> 刷新预览
            </button>
            <span class="prev-hint">预览效果仅供展示</span>
          </div>
          <iframe
            ref="previewFrame"
            class="preview-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            :srcdoc="previewSrcDoc"
          ></iframe>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { pluginApi } from '../../api';

const route = useRoute();
const router = useRouter();
const pluginId = computed(() => Number(route.params.id || 0));

const loading = ref(false);
const busy = ref(false);
const plugin = ref<any>(null);

const activeTab = ref('basic');

const tabs = [
  { id: 'basic', icon: 'ri-settings-3-line', label: '基础信息' },
  { id: 'editor_html', icon: 'ri-html5-line', label: '编辑器 HTML' },
  { id: 'editor_js', icon: 'ri-code-s-slash-line', label: '编辑器 JS' },
  { id: 'editor_css', icon: 'ri-palette-line', label: '编辑器 CSS' },
  { id: 'ribbon', icon: 'ri-tools-line', label: '编辑 Ribbon' },
  { id: 'preview', icon: 'ri-eye-line', label: '实时预览' }
];

const basicForm = ref({ name: '', version: '', icon: 'ri-plug-line', description: '' });
const extensionsStr = ref('');
const editorHtml = ref('<div id="app"><h1>自定义编辑器</h1></div>');
const editorJs = ref('// 使用 window.CSEditor.emitSave(content) 保存文件\n');
const editorCss = ref('');
const editorRibbon = ref('[]');

const currentExtensions = computed(() => {
  return extensionsStr.value.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
});

const dirtyTabs = ref<Record<string, boolean>>({});
const dirty = computed(() => Object.values(dirtyTabs.value).some(v => v));

const previewFrame = ref<HTMLIFrameElement | null>(null);
const previewSrcDoc = computed(() => {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Preview</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1a1a1a;}
  body{overflow:auto;padding:12px;}
${editorCss.value}
</style></head>
<body>
${editorHtml.value || '<!-- 无 HTML -->'}
<script>
  window.CSEditor = {
    plugin: { key: 'preview', name: '预览' },
    file: { name: 'preview.cses', content: '{"name": "CSES Cloud"}' },
    request: (action, payload) => {
      console.log('[preview]', action, payload);
      return Promise.resolve({ ok: true });
    },
    saveContent: c => { console.log('[save]', c); return Promise.resolve({ ok: true }); },
    getContent: () => Promise.resolve({ content: '{"name": "CSES Cloud"}' }),
    notify: m => console.log('[notify]', m),
    emitSave: c => console.log('[emitSave]', c)
  };
  try {
${editorJs.value || '// 无自定义 JS'}
  } catch (e) {
    document.body.innerHTML = '<pre style="color:#c42b1c;padding:16px;">脚本错误: ' + e.message + '</pre>';
  }
<\/script>
</body></html>`;
});

function getStatusLabel(status?: string): string {
  const labels: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };
  return labels[status || ''] || status || '';
}

/** icon 值以 asset: 开头表示插件自带真实图标（由 AppIcon 渲染） */
function isAssetIcon(icon?: string): boolean {
  return !!icon && icon.startsWith('asset:');
}

function markDirty(tab: string) {
  dirtyTabs.value[tab] = true;
}

function onExtensionsChange() {
  markDirty('basic');
}

function switchTab(tab: string) {
  activeTab.value = tab;
  if (tab === 'preview') refreshPreview();
}

function refreshPreview() {
  if (previewFrame.value) {
    previewFrame.value.srcdoc = previewSrcDoc.value;
  }
}

async function loadPlugin() {
  loading.value = true;
  try {
    const res = await pluginApi.get(pluginId.value);
    plugin.value = res;
    basicForm.value = {
      name: res.name || '',
      version: res.version || '1.0.0',
      icon: res.icon || 'ri-plug-line',
      description: res.description || ''
    };
    extensionsStr.value = (res.extensions || []).join(', ');
    editorHtml.value = res.editor_html || '<div id="app"><h1>自定义编辑器</h1></div>';
    editorJs.value = res.editor_js || '// 使用 window.CSEditor.emitSave(content) 保存文件\n';
    editorCss.value = res.editor_css || '';
    editorRibbon.value = JSON.stringify(res.ribbon || [], null, 2);
    dirtyTabs.value = {};
  } catch (e: any) {
    alert(e.message || '加载失败');
    router.push('/console/developer/plugins');
  } finally {
    loading.value = false;
  }
}

async function saveCurrent() {
  if (!dirty.value || busy.value) return;
  busy.value = true;
  try {
    const updates: any = {};
    if (dirtyTabs.value.basic) {
      updates.name = basicForm.value.name;
      updates.version = basicForm.value.version;
      updates.icon = basicForm.value.icon;
      updates.description = basicForm.value.description;
      updates.extensions = currentExtensions.value;
    }
    if (dirtyTabs.value.editor_html) updates.editor_html = editorHtml.value;
    if (dirtyTabs.value.editor_js) updates.editor_js = editorJs.value;
    if (dirtyTabs.value.editor_css) updates.editor_css = editorCss.value;
    if (dirtyTabs.value.ribbon) updates.ribbon = JSON.parse(editorRibbon.value || '[]');
    await pluginApi.update(pluginId.value, updates);
    dirtyTabs.value = {};
    await loadPlugin();
    alert('已保存');
  } catch (e: any) {
    alert(e.message || '保存失败');
  } finally {
    busy.value = false;
  }
}

async function publish() {
  if (!confirm('确认发布此插件？发布后将在轻编辑器中生效。')) return;
  busy.value = true;
  try {
    await pluginApi.publish(pluginId.value);
    await loadPlugin();
    alert('已发布');
  } catch (e: any) {
    alert(e.message || '发布失败');
  } finally {
    busy.value = false;
  }
}

async function archive() {
  if (!confirm('确认归档此插件？')) return;
  busy.value = true;
  try {
    await pluginApi.archive(pluginId.value);
    await loadPlugin();
    alert('已归档');
  } catch (e: any) {
    alert(e.message || '归档失败');
  } finally {
    busy.value = false;
  }
}

function goBack() {
  if (dirty.value && !confirm('有未保存的更改，确认离开？')) return;
  router.push('/console/developer/plugins');
}

onMounted(() => {
  loadPlugin();
});
</script>

<style scoped>
.plugin-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
  overflow: hidden;
}

.pe-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3);
  gap: var(--spacer-3);
  flex-shrink: 0;
}

.pe-left { display: flex; align-items: center; gap: var(--spacer-2); flex: 1; min-width: 0; }
.back-btn { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; }
.back-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.plugin-icon { width: 36px; height: 36px; border-radius: var(--radius-md); background: rgba(120, 90, 240, 0.1); color: #785AF0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

/* 插件自带真实图标时不使用底色 */
.plugin-icon.asset { background: transparent; overflow: hidden; }
.plugin-meta { flex: 1; min-width: 0; }
.plugin-title-row { display: flex; align-items: center; gap: var(--spacer-2); }
.plugin-name { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
.plugin-sub { display: flex; align-items: center; gap: var(--spacer-1); font-size: var(--font-size-xs); color: var(--text-tertiary); margin-top: 2px; }
.plugin-sub code { font-family: var(--font-mono, monospace); font-size: 10px; }

.status-pill { display: inline-flex; padding: 1px 8px; border-radius: var(--radius-full); font-size: 10px; font-weight: 500; }
.status-pill.draft { background: rgba(202, 143, 4, 0.1); color: #CA8F04; }
.status-pill.published { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.status-pill.archived { background: rgba(0,0,0,0.08); color: var(--text-tertiary); }

.pe-right { display: flex; align-items: center; gap: var(--spacer-2); flex-shrink: 0; }
.top-action { display: inline-flex; align-items: center; gap: 4px; padding: var(--spacer-1) var(--spacer-3); background: var(--subtle-secondary); border: 1px solid var(--divider-stroke); border-radius: var(--radius-md); font-size: var(--font-size-xs); color: var(--text-primary); cursor: pointer; }
.top-action:hover { background: var(--subtle-pressed); }
.top-action:disabled { opacity: 0.5; cursor: not-allowed; }
.top-action.primary { background: var(--accent-base); color: white; border-color: var(--accent-base); }
.top-action.primary:hover { background: var(--accent-hover); }

.pe-loading { display: flex; align-items: center; justify-content: center; gap: var(--spacer-2); padding: var(--spacer-6); color: var(--text-tertiary); font-size: var(--font-size-sm); }

.pe-tabs { display: flex; gap: 2px; background: var(--subtle-secondary); border-bottom: 1px solid var(--divider-stroke); padding: 0 var(--spacer-3); flex-shrink: 0; overflow-x: auto; }
.pe-tab { display: inline-flex; align-items: center; gap: 4px; padding: var(--spacer-2) var(--spacer-3); background: transparent; border: none; border-bottom: 2px solid transparent; font-size: var(--font-size-xs); color: var(--text-tertiary); cursor: pointer; white-space: nowrap; position: relative; }
.pe-tab:hover { color: var(--text-primary); }
.pe-tab.active { color: var(--text-primary); border-bottom-color: var(--accent-base); font-weight: 500; background: var(--layer-default); }
.pe-tab.dirty::after { content: ''; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--status-warning, #CA8F04); position: absolute; top: 6px; right: 4px; }

.pe-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.tab-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: var(--spacer-4); }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacer-3); max-width: 800px; }
.form-group.full { grid-column: 1 / -1; }

.ext-preview { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--spacer-1); }
.ext-chip { display: inline-flex; align-items: center; padding: 2px 8px; background: var(--accent-bg); color: var(--accent-base); border-radius: var(--radius-full); font-size: var(--font-size-xs); font-family: var(--font-mono, monospace); font-weight: 500; }
.ext-chip.empty { background: var(--subtle-secondary); color: var(--text-tertiary); font-style: italic; }

.manifest-hint { display: flex; align-items: center; gap: var(--spacer-1); padding: var(--spacer-2) var(--spacer-3); background: var(--subtle-secondary); border-radius: var(--radius-md); font-size: var(--font-size-xs); color: var(--text-secondary); margin-bottom: var(--spacer-2); }
.manifest-hint code { background: var(--subtle-pressed); padding: 0 4px; border-radius: var(--radius-xs); font-size: 10px; }

.code-area { flex: 1; width: 100%; border: 1px solid var(--ctrl-border); border-radius: var(--radius-md); background: var(--ctrl-fill-default); color: var(--text-primary); font-family: var(--font-mono, 'Consolas', 'Monaco', monospace); font-size: var(--font-size-xs); padding: var(--spacer-3); outline: none; resize: none; tab-size: 2; line-height: 1.5; }
.code-area:focus { border-color: var(--accent-base); }
.code-js { min-height: 320px; }

.preview-toolbar { display: flex; align-items: center; gap: var(--spacer-2); padding: var(--spacer-2) 0; }
.prev-btn { display: inline-flex; align-items: center; gap: 4px; padding: var(--spacer-1) var(--spacer-3); background: var(--accent-base); color: white; border: none; border-radius: var(--radius-md); font-size: var(--font-size-xs); cursor: pointer; }
.prev-btn:hover { background: var(--accent-hover); }
.prev-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.preview-iframe { flex: 1; width: 100%; border: 1px solid var(--divider-stroke); border-radius: var(--radius-md); background: white; }


</style>