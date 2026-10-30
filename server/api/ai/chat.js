/**
 * AI 助理 API（规则引擎）
 *
 *  GET  action=sessions              列出当前用户的会话
 *  GET  action=messages&session_id=N  列出会话消息
 *  POST action=send                  发送消息并返回规则引擎回复
 *  POST action=send_stream           流式发送消息（支持 Agent 工具调用）
 *  POST action=delete                删除会话
 *
 * 规则引擎说明：
 *  - 基于关键词匹配与用户上下文生成模板回复
 *  - 会话 scope 固定为 global；文件上下文由客户端以「[编辑器上下文]」片段随消息传入
 *  - 可根据需要扩展为调用外部 LLM API
 */
const DB = require('../../lib/db');
const { nowStr, HttpSent } = require('../../lib/response');

// ── PHP 函数映射工具 ──

/** usleep(N)：PHP 参数为微秒 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PHP empty() 等价（'0' 视为空） */
function phpEmpty(v) {
  return v === undefined || v === null || v === '' || v === 0 || v === false
    || v === '0' || (Array.isArray(v) && v.length === 0);
}

/** mb_substr */
function mbSubstr(s, start, len) {
  const chars = [...String(s ?? '')];
  return chars.slice(start, len).join('');
}

/** mb_strlen */
function mbStrlen(s) {
  return [...String(s ?? '')].length;
}

/** 容错 JSON.parse */
function jsonParseSafe(s, def = null) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return def;
  }
}

/**
 * 现代化 SSE 流封装
 * - 心跳保活：每 15s 发送 SSE 注释行（: hb），穿透代理防止空闲断连
 * - 断连中止：客户端断开时通过 AbortController 联动取消上游 LLM 请求
 * - 写背压：客户端消费慢时（res.write 返回 false）挂起写入，等待 drain
 */
function createSSE(req, res) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const state = { closed: false, drainWaiters: [] };
  const sessionAbort = new AbortController();

  const heartbeat = setInterval(() => {
    if (state.closed || res.writableEnded) return;
    try { res.write(': hb\n\n'); } catch (_) { /* ignore */ }
  }, 15000);

  const onDisconnect = () => {
    if (state.closed) return;
    state.closed = true;
    clearInterval(heartbeat);
    // 唤醒所有等待背压的写入，避免悬挂
    state.drainWaiters.forEach((r) => r());
    state.drainWaiters = [];
    try { sessionAbort.abort(); } catch (_) { /* ignore */ }
  };
  req.on('close', onDisconnect);
  res.on('close', onDisconnect);

  return {
    /** 会话级中断信号（客户端断连时触发） */
    signal: sessionAbort.signal,
    get closed() { return state.closed || res.writableEnded; },

    /** 写一个事件（带背压；连接已关闭时返回 false） */
    async write(payload) {
      if (state.closed || res.writableEnded) return false;
      let ok = true;
      try {
        ok = res.write('data: ' + JSON.stringify(payload) + '\n\n');
      } catch (_) {
        return false;
      }
      if (!ok) {
        await new Promise((resolve) => {
          state.drainWaiters.push(resolve);
          res.once('drain', resolve);
        });
      }
      return !state.closed;
    },

    /** 正常结束流（不触发 abort） */
    end() {
      clearInterval(heartbeat);
      state.closed = true;
      try { res.end(); } catch (_) { /* ignore */ }
    },
  };
}

/**
 * 组合信号：父信号（会话断连）触发或超时触发
 * @returns {{ signal: AbortSignal, dispose: () => void }}
 */
function linkedSignal(parent, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onParent = () => ctl.abort();
  let linked = false;
  if (parent) {
    if (parent.aborted) ctl.abort();
    else {
      parent.addEventListener('abort', onParent, { once: true });
      linked = true;
    }
  }
  return {
    signal: ctl.signal,
    dispose: () => {
      clearTimeout(timer);
      if (linked) parent.removeEventListener('abort', onParent);
    },
  };
}

/** fetch 超时信号（对齐 PHP stream context timeout） */
function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** 本地回复的打字机输出（规则引擎回退；连接断开时提前结束） */
async function streamOutTypewriter(sse, text, charsPerTick = 2, intervalMs = 15) {
  const tokens = [...String(text ?? '')];
  let chunk = '';
  let i = 0;
  for (const token of tokens) {
    chunk += token;
    i++;
    if (i >= charsPerTick) {
      if (!(await sse.write({ token: chunk }))) return;
      chunk = '';
      i = 0;
      await sleep(intervalMs);
      if (sse.closed) return;
    }
  }
  if (chunk !== '') {
    await sse.write({ token: chunk });
  }
}

