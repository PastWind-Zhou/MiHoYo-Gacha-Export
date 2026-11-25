const { judgePool, calcPoolStats, isUpAt, analyzePool, parseLocal } = require('./bannerJudge')

const rec = (time, name, { rank = '5', itemType = '角色', id = '' } = {}) => ({
  id,
  name,
  item_type: itemType,
  rank_type: rank,
  time
})

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
  },
  {
    channel: 'character',
    version: '1.1',
    phase: '上半',
    title: '并行池',
    start: '2024-01-10 10:00:00',
    end: '2024-01-30 14:59:59',
    up: ['朱鸢'],
    up4: []
  }
]

describe('UP 判定（isUpAt）', () => {
  test('命中当期 UP 名单 → up', () => {
    const r = isUpAt(banners, 'character', '艾莲', parseLocal('2024-01-05 12:00:00'), '角色')
    expect(r).toEqual({ up: true, known: true })
  })

  test('并行池期间命中任一 UP 名单即算 UP', () => {
    const r = isUpAt(banners, 'character', '朱鸢', parseLocal('2024-01-15 12:00:00'), '角色')
    expect(r).toEqual({ up: true, known: true })
  })

  test('区间内但不在 UP 名单 → 歪（known）', () => {
    const r = isUpAt(banners, 'character', '常驻五星', parseLocal('2024-01-05 12:00:00'), '角色')
    expect(r).toEqual({ up: false, known: true })
  })

  test('区间外 → 不可判定（known=false）', () => {
    const r = isUpAt(banners, 'character', '艾莲', parseLocal('2024-02-05 12:00:00'), '角色')
    expect(r).toEqual({ up: false, known: false })
  })

  test('引号写法不同也能命中', () => {
    const r = isUpAt(banners, 'character', '「艾莲」', parseLocal('2024-01-05 12:00:00'), '角色')
    expect(r.up).toBe(true)
  })

  test('混合池按物品类型取对应 UP 名单', () => {
    const mixed = [{
      channel: 'jilu',
      start: '2024-01-01 10:00:00',
      end: '2024-01-20 14:59:59',
      up: [],
      upByType: { character: ['刻晴'], weapon: ['雾切'] }
    }]
    const char = isUpAt(mixed, 'jilu', '刻晴', parseLocal('2024-01-05 12:00:00'), '角色')
    const weapon = isUpAt(mixed, 'jilu', '雾切', parseLocal('2024-01-05 12:00:00'), '武器')
    const wrong = isUpAt(mixed, 'jilu', '雾切', parseLocal('2024-01-05 12:00:00'), '角色')
    expect(char.up).toBe(true)
    expect(weapon.up).toBe(true)
    expect(wrong).toEqual({ up: false, known: true })
  })
})

