<template>
  <div class="ai-fullpage">
    <!-- 左侧：会话列表管理区 -->
    <aside class="ai-sidebar" :class="{ collapsed: !sidebarOpen }">
      <div class="sidebar-header">
        <div class="sidebar-title" v-if="sidebarOpen">
          <Icon icon="ri-brain-line" :size="20" />
          <span>AI 助理</span>
        </div>
        <button class="new-chat-btn" @click="createNewChat" title="新建对话">
          <Icon icon="ri-add-line" :size="18" />
          <span v-if="sidebarOpen">新建对话</span>
        </button>
        <button class="sidebar-toggle" @click="sidebarOpen = !sidebarOpen" :title="sidebarOpen ? '收起侧栏' : '展开侧栏'">
          <Icon :icon="sidebarOpen ? 'ri-layout-left-line' : 'ri-layout-left-2-line'" :size="16" />
        </button>
      </div>

      <div v-if="sidebarOpen" class="sidebar-search">
        <Icon icon="ri-search-line" class="search-icon" :size="14" />
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索对话..."
        />
      </div>

      <div class="session-list" ref="sessionListEl">
        <div
          v-for="session in filteredSessions"
          :key="session.id"
          class="session-item"
          :class="{ active: currentSessionId === session.id }"
          @click="switchSession(session.id)"
        >
          <div class="session-icon">
            <Icon :icon="getSessionIcon(session.scope)" :size="sidebarOpen ? 16 : 18" />
          </div>
          <div v-if="sidebarOpen" class="session-info">
            <div class="session-title">{{ session.title }}</div>
            <div class="session-meta">{{ formatDate(session.updated_at) }}</div>
          </div>
          <button
            v-if="sidebarOpen"
            class="delete-btn"
            @click.stop="deleteSession(session.id)"
            title="删除对话"
          >
            <Icon icon="ri-delete-bin-line" :size="14" />
          </button>
        </div>
      </div>
    </aside>

    <!-- 右侧：对话区 -->
    <main class="ai-main">
      <!-- 对话头部 -->
      <header class="chat-header">
        <div class="header-left">
          <div v-if="currentSession" class="current-session-info">
            <div class="session-title">{{ currentSession.title || '新对话' }}</div>
            <div class="session-breadcrumb">
              <span class="scope-badge">{{ getScopeLabel(currentSession.scope) }}</span>
            </div>
          </div>
          <div v-else class="current-session-info">
            <div class="session-title">新对话</div>
            <div class="session-breadcrumb">
              <span class="scope-badge">全局</span>
            </div>
          </div>
        </div>
        <div class="header-right">
          <button class="tool-btn" @click="showModelSettings = true" title="模型设置">
            <Icon icon="ri-settings-3-line" :size="16" />
            <span>模型</span>
          </button>
          <button class="tool-btn" @click="clearCurrentChat" title="清空对话">
            <Icon icon="ri-delete-back-2-line" :size="16" />
            <span>清空</span>
          </button>
        </div>
      </header>

      <!-- 对话消息区 -->
      <div class="chat-messages" ref="messagesEl">
        <div v-if="messages.length === 0" class="chat-empty">
          <div class="empty-icon">
            <Icon icon="ri-brain-line" :size="64" />
          </div>
          <h2>AI 助理</h2>
          <p>我可以帮你解答关于 CSES Cloud 平台的各种问题</p>
          <div class="suggestion-chips">
            <button class="chip" @click="sendSuggestion('如何创建一个新实例？')">如何创建实例？</button>
            <button class="chip" @click="sendSuggestion('如何加入学校？')">如何加入学校？</button>
            <button class="chip" @click="sendSuggestion('开发者中心如何使用？')">开发者中心使用</button>
            <button class="chip" @click="sendSuggestion('子用户权限如何管理？')">子用户权限管理</button>
          </div>
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="chat-message"
          :class="msg.role"
        >
          <div class="message-avatar">
            <Icon :icon="msg.role === 'user' ? 'ri-user-line' : 'ri-robot-line'" :size="msg.role === 'user' ? 18 : 20" />
          </div>
          <div class="message-content">
            <div class="message-bubble" v-html="renderMarkdown(msg.content)"></div>
          </div>
        </div>
        <div v-if="sending && !streamingActive" class="chat-message assistant">
          <div class="message-avatar">
            <Icon icon="ri-robot-line" :size="20" />
          </div>
          <div class="message-content">
            <div class="message-bubble typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <footer class="chat-input-area">
        <div class="input-wrapper">
          <!-- 已选资源标签 + 文件标签 -->
          <div v-if="attachedTags.length > 0" class="attached-tags">
            <div
              v-for="(tag, idx) in attachedTags"
              :key="idx"
              class="attach-tag"
              :class="tag.type"
            >
              <Icon :icon="tag.icon" :size="14" />
              <span class="tag-name">{{ tag.name }}</span>
              <button class="tag-close" @click="removeTag(idx)" title="移除">
                <Icon icon="ri-close-line" :size="12" />
              </button>
            </div>
          </div>

          <textarea
            v-model="input"
            ref="inputEl"
            class="chat-input"
            placeholder="输入问题（Enter 发送，Shift+Enter 换行）"
            @keydown.enter.exact.prevent="sendMessage"
            :disabled="sending"
          ></textarea>

          <div class="input-actions">
            <!-- 左侧：资源选择 + 按钮 -->
            <div class="input-actions-left">
              <button
                class="icon-btn"
                :class="{ active: showResourceSelector }"
                @click="toggleResourceSelector"
                title="添加资源或文件"
              >
                <Icon icon="ri-add-circle-line" :size="20" />
              </button>
              <input
                type="file"
                ref="fileInput"
                class="hidden-file-input"
                @change="handleFileUpload"
                multiple
              />
            </div>

            <!-- 右侧：模型选择 + 语音 + 发送 -->
            <div class="input-actions-right">
              <select v-model="selectedModel" class="model-select">
                <option value="default">默认规则引擎</option>
                <option v-for="m in customModels" :key="m.id" :value="m.name">{{ m.name }}</option>
              </select>

              <button
                class="icon-btn mic-btn"
                :class="{ recording: isVoiceRecording }"
                @click="toggleVoiceInput"
                title="语音输入"
              >
                <Icon :icon="isVoiceRecording ? 'ri-stop-circle-line' : 'ri-mic-line'" :size="20" />
              </button>

              <button
                class="send-btn"
                :disabled="sending || !input.trim()"
                @click="sendMessage"
              >
                <Icon :icon="sending ? 'ri-loader-4-line' : 'ri-send-plane-line'" :size="16" :class="{ spin: sending }" />
                <span>{{ sending ? '发送中' : '发送' }}</span>
              </button>
            </div>
          </div>
        </div>
      </footer>

      <!-- 资源选择浮层 -->
      <Teleport to="body">
        <div
          v-if="showResourceSelector"
          class="resource-popover-overlay"
          @click.self="showResourceSelector = false"
        >
          <div class="resource-popover" ref="resourcePopoverEl">
            <div class="resource-popover-header">
              <span>添加资源或文件</span>
              <button class="close-btn" @click="showResourceSelector = false">
                <Icon icon="ri-close-line" :size="16" />
              </button>
            </div>

            <!-- 上传文件按钮 -->
            <div class="popover-section">
              <button class="popover-action-btn" @click="triggerFileUpload">
                <Icon icon="ri-upload-2-line" :size="18" />
                <span>上传本地文件</span>
              </button>
            </div>

            <div class="popover-divider" v-if="availableInstances.length > 0 || availableCampuses.length > 0"></div>

            <div class="popover-section" v-if="availableInstances.length > 0">
              <div class="popover-section-title">实例</div>
              <div class="popover-resource-list">
                <div
                  v-for="inst in availableInstances"
                  :key="inst.id"
                  class="popover-resource-item"
                  :class="{ selected: isResourceSelected('instance', inst.id) }"
                  @click="toggleResource('instance', inst.id, inst.name)"
                >
                  <Icon :icon="getInstanceIcon(inst.service_type)" :size="16" />
                  <span>{{ inst.name }}</span>
                  <Icon v-if="isResourceSelected('instance', inst.id)" icon="ri-check-line" :size="14" class="check-icon" />
                </div>
              </div>
            </div>

            <div class="popover-section" v-if="availableCampuses.length > 0">
              <div class="popover-section-title">校园</div>
              <div class="popover-resource-list">
                <div
                  v-for="campus in availableCampuses"
                  :key="campus.id"
                  class="popover-resource-item"
                  :class="{ selected: isResourceSelected('campus', campus.id) }"
                  @click="toggleResource('campus', campus.id, campus.name)"
                >
                  <Icon icon="ri-school-line" :size="16" />
                  <span>{{ campus.name }}</span>
                  <Icon v-if="isResourceSelected('campus', campus.id)" icon="ri-check-line" :size="14" class="check-icon" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 模型设置模态框 -->
      <Teleport to="body">
        <div v-if="showModelSettings" class="modal-overlay" @click.self="showModelSettings = false">
          <div class="modal-card modal-lg">
            <div class="modal-header">
              <h3>模型管理</h3>
              <button class="close-btn" @click="showModelSettings = false">
                <Icon icon="ri-close-line" :size="18" />
              </button>
            </div>
            <div class="modal-body">
              <div class="model-list">
                <div class="model-item add-new" v-if="!showModelForm">
                  <button class="add-new-btn" @click="openNewModelForm">
                    <Icon icon="ri-add-line" :size="18" />
                    <span>添加自定义模型</span>
                  </button>
                </div>
                <div v-for="m in userModels" :key="m.id" class="model-item" :class="{ disabled: !m.is_enabled }">
                  <div class="model-info">
                    <div class="model-name">
                      <span class="status-dot" :class="m.is_enabled ? 'enabled' : 'disabled'"></span>
                      {{ m.name }}
                    </div>
                    <div class="model-meta">{{ m.provider }} · {{ m.model_id || '默认' }}</div>
                  </div>
                  <div class="model-actions">
                    <button class="icon-btn-sm" @click="editModel(m)" title="编辑">
                      <Icon icon="ri-edit-line" :size="14" />
                    </button>
                    <button class="icon-btn-sm" @click="testModel(m.id)" title="测试连接">
                      <Icon icon="ri-plug-line" :size="14" />
                    </button>
                    <button class="icon-btn-sm danger" @click="deleteModelConfirm(m)" title="删除">
                      <Icon icon="ri-delete-bin-line" :size="14" />
                    </button>
                  </div>
                </div>
                <div v-if="userModels.length === 0 && !showModelForm" class="model-empty">
                  <Icon icon="ri-brain-line" :size="32" />
                  <p>暂无自定义模型</p>
                  <span>添加你自己的 AI 模型，配置 API Key 后即可使用</span>
                </div>
              </div>

              <!-- 模型表单 -->
              <div v-if="showModelForm" class="model-form">
                <div class="form-row">
                  <label>模型名称</label>
                  <input v-model="modelForm.name" type="text" placeholder="例如：我的 GPT-4o" />
                </div>
                <div class="form-row">
                  <label>提供商</label>
                  <select v-model="modelForm.provider">
                    <option value="">选择提供商</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai_compatible">OpenAI 兼容</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="google">Google (Gemini)</option>
                  </select>
                </div>
                <div class="form-row">
                  <label>模型 ID</label>
                  <input v-model="modelForm.model_id" type="text" placeholder="例如：gpt-4o" />
                </div>
                <div class="form-row">
                  <label>API 端点 (可选)</label>
                  <input v-model="modelForm.endpoint" type="text" placeholder="留空使用默认端点" />
                </div>
                <div class="form-row">
                  <label>API Key</label>
                  <input v-model="modelForm.api_key" type="password" placeholder="sk-..." />
                </div>
                <div class="form-actions">
                  <button class="secondary-btn" @click="cancelModelForm">取消</button>
                  <button class="primary-btn" @click="saveModel">{{ editingModelId ? '更新' : '添加' }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { marked } from 'marked';
import { aiApi, instancesApi, schoolsApi } from '../../api';
import { useAuth } from '../../composables/useAuth';

// 配置 marked
marked.use({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    return marked.parse(text, { breaks: true, gfm: true }) as string;
  } catch {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

const { user } = useAuth();
const route = useRoute();

// ===== 左侧会话列表 =====
const sidebarOpen = ref(true);
const searchQuery = ref('');
const sessions = ref<any[]>([]);
const currentSessionId = ref<number | null>(null);
const loadingSessions = ref(false);
const sessionListEl = ref<HTMLElement | null>(null);

// ===== 右侧聊天 =====
const currentSession = computed(() => {
  return sessions.value.find(s => s.id === currentSessionId.value);
});
const messages = ref<any[]>([]);
const input = ref('');
const sending = ref(false);
const streamingActive = ref(false);
const messagesEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

// ===== 控制栏选项 =====
const selectedModel = ref('default');
const showResourceSelector = ref(false);
const resourcePopoverEl = ref<HTMLElement | null>(null);
const currentScope = ref('global');
const currentScopeRef = ref<number | null>(null);
const currentScopeName = ref('');

// ===== 附件标签（资源 + 文件）=====
interface AttachedTag {
  type: 'resource' | 'file';
  icon: string;
  name: string;
  scope?: string;
  refId?: number;
  file?: File;
}
const attachedTags = ref<AttachedTag[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

// ===== 可用资源列表 =====
const availableInstances = ref<any[]>([]);
const availableCampuses = ref<any[]>([]);

// ===== 语音输入 =====
const isVoiceRecording = ref(false);
let recognition: any = null;

// ===== 模型管理 =====
const showModelSettings = ref(false);
const showModelForm = ref(false);
const editingModelId = ref<number | null>(null);
const customModels = ref<any[]>([]);
// 仅用户自有模型（不含系统模型），用于模型管理弹窗
const userModels = computed(() => customModels.value.filter(m => m.owner_key !== 'system'));
const modelForm = ref({
  name: '',
  provider: '',
  model_id: '',
  endpoint: '',
  api_key: ''
});

// ===== 过滤后的会话列表 =====
const filteredSessions = computed(() => {
  if (!searchQuery.value.trim()) return sessions.value;
  const q = searchQuery.value.toLowerCase();
  return sessions.value.filter(s =>
    (s.title || '').toLowerCase().includes(q)
  );
});

// ===== 判断资源是否已选中 =====
function isResourceSelected(scope: string, refId: number): boolean {
  return attachedTags.value.some(t => t.type === 'resource' && t.scope === scope && t.refId === refId);
}

// ===== 获取会话图标 =====
function getSessionIcon(scope: string): string {
  switch (scope) {
    case 'instance': return 'ri-database-2-line';
    case 'campus': return 'ri-school-line';
    default: return 'ri-chat-3-line';
  }
}

// ===== 获取范围标签 =====
function getScopeLabel(scope: string): string {
  switch (scope) {
    case 'instance': return '实例';
    case 'campus': return '校园';
    default: return '全局';
  }
}

// ===== 获取实例图标 =====
function getInstanceIcon(serviceType: string): string {
  const t = (serviceType || '').toLowerCase();
  if (t.includes('nginx') || t.includes('web')) return 'ri-globe-line';
  if (t.includes('mysql') || t.includes('redis') || t.includes('数据库')) return 'ri-database-2-line';
  if (t.includes('ai')) return 'ri-brain-line';
  if (t.includes('file')) return 'ri-folder-line';
  return 'ri-cloud-line';
}

// ===== 格式化日期 =====
function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day === 0) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `今天 ${hours}:${minutes}`;
  }
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ===== 加载会话列表 =====
async function loadSessions() {
  loadingSessions.value = true;
  try {
    const list = await aiApi.listSessions();
    sessions.value = list || [];
  } catch {
    sessions.value = [];
  } finally {
    loadingSessions.value = false;
  }
}

// ===== 加载消息 =====
async function loadMessages() {
  if (!currentSessionId.value) {
    messages.value = [];
    return;
  }
  try {
    const list = await aiApi.listMessages(currentSessionId.value);
    messages.value = list || [];
    scrollToBottom();
  } catch {
    messages.value = [];
  }
}

// ===== 切换会话 =====
async function switchSession(id: number) {
  currentSessionId.value = id;
  if (currentSession.value) {
    currentScope.value = currentSession.value.scope || 'global';
    currentScopeRef.value = currentSession.value.scope_ref || null;
  }
  await loadMessages();
}

// ===== 创建新对话 =====
function createNewChat() {
  currentSessionId.value = null;
  messages.value = [];
  input.value = '';
  attachedTags.value = [];
  currentScope.value = 'global';
  currentScopeRef.value = null;
  currentScopeName.value = '';
  if (inputEl.value) {
    inputEl.value.focus();
  }
}

// ===== 删除会话 =====
async function deleteSession(id: number) {
  if (!confirm('确认删除此对话？删除后无法恢复。')) return;
  try {
    await aiApi.deleteSession(id);
  } catch (e: any) {
    alert(e.message || '删除失败');
  }
  sessions.value = sessions.value.filter(s => s.id !== id);
  if (currentSessionId.value === id) {
    createNewChat();
  }
}

// ===== 滚动到底部 =====
function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  });
}

