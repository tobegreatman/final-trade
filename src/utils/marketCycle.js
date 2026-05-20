/**
 * 市场周期分析引擎 — 基于《A股实战交易体系》四维判定模型
 * 独立模块，不依赖 marketJudge.js
 */

// ==================== 周期阶段映射 ====================
export const PHASE_LABELS = {
  bull_early: '牛市初期（建仓期）',
  bull_mid: '牛市中期（持股期）',
  bull_late: '牛市后期（收割期）',
  bull_exit: '牛市末期（退出期）',
  range_bullish: '震荡偏多',
  range: '震荡市',
  range_bearish: '震荡偏空',
  bear_early: '熊市初期（暴跌期）',
  bear_mid: '熊市中期（阴跌期）',
  bear_late: '熊市后期（筑底期）'
}

export const PHASE_META = {
  bull_early: { color: '#ff453a', bgColor: 'rgba(255,69,58,0.15)', position: '20-40%', risk: 'medium', emoji: '📈' },
  bull_mid: { color: '#ff453a', bgColor: 'rgba(255,69,58,0.12)', position: '60-80%', risk: 'medium-low', emoji: '🔥' },
  bull_late: { color: '#ffd60a', bgColor: 'rgba(255,214,10,0.12)', position: '40-60%', risk: 'medium-high', emoji: '⚠️' },
  bull_exit: { color: '#ff453a', bgColor: 'rgba(255,69,58,0.2)', position: '≤10%', risk: 'high', emoji: '🚨' },
  range_bullish: { color: '#0071e3', bgColor: 'rgba(0,113,227,0.12)', position: '40-60%', risk: 'medium', emoji: '↗️' },
  range: { color: '#94a3b8', bgColor: 'rgba(148,163,184,0.12)', position: '20-40%', risk: 'medium', emoji: '↔️' },
  range_bearish: { color: '#30d158', bgColor: 'rgba(48,209,88,0.12)', position: '10-20%', risk: 'medium-high', emoji: '↘️' },
  bear_early: { color: '#30d158', bgColor: 'rgba(48,209,88,0.2)', position: '≤10%', risk: 'high', emoji: '📉' },
  bear_mid: { color: '#30d158', bgColor: 'rgba(48,209,88,0.15)', position: '10-20%', risk: 'high', emoji: '🔻' },
  bear_late: { color: '#ffd60a', bgColor: 'rgba(255,214,10,0.12)', position: '20-30%', risk: 'medium', emoji: '🌱' }
}

// ==================== 板块轮动预期（交易体系 3.1/5.6 节）====================
export const PHASE_SECTORS = {
  bull_early: ['券商', '保险', '银行', '超跌白马'],
  bull_mid: ['半导体', 'AI', '新能源', '高端制造', '有色', '煤炭'],
  bull_late: ['食品饮料', '医药', '家电', '公用事业'],
  bull_exit: ['权重拉升', '银行', '石油石化'],
  range_bullish: ['高股息', 'AI', '半导体'],
  range: ['高股息', '银行', '公用事业', '煤炭'],
  range_bearish: ['债券基金', '货币基金', '高股息'],
  bear_early: ['货币基金', '短债', '黄金'],
  bear_mid: ['高股息', '短债', '黄金'],
  bear_late: ['沪深300ETF定投', '中证500ETF定投']
}

// ==================== 五维评分 ====================

// 维度1: 价格趋势 (权重25%) — MA250 + 52周高低 + PE
function scorePriceTrend(valuation) {
  if (!valuation?.indices?.length) return { score: 50, hasData: false }
  const sh = valuation.indices.find(i => i.code === 'sh')
  if (!sh) return { score: 50, hasData: false }

  let score = 50
  let hasData = true

  if (sh.aboveMa250) score += 15
  else score -= 15
  if (sh.ma250Direction === 'up') score += 10
  else if (sh.ma250Direction === 'down') score -= 10

  // 52周高低位置仅用于20%技术性牛/熊判定，不参与评分（高位不等于牛市信号）

  // PE 估值
  if (sh.pe) {
    if (sh.pe < 15) score += 10
    else if (sh.pe > 25) score -= 10
  }

  return { score: clamp(score), hasData }
}

