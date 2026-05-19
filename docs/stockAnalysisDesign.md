# 个股综合分析功能 — 设计与实现总结

> 版本: 2.0
> 更新日期: 2026-05-18
> 状态: 已实现

---

## 一、功能定位

为 A 股投资者提供从综合评分、技术面、基本面、资金面的四维度个股分析能力。核心设计原则：

- **结论先行**：页面顶部诊断区直接展示综合结论，无需翻页
- **数据真实**：所有数据均来自东方财富公开 API，宁可显示"暂无数据"，绝不展示伪造数据
- **动态权重**：评分权重根据数据源可用性自动调整（有基本面 50/30/20，无基本面 65/15/20）
- **行业感知**：PE 阈值按 17 个行业分类独立配置，避免用统一标准衡量不同行业
- **历史对比**：基本面使用多季度历史数据计算估值分位，而非只看单一数值

---

## 二、页面结构

```
┌─────────────────────────────────────────────────────────┐
│  综合分析                                                │
├─────────────────────────────────────────────────────────┤
│  贵州茅台 600519  ¥1,332.95  -0.69%       [股票池选择 ▼] │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┬──────────┬──────────┬──────────┐           │
│  │ 综合评分  │   趋势    │   估值    │   资金    │           │
│  │   72     │  ↑ 多头   │  ✓ 合理   │  → 平稳  │           │
│  │ 建议关注  │  排列     │          │          │           │
│  └─────────┴──────────┴──────────┴──────────┘           │
├─────────────────────────────────────────────────────────┤
│  [综合评分]  [技术面]  [基本面]  [资金面]                   │
├─────────────────────────────────────────────────────────┤
│                  当前选中 Tab 内容区                       │
└─────────────────────────────────────────────────────────┘
```

- **核心诊断区**：4 张卡片，分别展示综合评分/趋势/估值/资金结论，综合评分卡片带颜色边框，后 3 张可点击跳转对应 Tab
- **4 个子 Tab**：综合评分（默认选中）、技术面、基本面、资金面，按需渲染（v-if）
- **综合评分默认首屏**：用户进入页面即看到量化评估结果，无需手动切换

---

## 三、技术架构

```
StockAnalysis.vue（数据加载调度 + 诊断区 + Tab 切换）
    │
    ├── TechnicalPanel.vue    技术面（纯前端计算，无需后端）
    ├── FundamentalPanel.vue  基本面（后端 API + ECharts 渲染）
    ├── CapitalFlowPanel.vue  资金面（后端 API + ECharts 渲染）
    └── ScorePanel.vue        综合评分（前端评分引擎）
```

数据加载流程：

```
用户选择股票
    │
    ▼
并行请求（Promise.allSettled，5 路并发）
    ├─ GET /api/stock/:code/kline?klt=101&lmt=250     → K线 → calcAllIndicators() → 技术指标+信号
    ├─ GET /api/stock-analysis/fundamental?code=xxx    → { latest, history }
    ├─ GET /api/stock-analysis/capital-flow?code=xxx   → { flows, priceVolumeSignal, available }
    ├─ GET /api/stock-analysis/margin?code=xxx         → { data, latest, available }
    └─ GET /api/stock-analysis/northbound?code=xxx     → { data, latest, prev, available }
    │
    ▼
calculateScore(techSignals, fundamental, capitalFlow, industry) → 评分结果
    │
    ▼
渲染诊断区 + 4 个面板
```

**防竞态机制**：`loadSeq` 计数器，每次加载递增，回调时校验 seq === loadSeq，防止切股后旧数据覆盖新数据。

---

## 四、四大分析模块

### 4.1 技术面（TechnicalPanel.vue）

**K 线图表**：单 ECharts 实例，5 个同步网格：

| 网格 | 内容 | 高度占比 |
|------|------|---------|
| Grid 0 | K 线（OHLC）+ MA(5/10/20/60) + BOLL(上/中/下轨) | 32% |
| Grid 1 | 成交量柱状图（红涨绿跌） | 8% |
| Grid 2 | MACD（DIF + DEA + 柱状图） | 10% |
| Grid 3 | KDJ（K/D/J 三线） | 10% |
| Grid 4 | RSI（6/12/24 三线，0-100 轴） | 10% |

所有网格共享 X 轴和 dataZoom 滑块，支持拖拽缩放。

**周期切换**：日K(101) / 周K(102) / 月K(103) / 60分(5) / 30分(4)，切换时 emit 事件通知父组件重新请求对应周期 K 线。

