/**
 * CSES Cloud - 初始演示数据（NodeJS 版，1:1 复刻 lib/seed.php）
 * 首次启动数据库时自动执行
 */
const bcrypt = require('bcryptjs');
const DB = require('./db');
const { nowStr, dateStr } = require('./response');

module.exports = function seed() {
  const now = nowStr();
  const pw = bcrypt.hashSync('123456', 10);

  // ===== 学校 =====
  const schools = [
    ['北京市第一实验小学', '北京实验', 'admin', '北京市西城区教育街 1 号', '010-66123456'],
    ['上海市阳光中学', '阳光中学', 'teacher01', '上海市徐汇区阳光路 88 号', '021-64123456'],
    ['深圳市南山外国语学校', '南山外语', 'admin', '深圳市南山区科技园南区', '0755-26123456'],
  ];
  const schoolIds = [];
  for (const s of schools) {
    schoolIds.push(DB.insert('schools', {
      name: s[0],
      short_name: s[1],
      admin_username: s[2],
      status: 'active',
      address: s[3],
      contact: s[4],
      created_at: now,
    }));
  }

  // ===== 用户 =====
  // 每所学校一个管理员 + 几个教师 + 学生
  const userTemplates = [
    ['admin', '系统管理员', 'admin', 'admin@school.edu'],
    ['teacher01', '王老师', 'teacher', 'wang@school.edu'],
    ['teacher02', '李老师', 'teacher', 'li@school.edu'],
    ['student01', '张同学', 'student', 'zhang@school.edu'],
  ];
  for (const schoolId of schoolIds) {
    for (const t of userTemplates) {
      DB.insert('users', {
        school_id: schoolId,
        username: t[0],
        password_hash: pw,
        display_name: t[1],
        role: t[2],
        email: t[3],
        phone: '1380000' + String(Math.floor(Math.random() * 10000)).padStart(4, '0'),
        status: 'active',
        created_at: now,
      });
    }
  }

  // ===== 班级 =====
  const grades = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
  const teachers = ['王老师', '李老师', '赵老师', '陈老师', '刘老师', '杨老师'];
  const classIds = [];
  for (const schoolId of schoolIds) {
    grades.forEach((g, i) => {
      const className = g + (1 + Math.floor(Math.random() * 5)) + '班';
      classIds.push(DB.insert('classes', {
        school_id: schoolId,
        name: className,
        grade: g,
        head_teacher: teachers[i],
        student_count: 30 + Math.floor(Math.random() * 21),
        status: 'active',
        created_at: now,
      }));
    });
  }

  // ===== 学生 =====
  const familyNames = ['张', '王', '李', '赵', '陈', '刘', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗'];
  const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  for (const classId of classIds) {
    // 找到对应学校
    const cls = DB.one('SELECT * FROM classes WHERE id = ?', [classId]);
    const count = 28 + Math.floor(Math.random() * 15);
    for (let i = 1; i <= count; i++) {
      const name = pick(familyNames) + pick(givenNames);
      DB.insert('students', {
        school_id: cls.school_id,
        class_id: classId,
        name,
        student_no: 'S' + String(classId).padStart(4, '0') + String(i).padStart(2, '0'),
        gender: Math.random() < 0.5 ? '男' : '女',
        status: 'active',
        created_at: now,
      });
    }
  }

  // ===== 服务 =====
  const serviceTemplates = [
    ['智慧课堂', 'teaching', 'v2.4.1', '/api/classroom', '面向课堂的智能教学服务'],
    ['在线作业', 'homework', 'v1.8.0', '/api/homework', '课后作业在线布置与批改'],
    ['数字图书馆', 'library', 'v3.0.2', '/api/library', '电子图书与资源借阅'],
    ['校园通知', 'notification', 'v1.2.5', '/api/notify', '校园通知与消息推送'],
    ['学生评价', 'assessment', 'v2.0.0', '/api/assessment', '学生综合评价管理'],
  ];
  for (const schoolId of schoolIds) {
    serviceTemplates.forEach((s, i) => {
      DB.insert('services', {
        school_id: schoolId,
        name: s[0],
        type: s[1],
        status: i % 5 === 4 ? 'maintenance' : 'running',
        version: s[2],
        endpoint: s[3],
        description: s[4],
        created_at: now,
      });
    });
  }

  // ===== 实例 =====
  const instanceTemplates = [
    ['MySQL 主库', 'mysql', 'running', '2 核', '4 GB', '100 GB', '99.9%', '10.0.0.21'],
    ['Redis 缓存', 'redis', 'running', '1 核', '2 GB', '20 GB', '99.9%', '10.0.0.22'],
    ['应用服务节点 #1', 'app', 'running', '4 核', '8 GB', '200 GB', '99.5%', '10.0.0.31'],
    ['应用服务节点 #2', 'app', 'running', '4 核', '8 GB', '200 GB', '99.5%', '10.0.0.32'],
    ['文件存储', 'storage', 'stopped', '2 核', '4 GB', '2 TB', '—', '10.0.0.41'],
    ['AI 推理服务', 'ai', 'running', '8 核', '16 GB', '500 GB', '99.0%', '10.0.0.51'],
  ];
  const allInstanceIds = [];
  for (const schoolId of schoolIds) {
    for (const t of instanceTemplates) {
      const iid = DB.insert('instances', {
        school_id: schoolId,
        name: t[0],
        service_type: t[1],
        status: t[2],
        cpu: t[3],
        memory: t[4],
        disk: t[5],
        uptime: t[6],
        ip: t[7],
        created_at: now,
      });
      allInstanceIds.push(iid);
    }
  }

  // ===== 开发者中心：示例应用（实例侧开发者创建） =====
  // 一个已发布的"智慧课堂云服务"应用 + 一个草稿状态的"作业评测"应用
  const sampleAppInfoManifest = JSON.stringify({
    name: '智慧课堂云服务',
    version: '1.0.0',
    description: '面向课堂的智能教学云服务，支持课程表、通知、学习任务等',
    category: '教学服务',
    author: 'admin',
    homepage: 'https://cses.cloud/apps/smart-classroom',
    icon: 'ri-graduation-cap-line',
    tags: ['课堂', '教学', 'K12'],
    // Ribbon 工具栏：编辑器顶部按钮组，点击后通过 postMessage 通知 iframe
    ribbon: [
      {
        label: '课程',
        tools: [
          { id: 'add_lesson', label: '添加课程', icon: 'ri-add-line', command: 'add_lesson' },
          { id: 'refresh', label: '刷新', icon: 'ri-refresh-line', command: 'refresh' },
        ],
      },
      {
        label: '通知',
        tools: [
          { id: 'add_notification', label: '发布通知', icon: 'ri-notification-3-line', command: 'add_notification' },
          { id: 'view_notifications', label: '通知列表', icon: 'ri-list-check', command: 'view_notifications' },
        ],
      },
      {
        label: '工具',
        tools: [
          { id: 'find', label: '查找', icon: 'ri-search-line', command: 'find' },
          { id: 'history', label: '历史', icon: 'ri-history-line', command: 'history' },
        ],
      },
    ],
  });

  const sampleEditorHtml = '<div class="smart-classroom-editor" style="padding:16px;font-family:\'Segoe UI\',sans-serif;">'
    + '<h3 style="margin:0 0 8px;color:#1a1a1a;">智慧课堂云服务</h3>'
    + '<p style="margin:0 0 16px;color:#666;font-size:13px;">实例：<span id="sc-instance-name"></span></p>'
    + '<div style="display:flex;gap:8px;margin-bottom:16px;">'
    + '<button id="sc-add-lesson-btn" style="padding:6px 12px;background:#0067C0;color:#fff;border:none;border-radius:4px;cursor:pointer;">+ 添加课程</button>'
    + '<button id="sc-refresh-btn" style="padding:6px 12px;background:#f0f0f0;color:#1a1a1a;border:1px solid #ddd;border-radius:4px;cursor:pointer;">刷新</button>'
    + '</div>'
    + '<h4 style="margin:0 0 8px;color:#1a1a1a;">课程列表</h4>'
    + '<div id="lessons" style="display:flex;flex-direction:column;gap:8px;"></div>'
    + '<div id="sc-empty" style="padding:24px;text-align:center;color:#999;">暂无课程</div>'
    + '</div>';

  const sampleEditorJs = String.raw`// 智慧课堂云服务编辑器 JS
// 通过平台注入的 window.CSES SDK 与平台通信（postMessage）
(function() {
  var instance = window.CSES && window.CSES.instance || {};
  var nameEl = document.getElementById("sc-instance-name");
  if (nameEl) nameEl.textContent = instance.name || instance.uid || "";
  var lessonsEl = document.getElementById("lessons");
  var emptyEl = document.getElementById("sc-empty");

  async function loadLessons() {
    if (!window.CSES || !window.CSES.listStorage) return;
    try {
      var rows = await window.CSES.listStorage("lessons");
      var list = rows || [];
      emptyEl.style.display = list.length === 0 ? "block" : "none";
      lessonsEl.innerHTML = list.map(function(r) {
        var d = r.data || r;
        var statusColor = d.status === "completed" ? "#107C10" : (d.status === "in_progress" ? "#CA8F04" : "#666");
        return "<div style=\"padding:8px 12px;border:1px solid #e0e0e0;border-radius:4px;\">"
          + "<div style=\"font-weight:600;color:#1a1a1a;\">" + (d.title || "未命名") + "</div>"
          + "<div style=\"font-size:12px;color:" + statusColor + ";margin-top:2px;\">" + (d.status || "pending") + "</div>"
          + "</div>";
      }).join("");
    } catch (e) {
      console.error("[smart-classroom] load failed:", e);
    }
  }

  async function addLesson() {
    var title = prompt("课程标题：");
    if (!title) return;
    try {
      await window.CSES.saveStorage("lessons", { title: title, status: "pending", duration: 40 });
      await loadLessons();
    } catch (e) { alert("保存失败: " + e.message); }
  }

  // 监听 Ribbon 工具点击
  window.addEventListener("message", function(e) {
    if (!e.data || !e.data.__ceseCommand) return;
    var cmd = e.data.__ceseCommand;
    if (cmd === "add_lesson") addLesson();
    else if (cmd === "refresh" || cmd === "view_notifications") loadLessons();
    else if (cmd === "add_notification") {
      var title = prompt("通知标题："); if (!title) return;
      var content = prompt("通知内容：");
      window.CSES.saveStorage("notifications", { title: title, content: content || "", is_urgent: false, publish_at: new Date().toISOString() }).then(loadLessons);
    }
  });

  document.getElementById("sc-add-lesson-btn").addEventListener("click", addLesson);
  document.getElementById("sc-refresh-btn").addEventListener("click", loadLessons);
  document.addEventListener("DOMContentLoaded", loadLessons);
  // 兜底立即加载一次
  setTimeout(loadLessons, 100);
})();`;

  const sampleStorageManifest = JSON.stringify({
    collections: [
      {
        key: 'lessons',
        name: '课程列表',
        description: '课堂关联的课程记录',
        fields: [
          { key: 'title', name: '课程标题', type: 'string', required: true, description: '课程的名称' },
          { key: 'status', name: '状态', type: 'string', required: false, default: 'pending', description: 'pending/in_progress/completed' },
          { key: 'duration', name: '时长（分钟）', type: 'number', required: false, default: 40 },
          { key: 'content', name: '课程内容', type: 'text', required: false },
          { key: 'resources', name: '资源链接', type: 'json', required: false },
        ],
      },
      {
        key: 'notifications',
        name: '通知列表',
        description: '课堂发布的通知',
        fields: [
          { key: 'title', name: '通知标题', type: 'string', required: true },
          { key: 'content', name: '通知内容', type: 'text', required: true },
          { key: 'is_urgent', name: '是否紧急', type: 'boolean', default: false },
          { key: 'publish_at', name: '发布时间', type: 'string' },
        ],
      },
    ],
  });

  const sampleInterfaceSchema = JSON.stringify({
    endpoints: [
      { method: 'GET', path: '/api/instance-storage.php?action=list', description: '查询实例存储数据', params: ['instance_id', 'collection_key', 'keyword'] },
      { method: 'POST', path: '/api/instance-storage.php?action=save', description: '保存/更新记录', params: ['instance_id', 'collection_key', 'record_id', 'data'] },
      { method: 'POST', path: '/api/instance-storage.php?action=delete', description: '删除记录', params: ['instance_id', 'collection_key', 'record_id'] },
    ],
  });

  const appId1 = DB.insert('apps', {
    developer_username: 'admin',
    app_key: 'smart_classroom_v1',
    name: '智慧课堂云服务',
    version: '1.0.0',
    description: '面向课堂的智能教学云服务',
    category: '教学服务',
    status: 'published',
    app_info_manifest: sampleAppInfoManifest,
    editor_html: sampleEditorHtml,
    editor_js: sampleEditorJs,
    storage_manifest: sampleStorageManifest,
    interface_schema: sampleInterfaceSchema,
    created_at: now,
    updated_at: now,
  });

  const appId2 = DB.insert('apps', {
    developer_username: 'admin',
    app_key: 'homework_eval_v1',
    name: '作业评测服务',
    version: '0.9.0',
    description: '课后作业自动评测与批改',
    category: '评测服务',
    status: 'draft',
    app_info_manifest: JSON.stringify({ name: '作业评测服务', version: '0.9.0', description: '课后作业自动评测与批改', category: '评测服务', author: 'admin', icon: 'ri-edit-line', tags: ['评测', '作业'] }),
    editor_html: '<div class="hw-editor"><h3>作业评测</h3><div id="hw-list"></div></div>',
    editor_js: '// 作业评测编辑器 JS（开发中）',
    storage_manifest: JSON.stringify({ collections: [
      { key: 'homeworks', name: '作业列表', description: '学生提交的作业', fields: [
        { key: 'student_name', name: '学生姓名', type: 'string', required: true },
        { key: 'score', name: '得分', type: 'number' },
        { key: 'submitted_at', name: '提交时间', type: 'string' },
        { key: 'content', name: '作答内容', type: 'text' },
      ] },
    ] }),
    interface_schema: JSON.stringify({ endpoints: [] }),
    created_at: now,
    updated_at: now,
  });

  // ===== 将 admin 的"智慧课堂云服务"标记为已共享，便于演示共享市场 =====
  DB.update('apps', { is_shared: 1 }, 'id = ?', [appId1]);

  // ===== 共享市场示例：由另一位开发者共享的"AI 智能推荐"应用 =====
  const sharedAiAppInfo = JSON.stringify({
    name: 'AI 学习路径推荐',
    version: '2.1.0',
    description: '基于学生学习数据的 AI 推荐服务，生成个性化学习路径',
    category: 'AI服务',
    author: 'dev_ai',
    icon: 'ri-brain-line',
    tags: ['AI', '推荐', '学习路径'],
    ribbon: [
      { label: 'AI', tools: [
        { id: 'recommend', label: '生成推荐', icon: 'ri-magic-line', command: 'recommend' },
        { id: 'history', label: '历史推荐', icon: 'ri-history-line', command: 'history' },
      ] },
    ],
  });

  const sharedAiStorage = JSON.stringify({
    collections: [
      { key: 'learning_paths', name: '学习路径', description: 'AI 生成的学习路径', fields: [
        { key: 'student_id', name: '学生ID', type: 'string', required: true },
        { key: 'subject', name: '科目', type: 'string', required: true },
        { key: 'recommendations', name: '推荐内容', type: 'json' },
        { key: 'confidence', name: '置信度', type: 'number', default: 0.8 },
        { key: 'generated_at', name: '生成时间', type: 'string' },
      ] },
      { key: 'feedback', name: '反馈记录', description: '学生对推荐的反馈', fields: [
        { key: 'path_id', name: '路径ID', type: 'string', required: true },
        { key: 'rating', name: '评分', type: 'number', default: 3 },
        { key: 'comment', name: '评语', type: 'text' },
      ] },
    ],
  });

  DB.insert('apps', {
    developer_username: 'dev_ai',
    app_key: 'ai_learning_path_v2',
    name: 'AI 学习路径推荐',
    version: '2.1.0',
    description: '基于学生学习数据的 AI 推荐服务，生成个性化学习路径',
    category: 'AI服务',
    status: 'published',
    is_shared: 1,
    app_info_manifest: sharedAiAppInfo,
    editor_html: '<div class="ai-recommend"><h3>AI 学习路径推荐</h3><div id="paths"></div><button onclick="window.AIRecommend.generate()">+ 生成新路径</button></div>',
    editor_js: '// AI 推荐编辑器 JS\nwindow.AIRecommend = {\n  async load() { const r = await window.CSES.listStorage("learning_paths"); console.log("paths:", r); },\n  async generate() { const sid = prompt("学生ID："); if(!sid) return; await window.CSES.saveStorage("learning_paths", { student_id: sid, subject: "数学", recommendations: [], confidence: 0.85, generated_at: new Date().toISOString() }); this.load(); }\n};\ndocument.addEventListener("DOMContentLoaded", () => window.AIRecommend.load());',
    storage_manifest: sharedAiStorage,
    interface_schema: JSON.stringify({ endpoints: [{ method: 'GET', path: '/api/instance-storage.php?action=list', description: '查询学习路径' }] }),
    created_at: now,
    updated_at: now,
  });

  // ===== 集控侧套餐示例（引用智慧课堂云服务） =====
  const samplePackageManifest = JSON.stringify({
    name: '智慧课堂综合集控',
    version: '1.0.0',
    description: '综合多个客户端实例，向教师提供统一化课堂服务',
    author: 'admin',
    target_audience: 'teacher',
    tags: ['课堂', '综合'],
    algorithm: '基于学生学习数据与课堂表现，综合计算个性化教学建议',
    data_flow: '采集 -> 清洗 -> 综合分析 -> 个性化推荐',
  });

  const sampleCallingInstances = JSON.stringify({
    instances: [
      { app_id: appId1, app_key: 'smart_classroom_v1', app_name: '智慧课堂云服务', alias: '主课堂', role: 'primary' },
      { app_id: appId2, app_key: 'homework_eval_v1', app_name: '作业评测服务', alias: '作业侧', role: 'secondary' },
    ],
  });

  const sampleVariableManifest = JSON.stringify({
    variables: [
      { key: 'school_term', name: '当前学期', type: 'string', default: '2026秋季', description: '当前学年学期' },
      { key: 'active_grade', name: '活跃年级', type: 'string', default: '三年级' },
      { key: 'enable_ai_recommend', name: '启用AI推荐', type: 'boolean', default: true, description: '是否启用综合算法的AI推荐' },
      { key: 'max_students_per_class', name: '每班最大学生数', type: 'number', default: 50 },
    ],
  });

  const pkgId1 = DB.insert('cc_packages', {
    developer_username: 'admin',
    package_key: 'smart_classroom_pkg_v1',
    name: '智慧课堂综合集控',
    version: '1.0.0',
    description: '综合多个客户端实例，向教师提供统一化课堂服务',
    status: 'published',
    package_manifest: samplePackageManifest,
    calling_instances_manifest: sampleCallingInstances,
    editor_html: '<div class="cc-pkg-editor"><h3>智慧课堂综合集控</h3><div id="cc-stats"></div><div id="cc-recommend"></div></div>',
    editor_js: '// 集控编辑器 JS\n// 平台注入 CCU_VARIABLES 与 CCU_ID 全局变量\nconsole.log("集控单元 ID:", CCU_ID, "变量:", CCU_VARIABLES);',
    variable_manifest: sampleVariableManifest,
    created_at: now,
    updated_at: now,
  });

  // ===== 将第一个实例关联到智慧课堂云服务应用，便于演示自动生成编辑器 =====
  if (allInstanceIds[0] !== undefined) {
    DB.update('instances', { app_id: appId1 }, 'id = ?', [allInstanceIds[0]]);
  }

  // ===== 示例：实例存储数据（用于演示平台自动生成编辑器） =====
  if (allInstanceIds[0] !== undefined) {
    const demoInstanceId = allInstanceIds[0];
    DB.insert('instance_storage_data', {
      instance_id: demoInstanceId,
      collection_key: 'lessons',
      record_id: 'r_demo_001',
      data: JSON.stringify({ title: '语文 - 第三单元 课文赏析', status: 'completed', duration: 40, content: '本节课重点讲解课文结构与中心思想', resources: ['视频', '课件'] }),
      created_at: now,
      updated_at: now,
    });
    DB.insert('instance_storage_data', {
      instance_id: demoInstanceId,
      collection_key: 'lessons',
      record_id: 'r_demo_002',
      data: JSON.stringify({ title: '数学 - 分数应用题', status: 'in_progress', duration: 45, content: '分数应用题的解题思路与练习' }),
      created_at: now,
      updated_at: now,
    });
    DB.insert('instance_storage_data', {
      instance_id: demoInstanceId,
      collection_key: 'notifications',
      record_id: 'r_demo_003',
      data: JSON.stringify({ title: '本周家长会通知', content: '请各位家长本周五下午 14:00 准时参加家长会', is_urgent: false, publish_at: '2026-07-25 09:00' }),
      created_at: now,
      updated_at: now,
    });

    // ===== 示例：云文件（关联到第一个实例，文件 ID 与实例 ID 分离） =====
    DB.insert('cloud_files', {
      instance_id: demoInstanceId,
      school_id: 1,
      name: '三年级课程表.html',
      content: '<h1>三年级(2)班课程表</h1><p>2026年秋季学期 · 第8周</p><table><thead><tr><th>时间</th><th>周一</th><th>周二</th></tr></thead><tbody><tr><td>第1节</td><td>语文</td><td>数学</td></tr></tbody></table>',
      file_type: 'html',
      status: 'synced',
      created_at: now,
      updated_at: now,
    });
    DB.insert('cloud_files', {
      instance_id: demoInstanceId,
      school_id: 1,
      name: '家长会通知.html',
      content: '<h1>家长会通知</h1><p>尊敬的家长：本周五下午 14:00 召开家长会，请准时出席。</p>',
      file_type: 'html',
      status: 'synced',
      created_at: now,
      updated_at: now,
    });

    // ===== 示例：校园集控单元（集控 ID 与实例 ID 分离） =====
    DB.insert('campus_control_units', {
      school_id: 1,
      instance_id: demoInstanceId,
      cc_package_id: pkgId1,
      name: '三年级综合集控',
      config: '{}',
      variables: JSON.stringify({ school_term: '2026秋季', active_grade: '三年级', enable_ai_recommend: true, max_students_per_class: 45 }),
      status: 'active',
      created_at: now,
    });
  }

  // ===== 通知 =====
  const notifTemplates = [
    ['system', '欢迎使用 CSES Cloud', '您的校园已成功接入 CSES Cloud 智教云平台，可开始使用各项服务。'],
    ['service', 'MySQL 实例已启动', 'MySQL 主库实例已成功启动并对外提供服务。'],
    ['security', '检测到异常登录', '检测到来自非工作时段的登录请求，已自动拦截。'],
    ['system', '系统维护通知', '系统将于本周日 02:00-04:00 进行例行维护，请提前保存工作。'],
    ['service', 'AI 推理服务升级', 'AI 推理服务已升级至 v2.1，新增智能推荐功能。'],
  ];
  for (const schoolId of schoolIds) {
    for (const n of notifTemplates) {
      DB.insert('notifications', {
        school_id: schoolId,
        type: n[0],
        title: n[1],
        content: n[2],
        is_read: 0,
        created_at: dateStr(new Date(Date.now() - (1 + Math.floor(Math.random() * 72)) * 3600e3)),
      });
    }
  }

  // ===== 审计日志 =====
  const actions = [
    ['login', '子用户登录', 'success'],
    ['create', '新增班级', 'success'],
    ['update', '修改服务配置', 'success'],
    ['start', '启动实例 MySQL 主库', 'success'],
    ['stop', '停止实例 文件存储', 'success'],
    ['delete', '删除子用户 student02', 'success'],
    ['export', '导出班级数据', 'success'],
    ['login', '登录失败（密码错误）', 'failed'],
    ['create', '新增学生', 'success'],
    ['update', '修改校园设置', 'success'],
  ];
  const usernamesPool = ['admin', 'teacher01', 'teacher02', '系统'];
  for (const schoolId of schoolIds) {
    for (let i = 0; i < 12; i++) {
      const a = pick(actions);
      DB.insert('audit_logs', {
        school_id: schoolId,
        user_id: 1 + Math.floor(Math.random() * 4),
        username: pick(usernamesPool),
        action: a[0],
        target: a[1],
        ip: '10.0.0.' + (2 + Math.floor(Math.random() * 253)),
        status: a[2],
        created_at: dateStr(new Date(Date.now() - (1 + Math.floor(Math.random() * 168)) * 3600e3)),
      });
    }
  }

  // ===== 数据导出记录 =====
  for (const schoolId of schoolIds) {
    DB.insert('data_exports', {
      school_id: schoolId,
      user_id: 1,
      type: '班级数据',
      format: 'csv',
      status: 'completed',
      file_path: `/exports/classes_${schoolId}.csv`,
      created_at: dateStr(new Date(Date.now() - 2 * 86400e3)),
    });
    DB.insert('data_exports', {
      school_id: schoolId,
      user_id: 1,
      type: '学生数据',
      format: 'excel',
      status: 'completed',
      file_path: `/exports/students_${schoolId}.xlsx`,
      created_at: dateStr(new Date(Date.now() - 5 * 86400e3)),
    });
  }
};
