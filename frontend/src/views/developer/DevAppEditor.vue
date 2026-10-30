<template>
  <div class="app-editor">
    <!-- 顶栏 -->
    <header class="ae-header">
      <div class="ae-left">
        <button class="back-btn" @click="goBack" title="返回">
          <Icon icon="ri-arrow-left-s-line" :size="18" />
        </button>
        <div class="app-icon" :class="{ asset: isAssetIcon(app?.icon) }"><AppIcon :icon="app?.icon" :app-key="app?.app_key" :size="22" fallback="ri-apps-2-line" /></div>
        <div class="app-meta">
          <div class="app-title-row">
            <span class="app-name">{{ app?.name || '加载中...' }}</span>
            <span class="status-pill" :class="app?.status">{{ getStatusLabel(app?.status) }}</span>
            <span v-if="app?.is_shared" class="shared-pill">
              <Icon icon="ri-share-line" :size="10" /> 已共享
            </span>
            <span v-if="app?.forked_from" class="forked-pill">
              <Icon icon="ri-git-branch-line" :size="10" /> Fork 自 {{ app.forked_by || '未知' }}
            </span>
            <span v-if="readonly" class="readonly-pill">
              <Icon icon="ri-eye-line" :size="10" /> 只读
            </span>
          </div>
          <div class="app-sub">
            <Icon icon="ri-hashtag" :size="10" />
            <code>{{ app?.app_key }}</code>
            <span v-if="app?.category" class="cat-tag">{{ app.category }}</span>
          </div>
        </div>
      </div>
      <div class="ae-right">
        <template v-if="readonly">
          <button class="top-action primary" @click="forkFromReadonly" :disabled="busy">
            <Icon icon="ri-git-branch-line" :size="14" />
            Fork 到我的应用
          </button>
        </template>
        <template v-else>
          <button class="top-action" @click="toggleShare" :disabled="busy">
            <Icon :icon="app?.is_shared ? 'ri-share-circle-line' : 'ri-share-line'" :size="14" />
            {{ app?.is_shared ? '取消共享' : '共享到市场' }}
          </button>
          <button v-if="app?.status === 'draft'" class="top-action" @click="publish" :disabled="busy">
            <Icon icon="ri-rocket-line" :size="14" /> 发布
          </button>
          <button v-else-if="app?.status === 'published'" class="top-action" @click="archive" :disabled="busy">
            <Icon icon="ri-archive-line" :size="14" /> 归档
          </button>
          <button class="top-action primary" @click="saveCurrent" :disabled="busy || !dirty">
            <Icon :icon="busy ? 'ri-loader-4-line' : 'ri-save-line'" :size="14" :class="{ spin: busy }" />
            保存
          </button>
        </template>
      </div>
    </header>

    <div v-if="loading" class="ae-loading">
      <Icon icon="ri-loader-4-line" :size="24" class="spin" />
      <span>加载应用...</span>
    </div>

    <template v-else>
      <!-- 标签栏 -->
      <nav class="ae-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="ae-tab"
          :class="{ active: activeTab === tab.id, dirty: dirtyTabs[tab.id] }"
          @click="switchTab(tab.id)"
        >
          <Icon :icon="tab.icon" :size="14" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <!-- 内容区 -->
      <div class="ae-body">
        <!-- 基础信息 -->
        <section v-show="activeTab === 'basic'" class="tab-pane">
          <div class="form-grid">
            <div class="form-group">
              <label>应用名称</label>
              <input v-model="basicForm.name" :disabled="readonly" @input="markDirty('basic')" placeholder="应用名称" />
            </div>
            <div class="form-group">
              <label>版本</label>
              <input v-model="basicForm.version" :disabled="readonly" @input="markDirty('basic')" placeholder="1.0.0" />
            </div>
            <div class="form-group">
              <label>分类</label>
              <input v-model="basicForm.category" :disabled="readonly" @input="markDirty('basic')" list="app-category-suggestions" placeholder="考试管理 / 教学服务 / 评测服务 / AI 服务" />
              <datalist id="app-category-suggestions">
                <option v-for="c in categorySuggestions" :key="c" :value="c" />
              </datalist>
            </div>
            <div class="form-group">
              <label>应用图标</label>
              <div class="icon-input">
                <span class="icon-preview"><AppIcon :icon="basicForm.icon" :app-key="app?.app_key" :size="18" fallback="ri-apps-2-line" /></span>
                <input v-model="basicForm.icon" :disabled="readonly" @input="markDirty('basic')" list="app-icon-suggestions" placeholder="ri-apps-2-line" />
              </div>
              <datalist id="app-icon-suggestions">
                <option v-for="ic in iconSuggestions" :key="ic" :value="ic" />
              </datalist>
            </div>
            <div class="form-group full">
              <label>描述</label>
              <textarea v-model="basicForm.description" :disabled="readonly" @input="markDirty('basic')" rows="3" placeholder="简短描述应用用途"></textarea>
            </div>
          </div>
        </section>

        <!-- 应用信息清单 -->
        <section v-show="activeTab === 'app_info'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>应用信息清单 (app_info_manifest)：包含 name、version、description、category、author、icon、tags 等元数据，可在 ribbon 字段定义编辑器顶部 Ribbon 工具组</span>
          </div>
          <textarea
            v-model="appInfoText"
            :disabled="readonly"
            @input="markDirty('app_info')"
            class="code-area"
            spellcheck="false"
            placeholder='{ "name": "...", "ribbon": [{ "label": "文件", "tools": [{ "id": "save", "label": "保存", "icon": "ri-save-line", "command": "save" }] }] }'
          ></textarea>
        </section>

        <!-- Ribbon 工具栏（可视化编辑） -->
        <section v-show="activeTab === 'ribbon'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>Ribbon 工具栏：可视化定义编辑器顶部按钮组。修改后会自动同步到「应用信息清单」的 ribbon 字段。每个工具的 command 会通过 postMessage 发给 iframe 编辑器。</span>
          </div>

          <div class="ribbon-ve">
            <div v-for="(group, gi) in ribbonGroups" :key="gi" class="rv-group">
              <div class="rv-group-head">
                <input
                  v-model="group.label"
                  :disabled="readonly"
                  @input="onRibbonChange"
                  class="rv-group-label"
                  placeholder="组名（如：文件、编辑）"
                />
                <button v-if="!readonly" class="rv-del" @click="removeGroup(gi)" title="删除此组">
                  <Icon icon="ri-delete-bin-line" :size="14" />
                </button>
              </div>
              <div class="rv-tools">
                <div v-for="(tool, ti) in group.tools" :key="ti" class="rv-tool">
                  <div class="rv-tool-preview">
                    <Icon :icon="tool.icon || 'ri-question-line'" :size="20" />
                    <span class="rv-tool-label">{{ tool.label || '未命名' }}</span>
                  </div>
                  <div class="rv-tool-fields">
                    <input v-model="tool.id" :disabled="readonly" @input="onRibbonChange" placeholder="id（如 save）" />
                    <input v-model="tool.label" :disabled="readonly" @input="onRibbonChange" placeholder="显示名" />
                    <input v-model="tool.icon" :disabled="readonly" @input="onRibbonChange" placeholder="ri-xxx-line" />
                    <input v-model="tool.command" :disabled="readonly" @input="onRibbonChange" placeholder="command（如 save）" />
                    <select v-model="tool.type" :disabled="readonly" @change="onRibbonChange" class="rv-tool-type">
                      <option value="action">点击按钮</option>
                      <option value="select">页面切换</option>
                    </select>
                  </div>
                  <button v-if="!readonly" class="rv-del-sm" @click="removeTool(gi, ti)" title="删除工具">
                    <Icon icon="ri-close-line" :size="12" />
                  </button>
                </div>
                <button v-if="!readonly" class="rv-add-tool" @click="addTool(gi)">
                  <Icon icon="ri-add-line" :size="12" /> 添加工具
                </button>
              </div>
            </div>
            <button v-if="!readonly" class="rv-add-group" @click="addGroup">
              <Icon icon="ri-add-line" :size="14" /> 添加工具组
            </button>

            <div v-if="ribbonGroups.length === 0" class="rv-empty">
              <Icon icon="ri-toolbar-line" :size="32" />
              <p>暂无 Ribbon 工具组，点击上方「添加工具组」开始</p>
            </div>
          </div>
        </section>

        <!-- 编辑器 HTML -->
        <section v-show="activeTab === 'editor_html'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>编辑器 HTML：会注入到 iframe 中作为编辑器主体结构，可使用 <code v-pre>{{variable}}</code> 模板占位（由 JS 渲染）</span>
          </div>
          <textarea
            v-model="editorHtml"
            :disabled="readonly"
            @input="markDirty('editor_html')"
            class="code-area"
            spellcheck="false"
            placeholder="<div id='app'></div>"
          ></textarea>
        </section>

        <!-- 编辑器 JS -->
        <section v-show="activeTab === 'editor_js'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>编辑器 JS：在 iframe 内执行。平台会注入 <code>window.CSES</code> 全局对象（含 instance、config、storageManifest 等）以与平台通信</span>
          </div>
          <textarea
            v-model="editorJs"
            :disabled="readonly"
            @input="markDirty('editor_js')"
            class="code-area code-js"
            spellcheck="false"
            placeholder="// 可使用 window.CSES.request(action, payload) 与平台通信"
          ></textarea>
        </section>

        <!-- 存储清单 -->
        <section v-show="activeTab === 'storage'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>存储清单 (storage_manifest)：声明此应用的 collections，每个 collection 含 key、name、fields。配置管理器会据此自动生成多类型编辑器</span>
          </div>
          <textarea
            v-model="storageText"
            :disabled="readonly"
            @input="markDirty('storage')"
            class="code-area"
            spellcheck="false"
            placeholder='{ "collections": [{ "key": "lessons", "name": "课程", "fields": [{ "key": "title", "name": "标题", "type": "string" }] }] }'
          ></textarea>
        </section>

        <!-- 接口清单 -->
        <section v-show="activeTab === 'interface'" class="tab-pane">
          <div class="manifest-hint">
            <Icon icon="ri-information-line" :size="14" />
            <span>接口清单 (interface_schema)：声明应用对外暴露的数据接口，便于其他应用或外部工具调用</span>
          </div>
          <textarea
            v-model="interfaceText"
            :disabled="readonly"
            @input="markDirty('interface')"
            class="code-area"
            spellcheck="false"
            placeholder='{ "endpoints": [{ "method": "GET", "path": "/api/...", "description": "..." }] }'
          ></textarea>
        </section>

        <!-- 实时预览 -->
        <section v-show="activeTab === 'preview'" class="tab-pane">
          <div class="preview-toolbar">
            <button class="prev-btn" @click="refreshPreview">
              <Icon icon="ri-refresh-line" :size="14" /> 刷新预览
            </button>
            <span class="prev-hint">预览效果仅供展示，未保存的内容不会生效</span>
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
import { useAuth } from '../../composables/useAuth';
import { devApi } from '../../api';