**信号徽章**：图表下方展示技术信号，按类型着色（绿色看多/红色看空/灰色中性）。

**指标计算引擎**（`indicators.js`）：

| 指标 | 函数 | 说明 |
|------|------|------|
| MA | `calcMA(closes, [5,10,20,60])` | 简单移动平均 |
| MACD | `calcMACD(closes, 12, 26, 9)` | DIF/DEA/柱状图（histogram = DIF - DEA） |
| KDJ | `calcKDJ(klines, 9)` | K/D/J 随机指标 |
| RSI | `calcRSI(closes, [6,12,24])` | Wilder 平滑相对强弱指数 |
| BOLL | `calcBOLL(closes, 20, 2)` | 布林带（样本标准差 N-1） |

入口：`calcAllIndicators(klines)` 一次计算全部 + 生成信号。使用 `klinesWithChg` 浅拷贝（不修改原始 klines）计算涨跌幅供量价信号使用。

**信号生成**（6 类，含背离检测）：

| 信号源 | 检测内容 |
|--------|---------|
| MA 均线 | 多头/空头排列；近 5 日内 MA5/10 金叉/死叉 |
| MACD | 金叉/死叉（含零轴位置上下文）；顶/底背离（峰谷识别，5 日回看） |
| KDJ | 超买(J>100)/超卖(J<0)；K/D 超买(>80)/超卖(<20)区；K/D 金叉/死叉；顶/底背离 |
| RSI | 超买(>70/80)/超卖(<20/30)；RSI(6/24) 交叉；多周期共振超买/超卖；顶/底背离 |
| BOLL | 触上轨/触下轨/中轨上方/中轨下方/带宽收口（<60% of 20 bars ago） |
| 量价 | 单日放量上涨/下跌/缩量回调/缩量下跌；连续 3 日量能趋势 vs 前 5 日均量 |

---

### 4.2 基本面（FundamentalPanel.vue）

**后端数据**（`server/stockAnalysis.js` → `getFundamentalData`）：

多数据源组合：
1. **PE/PB/总市值**：东方财富 `datacenter-web RPT_VALUEANALYSIS_DET` 报表
2. **财务指标**：东方财富 `ZYZBAjaxNew` 接口（ROE/EPS/营收/净利/毛利率/负债率等）
3. **行业归属**：东方财富 `push2his` 股票基本信息接口（f127 字段）
4. **历史 PE**：周 K 线 + EPS 推算，TTM EPS 采用累计 EPS + 上年同期桥接算法（Q1=Q1, H1=Q1+Q2-Q1'PY, Q3=Q1+Q2+Q3-H1'PY, FY=年报直接取）

返回结构：`{ latest: {...}, history: [...] }`，history 包含 9-12 个季度完整财务数据。

**3 个展示区块**：

**区块 1 — 估值区间**：
- 从 history 数组计算 PE/PB 历史分位值（排除当期数据，`h.slice(1)`）
- CSS 渐变条展示区间（低估 → 合理 → 偏高），白色标记当前位置
- 显示分位百分比（如"85分位"）

**区块 2+3 — 财务趋势图 + 核心指标（一行并排）**：

左侧：**财务趋势图**（ECharts）：
- 柱状图：近 8 个季度营收、净利润（单位：亿）
- 折线图叠加：毛利率、ROE
- 双 Y 轴：左轴金额（亿），右轴百分比（%）

右侧：**指标卡片**（3 组）：

| 分组 | 指标 | 阈值着色 |
|------|------|---------|
| 估值 | PE(TTM)、PB(MRQ) | 行业感知阈值（17 类行业独立配置） |
| 盈利能力 | ROE、毛利率、净利率 | ROE: ≥15优/≥8良/≥3一般；毛利率: ≥40优/≥20良/≥10一般 |
| 成长与安全 | 营收增长、净利增长、负债率、总市值 | 增长: ≥20高/≥5稳健/≥0放缓；负债: <40安全/<60适中/<75偏高 |

**图表生命周期**：v-if 条件渲染 + ResizeObserver 自动缩放 + watch 深度监听数据变化时重新初始化。

---

### 4.3 资金面（CapitalFlowPanel.vue）

**3 个展示区块**（按顺序）：量价分析 → 北向资金 → 融资融券