// 维度2: 量价水平 (权重20%) — 使用 valuation.totalAmount（SH+SZ 指数成交额）
function scoreVolumeLevel(valuation) {
  const totalAmount = valuation?.totalAmount
  if (!totalAmount) return { score: 50, hasData: false }

  // totalAmount 是 SH(上证)+SZ(深证成指) 最新日成交额(元)
  // 实际范围: 熊市底部 ~5000-8000亿, 正常 ~10000-20000亿, 牛市活跃 ~25000-35000亿
  const amount = totalAmount / 1e8

  let score
  if (amount > 25000) score = 85
  else if (amount > 15000) score = 70
  else if (amount > 8000) score = 55
  else if (amount > 5000) score = 40
  else score = 25

  return { score, hasData: true }
}

// 维度3: 市场情绪 (权重20%) — 涨停/跌停 + 涨5%/跌5% + 市场热度 + 涨跌比 + 历史趋势
function scoreSentiment(limitStats, breadth) {
  let score = 50
  let hasData = false

  if (limitStats) {
    hasData = true
    const limitUp = limitStats.limitUp || 0
    const limitDown = limitStats.limitDown || 0
    const up5p = limitStats.up5p || 0
    const down5p = limitStats.down5p || 0
    const temperature = limitStats.temperature || 0
    const history = limitStats.history || []

    // --- 涨停/跌停基础分 ---
    if (limitUp > 80 && limitDown < 3) score += 15
    else if (limitUp > 50 && limitDown < 8) score += 10
    else if (limitUp > 30 && limitDown < 10) score += 3
    else if (limitDown > 50 && limitUp < 10) score -= 15
    else if (limitDown > 30 && limitUp < 15) score -= 10
    else if (limitDown > 15) score -= 3

    // --- 涨5%+/跌5%+ 宽幅情绪（比纯涨跌停更能反映市场广度）---
    if (up5p > 0 || down5p > 0) {
      const broadRatio = up5p / (up5p + down5p)
      if (broadRatio > 0.75) score += 10
      else if (broadRatio > 0.6) score += 4
      else if (broadRatio < 0.25) score -= 10
      else if (broadRatio < 0.4) score -= 4
    }

    // --- 市场热度指数（JRJ综合情绪指标，0-100）---
    if (temperature > 0) {
      if (temperature > 70) score += 8
      else if (temperature > 55) score += 3
      else if (temperature < 30) score -= 8
      else if (temperature < 40) score -= 3
    }

    // --- 涨停历史趋势（环比变化，检测情绪恶化/改善）---
    if (history.length >= 3) {
      const upTrend = history.slice(0, 3)
      // 涨停数持续下降 = 情绪衰退
      if (upTrend[0].limitUp < upTrend[1].limitUp && upTrend[1].limitUp < upTrend[2].limitUp) score -= 5
      // 涨停数持续上升 = 情绪升温
      if (upTrend[0].limitUp > upTrend[1].limitUp && upTrend[1].limitUp > upTrend[2].limitUp) score += 5
    }
  }

  if (breadth) {
    hasData = true
    const total = (breadth.up || 0) + (breadth.down || 0) + (breadth.flatCount || breadth.flat || 0)
    if (total > 0) {
      const upRatio = (breadth.up || 0) / total
      if (upRatio > 0.7) score += 10
      else if (upRatio > 0.55) score += 3
      else if (upRatio < 0.3) score -= 10
      else if (upRatio < 0.45) score -= 3
    }
  }

  return { score: clamp(score), hasData }
}

// 维度4: 资金流向 (权重20%) — 融资余额趋势
function scoreFundFlow(margin) {
  if (!margin || !Array.isArray(margin) || margin.length < 3) return { score: 50, hasData: false }
  const recent = margin.slice(0, 3).reverse().map(m => m.totalBalance || m.balance || m.rzBalance || 0)
  const slope = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / recent.length : 0
  const ratio = recent[0] > 0 ? slope / recent[0] : 0

  // 连续映射: ratio 0→50, ±0.005→±25 (线性插值)
  const score = Math.round(clamp(50 + (ratio / 0.005) * 25) * 1000) / 1000

  return { score, hasData: true }
}

