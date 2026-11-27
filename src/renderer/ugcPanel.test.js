const fs = require('fs')
const path = require('path')

// jest 不编译 .vue，直接读取组件源码执行其中的 percent()，
// 防止 records（computed ref）被误当成普通数组而让占比永远显示 0%
const source = fs.readFileSync(path.join(__dirname, 'components/UgcPanel.vue'), 'utf8')

const makePercent = (list) => {
  const m = source.match(/const percent = \(num\) => \{[\s\S]*?\n\}/)
  if (!m) throw new Error('UgcPanel percent() not found')
  // eslint-disable-next-line no-new-func
  const factory = new Function('records', `${m[0]}\nreturn percent`)
  return factory({ value: list })
}

describe('UgcPanel 占比计算', () => {
  test('从 records.value.length 取总数，5/4 星占比能正常算出', () => {
    const percent = makePercent([{ rank_type: '5' }, { rank_type: '4' }, { rank_type: '3' }])
    expect(percent(1)).toBe('33.33%')
    expect(percent(2)).toBe('66.67%')
  })

  test('无记录时返回 0%', () => {
    expect(makePercent([])(5)).toBe('0%')
  })

  test('模板确实渲染 5/4 星占比', () => {
    expect(source).toContain('percent(count5)')
    expect(source).toContain('percent(count4)')
  })
})
