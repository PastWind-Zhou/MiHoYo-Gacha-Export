// 卡池远程源安全修复回归测试：SSRF 逐跳校验、字节体积上限、upByType 指纹
jest.mock('electron-fetch', () => ({ default: jest.fn() }))
jest.mock('dns', () => ({
  promises: { lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }
}))

const fetch = require('electron-fetch').default
const dns = require('dns').promises
const gachaBanner = require('./gachaBanner')

beforeEach(() => {
  fetch.mockReset()
  dns.lookup.mockReset()
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})

describe('isBlockedHost（SSRF 地址黑名单）', () => {
  test('拦截回环/内网/链路本地/等价写法', () => {
    for (const host of [
      '127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]',
      '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255',
      '169.254.169.254', '2130706433', '0x7f000001'
    ]) {
      expect(gachaBanner.isBlockedHost(host)).toBe(true)
    }
  })

  test('公网地址放行', () => {
    expect(gachaBanner.isBlockedHost('raw.githubusercontent.com')).toBe(false)
    expect(gachaBanner.isBlockedHost('8.8.8.8')).toBe(false)
    expect(gachaBanner.isBlockedHost('172.32.0.1')).toBe(false)
  })
})

describe('fetchRemoteJSON SSRF 防护', () => {
  test('直接访问回环地址时在发起请求前拒绝', async () => {
    await expect(gachaBanner.fetchRemoteJSON('http://127.0.0.1:8325/secret')).rejects.toThrow(/blocked host/)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('域名解析到内网地址时拒绝', async () => {
    dns.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    await expect(gachaBanner.fetchRemoteJSON('https://example.com/data.json')).rejects.toThrow(/blocked host/)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('302 跳转到内网时不跟随，逐跳校验拦截', async () => {
    fetch.mockResolvedValueOnce({
      ok: true, status: 302,
      headers: { get: () => 'http://127.0.0.1/admin' }
    })
    await expect(gachaBanner.fetchRemoteJSON('https://example.com/data.json')).rejects.toThrow(/blocked host/)
    // 只发了首跳请求，跳转目标没有发出
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].redirect).toBe('manual')
  })

  test('合法响应正常解析', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{"banners":[]}' })
    await expect(gachaBanner.fetchRemoteJSON('https://example.com/data.json')).resolves.toEqual({ banners: [] })
  })
})

describe('fetchRemoteJSON 体积上限按字节计', () => {
  test('字符数未超但字节数超限的中文响应被拒绝', async () => {
    // 3M 个中文字符：text.length ≈ 3M < 8M，但 Buffer.byteLength ≈ 9M > 8M
    const huge = '中'.repeat(3 * 1024 * 1024 + 1)
    fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => huge })
    await expect(gachaBanner.fetchRemoteJSON('https://example.com/data.json')).rejects.toThrow(/response too large/)
  })
})

describe('sameBannerSet 纳入 upByType', () => {
  const base = [{
    channel: '100', start: '2024-01-01 00:00', end: '2024-02-01 00:00',
    up: ['角色A'], upByType: { character: ['角色A'], weapon: [] }
  }]

  test('仅 upByType 不同也判定为不一致', () => {
    const other = JSON.parse(JSON.stringify(base))
    other[0].upByType.character = ['角色B']
    expect(gachaBanner.sameBannerSet(base, other)).toBe(false)
  })

  test('完全一致时仍判定为一致', () => {
    expect(gachaBanner.sameBannerSet(base, JSON.parse(JSON.stringify(base)))).toBe(true)
  })
})
