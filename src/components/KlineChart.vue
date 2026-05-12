<template>
  <canvas ref="canvasRef" :style="canvasStyle"></canvas>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  height: { type: Number, default: 280 },
  autoWidth: { type: Boolean, default: false },
  showVolume: { type: Boolean, default: true }
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

  const klines = props.data
  const volH = props.showVolume ? h * 0.2 : 0
  const pad = { top: 10, bottom: 10, left: 0, right: 0 }
  const chartH = h - volH - pad.top - pad.bottom
  const candleCount = klines.length
  const candleW = Math.max(1, (w - pad.left - pad.right) / candleCount)
  const bodyW = Math.max(1, candleW * 0.7)
  const gap = (candleW - bodyW) / 2

  // price range
  let minP = Infinity, maxP = -Infinity, maxVol = 0
  for (const k of klines) {
    if (k.low < minP) minP = k.low
    if (k.high > maxP) maxP = k.high
    if (k.volume > maxVol) maxVol = k.volume
  }
  const pRange = maxP - minP || 1

  const yOf = (price) => pad.top + chartH - ((price - minP) / pRange) * chartH

  // volume bars
  if (props.showVolume && maxVol > 0) {
    for (let i = 0; i < candleCount; i++) {
      const k = klines[i]
      const up = k.close >= k.open
      const x = pad.left + i * candleW + gap
      const bh = (k.volume / maxVol) * volH * 0.8
      ctx.fillStyle = up ? 'rgba(255,69,58,0.25)' : 'rgba(48,209,88,0.25)'
      ctx.fillRect(x, h - bh, bodyW, bh)
    }
  }

  // MA5
  if (candleCount >= 5) {
    drawMA(ctx, klines, 5, pad.left, candleW, yOf, '#e2e8f0', 0.5)
  }
  // MA20
  if (candleCount >= 20) {
    drawMA(ctx, klines, 20, pad.left, candleW, yOf, '#f59e0b', 0.5)
  }

  // candles
  for (let i = 0; i < candleCount; i++) {
    const k = klines[i]
    const up = k.close >= k.open
    const color = up ? '#ff453a' : '#30d158'
    const x = pad.left + i * candleW + gap
    const cx = x + bodyW / 2

    // wick
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, yOf(k.high))
    ctx.lineTo(cx, yOf(k.low))
    ctx.stroke()

    // body
    const top = yOf(Math.max(k.open, k.close))
    const bot = yOf(Math.min(k.open, k.close))
    const bodyH = Math.max(1, bot - top)
    ctx.fillStyle = color
    ctx.fillRect(x, top, bodyW, bodyH)
  }
}

function drawMA(ctx, klines, period, offsetX, candleW, yOf, color, lineWidth) {
  const cx = (i) => offsetX + i * candleW + candleW / 2
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  let started = false
  for (let i = period - 1; i < klines.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += klines[j].close
    const ma = sum / period
    if (!started) { ctx.moveTo(cx(i), yOf(ma)); started = true }
    else ctx.lineTo(cx(i), yOf(ma))
  }
  ctx.stroke()
}

onMounted(() => {
  if (props.autoWidth && canvasRef.value) {
    resizeObs = new ResizeObserver(() => draw())
    resizeObs.observe(canvasRef.value.parentElement || canvasRef.value)
  }
  draw()
})

watch(() => [props.data, props.height], draw, { deep: true })

onBeforeUnmount(() => {
  if (resizeObs) resizeObs.disconnect()
})
</script>
