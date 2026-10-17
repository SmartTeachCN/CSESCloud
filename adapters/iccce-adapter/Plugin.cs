using CsesCloudIcceAdapter.Services;
using CsesCloudIcceAdapter.Views;
using Ink_Canvas.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace CsesCloudIcceAdapter;

/// <summary>
/// CSES Cloud 适配器插件入口（ICC CE / InkCanvasForClass）。
/// 将 ICC CE 接入 CSES Cloud 平台：注册设备、轮询/接收命令，
/// 应用平台下发的设置（配置方案热重载）、执行 icc:// 远程命令与平台通知。
/// </summary>
[PluginEntrance]
public class Plugin : PluginBase
{
    /// <summary>插件入口单例（供设置视图等处使用）。</summary>
    public static Plugin? Instance { get; private set; }

    private CsesCloudSyncService? _sync;

    public Plugin()
    {
        Instance = this;
    }

    public override void Initialize(IPluginHost host, IServiceCollection services)
    {
        base.Initialize(host, services);

        if (string.IsNullOrWhiteSpace(PluginConfigFolder))
        {
            // 宿主在加载插件时必须已赋值；此处仅作防御，回退到宿主 PluginConfigs 目录
            var root = host.GetService<IAppInfoService>()?.RootPath;
            if (!string.IsNullOrWhiteSpace(root))
            {
                PluginConfigFolder = Path.Combine(root, "PluginConfigs", Id);
            }
        }
        if (!string.IsNullOrWhiteSpace(PluginConfigFolder))
        {
            Directory.CreateDirectory(PluginConfigFolder);
        }

        _sync = new CsesCloudSyncService(host, this);
        services.AddSingleton(_sync);
        _sync.Start();
        Log("CSES Cloud 适配器已初始化");
    }

    public override void Shutdown()
    {
        try { _sync?.StopAsync().Wait(TimeSpan.FromSeconds(5)); }
        catch { /* 忽略关停异常 */ }
        _sync = null;
        Log("CSES Cloud 适配器已卸载");
    }

    public override object? GetSettingsView()
    {
        return new CsesSettingsView(this);
    }

    /// <summary>同步服务实例（设置视图调用）。</summary>
    public CsesCloudSyncService? Sync => _sync;

    /// <summary>适配器设置文件路径（PluginConfigs/&lt;id&gt;/settings.json）。</summary>
    public string SettingsPath => Path.Combine(PluginConfigFolder, "settings.json");

    /// <summary>设备凭证文件路径（PluginConfigs/&lt;id&gt;/credentials.json）。</summary>
    public string CredentialsPath => Path.Combine(PluginConfigFolder, "credentials.json");

    public AdapterSettings LoadSettings()
    {
        var settings = AdapterSettings.Load(SettingsPath);
        settings.Normalize();
        return settings;
    }

    public void SaveSettings(AdapterSettings settings)
    {
        settings.Normalize();
        settings.Save(SettingsPath);
    }
}
