<template>
  <Teleport to="body">
    <transition name="slide-up">
      <div v-if="visible" class="join-overlay" @click.self="close">
        <div class="join-modal">
          <div class="modal-header">
            <div class="header-title">
              <Icon icon="ri-school-line" :size="20" />
              <span>加入学校</span>
            </div>
            <button class="close-btn" @click="close">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>

          <div class="modal-body">
            <!-- 视图：列出可申请学校 -->
            <div v-if="view === 'list'" class="view-list">
              <div class="search-bar">
                <Icon icon="ri-search-line" :size="14" />
                <input
                  v-model="keyword"
                  type="text"
                  placeholder="搜索学校名称..."
                />
              </div>

              <div v-if="loading" class="loading">
                <Icon icon="ri-loader-4-line" :size="20" class="spin" />
                <span>加载中...</span>
              </div>

              <div v-else-if="filteredSchools.length === 0" class="empty">
                <Icon icon="ri-inbox-line" :size="32" />
                <p v-if="keyword">未找到匹配的学校</p>
                <p v-else>暂无可申请加入的学校</p>
              </div>

              <div v-else class="school-list">
                <div
                  v-for="s in filteredSchools"
                  :key="s.id"
                  class="school-card"
                >
                  <div class="school-icon">
                    <Icon icon="ri-building-2-line" :size="20" />
                  </div>
                  <div class="school-info">
                    <div class="school-name">{{ s.name }}</div>
                    <div class="school-meta">
                      <span v-if="s.short_name">{{ s.short_name }}</span>
                      <span v-if="s.address" class="dot">·</span>
                      <span v-if="s.address">{{ s.address }}</span>
                    </div>
                  </div>
                  <button
                    class="apply-btn"
                    :disabled="applyingId === s.id"
                    @click="onApply(s)"
                  >
                    <Icon
                      :icon="applyingId === s.id ? 'ri-loader-4-line' : 'ri-add-line'"
                      :size="14"
                      :class="{ spin: applyingId === s.id }"
                    />
                    <span>{{ applyingId === s.id ? '提交中' : '申请加入' }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 视图：申请表单（输入展示名） -->
            <div v-else-if="view === 'form'" class="view-form">
              <div class="selected-school">
                <Icon icon="ri-arrow-left-line" :size="16" class="back-icon" @click="backToList" />
                <div class="school-icon">
                  <Icon icon="ri-building-2-line" :size="20" />
                </div>
                <div class="school-info">
                  <div class="school-name">{{ selectedSchool?.name }}</div>
                  <div class="school-meta">{{ selectedSchool?.short_name || '学校' }}</div>
                </div>
              </div>

              <div class="form-field">
                <label>展示名称 <span class="hint">（学校管理员将看到）</span></label>
                <input
                  ref="nameInput"
                  v-model="displayName"
                  type="text"
                  placeholder="请输入你的真实姓名或昵称"
                />
              </div>

              <div class="form-tip">
                <Icon icon="ri-information-line" :size="14" />
                <span>提交后学校管理员审批通过即视为加入成功</span>
              </div>

              <div class="form-actions">
                <button class="btn-ghost" @click="backToList">取消</button>
                <button class="btn-primary" :disabled="submitting" @click="submit">
                  <Icon
                    :icon="submitting ? 'ri-loader-4-line' : 'ri-send-plane-line'"
                    :size="14"
                    :class="{ spin: submitting }"
                  />
                  <span>{{ submitting ? '提交中' : '提交申请' }}</span>
                </button>
              </div>
            </div>

            <!-- 视图：已提交申请列表 -->
            <div v-else-if="view === 'requests'" class="view-requests">
              <div v-if="myRequests.length === 0" class="empty">
                <Icon icon="ri-inbox-line" :size="32" />
                <p>暂无加入申请</p>
              </div>
              <div v-else class="request-list">
                <div v-for="r in myRequests" :key="r.id" class="request-row">
                  <div class="request-info">
                    <div class="request-school">{{ r.school_name }}</div>
                    <div class="request-time">提交于 {{ r.created_at }}</div>
                  </div>
                  <span class="status-badge" :class="r.status">
                    {{ statusLabel(r.status) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="footer-tab" :class="{ active: view === 'list' }" @click="setView('list')">
              <Icon icon="ri-list-check" :size="14" />
              <span>学校列表</span>
            </button>
            <button class="footer-tab" :class="{ active: view === 'requests' }" @click="setView('requests')">
              <Icon icon="ri-mail-send-line" :size="14" />
              <span>我的申请</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { schoolsApi } from '../../api';
import { useAuth } from '../../composables/useAuth';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'joined', schoolId: number): void;
}>();

const { user } = useAuth();

const view = ref<'list' | 'form' | 'requests'>('list');
const keyword = ref('');
const loading = ref(false);
const schools = ref<any[]>([]);
const myRequests = ref<any[]>([]);
const selectedSchool = ref<any>(null);
const displayName = ref('');
const applyingId = ref<number | null>(null);
const submitting = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);

