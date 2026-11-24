// 米游社官方 wiki 卡池源（应急备用）
//
// 仅同步「当期卡池」：
//   1. gacha_pool 接口拿当期卡池（标题、时间区间、公告链接、卡池类型）
//      https://act-api-takumi.mihoyo.com/common/blackboard/<app_sn>/v1/gacha_pool
//   2. 公告正文 API 拿 UP 物品名
//      https://bbs-api.mihoyo.com/post/wapi/getPostFull?post_id=<id>
//      正文形如「活动期间，限定S级代理人[赛维里安(风·强攻)]的调频获取概率将大幅提升！」
//
// 三个游戏的 app_sn：
//   zzz_wiki（绝区零绳网情报站） / sr_wiki（星穹铁道观测枢） / ys_obc（原神）
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

// 从公告正文提取 UP 物品
//
// 三个游戏的公告格式不同：
//   绝区零：活动期间，限定S级代理人[赛维里安(风·强攻)]的调频获取概率将大幅提升！
//            （卡池名在上一行：「「答案在风中」调频活动」）
//   星铁：  ● 「愚戏众星」角色活动跃迁期间，限定5星角色「星神★阿哈（欢愉•量子）」，…跃迁成功概率限时提升。
//            （卡池名与描述同行）
//   原神：  ●活动期间，限定5星角色「驹隙隐泉·兹白(岩)」的祈愿获取概率将大幅提升！
//            （正文无卡池名，取自公告标题）
//
// 正则必须严格：一旦品类词（角色/代理人/…）出现就立即取随后的第一个名字，
// 否则会一路贪婪匹配到 4 星角色。
const UP_ITEM_RE = /限定(?:5星|S级)?\s*(角色|代理人|光锥|武器|音擎)?\s*[\[「]([^\]」]+)[\]」]/
// 独立的卡池标题行：「「卡池名」调频活动」/「「卡池名」祈愿」/「「卡池名」跃迁」
const TITLE_LINE_RE = /^「(.+?)」\s*(调频活动|祈愿|跃迁|角色活动|武器活动|光锥活动)/

const parseUpsFromPost = (html, subject = '') => {
  const lines = postToLines(html)
  const ups = []

  // 原神：公告标题形如「「华黍由仪」祈愿：「驹隙隐泉·兹白(岩)」概率UP！」
  const subjMatch = String(subject || '').match(/^「(.+?)」.*?「([^」]+)」/)
  if (subjMatch) {
    const name = subjMatch[2].replace(/[（(][^）)]*[）)]\s*$/, '').trim()
    if (name) ups.push({ title: subjMatch[1], up: name, desc: subject, category: '' })
  }

  // 扫描：记录最近的独立标题行，作为后续描述行的卡池名
  let pendingTitle = ''
  for (const line of lines) {
    const titleLine = line.match(TITLE_LINE_RE)
    if (titleLine) {
      pendingTitle = titleLine[1]
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
    ups.push({ title, up, desc: line, category: itemMatch[1] || '' })
  }

  // 同一卡池名保留第一个
  const seen = new Set()
  return ups.filter((u) => {
    if (seen.has(u.title + '|' + u.up)) return false
    seen.add(u.title + '|' + u.up)
    return true
  })
}

// 判断卡池类型（角色 / 武器 / 光锥 / 音擎）
// 依据描述 UP 的品类词，比卡池代号更可靠
const detectChannel = (title, upName, desc) => {
  const t = [title, upName, desc].filter(Boolean).join(' ')
  if (/音擎/.test(t)) return 'engine'
  if (/光锥/.test(t)) return 'lightcone'
  if (/武器/.test(t)) return 'weapon'
  return 'character'
}

// 拉取米游社当期卡池
const fetchMihoyoBanners = async (game) => {
  const appSn = APP_SN[game]
  if (!appSn) throw new Error('no mihoyo wiki source for ' + game)

  const poolRes = await fetchJSON(GACHA_POOL_API(appSn), { Referer: 'https://baike.mihoyo.com/' })
  if (poolRes.retcode !== 0) throw new Error('gacha_pool retcode ' + poolRes.retcode)
  const list = (poolRes.data && poolRes.data.list) || []
  if (!list.length) throw new Error('gacha_pool returned empty list')

  // 收集公告文章 id（activity_url 形如 https://www.miyoushe.com/sr/article/79466344）
  const postIds = new Set()
  for (const item of list) {
    const m = String(item.activity_url || '').match(/article\/(\d+)/)
    if (m) postIds.add(m[1])
  }

  // 抓公告正文，解析出「卡池名 -> UP」
  const upMap = new Map()
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
      if (!upMap.has(item.title)) upMap.set(item.title, item)
    }
  }

  // 标题归一化：去掉「」、祈愿/跃迁/调频活动等后缀，便于与 gacha_pool 的 title 对齐
  const normTitle = (t) => String(t || '')
    .replace(/[「」『』]/g, '')
    .replace(/(调频活动|祈愿|跃迁|活动跃迁|角色活动跃迁|光锥活动跃迁|武器活动祈愿|角色活动祈愿)$/g, '')
    .trim()

  // 组装卡池
  const banners = []
  for (const item of list) {
    const rawTitle = String(item.title || '')
    const title = normTitle(rawTitle)

    // 在解析结果里找标题匹配的卡池
    let hit = upMap.get(title)
    if (!hit) {
      for (const [k, v] of upMap) {
        if (normTitle(k) === title) { hit = v; break }
      }
    }
    if (!hit) {
      // 放宽：卡池名包含关系（星铁「铭心之萃」vs「铭心之萃•银狼LV.999」）
      for (const [k, v] of upMap) {
        const nk = normTitle(k)
        if (nk && (nk.includes(title) || title.includes(nk))) { hit = v; break }
      }
    }
    if (!hit) continue

    // 卡池类型以公告中的品类词为准（角色/代理人 → character，光锥 → lightcone，
    // 武器 → weapon，音擎 → engine）
    const cat = hit.category || ''
    let ch = 'character'
    if (/音擎/.test(cat) || /音擎/.test(hit.desc)) ch = 'engine'
    else if (/光锥/.test(cat) || /光锥/.test(hit.desc)) ch = 'lightcone'
    else if (/武器/.test(cat) || /武器/.test(hit.desc)) ch = 'weapon'
    const channels = new Set([ch])

    for (const ch of channels) {
      banners.push({
        version: '',
        phase: '',
        channel: ch,
        title: rawTitle,
        start: item.start_time || '',
        end: item.end_time || '',
        up: [hit.up],
        up4: []
      })
    }
  }

  if (!banners.length) {
    throw new Error('could not resolve UP items from mihoyo announcement')
  }

  return {
    source: 'mihoyo-wiki',
    timezone: 'UTC+8',
    updated: new Date().toISOString().slice(0, 10),
    note: '米游社官方 wiki 当期卡池',
    banners
  }
}

module.exports = { fetchMihoyoBanners, parseUpsFromPost, detectChannel, APP_SN }
