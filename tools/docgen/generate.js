// FreshFlow 运维手册 docx 生成脚本
// 依赖：docx + image-size（本地 node_modules），运行：node generate.js
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, PageNumber, NumberFormat, TableOfContents,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  SectionType, TableLayoutType, LevelFormat,
} = require("docx");
const fs = require("fs");
const path = require("path");
const ims = require("image-size");
const sizeOf = ims.imageSize || ims.default || ims;

const SHOTS = "D:\\FreshFlow\\docs\\manual_shots";
const OUT = "D:\\FreshFlow\\docs\\运维手册-平台管理与代维护.docx";

// ===== 配色（FG-1 Forest Mint：封面深绿 + 薄荷绿点缀） =====
const P = {
  bg: "0C1F1A",
  accent: "3DDBB5",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "2A7A65", headerText: "FFFFFF", accentLine: "2A7A65", innerLine: "C5D8D0", surface: "EDF5F2" },
  heading: "1F4A3E",
  body: "000000",
  secondary: "808080",
};

// ===== 封面 R1 配方（design-system.md 标准实现） =====
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1];
      const nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) {
        breakAt = breakAt - 1;
      }
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    const cpl = charsPerLine(minPt);
    lines = splitTitleLines(title, cpl);
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

function buildCoverR1(config) {
  const C = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: C.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: C.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: C.subtitleColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: C.metaColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: C.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                              " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: C.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: C.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ===== 正文构件 =====
function h1(text) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text })] }); }
function h2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text })] }); }
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: [new TextRun({ text, size: 24, color: P.body })],
    ...opts,
  });
}
// 混排段落：parts = [["文字", {bold:true}], ...]
function rich(parts, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: parts.map(([text, props]) => new TextRun({ text, size: 24, color: P.body, ...(props || {}) })),
    ...opts,
  });
}
function note(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: [new TextRun({ text, size: 21, color: P.secondary })],
  });
}
function toParts(textParts) {
  if (typeof textParts === "string") return [[textParts, null]];
  if (Array.isArray(textParts) && textParts.length && Array.isArray(textParts[0])) return textParts;
  return [textParts];
}
function numbered(ref, textParts) {
  const parts = toParts(textParts);
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { line: 312, after: 60 },
    children: parts.map(([text, props]) => new TextRun({ text, size: 24, color: P.body, ...(props || {}) })),
  });
}
function bullet(textParts) {
  const parts = toParts(textParts);
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { line: 312, after: 60 },
    children: parts.map(([text, props]) => new TextRun({ text, size: 24, color: P.body, ...(props || {}) })),
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, size: 21, bold: true, color: P.heading })],
  });
}
function dataTable(headers, rows, widths) {
  const mkCell = (text, isHeader, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: P.table.headerBg } : undefined,
    children: [new Paragraph({
      spacing: { line: 312 },
      children: [new TextRun({ text, size: 21, bold: isHeader, color: isHeader ? P.table.headerText : P.body })],
    })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => mkCell(t, true, widths[i])),
      }),
      ...rows.map((r) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => mkCell(t, false, widths[i])),
      })),
    ],
  });
}
let figNo = 0;
function figure(file, caption) {
  figNo += 1;
  const buf = fs.readFileSync(path.join(SHOTS, file));
  const dim = sizeOf(buf);
  const W = 560;
  const H = Math.round((W * dim.height) / dim.width);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 60 },
      children: [new ImageRun({ data: buf, transformation: { width: W, height: H }, type: "png" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: `图 ${figNo}  ${caption}`, size: 18, color: P.secondary })],
    }),
  ];
}

