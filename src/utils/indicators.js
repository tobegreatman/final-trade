/**
 * 技术指标计算引擎 — 个股分析 v2
 * 修复: RSI Wilder平滑, 背离波峰波谷匹配, KDJ超买超卖
 */

// ==================== MA 均线（滑动窗口优化） ====================
export function calcMA(closes, periods = [5, 10, 20, 60]) {
  const result = {}
  for (const p of periods) {
    const arr = new Array(closes.length).fill(null)
    if (closes.length < p) { result[p] = arr; continue }
    let sum = 0
    for (let i = 0; i < p - 1; i++) sum += closes[i]
    for (let i = p - 1; i < closes.length; i++) {
      sum += closes[i]
      arr[i] = sum / p
      sum -= closes[i - p + 1]
    }
    result[p] = arr
  }
  return result
}

// ==================== MACD ====================
export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const ema = (data, period) => {
    const k = 2 / (period + 1)
    const arr = [data[0]]
    for (let i = 1; i < data.length; i++) {
      arr.push(data[i] * k + arr[i - 1] * (1 - k))
    }
    return arr
  }

  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = emaFast.map((v, i) => v - emaSlow[i])
  const dea = ema(dif, signal)
  const histogram = dif.map((v, i) => v - dea[i])

  return { dif, dea, histogram }
}

// ==================== KDJ ====================
export function calcKDJ(klines, n = 9) {
  const K = [], D = [], J = []
  let prevK = 50, prevD = 50

  for (let i = 0; i < klines.length; i++) {
    const start = Math.max(0, i - n + 1)
    let highest = -Infinity, lowest = Infinity
    for (let j = start; j <= i; j++) {
      if (klines[j].high > highest) highest = klines[j].high
      if (klines[j].low < lowest) lowest = klines[j].low
    }
    const range = highest - lowest
    const rsv = range === 0 ? 50 : ((klines[i].close - lowest) / range) * 100

    const k = 2 / 3 * prevK + 1 / 3 * rsv
    const d = 2 / 3 * prevD + 1 / 3 * k
    const j = 3 * k - 2 * d

    K.push(k)
    D.push(d)
    J.push(j)
    prevK = k
    prevD = d
  }

  return { k: K, d: D, j: J }
}

// ==================== RSI (Wilder 平滑) ====================
export function calcRSI(closes, periods = [6, 12, 24]) {
  const result = {}

  for (const period of periods) {
    const arr = []
    if (closes.length < period + 1) {
      for (let i = 0; i < closes.length; i++) arr.push(null)
      result[period] = arr
      continue
    }

    // 初始平均：前 period 个变化值的简单平均
    let avgGain = 0, avgLoss = 0
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1]
      if (diff > 0) avgGain += diff
      else avgLoss -= diff
    }
    avgGain /= period
    avgLoss /= period

    // 前面填 null
    for (let i = 0; i < period; i++) arr.push(null)

    // 第一个 RSI
    const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss
    arr.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0))

    // 后续用 Wilder 平滑
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1]
      const gain = diff > 0 ? diff : 0
      const loss = diff < 0 ? -diff : 0
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
      arr.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs))
    }

    result[period] = arr
  }

  return result
}

// ==================== BOLL 布林带 ====================
export function calcBOLL(closes, period = 20, mult = 2) {
  const mid = [], upper = [], lower = []

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      mid.push(null)
      upper.push(null)
      lower.push(null)
      continue
    }

    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    const ma = sum / period

    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - ma) ** 2
    const std = Math.sqrt(sqSum / (period - 1))

    mid.push(ma)
    upper.push(ma + mult * std)
    lower.push(ma - mult * std)
  }

  return { mid, upper, lower }
}

// ==================== 信号生成 ====================

