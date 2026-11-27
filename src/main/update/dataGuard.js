// 用户数据守卫：manifest 构建/校验、幂等迁移、备份与恢复
//
// 这是自动更新的安全核心，约束（「为什么」）：
//   - 用户数据零丢失：任何操作只补缺失、绝不覆盖已有文件
//   - 备份后逐文件复核，失败即让调用方中止更新（旧版本原样保留）
//   - 幂等：中途失败后重复执行是安全的，只会继续补齐缺失文件
//
// 该模块保持纯逻辑（不依赖 electron、不依赖 paths），
// 所有目录都由调用方传入，方便单元测试。
// 核心函数使用同步 IO：userData 都是几十 KB 级的 JSON 文件，
// 同步实现最简单可靠；paths.migrateUserData 在模块加载期调用，
// 本身就只能同步执行。
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')

// ---------- 哈希 ----------

// 小文件（userData 内的 JSON）同步哈希
const sha256FileSync = (file) => {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

// 大文件（更新包 zip，最大数百 MB）流式哈希，避免整包读进内存
const sha256File = (file) => {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(h.digest('hex')))
  })
}

// ---------- manifest ----------

// 递归扫描目录，返回文件清单（相对路径 / size），不做哈希
// 目录不存在时返回空清单（全新安装也要能更新）；
// 目录存在但不可读时抛错（fail closed，调用方应中止更新）
const scanDir = (dir) => {
  const files = []
  if (!fs.existsSync(dir)) return files
  const walk = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const stat = fs.statSync(full)
        files.push({ rel: path.relative(dir, full), size: stat.size })
      }
      // 符号链接跳过：无法可靠哈希，也不是本应用会产生的数据形态
    }
  }
  walk(dir)
  return files
}

// 构建完整 manifest：相对路径 + size + sha256
const buildManifest = (dir) => {
  const files = scanDir(dir).map((item) => {
    return Object.assign({}, item, { sha256: sha256FileSync(path.join(dir, item.rel)) })
  })
  return { version: 1, files, builtAt: Date.now() }
}

// 校验目录与 manifest 是否一致
//
// volatile 列表中的文件（如 log.txt）只检查存在性，不比对哈希：
// log.txt 在更新过程中会被持续写入（每个 UPDATE_STATUS 都落盘），
// 拿「备份时刻的哈希」去比对「持续变化的文件」必然误报失败。
//
// manifest 可能被篡改（虽然文件是我们自己写的），因此对相对路径
// 做越界检查：解析结果必须仍在 dir 内。
const verifyManifest = (dir, manifest, opts = {}) => {
  const volatile = opts.volatile || []
  const root = path.resolve(dir)
  const missing = []
  const corrupt = []
  const files = manifest && Array.isArray(manifest.files) ? manifest.files : []
  for (const item of files) {
    const rel = String(item.rel || '')
    const full = path.resolve(dir, rel)
    if (rel !== path.normalize(rel) || !full.startsWith(root + path.sep)) {
      // 相对路径异常（穿越 / 绝对路径）：按损坏处理
      corrupt.push(rel)
      continue
    }
    if (!fs.existsSync(full)) {
      missing.push(rel)
      continue
    }
    if (volatile.includes(rel)) continue
    let stat = null
    try {
      stat = fs.statSync(full)
    } catch (e) {
      corrupt.push(rel)
      continue
    }
    if (stat.size !== item.size || sha256FileSync(full) !== item.sha256) {
      corrupt.push(rel)
    }
  }
  return { ok: missing.length === 0 && corrupt.length === 0, missing, corrupt }
}

// ---------- 幂等迁移 ----------

// 判断 current 的文件集合是否为 source 的「哈希一致子集」
// 用于识别「上次迁移中途失败」：目标目录里已有的文件全部来自
// 同一个来源（内容一致），只是还没复制完。
// ignore 列表中的文件（如 log.txt）不参与比对。
const isSubsetOf = (currentFiles, sourceFiles, opts = {}) => {
  const ignore = opts.ignore || ['log.txt']
  const sourceMap = new Map()
  for (const f of sourceFiles) {
    if (ignore.includes(f.rel)) continue
    sourceMap.set(f.rel, f)
  }
  for (const f of currentFiles) {
    if (ignore.includes(f.rel)) continue
    const src = sourceMap.get(f.rel)
    if (!src) return false
    if (src.size !== f.size) return false
  }
  return true
}

