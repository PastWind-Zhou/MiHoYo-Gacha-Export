// 主进程 IPC 输入校验回归测试。
// 通过 mock electron.ipcMain.handle 捕获 handler，直接调用来验证边界。
jest.mock('electron', () => {
  const handlers = {}
  return {
    __handlers: handlers,
    app: { getPath: jest.fn(() => '/tmp'), getLocale: jest.fn(() => 'zh-CN') },
    ipcMain: { handle: jest.fn((channel, fn) => { handlers[channel] = fn }) },
    shell: { openPath: jest.fn() },
    clipboard: { writeText: jest.fn() },
    BrowserWindow: jest.fn()
  }
}, { virtual: true })

jest.mock('./utils', () => ({
  sendMsg: jest.fn(),
  readJSON: jest.fn(async () => null),
  saveJSON: jest.fn(async () => true),
  getCacheText: jest.fn(async () => ['', '']),
  langMap: new Map([['zh-cn', '简体中文'], ['en-us', 'English']]),
  userDataPath: '/tmp/userData',
  userPath: '/tmp',
  localIp: jest.fn(() => '127.0.0.1'),
  sleep: jest.fn(async () => {}),
  request: jest.fn(),
  detectLocale: () => 'zh-cn',
  saveLog: jest.fn()
}))

jest.mock('./config', () => {
  const state = {
    game: 'hkrpg',
    lang: 'zh-cn',
    current: 123,
    urls: [[123, 'authkey=SECRET_TOKEN']],
    value: () => ({ game: state.game, lang: state.lang, urls: state.urls, currents: {} }),
    save: jest.fn(async () => {}),
    ready: Promise.resolve()
  }
  return state
})

jest.mock('./i18n', () => {
  const log = new Proxy({}, { get: (target, key) => typeof key === 'string' ? key : '' })
  return { log, parse: (t) => t, data: {} }
})

jest.mock('./games', () => ({
  games: {},
  isValidGame: (v) => ['hkrpg', 'genshin', 'nap'].includes(v),
  getGachaTypes: () => [],
  getGameInfo: () => ({})
}))

jest.mock('./paths', () => ({ getBuildInfo: () => ({}) }))
jest.mock('./module/system-proxy', () => ({
  enableProxy: jest.fn(), disableProxy: jest.fn(), proxyStatus: { started: false }
}))
jest.mock('./module/node-mitmproxy', () => ({ createProxy: jest.fn(), closeProxy: jest.fn() }))
jest.mock('./waiwai', () => ({ getWaiwaiStats: jest.fn() }))

const electron = require('electron')
const config = require('./config')
require('./getData')
require('./bridge')
const handlers = electron.__handlers

describe('GET_CONFIG 不泄露 authkey', () => {
  test('解密后的 urls 不随配置下发渲染层', async () => {
    const result = await handlers.GET_CONFIG({})
    expect(result.urls).toBeUndefined()
    expect(result.current).toBe(123)
  })
})

describe('SAVE_CONFIG 参数白名单', () => {
  beforeEach(() => {
    config.save.mockClear()
    config.game = 'hkrpg'
    config.lang = 'zh-cn'
  })

  test('拒绝非法 game', async () => {
    await expect(handlers.SAVE_CONFIG({}, ['game', 'evil'])).resolves.toBe(false)
    expect(config.game).toBe('hkrpg')
    expect(config.save).not.toHaveBeenCalled()
  })

  test('拒绝非数组 urls 与越界 proxyPort', async () => {
    await expect(handlers.SAVE_CONFIG({}, ['urls', 'not-an-array'])).resolves.toBe(false)
    await expect(handlers.SAVE_CONFIG({}, ['proxyPort', 70000])).resolves.toBe(false)
    await expect(handlers.SAVE_CONFIG({}, ['proxyPort', 8325])).resolves.toBe(true)
  })

  test('拒绝未知 key，接受合法配置', async () => {
    await expect(handlers.SAVE_CONFIG({}, ['__proto__', {}])).resolves.toBe(false)
    await expect(handlers.SAVE_CONFIG({}, ['lang', 'en-us'])).resolves.toBe(true)
    expect(config.lang).toBe('en-us')
    expect(config.save).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE_DATA 参数校验', () => {
  test('拒绝非数字 uid 与非布尔 action', async () => {
    await expect(handlers.DELETE_DATA({}, 'abc', true)).rejects.toThrow(/invalid uid/)
    await expect(handlers.DELETE_DATA({}, '123', 'yes')).rejects.toThrow(/invalid action/)
  })
})
