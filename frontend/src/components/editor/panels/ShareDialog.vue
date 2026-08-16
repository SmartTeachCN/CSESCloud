<template>
  <div v-if="visible" class="share-overlay" @click.self="$emit('close')">
    <div class="share-dialog" :class="{ 'share-detail': mode === 'detail' }">
      <!-- 顶部标题栏 -->
      <div class="share-header">
        <div class="share-title">
          <Icon icon="ri-share-forward-line" :size="16" />
          <span>{{ mode === 'detail' ? '管理分享' : '分享' + (resourceLabel || '') }}</span>
        </div>
        <button class="close-btn" @click="$emit('close')">
          <Icon icon="ri-close-line" :size="16" />
        </button>
      </div>

      <div class="share-body">
        <!-- 已分享文件标记 -->
        <div v-if="shareDetail || mode === 'detail'" class="share-status-bar">
          <Icon icon="ri-share-line" :size="14" />
          <span>已分享</span>
          <span class="share-status-expiry">有效期至 {{ formatDate(shareDetail?.expires_at || '') }}</span>
          <button class="share-status-action" @click="mode = 'create'">修改分享</button>
        </div>

        <!-- 创建/编辑分享 -->
        <template v-if="mode === 'create'">
          <div class="share-filename">
            <Icon :icon="resourceIcon || 'ri-file-line'" :size="14" />
            <span>{{ resourceName }}</span>
          </div>

          <!-- 有效期 -->
          <div class="form-group">
            <label class="form-label">有效期</label>
            <select v-model="expiryDays" class="form-select">
              <option :value="1">1 天</option>
              <option :value="3">3 天</option>
              <option :value="7">7 天</option>
              <option :value="14">14 天</option>
              <option :value="30">1 个月</option>
              <option :value="60">2 个月</option>
              <option :value="90">3 个月</option>
            </select>
          </div>

          <!-- 默认权限 -->
          <div class="form-group">
            <label class="form-label">默认权限</label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="defaultPermission" value="view" />
                <span class="radio-label">查看</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="defaultPermission" value="edit" />
                <span class="radio-label">查看和编辑</span>
              </label>
            </div>
          </div>

          <!-- 按用户名分享 -->
          <div class="form-group">
            <label class="form-label">分享给用户</label>
            <div class="user-search-row">
              <div class="user-search-input-wrap">
                <Icon icon="ri-search-line" :size="12" class="search-icon" />
                <input
                  v-model="userSearchKeyword"
                  type="text"
                  class="user-search-input"
                  placeholder="输入用户名或显示名称搜索..."
                  @input="onUserSearch"
                  @focus="onUserSearch"
                />
              </div>
            </div>
            <!-- 搜索结果 -->
            <div v-if="userSearchResults.length > 0" class="user-search-results">
              <div
                v-for="u in userSearchResults"
                :key="u.username"
                class="user-result-item"
                :class="{ selected: selectedUsers.some(su => su.username === u.username) }"
                @click="toggleUser(u)"
              >
                <div class="user-result-info">
                  <span class="user-result-name">{{ u.display_name || u.username }}</span>
                  <span class="user-result-username">@{{ u.username }}</span>
                </div>
                <Icon v-if="selectedUsers.some(su => su.username === u.username)" icon="ri-check-line" :size="16" class="check-icon" />
              </div>
            </div>
            <div v-if="userSearchKeyword && userSearchResults.length === 0 && !userSearching" class="user-search-empty">
              未找到匹配的用户
            </div>
          </div>

          <!-- 已选用户列表 -->
          <div v-if="selectedUsers.length > 0" class="selected-users">
            <div v-for="(su, idx) in selectedUsers" :key="su.username" class="selected-user-item">
              <div class="selected-user-info">
                <Icon icon="ri-user-line" :size="12" />
                <span class="selected-user-name">{{ su.display_name || su.username }}</span>
                <span class="selected-user-username">@{{ su.username }}</span>
              </div>
              <div class="selected-user-actions">
                <select v-model="su.permission" class="perm-select">
                  <option value="view">查看</option>
                  <option value="edit">编辑</option>
                </select>
                <button class="remove-user-btn" @click="removeUser(idx)" title="移除">
                  <Icon icon="ri-close-line" :size="12" />
                </button>
              </div>
            </div>
          </div>

          <!-- 预览链接 -->
          <div class="form-group">
            <label class="checkbox-item">
              <input type="checkbox" v-model="enablePreviewLink" />
              <span class="checkbox-label">创建预览链接（持有链接的人均可查看）</span>
            </label>
          </div>

          <div v-if="error" class="share-error">
            <Icon icon="ri-error-warning-line" :size="14" />
            <span>{{ error }}</span>
          </div>

          <div v-if="shareResult" class="share-result">
            <div class="result-label">
              <Icon icon="ri-check-line" :size="14" />
              <span>{{ shareResultMessage }}</span>
            </div>
            <div v-if="shareResult.preview_link" class="result-link-row">
              <input :value="shareResult.preview_link" readonly class="result-link" ref="linkInput" />
              <button class="copy-btn" @click="copyLink">
                <Icon :icon="copied ? 'ri-check-line' : 'ri-file-copy-line'" :size="14" />
                <span>{{ copied ? '已复制' : '复制' }}</span>
              </button>
            </div>
          </div>
        </template>

        <!-- 详情模式 -->
        <template v-if="mode === 'detail' && shareDetail">
          <!-- 预览链接状态 -->
          <div class="detail-section">
            <div class="detail-section-header">
              <Icon icon="ri-link" :size="14" />
              <span>预览链接</span>
            </div>
            <div class="preview-link-row">
              <div class="preview-link-status">
                <span class="toggle-label">{{ shareDetail.preview_enabled ? '已开启' : '已关闭' }}</span>
                <button class="toggle-btn" :class="{ on: shareDetail.preview_enabled }" @click="togglePreviewLink">
                  <span class="toggle-knob"></span>
                </button>
              </div>
              <template v-if="shareDetail.preview_enabled && shareDetail.preview_link">
                <div class="preview-link-copy">
                  <input :value="shareDetail.preview_link" readonly class="preview-link-input" />
                  <button class="link-copy-btn" @click="copyPreviewLink">
                    <Icon :icon="previewCopied ? 'ri-check-line' : 'ri-file-copy-line'" :size="12" />
                  </button>
                </div>
              </template>
            </div>
          </div>

          <!-- 已授权用户 -->
          <div class="detail-section">
            <div class="detail-section-header">
              <Icon icon="ri-group-line" :size="14" />
              <span>已授权用户 ({{ shareDetail.users?.length || 0 }})</span>
            </div>
            <div v-if="shareDetail.users?.length > 0" class="auth-users-list">
              <div v-for="perm in shareDetail.users" :key="perm.id" class="auth-user-item">
                <div class="auth-user-info">
                  <Icon icon="ri-user-line" :size="12" />
                  <span class="auth-user-name">@{{ perm.target_username }}</span>
                  <span class="auth-user-status" :class="perm.status">
                    {{ perm.status === 'accepted' ? '已接受' : perm.status === 'pending' ? '等待中' : '已拒绝' }}
                  </span>
                </div>
                <div class="auth-user-actions" v-if="perm.status !== 'rejected'">
                  <select
                    :value="perm.permission"
                    @change="updateUserPermission(perm.id, ($event.target as HTMLSelectElement).value)"
                    class="perm-select"
                  >
                    <option value="view">查看</option>
                    <option value="edit">编辑</option>
                  </select>
                  <button class="remove-user-btn" @click="removeSharedUser(perm.id)" title="移除">
                    <Icon icon="ri-close-line" :size="12" />
                  </button>
                </div>
                <div class="auth-user-actions" v-else>
                  <button class="resend-btn" @click="resendInvite(perm)" title="重新邀请">
                    <Icon icon="ri-refresh-line" :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="auth-users-empty">
              暂无授权用户
            </div>
          </div>

          <!-- 有效期限 -->
          <div class="detail-section">
            <div class="detail-section-header">
              <Icon icon="ri-time-line" :size="14" />
              <span>有效期至 {{ formatDate(shareDetail.expires_at) }}</span>
            </div>
          </div>
        </template>
      </div>

      <!-- 底部按钮 -->
      <div class="share-footer">
        <template v-if="mode === 'create'">
          <button class="btn-cancel" @click="onCancel">取消</button>
          <button class="btn-create" :disabled="creating" @click="createShare">
            <Icon v-if="creating" icon="ri-loader-4-line" :size="14" class="spin" />
            <span>{{ creating ? '创建中...' : (shareDetail ? '更新分享' : '创建分享') }}</span>
          </button>
        </template>
        <template v-else>
          <button class="btn-cancel" @click="mode = 'create'">修改分享</button>
          <button class="btn-create" @click="deleteShare" :disabled="deleting" style="background: var(--status-error);">
            <Icon v-if="deleting" icon="ri-loader-4-line" :size="14" class="spin" />
            <span>{{ deleting ? '删除中...' : '删除分享' }}</span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { api } from '../../../api/client';

