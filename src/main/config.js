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
  Object.assign(config, configTemp)
}

getLocalConfig()

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
    if (prop === 'urls') {
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
