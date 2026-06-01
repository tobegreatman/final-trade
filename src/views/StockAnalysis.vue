<template>
  <div class="stock-analysis">
    <!-- 顶部：股票选择 + 基本信息 -->
    <div class="header">
      <div class="stock-info" v-if="currentStock">
        <span class="stock-name">{{ currentStock.name }}</span>
        <span class="stock-code">{{ currentStock.code }}</span>
        <span v-if="currentQuote" class="stock-price" :class="priceClass">
          ¥{{ formatPrice(currentQuote.close) }}
          <span class="stock-change">{{ formatChange(currentQuote.change, currentQuote.changeAmt) }}</span>
        </span>
      </div>
      <div class="stock-selector">
        <select v-model="selectedCode" class="stock-select" @change="onStockChange">
          <option value="">选择股票</option>
          <option v-for="s in watchlistStore.stocks" :key="s.code" :value="s.code">{{ s.name }} ({{ s.code }})</option>
        </select>
        <div class="search-box">
          <input type="search" class="search-input" v-model="searchKw" @input="onSearchInput" @focus="showSearchDrop = true" @compositionstart="isComposing = true" @compositionend="onCompositionEnd" placeholder="搜索代码或名称" />
          <div v-if="showSearchDrop && searchResults.length" class="search-dropdown">
            <div v-for="r in searchResults" :key="r.code" class="search-item" @click="onSearchSelect(r)">
              <span class="si-name">{{ r.name }}</span>
              <span class="si-code">{{ r.code }}</span>
            </div>
          </div>
          <div v-if="showSearchDrop && searchKw && !searchResults.length && !searchLoading" class="search-dropdown">
            <div class="search-empty">无搜索结果</div>
          </div>
        </div>
        <div v-if="showSearchDrop" class="search-backdrop" @click="showSearchDrop = false" />
        <div class="style-switcher">
          <button v-for="st in styleOptions" :key="st.key" :class="['style-btn', { active: investStyle === st.key }]" @click="onStyleChange(st.key)" :title="st.hint">{{ st.label }}</button>
        </div>
        <button v-if="currentStock" class="refresh-btn" :disabled="loading" @click="loadAnalysis" title="刷新数据">&#x21bb;</button>
        <span v-if="dataTimestamp && !loading" class="data-time">数据更新于 {{ formatTime(dataTimestamp) }}</span>
      </div>
    </div>

    <!-- 加载/错误状态 -->
    <div v-if="loading" class="loading-skeleton">
      <div class="skeleton-row">
        <div class="skeleton-card" />
        <div class="skeleton-card" />
        <div class="skeleton-card" />
        <div class="skeleton-card" />
      </div>
      <div class="skeleton-tabs" />
      <div class="skeleton-chart" />
    </div>
    <div v-if="error" class="error">
        <span>{{ error }}</span>
        <button class="retry-btn" @click="loadAnalysis">重新加载</button>
      </div>

    <template v-if="!loading && !error && currentStock">
      <!-- 诊断区 -->
      <div class="diagnosis-cards">
        <div class="diag-card" :style="{ borderColor: scoreResult?.suggestionColor || 'var(--border)' }">
          <div class="diag-label">综合评分</div>
          <div class="diag-value score-value">{{ scoreResult?.total ?? '--' }}</div>
          <div class="diag-sub" :style="{ color: scoreResult?.suggestionColor }">{{ scoreResult?.suggestion ?? '--' }}</div>
        </div>
        <div class="diag-card clickable" @click="activeTab = 'technical'">
          <div class="diag-label">趋势</div>
          <div class="diag-value" :style="{ color: trendConclusion.color }">{{ trendConclusion.icon }} {{ trendConclusion.text }}</div>
        </div>
        <div class="diag-card clickable" @click="activeTab = 'fundamental'">
          <div class="diag-label">估值</div>
          <div class="diag-value" :style="{ color: valuationConclusion.color }">{{ valuationConclusion.icon }} {{ valuationConclusion.text }}</div>
        </div>
        <div class="diag-card clickable" @click="activeTab = 'capital'">
          <div class="diag-label">资金</div>
          <div class="diag-value" :style="{ color: capitalConclusion.color }">{{ capitalConclusion.icon }} {{ capitalConclusion.text }}</div>
        </div>
      </div>

      <!-- Tab 切换 -->
      <div class="tabs">
        <button v-for="tab in tabs" :key="tab.key" :class="['tab-btn', { active: activeTab === tab.key }]" @click="activeTab = tab.key">
          {{ tab.label }}
          <span v-if="tabErrors[tab.key]" class="tab-err-dot" />
        </button>
      </div>

      <!-- 分项加载失败提示 -->
      <div v-if="hasLoadErrors" class="partial-error">
        部分数据加载失败：<span v-for="(label, key) in errorLabels" :key="key">{{ label }} </span>
      </div>

      <!-- Tab 内容 -->
      <div class="tab-content">
        <KeepAlive :max="4">
          <TechnicalPanel
            v-if="activeTab === 'technical'"
            :klines="klines"
            :indicators="indicators"
            :signals="techSignals"
            :active-period="klinePeriod"
            @period-change="onPeriodChange"
          />
          <FundamentalPanel
            v-else-if="activeTab === 'fundamental'"
            :fundamental="fundamental"
          />
          <CapitalFlowPanel
            v-else-if="activeTab === 'capital'"
            :capital-flow="capitalFlow"
            :margin-data="marginData"
            :northbound-data="northboundData"
            :main-force-flow="mainForceFlow"
            :shareholder-data="shareholderData"
          />
          <ScorePanel
            v-else
            :key="selectedCode"
            :score-result="scoreResult"
            :ai-judge-text="aiJudgeText"
            :ai-judge-loading="aiJudgeLoading"
            :ai-judge-error="aiJudgeError"
          />
        </KeepAlive>
      </div>
    </template>

    <!-- 无股票选择提示 -->
    <div v-if="!currentStock && !loading" class="empty-state">
      <p>请从股票池中选择一只股票进行分析</p>
      <p v-if="!watchlistStore.stocks.length" class="empty-hint">股票池为空，请先在 Watchlist 页面添加自选股</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useWatchlistStore } from '../stores/watchlist.js'
