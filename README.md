# SmartStock 智能股票交易辅助系统

面向 A 股个人投资者的盘中实时交易辅助工具。将规则化交易体系转化为可交互的 Web 应用，作为「纪律执行器」帮助用户完成：**判断大盘环境 → 策略选股 → 仓位计算 → 交易记录 → 复盘分析**的完整闭环。

## 功能概览

| 页面 | 功能 |
|------|------|
| 大盘状态 | 七维判据自动判定市场牛熊，加权评分 + 状态惯性 + 策略选股建议 + 长窗口速判 + 交易前检查清单 |
| 股票池 | 搜索添加自选股，实时行情自动刷新，6 周期 K 线图，分时走势，基本面数据 |
| 选股筛选 | 四层漏斗（排雷→基本面→景气度→技术信号），生成东方财富一句话选股条件 |
| 仓位计算 | ATR 动态止损/仓位/盈亏比计算，持仓管理，行业集中度监控 |
| 交易日志 | 交易全生命周期记录，平仓复盘评分，绩效统计，违规分析 |
| 策略速查 | 10 章节交易规则参考手册，随时查阅 |

## 技术栈

- **前端**: Vue 3.5 + Vite 6 + Vue Router 4 + Pinia 2 (Composition API)
- **后端**: Koa 2 + @koa/router + koa-bodyparser (纯 API 代理层，无数据库)
- **数据源**: 东方财富公开 API（主用）+ 腾讯/新浪备用（通过后端代理避免 CORS）
- **持久化**: localStorage（所有用户数据本地存储）

## 项目结构

