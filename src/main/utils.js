const fs = require('fs-extra')
const path = require('path')
const fetch = require('electron-fetch').default
const { BrowserWindow, app } = require('electron')
const crypto = require('crypto')
const unhandled = require('electron-unhandled')
const windowStateKeeper = require('electron-window-state')
const debounce = require('lodash/debounce')
const { glob } = require('glob')

const { isDev, appRoot, userDataPath, migrateUserData } = require('./paths')

const userPath = app.getPath('userData')

// 打包版升级到新目录时，把旧版本目录里的抽卡记录迁移过来（只在当前目录无数据时执行）
// 迁移来源会记入日志，让用户能看清「数据是从哪个目录带过来的」
const migrated = migrateUserData()

let win = null
const initWindow = () => {
  let mainWindowState = windowStateKeeper({
    defaultWidth: 888,
    defaultHeight: 550
  })
  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    backgroundColor: '#fff',
    webPreferences: {
      contextIsolation:false,
      nodeIntegration: true
    }
  })
  const saveState = debounce(mainWindowState.saveState, 500)
  win.on('resize', () => saveState(win))
  win.on('move', () => saveState(win))
  return win
}

const getWin = () => win

const log = []
// 启动时的用户数据迁移记录：写入日志数组首条，
// 这样用户在自己的 userData/log.txt 里能看到数据来源
if (migrated && migrated.from) {
  log.push([Date.now(), 'INFO', `已从旧版本目录迁移用户数据：${migrated.from}`])
  // 立即落盘：迁移只发生在启动这一次，之后若没有其它日志，
  // 这条记录就不会写进 log.txt，用户也就看不到数据来源
  try {
    fs.outputFileSync(
      path.join(userDataPath, 'log.txt'),
      `[INFO][${new Date().toLocaleString()}]已从旧版本目录迁移用户数据：${migrated.from}\r\n`,
      'utf8'
    )
  } catch (e) {
    // 日志写入失败不能阻断启动
  }
}
const sendMsg = (text, type = 'LOAD_DATA_STATUS') => {
  if (win) {
    win.webContents.send(type, text)
  }
  if (type !== 'LOAD_DATA_STATUS') {
    log.push([Date.now(), type, text])
    saveLog()
  }
}

const saveLog = () => {
  const text = log.map(item => {
    const time = new Date(item[0]).toLocaleString()
    const type = item[1] === 'LOAD_DATA_STATUS' ? 'INFO' : item[1]
    const text = item[2]
    return `[${type}][${time}]${text}`
  }).join('\r\n')
  // 写入失败（如目录不可写）不能产生 unhandled rejection，
  // 否则日志写入本身会变成新的崩溃源
  return fs.outputFile(path.join(userDataPath, 'log.txt'), text).catch(() => {})
}

const authkeyMask = (text = '') => {
  return text.replace(/authkey=[^&]+&/g, 'authkey=***&')
}

unhandled({
  showDialog: false,
  logger: function (err) {
    log.push([Date.now(), 'ERROR', authkeyMask(err.stack)])
    saveLog()
  }
})

const request = async (url) => {
  const res = await fetch(url, {
    timeout: 15 * 1000
  })
  return await res.json()
}

const sleep = (sec = 1) => {
  return new Promise(rev => {
    setTimeout(rev, sec * 1000)
  })
}

const sortData = (data) => {
  return data.map(item => {
    const [time, name, type, rank] = item
    return {
      time, name, type, rank,
      timestamp: new Date(time)
    }
  }).sort((a, b) => a.timestamp - b.timestamp)
  .map(item => {
    const { time, name, type, rank } = item
    return [time, name, type, rank]
  })
}

const langMap = new Map([
  ['zh-cn', '简体中文'],
  ['zh-tw', '繁體中文'],
  ['de-de', 'Deutsch'],
  ['en-us', 'English'],
  ['es-es', 'Español'],
  ['fr-fr', 'Français'],
  ['id-id', 'Indonesia'],
  ['ja-jp', '日本語'],
  ['ko-kr', '한국어'],
  ['pt-pt', 'Português'],
  ['ru-ru', 'Pусский'],
  ['th-th', 'ภาษาไทย'],
  ['vi-vn', 'Tiếng Việt']
])

