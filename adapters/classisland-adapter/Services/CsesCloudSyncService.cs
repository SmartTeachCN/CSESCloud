using System.Text;
using System.Text.Json;
using ClassIsland.Shared;
using ClassIsland.Shared.Helpers;
using CsesCloudAdapter.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CsesCloudAdapter.Services;

/// <summary>
/// CSES Cloud 同步服务（后台常驻）：
/// 1. 未绑定时使用注册码向平台注册设备并保存凭证；
/// 2. 按服务器限制轮询命令（429 时按 retry_after 退避）；传输支持长轮询 / WebSocket（断线回退长轮询）；
/// 3. 处理 profile.prepare / profile.activate / settings.apply / broadcast.show / broadcast.dismiss / client.restart；
/// 4. 每轮心跳上报本机档案应用状态。
/// </summary>
public class CsesCloudSyncService : BackgroundService
{
    private static readonly string AppVersion = "1.0.0";

    private readonly ILogger<CsesCloudSyncService> _logger;
    private readonly CsesServerClient _client;
    private readonly Plugin _plugin;

    private readonly object _stateLock = new();
    private DeviceCredentials _credentials = new();
    private AdapterSettings _settings = new();

    /// <summary>已处理命令 ID 集合（去重，防止重复投递导致重复执行）</summary>
    private readonly HashSet<string> _handledCommandIds = new(StringComparer.Ordinal);

    /// <summary>最近一次状态描述（设置页展示）</summary>
    public string StatusText { get; private set; } = "尚未连接";

    /// <summary>最近一次应用的档案显示名</summary>
    public string? AppliedProfileName { get; private set; }

    /// <summary>最近一次应用的档案版本（deployment id）</summary>
    public string? AppliedProfileVersion { get; private set; }

    /// <summary>最近一次应用的档案文件 ID（profile_config_id，与平台档案列表一一对应）</summary>
    public string? AppliedProfileConfigId { get; private set; }

    /// <summary>是否已连接（凭证有效）</summary>
    public bool IsConnected
    {
        get { lock (_stateLock) return _credentials.IsValid; }
    }

    /// <summary>已连接的实例 UID（设置页展示）</summary>
    public string ConnectedInstanceUid
    {
        get { lock (_stateLock) return _credentials.IsValid ? _credentials.InstanceUid : ""; }
    }

    /// <summary>
    /// 断开连接：清除本地凭证（设备重新接入需新的注册码或重新导入凭据）。
    /// </summary>
    public Task DisconnectAsync()
    {
        lock (_stateLock)
        {
            _credentials = new DeviceCredentials();
        }
        try { File.Delete(_plugin.CredentialsPath); }
        catch { /* 忽略 */ }
        StatusText = "已断开连接（绑定已移除，可重新连接）";
        _logger.LogInformation("CSES Cloud 设备已断开连接");
        return Task.CompletedTask;
    }

    private BroadcastNotificationProvider? _notificationProvider;

    /// <summary>
    /// 广播提醒提供方实例（AddNotificationProvider 仅以 IHostedService 注册，
    /// 延迟到首次广播时从宿主 IHostedService 集合取回同一实例，避免与宿主启动期解析相互依赖）。
    /// </summary>
    private BroadcastNotificationProvider NotificationProvider =>
        _notificationProvider ??= IAppHost.Host?.Services.GetServices<IHostedService>()
                .OfType<BroadcastNotificationProvider>()
                .FirstOrDefault()
            ?? throw new InvalidOperationException("BroadcastNotificationProvider 尚未就绪");

    public CsesCloudSyncService(ILogger<CsesCloudSyncService> logger, Plugin plugin)
    {
        _logger = logger;
        _client = new CsesServerClient();
        _plugin = plugin;
        _settings = plugin.LoadSettings();
        _credentials = DeviceCredentials.Load(plugin.CredentialsPath, _settings.ServerUrl);
        // 恢复最近应用的档案标识：客户端重启后心跳仍能上报正确的档案关联
        RestoreAppliedProfile();
    }

    /// <summary>已应用档案标识的持久化路径（applied-profile.json）。</summary>
    private string AppliedProfileStatePath => Path.Combine(_plugin.PluginConfigFolder, "applied-profile.json");

    private void PersistAppliedProfile()
    {
        try
        {
            ConfigureFileHelper.SaveConfig(AppliedProfileStatePath, new AppliedProfileRecord
            {
                Name = AppliedProfileName ?? "",
                Version = AppliedProfileVersion ?? "",
                ConfigId = AppliedProfileConfigId ?? "",
            });
        }
        catch (Exception e)
        {
            _logger.LogDebug(e, "持久化已应用档案标识失败");
        }
    }

