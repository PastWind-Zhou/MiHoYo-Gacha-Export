// 卡池排期数据管理
//
// 数据分层：
//   第①层 内置基线   src/gachaBanner/<game>.json      随包分发，不覆盖
//   第②层 本地覆盖   userData/gachaBanner/<game>.json 用户/远程同步结果
//   第③层 远程数据源 设置页可配置任意 URL（返回同结构 JSON）
//
// 同步策略（按需求）：
//   1. 先校验本地（内置 + 覆盖层）合并后的卡池排期
//   2. 若本地排期已覆盖当前系统时间 → 不同步
//   3. 若当前时间已超出本地排期 → 自动联网拉取（增量合并）
//   4. 若本地完全没有卡池信息 → 全量拉取
const fs = require('fs-extra')
const path = require('path')
const fetch = require('electron-fetch').default
const { games } = require('./games')
const { userDataPath } = require('./paths')

const BANNER_DIR = path.resolve(__dirname, '../gachaBanner')
// 覆盖层放在 userData 下，随应用数据目录走（打包后路径由 utils 计算）
const OVERRIDE_DIR = path.resolve(userDataPath, 'gachaBanner')

// 内置基线（require 会被打包进 main.js）
const builtinBanners = {
  hkrpg: require('../gachaBanner/hkrpg.json'),
  genshin: require('../gachaBanner/genshin.json'),
  nap: require('../gachaBanner/nap.json')
}

// 原神「集录祈愿」(gacha_type=500) 是独立的角色+武器混合池，
// 不在 hoyo-gacha 主源数据中，单独内置一份（来自 Biligame wiki 集录祈愿页）
const genshinJilu = require('../gachaBanner/genshin-jilu.json')

const MAX_REMOTE_BYTES = 8 * 1024 * 1024 // 远程响应最大 8MB

const readJSONSafe = async (p) => {
  try {
    return await fs.readJSON(p)
  } catch (e) {
    return null
  }
}

const writeJSONSafe = async (p, data) => {
  await fs.ensureDir(path.dirname(p))
  await fs.writeJSON(p, data, { spaces: 2 })
}

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

// ---------- 规范化 ----------
// 统一为内部结构：{ version, phase, channel, title, start, end, up: [], up4: [], upByType? }
const normalizeBanner = (b) => ({
  version: String(b.version || ''),
  phase: String(b.phase || ''),
  channel: String(b.channel || ''),
  title: String(b.title || ''),
  start: String(b.start || ''),
  end: String(b.end || ''),
  up: (b.up || []).map((x) => String(x).trim()).filter(Boolean),
  up4: (b.up4 || []).map((x) => String(x).trim()).filter(Boolean),
  // 混合池（角色+武器分开列 UP 名单）
  ...(b.upByType
    ? {
        upByType: {
          character: (b.upByType.character || []).map((x) => String(x).trim()).filter(Boolean),
          weapon: (b.upByType.weapon || []).map((x) => String(x).trim()).filter(Boolean)
        }
      }
    : {})
})

const normalizeSet = (set) => {
  const banners = (set && Array.isArray(set.banners) ? set.banners : []).map(normalizeBanner)
  return {
    source: (set && set.source) || '',
    timezone: (set && set.timezone) || 'UTC+8',
    updated: (set && set.updated) || '',
    note: (set && set.note) || '',
    banners
  }
}

