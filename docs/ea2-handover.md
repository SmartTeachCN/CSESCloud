# CSES Cloud EA2 插件 AI 交接文档

> 最后更新: 2026-08-16
> 涉及范围: 实例应用 (ExamAware 2)、编辑器插件 (ea2_exam_editor)、EA2 客户端适配器 (ea2-cses-cloud-adapter)

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                      CSES Cloud (Web)                       │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ InstanceEditor   │  │ PluginEditorFrame (iframe)        │ │
│  │ .vue             │  │   └─ ea2_exam_editor 插件         │ │
│  │  ├─ 考试编辑器模式│  │      (HTML/CSS/JS 存于 DB)        │ │
│  │  ├─ 文件面板      │  └──────────────────────────────────┘ │
│  │  ├─ 配置管理器    │                                       │
│  │  └─ Ribbon工具栏  │  ┌──────────────────────────────────┐ │
│  └──────────────────┘  │ api/control.php                   │ │
│                         │  └─ 通用 REST 设备控制 API (v1)   │ │
│  ┌──────────────────┐  │     (非 EA2 专属，平台内置能力)    │ │
│  │ DeveloperCenter  │  │                                   │ │
│  │ .vue             │  │ DB:     ea2_devices               │ │
│  │  ├─ 实例侧应用    │  │         ea2_commands              │ │
│  │  ├─ 设备控制 API  │  │         ea2_enrollment_codes      │ │
│  │  ├─ 编辑器插件    │  │         ea2_device_credentials    │ │
│  │  └─ 集控侧套餐    │  │                                   │ │
│  └──────────────────┘  │ InstanceDetail.vue                │ │
│                         │  └─ 设备控制 Tab（注册码/设备管理）│ │
│  ┌──────────────────┐  └──────────────────────────────────┘ │
│  │ cloud_files 表    │                                       │
│  │  └─ .ea2 文件存储 │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
                              │ REST API (轮询)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              EA2 客户端 (Electron)                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ ea2-cses-cloud-adapter 插件                              ││
│  │  ├─ main.cjs  → defineMainPlugin (主进程, 轮询/心跳)     ││
│  │  │     └─ 使用通用 /api/control.php 端点                 ││
│  │  ├─ dist/renderer/index.mjs → defineRendererPlugin       ││
│  │  │     └─ 设置页面: 服务器地址 + 实例 UID + 注册码       ││
│  │  └─ schema.json → 设置项定义                             ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**核心通信模式**: CSES Cloud 平台内置 **通用 REST 设备控制 API**（`/api/control.php`），非 EA2 专属：
- 任何实例侧应用均可通过开发者中心 UI 配置和使用此 API
- 设备注册使用注册码验证（`device_register` action）
- EA2 客户端插件每 5 秒轮询 `command_poll` 获取待执行命令
- 每 30 秒发送 `device_update_state` 心跳
- 认证方式: `x-device-id` + `x-device-credential` 请求头
- 命令格式: `{ commandId, command: { type, payload } }`

---

## 二、数据库表结构

### 2.1 EA2 设备控制相关表 (schema.sql)

```sql
-- 注册的设备
ea2_devices (
    id, instance_id, device_id, display_name,
    platform, architecture, app_version, protocol_version,
    lifecycle_status,  -- 'active' | 'revoked'
    labels, last_reported_state, enrolled_at, last_seen_at, ...
)

-- 设备凭证 (SHA-256 哈希存储)
ea2_device_credentials (
    id, device_id, credential_hash, version,
    issued_at, last_used_at, revoked_at
)

-- 设备注册码
ea2_enrollment_codes (
    id, instance_id, code_hash, display_name,
    max_uses, used_count, expires_at, revoked_at
)

-- 命令队列
ea2_commands (
    id, command_id, instance_id, device_id,
    command_type, payload, status,
    -- status: 'pending' → 'sent' → 'succeeded'/'failed'
    result_status, result_error, result_occurred_at, result_state,
    issued_at, expires_at, ...
)
```

### 2.2 编辑器插件表 (editor_plugins)