module.exports = async (ctx) => {
  const { req, res, DB, Auth, Response, Helpers, query, body } = ctx;

  const method = req.method;
  const action = query.action ?? '';

  // CORS 头必须最早设置，确保错误响应也包含
  const origin = req.headers.origin || 'http://localhost:5173';
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Credentials', 'true');

  // 处理 CORS 预检请求（必须在 Auth 之前）
  if (method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '86400');
    res.status(204);
    res.end();
    throw new HttpSent();
  }

  Auth.requireLogin();
  const ownerKey = Auth.ownerKey();
  const user = Auth.user();

  // 列出当前用户的会话
  if (method === 'GET' && action === 'sessions') {
    const scope = query.scope ?? null;
    let sql = 'SELECT * FROM ai_chat_sessions WHERE owner_key = ?';
    const params = [ownerKey];
    if (!phpEmpty(scope)) {
      sql += ' AND scope = ?';
      params.push(scope);
    }
    sql += ' ORDER BY id DESC LIMIT 30';
    Response.success(DB.all(sql, params));
  }

  // 列出会话消息
  if (method === 'GET' && action === 'messages') {
    const sessionId = parseInt(query.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    // 校验会话归属
    const session = DB.one('SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?', [sessionId, ownerKey]);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    Response.success(DB.all('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC', [sessionId]));
  }

  // 发送消息并返回回复
  if (method === 'POST' && action === 'send') {
    const content = String(body.content ?? '').trim();
    const scope = body.scope ?? 'global';
    const scopeRef = body.scope_ref ?? null;
    let sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    const model = body.model ?? 'default';

    if (content === '') Response.error('消息内容不能为空');

    const now = nowStr();

    // 创建或获取会话
    if (!sessionId) {
      sessionId = parseInt(DB.insert('ai_chat_sessions', {
        owner_key: ownerKey,
        scope: scope,
        scope_ref: phpEmpty(scopeRef) ? null : scopeRef,
        title: mbSubstr(content, 0, 30),
        created_at: now,
        updated_at: now,
      }), 10) || 0;
    } else {
      const session = DB.one('SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?', [sessionId, ownerKey]);
      if (!session) Response.error('会话不存在或无权限', 403, 403);
      DB.update('ai_chat_sessions', { updated_at: now }, 'id = ?', [sessionId]);
    }

    // 保存用户消息
    DB.insert('ai_chat_messages', {
      session_id: sessionId,
      role: 'user',
      content: content,
      created_at: now,
    });

    // 获取上下文（最近 6 条消息作为上下文窗口）
    let history = DB.all(
      'SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 6',
      [sessionId]
    );
    history = history.slice().reverse();

    // 规则引擎生成回复
    const reply = await generateReply(content, history, user, model, ownerKey);

    // 保存 AI 回复
    const aiTime = nowStr();
    DB.insert('ai_chat_messages', {
      session_id: sessionId,
      role: 'assistant',
      content: reply,
      created_at: aiTime,
    });
    DB.update('ai_chat_sessions', { updated_at: aiTime }, 'id = ?', [sessionId]);

    Response.success({
      session_id: sessionId,
      reply: reply,
    });
  }

  // 流式发送消息（支持 Agent 工具调用）
  if (method === 'POST' && action === 'send_stream') {
    const content = String(body.content ?? '').trim();
    const scope = body.scope ?? 'global';
    const scopeRef = body.scope_ref ?? null;
    let sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    const model = body.model ?? 'default';

    if (content === '') Response.error('消息内容不能为空');

    const now = nowStr();

    // 创建或获取会话
    if (!sessionId) {
      sessionId = parseInt(DB.insert('ai_chat_sessions', {
        owner_key: ownerKey,
        scope: scope,
        scope_ref: phpEmpty(scopeRef) ? null : scopeRef,
        title: mbSubstr(content, 0, 30),
        created_at: now,
        updated_at: now,
      }), 10) || 0;
    } else {
      const session = DB.one('SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?', [sessionId, ownerKey]);
      if (!session) Response.error('会话不存在或无权限', 403, 403);
    }

    // 保存用户消息
    DB.insert('ai_chat_messages', {
      session_id: sessionId,
      role: 'user',
      content: content,
      created_at: now,
    });

    // 获取上下文
    let history = DB.all(
      'SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 10',
      [sessionId]
    );
    history = history.slice().reverse();

    // 提取编辑器上下文
    let editorContext = null;
    const ecMatch = /\[编辑器上下文\]\n(.*?)\n\n\[用户问题\]/s.exec(content);
    if (ecMatch) {
      const ctxLines = ecMatch[1].split('\n');
      editorContext = { fileName: '', fileContent: '', language: '' };
      for (const line of ctxLines) {
        let lm = /^当前文件:\s*(.+)/.exec(line);
        if (lm) editorContext.fileName = lm[1];
        lm = /^语言:\s*(.+)/.exec(line);
        if (lm) editorContext.language = lm[1];
        const pair = ctxLines[0] + '\n' + (ctxLines[1] ?? '');
        let lm2 = /^选中内容:\s*\n```\n(.*?)\n```/s.exec(pair);
        if (lm2) {
          editorContext.fileContent = lm2[1];
        } else {
          lm2 = /^文件内容:\s*\n```\n(.*?)\n```/s.exec(pair);
          if (lm2) {
            editorContext.fileContent = lm2[1];
          }
        }
      }
    }

    // 建立现代化 SSE 通道（心跳保活 + 断连中止 + 背压）
    const sse = createSSE(req, res);

    // 发送会话 ID
    await sse.write({ session_id: sessionId });

    // 真实模型：上游 token 级流式透传（不再等待完整响应）
    // 如果使用非默认模型且有编辑器上下文，启用 Agent 模式（流式工具调用）
    let fullReply = '';
    if (process.env.AI_DEBUG) console.log('[ai-debug] model=%s ownerKey=%s editorCtx=%s', model, ownerKey, editorContext ? 'yes' : 'no');
    if (model !== 'default' && !phpEmpty(ownerKey) && editorContext && !phpEmpty(editorContext.fileContent)) {
      fullReply = await runAgentLoop(model, content, history, ownerKey, editorContext, sessionId, sse);
    } else if (model !== 'default' && !phpEmpty(ownerKey)) {
      fullReply = await streamRealAI(model, content, history, ownerKey, sse);
      if (process.env.AI_DEBUG) console.log('[ai-debug] streamRealAI returned len=%d', (fullReply ?? '').length);
    }

    if (phpEmpty(fullReply)) {
      // 回退规则引擎（本地生成，打字机节奏输出）
      fullReply = await generateReply(content, history, user, 'default', '');
      await streamOutTypewriter(sse, fullReply);
    }

    // 发送完成信号
    await sse.write({ done: true });

    // 保存 AI 回复（客户端中途断连时，已累积的部分回复同样入库，保持会话历史完整）
    const aiTime = nowStr();
    DB.insert('ai_chat_messages', {
      session_id: sessionId,
      role: 'assistant',
      content: fullReply,
      created_at: aiTime,
    });
    DB.update('ai_chat_sessions', { updated_at: aiTime }, 'id = ?', [sessionId]);
    sse.end();
    throw new HttpSent();
  }

  // 删除会话
  if (method === 'POST' && action === 'delete') {
    const sessionId = parseInt(body.session_id ?? 0, 10) || 0;
    if (!sessionId) Response.error('缺少 session_id');
    const session = DB.one('SELECT * FROM ai_chat_sessions WHERE id = ? AND owner_key = ?', [sessionId, ownerKey]);
    if (!session) Response.error('会话不存在或无权限', 403, 403);
    DB.delete('ai_chat_messages', 'session_id = ?', [sessionId]);
    DB.delete('ai_chat_sessions', 'id = ?', [sessionId]);
    Response.success({ deleted: true });
  }

  Response.error('未知的操作', 405, 405);
};

