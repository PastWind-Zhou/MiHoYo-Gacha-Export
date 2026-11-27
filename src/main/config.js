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
  // null / 空串也要回退：只判断真值时，games[null] 会让整个抓取链路崩溃
  if (!isValidGame(configTemp.game)) {
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
  // urls 始终基于 urlsMap 加密后落盘：
  // getLocalConfig 加载时已把 config.urls 解密回写，
  // 若此时 urlsMap 尚未初始化（渲染层没读过 urls）就走「原样保存」分支，
  // authkey 会以明文写进 config.json
  if (!urlsMap) {
    urlsMap = new Map(config.urls || [])
  }
  // 逐对复制后再加密：直接改 urlsMap 里的数组会把明文覆盖成密文，
  // 第二次 save 变成双重加密，加载解密失败后 URL 就丢了
  const urls = [...urlsMap].map((item) => {
    try {
      return [item[0], cipherAes(item[1])]
    } catch (e) {
      return [item[0], '']
    }
  })
  configTemp = Object.assign({}, config, { urls })
  await saveJSON('config.json', configTemp)
}

const getPlainConfig = () => config

const configProxy = new Proxy(config, {
  set: function (obj, prop, value) {
    // SAVE_CONFIG 写入 urls 时同步刷新 urlsMap，否则 getter 仍返回旧 Map，
    // 内存里的明文 URL 与 Save 落盘的密文不一致
    if (prop === 'urls' && Array.isArray(value)) {
      urlsMap = new Map(value)
    }
    obj[prop] = value
    return true
  },
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