```sql
editor_plugins (
    id, developer_username, plugin_key,  -- plugin_key: 'ea2_exam_editor'
    name, version, description,
    extensions,  -- JSON: ["ea2"]
    editor_html, -- 编辑器 HTML 结构
    editor_js,   -- 编辑器 JS 逻辑
    editor_css,  -- 编辑器样式
    icon, status, is_official, ...
)
```

### 2.3 实例侧应用表 (apps) - 设备控制清单

```sql
apps (
    ...
    control_manifest TEXT,  -- JSON：设备控制清单
    -- 结构: { enabled, protocolVersion, supportedCommands, description }
    -- 通过 DevAppEditor → 设备控制 Tab 配置
)
```

### 2.4 文件存储 (cloud_files)

`.ea2` 考试档案文件存储在 `cloud_files` 表中：
- `directory` = `/instances/{instance_uid}/`
- `file_type` = `'ea2'`
- `file_category` = `'instance_config'`

---

## 三、实例编辑器 (InstanceEditor.vue)

**路径**: `frontend/src/views/instances/InstanceEditor.vue`

### 3.1 考试编辑器模式

当用户点击考试列表中的某场考试时，进入 `examEditorMode` 模式：

```typescript
// 状态变量
const examEditorMode = ref(false);     // 是否处于考试编辑器模式
const examEditorFile = ref<any>(null); // 当前编辑的 .ea2 文件信息
const examEditorPlugin = ref<any>(null); // 解析到的 ea2_exam_editor 插件
const examPluginFrame = ref<any>(null);  // PluginEditorFrame 组件引用
```

**打开流程** (`openExamInEditor`):
1. 接收 `examData` 和 `examName`
2. 生成随机文件名 `exam-{rand}.ea2`
3. 检查文件是否已存在，不存在则创建
4. 调用 `instanceFilesApi.resolveEditor('ea2')` 获取插件
5. 设置 `examEditorMode = true`，渲染 PluginEditorFrame

**保存流程**:
- 顶栏保存按钮 → `triggerExamPluginSave()` → 向 iframe 发送 `{ __ceseCommand: 'save' }` → PluginEditorFrame 内的监听器调用 `saveConfig()` → 插件通过 `window.CSEditor.emitSave(content)` → PluginEditorFrame 收到 `__csesPluginSave` → emit `save` → `onExamPluginSave` 调用 `instanceFilesApi.save()`

### 3.2 EA2 文件操作 (CSES 内核 API)

| 函数 | 用途 |
|------|---------|
| `listEa2Files()` | 扫描 cloud_files 中所有 `.ea2` 文件，解析 JSON 后返回 |
| `saveEa2File(payload)` | 保存/更新 `.ea2` 文件，自动追加 `.ea2` 后缀 |
| `deleteEa2File(payload)` | 删除 `.ea2` 文件 |
| `callControlApi(action, payload)` | 调用 `ea2-control.php` API |

### 3.3 Ribbon 工具栏

Ribbon 配置来自 `app_info_manifest.ribbon`，通过 `onRibbonTool` 处理点击：
- `select` 型按钮：切换页面 (激活态保持)
- 其他按钮：执行命令，通过 `postMessage` 发送到 iframe
- 特殊命令：`find`/`history`/`version` 打开右侧面板，`fullscreen` 全屏，`refresh` 刷新

### 3.4 右侧面板

默认显示 AI 助理 + 文件面板，可通过 + 按钮添加：
- 编辑历史 (`EditHistoryPanel`)
- 查找替换 (`FindReplacePanel`)
- 实例属性 (`InstancePropertiesPanel`)

各面板支持拖拽排序和关闭 (非核心面板)。

---

## 四、PluginEditorFrame 组件

**路径**: `frontend/src/components/editor/PluginEditorFrame.vue`

通过 iframe + srcdoc 加载编辑器插件，注入 `window.CSEditor` SDK：

