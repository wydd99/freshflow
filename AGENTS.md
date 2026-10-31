# AGENTS.md — FreshFlow 项目上下文（任何 AI 编码工具自动加载）

> 参考文档：`docs\开发日志.md`（时间线与事故复盘）。

## 项目一句话

**FreshFlow**：生鲜批发商（首发用户：商家A，本地蔬菜配送）的 B2B 经营系统——店家商城下单 / 后台五种方式录单（语音·拍照·手写·Excel·文本）/ 采购 / 分拣改重 / 打印三件套 / 一客一价 / 账期锁单 / 老板日报。终局目标：白牌多租户 SaaS 卖同行。

## 技术栈与目录

- **web-admin/**：管理后台，Vue3 + Vite6 + Element Plus + Pinia。`npm run dev`（localhost:5273）/ `npm run build`
- **miniprogram/**：微信原生小程序（商城下单端，客户用）
- **web-mall/index.html**：网页版商城（单文件 H5，已发布 /mall/）
- **database/migrations/**：PostgreSQL 迁移 SQL（**事实源，按序号即全部已应用**）
- **docs/**：PLAN（选型/里程碑）、REQS（21 条验收需求）、STATE_AND_AMOUNT（状态机与金额口径）
- **print/**：打印三件套静态稿（A4 纯文字配货单 / A4 表格出库单 / 80mm 小票）
- **ai/prompts/**：GLM 解析提示词；**ai/test/**：识别率实测报告

## 线上环境与账号

- CloudBase 环境：`freshflow-ENV_ID`（上海，体验版免费至 2027-03-10，PostgreSQL）
- 后台（已发布）：https://freshflow-ENV_ID-0000000000.tcloudbaseapp.com
- 网页商城：同域 `/mall/`
- 账号：`merchant_a / TempPwd000`（管理员 boss）；`customer_a / TempPwd000`（店家=客户甲）。密码规则：**名字首字母大写+小写+数字**（平台强制≥3 类字符）

## 架构铁律（违反=事故）

1. **数据访问=前端 `@cloudbase/js-sdk` app.rdb()（postgREST 风格：eq/in/lte/order/range，没有 .where/.orderBy/.count）+ 数据库 RLS 强制多租户**。不建云函数 API 层；云函数只做异步任务（AI 解析、账期日检）。
2. **租户身份**=`ff_actor()`（SECURITY DEFINER，admin_user/customer_user.uid = auth.uid()）→ 返回 kind/tenant_id/role/customer_id/level。26+ 条 RLS 策略全部依赖它。**不要 DROP 重建 ff_actor（策略引用会阻断），改签名要先 DROP 相关策略**。
3. **订单状态机与金额口径**：`docs/STATE_AND_AMOUNT.md` 是唯一标准（draft→confirmed→sorting→ready→shipped→done/void；出货单金额=Σ实拣×实拣价；取价链=客户专属→等级价→基准价）。
4. **"今天"一律用 `localToday()`**（services.js 导出）——`toISOString()` 是 UTC，凌晨差一天的 bug 已修过一次，禁止回退。
5. 插入表用 `Prefer: return=representation` 头拿回新行（否则 201 空体拿不到 id），并按单号兜底查询。

## 平台坑（已踩实，直接信）

- CloudBase 迁移推送（applyMigration）**会静默失败**（返回成功但不落库）→ DDL/DML 用 `managePgDatabase execute` 或网关直连；迁移文件以 `database/migrations/` 为准。
- Auth 登录网关=**`https://{env}.api.tcloudbasegateway.com/auth/v1/signin`**（带 x-device-id，无需 basic auth）；旧域 tcb-api.tencentcloudapi.com 会 4043 假失败。
- 体验版套餐不能加自定义安全域名 → localhost 上真实登录被拒；真实登录必须走已发布的 tcloudbaseapp.com 域名。
- 平台密码策略：≥3 类字符（首字母大写方案已被接受）。
- Git Bash 的 curl 发中文会非 UTF-8 报错（测试体用 ASCII 或写临时文件）。

## 当前状态（2026-09-11）

P1+P2 主体全部上线：登录（身份分流）/商品（Excel 导入）/客户/报价（批量改价+取价链）/订单池（账期锁单+强制放行）/智能录单（本地规则+云函数 AI，图片链路已实测）/分拣屏（蓝黄绿/撤销补签/标签打印）/打印三件套/往来账/经营日报/商城双端。**云函数 `ai` 已配 DeepSeek Key，文本+图片双模实测通过。**

**待办**：等外部输入的（秤型号/小程序 devtools 实测/手写样张回归）与可立即做的（语音开单、管理边界云函数、商品详情页 T3.6）。
