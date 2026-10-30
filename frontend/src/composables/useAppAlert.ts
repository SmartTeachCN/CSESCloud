/**
 * 应用级自定义提示框（替代 window.alert）。
 *
 * - `installAppAlert()` 在 main.ts 中于挂载前调用：把 window.alert 换成入队版，
 *   原有 alert 调用点无需改动，调用后代码继续同步执行（不阻塞、不返回 Promise）。
 * - 提示进入响应式队列，由 <AppAlertHost />（App.vue 中挂载）逐条展示；
 *   挂载前产生的提示会在组件挂载后补显。
 * - 原始 window.alert 保存在 `window.__appNativeAlert`，仅在自定义提示自身出错时兜底。
 */
import { readonly, ref } from 'vue';

export interface AppAlertItem {
  id: number;
  message: string;
}

type NativeAlert = (message?: unknown) => void;

const queue = ref<AppAlertItem[]>([]);
let seq = 0;
let nativeAlert: NativeAlert | null = null;
let installed = false;

/** 只读队列：AppAlertHost 消费，其它组件用 showAppAlert 入队 */
export const appAlertQueue = readonly(queue);

/** 当前展示的提示（队首） */
export function currentAppAlert(): AppAlertItem | null {
  return queue.value.length > 0 ? queue.value[0] : null;
}

/** 入队一条提示（多行文本原样保留，由组件按 pre-wrap 渲染） */
export function showAppAlert(message: unknown): void {
  const text = String(message ?? '');
  if (text.trim() === '') return;
  seq += 1;
  queue.value.push({ id: seq, message: text });
}

/** 关闭当前提示，队列中还有则自动展示下一条 */
export function closeCurrentAppAlert(): void {
  queue.value.shift();
}

/** 清空队列（如退出登录时） */
export function clearAppAlerts(): void {
  queue.value.splice(0, queue.value.length);
}

/** 安装 window.alert 覆盖（幂等，可重复调用） */
export function installAppAlert(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const w = window as unknown as { alert: NativeAlert; __appNativeAlert?: NativeAlert };
  nativeAlert = typeof w.alert === 'function' ? w.alert.bind(window) : null;
  // 保留原 alert 作为兜底（不引用被覆盖后的 window.alert，避免递归）
  w.__appNativeAlert = nativeAlert ?? undefined;

  w.alert = (message?: unknown) => {
    try {
      showAppAlert(message);
    } catch (err) {
      // 自定义提示异常时退回浏览器原生 alert
      if (nativeAlert) nativeAlert(message);
      else console.error('[appAlert] 显示提示失败', err);
    }
  };
}

/** 还原 window.alert（测试/热更新场景用） */
export function uninstallAppAlert(): void {
  if (!installed || typeof window === 'undefined') return;
  const w = window as unknown as { alert: NativeAlert; __appNativeAlert?: NativeAlert };
  if (nativeAlert) w.alert = nativeAlert;
  nativeAlert = null;
  installed = false;
}
