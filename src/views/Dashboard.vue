<template>
  <div class="dashboard">
    <!-- Atmospheric background mesh -->
    <div class="atmo-mesh"></div>

    <!-- Loading State -->
    <div v-if="marketStore.loading && !judgment" class="loading-state">
      <div class="pulse-loader">
        <div class="pulse-ring"></div>
        <div class="pulse-ring delay"></div>
        <div class="pulse-core"></div>
      </div>
      <span class="loading-text">正在采集市场数据...</span>
    </div>

    <template v-else>
      <!-- ===== INDEX CARDS ROW ===== -->
      <section class="index-row">
        <div v-for="(item, key) in indexCards" :key="key" class="index-card">
          <div class="index-card__header">
            <span class="index-card__name">{{ item.name }}</span>
            <span class="index-card__price">{{ item.close ? item.close.toFixed(2) : '--' }}</span>
            <span class="index-card__change" :class="item.isUp ? 'up' : 'down'">
              {{ item.isUp ? '▲' : '▼' }} {{ formatChange(item.change) }}%
            </span>
          </div>
          <div class="index-card__sparkline">
            <Sparkline
              v-if="item.trends.length"
              :data="item.trends"
              :positive="item.isUp"
              :show-area="true"
              :height="68"
              :auto-width="true"
              :ref-price="item.preClose"
              :total-slots="240"
            />
          </div>
        </div>
      </section>

      <!-- ===== MAIN GRID: STATUS ORB + SIGNALS ===== -->
      <section class="main-grid">
        <!-- LEFT: Market Status Orb -->
        <div class="status-orb-panel">
          <div class="orb-container">
            <div class="orb" :class="orbClass">
              <div class="orb-glow"></div>
              <div class="orb-inner">
                <span class="orb-label">{{ judgment?.label || '--' }}</span>
              </div>
            </div>
            <div class="orb-ring ring-1"></div>
            <div class="orb-ring ring-2"></div>
          </div>
          <div class="orb-meta">
            <div class="orb-meta__row">
              <span class="orb-meta__key">建议仓位</span>
              <span class="orb-meta__val" :class="positionClass">{{ judgment?.maxPosition || '--' }}</span>
            </div>
            <div class="orb-meta__row">
              <span class="orb-meta__key">推荐策略</span>
              <span class="orb-meta__val">{{ judgment?.strategyName || '--' }}</span>
            </div>
            <div class="orb-meta__row">
              <span class="orb-meta__key">信号确认</span>
              <span class="orb-meta__val">
                <span :class="judgment?.confirmed ? 'confirmed' : 'unconfirmed'">
                  {{ judgment?.confirmed ? '已确认' : '未确认' }}
                </span>
              </span>
            </div>
          </div>
          <!-- Score bar -->
          <div class="score-bar">
            <div class="score-segment bull" :style="{ flex: judgment?.score?.bullW || 0 }">
              {{ judgment?.score?.bull || 0 }}牛 <span class="score-wt">({{ judgment?.score?.bullW || 0 }})</span>
            </div>
            <div class="score-segment neutral" :style="{ flex: judgment?.score?.neutral || 0 }">
              {{ judgment?.score?.neutral || 0 }} 中
            </div>
            <div class="score-segment bear" :style="{ flex: judgment?.score?.bearW || 0 }">
              {{ judgment?.score?.bear || 0 }}熊 <span class="score-wt">({{ judgment?.score?.bearW || 0 }})</span>
            </div>
          </div>
        </div>

        <!-- RIGHT: 6-Dimension Signal Table -->
        <div class="signals-panel">
          <h2 class="panel-title">七维判据
            <button class="btn btn-sm btn-ghost refresh-btn" @click="refreshJudgment">刷新</button>
          </h2>
          <div class="signals-grid">
            <div
              v-for="(sig, i) in judgment?.signals || []"
              :key="sig.dimension"
              class="signal-card"
              :class="{ 'signal-enter': showSignals }"
              :style="{ animationDelay: `${i * 80}ms` }"
            >
              <div class="signal-card__indicator" :class="signalClass(sig)"></div>
              <div class="signal-card__body">
                <div class="signal-card__dim">
                  {{ sig.dimension }}
                  <span v-if="sig.divergence" class="div-badge" :class="sig.divergence">{{ sig.divergence === 'bullish' ? '底背离' : '顶背离' }}</span>
                  <span v-if="sig.weight >= 1.5 && !sig.divergence" class="weight-badge">强</span>
                </div>
                <div class="signal-card__val">{{ sig.value }}</div>
                <div class="signal-card__desc">{{ sig.desc }}</div>
              </div>
              <div class="signal-card__tag" :class="signalTagClass(sig)">
                {{ sig.bull ? '牛' : sig.bear ? '熊' : '中' }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== LONG WINDOW QUICK CHECK ===== -->
      <section class="long-window-section" v-if="judgment?.longWindow">
        <h2 class="panel-title">
          <span class="title-icon">⚡</span>
          做多窗口速判
          <span class="lw-badge" :class="judgment.longWindow.allPass ? 'pass' : 'fail'">
            {{ judgment.longWindow.allPass ? '窗口已开启' : '窗口未开启' }}
          </span>
        </h2>
        <div class="lw-conditions">
          <div
            v-for="(cond, i) in judgment.longWindow.conditions"
            :key="i"
            class="lw-cond"
            :class="{ pass: cond.pass }"
          >
            <div class="lw-cond__icon">{{ cond.pass ? '✓' : '✗' }}</div>
            <span>{{ cond.label }}</span>
          </div>
        </div>
      </section>

      <!-- ===== STRATEGY STOCK PICKS ===== -->
      <section class="strategy-section" v-if="judgment">
        <h2 class="panel-title">
          <span class="title-icon">◈</span>
          策略选股建议
          <span v-if="activeStrategy" class="strategy-badge" :class="activeStrategy">{{ strategyLabel }}</span>
        </h2>

        <!-- Bear: no buy -->
        <div v-if="!activeStrategy" class="strategy-empty">
          <span class="strategy-empty__icon">⊘</span>
          <span>当前市场{{ judgment.label }}，建议空仓观望，不推荐开新仓</span>
        </div>

        <template v-else>
          <!-- Prompt -->
          <div class="prompt-block">
            <div class="prompt-header">
              <span class="prompt-label">一句话选股</span>
              <div class="prompt-actions">
                <button v-if="isCustomPrompt" class="btn btn-sm btn-ghost" @click="resetPrompt">恢复默认</button>
                <button v-if="!editingPrompt" class="btn btn-sm btn-ghost" @click="startEditPrompt">编辑条件</button>
                <button v-else class="btn btn-sm btn-ghost primary" @click="applyCustomPrompt">查询</button>
                <button class="btn btn-sm btn-ghost" @click="copyText(activePrompt)">复制</button>
              </div>
            </div>
            <pre v-if="!editingPrompt" class="prompt-code">{{ activePrompt }}</pre>
            <textarea v-else v-model="editPromptText" class="prompt-edit" rows="3" @keydown.enter.prevent="applyCustomPrompt"></textarea>
            <p class="prompt-hint" v-if="!editingPrompt">
              匹配 {{ screenStocks.length }} 只 · 点击「编辑条件」自定义选股条件
            </p>
          </div>

          <!-- Stock cards -->
          <div v-if="screenLoading" class="screen-loading">
            <span class="pulse-dot"></span> 正在获取候选股...
          </div>
          <template v-else-if="screenStocks.length">
            <div class="stock-grid">
              <div
                v-for="s in screenStocks"
                :key="s.code"
                class="stock-card"
                @click="goToStock(s.code, s.name)"
              >
                <div class="stock-card__header">
                  <span class="stock-card__name">{{ s.name }}</span>
                  <span class="stock-card__industry">{{ s.industry || fmtCap(s.marketCap) }}</span>
                </div>
                <div class="stock-card__price">
                  <span class="stock-card__val">{{ s.price?.toFixed(2) }}</span>
                  <span class="stock-card__chg" :class="s.change >= 0 ? 'up' : 'down'">
                    {{ s.change >= 0 ? '+' : '' }}{{ s.change?.toFixed(2) }}%
                  </span>
                </div>
                <div class="stock-card__meta">
                  <span>PE {{ s.pe?.toFixed(1) }}</span>
                  <span>PB {{ s.pb?.toFixed(2) }}</span>
                  <span>换手 {{ s.turnover?.toFixed(1) }}%</span>
                </div>
                <div class="stock-card__flow" v-if="s.mainFlow != null">
                  <span class="flow-label">主力</span>
                  <span :class="s.mainFlow >= 0 ? 'up' : 'down'">
                    {{ fmtFlow(s.mainFlow) }}
                  </span>
                </div>
                <div class="stock-card__flow" v-else>
                  <span class="flow-label">成交</span>
                  <span>{{ s.volume || '--' }}</span>
                </div>
              </div>
            </div>
            <button class="btn btn-sm btn-ghost screen-refresh" @click="fetchScreenStocks">刷新候选</button>
          </template>
          <div v-else class="screen-empty">
            <span class="screen-empty__text">暂无匹配结果</span>
            <button class="btn btn-sm btn-ghost screen-refresh" @click="fetchScreenStocks">重新检测</button>
          </div>
        </template>
      </section>

      <!-- ===== PRE-TRADE CHECKLIST ===== -->
      <section class="checklist-section">
        <h2 class="panel-title">
          <span class="title-icon">☐</span>
          交易前检查清单
          <span class="checklist-progress">{{ checkedCount }}/{{ checklist.length }}</span>
        </h2>
        <div class="checklist-grid">
          <label
            v-for="(item, i) in checklist"
            :key="i"
            class="checklist-item"
            :class="{ checked: item.checked, 'check-enter': showChecklist }"
            :style="{ animationDelay: `${i * 50}ms` }"
          >
            <input type="checkbox" v-model="item.checked" />
            <span class="check-box">
              <span class="check-mark" v-if="item.checked">✓</span>
            </span>
            <span class="check-text">{{ item.label }}</span>
          </label>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMarketStore } from '../stores/market.js'
