import { MARKET_STATUS } from './constants.js'

/**
 * 七维大盘判定算法 v6
 * 维度 1: MACD 状态（动量方向 + 背离检测）
 * 维度 2: 涨跌家数（市场广度 + 趋势）
 * 维度 3: RSI 状态（超买超卖 + 背离检测）
 * 维度 4: 融资余额（杠杆资金趋势 + 回归斜率）
 * 维度 5: 量价配合（OBV 趋势 + 背离）
 * 维度 6: 北向资金（活跃度 + 成交额趋势方向）
 * 维度 7: 涨跌停（市场情绪 + 封板率）
 *
 * v6 改进:
 * - 新增涨跌停维度（涨停/跌停/封板率/赚钱效应）
 * - 状态惯性（hysteresis）防止方向跳变
 * - 北向资金增加成交额趋势方向（替代不可用的净流入数据）
 * - 清理死代码
 */

// ==================== 权重配置 ====================
const W = { macd: 1.0, breadth: 1.5, rsi: 1.0, margin: 1.2, volumePrice: 1.3, northbound: 1.5, limitStats: 1.3 }
const W_STRONG = 1.5
const DIM_COUNT = 7

// ==================== 格式化工具 ====================
function fmtAmt(v) {
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
  if (v >= 1e8) return (v / 1e8).toFixed(0) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return v.toFixed(0)
}

function fmtAmtWan(v) {
  if (v >= 10000) return (v / 10000).toFixed(0) + '亿'
  return v.toFixed(0) + '万'
}

// ==================== 技术指标计算 ====================
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
  const hists = difs.map((d, i) => {
    const di = i - 8
    return di >= 0 && di < deas.length ? 2 * (d - deas[di]) : 0
  })
  const last = difs.length - 1
  const prev = last - 1
  const dl = deas.length - 1
  return {
    dif: difs[last], dea: deas[dl],
    hist: hists[last], prevHist: hists[prev] || hists[last],
    difAboveZero: difs[last] > 0, goldenCross: difs[last] > deas[dl],
    difSeries: difs, histSeries: hists
  }
}

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

function calcOBV(klines) {
  const obv = [0]
  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1].close
    const curr = klines[i].close
    if (curr > prev) obv.push(obv[i - 1] + klines[i].volume)
    else if (curr < prev) obv.push(obv[i - 1] - klines[i].volume)
    else obv.push(obv[i - 1])
  }
  return obv
}

function linearSlope(arr) {
  const n = arr.length
  if (n < 3) return 0
  let sx = 0, sy = 0, sxy = 0, sx2 = 0
  for (let i = 0; i < n; i++) {
    sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i
  }
  return (n * sxy - sx * sy) / (n * sx2 - sx * sx)
}

// ==================== 背离检测 ====================
function findLocalExtrema(arr, type) {
  const extrema = []
  for (let i = 2; i < arr.length - 2; i++) {
    let isExtreme = true
    for (let j = i - 2; j <= i + 2; j++) {
      if (j === i) continue
      if (type === 'min' && arr[j] < arr[i]) { isExtreme = false; break }
      if (type === 'max' && arr[j] > arr[i]) { isExtreme = false; break }
    }
    if (isExtreme && (extrema.length === 0 || i - extrema[extrema.length - 1].idx >= 3)) {
      extrema.push({ idx: i, val: arr[i] })
    }
  }
  return extrema
}

/**
 * 检测价格与指标之间的背离
 * prices 和 indicator 必须等长且时间对齐
 * 返回 'bullish'(底背离) / 'bearish'(顶背离) / null
 */
function detectDivergence(prices, indicator) {
  if (prices.length < 10 || indicator.length < 10) return null
  const len = Math.min(prices.length, indicator.length)
  const p = prices.slice(-len)
  const ind = indicator.slice(-len)

  const pMins = findLocalExtrema(p, 'min')
  const pMaxs = findLocalExtrema(p, 'max')

  // 底背离: 价格更低 + 指标更高
  if (pMins.length >= 2) {
    const a = pMins[pMins.length - 2], b = pMins[pMins.length - 1]
    if (b.val < a.val && ind[b.idx] > ind[a.idx]) return 'bullish'
  }
  // 顶背离: 价格更高 + 指标更低
  if (pMaxs.length >= 2) {
    const a = pMaxs[pMaxs.length - 2], b = pMaxs[pMaxs.length - 1]
    if (b.val > a.val && ind[b.idx] < ind[a.idx]) return 'bearish'
  }
  return null
}

