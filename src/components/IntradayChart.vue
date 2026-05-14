<template>
  <canvas ref="canvasRef" :style="canvasStyle"></canvas>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  positive: { type: Boolean, default: true },
  height: { type: Number, default: 280 },
  autoWidth: { type: Boolean, default: false },
  refPrice: { type: Number, default: null },
  totalSlots: { type: Number, default: 0 }
})

const canvasRef = ref(null)
let resizeObs = null

const canvasStyle = computed(() => ({
  width: props.autoWidth ? '100%' : '400px',
  height: props.height + 'px',
  display: 'block'
}))

function draw() {
  const canvas = canvasRef.value
  if (!canvas || !props.data.length) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  canvas.width = w * dpr
  canvas.height = h * dpr

  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const trends = props.data
  const volRatio = 0.22
  const pad = { top: 12, bottom: 2, left: 0, right: 0 }
  const volH = h * volRatio
  const priceH = h - volH - pad.top - pad.bottom
  const gap = 4

  const prices = trends.map(d => d.close)
  const volumes = trends.map(d => d.volume || 0)

  const dataMin = Math.min(...prices)
  const dataMax = Math.max(...prices)
  let min = dataMin, max = dataMax
  if (props.refPrice != null) {
    min = Math.min(min, props.refPrice)
    max = Math.max(max, props.refPrice)
  }
  const range = max - min || 1
  const padY = priceH * 0.08
  const drawH = priceH - padY * 2

  const slots = props.totalSlots > trends.length ? props.totalSlots : trends.length
  const xOf = (i) => (i / (slots - 1)) * w
  const yOf = (price) => pad.top + padY + drawH - ((price - min) / range) * drawH

  const color = props.positive ? '#ff453a' : '#30d158'
  const colorDim = props.positive ? 'rgba(255,69,58,' : 'rgba(48,209,88,'

  // --- Volume bars ---
  // 用 90 分位数做 scale，避免开盘集合竞价巨量把其他柱子压没
  const posVols = volumes.filter(v => v > 0).sort((a, b) => a - b)
  const maxVol = posVols.length ? posVols[Math.floor(posVols.length * 0.92)] || 1 : 1
  const volTop = h - volH
  const barW = Math.max(1, w / slots * 0.65)
  for (let i = 0; i < trends.length; i++) {
    const v = volumes[i]
    if (!v) continue
    const bh = Math.min((v / maxVol) * (volH - gap), volH - gap)
    const x = xOf(i) - barW / 2
    const up = i === 0 ? props.positive : prices[i] >= prices[i - 1]
    ctx.fillStyle = up ? 'rgba(255,69,58,0.3)' : 'rgba(48,209,88,0.3)'
    ctx.fillRect(x, volTop + volH - bh, barW, bh)
  }

  // --- Volume separator ---
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(0, volTop)
  ctx.lineTo(w, volTop)
  ctx.stroke()

  // --- Ref price line ---
  if (props.refPrice != null) {
    const refY = yOf(props.refPrice)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(0, refY)
    ctx.lineTo(w, refY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // --- Area fill ---
  const pricePoints = prices.map((p, i) => ({ x: xOf(i), y: yOf(p) }))
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + priceH)
  grad.addColorStop(0, colorDim + '0.25)')
  grad.addColorStop(1, colorDim + '0.0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(pricePoints[0].x, pad.top + priceH)
  pricePoints.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(pricePoints[pricePoints.length - 1].x, pad.top + priceH)
  ctx.closePath()
  ctx.fill()

  // --- Price line ---
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pricePoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.stroke()

  // --- High/low labels ---
  if (prices.length > 10) {
    const maxIdx = prices.indexOf(dataMax)
    const minIdx = prices.indexOf(dataMin)
    ctx.font = '10px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.textAlign = maxIdx / prices.length > 0.8 ? 'right' : 'left'
    ctx.fillText(dataMax.toFixed(2), pricePoints[maxIdx].x + (maxIdx / prices.length > 0.8 ? -3 : 3), pricePoints[maxIdx].y - 3)
    ctx.textAlign = minIdx / prices.length > 0.8 ? 'right' : 'left'
    ctx.fillText(dataMin.toFixed(2), pricePoints[minIdx].x + (minIdx / prices.length > 0.8 ? -3 : 3), pricePoints[minIdx].y + 12)
  }
}

onMounted(() => {
  if (props.autoWidth && canvasRef.value) {
    resizeObs = new ResizeObserver(() => draw())
    resizeObs.observe(canvasRef.value.parentElement || canvasRef.value)
  }
  draw()
})

watch(() => [props.data, props.positive, props.height, props.refPrice, props.totalSlots], draw, { deep: true })

onBeforeUnmount(() => {
  if (resizeObs) resizeObs.disconnect()
})
</script>
