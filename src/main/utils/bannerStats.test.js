// 卡池同步与判定引擎的单元测试
// 运行: npx jest src/main/utils/bannerStats.test.js
const fs = require('fs')
const path = require('path')

const bannerModule = require('../gachaBanner')

// 内置基线的形状检查（不需要 electron 环境）
const builtinDir = path.resolve(__dirname, '../../gachaBanner')
const games = ['hkrpg', 'genshin', 'nap']

describe('卡池排期数据（内置基线）', () => {
  games.forEach((game) => {
    const set = JSON.parse(fs.readFileSync(path.join(builtinDir, game + '.json'), 'utf8'))

    test(game + ' 数据结构完整', () => {
      expect(Array.isArray(set.banners)).toBe(true)
      expect(set.banners.length).toBeGreaterThan(100)
      expect(set.timezone).toBe('UTC+8')
      expect(typeof set.source).toBe('string')
      expect(set.source.length).toBeGreaterThan(0)
    })

    test(game + ' 每期都有 UP 名单', () => {
      const missing = set.banners.filter((b) => !Array.isArray(b.up) || b.up.length === 0)
      expect(missing.length).toBe(0)
    })

    test(game + ' 每期都有合法时间区间', () => {
      for (const b of set.banners) {
        const s = new Date(b.start.replace(' ', 'T') + '+08:00').getTime()
        const e = new Date(b.end.replace(' ', 'T') + '+08:00').getTime()
        expect(Number.isNaN(s)).toBe(false)
        expect(Number.isNaN(e)).toBe(false)
        expect(e).toBeGreaterThan(s)
      }
    })

    test(game + ' 每期都有版本与卡池类型', () => {
      for (const b of set.banners) {
        expect(typeof b.version).toBe('string')
        expect(b.version.length).toBeGreaterThan(0)
        expect(['character', 'weapon', 'lightcone', 'engine']).toContain(b.channel)
      }
    })

    test(game + ' 每个版本都同时包含角色池与武器池', () => {
      const byVersion = {}
      for (const b of set.banners) {
        byVersion[b.version] = byVersion[b.version] || new Set()
        byVersion[b.version].add(b.channel)
      }
      const wantChannels = { genshin: ['character', 'weapon'], hkrpg: ['character', 'lightcone'], nap: ['character', 'engine'] }[game]
      for (const v of Object.keys(byVersion)) {
        for (const ch of wantChannels) {
          expect(byVersion[v].has(ch)).toBe(true)
        }
      }
    })
  })
})

describe('时间工具', () => {
  test('parseLocal 按 UTC+8 解析', () => {
    const ms = bannerModule.parseLocal('2026-01-01 00:00:00')
    expect(ms).toBe(Date.UTC(2025, 11, 31, 16, 0, 0))
  })

  test('parseLocal 对空值返回 NaN', () => {
    expect(Number.isNaN(bannerModule.parseLocal(''))).toBe(true)
    expect(Number.isNaN(bannerModule.parseLocal(null))).toBe(true)
  })

  test('formatLocal 与 parseLocal 互逆', () => {
    const s = '2026-03-15 08:30:00'
    expect(bannerModule.formatLocal(bannerModule.parseLocal(s))).toBe(s)
  })
})

describe('同步决策（needSync）', () => {
  const banners = [
    { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['A'] },
    { channel: 'character', start: '2026-02-01 00:00:00', end: '2026-03-01 00:00:00', up: ['B'] }
  ]

  test('本地为空 → 全量拉取', () => {
    expect(bannerModule.needSync([]).action).toBe('full')
    expect(bannerModule.needSync(null).action).toBe('full')
  })

  test('当前时间在排期内 → 不同步', () => {
    const now = bannerModule.parseLocal('2026-02-15 00:00:00')
    const d = bannerModule.needSync(banners, now)
    expect(d.action).toBe('none')
    expect(d.reason).toBe('fresh')
  })

  test('当前时间超出排期 → 增量拉取', () => {
    const now = bannerModule.parseLocal('2026-04-01 00:00:00')
    const d = bannerModule.needSync(banners, now)
    expect(d.action).toBe('incremental')
    expect(d.reason).toBe('expired')
  })

  test('恰好等于排期结束时间 → 视为仍覆盖', () => {
    const now = bannerModule.parseLocal('2026-03-01 00:00:00')
    expect(bannerModule.needSync(banners, now).action).toBe('none')
  })
})