// ==================== 主判定函数 ====================
export function judgeMarket(indices, breadth, northbound, margin, breadthHistory, limitStats, prevStatus) {
  const idx = indices.sh || {}
  const klines = idx.klines || []
  const ma = idx.ma || {}
  const quote = idx.quote || {}

  const signals = []
  let bullW = 0, bearW = 0, bullCnt = 0, bearCnt = 0

  const addSignal = (sig) => {
    signals.push(sig)
    const w = sig.weight || 1.0
    if (sig.bull) { bullW += w; bullCnt++ }
    if (sig.bear) { bearW += w; bearCnt++ }
  }

  addSignal(judgeMACD(klines))
  addSignal(judgeBreadth(breadth, breadthHistory))
  addSignal(judgeRSI(klines))
  addSignal(judgeMarginBalance(margin))
  addSignal(judgeVolumePrice(klines))
  addSignal(judgeNorthbound(northbound))
  addSignal(judgeLimitStats(limitStats))

  const status = determineStatus(bullW, bearW, prevStatus)
  const confirmed = bullW >= 3.5 || bearW >= 3.5
  const longWindow = checkLongWindow(quote, ma, klines, breadth)

  return {
    status,
    ...MARKET_STATUS[status],
    signals,
    score: { bull: bullCnt, bear: bearCnt, neutral: DIM_COUNT - bullCnt - bearCnt, bullW: +bullW.toFixed(1), bearW: +bearW.toFixed(1) },
    confirmed,
    longWindow
  }
}

// ==================== MACD（含背离检测） ====================
function judgeMACD(klines) {
  const macd = calcMACD(klines)
  if (!macd) return mk('MACD', '数据不足', 'neutral', W.macd, '')

  const { dif, dea, hist, prevHist, difAboveZero, goldenCross, difSeries } = macd

  // 背离检测
  const closes = klines.map(k => k.close)
  const div = detectDivergence(closes.slice(-30), difSeries.slice(-30))
  if (div === 'bullish') {
    return mk('MACD', '底背离', 'bull', W_STRONG,
      `价格新低但DIF未新低，DIF=${dif.toFixed(0)}，底部反转信号`, 'bullish')
  }
  if (div === 'bearish') {
    return mk('MACD', '顶背离', 'bear', W_STRONG,
      `价格新高但DIF未新高，DIF=${dif.toFixed(0)}，顶部反转信号`, 'bearish')
  }

  if (goldenCross && difAboveZero && hist > 0 && hist > prevHist) {
    return mk('MACD', '多头强势', 'bull', W.macd,
      `DIF=${dif.toFixed(0)}>DEA=${dea.toFixed(0)}，零轴上方，柱状图放大`)
  }
  if (goldenCross && hist > 0) {
    return mk('MACD', '金叉确认', 'bull', W.macd,
      `DIF=${dif.toFixed(0)}上穿DEA=${dea.toFixed(0)}，柱状图转正`)
  }
  if (!goldenCross && !difAboveZero && hist < 0 && hist < prevHist) {
    return mk('MACD', '空头强势', 'bear', W.macd,
      `DIF=${dif.toFixed(0)}<DEA=${dea.toFixed(0)}，零轴下方，柱状图放大`)
  }
  if (!goldenCross && hist < 0) {
    return mk('MACD', '死叉确认', 'bear', W.macd,
      `DIF=${dif.toFixed(0)}下穿DEA=${dea.toFixed(0)}，柱状图转负`)
  }
  return mk('MACD', '方向不明', 'neutral', W.macd,
    `DIF=${dif.toFixed(0)} DEA=${dea.toFixed(0)} 柱=${hist.toFixed(0)}`)
}

