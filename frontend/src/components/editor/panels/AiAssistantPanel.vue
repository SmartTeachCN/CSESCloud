<template>
  <div class="ai-panel">
    <div class="ai-header">
      <div class="ai-title">
        <Icon icon="ri-brain-line" :size="14" />
        <span>AI 助理</span>
        <span v-if="isStreaming" class="live-dot" title="正在生成"></span>
      </div>
      <div class="ai-header-actions">
        <button class="header-btn" @click="startNewSession" title="新会话">
          <Icon icon="ri-add-line" :size="14" />
        </button>
        <button class="header-btn" @click="openFullScreen" title="全屏模式">
          <Icon icon="ri-external-link-line" :size="14" />
        </button>
      </div>
    </div>

    <div class="ai-messages" ref="messagesEl">
      <div v-if="items.length === 0 && !shownLive" class="ai-empty">
        <Icon icon="ri-chat-3-line" :size="32" />
        <p>{{ emptyHint }}</p>
      </div>

      <template v-for="item in items" :key="item.key">
        <div v-if="item.role === 'user'" class="ai-msg user">
          <div class="msg-avatar">
            <Icon icon="ri-user-line" :size="14" />
          </div>
          <div class="msg-content user-md" v-html="renderUserMarkdown(item.content || '')"></div>
        </div>
        <div v-else-if="item.turn" class="ai-msg assistant">
          <div class="msg-avatar">
            <Icon icon="ri-robot-line" :size="14" />
          </div>
          <div class="turn-body">
            <AiTurnView :turn="item.turn" :live="false" @answer-ask="onAnswerAsk" />
          </div>
        </div>
      </template>

      <div v-if="shownLive" class="ai-msg assistant">
        <div class="msg-avatar">
          <Icon icon="ri-robot-line" :size="14" />
        </div>
        <div class="turn-body">
          <AiTurnView :turn="shownLive" live @answer-ask="onAnswerAsk" />
        </div>
      </div>
    </div>

    <!-- 对话框控件（模型/语音） -->
    <div class="ai-controls">
      <CustomSelect
        v-model="selectedModel"
        :options="panelModelOptions"
        class="ctrl-select-custom"
        height="26px"
      />
      <button
        class="ctrl-btn"
        :class="{ recording: isVoiceRecording }"
        @click="toggleVoice"
        title="语音输入"
      >
        <Icon :icon="isVoiceRecording ? 'ri-stop-circle-fill' : 'ri-mic-line'" :size="14" />
      </button>
    </div>

    <div class="ai-input-area">
      <textarea
        v-model="input"
        class="ai-input"
        :placeholder="isStreaming ? '正在生成回复…' : '输入问题（Enter 发送，Shift+Enter 换行）'"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button
        v-if="isStreaming"
        class="ai-send stop"
        title="停止生成"
        @click="stopStream"
      >
        <Icon icon="ri-stop-fill" :size="14" />
      </button>
      <button
        v-else
        class="ai-send"
        :disabled="sending || !input.trim()"
        :title="sending ? '正在收尾上一轮…' : '发送'"
        @click="send"
      >
        <Icon icon="ri-send-plane-line" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';
import CustomSelect from '../../CustomSelect.vue';
import AiTurnView from '../../ai/AiTurnView.vue';
import { aiApi } from '../../../api';
import {
  useAiStream,
  parseStoredMessage,
  type AiTurn,
} from '../../../composables/useAiStream';
import { useAiEditorBridge } from '../../../composables/useAiEditorBridge';

marked.use({ breaks: true, gfm: true });

const props = defineProps<{
  scope: string;
  scopeRef?: number;
  editorContext?: {
    fileName?: string;
    fileContent?: string;
    language?: string;
    selection?: string;
  };
}>();

const emit = defineEmits<{
  (e: 'applyEdit', payload: { content: string; replaceAll?: boolean }): void;
  (e: 'refresh-cloud-files'): void;
  (e: 'refresh-instances'): void;
}>();

const router = useRouter();

/** 已提交到列表的消息（用户消息 + 已结束/历史 AI 回合） */
interface PanelItem {
  key: string;
  role: 'user' | 'assistant';
  content?: string;
  turn?: AiTurn;
}

const input = ref('');
const items = ref<PanelItem[]>([]);
const sessionId = ref<number | null>(null);
const messagesEl = ref<HTMLElement | null>(null);
/** 一轮 send() 是否还在执行（stop() 之后仍可能短暂为 true，用于防止旧 run 未收尾时开新 run） */
const sending = ref(false);

