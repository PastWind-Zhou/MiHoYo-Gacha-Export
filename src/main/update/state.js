// 更新状态持久化：update-state.json 的读写
//
// 状态文件写在「版本根目录」（exe 同级），记录跨进程的更新进度：
//   - 旧版本在 relaunch 新版本前写入 phase=staged，新版本启动时读取并校验
//   - 任意一方都可以把它更新为 done / failed / rollback
//
// 该模块保持纯逻辑（不依赖 electron、不依赖 paths），
// 目录由调用方传入，方便单元测试。
const fs = require('fs-extra')
const path = require('path')

const STATE_FILE = 'update-state.json'

// 读取状态文件；不存在或损坏时返回 null（损坏不抛错：
// 状态文件只是提示信息，不能因为它阻断正常启动）
const readState = (dir) => {
  try {
    const data = fs.readJSONSync(path.join(dir, STATE_FILE))
    if (!data || typeof data.phase !== 'string') return null
    return data
  } catch (e) {
    return null
  }
}

// 原子写入：先写 .tmp 再改名。
// 更新过程中可能断电 / 被强杀，半个 JSON 落盘会让下次启动读到坏状态
const writeState = (dir, state) => {
  const file = path.join(dir, STATE_FILE)
  const tmp = `${file}.tmp`
  const payload = Object.assign({ updatedAt: Date.now() }, state)
  fs.ensureDirSync(dir)
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return payload
}

// 删除状态文件（更新完成后清理，避免长期残留影响下次判断）
const clearState = (dir) => {
  try {
    fs.rmSync(path.join(dir, STATE_FILE), { force: true })
    return true
  } catch (e) {
    return false
  }
}

module.exports = { STATE_FILE, readState, writeState, clearState }
