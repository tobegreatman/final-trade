/**
 * 公共格式化工具
 */

export function formatVol(v) {
  if (v == null) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万'
  return v.toLocaleString()
}

export function formatYi(v) {
  if (v == null) return '--'
  return (v / 1e8).toFixed(2)
}

export function formatWan(v) {
  if (v == null) return '--'
  return (v / 1e4).toFixed(1)
}

export function formatMarketCap(v) {
  if (v == null) return '--'
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  return (v / 1e4).toFixed(0) + '万'
}

export function formatShares(v) {
  if (!v) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿股'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万股'
  return v.toLocaleString() + '股'
}

export function formatFlowYi(v) {
  if (v == null) return '--'
  return (v / 1e8).toFixed(2) + '亿'
}

export function formatNum(v) {
  if (v == null) return '--'
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return Number.isInteger(v) ? v.toString() : v.toFixed(2)
}

export function formatPct(v) {
  if (v == null) return '--'
  return v.toFixed(1) + '%'
}
