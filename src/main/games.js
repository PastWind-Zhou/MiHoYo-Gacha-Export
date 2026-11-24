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
    probeType: null,
    langFix: true,
    serverTimeZone: null,
    convertTime: false,
    uigfKey: 'hk4e',
    uigfTimeZone: 'uid',
    hideKey: 'hideNovice',
    hidePool: '100',
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
