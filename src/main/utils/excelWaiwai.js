// Excel「歪率分析」工作表（纯逻辑，独立于 Electron，便于单测与脚本验证）
const ExcelJS = require('../module/exceljs.min.js')

const WAIWAI_COLUMNS = [
  'pool', 'included', 'total', 'top', 'up', 'lost', 'unknown', 'noDeviation',
  'noDeviationRate', 'avgUp', 'avgTop', 'luckiest', 'unluckiest', 'upHitRate',
  'deviation1', 'deviation2', 'deviation3', 'guaranteed'
]

const cellBorder = () => ({
  top: { style: 'thin', color: { argb: 'ffc4c2bf' } },
  left: { style: 'thin', color: { argb: 'ffc4c2bf' } },
  bottom: { style: 'thin', color: { argb: 'ffc4c2bf' } },
  right: { style: 'thin', color: { argb: 'ffc4c2bf' } }
})

// 向 workbook 追加「歪率分析」工作表
// rows 由 utils/waiwaiStats.buildWaiwaiRows 生成
// headers 为 i18n.excel.waiwai 文案
const addWaiwaiSheet = (workbook, rows, headers, customFont) => {
  const sheet = workbook.addWorksheet(headers.sheet, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = WAIWAI_COLUMNS.map((key, index) => ({
    header: headers[key],
    key,
    width: index === 0 ? 26 : 14,
    // ExcelJS 的数字格式必须写在 style 里（写在列定义顶层会被忽略）
    ...(key === 'noDeviationRate' || key === 'upHitRate' ? { style: { numFmt: '0.00%' } } : {})
  }))
  sheet.addRows(rows)

  const letters = 'ABCDEFGHIJKLMNOPQR'.split('')
  letters.forEach((v) => {
    const cell = sheet.getCell(`${v}1`)
    cell.border = cellBorder()
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'ffdbd7d3' }
    }
    cell.font = {
      name: customFont,
      color: { argb: 'ff757575' },
      bold: true
    }
  })
  rows.forEach((row, i) => {
    letters.forEach((c) => {
      const cell = sheet.getCell(`${c}${i + 2}`)
      cell.border = cellBorder()
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'ffebebeb' }
      }
      cell.font = {
        name: customFont,
        color: { argb: row.included === headers.no ? 'ff9a9a9a' : 'ff757575' }
      }
    })
  })
  return sheet
}

module.exports = { ExcelJS, WAIWAI_COLUMNS, addWaiwaiSheet }
