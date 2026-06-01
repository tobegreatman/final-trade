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

    <!-- 主力资金流向 -->
    <div class="section">
      <h4 class="section-title">主力资金流向</h4>
      <template v-if="mfLatest">
        <div class="margin-cards">
          <div class="m-card">
            <span class="m-label">今日主力</span>
            <span class="m-value" :class="mfDisplayLatest.mainNetInflow >= 0 ? 'text-red' : 'text-green'">
              {{ mfDisplayLatest.mainNetInflow >= 0 ? '+' : '' }}{{ formatFlowYi(mfDisplayLatest.mainNetInflow) }}
            </span>
          </div>
          <div class="m-card">
            <span class="m-label">主力占比</span>
            <span class="m-value" :class="mfLatest.mainNetPct >= 0 ? 'text-red' : 'text-green'">
              {{ mfLatest.mainNetPct >= 0 ? '+' : '' }}{{ mfLatest.mainNetPct.toFixed(2) }}%
            </span>
          </div>
          <div class="m-card">
            <span class="m-label">超大单</span>
            <span class="m-value" :class="mfDisplayLatest.superLargeNetInflow >= 0 ? 'text-red' : 'text-green'">
              {{ mfDisplayLatest.superLargeNetInflow >= 0 ? '+' : '' }}{{ formatFlowYi(mfDisplayLatest.superLargeNetInflow) }}
            </span>
          </div>
          <div class="m-card">
            <span class="m-label">大单</span>
            <span class="m-value" :class="mfDisplayLatest.largeNetInflow >= 0 ? 'text-red' : 'text-green'">
              {{ mfDisplayLatest.largeNetInflow >= 0 ? '+' : '' }}{{ formatFlowYi(mfDisplayLatest.largeNetInflow) }}
            </span>
          </div>
        </div>
        <div v-if="mfSummary" class="trend-info" style="margin-top: 4px">
          <span>近5日主力合计 <strong :class="mfSummary.mainNetSum5 >= 0 ? 'text-red' : 'text-green'">{{ mfSummary.mainNetSum5 >= 0 ? '+' : '' }}{{ formatFlowYi(mfSummary.mainNetSum5) }}</strong></span>
          <span>均占比 <strong :class="mfSummary.mainNetAvgPct5 >= 0 ? 'text-red' : 'text-green'">{{ mfSummary.mainNetAvgPct5 >= 0 ? '+' : '' }}{{ mfSummary.mainNetAvgPct5.toFixed(2) }}%</strong></span>
        </div>
        <div class="chart-sub-title">今日分时流向</div>
        <div v-if="intradayItems.length > 1" ref="intradayChartRef" class="margin-chart" style="height: 200px" />
        <div v-else class="unavailable">分时数据积累中…</div>
        <div class="chart-sub-title" v-if="mfItems.length > 1">近20日流向</div>
        <div v-if="mfItems.length > 1" ref="mfChartRef" class="margin-chart" style="height: 280px" />
      </template>
      <div v-else class="unavailable">数据暂不可用</div>
    </div>

    <!-- 北向资金 -->
    <div class="section">
      <h4 class="section-title">北向资金 <span class="title-sub">({{ nbFrequency }})</span></h4>
      <template v-if="nbLatest">
        <div class="margin-cards">
          <div class="m-card">
            <span class="m-label">持股数量</span>
            <span class="m-value">{{ formatShares(nbLatest.holdShares) }}</span>
          </div>
          <div class="m-card">
            <span class="m-label">持仓市值</span>
            <span class="m-value">{{ formatYi(nbLatest.holdMarketCap) }}亿</span>
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
            <span class="m-value">{{ formatYi(marginLatest.rzBalance) }}亿</span>
          </div>
          <div class="m-card">
            <span class="m-label">融资净买入</span>
            <span class="m-value" :class="marginLatest.rzNetBuy >= 0 ? 'text-red' : 'text-green'">
              {{ marginLatest.rzNetBuy >= 0 ? '+' : '' }}{{ formatYi(marginLatest.rzNetBuy) }}亿
            </span>
          </div>
          <div class="m-card">
            <span class="m-label">融券余额</span>
            <span class="m-value">{{ formatWan(marginLatest.rqBalance) }}万</span>
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

    <!-- 股东户数 -->
    <div class="section">
      <h4 class="section-title">股东户数 <span class="title-sub">(季度数据)</span></h4>
      <template v-if="shLatest">
        <div class="margin-cards">
          <div class="m-card">
            <span class="m-label">股东户数</span>
            <span class="m-value">{{ shLatest.holderCount.toLocaleString() }}</span>
          </div>
          <div class="m-card">
            <span class="m-label">环比变化</span>
            <span class="m-value" :class="shLatest.changeRatio <= 0 ? 'text-red' : 'text-green'">
              {{ shLatest.changeRatio >= 0 ? '+' : '' }}{{ shLatest.changeRatio.toFixed(2) }}%
            </span>
          </div>
          <div class="m-card" v-if="shLatest.avgHoldNum">
            <span class="m-label">人均持股</span>
            <span class="m-value">{{ shLatest.avgHoldNum >= 10000 ? (shLatest.avgHoldNum / 10000).toFixed(2) + '万' : shLatest.avgHoldNum.toLocaleString() }}股</span>
          </div>
          <div class="m-card">
            <span class="m-label">筹码趋势</span>
            <span class="m-value" :class="shLatest.changeRatio <= 0 ? 'text-red' : 'text-green'">
              {{ shLatest.changeRatio <= 0 ? '集中' : '分散' }}
            </span>
          </div>
        </div>
        <div v-if="shItems.length > 1" ref="shChartRef" class="margin-chart" style="height: 200px" />
      </template>
      <div v-else class="unavailable">数据暂不可用</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useECharts } from '../../composables/useECharts.js'
