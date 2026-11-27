const { isChartVisible, canResize } = require('./chartResize.cjs')

// 模拟 DOM 元素：只需 offsetWidth / offsetHeight
const el = (w, h) => ({ offsetWidth: w, offsetHeight: h })

describe('图表容器可见性判断', () => {
  test('空元素视为不可见', () => {
    expect(isChartVisible(null)).toBe(false)
    expect(isChartVisible(undefined)).toBe(false)
  })

  test('宽或高为 0 视为不可见', () => {
    expect(isChartVisible(el(0, 200))).toBe(false)
    expect(isChartVisible(el(400, 0))).toBe(false)
    expect(isChartVisible(el(0, 0))).toBe(false)
  })

  test('宽高都大于 0 视为可见', () => {
    expect(isChartVisible(el(400, 200))).toBe(true)
  })

  test('缺少 offsetWidth/offsetHeight 时视为不可见', () => {
    expect(isChartVisible({})).toBe(false)
  })
})

describe('resize 前置条件（canResize）', () => {
  test('实例不存在时不可 resize', () => {
    expect(canResize(null, el(400, 200))).toBe(false)
  })

  // 回归：容器隐藏时调用 resize，ECharts 会把 canvas 缩成 0×0 并清空内容，
  // 导致切换标签页回来后饼图一直空白
  test('容器隐藏时不可 resize', () => {
    expect(canResize({}, el(0, 0))).toBe(false)
  })

  test('实例存在且容器可见时可 resize', () => {
    expect(canResize({ resize: () => {} }, el(400, 200))).toBe(true)
  })
})
