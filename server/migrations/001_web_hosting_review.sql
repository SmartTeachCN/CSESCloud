-- 网页空间审查系统迁移
-- 为现有 web_hosting_spaces 和 web_hosting_files 表添加审查相关字段

-- web_hosting_spaces 添加字段
ALTER TABLE web_hosting_spaces ADD COLUMN review_status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE web_hosting_spaces ADD COLUMN disabled_by_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_hosting_spaces ADD COLUMN disabled_reason TEXT;

-- web_hosting_files 添加字段
ALTER TABLE web_hosting_files ADD COLUMN published_content BLOB;
ALTER TABLE web_hosting_files ADD COLUMN published_size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_hosting_files ADD COLUMN review_status TEXT NOT NULL DEFAULT 'published';

-- 初始化：将现有 content 同步到 published_content（标记为已公开）
UPDATE web_hosting_files SET published_content = content, published_size = file_size WHERE review_status = 'published';