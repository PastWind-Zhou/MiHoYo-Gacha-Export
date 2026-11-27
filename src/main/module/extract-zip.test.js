const path = require('path')
const os = require('os')
const fs = require('fs')
const { EventEmitter } = require('events')
const { Readable } = require('stream')

// original-fs 是 Electron 内置模块，Jest 里用虚拟 mock 顶替；
// 只替换会参与越界判定的几个方法，其余（createWriteStream 等）保持真实行为
jest.mock('original-fs', () => {
  const real = jest.requireActual('fs')
  return Object.assign({}, real, {
    promises: Object.assign({}, real.promises, {
      mkdir: jest.fn(async () => {}),
      realpath: jest.fn(async (p) => p),
      symlink: jest.fn(async () => {}),
      lstat: jest.fn(async () => {
        const err = new Error('missing')
        err.code = 'ENOENT'
        throw err
      })
    })
  })
}, { virtual: true })

jest.mock('yauzl', () => ({ open: jest.fn() }))

const extract = require('./extract-zip')
const originalFs = require('original-fs')
const yauzl = require('yauzl')

const SYMLINK_ATTR = 40960 << 16 // S_IFLNK << 16，yauzl 用它识别 symlink 条目

const makeEntry = (fileName, target, symlink = false) => ({
  fileName,
  externalFileAttributes: symlink ? SYMLINK_ATTR : 0,
  versionMadeBy: 20,
  __target: target
})

const mockZip = (entries) => {
  const zip = new EventEmitter()
  let i = 0
  zip.readEntry = jest.fn(() => {
    if (i < entries.length) {
      const entry = entries[i++]
      process.nextTick(() => zip.emit('entry', entry))
    } else {
      // 真实 yauzl 读完条目后会 emit close，这里对齐该行为
      process.nextTick(() => zip.emit('close'))
    }
  })
  zip.close = jest.fn(() => zip.emit('close'))
  zip.openReadStream = jest.fn((entry, cb) => {
    cb(null, Readable.from([Buffer.from(String(entry.__target || 'data'))]))
  })
  yauzl.open.mockImplementation((zipPath, opts, cb) => cb(null, zip))
  return zip
}

describe('extract-zip 越界防护', () => {
  let root

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-zip-'))
    jest.clearAllMocks()
    // 默认：路径解析原样返回、目标不存在
    originalFs.promises.realpath.mockImplementation(async (p) => p)
    originalFs.promises.lstat.mockImplementation(async () => {
      const err = new Error('missing')
      err.code = 'ENOENT'
      throw err
    })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('assertInside 接受根内路径，拒绝 ../ 越界', () => {
    expect(() => extract.assertInside(root, path.join(root, 'a', 'b'))).not.toThrow()
    expect(() => extract.assertInside(root, path.join(root, '..', 'outside'))).toThrow(/Out of bound/)
    expect(() => extract.assertInside(root, path.resolve(root, '..'))).toThrow(/Out of bound/)
  })

  test('symlink 条目目标越界时拒绝解压（Zip Slip 叶子变体）', async () => {
    const zip = mockZip([makeEntry('link', '../../outside.txt', true)])
    await expect(extract('fake.zip', { dir: root })).rejects.toThrow(/Out of bound/)
    // 越界 symlink 不得真的落到磁盘
    expect(originalFs.promises.symlink).not.toHaveBeenCalled()
    expect(zip.close).toHaveBeenCalled()
  })

  test('dest 自身是指向外部的符号链接时拒绝写入', async () => {
    const outside = path.resolve(root, '..', 'outside.txt')
    originalFs.promises.lstat.mockImplementation(async () => ({ isSymbolicLink: () => true }))
    originalFs.promises.realpath.mockImplementation(async (p) => p === path.join(root, 'evil.txt') ? outside : p)
    mockZip([makeEntry('evil.txt', 'pwned')])
    await expect(extract('fake.zip', { dir: root })).rejects.toThrow(/Out of bound/)
  })

  test('合法条目仍可正常解压', async () => {
    mockZip([makeEntry('ok.txt', 'hello')])
    await expect(extract('fake.zip', { dir: root })).resolves.toBeUndefined()
    expect(fs.readFileSync(path.join(root, 'ok.txt'), 'utf8')).toBe('hello')
  })
})
