<template>
  <Teleport to="body">
    <div v-if="visible && info" class="fp-overlay" @click.self="emit('close')">
      <div class="fp-card">
        <div class="fp-header">
          <div class="fp-title">
            <Icon icon="ri-information-line" :size="16" />
            <span>文件属性</span>
          </div>
          <button class="fp-close" title="关闭" @click="emit('close')">
            <Icon icon="ri-close-line" :size="16" />
          </button>
        </div>

        <div class="fp-tabs">
          <button
            class="fp-tab"
            :class="{ active: activeTab === 'props' }"
            @click="activeTab = 'props'"
          >
            <Icon icon="ri-file-info-line" :size="13" />
            <span>属性</span>
          </button>
          <button
            v-if="canDistribute"
            class="fp-tab"
            :class="{ active: activeTab === 'distribution' }"
            @click="activeTab = 'distribution'"
          >
            <Icon icon="ri-git-branch-line" :size="13" />
            <span>分发配置</span>
          </button>
          <button
            v-if="canShowShareTab"
            class="fp-tab"
            :class="{ active: activeTab === 'share' }"
            @click="activeTab = 'share'"
          >
            <Icon icon="ri-share-forward-line" :size="13" />
            <span>分享</span>
          </button>
        </div>

        <div
          class="fp-body"
          :class="{ distribution: activeTab === 'distribution', share: activeTab === 'share' }"
        >
          <div v-if="activeTab === 'props'" class="fp-props">
            <div v-for="row in rows" :key="row.label" class="fp-prop">
              <span class="fp-prop-label">{{ row.label }}</span>
              <span class="fp-prop-value" :class="{ mono: row.mono }" :title="row.value">{{ row.value }}</span>
            </div>
            <div v-if="info.distributedCount > 0" class="fp-tip">
              <Icon icon="ri-git-branch-line" :size="12" />
              <span>该文件已分发为 {{ info.distributedCount }} 个配置实例。</span>
            </div>
          </div>

          <template v-else-if="activeTab === 'share' && canShowShareTab && shareFile">
            <div class="fp-share">
              <ShareDialog
                :visible="visible"
                :resource-type="'cloud_file'"
                :resource-id="shareFile.id"
                :resource-name="shareFile.name"
                :resource-icon="shareFile.icon || 'ri-file-line'"
                embedded
                @created="onShareChanged"
                @updated="onShareChanged"
                @close="emit('close')"
              />
            </div>
          </template>

          <template v-else-if="activeTab === 'distribution' && canDistribute && distributionFile">
            <DistributionDialog
              :visible="visible"
              :file="distributionFile"
              :overview="overview"
              embedded
              @saved="onDistributionSaved"
              @close="emit('close')"
            />
          </template>

          <div v-else class="fp-empty">
            <Icon icon="ri-information-line" :size="20" />
            <span>当前文件不支持分发配置（仅云端自己拥有的文件可用）。</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DistributionDialog from './DistributionDialog.vue';
import ShareDialog from './panels/ShareDialog.vue';

interface FilePropertyInfo {
  name: string;
  typeLabel: string;
  size: string;
  sourceLabel: string;
  owner: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  sharedLabel: string;
  distributedCount: number;
}

/** 分享页嵌入用的文件引用（仅云端自己拥有的非目录文件） */
interface ShareFileRef {
  id: number | string;
  name: string;
  icon?: string;
}

type PropertyTab = 'props' | 'distribution' | 'share';

const props = defineProps<{
  visible: boolean;
  info: FilePropertyInfo | null;
  initialTab?: PropertyTab;
  distributionFile: { id: string; name: string; icon?: string } | null;
  overview: any;
  canDistribute?: boolean;
  /** 可分享的文件（云端 own 非目录文件）；为 null 时不显示分享 Tab */
  shareFile?: ShareFileRef | null;
  /** 是否允许分享（需同时提供 shareFile） */
  canShare?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', instance?: any): void;
  /** 分享创建/更新/删除后通知父级刷新（文件列表/分发徽标等） */
  (e: 'share-updated'): void;
  (e: 'updated'): void;
}>();

const canShowShareTab = computed(() => !!props.canShare && !!props.shareFile);

const activeTab = ref<PropertyTab>('props');

function resetTab() {
  const canDistribute = !!props.canDistribute && !!props.distributionFile;
  if (props.initialTab === 'share' && canShowShareTab.value) {
    activeTab.value = 'share';
    return;
  }
  if (props.initialTab === 'distribution' && canDistribute) {
    activeTab.value = 'distribution';
    return;
  }
  activeTab.value = 'props';
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) resetTab();
  },
  { immediate: true }
);

watch(
  () => props.initialTab,
  () => {
    if (props.visible) resetTab();
  }
);

// 不支持分发时回退到属性页
watch(
  () => props.canDistribute,
  (canDistribute) => {
    if (!canDistribute && activeTab.value === 'distribution') activeTab.value = 'props';
  }
);

// 分享能力缺失时回退到属性页
watch(canShowShareTab, (canShare) => {
  if (!canShare && activeTab.value === 'share') activeTab.value = 'props';
});

const rows = computed<Array<{ label: string; value: string; mono?: boolean }>>(() => {
  const info = props.info;
  if (!info) return [];
  return [
    { label: '文件名', value: info.name },
    { label: '类型', value: info.typeLabel },
    { label: '大小', value: info.size },
    { label: '来源', value: info.sourceLabel },
    { label: '编辑者', value: info.owner },
    { label: '路径', value: info.path, mono: true },
    { label: '创建时间', value: info.createdAt },
    { label: '更新时间', value: info.updatedAt },
    { label: '分享状态', value: info.sharedLabel },
    { label: '分发实例数', value: String(info.distributedCount) },
  ];
});

function onDistributionSaved(instance?: any) {
  emit('saved', instance);
}

/** 分享创建/更新/删除后：通知属性页刷新分享状态，并让父级刷新文件列表/徽标 */
function onShareChanged() {
  emit('share-updated');
  emit('updated');
}
</script>

<style scoped>
.fp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2500;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacer-4);
}

.fp-card {
  width: 620px;
  max-width: min(94vw, 620px);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  -webkit-backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.fp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  flex-shrink: 0;
}

.fp-title {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.fp-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.fp-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.fp-tabs {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: 0 var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
  background: var(--subtle-secondary);
  flex-shrink: 0;
}

.fp-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacer-2) var(--spacer-3);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
}

.fp-tab:hover {
  color: var(--text-primary);
}

.fp-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-base);
  font-weight: 600;
}

.fp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacer-3) var(--spacer-4);
}

.fp-body.distribution {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 360px;
}

/* 分享 Tab：由内嵌 ShareDialog 自己管理滚动，避免双重滚动条 */
.fp-body.share {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.fp-share {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fp-props {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fp-prop {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-3);
  padding: var(--spacer-2) 0;
  border-bottom: 1px dashed var(--divider-stroke);
}

.fp-prop:last-of-type {
  border-bottom: none;
}

.fp-prop-label {
  width: 84px;
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.fp-prop-value {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.5;
}

.fp-prop-value.mono {
  font-family: var(--font-family-mono);
  font-size: 11px;
}

.fp-tip {
  display: flex;
  align-items: center;
  gap: var(--spacer-1);
  margin-top: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: rgba(255, 140, 0, 0.08);
  border: 1px solid rgba(255, 140, 0, 0.2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--status-warning);
}

.fp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  min-height: 240px;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  text-align: center;
}
</style>
