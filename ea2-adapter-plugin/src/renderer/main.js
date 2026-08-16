/**
 * CSES Cloud 适配器 - 渲染进程
 * API V2
 *
 * 页面：
 * 1. CSES Cloud 设置（状态/日志/打开连接向导按钮）
 * 2. 连接向导（独立窗口，服务器地址 + 连接码）
 */
import { defineComponent, h, ref, computed } from 'vue';

// ---------- defineRendererPlugin 本地实现 ----------

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

// ---------- 公共样式 ----------

var inputStyle = {
  width: '100%', padding: '8px 12px', background: 'var(--input-bg, #1e1e1e)',
  color: 'var(--text-primary, #d4d4d4)', border: '1px solid var(--border-color, #3c3c3c)',
  borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};
var labelStyle = { display: 'block', fontSize: '12px', color: 'var(--text-secondary, #888)', marginBottom: '6px', fontWeight: '500' };
var groupStyle = { marginBottom: '20px' };

// ---------- 状态页面（EA2 设置内） ----------

function createSettingsPage(ctx) {
  return defineComponent({
    name: 'CsesCloudSettings',
    setup() {
      var serverUrl = ref('');
      var instanceUid = ref('');
      var enrollmentCode = ref('');
      var credential = ref('');
      var deviceId = ref('');
      var connectionStatus = ref('');
      var hostname = ref('');
      var platform = ref('');

      function loadSettings(s) {
        serverUrl.value = s.serverUrl || '';
        instanceUid.value = s.instanceUid || '';
        enrollmentCode.value = s.enrollmentCode || '';
        credential.value = s.credential || '';
        deviceId.value = s.deviceId || '';
        connectionStatus.value = s.connectionStatus || '';
        // 从设备信息中提取（从 main process 传入）
        hostname.value = s._hostname || '';
        platform.value = s._platform || '';
      }
      loadSettings(ctx.initialSettings);

      ctx.api.settings.onChanged(loadSettings);

      var isConnected = computed(function () {
        return connectionStatus.value === 'connected';
      });
      var hasError = computed(function () {
        return connectionStatus.value && connectionStatus.value.startsWith('error');
      });
      var statusText = computed(function () {
        if (isConnected.value) return '已连接';
        if (hasError.value) return connectionStatus.value.replace('error: ', '');
        return '未连接';
      });

      async function openWizard() {
        try {
          await ctx.api.windows.open({
            id: 'cses-cloud-wizard',
            route: 'cses-cloud-wizard',
            title: 'CSES Cloud 连接向导',
            width: 520,
            height: 480,
            resizable: false,
            show: true,
          });
        } catch (e) {
          console.error('[CSES Cloud] 打开连接向导失败:', e);
        }
      }

      function renderStatus() {
        var bg = 'rgba(76, 175, 80, 0.08)';
        var border = 'rgba(76, 175, 80, 0.3)';
        var color = '#4caf50';
        if (hasError.value) {
          bg = 'rgba(244, 135, 113, 0.08)';
          border = 'rgba(244, 135, 113, 0.3)';
          color = '#f48771';
        } else if (!isConnected.value) {
          bg = 'rgba(136, 136, 136, 0.08)';
          border = 'rgba(136, 136, 136, 0.3)';
          color = '#888';
        }
        return h('div', { style: { padding: '14px', background: bg, border: '1px solid ' + border, borderRadius: '8px', marginBottom: '20px' } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: deviceId.value ? '10px' : '0' } }, [
            h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block', flexShrink: '0' } }),
            h('span', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-primary, #d4d4d4)' } }, statusText.value),
          ]),
          deviceId.value ? h('div', { style: { fontSize: '11px', color: 'var(--text-secondary, #888)', lineHeight: '1.8' } }, [
            h('div', '设备 ID: ' + deviceId.value),
            h('div', '实例 UID: ' + (instanceUid.value || '—')),
            h('div', '服务器: ' + serverUrl.value),
          ]) : null,
        ]);
      }

      return function () {
        return h('div', { style: { padding: '20px', maxWidth: '480px' } }, [
          h('h3', { style: { margin: '0 0 16px', fontSize: '15px' } }, 'CSES Cloud 适配器'),

          // 连接状态卡片
          renderStatus(),

          // 打开连接向导按钮
          h('button', {
            onClick: openWizard,
            style: {
              width: '100%', padding: '10px 16px',
              background: isConnected.value ? 'transparent' : '#0067C0',
              color: isConnected.value ? 'var(--text-primary, #d4d4d4)' : 'white',
              border: isConnected.value ? '1px solid var(--border-color, #3c3c3c)' : 'none',
              borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
              marginBottom: '20px',
            }
          }, isConnected.value ? '重新连接...' : '打开连接向导'),

          h('p', { style: { fontSize: '11px', color: 'var(--text-secondary, #888)', margin: '0', lineHeight: '1.5' } },
            isConnected.value
              ? '设备已成功连接到 CSES Cloud 平台，正在接收云控命令。'
              : '点击上方按钮打开连接向导，输入 CSES Cloud 服务器地址和连接码即可完成设备注册。'),
        ]);
      };
    },
  });
}

// ---------- 连接向导（独立窗口） ----------