function generateMASignals(klines, ma) {
  const signals = []
  const len = klines.length
  if (len < 60) return signals

  const ma5 = ma[5], ma10 = ma[10], ma20 = ma[20], ma60 = ma[60]
  const last = len - 1

  // 多头/空头排列
  if (ma5[last] && ma10[last] && ma20[last] && ma60[last]) {
    if (ma5[last] > ma10[last] && ma10[last] > ma20[last] && ma20[last] > ma60[last]) {
      signals.push({ type: 'bullish', source: 'MA', text: '均线多头排列' })
    } else if (ma5[last] < ma10[last] && ma10[last] < ma20[last] && ma20[last] < ma60[last]) {
      signals.push({ type: 'bearish', source: 'MA', text: '均线空头排列' })
    }
  }

  // 交叉检测辅助：检测 [prev, curr] 是否穿越
  function detectCross(shortArr, longArr, name, lookback) {
    for (let i = last; i > last - lookback && i > 1; i--) {
      if (shortArr[i] == null || longArr[i] == null || shortArr[i - 1] == null || longArr[i - 1] == null) continue
      if (shortArr[i - 1] <= longArr[i - 1] && shortArr[i] > longArr[i]) {
        signals.push({ type: 'bullish', source: 'MA', text: `${name}金叉 (${klines[i].date})` })
        return true
      }
      if (shortArr[i - 1] >= longArr[i - 1] && shortArr[i] < longArr[i]) {
        signals.push({ type: 'bearish', source: 'MA', text: `${name}死叉 (${klines[i].date})` })
        return true
      }
    }
    return false
  }

  // MA20/MA60 交叉（长线趋势，10 日窗口）
  detectCross(ma20, ma60, 'MA20/60', 10)
  // MA10/MA20 交叉（中线趋势，7 日窗口）
  detectCross(ma10, ma20, 'MA10/20', 7)
  // MA5/MA10 交叉（短线，5 日窗口）
  detectCross(ma5, ma10, 'MA5/10', 5)

  return signals
}

/**
 * 波峰波谷检测：寻找局部极值点
 * 返回 [{ index, value, type: 'peak'|'trough' }]
 */
function findPeaksAndTroughs(data, lookback = 5) {
  const points = []
  for (let i = lookback; i < data.length - lookback; i++) {
    if (data[i] == null) continue
    let isPeak = true, isTrough = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i || data[j] == null) continue
      if (data[j] > data[i]) isPeak = false
      if (data[j] < data[i]) isTrough = false
    }
    if (isPeak) points.push({ index: i, value: data[i], type: 'peak' })
    else if (isTrough) points.push({ index: i, value: data[i], type: 'trough' })
  }
  return points
}

function generateMACDSignals(closes, macd) {
  const signals = []
  const len = closes.length
  if (len < 35) return signals

  const { dif, dea } = macd
  const last = len - 1

  // 金叉/死叉
  for (let i = last; i > last - 5 && i > 1; i--) {
    if (dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]) {
      signals.push({ type: 'bullish', source: 'MACD', text: `MACD金叉 (${dif[i] > 0 ? '零轴上方' : '零轴下方'})` })
      break
    }
    if (dif[i - 1] >= dea[i - 1] && dif[i] < dea[i]) {
      signals.push({ type: 'bearish', source: 'MACD', text: `MACD死叉 (${dif[i] > 0 ? '零轴上方' : '零轴下方'})` })
      break
    }
  }

  // 背离检测（波峰波谷匹配，近 60 日内）
  if (len >= 60) {
    const recentN = Math.min(60, len)
    const recentCloses = closes.slice(-recentN)
    const recentDif = macd.dif.slice(-recentN)

    const pricePoints = findPeaksAndTroughs(recentCloses, 3)
    const difPoints = findPeaksAndTroughs(recentDif, 3)

    // 顶背离：找两个相邻的价格波峰，后峰价格更高但对应 DIF 峰更低
    const peaks = pricePoints.filter(p => p.type === 'peak')
    const difPeaks = difPoints.filter(p => p.type === 'peak')

    if (peaks.length >= 2) {
      const p1 = peaks[peaks.length - 2]
      const p2 = peaks[peaks.length - 1]
      if (p2.value > p1.value) {
        // 价格创新高，找对应位置的 DIF 峰
        const dp1 = difPeaks.find(m => Math.abs(m.index - p1.index) <= 5)
        const dp2 = difPeaks.find(m => Math.abs(m.index - p2.index) <= 5)
        if (dp1 && dp2 && dp2.value < dp1.value) {
          signals.push({ type: 'bearish', source: 'MACD', text: '顶背离信号' })
        }
      }
    }

    // 底背离：找两个相邻的价格波谷，后谷价格更低但对应 DIF 谷更高
    const troughs = pricePoints.filter(p => p.type === 'trough')
    const difTroughs = difPoints.filter(p => p.type === 'trough')

    if (troughs.length >= 2) {
      const t1 = troughs[troughs.length - 2]
      const t2 = troughs[troughs.length - 1]
      if (t2.value < t1.value) {
        const dt1 = difTroughs.find(m => Math.abs(m.index - t1.index) <= 5)
        const dt2 = difTroughs.find(m => Math.abs(m.index - t2.index) <= 5)
        if (dt1 && dt2 && dt2.value > dt1.value) {
          signals.push({ type: 'bullish', source: 'MACD', text: '底背离信号' })
        }
      }
    }
  }

  return signals
}

