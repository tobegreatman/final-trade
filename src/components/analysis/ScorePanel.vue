<template>
  <div class="score-panel">
    <div v-if="!scoreResult" class="no-data">暂无评分数据</div>
    <template v-else>
      <!-- 仪表盘 + 雷达图 + 维度进度条 一行 -->
      <div class="score-row">
        <div class="gauge-wrap">
          <div ref="gaugeRef" class="gauge-chart" />
          <div class="score-summary">
            <div class="suggestion" :style="{ color: scoreResult.suggestionColor }">
              {{ scoreResult.suggestion }}
            </div>
            <div class="confidence">
              {{ '★'.repeat(scoreResult.confidenceStars) }}{{ '☆'.repeat(5 - scoreResult.confidenceStars) }}
              <span class="confidence-label">{{ confidenceLabel }}</span>
            </div>
          </div>
        </div>
        <div ref="radarRef" class="radar-chart" />
        <div class="dimension-bars">
          <div v-for="(dim, key) in dimensionList" :key="key" class="dim-row">
            <span class="dim-label">{{ dim.label }}</span>
            <div class="dim-bar-track">
              <div class="dim-bar-fill" :style="{ width: dim.pct + '%', background: dim.color }" />
            </div>
            <span class="dim-score">{{ dim.pct }}%</span>
          </div>
        </div>
      </div>

      <!-- 明细：技术面 + 基本面 + 资金面 三列 -->
      <div class="details-section">
        <h4 class="section-title">评分明细</h4>
        <div class="details-cols">
          <div class="detail-col">
            <div class="col-header">技术面</div>
            <div class="detail-list">
              <div v-for="(item, i) in techDetails" :key="i" class="detail-item">
                <span class="detail-name">{{ item.name }}</span>
                <span class="detail-score">{{ item.score }}/{{ item.max }}</span>
                <span :class="['verdict-badge', getVerdict(item)]">{{ item.desc }}</span>
              </div>
            </div>
          </div>
          <div class="detail-col">
            <div class="col-header">基本面</div>
            <div class="detail-list">
              <div v-for="(item, i) in fundDetails" :key="i" class="detail-item">
                <span class="detail-name">{{ item.name }}</span>
                <span class="detail-score">{{ item.score }}/{{ item.max }}</span>
                <span :class="['verdict-badge', getVerdict(item)]">{{ item.desc }}</span>
              </div>
            </div>
          </div>
          <div class="detail-col">
            <div class="col-header">资金面</div>
            <div class="detail-list">
              <div v-for="(item, i) in capitalDetails" :key="i" class="detail-item">
                <span class="detail-name">{{ item.name }}</span>
                <span class="detail-score">{{ item.score }}/{{ item.max }}</span>
                <span :class="['verdict-badge', getVerdict(item)]">{{ item.desc }}</span>
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

const props = defineProps({
  scoreResult: { type: Object, default: null }
})

const gaugeRef = ref(null)
const radarRef = ref(null)
let gaugeChart = null
let radarChart = null

const confidenceLabel = computed(() => {
  const c = props.scoreResult?.confidence
  if (c === 'high') return '高'
  if (c === 'medium') return '中'
  return '低'
})

const dimensionList = computed(() => {
  const dims = props.scoreResult?.dimensions
  if (!dims) return []
  return [
    { label: '技术面', pct: dims.technical.pct, color: '#0071e3' },
    { label: '基本面', pct: dims.fundamental.pct, color: '#30d158' },
    { label: '资金面', pct: dims.capital.pct, color: '#ffd60a' },
  ]
})

const fundDetails = computed(() => (props.scoreResult?.details || []).filter(d => d.dimension === '基本面'))
const capitalDetails = computed(() => (props.scoreResult?.details || []).filter(d => d.dimension === '资金面'))
const techDetails = computed(() => (props.scoreResult?.details || []).filter(d => d.dimension === '技术面'))

function getVerdict(item) {
  const ratio = item.max > 0 ? item.score / item.max : 0
  if (ratio >= 0.7) return 'verdict-good'
  if (ratio >= 0.4) return 'verdict-neutral'
  return 'verdict-bad'
}

function renderGauge() {
  const total = props.scoreResult?.total
  if (!gaugeChart || total == null) return

  gaugeChart.setOption({
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      splitNumber: 5,
      radius: '90%',
      center: ['50%', '55%'],
      axisLine: {
        lineStyle: {
          width: 14,
          color: [
            [0.3, '#ff453a'],
            [0.5, '#ffd60a'],
            [0.7, '#0071e3'],
            [1, '#30d158'],
          ]
        }
      },
      axisTick: { length: 4, lineStyle: { color: 'auto' } },
      splitLine: { length: 10, lineStyle: { color: 'auto', width: 1 } },
      axisLabel: { color: '#64748b', fontSize: 10, distance: 12 },
      pointer: { width: 4, length: '60%', itemStyle: { color: 'auto' } },
      title: { show: false },
      detail: {
        valueAnimation: true,
        formatter: '{value}',
        fontSize: 28,
        fontWeight: 700,
        color: '#e2e8f0',
        offsetCenter: [0, '30%'],
      },
      data: [{ value: total }]
    }]
  }, true)
}

