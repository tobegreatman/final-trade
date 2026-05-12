import { MARKET_STATUS } from './constants.js'

/**
 * 六维大盘判定算法
 * 维度 1: 趋势状态（均线排列 + 价格vs MA60 + MA60拐头方向）
 * 维度 2: 涨跌家数（市场广度）
 * 维度 3: 涨停/跌停（情绪极端度）
 * 维度 4: 融资余额（杠杆资金趋势）
 * 维度 5: 成交额（流动性）
 * 维度 6: 北向资金（外资方向）
 */
export function judgeMarket(indices, breadth, northbound, margin, limitStats) {
  const idx = indices.sh || {}
  const klines = idx.klines || []
  const ma = idx.ma || {}
  const quote = idx.quote || {}

  const signals = []
  let bullCount = 0
  let bearCount = 0

  // 维度 1: 趋势状态（合并原均线排列 + 价格vs MA60）
  const trendSignal = judgeTrend(quote, ma, klines)
  signals.push(trendSignal)
  if (trendSignal.bull) bullCount++
  if (trendSignal.bear) bearCount++

  // 维度 2: 涨跌家数
  const breadthSignal = judgeBreadth(breadth)
  signals.push(breadthSignal)
  if (breadthSignal.bull) bullCount++
  if (breadthSignal.bear) bearCount++

  // 维度 3: 涨停/跌停（情绪极端度）
  const limitSignal = judgeLimitUp(limitStats)
  signals.push(limitSignal)
  if (limitSignal.bull) bullCount++
  if (limitSignal.bear) bearCount++

  // 维度 4: 融资余额趋势
  const marginSignal = judgeMarginBalance(margin)
  signals.push(marginSignal)
  if (marginSignal.bull) bullCount++
  if (marginSignal.bear) bearCount++

  // 维度 5: 成交额
  const volSignal = judgeTurnover(indices)
  signals.push(volSignal)
  if (volSignal.bull) bullCount++
  if (volSignal.bear) bearCount++

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

function judgeTrend(quote, ma, klines) {
  if (!ma.ma20 || !ma.ma60 || !ma.ma120 || !quote.close) {
    return { dimension: '趋势状态', value: '数据不足', bull: false, bear: false, desc: 'MA或价格数据不完整' }
  }
  const close = quote.close
  const { ma20, ma60, ma120 } = ma
  const bullish = ma20 > ma60 && ma60 > ma120
  const bearish = ma20 < ma60 && ma60 < ma120
  const aboveMA60 = close > ma60
  const belowMA60 = close < ma60
  const trendingUp = ma60TrendUp(klines)
  const trendingDown = ma60TrendDown(klines)

  // 强多头: 均线多头排列 + 站上MA60 + MA60拐头向上
  if (bullish && aboveMA60 && trendingUp) {
    return { dimension: '趋势状态', value: '多头趋势', bull: true, bear: false, desc: `多头排列，价格${close.toFixed(0)}站上MA60(${ma60.toFixed(0)})，MA60拐头向上` }
  }
  // 弱多头: 站上MA60 + MA60拐头向上（均线未完全多头）
  if (aboveMA60 && trendingUp) {
    return { dimension: '趋势状态', value: '偏多震荡', bull: true, bear: false, desc: `价格站上MA60(${ma60.toFixed(0)})，MA60拐头向上，均线尚未完全多头` }
  }
  // 强空头: 均线空头排列 + 跌破MA60 + MA60拐头向下
  if (bearish && belowMA60 && trendingDown) {
    return { dimension: '趋势状态', value: '空头趋势', bull: false, bear: true, desc: `空头排列，价格${close.toFixed(0)}跌破MA60(${ma60.toFixed(0)})，MA60拐头向下` }
  }
  // 弱空头: 跌破MA60 + MA60拐头向下
  if (belowMA60 && trendingDown) {
    return { dimension: '趋势状态', value: '偏空震荡', bull: false, bear: true, desc: `价格跌破MA60(${ma60.toFixed(0)})，MA60拐头向下` }
  }
  return { dimension: '趋势状态', value: '震荡', bull: false, bear: false, desc: '均线缠绕，价格在MA60附近，无明确方向' }
}

function ma60TrendUp(klines) {
  if (klines.length < 65) return false
  const last60 = klines.slice(-60).map(k => k.close)
  const prev60 = klines.slice(-61, -1).map(k => k.close)
  return last60.reduce((a, b) => a + b, 0) / 60 > prev60.reduce((a, b) => a + b, 0) / 60
}

function ma60TrendDown(klines) {
  if (klines.length < 65) return false
  const last60 = klines.slice(-60).map(k => k.close)
  const prev60 = klines.slice(-61, -1).map(k => k.close)
  return last60.reduce((a, b) => a + b, 0) / 60 < prev60.reduce((a, b) => a + b, 0) / 60
}

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

function judgeLimitUp(limitStats) {
  if (!limitStats || limitStats.limitUp == null) {
    return { dimension: '涨停/跌停', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const { limitUp = 0, limitDown = 0, sealingRate = 0 } = limitStats
  const ratio = limitDown > 0 ? (limitUp / limitDown).toFixed(1) : (limitUp > 0 ? '∞' : '0')
  const seal = sealingRate ? `，封板率${sealingRate.toFixed(0)}%` : ''

  if (limitUp >= 100) {
    return { dimension: '涨停/跌停', value: `${limitUp}/${limitDown} 过热`, bull: false, bear: false, desc: `涨停${limitUp}家/跌停${limitDown}家${seal}，涨停>100情绪过热，需警惕` }
  }
  if (limitUp > 0 && (limitDown === 0 || limitUp / limitDown > 5)) {
    return { dimension: '涨停/跌停', value: `${limitUp}/${limitDown} 活跃`, bull: true, bear: false, desc: `涨停${limitUp}家/跌停${limitDown}家${seal}，赚钱效应较好` }
  }
  if (limitDown >= 50) {
    return { dimension: '涨停/跌停', value: `${limitUp}/${limitDown} 恐慌`, bull: false, bear: true, desc: `跌停${limitDown}家，市场恐慌情绪蔓延` }
  }
  if (limitDown > 0 && (limitUp === 0 || limitDown / limitUp > 5)) {
    return { dimension: '涨停/跌停', value: `${limitUp}/${limitDown} 冰冷`, bull: false, bear: true, desc: `跌停${limitDown}家远超涨停${limitUp}家，市场极度低迷` }
  }
  return { dimension: '涨停/跌停', value: `${limitUp}/${limitDown}`, bull: false, bear: false, desc: `涨停${limitUp}家/跌停${limitDown}家${seal}，情绪中性` }
}

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

function judgeTurnover(indices) {
  const shKlines = indices?.sh?.klines || []
  const szKlines = indices?.sz?.klines || []
  if (shKlines.length < 5) {
    return { dimension: '成交额', value: '数据不足', bull: false, bear: false, desc: '' }
  }

  const n = Math.min(shKlines.length, 20)
  const amounts = []
  for (let i = shKlines.length - n; i < shKlines.length; i++) {
    const shAmt = shKlines[i]?.amount || 0
    const szAmt = szKlines[i]?.amount || 0
    amounts.push(shAmt + szAmt)
  }

  const slice5 = amounts.slice(-5)
  const ma5 = slice5.reduce((a, b) => a + b, 0) / slice5.length
  const ma20 = amounts.reduce((a, b) => a + b, 0) / amounts.length
  const ratio = ma20 > 0 ? ma5 / ma20 : 0

  const fmt = (v) => {
    if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
    if (v >= 1e8) return (v / 1e8).toFixed(0) + '亿'
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
    return v.toFixed(0)
  }

  if (ratio > 1.2 && ma5 > 0) {
    return { dimension: '成交额', value: `放量 ${fmt(ma5)}`, bull: true, bear: false, desc: `近5日均额${fmt(ma5)}，较20日均额放大${((ratio - 1) * 100).toFixed(0)}%` }
  }
  if (ratio < 0.7) {
    return { dimension: '成交额', value: `缩量 ${fmt(ma5)}`, bull: false, bear: true, desc: `近5日均额${fmt(ma5)}，较20日均额萎缩${((1 - ratio) * 100).toFixed(0)}%` }
  }
  return { dimension: '成交额', value: `平稳 ${fmt(ma5)}`, bull: false, bear: false, desc: `近5日均额${fmt(ma5)}，量能持平` }
}

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