// ===== 快速建议点击 =====
function sendSuggestion(text: string) {
  input.value = text;
  sendMessage();
}

// ===== 资源选择相关 =====
function toggleResource(scope: string, refId: number, name: string) {
  const idx = attachedTags.value.findIndex(t => t.type === 'resource' && t.scope === scope && t.refId === refId);
  if (idx >= 0) {
    attachedTags.value.splice(idx, 1);
  } else {
    attachedTags.value.push({
      type: 'resource',
      icon: scope === 'instance' ? 'ri-database-2-line' : 'ri-school-line',
      name,
      scope,
      refId
    });
  }
  // 更新当前 scope
  if (attachedTags.value.length === 1 && attachedTags.value[0].type === 'resource') {
    currentScope.value = attachedTags.value[0].scope!;
    currentScopeRef.value = attachedTags.value[0].refId!;
  } else if (attachedTags.value.length === 0) {
    currentScope.value = 'global';
    currentScopeRef.value = null;
  }
}

function removeTag(idx: number) {
  attachedTags.value.splice(idx, 1);
  if (attachedTags.value.length === 1 && attachedTags.value[0].type === 'resource') {
    currentScope.value = attachedTags.value[0].scope!;
    currentScopeRef.value = attachedTags.value[0].refId!;
  } else if (attachedTags.value.length === 0) {
    currentScope.value = 'global';
    currentScopeRef.value = null;
  }
}

