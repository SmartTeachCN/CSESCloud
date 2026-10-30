# V3 改造架构说明（轻编辑器配置实例化 + 静态集控）

> 本文件是 V3 分支的实施契约，所有参与改造的成员必须遵循本文件的接口与文件边界。

## 1. 目标

1. 移除“校园集控 / 实例云控”管理界面，以及 WebSocket、REST 设备控制、EA2 设备、
   PHP 实例沙箱等**动态集控**能力。
2. 轻编辑器（`/console/editor/light`）同时管理 **云文件** 与 **配置实例**：
   - 普通云文件保持现有列表展示方式不变；
   - 文件右键新增「分发配置」；
   - 新增配置实例管理入口（查看 / 编辑 / 删除 / 复制清单 / 下载清单 / 打开源文件）。
3. 静态集控实现参考 `E:\CsesWebEditor`（`classisland/manifest.php`、`classisland/file.php`、
   `classisland/convert.php`），由 NodeJS 云应用模块提供：
   - `GET /classisland/manifest.php?id=<实例组标识>` —— ClassIsland 2.0 集控清单；
   - `GET /classisland/file.php?id=<实例组标识>/<实例标识>&key=<数据源>` —— 六类数据源；
   - `GET /control/file.php?format=ci&id=...&key=...` —— 兼容旧地址（无 key 时返回清单）。
4. “配置实例”复用平台既有的**实例云应用模块**（`instances` / `apps` / `instance_groups` /
   实例文件与存储模块），其服务端云应用模块由 NodeJS 编写（`server/apps/`）。

## 2. 数据模型（在原有表上增量扩展）

- `instances` 新增：
  - `app_key TEXT`（已有增量迁移，需补进 `schema.sql`）
  - `source_file_id INTEGER`：轻编辑器源文件 `web_hosting_files.id`
  - `updated_at TEXT`
- `instance_groups` 新增：
  - `dir_id TEXT`：对外公开的实例组标识（12 位小写字母/数字，唯一）
  - `updated_at TEXT`
- 配置实例的语义：
  - 一条 `instances` 记录 = 一个配置实例；
  - `name` 即 ClassIsland 侧填写的“实例标识”（中文/空格允许，禁止 `/ \ : * ? " < > |`、`..`、首字符 `.`）；
  - `group_id` 指向该用户的实例组；`app_key = 'cses_static_control'`；
  - `config` JSON：`{ "format": "classisland", "organization_name": "...", "file_name": "..." }`。
- 源文件内容实时读取（不复制），文件保存后静态集控数据立即更新；清单版本号取实例组内
  所有源文件 `updated_at` 的最大值换算的 Unix 秒。

## 3. 服务端模块边界

### 3.1 `server/lib/classisland-convert.js`（新增，backend-static 负责）

从 `E:\CsesWebEditor\classisland\convert.php` 1:1 移植的纯函数模块：

```js
CORE_VERSION = '2.0.0.0'
validDirId(id) / validInstanceId(id)
stableUuid(namespace, name)          // UUID v5 风格（crypto sha1）
normTime(v) / normDays(v)
section(doc, name)                    // 顶层 + extraKey，忽略大小写
profile(doc, namespace, section)      // section: 'ClassPlans'|'TimeLayouts'|'Subjects'
policy(doc) / credentials(doc) / settings(doc)
document(doc, key, namespace)         // 六类数据源分发；未知 key 返回 null
DATA_SOURCE_KEYS = ['ClassPlans','TimeLayouts','Subjects','Policy','Credentials','Settings']
manifest(dirId, version, baseUrl)     // ClassIsland 2.0 清单
```

要点：`StartTime/EndTime` 为 `HH:MM:SS`，同时输出 `StartSecond/EndSecond`；稳定 GUID；
空对象输出 `{}`（JS 天然满足）；星期 0=周日；v2 多启用日拆成多个 ClassPlan。

### 3.2 `server/apps/`（新增，backend-static 负责）

NodeJS 云应用模块注册表 + 内置“静态集控”云应用：

- `server/apps/index.js`
  ```js
  get(appKey) -> module | null
  list() -> [{ appKey, name, description }]
  ```
