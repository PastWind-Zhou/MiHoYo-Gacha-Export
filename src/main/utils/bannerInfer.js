// 卡池数据的本地反推增强（方案 §2.1 第②层）
//
// 目标：内置基线里的某期卡池缺 UP 名单（或该期完全没有排期数据）时，
// 用玩家本地记录中的最高级物品反推该期 UP，结果写入 userData 永久保留，
// 不修改随包分发的内置基线表。
//
// 反推置信度：
//   high —— 该区段内只出现过一种最高级物品 → 该物品即当期 UP
//   low  —— 该区段内出现多种最高级物品 → 无法确定谁是 UP，标记为待人工确认
const { judgePool, parseLocal } = require('./bannerJudge')
const { games } = require('../games')

const SOURCE_LOCAL = 'local'

// 在最高级记录序列中切出「没有卡池数据」的连续区段
const segmentsOfUnknown = (tops) => {
  const segments = []
  let current = []
  tops.forEach((m) => {
    if (!m.known) {
      current.push(m)
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  })
  if (current.length) segments.push(current)
  return segments
}

// 反推单个卡池：返回 { inferred, pending, marked }
//
// 两条来源：
//   ① 内置/合并表里「UP 名单为空」的期次 → 用落在该期区间内的最高级记录反推
//      （方案 §2.1：某期卡池缺 UP 名单时，用该期记录中的 S 级物品反推）
//   ② 完全没有排期数据的区间 → 该区间内只出现唯一最高级物品时才反推
const inferPool = ({ records = [], banners = [], channel = '', topRank = '5' }) => {
  const marked = judgePool({ records, banners, channel, topRank })
  const tops = marked.filter((m) => m.top)
  const inferred = []
  const pending = []

  // ① 缺 UP 名单的期次
  const emptyBanners = (banners || []).filter((b) => {
    if (b.channel !== channel) return false
    const upCount = (b.up || []).length
    const byTypeCount = b.upByType
      ? (b.upByType.character || []).length + (b.upByType.weapon || []).length
      : 0
    return upCount === 0 && byTypeCount === 0
  })
  const covered = []
  emptyBanners.forEach((b) => {
    const s = parseLocal(b.start)
    const e = parseLocal(b.end)
    if (!s || !e) return
    const inRange = tops.filter((m) => {
      const t = parseLocal(m.time)
      return t >= s && t <= e
    })
    if (!inRange.length) return
    covered.push({ s, e })
    const names = [...new Set(inRange.map((m) => m.name).filter(Boolean))]
    const base = {
      version: b.version || '',
      phase: b.phase || '',
      channel,
      title: b.title || '本地反推',
      start: b.start,
      end: b.end,
      up: [],
      up4: [],
      source: SOURCE_LOCAL
    }
    if (names.length === 1) {
      inferred.push({ ...base, up: names, confidence: 'high' })
    } else {
      // 该期出现多种最高级物品 → 无法确定谁是 UP，交人工确认
      pending.push({ ...base, confidence: 'low', needsManual: true, candidates: names })
    }
  })

  // ② 完全没有排期数据的区间（排除已被 ① 覆盖的记录）
  const segments = segmentsOfUnknown(tops).filter((segment) => !segment.some((m) => {
    const t = parseLocal(m.time)
    return covered.some((c) => t >= c.s && t <= c.e)
  }))
  segments.forEach((segment) => {
    const names = [...new Set(segment.map((m) => m.name).filter(Boolean))]
    const start = segment[0].time
    const end = segment[segment.length - 1].time
    const banner = {
      version: '',
      phase: '',
      channel,
      title: '本地反推',
      start,
      end,
      up: [],
      up4: [],
      source: SOURCE_LOCAL,
      confidence: 'low'
    }
    if (names.length === 1) {
      banner.up = names
      banner.confidence = 'high'
      inferred.push(banner)
    } else {
      // 无法确定当期 UP：保留候选，交由设置页人工确认
      banner.needsManual = true
      banner.candidates = names
      pending.push(banner)
    }
  })

  return { inferred, pending, marked }
}

// 按游戏聚合：pools 为 [{ poolKey, records }]
// 跳过两类池：
//   1. 没有排期映射的池（常驻 / 新手 / 独家重映等）—— 本来就没有 UP 概念
//   2. 不参与歪率统计的池（集录祈愿、音擎回响等）—— UP 由玩家自选，推不出也不该推
const inferGame = ({ game, pools = [], banners = [] }) => {
  const g = games[game]
  if (!g) return { inferred: [], pending: [] }
  const inferred = []
  const pending = []
  // 先按 channel 聚合记录：
  // 原神 400 与 301 都映射到 character（共用保底），若分池各自反推，
  // 会对同一 channel 生成区间重叠、UP 冲突的两条条目。
  const byChannel = new Map()
  ;(pools || []).forEach((pool) => {
    if (!pool) return
    const key = String(pool.poolKey)
    if (Array.isArray(g.noDeviationPools) && g.noDeviationPools.includes(key)) return
    const channel = g.poolChannel?.[key] || ''
    if (!channel) return
    if (!byChannel.has(channel)) byChannel.set(channel, [])
    byChannel.get(channel).push(...(Array.isArray(pool.records) ? pool.records : []))
  })
  for (const [channel, records] of byChannel) {
    const res = inferPool({
      records,
      banners,
      channel,
      topRank: g.ranks?.top || '5'
    })
    inferred.push(...res.inferred)
    pending.push(...res.pending)
  }
  return { inferred, pending }
}

// 判断某条记录是否落在反推出的卡池区间内（用于验证反推效果）
const isInsideInferred = (banner, time) => {
  const t = parseLocal(time)
  const s = parseLocal(banner.start)
  const e = parseLocal(banner.end)
  if (!t || !s || !e) return false
  return t >= s && t <= e
}

module.exports = {
  SOURCE_LOCAL,
  segmentsOfUnknown,
  inferPool,
  inferGame,
  isInsideInferred
}
