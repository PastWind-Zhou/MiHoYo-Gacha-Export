jest.mock('electron-fetch', () => ({ __esModule: true, default: jest.fn() }))

const crypto = require('crypto')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const AdmZip = require('adm-zip')
const fetch = require('electron-fetch').default
const {
  API_TIMEOUT, MAX_BYTES, IDLE_TIMEOUT,
  fetchLatestRelease, downloadFile, validateZip, extractZip
} = require('./downloader')

let tmp = null

beforeEach(() => {
  fetch.mockReset()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mhy-downloader-'))
})

afterEach(() => {
  fs.removeSync(tmp)
})

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const response = (buf, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => String(buf.length) },
  body: Readable.from([buf])
})

describe('fetchLatestRelease', () => {
  test('requests public GitHub API with product User-Agent and returns release', async () => {
    const release = { tag_name: 'v1.0.2', assets: [] }
    fetch.mockResolvedValue({ ok: true, json: async () => release })
    await expect(fetchLatestRelease('https://example.test/latest', '1.0.1')).resolves.toEqual(release)
    expect(fetch).toHaveBeenCalledWith('https://example.test/latest', {
      timeout: API_TIMEOUT,
      headers: {
        'User-Agent': 'MiHoYoGachaExport/1.0.1',
        Accept: 'application/vnd.github+json'
      }
    })
  })

  test('throws on non-ok response and invalid payload', async () => {
    fetch.mockResolvedValue({ ok: false, status: 403 })
    await expect(fetchLatestRelease('https://example.test/latest', '1.0.1')).rejects.toThrow('GitHub API 403')

    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(fetchLatestRelease('https://example.test/latest', '1.0.1')).rejects.toThrow('release 数据无效')
  })
})

describe('downloadFile', () => {
  test('fail closed when expected sha256 is missing or malformed', async () => {
    const dest = path.join(tmp, 'app.zip')
    await expect(downloadFile('https://example.test/app.zip', dest, {})).rejects.toThrow('sha256')
    await expect(downloadFile('https://example.test/app.zip', dest, { expectedSha256: 'abc' })).rejects.toThrow('sha256')
    expect(fetch).not.toHaveBeenCalled()
    expect(fs.existsSync(dest)).toBe(false)
  })

  test('streams to .part, verifies sha256, then atomically renames', async () => {
    const buf = Buffer.from('a valid update package')
    const dest = path.join(tmp, 'app.zip')
    const onProgress = jest.fn()
    fetch.mockResolvedValue(response(buf))
    await expect(downloadFile('https://example.test/app.zip', dest, {
      expectedSha256: sha(buf), onProgress
    })).resolves.toEqual({ size: buf.length })
    expect(fs.readFileSync(dest)).toEqual(buf)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
    expect(onProgress).toHaveBeenCalledWith(buf.length, buf.length)
  })

  test('rejects and cleans up on sha256 mismatch', async () => {
    const buf = Buffer.from('tampered package')
    const dest = path.join(tmp, 'app.zip')
    fetch.mockResolvedValue(response(buf))
    await expect(downloadFile('https://example.test/app.zip', dest, {
      expectedSha256: 'b'.repeat(64)
    })).rejects.toThrow('sha256 校验失败')
    expect(fs.existsSync(dest)).toBe(false)
  })

  test('rejects on HTTP error and on body error', async () => {
    const dest = path.join(tmp, 'app.zip')
    fetch.mockResolvedValue({ ok: false, status: 404 })
    await expect(downloadFile('https://example.test/app.zip', dest, { expectedSha256: 'a'.repeat(64) })).rejects.toThrow('HTTP 404')

    // 让流在首次被读取时自行报错，避免手动 emit 与监听器挂载时机竞争
    const body = new Readable({
      read() { this.destroy(new Error('network reset')) }
    })
    fetch.mockResolvedValue({ ok: true, headers: { get: () => '0' }, body })
    await expect(downloadFile('https://example.test/app.zip', dest, { expectedSha256: 'a'.repeat(64) })).rejects.toThrow('network reset')
  })

  test('rejects when download exceeds maxBytes', async () => {
    const buf = Buffer.alloc(32, 'x')
    const dest = path.join(tmp, 'app.zip')
    fetch.mockResolvedValue(response(buf))
    await expect(downloadFile('https://example.test/app.zip', dest, {
      expectedSha256: sha(buf), maxBytes: 8
    })).rejects.toThrow('超过体积上限')
  })
})