```javascript
window.CSEditor = {
  plugin: { key, name },
  file: { name, content, path },
  request: (action, payload) => Promise,  // 通过 postMessage 与父窗口通信
  saveContent: (content) => ...,
  getContent: () => ...,
  notify: (msg) => ...,
  emitSave: (content) => ...  // 直接发送保存事件
};

// 监听父窗口命令
window.addEventListener('message', function(e) {
  if (e.data.__ceseCommand === 'save') {
    if (typeof saveConfig === 'function') saveConfig();
  }
});
```

**注意**: JS 脚本 **不包裹 try/catch**，否则函数声明 (`function saveConfig()`) 无法提升到全局作用域。

---

## 五、EA2 考试档案编辑器插件 (ea2_exam_editor)

**数据库**: `editor_plugins` 表，`plugin_key = 'ea2_exam_editor'`
**注册后缀**: `.ea2`
**初始化脚本**: `seed-ea2-plugin.php`

### 5.1 当前版本 (数据库中的实际 JS)

文件 `tools/ea2-js-now.txt` 保存了当前数据库中的 JS 代码。

**核心数据结构**:
```javascript
var examData = { examName, message, examInfos: [] };
var wizard = {
  active, step, day, dayDate, startTime,
  currentSubject, currentDuration, currentBreak,
  materials: [], subjects: [], editIdx, lunchSkipped
};
```

### 5.2 界面布局

桌面端采用四象限布局，边框可拖动：
- **左上**: 考试场次列表 (含新建/向导按钮)
- **左下**: 考试信息 (名称、提示信息)
- **右上**: 编辑区域 (场次详情 / 向导)
- **右下**: 可收折问题栏 (验证错误/警告)

### 5.3 考试创建向导

向导步骤流程：
1. `date` → 选择第 N 天日期 (预设: 今天/明天/后天)
2. `time` → 选择开始时间 (预设: 8:00/7:40/9:00)
3. `subject` → 填写科目信息 (名称/时长/休息/材料)
   - 科目预设按钮: 语文(120′)、数学(120′)、英语(120′) 等
   - 休息时间预设: 10′/15′/20′/30′/40′ + 清空选项
   - 自动使用所有场次中使用次数最多的休息时间
4. 循环 → 点击"当日下一场"继续添加，直到超过今日 24:00
5. 饭空检测 → 下一场开始时间落入 11:50-13:00 (午饭) 或 16:00-19:00 (晚饭) 时提示
6. 点击"录入完毕"结束向导

**关键函数**:
- `wizNextSubject()`: 保存当前科目，计算下一场开始时间
- `wizEndDay()`: 结束当天，进入下一天 → **修复了跨天顺延问题** (保存 startTime 后恢复)
- `wizSaveEdit()`: 编辑模式下更新并顺延后续场次
- `cascadeFrom(idx)`: 从指定索引开始顺延所有后续场次的时间
- `calcProjectedMeal()`: 实时计算下一场是否进入饭空时段

### 5.4 保存与验证

- `saveConfig()`: 先验证，确认后通过 `window.CSEditor.emitSave(json)` 保存
- `runValidation()`: 检查名称、时间有效性、时间重叠、提醒时间合理性
- 快捷键: `Ctrl+S` 保存, `Shift+Alt+F` 格式化

### 5.5 已知问题 / 注意事项

- **多个文件重复创建**: 文件名处理需检查是否已以 `.ea2` 结尾，避免重复添加后缀
- **函数声明作用域**: editorSrcDoc 中的 JS 不包裹 try/catch，确保函数声明提升到全局作用域
- **饭空检测**: 检测的是当前正在填写的科目是否横跨饭空时段，而非下一场

---

## 六、EA2 客户端适配器插件 (ea2-cses-cloud-adapter)

**路径**: `ea2-adapter-plugin/`
**安装路径**: `%APPDATA%/@dsz-examaware/desktop/plugins/ea2-cses-cloud-adapter/`

### 6.1 文件结构

```
ea2-adapter-plugin/
├── package.json          # 插件清单 (apiVersion: 2)
├── schema.json           # 设置项定义 (serverUrl, instanceUid, credential, deviceId)
├── main.cjs              # 主进程入口 (defineMainPlugin)
├── vite.renderer.config.ts
└── src/renderer/
    └── main.js           # 渲染进程入口 (defineRendererPlugin, 设置页面)
```

