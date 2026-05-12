import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import logger from 'koa-logger'

const app = new Koa()
const router = new Router()

app.use(cors())
app.use(logger())

const EM_HEADERS = {
  Referer: 'https://quote.eastmoney.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: EM_HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function ok(data) {
  return { ok: true, data }
}

function fail(msg) {
  return { ok: false, error: msg }
}

// === Health ===
router.get('/api/health', (ctx) => {
  ctx.body = ok({ status: 'running', time: new Date().toISOString() })
})

// === Market Indices ===
// 三大指数: 上证000001, 深证399001, 创业板399006
const INDEX_CODES = {
  sh: '1.000001',
  sz: '0.399001',
  cyb: '0.399006'
}

// 指数 secid 映射 (东方财富secid格式: 市场.代码)
const INDEX_SECIDS = {
  sh: '1.000001',
  sz: '0.399001',
  cyb: '0.399006'
}

router.get('/api/market/indices', async (ctx) => {
  try {
    // 获取三大指数实时行情
    const quoteUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${INDEX_SECIDS.sh},${INDEX_SECIDS.sz},${INDEX_SECIDS.cyb}&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21`
    const quoteData = await fetchJSON(quoteUrl)

    // 获取 120 日 K 线 (每个指数)
    const indices = {}
    const klinePromises = Object.entries({ sh: '1.000001', sz: '0.399001', cyb: '0.399006' }).map(async ([key, secid]) => {
      const klineUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=120`
      const kd = await fetchJSON(klineUrl)
      indices[key] = { quote: null, klines: [], ma: {} }
      if (kd.data && kd.data.klines) {
        indices[key].klines = kd.data.klines.map(line => {
          const p = line.split(',')
          return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6] }
        })
        // 计算 MA
        const closes = indices[key].klines.map(k => k.close)
        const calcMA = (arr, n) => {
          if (arr.length < n) return null
          const slice = arr.slice(-n)
          return slice.reduce((a, b) => a + b, 0) / n
        }
        indices[key].ma = {
          ma20: calcMA(closes, 20),
          ma60: calcMA(closes, 60),
          ma120: calcMA(closes, 120)
        }
        // MA60 四日趋势
        if (closes.length >= 63) {
          const ma60_4days = []
          for (let i = 0; i < 4; i++) {
            const s = closes.length - 60 - (3 - i)
            ma60_4days.push(closes.slice(s, s + 60).reduce((a, b) => a + b, 0) / 60)
          }
          indices[key].ma60Trend = ma60_4days
        }
      }
    })
    await Promise.all(klinePromises)

    // 填充实时行情
    if (quoteData.data && quoteData.data.diff) {
      const diff = quoteData.data.diff
      const map = { '000001': 'sh', '399001': 'sz', '399006': 'cyb' }
      for (const item of diff) {
        const key = map[item.f12]
        if (key) {
          indices[key].quote = {
            code: item.f12,
            name: item.f14,
            close: item.f2,
            change: item.f3,
            changeAmt: item.f4,
            high: item.f15,
            low: item.f16,
            open: item.f17,
            volume: item.f5,
            amount: item.f6
          }
        }
      }
    }

    ctx.body = ok(indices)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Market Breadth (涨跌家数) ===
