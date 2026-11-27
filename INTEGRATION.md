# 1.0.2-b-netsec 抓取 / 代理 / 网络与配置安全改动说明

> 分支：`feature/1.0.2-b-netsec`（基于 `95fa58e`）
> 工作区：`D:\软件\抽卡分析\MiHoYo\worktrees\1.0.2-b-netsec`
> 测试：worktree 根目录执行 `D:\软件\抽卡分析\MiHoYo\node_modules\.bin\jest --runInBand`
> 结果：**21 个测试文件 / 259 个用例全部通过**（原 230 个 + 新增 29 个）

本文件接续前任 agent 的半成品改动（config.js / getData.js / utils.js，约 202 行）。
前任已完成的修复不推倒重来，本文在其基础上补齐剩余项，并核对了每一处调用点。

---

## 1. 直接改动清单（已提交到本分支的文件）

### 1.1 前任已完成、本次核对确认有效的修复

| 审计项 | 文件 / 函数 | 修复内容 |
|---|---|---|
| 1.5（部分） | `utils.js` `authkeyMask` | 正则由 `/authkey=[^&]+&/g` 改为 `/authkey=[^&\s]+/g`，覆盖 authkey 作为最后一个参数的情况 |
| 1.5（部分） | `utils.js` `sendMsg` / `sanitizeLogText` | 推送渲染层前脱敏；写日志前统一脱敏 + 单条 2000 字截断；`unhandled` logger 同样走 `sanitizeLogText` |
| 1.5（部分） | `config.js` `saveConfig` | 始终从 `urlsMap` 逐对复制后加密落盘，避免 `urlsMap` 未初始化时明文写盘，也避免二次加密 |
| 2.10 | `config.js` `getLocalConfig` | `if (!isValidGame(configTemp.game))` 替代真值判断，`null` / `''` 也回退 `hkrpg` |
| 2.4 | `getData.js` `getGachaLogs` | `MAX_PAGE = 1000` 上限 + `endId` 未推进即 `break` |
| 2.5 | `getData.js` `getGachaLog` | `retcode:-101` / `authkey timeout` 标记 `authTimeout`，不重试、上层中断整体 |
| 2.6 | `getData.js` `fetchData` | `failedPools` 记录失败池，完成后明确提示「已保留本地原有数据」 |
| 2.7 | `getData.js` `readData` / `doReadData` / `readIdle` | 标志位移到读取成功后；`readInFlight` 共享并发读取；切游戏前 `await readIdle()` |
| 2.8 | `getData.js` `readLog` | `Promise.all` → `Promise.allSettled`，单个日志读取失败不再放弃其它候选 |
| 2.9 | `getData.js` `fetchData` | uid 非 `^\d+$` 时终止，不再生成 `gacha-list-undefined.json` |
| 2.11 | `getData.js` `getQuerystring` / 调用方 | 删除模块级 `apiDomain`，返回 `{ searchParams, domain }` 局部传递；非法 URL 返回 `false` |
| 2.30 | `utils.js` `saveJSON` + `getData.js` `saveData` | `saveJSON` 重试后返回布尔；`saveData` 检查返回值并抛错 |

### 1.2 本次新增/补齐的修复

