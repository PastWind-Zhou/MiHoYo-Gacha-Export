const { app } = require('electron')

// 三合一版本不使用原项目的自动更新源，仅保留开关与提示逻辑
const updateInfo = {
  status: 'init'
}

const update = async () => {
  return
}

const getUpdateInfo = () => updateInfo

setTimeout(update, 1000)

exports.getUpdateInfo = getUpdateInfo
