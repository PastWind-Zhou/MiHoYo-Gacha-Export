const crypto = require('crypto')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const {
  sha256FileSync, sha256File, scanDir, buildManifest, verifyManifest, isSubsetOf,
  ensureUserData, backupUserData, pruneBackups, restoreUserData
} = require('./dataGuard')

let tmp = null
let source = null
let target = null

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mhy-dataguard-'))
  source = path.join(tmp, 'source')
  target = path.join(tmp, 'target')
  fs.ensureDirSync(source)
})

afterEach(() => {
  fs.removeSync(tmp)
})

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const write = (dir, rel, content) => {
  const file = path.join(dir, rel)
  fs.ensureDirSync(path.dirname(file))
  fs.writeFileSync(file, content)
  return file
}

describe('hashing', () => {
  test('sha256FileSync and sha256File agree on a known buffer', async () => {
    const buf = Buffer.from('抽卡记录 sentinel')
    const file = write(source, 'gacha-list-123.json', buf)
    expect(sha256FileSync(file)).toBe(sha(buf))
    await expect(sha256File(file)).resolves.toBe(sha(buf))
  })
})

describe('scanDir / buildManifest', () => {
  test('missing directory scans as empty', () => {
    expect(scanDir(path.join(tmp, 'missing'))).toEqual([])
    expect(buildManifest(path.join(tmp, 'missing')).files).toEqual([])
  })

  test('recursively records relative path, size and sha256', () => {
    write(source, 'config.json', '{}')
    write(source, 'genshin/gacha-list-123.json', '[1]')
    write(source, 'genshin/ugc-list-123.json', '[2]')
    const manifest = buildManifest(source)
    expect(manifest.version).toBe(1)
    expect(typeof manifest.builtAt).toBe('number')
    expect(manifest.files).toHaveLength(3)
    const byName = (suffix) => manifest.files.find((f) => f.rel.endsWith(suffix))
    expect(byName('config.json').size).toBe(2)
    expect(byName('config.json').sha256).toBe(sha('{}'))
    expect(byName('gacha-list-123.json').sha256).toBe(sha('[1]'))
    expect(byName('ugc-list-123.json').sha256).toBe(sha('[2]'))
  })
})

describe('verifyManifest', () => {
  test('passes for an untouched directory', () => {
    write(source, 'config.json', '{}')
    write(source, 'genshin/gacha-list-123.json', '[1]')
    const manifest = buildManifest(source)
    expect(verifyManifest(source, manifest)).toEqual({ ok: true, missing: [], corrupt: [] })
  })

  test('detects missing and corrupted files', () => {
    write(source, 'config.json', '{}')
    write(source, 'genshin/gacha-list-123.json', '[1]')
    const manifest = buildManifest(source)
    fs.removeSync(path.join(source, 'genshin/gacha-list-123.json'))
    write(source, 'config.json', '{ }')
    const result = verifyManifest(source, manifest)
    expect(result.ok).toBe(false)
    expect(result.missing.some((f) => f.endsWith('gacha-list-123.json'))).toBe(true)
    expect(result.corrupt.some((f) => f.endsWith('config.json'))).toBe(true)
  })

  test('volatile files ignore hash changes but still require existence', () => {
    write(source, 'config.json', '{}')
    write(source, 'log.txt', 'old log')
    const manifest = buildManifest(source)
    write(source, 'log.txt', 'new log entry')
    expect(verifyManifest(source, manifest, { volatile: ['log.txt'] }).ok).toBe(true)
    fs.removeSync(path.join(source, 'log.txt'))
    expect(verifyManifest(source, manifest, { volatile: ['log.txt'] }).missing).toContain('log.txt')
  })

  test('treats path traversal in manifest rel as corrupt and allows extra files', () => {
    write(source, 'config.json', '{}')
    const manifest = buildManifest(source)
    manifest.files.push({ rel: '../evil.txt', size: 3, sha256: sha('evil') })
    const result = verifyManifest(source, manifest)
    expect(result.ok).toBe(false)
    expect(result.corrupt).toContain('../evil.txt')

    write(source, 'new-file-from-new-version.json', '{}')
    expect(verifyManifest(source, manifest).corrupt).not.toContain('new-file-from-new-version.json')
  })

  test('handles a malformed manifest defensively', () => {
    expect(verifyManifest(source, null)).toEqual({ ok: true, missing: [], corrupt: [] })
    expect(verifyManifest(source, {})).toEqual({ ok: true, missing: [], corrupt: [] })
  })
})

describe('isSubsetOf', () => {
  test('recognizes a subset of the same source and rejects foreign files', () => {
    const a = [{ rel: 'a', size: 1 }, { rel: 'b', size: 2 }]
    expect(isSubsetOf([{ rel: 'a', size: 1 }], a)).toBe(true)
    expect(isSubsetOf([{ rel: 'a', size: 9 }], a)).toBe(false)
    expect(isSubsetOf([{ rel: 'c', size: 1 }], a)).toBe(false)
    expect(isSubsetOf([{ rel: 'log.txt', size: 100 }], a)).toBe(true)
    expect(isSubsetOf([{ rel: 'log.txt', size: 100 }], a, { ignore: [] })).toBe(false)
  })
})

