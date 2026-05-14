import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loadJson, saveJson, loadNumber, saveNumber } from '../utils/storage.js'

const HOLDINGS_KEY = 'holdings'
const CAPITAL_KEY = 'totalCapital'
const DEFAULT_CAPITAL = 1000000

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const usePositionStore = defineStore('position', () => {
  const holdings = ref(loadJson(HOLDINGS_KEY, []))
  const totalCapital = ref(loadNumber(CAPITAL_KEY, DEFAULT_CAPITAL))

  function saveHoldings() {
    saveJson(HOLDINGS_KEY, holdings.value)
  }

  function setCapital(val) {
    totalCapital.value = val
    saveNumber(CAPITAL_KEY, val)
  }

  function addHolding(h) {
    holdings.value.push({ ...h, id: generateId() })
    saveHoldings()
  }

  function removeHolding(id) {
    holdings.value = holdings.value.filter(h => h.id !== id)
    saveHoldings()
  }

  function updateTrailingStop(id, newTrailingStop) {
    const h = holdings.value.find(item => item.id === id)
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
    const total = holdings.value.reduce((s, h) => s + (h.position || 0), 0)
    for (const h of holdings.value) {
      const ind = h.industry || '未分类'
      if (!map[ind]) map[ind] = 0
      map[ind] += h.position || 0
    }
    return Object.entries(map).map(([name, value]) => ({
      name,
      value,
      pct: total > 0 ? +(value / total * 100).toFixed(1) : 0
    }))
  })

  return {
    holdings, totalCapital, industryConcentration,
    setCapital, addHolding, removeHolding, updateTrailingStop
  }
})
