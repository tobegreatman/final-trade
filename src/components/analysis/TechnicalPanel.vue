<template>
  <div class="technical-panel">
    <!-- 周期切换 + 技术信号 -->
    <div class="period-bar">
      <div class="period-btns">
        <button v-for="p in periods" :key="p.klt" :class="['period-btn', { active: activePeriod === p.klt }]" @click="switchPeriod(p.klt)">
          {{ p.label }}
        </button>
      </div>
      <div v-if="signals.length" class="signal-list">
        <span v-for="(s, i) in signals" :key="i" :class="['signal-badge', s.type]">
          {{ s.text }}
        </span>
      </div>
      <span v-else class="no-signals">暂无信号</span>
    </div>

    <!-- 图表 + 右侧指标面板 -->
    <div class="chart-layout">
      <div ref="chartRef" class="kline-chart" />
      <div v-if="latestIndicators.length" class="analysis-sidebar">
        <div class="sidebar-section">
          <div class="sidebar-title">最新指标</div>
          <div class="indicator-grid">
            <template v-for="g in latestIndicators" :key="g.group">
              <div class="ind-group-label">{{ g.group }}</div>
              <div class="ind-row" v-for="item in g.items" :key="item.label">
                <span class="ind-label">{{ item.label }}</span>
                <span class="ind-value" :style="{ color: item.color }">{{ item.value }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick } from 'vue'
import * as echarts from 'echarts'
import { formatVol } from '../../utils/format.js'

const props = defineProps({
  klines: { type: Array, default: () => [] },
  indicators: { type: Object, default: () => ({}) },
  signals: { type: Array, default: () => [] },
  activePeriod: { type: String, default: '101' }
})

const emit = defineEmits(['period-change'])

const chartRef = ref(null)
let chart = null

const fmt = (v) => {
  if (v == null) return '--'
  const n = Number(v)
  if (Number.isInteger(n)) return n.toString()
  return parseFloat(n.toFixed(4)).toString()
}

const latestIndicators = computed(() => {
  const ind = props.indicators
  const last = props.klines.length - 1
  if (last < 0) return []

  const groups = []

  // MA
  const ma = ind.ma || {}
  const maItems = []
  const maColors = { 5: '#ffd60a', 10: '#30d158', 20: '#0071e3', 60: '#ff9500' }
  for (const p of [5, 10, 20, 60]) {
    if (ma[p]?.[last] != null) maItems.push({ label: `MA${p}`, value: fmt(ma[p][last]), color: maColors[p] })
  }
  if (maItems.length) groups.push({ group: '均线 MA', items: maItems })

  // MACD
  const macd = ind.macd || {}
  const macdItems = []
  if (macd.dif?.[last] != null) macdItems.push({ label: 'DIF', value: fmt(macd.dif[last]), color: '#ffd60a' })
  if (macd.dea?.[last] != null) macdItems.push({ label: 'DEA', value: fmt(macd.dea[last]), color: '#0071e3' })
  if (macd.histogram?.[last] != null) macdItems.push({ label: 'MACD', value: fmt(macd.histogram[last]), color: macd.histogram[last] >= 0 ? '#ff453a' : '#30d158' })
  if (macdItems.length) groups.push({ group: 'MACD', items: macdItems })

  // KDJ
  const kdj = ind.kdj || {}
  const kdjItems = []
  if (kdj.k?.[last] != null) kdjItems.push({ label: 'K', value: fmt(kdj.k[last]), color: '#ffd60a' })
  if (kdj.d?.[last] != null) kdjItems.push({ label: 'D', value: fmt(kdj.d[last]), color: '#0071e3' })
  if (kdj.j?.[last] != null) kdjItems.push({ label: 'J', value: fmt(kdj.j[last]), color: '#ff453a' })
  if (kdjItems.length) groups.push({ group: 'KDJ', items: kdjItems })

  // RSI
  const rsi = ind.rsi || {}
  const rsiItems = []
  if (rsi[6]?.[last] != null) rsiItems.push({ label: 'RSI6', value: fmt(rsi[6][last]), color: '#ffd60a' })
  if (rsi[12]?.[last] != null) rsiItems.push({ label: 'RSI12', value: fmt(rsi[12][last]), color: '#0071e3' })
  if (rsi[24]?.[last] != null) rsiItems.push({ label: 'RSI24', value: fmt(rsi[24][last]), color: '#ff9500' })
  if (rsiItems.length) groups.push({ group: 'RSI', items: rsiItems })

  // BOLL
  const boll = ind.boll || {}
  const bollItems = []
  if (boll.upper?.[last] != null) bollItems.push({ label: 'UPR', value: fmt(boll.upper[last]), color: 'rgba(255,149,0,0.7)' })
  if (boll.mid?.[last] != null) bollItems.push({ label: 'MID', value: fmt(boll.mid[last]), color: 'rgba(255,149,0,0.9)' })
  if (boll.lower?.[last] != null) bollItems.push({ label: 'LOW', value: fmt(boll.lower[last]), color: 'rgba(255,149,0,0.7)' })
  if (bollItems.length) groups.push({ group: 'BOLL', items: bollItems })

  return groups
})

