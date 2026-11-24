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
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')
const appDist = path.join(root, 'dist', 'electron')

// 同步输出，避免进程被杀时丢日志
const log = (...a) => fs.writeSync(1, '[package] ' + a.join(' ') + '\n')

if (!fs.existsSync(path.join(appDist, 'main', 'main.js'))) {
  fs.writeSync(2, '缺少 dist/electron/main/main.js，请先执行：\n' +
    '  node .electron-vite/build-main-only.js && node .electron-vite/build-renderer-only.js\n')
  process.exit(1)
}
if (!fs.existsSync(electronDist)) {
  fs.writeSync(2, '缺少 node_modules/electron/dist，请先执行 yarn install\n')
  process.exit(1)
}

// 1. 备份已有 userData（用户数据不随包分发，但要留在本地目录）
const userDataBackup = path.join(buildDir, '_userData_backup')
fs.rmSync(userDataBackup, { recursive: true, force: true })
if (fs.existsSync(path.join(stage, 'userData'))) {
  fs.cpSync(path.join(stage, 'userData'), userDataBackup, { recursive: true })
  log('已备份 userData')
}

// 2. 清空旧的打包产物（保留 icons）
fs.mkdirSync(buildDir, { recursive: true })
for (const name of fs.readdirSync(buildDir)) {
  if (name === 'icons' || name === '_userData_backup') continue
  fs.rmSync(path.join(buildDir, name), { recursive: true, force: true })
}

// 3. 组装免安装目录：electron 运行时 + 我们的应用
log('复制 electron 运行时…')
fs.cpSync(electronDist, stage, { recursive: true })
fs.rmSync(path.join(stage, 'resources', 'default_app.asar'), { force: true })
fs.renameSync(path.join(stage, 'electron.exe'), path.join(stage, `${productName}.exe`))

log('复制应用代码…')
const appDir = path.join(stage, 'resources', 'app')
fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true })
fs.cpSync(appDist, path.join(appDir, 'dist', 'electron'), { recursive: true })
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
  fs.cpSync(userDataBackup, path.join(stage, 'userData'), { recursive: true })
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
