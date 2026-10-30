# CSESCloudNG · V3

CSES Cloud 智教云平台（NodeJS 后端 + Vue 3 前端）。

V3 聚焦 **配置分发 / 静态集控**：轻编辑器同时管理云文件与「配置实例」，把 CSES 配置文件
一键分发为 ClassIsland 静态集控数据源；平台不再提供校园集控、实例云控、WebSocket / REST
设备控制等动态集控能力。

## 技术栈

- **后端**：Node.js（Express 5）、`node:sqlite`（内置 SQLite，无需原生编译）、bcryptjs、multer、js-yaml
- **前端**：Vue 3 + Vite + TypeScript，Monaco Editor
- **包管理**：pnpm 10（`corepack enable` 可自动获取指定版本）
- **静态集控协议**：ClassIsland 2.0 集控清单 + 六类数据源（ClassPlans / TimeLayouts /
  Subjects / Settings / Policy / Credentials）

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
- **配置实例化**：普通文件保持原列表展示，文件右键选择 **「分发配置」** 生成配置实例；
- 侧栏 **文件 / 实例** 视图切换，实例视图可查看、编辑、删除、复制清单、下载清单、打开源文件；
- 源文件内容实时生效：修改并保存源文件后，ClassIsland 客户端「立即同步」即可拉取新数据。

### 静态集控（ClassIsland）

分发后得到两类地址：

| 用途 | 地址 |
|---|---|
| 集控清单 | `/classisland/manifest.php?id=<实例组标识>` |
| 数据源 | `/classisland/file.php?id=<实例组标识>/<实例标识>&key=<数据源>` |

兼容旧地址 `/control/file.php?format=ci&id=...&key=...`。

ClassIsland 接入步骤：

1. 在轻编辑器中对 CSES 配置文件（`.yml` / `.json`）右键「分发配置」；
2. 下载生成的清单文件（或在「实例」视图里下载）；
3. 打开 ClassIsland 设置 → 右上角菜单「加入管理」→ 选择清单文件；
4. 在「ID」处填写配置实例的实例标识（如 `高一1班`）；
5. 之后在云端修改配置并保存，ClassIsland「集控」设置页点击「立即同步」即可更新。

### 实例云应用模块

配置实例复用平台既有的实例云应用模块（`instances` / `apps` / `instance_groups` /
实例文件与存储）。内置云应用 `cses_static_control` 的服务端模块位于：

```
server/apps/index.js                    # NodeJS 云应用注册表
server/apps/cses-static-control/index.js# 静态集控云应用模块（报表/数据源/校验）
server/lib/classisland-convert.js       # CSES 文档 → ClassIsland 2.0 结构转换
server/lib/static-control-public.js     # 公开静态集控 HTTP 接口
server/api/distributions.js             # 轻编辑器“分发配置”管理 API
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
node --disable-warning=ExperimentalWarning _smoke_static_control.js   # 静态集控/配置分发全流程冒烟（需服务已启动）
curl http://127.0.0.1:9000/api/ping                                   # 返回 {"code":404,"message":"API 端点不存在"} 即为存活

# 静态集控接口（需要先在轻编辑器分发一个配置实例）
curl "http://127.0.0.1:9000/classisland/manifest.php?id=<实例组标识>"
curl "http://127.0.0.1:9000/classisland/file.php?id=<实例组标识>/<实例标识>&key=Subjects"
```

## 与旧版本的关系

- `NextGeneration` 分支：V3 改造前的完整快照（含校园集控 / 实例云控 / 动态集控）。
- `V3` 分支：当前版本，移除动态集控，新增轻编辑器配置实例化与静态集控。
- 接口与数据结构见 `docs/V3-static-control-spec.md`。
