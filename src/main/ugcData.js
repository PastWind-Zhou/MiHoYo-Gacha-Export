const fs = require('fs-extra')
const path = require('path')
const { ipcMain } = require('electron')
const { request, sleep, sendMsg, saveJSON, userDataPath } = require('./utils')
const config = require('./config')
const i18n = require('./i18n')
const { games } = require('./games')
const { getData, getApiUrl } = require('./getData')
const { mergeList } = require('./utils/mergeData')
const { isValidUid, isInsideDir, normalizeTimezone, uidTimeZone, normalizeUGCAccount } = require('./utils/uigf42')

// 千星奇域（hk4e_ugc）数据链路：
//   抓取：与常规祈愿共用 authkey（日志/缓存/代理链路复用 getData.getUrl），
//         但走独立 endpoint getBeyondGachaLog，size=5，类型只有 1000/2000
//   存储：独立 userData/genshin/ugc-list-<uid>.json，不混入 gacha-list，
//         内存缓存 ugcMap 也不进 getData.dataMap，避免污染常规统计
//   导入导出：UIGFJson.js 复用本文件的 saveUGCAccount / loadUGCAccounts 透传

const UGC_DIR = 'genshin'
const ugcMap = new Map()
let ugcDataReaded = false

// 与 getData.getQuerystring 相同的 authkey 纠偏：authkey 值本身可能含未编码的 '='
const fixAuthkey = (url) => {
  const mr = url.match(/authkey=([^&]+)/)
  if (mr && mr[1] && mr[1].includes('=') && !mr[1].includes('%')) {
    return url.replace(/authkey=([^&]+)/, `authkey=${encodeURIComponent(mr[1])}`)
  }
  return url
}

// 解析 authkey URL：选 CN/OS 域名并清掉分页/类型参数。
// 优先复用 getData.getApiUrl()（内部已做完日志/代理取链路与清洗），
// 只有渲染层显式传入 URL 时才走这里的本地清洗逻辑
const parseUGCUrl = (url) => {
  const g = games.genshin
  const text = i18n.log
  const { searchParams, host } = new URL(fixAuthkey(String(url)))
  if (!searchParams.get('authkey')) {
    sendMsg(text.url.lackAuth)
    return null
  }
  const isOS = g.osHostHints.some(hint => host.includes(hint))
  const domain = isOS ? g.domainOS : g.domainCN
  ;['page', 'size', 'gacha_type', 'end_id'].forEach(k => searchParams.delete(k))
  return { domain, searchParams }
}

// retcode 状态检查（与 getData.checkResStatus 行为一致，仅作用域不同）
const checkUGCResStatus = (res) => {
  const text = i18n.log
  if (res && res.retcode === 0) return res
  let message = res?.message || res
  if (res?.message === 'authkey timeout') {
    message = text.fetch.authTimeout
    sendMsg(true, 'AUTHKEY_TIMEOUT')
  }
  sendMsg(message)
  throw new Error(message)
}

// 单页请求：-110 限流退避重试（与 getGachaLog 一致：限流等 10s、其它 5s，共 5 次）；
// authkey 失效不做无意义重试，直接中断整体流程（吸取审计 2.5 的教训）
const getUGCLog = async ({ name, page, url, endId, retryCount }) => {
  const text = i18n.log
  try {
    const res = await request(`${url}&end_id=${endId}`)
    if (res?.data?.list) return res.data
    if (res?.retcode === -110) {
      const err = new Error(res?.message || 'visit too frequently')
      err.rateLimited = true
      throw err
    }
    if (res?.message === 'authkey timeout' || res?.retcode === -101) {
      const err = new Error(text.fetch.authTimeout)
      err.noRetry = true
      throw err
    }
    throw new Error(res?.message || res)
  } catch (e) {
    if (e.noRetry) throw e
    if (retryCount) {
      sendMsg(i18n.parse(text.fetch.retry, { name, page, count: 6 - retryCount }))
      await sleep(e.rateLimited ? 10 : 5)
      return await getUGCLog({ name, page, url, endId, retryCount: retryCount - 1 })
    }
    sendMsg(i18n.parse(text.fetch.retryFailed, { name, page }))
    throw e
  }
}

