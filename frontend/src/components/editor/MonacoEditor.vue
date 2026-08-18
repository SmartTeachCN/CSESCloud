<template>
  <div class="monaco-editor-wrapper" ref="editorContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import loader from '@monaco-editor/loader';
import { useEditorSettings } from '../../composables/useEditorSettings';

const editorSettings = useEditorSettings();

const props = defineProps<{
  modelValue: string;
  language?: string;
  readOnly?: boolean;
  theme?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'editor-ready', editor: any): void;
  (e: 'save'): void;
  (e: 'find'): void;
  (e: 'replace'): void;
}>();

const editorContainer = ref<HTMLElement | null>(null);
let editor: any = null;
let monaco: any = null;

// 暴露方法给父组件
defineExpose({
  undo: () => editor?.trigger('keyboard', 'undo', null),
  redo: () => editor?.trigger('keyboard', 'redo', null),
  getValue: () => editor?.getValue(),
  setValue: (v: string) => editor?.setValue(v),
  focus: () => editor?.focus(),
  /** 打开 Monaco 原生“转到行”输入框 */
  gotoLine: () => {
    if (!editor) return;
    editor.focus();
    editor.trigger('keyboard', 'editor.action.gotoLine', '');
  },
});

// 语言映射
const languageMap: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  sh: 'shell',
  bat: 'bat',
  ps1: 'powershell',
  txt: 'plaintext',
  csv: 'plaintext',
  ini: 'ini',
  toml: 'plaintext',
  env: 'plaintext',
  cfg: 'plaintext',
  conf: 'plaintext',
  log: 'plaintext',
  vue: 'html',
  svg: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  cses: 'html'
};

async function initEditor() {
  if (!editorContainer.value) return;

  monaco = await loader.init();

  const lang = languageMap[props.language || ''] || props.language || 'plaintext';

  // 是否深色（受全局设置影响）
  const isDark = editorSettings.isDark();
  const themeName = isDark ? 'cses-dark' : 'vs';

  // 定义深色主题
  monaco.editor.defineTheme('cses-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editor.selectionBackground': '#264f78',
      'editorCursor.foreground': '#aeafad',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
    }
  });

  const opts = editorSettings.state;

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue || '',
    language: lang,
    theme: props.theme || themeName,
    readOnly: props.readOnly || false,
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: opts.fontSize,
    lineNumbers: opts.lineNumbers ? 'on' : 'off',
    scrollBeyondLastLine: false,
    wordWrap: opts.wordWrap ? 'on' : 'off',
    tabSize: 2,
    renderWhitespace: opts.renderWhitespace ? 'all' : 'none',
    bracketPairColorization: { enabled: true },
    autoIndent: 'full',
    formatOnPaste: true,
    suggest: { showWords: opts.suggest, enabled: opts.suggest },
    snippetSuggestions: opts.snippets ? 'top' : 'none',
    padding: { top: 8 }
  });

  editor.onDidChangeModelContent(() => {
    const value = editor.getValue();
    emit('update:modelValue', value);
  });

  // 注册自定义快捷键
  editor.addAction({
    id: 'cses-save',
    label: 'Save File',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
    run: () => { emit('save'); }
  });
  editor.addAction({
    id: 'cses-find',
    label: 'Find',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
    run: () => { emit('find'); }
  });
  editor.addAction({
    id: 'cses-replace',
    label: 'Replace',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
    run: () => { emit('replace'); }
  });

  emit('editor-ready', editor);
}

function destroyEditor() {
  if (editor) {
    try {
      editor.dispose();
    } catch { /* 忽略销毁时的错误 */ }
    editor = null;
  }
}

watch(() => props.modelValue, (newVal) => {
  if (editor && newVal !== editor.getValue()) {
    editor.setValue(newVal);
  }
});

watch(() => props.language, (newLang) => {
  if (editor && monaco) {
    const lang = languageMap[newLang || ''] || newLang || 'plaintext';
    monaco.editor.setModelLanguage(editor.getModel(), lang);
  }
});

watch(() => props.readOnly, (readOnly) => {
  if (editor) {
    editor.updateOptions({ readOnly });
  }
});

watch(() => props.theme, (theme) => {
  if (editor && monaco) {
    monaco.editor.setTheme(theme || 'vs');
  }
});

// 全局设置变化实时应用到编辑器
watch(
  () => [editorSettings.state.fontSize, editorSettings.state.wordWrap, editorSettings.state.suggest, editorSettings.state.snippets, editorSettings.state.renderWhitespace, editorSettings.state.lineNumbers],
  () => {
    if (!editor || !monaco) return;
    const o = editorSettings.state;
    editor.updateOptions({
      fontSize: o.fontSize,
      lineNumbers: o.lineNumbers ? 'on' : 'off',
      wordWrap: o.wordWrap ? 'on' : 'off',
      renderWhitespace: o.renderWhitespace ? 'all' : 'none',
      suggest: { showWords: o.suggest, enabled: o.suggest },
      snippetSuggestions: o.snippets ? 'top' : 'none',
    });
  }
);

// 主题设置变化实时切换 Monaco 主题
watch(
  () => [editorSettings.state.theme],
  () => {
    if (!editor || !monaco) return;
    const isDarkNow = editorSettings.isDark();
    monaco.editor.defineTheme('cses-dark', {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {
        'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4',
        'editor.lineHighlightBackground': '#2a2d2e', 'editor.selectionBackground': '#264f78',
        'editorCursor.foreground': '#aeafad', 'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
      }
    });
    monaco.editor.setTheme(props.theme || (isDarkNow ? 'cses-dark' : 'vs'));
  }
);

onMounted(async () => {
  await nextTick();
  initEditor();
});

onBeforeUnmount(() => {
  destroyEditor();
});
</script>

<style scoped>
.monaco-editor-wrapper {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>