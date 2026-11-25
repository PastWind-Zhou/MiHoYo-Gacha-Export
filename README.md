# 米哈游抽卡记录导出工具（三合一）

一个工具导出三款游戏的抽卡/跃迁/调频记录，由以下三个开源项目合并而来（MIT）：

- [biuuu/genshin-wish-export](https://github.com/biuuu/genshin-wish-export)（原神 祈愿记录导出）
- [biuuu/star-rail-warp-export](https://github.com/biuuu/star-rail-warp-export)（崩坏：星穹铁道 跃迁记录导出）
- [earthjasonlin/zzz-signal-search-export](https://github.com/earthjasonlin/zzz-signal-search-export)（绝区零 调频记录导出）

界面、布局与交互保持与原工具一致（同一套 Electron + Vue 3 + Element Plus UI），左上角新增**游戏切换**下拉，三款游戏的数据、设置与统计完全独立。

## 支持的功能

| 功能 | 原神 | 星穹铁道 | 绝区零 |
|---|---|---|---|
| 日志+网页缓存获取 authKey | ✓（output_log.txt / 云游戏日志） | ✓（Player.log） | ✓（Player.log，含直读 URL 快捷路径） |
| 代理模式（MITM 兜底） | ✓ | ✓ | ✓ |
| 手动输入 URL / 复制 URL / 复制 API 链接 | ✓ | ✓ | ✓ |
| 多账号管理与数据软删除 | ✓ | ✓ | ✓ |
| 增量更新（只拉新记录） | ✓ | ✓ | ✓ |
| 「获取完整数据」修复模式 | ✓ | ✓ | ✓ |
| Excel 导出（含 rawData 页） | ✓ | ✓ | ✓（S/A/B 级配色） |
| UIGF v4.1 导出 / v4.0+v4.1+v3.0+SRGF 导入 | ✓（hk4e，内置 item_id 字典） | ✓（hkrpg，兼容联动池） | ✓（nap，含时区转换） |
| 联动卡池（getLdGachaLog） | — | ✓（21/22） | — |
| 重映池（独家重映/音擎回响） | — | — | ✓（102/103） |
| 物品 ID 数据库自动回填 | — | ✓（v4.7） | ✓（v3.3） |
| 隐藏新手祈愿 / 隐藏常驻频段 | ✓ | ✓ | ✓ |

## 使用方法

1. 解压后运行 `MiHoYoGachaExport.exe`（Windows 64 位）
2. 在左上角切换到目标游戏
3. 在**游戏内打开对应的抽卡/跃迁/调频详情页**
4. 点击「加载数据」

数据保存在程序目录的 `userData/<游戏>/gacha-list-<UID>.json`（原神为 `genshin`，星铁为 `hkrpg`，绝区零为 `nap`）。

> 旧版单游戏工具的数据：可在旧工具中导出 UIGF 文件，再用本工具「导入 UIGF」迁移；或直接把旧的 `gacha-list-*.json` 复制进对应游戏目录（原神旧数组格式会自动转换）。

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
build/MiHoYoGachaExport-<版本号>/            免安装目录，直接运行 MiHoYoGachaExport.exe
build/MiHoYoGachaExport-<版本号>-win.zip      压缩包（不含 userData，Windows 原生 zip 格式）
```

> 版本号变更：修改 `package.json` 的 `version` 后重新执行 `node tools/package.js`，目录名与包名会自动带上新版本号。
>
> `userData`（抽卡记录、设置）保存在**免安装目录内**，不随压缩包分发；重新打包时会自动保留。

## 架构说明（相对原项目的改动）

- 新增 `src/main/games.js`：三款游戏的全部差异集中于此（日志路径与文件名、缓存目录正则、URL 提取正则、API 域名与路径、卡池类型参数与顺序、时区规则、UIGF 键名、星级层级、隐藏池配置、物品库模式）。
- 数据模型统一为对象格式 `{id, item_id, item_type, name, rank_type, time, gacha_id, gacha_type, count}`；原神旧数组格式读取时自动转换。
- `config.js` 增加 `game` 与 `currents`（每款游戏记住各自的当前 UID）。
- 数据按游戏分子目录存储；UIGF 导入按文件内 `hk4e / hkrpg / nap` 键自动归类到对应游戏。
- 统计组件（饼图/明细）按游戏星级层级（原神/星铁 3-4-5 星，绝区零 B-A-S 级）参数化，支持邦布分类。
- `userData/config.json` 兼容旧配置；自动更新已停用（三合一版本无独立更新源）。

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

## License

MIT（基于三个上游项目的 MIT 授权）

> 注意：内嵌的 Biligame wiki 卡池数据受 CC BY-NC-SA 4.0 约束，整体适用于非商业用途。