// 维度5: 北向资金 (权重15%) — 成交额活跃度 + 市场方向联合判断
function scoreNorthbound(northbound) {
  if (!northbound || !Array.isArray(northbound) || northbound.length < 3) return { score: 50, hasData: false }

  const recent = northbound.slice(0, 5)
  const amounts = recent.map(d => d.nfAmt || 0).filter(v => v > 0)
  if (amounts.length < 2) return { score: 50, hasData: false }

  const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length
  const latest = amounts[0]
  const prev = amounts[amounts.length - 1]
  if (prev <= 0) return { score: 50, hasData: false }
  const changeRatio = (latest - prev) / prev

  let score = 50
  // 成交额水平（绝对值反映参与度）
  if (avg > 400000) score += 8
  else if (avg > 200000) score += 4
  else if (avg < 100000) score -= 4

  // 成交额趋势（持续放大=资金活跃）
  if (changeRatio > 0.15) score += 5
  else if (changeRatio > 0.05) score += 3
  else if (changeRatio < -0.15) score -= 5
  else if (changeRatio < -0.05) score -= 3

  // 市场方向联合信号：成交额放大+市场下跌=疑似净卖出，反之亦然
  // 用近期数据的指数涨跌幅（sciRate字段，如有）辅助判断
  const rates = recent.map(d => d.sciRate || d.sscRate || 0).filter(v => v !== 0)
  if (rates.length >= 2) {
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length
    const amtTrend = changeRatio > 0 ? 1 : changeRatio < -0.05 ? -1 : 0
    // 成交额放大+市场上涨=北向大概率净买入
    if (amtTrend > 0 && avgRate > 0.3) score += 10
    else if (amtTrend > 0 && avgRate > 0) score += 5
    // 成交额放大+市场下跌=北向可能净卖出（最差信号）
    else if (amtTrend > 0 && avgRate < -0.5) score -= 10
    else if (amtTrend > 0 && avgRate < -0.2) score -= 5
    // 成交额萎缩+市场上涨=北向缺席上涨（略负面）
    else if (amtTrend < 0 && avgRate > 0.3) score -= 3
    // 成交额萎缩+市场下跌=北向观望（中性偏负）
    else if (amtTrend < 0 && avgRate < -0.3) score -= 5
  }

  return { score: clamp(score), hasData: true }
}

function clamp(v) { return Math.max(0, Math.min(100, v)) }

// ==================== 布尔信号计数 ====================
// 8 项对称计数，与加权分交叉验证

function countBullSignals(valuation, breadth, limitStats, margin, northbound) {
  let count = 0
  const signals = []
  const sh = valuation?.indices?.find(i => i.code === 'sh')

  // 1. 年线趋势
  if (sh?.aboveMa250 && sh?.ma250Direction === 'up') { count++; signals.push('站上年线且年线向上') }

  // 2. 量能活跃
  const totalAmt = (valuation?.totalAmount || 0) / 1e8
  if (totalAmt > 20000) { count++; signals.push('成交额活跃(>20000亿)') }

  // 3. 涨停质量
  if (limitStats && (limitStats.limitUp || 0) > 50 && (limitStats.limitDown || 0) < 5) {
    count++; signals.push('涨停>50且跌停<5')
  }

  // 4. 市场广度（涨5%/跌5%比例）
  if (limitStats?.up5p && limitStats?.down5p && limitStats.up5p > limitStats.down5p * 2) {
    count++; signals.push('涨5%远超跌5%(>2倍)')
  }

  // 5. 杠杆资金
  if (margin && Array.isArray(margin) && margin.length >= 3) {
    const recent = margin.slice(0, 3).reverse().map(m => m.totalBalance || m.balance || m.rzBalance || 0)
    if (recent[2] > recent[0]) { count++; signals.push('融资余额持续上升') }
  }

  // 6. 北向活跃
  if (northbound && Array.isArray(northbound) && northbound.length >= 3) {
    const amounts = northbound.slice(0, 3).map(d => d.nfAmt || 0).filter(v => v > 0)
    if (amounts.length >= 2 && amounts[0] > amounts[amounts.length - 1] * 1.05) {
      count++; signals.push('北向成交放大(>5%)')
    }
  }

  // 7. 涨跌家数比
  if (breadth) {
    const up = breadth.up || 0
    const down = breadth.down || 0
    if (down > 0 && up / down > 2) { count++; signals.push('涨跌比>2:1') }
  }

  // 8. 情绪偏强（热度 OR 涨停升温）
  let emoBull = false
  if (limitStats?.history?.length >= 3) {
    const h = limitStats.history
    if (h[0].limitUp > h[1].limitUp && h[1].limitUp > h[2].limitUp) emoBull = true
  }
  if (limitStats?.temperature && limitStats.temperature > 55) emoBull = true
  if (emoBull) { count++; signals.push('情绪偏强(热度>55或涨停升温)') }

  return { count, signals }
}

