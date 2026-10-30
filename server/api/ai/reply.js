/**
 * AI 助理 —— 规则引擎兜底回复
 *
 * 当用户没有配置任何可用模型（或上游调用失败）时，用平台知识库 + 关键词规则生成回复，
 * 保证「默认规则引擎」这一档始终可用。真实模型路径见 agent.js。
 */
const DB = require('../../lib/db');

/** PHP empty() 等价（'0' 视为空） */
function phpEmpty(v) {
  return v === undefined || v === null || v === '' || v === 0 || v === false
    || v === '0' || (Array.isArray(v) && v.length === 0);
}

/** mb_substr */
function mbSubstr(s, start, len) {
  return [...String(s ?? '')].slice(start, start + len).join('');
}

/** mb_strlen */
function mbStrlen(s) {
  return [...String(s ?? '')].length;
}

/** 确保知识库表存在 */
function ensureKb() {
  DB.pdo().exec(`CREATE TABLE IF NOT EXISTS ai_knowledge_base (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
}

/**
 * 规则引擎：基于关键词与用户上下文生成回复
 * V3：仅保留全局 scope；文件上下文由客户端以「[编辑器上下文]」片段随消息传入
 */
async function generateReply(content, history, user) {
  // 去除编辑器上下文片段，仅用用户问题做关键词匹配
  let question = String(content ?? '');
  const qm = /\[用户问题\]\s*\n?([\s\S]*)$/.exec(question);
  if (qm) question = qm[1];

  const text = question.toLowerCase();
  const displayName = (user && user.display_name) || '同学';

  // ===== 知识库搜索 =====
  ensureKb();
  const kbEntries = DB.all('SELECT title, content FROM ai_knowledge_base ORDER BY id ASC');
  let bestMatch = null;
  let bestScore = 0;
  for (const entry of kbEntries) {
    const kbTitle = String(entry.title).toLowerCase();
    const kbContent = String(entry.content).toLowerCase();
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
    return `你好，${displayName}！我是 CSES Cloud 的 AI 助理。你可以问我关于轻编辑器、配置分发、静态集控、开发者中心等问题，也可以让我直接帮你操作云文件与配置实例。`;
  }

  // ===== 帮助 / 功能 =====
  if (/(帮助|help|怎么用|使用说明|功能|能做什么|你能做什么)/u.test(text)) {
    return '我可以帮你：\n' +
      '1. 解答轻编辑器的问题（云文件编辑、配置实例管理、分发配置）\n' +
      '2. 解答静态集控的问题（ClassIsland 清单、数据源、接入方式）\n' +
      '3. 解答开发者中心问题（云应用、编辑器插件、共享市场）\n' +
      '4. 解答数据空间、登录与账户相关问题\n' +
      '5. 直接执行操作：新建/修改/重命名/删除云文件、创建与编辑配置实例、读取与操作当前编辑器、截图编辑器\n\n' +
      '请直接描述你的问题或需求。';
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
  return '我暂时无法理解你的问题。你可以尝试问我：\n- 如何使用轻编辑器？\n- 如何分发配置 / 接入 ClassIsland？\n- 如何使用开发者中心？\n- 平台是什么？\n\n或者在「模型」里配置一个真实模型，我就能直接帮你操作云文件与配置实例。';
}

module.exports = { generateReply, mbSubstr, mbStrlen, phpEmpty };