describe('合并（mergeBanners）', () => {
  test('新数据补入缺失卡池', () => {
    const base = [{ channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['A'] }]
    const inc = [{ channel: 'character', start: '2026-02-01 00:00:00', end: '2026-03-01 00:00:00', up: ['B'] }]
    const r = bannerModule.mergeBanners(base, inc)
    expect(r.banners.length).toBe(2)
    expect(r.added).toBe(1)
  })

  test('同一卡池 UP 被修正时以新数据为准', () => {
    const base = [{ channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['A'] }]
    const inc = [{ channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['B'] }]
    const r = bannerModule.mergeBanners(base, inc)
    expect(r.banners.length).toBe(1)
    expect(r.banners[0].up).toEqual(['B'])
    expect(r.updated).toBe(1)
  })

  test('完全相同的卡池不产生变更', () => {
    const base = [{ channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['A'] }]
    const r = bannerModule.mergeBanners(base, base)
    expect(r.banners.length).toBe(1)
    expect(r.added).toBe(0)
    expect(r.updated).toBe(0)
  })
})

describe('UP 判定（isUpAt）', () => {
  const banners = [
    { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['希儿'] },
    { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['银狼'] }
  ]

  test('命中 UP 名单', () => {
    const t = bannerModule.parseLocal('2026-01-15 00:00:00')
    expect(bannerModule.isUpAt(banners, 'character', '希儿', t)).toEqual({ up: true, known: true })
  })

  test('同期并行池的另一 UP 也算 UP', () => {
    const t = bannerModule.parseLocal('2026-01-15 00:00:00')
    expect(bannerModule.isUpAt(banners, 'character', '银狼', t)).toEqual({ up: true, known: true })
  })

  test('非 UP 物品判为歪', () => {
    const t = bannerModule.parseLocal('2026-01-15 00:00:00')
    expect(bannerModule.isUpAt(banners, 'character', '布洛妮娅', t)).toEqual({ up: false, known: true })
  })

  test('卡池区间外 → 不可判定', () => {
    const t = bannerModule.parseLocal('2026-05-15 00:00:00')
    expect(bannerModule.isUpAt(banners, 'character', '希儿', t)).toEqual({ up: false, known: false })
  })

  test('名称归一化：忽略「」包裹', () => {
    const b2 = [{ channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['「11号」'] }]
    const t = bannerModule.parseLocal('2026-01-15 00:00:00')
    expect(bannerModule.isUpAt(b2, 'character', '「11号」', t).up).toBe(true)
  })
})

describe('一致性比对（sameBannerSet）', () => {
  const a = [
    { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['A', 'B'] },
    { channel: 'weapon', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['C'] }
  ]

  test('完全一致（顺序不同也算一致）', () => {
    const b = [a[1], a[0]]
    expect(bannerModule.sameBannerSet(a, b)).toBe(true)
  })

  test('UP 名单顺序不同视为一致', () => {
    const b = [{ ...a[0], up: ['B', 'A'] }, a[1]]
    expect(bannerModule.sameBannerSet(a, b)).toBe(true)
  })

  test('期数不同视为不一致', () => {
    expect(bannerModule.sameBannerSet(a, [a[0]])).toBe(false)
  })

  test('UP 名单内容不同视为不一致', () => {
    const b = [{ ...a[0], up: ['A'] }, a[1]]
    expect(bannerModule.sameBannerSet(a, b)).toBe(false)
  })

  test('时间不同视为不一致', () => {
    const b = [{ ...a[0], end: '2026-02-02 00:00:00' }, a[1]]
    expect(bannerModule.sameBannerSet(a, b)).toBe(false)
  })

  test('内置基线与上游 hoyo-gacha 文件一致', () => {
    // 内置基线本身就是从 hoyo-gacha 取的，快照期应完全一致
    for (const game of ['hkrpg', 'genshin', 'nap']) {
      const set = JSON.parse(fs.readFileSync(path.join(builtinDir, game + '.json'), 'utf8'))
      const same = bannerModule.sameBannerSet(
        bannerModule.normalizeSet(set).banners,
        bannerModule.normalizeSet(set).banners
      )
      expect(same).toBe(true)
    }
  })
})

