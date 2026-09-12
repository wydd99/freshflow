# FreshFlow · 订单状态机与金额口径（T0.3）

> 配套 `database/schema.sql`。所有打印、对账、报表、锁单逻辑以本文口径为准。

## 一、订单状态机

```
draft(草单) ──确认──▶ confirmed(已确认) ──开始分拣──▶ sorting(分拣中)
   │                      │                              │
   │作废                   │作废                           │作废
   ▼                      ▼                              ▼
 void(已作废)           void                           void

sorting ──全部明细 sorted/short──▶ ready(待发货) ──发货──▶ shipped(已发货)
                                        │                    │
                                 作废(需留痕)          收款挂账+对账完成
                                                             ▼
                                                           done(已完成)
```

- **draft**：五种录入方式先进草单（对应买方"先打草稿单"，需求#3）；可任意改行、增删商品。
- **confirmed**：确认后进入履约；仍允许改数量（改重前置），但**每次改动写 order_item.edit_log**（需求#8）。
- **sorting**：分拣屏工作状态；明细逐行 pending → sorted（有实拣量）或 short（缺货）。
- **ready**：sort_done = sort_total（缺货也计入完成）；此时配货金额定型。
- **shipped**：发货同时往 payment_ledger 挂应收（daily/cod 立即提示收款；monthly 月末结）。
- **done**：货款两清（或月结入账）。
- **void**：任意未完成状态可作废；已发货作废需同时冲销应收（写 adjust 流水）。

## 二、金额口径（订单五卡）

| 字段 | 公式 | 说明 |
|---|---|---|
| 订单金额 amount_original | Σ(order_qty × order_price) | 下单口径，草单即有（打印配货单不显示金额也行，模板开关） |
| 配货金额 amount_configured | Σ(sorted_qty × sorted_price)，short 行计 0 | 实拣口径，分拣完定型；**出货单/对账单用这个**（需求#18：实重自动替换） |
| 实付 amount_paid | 配货金额 − 售后 + 运费 + 服务费 + 押金 | 客户最终应付 |
| 售后 amount_aftersale | Σ 作废/退货行金额 | 留痕于 edit_log + payment_ledger(adjust) |
| 押金 deposit | 手工录入 | 框/桶押金，需求场景预留 |

- 含税额 = 金额 × (1 + tax_rate)；P1 税率全局默认 0，字段已预留（对接企业客户要票时开启）。
- 多退少补 = sorted_qty − order_qty，逐行可写 adjust_note（"五斤只收四斤"场景，需求#8）。

## 三、取价链与价源标签

```
customer 专属价（valid_from≤今日 中最新）  → 标签「客」
→ 否则 customer.level 类型价（同规则）      → 标签「型」
→ 否则 goods.base_price                    → 标签「原」
```
- 录单时价格即快照进 order_item.order_price + price_source，事后改价不影响已建订单。
- 展示"最近价"：查该客户该商品最近 3 笔已确认订单的 order_price → 标签「历」（录单防错价）。
- 批量改价 = 按 scope=type 批量插 price 新行（历史可追溯，不 update 旧行）。

## 四、账期锁单规则（需求#7）

下单（draft 建单）前校验，任一命中即拦截并在 order_main.locked_reason 记原因：
1. **欠款上限**：欠款余额（payment_ledger 应收−实收，或 balance_after 最新值）> customer.credit_limit → 拦截；
2. **超期禁单**：存在应收流水 created_at 距今 > customer.overdue_days 且未核销 → 拦截；
3. **货到付款 cod**：不预拦，但上单未收款时新单标记待收款提醒。
拦截允许管理员权限**手动放行**（记 op_log）——现场业务不能被系统卡死。

## 五、改单留痕（需求#8）

- order_item.edit_log 追加式 JSONB：`{"f":"sorted_qty","o":5,"n":4,"by":"商家A","at":"..."}`；
- 确认后改行、分拣改重、验收改重全部走同一留痕；打印单/对账单页脚显示"最后修改时间+修改人"。

## 六、单号规则

`OR_yyyyMMdd + 4位租户内日流水`（如 OR_202609120001）；分拣标签单据号 `DB_yyyyMMdd-序号`（对齐行业习惯）。
