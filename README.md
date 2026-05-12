# SmartStock 智能股票交易辅助系统

面向 A 股个人投资者的盘中实时交易辅助工具。将规则化交易体系转化为可交互的 Web 应用，作为「纪律执行器」帮助用户完成：**判断大盘环境 → 选股筛选 → 仓位计算 → 交易记录 → 复盘分析**的完整闭环。

## 功能概览

| 页面 | 功能 |
|------|------|
| 大盘状态 | 六维判据自动判定市场牛熊，综合打分 + 长窗口速判 + 交易前检查清单 |
| 股票池 | 搜索添加自选股，实时行情 30s 刷新，6 周期走势图，基本面数据 |
| 选股筛选 | 四层漏斗（排雷→基本面→景气度→技术信号），生成东方财富筛选条件 |
| 仓位计算 | ATR 动态止损/仓位/盈亏比计算，持仓管理，行业集中度监控 |
| 交易日志 | 交易全生命周期记录，平仓复盘评分，绩效统计，违规分析 |
| 策略速查 | 10 章节交易规则参考手册，随时查阅 |

## 技术栈

- **前端**: Vue 3.5 + Vite 6 + Vue Router 4 + Pinia 2 (Composition API)
- **后端**: Koa 2 + @koa/router (纯 API 代理层，无数据库)
- **数据源**: 东方财富公开 API（通过后端代理避免 CORS）
- **持久化**: localStorage（所有用户数据本地存储）

## 项目结构

```
final-trade/
├── index.html
├── package.json                # 前端依赖
├── vite.config.js              # Vite 配置，/api 代理到 localhost:3001
├── server/
│   ├── package.json            # 后端依赖
│   └── index.js                # Koa API 代理（11 条路由）
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
│   │   ├── marketJudge.js      # 六维大盘判定算法
│   │   ├── position.js         # ATR 仓位/止损/盈亏比计算
│   │   └── constants.js        # 交易规则常量
│   ├── components/
│   │   ├── NavBar.vue          # 顶部导航
│   │   └── Sparkline.vue       # Canvas 迷你走势图
│   ├── views/
│   │   ├── Dashboard.vue       # 大盘状态
│   │   ├── Watchlist.vue       # 股票池
│   │   ├── Screener.vue        # 选股筛选
│   │   ├── Position.vue        # 仓位计算
│   │   ├── Journal.vue         # 交易日志
│   │   └── Guide.vue           # 策略速查
│   └── styles/
│       └── global.css          # CSS 变量 + 全局样式
└── docs/
    └── PRD.md
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
| GET | `/api/market/breadth` | 沪深涨跌家数 |
| GET | `/api/market/indices/intraday` | 三大指数分时数据 |
| GET | `/api/market/northbound` | 近 5 日北向资金 |
| GET | `/api/stock/:code/kline` | 个股日 K 线（120 日） |
| GET | `/api/stock/:code/kline5y` | 个股日 K 线（~1200 日） |
| GET | `/api/stock/:code/intraday` | 个股分时数据 |
| GET | `/api/stock/:code/basic` | 个股基本面（PE/PB/市值） |
| GET | `/api/stock/batch/quotes` | 批量实时行情 |
| GET | `/api/stock/search` | 搜索股票（代码/名称/拼音） |

## 核心算法

### 六维大盘判定

从 6 个维度自动判断市场状态（牛市/偏多/震荡/偏空/熊市）：

1. **均线系统** — MA20/60/120 多空排列
2. **价格 vs MA60** — 站上/跌破
3. **创新高/低** — 近 20 日新高新低家数比
4. **涨跌家数** — 沪深涨跌比
5. **成交量趋势** — 5 日均量 vs 20 日均量
6. **北向资金** — 近 5 日净流入天数

≥ 3 个信号方向一致则确认状态，状态映射到建议仓位和推荐策略。

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

## 配色说明

遵循 A 股惯例：**红涨绿跌**。

- `#ff453a` (红) — 涨、盈利、牛市信号
- `#30d158` (绿) — 跌、亏损、熊市信号

## License

MIT
