using System.ComponentModel;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using ClassIsland.Core.Abstractions.Controls;
using ClassIsland.Core.Attributes;
using ClassIsland.Shared;
using CsesCloudAdapter.Models;
using CsesCloudAdapter.Services;

namespace CsesCloudAdapter.Views.SettingsPages;

/// <summary>
/// CSES Cloud 适配器设置页。
/// </summary>
[SettingsPageInfo("cloud.cses.classisland.settings", "CSES Cloud 适配器")]
public partial class CsesSettingsPage : SettingsPageBase
{
    private CsesCloudSyncService? Service => IAppHost.TryGetService<CsesCloudSyncService>();

    public CsesSettingsViewModel ViewModel { get; } = new();

    public CsesSettingsPage()
    {
        InitializeComponent();
        ViewModel.Load(Service);
        DataContext = ViewModel;
    }

    private async void OnSaveSettings(object? sender, RoutedEventArgs e)
    {
        try
        {
            var plugin = Plugin.Instance ?? throw new InvalidOperationException("插件尚未初始化");
            plugin.SaveSettings(ViewModel.ToSettings());
            Service?.ReloadConfiguration();
            ViewModel.StatusText = "设置已保存";
            ViewModel.RefreshStatus(Service);
        }
        catch (Exception ex)
        {
            ViewModel.StatusText = "保存失败：" + ex.Message;
        }
        await Task.CompletedTask;
    }

    /// <summary>
    /// 导入平台「下载凭据」生成的 cses-cloud-credentials.json，
    /// 自动填充服务器地址与注册码并立即注册。
    /// </summary>
    private async void OnImportCredentials(object? sender, RoutedEventArgs e)
    {
        try
        {
            var topLevel = TopLevel.GetTopLevel(this)
                           ?? throw new InvalidOperationException("无法打开文件选择器");
            var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                Title = "选择凭据文件（cses-cloud-credentials.json）",
                AllowMultiple = false,
                FileTypeFilter = new FilePickerFileType[]
                {
                    new("JSON 凭据文件") { Patterns = new[] { "*.json" } },
                },
            });
            if (files.Count == 0) return;
            var path = files[0].Path.LocalPath;
            var json = await File.ReadAllTextAsync(path);
            var file = JsonSerializer.Deserialize<ImportedCredentialsFile>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (!ViewModel.ApplyImportedCredentials(file))
            {
                ViewModel.StatusText = "导入失败：文件缺少注册码（请从平台「连接应用」页面重新下载凭据）";
                return;
            }
            ViewModel.StatusText = "凭据已导入，正在连接…";
            await SaveSettingsQuietAsync();
            var service = Service;
            if (service != null)
            {
                try
                {
                    await service.RegisterNowAsync();
                }
                catch (Exception ex)
                {
                    ViewModel.StatusText = "注册失败：" + ex.Message;
                }
                ViewModel.RefreshStatus(service);
            }
        }
        catch (Exception ex)
        {
            ViewModel.StatusText = "导入失败：" + ex.Message;
        }
    }

    private async void OnRegister(object? sender, RoutedEventArgs e)
    {
        var service = Service;
        if (service == null)
        {
            ViewModel.StatusText = "服务未就绪，无法注册";
            return;
        }
        try
        {
            await SaveSettingsQuietAsync();
            await service.RegisterNowAsync();
        }
        catch (Exception ex)
        {
            ViewModel.StatusText = "注册失败：" + ex.Message;
        }
        ViewModel.RefreshStatus(service);
    }

    private async void OnSyncNow(object? sender, RoutedEventArgs e)
    {
        var service = Service;
        if (service == null)
        {
            ViewModel.StatusText = "服务未就绪";
            return;
        }
        try
        {
            await SaveSettingsQuietAsync();
            await service.SyncNowAsync();
        }
        catch (Exception ex)
        {
            ViewModel.StatusText = "同步失败：" + ex.Message;
        }
        ViewModel.RefreshStatus(service);
    }

    private void OnRefreshStatus(object? sender, RoutedEventArgs e)
    {
        ViewModel.RefreshStatus(Service);
    }

    private async Task SaveSettingsQuietAsync()
    {
        var plugin = Plugin.Instance;
        if (plugin != null)
        {
            plugin.SaveSettings(ViewModel.ToSettings());
            Service?.ReloadConfiguration();
        }
        await Task.CompletedTask;
    }
}
