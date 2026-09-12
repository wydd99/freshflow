-- =====================================================================
-- FreshFlow 迁移 #5 · purchase（T2.10/11 采购计划+采购中心）
-- 应用时间：2026-09-11（用户默认通过，表结构见 PLAN 评审记录）
-- 设计要点：
--   1) v1 不建供应商档案表，供应商信息用文本记在单据上（按供应商自动拆单待 T3）
--   2) need_qty 来自订单聚合（发货日期=计划日、非作废订单、按 商品+单位 汇总）
--   3) bought_qty/cost_price 到货时回填；cost_price 喂"最近采购价"参考与成本利润
--   4) 仅员工可见（店家商城不出现采购）；RLS 走 ff_actor() kind=admin
-- =====================================================================

CREATE TABLE purchase_order (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    po_no         TEXT NOT NULL,                  -- PO_yyyyMMdd+流水
    status        TEXT NOT NULL DEFAULT 'draft',  -- draft草单/ordered已下单(待到货)/partial部分到货/received已到货/void已作废
    plan_date     DATE NOT NULL,                  -- 采购计划日期（对应哪天的发货）
    delivery_date DATE,                           -- 预计到货日（合并自侧窗草稿）
    supplier_note TEXT,                           -- 供应商/市场备注（v1 文本，不建档案）
    remark        TEXT,
    created_by    BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, po_no)
);

CREATE TABLE purchase_order_item (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenant(id),
    po_id       BIGINT NOT NULL REFERENCES purchase_order(id),
    goods_id    BIGINT NOT NULL REFERENCES goods(id),
    goods_name  TEXT NOT NULL,                    -- 快照
    unit        TEXT NOT NULL,                    -- 快照
    need_qty    NUMERIC(12,3) NOT NULL,           -- 需采购量（订单聚合值）
    bought_qty  NUMERIC(12,3),                    -- 实际买到量（到货回填）
    cost_price  NUMERIC(12,2),                    -- 采购单价（到货回填→成本利润/最近价）
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending待到货/partial部分到货/done已到货
    remark      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_poi_po ON purchase_order_item (tenant_id, po_id);
CREATE INDEX idx_poi_goods ON purchase_order_item (tenant_id, goods_id);

-- RLS：仅员工（kind=admin）本租户可用；店家商城不出现采购
ALTER TABLE purchase_order      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_po_staff ON purchase_order FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = purchase_order.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = purchase_order.tenant_id));
CREATE POLICY p_poi_staff ON purchase_order_item FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = purchase_order_item.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = purchase_order_item.tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order, purchase_order_item TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE purchase_order_id_seq, purchase_order_item_id_seq TO authenticated;
