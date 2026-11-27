# 1.0.2-e-update-ui 集成说明（自动更新 UI 与设置页）

- 分支：`feature/1.0.2-e-update-ui`（基于 `main` @ `95fa58e`）
- 负责人：update-ui-2
- 状态：**改动已提交，未 push，未动 main**

---

## 1. 改动清单

### 1.1 `src/renderer/App.vue`（前任改动 + 本次收尾）

前任已完成的部分（本次核实保留）：

- `state` 新增 `updateInfo` / `updateAction`，模板向 `Setting` 透传 `:update-info` / `:update-action` / `:update-busy` 与 `@checkUpdate` / `@applyUpdate` / `@skipUpdate`。
- `normalizeUpdateInfo()` 统一归一化主进程推送（防 `undefined` / 非数字 `progress`）；`updateBusy` 计算属性在 checking/downloading/verifying/backing-up/staging/moving/validating/ready 期间禁用按钮。
- `checkUpdate()` / `applyUpdate()` / `skipUpdate()` 三个触发函数，全部带 `try/catch/finally`，`finally` 复位 `state.updateAction`。
- `initUpdateInfo()` 启动时同步一次 `GET_UPDATE_INFO`；`UPDATE_STATUS` 监听更新状态并复位按钮 loading；`UPDATE_HINT` 记录消息并进入 `updated` 状态。
- 审计问题 **2.25**：`onMounted` 同步开头注册全部 IPC 监听器（在所有 `await` 之前），末尾补偿启动期 `UPDATE_HINT`；`onUnmounted` 移除监听器。
- 审计问题 **2.26**：`FETCH_DATA` / `READ_DATA` / `SWITCH_GAME` / `I18N_DATA` / `SAVE_EXCEL` / `IMPORT_UIGF_JSON` / `OPEN_CACHE_FOLDER` / `CHANGE_UID` / `RELAUNCH` / `GET_CONFIG` / `COPY_URL` / `COPY_API_URL` 及三个更新 IPC 全部加 `try/catch`（失败复位状态而非永久转圈）。
- 审计问题 **2.27**：`getI18nData()` 同步调用 `updateConfig()`，切语言后 `gameInfo` 立即刷新。
- 审计问题 **2.28**：`changeGame()` 与 `importData()` 复用 `loadSeq` 丢弃过期响应。
- 低危项：`uidSelectText` 改用 `:model-value`，消除只读 computed 被 `v-model` 写入的 Vue 警告。

本次修复/补充：

- **修复编译错误**：前任把 `let updateHintMessage = null` 声明了两次（原第 645、677 行），`build-renderer-only.js` 会直接 SyntaxError；已删除重复声明，保留唯一一处。
- `normalizeUpdateInfo()`：当主进程只推 `{status:'available'}` 而未带 `available` 字段时，按状态推断 `available = true`，避免「立即更新」按钮永远不可用。
- `EXPORT_UIGF_JSON` 的 IPC 调用补 `.catch()`（原为唯一未做异常处理的调用）。

### 1.2 `src/renderer/components/Setting.vue`

- 自动更新开关（`ui.setting.autoUpdate`）下方新增三个按钮与状态区：
  - `检查更新` / `立即更新` / `跳过此版本`
  - loading 由 `updateAction === 'check' | 'apply' | 'skip'` 驱动；忙碌态由 `updateBusy` 与 `settingSaving` 共同禁用。
  - 「立即更新」「跳过此版本」仅在 `updateInfo.available` 时可用。
  - 状态文案：`ui.update.status.<status>`，`${version}` / `${progress}` 占位符在渲染层替换（主进程 `I18N_DATA` 返回原始字典，不经过 `parseText`）；`backing-up` / `moving` 等连字符状态做别名映射；失败时拼接 `error`。
  - 更新说明 `notes` 以 `whitespace-pre-wrap` 展示。
- `defineEmits` 增加 `checkUpdate` / `applyUpdate` / `skipUpdate`；`defineProps` 增加 `updateInfo` / `updateAction` / `updateBusy`（均带默认值，父组件未传时不报错）。
- **版本与 Build 展示已存在于已提交基线**（`95fa58e`）：`Version: v{{version}} · Build: {{buildId}}`，`buildId` 来自 `GET_CONFIG` 的 `buildInfo.buildId`（主进程 `paths.js:getBuildInfo()` 读取 `resources/app/build-info.json`，由 `tools/package.js` 写入）。本次核实链路完整，未重复实现。
- 所有 IPC 调用补异常处理：`SAVE_CONFIG` / `DISABLE_PROXY` / `LANG_MAP` / `GET_CONFIG` 均 `try/catch/finally`；新增 `settingSaving`、`proxyLoading` 并在 `finally` 复位；`shell.openExternal` 补 `.catch()`；`deleteData()` 原有 `try/catch/finally` 保持不变。

