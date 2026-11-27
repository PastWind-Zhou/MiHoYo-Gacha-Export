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
  // 只在结尾出现 Z 或 ±HH:MM 时才认为已带时区，
  // 否则字符串中间出现 z/Z 会被误判为已带时区而漏加 +08:00
  const hasZone = /(?:Z|[+-]\d\d:?\d\d)$/i.test(t)
  const d = new Date(hasZone ? t : t + '+08:00')
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
  // 只接受数组：调用方若误传了 { source, banners } 这类对象，
  // 会在 for...of 处抛 TypeError，导致整个统计流程失败
  const list = Array.isArray(banners) ? banners : []
  for (const b of list) {
    if (!b || b.channel !== channel) continue
    const s = parseLocal(b.start)
    const e = parseLocal(b.end)
    if (!e) continue
    if (timeMs >= s && timeMs <= e) out.push(b)
  }
  return out
}

// 判断某物品在某时刻是否为当期 UP
// 返回 { up, known }：known=false 表示该时刻没有卡池数据，无法判定
//
// 空 UP 名单的卡池（本地反推出的「待人工确认」条目）不参与判定：
// 否则会把「不可判定」误判成「歪」。
const isUpAt = (banners, channel, name, timeMs, itemType) => {
  const active = bannersAt(banners, channel, timeMs)
  if (!active.length) return { up: false, known: false }
  const keys = nameKeys(name)
  let hasUsable = false
  for (const b of active) {
    // 混合池（原神集录祈愿）：角色与武器的 UP 名单分开，按记录类型取用
    // 记录里的 item_type 随游戏语言变化，必须同时识别中英文与各地区译名，
    // 否则英文 locale 下混合池会全部退化为「不可判定」
    let list = b.up || []
    if (b.upByType && itemType) {
      const t = String(itemType)
      if (/角色|代理|character|personaje|personnages|charakter|perso|角色|캐릭터|キャラ/i.test(t)) list = b.upByType.character || []
      else if (/武器|光锥|音擎|weapon|light\s*cone|lightcone|w-?engine|engine|arma|arme|武器|waffe|무기|라이콘|エンジン|武器/i.test(t)) list = b.upByType.weapon || []
    }
    if (!list.length) continue
    hasUsable = true
    for (const u of list) {
      const uk = nameKeys(u)
      if (uk.some((x) => keys.some((y) => x === y))) return { up: true, known: true }
    }
  }
  if (!hasUsable) return { up: false, known: false }
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
  // banners 只接受数组，误传对象时退化为空数组而不是抛错
  const bannerList = Array.isArray(banners) ? banners : []
  const sorted = (Array.isArray(records) ? records : []).slice().sort((a, b) => (parseLocal(a.time) || 0) - (parseLocal(b.time) || 0))
  const marked = sorted.map((rec, index) => {
    const res = isUpAt(bannerList, channel, rec.name, parseLocal(rec.time), rec.item_type)
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
  // 注意：必须基于完整的 tops 序列统计，不能先过滤掉 unknown，
  // 否则被不可判定记录隔开的两条歪会被误算成「连续歪 2 次」，歪串分布虚高。
  let streak = 0
  tops.forEach((m) => {
    // 不可判定记录：打断连续性，但不计入分布
    if (!m.known) {
      if (streak > 0) deviationHistogram[streak] = (deviationHistogram[streak] || 0) + 1
      streak = 0
      return
    }
    // 兜底判定不进入严格指标，同样打断连续性
    if (m.fallback) {
      if (streak > 0) deviationHistogram[streak] = (deviationHistogram[streak] || 0) + 1
      streak = 0
      return
    }
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
    // 只有 1 条五星记录时不存在「间隔」，返回 null 表示无数据（0 会被误解为间隔 0 抽）
    minTopPulls: topGaps.length ? Math.min(...topGaps) : null,
    maxTopPulls: topGaps.length ? Math.max(...topGaps) : null,
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

// ---------- 集录祈愿时间对齐 ----------
// 「集录祈愿」与同期的角色活动祈愿（UP 池）同期开放，但它的时间在 wiki 上是
// 「X版本更新后」这类文字描述，独立维护后常与角色池对不上
// （例如 5.9「月之一」记为 09-10 06:00，实际角色池是 09-09 15:00）。
// 时间不一致会让落在差值区间里的记录被判成「不可判定」。
//
// 因此统一以同期 UP 池的时间为准：start 与 end 都对齐。
// 匹配规则：先取「同版本 + 同相位」的角色池，取不到则放宽到「同版本」。
// 候选有多个（并行池）时取开始时间最早的那个。
const alignJiluTimes = (banners) => {
  const list = Array.isArray(banners) ? banners : []
  const charPools = list.filter((b) => b && b.channel === 'character')
  return list.map((b) => {
    if (!b || b.channel !== 'jilu') return b
    // 手动修正 / 远程拉取的数据优先于内置对齐结果
    if (b.source === 'manual' || b.source === 'remote') return b
    const same = charPools.filter((c) => c.version === b.version && (!b.phase || c.phase === b.phase))
    const pool = same.length ? same : charPools.filter((c) => c.version === b.version)
    if (!pool.length) return b
    // 并行池时以最早开放的那个为准
    const target = pool
      .filter((c) => c.start && c.end)
      .sort((x, y) => (parseLocal(x.start) || 0) - (parseLocal(y.start) || 0))[0]
    if (!target) return b
    if (b.start === target.start && b.end === target.end) return b
    return { ...b, start: target.start, end: target.end }
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
  alignJiluTimes
}
