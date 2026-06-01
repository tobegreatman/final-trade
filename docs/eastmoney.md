# 东财数据接口

## 条件选股

账号：15901208278
密码：Ch@840921

...
POST https://np-tjxg-g.eastmoney.com/api/smart-tag/stock/v3/pw/search-code
...

Payload: 示例
```json
{
    "needAmbiguousSuggest": true,
    "pageSize": 50,
    "pageNo": 1,
    "fingerprint": "1bd5295bc2608f88485c164d8bab788c",
    "matchWord": "",
    "shareToGuba": false,
    "timestamp": "1779758329327891",
    "requestId": "PXD961ghmycioQhn5zFGSwBM56NJ4N631779758377780",
    "removedConditionIdList": [],
    "ownSelectAll": false,
    "needCorrect": true,
    "client": "WEB",
    "product": "",
    "needShowStockNum": false,
    "biz": "web_ai_select_stocks",
    "xcId": "xc119ddcf5b501016f45",
    "gids": [],
    "dxInfoNew": [],
    "keyWordNew": "非ST/非停牌/非北交所/非退市，上市>1年，商誉/净资产<30%（服务端后过滤），质押<60%，营收增速≥5%，利润增速≥5%，负债率≤65%，PE 3~50，市值≥30亿，回调买入：均线多头排列 + 量能收缩",
    "customDataNew": "[{\"type\":\"text\",\"value\":\"非ST/非停牌/非北交所/非退市，上市>1年，商誉/净资产<30%（服务端后过滤），质押<60%，营收增速≥5%，利润增速≥5%，负债率≤65%，PE 3~50，市值≥30亿，回调买入：均线多头排列 + 量能收缩\",\"extra\":\"\"}]"
}
```

---

## 选股查询方案实现总结

### 架构概览

```
前端 (Dashboard.vue / Screener.vue)
  │  keyWordNew 自然语言查询字符串
  ▼
后端 POST /api/stock/xuangu/ai
  │  注入 Cookie: emauth=xxx（登录态）
  ▼
东财 AI 选股 API
  POST https://np-tjxg-g.eastmoney.com/api/smart-tag/stock/v3/pw/search-code
  │  返回 responseConditionList（已解析条件） + dataList（股票列表）
  ▼
后端 mapAIStock() 映射统一字段 → 前端渲染
```

### 登录态 Cookie 管理

AI 选股 API 在无登录态时只能解析 2-3 个条件，复杂查询退化为基本过滤。配置 `emauth` cookie 后可完整解析全部条件。

**配置方式**（`server/.env`）：
```
EASTMONEY_EMAUTH=<从浏览器 DevTools 复制的 emauth 值>
```

**获取步骤**：
1. 浏览器访问 `https://xuangu.eastmoney.com` 并登录东财
2. F12 → Application → Cookies → `xuangu.eastmoney.com`
3. 复制 `emauth` 的值，粘贴到 `server/.env`
4. 重启后端

后端自动检测：若 `EASTMONEY_EMAUTH` 非空，在请求东财 API 时注入 `Cookie: emauth=xxx` 头。

前端通过 `/api/stock/xuangu/ai/status` 检测 cookie 配置状态，未配置时显示黄色提示条。

### 双 API 策略

| | AI 自然语言选股 | 结构化选股（回退） |
|---|---|---|
| **后端路由** | `POST /api/stock/xuangu/ai` | `POST /api/stock/xuangu` |
| **东财端点** | `np-tjxg-g.eastmoney.com/.../search-code` | `data.eastmoney.com/dataapi/xuangu/list` |
| **查询方式** | `keyWordNew` 中文自然语言 | `filter` 字段级参数 |
| **登录要求** | 需 `emauth` cookie 解析完整条件 | 无需登录 |
| **前端回退逻辑** | 首选 AI；若 total>200 且 conditions<3 则回退 | 作为回退使用 |

### 关键文件

| 文件 | 职责 |
|---|---|
| `server/index.js` | 后端路由、字段映射、缓存、cookie 注入 |
| `src/utils/screenerPrompt.js` | 四层漏斗策略预设 + `keyWordNew` 自然语言生成 |
| `src/views/Dashboard.vue` | 策略选股建议面板，自动根据市场状态选股 |
| `src/views/Screener.vue` | 手动选股页面，用户自选各层条件 |

### 四层漏斗模型

**第一层：排雷**（mine sweeper）
- 非ST、非停牌、非北交所、非退市
- 上市时间超过1年、商誉占净资产比例小于30%、质押比例小于60%

**第二层：基本面**（fundamentals）
- ROE、营收增速、利润增速、资产负债率、经营现金流、PE 区间、最低市值