function toggleResourceSelector() {
  showResourceSelector.value = !showResourceSelector.value;
}

// ===== 文件上传 =====
function triggerFileUpload() {
  fileInput.value?.click();
  showResourceSelector.value = false;
}

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  if (!files) return;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    let icon = 'ri-file-2-line';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) icon = 'ri-image-line';
    else if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) icon = 'ri-video-line';
    else if (['pdf'].includes(ext)) icon = 'ri-file-pdf-2-line';
    else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) icon = 'ri-file-zip-line';
    else if (['doc', 'docx'].includes(ext)) icon = 'ri-file-word-2-line';
    else if (['xls', 'xlsx', 'csv'].includes(ext)) icon = 'ri-file-excel-2-line';
    else if (['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'cpp', 'c', 'h', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'toml', 'php'].includes(ext)) icon = 'ri-code-line';
    attachedTags.value.push({
      type: 'file',
      icon,
      name: file.name,
      file
    });
  }
  // 重置 input 以便可以重复选择同一文件
  target.value = '';
}

// ===== 清空当前对话 =====
function clearCurrentChat() {
  if (messages.value.length === 0) return;
  if (!confirm('确认清空当前对话所有消息？')) return;
  messages.value = [];
}

// ===== 语音输入切换 =====
function toggleVoiceInput() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('你的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器');
    return;
  }
  if (isVoiceRecording.value) {
    if (recognition) {
      recognition.stop();
    }
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
    if (inputEl.value) {
      inputEl.value.focus();
    }
  };
  recognition.onerror = () => {
    isVoiceRecording.value = false;
  };
  recognition.onend = () => {
    isVoiceRecording.value = false;
  };
  recognition.start();
  isVoiceRecording.value = true;
}