/**
 * 规则引擎：基于关键词与用户上下文生成回复
 * V3：仅保留全局 scope；文件上下文由客户端以「[编辑器上下文]」片段随消息传入
 */
async function generateReply(content, history, user, model = 'default', ownerKey = '') {
  // 如果指定了非默认模型，尝试调用真实 AI
  if (model !== 'default' && !phpEmpty(ownerKey)) {
    const aiReply = await callRealAI(model, content, history, ownerKey);
    if (aiReply !== null) {
      return aiReply;
    }
  }

  const text = String(content).toLowerCase();
  const displayName = (user && user.display_name) || '同学';

  // ===== 知识库搜索 =====
  // 确保知识库表存在
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_knowledge_base (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  const kbEntries = DB.all('SELECT title, content FROM ai_knowledge_base ORDER BY id ASC');
  let bestMatch = null;
  let bestScore = 0;
  for (const entry of kbEntries) {
    const kbTitle = String(entry.title).toLowerCase();
    const kbContent = String(entry.content).toLowerCase();
    // 简单关键词匹配评分
    let score = 0;
    const words = text.split(/[\s,，。！？、]+/u);
    for (const word of words) {
      if (mbStrlen(word) < 2) continue;
      if (kbTitle.indexOf(word) !== -1) score += 3;
      if (kbContent.indexOf(word) !== -1) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }
  if (bestMatch && bestScore >= 3) {
    return `根据知识库「${bestMatch.title}」：\n\n${bestMatch.content}`;
  }

  // ===== 通用问候 =====
  if (/(你好|您好|hi|hello|嗨|hey)/u.test(text)) {
    return `你好，${displayName}！我是 CSES Cloud 的 AI 助理。你可以问我关于轻编辑器、配置分发、静态集控、开发者中心等问题，我会尽力帮你解答。`;
  }

  // ===== 帮助 / 功能 =====
  if (/(帮助|help|怎么用|使用说明|功能|能做什么|你能做什么)/u.test(text)) {
    return '我可以帮你：\n' +
      '1. 解答轻编辑器的问题（云文件编辑、配置实例管理、分发配置）\n' +
      '2. 解答静态集控的问题（ClassIsland 清单、数据源、接入方式）\n' +
      '3. 解答开发者中心问题（云应用、编辑器插件、共享市场）\n' +
      '4. 解答数据空间、登录与账户相关问题\n' +
      '5. 解答 AI 助理与模型配置问题\n\n' +
      '请直接描述你的问题。';
  }

  // ===== 编辑器相关问题 =====
  if (/(编辑器|editor|ribbon|查找替换|编辑历史|版本历史|自动保存)/u.test(text)) {
    if (/(ribbon|工具栏|工具)/u.test(text)) {
      return 'Ribbon 工具栏：\n- 位于编辑器顶部\n- 由开发者定义的编辑器插件提供工具组与具体工具\n- 每个工具组有标题与一组工具按钮\n- 右侧有「自动保存」开关与「保存」按钮';
    }
    if (/(查找替换|find|replace)/u.test(text)) {
      return '查找替换：\n- 在编辑器右侧面板切换到「查找替换」\n- 输入查找内容与替换内容\n- 支持单次替换与全部替换';
    }
    if (/(编辑历史|版本历史|history)/u.test(text)) {
      return '编辑历史 / 版本历史：\n- 在编辑器右侧面板切换到「编辑历史」或「版本历史」\n- 显示文件的修改记录、操作者与变更内容\n- 可查看或恢复历史版本（视当前文件来源而定）';
    }
    return '编辑器功能：\n- 轻编辑器管理云文件与配置实例\n- Ribbon 工具栏：插件提供的快捷工具\n- AI 助理：实时问答与代码辅助\n- 编辑历史 / 版本历史：查看变更记录\n- 查找替换：批量修改内容\n- 自动保存与手动保存';
  }

  // ===== 配置分发 / 静态集控相关问题 =====
  if (/(分发|distribut|静态集控|static.?control|classisland|examaware|清单|manifest|配置地址)/u.test(text)) {
    if (/(分发|distribut)/u.test(text)) {
      return '分发配置：\n1. 在轻编辑器的云文件列表中找到配置文件\n2. 右键选择「分发配置」（仅自己拥有的文件）\n3. 系统会自动识别格式：\n   - ClassIsland 档案 → 静态集控（清单 + 六类数据源）\n   - CSES 配置 → 公开配置地址（原文件内容）\n   - ExamAware 配置 → 公开配置地址\n4. 填写实例标识与组织名称并提交\n\n分发后的配置会出现在「文件 / 实例」视图的实例列表中，可随时编辑、复制地址或取消分发。';
    }
    if (/(接入|加入|classisland|客户端|使用)/u.test(text)) {
      return 'ClassIsland 接入静态集控：\n1. 在轻编辑器中对 ClassIsland 档案完成「分发配置」，复制清单地址（manifest 地址）\n2. 在 ClassIsland 中选择「加入管理」，粘贴清单地址\n3. 客户端会按清单拉取六类数据源（ClassPlans / TimeLayouts / Subjects / Policy / Credentials / Settings）\n4. 源文件保存后数据立即更新，无需重新分发';
    }
    return '配置分发：\n- ClassIsland 档案 → 实例应用 classisland，提供静态集控清单与六类数据源\n- CSES / ExamAware 配置 → 实例应用 cses_config / examaware，提供公开配置地址（原文件内容）\n- 每个配置实例有唯一的实例标识与实例组标识\n- 取消分发后对应地址立即失效';
  }

  // ===== 登录相关问题 =====
  if (/(登录|login|登入|账号|account)/u.test(text)) {
    if (/(联盟|alliance|智教联盟)/u.test(text)) {
      return '智教联盟登录：\n- 在登录页选择「智教联盟登录」\n- 输入联盟账户用户名\n- 系统会自动授权登录\n- 登录后进入轻编辑器，可在控制台切换数据空间与开发者中心';
    }
    if (/(子用户|sub)/u.test(text)) {
      return '子用户登录：\n- 在登录页下拉框中选择学校\n- 输入用户名与密码\n- 勾选「保留在列表中」可在下次登录时直接选择';
    }
    return '登录方式：\n1. 智教联盟账户登录（主要）\n2. 子用户登录：选择学校后输入用户名密码\n\n登录一次后可选择保留登录条目，下次直接选择登录。';
  }

  // ===== 开发者中心相关问题 =====
  if (/(开发者|developer|dev|开发.*平台|云应用|插件|plugin|共享市场)/u.test(text)) {
    if (/(创建.*app|新建.*app|创建.*应用|新建应用)/u.test(text)) {
      return '创建云应用：\n1. 进入「开发者中心」\n2. 点击「新建应用」\n3. 填写应用名称、类型等信息\n4. 在应用详情页可编辑编辑器 HTML/JS、存储清单、接口清单等\n5. 点击「发布」后应用进入共享列表';
    }
    if (/(插件|plugin)/u.test(text)) {
      return '编辑器插件：\n- 在开发者中心「插件」中创建或安装插件\n- 插件可扩展编辑器 Ribbon 工具栏与自定义编辑器界面\n- 官方插件（如 CSES 编辑器、ClassIsland 档案编辑器）可在共享市场查看与使用';
    }
    if (/(共享|分享|publish|发布|市场)/u.test(text)) {
      return '应用共享：\n- 在开发者中心编辑应用后点击「发布」\n- 发布后应用会出现在共享市场列表中\n- 其他用户可查看、fork 并使用此应用';
    }
    return '开发者中心：\n- 创建云应用并定义编辑器、存储与接口清单\n- 开发编辑器插件扩展 Ribbon 工具\n- 发布应用/插件到共享市场\n- 查看与管理自己的应用与插件';
  }

  // ===== 平台介绍 =====
  if (/(平台|platform|是什么|介绍|introduce|关于)/u.test(text)) {
    return 'CSES Cloud 智教云是一个面向学校与教师的云端教学管理平台。\n\n核心功能：\n- 轻编辑器：在线编辑云文件、管理配置实例\n- 配置分发：把 ClassIsland 档案分发为静态集控，CSES / ExamAware 配置提供公开配置地址\n- 数据空间：云端文件与网页托管\n- 开发者中心：云应用、编辑器插件与共享市场\n- 联盟账户：跨学校身份与权限管理';
  }

  // ===== 默认回复 =====
  return '我暂时无法理解你的问题。你可以尝试问我：\n- 如何使用轻编辑器？\n- 如何分发配置 / 接入 ClassIsland？\n- 如何使用开发者中心？\n- 平台是什么？\n\n或者直接描述你的需求，我会尽力帮你。';
}

/** ai_models 建表语句（callRealAI / streamRealAI 共用） */
const AI_MODELS_DDL = `CREATE TABLE IF NOT EXISTS ai_models (
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
    )`;

/**
 * 调用真实 AI 模型
 * @returns {Promise<string|null>} 回复内容，失败返回 null
 */
async function callRealAI(modelName, content, history, ownerKey) {
  // 确保 ai_models 表存在
  DB.pdo().exec(AI_MODELS_DDL);

  // 查找模型：先按用户模型，再按系统模型，最后按内置模型名
  let model = DB.one('SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1', [ownerKey, modelName]);

  if (!model) {
    // 查找系统级模型
    model = DB.one("SELECT * FROM ai_models WHERE owner_key = 'system' AND name = ? AND is_enabled = 1", [modelName]);
  }

  if (!model) {
    // 内置模型：尝试用默认配置
    const builtinConfigs = {
      'gpt-4o': { provider: 'openai', model_id: 'gpt-4o' },
      'gpt-4o-mini': { provider: 'openai', model_id: 'gpt-4o-mini' },
      'claude-3-opus': { provider: 'anthropic', model_id: 'claude-3-opus-20240229' },
      'claude-3-sonnet': { provider: 'anthropic', model_id: 'claude-3-sonnet-20240229' },
      'gemini-pro': { provider: 'google', model_id: 'gemini-pro' },
      'deepseek-chat': { provider: 'openai_compatible', model_id: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
      'deepseek-reasoner': { provider: 'openai_compatible', model_id: 'deepseek-reasoner', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
    };
    if (Object.prototype.hasOwnProperty.call(builtinConfigs, modelName)) {
      model = { ...builtinConfigs[modelName] };
      model.api_key = ''; // 内置模型需要用户自行配置 API Key
      // 保留内置配置中的 endpoint（如果有）
      if (phpEmpty(model.endpoint)) {
        model.endpoint = '';
      }
    } else {
      return null;
    }
  }

  const apiKey = model.api_key ?? '';
  if (phpEmpty(apiKey)) {
    return null; // 没有 API Key，回退到规则引擎
  }

  const provider = model.provider;
  const modelId = model.model_id ?? modelName;
  const endpoint = model.endpoint ?? '';

  // 构建系统提示词（V3：轻编辑器 + 配置分发/静态集控；不再注入实例/校园资源上下文）
  const systemPrompt = '你是 CSES Cloud 智教云平台的 AI 助理。你的职责是帮助用户解答关于平台的各种问题。\n' +
    '平台功能包括：轻编辑器（云文件与配置实例管理）、配置分发、静态集控、数据空间、开发者中心、联盟账户等。\n' +
    '如果用户消息中包含「[编辑器上下文]」，请结合其中的当前文件与文件内容回答。\n' +
    '请用中文简洁、专业地回答用户问题。';

  // 构建消息列表
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: content });

  try {
    switch (provider) {
      case 'openai':
      case 'openai_compatible':
      case 'deepseek': {
        const url = endpoint || (provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');
        const resp = await aiHttpPost(url, {
          model: modelId,
          messages: messages,
          max_tokens: 2000,
          temperature: 0.7,
        }, [
          'Authorization: Bearer ' + apiKey,
          'Content-Type: application/json',
        ]);
        const json = jsonParseSafe(resp);
        if (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content !== undefined) {
          return String(json.choices[0].message.content).trim();
        }
        return null;
      }

      case 'anthropic': {
        // 提取 system 消息
        let systemMsg = '';
        const userMessages = [];
        for (const m of messages) {
          if (m.role === 'system') {
            systemMsg = m.content;
          } else {
            userMessages.push(m);
          }
        }
        const url = endpoint || 'https://api.anthropic.com/v1/messages';
        const requestBody = {
          model: modelId,
          max_tokens: 2000,
          messages: userMessages,
        };
        if (!phpEmpty(systemMsg)) {
          requestBody.system = systemMsg;
        }
        const resp = await aiHttpPost(url, requestBody, [
          'x-api-key: ' + apiKey,
          'anthropic-version: 2023-06-01',
          'Content-Type: application/json',
        ]);
        const json = jsonParseSafe(resp);
        const replyText = json?.content?.[0]?.text ?? null;
        if (replyText !== null) {
          return String(replyText).trim();
        }
        return null;
      }

      case 'google': {
        const url = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const contents = [];
        for (const m of messages) {
          contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
        }
        const resp = await aiHttpPost(url, { contents: contents }, ['Content-Type: application/json']);
        const json = jsonParseSafe(resp);
        if (json && json.candidates && json.candidates[0] && json.candidates[0].content
          && json.candidates[0].content.parts && json.candidates[0].content.parts[0]
          && json.candidates[0].content.parts[0].text !== undefined) {
          return String(json.candidates[0].content.parts[0].text).trim();
        }
        return null;
      }

      default:
        return null;
    }
  } catch (e) {
    return null;
  }
}

/**
 * 流式调用真实 AI 模型：上游 token 边收边透传到前端 SSE
 * @returns {Promise<string>} 完整回复内容（失败返回 ''，由主流程回退规则引擎）
 */
async function streamRealAI(modelName, content, history, ownerKey, sse) {
  // 确保 ai_models 表存在
  DB.pdo().exec(AI_MODELS_DDL);

  let model = DB.one('SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1', [ownerKey, modelName]);

  if (!model) {
    model = DB.one("SELECT * FROM ai_models WHERE owner_key = 'system' AND name = ? AND is_enabled = 1", [modelName]);
  }

  const builtinConfigs = {
    'gpt-4o': { provider: 'openai', model_id: 'gpt-4o' },
    'gpt-4o-mini': { provider: 'openai', model_id: 'gpt-4o-mini' },
    'claude-3-opus': { provider: 'anthropic', model_id: 'claude-3-opus-20240229' },
    'claude-3-sonnet': { provider: 'anthropic', model_id: 'claude-3-sonnet-20240229' },
    'gemini-pro': { provider: 'google', model_id: 'gemini-pro' },
    'deepseek-chat': { provider: 'openai_compatible', model_id: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
    'deepseek-reasoner': { provider: 'openai_compatible', model_id: 'deepseek-reasoner', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
  };

  if (!model) {
    if (Object.prototype.hasOwnProperty.call(builtinConfigs, modelName)) {
      model = { ...builtinConfigs[modelName] };
      model.api_key = '';
      if (phpEmpty(model.endpoint)) model.endpoint = '';
    } else {
      return '';
    }
  }

  const apiKey = model.api_key ?? '';
  if (process.env.AI_DEBUG) console.log('[ai-debug] streamRealAI model=%s keyLen=%d provider=%s', modelName, (apiKey ?? '').length, model?.provider ?? '-');
  if (phpEmpty(apiKey)) return '';

  const provider = model.provider;
  const modelId = model.model_id ?? modelName;
  const endpoint = model.endpoint ?? '';

  const systemPrompt = '你是 CSES Cloud 智教云平台的 AI 助理。你的职责是帮助用户解答关于平台的各种问题。\n' +
    '平台功能包括：轻编辑器（云文件与配置实例管理）、配置分发、静态集控、数据空间、开发者中心、联盟账户等。\n' +
    '如果用户消息中包含「[编辑器上下文]」，请结合其中的当前文件与文件内容回答。\n' +
    '请用中文简洁、专业地回答用户问题。';
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: content });

  let fullReply = '';

  try {
    if (provider === 'openai' || provider === 'openai_compatible' || provider === 'deepseek') {
      const url = endpoint || (provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions');

      const payload = JSON.stringify({
        model: modelId,
        messages: messages,
        max_tokens: 2000,
        temperature: 0.7,
        stream: true,
      });

      fullReply = await streamOpenAI(url, apiKey, payload, sse);
      return fullReply;
    }

    if (provider === 'anthropic') {
      let systemMsg = '';
      const userMessages = [];
      for (const m of messages) {
        if (m.role === 'system') systemMsg = m.content;
        else userMessages.push(m);
      }
      const url = endpoint || 'https://api.anthropic.com/v1/messages';
      const requestBody = { model: modelId, max_tokens: 2000, messages: userMessages, stream: true };
      if (!phpEmpty(systemMsg)) requestBody.system = systemMsg;

      fullReply = await streamAnthropic(url, apiKey, JSON.stringify(requestBody), sse);
      return fullReply;
    }

    // google 等不支持流式代理的 provider：非流式请求后快速分块输出
    fullReply = await callRealAI(modelName, content, history, ownerKey);
    if (fullReply) {
      await streamOutTypewriter(sse, fullReply, 5, 10);
    }
    return fullReply ?? '';
  } catch (e) {
    return fullReply; // 返回已累积内容（可能为空 → 主流程回退）
  }
}

/**
 * 流式调用 OpenAI/DeepSeek API：上游 SSE → 前端 SSE 透传
 * - 会话断连 / 120s 超时通过 AbortController 取消上游请求
 * - sse.write 背压会挂起上游读取，自适应慢客户端
 */
async function streamOpenAI(url, apiKey, payload, sse) {
  const link = linkedSignal(sse.signal, 120000);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: link.signal,
    });
  } catch (e) {
    link.dispose();
    // 客户端已断连：无需回退
    if (sse.closed) return '';
    // 连接失败：回退非流式请求后分块输出
    return streamFallback(url, apiKey, payload, 'openai', sse);
  }

  if (r.status >= 400) {
    link.dispose();
    if (sse.closed) return '';
    return streamFallback(url, apiKey, payload, 'openai', sse);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullReply = '';
  let stopped = false;

  const handleLine = async (rawLine) => {
    const line = rawLine.trim();
    if (line === '' || !line.startsWith('data: ')) return 'continue';

    const data = line.slice(6);
    if (data === '[DONE]') return 'break';

    const json = jsonParseSafe(data);
    if (!json) return 'continue';

    const delta = (((json.choices || [])[0] || {}).delta || {}).content ?? '';
    if (delta === '') return 'continue';

    fullReply += delta;
    // 透传 token（背压感知；断连返回 false 时停止读取）
    if (!(await sse.write({ token: delta }))) return 'break';
    return 'continue';
  };

  try {
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if ((await handleLine(line)) === 'break') { stopped = true; break; }
      }
    }
    if (!stopped && buf !== '') await handleLine(buf);
    if (stopped) {
      try { await reader.cancel(); } catch (_) { /* ignore */ }
    }
  } catch (e) {
    // 流中断（含 abort）：返回已累积内容
    try { await reader.cancel(); } catch (_) { /* ignore */ }
  } finally {
    link.dispose();
  }

  return fullReply;
}

