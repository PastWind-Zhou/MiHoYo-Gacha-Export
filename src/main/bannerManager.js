// 卡池数据管理（设置页）：查看卡池表、手动修正 UP、外部导入、远程数据源
const { ipcMain, dialog } = require('electron')
const fs = require('fs-extra')
const config = require('./config')
const {
  getLocalBanners,
  getOverride,
  saveOverride,
  clearRemoteBanners,
  syncBanners,
  needSync
} = require('./gachaBanner')
const {
  validateBannerImport,
  buildManualBanner,
  upsertManualBanner
} = require('./utils/bannerManage')

const today = () => new Date().toISOString().slice(0, 10)

// 查看合并后的卡池表（内置 + 本地反推 + 手动/远程覆盖）
const getBannerTable = async (gameId) => {
  const game = gameId || config.game
  const local = await getLocalBanners(game)
  return {
    game,
    source: local.source,
    updated: local.updated,
    note: local.note,
    total: local.banners.length,
    banners: local.banners.map((b) => ({
      version: b.version,
      phase: b.phase,
      channel: b.channel,
      title: b.title,
      start: b.start,
      end: b.end,
      up: b.up,
      up4: b.up4,
      source: b.source,
      confidence: b.confidence,
      needsManual: b.needsManual,
      candidates: b.candidates
    }))
  }
}

// 手动修正某期 UP 名单
// 兼容两种调用形态：
//   saveBannerUp(gameId, edit) —— 标准形态
//   saveBannerUp(edit)         —— 早期渲染层只传了 edit 对象
const saveBannerUp = async (gameId, edit) => {
  let game = gameId
  let payload = edit
  if (!edit && gameId && typeof gameId === 'object') {
    payload = gameId
    game = null
  }
  const target = game || config.game
  const entry = buildManualBanner(payload)
  if (!entry) return { ok: false, error: 'invalid' }
  const current = await getOverride(target)
  const banners = upsertManualBanner(current?.banners || [], entry)
  await saveOverride(target, {
    source: 'manual',
    timezone: 'UTC+8',
    updated: today(),
    note: '手动修正',
    banners
  })
  return { ok: true, total: banners.length }
}

// 导入外部卡池 JSON（同一期以本次导入为准，避免出现重复期次）
const importBannerJSON = async (gameId) => {
  const game = gameId || config.game
  const filepath = dialog.showOpenDialogSync({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!filepath) return { ok: false, canceled: true }
  try {
    const json = fs.readJsonSync(filepath[0])
    const result = validateBannerImport(json)
    if (!result.ok) {
      return { ok: false, error: result.error, invalid: result.invalid }
    }
    const current = await getOverride(game)
    let banners = current?.banners || []
    result.banners.forEach((entry) => {
      banners = upsertManualBanner(banners, entry)
    })
    await saveOverride(game, {
      source: 'manual',
      timezone: 'UTC+8',
      updated: today(),
      note: '外部导入',
      banners
    })
    return { ok: true, imported: result.banners.length, invalid: result.invalid }
  } catch (e) {
    return { ok: false, error: 'parseFailed', message: e.message }
  }
}

// 立即同步（可指定自定义远程地址）
const syncNow = async (gameId, options = {}) => {
  const game = gameId || config.game
  const result = await syncBanners(game, {
    force: options.force !== false,
    customUrl: options.customUrl || config.bannerSourceUrl || undefined,
    timeout: Number(config.bannerSourceTimeout) || 30,
    retry: Number(config.bannerSourceRetry) || 0
  })
  // 拉取失败时不记录同步时间，避免在间隔期内不再重试
  if (!result || result.action !== 'failed') {
    config.set('bannerLastSync', Date.now())
    await config.save()
  }
  return result
}

// 清除远程数据（保留手动修正）
const clearRemote = async (gameId) => {
  const game = gameId || config.game
  return await clearRemoteBanners(game)
}

// 远程源配置
const getSourceConfig = () => ({
  url: config.bannerSourceUrl || '',
  interval: Number(config.bannerSourceInterval) || 24,
  timeout: Number(config.bannerSourceTimeout) || 30,
  retry: Number(config.bannerSourceRetry) || 0,
  autoSync: !!config.bannerAutoSync,
  lastSync: Number(config.bannerLastSync) || 0
})

const saveSourceConfig = async (patch = {}) => {
  if (typeof patch.url === 'string') config.set('bannerSourceUrl', patch.url.trim())
  if (Number.isFinite(Number(patch.interval))) {
    config.set('bannerSourceInterval', Math.max(1, Number(patch.interval)))
  }
  if (Number.isFinite(Number(patch.timeout))) {
    config.set('bannerSourceTimeout', Math.max(1, Number(patch.timeout)))
  }
  if (Number.isFinite(Number(patch.retry))) {
    config.set('bannerSourceRetry', Math.max(0, Number(patch.retry)))
  }
  if (typeof patch.autoSync === 'boolean') config.set('bannerAutoSync', patch.autoSync)
  await config.save()
  return getSourceConfig()
}

// 按间隔自动同步（应用启动/读取数据时调用）
const maybeSync = async (gameId) => {
  if (!config.bannerAutoSync) return { skipped: true, reason: 'disabled' }
  const interval = Math.max(1, Number(config.bannerSourceInterval) || 24) * 3600 * 1000
  const last = Number(config.bannerLastSync) || 0
  if (last && Date.now() - last < interval) {
    return { skipped: true, reason: 'interval' }
  }
  const game = gameId || config.game
  const local = await getLocalBanners(game)
  const decision = needSync(local.banners)
  if (decision.action === 'none') {
    config.set('bannerLastSync', Date.now())
    await config.save()
    return { skipped: true, reason: 'fresh' }
  }
  try {
    return await syncNow(game, { force: false })
  } catch (e) {
    // 拉取失败时保留旧数据（内置 + 本地反推 + 已有覆盖层）
    return { skipped: true, reason: 'failed', message: e.message }
  }
}

// 所有 handler 都依赖 config.game（未传 gameId 时回退到当前游戏），
// 必须等配置加载完成，否则会用默认游戏操作错误的卡池数据
ipcMain.handle('GET_BANNER_TABLE', async (event, gameId) => {
  await config.ready
  return await getBannerTable(gameId)
})
ipcMain.handle('SAVE_BANNER_UP', async (event, gameId, edit) => {
  await config.ready
  return await saveBannerUp(gameId, edit)
})
ipcMain.handle('IMPORT_BANNER_JSON', async (event, gameId) => {
  await config.ready
  return await importBannerJSON(gameId)
})
ipcMain.handle('SYNC_BANNERS', async (event, gameId, options) => {
  await config.ready
  return await syncNow(gameId, options || {})
})
ipcMain.handle('CLEAR_REMOTE_BANNERS', async (event, gameId) => {
  await config.ready
  return await clearRemote(gameId)
})
ipcMain.handle('GET_BANNER_SOURCE_CONFIG', async () => {
  await config.ready
  return getSourceConfig()
})
ipcMain.handle('SAVE_BANNER_SOURCE_CONFIG', async (event, patch) => {
  await config.ready
  return await saveSourceConfig(patch || {})
})
ipcMain.handle('MAYBE_SYNC_BANNERS', async (event, gameId) => {
  await config.ready
  return await maybeSync(gameId)
})

module.exports = {
  getBannerTable,
  saveBannerUp,
  importBannerJSON,
  syncNow,
  clearRemote,
  getSourceConfig,
  saveSourceConfig,
  maybeSync
}
