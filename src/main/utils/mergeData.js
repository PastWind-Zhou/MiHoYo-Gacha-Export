// 记录标识：优先用 id；旧版数据没有 id 时退化为「时间+名称+类型」
const tnOf = (item) => `${item.time || ''}|${item.name || ''}|${item.item_type || ''}`

const mergeList = (a, b) => {
  if (!a || !a.length) return b || []
  if (!b || !b.length) return a
  const list = [...b, ...a]
  // 没有 id 的旧记录（老版本原神数据），按「时间+名称+类型」标识
  const legacyKeys = new Set()
  list.forEach(item => {
    if (!item.id) legacyKeys.add(tnOf(item))
  })
  const seen = new Set()
  const result = []
  list.forEach(item => {
    const key = item.id ? `id:${item.id}` : `tn:${tnOf(item)}`
    if (seen.has(key)) return
    // 新拉取的记录与旧记录内容相同时，只保留一条
    if (item.id && legacyKeys.has(tnOf(item))) return
    seen.add(key)
    result.push(item)
  })
  return result.sort((m, n) => {
    const num = BigInt(m.id) - BigInt(n.id)
    if (num > 0) {
      return 1
    } else if (num < 0) {
      return -1
    }
    return 0
  })
}

const mergeData = (local, origin) => {
  if (local && local.result) {
    const localResult = local.result
    const localUid = local.uid
    const originUid = origin.uid
    if (localUid !== originUid) return origin.result
    const originResult = new Map()
    for (let [key, value] of origin.result) {
      const newVal = mergeList(localResult.get(key), value)
      originResult.set(key, newVal)
    }
    return originResult
  }
  return origin.result
}

module.exports = { mergeData, mergeList }
