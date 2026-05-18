<template>
  <div class="screener page">
    <h1 class="page-title">选股筛选</h1>
    <p class="page-desc">四层漏斗式选股，生成东方财富可用筛选条件</p>

    <!-- Layer 1: Mine sweeper -->
    <section class="layer-card">
      <div class="layer-header" @click="toggleLayer(1)">
        <div class="layer-num">1</div>
        <div class="layer-info">
          <h3>排雷清单</h3>
          <span class="layer-sub">已勾选 {{ minesChecked }}/{{ mines.length }}（至少5项）</span>
        </div>
        <span class="layer-toggle">{{ openLayer === 1 ? '▾' : '▸' }}</span>
      </div>
      <div v-if="openLayer === 1" class="layer-body">
        <div class="mine-grid">
          <label v-for="m in mines" :key="m.id" class="mine-item" :class="{ checked: m.checked }">
            <input type="checkbox" v-model="m.checked" />
            <span class="mine-check">{{ m.checked ? '✓' : '' }}</span>
            <span class="mine-label">{{ m.label }}</span>
            <span class="mine-badge" :class="m.auto ? 'auto' : 'manual'">{{ m.auto ? '自动' : 'F10' }}</span>
          </label>
        </div>
      </div>
    </section>

    <!-- Layer 2: Fundamentals -->
    <section class="layer-card">
      <div class="layer-header" @click="toggleLayer(2)">
        <div class="layer-num">2</div>
        <div class="layer-info">
          <h3>基本面筛选</h3>
          <span class="layer-sub">7 项核心指标</span>
        </div>
        <span class="layer-toggle">{{ openLayer === 2 ? '▾' : '▸' }}</span>
      </div>
      <div v-if="openLayer === 2" class="layer-body">
        <div class="fund-grid">
          <div v-for="f in fundFields" :key="f.key" class="fund-field">
            <label class="fund-label">{{ f.label }}</label>
            <div class="fund-input-row">
              <select v-if="f.type === 'bool'" v-model="fundamentals[f.key]">
                <option :value="true">正值</option>
                <option :value="false">不限</option>
              </select>
              <template v-else>
                <input type="number" v-model.number="fundamentals[f.key]" :placeholder="f.hint" />
                <span class="fund-unit">{{ f.unit }}</span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Layer 3: Prosperity -->
    <section class="layer-card">
      <div class="layer-header" @click="toggleLayer(3)">
        <div class="layer-num">3</div>
        <div class="layer-info">
          <h3>景气度验证</h3>
          <span class="layer-sub">3 选 1（可选）</span>
        </div>
        <span class="layer-toggle">{{ openLayer === 3 ? '▾' : '▸' }}</span>
      </div>
      <div v-if="openLayer === 3" class="layer-body">
        <div class="option-cards">
          <div
            v-for="opt in prosperityOptions"
            :key="opt.key"
            class="option-card"
            :class="{ active: selectedProsperity === opt.key }"
            @click="selectedProsperity = selectedProsperity === opt.key ? null : opt.key"
          >
            <div class="option-card__radio">
              <span v-if="selectedProsperity === opt.key" class="radio-dot"></span>
            </div>
            <div>
              <div class="option-card__name">{{ opt.label }}</div>
              <div class="option-card__desc">{{ opt.desc }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Layer 4: Tech Signal -->
    <section class="layer-card">
      <div class="layer-header" @click="toggleLayer(4)">
        <div class="layer-num">4</div>
        <div class="layer-info">
          <h3>技术信号</h3>
          <span class="layer-sub">3 选 1（可选）</span>
        </div>
        <span class="layer-toggle">{{ openLayer === 4 ? '▾' : '▸' }}</span>
      </div>
      <div v-if="openLayer === 4" class="layer-body">
        <div class="option-cards">
          <div
            v-for="opt in techOptions"
            :key="opt.key"
            class="option-card"
            :class="{ active: selectedTech === opt.key }"
            @click="selectedTech = selectedTech === opt.key ? null : opt.key"
          >
            <div class="option-card__radio">
              <span v-if="selectedTech === opt.key" class="radio-dot"></span>
            </div>
            <div>
              <div class="option-card__name">{{ opt.label }}</div>
              <div class="option-card__desc">{{ opt.desc }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Output -->
    <section class="output-section" v-if="canGenerate">
      <h2 class="section-title">筛选条件输出</h2>

      <!-- Mobile: 一句话选股 -->
      <div class="output-block">
        <div class="output-header">
          <span class="output-type">手机端 · 一句话选股</span>
          <div class="output-actions">
            <button class="btn btn-sm btn-primary" @click="queryXuangu" :disabled="queryLoading">
              {{ queryLoading ? '查询中...' : '查询' }}
            </button>
            <button class="btn btn-sm btn-ghost" @click="copy(mobileStatement)">复制</button>
          </div>
        </div>
        <pre class="output-code">{{ mobileStatement }}</pre>
        <p class="output-hint">粘贴到东方财富 App「一句话选股」或 xuangu.eastmoney.com</p>
      </div>

      <!-- Query results -->
      <div v-if="queryLoading" class="query-loading">
        <span class="pulse-dot"></span> 正在查询候选股...
      </div>
      <template v-else-if="queryResults.length">
        <div class="query-info">
          匹配 {{ queryResults.length }} 只 · 点击添加自选并查看详情
        </div>
        <div class="stock-grid">
          <div
            v-for="s in queryResults"
            :key="s.code"
            class="stock-card"
            @click="goToStock(s.code, s.name)"
          >
            <div class="stock-card__header">
              <span class="stock-card__name">{{ s.name }}</span>
              <span class="stock-card__code">{{ s.code }}</span>
            </div>
            <div class="stock-card__price">
              <span class="stock-card__val">{{ s.price?.toFixed(2) }}</span>
              <span class="stock-card__chg" :class="s.chgAmt >= 0 ? 'up' : 'down'">
                {{ s.chgAmt >= 0 ? '+' : '' }}{{ s.chgAmt?.toFixed(2) }}%
              </span>
            </div>
            <div class="stock-card__meta">
              <span>PE {{ s.pe?.toFixed(1) }}</span>
              <span>PB {{ s.pb?.toFixed(2) }}</span>
              <span>换手 {{ s.turnover?.toFixed(1) }}%</span>
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost query-refresh" @click="queryXuangu">刷新结果</button>
      </template>
      <div v-else-if="queryFetched && !queryResults.length" class="query-empty">
        <span>暂无匹配结果</span>
        <button class="btn btn-sm btn-ghost" @click="queryXuangu">重新查询</button>
      </div>

      <!-- Manual conditions -->
      <div v-if="manualConditions.length" class="output-block">
        <div class="output-header">
          <span class="output-type output-type--warn">需 PC 端 / 手动设置</span>
        </div>
        <div class="manual-list">
          <div v-for="(c, i) in manualConditions" :key="i" class="manual-item">
            <span class="manual-num">{{ i + 1 }}</span>
            <div>
              <span class="manual-label">{{ c.label }}</span>
              <span class="manual-where">{{ c.where }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- PC formula -->
      <div class="output-block">
        <div class="output-header">
          <span class="output-type">PC 端公式代码</span>
          <button class="btn btn-sm btn-ghost" @click="copy(pcFormula)">复制</button>
        </div>
        <pre class="output-code">{{ pcFormula }}</pre>
      </div>

      <!-- F10 reminders -->
      <div v-if="f10Reminders.length" class="f10-section">
        <h3 class="f10-title">仍需 F10 手动复核</h3>
        <div class="f10-list">
          <div v-for="r in f10Reminders" :key="r.id" class="f10-item">
            <span class="f10-icon">!</span>
            <span>{{ r.label }} — {{ r.desc }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { MINE_SWEEPER_ITEMS, FUNDAMENTAL_DEFAULTS, PROSPERITY_OPTIONS, TECH_SIGNAL_OPTIONS } from '../utils/constants.js'
import { buildScreenerPrompt } from '../utils/screenerPrompt.js'
import { useWatchlistStore } from '../stores/watchlist.js'

const router = useRouter()
const watchlistStore = useWatchlistStore()

const openLayer = ref(1)
const mines = reactive(MINE_SWEEPER_ITEMS.map(m => ({ ...m, checked: m.auto })))
const fundamentals = reactive({ ...FUNDAMENTAL_DEFAULTS })
const selectedProsperity = ref(null)
const selectedTech = ref(null)

const prosperityOptions = PROSPERITY_OPTIONS
const techOptions = TECH_SIGNAL_OPTIONS

const fundFields = [
  { key: 'roe', label: 'ROE', unit: '%', hint: '12' },
  { key: 'revenueGrowth', label: '营收增速', unit: '%', hint: '10' },
  { key: 'profitGrowth', label: '利润增速', unit: '%', hint: '10' },
  { key: 'debtRatio', label: '资产负债率 ≤', unit: '%', hint: '60' },
  { key: 'cashflowPositive', label: '经营现金流', type: 'bool' },
  { key: 'peMin', label: 'PE 下限', unit: '', hint: '5' },
  { key: 'peMax', label: 'PE 上限', unit: '', hint: '40' }
]

const minesChecked = computed(() => mines.filter(m => m.checked).length)
const canGenerate = computed(() => minesChecked.value >= 5)

const promptResult = computed(() => {
  if (!canGenerate.value) return { mobileStatement: '', manualConditions: [], pcFormula: '' }
  return buildScreenerPrompt({
    mines,
    fundamentals: { ...fundamentals },
    prosperity: selectedProsperity.value,
    tech: selectedTech.value,
  })
})

const mobileStatement = computed(() => promptResult.value.mobileStatement)
const manualConditions = computed(() => promptResult.value.manualConditions)
const pcFormula = computed(() => promptResult.value.pcFormula)

const f10Reminders = computed(() => {
  return mines.filter(m => !m.auto && m.checked)
})

const queryResults = ref([])
const queryLoading = ref(false)
const queryFetched = ref(false)

async function queryXuangu() {
  if (!mobileStatement.value) return
  queryLoading.value = true
  queryFetched.value = false
  try {
    const res = await fetch('/api/stock/xuangu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: mobileStatement.value })
    })
    const json = await res.json()
    if (json.ok) {
      queryResults.value = json.data.stocks || []
    } else {
      queryResults.value = []
    }
    queryFetched.value = true
  } catch (e) {
    console.error('queryXuangu error:', e)
  } finally {
    queryLoading.value = false
  }
}

function goToStock(code, name) {
  watchlistStore.addStock(code, name)
  router.push({ path: '/watchlist', query: { code, name } })
}

function toggleLayer(n) {
  openLayer.value = openLayer.value === n ? 0 : n
}

function copy(text) {
  navigator.clipboard.writeText(text)
}
</script>

<style scoped>
.screener {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.page-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: -8px;
}

.layer-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.layer-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  cursor: pointer;
  transition: background 0.15s;
}

.layer-header:hover {
  background: rgba(255, 255, 255, 0.02);
}

.layer-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-dim);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.layer-info {
  flex: 1;
}

.layer-info h3 {
  font-size: 14px;
  font-weight: 600;
}

.layer-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.layer-toggle {
  color: var(--text-muted);
  font-size: 14px;
}

.layer-body {
  padding: 0 20px 20px;
  border-top: 1px solid var(--border);
}

.mine-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding-top: 16px;
}

