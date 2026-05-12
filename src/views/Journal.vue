<template>
  <div class="journal page">
    <h1 class="page-title">交易日志</h1>

    <!-- Tabs -->
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <!-- Tab 1: Trade Records -->
    <template v-if="activeTab === 'trades'">
      <!-- New trade form -->
      <div class="card" style="margin-bottom: 16px;">
        <div class="form-toggle" @click="showForm = !showForm">
          <span>{{ showForm ? '▾ 收起新增交易' : '▸ 新增交易' }}</span>
        </div>
        <div v-if="showForm" class="trade-form">
          <div class="form-grid-3">
            <div class="form-field">
              <label>股票代码</label>
              <input v-model="trade.code" placeholder="000001" />
            </div>
            <div class="form-field">
              <label>股票名称</label>
              <input v-model="trade.name" placeholder="平安银行" />
            </div>
            <div class="form-field">
              <label>买入价</label>
              <input v-model.number="trade.buyPrice" type="number" step="0.01" />
            </div>
            <div class="form-field">
              <label>数量</label>
              <input v-model.number="trade.quantity" type="number" step="100" />
            </div>
            <div class="form-field">
              <label>策略</label>
              <select v-model="trade.strategy">
                <option value="trend">趋势突破</option>
                <option value="pullback">回调买入</option>
                <option value="bottom">底部右侧确认</option>
              </select>
            </div>
            <div class="form-field">
              <label>市场环境</label>
              <select v-model="trade.marketRegime">
                <option value="bull">牛市</option>
                <option value="bull-lean">偏多</option>
                <option value="neutral">震荡</option>
                <option value="bear-lean">偏空</option>
                <option value="bear">熊市</option>
              </select>
            </div>
            <div class="form-field">
              <label>行业</label>
              <input v-model="trade.industry" placeholder="如 半导体" />
            </div>
            <div class="form-field">
              <label>ATR</label>
              <div class="input-with-btn">
                <input :value="trade.atr?.toFixed(3) || ''" readonly />
                <button class="btn btn-sm btn-ghost" @click="fetchTradeATR">获取</button>
              </div>
            </div>
            <div class="form-field">
              <label>止损价</label>
              <input v-model.number="trade.stopPrice" type="number" step="0.01" />
            </div>
            <div class="form-field">
              <label>目标价</label>
              <input v-model.number="trade.targetPrice" type="number" step="0.01" />
            </div>
          </div>

          <!-- RR preview -->
          <div v-if="rrPreview" class="rr-preview" :class="rrPreview >= 2 ? 'good' : 'bad'">
            盈亏比: {{ rrPreview.toFixed(2) }}:1 {{ rrPreview < 2 ? '⚠ 低于 2:1' : '' }}
          </div>

          <!-- Checklist -->
          <div class="checklist-section">
            <h4 class="checklist-title">交易前检查</h4>
            <div class="mini-checklist">
              <label v-for="(item, i) in PRE_TRADE_CHECKLIST" :key="i" class="mini-check">
                <input type="checkbox" v-model="trade.checklist[i]" />
                <span class="mini-check-box">{{ trade.checklist[i] ? '✓' : '' }}</span>
                <span>{{ item }}</span>
              </label>
            </div>
          </div>

          <button class="btn btn-primary" @click="submitTrade" style="margin-top: 12px;">
            提交交易
          </button>
        </div>
      </div>

      <!-- Open trades -->
      <div class="card" style="margin-bottom: 16px;">
        <h2 class="section-title">持仓中 ({{ journalStore.openTrades.length }})</h2>
        <div v-if="!journalStore.openTrades.length" class="empty-hint">暂无持仓交易</div>
        <table v-else>
          <thead>
            <tr><th>股票</th><th>策略</th><th>买价</th><th>止损</th><th>目标</th><th>数量</th><th>日期</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="t in journalStore.openTrades" :key="t.id">
              <td><strong>{{ t.name }}</strong><br><span class="text-muted">{{ t.code }}</span></td>
              <td>{{ t.strategyName || t.strategy }}</td>
              <td>{{ t.buyPrice.toFixed(2) }}</td>
              <td class="stop-text">{{ t.stopPrice.toFixed(2) }}</td>
              <td class="target-text">{{ t.targetPrice.toFixed(2) }}</td>
              <td>{{ t.quantity }}</td>
              <td>{{ t.date }}</td>
              <td>
                <button class="btn btn-sm btn-primary" @click="openCloseModal(t)">平仓</button>
                <button class="btn btn-sm btn-danger" @click="journalStore.deleteTrade(t.id)" style="margin-left:4px;">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Closed trades -->
      <div class="card">
        <h2 class="section-title">已平仓 ({{ journalStore.closedTrades.length }})</h2>
        <div v-if="!journalStore.closedTrades.length" class="empty-hint">暂无已平仓交易</div>
        <table v-else>
          <thead>
            <tr><th>股票</th><th>策略</th><th>买/卖价</th><th>盈亏</th><th>盈亏比</th><th>原因</th><th>日期</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="t in journalStore.closedTrades" :key="t.id">
              <td><strong>{{ t.name }}</strong></td>
              <td>{{ t.strategyName || t.strategy }}</td>
              <td>{{ t.buyPrice.toFixed(2) }} → {{ t.sellPrice.toFixed(2) }}</td>
              <td :class="t.pnl >= 0 ? 'target-text' : 'stop-text'">
                {{ t.pnl >= 0 ? '+' : '' }}{{ t.pnl.toFixed(0) }} ({{ t.pnlPct >= 0 ? '+' : '' }}{{ t.pnlPct.toFixed(1) }}%)
              </td>
              <td>{{ t.actualRR?.toFixed(2) || '--' }}</td>
              <td>{{ sellReasonLabel(t.sellReason) }}</td>
              <td>{{ t.sellDate }}</td>
              <td>
                <button class="btn btn-sm btn-ghost" @click="expandedReview = expandedReview === t.id ? null : t.id">
                  {{ expandedReview === t.id ? '收起' : '复盘' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <!-- Expanded review -->
        <div v-if="expandedReview" class="review-detail">
          <template v-for="t in journalStore.closedTrades" :key="'r'+t.id">
            <div v-if="t.id === expandedReview" class="review-content">
              <div class="review-grid">
                <div>情绪评分: <strong>{{ t.emotion || '-' }}/5</strong></div>
                <div>执行评分: <strong>{{ t.executionScore || '-' }}/5</strong></div>
                <div>违反铁律: {{ t.violations?.length ? t.violations.map(id => IRON_RULES.find(r => r.id === id)?.rule).join('、') : '无' }}</div>
                <div>问题标签: {{ t.issues?.length ? t.issues.join('、') : '无' }}</div>
              </div>
              <div v-if="t.reviewNotes" class="review-notes">
                <strong>复盘备注:</strong> {{ t.reviewNotes }}
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- Tab 2: Performance -->
    <template v-if="activeTab === 'stats'">
      <div class="stats-cards grid-3" style="margin-bottom: 20px;">
        <div class="stat-card card">
          <div class="stat-card__label">胜率</div>
          <div class="stat-card__value">{{ journalStore.stats.winRate }}%</div>
        </div>
        <div class="stat-card card">
          <div class="stat-card__label">盈亏比</div>
          <div class="stat-card__value">{{ journalStore.stats.rr }}</div>
        </div>
        <div class="stat-card card">
          <div class="stat-card__label">总盈亏</div>
          <div class="stat-card__value" :class="journalStore.stats.totalPnl >= 0 ? 'up' : 'down'">
            {{ journalStore.stats.totalPnl >= 0 ? '+' : '' }}{{ journalStore.stats.totalPnl }}
          </div>
        </div>
        <div class="stat-card card">
          <div class="stat-card__label">平均盈利</div>
          <div class="stat-card__value up">{{ journalStore.stats.avgWin }}%</div>
        </div>
        <div class="stat-card card">
          <div class="stat-card__label">平均亏损</div>
          <div class="stat-card__value down">{{ journalStore.stats.avgLoss }}%</div>
        </div>
        <div class="stat-card card">
          <div class="stat-card__label">交易次数</div>
          <div class="stat-card__value">{{ journalStore.stats.count }}</div>
        </div>
      </div>

      <!-- Monthly curve -->
      <div class="card" style="margin-bottom: 16px;">
        <h2 class="section-title">月度权益曲线</h2>
        <div v-if="!journalStore.monthlyStats.length" class="empty-hint">暂无数据</div>
        <template v-else>
          <Sparkline
            :data="monthlyChartData"
            :positive="journalStore.stats.totalPnl >= 0"
            :show-area="true"
            :height="120"
            :auto-width="true"
          />
          <table style="margin-top: 12px;">
            <thead><tr><th>月份</th><th>盈亏</th><th>交易数</th><th>胜率</th></tr></thead>
            <tbody>
              <tr v-for="m in journalStore.monthlyStats" :key="m.month">
                <td>{{ m.month }}</td>
                <td :class="m.pnl >= 0 ? 'target-text' : 'stop-text'">{{ m.pnl >= 0 ? '+' : '' }}{{ m.pnl.toFixed(0) }}</td>
                <td>{{ m.count }}</td>
                <td>{{ m.count > 0 ? Math.round(m.wins / m.count * 100) : 0 }}%</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- Strategy comparison -->
      <div class="card">
        <h2 class="section-title">策略对比</h2>
        <div v-if="!journalStore.strategyStats.length" class="empty-hint">暂无数据</div>
        <table v-else>
          <thead><tr><th>策略</th><th>交易数</th><th>胜率</th><th>总盈亏</th></tr></thead>
          <tbody>
            <tr v-for="s in journalStore.strategyStats" :key="s.name">
              <td>{{ s.name }}</td>
              <td>{{ s.count }}</td>
              <td>{{ s.winRate }}%</td>
              <td :class="s.pnl >= 0 ? 'target-text' : 'stop-text'">{{ s.pnl }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Tab 3: Review -->
    <template v-if="activeTab === 'review'">
      <!-- Warning banner -->
      <div v-if="journalStore.consecutiveStops >= 5" class="warning-banner">
        ⚠ 连续 {{ journalStore.consecutiveStops }} 次止损！建议暂停交易，复盘检讨。
      </div>

      <!-- Violation stats -->
      <div class="card" style="margin-bottom: 16px;">
        <h2 class="section-title">铁律违反统计</h2>
        <div class="violation-grid">
          <div v-for="rule in IRON_RULES" :key="rule.id" class="violation-item">
            <div class="violation-num">{{ countViolation(rule.id) }}</div>
            <div class="violation-text">
              <div class="violation-rule">{{ rule.rule }}</div>
              <div class="violation-desc">{{ rule.desc }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Issue analysis -->
      <div class="card" style="margin-bottom: 16px;">
        <h2 class="section-title">问题分析</h2>
        <div class="issue-bars">
          <div v-for="tag in ISSUE_TAGS" :key="tag.key" class="issue-bar">
            <div class="issue-bar__header">
              <span>{{ tag.label }}</span>
              <span class="issue-bar__count">{{ countIssue(tag.key) }}</span>
            </div>
            <div class="issue-bar__track">
              <div class="issue-bar__fill" :style="{ width: issuePct(tag.key) + '%' }"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Review records -->
      <div class="card">
        <h2 class="section-title">复盘记录</h2>
        <div v-if="!reviewRecords.length" class="empty-hint">暂无复盘记录</div>
        <div v-for="r in reviewRecords" :key="r.id" class="review-record">
          <div class="review-record__header">
            <strong>{{ r.name }}</strong>
            <span :class="r.pnl >= 0 ? 'target-text' : 'stop-text'">
              {{ r.pnl >= 0 ? '+' : '' }}{{ r.pnl.toFixed(0) }}
            </span>
          </div>
          <div class="review-record__meta">
            {{ r.sellDate }} · {{ sellReasonLabel(r.sellReason) }} · 情绪{{ r.emotion }}/5 · 执行{{ r.executionScore }}/5
          </div>
          <div class="review-record__notes">{{ r.reviewNotes }}</div>
        </div>
      </div>
    </template>

    <!-- Close modal -->
    <div v-if="closeModal" class="modal-overlay" @click.self="closeModal = null">
      <div class="modal-content card">
        <h3 class="modal-title">平仓 — {{ closeModal.name }}</h3>
        <div class="form-grid-3">
          <div class="form-field">
            <label>卖出价</label>
            <input v-model.number="closeForm.sellPrice" type="number" step="0.01" />
          </div>
          <div class="form-field">
            <label>卖出原因</label>
            <select v-model="closeForm.sellReason">
              <option v-for="r in SELL_REASONS" :key="r.key" :value="r.key">{{ r.label }}</option>
            </select>
          </div>
          <div class="form-field">
            <label>情绪评分</label>
            <div class="score-btns">
              <button
                v-for="n in 5" :key="n"
                class="score-btn"
                :class="{ active: closeForm.emotion === n }"
                @click="closeForm.emotion = n"
              >{{ n }}</button>
            </div>
          </div>
          <div class="form-field">
            <label>执行评分</label>
            <div class="score-btns">
              <button
                v-for="n in 5" :key="'e'+n"
                class="score-btn"
                :class="{ active: closeForm.executionScore === n }"
                @click="closeForm.executionScore = n"
              >{{ n }}</button>
            </div>
          </div>
        </div>

        <div class="form-field" style="margin-top: 12px;">
          <label>规则违反</label>
          <div class="violation-checks">
            <label v-for="rule in IRON_RULES" :key="rule.id" class="v-check">
              <input type="checkbox" :value="rule.id" v-model="closeForm.violations" />
              <span>{{ rule.rule }}</span>
            </label>
          </div>
        </div>

        <div class="form-field" style="margin-top: 12px;">
          <label>问题标签</label>
          <div class="issue-checks">
            <label v-for="tag in ISSUE_TAGS" :key="tag.key" class="v-check">
              <input type="checkbox" :value="tag.key" v-model="closeForm.issues" />
              <span>{{ tag.label }}</span>
            </label>
          </div>
        </div>

        <div class="form-field" style="margin-top: 12px;">
          <label>复盘备注</label>
          <textarea v-model="closeForm.reviewNotes" rows="3" placeholder="记录交易心得..."></textarea>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" @click="submitClose">确认平仓</button>
          <button class="btn btn-ghost" @click="closeModal = null">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useJournalStore } from '../stores/journal.js'
import { PRE_TRADE_CHECKLIST, IRON_RULES, SELL_REASONS, ISSUE_TAGS, STRATEGY_PARAMS } from '../utils/constants.js'
import { calcATR, calcStopLoss, calcRiskReward } from '../utils/position.js'
import Sparkline from '../components/Sparkline.vue'

const journalStore = useJournalStore()

const activeTab = ref('trades')
const showForm = ref(false)
const expandedReview = ref(null)
const closeModal = ref(null)

const tabs = [
  { key: 'trades', label: '交易记录' },
  { key: 'stats', label: '绩效统计' },
  { key: 'review', label: '复盘分析' }
]

const trade = reactive({
  code: '', name: '', buyPrice: null, quantity: 100,
  strategy: 'pullback', marketRegime: 'neutral',
  industry: '', atr: null, stopPrice: null, targetPrice: null,
  checklist: new Array(9).fill(false)
})

const closeForm = reactive({
  sellPrice: null, sellReason: 'manual',
  emotion: 3, executionScore: 3,
  violations: [], issues: [], reviewNotes: ''
})

const rrPreview = computed(() => {
  if (!trade.buyPrice || !trade.stopPrice || !trade.targetPrice) return null
  return calcRiskReward(trade.buyPrice, trade.stopPrice, trade.targetPrice)
})

const monthlyChartData = computed(() => {
  return journalStore.monthlyStats.map(m => ({ close: m.pnl }))
})

const reviewRecords = computed(() => {
  return journalStore.closedTrades.filter(t => t.reviewNotes)
})

function sellReasonLabel(key) {
  return SELL_REASONS.find(r => r.key === key)?.label || key
}

async function fetchTradeATR() {
  if (!trade.code) return
  try {
    const res = await fetch(`/api/stock/${trade.code}/kline`)
    const json = await res.json()
    if (json.ok && json.data.klines?.length >= 15) {
      trade.atr = calcATR(json.data.klines)
      trade.stopPrice = calcStopLoss(trade.buyPrice || 0, trade.atr, trade.strategy)
      const params = STRATEGY_PARAMS[trade.strategy]
      trade.targetPrice = trade.buyPrice ? trade.buyPrice + params.atrN * trade.atr * 2 : null
    }
  } catch (e) { console.error(e) }
}

function submitTrade() {
  const params = STRATEGY_PARAMS[trade.strategy]
  journalStore.addTrade({
    code: trade.code,
    name: trade.name,
    buyPrice: trade.buyPrice,
    quantity: trade.quantity,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice,
    atr: trade.atr,
    atrN: params.atrN,
    strategy: trade.strategy,
    strategyName: params.name,
    marketRegime: trade.marketRegime,
    industry: trade.industry,
    date: new Date().toISOString().slice(0, 10),
    checklist: [...trade.checklist]
  })
  // Reset
  Object.assign(trade, {
    code: '', name: '', buyPrice: null, quantity: 100,
    strategy: 'pullback', marketRegime: 'neutral',
    industry: '', atr: null, stopPrice: null, targetPrice: null,
    checklist: new Array(9).fill(false)
  })
  showForm.value = false
}

function openCloseModal(trade) {
  closeModal.value = trade
  closeForm.sellPrice = null
  closeForm.sellReason = 'manual'
  closeForm.emotion = 3
  closeForm.executionScore = 3
  closeForm.violations = []
  closeForm.issues = []
  closeForm.reviewNotes = ''
}

function submitClose() {
  if (!closeModal.value || !closeForm.sellPrice) return
  journalStore.closeTrade(closeModal.value.id, { ...closeForm })
  closeModal.value = null
}

function countViolation(id) {
  return journalStore.closedTrades.reduce((s, t) => s + (t.violations?.includes(id) ? 1 : 0), 0)
}

function countIssue(key) {
  return journalStore.closedTrades.reduce((s, t) => s + (t.issues?.includes(key) ? 1 : 0), 0)
}

function issuePct(key) {
  const total = journalStore.closedTrades.length
  return total > 0 ? (countIssue(key) / total * 100) : 0
}
</script>

<style scoped>
.page-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 20px;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
}

.tab-btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  transition: all 0.15s;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: rgba(0, 113, 227, 0.3);
}

.form-toggle {
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.trade-form {
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-field label {
  font-size: 12px;
  color: var(--text-muted);
}

.input-with-btn {
  display: flex;
  gap: 6px;
}

.input-with-btn input {
  flex: 1;
}

.rr-preview {
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
}

.rr-preview.good {
  background: var(--green-dim);
  color: var(--green);
}

.rr-preview.bad {
  background: var(--red-dim);
  color: var(--red);
}

.checklist-section {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.checklist-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.mini-checklist {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.mini-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.mini-check input {
  display: none;
}

.mini-check-box {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1.5px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #fff;
  flex-shrink: 0;
}

.empty-hint {
  text-align: center;
  padding: 20px;
  color: var(--text-muted);
  font-size: 13px;
}

.text-muted { font-size: 11px; color: var(--text-muted); }
.stop-text { color: var(--green); }
.target-text { color: var(--red); }
.up { color: var(--red); }
.down { color: var(--green); }

.review-detail {
  padding: 16px;
  border-top: 1px solid var(--border);
}

.review-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  font-size: 13px;
  margin-bottom: 8px;
}

.review-notes {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Stats */
.stats-cards {
  gap: 12px;
}

.stat-card {
  text-align: center;
}

.stat-card__label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.stat-card__value {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Review */
.warning-banner {
  background: var(--red-dim);
  color: var(--red);
  padding: 14px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
  border: 1px solid rgba(255, 69, 58, 0.2);
}

.violation-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.violation-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
}

.violation-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--red);
  min-width: 28px;
  text-align: center;
}

.violation-rule {
  font-size: 13px;
  font-weight: 600;
}

.violation-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.issue-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.issue-bar__header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 3px;
}

.issue-bar__count {
  font-weight: 600;
}

.issue-bar__track {
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
}

.issue-bar__fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.3s;
}

.review-record {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.review-record:last-child {
  border-bottom: none;
}

.review-record__header {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  margin-bottom: 2px;
}

.review-record__meta {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.review-record__notes {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-content {
  width: 90%;
  max-width: 600px;
  max-height: 85vh;
  overflow-y: auto;
}

.modal-title {
  font-size: 16px;
  margin-bottom: 16px;
}

.score-btns {
  display: flex;
  gap: 4px;
}

.score-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--border);
  transition: all 0.15s;
}

.score-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.violation-checks, .issue-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.v-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.v-check input {
  width: 14px;
  height: 14px;
}

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .form-grid-3 {
    grid-template-columns: 1fr;
  }

  .mini-checklist {
    grid-template-columns: 1fr;
  }

  .violation-grid {
    grid-template-columns: 1fr;
  }
}
</style>
