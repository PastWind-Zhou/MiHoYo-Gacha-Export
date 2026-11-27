// 应用数据目录计算
// 单独抽出，避免 utils.js 引入 electron 依赖导致无法在纯 Node 环境下测试
const path = require('path')
const fs = require('fs-extra')

let isDev = true
let appRoot = path.resolve(__dirname, '..', '..')

try {
  // Electron 环境下使用真实路径；纯 Node（单元测试）下退回到项目根
  const { app } = require('electron')
  if (app && typeof app.getAppPath === 'function') {
    isDev = !app.isPackaged
    appRoot = isDev
      ? path.resolve(__dirname, '..', '..')
      : path.resolve(app.getAppPath(), '..', '..')
  }
} catch (e) {
  // 忽略：非 Electron 环境
}

// 用户数据目录（抽卡记录、配置、卡池覆盖层等）
const userDataPath = path.resolve(appRoot, 'userData')

// ---------- 升级迁移 ----------
//
// 打包版把 userData 放在程序同级目录（免安装形态）。用户升级时通常把新版
// 解压到一个新目录，于是旧目录里的抽卡记录「看不见了」——数据其实没丢，
// 只是留在旧版本目录里。这里在启动时把最新的旧 userData 迁移过来。
//
// 迁移只在「当前 userData 不存在或为空」时进行，绝不覆盖已有数据。

// 目录里是否有实际数据（配置文件或游戏子目录）
const hasUserDataContent = (dir) => {
  try {
    if (!fs.existsSync(dir)) return false
    const entries = fs.readdirSync(dir)
    if (!entries.length) return false
    return entries.some((name) => {
      if (name === 'config.json' || name === 'log.txt') return true
      try {
        return fs.statSync(path.join(dir, name)).isDirectory()
      } catch (e) {
        return false
      }
    })
  } catch (e) {
    return false
  }
}

// 递归取目录下最新的文件修改时间，用于判断哪份数据更新
const latestMtime = (dir) => {
  let latest = 0
  const walk = (current) => {
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) {
          walk(full)
        } else {
          const mtime = fs.statSync(full).mtimeMs
          if (mtime > latest) latest = mtime
        }
      } catch (e) {
        // 单个文件读取失败不影响整体判断
      }
    }
  }
  walk(dir)
  return latest
}

// 在候选根目录下查找版本目录中的 userData
const findUserDataIn = (root, nameFilter) => {
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (e) {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (nameFilter && !nameFilter(entry.name)) continue
    const dir = path.join(root, entry.name, 'userData')
    if (hasUserDataContent(dir)) found.push(dir)
  }
  return found
}

// 启动时迁移旧版本目录里的 userData（仅打包版需要）
const migrateUserData = () => {
  if (isDev) return false
  try {
    // 当前目录已有数据 → 不做任何迁移
    if (hasUserDataContent(userDataPath)) return false

    const parent = path.dirname(appRoot)
    const candidates = [
      ...findUserDataIn(appRoot, () => true),
      // 同级目录：升级解压到新目录时，旧版本目录与新目录同级
      ...findUserDataIn(parent, (name) => /gacha/i.test(name))
    ]
    if (!candidates.length) return false

    let best = null
    for (const dir of candidates) {
      const mtime = latestMtime(dir)
      if (!best || mtime > best.mtime) best = { dir, mtime }
    }
    if (!best) return false

    fs.copySync(best.dir, userDataPath, { overwrite: false, errorOnExist: false })
    return true
  } catch (e) {
    // 迁移失败不能阻断启动
    return false
  }
}

module.exports = { isDev, appRoot, userDataPath, migrateUserData }
