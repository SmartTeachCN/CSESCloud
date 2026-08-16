<template>
  <div v-if="visible" class="share-overlay" @click.self="$emit('close')">
    <div class="share-dialog">
      <div class="share-header">
        <div class="share-title">
          <Icon icon="ri-share-forward-line" :size="16" />
          <span>分享文件</span>
        </div>
        <button class="close-btn" @click="$emit('close')">
          <Icon icon="ri-close-line" :size="16" />
        </button>
      </div>

      <div class="share-body">
        <div class="share-filename">
          <Icon icon="ri-file-line" :size="14" />
          <span>{{ fileName }}</span>
        </div>

        <div class="form-group">
          <label class="form-label">有效期</label>
          <select v-model="expiryDays" class="form-select">
            <option :value="1">1 天</option>
            <option :value="3">3 天</option>
            <option :value="7">7 天</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">权限设置</label>
          <div class="radio-group">
            <label class="radio-item">
              <input type="radio" v-model="permission" value="all" />
              <span class="radio-label">允许所有用户查看</span>
            </label>
            <label class="radio-item">
              <input type="radio" v-model="permission" value="authorized" />
              <span class="radio-label">仅授权用户查看</span>
            </label>
          </div>
        </div>

        <div v-if="permission === 'all'" class="form-group">
          <label class="checkbox-item">
            <input type="checkbox" v-model="allowGuests" />
            <span class="checkbox-label">允许未登录用户查看</span>
          </label>
        </div>

        <div v-if="permission === 'authorized'" class="form-group">
          <label class="form-label">授权用户 ID（逗号分隔）</label>
          <input
            v-model="authorizedUsers"
            type="text"
            class="form-input"
            placeholder="例如: user1,user2,user3"
          />
        </div>

        <div v-if="error" class="share-error">
          <Icon icon="ri-error-warning-line" :size="14" />
          <span>{{ error }}</span>
        </div>

        <div v-if="shareResult" class="share-result">
          <div class="result-label">
            <Icon icon="ri-check-line" :size="14" />
            <span>分享链接已创建</span>
          </div>
          <div class="result-link-row">
            <input
              :value="shareResult.link"
              readonly
              class="result-link"
              ref="linkInput"
            />
            <button class="copy-btn" @click="copyLink">
              <Icon :icon="copied ? 'ri-check-line' : 'ri-file-copy-line'" :size="14" />
              <span>{{ copied ? '已复制' : '复制' }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="share-footer">
        <button class="btn-cancel" @click="$emit('close')">关闭</button>
        <button
          v-if="!shareResult"
          class="btn-create"
          :disabled="creating"
          @click="createShare"
        >
          <Icon v-if="creating" icon="ri-loader-4-line" :size="14" class="spin" />
          <span>{{ creating ? '创建中...' : '创建分享链接' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{
  visible: boolean;
  fileId: string;
  fileName: string;
  fileContent: string;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
}>();

const expiryDays = ref(3);
const permission = ref<'all' | 'authorized'>('all');
const allowGuests = ref(false);
const authorizedUsers = ref('');
const creating = ref(false);
const error = ref('');
const shareResult = ref<{ link: string } | null>(null);
const copied = ref(false);
const linkInput = ref<HTMLInputElement | null>(null);

watch(() => props.visible, (val) => {
  if (val) {
    expiryDays.value = 3;
    permission.value = 'all';
    allowGuests.value = false;
    authorizedUsers.value = '';
    error.value = '';
    shareResult.value = null;
    copied.value = false;
  }
});

async function createShare() {
  error.value = '';
  creating.value = true;
  try {
    const body: any = {
      file_id: props.fileId,
      file_name: props.fileName,
      file_content: props.fileContent,
      expiry_days: expiryDays.value,
      permission: permission.value,
      allow_guests: permission.value === 'all' ? allowGuests.value : false,
    };
    if (permission.value === 'authorized' && authorizedUsers.value.trim()) {
      body.authorized_users = authorizedUsers.value.trim();
    }
    const result = await api.post<any>('/share.php?action=create', body);
    shareResult.value = { link: result.link || result.url || '' };
    emit('created');
  } catch (e: any) {
    error.value = e.message || '创建分享链接失败';
  } finally {
    creating.value = false;
  }
}

async function copyLink() {
  if (!shareResult.value?.link) return;
  try {
    await navigator.clipboard.writeText(shareResult.value.link);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // fallback
    if (linkInput.value) {
      linkInput.value.select();
      document.execCommand('copy');
      copied.value = true;
      setTimeout(() => { copied.value = false; }, 2000);
    }
  }
}
</script>

<style scoped>
.share-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.share-dialog {
  width: 420px;
  max-width: 90vw;
  background: var(--layer-default);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
}

.share-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
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

.close-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.share-body {
  padding: var(--spacer-3);
}

.share-filename {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: var(--subtle-secondary);
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-sm);
  margin-bottom: var(--spacer-3);
}

.share-filename span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.form-group {
  margin-bottom: var(--spacer-2);
}

.form-label {
  display: block;
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.form-select {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='12' height='12' fill='%23666'%3E%3Cpath d='M12 16L6 10h12z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.form-select:focus {
  border-color: var(--accent-base);
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.radio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.radio-item input[type="radio"] {
  accent-color: var(--accent-base);
}

.checkbox-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.checkbox-item input[type="checkbox"] {
  accent-color: var(--accent-base);
}

.form-input {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--accent-base);
}

.form-input::placeholder {
  color: var(--text-tertiary);
}

.share-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacer-1) var(--spacer-2);
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--status-error);
  margin-top: var(--spacer-2);
}

.share-result {
  margin-top: var(--spacer-2);
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
}

.result-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--status-success);
  margin-bottom: var(--spacer-1);
}

.result-link-row {
  display: flex;
  gap: 6px;
}

.result-link {
  flex: 1;
  height: 30px;
  padding: 0 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: white;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: var(--accent-hover);
}

.share-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
}

.btn-cancel {
  height: 30px;
  padding: 0 14px;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.btn-create {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  background: var(--accent-base);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: white;
  cursor: pointer;
}

.btn-create:hover {
  background: var(--accent-hover);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>