import { judgeMarket } from '../utils/marketJudge.js'
import { PRE_TRADE_CHECKLIST, REFRESH_INTERVAL } from '../utils/constants.js'
import { getStrategyPreset, buildScreenerPrompt } from '../utils/screenerPrompt.js'
import { saveJson } from '../utils/storage.js'
import Sparkline from '../components/Sparkline.vue'

const router = useRouter()
const marketStore = useMarketStore()
const showSignals = ref(false)
const showChecklist = ref(false)

const checklist = reactive(PRE_TRADE_CHECKLIST.map(label => ({ label, checked: false })))

const checkedCount = computed(() => checklist.filter(c => c.checked).length)

const judgment = computed(() => {
  if (!marketStore.indices || !marketStore.breadth || !marketStore.northbound) return null
  return judgeMarket(marketStore.indices, marketStore.breadth, marketStore.northbound, marketStore.margin, marketStore.breadthHistory, marketStore.limitStats, marketStore.prevStatus)
})

// 状态惯性：判定完成后持久化状态，下次判定作为惯性参考
watch(() => judgment.value?.status, (newStatus) => {
  if (newStatus && newStatus !== marketStore.prevStatus) {
    marketStore.prevStatus = newStatus
    saveJson('market_prev_status', newStatus)
  }
})