**量价分析**：
- 基于 K 线数据派生，信号标签与标题同行显示（flex 布局）
- 信号类型：放量上涨/缩量下跌/放量下跌/温和上涨/缩量调整/量价平稳
- 后端数据：`GET /api/stock-analysis/capital-flow?code=xxx`

**北向资金**（真实数据）：
- 4 项指标卡片：持股数量、持仓市值、占流通股比、持股变动
- ECharts 双轴图：持仓市值（柱状，蓝色）+ 占流通股比（折线，橙色）
- 数据来源：东方财富 `RPT_MUTUAL_HOLDSTOCKNDATE_STA_NEW`，SECUCODE 格式 `code.SZ/code.SH`
- 后端数据：`GET /api/stock-analysis/northbound?code=xxx`
- 60 分钟服务端缓存

**融资融券**（真实数据）：
- 4 项指标卡片：融资余额（亿）、融资净买入（亿，红绿色）、融券余额（万）、余额变化率（%）
- ECharts 双轴图：融资余额（柱状，半透明蓝色）+ 融资净买入额（折线，正值红色负值绿色）
- 数据来源：东方财富 `RPTA_WEB_RZRQ_GGMX`，近 30 天明细
- 20:00 前取前一天数据（当日数据未更新完毕）
- 后端数据：`GET /api/stock-analysis/margin?code=xxx`
- 30 分钟服务端缓存

**数据注入评分引擎**：
- 融资融券最新数据注入 `capitalFlow._marginLatest`
- 北向资金最新/前一日数据注入 `capitalFlow._northboundLatest` / `_northboundPrev`
- 供 `scoring.js` 评分引擎使用

**图表生命周期**：与 FundamentalPanel 相同模式（v-if + watch + ResizeObserver），数据不可用时 dispose 图表。

---

### 4.4 综合评分（ScorePanel.vue + scoring.js）

**评分架构**：

| 维度 | 满分 | 有基本面时权重 | 无基本面时权重 |
|------|------|---------------|---------------|
| 技术面 | 40 | **50%** | **65%** |
| 基本面 | 30 | **30%** | **15%** |
| 资金面 | 25 | **20%** | **20%** |

子项明细：

| 维度 | 子项 |
|------|------|
| 技术面(40) | MA趋势(0-10) + MACD(0-8) + KDJ(0-7) + RSI(0-7) + BOLL(0-4) + 量价(0-4) |
| 基本面(30) | PE估值(0-8) + ROE年化(0-8) + 营收增长(0-5) + 净利增长(0-5) + 负债率(0-4) |
| 资金面(25) | 量价趋势(0-10) + 融资融券(0-8) + 北向资金(0-7) |

**操作建议**：≥70 建议关注（绿色）/ ≥40 持续观察（黄色）/ <40 谨慎对待（红色）

**置信度**：

| 条件 | 级别 | 星级 |
|------|------|------|
| 基本面 + 资金面（含融资融券+北向）均有数据 | 高 | ★★★★★ |
| 仅基本面有数据 | 中 | ★★★☆☆ |
| 仅技术面有数据 | 低 | ★★☆☆☆ |

**行业感知 PE 阈值**（`getPEThresholds(industry)`）：

覆盖 17 个行业分类 + 1 个默认值，每个行业有 `{low, fair, high}` 三档 PE 阈值：

| 行业 | 低估 | 合理 | 偏高 |
|------|------|------|------|
| 银行 | ≤6 | ≤10 | ≤15 |
| 保险 | ≤15 | ≤25 | ≤35 |
| 食品饮料 | ≤20 | ≤35 | ≤50 |
| 医药 | ≤20 | ≤35 | ≤50 |
| 科技 | ≤25 | ≤40 | ≤60 |
| 半导体 | ≤30 | ≤50 | ≤80 |
| 券商 | ≤15 | ≤25 | ≤40 |
| ... | ... | ... | ... |

中文行业名到 key 映射：cnMap 覆盖约 30 个中文关键词（如"银行"→bank、"半导体"→semiconductor）。

**ROE 年化处理**：季报 ROE × (4 / 季度序号) 转为年化 ROE，确保不同报告期可比。

**可视化**：仪表盘（0-100）+ 操作建议标签 + 雷达图（三角形三轴）+ 三维度进度条 + 评分明细（三列并排卡片：技术面/基本面/资金面）

