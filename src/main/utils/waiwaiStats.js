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
    const { stats } = analyzePool({
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
      stats
    })
  }

  pools.sort((a, b) => Number(a.poolKey) - Number(b.poolKey))
  return { game, pools }
}

module.exports = { buildWaiwaiStats }
