<template>
  <div class="instance-list" @click="clearContextMenu">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">实例云控</h1>
        <p class="page-description">在云端管理单个实例 · 多选后可批量操作</p>
      </div>
      <div class="page-header-right">
        <div class="search-bar">
          <Icon icon="ri-search-line" class="search-icon" :size="14" />
          <input type="text" v-model="searchQuery" placeholder="搜索实例..." />
        </div>
        <button class="btn btn-primary" @click="showCreateModal = true">
          <Icon icon="ri-add-line" :size="16" />
          <span>新建实例</span>
        </button>
      </div>
    </div>

    <!-- 概览统计 -->
    <div class="overview-cards">
      <div class="overview-card">
        <div class="overview-icon" style="background: rgba(0,103,192,0.1); color: var(--accent-base);">
          <Icon icon="ri-cloud-line" :size="20" />
        </div>
        <div class="overview-meta">
          <div class="overview-value">{{ instances.length }}</div>
          <div class="overview-label">实例总数</div>
        </div>
      </div>
      <div class="overview-card">
        <div class="overview-icon" style="background: rgba(16,124,16,0.1); color: var(--status-success);">
          <Icon icon="ri-play-circle-line" :size="20" />
        </div>
        <div class="overview-meta">
          <div class="overview-value">{{ runningCount }}</div>
          <div class="overview-label">运行中</div>
        </div>
      </div>
      <div class="overview-card">
        <div class="overview-icon" style="background: rgba(196,43,28,0.1); color: var(--status-error);">
          <Icon icon="ri-pause-circle-line" :size="20" />
        </div>
        <div class="overview-meta">
          <div class="overview-value">{{ stoppedCount }}</div>
          <div class="overview-label">已停止</div>
        </div>
      </div>
      <div class="overview-card">
        <div class="overview-icon" style="background: rgba(120,90,240,0.1); color: #785AF0;">
          <Icon icon="ri-folder-line" :size="20" />
        </div>
        <div class="overview-meta">
          <div class="overview-value">{{ groups.length }}</div>
          <div class="overview-label">分组数量</div>
        </div>
      </div>
    </div>

    <!-- 多选操作栏 -->
    <transition name="fade">
      <div v-if="selectedIds.length > 0" class="batch-bar">
        <div class="batch-info">
          <Icon icon="ri-checkbox-multiple-line" :size="16" />
          <span>已选择 {{ selectedIds.length }} 个实例</span>
        </div>
        <div class="batch-actions">
          <button class="batch-btn" @click="batchAction('start')">
            <Icon icon="ri-play-line" :size="14" /> 启动
          </button>
          <button class="batch-btn" @click="batchAction('stop')">
            <Icon icon="ri-pause-line" :size="14" /> 停止
          </button>
          <button class="batch-btn" @click="batchAction('restart')">
            <Icon icon="ri-refresh-line" :size="14" /> 重启
          </button>
          <button class="batch-btn" @click="batchAction('move')">
            <Icon icon="ri-folder-transfer-line" :size="14" /> 移动到分组
          </button>
          <button class="batch-btn batch-danger" @click="batchAction('delete')">
            <Icon icon="ri-delete-bin-line" :size="14" /> 删除
          </button>
          <button class="batch-btn batch-ghost" @click="clearSelection">
            <Icon icon="ri-close-line" :size="14" /> 取消
          </button>
        </div>
      </div>
    </transition>

    <!-- 实例卡片（按分组渲染） -->
    <div v-if="filteredInstances.length > 0" class="groups-container">
      <!-- 未分组 -->
      <div
        v-if="ungroupedInstances.length > 0"
        class="group-section"
        @dragover.prevent="onDragOver($event, null)"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop($event, null)"
      >
        <div class="group-header">
          <Icon icon="ri-inbox-line" :size="16" />
          <span>未分组</span>
          <span class="group-count">{{ ungroupedInstances.length }}</span>
        </div>
        <div class="instance-grid">
          <InstanceCard
            v-for="inst in ungroupedInstances"
            :key="inst.id"
            :instance="inst"
            :selected="selectedIds.includes(inst.id)"
            @toggle-select="toggleSelect(inst.id)"
            @click="enterEditor(inst)"
            @contextmenu="openContextMenu($event, inst)"
            @dragstart="onDragStart($event, inst)"
            @dragend="onDragEnd"
          />
        </div>
      </div>

      <!-- 各分组 -->
      <div
        v-for="group in groupsWithInstances"
        :key="group.id"
        class="group-section"
        :class="{ 'drag-over': dragOverGroupId === group.id }"
        @dragover.prevent="onDragOver($event, group.id)"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop($event, group.id)"
      >
        <div class="group-header">
          <Icon icon="ri-folder-line" :size="16" />
          <span>{{ group.name }}</span>
          <span class="group-count">{{ group.instance_count }}</span>
          <button class="group-action" @click="openGroupMenu($event, group)" title="更多">
            <Icon icon="ri-more-2-line" :size="14" />
          </button>
        </div>
        <div class="instance-grid">
          <InstanceCard
            v-for="inst in groupInstances(group.id)"
            :key="inst.id"
            :instance="inst"
            :selected="selectedIds.includes(inst.id)"
            @toggle-select="toggleSelect(inst.id)"
            @click="enterEditor(inst)"
            @contextmenu="openContextMenu($event, inst)"
            @dragstart="onDragStart($event, inst)"
            @dragend="onDragEnd"
          />
          <button class="add-to-group-btn" @click="showCreateModal = true">
            <Icon icon="ri-add-line" :size="20" />
            <span>新建实例</span>
          </button>
        </div>
      </div>

      <!-- 新建分组按钮 -->
      <button class="new-group-btn" @click="showCreateGroupModal = true">
        <Icon icon="ri-folder-add-line" :size="16" />
        <span>新建分组</span>
      </button>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!loading" class="empty-state">
      <div class="empty-icon">
        <Icon icon="ri-cloud-off-line" :size="48" />
      </div>
      <div class="empty-text">暂无可见实例</div>
      <div class="empty-sub">通过「新建实例」开始创建你的第一个实例</div>
      <button class="btn btn-primary" @click="showCreateModal = true">
        <Icon icon="ri-add-line" :size="16" />
        <span>新建实例</span>
      </button>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="enterEditor(contextMenu.instance)">
          <Icon icon="ri-edit-box-line" :size="14" /> 进入编辑器
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item" @click="callInstanceAction('start')">
          <Icon icon="ri-play-line" :size="14" /> 启动
        </button>
        <button class="ctx-item" @click="callInstanceAction('stop')">
          <Icon icon="ri-pause-line" :size="14" /> 停止
        </button>
        <button class="ctx-item" @click="callInstanceAction('restart')">
          <Icon icon="ri-refresh-line" :size="14" /> 重启
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item" @click="copyInstanceUid">
          <Icon icon="ri-clipboard-line" :size="14" /> 复制实例 ID
        </button>
        <button class="ctx-item" @click="openShareModal(contextMenu.instance)">
          <Icon icon="ri-share-line" :size="14" /> 共享实例
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item ctx-danger" @click="callInstanceAction('delete')">
          <Icon icon="ri-delete-bin-line" :size="14" /> 删除
        </button>
      </div>
    </Teleport>

    <!-- 新建实例模态框 -->
    <InstanceCreateModal
      v-if="showCreateModal"
      :groups="groups"
      @close="showCreateModal = false"
      @created="onInstanceCreated"
    />

    <!-- 新建分组模态框 -->
    <Teleport to="body">
      <div v-if="showCreateGroupModal" class="modal-overlay" @click.self="showCreateGroupModal = false">
        <div class="modal-card">
          <div class="modal-header">
            <h3>新建实例分组</h3>
            <button class="modal-close" @click="showCreateGroupModal = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>分组名称</label>
              <input v-model="newGroupName" type="text" placeholder="例如：教学班级" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="showCreateGroupModal = false">取消</button>
            <button class="btn btn-primary" @click="createGroup">创建</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 共享模态框 -->
    <Teleport to="body">
      <div v-if="shareModal.instance" class="modal-overlay" @click.self="shareModal.instance = null">
        <div class="modal-card">
          <div class="modal-header">
            <h3>共享实例</h3>
            <button class="modal-close" @click="shareModal.instance = null">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-tip">
              <Icon icon="ri-information-line" :size="14" />
              <span>实例「{{ shareModal.instance?.name }}」共享后，目标用户可在其列表中看到此实例。</span>
            </p>
            <div class="form-group">
              <label>目标用户类型</label>
              <select v-model="shareForm.target_type">
                <option value="alliance">智教联盟账户</option>
                <option value="sub">学校子用户</option>
              </select>
            </div>
            <div class="form-group">
              <label>目标用户 ID（0 表示所有联盟账户）</label>
              <input v-model.number="shareForm.target_user_id" type="number" min="0" />
            </div>
            <div class="form-group">
              <label>权限</label>
              <select v-model="shareForm.share_mode">
                <option value="view">仅查看</option>
                <option value="edit">可编辑</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="shareModal.instance = null">取消</button>
            <button class="btn btn-primary" @click="submitShare">共享</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { instancesApi, groupsApi } from '../../api';
