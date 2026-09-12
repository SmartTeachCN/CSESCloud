using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using CsesCloudAdapter.Models;

namespace CsesCloudAdapter.Services;

/// <summary>
/// CSES Cloud WebSocket 控制网关客户端（与 REST 控制协议一一对应）。
///
/// 协议：
/// 1. 连接 {ws(s)}://{host}/api/ws-control 后发送 auth：{ type, instance_uid, device_id, credential }；
/// 2. 服务端回 hello：{ protocol, heartbeat_interval, poll_interval_seconds }，并立即推送待执行命令；
/// 3. 服务端推送 command / heartbeat / protocol.switch / close；
///    客户端发送 command_report / device_update / ping。
/// 命令信封格式与 REST command_poll 完全一致。
/// </summary>
public class CsesWebSocketChannel : IAsyncDisposable
{
    /// <summary>收到命令（与 REST poll 的信封结构一致）</summary>
    public event Func<List<ServerCommandEnvelope>, Task>? CommandsReceived;

    /// <summary>服务端要求切换协议（device_set_protocol）</summary>
    public event Func<string, Task>? ProtocolSwitched;

    /// <summary>hello 元信息（heartbeat_interval / poll_interval_seconds）</summary>
    public int HeartbeatIntervalSeconds { get; private set; } = 30;

    public int ServerPollInterval { get; private set; }

    public bool IsConnected => _ws is { State: WebSocketState.Open };

    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// 建立连接并完成 auth 握手；握手成功后启动接收循环。
    /// </summary>
    public async Task ConnectAsync(string serverUrl, string instanceUid, string deviceId, string credential, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(serverUrl))
        {
            throw new CsesApiException("尚未配置服务器地址", 400);
        }
        var wsUrl = ToWebSocketUrl(serverUrl) + "/api/ws-control";
        var ws = new ClientWebSocket();
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        await ws.ConnectAsync(new Uri(wsUrl), _cts.Token);
        _ws = ws;
        await SendAsync(new Dictionary<string, object?>
        {
            ["type"] = "auth",
            ["instance_uid"] = instanceUid,
            ["device_id"] = deviceId,
            ["credential"] = credential,
        });
        _ = ReceiveLoopAsync();
    }

    /// <summary>
    /// 主动关闭连接（如收到 close / 协议切换）。
    /// </summary>
    public async Task CloseAsync()
    {
        var ws = _ws;
        _cts?.Cancel();
        if (ws is { State: WebSocketState.Open })
        {
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "client_close", CancellationToken.None); }
            catch { /* ignore */ }
        }
    }

    public Task ReportAsync(string commandId, string status, object? error = null, object? state = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["type"] = "command_report",
            ["commandId"] = commandId,
            ["status"] = status,
            ["occurredAt"] = DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"),
        };
        if (error != null) body["error"] = error;
        if (state != null) body["state"] = state;
        return SendAsync(body);
    }

    public Task UpdateStateAsync(Dictionary<string, object?> state)
    {
        return SendAsync(new Dictionary<string, object?>
        {
            ["type"] = "device_update",
            ["state"] = state,
        });
    }

    public Task PingAsync()
    {
        return SendAsync(new Dictionary<string, object?> { ["type"] = "ping" });
    }

    // ---------------- 内部 ----------------

    private static string ToWebSocketUrl(string serverUrl)
    {
        var url = serverUrl.TrimEnd('/');
        if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return "wss://" + url.Substring("https://".Length);
        if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return "ws://" + url.Substring("http://".Length);
        return "ws://" + url;
    }

    private async Task SendAsync(Dictionary<string, object?> message)
    {
        var ws = _ws;
        if (ws == null || ws.State != WebSocketState.Open)
        {
            throw new CsesApiException("WebSocket 未连接", 0);
        }
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message));
        await _sendLock.WaitAsync();
        try
        {
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts?.Token ?? CancellationToken.None);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task ReceiveLoopAsync()
    {
        var ws = _ws;
        var ct = _cts?.Token ?? CancellationToken.None;
        if (ws == null) return;
        var buffer = new byte[64 * 1024];
        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        throw new CsesApiException("WebSocket 已被服务端关闭", 0);
                    }
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                var text = Encoding.UTF8.GetString(ms.ToArray());
                HandleMessage(text);
            }
        }
        catch (OperationCanceledException)
        {
            // 正常关闭
        }
        catch (Exception)
        {
            // 断线：由上层会话逻辑处理重连/回退
        }
    }

    private void HandleMessage(string text)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch
        {
            return;
        }
        using (doc)
        {
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            switch (type)
            {
                case "hello":
                    if (root.TryGetProperty("heartbeat_interval", out var hb))
                    {
                        HeartbeatIntervalSeconds = hb.ValueKind == JsonValueKind.Number ? hb.GetInt32() : 30;
                    }
                    if (root.TryGetProperty("poll_interval_seconds", out var pi) && pi.ValueKind == JsonValueKind.Number)
                    {
                        ServerPollInterval = pi.GetInt32();
                    }
                    break;

                case "command":
                    if (root.TryGetProperty("commands", out var cmds) && cmds.ValueKind == JsonValueKind.Array)
                    {
                        var list = JsonSerializer.Deserialize<List<ServerCommandEnvelope>>(cmds.GetRawText(), JsonOptions);
                        if (list is { Count: > 0 })
                        {
                            _ = CommandsReceived?.Invoke(list);
                        }
                    }
                    break;

                case "protocol.switch":
                    if (root.TryGetProperty("protocol", out var p))
                    {
                        var target = p.GetString() ?? "poll";
                        _ = ProtocolSwitched?.Invoke(target);
                    }
                    break;

                case "close":
                    _ = CloseAsync();
                    break;

                case "ping":
                    _ = SendAsync(new Dictionary<string, object?> { ["type"] = "pong" });
                    break;
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await CloseAsync();
        _ws?.Dispose();
        _sendLock.Dispose();
        GC.SuppressFinalize(this);
    }
}
