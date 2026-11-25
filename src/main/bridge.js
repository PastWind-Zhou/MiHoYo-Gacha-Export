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
  await deleteData(uid, action)
})

// 渲染层异常落盘，便于排障
ipcMain.handle('LOG_ERROR', async (event, message) => {
  sendMsg(String(message), 'ERROR')
})

// 歪率分析数据
ipcMain.handle('GET_WAIWAI_STATS', async () => {
  return await getWaiwaiStats()
})