import InstanceCard from '../../components/instances/InstanceCard.vue';
import InstanceCreateModal from '../../components/instances/InstanceCreateModal.vue';

const router = useRouter();

const loading = ref(false);
const instances = ref<any[]>([]);
const groups = ref<any[]>([]);
const searchQuery = ref('');
const selectedIds = ref<number[]>([]);

// 模态框
const showCreateModal = ref(false);
const showCreateGroupModal = ref(false);
const newGroupName = ref('');

// 右键菜单
const contextMenu = ref<{ visible: boolean; x: number; y: number; instance: any | null }>({
  visible: false, x: 0, y: 0, instance: null
});

// 拖拽
const draggingId = ref<number | null>(null);
const dragOverGroupId = ref<number | null | undefined>(undefined);

// 共享
const shareModal = ref<{ instance: any | null }>({ instance: null });
const shareForm = ref({
  target_type: 'alliance',
  target_user_id: 0,
  share_mode: 'view'
});

// 概览统计
const runningCount = computed(() => instances.value.filter(i => i.status === 'running').length);
const stoppedCount = computed(() => instances.value.filter(i => i.status !== 'running').length);

const filteredInstances = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return instances.value;
  return instances.value.filter(i =>
    (i.name || '').toLowerCase().includes(q) ||
    (i.service_type || '').toLowerCase().includes(q) ||
    (i.instance_uid || '').toLowerCase().includes(q)
  );
});

