<template>
  <div class="page analysis-page">
    <!-- Header -->
    <header class="page-header">
      <div class="header-left">
        <h1 class="page-title">市场分析 <span class="title-sub">Market Analysis</span></h1>
      </div>
      <div class="header-right">
        <span v-if="store.lastUpdated" class="update-time">
          {{ formatTime(store.lastUpdated) }} 更新
          <span v-if="store.dataSources.sectors || store.dataSources.valuation" class="source-badge">
            {{ sourceLabel }}
          </span>
        </span>
        <button class="btn btn-ghost btn-sm" @click="refresh" :disabled="store.loading">
          {{ store.loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </header>

    <!-- Loading skeleton -->
    <div v-if="store.loading && !store.cyclePhase" class="loading-hint">加载市场数据中...</div>

    <template v-else>
      <!-- Data quality warning -->
      <div v-if="store.cyclePhase?.dataQuality?.score < 80" class="quality-warning">
        数据完整性 {{ store.cyclePhase?.dataQuality?.score ?? 0 }}%
        ({{ store.cyclePhase?.dataQuality?.dimensions ?? 0 }}/{{ store.cyclePhase?.dataQuality?.total ?? 5 }}维度有效)
        · 部分分析结论可能偏差
      </div>

      <!-- Section 1: Cycle Positioning -->
      <section class="card section-cycle">
        <div class="section-head">
          <h2 class="section-title">周期定位</h2>
          <span class="tag" :style="{ background: phaseBg, color: phaseColor }">
            {{ store.phaseMeta.emoji || '' }} {{ store.phaseLabel }}
          </span>
        </div>

        <!-- Phase badge -->
        <div class="phase-banner" :style="{ background: phaseBg }">
          <div class="phase-main">
            <span class="phase-emoji">{{ store.phaseMeta.emoji }}</span>
            <div class="phase-info">
              <div class="phase-name" :style="{ color: phaseColor }">{{ store.phaseLabel }}</div>
              <div class="phase-detail">
                综合评分 <strong>{{ store.cyclePhase?.score ?? '--' }}</strong>
                · 置信度 <strong>{{ store.cyclePhase?.confidence ?? '--' }}%</strong>
                <span v-if="store.cyclePhase?.pct20Status === 'bull'" class="signal-tag c-red">技术性牛市</span>
                <span v-else-if="store.cyclePhase?.pct20Status === 'bear'" class="signal-tag c-green">技术性熊市</span>
              </div>
            </div>
          </div>
          <!-- Signal counts -->
          <div class="signal-row">
            <span class="signal-item">
              <span class="c-red">▲</span> 牛市信号 {{ store.cyclePhase?.bullSignalCount ?? 0 }}/6
            </span>
            <span class="signal-item">
              <span class="c-green">▼</span> 熊市信号 {{ store.cyclePhase?.bearSignalCount ?? 0 }}/6
            </span>
          </div>
        </div>

        <!-- 5 indicator cards -->
        <div class="indicators-grid indicators-5">
          <div class="indicator-card">
            <div class="ind-label">价格趋势</div>
            <div class="ind-value">{{ ind.priceTrend }}</div>
            <div class="ind-sub">
              <span :class="ind.ma250Above ? 'c-green' : 'c-red'">
                {{ ind.ma250Above ? '站上' : '低于' }}MA250
              </span>
              <span class="ind-dir">{{ maDirLabel }}</span>
            </div>
          </div>
          <div class="indicator-card">
            <div class="ind-label">量价水平</div>
            <div class="ind-value">{{ ind.volumeLevel }}</div>
            <div class="ind-sub">
              {{ breadthAmount }}
            </div>
          </div>
          <div class="indicator-card">
            <div class="ind-label">市场情绪</div>
            <div class="ind-value">{{ ind.sentiment }}</div>
            <div class="ind-sub">
              {{ sentimentDesc }}
            </div>
          </div>
          <div class="indicator-card">
            <div class="ind-label">资金流向</div>
            <div class="ind-value">{{ ind.fundFlow }}</div>
            <div class="ind-sub">
              PE {{ ind.pe ?? '--' }} · {{ valLevel }}
            </div>
          </div>
          <div class="indicator-card">
            <div class="ind-label">北向资金</div>
            <div class="ind-value">{{ ind.northbound }}</div>
            <div class="ind-sub">
              {{ northboundDesc }}
            </div>
          </div>
        </div>
      </section>

      <!-- Section 2: Sector Rotation -->
      <section class="card section-sector">
        <div class="section-head">
          <h2 class="section-title">板块轮动</h2>
          <span v-if="!store.rsAvailable" class="tag tag-yellow">RS 数据积累中 ({{ store.rsDays }}/2)</span>
          <span v-else class="tag tag-green">RS {{ store.rsDays }}日</span>
        </div>

        <!-- Top5 / Bottom5 bars -->
        <div class="sector-bars-grid">
          <div class="bar-group">
            <h3 class="bar-group-title c-red">今日领涨板块</h3>
            <div v-for="s in topSectors" :key="s.code" class="bar-row">
              <span class="bar-name">{{ s.name }}</span>
              <div class="bar-track">
                <div class="bar-fill bar-fill--up" :style="{ width: barWidth(s.changePercent) }"></div>
              </div>
              <span class="bar-val c-red">{{ fmtPct(s.changePercent) }}</span>
            </div>
            <div v-if="!topSectors.length" class="bar-empty">暂无数据</div>
          </div>
          <div class="bar-group">
            <h3 class="bar-group-title c-green">今日领跌板块</h3>
            <div v-for="s in bottomSectors" :key="s.code" class="bar-row">
              <span class="bar-name">{{ s.name }}</span>
              <div class="bar-track">
                <div class="bar-fill bar-fill--down" :style="{ width: barWidth(s.changePercent) }"></div>
              </div>
              <span class="bar-val c-green">{{ fmtPct(s.changePercent) }}</span>
            </div>
            <div v-if="!bottomSectors.length" class="bar-empty">暂无数据</div>
          </div>
        </div>

        <!-- Expected sectors -->
        <div v-if="store.strategy?.expectedSectors?.length" class="expected-sectors">
          <span class="es-label">当前阶段预期强势板块：</span>
          <span v-for="(s, i) in store.strategy.expectedSectors.slice(0, 5)" :key="i" class="tag tag-blue">
            {{ s }}
          </span>
        </div>

        <!-- Sector detail table -->
        <div class="sector-table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>板块</th>
                <th>涨跌幅</th>
                <th>成交额</th>
                <th>上涨/下跌</th>
                <th>领涨股</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in pagedSectors" :key="s.code">
                <td class="td-rank">{{ i + 1 + (sectorPage - 1) * 10 }}</td>
                <td>{{ s.name }}</td>
                <td :class="s.changePercent >= 0 ? 'c-red' : 'c-green'">{{ fmtPct(s.changePercent) }}</td>
                <td>{{ fmtAmount(s.amount) }}</td>
                <td>
                  <span class="c-red">{{ s.upCount }}</span>/<span class="c-green">{{ s.downCount }}</span>
                </td>
                <td class="td-lead">{{ s.leadStock }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="store.sectors.length > 10" class="pager">
            <button class="btn btn-ghost btn-sm" :disabled="sectorPage <= 1" @click="sectorPage--">上一页</button>
            <span class="pager-info">{{ sectorPage }} / {{ totalPages }}</span>
            <button class="btn btn-ghost btn-sm" :disabled="sectorPage >= totalPages" @click="sectorPage++">下一页</button>
          </div>
        </div>
      </section>

      <!-- Section 3: Strategy -->
      <section class="card section-strategy">
        <h2 class="section-title">策略推荐</h2>

        <div class="strategy-summary">{{ store.strategy?.summary || '加载中...' }}</div>

        <div class="strategy-grid">
          <div class="st-card">
            <div class="st-label">建议仓位</div>
            <div class="st-value" :style="{ color: phaseColor }">{{ store.strategy?.positionSize || '--' }}</div>
          </div>
          <div class="st-card">
            <div class="st-label">风险等级</div>
            <div class="st-value" :style="{ color: store.strategy?.riskColor || 'var(--text-primary)' }">
              {{ store.strategy?.riskLabel || '--' }}
            </div>
          </div>
          <div class="st-card">
            <div class="st-label">关注板块</div>
            <div class="st-sectors">
              <span v-for="s in (store.strategy?.focusSectors || [])" :key="s" class="tag tag-blue">{{ s }}</span>
              <span v-if="!store.strategy?.focusSectors?.length">--</span>
            </div>
          </div>
        </div>

        <div class="action-list">
          <h3 class="action-title">每日行动清单</h3>
          <div v-for="(item, i) in (store.strategy?.actionItems || [])" :key="i" class="action-item">
            <span class="action-check">☐</span>
            <span class="action-text">{{ item }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMarketAnalysisStore } from '../stores/marketAnalysis.js'

const store = useMarketAnalysisStore()
const sectorPage = ref(1)

const phaseColor = computed(() => store.phaseMeta.color || 'var(--text-primary)')
const phaseBg = computed(() => store.phaseMeta.bgColor || 'var(--bg-surface-alt)')

const ind = computed(() => store.cyclePhase?.indicators || {})
const maDirLabel = computed(() => {
  const d = ind.value.ma250Direction
  if (d === 'up') return '向上'
  if (d === 'down') return '向下'
  return '走平'
})
const breadthAmount = computed(() => {
  const amt = ind.value.totalAmount
  if (!amt) return '--'
  const yi = amt / 1e8
  if (yi > 25000) return '成交活跃(>2.5万亿)'
  if (yi > 15000) return '成交一般(1.5-2.5万亿)'
  if (yi > 8000) return '成交偏低'
  return '成交清淡(<8000亿)'
})
const sentimentDesc = computed(() => {
  const s = ind.value.sentiment
  if (s >= 70) return '市场情绪亢奋'
  if (s >= 55) return '偏乐观'
  if (s >= 45) return '中性'
  if (s >= 30) return '偏悲观'
  if (s > 0) return '市场恐慌'
  return '--'
})
const valLevel = computed(() => {
  const l = ind.value.valuationLevel
  const map = { low: '低估', fair: '合理', elevated: '偏高', high: '高估' }
  return map[l] || '--'
})

const northboundDesc = computed(() => {
  const s = ind.value.northbound
  if (s >= 65) return '大幅净流入'
  if (s >= 55) return '净流入'
  if (s > 45) return '均衡'
  if (s > 35) return '净流出'
  if (s > 0) return '大幅净流出'
  return '无数据'
})

const topSectors = computed(() => store.sectors.slice(0, 5))
const bottomSectors = computed(() => store.sectors.slice(-5).reverse())
const totalPages = computed(() => Math.ceil(store.sectors.length / 10))

const sourceLabel = computed(() => {
  const s = store.dataSources
  const map = { eastmoney: '东财', sina: '新浪', tencent: '腾讯' }
  const parts = []
  if (s.sectors) parts.push('板块:' + (map[s.sectors] || s.sectors))
  if (s.valuation) parts.push('估值:' + (map[s.valuation] || s.valuation))
  return parts.join(' ') || ''
})

const pagedSectors = computed(() => {
  const start = (sectorPage.value - 1) * 10
  return store.sectors.slice(start, start + 10)
})

function barWidth(pct) {
  const w = Math.min(Math.abs(pct) * 8, 100)
  return Math.max(w, 2) + '%'
}

function fmtPct(v) {
  if (v == null) return '--'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

function fmtAmount(v) {
  if (!v) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万'
  return v.toString()
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
}

function refresh() {
  sectorPage.value = 1
  store.fetchAll()
}

onMounted(() => {
  store.loadFromCache()
  store.fetchAll()
  store.startAutoRefresh()
})

onUnmounted(() => {
  store.stopAutoRefresh()
})
</script>

<style scoped>
.analysis-page {
  padding-bottom: 40px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.title-sub {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 6px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.update-time {
  font-size: 12px;
  color: var(--text-muted);
}

.source-badge {
  display: inline-block;
  padding: 1px 6px;
  margin-left: 6px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--bg-surface-alt);
  color: var(--text-secondary);
}

.loading-hint {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ---- Section common ---- */
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-cycle,
.section-sector,
.section-strategy {
  margin-bottom: 16px;
}

.quality-warning {
  background: var(--yellow-dim);
  color: var(--yellow);
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  margin-bottom: 16px;
}

.signal-tag {
  font-size: 11px;
  margin-left: 8px;
  font-weight: 600;
}

.signal-row {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-secondary);
}

.signal-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ---- Cycle Positioning ---- */
.phase-banner {
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-bottom: 16px;
}

.phase-main {
  display: flex;
  align-items: center;
  gap: 14px;
}

.phase-emoji {
  font-size: 32px;
}

.phase-name {
  font-size: 18px;
  font-weight: 700;
}

.phase-detail {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.phase-detail strong {
  color: var(--text-primary);
}

.indicators-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.indicators-5 .indicator-card {
  padding: 12px;
}

.indicators-5 .ind-value {
  font-size: 18px;
}

.indicator-card {
  background: var(--bg-surface-alt);
  border-radius: var(--radius-sm);
  padding: 14px;
}

.ind-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.ind-value {
  font-size: 22px;
  font-weight: 700;
  font-family: var(--font-mono);
}

.ind-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.c-red { color: var(--red); }
.c-green { color: var(--green); }

/* ---- Sector Rotation ---- */
.sector-bars-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.bar-group-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.bar-name {
  width: 72px;
  font-size: 13px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  flex: 1;
  height: 8px;
  background: var(--bg-surface-alt);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.bar-fill--up {
  background: var(--red);
}

.bar-fill--down {
  background: var(--green);
}

.bar-val {
  width: 60px;
  font-size: 13px;
  font-family: var(--font-mono);
  text-align: right;
  flex-shrink: 0;
}

.bar-empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px 0;
}

.expected-sectors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  font-size: 13px;
}

.es-label {
  color: var(--text-secondary);
  margin-right: 4px;
}

.sector-table-wrap {
  overflow-x: auto;
}

.sector-table-wrap table {
  min-width: 560px;
}

.td-rank {
  width: 36px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.td-lead {
  color: var(--text-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0 4px;
}

.pager-info {
  font-size: 13px;
  color: var(--text-muted);
}

/* ---- Strategy ---- */
.strategy-summary {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--bg-surface-alt);
  border-radius: var(--radius-sm);
}

.strategy-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 12px;
  margin-bottom: 20px;
}

.st-card {
  background: var(--bg-surface-alt);
  border-radius: var(--radius-sm);
  padding: 16px;
}

.st-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.st-value {
  font-size: 24px;
  font-weight: 700;
  font-family: var(--font-mono);
}

.st-sectors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.action-list {
  margin-top: 4px;
}

.action-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.action-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.6;
}

.action-item:last-child {
  border-bottom: none;
}

.action-check {
  color: var(--text-muted);
  flex-shrink: 0;
}

.action-text {
  color: var(--text-secondary);
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .indicators-grid {
    grid-template-columns: 1fr 1fr;
  }

  .indicators-5 {
    grid-template-columns: 1fr 1fr;
  }

  .sector-bars-grid {
    grid-template-columns: 1fr;
  }

  .strategy-grid {
    grid-template-columns: 1fr;
  }
}
</style>
