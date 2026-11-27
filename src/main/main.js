const { app, BrowserWindow, ipcMain } = require('electron')
const { initWindow } = require('./utils')
const { disableProxy, proxyStatus } = require('./module/system-proxy')
require('./getData')
require('./bridge')
require('./excel')
require('./UIGFJson')
require('./bannerManager')
const { initUpdate } = require('./update/index')

const isDev = !app.isPackaged
let win = null

function createWindow() {
  win = initWindow()
  win.setMenuBarVisibility(false)
  isDev ? win.loadURL(`http://localhost:${process.env.PORT}`) : win.loadFile('dist/electron/renderer/index.html')
  if (isDev) {
    win.webContents.openDevTools({ mode: 'undocked', activate: true })
  }
}

const isFirstInstance = app.requestSingleInstanceLock()

if (!isFirstInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    // 自动更新初始化（内部消化异常，不阻断启动）
    Promise.resolve(initUpdate()).catch((e) => console.error('initUpdate failed', e))
  })

  ipcMain.handle('RELAUNCH', async () => {
    app.relaunch()
    app.exit(0)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // 退出前必须 await 系统代理恢复，否则进程先退出会让系统代理永久指向已关闭的本地端口。
  // quitting 标志防止 disableProxy 触发的 app.quit() 与本处理器互相递归。
  let quitting = false
  app.on('will-quit', (e) => {
    if (quitting) return
    if (proxyStatus.started) {
      e.preventDefault()
      quitting = true
      Promise.resolve(disableProxy())
        .catch((err) => console.error('退出时系统代理恢复失败:', err))
        .finally(() => {
          if (proxyStatus.lastError) {
            console.error('退出时系统代理恢复失败:', proxyStatus.lastError)
          }
          app.quit()
        })
    }
  })
}
