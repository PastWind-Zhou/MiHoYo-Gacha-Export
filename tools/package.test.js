// tools/package.js 的纯逻辑测试
// 注意：package.js 的主流程由 require.main === module 守卫，require 时不会执行打包。
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  isProductVersionDir,
  planBackupRecovery,
  clearReleaseDir,
  dirHasContent,
  KEEP_NAMES
} = require('./package')

const makeTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-tools-'))
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true })

describe('isProductVersionDir', () => {
  test('接受数字版本与可选平台后缀（含多段）', () => {
    const accepted = [
      'MiHoYoGachaExport-1.0',
      'MiHoYoGachaExport-1.0.2',
      'MiHoYoGachaExport-1.0.2-win',
      'MiHoYoGachaExport-1.0.2-win-x64',
      'MiHoYoGachaExport-1.0.2-win-ia32',
      'MiHoYoGachaExport-2.0.0-mac-arm64'
    ]
    for (const name of accepted) {
      expect([name, isProductVersionDir(name)]).toEqual([name, true])
    }
  })

  test('拒绝 -source 源码包、无关目录与畸形后缀', () => {
    const rejected = [
      'MiHoYoGachaExport-1.0.2-source',
      'MiHoYoGachaExport-1.0.2-win-source',
      'MiHoYoGachaExport-1.0.2-SOURCE',
      'other-gacha-tool',
      'MiHoYoGachaExport',
      'MiHoYoGachaExport-1.0.2-',
      'MiHoYoGachaExport-1.0.2--win',
      ''
    ]
    for (const name of rejected) {
      expect([name, isProductVersionDir(name)]).toEqual([name, false])
    }
  })

  test('与 src/main/paths.js 的判定完全一致', () => {
    const { isProductVersionDir: fromPaths } = require('../src/main/paths')
    const names = [
      'MiHoYoGachaExport-1.0',
      'MiHoYoGachaExport-1.0.2',
      'MiHoYoGachaExport-1.0.2-win',
      'MiHoYoGachaExport-1.0.2-win-x64',
      'MiHoYoGachaExport-1.0.2-win-ia32',
      'MiHoYoGachaExport-1.0.2-source',
      'MiHoYoGachaExport-1.0.2-win-source',
      'some-gacha-tool',
      'MiHoYoGachaExport',
      '',
      null
    ]
    for (const name of names) {
      expect(fromPaths(name)).toBe(isProductVersionDir(name))
    }
  })
})

describe('dirHasContent', () => {
  test('空目录与不存在的目录视为无内容', () => {
    const root = makeTemp()
    try {
      const empty = path.join(root, 'empty')
      fs.mkdirSync(empty)
      expect(dirHasContent(empty)).toBe(false)
      expect(dirHasContent(path.join(root, 'missing'))).toBe(false)
    } finally {
      cleanup(root)
    }
  })

  test('有文件则视为有内容；读不到时保守视为有内容', () => {
    const root = makeTemp()
    try {
      const dir = path.join(root, 'data')
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'config.json'), '{}')
      expect(dirHasContent(dir)).toBe(true)
      const mock = {
        existsSync: () => true,
        readdirSync: () => { throw new Error('EACCES') }
      }
      expect(dirHasContent(dir, mock)).toBe(true)
    } finally {
      cleanup(root)
    }
  })
})

