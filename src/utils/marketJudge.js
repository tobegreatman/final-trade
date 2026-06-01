import { MARKET_STATUS } from './constants.js'
import { calcVolatilityMeasure, detectDivergenceV2 } from './divergence.js'

/**
 * 八维大盘判定算法 v7
 * 维度 1: MACD 状态（动量方向 + 背离检测）
 * 维度 2: 涨跌家数（市场广度 + 趋势）
 * 维度 3: RSI 状态（超买超卖 + 背离检测）
 * 维度 4: 融资余额（杠杆资金趋势 + 回归斜率）
 * 维度 5: 量价配合（OBV 趋势 + 背离）
 * 维度 6: 北向资金（活跃度 + 成交额趋势方向）
 * 维度 7: 涨跌停（市场情绪 + 封板率）
 * 维度 8: 宏观因子（PMI/M1-M2剪刀差/CPI/GDP，低权重辅助）
 *
 * v7 改进:
 * - 新增宏观因子辅助维度（PMI/M2-M1剪刀差/CPI/GDP）
 * - 板块RS轮动信号（相对强度 vs 上证指数基准）
 * - 状态惯性（hysteresis）防止方向跳变
 */

// ==================== 权重配置 ====================
const W = { macd: 1.0, breadth: 1.5, rsi: 1.0, margin: 1.2, volumePrice: 1.3, northbound: 1.5, limitStats: 1.3, macro: 0.5 }
const W_STRONG = 2.0
const CORE_DIM_COUNT = 7  // 核心技术七维（不含宏观辅助）

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
    hist: hists[last], prevHist: hists[prev] ?? hists[last],
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

// ==================== 背离检测已抽取至 divergence.js ====================
// calcVolatilityMeasure, findLocalExtremaMultiScale, detectDivergenceV2
// 均从 ./divergence.js 导入

// ==================== 主判定函数 ====================
export function judgeMarket(indices, breadth, northbound, margin, breadthHistory, limitStats, prevStatus, macroScore, todayStr) {
  const idx = indices.sh || {}
  const ma = idx.ma || {}
  const quote = idx.quote || {}

  // 兼容旧版 string 和新版 object 两种 prevStatus 格式
  const prev = typeof prevStatus === 'string'
    ? { status: prevStatus, date: null, crossCount: 0, lastFlipDate: null }
    : (prevStatus || { status: null, date: null, crossCount: 0, lastFlipDate: null })

  const signals = []
  let bullW = 0, bearW = 0, bullCnt = 0, bearCnt = 0

  const addSignal = (sig) => {
    signals.push(sig)
    const w = sig.weight || 1.0
    if (sig.bull) { bullW += w; bullCnt++ }
    if (sig.bear) { bearW += w; bearCnt++ }
  }

  addSignal(judgeBreadth(breadth, breadthHistory))
  addSignal(judgeLimitStats(limitStats))
  addSignal(synthMultiIndex(indices, judgeMACD))
  addSignal(synthMultiIndex(indices, judgeRSI))
  addSignal(judgeNorthbound(northbound))
  addSignal(judgeMarginBalance(margin))
  addSignal(synthMultiIndex(indices, judgeVolumePrice))

  // 宏观因子修正（第8维度，低权重，作为辅助参考）
  if (macroScore != null && macroScore !== 0) {
    const abs = Math.abs(macroScore)
    const dir = macroScore > 0 ? 'bull' : 'bear'
    const desc = macroScore > 0 ? '宏观环境偏暖，支持多头' : '宏观环境偏冷，抑制做多情绪'
    addSignal(mk('宏观因子', `${macroScore > 0 ? '+' : ''}${macroScore.toFixed(1)}分`, dir, abs * W.macro, desc))
  }

  const hysteresisResult = determineStatus(bullW, bearW, prev, todayStr)
  const status = hysteresisResult.status
  // confirmed 与状态等级对齐：偏多及以上 = 多头确认，偏空及以下 = 空头确认
  const confirmed = BULL_SET.has(status) || BEAR_SET.has(status)
  const longWindow = checkLongWindow(quote, ma, idx.klines || [], breadth)

  return {
    status,
    ...MARKET_STATUS[status],
    signals,
    score: { bull: bullCnt, bear: bearCnt, neutral: signals.length - bullCnt - bearCnt, bullW: +bullW.toFixed(1), bearW: +bearW.toFixed(1) },
    confirmed,
    longWindow,
    hysteresisState: hysteresisResult
  }
}