/**
 * 回退：非流式请求后分块输出
 */
async function streamFallback(url, apiKey, payload, type, sse) {
  let responseText = null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: linkedSignal(sse.signal, 60000).signal,
    });
    responseText = await r.text();
  } catch (e) {
    return '';
  }
  if (responseText === null || sse.closed) return '';

  const json = jsonParseSafe(responseText);
  if (!json) return '';

  let fullReply = '';
  if (type === 'openai') {
    fullReply = (((json.choices || [])[0] || {}).message || {}).content ?? '';
  } else if (type === 'anthropic') {
    fullReply = ((json.content || [])[0] || {}).text ?? '';
  }

  if (fullReply === '') return '';

  // 分块输出（断连自动提前结束）
  await streamOutTypewriter(sse, fullReply, 3, 10);
  return fullReply;
}

/**
 * 流式调用 Anthropic API：上游 SSE → 前端 SSE 透传
 */
async function streamAnthropic(url, apiKey, payload, sse) {
  const link = linkedSignal(sse.signal, 120000);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: link.signal,
    });
  } catch (e) {
    link.dispose();
    if (sse.closed) return '';
    return streamFallback(url, apiKey, payload, 'anthropic', sse);
  }

  if (r.status >= 400) {
    link.dispose();
    if (sse.closed) return '';
    return streamFallback(url, apiKey, payload, 'anthropic', sse);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullReply = '';
  let stopped = false;

  const handleLine = async (rawLine) => {
    const line = rawLine.trim();
    if (line === '' || !line.startsWith('data: ')) return 'continue';

    const json = jsonParseSafe(line.slice(6));
    if (!json) return 'continue';

    if ((json.type ?? '') === 'content_block_delta') {
      const delta = (json.delta || {}).text ?? '';
      if (delta !== '') {
        fullReply += delta;
        if (!(await sse.write({ token: delta }))) return 'break';
      }
    }
    return 'continue';
  };

  try {
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if ((await handleLine(line)) === 'break') { stopped = true; break; }
      }
    }
    if (!stopped && buf !== '') await handleLine(buf);
    if (stopped) {
      try { await reader.cancel(); } catch (_) { /* ignore */ }
    }
  } catch (e) {
    try { await reader.cancel(); } catch (_) { /* ignore */ }
  } finally {
    link.dispose();
  }

  return fullReply;
}

