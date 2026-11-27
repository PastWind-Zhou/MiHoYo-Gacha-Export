const { app, ipcMain, dialog } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const { getData, saveData, changeCurrent, convertTimeZone, legacyToRecord } = require('./getData')
const config = require('./config')
const { name, version } = require('../../package.json')
const i18n = require('./i18n')
const { mergeData } = require('./utils/mergeData')
const { sendMsg, userDataPath } = require('./utils')
const { games, idJsons } = require('./games')
const { loadUGCAccounts, saveUGCAccount } = require('./ugcData')
const {
  UIGF_VERSION,
  UIGF_GACHA_TYPES,
  isSupportedV4Version,
  isValidUid,
  isInsideDir,
  normalizeTimezone,
  uidTimeZone,
  makeInfo,
  toUIGFRecord,
  sortByRecordId,
  groupUIGFRecords,
  normalizeUGCAccount,
  validateUIGF42
} = require('./utils/uigf42')

const getTimeString = () => {
  return new Date().toLocaleString('sv').replace(/[- :]/g, '').slice(0, -2)
}

const uigfShortLang = new Map([
  ['chs', 'zh-cn'], ['cht', 'zh-tw'], ['de', 'de-de'], ['en', 'en-us'], ['es', 'es-es'],
  ['fr', 'fr-fr'], ['id', 'id-id'], ['jp', 'ja-jp'], ['kr', 'ko-kr'], ['pt', 'pt-pt'],
  ['ru', 'ru-ru'], ['th', 'th-th'], ['vi', 'vi-vn']
])

// 导出时把工具内部的短语言码还原为 UIGF Schema 要求的完整码
const uigfLang = (lang) => {
  if (!lang) return 'zh-cn'
  for (const [short, full] of uigfShortLang) {
    if (lang === short || lang === full) return full
  }
  return lang
}

// 原神：按名称查 item_id（内置 UIGF 字典）
const genshinItemId = (lang, itemIdName) => {
  const dict = idJsons.genshin[lang] || idJsons.genshin['en-us'] || {}
  // 名称来自导入数据：__proto__/constructor 等原型键会命中原型成员，
  // hasOwnProperty 守卫避免把 Object 构造器当 item_id 写进记录
  if (!Object.prototype.hasOwnProperty.call(dict, itemIdName)) return ''
  return dict[itemIdName] || ''
}

