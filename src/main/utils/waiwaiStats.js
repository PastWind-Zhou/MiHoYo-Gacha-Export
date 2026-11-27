// 歪率分析数据组装（纯函数，不依赖 Electron，便于单测）
const { analyzePool } = require('./bannerJudge')
const { games } = require('../games')

// 组装某个游戏的歪率分析数据
//   result  —— Map<poolKey, records>（本地抽卡记录）
//   banners —— 卡池排期（内置 + 本地反推 + 覆盖层）
//   types   —— 卡池类型表 [{ key, name }]
//
// 只统计「有排期映射」的池：常驻/新手/独家重映等池没有 UP 概念，不参与歪率分析。
const buildWaiwaiStats = ({ game, result, banners = [], types = [] }) => {
  const g = games[game]
  if (!g) return { game, pools: [] }
  const nameMap = new Map((types || []).map((t) => [String(t.key), t.name]))
  const pools = []
  if (!result) return { game, pools }

  for (const [poolKey, records] of result) {
    if (!records || !records.length) continue
    const channel = g.poolChannel?.[String(poolKey)] || ''
    if (!channel) continue
    const excluded = Array.isArray(g.noDeviationPools) && g.noDeviationPools.includes(String(poolKey))
    const { stats, firstTopIsUp } = analyzePool({
      game,
      poolKey,
      records,
      banners,
      topRank: g.ranks?.top || '5'
    })
    pools.push({
      poolKey: String(poolKey),
      name: nameMap.get(String(poolKey)) || String(poolKey),
      channel,
      excluded,
      firstTopIsUp,
      stats
    })
  }

  // 池键通常是数字串；非数字时按 NaN 比较会得到乱序，这里做兜底
  pools.sort((a, b) => {
    const av = Number(a.poolKey)
    const bv = Number(b.poolKey)
    if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv
    return String(a.poolKey).localeCompare(String(b.poolKey))
  })
  return { game, pools }
}

// 生成 Excel「歪率分析」工作表的行数据
// options 中的文案由调用方（主进程 i18n）传入，保持本模块不依赖 i18n
const buildWaiwaiRows = (pools = [], options = {}) => {
  const {
    yes = '是',
    no = '否',
    excludedSuffix = ''
  } = options
  return (pools || []).map((p) => {
    const s = p.stats || {}
    const histogram = s.deviationHistogram || {}
    return {
      pool: `${p.name}${p.excluded ? excludedSuffix : ''}`,
      included: p.excluded ? no : yes,
      total: s.total ?? 0,
      top: s.topCount ?? 0,
      up: s.upCount ?? 0,
      lost: s.lostCount ?? 0,
      unknown: s.unknownCount ?? 0,
      noDeviation: s.noDeviationCount ?? 0,
      noDeviationRate: s.noDeviationRate ?? 0,
      avgUp: s.avgUpPulls ?? 0,
      avgTop: s.avgTopPulls ?? 0,
      luckiest: s.minTopPulls ?? 0,
      unluckiest: s.maxTopPulls ?? 0,
      upHitRate: s.upHitRate ?? 0,
      deviation1: histogram['1'] || 0,
      deviation2: histogram['2'] || 0,
      deviation3: histogram['3'] || 0,
      // 连歪统计：与上面三列（连续歪的 5 星个数）语义不同
      maxDeviationStreak: s.maxDeviationStreak ?? 0,
      currentDeviationStreak: s.currentDeviationStreak ?? 0,
      guaranteed: s.guaranteedCount ?? 0
    }
  })
}

module.exports = { buildWaiwaiStats, buildWaiwaiRows }
