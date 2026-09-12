using System.Reflection;
using System.Text;
using System.Text.Json;
using ClassIsland.Core;
using ClassIsland.Core.Abstractions.Services;
using ClassIsland.Shared;
using ClassIsland.Shared.Helpers;
using ClassIsland.Shared.Models.Profile;

namespace CsesCloudAdapter.Services;

/// <summary>
/// 将平台下发的 ClassIsland 档案应用到本地：
/// - hotswap：替换 IProfileService.Profile 中的 Subjects / TimeLayouts / ClassPlans / ClassPlanGroups 字典，
///   由 Profile.PropertyChanged 自动持久化，LessonsService 在下一个计时周期（≤50ms）按新档案重算并触发 OnClass 等事件；
/// - file：把档案 JSON 写入 Profiles/&lt;name&gt;.json，并尽力把 Settings.SelectedProfile 指向它（重启或手动切换档案后生效）。
/// </summary>
public static class ProfileApplier
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    /// <summary>
    /// 应用方式：热替换当前档案。
    /// </summary>
    public static void ApplyHotSwap(Profile incoming)
    {
        var profileService = IAppHost.GetService<IProfileService>();
        var profile = profileService.Profile;

        if (!string.IsNullOrWhiteSpace(incoming.Name))
        {
            profile.Name = incoming.Name;
        }
        if (incoming.Subjects is { Count: > 0 } || incoming.TimeLayouts is { Count: > 0 })
        {
            profile.Subjects = ConfigureFileHelper.CopyObject(incoming.Subjects);
            profile.TimeLayouts = ConfigureFileHelper.CopyObject(incoming.TimeLayouts);
            profile.ClassPlans = ConfigureFileHelper.CopyObject(incoming.ClassPlans);
            if (incoming.ClassPlanGroups is { Count: > 0 })
            {
                profile.ClassPlanGroups = ConfigureFileHelper.CopyObject(incoming.ClassPlanGroups);
            }
            if (incoming.SelectedClassPlanGroupId != Guid.Empty)
            {
                profile.SelectedClassPlanGroupId = incoming.SelectedClassPlanGroupId;
            }
        }
        // 显式保存一份，确保即使无属性变更订阅也已落盘
        profileService.SaveProfile();
    }

    /// <summary>
    /// 应用方式：写入档案文件并切换（尽力而为）。
    /// </summary>
    /// <returns>写入的档案文件名</returns>
    public static string ApplyToFile(string profileJson, string fileName)
    {
        var safeName = SanitizeFileName(fileName);
        var dir = Path.Combine(CommonDirectories.AppRootFolderPath, "Profiles");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, safeName);
        File.WriteAllText(path, profileJson, new UTF8Encoding(false));
        TrySwitchSelectedProfile(safeName);
        return safeName;
    }

    /// <summary>
    /// 解析平台档案 JSON 为 Profile 模型。
    /// </summary>
    public static Profile ParseProfile(string json)
    {
        var profile = JsonSerializer.Deserialize<Profile>(json, JsonOptions)
                      ?? throw new InvalidDataException("档案 JSON 反序列化结果为空");
        return profile;
    }

    /// <summary>
    /// 简单的关键格式校验（与平台侧识别规则一致）。
    /// </summary>
    public static bool LooksLikeClassIslandProfile(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return false;
        foreach (var key in new[] { "TimeLayouts", "ClassPlans", "Subjects" })
        {
            if (!root.TryGetProperty(key, out var v) || v.ValueKind != JsonValueKind.Object) return false;
        }
        if (root.TryGetProperty("Subjects", out var subjects) && subjects.ValueKind == JsonValueKind.Object)
        {
            foreach (var s in subjects.EnumerateObject())
            {
                if (s.Value.ValueKind != JsonValueKind.Object) return false;
                if (!s.Value.TryGetProperty("Name", out var name) || name.ValueKind != JsonValueKind.String) return false;
            }
        }
        if (root.TryGetProperty("TimeLayouts", out var layouts) && layouts.ValueKind == JsonValueKind.Object)
        {
            foreach (var tl in layouts.EnumerateObject())
            {
                if (tl.Value.ValueKind != JsonValueKind.Object) return false;
                if (!tl.Value.TryGetProperty("Layouts", out var arr) || arr.ValueKind != JsonValueKind.Array) return false;
            }
        }
        return true;
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string((name ?? "CSES-Cloud.json").Where(c => !invalid.Contains(c)).ToArray()).Trim();
        if (string.IsNullOrWhiteSpace(clean)) clean = "CSES-Cloud.json";
        if (!clean.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) clean += ".json";
        return clean;
    }

    /// <summary>
    /// 尝试通过反射把 Settings.SelectedProfile 指向新档案（SettingsService 位于主程序集，插件不可直接引用）。
    /// 失败时静默忽略，由用户在 ClassIsland 档案设置中手动切换。
    /// </summary>
    private static void TrySwitchSelectedProfile(string fileName)
    {
        try
        {
            var settingsServiceType = Type.GetType("ClassIsland.Services.SettingsService, ClassIsland", throwOnError: false);
            if (settingsServiceType == null) return;
            var service = ResolveMainAppService(settingsServiceType);
            if (service == null) return;
            var settingsProp = settingsServiceType.GetProperty("Settings");
            var settings = settingsProp?.GetValue(service);
            var selectedProp = settings?.GetType().GetProperty("SelectedProfile");
            if (selectedProp != null && selectedProp.CanWrite)
            {
                selectedProp.SetValue(settings, fileName);
            }
            var saveMethod = settingsServiceType.GetMethod("SaveSettings", Type.EmptyTypes);
            saveMethod?.Invoke(service, null);
        }
        catch
        {
            // 尽力而为：切换失败不影响档案文件本身
        }
    }

    /// <summary>
    /// 通过反射调用 IAppHost.TryGetService&lt;T&gt;() 解析主程序集服务（插件不能直接引用主程序集类型）。
    /// </summary>
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
}
