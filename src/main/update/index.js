// 自动更新对外入口：状态机编排、IPC 注册、生命周期接入
//
// 状态机：
//   init → checking → available → downloading → verifying → backing-up
//        → staging → ready →（退出并启动新版本）→ validating → done
//   任意阶段失败 → failed（旧版本原样保留）
//   validating 失败 → restoring → rollback（回滚并启动旧版本）
//
// 用户数据安全约束（详见 dataGuard.js）：
//   备份前先扫描、备份后逐文件复核、迁移只补缺失、
//   升级后校验失败先恢复、仍失败才回滚；旧版本目录永不删除。
const { app, ipcMain } = require('electron')
const fs = require('fs-extra')
const path = require('path')
const semver = require('semver')

const config = require('../config')
const { isDev, appRoot, userDataPath } = require('../paths')
const { sendMsg } = require('../utils')
const { UPDATE_API, PRODUCT_NAME, BUSY_STATUS, parseVersion, pickAsset, assetDigest, shouldUpdate } = require('./checker')
const { fetchLatestRelease, downloadFile, validateZip, extractZip } = require('./downloader')
const { scanDir, verifyManifest, ensureUserData, backupUserData, pruneBackups, restoreUserData } = require('./dataGuard')
const { readState, writeState, clearState } = require('./state')

// 启动后延迟检测：避开启动高峰，也降低 GitHub API 限流压力
const AUTO_CHECK_DELAY = 10 * 1000
// 两次自动检测的最小间隔（防止反复重启刷请求）
const AUTO_CHECK_MIN_INTERVAL = 60 * 60 * 1000

const updateInfo = {
  status: 'init',
  available: false,
  version: '',
  notes: '',
  message: '',
  error: '',
  progress: 0,
  assetUrl: '',
  digest: ''
}

const currentVersion = () => app.getVersion()

// 给渲染层的状态快照（不含内部实现细节）
const publicInfo = () => ({
  status: updateInfo.status,
  available: updateInfo.available,
  version: updateInfo.version,
  notes: updateInfo.notes,
  message: updateInfo.message,
  error: updateInfo.error,
  progress: updateInfo.progress,
  currentVersion: currentVersion(),
  skipVersion: config.skipVersion || '',
  autoUpdate: config.autoUpdate === true,
  lastUpdateCheck: Number(config.lastUpdateCheck) || 0
})

// 状态流转：更新内存状态 → 同步 config.updateState → 推送给渲染层
// （config.updateState 只在内存同步，落盘时机放在稳定节点，避免
//  更新过程中频繁写 config.json 干扰备份哈希校验）
const sendStatus = (status, patch = {}) => {
  Object.assign(updateInfo, patch, { status })
  // error 字段专供渲染层展示：只有失败态才携带，新的检测开始时清空
  updateInfo.error = status === 'failed' ? (updateInfo.message || '') : ''
  try {
    config.set('updateState', status)
  } catch (e) {}
  sendMsg(publicInfo(), 'UPDATE_STATUS')
}

// IPC 统一返回包：成功 { ok: true, data }，失败 { ok: false, error }
// 内部函数保留扁平返回值便于编排，只在 IPC 边界转换一次
const asRpcResult = (r) => {
  if (!r || r.ok === false) {
    return { ok: false, error: (r && (r.error || r.message)) || '更新失败' }
  }
  const data = Object.assign({}, r)
  delete data.ok
  return { ok: true, data }
}

const isBusy = () => BUSY_STATUS.includes(updateInfo.status)

// ---------- 检测 ----------

