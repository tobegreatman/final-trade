/**
 * 共享背离检测模块（v7.1 增强）
 * 从 marketJudge.js 抽取，供 indicators.js 和 marketJudge.js 共用
 * 特性：多尺度极值检测 + 幅度过滤 + 时间衰减 + 置信度评分
 */

// ==================== 波动率辅助 ====================

/**
 * 计算波动率度量（最近 period 根 bar 的日均绝对变动）
 * @param {number[]} closes - 收盘价序列
 * @param {number} period - 回望周期
 * @returns {number} 日均绝对变动
 */
export function calcVolatilityMeasure(closes, period = 14) {
  if (closes.length < period + 1) return 0
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += Math.abs(closes[i] - closes[i - 1])
  }
  return sum / period
}

// ==================== 多尺度极值检测 ====================

/**
 * 合并一组重叠极值候选：取最极端值，score = 检测到该极值的窗口数 / 总窗口数
 * @param {Array<{idx:number,val:number,window:number}>} group - 重叠极值组
 * @param {'min'|'max'} type - 极值类型
 * @param {number} totalWindows - 总窗口数
 * @returns {{ idx: number, val: number, score: number }}
 */
function mergeExtremaGroup(group, type, totalWindows) {
  let best = group[0]
  for (let i = 1; i < group.length; i++) {
    if (type === 'min' && group[i].val < best.val) best = group[i]
    if (type === 'max' && group[i].val > best.val) best = group[i]
  }

  const nearbyIdx = new Set()
  for (const c of group) {
    if (Math.abs(c.idx - best.idx) <= 1) nearbyIdx.add(c.window)
  }
  for (const c of group) {
    if (c.idx === best.idx) nearbyIdx.add(c.window)
  }

  return {
    idx: best.idx,
    val: best.val,
    score: Math.max(1, nearbyIdx.size) / totalWindows
  }
}

/**
 * 多尺度极值检测
 * 使用多种窗口大小扫描极值，合并重叠区域，计算置信分数
 * @param {number[]} arr - 数据序列
 * @param {'min'|'max'} type - 极值类型
 * @param {number[]} windows - 半窗口大小列表，默认 [2, 3, 5]
 * @returns {{ idx: number, val: number, score: number }[]}
 */
export function findLocalExtremaMultiScale(arr, type, windows = [2, 3, 5]) {
  const maxW = Math.max(...windows)
  const allCandidates = []

  for (const w of windows) {
    for (let i = w; i < arr.length - w; i++) {
      let isExtreme = true
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue
        if (type === 'min' && arr[j] < arr[i]) { isExtreme = false; break }
        if (type === 'max' && arr[j] > arr[i]) { isExtreme = false; break }
      }
      if (isExtreme) {
        allCandidates.push({ idx: i, val: arr[i], window: w })
      }
    }
  }

  if (allCandidates.length === 0) return []

  allCandidates.sort((a, b) => a.idx - b.idx)

  const merged = []
  let group = [allCandidates[0]]

  for (let i = 1; i < allCandidates.length; i++) {
    if (allCandidates[i].idx - group[group.length - 1].idx <= maxW) {
      group.push(allCandidates[i])
    } else {
      merged.push(mergeExtremaGroup(group, type, windows.length))
      group = [allCandidates[i]]
    }
  }
  merged.push(mergeExtremaGroup(group, type, windows.length))

  // 最小间距过滤：相邻极值间距 < 3 时保留更极端的
  const filtered = [merged[0]]
  for (let i = 1; i < merged.length; i++) {
    const prev = filtered[filtered.length - 1]
    if (merged[i].idx - prev.idx < 3) {
      const keepOld = type === 'min' ? prev.val <= merged[i].val : prev.val >= merged[i].val
      if (!keepOld) filtered[filtered.length - 1] = merged[i]
    } else {
      filtered.push(merged[i])
    }
  }

  return filtered
}

// ==================== 增强背离检测 ====================

