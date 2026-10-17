using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace CsesCloudIcceAdapter.Views;

/// <summary>
/// 适配器设置视图（宿主插件设置页渲染）：
/// 服务器地址 / 注册码 / 导入凭据、连接与断开、同步选项与运行状态。
/// 纯代码构建，不依赖 XAML 编译。
/// </summary>
public sealed class CsesSettingsView : UserControl
{
    private readonly Plugin _plugin;

    private readonly TextBox _serverUrlBox = new() { Height = 30, VerticalContentAlignment = VerticalAlignment.Center };
    private readonly TextBox _enrollmentBox = new() { Height = 30, VerticalContentAlignment = VerticalAlignment.Center, FontFamily = new FontFamily("Consolas") };
    private readonly TextBox _deviceNameBox = new() { Height = 30, VerticalContentAlignment = VerticalAlignment.Center };
    private readonly TextBox _pollIntervalBox = new() { Height = 30, VerticalContentAlignment = VerticalAlignment.Center };
    private readonly CheckBox _autoSyncCheck = new() { Content = "自动同步（后台定期拉取命令与设置）" };
    private readonly CheckBox _ensureUriSchemeCheck = new() { Content = "自动开启 ICC CE「启用 URI 协议」开关（远程控制依赖）" };
    private readonly CheckBox _showNotificationsCheck = new() { Content = "显示平台通知提醒" };
    private readonly ComboBox _transportCombo = new() { Height = 30 };
    private readonly TextBlock _statusText = new() { TextWrapping = TextWrapping.Wrap, Foreground = Brushes.Gray, Margin = new Thickness(0, 4, 0, 0) };

    public CsesSettingsView(Plugin plugin)
    {
        _plugin = plugin;

        _transportCombo.Items.Add(new ComboBoxItem { Content = "长轮询（REST）", Tag = "poll" });
        _transportCombo.Items.Add(new ComboBoxItem { Content = "WebSocket（实时推送）", Tag = "ws" });

        Content = BuildLayout();
        Loaded += (_, _) => LoadFromSettings();
        if (plugin.Sync != null)
        {
            plugin.Sync.StatusChanged += RefreshStatus;
        }
        Unloaded += (_, _) =>
        {
            if (plugin.Sync != null)
            {
                plugin.Sync.StatusChanged -= RefreshStatus;
            }
        };
    }

    private FrameworkElement BuildLayout()
    {
        var title = new TextBlock
        {
            Text = "CSES Cloud 适配器",
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 4),
        };
        var subtitle = new TextBlock
        {
            Text = "将 ICC CE 接入 CSES Cloud 平台：注册设备、接收设置下发与远程命令。",
            TextWrapping = TextWrapping.Wrap,
            Foreground = Brushes.Gray,
            Margin = new Thickness(0, 0, 0, 12),
        };

        var serverField = BuildField("服务器地址", _serverUrlBox, "例如 https://cses.example.com");
        var enrollField = BuildField("注册码", _enrollmentBox, "ICCCE-XXXX-XXXX（平台「连接应用」页生成，仅首次绑定需要）");
        var nameField = BuildField("设备名称（可选，默认主机名）", _deviceNameBox, "例如：高一（3）班讲台机");

