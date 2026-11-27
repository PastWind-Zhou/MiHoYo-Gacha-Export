// 更新包下载与校验：流式下载、sha256 校验、zip 结构校验、解压到 staging
//
// 安全约束：
//   - 没有 sha256（GitHub assets[].digest）就拒绝下载（fail closed）
//   - zip 内绝不允许出现 userData 条目（发布包夹带用户数据 = 隐私泄露）
//   - zip 条目不得越界（绝对路径 / .. 穿越）
const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const fetch = require('electron-fetch').default
const AdmZip = require('adm-zip')

const { sha256File } = require('./dataGuard')

const PRODUCT_NAME = 'MiHoYoGachaExport'
// tag_name 必须是严格的稳定版本号（可带 v 前缀）。
// 预发布 / 后续版本等松散标题一律拒绝，避免手动更新误装预发布包。
const TAG_RE = /^v?\d+\.\d+\.\d+$/i

// 单次请求（release 元数据）的超时
const API_TIMEOUT = 15 * 1000
// 下载体积上限：正常更新包 ~100MB，留足余量
const MAX_BYTES = 300 * 1024 * 1024
// 下载停滞超时：连续 60s 没有收到数据视为死链，中止
// （不限制总时长：慢速网络下载大包可能超过任何固定总时限）
const IDLE_TIMEOUT = 60 * 1000

// 请求 GitHub Releases latest 元数据
// 仅公开 API，不传 token；带产品 User-Agent 便于区分流量来源
const fetchLatestRelease = async (apiUrl, version) => {
  const res = await fetch(apiUrl, {
    timeout: API_TIMEOUT,
    headers: {
      'User-Agent': `${PRODUCT_NAME}/${version}`,
      Accept: 'application/vnd.github+json'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`)
  }
  const release = await res.json()
  if (!release || !release.tag_name) {
    throw new Error('release 数据无效')
  }
  if (!TAG_RE.test(String(release.tag_name).trim())) {
    // 只允许 v1.0.2 / 1.0.2 这类稳定版本号；
    // "v1.0.2 Pre-release"、"v1.0.2-beta.1"、"1.0.2 后续版本" 全部 fail closed
    throw new Error('release tag_name 不是合法的稳定版本号，已拒绝')
  }
  return release
}

// 流式下载到 destFile：
//   1. 先写 <destFile>.part
//   2. 体积超限 / 停滞超时 → 删除 .part 并抛错
//   3. sha256 不匹配 → 删除 .part 并抛错（fail closed）
//   4. 全部通过后原子改名
const downloadFile = async (url, destFile, opts = {}) => {
  const expectedSha256 = opts.expectedSha256
  const onProgress = opts.onProgress
  const maxBytes = opts.maxBytes || MAX_BYTES
  const idleTimeout = opts.idleTimeout || IDLE_TIMEOUT
  // fail closed：没有期望哈希就拒绝下载，防止「下载了但无从校验」
  if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('更新包缺少 sha256 校验信息，已取消下载')
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载失败 HTTP ${res.status}`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  const part = `${destFile}.part`
  await fs.ensureDir(path.dirname(destFile))
  // received 必须在 Promise 外声明： finally 里的 size 返回要用
  let received = 0
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(part)
    let lastActive = Date.now()
    let settled = false
    let timer = null
    const finish = (err) => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      if (err) {
        ws.destroy()
        // 失败时清理半截文件，调用方无需关心 .part 残留
        fs.remove(part).catch(() => {})
        reject(err)
      } else {
        resolve()
      }
    }
    // 停滞检测：只看「最近收到数据的时间」，不限制总时长
    timer = setInterval(() => {
      if (Date.now() - lastActive > idleTimeout) {
        finish(new Error('下载停滞超时'))
      }
    }, 5000)
    let lastReport = 0
    res.body.on('data', (chunk) => {
      received += chunk.length
      lastActive = Date.now()
      if (received > maxBytes) {
        finish(new Error('下载内容超过体积上限'))
        res.body.destroy()
        return
      }
      // 进度上报做节流：每个 chunk 都发会把 IPC 打满
      const now = Date.now()
      if (onProgress && (now - lastReport > 400 || received === total)) {
        lastReport = now
        onProgress(received, total)
      }
    })
    res.body.on('error', (err) => finish(err))
    ws.on('error', (err) => finish(err))
    ws.on('finish', () => finish())
    res.body.pipe(ws)
  })
  const hex = await sha256File(part)
  if (hex !== expectedSha256) {
    await fs.remove(part)
    throw new Error('更新包 sha256 校验失败')
  }
  await fs.move(part, destFile, { overwrite: true })
  return { size: received }
}

// zip 条目名归一化：adm-zip 的 entryName 在 Windows 下用反斜杠，
// 统一转成正斜杠再做安全检查
const normalizeEntryName = (name) => String(name || '').replace(/\\/g, '/')

// 校验更新包结构（解压前的安全门）
//
//   - 每个条目都必须位于唯一的顶层目录 MiHoYoGachaExport-<version>-win/ 下
//   - 拒绝绝对路径 / 盘符 / .. 穿越
//   - 拒绝 userData 条目（发布包绝不应包含用户数据）
//   - 必须包含 exe、resources/app/package.json、
//     resources/app/dist/electron/main/main.js（缺一不可，防止「更新成功
//     却启动不了」的结构性事故）
const validateZip = (zipFile, version) => {
  let zip
  try {
    zip = new AdmZip(zipFile)
  } catch (e) {
    throw new Error('更新包不是有效的 zip 文件')
  }
  const root = `${PRODUCT_NAME}-${version}-win`
  let sawExe = false
  let sawPackage = false
  let sawMain = false
  for (const entry of zip.getEntries()) {
    const name = normalizeEntryName(entry.entryName)
    if (/^[a-zA-Z]:/.test(name) || name.startsWith('/') || name.startsWith('\\')) {
      throw new Error(`更新包含绝对路径条目：${name}`)
    }
    const segments = name.split('/')
    if (segments.some((seg) => seg === '..')) {
      throw new Error(`更新包含路径穿越条目：${name}`)
    }
    if (segments[0] !== root) {
      throw new Error(`更新包顶层目录不符合预期：${segments[0]}（应为 ${root}）`)
    }
    if (name === `${root}/userData` || name.startsWith(`${root}/userData/`)) {
      throw new Error('更新包含用户数据目录，已拒绝（隐私保护）')
    }
    if (name === `${root}/${PRODUCT_NAME}.exe`) sawExe = true
    if (name === `${root}/resources/app/package.json`) sawPackage = true
    if (name === `${root}/resources/app/dist/electron/main/main.js`) sawMain = true
  }
  if (!sawExe || !sawPackage || !sawMain) {
    throw new Error('更新包缺少必需文件（exe / package.json / main.js）')
  }
  return { root, entries: zip.getEntries().length }
}

// 解压到目标目录（validateZip 通过后调用才安全）
// extractAllTo 覆盖写入：staging 目录在解压前由调用方清理过
// root 为 zip 内的顶层目录名（由调用方按版本号拼出），返回其落盘后的完整路径
const extractZip = (zipFile, destDir, root) => {
  const zip = new AdmZip(zipFile)
  fs.ensureDirSync(destDir)
  zip.extractAllTo(destDir, true)
  return path.join(destDir, root)
}

module.exports = {
  API_TIMEOUT, MAX_BYTES, IDLE_TIMEOUT,
  fetchLatestRelease, downloadFile, validateZip, extractZip
}
