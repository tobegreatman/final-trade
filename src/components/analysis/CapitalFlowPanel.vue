<template>
  <div class="capital-flow-panel">
    <!-- 量价分析 -->
    <div class="section">
      <div class="section-header">
        <h4 class="section-title">量价分析</h4>
        <div v-if="priceVolumeSignal" class="signal-tag" :class="signalClass">
          {{ priceVolumeSignal }}
        </div>
      </div>
      <div v-if="volumeTrend" class="trend-info">
        <span>近5日均量 <strong>{{ formatVol(volumeTrend.recentAvgVol) }}</strong></span>
        <span>量能变化 <strong :class="volumeTrend.volumeChangeRate > 0 ? 'text-red' : 'text-green'">{{ volumeTrend.volumeChangeRate > 0 ? '+' : '' }}{{ volumeTrend.volumeChangeRate.toFixed(1) }}%</strong></span>
      </div>
      <div ref="chartRef" class="volume-chart" />
    </div>

    <!-- 北向资金 -->
    <div class="section">
      <h4 class="section-title">北向资金 <span class="title-sub">(季度数据)</span></h4>
      <template v-if="nbLatest">
        <div class="margin-cards">
          <div class="m-card">
            <span class="m-label">持股数量</span>
            <span class="m-value">{{ fmtShares(nbLatest.holdShares) }}</span>
          </div>
          <div class="m-card">
            <span class="m-label">持仓市值</span>
            <span class="m-value">{{ fmtYi(nbLatest.holdMarketCap) }}亿</span>
          </div>
          <div class="m-card">
            <span class="m-label">占流通股</span>
            <span class="m-value">{{ nbLatest.freeSharesRatio.toFixed(2) }}%</span>
          </div>
          <div class="m-card">
            <span class="m-label">持股变动</span>
            <span class="m-value" :class="nbLatest.changeRatio >= 0 ? 'text-red' : 'text-green'">
              {{ nbLatest.changeRatio >= 0 ? '+' : '' }}{{ nbLatest.changeRatio.toFixed(2) }}%
            </span>
          </div>
        </div>
        <div v-if="nbItems.length > 1" ref="nbChartRef" class="margin-chart" />
      </template>
      <div v-else class="unavailable">数据暂不可用</div>
    </div>

    <!-- 融资融券 -->
    <div class="section">
      <h4 class="section-title">融资融券</h4>
      <template v-if="marginLatest">
        <div class="margin-cards">
          <div class="m-card">
            <span class="m-label">融资余额</span>
            <span class="m-value">{{ fmtYi(marginLatest.rzBalance) }}亿</span>
          </div>
          <div class="m-card">
            <span class="m-label">融资净买入</span>
            <span class="m-value" :class="marginLatest.rzNetBuy >= 0 ? 'text-red' : 'text-green'">
              {{ marginLatest.rzNetBuy >= 0 ? '+' : '' }}{{ fmtYi(marginLatest.rzNetBuy) }}亿
            </span>
          </div>
          <div class="m-card">
            <span class="m-label">融券余额</span>
            <span class="m-value">{{ fmtWan(marginLatest.rqBalance) }}万</span>
          </div>
          <div class="m-card">
            <span class="m-label">余额变化</span>
            <span class="m-value" :class="marginLatest.balanceGrowth >= 0 ? 'text-red' : 'text-green'">
              {{ marginLatest.balanceGrowth >= 0 ? '+' : '' }}{{ marginLatest.balanceGrowth.toFixed(2) }}%
            </span>
          </div>
        </div>
        <div ref="marginChartRef" class="margin-chart" />
      </template>
      <div v-else class="unavailable">数据暂不可用</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  capitalFlow: { type: Object, default: null },
  marginData: { type: Object, default: null },
  northboundData: { type: Object, default: null }
})

const chartRef = ref(null)
const marginChartRef = ref(null)
const nbChartRef = ref(null)
let chart = null
let marginChart = null
let nbChart = null

const flows = computed(() => props.capitalFlow?.flows || [])
const priceVolumeSignal = computed(() => props.capitalFlow?.priceVolumeSignal || '')
const volumeTrend = computed(() => props.capitalFlow?.volumeTrend || null)
const marginLatest = computed(() => props.marginData?.available ? props.marginData.latest : null)
const marginItems = computed(() => props.marginData?.available ? (props.marginData.data || []) : [])
const nbLatest = computed(() => props.northboundData?.available ? props.northboundData.latest : null)
const nbItems = computed(() => props.northboundData?.available ? (props.northboundData.data || []) : [])

