import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadJson, saveJson } from '../utils/storage.js'

const NB_KEY = 'northbound_cache'
const MARGIN_KEY = 'margin_cache'
const LIMIT_KEY = 'limitStats_cache'

export const useMarketStore = defineStore('market', () => {
  const indices = ref(null)
  const breadth = ref(null)
  const northbound = ref(loadJson(NB_KEY))
  const margin = ref(loadJson(MARGIN_KEY))
  const limitStats = ref(loadJson(LIMIT_KEY))
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
        saveJson(NB_KEY, json.data)
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
        saveJson(MARGIN_KEY, json.data)
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
        saveJson(LIMIT_KEY, json.data)
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
