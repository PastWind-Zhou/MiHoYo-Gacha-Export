// 只构建主进程（Rollup），用于快速更新 dist/electron/main/main.js
process.env.NODE_ENV = 'production'
const fs = require('fs-extra')
const path = require('path')
const rollup = require('rollup')
const opt = require('./rollup.main.config.js')('production')

async function main() {
  const bundle = await rollup.rollup(opt)
  await bundle.write(opt.output)
  fs.emptyDirSync(path.resolve('dist/electron/i18n')); fs.copySync(path.resolve('src/i18n'), path.resolve('dist/electron/i18n'))
  console.log('main process built -> dist/electron/main/main.js (+ i18n)')
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
