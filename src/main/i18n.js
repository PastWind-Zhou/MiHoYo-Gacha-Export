const fs = require('fs')
const path = require('path')
const config = require('./config')
const isPlainObject = require('lodash/isPlainObject')

// 每个游戏一套独立文案（src/i18n/<game>/<lang>.json），切换游戏时按需加载
// 语言代码 -> 文件名（原版即以语言名命名文件）
const LANG_FILES = {
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  'de-de': 'Deutsch',
  'en-us': 'English',
  'es-es': 'Español',
  'fr-fr': 'Français',
  'id-id': 'Indonesia',
  'ja-jp': '日本語',
  'ko-kr': '한국어',
  'pt-pt': 'Português',
  'ru-ru': 'Pусский',
  'th-th': 'ภาษาไทย',
  'vi-vn': 'Tiếng Việt'
}

const loadRaw = (game) => {
  const raw = {}
  for (const lang in LANG_FILES) {
    try {
      const p = path.join(__dirname, `../i18n/${game}/${LANG_FILES[lang]}.json`)
      raw[lang] = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch (e) {
      console.error(`[i18n] load failed: ${game}/${LANG_FILES[lang]}`, e.message)
    }
  }
  return raw
}

const addProp = (obj, key) => {
  if (isPlainObject(obj[key])) {
    return obj[key]
  } else if (typeof obj[key] === 'undefined') {
    let temp = {}
    obj[key] = temp
    return temp
  }
}

const parseData = (data) => {
  const result = {}
  for (let key in data) {
    let temp = result
    const arr = key.split('.')
    arr.forEach((prop, index) => {
      if (index === arr.length - 1) {
        temp[prop] = data[key]
      } else {
        temp = addProp(temp, prop)
      }
    })
  }
  return result
}

const assignData = (objA, objB) => {
  const temp = { ...objA }
  for (let key in objB) {
    if (objB[key]) {
      temp[key] = objB[key]
    }
  }
  return temp
}

const i18nMapCache = new Map()
const getI18nMap = (game) => {
  if (i18nMapCache.has(game)) return i18nMapCache.get(game)
  const raw = loadRaw(game)
  const i18nMap = new Map()
  for (let key in raw) {
    let temp = {}
    if (key === 'zh-tw') {
      temp = assignData(raw['zh-cn'], raw[key])
    } else {
      temp = assignData(raw['zh-cn'], assignData(raw['en-us'], raw[key]))
    }
    i18nMap.set(key, parseData(temp))
  }
  i18nMapCache.set(game, i18nMap)
  return i18nMap
}

const parseText = (text, data) => {
  return text.replace(/(\${.+?})/g, function (...args) {
    const key = args[0].slice(2, args[0].length - 1)
    if (data[key]) return data[key]
    return args[0]
  })
}

const mainProps = [
  'symbol', 'ui', 'log', 'excel',"uigf"
]

const i18n = new Proxy({}, {
  get (obj, prop) {
    const map = getI18nMap(config.game)
    const current = map.get(config.lang) || map.get('en-us') || map.get('zh-cn')
    if (prop === 'data') {
      return current
    } else if (mainProps.includes(prop)) {
      return current ? current[prop] : undefined
    } else if (prop === 'parse') {
      return parseText
    }
    return undefined
  }
})

module.exports = i18n