function renderRadar() {
  const dims = props.scoreResult?.dimensions
  if (!radarChart || !dims) return

  radarChart.setOption({
    backgroundColor: 'transparent',
    radar: {
      indicator: [
        { name: '技术面', max: 100 },
        { name: '基本面', max: 100 },
        { name: '资金面', max: 100 },
      ],
      radius: '70%',
      axisName: { color: '#94a3b8', fontSize: 12 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: [dims.technical.pct, dims.fundamental.pct, dims.capital.pct],
        areaStyle: { color: 'rgba(0,113,227,0.2)' },
        lineStyle: { color: '#0071e3', width: 2 },
        itemStyle: { color: '#0071e3' },
      }]
    }]
  }, true)
}

let mounted = false

watch(() => props.scoreResult, (val) => {
  if (mounted && val) nextTick(() => { renderGauge(); renderRadar() })
}, { deep: true })

onMounted(() => {
  nextTick(() => {
    if (gaugeRef.value) {
      gaugeChart = echarts.init(gaugeRef.value)
      renderGauge()
      const ro1 = new ResizeObserver(() => gaugeChart?.resize())
      ro1.observe(gaugeRef.value)
      gaugeRef.value._ro = ro1
    }
    if (radarRef.value) {
      radarChart = echarts.init(radarRef.value)
      renderRadar()
      const ro2 = new ResizeObserver(() => radarChart?.resize())
      ro2.observe(radarRef.value)
      radarRef.value._ro = ro2
    }
    mounted = true
  })
})

onBeforeUnmount(() => {
  if (gaugeRef.value?._ro) gaugeRef.value._ro.disconnect()
  if (radarRef.value?._ro) radarRef.value._ro.disconnect()
  gaugeChart?.dispose()
  radarChart?.dispose()
  gaugeChart = null
  radarChart = null
})

onActivated(() => {
  nextTick(() => {
    gaugeChart?.resize()
    radarChart?.resize()
  })
})
</script>

<style scoped>
.score-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.no-data {
  text-align: center;
  padding: 40px 0;
  color: var(--text-muted);
}

.score-row {
  display: flex;
  align-items: center;
}

.gauge-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.gauge-chart {
  width: 160px;
  height: 140px;
}

.score-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}

.suggestion {
  font-size: 16px;
  font-weight: 700;
}

.confidence {
  font-size: 12px;
  color: #ffd60a;
}

.confidence-label {
  color: var(--text-muted);
  font-size: 11px;
}

.radar-chart {
  flex: 1;
  width: 100%;
  height: 220px;
}

.dimension-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dim-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dim-label {
  font-size: 13px;
  color: var(--text-secondary);
  width: 50px;
  flex-shrink: 0;
}

.dim-bar-track {
  flex: 1;
  height: 8px;
  background: var(--bg-surface-alt);
  border-radius: 4px;
  overflow: hidden;
}

.dim-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.dim-score {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  width: 40px;
  text-align: right;
}

.details-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.details-cols {
  display: flex;
  gap: 12px;
}

.detail-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  border: 1px solid var(--border);
}

.col-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 2px;
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
}

.detail-name {
  color: var(--text-secondary);
  width: 60px;
  flex-shrink: 0;
}

.detail-score {
  color: var(--text-primary);
  font-weight: 600;
  width: 36px;
  flex-shrink: 0;
}

.verdict-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
}

.verdict-good {
  background: var(--green-dim);
  color: var(--green);
}

.verdict-neutral {
  background: rgba(255, 214, 10, 0.12);
  color: var(--yellow);
}

.verdict-bad {
  background: var(--red-dim);
  color: var(--red);
}

@media (max-width: 768px) {
  .score-row {
    flex-wrap: wrap;
    justify-content: center;
  }

  .gauge-chart {
    width: 130px;
    height: 120px;
  }

  .radar-chart {
    width: 150px;
    height: 150px;
  }

  .details-cols {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .score-row {
    flex-direction: column;
    align-items: stretch;
  }

  .gauge-wrap {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }

  .gauge-chart {
    width: 110px;
    height: 100px;
  }

  .radar-chart {
    width: 100%;
    height: 160px;
  }

  .dimension-bars {
    width: 100%;
  }

  .dim-label {
    width: 40px;
  }

  .dim-score {
    width: 36px;
    font-size: 12px;
  }
}
</style>