const route = useRoute();
const router = useRouter();
const { user } = useAuth();
const appId = computed(() => Number(route.params.id || 0));
const readonly = computed(() => route.query.readonly === '1' && !user.value?.is_super_admin);

const loading = ref(false);
const busy = ref(false);
const app = ref<any>(null);

const activeTab = ref('basic');

const tabs = [
  { id: 'basic', icon: 'ri-settings-3-line', label: '基础信息' },
  { id: 'app_info', icon: 'ri-file-list-3-line', label: '应用信息清单' },
  { id: 'ribbon', icon: 'ri-toolbar-line', label: 'Ribbon 工具栏' },
  { id: 'editor_html', icon: 'ri-html5-line', label: '编辑器 HTML' },
  { id: 'editor_js', icon: 'ri-code-s-slash-line', label: '编辑器 JS' },
  { id: 'storage', icon: 'ri-database-2-line', label: '存储清单' },
  { id: 'interface', icon: 'ri-plug-line', label: '接口清单' },
  { id: 'preview', icon: 'ri-eye-line', label: '实时预览' }
];

// 基础信息
const basicForm = ref({ name: '', version: '', category: '', description: '', icon: '' });

// 分类/图标建议（datalist）
const categorySuggestions = ['考试管理', '教学服务', '评测服务', 'AI 服务', '通用'];
const iconSuggestions = [
  'ri-apps-2-line', 'ri-award-line', 'ri-book-open-line', 'ri-calculator-line',
  'ri-checkbox-multiple-line', 'ri-computer-line', 'ri-database-2-line', 'ri-file-list-3-line',
  'ri-flask-line', 'ri-global-line', 'ri-lightbulb-line', 'ri-medal-line',
  'ri-school-line', 'ri-settings-3-line', 'ri-store-2-line', 'ri-tools-line',
];

