/**
 * AI 编辑器桥（前端侧客户端工具执行通道）。
 *
 * 契约（docs/AI-assistant-v4-spec.md §3.1）：
 *   - LightEditor 在 setup 中调用 `provideAiEditorBridge({ executeClientTool })` 注册当前编辑器桥；
 *   - 任意 AI 面板调用 `useAiEditorBridge()`：拿不到桥时 available=false，
 *     此时面板应把客户端工具直接回 `{ ok:false, result:'当前页面没有可操作的编辑器' }`。
 *
 * 客户端工具名（scope='client'，服务端通过 SSE `await_tool` 下发）：
 *   - get_editor_state      读：当前标签/文件/语言/选区/面板/存储用量
 *   - read_editor_elements  读：文件树可见项、Ribbon 工具组、右侧面板、侧栏视图
 *   - screenshot_editor     读：截取编辑器区域并上传，返回 image URL
 *   - operate_editor        写：open_file / switch_tab / close_tab / insert_text /
 *                                 replace_selection / set_content / save / set_panel /
 *                                 goto_line / run_ribbon
 */
import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';

/** 单个客户端工具的执行结果 */
export interface AiClientToolResult {
  ok: boolean;
  /** 给模型看的文本结果（失败时写清原因） */
  result?: string;
  /** 截图工具返回的图片地址（服务端 /ai/chat?action=shot&id=...） */
  image?: string;
}

/** 客户端工具处理函数 */
export type AiEditorToolHandler = (
  args: any,
) => AiClientToolResult | Promise<AiClientToolResult>;

/** 客户端工具名 → 处理函数 */
export type AiEditorToolMap = Record<string, AiEditorToolHandler>;

/** 桥的具体实现（由 LightEditor 提供） */
export interface AiEditorBridgeImpl {
  executeClientTool(name: string, args?: any): Promise<AiClientToolResult>;
}

/** 桥（含可用性），AI 面板使用 */
export interface AiEditorBridge extends AiEditorBridgeImpl {
  /** 当前页面是否注册了编辑器桥 */
  available: Ref<boolean>;
}

/** 未注册桥时的统一回包（与 spec 文案保持一致） */
export const NO_EDITOR_RESULT: Readonly<AiClientToolResult> = Object.freeze({
  ok: false,
  result: '当前页面没有可操作的编辑器',
});

/** 编辑器桥实际支持的客户端工具（用于未知工具报错提示） */
export const AI_EDITOR_CLIENT_TOOLS = [
  'get_editor_state',
  'read_editor_elements',
  'screenshot_editor',
  'operate_editor',
] as const;

const AI_EDITOR_BRIDGE_KEY: InjectionKey<AiEditorBridge> = Symbol('ai-editor-bridge');

/**
 * 用「工具名 → 处理函数」建一个桥实现：
 * 自动做未知工具兜底与异常兜底，处理函数只需返回 { ok, result?, image? }。
 */
export function createAiEditorBridgeImpl(toolMap: AiEditorToolMap): AiEditorBridgeImpl {
  return {
    async executeClientTool(name: string, args?: any): Promise<AiClientToolResult> {
      const tool = String(name ?? '').trim();
      const handler = toolMap[tool];
      if (typeof handler !== 'function') {
        return {
          ok: false,
          result: `未知的客户端工具：${tool || '(空)'}（支持：${Object.keys(toolMap).join('、')}）`,
        };
      }
      try {
        const res = await handler(args ?? {});
        if (!res || typeof res !== 'object' || typeof res.ok !== 'boolean') {
          return { ok: false, result: `客户端工具 ${tool} 未返回有效结果` };
        }
        const normalized: AiClientToolResult = { ok: res.ok };
        if (typeof res.result === 'string' && res.result !== '') normalized.result = res.result;
        if (typeof res.image === 'string' && res.image !== '') normalized.image = res.image;
        return normalized;
      } catch (e: any) {
        return {
          ok: false,
          result: `客户端工具 ${tool} 执行失败：${e?.message || String(e)}`,
        };
      }
    },
  };
}

/** LightEditor 调用：注册当前编辑器桥（必须在 setup 中调用） */
export function provideAiEditorBridge(impl: AiEditorBridgeImpl): void {
  const available = ref(true);
  provide(AI_EDITOR_BRIDGE_KEY, {
    available,
    executeClientTool: (name: string, args?: any) => impl.executeClientTool(name, args),
  });
}

/** 任意 AI 面板调用：取当前编辑器桥；未注册时 available=false，工具统一回“没有可操作的编辑器” */
export function useAiEditorBridge(): AiEditorBridge {
  const injected = inject<AiEditorBridge | null>(AI_EDITOR_BRIDGE_KEY, null);
  if (injected) return injected;
  return {
    available: ref(false),
    executeClientTool: async (): Promise<AiClientToolResult> => ({ ...NO_EDITOR_RESULT }),
  };
}
