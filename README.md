<div align="center">

# 🥬 FreshFlow

### 生鲜蔬菜 B2B 订货配送平台 · 多租户 SaaS

*让蔬菜批发告别微信群接单与手抄账本 —— 店家拍照/说话就能下单，后台自动分拣对账*

![Vue3](https://img.shields.io/badge/前端-Vue3_+_ElementPlus-42b883?style=flat-square) ![小程序](https://img.shields.io/badge/端-微信小程序-07c160?style=flat-square) ![H5](https://img.shields.io/badge/端-H5商城-ff6a00?style=flat-square) ![CloudBase](https://img.shields.io/badge/后端-腾讯云_CloudBase-0052d9?style=flat-square) ![PG](https://img.shields.io/badge/数据库-PostgreSQL_RLS-336791?style=flat-square) ![云函数](https://img.shields.io/badge/云函数-Python-ffd43b?style=flat-square)

`⏱ 8 天交付` · `60 commits` · `4 端全栈` · `15 表 RLS 多租户` · `AI 识图 + 语音开单`

---

<img src="docs/manual_shots/02-租户一览.png" width="820" alt="多租户后台一览"/>

*平台总后台：多租户一屏总览*

</div>

## 🎯 它解决什么问题

传统蔬菜批发的日常：店家在微信群里喊单、老板手抄订单、月底翻聊天记录对账——错单、漏单、赖账全靠人情兜底。FreshFlow 把整条链路搬上线：

```
  餐饮店家                              批发商（平台运营方）
 ──────────                           ─────────────────────
 📱 小程序 · 下单/语音开单/查账          🖥 管理后台 · 商品/报价/订单/客户
 🌐 H5 商城 · 免安装同功能              📺 分拣屏 · 逐行实拣/缺货登记
 📸 拍手写订单照片                      🖨 打印中心 · 小票/配货单/出库单
      │                                💰 对账 · 应收/实收/欠款/月结
      ▼                                        │
 ☁️ 云函数 ai（GLM-4.5V 识图 · ASR 语音 · LLM 结构化）
      │                                        │
      ▼                                        ▼
 🐘 PostgreSQL · RLS 行级安全 · 26+2 策略强制多租户隔离
```

## 🚀 核心功能

| | 功能 | 说明 |
|---|---|---|
| 📸 | **AI 识图开单** | 手写订单拍照 → GLM-4.5V 结构化识别 → 词库校验 → 低置信标红人核。潦草字样 A/B 实测 4/4 全对 |
| 🎤 | **语音开单** | 「香菜两斤土豆五斤」→ 录音 → 腾讯云 ASR（手写 TC3 签名零 SDK）→ LLM 结构化 → 确认下单 |
| 🏪 | **多租户隔离** | PostgreSQL RLS 26+2 条策略，商家/顾客/平台三层隔离，跨租户读写对抗实测全 403 |
| 💰 | **报价体系** | 基准价 + A/B/C 等级价 + 客户单独价，生效日历史留痕，同日重设自动覆盖 |
| 📦 | **订单状态机** | draft → confirmed → sorting → ready → shipped → done，实拣量自动替换定价 |
| 🧾 | **打印三件套** | 80mm 小票 / A4 配货单 / A4 出库单，模板即 HTML，开箱即打 |
| 🤝 | **账期对账** | 当日结 / 月结 / 货到付款，欠款上限、超期禁单、应收实收台账 |
| 🔐 | **安全体系** | 新设备短信验证 + 商家白名单放行 + 90 分钟会话保活 + 操作日志全留痕 |
| ⚪ | **白牌 SaaS** | 租户级品牌定制，新建租户向导一键开店（租户+管理员+分类种子一次建成） |

<div align="center">

## 🖼 界面一览

| 等级价 · 历史留痕 | 批量粘贴录入 |
|---|---|
| <img src="docs/manual_shots/10-代维护-价格面板.png" width="400"/> | <img src="docs/manual_shots/07-商品-批量粘贴弹窗.png" width="400"/> |
| **新建租户向导** | **代维护 · 商品面板** |
| <img src="docs/manual_shots/12-新建租户向导.png" width="400"/> | <img src="docs/manual_shots/05-代维护-商品面板.png" width="400"/> |

*页面数据均为测试数据*

</div>

## 💡 技术亮点

开发全程留有 [开发日志](docs/开发日志.md)（15 条事故复盘）与 [开发手册](docs/开发手册.md)（21 条坑清单），摘几条有意思的：

- **RLS 是底线不是装饰** — 前端门禁只算展示层：顾客 token 裸打 REST、商家跨租户写库、越权删他租户数据，全部被 RLS 拒绝。三层隔离用五组对抗性实测验证闭环。
- **access_token 2h 过期引发的"保存假成功"** — js-sdk 静默失败 0 行，用户看到 toast 成功但库里没有。根治 = 会话保活 + 写后回读比对 + `.select()` 0 行守卫 + `unhandledrejection` 全局兜底，全系统零静默失败收口。
- **AI 选型靠实测不靠宣传** — qwen-vl-plus 行号幻觉、qwen3.5-ocr 不守 JSON 规则、DeepSeek 潦草字臆造小数，A/B 对比后 GLM-4.5V 胜出；双 Key 三通道（image/text/audio）分离部署。
- **腾讯云 TC3 签名手写实现** — 云函数为控体积不引 SDK，按官方规范手写 TC3 签名，踩平 canonicalHeaders 尾换行的官方示例坑。
- **外部用户不限量的架构红利** — Auth `internalUser` 占配额、`externalUser` 不限量：商家/员工占内部名额，终端店家无限开号，僵尸号零成本。
- **中文编码三连坑** — Git Bash curl 发中文 GBK 乱码、测试脚本中文参数污染库、argv 传中文乱码，沉淀为「凡测试体含中文必须写文件+校验编码后再发」的硬纪律。

<details>
<summary><b>📅 8 天交付时间线</b></summary>

| 天 | 里程碑 |
|---|---|
| D1 | 架构定档：CloudBase + PostgreSQL RLS 多租户，环境开通 |
| D2 | 登录网关打通：Auth signin / rdb REST 实测，CORS 放行，租户隔离首轮验证 |
| D3 | AI 三通道上线：GLM-4.5V 识图 A/B 实测切换 + 语音开单（ASR+LLM）端到端跑通 |
| D4 | 数据库自主运维体系：DB 速查卡 / 备份纪律 / 救命 SQL |
| D5 | 订单全链路：退货售后 + 地址簿 + 购物车 v2 + 设备验证安全门 |
| D6 | 平台运维台：新建租户向导一键开店 + 运维三层化 + 升级池定档 |
| D7 | 三方隔离安全审计（五组对抗实测全过）+ 商家侧信息管控原则落地 |
| D8 | 文档五件套 + 运维手册（13 张实截）收官 |

</details>

<details>
<summary><b>📂 目录结构</b></summary>

```
├── web-admin/        管理后台（Vue3 + ElementPlus，14 页）
├── web-mall/         H5 商城（单文件 SPA，与小程序同网关 API）
├── miniprogram/      微信小程序（下单 / 语音开单 / 订单 / 地址簿）
├── cloudfunctions/   云函数（ai 三通道 + useradmin + platform + authgate）
├── database/         schema.sql + 全部 migrations（本地为结构真源）
├── print/            打印三件套模板（80mm 小票 / A4 配货 / A4 出库）
├── ai/               AI 提示词与识别率实测（A/B 报告）
├── tools/            部署脚本 / 文档生成 / 打印代理
└── docs/             开发日志 / 开发手册 / 运维手册 / DB 速查卡 / 需求与任务书
```

</details>

<div align="center">

## 📄 说明

本仓库为个人技术作品展示。


平台后端依赖腾讯云 CloudBase（Auth 网关 / 云函数 / PostgreSQL），演示环境未部署，代码与文档供阅读。
表结构见 [`database/schema.sql`](database/schema.sql) · 订单状态机与金额口径见 [`docs/STATE_AND_AMOUNT.md`](docs/STATE_AND_AMOUNT.md)

</div>
