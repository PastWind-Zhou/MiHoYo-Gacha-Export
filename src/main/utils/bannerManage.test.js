const {
  validateBannerImport,
  buildManualBanner,
  isSameBanner,
  upsertManualBanner,
  filterRemoteBanners,
  parseUpList
} = require('./bannerManage')

const validBanner = {
  version: '1.0',
  phase: '上半',
  channel: 'character',
  title: '蝶立锋锷',
  start: '2023-04-26 10:00:00',
  end: '2023-05-17 17:59:59',
  up: ['希儿']
}

describe('外部导入校验（validateBannerImport）', () => {
  test('接受标准结构', () => {
    const r = validateBannerImport({ banners: [validBanner] })
    expect(r.ok).toBe(true)
    expect(r.banners).toHaveLength(1)
    expect(r.banners[0].up).toEqual(['希儿'])
    expect(r.banners[0].source).toBe('manual')
  })

  test('缺少 banners 数组直接拒绝', () => {
    expect(validateBannerImport({}).error).toBe('noBanners')
    expect(validateBannerImport(null).error).toBe('notAnObject')
    expect(validateBannerImport([]).error).toBe('notAnObject')
  })

  test('非法条目被跳过并计数', () => {
    const r = validateBannerImport({
      banners: [
        validBanner,
        { channel: '', start: '2023-04-26 10:00:00', end: '2023-05-17 17:59:59' },
        { channel: 'character', start: 'not-a-time', end: '2023-05-17 17:59:59' },
        null
      ]
    })
    expect(r.ok).toBe(true)
    expect(r.banners).toHaveLength(1)
    expect(r.invalid).toBe(3)
  })

  test('全部非法时拒绝导入', () => {
    const r = validateBannerImport({ banners: [{ channel: 'character' }] })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('noValidBanners')
  })

  test('up 字段非数组时按空处理', () => {
    const r = validateBannerImport({ banners: [{ ...validBanner, up: '希儿' }] })
    expect(r.ok).toBe(true)
    expect(r.banners[0].up).toEqual([])
  })
})

describe('手动修正条目（buildManualBanner / upsertManualBanner）', () => {
  test('构造的条目带 manual 来源', () => {
    const entry = buildManualBanner({ ...validBanner, up: ['希儿', '布洛妮娅'] })
    expect(entry.source).toBe('manual')
    expect(entry.up).toEqual(['希儿', '布洛妮娅'])
  })

  test('缺少必要字段时返回 null', () => {
    expect(buildManualBanner({ channel: 'character' })).toBeNull()
    expect(buildManualBanner({})).toBeNull()
  })

  test('同一期重复修正时覆盖而非追加', () => {
    const first = buildManualBanner({ ...validBanner, up: ['希儿'] })
    const second = buildManualBanner({ ...validBanner, up: ['布洛妮娅'] })
    let list = upsertManualBanner([], first)
    expect(list).toHaveLength(1)
    list = upsertManualBanner(list, second)
    expect(list).toHaveLength(1)
    expect(list[0].up).toEqual(['布洛妮娅'])
  })

  test('不同期各自保留', () => {
    const a = buildManualBanner(validBanner)
    const b = buildManualBanner({ ...validBanner, start: '2023-06-01 10:00:00', end: '2023-06-20 17:59:59' })
    const list = upsertManualBanner(upsertManualBanner([], a), b)
    expect(list).toHaveLength(2)
    expect(isSameBanner(a, b)).toBe(false)
  })
})

describe('来源过滤与输入解析', () => {
  test('过滤出远程来源条目', () => {
    const list = [
      { source: 'manual', channel: 'character' },
      { source: 'remote', channel: 'character' },
      { source: 'builtin', channel: 'character' }
    ]
    expect(filterRemoteBanners(list)).toHaveLength(1)
    expect(filterRemoteBanners(list)[0].source).toBe('remote')
  })

  test('UP 名单支持多种分隔符', () => {
    expect(parseUpList('希儿，布洛妮娅、景行;黄泉\n刻晴')).toEqual(['希儿', '布洛妮娅', '景行', '黄泉', '刻晴'])
    expect(parseUpList('')).toEqual([])
  })

  test('手动修正保留原有 4 星 UP 名单', () => {
    const entry = buildManualBanner({ ...validBanner, up4: ['刻晴'], up: ['希儿'] })
    expect(entry.up4).toEqual(['刻晴'])
  })
})

describe('手动修正对判定的影响', () => {
  const { mergeBanners } = require('./bannerMerge')
  const { isUpAt, parseLocal } = require('./bannerJudge')

  const builtin = [{
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

  test('手动修正覆盖内置 UP 并立即生效', () => {
    const manual = [buildManualBanner({
      channel: 'character',
      start: '2024-01-01 10:00:00',
      end: '2024-01-20 14:59:59',
      up: ['流浪者']
    })]
    const merged = mergeBanners(builtin, manual).banners
    expect(merged).toHaveLength(1)
    expect(merged[0].up).toEqual(['流浪者'])
    expect(merged[0].source).toBe('manual')
    const at = parseLocal('2024-01-05 12:00:00')
    expect(isUpAt(merged, 'character', '流浪者', at, '角色').up).toBe(true)
    expect(isUpAt(merged, 'character', '艾莲', at, '角色').up).toBe(false)
  })

  test('changes 只包含增量（覆盖层不应复制整份内置基线）', () => {
    const incoming = [
      { ...builtin[0], up: ['流浪者'], source: 'remote' },
      {
        channel: 'character',
        version: '1.1',
        phase: '上半',
        title: '新一期',
        start: '2024-02-01 10:00:00',
        end: '2024-02-20 14:59:59',
        up: ['刻晴'],
        up4: [],
        source: 'remote'
      }
    ]
    const merged = mergeBanners(builtin, incoming)
    expect(merged.banners).toHaveLength(2)
    expect(merged.changes).toHaveLength(2)
    expect(merged.added).toBe(1)
    expect(merged.updated).toBe(1)
  })

  test('数据无变化时 changes 为空（不写覆盖层）', () => {
    const merged = mergeBanners(builtin, [{ ...builtin[0] }])
    expect(merged.changes).toHaveLength(0)
    expect(merged.added).toBe(0)
    expect(merged.updated).toBe(0)
    expect(merged.banners).toHaveLength(1)
  })
})
