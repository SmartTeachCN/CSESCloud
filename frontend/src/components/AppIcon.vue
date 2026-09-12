<template>
  <img
    v-if="isAsset"
    class="app-icon-asset"
    :src="assetUrl"
    :style="{ width: size + 'px', height: size + 'px' }"
    alt=""
  />
  <Icon v-else :icon="iconName" :size="size" />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  /** 图标值：以 'asset:' 开头表示使用目录下的真实图标文件，否则为 Remix 图标名 */
  icon?: string;
  /** 应用 app_key，用于拉取应用真实图标资源 */
  appKey?: string | number;
  /** 插件 plugin_key，用于拉取插件真实图标资源 */
  pluginKey?: string | number;
  size?: number;
  /** 非 asset 图标为空时的兜底图标 */
  fallback?: string;
}>(), { icon: '', appKey: '', pluginKey: '', size: 20, fallback: 'ri-apps-2-line' });

const isAsset = computed(() => props.icon.startsWith('asset:'));
const iconName = computed(() => props.icon || props.fallback);
const assetUrl = computed(() => {
  if (props.pluginKey) {
    return `/api/dev/plugins?action=icon&plugin_key=${encodeURIComponent(String(props.pluginKey))}`;
  }
  return `/api/dev/apps?action=icon&app_key=${encodeURIComponent(String(props.appKey))}`;
});
</script>

<style scoped>
.app-icon-asset {
  object-fit: contain;
  border-radius: 4px;
  display: block;
}
</style>
