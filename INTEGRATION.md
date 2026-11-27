# 1.0.2-a-ugc 集成说明（UIGF / UIGF 安全 + 千星奇域数据链路）

> 分支：`feature/1.0.2-a-ugc`
> 状态：前任 agent 的半成品已接手并完成；`jest --runInBand` **16 suites / 249 tests 全绿**（基线为 237/238，唯一失败已修复）。
> 本分支只改了「允许直接编辑」的文件；`getData.js` / `main.js` / `config.js` / `renderer/**` / `i18n/**` / `package.json` / `tools/**` **均未直接改动**，需要合并的最小改动列在第 2 节。

---

## 1. 改动清单

### 1.1 前任已完成、本分支验证保留的改动

| 文件 | 内容 |
|---|---|
| `src/gachaType/genshin.json` | 新增 `"ugc"` 段：1000/2000 的中/英/繁文案，与常规祈愿池文案分离 |
| `src/main/games.js` | `games.genshin` 新增 `ugcEndpoint: 'getBeyondGachaLog'`、`ugcTypeParam: 'gacha_type'`、`ugcTypeOrder: ['1000','2000']`、`ugcPageSize: 5`；新增并导出 `getUGCTypes()`；`getGameInfo()` 增加 `ugcTypes`（非原神为 `[]`，渲染层据此隐藏面板） |
| `src/main/uigf-schema.json` | 修复 1.9：`hk4e_ugc` 从 `"type":"array" + 直接挂 properties/required` 改为 `items: { type:'object', properties, required }` |
| `src/main/utils/uigf42.js` | 新增 `isValidUid` / `isInsideDir` / `isValidTimezone` / `normalizeTimezone` / `uidTimeZone`；`groupUIGFRecords` 改 `Object.create(null)`；`normalizeUGCAccount` 校验 uid、归一 timezone；`validateUIGF42` 严格校验 timezone；`ugcListSchema` 路径改走 `items` |
| `src/main/UIGFJson.js` | 修复 1.1（uid 正则 + `isInsideDir` 落盘防线）、2.12（nap timezone null 回退 8）、低危 14/15（hasOwnProperty 守卫、uid 字符串归一）；`hk4e_ugc` 导入改为逐账号 try/catch；`loadUGCAccounts`/`saveUGCAccount` 提取到 `ugcData.js` |

### 1.2 本分支新增/完成的改动

| 文件 | 内容 |
|---|---|
| `src/main/ugcData.js` | 完成 `fetchUGCData` / `readUGCData` / `getUGCAccount` / `saveUGCAccount` / `loadUGCAccounts`；复用 `request`/`sleep`/`getApiUrl`/`mergeList`；`-110` 退避重试、`authkey timeout` 直接中断；`end_id` 分页、`size=5`；独立 `ugc-list-<uid>.json`，不进 `dataMap`；注册 `FETCH_UGC_DATA` / `READ_UGC_DATA` 两个 IPC，契约与 ugc-ui 分支一致 |
| `src/main/utils/uigf42.js` | `normalizeUGCAccount` 增加 `op_gacha_type ?? gacha_type` 回退——接口 `getBeyondGachaLog` 用 `gacha_type` 传参，返回记录可能不带 `op_gacha_type`，不回退会导致抓取记录被全量过滤 |
| `src/main/UIGFJson.js` | `parseAccount` 的物品字典回填增加 `hasOwnProperty` 守卫（低危 14 的残留点：`item_id='constructor'` 会把角色名改写成 `Object`） |
| `src/main/UIGFJson.test.js` | 修复失败用例：`uid '123'` → `'123456789'`（新 `isValidUid` 要求 6–12 位；3 位测试数据本身不真实）；新增 3 个用例：nap `timezone:null` 断言 `convertTimeZone` 收到 `(time,8,8)`、`item_id='constructor'` 不污染名称、`hk4e_ugc` 导出→导入→再导出字段一致 |
| `src/main/utils/uigf42.test.js` | 新增 `gacha_type → op_gacha_type` 回退用例（前任已新增 uid/路径/timezone/原型键用例，本分支保留） |
| `src/main/ugcData.test.js`（新增） | 7 个用例：IPC 注册、非原神结构化错误、无数据 `data:null`、读取归一化账号、`saveUGCAccount` 拒绝路径穿越、分页抓取与独立落盘、抓取失败返回 `{ok:false,error}` |
| `INTEGRATION.md`（本文件） | 集成说明 |

### 1.3 审计项处理对照