        var connectRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 12) };
        connectRow.Children.Add(BuildButton("导入凭据文件…", async (_, _) => await ImportCredentialsAsync()));
        connectRow.Children.Add(BuildButton("连接", async (_, _) => await ConnectAsync(), bold: true));
        connectRow.Children.Add(BuildButton("断开连接", async (_, _) => await DisconnectAsync()));
        connectRow.Children.Add(BuildButton("立即同步", async (_, _) => await SyncNowAsync()));

        var optionsTitle = new TextBlock
        {
            Text = "同步选项",
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 8, 0, 8),
        };

        var transportRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
        transportRow.Children.Add(new TextBlock { Text = "连接传输：", VerticalAlignment = VerticalAlignment.Center });
        _transportCombo.Width = 200;
        transportRow.Children.Add(_transportCombo);
        transportRow.Children.Add(new TextBlock { Text = "  同步间隔（秒）：" , VerticalAlignment = VerticalAlignment.Center });
        _pollIntervalBox.Width = 80;
        transportRow.Children.Add(_pollIntervalBox);

        var optionsPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
        optionsPanel.Children.Add(_autoSyncCheck);
        optionsPanel.Children.Add(_ensureUriSchemeCheck);
        optionsPanel.Children.Add(_showNotificationsCheck);
        optionsPanel.Children.Add(transportRow);

        var saveRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 12) };
        saveRow.Children.Add(BuildButton("保存设置", (_, _) => SaveSettings()));

        var statusTitle = new TextBlock
        {
            Text = "运行状态",
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 8, 0, 4),
        };

        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var root = new StackPanel { Margin = new Thickness(16) };
        root.Children.Add(title);
        root.Children.Add(subtitle);
        root.Children.Add(serverField);
        root.Children.Add(enrollField);
        root.Children.Add(nameField);
        root.Children.Add(connectRow);
        root.Children.Add(optionsTitle);
        root.Children.Add(optionsPanel);
        root.Children.Add(saveRow);
        root.Children.Add(statusTitle);
        root.Children.Add(_statusText);
        scroll.Content = root;
        return scroll;
    }

    private static FrameworkElement BuildField(string label, FrameworkElement editor, string placeholder)
    {
        var panel = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
        panel.Children.Add(new TextBlock { Text = label, Margin = new Thickness(0, 0, 0, 4) });
        if (editor is TextBox box)
        {
            box.Tag = placeholder;
        }
        editor.MaxWidth = 480;
        editor.HorizontalAlignment = HorizontalAlignment.Left;
        panel.Children.Add(editor);
        return panel;
    }

    private static Button BuildButton(string text, RoutedEventHandler onClick, bool bold = false)
    {
        var button = new Button
        {
            Content = text,
            Padding = new Thickness(14, 6, 14, 6),
            Margin = new Thickness(0, 0, 8, 0),
            FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
        };
        button.Click += onClick;
        return button;
    }

    private void LoadFromSettings()
    {
        var settings = _plugin.LoadSettings();
        _serverUrlBox.Text = settings.ServerUrl;
        _enrollmentBox.Text = settings.EnrollmentCode;
        _deviceNameBox.Text = settings.DeviceName;
        _autoSyncCheck.IsChecked = settings.AutoSyncEnabled;
        _ensureUriSchemeCheck.IsChecked = settings.EnsureUriScheme;
        _showNotificationsCheck.IsChecked = settings.ShowBroadcastNotifications;
        _pollIntervalBox.Text = settings.PollIntervalSeconds.ToString();
        SelectTransport(settings.Transport);
        RefreshStatus();
    }

    private void SelectTransport(string transport)
    {
        for (var i = 0; i < _transportCombo.Items.Count; i++)
        {
            if (_transportCombo.Items[i] is ComboBoxItem item && (string?)item.Tag == transport)
            {
                _transportCombo.SelectedIndex = i;
                return;
            }
        }
        _transportCombo.SelectedIndex = 0;
    }

    private AdapterSettings CollectSettings()
    {
        var settings = _plugin.LoadSettings();
        settings.ServerUrl = _serverUrlBox.Text.Trim().TrimEnd('/');
        settings.EnrollmentCode = _enrollmentBox.Text.Trim();
        settings.DeviceName = _deviceNameBox.Text.Trim();
        settings.AutoSyncEnabled = _autoSyncCheck.IsChecked == true;
        settings.EnsureUriScheme = _ensureUriSchemeCheck.IsChecked == true;
        settings.ShowBroadcastNotifications = _showNotificationsCheck.IsChecked == true;
        if (int.TryParse(_pollIntervalBox.Text.Trim(), out var poll) && poll >= 5)
        {
            settings.PollIntervalSeconds = Math.Min(poll, 86400);
        }
        settings.Transport = _transportCombo.SelectedItem is ComboBoxItem item && item.Tag is string tag ? tag : "poll";
        settings.Normalize();
        return settings;
    }

    private void SaveSettings()
    {
        _plugin.SaveSettings(CollectSettings());
        _plugin.Sync?.ReloadConfiguration();
        SetStatus("设置已保存");
    }

    private async Task ImportCredentialsAsync()
    {
        try
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Title = "导入 CSES Cloud 凭据文件",
                Filter = "凭据文件 (*.json)|*.json|所有文件 (*.*)|*.*",
            };
            if (dialog.ShowDialog() != true) return;
            var imported = ImportedCredentialsFile.Read(dialog.FileName)
                          ?? throw new InvalidOperationException("不是有效的 CSES Cloud 凭据文件");
            var settings = _plugin.LoadSettings();
            if (!string.IsNullOrWhiteSpace(imported.ServerUrlValue)) settings.ServerUrl = imported.ServerUrlValue;
            if (!string.IsNullOrWhiteSpace(imported.EnrollmentCodeValue)) settings.EnrollmentCode = imported.EnrollmentCodeValue;
            _plugin.SaveSettings(settings);
            LoadFromSettings();
            SetStatus("凭据已导入，点击「连接」完成设备绑定");
        }
        catch (Exception e)
        {
            MessageBox.Show("导入凭据失败：" + e.Message, "CSES Cloud 适配器", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        await Task.CompletedTask;
    }

    private async Task ConnectAsync()
    {
        try
        {
            SaveSettings();
            var sync = _plugin.Sync ?? throw new InvalidOperationException("同步服务尚未就绪");
            await sync.RegisterNowAsync();
            RefreshStatus();
        }
        catch (Exception e)
        {
            MessageBox.Show("连接失败：" + e.Message, "CSES Cloud 适配器", MessageBoxButton.OK, MessageBoxImage.Warning);
            RefreshStatus();
        }
    }

    private async Task DisconnectAsync()
    {
        try
        {
            if (MessageBox.Show("确认断开与 CSES Cloud 平台的连接？绑定将移除，重新接入需要新的注册码。",
                    "CSES Cloud 适配器", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK)
            {
                return;
            }
            await (_plugin.Sync?.DisconnectAsync() ?? Task.CompletedTask);
            RefreshStatus();
        }
        catch (Exception e)
        {
            MessageBox.Show("断开失败：" + e.Message, "CSES Cloud 适配器", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async Task SyncNowAsync()
    {
        try
        {
            SaveSettings();
            var sync = _plugin.Sync ?? throw new InvalidOperationException("同步服务尚未就绪");
            await sync.SyncNowAsync();
            RefreshStatus();
        }
        catch (Exception e)
        {
            MessageBox.Show("同步失败：" + e.Message, "CSES Cloud 适配器", MessageBoxButton.OK, MessageBoxImage.Warning);
            RefreshStatus();
        }
    }

    private void RefreshStatus()
    {
        var sync = _plugin.Sync;
        if (sync == null)
        {
            SetStatus("同步服务尚未就绪");
            return;
        }
        var connected = sync.IsConnected
            ? $"已连接（实例 {sync.ConnectedInstanceUid}）"
            : "未连接";
        SetStatus(connected + " · " + sync.StatusText);
    }

    private void SetStatus(string text)
    {
        _statusText.Text = text;
    }
}
