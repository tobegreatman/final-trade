/**
 * 动态权重评分引擎 — 个股综合分析
 * v2: 修复默认分压缩、信号累加、ROE年化、利润增长、资金面保底、PE行业分档
 */

// ==================== 行业 PE 分档 ====================
const PE_THRESHOLDS = {
  default: { low: 15, fair: 25, high: 40 },
  bank: { low: 8, fair: 12, high: 18 },
  insurance: { low: 10, fair: 18, high: 30 },
  realestate: { low: 8, fair: 15, high: 25 },
  steel: { low: 8, fair: 15, high: 25 },
  coal: { low: 8, fair: 12, high: 20 },
  food: { low: 15, fair: 30, high: 50 },
  medicine: { low: 20, fair: 35, high: 55 },
  tech: { low: 20, fair: 40, high: 60 },
  semiconductor: { low: 25, fair: 50, high: 80 },
  military: { low: 25, fair: 45, high: 70 },
  newenergy: { low: 15, fair: 30, high: 50 },
  appliance: { low: 12, fair: 22, high: 35 },
  auto: { low: 12, fair: 25, high: 40 },
  utility: { low: 10, fair: 18, high: 28 },
  chemical: { low: 12, fair: 22, high: 35 },
  construction: { low: 8, fair: 14, high: 22 },
  broker: { low: 15, fair: 25, high: 40 },
}

// 报告期类型 → 年化乘数
function getAnnualizeMultiplier(reportName) {
  if (!reportName) return 1
  if (reportName.includes('一季')) return 4
  if (reportName.includes('中报') || reportName.includes('半年')) return 2
  if (reportName.includes('三季')) return 4 / 3
  return 1 // 年报不乘
}

/**
 * 计算个股综合评分
 * @param {Array} techSignals - 技术信号数组（来自 indicators.js）
 * @param {Object|null} fundamental - 基本面数据 { latest, history }
 * @param {Object|null} capitalFlow - 资金面数据 { priceVolumeSignal, volumeTrend, available }
 * @param {string} industry - 行业名称（可选，用于 PE 分档）
 * @returns {Object} { total, dimensions, suggestion, confidence, details }
 */
