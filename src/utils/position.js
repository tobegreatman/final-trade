import { STRATEGY_PARAMS } from './constants.js'

const ATR_PERIOD = 14
const RISK_BUDGET = 0.02

/**
 * 计算 ATR
 */
export function calcATR(klines) {
  if (!klines || klines.length < ATR_PERIOD + 1) return 0
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
  const last = trList.slice(-ATR_PERIOD)
  return last.reduce((a, b) => a + b, 0) / last.length
}

function getAdjustedAtrN(atr, price, baseN) {
  if (!atr || !price) return baseN
  const volatility = atr / price
  if (volatility > 0.05) return baseN + 0.5
  if (volatility < 0.015) return Math.max(baseN - 0.5, 0.5)
  return baseN
}

/**
 * 计算止损价（含波动率自适应）
 */
export function calcStopLoss(buyPrice, atr, strategy) {
  const params = STRATEGY_PARAMS[strategy]
  if (!params) return buyPrice * 0.92
  const n = getAdjustedAtrN(atr, buyPrice, params.atrN)
  const stop = Math.max(buyPrice - n * atr, 0.01)
  return strategy === 'bottom' ? Math.min(stop, buyPrice * 0.92) : stop
}

/**
 * 计算仓位
 */
export function calcPosition(totalCapital, buyPrice, stopPrice, strategy) {
  if (!buyPrice || !stopPrice || buyPrice <= stopPrice) {
    return { amount: 0, pct: 0, shares: 0 }
  }
  const stopPct = (buyPrice - stopPrice) / buyPrice
  const riskBudget = totalCapital * RISK_BUDGET
  const posByRisk = riskBudget / stopPct
  const params = strategy ? STRATEGY_PARAMS[strategy] : null
  const posLimit = params ? params.maxPosition : 0.25
  const posByLimit = totalCapital * posLimit
  const amount = Math.min(posByRisk, posByLimit)
  const pct = (amount / totalCapital) * 100
  const shares = Math.floor(amount / buyPrice / 100) * 100
  return { amount: Math.round(amount * 100) / 100, pct: Math.round(pct * 100) / 100, shares }
}

/**
 * 计算盈亏比
 */
export function calcRiskReward(buyPrice, stopPrice, targetPrice) {
  if (!buyPrice || !stopPrice || !targetPrice) return 0
  const risk = buyPrice - stopPrice
  if (risk <= 0) return 0
  const reward = targetPrice - buyPrice
  return Math.round((reward / risk) * 100) / 100
}

/**
 * 计算初始跟踪止盈价（取止损价作为初始值）
 */
export function calcTrailingStop(buyPrice, atr, strategy) {
  return calcStopLoss(buyPrice, atr, strategy)
}

/**
 * 更新跟踪止盈价（只上移不下调，ATR 动态）
 */
export function updateTrailingStop(currentTrailing, highestClose, atr, strategy) {
  const params = STRATEGY_PARAMS[strategy]
  if (!params) return currentTrailing
  if (!atr) {
    const trailPct = params.trailAtrN * 0.03
    const newTrailing = highestClose * (1 - trailPct)
    return Math.max(currentTrailing, newTrailing)
  }
  const m = getAdjustedAtrN(atr, highestClose, params.trailAtrN)
  const newTrailing = highestClose - m * atr
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
