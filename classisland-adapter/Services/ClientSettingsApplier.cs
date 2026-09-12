using System.Globalization;
using System.Reflection;
using ClassIsland.Shared;

namespace CsesCloudAdapter.Services;

/// <summary>
/// 客户端设置下发：把平台 settings.apply 中的 client.* 键写入 ClassIsland 客户端的
/// SettingsService.Settings（白名单属性，经反射访问主程序集）。
/// 与平台「应用设置」页的键一一对应（页面对齐 ClassIsland 设置窗口左栏结构）。
/// </summary>
public static class ClientSettingsApplier
{
    /// <summary>
    /// 白名单：平台键 → (Settings 属性名, 类型)。
    /// </summary>
    private static readonly Dictionary<string, (string Property, string Kind)> Whitelist = new()
    {
        // ===== 通用 → 基本（GeneralSettingsPage）=====
        ["client.hideMode"] = ("HideMode", "int"),                       // 0 基础模式 / 1 规则模式
        ["client.hideOnClass"] = ("HideOnClass", "bool"),
        ["client.hideOnMaxWindow"] = ("HideOnMaxWindow", "bool"),
        ["client.hideOnFullscreen"] = ("HideOnFullscreen", "bool"),
        ["client.singleWeekStartTime"] = ("SingleWeekStartTime", "datetime"),
        ["client.multiWeekRotationMaxCycle"] = ("MultiWeekRotationMaxCycle", "int"),
        ["client.taskBarIconClickBehavior"] = ("TaskBarIconClickBehavior", "int"),
        ["client.isSplashEnabled"] = ("IsSplashEnabled", "bool"),
        ["client.showDetailedStatusOnSplash"] = ("ShowDetailedStatusOnSplash", "bool"),
        ["client.reduceProgressAccuracy"] = ("ReduceProgressAccuracy", "bool"),
        // ===== 通用 → 时钟（ClockSettingsPage + 时间线显示）=====
        ["client.exactTimeEnabled"] = ("IsExactTimeEnabled", "bool"),
        ["client.exactTimeServer"] = ("ExactTimeServer", "string"),
        ["client.timeAutoAdjust"] = ("IsTimeAutoAdjustEnabled", "bool"),
        ["client.timeAutoAdjustSeconds"] = ("TimeAutoAdjustSeconds", "double"),
        ["client.timeOffsetSeconds"] = ("TimeOffsetSeconds", "double"),
        ["client.extraInfoType"] = ("ExtraInfoType", "int"),             // 时间点附加信息 0-5
        ["client.countdownEnabled"] = ("IsCountdownEnabled", "bool"),
        ["client.countdownSeconds"] = ("CountdownSeconds", "int"),
        ["client.defaultOnClassMinutes"] = ("DefaultOnClassTimePointMinutes", "int"),
        ["client.defaultBreakingMinutes"] = ("DefaultBreakingTimePointMinutes", "int"),
        // ===== 通用 → 存储（StorageSettingsPage）=====
        ["client.autoBackupEnabled"] = ("IsAutoBackupEnabled", "bool"),
        ["client.autoBackupIntervalDays"] = ("AutoBackupIntervalDays", "int"),
        ["client.autoBackupLimit"] = ("AutoBackupLimit", "int"),
        // ===== 通用 → 隐私（PrivacySettingsPage）=====
        ["client.isReportingEnabled"] = ("IsReportingEnabled", "bool"),
        ["client.isSentryEnabled"] = ("IsSentryEnabled", "bool"),
        // ===== 通用 → 翻新与迎新（RefreshingSettingsPage）=====
        ["client.isRefreshingToastEnabled"] = ("IsRefreshingToastEnabled", "bool"),
        ["client.refreshingToastThresholdDays"] = ("RefreshingToastThresholdDays", "int"),
        ["client.maxRefreshingToastCounts"] = ("MaxRefreshingToastCounts", "int"),
        ["client.leftRefreshingToastCounts"] = ("LeftRefreshingToastCounts", "int"),
        ["client.showRefreshingToastOnNextStart"] = ("ShowRefreshingToastOnNextStart", "bool"),
        // ===== 通用 → 高级（AdvancedSettingsPage）=====
        ["client.autoDisableCorruptPlugins"] = ("AutoDisableCorruptPlugins", "bool"),
        ["client.isDebugOptionsEnabled"] = ("IsDebugOptionsEnabled", "bool"),
        // ===== 主界面 → 外观（AppearanceSettingsPage）=====
        ["client.theme"] = ("Theme", "int"),                             // 0 跟随系统 / 1 明亮 / 2 黑暗
        ["client.animationLevel"] = ("AnimationLevel", "int"),
        ["client.opacity"] = ("Opacity", "double"),                      // 背景不透明度 0-1
        ["client.scale"] = ("Scale", "double"),                          // 界面缩放
        ["client.radiusX"] = ("RadiusX", "double"),
        ["client.targetLightValue"] = ("TargetLightValue", "double"),
        ["client.isFallbackModeEnabled"] = ("IsFallbackModeEnabled", "bool"),
        ["client.isIslandSeperated"] = ("IsIslandSeperated", "bool"),
        ["client.primaryColor"] = ("PrimaryColor", "color"),             // "#RRGGBB" / "#AARRGGBB"
        ["client.backgroundColor"] = ("BackgroundColor", "color"),
        ["client.isCustomBackgroundColorEnabled"] = ("IsCustomBackgroundColorEnabled", "bool"),
        ["client.mainWindowFont"] = ("MainWindowFont", "string"),
        ["client.mainWindowSecondaryFontSize"] = ("MainWindowSecondaryFontSize", "double"),
        ["client.mainWindowBodyFontSize"] = ("MainWindowBodyFontSize", "double"),
        ["client.mainWindowEmphasizedFontSize"] = ("MainWindowEmphasizedFontSize", "double"),
        ["client.mainWindowLargeFontSize"] = ("MainWindowLargeFontSize", "double"),
        ["client.mainWindowFontWeight2"] = ("MainWindowFontWeight2", "int"),
        ["client.mainWindowLineVerticalMargin"] = ("MainWindowLineVerticalMargin", "double"),
        // ===== 主界面 → 提醒（NotificationSettingsPage + 课程提醒）=====
        ["client.isNotificationEnabled"] = ("IsNotificationEnabled", "bool"),
        ["client.isNotificationEffectEnabled"] = ("IsNotificationEffectEnabled", "bool"),
        ["client.allowNotificationEffect"] = ("AllowNotificationEffect", "bool"),
        ["client.isNotificationSoundEnabled"] = ("IsNotificationSoundEnabled", "bool"),
        ["client.allowNotificationSound"] = ("AllowNotificationSound", "bool"),
        ["client.notificationSoundVolume"] = ("NotificationSoundVolume", "double"),
        ["client.isSpeechEnabled"] = ("IsSpeechEnabled", "bool"),
        ["client.allowNotificationSpeech"] = ("AllowNotificationSpeech", "bool"),
        ["client.speechVolume"] = ("SpeechVolume", "double"),
        ["client.isNotificationTopmostEnabled"] = ("IsNotificationTopmostEnabled", "bool"),
        ["client.allowNotificationTopmost"] = ("AllowNotificationTopmost", "bool"),
        ["client.classPrepareEnabled"] = ("IsClassPrepareNotificationEnabled", "bool"),
        ["client.classPrepareSeconds"] = ("ClassPrepareNotifySeconds", "int"),
        ["client.classOffEnabled"] = ("IsClassOffNotificationEnabled", "bool"),
        ["client.classChangingEnabled"] = ("IsClassChangingNotificationEnabled", "bool"),
        // ===== 主界面 → 窗口（WindowSettingsPage）=====
        ["client.windowDockingLocation"] = ("WindowDockingLocation", "int"), // 0 上左…5 下右
        ["client.windowDockingOffsetX"] = ("WindowDockingOffsetX", "int"),
        ["client.windowDockingOffsetY"] = ("WindowDockingOffsetY", "int"),
        ["client.windowDockingMonitorIndex"] = ("WindowDockingMonitorIndex", "int"),
        ["client.windowLayer"] = ("WindowLayer", "int"),                 // 0 置底 / 1 置顶
        ["client.windowTopmostRecheckMode"] = ("WindowTopmostRecheckMode", "int"),
        ["client.isWindowCaptureBlockingEnabled"] = ("IsWindowCaptureBlockingEnabled", "bool"),
        ["client.isMouseClickingEnabled"] = ("IsMouseClickingEnabled", "bool"),
        ["client.isMouseInFadingEnabled"] = ("IsMouseInFadingEnabled", "bool"),
        ["client.touchInFadingDurationMs"] = ("TouchInFadingDurationMs", "double"),
        ["client.useRawInput"] = ("UseRawInput", "bool"),
        // ===== 主界面 → 天气（WeatherSettingsPage）=====
        ["client.cityId"] = ("CityId", "string"),
        ["client.cityName"] = ("CityName", "string"),
        ["client.weatherLatitude"] = ("WeatherLatitude", "double"),
        ["client.weatherLongitude"] = ("WeatherLongitude", "double"),
        ["client.autoRefreshWeatherLocation"] = ("AutoRefreshWeatherLocation", "bool"),
        // ===== 自动化（AutomationSettingsPage）=====
        ["client.isAutomationEnabled"] = ("IsAutomationEnabled", "bool"),
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
                    "datetime" => ToDateTime(kv.Value),
                    "color" => ToColor(kv.Value),
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

    /// <summary>平台以 "yyyy-MM-dd" 等字符串下发 DateTime 设置（如单周开始时间）。</summary>
    private static object? ToDateTime(object? value)
    {
        if (value == null) return null;
        if (value is DateTime dt) return dt;
        return DateTime.TryParse(value.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var result)
            ? result
            : null;
    }

    /// <summary>平台以 "#RRGGBB" / "#AARRGGBB" 字符串下发 Avalonia 颜色设置。</summary>
    private static object? ToColor(object? value)
    {
        if (value == null) return null;
        var text = value.ToString();
        if (string.IsNullOrWhiteSpace(text)) return null;
        var colorType = Type.GetType("Avalonia.Media.Color, Avalonia.Base", throwOnError: false);
        var parse = colorType?.GetMethod("Parse", new[] { typeof(string) });
        if (colorType == null || parse == null) return null;
        try
        {
            return parse.Invoke(null, new object?[] { text.Trim() });
        }
        catch
        {
            return null;
        }
    }
}
