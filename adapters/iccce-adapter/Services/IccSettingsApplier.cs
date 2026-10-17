using System.Text.Json;
using System.Text.Json.Nodes;
using Ink_Canvas.Plugins;

namespace CsesCloudIcceAdapter.Services;

/// <summary>
/// ICC CE 设置下发器：把平台 settings.apply 中的 icc.* 键合并进客户端 Configs/Settings.json，
/// 经配置方案 + icc://config-profile/switch 触发热重载，立即生效。
///
/// 流程（全部走宿主公开服务，不直接改写宿主文件）：
/// 1. 读取 Configs/Settings.json（文件由宿主每次设置变更时落盘，始终为当前配置）；
/// 2. 逐键合并：路径必须已存在（防错键写入），基础类型需匹配（bool/数字/字符串互转受限），
///    security.*（密码/TOTP/USB 白名单）键一律拒绝；
/// 3. IConfigProfileService.SaveAsProfile 保存为 "CSES-Cloud" 配置方案；
/// 4. 确保宿主「启用 URI 协议」开关打开（icc:// 通道门禁）；
/// 5. IPluginUriService.OpenUri("icc://config-profile/switch?name=CSES-Cloud") ——
///    宿主应用方案并 ReloadSettingsFromFile 热重载，全部设置立即生效。
/// </summary>
public static class IccSettingsApplier
{
    /// <summary>合并结果用的配置方案名（ASCII，避免 URI 编码问题）。</summary>
    public const string ProfileName = "CSES-Cloud";

    private static readonly string SwitchResultFile =
        Path.Combine(Path.GetTempPath(), "InkCanvasConfigProfileSwitchResult.txt");

    /// <summary>单键应用结果。</summary>
    public sealed class ApplyResult
    {
        /// <summary>成功写入的键数量。</summary>
        public int Applied { get; set; }

        /// <summary>被跳过的键与原因（key: reason）。</summary>
        public List<string> Skipped { get; } = new();

        /// <summary>热重载是否确认成功（读取宿主切换结果文件）。</summary>
        public bool ReloadConfirmed { get; set; }
    }

    /// <summary>
    /// 应用 icc.* 设置键并热重载。
    /// </summary>
    /// <param name="host">宿主 API。</param>
    /// <param name="adapter">适配器设置（EnsureUriScheme 决定是否自动打开 URI 门禁）。</param>
    /// <param name="pairs">已剥离 icc. 前缀的键值对（key 如 "canvas.inkWidth"）。</param>
    public static async Task<ApplyResult> ApplyAsync(
        IPluginHost host, AdapterSettings adapter, List<KeyValuePair<string, JsonElement>> pairs)
    {
        var appInfo = host.GetService<IAppInfoService>()
                      ?? throw new InvalidOperationException("宿主 IAppInfoService 尚未就绪");
        var profiles = host.GetService<IConfigProfileService>()
                       ?? throw new InvalidOperationException("宿主 IConfigProfileService 尚未就绪");
        var result = new ApplyResult();

        var settingsPath = Path.Combine(appInfo.RootPath ?? "", "Configs", "Settings.json");
        var root = LoadSettingsJson(settingsPath);

        foreach (var pair in pairs)
        {
            var path = pair.Key;
            if (IsBlocked(path))
            {
                result.Skipped.Add(pair.Key + ": 安全相关键不允许远程修改");
                continue;
            }
            if (ApplyOne(root, path, pair.Value))
            {
                result.Applied++;
            }
            else
            {
                result.Skipped.Add(pair.Key + ": 键不存在或类型不匹配");
            }
        }

        if (adapter.EnsureUriScheme && root["advanced"] is JsonObject advanced)
        {
            // 方案 JSON 中同步打开 URI 门禁，热重载后客户端保持可远程控制
            advanced["isEnableUriScheme"] = true;
        }

        var mergedJson = root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        if (!profiles.SaveAsProfile(ProfileName, mergedJson))
        {
            throw new InvalidOperationException("保存 CSES-Cloud 配置方案失败");
        }

        // 门禁检查发生在宿主内存中的 Settings 对象上，需先同步打开（同时落盘，随后被方案覆盖，值一致）
        if (adapter.EnsureUriScheme)
        {
            host.GetService<ISettingsService>()?.Set("advanced.isEnableUriScheme", true);
        }

        var uri = host.GetService<IPluginUriService>();
        if (uri == null || !uri.OpenUri("icc://config-profile/switch?name=" + Uri.EscapeDataString(ProfileName)))
        {
            throw new InvalidOperationException("宿主拒绝了 icc:// 命令（URI 协议不可用）");
        }

        // OpenUri 同步派发到 UI 线程；结果文件在命令完成后写入
        result.ReloadConfirmed = await WaitSwitchResultAsync(TimeSpan.FromSeconds(2));
        return result;
    }