// ==================== Strategy Stock Screening ====================
const screenLoading = ref(false)
const screenStocks = ref([])

const activeStrategy = computed(() => {
  const s = judgment.value?.status
  if (s === 'bull') return 'trend'
  if (s === 'bull-lean' || s === 'neutral') return 'pullback'
  return null
})

const strategyLabel = computed(() => activeStrategy.value === 'trend' ? '趋势突破' : '回调买入')

const screenerPrompt = computed(() => {
  const s = judgment.value?.status
  if (!s || !activeStrategy.value) return ''
  return buildScreenerPrompt(getStrategyPreset(s)).mobileStatement
})

const customPrompt = ref('')
const editingPrompt = ref(false)
const editPromptText = ref('')
const isCustomPrompt = computed(() => !!customPrompt.value)
const activePrompt = computed(() => customPrompt.value || screenerPrompt.value)

function startEditPrompt() {
  editPromptText.value = activePrompt.value
  editingPrompt.value = true
}

function applyCustomPrompt() {
  if (!editPromptText.value.trim()) return
  customPrompt.value = editPromptText.value.trim()
  editingPrompt.value = false
  fetchScreenStocks()
}

function resetPrompt() {
  customPrompt.value = ''
  editingPrompt.value = false
  fetchScreenStocks()
}