// 控件
const selectedModel = ref('default');
const isVoiceRecording = ref(false);
const customModels = ref<any[]>([]);
let recognition: any = null;

const emptyHint = computed(() => '向 AI 助理提问（可结合当前文件上下文）');

const panelModelOptions = computed(() => {
  const opts = [{ value: 'default', label: '默认', icon: 'ri-brain-line' }];
  for (const m of customModels.value) {
    opts.push({ value: m.name, label: m.name, icon: 'ri-cpu-line' });
  }
  return opts;
});

// ===== 编辑器桥（客户端工具执行通道） =====
const editorBridge = useAiEditorBridge();

const NO_EDITOR = '当前页面没有可操作的编辑器';

// ===== 流式桥接 =====
const stream = useAiStream({
  request: (action, body, signal) => aiApi.aiRequest(action, body, signal),
  onSessionId: (id) => {
    sessionId.value = id;
  },
  onPatch: (patch) => {
    const refresh = typeof patch === 'string' ? patch : patch && typeof patch === 'object' ? patch.refresh : null;
    if (refresh === 'cloud-files') emit('refresh-cloud-files');
    else if (refresh === 'instances') emit('refresh-instances');
  },
  executeClientTool: async (block) => {
    if (!editorBridge.available.value) return { ok: false, result: NO_EDITOR };
    try {
      return await editorBridge.executeClientTool(block.name, block.args);
    } catch (e: any) {
      return { ok: false, result: '编辑器操作失败：' + (e?.message || e) };
    }
  },
  hasEditor: () => editorBridge.available.value,
});

const isStreaming = computed(() => stream.isStreaming.value);

/** 已从列表移除、不应再展示的回合 id（useAiStream 结束后 turn 仍保留在 ref 上） */
const suppressedTurnIds = ref<string[]>([]);

/** 直播中的回合：还没提交到 items 的当前 turn */
const shownLive = computed<AiTurn | null>(() => {
  const turn = stream.turn.value;
  if (!turn) return null;
  if (suppressedTurnIds.value.includes(turn.id)) return null;
  if (items.value.some((it) => it.turn && it.turn.id === turn.id)) return null;
  return turn;
});

/** 提交回合快照到消息列表（深拷贝，避免后续流式/复用修改历史） */
function commitTurn(turn: AiTurn | null) {
  if (!turn || !Array.isArray(turn.blocks)) return;
  let snapshot: AiTurn;
  try {
    snapshot = JSON.parse(JSON.stringify(turn));
  } catch {
    snapshot = { ...turn };
  }
  snapshot.startedAt = snapshot.startedAt || Date.now();
  const idx = items.value.findIndex((it) => it.turn && it.turn.id === snapshot.id);
  if (idx >= 0) {
    items.value[idx] = { ...items.value[idx], turn: snapshot };
  } else {
    items.value.push({ key: 'turn_' + snapshot.id, role: 'assistant', turn: snapshot });
  }
}

// ===== 会话加载 =====
function rowToItem(row: any, index: number): PanelItem | null {
  if (!row) return null;
  const id = row.id ?? row._id ?? `h${index}`;
  const role = row.role === 'user' ? 'user' : 'assistant';
  if (role === 'user') {
    return { key: `user_${id}_${index}`, role: 'user', content: String(row.content ?? '') };
  }
  let turn: AiTurn;
  try {
    turn = parseStoredMessage(row);
  } catch {
    turn = {
      id: String(id),
      role: 'assistant',
      blocks: [{ type: 'text', text: String(row.content ?? '') }],
      status: 'done',
      startedAt: 0,
    };
  }
  return { key: `turn_${id}_${index}`, role: 'assistant', turn };
}

async function loadSession() {
  try {
    const sessions = await aiApi.listSessions(props.scope);
    if (sessions && sessions.length > 0) {
      sessionId.value = sessions[0].id;
      const rows = await aiApi.listMessages(sessionId.value);
      items.value = (rows || [])
        .map((row: any, i: number) => rowToItem(row, i))
        .filter((it: PanelItem | null): it is PanelItem => !!it);
      scrollToBottom(true);
    }
  } catch {
    // 静默忽略：无历史 / 接口不可用时保持空列表
  }
}

// 会话代际：点「新会话」后，之前尚未结束的 run 不允许再把结果提交回列表
let runGeneration = 0;

function startNewSession() {
  runGeneration += 1;
  const current = stream.turn.value;
  if (current) {
    suppressedTurnIds.value = [...suppressedTurnIds.value, current.id];
    releasePendingAsk(current);
  }
  stream.stop();
  sessionId.value = null;
  items.value = [];
  input.value = '';
}

