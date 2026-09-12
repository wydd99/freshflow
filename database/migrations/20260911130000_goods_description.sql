-- =====================================================================
-- FreshFlow 迁移 #6 · goods_description（T3.6 商品详情页）
-- goods 增加 description 图文介绍字段（商城/小程序点商品看详情）
-- =====================================================================

ALTER TABLE goods ADD COLUMN IF NOT EXISTS description TEXT;
