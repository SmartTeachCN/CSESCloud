<template>
  <div class="notification-page">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">通知中心</h1>
        <p class="page-description">查看系统通知、活动提醒和重要消息</p>
      </div>
      <div class="page-header-right">
        <button
          v-if="canSendNotification"
          class="btn btn-primary"
          @click="showSendDialog = true"
        >
          <Icon icon="ri-send-plane-line" :size="14" />
          下发通知
        </button>
        <button class="btn btn-ghost" @click="markAllRead" :disabled="unreadCount === 0 || busy">
          <Icon icon="ri-check-double-line" :size="14" />
          全部标记已读
        </button>
      </div>
    </div>

    <div class="tabs-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.count > 0" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      <Icon icon="ri-loader-4-line" :size="24" class="spin" />
      <span>加载中...</span>
    </div>

    <div v-else class="notification-list">
      <div
        v-for="item in filteredNotifications"
        :key="item.id"
        class="notification-item"
        :class="{ unread: !item.is_read, [item.type]: true }"
      >
        <div class="notif-icon" :class="item.target_type?.startsWith('share') ? item.target_type : item.type">
          <Icon :icon="getIcon(item.target_type?.startsWith('share') ? item.target_type : item.type)" :size="18" />
        </div>
        <div class="notif-content">
          <div class="notif-header">
            <span class="notif-title">{{ item.title }}</span>
            <span class="notif-time">{{ formatTime(item.created_at) }}</span>
          </div>
          <div class="notif-body">{{ item.content }}</div>
          <div class="notif-meta">
            <span class="notif-category">{{ getTypeLabel(item.type) }}</span>
            <span v-if="item.sender_name" class="notif-sender">
              <Icon icon="ri-user-line" :size="12" />
              {{ item.sender_name }}
            </span>
            <span class="notif-target">{{ getTargetLabel(item) }}</span>
          </div>
        </div>
        <div class="notif-actions">
          <template v-if="item.target_type === 'share_invite' && item.share_id">
            <button class="share-action-btn accept" @click="acceptShare(item)" :disabled="busy">
              <Icon icon="ri-check-line" :size="14" /> 接受
            </button>
            <button class="share-action-btn reject" @click="rejectShare(item)" :disabled="busy">
              <Icon icon="ri-close-line" :size="14" /> 拒绝
            </button>
          </template>
          <template v-else>
            <button
              class="icon-btn-sm"
              :title="item.is_read ? '标记为未读' : '标记为已读'"
              @click="toggleRead(item)"
            >
              <Icon :icon="item.is_read ? 'ri-mail-unread-line' : 'ri-mail-check-line'" :size="14" />
            </button>
            <button class="icon-btn-sm" title="删除" @click="deleteNotification(item.id)">
              <Icon icon="ri-delete-bin-line" :size="14" />
            </button>
          </template>
        </div>
      </div>

      <div v-if="filteredNotifications.length === 0" class="empty-state">
        <div class="empty-icon"><Icon icon="ri-inbox-line" :size="48" /></div>
        <div class="empty-text">暂无{{ activeTab === 'unread' ? '未读' : '' }}通知</div>
      </div>
    </div>

    <!-- 下发通知对话框 -->
    <Teleport to="body">
      <div v-if="showSendDialog" class="dialog-overlay" @click.self="showSendDialog = false">
        <div class="dialog dialog-wide">
          <div class="dialog-header">
            <h3>
              <Icon icon="ri-send-plane-line" :size="18" />
              下发通知
            </h3>
            <button class="dialog-close" @click="showSendDialog = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>通知类型</label>
              <div class="type-options">
                <label
                  v-for="t in notifTypes"
                  :key="t.value"
                  class="type-option"
                  :class="{ active: sendForm.type === t.value }"
                >
                  <input type="radio" v-model="sendForm.type" :value="t.value" hidden />
                  <Icon :icon="t.icon" :size="16" />
                  {{ t.label }}
                </label>
              </div>
            </div>
            <div class="form-group">
              <label>通知标题 <span class="required">*</span></label>
              <input v-model="sendForm.title" placeholder="输入通知标题" maxlength="100" />
            </div>
            <div class="form-group">
              <label>通知内容</label>
              <textarea
                v-model="sendForm.content"
                placeholder="输入通知内容"
                rows="3"
                maxlength="500"
              ></textarea>
            </div>
            <div class="form-group">
              <label>通知对象</label>
              <div class="target-options">
                <label
                  v-for="t in targetOptions"
                  :key="t.value"
                  class="target-option"
                  :class="{ active: sendForm.target_type === t.value }"
                >
                  <input type="radio" v-model="sendForm.target_type" :value="t.value" hidden />
                  <Icon :icon="t.icon" :size="16" />
                  {{ t.label }}
                </label>
              </div>
            </div>
            <div class="form-group" v-if="sendForm.target_type !== 'all'">
              <label>
                {{ sendForm.target_type === 'role' ? '选择角色' : sendForm.target_type === 'class' ? '选择班级' : '选择用户' }}
              </label>
              <select v-model="sendForm.target_id">
                <option value="">-- 请选择 --</option>
                <option
                  v-for="opt in targetList"
                  :key="opt.value"
                  :value="opt.value"
                >{{ opt.label }}</option>
              </select>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click="showSendDialog = false">取消</button>
            <button class="btn btn-primary" @click="sendNotification" :disabled="sendBusy || !sendForm.title">
              <Icon icon="ri-send-plane-line" :size="14" />
              {{ sendBusy ? '发送中...' : '发送通知' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { notificationsApi } from '../../api';
import { api } from '../../api/client';
import { useAuth } from '../../composables/useAuth';

const { user } = useAuth();

interface Notification {
  id: number;
  school_id: number;
  sender_id: number | null;
  sender_name: string | null;
  type: string;
  title: string;
  content: string;
  target_type: string;
  target_id: string | null;
  share_id: number | null;
  is_read: number | null;
  read_at: string | null;
  created_at: string;
}

const activeTab = ref<'all' | 'unread' | 'system' | 'info'>('all');
const loading = ref(false);
const busy = ref(false);
const notifications = ref<Notification[]>([]);
const stats = ref({ unread: 0, today: 0, week: 0, total: 0 });

// 下发通知
const showSendDialog = ref(false);
const sendBusy = ref(false);
const recipients = ref<any>({ roles: [], classes: [], users: [] });
const sendForm = ref({
  type: 'info',
  title: '',
  content: '',
  target_type: 'all',
  target_id: '',
});

const notifTypes = [
  { value: 'info', label: '信息', icon: 'ri-information-line' },
  { value: 'success', label: '成功', icon: 'ri-checkbox-circle-line' },
  { value: 'warning', label: '警告', icon: 'ri-error-warning-line' },
  { value: 'system', label: '系统', icon: 'ri-settings-3-line' },
];

const targetOptions = [
  { value: 'all', label: '全体成员', icon: 'ri-group-line' },
  { value: 'role', label: '按角色', icon: 'ri-shield-user-line' },
  { value: 'class', label: '按班级', icon: 'ri-building-line' },
  { value: 'user', label: '指定用户', icon: 'ri-user-line' },
];

const targetList = computed(() => {
  const t = sendForm.value.target_type;
  if (t === 'role') return recipients.value.roles || [];
  if (t === 'class') return recipients.value.classes || [];
  if (t === 'user') return recipients.value.users || [];
  return [];
});

const canSendNotification = computed(() => {
  if (!user.value) return false;
  return user.value.role === 'admin' || user.value.is_super_admin || user.value.is_temp_admin;
});

const unreadCount = computed(() => stats.value.unread);

const tabs = computed(() => [
  { key: 'all' as const, label: '全部', count: notifications.value.length },
  { key: 'unread' as const, label: '未读', count: notifications.value.filter(n => !n.is_read).length },
  { key: 'system' as const, label: '系统', count: notifications.value.filter(n => n.type === 'system').length },
  { key: 'info' as const, label: '信息', count: notifications.value.filter(n => n.type === 'info' || n.type === 'success' || n.type === 'warning').length }
]);

const filteredNotifications = computed(() => {
  const items = notifications.value;
  switch (activeTab.value) {
    case 'unread': return items.filter(n => !n.is_read);
    case 'system': return items.filter(n => n.type === 'system');
    case 'info': return items.filter(n => n.type !== 'system');
    default: return items;
  }
});

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    system: '系统',
    info: '信息',
    warning: '警告',
    success: '成功',
  };
  return labels[type] || type;
}