const checkUpdate = async (manual = true) => {
  await config.ready
  if (isBusy()) {
    return { ok: false, error: '已有更新正在进行' }
  }
  try {
    sendStatus('checking')
    // GACHA_UPDATE_API 仅供本地 mock 测试使用，默认固定 GitHub Releases
    const apiUrl = process.env.GACHA_UPDATE_API || UPDATE_API
    const release = await fetchLatestRelease(apiUrl, currentVersion())
    const latest = parseVersion(release.tag_name)
    const asset = pickAsset(release, process.platform)
    const digest = asset ? assetDigest(asset) : null
    const canUpdate = shouldUpdate({
      current: currentVersion(),
      latest,
      autoUpdate: config.autoUpdate === true,
      manual,
      skipVersion: config.skipVersion,
      status: updateInfo.status,
      isDev
    })
    // 记录检测时间（界面的「上次检查」），此时落盘一次 config：
    // 后续备份阶段不再写 config，保证备份哈希的稳定性
    config.set('lastUpdateCheck', Date.now())
    await config.save()

    let available = false
    let message = ''
    if (!canUpdate) {
      if (isDev) {
        message = '开发环境不支持自动更新'
      } else if (latest && semver.valid(latest) && !semver.gt(latest, parseVersion(currentVersion()))) {
        message = '已是最新版本'
      } else if (config.skipVersion && parseVersion(config.skipVersion) === latest) {
        message = '已跳过该版本'
      } else {
        message = '暂无可用更新'
      }
    } else if (!asset) {
      message = '新版本暂无当前平台的更新包'
    } else if (!digest) {
      // fail closed：没有 sha256 校验信息就拒绝更新
      message = '更新包缺少 sha256 校验信息，已拒绝更新'
    } else {
      available = true
    }

    if (available) {
      Object.assign(updateInfo, {
        available: true,
        version: latest,
        notes: String(release.body || ''),
        message: '',
        progress: 0,
        assetUrl: String(asset.browser_download_url || ''),
        digest
      })
      sendStatus('available')
    } else {
      Object.assign(updateInfo, { available: false, version: latest, message })
      sendStatus('idle')
    }
    const result = { ok: true, available, version: latest, message }
    if (available && !manual) {
      // 自动模式：检测到更新直接走完整流程（下载→校验→备份→暂存→重启）
      return Object.assign(result, await startUpdate())
    }
    return result
  } catch (e) {
    sendStatus('failed', { message: e.message })
    return { ok: false, error: e.message }
  }
}

// ---------- 应用更新 ----------

// 重启进入新版本：app.quit() 会经过 will-quit，
// 系统代理在那里被可靠恢复后再退出
const relaunchApp = (target) => {
  const exe = path.join(target, `${PRODUCT_NAME}.exe`)
  if (!fs.existsSync(exe)) {
    throw new Error(`新版本程序缺失：${exe}`)
  }
  app.relaunch({ execPath: exe })
  app.quit()
}

const startUpdate = async () => {
  await config.ready
  if (isDev) {
    return { ok: false, error: '开发环境不支持自动更新' }
  }
  if (isBusy()) {
    return { ok: false, error: '已有更新正在进行' }
  }
  if (!updateInfo.available || !updateInfo.assetUrl || !updateInfo.digest) {
    // 手动直点「立即更新」但还没检测过：先补一次检测
    const checked = await checkUpdate(true)
    if (!checked.ok || !checked.available) {
      return { ok: false, error: checked.message || checked.error || '当前没有可用更新' }
    }
  }
  const version = updateInfo.version
  const target = path.join(path.dirname(appRoot), `${PRODUCT_NAME}-${version}-win`)
  try {
    // 前置：userData 必须可读（扫描不可读会抛错），否则中止更新
    scanDir(userDataPath)
    sendStatus('downloading', { progress: 0 })
    const cacheDir = path.join(appRoot, 'update-cache', version)
    const zipFile = path.join(cacheDir, 'app.zip')
    await downloadFile(updateInfo.assetUrl, zipFile, {
      expectedSha256: updateInfo.digest,
      onProgress: (received, total) => {
        sendStatus('downloading', {
          progress: total ? Math.floor((received / total) * 100) : 0
        })
      }
    })

    sendStatus('verifying')
    validateZip(zipFile, version)
    const stagingDir = path.join(appRoot, 'update-cache', 'staging', version)
    await fs.remove(stagingDir)
    const stagedRoot = extractZip(zipFile, stagingDir, `${PRODUCT_NAME}-${version}-win`)

    sendStatus('backing-up')
    const backupRoot = path.join(appRoot, 'update-cache', 'backup')
    const backup = backupUserData(userDataPath, backupRoot, version)
    pruneBackups(backupRoot)

    sendStatus('staging')
    // 切换到新版本目录（与当前目录同级，绝不覆盖当前目录）：
    //   - 目标不存在 → 整目录移动
    //   - 目标已存在（用户提前解压过同版本）→ 程序文件覆盖合并；
    //     zip 结构校验已确保暂存内容不含 userData，覆盖的只是程序文件
    if (!fs.pathExistsSync(target)) {
      fs.moveSync(stagedRoot, target)
    } else {
      fs.copySync(stagedRoot, target, { overwrite: true })
      fs.rmSync(stagingDir, { recursive: true, force: true })
    }
    // 用户数据进入新版本目录：幂等、只补缺失、绝不覆盖
    ensureUserData(userDataPath, path.join(target, 'userData'))

    // 双侧写状态：新根供新版本启动校验；旧根供「relaunch 失败 /
    // 用户手动回到旧版本」时给出提示
    const state = {
      phase: 'staged',
      fromVersion: currentVersion(),
      toVersion: version,
      oldAppRoot: appRoot,
      newAppRoot: target,
      backupDir: backup.dir
    }
    writeState(target, state)
    writeState(appRoot, state)
    sendStatus('ready')
    // 留出短暂时间让渲染层收到 ready 状态再重启
    await new Promise((resolve) => setTimeout(resolve, 1200))
    relaunchApp(target)
    return { ok: true, version }
  } catch (e) {
    // 任意阶段失败：旧版本原样保留（上面没有任何步骤改动旧目录），
    // 状态落盘让下次启动时能提示失败原因
    sendStatus('failed', { message: e.message })
    try {
      writeState(appRoot, {
        phase: 'failed',
        fromVersion: currentVersion(),
        toVersion: version,
        message: e.message
      })
    } catch (e2) {}
    return { ok: false, error: e.message }
  }
}

