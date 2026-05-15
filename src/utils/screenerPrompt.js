import { MINE_SWEEPER_ITEMS } from './constants.js'

// ==================== 排雷 NLP 映射（按 id 匹配，不依赖数组下标） ====================
const MINE_NLP = {
  1: '非ST',
  2: '非停牌',
  3: '非北交所',
  4: '非退市',
  5: '审计意见为标准无保留意见',
  6: '商誉占净资产比例小于30%',
  7: '大股东质押比例小于60%',
  8: '上市时间大于1年',
}

// ==================== 排雷 PC 公式映射 ====================
const MINE_PC = {
  1: 'NOT(NAMELIKE("ST") OR NAMELIKE("*ST"))',
  3: 'NOT(CODELIKE("8") OR CODELIKE("4"))',
  2: 'DYNAINFO(17)>0',
}

// ==================== 技术信号 NLP 映射 ====================
const TECH_NLP = {
  trendBreak: ['MACD金叉', '20日均线向上', '60日均线向上'],
  pullback: ['股价大于60日均线', '60日均线向上', '股价接近20日均线，偏离不超过2%', '5日均量小于20日均量的70%'],
  bottomConfirm: ['RSI小于30拐头向上', 'MACD金叉'],
}

// ==================== 技术信号 PC 公式映射 ====================
const TECH_PC = {
  trendBreak: 'C>REF(HHV(H,20),1) AND V/REF(MA(V,20),1)>1.5 AND MACD.DIF>MACD.DEA AND MACD.MACD>0 AND MA(C,20)>MA(C,60) AND MA(C,60)>REF(MA(C,60),5)',
  pullback: 'C>MA(C,60) AND MA(C,60)>REF(MA(C,60),5) AND L<=MA(C,20)*1.02 AND C>=MA(C,20)*0.98 AND MA(V,5)<MA(V,20)*0.7',
  bottomConfirm: 'HHV(H,120)/C>1.4 AND C/REF(C,1)>1.03 AND V/REF(MA(V,20),1)>2 AND C>O AND (C-O)/O>0.03 AND RSI.RSI1>REF(RSI.RSI1,1) AND REF(RSI.RSI1,5)<30',
}

// ==================== 景气度 NLP 映射 ====================
const PROSPERITY_NLP = {
  institutional: ['机构持股比例较上季度增加', '北向资金持股比例增加', '近30日主力净流入'],
  earnings: ['净利润增长率大于30%', '营收增长率大于20%'],
  dragonTiger: ['近3日登上龙虎榜', '换手率3%到20%'],
}

// ==================== 手动条件映射 ====================
const MANUAL_BY_PROSPERITY = {
  earnings: { label: '近60日研报数量≥3', where: '东方财富个股页 → 研报，或 Choice 终端' },
  dragonTiger: { label: '买方机构席位 > 卖方机构席位', where: '东方财富龙虎榜 data.eastmoney.com/stock/lhb.html，人工确认' },
}

const MANUAL_BY_TECH = {
  trendBreak: { label: '放量突破20日高点', where: 'PC端综合选股，或通达信公式' },
  bottomConfirm: { label: '从高点下跌超40%后放量', where: 'PC端综合选股，或通达信公式' },
}

/**
 * 构建一句话选股条件（核心共用函数）
 * @param {Object} options
 * @param {Array} options.mines - 排雷项数组，每项需有 { id, checked }
 * @param {Object} options.fundamentals - 基本面参数
 * @param {string|null} options.prosperity - 景气度 key: 'institutional'|'earnings'|'dragonTiger'|null
 * @param {string|null} options.tech - 技术信号 key: 'trendBreak'|'pullback'|'bottomConfirm'|null
 * @returns {{ mobileStatement: string, manualConditions: Array, pcFormula: string }}
 */