### 6.2 package.json 关键字段

```json
{
  "examaware": {
    "apiVersion": 2,
    "displayName": "CSES Cloud 适配器",
    "description": "基于 EA2 控制协议 v1，连接 CSES Cloud 云控平台",
    "permissions": ["ui.contribute", "network.http", "network.local"],
    "targets": {
      "main": "main.cjs",
      "renderer": "./dist/renderer/index.mjs"
    },
    "activation": {
      "rendererWindows": ["settings"]
    },
    "settings": {
      "namespace": "cses-cloud",
      "schema": "./schema.json"
    }
  }
}
```

### 6.3 主进程 (main.cjs)

使用 `defineMainPlugin` 包装，基于 EA2 控制协议 v1 实现：

```javascript
module.exports = defineMainPlugin({
  activate(ctx) {
    // 1. 读取配置 (serverUrl, instanceUid, enrollmentCode)
    // 2. 监听配置变更 (ctx.api.settings.onChanged)
    // 3. 设备注册: POST /api/v1/device-enrollments?instance_uid=X
    //    - 请求体: { enrollmentCode, displayName, platform, architecture, appVersion, protocolVersion }
    //    - 响应: { deviceId, credential, websocketUrl, protocolVersion }
    //    - 认证: x-device-id + x-device-credential 请求头
    // 4. 自动启动轮询
    // 5. 返回清理函数
  },
  onError(error, ctx) { ... }
});
```

**核心功能**:
- 设备注册: 使用平台内置 REST API `POST /api/control.php?instance_uid=X&action=device_register`
- 命令轮询: 每 5 秒 `command_poll`（返回官方 `server.command` 格式）
- 心跳: 每 30 秒 `device_update_state`
- 命令执行: `exam-config.prepare` / `playback.*` / `broadcast.*` / `settings.apply`
- 结果上报: 使用官方 `command.result` 格式（`commandId`, `occurredAt`, `status`, `error`, `state`）
- 认证: 所有请求携带 `x-device-id` + `x-device-credential` 请求头

### 6.4 渲染进程 (src/renderer/main.js)

使用 `defineRendererPlugin` 包装，注册设置页面:

```javascript
ctx.api.ui.settings.registerPage({
  id: 'cses-cloud-settings',
  label: 'CSES Cloud',
  icon: 'cloud',
  order: -1,
  component: () => Promise.resolve(SettingsPage),
});
```

设置页面包含: 服务器地址、实例 UID、注册码 (可编辑) + 设备凭证、设备 ID (只读/自动填充)

### 6.5 构建与部署

```bash
cd ea2-adapter-plugin
npm run build
# 手动复制到 EA2 插件目录
cp main.cjs "%APPDATA%/@dsz-examaware/desktop/plugins/ea2-cses-cloud-adapter/"
cp dist/renderer/index.mjs "%APPDATA%/@dsz-examaware/desktop/plugins/ea2-cses-cloud-adapter/dist/renderer/"
```

**注意**: 修改 `main.cjs` 后需重启 EA2 客户端。

---

## 七、通用 REST 设备控制 API

**文件**: `api/control.php`
**路由**: `/api/control.php?instance_uid={uid}&action={action}`

> 这是 CSES Cloud 平台的内置能力。任何实例侧应用均可使用此 API 实现客户端远程控制。

### 7.1 端点列表

