// 更新检测的纯逻辑：版本比较、资产选择、升级条件判断
//
// 该模块不发起网络请求、不依赖 electron —— 所有输入都是普通对象，
// 因此可以在纯 Node 环境下完整单元测试。
const semver = require('semver')

const REPO = 'PastWind-Zhou/MiHoYo-Gacha-Export'
// 更新源固定为 GitHub Releases latest（只读公开 API，无需登录）
const UPDATE_API = `https://api.github.com/repos/${REPO}/releases/latest`

const PRODUCT_NAME = 'MiHoYoGachaExport'
// 平台 → 资产名中的 token（win 对应 *-win.zip）
const PLATFORM_ASSET = { win32: 'win', darwin: 'mac', linux: 'linux' }

// 资产名必须严格匹配：<产品名>-<语义化版本>-<平台>.zip
// 例如 MiHoYoGachaExport-1.0.2-win.zip
const assetNameFor = (version, token) => `${PRODUCT_NAME}-${version}-${token}.zip`
const ASSET_RE = /^\d+\.\d+\.\d+$/

// tag_name 可能带 v 前缀（v1.0.2），统一去掉
const parseVersion = (tag) => {
  return String(tag == null ? '' : tag).replace(/^v/i, '').trim()
}

// 从 release.assets 中挑出当前平台的更新包
//
// 严格匹配两点（避免选错资产）：
//   1. 名称形如 MiHoYoGachaExport-<version>-<platform>.zip
//   2. 名称中的版本号必须与 tag_name 解析出的版本一致
const pickAsset = (release, platform = process.platform) => {
  if (!release || !release.tag_name) return null
  const token = PLATFORM_ASSET[platform]
  if (!token) return null
  const version = parseVersion(release.tag_name)
  // tag 不是合法语义化版本时宁可拒绝（fail closed），不猜测
  if (!ASSET_RE.test(version)) return null
  const assets = Array.isArray(release.assets) ? release.assets : []
  const expected = assetNameFor(version, token)
  return assets.find((a) => String(a && a.name) === expected) || null
}

// 解析 GitHub asset 的 digest 字段（形如 sha256:<hex>）
// 返回裸 hex；格式不对或缺失时返回 null —— 调用方必须据此拒绝更新
const assetDigest = (asset) => {
  if (!asset || typeof asset.digest !== 'string') return null
  const m = asset.digest.toLowerCase().match(/^sha256:([0-9a-f]{64})$/)
  return m ? m[1] : null
}

// 正在进行中的更新状态（出现这些状态时不允许再发起一次更新）
const BUSY_STATUS = ['downloading', 'verifying', 'backing-up', 'staging', 'ready', 'validating', 'restoring']

// 升级条件判断：全部满足才返回 true
//
//   - 非开发态（isDev）
//   - 自动更新开启，或用户手动触发
//   - latest 是合法 semver 且大于 current
//   - 该版本不在 skipVersion 中
//   - 没有正在进行的更新
//
// 「存在当前平台资产」「userData 可读」由调用方（index.js）补充判断
const shouldUpdate = ({ current, latest, autoUpdate = false, manual = false, skipVersion = '', status = '', isDev = false }) => {
  if (isDev) return false
  if (!autoUpdate && !manual) return false
  if (BUSY_STATUS.includes(status)) return false
  const c = parseVersion(current)
  const l = parseVersion(latest)
  if (!semver.valid(c) || !semver.valid(l)) return false
  if (!semver.gt(l, c)) return false
  const skip = parseVersion(skipVersion)
  if (skip && semver.valid(skip) && semver.eq(skip, l)) return false
  return true
}

module.exports = {
  REPO, UPDATE_API, PRODUCT_NAME, PLATFORM_ASSET, BUSY_STATUS,
  parseVersion, pickAsset, assetDigest, shouldUpdate
}
