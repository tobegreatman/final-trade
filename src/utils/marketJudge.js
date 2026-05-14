import { MARKET_STATUS } from './constants.js'

/**
 * 六维大盘判定算法 v4
 * 维度 1: MACD 状态（动量方向）
 * 维度 2: 涨跌家数（市场广度）
 * 维度 3: RSI 状态（超买超卖）
 * 维度 4: 融资余额（杠杆资金趋势）
 * 维度 5: 量价配合（资金确认）
 * 维度 6: 北向资金（外资动向）
 */

// ==================== 共享格式化 ====================
function fmtAmt(v) {
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
  if (v >= 1e8) return (v / 1e8).toFixed(0) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return v.toFixed(0)
}

function fmtAmtWan(v) {
  // v 的单位是万元
  if (v >= 10000) return (v / 10000).toFixed(0) + '亿'
  return v.toFixed(0) + '万'
}

// ==================== 主判定函数 ====================
export function judgeMarket(indices, breadth, northbound, margin) {
  const idx = indices.sh || {}
  const klines = idx.klines || []
  const ma = idx.ma || {}
  const quote = idx.quote || {}

  const signals = []
  let bullCount = 0
  let bearCount = 0

  const addSignal = (sig) => {
    signals.push(sig)
    if (sig.bull) bullCount++
    if (sig.bear) bearCount++
  }

  addSignal(judgeMACD(klines))
  addSignal(judgeBreadth(breadth))
  addSignal(judgeRSI(klines))
  addSignal(judgeMarginBalance(margin))
  addSignal(judgeVolumePrice(klines))
  addSignal(judgeNorthbound(northbound))

  const status = determineStatus(bullCount, bearCount)
  const confirmed = bullCount >= 3 || bearCount >= 3
  const longWindow = checkLongWindow(quote, ma, klines, breadth)

  return {
    status,
    ...MARKET_STATUS[status],
    signals,
    score: { bull: bullCount, bear: bearCount, neutral: 6 - bullCount - bearCount },
    confirmed,
    longWindow
  }
}

// ==================== MACD ====================
function calcEMA(arr, period) {
  if (arr.length < period) return null
  const k = 2 / (period + 1)
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k)
  }
  return ema
}

function calcMACD(klines) {
  const closes = klines.map(k => k.close)
  if (closes.length < 35) return null
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10
  let ema12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12
  let ema26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26
  for (let i = 12; i < 26; i++) ema12 = closes[i] * k12 + ema12 * (1 - k12)
  const difs = []
  for (let i = 26; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12)
    ema26 = closes[i] * k26 + ema26 * (1 - k26)
    difs.push(ema12 - ema26)
  }
  if (difs.length < 9) return null
  let dea = difs.slice(0, 9).reduce((a, b) => a + b, 0) / 9
  const deas = [dea]
  for (let i = 9; i < difs.length; i++) {
    dea = difs[i] * k9 + dea * (1 - k9)
    deas.push(dea)
  }
  const last = difs.length - 1
  const prev = last - 1
  const dif = difs[last]
  const prevDif = difs[prev] || dif
  const deaVal = deas[deas.length - 1]
  const prevDea = deas[deas.length - 2] || deaVal
  const hist = 2 * (dif - deaVal)
  const prevHist = 2 * (prevDif - prevDea)
  return { dif, dea: deaVal, hist, prevHist, difAboveZero: dif > 0, goldenCross: dif > deaVal }
}

function judgeMACD(klines) {
  const macd = calcMACD(klines)
  if (!macd) return { dimension: 'MACD', value: '数据不足', bull: false, bear: false, desc: '' }
  const { dif, dea, hist, prevHist, difAboveZero, goldenCross } = macd

  if (goldenCross && difAboveZero && hist > 0 && hist > prevHist) {
    return { dimension: 'MACD', value: '多头强势', bull: true, bear: false, desc: `DIF=${dif.toFixed(0)}>DEA=${dea.toFixed(0)}，零轴上方，柱状图放大` }
  }
  if (goldenCross && hist > 0) {
    return { dimension: 'MACD', value: '金叉确认', bull: true, bear: false, desc: `DIF=${dif.toFixed(0)}上穿DEA=${dea.toFixed(0)}，柱状图转正` }
  }
  if (!goldenCross && !difAboveZero && hist < 0 && hist < prevHist) {
    return { dimension: 'MACD', value: '空头强势', bull: false, bear: true, desc: `DIF=${dif.toFixed(0)}<DEA=${dea.toFixed(0)}，零轴下方，柱状图放大` }
  }
  if (!goldenCross && hist < 0) {
    return { dimension: 'MACD', value: '死叉确认', bull: false, bear: true, desc: `DIF=${dif.toFixed(0)}下穿DEA=${dea.toFixed(0)}，柱状图转负` }
  }
  return { dimension: 'MACD', value: '方向不明', bull: false, bear: false, desc: `DIF=${dif.toFixed(0)} DEA=${dea.toFixed(0)} 柱=${hist.toFixed(0)}` }
}

