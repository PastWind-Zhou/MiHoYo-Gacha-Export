// 卡池判定覆盖率验证脚本（开发期工具，不参与打包）
//
// 用法：
//   node tools/verify-banner-coverage.js [userData目录]
//   node tools/verify-banner-coverage.js "D:\path\to\userData"
//
// 作用：拿真实抽卡记录跑一遍判定引擎，输出每个卡池的
//   记录总数 / 最高级物品数 / 可判定数 / 覆盖率 / UP 数 / 歪数 / 不可判定数
// 用于验证「最高级记录 100% 可判定」这一验收标准，并定位无法判定的具体记录。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const { analyzePool, fillJiluStarts } = require(path.join(ROOT, 'src/main/utils/bannerJudge'))
const { games } = require(path.join(ROOT, 'src/main/games'))

const DEFAULT_USER_DATA = 'D:\\软件\\抽卡分析\\MiHoYo\\build\\MiHoYoGachaExport-1.0.0\\userData'
const userDataDir = process.argv[2] || DEFAULT_USER_DATA

const BANNER_FILES = {
  genshin: ['genshin.json', 'genshin-jilu.json'],
  hkrpg: ['hkrpg.json'],
  nap: ['nap.json']
}

const loadBanners = (game) => {
  const dir = path.join(ROOT, 'src/gachaBanner')
  const all = []
  for (const file of BANNER_FILES[game]) {
    const set = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const b of set.banners || []) {
      all.push({
        version: String(b.version || ''),
        phase: String(b.phase || ''),
        channel: String(b.channel || ''),
        title: String(b.title || ''),
        start: String(b.start || ''),
        end: String(b.end || ''),
        up: (b.up || []).map((x) => String(x).trim()).filter(Boolean),
        up4: (b.up4 || []).map((x) => String(x).trim()).filter(Boolean),
        ...(b.upByType
          ? {
              upByType: {
                character: (b.upByType.character || []).map((x) => String(x).trim()).filter(Boolean),
                weapon: (b.upByType.weapon || []).map((x) => String(x).trim()).filter(Boolean)
              }
            }
          : {})
      })
    }
  }
  return fillJiluStarts(all)
}

// 本地记录归一化（兼容原神旧版数组格式）
const toRecord = (item, poolKey) => {
  if (Array.isArray(item)) {
    const [time, name, itemType, rank, gachaType, id] = item
    return {
      id: id ? String(id) : '',
      name: String(name ?? ''),
      item_type: String(itemType ?? ''),
      rank_type: String(rank ?? ''),
      time: String(time ?? ''),
      gacha_type: gachaType === undefined ? String(poolKey) : String(gachaType)
    }
  }
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    item_type: String(item.item_type ?? ''),
    rank_type: String(item.rank_type ?? ''),
    time: String(item.time ?? ''),
    gacha_type: String(item.gacha_type ?? poolKey)
  }
}

const loadAccount = (file) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const result = new Map()
  const raw = Array.isArray(data.result) ? data.result : Object.entries(data.result || {})
  for (const [poolKey, list] of raw) {
    result.set(String(poolKey), (list || []).map((item) => toRecord(item, poolKey)))
  }
  return { uid: String(data.uid || ''), result }
}

const pad = (s, len) => {
  const str = String(s)
  return str + ' '.repeat(Math.max(0, len - str.length))
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-')

const run = () => {
  if (!fs.existsSync(userDataDir)) {
    console.error(`用户数据目录不存在：${userDataDir}`)
    process.exit(2)
  }
  console.log(`用户数据目录：${userDataDir}`)
  console.log('')

  let problems = 0
  let suspicious = 0
  for (const game of ['genshin', 'hkrpg', 'nap']) {
    const dir = path.join(userDataDir, game)
    if (!fs.existsSync(dir)) {
      console.log(`==== ${games[game].id} ====  （无数据目录，跳过）`)
      continue
    }
    const files = fs.readdirSync(dir).filter((f) => /^gacha-list-\d+\.json$/.test(f))
    if (!files.length) {
      console.log(`==== ${games[game].id} ====  （无抽卡记录文件，跳过）`)
      continue
    }
    const banners = loadBanners(game)
    console.log(`==== ${games[game].id} ====  卡池 ${banners.length} 期`)

    for (const file of files) {
      const account = loadAccount(path.join(dir, file))
      for (const [poolKey, records] of account.result) {
        if (!records.length) continue
        const { channel, topRank, excluded, marked, stats } = analyzePool({
          game,
          poolKey,
          records,
          banners,
          topRank: games[game].ranks.top
        })
        const rate = pct(stats.knownCount, stats.topCount)
        console.log(
          `  池 ${pad(poolKey, 4)} ${pad(channel || '(无排期)', 12)} 记录 ${pad(stats.total, 6)} ` +
          `最高级 ${pad(stats.topCount, 4)} 可判定 ${pad(stats.knownCount, 4)}(${rate}) ` +
          `UP ${pad(stats.upCount, 4)} 歪 ${pad(stats.lostCount, 4)} 不可判定 ${pad(stats.unknownCount, 4)}` +
          (excluded ? '  [不参与歪率统计]' : '') +
          `  不歪率 ${(stats.noDeviationRate * 100).toFixed(2)}%` +
          `  平均UP ${stats.avgUpPulls}抽 平均5星 ${stats.avgTopPulls}抽` +
          `  最欧${stats.minTopPulls}/最非${stats.maxTopPulls}`
        )
        if (stats.unknownCount > 0 && !excluded) {
          problems++
          const samples = marked.filter((m) => m.top && !m.known).slice(0, 5)
          samples.forEach((m) => {
            console.log(`      ↳ 不可判定：${m.time}  ${m.name}  (${m.item_type})`)
          })
          if (stats.unknownCount > samples.length) {
            console.log(`      ↳ …另有 ${stats.unknownCount - samples.length} 条不可判定记录`)
          }
        }
        // 可判定但一个 UP 都没有：多半是池与排期的映射有问题（例如复刻池）
        if (!excluded && stats.knownCount >= 3 && stats.upCount === 0) {
          suspicious++
          console.log(`      ⚠ 可判定 ${stats.knownCount} 条却无 UP，疑似池映射有误`)
        }
      }
    }
    console.log('')
  }

  if (problems === 0) {
    console.log('结论：所有参与歪率统计的卡池，最高级记录 100% 可判定。')
  } else {
    console.log(`结论：存在 ${problems} 个池有不可判定的最高级记录，请检查上方样例。`)
  }
  if (suspicious > 0) {
    console.log(`另有 ${suspicious} 个池存在可疑判定（可判定但无 UP），请检查池与排期的映射。`)
  }
  process.exit(problems === 0 && suspicious === 0 ? 0 : 1)
}

run()
