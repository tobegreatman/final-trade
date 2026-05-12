<template>
  <div class="position page">
    <h1 class="page-title">仓位计算</h1>

    <div class="position-grid">
      <!-- Left: Calculator -->
      <div class="calc-panel card">
        <h2 class="section-title">ATR 动态仓位计算器</h2>

        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">股票代码</label>
            <div class="form-input-with-btn">
              <input v-model="form.code" type="text" placeholder="如 000001" />
              <button class="btn btn-primary btn-sm" @click="fetchATR" :disabled="atrLoading">
                {{ atrLoading ? '获取中...' : '获取 ATR' }}
              </button>
            </div>
          </div>

          <div class="form-row">
            <label class="form-label">策略</label>
            <select v-model="form.strategy">
              <option value="trend">趋势突破 (N=1.5)</option>
              <option value="pullback">回调买入 (N=2.0)</option>
              <option value="bottom">底部右侧确认 (N=3.0)</option>
            </select>
          </div>

          <div class="form-row">
            <label class="form-label">买入价</label>
            <input v-model.number="form.buyPrice" type="number" placeholder="0.00" step="0.01" />
          </div>

          <div class="form-row">
            <label class="form-label">目标价</label>
            <input v-model.number="form.targetPrice" type="number" placeholder="0.00" step="0.01" />
          </div>

          <div class="form-row">
            <label class="form-label">总资金 (万元)</label>
            <input :value="capitalWan" @input="onCapitalChange" type="number" step="1" />
          </div>
        </div>

        <!-- ATR info -->
        <div v-if="form.atr" class="atr-info">
          ATR(14) = <strong>{{ form.atr.toFixed(3) }}</strong>
        </div>

        <!-- Results -->
        <div v-if="results" class="results">
          <div class="result-grid">
            <div class="result-item">
              <span class="result-label">止损价</span>
              <span class="result-value stop">{{ results.stopPrice.toFixed(2) }}</span>
            </div>
            <div class="result-item">
              <span class="result-label">止损幅度</span>
              <span class="result-value">{{ results.stopPct.toFixed(1) }}%</span>
            </div>
            <div class="result-item">
              <span class="result-label">建议仓位</span>
              <span class="result-value accent">{{ results.posAmount.toFixed(0) }}元</span>
            </div>
            <div class="result-item">
              <span class="result-label">仓位占比</span>
              <span class="result-value">{{ results.posPct.toFixed(1) }}%</span>
            </div>
            <div class="result-item">
              <span class="result-label">股数</span>
              <span class="result-value">{{ results.shares }} 股</span>
            </div>
            <div class="result-item">
              <span class="result-label">盈亏比</span>
              <span class="result-value" :class="results.rr >= 2 ? 'good' : 'bad'">
                {{ results.rr.toFixed(2) }}:1
              </span>
            </div>
            <div class="result-item">
              <span class="result-label">跟踪止盈初始价</span>
              <span class="result-value target">{{ results.trailStop.toFixed(2) }}</span>
            </div>
          </div>

          <!-- Visual bar -->
          <div class="visual-bar">
            <div class="bar-track">
              <div class="bar-fill bar-stop" :style="{ width: stopBarPct + '%' }">
                <span class="bar-label">止损 {{ results.stopPrice.toFixed(2) }}</span>
              </div>
              <div class="bar-marker buy">
                <span>买 {{ form.buyPrice }}</span>
              </div>
              <div class="bar-fill bar-target" :style="{ width: targetBarPct + '%' }">
                <span class="bar-label">目标 {{ form.targetPrice }}</span>
              </div>
            </div>
          </div>

          <div class="rr-warning" v-if="results.rr < 2">
            盈亏比低于 2:1，建议谨慎入场或等待更好的入场点
          </div>

          <button class="btn btn-primary" @click="addToHoldings" style="margin-top: 12px; width: 100%;">
            添加到持仓
          </button>
        </div>
      </div>

      <!-- Right: Holdings + Concentration -->
      <div class="right-panel">
        <!-- Strategy reference -->
        <div class="card" style="margin-bottom: 16px;">
          <h2 class="section-title">策略参数参考</h2>
          <table>
            <thead>
              <tr>
                <th>策略</th>
                <th>ATR乘数N</th>
                <th>跟踪止盈M</th>
                <th>仓位上限</th>
                <th>持有期</th>
                <th>时间止损</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(p, key) in strategyParams" :key="key">
                <td>{{ p.name }}</td>
                <td>{{ p.atrN }}</td>
                <td>{{ p.trailAtrN }}×ATR</td>
                <td>{{ (p.maxPosition * 100).toFixed(0) }}%</td>
                <td>{{ p.holdPeriod }}</td>
                <td style="font-size: 12px;">{{ p.timeStop }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Industry concentration -->
        <div class="card" style="margin-bottom: 16px;">
          <h2 class="section-title">行业集中度</h2>
          <div v-if="!positionStore.industryConcentration.length" class="empty-hint">暂无持仓数据</div>
          <div v-else class="concentration-bars">
            <div v-for="ind in positionStore.industryConcentration" :key="ind.name" class="conc-bar">
              <div class="conc-bar__header">
                <span class="conc-bar__name">{{ ind.name }}</span>
                <span class="conc-bar__pct" :class="{ warn: +ind.pct > 30 }">{{ ind.pct }}%</span>
              </div>
              <div class="conc-bar__track">
                <div
                  class="conc-bar__fill"
                  :class="{ warn: +ind.pct > 30 }"
                  :style="{ width: Math.min(+ind.pct, 100) + '%' }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Holdings table -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 class="section-title" style="margin-bottom: 0;">持仓管理</h2>
            <span class="text-muted">总资金: {{ capitalWan }} 万</span>
          </div>
          <div v-if="!positionStore.holdings.length" class="empty-hint">暂无持仓</div>
          <table v-else>
            <thead>
              <tr>
                <th>代码</th>
                <th>行业</th>
                <th>买价</th>
                <th>止损</th>
                <th>跟踪止盈</th>
                <th>仓位</th>
                <th>策略</th>
                <th>日期</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in positionStore.holdings" :key="h.id">
                <td style="font-family: var(--font-mono);">{{ h.code }}</td>
                <td>{{ h.industry }}</td>
                <td>{{ h.buyPrice.toFixed(2) }}</td>
                <td class="stop-text">{{ h.stopPrice.toFixed(2) }}</td>
                <td class="target-text">{{ h.trailingStop.toFixed(2) }}</td>
                <td>{{ h.position.toFixed(0) }}</td>
                <td>{{ h.strategyName }}</td>
                <td>{{ h.date }}</td>
                <td>
                  <button class="btn btn-sm btn-danger" @click="positionStore.removeHolding(h.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { usePositionStore } from '../stores/position.js'
import { useRoute } from 'vue-router'
import { STRATEGY_PARAMS } from '../utils/constants.js'
import { calcATR, calcStopLoss, calcPosition, calcRiskReward, calcTrailingStop } from '../utils/position.js'

const positionStore = usePositionStore()
const route = useRoute()
const strategyParams = STRATEGY_PARAMS

const atrLoading = ref(false)

const form = reactive({
  code: '',
  strategy: 'pullback',
  buyPrice: null,
  targetPrice: null,
  atr: null
})

const capitalWan = computed(() => (positionStore.totalCapital / 10000).toFixed(0))

const results = computed(() => {
  if (!form.buyPrice || !form.atr || !form.targetPrice) return null
  const stopPrice = calcStopLoss(form.buyPrice, form.atr, form.strategy)
  const pos = calcPosition(positionStore.totalCapital, form.buyPrice, stopPrice, form.strategy)
  const rr = calcRiskReward(form.buyPrice, stopPrice, form.targetPrice)
  const trailStop = calcTrailingStop(form.buyPrice, form.atr, form.strategy)
  const stopPct = ((form.buyPrice - stopPrice) / form.buyPrice) * 100
  return { stopPrice, posPct: pos.pct, posAmount: pos.amount, shares: pos.shares, rr, trailStop, stopPct }
})

const stopBarPct = computed(() => {
  if (!form.buyPrice || !results.value) return 0
  const range = form.targetPrice - results.value.stopPrice
  return range > 0 ? ((form.buyPrice - results.value.stopPrice) / range * 50) : 0
})

const targetBarPct = computed(() => {
  if (!form.buyPrice || !form.targetPrice || !results.value) return 0
  const range = form.targetPrice - results.value.stopPrice
  return range > 0 ? ((form.targetPrice - form.buyPrice) / range * 50) : 0
})

async function fetchATR() {
  if (!form.code) return
  atrLoading.value = true
  try {
    const res = await fetch(`/api/stock/${form.code}/kline`)
    const json = await res.json()
    if (json.ok && json.data.klines?.length >= 15) {
      form.atr = calcATR(json.data.klines)
    }
  } catch (e) {
    console.error('fetchATR error:', e)
  }
  atrLoading.value = false
}

function onCapitalChange(e) {
  positionStore.setCapital(Number(e.target.value) * 10000)
}

function addToHoldings() {
  if (!results.value || !form.code) return
  const p = STRATEGY_PARAMS[form.strategy]
  positionStore.addHolding({
    code: form.code,
    buyPrice: form.buyPrice,
    stopPrice: results.value.stopPrice,
    trailingStop: results.value.trailStop,
    position: results.value.posAmount,
    strategy: form.strategy,
    strategyName: p.name,
    industry: '',
    date: new Date().toISOString().slice(0, 10)
  })
}

onMounted(() => {
  if (route.query.code) {
    form.code = route.query.code
    fetchATR()
  }
})
</script>

<style scoped>
.page-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 20px;
}

