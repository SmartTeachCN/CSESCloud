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

      <template v-for="(item, idx) in items" :key="item.key">
        <div v-if="item.role === 'user'" class="ai-msg user">
          <div class="msg-avatar">
            <Icon icon="ri-user-line" :size="14" />
          </div>
          <div class="msg-bubble user">{{ item.content }}</div>
        </div>
        <div v-else-if="item.turn" class="ai-msg assistant">
          <div class="msg-avatar">
            <Icon icon="ri-robot-line" :size="14" />
          </div>
          <div class="turn-body">
            <AiTurnView
              :turn="item.turn"
              :live="false"
              :can-retry="canRetryItem(item, idx)"
              @answer-ask="onAnswerAsk"
              @retry="onRetry(item)"
              @copy="onCopy"
            />
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

    <transition name="ai-toast-fade">
      <div v-if="toastText" class="ai-toast" role="status">{{ toastText }}</div>
    </transition>

    <!-- 输入区：外观对齐全屏模式（同一套气泡/圆角/控件排布） -->
    <div class="ai-composer">
      <div class="composer-box">
        <textarea
          v-model="input"
          class="ai-input"
          :placeholder="isStreaming ? '正在生成回复…' : '输入问题（Enter 发送，Shift+Enter 换行）'"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <div class="composer-actions">
          <ModelPicker
            v-model:model="selectedModel"
            v-model:reasoning="reasoningLevel"
            :models="customModels"
            :disabled="isStreaming"
            class="composer-model"
          />
          <button
            class="ctrl-btn"
            :class="{ recording: isVoiceRecording }"
            @click="toggleVoice"
            title="语音输入"
          >
            <Icon :icon="isVoiceRecording ? 'ri-stop-circle-fill' : 'ri-mic-line'" :size="14" />
          </button>
          <button
            v-if="isStreaming"
            class="send-btn stop"
            title="停止生成"
            @click="stopStream"
          >
            <Icon icon="ri-stop-fill" :size="14" />
            <span>停止</span>
          </button>
          <button
            v-else
            class="send-btn"
            :disabled="sending || !input.trim()"
            :title="sending ? '正在收尾上一轮…' : '发送'"
            @click="send"
          >
            <Icon icon="ri-send-plane-line" :size="14" />
            <span>发送</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';
import AiTurnView from '../../ai/AiTurnView.vue';
import ModelPicker, { loadModelPrefs } from '../../ai/ModelPicker.vue';
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
    /** 当前文件完整云端路径（如 /.cloud/web/index.html） */
    path?: string;
    /** 当前文件在云文件系统里的 ID */
    fileId?: string;
    /** local / cloud / shared */
    source?: string;
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

/** 轻提示（复制成功/失败、重试失败等），不引入额外依赖 */
const toastText = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function notify(message: string) {
  toastText.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastText.value = '';
    toastTimer = null;
  }, 2400);
}

// 控件（与全屏模式一致：模型 + 推理等级）
const panelPrefs = loadModelPrefs();
const selectedModel = ref(panelPrefs.model || 'default');
const reasoningLevel = ref(panelPrefs.reasoning || '');
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

/** 从服务端重新拉取当前会话消息（刷新后能拿到 messageId / usage / alternatives） */
async function reloadMessages(forceScroll = false) {
  if (!sessionId.value) return;
  // 服务端返回的历史行 id 与本地直播 turn 的 id 不同：先隐藏直播 turn，避免刷新后重复显示
  const current = stream.turn.value;
  if (current && !stream.isStreaming.value && !suppressedTurnIds.value.includes(current.id)) {
    suppressedTurnIds.value = [...suppressedTurnIds.value, current.id];
  }
  try {
    const rows = await aiApi.listMessages(sessionId.value);
    items.value = (rows || [])
      .map((row: any, i: number) => rowToItem(row, i))
      .filter((it: PanelItem | null): it is PanelItem => !!it);
    scrollToBottom(forceScroll);
  } catch {
    // 静默：保留现有列表
  }
}