export function calculateScore(techSignals = [], fundamental = null, capitalFlow = null, industry = '') {
  const dimensions = {
    technical: { score: 0, max: 40, items: [] },
    fundamental: { score: 0, max: 30, items: [] },
    capital: { score: 0, max: 25, items: [] }
  }

  // ========== 技术面评分 (0-40) ==========
  const tech = dimensions.technical
  const allBullish = techSignals.filter(s => s.type === 'bullish')
  const allBearish = techSignals.filter(s => s.type === 'bearish')

  // 1. 均线排列 (0-10) — 无信号默认 3/10
  const maBullish = techSignals.find(s => s.source === 'MA' && s.type === 'bullish')
  const maBearish = techSignals.find(s => s.source === 'MA' && s.type === 'bearish')
  const maCross = techSignals.find(s => s.source === 'MA' && (s.text.includes('金叉') || s.text.includes('死叉')))
  if (maBullish?.text?.includes('多头排列')) {
    tech.items.push({ name: '均线排列', score: 10, max: 10, desc: '多头排列' })
  } else if (maBearish?.text?.includes('空头排列')) {
    tech.items.push({ name: '均线排列', score: 0, max: 10, desc: '空头排列' })
  } else if (maCross) {
    // 有金叉/死叉但未形成排列
    const crossScore = maCross.type === 'bullish' ? 7 : 3
    tech.items.push({ name: '均线排列', score: crossScore, max: 10, desc: maCross.text })
  } else {
    tech.items.push({ name: '均线排列', score: 3, max: 10, desc: '交叉/中性' })
  }

  // 2. MACD 信号 (0-8) — 累加同源信号
  const macdBullish = techSignals.filter(s => s.source === 'MACD' && s.type === 'bullish')
  const macdBearish = techSignals.filter(s => s.source === 'MACD' && s.type === 'bearish')
  let macdScore = 3 // 无信号默认 3/8
  const macdDescs = []
  for (const s of macdBullish) {
    if (s.text.includes('金叉')) { macdScore += 3; macdDescs.push(s.text) }
    if (s.text.includes('底背离')) { macdScore += 2; macdDescs.push(s.text) }
  }
  for (const s of macdBearish) {
    if (s.text.includes('死叉')) { macdScore -= 2; macdDescs.push(s.text) }
    if (s.text.includes('顶背离')) { macdScore -= 2; macdDescs.push(s.text) }
  }
  macdScore = Math.max(0, Math.min(8, macdScore))
  tech.items.push({ name: 'MACD', score: macdScore, max: 8, desc: macdDescs.length ? macdDescs.join('，') : '无明显信号' })

  // 3. KDJ 信号 (0-7) — 累加同源信号（含背离）
  const kdjSignals = techSignals.filter(s => s.source === 'KDJ')
  let kdjScore = 2
  const kdjDescs = []
  for (const s of kdjSignals) {
    if (s.text.includes('底背离')) { kdjScore += 3; kdjDescs.push(s.text) }
    else if (s.type === 'bullish') { kdjScore += 2; kdjDescs.push(s.text) }
    else if (s.text.includes('顶背离')) { kdjScore -= 3; kdjDescs.push(s.text) }
    else if (s.type === 'bearish') { kdjScore -= 2; kdjDescs.push(s.text) }
  }
  kdjScore = Math.max(0, Math.min(7, kdjScore))
  tech.items.push({ name: 'KDJ', score: kdjScore, max: 7, desc: kdjDescs.length ? kdjDescs.join('，') : '正常区间' })

  // 4. RSI 信号 (0-7) — 共振优先，避免与单周期信号重复计分
  const rsiSignals = techSignals.filter(s => s.source === 'RSI')
  let rsiScore = 2
  const rsiDescs = []
  let hasResonanceBull = false
  let hasResonanceBear = false
  // 先处理共振信号（多周期确认，权重最高）
  for (const s of rsiSignals) {
    if (s.text.includes('共振超卖')) { rsiScore += 3; rsiDescs.push(s.text); hasResonanceBull = true }
    else if (s.text.includes('共振超买')) { rsiScore -= 3; rsiDescs.push(s.text); hasResonanceBear = true }
  }
  // 再处理其他信号，共振已覆盖的单周期超买超卖跳过
  for (const s of rsiSignals) {
    if (s.text.includes('共振')) continue // 已处理
    if (hasResonanceBull && (s.text.includes('严重超卖') || s.text.includes('超卖'))) continue
    if (hasResonanceBear && (s.text.includes('严重超买') || s.text.includes('超买'))) continue
    if (s.text.includes('严重超卖') || s.text.includes('底背离')) { rsiScore += 3; rsiDescs.push(s.text) }
    else if (s.text.includes('超卖') || s.text.includes('金叉')) { rsiScore += 2; rsiDescs.push(s.text) }
    else if (s.text.includes('严重超买') || s.text.includes('顶背离')) { rsiScore -= 3; rsiDescs.push(s.text) }
    else if (s.text.includes('超买') || s.text.includes('死叉')) { rsiScore -= 2; rsiDescs.push(s.text) }
  }
  rsiScore = Math.max(0, Math.min(7, rsiScore))
  tech.items.push({ name: 'RSI', score: rsiScore, max: 7, desc: rsiDescs.length ? rsiDescs.join('，') : '正常区间' })

  // 5. BOLL 信号 (0-4) — 趋势跟随视角：上轨=强势，下轨=弱势
  const bollSignals = techSignals.filter(s => s.source === 'BOLL')
  const bollPosition = bollSignals.find(s => !s.text.includes('收口'))
  const bollSqueeze = bollSignals.find(s => s.text.includes('收口'))
  let bollScore = 1
  let bollDesc = '中轨下方'
  if (bollPosition?.text?.includes('上轨')) {
    bollScore = 4; bollDesc = '触及上轨（强势）'
  } else if (bollPosition?.text?.includes('上方')) {
    bollScore = 3; bollDesc = '中轨上方'
  } else if (bollPosition?.text?.includes('下轨')) {
    bollScore = 0; bollDesc = '触及下轨（弱势）'
  }
  if (bollSqueeze) {
    bollScore = Math.min(4, bollScore + 1)
    bollDesc += '，收口预警'
  }
  tech.items.push({ name: 'BOLL', score: bollScore, max: 4, desc: bollDesc })

  // 6. 量价信号 (0-4) — 无信号默认 1/4
  const volSignal = techSignals.find(s => s.source === '量价')
  if (volSignal?.text?.includes('放量上涨') || volSignal?.text?.includes('量价配合')) {
    tech.items.push({ name: '量价', score: 4, max: 4, desc: volSignal.text })
  } else if (volSignal?.text?.includes('缩量回调')) {
    tech.items.push({ name: '量价', score: 2, max: 4, desc: '缩量回调' })
  } else if (volSignal?.text?.includes('放量下跌')) {
    tech.items.push({ name: '量价', score: 0, max: 4, desc: '放量下跌' })
  } else {
    tech.items.push({ name: '量价', score: 1, max: 4, desc: volSignal?.text || '中性' })
  }

  tech.score = tech.items.reduce((s, i) => s + i.score, 0)

  // ========== 基本面评分 (0-30) ==========
  const fund = dimensions.fundamental
  const latest = fundamental?.latest

  if (latest) {
    const annualMul = getAnnualizeMultiplier(latest.reportName)
    const annualizedRoe = latest.roe != null ? latest.roe * annualMul : null

    // 1. PE 估值 (0-8) — 无数据默认 2/8
    if (latest.pe != null) {
      const t = getPEThresholds(industry)
      const pe = latest.pe
      if (pe <= 0) {
        fund.items.push({ name: 'PE估值', score: 0, max: 8, desc: `PE ${pe.toFixed(1)}，亏损` })
      } else if (pe <= t.low) {
        fund.items.push({ name: 'PE估值', score: 8, max: 8, desc: `PE ${pe.toFixed(1)}，低估` })
      } else if (pe <= t.fair) {
        fund.items.push({ name: 'PE估值', score: 6, max: 8, desc: `PE ${pe.toFixed(1)}，合理` })
      } else if (pe <= t.high) {
        fund.items.push({ name: 'PE估值', score: 3, max: 8, desc: `PE ${pe.toFixed(1)}，偏高` })
      } else {
        fund.items.push({ name: 'PE估值', score: 1, max: 8, desc: `PE ${pe.toFixed(1)}，高估` })
      }
    } else {
      fund.items.push({ name: 'PE估值', score: 2, max: 8, desc: '暂无数据' })
    }

    // 2. ROE (0-8) — 年化后评分，无数据默认 2/8
    if (annualizedRoe != null) {
      if (annualizedRoe < 0) {
        fund.items.push({ name: 'ROE', score: 0, max: 8, desc: `ROE ${annualizedRoe.toFixed(1)}%(年化)，亏损` })
      } else if (annualizedRoe >= 20) {
        fund.items.push({ name: 'ROE', score: 8, max: 8, desc: `ROE ${annualizedRoe.toFixed(1)}%(年化)，优秀` })
      } else if (annualizedRoe >= 12) {
        fund.items.push({ name: 'ROE', score: 6, max: 8, desc: `ROE ${annualizedRoe.toFixed(1)}%(年化)，良好` })
      } else if (annualizedRoe >= 6) {
        fund.items.push({ name: 'ROE', score: 4, max: 8, desc: `ROE ${annualizedRoe.toFixed(1)}%(年化)，一般` })
      } else {
        fund.items.push({ name: 'ROE', score: 1, max: 8, desc: `ROE ${annualizedRoe.toFixed(1)}%(年化)，偏弱` })
      }
    } else {
      fund.items.push({ name: 'ROE', score: 2, max: 8, desc: '暂无数据' })
    }

    // 3. 营收增长 (0-5) — 无数据默认 1/5
    if (latest.revenueGrowth != null) {
      if (latest.revenueGrowth > 20) {
        fund.items.push({ name: '营收增长', score: 5, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，高增` })
      } else if (latest.revenueGrowth > 10) {
        fund.items.push({ name: '营收增长', score: 4, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，稳健` })
      } else if (latest.revenueGrowth > 0) {
        fund.items.push({ name: '营收增长', score: 2, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，低速` })
      } else {
        fund.items.push({ name: '营收增长', score: 0, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，下滑` })
      }
    } else {
      fund.items.push({ name: '营收增长', score: 1, max: 5, desc: '暂无数据' })
    }

    // 4. 利润增长 (0-5) — 新增维度，无数据默认 1/5
    if (latest.profitGrowth != null) {
      if (latest.profitGrowth > 20) {
        fund.items.push({ name: '净利增长', score: 5, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，高增` })
      } else if (latest.profitGrowth > 10) {
        fund.items.push({ name: '净利增长', score: 4, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，稳健` })
      } else if (latest.profitGrowth > 0) {
        fund.items.push({ name: '净利增长', score: 2, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，低速` })
      } else {
        fund.items.push({ name: '净利增长', score: 0, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，下滑` })
      }
    } else {
      fund.items.push({ name: '净利增长', score: 1, max: 5, desc: '暂无数据' })
    }

    // 5. 负债率 (0-4) — 无数据默认 1/4
    if (latest.debtRatio != null) {
      if (latest.debtRatio < 30) {
        fund.items.push({ name: '负债率', score: 4, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，很低` })
      } else if (latest.debtRatio < 50) {
        fund.items.push({ name: '负债率', score: 3, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，健康` })
      } else if (latest.debtRatio < 70) {
        fund.items.push({ name: '负债率', score: 2, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，中等` })
      } else {
        fund.items.push({ name: '负债率', score: 0, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，偏高` })
      }
    } else {
      fund.items.push({ name: '负债率', score: 1, max: 4, desc: '暂无数据' })
    }
  } else {
    fund.items.push(
      { name: 'PE估值', score: 2, max: 8, desc: '暂无数据' },
      { name: 'ROE', score: 2, max: 8, desc: '暂无数据' },
      { name: '营收增长', score: 1, max: 5, desc: '暂无数据' },
      { name: '净利增长', score: 1, max: 5, desc: '暂无数据' },
      { name: '负债率', score: 1, max: 4, desc: '暂无数据' }
    )
  }

  fund.score = fund.items.reduce((s, i) => s + i.score, 0)

  // ========== 资金面评分 (0-25) ==========
  const cap = dimensions.capital
  cap.max = 25
  const priceVolumeSignal = capitalFlow?.priceVolumeSignal

  // 量价趋势评分
  let volScore = 5
  let volDesc = priceVolumeSignal || '中性'
  if (priceVolumeSignal === '放量上涨') { volScore = 10; volDesc = '放量上涨' }
  else if (priceVolumeSignal === '温和上涨') { volScore = 8; volDesc = '温和上涨' }
  else if (priceVolumeSignal === '缩量调整' || priceVolumeSignal === '量价平稳') { volScore = 6; volDesc = priceVolumeSignal }
  else if (priceVolumeSignal === '温和下跌') { volScore = 3; volDesc = '温和下跌' }
  else if (priceVolumeSignal === '放量下跌') { volScore = 0; volDesc = '放量下跌' }
  else if (priceVolumeSignal === '缩量下跌') { volScore = 2; volDesc = '缩量下跌' }

  cap.items.push({ name: '量价趋势', score: volScore, max: 10, desc: volDesc })

  // 融资融券评分（基于余额变化率）
  const marginLatest = capitalFlow?._marginLatest
  if (marginLatest?.balanceGrowth != null) {
    let marginScore = 4
    let marginDesc = '融资余额持平'
    if (marginLatest.balanceGrowth > 2) { marginScore = 8; marginDesc = '融资余额上升' }
    else if (marginLatest.balanceGrowth > 0) { marginScore = 6; marginDesc = '融资余额微升' }
    else if (marginLatest.balanceGrowth < -2) { marginScore = 1; marginDesc = '融资余额下降' }
    else if (marginLatest.balanceGrowth < 0) { marginScore = 3; marginDesc = '融资余额微降' }
    cap.items.push({ name: '融资融券', score: marginScore, max: 8, desc: marginDesc })
  } else {
    cap.items.push({ name: '融资融券', score: 4, max: 8, desc: '暂无数据' })
  }

  // 北向资金评分（基于季度持股变动）
  const nbLatest = capitalFlow?._northboundLatest
  if (nbLatest?.changeRatio != null) {
    let nbScore = 4
    let nbDesc = '北向持股持平'
    if (nbLatest.changeRatio > 10) { nbScore = 7; nbDesc = '北向大幅增持' }
    else if (nbLatest.changeRatio > 2) { nbScore = 6; nbDesc = '北向增持' }
    else if (nbLatest.changeRatio > 0) { nbScore = 5; nbDesc = '北向微增' }
    else if (nbLatest.changeRatio < -10) { nbScore = 1; nbDesc = '北向大幅减持' }
    else if (nbLatest.changeRatio < -2) { nbScore = 2; nbDesc = '北向减持' }
    else if (nbLatest.changeRatio < 0) { nbScore = 3; nbDesc = '北向微减' }
    cap.items.push({ name: '北向资金', score: nbScore, max: 7, desc: nbDesc })
  } else {
    cap.items.push({ name: '北向资金', score: 4, max: 7, desc: '暂无数据' })
  }

  cap.score = cap.items.reduce((s, i) => s + i.score, 0)

  // ========== 动态权重合成 ==========
  const hasFundData = !!fundamental?.latest

  const weights = hasFundData
    ? { technical: 0.50, fundamental: 0.30, capital: 0.20 }
    : { technical: 0.65, fundamental: 0.15, capital: 0.20 }

  const total = Math.round(
    tech.score / tech.max * 100 * weights.technical +
    fund.score / fund.max * 100 * weights.fundamental +
    cap.score / cap.max * 100 * weights.capital
  )

  // 操作建议
  let suggestion, suggestionColor
  if (total >= 70) { suggestion = '建议关注'; suggestionColor = '#30d158' }
  else if (total >= 40) { suggestion = '持续观察'; suggestionColor = '#ffd60a' }
  else { suggestion = '谨慎对待'; suggestionColor = '#ff453a' }

  // 置信度
  let confidence, confidenceStars
  if (hasFundData) { confidence = 'medium'; confidenceStars = 3 }
  else { confidence = 'low'; confidenceStars = 2 }

  // 汇总所有明细
  const details = [
    ...tech.items.map(i => ({ ...i, dimension: '技术面' })),
    ...fund.items.map(i => ({ ...i, dimension: '基本面' })),
    ...cap.items.map(i => ({ ...i, dimension: '资金面' })),
  ]

  return {
    total: Math.max(0, Math.min(100, total)),
    dimensions: {
      technical: { score: tech.score, max: tech.max, pct: Math.round(tech.score / tech.max * 100) },
      fundamental: { score: fund.score, max: fund.max, pct: Math.round(fund.score / fund.max * 100) },
      capital: { score: cap.score, max: cap.max, pct: Math.round(cap.score / cap.max * 100) }
    },
    suggestion,
    suggestionColor,
    confidence,
    confidenceStars,
    details
  }
}