const ungroupedInstances = computed(() => filteredInstances.value.filter(i => !i.group_id));
const groupsWithInstances = computed(() => groups.value);

function groupInstances(groupId: number) {
  return filteredInstances.value.filter(i => i.group_id === groupId);
}

async function loadInstances() {
  loading.value = true;
  try {
    const [list, gs] = await Promise.all([
      instancesApi.list(),
      groupsApi.list().catch(() => [])
    ]);
    instances.value = list || [];
    groups.value = gs || [];
  } finally {
    loading.value = false;
  }
}

function enterEditor(inst: any) {
  if (selectedIds.value.length > 0) {
    toggleSelect(inst.id);
    return;
  }
  router.push(`/instance/${inst.id}/edit`);
}

function toggleSelect(id: number) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(x => x !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

function clearSelection() {
  selectedIds.value = [];
}

function openContextMenu(e: MouseEvent, inst: any) {
  e.preventDefault();
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    instance: inst
  };
}

function clearContextMenu() {
  contextMenu.value.visible = false;
}

async function callInstanceAction(action: string) {
  const inst = contextMenu.value.instance;
  if (!inst) return;
  clearContextMenu();
  try {
    if (action === 'delete') {
      if (!confirm(`确认删除实例「${inst.name}」？此操作不可恢复。`)) return;
    }
    await instancesApi[action](inst.id);
    await loadInstances();
  } catch (e: any) {
    alert(e?.message || '操作失败');
  }
}

function copyInstanceUid() {
  const inst = contextMenu.value.instance;
  if (!inst) return;
  navigator.clipboard?.writeText(inst.instance_uid || String(inst.id));
  clearContextMenu();
}