const signalClass = computed(() => {
  const s = priceVolumeSignal.value
  if (s.includes('上涨') || s.includes('流入')) return 'signal-bullish'
  if (s.includes('下跌') || s.includes('流出')) return 'signal-bearish'
  return 'signal-neutral'
})

function formatVol(v) {
  if (!v) return '--'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万'
  return v.toLocaleString()
}

function fmtYi(v) {
  if (v == null) return '--'
  return (v / 1e8).toFixed(2)
}

function fmtWan(v) {
  if (v == null) return '--'
  return (v / 1e4).toFixed(1)
}

function fmtShares(v) {
  if (!v) return '--'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿股'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万股'
  return v.toLocaleString() + '股'
}

function renderChart() {
  const data = flows.value
  if (!chart || !data.length) return

  const dates = data.map(d => d.date)
  const volumes = data.map(d => d.volume)
  const closes = data.map(d => d.close)
  const colors = data.map(d => d.isUp ? '#ff453a' : '#30d158')

  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,41,59,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
    },
    legend: {
      data: ['成交量', '收盘价'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 0,
    },
    grid: { left: '8%', right: '8%', top: '14%', bottom: '10%' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 } },
    yAxis: [
      { type: 'value', name: '成交量', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
      { type: 'value', name: '价格', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      { name: '成交量', type: 'bar', data: volumes, itemStyle: { color: (params) => colors[params.dataIndex] }, barMaxWidth: 12 },
      { name: '收盘价', type: 'line', yAxisIndex: 1, data: closes, symbol: 'none', lineStyle: { width: 1.5, color: '#0071e3' } },
    ],
  }, true)
}

function renderMarginChart() {
  const data = marginItems.value
  if (!marginChart || !data.length) return

  const dates = data.map(d => d.date)
  const balances = data.map(d => +(d.rzBalance / 1e8).toFixed(2))
  const netBuys = data.map(d => +(d.rzNetBuy / 1e8).toFixed(2))
  const netColors = netBuys.map(v => v >= 0 ? '#ff453a' : '#30d158')

  marginChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,41,59,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (params) => {
        if (!params?.length) return ''
        const idx = params[0].dataIndex
        const d = data[idx]
        if (!d) return ''
        let html = `<div style="margin-bottom:4px;font-weight:600">${d.date}</div>`
        html += `<div>融资余额: ${(d.rzBalance / 1e8).toFixed(2)}亿</div>`
        html += `<div style="color:${d.rzNetBuy >= 0 ? '#ff453a' : '#30d158'}">净买入: ${d.rzNetBuy >= 0 ? '+' : ''}${(d.rzNetBuy / 1e8).toFixed(2)}亿</div>`
        html += `<div>融券余额: ${(d.rqBalance / 1e4).toFixed(1)}万</div>`
        return html
      }
    },
    legend: {
      data: ['融资余额', '融资净买入'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 0,
    },
    grid: { left: '8%', right: '8%', top: '14%', bottom: '10%' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 } },
    yAxis: [
      { type: 'value', name: '亿', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
      { type: 'value', name: '净买入(亿)', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      { name: '融资余额', type: 'bar', data: balances, itemStyle: { color: 'rgba(0,113,227,0.6)' }, barMaxWidth: 12 },
      { name: '融资净买入', type: 'line', yAxisIndex: 1, data: netBuys, symbol: 'none', lineStyle: { width: 1.5, color: '#ffd60a' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(255,214,10,0.15)' },
          { offset: 1, color: 'rgba(255,214,10,0)' },
        ]) }
      },
    ],
  }, true)
}

watch(() => props.capitalFlow, () => nextTick(renderChart), { deep: true })
watch(() => props.marginData, () => nextTick(() => {
  if (!marginLatest.value) {
    if (marginChartRef.value?._ro) marginChartRef.value._ro.disconnect()
    marginChart?.dispose()
    marginChart = null
    return
  }
  if (!marginChart && marginChartRef.value) {
    marginChart = echarts.init(marginChartRef.value)
    const ro = new ResizeObserver(() => marginChart?.resize())
    ro.observe(marginChartRef.value)
    marginChartRef.value._ro = ro
  }
  renderMarginChart()
}), { deep: true })