```
final-trade/
├── index.html
├── package.json                # 前端依赖
├── vite.config.js              # Vite 配置，/api 代理到 localhost:3001
├── server/
│   ├── package.json            # 后端依赖
│   ├── index.js                # Koa API 代理（16 条路由）
│   └── fallback.js             # 腾讯/新浪备用数据源
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── router/index.js         # 6 条页面路由
│   ├── stores/
│   │   ├── market.js           # 大盘数据
│   │   ├── watchlist.js        # 自选股 + 行情刷新
│   │   ├── position.js         # 持仓管理
│   │   └── journal.js          # 交易日志 + 绩效统计
│   ├── utils/
│   │   ├── marketJudge.js      # 七维大盘判定算法（v6）
│   │   ├── position.js         # ATR 仓位/止损/盈亏比计算
│   │   ├── screenerPrompt.js   # 四层漏斗选股 prompt 生成器（Dashboard + Screener 共用）
│   │   ├── storage.js          # localStorage 统一读写工具
│   │   └── constants.js        # 交易规则常量 + 全局刷新间隔
│   ├── components/
│   │   ├── NavBar.vue          # 顶部导航
│   │   ├── Sparkline.vue       # Canvas 迷你走势图
│   │   ├── IntradayChart.vue   # Canvas 分时图（价格线 + 成交量）
│   │   └── KlineChart.vue      # K 线图组件
│   ├── views/
│   │   ├── Dashboard.vue       # 大盘状态 + 策略选股建议
│   │   ├── Watchlist.vue       # 股票池
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
| GET | `/api/market/breadth` | 沪深京A股涨跌家数（push2 → 新浪二级回退） |
| GET | `/api/market/indices/intraday` | 三大指数分时数据 |
| GET | `/api/market/northbound` | 近 20 日北向资金成交额 |
| GET | `/api/market/margin` | 融资融券余额 |
| GET | `/api/market/limit-stats` | 涨跌停统计（涨停/跌停/封板率/赚钱效应/打板次日收益） |
| GET | `/api/stock/:code/kline` | 个股日 K 线（120 日） |
| GET | `/api/stock/:code/kline5y` | 个股日 K 线（~1200 日） |
| GET | `/api/stock/:code/intraday` | 个股分时数据 |
| GET | `/api/stock/:code/intraday5d` | 个股近 5 日分时数据 |
| GET | `/api/stock/:code/basic` | 个股基本面（PE/PB/市值/ROE） |
| GET | `/api/stock/batch/quotes` | 批量实时行情 |
| GET | `/api/stock/search` | 搜索股票（代码/名称/拼音） |
| GET | `/api/stock/screen` | 策略选股 — 备用（趋势突破/回调买入） |
| POST | `/api/stock/xuangu` | 一句话选股 — 主用（自然语言条件，调用东方财富 xuangu API） |

## 核心功能

### 七维大盘判定

从 7 个维度自动判断市场状态（牛市/偏多/震荡/偏空/熊市），采用**加权评分 + 状态惯性**机制：

1. **MACD**（权重 1.0）— DIF/DEA 金叉死叉、零轴位置、柱状图变化、背离检测
2. **涨跌家数**（权重 1.5）— 沪深京A股涨跌比 + 历史趋势
3. **RSI**（权重 1.0）— RSI(14) 超买超卖与趋势方向、背离检测
4. **融资余额**（权重 1.2）— 10 日线性回归斜率 + 加速度分析
5. **量价配合**（权重 1.3）— OBV 趋势 + 顶底背离检测
6. **北向资金**（权重 1.5）— 5 日/20 日均量比 + 成交额趋势方向
7. **涨跌停**（权重 1.3）— 并行评分（涨跌比/跌停数/涨停质量/打板次日收益/封板率/赚钱效应）

**加权评分**: 各维度乘以权重累加至 bullW/bearW，强信号（背离、极端比值等）额外 ×1.5。

**状态惯性（hysteresis）**: 跨方向切换需 |net| ≥ 2.5，防止相邻判定周期状态频繁跳变。

**阈值**: 牛市/熊市 ≥ 4.5，偏多/偏空 ≥ 3.0，确认 ≥ 3.5。

≥ 3.5 加权分的同向信号确认状态，状态映射到建议仓位和推荐策略。

### 策略选股建议

根据七维判据结果自动匹配策略，复用选股筛选页面的**四层漏斗逻辑**生成自然语言选股条件（由 `screenerPrompt.js` 共用工具函数生成），通过东方财富 xuangu API 实时查询：

| 市场状态 | 推荐策略 | 选股条件 |
|---------|---------|---------|
| 牛市 | 趋势突破 | 排雷8项 + ROE>12%, 营收/利润增速>10%, PE 5-40, 市值≥30亿, MACD金叉+均线多头 |
| 偏多 | 回调买入 | 排雷8项 + ROE>12%, PE 5-40, 负债率<60%, 市值≥50亿, 接近MA20+缩量 |
| 震荡 | 回调买入 | 排雷8项 + ROE>12%, PE 5-30, 负债率<60%, 现金流+, 市值≥50亿, 接近MA20+缩量 |
| 偏空/熊市 | 空仓观望 | 不生成选股建议 |

系统自动生成一句话选股条件并实时查询，用户可编辑条件自定义选股。Dashboard 和 Screener 页面共用同一套 prompt 生成逻辑。

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

Dashboard 涨跌家数使用独立的 30 秒刷新定时器（`BREADTH_INTERVAL`），服务端缓存也为 30 秒（`BREADTH_CACHE_TTL`），确保盘中数据实时性。其余市场数据服务端缓存 5 分钟。前一市场状态持久化到 localStorage（`market_prev_status`），状态惯性机制在页面刷新后继续生效。

## 数据查询策略

- 9:00 前使用前一交易日日期参数查询（获取最新收盘数据）
- 9:00 后使用当前日期参数查询（获取盘中实时数据）
- 东方财富 push2 系列域名不稳定时自动回退：涨跌家数走新浪批量查询，个股数据走腾讯备用
- 北向资金使用 datacenter-web RPT_MUTUAL_DEALAMT 报表，不依赖 push2 域名
- 选股优先使用 xuangu API（`POST /api/stock/xuangu`），不可用时回退本地筛选（`GET /api/stock/screen`）

## 配色说明

遵循 A 股惯例：**红涨绿跌**。

- `#ff453a` (红) — 涨、盈利、牛市信号
- `#30d158` (绿) — 跌、亏损、熊市信号

## License

MIT
