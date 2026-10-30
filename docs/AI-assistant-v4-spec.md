# AI 助理 v4 设计契约（实现方必须遵守）

> 本文件是并行开发的唯一接口契约。任何跨文件字段名/事件名都以本文件为准；需要改契约先在 Team 里说。

## 0. 目标拆解

| # | 需求 | 落点 |
|---|---|---|
| 1 | 会话列表右键 + 会话右键（置顶/删除/重命名…） | `views/ai/AiAssistantPage.vue` + 服务端 sessions CRUD |
| 2 | AI 自动生成会话标题 | 服务端 `title.js`，前端收 `title` 事件刷新列表 |
| 3 | 消息气泡流式等待动画 | `components/ai/AiTurnView.vue` 等展示组件 |
| 4 | **真流式桥接**（API→服务端→前端逐 token，非假动画） | `server/api/ai/agent.js` + `composables/useAiStream.ts` |
| 5 | 模型选择框 + 推理等级（DeepSeek 优先） | `AiAssistantPage` 的 `ModelPicker.vue` + `agent.js` 参数映射 |
| 6 | 工具调用 + 会话内 AI 状态展示 + 向用户提问（DSH 式） | `tools.js` / `agent.js` / `AiToolCard.vue` / `AiAskCard.vue` |
| 7 | AI 真能操作：轻编辑器文件/实例/文件内容/截图/读元素/用户信息 | 服务端 `tools.js` + 前端 `useAiEditorBridge.ts` |

## 1. 端到端流式协议（SSE，`POST /api/ai/chat?action=stream`）

响应头：`text/event-stream`，每行 `data: {json}\n\n`。事件 `type` 取值：

```ts
{ type:'start', session_id:number, run_id:string, model:string, reasoning:string }
{ type:'reasoning', delta:string }                       // 思维链增量（DeepSeek reasoning_content）
{ type:'text', delta:string, token:string }              // 正文增量；token 为旧字段名兼容别名
{ type:'tool_start', id:string, name:string, label:string, args:any, scope:'server'|'client', risk:'read'|'write' }
{ type:'tool_end',   id:string, ok:boolean, summary:string, result?:string, image?:string }
{ type:'await_tool', id:string, name:string, label:string, args:any, risk:'read'|'write' }   // 需要浏览器执行
{ type:'await_user', id:string, questions:Question[] }                                        // ask_user 工具
{ type:'title', title:string }
{ type:'usage', prompt_tokens?:number, completion_tokens?:number }
{ type:'error', message:string }
{ type:'done', session_id:number, message_id:number, reply:string, title?:string, interrupted?:boolean }
```

`Question`：
```ts
{ header?:string, question:string, multiSelect?:boolean,
  options?:{ label:string, description?:string }[] }
```

### 续跑（客户端执行完工具 / 用户回答完问题）

```
POST /api/ai/chat?action=resume
{ run_id:string,
  results:[ { id:string, ok:boolean, result?:string, image?:string, answers?:string[] } ] }
```
响应同样是 SSE，事件集合同上（会先补发 `tool_end` 再继续模型轮次）。
`answers` 仅用于 `await_user`（一个 id 对应一条结果，`result` 可同时给摘要文本）。

### 兼容与错误
- 非流式 `action=send` 保留（返回整段 reply），但前端主路径只用 `stream`/`resume`。
- 断连：客户端 `AbortController.abort()`；服务端 `req.on('close')` 中止上游。
- 上游失败 → `{type:'error'}` 后 `{type:'done', interrupted:true}`，已产出的文本仍入库。

## 2. 数据库变更（`schema.sql` + `server/lib/db.js#ensureSchema`）

```sql
ALTER TABLE ai_chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_chat_sessions ADD COLUMN pinned_at TEXT;
ALTER TABLE ai_chat_sessions ADD COLUMN title_generated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_chat_sessions ADD COLUMN model TEXT;
ALTER TABLE ai_chat_messages ADD COLUMN meta TEXT;      -- JSON: {reasoning, blocks, model, usage}
CREATE TABLE IF NOT EXISTS ai_pending_runs (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, session_id INTEGER NOT NULL,
  state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```
`ai_chat_messages.meta.blocks` 保存展示块（见 §4 `AiBlock`），用于刷新/重开会话后还原工具卡与提问卡。

## 3. 服务端工具契约（`server/api/ai/tools.js`）

```js
module.exports = {
  /** @returns {Array<ToolDef>} */
  definitions(opts?: { hasEditor?: boolean }),
  /** 前端事件 label 用 */
  labelOf(name): string,
  /** @returns {Promise<{ok:boolean, summary:string, result?:string, image?:string, patch?:object}>} */
  async execute(name, args, ctx),
};
// ToolDef = { name, label, scope:'server'|'client', risk:'read'|'write',
//             description, parameters /* JSON Schema */ }
// ctx = { ownerKey, user, sessionId, scope, editorContext, DB, client:{ hasEditor:boolean } }
```

