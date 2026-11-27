// 用内存中的注册表替身验证代理启停串行化与恢复失败保留备份
jest.mock('winreg', () => {
  const store = {}
  let failSet = false
  class Registry {
    get (key, cb) {
      cb(null, store[key] === undefined ? undefined : { value: store[key] })
    }
    set (key, type, value, cb) {
      if (failSet) return cb(new Error('registry locked'))
      store[key] = value
      cb(null)
    }
    delete (key, cb) {
      if (failSet) return cb(new Error('registry locked'))
      delete store[key]
      cb(null)
    }
  }
  Registry.HKCU = 1
  Registry.REG_DWORD = 4
  Registry.REG_SZ = 2
  Registry.__store = store
  Registry.__setFail = (v) => { failSet = v }
  return Registry
})

const Registry = require('winreg')
const { enableProxy, disableProxy, proxyStatus } = require('./system-proxy')

beforeEach(() => {
  const store = Registry.__store
  for (const key of Object.keys(store)) delete store[key]
  Registry.__setFail(false)
  proxyStatus.started = false
  proxyStatus.lastError = null
})

test('开启后关闭会恢复用户原有代理设置', async () => {
  Registry.__store.ProxyEnable = '0'
  Registry.__store.ProxyServer = 'corp-proxy:8080'
  Registry.__store.ProxyOverride = '*.local'

  await enableProxy('127.0.0.1', 8325)
  expect(Registry.__store.ProxyServer).toBe('127.0.0.1:8325')
  expect(proxyStatus.started).toBe(true)

  await disableProxy()
  expect(Registry.__store.ProxyServer).toBe('corp-proxy:8080')
  expect(Registry.__store.ProxyOverride).toBe('*.local')
  expect(proxyStatus.started).toBe(false)
})

test('恢复失败时保留备份与 started，可再次重试恢复', async () => {
  Registry.__store.ProxyEnable = '0'
  Registry.__store.ProxyServer = 'corp-proxy:8080'
  await enableProxy('127.0.0.1', 8325)

  Registry.__setFail(true)
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  await expect(disableProxy()).resolves.toBeUndefined()
  expect(proxyStatus.started).toBe(true)
  expect(proxyStatus.lastError).toMatch(/registry locked/)
  errorSpy.mockRestore()

  // 修复后重试：备份还在，应能正确恢复
  Registry.__setFail(false)
  await disableProxy()
  expect(Registry.__store.ProxyServer).toBe('corp-proxy:8080')
  expect(proxyStatus.started).toBe(false)
  expect(proxyStatus.lastError).toBeNull()
})

test('并发启停被串行化，重复关闭不会二次恢复', async () => {
  Registry.__store.ProxyEnable = '0'
  Registry.__store.ProxyServer = 'corp-proxy:8080'

  // disable 先入队但 started=false，是 no-op；随后 enable 生效
  await Promise.all([disableProxy(), enableProxy('127.0.0.1', 8325)])
  expect(proxyStatus.started).toBe(true)
  expect(Registry.__store.ProxyServer).toBe('127.0.0.1:8325')

  // 两次并发关闭：第一次恢复，第二次看到 started=false 直接返回
  await Promise.all([disableProxy(), disableProxy()])
  expect(Registry.__store.ProxyServer).toBe('corp-proxy:8080')
  expect(proxyStatus.started).toBe(false)
})
