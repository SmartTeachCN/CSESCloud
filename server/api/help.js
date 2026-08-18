/**
 * 帮助中心（文档中心）公开读取 API
 *
 * 数据来源：help_content 表（parent_id=0 为一级目录，其余为二级文章）
 * 编辑由管理后台（admin/manage.js action=list-help 等）完成
 *
 * 操作：
 *  - GET action=tree   获取目录树（一级目录 + 二级文章元数据）
 *  - GET action=get    获取单篇内容（id 为文章 ID 或一级目录 ID）
 */
module.exports = async (ctx) => {
  const { req, DB, Auth, Response, query } = ctx;
  Auth.requireLogin();

  const method = req.method;
  const action = query.action ?? '';

  // ===== 获取目录树 =====
  if (method === 'GET' && action === 'tree') {
    const categories = DB.all(
      "SELECT * FROM help_content WHERE parent_id = 0 AND is_published = 1 ORDER BY sort_order ASC, id ASC"
    );
    const result = categories.map((cat) => {
      const articles = DB.all(
        "SELECT id, title, sort_order FROM help_content WHERE parent_id = ? AND is_published = 1 ORDER BY sort_order ASC, id ASC",
        [cat.id]
      );
      return {
        id: cat.id,
        title: cat.title,
        summary: cat.summary || '',
        icon: cat.icon || 'ri-article-line',
        article_count: articles.length,
        articles,
      };
    });
    Response.success(result);
  }

  // ===== 获取单篇内容 =====
  if (method === 'GET' && action === 'get') {
    const id = parseInt(query.id ?? 0, 10) || 0;
    if (!id) Response.error('缺少文档 ID');
    const row = DB.one('SELECT * FROM help_content WHERE id = ? AND is_published = 1', [id]);
    if (!row) Response.error('文档不存在或未发布');
    // 补充所属一级目录信息（面包屑用）
    let category = null;
    if (row.parent_id) {
      const cat = DB.one('SELECT id, title FROM help_content WHERE id = ?', [row.parent_id]);
      if (cat) category = { id: cat.id, title: cat.title };
    }
    Response.success({ ...row, category });
  }

  Response.error('未知操作');
};