function generateKDJSignals(kdj, closes) {
  const signals = []
  const len = kdj.j.length
  if (len < 2) return signals

  const last = len - 1
  const j = kdj.j[last]
  const k = kdj.k[last]
  const d = kdj.d[last]

  // 极端信号（互斥，取最强）
  if (j < 0) {
    signals.push({ type: 'bullish', source: 'KDJ', text: `KDJ超卖 (J=${j.toFixed(1)})` })
  } else if (k > 80 && d > 80) {
    signals.push({ type: 'bearish', source: 'KDJ', text: `K/D超买区 (K=${k.toFixed(1)}, D=${d.toFixed(1)})` })
  } else if (k < 20 && d < 20) {
    signals.push({ type: 'bullish', source: 'KDJ', text: `K/D超卖区 (K=${k.toFixed(1)}, D=${d.toFixed(1)})` })
  } else if (j > 100) {
    // J>100 在非超买区（K/D 未同时 >80）时为中性偏强，不判为空头
    signals.push({ type: 'neutral', source: 'KDJ', text: `J值偏高 (J=${j.toFixed(1)})` })
  }

  // K/D 金叉/死叉（位置感知）
  for (let i = last; i > last - 5 && i > 1; i--) {
    if (kdj.k[i - 1] <= kdj.d[i - 1] && kdj.k[i] > kdj.d[i]) {
      const crossK = kdj.k[i]
      if (crossK < 30) {
        signals.push({ type: 'bullish', source: 'KDJ', text: `K/D低位金叉 (K=${crossK.toFixed(0)})` })
      } else if (crossK < 70) {
        signals.push({ type: 'bullish', source: 'KDJ', text: 'K/D金叉' })
      }
      // K > 70 的金叉可靠性低，不产生信号
      break
    }
    if (kdj.k[i - 1] >= kdj.d[i - 1] && kdj.k[i] < kdj.d[i]) {
      const crossK = kdj.k[i]
      if (crossK > 70) {
        signals.push({ type: 'bearish', source: 'KDJ', text: `K/D高位死叉 (K=${crossK.toFixed(0)})` })
      } else if (crossK > 30) {
        signals.push({ type: 'bearish', source: 'KDJ', text: 'K/D死叉' })
      }
      // K < 30 的死叉可靠性低，不产生信号
      break
    }
  }

  // KDJ 背离检测（近 60 日内）
  if (closes.length >= 60 && len >= 60) {
    const recentN = Math.min(60, closes.length)
    const recentCloses = closes.slice(-recentN)
    const recentK = kdj.k.slice(-recentN)

    const pricePoints = findPeaksAndTroughs(recentCloses, 3)
    const kPoints = findPeaksAndTroughs(recentK, 3)

    // 顶背离：价格创新高但 K 值不创新高
    const peaks = pricePoints.filter(p => p.type === 'peak')
    const kPeaks = kPoints.filter(p => p.type === 'peak')
    if (peaks.length >= 2) {
      const p1 = peaks[peaks.length - 2]
      const p2 = peaks[peaks.length - 1]
      if (p2.value > p1.value) {
        const kp1 = kPeaks.find(m => Math.abs(m.index - p1.index) <= 5)
        const kp2 = kPeaks.find(m => Math.abs(m.index - p2.index) <= 5)
        if (kp1 && kp2 && kp2.value < kp1.value) {
          signals.push({ type: 'bearish', source: 'KDJ', text: 'KDJ顶背离' })
        }
      }
    }

    // 底背离：价格创新低但 K 值不创新低
    const troughs = pricePoints.filter(p => p.type === 'trough')
    const kTroughs = kPoints.filter(p => p.type === 'trough')
    if (troughs.length >= 2) {
      const t1 = troughs[troughs.length - 2]
      const t2 = troughs[troughs.length - 1]
      if (t2.value < t1.value) {
        const kt1 = kTroughs.find(m => Math.abs(m.index - t1.index) <= 5)
        const kt2 = kTroughs.find(m => Math.abs(m.index - t2.index) <= 5)
        if (kt1 && kt2 && kt2.value > kt1.value) {
          signals.push({ type: 'bullish', source: 'KDJ', text: 'KDJ底背离' })
        }
      }
    }
  }

  return signals
}