| 审计项 | 文件 / 函数 | 修复内容 |
|---|---|---|
| 1.2 | `src/main/module/extract-zip.js` `assertInside` / `Extractor.extract` / `Extractor.extractEntry` | 新增 `assertInside(root, target)`（`path.relative` + `path.isAbsolute` 判定）；父目录校验改用该函数；**新增叶子节点校验**：`dest` 若为符号链接则 `realpath` 后再次确认在根目录内；symlink 条目的目标用 `path.resolve(dirname(dest), link)` 校验，越界直接抛错，不再落到磁盘 |
| 1.3 | `src/main/module/node-mitmproxy.js` `createProxy` | 删除 `process.env.NODE_TLS_REJECT_UNAUTHORIZED="0"`（全局关闭 TLS）；不再影响进程内发往米哈游接口、携带 authkey 的请求 |
| 2.1 | `src/main/module/node-mitmproxy.js` `createProxy` / `closeProxy` | server 引用存到 `wl.proxyServer`；`v.on("error")` 从 `listen` 回调里提到 `listen` **之前**注册，并转交 `wl.onError`（EADDRINUSE 不再是未捕获异常）；新增 `closeProxy()`，`getData.js` `useProxy` 的 `finally` 中调用 |
| 2.3 | `src/main/module/system-proxy.js` | 新增 `enqueue` Promise 链串行化 `enableProxy` / `disableProxy`；恢复失败时**保留 backup 与 `started=true`**，错误写入 `proxyStatus.lastError` 供重试与提示，不再被 `finally` 清空 |
| 2.3 | `src/main/getData.js` `useProxy` | 仅当 `!proxyStatus.started`（系统代理确已恢复）时才关闭 MITM server；恢复失败时保留 server，避免系统代理指向已关闭端口 |
| 1.5（补） | `src/main/getData.js` `GET_CONFIG` | 返回配置副本时 `delete plain.urls`，解密后的 authkey 不再经 IPC 下发渲染层 |
| 1.6 | `src/main/getData.js` `CONFIG_RULES` / `SAVE_CONFIG` | key 白名单 + 类型校验（`game` 必须 `isValidGame`、`proxyPort` 1–65535、`urls` 必须合法二维数组等）；用 `hasOwnProperty` 挡住 `__proto__` / `constructor` 原型键；非法值返回 `false` 且不 `config.save()` |
| 1.6（配套） | `src/main/config.js` Proxy `set` 陷阱 | `SAVE_CONFIG` 写 `urls` 时同步刷新 `urlsMap`，避免内存明文与落盘密文不一致 |
| 2.31（补） | `src/main/utils.js` `sendMsg` | 新增 `MAX_LOG_ENTRIES = 1000`，日志数组超量时裁掉最旧条目，限制总量 |
| 2.32 | `src/main/bridge.js` `DELETE_DATA` | `uid` 必须 `^\d+$`、`action` 必须布尔，否则抛错 |
| 2.32 | `src/main/bridge.js` `LOG_ERROR` | 显式类型归一化；脱敏/限长/总量限制统一由 `sendMsg` 承担 |
| 2.32 | `src/main/getData.js` `OPEN_CACHE_FOLDER` | `cacheFolder` 来自日志内容，校验必须是绝对路径、包含 `webCaches` 段且确实为存在的目录，否则不打开 |

### 1.3 新增回归测试

| 测试文件 | 覆盖 |
|---|---|
| `src/main/module/extract-zip.test.js` | `assertInside` 边界；越界 symlink 条目被拒且未调用 `fs.symlink`；`dest` 为外部符号链接时被拒；合法条目正常解压 |
| `src/main/module/node-mitmproxy.test.js` | require/createProxy 不设置全局 TLS 开关；`error` 在 `listen` 前注册并转交 `onError`；`closeProxy` 关闭并清空 server、可重复调用 |
| `src/main/module/system-proxy.test.js` | 备份恢复原代理；恢复失败保留备份 + `lastError` 且可重试；并发启停串行化、重复关闭不二次恢复 |
| `src/main/ipc-security.test.js` | `GET_CONFIG` 不含 urls；`SAVE_CONFIG` 拒绝非法 game / 非数组 urls / 越界端口 / 原型键；`DELETE_DATA` 拒绝非法 uid/action |
| `src/main/utils-security.test.js` | authkey 在末尾时也脱敏；`sanitizeLogText` 截断与 Error 脱敏；`saveJSON` 失败返回 false |
| `src/main/config.test.js` | `game` 为 null / 空串回退；`saveConfig` 不写明文 authkey；写 urls 后 `urlsMap` 同步 |
| `src/main/fetch-security.test.js` | 游标停滞两页即停；翻页中 authkey 过期发 `AUTHKEY_TIMEOUT` 且不落盘；uid 缺失不写盘 |

---

## 2. 共享文件最小改动 patch note（**未直接修改**，需对应分支落地）

以下文件按分工不在本分支直接编辑。给出精确到函数与代码片段的最小改动。

### 2.1 `src/main/main.js` — 退出时系统代理恢复（审计 2.2，**优先**）

现状 `will-quit`（54–70 行）中 `disableProxy()` 是异步但未 `await`、未 `preventDefault()`；
进程可能先退出，系统代理永久指向已关闭的 `127.0.0.1:8325`，导致全局断网。