// ==================== RSI（含背离检测） ====================
function judgeRSI(klines) {
  const rsis = calcRSI(klines)
  if (!rsis || rsis.length < 5) return mk('RSI', '数据不足', 'neutral', W.rsi, '')

  const current = rsis[rsis.length - 1]
  const prev = rsis[rsis.length - 2]
  const rsi5 = rsis.slice(-5)
  const trendingUp = rsi5[rsi5.length - 1] > rsi5[0]

  // 背离检测
  const closes = klines.map(k => k.close)
  const period = 14
  const alignedCloses = closes.slice(period + 1)
  const div = detectDivergence(alignedCloses.slice(-30), rsis.slice(-30))
  if (div === 'bullish') {
    return mk('RSI', `底背离 ${current.toFixed(0)}`, 'bull', W_STRONG,
      `RSI底背离，价格新低但RSI=${current.toFixed(1)}未新低，反转信号强`, 'bullish')
  }
  if (div === 'bearish') {
    return mk('RSI', `顶背离 ${current.toFixed(0)}`, 'bear', W_STRONG,
      `RSI顶背离，价格新高但RSI=${current.toFixed(1)}未新高，调整风险`, 'bearish')
  }

  if (current > 60 && trendingUp) {
    return mk('RSI', `强势 ${current.toFixed(0)}`, 'bull', W.rsi,
      `RSI(14)=${current.toFixed(1)}，持续上行，多头动量充足`)
  }
  const hadOversold = rsi5.some(r => r < 30)
  if (hadOversold && current > 40 && current > prev) {
    return mk('RSI', `超卖回升 ${current.toFixed(0)}`, 'bull', W.rsi,
      `RSI从超卖区回升至${current.toFixed(1)}，反弹信号`)
  }
  if (current < 40 && !trendingUp) {
    return mk('RSI', `弱势 ${current.toFixed(0)}`, 'bear', W.rsi,
      `RSI(14)=${current.toFixed(1)}，持续下行，空头动量主导`)
  }
  const hadOverbought = rsi5.some(r => r > 70)
  if (hadOverbought && current < 60 && current < prev) {
    return mk('RSI', `超买回落 ${current.toFixed(0)}`, 'bear', W.rsi,
      `RSI从超买区回落至${current.toFixed(1)}，调整信号`)
  }
  return mk('RSI', `${current.toFixed(0)}`, 'neutral', W.rsi,
    `RSI(14)=${current.toFixed(1)}，中性区间`)
}

// ==================== 涨跌家数（含趋势） ====================
function judgeBreadth(breadth, breadthHistory) {
  if (!breadth || (!breadth.up && !breadth.down)) {
    return mk('涨跌家数', '数据不足', 'neutral', W.breadth, '')
  }
  const { up, down } = breadth
  const ratio = down > 0 ? up / down : up

  // 趋势判断（对比前几日）
  let trend = ''
  if (breadthHistory && breadthHistory.length >= 2) {
    const prev = breadthHistory[breadthHistory.length - 2]
    if (prev && prev.down > 0) {
      const prevRatio = prev.up / prev.down
      const improvement = ratio > prevRatio * 1.1
      const deterioration = ratio < prevRatio * 0.9
      if (improvement) trend = ' ↑改善'
      else if (deterioration) trend = ' ↓恶化'
    }
  }

  if (ratio >= 2) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bull', W_STRONG,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场广度极强${trend}`)
  }
  if (ratio >= 1.5) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bull', W.breadth,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场偏强${trend}`)
  }
  if (ratio <= 0.5) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bear', W_STRONG,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场广度极弱${trend}`)
  }
  if (ratio < 0.67) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bear', W.breadth,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场偏弱${trend}`)
  }
  return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'neutral', W.breadth,
    `涨跌比${ratio.toFixed(1)}，无明显偏向${trend}`)
}

