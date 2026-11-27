const Registry = require('winreg')

const proxyStatus = {
  started: false
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

const enableProxy = async (ip, port) => {
  const proxyIp = `${ip}:${port}`
  const ignoreIp = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>'
  // 先备份用户原设置，再开启
  await backupProxySettings()
  await setProxy('1', proxyIp, ignoreIp)
  proxyStatus.started = true
}

const disableProxy = async () => {
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
  } catch (e) {
    // 恢复失败也要复位状态，避免下次无法关闭
    console.error('恢复系统代理设置失败:', e && e.message)
  } finally {
    backup = null
    proxyStatus.started = false
  }
}

module.exports = {
  enableProxy, disableProxy, proxyStatus
}
