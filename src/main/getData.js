const fs = require('fs-extra')
const util = require('util')
const path = require('path')
const { URL } = require('url')
const { app, ipcMain, shell } = require('electron')
const { sleep, request, sendMsg, readJSON, saveJSON, detectLocale, getCacheText, userDataPath, userPath, localIp, langMap } = require('./utils')
const config = require('./config')
const i18n = require('./i18n')
const { enableProxy, disableProxy } = require('./module/system-proxy')
const mitmproxy = require('./module/node-mitmproxy')
const { mergeData } = require('./utils/mergeData')
const { games, isValidGame, getGachaTypes, getGameInfo } = require('./games')

const dataMap = new Map()
let apiDomain = ''
let cacheFolder = null

const game = () => games[config.game]
const gameDataPath = () => path.join(userDataPath, config.game)

const convertTimeZone = (dateTimeStr, fromTimeZoneOffset, toTimeZoneOffset) => {
  let date = new Date(dateTimeStr.replace(' ', 'T') + 'Z')
  let utcDate = new Date(date.getTime() - fromTimeZoneOffset * 60 * 60 * 1000)
  let targetDate = new Date(utcDate.getTime() + toTimeZoneOffset * 60 * 60 * 1000)
  let year = targetDate.getUTCFullYear()
  let month = String(targetDate.getUTCMonth() + 1).padStart(2, '0')
  let day = String(targetDate.getUTCDate()).padStart(2, '0')
  let hours = String(targetDate.getUTCHours()).padStart(2, '0')
  let minutes = String(targetDate.getUTCMinutes()).padStart(2, '0')
  let seconds = String(targetDate.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

// 统一记录结构：{ id, item_id, item_type, name, rank_type, time, gacha_id, gacha_type, count }
const normalizeRecord = (item) => {
  return {
    id: item.id,
    item_id: item.item_id || '',
    item_type: item.item_type,
    name: item.name,
    rank_type: String(item.rank_type),
    time: item.time,
    gacha_id: item.gacha_id || '',
    gacha_type: item.gacha_type,
    count: item.count || '1'
  }
}

// 原神旧版本地数据是数组格式：
//   6 元素 [time, name, item_type, rank, gacha_type, id]
//   4 元素 [time, name, item_type, rank]（更早的版本，没有 id）
const legacyToRecord = (arr, poolKey = '', index = 0) => {
  const hasId = arr.length >= 6 && arr[5]
  const time = arr[0]
  let id = ''
  if (hasId) {
    id = String(arr[5])
  } else {
    // 生成 19 位数字伪 id（秒级时间戳 + 名称哈希 + 池内序号），保证可排序、唯一
    const ts = Math.floor(new Date(String(time).replace(' ', 'T') + 'Z').getTime() / 1000) || 0
    const h = Math.abs(hashCode(tnOfLegacy(arr, poolKey))) % 1000
    id = String(ts).padStart(10, '0') + String(h).padStart(3, '0') + String(index % 1000000).padStart(6, '0')
  }
  return {
    id,
    item_id: '',
    item_type: arr[2],
    name: arr[1],
    rank_type: String(arr[3]),
    time,
    gacha_id: '',
    gacha_type: hasId ? String(arr[4]) : String(poolKey || ''),
    count: '1'
  }
}

const tnOfLegacy = (arr, poolKey) => `${arr[0] || ''}|${arr[1] || ''}|${arr[2] || ''}|${poolKey || ''}`

const hashCode = (str) => {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return h
}

const saveData = async (data) => {
  const obj = Object.assign({}, data)
  obj.result = [...obj.result]
  await config.save()
  await saveJSON(path.join(config.game, `gacha-list-${data.uid}.json`), obj)
}

const serverTimeZoneOf = (region) => {
  const tz = game().serverTimeZone
  return tz ? tz.get(region) : undefined
}

const findDataFiles = async (dataPath, fileMap) => {
  const files = await readdir(dataPath)
  if (files?.length) {
    for (let name of files) {
      if (/^gacha-list-\d+\.json$/.test(name) && !fileMap.has(name)) {
        fileMap.set(name, dataPath)
      }
    }
  }
}

let localDataReaded = false
const readdir = util.promisify(fs.readdir)
const readData = async (force = false) => {
  if (localDataReaded && !force) return
  // 必须等配置加载完成：此时 config.game 才是用户实际选择的游戏。
  // 否则会用默认的 'hkrpg' 去读目录，把别的游戏的记录装进 dataMap。
  await config.ready
  localDataReaded = true
  const g = game()
  const dataPath = gameDataPath()
  await fs.ensureDir(dataPath)
  const fileMap = new Map()
  await findDataFiles(dataPath, fileMap)
  for (let [name, dirPath] of fileMap) {
    try {
      const data = await readJSON(dirPath, name)
      data.result = new Map(data.result)
      data.result.forEach((value, key) => {
        const arr = value.map((item, index) => {
          const rec = (Array.isArray(item) && g.legacyArray) ? legacyToRecord(item, key, index) : item
          if (!('count' in rec)) rec.count = '1'
          if (rec.rank_type !== undefined) rec.rank_type = String(rec.rank_type)
          return rec
        })
        data.result.set(key, arr)
      })
      if (data.uid) {
        // 旧数据没有有效更新时间时，按导入时间处理
        if (!data.time || !Number.isFinite(Number(data.time))) {
          data.time = Date.now()
        }
        dataMap.set(data.uid, data)
      }
    } catch (e) {
      sendMsg(e, 'ERROR')
    }
  }
  if ((!config.current && dataMap.size) || (config.current && dataMap.size && !dataMap.has(config.current))) {
    await changeCurrent(dataMap.keys().next().value)
  }
}

const deleteData = async (uid, action) => {
  const data = dataMap.get(uid)
  if (data) {
    data.deleted = action
    await saveData(data)
  }
}

const changeCurrent = async (uid) => {
  // 只接受当前游戏、且确实存在于 dataMap 的 uid。
  // 否则会把别的游戏的 uid 写进 currents[game]，导致
  // dataMap.get(current) 取到错误游戏的记录。
  if (uid === undefined || uid === null || uid === '') return
  if (!dataMap.has(uid)) return
  config.setCurrent(uid)
  await config.save()
}

const detectGameLocale = async (userPath) => {
  const g = game()
  let list = []
  const lang = app.getLocale()
  g.logDirs.forEach(str => {
    try {
      const pathname = path.join(userPath, '/AppData/LocalLow/', str, g.logFile)
      fs.accessSync(pathname, fs.constants.F_OK)
      list.push(pathname)
    } catch (e) {}
  })
  // 原神云游戏日志
  if (g.cloudLog) {
    try {
      const pathname = path.join(userPath, g.cloudLog)
      fs.accessSync(pathname, fs.constants.F_OK)
      list.push('cloud')
    } catch (e) {}
  }
  if (config.logType) {
    if (config.logType === 2) {
      list.reverse()
    }
    list = list.slice(0, 1)
  } else if (lang !== 'zh-CN') {
    const localGames = list.filter(item => item !== 'cloud')
    const cloud = list.find(item => item === 'cloud')
    if (localGames.length) {
      localGames.reverse()
      list = cloud ? [...localGames, cloud] : localGames
    }
  }
  return list
}

const getLatestUrl = (list) => {
  return list[list.length - 1]
}

const readLog = async () => {
  // 日志路径与 API 域名都依赖 config.game，
  // 必须等配置加载完成，否则会去读默认游戏的日志
  await config.ready
  const g = game()
  const text = i18n.log
  try {
    let userPath
    if (!process.env.WINEPREFIX) {
      userPath = app.getPath('home')
    } else {
      userPath = path.join(process.env.WINEPREFIX, 'drive_c/users', process.env.USER)
    }
    const logPaths = await detectGameLocale(userPath)
    if (!logPaths.length) {
      sendMsg(text.file.notFound)
      return false
    }
    const promises = logPaths.map(async logpath => {
      if (logpath === 'cloud') {
        const cacheText = await fs.readFile(path.join(userPath, g.cloudLog), 'utf8')
        const urlMch = cacheText.match(g.logUrlRegex)
        if (urlMch) {
          return getLatestUrl(urlMch)
        }
        return
      }
      const logText = await fs.readFile(logpath, 'utf8')
      // 绝区零新版日志中直接带有完整 URL
      if (g.logUrlFast) {
        const fast = logText.match(g.logUrlFast)
        if (fast) {
          return getLatestUrl(fast)
        }
      }
      const gamePathMch = logText.match(g.dataDirRes)
      if (gamePathMch) {
        const [cacheText, cacheFile] = await getCacheText(gamePathMch[0] + g.dataDirAppend)
        const urlMch = cacheText.match(g.logUrlRegex)
        if (urlMch) {
          cacheFolder = cacheFile.replace(/Cache_Data[/\\]data_2$/, '')
          return getLatestUrl(urlMch)
        }
      }
    })
    const result = await Promise.all(promises)
    for (let url of result) {
      if (url) {
        return url
      }
    }
    sendMsg(text.url.notFound)
    return false
  } catch (e) {
    sendMsg(text.file.readFailed)
    return false
  }
}

const getGachaLog = async ({ key, page, name, retryCount, url, endId }) => {
  const text = i18n.log
  const g = game()
  try {
    const res = await request(`${url}&${g.typeParam}=${key}&page=${page}&size=${20}${endId ? '&end_id=' + endId : ''}`)
    if (res?.data?.list) {
      return res?.data
    }
    // -110: 请求过于频繁（限流），退避后重试
    if (res?.retcode === -110) {
      const err = new Error(res?.message || 'visit too frequently')
      err.rateLimited = true
      throw err
    }
    throw new Error(res?.message || res)
  } catch (e) {
    if (retryCount) {
      sendMsg(i18n.parse(text.fetch.retry, { name, page, count: 6 - retryCount }))
      await sleep(e.rateLimited ? 10 : 5)
      retryCount--
      return await getGachaLog({ key, page, name, retryCount, url, endId })
    } else {
      sendMsg(i18n.parse(text.fetch.retryFailed, { name, page }))
      throw e
    }
  }
}

const getGachaLogs = async ({ name, key }, queryString) => {
  const g = game()
  const text = i18n.log
  let page = 1
  let list = []
  let res = null
  let logs = []
  let uid = ''
  let region = ''
  let region_time_zone = ''
  let endId = '0'
  const url = `${apiDomain}${g.apiBase}${g.endpointFor(key)}?${queryString}`
  do {
    await sleep(g.pageDelay ?? 0.3)
    if (g.pageInterval && page % g.pageInterval === 0) {
      sendMsg(i18n.parse(text.fetch.interval, { name, page }))
      await sleep(1)
    }
    sendMsg(i18n.parse(text.fetch.current, { name, page }))
    res = await getGachaLog({ key, page, name, url, endId, retryCount: 5 })
    logs = res?.list || []
    if (!uid && logs.length) {
      uid = logs[0].uid
    }
    if (!region) {
      region = res.region
    }
    if (!region_time_zone) {
      region_time_zone = res.region_time_zone
    }
    list.push(...logs)
    page += 1

    if (logs.length) {
      endId = logs[logs.length - 1].id
    }

    if (!config.fetchFullHistory && logs.length && uid && dataMap.has(uid)) {
      const result = dataMap.get(uid).result
      if (result.has(key)) {
        const arr = result.get(key)
        if (arr.length) {
          const localLatestId = arr[arr.length - 1].id
          if (localLatestId) {
            let shouldBreak = false
            logs.forEach(item => {
              if (item.id === localLatestId) {
                shouldBreak = true
              }
            })
            if (shouldBreak) {
              break
            }
          }
        }
      }
    }
  } while (logs.length > 0)
  return { list, uid, region, region_time_zone }
}

const checkResStatus = (res) => {
  const text = i18n.log
  if (res.retcode !== 0) {
    let message = res.message
    if (res.message === 'authkey timeout') {
      message = text.fetch.authTimeout
      sendMsg(true, 'AUTHKEY_TIMEOUT')
    }
    sendMsg(message)
    throw new Error(message)
  }
  sendMsg(false, 'AUTHKEY_TIMEOUT')
  return res
}

const tryGetUid = async (queryString) => {
  const g = game()
  const url = `${apiDomain}${g.apiBase}${g.endpointFor(g.typeOrder[0])}?${queryString}`
  try {
    for (let key of g.typeOrder) {
      const res = await request(`${url}&${g.typeParam}=${key}&page=1&size=6`)
      if (res.data.list && res.data.list.length) {
        return res.data.list[0].uid
      }
    }
  } catch (e) {}
  return config.current
}

const fixAuthkey = (url) => {
  const mr = url.match(/authkey=([^&]+)/)
  if (mr && mr[1] && mr[1].includes('=') && !mr[1].includes('%')) {
    return url.replace(/authkey=([^&]+)/, `authkey=${encodeURIComponent(mr[1])}`)
  }
  return url
}

const getQuerystring = (url) => {
  const g = game()
  const text = i18n.log
  const { searchParams, host } = new URL(fixAuthkey(url))
  const isOS = g.osHostHints.some(hint => host.includes(hint))
  apiDomain = isOS ? g.domainOS : g.domainCN
  const authkey = searchParams.get('authkey')
  if (!authkey) {
    sendMsg(text.url.lackAuth)
    return false
  }
  searchParams.delete('page')
  searchParams.delete('size')
  searchParams.delete(g.typeParam)
  searchParams.delete('end_id')
  return searchParams
}

// 启动 MITM 代理并等待捕获到带 authkey 的请求 URL
// 旧实现只有一个 resolve 且永不超时：用户不触发请求时会永久挂起
const proxyServer = (port, timeout = 120000) => {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(value)
    }
    timer = setTimeout(() => {
      finish(reject, new Error('proxy-timeout'))
    }, timeout)
    try {
      mitmproxy.createProxy({
        sslConnectInterceptor: (req, cltSocket, head) => {
          if (/webstatic([^\.]{2,10})?\.(mihoyo|hoyoverse)\.com/.test(req.url)) {
            return true
          }
        },
        requestInterceptor: (rOptions, req, res, ssl, next) => {
          next()
          if (/webstatic([^\.]{2,10})?\.(mihoyo|hoyoverse)\.com/.test(rOptions.hostname)) {
            if (/authkey=[^&]+/.test(rOptions.path)) {
              finish(resolve, `${rOptions.protocol}//${rOptions.hostname}${rOptions.path}`)
            }
          }
        },
        responseInterceptor: (req, res, proxyReq, proxyRes, ssl, next) => {
          next()
        },
        getPath: () => path.join(userPath, 'node-mitmproxy'),
        port
      })
    } catch (e) {
      finish(reject, e)
    }
  })
}

