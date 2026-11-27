// Biligame wiki 卡池历史页解析器
// 三个游戏的「往期祈愿 / 历史跃迁 / 调频」页面结构高度相似：
//   每个卡池是一个 <table class="wikitable ...">，行标签为 时间 / 版本 / 5星角色(等)
//   「时间」字段形如 "起始描述 ~ 结束时间"，起始可能是文字（如「4.7版本更新后」）
//   结束时间是权威值；起始缺失时由同 channel 上一期的结束时间推定
const fetch = require('electron-fetch').default

const SOURCES = {
  genshin: 'https://wiki.biligame.com/ys/%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF',
  hkrpg: 'https://wiki.biligame.com/sr/%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81',
  nap: 'https://wiki.biligame.com/zzz/%E8%B0%83%E9%A2%91'
}

// 额外页面：原神「集录祈愿」(gacha_type=500) 是独立的角色+武器混合池，
// 不在「往期祈愿」页里，需单独抓取
const EXTRA_SOURCES = {
  genshin: [
    {
      url: 'https://wiki.biligame.com/ys/%E9%9B%86%E5%BD%95%E7%A5%88%E6%84%BF',
      channel: 'jilu'
    }
  ]
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
  times: '×', divide: '÷', deg: '°', plusmn: '±'
}

const decodeEntities = (s) => String(s)
  .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch (e) {
        return match
      }
    }
    const key = body.toLowerCase()
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match
  })
  // 未以分号结尾的常见实体（部分 wiki 输出不补分号）
  .replace(/&(nbsp|amp|lt|gt|quot)(?![a-zA-Z0-9#])/g, (match, key) => NAMED_ENTITIES[key.toLowerCase()] || match)

const textOf = (h) => decodeEntities(String(h).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

const cleanName = (name) => String(name)
  .replace(/[〔〔\[]/g, '').replace(/[〕〕\]]/g, '')
  .replace(/^[「『"]/, '').replace(/[」』"]$/, '')
  .trim()

// UP5 行的标签 → channel
const UP5_LABELS = {
  '5星角色': 'character',
  '5星光锥': 'lightcone',
  '5星武器': 'weapon',
  '5星代理人': 'character',
  '5星音擎': 'engine',
  'S级代理人': 'character',
  'S级音擎': 'engine'
}
const UP4_LABELS = ['4星角色', '4星光锥', '4星武器', '4星代理人', '4星音擎', 'A级代理人', 'A级音擎']

const linkNames = (html) => {
  const out = []
  const re = /<a([^>]*)>([\s\S]*?)<\/a>/g
  let m
  while ((m = re.exec(html))) {
    const tm = m[1].match(/title="([^"]*)"/)
    const name = tm ? decodeEntities(tm[1]) : textOf(m[2])
    if (name) out.push(cleanName(name))
  }
  return out
}

const parseRows = (html) => {
  const rows = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRe.exec(html))) {
    const cells = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g
    let tm
    while ((tm = tdRe.exec(m[1]))) cells.push(tm[1])
    rows.push(cells)
  }
  return rows
}

const parseTimeParts = (t) => {
  const parts = t.split(/[~～至]/)
  const fmt = (s) => {
    const m = String(s).trim().match(/(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/)
    if (!m) return ''
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')} ` +
      `${String(m[4] || '00').padStart(2, '0')}:${String(m[5] || '00').padStart(2, '0')}:00`
  }
  return { start: fmt(parts[0]), end: fmt(parts[parts.length - 1]) }
}

const extractTitle = (rows, rawTable) => {
  const alt = rawTable.match(/<img[^>]*alt="([^"]*)"/)
  if (alt && alt[1]) return decodeEntities(alt[1]).trim()
  for (const cell of rows[0] || []) {
    const t = textOf(cell)
    if (t) return t
  }
  return ''
}

const parsePage = (html) => {
  const results = []
  const tableRe = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g
  let tm
  while ((tm = tableRe.exec(html))) {
    const raw = tm[1]
    const rows = parseRows(raw)
    if (!rows.length) continue
    const obj = { title: extractTitle(rows, raw), channel: '', start: '', end: '', version: '', up5: [], up4: [] }

    for (const row of rows) {
      const cells = row.map((x) => textOf(x))
      const label = cells[0] || ''
      if (label === '时间') {
        const t = parseTimeParts(cells.slice(1).join(' '))
        obj.start = t.start
        obj.end = t.end
      } else if (label === '版本') {
        obj.version = cells[1] || ''
      } else if (UP5_LABELS[label]) {
        const names = []
        for (const cell of row.slice(1)) {
          const links = linkNames(cell)
          if (links.length) {
            names.push(...links)
          } else {
            textOf(cell).replace(/[〔〕\[\]]/g, ' ').split(/\s+/).forEach((x) => {
              if (x) names.push(cleanName(x))
            })
          }
        }
        obj.up5 = [...new Set(names.filter(Boolean))]
        obj.channel = UP5_LABELS[label]
      } else if (UP4_LABELS.includes(label)) {
        const names = []
        for (const cell of row.slice(1)) names.push(...linkNames(cell))
        obj.up4 = [...new Set(names.filter(Boolean))]
      }
    }
    if (!obj.up5.length) continue
    if (!obj.channel) {
      obj.channel = /音擎/.test(obj.title) ? 'engine'
        : /光锥/.test(obj.title) ? 'lightcone'
          : /武器/.test(obj.title) ? 'weapon' : 'character'
    }
    results.push(obj)
  }
  return results
}

// ---------- 原神「集录祈愿」页 ----------
// 结构与「往期祈愿」页不同：每个卡池由一对表格组成
//   表A（信息）：卡池名称 / 时间 / 版本 / 备注
//   表B（明细）：时间 / 版本 / 5星角色 / 4星角色 / 5星武器 / 4星武器
// 5星角色与5星武器分列在两行 —— 这是混合池，两者都是 UP 名单，
// 判定时需按抽卡记录的 item_type 分别取用。
const parseJiluPage = (html) => {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  const tableRe = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g
  const tables = []
  let tm
  while ((tm = tableRe.exec(clean)) !== null) {
    const rows = []
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
    let r
    while ((r = trRe.exec(tm[1])) !== null) {
      const cells = []
      const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g
      let td
      while ((td = tdRe.exec(r[1])) !== null) cells.push(td[1])
      rows.push(cells)
    }
    tables.push(rows)
  }

  const namesOf = (cellHtml) => {
    const out = []
    const re = /<a([^>]*)>([\s\S]*?)<\/a>/g
    let m
    while ((m = re.exec(cellHtml)) !== null) {
      const t = m[1].match(/title="([^"]*)"/)
      const name = t ? decodeEntities(t[1]) : textOf(m[2])
      const clean2 = cleanName(name)
      if (clean2) out.push(clean2)
    }
    if (out.length) return out
    return textOf(cellHtml).replace(/[〔〕\[\]]/g, ' ').split(/\s+/).filter(Boolean).map(cleanName)
  }

  const results = []
  for (let i = 0; i < tables.length; i += 2) {
    const infoRows = tables[i] || []
    const detailRows = tables[i + 1] || []
    if (!detailRows.length) continue

    let title = ''
    let timeText = ''
    let version = ''
    for (const row of infoRows) {
      const label = textOf(row[0] || '')
      if (label === '卡池名称') title = textOf(row[1] || '')
      if (label === '时间') timeText = textOf(row[1] || '')
      if (label === '版本') version = textOf(row[1] || '')
    }
    if (!title || !timeText) continue

    let upChar = []
    let upWeapon = []
    let up4Char = []
    let up4Weapon = []
    for (const row of detailRows) {
      const label = textOf(row[0] || '')
      if (label === '5星角色') upChar = row.slice(1).flatMap(namesOf)
      else if (label === '5星武器') upWeapon = row.slice(1).flatMap(namesOf)
      else if (label === '4星角色') up4Char = row.slice(1).flatMap(namesOf)
      else if (label === '4星武器') up4Weapon = row.slice(1).flatMap(namesOf)
    }
    if (!upChar.length && !upWeapon.length) continue

    const t = parseTimeParts(timeText)
    if (!t.end) continue
    const vm = String(version).match(/^(.+?)(上半|下半)?$/)
    results.push({
      version: vm ? vm[1] : version,
      phase: vm && vm[2] ? vm[2] : '',
      channel: 'jilu',
      title,
      start: t.start,
      end: t.end,
      up: [...upChar, ...upWeapon],
      up4: [...up4Char, ...up4Weapon],
      upByType: { character: upChar, weapon: upWeapon }
    })
  }
  return results
}

