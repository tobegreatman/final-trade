// server/fallback.js — 备用数据源适配层 (腾讯/新浪)
// 东方财富 API 失败时自动切换到腾讯/新浪数据源，返回格式与东方财富完全一致

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// === 工具函数 ===

async function fetchGBK(url, headers = {}, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: ctrl.signal
  })
  clearTimeout(timer)
  const buf = await res.arrayBuffer()
  return new TextDecoder('gbk').decode(buf)
}

async function fetchJSON(url, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: ctrl.signal
  })
  clearTimeout(timer)
  const text = await res.text()
  return JSON.parse(text.replace(/^[a-zA-Z_]*=/, ''))
}

// 代码转换: 600519 → sh600519, 000001 → sz000001
function toTc(code) {
  return code.startsWith('6') ? `sh${code}` : `sz${code}`
}

// 解析 qt.gtimg.cn 响应: v_sh000001="...";v_sz399001="...";
function parseQt(text) {
  const map = {}
  for (const line of text.split(';')) {
    const m = line.match(/v_(\w+)="(.*)"/)
    if (m) map[m[1]] = m[2].split('~')
  }
  return map
}

// qt 行情字段 → quote 对象 (兼容指数和个股)
function qtToQuote(f) {
  if (!f || f.length < 40) return null
  const price = +f[3], preClose = +f[4]
  return {
    code: f[2],
    name: f[1],
    close: price,
    change: preClose ? +((price - preClose) / preClose * 100).toFixed(2) : 0,
    changeAmt: +((price - preClose)).toFixed(2),
    high: +f[32] || 0,
    low: +f[33] || 0,
    open: +f[5] || 0,
    volume: +f[6] || 0,
    amount: +f[37] || 0
  }
}

function calcMA(closes, n) {
  if (closes.length < n) return null
  return +(closes.slice(-n).reduce((a, b) => a + b, 0) / n).toFixed(2)
}

// 当前交易日期 YYYY-MM-DD
function todayDate() {
  const now = new Date()
  if (now.getHours() < 9) now.setDate(now.getDate() - 1)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// 时间格式化: "0930" → "09:30"
function fmtMinute(t) {
  if (!t) return ''
  if (t.includes(':')) return t
  if (t.length === 4 && /^\d{4}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2)}`
  return t
}

// 解析分钟数据点 (兼容数组和字符串格式)
// 字符串: "0930 16.58 323 535534.00" → time, price, volume(手), amount(元)
// 数组: ["0930", 16.58, 16.55, 323] → time, price, avg, volume
// 自动补全日期前缀
function parseMinutePoints(points, withDate = false) {
  const datePrefix = withDate ? todayDate() + ' ' : ''
  return points.map(p => {
    if (typeof p === 'string') {
      const parts = p.trim().split(/\s+/)
      if (parts.length < 2) return null
      const t = fmtMinute(parts[0])
      return { time: datePrefix + t, close: +parts[1] || 0, avg: +parts[1] || 0, volume: +parts[2] || 0 }
    }
    if (Array.isArray(p)) {
      const t = fmtMinute(String(p[0]))
      return { time: datePrefix + t, close: +p[1] || 0, avg: +p[2] || +p[1] || 0, volume: +p[3] || 0 }
    }
    return null
  }).filter(Boolean)
}

// 从腾讯分钟 API 响应中提取数据点 (兼容指数和个股路径)
function extractMinuteData(json, tc) {
  return json.data?.data || json.data?.[tc]?.data?.data || []
}

// === Fallback 函数 ===

// 三大指数: 实时行情 + 120 日 K 线 + MA
export async function fetchIndicesFallback() {
  const indexMap = { sh: 'sh000001', sz: 'sz399001', cyb: 'sz399006' }

  // 1. 实时行情
  const qtText = await fetchGBK(`https://qt.gtimg.cn/q=${Object.values(indexMap).join(',')}`)
  const qtMap = parseQt(qtText)

  // 2. K 线 (串行)
  const indices = {}
  for (const [key, tc] of Object.entries(indexMap)) {
    indices[key] = { quote: null, klines: [], ma: {} }
    try {
      const kd = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,120,`)
      const raw = kd.data?.[tc]?.day || kd.data?.[tc]?.qfqday || []
      indices[key].klines = raw.map(k => ({
        date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4],
        volume: +k[5], amount: +(k[6] || 0)
      }))
      const closes = indices[key].klines.map(k => k.close)
      indices[key].ma = { ma20: calcMA(closes, 20), ma60: calcMA(closes, 60), ma120: calcMA(closes, 120) }
      if (closes.length >= 63) {
        indices[key].ma60Trend = Array.from({ length: 4 }, (_, i) => {
          const s = closes.length - 60 - (3 - i)
          return +(closes.slice(s, s + 60).reduce((a, b) => a + b, 0) / 60).toFixed(2)
        })
      }
    } catch (e) { /* kline 失败不阻塞 */ }
    indices[key].quote = qtToQuote(qtMap[tc])
  }
  return indices
}

// 三大指数分时
export async function fetchIndicesIntradayFallback() {
  const entries = [
    ['sh', 'sh000001', '上证指数'],
    ['sz', 'sz399001', '深证成指'],
    ['cyb', 'sz399006', '创业板指']
  ]
  const result = {}
  for (const [key, tc, name] of entries) {
    result[key] = { name, code: '', preClose: 0, trends: [] }
    try {
      const json = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code=${tc}`)
      const points = extractMinuteData(json, tc)
      if (points.length > 10) {
        result[key].trends = parseMinutePoints(points, true)
        result[key].code = tc.slice(2)
        // 从 qt 获取 preClose
        try {
          const qt = parseQt(await fetchGBK(`https://qt.gtimg.cn/q=${tc}`))
          result[key].preClose = qt[tc] ? +qt[tc][4] : 0
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* 分时获取失败 */ }
  }
  return result
}

// 涨跌家数 — 腾讯无直接替代 API，抛错让调用方使用缓存
export async function fetchBreadthFallback() {
  throw new Error('No breadth fallback')
}

// 个股 120 日 K 线
export async function fetchStockKlineFallback(code) {
  const tc = toTc(code)
  const data = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,120,qfq`)
  const raw = data.data?.[tc]?.qfqday || data.data?.[tc]?.day || []
  const klines = raw.map(k => ({
    date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4],
    volume: +k[5], amount: +(k[6] || 0), turnover: +(k[7] || 0)
  }))
  const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : null
  return { klines, prevClose, code, name: '' }
}

// 个股 5 年 K 线
export async function fetchStockKline5yFallback(code) {
  const tc = toTc(code)
  const data = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,1200,qfq`)
  const raw = data.data?.[tc]?.qfqday || data.data?.[tc]?.day || []
  const klines = raw.map(k => ({
    date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4],
    volume: +k[5], amount: +(k[6] || 0), turnover: +(k[7] || 0)
  }))
  return { klines, code, name: '' }
}

