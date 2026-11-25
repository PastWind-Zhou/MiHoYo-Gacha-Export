// 卡池判定与歪率统计的纯逻辑
//
// 与 gachaBanner.js 的区别：本模块不依赖 Electron / 网络，可在 Node 脚本与
// Jest 单测中直接使用；gachaBanner.js 负责数据加载与同步，判定核心在此实现，
// 由 gachaBanner.js 统一 re-export，保证两处逻辑不会漂移。
const { games } = require('../games')

// ---------- 时间工具 ----------
// 卡池时间一律按 UTC+8 解释（与游戏服务器时区一致）
const parseLocal = (s) => {
  if (!s) return NaN
  const t = String(s).trim().replace(' ', 'T')
  const d = new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(t) ? t : t + '+08:00')
  return d.getTime()
}

const formatLocal = (ms) => {
  const d = new Date(ms + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

// ---------- 名称归一化 ----------
// 不同数据源的引号写法不一致（米游社用『』、内置基线用「」、
// 抽卡记录用「」或无引号），因此比较时同时尝试「原样」与「去引号」两种形式。
const nameKeys = (s) => {
  const raw = String(s || '').trim()
  const plain = raw
    .replace(/[「」『』"'“”]/g, '')
    .split(/\s+/).join(' ')
  const stripped = raw.replace(/^[「『"'“]|[」』"'”]$/g, '').split(/\s+/).join(' ')
  return [raw, plain, stripped]
}

// 查询某时刻某 channel 开放的卡池（并行池会返回多个）
const bannersAt = (banners, channel, timeMs) => {
  const out = []
  for (const b of banners || []) {
    if (b.channel !== channel) continue
    const s = parseLocal(b.start)
    const e = parseLocal(b.end)
    if (!e) continue
    if (timeMs >= s && timeMs <= e) out.push(b)
  }
  return out
}

// 判断某物品在某时刻是否为当期 UP
// 返回 { up, known }：known=false 表示该时刻没有卡池数据，无法判定
const isUpAt = (banners, channel, name, timeMs, itemType) => {
  const active = bannersAt(banners, channel, timeMs)
  if (!active.length) return { up: false, known: false }
  const keys = nameKeys(name)
  for (const b of active) {
    // 混合池（原神集录祈愿）：角色与武器的 UP 名单分开，按记录类型取用
    let list = b.up || []
    if (b.upByType && itemType) {
      const t = String(itemType)
      if (/角色|代理/.test(t)) list = b.upByType.character || []
      else if (/武器|光锥|音擎/.test(t)) list = b.upByType.weapon || []
    }
    for (const u of list) {
      const uk = nameKeys(u)
      if (uk.some((x) => keys.some((y) => x === y))) return { up: true, known: true }
    }
  }
  return { up: false, known: true }
}

// ---------- 四级判定降级链 ----------
// ① 时间区间匹配 + UP 名单命中   → UP（最准确，卡池数据覆盖时）
// ② 时间区间匹配 + UP 名单未命中 → 歪（确定）
// ③ 时间区间内无卡池数据          → 不可判定
// ④ 兜底：不可判定区间内若只出现唯一一种最高级物品，则视为 UP
//
// ④ 默认关闭（options.fallback = false）：方案 §2.3 要求「不可判定不计入
// 分子分母」，且实测三游戏覆盖率已达 100%，兜底只在特殊场景才需要。
// 开启后兜底记录会被单独计数（fallbackCount），不污染严格指标。
//
// 返回每条记录的标记：{ index, top, up, known, fallback, ...原始字段 }
const judgePool = ({ records = [], banners = [], channel = '', topRank = '5', fallback = false }) => {
  const top = String(topRank)
  const sorted = records.slice().sort((a, b) => (parseLocal(a.time) || 0) - (parseLocal(b.time) || 0))
  const marked = sorted.map((rec, index) => {
    const res = isUpAt(banners, channel, rec.name, parseLocal(rec.time), rec.item_type)
    return {
      index,
      id: rec.id,
      name: rec.name,
      item_type: rec.item_type,
      rank_type: String(rec.rank_type ?? ''),
      time: rec.time,
      top: String(rec.rank_type ?? '') === top,
      up: res.up,
      known: res.known,
      fallback: false
    }
  })

  if (!fallback) return marked

  // 兜底④：连续的不可判定最高级记录构成一段，段内只有唯一物品时视为 UP
  const tops = marked.filter((m) => m.top)
  let i = 0
  while (i < tops.length) {
    if (tops[i].known) {
      i++
      continue
    }
    let j = i
    while (j < tops.length && !tops[j].known) j++
    const names = new Set(tops.slice(i, j).map((t) => t.name))
    if (names.size === 1) {
      tops.slice(i, j).forEach((t) => {
        t.up = true
        t.known = true
        t.fallback = true
      })
    }
    i = j
  }
  return marked
}

// ---------- 歪率统计 ----------
// 口径（方案 v3 §4.2/§4.3）：
//   不歪率 = |{ i : up(si) ∧ (i 为首个 UP ∨ up(si-1)) }| / |{ i : up(si) }|
//   即整段记录里出现的第一个 UP 无条件算一次「不歪」。
const calcPoolStats = (marked, { topRank = '5' } = {}) => {
  const top = String(topRank)
  const tops = (marked || []).filter((m) => m.top)
  // 严格可判定 = 有卡池数据且明确 UP/歪；兜底判定单独统计，不进入分子分母
  const knownTops = tops.filter((m) => m.known && !m.fallback)
  const fallbackTops = tops.filter((m) => m.fallback)
  const upTops = knownTops.filter((m) => m.up)
  const lostTops = knownTops.filter((m) => !m.up)
  const unknownTops = tops.filter((m) => !m.known)

  let noDeviationCount = 0
  let seenUp = false
  let prevUp = null
  const upIndexes = []
  const topIndexes = []
  let guaranteedCount = 0
  let deviationHistogram = {}

  knownTops.forEach((m) => {
    topIndexes.push(m.index)
    if (m.up) {
      upIndexes.push(m.index)
      if (!seenUp || prevUp === true) noDeviationCount++
      // 上一发是歪 → 本发是「大保底」
      if (prevUp === false) guaranteedCount++
      seenUp = true
      prevUp = true
    } else {
      prevUp = false
    }
  })

  // 连续歪的次数分布（不可判定记录会打断连续性）
  let streak = 0
  knownTops.forEach((m) => {
    if (!m.up) {
      streak++
    } else if (streak > 0) {
      deviationHistogram[streak] = (deviationHistogram[streak] || 0) + 1
      streak = 0
    }
  })
  if (streak > 0) deviationHistogram[streak] = (deviationHistogram[streak] || 0) + 1

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const gaps = (idxs) => idxs.slice(1).map((v, i) => v - idxs[i])
  const upGaps = gaps(upIndexes)
  const topGaps = gaps(topIndexes)

  const round = (n) => Math.round(n * 10000) / 10000
  return {
    total: (marked || []).length,
    topCount: tops.length,
    knownCount: knownTops.length,
    upCount: upTops.length,
    lostCount: lostTops.length,
    unknownCount: unknownTops.length,
    fallbackCount: fallbackTops.length,
    noDeviationCount,
    noDeviationRate: upTops.length ? round(noDeviationCount / upTops.length) : 0,
    avgUpPulls: round(avg(upGaps)),
    avgTopPulls: round(avg(topGaps)),
    minTopPulls: topGaps.length ? Math.min(...topGaps) : 0,
    maxTopPulls: topGaps.length ? Math.max(...topGaps) : 0,
    upHitRate: knownTops.length ? round(upTops.length / knownTops.length) : 0,
    deviationHistogram,
    guaranteedCount
  }
}

// 组合分析：按游戏配置推导 channel 与最高星级，直接给出统计结果
const analyzePool = ({ game, poolKey, records = [], banners = [], topRank, fallback = false }) => {
  const g = games[game]
  const channel = g?.poolChannel?.[String(poolKey)] || ''
  const rank = topRank || g?.ranks?.top || '5'
  const excluded = Array.isArray(g?.noDeviationPools) && g.noDeviationPools.includes(String(poolKey))
  const marked = judgePool({ records, banners, channel, topRank: rank, fallback })
  const stats = calcPoolStats(marked, { topRank: rank })
  return { channel, topRank: rank, excluded, marked, stats }
}

// ---------- 集录祈愿开始时间补齐 ----------
// 「集录祈愿」与同版本同相位的角色池同期开放，其 wiki 上的起始时间是
// 「X版本更新后」这类文字描述，无法直接解析。
// 这里用内置角色池的同期开始时间补齐（内置数据的上游推定更准）。
const fillJiluStarts = (banners) => {
  const charPools = (banners || []).filter((b) => b.channel === 'character')
  return (banners || []).map((b) => {
    if (b.channel !== 'jilu' || b.start) return b
    const same = charPools.filter((c) => c.version === b.version && (!b.phase || c.phase === b.phase))
    const pool = same.length ? same : charPools.filter((c) => c.version === b.version)
    if (!pool.length) return b
    const start = pool.map((c) => c.start).filter(Boolean).sort()[0]
    return start ? { ...b, start } : b
  })
}

module.exports = {
  parseLocal,
  formatLocal,
  nameKeys,
  bannersAt,
  isUpAt,
  judgePool,
  calcPoolStats,
  analyzePool,
  fillJiluStarts
}