// ==================== MACD（含背离检测） ====================
function judgeMACD(klines) {
  const macd = calcMACD(klines)
  if (!macd) return mk('MACD', '数据不足', 'neutral', W.macd, '')

  const { dif, dea, hist, prevHist, difAboveZero, difSeries } = macd

  // 背离检测（优先级最高，v7.1 增强版）
  const closes = klines.map(k => k.close)
  // 对齐：difSeries[i] 对应 closes[i+26]，取等长子序列
  const n = Math.min(30, difSeries.length)
  const baseCloses = closes.slice(closes.length - difSeries.length)
  const div = detectDivergenceV2(baseCloses.slice(-n), difSeries.slice(-n))
  if (div && div.type === 'bullish') {
    const w = W_STRONG * div.confidence
    return mk('MACD', `底背离(${(div.confidence * 100).toFixed(0)}%)`, 'bull', w,
      `价格新低但DIF未新低，DIF=${dif.toFixed(0)}，底部反转信号，置信度${(div.confidence * 100).toFixed(0)}%`, 'bullish')
  }
  if (div && div.type === 'bearish') {
    const w = W_STRONG * div.confidence
    return mk('MACD', `顶背离(${(div.confidence * 100).toFixed(0)}%)`, 'bear', w,
      `价格新高但DIF未新高，DIF=${dif.toFixed(0)}，顶部反转信号，置信度${(div.confidence * 100).toFixed(0)}%`, 'bearish')
  }

  // 交叉检测（柱状图穿越零轴 = DIF 穿越 DEA）
  const justGoldenCross = prevHist <= 0 && hist > 0
  const justDeathCross = prevHist >= 0 && hist < 0

  if (justGoldenCross) {
    return mk('MACD', difAboveZero ? '金叉' : '金叉(弱)', 'bull',
      difAboveZero ? W.macd : W.macd * 0.7,
      `DIF上穿DEA，${difAboveZero ? '零轴上方，信号较强' : '零轴下方，信号偏弱'}`)
  }
  if (justDeathCross) {
    return mk('MACD', !difAboveZero ? '死叉' : '死叉(弱)', 'bear',
      !difAboveZero ? W.macd : W.macd * 0.7,
      `DIF下穿DEA，${!difAboveZero ? '零轴下方，信号较强' : '零轴上方，信号偏弱'}`)
  }

  // 持续状态（无交叉）
  const difAboveDea = dif > dea

  if (difAboveDea && difAboveZero) {
    if (hist > prevHist) {
      return mk('MACD', '多头强势', 'bull', W.macd,
        `DIF=${dif.toFixed(0)}>DEA=${dea.toFixed(0)}，零轴上方，柱状图放大`)
    }
    return mk('MACD', '多头减弱', 'neutral', W.macd,
      `DIF在零轴上方，但柱状图收缩，上涨动量减弱`)
  }

  if (!difAboveDea && !difAboveZero) {
    if (hist < prevHist) {
      return mk('MACD', '空头强势', 'bear', W.macd,
        `DIF=${dif.toFixed(0)}<DEA=${dea.toFixed(0)}，零轴下方，柱状图放大`)
    }
    return mk('MACD', '空头减弱', 'neutral', W.macd,
      `DIF在零轴下方，但柱状图收缩，下跌动量减弱`)
  }

  // 零轴附近震荡（DIF和DEA方向与零轴不一致）
  return mk('MACD', '零轴震荡', 'neutral', W.macd,
    `DIF=${dif.toFixed(0)}，DEA=${dea.toFixed(0)}，方向不明`)
}

