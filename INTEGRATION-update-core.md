# 1.0.2-d 自动更新核心模块 · 集成说明

分支：`feature/1.0.2-d-update`（基于 `95fa58e`，未 push，未动 main）
负责人：update-core-2

---

## 1. 改动清单

### 已在本分支落地（`src/main/update/`）

| 文件 | 状态 | 说明 |
|---|---|---|
| `checker.js` | 前任新增，本轮校验通过 | 纯逻辑：`parseVersion` / `pickAsset` / `assetDigest` / `shouldUpdate`；更新源固定为 `https://api.github.com/repos/PastWind-Zhou/MiHoYo-Gacha-Export/releases/latest` |
| `downloader.js` | 前任新增，**本轮修复 1 处真实 bug** | `fetchLatestRelease` / `downloadFile`（流式、体积上限、停滞超时、sha256 校验）/ `validateZip` / `extractZip` |
| `dataGuard.js` | 前任新增，本轮校验通过 | `buildManifest` / `verifyManifest` / `ensureUserData` / `backupUserData` / `restoreUserData` / `pruneBackups` |
| `state.js` | 前任新增，本轮校验通过 | `readState` / `writeState`（原子写）/ `clearState` |
| `index.js` | 前任修改，本轮修复 3 处并对齐 IPC 契约 | 状态机编排、IPC 注册、`initUpdate`、升级后校验与回滚 |
| `checker.test.js` / `downloader.test.js` / `dataGuard.test.js` / `state.test.js` / `index.test.js` | 本轮新增 | 共 67 个用例 |

本轮修复的真实缺陷（均由新增测试暴露）：

1. `downloader.js`：`received` 误声明在 Promise 执行器内部，函数末尾 `return { size: received }` 抛出 `ReferenceError` —— 所有成功下载都会失败。已把变量提升到 Promise 外。
2. `index.js`：`validateAfterUpgrade` 中 `restoreUserData` 未捕获异常（备份文件缺失 / 磁盘占用时），状态会永久卡在 `restoring`，既没校验也没回滚。已加 try/catch，异常时继续走回滚分支。
3. `index.js`：`SKIP_UPDATE('')` 原实现会回退到 `updateInfo.version` 并重新写入跳过标记，与注释「空字符串清除标记」矛盾。已改为显式清空。

### 未在本分支落地（共享文件，仅提供 patch note，见 §3）

- `src/main/paths.js`
- `src/main/config.js`
- `src/main/main.js`

原因：这三个文件被其他分支并行修改（config.js 与 netsec 分支重叠）。本分支只交付补丁说明，避免合并冲突。**在这些补丁落地前，更新模块的代码存在但不会被启动流程调用（`initUpdate` 未接入），配置中的 `skipVersion` / `lastUpdateCheck` / `updateState` 也没有默认值（代码用 `|| ''` / `|| 0` 兜底，不会崩溃）。**

### 测试结果

- 基线：`jest --runInBand` → 15 suites / 230 tests 全通过
- 本轮：20 suites / 297 tests 全通过（新增 67 个）
- 所有 `require` 均为模块顶层静态引用，无函数体内动态 require
- 未引入新运行时依赖（`semver` / `fs-extra` / `adm-zip` / `electron-fetch` 均已在 devDependencies 且已安装）
- 不自动删除旧版本目录（`pruneBackups` 只清理自己的 `update-cache/backup`）

---

## 2. IPC 契约（与 update-ui 分支对齐）

所有通道用 `ipcMain.handle`，handler 首行 `await config.ready`，返回结构统一。

| 通道 | 入参 | 成功返回 | 失败返回 |
|---|---|---|---|
| `GET_UPDATE_INFO` | 无 | `{ status, available, version, notes, progress, error }` | — |
| `CHECK_UPDATE` | 无 | `{ ok: true, data: { available, version, message } }` | `{ ok: false, error }` |
| `APPLY_UPDATE` | 无 | `{ ok: true, data: { version } }` | `{ ok: false, error }` |
| `SKIP_UPDATE` | `{ version }` | `{ ok: true, skipVersion }` | `{ ok: false, error }` |

