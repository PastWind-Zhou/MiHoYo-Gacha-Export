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
const upSetKey = (b) => (b.up || []).slice().sort().join('|')

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
  const takeUpOf = (baseBanner, incomingBanner) => {
    const baseUp = baseBanner.up || []
    const incUp = incomingBanner.up || []
    if (overrideUp) return incUp
    if (fillEmptyUp && baseUp.length === 0 && incUp.length > 0) return incUp
    return baseUp
  }
  const cloneBanner = (b) => ({
    ...b,
    up: [...(b.up || [])],
    up4: [...(b.up4 || [])],
    upIds: [...(b.upIds || [])],
    candidates: [...(b.candidates || [])],
    ...(b.upByType
      ? { upByType: { character: [...(b.upByType.character || [])], weapon: [...(b.upByType.weapon || [])] } }
      : {})
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
        const takenUp = takeUpOf(result[bi], incoming[matched])
        const upChanged = upSetKey({ up: takenUp }) !== upSetKey(result[bi])
        const eChanged = overrideTime && endChanged(result[bi].end, incoming[matched].end)
        result[bi] = {
          ...result[bi],
          end: eChanged ? incoming[matched].end : result[bi].end,
          up: [...takenUp],
          source: upChanged ? (incoming[matched].source || result[bi].source) : result[bi].source,
          confidence: upChanged ? (incoming[matched].confidence || '') : result[bi].confidence,
          ...(upChanged && incoming[matched].upByType
            ? {
                upByType: {
                  character: [...(incoming[matched].upByType.character || [])],
                  weapon: [...(incoming[matched].upByType.weapon || [])]
                }
              }
            : {})
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
    const freeI = iIdx.filter((i) => !incomingUsed[i])
    for (let k = 0; k < remainingI.length && k < freeI.length; k++) {
      const bi = remainingI[k]
      const ii = freeI[k]
      baseUsed[bi] = true
      incomingUsed[ii] = true
      const takenUp = takeUpOf(result[bi], incoming[ii])
      const upChanged = upSetKey({ up: takenUp }) !== upSetKey(result[bi])
      const eChanged = overrideTime && endChanged(result[bi].end, incoming[ii].end)
      // 保留 base 的 start；end 仅在日期变化时更新；up 依合并策略决定
      result[bi] = {
        ...result[bi],
        end: eChanged ? incoming[ii].end : result[bi].end,
        up: [...takenUp],
        source: upChanged ? (incoming[ii].source || result[bi].source) : result[bi].source,
        confidence: upChanged ? (incoming[ii].confidence || '') : result[bi].confidence,
        ...(upChanged && incoming[ii].upByType
          ? {
              upByType: {
                character: [...(incoming[ii].upByType.character || [])],
                weapon: [...(incoming[ii].upByType.weapon || [])]
              }
            }
          : {})
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