async function fetchScreenStocks() {
  if (!activeStrategy.value || !activePrompt.value) return
  screenLoading.value = true
  try {
    const res = await fetch('/api/stock/xuangu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: activePrompt.value })
    })
    const json = await res.json()
    if (json.ok) screenStocks.value = json.data.stocks
  } catch (e) {
    console.error('fetchScreenStocks error:', e)
  } finally {
    screenLoading.value = false
  }
}

watch(activeStrategy, (v) => {
  if (v) fetchScreenStocks()
})

function fmtFlow(v) {
  if (v == null) return '--'
  const abs = Math.abs(v)
  const str = abs >= 10000 ? (abs / 10000).toFixed(1) + '亿' : abs.toFixed(0) + '万'
  return (v >= 0 ? '+' : '-') + str
}

function fmtCap(v) {
  if (!v) return ''
  if (v >= 1e8) return (v / 1e8).toFixed(0) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return v.toFixed(0)
}

function goToStock(code, name) {
  router.push({ path: '/watchlist', query: { code, name } })
}

function copyText(text) {
  navigator.clipboard.writeText(text)
}

const indexIntraday = ref({ sh: null, sz: null, cyb: null })

const indexCards = computed(() => {
  const data = marketStore.indices || {}
  const names = { sh: '上证指数', sz: '深证成指', cyb: '创业板指' }
  const codes = { sh: '000001', sz: '399001', cyb: '399006' }
  const cards = {}
  for (const key of ['sh', 'sz', 'cyb']) {
    const d = data[key] || {}
    const q = d.quote || {}
    const change = q.change ?? 0
    const intra = indexIntraday.value[key]
    cards[key] = {
      name: names[key],
      code: codes[key],
      close: q.close,
      change,
      isUp: change >= 0,
      trends: intra?.trends || [],
      preClose: intra?.preClose || null
    }
  }
  return cards
})

const orbClass = computed(() => {
  const s = judgment.value?.status
  if (s === 'bull' || s === 'bull-lean') return 'orb-bull'
  if (s === 'bear' || s === 'bear-lean') return 'orb-bear'
  return 'orb-neutral'
})

const positionClass = computed(() => {
  const s = judgment.value?.status
  if (s === 'bull' || s === 'bull-lean') return 'pos-bull'
  if (s === 'bear' || s === 'bear-lean') return 'pos-bear'
  return ''
})

function signalClass(sig) {
  if (sig.bull) return 'sig-bull'
  if (sig.bear) return 'sig-bear'
  return 'sig-neutral'
}

function signalTagClass(sig) {
  if (sig.bull) return 'tag-bull'
  if (sig.bear) return 'tag-bear'
  return 'tag-neutral'
}

function formatChange(val) {
  if (val == null) return '--'
  return (val >= 0 ? '+' : '') + val.toFixed(2)
}

let intradayTimer = null
let judgmentTimer = null
let breadthTimer = null
const JUDGMENT_INTERVAL = 6 * 60 * 1000 // 6 分钟
const BREADTH_INTERVAL = 30 * 1000      // 30 秒

function startIntradayTimer() {
  if (intradayTimer) return
  fetchIndexIntraday()
  intradayTimer = setInterval(fetchIndexIntraday, REFRESH_INTERVAL)
}

function startJudgmentTimer() {
  if (judgmentTimer) return
  marketStore.fetchAll()
  judgmentTimer = setInterval(() => marketStore.fetchAll(), JUDGMENT_INTERVAL)
}