/**
 * 若当前回合停在提问卡上，先把挂起的 run 解开。
 * useAiStream 的 waitForAsk() 只有 answerAsk() 会 resolve；不清掉的话，
 * 被 stop()/新会话打断的 run 会永远挂在 await 上（Promise 泄漏）。
 * answerAsk 之后 stop() 置 stoppedByUser，续跑循环会在检查处直接退出，不会发 resume 请求。
 */
function releasePendingAsk(turn: AiTurn) {
  const blocks = Array.isArray(turn.blocks) ? turn.blocks : [];
  const pending = blocks.find((b) => b.type === 'ask' && b.status === 'pending');
  if (pending && pending.type === 'ask') stream.answerAsk(pending.id, []);
}

// ===== 全屏切换 =====
function openFullScreen() {
  if (sessionId.value) {
    sessionStorage.setItem('ai_active_session', String(sessionId.value));
  }
  router.push('/console/ai');
}

// ===== 语音输入 =====
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    return;
  }
  if (isVoiceRecording.value) {
    if (recognition) recognition.stop();
    isVoiceRecording.value = false;
    return;
  }
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript;
    input.value += (input.value ? '\n' : '') + transcript;
    isVoiceRecording.value = false;
  };
  recognition.onerror = () => { isVoiceRecording.value = false; };
  recognition.onend = () => { isVoiceRecording.value = false; };
  recognition.start();
  isVoiceRecording.value = true;
}

// ===== 构造带编辑器上下文的消息 =====
function buildFullContent(content: string): string {
  if (!props.editorContext) return content;
  const ctx = props.editorContext;
  const ctxParts: string[] = [];
  if (ctx.fileName) ctxParts.push(`当前文件: ${ctx.fileName}`);
  if (ctx.language) ctxParts.push(`语言: ${ctx.language}`);
  if (ctx.selection) ctxParts.push(`选中内容:\n\`\`\`\n${ctx.selection}\n\`\`\``);
  else if (ctx.fileContent) ctxParts.push(`文件内容:\n\`\`\`\n${ctx.fileContent}\n\`\`\``);
  if (ctxParts.length === 0) return content;
  return `[编辑器上下文]\n${ctxParts.join('\n')}\n\n[用户问题]\n${content}`;
}

// ===== 发送 / 停止 =====
async function send() {
  const content = input.value.trim();
  if (!content || sending.value || stream.isStreaming.value) return;
  input.value = '';
  sending.value = true;

  items.value.push({
    key: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content,
  });
  scrollToBottom(true);

  const gen = ++runGeneration;
  try {
    const turn = await stream.run({
      content: buildFullContent(content),
      model: selectedModel.value === 'default' ? undefined : selectedModel.value,
      session_id: sessionId.value,
      scope: props.scope,
      scope_ref: props.scopeRef ?? null,
    });
    // 期间点了「新会话」：丢弃这一轮，避免旧回合被提交进新会话列表
    if (gen !== runGeneration) return;
    commitTurn(turn);
  } catch {
    if (gen !== runGeneration) return;
    // useAiStream 内部会落 turn.error；这里只兜底极端情况
    commitTurn(stream.turn.value);
  } finally {
    sending.value = false;
    scrollToBottom();
  }
}

function stopStream() {
  const turn = stream.turn.value;
  if (turn) releasePendingAsk(turn);
  stream.stop();
}

// ===== 提问卡 =====
function onAnswerAsk(id: string, answers: string[]) {
  const turn = stream.turn.value;
  if (!turn) return;
  const blocks = Array.isArray(turn.blocks) ? turn.blocks : [];
  const liveAsk = blocks.some(
    (b) => b.type === 'ask' && b.id === id && b.status === 'pending'
  );
  if (!liveAsk) return;
  stream.answerAsk(id, answers);
  scrollToBottom();
}

// ===== 滚动 =====
function scrollToBottom(force = false) {
  nextTick(() => {
    const el = messagesEl.value;
    if (!el) return;
    if (!force) {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance > 120) return;
    }
    el.scrollTop = el.scrollHeight;
  });
}

/** 流式增量信号：长度/状态变化时自动贴底 */
const scrollSignal = computed(() => {
  const turn = shownLive.value;
  const blocks = turn && Array.isArray(turn.blocks) ? turn.blocks : [];
  const size = blocks.reduce(
    (n, b: any) => n + (b.text?.length || 0) + (b.result?.length || 0) + (b.summary?.length || 0),
    0
  );
  return `${items.value.length}|${size}|${turn?.status || ''}`;
});
watch(scrollSignal, () => scrollToBottom(), { flush: 'post' });

