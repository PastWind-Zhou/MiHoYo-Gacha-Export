const { buildWaiwaiStats } = require('./waiwaiStats')

const banners = [
  {
    channel: 'character',
    version: '1.0',
    phase: '上半',
    title: '上半',
    start: '2024-01-01 10:00:00',
    end: '2024-01-20 14:59:59',
    up: ['艾莲'],
    up4: []
  }
]

const rec = (time, name, { rank = '5', itemType = '角色' } = {}) => ({
  id: '',
  name,
  item_type: itemType,
  rank_type: rank,
  time
})

describe('歪率分析数据组装', () => {
  test('只统计有排期映射的卡池', () => {
    const result = new Map([
      ['11', [rec('2024-01-05 12:00:00', '艾莲')]],
      ['1', [rec('2024-01-05 12:00:00', '瓦尔特')]]
    ])
    const r = buildWaiwaiStats({
      game: 'hkrpg',
      result,
      banners,
      types: [{ key: '11', name: '角色活动跃迁' }, { key: '1', name: '常驻跃迁' }]
    })
    expect(r.game).toBe('hkrpg')
    expect(r.pools).toHaveLength(1)
    expect(r.pools[0].poolKey).toBe('11')
    expect(r.pools[0].name).toBe('角色活动跃迁')
    expect(r.pools[0].channel).toBe('character')
    expect(r.pools[0].excluded).toBe(false)
  })

  test('不参与歪率统计的池会被标记 excluded（无排期映射的池直接过滤）', () => {
    const result = new Map([
      ['500', [rec('2024-01-05 12:00:00', '刻晴')]],
      ['200', [rec('2024-01-05 12:00:00', '迪卢克')]]
    ])
    const r = buildWaiwaiStats({ game: 'genshin', result, banners: [], types: [] })
    // 200（常驻祈愿）没有排期映射，不进入分析；500（集录祈愿）有映射但排除统计
    expect(r.pools.map((p) => p.poolKey)).toEqual(['500'])
    expect(r.pools[0].excluded).toBe(true)
    expect(r.pools[0].channel).toBe('jilu')
  })

  test('统计数值与判定引擎一致', () => {
    const result = new Map([
      ['11', [
        rec('2024-01-05 12:00:00', '艾莲'),
        rec('2024-01-06 12:00:00', '艾莲'),
        rec('2024-01-07 12:00:00', '常驻五星')
      ]]
    ])
    const r = buildWaiwaiStats({ game: 'hkrpg', result, banners, types: [{ key: '11', name: '角色活动跃迁' }] })
    const stats = r.pools[0].stats
    expect(stats.topCount).toBe(3)
    expect(stats.upCount).toBe(2)
    expect(stats.lostCount).toBe(1)
    expect(stats.noDeviationCount).toBe(2)
    expect(stats.unknownCount).toBe(0)
  })

  test('空数据返回空列表', () => {
    expect(buildWaiwaiStats({ game: 'hkrpg', result: null, banners }).pools).toEqual([])
    expect(buildWaiwaiStats({ game: 'hkrpg', result: new Map(), banners }).pools).toEqual([])
  })

  test('未知游戏返回空列表', () => {
    expect(buildWaiwaiStats({ game: 'unknown', result: new Map(), banners }).pools).toEqual([])
  })
})
