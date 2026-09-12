-- =====================================================================
-- FreshFlow 迁移 #6 · inventory + description（T3.6 商品详情 / T3.3 轻量库存）
-- 内容：
--   1) goods 增加库存 stock_qty、预警阈值 stock_alert（description 列已由 20260911130000 侧窗迁移先行应用，此处去重）
--   2) 新表 inventory_log 库存流水（采购入库/发货出库/手工调整，全部留痕）
--   3) RLS：流水仅员工可见（店家商城不出现库存）
-- =====================================================================

ALTER TABLE goods ADD COLUMN IF NOT EXISTS stock_qty     NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE goods ADD COLUMN IF NOT EXISTS stock_alert   NUMERIC(12,3);

CREATE TABLE inventory_log (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenant(id),
    goods_id   BIGINT NOT NULL REFERENCES goods(id),
    delta      NUMERIC(12,3) NOT NULL,            -- 正=入库 负=出库
    reason     TEXT NOT NULL,                     -- purchase_in / ship_out / adjust
    ref_id     BIGINT,                            -- po_id 或 order_id
    note       TEXT,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invlog_goods ON inventory_log (tenant_id, goods_id, created_at DESC);

ALTER TABLE inventory_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_invlog_staff ON inventory_log FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = inventory_log.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = inventory_log.tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE inventory_log_id_seq TO authenticated;
