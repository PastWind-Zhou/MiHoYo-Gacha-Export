jest.mock('./utils', () => {
  const state = { local: null }
  return {
    __state: state,
    readJSON: jest.fn(async () => state.local),
    saveJSON: jest.fn(async () => true),
    cipherAes: jest.fn(v => Buffer.from(String(v)).toString('base64')),
    decipherAes: jest.fn(v => Buffer.from(String(v), 'base64').toString('utf8')),
    detectLocale: () => 'zh-cn',
    userDataPath: '/tmp/userData'
  }
})

jest.mock('./games', () => ({
  isValidGame: (v) => ['hkrpg', 'genshin', 'nap'].includes(v)
}))

const loadConfig = (local) => {
  jest.resetModules()
  const utils = require('./utils')
  utils.__state.local = local
  const config = require('./config')
  return { utils, config }
}

describe('自动更新默认键', () => {
  test('首次启动即可读到 autoUpdate / skipVersion / lastUpdateCheck / updateState', async () => {
    const { config } = loadConfig(null)
    await config.ready
    expect(config.autoUpdate).toBe(false)
    expect(config.skipVersion).toBe('')
    expect(config.lastUpdateCheck).toBe(0)
    expect(config.updateState).toBe('init')
  })

  test('config.json 中已有的 autoUpdate:true 应被保留，不被默认值覆盖', async () => {
    const { config } = loadConfig({ autoUpdate: true })
    await config.ready
    expect(config.autoUpdate).toBe(true)
  })
})

describe('config.urls 容错', () => {
  test('urls 为 {} / 字符串等非数组时 ready 仍 resolve 且回退空数组', async () => {
    for (const bad of [{}, 'bad', 123, null]) {
      const { config } = loadConfig({ urls: bad })
      await expect(config.ready).resolves.toBeUndefined()
      expect(config.urls.size).toBe(0)
    }
  })

  test('合法 urls 数组仍正常解密', async () => {
    const { config } = loadConfig({ urls: [[123, 'YXV0aGtleQ==']] })
    await config.ready
    expect(config.urls.get(123)).toBe('authkey')
  })
})

describe('config.game 校验', () => {
  test('config.json 中 game 为 null 时回退 hkrpg', async () => {
    const { config } = loadConfig({ game: null })
    await config.ready
    expect(config.game).toBe('hkrpg')
  })

  test('config.json 中 game 为空串时回退 hkrpg', async () => {
    const { config } = loadConfig({ game: '' })
    await config.ready
    expect(config.game).toBe('hkrpg')
  })

  test('合法 game 保留', async () => {
    const { config } = loadConfig({ game: 'genshin' })
    await config.ready
    expect(config.game).toBe('genshin')
  })
})

describe('saveConfig 始终加密 urls', () => {
  test('authkey 不得以明文写入 config.json', async () => {
    const { utils, config } = loadConfig({ game: 'genshin' })
    await config.ready
    config.urls = [[123, 'authkey=SECRET']]
    await config.save()
    const saved = utils.saveJSON.mock.calls[0][1]
    expect(saved.urls).toEqual([[123, Buffer.from('authkey=SECRET').toString('base64')]])
    expect(JSON.stringify(saved)).not.toContain('authkey=SECRET')
  })

  test('SAVE_CONFIG 写入 urls 后 urlsMap 同步刷新', async () => {
    const { utils, config } = loadConfig({ game: 'genshin' })
    await config.ready
    config.urls = [[456, 'authkey=TOKEN']]
    expect(config.urls.get(456)).toBe('authkey=TOKEN')
    await config.save()
    expect(utils.saveJSON.mock.calls[0][1].urls).toEqual([[456, Buffer.from('authkey=TOKEN').toString('base64')]])
  })
})
