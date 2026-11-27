// 正式打包脚本：输出统一放在仓库根目录的 release/ 内
//   release/<productName>-<version>/                 免安装目录（含本地 userData）
//   release/<productName>-<version>-win.zip          程序压缩包（不含 userData）
//   release/<productName>-<version>-source.zip       源码压缩包（git 已提交内容，不含 userData/构建产物/docs）
// 用法：node tools/package.js
const fs = require('fs')
const path = require('path')
const { spawnSync, execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = pkg.build.productName
const version = pkg.version
const releaseDir = path.join(root, 'release')
const stage = path.join(releaseDir, `${productName}-${version}`)
const appZip = path.join(releaseDir, `${productName}-${version}-win.zip`)
const sourceZip = path.join(releaseDir, `${productName}-${version}-source.zip`)
// 需要保留的目录：备份与临时目录在打包过程中不能被清理掉，
// 否则压缩中断会让用户数据在下一次打包时被永久删除
const KEEP_NAMES = new Set(['_userData_backup', '_userData_tmp', '_source_stage'])
// Electron 运行时位置：
//   1. 项目内 node_modules/electron/dist（正常安装依赖的情况）
//   2. 环境变量 ELECTRON_DIST 指定
//   3. 仓库旁的依赖备份目录 ../dependencies/electron-module/dist（精简源码时的备份）
const findElectronDist = () => {
  const candidates = [
    path.join(root, 'node_modules', 'electron', 'dist'),
    process.env.ELECTRON_DIST,
    path.resolve(root, '..', 'dependencies', 'electron-module', 'dist')
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'electron.exe'))) return c
  }
  return null
}

const electronDist = findElectronDist()
const appDist = path.join(root, 'dist', 'electron')

// 同步输出，避免进程被杀时丢日志
const log = (...a) => fs.writeSync(1, '[package] ' + a.join(' ') + '\n')
const warn = (...a) => fs.writeSync(2, '[package] ' + a.join(' ') + '\n')

// 递归复制目录：逐文件复制。
// 不使用 fs.cpSync —— 在部分环境下递归复制 electron 运行时会被中断。
// 跳过的文件要记录下来，否则会出现「打包完成但文件缺失」且无从排查。
const copyDir = (src, dest, skipped = []) => {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    let st
    try {
      st = fs.lstatSync(from)
    } catch (e) {
      skipped.push(`${from}（读取失败）`)
      continue
    }
    if (st.isDirectory()) {
      copyDir(from, to, skipped)
    } else if (st.isSymbolicLink()) {
      try {
        fs.copyFileSync(fs.realpathSync(from), to)
      } catch (e) {
        skipped.push(`${from}（符号链接复制失败）`)
      }
    } else {
      try {
        fs.copyFileSync(from, to)
      } catch (e) {
        skipped.push(`${from}（复制失败：${e.message}）`)
      }
    }
  }
  return skipped
}

// 目录内所有文件的最大修改时间：用于判断哪份 userData 更新
// 目录自身的 mtime 不可靠（追加写入已有文件不会更新目录 mtime）
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
        // 单个文件失败不影响整体判断
      }
    }
  }
  walk(dir)
  return latest
}

if (!fs.existsSync(path.join(appDist, 'main', 'main.js'))) {
  warn('缺少 dist/electron/main/main.js，请先执行：')
  warn('  node .electron-vite/build-main-only.js && node .electron-vite/build-renderer-only.js')
  process.exit(1)
}
if (!electronDist) {
  warn('缺少 Electron 运行时（electron.exe），请执行 yarn install，' +
    '或用 ELECTRON_DIST 环境变量指定 electron/dist 目录')
  process.exit(1)
}

// 1. 备份已有 userData（用户数据不随包分发，但要留在本地运行目录）
//    扫描历史版本目录（build/ 与 release/ 都要看），取数据最新的一份，
//    避免升级版本时丢数据。
const userDataBackup = path.join(releaseDir, '_userData_backup')
fs.rmSync(userDataBackup, { recursive: true, force: true })

const findUserDataDirs = () => {
  const dirs = []
  const parentDir = path.resolve(root, '..')
  const bases = [
    path.join(root, 'build'),
    releaseDir,
    // 仓库旁的历史目录：用户可能把免安装版解压到别处运行
    parentDir
  ]
  for (const base of bases) {
    if (!fs.existsSync(base)) continue
    let entries = []
    try {
      entries = fs.readdirSync(base, { withFileTypes: true })
    } catch (e) {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (name.startsWith('_') || name === 'icons') continue
      // 仓库旁目录只认与本项目相关的命名，避免误取其它项目的数据
      if (base === parentDir && !/gacha/i.test(name)) continue
      const p = path.join(base, name, 'userData')
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) dirs.push(p)
      } catch (e) {}
    }
  }
  // 按「目录内文件的最大 mtime」排序，而不是目录自身的 mtime
  return dirs
    .map((p) => ({ path: p, mtime: latestMtime(p) }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.path)
}

const userDataDirs = findUserDataDirs()
if (userDataDirs.length) {
  const skipped = copyDir(userDataDirs[0], userDataBackup)
  if (skipped.length) {
    warn('备份 userData 时有 ' + skipped.length + ' 项未复制：')
    skipped.slice(0, 5).forEach((s) => warn('  ' + s))
  }
  log(`已备份 userData（来自 ${path.basename(path.dirname(userDataDirs[0]))}）`)
}

