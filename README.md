# SmartStock 智能股票交易辅助系统

面向 A 股个人投资者的盘中实时交易辅助工具。将规则化交易体系转化为可交互的 Web 应用，作为「纪律执行器」帮助用户完成：**判断大盘环境 → 策略选股 → 仓位计算 → 交易记录 → 复盘分析**的完整闭环。

## 功能概览

| 页面 | 功能 |
|------|------|
| 大盘状态 | 八维判据自动判定市场牛熊（含宏观因子），加权评分 + 状态惯性 + 行业资金流向 & RS 轮动 + 策略选股建议 + 长窗口速判 + 交易前检查清单 |
| 股票池 | 搜索添加自选股，实时行情自动刷新，6 周期 K 线图，分时走势，基本面数据 |
| 个股分析 | 综合评分（技术面/基本面/资金面三维度加权）+ 技术指标信号 + 估值分位 + 财务趋势 + 北向资金 + 融资融券 |
| 选股筛选 | 四层漏斗（排雷→基本面→景气度→技术信号），生成东方财富一句话选股条件，支持 RS 行业过滤 |
| 仓位计算 | ATR 动态止损/仓位/盈亏比计算，持仓管理，行业集中度监控 |
| 交易日志 | 交易全生命周期记录，平仓复盘评分，绩效统计，违规分析 |
| 策略速查 | 10 章节交易规则参考手册，随时查阅 |

## 技术栈

- **前端**: Vue 3.5 + Vite 6 + Vue Router 4 + Pinia 2 (Composition API)
- **后端**: Koa 2 + @koa/router + koa-bodyparser (纯 API 代理层，无数据库)
- **数据源**: 东方财富公开 API（主用）+ macroview.club（社融）+ 证券时报/腾讯/新浪备用（通过后端代理避免 CORS）
- **持久化**: localStorage（用户数据）+ 服务端文件（板块 RS 历史快照）

## 项目结构

```
final-trade/
├── index.html
├── package.json                # 前端依赖
├── vite.config.js              # Vite 配置，/api 代理到 localhost:3001
├── server/
│   ├── package.json            # 后端依赖
│   ├── index.js                # Koa API 代理（含北向资金双源容错）
│   ├── analysis.js             # 分析引擎（宏观评分/板块RS/估值分析）
│   ├── stockAnalysis.js        # 个股分析引擎（基本面/资金流/融资融券/北向资金）
│   └── fallback.js             # 腾讯/新浪备用数据源
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── router/index.js         # 8 条页面路由
│   ├── stores/
│   │   ├── market.js           # 大盘数据（指数/涨跌/融资/北向/涨跌停）
│   │   ├── marketAnalysis.js   # 分析数据（宏观因子/板块RS/估值）
│   │   ├── watchlist.js        # 自选股 + 行情刷新
│   │   ├── position.js         # 持仓管理
│   │   └── journal.js          # 交易日志 + 绩效统计
│   ├── utils/
│   │   ├── marketJudge.js      # 八维大盘判定算法（v7，前7维）
│   │   ├── marketCycle.js      # 五维周期定位引擎（10阶段）
│   │   ├── indicators.js       # 技术指标计算（MA/MACD/KDJ/RSI/BOLL + 6类信号生成）
│   │   ├── scoring.js          # 个股评分引擎（三维度加权 + 行业感知PE阈值）
│   │   ├── position.js         # ATR 仓位/止损/盈亏比计算
│   ├── utils/
│   │   ├── marketJudge.js      # 八维大盘判定算法（v7，前7维）
│   │   ├── marketCycle.js      # 五维周期定位引擎（10阶段）
│   │   ├── screenerPrompt.js   # 四层漏斗选股 prompt 生成器（Dashboard + Screener 共用）
│   │   ├── storage.js          # localStorage 统一读写工具
│   │   └── constants.js        # 交易规则常量 + 全局刷新间隔
│   │   ├── storage.js          # localStorage 统一读写工具
│   │   └── constants.js        # 交易规则常量 + 全局刷新间隔
│   ├── components/
│   │   ├── NavBar.vue          # 顶部导航
│   │   ├── Sparkline.vue       # Canvas 迷你走势图
│   │   ├── IntradayChart.vue   # Canvas 分时图（价格线 + 成交量）
│   │   ├── KlineChart.vue      # K 线图组件
│   │   └── analysis/
│   │       ├── TechnicalPanel.vue   # 技术面（K线图 + 指标 + 信号列表）
│   │       ├── FundamentalPanel.vue # 基本面（PE/PB分位 + 财务趋势图 + 指标卡片）
│   │       ├── CapitalFlowPanel.vue # 资金面（量价分析 + 北向资金 + 融资融券）
│   │       └── ScorePanel.vue       # 综合评分（仪表盘 + 雷达图 + 三列明细）
│   ├── views/
│   │   ├── Dashboard.vue       # 大盘状态 + 宏观卡片 + 行业资金流向 & RS轮动 + 策略选股建议
│   │   ├── Watchlist.vue       # 股票池
│   │   ├── StockAnalysis.vue   # 个股分析（综合评分/技术面/基本面/资金面）
│   │   ├── Screener.vue        # 选股筛选
│   │   ├── Position.vue        # 仓位计算
│   │   ├── Journal.vue         # 交易日志
│   │   └── Guide.vue           # 策略速查
│   └── styles/
│       └── global.css          # CSS 变量 + 全局样式
└── docs/
    ├── PRD.md
    ├── 东方财富实战选股提示词.md
    ├── 顶级股票交易系统.md
    └── 世界顶级交易系统全景梳理.md
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与启动

```bash
# 1. 安装前端依赖
npm install