补充说明：

- `GET_UPDATE_INFO` 除契约字段外还附带 `message` / `currentVersion` / `skipVersion` / `autoUpdate` / `lastUpdateCheck`，渲染层可按需忽略；`error` 仅在 `status === 'failed'` 时非空。
- `CHECK_UPDATE` 的 `data.message` 是中文提示文案（如「已是最新版本」「已跳过该版本」「更新包缺少 sha256 校验信息，已拒绝更新」）。是否改为 i18n key 由 update-ui 决定。
- `APPLY_UPDATE` 成功路径会 `app.relaunch()` + `app.quit()`，返回值主要用于失败时展示原因。
- `SKIP_UPDATE` 传 `{ version: '' }` 表示清除跳过标记；为兼容旧渲染层，也接受位置参数字符串。
- 另有 `UPDATE_STATUS` 推送通道，载荷为 `GET_UPDATE_INFO` 的快照对象。
- 更新源可用环境变量 `GACHA_UPDATE_API` 覆盖，仅用于本地 mock 验证；生产打包不应设置该变量。

状态机（供 UI 展示文案参考）：

```
init → checking → available → downloading → verifying → backing-up
     → staging → ready →（退出并启动新版本）→ validating → done
任意阶段失败 → failed；validating 失败 → restoring → rollback（relaunch 旧版本）
```

---

## 3. 共享文件 patch note（未应用，请对应分支 owner 合入）

### 3.1 `src/main/paths.js`

**(a) `hasUserDataContent` 纳入 `gacha-list-*.json` / `ugc-list-*.json`**（审计报告低危 #4、方案 §1.2 问题 2）：

```js
const hasUserDataContent = (dir) => {
  try {
    if (!fs.existsSync(dir)) return false
    const entries = fs.readdirSync(dir)
    if (!entries.length) return false
    return entries.some((name) => {
      if (name === 'config.json' || name === 'log.txt') return true
      // 只有抽卡记录、没有 config.json 的旧目录不能被误判为空
      if (/^gacha-list-\d+\.json$/.test(name) || /^ugc-list-\d+\.json$/.test(name)) return true
      try {
        return fs.statSync(path.join(dir, name)).isDirectory()
      } catch (e) {
        return false
      }
    })
  } catch (e) {
    return false
  }
}
```

**(b) 放宽 `isProductVersionDir` 正则**（审计报告低危 #5、方案 §1.2 问题 3）：

```js
// 接受 1.0 / 1.0.1 / 1.0.1-win / 1.0.1-win-x64 / 1.0.1-source
return /^MiHoYoGachaExport-\d+(?:\.\d+){1,2}(?:-[\w-]+)?$/.test(name)
```

**(c) `migrateUserData` 改用 `ensureUserData` 实现幂等迁移**（方案 §1.2 问题 1、§4.5）：

```js
// 顶层静态 require（打包约束：禁止函数体内动态 require）
const { ensureUserData } = require('./update/dataGuard')
...
// 原 fs.copySync(best.dir, userDataPath, { overwrite: false, errorOnExist: false })
// 替换为：
const result = ensureUserData(best.dir, userDataPath)
if (result.conflicts.length) return null  // 有冲突：不覆盖，本次不迁移
return { from: best.dir, to: userDataPath }
```

依赖方向：`paths.js → update/dataGuard.js` 单向；`dataGuard.js` 只依赖 `crypto`/`fs-extra`/`path`，`update/index.js → paths.js`，无循环依赖。`dataGuard.js` 的核心函数均为同步 IO，可在模块加载期调用。

### 3.2 `src/main/config.js`

**(a) 补三个默认值**（当前 `setConfig` 能动态加键，但 `getLocalConfig` 只拷贝已存在的键，首次启动读不到磁盘上的值）：

```js
  autoUpdate: true,
  skipVersion: '',
  lastUpdateCheck: 0,
  updateState: 'init',
```

**(b) `game` 的 null/空串校验**（审计报告 §2.10）：

```js
  // 原：if (configTemp.game && !isValidGame(configTemp.game)) {
  if (!isValidGame(configTemp.game)) {
    configTemp.game = 'hkrpg'
  }
```