describe('覆盖度哨兵值处理', () => {
  test('9999 年结束的长期卡池不参与覆盖度计算', () => {
    const banners = [
      { channel: 'character', start: '2023-01-01 00:00:00', end: '9999-12-31 23:59:59', up: ['联动'] },
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['A'] }
    ]
    const cov = bannerModule.getCoverage(banners)
    expect(cov.maxEndText).toBe('2026-02-01 00:00:00')
  })

  test('只有长期卡池时视为无有效覆盖', () => {
    const banners = [
      { channel: 'character', start: '2023-01-01 00:00:00', end: '9999-12-31 23:59:59', up: ['联动'] }
    ]
    const cov = bannerModule.getCoverage(banners)
    expect(cov.maxEnd).toBe(0)
    expect(bannerModule.needSync(banners).action).toBe('full')
  })

  test('星铁内置基线的覆盖度不是 9999（联动池不算）', () => {
    const set = JSON.parse(fs.readFileSync(path.join(builtinDir, 'hkrpg.json'), 'utf8'))
    const banners = bannerModule.normalizeSet(set).banners
    const cov = bannerModule.getCoverage(banners)
    expect(cov.maxEndText).not.toContain('9999')
    expect(cov.maxEnd).toBeGreaterThan(0)
  })

  test('内置基线的覆盖度均晚于今天（当前时间仍被覆盖）', () => {
    const now = Date.now()
    for (const game of ['hkrpg', 'genshin', 'nap']) {
      const set = JSON.parse(fs.readFileSync(path.join(builtinDir, game + '.json'), 'utf8'))
      const banners = bannerModule.normalizeSet(set).banners
      const cov = bannerModule.getCoverage(banners)
      expect(cov.maxEnd).toBeGreaterThan(now)
    }
  })
})

