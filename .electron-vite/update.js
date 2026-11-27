// 在线更新包生成脚本（已废弃）
//
// 说明：本项目的正式发布走 release/ 目录（见 tools/package.js）。
// 1.0.2 起应用内自动更新由自研模块负责（src/main/update/，
// 直接从 GitHub Releases 下载 win.zip 并校验/备份/切换，无需更新服务器），
// 不再需要本脚本生成的「app.zip + manifest.json」更新服务器格式。
// 保留此脚本仅作历史参考；其中的解压路径已按当前产物名修正，
// 如需临时生成旧格式更新包，仍然可用。
//
// 产物约定（与 update/index.js 的读取逻辑一致）：
//   build/update/CNAME                       更新域名
//   build/update/update/manifest.json         版本与哈希清单
//   build/update/update/<hash>.zip            应用包
const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')
const pkg = require('../package.json')
const { version } = pkg

// 哈希盐：使用本项目标识，避免与其它项目共用同一盐
const HASH_SALT = 'mihoyo-gacha-export'

// 更新域名：留空表示不发布到具体域名，使用前请按需修改
const CNAME = ''

const hash = (data, type = 'sha256') => {
  const hmac = crypto.createHmac(type, HASH_SALT)
  hmac.update(data)
  return hmac.digest('hex')
}

const createZip = (filePath, dest) => {
  const zip = new AdmZip()
  zip.addLocalFolder(filePath)
  zip.toBuffer()
  zip.writeZip(dest)
}

// 找到本项目的程序包：优先用正式打包脚本的产物
const findAppPackage = () => {
  const candidates = [
    path.resolve('./release', `${pkg.build.productName}-${version}-win.zip`),
    path.resolve('./build', `${pkg.build.productName}-${version}-win.zip`)
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

const start = async () => {
  const appPackage = findAppPackage()
  if (!appPackage) {
    console.error('找不到程序包，请先执行 node tools/package.js')
    console.error('  期望路径: ' + path.resolve('./release', `${pkg.build.productName}-${version}-win.zip`))
    process.exit(1)
  }

  const outputPath = path.resolve('./build/update/update/')
  const zipPath = path.resolve(outputPath, 'app.zip')
  await fs.ensureDir(outputPath)
  await fs.emptyDir(outputPath)

  if (CNAME) {
    await fs.outputFile('./build/update/CNAME', CNAME)
  }

  // 解压程序包，取出 resources/app 作为更新内容
  const unpackDir = path.resolve('./build/update/_unpack')
  await fs.remove(unpackDir)
  await fs.ensureDir(unpackDir)
  const zip = new AdmZip(appPackage)
  zip.extractAllTo(unpackDir, true)

  // 解压后的顶层目录名与 tools/package.js 的产物名一致：MiHoYoGachaExport-<version>-win
  const appDir = path.join(unpackDir, `${pkg.build.productName}-${version}-win`, 'resources', 'app')
  if (!fs.existsSync(appDir)) {
    console.error('程序包结构不符合预期，找不到: ' + appDir)
    process.exit(1)
  }

  createZip(appDir, zipPath)
  await fs.remove(unpackDir)

  const buffer = await fs.readFile(zipPath)
  const sha256 = hash(buffer)
  const hashName = sha256.slice(7, 12)
  await fs.copy(zipPath, path.resolve(outputPath, `${hashName}.zip`))
  await fs.remove(zipPath)
  await fs.outputJSON(path.join(outputPath, 'manifest.json'), {
    active: true,
    version,
    from: '0.0.1',
    name: `${hashName}.zip`,
    hash: sha256
  })
  console.log('更新包已生成: ' + outputPath)
}

start().catch((e) => {
  console.error('生成更新包失败:', e && e.message)
  process.exit(1)
})
