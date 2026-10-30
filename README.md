# CSESCloudNG · V3

CSES Cloud 智教云平台（NodeJS 后端 + Vue 3 前端）。

V3 聚焦 **配置分发**：轻编辑器同时管理云文件与「配置实例」，按源文件类型自动选择分发方式：

| 源文件 | 分发形式 | 实例应用 | 对外地址 |
|---|---|---|---|
| ClassIsland 档案（Profile JSON） | 静态集控 | `classisland` | 清单 + 六类数据源 |
| CSES 配置（YAML / JSON） | 公开配置地址 | `cses_config` | 原文件内容 URL |
| ExamAware 配置（`.ea2` / JSON） | 公开配置地址 | `examaware` | 原文件内容 URL |

平台不再提供校园集控、实例云控、WebSocket / REST 设备控制等动态集控能力，所有接口均为
Node.js 原生路径（不使用 PHP 后缀）。

## 技术栈

- **后端**：Node.js（Express 5）、`node:sqlite`（内置 SQLite，无需原生编译）、bcryptjs、multer、js-yaml
- **前端**：Vue 3 + Vite + TypeScript，Monaco Editor
- **包管理**：pnpm 10（`corepack enable` 可自动获取指定版本）
- **ClassIsland 静态集控**：2.0 集控清单 + 六类数据源（ClassPlans / TimeLayouts / Subjects /
  Settings / Policy / Credentials）

## 环境要求

- Node.js **≥ 22.5**（推荐 22 LTS 或 24.x，数据库使用内置的 `node:sqlite` 模块）
- 无需 Python / Node-GYP / gcc 等原生编译工具链（所有依赖均为纯 JS）

## 本地开发

```bash
pnpm install                 # 根目录（后端）
pnpm --dir frontend install  # 前端
pnpm dev                     # 同时启动 API(8000) 与 Vite 开发服务器
```

首次启动会在 `data/cses.db` 自动建库并写入演示数据（见 `schema.sql` 与 `server/lib/seed.js`）。

## 核心功能

### 轻编辑器（/console/editor/light）

- 云文件的新建、上传、编辑、版本历史、操作记录、分享；
- **文件列表目录化**：文件夹 / 面包屑导航，目录优先排序；空白处右键新建文件/文件夹/上传/刷新，
  文件与文件夹各有右键菜单；
- **行内交互**：新建文件/文件夹使用预置名称的 draft 行，重命名（列表与顶部文件卡片）直接
  转为输入框并只选中主文件名（不含扩展名），Enter 提交、Esc 取消；
- **删除确认**：文件/文件夹删除在列表行内确认；若存在关联配置实例，可勾选「同时删除关联配置实例」；
- **分享文件**：分享页已整合到文件属性窗口的「分享」Tab；权限分为查看文件 / 查看实例 /
  编辑文件 / 编辑实例四档；被分享者接受后，其云空间出现同名占位文件（「来自分享」标签），
  内容实时重定向到分享者源文件；被分享者可移除分享链接（不影响分享者文件）；
  分享页可管理接收者、停止分享、预览链接与文件黑名单（拉黑后无法再通过链接/邀请获得权限）；
- **文件属性窗口**：属性页展示名称/类型/大小/来源/编辑者/路径/时间/分享与分发信息；
  「分发配置」「分享」作为属性窗口的子 Tab，右键菜单可直达；
- **配置实例化**：文件右键选择 **「分发配置」** 生成配置实例；
- 侧栏 **文件 / 实例** 视图切换，实例视图可查看、编辑、删除、复制/打开分发地址、打开源文件；
- 左下角显示真实云存储用量（已用 / 配额与百分比）；
- 源文件内容实时生效：修改并保存源文件后，客户端重新拉取地址即可获得最新内容。

### 编辑器插件

- `.yml` / `.json` / `.ea2` 等格式由已发布编辑器插件负责可视化编辑；
- 插件无法识别当前文件格式时，会请求平台回退到 **默认编辑器（Monaco）**，不再在插件内部
  提供通用/源码编辑器；源码查看统一由默认编辑器承担；
- 插件内部不提供源码查看器，Ribbon 中只有结构化编辑相关工具；
- 插件内部布局针对窄窗口/矮窗口做了收缩与滚动适配，模态框使用统一的半透明模糊背景。

### 全局交互

- 全站 `alert` 已替换为应用级自定义提示框（毛玻璃模态、支持多行与队列、Enter/Esc/遮罩关闭）；
- 登录页已登录时会自动跳转到 `redirect` 或控制台首页，登录后的重定向参数做站内安全校验。

### 数据空间

- 统一管理云文件、网页空间、版本历史与操作记录；
- V3 起不再展示「实例文件」目录（实例文件模块仅作为实例云应用内部能力保留）。