// ==================== RSI（含背离检测） ====================
function judgeRSI(klines) {
  const rsis = calcRSI(klines)
  if (!rsis || rsis.length < 5) return mk('RSI', '数据不足', 'neutral', W.rsi, '')

  const current = rsis[rsis.length - 1]
  const prev = rsis[rsis.length - 2]
  const rsi5 = rsis.slice(-5)
  const trendingUp = rsi5[rsi5.length - 1] > rsi5[0]

  // 背离检测（v7.1 增强版）
  const closes = klines.map(k => k.close)
  const period = 14
  const alignedCloses = closes.slice(period + 1)
  const div = detectDivergenceV2(alignedCloses.slice(-30), rsis.slice(-30))
  if (div && div.type === 'bullish') {
    const w = W_STRONG * div.confidence
    return mk('RSI', `底背离 ${current.toFixed(0)}(${(div.confidence * 100).toFixed(0)}%)`, 'bull', w,
      `RSI底背离，价格新低但RSI=${current.toFixed(1)}未新低，反转信号，置信度${(div.confidence * 100).toFixed(0)}%`, 'bullish')
  }
  if (div && div.type === 'bearish') {
    const w = W_STRONG * div.confidence
    return mk('RSI', `顶背离 ${current.toFixed(0)}(${(div.confidence * 100).toFixed(0)}%)`, 'bear', w,
      `RSI顶背离，价格新高但RSI=${current.toFixed(1)}未新高，调整风险，置信度${(div.confidence * 100).toFixed(0)}%`, 'bearish')
  }

  // 多头判定（从强到弱，无重叠区间）
  const hadOversold = rsi5.some(r => r < 30)
  const hadOverbought = rsi5.some(r => r > 70)

  if (current >= 60 && trendingUp) {
    // RSI≥60 且上行 → 强势多头（合并原 >55+trendingUp 和 ≥60 两个条件）
    return mk('RSI', `强势 ${current.toFixed(0)}`, 'bull', W.rsi,
      `RSI(14)=${current.toFixed(1)}，持续上行，多头动量充足`)
  }
  if (current >= 60 && !trendingUp) {
    // RSI≥60 但停止上行 → 偏强但动量减弱
    return mk('RSI', `偏强 ${current.toFixed(0)}`, 'bull', W.rsi * 0.7,
      `RSI(14)=${current.toFixed(1)}，高位运行，多头格局`)
  }
  if (current > 55 && trendingUp) {
    // RSI 55~60 且上行 → 多头偏强
    return mk('RSI', `偏强 ${current.toFixed(0)}`, 'bull', W.rsi * 0.7,
      `RSI(14)=${current.toFixed(1)}，上行中，多头格局`)
  }
  if (hadOversold && current > 45 && current > prev) {
    // 近5日曾超卖，现回升 → 反弹信号
    return mk('RSI', `超卖回升 ${current.toFixed(0)}`, 'bull', W.rsi,
      `RSI从超卖区回升至${current.toFixed(1)}，反弹信号`)
  }

  // 空头判定（从强到弱，无重叠区间）
  if (current < 35 && !trendingUp) {
    // RSI<35 且下行 → 强势空头
    return mk('RSI', `弱势 ${current.toFixed(0)}`, 'bear', W.rsi,
      `RSI(14)=${current.toFixed(1)}，持续下行，空头动量主导`)
  }
  if (current < 35 && trendingUp) {
    // RSI<35 但开始上行 → 偏弱但动量改善
    return mk('RSI', `偏弱 ${current.toFixed(0)}`, 'bear', W.rsi * 0.7,
      `RSI(14)=${current.toFixed(1)}，低位但开始回升`)
  }
  if (current >= 35 && current < 40 && !trendingUp) {
    // RSI 35~40 且下行 → 偏弱
    return mk('RSI', `偏弱 ${current.toFixed(0)}`, 'bear', W.rsi * 0.7,
      `RSI(14)=${current.toFixed(1)}，低位运行，偏空格局`)
  }
  if (hadOverbought && current < 55 && current < prev) {
    // 近5日曾超买，现回落 → 调整信号
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
  const ratio = down > 0 ? up / down : (up > 0 ? up : 1)
  if (!Number.isFinite(ratio)) {
    return mk('涨跌家数', '数据不足', 'neutral', W.breadth, '')
  }

  // 趋势判断（近3日均值 vs 前10日均值，滑动窗口更稳健）
  let trend = ''
  if (breadthHistory && breadthHistory.length >= 3) {
    const histRatios = breadthHistory
      .filter(h => h && h.down > 0)
      .map(h => h.up / h.down)
    if (histRatios.length >= 3) {
      const recent3 = histRatios.slice(-3)
      const recent3Avg = recent3.reduce((a, b) => a + b, 0) / recent3.length
      // 前10日均值（排除最近3日，至少需要2日数据）
      const olderRatios = histRatios.slice(0, -3)
      const olderAvg = olderRatios.length >= 2
        ? olderRatios.slice(-10).reduce((a, b) => a + b, 0) / olderRatios.slice(-10).length
        : recent3Avg  // 历史数据不足时退回与自身比较（不产生趋势标记）
      const improvement = recent3Avg > olderAvg * 1.1
      const deterioration = recent3Avg < olderAvg * 0.9
      if (improvement) trend = ' ↑改善'
      else if (deterioration) trend = ' ↓恶化'
    }
  }

  if (ratio >= 2) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bull', W_STRONG,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场广度极强${trend}`)
  }
  if (ratio >= 1.8) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bull', W.breadth,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场偏强${trend}`)
  }
  if (ratio >= 1.5) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bull', W.breadth * 0.7,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，略偏多但未达牛熊分界(1.8)${trend}`)
  }
  if (ratio <= 0.5) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bear', W_STRONG,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场广度极弱${trend}`)
  }
  if (ratio <= 0.55) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bear', W.breadth,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，市场偏弱${trend}`)
  }
  if (ratio <= 0.67) {
    return mk('涨跌家数', `${up}/${down} (${ratio.toFixed(1)})${trend}`, 'bear', W.breadth * 0.7,
      `上涨${up}家/下跌${down}家，比值${ratio.toFixed(1)}，略偏空但未达牛熊分界(0.55)${trend}`)
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
    `10日回归斜率${slopePct >= 0 ? '+' : ''}${slopePct.toFixed(2)}%/日，无明显趋势`)
}

