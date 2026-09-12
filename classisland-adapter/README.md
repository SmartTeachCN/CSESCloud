# CSES Cloud 适配器（ClassIsland 客户端）

将 [ClassIsland](https://github.com/ClassIsland/ClassIsland)（2.x，Avalonia 版）接入 **CSES Cloud** 平台：平台侧在「ClassIsland 课表管理」实例应用中维护课表档案，本插件在客户端完成注册、档案同步与命令接收。

## 功能

- **设备注册**：使用平台实例生成的注册码（`EA2-…`）注册设备，凭证持久化后无需重复注册。
- **档案同步**：接收 `profile.prepare` 命令，下载平台下发的 ClassIsland 档案（.json，sha256 校验），两种应用方式：
  - **热替换**（默认）：替换当前档案的 科目 / 时间表 / 课表 / 课表群，立即生效并自动落盘，课程计算在下一个计时周期自动跟随新档案；
  - **写入档案文件**：写入 `Profiles/<目标档案名>.json` 并尽力把 `Settings.SelectedProfile` 指向它（重启或手动切换档案后生效）。
- **广播提醒**：接收 `broadcast.show` / `broadcast.dismiss`，以提醒提供方（NotificationProvider）形式弹出/关闭。
- **设置下发**：接收 `settings.apply`，可远程修改 应用方式 / 目标档案名 / 轮询间隔。
- **心跳与错误上报**：每轮轮询上报设备状态（当前档案名/版本），命令处理失败自动上报 `device_errors`。

## 构建

要求 .NET 8 SDK。

```bash
cd classisland-adapter
dotnet build -c Release
```

构建产物 `bin/Release/net8.0/` 会自动打包为 `CsesCloudAdapter.cipx`（依赖 `ClassIsland.PluginSdk` 的 `CreateCipx` target）。

## 安装与配置

1. 将 `CsesCloudAdapter.cipx` 复制到 ClassIsland 的 `Cache/PluginPackages/`（或通过插件市场安装），重启 ClassIsland 完成解压安装。
2. 在 CSES Cloud 平台创建「ClassIsland 课表管理」实例（实例应用市场选择该应用），进入实例 → **连接应用** → **生成注册码**，生成后可直接点击 **下载凭据** 得到 `cses-cloud-credentials.json`。
3. ClassIsland 设置 → **CSES Cloud 适配器**：
   - 点击 **导入凭据** 选择下载的凭据文件（自动填充服务器地址与注册码并连接）；或手动填写 **服务器地址** 与 **注册码** 后点击 **连接（注册设备）**；
   - 选择 **连接传输**（长轮询 / WebSocket，断线自动回退）、**档案应用方式**（热替换 / 写入档案文件）。
4. 设备出现在平台「连接应用」页面后，即可在 **档案管理** 中编辑 / 部署档案；在 **应用配置** 中下发的同步 / 通知设置会通过 `settings.apply` 自动同步到客户端（支持全局与按设备覆盖）。

## 命令协议（EA2 控制协议 v1，长轮询 / WebSocket）

| 命令 | 说明 | payload 关键字段 |
| --- | --- | --- |
| `profile.prepare` | 部署档案 | `profile_name`、`profile_display_name`、`profile_version_id`、`artifact{url, media_type, size_bytes, sha256, expires_at}` |
| `profile.activate` | 重新应用最近缓存的档案 | — |
| `settings.apply` | 下发设置 | `settings[{key, value}]` |
| `broadcast.show` | 显示广播 | `broadcast_id`、`title`、`body`、`severity`、`expires_at` |
| `broadcast.dismiss` | 关闭当前广播 | — |

`settings.apply` 支持的键（与平台「应用配置」页一致）：

| 键 | 取值 | 说明 |
| --- | --- | --- |
| `sync.autoSync` | `true/false` | 自动同步开关 |
| `sync.pollInterval` | 秒（≥5） | 同步间隔下限 |
| `sync.applyMode` | `hotswap/file` | 档案应用方式 |
| `sync.targetProfile` | 文件名 | 目标档案文件名 |
| `sync.transport` | `poll/ws` | 连接传输（切换为 ws 后自动建连，失败回退 poll） |
| `notification.enabled` | `true/false` | 平台广播提醒开关 |
| `notification.durationSeconds` | 3-120 | 广播提醒停留时长 |

REST 端点（`{server}/api/rest-control?instance_uid={uid}&action={action}`）：

| action | 认证 | 说明 |
| --- | --- | --- |
| `device_register` | 注册码（`CSES-` 前缀） | 注册设备，返回 credential / poll_interval_seconds |
| `command_poll` | `x-device-id` + `x-device-credential` 请求头 | 轮询命令；429 时按 `data.retry_after` 退避 |
| `command_report` | 同上 | 上报命令结果（succeeded / failed + state） |
| `device_update_state` | 同上 | 心跳（携带当前档案状态） |
| `device_errors` | 同上 | 上报错误 |
| `profile_deploy` | 平台登录态 | 平台侧：把 profiles 目录下的 .json 档案下发为 `profile.prepare` 命令 |
| `profile_list` | 平台登录态 | 平台侧：列出识别为 ClassIsland 档案的文件 |

WebSocket 网关（`ws(s)://{host}/api/ws-control`）：连接后发送 `{type:'auth', instance_uid, device_id, credential}`，服务端回 `hello` 并实时推送 `command`；客户端通过 `command_report` / `device_update` 上报，支持服务端 `protocol.switch` 下发切换传输。

## 文件位置

- 设置：`Config/Plugins/cloud.cses.classisland/settings.json`
- 凭证：`Config/Plugins/cloud.cses.classisland/credentials.json`
- 设备 ID：`Config/Plugins/cloud.cses.classisland/device-id.txt`
- 最近档案缓存：`Config/Plugins/cloud.cses.classisland/last-profile.json`（供 `profile.activate` 重放）

## 档案格式兼容性

- 平台档案采用 ClassIsland 档案 JSON（关键结构：`TimeLayouts` / `ClassPlans` / `Subjects`）。
- 时间字段同时写有 2.x 的 `StartTime` / `EndTime`（`HH:mm:ss`）与 1.x 的 `StartSecond` / `EndSecond`（`YYYY-MM-DDTHH:mm:ss`），1.x / 2.x 客户端均可读取。
- 档案中的未知字段（如 `AttachedObjects`、附加设置）在热替换时原样保留。