function startBreadthTimer() {
  if (breadthTimer) return
  marketStore.fetchBreadth()
  breadthTimer = setInterval(() => marketStore.fetchBreadth(), BREADTH_INTERVAL)
}

function refreshJudgment() {
  marketStore.fetchAll()
}

function stopIntradayTimer() {
  if (intradayTimer) { clearInterval(intradayTimer); intradayTimer = null }
}

function stopJudgmentTimer() {
  if (judgmentTimer) { clearInterval(judgmentTimer); judgmentTimer = null }
}

function stopBreadthTimer() {
  if (breadthTimer) { clearInterval(breadthTimer); breadthTimer = null }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopIntradayTimer()
    stopJudgmentTimer()
    stopBreadthTimer()
  } else {
    startIntradayTimer()
    startJudgmentTimer()
    startBreadthTimer()
  }
}

async function fetchIndexIntraday() {
  try {
    const res = await fetch('/api/market/indices/intraday')
    const json = await res.json()
    if (json.ok) {
      for (const key of ['sh', 'sz', 'cyb']) {
        if (json.data[key]?.trends?.length) indexIntraday.value[key] = json.data[key]
      }
    }
  } catch (e) { console.error('fetchIndexIntraday error:', e) }
}

onMounted(async () => {
  startIntradayTimer()
  startJudgmentTimer()
  startBreadthTimer()
  document.addEventListener('visibilitychange', onVisibilityChange)
  // Staggered reveal animations
  requestAnimationFrame(() => {
    setTimeout(() => { showSignals.value = true }, 100)
    setTimeout(() => { showChecklist.value = true }, 400)
  })
})

onBeforeUnmount(() => {
  stopIntradayTimer()
  stopJudgmentTimer()
  stopBreadthTimer()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
/* ===== ATMOSPHERIC BACKGROUND ===== */
.atmo-mesh {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(ellipse 600px 400px at 15% 20%, rgba(0, 113, 227, 0.06), transparent),
    radial-gradient(ellipse 500px 500px at 85% 70%, rgba(48, 209, 88, 0.04), transparent),
    radial-gradient(ellipse 400px 300px at 50% 90%, rgba(255, 69, 58, 0.03), transparent);
}

.dashboard {
  position: relative;
  z-index: 1;
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ===== LOADING ===== */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 24px;
}

.pulse-loader {
  position: relative;
  width: 64px;
  height: 64px;
}

.pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--accent);
  opacity: 0;
  animation: pulse-expand 2s ease-out infinite;
}

.pulse-ring.delay {
  animation-delay: 0.6s;
}

.pulse-core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-expand {
  0% { transform: scale(0.5); opacity: 0.8; }
  100% { transform: scale(2); opacity: 0; }
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.3); }
}

.loading-text {
  color: var(--text-secondary);
  font-size: 13px;
  letter-spacing: 0.05em;
}

/* ===== INDEX CARDS ===== */
.index-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.index-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.3s, transform 0.2s;
  min-height: 154px;
  contain: layout style;
}

.index-card:hover {
  border-color: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.index-card__header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}

.index-card__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.index-card__price {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.index-card__change {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
  white-space: nowrap;
}

.index-card__change.up {
  color: var(--red);
}

.index-card__change.down {
  color: var(--green);
}

.index-card__sparkline {
  margin: 0 -4px -4px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  min-height: 82px;
}

/* ===== MAIN GRID ===== */
.main-grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 20px;
}