import { REFRESH_INTERVAL } from '../utils/constants.js'
import { calcAllIndicators } from '../utils/indicators.js'
import { calculateScore, getTrendConclusion, getValuationConclusion, getCapitalConclusion } from '../utils/scoring.js'
import { fetchAIJudge } from '../utils/aiJudge.js'
import TechnicalPanel from '../components/analysis/TechnicalPanel.vue'
import FundamentalPanel from '../components/analysis/FundamentalPanel.vue'
import CapitalFlowPanel from '../components/analysis/CapitalFlowPanel.vue'
import ScorePanel from '../components/analysis/ScorePanel.vue'

const watchlistStore = useWatchlistStore()

const selectedCode = ref('')
const activeTab = ref('score')
const investStyle = ref('short')
const loading = ref(false)
const error = ref('')

const route = useRoute()

const klines = ref([])
const indicators = ref({})
const techSignals = ref([])
const fundamental = ref(null)
const capitalFlow = ref(null)
const marginData = ref(null)
const northboundData = ref(null)
const mainForceFlow = ref(null)
const shareholderData = ref(null)
const klinePeriod = ref('101')
let stockChangeTimer = null
let refreshTimer = null
let loadSeq = 0

const styleOptions = [
  { key: 'short', label: '短线', hint: '技术面 50% / 基本面 20% / 资金面 30%' },
  { key: 'mid', label: '中线', hint: '技术面 40% / 基本面 35% / 资金面 25%' },
  { key: 'long', label: '长线', hint: '技术面 30% / 基本面 45% / 资金面 25%' },
]