// 使用代理抓取 URL
// 每次都新建代理 Promise：authkey 会过期，复用上一次的 Promise 会拿到旧链接
const useProxy = async () => {
  const text = i18n.log
  const ip = localIp()
  const port = config.proxyPort
  sendMsg(i18n.parse(text.proxy.hint, { ip, port }))
  await enableProxy('127.0.0.1', port)
  try {
    return await proxyServer(port)
  } catch (e) {
    if (e && e.message === 'proxy-timeout') {
      throw new Error('proxy-timeout')
    }
    throw e
  } finally {
    // 无论成功失败都要关闭系统代理，否则用户网络被劫持
    await disableProxy()
  }
}

const tryRequest = async (url, retry = false) => {
  const g = game()
  const queryString = getQuerystring(url)
  if (!queryString) return false
  let probeUrl
  if (g.probeType === null) {
    // 原神：用 getConfigList 校验 authkey
    probeUrl = `${apiDomain}${g.apiBase}getConfigList?${queryString}`
  } else {
    probeUrl = `${apiDomain}${g.apiBase}${g.endpointFor(g.probeType)}?${queryString}&page=1&size=5&${g.typeParam}=${g.probeType}&end_id=0`
  }
  try {
    const res = await request(probeUrl)
    checkResStatus(res)
  } catch (e) {
    if (e.code === 'ERR_PROXY_CONNECTION_FAILED' && !retry) {
      await disableProxy()
      return await tryRequest(url, true)
    }
    sendMsg(e.message.replace(url, '***'), 'ERROR')
    throw e
  }
}

