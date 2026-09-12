using ClassIsland.Shared.Helpers;

namespace CsesCloudAdapter.Models;

/// <summary>
/// 适配器设置（持久化在 Config/Plugins/cloud.cses.classisland/settings.json）。
/// </summary>
public class AdapterSettings
{
    /// <summary>
    /// CSES Cloud 服务器地址，如 https://cses.example.com
    /// </summary>
    public string ServerUrl { get; set; } = "";

    /// <summary>
    /// 注册码（CSES-/EA2- 前缀）。仅在首次绑定设备时校验，绑定成功后不再需要。
    /// </summary>
    public string EnrollmentCode { get; set; } = "";

    /// <summary>
    /// 设备显示名称（默认取主机名）
    /// </summary>
    public string DeviceName { get; set; } = "";

    /// <summary>
    /// 自动同步开关
    /// </summary>
    public bool AutoSyncEnabled { get; set; } = true;

    /// <summary>
    /// 期望轮询间隔（秒）。实际以服务器返回的 poll_interval_seconds / retry_after 为准，此处仅为下限。
    /// </summary>
    public int PollIntervalSeconds { get; set; } = 30;

    /// <summary>
    /// 连接传输：poll = REST 长轮询；ws = WebSocket 实时推送（断线自动回退长轮询）。
    /// </summary>
    public string Transport { get; set; } = "poll";

    /// <summary>
    /// 平台广播提醒停留时长（秒）。
    /// </summary>
    public int BroadcastDurationSeconds { get; set; } = 10;

    /// <summary>
    /// 档案应用方式：hotswap = 热替换当前档案（立即生效）；file = 写入 Profiles 目录档案文件（重启/切换后生效）。
    /// </summary>
    public string ApplyMode { get; set; } = "hotswap";

    /// <summary>
    /// 应用方式为 file 时写入的档案文件名。
    /// </summary>
    public string TargetProfileName { get; set; } = "CSES-Cloud.json";

    /// <summary>
    /// 平台广播提醒开关。
    /// </summary>
    public bool ShowBroadcastNotifications { get; set; } = true;

    /// <summary>
    /// 归一化取值。
    /// </summary>
    public void Normalize()
    {
        ServerUrl = (ServerUrl ?? "").Trim().TrimEnd('/');
        EnrollmentCode = (EnrollmentCode ?? "").Trim();
        DeviceName = (DeviceName ?? "").Trim();
        if (PollIntervalSeconds < 5) PollIntervalSeconds = 5;
        if (PollIntervalSeconds > 86400) PollIntervalSeconds = 86400;
        if (ApplyMode != "hotswap" && ApplyMode != "file") ApplyMode = "hotswap";
        if (Transport != "poll" && Transport != "ws") Transport = "poll";
        if (BroadcastDurationSeconds < 3) BroadcastDurationSeconds = 3;
        if (BroadcastDurationSeconds > 120) BroadcastDurationSeconds = 120;
        if (string.IsNullOrWhiteSpace(TargetProfileName)) TargetProfileName = "CSES-Cloud.json";
        if (!TargetProfileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            TargetProfileName += ".json";
        }
    }

    /// <summary>
    /// 从平台 settings.apply 命令更新设置（仅接受已知键，与平台「应用配置」页的字段一一对应）。
    /// </summary>
    /// <returns>是否发生了变更</returns>
    public bool ApplyPlatformSettings(IEnumerable<KeyValuePair<string, object?>> settings)
    {
        var changed = false;
        foreach (var kv in settings)
        {
            switch (kv.Key)
            {
                case "sync.applyMode":
                    var mode = kv.Value?.ToString() ?? "";
                    if (mode is "hotswap" or "file" && mode != ApplyMode)
                    {
                        ApplyMode = mode;
                        changed = true;
                    }
                    break;
                case "sync.targetProfile":
                    var name = kv.Value?.ToString() ?? "";
                    if (!string.IsNullOrWhiteSpace(name) && name != TargetProfileName)
                    {
                        TargetProfileName = name;
                        changed = true;
                    }
                    break;
                case "sync.pollInterval":
                    if (TryToInt(kv.Value, out var sec) && sec >= 5 && sec != PollIntervalSeconds)
                    {
                        PollIntervalSeconds = Math.Min(sec, 86400);
                        changed = true;
                    }
                    break;
                case "sync.transport":
                    var transport = kv.Value?.ToString() ?? "";
                    if (transport is "poll" or "ws" && transport != Transport)
                    {
                        Transport = transport;
                        changed = true;
                    }
                    break;
                case "sync.autoSync":
                    if (TryToBool(kv.Value, out var auto) && auto != AutoSyncEnabled)
                    {
                        AutoSyncEnabled = auto;
                        changed = true;
                    }
                    break;
                case "notification.enabled":
                    if (TryToBool(kv.Value, out var enabled) && enabled != ShowBroadcastNotifications)
                    {
                        ShowBroadcastNotifications = enabled;
                        changed = true;
                    }
                    break;
                case "notification.durationSeconds":
                    if (TryToInt(kv.Value, out var dur) && dur >= 3 && dur != BroadcastDurationSeconds)
                    {
                        BroadcastDurationSeconds = Math.Min(Math.Max(dur, 3), 120);
                        changed = true;
                    }
                    break;
            }
        }
        if (changed)
        {
            Normalize();
        }
        return changed;
    }

    private static bool TryToInt(object? value, out int result)
    {
        result = 0;
        if (value == null) return false;
        if (value is int i) { result = i; return true; }
        if (value is double d) { result = (int)Math.Round(d); return true; }
        if (value is bool b) { result = b ? 1 : 0; return true; }
        return int.TryParse(value.ToString(), out result);
    }

    private static bool TryToBool(object? value, out bool result)
    {
        result = false;
        if (value == null) return false;
        if (value is bool b) { result = b; return true; }
        if (value is double d) { result = d != 0; return true; }
        if (value is int i) { result = i != 0; return true; }
        var s = value.ToString();
        if (bool.TryParse(s, out result)) return true;
        if (s == "1") { result = true; return true; }
        if (s == "0") { result = false; return true; }
        return false;
    }
}

/// <summary>
/// 设备凭证（注册成功后持久化在 credentials.json，注册码只在首次绑定时使用）。
/// </summary>
public class DeviceCredentials
{
    public string ServerUrl { get; set; } = "";
    public string InstanceUid { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string Credential { get; set; } = "";

    public bool IsValid => !string.IsNullOrWhiteSpace(ServerUrl)
                           && !string.IsNullOrWhiteSpace(InstanceUid)
                           && !string.IsNullOrWhiteSpace(DeviceId)
                           && !string.IsNullOrWhiteSpace(Credential);

    /// <summary>
    /// 加载凭证；serverUrl 不为空时校验服务器地址一致（不一致视为失效）。
    /// </summary>
    public static DeviceCredentials Load(string path, string? expectedServerUrl = null)
    {
        if (!File.Exists(path)) return new DeviceCredentials();
        try
        {
            var cred = ConfigureFileHelper.LoadConfig<DeviceCredentials>(path) ?? new DeviceCredentials();
            if (!string.IsNullOrWhiteSpace(expectedServerUrl) &&
                !string.Equals(cred.ServerUrl.TrimEnd('/'), expectedServerUrl.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
            {
                return new DeviceCredentials();
            }
            return cred;
        }
        catch
        {
            return new DeviceCredentials();
        }
    }

    public void Save(string path)
    {
        ConfigureFileHelper.SaveConfig(path, this);
    }
}