/* ===== STATUS ORB ===== */
.status-orb-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.orb-container {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.orb {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 2;
  transition: all 0.6s ease;
}

.orb-glow {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  filter: blur(30px);
  opacity: 0.4;
  transition: all 0.6s ease;
}

.orb-bull .orb-glow {
  background: var(--red);
}

.orb-bear .orb-glow {
  background: var(--green);
}

.orb-neutral .orb-glow {
  background: var(--yellow);
}

.orb-bull {
  background: linear-gradient(135deg, rgba(255, 69, 58, 0.2), rgba(255, 69, 58, 0.05));
  border: 2px solid rgba(255, 69, 58, 0.3);
  box-shadow: 0 0 60px rgba(255, 69, 58, 0.15);
}

.orb-bear {
  background: linear-gradient(135deg, rgba(48, 209, 88, 0.2), rgba(48, 209, 88, 0.05));
  border: 2px solid rgba(48, 209, 88, 0.3);
  box-shadow: 0 0 60px rgba(48, 209, 88, 0.15);
}

.orb-neutral {
  background: linear-gradient(135deg, rgba(255, 214, 10, 0.15), rgba(255, 214, 10, 0.03));
  border: 2px solid rgba(255, 214, 10, 0.25);
  box-shadow: 0 0 60px rgba(255, 214, 10, 0.1);
}

.orb-inner {
  text-align: center;
}

.orb-label {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.orb-bull .orb-label { color: var(--red); }
.orb-bear .orb-label { color: var(--green); }
.orb-neutral .orb-label { color: var(--yellow); }

/* Orbit rings */
.orb-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid;
  animation: orb-spin 20s linear infinite;
}

.ring-1 {
  inset: -8px;
  border-color: rgba(255, 255, 255, 0.04);
}

.ring-2 {
  inset: -24px;
  border-color: rgba(255, 255, 255, 0.02);
  animation-direction: reverse;
  animation-duration: 30s;
}

@keyframes orb-spin {
  to { transform: rotate(360deg); }
}

.orb-meta {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.orb-meta__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.orb-meta__row:last-child {
  border-bottom: none;
}

.orb-meta__key {
  font-size: 12px;
  color: var(--text-muted);
}

.orb-meta__val {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.pos-bull { color: var(--green) !important; }
.pos-bear { color: var(--red) !important; }

.confirmed {
  color: var(--green);
  padding: 2px 8px;
  background: var(--green-dim);
  border-radius: 4px;
  font-size: 11px;
}

.unconfirmed {
  color: var(--text-muted);
  font-size: 12px;
}

/* Score bar */
.score-bar {
  width: 100%;
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  height: 28px;
  font-size: 11px;
  font-weight: 600;
}

.score-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  transition: flex 0.6s ease;
  white-space: nowrap;
  overflow: hidden;
}

.score-segment.bull {
  background: var(--red-dim);
  color: var(--red);
}

.score-segment.neutral {
  background: var(--bg-surface-alt);
  color: var(--text-muted);
}

.score-segment.bear {
  background: var(--green-dim);
  color: var(--green);
}

/* ===== SIGNALS PANEL ===== */
.signals-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.refresh-btn {
  margin-left: auto;
}

.title-icon {
  font-size: 14px;
}

.signals-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-auto-rows: minmax(85px, auto);
  gap: 10px;
}

.signal-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.3s, transform 0.3s, border-color 0.2s, background 0.2s;
}

.signal-card.signal-enter {
  animation: signal-in 0.4s ease forwards;
}

@keyframes signal-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.signal-card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}

.signal-card__indicator {
  width: 4px;
  min-height: 40px;
  border-radius: 2px;
  flex-shrink: 0;
  align-self: stretch;
}

.sig-bull { background: var(--red); }
.sig-bear { background: var(--green); }
.sig-neutral { background: var(--text-muted); opacity: 0.4; }

.signal-card__body {
  flex: 1;
  min-width: 0;
}

.signal-card__dim {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.div-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 0.02em;
  text-transform: none;
}

.div-badge.bullish {
  background: rgba(255, 69, 58, 0.15);
  color: var(--red);
}

.div-badge.bearish {
  background: rgba(48, 209, 88, 0.15);
  color: var(--green);
}

.weight-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 113, 227, 0.15);
  color: var(--accent);
  text-transform: none;
}

.score-wt {
  font-size: 10px;
  opacity: 0.7;
}

.signal-card__val {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.signal-card__desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.signal-card__tag {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
  align-self: flex-start;
}

.tag-bull {
  background: var(--red-dim);
  color: var(--red);
}

.tag-bear {
  background: var(--green-dim);
  color: var(--green);
}

.tag-neutral {
  background: var(--bg-surface-alt);
  color: var(--text-muted);
}

/* ===== LONG WINDOW ===== */
.long-window-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.lw-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
}