// ===== 封面配置 =====
const coverConfig = {
  title: "FreshFlow 运维手册",
  subtitle: "平台管理与代维护台操作指南",
  englishLabel: "OPERATIONS MANUAL",
  metaLines: [
    "适用对象：平台运维人员",
    "版本：v1.0（对应代维护台 U6 上线版）",
    "更新日期：2026 年 9 月 16 日",
  ],
  footerLeft: "FreshFlow 鲜配系统",
  footerRight: "内部资料 · 请勿外传",
  palette: {
    bg: P.bg, accent: P.accent,
    titleColor: P.cover.titleColor, subtitleColor: P.cover.subtitleColor,
    metaColor: P.cover.metaColor, footerColor: P.cover.footerColor,
  },
};

// ===== 正文内容 =====
const content = [];
const add = (...els) => { for (const e of els) content.push(e); };

// 一、定位
add(h1("一、界面定位与使用纪律"));
add(body("「平台管理」是 FreshFlow 鲜配系统的平台方总后台，只有白名单账号能进入。它服务于两类人：平台运维人员（替商家开荒建档、处理售后代录）和平台管理员（监管全平台）。"));
add(body("其中「代维护」的商业定位是收费开通陪跑服务：新商家不会用电脑，运维替他把商品、客户、价格录进系统（首年含 2 小时代录服务，超出按次计费）；日常售后商家打电话来要求改价、补录客户，也走这里。"));
add(tableTitle("平台管理的四块功能"));
add(dataTable(
  ["功能", "用途", "谁会用"],
  [
    ["租户一览", "看所有商家的经营概况，停用或启用商家", "运维"],
    ["账号总览", "全平台账号清单：谁是商家、谁是顾客、属于哪家", "运维排查问题"],
    ["新建租户", "给新签约商家一键开店铺（建号＋初始数据）", "运维"],
    ["代维护", "替商家录商品、客户档案、价格（本手册重点）", "运维"],
  ],
  [18, 62, 20]
));
add(new Paragraph({ spacing: { before: 120 } }));
add(body("三条铁律，违反即事故："));
add(numbered("n-rules", [["永远不要索要商家的登录密码。", { bold: true }], ["代维护是平台授权的专用通道，不需要商家密码；商家的密码始终在商家自己手里。", null]]));
add(numbered("n-rules", [["每一步操作都会自动留痕。", { bold: true }], ["系统记录操作人、时间、替哪家商家、改了什么，事后可审计。放心操作，但也不要乱操作。留痕只在平台侧可见——商家自己的「操作日志」页不会显示平台代录记录。", null]]));
add(numbered("n-rules", [["代维护没有删除功能，这是故意设计的。", { bold: true }], ["录错可以修改；确实要删除，请商家在自己后台操作，或联系平台管理员。", null]]));

// 二、登录
add(h1("二、怎么登录进入"));
add(numbered("n-login", ["浏览器打开后台地址 freshflow-ENV_ID-0000000000.tcloudbaseapp.com。", null]));
add(numbered("n-login", ["首次访问会出现腾讯云的「风险提醒」页（见下图），等倒计时结束点「确定访问」即可。这是测试域名的固定提示，属正常现象。", null]));
add(...figure("00-首次访问提醒页.png", "首次访问的腾讯云风险提醒页，点「确定访问」继续"));
add(numbered("n-login", ["输入平台方账号登录：账号 administrator，密码线下同步（当前演示期账号；正式运营时管理员会发运维专属账号）。", null]));
add(...figure("01-登录页.png", "后台登录页"));
add(numbered("n-login", ["左侧菜单点「平台管理」，页面顶部有四个标签：租户一览、账号总览、代维护。", null]));
add(numbered("n-login", [["进入「代维护」后第一件事：", null], ["在下拉框选择要维护的商家租户", { bold: true }], ["。没选租户前页面是空的（提示「请先选择商家租户」），选完后商品、客户、价格三个子面板自动加载。", null]]));
add(new Paragraph({ spacing: { before: 120 } }));
add(rich([["常见登录问题：", { bold: true }]]));
add(bullet([["提示「当前账号不是平台方」", { bold: true }], ["：你用的不是白名单账号，找系统管理员把你的账号加进 PLATFORM_UIDS 名单。", null]]));
add(bullet([["提示「登录已失效，请重新登录」", { bold: true }], ["：会话过期了，退出重登即可。", null]]));
add(bullet([["同一账号在两台电脑登录，一台会被挤下线", { bold: true }], ["：属正常现象，重新登录即可。", null]]));

