import { STRATEGY_PARAMS } from './constants.js'

/**
 * 计算 ATR(14)
 * @param {Array} klines - K线数组，需有 high/low/close 字段，至少 15 根
 * @returns {number} ATR 值
 */
export function calcATR(klines) {
  if (!klines || klines.length < 15) return 0
  const trList = []
  for (let i = 1; i < klines.length; i++) {
    const curr = klines[i]
    const prev = klines[i - 1]
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    )
    trList.push(tr)
  }
  // 取最后 14 个 TR 的均值
  const last14 = trList.slice(-14)
  return last14.reduce((a, b) => a + b, 0) / last14.length
}

/**
 * 计算止损价
 * @param {number} buyPrice - 买入价
 * @param {number} atr - ATR 值
 * @param {string} strategy - 策略 key (trend/pullback/bottom)
 * @returns {number} 止损价
 */
export function calcStopLoss(buyPrice, atr, strategy) {
  const params = STRATEGY_PARAMS[strategy]
  if (!params) return buyPrice * 0.92 // 默认 8% 止损
  const stop = buyPrice - params.atrN * atr
  return Math.max(stop, 0.01) // 止损价不能为负
}

/**
 * 计算仓位
 * @param {number} totalCapital - 总资金
 * @param {number} buyPrice - 买入价
 * @param {number} stopPrice - 止损价
 * @returns {{ amount: number, pct: number, shares: number }}
 */
export function calcPosition(totalCapital, buyPrice, stopPrice) {
  if (!buyPrice || !stopPrice || buyPrice <= stopPrice) {
    return { amount: 0, pct: 0, shares: 0 }
  }
  const stopPct = (buyPrice - stopPrice) / buyPrice
  const riskBudget = totalCapital * 0.02 // 单笔最大亏损 2%
  const posByRisk = riskBudget / stopPct
  const posByLimit = totalCapital * 0.25 // 单只上限 25%
  const amount = Math.min(posByRisk, posByLimit)
  const pct = (amount / totalCapital) * 100
  const shares = Math.floor(amount / buyPrice / 100) * 100 // 取整百股
  return { amount: Math.round(amount * 100) / 100, pct: Math.round(pct * 100) / 100, shares }
}

/**
 * 计算盈亏比
 * @param {number} buyPrice
 * @param {number} stopPrice
 * @param {number} targetPrice
 * @returns {number} 盈亏比
 */
export function calcRiskReward(buyPrice, stopPrice, targetPrice) {
  if (!buyPrice || !stopPrice || !targetPrice) return 0
  const risk = buyPrice - stopPrice
  if (risk <= 0) return 0
  const reward = targetPrice - buyPrice
  return Math.round((reward / risk) * 100) / 100
}

/**
 * 计算初始跟踪止盈价
 * @param {number} buyPrice
 * @param {string} strategy
 * @returns {number}
 */
export function calcTrailingStop(buyPrice, strategy) {
  const params = STRATEGY_PARAMS[strategy]
  if (!params) return buyPrice * 0.92
  return buyPrice * (1 - params.trailPct)
}

/**
 * 更新跟踪止盈价（只上移不下调）
 * @param {number} currentTrailing - 当前跟踪止盈价
 * @param {number} highestClose - 持仓期间最高收盘价
 * @param {string} strategy
 * @returns {number} 新的跟踪止盈价
 */
export function updateTrailingStop(currentTrailing, highestClose, strategy) {
  const params = STRATEGY_PARAMS[strategy]
  if (!params) return currentTrailing
  const newTrailing = highestClose * (1 - params.trailPct)
  return Math.max(currentTrailing, newTrailing)
}

/**
 * 格式化金额
 */
export function formatMoney(val) {
  if (val >= 1e8) return (val / 1e8).toFixed(2) + '亿'
  if (val >= 1e4) return (val / 1e4).toFixed(2) + '万'
  return val.toFixed(2)
}

/**
 * 格式化数字
 */
export function formatNum(val, decimals = 2) {
  if (val == null || isNaN(val)) return '--'
  return Number(val).toFixed(decimals)
}
