// 卡池表管理的纯逻辑（外部导入校验、手动修正条目构造、来源过滤）
const { parseLocal } = require('./bannerJudge')

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

// 校验外部导入的卡池 JSON
// 只接受 { banners: [...] } 结构；每期必须有 channel / start / end，
// 非法条目会被跳过并计数（不整体失败），但完全不合法的文件直接拒绝。
const validateBannerImport = (json) => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, error: 'notAnObject', banners: [], invalid: 0 }
  }
  if (!Array.isArray(json.banners)) {
    return { ok: false, error: 'noBanners', banners: [], invalid: 0 }
  }
  const banners = []
  let invalid = 0
  for (const item of json.banners) {
    if (!item || typeof item !== 'object') {
      invalid++
      continue
    }
    const channel = String(item.channel || '').trim()
    const start = String(item.start || '').trim()
    const end = String(item.end || '').trim()
    if (!channel || !start || !end) {
      invalid++
      continue
    }
    // 时间必须能被解析，否则无法参与判定
    if (!parseLocal(start) || !parseLocal(end)) {
      invalid++
      continue
    }
    const up = (Array.isArray(item.up) ? item.up : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
    banners.push({
      version: String(item.version || ''),
      phase: String(item.phase || ''),
      channel,
      title: String(item.title || ''),
      start,
      end,
      up,
      up4: (Array.isArray(item.up4) ? item.up4 : []).map((x) => String(x).trim()).filter(Boolean),
      source: 'manual'
    })  }
  if (!banners.length) {
    return { ok: false, error: 'noValidBanners', banners: [], invalid }
  }
  return { ok: true, error: '', banners, invalid }
}

// 构造一条手动修正的卡池条目
const buildManualBanner = (edit = {}) => {
  const channel = String(edit.channel || '').trim()
  const start = String(edit.start || '').trim()
  const end = String(edit.end || '').trim()
  if (!channel || !start || !end) return null
  return {
    version: String(edit.version || ''),
    phase: String(edit.phase || ''),
    channel,
    title: String(edit.title || ''),
    start,
    end,
    up: (Array.isArray(edit.up) ? edit.up : []).map((x) => String(x).trim()).filter(Boolean),
    // 保留原有 4 星 UP 名单（手动修正只针对最高级 UP）
    up4: (Array.isArray(edit.up4) ? edit.up4 : []).map((x) => String(x).trim()).filter(Boolean),
    source: 'manual'
  }
}

// 覆盖层中同一期（channel + 起止时间完全相同）的条目视为重复
const isSameBanner = (a, b) => {
  return a.channel === b.channel && a.start === b.start && a.end === b.end
}

// 合并手动修正条目：已存在则覆盖（UP 名单以本次为准）
const upsertManualBanner = (banners = [], entry) => {
  if (!entry) return banners
  const list = [...banners]
  const index = list.findIndex((b) => isSameBanner(b, entry))
  if (index >= 0) {
    list[index] = entry
  } else {
    list.push(entry)
  }
  return list
}

// 过滤出远程来源的条目
const filterRemoteBanners = (banners = []) => banners.filter((b) => b.source === 'remote')

// 解析用户输入的 UP 名单（逗号 / 顿号 / 换行分隔）
const parseUpList = (text) => {
  if (!text) return []
  return String(text)
    .split(/[,，、\n;；]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

module.exports = {
  validateBannerImport,
  buildManualBanner,
  isSameBanner,
  upsertManualBanner,
  filterRemoteBanners,
  parseUpList
}