```js
app.on('will-quit', (e) => {
  if (proxyStatus.started) {
    // disableProxy 是异步的，必须阻塞退出并等待恢复结果：
    // 否则进程先退出，系统代理永久指向已关闭的本地端口
    e.preventDefault()
    disableProxy().finally(() => {
      // 恢复失败时 started 仍为 true（system-proxy 已保留 backup）
      // 这里只记录，不再重复 disable，交由下次启动/用户重试
      if (proxyStatus.lastError) {
        console.error('退出时系统代理恢复失败:', proxyStatus.lastError)
      }
      app.quit()
    })
    return
  }
  if (getUpdateInfo().status === 'moving') {
    e.preventDefault()
    setTimeout(() => { app.quit() }, 3000)
  }
})

app.on('quit', () => {
  // will-quit 已 await 恢复；此处仅覆盖强制退出等旁路，不 preventDefault
  if (proxyStatus.started) disableProxy()
})
```

要点：`e.preventDefault()` + `disableProxy().finally(() => app.quit())`；`will-quit` 中 `return`
避免同时落入 `moving` 分支；二次 `app.quit()` 时 `started` 已为 `false`，不会递归。

### 2.2 `tools/package.js` — 备份失败不得继续清理（审计 1.7）

现状 `userData` 备份（164–168 行）只 `warn` 不中止，随后 172–190 行 `fs.rmSync` 删除 release
目录；`copyDir` 返回的 `skipped.length > 0` 意味着有抽卡记录/config 没复制成功却被删除。

```js
if (userDataDirs.length) {
  const skipped = copyDir(userDataDirs[0], userDataBackup)
  if (skipped.length) {
    warn('备份 userData 时有 ' + skipped.length + ' 项未复制：')
    skipped.slice(0, 5).forEach((s) => warn('  ' + s))
    // 备份不完整就绝不能往下走：后面的 fs.rmSync 会永久删除未备份的用户数据
    process.exit(1)
  }
  log(`已备份 userData（来自 ${path.basename(path.dirname(userDataDirs[0]))}）`)
}
```

### 2.3 远程卡池源 SSRF（审计 2.14）

涉及 `src/main/gachaBanner.js` 的 `fetchRemoteJSON`（250 行）与 `fetchFromCustom` /
`src/main/bannerManager.js` 的 `syncNow`（106–112 行，`customUrl` 透传）。
现状只校验首跳 `http/https`，electron-fetch 默认跟随 302，可跳到 `127.0.0.1` / `169.254.169.254`。

在 `gachaBanner.js` 顶部引入 `dns.promises`，在 `fetchRemoteJSON` 中：

```js
const dns = require('dns').promises
const isBlockedHost = (host) => {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (/^\d+$/.test(h) && Number(h) >= 2130706432 && Number(h) <= 2147483647) return true // 2130706433=127.0.0.1
  if (/^0x[0-9a-f]+$/i.test(h)) return true
  return false
}
```

`fetchRemoteJSON` 内在 `fetch` 前：

```js
const parsed = new URL(url)
if (isBlockedHost(parsed.hostname)) throw new Error('blocked host')
// DNS 结果也校验，防域名解析到内网 / 回环（DNS rebinding 的最小防护）
const addresses = await dns.lookup(parsed.hostname, { all: true }).catch(() => [])
if (addresses.some(a => isBlockedHost(a.address))) throw new Error('blocked host')
```

并把请求改为不自动跟随跳转、逐跳校验：

```js
const res = await fetch(url, {
  method: 'GET',
  redirect: 'manual',
  headers: { 'User-Agent': 'MiHoYoGachaExport/1.0.1' },
  timeout
})
if (res.status >= 300 && res.status < 400) {
  const location = res.headers && res.headers.get && res.headers.get('location')
  if (!location) throw new Error('redirect without location')
  // 递归前会再次走上面的协议/host/DNS 校验
  return fetchRemoteJSON(new URL(location, url).toString(), { timeout: options.timeout, retry: 0 })
}
if (!res.ok) throw new Error('HTTP ' + res.status)
```

`bannerManager.js` 的 `syncNow` 无需改动：它只把 `customUrl` 传给 `syncBanners`，
校验集中在 `fetchRemoteJSON` 即可覆盖所有入口。

### 2.4 远程响应体积按字节计（审计 2.15）

现状三处都用 `text.length > MAX_REMOTE_BYTES`：中文/emoji 一个字符多字节，8MB 字符上限
实际网络字节可达约 24MB；且 wiki / 米游社路径没有同等上限。

- `src/main/gachaBanner.js` `fetchRemoteJSON` 第 276、283–284 行：
  `if (text.length > MAX_REMOTE_BYTES)` → `if (Buffer.byteLength(text) > MAX_REMOTE_BYTES)`；
  `res.text()` 兜底分支同样改为 `Buffer.byteLength(text)`。