// ==================== 量价配合（OBV 趋势） ====================
function judgeVolumePrice(klines) {
  if (klines.length < 20) return mk('量价配合', '数据不足', 'neutral', W.volumePrice, '')

  const closes = klines.map(k => k.close)
  const obv = calcOBV(klines)

  // 20 日窗口 OBV 趋势 vs 价格趋势
  const recentCloses = closes.slice(-20)
  const recentObv = obv.slice(-20)
  const priceSlope = linearSlope(recentCloses)
  const obvSlope = linearSlope(recentObv)

  // 归一化为日均变化率，消除量纲差异
  const priceAvg = (recentCloses[0] + recentCloses[recentCloses.length - 1]) / 2
  const priceNorm = priceAvg > 0 ? priceSlope / priceAvg : 0
  const obvAbs = recentObv.reduce((s, v) => s + Math.abs(v), 0) / recentObv.length
  const obvNorm = obvAbs > 0 ? obvSlope / obvAbs : 0

  // 死区：日均变化率 ±0.05% 以内视为平坦（≈20天累计1%）
  const DEAD = 0.0005
  const priceUp = priceNorm > DEAD
  const priceDown = priceNorm < -DEAD
  const obvUp = obvNorm > DEAD
  const obvDown = obvNorm < -DEAD

  // 量化辅助：5 日均量 vs 20 日均量（量比）
  const vols = klines.slice(-20).map(k => k.volume || 0)
  const avgVol5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5
  const avgVol20 = vols.reduce((a, b) => a + b, 0) / 20
  const volRatio = avgVol20 > 0 ? avgVol5 / avgVol20 : 1
  const volPct = ((volRatio - 1) * 100).toFixed(0)
  const amtLatest = klines[klines.length - 1].amount
  const amtInfo = amtLatest ? `今日成交${fmtAmt(amtLatest)}` : ''

  // OBV 背离检测（v7.1 增强版）
  const div = detectDivergenceV2(recentCloses, recentObv)

  if (div && div.type === 'bearish') {
    const w = W_STRONG * div.confidence
    return mk('量价配合', `缩量新高(${(div.confidence * 100).toFixed(0)}%)`, 'bear', w,
      `价格创新高但成交量萎缩，主力可能在出货，置信度${(div.confidence * 100).toFixed(0)}%${amtInfo ? '，' + amtInfo : ''}`, 'bearish')
  }
  if (div && div.type === 'bullish') {
    const w = W_STRONG * div.confidence
    return mk('量价配合', `放量新低(${(div.confidence * 100).toFixed(0)}%)`, 'bull', w,
      `价格走低但资金暗中买入，底部蓄力信号，置信度${(div.confidence * 100).toFixed(0)}%${volRatio > 1 ? `，近5日均量放大${volPct}%` : ''}`, 'bullish')
  }

  if (priceUp && obvUp) {
    const volHint = volRatio > 1.15 ? `近5日均量放大${volPct}%，资金持续进场` : '成交量稳步放大'
    return mk('量价配合', '放量上涨', 'bull', W.volumePrice,
      `量价齐升，${volHint}${amtInfo ? '，' + amtInfo : ''}`)
  }
  if (priceDown && obvUp) {
    return mk('量价配合', '缩量回调', 'bull', W.volumePrice * 0.6,
      `回调缩量，资金流向仍为净流入，筹码锁定良好`)
  }
  if (priceUp && obvDown) {
    return mk('量价配合', '缩量上涨', 'bear', W.volumePrice,
      `上涨无量配合，近5日均量缩减${Math.abs(volPct)}%，虚涨需警惕`)
  }
  if (priceDown && obvDown) {
    const volHint = volRatio > 1.1 ? `，近5日均量放大${volPct}%，抛压加重` : ''
    return mk('量价配合', '放量下跌', 'bear', W.volumePrice,
      `资金持续出逃，放量下挫${volHint}`)
  }

  // 斜率不显著（死区内）
  return mk('量价配合', '量能平稳', 'neutral', W.volumePrice, '近20日成交量变化不大，市场观望情绪浓厚')
}

// ==================== 多指数综合判定 ====================
const INDEX_KEYS = ['sh', 'sz', 'cyb']
const INDEX_NAMES = { sh: '上证', sz: '深证', cyb: '创业板' }

/**
 * 多指数综合判定：对上证/深证/创业板分别运行判定函数，综合输出
 * 三者同向 → 权重 × 1.2；两同向一反向 → 权重 × 1.0；三者分化 → neutral × 0.7
 */
