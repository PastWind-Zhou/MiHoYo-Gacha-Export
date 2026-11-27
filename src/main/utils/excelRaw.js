// Excel「原始数据」工作表（纯逻辑，独立于 Electron，便于单测与脚本验证）
//
// 内容是逐条抽卡记录的原始字段（gacha_id / id / item_id / name / time …），
// 供二次分析使用；表名走 i18n（excel.raw.sheet），中文为「原始数据」。

// 表头列顺序：与 UIGF 原始字段保持一致
const RAW_COLUMNS = [
  'gacha_id', 'gacha_type', 'id', 'item_id', 'item_type',
  'lang', 'name', 'rank_type', 'time', 'uid'
]

// 把一条记录转成一行（顺序同 RAW_COLUMNS）
const rawRow = (log, data) => [
  log.gacha_id || '',
  log.gacha_type,
  log.id,
  log.item_id || '',
  log.item_type,
  data.lang,
  log.name,
  log.rank_type,
  log.time,
  data.uid
]

// 追加「原始数据」工作表
const addRawSheet = (workbook, data, sheetName) => {
  const sheet = workbook.addWorksheet(sheetName || '原始数据', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = RAW_COLUMNS.map((key) => ({ header: key, key }))
  const rows = []
  for (const value of data.result.values()) {
    for (const log of value) {
      rows.push(rawRow(log, data))
    }
  }
  sheet.addRows(rows)
  return sheet
}

module.exports = { RAW_COLUMNS, rawRow, addRawSheet }
