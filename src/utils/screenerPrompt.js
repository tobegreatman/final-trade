import { MINE_SWEEPER_ITEMS } from './constants.js'

// ==================== 严/宽模式预设 ====================
const STRICT_PRESETS = {
  bull: { roe: 12, revenueGrowth: 10, profitGrowth: 10, debtRatio: 60, cashflowPositive: false, peMin: 5, peMax: 40, minMarketCap: 50 },
  'bull-lean': { roe: 12, revenueGrowth: 0, profitGrowth: 0, debtRatio: 60, cashflowPositive: false, peMin: 5, peMax: 40, minMarketCap: 50 },
  neutral: { roe: 12, revenueGrowth: 0, profitGrowth: 0, debtRatio: 60, cashflowPositive: true, peMin: 5, peMax: 30, minMarketCap: 50 },
}

const LOOSE_PRESETS = {
  bull: { roe: 0, revenueGrowth: 5, profitGrowth: 5, debtRatio: 65, cashflowPositive: false, peMin: 3, peMax: 50, minMarketCap: 30 },
  'bull-lean': { roe: 0, revenueGrowth: 5, profitGrowth: 5, debtRatio: 65, cashflowPositive: false, peMin: 3, peMax: 50, minMarketCap: 30 },
  neutral: { roe: 0, revenueGrowth: 5, profitGrowth: 5, debtRatio: 65, cashflowPositive: false, peMin: 3, peMax: 50, minMarketCap: 30 },
}

/**
 * 根据市场状态获取四层漏斗预设参数
 * @param {string} status - 市场状态: 'bull' | 'bull-lean' | 'neutral'
 * @param {'strict'|'loose'} mode - 选股模式
 * @param {string|null} techOverride - 覆盖技术信号 key（如 'bottomConfirm'）
 * @returns {{ mines: Array, fundamentals: Object, prosperity: string|null, tech: string }}
 */
export function getStrategyPreset(status, mode = 'loose', techOverride = null) {
  const mines = MINE_SWEEPER_ITEMS
    .filter(m => m.auto)
    .map(m => ({ ...m, checked: true }))

  const fundamentals = mode === 'strict' ? STRICT_PRESETS[status] : LOOSE_PRESETS[status]

  // 景气度：牛市启用机构增持确认资金面（DDX），偏多/震荡不需要
  const prosperityMap = { bull: 'institutional', 'bull-lean': null, neutral: null }

  // 技术信号：支持外部覆盖
  const defaultTech = status === 'bull' ? 'trendBreak' : 'pullback'
  const techKey = techOverride || defaultTech
  const tech = mode === 'strict' && techKey === 'pullback' ? 'pullbackStrict' : techKey

  return { mines, fundamentals, prosperity: prosperityMap[status] || null, tech }
}

/**
 * 构建东方财富结构化选股 API 的 filter 字符串
 * @param {Object} options
 * @param {Array} options.mines - 排雷项数组，每项需有 { id, checked }
 * @param {Object} options.fundamentals - 基本面参数
 * @param {string|null} options.prosperity - 景气度 key
 * @param {string|null} options.tech - 技术信号 key
 * @returns {string} filter 字符串
 */
export function buildStructuredFilter({ mines, fundamentals, prosperity, tech }) {
  const filters = []
  const checkedIds = new Set(mines.filter(m => m.checked).map(m => m.id))

  // === 排雷层 ===
  filters.push('TRADE_MARKET_CODE in ("上交所主板","深交所主板","深交所创业板","上交所科创板")')
  if (checkedIds.has(8)) filters.push('@LISTING_DATE="OVER1Y"')
  // NOTE: GOODWILL_TO_NETASSET 字段不被 RPTA_PCNEW_STOCKSELECT 识别，由服务端后过滤处理
  if (checkedIds.has(7)) filters.push('PLEDGE_RATIO<60')

  // === 基本面层 ===
  const f = fundamentals
  if (f.roe) filters.push(`ROE_WEIGHT>=${f.roe}`)
  if (f.revenueGrowth) filters.push(`TOI_YOY_RATIO>=${f.revenueGrowth}`)
  if (f.profitGrowth) filters.push(`NETPROFIT_YOY_RATIO>=${f.profitGrowth}`)
  if (f.debtRatio) filters.push(`DEBT_ASSET_RATIO<=${f.debtRatio}`)
  if (f.cashflowPositive) filters.push('PER_NETCASH_OPERATE>0')

  const peLo = f.peMin || 0
  const peHi = f.peMax || 999
  if (peLo > 0) filters.push(`PE9>${peLo}`)
  if (peHi < 999) filters.push(`PE9<=${peHi}`)

  if (f.minMarketCap) {
    filters.push(`TOTAL_MARKET_CAP>=${f.minMarketCap * 1e8}`)
  }

  // === 景气度层 ===
  if (prosperity === 'institutional') {
    filters.push('DDX>0')
  } else if (prosperity === 'earnings') {
    if (!f.profitGrowth || f.profitGrowth < 30) filters.push('NETPROFIT_YOY_RATIO>=30')
    if (!f.revenueGrowth || f.revenueGrowth < 20) filters.push('TOI_YOY_RATIO>=20')
  } else if (prosperity === 'dragonTiger') {
    filters.push('TURNOVERRATE>3')
    filters.push('TURNOVERRATE<=20')
  }

  // === 技术信号层 ===
  if (tech === 'trendBreak') {
    filters.push('MACD_GOLDEN_FORK="1"')
    filters.push('LONG_AVG_ARRAY="1"')
  } else if (tech === 'pullback') {
    filters.push('LONG_AVG_ARRAY="1"')
    filters.push('VOLUME_RATIO<1.2')
  } else if (tech === 'pullbackStrict') {
    filters.push('LONG_AVG_ARRAY="1"')
    filters.push('VOLUME_RATIO<1')
  } else if (tech === 'bottomConfirm') {
    filters.push('KDJ_GOLDEN_FORK="1"')
    filters.push('UPSIDE_VOLUME="1"')
  }

  return filters.map(f => `(${f})`).join('')
}