/** 幅度过滤阈值：两极值间价格变化需达到日均波动的倍数 */
export const AMPLITUDE_FACTOR = 0.5
/** 时间衰减系数：半衰期 ~14 bar */
export const TIME_DECAY_LAMBDA = 0.05

/**
 * 增强背离检测（多尺度 + 幅度过滤 + 时间衰减）
 * @param {number[]} prices - 价格序列（与指标等长且时间对齐）
 * @param {number[]} indicator - 指标序列
 * @param {object} [opts] - 可选参数
 * @param {number} [opts.volatilityPeriod=14] - 波动率计算周期
 * @returns {{ type: 'bullish'|'bearish', confidence: number } | null}
 */
export function detectDivergenceV2(prices, indicator, opts = {}) {
  if (prices.length < 10 || indicator.length < 10) return null
  const len = Math.min(prices.length, indicator.length)
  if (len < 10) return null
  const p = prices.slice(-len)
  const ind = indicator.slice(-len)

  const volatilityPeriod = opts.volatilityPeriod || Math.min(14, len - 1)
  const volatility = calcVolatilityMeasure(p, volatilityPeriod)

  const pMins = findLocalExtremaMultiScale(p, 'min')
  const pMaxs = findLocalExtremaMultiScale(p, 'max')

  // 底背离：价格更低 + 指标更高
  if (pMins.length >= 2) {
    const a = pMins[pMins.length - 2], b = pMins[pMins.length - 1]
    const priceSwing = Math.abs(b.val - a.val)
    if (b.val < a.val && ind[b.idx] > ind[a.idx]) {
      if (volatility > 0 && priceSwing >= volatility * AMPLITUDE_FACTOR) {
        const extremaScore = (a.score + b.score) / 2
        const ampFactor = Math.min(1.0, priceSwing / volatility)
        const barsSince = (len - 1) - b.idx
        const timeDecay = Math.exp(-TIME_DECAY_LAMBDA * barsSince)
        const confidence = Math.max(0.1, Math.min(1.0, extremaScore * ampFactor * timeDecay))
        return { type: 'bullish', confidence }
      }
    }
  }

  // 顶背离：价格更高 + 指标更低
  if (pMaxs.length >= 2) {
    const a = pMaxs[pMaxs.length - 2], b = pMaxs[pMaxs.length - 1]
    const priceSwing = Math.abs(b.val - a.val)
    if (b.val > a.val && ind[b.idx] < ind[a.idx]) {
      if (volatility > 0 && priceSwing >= volatility * AMPLITUDE_FACTOR) {
        const extremaScore = (a.score + b.score) / 2
        const ampFactor = Math.min(1.0, priceSwing / volatility)
        const barsSince = (len - 1) - b.idx
        const timeDecay = Math.exp(-TIME_DECAY_LAMBDA * barsSince)
        const confidence = Math.max(0.1, Math.min(1.0, extremaScore * ampFactor * timeDecay))
        return { type: 'bearish', confidence }
      }
    }
  }

  return null
}

/**
 * 个股背离检测适配器
 * 将增强背离检测的结果转换为 indicators.js 的信号格式
 * @param {number[]} prices - 价格序列（最近 60 bar）
 * @param {number[]} indicator - 指标序列（与 prices 等长）
 * @param {string} source - 信号来源标签（如 'MACD', 'KDJ', 'RSI'）
 * @param {number} [reliability=1.0] - 指标可靠性系数（MACD=1.0, RSI=0.9, KDJ=0.7）
 * @returns {{ type: 'bullish'|'bearish', source: string, text: string } | null}
 */
export function detectStockDivergence(prices, indicator, source, reliability = 1.0) {
  const div = detectDivergenceV2(prices, indicator)
  if (!div) return null

  const adjustedConf = div.confidence * reliability
  const confPct = (adjustedConf * 100).toFixed(0)
  if (div.type === 'bullish') {
    return { type: 'bullish', source, text: `${source}底背离(${confPct}%)` }
  }
  return { type: 'bearish', source, text: `${source}顶背离(${confPct}%)` }
}
