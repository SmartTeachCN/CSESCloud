/**
 * CSES Cloud 适配器 - 渲染进程（设置页面）
 * API V2
 */
import { defineComponent, h, ref } from 'vue';

// ---------- defineRendererPlugin 本地实现（等效于 @dsz-examaware/plugin-sdk） ----------

function defineRendererPlugin(lifecycle) {
  var entry = async function (context) {
    var activation;
    try {
      if (lifecycle.onLoad) await lifecycle.onLoad(context);
      activation = await lifecycle.activate(context);
      if (lifecycle.onReady) await lifecycle.onReady(context);
    } catch (error) {
      try { context.scope.dispose(); } catch (e) { /* ignore */ }
      try { if (lifecycle.onUnload) await lifecycle.onUnload(context); } catch (e) { /* ignore */ }
      if (lifecycle.onError) {
        try { await lifecycle.onError(error, context); } catch (e) { /* ignore */ }
      }
      throw error;
    }

    var disposed = false;
    return async function () {
      if (disposed) return;
      disposed = true;
      try { if (lifecycle.deactivate) await lifecycle.deactivate(context); } catch (e) { /* ignore */ }
      try {
        if (typeof activation === 'function') await activation();
        else if (activation && typeof activation.dispose === 'function') await activation.dispose();
      } catch (e) { /* ignore */ }
      try { context.scope.dispose(); } catch (e) { /* ignore */ }
      try { if (lifecycle.onUnload) await lifecycle.onUnload(context); } catch (e) { /* ignore */ }
    };
  };

  Object.defineProperties(entry, {
    apiVersion: { value: 2, enumerable: true },
    process: { value: 'renderer', enumerable: true }
  });

  return entry;
}

// ---------- 插件入口 ----------

