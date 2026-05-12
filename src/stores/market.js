import { defineStore } from 'pinia'
import { ref } from 'vue'

const NB_CACHE_KEY = 'northbound_cache'
const MARGIN_CACHE_KEY = 'margin_cache'
const LIMIT_CACHE_KEY = 'limitStats_cache'

function loadCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch { /* ignore */ }
  return null
}

function loadCacheObj(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch { /* ignore */ }
  return null
}

function saveCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch { /* ignore */ }
}

export const useMarketStore = defineStore('market', () => {
  const indices = ref(null)
  const breadth = ref(null)
  const northbound = ref(loadCache(NB_CACHE_KEY))
  const margin = ref(loadCache(MARGIN_CACHE_KEY))
  const limitStats = ref(loadCacheObj(LIMIT_CACHE_KEY))
  const loading = ref(false)

  async function fetchIndices() {
    try {
      const res = await fetch('/api/market/indices')
      const json = await res.json()
      if (json.ok) indices.value = json.data
    } catch (e) {
      console.error('fetchIndices error:', e)
    }
  }

  async function fetchBreadth() {
    try {
      const res = await fetch('/api/market/breadth')
      const json = await res.json()
      if (json.ok) breadth.value = json.data
    } catch (e) {
      console.error('fetchBreadth error:', e)
    }
  }

  async function fetchNorthbound() {
    try {
      const res = await fetch('/api/market/northbound')
      const json = await res.json()
      if (json.ok && Array.isArray(json.data) && json.data.length) {
        northbound.value = json.data
        saveCache(NB_CACHE_KEY, json.data)
        return
      }
    } catch (e) {
      console.error('fetchNorthbound error:', e)
    }
  }

  async function fetchMargin() {
    try {
      const res = await fetch('/api/market/margin')
      const json = await res.json()
      if (json.ok && Array.isArray(json.data) && json.data.length) {
        margin.value = json.data
        saveCache(MARGIN_CACHE_KEY, json.data)
      }
    } catch (e) {
      console.error('fetchMargin error:', e)
    }
  }

  async function fetchLimitStats() {
    try {
      const res = await fetch('/api/market/limit-stats')
      const json = await res.json()
      if (json.ok && json.data) {
        limitStats.value = json.data
        saveCache(LIMIT_CACHE_KEY, json.data)
      }
    } catch (e) {
      console.error('fetchLimitStats error:', e)
    }
  }

  async function fetchAll() {
    loading.value = true
    try {
      await Promise.all([fetchIndices(), fetchBreadth(), fetchNorthbound(), fetchMargin(), fetchLimitStats()])
    } finally {
      loading.value = false
    }
  }

  return { indices, breadth, northbound, margin, limitStats, loading, fetchIndices, fetchBreadth, fetchNorthbound, fetchMargin, fetchLimitStats, fetchAll }
})