// ===== 发送消息 =====
async function sendMessage() {
  const content = input.value.trim();
  if (!content || sending.value) return;

  sending.value = true;
  // 本地预览
  const previewId = Date.now();
  messages.value.push({
    id: previewId,
    role: 'user',
    content
  });
  input.value = '';
  scrollToBottom();

  // 非默认模型使用流式输出
  if (selectedModel.value !== 'default') {
    await sendStreaming(content);
    return;
  }

  try {
    const res = await aiApi.send(
      currentSessionId.value,
      content,
      currentScope.value,
      currentScopeRef.value,
      selectedModel.value
    );
    if (res && res.session_id) {
      currentSessionId.value = res.session_id;
      await loadSessions();
    }
    if (res && res.reply) {
      messages.value.push({
        id: Date.now() + 1,
        role: 'assistant',
        content: res.reply
      });
    }
    scrollToBottom();
  } catch (e: any) {
    messages.value.push({
      id: Date.now() + 2,
      role: 'assistant',
      content: '出错：' + (e.message || '请求失败')
    });
    scrollToBottom();
  } finally {
    sending.value = false;
    if (inputEl.value) {
      inputEl.value.focus();
    }
  }
}

// ===== 流式发送 =====
async function sendStreaming(content: string) {
  streamingActive.value = true;
  const streamingMsgId = Date.now() + 1;
  // 创建占位消息
  messages.value.push({
    id: streamingMsgId,
    role: 'assistant',
    content: ''
  });
  scrollToBottom();

  try {
    const response = await aiApi.sendStream(
      currentSessionId.value,
      content,
      currentScope.value,
      currentScopeRef.value,
      selectedModel.value
    );

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

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
          if (parsed.session_id) {
            currentSessionId.value = parsed.session_id;
            await loadSessions();
          } else if (parsed.tool_call) {
            const toolNames: Record<string, string> = {
              get_editor_content: '读取编辑器内容',
              set_editor_content: '修改编辑器内容',
              search_in_content: '搜索文件内容',
            };
            const toolName = toolNames[parsed.tool_call] || parsed.tool_call;
            const msg = messages.value.find(m => m.id === streamingMsgId);
            if (msg) msg.content = `🔧 ${toolName}...`;
            scrollToBottom();
          } else if (parsed.apply_edit) {
            const msg = messages.value.find(m => m.id === streamingMsgId);
            if (msg) msg.content = `✅ 已应用修改（${parsed.apply_edit.length} 字符）`;
            scrollToBottom();
          } else if (parsed.token) {
            // 追加到流式消息
            const msg = messages.value.find(m => m.id === streamingMsgId);
            if (msg) {
              if (msg.content.startsWith('🔧') || msg.content.startsWith('✅')) msg.content = '';
              msg.content += parsed.token;
            }
            scrollToBottom();
          }
          // done 信号忽略
        } catch { /* 忽略解析错误 */ }
      }
    }
  } catch (e: any) {
    const msg = messages.value.find(m => m.id === streamingMsgId);
    if (msg && !msg.content) {
      msg.content = '出错：' + (e.message || '请求失败');
    }
  } finally {
    sending.value = false;
    streamingActive.value = false;
    if (inputEl.value) {
      inputEl.value.focus();
    }
  }
}