// ==================== RSI ====================
function calcRSI(klines, period = 14) {
  const closes = klines.map(k => k.close)
  if (closes.length < period + 1) return null
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const chg = closes[i] - closes[i - 1]
    if (chg > 0) avgGain += chg; else avgLoss -= chg
  }
  avgGain /= period
  avgLoss /= period
  const rsis = []
  for (let i = period + 1; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (chg > 0 ? chg : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (chg < 0 ? -chg : 0)) / period
    rsis.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return rsis
}

function judgeRSI(klines) {
  const rsis = calcRSI(klines)
  if (!rsis || rsis.length < 5) return { dimension: 'RSI', value: '数据不足', bull: false, bear: false, desc: '' }

  const current = rsis[rsis.length - 1]
  const prev = rsis[rsis.length - 2]
  const rsi5 = rsis.slice(-5)
  const trendingUp = rsi5[rsi5.length - 1] > rsi5[0]

  if (current > 60 && trendingUp) {
    return { dimension: 'RSI', value: `强势 ${current.toFixed(0)}`, bull: true, bear: false, desc: `RSI(14)=${current.toFixed(1)}，持续上行，多头动量充足` }
  }
  const hadOversold = rsi5.some(r => r < 30)
  if (hadOversold && current > 40 && current > prev) {
    return { dimension: 'RSI', value: `超卖回升 ${current.toFixed(0)}`, bull: true, bear: false, desc: `RSI从超卖区回升至${current.toFixed(1)}，反弹信号` }
  }
  if (current < 40 && !trendingUp) {
    return { dimension: 'RSI', value: `弱势 ${current.toFixed(0)}`, bull: false, bear: true, desc: `RSI(14)=${current.toFixed(1)}，持续下行，空头动量主导` }
  }
  const hadOverbought = rsi5.some(r => r > 70)
  if (hadOverbought && current < 60 && current < prev) {
    return { dimension: 'RSI', value: `超买回落 ${current.toFixed(0)}`, bull: false, bear: true, desc: `RSI从超买区回落至${current.toFixed(1)}，调整信号` }
  }
  return { dimension: 'RSI', value: `${current.toFixed(0)}`, bull: false, bear: false, desc: `RSI(14)=${current.toFixed(1)}，中性区间` }
}

// ==================== 量价配合 ====================
function judgeVolumePrice(klines) {
  if (klines.length < 10) return { dimension: '量价配合', value: '数据不足', bull: false, bear: false, desc: '' }

  const last = klines[klines.length - 1]
  const prev = klines[klines.length - 2]
  const priceUp = last.close > prev.close
  const priceDown = last.close < prev.close

  const vol5 = klines.slice(-5).reduce((a, k) => a + k.volume, 0) / 5
  const volUp = last.volume > vol5 * 1.2
  const volDown = last.volume < vol5 * 0.7

  let divergence = false
  if (klines.length >= 5) {
    const recent = klines.slice(-5)
    const pricesUp = recent[4].close > recent[0].close
    const earlyVol = recent.slice(0, 2).reduce((a, k) => a + k.volume, 0) / 2
    const lateVol = recent.slice(3).reduce((a, k) => a + k.volume, 0) / 2
    if (pricesUp && lateVol < earlyVol * 0.7) divergence = 'top'
    if (!pricesUp && lateVol > earlyVol * 1.3) divergence = 'bottom'
  }

  if (priceUp && volUp) {
    return { dimension: '量价配合', value: '价涨量增', bull: true, bear: false, desc: `量价齐升，成交${fmtAmt(last.volume)}较均量放大` }
  }
  if (divergence === 'bottom') {
    return { dimension: '量价配合', value: '底部放量', bull: true, bear: false, desc: '价格下跌但量能放大，资金逢低介入' }
  }
  if (divergence === 'top') {
    return { dimension: '量价配合', value: '顶背离', bull: false, bear: true, desc: '价格上涨但量能萎缩，量价背离需警惕' }
  }
  if (priceUp && volDown) {
    return { dimension: '量价配合', value: '缩量上涨', bull: false, bear: true, desc: '价格上涨但量能不足，上涨持续性存疑' }
  }
  if (priceDown && volUp) {
    return { dimension: '量价配合', value: '放量下跌', bull: false, bear: true, desc: `价跌量增，成交${fmtAmt(last.volume)}较均量放大，抛压较重` }
  }
  return { dimension: '量价配合', value: '量价正常', bull: false, bear: false, desc: '量价关系无明显异常' }
}

