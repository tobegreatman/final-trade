import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loadJson, saveJson } from '../utils/storage.js'
import { determineCyclePhase, generateStrategy } from '../utils/marketCycle.js'

const CACHE_KEY = 'marketAnalysis_cache'
const REFRESH_INTERVAL = 60_000

export const useMarketAnalysisStore = defineStore('marketAnalysis', () => {
  const sectors = ref([])
  const valuation = ref(null)
  const cyclePhase = ref(null)
  const strategy = ref(null)
  const loading = ref(false)
  const lastUpdated = ref(null)
  const rsDays = ref(0)
  const rsAvailable = ref(false)
  const rotationSignal = ref(null)
  const top5Strong = ref([])
  const top5Weak = ref([])
  const top5Flow = ref([])
  const macro = ref(null)
  const dataSources = ref({ sectors: '', valuation: '' })
  let timer = null

  const phaseLabel = computed(() => cyclePhase.value?.label || '加载中...')
  const phaseMeta = computed(() => cyclePhase.value?.meta || {})

  async function fetchSectors() {
    try {
      const res = await fetch('/api/analysis/sectors')
      const json = await res.json()
      if (json.ok) {
        sectors.value = json.data.sectors || []
        rsDays.value = json.data.rsDays || 0
        rsAvailable.value = json.data.rsAvailable || false
        rotationSignal.value = json.data.rotationSignal || null
        top5Strong.value = json.data.top5Strong || []
        top5Weak.value = json.data.top5Weak || []
        top5Flow.value = json.data.top5Flow || []
        dataSources.value.sectors = json.data.source || ''
        return json.data
      }
    } catch (e) {
      console.error('fetchSectors error:', e)
    }
    return null
  }

  async function fetchValuation() {
    try {
      const res = await fetch('/api/analysis/valuation')
      const json = await res.json()
      if (json.ok) {
        valuation.value = json.data
        dataSources.value.valuation = json.data.source || ''
        return json.data
      }
    } catch (e) {
      console.error('fetchValuation error:', e)
    }
    return null
  }

  async function fetchMacro() {
    try {
      const res = await fetch('/api/analysis/macro')
      const json = await res.json()
      if (json.ok) {
        macro.value = json.data
        return json.data
      }
    } catch (e) {
      console.error('fetchMacro error:', e)
    }
    return null
  }

  async function fetchAll() {
    loading.value = true
    try {
      const [sectorData, valData, macroData] = await Promise.all([fetchSectors(), fetchValuation(), fetchMacro()])

      if (valData) {
        // need breadth + limitStats + margin + northbound for cycle detection
        let breadth = null, limitStats = null, margin = null, northbound = null
        try {
          const [bRes, lRes, mRes, nRes] = await Promise.all([
            fetch('/api/market/breadth').then(r => r.json()),
            fetch('/api/market/limit-stats').then(r => r.json()),
            fetch('/api/market/margin').then(r => r.json()),
            fetch('/api/market/northbound').then(r => r.json())
          ])
          if (bRes.ok) breadth = bRes.data
          if (lRes.ok) limitStats = lRes.data
          if (mRes.ok) margin = mRes.data
          if (nRes.ok && Array.isArray(nRes.data)) northbound = nRes.data
        } catch (_) {}

        cyclePhase.value = determineCyclePhase(valData, breadth, limitStats, margin, northbound)

        const topSectors = sectorData?.top5Strong || []
        strategy.value = generateStrategy(cyclePhase.value, topSectors)
      }

      lastUpdated.value = new Date().toISOString()
      saveToCache()
    } finally {
      loading.value = false
    }
  }

  function loadFromCache() {
    const cached = loadJson(CACHE_KEY)
    if (!cached) return false
    sectors.value = cached.sectors || []
    valuation.value = cached.valuation || null
    cyclePhase.value = cached.cyclePhase || null
    strategy.value = cached.strategy || null
    lastUpdated.value = cached.lastUpdated || null
    rsDays.value = cached.rsDays || 0
    rsAvailable.value = cached.rsAvailable || false
    rotationSignal.value = cached.rotationSignal || null
    top5Strong.value = cached.top5Strong || []
    top5Weak.value = cached.top5Weak || []
    top5Flow.value = cached.top5Flow || []
    macro.value = cached.macro || null
    dataSources.value = cached.dataSources || { sectors: '', valuation: '' }
    return true
  }

  function saveToCache() {
    saveJson(CACHE_KEY, {
      sectors: sectors.value,
      valuation: valuation.value,
      cyclePhase: cyclePhase.value,
      strategy: strategy.value,
      lastUpdated: lastUpdated.value,
      rsDays: rsDays.value,
      rsAvailable: rsAvailable.value,
      rotationSignal: rotationSignal.value,
      top5Strong: top5Strong.value,
      top5Weak: top5Weak.value,
      top5Flow: top5Flow.value,
      macro: macro.value,
      dataSources: dataSources.value
    })
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    const tick = () => {
      if (document.visibilityState === 'visible') fetchAll()
    }
    timer = setInterval(tick, REFRESH_INTERVAL)
  }

  function stopAutoRefresh() {
    if (timer) { clearInterval(timer); timer = null }
  }

  return {
    sectors, valuation, cyclePhase, strategy, loading, lastUpdated, rsDays, rsAvailable, rotationSignal, top5Strong, top5Weak, top5Flow, macro, dataSources,
    phaseLabel, phaseMeta,
    fetchSectors, fetchValuation, fetchMacro, fetchAll,
    loadFromCache, saveToCache,
    startAutoRefresh, stopAutoRefresh
  }
})
