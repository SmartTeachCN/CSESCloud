using System.ComponentModel;
using System.Runtime.CompilerServices;
using CsesCloudAdapter.Models;
using CsesCloudAdapter.Services;

namespace CsesCloudAdapter.Views.SettingsPages;

/// <summary>
/// 设置页视图模型（手动实现 INotifyPropertyChanged，避免依赖源生成器）。
/// </summary>
public class CsesSettingsViewModel : INotifyPropertyChanged
{
    private string _serverUrl = "";
    private string _enrollmentCode = "";
    private string _deviceName = "";
    private bool _autoSyncEnabled = true;
    private int _pollIntervalSeconds = 300;
    private string _applyMode = "hotswap";
    private string _transport = "poll";
    private string _targetProfileName = "CSES-Cloud.json";
    private bool _showBroadcastNotifications = true;
    private int _broadcastDurationSeconds = 10;
    private string _statusText = "";
    private string _deviceInfo = "";

    public string ServerUrl { get => _serverUrl; set => SetField(ref _serverUrl, value); }
    public string EnrollmentCode { get => _enrollmentCode; set => SetField(ref _enrollmentCode, value); }
    public string DeviceName { get => _deviceName; set => SetField(ref _deviceName, value); }
    public bool AutoSyncEnabled { get => _autoSyncEnabled; set => SetField(ref _autoSyncEnabled, value); }
    public int PollIntervalSeconds { get => _pollIntervalSeconds; set => SetField(ref _pollIntervalSeconds, value); }
    public string ApplyMode { get => _applyMode; set => SetField(ref _applyMode, value); }

    /// <summary>
    /// 应用方式的 ComboBox 索引：0=hotswap / 1=file
    /// </summary>
    public int ApplyModeIndex
    {
        get => _applyMode == "file" ? 1 : 0;
        set => ApplyMode = value == 1 ? "file" : "hotswap";
    }

    public string Transport { get => _transport; set => SetField(ref _transport, value); }

    /// <summary>
    /// 连接传输的 ComboBox 索引：0=poll / 1=ws
    /// </summary>
    public int TransportIndex
    {
        get => _transport == "ws" ? 1 : 0;
        set => Transport = value == 1 ? "ws" : "poll";
    }

    public string TargetProfileName { get => _targetProfileName; set => SetField(ref _targetProfileName, value); }
    public bool ShowBroadcastNotifications { get => _showBroadcastNotifications; set => SetField(ref _showBroadcastNotifications, value); }
    public int BroadcastDurationSeconds { get => _broadcastDurationSeconds; set => SetField(ref _broadcastDurationSeconds, value); }
    public string StatusText { get => _statusText; set => SetField(ref _statusText, value); }
    public string DeviceInfo { get => _deviceInfo; set => SetField(ref _deviceInfo, value); }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// 从插件设置与服务状态加载。
    /// </summary>
    public void Load(CsesCloudSyncService? service)
    {
        var settings = Plugin.Instance?.LoadSettings() ?? new AdapterSettings();
        ServerUrl = settings.ServerUrl;
        EnrollmentCode = settings.EnrollmentCode;
        DeviceName = settings.DeviceName;
        AutoSyncEnabled = settings.AutoSyncEnabled;
        PollIntervalSeconds = settings.PollIntervalSeconds;
        ApplyMode = settings.ApplyMode;
        Transport = settings.Transport;
        TargetProfileName = settings.TargetProfileName;
        ShowBroadcastNotifications = settings.ShowBroadcastNotifications;
        BroadcastDurationSeconds = settings.BroadcastDurationSeconds;
        RefreshStatus(service);
    }

    /// <summary>
    /// 用「下载凭据」文件（cses-cloud-credentials.json）填充服务器地址与注册码。
    /// </summary>
    public bool ApplyImportedCredentials(ImportedCredentialsFile? file)
    {
        if (file == null || string.IsNullOrWhiteSpace(file.EnrollmentCodeValue)) return false;
        if (!string.IsNullOrWhiteSpace(file.ServerUrlValue)) ServerUrl = file.ServerUrlValue;
        EnrollmentCode = file.EnrollmentCodeValue;
        if (!string.IsNullOrWhiteSpace(file.DisplayName) && string.IsNullOrWhiteSpace(DeviceName)) DeviceName = file.DisplayName;
        return true;
    }

    public void RefreshStatus(CsesCloudSyncService? service)
    {
        if (service == null)
        {
            StatusText = "服务未就绪";
            return;
        }
        StatusText = service.StatusText;
        var cred = service.IsConnected ? "已连接" : "未连接";
        DeviceInfo = $"{cred} · 设备 {Environment.MachineName}";
    }

    /// <summary>
    /// 转换为可持久化的设置对象。
    /// </summary>
    public AdapterSettings ToSettings()
    {
        return new AdapterSettings
        {
            ServerUrl = ServerUrl,
            EnrollmentCode = EnrollmentCode,
            DeviceName = DeviceName,
            AutoSyncEnabled = AutoSyncEnabled,
            PollIntervalSeconds = PollIntervalSeconds,
            ApplyMode = ApplyMode,
            Transport = Transport,
            TargetProfileName = TargetProfileName,
            ShowBroadcastNotifications = ShowBroadcastNotifications,
            BroadcastDurationSeconds = BroadcastDurationSeconds,
        };
    }

    private void SetField<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