    private void RestoreAppliedProfile()
    {
        try
        {
            if (!File.Exists(AppliedProfileStatePath)) return;
            var rec = ConfigureFileHelper.LoadConfig<AppliedProfileRecord>(AppliedProfileStatePath);
            if (rec == null) return;
            AppliedProfileName = string.IsNullOrWhiteSpace(rec.Name) ? AppliedProfileName : rec.Name;
            AppliedProfileVersion = string.IsNullOrWhiteSpace(rec.Version) ? AppliedProfileVersion : rec.Version;
            AppliedProfileConfigId = string.IsNullOrWhiteSpace(rec.ConfigId) ? AppliedProfileConfigId : rec.ConfigId;
        }
        catch (Exception e)
        {
            _logger.LogDebug(e, "恢复已应用档案标识失败");
        }
    }

    /// <summary>
    /// 设置页保存设置后调用：重新加载设置与凭证。
    /// </summary>
    public void ReloadConfiguration()
    {
        lock (_stateLock)
        {
            _settings = _plugin.LoadSettings();
            _credentials = DeviceCredentials.Load(_plugin.CredentialsPath, _settings.ServerUrl);
        }
    }

    /// <summary>
    /// 立即使用注册码注册设备（设置页「连接」按钮）。
    /// </summary>
    public async Task RegisterNowAsync()
    {
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        if (string.IsNullOrWhiteSpace(settings.ServerUrl))
        {
            throw new InvalidOperationException("请先填写服务器地址");
        }
        if (string.IsNullOrWhiteSpace(settings.EnrollmentCode))
        {
            throw new InvalidOperationException("请填写注册码（在平台实例「连接应用」页面生成）");
        }
        var result = await _client.RegisterAsync(
            settings.ServerUrl, settings.EnrollmentCode, GetOrCreateDeviceId(),
            settings.DeviceName, AppVersion, BuildState());
        var cred = new DeviceCredentials
        {
            ServerUrl = settings.ServerUrl,
            InstanceUid = result.InstanceUid,
            DeviceId = result.DeviceId,
            Credential = result.Credential,
        };
        lock (_stateLock)
        {
            _credentials = cred;
            if (result.PollIntervalSeconds > 0)
            {
                _serverPollInterval = result.PollIntervalSeconds;
            }
        }
        cred.Save(_plugin.CredentialsPath);
        StatusText = $"已连接到 {result.InstanceUid}";
        _logger.LogInformation("CSES Cloud 设备注册成功：instance={Instance}", result.InstanceUid);

        // 注册成功后立即同步一轮，尽快接收平台已下发的命令（档案 / 设置）
        try
        {
            await PollOnceAsync(CancellationToken.None);
        }
        catch (Exception e)
        {
            _logger.LogDebug(e, "注册后立即同步失败（将由主循环重试）");
        }
    }

