const {
  sortByVersionDesc,
  paginate,
  getGameChannels,
  compareVersion,
  versionValue,
  GAME_CHANNELS,
  PAGE_SIZE
} = require('./bannerTable.cjs')

describe('卡池版本排序', () => {
  test('数字版本按数值倒序（最新在前）', () => {
    const rows = [
      { version: '1.0', start: '2020-01-01 00:00:00' },
      { version: '4.7', start: '2026-11-10 15:00:01' },
      { version: '2.10', start: '2024-01-01 00:00:00' },
      { version: '2.9', start: '2023-01-01 00:00:00' }
    ]
    const sorted = sortByVersionDesc(rows)
    expect(sorted.map((r) => r.version)).toEqual(['4.7', '2.10', '2.9', '1.0'])
  })

  test('版本号按段比较而非字符串比较（2.10 > 2.9）', () => {
    expect(compareVersion('2.10', '2.9')).toBeGreaterThan(0)
    expect(compareVersion('2.9', '2.10')).toBeLessThan(0)
  })

  test('同版本内按开始时间倒序', () => {
    const rows = [
      { version: '1.0', start: '2020-01-01 00:00:00' },
      { version: '1.0', start: '2020-09-28 12:00:00' },
      { version: '1.0', start: '2020-05-01 00:00:00' }
    ]
    const sorted = sortByVersionDesc(rows)
    expect(sorted.map((r) => r.start)).toEqual([
      '2020-09-28 12:00:00',
      '2020-05-01 00:00:00',
      '2020-01-01 00:00:00'
    ])
  })

  test('非数字版本（集录祈愿的「月之六」）排在数字版本之后', () => {
    const rows = [
      { version: '月之六', start: '2026-04-28 18:00:00' },
      { version: '7.2', start: '2026-11-24 18:00:00' },
      { version: '月之八', start: '2026-07-01 06:00:00' }
    ]
    const sorted = sortByVersionDesc(rows)
    expect(sorted[0].version).toBe('7.2')
    expect(sorted.slice(1).map((r) => r.version)).toEqual(['月之八', '月之六'])
  })

  test('不修改传入的数组', () => {
    const rows = [{ version: '1.0' }, { version: '2.0' }]
    const copy = rows.slice()
    sortByVersionDesc(rows)
    expect(rows).toEqual(copy)
  })

  test('versionValue 识别数字与非数字版本', () => {
    expect(versionValue('4.7')).toEqual([4, 7])
    expect(versionValue('月之六')).toBeNull()
    expect(versionValue('')).toBeNull()
  })
})

describe('卡池表格分页', () => {
  const rows = Array.from({ length: 236 }, (_, i) => ({ version: '1.0', i }))

  test('每页 10 条', () => {
    expect(PAGE_SIZE).toBe(10)
    expect(paginate(rows, 1, PAGE_SIZE)).toHaveLength(10)
    expect(paginate(rows, 2, PAGE_SIZE)).toHaveLength(10)
  })

  test('首页取前 10 条，第二页取接下来的 10 条', () => {
    const p1 = paginate(rows, 1, PAGE_SIZE)
    const p2 = paginate(rows, 2, PAGE_SIZE)
    expect(p1[0].i).toBe(0)
    expect(p1[9].i).toBe(9)
    expect(p2[0].i).toBe(10)
    expect(p2[9].i).toBe(19)
  })

  test('最后一页取剩余条目', () => {
    const last = paginate(rows, 24, PAGE_SIZE)
    expect(last).toHaveLength(6)
  })

  test('页码越界时返回空数组', () => {
    expect(paginate(rows, 100, PAGE_SIZE)).toHaveLength(0)
  })

  test('页码小于 1 时按第 1 页处理', () => {
    expect(paginate(rows, 0, PAGE_SIZE)[0].i).toBe(0)
    expect(paginate(rows, -3, PAGE_SIZE)[0].i).toBe(0)
  })
})

describe('按游戏区分卡池类型', () => {
  test('原神：角色 / 武器 / 集录祈愿', () => {
    expect(getGameChannels('genshin')).toEqual(['character', 'weapon', 'jilu'])
  })

  test('星铁：角色 / 光锥（不含武器、音擎、集录祈愿）', () => {
    expect(getGameChannels('hkrpg')).toEqual(['character', 'lightcone'])
  })

  test('绝区零：角色 / 音擎（不含武器、光锥、集录祈愿）', () => {
    expect(getGameChannels('nap')).toEqual(['character', 'engine'])
  })

  test('武器只在原神出现，光锥只在星铁，音擎只在绝区零', () => {
    const inGame = (game, ch) => getGameChannels(game).includes(ch)
    expect(inGame('genshin', 'weapon')).toBe(true)
    expect(inGame('hkrpg', 'weapon')).toBe(false)
    expect(inGame('nap', 'weapon')).toBe(false)

    expect(inGame('hkrpg', 'lightcone')).toBe(true)
    expect(inGame('genshin', 'lightcone')).toBe(false)
    expect(inGame('nap', 'lightcone')).toBe(false)

    expect(inGame('nap', 'engine')).toBe(true)
    expect(inGame('genshin', 'engine')).toBe(false)
    expect(inGame('hkrpg', 'engine')).toBe(false)

    expect(inGame('genshin', 'jilu')).toBe(true)
    expect(inGame('hkrpg', 'jilu')).toBe(false)
    expect(inGame('nap', 'jilu')).toBe(false)
  })

  test('未知游戏回退到星铁的通道列表', () => {
    expect(getGameChannels('')).toEqual(GAME_CHANNELS.hkrpg)
    expect(getGameChannels(undefined)).toEqual(GAME_CHANNELS.hkrpg)
  })

  test('与内置数据的 channel 分布一致', () => {
    const fs = require('fs')
    const path = require('path')
    const dir = path.resolve(__dirname, '../gachaBanner')
    const expected = {
      genshin: ['character', 'weapon'],
      hkrpg: ['character', 'lightcone'],
      nap: ['character', 'engine']
    }
    for (const game of Object.keys(expected)) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, `${game}.json`), 'utf8'))
      const actual = [...new Set(data.banners.map((b) => b.channel))].sort()
      expect(actual).toEqual([...expected[game]].sort())
    }
    // 原神另有独立的集录祈愿数据
    const jilu = JSON.parse(fs.readFileSync(path.join(dir, 'genshin-jilu.json'), 'utf8'))
    expect([...new Set(jilu.banners.map((b) => b.channel))]).toEqual(['jilu'])
  })
})
