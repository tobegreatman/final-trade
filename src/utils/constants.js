export const PRE_TRADE_CHECKLIST = [
  '大盘状态是否适合交易？（对照六维判定 + 决策树）',
  '该股是否通过排雷清单？（对照3.2）',
  '是否有明确买入信号？（对照4.1/4.2/4.3）',
  '止损位是否已设定？（ATR计算 + 条件单）',
  '盈亏比是否 ≥ 2:1？',
  '仓位是否在风险预算内？（5.3公式计算）',
  '是否已设条件单/提醒？（不依赖盘中判断）',
  '是否在冷静状态下决策？（不在开盘/收盘前10分钟冲动）'
]

export const IRON_RULES = [
  { id: 1, rule: '止损不可撤销', desc: '到了止损位必须卖，不抱任何幻想', consequence: '小亏变大亏' },
  { id: 2, rule: '不追涨杀跌', desc: '没有信号不进场，不因 FOMO 买入', consequence: '高位接盘/低位割肉' },
  { id: 3, rule: '不逆势满仓', desc: '熊市不加杠杆，震荡市不满仓', consequence: '爆仓/深度套牢' },
  { id: 4, rule: '不在亏损仓位加仓', desc: '亏了不加码，止损而非补仓', consequence: '亏损放大' },
  { id: 5, rule: '不过度交易', desc: '有信号才交易，每月交易不超过 10 次', consequence: '手续费吞噬利润' },
  { id: 6, rule: '不碰不懂的票', desc: '没研究过的不买，不跟风听消息', consequence: '盲目赌博' },
  { id: 7, rule: '不临时起意', desc: '盘中不产生新想法，所有计划盘前制定', consequence: '情绪化操作' }
]

export const STRATEGY_PARAMS = {
  trend: {
    key: 'trend',
    name: '趋势突破',
    atrN: 1.5,
    trailAtrN: 2.0,
    holdPeriod: '1-4 周',
    timeStop: '5日未突破前高→出场',
    riskLevel: '中',
    maxPosition: 0.25
  },
  pullback: {
    key: 'pullback',
    name: '回调买入',
    atrN: 2.0,
    trailAtrN: 3.0,
    holdPeriod: '2-8 周',
    timeStop: '8日未企稳（未回到MA20上方）→出场',
    riskLevel: '低-中',
    maxPosition: 0.25
  },
  bottom: {
    key: 'bottom',
    name: '底部右侧确认',
    atrN: 3.0,
    trailAtrN: 4.0,
    holdPeriod: '1-6 月',
    timeStop: '15日未确认（未突破颈线）→出场',
    riskLevel: '高',
    maxPosition: 0.03
  }
}

export const MARKET_STATUS = {
  bull: { label: '牛市', tag: 'tag-green', maxPosition: '80-100%', strategy: 'trend', strategyName: '趋势突破' },
  'bull-lean': { label: '偏多', tag: 'tag-green', maxPosition: '50-70%', strategy: 'pullback', strategyName: '回调买入' },
  neutral: { label: '震荡', tag: 'tag-yellow', maxPosition: '≤50%', strategy: 'pullback', strategyName: '回调买入' },
  'bear-lean': { label: '偏空', tag: 'tag-yellow', maxPosition: '20-40%', strategy: null, strategyName: '仅观望' },
  bear: { label: '熊市', tag: 'tag-red', maxPosition: '0-20%', strategy: null, strategyName: '空仓' }
}

export const DRAWDOWN_PROTOCOL = [
  { level: 0, maxDrawdown: 5, action: '正常波动，继续执行系统规则', positionScale: 1.0 },
  { level: 1, maxDrawdown: 10, action: '减仓至50%，暂停新开仓，复盘最近5笔寻找共性问题', positionScale: 0.5 },
  { level: 2, maxDrawdown: 15, action: '减仓至20%，只保留最强持仓，全面复盘系统', positionScale: 0.2 },
  { level: 3, maxDrawdown: 20, action: '立即空仓，回归模拟盘至少2周，重新验证系统有效性', positionScale: 0 }
]

