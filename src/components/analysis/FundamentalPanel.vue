<template>
  <div class="fundamental-panel">
    <div v-if="!fundamental?.latest" class="no-data">暂无基本面数据</div>
    <template v-else>
      <!-- 区块 1: 估值区间 -->
      <div class="section">
        <h4 class="section-title">估值区间</h4>
        <div class="valuation-bars">
          <div class="valuation-row">
            <span class="val-label">PE</span>
            <div class="val-bar-wrap">
              <div class="val-bar">
                <div class="val-marker" :style="{ left: pePercentile + '%' }" />
              </div>
              <span class="val-current">{{ formatNum(latest.pe) }}倍</span>
            </div>
            <span class="val-percentile">{{ pePercentile }}分位</span>
          </div>
          <div class="valuation-row">
            <span class="val-label">PB</span>
            <div class="val-bar-wrap">
              <div class="val-bar">
                <div class="val-marker" :style="{ left: pbPercentile + '%' }" />
              </div>
              <span class="val-current">{{ formatNum(latest.pb) }}倍</span>
            </div>
            <span class="val-percentile">{{ pbPercentile }}分位</span>
          </div>
        </div>
      </div>

      <!-- 区块 2+3: 财务趋势 + 核心指标 一行 -->
      <div class="trend-indicators-row">
        <div v-if="fundamental?.history?.length >= 2" class="section trend-section">
          <h4 class="section-title">财务趋势（近 {{ displayHistory.length }} 季度）</h4>
          <div ref="trendChartRef" class="trend-chart" />
        </div>
        <div class="section indicators-section">
          <h4 class="section-title">核心指标</h4>
          <div class="indicator-groups">
            <div class="indicator-group">
              <h5>估值</h5>
              <div class="indicator-cards">
                <div class="ind-card">
                  <span class="ind-label">PE (TTM)</span>
                  <span class="ind-value" :class="getPEClass(latest.pe)">{{ formatNum(latest.pe) }}</span>
                  <span class="ind-hint" :class="getPEClass(latest.pe)">{{ getPEHint(latest.pe) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">PB (MRQ)</span>
                  <span class="ind-value" :class="getPBClass(latest.pb)">{{ formatNum(latest.pb) }}</span>
                  <span class="ind-hint" :class="getPBClass(latest.pb)">{{ getPBHint(latest.pb) }}</span>
                </div>
              </div>
            </div>
            <div class="indicator-group">
              <h5>盈利能力</h5>
              <div class="indicator-cards">
                <div class="ind-card">
                  <span class="ind-label">ROE</span>
                  <span class="ind-value" :class="getRoeClass(latest.roe)">{{ formatPct(latest.roe) }}</span>
                  <span class="ind-hint" :class="getRoeClass(latest.roe)">{{ getRoeHint(latest.roe) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">毛利率</span>
                  <span class="ind-value" :class="getGrossClass(latest.grossMargin)">{{ formatPct(latest.grossMargin) }}</span>
                  <span class="ind-hint" :class="getGrossClass(latest.grossMargin)">{{ getGrossHint(latest.grossMargin) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">净利率</span>
                  <span class="ind-value" :class="getNetClass(latest.netMargin)">{{ formatPct(latest.netMargin) }}</span>
                  <span class="ind-hint" :class="getNetClass(latest.netMargin)">{{ getNetHint(latest.netMargin) }}</span>
                </div>
              </div>
            </div>
            <div class="indicator-group">
              <h5>成长与安全</h5>
              <div class="indicator-cards">
                <div class="ind-card">
                  <span class="ind-label">营收增长</span>
                  <span class="ind-value" :class="getGrowthClass(latest.revenueGrowth)">{{ formatPct(latest.revenueGrowth) }}</span>
                  <span class="ind-hint" :class="getGrowthClass(latest.revenueGrowth)">{{ getGrowthHint(latest.revenueGrowth) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">净利增长</span>
                  <span class="ind-value" :class="getGrowthClass(latest.profitGrowth)">{{ formatPct(latest.profitGrowth) }}</span>
                  <span class="ind-hint" :class="getGrowthClass(latest.profitGrowth)">{{ getGrowthHint(latest.profitGrowth) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">负债率</span>
                  <span class="ind-value" :class="getDebtClass(latest.debtRatio)">{{ formatPct(latest.debtRatio) }}</span>
                  <span class="ind-hint" :class="getDebtClass(latest.debtRatio)">{{ getDebtHint(latest.debtRatio) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">总市值</span>
                  <span class="ind-value">{{ formatMarketCap(latest.totalMarketCap) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">每股现金流</span>
                  <span class="ind-value" :class="getCashFlowClass(latest.ocfToProfitRatio)">{{ latest.ocfPerShare != null ? latest.ocfPerShare.toFixed(2) + '元' : '--' }}</span>
                  <span class="ind-hint" :class="getCashFlowClass(latest.ocfToProfitRatio)">{{ getCashFlowHint(latest.ocfToProfitRatio) }}</span>
                </div>
                <div class="ind-card">
                  <span class="ind-label">现金流/收益</span>
                  <span class="ind-value" :class="getCashFlowClass(latest.ocfToProfitRatio)">{{ latest.ocfToProfitRatio != null ? latest.ocfToProfitRatio.toFixed(2) : '--' }}</span>
                  <span class="ind-hint" :class="getCashFlowClass(latest.ocfToProfitRatio)">{{ getCashFlowRatioHint(latest.ocfToProfitRatio) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, nextTick } from 'vue'
import * as echarts from 'echarts'
import { getPEThresholds, getPBThresholds, getDebtThresholds } from '../../utils/scoring.js'

const props = defineProps({
  fundamental: { type: Object, default: null }
})

const trendChartRef = ref(null)
let trendChart = null

const latest = computed(() => props.fundamental?.latest || {})

const displayHistory = computed(() => {
  const h = props.fundamental?.history || []
  return h.slice(0, 8).reverse()
})

const pePercentile = computed(() => {
  const h = props.fundamental?.history || []
  const pe = latest.value?.pe
  if (pe == null || !h.length) return 50
  // 排除最新一期，避免当前值包含在分布中
  const pes = h.slice(1).map(d => d.pe).filter(v => v != null && v > 0).sort((a, b) => a - b)
  if (!pes.length) return 50
  const idx = pes.findIndex(v => v >= pe)
  return Math.round((idx >= 0 ? idx : pes.length) / pes.length * 100)
})

const pbPercentile = computed(() => {
  const h = props.fundamental?.history || []
  const pb = latest.value?.pb
  if (pb == null || !h.length) return 50
  const pbs = h.slice(1).map(d => d.pb).filter(v => v != null && v > 0).sort((a, b) => a - b)
  if (!pbs.length) return 50
  const idx = pbs.findIndex(v => v >= pb)
  return Math.round((idx >= 0 ? idx : pbs.length) / pbs.length * 100)
})

function formatNum(v) {
  if (v == null) return '--'
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return Number.isInteger(v) ? v.toString() : v.toFixed(2)
}

function formatPct(v) {
  if (v == null) return '--'
  return v.toFixed(1) + '%'
}

function formatMarketCap(v) {
  if (v == null) return '--'
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿'
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  return (v / 1e4).toFixed(0) + '万'
}

// --- PE（行业感知） ---
function getPEClass(v) {
  if (v == null || v <= 0) return ''
  const t = getPEThresholds(latest.value?.industry || '')
  if (v <= t.low) return 'val-good'
  if (v <= t.fair) return 'val-neutral'
  if (v <= t.high) return 'val-warn'
  return 'val-bad'
}
function getPEHint(v) {
  if (v == null || v <= 0) return '--'
  const t = getPEThresholds(latest.value?.industry || '')
  if (v <= t.low) return '低估'
  if (v <= t.fair) return '合理'
  if (v <= t.high) return '偏高'
  return '高估'
}

// --- PB（行业感知） ---
function getPBClass(v) {
  if (v == null || v <= 0) return ''
  const t = getPBThresholds(latest.value?.industry || '')
  if (v <= t.low) return 'val-good'
  if (v <= t.fair) return 'val-neutral'
  if (v <= t.high) return 'val-warn'
  return 'val-bad'
}
function getPBHint(v) {
  if (v == null || v <= 0) return '--'
  const t = getPBThresholds(latest.value?.industry || '')
  if (v <= t.low) return '低估'
  if (v <= t.fair) return '合理'
  if (v <= t.high) return '偏高'
  return '高估'
}

// --- ROE ---
function getRoeClass(v) {
  if (v == null) return ''
  if (v >= 20) return 'val-good'
  if (v >= 12) return 'val-neutral'
  if (v >= 6) return 'val-warn'
  return 'val-bad'
}
function getRoeHint(v) {
  if (v == null) return '--'
  if (v >= 20) return '优秀'
  if (v >= 12) return '良好'
  if (v >= 6) return '一般'
  return '较弱'
}

// --- 毛利率 ---
function getGrossClass(v) {
  if (v == null) return ''
  if (v >= 40) return 'val-good'
  if (v >= 25) return 'val-neutral'
  if (v >= 15) return 'val-warn'
  return 'val-bad'
}
function getGrossHint(v) {
  if (v == null) return '--'
  if (v >= 40) return '优秀'
  if (v >= 25) return '良好'
  if (v >= 15) return '一般'
  if (v >= 5) return '偏低'
  return '很低'
}

// --- 净利率 ---
function getNetClass(v) {
  if (v == null) return ''
  if (v >= 20) return 'val-good'
  if (v >= 10) return 'val-neutral'
  if (v >= 3) return 'val-warn'
  return 'val-bad'
}
function getNetHint(v) {
  if (v == null) return '--'
  if (v >= 20) return '优秀'
  if (v >= 10) return '良好'
  if (v >= 3) return '一般'
  return '较低'
}

// --- 营收/净利增长 ---
function getGrowthClass(v) {
  if (v == null) return ''
  if (v >= 20) return 'val-good'
  if (v >= 10) return 'val-neutral'
  if (v >= 0) return 'val-warn'
  return 'val-bad'
}
function getGrowthHint(v) {
  if (v == null) return '--'
  if (v >= 20) return '高增长'
  if (v >= 10) return '稳健'
  if (v >= 0) return '放缓'
  return '下滑'
}

// --- 负债率 ---
function getDebtClass(v) {
  if (v == null) return ''
  const t = getDebtThresholds(latest.value?.industry || '')
  if (v <= t.safe) return 'val-good'
  if (v <= t.moderate) return 'val-neutral'
  if (v <= t.high) return 'val-warn'
  return 'val-bad'
}
function getDebtHint(v) {
  if (v == null) return '--'
  const t = getDebtThresholds(latest.value?.industry || '')
  if (v <= t.safe) return '安全'
  if (v <= t.moderate) return '适中'
  if (v <= t.high) return '偏高'
  return '高风险'
}

// --- 现金流 ---
function formatCashFlow(v) {
  if (v == null) return '--'
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + '万'
  return v.toLocaleString()
}

function getCashFlowClass(ratio) {
  if (ratio == null) return ''
  if (ratio >= 1.0) return 'val-good'
  if (ratio >= 0.5) return 'val-neutral'
  if (ratio >= 0) return 'val-warn'
  return 'val-bad'
}

function getCashFlowHint(ratio) {
  if (ratio == null) return '--'
  if (ratio >= 1.0) return '充裕'
  if (ratio >= 0.5) return '正常'
  if (ratio >= 0) return '偏少'
  return '为负，利润未转化为现金'
}

function getCashFlowRatioHint(ratio) {
  if (ratio == null) return '--'
  if (ratio >= 1.2) return '利润含金量高'
  if (ratio >= 0.8) return '现金与利润匹配'
  if (ratio >= 0.5) return '现金略少于账面利润'
  if (ratio > 0) return '利润含金量偏低'
  if (ratio > -1) return '经营现金流出，利润质量差'
  return '经营现金大幅流出，需警惕'
}

function renderTrendChart() {
  const hist = displayHistory.value
  if (!trendChart || hist.length < 2) return

  const dates = hist.map(d => d.date?.slice(0, 7) || '')
  const revenues = hist.map(d => d.revenue ? d.revenue / 1e8 : null)
  const profits = hist.map(d => d.netProfit ? d.netProfit / 1e8 : null)
  const grossMargins = hist.map(d => d.grossMargin)
  const roes = hist.map(d => d.roe)

  trendChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,41,59,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
    },
    legend: {
      data: ['营收', '净利润', '毛利率', 'ROE'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 0,
    },
    grid: { left: '8%', right: '8%', top: '14%', bottom: '10%' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 } },
    yAxis: [
      { type: 'value', name: '亿', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
      { type: 'value', name: '%', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      { name: '营收', type: 'bar', data: revenues, barWidth: '20%', itemStyle: { color: 'rgba(0,113,227,0.7)' } },
      { name: '净利润', type: 'bar', data: profits, barWidth: '20%', itemStyle: { color: 'rgba(48,209,88,0.7)' } },
      { name: '毛利率', type: 'line', yAxisIndex: 1, data: grossMargins, symbol: 'circle', symbolSize: 4, lineStyle: { width: 1.5, color: '#ffd60a' }, itemStyle: { color: '#ffd60a' } },
      { name: 'ROE', type: 'line', yAxisIndex: 1, data: roes, symbol: 'circle', symbolSize: 4, lineStyle: { width: 1.5, color: '#ff9500' }, itemStyle: { color: '#ff9500' } },
    ],
  }, true)
}

watch(() => props.fundamental, () => nextTick(() => {
  const hist = props.fundamental?.history || []
  if (hist.length < 2) {
    if (trendChartRef.value?._ro) trendChartRef.value._ro.disconnect()
    trendChart?.dispose()
    trendChart = null
    return
  }
  if (!trendChart && trendChartRef.value) {
    trendChart = echarts.init(trendChartRef.value)
    const ro = new ResizeObserver(() => trendChart?.resize())
    ro.observe(trendChartRef.value)
    trendChartRef.value._ro = ro
  }
  renderTrendChart()
}), { deep: true })

onMounted(() => {
  const hist = props.fundamental?.history || []
  if (trendChartRef.value && hist.length >= 2) {
    trendChart = echarts.init(trendChartRef.value)
    renderTrendChart()
    const ro = new ResizeObserver(() => trendChart?.resize())
    ro.observe(trendChartRef.value)
    trendChartRef.value._ro = ro
  }
})

onBeforeUnmount(() => {
  if (trendChartRef.value?._ro) trendChartRef.value._ro.disconnect()
  trendChart?.dispose()
  trendChart = null
})

onActivated(() => {
  nextTick(() => trendChart?.resize())
})
</script>

<style scoped>
.fundamental-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.no-data {
  text-align: center;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 14px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

/* 估值区间 */
.valuation-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.valuation-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.val-label {
  font-size: 13px;
  color: var(--text-secondary);
  width: 24px;
  flex-shrink: 0;
}

.val-bar-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.val-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(to right, #30d158, #ffd60a 50%, #ff453a);
  position: relative;
  opacity: 0.7;
}

.val-marker {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 14px;
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
}

.val-current {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
}

.val-percentile {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  width: 52px;
  text-align: right;
}

/* 财务趋势 + 核心指标 一行 */
.trend-indicators-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.trend-section {
  flex: 1;
  min-width: 0;
}

.indicators-section {
  flex: 1;
  min-width: 0;
}

/* 财务趋势图 */
.trend-chart {
  width: 100%;
  height: 260px;
}

/* 指标卡片 */
.indicator-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.indicator-group h5 {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
  font-weight: 500;
}

.indicator-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.ind-card {
  background: var(--bg-surface-alt);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ind-label {
  font-size: 11px;
  color: var(--text-muted);
}

.ind-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.ind-value.val-good { color: var(--green); }
.ind-value.val-neutral { color: var(--yellow); }
.ind-value.val-warn { color: #ff9500; }
.ind-value.val-bad { color: var(--red); }

.ind-hint {
  font-size: 11px;
  font-weight: 500;
}
.ind-hint.val-good { color: var(--green); }
.ind-hint.val-neutral { color: var(--yellow); }
.ind-hint.val-warn { color: #ff9500; }
.ind-hint.val-bad { color: var(--red); }

@media (max-width: 768px) {
  .trend-indicators-row {
    flex-direction: column;
  }

  .trend-chart { height: 200px; }
  .indicator-cards { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .indicator-cards { grid-template-columns: 1fr; }
  .trend-chart { height: 160px; }
}
</style>
