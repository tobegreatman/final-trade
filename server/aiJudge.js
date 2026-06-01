import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import OpenAI from 'openai'

// 手动加载 .env 文件（避免 dotenv 的 CJS require 问题）
try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const envPath = join(__dirname, '.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=')
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim()
        if (!process.env[key]) process.env[key] = val
      }
    }
  }
} catch { /* .env 文件不存在则忽略 */ }

const API_KEY = process.env.GLM_API_KEY
const AI_CACHE_TTL = 60 * 1000  // 1分钟缓存
const aiCache = new Map()

function getClient() {
  if (!API_KEY || API_KEY === 'your-zhipu-api-key-here') return null
  return new OpenAI({
    apiKey: API_KEY,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  })
}

function buildPrompt(body) {
  const { code, name, scoreSummary, techSummary, fundSummary, capitalSummary, riskSummary, priceAction, trendContext, previousAdvice } = body
  const dim = scoreSummary?.dimensions || {}

  const techDim = dim.technical || {}
  const fundDim = dim.fundamental || {}
  const capDim = dim.capital || {}

  let prompt = `你是一位资深A股分析师。请根据以下量化评分数据，给出一段自然、有深度的综合分析。

## 股票信息
- 名称: ${name || code}（${code}）
- 综合评分: ${scoreSummary?.total || '?'}分/100，系统建议: ${scoreSummary?.suggestion || '未知'}
- 数据置信度: ${scoreSummary?.confidence || '未知'}

## 技术面（得分 ${techDim.score || '?'}/${techDim.max || '?'}，占比 ${Math.round((techDim.score || 0) / (techDim.max || 1) * 100)}%）
- 看多信号: ${techSummary?.bullishCount || 0}个，看空信号: ${techSummary?.bearishCount || 0}个
- 关键信号: ${techSummary?.keySignals || '无'}
- 明细: ${(techSummary?.details || []).join('；')}`

  if (trendContext) {
    const t = trendContext
    prompt += `

## 当前趋势阶段
- 趋势状态: ${t.stage}（${t.maAlign ? '均线多头排列' : t.maDeadCross ? '均线空头排列' : '均线交织'}）
- 价格偏离20日线: ${t.deviation20}%
${t.deviation60 != null ? `- 价格偏离60日线: ${t.deviation60}%` : ''}
- MACD方向: ${t.macdDirection}
- 价格位置: ${t.aboveMa5 ? '站上5日线' : '跌破5日线'}，${t.aboveMa20 ? '站上20日线' : '跌破20日线'}`
  }

  if (fundSummary) {
    prompt += `

## 基本面（得分 ${fundDim.score || '?'}/${fundDim.max || '?'}）
- PE: ${fundSummary.pe ?? '?'}，PB: ${fundSummary.pb ?? '?'}，行业: ${fundSummary.industry || '未知'}
- ROE: ${fundSummary.roe ?? '?'}%，毛利率: ${fundSummary.grossMargin ?? '?'}%，净利率: ${fundSummary.netMargin ?? '?'}%
- 营收增长: ${fundSummary.revenueGrowth ?? '?'}%，净利增长: ${fundSummary.profitGrowth ?? '?'}%
- 负债率: ${fundSummary.debtRatio ?? '?'}%
- 每股经营现金流: ${fundSummary.ocfPerShare ?? '?'}`
  } else {
    prompt += `\n\n## 基本面\n- 暂无数据`
  }

  prompt += `

## 资金面（得分 ${capDim.score || '?'}/${capDim.max || '?'}）`

  if (capitalSummary) {
    if (capitalSummary.mainForceDesc) prompt += `\n- 主力资金: ${capitalSummary.mainForceDesc}`
    if (capitalSummary.marginDesc) prompt += `\n- 融资融券: ${capitalSummary.marginDesc}`
    if (capitalSummary.priceVolumeSignal) prompt += `\n- 量价信号: ${capitalSummary.priceVolumeSignal}`
  } else {
    prompt += `\n- 暂无数据`
  }

  if (riskSummary && riskSummary.details?.length) {
    prompt += `

## 风险面（得分 ${riskSummary.score || '?'}/${riskSummary.max || '?'}）`
    riskSummary.details.forEach(d => { prompt += `\n- ${d}` })
  }

  if (priceAction) {
    prompt += `

## 近期走势
- 最新收盘: ${priceAction.latestClose ?? '?'}元
- 5日涨跌: ${priceAction.change5d ?? '?'}%
- 20日涨跌: ${priceAction.change20d ?? '?'}%`
  }

  if (previousAdvice && previousAdvice.length > 20) {
    prompt += `

## 上次分析建议（请对比当前数据判断是否已变化）
${previousAdvice.slice(0, 500)}`
  }

  prompt += `

请按以下结构输出综合判断（不超过400字）：

先用一句话给出明确结论。结论必须客观反映当前数据，不要默认偏空：
- 如果数据偏多（评分较高、趋势向上、资金流入），就说"趋势偏多，可关注"或"多头格局中"
- 如果数据偏空（评分较低、趋势向下、资金流出），就说"偏弱，建议回避"
- 如果多空交织，就说"震荡格局，等待方向明确"

然后列出 3-4 个核心要点，每个要点格式为"**标题**：分析内容"：
- 标题要具体到这只股票的核心矛盾
- 好标题示例："**均线多头支撑强**"、"**主力连续3日净流入**"、"**PE处于行业低位**"、"**短期涨幅过大存回调风险**"
- 分析内容必须引用具体数字佐证
- 要点按重要性排序，多空要点都要有（如果有的话）

最后给出可执行的操作建议，必须包含：
1. **入场/加仓条件**：明确的触发信号（如"突破XX元且放量"、"回调至XX元附近企稳"、"MACD金叉确认"），不要只说"关注"或"观望"
2. **止损/减仓条件**：明确的退出信号（如"跌破XX元"、"MACD死叉"、"放量跌破20日线"）
3. 如果上次建议了回调价位且当前已到该价位附近，必须重新评估是否满足入场条件，而不是简单重复"继续观望"`

  return prompt
}