const getUrl = async () => {
  let url = await readLog()
  if (!url && config.proxyMode) {
    url = await useProxy()
  }
  return url
}

const getApiUrl = async () => {
  const url = await getUrl()
  if (!url) return null
  const queryString = getQuerystring(url)
  if (!queryString) return null
  return `${apiDomain}${game().apiBase}${game().endpointFor(game().typeOrder[0])}?${queryString.toString()}`
}

const fetchData = async (urlOverride) => {
  const text = i18n.log
  // 先读数据（内部会等配置加载完成），再取游戏配置：
  // game() 依赖 config.game，配置未加载完时拿到的是默认游戏
  await readData()
  const g = game()
  let url = urlOverride
  if (!url) {
    url = await getUrl()
  }
  if (!url) {
    const message = text.url.notFound2
    sendMsg(message)
    throw new Error(message)
  }

  await tryRequest(url)

  const searchParams = getQuerystring(url)
  if (!searchParams) {
    const message = text.url.incorrect
    sendMsg(message)
    throw new Error(message)
  }
  let queryString = searchParams.toString()
  const vUid = await tryGetUid(queryString)
  let localLang = dataMap.has(vUid) ? dataMap.get(vUid).lang : ''
  if (localLang) {
    if (g.langFix && !localLang.startsWith('zh-')) {
      localLang = localLang.replace(/-\w+$/, '')
    }
    searchParams.set('lang', localLang)
  }
  queryString = searchParams.toString()
  const gachaType = getGachaTypes(config.game, searchParams.get('lang'))

  const result = new Map()
  const lang = searchParams.get('lang')
  let originUid = ''
  let originRegion = ''
  let localTimeZone
  for (const type of gachaType) {
    let poolRes
    try {
      poolRes = await getGachaLogs(type, queryString)
    } catch (e) {
      // 单个卡池失败（限流等）不中断整体，继续处理其它卡池
      sendMsg(`${type.name}: ${e.message}`)
      console.error(e)
      continue
    }
    const { list, uid, region, region_time_zone } = poolRes
    if (g.serverTimeZone) {
      const tz = serverTimeZoneOf(region)
      if (!tz) {
        sendMsg('不支持此服务器')
        throw new Error('unsupported server region')
      }
      if (localTimeZone === undefined) {
        localTimeZone = dataMap.get(uid)?.region_time_zone
        if (localTimeZone === undefined) {
          localTimeZone = tz
        }
      }
      if (g.convertTime) {
        list.forEach(item => {
          item.time = convertTimeZone(item.time, tz, localTimeZone)
        })
      }
    } else if (localTimeZone === undefined) {
      localTimeZone = dataMap.get(uid)?.region_time_zone
      if (localTimeZone === undefined) {
        localTimeZone = region_time_zone
      }
    }
    const logs = list.map(normalizeRecord)
    logs.reverse()
    result.set(type.key, logs)
    if (!originUid) {
      originUid = uid
    }
    if (!originRegion) {
      originRegion = region
    }
  }
  if (!result.size) {
    const message = '获取数据失败，请稍后重试'
    sendMsg(message, 'ERROR')
    throw new Error(message)
  }
  const data = { result, time: Date.now(), uid: originUid, lang, region: originRegion, region_time_zone: localTimeZone, deleted: false }
  const localData = dataMap.get(originUid)
  const mergedResult = mergeData(localData, data)
  data.result = mergedResult
  dataMap.set(originUid, data)
  await changeCurrent(originUid)
  await saveData(data)
}

