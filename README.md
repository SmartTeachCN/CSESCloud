# CSESCloudNG

CSES Cloud 智教云平台（NodeJS 后端 + Vue 3 前端）。

## 技术栈

- **后端**：Node.js（Express 5）、`node:sqlite`（内置 SQLite，无需原生编译）、ws、bcryptjs、multer
- **前端**：Vue 3 + Vite + TypeScript，Monaco Editor
- **包管理**：pnpm 10（`corepack enable` 可自动获取指定版本）

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
node --disable-warning=ExperimentalWarning _smoke_db_test.js   # 数据库读写/BLOB 往返自检
curl http://127.0.0.1:9000/api/ping                              # 返回 {"code":404,"message":"API 端点不存在"} 即为存活
```
