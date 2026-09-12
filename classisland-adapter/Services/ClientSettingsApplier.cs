using System.Reflection;
using ClassIsland.Shared;

namespace CsesCloudAdapter.Services;

/// <summary>
/// 客户端设置下发：把平台 settings.apply 中的 client.* 键写入 ClassIsland 客户端的
/// SettingsService.Settings（白名单属性，经反射访问主程序集）。
/// 与平台「应用配置 → 客户端设置」页的键一一对应。
/// </summary>
public static class ClientSettingsApplier
{
    /// <summary>
    /// 白名单：平台键 → (Settings 属性名, 类型)。
    /// </summary>
    private static readonly Dictionary<string, (string Property, string Kind)> Whitelist = new()
    {
        // 外观
        ["client.theme"] = ("Theme", "int"),                       // 0 跟随系统 / 1 明亮 / 2 黑暗
        ["client.animationLevel"] = ("AnimationLevel", "int"),
        ["client.opacity"] = ("Opacity", "double"),                // 背景不透明度 0-1
        ["client.scale"] = ("Scale", "double"),                    // 界面缩放
        // 提醒
        ["client.classPrepareEnabled"] = ("IsClassPrepareNotificationEnabled", "bool"),
        ["client.classPrepareSeconds"] = ("ClassPrepareNotifySeconds", "int"),
        ["client.classOffEnabled"] = ("IsClassOffNotificationEnabled", "bool"),
        ["client.classChangingEnabled"] = ("IsClassChangingNotificationEnabled", "bool"),
        // 显示
        ["client.extraInfoType"] = ("ExtraInfoType", "int"),       // 时间点附加信息 0-5
        ["client.countdownEnabled"] = ("IsCountdownEnabled", "bool"),
        ["client.countdownSeconds"] = ("CountdownSeconds", "int"),
        ["client.defaultOnClassMinutes"] = ("DefaultOnClassTimePointMinutes", "int"),
        ["client.defaultBreakingMinutes"] = ("DefaultBreakingTimePointMinutes", "int"),
        // 时间
        ["client.exactTimeEnabled"] = ("IsExactTimeEnabled", "bool"),
        ["client.timeAutoAdjust"] = ("IsTimeAutoAdjustEnabled", "bool"),
        ["client.timeOffsetSeconds"] = ("TimeOffsetSeconds", "double"),
    };

    /// <summary>
    /// 应用 client.* 设置项；返回实际生效的键数量。
    /// </summary>
    public static int Apply(IEnumerable<KeyValuePair<string, object?>> settings)
    {
        var clientPairs = settings.Where(kv => kv.Key.StartsWith("client.", StringComparison.Ordinal)).ToList();
        if (clientPairs.Count == 0) return 0;

        var settingsServiceType = Type.GetType("ClassIsland.Services.SettingsService, ClassIsland", throwOnError: false);
        if (settingsServiceType == null) return 0;
        var service = ResolveMainAppService(settingsServiceType);
        if (service == null) return 0;
        var settingsObj = settingsServiceType.GetProperty("Settings")?.GetValue(service);
        if (settingsObj == null) return 0;

        var applied = 0;
        foreach (var kv in clientPairs)
        {
            if (!Whitelist.TryGetValue(kv.Key, out var entry)) continue;
            var prop = settingsObj.GetType().GetProperty(entry.Property, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null || !prop.CanWrite) continue;
            try
            {
                object? converted = entry.Kind switch
                {
                    "bool" => ToBool(kv.Value),
                    "int" => ToInt(kv.Value),
                    "double" => ToDouble(kv.Value),
                    _ => kv.Value?.ToString(),
                };
                if (converted == null) continue;
                prop.SetValue(settingsObj, converted);
                applied++;
            }
            catch
            {
                // 单项失败不影响其他项
            }
        }

        if (applied > 0)
        {
            try
            {
                settingsServiceType.GetMethod("SaveSettings", Type.EmptyTypes)?.Invoke(service, null);
            }
            catch
            {
                // 保存失败时设置仍在本会话生效
            }
        }
        return applied;
    }

    private static object? ResolveMainAppService(Type serviceType)
    {
        try
        {
            var tryGet = typeof(IAppHost).GetMethods(BindingFlags.Static | BindingFlags.Public)
                .FirstOrDefault(m => m.Name == nameof(IAppHost.TryGetService) && m.IsGenericMethod && m.GetParameters().Length == 0);
            if (tryGet == null) return null;
            return tryGet.MakeGenericMethod(serviceType).Invoke(null, null);
        }
        catch
        {
            return null;
        }
    }

    private static object? ToBool(object? value)
    {
        if (value == null) return null;
        if (value is bool b) return b;
        if (value is double d) return d != 0;
        if (value is int i) return i != 0;
        var s = value.ToString();
        if (bool.TryParse(s, out var result)) return result;
        if (s == "1") return true;
        if (s == "0") return false;
        return null;
    }

    private static object? ToInt(object? value)
    {
        if (value == null) return null;
        if (value is int i) return i;
        if (value is double d) return (int)Math.Round(d);
        return int.TryParse(value.ToString(), out var result) ? result : null;
    }

    private static object? ToDouble(object? value)
    {
        if (value == null) return null;
        if (value is double d) return d;
        if (value is int i) return (double)i;
        if (value is bool b) return b ? 1.0 : 0.0;
        return double.TryParse(value.ToString(), out var result) ? result : null;
    }
}