import { formatVol, formatYi, formatWan, formatShares, formatFlowYi } from '../../utils/format.js'

const props = defineProps({
  capitalFlow: { type: Object, default: null },
  marginData: { type: Object, default: null },
  northboundData: { type: Object, default: null },
  mainForceFlow: { type: Object, default: null },
  shareholderData: { type: Object, default: null }
})

// DOM refs
const chartRef = ref(null)
const marginChartRef = ref(null)
const nbChartRef = ref(null)
const mfChartRef = ref(null)
const intradayChartRef = ref(null)
const shChartRef = ref(null)

// useECharts 实例 — 自动管理 init / resize / dispose / activated / deactivated
const volChart = useECharts(chartRef)
const marginChart = useECharts(marginChartRef)
const nbChart = useECharts(nbChartRef)
const mfChart = useECharts(mfChartRef)
const intradayChart = useECharts(intradayChartRef)
const shChart = useECharts(shChartRef)

const flows = computed(() => props.capitalFlow?.flows || [])
const priceVolumeSignal = computed(() => props.capitalFlow?.priceVolumeSignal || '')
const priceVolumeDir = computed(() => props.capitalFlow?.priceVolumeDir || null)
const volumeTrend = computed(() => props.capitalFlow?.volumeTrend || null)
const marginLatest = computed(() => props.marginData?.available ? props.marginData.latest : null)
const marginItems = computed(() => props.marginData?.available ? (props.marginData.data || []) : [])
const nbLatest = computed(() => props.northboundData?.available ? props.northboundData.latest : null)
const nbItems = computed(() => props.northboundData?.available ? (props.northboundData.data || []) : [])
const mfLatest = computed(() => props.mainForceFlow?.available ? props.mainForceFlow.latest : null)
const mfItems = computed(() => props.mainForceFlow?.available ? (props.mainForceFlow.data || []) : [])
const mfSummary = computed(() => props.mainForceFlow?.available ? props.mainForceFlow.summary : null)
const intradayItems = computed(() => props.mainForceFlow?.intraday?.items || [])
const intradayAgg = computed(() => props.mainForceFlow?.intraday?.aggregated || null)
// 卡片展示：优先用日内实时数据，回退日度
const mfDisplayLatest = computed(() => {
  if (!mfLatest.value) return null
  if (intradayAgg.value) return { ...mfLatest.value, ...intradayAgg.value }
  return mfLatest.value
})
const shLatest = computed(() => props.shareholderData?.available ? props.shareholderData.latest : null)
const shPrev = computed(() => props.shareholderData?.available ? props.shareholderData.prev : null)
const shItems = computed(() => props.shareholderData?.available ? (props.shareholderData.data || []) : [])

const nbFrequency = computed(() => props.northboundData?._frequency === 'daily' ? '日度数据' : '季度数据')

const signalClass = computed(() => {
  const dir = priceVolumeDir.value
  if (dir === 'bull') return 'signal-bullish'
  if (dir === 'bear') return 'signal-bearish'
  return 'signal-neutral'
})

function renderChart() {
  const data = flows.value
  if (!data.length) return

  const dates = data.map(d => d.date)
  const volumes = data.map(d => d.volume)
  const closes = data.map(d => d.close)
  const colors = data.map(d => d.isUp ? '#ff453a' : '#30d158')

  volChart.setOption({
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
  })
}

