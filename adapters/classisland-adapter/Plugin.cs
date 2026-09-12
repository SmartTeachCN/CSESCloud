using ClassIsland.Core.Abstractions;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Extensions.Registry;
using ClassIsland.Shared.Helpers;
using CsesCloudAdapter.Models;
using CsesCloudAdapter.Services;
using CsesCloudAdapter.Views.SettingsPages;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CsesCloudAdapter;

/// <summary>
/// CSES Cloud 适配器插件入口。
/// 将 ClassIsland 客户端接入 CSES Cloud 平台：注册设备、轮询命令、
/// 应用平台侧下发的 ClassIsland 档案、接收广播与设置。
/// </summary>
[PluginEntrance]
public class Plugin : PluginBase
{
    /// <summary>
    /// 插件入口单例（由插件系统注册到 DI，同时暴露给设置页等处使用）。
    /// </summary>
    public static Plugin? Instance { get; private set; }

    public Plugin()
    {
        Instance = this;
    }

    public override void Initialize(HostBuilderContext context, IServiceCollection services)
    {
        // 设置持久化目录（Config/Plugins/cloud.cses.classisland/），确保先于服务使用
        // （宿主 PluginService 在调用 Initialize 前必已赋值 PluginConfigFolder，此处仅作防御）
        if (!string.IsNullOrWhiteSpace(PluginConfigFolder))
        {
            Directory.CreateDirectory(PluginConfigFolder);
        }

        // 广播提醒提供方（AddNotificationProvider 仅以 IHostedService 注册；
        // 同步服务在运行期从 IHostedService 集合取回同一实例，见 CsesCloudSyncService）
        services.AddNotificationProvider<BroadcastNotificationProvider>();

        // 同步服务：注意 AddHostedService<T> 只注册 IHostedService，不会注册具体类型，
        // 设置页需要通过 IAppHost.TryGetService<CsesCloudSyncService>() 解析，
        // 因此这里注册具体单例，并让 IHostedService 与其共享同一实例。
        services.AddSingleton<CsesCloudSyncService>();
        services.AddSingleton<IHostedService>(sp => sp.GetRequiredService<CsesCloudSyncService>());

        services.AddSettingsPage<CsesSettingsPage>();
    }

    /// <summary>
    /// 设置文件路径
    /// </summary>
    public string SettingsPath => System.IO.Path.Combine(PluginConfigFolder, "settings.json");

    /// <summary>
    /// 凭证文件路径（instance_uid / device_id / credential）
    /// </summary>
    public string CredentialsPath => System.IO.Path.Combine(PluginConfigFolder, "credentials.json");

    /// <summary>
    /// 最近一次下发的档案缓存路径（用于 profile.activate 重放）
    /// </summary>
    public string LastProfileCachePath => System.IO.Path.Combine(PluginConfigFolder, "last-profile.json");

    public AdapterSettings LoadSettings()
    {
        var settings = ConfigureFileHelper.LoadConfig<AdapterSettings>(SettingsPath);
        settings.Normalize();
        return settings;
    }

    public void SaveSettings(AdapterSettings settings)
    {
        settings.Normalize();
        ConfigureFileHelper.SaveConfig(SettingsPath, settings);
    }
}
