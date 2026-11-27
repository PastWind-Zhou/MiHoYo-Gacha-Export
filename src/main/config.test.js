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
    expect(config.autoUpdate).toBe(true)
    expect(config.skipVersion).toBe('')
    expect(config.lastUpdateCheck).toBe(0)
    expect(config.updateState).toBe('init')
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