// ---------- 升级后校验与回滚 ----------

// 更新成功收尾：清理双侧状态文件，持久化 updateState
const finishUpdate = async (state, extra) => {
  const payload = Object.assign({}, state, { phase: 'done' }, extra || {})
  try {
    writeState(appRoot, payload)
    clearState(appRoot)
    if (state.oldAppRoot) clearState(state.oldAppRoot)
  } catch (e) {}
  try {
    config.set('updateState', 'done')
    await config.save()
  } catch (e) {}
  sendStatus('done')
}

// 新版本启动后的数据校验：
//   通过 → done
//   不通过 → 从备份恢复（先隔离现状再修复）→ 复核
//   仍不通过 → 回滚旧版本（旧目录从未被改动，数据完好）
const validateAfterUpgrade = async (state) => {
  sendStatus('validating')
  const backupUserDataDir = path.join(state.backupDir, 'userData')
  let manifest = null
  try {
    manifest = fs.readJSONSync(path.join(state.backupDir, 'manifest.json'))
  } catch (e) {}
  if (!manifest || !Array.isArray(manifest.files)) {
    // 备份清单缺失：无法校验也无法恢复。数据本身大概率没问题，
    // 保守起见不回滚，但明确提示用户检查
    sendMsg('更新完成，但备份清单缺失，已跳过数据校验', 'UPDATE_HINT')
    await finishUpdate(state, null)
    return true
  }
  const result = verifyManifest(userDataPath, manifest, { volatile: ['log.txt'] })
  if (result.ok) {
    sendMsg(`已更新到 v${state.toVersion}，用户数据校验通过`, 'UPDATE_HINT')
    await finishUpdate(state, null)
    return true
  }
  sendStatus('restoring')
  // 恢复本身也可能失败（备份文件缺失 / 磁盘占用）。这里必须兜住异常，
  // 否则状态会永久卡在 restoring，既没完成校验也没回滚
  let restore = { restored: [], quarantined: [] }
  let retry = null
  try {
    restore = restoreUserData(backupUserDataDir, userDataPath, manifest)
    retry = verifyManifest(userDataPath, manifest, { volatile: ['log.txt'] })
  } catch (e) {
    retry = { ok: false, missing: [], corrupt: [e.message] }
  }
  if (retry.ok) {
    sendMsg(`更新后数据校验发现问题，已从备份恢复 ${restore.restored.length} 个文件`, 'UPDATE_HINT')
    await finishUpdate(state, { recovered: restore.restored })
    return true
  }
  // 仍失败：回滚旧版本
  const detail = [...retry.missing, ...retry.corrupt].slice(0, 5).join(', ')
  sendMsg(`新版本数据校验失败（${detail}），正在回滚旧版本…`, 'UPDATE_HINT')
  try {
    writeState(appRoot, Object.assign({}, state, { phase: 'rollback', reason: detail }))
    writeState(state.oldAppRoot, {
      phase: 'failed',
      fromVersion: state.fromVersion,
      toVersion: state.toVersion,
      message: '升级后数据校验失败，已自动回滚'
    })
  } catch (e) {}
  // 把该版本加入跳过名单：否则「旧→新→回滚→旧」会无限循环。
  // 后续更高的新版本不受影响；用户可通过 SKIP_UPDATE('') 清除
  try {
    config.set('skipVersion', state.toVersion)
    await config.save()
  } catch (e) {}
  const oldExe = path.join(state.oldAppRoot, `${PRODUCT_NAME}.exe`)
  if (fs.existsSync(oldExe)) {
    app.relaunch({ execPath: oldExe })
    app.quit()
  } else {
    // 旧版本程序缺失无法回滚：保留新版本并给出手动恢复指引
    sendMsg(`旧版本程序缺失，无法回滚；用户数据备份位于：${backupUserDataDir}`, 'UPDATE_HINT')
    sendStatus('failed', { message: '数据校验失败且无法回滚' })
  }
  return false
}

