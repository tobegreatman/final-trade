/**
 * 个股分析数据缓存 Store
 * 缓存已分析过的股票数据，返回页面时优先读缓存（TTL 5分钟）
 * 评分结果单独缓存，避免重算
 */
import { defineStore } from 'pinia'
import { loadJson, saveJson } from '../utils/storage.js'

const CACHE_TTL = 5 * 60 * 1000  // 5 分钟
const MAX_CACHE_SIZE = 20         // 最多缓存 20 只股票

export const useStockAnalysisStore = defineStore('stockAnalysis', {
  state: () => ({
    // { code: { data, timestamp } }
    cache: loadJson('stockAnalysis_cache', {}),
  }),

  actions: {
    /**
     * 获取缓存的分析数据，过期返回 null
     * @param {string} code - 股票代码
     * @returns {Object|null} 缓存数据或 null
     */
    getCached(code) {
      const entry = this.cache[code]
      if (!entry) return null
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        delete this.cache[code]
        return null
      }
      return entry.data
    },

    /**
     * 存入分析数据缓存
     * @param {string} code - 股票代码
     * @param {Object} data - 完整分析数据（klines, indicators, fundamental, etc.）
     */
    setCache(code, data) {
      // 淘汰最旧的条目
      const keys = Object.keys(this.cache)
      if (keys.length >= MAX_CACHE_SIZE) {
        let oldest = null, oldestTime = Infinity
        for (const k of keys) {
          if (this.cache[k].timestamp < oldestTime) {
            oldestTime = this.cache[k].timestamp
            oldest = k
          }
        }
        if (oldest) delete this.cache[oldest]
      }

      this.cache[code] = { data, timestamp: Date.now() }
      this._persist()
    },

    /**
     * 仅缓存评分结果（轻量，用于返回页面时快速显示）
     * @param {string} code - 股票代码
     * @param {Object} scoreResult - 评分结果
     */
    setScoreCache(code, scoreResult) {
      const entry = this.cache[code]
      if (entry) {
        entry.data.scoreResult = scoreResult
        this._persist()
      }
    },

    /**
     * 清除指定股票缓存
     */
    invalidate(code) {
      delete this.cache[code]
      this._persist()
    },

    /**
     * 清除全部缓存
     */
    clearAll() {
      this.cache = {}
      this._persist()
    },

    _persist() {
      saveJson('stockAnalysis_cache', this.cache)
    },
  },
})