// ---------- 合并 ----------
// 同一 (channel, 结束时间) 下可能存在多个并行卡池（游戏会同期开放两个角色池），
// 因此不能简单用 channel@end 做唯一键，否则并行池会互相覆盖导致数据丢失。
// 这里采用「分组 + 贪心配对」：
//   1. 按 (channel, 结束日期) 把 base 与 incoming 分组
//      —— 只精确到日期：不同数据源的结束时间可能有秒级差异
//         （内置用 14:59:59，wiki 用 14:59:00），精确到秒会导致完全配不上
//   2. 组内先按 UP 名单集合精确配对（同一卡池 → incoming 的 UP 更权威）
//   3. 组内剩余的按顺序配对（UP 被修正的情况）
//   4. incoming 中没配上的 → 新卡池，追加
//   5. base 中没配上的 → 保留不动
// 合并时保留 base 的 start（上游按「版本更新或上一期结束时间推定」，比远端推定更准）。
// end 仅在「日期」发生变化时才更新（真正的排期修正）；秒级差异忽略。
const bannerKey = (b) => `${b.channel}@${String(b.end || '').slice(0, 10)}`
const upSetKey = (b) => (b.up || []).slice().sort().join('|')

// 结束时间是否发生了实质变化（日期不同才算）
const endChanged = (a, b) => String(a || '').slice(0, 10) !== String(b || '').slice(0, 10)

const mergeBanners = (base, incoming) => {
  const cloneBanner = (b) => ({
    ...b,
    up: [...(b.up || [])],
    up4: [...(b.up4 || [])],
    ...(b.upByType
      ? { upByType: { character: [...(b.upByType.character || [])], weapon: [...(b.upByType.weapon || [])] } }
      : {})
  })
  const result = base.map(cloneBanner)
  const baseUsed = new Array(result.length).fill(false)
  const incomingUsed = new Array(incoming.length).fill(false)
  let added = 0
  let updated = 0

  // 按 (channel,end) 分组
  const groupOf = (arr, keyFn) => {
    const m = new Map()
    arr.forEach((x, i) => {
      const k = keyFn(x)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(i)
    })
    return m
  }
  const baseGroups = groupOf(result, bannerKey)
  const inGroups = groupOf(incoming, bannerKey)

  for (const [slot, bIdx] of baseGroups) {
    const iIdx = inGroups.get(slot) || []
    if (!iIdx.length) continue

    // 2. UP 名单精确配对
    const iByUp = new Map()
    for (const i of iIdx) {
      const k = upSetKey(incoming[i])
      if (!iByUp.has(k)) iByUp.set(k, [])
      iByUp.get(k).push(i)
    }
    const remainingI = []
    for (const bi of bIdx) {
      const k = upSetKey(result[bi])
      const pool = iByUp.get(k)
      let matched = -1
      if (pool) {
        while (pool.length) {
          const cand = pool.shift()
          if (!incomingUsed[cand]) { matched = cand; break }
        }
      }
      if (matched >= 0) {
        baseUsed[bi] = true
        incomingUsed[matched] = true
        const upChanged = upSetKey(result[bi]) !== upSetKey(incoming[matched])
        const eChanged = endChanged(result[bi].end, incoming[matched].end)
        if (upChanged || eChanged) updated++
        result[bi] = {
          ...result[bi],
          end: eChanged ? incoming[matched].end : result[bi].end,
          up: [...(incoming[matched].up || [])],
          ...(incoming[matched].upByType
            ? {
                upByType: {
                  character: [...(incoming[matched].upByType.character || [])],
                  weapon: [...(incoming[matched].upByType.weapon || [])]
                }
              }
            : {})
        }
      } else {
        remainingI.push(bi)
      }
    }

    // 3. 剩余按顺序配对
    const freeI = iIdx.filter((i) => !incomingUsed[i])
    for (let k = 0; k < remainingI.length && k < freeI.length; k++) {
      const bi = remainingI[k]
      const ii = freeI[k]
      baseUsed[bi] = true
      incomingUsed[ii] = true
      const upChanged = upSetKey(result[bi]) !== upSetKey(incoming[ii])
      const eChanged = endChanged(result[bi].end, incoming[ii].end)
      if (upChanged || eChanged) updated++
      // 保留 base 的 start；end 仅在日期变化时更新；up 以 incoming 为准
      result[bi] = {
        ...result[bi],
        end: eChanged ? incoming[ii].end : result[bi].end,
        up: [...(incoming[ii].up || [])],
        ...(incoming[ii].upByType
          ? {
              upByType: {
                character: [...(incoming[ii].upByType.character || [])],
                weapon: [...(incoming[ii].upByType.weapon || [])]
              }
            }
          : {})
      }
    }
  }

  // 4. incoming 中没配上的 → 新卡池
  for (let i = 0; i < incoming.length; i++) {
    if (incomingUsed[i]) continue
    result.push(cloneBanner(incoming[i]))
    added++
  }

  result.sort((a, b) => (parseLocal(a.start) || 0) - (parseLocal(b.start) || 0))
  return { banners: result, added, updated }
}