export default defineRendererPlugin({
  async activate(ctx) {
    var SettingsPage = defineComponent({
      name: 'CsesCloudSettings',
      setup() {
        var serverUrl = ref('');
        var instanceUid = ref('');
        var enrollmentCode = ref('');
        var credential = ref('');
        var deviceId = ref('');
        var connectionStatus = ref('');
        var saving = ref(false);
        var status = ref('');

        // 加载设置
        function loadSettings(s) {
          serverUrl.value = s.serverUrl || '';
          instanceUid.value = s.instanceUid || '';
          enrollmentCode.value = s.enrollmentCode || '';
          credential.value = s.credential || '';
          deviceId.value = s.deviceId || '';
          connectionStatus.value = s.connectionStatus || '';
        }
        loadSettings(ctx.initialSettings);

        // 监听设置变更（首次会立即回调当前值，onChanged 已自动注册到 scope）
        ctx.api.settings.onChanged(loadSettings);

        async function save() {
          status.value = '正在保存...';
          saving.value = true;
          try {
            await ctx.api.settings.patch({
              serverUrl: serverUrl.value,
              instanceUid: instanceUid.value,
              enrollmentCode: enrollmentCode.value,
            });
            status.value = '已保存';
          } catch (e) {
            status.value = '保存失败: ' + (e && e.message ? e.message : String(e));
          } finally {
            saving.value = false;
          }
        }

        var inputStyle = {
          width: '100%', padding: '6px 10px', background: 'var(--input-bg, #1e1e1e)',
          color: 'var(--text-primary, #d4d4d4)', border: '1px solid var(--border-color, #3c3c3c)',
          borderRadius: '4px', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
          boxSizing: 'border-box',
        };
        var labelStyle = { display: 'block', fontSize: '12px', color: 'var(--text-secondary, #888)', marginBottom: '4px' };
        var groupStyle = { marginBottom: '16px' };

        return function () {
          return h('div', { style: { padding: '20px', maxWidth: '480px' } }, [
            h('h3', { style: { margin: '0 0 16px', fontSize: '15px' } }, 'CSES Cloud 适配器'),
            h('p', { style: { fontSize: '12px', color: 'var(--text-secondary, #888)', margin: '0 0 16px', lineHeight: '1.5' } },
              '在 CSES Cloud 实例详情 → 设备控制中生成连接码，粘贴到下方即可连接设备。'),
            h('div', { style: groupStyle }, [
              h('label', { style: labelStyle }, 'CSES Cloud 服务器地址'),
              h('input', { type: 'text', value: serverUrl.value, onInput: function (e) { serverUrl.value = e.target.value; }, placeholder: 'http://127.0.0.1:8000', style: inputStyle }),
            ]),
            h('div', { style: groupStyle }, [
              h('label', { style: { display: 'block', fontSize: '12px', color: 'var(--text-secondary, #888)', marginBottom: '4px', fontWeight: '600' } }, '连接码'),
              h('input', { type: 'text', value: enrollmentCode.value, onInput: function (e) { enrollmentCode.value = e.target.value; }, placeholder: '粘贴从 CSES Cloud 生成的连接码...', style: Object.assign({}, inputStyle, { borderColor: '#0067C0', borderWidth: '2px' }) }),
            ]),
            h('div', { style: { ...groupStyle, opacity: 0.7 } }, [
              h('label', { style: labelStyle }, '实例 UID（连接后自动填充）'),
              h('input', { type: 'text', value: instanceUid.value, disabled: true, style: Object.assign({}, inputStyle, { opacity: 0.6 }) }),
            ]),
            h('div', { style: { ...groupStyle, opacity: 0.7 } }, [
              h('label', { style: labelStyle }, '设备凭证（自动填充）'),
              h('input', { type: 'text', value: credential.value, disabled: true, style: Object.assign({}, inputStyle, { opacity: 0.6 }) }),
            ]),
            h('div', { style: { ...groupStyle, opacity: 0.7 } }, [
              h('label', { style: labelStyle }, '设备 ID（自动填充）'),
              h('input', { type: 'text', value: deviceId.value, disabled: true, style: Object.assign({}, inputStyle, { opacity: 0.6 }) }),
            ]),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
              h('button', {
                onClick: save, disabled: saving.value,
                style: {
                  padding: '7px 20px', background: '#0067C0', color: 'white', border: 'none',
                  borderRadius: '4px', fontSize: '13px', cursor: saving.value ? 'default' : 'pointer',
                  opacity: saving.value ? 0.7 : 1,
                }
              }, saving.value ? '保存中...' : '保存并连接'),
              status.value ? h('span', { style: { fontSize: '12px', color: status.value.indexOf('失败') >= 0 ? '#f48771' : '#4caf50' } }, status.value) : null,
            ]),
            connectionStatus.value ? h('div', {
              style: {
                marginTop: '16px', padding: '10px 14px',
                background: connectionStatus.value.startsWith('error') ? 'rgba(244, 135, 113, 0.12)' : 'rgba(76, 175, 80, 0.12)',
                border: '1px solid ' + (connectionStatus.value.startsWith('error') ? 'rgba(244, 135, 113, 0.4)' : 'rgba(76, 175, 80, 0.4)'),
                borderRadius: '6px', fontSize: '12px',
                color: connectionStatus.value.startsWith('error') ? '#f48771' : '#4caf50',
                wordBreak: 'break-all',
              }
            }, connectionStatus.value.startsWith('error') ? '连接失败: ' + connectionStatus.value.replace('error: ', '') : '已连接') : null,
          ]);
        };
      },
    });

    var handle = await ctx.api.ui.settings.registerPage({
      id: 'cses-cloud-settings',
      label: 'CSES Cloud',
      icon: 'cloud',
      order: -1,
      component: function () { return Promise.resolve(SettingsPage); },
    });

    // handle 已由 EA2 框架自动加入 scope，无需手动 dispose
  },

  onError: function (error, ctx) {
    ctx.logger.error('[CSES Cloud] 渲染进程错误: ' + (error && error.message));
  }
});