import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const HOLDINGS_KEY = 'holdings'
const CAPITAL_KEY = 'totalCapital'

export const usePositionStore = defineStore('position', () => {
  const holdings = ref(loadHoldings())
  const totalCapital = ref(loadCapital())

  function loadHoldings() {
    try {
      return JSON.parse(localStorage.getItem(HOLDINGS_KEY) || '[]')
    } catch { return [] }
  }

  function loadCapital() {
    return Number(localStorage.getItem(CAPITAL_KEY)) || 1000000
  }

  function saveHoldings() {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings.value))
  }

  function setCapital(val) {
    totalCapital.value = val
    localStorage.setItem(CAPITAL_KEY, String(val))
  }

  function addHolding(h) {
    holdings.value.push({ ...h, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) })
    saveHoldings()
  }

  function removeHolding(id) {
    holdings.value = holdings.value.filter(h => h.id !== id)
    saveHoldings()
  }

  function updateTrailingStop(id, newTrailingStop) {
    const h = holdings.value.find(h => h.id === id)
    if (!h) return false
    const current = h.trailingStop ?? 0
    if (newTrailingStop > current) {
      h.trailingStop = newTrailingStop
      saveHoldings()
      return true
    }
    return false
  }

  const industryConcentration = computed(() => {
    const map = {}
    const total = holdings.value.reduce((s, h) => s + h.position, 0)
    for (const h of holdings.value) {
      const ind = h.industry || '未分类'
      if (!map[ind]) map[ind] = 0
      map[ind] += h.position
    }
    return Object.entries(map).map(([name, value]) => ({
      name,
      value,
      pct: total > 0 ? (value / total * 100).toFixed(1) : 0
    }))
  })

  return {
    holdings, totalCapital, industryConcentration,
    setCapital, addHolding, removeHolding, updateTrailingStop
  }
})