// ---------- 本地覆盖层 ----------
const getOverride = async (game) => {
  const p = path.join(OVERRIDE_DIR, `${game}.json`)
  const data = await readJSONSafe(p)
  return data ? normalizeSet(data) : null
}

const saveOverride = async (game, set) => {
  const p = path.join(OVERRIDE_DIR, `${game}.json`)
  await writeJSONSafe(p, set)
}

// ---------- 集录祈愿开始时间补齐 ----------
// 「集录祈愿」与同版本同相位的角色池同期开放，其 wiki 上的起始时间是
// 「X版本更新后」这类文字描述，无法直接解析。
// 这里用内置角色池的同期开始时间补齐（内置数据的上游推定更准）。
const fillJiluStarts = (banners) => {
  const charPools = banners.filter((b) => b.channel === 'character')
  return banners.map((b) => {
    if (b.channel !== 'jilu' || b.start) return b
    const same = charPools.filter((c) => c.version === b.version && (!b.phase || c.phase === b.phase))
    const pool = same.length ? same : charPools.filter((c) => c.version === b.version)
    if (!pool.length) return b
    const start = pool.map((c) => c.start).filter(Boolean).sort()[0]
    return start ? { ...b, start } : b
  })
}

// ---------- 合并内置 + 覆盖层 ----------
const getLocalBanners = async (game) => {
  const builtin = normalizeSet(builtinBanners[game])
  // 原神额外合并「集录祈愿」内置数据（独立 channel，与主源不冲突）
  const extra = game === 'genshin' ? normalizeSet(genshinJilu) : null
  const builtinAll = extra && extra.banners.length
    ? mergeBanners(builtin.banners, extra.banners).banners
    : builtin.banners

  const override = await getOverride(game)
  if (!override || !override.banners.length) {
    return { ...builtin, banners: fillJiluStarts(builtinAll) }
  }
  const merged = mergeBanners(builtinAll, override.banners)
  return {
    source: override.source || builtin.source,
    timezone: 'UTC+8',
    updated: override.updated || builtin.updated,
    note: override.note || builtin.note,
    banners: fillJiluStarts(merged.banners)
  }
}

// ---------- 覆盖度判定 ----------
// 本地排期的最晚结束时间是否已覆盖 now
//
// 注意：联动池等长期开放的卡池，其结束时间被记为 9999-12-31（哨兵值），
// 不能参与覆盖度计算 —— 否则本地永远「已覆盖」，过期同步就永远不会触发。
// 因此这里只统计结束时间在合理范围内的卡池。
const SENTINEL_END = '9999-01-01 00:00:00'

const getCoverage = (banners) => {
  let maxEnd = 0
  let maxEndText = ''
  const coveredChannels = new Set()
  for (const b of banners) {
    const e = parseLocal(b.end)
    if (!e || e >= parseLocal(SENTINEL_END)) continue
    if (e > maxEnd) { maxEnd = e; maxEndText = formatLocal(e) }
    coveredChannels.add(b.channel)
  }
  return { maxEnd, maxEndText, channels: [...coveredChannels] }
}