const localeMap = new Map([
  ['zh-cn', ['zh', 'zh-CN']],
  ['zh-tw', ['zh-TW']],
  ['de-de', ['de-AT', 'de-CH', 'de-DE', 'de']],
  ['en-us', ['en-AU', 'en-CA', 'en-GB', 'en-NZ', 'en-US', 'en-ZA', 'en']],
  ['es-es', ['es', 'es-419']],
  ['fr-fr', ['fr-CA', 'fr-CH', 'fr-FR', 'fr']],
  ['id-id', ['id']],
  ['ja-jp', ['ja']],
  ['ko-kr', ['ko']],
  ['pt-pt', ['pt-BR', 'pt-PT', 'pt']],
  ['ru-ru', ['ru']],
  ['th-th', ['th']],
  ['vi-vn', ['vi']]
])

const detectLocale = (value) => {
  const locale = value || app.getLocale()
  let result = 'zh-cn'
  for (let [key, list] of localeMap) {
    if (locale === key || list.includes(locale)) {
      result = key
      break
    }
  }
  return result
}

// 保存 JSON 到 userData 目录
// 写入失败时重试若干次，并把结果返回给调用方：
// 静默失败会让调用方以为已保存，实际数据已丢失
const saveJSON = async (name, data, retry = 3) => {
  let lastError = null
  for (let i = 0; i < Math.max(1, retry); i++) {
    try {
      await fs.outputJSON(path.join(userDataPath, name), data)
      return true
    } catch (e) {
      lastError = e
      if (i < retry - 1) await sleep(200)
    }
  }
  sendMsg(lastError, 'ERROR')
  return false
}

const readJSON = async (dataPath, name) => {
  let data = null
  try {
    data = await fs.readJSON(path.join(dataPath, name))
  } catch (e) {}
  return data
}

const hash = (data, type = 'sha256') => {
  const hmac = crypto.createHmac(type, 'hk4e')
  hmac.update(data)
  return hmac.digest('hex')
}

const scryptKey = crypto.scryptSync(userPath, 'hk4e', 24)
const cipherAes = (data) => {
  const algorithm = 'aes-192-cbc'
  const iv = Buffer.alloc(16, 0)
  const cipher = crypto.createCipheriv(algorithm, scryptKey, iv)
  let encrypted = cipher.update(data, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return encrypted
}

const decipherAes = (encrypted) => {
  const algorithm = 'aes-192-cbc'
  const iv = Buffer.alloc(16, 0)
  const decipher = crypto.createDecipheriv(algorithm, scryptKey, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const  interfaces = require('os').networkInterfaces()
const localIp = () => {
  for (var devName in interfaces) {
    var iface = interfaces[devName]

    for (var i = 0; i < iface.length; i++) {
      var alias = iface[i]
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal)
        return alias.address
    }
  }
  return '127.0.0.1'
}

async function getCacheText(gamePath) {
  const results = await glob(path.join(gamePath, '/webCaches{/,/*/}Cache/Cache_Data/data_2'), {
    stat: true,
		withFileTypes: true,
    nodir: true,
    windowsPathsNoEscape: true
  })
  const timeSortedFiles = results
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(path => path.fullpath())
  // 没匹配到缓存文件时返回空值，由调用方给出准确提示，
  // 否则 path.join(undefined) 会抛 TypeError 并被误报成「日志读取失败」
  if (!timeSortedFiles.length) return ['', '']
  const cacheText = await fs.readFile(path.join(timeSortedFiles[0]), 'utf8')

  return [cacheText, timeSortedFiles[0]]
}

module.exports = {
  sleep, request, hash, cipherAes, decipherAes, saveLog, getCacheText,
  sendMsg, readJSON, saveJSON, initWindow, getWin, localIp, userPath, detectLocale, langMap,
  appRoot, userDataPath
}