// ==================== 涨跌家数 ====================
function judgeBreadth(breadth) {
  if (!breadth || (!breadth.up && !breadth.down)) {
    return { dimension: '涨跌家数', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const { up, down } = breadth
  const ratio = down > 0 ? up / down : up
  if (ratio > 2) {
    return { dimension: '涨跌家数', value: `${up}/${down} (${ratio.toFixed(1)})`, bull: true, bear: false, desc: `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}` }
  }
  if (ratio < 0.5) {
    return { dimension: '涨跌家数', value: `${up}/${down} (${ratio.toFixed(1)})`, bull: false, bear: true, desc: `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}` }
  }
  return { dimension: '涨跌家数', value: `${up}/${down} (${ratio.toFixed(1)})`, bull: false, bear: false, desc: `涨跌比${ratio.toFixed(1)}，无明显偏向` }
}

// ==================== 融资余额 ====================
function judgeMarginBalance(margin) {
  if (!margin || margin.length < 5) {
    return { dimension: '融资余额', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const latest = margin[0].rzBalance
  const day5 = margin[Math.min(4, margin.length - 1)].rzBalance
  const change5d = latest - day5
  const changePct = day5 > 0 ? (change5d / day5 * 100) : 0
  if (change5d > 0 && changePct > 0.5) {
    return { dimension: '融资余额', value: `持续流入 ${fmtAmt(latest)}`, bull: true, bear: false, desc: `5日净增${fmtAmt(Math.abs(change5d))}，增幅${changePct.toFixed(2)}%` }
  }
  if (change5d < 0 && changePct < -0.5) {
    return { dimension: '融资余额', value: `持续流出 ${fmtAmt(latest)}`, bull: false, bear: true, desc: `5日净减${fmtAmt(Math.abs(change5d))}，降幅${Math.abs(changePct).toFixed(2)}%` }
  }
  return { dimension: '融资余额', value: `${fmtAmt(latest)}`, bull: false, bear: false, desc: `5日变动${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%，无明显趋势` }
}

// ==================== 北向资金 ====================
function judgeNorthbound(northbound) {
  if (!northbound || northbound.length < 5) {
    return { dimension: '北向资金', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const amt5 = northbound.slice(0, 5).reduce((a, d) => a + (d.nfAmt || 0), 0) / 5
  const amt20 = northbound.slice(0, Math.min(20, northbound.length)).reduce((a, d) => a + (d.nfAmt || 0), 0) / Math.min(20, northbound.length)
  const ratio = amt20 > 0 ? amt5 / amt20 : 1
  const changePct = (ratio - 1) * 100
  const latest = northbound[0]?.nfAmt || 0

  if (ratio > 1.1) {
    return { dimension: '北向资金', value: `活跃 ${fmtAmtWan(latest)}`, bull: true, bear: false, desc: `近5日均量${fmtAmtWan(amt5)}，高于20日均量${fmtAmtWan(amt20)}，增幅${changePct.toFixed(1)}%` }
  }
  if (ratio < 0.9) {
    return { dimension: '北向资金', value: `退缩 ${fmtAmtWan(latest)}`, bull: false, bear: true, desc: `近5日均量${fmtAmtWan(amt5)}，低于20日均量${fmtAmtWan(amt20)}，降幅${Math.abs(changePct).toFixed(1)}%` }
  }
  return { dimension: '北向资金', value: `${fmtAmtWan(latest)}`, bull: false, bear: false, desc: `近5日均量${fmtAmtWan(amt5)}，20日均量${fmtAmtWan(amt20)}，偏差${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%` }
}

// ==================== 综合判定 ====================
function determineStatus(bull, bear) {
  if (bull >= 4) return 'bull'
  if (bull >= 3) return 'bull-lean'
  if (bear >= 4) return 'bear'
  if (bear >= 3) return 'bear-lean'
  return 'neutral'
}

function checkLongWindow(quote, ma, klines, breadth) {
  const conditions = []
  const close = quote?.close || 0
  const ma60 = ma?.ma60 || 0
  const cond1 = close > ma60
  conditions.push({ label: `指数收盘价(${close.toFixed(0)}) > MA60(${ma60.toFixed(0)})`, pass: cond1 })

  let cond2 = false
  if (klines.length >= 63) {
    const closes = klines.map(k => k.close)
    const ma60_3days = []
    for (let i = 0; i < 3; i++) {
      const s = closes.length - 60 - (2 - i)
      ma60_3days.push(closes.slice(s, s + 60).reduce((a, b) => a + b, 0) / 60)
    }
    cond2 = ma60_3days[2] > ma60_3days[1] && ma60_3days[1] > ma60_3days[0]
  }
  conditions.push({ label: 'MA60连续3日拐头向上', pass: cond2 })

  const cond3 = breadth && breadth.up && breadth.down ? (breadth.up / breadth.down > 2) : false
  conditions.push({ label: `涨跌比 > 2 (当前${breadth?.up && breadth?.down ? (breadth.up / breadth.down).toFixed(1) : '?'})`, pass: cond3 })

  const allPass = cond1 && cond2 && cond3
  return { conditions, allPass, message: allPass ? '多头窗口已开启' : '多头窗口未开启' }
}
