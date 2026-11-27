const { buildWaiwaiStats, buildWaiwaiRows } = require('./waiwaiStats')

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

describe('Excel 行数据（buildWaiwaiRows）', () => {
  const pools = [
    {
      poolKey: '11',
      name: '角色活动跃迁',
      channel: 'character',
      excluded: false,
      stats: {
        total: 100, topCount: 10, knownCount: 10, upCount: 7, lostCount: 3, unknownCount: 0,
        noDeviationCount: 5, noDeviationRate: 0.7143, avgUpPulls: 60.5, avgTopPulls: 50.25,
        minTopPulls: 12, maxTopPulls: 89, upHitRate: 0.7,
        deviationHistogram: { 1: 2, 2: 1 }, guaranteedCount: 3
      }
    },
    {
      poolKey: '1',
      name: '常驻跃迁',
      channel: '',
      excluded: true,
      stats: {
        total: 50, topCount: 5, knownCount: 0, upCount: 0, lostCount: 0, unknownCount: 5,
        noDeviationCount: 0, noDeviationRate: 0, avgUpPulls: 0, avgTopPulls: 0,
        minTopPulls: 0, maxTopPulls: 0, upHitRate: 0,
        deviationHistogram: {}, guaranteedCount: 0
      }
    }
  ]

  test('行数据与统计结果一一对应', () => {
    const rows = buildWaiwaiRows(pools, { yes: '是', no: '否', excludedSuffix: '（不参与统计）' })
    expect(rows).toHaveLength(2)
    expect(rows[0].pool).toBe('角色活动跃迁')
    expect(rows[0].included).toBe('是')
    expect(rows[0].noDeviationRate).toBe(0.7143)
    expect(rows[0].deviation1).toBe(2)
    expect(rows[0].deviation2).toBe(1)
    expect(rows[0].deviation3).toBe(0)
    expect(rows[0].guaranteed).toBe(3)
    expect(rows[0].luckiest).toBe(12)
    expect(rows[0].unluckiest).toBe(89)
  })

  test('排除池带标记且不参与统计', () => {
    const rows = buildWaiwaiRows(pools, { yes: '是', no: '否', excludedSuffix: '（不参与统计）' })
    expect(rows[1].pool).toBe('常驻跃迁（不参与统计）')
    expect(rows[1].included).toBe('否')
    expect(rows[1].unknown).toBe(5)
  })

  test('缺少统计字段时补零，不抛错', () => {
    const rows = buildWaiwaiRows([{ name: 'X', excluded: false, stats: {} }])
    expect(rows[0].total).toBe(0)
    expect(rows[0].deviation1).toBe(0)
    expect(rows[0].noDeviationRate).toBe(0)
  })
})

describe('歪率分析的池过滤与连歪字段', () => {
  const { buildWaiwaiStats } = require('./waiwaiStats')

  const result = new Map([
    ['2', [{ id: 'a', name: '安比', item_type: '角色', rank_type: '5', time: '2024-01-05 12:00:00' }]],
    ['3', [{ id: 'b', name: '强音热望', item_type: '音擎', rank_type: '5', time: '2024-01-05 12:00:00' }]],
    ['102', [{ id: 'c', name: '安比', item_type: '角色', rank_type: '5', time: '2024-01-05 12:00:00' }]],
    ['103', [{ id: 'd', name: '强音热望', item_type: '音擎', rank_type: '5', time: '2024-01-05 12:00:00' }]]
  ])

  test('绝区零的重映/回响池纳入统计（首个 S 级必不歪）', () => {
    const r = buildWaiwaiStats({ game: 'nap', result, banners: [], types: [] })
    const p102 = r.pools.find((p) => p.poolKey === '102')
    const p103 = r.pools.find((p) => p.poolKey === '103')
    expect(p102.firstTopIsUp).toBe(true)
    expect(p103.firstTopIsUp).toBe(true)
    // 它们不是 excluded —— 会显示在歪率分析里
    expect(p102.excluded).toBe(false)
    expect(p103.excluded).toBe(false)
  })

  test('绝区零常驻/邦布池仍标记为 excluded', () => {
    const r = buildWaiwaiStats({ game: 'nap', result, banners: [], types: [] })
    expect(r.pools.find((p) => p.poolKey === '2').excluded).toBe(false)
    expect(r.pools.find((p) => p.poolKey === '2').firstTopIsUp).toBe(false)
  })

  test('统计结果带连歪相关字段', () => {
    const r = buildWaiwaiStats({ game: 'nap', result, banners: [], types: [] })
    const s = r.pools.find((p) => p.poolKey === '2').stats
    expect(s).toHaveProperty('maxDeviationStreak')
    expect(s).toHaveProperty('currentDeviationStreak')
    expect(s).toHaveProperty('deviationStreakHistogram')
  })
})
