using System.Text.Json;
using CsesCloudIcceAdapter.Models;
using Ink_Canvas.Plugins;

namespace CsesCloudIcceAdapter.Services;

/// <summary>
/// CSES Cloud 同步服务（后台常驻）：
/// 1. 未绑定时使用注册码向平台注册设备并保存凭证；
/// 2. 按服务器限制轮询命令（429 时按 retry_after 退避）；传输支持长轮询 / WebSocket（断线回退长轮询）；
/// 3. 处理 settings.apply（配置方案热重载）/ icc.command（icc:// 远程命令）/
///    broadcast.show（应用内通知）/ broadcast.dismiss / client.restart；
/// 4. 每轮心跳上报本机 ICC CE 关键状态。
/// </summary>
public class CsesCloudSyncService
{
    private const string PluginVersion = "1.0.0";

    private readonly IPluginHost _host;
    private readonly Plugin _plugin;
    private readonly CsesServerClient _client = new();

    private readonly object _stateLock = new();
    private DeviceCredentials _credentials = new();
    private AdapterSettings _settings;

    /// <summary>已处理命令 ID 集合（去重，防止重复投递导致重复执行）</summary>
    private readonly HashSet<string> _handledCommandIds = new(StringComparer.Ordinal);

    private CancellationTokenSource? _cts;
    private Task? _loop;
    private int _serverPollInterval;
    private string _lastSettingsRevision = "";

    /// <summary>最近一次状态描述（设置视图展示）。</summary>
    public string StatusText { get; private set; } = "尚未连接";

    /// <summary>状态变化通知（设置视图刷新）。</summary>
    public event Action? StatusChanged;

    /// <summary>是否已连接（凭证有效）。</summary>
    public bool IsConnected
    {
        get { lock (_stateLock) return _credentials.IsValid; }
    }

    /// <summary>已连接的实例 UID（设置视图展示）。</summary>
    public string ConnectedInstanceUid
    {
        get { lock (_stateLock) return _credentials.IsValid ? _credentials.InstanceUid : ""; }
    }

    public CsesCloudSyncService(IPluginHost host, Plugin plugin)
    {
        _host = host;
        _plugin = plugin;
        _settings = plugin.LoadSettings();
        _credentials = DeviceCredentials.Load(plugin.CredentialsPath, _settings.ServerUrl);
    }

