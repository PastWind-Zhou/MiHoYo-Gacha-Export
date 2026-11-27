// 回归：本地旧 JSON 的 uid 可能是数字，抓取接口返回字符串（或反向）。
// dataMap 的 key 必须统一归一，否则同账号会变成两份、本地记录被整份丢弃。
jest.mock('electron', () => {
  const handlers = {}
  return {
    __handlers: handlers,
    app: { getPath: jest.fn(() => '/tmp'), getLocale: jest.fn(() => 'zh-CN') },
    ipcMain: { handle: jest.fn((channel, fn) => { handlers[channel] = fn }) },
    shell: { openPath: jest.fn() },
    BrowserWindow: jest.fn()
  }
}, { virtual: true })

jest.mock('./utils', () => ({
  sendMsg: jest.fn(),
  readJSON: jest.fn(async () => null),
  saveJSON: jest.fn(async () => true),
  getCacheText: jest.fn(async () => ['', '']),
  langMap: new Map([['zh-cn', '简体中文']]),
  userDataPath: '/tmp/userData',
  userPath: '/tmp',
  localIp: jest.fn(() => '127.0.0.1'),
  sleep: jest.fn(async () => {}),
  request: jest.fn(),
  detectLocale: () => 'zh-cn',
  saveLog: jest.fn()
}))

jest.mock('fs-extra', () => {
  const real = jest.requireActual('fs-extra')
  return Object.assign({}, real, {
    // getData 用 util.promisify(fs.readdir)，必须是回调风格
    readdir: jest.fn((p, cb) => cb(null, [])),
    ensureDir: jest.fn(async () => {}),
    readFile: jest.fn(async () => ''),
    outputJSON: jest.fn(async () => {}),
    outputFile: jest.fn(async () => {})
  })
})

const g = {
  osHostHints: [],
  domainCN: 'https://cn.example/',
  domainOS: 'https://os.example/',
  apiBase: 'gacha/',
  endpointFor: (key) => `getGachaLog-${key}`,
  typeParam: 'gacha_type',
  probeType: '1000',
  typeOrder: ['1000'],
  pageDelay: 0,
  legacyArray: false
}

jest.mock('./games', () => ({
  games: {},
  isValidGame: (v) => v === 'genshin',
  getGachaTypes: () => [{ name: '池A', key: '1000' }],
  getGameInfo: () => ({})
}))

jest.mock('./config', () => {
  const state = {
    game: 'genshin',
    lang: 'zh-cn',
    current: 0,
    fetchFullHistory: false,
    urls: [],
    value: () => ({ game: state.game, lang: state.lang, urls: [] }),
    save: jest.fn(async () => {}),
    setCurrent: jest.fn(uid => { state.current = uid }),
    ready: Promise.resolve()
  }
  return state
})

jest.mock('./i18n', () => {
  const log = new Proxy({}, { get: (target, key) => typeof key === 'string' ? key : '' })
  return { log, parse: (t) => t, data: {} }
})
jest.mock('./paths', () => ({ getBuildInfo: () => ({}) }))
jest.mock('./module/system-proxy', () => ({
  enableProxy: jest.fn(), disableProxy: jest.fn(), proxyStatus: { started: false, lastError: null }
}))
jest.mock('./module/node-mitmproxy', () => ({ createProxy: jest.fn(), closeProxy: jest.fn() }))

const electron = require('electron')
const fs = require('fs-extra')
const utils = require('./utils')
const config = require('./config')
const { games } = require('./games')
games.genshin = g
require('./getData')
const handlers = electron.__handlers

const URL = 'https://cn.example/gacha?authkey=TEST&lang=zh-cn'

const localRecord = () => ({
  id: '1', uid: 123456, rank_type: 5, time: '2024-01-05 12:00:00',
  name: '本地', item_type: '角色', gacha_type: '1000', count: '1'
})
const remoteRecord = (uid) => ({
  id: '2', uid, rank_type: 5, time: '2024-01-06 12:00:00',
  name: '远程', item_type: '角色', gacha_type: '1000', count: '1'
})
const localData = (uid) => ({
  uid,
  time: 1700000000000,
  lang: 'zh-cn',
  // readJSON 拿到的是数组形态，getData 内部会 new Map(...)
  result: [['1000', [localRecord()]]]
})

const setRequest = (uid, poolResponse) => {
  utils.request.mockReset()
  utils.request.mockImplementation(async (url) => {
    if (url.includes('size=5') || url.includes('getConfigList')) return { retcode: 0 }
    if (url.includes('size=6')) return { retcode: 0, data: { list: [{ uid }] } }
    return poolResponse()
  })
}

