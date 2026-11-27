jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp/userData'), getLocale: jest.fn(() => 'zh-cn') },
  BrowserWindow: jest.fn()
}), { virtual: true })
jest.mock('electron-unhandled', () => jest.fn())
jest.mock('electron-window-state', () => jest.fn(() => ({ saveState: jest.fn() })))
jest.mock('./paths', () => ({
  isDev: true, appRoot: '/tmp', userDataPath: '/tmp/userData', migrateUserData: () => null
}))
jest.mock('fs-extra', () => {
  const real = jest.requireActual('fs-extra')
  return Object.assign({}, real, {
    outputJSON: jest.fn(async () => {}),
    outputFile: jest.fn(async () => {}),
    readJSON: jest.fn(async () => null)
  })
})

const fs = require('fs-extra')
const utils = require('./utils')

describe('authkeyMask 脱敏', () => {
  test('authkey 后跟 & 时脱敏', () => {
    expect(utils.authkeyMask('https://x/api?authkey=SECRET&page=1')).toBe('https://x/api?authkey=***&page=1')
  })

  test('authkey 是最后一个参数时也必须脱敏（旧正则的漏洞）', () => {
    expect(utils.authkeyMask('https://x/api?authkey=SECRET_TOKEN')).toBe('https://x/api?authkey=***')
    expect(utils.authkeyMask('https://x/api?authkey=SECRET_TOKEN\n')).toBe('https://x/api?authkey=***\n')
  })
})

describe('sanitizeLogText 限长', () => {
  test('超长文本截断', () => {
    const result = utils.sanitizeLogText('a'.repeat(5000))
    expect(result.length).toBeLessThanOrEqual(2000 + 10)
    expect(result).toContain('已截断')
  })

  test('Error 中携带的 authkey 也被脱敏', () => {
    const err = new Error('request failed: https://x/api?authkey=SECRET')
    expect(utils.sanitizeLogText(err)).not.toContain('SECRET')
    expect(utils.sanitizeLogText(err)).toContain('authkey=***')
  })
})

describe('saveJSON 写盘失败', () => {
  test('输出 JSON 失败时返回 false，让调用方感知', async () => {
    fs.outputJSON.mockRejectedValueOnce(new Error('disk full'))
    await expect(utils.saveJSON('gacha-list-1.json', {}, 1)).resolves.toBe(false)
  })

  test('写盘成功时返回 true', async () => {
    fs.outputJSON.mockResolvedValueOnce(undefined)
    await expect(utils.saveJSON('gacha-list-1.json', {}, 1)).resolves.toBe(true)
  })
})
