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
    <div v-if="error" class="error">{{ error }}</div>

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
        </button>
      </div>

      <!-- Tab 内容 -->
      <div class="tab-content">
        <TechnicalPanel
          v-if="activeTab === 'technical'"
          :klines="klines"
          :indicators="indicators"
          :signals="techSignals"
          :active-period="klinePeriod"
          @period-change="onPeriodChange"
        />
        <FundamentalPanel
          v-if="activeTab === 'fundamental'"
          :fundamental="fundamental"
        />
        <CapitalFlowPanel
          v-if="activeTab === 'capital'"
          :capital-flow="capitalFlow"
          :margin-data="marginData"
          :northbound-data="northboundData"
        />
        <ScorePanel
          v-if="activeTab === 'score'"
          :score-result="scoreResult"
        />
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useWatchlistStore } from '../stores/watchlist.js'
import { REFRESH_INTERVAL } from '../utils/constants.js'
import { calcAllIndicators } from '../utils/indicators.js'
import { calculateScore, getTrendConclusion, getValuationConclusion, getCapitalConclusion } from '../utils/scoring.js'
import TechnicalPanel from '../components/analysis/TechnicalPanel.vue'
import FundamentalPanel from '../components/analysis/FundamentalPanel.vue'
import CapitalFlowPanel from '../components/analysis/CapitalFlowPanel.vue'
import ScorePanel from '../components/analysis/ScorePanel.vue'

const watchlistStore = useWatchlistStore()

const selectedCode = ref('')
const activeTab = ref('score')
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
const klinePeriod = ref('101')
let stockChangeTimer = null
let loadSeq = 0

const tabs = [
  { key: 'score', label: '综合评分' },
  { key: 'technical', label: '技术面' },
  { key: 'fundamental', label: '基本面' },
  { key: 'capital', label: '资金面' },
]

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

const scoreResult = computed(() => {
  if (!techSignals.value.length && !fundamental.value) return null
  const industry = fundamental.value?.latest?.industry || ''
  return calculateScore(techSignals.value, fundamental.value, capitalFlow.value, industry)
})

const trendConclusion = computed(() => getTrendConclusion(techSignals.value))
const valuationConclusion = computed(() => getValuationConclusion(fundamental.value))
const capitalConclusion = computed(() => getCapitalConclusion(capitalFlow.value))

function formatPrice(v) {
  if (v == null) return '--'
  return Number(v).toFixed(2)
}

function formatChange(pct, amt) {
  if (pct == null) return '--'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

async function loadAnalysis() {
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
    return
  }

  loading.value = true
  error.value = ''

  try {
    const [klineRes, fundRes, capRes, marginRes, nbRes] = await Promise.allSettled([
      fetch(`/api/stock/${code}/kline?klt=${klinePeriod.value}&lmt=250`).then(r => r.json()),
      fetch(`/api/stock-analysis/fundamental?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/capital-flow?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/margin?code=${code}`).then(r => r.json()),
      fetch(`/api/stock-analysis/northbound?code=${code}`).then(r => r.json()),
    ])

    // 防止切股后旧数据覆盖新数据
    if (seq !== loadSeq) return

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
      // 将融资融券最新数据注入 capitalFlow 供评分引擎使用
      if (capitalFlow.value && marginRes.value.data?.latest) {
        capitalFlow.value = { ...capitalFlow.value, _marginLatest: marginRes.value.data.latest }
      }
    }

    // 北向资金
    if (nbRes.status === 'fulfilled' && nbRes.value.ok) {
      northboundData.value = nbRes.value.data
      if (capitalFlow.value && nbRes.value.data?.latest) {
        capitalFlow.value = { ...capitalFlow.value, _northboundLatest: nbRes.value.data.latest, _northboundPrev: nbRes.value.data.prev }
      }
    }
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
    }
  } catch (_) {}
}

function onStockChange() {
  clearTimeout(stockChangeTimer)
  stockChangeTimer = setTimeout(loadAnalysis, 200)
}

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
})

onBeforeUnmount(() => {
  watchlistStore.stopAutoRefresh()
  clearTimeout(stockChangeTimer)
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

/* 诊断卡片 */
.diagnosis-cards {
  display: flex;
  gap: 10px;
}

.diag-card {
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 8px 14px;
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
  height: 44px;
  background: linear-gradient(90deg, var(--bg-surface) 25%, rgba(255,255,255,0.06) 50%, var(--bg-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.skeleton-tabs {
  height: 40px;
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
