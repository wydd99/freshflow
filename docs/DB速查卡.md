# 数据库速查卡（FreshFlow · 自己动手操作数据库）v2

> 结论先行：**本环境（体验版共享集群）不支持公网直连，DBeaver 路线取消**。
> 官方操作通道 = CloudBase 控制台三件套（浏览器登录腾讯云账号即达，任何电脑可用）。
> 原则：日常改数据优先走后台界面（自动留痕）；控制台 SQL 用于批量修正/核对/备份/应急。

---

## 一、入口（10 秒）

浏览器登录腾讯云控制台 → 云开发 CloudBase → 环境 `freshflow-ENV_ID` → 左侧「SQL 型数据库」→ 三件套都在左侧菜单：
- **数据编辑器**：双击表像 Excel 一样看/改数据（改完保存=自动生成 UPDATE）
- **SQL 编辑器**：跑任意 SQL（本地历史自动保存，常用的加"本地收藏"）
- **备份**（左侧"平台管理"栏）：每月一次，按引导导出

实例信息：pgdb-EXAMPLE · PostgreSQL 17.11 · 共享集群（升级独立集群后或可开公网直连，暂无必要）

## 二、三条救命 SQL（粘贴进 SQL 编辑器即可）

```sql
-- ① 查某客户的所有订单
SELECT o.order_no, c.name AS 客户, o.delivery_date AS 发货日, o.status AS 状态, o.amount_original AS 金额
FROM order_main o JOIN customer c ON c.id = o.customer_id
WHERE c.name = '客户甲'
ORDER BY o.created_at DESC;

-- ② 改某商品基准价（先 SELECT 确认，再 UPDATE）
SELECT id, name, base_price FROM goods WHERE name = '香菜';
UPDATE goods SET base_price = 8.5 WHERE name = '香菜' AND tenant_id = 1;

-- ③ 看各客户欠款（应收-实收）
SELECT c.name AS 客户,
       SUM(CASE WHEN l.direction='receivable' THEN l.amount ELSE -l.amount END) AS 欠款
FROM payment_ledger l JOIN customer c ON c.id = l.customer_id
GROUP BY c.name ORDER BY 欠款 DESC;
```

其他常用：查库存水位 `SELECT name, stock_qty, stock_alert FROM goods WHERE stock_qty <= stock_alert;`
看某表前 100 行：数据编辑器里直接点表名。

## 三、每月备份（10 分钟）

控制台「备份」菜单 → 按引导创建/下载备份 → 存到 `D:\FreshFlow\backups\<年-月>\`。
备用：数据编辑器里对单表用"导出"出 CSV。

## 四、安全纪律（四条铁律）

1. 腾讯云账号=最高权限，**验证码/密码绝不发给任何人**（包括 AI 对话）；
2. `UPDATE / DELETE` 必须带 WHERE，先跑同样条件的 SELECT 确认影响范围；
3. 改重要数据前，先把要改的行 SELECT 出来截图存档（可回溯）；
4. 表结构变更（加字段/建表）不手写——找 AI 写迁移并同步 `database/migrations/`，保持文档一致。

## 五、已验证事实（2026-09-13）

- 控制台 SQL 编辑器与管理通道数据一致（订单 0/商品 8/客户 5/管理员 2 双向核对过）；
- admin_user 两行均为自己人（merchant_a=boss 业务号；administrator=腾讯账号内置超管映射）；
- 共享集群无公网直连、无内网地址，数据库角色页三系统账号勿动。

## 六、按 Uid 反查账号身份（维护常用 · 9/15 增）

场景：在腾讯云「身份认证」控制台看到某个用户，想知道它是商家还是顾客、挂在哪个商家下。
⚠️ 控制台列表的「用户 ID」列 ≠ 真实 Uid（真实 Uid 在用户详情里，或系统后台「平台管理→账号总览」的 Uid 列）。

```sql
SELECT '商家/员工' AS 类型, u.username AS 登录名, u.display_name AS 显示名,
       t.name AS 所属商家, u.role AS 角色
FROM admin_user u JOIN tenant t ON t.id = u.tenant_id
WHERE u.uid = '填Uid'
UNION ALL
SELECT '顾客', cu.username, cu.display_name, t.name AS 所属商家, c.name AS 所属客户
FROM customer_user cu JOIN tenant t ON t.id = cu.tenant_id JOIN customer c ON c.id = cu.customer_id
WHERE cu.uid = '填Uid';
```

全平台账号总览（不带参数版，= 后台「平台管理→账号总览」的数据源）：

```sql
SELECT '商家/员工' AS 类型, u.username, t.name AS 所属商家, u.role
FROM admin_user u JOIN tenant t ON t.id = u.tenant_id
UNION ALL
SELECT '顾客', cu.username, t.name AS 所属商家, c.name AS 所属客户
FROM customer_user cu JOIN tenant t ON t.id = cu.tenant_id JOIN customer c ON c.id = cu.customer_id
ORDER BY 1, 2;
```

维护纪律：①建号昵称必须写业务名（勿用户名当昵称）；②Description 统一格式 `FF·商家·某某` / `FF·顾客·某店@某商家`（平台实际限 64 字符）；③日常维护优先用系统后台「账号总览」，控制台只在重置密码/封禁/删除时用。
