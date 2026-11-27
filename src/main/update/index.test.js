jest.mock('electron', () => {
  const handlers = {}
  return {
    app: {
      getVersion: jest.fn(() => '1.0.1'),
      relaunch: jest.fn(),
      quit: jest.fn()
    },
    ipcMain: {
      handle: jest.fn((channel, fn) => { handlers[channel] = fn })
    },
    __handlers: handlers
  }
})

jest.mock('../config', () => {
  const state = { autoUpdate: true, skipVersion: '', lastUpdateCheck: 0, updateState: 'init' }
  return {
    ready: Promise.resolve(),
    get autoUpdate() { return state.autoUpdate },
    get skipVersion() { return state.skipVersion },
    get lastUpdateCheck() { return state.lastUpdateCheck },
    set: jest.fn((key, value) => { state[key] = value }),
    save: jest.fn(async () => {}),
    __state: state
  }
})

jest.mock('../paths', () => {
  const path = require('path')
  const os = require('os')
  const root = path.join(os.tmpdir(), 'mhy-update-index-test')
  const appRoot = path.join(root, 'MiHoYoGachaExport-1.0.1-win')
  return { isDev: false, appRoot, userDataPath: path.join(appRoot, 'userData') }
})

jest.mock('../utils', () => ({ sendMsg: jest.fn() }))

jest.mock('./downloader', () => ({
  fetchLatestRelease: jest.fn(),
  downloadFile: jest.fn(),
  validateZip: jest.fn(),
  extractZip: jest.fn()
}))

const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const { buildManifest } = require('./dataGuard')
const { writeState } = require('./state')

let electron
let config
let paths
let sendMsg
let downloader
let index
let handlers

// index.js 有模块级状态（updateInfo / inited），每个用例都重新加载以获得干净状态
beforeEach(() => {
  jest.resetModules()
  electron = require('electron')
  config = require('../config')
  paths = require('../paths')
  sendMsg = require('../utils').sendMsg
  downloader = require('./downloader')
  index = require('./index')
  handlers = electron.__handlers

  fs.removeSync(path.dirname(paths.appRoot))
  fs.ensureDirSync(paths.userDataPath)
  config.__state.autoUpdate = true
  config.__state.skipVersion = ''
  config.__state.lastUpdateCheck = 0
  config.set.mockClear()
  config.save.mockClear()
  sendMsg.mockClear()
  electron.app.getVersion.mockReturnValue('1.0.1')
  electron.app.relaunch.mockClear()
  electron.app.quit.mockClear()
})

afterEach(() => {
  fs.removeSync(path.dirname(paths.appRoot))
})

const makeRelease = (version, opts = {}) => ({
  tag_name: `v${version}`,
  body: 'release notes',
  assets: opts.noAsset ? [] : [{
    name: `MiHoYoGachaExport-${version}-win.zip`,
    browser_download_url: 'https://example.test/app.zip',
    digest: opts.noDigest ? undefined : `sha256:${'a'.repeat(64)}`
  }]
})

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

describe('IPC contract', () => {
  test('registers exactly four update channels', () => {
    expect(Object.keys(handlers).sort()).toEqual([
      'APPLY_UPDATE', 'CHECK_UPDATE', 'GET_UPDATE_INFO', 'SKIP_UPDATE'
    ])
  })

  test('GET_UPDATE_INFO takes no params and returns the agreed snapshot', async () => {
    const info = await handlers.GET_UPDATE_INFO()
    expect(info).toEqual(expect.objectContaining({
      status: 'init',
      available: false,
      version: '',
      notes: '',
      progress: 0,
      error: ''
    }))
  })

  test('CHECK_UPDATE returns { ok, data } or { ok: false, error }', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.2'))
    const result = await handlers.CHECK_UPDATE()
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ available: true, version: '1.0.2', message: '' })
    })
    expect(result.ok).toBe(true)
    expect(index.publicInfo().error).toBe('')
  })

  test('failed CHECK_UPDATE exposes error through both result and GET_UPDATE_INFO', async () => {
    downloader.fetchLatestRelease.mockRejectedValue(new Error('network down'))
    await expect(handlers.CHECK_UPDATE()).resolves.toEqual({ ok: false, error: 'network down' })
    const info = await handlers.GET_UPDATE_INFO()
    expect(info.status).toBe('failed')
    expect(info.error).toBe('network down')
  })

  test('SKIP_UPDATE takes { version } and an empty string clears the marker', async () => {
    const skipped = await handlers.SKIP_UPDATE({}, { version: 'v1.0.2' })
    expect(skipped).toEqual({ ok: true, skipVersion: '1.0.2' })
    expect(config.set).toHaveBeenCalledWith('skipVersion', '1.0.2')

    const cleared = await handlers.SKIP_UPDATE({}, { version: '' })
    expect(cleared).toEqual({ ok: true, skipVersion: '' })
    expect(config.__state.skipVersion).toBe('')

    // 兼容旧渲染层的位置参数
    await handlers.SKIP_UPDATE({}, '1.0.3')
    expect(config.__state.skipVersion).toBe('1.0.3')
  })
})