// 三、代维护
add(h1("三、代维护操作详解"));
add(...figure("04-代维护-先选租户.png", "代维护入口：先在下拉框选择商家租户，未选择时显示空状态"));
add(h2("3.1 商品面板"));
add(body("表格列包括：编码（系统自动生成，10 位数字，不要手改）、品名、分类、别名、单位、基准价、商城可见、状态、操作。"));
add(...figure("05-代维护-商品面板.png", "商品面板：左侧工具行（新增商品、批量粘贴、搜索），表格展示该商家全部商品"));
add(rich([["新增单个商品：", { bold: true }], ["点「新增商品」，按下表逐字段填写，保存后提示「已创建（编码 xxx）」并自动刷新列表。", null]]));
add(tableTitle("新增商品的字段说明"));
add(dataTable(
  ["字段", "怎么填", "说明"],
  [
    ["品名*", "必填", "商品的正式名称"],
    ["分类", "下拉选，或直接输入新分类名", "输入的新名字会自动创建分类，不用先去建分类"],
    ["单位", "默认「斤」", "按份卖的填「份」「箱」「瓶」等"],
    ["基准价", "数字，默认 0", "没有等级价或专属价时，顾客按这个价结算"],
    ["别名", "分号分隔，如：鸡旦;土鸡蛋", "很重要——智能录单识别手写单、顾客搜索都靠它匹配，商家口头怎么叫就怎么写"],
    ["规格", "如：30枚/箱", "选填"],
    ["商品介绍", "文字", "选填，商城商品详情展示"],
    ["商城可见", "默认开", "开＝顾客在商城能看到并下单；关＝隐藏（内部用品如周转筐就关掉）"],
  ],
  [16, 30, 54]
));
add(...figure("06-商品-新增弹窗.png", "新增商品弹窗（示例填写）。编辑商品时编码不会变，已停用的商品编辑后仍是停用状态"));
add(rich([["编辑商品：", { bold: true }], ["点行尾「编辑」→ 改字段 → 保存。编码不会变，放心改名字和价格。", null]]));
add(rich([["批量粘贴录入（开荒建档主力）：", { bold: true }], ["点「批量粘贴」，文本框里每行一条，格式为：品名,分类,单位,基准价。例如：", null]]));
add(new Paragraph({
  indent: { left: 480 },
  spacing: { line: 312, after: 80 },
  children: [
    new TextRun({ text: "白菜,叶菜类,斤,3.5", size: 21, font: { ascii: "Courier New", eastAsia: "SimSun" } }),
    new TextRun({ break: 1 }),
    new TextRun({ text: "土豆,根茎类,斤,2.8", size: 21, font: { ascii: "Courier New", eastAsia: "SimSun" } }),
    new TextRun({ break: 1 }),
    new TextRun({ text: "番茄,,斤,5", size: 21, font: { ascii: "Courier New", eastAsia: "SimSun" } }),
    new TextRun({ break: 1 }),
    new TextRun({ text: "香菜,叶菜类,,", size: 21, font: { ascii: "Courier New", eastAsia: "SimSun" } }),
  ],
}));
add(bullet([["必须用英文逗号", { bold: true }], ["：用中文逗号会导致该行失败，失败结果里会列明第几行、什么原因，改好重新粘贴即可。", null]]));
add(bullet(["顺序固定：品名在最前，基准价在最后；分类、单位、价格可以留空（留空＝不设分类／默认斤／价格 0）。", null]));
add(bullet(["空行自动跳过。点「开始录入」后逐条写入，结束弹出结果：成功 N 条，失败明细带行号和原因。", null]));
add(bullet(["同名商品不会自动去重——粘贴前先搜一下品名，避免录重。", null]));
add(...figure("07-商品-批量粘贴弹窗.png", "批量粘贴弹窗：每行一条，英文逗号分隔"));
add(h2("3.2 客户面板"));
add(...figure("08-代维护-客户面板.png", "客户面板：表格展示该商家全部客户档案"));
add(body("点「新增客户」，按下表逐字段填写，保存后自动刷新列表。"));
add(tableTitle("新增客户的字段说明"));
add(dataTable(
  ["字段", "怎么填", "这个字段管什么"],
  [
    ["名称*", "必填", "客户（餐馆、食堂）名称"],
    ["等级", "普通 / A / B / C", "决定客户享受哪档等级价；不设等级价就都按基准价"],
    ["结算方式", "当日结 / 月结 / 货到付款", "选月结需再填「每月结账日」（1–31，只有选月结时才出现这一栏）"],
    ["欠款上限", "数字，留空＝不限", "客户欠款超过这个数，系统自动禁止下单"],
    ["超期禁单天数", "默认 30", "客户有超过 N 天没结的欠款时，自动禁止下单"],
    ["可见全部商品", "默认开", "开＝顾客在商城能看到全部上架商品；关＝只看授权分类——关闭后会出现「可见分类」多选框，勾选该客户能看的分类（支持输入新分类名）。注意：一个分类都不勾＝该客户在商城看不到任何商品"],
    ["备注", "文字", "如：老板娘微信 xxx"],
  ],
  [16, 28, 56]
));
add(...figure("09-客户-新增弹窗.png", "新增客户弹窗：选月结时才会出现「每月结账日」一栏"));
add(h2("3.3 价格面板"));
add(rich([["先搞懂取价规则（顾客实际成交价的优先级）：", { bold: true }], ["客户专属价 ＞ 等级价（A/B/C）＞ 基准价，且只取「生效日 ≤ 今天」里最新的一条。同一个价格当天重复设置＝覆盖当天的（历史保留可查）。", null]]));
add(body("操作流程："));
add(numbered("n-price", ["顶部下拉选商品（支持按编码、品名搜索）。", null]));
add(numbered("n-price", ["右侧表格显示该商品当前生效价：每行＝一种价格（等级价或客户专属价）＋当前价＋生效日。点行首箭头可展开看全部历史价格（只读，改不了删不掉）。", null]));
add(numbered("n-price", [["新增或修改价格：", null], ["等级价", { bold: true }], ["＝勾选 A/B/C（可多选，一次给多个等级设同一个价）→ 输价格 → 保存；", null], ["客户专属价", { bold: true }], ["＝切换后下拉选具体客户 → 输价格 → 保存（只对这一家生效）。", null]]));
add(numbered("n-price", ["保存成功提示「已生效（2026-09-16 起）」。价格从今天起算，不影响历史订单。", null]));
add(...figure("10-代维护-价格面板.png", "价格面板：选中商品后展示当前生效价，下方为新增／修改价格表单"));
add(...figure("11-价格-历史展开.png", "点行首箭头展开全部历史价格（只读）"));
add(note("注意：没有批量改价，也没有删除某条价格——如需要请反馈给平台管理员。给顾客解释价格差异时，先问对方等级和有没有专属价，再看这个商品的当前生效价表。"));