describe('planBackupRecovery', () => {
  test('没有遗留备份 → 走常规扫描流程', () => {
    const root = makeTemp()
    try {
      const backup = path.join(root, '_userData_backup')
      const target = path.join(root, 'stage', 'userData')
      expect(planBackupRecovery({ backupPath: backup, stageUserDataPath: target }))
        .toEqual({ ok: true, reuse: false })
    } finally {
      cleanup(root)
    }
  })

  test('遗留备份存在且目标无冲突 → 可安全复用（保留备份）', () => {
    const root = makeTemp()
    try {
      const backup = path.join(root, '_userData_backup')
      fs.mkdirSync(backup)
      fs.writeFileSync(path.join(backup, 'config.json'), '{}')
      const target = path.join(root, 'stage', 'userData') // 尚不存在
      expect(planBackupRecovery({ backupPath: backup, stageUserDataPath: target }))
        .toEqual({ ok: true, reuse: true, backupPath: backup, targetPath: target })
    } finally {
      cleanup(root)
    }
  })

  test('目标已有用户数据 → 不安全，返回备份与目标路径', () => {
    const root = makeTemp()
    try {
      const backup = path.join(root, '_userData_backup')
      fs.mkdirSync(backup)
      fs.writeFileSync(path.join(backup, 'config.json'), '{}')
      const target = path.join(root, 'stage', 'userData')
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'config.json'), '{}')

      const r = planBackupRecovery({ backupPath: backup, stageUserDataPath: target })
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/已存在用户数据/)
      expect(r.backupPath).toBe(backup)
      expect(r.targetPath).toBe(target)
    } finally {
      cleanup(root)
    }
  })

  test('备份路径不是目录 → 不安全', () => {
    const root = makeTemp()
    try {
      const backup = path.join(root, '_userData_backup')
      fs.writeFileSync(backup, 'not a dir')
      const target = path.join(root, 'stage', 'userData')
      const r = planBackupRecovery({ backupPath: backup, stageUserDataPath: target })
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/不是目录/)
      expect(r.backupPath).toBe(backup)
    } finally {
      cleanup(root)
    }
  })

  test('目标无法读取 → 保守判定不安全', () => {
    const root = makeTemp()
    try {
      const backup = path.join(root, '_userData_backup')
      fs.mkdirSync(backup)
      const target = path.join(root, 'stage', 'userData')
      fs.mkdirSync(target, { recursive: true })
      const mock = {
        existsSync: (p) => fs.existsSync(p),
        statSync: (p) => fs.statSync(p),
        readdirSync: (p) => {
          if (p === target) throw new Error('EACCES')
          return fs.readdirSync(p)
        }
      }
      const r = planBackupRecovery({ backupPath: backup, stageUserDataPath: target, fsImpl: mock })
      expect(r.ok).toBe(false)
    } finally {
      cleanup(root)
    }
  })
})

describe('clearReleaseDir', () => {
  test('保留备份与临时目录，删除其它旧产物', () => {
    const root = makeTemp()
    try {
      for (const name of ['_userData_backup', '_userData_tmp', 'old-version', 'old.zip']) {
        fs.mkdirSync(path.join(root, name))
        fs.writeFileSync(path.join(root, name, 'x.txt'), 'x')
      }
      const problems = clearReleaseDir({ releaseDir: root, keepNames: KEEP_NAMES })
      expect(problems).toEqual([])
      expect(fs.existsSync(path.join(root, '_userData_backup'))).toBe(true)
      expect(fs.existsSync(path.join(root, '_userData_tmp'))).toBe(true)
      expect(fs.existsSync(path.join(root, 'old-version'))).toBe(false)
      expect(fs.existsSync(path.join(root, 'old.zip'))).toBe(false)
    } finally {
      cleanup(root)
    }
  })

  test('删除失败时返回问题项，且绝不触及保留目录', () => {
    const root = makeTemp()
    try {
      for (const name of ['_userData_backup', 'locked']) {
        fs.mkdirSync(path.join(root, name))
      }
      const mock = {
        readdirSync: (p) => fs.readdirSync(p),
        rmSync: (p, opts) => {
          if (path.basename(p) === 'locked') throw new Error('EBUSY')
          return fs.rmSync(p, opts)
        }
      }
      const problems = clearReleaseDir({
        releaseDir: root,
        keepNames: KEEP_NAMES,
        fsImpl: mock
      })
      expect(problems).toEqual([{ name: 'locked', message: 'EBUSY' }])
      expect(fs.existsSync(path.join(root, '_userData_backup'))).toBe(true)
      expect(fs.existsSync(path.join(root, 'locked'))).toBe(true)
    } finally {
      cleanup(root)
    }
  })
})