function generateRSISignals(rsi, closes) {
  const signals = []
  const rsi6 = rsi[6]
  const rsi12 = rsi[12]
  const rsi24 = rsi[24]
  if (!rsi6 || rsi6.length < 2) return signals

  const last = rsi6.length - 1
  const val6 = rsi6[last]
  const val12 = rsi12?.[last]
  const val24 = rsi24?.[last]

  // 1. RSI(6/24) cross — 5-day lookback window
  let hasGoldenCross = false
  let hasDeathCross = false
  if (rsi24?.length >= 2) {
    const crossWindow = 5
    for (let i = last; i > last - crossWindow && i > 0; i--) {
      if (rsi6[i - 1] != null && rsi24[i - 1] != null && rsi6[i] != null && rsi24[i] != null) {
        if (rsi6[i - 1] <= rsi24[i - 1] && rsi6[i] > rsi24[i]) {
          signals.push({ type: 'bullish', source: 'RSI', text: 'RSI(6/24)金叉，短期转强' })
          hasGoldenCross = true
          break
        }
        if (rsi6[i - 1] >= rsi24[i - 1] && rsi6[i] < rsi24[i]) {
          signals.push({ type: 'bearish', source: 'RSI', text: 'RSI(6/24)死叉，短期转弱' })
          hasDeathCross = true
          break
        }
      }
    }
  }

  // 2. RSI(6) 超买超卖 — 长周期上下文感知
  // 金叉期间跳过超买信号（趋势启动时RSI6常短暂超买，不构成看空依据）
  if (!hasGoldenCross) {
    if (val6 > 80) {
      if (val12 != null && val24 != null && val12 < 65 && val24 < 60) {
        signals.push({ type: 'neutral', source: 'RSI', text: `RSI(6)超买但中长周期未确认 (${val6.toFixed(1)})` })
      } else {
        signals.push({ type: 'bearish', source: 'RSI', text: `RSI(6)严重超买 (${val6.toFixed(1)})` })
      }
    } else if (val6 > 70) {
      if (val12 != null && val24 != null && val12 < 65 && val24 < 60) {
        signals.push({ type: 'neutral', source: 'RSI', text: `RSI(6)超买但中长周期未确认 (${val6.toFixed(1)})` })
      } else {
        signals.push({ type: 'bearish', source: 'RSI', text: `RSI(6)超买 (${val6.toFixed(1)})` })
      }
    }
  }
  // 死叉期间跳过超卖信号（下跌加速时超卖不构成反弹依据）
  if (!hasDeathCross) {
    if (val6 < 20) signals.push({ type: 'bullish', source: 'RSI', text: `RSI(6)严重超卖 (${val6.toFixed(1)})` })
    else if (val6 < 30) signals.push({ type: 'bullish', source: 'RSI', text: `RSI(6)超卖 (${val6.toFixed(1)})` })
  }

  // 3. 多周期共振：RSI6/12/24 全部超买或全部超卖
  // 金叉/死叉期间跳过共振信号，避免与趋势方向矛盾
  if (val6 != null && val12 != null && val24 != null && !hasGoldenCross && !hasDeathCross) {
    if (val6 > 70 && val12 > 65 && val24 > 60) {
      signals.push({ type: 'bearish', source: 'RSI', text: 'RSI多周期共振超买' })
    } else if (val6 < 30 && val12 < 35 && val24 < 40) {
      signals.push({ type: 'bullish', source: 'RSI', text: 'RSI多周期共振超卖' })
    }
  }

  // 4. RSI 背离检测（近 60 日内，与 MACD 背离逻辑一致）
  if (closes.length >= 60 && rsi6.length >= 60) {
    const recentN = Math.min(60, closes.length)
    const recentCloses = closes.slice(-recentN)
    const recentRsi = rsi6.slice(-recentN)

    const pricePoints = findPeaksAndTroughs(recentCloses, 3)
    const rsiPoints = findPeaksAndTroughs(recentRsi, 3)

    // 顶背离：价格创新高但 RSI 不创新高
    const peaks = pricePoints.filter(p => p.type === 'peak')
    const rsiPeaks = rsiPoints.filter(p => p.type === 'peak')
    if (peaks.length >= 2) {
      const p1 = peaks[peaks.length - 2]
      const p2 = peaks[peaks.length - 1]
      if (p2.value > p1.value) {
        const rp1 = rsiPeaks.find(m => Math.abs(m.index - p1.index) <= 5)
        const rp2 = rsiPeaks.find(m => Math.abs(m.index - p2.index) <= 5)
        if (rp1 && rp2 && rp2.value < rp1.value) {
          signals.push({ type: 'bearish', source: 'RSI', text: 'RSI顶背离' })
        }
      }
    }

    // 底背离：价格创新低但 RSI 不创新低
    const troughs = pricePoints.filter(p => p.type === 'trough')
    const rsiTroughs = rsiPoints.filter(p => p.type === 'trough')
    if (troughs.length >= 2) {
      const t1 = troughs[troughs.length - 2]
      const t2 = troughs[troughs.length - 1]
      if (t2.value < t1.value) {
        const rt1 = rsiTroughs.find(m => Math.abs(m.index - t1.index) <= 5)
        const rt2 = rsiTroughs.find(m => Math.abs(m.index - t2.index) <= 5)
        if (rt1 && rt2 && rt2.value > rt1.value) {
          signals.push({ type: 'bullish', source: 'RSI', text: 'RSI底背离' })
        }
      }
    }
  }

  // 5. 如果没有特殊信号，给出正常区间描述
  if (!signals.length) {
    signals.push({ type: 'neutral', source: 'RSI', text: `RSI正常区间 (6=${val6.toFixed(1)})` })
  }

  return signals
}