**第三层：景气度**（prosperity）
- `institutional` → DDX>0（机构增持）
- `earnings` → 业绩超预期
- `dragonTiger` → 换手率3~20%

**第四层：技术信号**（tech）
- `trendBreak` → 趋势追涨：均线多头排列 + MACD金叉 + 量能放大
- `pullback` → 回调买入：均线多头排列 + 量能收缩
- `pullbackStrict` → 回调买入（严）：均线多头 + 明显缩量
- `bottomConfirm` → 抄底信号：RSI超卖 + MACD底背离 + 缩量

### 严/宽模式预设参数

| 参数 | 严格-牛市 | 宽松-牛市 | 宽松-偏多 | 宽松-震荡 |
|---|---|---|---|---|
| ROE | ≥12% | 无要求 | 无要求 | 无要求 |
| 营收增速 | ≥10% | ≥5% | ≥5% | ≥5% |
| 利润增速 | ≥10% | ≥5% | ≥5% | ≥5% |
| 负债率 | ≤60% | ≤65% | ≤65% | ≤65% |
| PE | 5~40 | 3~50 | 3~50 | 3~50 |
| 最低市值 | 50亿 | 30亿 | 30亿 | 30亿 |
| 景气度 | DDX>0 | 无 | 无 | 无 |
| 技术信号 | 趋势突破 | 趋势突破 | 回调买入 | 回调买入 |

### 后端 API 接口

#### `POST /api/stock/xuangu/ai`

请求：
```json
{
  "keyWordNew": "非ST，非停牌，非北交所，非退市，上市时间超过1年，...",
  "pageSize": 50,
  "pageNo": 1
}
```

响应：
```json
{
  "ok": true,
  "data": {
    "stocks": [
      {
        "code": "603112",
        "name": "华翔股份",
        "price": 22.41,
        "change": -0.93,
        "turnover": 2.63,
        "pe": 21.17,
        "pb": 2.74,
        "marketCap": 12100000000,
        "volumeRatio": 1.15,
        "goodwillRatio": null,
        "pledgeRatio": 4.91,
        "debtRatio": 31.44,
        "revenueGrowth": 8.10,
        "profitGrowth": 10.41,
        "industry": "上交所主板"
      }
    ],
    "total": 2,
    "conditions": [
      { "conditionId": 1, "describe": "非[ST股票]", "isValid": true },
      { "conditionId": 14, "describe": "市盈率(TTM)介于3~50", "isValid": true }
    ],
    "source": "ai"
  }
}
```

#### `GET /api/stock/xuangu/ai/status`

响应：
```json
{ "ok": true, "data": { "hasCookie": true } }
```

### 东财 AI API 响应字段映射

东财返回的 dataList 中键名带日期后缀（如 `PETTM{2026-05-26}`），值可能带管道分隔的报告期（如 `"31.44|2026一季报"`）。`extractField(item, keyPrefix)` 按前缀匹配键名，剥离管道后缀返回数字。

| 前端字段 | 东财键前缀 | 说明 |
|---|---|---|
| code | SECURITY_CODE | 股票代码 |
| name | SECURITY_SHORT_NAME | 股票名称 |
| price | NEWEST_PRICE | 最新价 |
| change | CHG | 涨跌幅(%) |
| turnover | TURNOVER_RATE | 换手率(%) |
| pe | PETTM | 市盈率(TTM) |
| pb | PB | 市净率 |
| marketCap | TOAL_MARKET_VALUE | 总市值（元） |
| volumeRatio | QRR | 量比 |
| goodwillRatio | GOODWILL_ASSETS_RATRO | 商誉占净资产比例(%) |
| pledgeRatio | PLEDGE_RATIO | 质押比例(%) |
| debtRatio | DEBT_ASSET_RATIO | 资产负债率(%) |
| revenueGrowth | 最新营业收入 | 营收同比增长率(%) |
| profitGrowth | 最新归属母公司股东的净利润 | 利润同比增长率(%) |
| industry | TRADEMARKET | 上市板块 |


### 缓存策略

- AI 选股结果以 `keyWordNew` 内容为缓存 key，TTL 5 分钟
- 商誉/净资产数据缓存 4 小时（结构化 API 后过滤用）

### keyWordNew 自然语言编写规范

使用中文逗号 `，` 分隔条件，比较运算符用中文表述：

- `大于等于` / `小于等于` / `小于` / `超过`
- PE 用波浪号区间：`PE 3~50`
- 排雷条件用否定前缀：`非ST` / `非停牌` / `非北交所` / `非退市`

