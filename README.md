# 米哈游抽卡记录导出工具（三合一）

一个工具导出三款游戏的抽卡/跃迁/调频记录。

界面、布局与交互保持与原工具一致（同一套 Electron + Vue 3 + Element Plus UI），左上角新增**游戏切换**下拉，三款游戏的数据、设置与统计完全独立。

## 致谢

本工具由以下三个开源项目合并而来（均 MIT 协议），在此致谢：

- [biuuu/genshin-wish-export](https://github.com/biuuu/genshin-wish-export)（原神 祈愿记录导出）
- [biuuu/star-rail-warp-export](https://github.com/biuuu/star-rail-warp-export)（崩坏：星穹铁道 跃迁记录导出）
- [earthjasonlin/zzz-signal-search-export](https://github.com/earthjasonlin/zzz-signal-search-export)（绝区零 调频记录导出）

## 支持的功能

| 功能 | 原神 | 星穹铁道 | 绝区零 |
|---|---|---|---|
| 日志+网页缓存获取 authKey | ✓（output_log.txt / 云游戏日志） | ✓（Player.log） | ✓（Player.log，含直读 URL 快捷路径） |
| 代理模式（MITM 兜底） | ✓ | ✓ | ✓ |
| 手动输入 URL / 复制 URL / 复制 API 链接 | ✓ | ✓ | ✓ |
| 多账号管理与数据软删除 | ✓ | ✓ | ✓ |
| 增量更新（只拉新记录） | ✓ | ✓ | ✓ |
| 「获取完整数据」修复模式 | ✓ | ✓ | ✓ |
| Excel 导出（含 rawData 页、歪率分析页） | ✓ | ✓ | ✓（S/A/B 级配色） |
| UIGF v4.2 导出 / v4.0+v4.1+v4.2+v3.0+SRGF 导入 | ✓（hk4e，含千星奇域 `hk4e_ugc`，内置 item_id 字典） | ✓（hkrpg，兼容联动池） | ✓（nap，含时区转换） |
| 千星奇域（`hk4e_ugc`）主动抓取与本地展示 | ✓ | — | — |
| 自动更新（GitHub Releases 检测 / 下载校验 / 升级前备份 / 失败回滚） | ✓ | ✓ | ✓ |
| 歪率分析（不歪率、平均 UP 抽数、最欧/最非、大保底等） | ✓ | ✓ | ✓ |
| 卡池排期管理（查看/手动修正/外部导入/远程数据源） | ✓ | ✓ | ✓ |
| 联动卡池（getLdGachaLog） | — | ✓（21/22） | — |
| 重映池（独家重映/音擎回响） | — | — | ✓（102/103） |
| 物品 ID 数据库自动回填 | — | ✓（v4.7） | ✓（v3.3） |
| 隐藏新手祈愿 / 隐藏常驻频段 | ✓ | ✓ | ✓ |

## 使用方法

1. 解压后运行 `MiHoYoGachaExport.exe`（Windows 64 位）
2. 在左上角切换到目标游戏
3. 在**游戏内打开对应的抽卡/跃迁/调频详情页**
4. 点击「加载数据」

数据保存在程序目录的 `userData/<游戏>/gacha-list-<UID>.json`（原神为 `genshin`，星铁为 `hkrpg`，绝区零为 `nap`）；原神千星奇域记录单独保存在 `userData/genshin/ugc-list-<UID>.json`，与常规祈愿记录互不干扰。

> 旧版单游戏工具的数据：可在旧工具中导出 UIGF 文件，再用本工具「导入 UIGF」迁移；或直接把旧的 `gacha-list-*.json` 复制进对应游戏目录（原神旧数组格式会自动转换）。
>
> 升级新版：把新压缩包解压到旧版本目录旁边（或直接用应用内「自动更新」），启动时会把旧目录中最新的一份 `userData` 迁移过来（只补缺失文件，绝不覆盖已有数据）。

## 开发与构建

```
yarn install

# 编译（主进程 + 渲染层 + i18n 资源）
node .electron-vite/build-main-only.js
node .electron-vite/build-renderer-only.js

# 打包（目录名与包名自动跟随 package.json 的版本号）
node tools/package.js
```

打包产物：

```
release/MiHoYoGachaExport-<版本号>-win/     免安装目录，直接运行 MiHoYoGachaExport.exe
release/MiHoYoGachaExport-<版本号>-win.zip  压缩包（不含 userData，Windows 原生 zip 格式）
```

> 源码包不单独产出：GitHub 会随 Release 自动提供 Source code（zip/tar.gz），无需重复上传。
>
> 版本号变更：修改 `package.json` 的 `version` 后重新执行 `node tools/package.js`，目录名与包名会自动带上新版本号。
>
> **Release 构建号**：版本号不变时（如同一版本修复后覆盖重发），仅看版本号无法分辨新旧包。
> 每次打包会在 `resources/app/build-info.json` 写入 `version` / `builtAt` / `buildId`
>（形如 `1.0.2-20261127220000`），设置页会显示「Version · Build」，据此可确认手上的包是哪次构建。
>
> `userData`（抽卡记录、设置）保存在**免安装目录内**，不随压缩包分发；重新打包时会自动保留，
> 且打包前会先备份校验，备份不完整则中止打包，不会清理原有数据。

## 架构说明（相对原项目的改动）

- 新增 `src/main/games.js`：三款游戏的全部差异集中于此（日志路径与文件名、缓存目录正则、URL 提取正则、API 域名与路径、卡池类型参数与顺序、时区规则、UIGF 键名、星级层级、隐藏池配置、物品库模式）。
- 数据模型统一为对象格式 `{id, item_id, item_type, name, rank_type, time, gacha_id, gacha_type, count}`；原神旧数组格式读取时自动转换。
- `config.js` 增加 `game` 与 `currents`（每款游戏记住各自的当前 UID）。
- 数据按游戏分子目录存储；UIGF 导入按文件内 `hk4e / hkrpg / nap` 键自动归类到对应游戏。
- 统计组件（饼图/明细）按游戏星级层级（原神/星铁 3-4-5 星，绝区零 B-A-S 级）参数化，支持邦布分类。
- `userData/config.json` 兼容旧配置。
- 自动更新由自研模块（`src/main/update/`）负责：从 GitHub Releases 检测并下载 win.zip、
  校验压缩包结构（拒绝携带 `userData` 的更新包）、升级前备份并逐文件核对、只补缺失不覆盖的幂等迁移、
  升级后校验失败自动从备份恢复或回滚旧版本；不走 electron-builder 的发布通道
  （`package.json` 中 `build.publish` 为 `never`）。

## 卡池排期数据来源

本工具的「歪不歪」判定依赖卡池排期数据（每期卡池的时间区间与 UP 物品名单），
这些数据**内嵌在源码中**，来源如下：

| 数据 | 期数 | 来源 | 许可 |
|---|---|---|---|
| `src/gachaBanner/{genshin,hkrpg,nap}.json` | 原神 300 / 星铁 236 / 绝区零 146 | [quantulr/hoyo-gacha](https://github.com/quantulr/hoyo-gacha)（其数据整理自 Biligame wiki） | MIT |
| `src/gachaBanner/genshin-jilu.json` | 原神「集录祈愿」8 期 | [Biligame wiki 集录祈愿页](https://wiki.biligame.com/ys/集录祈愿) | CC BY-NC-SA 4.0 |

Biligame wiki 数据采用 **CC BY-NC-SA 4.0**（署名-非商业性使用-相同方式共享），
因此本项目整体在**非商业用途**下分发；若需商用请自行替换或移除相关数据。

应用运行时的卡池数据同步为**三级降级链**（均为公开可访问的接口/页面）：

1. **主源**：[quantulr/hoyo-gacha](https://github.com/quantulr/hoyo-gacha) 的 GitHub Raw JSON（全量历史）
2. **备用源**：[Biligame wiki](https://wiki.biligame.com)（全量历史，HTML 解析）
3. **应急源**：[米游社官方 wiki](https://baike.mihoyo.com)（仅当期卡池，通过官方 `gacha_pool` 与公告接口）

同步策略：本地排期已覆盖当前时间则不同步；超出则联网拉取；本地无数据则全量拉取。
与上游完全一致时不写入覆盖层，合并时始终以本地为基底，不丢失历史。

本地反推与自定义远程源：某期卡池缺少 UP 名单时，工具会用本地记录中的最高级物品反推该期 UP
（结果写入用户数据目录，不修改内置基线）；设置页还可配置任意 http 远程地址作为数据源，
该地址仅以 GET 请求访问、不携带任何凭据，响应超过 8MB 或结构不符时一律忽略并保留现有数据。

## v1.0.2 更新内容

### 千星奇域（原神）

从「导入导出透传」升级为完整支持：

- 复用常规祈愿的 authkey 主动拉取 `getBeyondGachaLog` 记录
- 独立落盘到 `userData/genshin/ugc-list-<UID>.json`，不污染常规祈愿记录
- 新增「千星奇域」标签页（仅原神可见）：查看记录、抽数与星级分布等基础统计；
  因缺少卡池排期数据，歪率判定标注为「不可判定」
- 导出 `hk4e_ugc` 段的数据来自本地最新记录；旧版透传格式的文件可直接被新面板读取

### 自动更新

- 启动后（延迟）与手动触发时从 GitHub Releases 检测新版本
- 升级条件：非开发态、开关开启、版本更高、存在 Windows 资产（`*-win.zip`）、未被跳过
- 下载后校验哈希与压缩包结构（含 `userData` 的更新包直接拒绝）
- 升级前备份 `userData` 并逐文件核对；迁移只补缺失文件、绝不覆盖
- 任何阶段失败都保留旧版本；升级后校验失败自动从备份恢复，仍失败则回滚启动旧版本
- 旧版本目录保留不删，便于手动回退

### 工具链与发布

- 打包脚本只产出 `release/MiHoYoGachaExport-<版本>-win.zip`，源码包由 GitHub Release 自动生成
- 打包产物写入构建号（`resources/app/build-info.json`），设置页显示 `Version · Build`
- 修复：打包备份失败仍继续清理、打包吸收无关目录数据、`publish` 残留指向本机回环地址等问题

## v1.0.1 更新内容

### 歪率分析

新增独立的「歪率分析」标签页，逐个卡池统计：

- **不歪率**：本次 UP 且上一次也是 UP；整段记录里出现的第一个 UP 记一次不歪
- **平均 UP 抽数 / 平均最高级抽数 / 最欧 / 最非**
- **UP 命中率**、**歪值分布**（连续歪 1/2/3 次）、**大保底次数**
- 缺少卡池数据的记录单独标注，不计入分子分母

Excel 导出同步新增「歪率分析」工作表，原有工作表保持不变。

### 卡池排期数据增强

- 卡池排期数据内置于源码（682 期），支持三级降级同步源
- **本地反推**：某期卡池缺 UP 名单时，用本地记录中的最高级物品反推（唯一物品才写入，多种物品列为「待人工确认」），结果保存在本地，不修改内置数据
- 设置页新增「卡池数据管理」：查看卡池表、手动修正 UP 名单、导入外部 JSON、配置自定义远程数据源（仅 GET、不携带任何凭据）、一键清除远程数据

### UIGF 4.2

- 导出升级为 UIGF **v4.2**，内置官方 JSON Schema 并在导出后本地校验
- 原神补齐 `uigf_gacha_type`（400 与 301 共用保底，统一记为 301）
- 支持 `hk4e_ugc`（千星奇域）段的导入 / 导出透传
- 导入兼容 v4.0 / v4.1 / v4.2 / v3.0 / SRGF

> 注：绝区零「音擎回响」池（gacha_type=102/103）尚未收录进 UIGF v4.2 官方枚举，导出时会对这几条给出提示，
> 不影响文件本身被其它工具读取。

---

## License

MIT（基于三个上游项目的 MIT 授权）

> 注意：内嵌的 Biligame wiki 卡池数据受 CC BY-NC-SA 4.0 约束，整体适用于非商业用途。
