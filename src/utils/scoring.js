/**
 * 动态权重评分引擎 — 个股综合分析
 * v3: 修复默认分抬高分值、移除ROE双重年化、增加高置信度、细化建议文案
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
  mining: { low: 10, fair: 20, high: 35 },
  agriculture: { low: 12, fair: 25, high: 40 },
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

  // 1. 均线排列 (0-10)
  const maBullish = techSignals.find(s => s.source === 'MA' && s.type === 'bullish')
  const maBearish = techSignals.find(s => s.source === 'MA' && s.type === 'bearish')
  const maCross = techSignals.find(s => s.source === 'MA' && (s.text.includes('金叉') || s.text.includes('死叉')))
  if (maBullish?.text?.includes('多头排列')) {
    tech.items.push({ name: '均线排列', score: 10, max: 10, desc: '多头排列' })
  } else if (maBearish?.text?.includes('空头排列')) {
    tech.items.push({ name: '均线排列', score: 0, max: 10, desc: '空头排列' })
  } else if (maCross) {
    const crossScore = maCross.type === 'bullish' ? 7 : 3
    tech.items.push({ name: '均线排列', score: crossScore, max: 10, desc: maCross.text })
  } else {
    tech.items.push({ name: '均线排列', score: 5, max: 10, desc: '交叉/中性' })
  }

  // 2. MACD 信号 (0-8) — 累加同源信号
  const macdBullish = techSignals.filter(s => s.source === 'MACD' && s.type === 'bullish')
  const macdBearish = techSignals.filter(s => s.source === 'MACD' && s.type === 'bearish')
  let macdScore = 4
  const macdDescs = []
  for (const s of macdBullish) {
    if (s.text.includes('金叉')) { macdScore += 2; macdDescs.push(s.text) }
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
  let kdjScore = 3
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
  let rsiScore = 3
  const rsiDescs = []
  let hasResonanceBull = false
  let hasResonanceBear = false
  // 第一轮：检测多周期共振信号（已隐含单周期超买/超卖，后续跳过避免重复）
  for (const s of rsiSignals) {
    if (s.text.includes('共振超卖')) { rsiScore += 3; rsiDescs.push(s.text); hasResonanceBull = true }
    else if (s.text.includes('共振超买')) { rsiScore -= 3; rsiDescs.push(s.text); hasResonanceBear = true }
  }
  // 第二轮：计分非共振的单周期信号，但跳过已被共振覆盖的方向
  for (const s of rsiSignals) {
    if (s.text.includes('共振')) continue
    if (hasResonanceBull && (s.text.includes('严重超卖') || s.text.includes('超卖'))) continue
    if (hasResonanceBear && (s.text.includes('严重超买') || s.text.includes('超买'))) continue
    if (s.text.includes('严重超卖') || s.text.includes('底背离')) { rsiScore += 3; rsiDescs.push(s.text) }
    else if (s.text.includes('超卖') || s.text.includes('金叉')) { rsiScore += 2; rsiDescs.push(s.text) }
    else if (s.text.includes('严重超买') || s.text.includes('顶背离')) { rsiScore -= 3; rsiDescs.push(s.text) }
    else if (s.text.includes('超买') || s.text.includes('死叉')) { rsiScore -= 2; rsiDescs.push(s.text) }
  }
  rsiScore = Math.max(0, Math.min(7, rsiScore))
  tech.items.push({ name: 'RSI', score: rsiScore, max: 7, desc: rsiDescs.length ? rsiDescs.join('，') : '正常区间' })

  // 5. BOLL 信号 (0-4) — 均值回归视角：上轨=超买预警，下轨=超卖机会
  const bollSignals = techSignals.filter(s => s.source === 'BOLL')
  const bollPosition = bollSignals.find(s => !s.text.includes('收口'))
  const bollSqueeze = bollSignals.find(s => s.text.includes('收口'))
  let bollScore = 2
  let bollDesc = '中轨附近'
  if (bollPosition?.text?.includes('上轨')) {
    bollScore = 1; bollDesc = '触及上轨（超买预警）'
  } else if (bollPosition?.text?.includes('上方')) {
    bollScore = 3; bollDesc = '中轨上方（偏强）'
  } else if (bollPosition?.text?.includes('下方')) {
    bollScore = 2; bollDesc = '中轨下方（偏弱）'
  } else if (bollPosition?.text?.includes('下轨')) {
    bollScore = 4; bollDesc = '触及下轨（超卖机会）'
  }
  if (bollSqueeze) {
    bollScore = Math.min(4, bollScore + 1)
    bollDesc += '，收口预警'
  }
  tech.items.push({ name: 'BOLL', score: bollScore, max: 4, desc: bollDesc })

  // 6. 量价信号 (0-4) — 按优先级选取最强信号
  const volSignals = techSignals.filter(s => s.source === '量价')
  const volBullish = volSignals.find(s => s.type === 'bullish')
  const volBearish = volSignals.find(s => s.type === 'bearish')
  const volNeutral = volSignals.find(s => s.type === 'neutral')
  const volSignal = volBullish || volBearish || volNeutral || volSignals[0]
  if (volSignal?.text?.includes('放量上涨')) {
    tech.items.push({ name: '量价', score: 4, max: 4, desc: volSignal.text })
  } else if (volSignal?.text?.includes('量价配合')) {
    tech.items.push({ name: '量价', score: 3, max: 4, desc: '量价配合良好' })
  } else if (volSignal?.text?.includes('缩量回调')) {
    tech.items.push({ name: '量价', score: 2, max: 4, desc: '缩量回调' })
  } else if (volSignal?.text?.includes('放量下跌')) {
    tech.items.push({ name: '量价', score: 0, max: 4, desc: '放量下跌' })
  } else {
    tech.items.push({ name: '量价', score: 2, max: 4, desc: volSignal?.text || '中性' })
  }

  tech.score = tech.items.reduce((s, i) => s + i.score, 0)

  // ========== 基本面评分 (0-30) ==========
  const fund = dimensions.fundamental
  const latest = fundamental?.latest

  // 暂无数据默认分（保守中位，保证: 坏数据 < 无数据 < 中性 < 好数据）
  const FUND_MISSING = {
    PE: { score: 2, max: 8 },
    ROE: { score: 2, max: 8 },
    revenue: { score: 1, max: 5 },
    profit: { score: 1, max: 5 },
    debt: { score: 1, max: 4 },
  }

  if (latest) {
    // 东方财富 ROEJQ 字段本身就是报告期加权 ROE，无需再年化
    const roe = latest.roe

    // 1. PE 估值 (0-8)
    if (latest.pe != null) {
      const t = getPEThresholds(industry)
      const pe = latest.pe
      if (pe < 0) {
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
      fund.items.push({ name: 'PE估值', ...FUND_MISSING.PE, desc: '暂无数据' })
    }

    // 2. ROE (0-8) — 直接使用后端返回值，不做年化
    if (roe != null) {
      if (roe < 0) {
        fund.items.push({ name: 'ROE', score: 0, max: 8, desc: `ROE ${roe.toFixed(1)}%，亏损` })
      } else if (roe >= 20) {
        fund.items.push({ name: 'ROE', score: 8, max: 8, desc: `ROE ${roe.toFixed(1)}%，优秀` })
      } else if (roe >= 12) {
        fund.items.push({ name: 'ROE', score: 6, max: 8, desc: `ROE ${roe.toFixed(1)}%，良好` })
      } else if (roe >= 6) {
        fund.items.push({ name: 'ROE', score: 4, max: 8, desc: `ROE ${roe.toFixed(1)}%，一般` })
      } else {
        fund.items.push({ name: 'ROE', score: 1, max: 8, desc: `ROE ${roe.toFixed(1)}%，偏弱` })
      }
    } else {
      fund.items.push({ name: 'ROE', ...FUND_MISSING.ROE, desc: '暂无数据' })
    }

    // 3. 营收增长 (0-5) — 用 >= 保持边界一致
    if (latest.revenueGrowth != null) {
      if (latest.revenueGrowth >= 20) {
        fund.items.push({ name: '营收增长', score: 5, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，高增` })
      } else if (latest.revenueGrowth >= 10) {
        fund.items.push({ name: '营收增长', score: 4, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，稳健` })
      } else if (latest.revenueGrowth >= 0) {
        fund.items.push({ name: '营收增长', score: 2, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，低速` })
      } else {
        fund.items.push({ name: '营收增长', score: 0, max: 5, desc: `营收增长 ${latest.revenueGrowth.toFixed(1)}%，下滑` })
      }
    } else {
      fund.items.push({ name: '营收增长', ...FUND_MISSING.revenue, desc: '暂无数据' })
    }

    // 4. 利润增长 (0-5) — 亏损企业增速封顶，避免"减亏"被高估
    if (latest.profitGrowth != null) {
      const isLoss = latest.pe != null && latest.pe < 0
      if (isLoss) {
        // 亏损企业：无论增速多高，仍处于亏损，封顶 3/5
        fund.items.push({ name: '净利增长', score: 3, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，仍亏损` })
      } else if (latest.profitGrowth >= 20) {
        fund.items.push({ name: '净利增长', score: 5, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，高增` })
      } else if (latest.profitGrowth >= 10) {
        fund.items.push({ name: '净利增长', score: 4, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，稳健` })
      } else if (latest.profitGrowth >= 0) {
        fund.items.push({ name: '净利增长', score: 2, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，低速` })
      } else {
        fund.items.push({ name: '净利增长', score: 0, max: 5, desc: `净利增长 ${latest.profitGrowth.toFixed(1)}%，下滑` })
      }
    } else {
      fund.items.push({ name: '净利增长', ...FUND_MISSING.profit, desc: '暂无数据' })
    }

    // 5. 负债率 (0-4) — 用 <= 保持边界一致
    if (latest.debtRatio != null) {
      if (latest.debtRatio <= 30) {
        fund.items.push({ name: '负债率', score: 4, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，很低` })
      } else if (latest.debtRatio <= 50) {
        fund.items.push({ name: '负债率', score: 3, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，健康` })
      } else if (latest.debtRatio <= 70) {
        fund.items.push({ name: '负债率', score: 2, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，中等` })
      } else {
        fund.items.push({ name: '负债率', score: 0, max: 4, desc: `负债率 ${latest.debtRatio.toFixed(1)}%，偏高` })
      }
    } else {
      fund.items.push({ name: '负债率', ...FUND_MISSING.debt, desc: '暂无数据' })
    }
  } else {
    // 整体无数据，使用保守默认分
    fund.items.push(
      { name: 'PE估值', ...FUND_MISSING.PE, desc: '暂无数据' },
      { name: 'ROE', ...FUND_MISSING.ROE, desc: '暂无数据' },
      { name: '营收增长', ...FUND_MISSING.revenue, desc: '暂无数据' },
      { name: '净利增长', ...FUND_MISSING.profit, desc: '暂无数据' },
      { name: '负债率', ...FUND_MISSING.debt, desc: '暂无数据' }
    )
  }

  fund.score = fund.items.reduce((s, i) => s + i.score, 0)

  // ========== 资金面评分 (0-25) ==========
  const cap = dimensions.capital
  cap.max = 25
  const priceVolumeSignal = capitalFlow?.priceVolumeSignal

  // 量价趋势评分 (0-5) — K线派生数据，权重低于真实资金流
  let volScore = 3
  let volDesc = priceVolumeSignal || '中性'
  if (priceVolumeSignal === '放量上涨') { volScore = 5; volDesc = '放量上涨' }
  else if (priceVolumeSignal === '温和上涨') { volScore = 4; volDesc = '温和上涨' }
  else if (priceVolumeSignal === '缩量调整' || priceVolumeSignal === '量价平稳') { volScore = 3; volDesc = priceVolumeSignal }
  else if (priceVolumeSignal === '温和下跌') { volScore = 1; volDesc = '温和下跌' }
  else if (priceVolumeSignal === '放量下跌') { volScore = 0; volDesc = '放量下跌' }
  else if (priceVolumeSignal === '缩量下跌') { volScore = 1; volDesc = '缩量下跌' }

  cap.items.push({ name: '量价趋势', score: volScore, max: 5, desc: volDesc })

  // 主力资金评分 (0-8) — 真实交易所资金流向数据，资金面最高权重
  const mfLatest = capitalFlow?._mainForceLatest
  const mfSummary = capitalFlow?._mainForceSummary
  if (mfLatest?.mainNetInflow != null) {
    let mfScore = 3
    let mfDesc = '主力进出持平'
    // 综合今日主力净占比 + 近5日趋势判断
    const todayPct = mfLatest.mainNetPct
    const avg5Pct = mfSummary?.mainNetAvgPct5 ?? 0
    const combinedPct = todayPct * 0.4 + avg5Pct * 0.6
    if (combinedPct > 5) { mfScore = 8; mfDesc = '主力持续大幅流入' }
    else if (combinedPct > 2) { mfScore = 6; mfDesc = '主力流入' }
    else if (combinedPct > 0) { mfScore = 4; mfDesc = '主力微幅流入' }
    else if (combinedPct === 0) { mfScore = 3; mfDesc = '主力进出持平' }
    else if (combinedPct >= -2) { mfScore = 2; mfDesc = '主力微幅流出' }
    else if (combinedPct >= -5) { mfScore = 1; mfDesc = '主力流出' }
    else { mfScore = 0; mfDesc = '主力大幅流出' }
    cap.items.push({ name: '主力资金', score: mfScore, max: 8, desc: mfDesc })
  } else {
    cap.items.push({ name: '主力资金', score: 2, max: 8, desc: '暂无数据' })
  }

  // 融资融券评分（基于余额变化率）(0-6)
  const marginLatest = capitalFlow?._marginLatest
  if (marginLatest?.balanceGrowth != null) {
    let marginScore = 3
    let marginDesc = '融资余额持平'
    const g = marginLatest.balanceGrowth
    if (g >= 2) { marginScore = 6; marginDesc = '融资余额上升' }
    else if (g > 0) { marginScore = 5; marginDesc = '融资余额微升' }
    else if (g === 0) { marginScore = 3; marginDesc = '融资余额持平' }
    else if (g > -2) { marginScore = 2; marginDesc = '融资余额微降' }
    else if (g >= -5) { marginScore = 1; marginDesc = '融资余额下降' }
    else { marginScore = 0; marginDesc = '融资余额大幅下降' }
    cap.items.push({ name: '融资融券', score: marginScore, max: 6, desc: marginDesc })
  } else {
    cap.items.push({ name: '融资融券', score: 2, max: 6, desc: '暂无数据' })
  }

  // 北向资金评分（基于季度持股变动）(0-6)
  const nbLatest = capitalFlow?._northboundLatest
  if (nbLatest?.changeRatio != null) {
    let nbScore = 3
    let nbDesc = '北向持股持平'
    const r = nbLatest.changeRatio
    if (r >= 10) { nbScore = 6; nbDesc = '北向大幅增持' }
    else if (r >= 2) { nbScore = 5; nbDesc = '北向增持' }
    else if (r > 0) { nbScore = 4; nbDesc = '北向微增' }
    else if (r === 0) { nbScore = 3; nbDesc = '北向持股持平' }
    else if (r > -2) { nbScore = 2; nbDesc = '北向微减' }
    else if (r > -10) { nbScore = 1; nbDesc = '北向减持' }
    else { nbScore = 0; nbDesc = '北向大幅减持' }
    cap.items.push({ name: '北向资金', score: nbScore, max: 6, desc: nbDesc })
  } else {
    cap.items.push({ name: '北向资金', score: 2, max: 6, desc: '暂无数据' })
  }

  cap.score = cap.items.reduce((s, i) => s + i.score, 0)

  // ========== 动态权重合成 ==========
  const hasFundData = !!fundamental?.latest

  const weights = hasFundData
    ? { technical: 0.45, fundamental: 0.30, capital: 0.25 }
    : { technical: 0.60, fundamental: 0.15, capital: 0.25 }

  const total = Math.round(
    tech.score / tech.max * 100 * weights.technical +
    fund.score / fund.max * 100 * weights.fundamental +
    cap.score / cap.max * 100 * weights.capital
  )

  // 置信度 — 根据数据完整度分三档
  const fundDataCount = fund.items.filter(i => !i.desc.includes('暂无数据')).length
  const capDataCount = cap.items.filter(i => !i.desc.includes('暂无数据')).length
  const totalDataPoints = fundDataCount + capDataCount
  let confidence, confidenceStars
  if (fundDataCount >= 4 && capDataCount >= 3) {
    confidence = 'high'; confidenceStars = 4
  } else if (fundDataCount >= 2 && capDataCount >= 2) {
    confidence = 'medium'; confidenceStars = 3
  } else {
    confidence = 'low'; confidenceStars = 2
  }

  // 操作建议 — 综合评分 + 信号强度给出具体方向
  let suggestion, suggestionColor
  const bullishCount = techSignals.filter(s => s.type === 'bullish').length
  const bearishCount = techSignals.filter(s => s.type === 'bearish').length
  const techPct = tech.score / tech.max

  if (total >= 70) {
    suggestion = bullishCount >= 4 ? '多头强势，可逢回调关注' : '综合偏强，持续跟踪'
    suggestionColor = '#30d158'
  } else if (total >= 50) {
    suggestion = totalDataPoints < 5 ? '数据不足，建议仅供参考' : '多空交织，观望为主'
    suggestionColor = '#ffd60a'
  } else if (total >= 30) {
    // 技术面得分高于中性但信号偏空 → 提示风险而非直接判空
    if (bearishCount >= 3 && techPct < 0.5) {
      suggestion = '空头占优，等待企稳信号'
    } else if (bearishCount >= 3) {
      suggestion = '技术信号偏空，注意短期风险'
    } else {
      suggestion = '走势偏弱，谨慎参与'
    }
    suggestionColor = '#ff9500'
  } else {
    suggestion = totalDataPoints < 3 ? '数据稀缺，无法有效评估' : '综合偏空，建议回避'
    suggestionColor = '#ff453a'
  }

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
    '化工': 'chemical', '化学': 'chemical', '塑料': 'chemical', '橡胶': 'chemical', '纤维': 'chemical', '涂料': 'chemical',
    '建筑': 'construction', '建材': 'construction',
    '证券': 'broker', '券商': 'broker',
    '有色': 'mining', '采矿': 'mining', '矿业': 'mining',
    '农业': 'agriculture', '牧': 'agriculture', '渔': 'agriculture',
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
  if (pe < 0) return { text: '亏损', color: '#ff453a', icon: '✗' }
  if (pe <= t.low) return { text: '低估', color: '#30d158', icon: '✓' }
  if (pe <= t.fair) return { text: '合理', color: '#30d158', icon: '✓' }
  if (pe <= t.high) return { text: '偏高', color: '#ffd60a', icon: '!' }
  return { text: '高估', color: '#ff453a', icon: '!' }
}

/**
 * 获取资金结论（用于诊断区卡片）
 * 使用与评分引擎一致的 combinedPct 加权公式
 */
