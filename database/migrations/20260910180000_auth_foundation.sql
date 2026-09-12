-- =====================================================================
-- FreshFlow 迁移 #2 · auth_foundation（20260910180000）
-- 内容：CloudBase Auth uid 映射列 + 租户辅助函数 ff_actor() + 全表 RLS
-- 模型：admin_user/customer_user.uid = CloudBase Auth 用户 id；
--       员工(kind=admin)按租户全权；客户子账号(kind=customer)仅本租户+本公司数据
-- =====================================================================

-- 1) uid 列
ALTER TABLE admin_user    ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE customer_user ADD COLUMN IF NOT EXISTS uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_admin_user_uid    ON admin_user(uid)    WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_user_uid ON customer_user(uid) WHERE uid IS NOT NULL;

-- 2) 当前操作者（SECURITY DEFINER 防 RLS 递归）
CREATE OR REPLACE FUNCTION ff_actor()
RETURNS TABLE(kind TEXT, tenant_id BIGINT, role TEXT, customer_id BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'admin'::TEXT, a.tenant_id, a.role, NULL::BIGINT
    FROM admin_user a WHERE a.uid = auth.uid()
  UNION ALL
  SELECT 'customer'::TEXT, c.tenant_id, 'customer'::TEXT, c.customer_id
    FROM customer_user c WHERE c.uid = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION ff_actor() TO anon, authenticated;

-- 3) 授权（authenticated = 已登录用户；service_role/管理员绕过 RLS 不需 GRANT）
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant, admin_user, customer_user, goods_category, goods, customer,
  customer_address, customer_visible_category, price,
  order_main, order_item, sort_record, print_log, payment_ledger, op_log
  TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 4) 全表启用 RLS
ALTER TABLE tenant                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_user                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_user              ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_category             ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_address           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_visible_category  ENABLE ROW LEVEL SECURITY;
ALTER TABLE price                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_main                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sort_record                ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_log                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_ledger             ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_log                     ENABLE ROW LEVEL SECURITY;

-- 5) 策略：员工=本租户全权；客户子账号=本租户+本公司
CREATE POLICY p_tenant_read ON tenant FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.tenant_id = tenant.id));

CREATE POLICY p_admin_user_staff ON admin_user FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = admin_user.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = admin_user.tenant_id));
CREATE POLICY p_admin_user_self ON admin_user FOR SELECT
  USING (uid = auth.uid());

CREATE POLICY p_customer_user_staff ON customer_user FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer_user.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer_user.tenant_id));
CREATE POLICY p_customer_user_self ON customer_user FOR SELECT
  USING (uid = auth.uid());

CREATE POLICY p_goods_category_staff ON goods_category FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = goods_category.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = goods_category.tenant_id));
CREATE POLICY p_goods_category_cust ON goods_category FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.tenant_id = goods_category.tenant_id));

CREATE POLICY p_goods_staff ON goods FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = goods.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = goods.tenant_id));
CREATE POLICY p_goods_cust ON goods FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.tenant_id = goods.tenant_id AND goods.allow_mall));

CREATE POLICY p_customer_staff ON customer FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer.tenant_id));
CREATE POLICY p_customer_self ON customer FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.customer_id = customer.id));

CREATE POLICY p_address_staff ON customer_address FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer_address.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer_address.tenant_id));
CREATE POLICY p_address_self ON customer_address FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.customer_id = customer_address.customer_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.customer_id = customer_address.customer_id));

CREATE POLICY p_cvc_staff ON customer_visible_category FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer_visible_category.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = customer_visible_category.tenant_id));
CREATE POLICY p_cvc_cust ON customer_visible_category FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.customer_id = customer_visible_category.customer_id));

CREATE POLICY p_price_staff ON price FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = price.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = price.tenant_id));
CREATE POLICY p_price_cust ON price FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.tenant_id = price.tenant_id));

CREATE POLICY p_order_main_staff ON order_main FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = order_main.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = order_main.tenant_id));
CREATE POLICY p_order_main_self ON order_main FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.customer_id = order_main.customer_id));

CREATE POLICY p_order_item_staff ON order_item FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = order_item.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = order_item.tenant_id));
CREATE POLICY p_order_item_self ON order_item FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ff_actor() f
    JOIN order_main o ON o.id = order_item.order_id
    WHERE f.kind = 'customer' AND f.customer_id = o.customer_id));

CREATE POLICY p_sort_record_staff ON sort_record FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = sort_record.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = sort_record.tenant_id));

CREATE POLICY p_print_log_staff ON print_log FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = print_log.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = print_log.tenant_id));

CREATE POLICY p_ledger_staff ON payment_ledger FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = payment_ledger.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = payment_ledger.tenant_id));
CREATE POLICY p_ledger_self ON payment_ledger FOR SELECT
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'customer' AND f.customer_id = payment_ledger.customer_id));

CREATE POLICY p_op_log_staff ON op_log FOR ALL
  USING (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = op_log.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ff_actor() f WHERE f.kind = 'admin' AND f.tenant_id = op_log.tenant_id));
