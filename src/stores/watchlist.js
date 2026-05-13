import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { REFRESH_INTERVAL } from '../utils/constants.js'

const STORAGE_KEY = 'watchlist'

export const useWatchlistStore = defineStore('watchlist', () => {
  const stocks = ref(loadStocks())
  const quotes = ref({})
  const klineCache = ref({})
  let refreshTimer = null
  let visibilityHandler = null

  function loadStocks() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch { return [] }
  }

  function saveStocks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks.value))
  }

  const codes = computed(() => stocks.value.map(s => s.code))

  function addStock(code, name) {
    if (stocks.value.find(s => s.code === code)) return
    stocks.value.push({ code, name, addedAt: Date.now() })
    saveStocks()
  }

  function removeStock(code) {
    stocks.value = stocks.value.filter(s => s.code !== code)
    saveStocks()
  }

  function reorderStock(fromIdx, toIdx) {
    const item = stocks.value.splice(fromIdx, 1)[0]
    stocks.value.splice(toIdx, 0, item)
    saveStocks()
  }

  async function fetchQuotes() {
    if (!stocks.value.length) return
    try {
      const codeStr = stocks.value.map(s => s.code).join(',')
      const res = await fetch(`/api/stock/batch/quotes?codes=${codeStr}`)
      const json = await res.json()
      if (json.ok) quotes.value = json.data
    } catch (e) {
      console.error('fetchQuotes error:', e)
    }
  }

  async function fetchKline(code) {
    if (klineCache.value[code]) return klineCache.value[code]
    try {
      const res = await fetch(`/api/stock/${code}/kline`)
      const json = await res.json()
      if (json.ok) {
        klineCache.value[code] = json.data
        return json.data
      }
    } catch (e) {
      console.error('fetchKline error:', e)
    }
    return null
  }

  function startAutoRefresh(interval = REFRESH_INTERVAL) {
    stopAutoRefresh()
    fetchQuotes()
    refreshTimer = setInterval(fetchQuotes, interval)
    visibilityHandler = () => {
      if (document.hidden) {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
      } else {
        if (!refreshTimer) {
          fetchQuotes()
          refreshTimer = setInterval(fetchQuotes, interval)
        }
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  return {
    stocks, quotes, klineCache, codes,
    addStock, removeStock, reorderStock, fetchQuotes, fetchKline,
    startAutoRefresh, stopAutoRefresh
  }
})
