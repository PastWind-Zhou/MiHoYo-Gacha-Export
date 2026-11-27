const { judgePool, calcPoolStats, isUpAt, analyzePool, parseLocal, bannersAt, alignJiluTimes } = require('./bannerJudge')

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

describe('异常输入防御', () => {
  // 回归：调用方误传 { source, banners } 这类对象时，
  // 曾导致 bannersAt 抛 TypeError，整个歪率统计流程失败
  test('banners 传入对象时不抛错（而非 TypeError）', () => {
    expect(() => bannersAt({ banners: [] }, 'character', 0)).not.toThrow()
    expect(bannersAt({ banners: [] }, 'character', 0)).toEqual([])
  })

  test('judgePool 的 banners 传入对象时不抛错', () => {
    const marked = judgePool({
      records: [rec('2024-01-05 12:00:00', '艾莲')],
      banners: { banners: [] },
      channel: 'character',
      topRank: '5'
    })
    expect(marked).toHaveLength(1)
    expect(marked[0].known).toBe(false)
  })

  test('analyzePool 的 banners 传入对象时不抛错', () => {
    const r = analyzePool({
      game: 'hkrpg',
      poolKey: '11',
      records: [rec('2024-01-05 12:00:00', '艾莲')],
      banners: { banners: [] }
    })
    expect(r.stats.unknownCount).toBe(1)
  })

  test('alignJiluTimes 传入对象时不抛错', () => {
    expect(() => alignJiluTimes({ banners: [] })).not.toThrow()
    expect(alignJiluTimes({ banners: [] })).toEqual([])
  })

  test('alignJiluTimes 传入正常数组时行为不变', () => {
    const input = [
      { channel: 'character', version: '4.5', phase: '上半', start: '2024-03-12 15:00:00', end: '2024-04-02 17:59:00' },
      { channel: 'jilu', version: '4.5', phase: '上半', start: '', end: '2024-04-02 17:59:00' }
    ]
    const out = alignJiluTimes(input)
    expect(out[1].start).toBe('2024-03-12 15:00:00')
  })
})

describe('集录祈愿时间对齐（alignJiluTimes）', () => {
  const charPool = {
    channel: 'character', version: '5.9', phase: '上半',
    start: '2025-09-09 15:00:00', end: '2025-09-30 17:59:59'
  }

  // 回归：集录池时间与同期 UP 池不一致时，以 UP 池为准
  test('时间不一致时以同期 UP 池的 start 与 end 为准', () => {
    const input = [
      charPool,
      {
        channel: 'jilu', version: '5.9', phase: '上半', title: '露草的行盏',
        start: '2025-09-10 06:00:00', end: '2025-09-30 17:59:00'
      }
    ]
    const out = alignJiluTimes(input)
    expect(out[1].start).toBe('2025-09-09 15:00:00')
    expect(out[1].end).toBe('2025-09-30 17:59:59')
  })

  test('时间缺失时也会补齐', () => {
    const input = [
      charPool,
      { channel: 'jilu', version: '5.9', phase: '上半', title: '露草的行盏', start: '', end: '' }
    ]
    const out = alignJiluTimes(input)
    expect(out[1].start).toBe('2025-09-09 15:00:00')
    expect(out[1].end).toBe('2025-09-30 17:59:59')
  })

  test('同相位找不到时放宽到同版本', () => {
    const input = [
      { ...charPool, phase: '下半' },
      { channel: 'jilu', version: '5.9', phase: '上半', title: 'X', start: '2025-09-10 06:00:00', end: '' }
    ]
    const out = alignJiluTimes(input)
    expect(out[1].start).toBe('2025-09-09 15:00:00')
  })

  test('并行池时取开始时间最早的那个', () => {
    const input = [
      { ...charPool, start: '2025-09-09 15:00:00', end: '2025-09-30 17:59:59' },
      { ...charPool, title: '另一个并行池', start: '2025-09-09 15:00:00', end: '2025-09-30 17:59:59' },
      { channel: 'jilu', version: '5.9', phase: '上半', title: 'X', start: '2025-09-10 06:00:00', end: '' }
    ]
    const out = alignJiluTimes(input)
    expect(out[2].start).toBe('2025-09-09 15:00:00')
  })

  test('找不到同期角色池时保持原样', () => {
    const jilu = { channel: 'jilu', version: '9.9', phase: '上半', title: 'X', start: '2025-09-10 06:00:00', end: '2025-09-30 17:59:00' }
    const out = alignJiluTimes([charPool, jilu])
    expect(out[1].start).toBe('2025-09-10 06:00:00')
    expect(out[1].end).toBe('2025-09-30 17:59:00')
  })

  test('手动修正 / 远程数据的集录池不被覆盖', () => {
    const input = [
      charPool,
      { channel: 'jilu', version: '5.9', phase: '上半', title: '手动', source: 'manual', start: '2025-09-01 00:00:00', end: '2025-10-01 00:00:00' },
      { channel: 'jilu', version: '5.9', phase: '上半', title: '远程', source: 'remote', start: '2025-09-02 00:00:00', end: '2025-10-02 00:00:00' }
    ]
    const out = alignJiluTimes(input)
    expect(out[1].start).toBe('2025-09-01 00:00:00')
    expect(out[2].start).toBe('2025-09-02 00:00:00')
  })

  test('非 jilu 渠道不受影响', () => {
    const input = [
      charPool,
      { channel: 'weapon', version: '5.9', phase: '上半', start: '2025-09-08 15:00:00', end: '2025-09-29 17:59:59' }
    ]
    const out = alignJiluTimes(input)
    expect(out[1].start).toBe('2025-09-08 15:00:00')
  })
})

