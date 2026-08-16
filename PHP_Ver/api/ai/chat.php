<?php
/**
 * AI 助理 API（规则引擎）
 *
 *  GET  action=sessions              列出当前用户的会话
 *  GET  action=messages&session_id=N  列出会话消息
 *  POST action=send                  发送消息并返回规则引擎回复
 *
 * 规则引擎说明：
 *  - 基于关键词匹配与上下文（scope / scope_ref）返回模板回复
 *  - 可根据需要扩展为调用外部 LLM API
 */
require_once __DIR__ . '\..\..\lib\bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// CORS 头必须最早设置，确保错误响应也包含
$origin = $_SERVER['HTTP_ORIGIN'] ?? 'http://localhost:5173';
header("Access-Control-Allow-Origin: {$origin}");
header('Access-Control-Allow-Credentials: true');

// 处理 CORS 预检请求（必须在 Auth 之前）
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

Auth::requireLogin();
$body = Helpers::jsonBody();
$ownerKey = Auth::ownerKey();
$user = Auth::user();

// 列出当前用户的会话
if ($method === 'GET' && $action === 'sessions') {
    $scope = $_GET['scope'] ?? null;
    $sql = "SELECT * FROM ai_chat_sessions WHERE owner_key = ?";
    $params = [$ownerKey];
    if ($scope) {
        $sql .= " AND scope = ?";
        $params[] = $scope;
    }
    $sql .= " ORDER BY id DESC LIMIT 30";
    Response::success(DB::all($sql, $params));
}

// 列出会话消息
if ($method === 'GET' && $action === 'messages') {
    $sessionId = (int)($_GET['session_id'] ?? 0);
    if (!$sessionId) Response::error('缺少 session_id');
    // 校验会话归属
    $session = DB::one("SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?", [$sessionId, $ownerKey]);
    if (!$session) Response::error('会话不存在或无权限', 403, 403);
    Response::success(DB::all("SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC", [$sessionId]));
}

