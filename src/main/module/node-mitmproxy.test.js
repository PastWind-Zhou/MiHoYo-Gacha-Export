// node-mitmproxy 是压缩过的第三方 bundle（内含 babel-polyfill，不能重复 require）。
// 这里用可控的 http.Server 替身验证两处安全行为：
// 不再全局关闭 TLS 校验、server 错误在 listen 前就被接管。
jest.mock('http', () => {
  const real = jest.requireActual('http')
  const EventEmitter = require('events').EventEmitter
  const fakeServer = new EventEmitter()
  fakeServer.listen = jest.fn()
  fakeServer.close = jest.fn((cb) => cb && cb())
  return Object.assign({}, real, {
    Server: jest.fn(() => fakeServer),
    __fakeServer: fakeServer
  })
})

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const mitm = require('./node-mitmproxy')

jest.setTimeout(30000)

describe('node-mitmproxy 安全修复', () => {
  let errorSpy
  let caDir = null
  let caPaths = {}

  beforeAll(() => {
    // 用 bundle 自带的 createCA 生成一份真实证书：createProxy 会解析 caCertPath/caKeyPath
    caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitmca-test-'))
    const ca = mitm.createCA(caDir)
    caPaths = { caCertPath: ca.caCertPath, caKeyPath: ca.caKeyPath }
  })

  afterAll(() => {
    if (caDir) fs.rmSync(caDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    mitm.proxyServer = null
    mitm.onError = null
    http.__fakeServer.removeAllListeners('error')
    http.__fakeServer.listen.mockReset()
    http.__fakeServer.close.mockClear()
  })

  afterEach(() => {
    errorSpy.mockRestore()
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  })

  test('require 与 createProxy 都不得设置全局 NODE_TLS_REJECT_UNAUTHORIZED', () => {
    mitm.createProxy(Object.assign({ port: 0 }, caPaths))
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
  })

  test('server 的 error 监听注册在 listen 之前，端口占用错误转交 onError', () => {
    const onError = jest.fn()
    mitm.onError = onError
    // 模拟 EADDRINUSE：listen 调用时同步触发 error。
    // 旧实现把 on("error") 写在 listen 回调里，此时尚未注册 -> 会变成未捕获异常
    http.__fakeServer.listen.mockImplementation(() => {
      http.__fakeServer.emit('error', new Error('EADDRINUSE'))
    })
    expect(() => mitm.createProxy(Object.assign({ port: 8325 }, caPaths))).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].message).toBe('EADDRINUSE')
  })

  test('closeProxy 关闭并清空 server，可重复调用', async () => {
    mitm.createProxy(Object.assign({ port: 0 }, caPaths))
    const server = http.__fakeServer
    await expect(mitm.closeProxy()).resolves.toBeUndefined()
    expect(server.close).toHaveBeenCalledTimes(1)
    expect(mitm.proxyServer).toBeNull()
    // 没有 server 时再次调用应安全返回
    await expect(mitm.closeProxy()).resolves.toBeUndefined()
  })
})
