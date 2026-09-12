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
    /// 内容使用 ClassIsland 内置的双图标文本模板（CreateTwoIconsMask），
    /// 保证遮罩与提示文字正确渲染（自定义控件在后台线程构建时无法显示）。
    /// </summary>
    public void ShowBroadcast(string title, string body, int durationSeconds = 10)
    {
        // 正文不拼接标题：优先显示正文内容，仅正文为空时回退显示标题
        var text = string.IsNullOrWhiteSpace(body) ? title : body;
        var duration = TimeSpan.FromSeconds(Math.Clamp(durationSeconds, 3, 120));
        var request = new NotificationRequest
        {
            // 遮罩提示 + 非遮罩正文同时下发（都使用 ClassIsland 内置文本模板）
            MaskContent = NotificationContent.CreateTwoIconsMask(text, factory: c => c.Duration = duration),
            OverlayContent = NotificationContent.CreateSimpleTextContent(text, factory: c => c.Duration = duration),
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