// 个股分时
export async function fetchStockIntradayFallback(code) {
  const tc = toTc(code)
  try {
    const json = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code=${tc}`)
    const points = extractMinuteData(json, tc)
    if (points.length > 10) {
      let preClose = 0, name = ''
      try {
        const qt = parseQt(await fetchGBK(`https://qt.gtimg.cn/q=${tc}`))
        if (qt[tc]) { preClose = +qt[tc][4] || 0; name = qt[tc][1] || '' }
      } catch (e) { /* ignore */ }
      return { code, name, preClose, trends: parseMinutePoints(points, true) }
    }
  } catch (e) { /* minute 失败 */ }
  return { code, name: '', preClose: 0, trends: [] }
}

// 个股 5 日分时
export async function fetchStockIntraday5dFallback(code) {
  const tc = toTc(code)

  // 获取当天真实分时
  let todayTrends = []
  try {
    const json = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=min_data&code=${tc}`)
    const points = extractMinuteData(json, tc)
    if (points.length > 10) {
      todayTrends = parseMinutePoints(points, true)
    }
  } catch (e) { /* ignore */ }

  // 获取日 K 线算 preClose
  let preClose = 0
  try {
    const dkData = await fetchJSON(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,7,qfq`)
    const dk = dkData.data?.[tc]?.qfqday || dkData.data?.[tc]?.day || []
    if (dk.length >= 2) preClose = +dk[dk.length - 2][2] || 0
  } catch (e) { /* ignore */ }

  return { code, preClose, trends: todayTrends }
}

// 个股基本面
export async function fetchStockBasicFallback(code) {
  const tc = toTc(code)
  const qt = parseQt(await fetchGBK(`https://qt.gtimg.cn/q=${tc}`))
  const f = qt[tc]
  if (!f || f.length < 47) throw new Error('No basic data')

  return {
    code,
    name: f[1] || '',
    pe: +f[44] || null,
    pb: null,
    totalMarketCap: +f[46] || null,
    circulationMarketCap: +f[45] || null,
    circulationShares: null,
    roe: null,
    grossMargin: null,
    netMargin: null,
    revenueGrowth: null,
    profitGrowth: null,
    debtRatio: null,
    high52w: null,
    low52w: null
  }
}

// 批量行情
export async function fetchBatchQuotesFallback(codes) {
  const tcCodes = codes.map(toTc)
  const qt = parseQt(await fetchGBK(`https://qt.gtimg.cn/q=${tcCodes.join(',')}`))
  const result = {}
  for (const tc of tcCodes) {
    const f = qt[tc]
    if (f && f.length > 40) {
      const code = tc.slice(2)
      const price = +f[3], preClose = +f[4]
      result[code] = {
        name: f[1],
        close: price,
        change: preClose ? +((price - preClose) / preClose * 100).toFixed(2) : 0,
        changeAmt: +((price - preClose)).toFixed(2),
        high: +f[32] || 0,
        low: +f[33] || 0,
        open: +f[5] || 0,
        volume: +f[6] || 0,
        amount: +f[37] || 0,
        turnover: +f[38] || 0
      }
    }
  }
  return result
}

// 股票搜索 (腾讯 smartbox)
// 响应格式: v_hint="market~code~名称~pinyin~type^market~code~..."
// 条目 ^ 分隔, 字段 ~ 分隔, 中文用 \uXXXX 转义
export async function searchStockFallback(kw) {
  const text = await fetchGBK(`https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(kw)}&t=all`)
  const match = text.match(/v_hint="(.*)"/)
  if (!match || !match[1]) return []

  const decode = s => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)))

  return match[1].split('^')
    .filter(e => e.includes('~'))
    .map(entry => {
      const parts = entry.split('~')
      return { code: parts[1] || '', name: decode(parts[2] || ''), type: 'A股' }
    })
    .filter(item => item.code && item.name && /^[036]\d{5}$/.test(item.code))
    .slice(0, 6)
}
