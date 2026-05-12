import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMarketStore = defineStore('market', () => {
  const indices = ref(null)
  const breadth = ref(null)
  const northbound = ref(null)
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
      if (json.ok) northbound.value = json.data
    } catch (e) {
      console.error('fetchNorthbound error:', e)
    }
  }

  async function fetchAll() {
    loading.value = true
    await Promise.all([fetchIndices(), fetchBreadth(), fetchNorthbound()])
    loading.value = false
  }

  return { indices, breadth, northbound, loading, fetchIndices, fetchBreadth, fetchNorthbound, fetchAll }
})