// 各类清单文本（textarea 编辑）
const appInfoText = ref('');
const editorHtml = ref('');
const editorJs = ref('');
const storageText = ref('');
const interfaceText = ref('');

// ===== Ribbon 可视化编辑器状态 =====
interface RibbonTool {
  id: string;
  label: string;
  icon: string;
  command?: string;
  type?: string;  // 'select' = 组内页面切换, 'action' = 点击型按钮（默认）
}
interface RibbonGroup {
  label: string;
  tools: RibbonTool[];
}
const ribbonGroups = ref<RibbonGroup[]>([]);

// 从 appInfoText 解析 ribbon 到可视化编辑器
function syncRibbonFromAppInfo() {
  try {
    const obj = appInfoText.value ? JSON.parse(appInfoText.value) : {};
    const arr = Array.isArray(obj.ribbon) ? obj.ribbon : [];
    ribbonGroups.value = arr.map((g: any) => ({
      label: g.label || '',
      tools: Array.isArray(g.tools) ? g.tools.map((t: any) => ({
        id: t.id || '',
        label: t.label || '',
        icon: t.icon || 'ri-question-line',
        command: t.command || '',
        type: t.type || 'action'
      })) : []
    }));
  } catch {
    // JSON 解析失败时保留当前可视化状态
  }
}

