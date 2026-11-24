// 米游社官方 wiki 卡池源（应急备用）
//
// 仅同步「当期卡池」。数据来源：
//   1. gacha_pool 接口 —— 当期卡池的「代号 + 时间区间」
//      https://act-api-takumi.mihoyo.com/common/blackboard/<app_sn>/v1/gacha_pool
//   2. 公告正文 API —— 当期卡池的「UP 物品 + 品类（角色/光锥/武器/音擎）」
//      https://bbs-api.mihoyo.com/post/wapi/getPostFull?post_id=<id>
//
// 关键：gacha_pool 的 list 里每个条目是一个卡池「代号」，其 pool[] 数组指向该
// 代号下的多个词条，但其中混有 4 星角色、突破材料等无关词条，不能作为 UP 依据。
// 真正的 UP 名单在公告正文里，且角色池与光锥/武器池分列不同的「●」行。
//
// 三个游戏的公告格式：
//   绝区零：独立标题行「「答案在风中」调频活动」+ 方括号 [名字(属性)]
//   星铁：  ▌ 分段，段内每个 ● 行一个卡池（标题与描述同行，书名号）
//   原神：  每个公告一篇，对应一个角色池（武器池在米游社 wiki 无入口）
//
// 无需登录、无需 DS 签名。

const fetch = require('electron-fetch').default

const APP_SN = {
  nap: 'zzz_wiki',
  hkrpg: 'sr_wiki',
  genshin: 'ys_obc'
}

const GACHA_POOL_API = (appSn) =>
  `https://act-api-takumi.mihoyo.com/common/blackboard/${appSn}/v1/gacha_pool?app_sn=${appSn}`

const POST_API = (postId) =>
  `https://bbs-api.mihoyo.com/post/wapi/getPostFull?post_id=${postId}`

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9'
}

const fetchJSON = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { ...HEADERS, ...headers }, timeout: 30000 })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

// 公告正文 → 纯文本行
const postToLines = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

// 「限定5星角色「名字」」/「限定S级代理人[名字]」
// 品类词一旦出现就立即取随后的第一个名字，避免贪婪匹配到 4 星角色
const UP_ITEM_RE = /限定(?:5星|S级)?\s*(角色|代理人|光锥|武器|音擎)?\s*[\[「]([^\]」]+)[\]」]/
// 独立的卡池标题行：「「卡池名」调频活动」/「「卡池名」祈愿」/「「卡池名」跃迁」
const TITLE_LINE_RE = /^「(.+?)」\s*(调频活动|祈愿|跃迁|角色活动|武器活动|光锥活动)/
// 段落分隔：▌ 表示一个批次（如「角色池+光锥池」同时开启）
const SECTION_RE = /^▌/

