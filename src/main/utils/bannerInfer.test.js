const { inferPool, inferGame, segmentsOfUnknown } = require('./bannerInfer')
const { isUpAt, parseLocal, judgePool } = require('./bannerJudge')
const { mergeBanners } = require('../gachaBanner')

const rec = (time, name, { rank = '5', itemType = '角色' } = {}) => ({
  id: '',
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
  }
]

describe('本地反推（inferPool）', () => {
  test('区段内只有唯一最高级物品 → 高置信反推', () => {
    const res = inferPool({
      records: [
        rec('2024-02-05 12:00:00', '流浪者'),
        rec('2024-02-10 12:00:00', '流浪者')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    expect(res.inferred).toHaveLength(1)
    expect(res.inferred[0].up).toEqual(['流浪者'])
    expect(res.inferred[0].confidence).toBe('high')
    expect(res.inferred[0].source).toBe('local')
    expect(res.inferred[0].channel).toBe('character')
    expect(res.inferred[0].start).toBe('2024-02-05 12:00:00')
    expect(res.inferred[0].end).toBe('2024-02-10 12:00:00')
    expect(res.pending).toHaveLength(0)
  })

  test('区段内出现多种最高级物品 → 待人工确认（UP 名单留空）', () => {
    const res = inferPool({
      records: [
        rec('2024-02-05 12:00:00', '流浪者'),
        rec('2024-02-10 12:00:00', '宵宫')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    expect(res.inferred).toHaveLength(0)
    expect(res.pending).toHaveLength(1)
    expect(res.pending[0].up).toEqual([])
    expect(res.pending[0].needsManual).toBe(true)
    expect(res.pending[0].candidates.slice().sort()).toEqual(['宵宫', '流浪者'])
  })

  test('① 内置表里某期缺 UP 名单 → 用该期记录反推并填回该期', () => {
    const gapped = [{
      channel: 'character',
      version: '1.0',
      phase: '上半',
      title: '缺 UP 名单的期次',
      start: '2024-01-01 10:00:00',
      end: '2024-01-20 14:59:59',
      up: [],
      up4: [],
      source: 'builtin'
    }]
    const res = inferPool({
      records: [rec('2024-01-05 12:00:00', '艾莲')],
      banners: gapped,
      channel: 'character',
      topRank: '5'
    })
    expect(res.inferred).toHaveLength(1)
    expect(res.inferred[0].up).toEqual(['艾莲'])
    expect(res.inferred[0].start).toBe('2024-01-01 10:00:00')
    expect(res.inferred[0].end).toBe('2024-01-20 14:59:59')
    expect(res.inferred[0].confidence).toBe('high')

    // 并入后该期重新可判定，且 fillEmptyUp 把 UP 填进原来那期
    const merged = mergeBanners(gapped, res.inferred, { overrideUp: false, overrideTime: false, fillEmptyUp: true }).banners
    expect(merged).toHaveLength(1)
    expect(merged[0].up).toEqual(['艾莲'])
    const after = judgePool({ records: [rec('2024-01-05 12:00:00', '艾莲')], banners: merged, channel: 'character', topRank: '5' })
    expect(after.filter((m) => m.top && !m.known)).toHaveLength(0)
    expect(after.filter((m) => m.top && m.up)).toHaveLength(1)
  })

  test('① 缺 UP 名单的期次内出现多种最高级物品 → 待人工确认', () => {
    const gapped = [{
      channel: 'character',
      version: '1.0',
      phase: '上半',
      title: '缺 UP 名单的期次',
      start: '2024-01-01 10:00:00',
      end: '2024-01-20 14:59:59',
      up: [],
      up4: [],
      source: 'builtin'
    }]
    const res = inferPool({
      records: [
        rec('2024-01-05 12:00:00', '艾莲'),
        rec('2024-01-10 12:00:00', '宵宫')
      ],
      banners: gapped,
      channel: 'character',
      topRank: '5'
    })
    expect(res.inferred).toHaveLength(0)
    expect(res.pending).toHaveLength(1)
    expect(res.pending[0].candidates.slice().sort()).toEqual(['宵宫', '艾莲'])
    expect(res.pending[0].needsManual).toBe(true)
  })

  test('有排期数据的记录不产生反推', () => {
    const res = inferPool({
      records: [rec('2024-01-05 12:00:00', '艾莲')],
      banners,
      channel: 'character',
      topRank: '5'
    })
    expect(res.inferred).toHaveLength(0)
    expect(res.pending).toHaveLength(0)
  })

  test('无排期区间内出现多种最高级物品 → 待人工确认（期次无法切分）', () => {
    const res = inferPool({
      records: [
        rec('2024-01-05 12:00:00', '艾莲'),
        rec('2024-02-05 12:00:00', '流浪者'),
        rec('2024-03-05 12:00:00', '流浪者'),
        rec('2024-05-05 12:00:00', '宵宫'),
        rec('2024-05-10 12:00:00', '宵宫')
      ],
      banners,
      channel: 'character',
      topRank: '5'
    })
    // 没有排期数据时无法切分期次，整段视为一个缺失期次
    expect(res.inferred).toHaveLength(0)
    expect(res.pending).toHaveLength(1)
    expect(res.pending[0].candidates.slice().sort()).toEqual(['宵宫', '流浪者'])
    expect(res.pending[0].start).toBe('2024-02-05 12:00:00')
    expect(res.pending[0].end).toBe('2024-05-10 12:00:00')
  })

  test('反推结果并入卡池后，原不可判定记录变为可判定', () => {
    const records = [
      rec('2024-02-05 12:00:00', '流浪者'),
      rec('2024-02-10 12:00:00', '流浪者')
    ]
    const before = judgePool({ records, banners, channel: 'character', topRank: '5' })
    expect(before.filter((m) => m.top && !m.known)).toHaveLength(2)

    const res = inferPool({ records, banners, channel: 'character', topRank: '5' })
    const merged = mergeBanners(banners, res.inferred, { overrideUp: false, overrideTime: false }).banners
    const after = judgePool({ records, banners: merged, channel: 'character', topRank: '5' })
    expect(after.filter((m) => m.top && !m.known)).toHaveLength(0)
    expect(after.filter((m) => m.top && m.up)).toHaveLength(2)
  })
})

describe('区段切分（segmentsOfUnknown）', () => {
  test('按最高级记录序列切分连续不可判定区段', () => {
    const tops = [
      { top: true, known: true, index: 0 },
      { top: true, known: false, index: 3 },
      { top: true, known: false, index: 4 },
      { top: true, known: true, index: 9 },
      { top: true, known: false, index: 12 }
    ]
    const segments = segmentsOfUnknown(tops)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(1)
  })
})

describe('按游戏聚合（inferGame）', () => {
  test('跳过没有排期映射或不参与歪率统计的池（常驻/集录）', () => {
    const res = inferGame({
      game: 'genshin',
      pools: [
        { poolKey: '200', records: [rec('2024-02-05 12:00:00', '迪卢克')] },
        { poolKey: '500', records: [rec('2024-02-05 12:00:00', '刻晴')] },
        { poolKey: '301', records: [rec('2024-02-05 12:00:00', '流浪者')] }
      ],
      banners
    })
    expect(res.inferred).toHaveLength(1)
    expect(res.inferred[0].channel).toBe('character')
  })

  test('绝区零重映池（无排期映射）不参与反推', () => {
    const res = inferGame({
      game: 'nap',
      pools: [{ poolKey: '5', records: [rec('2024-02-05 12:00:00', '艾莲', { rank: '4', itemType: '代理人' })] }],
      banners: []
    })
    expect(res.inferred).toHaveLength(0)
    expect(res.pending).toHaveLength(0)
  })
})

describe('反推结果与判定严谨性', () => {
  test('待人工确认的空 UP 名单不参与判定，仍视为不可判定', () => {
    const pending = {
      channel: 'character',
      start: '2024-02-05 12:00:00',
      end: '2024-02-10 12:00:00',
      up: [],
      up4: []
    }
    const r = isUpAt([pending], 'character', '流浪者', parseLocal('2024-02-06 12:00:00'), '角色')
    expect(r).toEqual({ up: false, known: false })
  })
})

describe('三层合并（mergeBanners 选项）', () => {
  const base = [{
    channel: 'character',
    version: '1.0',
    phase: '上半',
    title: '上半',
    start: '2024-01-01 10:00:00',
    end: '2024-01-20 14:59:59',
    up: ['艾莲'],
    up4: [],
    source: 'builtin'
  }]

  test('overrideUp=false：本地反推不覆盖内置 UP 与来源', () => {
    const incoming = [{
      channel: 'character',
      version: '',
      phase: '',
      title: '本地反推',
      start: '2024-01-01 10:00:00',
      end: '2024-01-20 14:59:59',
      up: ['流浪者'],
      up4: [],
      source: 'local'
    }]
    const merged = mergeBanners(base, incoming, { overrideUp: false, overrideTime: false })
    expect(merged.banners).toHaveLength(1)
    expect(merged.banners[0].up).toEqual(['艾莲'])
    expect(merged.banners[0].source).toBe('builtin')
  })

  test('overrideTime=false：反推层不改动内置结束时间', () => {
    const incoming = [{
      channel: 'character',
      version: '',
      phase: '',
      title: '本地反推',
      start: '2024-01-01 10:00:00',
      end: '2024-01-25 14:59:59',
      up: ['流浪者'],
      up4: [],
      source: 'local'
    }]
    const merged = mergeBanners(base, incoming, { overrideUp: false, overrideTime: false })
    expect(merged.banners[0].end).toBe('2024-01-20 14:59:59')
  })

  test('默认（覆盖层）仍以 incoming 的 UP 为准', () => {
    const incoming = [{
      channel: 'character',
      version: '1.0',
      phase: '上半',
      title: '上半',
      start: '2024-01-01 10:00:00',
      end: '2024-01-20 14:59:59',
      up: ['流浪者'],
      up4: [],
      source: 'manual'
    }]
    const merged = mergeBanners(base, incoming)
    expect(merged.banners[0].up).toEqual(['流浪者'])
    expect(merged.banners[0].source).toBe('manual')
  })
})