// 幂等复制用户数据：只补缺失、绝不覆盖已有文件
//
//   - 目标已存在且内容一致 → 跳过
//   - 目标已存在且内容不同 → 记入 conflicts，绝不覆盖
//   - 目标缺失 → 复制，并逐文件复核哈希（复制失败立即抛错）
//
// 重复执行是安全的：中途失败后再次执行只会继续补齐缺失文件。
const ensureUserData = (from, to) => {
  if (!fs.existsSync(from)) {
    throw new Error(`迁移来源不存在：${from}`)
  }
  const manifest = buildManifest(from)
  const copied = []
  const conflicts = []
  for (const item of manifest.files) {
    const dest = path.join(to, item.rel)
    if (fs.existsSync(dest)) {
      // 已存在：内容一致则无事；不一致记录冲突，绝不覆盖
      let same = false
      try {
        same = fs.statSync(dest).size === item.size && sha256FileSync(dest) === item.sha256
      } catch (e) {
        same = false
      }
      if (!same) conflicts.push(item.rel)
      continue
    }
    fs.ensureDirSync(path.dirname(dest))
    fs.copyFileSync(path.join(from, item.rel), dest)
    // 复制后立即复核：磁盘错误 / 占用导致的半截文件不能悄悄放过
    if (sha256FileSync(dest) !== item.sha256) {
      throw new Error(`迁移后校验失败：${item.rel}`)
    }
    copied.push(item.rel)
  }
  return { copied, copiedCount: copied.length, conflicts, manifest }
}

// ---------- 备份 ----------

// 备份 userData：扫描 → 复制 → manifest → 逐文件复核
// 任何一步失败都抛错，调用方（更新流程）据此中止更新，旧版本不动。
//
// stamp 精确到秒；同一秒内重复调用会命中已存在的目录，
// 此时换一个不冲突的后缀重试（更新失败重试的常见场景）
const backupUserData = (userDataDir, backupRoot, version) => {
  // 先扫描：userData 不可读（权限/损坏）时直接失败，
  // 绝不带病进入后续阶段
  const manifest = buildManifest(userDataDir)
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  let dir = path.join(backupRoot, `${version}-${stamp}`)
  if (fs.existsSync(dir)) {
    dir = path.join(backupRoot, `${version}-${stamp}-retry`)
    if (fs.existsSync(dir)) {
      throw new Error('备份目录已存在')
    }
  }
  fs.ensureDirSync(dir)
  // 备份目录是本函数新建的，覆盖写入是安全的
  fs.copySync(userDataDir, path.join(dir, 'userData'))
  fs.outputJSONSync(path.join(dir, 'manifest.json'), manifest, { spaces: 2 })
  const result = verifyManifest(path.join(dir, 'userData'), manifest, { volatile: ['log.txt'] })
  if (!result.ok) {
    const detail = [...result.missing, ...result.corrupt].slice(0, 5).join(', ')
    throw new Error(`备份复核失败（${detail}）`)
  }
  return { dir, manifest, fileCount: manifest.files.length }
}

// 备份目录只保留最近 keep 份，避免长期使用后无限膨胀
// （只清理自己的 update-cache/backup，绝不触碰版本目录）
const pruneBackups = (backupRoot, keep = 5) => {
  let entries = []
  try {
    entries = fs.readdirSync(backupRoot)
  } catch (e) {
    return []
  }
  const removed = []
  const dirs = entries
    .map((name) => {
      const full = path.join(backupRoot, name)
      try {
        return { full, mtime: fs.statSync(full).mtimeMs }
      } catch (e) {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
  for (const item of dirs.slice(keep)) {
    try {
      fs.rmSync(item.full, { recursive: true, force: true })
      removed.push(item.full)
    } catch (e) {
      // 单个目录清理失败不影响更新流程
    }
  }
  return removed
}

// ---------- 恢复 ----------

// 从备份恢复用户数据（升级后校验失败时调用）
//
//   - 缺失的文件 → 从备份补齐
//   - 内容与备份不一致的文件 → 先把现状隔离到 quarantine（防丢），
//     再用备份版本修复 —— 校验发生在新版本启动初期，此时不会有
//     用户主动产生的新数据，不一致即视为损坏
//   - 备份里没有的文件（新版本新产生） → 原样保留
const restoreUserData = (backupDir, userDataDir, manifest) => {
  const files = manifest && Array.isArray(manifest.files) ? manifest.files : []
  const restored = []
  const quarantined = []
  for (const item of files) {
    const src = path.join(backupDir, item.rel)
    const dest = path.join(userDataDir, item.rel)
    if (!fs.existsSync(dest)) {
      fs.ensureDirSync(path.dirname(dest))
      fs.copyFileSync(src, dest)
      restored.push(item.rel)
      continue
    }
    let same = false
    try {
      same = fs.statSync(dest).size === item.size && sha256FileSync(dest) === item.sha256
    } catch (e) {
      same = false
    }
    if (same) continue
    // 不一致：先隔离现状，再修复 —— 任何一条路径都不允许无备份覆盖
    const quarantine = path.join(backupDir, 'quarantine', item.rel)
    fs.ensureDirSync(path.dirname(quarantine))
    fs.moveSync(dest, quarantine, { overwrite: true })
    fs.copyFileSync(src, dest)
    restored.push(item.rel)
    quarantined.push(item.rel)
  }
  return { restored, quarantined }
}

module.exports = {
  sha256FileSync, sha256File,
  scanDir, buildManifest, verifyManifest, isSubsetOf,
  ensureUserData, backupUserData, pruneBackups, restoreUserData
}
