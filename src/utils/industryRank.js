/**
 * 同行业对比工具
 * 利用 marketAnalysis store 的板块数据和个股行业名，生成行业排名标签
 */
import { useMarketAnalysisStore } from '../stores/marketAnalysis.js'

/**
 * 生成行业对比标签
 * @param {number} totalScore - 个股综合评分
 * @param {string} industry - 行业名称
 * @returns {string} 如 "行业中上游（68分 vs 行业均 52分）" 或 ""
 */
export function getIndustryRankLabel(totalScore, industry) {
  if (!totalScore || !industry) return ''

  const marketStore = useMarketAnalysisStore()
  const sectors = marketStore.sectors
  if (!sectors?.length) return ''

  // 从板块数据中找到匹配行业
  const matched = sectors.find(s => {
    const name = (s.name || '').toLowerCase()
    const ind = industry.toLowerCase()
    return name.includes(ind) || ind.includes(name)
  })

  if (!matched) return ''

  // 利用板块涨跌作为行业景气度参考
  // 个股评分 vs 行业均值（用板块涨跌幅映射为近似评分）
  const changePct = matched.changePct || 0
  // 将行业涨跌幅映射为 0-100 的行业景气分（-3% → 30, 0% → 50, +3% → 70）
  const industryScore = Math.round(50 + changePct * 6.67)  // 每个百分点 ≈ 6.67 分
  const clampedIndustryScore = Math.max(10, Math.min(90, industryScore))

  const diff = totalScore - clampedIndustryScore
  let level = ''
  if (diff >= 20) level = '行业领先'
  else if (diff >= 5) level = '行业中上游'
  else if (diff >= -5) level = '行业中游'
  else if (diff >= -20) level = '行业中下游'
  else level = '行业落后'

  return `${level}（${totalScore}分 vs 行业景气${clampedIndustryScore}分）`
}