const tabs = [
  { key: 'score', label: '综合评分' },
  { key: 'technical', label: '技术面' },
  { key: 'fundamental', label: '基本面' },
  { key: 'capital', label: '资金面' },
]

const searchKw = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
const showSearchDrop = ref(false)
let searchTimer = null
let isComposing = false

const currentStock = computed(() => {
  if (!selectedCode.value) return null
  return watchlistStore.stocks.find(s => s.code === selectedCode.value) || { code: selectedCode.value, name: selectedCode.value }
})

const currentQuote = computed(() => {
  if (!selectedCode.value) return null
  return watchlistStore.quotes[selectedCode.value] || null
})

const priceClass = computed(() => {
  const chg = currentQuote.value?.change
  if (chg > 0) return 'price-up'
  if (chg < 0) return 'price-down'
  return ''
})

const scoreResult = ref(null)
const dataTimestamp = ref(null)
const lastRefreshTime = ref(null)
const aiJudgeText = ref('')
const aiJudgeLoading = ref(false)
const aiJudgeError = ref('')
let aiAbortController = null

// 将 margin/northbound/mainForce 注入到 capitalFlow，即使 capitalFlow API 失败也构造空壳对象
function injectCapitalExtras() {
  const injections = {}
  if (marginData.value?.latest) injections._marginLatest = marginData.value.latest
  if (marginData.value?.data?.length) injections._marginData = { data: marginData.value.data }
  if (northboundData.value?.latest) {
    injections._northboundLatest = northboundData.value.latest
    injections._northboundPrev = northboundData.value.prev
  }
  if (mainForceFlow.value?.latest) {
    injections._mainForceLatest = mainForceFlow.value.latest
    injections._mainForceSummary = mainForceFlow.value.summary
  }
  if (mainForceFlow.value?.data?.length) injections._mainForceData = mainForceFlow.value.data
  if (shareholderData.value?.latest) {
    injections._shareholderLatest = shareholderData.value.latest
    injections._shareholderPrev = shareholderData.value.prev
    injections._shareholderData = shareholderData.value.data
  }
  if (Object.keys(injections).length) {
    capitalFlow.value = { ...(capitalFlow.value || {}), ...injections }
  }
}

function updateScore(skipAI = false) {
  const ts = techSignals.value
  const fund = fundamental.value
  const cap = capitalFlow.value
  if (!ts.length && !fund) { scoreResult.value = null; return }
  const industry = fund?.latest?.industry || ''
  scoreResult.value = calculateScore(ts, fund, cap, industry, investStyle.value)
  if (!skipAI) nextTick(() => triggerAIJudge())
}