// 四、其他功能
add(h1("四、平台管理其他功能"));
add(h2("4.1 租户一览"));
add(body("所有商家的列表：套餐、启用状态、店家账户数、客户档案数、订单数。行尾可停用或启用商家（停用前有确认弹窗）。注意：停用后该商家整体无法登录使用，用于欠费或解约场景，慎点。"));
add(...figure("02-租户一览.png", "租户一览：所有商家的经营概况，行尾可停用／启用"));
add(h2("4.2 账号总览"));
add(body("全平台所有账号：类型（商家／顾客）、登录名、角色（老板／店长／顾客）、所属租户、Uid。这是排查问题神器——商家说顾客登录不了，来这里查这个顾客的账号挂在哪家、状态是否正常。"));
add(...figure("03-账号总览.png", "账号总览：全平台账号与归属一览"));
add(h2("4.3 新建租户（给新商家开店）"));
add(body("点「新建租户」向导，按以下步骤填写："));
add(numbered("n-wizard", [["商家名称", { bold: true }], ["：如「示例商家B」。", null]]));
add(numbered("n-wizard", [["管理员账号", { bold: true }], ["：字母开头，2–48 位（字母、数字、点、下划线、减号），如 merchant_b。", null]]));
add(numbered("n-wizard", [["初始密码", { bold: true }], ["：8–32 位，必须含大写、小写、数字中至少 3 类（如 Abc12345）。把这个密码当面交给商家，商家后续自己改。", null]]));
add(numbered("n-wizard", [["安全模式", { bold: true }], ["：开＝顾客在新设备登录要短信验证（安全套餐卖点）；关＝账号密码直接登录（方便但弱一点）。按商家签约套餐选。", null]]));
add(numbered("n-wizard", [["商品分类种子", { bold: true }], ["：默认复制标准 7 个分类（叶菜、根茎、调味等），商家什么都不用建就能开始录商品。", null]]));
add(body("创建成功会提示账号信息，整个开店过程约 1 分钟。"));
add(...figure("12-新建租户向导.png", "新建租户向导（示例填写）"));

