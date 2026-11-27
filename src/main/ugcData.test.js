const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const USER_DATA = path.join(os.tmpdir(), 'ugc-data-contract-test')
const AUTH_URL = 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=testkey&lang=zh-cn'

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() }
}))

jest.mock('./utils', () => {
  const fsx = require('fs-extra')
  const pp = require('path')
  const oss = require('os')
  const dir = pp.join(oss.tmpdir(), 'ugc-data-contract-test')
  return {
    request: jest.fn(),
    sleep: jest.fn(async () => {}),
    sendMsg: jest.fn(),
    saveJSON: jest.fn(async (name, data) => {
      await fsx.outputJSON(pp.join(dir, name), data)
      return true
    }),
    userDataPath: dir
  }
})

jest.mock('./config', () => ({
  ready: Promise.resolve(),
  game: 'genshin',
  current: '123456789',
  lang: 'zh-cn',
  fetchFullHistory: true
}))

jest.mock('./getData', () => ({
  getData: jest.fn(() => ({ current: '123456789' })),
  getApiUrl: jest.fn(() => null)
}))

jest.mock('./i18n', () => ({
  log: {
    url: { notFound2: '未找到URL', lackAuth: '缺少authkey' },
    fetch: { current: '第${page}页', retry: '重试', retryFailed: '重试失败', authTimeout: '认证过期' }
  },
  parse: (text) => text
}))

const { ipcMain } = require('electron')
const { request, saveJSON, sendMsg } = require('./utils')
const config = require('./config')
const ugcData = require('./ugcData')

const handler = (channel) => {
  const call = ipcMain.handle.mock.calls.find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call[1]
}

const ugcRecord = (id, opType) => ({
  uid: '123456789',
  id,
  schedule_id: '10000001',
  item_type: '角色',
  item_id: '10000022',
  item_name: '测试角色',
  rank_type: '5',
  time: '2026-01-01 00:00:00',
  op_gacha_type: opType
})

describe('千星奇域数据链路（ugcData）', () => {
  beforeEach(async () => {
    await fs.remove(USER_DATA)
    await fs.ensureDir(path.join(USER_DATA, 'genshin'))
    ugcData.ugcMap.clear()
    request.mockReset()
    saveJSON.mockClear()
    sendMsg.mockClear()
    config.game = 'genshin'
    config.current = '123456789'
  })

  afterAll(async () => {
    await fs.remove(USER_DATA)
  })

  test('IPC 已注册 FETCH_UGC_DATA / READ_UGC_DATA', () => {
    expect(ipcMain.handle.mock.calls.map(([c]) => c)).toEqual(
      expect.arrayContaining(['FETCH_UGC_DATA', 'READ_UGC_DATA'])
    )
  })

  test('非原神游戏返回结构化错误，不读取/写入数据', async () => {
    config.game = 'hkrpg'
    const read = await handler('READ_UGC_DATA')({}, { game: 'hkrpg' })
    const fetch = await handler('FETCH_UGC_DATA')({}, { game: 'nap' })
    expect(read.ok).toBe(false)
    expect(read.error).toEqual(expect.any(String))
    expect(fetch.ok).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  test('READ_UGC_DATA 无本地数据返回 { ok: true, data: null }', async () => {
    await ugcData.readUGCData(true)
    const res = await handler('READ_UGC_DATA')({}, { game: 'genshin', uid: '123456789' })
    expect(res).toEqual({ ok: true, data: null })
  })

  test('READ_UGC_DATA 返回归一化账号（兼容 gacha_type、timezone 缺失）', async () => {
    await fs.writeJSON(path.join(USER_DATA, 'genshin', 'ugc-list-123456789.json'), {
      uid: 123456789,
      timezone: null,
      lang: '',
      list: [{
        id: '2234567890123456789',
        schedule_id: '10000001',
        item_type: '角色',
        item_id: '10000022',
        name: '测试角色',
        rank_type: '5',
        time: '2026-01-01 00:00:00',
        gacha_type: '20011'
      }]
    })
    await ugcData.readUGCData(true)
    const res = await handler('READ_UGC_DATA')({}, { game: 'genshin', uid: '123456789' })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({
      uid: '123456789',
      timezone: 8,
      lang: 'zh-cn',
      list: [{
        id: '2234567890123456789',
        schedule_id: '10000001',
        item_type: '角色',
        item_id: '10000022',
        item_name: '测试角色',
        rank_type: '5',
        time: '2026-01-01 00:00:00',
        op_gacha_type: '20011'
      }]
    })
  })

  test('saveUGCAccount 拒绝路径穿越 uid，绝不落盘', async () => {
    await expect(ugcData.saveUGCAccount({ uid: '../../evil', list: [] })).rejects.toThrow(/非法 uid/)
    await expect(ugcData.saveUGCAccount({ uid: '12345', list: [] })).rejects.toThrow(/非法 uid/)
    expect(saveJSON).not.toHaveBeenCalled()
  })

  test('FETCH_UGC_DATA 复用 authkey 分页抓取，落盘独立文件并返回账号对象', async () => {
    request.mockImplementation(async (url) => {
      if (url.includes('getConfigList')) return { retcode: 0, data: {} }
      if (url.includes('getBeyondGachaLog')) {
        const type = /gacha_type=(\d+)/.exec(url)?.[1] || ''
        const page = /page=(\d+)/.exec(url)?.[1]
        const list = page === '1'
          ? [ugcRecord(type === '1000' ? '2234567890123456789' : '3234567890123456789', type)]
          : []
        return { retcode: 0, data: { list } }
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const res = await handler('FETCH_UGC_DATA')({}, {
      game: 'genshin', uid: '123456789', url: AUTH_URL
    })
    expect(res.ok).toBe(true)
    expect(res.data.uid).toBe('123456789')
    expect(res.data.timezone).toBe(8)
    expect(res.data.list).toHaveLength(2)
    expect(res.data.list.map(r => r.op_gacha_type).sort()).toEqual(['1000', '2000'])
    // 独立 ugc-list 文件，不混入 gacha-list
    expect(saveJSON).toHaveBeenCalledWith(
      expect.stringContaining('ugc-list-123456789.json'),
      expect.objectContaining({ uid: '123456789' })
    )
    expect(request).toHaveBeenCalledWith(expect.stringContaining('getBeyondGachaLog'))
  })

  test('FETCH_UGC_DATA 抓取失败返回 { ok: false, error }', async () => {
    request.mockImplementation(async () => ({ retcode: -101, message: 'authkey timeout' }))
    const res = await handler('FETCH_UGC_DATA')({}, {
      game: 'genshin', uid: '123456789', url: AUTH_URL
    })
    expect(res.ok).toBe(false)
    expect(res.error).toEqual(expect.any(String))
  })
})
