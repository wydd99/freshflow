-- =====================================================================
-- FreshFlow · PostgreSQL 数据模型 v1（T0.2）
-- 设计原则：
--   1) 原生多租户：所有业务表带 tenant_id（首发仅 1 行租户=商家A；卖同行时加租户即用）
--   2) 金额 numeric(12,2)，数量 numeric(12,3)（斤保留 2 位、公斤兼容 3 位）
--   3) 快照原则：订单明细冗余商品名/单位，商品改档不影响历史单
--   4) 留痕原则：改单写 edit_log，分拣/打印/往来全流水
-- 字符集默认 UTF8；时间统一 timestamptz
-- =====================================================================

-- ---------- 租户与账号 ----------
CREATE TABLE tenant (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL,                 -- 租户名（企业名）
    system_name   TEXT,                          -- 后台系统显示名（白牌）
    mall_name     TEXT,                          -- 商城显示名（白牌，如"原先达集采助手"式）
    logo_url      TEXT,
    theme         JSONB DEFAULT '{}'::jsonb,     -- 主题色等
    status        TEXT NOT NULL DEFAULT 'active',-- active/disabled
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_user (                          -- 后台员工账号
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator', -- boss/manager/operator
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, username)
);

CREATE TABLE customer_user (                       -- 客户子账号（商城登录）
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    customer_id   BIGINT NOT NULL,               -- → customer.id
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    phone         TEXT,
    can_export    BOOLEAN NOT NULL DEFAULT false,-- 需求#9：后台导出权限（前台商城永不可导出）
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, username)
);