.position-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.form-input-with-btn {
  display: flex;
  gap: 8px;
}

.form-input-with-btn input {
  flex: 1;
}

.atr-info {
  padding: 10px 14px;
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--radius-sm);
  font-size: 13px;
  margin-top: 8px;
}

.results {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.result-item {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.result-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.result-value {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.result-value.stop { color: var(--red); }
.result-value.target { color: var(--green); }
.result-value.accent { color: var(--accent); }
.result-value.good { color: var(--green); }
.result-value.bad { color: var(--red); }

.visual-bar {
  margin: 16px 0;
}

.bar-track {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  overflow: hidden;
  position: relative;
}

.bar-fill {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.bar-stop {
  background: var(--red-dim);
  color: var(--red);
}

.bar-target {
  background: var(--green-dim);
  color: var(--green);
}

.bar-marker {
  position: relative;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 0 4px;
}

.rr-warning {
  background: var(--red-dim);
  color: var(--red);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.text-muted {
  font-size: 12px;
  color: var(--text-muted);
}

.empty-hint {
  text-align: center;
  padding: 20px;
  color: var(--text-muted);
  font-size: 13px;
}

.concentration-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.conc-bar__header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.conc-bar__name {
  font-size: 13px;
}

.conc-bar__pct {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.conc-bar__pct.warn {
  color: var(--red);
}

.conc-bar__track {
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
}

.conc-bar__fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.3s;
}

.conc-bar__fill.warn {
  background: var(--red);
}

.stop-text { color: var(--green); }
.target-text { color: var(--red); }

@media (max-width: 768px) {
  .position-grid {
    grid-template-columns: 1fr;
  }

  .result-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
