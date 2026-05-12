<template>
  <canvas ref="canvasRef" :style="canvasStyle"></canvas>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  positive: { type: Boolean, default: true },
  width: { type: Number, default: 52 },
  height: { type: Number, default: 24 },
  showArea: { type: Boolean, default: false },
  refPrice: { type: Number, default: null },
  autoWidth: { type: Boolean, default: false },
  totalSlots: { type: Number, default: 0 }
})

const canvasRef = ref(null)
let resizeObs = null

const canvasStyle = computed(() => ({
  width: props.autoWidth ? '100%' : props.width + 'px',
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

  const prices = props.data.map(d => d.close ?? d)
  if (prices.length < 2) return

  const slots = props.totalSlots > prices.length ? props.totalSlots : prices.length
  const dataMin = Math.min(...prices)
  const dataMax = Math.max(...prices)
  let min = dataMin
  let max = dataMax
  if (props.refPrice != null) {
    min = Math.min(min, props.refPrice)
    max = Math.max(max, props.refPrice)
  }
  const range = max - min || 1
  const padY = props.showArea ? h * 0.15 : h * 0.1
  const drawH = h - padY * 2

  const color = props.positive ? '#ff453a' : '#30d158'

  const points = prices.map((p, i) => ({
    x: (i / (slots - 1)) * w,
    y: padY + drawH - ((p - min) / range) * drawH
  }))

  // 参考线
  if (props.refPrice != null) {
    const refY = padY + drawH - ((props.refPrice - min) / range) * drawH
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(0, refY)
    ctx.lineTo(w, refY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 面积填充
  if (props.showArea) {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, color + '40')
    grad.addColorStop(1, color + '00')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(points[0].x, h)
    points.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[points.length - 1].x, h)
    ctx.closePath()
    ctx.fill()
  }

  // 线条
  ctx.strokeStyle = color
  ctx.lineWidth = props.showArea ? 1.5 : 1
  ctx.lineJoin = 'round'
  ctx.beginPath()
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.stroke()

  // 高低价标注 (showArea 模式)
  if (props.showArea && prices.length > 10) {
    const maxIdx = prices.indexOf(dataMax)
    const minIdx = prices.indexOf(dataMin)
    ctx.font = '10px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.textAlign = maxIdx / prices.length > 0.8 ? 'right' : 'left'
    ctx.fillText(max.toFixed(2), points[maxIdx].x + (maxIdx / prices.length > 0.8 ? -3 : 3), points[maxIdx].y - 3)
    ctx.textAlign = minIdx / prices.length > 0.8 ? 'right' : 'left'
    ctx.fillText(min.toFixed(2), points[minIdx].x + (minIdx / prices.length > 0.8 ? -3 : 3), points[minIdx].y + 12)
  }
}

onMounted(() => {
  if (props.autoWidth && canvasRef.value) {
    resizeObs = new ResizeObserver(() => draw())
    resizeObs.observe(canvasRef.value.parentElement || canvasRef.value)
  }
  draw()
})

watch(() => [props.data, props.positive, props.width, props.height, props.refPrice, props.totalSlots], draw, { deep: true })

onBeforeUnmount(() => {
  if (resizeObs) resizeObs.disconnect()
})
</script>
