// 抓取链路回归测试：游标停滞、authkey 过期、uid 缺失不落盘
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
    setCurrent: jest.fn(),
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
const utils = require('./utils')
const { games } = require('./games')
games.genshin = g
require('./getData')
const handlers = electron.__handlers


const URL = 'https://cn.example/gacha?authkey=TEST&lang=zh-cn'

const setRequest = (poolResponse) => {
  utils.request.mockReset()
  utils.request.mockImplementation(async (url) => {
    if (url.includes('size=5') || url.includes('getConfigList')) return { retcode: 0 }
    if (url.includes('size=6')) return { retcode: 0, data: { list: [{ uid: '123456' }] } }
    return poolResponse()
  })
}

let errorSpy

beforeEach(() => {
  utils.sendMsg.mockClear()
  utils.saveJSON.mockClear()
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => errorSpy.mockRestore())

test('翻页游标不推进时提前停止，不无限请求', async () => {
  let poolCalls = 0
  setRequest(() => {
    poolCalls += 1
    return { retcode: 0, data: { list: [{ id: '999', uid: '123456', rank_type: 5 }] } }
  })
  await handlers.FETCH_DATA({}, URL)
  expect(poolCalls).toBe(2)
  expect(utils.saveJSON).toHaveBeenCalled()
})

test('翻页中 authkey 过期会中断整体流程并发出 AUTHKEY_TIMEOUT', async () => {
  setRequest(() => ({ retcode: -101, message: 'authkey timeout' }))
  await handlers.FETCH_DATA({}, URL)
  expect(utils.sendMsg).toHaveBeenCalledWith(true, 'AUTHKEY_TIMEOUT')
  expect(utils.saveJSON).not.toHaveBeenCalled()
})

test('接口未返回 uid 时不写入 gacha-list-undefined.json', async () => {
  setRequest(() => ({ retcode: 0, data: { list: [] } }))
  await handlers.FETCH_DATA({}, URL)
  expect(utils.saveJSON).not.toHaveBeenCalled()
  const logged = utils.sendMsg.mock.calls.map(c => c[0])
  expect(logged.some(m => m instanceof Error && /invalid uid/.test(m.message))).toBe(true)
})