// 代理抓取：用 Promise 记录进行中的请求，既避免并发重复启动代理，
// 又能在失败后正常重试（旧实现用一次性布尔锁，失败后再也用不了）
let proxyInFlight = null
const fetchDataByProxy = async () => {
  if (proxyInFlight) return proxyInFlight
  proxyInFlight = (async () => {
    const url = await useProxy()
    await fetchData(url)
  })()
  try {
    await proxyInFlight
  } finally {
    // 无论成功失败都释放，允许用户重试
    proxyInFlight = null
  }
}

ipcMain.handle('FETCH_DATA', async (event, param) => {
  try {
    if (param === 'proxy') {
      await fetchDataByProxy()
    } else {
      await fetchData(param)
    }
    return {
      dataMap,
      current: config.current,
      game: config.game
    }
  } catch (e) {
    sendMsg(e, 'ERROR')
    console.error(e)
  }
  return false
})

ipcMain.handle('READ_DATA', async () => {
  await readData()
  return {
    dataMap,
    current: config.current,
    game: config.game
  }
})

ipcMain.handle('FORCE_READ_DATA', async () => {
  await readData(true)
  return {
    dataMap,
    current: config.current,
    game: config.game
  }
})

ipcMain.handle('SWITCH_GAME', async (event, gameId) => {
  if (!isValidGame(gameId)) return false
  // 等配置加载完成后再改 game：
  // 否则这里设置的值会被随后完成的 getLocalConfig() 覆盖回文件里的游戏
  await config.ready
  if (config.game !== gameId) {
    config.game = gameId
    await config.save()
    dataMap.clear()
    localDataReaded = false
    await readData(true)
  }
  return {
    dataMap,
    current: config.current,
    game: config.game
  }
})

