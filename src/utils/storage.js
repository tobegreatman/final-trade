/**
 * localStorage 统一读写工具
 * 所有 store 共用，避免每个 store 重复实现 try/catch 逻辑
 */
export function loadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return fallback
}

export function saveJson(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch { /* ignore */ }
}

export function loadNumber(key, fallback = 0) {
  return Number(localStorage.getItem(key)) || fallback
}

export function saveNumber(key, val) {
  try {
    localStorage.setItem(key, String(val))
  } catch { /* ignore */ }
}