-- ---------- 商品 ----------
CREATE TABLE goods_category (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenant(id),
    name       TEXT NOT NULL,
    sort       INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE goods (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id      BIGINT NOT NULL REFERENCES tenant(id),
    code           TEXT NOT NULL,                 -- 商品编码（唯一，识别匹配备用键）
    name           TEXT NOT NULL,
    alias          TEXT[] DEFAULT '{}',           -- 别名（手写单识别匹配用，需求#12）
    category_id    BIGINT REFERENCES goods_category(id),
    unit           TEXT NOT NULL DEFAULT '斤',    -- 计量单位（斤/份/瓶/包…）
    weigh_type     TEXT NOT NULL DEFAULT 'weight',-- none=无需称重(标品,打N张贴纸) / weight=按重分拣
    barcode        TEXT,
    spec           TEXT,                          -- 规格描述（如"±2斤"“2斤/袋”）
    description    TEXT,                          -- 商品图文介绍（商城/小程序详情页，T3.6）
    image_url      TEXT,                          -- 分拣屏有图有字（需求#13）
    base_price     NUMERIC(12,2) NOT NULL DEFAULT 0, -- 基准价（原价「原」，报价链兜底）
    allow_mall     BOOLEAN NOT NULL DEFAULT true, -- 商城是否可见
    status         TEXT NOT NULL DEFAULT 'active',-- active/disabled
    remark         TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX idx_goods_tenant_name ON goods (tenant_id, name);
CREATE INDEX idx_goods_tenant_alias ON goods USING gin (alias);

-- ---------- 客户 ----------
CREATE TABLE customer (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       BIGINT NOT NULL REFERENCES tenant(id),
    name            TEXT NOT NULL,                -- 客户公司（客户甲/山大员工餐…）
    level           TEXT NOT NULL DEFAULT 'default', -- 客户等级（default/A/B/C，一客一价的"类型价"维度）
    settlement_type TEXT NOT NULL DEFAULT 'daily',   -- daily=当日结 / monthly=月结 / cod=货到付款
    settlement_day  INT,                          -- 月结日（monthly 时 1-31）
    credit_limit    NUMERIC(12,2),                -- 欠款上限（null=不限；需求#7）
    overdue_days    INT NOT NULL DEFAULT 30,      -- 超期天数：超 N 天未结 → 禁下单（需求#7）
    visible_all     BOOLEAN NOT NULL DEFAULT true,-- false=仅可见 visible_category 内分类（需求#6）
    status          TEXT NOT NULL DEFAULT 'active',
    remark          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE customer_address (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenant(id),
    customer_id BIGINT NOT NULL REFERENCES customer(id),
    contact    TEXT,
    phone      TEXT,
    address    TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE customer_visible_category (           -- visible_all=false 时生效
    tenant_id   BIGINT NOT NULL REFERENCES tenant(id),
    customer_id BIGINT NOT NULL REFERENCES customer(id),
    category_id BIGINT NOT NULL REFERENCES goods_category(id),
    PRIMARY KEY (customer_id, category_id)
);

-- ---------- 报价（一客一价，需求#6）----------
-- 取价链：customer 专属最新一条 → level 类型价最新一条 → goods.base_price
-- 价源标签：customer=「客」/ level=「型」/ base=「原」/ 历史价=「历」
CREATE TABLE price (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    goods_id      BIGINT NOT NULL REFERENCES goods(id),
    scope         TEXT NOT NULL,                  -- type=按客户等级 / customer=客户专属
    scope_value   TEXT NOT NULL,                  -- scope=type → 等级值；scope=customer → customer_id 字符串
    price         NUMERIC(12,2) NOT NULL,
    valid_from    DATE NOT NULL DEFAULT CURRENT_DATE, -- 同键多行=价格历史（「历」来源）
    created_by    BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, goods_id, scope, scope_value, valid_from)
);
CREATE INDEX idx_price_lookup ON price (tenant_id, goods_id, scope, scope_value, valid_from DESC);

-- ---------- 订单 ----------
CREATE TABLE order_main (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       BIGINT NOT NULL REFERENCES tenant(id),
    order_no        TEXT NOT NULL,                -- OR_yyyyMMdd + 4位流水
    customer_id     BIGINT NOT NULL REFERENCES customer(id),
    customer_user_id BIGINT REFERENCES customer_user(id), -- 商城下单人（代录为空）
    source          TEXT NOT NULL DEFAULT 'manual', -- mall/manual/voice/photo/excel/text（需求#2）
    delivery_date   DATE NOT NULL,                -- 发货日期
    time_slot       TEXT,                         -- 发货时段
    status          TEXT NOT NULL DEFAULT 'draft',-- 见 docs/STATE_AND_AMOUNT.md 状态机
    address_snapshot TEXT,
    -- 金额五卡（口径见 T0.3 文档）
    amount_original NUMERIC(12,2) NOT NULL DEFAULT 0, -- 订单金额=Σ下单量×下单价
    amount_configured NUMERIC(12,2) NOT NULL DEFAULT 0,-- 配货金额=Σ实拣量×实拣价
    amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0, -- 实付
    amount_aftersale NUMERIC(12,2) NOT NULL DEFAULT 0,-- 售后（作废/退货行）
    deposit         NUMERIC(12,2) NOT NULL DEFAULT 0, -- 押金
    freight         NUMERIC(12,2) NOT NULL DEFAULT 0, -- 运费
    service_fee     NUMERIC(12,2) NOT NULL DEFAULT 0, -- 服务费
    sort_done       INT NOT NULL DEFAULT 0,       -- 分拣进度 done/total
    sort_total      INT NOT NULL DEFAULT 0,
    print_count     INT NOT NULL DEFAULT 0,       -- 补打计数（需求#14）
    locked_reason   TEXT,                         -- 账期锁单原因（需求#7）
    remark          TEXT,
    created_by      BIGINT,                       -- admin_user.id（代录人）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, order_no)
);
CREATE INDEX idx_order_query ON order_main (tenant_id, delivery_date DESC, status);
CREATE INDEX idx_order_customer ON order_main (tenant_id, customer_id, delivery_date DESC);

CREATE TABLE order_item (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    order_id      BIGINT NOT NULL REFERENCES order_main(id),
    goods_id      BIGINT NOT NULL REFERENCES goods(id),
    goods_name    TEXT NOT NULL,                  -- 快照
    unit          TEXT NOT NULL,                  -- 快照
    order_qty     NUMERIC(12,3) NOT NULL,         -- 下单数量（草稿单用这个）
    order_price   NUMERIC(12,2) NOT NULL,         -- 下单价（下单时快照）
    price_source  TEXT NOT NULL DEFAULT 'base',   -- customer/level/base/history（价源标签）
    sorted_qty    NUMERIC(12,3),                  -- 实拣数量（改重后，需求#3/#18）
    sorted_price  NUMERIC(12,2),                  -- 实拣价（默认=order_price，可改）
    adjust_note   TEXT,                           -- 多退少补说明（需求#8）
    amount        NUMERIC(12,2) NOT NULL DEFAULT 0, -- 金额=sorted_qty×sorted_price（未分拣=order_qty×order_price）
    tax_rate      NUMERIC(6,4) NOT NULL DEFAULT 0, -- 税率预留（含税额=amount×(1+rate)）
    status        TEXT NOT NULL DEFAULT 'pending',-- pending待分拣/sorted已分拣/short缺货/void作废
    sort_time     TIMESTAMPTZ,                    -- 到秒（可追溯）
    sorted_by     BIGINT,
    edit_log      JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{f,o,n,by,at}] 改单留痕（需求#8）
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_order ON order_item (tenant_id, order_id);
CREATE INDEX idx_item_goods ON order_item (tenant_id, goods_id, order_id);

CREATE TABLE sort_record (                         -- 分拣流水（撤销/补签审计）
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenant(id),
    order_item_id BIGINT NOT NULL REFERENCES order_item(id),
    method      TEXT NOT NULL,                    -- scale=称重/input=输入/accumulate=累加/short=缺货
    qty         NUMERIC(12,3) NOT NULL,
    created_by  BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sort_time ON sort_record (tenant_id, created_at);

-- ---------- 打印 ----------
CREATE TABLE print_log (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenant(id),
    order_id   BIGINT NOT NULL REFERENCES order_main(id),
    template   TEXT NOT NULL,                     -- peihuo_a4/chuku_a4/receipt58/receipt80/label
    copies     INT NOT NULL DEFAULT 1,
    reprint_of BIGINT REFERENCES print_log(id),   -- 补打链（需求#14）
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 往来账（账期锁单依据，需求#7）----------
CREATE TABLE payment_ledger (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenant(id),
    customer_id   BIGINT NOT NULL REFERENCES customer(id),
    order_id      BIGINT REFERENCES order_main(id),
    direction     TEXT NOT NULL,                  -- receivable=应收(发货挂账) / received=实收
    amount        NUMERIC(12,2) NOT NULL,
    biz_type      TEXT NOT NULL DEFAULT 'order',  -- order/payment/adjust
    balance_after NUMERIC(12,2),                  -- 该客户欠款余额快照（冗余，锁单免聚合）
    created_by    BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_customer ON payment_ledger (tenant_id, customer_id, created_at DESC);

-- ---------- 操作日志 ----------
CREATE TABLE op_log (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenant(id),
    actor_type TEXT NOT NULL,                     -- admin/customer_user/system
    actor_id   BIGINT,
    action     TEXT NOT NULL,                     -- login/create/update/void/print/export/lock_check…
    entity     TEXT,
    entity_id  BIGINT,
    detail     JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oplog_entity ON op_log (tenant_id, entity, entity_id);

-- ---------- 初始化：首发租户（商家A） ----------
INSERT INTO tenant (name, system_name, mall_name) VALUES ('示例商家A', '鲜配后台', '鲜配订货');