工具清单（名称固定）：

**server / read**
- `get_user_info` — 账号、角色、显示名、已用空间/配额、云文件数、实例数、数据空间概况
- `list_cloud_files` `{ directory?:string }` — 云文件列表（含目录、大小、类型、是否已分发）
- `read_cloud_file` `{ file_id?:number, path?:string }` — 读文件内容（超长截断 8000 字符）
- `list_instances` `{}` — 配置实例列表（名称、类型、源文件、URL、状态）
- `get_dataspace_info` `{ }` — 数据空间树 + 用量

**server / write**
- `create_cloud_file` `{ name:string, directory?:string, content?:string }`
- `update_cloud_file` `{ file_id?:number, path?:string, content:string }`
- `rename_cloud_file` `{ file_id?:number, path?:string, new_name:string }`
- `delete_cloud_file` `{ file_id?:number, path?:string }`
- `create_instance` `{ file_id?:number, path?:string, name?:string, organization_name?:string }`
- `update_instance` `{ instance_id:number, name?:string, organization_name?:string, status?:string }`
- `delete_instance` `{ instance_id:number }`

**client / read**（浏览器执行，`await_tool`）
- `get_editor_state` `{}` — 当前打开标签、当前文件、语言、选区、脏状态、当前面板
- `read_editor_elements` `{}` — 文件树可见项、Ribbon 工具组、右侧面板标题、按钮文案
- `screenshot_editor` `{}` — 截图编辑器区域，返回 `image` URL

**client / write**
- `operate_editor` `{ action:'open_file'|'switch_tab'|'close_tab'|'insert_text'|'replace_selection'|'set_content'|'save'|'set_panel'|'goto_line'|'run_ribbon', ... }`

**meta**
- `ask_user` — `scope:'client'`，由前端渲染提问卡；`parameters = { questions: Question[] }`

写操作（risk=write）服务端一律先校验 ownerKey 归属；`patch` 字段用于告诉前端刷新什么：`{ refresh?: 'cloud-files'|'instances'|'dataspace' }`。

### 3.1 浏览器端工具桥（编辑器）

`frontend/src/composables/useAiEditorBridge.ts`（D 拥有）导出：

```ts
export interface AiEditorBridge {
  available: Ref<boolean>;
  executeClientTool(name:string, args:any): Promise<{ ok:boolean; result?:string; image?:string }>;
}
/** LightEditor 调用：注册当前编辑器桥实现 */
export function provideAiEditorBridge(impl: Omit<AiEditorBridge,'available'>): void;
/** 任意 AI 面板调用：取桥；未注册时 available=false */
export function useAiEditorBridge(): AiEditorBridge;
```
`AiAssistantPanel`（C）在 `available=false` 时把客户端工具直接回 `{ok:false, result:'当前页面没有可操作的编辑器'}`。

## 4. 前端展示块契约（`frontend/src/components/ai/*`）

由 `useAiStream.ts` 产出，展示组件只读：

```ts
export interface AiTextBlock { type:'text'; text:string }
export interface AiReasoningBlock { type:'reasoning'; text:string; done:boolean; seconds?:number }
export interface AiToolBlock {
  type:'tool'; id:string; name:string; label:string; args:any;
  scope:'server'|'client'; risk:'read'|'write';
  status:'running'|'done'|'error'|'awaiting';
  summary?:string; result?:string; image?:string;
}
export interface AiAskBlock {
  type:'ask'; id:string; questions:AiQuestion[];
  status:'pending'|'answered'; answers?:string[];
}
export type AiBlock = AiTextBlock | AiReasoningBlock | AiToolBlock | AiAskBlock;
export interface AiTurn {
  id:string; role:'assistant'; blocks:AiBlock[];
  status:'streaming'|'waiting'|'done'|'error';
  error?:string; model?:string; reasoning?:string;
  startedAt:number; finishedAt?:number;
}
```

`useAiStream(opts)` 返回：
```ts
{
  turn: Ref<AiTurn|null>,      // 当前流式轮次
  isStreaming: Ref<boolean>,
  error: Ref<string|null>,
  start(): void,                                        // 新建空轮次
  run(body: {content:string; model?:string; reasoning?:string; session_id?:number|null}): Promise<void>,
  answerAsk(id:string, answers:string[]): void,          // 用户点了提问卡按钮；内部唤醒续跑
  stop(): void,
}
opts = {
  request: (action:'stream'|'resume', body:any) => Promise<Response>,
  onSessionId?: (id:number)=>void,
  onTitle?: (title:string, sessionId:number)=>void,
  onDone?: (turn:AiTurn, ev:{session_id:number; message_id:number; reply:string})=>void,
  onPatch?: (patch:any)=>void,        // 工具 patch，用于刷新文件/实例列表
  executeClientTool: (block:AiToolBlock)=>Promise<{ok:boolean; result?:string; image?:string}>,
}
/** 历史消息 → AiTurn（供会话切换后渲染，含工具卡/提问卡还原） */
export function parseStoredMessage(row:any): AiTurn
```