function countBearSignals(valuation, breadth, limitStats, margin, northbound) {
  let count = 0
  const signals = []
  const sh = valuation?.indices?.find(i => i.code === 'sh')

  // 1. 年线趋势
  if (sh && !sh.aboveMa250 && sh.ma250Direction === 'down') { count++; signals.push('跌破年线且年线向下') }

  // 2. 量能萎缩
  const totalAmt = (valuation?.totalAmount || 0) / 1e8
  if (totalAmt > 0 && totalAmt < 8000) { count++; signals.push('成交额萎缩(<8000亿)') }

  // 3. 跌停恐慌
  if (limitStats && (limitStats.limitUp || 0) < 10 && (limitStats.limitDown || 0) > 30) {
    count++; signals.push('涨停<10且跌停>30')
  }

  // 4. 市场广度（跌5%/涨5%比例）
  if (limitStats?.up5p && limitStats?.down5p && limitStats.down5p > limitStats.up5p * 2) {
    count++; signals.push('跌5%远超涨5%(>2倍)')
  }

  // 5. 杠杆资金
  if (margin && Array.isArray(margin) && margin.length >= 3) {
    const recent = margin.slice(0, 3).reverse().map(m => m.totalBalance || m.balance || m.rzBalance || 0)
    if (recent[2] < recent[0]) { count++; signals.push('融资余额持续下降') }
  }

  // 6. 北向萎缩
  if (northbound && Array.isArray(northbound) && northbound.length >= 3) {
    const amounts = northbound.slice(0, 3).map(d => d.nfAmt || 0).filter(v => v > 0)
    if (amounts.length >= 2 && amounts[0] < amounts[amounts.length - 1] * 0.7) {
      count++; signals.push('北向成交萎缩(>30%)')
    }
  }

  // 7. 涨跌家数比
  if (breadth) {
    const up = breadth.up || 0
    const down = breadth.down || 0
    if (up > 0 && down / up > 2) { count++; signals.push('涨跌比<1:2') }
  }

  // 8. 情绪偏弱（热度 OR 涨停降温）
  let emoBear = false
  if (limitStats?.history?.length >= 3) {
    const h = limitStats.history
    if (h[0].limitUp < h[1].limitUp && h[1].limitUp < h[2].limitUp) emoBear = true
  }
  if (limitStats?.temperature && limitStats.temperature < 35) emoBear = true
  if (emoBear) { count++; signals.push('情绪偏弱(热度<35或涨停降温)') }

  return { count, signals }
}

// ==================== 20%技术性牛/熊定义 ====================
function check20PctDefinition(valuation) {
  const sh = valuation?.indices?.find(i => i.code === 'sh')
  if (!sh?.high52w || !sh?.low52w || !sh?.price) return 'none'

  const range = sh.high52w - sh.low52w
  if (range <= 0) return 'none'

  // 从52周低点上涨超过20% = 技术性牛市
  const fromLow = (sh.price - sh.low52w) / sh.low52w
  // 从52周高点下跌超过20% = 技术性熊市
  const fromHigh = (sh.high52w - sh.price) / sh.high52w

  if (fromLow > 0.20) return 'bull'
  if (fromHigh > 0.20) return 'bear'
  return 'none'
}