.lw-badge.pass {
  background: var(--green-dim);
  color: var(--green);
}

.lw-badge.fail {
  background: var(--bg-surface-alt);
  color: var(--text-muted);
}

.lw-conditions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.lw-cond {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.lw-cond.pass {
  border-color: rgba(48, 209, 88, 0.2);
  background: rgba(48, 209, 88, 0.04);
  color: var(--text-primary);
}

.lw-cond__icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--bg-surface-alt);
  color: var(--text-muted);
}

.lw-cond.pass .lw-cond__icon {
  background: var(--green-dim);
  color: var(--green);
}

/* ===== CHECKLIST ===== */
.checklist-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.checklist-progress {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  margin-left: auto;
  padding: 2px 10px;
  background: var(--accent-dim);
  border-radius: var(--radius-pill);
}

.checklist-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
  opacity: 0;
  transform: translateX(-6px);
}

.checklist-item.check-enter {
  animation: check-in 0.3s ease forwards;
}

@keyframes check-in {
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.checklist-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.checklist-item input {
  display: none;
}

.check-box {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1.5px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
  background: transparent;
}

.checked .check-box {
  background: var(--accent);
  border-color: var(--accent);
}

.check-mark {
  font-size: 12px;
  color: #fff;
  font-weight: 700;
}

.check-text {
  font-size: 13px;
  color: var(--text-secondary);
  transition: color 0.2s;
}

.checked .check-text {
  color: var(--text-primary);
}

/* ===== STRATEGY STOCK PICKS ===== */
.strategy-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.strategy-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  margin-left: 4px;
}

.strategy-badge.trend {
  background: var(--red-dim);
  color: var(--red);
}

.strategy-badge.pullback {
  background: var(--accent-dim);
  color: var(--accent);
}

.strategy-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--text-secondary);
}

.strategy-empty__icon {
  font-size: 20px;
  opacity: 0.5;
}

.prompt-block {
  margin-bottom: 16px;
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.prompt-actions {
  display: flex;
  gap: 4px;
}

.prompt-actions .btn.primary {
  color: var(--accent);
  font-weight: 600;
}

.prompt-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}

.prompt-code {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-mono);
  max-height: 100px;
  overflow-y: auto;
}

.prompt-edit {
  width: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  font-family: var(--font-mono);
  resize: vertical;
  outline: none;
}

.prompt-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

.screen-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px;
  font-size: 13px;
  color: var(--text-secondary);
}

.screen-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
}

.screen-empty__text {
  font-size: 13px;
  color: var(--text-secondary);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.stock-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.stock-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s;
}

.stock-card:hover {
  border-color: rgba(0, 113, 227, 0.3);
  background: rgba(0, 113, 227, 0.04);
  transform: translateY(-1px);
}

.stock-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.stock-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.stock-card__industry {
  font-size: 10px;
  color: var(--text-muted);
}

.stock-card__price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.stock-card__val {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.stock-card__chg {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stock-card__chg.up { color: var(--red); }
.stock-card__chg.down { color: var(--green); }

.stock-card__meta {
  display: flex;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.stock-card__meta span {
  background: var(--bg-surface-alt);
  padding: 1px 5px;
  border-radius: 3px;
}

.stock-card__flow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.flow-label {
  color: var(--text-muted);
}

.stock-card__flow .up { color: var(--red); font-weight: 600; }
.stock-card__flow .down { color: var(--green); font-weight: 600; }

.screen-refresh {
  margin-top: 12px;
  width: 100%;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 1024px) {
  .main-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .dashboard {
    padding: 16px;
    gap: 16px;
  }

  .index-row {
    grid-template-columns: 1fr;
  }

  .signals-grid {
    grid-template-columns: 1fr;
  }

  .lw-conditions {
    grid-template-columns: 1fr;
  }

  .stock-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .checklist-grid {
    grid-template-columns: 1fr;
  }

  .index-card__price {
    font-size: 22px;
  }
}
</style>