.mine-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: 1px solid var(--border);
  transition: all 0.15s;
  user-select: none;
}

.mine-item:hover {
  background: rgba(255, 255, 255, 0.02);
}

.mine-item.checked {
  border-color: rgba(0, 113, 227, 0.3);
  background: var(--accent-dim);
}

.mine-item input {
  display: none;
}

.mine-check {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1.5px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
  flex-shrink: 0;
}

.checked .mine-check {
  background: var(--accent);
  border-color: var(--accent);
}

.mine-label {
  font-size: 13px;
  flex: 1;
}

.mine-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}

.mine-badge.auto {
  background: var(--green-dim);
  color: var(--green);
}

.mine-badge.manual {
  background: var(--yellow-dim);
  color: var(--yellow);
}

.fund-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding-top: 16px;
}

.fund-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fund-label {
  font-size: 12px;
  color: var(--text-muted);
}

.fund-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fund-input-row input,
.fund-input-row select {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
}

.fund-unit {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 16px;
}

.option-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 16px;
}

.option-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
}

.option-card:hover {
  background: rgba(255, 255, 255, 0.02);
}

.option-card.active {
  border-color: rgba(0, 113, 227, 0.3);
  background: var(--accent-dim);
}

.option-card__radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.active .option-card__radio {
  border-color: var(--accent);
}

.radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.option-card__name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 2px;
}

.option-card__desc {
  font-size: 12px;
  color: var(--text-muted);
}

.output-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 24px;
}

.output-block {
  margin-bottom: 16px;
}

.output-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.output-type {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.output-code {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-mono);
  max-height: 200px;
  overflow-y: auto;
}

.output-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
}

.output-type--warn {
  color: var(--yellow);
}

.manual-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manual-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.manual-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--yellow-dim, rgba(255, 170, 0, 0.12));
  color: var(--yellow, #faa);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.manual-label {
  font-size: 13px;
  font-weight: 600;
  display: block;
}

.manual-where {
  font-size: 11px;
  color: var(--text-muted);
  display: block;
  margin-top: 2px;
}

.f10-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.f10-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--yellow);
  margin-bottom: 8px;
}

.f10-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.f10-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.f10-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--yellow-dim);
  color: var(--yellow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .mine-grid {
    grid-template-columns: 1fr;
  }

  .fund-grid {
    grid-template-columns: 1fr;
  }

  .stock-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.output-actions {
  display: flex;
  gap: 6px;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.query-loading,
.query-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.query-info {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.pulse-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

.stock-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.stock-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.15s;
}

.stock-card:hover {
  border-color: rgba(0, 113, 227, 0.3);
  background: rgba(0, 113, 227, 0.04);
  transform: translateY(-1px);
}

.stock-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.stock-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.stock-card__code {
  font-size: 10px;
  color: var(--text-muted);
}

.stock-card__price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.stock-card__val {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.stock-card__chg {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stock-card__chg.up { color: var(--red); }
.stock-card__chg.down { color: var(--green); }

.stock-card__meta {
  display: flex;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.stock-card__meta span {
  background: var(--bg-surface-alt, rgba(255, 255, 255, 0.03));
  padding: 1px 5px;
  border-radius: 3px;
}

.query-refresh {
  margin-top: 4px;
}
</style>
