// 正式打包脚本：输出统一放在仓库根目录的 release/ 内
//   release/<productName>-<version>/                 免安装目录（含本地 userData）
//   release/<productName>-<version>-win.zip          程序压缩包（不含 userData）
//   release/<productName>-<version>-source.zip       源码压缩包（git 跟踪文件，不含 userData/构建产物/docs）
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

// 递归复制目录：逐文件复制。
// 不使用 fs.cpSync —— 在部分环境下递归复制 electron 运行时会被中断。
const copyDir = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    let st
    try {
      st = fs.lstatSync(from)
    } catch (e) {
      continue
    }
    if (st.isDirectory()) {
      copyDir(from, to)
    } else if (st.isSymbolicLink()) {
      try {
        fs.copyFileSync(fs.realpathSync(from), to)
      } catch (e) {}
    } else {
      fs.copyFileSync(from, to)
    }
  }
}

if (!fs.existsSync(path.join(appDist, 'main', 'main.js'))) {
  fs.writeSync(2, '缺少 dist/electron/main/main.js，请先执行：\n' +
    '  node .electron-vite/build-main-only.js && node .electron-vite/build-renderer-only.js\n')
  process.exit(1)
}
if (!electronDist) {
  fs.writeSync(2, '缺少 Electron 运行时（electron.exe），请执行 yarn install，' +
    '或用 ELECTRON_DIST 环境变量指定 electron/dist 目录\n')
  process.exit(1)
}

// 1. 备份已有 userData（用户数据不随包分发，但要留在本地运行目录）
//    扫描历史版本目录（build/ 与 release/ 都要看），取最近修改的一份，避免升级版本时丢数据。
const userDataBackup = path.join(releaseDir, '_userData_backup')
fs.rmSync(userDataBackup, { recursive: true, force: true })

const findUserDataDirs = () => {
  const dirs = []
  for (const base of [path.join(root, 'build'), releaseDir]) {
    if (!fs.existsSync(base)) continue
    for (const name of fs.readdirSync(base)) {
      if (name.startsWith('_') || name === 'icons') continue
      const p = path.join(base, name, 'userData')
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) dirs.push(p)
      } catch (e) {}
    }
  }
  return dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

const userDataDirs = findUserDataDirs()
if (userDataDirs.length) {
  copyDir(userDataDirs[0], userDataBackup)
  log(`已备份 userData（来自 ${path.basename(path.dirname(userDataDirs[0]))}）`)
}

// 2. 清空 release 下的旧打包产物（保留本次备份目录）
fs.mkdirSync(releaseDir, { recursive: true })
for (const name of fs.readdirSync(releaseDir)) {
  if (name === '_userData_backup') continue
  fs.rmSync(path.join(releaseDir, name), { recursive: true, force: true })
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

// 5. 压缩程序包（临时移出 userData，确保 zip 内不含真实记录），Windows 原生 ZipFile，资源管理器兼容性最好
const udStage = path.join(stage, 'userData')
const udTmp = path.join(releaseDir, '_userData_tmp')
fs.rmSync(udTmp, { recursive: true, force: true })
if (fs.existsSync(udStage)) fs.renameSync(udStage, udTmp)

log('压缩程序包（Windows 原生 ZipFile）…')
const zipWithRetry = (source, dest, keepRoot = false) => {
  // keepRoot=true 时压缩目录本身（带顶层目录名）；否则压缩目录内容（平铺，exe 在 zip 根）
  const target = keepRoot ? source : `${source}\\*`
  const ps = `Compress-Archive -Path "${target}" -DestinationPath "${dest}" -CompressionLevel Optimal`
  for (let i = 0; i < 3; i++) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status === 0) return
    if (i === 2) {
      fs.writeSync(2, '压缩失败: ' + (r.stdout || '') + (r.stderr || '') + '\n')
      process.exit(1)
    }
  }
}
zipWithRetry(stage, appZip)
if (fs.existsSync(udTmp)) fs.renameSync(udTmp, udStage)

// 6. 源码包：git 跟踪的文件，排除 userData / 构建产物 / docs / 本 release 目录
//    与 GitHub Release 的 Source code 一致：带顶层目录 <productName>-<version>/
log('生成源码包…')
const sourceStage = path.join(releaseDir, '_source_stage')
const sourceRoot = path.join(sourceStage, `${productName}-${version}`)
fs.rmSync(sourceStage, { recursive: true, force: true })
fs.mkdirSync(sourceRoot, { recursive: true })
let tracked
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
} catch (e) {
  fs.writeSync(2, '无法读取 git 跟踪文件列表：' + (e.stderr || e.message) + '\n')
  process.exit(1)
}
for (const rel of tracked) {
  const from = path.join(root, rel)
  const to = path.join(sourceRoot, rel)
  try {
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  } catch (e) {
    log('跳过无法复制的文件: ' + rel)
  }
}
zipWithRetry(sourceRoot, sourceZip, true)
fs.rmSync(sourceStage, { recursive: true, force: true })

// 7. 完成
log('完成（release/）：')
log('  目录     ' + stage)
log('  程序包   ' + appZip + '  (' + (fs.statSync(appZip).size / 1024 / 1024).toFixed(2) + ' MB)')
log('  源码包   ' + sourceZip + '  (' + (fs.statSync(sourceZip).size / 1024 / 1024).toFixed(2) + ' MB)')
