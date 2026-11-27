// 卡池排期的合并逻辑（纯逻辑，不依赖 Electron，便于 Node 脚本与单测复用）
//
// 同一 (channel, 结束时间) 下可能存在多个并行卡池（游戏会同期开放两个角色池），
// 因此不能简单用 channel@end 做唯一键，否则并行池会互相覆盖导致数据丢失。
// 这里采用「分组 + 贪心配对」：
//   1. 按 (channel, 结束日期) 把 base 与 incoming 分组
//      —— 只精确到日期：不同数据源的结束时间可能有秒级差异
//         （内置用 14:59:59，wiki 用 14:59:00），精确到秒会导致完全配不上
//   2. 组内先按 UP 名单集合精确配对（同一卡池 → incoming 的 UP 更权威）
//   3. 组内剩余的按顺序配对（UP 被修正的情况）
//   4. incoming 中没配上的 → 新卡池，追加
//   5. base 中没配上的 → 保留不动
// 合并时保留 base 的 start（上游按「版本更新或上一期结束时间推定」，比远端推定更准）。
// end 仅在「日期」发生变化时才更新（真正的排期修正）；秒级差异忽略。
const { parseLocal } = require('./bannerJudge')

const bannerKey = (b) => `${b.channel}@${String(b.end || '').slice(0, 10)}`

// 某个卡池是否带有 UP 信息（up 名单或 upByType 拆分名单任一非空）
const hasUpInfo = (b) => {
  if (!b) return false
  if ((b.up || []).length) return true
  const t = b.upByType
  if (!t) return false
  return (t.character || []).length > 0 || (t.weapon || []).length > 0
}

// 深拷贝 upByType（避免共享引用被外部改写）
const cloneUpByType = (t) => {
  if (!t) return undefined
  return {
    character: [...(t.character || [])],
    weapon: [...(t.weapon || [])]
  }
}

// UP 指纹：同时包含 up 与 upByType。
// 集录祈愿（jilu）等混合池的 UP 分角色/武器两类存放，
// 只比较 up 会导致 upByType 上的修正永远判定为「没变」而被丢弃。
const upFingerprint = (b) => {
  const up = (b && b.up ? b.up : []).slice().sort().join('|')
  const t = b && b.upByType
  const c = t ? (t.character || []).slice().sort().join('|') : ''
  const w = t ? (t.weapon || []).slice().sort().join('|') : ''
  return up + '@' + c + '#' + w
}

// 配对用的键：优先用 up 名单；up 为空时退化为 upByType，
// 避免「只有 upByType」的卡池全部落到同一个空键上而互相错配
const upSetKey = (b) => {
  const up = (b && b.up ? b.up : []).slice().sort().join('|')
  if (up) return up
  const t = b && b.upByType
  if (!t) return ''
  const c = (t.character || []).slice().sort().join('|')
  const w = (t.weapon || []).slice().sort().join('|')
  return `bt:${c}#${w}`
}

// 结束时间是否发生了实质变化（日期不同才算）
const endChanged = (a, b) => String(a || '').slice(0, 10) !== String(b || '').slice(0, 10)

