# V3 配置分发架构说明（轻编辑器配置实例化）

> 本文件是 V3 分支的接口契约与实施说明。所有对外地址均为 Node.js 原生路径，**不使用 PHP 后缀**。

## 1. 目标

1. 移除“校园集控 / 实例云控”管理界面，以及 WebSocket、REST 设备控制、EA2 设备、
   PHP 实例沙箱等**动态集控**能力。
2. 轻编辑器（`/console/editor/light`）同时管理 **云文件** 与 **配置实例**：
   - 普通云文件保持现有列表展示；
   - 文件右键 **「分发配置」**，按源文件内容自动识别分发格式；
   - 实例视图支持查看、编辑、删除、复制/打开地址、打开源文件。
3. 分发格式（参考 `E:\CsesWebEditor` 的 ClassIsland 静态集控实现）：

| 格式 | 识别依据 | 实例应用 | 分发形式 |
|---|---|---|---|
| `classisland` | Profile JSON：`ClassPlans` / `TimeLayouts` / `Subjects` | `classisland` | 静态集控清单 + 六类数据源 |
| `cses` | `version` / `subjects` / `schedules` / `extraKey` | `cses_config` | 公开配置地址（原文件内容） |
| `examaware` | `examName` / `examInfos` 或 `.ea2` | `examaware` | 公开配置地址（原文件内容） |

4. 复用实例云应用模块（`instances` / `apps` / `instance_groups` / 实例文件与存储），
   云应用服务端模块由 NodeJS 编写（`server/apps/`）。

## 2. 数据模型

- `instances`：
  - `app_key`：`classisland` / `cses_config` / `examaware`
  - `name`：ClassIsland 侧填写的实例标识 / 公开地址中的实例标识
  - `source_file_id`：轻编辑器源文件 `web_hosting_files.id`
  - `config` JSON：`{ format, app_key, organization_name, file_name, ext }`
  - `updated_at`
- `instance_groups`：`dir_id`（对外公开的实例组标识，12 位小写字母/数字）、`updated_at`。
- 一个所有者只有一个默认实例组；同一实例组下实例标识唯一（跨格式共享）。
- 源文件内容实时读取；ClassIsland 清单版本号取组内 ClassIsland 实例源文件 `updated_at`
  最大值的 Unix 秒。

## 3. 公开接口（无需登录）

| 接口 | 说明 |
|---|---|
| `GET /classisland/manifest?id=<实例组标识>` | ClassIsland 2.0 静态集控清单 |
| `GET /classisland/file?id=<实例组标识>/<实例标识>&key=<数据源>` | 六类数据源（ClassPlans / TimeLayouts / Subjects / Settings / Policy / Credentials） |
| `GET /config/<实例组标识>/<实例标识>.<扩展名>` | CSES / ExamAware 原始配置（`application/json` / `text/yaml`） |

约定：

- 成功：原始 JSON / YAML 内容，无 `{code}` 包装；`Cache-Control: no-store`，允许跨域。
- 失败：HTTP 400/404 + `{ "error": "中文错误信息" }`。
- 基础地址优先取 `X-Forwarded-Proto` / `X-Forwarded-Host`，否则使用请求协议与 Host。
- ClassIsland 三个档案数据源按协议返回 Profile 结构（只填充请求区块，其余为空对象）；
  Policy / Credentials / Settings 若档案中存在则直出，否则返回空对象。

## 4. 管理接口（联盟账户）

`/api/distributions`：

| 方法 | action | 入参 | 返回 |
|---|---|---|---|
| GET | `overview` | – | `{ group, base_url, formats, instances }` |
| GET | `list` | – | `InstanceDTO[]` |
| GET | `get` | `id` | `InstanceDTO` |
| POST | `create` | `{ file_id, instance_id?, organization_name?, group_name? }` | `InstanceDTO` |
| POST | `update` | `{ id, instance_id?, organization_name?, file_id? }` | `InstanceDTO` |
| POST | `delete` | `{ id }` | `null` |
| POST | `validate` | `{ file_id }` | 格式识别 / 统计 / 地址预览 |
| GET | `manifest` | `id` | ClassIsland 管理清单（仅 `classisland` 格式） |

`InstanceDTO` 关键字段：

```json
{
  "id": 1,
  "name": "高一1班",
  "app_key": "classisland",
  "format": "classisland",
  "format_label": "ClassIsland 配置",
  "format_mode": "static",
  "group_dir_id": "ab12cd34ef56",
  "source_file_id": 12,
  "source_file_name": "高一1班.json",
  "valid": true,
  "version": 1761316800,
  "urls": {
    "kind": "static",
    "manifest": "http://host/classisland/manifest?id=ab12cd34ef56",
    "file_template": "http://host/classisland/file?id=ab12cd34ef56/{id}&key={key}"
  }
}
```

`format_mode = "url"` 时：`urls = { kind: "url", source: "http://host/config/<组>/<实例>.<扩展名>" }`。

`validate` 返回：

```json
{
  "ok": true,
  "format": "cses",
  "format_label": "CSES 配置",
  "mode": "url",
  "default_instance_id": "高一1班",
  "document": { "subjects": 2, "schedules": 1, "classplans": 0, "timelayouts": 0, "exams": 0 },
  "warnings": [],
  "group": { "id": 3, "dir_id": "ab12cd34ef56", "name": "配置分发" },
  "existing_instance": null,
  "urls": { "kind": "url", "source": "http://host/config/ab12cd34ef56/高一1班.yml" }
}
```