async function handleAIJudge(ctx) {
  const body = ctx.request.body
  if (!body?.code || !body?.scoreSummary) {
    ctx.body = { ok: false, error: '参数不完整' }
    return
  }

  const client = getClient()
  if (!client) {
    ctx.body = { ok: false, error: 'AI 判断功能未配置。请在 server/.env 中设置 GLM_API_KEY。' }
    return
  }

  // 缓存检查（Key 包含评分 + 关键信号，评分变化时刷新）
  const keySignals = (body.techSummary?.keySignals || '').slice(0, 60)
  const cacheKey = `${body.code}_${body.scoreSummary?.total || 0}_${keySignals}`
  const cached = aiCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < AI_CACHE_TTL) {
    ctx.status = 200
    ctx.set('Content-Type', 'text/event-stream')
    ctx.set('Cache-Control', 'no-cache')
    ctx.set('Connection', 'keep-alive')
    ctx.respond = false
    ctx.res.write(`data: ${JSON.stringify({ type: 'text', content: cached.text })}\n\n`)
    ctx.res.write('data: [DONE]\n\n')
    ctx.res.end()
    return
  }

  const prompt = buildPrompt(body)

  // SSE 响应
  ctx.status = 200
  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.respond = false

  let fullText = ''

  try {
    const stream = await client.chat.completions.create({
      model: 'glm-5.1',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 8192,
    })

    ctx.req.on('close', () => {
      stream.controller?.abort()
    })

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      // GLM-5.1 推理模型：reasoning_content 是思考过程，content 是最终回复
      // 只取 content，过滤掉 reasoning_content
      const content = delta?.content
      if (content) {
        fullText += content
        ctx.res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`)
      }
    }

    // 缓存完整结果
    if (fullText) {
      aiCache.set(cacheKey, { text: fullText, ts: Date.now() })
    }

    ctx.res.write('data: [DONE]\n\n')
    ctx.res.end()
  } catch (err) {
    console.error('AI judge error:', err.message)
    ctx.res.write(`data: ${JSON.stringify({ type: 'error', content: 'AI 分析暂时不可用: ' + err.message })}\n\n`)
    ctx.res.end()
  }
}

export function registerAIJudgeRoutes(router) {
  router.post('/api/stock-analysis/ai-judge', handleAIJudge)
}
