# 1.0.2-b-netsec 抓取 / 代理 / 网络与配置安全改动说明

> 分支：`feature/1.0.2-b-netsec`（基于 `95fa58e`）
> 工作区：`D:\软件\抽卡分析\MiHoYo\worktrees\1.0.2-b-netsec`
> 测试：worktree 根目录执行 `D:\软件\抽卡分析\MiHoYo\node_modules\.bin\jest --runInBand`
> 结果：**25 个测试文件 / 273 个用例全部通过**（原 230 个 + 新增 43 个）

本文件接续前任 agent 的半成品改动（config.js / getData.js / utils.js，约 202 行），
不推倒重来；team-lead 后续授权直接修改卡池相关文件，因此 2.14–2.17 已从 patch note
改为直接落地并配回归测试。

---

## 1. 直接改动清单

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

### 1.2 本轮新增安全修复

| 审计项 | 文件 / 函数 | 修复内容 |
|---|---|---|
| 1.2 | `module/extract-zip.js` `assertInside` / `Extractor.extract` / `Extractor.extractEntry` | 新增 `assertInside(root, target)`；父目录与叶子节点双重 realpath 校验；symlink 条目目标越界直接拒绝，修复 Zip Slip 叶子变体 |
| 1.3 | `module/node-mitmproxy.js` `createProxy` | 删除 `process.env.NODE_TLS_REJECT_UNAUTHORIZED="0"`，不再全局关闭 TLS |
| 2.1 | `module/node-mitmproxy.js` `createProxy` / `closeProxy` | server 引用存入 `wl.proxyServer`；`v.on("error")` 提到 `listen` 之前并转交 `wl.onError`；新增 `closeProxy()` |
| 2.3 | `module/system-proxy.js` | `enqueue` Promise 链串行化启停；恢复失败保留 backup + `started=true`，错误写入 `proxyStatus.lastError` |
| 2.3 | `getData.js` `useProxy` | 仅在系统代理恢复成功（`!proxyStatus.started`）时才关闭 MITM server |
| 1.5（补） | `getData.js` `GET_CONFIG` | 返回配置副本时 `delete plain.urls`，解密后的 authkey 不再下发渲染层 |
| 1.6 | `getData.js` `CONFIG_RULES` / `SAVE_CONFIG` | key 白名单 + 类型校验；`hasOwnProperty` 挡住 `__proto__` / `constructor`；非法值返回 `false` 且不落盘 |
| 1.6（配套） | `config.js` Proxy `set` 陷阱 | 写 `urls` 时同步刷新 `urlsMap` |
| 2.14 | `gachaBanner.js` `isBlockedHost` / `fetchRemoteJSON` | 拒绝回环/内网/链路本地/十进制/十六进制地址；DNS 解析结果逐条校验；`redirect:'manual'` + 逐跳递归校验，阻断 302 到内网 |
| 2.15 | `gachaBanner.js` `fetchRemoteJSON`、`module/bannerSource.js` `fetchText`、`module/wikiBanner.js` `fetchBanners`、`module/mihoyoBanner.js` `fetchJSON` | 统一按字节计上限：`Buffer.byteLength` / `Uint8Array.length`，替换 `text.length`；wiki/mihoyo 复用 `fetchText` |
| 2.16 | `gachaBanner.js` `sameBannerSet` | 指纹纳入 `upByType.character` / `upByType.weapon` |
| 2.17 | `module/mihoyoBanner.js` 时间分配步骤 3 | 删除「同公告任意代号」兜底，匹配不到即记 unresolved 并跳过 |
| 2.31（补） | `utils.js` `sendMsg` | `MAX_LOG_ENTRIES = 1000`，日志数组超量裁掉最旧条目 |
| 2.32 | `bridge.js` `DELETE_DATA` | `uid` 必须 `^\d+$`、`action` 必须布尔 |
| 2.32 | `bridge.js` `LOG_ERROR` | 显式类型归一化；脱敏/限长/总量由 `sendMsg` 统一处理 |
| 2.32 | `getData.js` `OPEN_CACHE_FOLDER` | 校验绝对路径 + 含 `webCaches` 段 + 目录真实存在，否则不打开 |

### 1.3 team-lead 协调项：config.js 自动更新默认键（已包含）

| 项 | 状态 | 位置 |
|---|---|---|
| `autoUpdate: true` | 原文件已存在，保留 | `config.js` 默认值对象 |
| `skipVersion: ''` | **本次新增** | `config.js` 默认值对象（紧随 autoUpdate） |
| `lastUpdateCheck: 0` | **本次新增** | 同上 |
| `updateState: 'init'` | **本次新增** | 同上 |
| game 校验改 `if (!isValidGame(...))` | 前任已完成，核对有效 | `config.js` `getLocalConfig` |
| saveConfig 始终加密 urls | 前任已完成，核对有效 | `config.js` `saveConfig` |

