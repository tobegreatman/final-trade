/**
 * 评分历史管理
 * 在 localStorage 中按 code + date 存储评分快照
 * 用于展示评分趋势、变化箭头
 */
import { loadJson, saveJson } from './storage.js'

const STORAGE_KEY = 'score_history'
const MAX_DAYS = 30  // 保留最近 30 天

/**
 * 保存一次评分快照
 * @param {string} code - 股票代码
 * @param {object} scoreResult - 评分结果（需包含 total, dimensions）
 */
export function saveScoreSnapshot(code, scoreResult) {
  if (!code || !scoreResult) return

  const all = loadJson(STORAGE_KEY, {})
  const key = code
  const today = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD

  const snapshots = all[key] || []

  // 今日已有快照则更新，否则追加
  const todayIdx = snapshots.findIndex(s => s.date === today)
  const snapshot = {
    date: today,
    total: scoreResult.total,
    techScore: scoreResult.dimensions?.technical?.score ?? 0,
    techMax: scoreResult.dimensions?.technical?.max ?? 0,
    fundScore: scoreResult.dimensions?.fundamental?.score ?? 0,
    fundMax: scoreResult.dimensions?.fundamental?.max ?? 0,
    capScore: scoreResult.dimensions?.capital?.score ?? 0,
    capMax: scoreResult.dimensions?.capital?.max ?? 0,
  }

  if (todayIdx >= 0) {
    snapshots[todayIdx] = snapshot
  } else {
    snapshots.push(snapshot)
  }

  // 保留最近 30 天
  all[key] = snapshots.slice(-MAX_DAYS)
  saveJson(STORAGE_KEY, all)
}

/**
 * 获取指定股票的评分历史
 * @param {string} code - 股票代码
 * @returns {Array<{date,total,techScore,fundScore,capScore}>}
 */
export function getScoreHistory(code) {
  if (!code) return []
  const all = loadJson(STORAGE_KEY, {})
  return all[code] || []
}

/**
 * 获取评分较上次的变化
 * @param {string} code - 股票代码
 * @param {number} currentScore - 当前评分
 * @returns {{ delta: number, direction: 'up'|'down'|'same', prevTotal: number|null }}
 */
export function getScoreChange(code, currentScore) {
  const history = getScoreHistory(code)
  if (history.length < 2) return { delta: 0, direction: 'same', prevTotal: null }

  // 取倒数第二条（倒数第一条可能是今天的同一条）
  const prev = history.length >= 2 ? history[history.length - 2] : null
  if (!prev) return { delta: 0, direction: 'same', prevTotal: null }

  const delta = currentScore - prev.total
  return {
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    prevTotal: prev.total,
  }
}
