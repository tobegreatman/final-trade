import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import logger from 'koa-logger'
import bodyParser from 'koa-bodyparser'
import https from 'https'
import {
  fetchIndicesFallback,
  fetchIndicesIntradayFallback,
  fetchStockKlineFallback,
  fetchStockKline5yFallback,
  fetchStockIntradayFallback,
  fetchStockIntraday5dFallback,
  fetchStockBasicFallback,
  fetchBatchQuotesFallback,
  searchStockFallback
} from './fallback.js'

// ==================== 常量 ====================
const CACHE_TTL = 5 * 60 * 1000
const BREADTH_CACHE_TTL = 30 * 1000
const PORT = process.env.PORT || 3001

const EM_HEADERS = {
  Referer: 'https://quote.eastmoney.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

const INDEX_SECIDS = {
  sh: '1.000001',
  sz: '0.399001',
  cyb: '0.399006'
}

// ==================== 工具函数 ====================
function getTradeDate() {
  const now = new Date()
  if (now.getHours() < 9) now.setDate(now.getDate() - 1)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function toSecid(code) {
  return code.startsWith('6') ? `1.${code}` : `0.${code}`
}

function parseKline(line) {
  const p = line.split(',')
  return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6], turnover: +p[7] }
}

function parseKlineNoTurnover(line) {
  const p = line.split(',')
  return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6] }
}

function parseTrend(t) {
  const p = t.split(',')
  return { time: p[0], close: +p[2], avg: +p[3], volume: +p[5] }
}

function calcMA(arr, n) {
  if (arr.length < n) return null
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n
}

// ==================== 服务端缓存 ====================
const apiCache = new Map()
function getCached(key, ttl = CACHE_TTL) {
  const entry = apiCache.get(key)
  if (entry && Date.now() - entry.ts < ttl) return entry.data
  return null
}
function setCache(key, data) {
  apiCache.set(key, { data, ts: Date.now() })
}

// ==================== HTTP 请求 ====================
function fetchJSONviaHttps(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: EM_HEADERS }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')) })
  })
}

async function fetchJSON(url, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { headers: EM_HEADERS, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    return fetchJSONviaHttps(url, timeoutMs)
  }
}

// JRJ (金融界) 涨跌停温度计 API
const JRJ_HEADERS = { 'Content-Type': 'application/json', 'productId': '6000021' }

async function fetchJRJ(path, body = {}, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const res = await fetch(`https://gateway.jrj.com${path}`, {
    method: 'POST',
    headers: JRJ_HEADERS,
    body: JSON.stringify(body),
    signal: ctrl.signal
  })
  clearTimeout(timer)
  const json = await res.json()
  if (json.code !== 20000) throw new Error(json.msg || 'JRJ API error')
  return json.data
}

function diffVolume(trends) {
  for (let i = trends.length - 1; i > 0; i--) {
    if (trends[i].time.slice(0, 10) === trends[i - 1].time.slice(0, 10)) {
      trends[i].volume = Math.max(0, trends[i].volume - trends[i - 1].volume)
    }
  }
  return trends
}

function ok(data) { return { ok: true, data } }
function fail(msg) { return { ok: false, error: msg } }

// ==================== 路由 ====================
const app = new Koa()
const router = new Router()

app.use(cors())
app.use(bodyParser())
app.use(logger())

// --- Health ---
router.get('/api/health', (ctx) => {
  ctx.body = ok({ status: 'running', time: new Date().toISOString() })
})