### 1.3 `src/i18n/genshin/简体中文.json` / `English.json`

仅**追加** 16 个键（8 个 `ui.setting.update*`，8+ 个 `ui.update.status.*`），未删除/修改任何已有键。其余 11 种语言未改动，按 `i18n.js` 的 `zh-cn → en-us → 目标语言` 回退链生效（缺失键回退到英文文案）。

### 1.4 未改动（按范围约束）

`src/main/**`、`package.json`、`tools/**`、`.electron-vite/**` 均未改动，由 update-core-2 负责主进程实现与打包配置。

---

## 2. IPC 契约（渲染层实际调用，需与 update-core 对齐）

| 通道 | 方向 | 参数 | 渲染层期望返回 |
|---|---|---|---|
| `GET_UPDATE_INFO` | renderer → main（invoke） | 无 | `{ status, available, version, notes, progress, error }`（直接对象，非 `{ok,data}` 包裹） |
| `CHECK_UPDATE` | renderer → main（invoke） | 无 | `{ ok: true, data }` 或 `{ ok: false, error }` |
| `APPLY_UPDATE` | renderer → main（invoke） | 无 | `{ ok: true, data }` 或 `{ ok: false, error }`；后续进度靠 `UPDATE_STATUS` 推送 |
| `SKIP_UPDATE` | renderer → main（invoke） | `{ version }` | `{ ok: true }` 或 `{ ok: false, error }` |
| `UPDATE_STATUS` | main → renderer（send） | 更新状态对象，形状同 `GET_UPDATE_INFO` | 渲染层归一化后写入 `state.updateInfo`，并复位按钮 loading |
| `UPDATE_HINT` | main → renderer（send） | 字符串消息 | 渲染层写入 `state.log` 并置 `state.status = 'updated'`，顶部出现「直接更新」（RELAUNCH）按钮 |
| `RELAUNCH` | renderer → main（invoke） | 无 | 现有通道，复用 |
| `GET_CONFIG` | renderer → main（invoke） | 无 | 现有通道；渲染层读取 `config.buildInfo.buildId` 展示 Build |

主进程 handler 首行应 `await config.ready`，异常统一返回 `{ ok: false, error }`。**主进程 handler 当前不在本分支**（`grep` 确认 `src/main/` 下无 `GET_UPDATE_INFO` 等注册）；渲染层全部包了 `try/catch`，未注册时会降级为「更新失败」提示，不会白屏或卡 loading。

---

## 3. 需要 team-lead 合并的冲突提示

### 3.1 `src/renderer/App.vue`（高危冲突区）

本分支基于 `main`，不含千星奇域 UI 分支的改动。合并时请按「双方都保留」原则处理以下热点（行号为本分支最终状态，仅定位用）：

| 位置 | 本分支改动 | 与 UGC 分支可能冲突点 |
|---|---|---|
| 模板 `:32` | `uidSelectText` 改 `:model-value` | 一般不冲突；如对方也改了顶部操作区，保留双方改动 |
| 模板 `:55-70` `el-tabs` | 本分支未新增 tab | 对方新增「千星奇域」`el-tab-pane` 与 `UgcPanel` 导入 → **保留对方的 tab**，其余不动 |
| 模板 `:71` `<Setting>` | 新增 `:update-info` / `:update-action` / `:update-busy` 和 3 个 update 事件 | 对方若也给 `Setting` 加了 UGC props/事件 → **合并到同一标签，保留两边属性与事件** |
| `<script setup>` imports `:99-108` | 未新增组件 import | 对方新增 `UgcPanel` import → 保留 |
| `state` `:110-131` | 新增 `updateInfo` / `updateAction` | 对方可能新增 UGC 状态字段 → 两边字段都保留 |
| `changeGame` `:306` / `getI18nData` `:331` / `importData` `:406` | 加 `loadSeq`、`updateConfig()`、`try/catch` | 对方可能也改了 `changeGame`（切游戏时清 UGC 数据）→ **保留对方的 UGC 清理 + 本分支的序号保护/异常处理** |
| `normalizeUpdateInfo` 至 `skipUpdate` `:525-620` | 整段更新逻辑（本分支独有） | 一般无冲突，整段保留 |
| `ipcHandlers` `:655-680` | 新增 `UPDATE_STATUS`、改造 `UPDATE_HINT`、`LOG_ERROR` 加 `.catch()` | 对方若新增 UGC 相关监听 → 合并进同一对象 |
| `onMounted` `:683-706` | 监听器提前注册 + `initUpdateInfo()` + `UPDATE_HINT` 补偿 | 对方若也在 `onMounted` 读取 UGC 数据 → **监听器注册必须仍位于所有 `await` 之前**（审计 2.25），对方的新 `await` 放在其后 |