function renderMarginChart() {
  const data = marginItems.value
  if (!data.length) return

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

watch(() => props.capitalFlow, () => nextTick(() => renderChart()), { deep: true })
watch(() => props.marginData, () => nextTick(() => {
  if (!marginLatest.value) { marginChart.dispose(); return }
  renderMarginChart()
}), { deep: true })

function renderNbChart() {
  const data = nbItems.value
  if (data.length < 2) return

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
        html += `<div>持股: ${formatShares(d.holdShares)}</div>`
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
  if (!nbLatest.value) { nbChart.dispose(); return }
  renderNbChart()
}), { deep: true })

function renderIntradayChart() {
  const items = intradayItems.value
  if (items.length < 1) return

  const times = items.map(d => d.time.slice(11, 16))
  const y = (v) => +(v / 1e8).toFixed(4)
  const delta = (arr) => arr.map((v, i) => i === 0 ? v : +(v - arr[i - 1]).toFixed(4))

  const cumSuperLarge = items.map(d => y(d.superLargeNetInflow))
  const cumLarge = items.map(d => y(d.largeNetInflow))
  const cumMedium = items.map(d => y(d.mediumNetInflow))
  const cumSmall = items.map(d => y(d.smallNetInflow))
  const cumMain = items.map(d => y(d.mainNetInflow))

  const dSuperLarge = delta(cumSuperLarge)
  const dLarge = delta(cumLarge)
  const dMedium = delta(cumMedium)
  const dSmall = delta(cumSmall)
  const dMain = delta(cumMain)

  intradayChart.setOption({
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
        const d = items[idx]
        if (!d) return ''
        const t = d.time.slice(11, 16)
        const c = (v, label) => {
          const col = v >= 0 ? '#ff453a' : '#30d158'
          return `<span style="color:${col}">${v >= 0 ? '+' : ''}${v.toFixed(4)}亿</span>`
        }
        let html = `<div style="font-weight:600;margin-bottom:4px">${t}</div>`
        html += `<div>主力: ${c(dMain[idx], '')} (累计 ${c(cumMain[idx])})</div>`
        html += `<div style="color:#ff9500">  超大单: ${c(dSuperLarge[idx])} (累计 ${c(cumSuperLarge[idx])})</div>`
        html += `<div style="color:#5ac8fa">  大单: ${c(dLarge[idx])} (累计 ${c(cumLarge[idx])})</div>`
        html += `<div style="color:#bf5af2">  中单: ${c(dMedium[idx])} (累计 ${c(cumMedium[idx])})</div>`
        html += `<div style="color:#64d2ff">  小单: ${c(dSmall[idx])} (累计 ${c(cumSmall[idx])})</div>`
        return html
      },
    },
    legend: {
      data: ['主力累计', '超大单', '大单', '中单', '小单'],
      textStyle: { color: '#94a3b8', fontSize: 10 },
      top: 0,
    },
    grid: { left: '8%', right: '8%', top: '14%', bottom: '15%' },
    xAxis: {
      type: 'category', data: times,
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: {
        color: '#64748b', fontSize: 10,
        interval: (_i, v) => v?.endsWith(':00') || v?.endsWith(':30'),
      },
    },
    yAxis: [
      { type: 'value', name: '亿', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
      { type: 'value', name: '累计亿', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      {
        name: '主力累计', type: 'line', yAxisIndex: 1, data: cumMain,
        smooth: true, symbol: 'none',
        lineStyle: { width: 2, color: '#ffd60a' },
        itemStyle: { color: '#ffd60a' },
      },
      {
        name: '超大单', type: 'line', data: cumSuperLarge,
        symbol: 'none', lineStyle: { width: 1.2, color: '#ff9500' },
        itemStyle: { color: '#ff9500' },
      },
      {
        name: '大单', type: 'line', data: cumLarge,
        symbol: 'none', lineStyle: { width: 1.2, color: '#5ac8fa', type: 'dashed' },
        itemStyle: { color: '#5ac8fa' },
      },
      {
        name: '中单', type: 'line', data: cumMedium,
        symbol: 'none', lineStyle: { width: 1, color: '#bf5af2', type: 'dashed' },
        itemStyle: { color: '#bf5af2' },
      },
      {
        name: '小单', type: 'line', data: cumSmall,
        symbol: 'none', lineStyle: { width: 1, color: '#64d2ff', type: 'dashed' },
        itemStyle: { color: '#64d2ff' },
      },
    ],
  }, true)
}