const props = defineProps<{
  visible: boolean;
  resourceType: string;   // 'cloud_file' or 'instance'
  resourceId: number | string;
  resourceName: string;
  resourceIcon?: string;
  resourceLabel?: string;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
  updated: [];
}>();

// 模式
const mode = ref<'create' | 'detail'>('create');

// 表单数据
const expiryDays = ref(7);
const defaultPermission = ref<'view' | 'edit'>('view');
const enablePreviewLink = ref(false);
const userSearchKeyword = ref('');
const userSearching = ref(false);
const userSearchResults = ref<any[]>([]);
const selectedUsers = ref<{ username: string; display_name: string; permission: string }[]>([]);

// 状态
const creating = ref(false);
const deleting = ref(false);
const error = ref('');
const shareResult = ref<any>(null);
const shareResultMessage = ref('');
const copied = ref(false);
const previewCopied = ref(false);
const linkInput = ref<HTMLInputElement | null>(null);

// 分享详情
const shareDetail = ref<any>(null);

// 防抖
let searchTimer: any = null;

watch(() => props.visible, async (val) => {
  if (val) {
    mode.value = 'create';
    expiryDays.value = 7;
    defaultPermission.value = 'view';
    enablePreviewLink.value = false;
    userSearchKeyword.value = '';
    selectedUsers.value = [];
    error.value = '';
    shareResult.value = null;
    copied.value = false;
    previewCopied.value = false;

    // 加载现有分享详情
    await loadShareDetail();
  }
});