- `server/apps/cses-static-control/index.js`
  ```js
  appKey = 'cses_static_control'
  name = 'CSES 静态集控'
  resolveGroup(db, dirId)                    // -> { group } | { error, status }
  resolveInstance(db, dirId, instanceId)     // -> { instance, group, file } | { error, status }
  version(db, groupId)                       // -> unix 秒（无数据返回 0）
  manifest(db, dirId, baseUrl)               // -> { json } | { error, status }
  payload(db, dirId, instanceId, key)        // -> { json } | { error, status }
  urls(baseUrl, dirId, instanceId)           // -> { manifest, file_template }
  managementProfile(manifestUrl)             // -> ClassIsland 管理清单下载对象
  validateContent(content, fileName)         // -> { ok, document, stats, warnings } | { ok:false, error }
  ```
- 数据源解析：`web_hosting_files.content`（Buffer 转 utf8）→ `.json` 用 `JSON.parse`，
  其他（含 `.yml/.yaml`）用 `js-yaml` 解析；必须能识别为 CSES 文档
  （含 `version` 或 `subjects` / `schedules` / `extraKey`）。

### 3.3 公开静态集控路由（`server/lib/static-control-public.js`，backend-static 负责）

导出 Express handler（由 Lead 在 `server/index.js` 挂载）：

```js
manifestHandler(req, res)        // /classisland/manifest.php  /classisland/manifest
fileHandler(req, res)            // /classisland/file.php      /classisland/file
controlFileHandler(req, res)     // /control/file.php（format=ci 兼容）
```

- 成功：`Content-Type: application/json; charset=utf-8`，原始 JSON（无 `{code}` 包装），
  设置 `Cache-Control: no-store`，允许 `Access-Control-Allow-Origin: *`。
- 失败：HTTP 400/404 + `{ "error": "中文错误信息" }`（与参考实现一致）。
- 基础地址从请求推导：`X-Forwarded-Proto`/`X-Forwarded-Host` 优先，否则 `req.protocol`/Host。

### 3.4 `server/api/distributions.js`（新增，backend-static 负责）

鉴权：`Auth.requireAlliance()`；所有者 = `Auth.ownerKey()`（`alliance:<username>`）。

| 方法 | action | 入参 | 返回 |
|---|---|---|---|
| GET | `overview` | – | `{ group, base_url, manifest_url, file_url_template, instances }` |
| GET | `list` | – | `InstanceDTO[]` |
| GET | `get` | `id` | `InstanceDTO` |
| POST | `create` | `{ file_id, instance_id?, organization_name?, group_name? }` | `InstanceDTO` |
| POST | `update` | `{ id, instance_id?, organization_name?, file_id? }` | `InstanceDTO` |
| POST | `delete` | `{ id }` | `null` |
| POST | `validate` | `{ file_id }` | `{ ok, document: {version,subjects,schedules}, classplans, timelayouts, warnings[] }` |
| GET | `manifest` | `id` | 管理清单 JSON（附件下载） |

`InstanceDTO`：

```json
{
  "id": 1,
  "instance_uid": "inst-xxxx",
  "name": "高一1班",
  "app_key": "cses_static_control",
  "source_file_id": 12,
  "source_file_name": "高一1班.yml",
  "source_file_type": "yml",
  "source_updated_at": "2026-10-24 20:00:00",
  "group_id": 3,
  "group_dir_id": "ab12cd34ef56",
  "organization_name": "CSES Cloud (ab12cd34ef56)",
  "status": "running",
  "created_at": "...",
  "updated_at": "...",
  "version": 1761316800,
  "urls": {
    "manifest": "http://host/classisland/manifest.php?id=ab12cd34ef56",
    "file_template": "http://host/classisland/file.php?id=ab12cd34ef56/{id}&key={key}"
  },
  "valid": true,
  "warning": ""
}
```

- 文件名/实例标识默认取源文件名去扩展名；非法字符替换为 `-`，组内重名自动加 `-2`。
- 每组每个实例标识唯一；一个所有者只有一个默认实例组（首次 overview/create 时惰性创建，
  `dir_id` 12 位小写字母/数字）。