function openShareModal(inst: any) {
  shareModal.value.instance = inst;
  shareForm.value = { target_type: 'alliance', target_user_id: 0, share_mode: 'view' };
  clearContextMenu();
}

async function submitShare() {
  const inst = shareModal.value.instance;
  if (!inst) return;
  try {
    await instancesApi.share(inst.id, shareForm.value);
    shareModal.value.instance = null;
    alert('已共享');
  } catch (e: any) {
    alert(e?.message || '共享失败');
  }
}

async function batchAction(action: string) {
  if (selectedIds.value.length === 0) return;
  if (action === 'delete') {
    if (!confirm(`确认批量删除 ${selectedIds.value.length} 个实例？此操作不可恢复。`)) return;
  }
  if (action === 'move') {
    const name = prompt('请输入目标分组名称（留空表示移出分组）：', '');
    if (name === null) return;
    let targetGroupId = 0;
    if (name.trim()) {
      const found = groups.value.find(g => g.name === name.trim());
      if (!found) {
        alert('未找到该分组');
        return;
      }
      targetGroupId = found.id;
    }
    try {
      await instancesApi.batch('move', selectedIds.value);
      // 批量 move 需要 group_id 参数 - 修正：单独调用 groups.move
      for (const id of selectedIds.value) {
        await groupsApi.move(id, targetGroupId);
      }
      await loadInstances();
      clearSelection();
    } catch (e: any) {
      alert(e?.message || '移动失败');
    }
    return;
  }
  try {
    await instancesApi.batch(action, selectedIds.value);
    await loadInstances();
    clearSelection();
  } catch (e: any) {
    alert(e?.message || '批量操作失败');
  }
}

async function createGroup() {
  if (!newGroupName.value.trim()) return;
  try {
    await groupsApi.create(newGroupName.value.trim());
    newGroupName.value = '';
    showCreateGroupModal.value = false;
    await loadInstances();
  } catch (e: any) {
    alert(e?.message || '创建分组失败');
  }
}

function openGroupMenu(_e: MouseEvent, _group: any) {
  // 简化：可后续扩展为右键菜单（重命名/删除）
  const name = prompt('重命名分组（留空取消）：', _group.name);
  if (name && name.trim() && name !== _group.name) {
    groupsApi.update(_group.id, { name: name.trim() }).then(loadInstances);
  }
}

// 拖拽
function onDragStart(e: DragEvent, inst: any) {
  draggingId.value = inst.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(inst.id));
  }
}

function onDragOver(_e: DragEvent, groupId: number | null) {
  dragOverGroupId.value = groupId;
}

function onDragLeave() {
  dragOverGroupId.value = undefined;
}

function onDragEnd() {
  draggingId.value = null;
  dragOverGroupId.value = undefined;
}

async function onDrop(_e: DragEvent, groupId: number | null) {
  const id = draggingId.value;
  if (!id) return;
  try {
    await groupsApi.move(id, groupId ?? 0);
    await loadInstances();
  } catch (e: any) {
    alert(e?.message || '移动失败');
  } finally {
    draggingId.value = null;
    dragOverGroupId.value = undefined;
  }
}

function onInstanceCreated() {
  showCreateModal.value = false;
  loadInstances();
}

onMounted(() => {
  loadInstances();
  window.addEventListener('click', clearContextMenu);
});

onUnmounted(() => {
  window.removeEventListener('click', clearContextMenu);
});
</script>

<style scoped>
.instance-list {
  padding: var(--spacer-5);
  max-width: 1400px;
  margin: 0 auto;
  position: relative;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-5);
  flex-wrap: wrap;
  gap: var(--spacer-3);
}

.page-title {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.page-description {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: var(--spacer-1) 0 0;
}

.page-header-right {
  display: flex;
  gap: var(--spacer-3);
  align-items: center;
}

.search-bar {
  position: relative;
}

.search-icon {
  position: absolute;
  left: var(--spacer-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-bar input {
  width: 240px;
  height: 36px;
  padding: 0 var(--spacer-3) 0 calc(var(--spacer-3) + 20px);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--fast-duration);
}

.search-bar input:focus {
  border-color: var(--accent-base);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background var(--fast-duration);
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-ghost {
  background: var(--subtle-secondary);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--subtle-pressed);
}

.overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--spacer-3);
  margin-bottom: var(--spacer-5);
}