// ===== 加载可用资源 =====
async function loadAvailableResources() {
  try {
    const instRes = await instancesApi.list();
    if (Array.isArray(instRes)) {
      availableInstances.value = instRes;
    }
  } catch {
    // 静默失败
  }
  try {
    const campusRes = await schoolsApi.joined();
    if (Array.isArray(campusRes)) {
      availableCampuses.value = campusRes;
    }
  } catch {
    // 静默失败
  }
}

// ===== 模型管理 =====
async function loadCustomModels() {
  try {
    const list = await aiApi.listModels();
    customModels.value = list || [];
    // 动态添加自定义模型到模型选择下拉
    updateModelOptions();
  } catch {
    customModels.value = [];
  }
}

function updateModelOptions() {
  // 自定义模型已通过 v-for 绑定，无需额外处理
}

function openNewModelForm() {
  editingModelId.value = null;
  modelForm.value = { name: '', provider: '', model_id: '', endpoint: '', api_key: '' };
  showModelForm.value = true;
}

function editModel(m: any) {
  editingModelId.value = m.id;
  modelForm.value = {
    name: m.name,
    provider: m.provider,
    model_id: m.model_id || '',
    endpoint: m.endpoint || '',
    api_key: ''
  };
  showModelForm.value = true;
}

function cancelModelForm() {
  showModelForm.value = false;
  editingModelId.value = null;
}