// 判断是否需要同步
//   noLocal   → 本地完全没有卡池信息 → 全量拉取
//   expired  → 当前时间已超出本地排期 → 增量拉取
//   ok       → 本地排期已覆盖当前时间 → 不同步
const needSync = (banners, now = Date.now()) => {
  if (!banners || !banners.length) return { action: 'full', reason: 'noLocal' }
  const cov = getCoverage(banners)
  if (!cov.maxEnd) return { action: 'full', reason: 'noLocal' }
  if (now > cov.maxEnd) {
    return { action: 'incremental', reason: 'expired', coverage: cov }
  }
  return { action: 'none', reason: 'fresh', coverage: cov }
}

// ---------- 远程拉取 ----------
const fetchRemoteJSON = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MiHoYoGachaExport/1.0.1' },
    timeout: 30000
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const text = await res.text()
  if (text.length > MAX_REMOTE_BYTES) throw new Error('response too large')
  return JSON.parse(text)
}

// 从 Biligame wiki 拉取
const fetchFromWiki = async (game) => {
  const { fetchBanners } = require('./module/wikiBanner')
  return fetchBanners(game)
}

// 从自定义远程地址拉取（需返回 { banners: [...] } 结构）
const fetchFromCustom = async (url) => {
  const data = await fetchRemoteJSON(url)
  if (!data || !Array.isArray(data.banners)) throw new Error('invalid remote format')
  return normalizeSet(data)
}

// ---------- 一致性比对 ----------
// 判断传入的卡池集合与本地是否完全一致（期数、每期的 channel/时间/UP名单）
// 用于「与上游一致则不更新」
// 时间只精确到分钟：不同数据源的秒级表示可能不同（14:59:59 vs 14:59:00）
const sameBannerSet = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  const norm = (list) => list.map((x) => [
    x.channel,
    String(x.start || '').slice(0, 16),
    String(x.end || '').slice(0, 16),
    (x.up || []).slice().sort().join('|')
  ].join('@')).sort().join('\n')
  return norm(a) === norm(b)
}

// ---------- 对外主接口 ----------
// 检查并按需同步某游戏的卡池数据
//
// 流程（按需求）：
//   1. 校验本地（内置 + 覆盖层）排期是否覆盖当前时间
//   2. 覆盖 → 不同步
//   3. 当前时间超出本地排期 → 联网拉取
//   4. 本地无任何卡池信息 → 全量拉取
//
// 数据源优先级：hoyo-gacha（主）→ Biligame wiki（备用）
// 拉到的数据与本地完全一致时，不写入覆盖层。
//
// options: { force: 强制同步, customUrl: 自定义远程地址 }
const syncBanners = async (game, options = {}) => {
  const local = await getLocalBanners(game)
  const decision = needSync(local.banners)

  if (!options.force && decision.action === 'none') {
    return {
      game,
      action: 'skipped',
      reason: 'local-up-to-date',
      message: `本地卡池排期已覆盖当前时间（至 ${decision.coverage.maxEndText}），无需同步`,
      total: local.banners.length,
      maxEnd: decision.coverage.maxEndText
    }
  }

  let incoming = null
  let from = ''
  const attempts = []
  try {
    if (options.customUrl) {
      incoming = await fetchFromCustom(options.customUrl)
      from = options.customUrl
      attempts.push({ source: from, ok: true })
    } else {
      const r = await require('./module/bannerSource').fetchBanners(game)
      incoming = normalizeSet(r.data)
      from = r.source
      attempts.push(...(r.attempts || []))
    }
  } catch (e) {
    attempts.push({ source: options.customUrl || 'auto', ok: false, error: e.message })
    // 自定义地址失败时回退到默认源（hoyo-gacha → Biligame wiki）
    if (options.customUrl) {
      try {
        const r = await require('./module/bannerSource').fetchBanners(game)
        incoming = normalizeSet(r.data)
        from = r.source + '(fallback)'
        attempts.push(...(r.attempts || []))
      } catch (e2) {
        attempts.push({ source: 'auto-fallback', ok: false, error: e2.message })
      }
    }
  }

  if (!incoming) {
    const detail = attempts.map((a) => `${a.source}(${a.error || 'failed'})`).join('; ')
    return {
      game,
      action: 'failed',
      reason: 'fetch-failed',
      message: '卡池数据拉取失败：' + detail,
      errors: attempts,
      total: local.banners.length,
      maxEnd: decision.coverage ? decision.coverage.maxEndText : ''
    }
  }

  // 与本地完全一致 → 不更新（不写覆盖层）
  if (sameBannerSet(local.banners, incoming.banners)) {
    return {
      game,
      action: 'unchanged',
      reason: 'same-as-upstream',
      message: `本地卡池数据与 ${from} 完全一致（共 ${local.banners.length} 期），无需更新`,
      total: local.banners.length,
      maxEnd: decision.coverage ? decision.coverage.maxEndText : '',
      source: from
    }
  }

  // 合并始终以本地为基底、只补入本地没有的卡池，
  // 因此米游社源（仅当期）不会覆盖或丢失本地历史数据。
  const merged = mergeBanners(local.banners, incoming.banners)
  const partial = from === 'mihoyo-wiki'
  const set = {
    source: from,
    timezone: 'UTC+8',
    updated: new Date().toISOString().slice(0, 10),
    note: partial
      ? `由 MiHoYoGachaExport 同步自 ${from}（仅当期卡池，历史沿用本地）`
      : '由 MiHoYoGachaExport 同步自 ' + from,
    banners: merged.banners
  }
  await saveOverride(game, set)

  const cov = getCoverage(merged.banners)
  return {
    game,
    action: decision.action === 'full' ? 'full' : 'updated',
    reason: decision.reason,
    message: decision.action === 'full'
      ? `已全量拉取卡池数据，共 ${merged.banners.length} 期（新增 ${merged.added} 期）`
      : `已增量更新卡池数据，新增 ${merged.added} 期、修正 ${merged.updated} 期，当前共 ${merged.banners.length} 期`,
    added: merged.added,
    updated: merged.updated,
    total: merged.banners.length,
    maxEnd: cov.maxEndText,
    source: from
  }
}

