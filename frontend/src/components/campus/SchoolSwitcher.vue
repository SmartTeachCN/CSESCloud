<template>
  <div class="school-switcher" :class="{ collapsed: !expanded }">
    <button
      v-if="!expanded"
      class="switcher-compact"
      :title="currentSchool?.name || '未选择学校'"
      @click="openMenu"
    >
      <Icon icon="ri-school-line" :size="18" />
    </button>

    <div v-else class="switcher-card">
      <button class="switcher-trigger" @click="openMenu">
        <div class="school-avatar">
          <Icon icon="ri-building-2-line" :size="16" />
        </div>
        <div class="school-meta">
          <div class="school-label">当前学校</div>
          <div class="school-name">{{ currentSchool?.name || '未选择学校' }}</div>
        </div>
        <Icon icon="ri-arrow-down-s-line" :size="16" class="caret" />
      </button>
    </div>

    <Teleport to="body">
      <transition name="fade">
        <div v-if="menuVisible" class="switcher-overlay" @click.self="closeMenu">
          <div class="switcher-menu">
            <div class="menu-header">
              <span class="menu-title">切换学校</span>
              <button class="menu-close" @click="closeMenu">
                <Icon icon="ri-close-line" :size="16" />
              </button>
            </div>

            <div class="menu-list">
              <button
                v-for="s in joinedSchools"
                :key="s.id"
                class="menu-item"
                :class="{ active: s.id === currentSchool?.id, current: s.is_current }"
                @click="onSelect(s.id)"
              >
                <div class="item-avatar">
                  <Icon icon="ri-building-2-line" :size="16" />
                </div>
                <div class="item-meta">
                  <div class="item-name">{{ s.name }}</div>
                  <div class="item-sub" v-if="s.short_name">{{ s.short_name }}</div>
                </div>
                <Icon v-if="s.id === currentSchool?.id" icon="ri-check-line" :size="14" class="check" />
              </button>

              <div class="menu-divider"></div>

              <button class="menu-item menu-action" @click="openJoin">
                <div class="item-avatar action">
                  <Icon icon="ri-add-line" :size="16" />
                </div>
                <div class="item-meta">
                  <div class="item-name">加入新的学校</div>
                  <div class="item-sub">提交申请，等待管理员审批</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <JoinSchool
      :visible="joinVisible"
      @close="closeJoin"
      @joined="onJoined"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSchool } from '../../composables/useSchool';
import JoinSchool from './JoinSchool.vue';

defineProps<{ expanded: boolean }>();

const { currentSchool, joinedSchools, switchSchool, refreshJoinedSchools } = useSchool();

const menuVisible = ref(false);
const joinVisible = ref(false);

function openMenu() {
  menuVisible.value = true;
}
function closeMenu() {
  menuVisible.value = false;
}
async function onSelect(id: number) {
  if (id === currentSchool.value?.id) {
    closeMenu();
    return;
  }
  await switchSchool(id);
  closeMenu();
}
function openJoin() {
  closeMenu();
  joinVisible.value = true;
}
function closeJoin() {
  joinVisible.value = false;
}
async function onJoined() {
  // 加入申请提交后刷新已加入学校列表（虽然新加入的可能还在审批中）
  await refreshJoinedSchools();
}
</script>

<style scoped>
.school-switcher {
  padding: var(--spacer-2) var(--spacer-3);
  border-bottom: 1px solid var(--divider-stroke);
}

.switcher-compact {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.switcher-compact:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.switcher-card {
  border: 1px solid var(--ctrl-border-rest);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--ctrl-fill-default);
  transition: border-color var(--fast-duration);
}

.switcher-card:hover {
  border-color: var(--accent-base);
}

.switcher-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
}

.school-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--subtle-secondary);
  color: var(--accent-base);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.school-meta {
  flex: 1;
  min-width: 0;
}

.school-label {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.school-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.caret {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.switcher-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.switcher-menu {
  width: 360px;
  max-width: 90vw;
  background: var(--flyout-bg);
  backdrop-filter: var(--flyout-backdrop);
  border: 1px solid var(--flyout-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16);
  overflow: hidden;
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-3) var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.menu-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.menu-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.menu-close:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.menu-list {
  padding: var(--spacer-2);
  max-height: 60vh;
  overflow-y: auto;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: background var(--fast-duration);
}

.menu-item:hover {
  background: var(--subtle-secondary);
}

.menu-item.active {
  background: var(--subtle-secondary);
}

.menu-item.current .item-name {
  color: var(--accent-base);
  font-weight: 600;
}

.item-avatar {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--subtle-secondary);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.item-avatar.action {
  background: rgba(0, 103, 192, 0.1);
  color: var(--accent-base);
}

.item-meta {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.check {
  color: var(--accent-base);
  flex-shrink: 0;
}

.menu-divider {
  height: 1px;
  background: var(--divider-stroke);
  margin: var(--spacer-2) 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--fast-duration);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
