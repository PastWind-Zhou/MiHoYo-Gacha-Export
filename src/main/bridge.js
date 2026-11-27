const { clipboard, ipcMain } = require('electron')
const { getUrl, getApiUrl, deleteData } = require('./getData')
const { sendMsg } = require('./utils')
const { getWaiwaiStats } = require('./waiwai')

ipcMain.handle('COPY_URL', async () => {
  const url = await getUrl()
  if (url) {
    clipboard.writeText(url)
    return true
  }
  return false
})

ipcMain.handle('COPY_API_URL', async () => {
  const url = await getApiUrl()
  if (url) {
    clipboard.writeText(url)
    return true
  }
  return false
})

ipcMain.handle('DELETE_DATA', async (event, uid, action) => {
  // uid / action 来自渲染层：非法 uid 会写进任意账号记录，
  // action 非布尔会污染 deleted 标志（导出/界面都按布尔处理）
  if (!/^\d+$/.test(String(uid))) throw new Error('invalid uid')
  if (typeof action !== 'boolean') throw new Error('invalid action')
  await deleteData(uid, action)
})

// 渲染层异常落盘，便于排障。
// 脱敏、单条限长、总量限制都在 utils.sendMsg 内统一处理，
// 这里只做类型归一化，避免对象被当成 [object Object] 之外的形式写入
ipcMain.handle('LOG_ERROR', async (event, message) => {
  sendMsg(typeof message === 'string' ? message : String(message), 'ERROR')
})

// 歪率分析数据
ipcMain.handle('GET_WAIWAI_STATS', async () => {
  return await getWaiwaiStats()
})