// 将可视化 ribbon 同步回 appInfoText
function onRibbonChange() {
  try {
    const obj = appInfoText.value ? JSON.parse(appInfoText.value) : {};
    obj.ribbon = ribbonGroups.value;
    appInfoText.value = JSON.stringify(obj, null, 2);
    markDirty('app_info');
  } catch {
    // appInfoText 当前不是合法 JSON，先尝试覆盖为合法结构
    const obj: any = { ribbon: ribbonGroups.value };
    appInfoText.value = JSON.stringify(obj, null, 2);
    markDirty('app_info');
  }
}

function addGroup() {
  ribbonGroups.value.push({ label: '新工具组', tools: [] });
  onRibbonChange();
}

function removeGroup(gi: number) {
  if (!confirm('确认删除此工具组及其所有工具？')) return;
  ribbonGroups.value.splice(gi, 1);
  onRibbonChange();
}

function addTool(gi: number) {
  ribbonGroups.value[gi].tools.push({
    id: 'tool_' + Date.now(),
    label: '新工具',
    icon: 'ri-tools-line',
    command: '',
    type: 'action'
  });
  onRibbonChange();
}

function removeTool(gi: number, ti: number) {
  ribbonGroups.value[gi].tools.splice(ti, 1);
  onRibbonChange();
}

// 脏标志
const dirtyTabs = ref<Record<string, boolean>>({});
const dirty = computed(() => Object.values(dirtyTabs.value).some(v => v));