## 5. 服务端模块

```
server/lib/distribution-formats.js     # 格式识别 / 解析 / 校验 / 地址生成
server/apps/index.js                   # NodeJS 云应用注册表
server/apps/classisland/index.js       # ClassIsland 档案 → 静态集控
server/apps/cses-config/index.js       # CSES 配置 → 公开配置地址
server/apps/examaware/index.js         # ExamAware 配置 → 公开配置地址
server/apps/lib/raw-config.js          # 公开配置地址通用解析
server/lib/classisland-convert.js      # 清单生成与 ClassIsland 结构辅助
server/lib/static-control-public.js    # 公开接口 handler（manifest/file/config）
server/api/distributions.js            # 分发管理 API
server/lib/cloud-share.js              # 云文件分享占位符（标记/重定向/清理）
```

### 5.1 云文件分享

- 分享页作为文件属性窗口的「分享」Tab 展示；权限四档：
  `view_file`（查看文件）/ `view_instance`（查看实例）/ `edit_file`（编辑文件）/
  `edit_instance`（编辑实例），旧 `view` / `edit` 自动归一化为前两者；
- 接受分享后，在接收者云空间 `/.cloud/` 创建同名占位文件，内容为
  `CSES_CLOUD_SHARE:<json>` 内部标记（share_id / owner_file_id / owner_username）；
- `GET /api/cloud-files?action=list` 将占位文件展示为 `source: 'shared'`、`is_share_placeholder: 1`，
  并附带 `share_id` / `owner_file_id` / `shared_from` / `shared_permission`；
- `get` 读取重定向到分享者源文件；`update`（保存/导入）在 `edit_file` / `edit_instance`
  权限下写回分享者源文件，占位符内容保持不变；`rename` 对占位文件返回错误；
- 被分享者可 `delete` 自己的占位文件（符号链接）：仅移除链接并撤销自己的接收权限，
  不删除分享者文件；删除分享 / 移除用户 / 加入黑名单时清理对应占位文件；
- 文件黑名单按 `resource_type + resource_id` 维护（`share_blacklist` 表）；黑名单用户
  无法通过预览链接查看/接受，也不会再收到新的分享邀请；
- 分享详情页支持查看接收者、停止分享、预览链接开关与黑名单增删。

### 5.2 删除云文件与关联实例

`POST /api/cloud-files?action=delete` 支持 `{ id, delete_instances?: boolean }`：

- 目录删除递归处理其下全部文件；
- `delete_instances: true` 时同时删除这些文件关联的配置实例，返回 `{ deleted_instances }`。

## 6. 前端交互

- 普通云文件列表保持现状；已分发文件显示徽标；右键「分发配置」。
- 分发对话框：
  - 展示识别出的格式 / 统计 / 警告；
  - `static`：展示清单地址、数据源模板、ClassIsland 接入步骤、下载清单；
  - `url`：展示配置地址、复制、打开链接，并提示适用客户端（CSES / ExamAware 2）。
- 实例视图与编辑对话框按 `urls.kind` 展示/复制/打开对应地址，显示格式徽标。
- 所有模态框使用毛玻璃背景（overlay 模糊 + flyout 背景），不允许透明。

### 6.1 轻编辑器文件列表 / 文件卡片

- 云文件 API 的 `list` 返回目录与文件（字段含 `is_directory`、`parent_dir`、`owner`），
  轻编辑器按 `currentDir` 过滤并显示面包屑；目录优先排序，共享文件只在根目录展示。
- 新建文件/文件夹使用预置名称的 draft 行；重命名（列表与 Ribbon 文件卡片）使用行内输入；
  提交走 `cloud-files?action=create` / `create-dir` / `rename`（目录改名同步子孙路径，删除目录递归）。
- 左下角存储用量读取 `cloud-files?action=usage`（`used` / `quota` / `percent`）。
- 文件卡片：显示真实编辑者（`owner`），标题可点击改名，「属性」按钮打开属性窗口，
  文件类型旁显示「已分发」。
- 属性窗口含「属性 / 分发配置」两个 Tab；分发配置内嵌分发对话框，右键「分发配置」直达该 Tab。

### 6.2 编辑器插件

- 插件通过 `window.CSEditor.fallback(reason)` 告知平台无法识别当前文件；
  平台收到 `__csesPluginFallback` 后对当前标签禁用插件并回退到默认 Monaco 编辑器。
- 插件内部不提供源码查看器；源码查看由平台默认编辑器承担。

### 6.3 数据空间

- V3 起数据空间不再提供「实例文件」目录（实例文件模块仅作为实例云应用内部能力保留）。

## 7. 验收

1. `pnpm --dir frontend build` 通过；
2. `node server/index.js` 启动，日志出现 `[public-config]`，无 PHP 后缀路由；
3. `_smoke_static_control.js` 覆盖三种格式分发、源文件更新、改名、云文件目录/重命名/用量、
   删除文件同时删除实例与清理，全部通过；分享占位符流程由 `_smoke_share.js` 验证，
   四档权限/黑名单/接收者删除链接由分享权限专项测试验证；
4. 旧动态端点（`/api/campus-control`、`/api/rest-control`、`/api/control`、
   `/api/instance-php`、`/api/ws-control`）返回 404；
5. 全仓库检索不再存在 PHP 后缀链接（历史快照分支除外）。