function generateBOLLSignals(closes, boll) {
  const signals = []
  const len = closes.length
  if (len < 20) return signals

  const last = len - 1
  const price = closes[last]
  const upper = boll.upper[last]
  const mid = boll.mid[last]
  const lower = boll.lower[last]

  if (upper == null || mid == null || lower == null) return signals

  // MA20 趋势方向：近 5 日价格变化判断短期趋势
  const ma20TrendUp = len >= 25 && closes[last] > closes[last - 5]

  // 1. 突破/跌破布林带（价格在带外）
  if (price > upper) {
    if (ma20TrendUp) {
      signals.push({ type: 'bullish', source: 'BOLL', text: '突破布林上轨，趋势加速' })
    } else {
      signals.push({ type: 'neutral', source: 'BOLL', text: '突破布林上轨，持续性待确认' })
    }
  } else if (price < lower) {
    if (!ma20TrendUp) {
      signals.push({ type: 'bearish', source: 'BOLL', text: '跌破布林下轨，趋势加速' })
    } else {
      signals.push({ type: 'neutral', source: 'BOLL', text: '跌破布林下轨，或为假跌破' })
    }
  }
  // 2. 触及上/下轨（接近但未突破）
  else if (price >= upper * 0.98) {
    if (ma20TrendUp) {
      signals.push({ type: 'neutral', source: 'BOLL', text: '沿布林上轨运行，趋势偏强' })
    } else {
      signals.push({ type: 'bearish', source: 'BOLL', text: '触及布林上轨，超买预警' })
    }
  } else if (price <= lower * 1.02) {
    if (!ma20TrendUp) {
      signals.push({ type: 'neutral', source: 'BOLL', text: '沿布林下轨运行，趋势偏弱' })
    } else {
      signals.push({ type: 'bullish', source: 'BOLL', text: '触及布林下轨，超卖反弹' })
    }
  }
  // 3. 中轨位置
  else if (price > mid) {
    signals.push({ type: 'neutral', source: 'BOLL', text: '布林中轨上方' })
  } else {
    signals.push({ type: 'neutral', source: 'BOLL', text: '布林中轨下方' })
  }

  // 4. 收口信号（带宽收窄）
  if (len >= 40) {
    const prevUpper = boll.upper[last - 20]
    const prevLower = boll.lower[last - 20]
    if (prevUpper != null && prevLower != null) {
      const prevWidth = (prevUpper - prevLower) / prevLower * 100
      const currWidth = (upper - lower) / lower * 100
      if (currWidth < prevWidth * 0.6) {
        signals.push({ type: 'neutral', source: 'BOLL', text: '布林带收口（变盘预警）' })
      }
    }
  }

  return signals
}

