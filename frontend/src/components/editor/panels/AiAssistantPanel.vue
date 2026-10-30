<template>
  <div class="ai-panel">
    <div class="ai-header">
      <div class="ai-title">
        <Icon icon="ri-brain-line" :size="14" />
        <span>AI 助理</span>
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
      <div v-if="messages.length === 0" class="ai-empty">
        <Icon icon="ri-chat-3-line" :size="32" />
        <p>{{ emptyHint }}</p>
      </div>
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="ai-msg"
        :class="msg.role"
      >
        <div class="msg-avatar">
          <Icon :icon="msg.role === 'user' ? 'ri-user-line' : 'ri-robot-line'" :size="14" />
        </div>
        <div class="msg-content" v-html="renderMarkdown(msg.content)"></div>
      </div>
      <div v-if="sending && !streamingActive" class="ai-msg assistant">
        <div class="msg-avatar">
          <Icon icon="ri-robot-line" :size="14" />
        </div>
        <div class="msg-content typing">
          <span></span><span></span><span></span>
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
        placeholder="输入问题（Enter 发送）"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button class="ai-send" :disabled="sending || !input.trim()" @click="send">
        <Icon :icon="sending ? 'ri-loader-4-line' : 'ri-send-plane-line'" :size="14" :class="{ spin: sending }" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';
import CustomSelect from '../../CustomSelect.vue';
import { aiApi } from '../../../api';

