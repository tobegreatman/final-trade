import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const TRADES_KEY = 'journal_trades'

export const useJournalStore = defineStore('journal', () => {
  const trades = ref(loadTrades())

  function loadTrades() {
    try {
      return JSON.parse(localStorage.getItem(TRADES_KEY) || '[]')
    } catch { return [] }
  }

  function saveTrades() {
    localStorage.setItem(TRADES_KEY, JSON.stringify(trades.value))
  }

  function addTrade(trade) {
    trades.value.push({
      ...trade,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      status: 'open',
      sellPrice: null,
      sellDate: null,
      sellReason: null,
      pnl: null,
      pnlPct: null,
      actualRR: null,
      emotion: null,
      executionScore: null,
      violations: [],
      issues: [],
      reviewNotes: ''
    })
    saveTrades()
  }

  function closeTrade(id, closeData) {
    const t = trades.value.find(t => t.id === id)
    if (!t || t.status !== 'open') return
    const sellPrice = closeData.sellPrice
    const pnl = (sellPrice - t.buyPrice) * t.quantity
    const pnlPct = t.buyPrice > 0 ? ((sellPrice - t.buyPrice) / t.buyPrice) * 100 : 0
    const risk = t.buyPrice - (t.stopPrice || 0)
    const actualRR = risk > 0 ? ((sellPrice - t.buyPrice) / risk) : 0

    Object.assign(t, {
      status: 'closed',
      sellPrice,
      sellDate: closeData.sellDate || new Date().toISOString().slice(0, 10),
      sellReason: closeData.sellReason,
      pnl: Math.round(pnl * 100) / 100,
      pnlPct: Math.round(pnlPct * 100) / 100,
      actualRR: Math.round(actualRR * 100) / 100,
      emotion: closeData.emotion,
      executionScore: closeData.executionScore,
      violations: closeData.violations || [],
      issues: closeData.issues || [],
      reviewNotes: closeData.reviewNotes || ''
    })
    saveTrades()
  }

  function deleteTrade(id) {
    trades.value = trades.value.filter(t => t.id !== id)
    saveTrades()
  }

  const openTrades = computed(() => trades.value.filter(t => t.status === 'open'))
  const closedTrades = computed(() => trades.value.filter(t => t.status === 'closed'))

  const stats = computed(() => {
    const closed = closedTrades.value
    if (!closed.length) {
      return { winRate: 0, profitFactor: 0, totalPnl: 0, avgWin: 0, avgLoss: 0, count: 0 }
    }
    const wins = closed.filter(t => t.pnl > 0)
    const losses = closed.filter(t => t.pnl <= 0)
    const totalWin = wins.reduce((s, t) => s + t.pnl, 0)
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
    return {
      winRate: Math.round((wins.length / closed.length) * 100),
      profitFactor: totalLoss > 0 ? Math.round((totalWin / totalLoss) * 100) / 100 : 0,
      totalPnl: Math.round(closed.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
      avgWin: wins.length ? Math.round(wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length * 100) / 100 : 0,
      avgLoss: losses.length ? Math.round(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length * 100) / 100 : 0,
      count: closed.length
    }
  })

  // 连续止损检测
  const consecutiveStops = computed(() => {
    let count = 0
    for (let i = closedTrades.value.length - 1; i >= 0; i--) {
      if (closedTrades.value[i].pnl < 0) count++
      else break
    }
    return count
  })

  // 月度统计
  const monthlyStats = computed(() => {
    const map = {}
    for (const t of closedTrades.value) {
      const month = t.sellDate?.slice(0, 7) || 'unknown'
      if (!map[month]) map[month] = { month, pnl: 0, count: 0, wins: 0 }
      map[month].pnl += t.pnl || 0
      map[month].count++
      if (t.pnl > 0) map[month].wins++
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  })

  // 策略对比
  const strategyStats = computed(() => {
    const map = {}
    for (const t of closedTrades.value) {
      const key = t.strategyName || t.strategy || '未知'
      if (!map[key]) map[key] = { name: key, count: 0, pnl: 0, wins: 0 }
      map[key].count++
      map[key].pnl += t.pnl || 0
      if (t.pnl > 0) map[key].wins++
    }
    return Object.values(map).map(s => ({
      ...s,
      winRate: s.count > 0 ? Math.round(s.wins / s.count * 100) : 0,
      pnl: Math.round(s.pnl * 100) / 100
    }))
  })

  return {
    trades, openTrades, closedTrades, stats,
    consecutiveStops, monthlyStats, strategyStats,
    addTrade, closeTrade, deleteTrade
  }
})
