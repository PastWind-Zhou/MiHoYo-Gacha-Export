// 统一的远程取文本实现。
//
// 从 bannerSource.js 拆出，专门打断这里的循环依赖：
//   bannerSource -> wikiBanner / mihoyoBanner -> bannerSource.fetchText
// rollup 合并模块后，顶层 require 的求值顺序会让使用点早于 bannerSource 初始化，
// 启动时直接抛 "Cannot read properties of undefined (reading 'fetchText')"。
// 三个模块都改为依赖这个无业务依赖的叶子模块，打包顺序就不再影响结果。

const fetch = require('electron-fetch').default

const MAX_REMOTE_BYTES = 8 * 1024 * 1024

const fetchText = async (url, headers = {}) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'MiHoYoGachaExport/1.0.1 (+https://github.com/)',
      Accept: 'application/json, text/plain, */*',
      ...headers
    },
    timeout: 30000
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  // 流式读取并在超限时中断：先读完再判断长度的话，
  // 超大响应已经占满内存，8MB 上限形同虚设
  const reader = res.body && res.body.getReader ? res.body.getReader() : null
  if (!reader) {
    const text = await res.text()
    // 按字节计：中文/emoji 的 text.length 远小于实际网络字节数，
    // 用字符数判断会让 8MB 上限失效（实际可达约 24MB）
    if (Buffer.byteLength(text) > MAX_REMOTE_BYTES) throw new Error('response too large')
    return text
  }
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // Uint8Array.length 就是本次读取的字节数，无需对整段字符串反复 byteLength
      bytes += value.length
      if (bytes > MAX_REMOTE_BYTES) {
        try { await reader.cancel() } catch (e) {}
        throw new Error('response too large')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    try { reader.releaseLock && reader.releaseLock() } catch (e) {}
  }
  return text
}

module.exports = { fetchText, MAX_REMOTE_BYTES }
