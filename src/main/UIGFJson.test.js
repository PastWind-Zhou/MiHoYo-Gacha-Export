const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const OUT_FILE = path.join(os.tmpdir(), 'uigf42-export-test.json')
const OUT_FILE2 = path.join(os.tmpdir(), 'uigf42-export-test-2.json')
const IMPORT_FILE = path.join(os.tmpdir(), 'uigf42-import-test.json')
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
  const fsx = require('fs-extra')
  const dir = pp.join(oss.tmpdir(), 'uigf42-userdata-test')
  return {
    sendMsg: jest.fn(),
    userDataPath: dir,
    // ugcData.saveUGCAccount 走这里落盘，导入 roundtrip 测试需要真实写入
    saveJSON: jest.fn(async (name, data) => {
      await fsx.outputJSON(pp.join(dir, name), data)
      return true
    })
  }
})

const { ipcMain, dialog } = require('electron')
const { getData, convertTimeZone } = require('./getData')
const { validateUIGF42 } = require('./utils/uigf42')
require('./UIGFJson')

const exportHandler = () => {
  const call = ipcMain.handle.mock.calls.find(([channel]) => channel === 'EXPORT_UIGF_JSON')
  return call[1]
}

const importHandler = () => {
  const call = ipcMain.handle.mock.calls.find(([channel]) => channel === 'IMPORT_UIGF_JSON')
  return call[1]
}

const uigfFile = (game, uid, timezone, list) => ({
  info: { version: 'v4.2', export_timestamp: 1700000000, export_app: 'test', export_app_version: 'v1' },
  [game]: [{ uid, timezone, lang: 'zh-cn', list }]
})

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
    fs.removeSync(OUT_FILE2)
    fs.removeSync(IMPORT_FILE)
    fs.removeSync(USER_DATA)
  })

  test('导出文件版本号、uigf_gacha_type 与 hk4e_ugc 均符合 v4.2', async () => {
    fs.removeSync(OUT_FILE)
    fs.removeSync(USER_DATA)
    const ugcDir = path.join(USER_DATA, 'genshin')
    await fs.ensureDir(ugcDir)
    await fs.writeJSON(path.join(ugcDir, 'ugc-list-123456789.json'), {
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
    getData.mockReturnValue({
      dataMap: new Map([['123456789', {
        uid: '123456789',
        lang: 'zh-cn',
        region_time_zone: '8',
        result: new Map([
          ['301', [record('1234567890123456789', '301')]],
          ['400', [record('3234567890123456789', '400')]]
        ])
      }]]),
      current: '123456789',
      game: 'genshin'
    })

    await exportHandler()({}, ['123456789'])

    const json = await fs.readJSON(OUT_FILE)
    expect(json.info.version).toBe('v4.2')
    expect(json.hk4e[0].timezone).toBe(8)
    const types = json.hk4e[0].list.map(item => `${item.gacha_type}/${item.uigf_gacha_type}`).sort()
    expect(types).toEqual(['301/301', '400/301'])
    expect(json.hk4e_ugc[0].list[0].op_gacha_type).toBe('20011')
    expect(validateUIGF42(json)).toEqual([])
  })

  test('导入绝区零 timezone 为 null 时按 +8 归一，不用 0 时区', async () => {
    fs.removeSync(USER_DATA)
    convertTimeZone.mockClear()
    const file = uigfFile('nap', '987654321', null, [{
      gacha_id: '0', gacha_type: '2', item_id: '12016', count: '1',
      time: '2026-01-01 00:00:00', name: '测试音擎', item_type: '音擎', rank_type: '4', id: '4234567890123456789'
    }])
    fs.writeJsonSync(IMPORT_FILE, file)
    dialog.showOpenDialogSync.mockReturnValue([IMPORT_FILE])

    await importHandler()({})

    // Number(null) === 0 且 finite；修复前这里会收到 (time, 0, 0) 导致整体偏移 8 小时
    expect(convertTimeZone).toHaveBeenCalledWith('2026-01-01 00:00:00', 8, 8)
  })

  test('导入 item_id 为 constructor 时不改写名称（原型键防护）', async () => {
    fs.removeSync(USER_DATA)
    const file = uigfFile('nap', '987654322', 8, [{
      gacha_id: '0', gacha_type: '2', item_id: 'constructor', count: '1',
      time: '2026-01-01 00:00:00', name: '原始名称', item_type: '音擎', rank_type: '4', id: '5234567890123456789'
    }])
    fs.writeJsonSync(IMPORT_FILE, file)
    dialog.showOpenDialogSync.mockReturnValue([IMPORT_FILE])

    await importHandler()({})

    const written = await fs.readJSON(path.join(USER_DATA, 'nap', 'gacha-list-987654322.json'))
    const entry = written.result.find(([key]) => key === '2')
    expect(entry[1][0].name).toBe('原始名称')
  })

  test('hk4e_ugc 导出 → 导入 → 再导出字段一致', async () => {
    fs.removeSync(USER_DATA)
    fs.removeSync(OUT_FILE)
    fs.removeSync(OUT_FILE2)
    const ugcDir = path.join(USER_DATA, 'genshin')
    await fs.ensureDir(ugcDir)
    const ugcAccount = {
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
    }
    await fs.writeJSON(path.join(ugcDir, 'ugc-list-123456789.json'), ugcAccount)
    getData.mockReturnValue({
      dataMap: new Map([['123456789', {
        uid: '123456789', lang: 'zh-cn', region_time_zone: 8,
        result: new Map([['301', [record('1234567890123456789', '301')]]])
      }]]),
      current: '123456789',
      game: 'genshin'
    })

    dialog.showSaveDialogSync.mockReturnValueOnce(OUT_FILE)
    await exportHandler()({}, ['123456789'])
    const first = await fs.readJSON(OUT_FILE)
    expect(first.hk4e_ugc).toEqual([ugcAccount])

    dialog.showOpenDialogSync.mockReturnValue([OUT_FILE])
    await importHandler()({})
    const saved = await fs.readJSON(path.join(ugcDir, 'ugc-list-123456789.json'))
    expect(saved).toEqual(ugcAccount)

    dialog.showSaveDialogSync.mockReturnValueOnce(OUT_FILE2)
    await exportHandler()({}, ['123456789'])
    const second = await fs.readJSON(OUT_FILE2)
    expect(second.hk4e_ugc).toEqual(first.hk4e_ugc)
  })
})