| action | 方法 | 用途 | 认证 |
|--------|------|------|------|
| `device_register` | POST | 设备注册（注册码验证） | 注册码 |
| `device_list` | GET/POST | 列出所有设备 | 实例管理员 |
| `device_get` | POST | 获取单个设备详情 | 实例管理员 |
| `device_unregister` | POST | 注销设备 | 实例管理员 |
| `device_update_state` | POST | 更新设备状态 (心跳) | 设备凭证 |
| `enrollment_create` | POST | 创建注册码 | 实例管理员 |
| `enrollment_list` | GET/POST | 列出注册码 | 实例管理员 |
| `enrollment_revoke` | POST | 吊销注册码 | 实例管理员 |
| `command_create` | POST | 创建命令 (支持广播、呼叫监考、部署考试) | 实例管理员 |
| `command_poll` | POST | 设备轮询待执行命令 | 设备凭证 |
| `command_report` | POST | 设备上报命令执行结果 | 设备凭证 |
| `command_list` | GET/POST | 列出命令 | 实例管理员 |
| `command_get` | GET/POST | 获取单个命令详情 | 实例管理员 |
| `device_errors` | POST | 上报设备错误 | 设备凭证 |
| `exam_config_list` | GET/POST | 列出可部署的考试配置 | 实例管理员 |
| `events_stream` | GET | SSE 事件流 | 实例管理员 |

### 7.2 设备注册

**请求**: `POST /api/control.php?instance_uid={uid}&action=device_register`
```json
{
  "enrollmentCode": "xxxxxxxxxxxx",
  "displayName": "Device-Name",
  "platform": "win32",
  "architecture": "x64",
  "appVersion": "2.0.0",
  "protocolVersion": 1
}
```

**响应**:
```json
{
  "code": 0,
  "data": {
    "deviceId": "uuid",
    "credential": "base64url-encoded-string",
    "websocketUrl": "http://...",
    "protocolVersion": 1
  }
}
```

### 7.3 命令轮询响应格式

```json
{
  "code": 0,
  "data": [
    {
      "commandId": "uuid",
      "issuedAt": "2026-08-16T08:00:00+08:00",
      "expiresAt": "2026-08-16T08:05:00+08:00",
      "command": {
        "type": "exam-config.prepare",
        "payload": { ... }
      }
    }
  ]
}
```

### 7.4 安全机制

- 设备注册: 注册码必需（SHA-256 哈希比对 + 有效期 + 使用次数 + 格式验证）
- 命令轮询/上报: 支持 `x-device-id` + `x-device-credential` 请求头认证和 body 参数认证
- 管理操作: 需实例管理员权限
- 数据隔离: 所有操作按 `instance_id` 隔离
- 设备 ID: 由服务端生成 UUID

### 7.5 开发者中心 UI 集成

开发者可通过以下 UI 路径使用此 API：

1. **开发者中心 → 设备控制 API 卡片** - 点击后弹出模态对话框，展示完整 API 端点列表、认证方式和使用指南
2. **应用编辑器 → 设备控制 Tab** - 在 DevAppEditor 中为每个应用配置 `control_manifest`（启用/禁用、协议版本、支持的指令类型、描述）
3. **实例详情 → 设备控制 Tab** - 管理注册码、查看设备列表、注销设备
4. **EA2 客户端插件** - 通过设置页面配置服务器地址、实例 UID 和注册码后自动连接

### 7.6 control_manifest 结构

存储在 `apps` 表的 `control_manifest` 字段（JSON）中，开发者通过应用编辑器的「设备控制」Tab 配置：

```json
{
  "enabled": true,
  "protocolVersion": 1,
  "supportedCommands": [
    "exam-config.prepare",
    "playback.activate",
    "broadcast.show"
  ],
  "description": "用于 ExamAware 2 客户端远程管理考试配置"
}
```

- `enabled`: 是否启用设备控制能力
- `protocolVersion`: 协议版本（当前仅 v1）
- `supportedCommands`: 此应用支持的指令类型列表
- `description`: 设备控制用途描述

---

## 八、初始化脚本

### 8.1 seed-ea2-instance.php

创建 EA2 示例实例:
- 应用模板: `app_key = 'examaware2'`, 名称 "ExamAware 2 考试管理"
- 实例: `instance_uid = 'inst-ea2demo'`
- PHP 后端: `exams.php` (考试 CRUD)
- EA2 控制 PHP: `control.php` (复制 ea2-control.php)
- 示例配置: `config.ea2` (含 2 场示例考试)

### 8.2 seed-ea2-plugin.php