describe('checkUpdate', () => {
  test('no newer version → data.available false and lastUpdateCheck persisted', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.1'))
    const result = await handlers.CHECK_UPDATE()
    expect(result.ok).toBe(true)
    expect(result.data.available).toBe(false)
    expect(result.data.version).toBe('1.0.1')
    expect(config.set).toHaveBeenCalledWith('lastUpdateCheck', expect.any(Number))
    expect(config.save).toHaveBeenCalled()
  })

  test('fail closed when the chosen asset has no digest', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.2', { noDigest: true }))
    const result = await handlers.CHECK_UPDATE()
    expect(result.data.available).toBe(false)
    expect(result.data.message).toContain('sha256')
  })

  test('no platform asset → unavailable', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.2', { noAsset: true }))
    const result = await handlers.CHECK_UPDATE()
    expect(result.data.available).toBe(false)
    expect(result.data.message).toContain('更新包')
  })

  test('skipVersion blocks the update', async () => {
    config.__state.skipVersion = '1.0.2'
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.2'))
    const result = await handlers.CHECK_UPDATE()
    expect(result.data.available).toBe(false)
    expect(result.data.message).toContain('跳过')
  })
})

describe('APPLY_UPDATE', () => {
  test('with no available update it detects first and returns a failure result', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.1'))
    const result = await handlers.APPLY_UPDATE()
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(downloader.downloadFile).not.toHaveBeenCalled()
  })

  test('downloads, verifies, backs up, stages the update and relaunches', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.2'))
    fs.writeFileSync(path.join(paths.userDataPath, 'config.json'), '{"lang":"zh"}')
    downloader.downloadFile.mockImplementation(async (url, destFile) => {
      fs.outputFileSync(destFile, 'zip')
      return { size: 3 }
    })
    downloader.validateZip.mockReturnValue({ root: 'MiHoYoGachaExport-1.0.2-win', entries: 1 })
    downloader.extractZip.mockImplementation((zipFile, stagingDir, root) => {
      const stagedRoot = path.join(stagingDir, root)
      fs.outputFileSync(path.join(stagedRoot, 'MiHoYoGachaExport.exe'), 'exe')
      return stagedRoot
    })

    const result = await handlers.APPLY_UPDATE()
    expect(result).toEqual({ ok: true, data: { version: '1.0.2' } })

    const target = path.join(path.dirname(paths.appRoot), 'MiHoYoGachaExport-1.0.2-win')
    expect(electron.app.relaunch).toHaveBeenCalledWith({
      execPath: path.join(target, 'MiHoYoGachaExport.exe')
    })
    expect(fs.readFileSync(path.join(target, 'userData/config.json'), 'utf8')).toBe('{"lang":"zh"}')
    const state = fs.readJSONSync(path.join(target, 'update-state.json'))
    expect(state.phase).toBe('staged')
    expect(state.toVersion).toBe('1.0.2')
    expect(state.fromVersion).toBe('1.0.1')
    expect(fs.existsSync(path.join(paths.appRoot, 'update-state.json'))).toBe(true)
    expect(fs.existsSync(path.join(paths.appRoot, 'MiHoYoGachaExport.exe'))).toBe(false)
  })

  test('download failure keeps the old version untouched', async () => {
    downloader.fetchLatestRelease.mockResolvedValue(makeRelease('1.0.2'))
    fs.writeFileSync(path.join(paths.userDataPath, 'config.json'), '{"lang":"zh"}')
    downloader.downloadFile.mockRejectedValue(new Error('checksum mismatch'))

    const result = await handlers.APPLY_UPDATE()
    expect(result).toEqual({ ok: false, error: 'checksum mismatch' })
    expect(index.getUpdateInfo().status).toBe('failed')
    expect(fs.readFileSync(path.join(paths.userDataPath, 'config.json'), 'utf8')).toBe('{"lang":"zh"}')
    expect(fs.existsSync(path.join(path.dirname(paths.appRoot), 'MiHoYoGachaExport-1.0.2-win'))).toBe(false)
  })
})