// ==================== 融资余额（线性回归） ====================
function judgeMarginBalance(margin) {
  if (!margin || margin.length < 5) return mk('融资余额', '数据不足', 'neutral', W.margin, '')

  const latest = margin[0].rzBalance
  const balances = margin.slice(0, Math.min(10, margin.length)).reverse().map(d => d.rzBalance)

  // 线性回归斜率（正=流入趋势，负=流出趋势）
  const slope = linearSlope(balances)
  const slopePct = balances[0] > 0 ? (slope / balances[0] * 100) : 0

  // 加速度（前半段 vs 后半段斜率）
  const half = Math.floor(balances.length / 2)
  let accelerating = ''
  if (balances.length >= 6) {
    const slope1 = linearSlope(balances.slice(0, half))
    const slope2 = linearSlope(balances.slice(half))
    if (slope > 0 && slope2 > slope1) accelerating = '（加速流入）'
    else if (slope > 0 && slope2 < slope1) accelerating = '（增速放缓）'
    else if (slope < 0 && slope2 < slope1) accelerating = '（加速流出）'
    else if (slope < 0 && slope2 > slope1) accelerating = '（流出放缓）'
  }

  if (slope > 0 && slopePct > 0.3) {
    return mk('融资余额', `持续流入 ${fmtAmt(latest)}`, 'bull', slopePct > 0.5 ? W_STRONG : W.margin,
      `10日回归斜率为正(+${slopePct.toFixed(2)}%/日)${accelerating}，杠杆资金做多`)
  }
  if (slope < 0 && slopePct < -0.3) {
    return mk('融资余额', `持续流出 ${fmtAmt(latest)}`, 'bear', slopePct < -0.5 ? W_STRONG : W.margin,
      `10日回归斜率为负(${slopePct.toFixed(2)}%/日)${accelerating}，杠杆资金撤离`)
  }
  return mk('融资余额', `${fmtAmt(latest)}`, 'neutral', W.margin,
    `10日回归斜率${slopePct >= 0 ? '+' : ''}${slopePct.toFixed(2)}%/日，无明显趋势${accelerating}`)
}

// ==================== 量价配合（OBV 趋势） ====================
function judgeVolumePrice(klines) {
  if (klines.length < 20) return mk('量价配合', '数据不足', 'neutral', W.volumePrice, '')

  const closes = klines.map(k => k.close)
  const obv = calcOBV(klines)

  // 20 日窗口 OBV 趋势 vs 价格趋势
  const recentCloses = closes.slice(-20)
  const recentObv = obv.slice(-20)
  const priceUp = linearSlope(recentCloses) > 0
  const obvUp = linearSlope(recentObv) > 0

  const last = klines[klines.length - 1]

  // OBV 背离检测
  const div = detectDivergence(recentCloses, recentObv)

  if (div === 'bearish') {
    return mk('量价配合', 'OBV顶背离', 'bear', W_STRONG,
      `价格上涨但OBV下降，资金在出货，需警惕`, 'bearish')
  }
  if (div === 'bullish') {
    return mk('量价配合', 'OBV底背离', 'bull', W_STRONG,
      `价格下跌但OBV上升，资金在吸筹，底部信号`, 'bullish')
  }

  if (priceUp && obvUp) {
    return mk('量价配合', '价涨量增', 'bull', W.volumePrice,
      `20日OBV趋势向上，量价齐升，成交${fmtAmt(last.volume)}`)
  }
  if (!priceUp && obvUp) {
    return mk('量价配合', '缩量吸筹', 'bull', W.volumePrice,
      `价格回调但OBV上升，资金逢低介入`)
  }
  if (priceUp && !obvUp) {
    return mk('量价配合', '量价背离', 'bear', W.volumePrice,
      `价格上涨但OBV下降，上涨缺乏量能支撑`)
  }
  if (!priceUp && !obvUp) {
    return mk('量价配合', '放量下跌', 'bear', W.volumePrice,
      `价格下跌且OBV持续下降，资金持续流出，抛压延续`)
  }
  return mk('量价配合', '量价正常', 'neutral', W.volumePrice, '量价关系无明显异常')
}

