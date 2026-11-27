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
// 必须在顶层静态 require：
// 函数体内的 require('./module/bannerSource') 无法被 rollup 静态分析，
// 打包后原样残留在 main.js 里，而产物中并不存在该文件，
// 运行到「立即同步」就会抛 "Cannot find module './module/bannerSource'"。
const { fetchBanners } = require('./module/bannerSource')

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

// ---------- 时间工具 / 判定核心 ----------
// 判定与统计的纯逻辑放在 utils/bannerJudge.js（不依赖 Electron，便于 Node 脚本与单测复用），
// 这里直接引入并对外 re-export，保证数据加载与判定两处逻辑不会漂移。
const {
  parseLocal,
  formatLocal,
  bannersAt,
  isUpAt,
  judgePool,
  calcPoolStats,
  analyzePool,
  alignJiluTimes
} = require('./utils/bannerJudge')

// ---------- 规范化 ----------
// 统一为内部结构：{ version, phase, channel, title, start, end, up: [], up4: [], upByType? }
// 扩展字段（缺省不影响，方案 §2.5）：source / confidence / upIds / needsManual / candidates
// defaultSource：该批数据的来源标记（内置 builtin / 手动 manual / 远程 remote），
// banner 自带 source 时以其为准
const normalizeBanner = (b, defaultSource = 'builtin') => ({
  version: String(b.version || ''),
  phase: String(b.phase || ''),
  channel: String(b.channel || ''),
  title: String(b.title || ''),
  start: String(b.start || ''),
  end: String(b.end || ''),
  up: (b.up || []).map((x) => String(x).trim()).filter(Boolean),
  up4: (b.up4 || []).map((x) => String(x).trim()).filter(Boolean),
  // 数据来源：builtin 内置基线 / local 本地反推 / manual 手动修正 / remote 远程拉取
  source: String(b.source || defaultSource),
  // 反推置信度：high 唯一最高级物品 / low 待人工确认
  confidence: b.confidence ? String(b.confidence) : '',
  // UP 物品的 item_id（可选，便于按 ID 匹配）
  upIds: (b.upIds || []).map((x) => String(x)).filter(Boolean),
  // 待人工确认的期次（反推时出现多种最高级物品）
  needsManual: !!b.needsManual,
  candidates: (b.candidates || []).map((x) => String(x).trim()).filter(Boolean),
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

const normalizeSet = (set, defaultSource = 'builtin') => {
  const banners = (set && Array.isArray(set.banners) ? set.banners : []).map((b) => normalizeBanner(b, defaultSource))
  return {
    source: (set && set.source) || '',
    timezone: (set && set.timezone) || 'UTC+8',
    updated: (set && set.updated) || '',
    note: (set && set.note) || '',
    banners
  }
}

// ---------- 合并（纯逻辑见 utils/bannerMerge.js） ----------
const { mergeBanners, bannerKey } = require('./utils/bannerMerge')

// ---------- 本地覆盖层 ----------
// 覆盖层里的每条数据都带有自己的 source（manual 手动修正 / remote 远程拉取），
// 旧文件没有 source 时按手动处理
const getOverride = async (game) => {
  const p = path.join(OVERRIDE_DIR, `${game}.json`)
  const data = await readJSONSafe(p)
  return data ? normalizeSet(data, 'manual') : null
}

const saveOverride = async (game, set) => {
  const p = path.join(OVERRIDE_DIR, `${game}.json`)
  await writeJSONSafe(p, set)
}

// 写入覆盖层条目（手动修正 / 外部导入共用）
const saveBannerEntries = async (game, banners, meta = {}) => {
  const current = await getOverride(game)
  const set = {
    source: meta.source || 'manual',
    timezone: 'UTC+8',
    updated: new Date().toISOString().slice(0, 10),
    note: meta.note || '',
    banners: [...(current?.banners || []), ...banners]
  }
  await saveOverride(game, set)
  return set
}

// 清除覆盖层中来自远程的数据（保留手动修正）
const clearRemoteBanners = async (game) => {
  const current = await getOverride(game)
  if (!current || !current.banners.length) return { removed: 0, total: 0 }
  const kept = current.banners.filter((b) => b.source !== 'remote')
  const removed = current.banners.length - kept.length
  if (removed > 0) {
    await saveOverride(game, {
      source: current.source || 'manual',
      timezone: 'UTC+8',
      updated: new Date().toISOString().slice(0, 10),
      note: current.note || '',
      banners: kept
    })
  }
  return { removed, total: kept.length }
}

// ---------- 本地反推层（第②层） ----------
// 与手动/远程覆盖层分开存放，避免两者互相覆盖
const getLocalInferred = async (game) => {
  const p = path.join(OVERRIDE_DIR, `${game}.local.json`)
  const data = await readJSONSafe(p)
  return data ? normalizeSet(data, 'local') : null
}

const saveLocalInferred = async (game, set) => {
  const p = path.join(OVERRIDE_DIR, `${game}.local.json`)
  await writeJSONSafe(p, set)
}

// ---------- 集录祈愿开始时间补齐 ----------
// 见 utils/bannerJudge.js（alignJiluTimes）

// ---------- 合并内置 + 本地反推 + 覆盖层 ----------
// 三层优先级（方案 §2.1）：
//   第①层 内置基线      src/gachaBanner/<game>.json     随包分发，最权威
//   第②层 本地反推      userData/gachaBanner/<game>.local.json  只补空白，不覆盖内置
//   第③层 手动/远程覆盖 userData/gachaBanner/<game>.json       UP 以覆盖层为准
const getLocalBanners = async (game) => {
  const builtin = normalizeSet(builtinBanners[game])
  // 原神额外合并「集录祈愿」内置数据（独立 channel，与主源不冲突）
  const extra = game === 'genshin' ? normalizeSet(genshinJilu) : null
  const builtinAll = extra && extra.banners.length
    ? mergeBanners(builtin.banners, extra.banners).banners
    : builtin.banners

  // 第②层：本地反推（不覆盖内置已有 UP 与时间）
  const inferred = await getLocalInferred(game)
  const withInferred = inferred && inferred.banners.length
    ? mergeBanners(builtinAll, inferred.banners, { overrideUp: false, overrideTime: false, fillEmptyUp: true }).banners
    : builtinAll

  // 第③层：手动 / 远程覆盖（UP 以覆盖层为准）
  const override = await getOverride(game)
  if (!override || !override.banners.length) {
    return { ...builtin, banners: alignJiluTimes(withInferred) }
  }
  const merged = mergeBanners(withInferred, override.banners)
  return {
    source: override.source || builtin.source,
    timezone: 'UTC+8',
    updated: override.updated || builtin.updated,
    note: override.note || builtin.note,
    banners: alignJiluTimes(merged.banners)
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
// 安全约束（方案 §2.4）：
//   只发 GET、不携带任何凭证；响应体积上限 8MB；JSON 结构校验失败即忽略
const fetchRemoteJSON = async (url, options = {}) => {
  // 只允许 http/https，避免 file:// 之类读取本地文件
  if (!/^https?:\/\//i.test(String(url || ''))) {
    throw new Error('invalid url protocol')
  }
  const timeout = Math.max(1, Number(options.timeout) || 30) * 1000
  const retry = Math.max(0, Number(options.retry) || 0)
  let lastError = null
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'MiHoYoGachaExport/1.0.1' },
        timeout
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      // 流式读取并在超限时中断：先读完再判断长度的话，
      // 超大响应已经占满内存，8MB 上限形同虚设
      const reader = res.body && res.body.getReader ? res.body.getReader() : null
      let text = ''
      if (reader) {
        const decoder = new TextDecoder('utf-8')
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          text += decoder.decode(value, { stream: true })
          if (text.length > MAX_REMOTE_BYTES) {
            try { await reader.cancel() } catch (e) {}
            throw new Error('response too large')
          }
        }
        text += decoder.decode()
      } else {
        text = await res.text()
        if (text.length > MAX_REMOTE_BYTES) throw new Error('response too large')
      }
      return JSON.parse(text)
    } catch (e) {
      lastError = e
      if (attempt < retry) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

// 从 Biligame wiki 拉取
const fetchFromWiki = async (game) => {
  const { fetchBanners } = require('./module/wikiBanner')
  return fetchBanners(game)
}

// 从自定义远程地址拉取（需返回 { banners: [...] } 结构）
const fetchFromCustom = async (url, options = {}) => {
  const data = await fetchRemoteJSON(url, options)
  if (!data || !Array.isArray(data.banners)) throw new Error('invalid remote format')
  const set = normalizeSet(data, 'remote')
  // 远程数据统一标记来源，便于「清除远程数据」
  set.banners.forEach((b) => {
    if (!b.source || b.source === 'builtin') b.source = 'remote'
  })
  return set
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
// 标记远程来源（便于「清除远程数据」按来源过滤）
const markRemoteBanners = (set) => {
  set.banners.forEach((b) => {
    if (!b.source || b.source === 'builtin') b.source = 'remote'
  })
  return set
}

// 数据源技术标识 → 用户可见的中文名
//
// 提示语里不直接暴露 hoyo-gacha 这类仓库/站点标识，统一显示为「上游」；
// 只有用户自己填写的自定义地址才原样显示（那是他自己填的，需要认得出）。
// 注意：source 字段仍是技术标识，程序判断与失败详情依赖它，不要改。
const sourceLabel = require('./module/bannerSource').sourceLabel

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
      incoming = await fetchFromCustom(options.customUrl, { timeout: options.timeout, retry: options.retry })
      from = options.customUrl
      attempts.push({ source: from, ok: true })
    } else {
      const r = await fetchBanners(game)
      incoming = markRemoteBanners(normalizeSet(r.data, 'remote'))
      from = r.source
      attempts.push(...(r.attempts || []))
    }
  } catch (e) {
    attempts.push({ source: options.customUrl || 'auto', ok: false, error: e.message })
    // 自定义地址失败时回退到默认源（hoyo-gacha → Biligame wiki）
    if (options.customUrl) {
      try {
        const r = await fetchBanners(game)
        incoming = markRemoteBanners(normalizeSet(r.data, 'remote'))
        from = r.source + '(fallback)'
        attempts.push(...(r.attempts || []))
      } catch (e2) {
        attempts.push({ source: 'auto-fallback', ok: false, error: e2.message })
      }
    }
  }

  if (!incoming) {
    // 失败详情同样用「上游」代替技术标识，但保留具体错误信息（排查问题要用）
    const detail = attempts
      .map((a) => `${sourceLabel(a.source)}(${a.error || 'failed'})`)
      .join('; ')
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
      message: `本地卡池数据与${sourceLabel(from)}完全一致（共 ${local.banners.length} 期），无需更新`,
      total: local.banners.length,
      maxEnd: decision.coverage ? decision.coverage.maxEndText : '',
      source: from
    }
  }

  // 合并始终以本地为基底、只补入本地没有的卡池，
  // 因此米游社源（仅当期）不会覆盖或丢失本地历史数据。
  const merged = mergeBanners(local.banners, incoming.banners)
  // 覆盖层只保存增量（新增 / 被修正），不复制整份内置基线，
  // 否则内置数据后续更新会被旧覆盖层压住。
  if (!merged.changes.length) {
    return {
      game,
      action: 'unchanged',
      reason: 'no-change',
      message: `卡池数据无变化（共 ${local.banners.length} 期），未写入覆盖层`,
      total: local.banners.length,
      maxEnd: decision.coverage ? decision.coverage.maxEndText : '',
      source: from
    }
  }

  // 保留已有的手动修正（手动优先于远程）
  const current = await getOverride(game)
  const existingEntries = current?.banners || []
  const manualEntries = existingEntries.filter((b) => b.source === 'manual')
  const manualKeys = new Set(manualEntries.map((b) => `${b.channel}@${b.start}`))
  const remoteChanges = merged.changes.filter((b) => !manualKeys.has(`${b.channel}@${b.start}`))

  // 本次同步覆盖到的期次（以 channel@start 为键）
  const syncedKeys = new Set(remoteChanges.map((b) => `${b.channel}@${b.start}`))
  // 覆盖层里此前同步来的、本次上游未再返回的期次必须保留：
  // 米游社源只提供当期卡池，若每次都用本次变更重建整份覆盖层，
  // 这些历史期次会被逐次清空，导致历史卡池永久丢失。
  const keptRemoteEntries = existingEntries.filter((b) => {
    if (b.source === 'manual') return false
    return !syncedKeys.has(`${b.channel}@${b.start}`)
  })

  const partial = from === 'mihoyo-wiki'
  const set = {
    source: from,
    timezone: 'UTC+8',
    updated: new Date().toISOString().slice(0, 10),
    note: partial
      ? `由 MiHoYoGachaExport 同步自 ${from}（仅当期卡池，历史沿用本地）`
      : '由 MiHoYoGachaExport 同步自 ' + from,
    banners: [...manualEntries, ...keptRemoteEntries, ...remoteChanges]
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

// 获取用于判定的本地卡池数据（内置 + 反推 + 覆盖层）
const getBanners = async (game) => {
  const local = await getLocalBanners(game)
  return local.banners
}

// ---------- 本地反推（运行时） ----------
// 用本地抽卡记录反推缺失排期的卡池，并持久化到第②层（不改内置基线）
// pools: [{ poolKey, records }]
// 返回 { inferred, pending, saved }
//   inferred —— 唯一最高级物品，置信度高，可直接参与判定
//   pending  —— 出现多种最高级物品，置信度低，需人工确认（UP 名单为空，不参与判定）
const inferLocalBanners = async (game, pools = []) => {
  const { inferGame } = require('./utils/bannerInfer')
  const local = await getLocalBanners(game)
  const { inferred, pending } = inferGame({ game, pools, banners: local.banners })
  const existing = (await getLocalInferred(game))?.banners || []
  const merged = existing.length
    ? mergeBanners(existing, [...inferred, ...pending]).banners
    : [...inferred, ...pending]
  if (merged.length) {
    await saveLocalInferred(game, {
      source: 'local-inferred',
      timezone: 'UTC+8',
      updated: new Date().toISOString().slice(0, 10),
      note: '由本地抽卡记录反推生成；低置信度期次需人工确认',
      banners: merged
    })
  }
  return { inferred, pending, saved: merged.length }
}

// 查询某时刻某 channel 开放的卡池、判断某物品是否为当期 UP：
// 见 utils/bannerJudge.js（bannersAt / isUpAt）

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
  saveBannerEntries,
  clearRemoteBanners,
  markRemoteBanners,
  getLocalInferred,
  saveLocalInferred,
  inferLocalBanners,
  syncBanners,
  needSync,
  getCoverage,
  mergeBanners,
  sameBannerSet,
  bannersAt,
  isUpAt,
  judgePool,
  calcPoolStats,
  analyzePool,
  isDeviationExcluded,
  poolToChannel,
  parseLocal,
  formatLocal,
  normalizeSet,
  bannerKey
}
