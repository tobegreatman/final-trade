<template>
  <div class="watchlist">
    <!-- Top: Index intraday mini charts -->
    <section class="index-bar">
      <div v-for="(item, key) in indexIntraday" :key="key" class="index-bar__card">
        <div class="idx-header">
          <span class="idx-name">{{ item.name }}</span>
          <span class="idx-price">{{ item.close?.toFixed(2) || '--' }}</span>
          <span class="idx-change" :class="item.isUp ? 'up' : 'down'">
            {{ item.change >= 0 ? '+' : '' }}{{ item.change?.toFixed(2) || '--' }}%
          </span>
        </div>
        <div class="idx-chart">
          <Sparkline
            v-if="item.trends.length"
            :data="item.trends"
            :positive="item.isUp"
            :ref-price="item.preClose"
            :auto-width="true"
            :height="68"
            :total-slots="240"
          />
        </div>
      </div>
    </section>

    <!-- Main split layout -->
    <div class="split-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <!-- Search -->
        <div class="search-box">
          <input
            v-model="searchKw"
            type="search"
            placeholder="搜索代码、名称或拼音"
            @input="onSearchInput"
            @focus="showSearch = true"
          />
          <div v-if="showSearch && searchResults.length" class="search-dropdown">
            <div
              v-for="r in searchResults"
              :key="r.code"
              class="search-item"
              @click="addFromSearch(r)"
            >
              <span class="search-item__name">{{ r.name }}</span>
              <span class="search-item__code">{{ r.code }}</span>
            </div>
          </div>
        </div>

        <!-- Watchlist -->
        <div class="stock-list">
          <div v-if="!watchlistStore.stocks.length" class="empty-hint">
            搜索并添加自选股
          </div>
          <div
            v-for="stock in watchlistStore.stocks"
            :key="stock.code"
            class="stock-item"
            :class="{ active: selectedCode === stock.code }"
            @click="selectStock(stock.code)"
          >
            <div class="stock-item__info">
              <div class="stock-item__name">{{ stock.name }}</div>
              <div class="stock-item__code">{{ stock.code }}</div>
            </div>
            <div class="stock-item__price-col">
              <div class="stock-item__price" :class="getQuoteClass(stock.code)">
                {{ getQuotePrice(stock.code) }}
              </div>
              <div class="stock-item__change" :class="getQuoteClass(stock.code)">
                {{ getQuoteChange(stock.code) }}
              </div>
            </div>
            <div class="stock-item__mini">
              <Sparkline
                v-if="getMiniData(stock.code).length"
                :data="getMiniData(stock.code)"
                :positive="isQuoteUp(stock.code)"
                :width="52"
                :height="24"
                :ref-price="getMiniRefPrice(stock.code)"
                :total-slots="240"
              />
            </div>
          </div>
        </div>
      </aside>

      <!-- Detail panel -->
      <main class="detail-panel">
        <div v-if="!selectedCode" class="empty-detail">
          <div class="empty-icon">📈</div>
          <p>选择一只自选股查看详情</p>
        </div>
        <template v-else>
          <!-- Period tabs -->
          <div class="period-tabs">
            <button
              v-for="p in periods"
              :key="p.key"
              class="period-tab"
              :class="{ active: activePeriod === p.key }"
              @click="switchPeriod(p.key)"
            >{{ p.label }}</button>
          </div>

          <!-- Chart -->
          <div class="chart-area">
            <Sparkline
              v-if="chartData.length"
              :data="chartData"
              :positive="chartPositive"
              :show-area="true"
              :height="280"
              :auto-width="true"
              :ref-price="chartRefPrice"
              :total-slots="chartTotalSlots"
            />
            <div v-else class="chart-loading">加载中...</div>
          </div>

          <!-- Stats grid -->
          <div class="stats-grid">
            <div v-for="stat in statsItems" :key="stat.label" class="stat-item">
              <div class="stat-label">{{ stat.label }}</div>
              <div class="stat-value">{{ stat.value }}</div>
            </div>
          </div>

          <!-- Actions -->
          <div class="detail-actions">
            <router-link :to="`/position?code=${selectedCode}`" class="btn btn-primary">
              计算仓位
            </router-link>
            <button class="btn btn-danger" @click="removeSelected">移除</button>
          </div>
        </template>
      </main>
    </div>

    <!-- Click outside to close search -->
    <div v-if="showSearch" class="backdrop" @click="showSearch = false"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useWatchlistStore } from '../stores/watchlist.js'
