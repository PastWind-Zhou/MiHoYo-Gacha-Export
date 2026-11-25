const gachaTypes = {
  hkrpg: require('../gachaType/hkrpg.json'),
  genshin: require('../gachaType/genshin.json'),
  nap: require('../gachaType/nap.json')
}
const idJsons = {
  hkrpg: require('../idJson/hkrpg.json'),
  genshin: require('../idJson/genshin.json'),
  nap: require('../idJson/nap.json')
}

// 三个游戏的全部差异都集中在这里
const games = {
  hkrpg: {
    id: 'hkrpg',
    logDirs: ['/miHoYo/崩坏：星穹铁道/', '/Cognosphere/Star Rail/'],
    logFile: 'Player.log',
    cloudLog: null,
    logUrlFast: null,
    logUrlRegex: /https[^?]+?\?[^?]+?&auth_appid=webview_gacha&.+?authkey=.+?&game_biz=hkrpg_/g,
    dataDirRes: /\w:\/.*?\/StarRail_Data\//i,
    dataDirAppend: '',
    domainCN: 'https://public-operation-hkrpg.mihoyo.com',
    domainOS: 'https://public-operation-hkrpg-sg.hoyoverse.com',
    osHostHints: ['webstatic-sea', 'hkrpg-api-os', 'api-os-takumi', 'hoyoverse.com'],
    apiBase: '/common/hkrpg_gacha_record/api/',
    endpointFor: (key) => ['21', '22'].includes(key) ? 'getLdGachaLog' : 'getGachaLog',
    typeParam: 'gacha_type',
    typeOrder: ['11', '12', '21', '22', '1', '2'],
    probeType: '1',
    langFix: false,
    serverTimeZone: null,
    convertTime: false,
    uigfKey: 'hkrpg',
    uigfTimeZone: 'region',
    hideKey: 'hideNovice',
    hidePool: '2',
    // 抽卡记录池 → 卡池排期 channel
    //   11/21 角色活动/联动 → character
    //   12/22 光锥活动/联动 → lightcone
    //   1 常驻跃迁 / 2 新手跃迁 → 无排期数据（常驻池本就没有 UP 概念）
    poolChannel: { '11': 'character', '21': 'character', '12': 'lightcone', '22': 'lightcone' },
    // 不参与歪率统计的池：常驻/新手池本就没有 UP 概念
    noDeviationPools: ['1', '2'],
    ranks: { low: '3', mid: '4', top: '5' },
    bangboo: false,
    idMode: 'item',
    legacyArray: false
  },
  genshin: {
    id: 'genshin',
    logDirs: ['/miHoYo/原神/', '/miHoYo/Genshin Impact/'],
    logFile: 'output_log.txt',
    cloudLog: 'AppData/Local/miHoYo/GenshinImpactCloudGame/config/logs/MiHoYoSDK.log',
    logUrlFast: null,
    logUrlRegex: /https.+?auth_appid=webview_gacha.+?authkey=.+?game_biz=hk4e_\w+/g,
    dataDirRes: /\w:\/.+(GenshinImpact_Data|YuanShen_Data)/,
    dataDirAppend: '/',
    domainCN: 'https://public-operation-hk4e.mihoyo.com',
    domainOS: 'https://public-operation-hk4e-sg.hoyoverse.com',
    osHostHints: ['webstatic-sea', 'hk4e-api-os', 'hoyoverse.com'],
    apiBase: '/gacha_info/api/',
    endpointFor: () => 'getGachaLog',
    typeParam: 'gacha_type',
    typeOrder: ['301', '302', '500', '200', '100'],
    // UIGF v4.2 千星奇域（hk4e_ugc）卡池类型：当前仅做导入导出透传，
    // 主动抓取与本地展示按方案推迟到 1.0.2
    ugcPools: ['1000', '2000', '20011', '20012', '20021', '20022'],
    probeType: null,
    langFix: true,
    serverTimeZone: null,
    convertTime: false,
    uigfKey: 'hk4e',
    uigfTimeZone: 'uid',
    hideKey: 'hideNovice',
    hidePool: '100',
    // 抽卡记录池 → 卡池排期 channel
    //   301/400 角色活动 → character
    //   302 武器活动 → weapon
    //   500 集录祈愿 → jilu（角色+武器混合池，UP 按记录 item_type 分别取）
    //   200 常驻祈愿 / 100 新手祈愿 → 无排期数据（常驻池本就没有 UP 概念）
    poolChannel: { '301': 'character', '400': 'character', '302': 'weapon', '500': 'jilu' },
    // 不参与歪率统计的池：
    //   500 集录祈愿 —— 定轨目标由玩家自选，官方 API 与抽卡记录都不返回，无法判定 UP/歪
    //   200 常驻祈愿 / 100 新手祈愿 —— 本就没有 UP 概念
    noDeviationPools: ['500', '200', '100'],
    ranks: { low: '3', mid: '4', top: '5' },
    bangboo: false,
    idMode: 'name',
    legacyArray: true
  },
  nap: {
    id: 'nap',
    logDirs: ['/miHoYo/绝区零/', '/miHoYo/ZenlessZoneZero/'],
    logFile: 'Player.log',
    cloudLog: null,
    logUrlFast: /https:\/\/.*?\/info/g,
    logUrlRegex: /https.+?authkey=.+?end_id=/g,
    dataDirRes: /[A-Z]:\/.*?\/(?=ZenlessZoneZero_Data)/i,
    dataDirAppend: 'ZenlessZoneZero_Data',
    domainCN: 'https://public-operation-nap.mihoyo.com',
    domainOS: 'https://public-operation-nap-sg.hoyoverse.com',
    osHostHints: ['webstatic-sea', 'hoyoverse.com'],
    apiBase: '/common/gacha_record/api/',
    endpointFor: () => 'getGachaLog',
    typeParam: 'real_gacha_type',
    typeOrder: ['2', '3', '5', '102', '103', '1'],
    probeType: '1',
    pageDelay: 0.4,
    pageInterval: 10,
    langFix: false,
    serverTimeZone: new Map([
      ['prod_gf_cn', 8],
      ['prod_gf_jp', 8],
      ['prod_gf_us', -5],
      ['prod_gf_eu', 1],
      ['prod_gf_sg', 8]
    ]),
    convertTime: true,
    uigfKey: 'nap',
    uigfTimeZone: 'region',
    hideKey: 'hideStandard',
    hidePool: '1',
    // 抽卡记录池 → 卡池排期 channel
    //   2 独家频段 / 5 独家重映 / 102 音擎回响 → character
    //   3 音擎频段 / 103 音擎回响 → engine
    //   1 常驻频段 / 邦布频段 → 无排期数据（常驻池本就没有 UP 概念）
    poolChannel: { '2': 'character', '3': 'engine', '5': 'character', '102': 'character', '103': 'engine' },
    // 不参与歪率统计的池：常驻/回响/邦布池无 UP 概念
    noDeviationPools: ['1', '102', '103'],
    ranks: { low: '2', mid: '3', top: '4' },
    bangboo: true,
    idMode: 'item',
    legacyArray: false
  }
}

const GAMES = ['genshin', 'hkrpg', 'nap']
const isValidGame = (id) => GAMES.includes(id)

// 卡池类型表：语言回退 lang -> en-us -> zh-cn
const getGachaTypes = (game, lang) => {
  const dict = gachaTypes[game]
  return dict[lang] || dict['en-us'] || dict['zh-cn']
}

// 各游戏实际存在的文案键（星铁/原神为 3-4-5 星，绝区零为 B-A-S 级）
// 统一映射到「5/4/3」三档语义，渲染层组件与原版完全一致
const NO_TOP_KEY = { hkrpg: 'no5star', genshin: 'no5star', nap: 'no5star' }

// 给渲染层的当前游戏元信息
const getGameInfo = (game, lang) => {
  const g = games[game]
  return {
    game,
    types: getGachaTypes(game, lang),
    hideKey: g.hideKey,
    hidePool: g.hidePool,
    // 真实 rank 值 -> 5/4/3 三档
    rankLevels: { five: g.ranks.top, four: g.ranks.mid, three: g.ranks.low },
    bangboo: g.bangboo,
    idVersion: idJsons[game].version || ''
  }
}

module.exports = { games, GAMES, isValidGame, getGachaTypes, getGameInfo, idJsons, gachaTypes }
