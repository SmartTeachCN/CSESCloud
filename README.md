# CSESCloudNG · V3

[![CI](https://github.com/SmartTeachCN/CSESCloud/actions/workflows/ci.yml/badge.svg?branch=CSES-Cloud-V3)](https://github.com/SmartTeachCN/CSESCloud/actions/workflows/ci.yml)
[![Release](https://github.com/SmartTeachCN/CSESCloud/actions/workflows/release.yml/badge.svg)](https://github.com/SmartTeachCN/CSESCloud/actions/workflows/release.yml)

CSES Cloud 智教云平台（NodeJS 后端 + Vue 3 前端）。

V3 聚焦 **配置分发**：轻编辑器同时管理云文件与「配置实例」，按源文件类型自动选择分发方式：

| 源文件 | 分发形式 | 实例应用 | 对外地址 |
|---|---|---|---|
| ClassIsland 档案（Profile JSON） | 静态集控 | `classisland` | 清单 + 六类数据源 |
| CSES 配置（YAML / JSON） | 公开配置地址 | `cses_config` | 原文件内容 URL |
| ExamAware 配置（`.ea2` / JSON） | 公开配置地址 | `examaware` | 原文件内容 URL |
| CKV 键值对配置（`.ckv`） | 公开配置地址 | `ckv_config` | 原文件内容 URL |

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

- `.yml` / `.json` / `.ea2` / `.ckv` 等格式由已发布编辑器插件负责可视化编辑；
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

### CSES / ExamAware / CKV 配置分发（公开配置地址）

对 CSES 配置（`.yml` / `.json`）、ExamAware 配置（`.ea2`）或 CKV 键值对配置（`.ckv`）右键「分发配置」，
得到稳定地址：

```
/config/<实例组标识>/<实例标识>.<扩展名>
```

地址直接返回源文件内容（CSES 返回 YAML/JSON 原文，ExamAware 返回 JSON，CKV 返回 `text/plain`
键值对原文），可在支持对应格式的程序 / 客户端 / 集控系统中填写使用；源文件保存后内容实时更新。

### 实例云应用模块

配置实例复用平台既有的实例云应用模块（`instances` / `apps` / `instance_groups` /
实例文件与存储）。内置 NodeJS 云应用：

```
server/apps/index.js                     # 云应用注册表
server/apps/classisland/index.js         # ClassIsland 档案 → 静态集控（清单 + 六类数据源）
server/apps/cses-config/index.js         # CSES 配置 → 公开配置地址
server/apps/examaware/index.js           # ExamAware 配置 → 公开配置地址
server/apps/ckv-config/index.js          # CKV 键值对配置 → 公开配置地址
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

## CI/CD 与生产端同步

- **CI**（`.github/workflows/ci.yml`）在 push 到 `V3` / `CSES-Cloud-V3` 分支或 PR 时自动执行：
  Node 22 + pnpm 10 → 服务端语法校验 → 安装依赖 → 构建前端 → 上传 `dist/` artifact。
- **Release**（`.github/workflows/release.yml`）在 push `v*` 标签时产出可部署发布包并创建 GitHub Release：
  - `cses-cloud-v3-<tag 去 v>.tar.gz` / `cses-cloud-v3-<tag 去 v>.zip`：git 跟踪的源码 + 本次构建的 `dist/` + `build-info.json`（例如标签 `v3.0.0` → `cses-cloud-v3-3.0.0.tar.gz`）
  - `SHA256SUMS.txt`：上述产物的校验和（`sha256sum` 格式）

生产服务器上可检查并一键拉取更新（纯 Node 脚本、零新增依赖，无需在服务器构建前端）：

```bash
pnpm sync:check        # 检查上游 Release / 分支最新提交与本地版本的差异（只读）
pnpm sync:dry-run      # 演练：下载 + SHA256 校验 + 解包 + 预演差异，不改动部署、不重启
pnpm sync:apply        # 更新：备份 → 替换代码 → 按需装依赖 → 重启 → 健康检查，失败自动回滚
pnpm sync:rollback     # 回滚到最近一次备份
```

等价命令为 `node scripts/sync-production.mjs --check|--apply|--rollback`（支持 `--dry-run`、`--json`、`--tag`、`--yes` 等，见 `--help`）。

管理接口（需 `UPDATE_SYNC_ENABLED=1`，凭据走 `X-Update-Token` 请求头或最高管理员会话）：

| 方法 | 地址 | 作用 |
|---|---|---|
| GET | `/api/system/update?action=version` | 当前版本 / 提交 / 构建时间 / 运行时长 |
| GET | `/api/system/update?action=check` | 对比上游 Release 与分支最新提交，判断是否需要更新 |
| GET | `/api/system/update?action=status` | 最近一次同步任务状态 + 日志尾部 + 备份列表 |
| POST | `/api/system/update?action=apply` | 触发后台更新任务（立即返回 `job_id`） |
| POST | `/api/system/update?action=rollback` | 触发后台回滚任务 |
| GET | `/api/system/health` | 公开健康检查（更新后探活 / 监控探活） |

更新只替换「代码」：`data/`、`node_modules/`、`.git/`、`.env*`、`exports/`、`logs/` 等运行期内容不会被覆盖；
每次更新前自动备份到 `data/update/backups/`，失败自动回滚。完整的环境变量表、systemd / pm2 配置、
故障排查与安全说明见 [docs/生产端同步.md](docs/生产端同步.md)。

## 验证部署

```bash
# 0. 本地自检（不需要额外脚本，仓库里也不再提交开发用的临时冒烟脚本）
node .github/scripts/check-server.mjs          # 逐个 node --check 服务端 JS
pnpm build                                     # 前端构建，产物在 dist/
pnpm start                                     # 生产模式：API + dist 静态资源（默认 :8000）

# 1. 服务存活与构建信息
curl http://127.0.0.1:8000/api/system/health   # 返回 code:0 + version + uptime（公开，供监控/更新探活）
curl http://127.0.0.1:8000/api/system/update?action=version   # 版本/提交/构建时间（需 UPDATE_SYNC_ENABLED=1）
curl http://127.0.0.1:8000/api/ping            # 返回 {"code":404,"message":"API 端点不存在"} 也说明服务存活

# 2. 数据库与分享冒烟（自己本地写脚本放在仓库外，或用 .gitignore 覆盖的 _smoke_*.js 名字，本仓库不提交这类脚本）
node --disable-warning=ExperimentalWarning <你的冒烟脚本>.js

# ClassIsland 静态集控（需要先在轻编辑器分发一个 ClassIsland 配置实例）
curl "http://127.0.0.1:8000/classisland/manifest?id=<实例组标识>"
curl "http://127.0.0.1:8000/classisland/file?id=<实例组标识>/<实例标识>&key=Subjects"

# CSES / ExamAware / CKV 公开配置地址
curl "http://127.0.0.1:8000/config/<实例组标识>/<实例标识>.yml"
curl "http://127.0.0.1:8000/config/<实例组标识>/<实例标识>.ckv"
```

## 与旧版本的关系

- `NextGeneration` 分支：V3 改造前的完整快照（含校园集控 / 实例云控 / 动态集控）。
- `V3` 分支：当前版本，移除动态集控，新增轻编辑器配置实例化与多格式配置分发。
- 接口与数据结构见 `docs/V3-static-control-spec.md`。
