import https from 'https'
import dns from 'dns'

// ==================== 常量 ====================
const EM_HEADERS = {
  Referer: 'https://quote.eastmoney.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

const FUNDAMENTAL_CACHE_TTL = 30 * 60 * 1000  // 30分钟缓存（含实时PE/PB，需较新）
const CAPITAL_CACHE_TTL = 5 * 60 * 1000  // 5分钟缓存
const MARGIN_CACHE_TTL = 30 * 60 * 1000  // 30分钟缓存
const NORTHBOUND_CACHE_TTL = 10 * 60 * 1000  // 10分钟缓存（日度数据更新较频）
const MAIN_FORCE_CACHE_TTL = 5 * 60 * 1000  // 5分钟缓存（日度资金流更新较频）
const INTRADAY_MF_CACHE_TTL = 3 * 60 * 1000  // 日内分时 3分钟缓存
const SHAREHOLDER_CACHE_TTL = 60 * 60 * 1000  // 60分钟缓存（季度数据更新慢）
const CACHE_MAX_SIZE = 200  // 每个缓存最多 200 条，防止内存泄漏

const fundamentalCache = new Map()
const capitalCache = new Map()
const marginCache = new Map()
const northboundCache = new Map()
const mainForceCache = new Map()
const intradayMfCache = new Map()
const shareholderCache = new Map()

// 通用缓存写入：淘汰最旧条目，更新时移动到末尾
function cacheSet(cache, key, value) {
  if (cache.has(key)) cache.delete(key)
  if (cache.size >= CACHE_MAX_SIZE) {
    const firstKey = cache.keys().next().value
    cache.delete(firstKey)
  }
  cache.set(key, value)
}
// 缓存命中时刷新位置，保持 LRU 顺序
function cacheTouch(cache, key) {
  if (!cache.has(key)) return
  const val = cache.get(key)
  cache.delete(key)
  cache.set(key, val)
}

function ok(data) { return { ok: true, data } }
function fail(msg) { return { ok: false, error: msg } }

function toSecid(code) {
  return code.startsWith('6') ? `1.${code}` : `0.${code}`
}

function fetchJSONviaHttps(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    // 强制 IPv4，避免东方财富部分域名 IPv6 不通导致 socket hang up
    dns.resolve4(parsed.hostname, (err, addrs) => {
      if (err || !addrs?.length) return reject(err || new Error('no IPv4'))
      const options = {
        hostname: addrs[0],
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { ...EM_HEADERS, Host: parsed.hostname },
        servername: parsed.hostname,
      }
      const req = https.request(options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')) })
      req.end()
    })
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

function getTradeDate() {
  const now = new Date()
  if (now.getHours() < 9) now.setDate(now.getDate() - 1)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * 从日K价格映射中找报告期最近的收盘价
 * 报告期如 "2025-06-30"，找前后 3 天内最近的日K收盘价
 */
function findClosestPrice(priceMap, reportDate) {
  const target = new Date(reportDate)
  const dates = Object.keys(priceMap).sort()
  let closest = null
  let minDiff = Infinity

  for (const d of dates) {
    const diff = Math.abs(new Date(d) - target)
    // 日K精确匹配：只接受前后 3 天内
    if (diff < minDiff && diff < 3 * 86400000) {
      minDiff = diff
      closest = priceMap[d]
    }
  }

  return closest
}

/**
 * 判断报告期类型（按月份）
 */
function getReportType(dateStr) {
  const month = parseInt(dateStr.slice(5, 7))
  if (month === 3) return 'q1'
  if (month === 6) return 'h1'
  if (month === 9) return 'q3'
  if (month === 12) return 'fy'
  return null
}

/**
 * 计算第 i 期的滚动 4 季度 EPS 总和（TTM EPS）
 * 年报直接用；其他用 当期累计 + (去年年报 - 去年同期)
 */
function calcTTMEps(items, index, epsMap) {
  const item = items[index]
  if (item.eps == null) return null

  const type = getReportType(item.date)
  if (!type) return null
  if (type === 'fy') return item.eps

  const year = parseInt(item.date.slice(0, 4))
  const monthDay = item.date.slice(5, 10) // "03-31" / "06-30" / "09-30"
  const prevYear = year - 1

  // 查找上一年年报 EPS：优先精确匹配 12-31，回退到该年最后一个报告期
  let prevFyEps = epsMap[`${prevYear}-12-31`]
  if (prevFyEps == null) {
    const prevYearItems = items.filter(it => {
      const iy = parseInt(it.date.slice(0, 4))
      return iy === prevYear && it.eps != null
    })
    if (prevYearItems.length) {
      prevFyEps = prevYearItems[prevYearItems.length - 1].eps
    }
  }

  const prevSameEps = epsMap[`${prevYear}-${monthDay}`]
  if (prevFyEps == null || prevSameEps == null) return null

  const ttm = item.eps + (prevFyEps - prevSameEps)
  return ttm > 0 ? ttm : null
}

// ==================== 个股基本面数据 ====================

/**
 * 获取个股财务数据（东方财富 ZYZBAjaxNew）
 * 返回 { latest, history } — history 包含最近 12 季度
 */
async function getFundamentalData(code) {
  // ZYZBAjaxNew 使用 SH/SZ 前缀格式
  const prefix = code.startsWith('6') ? 'SH' : 'SZ'
  const emCode = prefix + code
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${emCode}`
  const data = await fetchJSON(url)

  const raw = data.data || []
  if (!raw.length) return { latest: null, history: [] }

  const parseItem = (d) => {
    const parseNum = (v) => (v != null && v !== '' && v !== '-' ? parseFloat(v) : null)
    return {
      date: d.REPORT_DATE?.slice(0, 10) || '',
      reportName: d.REPORT_DATE_NAME || '',
      // 盈利能力
      roe: parseNum(d.ROEJQ),
      grossMargin: parseNum(d.XSMLL),
      netMargin: parseNum(d.XSJLL),
      // 营收与利润（单位：元）
      revenue: parseNum(d.TOTALOPERATEREVE),
      netProfit: parseNum(d.PARENTNETPROFIT),
      revenueGrowth: parseNum(d.TOTALOPERATEREVETZ),
      profitGrowth: parseNum(d.PARENTNETPROFITTZ),
      // 负债
      debtRatio: parseNum(d.ZCFZL),
      // 每股指标
      eps: parseNum(d.EPSJB),
      bvps: parseNum(d.BPS),
      // 现金流（每股经营现金流，用于和每股收益比较）
      ocfPerShare: parseNum(d.MGJYXJJE),
    }
  }

  // 过滤掉空数据，显式按日期倒序排列，取最新24个季度（6年，用于分位统计）
  const items = raw
    .filter(d => d.REPORT_DATE)
    .sort((a, b) => new Date(b.REPORT_DATE) - new Date(a.REPORT_DATE))
    .slice(0, 24)
    .map(parseItem)

  // 补充计算: 净利率从利润和营收计算
  for (const item of items) {
    if (item.netMargin == null && item.revenue && item.netProfit && item.revenue !== 0) {
      item.netMargin = Math.round(item.netProfit / item.revenue * 10000) / 100
    }
  }

  // 补充计算: 经营现金流质量 = 每股经营现金流 / 每股收益
  for (const item of items) {
    if (item.ocfPerShare != null && item.eps != null && item.eps > 0) {
      item.ocfToProfitRatio = Math.round(item.ocfPerShare / item.eps * 100) / 100
    } else {
      item.ocfToProfitRatio = null
    }
  }

  // 从 datacenter API 补充当前 PE/PB/市值/行业
  let pe = null, pb = null, totalMarketCap = null, industry = ''
  try {
    const suffix = code.startsWith('6') ? 'SH' : 'SZ'
    const valUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_VALUEANALYSIS_DET&columns=SECUCODE,PE_TTM,PB_MRQ,TOTAL_MARKET_CAP,BOARD_NAME&source=WEB&client=WEB&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1&filter=(SECUCODE="${code}.${suffix}")`
    const valData = await fetchJSON(valUrl)
    const vd = valData.result?.data?.[0]
    if (vd) {
      pe = vd.PE_TTM ?? null
      pb = vd.PB_MRQ ?? null
      totalMarketCap = vd.TOTAL_MARKET_CAP ?? null
      industry = vd.BOARD_NAME || ''
    }
  } catch (e) {
    console.error('valuation fetch failed for', code, e.message)
  }

  // 将当前 PE/PB/市值写入最新一期
  if (items.length) {
    if (pe != null) items[0].pe = pe
    if (pb != null) items[0].pb = pb
    if (totalMarketCap != null) items[0].totalMarketCap = totalMarketCap
    items[0].industry = industry
  }

  // 计算历史每期真实 PE/PB：用日 K 线精确匹配报告期对应时点的收盘价
  if (items.length > 1) {
    try {
      // 取 3 年日 K 线（约 730 根），精确匹配报告期前后 3 天内的收盘价
      const dkUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${toSecid(code)}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f56&klt=101&fqt=1&end=20500101&lmt=730`
      const dkData = await fetchJSON(dkUrl)
      const dkLines = dkData.data?.klines || []

      // 构建日期→收盘价映射（日K精确匹配）
      const priceMap = {}
      for (const line of dkLines) {
        const p = line.split(',')
        const date = p[0]       // 日K日期
        const close = +p[2]     // 日收盘价
        priceMap[date] = close
      }

      // 构建日期→EPS映射（循环外一次构建）
      const epsMap = {}
      for (const it of items) {
        if (it.eps != null) epsMap[it.date] = it.eps
      }

      // 计算滚动 4 季 EPS 总和（TTM EPS）
      for (let i = 0; i < items.length; i++) {
        if (i === 0) continue  // 最新期已用实时 PE
        const reportDate = items[i].date  // e.g. "2025-06-30"

        // 从周K价格中找报告期前后最近的收盘价
        const historicalPrice = findClosestPrice(priceMap, reportDate)

        if (historicalPrice) {
          // 滚动4季度 EPS：取报告期及之前3个季度
          const ttmEps = calcTTMEps(items, i, epsMap)
          if (ttmEps > 0) {
            const rawPe = historicalPrice / ttmEps
            items[i].pe = rawPe > 9999 ? null : +rawPe.toFixed(2)
          }
        }

        if (historicalPrice && items[i].bvps && items[i].bvps > 0) {
          items[i].pb = +(historicalPrice / items[i].bvps).toFixed(2)
        }
      }
    } catch (e) {
      console.warn('weekly kline fetch failed for', code, e.message)
    }
  }

  return {
    latest: items[0] || null,
    history: items
  }
}

// ==================== 个股资金流向（量价派生） ====================

/**
 * 基于 K 线数据派生量价信号
 * 返回 { flows, available, volumeTrend, priceVolumeSignal }
 */
async function getCapitalFlowData(code) {
  const secid = toSecid(code)

  // 取近 30 日 K 线 — 先尝试东方财富，失败则 fallback 到新浪
  let klines = []
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=30`
    const data = await fetchJSON(url)
    klines = (data.data?.klines || []).map(line => {
      const p = line.split(',')
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6], changePercent: +p[8] }
    })
  } catch {
    // 东方财富接口不通，使用新浪财经 fallback
    try {
      const prefix = code.startsWith('6') ? 'sh' : 'sz'
      const sinaUrl = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${prefix}${code}&scale=240&ma=no&datalen=30`
      const raw = await fetchJSON(sinaUrl)
      if (Array.isArray(raw)) {
        klines = raw.map((r, i, arr) => {
          const prev = i > 0 ? +arr[i - 1].close : +r.open
          return { date: r.day, open: +r.open, close: +r.close, high: +r.high, low: +r.low, volume: +r.volume, amount: 0, changePercent: prev ? (+r.close - prev) / prev * 100 : 0 }
        })
      }
    } catch (e2) {
      console.error('capital-flow sina fallback error:', e2.message)
    }
  }

  if (klines.length < 10) {
    return { flows: [], available: false, _source: 'derived', volumeTrend: null, priceVolumeSignal: '数据不足', priceVolumeDir: 'neutral' }
  }

  // 近 20 日用于展示
  const flows = klines.slice(-20).map(k => ({
    date: k.date,
    close: k.close,
    volume: k.volume,
    amount: k.amount,
    changePercent: k.changePercent,
    isUp: k.changePercent > 0
  }))

  // 量价分析：近 5 日 vs 前 5 日
  const recent5 = klines.slice(-5)
  const prev5 = klines.slice(-10, -5)

  const recentAvgVol = recent5.reduce((s, k) => s + k.volume, 0) / 5
  const prevAvgVol = prev5.reduce((s, k) => s + k.volume, 0) / 5
  const recentAvgChg = recent5.reduce((s, k) => s + k.changePercent, 0) / 5

  const volumeChangeRate = prevAvgVol > 0 ? (recentAvgVol / prevAvgVol - 1) * 100 : 0

  // 20 日趋势方向：近 5 日收盘均价 vs 前 15 日收盘均价
  const recentAvgClose = recent5.reduce((s, k) => s + k.close, 0) / 5
  const prevKlines15 = klines.slice(-20, -5)
  const prevAvgClose = prevKlines15.length > 0 ? prevKlines15.reduce((s, k) => s + k.close, 0) / prevKlines15.length : recentAvgClose
  const trendUp = recentAvgClose > prevAvgClose

  let priceVolumeSignal = '量价平稳'
  let priceVolumeDir = 'neutral'
  if (volumeChangeRate > 30 && recentAvgChg > 0.5) { priceVolumeSignal = '放量上涨'; priceVolumeDir = 'bull' }
  else if (volumeChangeRate > 30 && recentAvgChg < -0.5) { priceVolumeSignal = '放量下跌'; priceVolumeDir = 'bear' }
  else if (volumeChangeRate < -20 && recentAvgChg < -0.5) {
    if (trendUp) { priceVolumeSignal = '缩量回调（洗盘）'; priceVolumeDir = 'bull' }
    else { priceVolumeSignal = '缩量下跌（弱势）'; priceVolumeDir = 'bear' }
  } else if (volumeChangeRate < -20 && recentAvgChg > 0) {
    if (trendUp) { priceVolumeSignal = '缩量整理（蓄势）'; priceVolumeDir = 'bull' }
    else { priceVolumeSignal = '缩量调整（弱势）'; priceVolumeDir = 'bear' }
  } else if (recentAvgChg > 0.5) { priceVolumeSignal = '温和上涨'; priceVolumeDir = 'bull' }
  else if (recentAvgChg < -0.5) { priceVolumeSignal = '温和下跌'; priceVolumeDir = 'bear' }

  return {
    flows,
    available: true,
    _source: 'derived',
    volumeTrend: {
      recentAvgVol: Math.round(recentAvgVol),
      prevAvgVol: Math.round(prevAvgVol),
      volumeChangeRate: Math.round(volumeChangeRate * 10) / 10
    },
    priceVolumeSignal,
    priceVolumeDir
  }
}

// ==================== 路由处理 ====================

function validateCode(ctx) {
  const code = ctx.query.code
  if (!code) { ctx.body = fail('code 参数必填'); return null }
  if (!/^\d{6}$/.test(code)) { ctx.body = fail('code 格式错误，需6位数字'); return null }
  return code
}

async function handleFundamental(ctx) {
  try {
    const code = validateCode(ctx)
    if (!code) return

    const cached = fundamentalCache.get(code)
    if (cached && Date.now() - cached.ts < FUNDAMENTAL_CACHE_TTL) {
      cacheTouch(fundamentalCache, code)
      ctx.body = ok(cached.data)
      return
    }

    const result = await getFundamentalData(code)
    cacheSet(fundamentalCache, code, { data: result, ts: Date.now() })
    ctx.body = ok(result)
  } catch (e) {
    console.error('fundamental error:', e.message)
    ctx.body = fail(e.message)
  }
}

async function handleCapitalFlow(ctx) {
  try {
    const code = validateCode(ctx)
    if (!code) return

    const cached = capitalCache.get(code)
    if (cached && Date.now() - cached.ts < CAPITAL_CACHE_TTL) {
      cacheTouch(capitalCache, code)
      ctx.body = ok(cached.data)
      return
    }

    const result = await getCapitalFlowData(code)
    cacheSet(capitalCache, code, { data: result, ts: Date.now() })
    ctx.body = ok(result)
  } catch (e) {
    console.error('capital-flow error:', e.message)
    ctx.body = fail(e.message)
  }
}

// ==================== 北向资金数据（优先日度，回退季度） ====================

async function getNorthboundData(code) {
  const suffix = code.startsWith('6') ? 'SH' : 'SZ'
  const secucode = `${code}.${suffix}`

  // 优先尝试日度持股数据
  try {
    const dailyUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_HOLDSTOCKNDATE_STA_NEW&columns=ALL&source=WEB&client=WEB&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=60&pageNumber=1&filter=(INTERVAL_TYPE="003")(SECUCODE="${secucode}")`
    const dailyData = await fetchJSON(dailyUrl)
    const dailyRaw = dailyData.result?.data || []
    if (dailyRaw.length >= 5) {
      const items = dailyRaw.map(d => ({
        date: d.TRADE_DATE?.slice(0, 10) || '',
        holdShares: d.HOLD_SHARES || 0,
        holdMarketCap: d.HOLD_MARKET_CAP || 0,
        freeSharesRatio: d.FREE_SHARES_RATIO || 0,
        totalSharesRatio: d.TOTAL_SHARES_RATIO || 0,
        changeRatio: d.HOLDSHARES_CHANGE_RATIO || 0,
        participantNum: d.PARTICIPANT_NUM || 0,
        closePrice: d.CLOSE_PRICE || 0,
      })).reverse()

      const latest = items[items.length - 1] || null
      const prev = items.length >= 2 ? items[items.length - 2] : null

      return { available: true, data: items, latest, prev, _frequency: 'daily' }
    }
  } catch (e) {
    console.warn('northbound daily fetch failed for', code, e.message)
  }

  // 回退到季度数据
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_HOLDSTOCKNDATE_STA_NEW&columns=ALL&source=WEB&client=WEB&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=50&pageNumber=1&filter=(INTERVAL_TYPE="001")(SECUCODE="${secucode}")`
  const data = await fetchJSON(url)

  const raw = data.result?.data || []
  if (!raw.length) return { data: [], available: false }

  const items = raw.map(d => ({
    date: d.TRADE_DATE?.slice(0, 10) || '',
    holdShares: d.HOLD_SHARES || 0,
    holdMarketCap: d.HOLD_MARKET_CAP || 0,
    freeSharesRatio: d.FREE_SHARES_RATIO || 0,
    totalSharesRatio: d.TOTAL_SHARES_RATIO || 0,
    changeRatio: d.HOLDSHARES_CHANGE_RATIO || 0,
    participantNum: d.PARTICIPANT_NUM || 0,
    closePrice: d.CLOSE_PRICE || 0,
  })).reverse()

  const latest = items[items.length - 1] || null
  const prev = items.length >= 2 ? items[items.length - 2] : null

  return { available: true, data: items, latest, prev, _frequency: 'quarterly' }
}

async function handleNorthbound(ctx) {
  try {
    const code = validateCode(ctx)
    if (!code) return

    const cached = northboundCache.get(code)
    if (cached && Date.now() - cached.ts < NORTHBOUND_CACHE_TTL) {
      cacheTouch(northboundCache, code)
      ctx.body = ok(cached.data)
      return
    }

    const result = await getNorthboundData(code)
    cacheSet(northboundCache, code, { data: result, ts: Date.now() })
    ctx.body = ok(result)
  } catch (e) {
    console.error('northbound error:', e.message)
    ctx.body = fail(e.message)
  }
}

// ==================== 融资融券数据 ====================

async function getMarginData(code) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_RZRQ_GGMX&columns=ALL&source=WEB&sortColumns=DATE&sortTypes=-1&pageNumber=1&pageSize=30&filter=(scode="${code}")`
  const data = await fetchJSON(url)

  let raw = data.result?.data || []
  if (!raw.length) return { data: [], available: false }

  // 融资融券数据通常在 20:00 后更新当日数据，20:00 前最新记录为上个交易日
  // 若当前时间在 20:00 前，且第一条记录日期为今天，则排除该未完成数据
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (now.getHours() < 20 && raw[0]?.DATE?.slice(0, 10) === todayStr) {
    raw = raw.slice(1)
  }

  if (!raw.length) return { data: [], available: false }

  const items = raw.map(d => ({
    date: d.DATE?.slice(0, 10) || '',
    rzBalance: d.RZYE || 0,
    rzBuyAmt: d.RZMRE || 0,
    rzRepayAmt: d.RZCHE || 0,
    rzNetBuy: d.RZJME || 0,
    rqBalance: d.RQYE || 0,
    rqVolume: d.RQYL || 0,
    rqSellVol: d.RQMCL || 0,
    rqNetVol: d.RQJMG || 0,
    totalBalance: d.RZRQYE || 0,
    close: d.SPJ || 0,
    changePct: d.ZDF || 0,
    balanceGrowth: 0,
  })).reverse()

  // 自行计算融资余额日环比增长率（API 字段 FIN_BALANCE_GR 可能不存在）
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1].rzBalance
    if (prev > 0) {
      items[i].balanceGrowth = Math.round((items[i].rzBalance - prev) / prev * 10000) / 100
    }
  }

  return {
    available: true,
    data: items,
    latest: items[items.length - 1] || null,
  }
}

async function handleMargin(ctx) {
  try {
    const code = validateCode(ctx)
    if (!code) return

    const cached = marginCache.get(code)
    if (cached && Date.now() - cached.ts < MARGIN_CACHE_TTL) {
      cacheTouch(marginCache, code)
      ctx.body = ok(cached.data)
      return
    }

    const result = await getMarginData(code)
    cacheSet(marginCache, code, { data: result, ts: Date.now() })
    ctx.body = ok(result)
  } catch (e) {
    console.error('margin error:', e.message)
    ctx.body = fail(e.message)
  }
}

// ==================== 主力资金流向（东方财富日度数据） ====================

/**
 * 获取个股主力资金流向数据（日度）
 * 字段映射：f51=日期, f52=主力净流入, f53=小单净流入, f54=中单净流入,
 *           f55=大单净流入, f56=超大单净流入, f57=主力净占比, f58=小单净占比,
 *           f59=中单净占比, f60=大单净占比, f61=超大单净占比, f62=收盘价, f63=涨跌幅
 */
async function getMainForceFlowData(code) {
  const secid = toSecid(code)
  const fields1 = 'f1,f2,f3,f7'
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65'

  // push2his.eastmoney.com 在部分网络环境不可达，优先使用 emdatah5 代理接口
  const emdataUrl = `https://emdatah5.eastmoney.com/dc/ZJLX/getDBHistoryData?secid=${secid}&fields1=${fields1}&fields2=${fields2}&klt=101&lmt=60`
  const pushUrl = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=60&klt=101&secid=${secid}&fields1=${fields1}&fields2=${fields2}&ut=b2884a393a59ad64002292a3e90d46a5`

  let data
  try {
    data = await fetchJSON(emdataUrl, 10000)
  } catch {
    try { data = await fetchJSON(pushUrl, 10000) } catch { data = null }
  }

  if (!data) return { data: [], available: false }

  const klines = data.data?.klines || []
  if (!klines.length) return { data: [], available: false }

  const items = klines.map(line => {
    const p = line.split(',')
    return {
      date: p[0],
      mainNetInflow: +p[1],       // 主力净流入（元）
      smallNetInflow: +p[2],      // 小单净流入
      mediumNetInflow: +p[3],     // 中单净流入
      largeNetInflow: +p[4],      // 大单净流入
      superLargeNetInflow: +p[5], // 超大单净流入
      mainNetPct: +p[6],          // 主力净占比%
      smallNetPct: +p[7],         // 小单净占比%
      mediumNetPct: +p[8],        // 中单净占比%
      largeNetPct: +p[9],         // 大单净占比%
      superLargeNetPct: +p[10],   // 超大单净占比%
      close: +p[11],              // 收盘价
      changePct: +p[12],          // 涨跌幅%
    }
  })

  const latest = items[items.length - 1] || null

  // 近5日主力净流入汇总
  const recent5 = items.slice(-5)
  const mainNetSum5 = recent5.reduce((s, d) => s + d.mainNetInflow, 0)
  const mainNetAvgPct5 = recent5.reduce((s, d) => s + d.mainNetPct, 0) / recent5.length

  return {
    available: true,
    data: items,
    latest,
    summary: {
      mainNetSum5,
      mainNetAvgPct5: Math.round(mainNetAvgPct5 * 100) / 100,
    }
  }
}

// ==================== 主力资金日内分时（东方财富分钟级数据） ====================

async function getMainForceIntradayData(code) {
  const secid = toSecid(code)
  const fields1 = 'f1,f2,f3,f7'
  const fields2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65'
  const pushUrl = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=${secid}&fields1=${fields1}&fields2=${fields2}&ut=b2884a393a59ad64002292a3e90d46a5&_=${Date.now()}`
  const emdataUrl = `https://emdatah5.eastmoney.com/dc/ZJLX/getDBHistoryData?secid=${secid}&fields1=${fields1}&fields2=${fields2}&klt=1&lmt=0&_=${Date.now()}`

  let data
  try {
    data = await fetchJSON(pushUrl, 12000)
  } catch {
    try { data = await fetchJSON(emdataUrl, 12000) } catch { data = null }
  }

  if (!data) return null

  try {
    const klines = data.data?.klines || []
    if (!klines.length) return null

    const items = klines.map(line => {
      const p = line.split(',')
      return {
        time: p[0],
        mainNetInflow: +p[1],
        smallNetInflow: +p[2],
        mediumNetInflow: +p[3],
        largeNetInflow: +p[4],
        superLargeNetInflow: +p[5],
      }
    })

    // 校验：必须是分钟级数据（time 含空格，如 "2026-05-25 09:31"）且为当日
    const lastTime = items[items.length - 1].time
    const todayStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
    if (!lastTime.includes(' ') || !lastTime.startsWith(todayStr)) {
      return null
    }

    // 分钟数据本身就是累计值，最后一条即今日合计
    const last = items[items.length - 1]
    const aggregated = {
      mainNetInflow: last.mainNetInflow,
      smallNetInflow: last.smallNetInflow,
      mediumNetInflow: last.mediumNetInflow,
      largeNetInflow: last.largeNetInflow,
      superLargeNetInflow: last.superLargeNetInflow,
    }

    return { items, aggregated }
  } catch (e) {
    console.error('intraday-mf error:', e.message)
    return null
  }
}

async function handleMainForceFlow(ctx) {
  try {
    const code = validateCode(ctx)
    if (!code) return

    // 日度数据缓存
    let result
    const dailyCached = mainForceCache.get(code)
    if (dailyCached && Date.now() - dailyCached.ts < MAIN_FORCE_CACHE_TTL) {
      cacheTouch(mainForceCache, code)
      result = { ...dailyCached.data }
    } else {
      result = await getMainForceFlowData(code)
      cacheSet(mainForceCache, code, { data: result, ts: Date.now() })
    }

    // 日内分时数据（独立缓存，失败不影响日度缓存）
    let intraday = null
    const intraCached = intradayMfCache.get(code)
    if (intraCached && Date.now() - intraCached.ts < (intraCached.ttl || INTRADAY_MF_CACHE_TTL)) {
      intraday = intraCached.data
    } else {
      intraday = await getMainForceIntradayData(code)
      if (!intraday) {
        // 重试一次
        intraday = await getMainForceIntradayData(code)
      }
      if (intraday) {
        // 稀疏数据（<5条）用短TTL，避免开盘初期过早缓存
        const ttl = intraday.items.length < 5 ? 30 * 1000 : INTRADAY_MF_CACHE_TTL
        cacheSet(intradayMfCache, code, { data: intraday, ts: Date.now(), ttl })
      }
    }

    if (intraday && result.latest) {
      result.intraday = intraday
      const agg = intraday.aggregated
      const dailyData = result.data || []
      const todayStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

      // 用近3日 pct/amount 平均比率估算今日 pct
      const recent3 = dailyData.slice(-3).filter(d => d.mainNetInflow !== 0 && d.mainNetPct != null)
      let estimatedPct = result.latest.mainNetPct
      if (recent3.length) {
        const avgRatio = recent3.reduce((s, d) => s + (d.mainNetPct / d.mainNetInflow), 0) / recent3.length
        if (Number.isFinite(avgRatio)) {
          estimatedPct = Math.round(agg.mainNetInflow * avgRatio * 100) / 100
        }
      }

      // 更新 latest：日内金额 + 估算 pct，日期也更新为今日
      result.latest = { ...result.latest, ...agg, mainNetPct: estimatedPct, date: todayStr }

      // 更新 summary 含今日：最近4天 + 今日 = 新5日
      const last4 = dailyData.slice(-4)
      const last4Pcts = last4.map(d => d.mainNetPct).filter(p => p != null)
      if (last4Pcts.length === 4) {
        const all5Pcts = [...last4Pcts, estimatedPct]
        result.summary = {
          ...result.summary,
          mainNetAvgPct5: Math.round(all5Pcts.reduce((a, b) => a + b, 0) / 5 * 100) / 100,
          mainNetSum5: last4.reduce((s, d) => s + d.mainNetInflow, 0) + agg.mainNetInflow,
        }
      }

      // 追加/更新今日到 data 数组（日度 API 可能已含当日，需去重）
      const todayEntry = {
        date: todayStr,
        mainNetInflow: agg.mainNetInflow,
        mainNetPct: estimatedPct,
        smallNetInflow: agg.smallNetInflow,
        mediumNetInflow: agg.mediumNetInflow,
        largeNetInflow: agg.largeNetInflow,
        superLargeNetInflow: agg.superLargeNetInflow,
      }
      const lastDaily = dailyData[dailyData.length - 1]
      if (lastDaily && lastDaily.date === todayStr) {
        result.data = [...dailyData.slice(0, -1), todayEntry]
      } else {
        result.data = [...dailyData, todayEntry]
      }
    }

    ctx.body = ok(result)
  } catch (e) {
    console.error('main-force-flow error:', e.message)
    ctx.body = fail(e.message)
  }
}

// ==================== 股东户数数据（季度快照） ====================

async function getShareholderData(code) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_HOLDERNUM_DET&columns=END_DATE,TOTAL_A_SHARES,AVG_HOLD_NUM,TOTAL_MARKET_CAP,AVG_MARKET_CAP,HOLDER_NUM&source=WEB&client=WEB&sortColumns=END_DATE&sortTypes=-1&pageSize=50&filter=(SECURITY_CODE="${code}")`
  const data = await fetchJSON(url)

  const raw = data.result?.data || []
  if (!raw.length) return { data: [], available: false }

  const items = raw.map((d, i, arr) => {
    const holderNum = d.HOLDER_NUM || 0
    const prevNum = i < arr.length - 1 ? (arr[i + 1].HOLDER_NUM || 0) : 0
    const changeRatio = prevNum > 0 ? Math.round((holderNum - prevNum) / prevNum * 10000) / 100 : 0
    return {
      date: d.END_DATE?.slice(0, 10) || '',
      holderCount: holderNum,
      changeRatio,
      avgHoldNum: d.AVG_HOLD_NUM || 0,
      totalAShares: d.TOTAL_A_SHARES || 0,
    }
  })

  const latest = items[0] || null
  const prev = items.length >= 2 ? items[1] : null

  return {
    available: true,
    data: items,
    latest,
    prev,
  }
}

async function handleShareholder(ctx) {
  try {
    const code = validateCode(ctx)
    if (!code) return

    const cached = shareholderCache.get(code)
    if (cached && Date.now() - cached.ts < SHAREHOLDER_CACHE_TTL) {
      cacheTouch(shareholderCache, code)
      ctx.body = ok(cached.data)
      return
    }

    const result = await getShareholderData(code)
    cacheSet(shareholderCache, code, { data: result, ts: Date.now() })
    ctx.body = ok(result)
  } catch (e) {
    console.error('shareholder error:', e.message)
    ctx.body = fail(e.message)
  }
}

// ==================== 基准指数 K 线（用于 Beta 计算） ====================
const benchmarkCache = new Map()
const BENCHMARK_CACHE_TTL = 30 * 60 * 1000

async function handleBenchmarkKline(ctx) {
  const lmt = parseInt(ctx.query.lmt) || 250
  const cacheKey = `hs300_${lmt}`
  const cached = benchmarkCache.get(cacheKey)
  if (cached) { ctx.body = ok(cached); return }

  try {
    const secid = '1.000300' // 沪深 300
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${lmt}`
    const data = await fetchJSON(url)
    const rawKlines = data.data?.klines || []
    const klines = rawKlines.map(s => {
      const p = s.split(',')
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6] }
    })
    const result = { klines, source: 'hs300' }
    benchmarkCache.set(cacheKey, result)
    ctx.body = ok(result)
  } catch (e) {
    ctx.body = fail('基准K线获取失败: ' + e.message)
  }
}

// ==================== 路由注册 ====================
export function registerStockAnalysisRoutes(router) {
  router.get('/api/stock-analysis/fundamental', handleFundamental)
  router.get('/api/stock-analysis/capital-flow', handleCapitalFlow)
  router.get('/api/stock-analysis/northbound', handleNorthbound)
  router.get('/api/stock-analysis/margin', handleMargin)
  router.get('/api/stock-analysis/main-force-flow', handleMainForceFlow)
  router.get('/api/stock-analysis/shareholder', handleShareholder)
  router.get('/api/stock-analysis/benchmark-kline', handleBenchmarkKline)
}