// ==================== 状态惯性分组 ====================
const BULL_PHASES = new Set(['bull_early', 'bull_mid', 'bull_late', 'bull_exit', 'range_bullish'])
const BEAR_PHASES = new Set(['bear_early', 'bear_mid', 'bear_late', 'range_bearish'])

function applyHysteresis(raw, prev, weightedScore) {
  if (!prev || prev === raw) return raw

  // 同方向自由切换（bull_early↔bull_mid↔bull_late 等）
  if (BULL_PHASES.has(prev) && BULL_PHASES.has(raw)) return raw
  if (BEAR_PHASES.has(prev) && BEAR_PHASES.has(raw)) return raw

  const distance = Math.abs(weightedScore - 50)

  // 跨方向反转：需要评分距中性线 ≥ 15
  if ((BULL_PHASES.has(prev) && BEAR_PHASES.has(raw)) ||
      (BEAR_PHASES.has(prev) && BULL_PHASES.has(raw))) {
    if (distance < 15) return prev
    return raw
  }

  // 进出中性：需要评分距中性线 ≥ 10
  if (distance < 10) return prev
  return raw
}

// ==================== 主判定函数 ====================
export function determineCyclePhase(valuation, breadth, limitStats, margin, northbound, prevPhase) {
  const d1 = scorePriceTrend(valuation)
  const d2 = scoreVolumeLevel(valuation)
  const d3 = scoreSentiment(limitStats, breadth)
  const d4 = scoreFundFlow(margin)
  const d5 = scoreNorthbound(northbound)

  // 五维加权: 价格25% + 量价20% + 情绪20% + 资金20% + 北向15%
  const weights = [0.25, 0.20, 0.20, 0.20, 0.15]
  const scores = [d1, d2, d3, d4, d5]
  const weightedScore = scores.reduce((sum, s, i) => sum + s.score * weights[i], 0)

  // 布尔信号计数
  const bullSignals = countBullSignals(valuation, breadth, limitStats, margin, northbound)
  const bearSignals = countBearSignals(valuation, breadth, limitStats, margin, northbound)

  // 20%定义
  const pct20Status = check20PctDefinition(valuation)

  // === 评分→阶段映射（6 档，覆盖全部 10 阶段） ===
  let raw
  if (weightedScore >= 70) raw = 'bull'          // PE 子分类
  else if (weightedScore >= 60) raw = 'range_bullish'
  else if (weightedScore >= 42) raw = 'range'
  else if (weightedScore >= 25) raw = 'range_bearish'
  else if (weightedScore >= 20) raw = 'bear_mid'
  else raw = 'bear_early'

  // 布尔计数覆盖: 牛信号>=3 → 至少震荡偏多; 熊信号>=3 → 至少震荡偏空
  const onlyBull = bullSignals.count >= 3 && bearSignals.count < 3 && weightedScore < 60
  const onlyBear = bearSignals.count >= 3 && bullSignals.count < 3 && weightedScore > 42
  if (onlyBull) {
    if (raw === 'range') raw = 'range_bullish'
    else if (raw.startsWith('range_bearish') || raw.startsWith('bear')) raw = 'range'
  }
  if (onlyBear) {
    if (raw === 'range') raw = 'range_bearish'
    else if (raw === 'range_bullish' || raw === 'bull') raw = 'range'
  }

  // === 牛市子阶段（PE + MA250）— 仅对 bull 分数段生效 ===
  const sh = valuation?.indices?.find(i => i.code === 'sh')
  if (raw === 'bull') {
    if (sh?.aboveMa250 && sh?.ma250Direction === 'up' && sh.pe) {
      if (sh.pe > 25) raw = 'bull_exit'
      else if (sh.pe > 22) raw = 'bull_late'
      else if (sh.pe > 18) raw = 'bull_mid'
      else raw = 'bull_early'
    } else {
      raw = 'bull_early'
    }
  }

  // 熊市晚期: PE < 15
  if (raw === 'bear_mid' && sh?.pe && sh.pe < 15) {
    raw = 'bear_late'
  }

  // 20%定义硬覆盖
  if (pct20Status === 'bear' && raw.startsWith('bull')) raw = 'range_bullish'
  if (pct20Status === 'bull' && raw.startsWith('bear')) raw = 'range_bearish'

  // === 状态惯性 ===
  const phase = applyHysteresis(raw, prevPhase, weightedScore)

  // === 置信度（矛盾信号惩罚） ===
  const dataDimensions = scores.filter(s => s.hasData).length
  const dataCompleteness = dataDimensions / 5
  let signalFactor
  if (bullSignals.count >= 3 && bearSignals.count >= 3) signalFactor = 0.7   // 信号矛盾：惩罚
  else if (bullSignals.count >= 3 || bearSignals.count >= 3) signalFactor = 1.2  // 方向一致：提升
  else signalFactor = 1.0
  const confidence = Math.round(
    Math.min(100, Math.abs(weightedScore - 50) * 1.5 * dataCompleteness * signalFactor)
  )

  return {
    phase,
    score: Math.round(weightedScore),
    confidence,
    pct20Status,
    bullSignalCount: bullSignals.count,
    bearSignalCount: bearSignals.count,
    bullSignals: bullSignals.signals,
    bearSignals: bearSignals.signals,
    label: PHASE_LABELS[phase] || '震荡市',
    meta: PHASE_META[phase] || PHASE_META.range,
    indicators: {
      priceTrend: d1.score,
      volumeLevel: d2.score,
      sentiment: d3.score,
      fundFlow: d4.score,
      northbound: d5.score,
      ma250Above: sh?.aboveMa250 || false,
      ma250Direction: sh?.ma250Direction || 'flat',
      valuationLevel: sh?.valuationLevel || 'unknown',
      pe: sh?.pe || null,
      totalAmount: valuation?.totalAmount || 0
    },
    dataQuality: {
      dimensions: dataDimensions,
      total: 5,
      score: Math.round(dataCompleteness * 100)
    }
  }
}

