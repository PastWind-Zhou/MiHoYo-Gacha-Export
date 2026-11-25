const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const OUT_FILE = path.join(os.tmpdir(), 'uigf42-export-test.json')
const USER_DATA = path.join(os.tmpdir(), 'uigf42-userdata-test')

jest.mock('electron', () => {
  const oss = require('os')
  const pp = require('path')
  return {
    app: { getPath: jest.fn(() => oss.tmpdir()) },
    ipcMain: { handle: jest.fn() },
    dialog: {
      showSaveDialogSync: jest.fn(() => pp.join(oss.tmpdir(), 'uigf42-export-test.json')),
      showOpenDialogSync: jest.fn()
    }
  }
})
jest.mock('./getData', () => ({
  getData: jest.fn(),
  changeCurrent: jest.fn(),
  convertTimeZone: jest.fn((time) => time),
  legacyToRecord: jest.fn()
}))
jest.mock('./config', () => ({
  value: jest.fn(() => ({ currents: {}, readableJSON: false })),
  game: 'genshin',
  lang: 'zh-cn',
  save: jest.fn()
}))
jest.mock('./i18n', () => ({ uigf: { fileType: 'UIGF' }, log: {} }))
jest.mock('./utils', () => {
  const oss = require('os')
  const pp = require('path')
  return {
    sendMsg: jest.fn(),
    userDataPath: pp.join(oss.tmpdir(), 'uigf42-userdata-test')
  }
})

const { ipcMain } = require('electron')
const { getData } = require('./getData')
const { validateUIGF42 } = require('./utils/uigf42')
require('./UIGFJson')

const exportHandler = () => {
  const call = ipcMain.handle.mock.calls.find(([channel]) => channel === 'EXPORT_UIGF_JSON')
  return call[1]
}

const record = (id, gachaType) => ({
  id,
  gacha_id: '',
  gacha_type: gachaType,
  item_id: '10000022',
  count: '1',
  time: '2026-01-01 00:00:00',
  name: '测试角色',
  item_type: '角色',
  rank_type: '5'
})

describe('UIGF v4.2 导出流程', () => {
  afterAll(() => {
    fs.removeSync(OUT_FILE)
    fs.removeSync(USER_DATA)
  })

  test('导出文件版本号、uigf_gacha_type 与 hk4e_ugc 均符合 v4.2', async () => {
    fs.removeSync(OUT_FILE)
    fs.removeSync(USER_DATA)
    const ugcDir = path.join(USER_DATA, 'genshin')
    await fs.ensureDir(ugcDir)
    await fs.writeJSON(path.join(ugcDir, 'ugc-list-123.json'), {
      uid: '123',
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
    getData.mockReturnValue({
      dataMap: new Map([['123', {
        uid: '123',
        lang: 'zh-cn',
        region_time_zone: '8',
        result: new Map([
          ['301', [record('1234567890123456789', '301')]],
          ['400', [record('3234567890123456789', '400')]]
        ])
      }]]),
      current: '123',
      game: 'genshin'
    })

    await exportHandler()({}, ['123'])

    const json = await fs.readJSON(OUT_FILE)
    expect(json.info.version).toBe('v4.2')
    expect(json.hk4e[0].timezone).toBe(8)
    const types = json.hk4e[0].list.map(item => `${item.gacha_type}/${item.uigf_gacha_type}`).sort()
    expect(types).toEqual(['301/301', '400/301'])
    expect(json.hk4e_ugc[0].list[0].op_gacha_type).toBe('20011')
    expect(validateUIGF42(json)).toEqual([])
  })
})