function synthMultiIndex(indices, judgeFn) {
  // 对三个指数分别运行判定
  const results = []
  for (const key of INDEX_KEYS) {
    const klines = indices[key]?.klines || []
    if (klines.length < 20) continue  // 数据不足跳过
    const sig = judgeFn(klines)
    results.push({ key, name: INDEX_NAMES[key], signal: sig })
  }

  // 全部数据不足时用上证兜底（可能有极少 klines）
  if (results.length === 0) {
    const klines = (indices.sh?.klines || [])
    return judgeFn(klines)
  }

  // 只有一个指数有数据
  if (results.length === 1) {
    return results[0].signal
  }

  // 统计方向
  const bulls = results.filter(r => r.signal.bull)
  const bears = results.filter(r => r.signal.bear)
  const neutrals = results.filter(r => !r.signal.bull && !r.signal.bear)
  // 优先上证为主信号源，缺失时取第一个有效指数并标记降级
  const primary = results.find(r => r.key === 'sh') || results[0]
  const isPrimaryFallback = primary.key !== 'sh'

  // 多指数方向综合 + 权重调整
  let dir, weight, desc
  const agreement = `(${results.map(r => `${r.name}${r.signal.bull ? '多' : r.signal.bear ? '空' : '中'}`).join('/')})`

  // 上证缺失时额外折扣系数（数据源不够可靠）
  const fallbackFactor = isPrimaryFallback ? 0.8 : 1.0

  if (bulls.length === results.length) {
    // 全部看多
    dir = 'bull'
    weight = primary.signal.weight * 1.2 * fallbackFactor
    desc = `${primary.signal.desc} ${agreement}`
  } else if (bears.length === results.length) {
    // 全部看空
    dir = 'bear'
    weight = primary.signal.weight * 1.2 * fallbackFactor
    desc = `${primary.signal.desc} ${agreement}`
  } else if (bulls.length >= 2) {
    // 多数看多
    dir = 'bull'
    weight = primary.signal.weight * fallbackFactor
    desc = `${primary.signal.desc} ${agreement}`
  } else if (bears.length >= 2) {
    // 多数看空
    dir = 'bear'
    weight = primary.signal.weight * fallbackFactor
    desc = `${primary.signal.desc} ${agreement}`
  } else if (bulls.length === 1 && bears.length === 1 && neutrals.length >= 1) {
    // 一多一空一中 → 跟随主信号源
    dir = primary.signal.bull ? 'bull' : (primary.signal.bear ? 'bear' : 'neutral')
    weight = primary.signal.weight * 0.7 * fallbackFactor
    desc = `指数分化，信号弱化 ${agreement}`
  } else {
    // 完全分化或全中性
    dir = 'neutral'
    weight = primary.signal.weight * 0.7 * fallbackFactor
    desc = `指数方向不一，信号弱化 ${agreement}`
  }

  const sig = primary.signal
  return {
    dimension: sig.dimension,
    value: sig.value,
    bull: dir === 'bull',
    bear: dir === 'bear',
    weight,
    desc,
    divergence: sig.divergence || null,
    subSignals: results.map(r => ({
      index: r.name,
      signal: r.signal.value,
      dir: r.signal.bull ? 'bull' : (r.signal.bear ? 'bear' : 'neutral')
    })),
    hint: sig.dimension === '量价配合' ? '20日趋势' : null
  }
}