// 单类型分页抓取：官方 total 恒为 0，不能据此算页数，
// 只能按「list 为空」结束；end_id 取每页最后一条 id 推进游标
const getUGCLogs = async ({ name, type, url }) => {
  const g = games.genshin
  let page = 1
  let endId = '0'
  let list = []
  let uid = ''
  let logs = []
  do {
    await sleep(g.pageDelay ?? 0.3)
    sendMsg(i18n.parse(i18n.log.fetch.current, { name, page }))
    const pageUrl = `${url}&${g.ugcTypeParam}=${type}&page=${page}&size=${g.ugcPageSize}`
    const res = await getUGCLog({ name, page, url: pageUrl, endId, retryCount: 5 })
    logs = res?.list || []
    if (!uid && logs.length && isValidUid(logs[0].uid)) {
      uid = String(logs[0].uid).trim()
    }
    list.push(...logs)
    if (logs.length) {
      endId = String(logs[logs.length - 1].id)
    }
    page += 1
    // 增量停止：本页已覆盖本地最新记录时不再翻页（与 getGachaLogs 一致）
    if (!config.fetchFullHistory && logs.length && uid && ugcMap.has(uid)) {
      const localList = ugcMap.get(uid).list
      if (localList && localList.length) {
        const localLatestId = localList[localList.length - 1].id
        if (localLatestId && logs.some(item => String(item.id) === localLatestId)) {
          break
        }
      }
    }
  } while (logs.length > 0)
  return { list, uid }
}

const ugcDir = () => path.join(userDataPath, UGC_DIR)

// 读取全部千星奇域账号（导出 UIGF 时也走这里）
const loadUGCAccounts = async () => {
  const dir = ugcDir()
  await fs.ensureDir(dir)
  const files = await fs.readdir(dir)
  const accounts = []
  for (const fname of files) {
    if (/^ugc-list-\d+\.json$/.test(fname)) {
      try {
        const account = await fs.readJSON(path.join(dir, fname))
        const normalized = normalizeUGCAccount(account)
        if (normalized) accounts.push(normalized)
      } catch (e) {}
    }
  }
  return accounts
}

// 保存单个千星奇域账号：uid 先过正则校验，再确认目标路径仍在游戏目录内。
// uid 直接参与文件名拼接，形如 x/../../evil 的值会把数据写到 userData 之外（审计 1.1）
const saveUGCAccount = async (account) => {
  const uid = String(account?.uid ?? '').trim()
  if (!isValidUid(uid)) {
    throw new Error(`非法 uid: ${uid || '(空)'}`)
  }
  const dir = ugcDir()
  const fileName = `ugc-list-${uid}.json`
  const target = path.join(dir, fileName)
  if (!isInsideDir(dir, target)) {
    throw new Error('非法落盘路径')
  }
  const ok = await saveJSON(path.join(UGC_DIR, fileName), account)
  if (ok) {
    // 同步内存缓存：UIGF 导入也走这里，避免 READ_UGC_DATA 读到旧数据
    ugcMap.set(uid, account)
  }
  return ok
}

// 读取本地千星奇域数据到内存（独立于 getData.readData，不进 dataMap）
const readUGCData = async (force = false) => {
  if (ugcDataReaded && !force) return ugcMap
  // 必须等配置加载完成：与 readData 同样的竞态约束
  await config.ready
  const accounts = await loadUGCAccounts()
  accounts.forEach(account => ugcMap.set(String(account.uid), account))
  // 读完再置标志：提前置位会让并发调用拿到半空的 ugcMap（审计 2.7 的教训）
  ugcDataReaded = true
  return ugcMap
}

