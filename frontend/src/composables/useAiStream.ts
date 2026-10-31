/**
 * AI 助理 —— 前端流式桥接
 *
 * 把服务端 SSE（docs/AI-assistant-v4-spec.md §1）还原成结构化的 AiTurn / AiBlock：
 *  - token 逐段进入正文块（真流式，不做事后假打字）
 *  - reasoning_content 进入可折叠的思考块
 *  - 工具调用卡片（server 直接执行 / client 由浏览器执行后带 run_id 续跑）
 *  - await_user 提问卡：answerAsk() 唤醒续跑
 *
 * 浏览器工具执行通过 opts.executeClientTool 注入（没有编辑器时返回失败即可）。
 */
import { ref, type Ref } from 'vue';

// ─────────────────────────── 类型 ───────────────────────────

export interface AiQuestion {
  header?: string;
  question: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

export interface AiTextBlock { type: 'text'; text: string }

export interface AiReasoningBlock {
  type: 'reasoning';
  text: string;
  done: boolean;
  seconds?: number;
}

export interface AiToolBlock {
  type: 'tool';
  id: string;
  name: string;
  label: string;
  args: any;
  scope: 'server' | 'client';
  risk: 'read' | 'write';
  status: 'running' | 'done' | 'error' | 'awaiting';
  summary?: string;
  result?: string;
  image?: string;
  ms?: number;
}

export interface AiAskBlock {
  type: 'ask';
  id: string;
  questions: AiQuestion[];
  status: 'pending' | 'answered';
  answers?: string[];
}

export type AiBlock = AiTextBlock | AiReasoningBlock | AiToolBlock | AiAskBlock;

/**
 * 「重试」保存下来的旧回答版本快照（存在消息 meta.alternatives 里）。
 * AiTurnView 会把它和当前版本一起做成切换器。
 */
export interface AiVariant {
  message_id?: number | string;
  content: string;
  blocks: AiBlock[];
  reasoning?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  model?: string;
  reasoning_level?: string;
  created_at?: string;
  interrupted?: boolean;
}

export interface AiTurn {
  id: string;
  role: 'assistant' | 'user';
  blocks: AiBlock[];
  status: 'streaming' | 'waiting' | 'done' | 'error';
  error?: string;
  model?: string;
  reasoning?: string;
  runId?: string;
  startedAt: number;
  finishedAt?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  interrupted?: boolean;
  /** 重试前的历史版本（0 条表示没有重试过） */
  alternatives?: AiVariant[];
  /** 这条 AI 回复是否有可切换的旧版本 */
  messageId?: number | string | null;
}

export interface AiClientToolResult {
  ok: boolean;
  result?: string;
  image?: string;
}

export interface AiStreamOptions {
  /** 发起流式请求：action='stream' 新回合 / 'resume' 续跑；signal 用于「停止生成」 */
  request: (action: 'stream' | 'resume', body: any, signal?: AbortSignal) => Promise<Response>;
  /** 服务端返回 session_id（新会话首条消息时） */
  onSessionId?: (id: number, turn: AiTurn) => void;
  /** 自动生成的会话标题 */
  onTitle?: (title: string, sessionId: number) => void;
  /** 回合正常结束 */
  onDone?: (turn: AiTurn, ev: { session_id: number; message_id: number; reply: string }) => void;
  /** 工具执行产生的刷新补丁（如 { refresh:'cloud-files' }） */
  onPatch?: (patch: any) => void;
  /** 执行浏览器端工具 */
  executeClientTool?: (block: AiToolBlock) => Promise<AiClientToolResult>;
  /** 当前页面是否有可操作的编辑器（决定是否允许模型调用浏览器工具） */
  hasEditor?: () => boolean;
}

export interface AiAttachmentRef {
  id: number;
  name?: string;
}

export interface AiRunBody {
  content: string;
  model?: string;
  reasoning?: string;
  session_id?: number | null;
  scope?: string;
  scope_ref?: number | null;
  /** 传了就进入「重试」模式：服务端会删掉该 AI 回复及其后文，用上一条用户消息重新生成 */
  retry_message_id?: number | null;
  /** 上传附件（服务端已解析过文本的 id 列表） */
  attachments?: AiAttachmentRef[];
}

export interface AiStreamApi {
  turn: Ref<AiTurn | null>;
  isStreaming: Ref<boolean>;
  error: Ref<string | null>;
  start: () => AiTurn;
  run: (body: AiRunBody) => Promise<AiTurn>;
  /** 重试某条 AI 回复（旧回复会作为可切换版本保留） */
  retry: (body: { session_id: number; retry_message_id: number; model?: string; reasoning?: string }) => Promise<AiTurn>;
  answerAsk: (id: string, answers: string[]) => void;
  stop: () => void;
}

// ─────────────────────────── 小工具 ───────────────────────────

let uid = 0;
function nextId(prefix = 't') {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${uid}`;
}

function now() {
  return Date.now();
}

/** 追加正文（合并到上一个 text 块） */
function appendText(turn: AiTurn, delta: string) {
  if (!delta) return;
  const last = turn.blocks[turn.blocks.length - 1];
  if (last && last.type === 'text') last.text += delta;
  else turn.blocks.push({ type: 'text', text: delta });
}

function appendReasoning(turn: AiTurn, delta: string) {
  if (!delta) return;
  const last = turn.blocks[turn.blocks.length - 1];
  if (last && last.type === 'reasoning' && !last.done) last.text += delta;
  else turn.blocks.push({ type: 'reasoning', text: delta, done: false });
}

function closeReasoning(turn: AiTurn) {
  for (let i = turn.blocks.length - 1; i >= 0; i -= 1) {
    const b = turn.blocks[i];
    if (b.type === 'reasoning') {
      if (!b.done) {
        b.done = true;
        b.seconds = Math.max(1, Math.round((now() - turn.startedAt) / 1000));
      }
      break;
    }
    if (b.type === 'text') break;
  }
}

function findTool(turn: AiTurn, id: string): AiToolBlock | undefined {
  for (const b of turn.blocks) {
    if (b.type === 'tool' && b.id === id) return b;
  }
  return undefined;
}

function findAsk(turn: AiTurn, id: string): AiAskBlock | undefined {
  for (const b of turn.blocks) {
    if (b.type === 'ask' && b.id === id) return b;
  }
  return undefined;
}

// ─────────────────────────── 历史消息还原 ───────────────────────────

/** 服务端 meta.blocks 里的一条 → 展示用 AiBlock（无法识别返回 null） */
function normalizeStoredBlock(b: any): AiBlock | null {
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'text') return { type: 'text', text: String(b.text ?? '') };
  if (b.type === 'reasoning') {
    return { type: 'reasoning', text: String(b.text ?? ''), done: true, seconds: b.seconds };
  }
  if (b.type === 'tool') {
    return {
      type: 'tool',
      id: String(b.id ?? nextId('h')),
      name: String(b.name ?? ''),
      label: String(b.label ?? b.name ?? '工具'),
      args: b.args ?? {},
      scope: b.scope === 'client' ? 'client' : 'server',
      risk: b.risk === 'write' ? 'write' : 'read',
      status: b.status === 'error' ? 'error' : 'done',
      summary: b.summary,
      result: b.result,
      image: b.image,
      ms: b.ms,
    };
  }
  if (b.type === 'ask') {
    return {
      type: 'ask',
      id: String(b.id ?? nextId('h')),
      questions: Array.isArray(b.questions) ? b.questions : [],
      status: 'answered',
      answers: Array.isArray(b.answers) ? b.answers : [],
    };
  }
  return null;
}

/**
 * 把 GET action=messages 返回的一行还原成 AiTurn（含工具卡/提问卡）
 */
export function parseStoredMessage(row: any): AiTurn {
  const role: 'assistant' | 'user' = row?.role === 'user' ? 'user' : 'assistant';
  const meta = row?.meta || {};
  const blocks: AiBlock[] = [];
  if (Array.isArray(meta.blocks)) {
    for (const b of meta.blocks) {
      const normalized = normalizeStoredBlock(b);
      if (normalized) blocks.push(normalized);
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: String(row?.content ?? '') });
  }
  return {
    id: String(row?.id ?? nextId('h')),
    role,
    blocks,
    status: 'done',
    startedAt: 0,
    model: meta.model,
    reasoning: meta.reasoning_level,
    usage: meta.usage || null,
    interrupted: !!meta.interrupted,
    messageId: row?.id ?? null,
    // 重试前的历史版本（服务端存在 meta.alternatives）
    alternatives: Array.isArray(meta.alternatives)
      ? meta.alternatives.map((v: any) => ({
        message_id: v?.message_id,
        content: String(v?.content ?? ''),
        blocks: Array.isArray(v?.blocks)
          ? v.blocks.map((b: any) => normalizeStoredBlock(b)).filter(Boolean)
          : [],
        reasoning: String(v?.reasoning ?? ''),
        usage: v?.usage || null,
        model: String(v?.model ?? ''),
        reasoning_level: String(v?.reasoning_level ?? ''),
        created_at: String(v?.created_at ?? ''),
        interrupted: !!v?.interrupted,
      }))
      : [],
  };
}

// ─────────────────────────── 流式桥接 ───────────────────────────

export function useAiStream(opts: AiStreamOptions): AiStreamApi {
  const turn = ref<AiTurn | null>(null) as Ref<AiTurn | null>;
  const isStreaming = ref(false);
  const error = ref<string | null>(null);

  let abortCtl: AbortController | null = null;
  let pendingAsk: { id: string; resolve: (answers: string[]) => void } | null = null;
  /** 早于 run() 注册就到达的答案（避免提交竞态导致悬挂） */
  let pendingAnswer: { id: string; answers: string[] } | null = null;
  let stoppedByUser = false;

  function start(): AiTurn {
    stoppedByUser = false;
    pendingAsk = null;
    pendingAnswer = null;
    error.value = null;
    const t: AiTurn = {
      id: nextId('turn'),
      role: 'assistant',
      blocks: [],
      status: 'streaming',
      startedAt: now(),
    };
    turn.value = t;
    // 关键：必须返回 ref 内部的 reactive 代理，而不是原始对象 t。
    // 直接改原始对象不会经过 Proxy 的 set 拦截，Vue 不会 trigger 视图更新，
    // 表现就是「SSE 数据到了、对象也更新了，但界面一直不动，直到流结束才整段出现」。
    return turn.value as AiTurn;
  }

  /** 处理一条 SSE 事件；返回 true 表示本轮需要挂起等待（客户端工具/提问） */
  function handleEvent(t: AiTurn, ev: any): { wait: 'tool' | 'ask' | null; awaitBlock?: any } {
    if (!ev || typeof ev !== 'object') return { wait: null };

    switch (ev.type) {
      case 'start': {
        if (ev.session_id) {
          t.runId = ev.run_id;
          t.model = ev.model;
          t.reasoning = ev.reasoning;
          opts.onSessionId?.(Number(ev.session_id), t);
        }
        break;
      }
      case 'reasoning': {
        appendReasoning(t, String(ev.delta ?? ''));
        break;
      }
      case 'text': {
        closeReasoning(t);
        appendText(t, String(ev.delta ?? ev.token ?? ''));
        break;
      }
      case 'tool_start': {
        closeReasoning(t);
        t.blocks.push({
          type: 'tool',
          id: String(ev.id),
          name: String(ev.name ?? ''),
          label: String(ev.label ?? ev.name ?? '工具'),
          args: ev.args ?? {},
          scope: ev.scope === 'client' ? 'client' : 'server',
          risk: ev.risk === 'write' ? 'write' : 'read',
          status: 'running',
        });
        break;
      }
      case 'tool_end': {
        const block = findTool(t, String(ev.id));
        if (block) {
          block.status = ev.ok ? 'done' : 'error';
          block.summary = ev.summary;
          if (ev.result !== undefined) block.result = ev.result;
          if (ev.image) block.image = ev.image;
          if (ev.ms !== undefined) block.ms = ev.ms;
        } else {
          t.blocks.push({
            type: 'tool',
            id: String(ev.id),
            name: '',
            label: '工具执行',
            args: {},
            scope: 'server',
            risk: 'read',
            status: ev.ok ? 'done' : 'error',
            summary: ev.summary,
            result: ev.result,
            image: ev.image,
          });
        }
        break;
      }
      case 'await_tool': {
        closeReasoning(t);
        t.blocks.push({
          type: 'tool',
          id: String(ev.id),
          name: String(ev.name ?? ''),
          label: String(ev.label ?? ev.name ?? '工具'),
          args: ev.args ?? {},
          scope: 'client',
          risk: ev.risk === 'write' ? 'write' : 'read',
          status: 'awaiting',
        });
        return { wait: 'tool', awaitBlock: { id: String(ev.id), name: String(ev.name ?? ''), args: ev.args ?? {} } };
      }
      case 'await_user': {
        closeReasoning(t);
        const questions: AiQuestion[] = Array.isArray(ev.questions) ? ev.questions : [];
        t.blocks.push({
          type: 'ask',
          id: String(ev.id),
          questions,
          status: 'pending',
        });
        return { wait: 'ask', awaitBlock: { id: String(ev.id) } };
      }
      case 'patch': {
        try { opts.onPatch?.(ev.patch); } catch (_) { /* ignore */ }
        break;
      }
      case 'title': {
        if (ev.title) opts.onTitle?.(String(ev.title), Number(ev.session_id || t.id));
        break;
      }
      case 'usage': {
        t.usage = {
          prompt_tokens: ev.prompt_tokens ?? ev.usage?.prompt_tokens,
          completion_tokens: ev.completion_tokens ?? ev.usage?.completion_tokens,
        };
        break;
      }
      case 'error': {
        t.error = String(ev.message ?? '未知错误');
        break;
      }
      case 'waiting': {
        if (ev.run_id) t.runId = ev.run_id;
        break;
      }
      case 'done': {
        t.status = t.error ? 'error' : 'done';
        t.finishedAt = now();
        t.interrupted = !!ev.interrupted;
        closeReasoning(t);
        if (ev.reply !== undefined && ev.reply !== '' && !t.blocks.some((b) => b.type === 'text' && b.text)) {
          appendText(t, String(ev.reply));
        }
        try {
          opts.onDone?.(t, {
            session_id: Number(ev.session_id || 0),
            message_id: Number(ev.message_id || 0),
            reply: String(ev.reply ?? ''),
          });
        } catch (_) { /* ignore */ }
        break;
      }
      default:
        break;
    }
    return { wait: null };
  }

  /**
   * 读取一次 SSE 响应直到结束
   * @returns 挂起信息（需要客户端继续时）
   */
  async function consume(t: AiTurn, action: 'stream' | 'resume', body: any): Promise<{ wait: 'tool' | 'ask' | null; awaitBlock?: any; failure?: string }> {
    abortCtl = new AbortController();
    let resp: Response;
    try {
      resp = await opts.request(action, body, abortCtl.signal);
    } catch (e: any) {
      if (stoppedByUser) return { wait: null };
      throw new Error('无法连接 AI 服务：' + (e?.message || e));
    }
    if (!resp.ok) {
      let msg = 'HTTP ' + resp.status;
      try {
        const txt = await resp.text();
        const json = JSON.parse(txt);
        if (json?.message) msg = json.message;
      } catch (_) { /* ignore */ }
      if (resp.status === 410) msg = '会话已中断，请重新发送消息';
      return { wait: null, failure: msg };
    }
    const reader = resp.body?.getReader();
    if (!reader) return { wait: null, failure: '浏览器不支持流式读取' };

    const decoder = new TextDecoder();
    let buffer = '';
    let wait: 'tool' | 'ask' | null = null;
    let awaitBlock: any = null;
    let sawDone = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          let ev: any;
          try { ev = JSON.parse(data); } catch (_) { continue; }
          const r = handleEvent(t, ev);
          if (ev.type === 'done') sawDone = true;
          if (r.wait) {
            wait = r.wait;
            awaitBlock = r.awaitBlock;
            t.status = 'waiting';
          }
        }
      }
    } catch (e: any) {
      if (!stoppedByUser) {
        // 网络中断：保留已收到的内容
        t.error = t.error || ('连接中断：' + (e?.message || e));
      }
    } finally {
      try { reader.releaseLock(); } catch (_) { /* ignore */ }
    }

    if (t.status === 'waiting' && wait) {
      // 服务端已经收尾，前端继续执行
      return { wait, awaitBlock };
    }
    if (!sawDone && !stoppedByUser) {
      if (t.status !== 'error') t.status = t.error ? 'error' : 'done';
    }
    if (!t.finishedAt) t.finishedAt = now();
    return { wait: null };
  }

  /**
   * 等待用户回答提问卡。
   * 兼容三种时序，避免 run() 悬挂：
   *  1) 正常：先注册，后 answerAsk；
   *  2) 提前：answerAsk 在注册前就到了（缓存里取）；
   *  3) 中止：注册前用户已点停止（直接返回空答案）。
   */
  function waitForAsk(id: string): Promise<string[]> {
    if (stoppedByUser) return Promise.resolve([]);
    if (pendingAnswer && pendingAnswer.id === id) {
      const answers = pendingAnswer.answers;
      pendingAnswer = null;
      return Promise.resolve(answers);
    }
    return new Promise((resolve) => {
      pendingAsk = { id, resolve };
      // 注册瞬间被 stop() 抢先的极端竞态
      if (stoppedByUser) {
        pendingAsk = null;
        resolve([]);
      }
    });
  }

  function answerAsk(id: string, answers: string[]) {
    const t = turn.value;
    if (t) {
      const block = findAsk(t, id);
      if (block) {
        block.status = 'answered';
        block.answers = answers;
      }
    }
    if (pendingAsk && pendingAsk.id === id) {
      const resolve = pendingAsk.resolve;
      pendingAsk = null;
      resolve(answers);
    } else {
      // 提问卡还没被 run() 等待（时序提前），先缓存答案
      pendingAnswer = { id, answers };
    }
  }

  async function run(body: AiRunBody): Promise<AiTurn> {
    const t = start();
    isStreaming.value = true;
    let action: 'stream' | 'resume' = 'stream';
    let reqBody: any = {
      content: body.content,
      model: body.model || 'default',
      reasoning: body.reasoning || 'auto',
      session_id: body.session_id ?? null,
      scope: body.scope || 'global',
      scope_ref: body.scope_ref ?? null,
      has_editor: !!opts.hasEditor?.(),
    };
    if (body.retry_message_id) reqBody.retry_message_id = body.retry_message_id;
    if (Array.isArray(body.attachments) && body.attachments.length) {
      reqBody.attachments = body.attachments.map((a) => ({ id: a.id, name: a.name || '' }));
    }

    try {
      for (;;) {
        const outcome = await consume(t, action, reqBody);
        if (outcome.failure) {
          t.error = t.error || outcome.failure;
          t.status = 'error';
          error.value = outcome.failure;
          break;
        }
        if (!outcome.wait) break;

        if (outcome.wait === 'ask') {
          const answers = await waitForAsk(outcome.awaitBlock.id);
          if (stoppedByUser) break;
          t.status = 'streaming';
          action = 'resume';
          reqBody = {
            run_id: t.runId,
            results: [{
              id: outcome.awaitBlock.id,
              ok: true,
              answers,
              result: answers.join('；'),
            }],
          };
          continue;
        }

        // 浏览器工具：本机执行后回传
        const block = findTool(t, outcome.awaitBlock.id);
        if (block) block.status = 'running';
        t.status = 'streaming';
        let result: AiClientToolResult;
        try {
          if (!opts.executeClientTool) throw new Error('当前页面不支持浏览器工具');
          result = await opts.executeClientTool({
            type: 'tool',
            id: outcome.awaitBlock.id,
            name: outcome.awaitBlock.name,
            label: outcome.awaitBlock.name,
            args: outcome.awaitBlock.args,
            scope: 'client',
            risk: block?.risk || 'read',
            status: 'running',
          });
        } catch (e: any) {
          result = { ok: false, result: '工具执行失败：' + (e?.message || e) };
        }
        if (stoppedByUser) break;
        if (block) {
          block.status = result.ok ? 'done' : 'error';
          block.summary = result.result || (result.ok ? '完成' : '失败');
          if (result.image) block.image = result.image;
        }
        action = 'resume';
        reqBody = {
          run_id: t.runId,
          results: [{
            id: outcome.awaitBlock.id,
            ok: !!result.ok,
            result: result.result || '',
            image: result.image || undefined,
          }],
        };
      }
    } catch (e: any) {
      t.error = e?.message || '请求失败';
      t.status = 'error';
      error.value = t.error || null;
    } finally {
      isStreaming.value = false;
      abortCtl = null;
      closeReasoning(t);
      if (t.status === 'streaming') t.status = t.error ? 'error' : 'done';
      if (!t.finishedAt) t.finishedAt = now();
      if (!error.value && t.error) error.value = t.error;
    }
    return t;
  }

  /**
   * 重试某条 AI 回复：服务端会丢弃该回复（及其后文），用同一条用户消息重新生成；
   * 旧回复会作为 `alternatives` 存进新消息的 meta，前端可切换查看。
   */
  async function retry(body: { session_id: number; retry_message_id: number; model?: string; reasoning?: string }): Promise<AiTurn> {
    return run({
      content: '',
      session_id: body.session_id,
      retry_message_id: body.retry_message_id,
      model: body.model,
      reasoning: body.reasoning,
    });
  }

  function stop() {
    stoppedByUser = true;
    try { abortCtl?.abort(); } catch (_) { /* ignore */ }
    // 正在等待用户回答时被停止：必须唤醒 waitForAsk，否则 run() 会永久悬挂
    if (pendingAsk) {
      const { id, resolve } = pendingAsk;
      pendingAsk = null;
      try { resolve([]); } catch (_) { /* ignore */ }
      const t0 = turn.value;
      if (t0) {
        const ask = findAsk(t0, id);
        if (ask) ask.answers = [];
      }
    }
    const t = turn.value;
    if (t) {
      t.interrupted = true;
      if (t.status !== 'error') t.status = 'done';
      t.finishedAt = t.finishedAt || now();
      closeReasoning(t);
    }
    isStreaming.value = false;
  }

  return { turn, isStreaming, error, start, run, retry, answerAsk, stop };
}