### 3.2 `src/i18n/genshin/{简体中文,English}.json`

两个文件的新键都**追加在文件末尾**（最后一条原有键 `ui.banner.configFailed` 之后）。千星奇域分支也大概率在末尾追加 `ui.ugc.*` 键，因此**文件尾部几乎必然冲突**。

合并规则：**两边新增的键全部保留**，不要删除任何已有键，也不要因为对方加了 `ui.ugc.*` 就丢掉 `ui.setting.update*` / `ui.update.status.*`。JSON 逗号按标准补全即可。

本分支新增键（16 个，两个文件各一份）：

```
ui.setting.updateHint / updateCheck / updateApply / updateSkip
ui.update.status.init / checking / available / downloading / verifying
                    / backingUp / staging / ready / validating / idle / failed / skipped
```

### 3.3 其他语言文件

本分支未改 `src/i18n/genshin/` 其余 11 个文件，也未改 `hkrpg/` / `nap/`。如对方改了这些文件，直接采用对方版本。

---

## 4. 未决问题与发现的不合理之处

1. **主进程实现缺失（阻塞项）**：本分支只有渲染层。`GET_UPDATE_INFO` / `CHECK_UPDATE` / `APPLY_UPDATE` / `SKIP_UPDATE` 四个 handler 和 `UPDATE_STATUS` / `UPDATE_HINT` 推送需由 update-core-2 提供，否则按钮点击只会显示「更新失败」。
2. **`UPDATE_HINT` 语义 overloading（需对齐）**：当前渲染层把**任意** `UPDATE_HINT` 消息都解释成「更新已完成、可重启」——写 `state.log`、置 `status='updated'`、显示顶部「直接更新」按钮。若主进程也用它提示「检查更新失败」「发现新版本」等非重启场景，会出现误导性的重启按钮。建议与主进程约定：要么仅重启场景发 `UPDATE_HINT`，要么把 payload 改成结构化对象并加 `kind` 字段；本分支按现状字符串实现，未扩大范围。
3. **SKIP_UPDATE 后状态可能被回推覆盖**：渲染层在 `SKIP_UPDATE` 成功后本地置 `status='skipped'`、`available=false`。若主进程随后仍推送 `status:'available'` 的 `UPDATE_STATUS`，界面会重新出现「立即更新」。需 update-core-2 保证跳过之后不再回推 available（或渲染层后续增加 skipVersion 记忆）。
4. **状态键别名**：渲染层把 `backing-up` / `backing_up` 映射为 i18n 键 `backingUp`，把 `moving` 映射为 `staging`。主进程若使用其他阶段名（如 `backup`、`extracting`），界面会回退显示 `init` 文案而非报错。需要主进程最终状态名确认后补齐别名（只需改 `Setting.vue` 的 `alias` 对象）。
5. **i18n 回退语种**：其他语言缺失 `ui.update.status.*` 时按 `zh-cn → en-us → 目标` 回退，实际显示**英文**状态文案（因为 `en-us` 在目标语言之前合并）。这符合既有回退链，但非中文/英文用户会看到英文状态。未给 11 种语言逐一补键（避免范围蔓延）。
6. **任务编号不一致**：team-lead 指派的是「任务 #56」，但本会话 `TaskList` 中可见的是 #1–#7（其中 #1「跑基线测试并读懂前任改动」、#7「写 INTEGRATION.md 并提交」与本任务内容重合，#2–#6 属于其他 agent）。未在共享 TaskList 中创建/修改 #56，请 team-lead 确认最终以哪套编号为准。
7. **前任遗留编译错误已修复**：重复声明 `let updateHintMessage` 会让渲染层构建直接失败；jest 不编译 `.vue`，所以 230/230 通过并不能发现它。已在本次修复，并已用 `build-renderer-only.js` 验证。

---

## 5. 验证结果

| 检查 | 结果 |
|---|---|
| `"D:\软件\抽卡分析\MiHoYo\node_modules\.bin\jest" --runInBand` | 15 suites / **230 tests 全通过**（与基线一致） |
| `node .electron-vite/build-renderer-only.js` | **构建成功**（`renderer built + i18n copied`）；仅有既存的 CSS `@charset` 顺序警告与 chunk 体积警告 |
| 两个 i18n JSON `JSON.parse` | 合法，各含 16 个新增键 |
| 审计 2.25 / 2.26 / 2.27 / 2.28 | 已在前任改动中实现，本次逐条核实并补齐遗漏的 `EXPORT_UIGF_JSON` 异常处理 |
