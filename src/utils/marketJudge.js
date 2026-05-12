import { MARKET_STATUS } from './constants.js'

/**
 * 六维大盘判定算法
 * 输入: indices(含MA), breadth, northbound
 * 输出: 综合判定结果
 */
export function judgeMarket(indices, breadth, northbound) {
  // 默认用上证指数判断
  const idx = indices.sh || {}
  const klines = idx.klines || []
  const ma = idx.ma || {}
  const quote = idx.quote || {}

  const signals = []
  let bullCount = 0
  let bearCount = 0

  // 维度 1: 均线排列
  const maSignal = judgeMA(ma)
  signals.push(maSignal)
  if (maSignal.bull) bullCount++
  if (maSignal.bear) bearCount++

  // 维度 2: 价格 vs MA60
  const priceSignal = judgePriceMA60(quote, ma, klines)
  signals.push(priceSignal)
  if (priceSignal.bull) bullCount++
  if (priceSignal.bear) bearCount++

  // 维度 3: 创新高/新低 (使用涨跌家数近似)
  const breadthSignal = judgeBreadth(breadth)
  signals.push(breadthSignal)
  if (breadthSignal.bull) bullCount++
  if (breadthSignal.bear) bearCount++

  // 维度 4: 涨跌家数
  const ratioSignal = judgeUpDownRatio(breadth)
  signals.push(ratioSignal)
  if (ratioSignal.bull) bullCount++
  if (ratioSignal.bear) bearCount++

  // 维度 5: 成交量趋势
  const volSignal = judgeVolume(klines)
  signals.push(volSignal)
  if (volSignal.bull) bullCount++
  if (volSignal.bear) bearCount++

  // 维度 6: 北向资金
  const nbSignal = judgeNorthbound(northbound)
  signals.push(nbSignal)
  if (nbSignal.bull) bullCount++
  if (nbSignal.bear) bearCount++

  // 综合判定
  const status = determineStatus(bullCount, bearCount)
  const confirmed = bullCount >= 3 || bearCount >= 3

  // 长窗口速判
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

function judgeMA(ma) {
  if (!ma.ma20 || !ma.ma60 || !ma.ma120) {
    return { dimension: '均线排列', value: '数据不足', bull: false, bear: false, desc: 'MA数据不完整' }
  }
  if (ma.ma20 > ma.ma60 && ma.ma60 > ma.ma120) {
    return { dimension: '均线排列', value: '多头排列', bull: true, bear: false, desc: `MA20(${ma.ma20.toFixed(0)}) > MA60(${ma.ma60.toFixed(0)}) > MA120(${ma.ma120.toFixed(0)})` }
  }
  if (ma.ma20 < ma.ma60 && ma.ma60 < ma.ma120) {
    return { dimension: '均线排列', value: '空头排列', bull: false, bear: true, desc: `MA20(${ma.ma20.toFixed(0)}) < MA60(${ma.ma60.toFixed(0)}) < MA120(${ma.ma120.toFixed(0)})` }
  }
  return { dimension: '均线排列', value: '缠绕', bull: false, bear: false, desc: '均线无明确方向' }
}

function judgePriceMA60(quote, ma, klines) {
  if (!quote.close || !ma.ma60) {
    return { dimension: '价格 vs MA60', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const close = quote.close
  const ma60 = ma.ma60
  if (close > ma60 && ma60TrendUp(klines)) {
    return { dimension: '价格 vs MA60', value: `站上MA60 (${close.toFixed(0)})`, bull: true, bear: false, desc: `收盘价 ${close.toFixed(0)} > MA60 ${ma60.toFixed(0)}，MA60拐头向上` }
  }
  if (close < ma60) {
    return { dimension: '价格 vs MA60', value: `跌破MA60 (${close.toFixed(0)})`, bull: false, bear: true, desc: `收盘价 ${close.toFixed(0)} < MA60 ${ma60.toFixed(0)}` }
  }
  return { dimension: '价格 vs MA60', value: 'MA60附近', bull: false, bear: false, desc: `价格在MA60附近震荡` }
}

function ma60TrendUp(klines) {
  if (klines.length < 65) return false
  const last60 = klines.slice(-60).map(k => k.close)
  const prev60 = klines.slice(-61, -1).map(k => k.close)
  const ma60Now = last60.reduce((a, b) => a + b, 0) / 60
  const ma60Prev = prev60.reduce((a, b) => a + b, 0) / 60
  return ma60Now > ma60Prev
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

function judgeUpDownRatio(breadth) {
  if (!breadth) {
    return { dimension: '涨跌比', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const { up, down } = breadth
  const total = up + down
  const upPct = total > 0 ? (up / total * 100).toFixed(1) : 0
  if (up > down * 1.5) {
    return { dimension: '涨跌比', value: `${upPct}%上涨`, bull: true, bear: false, desc: `上涨家数占比${upPct}%` }
  }
  if (down > up * 1.5) {
    return { dimension: '涨跌比', value: `${100 - upPct}%下跌`, bull: false, bear: true, desc: `下跌家数占比${(100 - upPct).toFixed(1)}%` }
  }
  return { dimension: '涨跌比', value: `${upPct}%上涨`, bull: false, bear: false, desc: '涨跌各半' }
}

function judgeVolume(klines) {
  if (klines.length < 20) {
    return { dimension: '成交量', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const vols = klines.map(k => k.volume)
  const ma5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5
  const ma20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20
  const ratio = ma20 > 0 ? ma5 / ma20 : 0
  if (ratio > 1.0) {
    return { dimension: '成交量', value: `放量 (${ratio.toFixed(2)})`, bull: true, bear: false, desc: `5日均量/20日均量 = ${ratio.toFixed(2)}` }
  }
  if (ratio < 0.7) {
    return { dimension: '成交量', value: `缩量 (${ratio.toFixed(2)})`, bull: false, bear: true, desc: `5日均量/20日均量 = ${ratio.toFixed(2)}` }
  }
  return { dimension: '成交量', value: `量能平稳 (${ratio.toFixed(2)})`, bull: false, bear: false, desc: `5日均量/20日均量 = ${ratio.toFixed(2)}` }
}

function judgeNorthbound(northbound) {
  if (!northbound || !northbound.length) {
    return { dimension: '北向资金', value: '数据不足', bull: false, bear: false, desc: '' }
  }
  const inflowDays = northbound.filter(d => d.totalNet > 0).length
  const total = northbound.length
  if (inflowDays >= 4) {
    return { dimension: '北向资金', value: `${inflowDays}/${total}日净流入`, bull: true, bear: false, desc: `近${total}日中${inflowDays}日净流入` }
  }
  if (inflowDays <= 1) {
    return { dimension: '北向资金', value: `${inflowDays}/${total}日净流入`, bull: false, bear: true, desc: `近${total}日中仅${inflowDays}日净流入` }
  }
  return { dimension: '北向资金', value: `${inflowDays}/${total}日净流入`, bull: false, bear: false, desc: '北向资金方向不明' }
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
  // 条件 1: 指数收盘价 > MA60
  const cond1 = close > ma60
  conditions.push({ label: `指数收盘价(${close.toFixed(0)}) > MA60(${ma60.toFixed(0)})`, pass: cond1 })

  // 条件 2: MA60 连续 3 天拐头向上
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

  // 条件 3: 涨跌比 > 1.5
  const cond3 = breadth && breadth.up && breadth.down ? (breadth.up / breadth.down > 1.5) : false
  conditions.push({ label: `涨跌比 > 1.5 (当前${breadth?.up && breadth?.down ? (breadth.up / breadth.down).toFixed(1) : '?'})`, pass: cond3 })

  const allPass = cond1 && cond2 && cond3
  return { conditions, allPass, message: allPass ? '多头窗口已开启' : '多头窗口未开启' }
}