const periods = [
  { klt: '101', label: '日K' },
  { klt: '102', label: '周K' },
  { klt: '103', label: '月K' }
]

function switchPeriod(klt) {
  if (klt === props.activePeriod) return
  emit('period-change', klt)
}

function buildChartOption() {
  const klines = props.klines
  const ind = props.indicators
  if (!klines.length) return null

  const dates = klines.map(k => k.date)
  const ohlc = klines.map(k => [k.open, k.close, k.low, k.high])
  const volumes = klines.map(k => k.volume)
  const volColors = klines.map(k => k.close >= k.open ? '#ff453a' : '#30d158')

  const ma = ind.ma || {}
  const macd = ind.macd || {}
  const kdj = ind.kdj || {}
  const rsi = ind.rsi || {}
  const boll = ind.boll || {}

  // Grid 布局: K线32% 成交量8% MACD10% KDJ10% RSI10%
  const grids = [
    { left: '8%', right: '3%', top: '3%', height: '32%' },
    { left: '8%', right: '3%', top: '38%', height: '8%' },
    { left: '8%', right: '3%', top: '49%', height: '10%' },
    { left: '8%', right: '3%', top: '62%', height: '10%' },
    { left: '8%', right: '3%', top: '75%', height: '10%' },
  ]

  const xAxisBase = {
    type: 'category',
    data: dates,
    axisLine: { lineStyle: { color: '#475569' } },
    axisLabel: { color: '#64748b', fontSize: 10 },
    axisTick: { show: false },
    splitLine: { show: false },
  }

  const yAxisBase = {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#64748b', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
  }

  const xAxes = grids.map((g, i) => ({
    ...xAxisBase,
    gridIndex: i,
    show: i === 4,
  }))

  const yAxes = [
    { ...yAxisBase, gridIndex: 0, scale: true, splitNumber: 3 },
    { ...yAxisBase, gridIndex: 1, splitNumber: 2, axisLabel: { ...yAxisBase.axisLabel, formatter: v => v >= 1e6 ? (v / 1e6).toFixed(0) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v } },
    { ...yAxisBase, gridIndex: 2, splitNumber: 2 },
    { ...yAxisBase, gridIndex: 3, min: 0, max: 100, splitNumber: 2 },
    { ...yAxisBase, gridIndex: 4, min: 0, max: 100, splitNumber: 2 },
  ]

  const series = [
    // Grid 0: K 线
    {
      name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: ohlc,
      itemStyle: { color: '#ffffff', color0: '#ff453a', borderColor: '#ffffff', borderColor0: '#ff453a' }
    },
    // MA lines on grid 0
    ...(ma[5] ? [{ name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma[5], smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#ffd60a' } }] : []),
    ...(ma[10] ? [{ name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma[10], smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#30d158' } }] : []),
    ...(ma[20] ? [{ name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma[20], smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#0071e3' } }] : []),
    ...(ma[60] ? [{ name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma[60], smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#ff9500' } }] : []),
    // BOLL on grid 0
    ...(boll.upper ? [{ name: 'BOLL上', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: boll.upper, smooth: true, symbol: 'none', lineStyle: { width: 1, color: 'rgba(255,149,0,0.4)', type: 'dashed' } }] : []),
    ...(boll.mid ? [{ name: 'BOLL中', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: boll.mid, smooth: true, symbol: 'none', lineStyle: { width: 1, color: 'rgba(255,149,0,0.6)' } }] : []),
    ...(boll.lower ? [{ name: 'BOLL下', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: boll.lower, smooth: true, symbol: 'none', lineStyle: { width: 1, color: 'rgba(255,149,0,0.4)', type: 'dashed' } }] : []),

    // Grid 1: 成交量
    {
      name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes,
      itemStyle: { color: (params) => volColors[params.dataIndex] }
    },

    // Grid 2: MACD
    ...(macd.dif ? [{ name: 'DIF', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: macd.dif, symbol: 'none', lineStyle: { width: 1, color: '#ffd60a' } }] : []),
    ...(macd.dea ? [{ name: 'DEA', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: macd.dea, symbol: 'none', lineStyle: { width: 1, color: '#0071e3' } }] : []),
    ...(macd.histogram ? [{ name: 'MACD柱', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, data: macd.histogram, itemStyle: { color: (params) => params.value >= 0 ? '#ff453a' : '#30d158' } }] : []),

    // Grid 3: KDJ
    ...(kdj.k ? [{ name: 'K', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: kdj.k, symbol: 'none', lineStyle: { width: 1, color: '#ffd60a' } }] : []),
    ...(kdj.d ? [{ name: 'D', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: kdj.d, symbol: 'none', lineStyle: { width: 1, color: '#0071e3' } }] : []),
    ...(kdj.j ? [{ name: 'J', type: 'line', xAxisIndex: 3, yAxisIndex: 3, data: kdj.j, symbol: 'none', lineStyle: { width: 1, color: '#ff453a' } }] : []),

    // Grid 4: RSI
    ...(rsi[6] ? [{ name: 'RSI6', type: 'line', xAxisIndex: 4, yAxisIndex: 4, data: rsi[6], symbol: 'none', lineStyle: { width: 1, color: '#ffd60a' } }] : []),
    ...(rsi[12] ? [{ name: 'RSI12', type: 'line', xAxisIndex: 4, yAxisIndex: 4, data: rsi[12], symbol: 'none', lineStyle: { width: 1, color: '#0071e3' } }] : []),
    ...(rsi[24] ? [{ name: 'RSI24', type: 'line', xAxisIndex: 4, yAxisIndex: 4, data: rsi[24], symbol: 'none', lineStyle: { width: 1, color: '#ff9500' } }] : []),
  ]

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    series,
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3, 4], start: 0, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1, 2, 3, 4], bottom: '2%', height: 14, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.03)', fillerColor: 'rgba(0,113,227,0.15)', handleStyle: { color: '#0071e3' }, textStyle: { color: '#64748b', fontSize: 10 } }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(30,41,59,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (params) => {
        if (!params?.length) return ''
        const date = params[0].axisValue
        const k = klines[params[0].dataIndex]
        let html = `<div style="margin-bottom:4px;font-weight:600">${date}</div>`
        if (k) {
          html += `<div style="color:#94a3b8">开 ${fmt(k.open)} 收 ${fmt(k.close)} 高 ${fmt(k.high)} 低 ${fmt(k.low)}</div>`
          html += `<div style="color:#94a3b8">量 ${formatVol(k.volume)}</div>`
        }
        for (const p of params) {
          if (p.seriesName === 'K线' || p.seriesName === '成交量') continue
          const val = Array.isArray(p.value) ? p.value.map(fmt).join(' / ') : fmt(p.value)
          html += `<div>${p.marker} ${p.seriesName}: ${val}</div>`
        }
        return html
      }
    },
  }
}

function renderChart() {
  if (!chart || !props.klines.length) return
  const option = buildChartOption()
  if (option) chart.setOption(option, true)
}

watch(() => [props.klines, props.indicators], () => {
  nextTick(renderChart)
}, { deep: true })

onMounted(() => {
  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    renderChart()
    const ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartRef.value)
    chartRef.value._ro = ro
  }
})

onBeforeUnmount(() => {
  if (chartRef.value?._ro) chartRef.value._ro.disconnect()
  chart?.dispose()
  chart = null
})

onActivated(() => {
  nextTick(() => {
    if (chartRef.value && !chart) {
      chart = echarts.init(chartRef.value)
      renderChart()
    }
    if (chartRef.value && chart && !chartRef.value._ro) {
      const ro = new ResizeObserver(() => chart?.resize())
      ro.observe(chartRef.value)
      chartRef.value._ro = ro
    }
    chart?.resize()
  })
})

onDeactivated(() => {
  if (chartRef.value?._ro) { chartRef.value._ro.disconnect(); chartRef.value._ro = null }
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.technical-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.period-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.period-btns {
  display: flex;
  gap: 6px;
}

.period-btn {
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.period-btn:hover {
  background: var(--bg-surface-alt);
  color: var(--text-primary);
}

.period-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: var(--accent);
}

.chart-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.kline-chart {
  flex: 1;
  min-width: 0;
  height: 616px;
  min-height: 360px;
}

.analysis-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

.sidebar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.signal-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.no-signals {
  color: var(--text-muted);
  font-size: 12px;
}

.signal-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
}

.signal-badge.bullish {
  background: var(--green-dim);
  color: var(--green);
}

.signal-badge.bearish {
  background: var(--red-dim);
  color: var(--red);
}

.signal-badge.neutral {
  background: rgba(255, 214, 10, 0.12);
  color: var(--yellow);
}

.indicator-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ind-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  padding-bottom: 2px;
  border-bottom: 1px solid var(--border);
}

.ind-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
}

.ind-label {
  font-size: 12px;
  color: var(--text-muted);
}

.ind-value {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1200px) {
  .analysis-sidebar {
    max-width: 220px;
  }
}

@media (max-width: 1024px) {
  .chart-layout {
    flex-direction: column;
  }

  .kline-chart {
    width: 100%;
    height: 700px;
    min-height: 360px;
  }

  .analysis-sidebar {
    max-width: 100%;
  }

  .sidebar-section {
    flex: 1;
    min-width: 200px;
  }
}

@media (max-width: 768px) {
  .kline-chart {
    width: 100%;
    height: 520px;
    min-height: 340px;
  }
}

@media (max-width: 480px) {
  .kline-chart {
    width: 100%;
    height: 420px;
    min-height: 300px;
  }

  .signal-list {
    overflow-x: auto;
    flex-wrap: nowrap;
  }

  .signal-badge {
    flex-shrink: 0;
  }
}
</style>
