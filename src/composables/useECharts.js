/**
 * useECharts — ECharts 实例生命周期管理 composable
 *
 * 统一管理 ECharts 的初始化、resize、dispose、activated/deactivated，
 * 消除每个图表 ~30 行样板代码。
 *
 * 用法：
 *   const chartRef = ref(null)
 *   const { setOption, getInstance, dispose: disposeChart } = useECharts(chartRef)
 *
 *   // 数据就绪时
 *   setOption({ ... })          // 自动初始化（惰性）+ ResizeObserver
 *
 *   // 手动 dispose（如数据清空时）
 *   disposeChart()
 *
 * 生命周期自动处理：
 * - onActivated: 自动恢复实例 + 重绘最后一次 option
 * - onDeactivated: 自动 dispose（KeepAlive 停用时）
 * - onBeforeUnmount: 自动 dispose + 断开 ResizeObserver
 */
import { onBeforeUnmount, onActivated, onDeactivated, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'

export function useECharts(elRef) {
  let instance = null
  let ro = null
  let lastOption = null       // 保存最后一次 setOption 的参数，用于 activate 时恢复
  let lastNotMerge = true

  /**
   * 确保 ECharts 实例已初始化
   * @returns {echarts.ECharts | null}
   */
  function ensureInstance() {
    if (instance) return instance
    const el = elRef.value
    if (!el) return null
    instance = echarts.init(el)
    ro = new ResizeObserver(() => instance?.resize())
    ro.observe(el)
    return instance
  }

  /**
   * 设置图表选项（惰性初始化）
   * @param {object} option - ECharts option
   * @param {boolean} [notMerge=true] - 是否不合并（默认替换）
   */
  function setOption(option, notMerge = true) {
    lastOption = option
    lastNotMerge = notMerge
    const chart = ensureInstance()
    if (chart) chart.setOption(option, notMerge)
  }

  /**
   * 获取 ECharts 实例（可能为 null）
   */
  function getInstance() {
    return instance
  }

  /**
   * 手动 resize
   */
  function resize() {
    instance?.resize()
  }

  /**
   * 释放图表实例 + ResizeObserver
   */
  function dispose() {
    if (ro) { ro.disconnect(); ro = null }
    if (instance) { instance.dispose(); instance = null }
  }

  // 仅在 setup 作用域内注册生命周期钩子
  if (getCurrentInstance()) {
    onActivated(() => {
      // KeepAlive 恢复时：如果有保存的 option，重建实例并重绘
      if (lastOption && !instance) {
        const chart = ensureInstance()
        if (chart) chart.setOption(lastOption, lastNotMerge)
      }
      instance?.resize()
    })

    onDeactivated(() => {
      // KeepAlive 停用时 dispose，节省内存
      dispose()
    })

    onBeforeUnmount(() => {
      dispose()
    })
  }

  return { setOption, getInstance, resize, dispose }
}
