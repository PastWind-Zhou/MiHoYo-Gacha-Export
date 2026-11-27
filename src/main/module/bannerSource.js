// 上游卡池数据源
//
// 主源：quantulr/hoyo-gacha 的内置卡池 JSON（MIT 许可，数据取自 Biligame wiki）
//       与随包分发的内置基线完全同构，可直接比对
// 备用：Biligame wiki 页面解析（主源断更或网络不可达时使用）
//
// 两个源都提供「全量历史卡池」，不是只提供增量。

const fetch = require('electron-fetch').default

// 主源：GitHub Raw
const UPSTREAM_SOURCES = {
  genshin: {
    file: 'genshin-banners.json',
    url: 'https://raw.githubusercontent.com/quantulr/hoyo-gacha/main/assets/genshin-banners.json'
  },
  hkrpg: {
    file: 'starrail-banners.json',
    url: 'https://raw.githubusercontent.com/quantulr/hoyo-gacha/main/assets/starrail-banners.json'
  },
  nap: {
    file: 'zzz-banners.json',
    url: 'https://raw.githubusercontent.com/quantulr/hoyo-gacha/main/assets/zzz-banners.json'
  }
}

const MAX_REMOTE_BYTES = 8 * 1024 * 1024

const fetchText = async (url, headers = {}) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'MiHoYoGachaExport/1.0.1 (+https://github.com/)',
      Accept: 'application/json, text/plain, */*',
      ...headers
    },
    timeout: 30000
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  // 流式读取并在超限时中断：先读完再判断长度的话，
  // 超大响应已经占满内存，8MB 上限形同虚设
  const reader = res.body && res.body.getReader ? res.body.getReader() : null
  if (!reader) {
    const text = await res.text()
    if (text.length > MAX_REMOTE_BYTES) throw new Error('response too large')
    return text
  }
  const decoder = new TextDecoder('utf-8')
  let text = ''
  try {
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
  } finally {
    try { reader.releaseLock && reader.releaseLock() } catch (e) {}
  }
  return text
}

// 校验上游返回的卡池结构：只检查 banners 是数组不够，
// 元素结构变了也要能触发降级链
const isValidBannerSet = (data) => {
  if (!data || !Array.isArray(data.banners)) return false
  if (!data.banners.length) return false
  return data.banners.every((b) => {
    if (!b || typeof b !== 'object') return false
    return typeof b.channel === 'string' && b.channel.length > 0 &&
      typeof b.start === 'string' && typeof b.end === 'string'
  })
}

// 主源：拉取 hoyo-gacha 的卡池 JSON
const fetchFromUpstream = async (game) => {
  const src = UPSTREAM_SOURCES[game]
  if (!src) throw new Error('no upstream source for ' + game)
  const text = await fetchText(src.url)
  const data = JSON.parse(text)
  if (!isValidBannerSet(data)) throw new Error('invalid upstream format')
  return data
}

// 备用源：Biligame wiki 解析
const fetchFromWiki = async (game) => {
  const { fetchBanners } = require('./wikiBanner')
  return fetchBanners(game)
}

// 应急源：米游社官方 wiki（仅当期卡池）
const fetchFromMihoyo = async (game) => {
  const { fetchMihoyoBanners } = require('./mihoyoBanner')
  return fetchMihoyoBanners(game)
}

// 按优先级依次尝试，主源失败自动降级
//   1. hoyo-gacha（GitHub Raw）—— 全量历史快照
//   2. Biligame wiki —— 全量历史，解析 HTML
//   3. 米游社官方 wiki —— 仅当期卡池（应急）
// 内置源标识 → 用户可见的中文名
//
// 提示语里不暴露 hoyo-gacha 这类仓库/站点标识，统一显示为「上游」。
// 多个源依次失败时用序号区分是第几个源挂了，保留排查所需的信息。
// 注意：source 字段仍是技术标识，程序判断依赖它，不要改。
const sourceLabel = (source, index = -1) => {
  const name = String(source || '')
  if (!name) return '上游'
  // 自定义地址原样显示（那是用户自己填的，需要认得出）
  if (/^https?:\/\//i.test(name)) return name
  if (index >= 0) return `上游${index + 1}`
  return '上游'
}

const fetchBanners = async (game) => {
  const attempts = []
  const chain = [
    { source: 'hoyo-gacha', run: () => fetchFromUpstream(game) },
    { source: 'biligame-wiki', run: () => fetchFromWiki(game) },
    { source: 'mihoyo-wiki', run: () => fetchFromMihoyo(game) }
  ]
  for (const step of chain) {
    try {
      const data = await step.run()
      attempts.push({ source: step.source, ok: true })
      return { data, source: step.source, attempts }
    } catch (e) {
      attempts.push({ source: step.source, ok: false, error: e.message })
    }
  }
  const err = new Error('所有卡池数据源均不可用：' +
    attempts
      .map((a, i) => sourceLabel(a.source, i) + '(' + (a.error || 'failed') + ')')
      .join('; '))
  err.attempts = attempts
  throw err
}

module.exports = { fetchBanners, fetchFromUpstream, fetchFromWiki, fetchFromMihoyo, UPSTREAM_SOURCES, sourceLabel }
