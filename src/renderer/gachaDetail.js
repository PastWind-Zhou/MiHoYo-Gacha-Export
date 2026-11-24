import { isWeapon, isCharacter, isBangboo } from './utils'

const itemCount = (map, name) => {
  if (!map.has(name)) {
    map.set(name, 1)
  } else {
    map.set(name, map.get(name) + 1)
  }
}

// gameInfo: { types:[{key,name}], rankLevels:{five,four,three}, bangboo }
// rankLevels 把各游戏的真实 rank 值映射到 5/4/3 三档，输出结构与原版完全一致
const gachaDetail = (data, gameInfo) => {
  if (!data) return
  const levels = gameInfo ? gameInfo.rankLevels : { five: '5', four: '4', three: '3' }
  const order = gameInfo && gameInfo.types ? gameInfo.types.map(t => t.key) : ['11', '12', '21', '22', '1', '2']
  const hasBangboo = gameInfo ? gameInfo.bangboo : false
  const detailMap = new Map()
  for (let key of order) {
    if (!data.has(key)) continue
    let value = data.get(key)
    let detail = {
      count3: 0, count4: 0, count5: 0,
      count3w: 0, count4w: 0, count5w: 0, count4c: 0, count5c: 0,
      count3b: 0, count4b: 0, count5b: 0,
      weapon3: new Map(), weapon4: new Map(), weapon5: new Map(),
      char4: new Map(), char5: new Map(),
      bang3: new Map(), bang4: new Map(), bang5: new Map(),
      date: [],
      ssrPos: [], countMio: 0, total: value.length,
    }
    let lastSSR = 0
    let dateMin = 0
    let dateMax = 0
    value.forEach((item, index) => {
      const { time, name, item_type: type, rank_type: rank } = item
      const timestamp = new Date(time).getTime()
      if (!dateMin) dateMin = timestamp
      if (!dateMax) dateMax = timestamp
      if (dateMin > timestamp) dateMin = timestamp
      if (dateMax < timestamp) dateMax = timestamp
      if (rank === levels.three) {
        detail.count3++
        detail.countMio++
        if (isWeapon(type)) {
          detail.count3w++
          itemCount(detail.weapon3, name)
        } else if (hasBangboo && isBangboo(type)) {
          detail.count3b++
          itemCount(detail.bang3, name)
        }
      } else if (rank === levels.four) {
        detail.count4++
        detail.countMio++
        if (isWeapon(type)) {
          detail.count4w++
          itemCount(detail.weapon4, name)
        } else if (hasBangboo && isBangboo(type)) {
          detail.count4b++
          itemCount(detail.bang4, name)
        } else if (isCharacter(type)) {
          detail.count4c++
          itemCount(detail.char4, name)
        }
      } else if (rank === levels.five) {
        detail.ssrPos.push([name, index + 1 - lastSSR, time, key])
        lastSSR = index + 1
        detail.count5++
        detail.countMio = 0
        if (isWeapon(type)) {
          detail.count5w++
          itemCount(detail.weapon5, name)
        } else if (hasBangboo && isBangboo(type)) {
          detail.count5b++
          itemCount(detail.bang5, name)
        } else if (isCharacter(type)) {
          detail.count5c++
          itemCount(detail.char5, name)
        }
      }
    })
    detail.date = [dateMin, dateMax]
    if (detail.total) {
      detailMap.set(key, detail)
    }
  }
  return detailMap
}

export default gachaDetail