// 五、FAQ
add(h1("五、常见问题处理（FAQ）"));
const faqs = [
  ["保存时提示「品名必填」「价格必须大于 0」之类怎么办？", "按提示补字段。价格面板的价格必须大于 0（免费的东西不应出现在报价单里）。"],
  ["批量粘贴一半失败怎么办？", "看结果弹窗里的失败明细（第几行＋原因）。最常见的原因：用了中文逗号、价格列写了「3.5元」这种带单位的、整行只有一个词。修正后只粘贴失败的那几行即可，已成功的不会重复录入。"],
  ["录完商品，商家说商城里看不到？", "依次检查：①商品「商城可见」是否为开（表格里商城可见列是否为「是」）；②商品「状态」列是否启用；③商家说的顾客是否被限制了可见分类（见 3.2 可见全部商品）；④顾客端刷新页面。"],
  ["商家说顾客看到的价格不对？", "按取价优先级排查：①这个顾客有没有设客户专属价；②顾客所属等级有没有设等级价；③都没有就是基准价。价格面板里选中商品一眼就能看到当前所有生效价。"],
  ["录错了想删掉怎么办？", "代维护没有删除功能（防误删，故意设计）。能改就编辑改正；确实要删，两个途径——让商家在自己后台删（商品、客户管理页都有删除按钮），或联系平台管理员处理数据库。"],
  ["商品想下架但又不想删？", "把「商城可见」关掉即可（代维护编辑弹窗或商家后台都能关）：顾客立刻看不到，历史订单和数据都保留。"],
  ["不小心把 A 商家的东西录到 B 商家了？", "到 B 商家租户下把该商品改名备注清楚，并提醒商家删除；价格不用动（不影响 A 商家）。预防办法：操作前先看页面顶部的租户下拉框当前选的是谁，切租户后所有面板数据会整组刷新。"],
  ["改了价格，商家说老订单金额也变了？", "不会。价格只对生效日不早于设置日的订单生效，历史订单不会变。真遇到先核对对方看的是哪天的单。"],
  ["我改过什么自己忘了，商家对账有争议？", "每笔代维护都自动留痕（操作人、时间、替哪家、录了什么）。告诉平台管理员查 op_log 操作日志即可，不用自己记忆。"],
  ["页面卡住、点了没反应？", "先刷新页面（F5）；还不行就退出重新登录。代维护的每次保存都有成功或失败提示——没看到提示＝没保存成功，别默认成功了。"],
  ["商家问「你们是不是有我们密码」？", "没有，也不需要。如实告知：平台有授权代录通道，所有操作有审计记录，商家可以随时改自己的密码（商家后台-设置）。"],
  ["商家会看到我们替他录了什么、改了什么吗？", "不会。平台代录记录只在平台侧留痕（谁、何时、替哪家、录了什么），商家自己的「操作日志」页不显示这些记录。对账有争议时，由平台查内部日志回应。"],
];
for (let i = 0; i < faqs.length; i++) {
  add(rich([[`Q${i + 1}：${faqs[i][0]}`, { bold: true, color: P.heading }], ["", null]], { indent: { firstLine: 0 }, spacing: { line: 312, before: 120, after: 40 } }));
  add(rich([["处理：", { bold: true }], [faqs[i][1], null]], { indent: { firstLine: 480 } }));
}

