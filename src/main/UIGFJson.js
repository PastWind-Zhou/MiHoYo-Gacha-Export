const { app, ipcMain, dialog } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const { getData, saveData, changeCurrent, convertTimeZone, legacyToRecord } = require('./getData')
const config = require('./config')
const { name, version } = require('../../package.json')
const i18n = require('./i18n')
const { mergeData } = require('./utils/mergeData')
const { sendMsg } = require('./utils')
const { games, idJsons } = require('./games')

const getTimeString = () => {
  return new Date().toLocaleString('sv').replace(/[- :]/g, '').slice(0, -2)
}

const uigfShortLang = new Map([
  ['chs', 'zh-cn'], ['cht', 'zh-tw'], ['de', 'de-de'], ['en', 'en-us'], ['es', 'es-es'],
  ['fr', 'fr-fr'], ['id', 'id-id'], ['jp', 'ja-jp'], ['kr', 'ko-kr'], ['pt', 'pt-pt'],
  ['ru', 'ru-ru'], ['th', 'th-th'], ['vi', 'vi-vn']
])

// 原神 v4.1 导出规则：UID 前缀 6(美服) -5、7(欧服) 1、其余 8
const uidTimeZone = (uid) => {
  const s = `${uid}`
  if (s.startsWith('6')) return -5
  if (s.startsWith('7')) return 1
  return 8
}

// 原神：按名称查 item_id（内置 UIGF 字典）
const genshinItemId = (lang, itemIdName) => {
  const dict = idJsons.genshin[lang] || idJsons.genshin['en-us'] || {}
  return dict[itemIdName] || ''
}

const exportUIGF = async (uids) => {
  const g = games[config.game]
  const { dataMap } = getData()
  const result = {
    info: {
      export_timestamp: Math.ceil(Date.now() / 1000),
      export_app: `${name}`,
      export_app_version: `v${version}`,
      version: 'v4.1'
    }
  }
  const fulldata = []
  uids.forEach(uid => {
    if (dataMap.has(uid)) fulldata.push(dataMap.get(uid))
  })
  if (!fulldata.length) {
    throw new Error('数据为空')
  }
  const accounts = []
  fulldata.forEach(data => {
    const listTemp = []
    for (let [type, arr] of data.result) {
      arr.forEach(log => {
        listTemp.push({
          gacha_id: log.gacha_id || '',
          gacha_type: log.gacha_type,
          item_id: log.item_id || '',
          count: log.count || '1',
          time: log.time,
          name: log.name,
          item_type: log.item_type,
          rank_type: String(log.rank_type),
          id: log.id
        })
      })
    }
    listTemp.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
    // 原神没有本地 item_id，用内置字典按名称补全
    if (g.idMode === 'name') {
      listTemp.forEach(item => {
        if (!item.item_id) {
          item.item_id = genshinItemId(data.lang, item.name)
        }
      })
    }
    accounts.push({
      uid: data.uid,
      timezone: g.uigfTimeZone === 'uid' ? uidTimeZone(data.uid) : data.region_time_zone,
      lang: data.lang,
      list: listTemp
    })
  })
  result[g.uigfKey] = accounts

  const filePath = dialog.showSaveDialogSync({
    defaultPath: path.join(app.getPath('downloads'), accounts.length > 1 ? `UIGF_${getTimeString()}` : `UIGF_${accounts[0].uid}_${getTimeString()}`),
    filters: [
      { name: i18n.uigf.fileType, extensions: ['json'] }
    ]
  })
  if (filePath) {
    const jsonText = JSON.stringify(result, null, config.readableJSON ? '\t' : null)
    await fs.ensureFile(filePath)
    await fs.writeFile(filePath, jsonText)
  }
}

// 读取某游戏目录下的本地数据（用于跨游戏导入）
const loadGameData = async (gameId) => {
  const dir = path.join(require('./utils').userDataPath, gameId)
  await fs.ensureDir(dir)
  const map = new Map()
  const files = await fs.readdir(dir)
  for (const fname of files) {
    if (/^gacha-list-\d+\.json$/.test(fname)) {
      try {
        const d = await fs.readJSON(path.join(dir, fname))
        d.result = new Map(d.result)
        const g = games[gameId]
        d.result.forEach((value, key) => {
          if (g.legacyArray) {
            d.result.set(key, value.map((item, index) => Array.isArray(item) ? legacyToRecord(item, key, index) : item))
          }
        })
        if (d.uid) map.set(d.uid, d)
      } catch (e) {}
    }
  }
  return map
}