# 2. 安装后端依赖
cd server && npm install && cd ..

# 3. 启动后端（端口 3001）
cd server && node index.js

# 4. 启动前端开发服务器（端口 5173）
npm run dev
```

浏览器打开 `http://localhost:5173` 即可使用。

### 生产构建

```bash
npm run build      # 输出到 dist/
cd server && node index.js   # 启动后端，配合静态文件服务使用
```

## API 路由

后端代理东方财富公开数据，统一返回 `{ ok: boolean, data?: any, error?: string }`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/market/indices` | 三大指数 + MA20/60/120 |
| GET | `/api/market/breadth` | 沪深京A股涨跌家数（新浪批量15并发，30秒缓存） |
| GET | `/api/market/indices/intraday` | 三大指数分时数据 |
| GET | `/api/market/northbound` | 近 20 日北向资金成交额（东方财富主用，证券时报 stcn 备用） |
| GET | `/api/market/margin` | 融资融券余额 |
| GET | `/api/market/limit-stats` | 涨跌停统计（涨停/跌停/封板率/赚钱效应/打板次日收益，JRJ主用含市场热度+历史） |
| GET | `/api/analysis/macro` | 宏观因子评分（PMI/M1-M2/CPI/GDP/社融），6小时缓存 |
| GET | `/api/analysis/sectors` | 行业排名 + 资金流向 + RS轮动信号（涨幅TOP5/资金TOP5/RS强弱TOP5），等长窗口超额收益 |
| GET | `/api/analysis/valuation` | 估值分析（PE/MA250/股债利差/52周高低） |
| GET | `/api/stock/:code/kline` | 个股日 K 线（120 日） |
| GET | `/api/stock/:code/kline5y` | 个股日 K 线（~1200 日） |
| GET | `/api/stock/:code/intraday` | 个股分时数据 |
| GET | `/api/stock/:code/intraday5d` | 个股近 5 日分时数据 |
| GET | `/api/stock/:code/basic` | 个股基本面（PE/PB/市值/ROE） |
| GET | `/api/stock/batch/quotes` | 批量实时行情 |
| GET | `/api/stock/search` | 搜索股票（代码/名称/拼音） |
| GET | `/api/stock/screen` | 策略选股 — 备用（趋势突破/回调买入） |
| POST | `/api/stock/xuangu` | 一句话选股 — 主用（自然语言条件，调用东方财富 xuangu API） |
| GET | `/api/stock-analysis/fundamental` | 个股基本面（PE/PB/ROE/营收/净利/毛利率/负债率/市值/行业），30分钟缓存 |
| GET | `/api/stock-analysis/capital-flow` | 个股资金流向（量价分析），5分钟缓存 |
| GET | `/api/stock-analysis/margin` | 个股融资融券明细（近30天），30分钟缓存 |
| GET | `/api/stock-analysis/northbound` | 个股北向资金持仓（近30天），60分钟缓存 |

## 核心功能

### 八维大盘判定

从 8 个维度自动判断市场状态（牛市/偏多/震荡/偏空/熊市），采用**加权评分 + 状态惯性**机制：

1. **MACD**（权重 1.0）— DIF/DEA 金叉死叉、零轴位置、柱状图变化、背离检测
2. **涨跌家数**（权重 1.5）— 沪深京A股涨跌比 + 历史趋势
3. **RSI**（权重 1.0）— RSI(14) 超买超卖与趋势方向、背离检测
4. **融资余额**（权重 1.2）— 10 日线性回归斜率 + 加速度分析
5. **量价配合**（权重 1.3）— OBV 趋势 + 顶底背离检测 + 成交额/量智能显示
6. **北向资金**（权重 1.5）— 5 日/20 日均量比 + 成交额趋势方向
7. **涨跌停**（权重 1.3）— 并行评分（涨跌比/跌停数/涨停质量/打板次日收益/封板率/赚钱效应）
8. **宏观因子**（\|score\| × 0.5）— 服务端 5 因子评分：PMI(±1) + M1-M2剪刀差(±1) + CPI(-1~-0.5) + GDP(±0.5) + 社融(±0.5)，clamp [-2,+2]

**加权评分**: 各维度乘以权重累加至 bullW/bearW，强信号（背离、极端比值等）额外 ×1.5。

**状态惯性（hysteresis）**: 跨方向切换需 |net| ≥ 2.5，防止相邻判定周期状态频繁跳变。

**阈值**: 牛市/熊市 ≥ 4.5，偏多/偏空 ≥ 3.0，确认 ≥ 3.5。

≥ 3.5 加权分的同向信号确认状态，状态映射到建议仓位和推荐策略。

### 策略选股建议

根据八维判据结果自动匹配策略，复用选股筛选页面的**四层漏斗逻辑**生成自然语言选股条件（由 `screenerPrompt.js` 共用工具函数生成），自动注入 RS 强势行业过滤条件，通过东方财富 xuangu API 实时查询：

| 市场状态 | 推荐策略 | 选股条件 |
|---------|---------|---------|
| 牛市 | 趋势突破 | 排雷8项 + ROE>12%, 营收/利润增速>10%, 负债率<60%, PE 5-40, 市值≥50亿, 放量突破+MACD金叉+均线多头 |
| 偏多 | 回调买入 | 排雷8项 + ROE>12%, PE 5-40, 负债率<60%, 市值≥50亿, 接近MA20+缩量 |
| 震荡 | 回调买入 | 排雷8项 + ROE>12%, PE 5-30, 负债率<60%, 现金流+, 市值≥50亿, 接近MA20+缩量 |
| 偏空/熊市 | 空仓观望 | 不生成选股建议 |

系统自动生成一句话选股条件并实时查询，用户可编辑条件自定义选股。Dashboard 和 Screener 页面共用同一套 prompt 生成逻辑。

### 行业资金流向 & 板块 RS 轮动

Dashboard 统一面板展示：

**资金流向**（三级行业分类，东方财富 ZJLX API，始终显示）：
- 涨幅 TOP5 + 主力净流入 TOP5
- 含主力净流入金额、领涨股

**板块 RS 轮动**（基于每日板块快照，持久化到 `server/rs_history.json`，保留 30 天）：
- 板块与基准使用等长窗口计算超额收益，确保可比性
- **RS Score** = excess5d × 0.5 + excess10d × 0.3 + excess20d × 0.2（板块超额收益加权）
- **轮动信号**: TOP10 板块中加速 ≥ 6 → `strengthening`，减速 ≥ 6 → `weakening`，其他 → `mixed`
- Dashboard 显示 RS 强势/弱势 TOP5，需 ≥ 5 天历史快照
- 策略选股自动注入 TOP3 强势行业

### 宏观因子评分

服务端从东方财富数据中心获取 CPI/PMI/M2/GDP，从 macroview.club 获取社融增量历史数据，独立评分后累加：

| 因子 | 正面 | 负面 | 分值 |
|------|------|------|------|
| PMI | > 50.5 | < 49.5 | ±1 |
| M1-M2 剪刀差 | 收窄 | 扩大 | ±1 |
| CPI | 0-2%（温和） | > 2%（通胀），< 0%（通缩） | -1~-0.5 |
| GDP | > 5.5% | < 4.5% | ±0.5 |
| 社融 | 年增量同比 > 5% | < -5% | ±0.5 |

总分 clamp 到 [-2, +2]，作为第 8 维度修正项（权重 = \|score\| × 0.5）加入八维判据。

### 个股综合评分

三维度加权评分引擎（`src/utils/scoring.js`），对自选股进行全方位量化评估：

| 维度 | 满分 | 子项 |
|------|------|------|
| 技术面 | 40 | MA趋势(10) + MACD(8) + KDJ(7) + RSI(7) + BOLL(4) + 量价(4) |
| 基本面 | 30 | PE估值(8) + ROE(8) + 营收增长(5) + 净利增长(5) + 负债率(4) |
| 资金面 | 25 | 量价趋势(10) + 融资融券(8) + 北向资金(7) |

动态权重：有基本面数据时 50/30/20，无基本面时 65/15/20。PE 阈值按 17 个行业分类独立配置。技术指标信号由 `src/utils/indicators.js` 生成，包含 MA/MACD/KDJ/RSI/BOLL/量价 6 类信号检测器，支持背离检测。

### ATR 动态仓位计算

- **止损价** = 买入价 − N × ATR(14)
- **仓位** = min(总资金 × 2% / 止损幅度, 总资金 × 25%)
- **跟踪止盈** = max(昨日止盈价, 最高收盘价 × (1 − 回撤比例))，只上移不下调

三种策略参数：

| 策略 | ATR 乘数 N | 回撤比例 | 持有期 |
|------|-----------|---------|--------|
| 趋势突破 | 1.5 | 8% | 1-4 周 |
| 回调买入 | 2.0 | 15% | 2-8 周 |
| 底部右侧确认 | 3.0 | 20% | 1-6 月 |

## 全局配置

定时刷新间隔统一在 `src/utils/constants.js` 的 `REFRESH_INTERVAL` 中配置（默认 10000ms），所有页面的定时器共用同一设置。

Dashboard 涨跌家数使用独立的 30 秒刷新定时器（`BREADTH_INTERVAL`），服务端缓存也为 30 秒（`BREADTH_CACHE_TTL`），确保盘中数据实时性。宏观因子服务端缓存 6 小时（宏观数据低频更新），板块 RS + 行业资金流向数据服务端缓存 5 分钟。前一市场状态持久化到 localStorage（`market_prev_status`），状态惯性机制在页面刷新后继续生效。

## 数据查询策略

- 9:00 前使用前一交易日日期参数查询（获取最新收盘数据）
- 9:00 后使用当前日期参数查询（获取盘中实时数据）
- 东方财富 push2 系列域名从服务器端不可达，涨跌家数走新浪批量查询（15并发，30秒缓存），个股数据走腾讯备用
- 北向资金使用 datacenter-web RPT_MUTUAL_DEALAMT 报表（主用），失败时自动回退证券时报 stcn 数据源
- 选股优先使用 xuangu API（`POST /api/stock/xuangu`），不可用时回退本地筛选（`GET /api/stock/screen`）
- 个股分析数据均来自东方财富 datacenter-web API：基本面(RPT_VALUEANALYSIS_DET + ZYZBAjaxNew)、融资融券(RPTA_WEB_RZRQ_GGMX)、北向资金(RPT_MUTUAL_HOLDSTOCKNDATE_STA_NEW)
- 服务端 LRU 缓存（Map 插入序 + 读取序更新），基本面/融资融券 30 分钟、资金流 5 分钟、北向资金 60 分钟

## 配色说明

遵循 A 股惯例：**红涨绿跌**。

- `#ff453a` (红) — 涨、盈利、牛市信号
- `#30d158` (绿) — 跌、亏损、熊市信号

## License

MIT