function triggerAIJudge() {
  if (aiAbortController) { aiAbortController.abort(); aiAbortController = null }

  const sr = scoreResult.value
  const ts = techSignals.value
  const fund = fundamental.value
  const kl = klines.value
  if (!sr || !kl.length) return

  const stock = currentStock.value
  const bullishCount = ts.filter(s => s.type === 'bullish').length
  const bearishCount = ts.filter(s => s.type === 'bearish').length
  const keySignals = ts.slice(0, 5).map(s => s.text).join('；')

  const latest = fund?.latest
  const fundSummary = latest ? {
    pe: latest.pe, pb: latest.pb, roe: latest.roe,
    grossMargin: latest.grossMargin, netMargin: latest.netMargin,
    revenueGrowth: latest.revenueGrowth, profitGrowth: latest.profitGrowth,
    debtRatio: latest.debtRatio, industry: latest.industry,
    ocfPerShare: latest.ocfPerShare,
  } : null

  const capitalDetails = sr.details.filter(d => d.dimension === '资金面')
  const mainForceDetail = capitalDetails.find(d => d.name === '主力资金')
  const marginDetail = capitalDetails.find(d => d.name === '融资融券')
  const volDetail = capitalDetails.find(d => d.name === '量价趋势')

  const latestClose = kl[kl.length - 1]?.close
  const close5 = kl.length >= 5 ? kl[kl.length - 5].close : null
  const close20 = kl.length >= 20 ? kl[kl.length - 20].close : null
  const change5d = close5 ? ((latestClose - close5) / close5 * 100).toFixed(2) : null
  const change20d = close20 ? ((latestClose - close20) / close20 * 100).toFixed(2) : null

  // 趋势阶段判断：从 MA 排列 + 价格偏离 + MACD 方向提取
  const ind = indicators.value
  const maArr = ind?.ma || {}
  const len = kl.length
  const trendContext = (() => {
    const ma5 = maArr[5]?.[len - 1]
    const ma10 = maArr[10]?.[len - 1]
    const ma20 = maArr[20]?.[len - 1]
    const ma60 = maArr[60]?.[len - 1]
    if (!ma5 || !ma20) return null
    const price = latestClose
    const aboveMa5 = price > ma5
    const aboveMa20 = price > ma20
    const aboveMa60 = ma60 ? price > ma60 : null
    const maAlign = ma5 > ma10 && ma10 > ma20
    const maDeadCross = ma5 < ma10 && ma10 < ma20
    const macdHist = ind?.macd?.histogram || []
    const lastHist = macdHist[len - 1] || 0
    const prevHist = macdHist[len - 2] || 0
    const macdDirection = lastHist > prevHist ? '柱线扩大' : lastHist > 0 ? '柱线缩小' : lastHist < prevHist ? '绿柱扩大' : '绿柱缩小'

    let stage = '盘整'
    if (maAlign && aboveMa5) stage = '上升趋势'
    else if (maDeadCross && !aboveMa5) stage = '下降趋势'
    else if (aboveMa20 && !aboveMa5) stage = '上升回调'
    else if (!aboveMa20 && aboveMa5) stage = '超跌反弹'

    const deviation20 = ((price - ma20) / ma20 * 100).toFixed(1)
    const deviation60 = ma60 ? ((price - ma60) / ma60 * 100).toFixed(1) : null
    return { stage, deviation20, deviation60, maAlign, maDeadCross, macdDirection, aboveMa5, aboveMa20, aboveMa60 }
  })()

  const payload = {
    code: stock?.code || selectedCode.value,
    name: stock?.name || '',
    scoreSummary: {
      total: sr.total,
      suggestion: sr.suggestion,
      confidence: sr.confidence,
      dimensions: sr.dimensions,
    },
    techSummary: {
      bullishCount, bearishCount, keySignals,
      score: sr.dimensions.technical.score,
      max: sr.dimensions.technical.max,
      details: (sr.details || []).filter(d => d.dimension === '技术面').map(d => `${d.name}${d.desc}`),
    },
    fundSummary,
    capitalSummary: {
      score: sr.dimensions.capital.score,
      max: sr.dimensions.capital.max,
      mainForceDesc: mainForceDetail?.desc,
      marginDesc: marginDetail?.desc,
      priceVolumeSignal: volDetail?.desc,
    },
    priceAction: { latestClose, change5d, change20d },
    trendContext,
    previousAdvice: aiJudgeText.value || null,
  }

  aiJudgeText.value = ''
  aiJudgeError.value = ''
  aiJudgeLoading.value = true

  aiAbortController = fetchAIJudge(payload, {
    onText: (chunk) => { aiJudgeText.value += chunk },
    onDone: () => { aiJudgeLoading.value = false },
    onError: (msg) => {
      aiJudgeError.value = msg || 'AI 分析暂时不可用'
      aiJudgeLoading.value = false
    },
  })
}

const trendConclusion = computed(() => getTrendConclusion(techSignals.value))
const valuationConclusion = computed(() => getValuationConclusion(fundamental.value))
const capitalConclusion = computed(() => getCapitalConclusion(capitalFlow.value))

function formatPrice(v) {
  if (v == null) return '--'
  return Number(v).toFixed(2)
}