export function buildScreenerPrompt({ mines, fundamentals, prosperity, tech }) {
  const parts = []
  const pcLines = []
  const manuals = []

  // 第一层：排雷
  for (const m of mines) {
    if (!m.checked) continue
    const nlp = MINE_NLP[m.id]
    if (nlp) parts.push(nlp)
    const pc = MINE_PC[m.id]
    if (pc) pcLines.push(pc)
    // F10 手动项
    if (!m.auto) {
      manuals.push({ label: m.label, where: m.desc })
    }
  }

  // 第二层：基本面
  const f = fundamentals
  if (f.roe) parts.push(`ROE大于${f.roe}%`)
  if (f.revenueGrowth) parts.push(`营收增长率大于${f.revenueGrowth}%`)
  if (f.profitGrowth) parts.push(`净利润增长率大于${f.profitGrowth}%`)
  if (f.debtRatio) {
    parts.push(`资产负债率小于${f.debtRatio}%`)
    pcLines.push(`FINANCE(9)<=${f.debtRatio}`)
  }
  if (f.cashflowPositive) parts.push('经营现金流为正')
  if (f.peMin || f.peMax) {
    const lo = f.peMin || 0
    const hi = f.peMax || 999
    parts.push(`市盈率${lo}到${hi}`)
  }
  if (f.minMarketCap) parts.push(`流通市值大于${f.minMarketCap}亿`)
  if (f.roe) pcLines.push(`FINANCE(33)/FINANCE(34)*100>=${f.roe}`)
  if (f.profitGrowth) pcLines.push(`FINANCE(43)>=${f.profitGrowth}`)

  // 第三层：景气度
  if (prosperity && PROSPERITY_NLP[prosperity]) {
    parts.push(...PROSPERITY_NLP[prosperity])
    if (prosperity === 'dragonTiger') pcLines.push('换手率>3 AND 换手率<20')
  }
  if (prosperity && MANUAL_BY_PROSPERITY[prosperity]) {
    manuals.push(MANUAL_BY_PROSPERITY[prosperity])
  }

  // 第四层：技术信号
  if (tech && TECH_NLP[tech]) {
    parts.push(...TECH_NLP[tech])
  }
  if (tech && TECH_PC[tech]) {
    pcLines.push(TECH_PC[tech])
  }
  if (tech && MANUAL_BY_TECH[tech]) {
    manuals.push(MANUAL_BY_TECH[tech])
  }

  return {
    mobileStatement: parts.join('，'),
    manualConditions: manuals,
    pcFormula: pcLines.length ? pcLines.join(' AND\n') + ';' : '',
  }
}

/**
 * 根据市场状态获取四层漏斗预设参数（供 Dashboard 使用）
 * @param {string} status - 市场状态: 'bull' | 'bull-lean' | 'neutral'
 * @returns {Object} buildScreenerPrompt 所需的 options
 */
export function getStrategyPreset(status) {
  const mines = MINE_SWEEPER_ITEMS
    .filter(m => m.auto)
    .map(m => ({ ...m, checked: true }))

  if (status === 'bull') {
    return {
      mines,
      fundamentals: { roe: 12, revenueGrowth: 10, profitGrowth: 10, debtRatio: 0, cashflowPositive: false, peMin: 5, peMax: 40, minMarketCap: 30 },
      prosperity: null,
      tech: 'trendBreak',
    }
  }

  if (status === 'bull-lean') {
    return {
      mines,
      fundamentals: { roe: 12, revenueGrowth: 0, profitGrowth: 0, debtRatio: 60, cashflowPositive: false, peMin: 5, peMax: 40, minMarketCap: 50 },
      prosperity: null,
      tech: 'pullback',
    }
  }

  // neutral
  return {
    mines,
    fundamentals: { roe: 12, revenueGrowth: 0, profitGrowth: 0, debtRatio: 60, cashflowPositive: true, peMin: 5, peMax: 30, minMarketCap: 50 },
    prosperity: null,
    tech: 'pullback',
  }
}