// 解析公告正文 → 当期卡池列表
// 每项：{ title: 卡池名, up: UP物品名, category: 品类, section: 批次序号 }
const parseUpsFromPost = (html, subject = '') => {
  const lines = postToLines(html)
  const ups = []
  let section = -1
  let pendingTitle = ''

  for (const line of lines) {
    if (SECTION_RE.test(line)) {
      section++
      pendingTitle = ''
      continue
    }
    // 独立卡池标题行（绝区零格式）：记住它，后续描述行归属于它。
    // 每个独立标题行也代表一个新段（绝区零的每个卡池单独成段）。
    const titleLine = line.match(TITLE_LINE_RE)
    if (titleLine) {
      pendingTitle = titleLine[1]
      section++
      continue
    }

    const itemMatch = line.match(UP_ITEM_RE)
    if (!itemMatch) continue

    const up = itemMatch[2].replace(/[（(][^）)]*[）)]\s*$/, '').trim()
    if (!up) continue

    // 卡池名：取「限定」之前的最后一个「」；没有则用最近的独立标题行
    let title = ''
    const before = line.slice(0, itemMatch.index)
    const beforeTitles = before.match(/[「]([^」]+)[」]/g)
    if (beforeTitles && beforeTitles.length) {
      title = beforeTitles[beforeTitles.length - 1].replace(/[「」]/g, '')
    } else if (pendingTitle) {
      title = pendingTitle
    } else if (subject) {
      const sm = String(subject).match(/^「(.+?)」/)
      if (sm) title = sm[1]
    }
    if (!title) continue

    ups.push({ title, up, category: itemMatch[1] || '', desc: line, section })
  }

  // 去重（同一卡池名+UP 只保留一条）
  const seen = new Set()
  return ups.filter((u) => {
    const k = u.title + '|' + u.up
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// 判断卡池类型
const detectChannel = (category, desc) => {
  const t = (category || '') + ' ' + (desc || '')
  if (/音擎/.test(t)) return 'engine'
  if (/光锥/.test(t)) return 'lightcone'
  if (/武器/.test(t)) return 'weapon'
  return 'character'
}

// 标题归一化：去掉「」与卡池类型后缀，便于与 gacha_pool 的 title 对齐
const normTitle = (t) => String(t || '')
  .replace(/[「」『』]/g, '')
  .replace(/(调频活动|祈愿|跃迁|活动跃迁|角色活动跃迁|光锥活动跃迁|武器活动祈愿|角色活动祈愿)$/g, '')
  .trim()

// 拉取米游社当期卡池
const fetchMihoyoBanners = async (game) => {
  const appSn = APP_SN[game]
  if (!appSn) throw new Error('no mihoyo wiki source for ' + game)

  const poolRes = await fetchJSON(GACHA_POOL_API(appSn), { Referer: 'https://baike.mihoyo.com/' })
  if (poolRes.retcode !== 0) throw new Error('gacha_pool retcode ' + poolRes.retcode)
  const list = (poolRes.data && poolRes.data.list) || []
  if (!list.length) throw new Error('gacha_pool returned empty list')

  // 卡池代号 -> 时间区间（含所属公告 postId）
  const periods = list.map((x) => ({
    title: normTitle(x.title),
    rawTitle: x.title,
    start: x.start_time || '',
    end: x.end_time || '',
    postId: (String(x.activity_url || '').match(/article\/(\d+)/) || [])[1]
  }))

  // 抓所有公告，解析出全部当期卡池（按 postId 分组）
  const postIds = [...new Set(periods.map((p) => p.postId).filter(Boolean))]
  const parsed = []
  for (const postId of postIds) {
    let post
    try {
      const r = await fetchJSON(POST_API(postId), { Referer: 'https://bbs.mihoyo.com/' })
      post = r.data && r.data.post && r.data.post.post
    } catch (e) {
      continue
    }
    if (!post || !post.content) continue
    for (const item of parseUpsFromPost(post.content, post.subject || '')) {
      parsed.push({ ...item, postId })
    }
  }

  if (!parsed.length) throw new Error('could not resolve UP items from mihoyo announcement')

  // 给每个卡池分配时间。
  //
  // 公告结构：一个公告含若干「段落」（▌ 分隔），每段代表一批同时开放的卡池
  //（角色池 + 光锥池，或上半 + 下半）。gacha_pool 的每个条目对应一段。
  //
  // 匹配规则（按段而非按单卡池）：
  //   1. 段内任一卡池名与某代号互相包含 → 该段用该代号的时间
  //   2. 段内无法按名称匹配 → 用同公告内剩余的代号（联动池名称与代号无关时）
  const banners = []
  const usedPeriods = new Set()

  // 按 (postId, section) 分组
  const groups = new Map()
  for (const item of parsed) {
    const k = item.postId + '#' + item.section
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(item)
  }

  for (const items of groups.values()) {
    // 1. 按名称匹配代号
    //    注意：一个代号可能对应多个段（星铁上半同时开放多个角色池，
    //    它们共用「铭心之萃」这一个代号），因此已用过的代号仍可复用，
    //    只是优先选未用过的。
    let period = null
    for (const item of items) {
      const nt = normTitle(item.title)
      const cand = periods.filter((p) => {
        if (!p.title || p.postId !== item.postId) return false
        return nt.includes(p.title) || p.title.includes(nt)
      })
      if (cand.length) {
        period = cand.find((p) => !usedPeriods.has(p)) || cand[0]
        break
      }
    }
    // 2. 同公告内剩余的代号（联动池等名称与代号无关的情况）
    if (!period) {
      const rest = periods.filter((p) => p.postId === items[0].postId && !usedPeriods.has(p))
      if (rest.length) period = rest[0]
    }
    // 3. 兜底
    if (!period) period = periods.find((p) => p.postId === items[0].postId) || periods[0]
    if (period) usedPeriods.add(period)

    for (const item of items) {
      banners.push({
        version: '',
        phase: '',
        channel: detectChannel(item.category, item.desc),
        title: item.title,
        start: period.start,
        end: period.end,
        up: [item.up],
        up4: []
      })
    }
  }

  return {
    source: 'mihoyo-wiki',
    timezone: 'UTC+8',
    updated: new Date().toISOString().slice(0, 10),
    note: '米游社官方 wiki 当期卡池',
    banners
  }
}

module.exports = { fetchMihoyoBanners, parseUpsFromPost, detectChannel, normTitle, APP_SN }