function formatTime(d) {
  if (!d) return ''
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 各 API 加载状态标记（用于分项提示）
const loadErrors = ref({})

function setLoadErrors(results) {
  const names = ['kline', 'fundamental', 'capitalFlow', 'margin', 'northbound', 'mainForce', 'shareholder']
  const errs = {}
  results.forEach((r, i) => {
    if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)) {
      errs[names[i]] = true
    }
  })
  loadErrors.value = errs
}

const errorNameMap = { kline: 'K线', fundamental: '基本面', capitalFlow: '资金面', margin: '融资融券', northbound: '北向资金', mainForce: '主力资金', shareholder: '股东户数' }
const tabErrorMap = { technical: 'kline', fundamental: 'fundamental', capital: ['capitalFlow', 'margin', 'northbound', 'mainForce', 'shareholder'], score: [] }

const hasLoadErrors = computed(() => Object.keys(loadErrors.value).length > 0)
const errorLabels = computed(() => {
  const labels = {}
  for (const key of Object.keys(loadErrors.value)) {
    labels[key] = errorNameMap[key] || key
  }
  return labels
})
const tabErrors = computed(() => {
  const t = {}
  for (const [tab, keys] of Object.entries(tabErrorMap)) {
    t[tab] = Array.isArray(keys) ? keys.some(k => loadErrors.value[k]) : !!loadErrors.value[keys]
  }
  return t
})