async function loadShareDetail() {
  try {
    // 先列出我分享的，找到匹配的
    const shares = await api.get<any[]>('/share.php?action=list-shared-by-me');
    const match = (shares || []).find((s: any) =>
      s.resource_type === props.resourceType &&
      String(s.resource_id) === String(props.resourceId)
    );
    if (match) {
      // 获取完整详情
      const detail = await api.get<any>(`/share.php?action=get-share-detail&share_id=${match.id}`);
      shareDetail.value = detail;
      mode.value = 'detail';
    } else {
      shareDetail.value = null;
      mode.value = 'create';
    }
  } catch {
    shareDetail.value = null;
  }
}

async function onUserSearch() {
  const keyword = userSearchKeyword.value.trim();
  if (!keyword) {
    userSearchResults.value = [];
    return;
  }
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    userSearching.value = true;
    try {
      const results = await api.get<any[]>(`/share.php?action=search-users&keyword=${encodeURIComponent(keyword)}`);
      userSearchResults.value = (results || []).filter(
        (u: any) => !selectedUsers.value.some(su => su.username === u.username)
      );
    } catch {
      userSearchResults.value = [];
    } finally {
      userSearching.value = false;
    }
  }, 300);
}

function toggleUser(user: any) {
  const idx = selectedUsers.value.findIndex(su => su.username === user.username);
  if (idx >= 0) {
    selectedUsers.value.splice(idx, 1);
  } else {
    selectedUsers.value.push({
      username: user.username,
      display_name: user.display_name || user.username,
      permission: defaultPermission.value,
    });
  }
  userSearchResults.value = userSearchResults.value.filter(
    u => !selectedUsers.value.some(su => su.username === u.username)
  );
}