async function loadSession() {
  try {
    const sessions = await aiApi.listSessions(props.scope);
    if (sessions && sessions.length > 0) {
      sessionId.value = sessions[0].id;
      await reloadMessages(true);
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
  const ctx: any = props.editorContext;
  const ctxParts: string[] = [];
  if (ctx.fileName) ctxParts.push(`当前文件: ${ctx.fileName}`);
  // 完整路径 + 文件 ID：模型用 read/update_cloud_file 操作当前文件时可以一次命中，
  // 避免只给文件名在同名文件存在时被迫反复 list。
  if (ctx.path) ctxParts.push(`云文件路径: ${ctx.path}`);
  if (ctx.fileId) ctxParts.push(`云文件ID: ${ctx.fileId}`);
  if (ctx.source) ctxParts.push(`来源: ${ctx.source}`);
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
      reasoning: selectedModel.value === 'default' ? undefined : (reasoningLevel.value || undefined),
      session_id: sessionId.value,
      scope: props.scope,
      scope_ref: props.scopeRef ?? null,
    });
    // 期间点了「新会话」：丢弃这一轮，避免旧回合被提交进新会话列表
    if (gen !== runGeneration) return;
    commitTurn(turn);
    // 以服务端 meta 为准刷新（补全 messageId / usage / alternatives，重试按钮与版本切换器依赖它）
    await reloadMessages();
  } catch {
    if (gen !== runGeneration) return;
    // useAiStream 内部会落 turn.error；这里只兜底极端情况
    commitTurn(stream.turn.value);
    await reloadMessages();
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

// ===== 重试 / 复制（消息级操作） =====

/** 列表里最后一条 assistant 消息的下标（「重试」只对最后一条 AI 回复开放） */
function isLastAssistantIndex(targetIndex: number): boolean {
  for (let i = items.value.length - 1; i >= 0; i--) {
    const it = items.value[i];
    if (it.role === 'assistant' && it.turn) return i === targetIndex;
  }
  return false;
}

/** 是否给这条 AI 消息显示「重试」：最后一条、有 messageId、不在流式中 */
function canRetryItem(item: PanelItem, index: number): boolean {
  if (!item.turn || item.turn.messageId == null) return false;
  if (sending.value || stream.isStreaming.value) return false;
  const status = item.turn.status;
  if (status !== 'done' && status !== 'error') return false;
  if (!isLastAssistantIndex(index)) return false;
  return Number.isFinite(Number(item.turn.messageId));
}

async function onRetry(item: PanelItem) {
  const turn = item.turn;
  if (!turn || turn.messageId == null) return;
  if (sending.value || stream.isStreaming.value) return;
  const sid = sessionId.value;
  const retryMessageId = Number(turn.messageId);
  if (!sid || !Number.isFinite(retryMessageId)) {
    notify('当前无法重试：会话未就绪');
    return;
  }

  sending.value = true;
  const gen = ++runGeneration;
  try {
    const newTurn = await stream.retry({
      session_id: sid,
      retry_message_id: retryMessageId,
      model: selectedModel.value === 'default' ? undefined : selectedModel.value,
      reasoning: selectedModel.value === 'default' ? undefined : (reasoningLevel.value || undefined),
    });
    if (gen !== runGeneration) return;
    // 服务端已删掉旧回复：先移除旧条目，再提交新回合
    const idx = items.value.findIndex((it) => it === item);
    if (idx >= 0) items.value.splice(idx, 1);
    commitTurn(newTurn);
    if (newTurn.status === 'error') {
      notify('重试失败：' + (newTurn.error || '请求失败'));
    }
    // 拉取服务端 meta：补全 messageId / usage / alternatives（版本切换器需要）
    await reloadMessages();
  } catch (e: any) {
    if (gen === runGeneration) notify('重试失败：' + (e?.message || '请求失败'));
  } finally {
    sending.value = false;
    scrollToBottom();
  }
}

async function onCopy(text: string) {
  if (!text) return;
  const ok = await writeClipboard(text);
  notify(ok ? '已复制' : '复制失败，请手动选择文本复制');
}

/** 复制到剪贴板：优先 Clipboard API，失败回退 execCommand */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 无权限 / 非安全上下文：走回退
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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


/* ===== v4.1：外观对齐「全屏模式」（同气泡/同圆角/同控件排布）===== */
.ai-messages {
  padding: var(--spacer-3) var(--spacer-2);
  gap: 0;
}

.ai-msg {
  display: flex;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-3);
  align-items: flex-start;
  max-width: 100%;
}