marked.use({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    return marked.parse(text, { breaks: true, gfm: true }) as string;
  } catch {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

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
}>();

const router = useRouter();

const input = ref('');
const messages = ref<any[]>([]);
const sessionId = ref<number | null>(null);
const sending = ref(false);
const streamingActive = ref(false);
const messagesEl = ref<HTMLElement | null>(null);

// 控件
const selectedModel = ref('default');
const isVoiceRecording = ref(false);
const customModels = ref<any[]>([]);

const panelModelOptions = computed(() => {
  const opts = [{ value: 'default', label: '默认', icon: 'ri-brain-line' }];
  for (const m of customModels.value) {
    opts.push({ value: m.name, label: m.name, icon: 'ri-cpu-line' });
  }
  return opts;
});
let recognition: any = null;

const emptyHint = computed(() => {
  return '向 AI 助理提问（可结合当前文件上下文）';
});

// ===== 会话加载 =====
async function loadSession() {
  try {
    const sessions = await aiApi.listSessions(props.scope);
    if (sessions && sessions.length > 0) {
      sessionId.value = sessions[0].id;
      messages.value = await aiApi.listMessages(sessionId.value);
      scrollToBottom();
    }
  } catch {
    // 静默忽略
  }
}

function startNewSession() {
  sessionId.value = null;
  messages.value = [];
}

// ===== 全屏切换 =====
function openFullScreen() {
  // 存储当前会话ID到 sessionStorage，全屏页面会读取
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
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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

// ===== 发送消息 =====
async function send() {
  const content = input.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  const previewId = Date.now();
  messages.value.push({ id: previewId, role: 'user', content });
  input.value = '';
  scrollToBottom();

  // 构建包含编辑器上下文的消息
  let fullContent = content;
  if (props.editorContext) {
    const ctx = props.editorContext;
    const ctxParts: string[] = [];
    if (ctx.fileName) ctxParts.push(`当前文件: ${ctx.fileName}`);
    if (ctx.language) ctxParts.push(`语言: ${ctx.language}`);
    if (ctx.selection) ctxParts.push(`选中内容:\n\`\`\`\n${ctx.selection}\n\`\`\``);
    else if (ctx.fileContent) ctxParts.push(`文件内容:\n\`\`\`\n${ctx.fileContent}\n\`\`\``);
    if (ctxParts.length > 0) {
      fullContent = `[编辑器上下文]\n${ctxParts.join('\n')}\n\n[用户问题]\n${content}`;
    }
  }

  // 统一走流式输出（服务端对规则引擎与真实模型均为 token 级流式）
  await sendStreaming(fullContent);
}

async function sendStreaming(content: string) {
  streamingActive.value = true;
  const streamingMsgId = Date.now() + 1;
  messages.value.push({ id: streamingMsgId, role: 'assistant', content: '' });
  scrollToBottom();

  try {
    const response = await aiApi.sendStream(sessionId.value, content, props.scope, props.scopeRef, selectedModel.value);
    if (!response.ok) throw new Error('HTTP ' + response.status);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('不支持流式读取');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.session_id) sessionId.value = parsed.session_id;
          else if (parsed.tool_call) {
            // AI 正在调用工具
            const toolNames: Record<string, string> = {
              get_editor_content: '读取编辑器内容',
              set_editor_content: '修改编辑器内容',
              search_in_content: '搜索文件内容',
            };
            const toolName = toolNames[parsed.tool_call] || parsed.tool_call;
            const msg = messages.value.find(m => m.id === streamingMsgId);
            if (msg) msg.content = `🔧 ${toolName}...`;
            scrollToBottom();
          }
          else if (parsed.apply_edit) {
            // AI 修改了编辑器，通知父组件
            emit('applyEdit', { content: parsed.apply_edit, replaceAll: true });
            const msg = messages.value.find(m => m.id === streamingMsgId);
            if (msg) msg.content = `✅ 已应用修改（${parsed.apply_edit.length} 字符）`;
            scrollToBottom();
          }
          else if (parsed.token) {
            const msg = messages.value.find(m => m.id === streamingMsgId);
            if (msg) {
              // 清除工具状态消息，开始显示实际回复
              if (msg.content.startsWith('🔧') || msg.content.startsWith('✅')) msg.content = '';
              msg.content += parsed.token;
            }
            scrollToBottom();
          }
        } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    const msg = messages.value.find(m => m.id === streamingMsgId);
    if (msg && !msg.content) msg.content = '出错：' + (e.message || '请求失败');
  } finally {
    sending.value = false;
    streamingActive.value = false;
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

// ===== 加载自定义模型 =====
async function loadCustomModels() {
  try {
    const list = await aiApi.listModels();
    customModels.value = list || [];
  } catch { customModels.value = []; }
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

.ctrl-select {
  margin-left: auto;
  height: 26px;
  padding: 0 20px 0 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-secondary);
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='12' height='12'%3E%3Cpath d='M12 16L6 10h12z' fill='%23888'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 4px center;
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
  animation: pulse-recording 1.5s ease-in-out infinite;
}

@keyframes pulse-recording {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* 消息区域 */
.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-2);
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
  margin-bottom: var(--spacer-2);
}

.msg-avatar {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.ai-msg.user .msg-avatar {
  background: var(--accent-base);
  color: white;
}

.ai-msg.assistant .msg-avatar {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.msg-content {
  background: var(--subtle-secondary);
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  line-height: 1.5;
  word-break: break-word;
}

.ai-msg.user .msg-content {
  background: var(--accent-base);
  color: white;
}

/* Markdown 渲染 */
.msg-content :deep(p) { margin: 0 0 0.3em; }
.msg-content :deep(p:last-child) { margin-bottom: 0; }
.msg-content :deep(code) {
  background: rgba(0,0,0,0.08); padding: 1px 4px; border-radius: 2px;
  font-family: monospace; font-size: 0.9em;
}
.ai-msg.user .msg-content :deep(code) { background: rgba(255,255,255,0.2); }
.msg-content :deep(pre) {
  background: rgba(0,0,0,0.06); padding: 8px; border-radius: 4px;
  overflow-x: auto; margin: 0.3em 0;
}
.msg-content :deep(pre code) { background: transparent; padding: 0; }
.ai-msg.user .msg-content :deep(pre) { background: rgba(255,255,255,0.15); }
.msg-content :deep(ul), .msg-content :deep(ol) { padding-left: 1.2em; margin: 0.2em 0; }
.msg-content :deep(blockquote) {
  border-left: 2px solid var(--accent-base); margin: 0.3em 0;
  padding: 0.1em 0.5em; opacity: 0.85;
}
.msg-content :deep(table) { border-collapse: collapse; margin: 0.3em 0; }
.msg-content :deep(th), .msg-content :deep(td) {
  border: 1px solid var(--divider-stroke); padding: 3px 6px;
}
.msg-content :deep(th) { background: rgba(0,0,0,0.04); font-weight: 600; }
.msg-content :deep(a) { color: inherit; text-decoration: underline; }
.msg-content :deep(h1), .msg-content :deep(h2), .msg-content :deep(h3) {
  margin: 0.5em 0 0.15em; font-weight: 600;
}
.msg-content :deep(h1) { font-size: 1.1em; }
.msg-content :deep(h2) { font-size: 1.05em; }
.msg-content :deep(h3) { font-size: 1em; }
.msg-content :deep(strong) { font-weight: 600; }
.msg-content :deep(img) { max-width: 100%; border-radius: 2px; }

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

.ai-send {
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-base);
  border: none;
  color: white;
  cursor: pointer;
}

.ai-send:hover {
  background: var(--accent-hover);
}

.ai-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 打字动画 */
.typing {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 0;
}

.typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-tertiary);
  animation: typing 1.4s infinite ease-in-out both;
}

.typing span:nth-child(1) { animation-delay: -0.32s; }
.typing span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
</style>