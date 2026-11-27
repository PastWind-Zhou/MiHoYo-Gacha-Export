const { mergeBanners, upSetKey } = require('./bannerMerge')

const banner = (over = {}) => ({
  version: '4.5',
  phase: '上半',
  channel: 'character',
  title: '测试卡池',
  start: '2024-03-12 15:00:00',
  end: '2024-04-02 17:59:00',
  up: [],
  up4: [],
  ...over
})

describe('mergeBanners', () => {
  test('新增卡池被追加', () => {
    const base = [banner({ end: '2024-04-02 17:59:00' })]
    const incoming = [banner({ end: '2024-05-02 17:59:00', title: '新卡池' })]
    const r = mergeBanners(base, incoming)
    expect(r.added).toBe(1)
    expect(r.banners).toHaveLength(2)
  })

  test('UP 名单变化时标记为修正', () => {
    const base = [banner({ up: ['旧角色'] })]
    const incoming = [banner({ up: ['新角色'] })]
    const r = mergeBanners(base, incoming)
    expect(r.updated).toBe(1)
    expect(r.banners[0].up).toEqual(['新角色'])
  })

  test('incoming 为空数组时不抛错', () => {
    expect(() => mergeBanners([banner()], [])).not.toThrow()
    expect(() => mergeBanners(null, null)).not.toThrow()
  })

  // 回归：集录池（jilu）的 UP 全在 upByType 里，
  // 旧实现只比较 up，导致 upByType 上的修正永远判定为「没变」而被丢弃
  test('集录池 upByType 的修正能够生效', () => {
    const base = [banner({
      channel: 'jilu',
      up: ['旧角色', '旧武器'],
      upByType: { character: ['旧角色'], weapon: ['旧武器'] }
    })]
    const incoming = [banner({
      channel: 'jilu',
      up: ['新角色', '新武器'],
      upByType: { character: ['新角色'], weapon: ['新武器'] },
      source: 'remote'
    })]
    const r = mergeBanners(base, incoming)
    expect(r.updated).toBe(1)
    expect(r.banners[0].upByType.character).toEqual(['新角色'])
    expect(r.banners[0].upByType.weapon).toEqual(['新武器'])
  })

  // 回归：up 为空、只有 upByType 的卡池也要能按 upByType 配对
  test('仅含 upByType 的卡池按 upByType 配对', () => {
    const base = [banner({
      channel: 'jilu',
      up: [],
      upByType: { character: ['甲'], weapon: ['乙'] }
    })]
    const incoming = [banner({
      channel: 'jilu',
      up: [],
      upByType: { character: ['甲'], weapon: ['乙'] },
      source: 'remote'
    })]
    const r = mergeBanners(base, incoming)
    expect(r.added).toBe(0)
    expect(r.banners).toHaveLength(1)
  })

  test('fillEmptyUp 模式只填补空的 UP', () => {
    const base = [banner({ up: ['已有'] })]
    const incoming = [banner({ up: ['反推值'] })]
    const r = mergeBanners(base, incoming, { overrideUp: false, overrideTime: false, fillEmptyUp: true })
    expect(r.banners[0].up).toEqual(['已有'])
  })

  test('fillEmptyUp 模式在 base 为空时写入', () => {
    const base = [banner({ up: [] })]
    const incoming = [banner({ up: ['反推值'] })]
    const r = mergeBanners(base, incoming, { overrideUp: false, overrideTime: false, fillEmptyUp: true })
    expect(r.banners[0].up).toEqual(['反推值'])
  })

  test('结束日期变化视为新的一期', () => {
    // 分组键是 channel@结束日期，结束日期不同即为不同期次，
    // 不会被当作同一期去覆盖
    const base = [banner({ end: '2024-04-02 17:59:00' })]
    const incoming = [banner({ end: '2024-04-09 17:59:00' })]
    const r = mergeBanners(base, incoming)
    expect(r.added).toBe(1)
    expect(r.banners).toHaveLength(2)
  })

  test('仅秒级差异不更新时间', () => {
    const base = [banner({ end: '2024-04-02 17:59:59' })]
    const incoming = [banner({ end: '2024-04-02 17:59:00' })]
    const r = mergeBanners(base, incoming)
    expect(r.banners[0].end).toBe('2024-04-02 17:59:59')
  })

  test('合并结果不与传入对象共享引用', () => {
    const base = [banner({ up: ['甲'] })]
    const r = mergeBanners(base, [])
    r.banners[0].up.push('乙')
    expect(base[0].up).toEqual(['甲'])
  })
})

describe('upSetKey', () => {
  test('up 非空时以 up 为键', () => {
    expect(upSetKey({ up: ['b', 'a'] })).toBe(upSetKey({ up: ['a', 'b'] }))
  })

  test('up 为空时退化到 upByType', () => {
    const a = upSetKey({ up: [], upByType: { character: ['甲'], weapon: ['乙'] } })
    const b = upSetKey({ up: [], upByType: { character: ['甲'], weapon: ['乙'] } })
    const c = upSetKey({ up: [], upByType: { character: ['丙'], weapon: ['乙'] } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