// ==================== 北向资金（活跃度 + 成交额趋势方向） ====================
function judgeNorthbound(northbound) {
  if (!northbound || northbound.length < 5) return mk('北向资金', '数据不足', 'neutral', W.northbound, '')

  // nfAmt 是成交额（恒正），通过 5 日/20 日均量比判断活跃度
  const amts = northbound.slice(0, Math.min(20, northbound.length)).map(d => d.nfAmt || 0)
  const amt5 = amts.slice(0, 5)
  const amt20 = amts
  const avg5 = amt5.reduce((a, b) => a + b, 0) / 5
  const avg20 = amt20.reduce((a, b) => a + b, 0) / amt20.length
  const ratio = avg20 !== 0 ? avg5 / avg20 : 1
  const changePct = (ratio - 1) * 100
  const latest = northbound[0]?.nfAmt || 0

  // 成交额趋势方向（5 日回归斜率 → 活跃度在增还是减）
  const slope = linearSlope(amt5)
  const trendDir = slope > 0 ? '↑' : slope < 0 ? '↓' : '→'

  if (ratio >= 1.2) {
    const direction = slope > 0 ? '且持续升温' : slope < 0 ? '但有所降温' : ''
    return mk('北向资金', `活跃${trendDir} ${fmtAmtWan(latest)}`, 'bull', ratio >= 1.4 ? W_STRONG : W.northbound,
      `近5日均成交${fmtAmtWan(avg5)}，高于20日均${fmtAmtWan(avg20)}，增幅${changePct.toFixed(1)}%，${direction}`)
  }
  if (ratio <= 0.8) {
    const direction = slope < 0 ? '且持续萎缩' : slope > 0 ? '但有所回暖' : ''
    return mk('北向资金', `退缩${trendDir} ${fmtAmtWan(latest)}`, 'bear', ratio <= 0.6 ? W_STRONG : W.northbound,
      `近5日均成交${fmtAmtWan(avg5)}，低于20日均${fmtAmtWan(avg20)}，降幅${Math.abs(changePct).toFixed(1)}%，${direction}`)
  }

  return mk('北向资金', `${fmtAmtWan(latest)}`, 'neutral', W.northbound,
    `近5日均${fmtAmtWan(avg5)}，20日均${fmtAmtWan(avg20)}，偏差${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`)
}

// ==================== 涨跌停（市场情绪，并行评分） ====================
function judgeLimitStats(limitStats) {
  if (!limitStats || (!limitStats.limitUp && !limitStats.limitDown)) {
    return mk('涨跌停', '数据不足', 'neutral', W.limitStats, '')
  }

  const limitUp = limitStats.limitUp || 0
  const limitDown = limitStats.limitDown || 0
  const naturalLimit = limitStats.naturalLimit || 0
  const touchLimit = limitStats.touchLimit || 0
  // sealingRate/moneyEffect 可能是 0-1 或 0-100，统一为百分比
  const sealPct = limitStats.sealingRate > 1 ? limitStats.sealingRate : Math.round((limitStats.sealingRate || 0) * 100)
  const moneyPct = limitStats.moneyEffect > 1 ? limitStats.moneyEffect : Math.round((limitStats.moneyEffect || 0) * 100)
  const t1Pct = limitStats.t1PctChange || 0

  // 涨跌停比
  const ratio = limitDown > 0 ? limitUp / limitDown : limitUp
  // 曾涨停打开率（假突破率）
  const failPct = (touchLimit + limitUp) > 0 ? (touchLimit / (touchLimit + limitUp) * 100) : 0

  // === 并行评分：牛信号 vs 熊信号 ===
  let bullPts = 0, bearPts = 0
  const details = []

  // 1. 涨跌停比（最核心）
  if (ratio >= 5)       { bullPts += 3; details.push(`涨跌比${ratio.toFixed(1)}极强`) }
  else if (ratio >= 2.5){ bullPts += 2; details.push(`涨跌比${ratio.toFixed(1)}偏强`) }
  else if (ratio >= 1.5){ bullPts += 1 }
  else if (ratio <= 0.2){ bearPts += 3; details.push(`涨跌比${ratio.toFixed(1)}极弱`) }
  else if (ratio <= 0.4){ bearPts += 2; details.push(`涨跌比${ratio.toFixed(1)}偏弱`) }
  else if (ratio < 0.8) { bearPts += 1 }

  // 2. 跌停绝对数量（恐慌指标）
  if (limitDown >= 100)     { bearPts += 3; details.push(`跌停${limitDown}家(千股跌停)`) }
  else if (limitDown >= 50) { bearPts += 2; details.push(`跌停${limitDown}家`) }
  else if (limitDown >= 20) { bearPts += 1; details.push(`跌停${limitDown}家`) }

  // 3. 涨停绝对数量 + 封板质量
  if (limitUp >= 80 && sealPct >= 70)  { bullPts += 3; details.push(`涨停${limitUp}家，封板${sealPct}%`) }
  else if (limitUp >= 40 && sealPct >= 50) { bullPts += 2; details.push(`涨停${limitUp}家，封板${sealPct}%`) }
  else if (limitUp >= 20 && sealPct >= 40) { bullPts += 1 }

  // 4. 赚钱效应（打板次日收益）
  if (t1Pct >= 2)       { bullPts += 1; details.push(`打板次日+${t1Pct.toFixed(1)}%`) }
  else if (t1Pct <= -2) { bearPts += 2; details.push(`打板次日${t1Pct.toFixed(1)}%（追高亏钱）`) }
  else if (t1Pct < -0.5){ bearPts += 1; details.push(`打板次日${t1Pct.toFixed(1)}%`) }

  // 5. 封板率低于40%（大量假突破）
  if (sealPct > 0 && sealPct < 40 && limitUp >= 15) { bearPts += 1; details.push(`封板率仅${sealPct}%`) }

  // 6. 赚钱效应低于30%
  if (moneyPct > 0 && moneyPct < 30) { bearPts += 1; details.push(`赚钱效应仅${moneyPct}%`) }

  // === 汇总判定 ===
  const net = bullPts - bearPts
  const val = `涨停${limitUp} 跌停${limitDown} 封板${sealPct}%`

  if (net >= 4) {
    return mk('涨跌停', val, 'bull', W_STRONG, details.join('，') + '，市场极度活跃')
  }
  if (net >= 2) {
    return mk('涨跌停', val, 'bull', W.limitStats, details.join('，') || '市场情绪偏强')
  }
  if (net <= -4) {
    return mk('涨跌停', val, 'bear', W_STRONG, details.join('，') + '，市场恐慌')
  }
  if (net <= -2) {
    return mk('涨跌停', val, 'bear', W.limitStats, details.join('，') || '市场偏弱')
  }
  return mk('涨跌停', val, 'neutral', W.limitStats,
    `涨停${limitUp}家，跌停${limitDown}家，封板${sealPct}%，赚钱效应${moneyPct}%，情绪中性`)
}