function renderMfChart() {
  const data = mfItems.value.slice(-20)
  if (data.length < 2) return

  const dates = data.map(d => d.date)
  const mainFlows = data.map(d => +(d.mainNetInflow / 1e8).toFixed(2))
  const superLargeFlows = data.map(d => +(d.superLargeNetInflow / 1e8).toFixed(2))
  const largeFlows = data.map(d => +(d.largeNetInflow / 1e8).toFixed(2))

  mfChart.setOption({
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
        if (d.close != null) html += `<div>收盘: ${d.close}  涨跌: ${d.changePct > 0 ? '+' : ''}${d.changePct.toFixed(2)}%</div>`
        const pctStr = d.mainNetPct != null ? ` (${d.mainNetPct > 0 ? '+' : ''}${d.mainNetPct.toFixed(2)}%)` : ''
        html += `<div style="color:${d.mainNetInflow >= 0 ? '#ff453a' : '#30d158'}">主力净流入: ${formatFlowYi(d.mainNetInflow)}${pctStr}</div>`
        html += `<div style="color:${d.superLargeNetInflow >= 0 ? '#ff453a' : '#30d158'}">  超大单: ${formatFlowYi(d.superLargeNetInflow)}</div>`
        html += `<div style="color:${d.largeNetInflow >= 0 ? '#ff453a' : '#30d158'}">  大单: ${formatFlowYi(d.largeNetInflow)}</div>`
        html += `<div style="color:${d.mediumNetInflow >= 0 ? '#ff453a' : '#30d158'}">  中单: ${formatFlowYi(d.mediumNetInflow)}</div>`
        html += `<div style="color:${d.smallNetInflow >= 0 ? '#ff453a' : '#30d158'}">  小单: ${formatFlowYi(d.smallNetInflow)}</div>`
        return html
      }
    },
    legend: {
      data: ['主力净流入', '超大单', '大单'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 0,
    },
    grid: { left: '8%', right: '8%', top: '14%', bottom: '10%' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 } },
    yAxis: [
      { type: 'value', name: '亿', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
    ],
    series: [
      {
        name: '主力净流入', type: 'bar', data: mainFlows,
        itemStyle: { color: (p) => mainFlows[p.dataIndex] >= 0 ? '#ff453a' : '#30d158' },
        barMaxWidth: 20,
      },
      {
        name: '超大单', type: 'line', data: superLargeFlows,
        symbol: 'circle', symbolSize: 4,
        lineStyle: { width: 1.5, color: '#ff9500' },
        itemStyle: { color: '#ff9500' },
      },
      {
        name: '大单', type: 'line', data: largeFlows,
        symbol: 'circle', symbolSize: 4,
        lineStyle: { width: 1.5, color: '#5ac8fa', type: 'dashed' },
        itemStyle: { color: '#5ac8fa' },
      },
    ],
  }, true)
}

watch(() => props.mainForceFlow, () => nextTick(() => {
  if (!mfLatest.value) {
    mfChart.dispose()
    intradayChart.dispose()
    return
  }
  renderMfChart()
  // 日内分时图：需要等 v-if 生效后 DOM 才存在，延迟一帧
  nextTick(() => renderIntradayChart())
}), { deep: true })

function renderShChart() {
  const data = [...shItems.value].reverse()
  if (data.length < 2) return

  const dates = data.map(d => d.date?.slice(0, 10) || '')
  const counts = data.map(d => d.holderCount)
  shChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,41,59,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
    },
    grid: { left: '12%', right: '8%', top: '10%', bottom: '10%' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#475569' } }, axisLabel: { color: '#64748b', fontSize: 10, rotate: 30 } },
    yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
    series: [{
      type: 'line', data: counts, symbol: 'circle', symbolSize: 6,
      lineStyle: { width: 2, color: '#5ac8fa' },
      itemStyle: { color: '#5ac8fa' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(90,200,250,0.15)' },
        { offset: 1, color: 'rgba(90,200,250,0)' },
      ]) }
    }],
  }, true)
}

watch(() => props.shareholderData, () => nextTick(() => {
  if (!shLatest.value) { shChart.dispose(); return }
  renderShChart()
}), { deep: true })

// onMounted：数据已就位时渲染（处理切 tab 时 watcher 不触发的情况）
onMounted(() => nextTick(() => {
  if (flows.value.length) renderChart()
  if (mfItems.value.length > 1) renderMfChart()
  if (nbItems.value.length > 1) renderNbChart()
  if (marginItems.value.length) renderMarginChart()
  if (shItems.value.length > 1) renderShChart()
  // 日内分时图需要额外一帧等 v-if 渲染 DOM
  nextTick(() => { if (intradayItems.value.length > 1) renderIntradayChart() })
}))

// 注：onBeforeUnmount / onActivated / onDeactivated 由 useECharts composable 自动处理
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

.chart-sub-title {
  font-size: 11px;
  color: #64748b;
  margin-top: 8px;
  margin-bottom: 2px;
  padding-left: 2px;
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
