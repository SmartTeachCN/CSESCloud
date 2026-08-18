<template>
  <iframe
    ref="pluginFrame"
    class="plugin-iframe"
    :srcdoc="srcdoc"
    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
    @load="onLoad"
  ></iframe>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  plugin: {
    plugin_key: string;
    name: string;
    editor_html: string;
    editor_js: string;
    editor_css?: string;
  } | null;
  fileInfo: {
    name: string;
    content?: string;
    path?: string;
  } | null;
}>();

const emit = defineEmits<{
  (e: 'ready'): void;
  (e: 'save', content: string): void;
  (e: 'notify', msg: string): void;
  (e: 'pluginRequest', requestId: number, action: string, payload: any): void;
  (e: 'setRibbon', groups: any[]): void;
}>();

const pluginFrame = ref<HTMLIFrameElement | null>(null);
const iframeReady = ref(false);

const srcdoc = computed(() => {
  if (!props.plugin) return '<html><body></body></html>';
  const html = props.plugin.editor_html || '<div id="app"></div>';
  const css = props.plugin.editor_css || '';
  const js = props.plugin.editor_js || '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${props.plugin.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #fff; color: #1a1a1a; }
  body { overflow: auto; }
${css}
</style>
</head>
<body>
${html}
<script>
  // 平台注入的 SDK
  window.CSEditor = {
    plugin: ${JSON.stringify({ key: props.plugin?.plugin_key, name: props.plugin?.name })},
    file: ${JSON.stringify(props.fileInfo || { name: '', content: '' })},
    // 与父窗口通信
    request: (action, payload) => new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      const handler = (e) => {
        if (e.data && e.data.__csesPluginResponse === id) {
          window.removeEventListener('message', handler);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        }
      };
      window.addEventListener('message', handler);
      window.parent.postMessage({ __csesPluginRequest: id, action, payload }, '*');
    }),
    saveContent: (content) => window.CSEditor.request('save', { content }),
    getContent: () => window.CSEditor.request('getContent'),
    notify: (msg) => window.CSEditor.request('notify', { msg }),
    // 便捷方法：直接通过 postMessage 发送保存事件
    emitSave: (content) => {
      window.parent.postMessage({ __csesPluginSave: true, content, fileName: ${JSON.stringify(props.fileInfo?.name)} }, '*');
    },
    // 通知平台更新“靠左”Ribbon 分组（插件自定义左侧工具栏）
    setRibbon: (groups) => {
      window.parent.postMessage({ __csesPluginSetRibbon: true, groups }, '*');
    }
  };
  // 监听父窗口命令
  window.addEventListener('message', function(e) {
    if (e.data && e.data.__ceseCommand === 'save') {
      if (typeof saveConfig === 'function') saveConfig();
    }
  });
${js}
<\/script>
</body>
</html>`;
});

function onLoad() {
  iframeReady.value = true;
  emit('ready');
}

// 监听来自插件 iframe 的消息
window.addEventListener('message', (e) => {
  if (!e.data) return;

  // 处理插件请求
  if (e.data.__csesPluginRequest) {
    const { __csesPluginRequest: id, action, payload } = e.data;
    try {
      if (action === 'save') {
        emit('save', payload?.content || '');
        pluginFrame.value?.contentWindow?.postMessage({ __csesPluginResponse: id, result: { ok: true } }, '*');
      } else if (action === 'getContent') {
        pluginFrame.value?.contentWindow?.postMessage({ __csesPluginResponse: id, result: { content: props.fileInfo?.content || '' } }, '*');
      } else if (action === 'notify') {
        emit('notify', payload?.msg || '');
        pluginFrame.value?.contentWindow?.postMessage({ __csesPluginResponse: id, result: { ok: true } }, '*');
      } else {
        // 转发未知 action 到父组件处理（如 controlApi 等），由父组件异步响应
        emit('pluginRequest', id, action, payload);
      }
    } catch (err: any) {
      pluginFrame.value?.contentWindow?.postMessage({ __csesPluginResponse: id, error: err.message }, '*');
    }
  }

  // 处理插件直接保存
  if (e.data.__csesPluginSave) {
    emit('save', e.data.content || '');
  }

  // 处理插件自定义左侧 Ribbon
  if (e.data.__csesPluginSetRibbon) {
    emit('setRibbon', Array.isArray(e.data.groups) ? e.data.groups : []);
  }
});

defineExpose({ iframeReady, pluginFrame });
</script>

<style scoped>
.plugin-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}
</style>