// 主动抓取千星奇域数据，返回归一后的账号对象（与 READ_UGC_DATA 同一结构）。
// param 支持 { uid?, url? }：
//   - uid：渲染层传入的当前账号，仅当接口记录没带 uid 时作为回退
//   - url：显式 authkey URL；缺省时走 getApiUrl()，复用日志/缓存/代理取链路
// 历史上还支持直接传 URL 字符串，这里保留兼容
const fetchUGCData = async (param = {}) => {
  await config.ready
  const { uid: uidParam, url: urlOverride } = typeof param === 'string'
    ? { uid: undefined, url: param }
    : (param || {})
  if (config.game !== 'genshin') {
    const message = '千星奇域数据仅支持原神'
    sendMsg(message)
    throw new Error(message)
  }
  await readUGCData()
  const g = games.genshin
  let parsed = null
  try {
    if (urlOverride) {
      parsed = parseUGCUrl(urlOverride)
    } else {
      const apiUrl = await getApiUrl()
      if (apiUrl) parsed = parseUGCUrl(apiUrl)
    }
  } catch (e) {
    parsed = null
  }
  if (!parsed) {
    const message = i18n.log.url.notFound2
    sendMsg(message)
    throw new Error(message)
  }
  // authkey 有效性探测：与原神常规链路一致走 getConfigList
  const probeRes = await request(`${parsed.domain}${g.apiBase}getConfigList?${parsed.searchParams.toString()}`)
  checkUGCResStatus(probeRes)

  const base = `${parsed.domain}${g.apiBase}${g.ugcEndpoint}?${parsed.searchParams.toString()}`
  const allRecords = []
  let uid = ''
  for (const type of g.ugcTypeOrder) {
    const { list, uid: typeUid } = await getUGCLogs({ name: `千星奇域-${type}`, type, url: base })
    if (typeUid && !uid) uid = typeUid
    allRecords.push(...list)
  }
  // uid 优先级：接口记录（最权威）> 渲染层显式传入 > 当前原神账号。
  // 千星奇域接口不一定带 uid，回退逻辑与 getData.tryGetUid 保持一致
  if (!uid && isValidUid(uidParam)) uid = String(uidParam).trim()
  if (!uid) uid = String(getData().current ?? '')
  if (!isValidUid(uid)) {
    const message = '无法确定千星奇域账号 uid'
    sendMsg(message, 'ERROR')
    throw new Error(message)
  }
  if (!allRecords.length && !ugcMap.has(uid)) {
    const message = '获取数据失败，请稍后重试'
    sendMsg(message, 'ERROR')
    throw new Error(message)
  }
  // 记录级归一（字段裁剪、类型过滤、按 id 排序）复用 normalizeUGCAccount
  const fresh = normalizeUGCAccount({ uid, timezone: uidTimeZone(uid), lang: config.lang, list: allRecords })
  const localAccount = ugcMap.get(uid)
  // 已有账号保留本地 timezone / lang：导出 roundtrip 字段一致，不被新抓覆盖
  const account = localAccount
    ? { ...localAccount, list: mergeList(localAccount.list, fresh.list) }
    : fresh
  await saveUGCAccount(account)
  return account
}

// 按 uid 取出内存中的账号，并统一经 normalizeUGCAccount 保证字段与导出格式一致。
// uid 非法或不存在时返回 null（与 ugc-ui 契约的「无数据」语义一致）
const getUGCAccount = (uid) => {
  const target = String(uid ?? config.current ?? '').trim()
  if (!isValidUid(target)) return null
  const account = ugcMap.get(target)
  return account ? normalizeUGCAccount(account) : null
}

const rejectNonGenshin = (game) => {
  if (game && game !== 'genshin') {
    return { ok: false, error: '千星奇域数据仅支持原神' }
  }
  return null
}

// IPC 契约（与 feature/1.0.2-c-ugc-ui 完全一致）：
//   参数 { game, uid? }，返回 { ok: true, data: Account|null } | { ok: false, error: string }
//   Account = { uid, timezone, lang, list[] }
// 渲染层在 state.game !== 'genshin' 时不会调用；这里仍按契约返回结构化错误
ipcMain.handle('FETCH_UGC_DATA', async (event, param = {}) => {
  try {
    await config.ready
    const { game, uid, url } = (param && typeof param === 'object') ? param : {}
    const rejected = rejectNonGenshin(game) || rejectNonGenshin(config.game)
    if (rejected) return rejected
    const account = await fetchUGCData({ uid, url })
    return { ok: true, data: account }
  } catch (e) {
    sendMsg(e, 'ERROR')
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('READ_UGC_DATA', async (event, param = {}) => {
  try {
    await config.ready
    const { game, uid } = (param && typeof param === 'object') ? param : {}
    const rejected = rejectNonGenshin(game) || rejectNonGenshin(config.game)
    if (rejected) return rejected
    await readUGCData()
    return { ok: true, data: getUGCAccount(uid) }
  } catch (e) {
    sendMsg(e, 'ERROR')
    return { ok: false, error: e.message || String(e) }
  }
})

module.exports = {
  ugcMap,
  fetchUGCData,
  readUGCData,
  getUGCAccount,
  saveUGCAccount,
  loadUGCAccounts
}