function generateVolumeSignals(klines) {
  const signals = []
  const len = klines.length
  if (len < 10) return signals

  const last = len - 1
  const vol = klines[last].volume
  const avgVol5 = klines.slice(-6, -1).reduce((s, k) => s + k.volume, 0) / 5
  const ratio = avgVol5 > 0 ? vol / avgVol5 : 1

  // MA20 趋势方向：近 5 日收盘价变化
  const ma20TrendUp = len >= 25 && klines[last].close > klines[last - 5].close

  // 单日异动
  if (ratio > 2 && klines[last].changePercent > 0) {
    signals.push({ type: 'bullish', source: '量价', text: '放量上涨' })
  } else if (ratio > 2 && klines[last].changePercent < 0) {
    signals.push({ type: 'bearish', source: '量价', text: '放量下跌' })
  } else if (ratio < 0.5 && klines[last].changePercent < 0) {
    if (ma20TrendUp) {
      signals.push({ type: 'bullish', source: '量价', text: '缩量回调（洗盘）' })
    } else {
      signals.push({ type: 'bearish', source: '量价', text: '缩量下跌（无量阴跌）' })
    }
  } else if (ratio > 0.8 && ratio < 1.2) {
    signals.push({ type: 'neutral', source: '量价', text: '量价配合良好' })
  }

  // 连续 3 日量价趋势检测
  if (len >= 8) {
    const recent3 = klines.slice(-3)
    const prev5 = klines.slice(-8, -3)
    const avgPrev = prev5.reduce((s, k) => s + k.volume, 0) / prev5.length

    const allAbove = recent3.every(k => k.volume > avgPrev)
    const allBelow = recent3.every(k => k.volume < avgPrev)

    const upDays = recent3.filter(k => k.changePercent > 0).length
    const downDays = recent3.filter(k => k.changePercent < 0).length

    if (allAbove && upDays >= 2) {
      signals.push({ type: 'bullish', source: '量价', text: '连续放量上涨' })
    } else if (allAbove && downDays >= 2) {
      signals.push({ type: 'bearish', source: '量价', text: '连续放量下跌' })
    } else if (allBelow && upDays >= 2) {
      signals.push({ type: 'bearish', source: '量价', text: '连续缩量上涨（动力不足）' })
    } else if (allBelow && downDays >= 2) {
      if (ma20TrendUp) {
        signals.push({ type: 'neutral', source: '量价', text: '连续缩量调整（洗盘）' })
      } else {
        signals.push({ type: 'bearish', source: '量价', text: '连续缩量下跌（弱势延续）' })
      }
    }
  }

  return signals
}

// ==================== 入口：一次计算全部指标+信号 ====================

export function calcAllIndicators(klines) {
  if (!klines || klines.length < 2) return { ma: {}, macd: { dif: [], dea: [], histogram: [] }, kdj: { k: [], d: [], j: [] }, rsi: {}, boll: { mid: [], upper: [], lower: [] }, signals: [] }

  const closes = klines.map(k => k.close)

  const ma = calcMA(closes)
  const macd = calcMACD(closes)
  const kdj = calcKDJ(klines)
  const rsi = calcRSI(closes)
  const boll = calcBOLL(closes)

  // 计算 changePercent（不修改原始 klines，构建带变化率的副本）
  const klinesWithChg = klines.map((k, i) => {
    if (k.changePercent != null) return k
    if (i === 0 || !klines[i - 1].close) return k
    return { ...k, changePercent: (k.close - klines[i - 1].close) / klines[i - 1].close * 100 }
  })

  const signals = [
    ...generateMASignals(klines, ma),
    ...generateMACDSignals(closes, macd),
    ...generateKDJSignals(kdj, closes),
    ...generateRSISignals(rsi, closes),
    ...generateBOLLSignals(closes, boll),
    ...generateVolumeSignals(klinesWithChg),
  ]

  return { ma, macd, kdj, rsi, boll, signals }
}