const filteredSchools = computed(() => {
  if (!keyword.value.trim()) return schools.value;
  const k = keyword.value.toLowerCase();
  return schools.value.filter(s =>
    (s.name || '').toLowerCase().includes(k) ||
    (s.short_name || '').toLowerCase().includes(k)
  );
});

function statusLabel(status: string): string {
  if (status === 'pending') return '待审批';
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已拒绝';
  return status;
}

async function loadAll() {
  loading.value = true;
  try {
    const [all, reqs] = await Promise.all([
      schoolsApi.all(),
      schoolsApi.myRequests().catch(() => [])
    ]);
    schools.value = (all as any[]) || [];
    myRequests.value = (reqs as any[]) || [];
  } catch (e) {
    console.error('加载学校列表失败', e);
  } finally {
    loading.value = false;
  }
}

async function loadRequests() {
  try {
    const reqs = await schoolsApi.myRequests();
    myRequests.value = (reqs as any[]) || [];
  } catch (e) {
    console.error(e);
  }
}

function onApply(s: any) {
  selectedSchool.value = s;
  displayName.value = user.value?.display_name || user.value?.username || '';
  view.value = 'form';
  nextTick(() => nameInput.value?.focus());
}

function backToList() {
  view.value = 'list';
  selectedSchool.value = null;
}

async function submit() {
  if (!selectedSchool.value) return;
  if (!displayName.value.trim()) {
    return;
  }
  submitting.value = true;
  try {
    await schoolsApi.requestJoin(selectedSchool.value.id, displayName.value.trim());
    await loadRequests();
    view.value = 'requests';
    selectedSchool.value = null;
  } catch (e) {
    console.error(e);
  } finally {
    submitting.value = false;
  }
}

function setView(v: 'list' | 'form' | 'requests') {
  if (v === 'requests') {
    loadRequests();
  }
  view.value = v;
}

function close() {
  emit('close');
}

watch(() => props.visible, (v) => {
  if (v) {
    loadAll();
    view.value = 'list';
    keyword.value = '';
  }
});
</script>

<style scoped>
.join-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.join-modal {
  width: 560px;
  max-width: 92vw;
  max-height: 80vh;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4) var(--spacer-5);
  border-bottom: 1px solid var(--divider-stroke);
}

.header-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
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

.close-btn:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacer-4) var(--spacer-5);
}

.search-bar {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacer-4);
  color: var(--text-tertiary);
}

.search-bar input {
  flex: 1;
  height: 36px;
  border: none;
  background: transparent;
  outline: none;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-8) var(--spacer-4);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.school-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.school-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  transition: background var(--fast-duration);
}

.school-card:hover {
  background: var(--subtle-pressed);
}

.school-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  color: var(--accent-base);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.school-info {
  flex: 1;
  min-width: 0;
}

.school-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.school-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.school-meta .dot {
  margin: 0 4px;
}

.apply-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-1) var(--spacer-3);
  background: var(--accent-base);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--fast-duration);
  flex-shrink: 0;
}

.apply-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.apply-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.selected-school {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacer-4);
}

.back-icon {
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.back-icon:hover {
  color: var(--text-primary);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
  margin-bottom: var(--spacer-3);
}

.form-field label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.form-field label .hint {
  color: var(--text-tertiary);
  font-weight: 400;
}

.form-field input {
  height: 40px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
}

.form-field input:focus {
  border-color: var(--accent-base);
}

.form-tip {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(0, 103, 192, 0.06);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--accent-base);
  margin-bottom: var(--spacer-4);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
}

.btn-ghost,
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background var(--fast-duration);
}

.btn-ghost {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.request-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.request-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.request-school {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.request-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.status-badge {
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: var(--spacer-1) var(--spacer-2);
  border-radius: var(--radius-full);
}

.status-badge.pending {
  background: rgba(202, 138, 4, 0.12);
  color: var(--status-warning);
}

.status-badge.approved {
  background: rgba(16, 124, 16, 0.12);
  color: var(--status-success);
}

.status-badge.rejected {
  background: rgba(196, 43, 28, 0.12);
  color: var(--status-error);
}

.modal-footer {
  display: flex;
  border-top: 1px solid var(--divider-stroke);
}

.footer-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-3);
  background: transparent;
  border: none;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.footer-tab:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.footer-tab.active {
  color: var(--accent-base);
  font-weight: 600;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: opacity var(--fast-duration);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
}

.slide-up-enter-active .join-modal,
.slide-up-leave-active .join-modal {
  transition: transform var(--fast-duration);
}

.slide-up-enter-from .join-modal,
.slide-up-leave-to .join-modal {
  transform: translateY(20px);
}
</style>