export const SELL_REASONS = [
  { key: 'stop', label: '触发止损' },
  { key: 'target', label: '到达目标' },
  { key: 'trailing_stop', label: '跟踪止盈' },
  { key: 'time_stop', label: '时间止损' },
  { key: 'logic_stop', label: '逻辑止损' },
  { key: 'manual', label: '手动' }
]

export const ISSUE_TAGS = [
  { key: 'execution', label: '执行失误' },
  { key: 'timing', label: '时机错误' },
  { key: 'selection', label: '选股错误' },
  { key: 'environment', label: '环境不匹配' },
  { key: 'emotion', label: '情绪驱动' }
]

export const EMOTIONS = [
  { key: 'greed', name: '贪婪', trigger: '连续盈利，想加仓加杠杆', response: '回顾规则，严格执行仓位上限' },
  { key: 'fear', name: '恐惧', trigger: '连续亏损，不敢下单', response: '缩小仓位恢复信心，检查系统是否失效' },
  { key: 'regret', name: '后悔', trigger: '卖出后继续涨 / 未买入的涨了', response: '接受不确定性，关注过程而非结果' },
  { key: 'hope', name: '侥幸', trigger: '亏损持仓期待回本', response: '执行止损，市场不关心你的成本' }
]

export const MINE_SWEEPER_ITEMS = [
  { id: 1, label: '非 ST', auto: true, desc: '排除 ST、*ST 股票' },
  { id: 2, label: '非停牌', auto: true, desc: '排除停牌股票' },
  { id: 3, label: '非北交所', auto: true, desc: '排除北交所股票' },
  { id: 4, label: '非退市', auto: true, desc: '排除退市风险股（带退字标识）' },
  { id: 5, label: '审计意见：标准无保留', auto: true, desc: '最新审计意见为标准无保留意见' },
  { id: 6, label: '商誉/净资产 < 30%', auto: true, desc: '商誉占净资产比例小于30%' },
  { id: 7, label: '大股东质押 < 60%', auto: true, desc: '大股东质押比例小于60%' },
  { id: 8, label: '上市天数 > 250天', auto: true, desc: '排除次新股' },
  { id: 9, label: '关联交易/营收 < 40%', auto: false, desc: '关联交易占比过高 → F10查阅' },
  { id: 10, label: '无存贷双高', auto: false, desc: '货币资金高且有息负债高 → F10查阅' },
  { id: 11, label: '董监高减持 < 5%', auto: false, desc: '近一年累计减持比例 → F10查阅' },
  { id: 12, label: '无重大诉讼/处罚', auto: false, desc: '近一年重大事项 → F10查阅' }
]

export const REFRESH_INTERVAL = 10000

export const FUNDAMENTAL_DEFAULTS = {
  roe: 12,
  revenueGrowth: 10,
  profitGrowth: 10,
  debtRatio: 60,
  cashflowPositive: true,
  peMin: 5,
  peMax: 40,
  minMarketCap: 30
}

export const PROSPERITY_OPTIONS = [
  { key: 'institutional', label: '机构增持', desc: '机构持股↑ + 北向持股↑ + 主力净流入' },
  { key: 'earnings', label: '业绩超预期', desc: '净利润增速>30% + 营收增速>20% + 研报≥3' },
  { key: 'dragonTiger', label: '龙虎榜强势', desc: '近3日上榜 + 买方机构多 + 换手率3-20%' }
]

export const TECH_SIGNAL_OPTIONS = [
  { key: 'trendBreak', label: '趋势突破', desc: '放量突破20日高点 + MACD金叉 + MA20↑ + MA60↑' },
  { key: 'pullback', label: '回调买入', desc: '股价>MA60 + 缩量回调至MA20 ±2% + 量缩' },
  { key: 'bottomConfirm', label: '底部右侧确认', desc: '跌>40% + 缩量后放量 + RSI<30拐头 + MACD金叉' }
]
