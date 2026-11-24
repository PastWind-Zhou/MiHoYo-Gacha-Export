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
  const text = await res.text()
  if (text.length > MAX_REMOTE_BYTES) throw new Error('response too large')
  return text
}

// 主源：拉取 hoyo-gacha 的卡池 JSON
const fetchFromUpstream = async (game) => {
  const src = UPSTREAM_SOURCES[game]
  if (!src) throw new Error('no upstream source for ' + game)
  const text = await fetchText(src.url)
  const data = JSON.parse(text)
  if (!data || !Array.isArray(data.banners)) throw new Error('invalid upstream format')
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
    attempts.map((a) => a.source + '(' + (a.error || 'failed') + ')').join('; '))
  err.attempts = attempts
  throw err
}

module.exports = { fetchBanners, fetchFromUpstream, fetchFromWiki, fetchFromMihoyo, UPSTREAM_SOURCES }