function renderNbChart() {
  const data = nbItems.value
  if (!nbChart || data.length < 2) return

  const dates = data.map(d => d.date)
  const caps = data.map(d => +(d.holdMarketCap / 1e8).toFixed(2))
  const ratios = data.map(d => +d.freeSharesRatio.toFixed(2))

  nbChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,41,59,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (params) => {
        if (!params?.length) return ''
        const idx = params[0].dataIndex
        const d = data[idx]
        if (!d) return ''
        let html = `<div style="margin-bottom:4px;font-weight:600">${d.date}</div>`
        html += `<div>持股: ${fmtShares(d.holdShares)}</div>`
        html += `<div>市值: ${(d.holdMarketCap / 1e8).toFixed(2)}亿</div>`
        html += `<div>占流通股: ${d.freeSharesRatio.toFixed(2)}%</div>`
        html += `<div>占总股本: ${d.totalSharesRatio.toFixed(2)}%</div>`
        html += `<div style="color:${d.changeRatio >= 0 ? '#ff453a' : '#30d158'}">变动: ${d.changeRatio >= 0 ? '+' : ''}${d.changeRatio.toFixed(2)}%</div>`
        return html
      }
    },
    legend: {
      data: ['持仓市值', '占流通股比'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 0,
    },
    grid: { left: '8%', right: '8%', top: '14%', bottom: '10%' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 } },
    yAxis: [
      { type: 'value', name: '亿', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
      { type: 'value', name: '占流通股%', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      { name: '持仓市值', type: 'bar', data: caps, itemStyle: { color: 'rgba(59,130,246,0.6)' }, barMaxWidth: 24 },
      { name: '占流通股比', type: 'line', yAxisIndex: 1, data: ratios, symbol: 'circle', symbolSize: 6, lineStyle: { width: 1.5, color: '#22d3ee' },
        itemStyle: { color: '#22d3ee' },
      },
    ],
  }, true)
}

watch(() => props.northboundData, () => nextTick(() => {
  if (!nbLatest.value) {
    if (nbChartRef.value?._ro) nbChartRef.value._ro.disconnect()
    nbChart?.dispose()
    nbChart = null
    return
  }
  if (!nbChart && nbChartRef.value && nbItems.value.length > 1) {
    nbChart = echarts.init(nbChartRef.value)
    const ro = new ResizeObserver(() => nbChart?.resize())
    ro.observe(nbChartRef.value)
    nbChartRef.value._ro = ro
  }
  renderNbChart()
}), { deep: true })

onMounted(() => {
  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    renderChart()
    const ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartRef.value)
    chartRef.value._ro = ro
  }
  if (marginChartRef.value) {
    marginChart = echarts.init(marginChartRef.value)
    renderMarginChart()
    const ro = new ResizeObserver(() => marginChart?.resize())
    ro.observe(marginChartRef.value)
    marginChartRef.value._ro = ro
  }
  if (nbChartRef.value) {
    nbChart = echarts.init(nbChartRef.value)
    renderNbChart()
    const ro = new ResizeObserver(() => nbChart?.resize())
    ro.observe(nbChartRef.value)
    nbChartRef.value._ro = ro
  }
})

onBeforeUnmount(() => {
  if (chartRef.value?._ro) chartRef.value._ro.disconnect()
  chart?.dispose()
  chart = null
  if (marginChartRef.value?._ro) marginChartRef.value._ro.disconnect()
  marginChart?.dispose()
  marginChart = null
  if (nbChartRef.value?._ro) nbChartRef.value._ro.disconnect()
  nbChart?.dispose()
  nbChart = null
})
</script>

<style scoped>
.capital-flow-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.title-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.signal-tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 500;
  align-self: flex-start;
}

.signal-bullish { background: var(--green-dim); color: var(--green); }
.signal-bearish { background: var(--red-dim); color: var(--red); }
.signal-neutral { background: rgba(255, 214, 10, 0.12); color: var(--yellow); }

.trend-info {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: var(--text-secondary);
}

.trend-info strong { color: var(--text-primary); }

.text-red { color: var(--red); }
.text-green { color: var(--green); }

.volume-chart {
  width: 100%;
  height: 240px;
}

/* 融资融券指标卡片 */
.margin-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.m-card {
  background: var(--bg-surface-alt);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.m-label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.m-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.margin-chart {
  width: 100%;
  height: 220px;
}

.unavailable {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--bg-surface-alt);
  border-radius: var(--radius-sm);
}

@media (max-width: 768px) {
  .volume-chart { height: 180px; }
  .margin-chart { height: 180px; }
  .trend-info { flex-wrap: wrap; gap: 8px 20px; }
  .margin-cards { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .volume-chart { height: 150px; }
  .margin-chart { height: 150px; }
  .margin-cards { grid-template-columns: 1fr 1fr; }
}
</style>
