// paths.js 的 userData 迁移规则测试
// 重点：只允许「本产品的旧版本目录」作为迁移来源，
// 不能吸收同级任意含 gacha 字样的目录（那会把无关数据带进新安装）
const path = require('path')
const fs = require('fs')
const os = require('os')

const { isProductVersionDir } = require('./paths')

describe('isProductVersionDir', () => {
  test('接受本产品的版本目录', () => {
    expect(isProductVersionDir('MiHoYoGachaExport-1.0.1')).toBe(true)
    expect(isProductVersionDir('MiHoYoGachaExport-1.0.1-win')).toBe(true)
    expect(isProductVersionDir('MiHoYoGachaExport-1.0.1-source')).toBe(true)
    expect(isProductVersionDir('MiHoYoGachaExport-2.0.0')).toBe(true)
  })

  test('拒绝无关目录（即使含 gacha 字样）', () => {
    // 旧实现用 /gacha/i 匹配，会误吸收这些目录
    expect(isProductVersionDir('some-gacha-tool')).toBe(false)
    expect(isProductVersionDir('my-gacha-notes')).toBe(false)
    expect(isProductVersionDir('gacha')).toBe(false)
    expect(isProductVersionDir('MiHoYoGachaExport')).toBe(false)
    expect(isProductVersionDir('release')).toBe(false)
    expect(isProductVersionDir('build')).toBe(false)
  })

  test('拒绝空值与非目录名', () => {
    expect(isProductVersionDir('')).toBe(false)
    expect(isProductVersionDir(null)).toBe(false)
    expect(isProductVersionDir(undefined)).toBe(false)
  })
})

describe('migrateUserData 的来源筛选', () => {
  // 用真实的临时目录结构验证：只有产品版本目录会被吸收
  const makeUserData = (dir, files) => {
    fs.mkdirSync(path.join(dir, 'userData'), { recursive: true })
    for (const name of files) {
      fs.writeFileSync(path.join(dir, 'userData', name), '{}', 'utf8')
    }
  }

  test('同级目录中只吸收产品版本目录的数据', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'))
    try {
      // 应被吸收：本产品旧版本
      makeUserData(path.join(root, 'MiHoYoGachaExport-1.0.0'), ['gacha-list.json'])
      // 不应被吸收：无关目录
      makeUserData(path.join(root, 'other-gacha-tool'), ['secret.json'])
      makeUserData(path.join(root, 'gacha-backup'), ['secret.json'])

      // 复刻 migrateUserData 的筛选逻辑
      const candidates = fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .filter((e) => isProductVersionDir(e.name))
        .map((e) => path.join(root, e.name, 'userData'))
        .filter((p) => fs.existsSync(p))

      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toContain('MiHoYoGachaExport-1.0.0')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
