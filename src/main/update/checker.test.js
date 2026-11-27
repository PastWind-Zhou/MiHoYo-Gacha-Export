const {
  REPO, UPDATE_API, PRODUCT_NAME, PLATFORM_ASSET, BUSY_STATUS,
  parseVersion, pickAsset, assetDigest, shouldUpdate
} = require('./checker')

// 更新源与资产命名是跨版本契约，写死断言防止被误改成别的仓库 / 名字
test('update source and product contract are stable', () => {
  expect(REPO).toBe('PastWind-Zhou/MiHoYo-Gacha-Export')
  expect(UPDATE_API).toBe(`https://api.github.com/repos/${REPO}/releases/latest`)
  expect(PRODUCT_NAME).toBe('MiHoYoGachaExport')
  expect(PLATFORM_ASSET).toEqual({ win32: 'win', darwin: 'mac', linux: 'linux' })
})

describe('parseVersion', () => {
  test('strips v prefix, whitespace and handles null', () => {
    expect(parseVersion('v1.0.2')).toBe('1.0.2')
    expect(parseVersion('V1.0.2')).toBe('1.0.2')
    expect(parseVersion('  1.0.2  ')).toBe('1.0.2')
    expect(parseVersion(undefined)).toBe('')
    expect(parseVersion(null)).toBe('')
  })
})

describe('pickAsset', () => {
  const asset = (name, extra = {}) => Object.assign({ name, browser_download_url: `https://example.test/${name}` }, extra)

  test('picks strictly named win asset whose version equals tag_name', () => {
    const release = {
      tag_name: 'v1.0.2',
      assets: [
        asset('release-notes.txt'),
        asset('MiHoYoGachaExport-1.0.1-win.zip'),
        asset('MiHoYoGachaExport-1.0.2-win.zip'),
        asset('MiHoYoGachaExport-1.0.2-linux.zip')
      ]
    }
    expect(pickAsset(release, 'win32')).toEqual(asset('MiHoYoGachaExport-1.0.2-win.zip'))
  })

  test('rejects asset whose embedded version differs from tag_name', () => {
    const release = { tag_name: 'v1.0.2', assets: [asset('MiHoYoGachaExport-1.0.1-win.zip')] }
    expect(pickAsset(release, 'win32')).toBeNull()
  })

  test('rejects loose or decorated names', () => {
    const names = [
      'MiHoYoGachaExport-1.0.2-win-x64.zip',
      'MiHoYoGachaExport-1.0.2-win.zip.sha256',
      'MiHoYoGachaExport_v1.0.2_win.zip',
      'mihoyogachaexport-1.0.2-win.zip',
      'prefix-MiHoYoGachaExport-1.0.2-win.zip'
    ]
    for (const name of names) {
      expect(pickAsset({ tag_name: '1.0.2', assets: [asset(name)] }, 'win32')).toBeNull()
    }
  })

  test('rejects non-semver tag, missing release, missing assets and unsupported platform', () => {
    expect(pickAsset({ tag_name: '1.0.2-beta.1', assets: [asset('MiHoYoGachaExport-1.0.2-beta.1-win.zip')] }, 'win32')).toBeNull()
    expect(pickAsset(null, 'win32')).toBeNull()
    expect(pickAsset({}, 'win32')).toBeNull()
    expect(pickAsset({ tag_name: '1.0.2' }, 'win32')).toBeNull()
    expect(pickAsset({ tag_name: '1.0.2', assets: 'not-an-array' }, 'win32')).toBeNull()
    expect(pickAsset({ tag_name: '1.0.2', assets: [asset('MiHoYoGachaExport-1.0.2-win.zip')] }, 'freebsd')).toBeNull()
  })

  test('respects platform token (mac / linux)', () => {
    const release = {
      tag_name: '1.0.2',
      assets: [
        asset('MiHoYoGachaExport-1.0.2-win.zip'),
        asset('MiHoYoGachaExport-1.0.2-mac.zip'),
        asset('MiHoYoGachaExport-1.0.2-linux.zip')
      ]
    }
    expect(pickAsset(release, 'darwin').name).toBe('MiHoYoGachaExport-1.0.2-mac.zip')
    expect(pickAsset(release, 'linux').name).toBe('MiHoYoGachaExport-1.0.2-linux.zip')
  })
})

describe('assetDigest', () => {
  const sha = 'a'.repeat(64)

  test('only accepts sha256:<64 hex> and returns bare hex', () => {
    expect(assetDigest({ digest: `sha256:${sha}` })).toBe(sha)
    expect(assetDigest({ digest: `SHA256:${sha}` })).toBe(sha)
    expect(assetDigest({ digest: `sha256:${'A'.repeat(64)}` })).toBe('a'.repeat(64))
  })

  test('fail closed on missing or malformed digest', () => {
    expect(assetDigest(null)).toBeNull()
    expect(assetDigest({})).toBeNull()
    expect(assetDigest({ digest: 'md5:abc' })).toBeNull()
    expect(assetDigest({ digest: `sha256:${'a'.repeat(63)}` })).toBeNull()
    expect(assetDigest({ digest: 'not-a-digest' })).toBeNull()
  })
})

describe('shouldUpdate', () => {
  const base = { current: '1.0.1', latest: '1.0.2', autoUpdate: true, isDev: false }

  test('updates when autoUpdate on and latest is newer', () => {
    expect(shouldUpdate(base)).toBe(true)
    expect(shouldUpdate(Object.assign({}, base, { autoUpdate: false, manual: true }))).toBe(true)
    expect(shouldUpdate(Object.assign({}, base, { current: 'v1.0.1', latest: 'v1.0.2' }))).toBe(true)
  })

  test('no update in dev mode or when neither auto nor manual', () => {
    expect(shouldUpdate(Object.assign({}, base, { isDev: true, manual: true }))).toBe(false)
    expect(shouldUpdate(Object.assign({}, base, { autoUpdate: false }))).toBe(false)
  })

  test('no update for equal / older / invalid versions', () => {
    expect(shouldUpdate(Object.assign({}, base, { latest: '1.0.1' }))).toBe(false)
    expect(shouldUpdate(Object.assign({}, base, { latest: '1.0.0' }))).toBe(false)
    expect(shouldUpdate(Object.assign({}, base, { current: 'not-semver' }))).toBe(false)
    expect(shouldUpdate(Object.assign({}, base, { latest: '' }))).toBe(false)
  })

  test('skipVersion blocks exactly that version', () => {
    expect(shouldUpdate(Object.assign({}, base, { skipVersion: '1.0.2' }))).toBe(false)
    expect(shouldUpdate(Object.assign({}, base, { skipVersion: 'v1.0.2' }))).toBe(false)
    expect(shouldUpdate(Object.assign({}, base, { skipVersion: '1.0.1' }))).toBe(true)
    expect(shouldUpdate(Object.assign({}, base, { skipVersion: 'garbage' }))).toBe(true)
  })

  test('busy statuses block a second update', () => {
    for (const status of BUSY_STATUS) {
      expect(shouldUpdate(Object.assign({}, base, { status }))).toBe(false)
    }
    expect(shouldUpdate(Object.assign({}, base, { status: 'idle' }))).toBe(true)
    expect(shouldUpdate(Object.assign({}, base, { status: 'failed' }))).toBe(true)
  })
})
