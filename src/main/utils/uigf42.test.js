const {
  UIGF_VERSION,
  UGC_TYPES,
  isSupportedV4Version,
  makeInfo,
  uigfGachaTypeOf,
  toUIGFRecord,
  sortByRecordId,
  groupUIGFRecords,
  normalizeUGCAccount,
  validateUIGF42,
  schema
} = require('./uigf42')

const ID = '1234567890123456789'
const TIME = '2026-01-01 00:00:00'

const genshinLog = (gachaType = '301') => ({
  id: ID,
  gacha_id: '',
  gacha_type: gachaType,
  item_id: '10000022',
  count: '1',
  time: TIME,
  name: '测试角色',
  item_type: '角色',
  rank_type: '5'
})

const buildValidFile = () => {
  const info = makeInfo({ appName: 'MiHoYoGachaExport', appVersion: 'v1.0.1', timestamp: 1700000000 })
  return {
    info,
    hk4e: [{
      uid: '123456789',
      timezone: 8,
      lang: 'zh-cn',
      list: [toUIGFRecord({ gameId: 'genshin', log: genshinLog() })]
    }],
    hkrpg: [{
      uid: '123456789',
      timezone: 8,
      lang: 'zh-cn',
      list: [{
        gacha_id: '2003',
        gacha_type: '11',
        item_id: '1201',
        count: '1',
        time: TIME,
        name: '测试光锥',
        item_type: '光锥',
        rank_type: '5',
        id: ID
      }]
    }],
    nap: [{
      uid: '123456789',
      timezone: 8,
      lang: 'zh-cn',
      list: [{
        gacha_id: '0',
        gacha_type: '2',
        item_id: '12016',
        count: '1',
        time: TIME,
        name: '测试音擎',
        item_type: '音擎',
        rank_type: '4',
        id: ID
      }]
    }],
    hk4e_ugc: [normalizeUGCAccount({
      uid: '123456789',
      timezone: 8,
      lang: 'zh-cn',
      list: [{
        id: ID,
        schedule_id: '10000001',
        item_type: '角色',
        item_id: '10000022',
        item_name: '测试角色',
        rank_type: '5',
        time: TIME,
        op_gacha_type: '20011'
      }]
    })]
  }
}

describe('UIGF v4.2 转换', () => {
  test('导出版本为 v4.2 且 info 字段齐全', () => {
    expect(UIGF_VERSION).toBe('v4.2')
    const info = makeInfo({ appName: 'app', appVersion: 'v1', timestamp: 42 })
    expect(info).toEqual({
      export_timestamp: 42,
      export_app: 'app',
      export_app_version: 'v1',
      version: 'v4.2'
    })
  })

  test('版本识别只接受 v4.x', () => {
    expect(isSupportedV4Version('v4.0')).toBe(true)
    expect(isSupportedV4Version('v4.1')).toBe(true)
    expect(isSupportedV4Version('v4.2')).toBe(true)
    expect(isSupportedV4Version('v5.0')).toBe(false)
    expect(isSupportedV4Version('v3.0')).toBe(false)
    expect(isSupportedV4Version(undefined)).toBe(false)
  })

  test('原神 400 映射到 uigf_gacha_type=301，其余游戏不加该字段', () => {
    expect(uigfGachaTypeOf('genshin', '400')).toBe('301')
    expect(uigfGachaTypeOf('genshin', '301')).toBe('301')
    expect(uigfGachaTypeOf('genshin', '500')).toBe('500')
    expect(uigfGachaTypeOf('hkrpg', '11')).toBe('')

    const hk4e = toUIGFRecord({ gameId: 'genshin', log: genshinLog('400') })
    expect(hk4e.gacha_type).toBe('400')
    expect(hk4e.uigf_gacha_type).toBe('301')
    const hkrpg = toUIGFRecord({ gameId: 'hkrpg', log: genshinLog('11') })
    expect(hkrpg).not.toHaveProperty('uigf_gacha_type')
  })

  test('导入按 uigf_gacha_type 分组，400 归入 301 后移除临时字段', () => {
    const records = [
      toUIGFRecord({ gameId: 'genshin', log: genshinLog('301') }),
      toUIGFRecord({ gameId: 'genshin', log: genshinLog('400') }),
      { ...toUIGFRecord({ gameId: 'hkrpg', log: genshinLog('11') }), gacha_type: '12' }
    ]
    const grouped = groupUIGFRecords(records, { allowedUigfTypes: ['100', '200', '301', '302', '500'] })
    expect(Object.keys(grouped).sort()).toEqual(['12', '301'])
    expect(grouped['301']).toHaveLength(2)
    expect(grouped['301'][0]).not.toHaveProperty('uigf_gacha_type')
  })

  test('白名单之外的 uigf_gacha_type 回退到 gacha_type，非原神忽略该字段', () => {
    const dirty = { ...toUIGFRecord({ gameId: 'hkrpg', log: genshinLog('11') }), uigf_gacha_type: '301' }
    const hkrpgGrouped = groupUIGFRecords([dirty], { allowedUigfTypes: [] })
    expect(Object.keys(hkrpgGrouped)).toEqual(['11'])

    const illegal = { ...toUIGFRecord({ gameId: 'genshin', log: genshinLog('400') }), uigf_gacha_type: '999' }
    const genshinGrouped = groupUIGFRecords([illegal], { allowedUigfTypes: ['100', '200', '301', '302', '500'] })
    expect(Object.keys(genshinGrouped)).toEqual(['400'])
  })

  test('脏 id 不会让排序抛错', () => {
    const list = [{ id: 'abc' }, { id: '1234567890123456789' }, { id: '' }]
    expect(() => list.slice().sort(sortByRecordId)).not.toThrow()
    const sorted = list.slice().sort(sortByRecordId).map((x) => String(x.id))
    // 非法 id 一律按 0 处理（相对顺序保持），合法数字 id 排在后面
    expect(sorted.slice(0, 2).sort()).toEqual(['', 'abc'])
    expect(sorted[2]).toBe('1234567890123456789')
  })
})

