// 图表容器可见性判断（纯逻辑，供单测覆盖）
//
// 背景：ECharts 内置了对容器的 ResizeObserver。容器从 display:none 恢复显示时，
// 它会在尺寸仍为 0 的瞬间把 canvas 缩成 0×0 并清空内容；之后容器尺寸不再变化，
// 于是没有人补救 —— 图表一直空白（切换标签页后饼图消失即由此导致）。
//
// 对策：容器不可见时不要调用 resize；恢复可见后再补一次 resize。
//
// 用 CommonJS 编写：jest 可直接 require 单测，
// Vite 侧通过 commonjsOptions.include 处理（见 .electron-vite/vite.config.js）。

// 容器是否已具备可见尺寸
const isChartVisible = (el) => {
  if (!el) return false
  const w = el.offsetWidth || 0
  const h = el.offsetHeight || 0
  return w > 0 && h > 0
}

// 是否可以安全地执行 resize：
//   - 实例存在
//   - 容器已可见（否则会被缩成 0×0 并清空）
const canResize = (chartInstance, el) => {
  if (!chartInstance) return false
  return isChartVisible(el)
}

module.exports = { isChartVisible, canResize }