// PE 行业分档辅助（导出供组件使用）
export function getPEThresholds(industry) {
  if (!industry) return PE_THRESHOLDS.default
  const lower = industry.toLowerCase()
  for (const [key, thresholds] of Object.entries(PE_THRESHOLDS)) {
    if (key === 'default') continue
    if (lower.includes(key)) return thresholds
  }
  // 中文行业名匹配
  const cnMap = {
    '银行': 'bank', '保险': 'insurance', '房地产': 'realestate',
    '钢铁': 'steel', '煤炭': 'coal', '食品': 'food', '饮料': 'food',
    '白酒': 'food', '酒': 'food',
    '医药': 'medicine', '生物': 'medicine',
    '计算机': 'tech', '电子': 'tech', '通信': 'tech',
    '传媒': 'tech', '互联网': 'tech', '软件': 'tech',
    '半导体': 'semiconductor', '芯片': 'semiconductor',
    '国防': 'military', '军工': 'military',
    '新能源': 'newenergy', '光伏': 'newenergy', '锂电': 'newenergy',
    '家电': 'appliance', '白电': 'appliance',
    '汽车': 'auto', '整车': 'auto',
    '电力': 'utility', '公用': 'utility', '水务': 'utility', '燃气': 'utility',
    '化工': 'chemical', '化学': 'chemical',
    '建筑': 'construction', '建材': 'construction',
    '证券': 'broker', '券商': 'broker',
    '有色': 'steel', '采矿': 'steel', '矿业': 'steel',
    '农业': 'food', '牧': 'food', '渔': 'food',
  }
  for (const [cn, key] of Object.entries(cnMap)) {
    if (industry.includes(cn)) return PE_THRESHOLDS[key]
  }
  return PE_THRESHOLDS.default
}