async function saveModel() {
  const { name, provider, model_id, endpoint, api_key } = modelForm.value;
  if (!name.trim()) { alert('请输入模型名称'); return; }
  if (!provider) { alert('请选择提供商'); return; }
  try {
    if (editingModelId.value) {
      const data: any = { name: name.trim(), provider, model_id: model_id.trim(), endpoint: endpoint.trim() };
      if (api_key.trim()) data.api_key = api_key.trim();
      await aiApi.updateModel(editingModelId.value, data);
    } else {
      await aiApi.createModel({
        name: name.trim(),
        provider,
        model_id: model_id.trim(),
        endpoint: endpoint.trim(),
        api_key: api_key.trim()
      });
    }
    showModelForm.value = false;
    editingModelId.value = null;
    await loadCustomModels();
  } catch (e: any) {
    alert(e.message || '保存失败');
  }
}

async function deleteModelConfirm(m: any) {
  if (!confirm(`确认删除模型 "${m.name}"？`)) return;
  try {
    await aiApi.deleteModel(m.id);
    await loadCustomModels();
  } catch (e: any) {
    alert(e.message || '删除失败');
  }
}

async function testModel(id: number) {
  try {
    const res = await aiApi.testModel(id);
    if (res.ok) {
      alert('连接测试成功！');
    } else {
      alert('连接失败：' + (res.error || '未知错误'));
    }
  } catch (e: any) {
    alert('测试失败：' + (e.message || '网络错误'));
  }
}

// ===== 初始化 =====
onMounted(async () => {
  await loadSessions();
  await loadAvailableResources();
  await loadCustomModels();
  // 从窄屏面板跳转过来的，读取存储的会话ID
  const storedId = sessionStorage.getItem('ai_active_session');
  if (storedId) {
    sessionStorage.removeItem('ai_active_session');
    switchSession(Number(storedId));
  }
  const sessionId = route.params.sessionId;
  if (sessionId) {
    switchSession(Number(sessionId));
  }
  if (inputEl.value) {
    inputEl.value.focus();
  }
});

// 自动调整textarea高度
watch(input, () => {
  nextTick(() => {
    if (inputEl.value) {
      inputEl.value.style.height = 'auto';
      inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 200) + 'px';
    }
  });
});
</script>

<style scoped>
.ai-fullpage {
  display: flex;
  height: 100%;
  background: var(--app-bg);
  overflow: hidden;
}

/* ===== 左侧边栏 ===== */
.ai-sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--layer-default);
  border-right: 1px solid var(--divider-stroke);
  display: flex;
  flex-direction: column;
  transition: width var(--normal-duration) var(--fast-out-slow-in);
}

.ai-sidebar.collapsed {
  width: 52px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  padding: var(--spacer-3) var(--spacer-2);
  border-bottom: 1px solid var(--divider-stroke);
  gap: var(--spacer-2);
  flex-shrink: 0;
}

.collapsed .sidebar-header {
  flex-direction: column;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-1);
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.new-chat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  transition: background var(--fast-duration);
  flex-shrink: 0;
}

.collapsed .new-chat-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: var(--radius-md);
}

.new-chat-btn:hover {
  background: var(--accent-hover);
}

.collapsed .new-chat-btn span {
  display: none;
}

