const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { initWindow } = require('./utils')
const { disableProxy, proxyStatus } = require('./module/system-proxy')
const { initUpdate, getUpdateInfo } = require('./update/index')
const { BUSY_STATUS } = require('./update/checker')
require('./getData')
require('./bridge')
require('./excel')
require('./UIGFJson')
require('./bannerManager')

const isDev = !app.isPackaged
let win = null

function createWindow() {
  win = initWindow()
  win.setMenuBarVisibility(false)
  isDev ? win.loadURL(`http://localhost:${process.env.PORT}`) : win.loadFile('dist/electron/renderer/index.html')
  if (isDev) {
    win.webContents.openDevTools({ mode: 'undocked', activate: true })
  }
  // 窗口关闭后清空引用：second-instance / activate 不能再对已销毁的窗口调用 focus
  if (win && typeof win.on === 'function') {
    win.on('closed', () => { win = null })
  }
}

// 重复双击时把已存在的窗口还原并聚焦；若第一个实例没有可用窗口（已关或已销毁），
// 直接重建一个，避免「第二个实例静默退出 + 第一个实例无窗口」表现为点了没反应
const focusExistingWindow = () => {
  const alive = win && (typeof win.isDestroyed !== 'function' || !win.isDestroyed())
  if (alive) {
    if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') {
      win.restore()
    }
    if (typeof win.focus === 'function') win.focus()
  } else {
    createWindow()
  }
}

const isFirstInstance = app.requestSingleInstanceLock()

// 两个分支都注册 second-instance：Electron 把后来实例的该事件投递给持有锁的实例，
// 锁失败分支在 quit 前也挂上处理器，不留任何「静默退出」的启动路径
app.on('second-instance', focusExistingWindow)

if (!isFirstInstance) {
  app.quit()
} else {
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
    if (process.platform === 'darwin') return
    // 更新下载/校验/备份中途关窗时直接 quit 会中断更新、留下半成品状态。
    // 此时保持进程存活让更新流程跑完，并给出明确提示而不是静默退出。
    let busy = false
    try {
      busy = BUSY_STATUS.includes(getUpdateInfo().status)
    } catch (e) {}
    if (busy) {
      console.warn('更新正在进行，暂不退出，请等待更新完成后再关闭工具')
      try {
        if (dialog && typeof dialog.showMessageBox === 'function') {
          Promise.resolve(dialog.showMessageBox({
            type: 'warning',
            title: '更新正在进行',
            message: '更新正在下载或校验中，工具会在更新完成后自动退出，请稍候。'
          })).catch(() => {})
        }
      } catch (e) {}
      return
    }
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // 退出前必须 await 系统代理恢复，否则进程先退出会让系统代理永久指向已关闭的本地端口。
  // Electron 16 不保证 will-quit 会等待 Promise，所以用 preventDefault + 超时兜底，
  // 最终用 app.exit(0) 结束进程（绕过再次进入 will-quit）。
  const PROXY_RESTORE_TIMEOUT = 5000
  let quitting = false
  app.on('will-quit', (e) => {
    if (quitting) return
    if (!proxyStatus.started) return
    if (typeof e.preventDefault === 'function') e.preventDefault()
    quitting = true

    let timer = null
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        console.error('退出时系统代理恢复超时，强制退出')
        resolve()
      }, PROXY_RESTORE_TIMEOUT)
    })
    Promise.race([
      Promise.resolve(disableProxy()).catch((err) => {
        console.error('退出时系统代理恢复失败:', err && err.message ? err.message : String(err))
      }),
      timeout
    ]).catch((err) => {
      console.error('退出时系统代理恢复异常:', err && err.message ? err.message : String(err))
    }).finally(() => {
      if (timer) clearTimeout(timer)
      if (proxyStatus.lastError) {
        console.error('退出时系统代理恢复失败:', proxyStatus.lastError)
      }
      app.exit(0)
    })
  })
}