提问卡不需要外部 `askUser`：`await_user` 到达时该 `AiAskBlock.status='pending'`、`turn.status='waiting'`，
页面调用 `answerAsk(id, answers)` 后自动续跑。B 侧只需 `@answer-ask="(id, a) => stream.answerAsk(id, a)"`。

## 5. 模型 + 推理等级

- `GET /api/ai/models?action=list` 每项新增 `capabilities`：`{ thinking:boolean, reasoning_effort:boolean }`。
- `GET /api/ai/models?action=presets` 返回内置预设（DeepSeek 优先）：
```json
[{ "key":"deepseek-chat","label":"DeepSeek Chat","provider":"deepseek","model_id":"deepseek-chat",
   "levels":["auto","off","low","medium","high","max"],"default":"auto" }]
```
- 请求里 `reasoning` 取值 `auto|off|low|medium|high|max`。
- DeepSeek（OpenAI 格式）映射：
  - `off` → `thinking:{type:'disabled'}`，不带 `reasoning_effort`
  - `low|medium|high|max` → `thinking:{type:'enabled'}` + `reasoning_effort` 同名值
  - `auto` → 不传（服务端默认）
- 带 `tools` 时**必须回传历史 reasoning_content**，否则 DeepSeek 400。agent.js 负责保存并回填。
- 其它 provider 不支持时静默忽略。

## 6. 文件写作用域（避免冲突）

| 所有者 | 文件 |
|---|---|
| Lead | `docs/AI-assistant-v4-spec.md`, `schema.sql`, `server/lib/db.js`, `server/api/ai/chat.js`, `server/api/ai/agent.js`, `server/api/ai/runs.js`, `frontend/src/composables/useAiStream.ts`, `frontend/src/api/index.ts`, `_smoke_ai.js` |
| A 后端工具 | `server/api/ai/tools.js`, `server/api/ai/title.js`, `server/api/ai/models.js` |
| B 会话侧栏 | `frontend/src/views/ai/AiAssistantPage.vue`, `frontend/src/components/ai/SessionContextMenu.vue`, `frontend/src/components/ai/ModelPicker.vue` |
| C 消息展示 | `frontend/src/components/ai/AiTurnView.vue`, `AiToolCard.vue`, `AiAskCard.vue`, `AiReasoningBlock.vue`, `AiWaitIndicator.vue`, `frontend/src/components/editor/panels/AiAssistantPanel.vue` |
| D 编辑器桥接 | `frontend/src/composables/useAiEditorBridge.ts`, `frontend/src/utils/dom-screenshot.ts`, `frontend/src/components/editor/MonacoEditor.vue`, `frontend/src/components/editor/EditorPane.vue`, `frontend/src/views/editor/LightEditor.vue` |

## 7. 验收

- `_smoke_ai.js`：本地 mock OpenAI 兼容 SSE 服务 → 验证 token 逐段到达（首 token 早于完成 ≥300ms）、工具调用、客户端工具续跑、提问续跑、自动标题、reasoning 事件、置顶/重命名/删除。
- `pnpm --dir frontend build` 通过（vue-tsc 不阻塞，但 vite build 必须过）。
- 后端重启后 `GET /api/ai/chat?action=sessions` 正常。

---

# 实现状态（v4 落地记录）

## 验收结果

| 测试 | 命令 | 结果 |
|---|---|---|
| 协议/流式/工具/续跑/标题/会话操作/截图 | `node _smoke_ai.js`（内置 mock LLM，需后端已启动） | **45/45 通过** |
| 服务端工具层（云文件 / 实例 / 数据空间 / 用户信息） | `node _smoke_tools.js`（真实 `data/cses.db`，自动清理） | **42/42 通过** |
| 真实 DeepSeek 端到端（真流式 / 思考模式 / function calling） | `node _smoke_real_ai.js`（用库里已配置的模型，最小 token） | **16/16 通过** |
| 前端构建 | `pnpm --dir frontend build` | 通过 |

