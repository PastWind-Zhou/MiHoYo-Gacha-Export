const { ExcelJS, addWaiwaiSheet, WAIWAI_COLUMNS } = require('./excelWaiwai')
const { buildWaiwaiRows } = require('./waiwaiStats')

const headers = {
  sheet: '歪率分析',
  pool: '卡池',
  included: '参与统计',
  yes: '是',
  no: '否',
  total: '总抽数',
  top: '5星数',
  up: 'UP数',
  lost: '歪数',
  unknown: '不可判定',
  noDeviation: '不歪次数',
  noDeviationRate: '不歪率',
  avgUp: '平均UP抽数',
  avgTop: '平均5星抽数',
  luckiest: '最欧',
  unluckiest: '最非',
  upHitRate: 'UP命中率',
  deviation1: '歪1次',
  deviation2: '歪2次',
  deviation3: '歪3次',
  guaranteed: '大保底数',
  excludedSuffix: '（不参与统计）'
}

const pools = [
  {
    poolKey: '11',
    name: '角色活动跃迁',
    excluded: false,
    stats: {
      total: 2341, topCount: 38, knownCount: 38, upCount: 28, lostCount: 10, unknownCount: 0,
      noDeviationCount: 18, noDeviationRate: 0.6429, avgUpPulls: 83.3, avgTopPulls: 60.78,
      minTopPulls: 1, maxTopPulls: 83, upHitRate: 0.7368,
      deviationHistogram: { 1: 10 }, guaranteedCount: 10
    }
  },
  {
    poolKey: '1',
    name: '常驻跃迁',
    excluded: true,
    stats: {
      total: 722, topCount: 12, knownCount: 0, upCount: 0, lostCount: 0, unknownCount: 12,
      noDeviationCount: 0, noDeviationRate: 0, avgUpPulls: 0, avgTopPulls: 0,
      minTopPulls: 0, maxTopPulls: 0, upHitRate: 0,
      deviationHistogram: {}, guaranteedCount: 0
    }
  }
]

describe('Excel 歪率分析工作表', () => {
  test('列数与顺序符合方案', () => {
    expect(WAIWAI_COLUMNS).toHaveLength(20)
    expect(WAIWAI_COLUMNS[0]).toBe('pool')
    expect(WAIWAI_COLUMNS).toContain('noDeviationRate')
    expect(WAIWAI_COLUMNS).toContain('guaranteed')
  })

  test('工作表名、表头与数据写入正确', () => {
    const rows = buildWaiwaiRows(pools, { yes: headers.yes, no: headers.no, excludedSuffix: headers.excludedSuffix })
    const workbook = new ExcelJS.Workbook()
    const sheet = addWaiwaiSheet(workbook, rows, headers, 'Microsoft YaHei')

    expect(sheet.name).toBe('歪率分析')
    expect(sheet.columns).toHaveLength(20)
    expect(sheet.getRow(1).getCell(1).value).toBe('卡池')
    expect(sheet.getRow(1).getCell(9).value).toBe('不歪率')
    expect(sheet.getRow(2).getCell(1).value).toBe('角色活动跃迁')
    expect(sheet.getRow(2).getCell(2).value).toBe('是')
    expect(sheet.getRow(3).getCell(1).value).toBe('常驻跃迁（不参与统计）')
    expect(sheet.getRow(3).getCell(2).value).toBe('否')
    expect(sheet.getRow(2).getCell(3).value).toBe(2341)
  })

  test('不歪率与 UP 命中率使用百分比格式', () => {
    const rows = buildWaiwaiRows(pools, { yes: headers.yes, no: headers.no })
    const workbook = new ExcelJS.Workbook()
    const sheet = addWaiwaiSheet(workbook, rows, headers, 'Microsoft YaHei')
    // I 列 = noDeviationRate，M 列 = upHitRate
    expect(sheet.getCell('I2').numFmt).toBe('0.00%')
    expect(sheet.getCell("N2").numFmt).toBe('0.00%')
  })

  test('可以正常写出 xlsx', async () => {
    const rows = buildWaiwaiRows(pools, { yes: headers.yes, no: headers.no })
    const workbook = new ExcelJS.Workbook()
    addWaiwaiSheet(workbook, rows, headers, 'Microsoft YaHei')
    const buffer = await workbook.xlsx.writeBuffer()
    expect(buffer.length).toBeGreaterThan(1000)
  })
})

describe('Excel 歪率分析表的连歪列', () => {
  const { buildWaiwaiRows } = require('./waiwaiStats')
  const { WAIWAI_COLUMNS } = require('./excelWaiwai')

  test('列定义包含最大连歪与当前连歪', () => {
    expect(WAIWAI_COLUMNS).toContain('maxDeviationStreak')
    expect(WAIWAI_COLUMNS).toContain('currentDeviationStreak')
  })

  test('行数据输出连歪字段', () => {
    const rows = buildWaiwaiRows([
      {
        poolKey: '11', name: '角色活动跃迁', excluded: false,
        stats: {
          total: 100, topCount: 10, upCount: 8, lostCount: 2, unknownCount: 0,
          noDeviationCount: 6, noDeviationRate: 0.75,
          maxDeviationStreak: 3, currentDeviationStreak: 1,
          deviationHistogram: { 1: 2 }, deviationStreakHistogram: { 2: 1, 3: 1 },
          guaranteedCount: 1
        }
      }
    ], { yes: '是', no: '否' })
    expect(rows[0].maxDeviationStreak).toBe(3)
    expect(rows[0].currentDeviationStreak).toBe(1)
  })

  test('缺字段时补 0', () => {
    const rows = buildWaiwaiRows([{ poolKey: '11', name: 'X', excluded: false, stats: {} }])
    expect(rows[0].maxDeviationStreak).toBe(0)
    expect(rows[0].currentDeviationStreak).toBe(0)
  })
})