describe('validateZip', () => {
  const root = 'MiHoYoGachaExport-1.0.2-win'
  const required = [
    `${root}/MiHoYoGachaExport.exe`,
    `${root}/resources/app/package.json`,
    `${root}/resources/app/dist/electron/main/main.js`
  ]
  const makeZip = (entries, rename = {}) => {
    const zip = new AdmZip()
    for (const name of entries) {
      const entry = zip.addFile(name, Buffer.from('content'))
      if (rename[name]) entry.entryName = rename[name]
    }
    const file = path.join(tmp, 'app.zip')
    zip.writeZip(file)
    return file
  }

  test('accepts a well-formed package under the single expected root', () => {
    const file = makeZip(required.concat([`${root}/resources/app/README.md`]))
    expect(validateZip(file, '1.0.2')).toEqual({ root, entries: 4 })
  })

  test('rejects userData entries (privacy protection)', () => {
    const file = makeZip(required.concat([`${root}/userData/config.json`]))
    expect(() => validateZip(file, '1.0.2')).toThrow('用户数据目录')
  })

  test('rejects path traversal and absolute entries', () => {
    // AdmZip.addFile 会归一化 ..，因此先加入再改写 entryName 模拟恶意包
    const evil = `${root}/evil.txt`
    const traversal = makeZip(required.concat([evil]), { [evil]: `${root}/../../evil.txt` })
    expect(() => validateZip(traversal, '1.0.2')).toThrow('路径穿越')

    const abs = `${root}/abs.txt`
    const absolute = makeZip(required.concat([abs]), { [abs]: 'C:/evil.txt' })
    expect(() => validateZip(absolute, '1.0.2')).toThrow('绝对路径')
  })

  test('rejects unexpected top-level directory and missing required files', () => {
    const wrongRoot = makeZip(['Other-1.0.2-win/MiHoYoGachaExport.exe'])
    expect(() => validateZip(wrongRoot, '1.0.2')).toThrow('顶层目录')

    const missingMain = makeZip(required.slice(0, 2))
    expect(() => validateZip(missingMain, '1.0.2')).toThrow('缺少必需文件')
  })

  test('rejects non-zip content', () => {
    const file = path.join(tmp, 'broken.zip')
    fs.writeFileSync(file, 'not a zip')
    expect(() => validateZip(file, '1.0.2')).toThrow('不是有效的 zip')
  })
})

test('extractZip unpacks into staging and returns the versioned root path', () => {
  const root = 'MiHoYoGachaExport-1.0.2-win'
  const zip = new AdmZip()
  zip.addFile(`${root}/MiHoYoGachaExport.exe`, Buffer.from('exe'))
  const zipFile = path.join(tmp, 'app.zip')
  zip.writeZip(zipFile)
  const staging = path.join(tmp, 'staging')
  const extracted = extractZip(zipFile, staging, root)
  expect(extracted).toBe(path.join(staging, root))
  expect(fs.readFileSync(path.join(extracted, 'MiHoYoGachaExport.exe'), 'utf8')).toBe('exe')
})

test('download limits are configurable and documented', () => {
  expect(API_TIMEOUT).toBe(15 * 1000)
  expect(MAX_BYTES).toBe(300 * 1024 * 1024)
  expect(IDLE_TIMEOUT).toBe(60 * 1000)
})
