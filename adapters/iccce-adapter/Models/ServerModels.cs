using System.Text.Json.Serialization;

namespace CsesCloudIcceAdapter.Models;

/// <summary>
/// CSES Cloud API 统一响应：{ code, message, data, meta? }
/// </summary>
public class ApiResponse<T>
{
    [JsonPropertyName("code")] public int Code { get; set; }

    [JsonPropertyName("message")] public string Message { get; set; } = "";

    [JsonPropertyName("data")] public T? Data { get; set; }

    [JsonPropertyName("meta")] public Dictionary<string, object?>? Meta { get; set; }
}

/// <summary>
/// device_register 响应。
/// </summary>
public class RegisterResult
{
    [JsonPropertyName("device_id")] public string DeviceId { get; set; } = "";

    [JsonPropertyName("instance_uid")] public string InstanceUid { get; set; } = "";

    [JsonPropertyName("credential")] public string Credential { get; set; } = "";

    [JsonPropertyName("protocol")] public string Protocol { get; set; } = "poll";

    [JsonPropertyName("poll_interval_seconds")] public int PollIntervalSeconds { get; set; }

    [JsonPropertyName("protocol_version")] public int ProtocolVersion { get; set; } = 1;
}

/// <summary>
/// command_poll 返回的命令信封（CSES 控制协议 v1：server.command）。
/// </summary>
public class ServerCommandEnvelope
{
    [JsonPropertyName("commandId")] public string CommandId { get; set; } = "";

    [JsonPropertyName("issuedAt")] public string IssuedAt { get; set; } = "";

    [JsonPropertyName("expiresAt")] public string ExpiresAt { get; set; } = "";

    [JsonPropertyName("command")] public ServerCommandBody? Command { get; set; }
}

public class ServerCommandBody
{
    /// <summary>
    /// 命令类型：settings.apply / icc.command / broadcast.show / broadcast.dismiss / client.restart
    /// </summary>
    [JsonPropertyName("type")] public string Type { get; set; } = "";

    [JsonPropertyName("payload")] public Dictionary<string, object?>? Payload { get; set; }
}

/// <summary>
/// 429 限频响应的 data 载荷。
/// </summary>
public class ThrottleInfo
{
    [JsonPropertyName("retry_after")] public int RetryAfter { get; set; }

    [JsonPropertyName("poll_interval_seconds")] public int PollIntervalSeconds { get; set; }
}

/// <summary>
/// API 调用异常（携带 HTTP 状态码与限频信息）。
/// </summary>
public class CsesApiException : Exception
{
    public int HttpStatusCode { get; }

    public ThrottleInfo? Throttle { get; }

    public CsesApiException(string message, int httpStatus, ThrottleInfo? throttle = null) : base(message)
    {
        HttpStatusCode = httpStatus;
        Throttle = throttle;
    }
}
