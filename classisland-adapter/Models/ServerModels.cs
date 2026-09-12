using System.Text.Json.Serialization;

namespace CsesCloudAdapter.Models;

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
/// command_poll 返回的命令信封（EA2 控制协议 v1：server.command）。
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
    /// 命令类型，如 profile.prepare / profile.activate / settings.apply / broadcast.show / broadcast.dismiss
    /// </summary>
    [JsonPropertyName("type")] public string Type { get; set; } = "";

    [JsonPropertyName("payload")] public Dictionary<string, object?>? Payload { get; set; }
}

/// <summary>
/// profile.prepare 命令携带的档案工件信息。
/// </summary>
public class ProfileArtifact
{
    [JsonPropertyName("url")] public string Url { get; set; } = "";

    [JsonPropertyName("media_type")] public string MediaType { get; set; } = "";

    [JsonPropertyName("size_bytes")] public long SizeBytes { get; set; }

    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";

    [JsonPropertyName("expires_at")] public string ExpiresAt { get; set; } = "";
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
/// 平台「下载凭据」生成的凭据文件（cses-cloud-credentials.json）。
/// </summary>
public class ImportedCredentialsFile
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";

    [JsonPropertyName("version")] public int Version { get; set; }

    [JsonPropertyName("server_url")] public string ServerUrl { get; set; } = "";

    [JsonPropertyName("serverUrl")] public string ServerUrlCamel { get; set; } = "";

    [JsonPropertyName("instance_uid")] public string InstanceUid { get; set; } = "";

    [JsonPropertyName("instanceUid")] public string InstanceUidCamel { get; set; } = "";

    [JsonPropertyName("enrollment_code")] public string EnrollmentCode { get; set; } = "";

    [JsonPropertyName("enrollmentCode")] public string EnrollmentCodeCamel { get; set; } = "";

    [JsonPropertyName("display_name")] public string? DisplayName { get; set; }

    public string ServerUrlValue => FirstNonEmpty(ServerUrl, ServerUrlCamel);

    public string InstanceUidValue => FirstNonEmpty(InstanceUid, InstanceUidCamel);

    public string EnrollmentCodeValue => FirstNonEmpty(EnrollmentCode, EnrollmentCodeCamel);

    private static string FirstNonEmpty(params string[] values)
    {
        foreach (var v in values)
        {
            if (!string.IsNullOrWhiteSpace(v)) return v;
        }
        return "";
    }
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