const previewFrame = ref<HTMLIFrameElement | null>(null);
const previewSrcDoc = computed(() => {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Preview</title>
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1a1a1a;}
  body{overflow:auto;padding:12px;}
  pre.err{color:#c42b1c;background:#fff0f0;padding:8px;border-radius:4px;}
</style></head>
<body>
${editorHtml.value || '<!-- 无 HTML -->'}
<script>
  window.CSES = {
    instance: { id: 0, name: '预览实例', uid: 'preview' },
    config: {},
    storageManifest: ${safeJson(storageText.value)},
    interfaceSchema: ${safeJson(interfaceText.value)},
    request: (action, payload) => {
      console.log('[preview request]', action, payload);
      return Promise.resolve({ ok: true, preview: true });
    },
    saveConfig: c => window.CSES.request('saveConfig', c),
    loadConfig: () => window.CSES.request('loadConfig'),
    listStorage: col => window.CSES.request('listStorage', { collection: col }),
    saveStorage: (col, r) => window.CSES.request('saveStorage', { collection: col, record: r }),
    deleteStorage: (col, id) => window.CSES.request('deleteStorage', { collection: col, recordId: id }),
    notify: m => window.CSES.request('notify', { msg: m })
  };
  try {
${editorJs.value || '// 无自定义 JS'}
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', '<pre class="err">脚本错误: ' + e.message + '</pre>');
  }
<\/script>
</body></html>`;
});

function safeJson(text: string): string {
  if (!text || !text.trim()) return '{}';
  try { JSON.parse(text); return text; } catch { return '{}'; }
}

function getStatusLabel(status?: string): string {
  const labels: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };
  return labels[status || ''] || status || '';
}

/** icon 值以 asset: 开头表示应用自带真实图标（由 AppIcon 渲染） */
function isAssetIcon(icon?: string): boolean {
  return !!icon && icon.startsWith('asset:');
}

function markDirty(tab: string) {
  dirtyTabs.value[tab] = true;
}

function switchTab(tab: string) {
  activeTab.value = tab;
  if (tab === 'preview') refreshPreview();
  // 切到 ribbon 可视化编辑器时，从最新的 appInfoText 重新解析（避免外部修改 JSON 后可视化不同步）
  if (tab === 'ribbon') syncRibbonFromAppInfo();
}

function refreshPreview() {
  // 通过重新计算 srcDoc 触发 iframe 重载
  if (previewFrame.value) {
    previewFrame.value.srcdoc = previewSrcDoc.value;
  }
}

async function loadApp() {
  loading.value = true;
  try {
    const res = readonly.value
      ? await devApi.sharedGet(appId.value)
      : await devApi.getApp(appId.value);
    app.value = res;
    basicForm.value = {
      name: res.name || '',
      version: res.version || '1.0.0',
      category: res.category || '通用',
      description: res.description || '',
      icon: res.icon || res.app_info_manifest?.icon || 'ri-apps-2-line'
    };
    appInfoText.value = res.app_info_manifest ? JSON.stringify(res.app_info_manifest, null, 2) : '';
    editorHtml.value = res.editor_html || '';
    editorJs.value = res.editor_js || '';
    storageText.value = res.storage_manifest ? JSON.stringify(res.storage_manifest, null, 2) : '';
    interfaceText.value = res.interface_schema ? JSON.stringify(res.interface_schema, null, 2) : '';
    syncRibbonFromAppInfo();
    dirtyTabs.value = {};
  } catch (e: any) {
    alert(e.message || '加载失败');
    router.push('/console/developer/apps');
  } finally {
    loading.value = false;
  }
}

async function saveCurrent() {
  if (!dirty.value || busy.value) return;
  busy.value = true;
  try {
    // 1. 基础信息
    if (dirtyTabs.value.basic) {
      await devApi.updateApp(appId.value, basicForm.value);
      dirtyTabs.value.basic = false;
    }
    // 2. 各类清单（含校验）
    if (dirtyTabs.value.app_info) {
      const v = JSON.parse(appInfoText.value || '{}');
      await devApi.saveManifest(appId.value, 'app_info', v);
      dirtyTabs.value.app_info = false;
    }
    if (dirtyTabs.value.editor_html) {
      await devApi.saveManifest(appId.value, 'editor_html', editorHtml.value);
      dirtyTabs.value.editor_html = false;
    }
    if (dirtyTabs.value.editor_js) {
      await devApi.saveManifest(appId.value, 'editor_js', editorJs.value);
      dirtyTabs.value.editor_js = false;
    }
    if (dirtyTabs.value.storage) {
      const v = JSON.parse(storageText.value || '{}');
      await devApi.saveManifest(appId.value, 'storage', v);
      dirtyTabs.value.storage = false;
    }
    if (dirtyTabs.value.interface) {
      const v = JSON.parse(interfaceText.value || '{}');
      await devApi.saveManifest(appId.value, 'interface', v);
      dirtyTabs.value.interface = false;
    }
    await loadApp();
    alert('已保存');
  } catch (e: any) {
    alert(e.message || '保存失败');
  } finally {
    busy.value = false;
  }
}

async function publish() {
  if (!confirm('确认发布此应用？发布后才能在实例创建时被选择。')) return;
  busy.value = true;
  try {
    await devApi.publishApp(appId.value);
    await loadApp();
    alert('已发布');
  } catch (e: any) {
    alert(e.message || '发布失败');
  } finally {
    busy.value = false;
  }
}

async function archive() {
  if (!confirm('确认归档此应用？')) return;
  busy.value = true;
  try {
    await devApi.archiveApp(appId.value);
    await loadApp();
    alert('已归档');
  } catch (e: any) {
    alert(e.message || '归档失败');
  } finally {
    busy.value = false;
  }
}

async function toggleShare() {
  busy.value = true;
  try {
    const res = await devApi.toggleShare(appId.value);
    app.value.is_shared = res.is_shared;
    alert(res.is_shared ? '已共享到市场' : '已取消共享');
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

function goBack() {
  if (!readonly.value && dirty.value && !confirm('有未保存的更改，确认离开？')) return;
  if (readonly.value) {
    router.push('/console/developer/market');
  } else {
    router.push('/console/developer/apps');
  }
}

async function forkFromReadonly() {
  if (!app.value) return;
  if (!confirm(`确认 Fork 应用「${app.value.name}」到我的应用列表？\n\nFork 后可在「我的应用」中修改和发布。`)) return;
  busy.value = true;
  try {
    const res = await devApi.forkApp(appId.value);
    alert(`已 Fork 到我的应用，新 app_key: ${res.app_key}`);
    router.push(`/console/developer/apps/${res.id}/edit`);
  } catch (e: any) {
    alert(e.message || 'Fork 失败');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  loadApp();
});
</script>

<style scoped>
.app-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
  overflow: hidden;
}

.ae-header {
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

.ae-left {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex: 1;
  min-width: 0;
}

.back-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.back-btn:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.app-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* 应用自带真实图标时不使用底色 */
.app-icon.asset {
  background: transparent;
  overflow: hidden;
}

.app-meta { flex: 1; min-width: 0; }

.app-title-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.app-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.status-pill {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 500;
}

.status-pill.draft { background: rgba(202, 143, 4, 0.1); color: #CA8F04; }
.status-pill.published { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.status-pill.archived { background: rgba(0,0,0,0.08); color: var(--text-tertiary); }

.shared-pill, .forked-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-weight: 500;
}

.shared-pill { background: var(--accent-bg); color: var(--accent-base); }
.forked-pill { background: var(--subtle-pressed); color: var(--text-secondary); }

.app-sub {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.app-sub code {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.cat-tag {
  padding-left: var(--spacer-1);
  margin-left: var(--spacer-1);
  border-left: 1px solid var(--divider-stroke);
}

.ae-right {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.top-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.top-action:hover { background: var(--subtle-pressed); }
.top-action:disabled { opacity: 0.5; cursor: not-allowed; }
.top-action.primary { background: var(--accent-base); color: white; border-color: var(--accent-base); }
.top-action.primary:hover { background: var(--accent-hover); }

.ae-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-6);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.ae-tabs {
  display: flex;
  gap: 2px;
  background: var(--subtle-secondary);
  border-bottom: 1px solid var(--divider-stroke);
  padding: 0 var(--spacer-3);
  flex-shrink: 0;
  overflow-x: auto;
}

.ae-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--fast-duration);
  position: relative;
}

.ae-tab:hover { color: var(--text-primary); }

.ae-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-base);
  font-weight: 500;
  background: var(--layer-default);
}

.ae-tab.dirty::after {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--status-warning, #CA8F04);
  position: absolute;
  top: 6px;
  right: 4px;
}

.ae-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tab-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--spacer-4);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-3);
  max-width: 800px;
}

.form-group.full { grid-column: 1 / -1; }

.icon-input {
  position: relative;
  display: flex;
  align-items: center;
}

.icon-preview {
  position: absolute;
  left: var(--spacer-2);
  display: inline-flex;
  color: var(--text-secondary);
  pointer-events: none;
}

.icon-input input {
  width: 100%;
  padding-left: calc(var(--spacer-2) * 2 + 18px);
}

.manifest-hint {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  margin-bottom: var(--spacer-2);
}

.manifest-hint code {
  background: var(--subtle-pressed);
  padding: 0 4px;
  border-radius: var(--radius-xs);
  font-size: 10px;
}

.code-area {
  flex: 1;
  width: 100%;
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  background: var(--ctrl-fill-default);
  color: var(--text-primary);
  font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
  font-size: var(--font-size-xs);
  padding: var(--spacer-3);
  outline: none;
  resize: none;
  tab-size: 2;
  line-height: 1.5;
}

.code-area:focus { border-color: var(--accent-base); }

.code-js { min-height: 320px; }

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) 0;
}

.prev-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.prev-btn:hover { background: var(--accent-hover); }

.prev-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.preview-iframe {
  flex: 1;
  width: 100%;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  background: white;
}

/* ===== Ribbon 可视化编辑器 ===== */
.ribbon-ve {
  flex: 1;
  overflow: auto;
  padding: var(--spacer-2);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.rv-group {
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-3);
}

.rv-group-head {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-2);
}

.rv-group-label {
  flex: 1;
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  outline: none;
}

.rv-group-label:focus { border-color: var(--accent-base); }

.rv-del {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.rv-del:hover { background: rgba(196, 43, 28, 0.1); color: var(--status-error); }

.rv-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacer-2);
  align-items: stretch;
}

.rv-tool {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-2);
  width: 220px;
  position: relative;
}

.rv-tool-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2);
  background: var(--layer-default);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.rv-tool-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-primary);
}

.rv-tool-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-1);
}

.rv-tool-fields input {
  padding: 4px var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  font-family: var(--font-mono, monospace);
}

.rv-tool-fields input:focus { border-color: var(--accent-base); }

.rv-tool-type {
  padding: 4px var(--spacer-2);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  font-family: var(--font-mono, monospace);
  grid-column: 1 / -1;
}
.rv-tool-type:focus { border-color: var(--accent-base); }

.rv-del-sm {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  color: var(--text-tertiary);
  cursor: pointer;
}

.rv-del-sm:hover { background: rgba(196, 43, 28, 0.1); color: var(--status-error); }

.rv-add-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: 1px dashed var(--ctrl-border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  align-self: flex-start;
}

.rv-add-tool:hover { background: var(--subtle-secondary); color: var(--accent-base); border-color: var(--accent-base); }

.rv-add-group {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.rv-add-group:hover { background: var(--accent-hover); }

.rv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-6);
  color: var(--text-tertiary);
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
}

/* ===== 只读模式 ===== */
.readonly-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  background: rgba(202, 143, 4, 0.1);
  color: #CA8F04;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 500;
}

input:disabled, textarea:disabled, select:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