// 获取用于判定的本地卡池数据（内置 + 覆盖层）
const getBanners = async (game) => {
  const local = await getLocalBanners(game)
  return local.banners
}

// 查询某时刻某 channel 开放的卡池
const bannersAt = (banners, channel, timeMs) => {
  const out = []
  for (const b of banners) {
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
//
// 名称归一化：不同数据源的引号写法不一致（米游社用『』、内置基线用「」、
// 抽卡记录用「」或无引号），因此比较时同时尝试「原样」与「去引号」两种形式。
const nameKeys = (s) => {
  const raw = String(s || '').trim()
  const plain = raw
    .replace(/[「」『』"'“”]/g, '')
    .split(/\s+/).join(' ')
  const stripped = raw.replace(/^[「『"'“]|[」』"'”]$/g, '').split(/\s+/).join(' ')
  return [raw, plain, stripped]
}

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

// ---------- 歪率统计排除 ----------
// 某些池无法判定 UP/歪（如原神集录祈愿的定轨目标由玩家自选，官方不返回），
// 这些池的记录不参与歪率统计，但仍可在明细中展示。
const isDeviationExcluded = (game, poolKey) => {
  const g = games[game]
  if (!g || !Array.isArray(g.noDeviationPools)) return false
  return g.noDeviationPools.includes(String(poolKey))
}

// 抽卡记录池 → 卡池排期 channel（未映射的池返回空串，表示无排期数据）
const poolToChannel = (game, poolKey) => {
  const g = games[game]
  if (!g || !g.poolChannel) return ''
  return g.poolChannel[String(poolKey)] || ''
}

module.exports = {
  getBanners,
  getLocalBanners,
  getOverride,
  saveOverride,
  syncBanners,
  needSync,
  getCoverage,
  mergeBanners,
  sameBannerSet,
  bannersAt,
  isUpAt,
  isDeviationExcluded,
  poolToChannel,
  parseLocal,
  formatLocal,
  normalizeSet,
  bannerKey
}
