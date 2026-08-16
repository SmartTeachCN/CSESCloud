const db = require('better-sqlite3')('data/cses.db');
// 重新插入 mock 模型（模拟 models.php create 的字段）
const row = db.prepare("SELECT * FROM ai_models WHERE name = 'MockSlow'").get();
console.log('MockSlow 记录:', row ? JSON.stringify(row, null, 2) : '不存在');
// 模拟 streamRealAI 的查询
const q1 = db.prepare("SELECT * FROM ai_models WHERE owner_key = ? AND name = ? AND is_enabled = 1").get('alliance:admin', 'MockSlow');
console.log('streamRealAI 用户模型查询:', q1 ? '命中' : '未命中');