describe('连歪统计（calcDeviationStreak）', () => {
  const { calcDeviationStreak } = require('./bannerJudge')
  // U = 出货且是当期 UP，L = 出货且是歪，null = 不可判定（打断）
  const m = (up, known = true) => ({ known, up, fallback: false, top: true })
  const seq = (s) => s.split('').map((c) => (c === 'L' ? m(false) : c === 'U' ? m(true) : m(false, false)))

  test('「歪,不歪,歪,不歪」为两连歪', () => {
    const r = calcDeviationStreak(seq('LULU'))
    expect(r.max).toBe(2)
    expect(r.histogram).toEqual({ 2: 1 })
    expect(r.current).toBe(2)
  })

  test('「歪,不歪,不歪,歪,不歪,歪,不歪」也是两连歪', () => {
    const r = calcDeviationStreak(seq('LUULULU'))
    expect(r.max).toBe(2)
    // 切成 [L,U](1歪) / [U](0歪) / [L,U,L,U](2歪)
    expect(r.histogram).toEqual({ 1: 1, 2: 1 })
  })

  test('相邻同号即断开，各自成段', () => {
    const r = calcDeviationStreak(seq('LULULU'))
    expect(r.max).toBe(3)
    expect(r.histogram).toEqual({ 3: 1 })
  })

  test('连续两个歪（无交替）只算 1 次', () => {
    const r = calcDeviationStreak(seq('LLLL'))
    expect(r.max).toBe(1)
    expect(r.histogram).toEqual({ 1: 4 })
  })

  test('不可判定的出货打断交替段', () => {
    const r = calcDeviationStreak(seq('LULxLULU'))
    // x 打断 → 两段 [L,U,L] 与 [L,U,L,U]
    expect(r.max).toBe(2)
    expect(r.histogram).toEqual({ 2: 2 })
  })

  test('纯 UP 段不计入分布', () => {
    const r = calcDeviationStreak(seq('UUU'))
    expect(r.max).toBe(0)
    expect(r.histogram).toEqual({})
  })

  test('当前连歪取末尾交替段的歪数', () => {
    expect(calcDeviationStreak(seq('LULU')).current).toBe(2)
    // ULUL 整段都是交替的，末尾段含 2 个歪
    expect(calcDeviationStreak(seq('ULUL')).current).toBe(2)
    expect(calcDeviationStreak(seq('UUU')).current).toBe(0)
    // 末尾段被同号断开时，取最后那一段
    expect(calcDeviationStreak(seq('LULUU')).current).toBe(0)
  })

  test('空输入不报错', () => {
    const r = calcDeviationStreak([])
    expect(r.max).toBe(0)
    expect(r.current).toBe(0)
    expect(r.histogram).toEqual({})
  })
})

describe('「首个 S 级必不歪」规则（firstTopIsUp）', () => {
  const { judgePool } = require('./bannerJudge')

  const rec = (name, rank, time) => ({
    id: name + time, name, item_type: '角色', rank_type: rank, time
  })

  test('池内第一个 S 级判为 UP，其后 S 级不可判定', () => {
    const marked = judgePool({
      records: [
        rec('A', '4', '2026-01-01 00:00:00'),
        rec('B', '4', '2026-01-02 00:00:00')
      ],
      banners: [], channel: 'character', topRank: '4', firstTopIsUp: true
    })
    const tops = marked.filter((m) => m.top)
    expect(tops[0].up).toBe(true)
    expect(tops[0].known).toBe(true)
    expect(tops[1].up).toBe(false)
    expect(tops[1].known).toBe(false)
  })

  test('按时间排序后取第一个 S 级（而非记录顺序）', () => {
    const marked = judgePool({
      records: [
        rec('B', '4', '2026-01-05 00:00:00'),
        rec('A', '4', '2026-01-01 00:00:00')
      ],
      banners: [], channel: 'character', topRank: '4', firstTopIsUp: true
    })
    expect(marked[0].name).toBe('A')
    expect(marked[0].up).toBe(true)
    expect(marked[1].up).toBe(false)
  })

  test('非最高级记录不受影响', () => {
    const marked = judgePool({
      records: [rec('C', '2', '2026-01-01 00:00:00'), rec('A', '4', '2026-01-02 00:00:00')],
      banners: [], channel: 'character', topRank: '4', firstTopIsUp: true
    })
    expect(marked[0].top).toBe(false)
    expect(marked[1].up).toBe(true)
  })

  test('未开启该选项时行为不变（依赖卡池数据）', () => {
    const marked = judgePool({
      records: [rec('A', '4', '2026-01-01 00:00:00')],
      banners: [], channel: 'character', topRank: '4'
    })
    expect(marked[0].known).toBe(false)
  })

  test('无 S 级记录时不报错', () => {
    const marked = judgePool({
      records: [rec('C', '2', '2026-01-01 00:00:00')],
      banners: [], channel: 'character', topRank: '4', firstTopIsUp: true
    })
    expect(marked.length).toBe(1)
    expect(marked[0].top).toBe(false)
  })
})