### 3.5 前端 API（Lead 修改 `frontend/src/api/index.ts`）

```ts
export const distributionsApi = {
  overview: () => api.get<any>('/distributions?action=overview'),
  list: () => api.get<any[]>('/distributions?action=list'),
  get: (id: number) => api.get<any>(`/distributions?action=get&id=${id}`),
  create: (body: any) => api.post<any>('/distributions?action=create', body),
  update: (id: number, body: any) => api.post<any>('/distributions?action=update', { id, ...body }),
  remove: (id: number) => api.post('/distributions?action=delete', { id }),
  validate: (fileId: number) => api.post<any>('/distributions?action=validate', { file_id: fileId }),
  manifestUrl: (id: number) => `/api/distributions?action=manifest&id=${id}`
};
```

同时删除 `campusApi`、`instancesApi`、`groupsApi`、`schoolsApi`、`storageApi`、
`instanceFilesApi`、`authApi.loginInstanceSub`（由对应前端清理任务先移除引用）。

## 4. 前端交互（frontend-light-editor 负责）

`frontend/src/views/editor/LightEditor.vue`：

- 云文件列表保持现状（`普通文件保持当前列表显示`）；仅给“已分发”文件加一个小徽标（可选）。
- 云文件右键菜单新增 **「分发配置」**（仅自己拥有的文件；分享文件不显示）。
- 侧栏云文件标题旁增加「文件 / 实例」视图切换（或等效入口），实例视图即“配置实例管理”：
  - 空状态提示：在文件上右键 →「分发配置」；
  - 列表项：实例标识、源文件名、实例组标识、状态（正常/源文件异常）、更新时间；
  - 操作：打开源文件、编辑实例、复制清单链接、下载 ClassIsland 清单、查看数据源、删除。
- 新建 / 编辑分发对话框（`DistributionDialog.vue`）：
  1. 展示源文件名与 CSES 校验结果（`validate`）；
  2. 实例标识（默认文件名去扩展名）、组织名称（默认 `CSES Cloud (组标识)`）、实例组标识只读；
  3. 已存在同名实例时提示并可“更新现有实例”；
  4. 成功后展示来源地址、清单地址与 ClassIsland 接入步骤（参考 README），
     提供“复制清单地址 / 下载清单文件 / 复制数据源模板”。
- 交互与样式复用现有 `editor.css` 与 `context-menu` / `dialog` 体系，不引入新依赖。

## 5. 移除清单（backend-cleanup / frontend-cleanup 负责）

后端删除：`server/api/campus-control.js`、`server/api/control.js`、`server/api/rest-control.js`、
`server/api/instance-php.js`、`server/api/dev/cc-packages.js`、`server/api/v1/device-enrollments.js`、
`server/lib/ws-control.js`、`server/lib/instance-php-sandbox.js`、`adapters/`、`docs/ea2-handover.md`；
清理 services/dev-fs/instances/seed 中的 ea2/cc/control_manifest/campus 引用；移除 `ws` 依赖。

前端删除：`views/campus/*`、`components/campus/*`、`views/instances/*`、`components/instances/*`、
`composables/useSchool.ts`、`views/services/ServiceList.vue`、`InstancePropertiesPanel.vue`；
路由/导航/首页/落地页/登录重定向/开发者中心/AI 页面/分享预览页中所有校园集控、实例云控、
设备控制、WebSocket 入口与文案。

## 6. 验收

1. `pnpm --dir frontend build` 通过；
2. `node server/index.js` 可启动，无 ws / control / campus 相关日志；
3. 冒烟：联盟登录 → 创建云文件（CSES YAML）→ 分发配置 → 访问
   `/classisland/manifest.php?id=<dir>` 与 `/classisland/file.php?id=<dir>/<实例>&key=Subjects`
   返回正确 JSON；取消分发后返回 404；
4. 旧动态接口（`/api/ws-control`、`/api/rest-control`、`/api/control`）不可用；
5. README 与帮助文档更新为 V3 说明。
