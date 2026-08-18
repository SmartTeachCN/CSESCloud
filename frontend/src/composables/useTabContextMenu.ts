import { ref, nextTick } from 'vue';

export interface TabMenuTab {
  id: string;
  name: string;
  dirty?: boolean;
}

export type TabMenuAction = 'close' | 'closeAll' | 'closeOthers' | 'closeLeft' | 'closeRight';

export interface TabMenuOptions<T extends TabMenuTab> {
  /** 获取当前标签数组 */
  getTabs: () => T[];
  /** 获取当前激活标签 id */
  getActiveId: () => string;
  /** 切换到某标签（用于未保存时跳转询问） */
  setActive: (id: string) => void;
  /** 从存储中移除指定 id 的标签，并修复激活标签 */
  removeTabs: (ids: string[]) => void;
  /** 保存当前激活标签，返回是否成功 */
  saveActive: () => Promise<boolean>;
}

/**
 * 标签页右键菜单：关闭 / 关闭所有 / 关闭其他 / 关闭左侧 / 关闭右侧。
 * 未保存的标签会先跳到对应标签并询问是否保存。
 */
export function useTabContextMenu<T extends TabMenuTab>(opts: TabMenuOptions<T>) {
  const menu = ref<{ visible: boolean; x: number; y: number; id: string }>({
    visible: false, x: 0, y: 0, id: '',
  });

  function open(id: string, e: MouseEvent) {
    menu.value = { visible: true, x: e.clientX, y: e.clientY, id };
  }

  function close() {
    menu.value.visible = false;
  }

  async function run(action: TabMenuAction) {
    const id = menu.value.id;
    const tabs = opts.getTabs();
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) { close(); return; }

    let targets: string[] = [];
    switch (action) {
      case 'close': targets = [id]; break;
      case 'closeAll': targets = tabs.map(t => t.id); break;
      case 'closeOthers': targets = tabs.filter(t => t.id !== id).map(t => t.id); break;
      case 'closeLeft': targets = tabs.slice(0, idx).map(t => t.id); break;
      case 'closeRight': targets = tabs.slice(idx + 1).map(t => t.id); break;
    }

    // 处理未保存：跳到对应标签并询问是否保存
    for (const tid of targets) {
      const tab = tabs.find(t => t.id === tid);
      if (tab && tab.dirty) {
        opts.setActive(tid);
        await nextTick();
        if (window.confirm(`“${tab.name}”有未保存的更改，是否保存？`)) {
          const ok = await opts.saveActive();
          if (!ok) { close(); return; }
        }
      }
    }

    const idSet = new Set(targets);
    opts.removeTabs(tabs.filter(t => idSet.has(t.id)).map(t => t.id));
    close();
  }

  return { menu, open, close, run };
}