// 合并时是否允许 incoming 覆盖 base
//   overrideUp    —— incoming 的 UP 名单覆盖 base（手动/远程层为 true）
//   overrideTime  —— incoming 的结束时间覆盖 base（日期变化才算）
//   fillEmptyUp   —— incoming 的 UP 只填补 base 的空缺（base 的 UP 为空时才写入）
//                     本地反推层用这个：内置排期更权威（已有 UP 就不动），
//                     但内置某期缺 UP 名单时，正好用反推结果补上
const mergeBanners = (base, incoming, options = {}) => {
  const overrideUp = options.overrideUp !== false
  const overrideTime = options.overrideTime !== false
  const fillEmptyUp = options.fillEmptyUp === true
  base = Array.isArray(base) ? base : []
  incoming = Array.isArray(incoming) ? incoming : []
  // 取出 UP 名单（up + upByType），upByType 与 up 一同受合并策略控制
  const takeUpOf = (baseBanner, incomingBanner) => {
    const baseUp = baseBanner.up || []
    const incUp = incomingBanner.up || []
    const incByType = cloneUpByType(incomingBanner.upByType)
    if (overrideUp) {
      // incoming 权威：UP 名单与 upByType 都以 incoming 为准；
      // incoming 没给 upByType 时保留 base 的，避免把集录池的分类信息抹掉
      return {
        up: incUp,
        upByType: incByType || cloneUpByType(baseBanner.upByType)
      }
    }
    if (fillEmptyUp && !hasUpInfo(baseBanner) && hasUpInfo(incomingBanner)) {
      return { up: incUp, upByType: incByType }
    }
    return { up: baseUp, upByType: cloneUpByType(baseBanner.upByType) }
  }
  const cloneBanner = (b) => ({
    ...b,
    up: [...(b.up || [])],
    up4: [...(b.up4 || [])],
    upIds: [...(b.upIds || [])],
    candidates: [...(b.candidates || [])],
    ...(b.upByType ? { upByType: cloneUpByType(b.upByType) } : {})
  })
  const result = base.map(cloneBanner)
  const baseUsed = new Array(result.length).fill(false)
  const incomingUsed = new Array(incoming.length).fill(false)
  let added = 0
  let updated = 0
  // 增量变更列表：只包含「新增」与「被修正」的卡池
  // 覆盖层只应保存增量，否则会把内置基线整份复制进去，
  // 导致内置数据后续更新被旧覆盖层压住。
  const changes = []

  // 按 (channel,end) 分组
  const groupOf = (arr, keyFn) => {
    const m = new Map()
    arr.forEach((x, i) => {
      const k = keyFn(x)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(i)
    })
    return m
  }
  const baseGroups = groupOf(result, bannerKey)
  const inGroups = groupOf(incoming, bannerKey)

  for (const [slot, bIdx] of baseGroups) {
    const iIdx = inGroups.get(slot) || []
    if (!iIdx.length) continue

    // 2. UP 名单精确配对
    const iByUp = new Map()
    for (const i of iIdx) {
      const k = upSetKey(incoming[i])
      if (!iByUp.has(k)) iByUp.set(k, [])
      iByUp.get(k).push(i)
    }
    const remainingI = []
    for (const bi of bIdx) {
      const k = upSetKey(result[bi])
      const pool = iByUp.get(k)
      let matched = -1
      if (pool) {
        while (pool.length) {
          const cand = pool.shift()
          if (!incomingUsed[cand]) { matched = cand; break }
        }
      }
      if (matched >= 0) {
        baseUsed[bi] = true
        incomingUsed[matched] = true
        const taken = takeUpOf(result[bi], incoming[matched])
        const takenUp = taken.up
        const upChanged = upFingerprint({ up: takenUp, upByType: taken.upByType }) !== upFingerprint(result[bi])
        const eChanged = overrideTime && endChanged(result[bi].end, incoming[matched].end)
        result[bi] = {
          ...result[bi],
          end: eChanged ? incoming[matched].end : result[bi].end,
          up: [...takenUp],
          source: upChanged ? (incoming[matched].source || result[bi].source) : result[bi].source,
          confidence: upChanged ? (incoming[matched].confidence || '') : result[bi].confidence,
          ...(taken.upByType ? { upByType: taken.upByType } : {})
        }
        if (upChanged || eChanged) {
          updated++
          changes.push(result[bi])
        }
      } else {
        remainingI.push(bi)
      }
    }

    // 3. 剩余按顺序配对
    // 并行池（同一 channel 同期开多个池）不能纯按下标硬配，
    // 否则 base 的 A 池可能配到 incoming 的 B 池，导致 UP 名单串池。
    // 这里按「起始时间相同 → phase 相同 → title 相同」打分择优配对。
    const freeI = iIdx.filter((i) => !incomingUsed[i])
    const scoreOf = (bi, ii) => {
      const b = result[bi]
      const c = incoming[ii]
      let score = 0
      if (String(b.start || '') === String(c.start || '')) score += 4
      if (b.phase && c.phase && String(b.phase) === String(c.phase)) score += 2
      if (b.title && c.title && String(b.title) === String(c.title)) score += 1
      return score
    }
    for (const bi of remainingI) {
      let best = -1
      let bestScore = -1
      for (const ii of freeI) {
        if (incomingUsed[ii]) continue
        const score = scoreOf(bi, ii)
        if (score > bestScore) {
          bestScore = score
          best = ii
        }
      }
      // 完全没有可配对的 incoming，跳过（该 base 条目保持原样）
      if (best < 0) continue
      const ii = best
      baseUsed[bi] = true
      incomingUsed[ii] = true
      const taken = takeUpOf(result[bi], incoming[ii])
      const takenUp = taken.up
      const upChanged = upFingerprint({ up: takenUp, upByType: taken.upByType }) !== upFingerprint(result[bi])
      const eChanged = overrideTime && endChanged(result[bi].end, incoming[ii].end)
      // 保留 base 的 start；end 仅在日期变化时更新；up 依合并策略决定
      result[bi] = {
        ...result[bi],
        end: eChanged ? incoming[ii].end : result[bi].end,
        up: [...takenUp],
        source: upChanged ? (incoming[ii].source || result[bi].source) : result[bi].source,
        confidence: upChanged ? (incoming[ii].confidence || '') : result[bi].confidence,
        ...(taken.upByType ? { upByType: taken.upByType } : {})
      }
      if (upChanged || eChanged) {
        updated++
        changes.push(result[bi])
      }
    }
  }

  // 4. incoming 中没配上的 → 新卡池
  for (let i = 0; i < incoming.length; i++) {
    if (incomingUsed[i]) continue
    const item = cloneBanner(incoming[i])
    result.push(item)
    changes.push(item)
    added++
  }

  result.sort((a, b) => (parseLocal(a.start) || 0) - (parseLocal(b.start) || 0))
  return { banners: result, added, updated, changes }
}

module.exports = { bannerKey, upSetKey, endChanged, mergeBanners }
