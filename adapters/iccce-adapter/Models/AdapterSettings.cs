using System.Text.Json;
using System.Text.Json.Serialization;

namespace CsesCloudIcceAdapter;

/// <summary>
/// 适配器设置（持久化在 PluginConfigs/cloud.cses.iccce/settings.json）。
/// </summary>
public class AdapterSettings
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    /// <summary>CSES Cloud 服务器地址，如 https://cses.example.com</summary>
    [JsonPropertyName("serverUrl")]
    public string ServerUrl { get; set; } = "";

    /// <summary>注册码（ICCCE- 前缀）。仅在首次绑定设备时校验，绑定成功后不再需要。</summary>
    [JsonPropertyName("enrollmentCode")]
    public string EnrollmentCode { get; set; } = "";

    /// <summary>设备显示名称（默认取主机名）。</summary>
    [JsonPropertyName("deviceName")]
    public string DeviceName { get; set; } = "";

    /// <summary>自动同步开关。</summary>
    [JsonPropertyName("autoSyncEnabled")]
    public bool AutoSyncEnabled { get; set; } = true;

    /// <summary>期望轮询间隔（秒）。实际以服务器返回的 poll_interval_seconds / retry_after 为准，此处仅为下限。</summary>
    [JsonPropertyName("pollIntervalSeconds")]
    public int PollIntervalSeconds { get; set; } = 30;

    /// <summary>连接传输：poll = REST 长轮询；ws = WebSocket 实时推送（断线自动回退长轮询）。</summary>
    [JsonPropertyName("transport")]
    public string Transport { get; set; } = "poll";

    /// <summary>是否自动开启 ICC CE 的「启用 URI 协议」开关（远程命令与设置热重载依赖 icc:// 通道）。</summary>
    [JsonPropertyName("ensureUriScheme")]
    public bool EnsureUriScheme { get; set; } = true;

    /// <summary>平台通知提醒开关。</summary>
    [JsonPropertyName("showNotifications")]
    public bool ShowBroadcastNotifications { get; set; } = true;

    public void Normalize()
    {
        ServerUrl = (ServerUrl ?? "").Trim().TrimEnd('/');
        EnrollmentCode = (EnrollmentCode ?? "").Trim();
        DeviceName = (DeviceName ?? "").Trim();
        if (PollIntervalSeconds < 5) PollIntervalSeconds = 5;
        if (PollIntervalSeconds > 86400) PollIntervalSeconds = 86400;
        if (Transport != "poll" && Transport != "ws") Transport = "poll";
    }

    /// <summary>从平台 settings.apply 命令更新设置（仅接受 adapter.* 已知键，与平台「应用配置 → CSES Cloud 适配器」页一一对应）。</summary>
    /// <returns>是否发生了变更</returns>
    public bool ApplyPlatformSettings(IEnumerable<KeyValuePair<string, object?>> settings)
    {
        var changed = false;
        foreach (var kv in settings)
        {
            switch (kv.Key)
            {
                case "adapter.autoSync":
                    if (TryToBool(kv.Value, out var auto) && auto != AutoSyncEnabled)
                    {
                        AutoSyncEnabled = auto;
                        changed = true;
                    }
                    break;
                case "adapter.pollInterval":
                    if (TryToInt(kv.Value, out var sec) && sec >= 5 && sec != PollIntervalSeconds)
                    {
                        PollIntervalSeconds = Math.Min(sec, 86400);
                        changed = true;
                    }
                    break;
                case "adapter.transport":
                    var transport = kv.Value?.ToString() ?? "";
                    if (transport is "poll" or "ws" && transport != Transport)
                    {
                        Transport = transport;
                        changed = true;
                    }
                    break;
                case "adapter.ensureUriScheme":
                    if (TryToBool(kv.Value, out var ensure) && ensure != EnsureUriScheme)
                    {
                        EnsureUriScheme = ensure;
                        changed = true;
                    }
                    break;
                case "adapter.showNotifications":
                    if (TryToBool(kv.Value, out var notify) && notify != ShowBroadcastNotifications)
                    {
                        ShowBroadcastNotifications = notify;
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

    public static AdapterSettings Load(string path)
    {
        if (!File.Exists(path)) return new AdapterSettings();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AdapterSettings>(json) ?? new AdapterSettings();
        }
        catch
        {
            return new AdapterSettings();
        }
    }

    public void Save(string path)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
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
    [JsonPropertyName("serverUrl")]
    public string ServerUrl { get; set; } = "";

    [JsonPropertyName("instanceUid")]
    public string InstanceUid { get; set; } = "";

    [JsonPropertyName("deviceId")]
    public string DeviceId { get; set; } = "";

    [JsonPropertyName("credential")]
    public string Credential { get; set; } = "";

    public bool IsValid => !string.IsNullOrWhiteSpace(ServerUrl)
                           && !string.IsNullOrWhiteSpace(InstanceUid)
                           && !string.IsNullOrWhiteSpace(DeviceId)
                           && !string.IsNullOrWhiteSpace(Credential);

    /// <summary>加载凭证；serverUrl 不为空时校验服务器地址一致（不一致视为失效）。</summary>
    public static DeviceCredentials Load(string path, string? expectedServerUrl = null)
    {
        if (!File.Exists(path)) return new DeviceCredentials();
        try
        {
            var json = File.ReadAllText(path);
            var cred = JsonSerializer.Deserialize<DeviceCredentials>(json) ?? new DeviceCredentials();
            if (!string.IsNullOrWhiteSpace(expectedServerUrl) && cred.IsValid &&
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
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>
/// 平台「下载凭据」生成的凭据文件（cses-cloud-credentials.json），
/// 可在适配器设置中导入，自动填充服务器地址 / 实例 UID / 注册码。
/// </summary>
public class ImportedCredentialsFile
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("server_url")]
    public string ServerUrl { get; set; } = "";

    [JsonPropertyName("serverUrl")]
    public string ServerUrlCamel { get; set; } = "";

    [JsonPropertyName("instance_uid")]
    public string InstanceUid { get; set; } = "";

    [JsonPropertyName("instanceUid")]
    public string InstanceUidCamel { get; set; } = "";

    [JsonPropertyName("enrollment_code")]
    public string EnrollmentCode { get; set; } = "";

    [JsonPropertyName("enrollmentCode")]
    public string EnrollmentCodeCamel { get; set; } = "";

    public string ServerUrlValue => FirstNonEmpty(ServerUrl, ServerUrlCamel);
    public string InstanceUidValue => FirstNonEmpty(InstanceUid, InstanceUidCamel);
    public string EnrollmentCodeValue => FirstNonEmpty(EnrollmentCode, EnrollmentCodeCamel);

    /// <summary>读取并解析凭据文件；不是有效凭据文件时返回 null。</summary>
    public static ImportedCredentialsFile? Read(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            var parsed = JsonSerializer.Deserialize<ImportedCredentialsFile>(File.ReadAllText(path));
            if (parsed == null || (parsed.Type != "cses-cloud-credentials" && parsed.Type != "")) return null;
            if (string.IsNullOrWhiteSpace(parsed.ServerUrlValue) &&
                string.IsNullOrWhiteSpace(parsed.EnrollmentCodeValue))
            {
                return null;
            }
            return parsed;
        }
        catch
        {
            return null;
        }
    }

    private static string FirstNonEmpty(params string[] values)
    {
        foreach (var v in values)
        {
            if (!string.IsNullOrWhiteSpace(v)) return v;
        }
        return "";
    }
}