| 审计项 | 状态 |
|---|---|
| 1.1 uid 路径穿越 | 已修：`UIGFJson.js` 普通账号（正则 + `isInsideDir` 双防线）、`ugcData.saveUGCAccount`、`uigf42.normalizeUGCAccount`；`getData.js` 侧普通抓取的 uid 落盘由 netsec 分支处理（共享文件，见第 2 节） |
| 1.8 i18n 缺 4 键 | **不在本分支改**：ugc-ui 分支（commit `7c3ba71`）已在 `genshin/简体中文.json` 与 `English.json` 补齐；其余 11 种语言靠 `i18n.js` 的 `zh-cn → en-us → 目标语言` 回退链，不会崩溃。可选本地化清单见 2.2 |
| 1.9 schema `hk4e_ugc` 非法 | 已修，且 `uigf42.js` 取值路径 + 测试同步改为 `items` |
| 2.12 / 2.18 timezone null | 已修：`normalizeTimezone` 统一回退 8 并校验 `[-12,14]`；导入侧与校验侧同时生效；新增断言用例 |
| 低危 14 原型键污染 | 已修：`groupUIGFRecords` 用 `Object.create(null)`、`genshinItemId` 和 `parseAccount` 物品回填均加 `hasOwnProperty` |
| 低危 15 uid 类型不一致 | 已修：导入侧 `String(uid).trim()`、`loadGameData` 归一旧数字 uid、内存 `dataMap.delete(Number(uid))` 去重 |

---

## 2. 需要合并到共享文件的最小改动（本分支不直接改）

### 2.1 `src/main/main.js` —— 通常**无需改动**

`main.js:7` 已有 `require('./UIGFJson')`，而 `UIGFJson.js:11` 已 `require('./ugcData')`，因此两个 IPC handler 在应用启动时会自动注册。无循环依赖（`getData.js` 不依赖 `UIGFJson.js`）。

**仅当**集成时只取 `ugcData.js` 而不取 `UIGFJson.js` 的改动，才需要在 `main.js` 补一行（位置在 `require('./getData')` 之后）：

```js
require('./ugcData')
```

### 2.2 `src/i18n/genshin/{简体中文,English}.json` —— **已由 ugc-ui 分支补齐，不要重复**

ugc-ui 分支 commit `7c3ba71` 已加入以下 4 键：

```json
"ui.button.files": "文件",
"ui.button.uigf": "导出UIGF",
"ui.button.import": "导入数据",
"ui.uigf.title": "选择要导出的账号"
```
```json
"ui.button.files": "Files",
"ui.button.uigf": "Export UIGF",
"ui.button.import": "Import Data",
"ui.uigf.title": "Select accounts to export"
```

其余 11 种语言（`Deutsch / Español / Français / Indonesia / Português / Pусский / Tiếng Việt / ภาษาไทย / 日本語 / 繁體中文 / 한국어`）**无需补键也能正常工作**：`src/main/i18n.js` 的 `getI18nMap()` 用 `assignData(zh-cn, assignData(en-us, raw[lang]))` 回退。若要做本地化，按上面 4 个键名补对应译文即可（属于独立翻译工作，不在本分支范围）。

### 2.3 `src/main/getData.js` / `config.js` / `renderer/**` / `package.json` / `tools/**`

本分支**没有**需要合并的改动。审计报告里属于这些文件的条目由其他分支负责：

- `getData.js` 的 1.5/1.6（authkey 脱敏 / SAVE_CONFIG 校验）、2.4–2.11（分页/代理/uid 落盘/时区等）→ `feature/1.0.2-b-netsec` 分支；本分支的 `ugcData.js` 已按「不修改 getData.js」前提，只通过 `getApiUrl()` / `request()` 复用其链路。
- `renderer/**` 与 `i18n/**` 的 1.8、2.25–2.28、UGC 面板 → `feature/1.0.2-c-ugc-ui` 分支。
- `main.js` 的退出代理恢复（2.2）→ netsec 分支；`config.js` 的 game null 校验（2.10）→ netsec 分支。
- 版本号、`tools/**` → `feature/1.0.2-f-tools` 分支。

**冲突提示**：netsec 分支若也修改 `UIGFJson.js`/`uigf42.js` 的 timezone 或 uid 逻辑，合并时以本分支的 `normalizeTimezone` / `isValidUid` 单一实现为准，避免两套回退规则并存。

---

## 3. IPC 契约（已与 `feature/1.0.2-c-ugc-ui` 对齐）

### 3.1 通道与参数

```
READ_UGC_DATA   参数 { game: 'genshin', uid?: string|number }
                返回 { ok: true, data: Account | null } | { ok: false, error: string }

FETCH_UGC_DATA  参数 { game: 'genshin', uid?: string|number, url?: string }
                返回 { ok: true, data: Account } | { ok: false, error: string }
```