describe('hk4e_ugc 千星奇域', () => {
  test('UGC 卡池类型与内置 Schema 一致', () => {
    const enumTypes = schema.properties.hk4e_ugc.properties.list.items.properties.op_gacha_type.enum
    expect(enumTypes).toEqual(UGC_TYPES)
    expect(schema.properties.hk4e_ugc.properties.list.items.required).toEqual([
      'id', 'schedule_id', 'item_type', 'item_id', 'item_name', 'rank_type', 'time', 'op_gacha_type'
    ])
  })

  test('导入归一化：保留合法记录，丢弃未知卡池类型，兼容 name 字段', () => {
    const account = normalizeUGCAccount({
      uid: 123,
      timezone: '8',
      lang: 'zh-cn',
      list: [
        {
          id: ID,
          schedule_id: '10000001',
          item_type: '角色',
          item_id: '10000022',
          name: '兼容名称',
          rank_type: '5',
          time: TIME,
          op_gacha_type: '20011'
        },
        {
          id: '2234567890123456789',
          schedule_id: '10000002',
          item_type: '角色',
          item_id: '10000023',
          item_name: '忽略我',
          rank_type: '4',
          time: TIME,
          op_gacha_type: '9999'
        }
      ]
    })
    expect(account.uid).toBe('123')
    expect(account.timezone).toBe(8)
    expect(account.list).toHaveLength(1)
    expect(account.list[0].item_name).toBe('兼容名称')
    expect(account.list[0]).not.toHaveProperty('name')
  })
})

describe('Schema 轻量校验', () => {
  test('完整 v4.2 文件无警告', () => {
    expect(validateUIGF42(buildValidFile())).toEqual([])
  })

  test('缺少 uigf_gacha_type 时报警告', () => {
    const file = buildValidFile()
    delete file.hk4e[0].list[0].uigf_gacha_type
    expect(validateUIGF42(file).join('\n')).toMatch(/uigf_gacha_type/)
  })

  test('非法 op_gacha_type 与非法时间均报警告', () => {
    const file = buildValidFile()
    file.hk4e_ugc[0].list[0].op_gacha_type = '9999'
    file.nap[0].list[0].time = '2026/01/01'
    const warnings = validateUIGF42(file).join('\n')
    expect(warnings).toMatch(/op_gacha_type/)
    expect(warnings).toMatch(/time 格式不合法/)
  })

  test('旧版本号会提示但不是错误', () => {
    const file = buildValidFile()
    file.info.version = 'v4.1'
    expect(validateUIGF42(file).join('\n')).toMatch(/当前工具导出版本为 v4.2/)
  })
})
