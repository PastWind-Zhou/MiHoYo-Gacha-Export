// 远程取文本的体积上限必须按字节计（中文/emoji 会让 text.length 严重低估）
jest.mock('electron-fetch', () => ({ default: jest.fn() }))

const fetch = require('electron-fetch').default
const { fetchText } = require('./bannerSource')

beforeEach(() => fetch.mockReset())

test('无 reader 分支：中文字符数未超但字节数超限被拒绝', async () => {
  const huge = '中'.repeat(3 * 1024 * 1024 + 1)
  fetch.mockResolvedValueOnce({ ok: true, text: async () => huge })
  await expect(fetchText('https://example.com/a')).rejects.toThrow(/response too large/)
})

test('流式分支：按 Uint8Array 字节数累计，超限即取消并拒绝', async () => {
  // 每块 5MB，第二块累计后超过 8MB 上限
  const bigChunk = new Uint8Array(5 * 1024 * 1024)
  const reader = {
    read: jest.fn()
      .mockResolvedValueOnce({ done: false, value: bigChunk })
      .mockResolvedValueOnce({ done: false, value: bigChunk }),
    cancel: jest.fn(async () => {}),
    releaseLock: jest.fn()
  }
  fetch.mockResolvedValueOnce({ ok: true, body: { getReader: () => reader } })
  await expect(fetchText('https://example.com/a')).rejects.toThrow(/response too large/)
  expect(reader.cancel).toHaveBeenCalled()
})

test('正常响应原样返回', async () => {
  fetch.mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true}' })
  await expect(fetchText('https://example.com/a')).resolves.toBe('{"ok":true}')
})