    /// <summary>确认宿主配置方案切换结果（"ok" = 成功热重载）。</summary>
    public static async Task<bool> WaitSwitchResultAsync(TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                if (File.Exists(SwitchResultFile))
                {
                    var text = File.ReadAllText(SwitchResultFile).Trim();
                    if (text.Length > 0)
                    {
                        return text.Equals("ok", StringComparison.OrdinalIgnoreCase);
                    }
                }
            }
            catch { /* 忽略读取失败，继续重试 */ }
            await Task.Delay(100);
        }
        return false;
    }

    // ---------------- 内部 ----------------

    private static JsonObject LoadSettingsJson(string settingsPath)
    {
        try
        {
            if (File.Exists(settingsPath))
            {
                var json = File.ReadAllText(settingsPath);
                if (JsonNode.Parse(json) is JsonObject obj)
                {
                    return obj;
                }
            }
        }
        catch
        {
            // 解析失败时退回空对象：合并将全部跳过，不会破坏客户端配置
        }
        return new JsonObject();
    }

    /// <summary>安全相关键不允许远程修改（密码 / TOTP / USB 白名单等）。</summary>
    private static bool IsBlocked(string path)
    {
        return path.StartsWith("security.", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 合并单个键。返回 true 表示成功。
    /// 规则：路径必须逐级存在且末级键已存在（不允许凭空造键）；写入值的类型须与现值兼容。
    /// </summary>
    private static bool ApplyOne(JsonObject root, string path, JsonElement value)
    {
        var segments = path.Split('.');
        if (segments.Length == 0 || segments.Any(string.IsNullOrWhiteSpace)) return false;

        JsonObject current = root;
        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (current[segments[i]] is not JsonObject next)
            {
                return false;
            }
            current = next;
        }

        var lastSegment = segments[^1];
        var target = current[lastSegment];
        if (target == null)
        {
            return false;
        }

        var converted = ConvertValue(target, value);
        if (converted == null)
        {
            return false;
        }
        current[lastSegment] = converted;
        return true;
    }

    /// <summary>按现值的 JSON 类型校验并转换新值；不兼容返回 null。</summary>
    private static JsonNode? ConvertValue(JsonNode existing, JsonElement incoming)
    {
        switch (incoming.ValueKind)
        {
            case JsonValueKind.True:
            case JsonValueKind.False:
                if (existing is JsonValue v && v.TryGetValue<bool>(out _))
                {
                    return JsonValue.Create(incoming.GetBoolean());
                }
                return null;
            case JsonValueKind.Number:
                if (existing is JsonValue n)
                {
                    if (n.TryGetValue<int>(out _)) return JsonValue.Create(incoming.GetInt32());
                    if (n.TryGetValue<long>(out _)) return JsonValue.Create(incoming.GetInt64());
                    if (n.TryGetValue<double>(out _)) return JsonValue.Create(incoming.GetDouble());
                }
                return null;
            case JsonValueKind.String:
                var text = incoming.GetString() ?? "";
                if (existing is JsonValue sv)
                {
                    if (sv.TryGetValue<string>(out _)) return JsonValue.Create(text);
                    if (sv.TryGetValue<bool>(out _))
                    {
                        if (bool.TryParse(text, out var b)) return JsonValue.Create(b);
                        if (text == "1") return JsonValue.Create(true);
                        if (text == "0") return JsonValue.Create(false);
                        return null;
                    }
                    if (sv.TryGetValue<int>(out _)) return int.TryParse(text, out var i) ? JsonValue.Create(i) : null;
                    if (sv.TryGetValue<long>(out _)) return long.TryParse(text, out var l) ? JsonValue.Create(l) : null;
                    if (sv.TryGetValue<double>(out _)) return double.TryParse(text, out var d) ? JsonValue.Create(d) : null;
                }
                return null;
            case JsonValueKind.Null:
                return null; // 不允许远程清空键值
            default:
                // 对象/数组键不允许经 settings.apply 覆盖（平台侧不生成这类键）
                return null;
        }
    }
}