router.get('/api/market/breadth', async (ctx) => {
  try {
    // 沪市
    const shUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001&fields=f104,f105,f106'
    const shData = await fetchJSON(shUrl)
    // 深市
    const szUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=0.399001&fields=f104,f105,f106'
    const szData = await fetchJSON(szUrl)

    const sh = shData.data?.diff?.[0] || {}
    const sz = szData.data?.diff?.[0] || {}

    ctx.body = ok({
      up: (sh.f104 || 0) + (sz.f104 || 0),
      down: (sh.f105 || 0) + (sz.f105 || 0),
      flat: (sh.f106 || 0) + (sz.f106 || 0)
    })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Indices Intraday (三大指数分时) ===
router.get('/api/market/indices/intraday', async (ctx) => {
  try {
    const result = {}
    const entries = [
      ['sh', '1.000001', '上证指数'],
      ['sz', '0.399001', '深证成指'],
      ['cyb', '0.399006', '创业板指']
    ]
    const promises = entries.map(async ([key, secid, name]) => {
      const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
      const data = await fetchJSON(url)
      const trends = data.data?.trends || []
      const preClose = data.data?.preClose || 0
      result[key] = {
        name,
        code: data.data?.code || '',
        preClose,
        trends: trends.map(t => {
          const p = t.split(',')
          return { time: p[0], close: +p[2], avg: +p[3], volume: +p[5] }
        })
      }
    })
    await Promise.all(promises)
    ctx.body = ok(result)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Northbound (北向资金) ===
router.get('/api/market/northbound', async (ctx) => {
  try {
    const url = 'https://push2his.eastmoney.com/api/qt/kamt.kline/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=5'
    const data = await fetchJSON(url)
    const flows = []
    if (data.data && data.data.s2n) {
      for (const item of data.data.s2n) {
        const p = item.split(',')
        flows.push({
          date: p[0],
          shNet: +p[1],
          szNet: +p[2],
          totalNet: +p[1] + +p[2]
        })
      }
    }
    ctx.body = ok(flows)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock K-line (120日) ===
router.get('/api/stock/:code/kline', async (ctx) => {
  try {
    const code = ctx.params.code
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=120`
    const data = await fetchJSON(url)
    const klines = (data.data?.klines || []).map(line => {
      const p = line.split(',')
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6], turnover: +p[7] }
    })
    // prevClose: 前一日收盘价 (用于 ATR)
    const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : null
    ctx.body = ok({ klines, prevClose, code: data.data?.code, name: data.data?.name })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock K-line 5y (~1200日) ===
router.get('/api/stock/:code/kline5y', async (ctx) => {
  try {
    const code = ctx.params.code
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=1200`
    const data = await fetchJSON(url)
    const klines = (data.data?.klines || []).map(line => {
      const p = line.split(',')
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6], turnover: +p[7] }
    })
    ctx.body = ok({ klines, code: data.data?.code, name: data.data?.name })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock Intraday (分时) ===
router.get('/api/stock/:code/intraday', async (ctx) => {
  try {
    const code = ctx.params.code
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
    const data = await fetchJSON(url)
    const trends = (data.data?.trends || []).map(t => {
      const p = t.split(',')
      return { time: p[0], close: +p[2], avg: +p[3], volume: +p[5] }
    })
    ctx.body = ok({
      code: data.data?.code,
      name: data.data?.name,
      preClose: data.data?.preClose || 0,
      trends
    })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock Basic (PE/PB/市值) ===
router.get('/api/stock/:code/basic', async (ctx) => {
  try {
    const code = ctx.params.code
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f9,f23,f20,f116,f117,f162,f167,f170,f171,f173,f177,f186,f187,f188,f190,f191,f192`
    const data = await fetchJSON(url)
    const d = data.data || {}
    ctx.body = ok({
      code,
      name: d.f58 || '',
      pe: d.f9,
      pb: d.f23,
      totalMarketCap: d.f20,
      circulationMarketCap: d.f116,
      totalShares: d.f117,
      circulationShares: d.f162,
      roe: d.f190,
      grossMargin: d.f186,
      netMargin: d.f187,
      revenueGrowth: d.f188,
      profitGrowth: d.f191,
      debtRatio: d.f192,
      high52w: d.f173,
      low52w: d.f170,
      turnoverRate: d.f168,
      volume: d.f5,
      amount: d.f6
    })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Batch Quotes ===
router.get('/api/stock/batch/quotes', async (ctx) => {
  try {
    const codes = ctx.query.codes || ''
    if (!codes) {
      ctx.body = ok({})
      return
    }
    const codeList = codes.split(',').filter(Boolean)
    const secids = codeList.map(c => c.startsWith('6') ? `1.${c}` : `0.${c}`).join(',')
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21`
    const data = await fetchJSON(url)
    const result = {}
    if (data.data && data.data.diff) {
      for (const item of data.data.diff) {
        result[item.f12] = {
          name: item.f14,
          close: item.f2,
          change: item.f3,
          changeAmt: item.f4,
          high: item.f15,
          low: item.f16,
          open: item.f17,
          volume: item.f5,
          amount: item.f6,
          turnover: item.f10
        }
      }
    }
    ctx.body = ok(result)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock Search ===
router.get('/api/stock/search', async (ctx) => {
  try {
    const kw = ctx.query.kw || ''
    if (!kw) {
      ctx.body = ok([])
      return
    }
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(kw)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`
    const data = await fetchJSON(url)
    const items = (data.QuotationCodeTable?.Data || [])
      .filter(item => item.Classify === 'AStock' || item.SecurityTypeName === 'A股')
      .slice(0, 6)
      .map(item => ({
        code: item.Code,
        name: item.Name,
        type: item.SecurityTypeName
      }))
    ctx.body = ok(items)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

const PORT = 3001
app.listen(PORT, () => {
  console.log(`SmartStock API server running on http://localhost:${PORT}`)
})