// 把一个账号的 UIGF 记录并入指定游戏的本地数据
const parseAccount = async (gameId, uidData) => {
  const g = games[gameId]
  const dataMapForGame = await loadGameData(gameId)
  const isNew = !dataMapForGame.has(uidData.uid)

  let targetLang
  if (!isNew) targetLang = dataMapForGame.get(uidData.uid).lang
  else targetLang = uidData.lang
  if (targetLang && uigfShortLang.has(targetLang)) targetLang = uigfShortLang.get(targetLang)

  let idTarget = null
  if (g.idMode === 'item') {
    idTarget = idJsons[gameId][targetLang] || null
    if (!idTarget && uidData.list[0] && (!uidData.list[0].name || !uidData.list[0].item_type || !uidData.list[0].rank_type)) {
      targetLang = config.lang
      idTarget = idJsons[gameId][targetLang] || null
    }
  }

  let region_time_zone
  if (!isNew) region_time_zone = dataMapForGame.get(uidData.uid).region_time_zone
  else region_time_zone = uidData.timezone

  const resultTemp = []
  uidData.list.forEach(recordEntry => {
    const rec = {
      gacha_id: recordEntry.gacha_id || '',
      gacha_type: recordEntry.gacha_type,
      item_id: recordEntry.item_id || '',
      count: recordEntry.count ?? '1',
      time: recordEntry.time,
      name: recordEntry.name,
      item_type: recordEntry.item_type,
      rank_type: String(recordEntry.rank_type ?? ''),
      id: recordEntry.id
    }
    // 绝区零：导入时把时间转换为本地时区（保持原工具行为）
    if (gameId === 'nap' && Number.isFinite(Number(uidData.timezone)) && Number.isFinite(Number(region_time_zone))) {
      rec.time = convertTimeZone(recordEntry.time, Number(uidData.timezone), Number(region_time_zone))
    }
    // 有物品库的游戏按 item_id 回填名称/类型/星级
    if (g.idMode === 'item' && idTarget && rec.item_id && idTarget[rec.item_id]) {
      const info = idTarget[rec.item_id]
      rec.name = info.name ?? rec.name
      rec.item_type = info.item_type ?? rec.item_type
      rec.rank_type = String(info.rank_type ?? rec.rank_type)
    }
    resultTemp.push(rec)
  })

  // 按 uigf_gacha_type（若有）分组，否则按 gacha_type
  const resultTempGrouped = resultTemp.reduce((acc, curr) => {
    const key = curr.uigf_gacha_type || curr.gacha_type
    const clean = { ...curr }
    delete clean.uigf_gacha_type
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push(clean)
    return acc
  }, {})
  const resultMap = new Map(Object.entries(resultTempGrouped))
  const mergedData = mergeData(dataMapForGame.get(uidData.uid), { result: resultMap, uid: uidData.uid })
  let temp
  if (isNew) {
    temp = { result: mergedData, time: Date.now(), uid: uidData.uid, lang: targetLang, region_time_zone, deleted: false }
  } else {
    const old = dataMapForGame.get(uidData.uid)
    temp = { result: mergedData, time: Date.now(), uid: old.uid, lang: targetLang, region_time_zone: old.region_time_zone, deleted: old.deleted }
  }

  // 落盘到对应游戏目录
  const obj = Object.assign({}, temp)
  obj.result = [...obj.result]
  await fs.outputJSON(path.join(require('./utils').userDataPath, gameId, `gacha-list-${uidData.uid}.json`), obj)
  config.value().currents[gameId] = uidData.uid
  // 当前游戏则同步内存
  if (gameId === config.game) {
    const { dataMap } = getData()
    dataMap.set(uidData.uid, temp)
    await changeCurrent(uidData.uid)
  }
}

const importUIGF = async () => {
  const filepath = dialog.showOpenDialogSync({
    properties: ['openFile'],
    filters: [
      { name: i18n.uigf.fileType, extensions: ['json'] }
    ]
  })
  if (!filepath) return
  try {
    const jsonData = fs.readJsonSync(filepath[0])
    if (jsonData?.info?.version) {
      if (jsonData.info.version !== 'v4.0' && jsonData.info.version !== 'v4.1') {
        sendMsg('不支持此版本UIGF')
        console.error('不支持此版本UIGF')
        return
      }
      for (const key of ['hk4e', 'hkrpg', 'nap']) {
        for (const uidData of (jsonData[key] || [])) {
          await parseAccount(key, uidData)
        }
      }
    } else if (jsonData?.info?.uigf_version === 'v3.0') {
      // 原神 UIGF v3.0 单账号
      await parseAccount('genshin', {
        uid: jsonData.info.uid,
        lang: jsonData.info.lang,
        timezone: jsonData.info.region_time_zone,
        list: jsonData.list || []
      })
    } else if (jsonData?.info?.srgf_version) {
      // SRGF 单账号（星穹铁道）
      await parseAccount('hkrpg', {
        uid: jsonData.info.uid,
        lang: jsonData.info.lang,
        timezone: jsonData.info.region_time_zone,
        list: jsonData.list || []
      })
    } else {
      sendMsg('UIGF格式错误')
      console.error('UIGF格式错误')
      return
    }
    await config.save()
    return {
      dataMap: getData().dataMap,
      current: config.current,
      game: config.game
    }
  } catch (error) {
    sendMsg(error, 'ERROR')
    console.error(error)
  }
}

ipcMain.handle('EXPORT_UIGF_JSON', async (event, uids) => {
  await exportUIGF(uids)
})

ipcMain.handle('IMPORT_UIGF_JSON', async () => {
  return await importUIGF()
})