    /// <summary>启动后台同步循环（等待宿主 DI 就绪后再取用宿主服务）。</summary>
    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => ExecuteAsync(_cts.Token));
    }

    /// <summary>停止后台同步循环。</summary>
    public async Task StopAsync()
    {
        _cts?.Cancel();
        if (_loop != null)
        {
            try { await _loop; } catch { /* 忽略 */ }
        }
        _cts?.Dispose();
        _cts = null;
        _loop = null;
    }

    /// <summary>设置视图保存设置后调用：重新加载设置与凭证。</summary>
    public void ReloadConfiguration()
    {
        lock (_stateLock)
        {
            _settings = _plugin.LoadSettings();
            _credentials = DeviceCredentials.Load(_plugin.CredentialsPath, _settings.ServerUrl);
        }
    }

    /// <summary>立即使用注册码注册设备（设置视图「连接」按钮）。</summary>
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
            settings.DeviceName, GetAppVersion(), BuildState());
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
        SetStatus($"已连接到 {result.InstanceUid}");
        Log($"CSES Cloud 设备注册成功：instance={result.InstanceUid}");

        // 注册成功后立即同步一轮，尽快接收平台已下发的命令（设置 / 远程命令）
        try
        {
            await PollOnceAsync(CancellationToken.None);
        }
        catch (Exception e)
        {
            Log("注册后立即同步失败（将由主循环重试）：" + e.Message);
        }
    }

    /// <summary>立即执行一轮同步（设置视图「立即同步」按钮）。</summary>
    public Task SyncNowAsync()
    {
        return PollOnceAsync(CancellationToken.None);
    }

    /// <summary>断开连接：清除本地凭证（设备重新接入需新的注册码或重新导入凭据）。</summary>
    public Task DisconnectAsync()
    {
        lock (_stateLock)
        {
            _credentials = new DeviceCredentials();
        }
        try { File.Delete(_plugin.CredentialsPath); }
        catch { /* 忽略 */ }
        SetStatus("已断开连接（绑定已移除，可重新连接）");
        Log("CSES Cloud 设备已断开连接");
        return Task.CompletedTask;
    }

    // ---------------- 主循环 ----------------

    private async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Log("CSES Cloud 同步服务已启动");
        // 等待宿主完成启动（DI 容器在所有插件 Initialize 后构建，宿主服务此后才可解析）
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
                        SetStatus("注册失败：" + e.Message);
                        Log("自动注册失败：" + e.Message);
                        if (!await WaitAsync(TimeSpan.FromSeconds(60), stoppingToken)) return;
                        continue;
                    }
                }
                else
                {
                    SetStatus("等待配置（请在插件设置中填写服务器地址与注册码）");
                    if (!await WaitAsync(TimeSpan.FromSeconds(15), stoppingToken)) return;
                    continue;
                }
                lock (_stateLock) cred = _credentials;
                if (!cred.IsValid) continue;
            }

            if (!settings.AutoSyncEnabled)
            {
                SetStatus("自动同步已关闭（可在插件设置中开启）");
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
                        SetStatus("WebSocket 连接不稳定，回退长轮询 5 分钟后重试");
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
                SetStatus($"服务器限频，{retry} 秒后重试");
                if (!await WaitAsync(TimeSpan.FromSeconds(Math.Min(retry, CurrentPollInterval())), stoppingToken)) return;
            }
            catch (CsesApiException e)
            {
                SetStatus("连接异常：" + e.Message);
                Log($"CSES Cloud 请求失败：{e.Message} (HTTP {e.HttpStatusCode})");
                if (!await WaitAsync(TimeSpan.FromSeconds(30), stoppingToken)) return;
            }
            catch (Exception e)
            {
                SetStatus("同步出错：" + e.Message);
                LogError("CSES Cloud 同步出现未处理异常", e);
                if (!await WaitAsync(TimeSpan.FromSeconds(30), stoppingToken)) return;
            }
        }
    }

    private async Task<bool> WaitAsync(TimeSpan delay, CancellationToken ct)
    {
        try { await Task.Delay(delay, ct); return true; }
        catch (TaskCanceledException) { return false; }
    }

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
            Log("心跳上报失败（忽略）：" + e.Message);
        }
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
                SetStatus("服务器要求切换传输：" + target);
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
            SetStatus("WebSocket 已连接（实时推送）");
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
                    SetStatus("传输方式已切换，正在断开 WebSocket");
                    await channel.CloseAsync();
                    break;
                }
                await Task.Delay(500, ct);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception e)
        {
            SetStatus("WebSocket 断开：" + e.Message);
            Log("WebSocket 会话异常：" + e.Message);
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
                Log("回退轮询失败：" + e.Message);
            }
            if (!await WaitAsync(TimeSpan.FromSeconds(Math.Min(30, CurrentPollInterval())), ct)) return;
        }
    }

    // ---------------- 命令处理 ----------------

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
                Log($"命令 {command.Type} ({envelope.CommandId}) 重复投递，已忽略");
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

        Log($"收到命令 {command.Type} ({envelope.CommandId})");
        try
        {
            switch (command.Type)
            {
                case "settings.apply":
                    await HandleSettingsApplyAsync(cred, envelope, command.Payload);
                    break;
                case "icc.command":
                    await HandleIccCommandAsync(cred, envelope, command.Payload);
                    break;
                case "broadcast.show":
                    await HandleBroadcastShowAsync(cred, envelope, command.Payload);
                    break;
                case "broadcast.dismiss":
                    // ICC CE 通知无远端撤回接口，按成功忽略
                    await ReportAsync(cred, envelope.CommandId, "succeeded",
                        state: new { ignored = true, reason = "icc notification has no dismiss" });
                    break;
                case "client.restart":
                    await HandleClientRestartAsync(cred, envelope, command.Payload);
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
            SetStatus($"命令 {command.Type} 失败：{e.Message}");
            LogError($"处理命令 {command.Type} 失败", e);
            await ReportAsync(cred, envelope.CommandId, "failed", new { error = e.Message });
            await TryReportDeviceErrorAsync(cred, "command." + command.Type, e.Message);
        }
    }

    /// <summary>
    /// settings.apply：icc.* 键合并进 Configs/Settings.json 并经配置方案热重载；
    /// adapter.* 键写入适配器自身设置。
    /// </summary>
    private async Task HandleSettingsApplyAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;

        if (payload != null && payload.TryGetValue("revision", out var rev) && rev != null)
        {
            _lastSettingsRevision = rev.ToString() ?? "";
        }

        var adapterPairs = new List<KeyValuePair<string, object?>>();
        var iccPairs = new List<KeyValuePair<string, JsonElement>>();
        var unknownKeys = new List<string>();

        if (payload != null && payload.TryGetValue("settings", out var raw) && raw is JsonElement { ValueKind: JsonValueKind.Array } arr)
        {
            foreach (var item in arr.EnumerateArray())
            {
                var key = item.TryGetProperty("key", out var k) ? k.GetString() : null;
                if (string.IsNullOrWhiteSpace(key)) continue;
                var value = item.TryGetProperty("value", out var v) ? v.Clone() : (JsonElement?)null;
                if (value == null) continue;
                if (key.StartsWith("adapter.", StringComparison.Ordinal))
                {
                    adapterPairs.Add(new KeyValuePair<string, object?>(key["adapter.".Length..], JsonValueToPlain(value.Value)));
                }
                else if (key.StartsWith("icc.", StringComparison.Ordinal))
                {
                    iccPairs.Add(new KeyValuePair<string, JsonElement>(key["icc.".Length..], value.Value));
                }
                else
                {
                    unknownKeys.Add(key);
                }
            }
        }

        var applied = 0;
        var skipped = new List<string>();
        if (iccPairs.Count > 0)
        {
            var result = await IccSettingsApplier.ApplyAsync(_host, settings, iccPairs);
            applied += result.Applied;
            skipped.AddRange(result.Skipped);
            if (!result.ReloadConfirmed)
            {
                skipped.Add("热重载结果未确认（客户端仍会在下次重启时生效）");
            }
        }

        var adapterChanged = false;
        if (adapterPairs.Count > 0)
        {
            lock (_stateLock) adapterChanged = _settings.ApplyPlatformSettings(adapterPairs);
            if (adapterChanged)
            {
                AdapterSettings toSave;
                lock (_stateLock) toSave = _settings;
                _plugin.SaveSettings(toSave);
            }
        }

        if (unknownKeys.Count > 0)
        {
            skipped.AddRange(unknownKeys.Select(k => k + ": 未知键前缀"));
        }

        var summary = $"设置已同步（生效 {applied} 项" +
                      (adapterChanged ? "，适配器配置已更新" : "") +
                      (skipped.Count > 0 ? $"，跳过 {skipped.Count} 项" : "") + "）";
        SetStatus(summary);
        await ReportAsync(cred, envelope.CommandId, "succeeded",
            state: new
            {
                applied,
                skipped = skipped.Take(20).ToList(),
                revision = _lastSettingsRevision,
            });
    }

    /// <summary>
    /// icc.command：执行 icc:// 远程命令（收纳/白板/点名/计时器/配置方案切换等）。
    /// </summary>
    private async Task HandleIccCommandAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {
        var commandPath = GetString(payload, "command")?.Trim().TrimStart('/') ?? "";
        if (string.IsNullOrWhiteSpace(commandPath))
        {
            throw new InvalidOperationException("命令缺少 command 字段");
        }
        if (commandPath.Contains("://") && !commandPath.StartsWith("icc://", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("仅支持 icc:// 命令");
        }
        if (commandPath.StartsWith("icc://", StringComparison.OrdinalIgnoreCase))
        {
            commandPath = commandPath["icc://".Length..];
        }

        var uri = _host.GetService<IPluginUriService>()
                  ?? throw new InvalidOperationException("宿主 IPluginUriService 尚未就绪");

        // icc:// 命令受宿主「启用 URI 协议」门禁控制；EnsureUriScheme 开启时自动打开
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        if (settings.EnsureUriScheme)
        {
            var settingsSvc = _host.GetService<ISettingsService>();
            var enabled = TryGetSettingBool(settingsSvc, "advanced.isEnableUriScheme");
            if (!enabled)
            {
                settingsSvc?.Set("advanced.isEnableUriScheme", true);
            }
        }

        var dispatched = uri.OpenUri("icc://" + commandPath);
        if (!dispatched)
        {
            throw new InvalidOperationException("宿主拒绝了 icc:// 命令（URI 协议被禁用且自动开启失败）");
        }
        Log("已执行 icc://" + commandPath);
        SetStatus("已执行远程命令：" + commandPath);
        await ReportAsync(cred, envelope.CommandId, "succeeded", state: new { command = commandPath });
    }

    /// <summary>
    /// broadcast.show：弹出 ICC CE 应用内通知。
    /// </summary>
    private async Task HandleBroadcastShowAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        var title = GetString(payload, "title") ?? "CSES Cloud 通知";
        var body = GetString(payload, "body") ?? "";
        var severity = GetString(payload, "severity") ?? "info";

        if (settings.ShowBroadcastNotifications)
        {
            var notifications = _host.GetService<INotificationService>();
            if (notifications != null)
            {
                var level = severity switch
                {
                    "success" => NotificationLevel.Success,
                    "warning" => NotificationLevel.Warning,
                    "error" => NotificationLevel.Error,
                    _ => NotificationLevel.Info,
                };
                notifications.Show(title, body, level);
            }
        }
        SetStatus("已收到通知：" + title);
        await ReportAsync(cred, envelope.CommandId, "succeeded");
    }

    /// <summary>
    /// 重启 ICC CE（IAppRestartService.RestartApp）。
    /// 先上报命令结果再延迟重启，确保平台能收到回执。
    /// </summary>
    private async Task HandleClientRestartAsync(DeviceCredentials cred, ServerCommandEnvelope envelope,
        Dictionary<string, object?>? payload)
    {
        var restart = _host.GetService<IAppRestartService>();
        if (restart == null)
        {
            await ReportAsync(cred, envelope.CommandId, "failed", new { error = "IAppRestartService 尚未就绪，无法重启" });
            return;
        }
        var asAdmin = false;
        if (payload != null && payload.TryGetValue("as_admin", out var rawAdmin) && rawAdmin != null)
        {
            asAdmin = rawAdmin is JsonElement je ? je.ValueKind == JsonValueKind.True : Convert.ToBoolean(rawAdmin);
        }
        SetStatus("收到重启指令，ICC CE 即将重启");
        Log("平台下发重启指令，ICC CE 即将重启");
        await ReportAsync(cred, envelope.CommandId, "succeeded");
        // 留出回执发送时间，再重启
        await Task.Delay(TimeSpan.FromSeconds(1));
        restart.RestartApp(asAdmin);
    }

    // ---------------- 状态 ----------------

    private Dictionary<string, object?> BuildState()
    {
        var appInfo = _host.GetService<IAppInfoService>();
        AdapterSettings settings;
        lock (_stateLock) settings = _settings;
        return new Dictionary<string, object?>
        {
            ["app"] = new Dictionary<string, object?>
            {
                ["version"] = appInfo?.Version ?? "",
                ["plugin"] = PluginVersion,
            },
            ["settings"] = new Dictionary<string, object?>
            {
                ["uriScheme"] = TryGetSettingBool(_host.GetService<ISettingsService>(), "advanced.isEnableUriScheme"),
                ["nibMode"] = TryGetSettingBool(_host.GetService<ISettingsService>(), "startup.isEnableNibMode"),
                ["pptOnlyMode"] = TryGetSettingBool(_host.GetService<ISettingsService>(), "modeSettings.isPPTOnlyMode"),
                ["theme"] = TryGetSettingInt(_host.GetService<ISettingsService>(), "appearance.theme"),
                ["lastRevision"] = _lastSettingsRevision,
            },
            ["adapter"] = new Dictionary<string, object?>
            {
                ["transport"] = settings.Transport,
                ["auto_sync"] = settings.AutoSyncEnabled,
            },
        };
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
            Log("命令结果上报失败：" + e.Message);
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
        var id = "iccce-" + Guid.NewGuid().ToString("N")[..12];
        try
        {
            File.WriteAllText(path, id);
        }
        catch { /* 忽略 */ }
        return id;
    }

    private string GetAppVersion()
    {
        try
        {
            return _host.GetService<IAppInfoService>()?.Version ?? "unknown";
        }
        catch
        {
            return "unknown";
        }
    }

    private void SetStatus(string text)
    {
        StatusText = text;
        try { StatusChanged?.Invoke(); } catch { /* 忽略订阅方异常 */ }
    }

    private void Log(string message)
    {
        try { _host.Log("[CsesCloud] " + message); } catch { /* 日志失败不影响功能 */ }
    }

    private void LogError(string message, Exception ex)
    {
        try { _host.LogError("[CsesCloud] " + message, ex); } catch { /* 日志失败不影响功能 */ }
    }

    // ---------------- 工具 ----------------

    private static string? GetString(Dictionary<string, object?>? payload, string key)
    {
        if (payload == null || !payload.TryGetValue(key, out var v) || v == null) return null;
        if (v is JsonElement je) return je.ValueKind == JsonValueKind.String ? je.GetString() : je.ToString();
        return v.ToString();
    }

    private static object? JsonValueToPlain(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.TryGetInt64(out var l) && l is >= int.MinValue and <= int.MaxValue ? (int)l : element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => element.ToString(),
        };
    }

    /// <summary>经 ISettingsService 读取 bool 设置；键不存在或服务未就绪返回 null。</summary>
    private static bool? TryGetSettingBool(ISettingsService? settings, string key)
    {
        if (settings == null) return null;
        try
        {
            var boxed = settings.Get<object>(key);
            return boxed switch
            {
                bool b => b,
                int i => i != 0,
                null => null,
                _ => bool.TryParse(boxed.ToString(), out var parsed) ? parsed : null,
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>经 ISettingsService 读取 int/enum 设置（枚举转 int）；键不存在或服务未就绪返回 null。</summary>
    private static int? TryGetSettingInt(ISettingsService? settings, string key)
    {
        if (settings == null) return null;
        try
        {
            var boxed = settings.Get<object>(key);
            return boxed switch
            {
                null => null,
                int i => i,
                long l => (int)l,
                short s => s,
                byte b => b,
                Enum e => Convert.ToInt32(e),
                double d => (int)d,
                _ => int.TryParse(boxed.ToString(), out var parsed) ? parsed : null,
            };
        }
        catch
        {
            return null;
        }
    }
}