// ==================== 北向资金（活跃度 + 量价联合方向分析） ====================
function judgeNorthbound(northbound) {
  if (!northbound || northbound.length < 5) return mk('北向资金', '数据不足', 'neutral', W.northbound, '')

  // nfAmt 是成交额（恒正），通过 5 日/20 日均量比判断活跃度
  const amts = northbound.slice(0, Math.min(20, northbound.length)).map(d => d.nfAmt || 0)
  const amt5 = amts.slice(0, 5)  // 最近5天
  const amtRest = amts.slice(5)  // 第6~20天（不含最近5天，避免窗口重叠）
  const avg5 = amt5.reduce((a, b) => a + b, 0) / 5
  // 当数据不足15天（除最近5天外 < 10天），退回包含式计算
  const avgRest = amtRest.length >= 10
    ? amtRest.reduce((a, b) => a + b, 0) / amtRest.length
    : (amts.length > 0 ? amts.reduce((a, b) => a + b, 0) / amts.length : 1)
  const ratio = avgRest !== 0 ? avg5 / avgRest : 1
  const changePct = (ratio - 1) * 100
  const latest = northbound[0]?.nfAmt || 0

  // 成交额趋势方向（5 日回归斜率 → 活跃度在增还是减）
  const slope = linearSlope(amt5)
  const trendDir = slope > 0 ? '↑' : slope < 0 ? '↓' : '→'

  // 量价联合分析：提取近 5 日大盘涨跌幅（sciRate/sscRate）
  const recent5 = northbound.slice(0, 5)
  const rates = recent5.map(d => d.sciRate || 0).filter(v => v !== 0)
  const avgRate = rates.length >= 3 ? rates.reduce((a, b) => a + b, 0) / rates.length : null
  const hasRateData = avgRate !== null

  // 放量场景
  if (ratio >= 1.2) {
    const direction = slope > 0 ? '且持续升温' : slope < 0 ? '但有所降温' : ''
    // 量价联合修正：放量+大盘下跌 → 疑似净卖出，翻转为 bear
    if (hasRateData && avgRate < -0.5) {
      return mk('北向资金', `活跃${trendDir} ${fmtAmtWan(latest)}`, 'bear', W_STRONG,
        `近5日均成交${fmtAmtWan(avg5)}，增幅${changePct.toFixed(1)}%，但同期大盘暴跌${avgRate.toFixed(2)}%，疑似净卖出`)
    }
    if (hasRateData && avgRate < -0.2) {
      return mk('北向资金', `活跃${trendDir} ${fmtAmtWan(latest)}`, 'bear', W.northbound,
        `近5日均成交${fmtAmtWan(avg5)}，增幅${changePct.toFixed(1)}%，但同期大盘下跌${avgRate.toFixed(2)}%，疑似净卖出`)
    }
    const rateHint = hasRateData && avgRate > 0.3 ? '，配合大盘强势上涨' : hasRateData && avgRate > 0 ? '，大盘同步上涨' : ''
    return mk('北向资金', `活跃${trendDir} ${fmtAmtWan(latest)}`, 'bull', ratio >= 1.4 ? W_STRONG : W.northbound,
      `近5日均成交${fmtAmtWan(avg5)}，高于20日均${fmtAmtWan(avgRest)}，增幅${changePct.toFixed(1)}%，${direction}${rateHint}`)
  }

  // 缩量场景
  if (ratio <= 0.8) {
    const direction = slope < 0 ? '且持续萎缩' : slope > 0 ? '但有所回暖' : ''
    // 量价联合修正：缩量+大盘大涨 → 北向缺席上涨行情
    if (hasRateData && avgRate > 0.3) {
      return mk('北向资金', `退缩${trendDir} ${fmtAmtWan(latest)}`, 'bear', W.northbound * 0.7,
        `近5日均成交${fmtAmtWan(avg5)}，降幅${Math.abs(changePct).toFixed(1)}%，但同期大盘上涨${avgRate.toFixed(2)}%，北向缺席行情`)
    }
    const rateHint = hasRateData && avgRate < -0.3 ? '，配合大盘走弱' : ''
    return mk('北向资金', `退缩${trendDir} ${fmtAmtWan(latest)}`, 'bear', ratio <= 0.6 ? W_STRONG : W.northbound,
      `近5日均成交${fmtAmtWan(avg5)}，低于20日均${fmtAmtWan(avgRest)}，降幅${Math.abs(changePct).toFixed(1)}%，${direction}${rateHint}`)
  }

  return mk('北向资金', `${fmtAmtWan(latest)}`, 'neutral', W.northbound,
    `近5日均${fmtAmtWan(avg5)}，20日均${fmtAmtWan(avgRest)}，偏差${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`)
}