创建 `ea2_exam_editor` 编辑器插件 (仅首次运行):
- 注册 `.ea2` 后缀
- 包含初始版本的 HTML/CSS/JS (注意: 数据库中的实际版本可能已被后续修复脚本更新)

---

## 九、修复脚本

| 脚本 | 用途 |
|------|------|
| `tools/fix-ea2-editor-v2.php` | 修复保存按钮、向导跨天时间等 |
| `tools/fix-ea2-wizard-crossday.php` | 专门修复 wizEndDay 跨天顺延问题 |
| `tools/check-ea2-js.php` | 检查数据库中的 edior_js 内容 |

---

## 十、通信流程总结

```
EA2 Client                           CSES Cloud Server
    │                                      │
    │── POST /api/control.php ────────────►│ 注册设备（v1协议）
    │   ?instance_uid=X                   │ 验证注册码
    │   &action=device_register            │ 生成 deviceId + credential
    │     appVersion, protocolVersion }    │
    │◄── { deviceId, credential } ────────│
    │                                      │
    │── command_poll (每5s) ──────────────►│ 轮询待执行命令
    │   x-device-id + x-device-credential  │ 返回 server.command 格式
    │◄── [{ commandId, command: {         │
    │       type, payload } }] ───────────│
    │                                      │
    │── command_report ───────────────────►│ 上报执行结果
    │   { commandId, status, occurredAt,   │ 返回 command.result 格式
    │     error?, state? }                 │
    │                                      │
    │── device_update_state (30s) ────────►│ 心跳
    │   x-device-id + x-device-credential  │
    │                                      │
    │── device_errors ────────────────────►│ 上报设备错误（v1）
    │                                      │
    │                                      │
Web Browser (CSES Cloud)                  │
    │                                      │
    │── command_create ───────────────────►│ 下发命令到设备（含呼叫监考、部署考试）
    │── device_list ──────────────────────►│ 查看设备状态
    │── enrollment_create ────────────────►│ 创建注册码
```

---

## 十一、开发注意事项

1. **插件 JS 不包裹 try/catch**: 编辑器 srcdoc 中的 JS 脚本不能包裹 try/catch，否则函数声明无法提升到全局作用域
2. **文件名去重**: 创建 `.ea2` 文件时检查文件名是否已以 `.ea2` 结尾，避免重复添加后缀
3. **CJS vs ESM**: `main.cjs` 使用 `.cjs` 扩展名避免 ES module 冲突
4. **defineMainPlugin/defineRendererPlugin**: 本地实现，等效于 `@dsz-exam-aware/plugin-sdk`，需确保 `apiVersion` 和 `process` 为可枚举属性
5. **postMessage 序列化**: 只能传递可序列化对象，不能传递复杂对象 (如 tool 对象)
6. **PHP 缓冲**: SSE 流式输出需清空所有缓冲层 (`while (ob_get_level() > 0) { @ob_end_clean(); }`)
7. **考试列表来源**: 通过扫描 cloud_files 中所有 `.ea2` 文件生成，非独立存储
8. **饭空检测**: 针对当前正在填写的考试，判断是否横跨饭空时段或结束时间临近饭空开始 ≤30 分钟
9. **编辑器右侧面板**: 默认显示 AI 助理 + 属性面板，tab 容器不得设置 `overflow: hidden`
10. **v1 协议注册码**: 注册码格式为 `[A-Za-z0-9_-]{16,128}`，必须通过 `enrollment_create` 在 CSES Cloud 平台生成
11. **身份认证头**: v1 协议使用 `x-device-id` + `x-device-credential` 请求头进行身份认证，同时也兼容 body 参数方式
12. **设备 ID 由服务端生成**: 与旧版不同，v1 协议中 `deviceId` 由服务端生成 UUID，客户端不可自行生成
13. **命令格式**: 轮询返回的命令格式为 `{ commandId, issuedAt, expiresAt, command: { type, payload } }`，与官方 `server.command` 消息一致
14. **PHP 无 WebSocket**: 由于 PHP 限制，`websocketUrl` 字段返回的是轮询端点地址，客户端继续使用 REST 轮询代替 WebSocket 长连接