function getTargetLabel(item: Notification): string {
  const labels: Record<string, string> = {
    all: '全体成员', role: '按角色', class: '按班级', user: '指定用户',
    share_invite: '分享邀请', share_accepted: '已接受分享', share_rejected: '已拒绝分享'
  };
  return labels[item.target_type] || item.target_type;
}

function getIcon(type: string): string {
  const icons: Record<string, string> = {
    info: 'ri-information-line',
    success: 'ri-checkbox-circle-line',
    warning: 'ri-error-warning-line',
    system: 'ri-settings-3-line',
    share_invite: 'ri-share-forward-line',
    share_accepted: 'ri-check-double-line',
    share_rejected: 'ri-close-circle-line',
  };
  return icons[type] || 'ri-information-line';
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const ts = new Date(dateStr).getTime();
  const diff = now - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + ' 天前';
  return dateStr.slice(0, 10);
}

async function loadNotifications() {
  loading.value = true;
  try {
    const [list, statData] = await Promise.all([
      notificationsApi.list(),
      notificationsApi.stats()
    ]);
    notifications.value = list;
    stats.value = statData;
  } catch (e: any) {
    console.error('加载通知失败:', e);
  } finally {
    loading.value = false;
  }
}

async function toggleRead(item: Notification) {
  busy.value = true;
  try {
    await notificationsApi.markRead(item.id);
    item.is_read = item.is_read ? 0 : 1;
    stats.value.unread = notifications.value.filter(n => !n.is_read).length;
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function markAllRead() {
  busy.value = true;
  try {
    await notificationsApi.markRead();
    notifications.value.forEach(n => n.is_read = 1);
    stats.value.unread = 0;
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function deleteNotification(id: number) {
  busy.value = true;
  try {
    await notificationsApi.delete(id);
    notifications.value = notifications.value.filter(n => n.id !== id);
    stats.value.total--;
    stats.value.unread = notifications.value.filter(n => !n.is_read).length;
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function acceptShare(item: Notification) {
  if (!item.share_id) return;
  busy.value = true;
  try {
    await api.post('/share?action=accept', { share_id: item.share_id });
    // 更新通知状态
    item.target_type = 'share_accepted';
    item.is_read = 1;
    alert('已接受分享');
    await loadNotifications();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function rejectShare(item: Notification) {
  if (!item.share_id) return;
  busy.value = true;
  try {
    await api.post('/share?action=reject', { share_id: item.share_id });
    // 更新通知状态
    item.target_type = 'share_rejected';
    item.is_read = 1;
    alert('已拒绝分享');
    await loadNotifications();
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

async function loadRecipients() {
  try {
    recipients.value = await notificationsApi.recipients();
  } catch (e) {
    console.error('加载通知目标失败:', e);
  }
}

async function sendNotification() {
  if (!sendForm.value.title) return;
  sendBusy.value = true;
  try {
    await notificationsApi.create({
      type: sendForm.value.type,
      title: sendForm.value.title,
      content: sendForm.value.content,
      target_type: sendForm.value.target_type,
      target_id: sendForm.value.target_id || null,
    });
    showSendDialog.value = false;
    sendForm.value = { type: 'info', title: '', content: '', target_type: 'all', target_id: '' };
    await loadNotifications();
  } catch (e: any) {
    alert(e.message || '发送失败');
  } finally {
    sendBusy.value = false;
  }
}

watch(showSendDialog, (val) => {
  if (val) loadRecipients();
});

onMounted(loadNotifications);
</script>

<style scoped>
.notification-page {
  padding: var(--spacer-5);
  max-width: 900px;
  margin: 0 auto;
}

.tabs-bar {
  display: flex;
  gap: var(--spacer-1);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  padding: var(--spacer-1);
  margin-bottom: var(--spacer-4);
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 var(--spacer-1);
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  border-radius: var(--radius-full);
  transition: background var(--fast-duration), color var(--fast-duration);
}

.tab:hover .tab-count {
  background: var(--subtle-pressed);
  color: var(--text-secondary);
}

.tab.active .tab-count {
  background: var(--accent-text);
  color: var(--accent-base);
  font-weight: 700;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-12);
  color: var(--text-tertiary);
}

.notification-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.notification-item {
  display: flex;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  transition: box-shadow var(--fast-duration), background var(--fast-duration);
}

.notification-item:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.notification-item.unread {
  border-left: 3px solid var(--accent-base);
}

.notification-item.unread .notif-title {
  font-weight: 600;
}

.notif-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.notif-icon.info {
  background: rgba(0, 103, 192, 0.1);
  color: #0067C0;
}

.notif-icon.success {
  background: rgba(16, 124, 16, 0.1);
  color: #107C10;
}

.notif-icon.warning {
  background: rgba(202, 143, 4, 0.1);
  color: #CA8F04;
}

.notif-icon.system {
  background: rgba(100, 100, 100, 0.1);
  color: #666;
}

.notif-icon.share_invite {
  background: rgba(0, 103, 192, 0.1);
  color: var(--accent-base);
}

.notif-icon.share_accepted {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.notif-icon.share_rejected {
  background: rgba(220, 38, 38, 0.08);
  color: var(--status-error);
}

.notif-content {
  flex: 1;
  min-width: 0;
}

.notif-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacer-3);
}

.notif-title {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.notif-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.notif-body {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-top: var(--spacer-1);
  line-height: 1.5;
}

.notif-meta {
  display: flex;
  gap: var(--spacer-3);
  margin-top: var(--spacer-2);
  flex-wrap: wrap;
  align-items: center;
}

.notif-category {
  font-size: var(--font-size-xs);
  font-weight: 500;
  padding: 2px var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-full);
  color: var(--text-tertiary);
}

.notif-sender {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.notif-target {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.notif-actions {
  display: flex;
  gap: var(--spacer-1);
  flex-shrink: 0;
}

.icon-btn-sm {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.icon-btn-sm:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.share-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
}

.share-action-btn.accept {
  background: rgba(16, 124, 16, 0.1);
  color: var(--status-success);
}

.share-action-btn.accept:hover {
  background: rgba(16, 124, 16, 0.2);
}

.share-action-btn.reject {
  background: rgba(220, 38, 38, 0.08);
  color: var(--status-error);
}

.share-action-btn.reject:hover {
  background: rgba(220, 38, 38, 0.15);
}

.share-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: var(--spacer-12);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: var(--spacer-3);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

/* 对话框 */
.dialog {
  width: 100%;
  max-width: 520px;
  background: var(--flyout-bg, var(--card-bg));
  backdrop-filter: var(--flyout-backdrop, none);
  border: 1px solid var(--flyout-border, var(--card-stroke));
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.dialog-wide {
  max-width: 560px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-4) var(--spacer-5);
  border-bottom: 1px solid var(--divider-stroke);
}

.dialog-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.dialog-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.dialog-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.dialog-body {
  padding: var(--spacer-5);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4) var(--spacer-5);
  border-top: 1px solid var(--divider-stroke);
}

.required {
  color: var(--status-error, #C42B1C);
}

.type-options,
.target-options {
  display: flex;
  gap: var(--spacer-2);
  flex-wrap: wrap;
}

.type-option,
.target-option {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.type-option:hover,
.target-option:hover {
  background: var(--subtle-secondary);
}

.type-option.active,
.target-option.active {
  border-color: var(--accent-base);
  background: var(--accent-bg, rgba(0, 103, 192, 0.04));
  color: var(--accent-base);
}

@media (max-width: 600px) {
  .notification-item {
    flex-wrap: wrap;
  }
  .notif-actions {
    width: 100%;
    justify-content: flex-end;
    margin-top: var(--spacer-2);
  }
}
</style>