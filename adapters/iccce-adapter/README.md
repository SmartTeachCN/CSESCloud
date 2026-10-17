# CSES Cloud 适配器（ICC CE / InkCanvasForClass Community Edition）

将 ICC CE 接入 [CSES Cloud](https://github.com/CSESCloud/CSESCloudNG) 集控平台：通过注册码接入平台实例，接收远程命令并自动应用到本机。

## 功能

| 命令 | 行为 |
|------|------|
| `settings.apply` | `icc.*` 键合并进 `Configs/Settings.json`，经配置方案 `CSES-Cloud` + `icc://config-profile/switch` **热重载立即生效**；`adapter.*` 键写入适配器自身设置 |
| `icc.command` | 执行 `icc://` 远程命令（收纳/工具切换/白板/点名/计时器/配置方案切换/重启等，完整清单见客户端 `MainWindow.HandleUriCommand`） |
| `broadcast.show` / `broadcast.dismiss` | 弹出 ICC CE 应用内通知（标题/正文/级别） |
| `client.restart` | 经 `IAppRestartService` 重启 ICC CE（可带 `as_admin`） |

安全约定：

- `security.*`（密码 / TOTP / USB 白名单）键一律拒绝远程修改；
- 合并只更新**已存在**的键且校验值类型，不新增键、不覆盖对象/数组；
- 修改设置依赖 ICC CE「启用 URI 协议」（`advanced.isEnableUriScheme`）通道，适配器默认自动打开（可在设置中关闭）。

## 构建

```powershell
dotnet build -c Release
```

构建产物为 `icpx/CsesCloudIcceAdapter.icpx`（由 `InkCanvas.PluginSdk` 的 `CreateIcpx` 目标自动打包）。

## 安装

1. 将 `.icpx` 复制到 ICC CE 安装目录的 `PluginPackages/` 文件夹（启动时自动安装），或在 ICC CE 设置 → 插件 中手动安装；
2. 启用插件后进入其设置页：
   - 填写服务器地址，或「导入凭据文件」（平台实例「连接应用」页下载的 `cses-cloud-credentials.json`）；
   - 填写注册码（`ICCCE-` 前缀），点击「连接」。

## 平台侧

配套的服务端实例应用位于 CSESCloudNG 仓库 `data/dev/apps/iccce/`（连接应用 / 远程控制 / 应用配置 三个页面），设置分层（全局 + 设备覆盖）保存后经 `settings.apply` 下发。