// ==================== 涨跌停（市场情绪，并行评分 v7.2） ====================
function judgeLimitStats(limitStats) {
  if (!limitStats || (!limitStats.limitUp && !limitStats.limitDown)) {
    return mk('涨跌停', '数据不足', 'neutral', W.limitStats, '')
  }

  const limitUp = limitStats.limitUp || 0
  const limitDown = limitStats.limitDown || 0
  const naturalLimit = limitStats.naturalLimit || 0
  const touchLimit = limitStats.touchLimit || 0
  // sealingRate/moneyEffect 可能是 0-1 或 0-100，统一为百分比
  const sealPct = limitStats.sealingRate >= 2 ? limitStats.sealingRate : Math.round((limitStats.sealingRate || 0) * 100)
  const moneyPct = limitStats.moneyEffect >= 2 ? limitStats.moneyEffect : Math.round((limitStats.moneyEffect || 0) * 100)
  const t1Pct = limitStats.t1PctChange || 0
  const history = limitStats.history || []
  const consecutiveBoards = limitStats.consecutiveBoards || 0
  const maxConsecutiveDays = limitStats.maxConsecutiveDays || 0
  const topSectorConcentration = limitStats.topSectorConcentration || 0
  const sectorDistribution = limitStats.sectorDistribution || []

  // 涨跌停比（limitDown=0 时按涨停量级映射，避免绝对数充当比率）
  const ratio = limitDown > 0
    ? limitUp / limitDown
    : (limitUp >= 30 ? 5 : limitUp >= 10 ? 2.5 : limitUp >= 3 ? 1.5 : 1)

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
  else if (limitDown >= 20) { bearPts += 2; details.push(`跌停${limitDown}家`) }
  else if (limitDown >= 10) { bearPts += 1; details.push(`跌停${limitDown}家`) }

  // 3. 涨停绝对数量 + 封板质量（高量级适当放宽封板率）
  if (limitUp >= 80 && sealPct >= 70)       { bullPts += 3; details.push(`涨停${limitUp}家，封板${sealPct}%`) }
  else if (limitUp >= 80 && sealPct >= 40)  { bullPts += 2; details.push(`涨停${limitUp}家，封板${sealPct}%`) }
  else if (limitUp >= 40 && sealPct >= 50)  { bullPts += 2; details.push(`涨停${limitUp}家，封板${sealPct}%`) }
  else if (limitUp >= 40 && sealPct >= 40)  { bullPts += 1 }
  else if (limitUp >= 30 && sealPct >= 50)  { bullPts += 1 }

  // 4. 赚钱效应（打板次日收益）
  if (t1Pct >= 2)       { bullPts += 1; details.push(`打板次日+${t1Pct.toFixed(1)}%`) }
  else if (t1Pct <= -2) { bearPts += 2; details.push(`打板次日${t1Pct.toFixed(1)}%（追高亏钱）`) }
  else if (t1Pct < -0.5){ bearPts += 1; details.push(`打板次日${t1Pct.toFixed(1)}%`) }

  // 5. 封板率低于40%（大量假突破）
  if (sealPct > 0 && sealPct < 40 && limitUp >= 5) { bearPts += 1; details.push(`封板率仅${sealPct}%`) }

  // 6. 赚钱效应低于30%
  if (moneyPct > 0 && moneyPct < 30) { bearPts += 1; details.push(`赚钱效应仅${moneyPct}%`) }

  // 7. 赚钱效应高于60%（市场赚钱面广）
  if (moneyPct >= 60) { bullPts += 1; details.push(`赚钱效应${moneyPct}%`) }

  // === v7.2 新增子评分 ===

  // 8. 连板统计（连续涨停反映情绪强度）
  if (consecutiveBoards >= 10) { bullPts += 2; details.push(`连板股${consecutiveBoards}只，情绪极强`) }
  else if (consecutiveBoards >= 5) { bullPts += 1; details.push(`连板股${consecutiveBoards}只`) }
  if (maxConsecutiveDays >= 5) { bullPts += 1; details.push(`最高${maxConsecutiveDays}连板`) }

  // 9. 板块集中度（过高 = 板块轮动而非普涨，削弱看多信号）
  let concentrationPenalty = 1.0
  if (topSectorConcentration >= 0.3 && limitUp >= 5 && sectorDistribution.length > 0) {
    concentrationPenalty = 0.6
    details.push(`涨停集中在「${sectorDistribution[0].name}」(${(topSectorConcentration * 100).toFixed(0)}%)，板块轮动非普涨`)
  }

  // 10. 自然涨停率（剔除ST/新股后剩余比例，过低 = 含金量不足）
  let naturalPenalty = 1.0
  if (naturalLimit > 0 && limitUp > 0) {
    const naturalRate = naturalLimit / limitUp
    if (naturalRate < 0.5) {
      naturalPenalty = 0.8
      details.push(`自然涨停率${(naturalRate * 100).toFixed(0)}%（含ST/新股）`)
    }
  }

  // 11. 涨停趋势（近3日均值对比）
  if (history.length >= 3) {
    const avg3 = ((history[0].limitUp || 0) + (history[1].limitUp || 0) + (history[2].limitUp || 0)) / 3
    if (avg3 > 0 && limitUp >= avg3 * 2) {
      bullPts += 1; details.push(`涨停家数倍增(均${avg3.toFixed(0)}→${limitUp})`)
    } else if (avg3 > 0 && limitUp <= avg3 * 0.3) {
      bearPts += 1; details.push(`涨停家数骤减(均${avg3.toFixed(0)}→${limitUp})`)
    }
  }

  // === 汇总判定（含惩罚系数，双向削弱使信号向中性回归） ===
  let net = bullPts - bearPts
  // 板块集中度过高 → 信号质量不足，将 |net| 往 0 方向压缩
  if (concentrationPenalty < 1.0) net = Math.round(net * concentrationPenalty)
  // 自然涨停率过低 → 含金量不足，同样双向压缩
  if (naturalPenalty < 1.0) net = Math.round(net * naturalPenalty)

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

// ==================== 综合判定（加权评分 + 增强状态惯性 v7.1） ====================
const BULL_SET = new Set(['bull', 'bull-lean'])
const BEAR_SET = new Set(['bear', 'bear-lean'])
const CROSS_DIR_THRESHOLD = 1.5   // 跨方向翻转阈值（旧 1.0 → 新 1.5）
const NEUTRAL_THRESHOLD = 1.5     // 进出中性阈值（不变）
const COOLDOWN_DAYS = 3            // 跨方向翻转冷却期（日历日）
const CONFIRM_DAYS = 2             // 跨方向翻转连续确认天数

function determineStatus(bullW, bearW, prevState, todayStr) {
  const net = bullW - bearW
  const prevStatus = prevState?.status || null

  // 计算原始状态（阈值不变）
  let raw
  if (bullW >= 4.5 && net > 0) raw = 'bull'
  else if (bearW >= 4.5 && net < 0) raw = 'bear'
  else if (bullW >= 3.0 && net > 0) raw = 'bull-lean'
  else if (bearW >= 3.0 && net < 0) raw = 'bear-lean'
  else raw = 'neutral'

  // 默认返回值
  let finalStatus = raw
  let crossCount = 0
  let lastFlipDate = prevState?.lastFlipDate || null

  // 无前状态或状态相同 → 直接返回
  if (!prevStatus || prevStatus === raw) {
    return { status: finalStatus, crossCount: 0, lastFlipDate }
  }

  // 同方向调整（bull↔bull-lean, bear↔bear-lean）自由切换
  if (BULL_SET.has(prevStatus) && BULL_SET.has(raw)) {
    return { status: finalStatus, crossCount: 0, lastFlipDate }
  }
  if (BEAR_SET.has(prevStatus) && BEAR_SET.has(raw)) {
    return { status: finalStatus, crossCount: 0, lastFlipDate }
  }

  // 跨方向反转（多↔空）：需要阈值 + 连续确认 + 冷却期
  // 包括：牛→熊、熊→牛、中性→极端（neutral→bull/bear 也需保护）
  const prevIsBull = BULL_SET.has(prevStatus)
  const prevIsBear = BEAR_SET.has(prevStatus)
  const prevIsNeutral = prevStatus === 'neutral'
  const rawIsBull = BULL_SET.has(raw)
  const rawIsBear = BEAR_SET.has(raw)

  const isCrossDir = (prevIsBull && rawIsBear) || (prevIsBear && rawIsBull)
  // neutral → 极端方向视为跨方向翻转（需冷却期和确认）
  const isNeutralToExtreme = prevIsNeutral && (rawIsBull || rawIsBear)

  if (isCrossDir || isNeutralToExtreme) {
    // 冷却期检查
    if (lastFlipDate && todayStr) {
      const flipDate = new Date(lastFlipDate)
      const today = new Date(todayStr)
      const daysDiff = Math.floor((today - flipDate) / (86400 * 1000))
      if (daysDiff < COOLDOWN_DAYS) {
        return { status: prevStatus, crossCount: 0, lastFlipDate }
      }
    }

    // 阈值检查
    if (Math.abs(net) < CROSS_DIR_THRESHOLD) {
      return { status: prevStatus, crossCount: 0, lastFlipDate }
    }

    // 连续确认：需要连续 CONFIRM_DAYS 天满足条件
    const newCrossCount = (prevState?.crossCount || 0) + 1
    if (newCrossCount < CONFIRM_DAYS) {
      return { status: prevStatus, crossCount: newCrossCount, lastFlipDate }
    }

    // 确认天数达标 → 允许翻转，记录翻转日期
    return { status: finalStatus, crossCount: 0, lastFlipDate: todayStr || null }
  }

  // 极端方向 → 中性：只需 |net| ≥ 1.5 即可进入中性（宽松）
  if ((prevIsBull || prevIsBear) && raw === 'neutral') {
    if (Math.abs(net) < NEUTRAL_THRESHOLD) {
      return { status: prevStatus, crossCount: 0, lastFlipDate }
    }
    return { status: finalStatus, crossCount: 0, lastFlipDate }
  }

  return { status: finalStatus, crossCount: 0, lastFlipDate }
}

function checkLongWindow(quote, ma, klines, breadth) {
  const conditions = []
  const close = quote?.close || 0
  const ma60 = ma?.ma60 || 0
  const cond1 = close > ma60
  conditions.push({ label: `指数收盘价(${close.toFixed(0)}) > MA60(${ma60.toFixed(0)})`, pass: cond1 })

  let cond2 = false
  // 需要至少 62 根 K 线才能计算 3 天前的 MA60（62 = 60 + 2 天偏移）
  if (klines.length >= 62) {
    const closes = klines.map(k => k.close)
    const ma60_3days = []
    for (let i = 0; i < 3; i++) {
      const end = closes.length - (2 - i)  // 从后往前取：latest, -1, -2
      const start = end - 60
      if (start >= 0) {
        ma60_3days.push(closes.slice(start, end).reduce((a, b) => a + b, 0) / (end - start))
      } else {
        // 数据不足以计算这一天的 MA60
        break
      }
    }
    cond2 = ma60_3days.length === 3 && ma60_3days[2] > ma60_3days[1] && ma60_3days[1] > ma60_3days[0]
  }
  conditions.push({ label: 'MA60连续3日拐头向上', pass: cond2 })

  const cond3 = breadth && breadth.up && breadth.down ? (breadth.up / breadth.down >= 1.8) : false
  conditions.push({ label: `涨跌比 ≥ 1.8 (当前${breadth?.up && breadth?.down ? (breadth.up / breadth.down).toFixed(1) : '?'})`, pass: cond3 })

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