    /// <summary>
    /// 立即执行一轮同步（设置页「立即同步」按钮）。
    /// </summary>
    public Task SyncNowAsync()
    {
        return PollOnceAsync(CancellationToken.None);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("CSES Cloud 适配器已启动");
        // 等待宿主完成启动（档案等服务的加载）
        try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
        catch (TaskCanceledException) { return; }

        var wsFailures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            DeviceCredentials cred;
            AdapterSettings settings;
            lock (_stateLock)
            {
                cred = _credentials;
                settings = _settings;
            }

            if (!cred.IsValid)
            {
                // 已配置了注册码时自动注册
                if (settings.AutoSyncEnabled && !string.IsNullOrWhiteSpace(settings.ServerUrl)
                                             && !string.IsNullOrWhiteSpace(settings.EnrollmentCode))
                {
                    try
                    {
                        await RegisterNowAsync();
                    }
                    catch (Exception e)
                    {
                        StatusText = "注册失败：" + e.Message;
                        _logger.LogWarning(e, "自动注册失败");
                        if (!await WaitAsync(TimeSpan.FromSeconds(60), stoppingToken)) return;
                        continue;
                    }
                }
                else
                {
                    StatusText = "等待配置（请在设置中填写服务器地址与注册码）";
                    if (!await WaitAsync(TimeSpan.FromSeconds(15), stoppingToken)) return;
                    continue;
                }
                lock (_stateLock) cred = _credentials;
                if (!cred.IsValid) continue;
            }

            if (!settings.AutoSyncEnabled)
            {
                StatusText = "自动同步已关闭（可在设置中开启）";
                if (!await WaitAsync(TimeSpan.FromSeconds(30), stoppingToken)) return;
                continue;
            }

            try
            {
                if (settings.Transport == "ws")
                {
                    // WebSocket 会话：保持直至断开 / 传输配置变更 / 取消
                    var duration = await RunWebSocketSessionAsync(cred, stoppingToken);
                    if (duration < TimeSpan.FromSeconds(60)) wsFailures++; else wsFailures = 0;
                    if (wsFailures >= 3)
                    {
                        StatusText = "WebSocket 连接不稳定，回退长轮询 5 分钟后重试";
                        await PollFallbackAsync(TimeSpan.FromMinutes(5), stoppingToken);
                        wsFailures = 0;
                    }
                    else
                    {
                        if (!await WaitAsync(TimeSpan.FromSeconds(10), stoppingToken)) return;
                    }
                }
                else
                {
                    await PollOnceAsync(stoppingToken);
                    if (!await WaitAsync(TimeSpan.FromSeconds(CurrentPollInterval()), stoppingToken)) return;
                }
            }
            catch (CsesApiException e) when (e.HttpStatusCode == 429)
            {
                var retry = Math.Max(5, e.Throttle?.RetryAfter ?? 30);
                StatusText = $"服务器限频，{retry} 秒后重试";
                if (!await WaitAsync(TimeSpan.FromSeconds(Math.Min(retry, CurrentPollInterval())), stoppingToken)) return;
            }
            catch (CsesApiException e)
            {
                StatusText = "连接异常：" + e.Message;
                _logger.LogWarning("CSES Cloud 请求失败：{Message} (HTTP {Status})", e.Message, e.HttpStatusCode);
                if (!await WaitAsync(TimeSpan.FromSeconds(30), stoppingToken)) return;
            }
            catch (Exception e)
            {
                StatusText = "同步出错：" + e.Message;
                _logger.LogError(e, "CSES Cloud 同步出现未处理异常");
                if (!await WaitAsync(TimeSpan.FromSeconds(30), stoppingToken)) return;
            }
        }
    }

    private async Task<bool> WaitAsync(TimeSpan delay, CancellationToken ct)
    {
        try { await Task.Delay(delay, ct); return true; }
        catch (TaskCanceledException) { return false; }
    }

    /// <summary>
    /// WebSocket 会话：连接、auth、接收命令推送并处理，心跳上报状态；
    /// 断开 / 传输配置变更 / 取消时返回会话时长。
    /// </summary>
    private async Task<TimeSpan> RunWebSocketSessionAsync(DeviceCredentials cred, CancellationToken ct)
    {
        var startedAt = DateTime.UtcNow;
        var channel = new CsesWebSocketChannel();
        var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        try
        {
            channel.CommandsReceived += async (commands) =>
            {
                foreach (var envelope in commands)
                {
                    if (ct.IsCancellationRequested) return;
                    await HandleCommandAsync(cred, envelope);
                }
            };
            channel.ProtocolSwitched += async (target) =>
            {
                StatusText = "服务器要求切换传输：" + target;
                bool changed;
                lock (_stateLock)
                {
                    changed = _settings.Transport != target && (target == "ws" || target == "poll");
                    if (changed) _settings.Transport = target;
                }
                if (changed)
                {
                    AdapterSettings settings;
                    lock (_stateLock) settings = _settings;
                    _plugin.SaveSettings(settings);
                }
                await channel.CloseAsync();
            };

            await channel.ConnectAsync(cred.ServerUrl, cred.InstanceUid, cred.DeviceId, cred.Credential, ct);
            StatusText = "WebSocket 已连接（实时推送）";
            if (channel.ServerPollInterval > 0)
            {
                lock (_stateLock) _serverPollInterval = channel.ServerPollInterval;
            }

            // 心跳：按 hello 指示的间隔上报状态
            _ = Task.Run(async () =>
            {
                while (!heartbeatCts.IsCancellationRequested && channel.IsConnected)
                {
                    try { await channel.UpdateStateAsync(BuildState()); }
                    catch { /* 忽略心跳失败 */ }
                    try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(15, channel.HeartbeatIntervalSeconds)), heartbeatCts.Token); }
                    catch (TaskCanceledException) { break; }
                }
            }, CancellationToken.None);

            // 保持会话直至断开 / 取消 / 传输配置变更
            while (!ct.IsCancellationRequested && channel.IsConnected)
            {
                bool transportChanged;
                lock (_stateLock) transportChanged = _settings.Transport != "ws";
                if (transportChanged)
                {
                    StatusText = "传输方式已切换，正在断开 WebSocket";
                    await channel.CloseAsync();
                    break;
                }
                await Task.Delay(500, ct);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception e)
        {
            StatusText = "WebSocket 断开：" + e.Message;
            _logger.LogWarning(e, "WebSocket 会话异常");
        }
        finally
        {
            heartbeatCts.Cancel();
            heartbeatCts.Dispose();
            try { await channel.DisposeAsync(); } catch { }
        }
        return DateTime.UtcNow - startedAt;
    }

    /// <summary>
    /// WebSocket 不可用时的长轮询回退（运行指定时长）。
    /// </summary>
    private async Task PollFallbackAsync(TimeSpan duration, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + duration;
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(ct);
            }
            catch (CsesApiException e) when (e.HttpStatusCode == 429)
            {
                var retry = Math.Max(5, e.Throttle?.RetryAfter ?? 30);
                if (!await WaitAsync(TimeSpan.FromSeconds(retry), ct)) return;
                continue;
            }
            catch (Exception e)
            {
                _logger.LogDebug(e, "回退轮询失败");
            }
            if (!await WaitAsync(TimeSpan.FromSeconds(Math.Min(30, CurrentPollInterval())), ct)) return;
        }
    }

    private int _serverPollInterval;

    private int CurrentPollInterval()
    {
        lock (_stateLock)
        {
            // 取设置下限与服务器限制中的较大者，避免被服务器 429
            return Math.Max(_settings.PollIntervalSeconds, _serverPollInterval);
        }
    }

    private async Task PollOnceAsync(CancellationToken ct)
    {
        DeviceCredentials cred;
        lock (_stateLock) cred = _credentials;
        if (!cred.IsValid) return;

        var (commands, serverInterval) = await _client.PollAsync(cred);
        if (serverInterval > 0)
        {
            lock (_stateLock) _serverPollInterval = serverInterval;
        }

        foreach (var envelope in commands)
        {
            if (ct.IsCancellationRequested) return;
            await HandleCommandAsync(cred, envelope);
        }

        // 心跳
        try
        {
            await _client.UpdateStateAsync(cred, BuildState());
        }
        catch (Exception e)
        {
            _logger.LogDebug(e, "心跳上报失败（忽略）");
        }
    }

    private async Task HandleCommandAsync(DeviceCredentials cred, ServerCommandEnvelope envelope)
    {
        var command = envelope.Command;
        if (command == null || string.IsNullOrWhiteSpace(command.Type))
        {
            await ReportAsync(cred, envelope.CommandId, "failed", new { error = "命令格式无效" });
            return;
        }

        // 命令去重：同一命令 ID 只执行一次，防止重复投递（WS 推送与轮询重叠、重连重放等）导致重复执行
        lock (_handledCommandIds)
        {
            if (!_handledCommandIds.Add(envelope.CommandId))
            {
                _logger.LogWarning("命令 {Type} ({Id}) 重复投递，已忽略", command.Type, envelope.CommandId);
                return;
            }
            if (_handledCommandIds.Count > 500)
            {
                // 简单裁剪：保留最近一半
                var keep = _handledCommandIds.Skip(_handledCommandIds.Count / 2).ToList();
                _handledCommandIds.Clear();
                foreach (var id in keep) _handledCommandIds.Add(id);
            }
        }

        _logger.LogInformation("收到命令 {Type} ({Id})", command.Type, envelope.CommandId);
        try
        {
            switch (command.Type)
            {
                case "profile.prepare":
                    await HandleProfilePrepareAsync(cred, envelope, command.Payload);
                    break;
                case "profile.activate":
                    await HandleProfileActivateAsync(cred, envelope);
                    break;
                case "settings.apply":
                    await HandleSettingsApplyAsync(cred, envelope, command.Payload);
                    break;
                case "broadcast.show":
                    await HandleBroadcastShowAsync(cred, envelope, command.Payload);
                    break;
                case "broadcast.dismiss":
                    NotificationProvider.DismissCurrent();
                    await ReportAsync(cred, envelope.CommandId, "succeeded");
                    break;
                case "client.restart":
                    await HandleClientRestartAsync(cred, envelope);
                    break;
                default:
                    // 未识别的命令按成功忽略，避免平台重试
                    await ReportAsync(cred, envelope.CommandId, "succeeded",
                        state: new { ignored = true, reason = "unsupported command type" });
                    break;
            }
        }
        catch (Exception e)
        {
            StatusText = $"命令 {command.Type} 失败：{e.Message}";
            _logger.LogError(e, "处理命令 {Type} 失败", command.Type);
            await ReportAsync(cred, envelope.CommandId, "failed", new { error = e.Message });
            await TryReportDeviceErrorAsync(cred, "command." + command.Type, e.Message);
        }
    }

    private async Task HandleProfilePrepareAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {
        var profileName = GetString(payload, "profile_name");
        var displayName = GetString(payload, "profile_display_name");
        var artifact = GetArtifact(payload);

        var json = await _client.DownloadProfileAsync(cred.ServerUrl, artifact);

        using var doc = JsonDocument.Parse(json);
        if (!ProfileApplier.LooksLikeClassIslandProfile(doc.RootElement))
        {
            throw new InvalidDataException("下载内容不是有效的 ClassIsland 档案（缺少 TimeLayouts/ClassPlans/Subjects）");
        }

        // 缓存最近档案（供 profile.activate 重放）
        await File.WriteAllTextAsync(_plugin.LastProfileCachePath, json, new UTF8Encoding(false));

        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        var targetName = string.IsNullOrWhiteSpace(profileName) ? settings.TargetProfileName : profileName;
        if (settings.ApplyMode == "file")
        {
            var written = ProfileApplier.ApplyToFile(json, targetName);
            AppliedProfileName = displayName ?? written;
            StatusText = $"档案已写入 Profiles/{written}";
        }
        else
        {
            var profile = ProfileApplier.ParseProfile(json);
            ProfileApplier.ApplyHotSwap(profile);
            AppliedProfileName = !string.IsNullOrWhiteSpace(displayName) ? displayName : profile.Name;
            StatusText = $"档案已热替换：{AppliedProfileName}";
        }
        AppliedProfileVersion = GetString(payload, "profile_version_id") ?? GetString(payload, "deployment_id");
        AppliedProfileConfigId = GetString(payload, "profile_config_id");
        PersistAppliedProfile();
        _logger.LogInformation("档案已应用：{Profile}", AppliedProfileName);

        await ReportAsync(cred, envelope.CommandId, "succeeded", state: BuildState());
    }

    private async Task HandleProfileActivateAsync(DeviceCredentials cred, ServerCommandEnvelope envelope)
    {
        if (!File.Exists(_plugin.LastProfileCachePath))
        {
            throw new InvalidOperationException("本地没有已缓存的平台档案，请先在平台部署一次");
        }
        var json = await File.ReadAllTextAsync(_plugin.LastProfileCachePath);
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        if (settings.ApplyMode == "file")
        {
            ProfileApplier.ApplyToFile(json, settings.TargetProfileName);
        }
        else
        {
            ProfileApplier.ApplyHotSwap(ProfileApplier.ParseProfile(json));
        }
        StatusText = "档案已重新应用";
        await ReportAsync(cred, envelope.CommandId, "succeeded");
    }

    private async Task HandleSettingsApplyAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {
        var changed = false;
        var clientApplied = 0;
        if (payload != null && payload.TryGetValue("settings", out var raw) && raw is JsonElement { ValueKind: JsonValueKind.Array } arr)
        {
            var pairs = new List<KeyValuePair<string, object?>>();
            foreach (var item in arr.EnumerateArray())
            {
                var key = item.TryGetProperty("key", out var k) ? k.GetString() : null;
                object? value = item.TryGetProperty("value", out var v)
                    ? (v.ValueKind switch
                    {
                        JsonValueKind.String => v.GetString(),
                        JsonValueKind.Number => v.GetDouble(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        _ => v.ToString(),
                    })
                    : null;
                if (!string.IsNullOrWhiteSpace(key)) pairs.Add(new KeyValuePair<string, object?>(key, value));
            }
            lock (_stateLock) changed = _settings.ApplyPlatformSettings(pairs);
            // client.* 键写入 ClassIsland 客户端设置（白名单反射）
            clientApplied = ClientSettingsApplier.Apply(pairs);
        }
        if (changed)
        {
            AdapterSettings settings;
            lock (_stateLock) settings = _settings;
            _plugin.SaveSettings(settings);
        }
        StatusText = clientApplied > 0 ? $"设置已同步（客户端 {clientApplied} 项）" : "设置已同步";
        await ReportAsync(cred, envelope.CommandId, "succeeded");
    }

    /// <summary>
    /// 重启 ClassIsland 客户端（AppBase.Restart）。
    /// 先上报命令结果再延迟重启，确保平台能收到回执。
    /// </summary>
    private async Task HandleClientRestartAsync(DeviceCredentials cred, ServerCommandEnvelope envelope)
    {
        var appBase = ClassIsland.Core.AppBase.Current;
        if (appBase == null)
        {
            await ReportAsync(cred, envelope.CommandId, "failed", new { error = "AppBase 尚未就绪，无法重启" });
            return;
        }
        StatusText = "收到重启指令，客户端即将重启";
        _logger.LogInformation("平台下发重启指令，客户端即将重启");
        await ReportAsync(cred, envelope.CommandId, "succeeded");
        // 留出回执发送时间，再静默重启
        await Task.Delay(TimeSpan.FromSeconds(1));
        appBase.Restart(true);
    }

    private async Task HandleBroadcastShowAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        var title = GetString(payload, "title") ?? "CSES Cloud 广播";
        var body = GetString(payload, "body") ?? "";
        // 显示时长：命令 payload.duration_seconds 优先，其次平台配置 notification.durationSeconds
        var durationSeconds = settings.BroadcastDurationSeconds;
        if (payload != null && payload.TryGetValue("duration_seconds", out var rawDur))
        {
            var durText = rawDur is JsonElement je ? (je.ValueKind == JsonValueKind.Number ? je.GetRawText() : je.ToString()) : rawDur.ToString();
            if (int.TryParse(durText, out var dur) && dur >= 3)
            {
                durationSeconds = dur;
            }
        }
        if (settings.ShowBroadcastNotifications)
        {
            NotificationProvider.ShowBroadcast(title, body, durationSeconds);
        }
        StatusText = "已收到广播：" + title;
        await ReportAsync(cred, envelope.CommandId, "succeeded");
    }

    private async Task ReportAsync(DeviceCredentials cred, string commandId, string status,
        object? error = null, object? state = null)
    {
        try
        {
            await _client.ReportAsync(cred, commandId, status, error, state);
        }
        catch (Exception e)
        {
            _logger.LogWarning(e, "命令结果上报失败");
        }
    }

    private async Task TryReportDeviceErrorAsync(DeviceCredentials cred, string source, string message)
    {
        try
        {
            await _client.ReportErrorAsync(cred, source, message, "error");
        }
        catch
        {
            // 忽略错误上报自身的失败
        }
    }

    private Dictionary<string, object?> BuildState()
    {
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        return new Dictionary<string, object?>
        {
            ["profile"] = new Dictionary<string, object?>
            {
                ["name"] = AppliedProfileName ?? "",
                ["version"] = AppliedProfileVersion ?? "",
                ["config_id"] = AppliedProfileConfigId ?? "",
                ["status"] = string.IsNullOrWhiteSpace(AppliedProfileName) ? "idle" : "applied",
            },
            ["apply_mode"] = settings.ApplyMode,
        };
    }

    private string GetOrCreateDeviceId()
    {
        // 设备 ID 独立于凭证持久化：凭证被清除后重绑仍使用同一 ID
        var path = Path.Combine(_plugin.PluginConfigFolder, "device-id.txt");
        try
        {
            if (File.Exists(path))
            {
                var existing = File.ReadAllText(path).Trim();
                if (!string.IsNullOrWhiteSpace(existing)) return existing;
            }
        }
        catch { /* 忽略 */ }
        var id = "ci-" + Guid.NewGuid().ToString("N")[..12];
        try
        {
            File.WriteAllText(path, id);
        }
        catch { /* 忽略 */ }
        return id;
    }

    private static string? GetString(Dictionary<string, object?>? payload, string key)
    {
        if (payload == null || !payload.TryGetValue(key, out var v) || v == null) return null;
        if (v is JsonElement je) return je.ValueKind == JsonValueKind.String ? je.GetString() : je.ToString();
        return v.ToString();
    }

    private static ProfileArtifact GetArtifact(Dictionary<string, object?>? payload)
    {
        if (payload == null || !payload.TryGetValue("artifact", out var raw) || raw == null)
        {
            throw new CsesApiException("命令缺少 artifact 信息", 400);
        }
        if (raw is JsonElement je)
        {
            return JsonSerializer.Deserialize<ProfileArtifact>(je.GetRawText(),
                       new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                   ?? throw new CsesApiException("artifact 解析失败", 400);
        }
        throw new CsesApiException("artifact 格式无效", 400);
    }
}