function createWizardPage(ctx) {
  return defineComponent({
    name: 'CsesCloudWizard',
    setup() {
      var serverUrl = ref('');
      var enrollmentCode = ref('');
      var connecting = ref(false);
      var status = ref('');
      var statusType = ref(''); // 'success' | 'error' | ''

      function loadSettings(s) {
        serverUrl.value = s.serverUrl || 'http://127.0.0.1:8000';
        enrollmentCode.value = s.enrollmentCode || '';
      }
      loadSettings(ctx.initialSettings);

      var settingsDisposer = ctx.api.settings.onChanged(function (s) {
        serverUrl.value = s.serverUrl || '';
        enrollmentCode.value = s.enrollmentCode || '';
        var cs = s.connectionStatus || '';
        if (cs === 'connected') {
          status.value = '连接成功！设备已注册到 CSES Cloud 平台';
          statusType.value = 'success';
          connecting.value = false;
          // 2 秒后自动关闭窗口
          setTimeout(function () {
            try { ctx.api.windows.get('cses-cloud-wizard').then(function (w) { if (w) w.close(); }); } catch (e) {}
          }, 2000);
        } else if (cs && cs.startsWith('error')) {
          status.value = '连接失败: ' + cs.replace('error: ', '');
          statusType.value = 'error';
          connecting.value = false;
        }
      });

      async function connect() {
        if (!serverUrl.value.trim()) {
          status.value = '请输入服务器地址';
          statusType.value = 'error';
          return;
        }
        if (!enrollmentCode.value.trim()) {
          status.value = '请输入连接码';
          statusType.value = 'error';
          return;
        }
        connecting.value = true;
        status.value = '正在连接...';
        statusType.value = '';
        try {
          await ctx.api.settings.patch({
            serverUrl: serverUrl.value,
            enrollmentCode: enrollmentCode.value,
          });
          // 状态会通过 onChanged 回调更新
        } catch (e) {
          status.value = '保存失败: ' + (e && e.message ? e.message : String(e));
          statusType.value = 'error';
          connecting.value = false;
        }
      }

      return function () {
        return h('div', { style: { padding: '32px', maxWidth: '440px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' } }, [
          h('h2', { style: { margin: '0 0 8px', fontSize: '18px', fontWeight: '600', color: 'var(--text-primary, #1a1a1a)' } }, 'CSES Cloud 连接向导'),
          h('p', { style: { margin: '0 0 28px', fontSize: '13px', color: 'var(--text-secondary, #666)', lineHeight: '1.5' } },
            '在 CSES Cloud 实例详情 → 设备控制中生成连接码，输入下方即可将本设备注册到云控平台。'),

          h('div', { style: groupStyle }, [
            h('label', { style: labelStyle }, 'CSES Cloud 服务器地址'),
            h('input', {
              type: 'text', value: serverUrl.value,
              onInput: function (e) { serverUrl.value = e.target.value; },
              placeholder: 'http://127.0.0.1:8000',
              disabled: connecting.value,
              style: inputStyle,
            }),
          ]),

          h('div', { style: groupStyle }, [
            h('label', { style: Object.assign({}, labelStyle, { fontWeight: '600' }) }, '连接码'),
            h('input', {
              type: 'text', value: enrollmentCode.value,
              onInput: function (e) { enrollmentCode.value = e.target.value; },
              placeholder: '粘贴从 CSES Cloud 生成的连接码...',
              disabled: connecting.value,
              style: Object.assign({}, inputStyle, { borderColor: '#0067C0', borderWidth: '2px' }),
            }),
          ]),

          h('button', {
            onClick: connect,
            disabled: connecting.value,
            style: {
              width: '100%', padding: '10px 20px',
              background: connecting.value ? '#888' : '#0067C0',
              color: 'white', border: 'none',
              borderRadius: '6px', fontSize: '14px', fontWeight: '500',
              cursor: connecting.value ? 'default' : 'pointer',
              opacity: connecting.value ? 0.7 : 1,
            }
          }, connecting.value ? '连接中...' : '连接'),

          status.value ? h('div', {
            style: {
              marginTop: '20px', padding: '12px 16px',
              background: statusType.value === 'success' ? 'rgba(76, 175, 80, 0.08)' : statusType.value === 'error' ? 'rgba(244, 135, 113, 0.08)' : 'rgba(136, 136, 136, 0.08)',
              border: '1px solid ' + (statusType.value === 'success' ? 'rgba(76, 175, 80, 0.3)' : statusType.value === 'error' ? 'rgba(244, 135, 113, 0.3)' : 'rgba(136, 136, 136, 0.3)'),
              borderRadius: '8px', fontSize: '13px',
              color: statusType.value === 'success' ? '#4caf50' : statusType.value === 'error' ? '#f48771' : '#888',
              lineHeight: '1.5',
            }
          }, status.value) : null,
        ]);
      };
    },
  });
}

// ---------- 插件入口 ----------

export default defineRendererPlugin({
  async activate(ctx) {
    var disposables = [];

    // 注册设置页（EA2 设置内）
    var settingsHandle = await ctx.api.ui.settings.registerPage({
      id: 'cses-cloud-settings',
      label: 'CSES Cloud',
      icon: 'cloud',
      order: -1,
      component: function () { return Promise.resolve(createSettingsPage(ctx)); },
    });
    disposables.push(settingsHandle);

    // 注册连接向导页（独立窗口）
    var wizardHandle = await ctx.api.ui.settings.registerPage({
      id: 'cses-cloud-wizard',
      label: '连接向导',
      icon: 'plug',
      order: 999,
      component: function () { return Promise.resolve(createWizardPage(ctx)); },
    });
    disposables.push(wizardHandle);

    return function () {
      disposables.forEach(function (d) {
        try { if (typeof d.dispose === 'function') d.dispose(); } catch (e) {}
      });
    };
  },

  onError: function (error, ctx) {
    ctx.logger.error('[CSES Cloud] 渲染进程错误: ' + (error && error.message));
  }
});