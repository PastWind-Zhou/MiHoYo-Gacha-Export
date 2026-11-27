// 记录标识：优先用 id；旧版数据没有 id 时退化为「时间+名称+类型」
const tnOf = (item) => `${item.time || ''}|${item.name || ''}|${item.item_type || ''}`

// 记录 id 可能是脏数据（非纯数字，v3.0 导入甚至完全没有 id），
// 排序时必须容错，否则一次脏数据就会让整个导入流程抛错
const toBigInt = (value) => {
  try {
    return BigInt(String(value ?? '').trim() || '0')
  } catch (e) {
    return 0n
  }
}

const mergeList = (a, b) => {
  if (!a || !a.length) return b || []
  if (!b || !b.length) return a
  const list = [...b, ...a]
  // 同一条记录可能两种形态并存：带 id 的新记录 + 不带 id 的旧记录。
  // 带 id 的记录信息更完整（可导出、可排序），因此保留带 id 的那条。
  const idKeys = new Set()
  list.forEach(item => {
    if (item.id) idKeys.add(tnOf(item))
  })
  const seen = new Set()
  const result = []
  list.forEach(item => {
    const key = item.id ? `id:${item.id}` : `tn:${tnOf(item)}`
    if (seen.has(key)) return
    // 不带 id 的旧记录，若同内容已有带 id 的记录，则丢弃旧的那条
    if (!item.id && idKeys.has(tnOf(item))) return
    seen.add(key)
    result.push(item)
  })
  return result.sort((m, n) => {
    const mv = toBigInt(m.id)
    const nv = toBigInt(n.id)
    if (mv > nv) {
      return 1
    } else if (mv < nv) {
      return -1
    }
    return 0
  })
}

const mergeData = (local, origin) => {
  if (local && local.result) {
    const localResult = local.result
    // 旧版 JSON 的 uid 可能是数字，抓取接口/UIGF 导入则多为字符串。
    // ===/!== 区分类型，同账号会被判成两个 uid 并直接返回 origin.result，
    // 本地记录被整份丢弃。统一按字符串比较，data.uid 本身保持原值。
    if (String(local.uid) !== String(origin.uid)) return origin.result
    const originResult = new Map()
    // 取两侧池键的并集：只遍历 origin 会把本地独有的池静默丢掉
    const keys = new Set([...origin.result.keys(), ...localResult.keys()])
    for (const key of keys) {
      const originValue = origin.result.get(key)
      const localValue = localResult.get(key)
      // 本地独有的池：原样保留
      if (originValue === undefined) {
        if (localValue !== undefined) originResult.set(key, localValue)
        continue
      }
      originResult.set(key, mergeList(localValue, originValue))
    }
    return originResult
  }
  return origin.result
}

module.exports = { mergeData, mergeList }
