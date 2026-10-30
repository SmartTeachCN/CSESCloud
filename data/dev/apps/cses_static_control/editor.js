/**
 * CSES 静态集控 —— 官方内置云应用编辑器脚本。
 *
 * 该应用的实例由轻编辑器「分发配置」自动创建（app_key = cses_static_control），
 * 因此编辑器只提供说明信息；所有管理操作都在轻编辑器的「文件 / 实例」视图中完成。
 *
 * 若宿主提供了 window.CSES 桥，则把当前实例的公开地址同步到说明页，便于复制。
 */
(function () {
  'use strict';

  function bridge() {
    try {
      return (typeof window !== 'undefined' && window.CSES) ? window.CSES : null;
    } catch (e) {
      return null;
    }
  }

  /** 尽力读取实例信息（不同宿主版本的桥接口可能不同，失败时静默忽略）。 */
  async function loadInstanceInfo() {
    var api = bridge();
    if (!api || typeof api.request !== 'function') return null;
    try {
      var instance = await api.request('getInstance', {});
      return instance && typeof instance === 'object' ? instance : null;
    } catch (e) {
      return null;
    }
  }

  async function init() {
    var instance = await loadInstanceInfo();
    if (!instance) return;
    var name = instance.name || '';
    var title = document.querySelector('.csc-page-header h2');
    if (title && name) title.textContent = 'CSES 静态集控 · ' + name;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