**诊断区卡片**：
- 综合评分：带颜色边框 + 分数 + 建议文字
- 趋势：由 `getTrendConclusion(signals)` 从信号多空比推导（强势多头/偏多/震荡/偏空/弱势空头）
- 估值：由 `getValuationConclusion(fundamental)` 从 PE 推导（低估/合理/偏高/高估/亏损）
- 资金：由 `getCapitalConclusion(capitalFlow)` 从资金数据推导

---

## 五、后端 API

所有端点注册在 `server/stockAnalysis.js` 的 `registerStockAnalysisRoutes(router)` 中。

| 方法 | 路径 | 说明 | 缓存 |
|------|------|------|------|
| GET | `/api/stock-analysis/fundamental?code=xxx` | 个股基本面（PE/PB/ROE/营收/净利/毛利率/负债率/市值/行业） | 30 分钟 |
| GET | `/api/stock-analysis/capital-flow?code=xxx` | 个股资金流向（量价分析信号） | 5 分钟 |
| GET | `/api/stock-analysis/margin?code=xxx` | 个股融资融券明细（近 30 天） | 30 分钟 |
| GET | `/api/stock-analysis/northbound?code=xxx` | 个股北向资金持仓（近 30 天） | 60 分钟 |

**缓存机制**：LRU Map（最大 200 条），插入序淘汰 + 读取更新访问序（`cacheTouch`）。`cacheSet` 先 delete 再 set，确保更新时也刷新访问序。

**数据源汇总**：

| 数据 | 东方财富 API | 报表/接口名 |
|------|-------------|------------|
| PE/PB/总市值 | datacenter-web | RPT_VALUEANALYSIS_DET |
| 财务指标 | emweb.securities | ZYZBAjaxNew |
| 行业归属 | push2his | f127 字段 |
| 融资融券 | datacenter-web | RPTA_WEB_RZRQ_GGMX |
| 北向资金 | datacenter-web | RPT_MUTUAL_HOLDSTOCKNDATE_STA_NEW |
| 历史PE | push2his | 周K线 + EPS 推算 |

---

## 六、文件清单

```
server/
  index.js                          # registerStockAnalysisRoutes(router)
  stockAnalysis.js                  # 个股分析后端（基本面/资金流/融资融券/北向资金 + LRU缓存）

src/
  router/index.js                   # /stock-analysis 路由
  utils/indicators.js               # 技术指标计算（MA/MACD/KDJ/RSI/BOLL）+ 6 类信号生成
  utils/scoring.js                  # 三维度动态权重评分 + 行业感知 PE 阈值 + 置信度
  views/StockAnalysis.vue           # 分析主页面（数据加载 + 诊断区 + Tab 切换）
  components/NavBar.vue             # 导航栏（"个股分析"入口）
  components/analysis/
    TechnicalPanel.vue              # 技术面（K线图表 + 周期切换 + 信号徽章）
    FundamentalPanel.vue            # 基本面（PE/PB分位 + 财务趋势图 + 指标卡片）
    CapitalFlowPanel.vue            # 资金面（量价分析 + 北向资金 + 融资融券）
    ScorePanel.vue                  # 综合评分（仪表盘 + 雷达图 + 三列明细）
```

---

## 七、已知限制

| 限制 | 原因 | 当前处理 |
|------|------|---------|
| 行业归属偶发获取失败 | push2his 偶发 socket hang up | console.warn 日志，评分引擎使用默认 PE 阈值 |
| EPSJB 数据含义 | 东方财富 EPSJB 为累计值（Q1/H1/Q3/FY），非单季度 | TTM 计算采用桥接算法正确处理 |
| 融资融券当日数据 | 当日数据可能未更新 | 20:00 前自动取前一天数据 |
| 北向数据覆盖范围 | 仅覆盖沪深股通标的 | 非标的无数据，显示"暂不可用" |
| 无消息面 | 公告/研报/新闻 API 未接入 | 暂无此维度 |

---

## 八、优化方向

| 优先级 | 方向 | 说明 |
|--------|------|------|
| P1 | 分时图集成 | 在技术面 Tab 新增盘中分时走势 |
| P1 | K 线十字线联动 | dataZoom 联动鼠标悬停十字线 |
| P2 | 可搜索股票选择器 | 替换下拉框为搜索输入 + 候选列表 |
| P2 | 行业对比表 | 同行业个股基本面横向对比 |
| P2 | 新增技术指标（SAR/CCI/OBV） | 丰富技术分析工具箱 |
| P3 | 公告/研报 API | 新增消息面分析维度 |