// ===== 用户消息 markdown（基础 XSS 防护） =====
function renderUserMarkdown(text: string): string {
  if (!text) return '';
  let html: string;
  try {
    html = marked.parse(text, { breaks: true, gfm: true }) as string;
  } catch {
    html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return sanitizeHtml(html);
}

function sanitizeHtml(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*javascript:[^\s>]*/gi, '$1="#"');
}

// ===== 加载自定义模型 =====
async function loadCustomModels() {
  try {
    const list = await aiApi.listModels();
    customModels.value = list || [];
  } catch {
    customModels.value = [];
  }
}

onMounted(() => {
  loadSession();
  loadCustomModels();
});
</script>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--layer-default);
}

.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.ai-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.live-dot {
  width: 6px;
  height: 6px;
  margin-left: 2px;
  border-radius: var(--radius-full);
  background: var(--accent-base);
  animation: ai-live-pulse 1.4s ease-in-out infinite;
}

.ai-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.header-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.header-btn:hover {
  background: var(--subtle-secondary);
  color: var(--accent-base);
}

/* 控件行 */
.ai-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px var(--spacer-2);
  border-bottom: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
  flex-shrink: 0;
}

/* CustomSelect 面板版 */
.ctrl-select-custom {
  margin-left: auto;
  min-width: 80px;
  max-width: 140px;
}

.ctrl-select-custom .select-trigger {
  font-size: 11px;
  height: 26px;
  padding: 0 6px;
}

.ctrl-select-custom .trigger-arrow {
  font-size: 12px;
}

.ctrl-select-custom .select-dropdown {
  font-size: 11px;
}

.ctrl-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.ctrl-btn:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.ctrl-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.ctrl-btn.recording {
  background: var(--status-error);
  border-color: var(--status-error);
  color: white;
  animation: ai-live-pulse 1.5s ease-in-out infinite;
}

/* 消息区域 */
.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-2);
  scrollbar-width: thin;
}

.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  gap: var(--spacer-2);
}

.ai-empty p {
  font-size: var(--font-size-xs);
}

.ai-msg {
  display: flex;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-3);
}

.msg-avatar {
  width: 24px;
  height: 24px;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.ai-msg.user .msg-avatar {
  background: var(--accent-base);
  color: var(--accent-text);
}

.ai-msg.assistant .msg-avatar {
  background: var(--subtle-pressed);
  color: var(--text-primary);
  border: 1px solid var(--divider-stroke);
}

.turn-body {
  min-width: 0;
  flex: 1;
  padding-top: 1px;
}

.msg-content {
  max-width: calc(100% - 32px);
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  word-break: break-word;
}

.ai-msg.user .msg-content {
  background: var(--accent-base);
  color: var(--accent-text);
}

/* 用户消息里的 Markdown */
.user-md :deep(p) { margin: 0 0 0.3em; }
.user-md :deep(p:last-child) { margin-bottom: 0; }
.user-md :deep(code) {
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 0.92em;
}
.user-md :deep(pre) {
  margin: 0.3em 0;
  padding: 8px;
  background: rgba(255, 255, 255, 0.16);
  border-radius: var(--radius-xs);
  overflow-x: auto;
}
.user-md :deep(pre code) { padding: 0; background: transparent; }
.user-md :deep(ul), .user-md :deep(ol) { margin: 0.2em 0; padding-left: 1.2em; }
.user-md :deep(blockquote) {
  margin: 0.3em 0;
  padding: 0.1em 0.5em;
  border-left: 2px solid rgba(255, 255, 255, 0.5);
}
.user-md :deep(a) { color: inherit; text-decoration: underline; }
.user-md :deep(img) { max-width: 100%; border-radius: var(--radius-xs); }
.user-md :deep(table) { border-collapse: collapse; }
.user-md :deep(th), .user-md :deep(td) {
  padding: 3px 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

/* 输入区 */
.ai-input-area {
  display: flex;
  border-top: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
}

.ai-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  padding: var(--spacer-2) var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  resize: none;
  min-height: 44px;
  max-height: 80px;
  font-family: inherit;
}

.ai-input::placeholder {
  color: var(--text-tertiary);
}

.ai-send {
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-base);
  border: none;
  color: var(--accent-text);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.ai-send:hover {
  background: var(--accent-hover);
}

.ai-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-send.stop {
  background: var(--status-error);
  color: #fff;
}

.ai-send.stop:hover {
  opacity: 0.88;
}

@keyframes ai-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
