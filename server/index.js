import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import logger from 'koa-logger'
import https from 'https'
import dns from 'dns'

// 强制 IPv4，东方财富 IPv6 服务不稳定
dns.setDefaultResultOrder('ipv4first')

const app = new Koa()
const router = new Router()

app.use(cors())
app.use(logger())

const EM_HEADERS = {
  Referer: 'https://quote.eastmoney.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

// 合成分时数据：从日K线 OHLC 插值生成 240 个分钟点
function syntheticIntraday(open, high, low, close) {
  const isUp = close >= open
  // 根据涨跌决定路径：涨→先探低再冲高；跌→先冲高再探低
  const wp = isUp ? [open, low, high, close] : [open, high, low, close]
  const range = (high - low) || 1
  const points = []
  for (let i = 0; i < 240; i++) {
    // 3 段插值：0-80, 80-160, 160-240
    const seg = Math.min(Math.floor(i / 80), 2)
    const t = (i - seg * 80) / 80
    const val = wp[seg] + (wp[seg + 1] - wp[seg]) * t
    // 生成时间标签
    let h, m
    if (i < 120) { const tot = 570 + i; h = Math.floor(tot / 60); m = tot % 60 }
    else { const tot = 780 + (i - 120); h = Math.floor(tot / 60); m = tot % 60 }
    points.push({
      time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      close: Math.round(val * 100) / 100,
      avg: Math.round(val * 100) / 100,
      volume: 0
    })
  }
  return points
}

// 从 K 线获取最近一根的 OHLC 并合成分时
async function fallbackIntradayFromKline(secid) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=2`
  const data = await fetchJSON(url)
  const klines = data.data?.klines || []
  if (!klines.length) return null
  const p = klines[klines.length - 1].split(',')
  const open = +p[1], close = +p[2], high = +p[3], low = +p[4]
  const preClose = klines.length >= 2 ? +klines[klines.length - 2].split(',')[2] : close
  return { preClose, trends: syntheticIntraday(open, high, low, close) }
}

function fetchJSONviaHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: EM_HEADERS }, (res) => {
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
  })
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { headers: EM_HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    // undici fetch 对部分接口有 socket 兼容性问题，回退到 https 模块
    return fetchJSONviaHttps(url)
  }
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
      try {
        const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
        const data = await fetchJSON(url)
        const trends = (data.data?.trends || []).map(t => {
          const p = t.split(',')
          return { time: p[0], close: +p[2], avg: +p[3], volume: +p[5] }
        })
        if (trends.length > 10) {
          result[key] = {
            name,
            code: data.data?.code || '',
            preClose: data.data?.preClose || 0,
            trends
          }
          return
        }
      } catch (e) { /* trends2 失败，不降级 */ }
      result[key] = { name, code: '', preClose: 0, trends: [] }
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
    const url = 'https://push2his.eastmoney.com/api/qt/kamt.kline/get?fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=5'
    const data = await fetchJSON(url)
    const flows = []
    if (data.data) {
      // s2n 格式: date, 已用额度(万元), 总额度(万元), 余额
      // p[1] = 当日北向净流入（已用额度），单位万元
      const s2n = data.data.s2n || []
      const hk2sh = data.data.hk2sh || []
      const hk2sz = data.data.hk2sz || []
      const len = Math.max(s2n.length, hk2sh.length, hk2sz.length)
      for (let i = 0; i < len; i++) {
        const s2nP = s2n[i]?.split(',') || []
        const shP = hk2sh[i]?.split(',') || []
        const szP = hk2sz[i]?.split(',') || []
        const date = s2nP[0] || shP[0] || szP[0] || ''
        // 优先用 s2n 合计，其次用 hk2sh+hk2sz 求和
        const s2nFlow = +s2nP[1] || 0
        const shFlow = +shP[1] || 0
        const szFlow = +szP[1] || 0
        const totalNet = s2nFlow > 0 ? s2nFlow : (shFlow + szFlow)
        flows.push({ date, shNet: shFlow, szNet: szFlow, totalNet })
      }
    }
    ctx.body = ok(flows)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Margin Balance (融资余额) ===
router.get('/api/market/margin', async (ctx) => {
  try {
    // 获取沪深京两市合计融资余额近 10 日数据
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=ALL&pageSize=10&sortColumns=DIM_DATE&sortTypes=-1&source=WEB&client=WEB'
    const data = await fetchJSON(url)
    if (!data.result?.data?.length) {
      ctx.body = ok([])
      return
    }
    const items = data.result.data.map(d => ({
      date: d.DIM_DATE?.slice(0, 10),
      rzBalance: d.RZYE,        // 融资余额（元）
      rzBuy: d.RZMRE,            // 融资买入额
      rzRepay: d.RZCHE,          // 融资偿还额
      rzNetBuy: d.RZJME,         // 融资净买入额
      rqBalance: d.RQYE,         // 融券余额
      totalBalance: d.RZRQYE     // 融资融券余额
    }))
    ctx.body = ok(items)
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Limit-up/Limit-down Stats (涨停/跌停) ===
router.get('/api/market/limit-stats', async (ctx) => {
  try {
    // API 1: 涨停统计 (涨停数、封板率、赚钱效应)
    const statsUrl = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_CUSTOM_INTSELECTION_LIMIT&columns=LIMIT_NUMBERS,NATURAL_LIMIT,DAILY_LIMIT,TOUCH_LIMIT,SEALING_RATE,MONEYMAKING_EFFECT,NATURAL_LIMIT_YES,TRADE_DATE&source=WEB&client=WEB'
    // API 2: 涨跌幅分布 (涨跌停家数)
    const fenbuUrl = 'https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt'

    const [statsData, fenbuData] = await Promise.allSettled([
      fetchJSON(statsUrl),
      fetchJSON(fenbuUrl)
    ])

    let limitUp = 0, limitDown = 0, sealingRate = 0, moneyEffect = 0, date = ''

    // 从涨停统计获取
    if (statsData.status === 'fulfilled' && statsData.value?.result?.data?.[0]) {
      const s = statsData.value.result.data[0]
      limitUp = s.LIMIT_NUMBERS || 0
      sealingRate = s.SEALING_RATE || 0
      moneyEffect = s.MONEYMAKING_EFFECT || 0
      date = s.TRADE_DATE?.slice(0, 10) || ''
    }

    // 从分布获取涨跌停数
    if (fenbuData.status === 'fulfilled' && fenbuData.value?.data?.fenbu) {
      for (const item of fenbuData.value.data.fenbu) {
        if (item['11'] != null) limitUp = limitUp || item['11']
        if (item['-11'] != null) limitDown = item['-11']
      }
    }

    ctx.body = ok({ date, limitUp, limitDown, sealingRate, moneyEffect })
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
    try {
      const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
      const data = await fetchJSON(url)
      const trends = (data.data?.trends || []).map(t => {
        const p = t.split(',')
        return { time: p[0], close: +p[2], avg: +p[3], volume: +p[5] }
      })
      if (trends.length > 10) {
        ctx.body = ok({
          code: data.data?.code,
          name: data.data?.name,
          preClose: data.data?.preClose || 0,
          trends
        })
        return
      }
    } catch (e) { /* trends2 失败，走 fallback */ }
    // Fallback: 从 K 线 OHLC 合成分时
    const fb = await fallbackIntradayFromKline(secid)
    ctx.body = ok({ code, name: '', preClose: fb?.preClose || 0, trends: fb?.trends || [] })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock Intraday 5-Day (5日分时合集) ===
router.get('/api/stock/:code/intraday5d', async (ctx) => {
  try {
    const code = ctx.params.code
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
    // 取最近 6 根日 K 线（前 5 根合成，第 6 根备用算 preClose）
    const klineUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=6`
    const klineData = await fetchJSON(klineUrl)
    const klines = (klineData.data?.klines || []).map(l => {
      const p = l.split(',')
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4] }
    })

    let allTrends = []
    // 取当天真实分时
    let todayTrends = []
    try {
      const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`
      const data = await fetchJSON(url)
      todayTrends = (data.data?.trends || []).map(t => {
        const p = t.split(',')
        return { time: p[0], close: +p[2], avg: +p[3], volume: +p[5] }
      })
    } catch (e) { /* ignore */ }

    // 拼接前几天的合成数据 + 今天的真实数据
    const todayDate = klines.length ? klines[klines.length - 1].date : ''
    const prevDays = klines.filter(k => k.date !== todayDate).slice(-5)

    for (const k of prevDays) {
      const synth = syntheticIntraday(k.open, k.high, k.low, k.close)
      synth.forEach(p => { p.time = k.date + ' ' + p.time })
      allTrends.push(...synth)
    }

    if (todayTrends.length > 10) {
      allTrends.push(...todayTrends)
    } else if (klines.length) {
      const k = klines[klines.length - 1]
      const synth = syntheticIntraday(k.open, k.high, k.low, k.close)
      synth.forEach(p => { p.time = k.date + ' ' + p.time })
      allTrends.push(...synth)
    }

    const preClose = klines.length >= 2 ? klines[klines.length - 2].close : (klines[0]?.close || 0)
    ctx.body = ok({ code, preClose, trends: allTrends })
  } catch (e) {
    ctx.body = fail(e.message)
  }
})

// === Stock Basic (PE/PB/市值) ===
router.get('/api/stock/:code/basic', async (ctx) => {
  try {
    const code = ctx.params.code
    const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f116,f117,f162,f167,f170,f171,f173,f184,f186,f187,f188,f190,f191,f192&fltt=2`
    const data = await fetchJSON(url)
    const d = data.data || {}
    ctx.body = ok({
      code,
      name: d.f58 || '',
      pe: d.f184,
      pb: d.f167,
      totalMarketCap: d.f116,
      circulationMarketCap: d.f117,
      circulationShares: d.f162,
      roe: d.f190,
      grossMargin: d.f186,
      netMargin: d.f187,
      revenueGrowth: d.f188,
      profitGrowth: d.f191,
      debtRatio: d.f192,
      high52w: d.f173,
      low52w: d.f170
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