- `src/main/module/bannerSource.js` `fetchText` 第 44、54 行：同样把 `text.length` 改为
  `Buffer.byteLength(text)`（流式分支可累计 `value.length` 字节，因为 `reader.read()` 给的是 `Uint8Array`）。
- `src/main/module/wikiBanner.js` 第 289 行 `const html = await res.text()`：改为复用
  `bannerSource.fetchText(url, headers)`（该函数已有字节上限与超时），再 `parsePage(html)`。
- `src/main/module/mihoyoBanner.js` `fetchJSON` 第 40–44 行：不要直接 `res.json()`，改为
  `JSON.parse(await fetchText(url, { ...HEADERS, ...headers }))`，套用同一字节上限。

### 2.5 `sameBannerSet` 纳入 `upByType`（审计 2.16）

`src/main/gachaBanner.js` `sameBannerSet`（319–328 行）的 `norm` 只指纹 `channel/start/end/up`，
远程源仅修正集录池 `upByType.character/weapon` 时会被判「与上游一致」，覆盖层不写、修正永不生效。

```js
const norm = (list) => list.map((x) => [
  x.channel,
  String(x.start || '').slice(0, 16),
  String(x.end || '').slice(0, 16),
  (x.up || []).slice().sort().join('|'),
  // 远程源常只修正 UP 分类而 up 名单不变，必须把 upByType 纳入指纹
  x.upByType ? [
    (x.upByType.character || []).slice().sort().join('|'),
    (x.upByType.weapon || []).slice().sort().join('|')
  ].join('/') : ''
].join('@')).sort().join('\n')
```

### 2.6 米游社源删除错误兜底（审计 2.17）

`src/main/module/mihoyoBanner.js` 约 228–236 行「3. 兜底」：段落与 `gacha_pool` 代号都匹配失败时，
`anyInPost` 仍把同 post 的无关代号时间写入排期，与该段注释「宁可跳过」自相矛盾。

```js
-    // 3. 兜底
-    if (!period) {
-      const anyInPost = periods.find((p) => p.postId === items[0].postId)
-      if (anyInPost) {
-        period = anyInPost
-      } else {
-        unresolvedSections.push({
-          title: items[0] && items[0].title,
-          postId: items[0] && items[0].postId
-        })
-        continue
-      }
-    }
+    // 3. 匹配不到就记 unresolved 并跳过，绝不把无关代号的时间写进排期
+    if (!period) {
+      unresolvedSections.push({
+        title: items[0] && items[0].title,
+        postId: items[0] && items[0].postId
+      })
+      continue
+    }
```

---

## 3. 未决问题 / 需要 team-lead 确认

1. **2.14–2.17 的落地归属**：这些项对应的 `gachaBanner.js` / `bannerManager.js` /
   `wikiBanner.js` / `mihoyoBanner.js` / `bannerSource.js` **不在本分支允许直接编辑清单**，
   因此只写了第 2.3–2.6 节的 patch note，**未改代码**。已发消息询问 team-lead：
   是改由本分支直接落地，还是交给其它分支（如 ugc-data-2 负责的卡池分支）。
   在收到明确答复前未擅自扩大改动范围。
2. **1.7 `tools/package.js`**：共享文件，tools 分支已有改动，只写 patch note（2.2 节），未直接改。
3. **2.2 `main.js`**：共享文件，只写 patch note（2.1 节），未直接改；其正确性依赖本分支
   `system-proxy.js` 的 `proxyStatus.lastError` 与「恢复失败保留 `started=true`」语义。
4. **审计 1.4（渲染层 nodeIntegration）**：属于共享文件 `utils.js` 的窗口配置 + 渲染层改造，
   不在本任务「抓取/代理/网络与配置安全」范围内，未处理（需单独分支做 preload/contextBridge）。
5. **本任务号**：`TaskGet(53)` 返回 not found、`TaskList` 初始为空；已建本地任务跟踪全部工作，
   收尾时会按要求尝试把 #53 标记 completed（若该任务在共享列表中存在）。
6. **`node-mitmproxy.js` 的 bundle 行为**：删除全局 `NODE_TLS_REJECT_UNAUTHORIZED` 后，
   bundle 内部 upstream agent 仍有 `rejectUnauthorized:false`（MITM 抓包所需，属按请求配置，
   不影响进程内其它 HTTPS 请求）。未改动该内部 agent，以免破坏代理抓取功能。