function removeUser(idx: number) {
  selectedUsers.value.splice(idx, 1);
}

async function createShare() {
  error.value = '';
  creating.value = true;
  try {
    const body: any = {
      resource_type: props.resourceType,
      resource_id: Number(props.resourceId),
      resource_name: props.resourceName,
      share_type: selectedUsers.value.length > 0 ? 'user' : 'link',
      permission: defaultPermission.value,
      expiry_days: expiryDays.value,
      enable_preview_link: enablePreviewLink.value,
    };

    if (selectedUsers.value.length > 0) {
      body.target_users = selectedUsers.value.map(su => ({
        username: su.username,
        permission: su.permission,
      }));
    }

    const result = await api.post<any>('/share.php?action=share', body);
    shareResult.value = result;
    shareResultMessage.value = shareDetail.value ? '分享已更新' : '分享已创建';
    emit('created');
    emit('updated');

    // 切换到详情模式
    await loadShareDetail();
  } catch (e: any) {
    error.value = e.message || '创建分享失败';
  } finally {
    creating.value = false;
  }
}

async function updateUserPermission(permId: number, newPermission: string) {
  try {
    await api.post('/share.php?action=update-permission', {
      permission_id: permId,
      permission: newPermission,
    });
    await loadShareDetail();
  } catch (e: any) {
    alert(e.message || '更新权限失败');
  }
}

async function removeSharedUser(permId: number) {
  if (!confirm('确定移除此用户的分享权限？')) return;
  try {
    await api.post('/share.php?action=remove-user', { permission_id: permId });
    await loadShareDetail();
  } catch (e: any) {
    alert(e.message || '移除用户失败');
  }
}

async function resendInvite(perm: any) {
  try {
    // 重新邀请就是重新分享
    await api.post('/share.php?action=share', {
      resource_type: props.resourceType,
      resource_id: Number(props.resourceId),
      resource_name: props.resourceName,
      share_type: 'user',
      permission: defaultPermission.value,
      expiry_days: expiryDays.value,
      target_users: [{ username: perm.target_username, permission: perm.permission }],
    });
    await loadShareDetail();
  } catch (e: any) {
    alert(e.message || '重新邀请失败');
  }
}

async function togglePreviewLink() {
  if (!shareDetail.value) return;
  const newState = !shareDetail.value.preview_enabled;
  try {
    const result = await api.post<any>('/share.php?action=toggle-preview-link', {
      share_id: shareDetail.value.id,
      enable: newState,
    });
    await loadShareDetail();
  } catch (e: any) {
    alert(e.message || '操作失败');
  }
}

async function deleteShare() {
  if (!shareDetail.value) return;
  if (!confirm('确定删除此分享？所有被分享的用户将无法继续访问。')) return;
  deleting.value = true;
  try {
    await api.post('/share.php?action=delete-share', { share_id: shareDetail.value.id });
    shareDetail.value = null;
    mode.value = 'create';
    emit('updated');
  } catch (e: any) {
    alert(e.message || '删除失败');
  } finally {
    deleting.value = false;
  }
}

function onCancel() {
  if (shareDetail.value) {
    mode.value = 'detail';
  } else {
    emit('close');
  }
}

async function copyLink() {
  if (!shareResult.value?.preview_link) return;
  try {
    await navigator.clipboard.writeText(shareResult.value.preview_link);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    if (linkInput.value) {
      linkInput.value.select();
      document.execCommand('copy');
      copied.value = true;
      setTimeout(() => { copied.value = false; }, 2000);
    }
  }
}