/**
 * 获取趋势结论（用于诊断区卡片）
 */
export function getTrendConclusion(signals = []) {
  const bullish = signals.filter(s => s.type === 'bullish').length
  const bearish = signals.filter(s => s.type === 'bearish').length

  if (bullish >= 4) return { text: '强势多头', color: '#30d158', icon: '↑' }
  if (bullish >= 2 && bullish > bearish) return { text: '偏多', color: '#30d158', icon: '↑' }
  if (bearish >= 4) return { text: '弱势空头', color: '#ff453a', icon: '↓' }
  if (bearish >= 2 && bearish > bullish) return { text: '偏空', color: '#ff453a', icon: '↓' }
  return { text: '震荡', color: '#ffd60a', icon: '→' }
}

/**
 * 获取估值结论（用于诊断区卡片）
 */
export function getValuationConclusion(fundamental) {
  const latest = fundamental?.latest
  if (!latest || latest.pe == null) return { text: '暂无数据', color: '#64748b', icon: '?' }

  const industry = latest.industry || ''
  const t = getPEThresholds(industry)
  const pe = latest.pe
  if (pe <= 0) return { text: '亏损', color: '#ff453a', icon: '✗' }
  if (pe <= t.low) return { text: '低估', color: '#30d158', icon: '✓' }
  if (pe <= t.fair) return { text: '合理', color: '#30d158', icon: '✓' }
  if (pe <= t.high) return { text: '偏高', color: '#ffd60a', icon: '!' }
  return { text: '高估', color: '#ff453a', icon: '!' }
}

/**
 * 获取资金结论（用于诊断区卡片）
 */
export function getCapitalConclusion(capitalFlow) {
  const signal = capitalFlow?.priceVolumeSignal
  if (!signal) return { text: '暂无数据', color: '#64748b', icon: '?' }

  if (signal === '放量上涨') return { text: '资金流入', color: '#30d158', icon: '↑' }
  if (signal === '温和上涨') return { text: '温和流入', color: '#30d158', icon: '↑' }
  if (signal === '放量下跌') return { text: '资金流出', color: '#ff453a', icon: '↓' }
  if (signal === '缩量下跌') return { text: '缩量流出', color: '#ff453a', icon: '↓' }
  return { text: '平稳', color: '#ffd60a', icon: '→' }
}
