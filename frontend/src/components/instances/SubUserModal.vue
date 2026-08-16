<template>
  <Teleport to="body">
    <transition name="modal-fade">
      <div v-if="visible" class="sub-modal-overlay" @click.self="onClose">
        <div class="sub-modal-card">
          <div class="modal-header">
            <div class="header-left">
              <Icon icon="ri-user-settings-line" :size="20" />
              <div>
                <h3>实例子用户编辑</h3>
                <p class="header-sub">您当前以子用户身份访问此实例</p>
              </div>
            </div>
            <button class="modal-close" @click="onClose">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <div class="user-info-card">
              <div class="user-avatar">
                <Icon icon="ri-user-line" :size="32" />
              </div>
              <div class="user-meta">
                <div class="user-name">{{ user?.display_name || user?.username || '子用户' }}</div>
                <div class="user-tags">
                  <span class="tag tag-role">{{ roleLabel }}</span>
                  <span class="tag tag-school">{{ user?.school_name || '默认学校' }}</span>
                  <span class="tag tag-instance">
                    <Icon icon="ri-hashtag" :size="10" />
                    {{ user?.instance_uid || `#${user?.instance_id}` }}
                  </span>
                </div>
              </div>
            </div>
            <div class="modal-section">
              <div class="section-title">编辑范围（受主用户授权限制）</div>
              <div class="perm-grid">
                <label class="perm-item" v-for="p in permissions" :key="p.key">
                  <input type="checkbox" v-model="p.value" :disabled="!canEdit" />
                  <div class="perm-info">
                    <div class="perm-label">{{ p.label }}</div>
                    <div class="perm-desc">{{ p.desc }}</div>
                  </div>
                </label>
              </div>
            </div>
            <div class="modal-section">
              <div class="section-title">备注（仅自己可见）</div>
              <textarea
                v-model="note"
                :disabled="!canEdit"
                class="note-textarea"
                placeholder="可在此记录关于实例的笔记..."
              ></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="onClose">关闭</button>
            <button class="btn btn-primary" :disabled="saving || !canEdit" @click="submit">
              <Icon v-if="saving" icon="ri-loader-4-line" :size="14" class="spin" />
              <span>保存并继续编辑</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { storageApi } from '../../api';

const props = defineProps<{
  visible: boolean;
  user?: any;
  instance?: any;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', payload: any): void;
}>();

const saving = ref(false);
const note = ref('');
const permissions = ref([
  { key: 'edit_config', label: '修改实例配置', desc: '允许修改实例属性和参数', value: false },
  { key: 'edit_content', label: '修改内容', desc: '允许编辑实例内容/数据', value: true },
  { key: 'share', label: '共享实例', desc: '允许将实例共享给其他用户', value: false },
  { key: 'export', label: '导出数据', desc: '允许导出实例数据', value: true }
]);

const canEdit = computed(() => props.instance?.can_write !== false);

const roleLabel = computed(() => {
  const r = props.user?.role || 'teacher';
  return { admin: '管理员', teacher: '教师', student: '学生' }[r] || r;
});

watch(() => props.visible, v => {
  if (v) loadNote();
});

async function loadNote() {
  // 子用户的私有笔记存于 storage：sub:notes 集合
  try {
    const list = await storageApi.list(props.instance?.id || 0, 'sub:notes');
    if (list && list.length > 0) {
      note.value = list[0].data?.note || '';
    } else {
      note.value = '';
    }
  } catch {
    note.value = '';
  }
}

function onClose() {
  emit('close');
}

async function submit() {
  saving.value = true;
  try {
    await storageApi.save(props.instance?.id || 0, 'sub:notes', {
      record_id: `note_${props.user?.user_id || 0}`,
      data: {
        note: note.value,
        permissions: permissions.value.filter(p => p.value).map(p => p.key)
      }
    });
    emit('saved', {
      note: note.value,
      permissions: permissions.value.filter(p => p.value).map(p => p.key)
    });
    emit('close');
  } catch (e: any) {
    alert(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.sub-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  backdrop-filter: blur(2px);
}

.sub-modal-card {
  background: var(--layer-default);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-lg);
  width: 520px;
  max-width: 92vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
}

.modal-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.header-sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: 2px 0 0;
}

.modal-close {
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

.modal-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--spacer-4);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.user-info-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
}

.user-avatar {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-base);
  color: white;
}

.user-name {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.user-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  font-weight: 500;
}

.tag-role { background: var(--accent-bg); color: var(--accent-base); }
.tag-school { background: rgba(16,124,16,0.1); color: var(--status-success); }
.tag-instance { background: var(--subtle-pressed); color: var(--text-primary); font-family: var(--font-mono, monospace); }

.modal-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.section-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.perm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacer-2);
}

.perm-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.perm-item input[type="checkbox"] {
  margin-top: 2px;
  accent-color: var(--accent-base);
}

.perm-info {
  flex: 1;
}

.perm-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-primary);
}

.perm-desc {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.note-textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
}

.note-textarea:focus {
  border-color: var(--accent-base);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4);
  border-top: 1px solid var(--divider-stroke);
}

.btn {
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
}

.btn-primary { background: var(--accent-base); color: white; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--divider-stroke); }
.btn-ghost:hover { background: var(--subtle-secondary); }

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.modal-fade-enter-active, .modal-fade-leave-active {
  transition: opacity var(--fast-duration);
}

.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
}
</style>
