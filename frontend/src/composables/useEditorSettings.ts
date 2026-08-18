import { reactive, watch } from 'vue';

/**
 * 全局编辑器设置（所有编辑器共享一份，持久化到 localStorage）。
 * 供 MonacoEditor、RibbonToolbar（字号/设置弹层）等使用。
 */

export type EditorThemeMode = 'system' | 'light' | 'dark';

export interface EditorSettings {
  /** 编辑器主题：跟随系统 / 浅色 / 深色 */
  theme: EditorThemeMode;
  /** 自动换行 */
  wordWrap: boolean;
  /** 代码自动完成（suggest） */
  suggest: boolean;
  /** 启动代码段（snippet 建议） */
  snippets: boolean;
  /** 显示隐藏字符 */
  renderWhitespace: boolean;
  /** 显示行号 */
  lineNumbers: boolean;
  /** 字号 */
  fontSize: number;
}

const STORAGE_KEY = 'cses.editor.settings';

const DEFAULTS: EditorSettings = {
  theme: 'system',
  wordWrap: true,
  suggest: true,
  snippets: true,
  renderWhitespace: true,
  lineNumbers: true,
  fontSize: 13,
};

function loadSaved(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

// 模块级单例响应式状态
const state = reactive<EditorSettings>(loadSaved());

watch(state, (val) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  } catch { /* 忽略存储失败 */ }
}, { deep: true });

/** 判断当前是否应使用深色主题（跟随系统时读取系统偏好） */
function prefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

export interface EditorSettingsApi {
  state: EditorSettings;
  /** 计算出的 Monaco 是否深色主题 */
  isDark: () => boolean;
  /** 设置单个字段 */
  set: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  reset: () => void;
}

let cachedIsDark = prefersDark();

export function useEditorSettings(): EditorSettingsApi {
  // 跟随系统时监听系统主题变化，保持缓存更新
  if (typeof window !== 'undefined' && !window.__csesSettingsThemeListener) {
    window.__csesSettingsThemeListener = true;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq) {
      mq.addEventListener('change', () => {
        cachedIsDark = mq.matches;
      });
    }
  }

  return {
    state,
    isDark: () => {
      if (state.theme === 'light') return false;
      if (state.theme === 'dark') return true;
      return cachedIsDark;
    },
    set: (key, value) => {
      (state as any)[key] = value;
    },
    reset: () => {
      Object.assign(state, DEFAULTS);
    },
  };
}

// 声明全局挂载类型（避免 TS 报错）
declare global {
  interface Window {
    __csesSettingsThemeListener?: boolean;
  }
}