const exportUIGF = async (uids) => {
  const g = games[config.game]
  const { dataMap } = getData()
  const result = {
    info: makeInfo({ appName: name, appVersion: `v${version}` })
  }
  const fulldata = []
  uids.forEach(uid => {
    // 渲染层传过来的 uid 可能是字符串（安全处理后不再是 DOM 里的数字），
    // 这里做一次宽松匹配，避免查不到数据
    if (dataMap.has(uid)) {
      fulldata.push(dataMap.get(uid))
      return
    }
    const num = Number(uid)
    if (Number.isFinite(num) && dataMap.has(num)) {
      fulldata.push(dataMap.get(num))
    }
  })
  if (!fulldata.length) {
    throw new Error('数据为空')
  }
  const accounts = []
  fulldata.forEach(data => {
    const listTemp = []
    for (let [type, arr] of data.result) {
      arr.forEach(log => {
        // 原神没有本地 item_id，用内置字典按名称补全
        const itemId = log.item_id || (g.idMode === 'name' ? genshinItemId(data.lang, log.name) : '')
        listTemp.push(toUIGFRecord({ gameId: config.game, log: { ...log, item_id: itemId } }))
      })
    }
    listTemp.sort(sortByRecordId)
    const timezone = g.uigfTimeZone === 'uid'
      ? uidTimeZone(data.uid)
      : Number(data.region_time_zone)
    accounts.push({
      uid: data.uid,
      timezone: Number.isFinite(timezone) ? timezone : 8,
      lang: uigfLang(data.lang),
      list: listTemp
    })
  })
  result[g.uigfKey] = accounts
  // v4.2 新增段：仅原神导出；无千星奇域数据时留空，不污染其他游戏
  if (config.game === 'genshin') {
    const ugcAccounts = await loadUGCAccounts()
    if (ugcAccounts.length) result.hk4e_ugc = ugcAccounts
  }

  // 按内置官方 Schema 做导出后校验：只提示，不阻塞导出
  const warnings = validateUIGF42(result)
  if (warnings.length) {
    console.warn(`[UIGF ${UIGF_VERSION}] 导出校验提示：`, warnings)
  }

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
  const dir = path.join(userDataPath, gameId)
  await fs.ensureDir(dir)
  const map = new Map()
  const files = await fs.readdir(dir)
  for (const fname of files) {
    if (/^gacha-list-\d+\.json$/.test(fname)) {
      try {
        const d = await fs.readJSON(path.join(dir, fname))
        d.result = new Map(d.result)
        // uid 归一为字符串：旧版数据可能是数字，与导入侧的字符串 uid
        // 不一致时会误判为「新账号」并产生重复文件
        if (d.uid) d.uid = String(d.uid)
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
  // uid 统一按字符串处理：UIGF 里 uid 可能是数字而本地 dataMap 键是字符串，
  // 不归一会造成同账号重复、语言/时区回退错乱
  const uid = String(uidData.uid ?? '').trim()
  // uid 直接参与本地文件名拼接（gacha-list-<uid>.json），非法形态
  // （如 x/../../evil）经 path.join 归一化后会逃出游戏目录，必须拦截
  if (!isValidUid(uid)) {
    throw new Error(`非法 uid: ${uid || '(空)'}`)
  }
  const dataMapForGame = await loadGameData(gameId)
  const isNew = !dataMapForGame.has(uid)

  let targetLang
  if (!isNew) targetLang = dataMapForGame.get(uid).lang
  else targetLang = uidData.lang
  if (targetLang && uigfShortLang.has(targetLang)) targetLang = uigfShortLang.get(targetLang)

  let idTarget = null
  const rawList = Array.isArray(uidData.list) ? uidData.list : []
  if (g.idMode === 'item') {
    idTarget = idJsons[gameId][targetLang] || null
    if (!idTarget && rawList[0] && (!rawList[0].name || !rawList[0].item_type || !rawList[0].rank_type)) {
      targetLang = config.lang
      idTarget = idJsons[gameId][targetLang] || null
    }
  }

  let region_time_zone
  if (!isNew) region_time_zone = dataMapForGame.get(uid).region_time_zone
  else region_time_zone = uidData.timezone

  const resultTemp = []
  rawList.forEach(recordEntry => {
    if (!recordEntry || typeof recordEntry !== 'object') return
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
    // v4.0 起必填：400 与 301 共用保底，导入时按此字段归类
    if (recordEntry.uigf_gacha_type) {
      rec.uigf_gacha_type = String(recordEntry.uigf_gacha_type)
    }
    // 绝区零：导入时把时间转换为本地时区（保持原工具行为）。
    // timezone 为 null/空串时 Number() 会得到 0（伦敦时区），导致整份
    // 记录偏移 8 小时；这里统一归一：缺失按 +8 处理，与 UGC 侧行为一致
    if (gameId === 'nap') {
      const fromTz = normalizeTimezone(uidData.timezone, 8)
      const toTz = normalizeTimezone(region_time_zone, 8)
      rec.time = convertTimeZone(recordEntry.time, fromTz, toTz)
    }
    // 有物品库的游戏按 item_id 回填名称/类型/星级
    // item_id 来自导入数据：constructor/__proto__ 等原型键会命中 Object 的成员，
    // 把角色名改写成 'Object'；只接受字典自有属性（审计低危 14）
    if (g.idMode === 'item' && idTarget && rec.item_id && Object.prototype.hasOwnProperty.call(idTarget, rec.item_id)) {
      const info = idTarget[rec.item_id]
      rec.name = info.name ?? rec.name
      rec.item_type = info.item_type ?? rec.item_type
      rec.rank_type = String(info.rank_type ?? rec.rank_type)
    }
    resultTemp.push(rec)
  })

  // 按 uigf_gacha_type（若有）分组，否则按 gacha_type
  // 只有原神使用 uigf_gacha_type（400 → 301），其余游戏忽略该字段
  const resultTempGrouped = groupUIGFRecords(resultTemp, {
    allowedUigfTypes: gameId === 'genshin' ? UIGF_GACHA_TYPES : []
  })
  const resultMap = new Map(Object.entries(resultTempGrouped))
  const mergedData = mergeData(dataMapForGame.get(uid), { result: resultMap, uid })
  let temp
  if (isNew) {
    temp = { result: mergedData, time: Date.now(), uid, lang: targetLang, region_time_zone, deleted: false }
  } else {
    const old = dataMapForGame.get(uid)
    temp = { result: mergedData, time: Date.now(), uid: old.uid, lang: targetLang, region_time_zone: old.region_time_zone, deleted: old.deleted }
  }

  // 落盘到对应游戏目录（uid 已过校验，这里再确认路径仍在游戏目录内）
  const gameDir = path.join(userDataPath, gameId)
  const target = path.join(gameDir, `gacha-list-${uid}.json`)
  if (!isInsideDir(gameDir, target)) {
    throw new Error('非法落盘路径')
  }
  const obj = Object.assign({}, temp)
  obj.result = [...obj.result]
  await fs.outputJSON(target, obj)
  config.value().currents[gameId] = uid
  // 当前游戏则同步内存
  if (gameId === config.game) {
    const { dataMap } = getData()
    // 历史内存数据可能是数字键，同账号会出现重复，导入前清掉数字形态的旧键
    dataMap.delete(Number(uid))
    dataMap.set(uid, temp)
    await changeCurrent(uid)
  }
}

const importUIGF = async () => {
  // 等配置加载完成：config.game 决定导入到哪个游戏
  await config.ready
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
      if (!isSupportedV4Version(jsonData.info.version)) {
        sendMsg('不支持此版本UIGF')
        console.error('不支持此版本UIGF')
        return
      }
      // UIGF 的游戏键 → 本工具内部游戏 id
      // 原神的 UIGF 键是 hk4e，内部 id 是 genshin（games.js 里 uigfKey: 'hk4e'），
      // 直接把 hk4e 当内部 id 用会取到 undefined 的游戏配置而抛错
      const uigfGameMap = { hk4e: 'genshin', hkrpg: 'hkrpg', nap: 'nap' }
      for (const key of ['hk4e', 'hkrpg', 'nap']) {
        const gameId = uigfGameMap[key] || key
        const accounts = Array.isArray(jsonData[key]) ? jsonData[key] : []
        for (const uidData of accounts) {
          if (!uidData || typeof uidData !== 'object') continue
          try {
            await parseAccount(gameId, uidData)
          } catch (e) {
            // 单个账号异常不应中断整个导入
            console.error('UIGF 账号导入失败:', key, e && e.message)
            sendMsg(`UIGF ${key} 账号导入失败: ${e && e.message}`, 'ERROR')
          }
        }
      }
      // v4.2 新增 hk4e_ugc：透传保存到原神目录，不混入常规卡池。
      // 单个账号异常（如非法 uid）不应中断整个导入
      for (const ugcAccount of (jsonData.hk4e_ugc || [])) {
        try {
          const normalized = normalizeUGCAccount(ugcAccount)
          if (normalized) await saveUGCAccount(normalized)
        } catch (e) {
          console.error('UIGF hk4e_ugc 账号导入失败:', e && e.message)
          sendMsg(`UIGF hk4e_ugc 账号导入失败: ${e && e.message}`, 'ERROR')
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