.sidebar-toggle {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.collapsed .sidebar-toggle {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
}

.sidebar-toggle:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.sidebar-search {
  padding: var(--spacer-2);
  border-bottom: 1px solid var(--divider-stroke);
  position: relative;
  flex-shrink: 0;
}

.search-icon {
  position: absolute;
  left: calc(var(--spacer-2) + 8px);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 8px 8px 8px 30px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.search-input:focus {
  border-color: var(--accent-base);
  background: var(--ctrl-fill-input-active);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-2);
}

.session-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  margin-bottom: var(--spacer-1);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
  border-left: 3px solid transparent;
}

.session-item:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.session-item.active {
  background: var(--ctrl-fill-default);
  border-left-color: var(--accent-base);
  color: var(--text-primary);
}

.session-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.session-item.active .session-icon {
  color: var(--accent-base);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.delete-btn {
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
  opacity: 0;
  transition: opacity var(--fast-duration), background var(--fast-duration);
}

.session-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: var(--subtle-pressed);
  color: var(--status-error);
}

.collapsed .session-info,
.collapsed .delete-btn {
  display: none;
}

/* ===== 右侧主区域 ===== */
.ai-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--app-bg);
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 var(--spacer-4);
  background: var(--layer-default);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.current-session-info .session-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.session-breadcrumb {
  margin-top: 2px;
}

.scope-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.tool-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  border-color: transparent;
}

/* ===== 消息区域 ===== */
.chat-messages {
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-4);
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
}

.empty-icon {
  color: var(--text-tertiary);
  opacity: 0.5;
  margin-bottom: var(--spacer-3);
}

.empty-icon > svg {
  height: 48px;
  width: 48px;
}

.chat-empty h2 {
  font-size: var(--font-size-2xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.chat-empty p {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0 0 var(--spacer-4);
}

.suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--spacer-2);
  max-width: 600px;
}

.chip {
  padding: 8px 16px;
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.chip:hover {
  background: var(--accent-bg);
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.chat-message {
  display: flex;
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-4);
  max-width: 85%;
}

.chat-message.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.chat-message.user .message-avatar {
  background: var(--accent-base);
  color: white;
}

.chat-message.assistant .message-avatar {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.message-content {
  min-width: 0;
}

.message-bubble {
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--layer-default);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.chat-message.user .message-bubble {
  background: var(--accent-base);
  color: white;
}

/* Markdown 渲染样式 */
.message-bubble :deep(p) { margin: 0 0 0.5em; }
.message-bubble :deep(p:last-child) { margin-bottom: 0; }
.message-bubble :deep(code) {
  background: rgba(0, 0, 0, 0.08);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.9em;
}
.chat-message.user .message-bubble :deep(code) {
  background: rgba(255, 255, 255, 0.2);
}
.message-bubble :deep(pre) {
  background: rgba(0, 0, 0, 0.06);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5em 0;
}
.message-bubble :deep(pre code) {
  background: transparent;
  padding: 0;
}
.chat-message.user .message-bubble :deep(pre) {
  background: rgba(255, 255, 255, 0.15);
}
.message-bubble :deep(ul), .message-bubble :deep(ol) {
  padding-left: 1.5em;
  margin: 0.25em 0;
}
.message-bubble :deep(li) { margin: 0.15em 0; }
.message-bubble :deep(blockquote) {
  border-left: 3px solid var(--accent-base);
  margin: 0.5em 0;
  padding: 0.25em 0.75em;
  opacity: 0.85;
}
.message-bubble :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}
.message-bubble :deep(th), .message-bubble :deep(td) {
  border: 1px solid var(--divider-stroke);
  padding: 6px 10px;
  text-align: left;
}
.message-bubble :deep(th) {
  background: rgba(0, 0, 0, 0.04);
  font-weight: 600;
}
.message-bubble :deep(a) {
  color: inherit;
  text-decoration: underline;
}
.message-bubble :deep(hr) {
  border: none;
  border-top: 1px solid var(--divider-stroke);
  margin: 0.75em 0;
}
.message-bubble :deep(h1), .message-bubble :deep(h2), .message-bubble :deep(h3),
.message-bubble :deep(h4), .message-bubble :deep(h5), .message-bubble :deep(h6) {
  margin: 0.75em 0 0.25em;
  font-weight: 600;
  line-height: 1.3;
}
.message-bubble :deep(h1) { font-size: 1.3em; }
.message-bubble :deep(h2) { font-size: 1.15em; }
.message-bubble :deep(h3) { font-size: 1.05em; }
.message-bubble :deep(strong) { font-weight: 600; }
.message-bubble :deep(img) { max-width: 100%; border-radius: 4px; }

/* 打字动画 */
.typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
}