/**
 * 发送 HTTP POST 请求（AI 调用专用）
 */
async function aiHttpPost(url, data, headers = []) {
  const hdrs = {};
  for (const h of headers) {
    const idx = h.indexOf(':');
    if (idx > 0) hdrs[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(data),
      signal: timeoutSignal(60000),
    });
  } catch (e) {
    throw new Error('请求失败：无法连接到 AI 服务');
  }
  const response = await resp.text();
  // 检查 HTTP 状态码
  if (resp.status >= 400) {
    throw new Error(`HTTP ${resp.status}: ` + response.slice(0, 200));
  }
  return response;
}

/**
 * Agent 工具调用循环（流式 ReAct 模式）
 * 每轮请求上游 stream:true：
 *  - content delta 实时透传给前端（真流式）
 *  - tool_calls delta 按 index 聚合成完整调用后本地执行，再进入下一轮
 * 客户端断连时通过会话信号中止上游请求，已累积内容照常入库
 */
async function runAgentLoop(modelName, content, history, ownerKey, editorContext, sessionId, sse) {
  // 提取用户实际问题
  let userQuestion = content;
  const qm = /\[用户问题\]\n(.+)$/s.exec(content);
  if (qm) {
    userQuestion = qm[1].trim();
  }

  // 获取模型配置
  let model = DB.one('SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1', [ownerKey, modelName]);
  if (!model) {
    model = DB.one("SELECT * FROM ai_models WHERE owner_key = 'system' AND name = ? AND is_enabled = 1", [modelName]);
  }
  if (!model) {
    const builtinConfigs = {
      'gpt-4o': { provider: 'openai', model_id: 'gpt-4o' },
      'deepseek-chat': { provider: 'openai_compatible', model_id: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
    };
    if (Object.prototype.hasOwnProperty.call(builtinConfigs, modelName)) {
      model = { ...builtinConfigs[modelName] };
      model.api_key = '';
    } else return '';
  }

  const apiKey = model.api_key ?? '';
  if (phpEmpty(apiKey)) return '';

  const provider = model.provider;
  const modelId = model.model_id ?? modelName;
  const endpoint = model.endpoint ?? '';

  // 构建系统提示词（含可用工具）
  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_editor_content',
        description: '获取当前编辑器中打开的文件内容。用于查看文件的完整代码或配置。',
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_editor_content',
        description: '修改编辑器中的文件内容。传入新的完整内容替换当前文件。',
        parameters: {
          type: 'object',
          properties: {
            new_content: { type: 'string', description: '新的完整文件内容' },
          },
          required: ['new_content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_in_content',
        description: '在当前编辑器文件中搜索指定文本，返回匹配行及其上下文。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '要搜索的文本' },
          },
          required: ['query'],
        },
      },
    },
  ];

  const systemPrompt = '你是 CSES Cloud 智教云平台的 AI 编程助理。你可以使用工具来读取和修改编辑器中的文件内容。\n\n' +
    `当前文件: ${editorContext.fileName}\n` +
    `语言: ${editorContext.language}\n\n` +
    '工作流程:\n' +
    '1. 先使用 get_editor_content 读取文件内容（如果需要）\n' +
    '2. 分析内容，做出修改\n' +
    '3. 使用 set_editor_content 写入修改后的内容\n' +
    '4. 每次操作后简要说明做了什么，并询问用户是否继续\n' +
    '5. 可以使用 search_in_content 搜索特定内容\n\n' +
    '重要规则:\n' +
    '- 每次修改后必须用简短语言告知用户改了什么\n' +
    '- 完成一个操作后询问「是否继续？」\n' +
    '- 保持代码修改精确，只改需要改的部分';

  // 构建消息列表
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    const role = h.role;
    if (role === 'assistant') {
      messages.push({ role: 'assistant', content: h.content });
    } else {
      messages.push({ role: 'user', content: h.content });
    }
  }
  messages.push({ role: 'user', content: userQuestion });

  // 确定 API URL（仅支持 OpenAI 兼容流式工具调用）
  let url;
  if (provider === 'openai' || provider === 'openai_compatible' || provider === 'deepseek') {
    url = endpoint || 'https://api.openai.com/v1/chat/completions';
  } else {
    // 其它 provider：回退非流式 Agent（复用 callRealAI 语义）
    return '';
  }

  // Agent 循环（最多 5 轮）
  const maxRounds = 5;
  let finalReply = '';

  for (let round = 0; round < maxRounds; round++) {
    if (sse.closed) break;

    const payload = JSON.stringify({
      model: modelId,
      messages: messages,
      tools: tools,
      tool_choice: 'auto',
      max_tokens: 2000,
      temperature: 0.7,
      stream: true,
    });

    // ── 流式请求本轮 ──
    const link = linkedSignal(sse.signal, 120000);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: link.signal,
      });
    } catch (e) {
      link.dispose();
      break; // 连接失败 / 客户端断连：结束循环（返回已累积内容）
    }
    if (r.status >= 400) {
      link.dispose();
      break;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let contentAcc = '';
    const toolCallsMap = new Map(); // delta.index → { id, type, function: { name, arguments } }
    let stopped = false;

    const handleLine = async (rawLine) => {
      const line = rawLine.trim();
      if (line === '' || !line.startsWith('data: ')) return 'continue';

      const data = line.slice(6);
      if (data === '[DONE]') return 'break';

      const json = jsonParseSafe(data);
      if (!json) return 'continue';

      const choice = (json.choices || [])[0] ?? null;
      if (!choice) return 'continue';

      const delta = choice.delta ?? {};

      // content delta：实时透传（真流式）
      if (typeof delta.content === 'string' && delta.content !== '') {
        contentAcc += delta.content;
        if (!(await sse.write({ token: delta.content }))) return 'break';
      }

      // tool_calls delta：按 index 聚合（id/name 首片到达，arguments 逐片拼接）
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolCallsMap.get(idx) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) cur.id = tc.id;
          if (tc.function) {
            if (tc.function.name) cur.function.name += tc.function.name;
            if (typeof tc.function.arguments === 'string') cur.function.arguments += tc.function.arguments;
          }
          toolCallsMap.set(idx, cur);
        }
      }

      return 'continue';
    };

    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if ((await handleLine(line)) === 'break') { stopped = true; break; }
        }
      }
      if (!stopped && buf !== '') await handleLine(buf);
      if (stopped) {
        try { await reader.cancel(); } catch (_) { /* ignore */ }
      }
    } catch (e) {
      try { await reader.cancel(); } catch (_) { /* ignore */ }
    } finally {
      link.dispose();
    }

    if (sse.closed) break;

    // ── 组装本轮 assistant 消息 ──
    const toolCalls = [...toolCallsMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v)
      .filter((v) => v.function.name !== '');

    const msg = { role: 'assistant', content: contentAcc !== '' ? contentAcc : null };

    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls;
      messages.push(msg);

      // 执行各工具调用
      for (const toolCall of toolCalls) {
        const fnName = toolCall.function.name;
        const fnArgs = jsonParseSafe(toolCall.function.arguments || '{}', null) || {};

        // 通知前端工具调用
        await sse.write({ tool_call: fnName, args: fnArgs });

        // 执行工具
        let toolResult = '';
        switch (fnName) {
          case 'get_editor_content':
            toolResult = editorContext.fileContent;
            break;
          case 'set_editor_content': {
            const newContent = fnArgs.new_content ?? '';
            editorContext.fileContent = newContent;
            // 通知前端应用编辑
            await sse.write({ apply_edit: newContent });
            toolResult = '文件已更新。新内容字符数: ' + mbStrlen(newContent);
            break;
          }
          case 'search_in_content': {
            const query = fnArgs.query ?? '';
            const lines = String(editorContext.fileContent).split('\n');
            const matches = [];
            for (let idx = 0; idx < lines.length; idx++) {
              const line = lines[idx];
              if (String(line).toLowerCase().indexOf(String(query).toLowerCase()) !== -1) {
                const start = Math.max(0, idx - 1);
                const end = Math.min(lines.length - 1, idx + 1);
                for (let j = start; j <= end; j++) {
                  matches.push((j + 1) + (j === idx ? '>' : ':') + ' ' + lines[j]);
                }
                matches.push('---');
              }
            }
            toolResult = phpEmpty(matches) ? `未找到匹配「${query}」的内容` : matches.slice(0, 30).join('\n');
            break;
          }
          default:
            toolResult = `未知工具: ${fnName}`;
        }

        // 添加工具结果到消息
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
      continue; // 继续循环，让 AI 处理工具结果
    }

    // 没有 tool_calls：本轮 content 即最终回复（已实时透传）
    messages.push(msg);
    finalReply = contentAcc;
    break;
  }

  if (phpEmpty(finalReply) && !sse.closed) {
    return ''; // 交由主流程回退规则引擎
  }
  return phpEmpty(finalReply) ? '' : finalReply;
}