ipcMain.handle('CHANGE_UID', async (event, uid) => {
  await config.ready
  await changeCurrent(uid)
})

ipcMain.handle('GET_CONFIG', async () => {
  // 渲染层启动时立刻读取配置，必须等加载完成才能给出正确的 game / current
  await config.ready
  return Object.assign({}, config.value(), {
    current: config.current,
    gameInfo: getGameInfo(config.game, config.lang)
  })
})

ipcMain.handle('LANG_MAP', () => {
  return langMap
})

ipcMain.handle('SAVE_CONFIG', async (event, [key, value]) => {
  // 等配置加载完成再改并保存，否则会把默认值写回文件，覆盖用户设置
  await config.ready
  config[key] = value
  await config.save()
})

ipcMain.handle('DISABLE_PROXY', async () => {
  await disableProxy()
})

ipcMain.handle('I18N_DATA', () => {
  return i18n.data
})

ipcMain.handle('OPEN_CACHE_FOLDER', () => {
  if (cacheFolder) {
    shell.openPath(cacheFolder)
  }
})

exports.getData = () => {
  return {
    dataMap,
    current: config.current,
    game: config.game
  }
}

exports.legacyToRecord = legacyToRecord
exports.getUrl = getUrl
exports.getApiUrl = getApiUrl
exports.deleteData = deleteData
exports.saveData = saveData
exports.changeCurrent = changeCurrent
exports.convertTimeZone = convertTimeZone
exports.serverTimeZoneOf = serverTimeZoneOf
exports.readData = readData