describe('不同数据源的秒级差异不应产生重复', () => {
  test('结束时间差 59 秒的同一卡池应正确配对', () => {
    const base = [
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 14:59:59', up: ['A'] }
    ]
    const inc = [
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 14:59:00', up: ['A'] }
    ]
    const r = bannerModule.mergeBanners(base, inc)
    expect(r.banners.length).toBe(1)
    expect(r.added).toBe(0)
  })

  test('同期并行池应各自保留', () => {
    const base = [
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 14:59:59', up: ['A'] },
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 14:59:59', up: ['B'] }
    ]
    const inc = [
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 14:59:00', up: ['A'] },
      { channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 14:59:00', up: ['B'] }
    ]
    const r = bannerModule.mergeBanners(base, inc)
    expect(r.banners.length).toBe(2)
    expect(r.added).toBe(0)
    expect(r.banners.map((b) => b.up[0]).sort()).toEqual(['A', 'B'])
  })

  test('合并内置基线与 wiki 解析结果（原神）不会膨胀', () => {
    // 内置 300 期与 wiki 300 期结构一致，合并后应仍为 300 期
    const set = JSON.parse(fs.readFileSync(path.join(builtinDir, 'genshin.json'), 'utf8'))
    const banners = bannerModule.normalizeSet(set).banners
    const shifted = banners.map((b) => ({ ...b, end: b.end.replace(/59:59$/, '59:00') }))
    const r = bannerModule.mergeBanners(banners, shifted)
    expect(r.banners.length).toBe(banners.length)
    expect(r.added).toBe(0)
  })
})

describe('米游社公告 UP 解析（parseUpsFromPost）', () => {
  const mh = require('../module/mihoyoBanner')

  test('绝区零格式：独立标题行 + 方括号', () => {
    const html = '<p>「答案在风中」调频活动</p><p>活动期间，限定S级代理人[赛维里安(风·强攻)]的调频获取概率将大幅提升！</p>'
    const ups = mh.parseUpsFromPost(html)
    expect(ups.length).toBe(1)
    expect(ups[0].title).toBe('答案在风中')
    expect(ups[0].up).toBe('赛维里安')
    expect(ups[0].category).toBe('代理人')
  })

  test('星铁格式：标题与描述同行 + 书名号', () => {
    const html = '<p>● 「愚戏众星」角色活动跃迁期间，限定5星角色「星神★阿哈（欢愉•量子）」，4星角色「艾丝妲（同谐•火）」「驭空（同谐•虚数）」跃迁成功概率限时提升。</p>'
    const ups = mh.parseUpsFromPost(html)
    expect(ups.length).toBe(1)
    expect(ups[0].title).toBe('愚戏众星')
    expect(ups[0].up).toBe('星神★阿哈')
  })

  test('原神格式：从公告标题取卡池名与 UP', () => {
    const html = '<p>●活动期间，限定5星角色「驹隙隐泉·兹白(岩)」的祈愿获取概率将大幅提升！</p>'
    const ups = mh.parseUpsFromPost(html, '「华黍由仪」祈愿：「驹隙隐泉·兹白(岩)」概率UP！')
    expect(ups.length).toBeGreaterThan(0)
    expect(ups[0].title).toBe('华黍由仪')
    expect(ups[0].up).toBe('驹隙隐泉·兹白')
  })

  test('不应把 4 星角色误判为 UP', () => {
    const html = '<p>● 「愚戏众星」角色活动跃迁期间，限定5星角色「星神★阿哈（欢愉•量子）」，4星角色「艾丝妲（同谐•火）」「驭空（同谐•虚数）」跃迁成功概率限时提升。</p>'
    const ups = mh.parseUpsFromPost(html)
    expect(ups[0].up).not.toBe('驭空')
    expect(ups[0].up).not.toBe('艾丝妲')
  })

  test('卡池类型按品类词判定', () => {
    expect(mh.detectChannel('代理人', '限定S级代理人[赛维里安]')).toBe('character')
    expect(mh.detectChannel('角色', '限定5星角色[希儿]')).toBe('character')
    expect(mh.detectChannel('音擎', '限定S级音擎[禁罪囚笼]')).toBe('engine')
    expect(mh.detectChannel('光锥', '限定5星光锥[当第一声阿哈响起]')).toBe('lightcone')
    expect(mh.detectChannel('武器', '限定5星武器[雾切之回光]')).toBe('weapon')
  })
})

describe('名称引号归一化', () => {
  const banners = [{
    channel: 'lightcone',
    start: '2026-01-01 00:00:00',
    end: '2026-02-01 00:00:00',
    up: ['当第一声「阿哈」响起']
  }]
  const t = bannerModule.parseLocal('2026-01-15 00:00:00')

  test('原样匹配', () => {
    expect(bannerModule.isUpAt(banners, 'lightcone', '当第一声「阿哈」响起', t).up).toBe(true)
  })

  test('米游社的『』写法也能匹配', () => {
    expect(bannerModule.isUpAt(banners, 'lightcone', '当第一声『阿哈』响起', t).up).toBe(true)
  })

  test('无引号写法也能匹配', () => {
    expect(bannerModule.isUpAt(banners, 'lightcone', '当第一声阿哈响起', t).up).toBe(true)
  })

  test('不同物品仍判为歪', () => {
    expect(bannerModule.isUpAt(banners, 'lightcone', '拂晓之前', t).up).toBe(false)
  })

  test('名字中间的引号不影响匹配', () => {
    const b2 = [{ channel: 'character', start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', up: ['「11号」'] }]
    expect(bannerModule.isUpAt(b2, 'character', '「11号」', t).up).toBe(true)
    expect(bannerModule.isUpAt(b2, 'character', '「11」号', t).up).toBe(true)
  })
})

describe('米游社公告解析（扩展）', () => {
  const mh = require('../module/mihoyoBanner')

  test('星铁：同一段内角色池与光锥池分别成条', () => {
    const html = '<p>▌「愚戏众星」「流光定影•当第一声『阿哈』响起」活动跃迁</p>' +
      '<p>● 「愚戏众星」角色活动跃迁期间，限定5星角色「星神★阿哈（欢愉•量子）」，4星角色「驭空」跃迁成功概率限时提升。</p>' +
      '<p>● 「流光定影•当第一声『阿哈』响起」光锥活动跃迁期间，限定5星光锥「当第一声『阿哈』响起（欢愉）」跃迁成功概率限时提升。</p>'
    const ups = mh.parseUpsFromPost(html)
    expect(ups.length).toBe(2)
    expect(ups[0].up).toBe('星神★阿哈')
    expect(ups[0].category).toBe('角色')
    expect(ups[1].up).toBe('当第一声『阿哈』响起')
    expect(ups[1].category).toBe('光锥')
    expect(ups[0].section).toBe(ups[1].section)
  })

  test('绝区零：每个独立标题行自成一段', () => {
    const html = '<p>「答案在风中」调频活动</p><p>活动期间，限定S级代理人[赛维里安(风·强攻)]的调频获取概率将大幅提升！</p>' +
      '<p>「禁罪囚笼」调频活动</p><p>活动期间，限定S级音擎[禁罪囚笼(强攻)]的调频获取概率将大幅提升！</p>'
    const ups = mh.parseUpsFromPost(html)
    expect(ups.length).toBe(2)
    expect(ups[0].title).toBe('答案在风中')
    expect(ups[0].category).toBe('代理人')
    expect(ups[1].title).toBe('禁罪囚笼')
    expect(ups[1].category).toBe('音擎')
    expect(ups[0].section).not.toBe(ups[1].section)
  })

  test('卡池类型判定覆盖四种品类', () => {
    expect(mh.detectChannel('角色', '')).toBe('character')
    expect(mh.detectChannel('代理人', '')).toBe('character')
    expect(mh.detectChannel('光锥', '')).toBe('lightcone')
    expect(mh.detectChannel('武器', '')).toBe('weapon')
    expect(mh.detectChannel('音擎', '')).toBe('engine')
  })
})

describe('原神集录祈愿（jilu 混合池）', () => {
  const jiluSet = JSON.parse(fs.readFileSync(path.join(builtinDir, 'genshin-jilu.json'), 'utf8'))

  test('内置集录数据应包含 8 期且 UP 名单按类型分列', () => {
    expect(jiluSet.banners.length).toBe(8)
    for (const b of jiluSet.banners) {
      expect(b.channel).toBe('jilu')
      expect(b.upByType).toBeDefined()
      expect(Array.isArray(b.upByType.character)).toBe(true)
      expect(Array.isArray(b.upByType.weapon)).toBe(true)
    }
  })

  test('每期开始时间与结束时间都存在', () => {
    for (const b of jiluSet.banners) {
      expect(b.start).toBeTruthy()
      expect(b.end).toBeTruthy()
    }
  })

  test('武器 UP 与角色 UP 不应互相污染', () => {
    const b = jiluSet.banners.find((x) => x.title === '炎天铸名')
    expect(b.upByType.character).toContain('玛拉妮')
    expect(b.upByType.weapon).toContain('冲浪时光')
    expect(b.upByType.weapon).not.toContain('玛拉妮')
    expect(b.upByType.character).not.toContain('冲浪时光')
  })

  test('isUpAt 按 item_type 分别取用 UP 名单', () => {
    const banners = bannerModule.normalizeSet(jiluSet).banners
    const t = bannerModule.parseLocal('2026-11-25 00:00:00')
    expect(bannerModule.isUpAt(banners, 'jilu', '玛拉妮', t, '角色').up).toBe(true)
    expect(bannerModule.isUpAt(banners, 'jilu', '冲浪时光', t, '武器').up).toBe(true)
    expect(bannerModule.isUpAt(banners, 'jilu', '玛拉妮', t, '武器').up).toBe(false)
  })

  test('池 500 映射到 jilu channel 且排除歪率统计', () => {
    expect(bannerModule.poolToChannel('genshin', '500')).toBe('jilu')
    expect(bannerModule.isDeviationExcluded('genshin', '500')).toBe(true)
    expect(bannerModule.isDeviationExcluded('genshin', '301')).toBe(false)
    expect(bannerModule.isDeviationExcluded('genshin', '302')).toBe(false)
  })

  test('常驻/新手池也排除歪率统计', () => {
    expect(bannerModule.isDeviationExcluded('genshin', '200')).toBe(true)
    expect(bannerModule.isDeviationExcluded('genshin', '100')).toBe(true)
    expect(bannerModule.isDeviationExcluded('hkrpg', '1')).toBe(true)
    expect(bannerModule.isDeviationExcluded('nap', '1')).toBe(true)
  })

  test('本地合并后应同时含角色池/武器池/集录池', async () => {
    const all = await bannerModule.getLocalBanners('genshin')
    const chans = new Set(all.banners.map((b) => b.channel))
    expect(chans.has('character')).toBe(true)
    expect(chans.has('weapon')).toBe(true)
    expect(chans.has('jilu')).toBe(true)
    const jilu = all.banners.filter((b) => b.channel === 'jilu')
    expect(jilu.length).toBe(8)
    for (const b of jilu) expect(b.upByType).toBeDefined()
  })

  test('集录期与同版本角色池同期（结束时间一致，开始时间以 wiki 为准）', () => {
    const all = bannerModule.normalizeSet(
      JSON.parse(fs.readFileSync(path.join(builtinDir, 'genshin.json'), 'utf8'))
    ).banners
    for (const j of jiluSet.banners) {
      const same = all.filter((c) => c.channel === 'character' && c.version === j.version && c.phase === j.phase)
      if (!same.length) continue
      // 结束时间只精确到分钟比较（wiki 用 :00，内置用 :59）
      const ends = [...new Set(same.map((c) => c.end.slice(0, 16)))].sort()
      expect(ends).toContain(j.end.slice(0, 16))
      // 开始时间应落在角色池同期区间附近（允许 ±2 天）
      const poolStart = Math.min(...same.map((c) => bannerModule.parseLocal(c.start)))
      const diff = Math.abs(bannerModule.parseLocal(j.start) - poolStart)
      expect(diff).toBeLessThan(2 * 86400000)
    }
  })
})