// 六、边界清单
add(h1("六、代维护不能做的事（边界清单）"));
add(body("以下事项在代维护界面做不了，避免白费劲——遇到时按下表走正确路径："));
add(dataTable(
  ["想做的事", "为什么做不了", "正确做法"],
  [
    ["删除商品、客户、价格", "无删除功能（防误删）", "商家后台删，或找平台管理员"],
    ["停用或启用某商品", "代维护和商家后台目前都没有启停开关", "想下架就关「商城可见」；彻底删除见上条"],
    ["批量改价", "未开发", "逐个商品设置，或反馈需求"],
    ["代商家下订单", "设计上不做（商家有智能录单）", "教商家用智能录单"],
    ["开停商家子账号、改顾客密码", "商家自助功能", "商家后台「客户管理→子账号」"],
    ["查操作日志", "日志在数据库", "找平台管理员查 op_log"],
  ],
  [26, 30, 44]
));

// 七、测试数据备忘
add(h1("七、当前系统里的测试数据（交接备忘）"));
add(body("验收时留下的数据挂在示例商家B租户下，正式启用前记得清理（商家后台可删）："));
add(bullet(["商品「验收测试商品B」（编码 0110060003，分类「验收测试分类」）", null]));
add(bullet(["客户「测试客户A」（B 级／月结）", null]));
add(bullet(["商品「香菜」的 B 级价被改成了 8.8（验收「同日覆盖」留下的）", null]));
add(new Paragraph({ spacing: { before: 160 } }));
add(note("本手册对应源码：web-admin/src/views/Platform.vue（界面）、cloudfunctions/platform/index.js（maintain 接口）。改动界面或接口后请同步更新本手册。"));

// ===== 文档组装 =====
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };
function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary })],
    })],
  });
}
function pageHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "FreshFlow 运维手册 · 平台管理与代维护", size: 16, color: P.secondary })],
    })],
  });
}

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" }, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Calibri", eastAsia: "SimHei" }, size: 32, bold: true, color: P.heading },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Calibri", eastAsia: "SimHei" }, size: 28, bold: true, color: P.heading },
        paragraph: { spacing: { before: 280, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  numbering: {
    config: [
      { reference: "n-rules", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "n-login", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "n-price", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "n-wizard", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [
    {
      // 封面（无页眉页脚、无页码）
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1(coverConfig),
    },
    {
      // 目录（罗马页码）
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "目  录", bold: true, size: 32, font: { eastAsia: "SimHei", ascii: "Times New Roman" }, color: P.heading })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: "提示：目录页码由 Word 域自动生成，打开文档后可右键点击目录选择「更新域」刷新页码。", italics: true, size: 18, color: P.secondary })],
        }),
      ],
    },
    {
      // 正文（阿拉伯页码从 1 起）
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: content,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("OK:", OUT, Math.round(buf.length / 1024), "KB, figures:", figNo);
});
