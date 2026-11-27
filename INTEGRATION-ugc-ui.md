# INTEGRATION.md — 千星奇域 UI 面板与 i18n（1.0.2-c-ugc-ui）

> 分支：`feature/1.0.2-c-ugc-ui`（基于 `95fa58e`）
> 负责：渲染层「千星奇域」界面 + 审计报告渲染层问题修复 + i18n 基线键补齐
> 测试：`"D:\软件\抽卡分析\MiHoYo\node_modules\.bin\jest"` 全量 230/230 通过；
> `node .electron-vite/build-renderer-only.js` 渲染层编译通过（@charset 警告为既有噪音）。

---

## 1. 新增 / 修改的文件

| 文件 | 变更 |
|---|---|
| `src/renderer/components/UgcPanel.vue` | **新增**。千星奇域记录表格 + 基础统计（总抽数、5/4/3 星分布与占比、按池归一的抽数） |
| `src/renderer/App.vue` | 新增「千星奇域」el-tabs 标签页（仅 `state.game === 'genshin'` 时渲染）；UGC 数据懒加载与请求序号保护；修复审计 2.25 / 2.26 / 2.27 / 2.28 / 低危 1 |
| `src/renderer/components/WaiwaiPanel.vue` | 修复低危 2：全部池被排除时说明文字不渲染 |
| `src/renderer/components/PieChart.vue` | 修复低危 3：内容渲染与 resize 节流分离，切换账号/语言即时更新 |
| `src/i18n/genshin/简体中文.json` | 新增 `ui.ugc.*` / `ui.tab.ugc` / `ui.button.ugcRefresh` / `ui.button.ugcUpdate`；补审计 1.8 的 4 个缺键（`ui.button.files` / `ui.button.uigf` / `ui.button.import` / `ui.uigf.title`） |
| `src/i18n/genshin/English.json` | 同上（英文） |

其他 11 个语言文件未动，按现有回退链（目标语言 → en-us → zh-cn）兜底。

## 2. 假设的 IPC 契约与数据结构

### 2.1 通道

```
READ_UGC_DATA   参数 { game: string, uid?: string|number }
                返回 { ok: true, data: Account | null } | { ok: false, error: string }

FETCH_UGC_DATA  参数 { game: string, uid?: string|number }
                返回 { ok: true, data: Account } | { ok: false, error: string }
```

- `game` 为当前游戏 id（`'genshin'`）；`uid` 为当前账号（新账号时为 `undefined`，由主进程自定）。
- 渲染层在 `state.game !== 'genshin'` 时不会调用这两个通道。

### 2.2 Account 结构（与 `normalizeUGCAccount` 落盘格式一致）

```js
{
  uid: '100000001',          // string
  timezone: 8,               // number，缺失回退 8
  lang: 'zh-cn',
  list: [                    // 按 id 升序
    {
      id: '3344...',         // string，纯数字
      schedule_id: '5001',
      item_type: '角色',
      item_id: '10000002',
      item_name: '神里绫华',
      rank_type: '5',        // '5' | '4' | '3'
      time: '2026-01-01 12:00:00',
      op_gacha_type: '1000'  // '1000' | '2000' | '20011' | '20012' | '20021' | '20022'
    }
  ]
}
```

- 渲染层做了双形态兼容：`data` 为账号对象（取 `.list`）或裸记录数组均可。
- 20011/20012/20021/20022 在统计与展示中归一到 2000（`poolKeyOf`，见 UgcPanel.vue），原始值保留在导出链路（主进程侧）。
- 无法识别的 `op_gacha_type` 显示「未知卡池(<原始值>)」。

### 2.3 渲染层容错（合并顺序无关）

主进程 handler 尚未合并时，`ipcRenderer.invoke` 会抛 `No handler registered`。
`App.vue:invokeUgc` 捕获后保持 `ugcStatus: 'init'`（显示引导提示），**不**显示为失败。
因此本分支可以先于主进程 UGC 分支合并，界面不会报错。

## 3. 需要合并到共享文件的最小改动（主进程侧，请转交 ugc-data / team-lead）

以下为建议实现，`src/main/**` 我未改动：

1. 新增 `src/main/ugcData.js`（或并入 `getData.js`），注册两个 handler：