describe('四级判定降级链（judgePool）', () => {
  test('① 命中名单 → UP；② 区间内未命中 → 歪；③ 无卡池数据 → 不可判定', () => {
    const marked = judgePool({
      records: [
        rec('2024-01-05 12:00:00', '艾莲'),
        rec('2024-01-06 12:00:00', '常驻五星'),
        rec('2024-02-05 12:00:00', '艾莲')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    expect(marked.map((m) => [m.up, m.known])).toEqual([
      [true, true],
      [false, true],
      [false, false]
    ])
  })

  test('④ 兜底默认关闭：无卡池数据的记录保持不可判定', () => {
    const marked = judgePool({
      records: [
        rec('2024-02-05 12:00:00', '流浪者'),
        rec('2024-02-20 12:00:00', '流浪者')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    const tops = marked.filter((m) => m.top)
    expect(tops[0].known).toBe(false)
    expect(tops[0].fallback).toBe(false)
    expect(calcPoolStats(marked).unknownCount).toBe(2)
  })

  test('④ 兜底开启：不可判定区间内只有唯一最高级物品 → 视为 UP（单独计数）', () => {
    const marked = judgePool({
      records: [
        rec('2024-02-05 12:00:00', '流浪者'),
        rec('2024-02-20 12:00:00', '流浪者')
      ],
      banners,
      channel: 'character',
      topRank: '5',
      fallback: true
    })
    const tops = marked.filter((m) => m.top)
    expect(tops[0].known).toBe(true)
    expect(tops[0].up).toBe(true)
    expect(tops[0].fallback).toBe(true)
    expect(tops[1].up).toBe(true)
    const stats = calcPoolStats(marked)
    expect(stats.fallbackCount).toBe(2)
    expect(stats.unknownCount).toBe(0)
    // 兜底记录不进入分子分母
    expect(stats.upCount).toBe(0)
  })

  test('④ 兜底开启：区间内出现两种最高级物品 → 仍不可判定', () => {
    const marked = judgePool({
      records: [
        rec('2024-02-05 12:00:00', '流浪者'),
        rec('2024-02-20 12:00:00', '宵宫')
      ],
      banners,
      channel: 'character',
      topRank: '5',
      fallback: true
    })
    const tops = marked.filter((m) => m.top)
    expect(tops[0].known).toBe(false)
    expect(tops[1].known).toBe(false)
    expect(calcPoolStats(marked).unknownCount).toBe(2)
  })
})

describe('歪率统计（calcPoolStats）', () => {
  const build = (names, times) => judgePool({
    records: names.map((n, i) => rec(times[i], n)),
    banners,
    channel: 'character',
    topRank: '5'
  })

  test('不歪率按 B 口径：首个 UP 无条件算不歪', () => {
    // 序列：UP / UP / 歪 / UP
    const marked = build(['艾莲', '艾莲', '常驻五星', '艾莲'], ['2024-01-05 12:00:00', '2024-01-06 12:00:00', '2024-01-07 12:00:00', '2024-01-08 12:00:00'])
    const stats = calcPoolStats(marked)
    expect(stats.upCount).toBe(3)
    expect(stats.lostCount).toBe(1)
    expect(stats.noDeviationCount).toBe(2)
    expect(stats.noDeviationRate).toBeCloseTo(2 / 3, 4)
  })

  test('大保底与连续歪分布', () => {
    // 序列：歪 / 歪 / UP（歪之后的 UP 即大保底）
    const marked = build(
      ['常驻五星', '常驻五星', '艾莲'],
      ['2024-01-05 12:00:00', '2024-01-06 12:00:00', '2024-01-07 12:00:00']
    )
    const stats = calcPoolStats(marked)
    expect(stats.lostCount).toBe(2)
    expect(stats.guaranteedCount).toBe(1)
    expect(stats.deviationHistogram).toEqual({ 2: 1 })
    expect(stats.upHitRate).toBeCloseTo(1 / 3, 4)
  })

  test('间隔统计：平均抽数、最欧/最非', () => {
    // 5 星之间的间隔按抽数计算（含 4 星记录）
    const marked = judgePool({
      records: [
        rec('2024-01-05 12:00:00', '艾莲'),
        rec('2024-01-06 12:00:00', '四星', { rank: '4' }),
        rec('2024-01-07 12:00:00', '四星', { rank: '4' }),
        rec('2024-01-08 12:00:00', '常驻五星'),
        rec('2024-01-09 12:00:00', '四星', { rank: '4' }),
        rec('2024-01-12 12:00:00', '艾莲')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    const stats = calcPoolStats(marked)
    expect(stats.topCount).toBe(3)
    // 最高级记录位于索引 0 / 3 / 5 → 间隔 3 与 2
    expect(stats.avgTopPulls).toBeCloseTo((3 + 2) / 2, 4)
    expect(stats.minTopPulls).toBe(2)
    expect(stats.maxTopPulls).toBe(3)
    expect(stats.avgUpPulls).toBeCloseTo(5, 4)
  })

  test('不可判定记录不计入分子分母', () => {
    const marked = judgePool({
      records: [
        rec('2024-01-05 12:00:00', '艾莲'),
        rec('2024-02-05 12:00:00', '宵宫'),
        rec('2024-02-06 12:00:00', '宵宫')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    const stats = calcPoolStats(marked)
    expect(stats.topCount).toBe(3)
    expect(stats.unknownCount).toBe(2)
    expect(stats.upCount).toBe(1)
    expect(stats.noDeviationCount).toBe(1)
    expect(stats.noDeviationRate).toBe(1)
  })
})

describe('按游戏配置分析（analyzePool）', () => {
  test('从 games 配置推导 channel 与最高星级', () => {
    const r = analyzePool({
      game: 'hkrpg',
      poolKey: '11',
      records: [rec('2024-01-05 12:00:00', '希儿')],
      banners: [{
        channel: 'character',
        start: '2024-01-01 10:00:00',
        end: '2024-01-20 14:59:59',
        up: ['希儿'],
        up4: []
      }]
    })
    expect(r.channel).toBe('character')
    expect(r.topRank).toBe('5')
    expect(r.excluded).toBe(false)
    expect(r.stats.upCount).toBe(1)
  })

  test('常驻/新手/集录池标记为不参与歪率统计', () => {
    expect(analyzePool({ game: 'genshin', poolKey: '500', records: [], banners: [] }).excluded).toBe(true)
    expect(analyzePool({ game: 'hkrpg', poolKey: '1', records: [], banners: [] }).excluded).toBe(true)
    expect(analyzePool({ game: 'hkrpg', poolKey: '11', records: [], banners: [] }).excluded).toBe(false)
  })

  test('无排期数据的池不可判定（绝区零最高星级为 rank 4）', () => {
    const r = analyzePool({
      game: 'nap',
      poolKey: '2',
      records: [rec('2024-01-05 12:00:00', '艾莲', { rank: '4', itemType: '代理' })],
      banners: []
    })
    expect(r.channel).toBe('character')
    expect(r.topRank).toBe('4')
    expect(r.stats.unknownCount).toBe(1)
    expect(r.stats.upCount).toBe(0)
  })

  test('绝区零独家重映池无排期数据且不参与歪率统计', () => {
    const r = analyzePool({ game: 'nap', poolKey: '5', records: [], banners: [] })
    expect(r.channel).toBe('')
    expect(r.excluded).toBe(true)
  })
})
