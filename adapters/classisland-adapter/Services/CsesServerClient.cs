using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CsesCloudAdapter.Models;

namespace CsesCloudAdapter.Services;

/// <summary>
/// CSES Cloud REST 控制协议客户端（EA2 控制协议 v1，长轮询模式）。
/// 端点前缀：{server}/api/rest-control?instance_uid={uid}&amp;action={action}
/// 设备鉴权：x-device-id / x-device-credential 请求头。
/// </summary>
public class CsesServerClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;

    public CsesServerClient()
    {
        _http = new HttpClient();
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("ClassIsland-CsesCloudAdapter/1.0");
        _http.Timeout = TimeSpan.FromSeconds(30);
    }

    /// <summary>
    /// 注册设备（可无 instance_uid，服务端通过注册码解析所属实例）。
    /// </summary>
    public async Task<RegisterResult> RegisterAsync(
        string serverUrl, string enrollmentCode, string deviceId,
        string displayName, string appVersion, Dictionary<string, object?>? state)
    {
        var body = new Dictionary<string, object?>
        {
            ["enrollment_code"] = enrollmentCode,
            ["device_id"] = deviceId,
            ["display_name"] = string.IsNullOrWhiteSpace(displayName) ? Environment.MachineName : displayName,
            ["platform"] = "ClassIsland",
            ["architecture"] = Environment.Is64BitProcess ? "x64" : "x86",
            ["app_version"] = appVersion,
            ["protocol_version"] = 1,
            ["protocol"] = "poll",
            ["state"] = state ?? new Dictionary<string, object?>(),
        };
        var json = await PostJsonAsync<RegisterResult>(serverUrl, null, "device_register", body);
        return json ?? throw new CsesApiException("注册响应为空", 500);
    }

    /// <summary>
    /// 轮询待执行命令。返回命令列表；meta 中的 poll_interval_seconds 会一并带回。
    /// </summary>
    public async Task<(List<ServerCommandEnvelope> Commands, int ServerPollInterval)> PollAsync(DeviceCredentials cred)
    {
        var (result, meta) = await PostJsonWithMetaAsync<List<ServerCommandEnvelope>>(cred.ServerUrl, cred.InstanceUid, "command_poll",
            new Dictionary<string, object?>(), cred);
        var interval = 0;
        if (meta != null && meta.TryGetValue("poll_interval_seconds", out var v) && v != null)
        {
            try { interval = Convert.ToInt32(v); } catch { interval = 0; }
        }
        return (result ?? new List<ServerCommandEnvelope>(), interval);
    }

    /// <summary>
    /// 上报命令执行结果。
    /// </summary>
    public Task ReportAsync(DeviceCredentials cred, string commandId, string status,
        object? error = null, object? state = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["commandId"] = commandId,
            ["status"] = status,
            ["occurredAt"] = DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"),
        };
        if (error != null) body["error"] = error;
        if (state != null) body["state"] = state;
        return PostJsonNoWaitAsync(cred.ServerUrl, cred.InstanceUid, "command_report", body, cred);
    }

    /// <summary>
    /// 心跳：更新设备状态（last_reported_state）。
    /// </summary>
    public Task UpdateStateAsync(DeviceCredentials cred, Dictionary<string, object?> state)
    {
        var body = new Dictionary<string, object?>
        {
            ["device_id"] = cred.DeviceId,
            ["state"] = state,
        };
        return PostJsonNoWaitAsync(cred.ServerUrl, cred.InstanceUid, "device_update_state", body, cred);
    }

    /// <summary>
    /// 上报设备错误。
    /// </summary>
    public Task ReportErrorAsync(DeviceCredentials cred, string source, string message,
        string severity = "warning", string code = "", object? context = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["severity"] = severity,
            ["source"] = source,
            ["code"] = code,
            ["message"] = message,
            ["occurredAt"] = DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"),
        };
        if (context != null) body["context"] = context;
        return PostJsonNoWaitAsync(cred.ServerUrl, cred.InstanceUid, "device_errors", body, cred);
    }

    /// <summary>
    /// 下载档案工件并校验 sha256。
    /// </summary>
    public async Task<string> DownloadProfileAsync(string serverUrl, ProfileArtifact artifact)
    {
        if (artifact == null || string.IsNullOrWhiteSpace(artifact.Url))
        {
            throw new CsesApiException("命令缺少 artifact 下载地址", 400);
        }
        var url = artifact.Url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? artifact.Url
            : serverUrl.TrimEnd('/') + artifact.Url;
        using var resp = await _http.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        var bytes = await resp.Content.ReadAsByteArrayAsync();
        if (!string.IsNullOrWhiteSpace(artifact.Sha256))
        {
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            if (!string.Equals(hash, artifact.Sha256.ToLowerInvariant(), StringComparison.Ordinal))
            {
                throw new CsesApiException("档案工件 sha256 校验失败", 400);
            }
        }
        return Encoding.UTF8.GetString(bytes);
    }

    // ---------------- 内部 ----------------

    private void SetAuthHeaders(DeviceCredentials? cred)
    {
        var headers = _http.DefaultRequestHeaders;
        headers.Remove("x-device-id");
        headers.Remove("x-device-credential");
        if (cred != null)
        {
            if (!string.IsNullOrWhiteSpace(cred.DeviceId))
                headers.Add("x-device-id", cred.DeviceId);
            if (!string.IsNullOrWhiteSpace(cred.Credential))
                headers.Add("x-device-credential", cred.Credential);
        }
    }

    private static string BuildUrl(string serverUrl, string? instanceUid, string action)
    {
        var baseUrl = serverUrl.TrimEnd('/');
        var url = baseUrl + "/api/rest-control?action=" + Uri.EscapeDataString(action);
        if (!string.IsNullOrWhiteSpace(instanceUid))
        {
            url += "&instance_uid=" + Uri.EscapeDataString(instanceUid);
        }
        return url;
    }

    private async Task<T?> PostJsonAsync<T>(string serverUrl, string? instanceUid, string action,
        object body, DeviceCredentials? cred = null)
    {
        var (data, _) = await PostJsonWithMetaAsync<T>(serverUrl, instanceUid, action, body, cred);
        return data;
    }

    private async Task PostJsonNoWaitAsync(string serverUrl, string? instanceUid, string action,
        object body, DeviceCredentials? cred = null)
    {
        await PostJsonWithMetaAsync<object>(serverUrl, instanceUid, action, body, cred);
    }

    private async Task<(T? Data, Dictionary<string, object?>? Meta)> PostJsonWithMetaAsync<T>(
        string serverUrl, string? instanceUid, string action, object body, DeviceCredentials? cred)
    {
        if (string.IsNullOrWhiteSpace(serverUrl))
        {
            throw new CsesApiException("尚未配置服务器地址", 400);
        }
        SetAuthHeaders(cred);
        var url = BuildUrl(serverUrl, instanceUid, action);
        HttpResponseMessage resp;
        try
        {
            resp = await _http.PostAsync(url, JsonContent.Create(body, options: JsonOptions));
        }
        catch (Exception e)
        {
            throw new CsesApiException("无法连接服务器：" + e.Message, 0);
        }

        var text = await resp.Content.ReadAsStringAsync();
        if ((int)resp.StatusCode == 429)
        {
            var throttled = TryParse<ApiResponse<ThrottleInfo>>(text);
            throw new CsesApiException(throttled?.Message ?? "轮询过于频繁", 429, throttled?.Data);
        }
        if (!resp.IsSuccessStatusCode)
        {
            var err = TryParse<ApiResponse<object>>(text);
            throw new CsesApiException(err?.Message ?? ("HTTP " + (int)resp.StatusCode), (int)resp.StatusCode);
        }

        var parsed = TryParse<ApiResponse<T>>(text)
                     ?? throw new CsesApiException("响应 JSON 解析失败", 500);
        if (parsed.Code != 0)
        {
            throw new CsesApiException(string.IsNullOrWhiteSpace(parsed.Message) ? ("API 错误 code=" + parsed.Code) : parsed.Message,
                (int)resp.StatusCode);
        }
        return (parsed.Data, parsed.Meta);
    }

    private static T? TryParse<T>(string text) where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(text, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    public void Dispose()
    {
        _http.Dispose();
    }
}