```js
const { ipcMain } = require('electron')
const config = require('./config')
const { normalizeUGCAccount } = require('./utils/uigf42')
// 复用 UIGFJson.js 的 loadUGCAccounts / saveUGCAccount（建议提为可导出函数）

ipcMain.handle('READ_UGC_DATA', async (event, { game, uid } = {}) => {
  try {
    await config.ready
    if (game && game !== 'genshin') return { ok: false, error: 'ugc only supports genshin' }
    const accounts = await loadUGCAccounts()          // 现有函数，读 ugc-list-<uid>.json
    const target = String(uid || config.current || '')
    const account = accounts.find(a => a.uid === target) || null
    return { ok: true, data: account }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('FETCH_UGC_DATA', async (event, { game, uid } = {}) => {
  try {
    await config.ready
    // 复用 getUrl() / getQuerystring()，走 getBeyondGachaLog 分页（size=5, end_id 游标），
    // merge 后 saveUGCAccount(normalized)，最后返回与 READ_UGC_DATA 相同结构
    return { ok: true, data: normalizedAccount }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
```

2. 若新增独立文件，需在 `src/main/main.js`（或 `getData.js` 末尾）加一行 `require('./ugcData')`。

3. `UIGFJson.js` 的 `loadUGCAccounts` / `saveUGCAccount` 目前是模块私有，如被 `ugcData.js` 复用需加 `module.exports`（两行改动）。

4. `READ_UGC_DATA` 返回的账号须经过 `normalizeUGCAccount`（字段名 `item_name` 而非 `name`；渲染层对 `name` 也有兜底，但统一更稳）。

## 4. 审计问题修复说明

| 项 | 修复方式 |
|---|---|
| 2.25 监听器注册晚 | `onMounted` 内把 `ipcRenderer.on` 移到任何 `await` 之前同步注册 |
| 2.26 IPC 无异常处理 | `fetchData / readData / changeGame / getI18nData / saveExcel / importData / openCacheFolder / changeCurrent / relaunch / updateConfig / copyUrl / copyApiUrl` 全部加 try/catch；失败设 `state.status='failed'` 或 `ElMessage.error`，loading 状态可复位 |
| 2.27 切语言 gameInfo 不刷新 | `getI18nData()` 内追加 `await updateConfig()`（Setting 的 `changeLang` → App 的 `getI18nData`） |
| 2.28 快速切游戏 | `changeGame` 复用 `loadSeq`：`SWITCH_GAME` 响应过期即丢弃；后续 i18n/config 刷新由新请求自己的调用链完成 |
| 低危 1 | `uidSelectText` 只读 computed：`v-model` → `:model-value` + 既有 `@change` |
| 低危 2 | WaiwaiPanel：`hiddenPools` 说明移出 `v-else`；全部池被排除时不再误显示「暂无数据」 |
| 低危 3 | PieChart：内容渲染拆为同步 `renderChart()`（onMounted/onUpdated 直调）；throttle(200) 仅用于 window resize 高频事件 |
| 1.8（顺带） | `ui.button.files/uigf/import`、`ui.uigf.title` 四键补入 zh-cn 与 en-us 基线，导出对话框不再抛 TypeError |

## 5. UI 行为说明

- 标签页「千星奇域」仅在当前游戏为原神时出现；切走时自动回到「抽卡统计」并重置 UGC 状态。
- 懒加载：首次切入该标签页才触发 `READ_UGC_DATA`；UIGF 导入成功后（原神）自动重读（导入可含 `hk4e_ugc` 段）。
- 面板右上两个按钮：`刷新`（READ）、`获取奇域数据`（FETCH，触发主进程网络抓取）。
- 切换账号（`CHANGE_UID`）后若停留在该标签页会按新 uid 重读。
- 统计行复用既有 `ui.data.*` 键（总抽数/星级），池名用 `ui.ugc.type1000/type2000`。

## 6. 未决问题

1. **池名占位**：`ui.ugc.type1000 = 奇域祈愿·一`、`type2000 = 奇域祈愿·二`（EN: UGC Wish I/II）为占位文案，官方名称确定后请替换（只改两个 JSON 的两个键）。
2. **英文标签名**：`ui.tab.ugc` 英文暂用 `UGC Gacha`，待官方英文名（hk4e_ugc 模式）确认。
3. `FETCH_UGC_DATA` 的语义按「用现有 authkey 主动抓取千星奇域」实现；若主进程需要用户先在游戏内打开奇域抽卡页，authkey 失效提示复用现有 `AUTHKEY_TIMEOUT` 流程即可（渲染层无需新键）。
4. 计划文档阶段 5 的「歪率不可判定」未在 UGC 面板实现 UP/歪统计（本面板只做抽数与星级分布），与范围一致。
5. `PieChart` 的 window-resize 节流从 1000ms 调到 200ms（低危 3 修复的一部分），若认为拖拽窗口时重绘过频可回调。