export function getCapitalConclusion(capitalFlow) {
  const signal = capitalFlow?.priceVolumeSignal
  const mfLatest = capitalFlow?._mainForceLatest
  const mfSummary = capitalFlow?._mainForceSummary

  if (!signal && !mfLatest) return { text: '暂无数据', color: '#64748b', icon: '?' }

  // 使用与评分引擎一致的 40/60 加权公式
  if (mfLatest?.mainNetPct != null) {
    const todayPct = mfLatest.mainNetPct
    const avg5Pct = mfSummary?.mainNetAvgPct5 ?? 0
    const combinedPct = todayPct * 0.4 + avg5Pct * 0.6
    if (combinedPct > 2) return { text: '主力流入', color: '#30d158', icon: '↑' }
    if (combinedPct > 0) return { text: '温和流入', color: '#30d158', icon: '↑' }
    if (combinedPct === 0) return { text: '平稳', color: '#ffd60a', icon: '→' }
    if (combinedPct >= -2) return { text: '温和流出', color: '#ffd60a', icon: '→' }
    return { text: '主力流出', color: '#ff453a', icon: '↓' }
  }

  if (!signal) return { text: '暂无数据', color: '#64748b', icon: '?' }

  if (signal === '放量上涨') return { text: '资金流入', color: '#30d158', icon: '↑' }
  if (signal === '温和上涨') return { text: '温和流入', color: '#30d158', icon: '↑' }
  if (signal === '放量下跌') return { text: '资金流出', color: '#ff453a', icon: '↓' }
  if (signal === '缩量下跌') return { text: '缩量流出', color: '#ff453a', icon: '↓' }
  return { text: '平稳', color: '#ffd60a', icon: '→' }
}