// ==================== 策略生成 ====================
const POSITION_MAP = {
  bull_early: '20-40%',
  bull_mid: '60-80%',
  bull_late: '40-60%',
  bull_exit: '≤10%',
  range_bullish: '40-60%',
  range: '20-40%',
  range_bearish: '10-20%',
  bear_early: '≤10%',
  bear_mid: '10-20%',
  bear_late: '20-30%'
}

const RISK_MAP = {
  bull_early: 'medium',
  bull_mid: 'medium-low',
  bull_late: 'medium-high',
  bull_exit: 'high',
  range_bullish: 'medium',
  range: 'medium',
  range_bearish: 'medium-high',
  bear_early: 'high',
  bear_mid: 'high',
  bear_late: 'medium'
}

const RISK_LABELS = {
  low: { label: '低', color: '#30d158' },
  'medium-low': { label: '中低', color: '#30d158' },
  medium: { label: '中', color: '#ffd60a' },
  'medium-high': { label: '中高', color: '#ff9500' },
  high: { label: '高', color: '#ff453a' }
}

function getActionItems(phase) {
  const actions = {
    bull_early: [
      '确认券商板块是否集体异动',
      '检查大盘成交量是否持续放大',
      '按3-4批法分批建仓，每回调3-5%加一批',
      '设定个股止损8%'
    ],
    bull_mid: [
      '检查核心持仓是否站稳60日均线',
      '更新板块RS排名，关注强势板块',
      '卫星持仓每4-8周评估一次动量',
      '趋势止盈：从高点回撤8-12%减半仓'
    ],
    bull_late: [
      '检查是否出现放量滞涨信号',
      '检查利好是否不再推动上涨',
      '开始系统性减仓，利润落袋',
      '严格执行成本线保护（盈利>30%止损线提至成本价）'
    ],
    bull_exit: [
      '立即将仓位降至10%以下',
      '检查北向资金是否大幅流出',
      '检查融资余额是否暴增',
      '资金转入货币基金或短债'
    ],
    range_bullish: [
      '关注指数是否放量突破震荡区间上沿',
      'ETF定投 + 少量个股参与',
      '板块轮动关注RS排名前3的行业',
      '总仓位不超过60%'
    ],
    range: [
      '执行ETF定投策略（沪深300 + 中证500）',
      '区间交易：支撑位附近买入，压力位附近卖出',
      '不追涨不杀跌，等待方向确认',
      '总仓位20-40%'
    ],
    range_bearish: [
      '降低仓位至10-20%',
      '以高股息+债券为主',
      '关注是否跌破震荡区间下沿',
      '准备左侧定投资金'
    ],
    bear_early: [
      '无条件将仓位降至10%以下',
      '资金转入货币基金或短期理财',
      '不抄底，不补仓',
      '记录市场情绪极度恐慌的信号'
    ],
    bear_mid: [
      '高股息+低波动组合防御',
      '关注债券和黄金ETF机会',
      '反弹即减仓，不恋战',
      '记录底部信号积累情况'
    ],
    bear_late: [
      '检查底部信号（PE<15、股债利差>4%、破净股>10%）',
      '开始左侧定投（18-24个月计划）',
      '每跌10%额外追加一份',
      '心理准备：可能浮亏12-18个月'
    ]
  }
  return actions[phase] || actions.range
}