示例（宽松牛市完整查询）：
```
非ST，非停牌，非北交所，非退市，上市时间超过1年，商誉占净资产比例小于30%，质押比例小于60%，营收增速大于等于5%，利润增速大于等于5%，负债率小于等于65%，PE 3~50，市值大于等于30亿，回调买入：均线多头排列 + 量能收缩
```

### 前端回退判定逻辑

```javascript
// AI 结果有效：total 合理或条件数充分
if (aiTotal <= 200 || aiConditions.length >= 3) {
  // 使用 AI 结果
} else {
  // AI 解析不完整（total>200 且 conditions<3），回退到结构化 API
}
```
Response: 示例
```json
{
    "code": "100",
    "msg": "解析成功，查询到数据",
    "data": {
        "resultType": null,
        "matchable": null,
        "result": {
            "columns": [
                {
                    "title": "序号",
                    "key": "SERIAL",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": null,
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": null,
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": null,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "代码",
                    "key": "SECURITY_CODE",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "SECURITY_CODE",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "String",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "名称",
                    "key": "SECURITY_SHORT_NAME",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "SECURITY_SHORT_NAME",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "String",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "市场简称",
                    "key": "MARKET_SHORT_NAME",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "MARKET_SHORT_NAME",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "String",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "最新价",
                    "key": "NEWEST_PRICE",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "NEWEST_PRICE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "涨跌幅",
                    "key": "CHG",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "CHG",
                    "redGreenAble": true,
                    "unit": "%",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "成交量(股)",
                    "key": "VOLUME{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "desc",
                    "indexName": "VOLUME",
                    "redGreenAble": false,
                    "unit": "股",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Long",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "市场码",
                    "key": "MARKET_NUM",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "MARKET_NUM",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "String",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "是否ST",
                    "key": "IFSTSTOCK{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "IFSTSTOCK",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Boolean",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "交易状态",
                    "key": "TTRADESTATUS{2026-05-27}",
                    "dateMsg": "截至2026.05.27最新",
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "TTRADESTATUS",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "String",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "上市板块",
                    "key": "TRADEMARKET",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "TRADEMARKET",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "List",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "退市",
                    "key": "IF_DELISTING",
                    "dateMsg": null,
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "IF_DELISTING",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Boolean",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "上市日期",
                    "key": "LISTING_DATE",
                    "dateMsg": null,
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "LISTING_DATE",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Date",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "商誉占净资产比例",
                    "key": "GOODWILL_ASSETS_RATRO{2026-05-27}",
                    "dateMsg": "截至2026.05.27最新",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "GOODWILL_ASSETS_RATRO",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "股份质押比例(中登公司)",
                    "key": "PLEDGE_RATIO{2026-05-27}",
                    "dateMsg": "截至2026.05.27最新",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PLEDGE_RATIO",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "最新营业收入同比增长率(%)",
                    "key": "最新营业收入[2026-03-31]同比增长率(%)",
                    "dateMsg": "截至2026.03.31最新",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "最新营业收入[2026-03-31]同比增长率(%)",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 2,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "营业收入",
                    "key": "OPERATEREVE{2026-03-31}",
                    "dateMsg": "2026.03.31",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "OPERATEREVE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": [
                        {
                            "title": "营业收入",
                            "key": "OPERATEREVE{2026-03-31}",
                            "dateMsg": "2026.03.31",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "OPERATEREVE",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "营业收入",
                            "key": "OPERATEREVE{2025-12-31}",
                            "dateMsg": "2025.12.31",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "OPERATEREVE",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "营业收入",
                            "key": "OPERATEREVE{2025-09-30}",
                            "dateMsg": "2025.09.30",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "OPERATEREVE",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "营业收入",
                            "key": "OPERATEREVE{2025-06-30}",
                            "dateMsg": "2025.06.30",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "OPERATEREVE",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "营业收入",
                            "key": "OPERATEREVE{2025-03-31}",
                            "dateMsg": "2025.03.31",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "OPERATEREVE",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        }
                    ],
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "营业收入",
                    "key": "OPERATEREVE{2025-12-31}",
                    "dateMsg": "2025.12.31",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "OPERATEREVE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "营业收入",
                    "key": "OPERATEREVE{2025-09-30}",
                    "dateMsg": "2025.09.30",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "OPERATEREVE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "营业收入",
                    "key": "OPERATEREVE{2025-06-30}",
                    "dateMsg": "2025.06.30",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "OPERATEREVE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "营业收入",
                    "key": "OPERATEREVE{2025-03-31}",
                    "dateMsg": "2025.03.31",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "OPERATEREVE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "最新归属母公司股东的净利润同比增长率(%)",
                    "key": "最新归属母公司股东的净利润[2026-03-31]同比增长率(%)",
                    "dateMsg": "截至2026.03.31最新",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "最新归属母公司股东的净利润[2026-03-31]同比增长率(%)",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 2,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "归属净利润",
                    "key": "PARENT_NETPROFIT{2026-03-31}",
                    "dateMsg": "2026.03.31",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PARENT_NETPROFIT",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": [
                        {
                            "title": "归属净利润",
                            "key": "PARENT_NETPROFIT{2026-03-31}",
                            "dateMsg": "2026.03.31",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "PARENT_NETPROFIT",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "归属净利润",
                            "key": "PARENT_NETPROFIT{2025-12-31}",
                            "dateMsg": "2025.12.31",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "PARENT_NETPROFIT",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "归属净利润",
                            "key": "PARENT_NETPROFIT{2025-09-30}",
                            "dateMsg": "2025.09.30",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "PARENT_NETPROFIT",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "归属净利润",
                            "key": "PARENT_NETPROFIT{2025-06-30}",
                            "dateMsg": "2025.06.30",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "PARENT_NETPROFIT",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        },
                        {
                            "title": "归属净利润",
                            "key": "PARENT_NETPROFIT{2025-03-31}",
                            "dateMsg": "2025.03.31",
                            "sortable": true,
                            "light": false,
                            "sortWay": "",
                            "indexName": "PARENT_NETPROFIT",
                            "redGreenAble": false,
                            "unit": "元",
                            "userNeed": 1,
                            "mtmKey": false,
                            "dataType": "Double",
                            "resCacheNeed": false,
                            "quoteJumpNeed": false,
                            "reportTimeHighLight": false,
                            "showType": null,
                            "optKlp": null,
                            "mplcType": null,
                            "hiddenNeed": false,
                            "children": null,
                            "linkDisplayWay": "",
                            "indexType": 0,
                            "fieldKey": null,
                            "fieldName": null,
                            "innerKey": null,
                            "earlyDate": null,
                            "indexDesc": null
                        }
                    ],
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "归属净利润",
                    "key": "PARENT_NETPROFIT{2025-12-31}",
                    "dateMsg": "2025.12.31",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PARENT_NETPROFIT",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "归属净利润",
                    "key": "PARENT_NETPROFIT{2025-09-30}",
                    "dateMsg": "2025.09.30",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PARENT_NETPROFIT",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "归属净利润",
                    "key": "PARENT_NETPROFIT{2025-06-30}",
                    "dateMsg": "2025.06.30",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PARENT_NETPROFIT",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "归属净利润",
                    "key": "PARENT_NETPROFIT{2025-03-31}",
                    "dateMsg": "2025.03.31",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PARENT_NETPROFIT",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": true,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "资产负债率",
                    "key": "DEBT_ASSET_RATIO{2026-05-27}",
                    "dateMsg": "截至2026.05.27最新",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "DEBT_ASSET_RATIO",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "市盈率(TTM)(倍)",
                    "key": "PETTM{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PETTM",
                    "redGreenAble": false,
                    "unit": "倍",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "总市值(日线不复权)",
                    "key": "TOAL_MARKET_VALUE<140>{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "TOAL_MARKET_VALUE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "收盘价回撤",
                    "key": "收盘价[2026-05-22至2026-05-26]回撤",
                    "dateMsg": "2026.05.22-2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "收盘价[2026-05-22至2026-05-26]回撤",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 2,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "均线多头排列",
                    "key": "JXDTPL_DAY{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": false,
                    "light": false,
                    "sortWay": "",
                    "indexName": "JXDTPL_DAY",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 1,
                    "mtmKey": false,
                    "dataType": "Boolean",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": "默认使用5、10、20、30、60、120、250日均线（共7根），要求短周期均线在长周期之上。用户也可在问句中指定均线，如：5日线、15日线、60日线多头排列"
                },
                {
                    "title": "涨跌额",
                    "key": "PCHG{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PCHG",
                    "redGreenAble": true,
                    "unit": "元",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "最高价(日线不复权)",
                    "key": "PEAK_PRICE<140>{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PEAK_PRICE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "最低价(日线不复权)",
                    "key": "BOTTOM_PRICE<140>{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "BOTTOM_PRICE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "换手率",
                    "key": "TURNOVER_RATE{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "TURNOVER_RATE",
                    "redGreenAble": false,
                    "unit": "%",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "量比",
                    "key": "QRR{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "QRR",
                    "redGreenAble": false,
                    "unit": "",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": "量比是衡量相对成交量的指标。量比的数值越大，表明了该股当日流入的资金越多，市场活跃度越高；反之也成立。公式：量比=（现成交总手数 / 现累计开市时间(分) ）/ 过去5日平均每分钟成交量。"
                },
                {
                    "title": "成交额",
                    "key": "TRADING_VOLUMES{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "TRADING_VOLUMES",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "市盈率(动)(倍)",
                    "key": "PE_DYNAMIC{2026-05-26}",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PE_DYNAMIC",
                    "redGreenAble": false,
                    "unit": "倍",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "市净率(倍)",
                    "key": "PB",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "PB",
                    "redGreenAble": false,
                    "unit": "倍",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                },
                {
                    "title": "流通市值(日线不复权)",
                    "key": "CIRCULATION_MARKET_VALUE<140>",
                    "dateMsg": "2026.05.26",
                    "sortable": true,
                    "light": false,
                    "sortWay": "",
                    "indexName": "CIRCULATION_MARKET_VALUE",
                    "redGreenAble": false,
                    "unit": "元",
                    "userNeed": 0,
                    "mtmKey": false,
                    "dataType": "Double",
                    "resCacheNeed": false,
                    "quoteJumpNeed": false,
                    "reportTimeHighLight": false,
                    "showType": null,
                    "optKlp": null,
                    "mplcType": null,
                    "hiddenNeed": false,
                    "children": null,
                    "linkDisplayWay": "",
                    "indexType": 0,
                    "fieldKey": null,
                    "fieldName": null,
                    "innerKey": null,
                    "earlyDate": null,
                    "indexDesc": null
                }
            ],
            "dataList": [
                {
                    "DEBT_ASSET_RATIO{2026-05-27}": "31.44|2026一季报",
                    "CIRCULATION_MARKET_VALUE<140>": "119.81亿",
                    "OPERATEREVE{2025-03-31}": "9.75亿|2025一季报",
                    "CHG": "-0.93",
                    "OPERATEREVE{2026-03-31}": "10.54亿|2026一季报",
                    "OPERATEREVE{2025-06-30}": "19.76亿|2025半年报",
                    "SECURITY_CODE": "603112",
                    "收盘价[2026-05-22至2026-05-26]回撤": "0.93",
                    "PEAK_PRICE<140>{2026-05-26}": "23.95",
                    "OPERATEREVE{2025-09-30}": "29.83亿|2025三季报",
                    "TTRADESTATUS{2026-05-27}": "正常交易",
                    "IF_DELISTING": "否",
                    "TRADING_VOLUMES{2026-05-26}": "3.17亿",
                    "IN_OPTIONAL": false,
                    "OPERATEREVE{2025-12-31}": "41.27亿|2025年报",
                    "TURNOVER_RATE{2026-05-26}": "2.63",
                    "SERIAL": "1",
                    "PETTM{2026-05-26}": "21.17",
                    "PARENT_NETPROFIT{2026-03-31}": "1.47亿|2026一季报",
                    "PARENT_NETPROFIT{2025-03-31}": "1.33亿|2025一季报",
                    "最新营业收入[2026-03-31]同比增长率(%)": "8.10|2026一季报",
                    "PARENT_NETPROFIT{2025-06-30}": "2.90亿|2025半年报",
                    "QRR{2026-05-26}": "1.15",
                    "PARENT_NETPROFIT{2025-12-31}": "5.58亿|2025年报",
                    "MARKET_SHORT_NAME": "SH",
                    "JXDTPL_DAY{2026-05-26}": "是",
                    "IFSTSTOCK{2026-05-26}": "否",
                    "TRADEMARKET": "上交所主板",
                    "PARENT_NETPROFIT{2025-09-30}": "4.06亿|2025三季报",
                    "PCHG{2026-05-26}": "-0.21",
                    "最新归属母公司股东的净利润[2026-03-31]同比增长率(%)": "10.41|2026一季报",
                    "TOAL_MARKET_VALUE<140>{2026-05-26}": "121.01亿",
                    "PB": "2.74",
                    "NEWEST_PRICE": "22.41",
                    "BOTTOM_PRICE<140>{2026-05-26}": "21.95",
                    "SECURITY_SHORT_NAME": "华翔股份",
                    "MARKET_NUM": "1",
                    "GOODWILL_ASSETS_RATRO{2026-05-27}": "-",
                    "PLEDGE_RATIO{2026-05-27}": "4.91",
                    "PE_DYNAMIC{2026-05-26}": "20.60",
                    "LISTING_DATE": "2020-09-17",
                    "VOLUME{2026-05-26}": "1404.13万"
                },
                {
                    "DEBT_ASSET_RATIO{2026-05-27}": "32.89|2026一季报",
                    "CIRCULATION_MARKET_VALUE<140>": "141.30亿",
                    "OPERATEREVE{2025-03-31}": "2.22亿|2025一季报",
                    "CHG": "-3.14",
                    "OPERATEREVE{2026-03-31}": "4.18亿|2026一季报",
                    "OPERATEREVE{2025-06-30}": "5.19亿|2025半年报",
                    "SECURITY_CODE": "688059",
                    "收盘价[2026-05-22至2026-05-26]回撤": "3.14",
                    "PEAK_PRICE<140>{2026-05-26}": "155.40",
                    "OPERATEREVE{2025-09-30}": "7.71亿|2025三季报",
                    "TTRADESTATUS{2026-05-27}": "正常交易",
                    "IF_DELISTING": "否",
                    "TRADING_VOLUMES{2026-05-26}": "6.99亿",
                    "IN_OPTIONAL": false,
                    "OPERATEREVE{2025-12-31}": "10.00亿|2025年报",
                    "TURNOVER_RATE{2026-05-26}": "5.00",
                    "SERIAL": "2",
                    "PETTM{2026-05-26}": "45.39",
                    "PARENT_NETPROFIT{2026-03-31}": "1.75亿|2026一季报",
                    "PARENT_NETPROFIT{2025-03-31}": "2922.40万|2025一季报",
                    "最新营业收入[2026-03-31]同比增长率(%)": "88.26|2026一季报",
                    "PARENT_NETPROFIT{2025-06-30}": "8545.97万|2025半年报",
                    "QRR{2026-05-26}": "1.17",
                    "PARENT_NETPROFIT{2025-12-31}": "1.87亿|2025年报",
                    "MARKET_SHORT_NAME": "SH",
                    "JXDTPL_DAY{2026-05-26}": "是",
                    "IFSTSTOCK{2026-05-26}": "否",
                    "TRADEMARKET": "上交所科创板",
                    "PARENT_NETPROFIT{2025-09-30}": "1.37亿|2025三季报",
                    "PCHG{2026-05-26}": "-4.90",
                    "最新归属母公司股东的净利润[2026-03-31]同比增长率(%)": "499.47|2026一季报",
                    "TOAL_MARKET_VALUE<140>{2026-05-26}": "150.98亿",
                    "PB": "6.95",
                    "NEWEST_PRICE": "151.00",
                    "BOTTOM_PRICE<140>{2026-05-26}": "143.86",
                    "SECURITY_SHORT_NAME": "华锐精密",
                    "MARKET_NUM": "1",
                    "GOODWILL_ASSETS_RATRO{2026-05-27}": "-",
                    "PLEDGE_RATIO{2026-05-27}": "2.58",
                    "PE_DYNAMIC{2026-05-26}": "21.55",
                    "LISTING_DATE": "2021-02-08",
                    "VOLUME{2026-05-26}": "467.64万"
                }
            ],
            "diverseList": [],
            "linkList": [],
            "meta": {
                "columnInfo": {
                    "DEBT_ASSET_RATIO{2026-05-27}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "CIRCULATION_MARKET_VALUE<140>": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "OPERATEREVE{2025-03-31}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "CHG": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "OPERATEREVE{2026-03-31}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "OPERATEREVE{2025-06-30}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "SECURITY_CODE": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "收盘价[2026-05-22至2026-05-26]回撤": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PEAK_PRICE<140>{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "OPERATEREVE{2025-09-30}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "STOCK_FLAG_NUM": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "TTRADESTATUS{2026-05-27}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "IF_DELISTING": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "TRADING_VOLUMES{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "OPERATEREVE{2025-12-31}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "TURNOVER_RATE{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "SERIAL": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PETTM{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 4,
                            "quoteRelatedField": null
                        }
                    },
                    "PARENT_NETPROFIT{2026-03-31}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PARENT_NETPROFIT{2025-03-31}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "最新营业收入[2026-03-31]同比增长率(%)": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "PARENT_NETPROFIT{2025-06-30}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "QRR{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PARENT_NETPROFIT{2025-12-31}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "MARKET_SHORT_NAME": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "JXDTPL_DAY{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "IFSTSTOCK{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "TRADEMARKET": {
                        "displayConfig": {
                            "widthFlag": 1,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PARENT_NETPROFIT{2025-09-30}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PCHG{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "最新归属母公司股东的净利润[2026-03-31]同比增长率(%)": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "TOAL_MARKET_VALUE<140>{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "PB": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "NEWEST_PRICE": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "BOTTOM_PRICE<140>{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 3,
                            "widthTimes": 5,
                            "quoteRelatedField": null
                        }
                    },
                    "SECURITY_SHORT_NAME": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "MARKET_NUM": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "GOODWILL_ASSETS_RATRO{2026-05-27}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PLEDGE_RATIO{2026-05-27}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "PE_DYNAMIC{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "LISTING_DATE": {
                        "displayConfig": {
                            "widthFlag": 1,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    },
                    "VOLUME{2026-05-26}": {
                        "displayConfig": {
                            "widthFlag": 0,
                            "widthTimes": 0,
                            "quoteRelatedField": null
                        }
                    }
                }
            },
            "latestDate": "",
            "total": 2
        },
        "codes": null,
        "extraData": null,
        "ownSelectAble": null,
        "responseConditionList": [
            {
                "describe": "非[ST股票]",
                "stockCount": -1,
                "childrenIdList": [
                    0
                ],
                "resultIndex": 58,
                "conditionId": 1,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "交易状态匹配正常交易",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 53,
                "conditionId": 2,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "非[北京证券交易所]",
                "stockCount": -1,
                "childrenIdList": [
                    3
                ],
                "resultIndex": 49,
                "conditionId": 4,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "非[退市股]",
                "stockCount": -1,
                "childrenIdList": [
                    5
                ],
                "resultIndex": 44,
                "conditionId": 6,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "上市日期小于2025-05-27",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 40,
                "conditionId": 7,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "非[商誉占净资产比例小于30%]",
                "stockCount": -1,
                "childrenIdList": [
                    8
                ],
                "resultIndex": 38,
                "conditionId": 9,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "质押比例小于60%",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 33,
                "conditionId": 10,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "营业收入同比增长率大于等于5%",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 30,
                "conditionId": 11,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "归属母公司股东的净利润同比增长率大于等于5%",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 24,
                "conditionId": 12,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "资产负债率小于等于65%",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 18,
                "conditionId": 13,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "市盈率(TTM)介于3~50",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 15,
                "conditionId": 14,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "总市值大于等于30亿",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 12,
                "conditionId": 15,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "收盘价回撤",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 9,
                "conditionId": 16,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "均线多头排列",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 4,
                "conditionId": 17,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "成交量",
                "stockCount": -1,
                "childrenIdList": [],
                "resultIndex": 1,
                "conditionId": 18,
                "sameIdList": null,
                "isValid": true,
                "removable": true,
                "traceInfo": null,
                "drawLineNode": null
            },
            {
                "describe": "非[ST股票] 且 交易状态匹配正常交易 且 非[北京证券交易所] 且 非[退市股] 且 上市日期小于2025-05-27 且 非[商誉占净资产比例小于30%] 且 质押比例小于60% 且 营业收入同比增长率大于等于5% 且 归属母公司股东的净利润同比增长率大于等于5% 且 资产负债率小于等于65% 且 市盈率(TTM)介于3~50 且 总市值大于等于30亿 且 收盘价回撤 且 均线多头排列 且 成交量",
                "stockCount": -1,
                "childrenIdList": [
                    1,
                    2,
                    4,
                    6,
                    7,
                    9,
                    10,
                    11,
                    12,
                    13,
                    14,
                    15,
                    16,
                    17,
                    18
                ],
                "resultIndex": 59,
                "conditionId": 19,
                "sameIdList": null,
                "isValid": true,
                "removable": false,
                "traceInfo": null,
                "drawLineNode": null
            }
        ],
        "dynamicGroupCHG": null,
        "userSelectCount": null,
        "isNotLoggedInForOwnSelect": null,
        "domain": null,
        "parserTreeMd5": "ba7fbbafcfd6804b2d4cf84e30bfe842",
        "searchTreeMd5": "e87a1561e735974bf7c89e0519db9789",
        "xcId": "xc11a2c768c80100c42c",
        "ownSelectAllCodes": null,
        "traceId": "102.31397-0a950c7a-30987-494408-1954",
        "quoteTraceId": "488313891",
        "traceInfo": {
            "conditionId": 19,
            "showText": "非[ST股票] 且 交易状态匹配正常交易 且 非[北京证券交易所] 且 非[退市股] 且 上市日期小于2025-05-27 且 非[商誉占净资产比例小于30%] 且 质押比例小于60% 且 营业收入同比增长率大于等于5% 且 归属母公司股东的净利润同比增长率大于等于5% 且 资产负债率小于等于65% 且 市盈率(TTM)介于3~50 且 总市值大于等于30亿 且 收盘价回撤 且 均线多头排列 且 成交量",
            "traceId": null,
            "traceText": null,
            "tmpl": null,
            "childrenInfo": [
                {
                    "conditionId": 1,
                    "showText": "非[ST股票]",
                    "traceId": 0,
                    "traceText": "非ST/非停牌/非北交所/非退市,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "非[ST股票]",
                    "dtext": null
                },
                {
                    "conditionId": 2,
                    "showText": "交易状态匹配正常交易",
                    "traceId": 0,
                    "traceText": "非ST/非停牌/非北交所/非退市,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "交易状态匹配正常交易",
                    "dtext": null
                },
                {
                    "conditionId": 4,
                    "showText": "非[北京证券交易所]",
                    "traceId": 0,
                    "traceText": "非ST/非停牌/非北交所/非退市,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "非[北京证券交易所]",
                    "dtext": null
                },
                {
                    "conditionId": 6,
                    "showText": "非[退市股]",
                    "traceId": 0,
                    "traceText": "非ST/非停牌/非北交所/非退市,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "非[退市股]",
                    "dtext": null
                },
                {
                    "conditionId": 7,
                    "showText": "上市日期小于2025-05-27",
                    "traceId": 1,
                    "traceText": "上市>1年,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "上市日期小于2025-05-27",
                    "dtext": null
                },
                {
                    "conditionId": 9,
                    "showText": "非[商誉占净资产比例小于30%]",
                    "traceId": 2,
                    "traceText": "商誉/净资产<30%(服务端后过滤),",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "非[商誉占净资产比例小于30%]",
                    "dtext": null
                },
                {
                    "conditionId": 10,
                    "showText": "质押比例小于60%",
                    "traceId": 3,
                    "traceText": "质押<60%,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "质押比例小于60%",
                    "dtext": null
                },
                {
                    "conditionId": 11,
                    "showText": "营业收入同比增长率大于等于5%",
                    "traceId": 4,
                    "traceText": "营收增速≥5%,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "营业收入同比增长率大于等于5%",
                    "dtext": null
                },
                {
                    "conditionId": 12,
                    "showText": "归属母公司股东的净利润同比增长率大于等于5%",
                    "traceId": 5,
                    "traceText": "利润增速≥5%,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "归属母公司股东的净利润同比增长率大于等于5%",
                    "dtext": null
                },
                {
                    "conditionId": 13,
                    "showText": "资产负债率小于等于65%",
                    "traceId": 6,
                    "traceText": "负债率≤65%,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "资产负债率小于等于65%",
                    "dtext": null
                },
                {
                    "conditionId": 14,
                    "showText": "市盈率(TTM)介于3~50",
                    "traceId": 7,
                    "traceText": "PE 3~50,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "市盈率(TTM)介于3~50",
                    "dtext": null
                },
                {
                    "conditionId": 15,
                    "showText": "总市值大于等于30亿",
                    "traceId": 8,
                    "traceText": "市值≥30亿,",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "总市值大于等于30亿",
                    "dtext": null
                },
                {
                    "conditionId": 16,
                    "showText": "收盘价回撤",
                    "traceId": 9,
                    "traceText": "回调买入:均线多头排列 + 量能收缩",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "收盘价回撤",
                    "dtext": null
                },
                {
                    "conditionId": 17,
                    "showText": "均线多头排列",
                    "traceId": 9,
                    "traceText": "回调买入:均线多头排列 + 量能收缩",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "均线多头排列",
                    "dtext": null
                },
                {
                    "conditionId": 18,
                    "showText": "成交量",
                    "traceId": 9,
                    "traceText": "回调买入:均线多头排列 + 量能收缩",
                    "tmpl": null,
                    "childrenInfo": null,
                    "etext": "成交量",
                    "dtext": null
                }
            ],
            "etext": "非[ST股票] 且 交易状态匹配正常交易 且 非[北京证券交易所] 且 非[退市股] 且 上市日期小于2025-05-27 且 非[商誉占净资产比例小于30%] 且 质押比例小于60% 且 营业收入同比增长率大于等于5% 且 归属母公司股东的净利润同比增长率大于等于5% 且 资产负债率小于等于65% 且 市盈率(TTM)介于3~50 且 总市值大于等于30亿 且 收盘价回撤 且 均线多头排列 且 成交量",
            "dtext": null
        },
        "enableRefresh": null,
        "hiddenDrawLine": false,
        "hintInformation": null,
        "rightsValidMessage": null,
        "initHintMessage": null,
        "quoteTime": "2026-05-26 00:00:00",
        "correctRes": {
            "existError": false,
            "correctedText": null,
            "editDetails": null,
            "code": 0,
            "needCorrect": true,
            "success": 0,
            "fail": 1
        },
        "keywordInfo": null,
        "extraCondition": null,
        "intraday": null,
        "refreshInterval": null,
        "keywordInfoNew": null,
        "ctraceId": "1507-a950c7a-115287202413-0"
    }
}
```
