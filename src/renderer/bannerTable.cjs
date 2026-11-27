// 卡池表格的排序与分页逻辑
// 抽成独立模块便于单元测试（组件内的 computed 无法直接测试）

// 版本号 -> 可比较的数值数组；非数字版本（如原神集录祈愿的「月之六」）返回 null
const versionValue = (version) => {
  const parts = String(version || '').split('.').map((n) => parseInt(n, 10))
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return null
  return parts
}

// 比较两个版本号：数字版本在前且按数值升序，非数字版本在后
// 仅用于比较版本号本身（非数字版本之间按名称比较）；
// 表格排序请用 sortByVersionDesc，它额外处理了开始时间
const compareVersion = (a, b) => {
  const va = versionValue(a)
  const vb = versionValue(b)
  if (va && vb) {
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const x = va[i] || 0
      const y = vb[i] || 0
      if (x !== y) return x - y
    }
    return 0
  }
  if (va) return -1
  if (vb) return 1
  return String(a || '').localeCompare(String(b || ''))
}

// 按版本倒序排列（最新版本在最前），同版本内按开始时间倒序
const sortByVersionDesc = (rows) => {
  return rows.slice().sort((a, b) => {
    const va = versionValue(a.version)
    const vb = versionValue(b.version)
    // 一方是数字版本、一方不是：数字版本在前
    if (va && !vb) return -1
    if (!va && vb) return 1
    if (va && vb) {
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const x = va[i] || 0
        const y = vb[i] || 0
        if (x !== y) return y - x
      }
      // 版本号相同，按开始时间倒序
      return String(b.start || '').localeCompare(String(a.start || ''))
    }
    // 双方都是非数字版本（如「月之六」「月之八」）：没有版本序可比，
    // 按开始时间倒序，否则会出现「月之六」排在「月之八」之前
    return String(b.start || '').localeCompare(String(a.start || ''))
  })
}

// 取分页后的数据
const paginate = (rows, page, pageSize) => {
  const safePage = Math.max(1, Number(page) || 1)
  const start = (safePage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

// 每页显示的条数
const PAGE_SIZE = 10

// 各游戏实际存在的卡池类型（与内置数据的 channel 分布一致）
const GAME_CHANNELS = {
  genshin: ['character', 'weapon', 'jilu'],
  hkrpg: ['character', 'lightcone'],
  nap: ['character', 'engine']
}

// 取某游戏可用的 channel 列表
const getGameChannels = (game) => GAME_CHANNELS[game] || GAME_CHANNELS.hkrpg

module.exports = {
  versionValue,
  compareVersion,
  sortByVersionDesc,
  paginate,
  getGameChannels,
  GAME_CHANNELS,
  PAGE_SIZE
}
