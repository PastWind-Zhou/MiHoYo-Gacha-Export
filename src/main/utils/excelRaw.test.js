// Excel「原始数据」工作表：表名与内容
const path = require('path')
const { addRawSheet, RAW_COLUMNS, rawRow } = require('./excelRaw')
const { ExcelJS } = require('./excelWaiwai')

const makeData = () => ({
  uid: '123456',
  lang: 'zh-cn',
  result: new Map([
    ['301', [
      { id: 'a1', gacha_id: '2001', gacha_type: '301', item_id: '10001', item_type: '角色', name: '刻晴', rank_type: '5', time: '2024-01-05 12:00:00' },
      { id: 'a2', gacha_id: '2001', gacha_type: '301', item_id: '10002', item_type: '角色', name: '七七', rank_type: '4', time: '2024-01-05 12:10:00' }
    ]],
    ['302', [
      { id: 'b1', gacha_id: '3001', gacha_type: '302', item_id: '11301', item_type: '武器', name: '天空之翼', rank_type: '5', time: '2024-02-05 12:00:00' }
    ]]
  ])
})

describe('原始数据工作表', () => {
  test('表名使用传入的名称', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, makeData(), '原始数据')
    expect(wb.worksheets.map((s) => s.name)).toEqual(['原始数据'])
  })

  test('未传表名时回退到「原始数据」', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, makeData())
    expect(wb.worksheets[0].name).toBe('原始数据')
  })

  test('不再使用 rawData 作为表名', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, makeData(), '原始数据')
    expect(wb.worksheets[0].name).not.toBe('rawData')
  })

  test('逐条记录展开成行，列顺序固定', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, makeData(), '原始数据')
    const sheet = wb.worksheets[0]
    // 表头 + 3 条记录
    expect(sheet.rowCount).toBe(4)
    expect(sheet.getRow(1).values.slice(1)).toEqual(RAW_COLUMNS)
  })

  test('记录内容写入正确', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, makeData(), '原始数据')
    const row = wb.worksheets[0].getRow(2).values.slice(1)
    expect(row[0]).toBe('2001')                          // gacha_id
    expect(row[1]).toBe('301')                           // gacha_type
    expect(row[2]).toBe('a1')                            // id
    expect(row[3]).toBe('10001')                         // item_id
    expect(row[4]).toBe('角色')                          // item_type
    expect(row[5]).toBe('zh-cn')                         // lang
    expect(row[6]).toBe('刻晴')                          // name
    expect(row[7]).toBe('5')                             // rank_type
    expect(row[8]).toBe('2024-01-05 12:00:00')          // time
    expect(row[9]).toBe('123456')                        // uid
  })

  test('缺失的可选字段填空串而非 undefined', () => {
    const data = {
      uid: '1',
      lang: 'zh-cn',
      result: new Map([['301', [{ id: 'x', gacha_type: '301', name: 'A', rank_type: '4', time: '2024-01-01 00:00:00' }]]])
    }
    const row = rawRow(data.result.get('301')[0], data)
    expect(row[0]).toBe('')
    expect(row[3]).toBe('')
  })

  test('首行冻结', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, makeData(), '原始数据')
    expect(wb.worksheets[0].views).toEqual([{ state: 'frozen', ySplit: 1 }])
  })

  test('无记录时只写表头', () => {
    const wb = new ExcelJS.Workbook()
    addRawSheet(wb, { uid: '1', lang: 'zh-cn', result: new Map() }, '原始数据')
    expect(wb.worksheets[0].rowCount).toBe(1)
  })
})