let errorSpy
beforeEach(() => {
  utils.sendMsg.mockClear()
  utils.saveJSON.mockClear()
  config.save.mockClear()
  config.setCurrent.mockClear()
  utils.readJSON.mockReset()
  utils.readJSON.mockResolvedValue(null)
  fs.readdir.mockImplementation((p, cb) => cb(null, []))
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

const savedPool = () => {
  const saved = utils.saveJSON.mock.calls[0][1]
  return saved.result.find(([key]) => key === '1000')
}

test('READ_DATA 把数字 uid 归一为字符串键，但 data.uid 保留原值', async () => {
  fs.readdir.mockImplementation((p, cb) => cb(null, ['gacha-list-123456.json']))
  utils.readJSON.mockResolvedValueOnce(localData(123456))

  const { dataMap } = await handlers.READ_DATA({})

  expect(dataMap.size).toBe(1)
  expect(dataMap.has('123456')).toBe(true)
  expect(dataMap.has(123456)).toBe(false)
  expect(dataMap.get('123456').uid).toBe(123456)
  // 渲染层用 config.current 直接查 dataMap，写入的也必须是归一后的 key
  expect(config.setCurrent).toHaveBeenCalledWith('123456')
})

test('本地数字 uid + 远程字符串 uid：合并后只一份，本地记录不丢', async () => {
  fs.readdir.mockImplementation((p, cb) => cb(null, ['gacha-list-123456.json']))
  utils.readJSON.mockResolvedValueOnce(localData(123456))
  await handlers.FORCE_READ_DATA({})

  let poolCalls = 0
  setRequest('123456', () => {
    poolCalls += 1
    if (poolCalls > 1) return { retcode: 0, data: { list: [] } }
    return { retcode: 0, data: { list: [remoteRecord('123456')] } }
  })

  const result = await handlers.FETCH_DATA({}, URL)

  expect(result).toBeTruthy()
  expect(result.dataMap.size).toBe(1)
  expect(result.dataMap.has('123456')).toBe(true)
  expect(result.dataMap.has(123456)).toBe(false)
  // data.uid 保留接口原值，不因 key 归一而改变用户可见 UID
  expect(result.dataMap.get('123456').uid).toBe('123456')
  expect(config.setCurrent).toHaveBeenCalledWith('123456')

  const pool = savedPool()
  expect(pool).toBeTruthy()
  expect(pool[1].map(item => item.id).sort()).toEqual(['1', '2'])
})

test('本地字符串 uid + 远程数字 uid：合并方向正确且 uid 原值保留', async () => {
  fs.readdir.mockImplementation((p, cb) => cb(null, ['gacha-list-123456.json']))
  utils.readJSON.mockResolvedValueOnce(localData('123456'))
  await handlers.FORCE_READ_DATA({})

  let poolCalls = 0
  setRequest(123456, () => {
    poolCalls += 1
    if (poolCalls > 1) return { retcode: 0, data: { list: [] } }
    return { retcode: 0, data: { list: [remoteRecord(123456)] } }
  })

  const result = await handlers.FETCH_DATA({}, URL)

  expect(result.dataMap.size).toBe(1)
  expect(result.dataMap.has('123456')).toBe(true)
  expect(result.dataMap.get('123456').uid).toBe(123456)
  const pool = savedPool()
  expect(pool[1].map(item => item.id).sort()).toEqual(['1', '2'])
})

// 增量停止条件（getData.js 的 dataMap.has/get(uid)）在 uid 为 number、
// dataMap key 为 string 时若不归一，会直接跳过本地记录比对；
// CHANGE_UID 传数字 uid 是真实触发路径，这里覆盖「命中并正确停止」。
test('CHANGE_UID 传数字 uid 时增量停止仍能命中本地字符串键记录', async () => {
  fs.readdir.mockImplementation((p, cb) => cb(null, ['gacha-list-123456.json']))
  utils.readJSON.mockResolvedValueOnce(localData('123456'))
  await handlers.FORCE_READ_DATA({})

  // 模拟渲染层/CHANGE_UID 传入数字 uid
  config.current = 123456
  await handlers.CHANGE_UID({}, 123456)
  expect(config.setCurrent).toHaveBeenCalledWith('123456')

  let poolCalls = 0
  setRequest(123456, () => {
    poolCalls += 1
    if (poolCalls > 1) return { retcode: 0, data: { list: [] } }
    // 远程最新记录 id 与本地最新 id 相同，应在第一页命中增量停止
    return { retcode: 0, data: { list: [localRecord()] } }
  })

  const result = await handlers.FETCH_DATA({}, URL)

  expect(result.dataMap.size).toBe(1)
  expect(result.dataMap.has('123456')).toBe(true)
  expect(poolCalls).toBe(1)
  // 停止命中后仍保留本地原有记录，没有因类型不一致被覆盖成空
  const pool = savedPool()
  expect(pool[1].map(item => item.id)).toEqual(['1'])
})