const TECH_LABELS = {
  trendBreak: '趋势突破：MACD金叉 + 均线多头排列',
  pullback: '回调买入：均线多头排列 + 量能收缩',
  pullbackStrict: '回调买入（严）：均线多头 + 明显缩量',
  bottomConfirm: '底部确认：KDJ金叉 + 放量上攻',
}

// ==================== 东财 AI 自然语言选股 ====================

// 技术信号的 AI 自然语言表述
const TECH_AI_KEYWORDS = {
  trendBreak: '趋势追涨：均线多头排列 + MACD金叉 + 量能放大',
  pullback: '回调买入：均线多头排列 + 量能收缩',
  pullbackStrict: '回调买入：均线多头排列 + 明显缩量',
  bottomConfirm: '抄底信号：RSI超卖 + MACD底背离 + 缩量',
}

/**
 * 构建东财 AI 选股的自然语言 keyWordNew 字符串
 * @param {Object} options - 同 buildStructuredFilter 的参数
 * @returns {string} 自然语言查询字符串
 */
export function buildKeyWordNew({ mines, fundamentals, prosperity, tech }) {
  const parts = []
  const checkedIds = new Set(mines.filter(m => m.checked).map(m => m.id))

  // === 第一层：排雷（用逗号分隔，确保 AI API 正确解析每个条件） ===
  parts.push('非ST')
  parts.push('非停牌')
  parts.push('非北交所')
  parts.push('非退市')
  if (checkedIds.has(8)) parts.push('上市时间超过1年')
  if (checkedIds.has(6)) parts.push('商誉占净资产比例小于30%')
  if (checkedIds.has(7)) parts.push('质押比例小于60%')

  // === 第二层：基本面 ===
  const f = fundamentals
  if (f.roe) parts.push(`ROE大于等于${f.roe}%`)
  if (f.revenueGrowth) parts.push(`营收增速大于等于${f.revenueGrowth}%`)
  if (f.profitGrowth) parts.push(`利润增速大于等于${f.profitGrowth}%`)
  if (f.debtRatio) parts.push(`资产负债率小于等于${f.debtRatio}%`)
  if (f.cashflowPositive) parts.push('经营现金流为正')

  const peLo = f.peMin || 0
  const peHi = f.peMax || 999
  if (peLo > 0 || peHi < 999) parts.push(`PE ${peLo}~${peHi < 999 ? peHi : '∞'}`)

  if (f.minMarketCap) parts.push(`市值大于等于${f.minMarketCap}亿`)

  // === 第三层：景气度 ===
  if (prosperity === 'institutional') parts.push('DDX大于0')
  else if (prosperity === 'earnings') parts.push('业绩超预期')
  else if (prosperity === 'dragonTiger') parts.push('换手率3~20%')

  // === 第四层：技术信号 ===
  if (tech && TECH_AI_KEYWORDS[tech]) parts.push(TECH_AI_KEYWORDS[tech])

  return parts.join('，')
}

/**
 * 根据市场状态直接生成完整的 keyWordNew 查询字符串
 * @param {string} status - 市场状态: 'bull' | 'bull-lean' | 'neutral'
 * @param {'strict'|'loose'} mode - 选股模式
 * @param {string|null} techOverride - 覆盖技术信号 key
 * @returns {string} 自然语言查询字符串
 */
export function buildMarketStateQuery(status, mode = 'loose', techOverride = null) {
  const preset = getStrategyPreset(status, mode, techOverride)
  return buildKeyWordNew(preset)
}

/**
 * 从结构化参数生成可读中文描述
 */
export function buildFilterDescription({ mines, fundamentals, prosperity, tech }) {
  const parts = []
  const checkedIds = new Set(mines.filter(m => m.checked).map(m => m.id))

  const mineLabels = []
  mineLabels.push('非ST/非停牌/非北交所/非退市')
  if (checkedIds.has(8)) mineLabels.push('上市>1年')
  if (checkedIds.has(6)) mineLabels.push('商誉/净资产<30%（服务端后过滤）')
  if (checkedIds.has(7)) mineLabels.push('质押<60%')
  parts.push(mineLabels.join('，'))

  const f = fundamentals
  if (f.roe) parts.push(`ROE≥${f.roe}%`)
  if (f.revenueGrowth) parts.push(`营收增速≥${f.revenueGrowth}%`)
  if (f.profitGrowth) parts.push(`利润增速≥${f.profitGrowth}%`)
  if (f.debtRatio) parts.push(`负债率≤${f.debtRatio}%`)
  if (f.cashflowPositive) parts.push('经营现金流为正')

  const peLo = f.peMin || 0
  const peHi = f.peMax || 999
  if (peLo > 0 || peHi < 999) parts.push(`PE ${peLo}~${peHi < 999 ? peHi : '∞'}`)

  if (f.minMarketCap) parts.push(`市值≥${f.minMarketCap}亿`)

  if (prosperity === 'institutional') parts.push('DDX大单动向>0')
  else if (prosperity === 'earnings') parts.push('业绩超预期')
  else if (prosperity === 'dragonTiger') parts.push('换手率3~20%')

  if (tech && TECH_LABELS[tech]) parts.push(TECH_LABELS[tech])

  return parts.join('，')
}