export function generateStrategy(cyclePhase, topSectors) {
  const phase = cyclePhase.phase || 'range'
  const positionSize = POSITION_MAP[phase] || '20-40%'
  const riskLevel = RISK_MAP[phase] || 'medium'
  const riskMeta = RISK_LABELS[riskLevel] || RISK_LABELS.medium
  const expectedSectors = PHASE_SECTORS[phase] || []
  const actionItems = getActionItems(phase)

  const focusSectors = topSectors?.length > 0
    ? topSectors.slice(0, 3).map(s => s.name)
    : expectedSectors.slice(0, 3)

  return {
    positionSize,
    riskLevel,
    riskLabel: riskMeta.label,
    riskColor: riskMeta.color,
    focusSectors,
    expectedSectors,
    actionItems,
    summary: getStrategySummary(phase)
  }
}

function getStrategySummary(phase) {
  const summaries = {
    bull_early: '牛市初期，分批建仓。重点关注券商和金融板块，仓位控制在20-40%。',
    bull_mid: '牛市中期，持股为主。核心+卫星持仓结构，板块轮动跟踪RS强势方向。',
    bull_late: '牛市后期，逐步止盈。警惕逃顶信号，趋势跟踪止盈法减仓。',
    bull_exit: '牛市末期，立即离场。多个逃顶信号已触发，仓位降至10%以下。',
    range_bullish: '震荡偏多，适度参与。ETF为主，关注突破方向确认。',
    range: '震荡市，定投为主。区间交易+ETF定投，耐心等待方向选择。',
    range_bearish: '震荡偏空，防御为主。高股息+债券配置，降低仓位。',
    bear_early: '熊市初期，果断离场。空仓或保留高股息底仓，资金转入货基。',
    bear_mid: '熊市中期，防御为王。高股息+债券+黄金组合，不抄底。',
    bear_late: '熊市后期，准备布局。左侧定投启动，底部信号逐个确认。'
  }
  return summaries[phase] || summaries.range
}

// ==================== 辅助函数 ====================
export function formatAmount(amount) {
  if (amount >= 100000000) return (amount / 100000000).toFixed(0) + '亿'
  if (amount >= 10000) return (amount / 10000).toFixed(0) + '万'
  return amount?.toString() || '-'
}

export function getValuationLabel(level) {
  const map = { low: '低估', fair: '合理', elevated: '偏高', high: '高估', unknown: '-' }
  return map[level] || '-'
}

export function getValuationColor(level) {
  const map = { low: '#30d158', fair: '#ffd60a', elevated: '#ff9500', high: '#ff453a', unknown: '#64748b' }
  return map[level] || '#64748b'
}