describe('initUpdate / post-upgrade validation', () => {
  const prepareState = (toVersion, backupFiles) => {
    const backupDir = path.join(paths.appRoot, 'update-cache', 'backup', `${toVersion}-test`)
    fs.ensureDirSync(path.join(backupDir, 'userData'))
    for (const [rel, content] of Object.entries(backupFiles)) {
      fs.outputFileSync(path.join(backupDir, 'userData', rel), content)
    }
    fs.outputJSONSync(path.join(backupDir, 'manifest.json'), buildManifest(path.join(backupDir, 'userData')))
    const state = {
      phase: 'staged',
      fromVersion: '1.0.1',
      toVersion,
      oldAppRoot: paths.appRoot,
      newAppRoot: paths.appRoot,
      backupDir
    }
    writeState(paths.appRoot, state)
    return state
  }

  test('healthy data → phase done, hint sent, state cleared', async () => {
    prepareState('1.0.2', { 'config.json': '{"lang":"zh"}' })
    fs.writeFileSync(path.join(paths.userDataPath, 'config.json'), '{"lang":"zh"}')
    await index.initUpdate()
    expect(index.getUpdateInfo().status).toBe('done')
    expect(sendMsg).toHaveBeenCalledWith(expect.stringContaining('校验通过'), 'UPDATE_HINT')
    expect(fs.existsSync(path.join(paths.appRoot, 'update-state.json'))).toBe(false)
  })

  test('missing file → restored from backup then marked done', async () => {
    prepareState('1.0.2', { 'config.json': '{"lang":"zh"}' })
    await index.initUpdate()
    expect(fs.readFileSync(path.join(paths.userDataPath, 'config.json'), 'utf8')).toBe('{"lang":"zh"}')
    expect(index.getUpdateInfo().status).toBe('done')
    expect(sendMsg).toHaveBeenCalledWith(expect.stringContaining('已从备份恢复'), 'UPDATE_HINT')
  })

  test('unrecoverable validation failure → relaunch old version and skip that version', async () => {
    const backupDir = path.join(paths.appRoot, 'update-cache', 'backup', '1.0.2-test')
    fs.outputJSONSync(path.join(backupDir, 'manifest.json'), {
      version: 1,
      files: [{ rel: 'config.json', size: 2, sha256: sha('{}') }]
    })
    const oldRoot = path.join(path.dirname(paths.appRoot), 'MiHoYoGachaExport-1.0.0-win')
    fs.outputFileSync(path.join(oldRoot, 'MiHoYoGachaExport.exe'), 'old')
    writeState(paths.appRoot, {
      phase: 'staged',
      fromVersion: '1.0.1',
      toVersion: '1.0.2',
      oldAppRoot: oldRoot,
      newAppRoot: paths.appRoot,
      backupDir
    })

    await index.initUpdate()

    expect(electron.app.relaunch).toHaveBeenCalledWith({
      execPath: path.join(oldRoot, 'MiHoYoGachaExport.exe')
    })
    expect(electron.app.quit).toHaveBeenCalled()
    expect(config.__state.skipVersion).toBe('1.0.2')
    expect(index.getUpdateInfo().status).toBe('restoring')
  })

  test('staged state for a different root does not trigger validation', async () => {
    writeState(paths.appRoot, {
      phase: 'staged',
      toVersion: '1.0.2',
      newAppRoot: path.join(path.dirname(paths.appRoot), 'MiHoYoGachaExport-1.0.2-win')
    })
    await index.initUpdate()
    expect(index.getUpdateInfo().status).toBe('init')
    expect(sendMsg).toHaveBeenCalledWith(expect.stringContaining('未完成的更新'), 'UPDATE_HINT')
    expect(fs.existsSync(path.join(paths.appRoot, 'update-state.json'))).toBe(false)
  })
})