// 发送消息并返回回复
if ($method === 'POST' && $action === 'send') {
    $content = trim($body['content'] ?? '');
    $scope = $body['scope'] ?? 'global';
    $scopeRef = $body['scope_ref'] ?? null;
    $sessionId = (int)($body['session_id'] ?? 0);
    $model = $body['model'] ?? 'default';

    if ($content === '') Response::error('消息内容不能为空');

    $now = date('Y-m-d H:i:s');

    // 创建或获取会话
    if (!$sessionId) {
        $sessionId = (int)DB::insert('ai_chat_sessions', [
            'owner_key' => $ownerKey,
            'scope' => $scope,
            'scope_ref' => $scopeRef ?: null,
            'title' => mb_substr($content, 0, 30),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    } else {
        $session = DB::one("SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?", [$sessionId, $ownerKey]);
        if (!$session) Response::error('会话不存在或无权限', 403, 403);
        DB::update('ai_chat_sessions', ['updated_at' => $now], 'id = ?', [$sessionId]);
    }

    // 保存用户消息
    DB::insert('ai_chat_messages', [
        'session_id' => $sessionId,
        'role' => 'user',
        'content' => $content,
        'created_at' => $now,
    ]);

    // 获取上下文（最近 6 条消息作为上下文窗口）
    $history = DB::all(
        "SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 6",
        [$sessionId]
    );
    $history = array_reverse($history);

    // 规则引擎生成回复
    $reply = generateReply($content, $scope, $scopeRef, $history, $user, $model, $ownerKey);

    // 保存 AI 回复
    $aiTime = date('Y-m-d H:i:s');
    DB::insert('ai_chat_messages', [
        'session_id' => $sessionId,
        'role' => 'assistant',
        'content' => $reply,
        'created_at' => $aiTime,
    ]);
    DB::update('ai_chat_sessions', ['updated_at' => $aiTime], 'id = ?', [$sessionId]);

    Response::success([
        'session_id' => $sessionId,
        'reply' => $reply,
    ]);
}

// 流式发送消息（支持 Agent 工具调用）
if ($method === 'POST' && $action === 'send_stream') {
    $content = trim($body['content'] ?? '');
    $scope = $body['scope'] ?? 'global';
    $scopeRef = $body['scope_ref'] ?? null;
    $sessionId = (int)($body['session_id'] ?? 0);
    $model = $body['model'] ?? 'default';

    if ($content === '') Response::error('消息内容不能为空');

    $now = date('Y-m-d H:i:s');

    // 创建或获取会话
    if (!$sessionId) {
        $sessionId = (int)DB::insert('ai_chat_sessions', [
            'owner_key' => $ownerKey,
            'scope' => $scope,
            'scope_ref' => $scopeRef ?: null,
            'title' => mb_substr($content, 0, 30),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    } else {
        $session = DB::one("SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?", [$sessionId, $ownerKey]);
        if (!$session) Response::error('会话不存在或无权限', 403, 403);
    }

    // 保存用户消息
    DB::insert('ai_chat_messages', [
        'session_id' => $sessionId,
        'role' => 'user',
        'content' => $content,
        'created_at' => $now,
    ]);

    // 获取上下文
    $history = DB::all(
        "SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 10",
        [$sessionId]
    );
    $history = array_reverse($history);

    // 提取编辑器上下文
    $editorContext = null;
    if (preg_match('/\[编辑器上下文\]\n(.*?)\n\n\[用户问题\]/s', $content, $m)) {
        $ctxLines = explode("\n", $m[1]);
        $editorContext = ['fileName' => '', 'fileContent' => '', 'language' => ''];
        foreach ($ctxLines as $line) {
            if (preg_match('/^当前文件:\s*(.+)/', $line, $lm)) $editorContext['fileName'] = $lm[1];
            if (preg_match('/^语言:\s*(.+)/', $line, $lm)) $editorContext['language'] = $lm[1];
            if (preg_match('/^选中内容:\s*\n```\n(.*?)\n```/s', $ctxLines[0] . "\n" . ($ctxLines[1] ?? ''), $lm2)) {
                $editorContext['fileContent'] = $lm2[1];
            } elseif (preg_match('/^文件内容:\s*\n```\n(.*?)\n```/s', $ctxLines[0] . "\n" . ($ctxLines[1] ?? ''), $lm2)) {
                $editorContext['fileContent'] = $lm2[1];
            }
        }
    }

    // 清空所有输出缓冲，设置 SSE 响应头
    while (ob_get_level() > 0) { @ob_end_clean(); }
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no');
    @ini_set('output_buffering', 'off');
    @ini_set('zlib.output_compression', '0');
    ignore_user_abort(true);
    set_time_limit(120);

    // 发送会话 ID
    echo "data: " . json_encode(['session_id' => $sessionId]) . "\n\n";
    @ob_flush();
    flush();

    // 如果使用非默认模型且有编辑器上下文，启用 Agent 模式
    $fullReply = '';
    if ($model !== 'default' && !empty($ownerKey) && $editorContext && !empty($editorContext['fileContent'])) {
        $fullReply = runAgentLoop($model, $content, $scope, $scopeRef, $history, $ownerKey, $editorContext, $sessionId);
    } elseif ($model !== 'default' && !empty($ownerKey)) {
        $fullReply = callRealAI($model, $content, $scope, $scopeRef, $history, $ownerKey);
    }

    if (empty($fullReply)) {
        $fullReply = generateReply($content, $scope, $scopeRef, $history, $user, 'default', '');
    }

    // 逐字符流式输出最终回复
    $tokens = preg_split('//u', $fullReply, -1, PREG_SPLIT_NO_EMPTY);
    $chunk = '';
    $i = 0;
    foreach ($tokens as $token) {
        $chunk .= $token;
        $i++;
        if ($i >= 2) {
            echo "data: " . json_encode(['token' => $chunk]) . "\n\n";
            @ob_flush();
            flush();
            $chunk = '';
            $i = 0;
            usleep(15000);
        }
    }
    if ($chunk !== '') {
        echo "data: " . json_encode(['token' => $chunk]) . "\n\n";
        @ob_flush();
        flush();
    }

    // 发送完成信号
    echo "data: " . json_encode(['done' => true]) . "\n\n";
    flush();

    // 保存 AI 回复
    $aiTime = date('Y-m-d H:i:s');
    DB::insert('ai_chat_messages', [
        'session_id' => $sessionId,
        'role' => 'assistant',
        'content' => $fullReply,
        'created_at' => $aiTime,
    ]);
    DB::update('ai_chat_sessions', ['updated_at' => $aiTime], 'id = ?', [$sessionId]);
    exit;
}

// 删除会话
if ($method === 'POST' && $action === 'delete') {
    $sessionId = (int)($body['session_id'] ?? 0);
    if (!$sessionId) Response::error('缺少 session_id');
    $session = DB::one("SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?", [$sessionId, $ownerKey]);
    if (!$session) Response::error('会话不存在或无权限', 403, 403);
    DB::delete('ai_chat_messages', 'session_id = ?', [$sessionId]);
    DB::delete('ai_chat_sessions', 'id = ?', [$sessionId]);
    Response::success(['deleted' => true]);
}

Response::error('未知的操作', 405, 405);

/**
 * 规则引擎：基于关键词、scope 与上下文生成回复
 */
function generateReply($content, $scope, $scopeRef, $history, $user, $model = 'default', $ownerKey = '')
{
    // 如果指定了非默认模型，尝试调用真实 AI
    if ($model !== 'default' && !empty($ownerKey)) {
        $aiReply = callRealAI($model, $content, $scope, $scopeRef, $history, $ownerKey);
        if ($aiReply !== null) {
            return $aiReply;
        }
    }

    $text = mb_strtolower($content);
    $displayName = $user['display_name'] ?? '同学';

    // ===== 知识库搜索 =====
    // 确保知识库表存在
    DB::pdo()->exec("CREATE TABLE IF NOT EXISTS ai_knowledge_base (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $kbEntries = DB::all("SELECT title, content FROM ai_knowledge_base ORDER BY id ASC");
    $bestMatch = null;
    $bestScore = 0;
    foreach ($kbEntries as $entry) {
        $kbTitle = mb_strtolower($entry['title']);
        $kbContent = mb_strtolower($entry['content']);
        // 简单关键词匹配评分
        $score = 0;
        $words = preg_split('/[\s,，。！？、]+/u', $text);
        foreach ($words as $word) {
            if (mb_strlen($word) < 2) continue;
            if (mb_strpos($kbTitle, $word) !== false) $score += 3;
            if (mb_strpos($kbContent, $word) !== false) $score += 1;
        }
        if ($score > $bestScore) {
            $bestScore = $score;
            $bestMatch = $entry;
        }
    }
    if ($bestMatch && $bestScore >= 3) {
        return "根据知识库「{$bestMatch['title']}」：\n\n{$bestMatch['content']}";
    }

    // ===== 通用问候 =====
    if (preg_match('/(你好|您好|hi|hello|嗨|hey)/u', $text)) {
        return "你好，{$displayName}！我是 CSES Cloud 的 AI 助理。你可以问我关于实例管理、校园集控、编辑器使用等问题，我会尽力帮你解答。";
    }

    // ===== 帮助 / 功能 =====
    if (preg_match('/(帮助|help|怎么用|使用说明|功能|能做什么|你能做什么)/u', $text)) {
        return "我可以帮你：\n" .
            "1. 解答实例云控的问题（创建、共享、批量操作等）\n" .
            "2. 解答校园集控的问题（子用户管理、班级、加入学校等）\n" .
            "3. 解答编辑器使用问题（Ribbon 工具、配置管理器、查找替换等）\n" .
            "4. 解答登录与权限问题\n" .
            "5. 提供开发者平台相关问题指引\n\n" .
            "请直接描述你的问题。";
    }

    // ===== 实例云控相关问题 =====
    if ($scope === 'instance' || preg_match('/(实例|instance|云控|云控实例)/u', $text)) {
        if (preg_match('/(创建|新建|添加).*(实例|instance)/u', $text)) {
            return "创建实例步骤：\n1. 进入实例云控页面\n2. 点击右上角「新建实例」按钮\n3. 填写实例名称、服务类型等信息\n4. 提交即可创建\n\n实例创建后默认归你所有，可通过分组进行分类管理。";
        }
        if (preg_match('/(共享|分享|share)/u', $text)) {
            return "共享实例：在实例卡片上右键，选择「共享」，输入对方用户名即可。被共享用户会在其实例列表中看到此实例，但只能编辑不能删除。";
        }
        if (preg_match('/(删除|delete|移除)/u', $text)) {
            return "删除实例：右键实例卡片选择「删除」，或选中实例后点击批量操作栏的「删除」按钮。\n注意：删除操作不可恢复，会同时删除该实例的所有配置与数据。";
        }
        if (preg_match('/(分组|group|分类)/u', $text)) {
            return "实例分组：\n1. 点击实例列表页的「+新建分组」按钮创建分组\n2. 拖拽实例卡片到目标分组即可完成分类\n3. 可在分组上右键进行重命名或删除\n\n分组仅用于组织视图，不影响实例本身。";
        }
        if (preg_match('/(批量|batch)/u', $text)) {
            return "批量操作：\n1. 在实例列表中勾选多个实例的复选框\n2. 顶部会显示批量操作栏\n3. 可执行启动/停止/重启/移动分组/删除等操作";
        }
        if (preg_match('/(配置|config|设置)/u', $text)) {
            return "实例配置：\n1. 单击实例卡片进入编辑器\n2. 左侧编辑器区域可编辑实例数据\n3. 右侧 split-area 切换到「实例属性」面板可查看实例元信息\n4. Ribbon 工具栏的「保存」按钮可保存当前配置";
        }
        if ($scope === 'instance' && $scopeRef) {
            return "当前实例 ID：{$scopeRef}\n\n你可以问我关于此实例的配置、共享、批量操作等问题，例如：\n- 如何修改此实例的配置？\n- 如何将此实例共享给他人？\n- 此实例的运行状态如何？";
        }
        return "关于实例云控，你可以问我：\n- 如何创建实例？\n- 如何共享实例？\n- 如何进行批量操作？\n- 如何使用分组管理？\n- 如何修改实例配置？";
    }

    // ===== 校园集控相关问题 =====
    if ($scope === 'campus' || preg_match('/(校园|campus|学校|school|班级|class|子用户|sub.user|教师|teacher|学生|student)/u', $text)) {
        if (preg_match('/(加入|join).*(学校|school)/u', $text)) {
            return "加入学校流程：\n1. 在校园集控页面（未加入学校时）点击「加入学校」按钮\n2. 在弹窗中搜索目标学校\n3. 点击「申请加入」并填写展示名称\n4. 等待学校管理员审批通过后即视为加入成功\n\n你可以在「我的申请」中查看审批进度。";
        }
        if (preg_match('/(切换|switch).*(学校|school)/u', $text)) {
            return "切换学校：\n1. 在校园集控左侧栏顶部的「学校切换器」中点击\n2. 选择已加入的学校即可切换\n3. 切换后所有校园数据将基于新学校上下文";
        }
        if (preg_match('/(子用户|sub.user|添加.*用户|添加.*学生|添加.*教师)/u', $text)) {
            return "子用户管理：\n1. 进入「校园集控 → 子用户管理」\n2. 点击「添加子用户」\n3. 填写用户名、密码、角色（管理员/教师/学生）等信息\n4. 在权限配置区勾选该用户可执行的权限\n5. 提交即可创建\n\n子用户绑定到联盟账户后，将遵循此权限设置。";
        }
        if (preg_match('/(绑定|bind|联盟.*绑定)/u', $text)) {
            return "联盟账户绑定：\n1. 学校管理员可在「子用户管理 → 联盟绑定」查看本校所有绑定关系\n2. 子用户使用联盟账户登录后可主动绑定\n3. 绑定后，该子用户会出现在联盟账户的实例集控列表中（带标识标签）\n4. 子用户的所有操作遵循学校管理员设置的权限\n\n学校管理员可随时解绑任一绑定关系。";
        }
        if (preg_match('/(权限|permission|角色|role)/u', $text)) {
            return "权限系统：\n- 子用户的权限由学校管理员在创建/编辑时设置\n- 权限包括：创建实例、编辑实例、删除实例、共享实例、查看校园、管理校园、管理子用户等\n- 绑定到联盟账户后，联盟用户操作该子用户身份时遵循这些权限\n- 学校管理员可随时修改权限";
        }
        if (preg_match('/(班级|class|学生.*列表)/u', $text)) {
            return "班级管理：\n- 在「校园集控 → 班级列表」中可查看所有班级\n- 班级信息包括名称、学生人数、班主任、状态等\n- 校园概览页可查看班级状态总览";
        }
        if (preg_match('/(概览|overview|统计|指标)/u', $text)) {
            return "校园概览：\n- 显示当前学校的班级、学生、教师、实例、集控单元、今日操作等关键指标\n- 班级状态总览可按全部/在线/离线筛选\n- 右侧显示快捷操作与最近活动";
        }
        return "关于校园集控，你可以问我：\n- 如何加入学校？\n- 如何切换学校？\n- 如何添加子用户？\n- 如何管理权限？\n- 如何进行联盟账户绑定？\n- 如何查看校园概览？";
    }

    // ===== 编辑器相关问题 =====
    if (preg_match('/(编辑器|editor|ribbon|配置管理器|查找替换|编辑历史|实例属性)/u', $text)) {
        if (preg_match('/(ribbon|工具栏|工具)/u', $text)) {
            return "Ribbon 工具栏：\n- 位于编辑器顶部\n- 由开发者定义工具组与具体工具\n- 每个工具组有标题与一组工具按钮\n- 右侧有「自动保存」开关与「保存」按钮";
        }
        if (preg_match('/(配置管理器|config.manager)/u', $text)) {
            return "配置管理器：\n- 位于编辑器左侧主区域\n- 由开发者定义的配置清单自动渲染\n- 支持 text/number/boolean/select 等多种字段类型\n- 每个实例的配置严格分开，避免数据泄露\n- 可点击「新增」添加记录，行内编辑后保存";
        }
        if (preg_match('/(查找替换|find|replace)/u', $text)) {
            return "查找替换：\n- 在编辑器右侧 split-area 切换到「查找替换」面板\n- 输入查找内容与替换内容\n- 支持单次替换与全部替换";
        }
        if (preg_match('/(编辑历史|history)/u', $text)) {
            return "编辑历史：\n- 在编辑器右侧 split-area 切换到「编辑历史」面板\n- 显示该实例的所有编辑记录\n- 可查看每次修改的时间、操作者与变更内容";
        }
        if (preg_match('/(实例属性|props|属性)/u', $text)) {
            return "实例属性：\n- 在编辑器右侧 split-area 切换到「实例属性」面板\n- 显示实例的元信息（名称、所有者、创建时间等）\n- 可修改实例名称、描述等信息";
        }
        return "编辑器功能：\n- Ribbon 工具栏：开发者定义的快捷工具\n- 配置管理器：实例数据编辑\n- AI 助理：实时问答\n- 编辑历史：查看变更记录\n- 查找替换：批量修改\n- 实例属性：元信息管理";
    }

    // ===== 登录相关问题 =====
    if (preg_match('/(登录|login|登入|账号|account)/u', $text)) {
        if (preg_match('/(联盟|alliance|智教联盟)/u', $text)) {
            return "智教联盟登录：\n- 在登录页选择「智教联盟登录」\n- 输入联盟账户用户名\n- 系统会自动授权登录\n- 登录后可在校园集控侧栏切换/加入学校";
        }
        if (preg_match('/(子用户|sub|school.*sub)/u', $text)) {
            return "子用户登录：\n- 在登录页下拉框中选择学校\n- 输入用户名与密码\n- 勾选「保留在列表中」可在下次登录时直接选择\n\n若为实例子用户，在下拉框第一项「实例子用户」中输入实例 ID 即可。";
        }
        if (preg_match('/(实例.*子用户|instance.*sub|instance.*uid)/u', $text)) {
            return "实例子用户登录：\n- 在登录页下拉框中选择第一项「实例子用户」\n- 输入实例 ID（实例 UID）\n- 输入子用户名与密码\n- 登录后只能访问对应实例的编辑器";
        }
        return "登录方式：\n1. 智教联盟账户登录（主要）\n2. 子用户登录：选择学校后输入用户名密码\n3. 实例子用户登录：输入实例 ID 后登录\n\n登录一次后可选择保留登录条目，下次直接选择登录。";
    }

    // ===== 开发者平台相关问题 =====
    if (preg_match('/(开发者|developer|dev|开发.*平台|app|编辑器.*共享)/u', $text)) {
        if (preg_match('/(创建.*app|新建.*app|创建.*应用)/u', $text)) {
            return "创建应用：\n1. 进入「开发者中心」\n2. 点击「新建应用」\n3. 填写应用名称、类型等信息\n4. 在应用详情页可编辑编辑器 HTML/JS、配置清单、Ribbon 工具等\n5. 点击「发布」后应用进入共享列表";
        }
        if (preg_match('/(共享|分享|publish|发布)/u', $text)) {
            return "应用共享：\n- 在开发者中心编辑应用代码后点击「发布」\n- 发布后应用会出现在共享列表中\n- 其他用户可查看并使用/修改此应用\n- 实例创建时可选择已发布的应用作为模板";
        }
        if (preg_match('/(配置清单|manifest)/u', $text)) {
            return "配置清单：\n- 由开发者定义的结构化配置\n- 用于编辑器渲染与 API 层操作\n- 包含字段 key、label、type（text/number/boolean/select 等）\n- 实例创建后会基于清单自动生成配置管理器界面";
        }
        return "开发者中心：\n- 创建应用并定义编辑器、配置清单、Ribbon 工具\n- 发布应用共享给其他用户\n- 支持传统文件夹式 index.html 入口\n- 配置清单驱动渲染";
    }

    // ===== 平台介绍 =====
    if (preg_match('/(平台|platform|是什么|介绍|introduce|关于)/u', $text)) {
        return "CSES Cloud 智教云是一个云端教学管理平台，主要面向学校管理员、教师与学生，提供对第三方教学软件的统一集控能力。\n\n核心功能：\n- 实例云控：管理单个教学实例\n- 校园集控：管理校园整体教学环境\n- 编辑器：开发者定义的可视化编辑界面\n- 联盟账户：跨学校身份与权限管理";
    }

    // ===== 默认回复 =====
    return "我暂时无法理解你的问题。你可以尝试问我：\n- 如何创建实例？\n- 如何加入学校？\n- 如何使用编辑器？\n- 如何进行联盟账户绑定？\n- 平台是什么？\n\n或者直接描述你的需求，我会尽力帮你。";
}

/**
 * 调用真实 AI 模型
 * @return string|null 回复内容，失败返回 null
 */
function callRealAI($modelName, $content, $scope, $scopeRef, $history, $ownerKey)
{
    // 确保 ai_models 表存在
    DB::pdo()->exec("CREATE TABLE IF NOT EXISTS ai_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL DEFAULT '',
        api_key TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");

    // 查找模型：先按用户模型，再按系统模型，最后按内置模型名
    $model = DB::one("SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1", [$ownerKey, $modelName]);

    if (!$model) {
        // 查找系统级模型
        $model = DB::one("SELECT * FROM ai_models WHERE owner_key = 'system' AND name = ? AND is_enabled = 1", [$modelName]);
    }

    if (!$model) {
        // 内置模型：尝试用默认配置
        $builtinConfigs = [
            'gpt-4o' => ['provider' => 'openai', 'model_id' => 'gpt-4o'],
            'gpt-4o-mini' => ['provider' => 'openai', 'model_id' => 'gpt-4o-mini'],
            'claude-3-opus' => ['provider' => 'anthropic', 'model_id' => 'claude-3-opus-20240229'],
            'claude-3-sonnet' => ['provider' => 'anthropic', 'model_id' => 'claude-3-sonnet-20240229'],
            'gemini-pro' => ['provider' => 'google', 'model_id' => 'gemini-pro'],
            'deepseek-chat' => ['provider' => 'openai_compatible', 'model_id' => 'deepseek-chat', 'endpoint' => 'https://api.deepseek.com/v1/chat/completions'],
            'deepseek-reasoner' => ['provider' => 'openai_compatible', 'model_id' => 'deepseek-reasoner', 'endpoint' => 'https://api.deepseek.com/v1/chat/completions'],
        ];
        if (isset($builtinConfigs[$modelName])) {
            $model = $builtinConfigs[$modelName];
            $model['api_key'] = ''; // 内置模型需要用户自行配置 API Key
            // 保留内置配置中的 endpoint（如果有）
            if (empty($model['endpoint'])) {
                $model['endpoint'] = '';
            }
        } else {
            return null;
        }
    }

    $apiKey = $model['api_key'] ?? '';
    if (empty($apiKey)) {
        return null; // 没有 API Key，回退到规则引擎
    }

    $provider = $model['provider'];
    $modelId = $model['model_id'] ?? $modelName;
    $endpoint = $model['endpoint'] ?? '';

    // 构建系统提示词
    $systemPrompt = "你是 CSES Cloud 智教云平台的 AI 助理。你的职责是帮助用户解答关于平台的各种问题。\n" .
        "平台功能包括：实例云控、校园集控、编辑器、班级主页、开发者中心等。\n" .
        "当前上下文：scope={$scope}" . ($scopeRef ? ", scope_ref={$scopeRef}" : "") . "\n" .
        "请用中文简洁、专业地回答用户问题。";

    // 构建消息列表
    $messages = [['role' => 'system', 'content' => $systemPrompt]];
    foreach ($history as $h) {
        $messages[] = ['role' => $h['role'], 'content' => $h['content']];
    }
    $messages[] = ['role' => 'user', 'content' => $content];

    try {
        switch ($provider) {
            case 'openai':
            case 'openai_compatible':
            case 'deepseek':
                $url = $endpoint ?: ($provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');
                $resp = aiHttpPost($url, [
                    'model' => $modelId,
                    'messages' => $messages,
                    'max_tokens' => 2000,
                    'temperature' => 0.7
                ], [
                    'Authorization: Bearer ' . $apiKey,
                    'Content-Type: application/json'
                ]);
                $json = json_decode($resp, true);
                if (isset($json['choices'][0]['message']['content'])) {
                    return trim($json['choices'][0]['message']['content']);
                }
                return null;

            case 'anthropic':
                // 提取 system 消息
                $systemMsg = '';
                $userMessages = [];
                foreach ($messages as $m) {
                    if ($m['role'] === 'system') {
                        $systemMsg = $m['content'];
                    } else {
                        $userMessages[] = $m;
                    }
                }
                $url = $endpoint ?: 'https://api.anthropic.com/v1/messages';
                $body = [
                    'model' => $modelId,
                    'max_tokens' => 2000,
                    'messages' => $userMessages,
                ];
                if ($systemMsg) {
                    $body['system'] = $systemMsg;
                }
                $resp = aiHttpPost($url, $body, [
                    'x-api-key: ' . $apiKey,
                    'anthropic-version: 2023-06-01',
                    'Content-Type: application/json'
                ]);
                $json = json_decode($resp, true);
                if (isset($json['content'][0]['text'])) {
                    return trim($json['content'][0]['text']);
                }
                return null;

            case 'google':
                $url = $endpoint ?: "https://generativelanguage.googleapis.com/v1beta/models/{$modelId}:generateContent?key=" . $apiKey;
                $contents = [];
                foreach ($messages as $m) {
                    $contents[] = ['role' => $m['role'] === 'assistant' ? 'model' : 'user', 'parts' => [['text' => $m['content']]]];
                }
                $resp = aiHttpPost($url, ['contents' => $contents], ['Content-Type: application/json']);
                $json = json_decode($resp, true);
                if (isset($json['candidates'][0]['content']['parts'][0]['text'])) {
                    return trim($json['candidates'][0]['content']['parts'][0]['text']);
                }
                return null;

            default:
                return null;
        }
    } catch (Exception $e) {
        return null;
    }
}

/**
 * 流式调用真实 AI 模型，边接收边输出 SSE
 * @return string 完整回复内容
 */
function streamRealAI($modelName, $content, $scope, $scopeRef, $history, $ownerKey)
{
    // 确保 ai_models 表存在
    DB::pdo()->exec("CREATE TABLE IF NOT EXISTS ai_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL DEFAULT '',
        api_key TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");

    $model = DB::one("SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1", [$ownerKey, $modelName]);

    if (!$model) {
        $model = DB::one("SELECT * FROM ai_models WHERE owner_key = 'system' AND name = ? AND is_enabled = 1", [$modelName]);
    }

    $builtinConfigs = [
        'gpt-4o' => ['provider' => 'openai', 'model_id' => 'gpt-4o'],
        'gpt-4o-mini' => ['provider' => 'openai', 'model_id' => 'gpt-4o-mini'],
        'claude-3-opus' => ['provider' => 'anthropic', 'model_id' => 'claude-3-opus-20240229'],
        'claude-3-sonnet' => ['provider' => 'anthropic', 'model_id' => 'claude-3-sonnet-20240229'],
        'gemini-pro' => ['provider' => 'google', 'model_id' => 'gemini-pro'],
        'deepseek-chat' => ['provider' => 'openai_compatible', 'model_id' => 'deepseek-chat', 'endpoint' => 'https://api.deepseek.com/v1/chat/completions'],
        'deepseek-reasoner' => ['provider' => 'openai_compatible', 'model_id' => 'deepseek-reasoner', 'endpoint' => 'https://api.deepseek.com/v1/chat/completions'],
    ];

    if (!$model) {
        if (isset($builtinConfigs[$modelName])) {
            $model = $builtinConfigs[$modelName];
            $model['api_key'] = '';
            if (empty($model['endpoint'])) $model['endpoint'] = '';
        } else {
            return '';
        }
    }

    $apiKey = $model['api_key'] ?? '';
    if (empty($apiKey)) return '';

    $provider = $model['provider'];
    $modelId = $model['model_id'] ?? $modelName;
    $endpoint = $model['endpoint'] ?? '';

    $systemPrompt = "你是 CSES Cloud 智教云平台的 AI 助理。请用中文回答。";
    $messages = [['role' => 'system', 'content' => $systemPrompt]];
    foreach ($history as $h) {
        $messages[] = ['role' => $h['role'], 'content' => $h['content']];
    }
    $messages[] = ['role' => 'user', 'content' => $content];

    $fullReply = '';

    try {
        if ($provider === 'openai' || $provider === 'openai_compatible' || $provider === 'deepseek') {
            $url = $endpoint ?: ($provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');
            $streamUrl = $url;

            $payload = json_encode([
                'model' => $modelId,
                'messages' => $messages,
                'max_tokens' => 2000,
                'temperature' => 0.7,
                'stream' => true,
            ]);

            $fullReply = streamOpenAI($streamUrl, $apiKey, $payload);
            return $fullReply;
        }

        if ($provider === 'anthropic') {
            $systemMsg = '';
            $userMessages = [];
            foreach ($messages as $m) {
                if ($m['role'] === 'system') $systemMsg = $m['content'];
                else $userMessages[] = $m;
            }
            $url = $endpoint ?: 'https://api.anthropic.com/v1/messages';
            $body = ['model' => $modelId, 'max_tokens' => 2000, 'messages' => $userMessages, 'stream' => true];
            if ($systemMsg) $body['system'] = $systemMsg;

            $fullReply = streamAnthropic($url, $apiKey, json_encode($body));
            return $fullReply;
        }

        // 不支持流式，走非流式
        $fullReply = callRealAI($modelName, $content, $scope, $scopeRef, $history, $ownerKey);
        if ($fullReply) {
            $chunks = mb_str_split($fullReply, 5);
            foreach ($chunks as $chunk) {
                echo "data: " . json_encode(['token' => $chunk]) . "\n\n";
                @ob_flush();
                flush();
                usleep(20000);
            }
        }
        return $fullReply ?? '';
    } catch (Exception $e) {
        return '';
    }
}

/**
 * 流式调用 OpenAI/DeepSeek API（使用 fsockopen 实现可靠流式 HTTP）
 */
function streamOpenAI($url, $apiKey, $payload)
{
    $parsed = parse_url($url);
    $host = $parsed['host'];
    $port = $parsed['port'] ?? ($parsed['scheme'] === 'https' ? 443 : 80);
    $path = ($parsed['path'] ?? '/') . (isset($parsed['query']) ? '?' . $parsed['query'] : '');

    $isTls = ($parsed['scheme'] === 'https');
    $target = $isTls ? "tls://{$host}:{$port}" : "tcp://{$host}:{$port}";

    $fp = @stream_socket_client($target, $errno, $errstr, 10, STREAM_CLIENT_CONNECT);
    if (!$fp) {
        // 回退：非流式请求后分块输出
        return streamFallback($url, $apiKey, $payload, 'openai');
    }

    $out = "POST {$path} HTTP/1.1\r\n";
    $out .= "Host: {$host}\r\n";
    $out .= "Authorization: Bearer {$apiKey}\r\n";
    $out .= "Content-Type: application/json\r\n";
    $out .= "Content-Length: " . strlen($payload) . "\r\n";
    $out .= "Connection: close\r\n";
    $out .= "\r\n";
    $out .= $payload;

    fwrite($fp, $out);

    $headersDone = false;
    $fullReply = '';

    while (!feof($fp)) {
        $line = fgets($fp);
        if ($line === false) break;

        if (!$headersDone) {
            if (trim($line) === '') { $headersDone = true; }
            continue;
        }

        $line = trim($line);
        if ($line === '') continue;
        if (strpos($line, 'data: ') !== 0) continue;

        $data = substr($line, 6);
        if ($data === '[DONE]') break;

        $json = json_decode($data, true);
        if (!$json) continue;

        $delta = $json['choices'][0]['delta']['content'] ?? '';
        if ($delta === '') continue;

        $fullReply .= $delta;
        echo "data: " . json_encode(['token' => $delta]) . "\n\n";
        @ob_flush();
        flush();
    }

    fclose($fp);
    return $fullReply;
}

/**
 * 回退：非流式请求后分块输出
 */
function streamFallback($url, $apiKey, $payload, $type)
{
    $headers = [
        "Authorization: Bearer {$apiKey}",
        "Content-Type: application/json",
    ];

    $options = [
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers) . "\r\n",
            'content' => $payload,
            'timeout' => 60,
            'ignore_errors' => true,
        ],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    ];

    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);
    if ($response === false) return '';

    $json = json_decode($response, true);
    if (!$json) return '';

    $fullReply = '';
    if ($type === 'openai') {
        $fullReply = $json['choices'][0]['message']['content'] ?? '';
    } elseif ($type === 'anthropic') {
        $fullReply = $json['content'][0]['text'] ?? '';
    }

    if ($fullReply === '') return '';

    // 分块输出
    $tokens = preg_split('//u', $fullReply, -1, PREG_SPLIT_NO_EMPTY);
    $chunk = '';
    $i = 0;
    foreach ($tokens as $token) {
        $chunk .= $token;
        $i++;
        if ($i >= 3) {
            echo "data: " . json_encode(['token' => $chunk]) . "\n\n";
            @ob_flush();
            flush();
            $chunk = '';
            $i = 0;
            usleep(10000);
        }
    }
    if ($chunk !== '') {
        echo "data: " . json_encode(['token' => $chunk]) . "\n\n";
        @ob_flush();
        flush();
    }

    return $fullReply;
}

/**
 * 流式调用 Anthropic API（使用 fsockopen）
 */
function streamAnthropic($url, $apiKey, $payload)
{
    $parsed = parse_url($url);
    $host = $parsed['host'];
    $port = $parsed['port'] ?? ($parsed['scheme'] === 'https' ? 443 : 80);
    $path = ($parsed['path'] ?? '/') . (isset($parsed['query']) ? '?' . $parsed['query'] : '');

    $isTls = ($parsed['scheme'] === 'https');
    $target = $isTls ? "tls://{$host}:{$port}" : "tcp://{$host}:{$port}";

    $fp = @stream_socket_client($target, $errno, $errstr, 10, STREAM_CLIENT_CONNECT);
    if (!$fp) {
        return streamFallback($url, $apiKey, $payload, 'anthropic');
    }

    $out = "POST {$path} HTTP/1.1\r\n";
    $out .= "Host: {$host}\r\n";
    $out .= "x-api-key: {$apiKey}\r\n";
    $out .= "anthropic-version: 2023-06-01\r\n";
    $out .= "Content-Type: application/json\r\n";
    $out .= "Content-Length: " . strlen($payload) . "\r\n";
    $out .= "Connection: close\r\n";
    $out .= "\r\n";
    $out .= $payload;

    fwrite($fp, $out);

    $headersDone = false;
    $fullReply = '';

    while (!feof($fp)) {
        $line = fgets($fp);
        if ($line === false) break;

        if (!$headersDone) {
            if (trim($line) === '') { $headersDone = true; }
            continue;
        }

        $line = trim($line);
        if ($line === '') continue;
        if (strpos($line, 'data: ') !== 0) continue;

        $data = substr($line, 6);
        $json = json_decode($data, true);
        if (!$json) continue;

        if (($json['type'] ?? '') === 'content_block_delta') {
            $delta = $json['delta']['text'] ?? '';
            if ($delta !== '') {
                $fullReply .= $delta;
                echo "data: " . json_encode(['token' => $delta]) . "\n\n";
                @ob_flush();
                flush();
            }
        }
    }

    fclose($fp);
    return $fullReply;
}

/**
 * 发送 HTTP POST 请求（AI 调用专用）
 */
function aiHttpPost($url, $data, $headers = [])
{
    $options = [
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers) . "\r\n",
            'content' => json_encode($data),
            'timeout' => 60,
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ];
    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);
    if ($response === false) {
        throw new Exception('请求失败：无法连接到 AI 服务');
    }
    // 检查 HTTP 状态码
    $responseHeaders = http_get_last_response_headers();
    if ($responseHeaders) {
        $statusLine = $responseHeaders[0] ?? '';
        if (preg_match('/\s(\d{3})\s/', $statusLine, $m)) {
            $httpCode = (int)$m[1];
            if ($httpCode >= 400) {
                throw new Exception("HTTP {$httpCode}: " . substr($response, 0, 200));
            }
        }
    }
    return $response;
}

/**
 * Agent 工具调用循环 (ReAct 模式)
 * AI 可以多步调用工具读取/修改编辑器内容，最终给出回复
 */
function runAgentLoop($modelName, $content, $scope, $scopeRef, $history, $ownerKey, $editorContext, $sessionId)
{
    // 提取用户实际问题
    $userQuestion = $content;
    if (preg_match('/\[用户问题\]\n(.+)$/s', $content, $m)) {
        $userQuestion = trim($m[1]);
    }

    // 获取模型配置
    $model = DB::one("SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1", [$ownerKey, $modelName]);
    if (!$model) {
        $model = DB::one("SELECT * FROM ai_models WHERE owner_key = 'system' AND name = ? AND is_enabled = 1", [$modelName]);
    }
    if (!$model) {
        $builtinConfigs = [
            'gpt-4o' => ['provider' => 'openai', 'model_id' => 'gpt-4o'],
            'deepseek-chat' => ['provider' => 'openai_compatible', 'model_id' => 'deepseek-chat', 'endpoint' => 'https://api.deepseek.com/v1/chat/completions'],
        ];
        if (isset($builtinConfigs[$modelName])) {
            $model = $builtinConfigs[$modelName];
            $model['api_key'] = '';
        } else return '';
    }

    $apiKey = $model['api_key'] ?? '';
    if (empty($apiKey)) return '';

    $provider = $model['provider'];
    $modelId = $model['model_id'] ?? $modelName;
    $endpoint = $model['endpoint'] ?? '';

    // 构建系统提示词（含可用工具）
    $tools = [
        [
            'type' => 'function',
            'function' => [
                'name' => 'get_editor_content',
                'description' => '获取当前编辑器中打开的文件内容。用于查看文件的完整代码或配置。',
            ]
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'set_editor_content',
                'description' => '修改编辑器中的文件内容。传入新的完整内容替换当前文件。',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'new_content' => ['type' => 'string', 'description' => '新的完整文件内容'],
                    ],
                    'required' => ['new_content'],
                ]
            ]
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'search_in_content',
                'description' => '在当前编辑器文件中搜索指定文本，返回匹配行及其上下文。',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => '要搜索的文本'],
                    ],
                    'required' => ['query'],
                ]
            ]
        ],
    ];

    $systemPrompt = "你是 CSES Cloud 智教云平台的 AI 编程助理。你可以使用工具来读取和修改编辑器中的文件内容。\n\n" .
        "当前文件: {$editorContext['fileName']}\n" .
        "语言: {$editorContext['language']}\n\n" .
        "工作流程:\n" .
        "1. 先使用 get_editor_content 读取文件内容（如果需要）\n" .
        "2. 分析内容，做出修改\n" .
        "3. 使用 set_editor_content 写入修改后的内容\n" .
        "4. 每次操作后简要说明做了什么，并询问用户是否继续\n" .
        "5. 可以使用 search_in_content 搜索特定内容\n\n" .
        "重要规则:\n" .
        "- 每次修改后必须用简短语言告知用户改了什么\n" .
        "- 完成一个操作后询问「是否继续？」\n" .
        "- 保持代码修改精确，只改需要改的部分";

    // 构建消息列表
    $messages = [['role' => 'system', 'content' => $systemPrompt]];
    foreach ($history as $h) {
        $role = $h['role'];
        if ($role === 'assistant') {
            $messages[] = ['role' => 'assistant', 'content' => $h['content']];
        } else {
            $messages[] = ['role' => 'user', 'content' => $h['content']];
        }
    }
    $messages[] = ['role' => 'user', 'content' => $userQuestion];

    // 确定 API URL
    if ($provider === 'openai' || $provider === 'openai_compatible' || $provider === 'deepseek') {
        $url = $endpoint ?: 'https://api.openai.com/v1/chat/completions';
    } else {
        return callRealAI($modelName, $content, $scope, $scopeRef, $history, $ownerKey);
    }

    // Agent 循环（最多 5 轮）
    $maxRounds = 5;
    $finalReply = '';

    for ($round = 0; $round < $maxRounds; $round++) {
        $payload = json_encode([
            'model' => $modelId,
            'messages' => $messages,
            'tools' => $tools,
            'tool_choice' => 'auto',
            'max_tokens' => 2000,
            'temperature' => 0.7,
        ]);

        $response = aiHttpPost($url, $payload, [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ]);

        $json = json_decode($response, true);
        if (!$json) break;

        $choice = $json['choices'][0] ?? null;
        if (!$choice) break;

        $msg = $choice['message'];
        $finishReason = $choice['finish_reason'] ?? '';

        // 添加助手消息到历史
        $messages[] = $msg;

        // 如果有 tool_calls，执行工具
        if (!empty($msg['tool_calls'])) {
            foreach ($msg['tool_calls'] as $toolCall) {
                $fn = $toolCall['function'];
                $fnName = $fn['name'];
                $fnArgs = json_decode($fn['arguments'] ?? '{}', true) ?: [];

                // 通知前端工具调用
                echo "data: " . json_encode(['tool_call' => $fnName, 'args' => $fnArgs]) . "\n\n";
                @ob_flush();
                flush();

                // 执行工具
                $toolResult = '';
                switch ($fnName) {
                    case 'get_editor_content':
                        $toolResult = $editorContext['fileContent'];
                        break;
                    case 'set_editor_content':
                        $newContent = $fnArgs['new_content'] ?? '';
                        $editorContext['fileContent'] = $newContent;
                        // 通知前端应用编辑
                        echo "data: " . json_encode(['apply_edit' => $newContent]) . "\n\n";
                        @ob_flush();
                        flush();
                        $toolResult = "文件已更新。新内容字符数: " . mb_strlen($newContent);
                        break;
                    case 'search_in_content':
                        $query = $fnArgs['query'] ?? '';
                        $lines = explode("\n", $editorContext['fileContent']);
                        $matches = [];
                        foreach ($lines as $idx => $line) {
                            if (mb_stripos($line, $query) !== false) {
                                $start = max(0, $idx - 1);
                                $end = min(count($lines) - 1, $idx + 1);
                                for ($j = $start; $j <= $end; $j++) {
                                    $matches[] = ($j + 1) . ($j === $idx ? '>' : ':') . ' ' . $lines[$j];
                                }
                                $matches[] = '---';
                            }
                        }
                        $toolResult = empty($matches) ? "未找到匹配「{$query}」的内容" : implode("\n", array_slice($matches, 0, 30));
                        break;
                    default:
                        $toolResult = "未知工具: {$fnName}";
                }

                // 添加工具结果到消息
                $messages[] = [
                    'role' => 'tool',
                    'tool_call_id' => $toolCall['id'],
                    'content' => $toolResult,
                ];
            }
            continue; // 继续循环，让 AI 处理工具结果
        }

        // 没有 tool_calls，是最终回复
        $finalReply = $msg['content'] ?? '';
        break;
    }

    return $finalReply ?: 'AI 未能生成回复，请重试。';
}