async function copyPreviewLink() {
  if (!shareDetail.value?.preview_link) return;
  try {
    await navigator.clipboard.writeText(shareDetail.value.preview_link);
    previewCopied.value = true;
    setTimeout(() => { previewCopied.value = false; }, 2000);
  } catch { /* ignore */ }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return dateStr; }
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
  width: 480px;
  max-width: 90vw;
  max-height: 85vh;
  background: var(--layer-default);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.share-dialog.share-detail {
  width: 520px;
}

.share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
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
  flex: 1;
  overflow-y: auto;
}

/* 已分享状态栏 */
.share-status-bar {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2);
  background: rgba(16, 124, 16, 0.08);
  border: 1px solid rgba(16, 124, 16, 0.15);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--status-success);
  margin-bottom: var(--spacer-3);
}

.share-status-expiry {
  flex: 1;
  color: var(--text-tertiary);
}

.share-status-action {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}

.share-status-action:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
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

/* 用户搜索 */
.user-search-row {
  margin-bottom: var(--spacer-1);
}

.user-search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 8px;
  color: var(--text-tertiary);
}

.user-search-input {
  width: 100%;
  height: 32px;
  padding: 0 8px 0 26px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.user-search-input:focus {
  border-color: var(--accent-base);
}

.user-search-input::placeholder {
  color: var(--text-tertiary);
}

.user-search-results {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  margin-bottom: var(--spacer-1);
}

.user-result-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-1) var(--spacer-2);
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-primary);
}

.user-result-item:hover {
  background: var(--subtle-secondary);
}

.user-result-item.selected {
  background: var(--accent-bg);
  color: var(--accent-base);
}

.user-result-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-result-name {
  font-weight: 500;
}

.user-result-username {
  font-size: 10px;
  color: var(--text-tertiary);
}

.user-search-empty {
  padding: var(--spacer-2);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  text-align: center;
}

.check-icon {
  color: var(--accent-base);
}

/* 已选用户 */
.selected-users {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
  margin-bottom: var(--spacer-2);
}

.selected-user-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.selected-user-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  color: var(--text-primary);
}

.selected-user-username {
  color: var(--text-tertiary);
  font-size: 10px;
}

.selected-user-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.perm-select {
  height: 24px;
  padding: 0 4px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-xs);
  font-size: 10px;
  color: var(--text-primary);
  outline: none;
}

.remove-user-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-xs);
}

.remove-user-btn:hover {
  color: var(--status-error);
  background: rgba(220, 38, 38, 0.08);
}

/* 详情区域 */
.detail-section {
  margin-bottom: var(--spacer-3);
  padding-bottom: var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
}

.detail-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.detail-section-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacer-2);
}

/* 预览链接行 */
.preview-link-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.preview-link-status {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.toggle-label {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.toggle-btn {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--divider-stroke);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background var(--fast-duration);
  padding: 0;
}

.toggle-btn.on {
  background: var(--accent-base);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: var(--radius-full);
  transition: left var(--fast-duration);
}

.toggle-btn.on .toggle-knob {
  left: 18px;
}

.preview-link-copy {
  display: flex;
  gap: 4px;
}

.preview-link-input {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-sm);
  font-size: 10px;
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.link-copy-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.link-copy-btn:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

/* 已授权用户 */
.auth-users-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.auth-user-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.auth-user-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  color: var(--text-primary);
}

.auth-user-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.auth-user-status.accepted {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.auth-user-status.pending {
  background: rgba(255, 140, 0, 0.1);
  color: var(--status-warning);
}

.auth-user-status.rejected {
  background: rgba(220, 38, 38, 0.08);
  color: var(--status-error);
}

.auth-user-actions {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
}

.resend-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-xs);
}

.resend-btn:hover {
  color: var(--accent-base);
  background: var(--accent-bg);
}

.auth-users-empty {
  padding: var(--spacer-2);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  text-align: center;
}

/* 错误 */
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

/* 结果 */
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

/* 底部 */
.share-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
  flex-shrink: 0;
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

</style>