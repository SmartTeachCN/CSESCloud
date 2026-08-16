<?php
/**
 * 更新 EA2 应用编辑器 HTML/CSS — 添加深色模式支持
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$app = DB::one("SELECT id, editor_html, editor_js FROM apps WHERE app_key = 'examaware2'");
if (!$app) { echo "未找到 EA2 应用\n"; exit(1); }

// ===== 更新后的编辑器 HTML（支持深色模式） =====
$editorHtml = <<<'HTML'
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
:root {
  --ea2-bg: #f5f5f5;
  --ea2-surface: #fff;
  --ea2-border: #e0e0e0;
  --ea2-text: #1a1a1a;
  --ea2-text-secondary: #555;
  --ea2-text-tertiary: #888;
  --ea2-text-muted: #999;
  --ea2-accent: #0067C0;
  --ea2-accent-hover: #005aaf;
  --ea2-accent-bg: #f0f7ff;
  --ea2-input-bg: #fff;
  --ea2-input-border: #ddd;
  --ea2-input-focus: #0067C0;
  --ea2-btn-bg: #f0f0f0;
  --ea2-btn-hover: #e5e5e5;
  --ea2-btn-text: #333;
  --ea2-modal-overlay: rgba(0,0,0,.4);
  --ea2-shadow: rgba(0,0,0,.08);
  --ea2-code-bg: #f0f0f0;
  --ea2-danger: #c42b1c;
  --ea2-danger-bg: #fef0f0;
  --ea2-spinner-track: #e0e0e0;
  --ea2-btn-icon-hover: #f0f0f0;
  --ea2-modal-close-hover: #f0f0f0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ea2-bg: #1e1e1e;
    --ea2-surface: #2d2d2d;
    --ea2-border: #3c3c3c;
    --ea2-text: #d4d4d4;
    --ea2-text-secondary: #aaa;
    --ea2-text-tertiary: #888;
    --ea2-text-muted: #777;
    --ea2-accent: #4da3e0;
    --ea2-accent-hover: #3d93d0;
    --ea2-accent-bg: #1a2d3d;
    --ea2-input-bg: #3c3c3c;
    --ea2-input-border: #555;
    --ea2-input-focus: #4da3e0;
    --ea2-btn-bg: #3c3c3c;
    --ea2-btn-hover: #4a4a4a;
    --ea2-btn-text: #d4d4d4;
    --ea2-modal-overlay: rgba(0,0,0,.6);
    --ea2-shadow: rgba(0,0,0,.3);
    --ea2-code-bg: #3c3c3c;
    --ea2-danger: #e06c75;
    --ea2-danger-bg: #3d2020;
    --ea2-spinner-track: #444;
    --ea2-btn-icon-hover: #3c3c3c;
    --ea2-modal-close-hover: #3c3c3c;
  }
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:13px;background:var(--ea2-bg);color:var(--ea2-text);overflow:hidden}
.ea2-app{height:100%;display:flex;flex-direction:column}
.ea2-app-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--ea2-text-tertiary);gap:12px}
.ea2-spinner{width:24px;height:24px;border:3px solid var(--ea2-spinner-track);border-top-color:var(--ea2-accent);border-radius:50%;animation:ea2spin .8s linear infinite}
@keyframes ea2spin{to{transform:rotate(360deg)}}
.ea2-app-content{flex:1;overflow:auto}
.ea2-page{padding:20px}
.ea2-page-header{margin-bottom:20px}
.ea2-page-header h2{margin:0 0 8px;font-size:20px;font-weight:600}
.ea2-page-header p{margin:0;color:var(--ea2-text-secondary);font-size:13px}
.ea2-card{background:var(--ea2-surface);border:1px solid var(--ea2-border);border-radius:8px;padding:16px 20px;margin-bottom:16px}
.ea2-card-title{font-size:14px;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--ea2-border)}
.ea2-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ea2-info-item{display:flex;flex-direction:column;gap:4px}
.ea2-info-item label{font-size:11px;color:var(--ea2-text-tertiary)}
.ea2-info-item code{font-size:12px;background:var(--ea2-code-bg);padding:4px 8px;border-radius:4px;font-family:monospace;color:var(--ea2-text)}
.ea2-guide{margin:0;padding-left:20px;color:var(--ea2-text-secondary);line-height:2}
.ea2-guide code{background:var(--ea2-code-bg);padding:1px 6px;border-radius:3px;font-size:12px}
.ea2-exam-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.ea2-exam-search input{padding:8px 12px;border:1px solid var(--ea2-input-border);border-radius:6px;font-size:13px;width:260px;outline:none;background:var(--ea2-input-bg);color:var(--ea2-text)}
.ea2-exam-search input:focus{border-color:var(--ea2-input-focus)}
.ea2-exam-stats{font-size:12px;color:var(--ea2-text-tertiary);margin-left:auto}
.ea2-exam-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.ea2-exam-empty{grid-column:1/-1;text-align:center;padding:40px;color:var(--ea2-text-muted);font-size:14px}
.ea2-exam-card{background:var(--ea2-surface);border:1px solid var(--ea2-border);border-radius:8px;padding:14px 16px;cursor:pointer;transition:box-shadow .15s,border-color .15s}
.ea2-exam-card:hover{box-shadow:0 2px 8px var(--ea2-shadow);border-color:var(--ea2-text-tertiary)}
.ea2-exam-card.selected{border-color:var(--ea2-accent);background:var(--ea2-accent-bg)}
.ea2-exam-card-header{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.ea2-exam-check{font-size:16px;color:var(--ea2-accent);width:20px;text-align:center}
.ea2-exam-name{font-size:15px;font-weight:600;flex:1}
.ea2-exam-card-actions{display:flex;gap:4px;flex-shrink:0}
.ea2-btn-icon{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;font-size:14px;color:var(--ea2-text-tertiary)}
.ea2-btn-icon:hover{background:var(--ea2-btn-icon-hover);color:var(--ea2-text)}
.ea2-btn-icon.danger:hover{color:var(--ea2-danger);background:var(--ea2-danger-bg)}
.ea2-exam-card-body{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ea2-exam-time{font-size:12px;color:var(--ea2-text-secondary)}
.ea2-exam-meta{font-size:12px;color:var(--ea2-text-tertiary)}
.ea2-exam-msg{font-size:11px;color:var(--ea2-text-muted);grid-column:1/-1;margin-top:4px}
.ea2-label{font-size:10px;color:var(--ea2-text-muted);margin-right:4px;text-transform:uppercase}
.ea2-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.ea2-field label{font-size:12px;font-weight:500;color:var(--ea2-text-secondary)}
.ea2-field .ea2-req{color:var(--ea2-danger)}
.ea2-field input,.ea2-field select{padding:8px 10px;border:1px solid var(--ea2-input-border);border-radius:6px;font-size:13px;outline:none;font-family:inherit;background:var(--ea2-input-bg);color:var(--ea2-text)}
.ea2-field input:focus,.ea2-field select:focus{border-color:var(--ea2-input-focus)}
.ea2-field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ea2-btn{display:inline-flex;align-items:center;padding:6px 16px;background:var(--ea2-btn-bg);color:var(--ea2-btn-text);border:1px solid var(--ea2-input-border);border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit}
.ea2-btn:hover{background:var(--ea2-btn-hover)}
.ea2-btn.primary{background:var(--ea2-accent);color:#fff;border-color:var(--ea2-accent)}
.ea2-btn.primary:hover{background:var(--ea2-accent-hover)}
.ea2-modal-overlay{position:fixed;inset:0;background:var(--ea2-modal-overlay);display:flex;align-items:center;justify-content:center;z-index:100}
.ea2-modal{width:480px;max-width:92vw;background:var(--ea2-surface);border-radius:10px;box-shadow:0 16px 48px var(--ea2-shadow);overflow:hidden}
.ea2-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--ea2-border)}
.ea2-modal-header h3{margin:0;font-size:16px}
.ea2-modal-close{width:28px;height:28px;background:transparent;border:none;font-size:18px;color:var(--ea2-text-tertiary);cursor:pointer;border-radius:4px}
.ea2-modal-close:hover{background:var(--ea2-modal-close-hover)}
.ea2-modal-body{padding:20px}
.ea2-modal-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--ea2-border)}
</style></head><body><div class="ea2-app">  <div class="ea2-app-loading" id="ea2Loading">
    <div class="ea2-spinner"></div>
    <span>加载中...</span>
  </div>
  <div class="ea2-app-content" id="ea2Content" style="display:none">
    <!-- 连接应用页面 -->
    <div class="ea2-page" id="ea2PageConnect" style="display:none">
      <div class="ea2-page-header">
        <h2>连接应用</h2>
        <p>将 ExamAware2 客户端连接到本实例，实现考试配置下发与状态同步。</p>
      </div>
      <div class="ea2-card">
        <div class="ea2-card-title">实例信息</div>
        <div class="ea2-info-grid">
          <div class="ea2-info-item"><label>实例 UID</label><code id="ea2InstUid">—</code></div>
          <div class="ea2-info-item"><label>实例名称</label><span id="ea2InstName">—</span></div>
          <div class="ea2-info-item"><label>API 地址</label><code id="ea2ApiUrl">—</code></div>
        </div>
      </div>
      <div class="ea2-card">
        <div class="ea2-card-title">接入指引</div>
        <ol class="ea2-guide">
          <li>在 ExamAware2 桌面端，打开「设置」→「控制」</li>
          <li>输入上述 API 地址作为控制服务器地址</li>
          <li>点击「连接」完成绑定</li>
          <li>连接成功后，考试配置将自动同步到客户端</li>
        </ol>
      </div>
    </div>

    <!-- 考试管理页面 -->
    <div class="ea2-page" id="ea2PageExams" style="display:none">
      <div class="ea2-exam-toolbar">
        <div class="ea2-exam-search">
          <input type="text" id="ea2ExamSearch" placeholder="搜索考试..." oninput="renderExamList()" />
        </div>
        <div class="ea2-exam-stats" id="ea2ExamStats">0 场考试</div>
      </div>
      <div class="ea2-exam-grid" id="ea2ExamGrid">
        <div class="ea2-exam-empty">暂无考试，点击 Ribbon「新建考试」创建</div>
      </div>
    </div>

    <!-- 应用配置页面 -->
    <div class="ea2-page" id="ea2PageConfig" style="display:none">
      <div class="ea2-page-header">
        <h2>应用配置</h2>
        <p>管理 EA2 实例的全局设置。</p>
      </div>
      <div class="ea2-card">
        <div class="ea2-card-title">基本设置</div>
        <div class="ea2-field">
          <label>学校名称</label>
          <input type="text" id="ea2CfgSchoolName" placeholder="学校名称" onchange="saveConfigField('schoolName', this.value)" />
        </div>
        <div class="ea2-field">
          <label>最大考试时长（分钟）</label>
          <input type="number" id="ea2CfgMaxDuration" placeholder="180" min="10" max="600" onchange="saveConfigField('maxExamDuration', parseInt(this.value)||180)" />
        </div>
      </div>
    </div>
  </div>

  <!-- 新建/编辑考试对话框 -->
  <div class="ea2-modal-overlay" id="ea2NewExamModal" style="display:none" onclick="if(event.target===this)closeNewExamModal()">
    <div class="ea2-modal" onclick="event.stopPropagation()">
      <div class="ea2-modal-header">
        <h3>新建考试</h3>
        <button class="ea2-modal-close" onclick="closeNewExamModal()">×</button>
      </div>
      <div class="ea2-modal-body">
        <div class="ea2-field"><label>考试名称 <span class="ea2-req">*</span></label><input type="text" id="ea2NewExamName" placeholder="例如：2026秋季期末考试" /></div>
        <div class="ea2-field"><label>提示信息</label><input type="text" id="ea2NewExamMsg" placeholder="考试提示信息" /></div>
        <div class="ea2-field-row">
          <div class="ea2-field"><label>开始时间 <span class="ea2-req">*</span></label><input type="datetime-local" id="ea2NewExamStart" /></div>
          <div class="ea2-field"><label>结束时间 <span class="ea2-req">*</span></label><input type="datetime-local" id="ea2NewExamEnd" /></div>
        </div>
        <div class="ea2-field"><label>提前提醒（分钟）</label><input type="number" id="ea2NewExamAlert" value="5" min="0" /></div>
      </div>
      <div class="ea2-modal-footer">
        <button class="ea2-btn" onclick="closeNewExamModal()">取消</button>
        <button class="ea2-btn primary" onclick="createExam()">创建</button>
      </div>
    </div>
  </div></div></body></html>
HTML;

// ===== 编辑器 JS（保持不变，但确保函数声明正常） =====
$editorJs = $app['editor_js'];

DB::update('apps', [
    'editor_html' => $editorHtml,
    'updated_at' => date('Y-m-d H:i:s'),
], 'id = ?', [$app['id']]);

echo "EA2 编辑器已更新（深色模式支持）\n";
echo "  HTML 长度: " . strlen($editorHtml) . " bytes\n";
echo "  JS 长度: " . strlen($editorJs) . " bytes\n";