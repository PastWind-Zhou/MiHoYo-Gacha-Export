const Registry = require('winreg')

const proxyStatus = {
  started: false,
  // 最近一次恢复失败的原因；调用方可据此提示用户重试
  lastError: null
}

// 代理启停串行化：并发调用（抓取 + COPY_URL / 退出）会互相踩 backup，
// 后出现的操作可能把用户代理恢复成死掉的本地端口。
// 用一条 Promise 链排队，上一次失败不阻断后续操作
let opChain = Promise.resolve()
const enqueue = (task) => {
  const result = opChain.then(task, task)
  opChain = result.catch(() => {})
  return result
}

// 备份用户原有的代理设置，关闭代理时原样恢复。
// 旧实现直接写空值，等于把用户自己的代理配置清空，
// 会导致其它软件断网（例如公司代理 / 校园网代理 / 代理工具）。
let backup = null

const REG_PATH = '\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

const regKey = () => new Registry({
  hive: Registry.HKCU,
  key: REG_PATH
})

// 读取注册表值；键不存在时返回 undefined（用户本来就没配代理）
const regGet = (key) => {
  return new Promise((resolve) => {
    regKey().get(key, (err, result) => {
      if (err) {
        resolve(undefined)
        return
      }
      resolve(result && result.value)
    })
  })
}

const regSet = (key, type, value) => {
  return new Promise((resolve, reject) => {
    regKey().set(key, type, value, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

const regDelete = (key) => {
  return new Promise((resolve) => {
    regKey().delete(key, () => resolve())
  })
}

// 读取并备份当前代理设置
const backupProxySettings = async () => {
  if (backup) return
  const [enable, server, override] = await Promise.all([
    regGet('ProxyEnable'),
    regGet('ProxyServer'),
    regGet('ProxyOverride')
  ])
  backup = {
    enable: enable === undefined || enable === null ? undefined : String(enable),
    server: server === undefined || server === null ? undefined : String(server),
    override: override === undefined || override === null ? undefined : String(override)
  }
}

const setProxy = async (enable, proxyIp = '', ignoreIp = '') => {
  await regSet('ProxyEnable', Registry.REG_DWORD, enable)
  await regSet('ProxyServer', Registry.REG_SZ, proxyIp)
  await regSet('ProxyOverride', Registry.REG_SZ, ignoreIp)
}

const doEnableProxy = async (ip, port) => {
  const proxyIp = `${ip}:${port}`
  const ignoreIp = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>'
  // 先备份用户原设置，再开启
  await backupProxySettings()
  await setProxy('1', proxyIp, ignoreIp)
  proxyStatus.started = true
  proxyStatus.lastError = null
}

const doDisableProxy = async () => {
  // 没开过代理就不要动用户的系统设置
  if (!proxyStatus.started) return
  try {
    if (backup) {
      // 恢复用户原有的代理配置，而不是清空
      await regSet('ProxyEnable', Registry.REG_DWORD, backup.enable === undefined ? '0' : backup.enable)
      if (backup.server === undefined) {
        await regDelete('ProxyServer')
      } else {
        await regSet('ProxyServer', Registry.REG_SZ, backup.server)
      }
      if (backup.override === undefined) {
        await regDelete('ProxyOverride')
      } else {
        await regSet('ProxyOverride', Registry.REG_SZ, backup.override)
      }
    } else {
      await setProxy('0')
    }
    // 只有恢复成功才清理备份与状态；失败时保留 backup 供下次重试，
    // 否则用户代理会永久指向已关闭的本地端口且无法恢复
    backup = null
    proxyStatus.started = false
    proxyStatus.lastError = null
  } catch (e) {
    // 恢复失败不抛出：useProxy 的 finally 还在处理抓取结果，
    // 这里抛错会覆盖真正的抓取异常；错误通过 lastError 暴露给调用方
    proxyStatus.lastError = e && e.message ? e.message : String(e)
    console.error('恢复系统代理设置失败:', proxyStatus.lastError)
  }
}

const enableProxy = (ip, port) => enqueue(() => doEnableProxy(ip, port))
const disableProxy = () => enqueue(doDisableProxy)

module.exports = {
  enableProxy, disableProxy, proxyStatus
}