- `game` 非 `'genshin'`（或当前 `config.game` 非原神）时返回 `{ ok: false, error: '千星奇域数据仅支持原神' }` ugc-ui 的 `App.vue` 本身也不会在非原神时调用。
- `url` 是可选的 authkey URL 覆盖（本分支附加能力，ugc-ui 契约未要求）；不传时走 `getApiUrl()`，复用日志/缓存/MITM 代理链路。
- 所有异常统一包成 `{ ok: false, error }`，不再返回 `false`（前任半成品的返回值与 ugc-ui 的 `applyUgcResult` 不兼容）。

### 3.2 `Account` 结构（与 `normalizeUGCAccount` 落盘格式一致）

```js
{
  uid: '123456789',        // string，6–12 位纯数字
  timezone: 8,             // number，缺失/null/空串/超范围回退 8
  lang: 'zh-cn',
  list: [                  // 按 id 数值升序
    {
      id: '3344...',       // string
      schedule_id: '5001',
      item_type: '角色',
      item_id: '10000002',
      item_name: '神里绫华',
      rank_type: '5',
      time: '2026-01-01 00:00:00',
      op_gacha_type: '20011'
    }
  ]
}
```

`READ_UGC_DATA` 无对应账号时 `data` 为 `null`（ugc-ui 面板显示「暂无数据」引导）。记录字段统一为 `item_name`，与 UIGF v4.2 落盘结构一致。

### 3.3 数据链路

- 抓取：`getConfigList` 探测 authkey → 对 `1000`/`2000` 两类分别调 `getBeyondGachaLog`（`size=5`、`end_id` 游标、`list` 空结束、`-110` 退避 5s/10s、`authkey timeout` 不重试）。
- uid 优先级：**接口记录 uid > 渲染层传入 `uid` > `config.current`**（与 `getData.tryGetUid` 一致）；无合法 uid 时不落盘。
- 落盘：`userData/genshin/ugc-list-<uid>.json`，独立内存 `ugcMap`，不进 `getData().dataMap`、不参与常规统计/Excel。
- 合并：已有账号保留本地 `timezone`/`lang`，仅 `list` 走 `mergeList` 去重（保证 UIGF roundtrip 字段稳定）。
- UIGF：导出 `hk4e_ugc` 读 `loadUGCAccounts()`；导入经 `normalizeUGCAccount` 后写同一文件，字段 roundtrip 一致（已由 `UIGFJson.test.js` 断言）。

---

## 4. 未决问题 / 需要 team-lead 确认

1. **与 ugc-ui 契约的一致性**：已按 `feature/1.0.2-c-ugc-ui:INTEGRATION.md` §2 实现，`{ok,data|error}` 与 `Account` 结构完全一致。唯一差异：本实现的 `READ_UGC_DATA` 额外校验当前 `config.game === 'genshin'`（ugc-ui 建议稿只校验入参 `game`）。渲染层只在原神调用，实际行为无差别；若希望纯读取不受当前游戏影响，可去掉该校验。
2. **uid 正则严格度**：`isValidUid = /^\d{6,12}$/`（审计 1.1 建议值）。真实原神 uid 为 9–10 位；本分支因此把失败测试中不真实的 3 位 uid 改成 9 位。极老的、uid 位数不合规的 `ugc-list-*.json` 会在读取时被跳过（不删除文件）。若能确认老数据存在短 uid，可放宽为 `^\d{1,12}$` 但仍保留 `isInsideDir` 防线。
3. **`getBeyondGachaLog` 返回字段假设**：请求用 `gacha_type=1000|2000`，已为返回记录加 `op_gacha_type ?? gacha_type` 回退；`item_name ?? name` 回退已在 `normalizeUGCAccount` 中。**尚未对真实接口实测**，需按冒烟清单在游戏内验证。
4. **分页假设**：`total` 恒为 0，只用 `list` 空结束、`end_id` 取末条 `id`；`size=5` 为官方上限。同样需真实接口确认。
5. **ugc-ui 占位文案**：`ui.ugc.type1000/type2000`（`奇域祈愿·一/二` / `UGC Wish I/II`）、`ui.tab.ugc` 英文名 `UGC Gacha` 均为占位，待官方名称确定后只改两个 i18n 文件。
6. **任务编号**：交接要求「把任务 #52 标记为 completed」，但共享任务列表中不存在 #52（当前只有 #1–#19），本分支无法标记；`feature/1.0.2-a-ugc` 自己的任务 #7（写 INTEGRATION.md 并提交）已按流程标记。请 team-lead 在自己的任务视图中处理 #52。
7. **范围**：未做阶段 5 的 `ugcStats.js` / Excel UGC sheet（ugc-ui 面板只做抽数与星级分布），与方案 §7.3/§9 的范围一致。

---

## 5. 验证记录

```
$ "D:\软件\抽卡分析\MiHoYo\node_modules\.bin\jest" --runInBand
Test Suites: 16 passed, 16 total
Tests:       249 passed, 249 total
```