.typing span {
  width: 8px;
  height: 8px;
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

/* ===== 输入区域 ===== */
.chat-input-area {
  padding: var(--spacer-3) var(--spacer-4);
  flex-shrink: 0;
}

.input-wrapper {
  max-width: 900px;
  margin: 0 auto;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color var(--fast-duration);
}

.input-wrapper:focus-within {
  border-color: var(--accent-base);
}

/* 附件标签 */
.attached-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px 0 14px;
}

.attach-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
}

.attach-tag.resource {
  background: var(--accent-bg);
  color: var(--accent-base);
}

.attach-tag.file {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.tag-name {
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag-close {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-full);
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  flex-shrink: 0;
}

.tag-close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.1);
}

.chat-input {
  width: 100%;
  min-height: 56px;
  max-height: 200px;
  padding: 12px 16px 8px;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  box-sizing: border-box;
}

.chat-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 6px 8px;
}

.input-actions-left {
  display: flex;
  align-items: center;
}

.input-actions-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--fast-duration);
  flex-shrink: 0;
}

.icon-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.icon-btn.active {
  background: var(--accent-bg);
  color: var(--accent-base);
}

.mic-btn.recording {
  background: var(--status-error);
  color: white;
  animation: pulse-recording 1.5s ease-in-out infinite;
}

@keyframes pulse-recording {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.hidden-file-input {
  display: none;
}

/* 模型选择下拉 */
.model-select {
  height: 32px;
  padding: 0 24px 0 10px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='14' height='14'%3E%3Cpath d='M12 16L6 10h12z' fill='%23888'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  transition: border-color var(--fast-duration);
}

.model-select:focus {
  border-color: var(--accent-base);
}

.model-select option {
  background: var(--card-bg);
  color: var(--text-primary);
}

.form-row select option {
  background: var(--card-bg);
  color: var(--text-primary);
}

.send-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== 资源选择浮层 ===== */
.resource-popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 140px;
}

.resource-popover {
  width: 400px;
  max-width: 90vw;
  max-height: 360px;
  overflow-y: auto;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  animation: popoverIn var(--normal-duration) var(--fast-out-slow-in);
}

@keyframes popoverIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.resource-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.resource-popover-header .close-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.resource-popover-header .close-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.popover-section {
  padding: var(--spacer-2) var(--spacer-4);
}

.popover-action-btn {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 100%;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border: 1px dashed var(--divider-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.popover-action-btn:hover {
  background: var(--ctrl-fill-default);
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.popover-divider {
  height: 1px;
  background: var(--divider-stroke);
  margin: 0 var(--spacer-4);
}

.popover-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--spacer-2);
}

.popover-resource-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacer-2);
}

.popover-resource-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--subtle-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.popover-resource-item:hover {
  background: var(--ctrl-fill-default);
  color: var(--text-primary);
}

.popover-resource-item.selected {
  background: var(--accent-bg);
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.check-icon {
  margin-left: auto;
  color: var(--accent-base);
}

/* 响应式 */
@media (max-width: 768px) {
  .ai-sidebar {
    width: 52px;
  }
  .ai-sidebar:not(.collapsed) {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    width: 260px;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.1);
  }
  .chat-message {
    max-width: 95%;
  }
  .header-right .tool-btn span {
    display: none;
  }
  .model-select {
    max-width: 100px;
  }
}

/* ===== 模型管理模态框 ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  padding: var(--spacer-5);
  min-width: 360px;
  max-width: 560px;
  width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-card.modal-lg {
  max-width: 640px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacer-4);
}

.modal-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal-header .close-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.modal-header .close-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.model-item.disabled {
  opacity: 0.5;
}

.model-item.add-new {
  background: transparent;
  border: 1px dashed var(--divider-stroke);
  justify-content: center;
}

.add-new-btn {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  background: transparent;
  border: none;
  color: var(--accent-base);
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: var(--spacer-1);
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.enabled {
  background: var(--status-success);
}

.status-dot.disabled {
  background: var(--text-tertiary);
}

.model-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.model-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.icon-btn-sm {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.icon-btn-sm:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.icon-btn-sm.danger:hover {
  color: var(--status-error);
}

.model-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-6) var(--spacer-3);
  color: var(--text-tertiary);
  gap: var(--spacer-2);
}

.model-empty p {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.model-empty span {
  font-size: var(--font-size-xs);
}

.model-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.form-row label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-secondary);
}

.form-row input,
.form-row select {
  height: 36px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  font-family: inherit;
}

.form-row input:focus,
.form-row select:focus {
  border-color: var(--accent-base);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  margin-top: var(--spacer-2);
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-4);
  background: var(--accent-base);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
}

.primary-btn:hover {
  background: var(--accent-hover);
}

.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-4);
  background: var(--ctrl-fill-default);
  color: var(--text-primary);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.secondary-btn:hover {
  background: var(--subtle-secondary);
}
</style>