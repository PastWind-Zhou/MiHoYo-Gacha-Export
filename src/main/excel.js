const ExcelJS = require('./module/exceljs.min.js')
const getData = require('./getData').getData
const { app, ipcMain, dialog } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const i18n = require('./i18n')
const config = require('./config')
const { games, getGachaTypes, getGameInfo } = require('./games')

function pad(num) {
  return `${num}`.padStart(2, "0");
}

function getTimeString() {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}${MM}${DD}_${HH}${mm}${ss}`;
}

const addRawSheet = (workbook, data) => {
  const sheet = workbook.addWorksheet('rawData', {views: [{state: 'frozen', ySplit: 1}]})
  const excelKeys = ['gacha_id', 'gacha_type', 'id', 'item_id', 'item_type', 'lang', 'name', 'rank_type', 'time', 'uid']
  sheet.columns = excelKeys.map((key, index) => {
    return {
      header: key,
      key,
    }
  })
  const temp = []
  for (let [key, value] of data.result) {
    for (let log of value){
      const arr = []
      arr.push(log.gacha_id || '')
      arr.push(log.gacha_type)
      arr.push(log.id)
      arr.push(log.item_id || '')
      arr.push(log.item_type)
      arr.push(data.lang)
      arr.push(log.name)
      arr.push(log.rank_type)
      arr.push(log.time)
      arr.push(data.uid)
      temp.push(arr)
    }
  }
  sheet.addRows(temp)
}

const start = async () => {
  const g = games[config.game]
  const { header, customFont, filePrefix, fileType } = i18n.excel
  const { dataMap, current } = getData()
  const data = dataMap.get(current)
  const typeList = getGachaTypes(config.game, data.lang)
  const gameInfo = getGameInfo(config.game, data.lang)
  // 星级文案按游戏取（星铁/原神 3-4-5 星，绝区零 B-A-S 级）
  const rankLabel = (rank) => {
    const r = String(rank)
    const levels = gameInfo.rankLevels
    const key = r === levels.five ? 'star5' : r === levels.four ? 'star4' : 'star3'
    return i18n.ui.data[key] || r
  }
  // 低/中/高星颜色：灰 / 紫 / 橙
  const rankColor = {
    [g.ranks.low]: 'ff8e8e8e',
    [g.ranks.mid]: 'ffa256e1',
    [g.ranks.top]: 'ffbd6932',
  }
  // https://github.com/sunfkny/genshin-gacha-export-js/blob/main/index.js
  const workbook = new ExcelJS.Workbook()
  for (let [key, value] of data.result) {
    const name = typeList.find(item => item.key === key)?.name
    const sheet = workbook.addWorksheet((name || key).replace(/[*?:\/\\]/g, ' '), {views: [{state: 'frozen', ySplit: 1}]})
    let width = [24, 14, 8, 8, 8, 8, 8]
    if (!data.lang.includes('zh-')) {
      width = [24, 32, 16, 12, 12, 12, 8]
    }
    const excelKeys = ['time', 'name', 'type', 'rank', 'total', 'pity', 'remark']
    sheet.columns = excelKeys.map((key, index) => {
      return {
        header: header[key],
        key,
        width: width[index]
      }
    })
    // get gacha logs
    const logs = value
    let total = 0
    let pity = 0
    const temp = []
    for (let log of logs) {
      const arr = []
      total += 1
      pity += 1
      arr.push(log.time)
      arr.push(log.name)
      arr.push(log.item_type)
      arr.push(rankLabel(String(log.rank_type)))
      arr.push(total)
      arr.push(pity)
      temp.push(arr)
      if (String(log.rank_type) === g.ranks.top) {
        pity = 0
      }
    }

    sheet.addRows(temp)
    // set xlsx hearer style
    ;(["A", "B", "C", "D","E","F", "G"]).forEach((v) => {
      sheet.getCell(`${v}1`).border = {
        top: {style:'thin', color: {argb:'ffc4c2bf'}},
        left: {style:'thin', color: {argb:'ffc4c2bf'}},
        bottom: {style:'thin', color: {argb:'ffc4c2bf'}},
        right: {style:'thin', color: {argb:'ffc4c2bf'}}
      }
      sheet.getCell(`${v}1`).fill = {
        type: 'pattern',
        pattern:'solid',
        fgColor:{argb:'ffdbd7d3'},
      }
      sheet.getCell(`${v}1`).font ={
        name: customFont,
        color: { argb: "ff757575" },
        bold : true
      }

    })
    // set xlsx cell style
    logs.forEach((v, i) => {
      ;(["A", "B", "C", "D","E","F", "G"]).forEach((c) => {
        sheet.getCell(`${c}${i + 2}`).border = {
          top: {style:'thin', color: {argb:'ffc4c2bf'}},
          left: {style:'thin', color: {argb:'ffc4c2bf'}},
          bottom: {style:'thin', color: {argb:'ffc4c2bf'}},
          right: {style:'thin', color: {argb:'ffc4c2bf'}}
        }
        sheet.getCell(`${c}${i + 2}`).fill = {
          type: 'pattern',
          pattern:'solid',
          fgColor:{argb:'ffebebeb'},
        }
        sheet.getCell(`${c}${i + 2}`).font = {
          name: customFont,
          color: { argb: rankColor[String(v.rank_type)] },
          bold : String(v.rank_type) !== g.ranks.low
        }
      })
    })
  }

  addRawSheet(workbook, data)

  const buffer = await workbook.xlsx.writeBuffer()
  const filePath = dialog.showSaveDialogSync({
    defaultPath: path.join(app.getPath('downloads'), `${filePrefix}_${getTimeString()}`),
    filters: [
      { name: fileType, extensions: ['xlsx'] }
    ]
  })
  if (filePath) {
    await fs.ensureFile(filePath)
    await fs.writeFile(filePath, buffer)
  }
}

ipcMain.handle('SAVE_EXCEL', async () => {
  await start()
})