.overview-card {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
}

.overview-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.overview-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.overview-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  background: var(--accent-bg);
  border: 1px solid var(--accent-border, var(--accent-base));
  border-radius: var(--radius-md);
  margin-bottom: var(--spacer-4);
  flex-wrap: wrap;
  gap: var(--spacer-2);
}

.batch-info {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-sm);
  color: var(--accent-base);
  font-weight: 500;
}

.batch-actions {
  display: flex;
  gap: var(--spacer-1);
  flex-wrap: wrap;
}

.batch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-1) var(--spacer-2);
  background: transparent;
  border: 1px solid var(--accent-base);
  color: var(--accent-base);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.batch-btn:hover {
  background: var(--accent-base);
  color: var(--accent-text);
}

.batch-btn.batch-danger {
  border-color: var(--status-error);
  color: var(--status-error);
}

.batch-btn.batch-danger:hover {
  background: var(--status-error);
  color: white;
}

.batch-btn.batch-ghost {
  border-color: var(--ctrl-border-rest);
  color: var(--text-secondary);
}

.batch-btn.batch-ghost:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.groups-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-5);
}

.group-section {
  border: 2px dashed transparent;
  border-radius: var(--radius-lg);
  transition: border-color var(--fast-duration), background var(--fast-duration);
}

.group-section.drag-over {
  border-color: var(--accent-base);
  background: var(--accent-bg);
}

.group-header {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacer-3);
}

.group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  border-radius: var(--radius-full);
}

.group-action {
  margin-left: auto;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.group-action:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.instance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacer-4);
}

.add-to-group-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-1);
  min-height: 160px;
  background: transparent;
  border: 2px dashed var(--ctrl-border-rest);
  border-radius: var(--radius-lg);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: border-color var(--fast-duration), color var(--fast-duration);
}

.add-to-group-btn:hover {
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.new-group-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  align-self: flex-start;
  padding: var(--spacer-2) var(--spacer-4);
  background: transparent;
  border: 1px dashed var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: border-color var(--fast-duration), color var(--fast-duration);
}

.new-group-btn:hover {
  border-color: var(--accent-base);
  color: var(--accent-base);
}

.empty-state {
  text-align: center;
  padding: var(--spacer-8);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacer-2);
}

.empty-icon {
  color: var(--text-tertiary);
}

.empty-text {
  font-size: var(--font-size-lg);
  font-weight: 500;
  color: var(--text-secondary);
}

.empty-sub {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin-bottom: var(--spacer-2);
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  min-width: 200px;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  padding: var(--spacer-1);
  z-index: 1000;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  width: 100%;
  text-align: left;
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.ctx-item:hover {
  background: var(--subtle-secondary);
}

.ctx-item.ctx-danger {
  color: var(--status-error);
}

.ctx-item.ctx-danger:hover {
  background: rgba(196, 43, 28, 0.08);
}

.ctx-divider {
  height: 1px;
  background: var(--divider-stroke);
  margin: var(--spacer-1) 0;
}

/* 模态框 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn var(--fast-duration);
}

.modal-card {
  width: 480px;
  max-width: 92vw;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  animation: slideUp var(--normal-duration) var(--fast-out-slow-in);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-4) var(--spacer-5);
  border-bottom: 1px solid var(--divider-stroke);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--spacer-5);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.modal-tip {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-1);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  background: var(--subtle-secondary);
  padding: var(--spacer-2) var(--spacer-3);
  border-radius: var(--radius-md);
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-3) var(--spacer-5);
  border-top: 1px solid var(--divider-stroke);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-1);
}

.form-group label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input,
.form-group select {
  height: 36px;
  padding: 0 var(--spacer-3);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  outline: none;
  transition: border-color var(--fast-duration);
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--accent-base);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.fade-enter-active, .fade-leave-active {
  transition: opacity var(--fast-duration);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
