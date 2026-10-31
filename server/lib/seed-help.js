/**
 * 帮助中心内置文档初始化（幂等）
 *
 * 行为：
 *  - help_content 表已有任意一行（包括管理员编辑过的内容）时直接返回，绝不覆盖；
 *  - 表为空时，在一个事务中写入 server/lib/help-content.js 里的全部一级目录与二级文章；
 *  - 使用 nowStr() 生成 created_at / updated_at，与平台其它表的时间格式保持一致。
 *
 * 调用方：server/lib/db.js#ensureSchema()（已有库每次启动都会执行，安全可重复调用）。
 */
'use strict';

const helpContent = require('./help-content');
const { nowStr } = require('./response');

/**
 * 确保帮助中心有内置文档。
 * @param {import('node:sqlite').DatabaseSync} db node:sqlite 数据库句柄
 * @returns {{categories:number, articles:number, skipped:boolean, existing:number}}
 *          inserted: 本次插入的目录数 / 文章数；skipped=true 时两者均为 0。
 */
function ensureHelpContent(db) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM help_content').get();
  const existing = Number((row && row.total) || 0);
  if (existing > 0) {
    return { categories: 0, articles: 0, skipped: true, existing };
  }

  const now = nowStr();
  const insert = db.prepare(
    `INSERT INTO help_content
       (parent_id, title, content, summary, icon, sort_order, is_published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let categories = 0;
  let articles = 0;

  db.exec('BEGIN');
  try {
    for (const category of helpContent) {
      const info = insert.run(
        0,
        category.title,
        null,
        category.summary ?? '',
        category.icon ?? 'ri-article-line',
        Number(category.sort_order) || 0,
        1,
        now,
        now
      );
      const categoryId = Number(info.lastInsertRowid);
      categories += 1;

      for (const article of category.articles ?? []) {
        insert.run(
          categoryId,
          article.title,
          article.content ?? '',
          null,
          null,
          Number(article.sort_order) || 0,
          1,
          now,
          now
        );
        articles += 1;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      // 回滚失败时保留原始异常
    }
    throw err;
  }

  return { categories, articles, skipped: false, existing: 0 };
}

module.exports = { ensureHelpContent };