import Sparkline from '../components/Sparkline.vue'

const watchlistStore = useWatchlistStore()

const searchKw = ref('')
const showSearch = ref(false)
const searchResults = ref([])
const selectedCode = ref(null)
const activePeriod = ref('1d')
let searchTimer = null

// Intraday data for top index bar
const indexIntraday = ref({ sh: { name: '上证指数', trends: [], isUp: false, close: null, change: null, preClose: null }, sz: { name: '深证成指', trends: [], isUp: false, close: null, change: null, preClose: null }, cyb: { name: '创业板指', trends: [], isUp: false, close: null, change: null, preClose: null } })

// Cache for detail data
const intradayCache = ref({})
const klineCache = ref({})
const kline5yCache = ref({})
const basicCache = ref({})

const periods = [
  { key: '1d', label: '1日' },
  { key: '1w', label: '1周' },
  { key: '1m', label: '1月' },
  { key: '3m', label: '3月' },
  { key: '5y', label: '5年' },
  { key: 'all', label: '全部' }
]

const chartData = computed(() => {
  if (!selectedCode.value) return []
  const p = activePeriod.value
  if (p === '1d') return intradayCache.value[selectedCode.value]?.trends || []
  if (p === '1w') return (klineCache.value[selectedCode.value]?.klines || []).slice(-5)
  if (p === '1m') return (klineCache.value[selectedCode.value]?.klines || []).slice(-22)
  if (p === '3m') return (klineCache.value[selectedCode.value]?.klines || []).slice(-60)
  if (p === '5y' || p === 'all') return kline5yCache.value[selectedCode.value]?.klines || []
  return []
})

const chartPositive = computed(() => isQuoteUp(selectedCode.value))
const chartTotalSlots = computed(() => activePeriod.value === '1d' ? 240 : 0)
const chartRefPrice = computed(() => {
  if (activePeriod.value === '1d') return intradayCache.value[selectedCode.value]?.preClose || null
  return null
})

const statsItems = computed(() => {
  const basic = basicCache.value[selectedCode.value] || {}
  const kline = klineCache.value[selectedCode.value]?.klines || []
  const last = kline[kline.length - 1] || {}
  const period = kline.slice(-22)
  const periodHigh = period.length ? Math.max(...period.map(k => k.high)) : null
  const periodLow = period.length ? Math.min(...period.map(k => k.low)) : null
  return [
    { label: '日内最高', value: last.high?.toFixed(2) || '--' },
    { label: '日内最低', value: last.low?.toFixed(2) || '--' },
    { label: '区间最高', value: periodHigh?.toFixed(2) || '--' },
    { label: '区间最低', value: periodLow?.toFixed(2) || '--' },
    { label: '市盈率 PE', value: basic.pe?.toFixed(1) || '--' },
    { label: '市净率 PB', value: basic.pb?.toFixed(2) || '--' },
    { label: '总市值', value: formatCap(basic.totalMarketCap) },
    { label: '涨跌幅', value: getQuoteChange(selectedCode.value) }
  ]
})

function formatCap(val) {
  if (val == null) return '--'
  if (val >= 1e12) return (val / 1e12).toFixed(2) + '万亿'
  if (val >= 1e8) return (val / 1e8).toFixed(0) + '亿'
  return (val / 1e4).toFixed(0) + '万'
}

