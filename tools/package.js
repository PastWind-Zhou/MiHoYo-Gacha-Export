// 正式打包脚本：输出统一放在仓库根目录的 release/ 内
//   release/<productName>-<version>-win/     免安装目录（含本地 userData）
//   release/<productName>-<version>-win.zip  程序压缩包（不含 userData）
// 源码包由 GitHub Release 自动生成（Source code zip/tar.gz），这里不再重复产出。
// 用法：node tools/package.js
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = pkg.build.productName

// 只认「本产品的版本目录」：目录名必须是 <productName>-<semver>[-后缀] 形式
// （与 src/main/paths.js 的 isProductVersionDir 保持一致，改动时两处同步）。
// 早期实现用 /gacha/i 宽松匹配仓库父目录，会把名字含 gacha 的无关目录的
// userData 也当成「本机最新数据」回填进发布目录 —— 他人数据被静默混入。
const isProductVersionDir = (name) =>
  /^MiHoYoGachaExport-\d+\.\d+\.\d+(-[a-z]+)?$/.test(name)

const version = pkg.version
const releaseDir = path.join(root, 'release')
// 免安装目录名与压缩包名保持一致（去掉 .zip 后缀）：
//   release/MiHoYoGachaExport-1.0.2-win/     ← 本地可直接运行
//   release/MiHoYoGachaExport-1.0.2-win.zip  ← 解压后得到同名文件夹
const stage = path.join(releaseDir, `${productName}-${version}-win`)
const appZip = path.join(releaseDir, `${productName}-${version}-win.zip`)
// 需要保留的目录：备份与临时目录在打包过程中不能被清理掉，
// 否则压缩中断会让用户数据在下一次打包时被永久删除
const KEEP_NAMES = new Set(['_userData_backup', '_userData_tmp'])
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
      // 仓库旁目录只认本产品的版本目录（严格匹配），避免误取其它项目的数据；
      // build/ 与 release/ 下的目录（如 electron-builder 的 win-unpacked）
      // 都是本产品自己的产物，维持原有宽松过滤即可
      if (base === parentDir && !isProductVersionDir(name)) continue
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
    // 备份不完整就必须中止：后续步骤会清空 release/ 并删除原 release 目录，
    // 一旦跳过的文件里有抽卡记录或 config，继续执行等于把用户数据永久删掉
    warn('备份 userData 时有 ' + skipped.length + ' 项未复制，已中止打包：')
    skipped.slice(0, 5).forEach((s) => warn('  ' + s))
    warn('原始数据仍在：' + userDataDirs[0])
    warn('请关闭正在运行的程序后重试')
    process.exit(1)
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

// 4.5 写入构建标识
//     版本号不变时（如 1.0.2 覆盖重发），用户无法分辨新旧包。
//     记录构建时间并在窗口标题显示，用户一眼就能确认手上的是哪个包。
const buildInfo = {
  version,
  builtAt: new Date().toISOString(),
  buildId: `${version}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
}
fs.writeFileSync(
  path.join(stage, 'resources', 'app', 'build-info.json'),
  JSON.stringify(buildInfo, null, 2),
  'utf8'
)
log(`构建标识：${buildInfo.buildId}`)

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
  // keepRoot=true：压缩目录本身，zip 内含顶层文件夹 MiHoYoGachaExport-1.0.2-win/
  // 解压后得到一个同名文件夹，而不是一堆文件散在根目录
  zipWithRetry(stage, appZip, true)
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

// 6. 源码包不再单独产出：GitHub 会随 Release 自动提供 Source code (zip/tar.gz)。
//    打包脚本只负责程序包，避免重复上传、也避免本地源码包与自动生成的源码包不一致。

// 7. 校验：压缩包内绝不能出现用户数据
//    userData 里是真实抽卡记录（UID、卡池、时间），一旦打进发布包
//    就会随 Release 分发给所有人。打包流程里虽然已把 userData 临时移出，
//    但这里再独立校验一次，防止将来改动流程时静默泄露。
const assertNoUserData = (zipPath) => {
  let entries = []
  try {
    const { execFileSync: exec } = require('child_process')
    // 用 PowerShell 列出 zip 条目，避免引入额外依赖
    const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::OpenRead("${zipPath}").Entries | ForEach-Object { $_.FullName }`
    const out = exec('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    entries = String(out).split(/\r?\n/).filter(Boolean)
  } catch (e) {
    warn('无法校验压缩包内容（跳过）：' + (e.message || e))
    return
  }
  const leaked = entries.filter((name) => /(^|\/)userData(\/|$)/i.test(name))
  if (leaked.length) {
    throw new Error(
      `压缩包 ${path.basename(zipPath)} 内含用户数据条目 ${leaked.length} 个，已中止打包：\n  ` +
      leaked.slice(0, 5).join('\n  ')
    )
  }
  log(`  校验通过：${path.basename(zipPath)} 内无 userData（${entries.length} 个条目）`)
}

assertNoUserData(appZip)

// 8. 校验：产物里不能残留运行时 require
//    Vite/rollup 只静态打包 import 与顶层 require；
//    写在函数体里的 require(...) 会被原样留在产物中，
//    运行时按 Node 规则去磁盘上找文件 —— 发布包里没有 node_modules，
//    于是在用户点击相关功能时才抛 "Cannot find module ..."。
//    已踩过的坑：require('element-plus')（卡池弹窗空白）、
//    require('./module/bannerSource')（立即同步报错）。
//    这里独立校验一次，防止将来再引入同类问题。
const assertNoRuntimeRequire = () => {
  const files = [
    path.join(appDist, 'main', 'main.js'),
    ...fs.readdirSync(path.join(appDist, 'renderer', 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(appDist, 'renderer', 'assets', f))
  ]
  const problems = []
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const code = fs.readFileSync(file, 'utf8')
    // 匹配 require("xxx") / require('xxx')
    const matches = code.match(/require\(\s*["']([^"']+)["']\s*\)/g) || []
    for (const m of matches) {
      const target = (m.match(/["']([^"']+)["']/) || [])[1] || ''
      // electron 与 Node 内建模块由运行时提供，无需打包
      if (target === 'electron' || target.startsWith('node:')) continue
      if (['fs', 'path', 'url', 'http', 'https', 'os', 'crypto', 'util', 'stream', 'zlib',
        'buffer', 'events', 'net', 'tls', 'dns', 'timers', 'child_process', 'assert', 'constants',
        'string_decoder', 'graceful-fs'].includes(target)) continue
      problems.push(`${path.basename(file)}: ${m}`)
    }
  }
  if (problems.length) {
    throw new Error(
      `产物中残留 ${problems.length} 处运行时 require（运行时会报 Cannot find module），已中止打包：\n  ` +
      problems.slice(0, 8).join('\n  ')
    )
  }
  log('  校验通过：产物中无运行时 require 残留')
}

assertNoRuntimeRequire()

// 9. 完成
log('完成（release/）：')
log('  目录     ' + stage)
log('  程序包   ' + appZip + '  (' + (fs.statSync(appZip).size / 1024 / 1024).toFixed(2) + ' MB)')
log('  源码包由 GitHub Release 自动生成，无需上传')