// 2. 清空 release 下的旧打包产物
//    必须保留 _userData_backup / _userData_tmp：
//    后者是压缩失败后暂存用户数据的地方，删掉就等于丢数据
fs.mkdirSync(releaseDir, { recursive: true })
for (const name of fs.readdirSync(releaseDir)) {
  if (KEEP_NAMES.has(name)) continue
  const target = path.join(releaseDir, name)
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (e) {
    // 常见原因：程序还在运行导致文件被占用（EBUSY/EPERM）
    warn(`无法删除 ${name}：${e.message}`)
    warn('  若程序正在运行，请先关闭后再打包')
    process.exit(1)
  }
}

// 3. 组装免安装目录：electron 运行时 + 我们的应用
log('复制 electron 运行时…')
copyDir(electronDist, stage)
fs.rmSync(path.join(stage, 'resources', 'default_app.asar'), { force: true })
fs.renameSync(path.join(stage, 'electron.exe'), path.join(stage, `${productName}.exe`))

log('复制应用代码…')
const appDir = path.join(stage, 'resources', 'app')
fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true })
copyDir(appDist, path.join(appDir, 'dist', 'electron'))
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  description: pkg.description || `${productName} v${pkg.version}`,
  author: pkg.author,
  license: pkg.license,
  main: './dist/electron/main/main.js'
}, null, 2), 'utf8')

// 4. 放回用户数据
if (fs.existsSync(userDataBackup)) {
  copyDir(userDataBackup, path.join(stage, 'userData'))
  fs.rmSync(userDataBackup, { recursive: true, force: true })
  log('已放回 userData')
}

// 5. 压缩程序包（临时移出 userData，确保 zip 内不含真实记录）
//    关键：压缩过程必须用 try/finally 保证 userData 一定被放回，
//    且 _userData_tmp 不在清理名单里，避免中断后数据被永久删除。
const udStage = path.join(stage, 'userData')
const udTmp = path.join(releaseDir, '_userData_tmp')
fs.rmSync(udTmp, { recursive: true, force: true })
if (fs.existsSync(udStage)) fs.renameSync(udStage, udTmp)

const zipWithRetry = (source, dest, keepRoot = false) => {
  // keepRoot=true 时压缩目录本身（带顶层目录名）；否则压缩目录内容（平铺，exe 在 zip 根）
  const target = keepRoot ? source : `${source}\\*`
  const ps = `Compress-Archive -Path "${target}" -DestinationPath "${dest}" -CompressionLevel Optimal`
  let lastErr = ''
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      // 退避重试：路径过长 / 临时占用等错误重试有意义，立即重试无意义
      log(`  压缩重试 ${i}/3…`)
      const waitUntil = Date.now() + 2000 * i
      while (Date.now() < waitUntil) { /* 同步等待退避间隔 */ }
    }
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status === 0) return true
    lastErr = (r.stdout || '') + (r.stderr || '')
  }
  throw new Error('压缩失败: ' + lastErr)
}

log('压缩程序包（Windows 原生 ZipFile）…')
try {
  zipWithRetry(stage, appZip)
} catch (e) {
  // 压缩失败也必须把 userData 放回去
  warn(e.message)
  throw e
} finally {
  if (fs.existsSync(udTmp) && !fs.existsSync(udStage)) {
    try {
      fs.renameSync(udTmp, udStage)
      log('已恢复 userData（压缩未完成）')
    } catch (e) {
      warn('恢复 userData 失败，数据仍保留在: ' + udTmp)
      warn('请手动把它复制回 ' + udStage)
    }
  }
}

// 6. 源码包：取 git 已提交的内容（与 GitHub Release 的 Source code 一致）
//    带顶层目录 <productName>-<version>/
//    用 git 读取已提交版本，而不是工作区文件：
//    否则未提交的改动会混进源码包，新增但未 add 的文件又会被漏掉。
log('生成源码包…')
const sourceStage = path.join(releaseDir, '_source_stage')
const sourceRoot = path.join(sourceStage, `${productName}-${version}`)
fs.rmSync(sourceStage, { recursive: true, force: true })
fs.mkdirSync(sourceRoot, { recursive: true })

const git = (...args) => execFileSync('git', args, { cwd: root })

// 打包前提示工作区是否有未提交改动（不阻断，但要让人知道）
try {
  const status = git('status', '--porcelain').toString('utf8').trim()
  if (status) {
    warn('工作区存在未提交改动，源码包将取「已提交版本」内容：')
    status.split('\n').slice(0, 10).forEach((line) => warn('  ' + line))
  }
} catch (e) {
  // git 状态读取失败不影响打包
}

let tracked
try {
  tracked = git('ls-files', '-z').toString('utf8').split('\0').filter(Boolean)
} catch (e) {
  warn('无法读取 git 跟踪文件列表：' + (e.stderr || e.message))
  process.exit(1)
}
let missing = 0
for (const rel of tracked) {
  const to = path.join(sourceRoot, rel)
  try {
    // 从 git 对象库读已提交内容（二进制安全）
    const content = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, content)
  } catch (e) {
    // 文件在 HEAD 中不存在（新增未提交）→ 跳过并计数
    missing++
  }
}
if (missing) {
  log(`有 ${missing} 个文件尚未提交，未包含在源码包中`)
}
zipWithRetry(sourceRoot, sourceZip, true)
fs.rmSync(sourceStage, { recursive: true, force: true })

// 7. 完成
log('完成（release/）：')
log('  目录     ' + stage)
log('  程序包   ' + appZip + '  (' + (fs.statSync(appZip).size / 1024 / 1024).toFixed(2) + ' MB)')
log('  源码包   ' + sourceZip + '  (' + (fs.statSync(sourceZip).size / 1024 / 1024).toFixed(2) + ' MB)')
