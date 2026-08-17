/**
 * CSES Cloud 适配器 - 渲染进程
 * API V2
 *
 * 页面：
 * 1. CSES Cloud 设置（状态/连接向导内联展开）
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
      var showWizard = ref(false);
      var connecting = ref(false);
      var wizardStatus = ref('');
      var wizardStatusType = ref('');

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

      ctx.api.settings.onChanged(function (s) {
        loadSettings(s);
        // 如果正在等待连接结果，显示反馈
        if (connecting.value) {
          var cs = s.connectionStatus || '';
          if (cs === 'connected') {
            connecting.value = false;
            wizardStatus.value = '连接成功！设备已注册到 CSES Cloud 平台';
            wizardStatusType.value = 'success';
            // 连接成功后自动关闭向导
            setTimeout(function () { showWizard.value = false; }, 3000);
          } else if (cs && cs.startsWith('error')) {
            connecting.value = false;
            wizardStatus.value = '连接失败: ' + cs.replace('error: ', '');
            wizardStatusType.value = 'error';
          }
        }
      });

      var isConnected = computed(function () {
        return connectionStatus.value === 'connected';
      });
      var hasError = computed(function () {
        return connectionStatus.value && connectionStatus.value.startsWith('error');
      });
      var isDisconnected = computed(function () {
        return !connectionStatus.value || connectionStatus.value === 'disconnected' || connectionStatus.value === '未连接';
      });
      var statusText = computed(function () {
        if (isConnected.value) return '已连接';
        if (hasError.value) return connectionStatus.value.replace('error: ', '');
        return '未连接';
      });

      function openWizard() {
        showWizard.value = !showWizard.value;
        if (showWizard.value) {
          wizardStatus.value = '';
          wizardStatusType.value = '';
          connecting.value = false;
        }
        // 直接 DOM 操作作为兜底，确保在 EA2 插件环境中也能正常切换
        console.log('openWizard', showWizard.value);
        var panel = document.getElementById('cses-wizard-panel');
        if (panel) {
          panel.style.display = showWizard.value ? '' : 'none';
        }
      }

      async function connectWizard() {
        if (connecting.value) return;
        if (!serverUrl.value.trim()) {
          alert('请输入服务器地址');
          return;
        }
        if (!enrollmentCode.value.trim()) {
          alert('请输入连接码');
          return;
        }
        connecting.value = true;
        wizardStatus.value = '正在连接...';
        wizardStatusType.value = '';
        try {
          await ctx.api.settings.patch({
            serverUrl: serverUrl.value,
            enrollmentCode: enrollmentCode.value,
          });
          location.reload(); // 连接成功后刷新页面，确保插件状态更新
          // 轮询等待连接结果（直接读取设置，不依赖 onChanged 回调）
          // var attempts = 0;
          // var checkStatus = function () {
          //   attempts++;
          //   // 直接读取当前设置（绕过 onChanged，确保跨进程更新可见）
          //   var s = null;
          //   try {
          //     if (typeof ctx.api.settings.getAll === 'function') {
          //       s = ctx.api.settings.getAll();
          //     }
          //   } catch (e) { /* ignore */ }
          //   if (!s) {
          //     // 兜底：使用最后一次 onChanged 更新的值
          //     s = {
          //       serverUrl: serverUrl.value,
          //       enrollmentCode: enrollmentCode.value,
          //       connectionStatus: connectionStatus.value,
          //       deviceId: deviceId.value,
          //       credential: credential.value,
          //       instanceUid: instanceUid.value,
          //     };
          //   }
          //   loadSettings(s);
          //   if (s.connectionStatus === 'connected') {
          //     connecting.value = false;
          //     wizardStatus.value = '连接成功！设备已注册到 CSES Cloud 平台';
          //     wizardStatusType.value = 'success';
          //     setTimeout(function () { showWizard.value = false; }, 3000);
          //   } else if (s.connectionStatus && s.connectionStatus.startsWith('error')) {
          //     connecting.value = false;
          //     wizardStatus.value = '连接失败: ' + s.connectionStatus.replace('error: ', '');
          //     wizardStatusType.value = 'error';
          //   } else if (attempts < 30) {
          //     setTimeout(checkStatus, 1000);
          //   } else {
          //     connecting.value = false;
          //     wizardStatus.value = '连接超时，请检查服务器地址和连接码是否正确';
          //     wizardStatusType.value = 'error';
          //   }
          // };
          // setTimeout(checkStatus, 1500);
        } catch (e) {
          connecting.value = false;
          wizardStatus.value = '保存失败: ' + (e && e.message ? e.message : String(e));
          wizardStatusType.value = 'error';
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
            onClick: isConnected.value ? function () { /* 断开连接需要重启插件 */ } : openWizard,
            style: {
              width: '100%', padding: '10px 16px',
              background: isConnected.value ? 'transparent' : '#0067C0',
              color: isConnected.value ? 'var(--text-primary, #d4d4d4)' : 'white',
              border: isConnected.value ? '1px solid var(--border-color, #3c3c3c)' : 'none',
              borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
              marginBottom: '10px',
            }
          }, isConnected.value ? '已连接 ✓' : '打开连接向导'),

          // 内联连接向导（始终渲染，通过 display 控制可见性）
          h('div', {
            id: 'cses-wizard-panel',
            style: {
              display: showWizard.value ? '' : 'none',
              padding: '20px', background: 'var(--card-bg, #252526)',
              border: '1px solid var(--border-color, #3c3c3c)',
              borderRadius: '8px', marginBottom: '20px',
            }
          }, [
            h('div', { style: { marginBottom: '20px' } }, [
              h('label', { style: { display: 'block', fontSize: '12px', color: 'var(--text-secondary, #888)', marginBottom: '6px', fontWeight: '500' } }, 'CSES Cloud 服务器地址'),
              h('input', {
                type: 'text', value: serverUrl.value,
                onInput: function (e) { serverUrl.value = e.target.value; },
                placeholder: 'http://127.0.0.1:8000',
                style: inputStyle,
              }),
            ]),
            h('div', { style: { marginBottom: '20px' } }, [
              h('label', { style: { display: 'block', fontSize: '12px', color: 'var(--text-secondary, #888)', marginBottom: '6px', fontWeight: '600' } }, '连接码'),
              h('input', {
                type: 'text', value: enrollmentCode.value,
                onInput: function (e) { enrollmentCode.value = e.target.value; },
                placeholder: '粘贴从 CSES Cloud 生成的连接码...',
                style: Object.assign({}, inputStyle, { borderColor: '#0067C0', borderWidth: '2px' }),
              }),
            ]),
            h('button', {
              onClick: connectWizard,
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
            wizardStatus.value ? h('div', {
              style: {
                marginTop: '16px', padding: '12px 16px',
                background: wizardStatusType.value === 'success' ? 'rgba(76, 175, 80, 0.1)' : wizardStatusType.value === 'error' ? 'rgba(244, 135, 113, 0.1)' : 'rgba(136, 136, 136, 0.1)',
                border: '1px solid ' + (wizardStatusType.value === 'success' ? 'rgba(76, 175, 80, 0.3)' : wizardStatusType.value === 'error' ? 'rgba(244, 135, 113, 0.3)' : 'rgba(136, 136, 136, 0.3)'),
                borderRadius: '8px', fontSize: '13px',
                color: wizardStatusType.value === 'success' ? '#4caf50' : wizardStatusType.value === 'error' ? '#f48771' : '#888',
                lineHeight: '1.5',
              }
            }, wizardStatus.value) : null,
          ]),

          h('p', { style: { fontSize: '11px', color: 'var(--text-secondary, #888)', margin: '0', lineHeight: '1.5' } },
            isConnected.value
              ? '设备已成功连接到 CSES Cloud 平台，正在接收云控命令。如需断开连接，请在 EA2 插件管理器中禁用或卸载此插件。'
              : hasError.value
                ? '连接失败。请检查服务器地址和连接码是否正确，或联系管理员确认实例状态。'
                : '点击上方按钮打开连接向导，输入 CSES Cloud 服务器地址和连接码即可完成设备注册。',
          ),
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
    // order: 10 保证不排在第一位，避免 EA2 初始化时误激活
    var settingsHandle = await ctx.api.ui.settings.registerPage({
      id: 'cses-cloud-settings',
      label: 'CSES Cloud',
      icon: 'cloud',
      order: 10,
      component: function () { return Promise.resolve(createSettingsPage(ctx)); },
    });
    disposables.push(settingsHandle);

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