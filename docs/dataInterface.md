# SmartStock 数据接口文档

> 基地址: `http://localhost:3001/api`
> 统一响应格式: `{ ok: boolean, data?: any, error?: string }`
> 开发代理: Vite 将 `/api` 代理到 `localhost:3001`

---

## 目录

- [1. 通用说明](#1-通用说明)
- [2. 市场数据接口](#2-市场数据接口)
- [3. 市场分析接口](#3-市场分析接口)
- [4. 个股数据接口](#4-个股数据接口)
- [5. 个股分析接口](#5-个股分析接口)
- [6. AI 分析接口](#6-ai-分析接口)
- [7. 上游数据源汇总](#7-上游数据源汇总)

---

## 1. 通用说明

### 1.1 缓存策略

| 缓存位置 | 数据类型 | TTL |
|---------|---------|-----|
| 服务端 LRU Map | 涨跌家数 | 30 秒 |
| 服务端 LRU Map | 资金流向 / 主力资金 / 分时 | 3~5 分钟 |
| 服务端 LRU Map | 融资融券 / 基本面 | 30 分钟 |
| 服务端 LRU Map | 北向资金 / 股东户数 | 10~60 分钟 |
| 服务端 LRU Map | 指数 / 融资余额 / 估值 | 5~60 分钟 |
| 服务端 LRU Map | 宏观因子 | 6 小时 |
| 服务端磁盘 | 板块 RS 历史 (`rs_history.json`) | 每日快照，保留 30 天 |

### 1.2 容错机制

- 所有请求优先使用 Node.js 内置 `fetch`，超时 8 秒自动中断
- `fetch` 失败自动回退到 `https` 模块（强制 IPv4 DNS 解析）
- 指数 K 线不足时从腾讯 (`qt.gtimg.cn`) 补取
- 北向资金主用东方财富，失败回退证券时报 (`stcn`)
- 板块排名支持 4 源容错：资金流向 → 东方财富 → 新浪 → 腾讯
- 涨跌停主用金融界 JRJ，失败回退东方财富

### 1.3 股票代码格式

- 输入参数统一使用 6 位数字代码，如 `600519`、`000001`
- 东方财富 secid 格式：上海 `1.{code}`，深圳 `0.{code}`
- 内部函数 `toSecid(code)` 自动转换

---

## 2. 市场数据接口

### 2.1 健康检查

```
GET /api/health
```

**响应示例**:
```json
{ "ok": true, "data": { "status": "running", "time": "2026-05-24T10:00:00.000Z" } }
```

---

### 2.2 三大指数 + K 线 + 均线

```
GET /api/market/indices
```

**缓存**: 5 分钟

**上游数据源**:
- 行情: `push2his.eastmoney.com/api/qt/ulist.np/get`
- K 线 (120日): `push2his.eastmoney.com/api/qt/stock/kline/get`
- 备用 K 线: `web.ifzq.gtimg.cn/appstock/app/fqkline/get`（腾讯）

**响应字段**:

返回 `data` 为对象，key 为 `sh`(上证)、`sz`(深证)、`cyb`(创业板)：

| 字段 | 类型 | 说明 |
|------|------|------|
| `quote` | Object | `{ code, name, close, change, changeAmt, high, low, open, volume, amount }` |
| `klines` | Array | 最近 120 根日 K 线: `[{ date, open, close, high, low, volume, amount }]` |
| `ma` | Object | `{ ma20, ma60, ma120 }` |
| `ma60Trend` | Array | 最近 4 天的 MA60 值（用于判断 MA60 趋势） |

---

### 2.3 涨跌家数

```
GET /api/market/breadth
```

**缓存**: 30 秒

**上游数据源**: `push2.eastmoney.com/api/qt/ulist/get`
- secids: `1.000002`(沪A) + `0.399002`(深A) + `0.899050`(北交所)
- 字段: f104(涨) / f105(跌) / f106(平)

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `up` | Number | 上涨家数（沪A + 深A + 北交所） |
| `down` | Number | 下跌家数 |
| `flat` | Number | 平盘家数 |

---

### 2.4 三大指数分时

```
GET /api/market/indices/intraday
```

**上游数据源**: `push2his.eastmoney.com/api/qt/stock/trends2/get`
- 备用: 腾讯 `web.ifzq.gtimg.cn`

**响应字段**:

返回对象，key 为 `sh`/`sz`/`cyb`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | String | 指数名称 |
| `code` | String | 指数代码 |
| `preClose` | Number | 昨收价 |
| `trends` | Array | `[{ time, close, avg, volume }]`，1 分钟粒度 |

---

### 2.5 北向资金

```
GET /api/market/northbound
```

**缓存**: 5 分钟

**上游数据源**:
- 主用: `datacenter-web.eastmoney.com` — `RPT_MUTUAL_DEALAMT` 报表
- 备用: `info.stcn.com` — 证券时报

**响应字段**:

返回数组，最近 25 日：

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | String | 日期 YYYY-MM-DD |
| `nfAmt` | Number | 北向成交额（百万元） |
| `sscAmt` | Number | 深股通成交额 |
| `stAmt` | Number | 沪股通成交额 |
| `sciRate` | Number | 科创板占比 |
| `sscRate` | Number | 深股通变化率 |
| `source` | String | 数据源（仅 stcn 返回） |

---

### 2.6 融资余额

```
GET /api/market/margin
```

**缓存**: 5 分钟

**上游数据源**: `datacenter-web.eastmoney.com` — `RPTA_RZRQ_LSHJ` 报表

**响应字段**:

返回数组，最近 10 日：

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | String | 日期 |
| `rzBalance` | Number | 融资余额 |
| `rzBuy` | Number | 融资买入额 |
| `rzRepay` | Number | 融资偿还额 |
| `rzNetBuy` | Number | 融资净买入 |
| `rqBalance` | Number | 融券余额 |
| `totalBalance` | Number | 融资融券余额 |

---

### 2.7 涨跌停统计

```
GET /api/market/limit-stats
```

**上游数据源**:
- 主用: 金融界 `gateway.jrj.com`（含市场热度、分布桶、10日历史）
- 补充: 东方财富 `RPT_CUSTOM_INTSELECTION_LIMIT` 报表（封板率、赚钱效应、打板次日收益）
- 备用: 东方财富 `push2ex.eastmoney.com/getTopicZDFenBu`（涨跌分布）

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | String | 日期 |
| `limitUp` | Number | 涨停数 |
| `limitDown` | Number | 跌停数 |
| `up5p` | Number | 涨幅≥5%股票数 |
| `down5p` | Number | 跌幅≥5%股票数 |
| `temperature` | Number | 市场温度（0~100） |
| `totalStocks` | Number | 总股票数 |
| `stopped` | Number | 停牌数 |
| `naturalLimit` | Number | 自然涨停数 |
| `touchLimit` | Number | 曾涨停数 |
| `sealingRate` | Number | 封板率（%） |
| `moneyEffect` | Number | 赚钱效应（%） |
| `t1PctChange` | Number | 打板次日收益（%） |
| `buckets` | Array | 涨跌幅分布桶 |
| `history` | Array | 最近 10 日历史 `{ date, limitUp, limitDown, upMoM, downMoM, marketAmount }` |
| `source` | String | 数据源（`jrj` 或 `eastmoney`） |

---

## 3. 市场分析接口

### 3.1 宏观因子评分

```
GET /api/analysis/macro
```

**缓存**: 6 小时

**上游数据源**:
- CPI: `datacenter-web.eastmoney.com` — `RPT_ECONOMY_CPI`
- PMI: `datacenter-web.eastmoney.com` — `RPT_ECONOMY_PMI`
- M2/M1: `datacenter-web.eastmoney.com` — `RPT_ECONOMY_CURRENCY_SUPPLY`
- GDP: `datacenter-web.eastmoney.com` — `RPT_ECONOMY_GDP`
- 社融: `macroview.club` — `cn_sf` 图表 API（需 CSRF token）

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `cpi` | Object | `{ current, prev, sequential, accumulate, date, history[] }` |
| `pmi` | Object | `{ makeIndex, makeSame, nmakeIndex, nmakeSame, prevMake, date, history[] }` |
| `m2` | Object | `{ m2Same, m1Same, m1m2Scissors, prevScissors, date, history[] }` |
| `gdp` | Object | `{ gdpSame, prevGdpSame, date, history[] }` |
| `sf` | Object | `{ increment, yoyChange, stockYoyGrowth, year, month }` |
| `macroScore` | Number | 综合评分 [-2, +2] |
| `macroDetails` | Array | 各因子明细 `{ factor, value, signal, desc }` |

**评分规则**:

| 因子 | 正面 | 负面 | 分值 |
|------|------|------|------|
| PMI | > 50.5 | < 49.5 | ±1 |
| M1-M2 剪刀差 | 收窄 | 扩大 | ±1 |
| CPI | 0-2%（温和） | > 2%(-0.5) / < 0%(-1) | -1~-0.5 |
| GDP | > 5.5% | < 4.5% | ±0.5 |
| 社融 | 存量增速 > 5% | < -5% | ±0.5 |

---

### 3.2 板块排名 + RS 轮动

```
GET /api/analysis/sectors
```

**缓存**: 5 分钟

**上游数据源**（4 源容错）:
1. 东方财富资金流向 `emdatah5.eastmoney.com/dc/ZJLX`（含主力净流入，优先）
2. 东方财富行情 `push2.eastmoney.com/api/qt/clist/get`
3. 新浪行业 `money.finance.sina.com.cn/q/view/newSinaHy.php`
4. 腾讯行业 `proxy.finance.qq.com/ifzqgtimg/appstock/app/rankBK`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `sectors` | Array | 全部行业排名 `{ code, name, changePercent, mainFlow, upCount, downCount, leadStock, rank, rsScore, rsTrend, ... }` |
| `top5Strong` | Array | RS 评分 TOP5 板块 |
| `top5Weak` | Array | RS 评分 BOTTOM5 板块 |
| `top5Flow` | Array | 主力净流入 TOP5 |
| `rotationSignal` | String | 轮动信号：`strengthening` / `weakening` / `mixed` / `null` |
| `rsAvailable` | Boolean | RS 数据是否可用（需 ≥2 天历史） |
| `rsDays` | Number | RS 历史天数 |

**RS Score 计算**: `excess5d × 0.5 + excess10d × 0.3 + excess20d × 0.2`
（板块 vs 上证指数基准的超额收益加权）

---

### 3.3 估值分析

```
GET /api/analysis/valuation
```

**缓存**: 60 分钟

**上游数据源**:
- 指数 PE/PB: `datacenter-web.eastmoney.com` — `RPT_VALUEANALYSIS_DET`（成分股加权计算）
- 指数 K 线: `push2his.eastmoney.com` + 腾讯备用
- 国债收益率: `datacenter-web.eastmoney.com` — `RPTA_WEB_TREASURYYIELD`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `indices` | Array | 4 指数估值数据（上证/深证/创业板/沪深300） |
| `totalAmount` | Number | 两市成交额 |
| `bondYield10y` | Number | 10 年期国债收益率（%） |
| `overallValuation` | Object | `{ level, label, spread }` — 整体估值水平 |

每个指数估值项:

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | String | 指数 key（sh/sz/cyb/hs300） |
| `name` | String | 指数名称 |
| `price` | Number | 最新价 |
| `pe` | Number | PE_TTM |
| `pePercentile` | Number | PE 历史分位（0-100） |
| `pb` | Number | PB_MRQ |
| `ma250` | Number | 250 日均线 |
| `aboveMa250` | Boolean | 是否站上 MA250 |
| `ma250Direction` | String | MA250 方向：up/down/flat |
| `valuationLevel` | String | 估值水平：low/fair/elevated/high |
| `equityBondSpread` | Number | 股债利差 = 1/PE×100 - 国债收益率 |
| `high52w` | Number | 52 周最高 |
| `low52w` | Number | 52 周最低 |
| `latestAmount` | Number | 当日成交额 |

---

## 4. 个股数据接口

### 4.1 日 K 线

```
GET /api/stock/:code/kline?klt=101&lmt=120
```

**参数**:

| 参数 | 默认 | 说明 |
|------|------|------|
| `klt` | `101` | K 线周期：101=日, 102=周, 103=月 |
| `lmt` | `120` | 返回数量 |

**上游数据源**: `push2his.eastmoney.com/api/qt/stock/kline/get`
- 备用: 腾讯 K 线

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `klines` | Array | `[{ date, open, close, high, low, volume, amount, turnover }]` |
| `prevClose` | Number | 前一日收盘价（用于 ATR 计算） |
| `code` | String | 股票代码 |
| `name` | String | 股票名称 |

---

### 4.2 5 年 K 线

```
GET /api/stock/:code/kline5y
```

**上游数据源**: 同 4.1，`lmt=1200`

**响应字段**: 同 4.1，约 1200 根日 K 线

---

### 4.3 当日分时

```
GET /api/stock/:code/intraday
```

**上游数据源**: `push2his.eastmoney.com/api/qt/stock/trends2/get`
- 备用: 腾讯分时

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | String | 股票代码 |
| `name` | String | 股票名称 |
| `preClose` | Number | 昨收价 |
| `trends` | Array | `[{ time, close, avg, volume }]`，1 分钟粒度 |

---

### 4.4 近 5 日分时

```
GET /api/stock/:code/intraday5d
```

**上游数据源**: 同 4.3，`ndays=5`

**响应字段**: 同 4.3，约 1200 个数据点（5 天 × 240 分钟）

---

### 4.5 个股基本面

```
GET /api/stock/:code/basic
```

**上游数据源**: `push2his.eastmoney.com/api/qt/stock/get`
- 备用: 腾讯行情

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | String | 股票代码 |
| `name` | String | 股票名称 |
| `pe` | Number | PE(TTM) |
| `pb` | Number | PB(MRQ) |
| `totalMarketCap` | Number | 总市值 |
| `circulationMarketCap` | Number | 流通市值 |
| `circulationShares` | Number | 流通股本 |
| `roe` | Number | ROE |
| `grossMargin` | Number | 毛利率 |
| `netMargin` | Number | 净利率 |
| `revenueGrowth` | Number | 营收增速 |
| `profitGrowth` | Number | 利润增速 |
| `debtRatio` | Number | 资产负债率 |
| `high52w` | Number | 52 周最高 |
| `low52w` | Number | 52 周最低 |

---

### 4.6 批量实时行情

```
GET /api/stock/batch/quotes?codes=600519,000001
```

**参数**: `codes` — 逗号分隔的股票代码列表

**上游数据源**: `push2his.eastmoney.com/api/qt/ulist.np/get`
- 备用: 腾讯批量行情

**响应字段**:

返回对象，key 为股票代码：

```json
{
  "600519": {
    "name": "贵州茅台",
    "close": 1688.0,
    "change": 1.23,
    "changeAmt": 20.5,
    "high": 1695.0,
    "low": 1670.0,
    "open": 1675.0,
    "volume": 50000,
    "amount": 840000000,
    "turnover": 0.5
  }
}
```

---

### 4.7 股票搜索

```
GET /api/stock/search?kw=茅台
```

**参数**: `kw` — 搜索关键词（支持代码/名称/拼音首字母）

**上游数据源**: `searchapi.eastmoney.com/api/suggest/get`
- 备用: 腾讯搜索

**响应字段**:

返回数组（最多 6 条，仅 A 股）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | String | 股票代码 |
| `name` | String | 股票名称 |
| `type` | String | 证券类型 |

---

### 4.8 策略选股（备用）

```
GET /api/stock/screen?strategy=trend&count=10
```

**参数**:

| 参数 | 默认 | 说明 |
|------|------|------|
| `strategy` | `trend` | 策略：`trend`(趋势突破) / `pullback`(回调买入) |
| `count` | `10` | 返回数量（最大 20） |

**上游数据源**:
- ROE 池: `datacenter-web.eastmoney.com` — `RPT_LICO_FN_CPD`
- 行情筛选: `push2his.eastmoney.com/api/qt/clist/get`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `strategy` | String | 策略名称 |
| `stocks` | Array | `{ code, name, price, change, pe, pb, marketCap, mainFlow, turnover, roe, revenueGrowth, profitGrowth, industry }` |

---

### 4.9 结构化选股（主用）

```
GET /api/stock/xuangu/structured?filter=xxx&ps=40&p=1
```

**参数**:

| 参数 | 默认 | 说明 |
|------|------|------|
| `filter` | 必填 | 东方财富 xuangu 结构化 filter 字符串 |
| `ps` | `40` | 每页数量 |
| `p` | `1` | 页码 |

**上游数据源**: `data.eastmoney.com/dataapi/xuangu/list`
- type: `RPTA_PCNEW_STOCKSELECT`
- sty: `SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,CHANGE_RATE,TURNOVERRATE,PE9,PB_MRQ,TOTAL_MARKET_CAP,NET_INFLOW,VOLUME_RATIO`

**filter 语法**: 每个条件用括号包裹，直接拼接表示 AND：
```
(ROE_WEIGHT>=8)(DEBT_ASSET_RATIO<=65)(LONG_AVG_ARRAY="1")
```

**可用 filter 字段**:

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `TRADE_MARKET_CODE` | 枚举 | 交易所 | `in ("上交所主板","深交所主板","深交所创业板","上交所科创板")` |
| `@LISTING_DATE` | 枚举 | 上市时间 | `="OVER1Y"` |
| `ROE_WEIGHT` | 数值 | ROE(加权) | `>=12` |
| `TOI_YOY_RATIO` | 数值 | 营收增速 | `>=10` |
| `NETPROFIT_YOY_RATIO` | 数值 | 净利增速 | `>=10` |
| `DEBT_ASSET_RATIO` | 数值 | 资产负债率 | `<=60` |
| `PER_NETCASH_OPERATE` | 数值 | 每股经营现金流 | `>0` |
| `PE9` | 数值 | PE(TTM) | `>5` `<=40` |
| `PB_MRQ` | 数值 | PB(MRQ) | `>0` |
| `TOTAL_MARKET_CAP` | 数值 | 总市值（元） | `>=3000000000`（30亿） |
| `GOODWILL_TO_NETASSET` | 数值 | 商誉/净资产 | `<30` |
| `PLEDGE_RATIO` | 数值 | 质押比例 | `<60` |
| `NET_INFLOW` | 数值 | 主力净流入（元） | `>0` |
| `NETINFLOW_3DAYS` | 数值 | 3日净流入 | `>0` |
| `DDX` | 数值 | DDX大单动向 | `>0` |
| `TURNOVERRATE` | 数值 | 换手率 | `>3` `<=20` |
| `VOLUME_RATIO` | 数值 | 量比 | `<1` |
| `MACD_GOLDEN_FORK` | 布尔 | MACD金叉 | `="1"` |
| `LONG_AVG_ARRAY` | 布尔 | 均线多头排列 | `="1"` |
| `KDJ_GOLDEN_FORK` | 布尔 | KDJ金叉 | `="1"` |
| `UPSIDE_VOLUME` | 布尔 | 放量上攻 | `="1"` |

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `stocks` | Array | `{ code, name, price, change, turnover, pe, pb, marketCap, mainFlow, volumeRatio }` |
| `total` | Number | 符合条件的总数 |
| `structured` | Boolean | 固定 `true` |

---

## 5. 个股分析接口

### 5.1 基本面数据

```
GET /api/stock-analysis/fundamental?code=600519
```

**参数**: `code` — 6 位股票代码（必填）

**缓存**: 30 分钟

**上游数据源**（3 个并行请求）:
1. 财务指标: `emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew`
2. 估值数据: `datacenter-web.eastmoney.com` — `RPT_VALUEANALYSIS_DET`
3. 日 K 线（730日）: `push2his.eastmoney.com/api/qt/stock/kline/get`（用于历史 PE/PB 计算）

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `latest` | Object | 最新季度数据 |
| `history` | Array | 最近 24 季度历史数据 |

每条记录字段:

| 字段 | 说明 |
|------|------|
| `date` | 报告期 |
| `roe` | ROE(稀释) |
| `grossMargin` | 毛利率 |
| `netMargin` | 净利率 |
| `revenue` | 营业总收入（元） |
| `netProfit` | 归母净利润（元） |
| `revenueGrowth` | 营收增速 |
| `profitGrowth` | 净利增速 |
| `debtRatio` | 资产负债率 |
| `eps` | 基本 EPS |
| `bvps` | 每股净资产 |
| `ocfPerShare` | 每股经营现金流 |
| `pe` | PE(TTM)（实时或由 K 线收盘价 / TTM EPS 计算） |
| `pb` | PB（实时或由收盘价 / bvps 计算） |
| `totalMarketCap` | 总市值（仅 latest） |
| `industry` | 所属行业（仅 latest） |

---

### 5.2 资金流向（量价分析）

```
GET /api/stock-analysis/capital-flow?code=600519
```

**缓存**: 5 分钟

**上游数据源**:
- 主用: `push2his.eastmoney.com/api/qt/stock/kline/get`（30 日 K 线）
- 备用: 新浪 `money.finance.sina.com.cn/quotes_service`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `flows` | Array | 最近 20 日: `{ date, close, volume, amount, changePercent, isUp }` |
| `available` | Boolean | 数据是否充足 |
| `volumeTrend` | Object | `{ recentAvgVol, prevAvgVol, volumeChangeRate }` — 近 5 日 vs 前 5 日量能对比 |
| `priceVolumeSignal` | String | 量价信号标签（如"缩量回调（洗盘）"、"放量上涨"等） |

---

### 5.3 主力资金流向

```
GET /api/stock-analysis/main-force-flow?code=600519
```

**缓存**: 日度 5 分钟，分时 3 分钟

**上游数据源**（4 个请求，各有主备）:
- 日度主用: `emdatah5.eastmoney.com/dc/ZJLX/getDBHistoryData`
- 日度备用: `push2his.eastmoney.com/api/qt/stock/fflow/daykline/get`
- 分时主用: `emdatah5.eastmoney.com/dc/ZJLX/getDBHistoryData`
- 分时备用: `push2.eastmoney.com/api/qt/stock/fflow/kline/get`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `data` | Array | 最近 60 日（含当日估算）: `{ date, mainNetInflow, superLargeNetInflow, largeNetInflow, mediumNetInflow, smallNetInflow, mainNetPct, ...各档净占比, close, changePct }` |
| `latest` | Object | 最新一天数据（含当日估算） |
| `summary` | Object | `{ mainNetSum5, mainNetAvgPct5 }` — 近 5 日汇总 |
| `intraday` | Object | `{ items[], aggregated }` — 分钟级主力资金数据 |

---

### 5.4 融资融券

```
GET /api/stock-analysis/margin?code=600519
```

**缓存**: 30 分钟

**上游数据源**: `datacenter-web.eastmoney.com` — `RPTA_WEB_RZRQ_GGMX`

**特殊逻辑**: 20:00 前排除当日数据（未结算）

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `data` | Array | 最近 30 天明细 |
| `latest` | Object | 最新一条 |

每条记录:

| 字段 | 说明 |
|------|------|
| `date` | 日期 |
| `rzBalance` | 融资余额 |
| `rzBuyAmt` | 融资买入额 |
| `rzRepayAmt` | 融资偿还额 |
| `rzNetBuy` | 融资净买入 |
| `rqBalance` | 融券余额 |
| `rqVolume` | 融券余量 |
| `rqSellVol` | 融券卖出量 |
| `rqNetVol` | 融券净卖出 |
| `totalBalance` | 融资融券余额 |
| `close` | 收盘价 |
| `changePct` | 日涨跌幅 |
| `balanceGrowth` | 融资余额日环比增长率（%） |

---

### 5.5 北向资金持仓

```
GET /api/stock-analysis/northbound?code=600519
```

**缓存**: 10 分钟

**上游数据源**: `datacenter-web.eastmoney.com` — `RPT_MUTUAL_HOLDSTOCKNDATE_STA_NEW`
- 主用: 日度数据（`INTERVAL_TYPE="003"`）
- 备用: 季度数据（`INTERVAL_TYPE="001"`）

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `data` | Array | 持仓历史 `{ date, holdShares, holdMarketCap, freeSharesRatio, totalSharesRatio, changeRatio, participantNum, closePrice }` |
| `latest` | Object | 最新一条 |
| `prev` | Object | 前一条 |
| `_frequency` | String | 数据频率：`daily` 或 `quarterly` |

---

### 5.6 股东户数

```
GET /api/stock-analysis/shareholder?code=600519
```

**缓存**: 60 分钟

**上游数据源**: `datacenter-web.eastmoney.com` — `RPT_HOLDERNUM_DET`

**响应字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `data` | Array | 历史数据 `{ date, holderCount, changeRatio, avgHoldNum, totalAShares }` |
| `latest` | Object | 最新一条 |
| `prev` | Object | 前一条 |

---

## 6. AI 分析接口

### 6.1 AI 综合判断

```
POST /api/stock-analysis/ai-judge
```

**Content-Type**: `application/json`
**响应格式**: Server-Sent Events (SSE)

**AI 模型**: 智谱 GLM-4-Flash（通过 OpenAI 兼容 SDK 调用）
**API 地址**: `https://open.bigmodel.cn/api/paas/v4`

**请求参数**（JSON body）:

| 参数 | 必填 | 说明 |
|------|------|------|
| `code` | 是 | 股票代码 |
| `name` | 否 | 股票名称 |
| `scoreSummary` | 是 | `{ total, suggestion, confidence, dimensions: { technical: {score,max}, fundamental: {score,max}, capital: {score,max} } }` |
| `techSummary` | 否 | `{ bullishCount, bearishCount, keySignals, details[] }` |
| `fundSummary` | 否 | `{ pe, pb, industry, roe, grossMargin, netMargin, revenueGrowth, profitGrowth, debtRatio, ocfPerShare }` |
| `capitalSummary` | 否 | `{ mainForceDesc, marginDesc, priceVolumeSignal }` |
| `priceAction` | 否 | `{ latestClose, change5d, change20d }` |

**缓存**:
- TTL: 1 分钟
- Cache key: `code_total_keySignals前60字符`
- 缓存命中时直接返回完整文本，不调用 AI

**SSE 响应格式**:
```
data: {"type":"text","content":"..."}
data: {"type":"text","content":"..."}
data: [DONE]
```

**错误响应**:
```
data: {"type":"error","content":"AI 分析暂时不可用: <message>"}
data: [DONE]
```

**配置**: 需在 `server/.env` 中设置 `GLM_API_KEY`

---

## 7. 上游数据源汇总

### 7.1 东方财富

| 域名 | 用途 | 接口数 |
|------|------|--------|
| `push2his.eastmoney.com` | K 线、行情、分时、均线 | 8+ |
| `push2.eastmoney.com` | 涨跌家数、涨跌分布、主力资金 | 4+ |
| `datacenter-web.eastmoney.com` | 估值、融资、北向、宏观、股东、ROE | 10+ |
| `emweb.securities.eastmoney.com` | 财务报表（季报指标） | 1 |
| `emdatah5.eastmoney.com` | 资金流向（日度/分时） | 2 |
| `data.eastmoney.com` | 结构化选股 xuangu | 1 |
| `searchapi.eastmoney.com` | 股票搜索 | 1 |
| `push2ex.eastmoney.com` | 涨跌幅分布 | 1 |

### 7.2 金融界

| 域名 | 用途 | 接口数 |
|------|------|--------|
| `gateway.jrj.com` | 涨跌停温度计、市场历史 | 2 |

### 7.3 腾讯

| 域名 | 用途 | 接口数 |
|------|------|--------|
| `web.ifzq.gtimg.cn` | K 线备用 | 1 |
| `qt.gtimg.cn` | 行情备用 | 1 |
| `proxy.finance.qq.com` | 板块排名备用 | 1 |

### 7.4 新浪

| 域名 | 用途 | 接口数 |
|------|------|--------|
| `money.finance.sina.com.cn` | 板块排名备用、K 线备用 | 2 |

### 7.5 其他

| 域名 | 用途 | 接口数 |
|------|------|--------|
| `info.stcn.com` | 北向资金备用（证券时报） | 1 |
| `www.macroview.club` | 社融数据 | 1 |
| `open.bigmodel.cn` | AI 判断（智谱 GLM-4-Flash） | 1 |