### ClassIsland 静态集控（实例应用 `classisland`）

在轻编辑器中对 **ClassIsland 档案（Profile JSON）** 右键「分发配置」，得到：

| 用途 | 地址 |
|---|---|
| 集控清单 | `/classisland/manifest?id=<实例组标识>` |
| 数据源 | `/classisland/file?id=<实例组标识>/<实例标识>&key=<数据源>` |

接入步骤：

1. 在轻编辑器中对 ClassIsland 档案右键「分发配置」；
2. 下载生成的清单文件（或在「实例」视图里下载）；
3. 打开 ClassIsland 设置 → 右上角菜单「加入管理」→ 选择清单文件；
4. 在「ID」处填写配置实例的实例标识（如 `高一1班`）；
5. 之后在云端修改档案并保存，ClassIsland「集控」设置页点击「立即同步」即可更新。

### CSES / ExamAware 配置分发（公开配置地址）

对 CSES 配置（`.yml` / `.json`）或 ExamAware 配置（`.ea2`）右键「分发配置」，得到稳定地址：

```
/config/<实例组标识>/<实例标识>.<扩展名>
```

地址直接返回源文件内容（CSES 返回 YAML/JSON 原文，ExamAware 返回 JSON），可在支持对应格式的
程序 / 客户端 / 集控系统中填写使用；源文件保存后内容实时更新。

### 实例云应用模块

配置实例复用平台既有的实例云应用模块（`instances` / `apps` / `instance_groups` /
实例文件与存储）。内置 NodeJS 云应用：

```
server/apps/index.js                     # 云应用注册表
server/apps/classisland/index.js         # ClassIsland 档案 → 静态集控（清单 + 六类数据源）
server/apps/cses-config/index.js         # CSES 配置 → 公开配置地址
server/apps/examaware/index.js           # ExamAware 配置 → 公开配置地址
server/apps/lib/raw-config.js            # 公开配置地址通用逻辑
server/lib/distribution-formats.js       # 分发格式识别与校验（多格式）
server/lib/classisland-convert.js        # ClassIsland 清单/结构辅助工具
server/lib/static-control-public.js      # 公开配置 / 静态集控 HTTP 接口
server/api/distributions.js              # 轻编辑器「分发配置」管理 API
```

## 生产部署（Linux 服务器）

```bash
# 1. 安装依赖（仅纯 JS，不需要编译环境）
pnpm install && pnpm --dir frontend install

# 2. 构建前端（输出到项目根的 dist/）
pnpm build

# 3. 启动服务（单端口：API + 静态文件 SPA 回退）
PORT=9000 HOST=0.0.0.0 pnpm start
```

- 默认端口 `8000`，可通过 `PORT` / `HOST` 环境变量覆盖。
- 数据目录：`data/`（SQLite 库、开发文件系统、会话），注意备份与持久化；WAL 模式下 `cses.db-wal`/`cses.db-shm` 属于正常运行文件。
- 建议用 systemd / pm2 守护进程。示例：

```ini
# /etc/systemd/system/cses-cloud.service
[Unit]
Description=CSES Cloud
After=network.target

[Service]
WorkingDirectory=/opt/cses-cloudng
Environment=PORT=9000
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## 验证部署

```bash
node --disable-warning=ExperimentalWarning _smoke_db_test.js          # 数据库读写/BLOB 往返自检
node --disable-warning=ExperimentalWarning _smoke_static_control.js   # 配置分发/目录/删除实例冒烟（需服务已启动）
node --disable-warning=ExperimentalWarning _smoke_share.js            # 云文件分享占位/读取与编辑重定向冒烟（需服务已启动）
node --disable-warning=ExperimentalWarning _smoke_share_permissions.js # 四档权限/黑名单/接收者移除链接冒烟（需服务已启动）
curl http://127.0.0.1:9000/api/ping                                   # 返回 {"code":404,"message":"API 端点不存在"} 即为存活

# ClassIsland 静态集控（需要先在轻编辑器分发一个 ClassIsland 配置实例）
curl "http://127.0.0.1:9000/classisland/manifest?id=<实例组标识>"
curl "http://127.0.0.1:9000/classisland/file?id=<实例组标识>/<实例标识>&key=Subjects"

# CSES / ExamAware 公开配置地址
curl "http://127.0.0.1:9000/config/<实例组标识>/<实例标识>.yml"
```

## 与旧版本的关系

- `NextGeneration` 分支：V3 改造前的完整快照（含校园集控 / 实例云控 / 动态集控）。
- `V3` 分支：当前版本，移除动态集控，新增轻编辑器配置实例化与多格式配置分发。
- 接口与数据结构见 `docs/V3-static-control-spec.md`。