真实 DeepSeek 实测要点：
- 真流式：首个正文分段比整体结束早 100ms 以上（不是等服务端跑完再打字）。
- 思考模式：`thinking:{type:'enabled'}` + `reasoning_effort` 生效，`reasoning_content` 逐段变成前端 `reasoning` 事件（228 段）。
- 工具调用：模型真实发起 `list_cloud_files` 并正确总结用户真实云文件（3 个文件 + 1 个已分发实例）。
- 注意：deepseek-flash 对「3²+4²」这类极简问题会跳过思考（`reasoning_content` 为空串），这是模型行为；验证思考模式要用需要推理的问题。

## 运行时约定补充

- 服务端 `title` 事件现在也带 `session_id`；`done` 事件字段 `{ session_id, message_id, reply, title?, interrupted }`。
- `useAiStream.stop()` 会唤醒正在等待的提问卡（resolve 成空答案），避免 `run()` 悬挂导致发送按钮卡死。
- 演示/自定义模型若没配 API Key，服务端回落规则引擎（`reply.js`），前端 ModelPicker 会提示。

## 已知限制（非阻塞）

1. **截图**：纯浏览器 SVG `foreignObject` 方案实现，无新增依赖。Chromium/Edge/Electron 内核可用；旧 WebView / 页面 CSP 禁止 `data:` 图片时会返回 `ok:false` 明确文案（不会假成功、不会白屏）。截图宽度上限 1600px，元素内部滚动位置不保留，iframe/插件编辑器内部与 video 以占位块呈现。
2. **分享占位符**：其他用户分享过来的云文件在列表里是 `CSES_CLOUD_SHARE:{...}` 占位行，AI 工具对它只读并拒绝写操作（避免破坏分享关系）。
3. **绝对地址**：AI 返回的实例公开地址是相对路径（`/config/<组>/<名字>.yml`），未拼站点域名。
4. 插件编辑器（iframe）接管当前文件时，`insert_text` / `replace_selection` 返回 unsupported（提示先切「查看源文件」）。
5. 会话中断后历史里残留的 pending 提问卡点击无效答（没有 run_id 可续跑），会本地标记为已回答。

## 新增/修改文件一览

**后端**
- `server/api/ai/agent.js`（新）：SSE 通道、模型解析、推理参数映射、OpenAI 兼容流式解析、ReAct 循环、客户端工具/提问断点续跑、规则引擎兜底打字机。
- `server/api/ai/chat.js`（重写）：会话 CRUD（sessions/messages/rename/pin/clear/delete/generate-title）、`stream`、`resume`、`send`、`upload-shot`、`shot`，自动标题。
- `server/api/ai/runs.js`（新）：`ai_pending_runs` 断点存储（upsert/load/save/remove，2 小时过期）。
- `server/api/ai/reply.js`（新）：规则引擎兜底回复（从旧 chat.js 抽出）。
- `server/api/ai/tools.js`（新）：12 个服务端工具 + 4 个浏览器工具定义 + `ask_user`。
- `server/api/ai/title.js`（新）：`deriveTitle` / `generateTitle`。
- `server/api/ai/models.js`（改）：`capabilities`、`action=presets`、`reasoning` 字段。
- `schema.sql` / `server/lib/db.js`：`ai_chat_sessions` 新增 `pinned/pinned_at/title_generated/model/reasoning`，`ai_chat_messages` 新增 `meta`，新增 `ai_pending_runs` 表与增量迁移。

**前端**
- `views/ai/AiAssistantPage.vue`（改写）：置顶分组、会话/空白右键菜单、行内重命名、自动标题联动、AiTurnView 消息区、发送↔停止、ModelPicker。
- `components/ai/AiTurnView.vue` / `AiToolCard.vue` / `AiAskCard.vue` / `AiReasoningBlock.vue` / `AiWaitIndicator.vue`（新）：工具卡、DSH 式提问卡、思考折叠块、流式光标与等待动画。
- `components/ai/SessionContextMenu.vue` / `ModelPicker.vue`（新）。
- `components/editor/panels/AiAssistantPanel.vue`（改写）：编辑器内 AI 面板接入同一条流式与工具通道。
- `composables/useAiStream.ts`（新）：SSE → AiTurn/AiBlock 状态机、断点续跑、`parseStoredMessage`。
- `composables/useAiEditorBridge.ts` / `utils/dom-screenshot.ts`（新）：浏览器工具桥、无依赖 DOM 截图。
- `components/editor/MonacoEditor.vue` / `EditorPane.vue` / `views/editor/LightEditor.vue`（改）：选区/插入/替换/跳转等 expose、桥注册、云文件与实例列表刷新。
- `api/index.ts`（改）：`aiRequest`、`renameSession`、`pinSession`、`generateTitle`、`clearSession`、`uploadShot`、`presets`。

**测试脚本**：`_smoke_ai.js`、`_smoke_tools.js`、`_smoke_real_ai.js`。