首次启动时 `getLocalConfig` 从磁盘读不到这些键也能拿到默认值，update 模块不会读到 undefined。

### 1.4 新增回归测试（43 个用例）

| 测试文件 | 覆盖 |
|---|---|
| `module/extract-zip.test.js` | `assertInside` 边界；越界 symlink 被拒且未调用 `fs.symlink`；`dest` 为外部符号链接被拒；合法条目正常解压 |
| `module/node-mitmproxy.test.js` | 不设置全局 TLS 开关；`error` 在 `listen` 前注册并转交 `onError`；`closeProxy` 可重复调用 |
| `module/system-proxy.test.js` | 备份恢复原代理；恢复失败保留备份 + `lastError` 且可重试；并发启停串行化 |
| `ipc-security.test.js` | `GET_CONFIG` 不含 urls；`SAVE_CONFIG` 拒绝非法 game / urls / 端口 / 原型键；`DELETE_DATA` 拒绝非法 uid/action |
| `utils-security.test.js` | authkey 末尾脱敏；`sanitizeLogText` 截断与 Error 脱敏；`saveJSON` 失败返回 false |
| `config.test.js` | 自动更新默认键；game null/空串回退；saveConfig 不写明文 authkey；urlsMap 同步 |
| `fetch-security.test.js` | 游标停滞两页即停；authkey 过期发 `AUTHKEY_TIMEOUT` 且不落盘；uid 缺失不写盘 |
| `gachaBanner.security.test.js` | SSRF 黑名单（含十进制/十六进制）；DNS 解析到内网被拒；302 不跟随；中文字节超限；`upByType` 指纹 |
| `module/bannerSource.bytes.test.js` | 无 reader / 流式两分支的字节上限与取消 |
| `module/mihoyoBanner.security.test.js` | 匹配不到时间区间的段落被跳过，不写入无关代号时间 |

---

## 2. 仍需集成时应用的共享文件 patch note（**未直接修改**）

### 2.1 `src/main/main.js` — 退出时系统代理恢复（审计 2.2，**优先**）

现状 `will-quit`（54–70 行）中 `disableProxy()` 异步但未 `await`、未 `preventDefault()`，
进程可能先退出，系统代理永久指向已关闭的 `127.0.0.1:8325`，导致全局断网。

```js
app.on('will-quit', (e) => {
  if (proxyStatus.started) {
    // disableProxy 是异步的，必须阻塞退出并等待恢复结果
    e.preventDefault()
    disableProxy().finally(() => {
      // 恢复失败时 started 仍为 true（system-proxy 已保留 backup）
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
  // will-quit 已 await 恢复；这里只覆盖强制退出等旁路，不 preventDefault
  if (proxyStatus.started) disableProxy()
})
```

要点：`e.preventDefault()` + `disableProxy().finally(() => app.quit())`；`return` 避免同时落入
`moving` 分支；二次 `app.quit()` 时 `started` 已为 `false`，不会递归。
依赖本分支 `system-proxy.js` 的 `proxyStatus.lastError` 与「恢复失败保留 `started=true`」语义。

### 2.2 `tools/package.js` — 备份失败不得继续清理（审计 1.7）

现状备份（164–168 行）只 `warn` 不中止，随后 172–190 行 `fs.rmSync` 删除 release 目录；
`skipped.length > 0` 意味着有抽卡记录/config 没复制成功却被删除。

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

team-lead 已确认 tools 分支有改动，由 team-lead 在集成时合并。

### 2.3 其它共享文件

`src/renderer/**`、`src/i18n/**`、`package.json` 本分支未改。
审计 1.4（渲染层 `nodeIntegration` / `contextIsolation`）属渲染层与 preload 改造，
不在本任务范围，未处理。

---

## 3. 未决问题

1. **任务号**：team-lead 已确认全局任务列表重置，`#53` 查不到；本分支用本地任务
   #8–#15、#21–#22 跟踪，全部完成，不再卡任务号。
2. **`node-mitmproxy.js` bundle 内部 upstream agent**：删除全局
   `NODE_TLS_REJECT_UNAUTHORIZED` 后，bundle 内部 upstream agent 仍带
   `rejectUnauthorized:false`（MITM 抓包所需，属按请求配置，不影响进程内其它 HTTPS 请求）。
   未改动该内部 agent，以免破坏代理抓取功能。
3. **审计 2.12 / 2.13 / 2.18 / 2.19**（UIGF timezone、wiki 首期时间、schema timezone、
   `tools/package.js` 宽松目录匹配）：分别由 ugc-data-2 / tools 分支负责，本分支未触碰。
4. **`main.js` 2.2 patch note 依赖**：本分支已提供 `proxyStatus.lastError` 与失败保留
   `started=true` 语义，集成时直接套用第 2.1 节片段即可。
