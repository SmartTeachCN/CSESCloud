using Avalonia.Controls;
using Avalonia.Media;
using ClassIsland.Core.Abstractions.Services.NotificationProviders;
using ClassIsland.Core.Attributes;
using ClassIsland.Core.Models.Notification;

namespace CsesCloudAdapter.Services;

/// <summary>
/// CSES Cloud 广播提醒提供方：接收平台 broadcast.show 命令并弹出提醒。
/// </summary>
[NotificationProviderInfo("6E9F1CD9-8A25-4D9B-9E52-1A2B3C4D5E6F", "CSES Cloud 广播", "\uE7E7",
    description: "接收并显示来自 CSES Cloud 平台的广播消息。")]
[NotificationChannelInfo("2F4B6D8A-0C1E-4F2A-9B3C-5D6E7F8091A2", "CSES 广播", "\uE7E7",
    description: "来自 CSES Cloud 平台的广播消息。")]
public class BroadcastNotificationProvider : NotificationProviderBase
{
    public const string BroadcastChannelId = "2F4B6D8A-0C1E-4F2A-9B3C-5D6E7F8091A2";

    private NotificationRequest? _currentRequest;

    /// <summary>
    /// 展示一条平台广播。
    /// </summary>
    public void ShowBroadcast(string title, string body, int durationSeconds = 10)
    {
        var request = new NotificationRequest
        {
            MaskContent = new NotificationContent(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(body) ? title : title + "\n" + body,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Avalonia.Thickness(24),
                MaxWidth = 560,
            })
            {
                Duration = TimeSpan.FromSeconds(Math.Clamp(durationSeconds, 3, 120)),
            },
            ChannelId = Guid.Parse(BroadcastChannelId),
        };
        _currentRequest = request;
        Channel(BroadcastChannelId).ShowNotification(request);
    }

    /// <summary>
    /// 关闭当前广播（broadcast.dismiss）。
    /// </summary>
    public void DismissCurrent()
    {
        _currentRequest?.Cancel();
        _currentRequest = null;
    }
}