function formatChange(pct, amt) {
  if (pct == null) return '--'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

async function loadAnalysis(_manual = true, skipAI = false) {
  const code = selectedCode.value
  const seq = ++loadSeq
  if (!code) {
    klines.value = []
    indicators.value = {}
    techSignals.value = []
    fundamental.value = null
    capitalFlow.value = null
    marginData.value = null
    northboundData.value = null
    mainForceFlow.value = null
    shareholderData.value = null
    loading.value = false
    return
  }

  // 若 onStockChange 已设置 loading 并清空了数据，这里不重复
  if (!loading.value) {
    loading.value = true
    error.value = ''
    klines.value = []
    indicators.value = {}
    techSignals.value = []
    fundamental.value = null
    capitalFlow.value = null
    marginData.value = null
    northboundData.value = null
    mainForceFlow.value = null
    shareholderData.value = null
  }

  try {
    const [klineRes, fundRes, capRes, marginRes, nbRes, mfRes, shRes] = await Promise.allSettled([
      fetch(`/api/stock/${code}/kline?klt=${klinePeriod.value}&lmt=250`).then(r => r.json()),
      fetch(`/api/stock-analysis/fundamental?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/capital-flow?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/margin?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/northbound?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/main-force-flow?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/shareholder?code=${code}`).then(r => r.json()),
    ])

    // 防止切股后旧数据覆盖新数据
    if (seq !== loadSeq) return

    setLoadErrors([klineRes, fundRes, capRes, marginRes, nbRes, mfRes, shRes])

    // K 线
    if (klineRes.status === 'fulfilled' && klineRes.value.ok) {
      klines.value = klineRes.value.data.klines || []
      const result = calcAllIndicators(klines.value)
      indicators.value = result
      techSignals.value = result.signals || []
    }

    // 基本面
    if (fundRes.status === 'fulfilled' && fundRes.value.ok) {
      fundamental.value = fundRes.value.data
    }

    // 资金面
    if (capRes.status === 'fulfilled' && capRes.value.ok) {
      capitalFlow.value = capRes.value.data
    }

    // 融资融券
    if (marginRes.status === 'fulfilled' && marginRes.value.ok) {
      marginData.value = marginRes.value.data
    }

    // 北向资金
    if (nbRes.status === 'fulfilled' && nbRes.value.ok) {
      northboundData.value = nbRes.value.data
    }

    // 主力资金流向
    if (mfRes.status === 'fulfilled' && mfRes.value.ok) {
      mainForceFlow.value = mfRes.value.data
    }

    // 股东户数
    if (shRes.status === 'fulfilled' && shRes.value.ok) {
      shareholderData.value = shRes.value.data
    }

    // 统一注入：将融资融券、北向、主力、股东数据合并到 capitalFlow
    injectCapitalExtras()

    updateScore(skipAI)
    dataTimestamp.value = new Date()
    lastRefreshTime.value = Date.now()
} catch (e) {
    error.value = '数据加载失败: ' + e.message
  } finally {
    loading.value = false
  }
}

async function onPeriodChange(klt) {
  klinePeriod.value = klt
  const code = selectedCode.value
  const seq = ++loadSeq
  if (!code) return

  try {
    const res = await fetch(`/api/stock/${code}/kline?klt=${klt}&lmt=250`)
    const json = await res.json()
    if (seq !== loadSeq) return
    if (json.ok) {
      klines.value = json.data.klines || []
      const result = calcAllIndicators(klines.value)
      indicators.value = result
      techSignals.value = result.signals || []
      injectCapitalExtras()
      updateScore()
    }
  } catch (e) {
    error.value = 'K线加载失败: ' + e.message
  }
}

function onStyleChange(style) {
  if (investStyle.value === style) return
  investStyle.value = style
  updateScore()
}

function onSearchInput() {
  if (isComposing) return
  clearTimeout(searchTimer)
  const kw = searchKw.value.trim()
  if (!kw) { searchResults.value = []; return }
  searchLoading.value = true
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/stock/search?kw=${encodeURIComponent(kw)}`)
      const json = await res.json()
      searchResults.value = json.ok ? (json.data || []).slice(0, 8) : []
    } catch { searchResults.value = [] }
    searchLoading.value = false
  }, 500)
}

function onCompositionEnd() {
  isComposing = false
  onSearchInput()
}

function onSearchSelect(item) {
  showSearchDrop.value = false
  searchKw.value = ''
  searchResults.value = []
  // 自动加入自选（如未添加）
  if (!watchlistStore.stocks.find(s => s.code === item.code)) {
    watchlistStore.addStock(item.code, item.name)
    watchlistStore.fetchQuotes()
  }
  selectedCode.value = item.code
  onStockChange()
}

function onStockChange() {
  loading.value = true
  error.value = ''
  scoreResult.value = null
  dataTimestamp.value = null
  klines.value = []
  indicators.value = {}
  techSignals.value = []
  fundamental.value = null
  capitalFlow.value = null
  marginData.value = null
  northboundData.value = null
  mainForceFlow.value = null
  shareholderData.value = null
  aiJudgeText.value = ''
  aiJudgeError.value = ''
  aiJudgeLoading.value = false
  if (aiAbortController) { aiAbortController.abort(); aiAbortController = null }

  clearTimeout(stockChangeTimer)
  stockChangeTimer = setTimeout(loadAnalysis, 200)
}

// 监听路由 query 变化，支持从自选列表等跳转
watch(() => route.query.code, (newCode) => {
  if (newCode && newCode !== selectedCode.value) {
    selectedCode.value = newCode
    onStockChange()
  }
})

onMounted(() => {
  const qCode = route.query.code
  if (qCode) {
    selectedCode.value = qCode
  } else if (watchlistStore.stocks.length) {
    selectedCode.value = watchlistStore.stocks[0].code
  }

  if (selectedCode.value) {
    loadAnalysis()
    if (!watchlistStore.codes.length) {
      watchlistStore.fetchQuotes()
    }
  }

  watchlistStore.startAutoRefresh(REFRESH_INTERVAL)

  refreshTimer = setInterval(() => {
    if (!selectedCode.value || loading.value) return
    const h = new Date().getHours()
    const m = new Date().getMinutes()
    // 盘后（15:30后）30分钟刷新一次，盘中5分钟
    // 注意：interval 固定5分钟，盘后通过跳过实现降频
    if (h >= 16 || (h === 15 && m >= 30)) {
      if (!lastRefreshTime.value || Date.now() - lastRefreshTime.value > 30 * 60 * 1000) {
        lastRefreshTime.value = Date.now()
        loadAnalysis(false, true)
      }
    } else {
      loadAnalysis(false, true)
    }
  }, 5 * 60 * 1000)
})

onBeforeUnmount(() => {
  watchlistStore.stopAutoRefresh()
  clearTimeout(stockChangeTimer)
  clearTimeout(searchTimer)
  clearInterval(refreshTimer)
  if (aiAbortController) { aiAbortController.abort(); aiAbortController = null }
})
</script>

<style scoped>
.stock-analysis {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 顶部 */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.stock-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.stock-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.stock-code {
  font-size: 13px;
  color: var(--text-muted);
}

.stock-price {
  font-size: 18px;
  font-weight: 600;
}

.stock-price.price-up { color: var(--red); }
.stock-price.price-down { color: var(--green); }

.stock-change {
  font-size: 13px;
  font-weight: 500;
}

.stock-select {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  min-width: 180px;
}

.stock-select:focus {
  outline: none;
  border-color: var(--accent);
}

.stock-selector {
  display: flex;
  align-items: center;
  gap: 6px;
}

.style-switcher {
  display: flex;
  gap: 1px;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  padding: 2px;
  border: 1px solid var(--border);
}

.style-btn {
  padding: 5px 10px;
  width: 45px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.style-btn:hover {
  color: var(--text-secondary);
}

.style-btn.active {
  background: var(--accent);
  color: #fff;
}

/* 搜索框 */
.search-box {
  position: relative;
}

.search-input {
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  width: 150px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: var(--accent);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  min-width: 200px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}

.search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.search-item:hover {
  background: var(--bg-surface-alt);
}

.si-name {
  font-size: 13px;
  color: var(--text-primary);
}

.si-code {
  font-size: 12px;
  color: var(--text-muted);
}

.search-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.search-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
}

.refresh-btn {
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
}

.refresh-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.data-time {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.partial-error {
  padding: 6px 12px;
  background: rgba(255, 149, 0, 0.1);
  color: #ff9500;
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.tab-err-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #ff9500;
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}

.retry-btn {
  margin-left: 12px;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--red);
  background: transparent;
  color: var(--red);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.retry-btn:hover {
  background: var(--red);
  color: #fff;
}

/* 诊断卡片 */
.diagnosis-cards {
  display: flex;
  gap: 10px;
}

.diag-card {
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 3px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  transition: border-color 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
}

.diag-card.clickable {
  cursor: pointer;
}

.diag-card.clickable:hover {
  border-color: var(--accent);
}

.diag-label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.diag-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

.score-value {
  font-size: 20px;
}

.diag-sub {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 2px;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  padding: 3px;
}

.tab-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--accent);
  color: #fff;
}

/* 骨架屏 */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skeleton-row {
  display: flex;
  gap: 10px;
}

.skeleton-card {
  flex: 1;
  height: 36px;
  background: linear-gradient(90deg, var(--bg-surface) 25%, rgba(255,255,255,0.06) 50%, var(--bg-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.skeleton-tabs {
  height: 42px;
  background: linear-gradient(90deg, var(--bg-surface) 25%, rgba(255,255,255,0.06) 50%, var(--bg-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

.skeleton-chart {
  height: 520px;
  background: linear-gradient(90deg, var(--bg-surface) 25%, rgba(255,255,255,0.06) 50%, var(--bg-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-md);
}

.error {
  padding: 12px;
  background: var(--red-dim);
  color: var(--red);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-muted);
}

.empty-hint {
  font-size: 13px;
  margin-top: 8px;
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .stock-analysis {
    padding: 60px 12px 12px;
  }

  .diagnosis-cards {
    overflow-x: auto;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
  }

  .skeleton-chart {
    height: 400px;
  }
}
</style>