// ==================== 综合判定（加权评分 + 状态惯性） ====================
function determineStatus(bullW, bearW, prevStatus) {
  const net = bullW - bearW

  // 计算原始状态
  let raw
  if (bullW >= 4.5 && net > 0) raw = 'bull'
  else if (bearW >= 4.5 && net < 0) raw = 'bear'
  else if (bullW >= 3.0 && net > 0) raw = 'bull-lean'
  else if (bearW >= 3.0 && net < 0) raw = 'bear-lean'
  else raw = 'neutral'

  if (!prevStatus || prevStatus === raw) return raw

  // 状态惯性（hysteresis）：方向切换需要更强的证据
  const BULL = new Set(['bull', 'bull-lean'])
  const BEAR = new Set(['bear', 'bear-lean'])

  // 同方向调整（bull↔bull-lean, bear↔bear-lean）自由切换
  if (BULL.has(prevStatus) && BULL.has(raw)) return raw
  if (BEAR.has(prevStatus) && BEAR.has(raw)) return raw

  // 跨方向或进出中性：需要 |net| ≥ 2.5
  if (Math.abs(net) < 2.5) return prevStatus

  return raw
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

  const cond3 = breadth && breadth.up && breadth.down ? (breadth.up / breadth.down >= 1.5) : false
  conditions.push({ label: `涨跌比 ≥ 1.5 (当前${breadth?.up && breadth?.down ? (breadth.up / breadth.down).toFixed(1) : '?'})`, pass: cond3 })

  const allPass = cond1 && cond2 && cond3
  return { conditions, allPass, message: allPass ? '多头窗口已开启' : '多头窗口未开启' }
}

// ==================== 信号构造辅助 ====================
function mk(dimension, value, dir, weight, desc, divergence) {
  return {
    dimension, value,
    bull: dir === 'bull',
    bear: dir === 'bear',
    weight,
    desc,
    divergence: divergence || null
  }
}