describe('ensureUserData (idempotent migration)', () => {
  test('copies missing files recursively and is idempotent', () => {
    write(source, 'config.json', '{}')
    write(source, 'genshin/gacha-list-123.json', '[1]')
    const first = ensureUserData(source, target)
    expect(first.copiedCount).toBe(2)
    expect(first.conflicts).toEqual([])
    expect(fs.readFileSync(path.join(target, 'genshin/gacha-list-123.json'), 'utf8')).toBe('[1]')
    const second = ensureUserData(source, target)
    expect(second.copiedCount).toBe(0)
    expect(second.conflicts).toEqual([])
  })

  test('never overwrites an existing file with different content', () => {
    write(source, 'config.json', '{"lang":"en"}')
    fs.ensureDirSync(target)
    fs.writeFileSync(path.join(target, 'config.json'), '{"lang":"zh"}')
    const result = ensureUserData(source, target)
    expect(result.conflicts).toContain('config.json')
    expect(result.copiedCount).toBe(0)
    expect(fs.readFileSync(path.join(target, 'config.json'), 'utf8')).toBe('{"lang":"zh"}')
  })

  test('throws when source is missing', () => {
    expect(() => ensureUserData(path.join(tmp, 'missing'), target)).toThrow('迁移来源不存在')
  })
})

describe('backupUserData', () => {
  test('creates backup + manifest, verifies it and counts files', () => {
    write(source, 'config.json', '{}')
    write(source, 'genshin/gacha-list-123.json', '[1]')
    const backupRoot = path.join(tmp, 'backup')
    const result = backupUserData(source, backupRoot, '1.0.2')
    expect(result.fileCount).toBe(2)
    expect(fs.existsSync(path.join(result.dir, 'manifest.json'))).toBe(true)
    expect(fs.readFileSync(path.join(result.dir, 'userData/config.json'), 'utf8')).toBe('{}')
    const manifest = fs.readJSONSync(path.join(result.dir, 'manifest.json'))
    expect(verifyManifest(path.join(result.dir, 'userData'), manifest).ok).toBe(true)
  })

  test('uses a retry suffix when called twice in the same second', () => {
    const stamp = '2026-11-27T12:00:00.000Z'
    const spy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(stamp)
    try {
      write(source, 'config.json', '{}')
      const backupRoot = path.join(tmp, 'backup')
      const first = backupUserData(source, backupRoot, '1.0.2')
      const second = backupUserData(source, backupRoot, '1.0.2')
      expect(path.basename(first.dir)).toBe('1.0.2-20261127120000')
      expect(path.basename(second.dir)).toBe('1.0.2-20261127120000-retry')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('pruneBackups', () => {
  test('keeps only the newest N backup directories', () => {
    const root = path.join(tmp, 'backup')
    for (let i = 0; i < 4; i++) {
      const dir = path.join(root, `1.0.2-${i}`)
      fs.ensureDirSync(dir)
      fs.writeFileSync(path.join(dir, 'manifest.json'), '{}')
      const t = new Date(2026, 0, 1 + i).getTime()
      fs.utimesSync(dir, t / 1000, t / 1000)
    }
    const removed = pruneBackups(root, 2)
    expect(removed).toHaveLength(2)
    expect(fs.existsSync(path.join(root, '1.0.2-3'))).toBe(true)
    expect(fs.existsSync(path.join(root, '1.0.2-2'))).toBe(true)
    expect(fs.existsSync(path.join(root, '1.0.2-0'))).toBe(false)
  })

  test('missing backup root is a no-op', () => {
    expect(pruneBackups(path.join(tmp, 'missing'))).toEqual([])
  })
})

describe('restoreUserData', () => {
  test('restores missing files and quarantines divergent ones', () => {
    write(source, 'config.json', '{"ok":true}')
    write(source, 'genshin/gacha-list-123.json', '[1]')
    const manifest = buildManifest(source)
    fs.ensureDirSync(target)
    // config.json 损坏；gacha-list 缺失
    fs.writeFileSync(path.join(target, 'config.json'), 'corrupted')

    const result = restoreUserData(source, target, manifest)
    expect(result.restored).toHaveLength(2)
    expect(result.quarantined).toContain('config.json')
    expect(fs.readFileSync(path.join(target, 'config.json'), 'utf8')).toBe('{"ok":true}')
    expect(fs.readFileSync(path.join(target, 'genshin/gacha-list-123.json'), 'utf8')).toBe('[1]')
    expect(fs.existsSync(path.join(source, 'quarantine/config.json'))).toBe(true)
  })

  test('keeps files created by the new version and does nothing when healthy', () => {
    write(source, 'config.json', '{}')
    const manifest = buildManifest(source)
    fs.ensureDirSync(target)
    fs.writeFileSync(path.join(target, 'config.json'), '{}')
    fs.writeFileSync(path.join(target, 'new-version-file.json'), '{}')
    const result = restoreUserData(source, target, manifest)
    expect(result.restored).toEqual([])
    expect(fs.existsSync(path.join(target, 'new-version-file.json'))).toBe(true)
  })
})