/* 用户消息：右对齐 + 强调色气泡（与全屏模式一致） */
.ai-msg.user {
  flex-direction: row-reverse;
  margin-left: auto;
  max-width: 88%;
}

.msg-avatar {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.ai-msg.user .msg-avatar {
  background: var(--accent-base);
  color: #fff;
}

.ai-msg.assistant .msg-avatar {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  border: 1px solid var(--divider-stroke);
}

/* 气泡外壳：与全屏模式的 .message-bubble 一致 */
.msg-bubble {
  min-width: 0;
  max-width: 100%;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.msg-bubble.user {
  background: var(--accent-base);
  border-color: transparent;
  color: #fff;
}

/* 助手回合外壳也套上同样的气泡底 */
.turn-body {
  min-width: 0;
  flex: 1;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* ===== 输入区：与全屏模式的 input-wrapper 一致 ===== */
.ai-composer {
  flex-shrink: 0;
  padding: var(--spacer-2);
  border-top: 1px solid var(--divider-stroke);
  background: var(--layer-default);
}

.composer-box {
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-lg);
  transition: border-color var(--fast-duration), background var(--fast-duration);
  overflow: hidden;
}

.composer-box:focus-within {
  border-color: var(--accent-base);
  background: var(--ctrl-fill-input-active);
}

.ai-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: var(--spacer-2) var(--spacer-3);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  resize: none;
  min-height: 44px;
  max-height: 120px;
  font-family: inherit;
  line-height: 1.6;
  box-sizing: border-box;
}

.composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 6px;
}

/* ModelPicker 在窄面板里压缩：两个 trigger 横向排列、标签省略 */
.composer-model {
  display: flex;
  gap: 4px;
  min-width: 0;
  margin-right: auto;
}

.composer-model :deep(.mp-trigger) {
  height: 26px;
  padding: 0 8px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  color: var(--text-secondary);
  max-width: 150px;
}

.composer-model :deep(.mp-trigger-label) {
  max-width: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctrl-btn {
  width: 28px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.ctrl-btn:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.ctrl-btn.recording {
  background: var(--status-error);
  border-color: var(--status-error);
  color: #fff;
}

/* 发送 / 停止按钮：与全屏模式同形 */
.send-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  background: var(--accent-base);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.send-btn:hover { background: var(--accent-hover); }
.send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.send-btn.stop { background: var(--status-error); }
.send-btn.stop:hover { opacity: 0.9; }

@keyframes ai-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ===== v4.2：Tokens / 重试 / 版本切换 / 复制 / 轻提示 ===== */
.ai-panel {
  position: relative;
}

/* 正文与用户气泡都可鼠标选中复制 */
.msg-bubble {
  user-select: text;
  -webkit-user-select: text;
}

.ai-toast {
  position: absolute;
  left: 50%;
  bottom: 96px;
  z-index: 30;
  max-width: 82%;
  padding: 5px 10px;
  background: var(--flyout-bg);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  transform: translateX(-50%);
}

.ai-toast-fade-enter-active,
.ai-toast-fade-leave-active {
  transition: opacity var(--fast-duration), transform var(--fast-duration);
}

.ai-toast-fade-enter-from,
.ai-toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 4px);
}
</style>