**(c) `saveConfig` 始终加密 urls**（审计报告 §1.5，`urlsMap` 为 null 时当前会明文落盘）：

```js
const saveConfig = async () => {
  const rawUrls = urlsMap ? [...urlsMap] : config.urls
  const urls = Array.isArray(rawUrls)
    ? rawUrls.map((item) => {
        const copy = Array.isArray(item) ? [...item] : item
        try {
          copy[1] = cipherAes(copy[1])
        } catch (e) {
          copy[1] = ''
        }
        return copy
      })
    : rawUrls
  await saveJSON('config.json', Object.assign({}, config, { urls }))
}
```

注意：`getLocalConfig` 已把 urls 解密回写内存，`urlsMap` 也是明文 Map，这里必须对每条做拷贝后再加密，否则会双重加密内存中的值。

**(d) 与 netsec 分支的协调点**：`GET_CONFIG` IPC 不应把解密后的 `urls` 整体返回渲染层（审计报告 §1.5）。如 netsec 分支已处理，本补丁只做 (a)(b)(c)，不要重复改动 `getData.js` 的 `GET_CONFIG`。

### 3.3 `src/main/main.js`

**(a) 接入 `initUpdate`**（放在 `whenReady` 内、窗口创建之后）：

```js
const { initUpdate, getUpdateInfo } = require('./update/index')
...
app.whenReady().then(() => {
  createWindow()
  initUpdate()   // 内部消化异常，不阻断启动
})
```

**(b) `will-quit` 必须 await 代理恢复，并删除 `status === 'moving'` 死分支**（审计报告 §2.2）：

```js
let quitting = false
app.on('will-quit', async (e) => {
  if (quitting) return
  if (proxyStatus.started) {
    e.preventDefault()
    quitting = true
    try {
      await disableProxy()
    } finally {
      app.quit()
    }
  }
})
```

同时删除 `app.on('quit')` 里重复的 `disableProxy()`（避免二次恢复）；`quitting` 标志也保证 `update/index.js` 的 `app.quit()` 不会与代理恢复互相递归。

---

## 4. 未决问题 / 风险

1. **共享补丁尚未合入**：`paths.js` / `config.js` / `main.js` 的补丁需对应分支 owner 应用。合入前自动更新不会被启动；验证「完整流程」需先应用 (3.1)(3.2)(3.3)。冲突风险最高的是 `config.js`（netsec 分支也在改），建议由 team-lead 统一裁定合并顺序。
2. **release 必须带 `assets[].digest`**：当前实现只用 GitHub 资产 digest 校验，**无 digest 则 fail closed**（不读 `SHA256SUMS.txt`，符合本任务要求）。GitHub 对上传资产会自动生成 `sha256:` digest，但发布流程需确认资产确实上传成功，否则用户永远收不到更新提示。
3. **`pruneBackups` 与回滚引用**：备份只保留最近 5 份。若回滚后的旧版本状态文件指向的 `backupDir` 已被清理，用户手动恢复会失去依据。是否延长保留期或保留 rollback 指向的备份，需产品决策。
4. **不自动清理旧版本目录**：按方案 §2.3 保留以便回滚，长期多版本共存会占用磁盘；后续可加「校验通过后用户确认清理」。
5. **UI 文案语言**：`CHECK_UPDATE` 的 `data.message` 目前是中文。若 update-ui 需要 i18n key，需要同步约定一份 key 映射表。
6. **`GACHA_UPDATE_API` 环境变量**：为本地 mock 保留。生产构建需确认 CI/打包环境未设置该变量，否则会指向错误更新源。
7. **`updateState` 落盘时机**：状态流转时只写内存，稳定节点（检测完成 / done）才 `config.save()`，以避免更新过程中改 `config.json` 影响备份哈希稳定性。若 UI 需要跨会话看到实时状态，应读 `update-state.json` 而非 `config.updateState`。
8. **i18n / 渲染层**：本分支未改 `App.vue` / `Setting.vue` / i18n，由 update-ui 分支负责；本分支只保证 IPC 契约与 §2 一致。