// 缺失的开始时间由同 channel 上一期的结束时间推定
const inferStarts = (list) => {
  const byCh = {}
  for (const x of list) {
    if (!byCh[x.channel]) byCh[x.channel] = []
    byCh[x.channel].push(x)
  }
  for (const ch of Object.keys(byCh)) {
    const arr = byCh[ch].filter((x) => x.end).sort((a, b) => (a.end < b.end ? -1 : 1))
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].start) continue
      if (i > 0) {
        arr[i].start = arr[i - 1].end
      } else {
        const e = new Date(arr[i].end.replace(' ', 'T') + '+08:00').getTime()
        arr[i].start = new Date(e - 21 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      }
    }
  }
  return list
}

// 拉取并解析某游戏的卡池排期
const fetchBanners = async (game) => {
  const url = SOURCES[game]
  if (!url) throw new Error('no wiki source for ' + game)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    // 必须设超时：降级链在此挂起会导致整个同步流程永久不返回
    timeout: 30000
  })
  if (!res.ok) throw new Error('wiki HTTP ' + res.status)
  const html = await res.text()
  const list = inferStarts(parsePage(html))

  // 额外页面（原神集录祈愿）
  // 注意：集录祈愿的期次并不连续（中间隔着常规角色池），
  // 因此不能用「上一期结束时间」推定缺失的开始时间 ——
  // 那样会得到远早于实际的值。缺失的 start 留空，
  // 由 gachaBanner.alignJiluTimes 用内置角色池的同期时间补齐。
  const extras = EXTRA_SOURCES[game] || []
  const warnings = []
  for (const ex of extras) {
    try {
      const r2 = await fetch(ex.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9'
        },
        timeout: 30000
      })
      if (!r2.ok) {
        warnings.push(`wiki HTTP ${r2.status}: ${ex.url}`)
        continue
      }
      const extra = parseJiluPage(await r2.text())
      for (const x of extra) {
        x.channel = ex.channel
        list.push(x)
      }
    } catch (e) {
      // 额外页面失败不影响主数据，但要留下痕迹便于排查
      warnings.push(`${ex.url}: ${e && e.message}`)
    }
  }

  return {
    source: url,
    timezone: 'UTC+8',
    updated: new Date().toISOString().slice(0, 10),
    note: '从 Biligame wiki 抓取',
    ...(warnings.length ? { warnings } : {}),
    banners: list.map((x) => ({
      version: x.version,
      phase: x.phase,
      channel: x.channel,
      title: x.title,
      start: x.start,
      end: x.end,
      up: x.up,
      up4: x.up4,
      ...(x.upByType ? { upByType: x.upByType } : {})
    }))
  }
}

module.exports = { fetchBanners, parsePage, parseJiluPage, inferStarts, SOURCES, EXTRA_SOURCES }
