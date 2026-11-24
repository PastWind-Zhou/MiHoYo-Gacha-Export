// 只构建渲染层（Vite）+ 复制 i18n 资源，用于快速更新 dist/electron/renderer
process.env.NODE_ENV = 'production'
const fs = require('fs-extra')
const path = require('path')
const { build } = require('vite')
const options = require('./vite.config.js')

async function main() {
  await build(options)
  fs.emptyDirSync(path.resolve('dist/electron/i18n')); fs.copySync(path.resolve('src/i18n'), path.resolve('dist/electron/i18n'))
  console.log('renderer built + i18n copied')
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
