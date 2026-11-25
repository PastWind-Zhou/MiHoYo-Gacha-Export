// 打包脚本：组装 win 免安装目录并压缩为 zip
//   目录名 / 包名 = <productName>-<version>（自动跟随 package.json 的版本号）
//   用法：node tools/package.js
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = pkg.build.productName
const version = pkg.version
const buildDir = path.join(root, 'build')
const stage = path.join(buildDir, `${productName}-${version}`)
const zipPath = path.join(buildDir, `${productName}-${version}-win.zip`)
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

// 1. 备份已有 userData（用户数据不随包分发，但要留在本地目录）
//
// 注意：打包会清空 build 目录下的旧版本目录，而 userData 存在那些目录里，
// 因此这里要扫描所有历史版本目录，取最近修改的一份备份下来，避免升级版本时丢数据。
const userDataBackup = path.join(buildDir, '_userData_backup')
fs.rmSync(userDataBackup, { recursive: true, force: true })

const findUserDataDirs = () => {
  if (!fs.existsSync(buildDir)) return []
  return fs.readdirSync(buildDir)
    .filter((name) => name !== 'icons' && !name.startsWith('_'))
    .map((name) => path.join(buildDir, name, 'userData'))
    .filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory()
      } catch (e) {
        return false
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

const userDataDirs = findUserDataDirs()
if (userDataDirs.length) {
  copyDir(userDataDirs[0], userDataBackup)
  log(`已备份 userData（来自 ${path.basename(path.dirname(userDataDirs[0]))}）`)
}

// 2. 清空旧的打包产物（保留 icons）
fs.mkdirSync(buildDir, { recursive: true })
for (const name of fs.readdirSync(buildDir)) {
  if (name === 'icons' || name === '_userData_backup') continue
  fs.rmSync(path.join(buildDir, name), { recursive: true, force: true })
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

// 5. 压缩（不含 userData），使用 Windows 原生 ZipFile，资源管理器兼容性最好
const udStage = path.join(stage, 'userData')
const udTmp = path.join(buildDir, '_userData_tmp')
fs.rmSync(udTmp, { recursive: true, force: true })
if (fs.existsSync(udStage)) fs.renameSync(udStage, udTmp)

log('压缩中（Windows 原生 ZipFile）…')
const ps = `Compress-Archive -Path "${stage}\\*" -DestinationPath "${zipPath}" -CompressionLevel Optimal`
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
if (fs.existsSync(udTmp)) fs.renameSync(udTmp, udStage)
if (r.status !== 0) {
  fs.writeSync(2, '压缩失败: ' + (r.stdout || '') + (r.stderr || '') + '\n')
  process.exit(1)
}

log('完成：')
log('  目录   ' + stage)
log('  压缩包 ' + zipPath + '  (' + (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2) + ' MB)')