// --- Market Indices ---
router.get('/api/market/indices', async (ctx) => {
  const cached = getCached('indices')
  if (cached) { ctx.body = ok(cached); return }
  try {
    const secids = Object.values(INDEX_SECIDS).join(',')
    const quoteUrl = `https://push2his.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21`
    const quoteData = await fetchJSON(quoteUrl)

    const indices = {}
    for (const [key, secid] of Object.entries(INDEX_SECIDS)) {
      indices[key] = { quote: null, klines: [], ma: {} }
      try {
        const klineUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=${getTradeDate()}&lmt=120`
        const kd = await fetchJSON(klineUrl)
        if (kd.data?.klines) {
          indices[key].klines = kd.data.klines.map(parseKlineNoTurnover)
          const closes = indices[key].klines.map(k => k.close)
          indices[key].ma = { ma20: calcMA(closes, 20), ma60: calcMA(closes, 60), ma120: calcMA(closes, 120) }
          if (closes.length >= 63) {
            const ma60_4days = []
            for (let i = 0; i < 4; i++) {
              const s = closes.length - 60 - (3 - i)
              ma60_4days.push(closes.slice(s, s + 60).reduce((a, b) => a + b, 0) / 60)
            }
            indices[key].ma60Trend = ma60_4days
          }
        }
      } catch (e) { /* kline 失败不影响行情 */ }
    }

    // K 线不足时从腾讯补取
    const tcMap = { sh: 'sh000001', sz: 'sz399001', cyb: 'sz399006' }
    for (const [key, tc] of Object.entries(tcMap)) {
      if (indices[key].klines.length < 35) {
        try {
          const kd = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,120,`)
          const raw = kd.data?.[tc]?.day || kd.data?.[tc]?.qfqday || []
          if (raw.length > indices[key].klines.length) {
            indices[key].klines = raw.map(k => ({ date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +k[5], amount: +(k[6] || 0) }))
            const closes = indices[key].klines.map(k => k.close)
            indices[key].ma = { ma20: calcMA(closes, 20), ma60: calcMA(closes, 60), ma120: calcMA(closes, 120) }
          }
        } catch (e) { /* 腾讯 K 线也失败 */ }
      }
    }

    if (quoteData.data?.diff) {
      const map = { '000001': 'sh', '399001': 'sz', '399006': 'cyb' }
      for (const item of quoteData.data.diff) {
        const key = map[item.f12]
        if (key) {
          indices[key].quote = {
            code: item.f12, name: item.f14, close: item.f2, change: item.f3,
            changeAmt: item.f4, high: item.f15, low: item.f16, open: item.f17,
            volume: item.f5, amount: item.f6
          }
        }
      }
    }

    ctx.body = ok(indices)
    setCache('indices', indices)
  } catch (e) {
    try {
      const fb = await fetchIndicesFallback()
      ctx.body = ok(fb)
      setCache('indices', fb)
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Market Breadth (涨跌家数) ---
router.get('/api/market/breadth', async (ctx) => {
  const cached = getCached('breadth', BREADTH_CACHE_TTL)
  if (cached) { ctx.body = ok(cached); return }

  try {
    // 东方财富：1.000002=沪A, 0.399002=深A, 0.899050=北交所 → f104=涨,f105=跌,f106=平
    const url = 'https://push2.eastmoney.com/api/qt/ulist/get?fltt=1&invt=2&fields=f104,f105,f106&secids=1.000002,0.399002,0.899050&ut=8dec03ba335b81bf4ebdf7b29ec27d15&pn=1&np=1&dect=1&pz=20'
    const data = await fetchJSON(url)
    const diff = data?.data?.diff
    if (diff?.length) {
      let up = 0, down = 0, flat = 0
      for (const d of diff) { up += d.f104 || 0; down += d.f105 || 0; flat += d.f106 || 0 }
      const result = { up, down, flat }
      ctx.body = ok(result)
      setCache('breadth', result)
      return
    }
  } catch (e) { /* 东方财富 ulist 不可用 */ }

  ctx.body = fail('breadth data unavailable')
})

// --- Indices Intraday (三大指数分时) ---
router.get('/api/market/indices/intraday', async (ctx) => {
  try {
    const result = {}
    const entries = [
      ['sh', INDEX_SECIDS.sh, '上证指数'],
      ['sz', INDEX_SECIDS.sz, '深证成指'],
      ['cyb', INDEX_SECIDS.cyb, '创业板指']
    ]
    for (const [key, secid, name] of entries) {
      try {
        const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
        const data = await fetchJSON(url)
        const trends = (data.data?.trends || []).map(parseTrend)
        if (trends.length > 10) {
          result[key] = { name, code: data.data?.code || '', preClose: data.data?.preClose || 0, trends }
          continue
        }
      } catch (e) { /* trends2 失败 */ }
      result[key] = { name, code: '', preClose: 0, trends: [] }
    }
    const hasData = Object.values(result).some(r => r.trends?.length > 0)
    if (!hasData) {
      try {
        const fb = await fetchIndicesIntradayFallback()
        for (const key of Object.keys(fb)) diffVolume(fb[key]?.trends || [])
        ctx.body = ok(fb)
        return
      } catch (e2) { /* fallback 也失败 */ }
    }
    ctx.body = ok(result)
  } catch (e) {
    try {
      const fb = await fetchIndicesIntradayFallback()
      for (const key of Object.keys(fb)) diffVolume(fb[key]?.trends || [])
      ctx.body = ok(fb)
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Northbound (北向资金) ---
async function fetchNorthboundStcn() {
  const url = 'https://info.stcn.com/dc/sjb/newindex.jsp?p=xcxBszjcjetusj'
  const res = await fetchJSON(url)
  if (!Array.isArray(res) || !res.length) throw new Error('stcn no data')
  // stcn returns [["2026.05.15","4353.3885"], ...] 单位：亿元，EM的NF_DEAL_AMT单位是百万元（亿×100）
  return res.map(d => ({
    date: d[0].replace(/\./g, '-'), nfAmt: Math.round(parseFloat(d[1]) * 100),
    sscAmt: 0, stAmt: 0, sciRate: 0, sscRate: 0, source: 'stcn'
  }))
}
router.get('/api/market/northbound', async (ctx) => {
  const cached = getCached('northbound')
  if (cached) { ctx.body = ok(cached); return }
  try {
    const dateStart = new Date()
    dateStart.setDate(dateStart.getDate() - 30)
    const ds = dateStart.toISOString().slice(0, 10)
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEALAMT&columns=TRADE_DATE,NF_DEAL_AMT,SSC_DEAL_AMT,ST_DEAL_AMT,SCI_INDEX_RATE,SSC_CHANGE_RATE&filter=(TRADE_DATE%3E%3D%27${ds}%27)&sortTypes=-1&sortColumns=TRADE_DATE&source=WEB&client=WEB&pageSize=25`
    let flows
    try {
      const data = await fetchJSON(url)
      flows = (data.result?.data || []).map(d => ({
        date: d.TRADE_DATE?.slice(0, 10), nfAmt: d.NF_DEAL_AMT, sscAmt: d.SSC_DEAL_AMT, stAmt: d.ST_DEAL_AMT,
        sciRate: d.SCI_INDEX_RATE, sscRate: d.SSC_CHANGE_RATE
      }))
    } catch (e1) {
      console.log('[northbound] eastmoney failed, trying stcn:', e1.message)
      flows = await fetchNorthboundStcn()
    }
    if (!flows?.length) {
      flows = await fetchNorthboundStcn()
    }
    ctx.body = ok(flows)
    setCache('northbound', flows)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// --- Margin Balance (融资余额) ---
router.get('/api/market/margin', async (ctx) => {
  const cached = getCached('margin')
  if (cached) { ctx.body = ok(cached); return }
  try {
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=ALL&pageSize=10&sortColumns=DIM_DATE&sortTypes=-1&source=WEB&client=WEB'
    const data = await fetchJSON(url)
    if (!data.result?.data?.length) { ctx.body = ok([]); return }
    const items = data.result.data.map(d => ({
      date: d.DIM_DATE?.slice(0, 10), rzBalance: d.RZYE, rzBuy: d.RZMRE, rzRepay: d.RZCHE,
      rzNetBuy: d.RZJME, rqBalance: d.RQYE, totalBalance: d.RZRQYE
    }))
    ctx.body = ok(items)
    setCache('margin', items)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// --- Limit-up/Limit-down Stats (涨停/跌停) ---
router.get('/api/market/limit-stats', async (ctx) => {
  try {
    let result = null

    // 优先使用 JRJ 数据源（数据更丰富：涨5%+/跌5%+、市场热度、分布桶）
    try {
      const emStatsUrl = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_CUSTOM_INTSELECTION_LIMIT&columns=LIMIT_NUMBERS,NATURAL_LIMIT,DAILY_LIMIT,TOUCH_LIMIT,SEALING_RATE,MONEYMAKING_EFFECT,NATURAL_LIMIT_YES,T1_PCTCHANGE,TRADE_DATE&source=WEB&client=WEB'
      const [market, history, emRes] = await Promise.all([
        fetchJRJ('/quot-dc/zdt/v1/market'),
        fetchJRJ('/quot-dc/zdt/market_history'),
        fetchJSON(emStatsUrl).catch(() => null)
      ])
      const s = market.stock || {}
      const td = String(market.tradedate || '')
      const dateStr = td.length === 8 ? `${td.slice(0,4)}-${td.slice(4,6)}-${td.slice(6,8)}` : ''
      const hist = (history.list || []).slice(0, 10)
      // 涨停以东方财富为准（EM准确），跌停以JRJ为准（EM的DAILY_LIMIT统计口径不全）
      // JRJ 补充温度/涨5%/历史等独有字段
      const em = emRes?.result?.data?.[0] || {}
      result = {
        date: dateStr || (em.TRADE_DATE?.slice(0, 10) || ''),
        limitUp: em.LIMIT_NUMBERS || s.zt || 0,
        limitDown: s.dt || em.DAILY_LIMIT || 0,
        up5p: s.up5p || 0,
        down5p: s.down5p || 0,
        temperature: +(market.temperature || 0).toFixed(2),
        totalStocks: s.total || 0,
        stopped: s.stopped || 0,
        buckets: s.buckets || [],
        naturalLimit: em.NATURAL_LIMIT || 0,
        touchLimit: em.TOUCH_LIMIT || 0,
        sealingRate: em.SEALING_RATE || 0,
        moneyEffect: em.MONEYMAKING_EFFECT || 0,
        t1PctChange: em.T1_PCTCHANGE || 0,
        history: hist.map(h => ({
          date: String(h.tradeDate),
          limitUp: h.upLimitCount,
          limitDown: h.downLimitCount,
          upMoM: +(h.upIncrRatio * 100).toFixed(1),
          downMoM: +(h.downIncrRatio * 100).toFixed(1),
          marketAmount: h.marketAmount
        })),
        source: 'jrj'
      }
    } catch (e) {
      console.error('JRJ limit-stats failed:', e.message)
    }

    // JRJ 失败则回退到东方财富
    if (!result) {
      const statsUrl = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_CUSTOM_INTSELECTION_LIMIT&columns=LIMIT_NUMBERS,NATURAL_LIMIT,DAILY_LIMIT,TOUCH_LIMIT,SEALING_RATE,MONEYMAKING_EFFECT,NATURAL_LIMIT_YES,T1_PCTCHANGE,TRADE_DATE&source=WEB&client=WEB'
      const fenbuUrl = 'https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt'
      const [statsData, fenbuData] = await Promise.allSettled([fetchJSON(statsUrl), fetchJSON(fenbuUrl)])

      let limitUp = 0, limitDown = 0, sealingRate = 0, moneyEffect = 0, date = ''
      let naturalLimit = 0, touchLimit = 0, t1PctChange = 0
      if (statsData.status === 'fulfilled' && statsData.value?.result?.data?.[0]) {
        const s = statsData.value.result.data[0]
        limitUp = s.LIMIT_NUMBERS || 0
        sealingRate = s.SEALING_RATE || 0
        moneyEffect = s.MONEYMAKING_EFFECT || 0
        naturalLimit = s.NATURAL_LIMIT || 0
        touchLimit = s.TOUCH_LIMIT || 0
        t1PctChange = s.T1_PCTCHANGE || 0
        date = s.TRADE_DATE?.slice(0, 10) || ''
      }
      if (fenbuData.status === 'fulfilled' && fenbuData.value?.data?.fenbu) {
        let fenbuUp = 0, fenbuDown = 0
        for (const item of fenbuData.value.data.fenbu) {
          if (item['10'] != null) fenbuUp += item['10']
          if (item['11'] != null) fenbuUp += item['11']
          if (item['20'] != null) fenbuUp += item['20']
          if (item['-10'] != null) fenbuDown += item['-10']
          if (item['-11'] != null) fenbuDown += item['-11']
          if (item['-20'] != null) fenbuDown += item['-20']
        }
        if (!limitUp) limitUp = fenbuUp
        limitDown = fenbuDown
      }
      result = { date, limitUp, limitDown, naturalLimit, touchLimit, sealingRate, moneyEffect, t1PctChange, source: 'eastmoney' }
    }

    ctx.body = ok(result)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// --- Stock K-line (120日) ---
router.get('/api/stock/:code/kline', async (ctx) => {
  try {
    const code = ctx.params.code
    const klt = ctx.query.klt || '101'
    const lmt = ctx.query.lmt || '120'
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${toSecid(code)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=1&end=${getTradeDate()}&lmt=${lmt}`
    const data = await fetchJSON(url)
    const klines = (data.data?.klines || []).map(parseKline)
    const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : null
    ctx.body = ok({ klines, prevClose, code: data.data?.code, name: data.data?.name })
  } catch (e) {
    try {
      ctx.body = ok(await fetchStockKlineFallback(ctx.params.code))
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Stock K-line 5y (~1200日) ---
router.get('/api/stock/:code/kline5y', async (ctx) => {
  try {
    const code = ctx.params.code
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${toSecid(code)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=${getTradeDate()}&lmt=1200`
    const data = await fetchJSON(url)
    const klines = (data.data?.klines || []).map(parseKline)
    ctx.body = ok({ klines, code: data.data?.code, name: data.data?.name })
  } catch (e) {
    try {
      ctx.body = ok(await fetchStockKline5yFallback(ctx.params.code))
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Stock Intraday (分时) ---
router.get('/api/stock/:code/intraday', async (ctx) => {
  const code = ctx.params.code
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${toSecid(code)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
    const data = await fetchJSON(url)
    const trends = (data.data?.trends || []).map(parseTrend)
    if (trends.length > 10) {
      const result = { code: data.data?.code, name: data.data?.name, preClose: data.data?.preClose || 0, trends }
      setCache('intraday_' + code, result)
      ctx.body = ok(result)
      return
    }
  } catch (e) { /* EM failed */ }
  const cached = getCached('intraday_' + code)
  if (cached) { ctx.body = ok(cached); return }
  try {
    const fb = await fetchStockIntradayFallback(code)
    diffVolume(fb.trends)
    ctx.body = ok(fb)
  } catch (e2) {
    ctx.body = fail(e2.message)
  }
})

// --- Stock Intraday 5-Day ---
router.get('/api/stock/:code/intraday5d', async (ctx) => {
  const code = ctx.params.code
  const cached = getCached('intraday5d_' + code)
  if (cached) { ctx.body = ok(cached); return }
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${toSecid(code)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=5`
    const data = await fetchJSON(url)
    const trends = (data.data?.trends || []).map(parseTrend)
    if (trends.length > 100) {
      const result = { code: data.data?.code, preClose: data.data?.preClose || 0, trends }
      setCache('intraday5d_' + code, result)
      ctx.body = ok(result)
      return
    }
    throw new Error('trends2 insufficient')
  } catch (e) {
    try {
      const fb = await fetchStockIntraday5dFallback(code)
      diffVolume(fb.trends)
      ctx.body = ok(fb)
    } catch (e2) {
      ctx.body = fail(e2.message)
    }
  }
})

// --- Stock Basic (PE/PB/市值) ---
router.get('/api/stock/:code/basic', async (ctx) => {
  try {
    const code = ctx.params.code
    const url = `https://push2his.eastmoney.com/api/qt/stock/get?secid=${toSecid(code)}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f116,f117,f162,f167,f170,f171,f173,f184,f186,f187,f188,f190,f191,f192&fltt=2`
    const data = await fetchJSON(url)
    const d = data.data || {}
    ctx.body = ok({
      code, name: d.f58 || '', pe: d.f184, pb: d.f167,
      totalMarketCap: d.f116, circulationMarketCap: d.f117, circulationShares: d.f162,
      roe: d.f190, grossMargin: d.f186, netMargin: d.f187,
      revenueGrowth: d.f188, profitGrowth: d.f191, debtRatio: d.f192,
      high52w: d.f173, low52w: d.f170
    })
  } catch (e) {
    try {
      ctx.body = ok(await fetchStockBasicFallback(ctx.params.code))
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Batch Quotes ---
router.get('/api/stock/batch/quotes', async (ctx) => {
  try {
    const codes = ctx.query.codes || ''
    if (!codes) { ctx.body = ok({}); return }
    const secids = codes.split(',').filter(Boolean).map(toSecid).join(',')
    const url = `https://push2his.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21`
    const data = await fetchJSON(url)
    const result = {}
    if (data.data?.diff) {
      for (const item of data.data.diff) {
        result[item.f12] = {
          name: item.f14, close: item.f2, change: item.f3, changeAmt: item.f4,
          high: item.f15, low: item.f16, open: item.f17, volume: item.f5,
          amount: item.f6, turnover: item.f10
        }
      }
    }
    ctx.body = ok(result)
  } catch (e) {
    try {
      const codeList = (ctx.query.codes || '').split(',').filter(Boolean)
      ctx.body = ok(await fetchBatchQuotesFallback(codeList))
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Stock Search ---
router.get('/api/stock/search', async (ctx) => {
  try {
    const kw = ctx.query.kw || ''
    if (!kw) { ctx.body = ok([]); return }
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`
    const data = await fetchJSON(url)
    const items = (data.QuotationCodeTable?.Data || [])
      .filter(item => item.Classify === 'AStock' || item.SecurityTypeName === 'A股')
      .slice(0, 6)
      .map(item => ({ code: item.Code, name: item.Name, type: item.SecurityTypeName }))
    ctx.body = ok(items)
  } catch (e) {
    try {
      ctx.body = ok(await searchStockFallback(ctx.query.kw || ''))
    } catch (e2) {
      ctx.body = fail(e.message)
    }
  }
})

// --- Stock Screening (Strategy-based) ---
router.get('/api/stock/screen', async (ctx) => {
  try {
    const strategy = ctx.query.strategy || 'trend'
    const count = Math.min(parseInt(ctx.query.count) || 10, 20)
    const val = (v) => (typeof v === 'number' ? v : null)

    // 第一步: datacenter 获取 ROE 合格的股票池
    const roeMap = new Map()
    try {
      const roeUrl = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=SECURITY_CODE,WEIGHTAVG_ROE,SJLTZ,YSTZ&filter=(WEIGHTAVG_ROE%3E12)(WEIGHTAVG_ROE%3C50)(SECURITY_TYPE_CODE%3D%22058001001%22)(ISNEW%3D%221%22)&pageSize=3000&sortColumns=WEIGHTAVG_ROE&sortTypes=-1&source=WEB&client=WEB'
      const roeData = await fetchJSON(roeUrl)
      for (const r of (roeData.result?.data || [])) {
        roeMap.set(r.SECURITY_CODE, { roe: r.WEIGHTAVG_ROE, profitGrowth: r.SJLTZ, revenueGrowth: r.YSTZ })
      }
    } catch (e) { /* ROE 数据获取失败 */ }

    const isST = (name) => /ST|退/.test(name || '')
    const fs = 'm:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2'
    const fields = 'f2,f3,f4,f6,f8,f9,f10,f12,f14,f20,f21,f23,f62,f115,f128'
    let stocks

    if (strategy === 'pullback') {
      const clistUrl = `https://push2his.eastmoney.com/api/qt/clist/get?pn=1&pz=500&np=1&fltt=2&invt=2&fid=f21&po=1&fs=${fs}&fields=${fields}`
      let clistData
      try { clistData = await fetchJSON(clistUrl) } catch (e) { ctx.body = ok({ strategy, prompt: '', stocks: [] }); return }
      stocks = (clistData.data?.diff || [])
        .filter(s => {
          if (isST(s.f14)) return false
          const code = String(s.f12)
          if (roeMap.size && !roeMap.has(code)) return false
          const cap = val(s.f21) || 0
          const pe = val(s.f115) || val(s.f9) || 0
          const turnover = val(s.f8) || 0
          const change = val(s.f3) || 0
          return cap > 5e9 && pe > 5 && pe < 40 && turnover > 0.3 && turnover < 10 && change > -5 && change < 5
        })
        .slice(0, count)
    } else {
      const clistUrl = `https://push2his.eastmoney.com/api/qt/clist/get?pn=1&pz=200&np=1&fltt=2&invt=2&fid=f62&po=1&fs=${fs}&fields=${fields}`
      let clistData
      try { clistData = await fetchJSON(clistUrl) } catch (e) { ctx.body = ok({ strategy, prompt: '', stocks: [] }); return }
      stocks = (clistData.data?.diff || [])
        .filter(s => {
          if (isST(s.f14)) return false
          const code = String(s.f12)
          if (roeMap.size && !roeMap.has(code)) return false
          const cap = val(s.f21) || 0
          const pe = val(s.f115) || val(s.f9) || 0
          const turnover = val(s.f8) || 0
          return cap > 3e9 && pe > 5 && pe < 80 && turnover > 2
        })
        .slice(0, count)
    }

    const result = stocks.map(s => {
      const code = String(s.f12)
      const fin = roeMap.get(code) || {}
      return {
        code, name: s.f14,
        price: val(s.f2), change: val(s.f3),
        amount: val(s.f6) ? Math.round(val(s.f6) / 1e4) : null,
        turnover: val(s.f8), pe: val(s.f115) || val(s.f9),
        marketCap: val(s.f21) ? Math.round(val(s.f21) / 1e8) : null,
        pb: val(s.f23), mainFlow: val(s.f62) ? Math.round(val(s.f62) / 1e4) : null,
        industry: s.f128 || '',
        roe: fin.roe ? Math.round(fin.roe * 100) / 100 : null,
        revenueGrowth: fin.revenueGrowth ? Math.round(fin.revenueGrowth * 100) / 100 : null,
        profitGrowth: fin.profitGrowth ? Math.round(fin.profitGrowth * 100) / 100 : null,
      }
    })
    ctx.body = ok({ strategy, stocks: result })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// --- Xuangu Natural Language Screening ---
function parseChineseNum(str) {
  if (!str || typeof str !== 'string') return null
  str = str.replace(/,/g, '')
  if (str.endsWith('亿')) return Math.round(parseFloat(str) * 1e8)
  if (str.endsWith('万')) return Math.round(parseFloat(str) * 1e4)
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

router.post('/api/stock/xuangu', async (ctx) => {
  try {
    const { prompt } = ctx.request.body || {}
    if (!prompt) { ctx.body = fail('prompt不能为空'); return }

    const rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 18)
    const body = {
      keyWord: prompt, pageSize: 20, pageNo: 1, xcId: '', cmd5: '',
      client: 'pc', biz: 'pc_ai_select_stocks', fingerprint: rid.slice(0, 16),
      matchWord: '', timestamp: Date.now(), shareToGuba: false, requestId: rid,
      dynamicType: 'COMMON', allCode: true, ownSelectAll: false,
      needCorrect: true, needShowStockNum: true, ignoreRightsField: false,
      needAmbiguousSuggest: false, notExecuteCompute: false, removedConditionIdList: []
    }

    const resp = await fetch('https://np-tjxg-b.eastmoney.com/api/smart-tag/stock/v3/comm/search-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://xuangu.eastmoney.com/',
        'Origin': 'https://xuangu.eastmoney.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(body)
    })
    const data = await resp.json()
    if (data.code !== '100') { ctx.body = fail(data.msg || '选股服务异常'); return }

    const result = data.data?.result || {}
    const stocks = (result.dataList || []).map(s => ({
      code: s.SECURITY_CODE, name: s.SECURITY_SHORT_NAME,
      price: parseChineseNum(s.NEWEST_PRICE), change: parseChineseNum(s.CHG),
      turnover: parseChineseNum(s.TURNOVER_RATE), pe: parseChineseNum(s.PE_DYNAMIC),
      pb: parseChineseNum(s.PB), marketCap: parseChineseNum(s['CIRCULATION_MARKET_VALUE<140>']),
      volume: s.VOLUME, amount: parseChineseNum(s.TRADING_VOLUMES),
      chgAmt: parseChineseNum(s.PCHG), marketNum: s.MARKET_NUM,
    }))
    const conditions = (data.data?.responseConditionList || []).map(c => ({
      describe: c.describe, count: c.stockCount
    }))
    ctx.body = ok({ stocks, conditions, total: result.total || 0 })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// ==================== 市场分析模块 ====================
import { registerAnalysisRoutes } from './analysis.js'
registerAnalysisRoutes(router)

// ==================== 个股分析模块 ====================
import { registerStockAnalysisRoutes } from './stockAnalysis.js'
registerStockAnalysisRoutes(router)

// ==================== 启动 ====================
app.use(router.routes())
app.use(router.allowedMethods())
app.listen(PORT, () => {
  console.log(`SmartStock API server running on http://localhost:${PORT}`)
})