function getQuotePrice(code) {
  const q = watchlistStore.quotes[code]
  return q?.close?.toFixed(2) || '--'
}

function getQuoteChange(code) {
  const q = watchlistStore.quotes[code]
  if (!q || q.change == null) return '--'
  return (q.change >= 0 ? '+' : '') + (q.change / 100).toFixed(2) + '%'
}

function getQuoteClass(code) {
  const q = watchlistStore.quotes[code]
  if (!q || q.change == null) return ''
  return q.change >= 0 ? 'up' : 'down'
}

function isQuoteUp(code) {
  const q = watchlistStore.quotes[code]
  return q?.change != null ? q.change >= 0 : true
}

function getMiniData(code) {
  const intra = intradayCache.value[code]
  if (intra?.trends?.length) return intra.trends
  return []
}

function getMiniRefPrice(code) {
  return intradayCache.value[code]?.preClose || null
}

function onSearchInput() {
  clearTimeout(searchTimer)
  if (!searchKw.value.trim()) { searchResults.value = []; return }
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/stock/search?kw=${encodeURIComponent(searchKw.value)}`)
      const json = await res.json()
      searchResults.value = json.ok ? json.data : []
    } catch { searchResults.value = [] }
  }, 300)
}

function addFromSearch(item) {
  watchlistStore.addStock(item.code, item.name)
  showSearch.value = false
  searchKw.value = ''
  searchResults.value = []
}

async function selectStock(code) {
  selectedCode.value = code
  // Load data
  if (!klineCache.value[code]) {
    const res = await fetch(`/api/stock/${code}/kline`)
    const json = await res.json()
    if (json.ok && json.data?.klines?.length) klineCache.value[code] = json.data
  }
  if (!intradayCache.value[code]) {
    const res = await fetch(`/api/stock/${code}/intraday`)
    const json = await res.json()
    if (json.ok && json.data?.trends?.length) intradayCache.value[code] = json.data
  }
  if (!basicCache.value[code]) {
    const res = await fetch(`/api/stock/${code}/basic`)
    const json = await res.json()
    if (json.ok && json.data) basicCache.value[code] = json.data
  }
  restartIntradayDetailTimer()
}

function switchPeriod(key) {
  activePeriod.value = key
  // Load 5y data on demand
  if ((key === '5y' || key === 'all') && selectedCode.value && !kline5yCache.value[selectedCode.value]) {
    fetch(`/api/stock/${selectedCode.value}/kline5y`)
      .then(r => r.json())
      .then(json => { if (json.ok) kline5yCache.value[selectedCode.value] = json.data })
  }
  restartIntradayDetailTimer()
}

function removeSelected() {
  if (!selectedCode.value) return
  watchlistStore.removeStock(selectedCode.value)
  selectedCode.value = null
}

async function fetchIndexIntraday() {
  try {
    const res = await fetch('/api/market/indices/intraday')
    const json = await res.json()
    if (json.ok) {
      for (const key of ['sh', 'sz', 'cyb']) {
        const d = json.data[key]
        if (d?.trends?.length) {
          const lastTrend = d.trends[d.trends.length - 1]
          const close = lastTrend?.close || d.preClose
          const change = d.preClose ? ((close - d.preClose) / d.preClose * 100) : 0
          indexIntraday.value[key] = {
            ...indexIntraday.value[key],
            trends: d.trends,
            close,
            change,
            preClose: d.preClose,
            isUp: change >= 0
          }
        }
      }
    }
  } catch (e) { console.error('fetchIndexIntraday error:', e) }
}

// --- Timers with visibility awareness ---
let indexTimer = null
let detailIntradayTimer = null

function startIndexTimer() {
  if (indexTimer) return
  fetchIndexIntraday()
  indexTimer = setInterval(fetchIndexIntraday, 30000)
}

function stopIndexTimer() {
  if (indexTimer) { clearInterval(indexTimer); indexTimer = null }
}

async function refreshDetailIntraday() {
  const code = selectedCode.value
  if (!code || activePeriod.value !== '1d') return
  try {
    const res = await fetch(`/api/stock/${code}/intraday`)
    const json = await res.json()
    if (json.ok && json.data?.trends?.length) intradayCache.value[code] = json.data
  } catch (e) { console.error('refreshDetailIntraday error:', e) }
}

function startDetailIntradayTimer() {
  stopDetailIntradayTimer()
  if (!selectedCode.value || activePeriod.value !== '1d') return
  refreshDetailIntraday()
  detailIntradayTimer = setInterval(refreshDetailIntraday, 30000)
}

function stopDetailIntradayTimer() {
  if (detailIntradayTimer) { clearInterval(detailIntradayTimer); detailIntradayTimer = null }
}

function restartIntradayDetailTimer() {
  if (selectedCode.value && activePeriod.value === '1d' && !document.hidden) {
    startDetailIntradayTimer()
  } else {
    stopDetailIntradayTimer()
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopIndexTimer()
    stopDetailIntradayTimer()
    watchlistStore.stopAutoRefresh()
  } else {
    startIndexTimer()
    watchlistStore.startAutoRefresh()
    restartIntradayDetailTimer()
  }
}

onMounted(() => {
  startIndexTimer()
  watchlistStore.startAutoRefresh()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stopIndexTimer()
  stopDetailIntradayTimer()
  watchlistStore.stopAutoRefresh()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearTimeout(searchTimer)
})
</script>

<style scoped>
.watchlist {
  height: calc(100vh - 52px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ===== INDEX BAR ===== */
.index-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px 16px 0;
}

.index-bar__card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
}

.idx-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}

.idx-name {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.idx-price {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.idx-change {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
  white-space: nowrap;
}

.idx-change.up { color: var(--red); }
.idx-change.down { color: var(--green); }

.idx-price {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}

.idx-chart {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

/* ===== SPLIT LAYOUT ===== */
.split-layout {
  flex: 1;
  display: flex;
  gap: 0;
  padding: 12px 16px 16px;
  min-height: 0;
}

/* ===== SIDEBAR ===== */
.sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  border-right: 1px solid var(--border);
  padding-right: 12px;
}

.search-box {
  position: relative;
}

.search-box input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
}

.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-top: 4px;
  z-index: 50;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.search-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.search-item:hover {
  background: var(--bg-surface-alt);
}

.search-item__name {
  font-size: 13px;
  color: var(--text-primary);
}

.search-item__code {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.stock-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty-hint {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-muted);
  font-size: 13px;
}

.stock-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.stock-item:hover {
  background: var(--bg-surface-alt);
}

.stock-item.active {
  background: var(--accent-dim);
}

.stock-item__info {
  flex: 1;
  min-width: 0;
}

.stock-item__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stock-item__code {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.stock-item__price-col {
  text-align: right;
  min-width: 60px;
}

.stock-item__price {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stock-item__change {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.up { color: var(--red); }
.down { color: var(--green); }

.stock-item__mini {
  flex-shrink: 0;
}

/* ===== DETAIL PANEL ===== */
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-left: 16px;
  overflow-y: auto;
}

.empty-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 40px;
  opacity: 0.4;
}

.period-tabs {
  display: flex;
  gap: 4px;
}

.period-tab {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  transition: all 0.2s;
}

.period-tab:hover {
  background: var(--bg-surface-alt);
  color: var(--text-primary);
}

.period-tab.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.chart-area {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  min-height: 280px;
}

.chart-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-item {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.stat-value {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.detail-actions {
  display: flex;
  gap: 10px;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}

@media (max-width: 768px) {
  .watchlist {
    height: auto;
    min-height: calc(100vh - 52px);
  }

  .index-bar {
    grid-template-columns: 1fr;
  }

  .split-layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding-right: 0;
    padding-bottom: 12px;
    max-height: 300px;
  }

  .detail-panel {
    padding-left: 0;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
