import { MARKET_STATUS } from './constants.js'

/**
 * 六维大盘判定算法 v3
 * 维度 1: MACD 状态（动量方向）
 * 维度 2: 涨跌家数（市场广度）
 * 维度 3: RSI 状态（超买超卖）
 * 维度 4: 融资余额（杠杆资金趋势）
 * 维度 5: 量价配合（资金确认）
 * 维度 6: 北向资金（外资方向）
 */
export function judgeMarket(indices, breadth, northbound, margin) {
  const idx = indices.sh || {}
  const klines = idx.klines || []
  const ma = idx.ma || {}
  const quote = idx.quote || {}

  const signals = []
  let bullCount = 0
  let bearCount = 0

  // 维度 1: MACD 状态
  const macdSignal = judgeMACD(klines)
  signals.push(macdSignal)
  if (macdSignal.bull) bullCount++
  if (macdSignal.bear) bearCount++

  // 维度 2: 涨跌家数
  const breadthSignal = judgeBreadth(breadth)
  signals.push(breadthSignal)
  if (breadthSignal.bull) bullCount++
  if (breadthSignal.bear) bearCount++

  // 维度 3: RSI 状态
  const rsiSignal = judgeRSI(klines)
  signals.push(rsiSignal)
  if (rsiSignal.bull) bullCount++
  if (rsiSignal.bear) bearCount++

  // 维度 4: 融资余额趋势
  const marginSignal = judgeMarginBalance(margin)
  signals.push(marginSignal)
  if (marginSignal.bull) bullCount++
  if (marginSignal.bear) bearCount++

  // 维度 5: 量价配合
  const vpSignal = judgeVolumePrice(klines)
  signals.push(vpSignal)
  if (vpSignal.bull) bullCount++
  if (vpSignal.bear) bearCount++

  // 维度 6: 北向资金
  const nbSignal = judgeNorthbound(northbound)
  signals.push(nbSignal)
  if (nbSignal.bull) bullCount++
  if (nbSignal.bear) bearCount++

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

  // 金叉 + 零轴上方 + 柱状图放大 = 强牛
  if (goldenCross && difAboveZero && hist > 0 && hist > prevHist) {
    return { dimension: 'MACD', value: '多头强势', bull: true, bear: false, desc: `DIF=${dif.toFixed(0)}>DEA=${dea.toFixed(0)}，零轴上方，柱状图放大` }
  }
  // 金叉 + 柱状图转正 = 牛
  if (goldenCross && hist > 0) {
    return { dimension: 'MACD', value: '金叉确认', bull: true, bear: false, desc: `DIF=${dif.toFixed(0)}上穿DEA=${dea.toFixed(0)}，柱状图转正` }
  }
  // 死叉 + 零轴下方 + 柱状图放大 = 强熊
  if (!goldenCross && !difAboveZero && hist < 0 && hist < prevHist) {
    return { dimension: 'MACD', value: '空头强势', bull: false, bear: true, desc: `DIF=${dif.toFixed(0)}<DEA=${dea.toFixed(0)}，零轴下方，柱状图放大` }
  }
  // 死叉 + 柱状图转负 = 熊
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

  // RSI > 60 且上行 = 强势
  if (current > 60 && trendingUp) {
    return { dimension: 'RSI', value: `强势 ${current.toFixed(0)}`, bull: true, bear: false, desc: `RSI(14)=${current.toFixed(1)}，持续上行，多头动量充足` }
  }
  // RSI 从超卖区回升（前5日内曾<30，现在>40）
  const hadOversold = rsi5.some(r => r < 30)
  if (hadOversold && current > 40 && current > prev) {
    return { dimension: 'RSI', value: `超卖回升 ${current.toFixed(0)}`, bull: true, bear: false, desc: `RSI从超卖区回升至${current.toFixed(1)}，反弹信号` }
  }
  // RSI < 40 且下行 = 弱势
  if (current < 40 && !trendingUp) {
    return { dimension: 'RSI', value: `弱势 ${current.toFixed(0)}`, bull: false, bear: true, desc: `RSI(14)=${current.toFixed(1)}，持续下行，空头动量主导` }
  }
  // RSI 从超买区回落（前5日内曾>70，现在<60）
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

  // 近5日均量
  const vol5 = klines.slice(-5).reduce((a, k) => a + k.volume, 0) / 5
  const volUp = last.volume > vol5 * 1.2
  const volDown = last.volume < vol5 * 0.7

  // 检测近3日的量价背离
  let divergence = false
  if (klines.length >= 5) {
    const recent = klines.slice(-5)
    const pricesUp = recent[4].close > recent[0].close
    const avgVol = recent.reduce((a, k) => a + k.volume, 0) / 5
    const earlyVol = recent.slice(0, 2).reduce((a, k) => a + k.volume, 0) / 2
    const lateVol = recent.slice(3).reduce((a, k) => a + k.volume, 0) / 2
    // 顶背离：价格上涨但成交量递减
    if (pricesUp && lateVol < earlyVol * 0.7) divergence = 'top'
    // 底背离：价格下跌但成交量放大
    if (!pricesUp && lateVol > earlyVol * 1.3) divergence = 'bottom'
  }

  const fmtVol = (v) => {
    if (v >= 1e8) return (v / 1e8).toFixed(0) + '亿'
    return (v / 1e4).toFixed(0) + '万'
  }

  // 价涨量增 = 健康
  if (priceUp && volUp) {
    return { dimension: '量价配合', value: '价涨量增', bull: true, bear: false, desc: `量价齐升，成交${fmtVol(last.volume)}较均量放大` }
  }
  // 底背离 = 看多
  if (divergence === 'bottom') {
    return { dimension: '量价配合', value: '底部放量', bull: true, bear: false, desc: '价格下跌但量能放大，资金逢低介入' }
  }
  // 顶背离 = 看空
  if (divergence === 'top') {
    return { dimension: '量价配合', value: '顶背离', bull: false, bear: true, desc: '价格上涨但量能萎缩，量价背离需警惕' }
  }
  // 价涨量缩 = 警惕
  if (priceUp && volDown) {
    return { dimension: '量价配合', value: '缩量上涨', bull: false, bear: true, desc: '价格上涨但量能不足，上涨持续性存疑' }
  }
  // 价跌量增 = 出货
  if (priceDown && volUp) {
    return { dimension: '量价配合', value: '放量下跌', bull: false, bear: true, desc: `价跌量增，成交${fmtVol(last.volume)}较均量放大，抛压较重` }
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
  const fmt = (v) => {
    if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
    if (v >= 1e8) return (v / 1e8).toFixed(0) + '亿'
    return (v / 1e4).toFixed(0) + '万'
  }
  const change5d = latest - day5
  const changePct = day5 > 0 ? (change5d / day5 * 100) : 0
  if (change5d > 0 && changePct > 0.5) {
    return { dimension: '融资余额', value: `持续流入 ${fmt(latest)}`, bull: true, bear: false, desc: `5日净增${fmt(Math.abs(change5d))}，增幅${changePct.toFixed(2)}%` }
  }
  if (change5d < 0 && changePct < -0.5) {
    return { dimension: '融资余额', value: `持续流出 ${fmt(latest)}`, bull: false, bear: true, desc: `5日净减${fmt(Math.abs(change5d))}，降幅${Math.abs(changePct).toFixed(2)}%` }
  }
  return { dimension: '融资余额', value: `${fmt(latest)}`, bull: false, bear: false, desc: `5日变动${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%，无明显趋势` }
}

// ==================== 北向资金 ====================
function judgeNorthbound(northbound) {
  if (!northbound || !northbound.length) {
    return { dimension: '北向资金', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const allZero = northbound.every(d => !d.totalNet)
  if (allZero) {
    return { dimension: '北向资金', value: '数据不足', bull: false, bear: false, desc: '北向资金数据暂未更新' }
  }
  let consecutiveInflow = 0
  let consecutiveOutflow = 0
  for (let i = northbound.length - 1; i >= 0; i--) {
    if (northbound[i].totalNet > 0) {
      if (consecutiveOutflow > 0) break
      consecutiveInflow++
    } else {
      if (consecutiveInflow > 0) break
      consecutiveOutflow++
    }
  }
  if (consecutiveInflow >= 5) {
    return { dimension: '北向资金', value: `连续${consecutiveInflow}日净流入`, bull: true, bear: false, desc: `连续${consecutiveInflow}日净流入` }
  }
  if (consecutiveOutflow >= 5) {
    return { dimension: '北向资金', value: `连续${consecutiveOutflow}日净流出`, bull: false, bear: true, desc: `连续${consecutiveOutflow}日净流出` }
  }
  return { dimension: '北向资金', value: '方向不明', bull: false, bear: false, desc: `近${northbound.length}日未达连续5日净流入/流出标准` }
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
