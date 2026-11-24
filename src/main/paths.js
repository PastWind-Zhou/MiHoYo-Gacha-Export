// 应用数据目录计算
// 单独抽出，避免 utils.js 引入 electron 依赖导致无法在纯 Node 环境下测试
const path = require('path')

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

module.exports = { isDev, appRoot, userDataPath }