// ---------- 生命周期 ----------

let inited = false
let autoCheckScheduled = false

const scheduleAutoCheck = () => {
  if (autoCheckScheduled) return
  autoCheckScheduled = true
  const last = Number(config.lastUpdateCheck) || 0
  if (Date.now() - last < AUTO_CHECK_MIN_INTERVAL) return
  setTimeout(() => {
    checkUpdate(false).catch(() => {})
  }, AUTO_CHECK_DELAY)
}

// main.js 在 whenReady 后调用；内部消化所有异常，绝不阻断启动
const initUpdate = async () => {
  if (inited) return
  inited = true
  try {
    await config.ready
    const localState = readState(appRoot)
    if (localState && localState.phase === 'staged' && localState.newAppRoot === appRoot) {
      // 本次启动的就是「被更新启动的新版本」→ 升级后校验
      await validateAfterUpgrade(localState)
      return
    }
    if (localState && localState.phase === 'staged') {
      // 上次更新已暂存并尝试启动新版本，但现在运行的是旧目录：
      // relaunch 失败或用户手动启动。给出明确提示，不自动重试
      sendMsg(`检测到未完成的更新（v${localState.toVersion || ''}），新版本目录：${localState.newAppRoot || ''}`, 'UPDATE_HINT')
      clearState(appRoot)
      return
    }
    if (localState && localState.phase === 'failed') {
      // 上次更新失败：提示原因；本次会话不再自动检测，
      // 避免反复撞同一错误（手动触发不受影响）
      sendMsg(`上次更新失败：${localState.message || '未知原因'}`, 'UPDATE_HINT')
      clearState(appRoot)
      return
    }
    if (localState) {
      // done / rollback 等残留记录：已无用，清理
      clearState(appRoot)
    }
    if (isDev) return
    if (config.autoUpdate !== true) return
    scheduleAutoCheck()
  } catch (e) {
    // 初始化失败不阻断启动
  }
}

// ---------- IPC ----------

// GET_UPDATE_INFO：无需参数，返回当前状态快照（含跳过版本 / 上次检测时间）
ipcMain.handle('GET_UPDATE_INFO', async () => {
  await config.ready
  return publicInfo()
})

// CHECK_UPDATE：手动检测。无参返回 { ok: true, data: { available, version, message } }
// 失败返回 { ok: false, error }；available=true 时允许 APPLY_UPDATE
ipcMain.handle('CHECK_UPDATE', async () => {
  return asRpcResult(await checkUpdate(true))
})

// APPLY_UPDATE：执行完整更新流程（下载→校验→备份→暂存→重启）。
// 无参返回 { ok: true, data: { version } } 或 { ok: false, error }；
// 返回值主要用于失败时展示原因
ipcMain.handle('APPLY_UPDATE', async () => {
  return asRpcResult(await startUpdate())
})

// SKIP_UPDATE：入参 { version }，跳过指定版本；传空字符串清除标记（回滚后想重试）
// 兼容旧渲染层的位置参数写法，避免两条分支发布不同步时互相打断
ipcMain.handle('SKIP_UPDATE', async (event, params) => {
  await config.ready
  try {
    const requested = params && typeof params === 'object' ? params.version : params
    // 空字符串是显式「清除跳过标记」，不能回退到 updateInfo.version
    if (requested === '') {
      config.set('skipVersion', '')
      await config.save()
      return { ok: true, skipVersion: '' }
    }
    const v = parseVersion(requested) || updateInfo.version
    if (!v || !semver.valid(v)) {
      return { ok: false, error: '未指定版本' }
    }
    config.set('skipVersion', v)
    await config.save()
    return { ok: true, skipVersion: v }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// 兼容旧入口：main.js 曾导入 getUpdateInfo
const getUpdateInfo = () => publicInfo()

module.exports = { initUpdate, getUpdateInfo, checkUpdate, startUpdate, publicInfo }
