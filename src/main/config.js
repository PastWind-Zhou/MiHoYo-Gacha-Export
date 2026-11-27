const { readJSON, saveJSON, decipherAes, cipherAes, detectLocale, userDataPath } = require('./utils')
const { isValidGame } = require('./games')

const config = {
  game: 'hkrpg',
  currents: { hkrpg: 0, genshin: 0, nap: 0 },
  urls: [],
  logType: 0,
  lang: detectLocale(),
  proxyPort: 8325,
  proxyMode: false,
  autoUpdate: true,
  fetchFullHistory: false,
  hideNovice: false,
  hideStandard: false,
  readableJSON: false,
  // 卡池数据远程源设置（方案 §2.4）
  bannerSourceUrl: '',
  bannerSourceInterval: 24,
  bannerSourceTimeout: 30,
  bannerSourceRetry: 1,
  bannerAutoSync: false,
  bannerLastSync: 0
}

const getLocalConfig = async () => {
  let localConfig = await readJSON(userDataPath, 'config.json')

  if (!localConfig) return
  const configTemp = {}
  for (let key in localConfig) {
    if (typeof config[key] !== 'undefined') {
      configTemp[key] = localConfig[key]
    }
  }
  if (configTemp.urls) {
    configTemp.urls.forEach(item => {
      try {
        item[1] = decipherAes(item[1])
      } catch (e) {
        item[1] = ''
      }
    })
  }
  if (configTemp.game && !isValidGame(configTemp.game)) {
    configTemp.game = 'hkrpg'
  }
  // currents 要逐游戏合并，不能整体替换：
  // 整体替换会丢掉运行期间刚写入的其它游戏 uid
  if (configTemp.currents && typeof configTemp.currents === 'object') {
    configTemp.currents = Object.assign({}, config.currents, configTemp.currents)
  }
  Object.assign(config, configTemp)
}

// 读取本地配置（config.json）
// 注意：这是异步的，模块加载时不能假定它已完成 ——
// 期间 config.game 仍是默认值 'hkrpg'，若此时就按 config.game
// 去读数据目录，会读到别的游戏的目录，并把 uid 写进错误游戏的槽位。
// 因此导出 ready Promise，所有依赖 config 的入口都要先 await 它。
const ready = getLocalConfig()

let urlsMap = null
const setConfig = (key, value) => {
  Reflect.set(config, key, value)
}

const saveConfig = async () => {
  let configTemp = config
  if (urlsMap) {
    const urls = [...urlsMap]
    urls.forEach(item => {
      try {
        item[1] = cipherAes(item[1])
      } catch (e) {
        item[1] = ''
      }
    })
    configTemp = Object.assign({}, config, { urls })
  }
  await saveJSON('config.json', configTemp)
}

const getPlainConfig = () => config

const configProxy = new Proxy(config, {
  get: function (obj, prop) {
    if (prop === 'ready') {
      // 配置加载完成的信号：调用方 await 后才能信任 config.game / config.current
      return ready
    } else if (prop === 'urls') {
      if (!urlsMap) {
        urlsMap = new Map(obj[prop])
      }
      return urlsMap
    } else if (prop === 'current') {
      // 当前游戏的当前 UID
      return obj.currents[obj.game] || 0
    } else if (prop === 'setCurrent') {
      return (uid) => {
        obj.currents[obj.game] = uid
      }
    } else if (prop === 'set') {
      return setConfig
    } else if (prop === 'save') {
      return saveConfig
    } else if (prop === 'value') {
      return getPlainConfig
    }
    return obj[prop]
  }
})

module.exports = configProxy
