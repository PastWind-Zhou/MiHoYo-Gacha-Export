<template>
  <div v-if="ui" class="relative">
    <div class="flex justify-between">
      <div class="space-x-3">
        <el-select v-model="state.game" class="!w-44" :disabled="state.status === 'loading'" @change="changeGame">
          <el-option v-for="item of gameOptions" :key="item.value" :label="item.label" :value="item.value"></el-option>
        </el-select>
        <el-button type="primary" :icon="state.status === 'init' ? 'milk-tea': 'refresh-right'" class="focus:outline-none" :disabled="!allowClick()" plain @click="fetchData()" :loading="state.status === 'loading'">{{state.status === 'init' ? ui.button.load: ui.button.update}}</el-button>
        <el-dropdown :disabled="!gachaData" @command="exportCommand">
          <el-button :disabled="!gachaData" icon="folder-opened" class="focus:outline-none" type="success" plain>
            {{ui.button.files}}
            <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="excel">{{ui.button.excel}}</el-dropdown-item>
              <el-dropdown-item command="uigf-json">{{ui.button.uigf}}</el-dropdown-item>
              <el-dropdown-item command="import-json" divided>{{ui.button.import}}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-tooltip v-if="detail && state.status !== 'loading'" :content="ui.hint.newAccount" placement="bottom">
          <el-button @click="newUser()" plain icon="plus"  class="focus:outline-none"></el-button>
        </el-tooltip>
        <el-tooltip v-if="state.status === 'updated'" :content="ui.hint.relaunchHint" placement="bottom">
          <el-button @click="relaunch()" type="success" icon="refresh"   class="focus:outline-none" style="margin-left: 48px">{{ui.button.directUpdate}}</el-button>
        </el-tooltip>
      </div>
      <div class="flex gap-2">
        <!-- uidSelectText 是只读 computed：用 v-model 会在选择时被写入并触发 Vue 警告，
             改用 :model-value 单向绑定 + @change 处理选择 -->
        <el-select v-if="state.status !== 'loading' && dataMap && (dataMap.size > 1 || (dataMap.size === 1 && state.current === 0))" class="!w-44" @change="changeCurrent" :model-value="uidSelectText">
          <el-option
            v-for="item of dataMap"
            :key="item[0]"
            :label="maskUid(item[0])"
            :value="item[0]">
          </el-option>
        </el-select>
        <el-dropdown @command="optionCommand">
          <el-button @click="showSetting(true)" class="focus:outline-none" plain type="info" icon="more"  >{{ui.button.option}}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="setting" icon="setting">{{ui.button.setting}}</el-dropdown-item>
              <el-dropdown-item :disabled="!allowClick() || state.status === 'loading'" command="url" icon="link">{{ui.button.url}}</el-dropdown-item>
              <el-dropdown-item command="copyUrl" icon="DocumentCopy">{{ui.button.copyUrl}}</el-dropdown-item>
              <el-dropdown-item command="copyApiUrl" icon="Link">{{ui.button.copyApiUrl}}</el-dropdown-item>
              <el-dropdown-item :disabled="!allowClick() || state.status === 'loading'" command="proxy" icon="position">{{ui.button.startProxy}}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
    <p class="text-gray-400 my-2 text-xs">{{hint}}<el-button @click="(state.showCacheCleanDlg=true)" v-if="state.authkeyTimeout" style="margin-left: 8px;" size="small" plain round>{{ui.button.solution}}</el-button></p>
    <el-tabs v-model="state.tab" class="mb-2">
      <el-tab-pane :label="ui.tab.stats" name="stats">
        <div v-if="detail" class="gap-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-4">
          <div class="mb-4" v-for="(item, i) of detail" :key="i">
            <div :class="{hidden: hidePool(item[0])}">
              <p class="text-center text-gray-600 my-2">{{typeMap.get(item[0])}}</p>
              <pie-chart :data="item" :i18n="state.i18n" :typeMap="typeMap" :gameInfo="state.gameInfo"></pie-chart>
              <gacha-detail :i18n="state.i18n" :data="item" :typeMap="typeMap" :gameInfo="state.gameInfo"></gacha-detail>
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane :label="ui.tab.waiwai" name="waiwai">
        <waiwai-panel :stats="state.waiwaiStats" :i18n="state.i18n"></waiwai-panel>
      </el-tab-pane>
    </el-tabs>
    <Setting v-show="state.showSetting" :i18n="state.i18n" :gacha-data-info="dataInfo" :game-info="state.gameInfo" :update-info="state.updateInfo" :update-action="state.updateAction" :update-busy="updateBusy" @refreshData="readData()" @changeLang="getI18nData()" @close="showSetting(false)" @checkUpdate="checkUpdate()" @applyUpdate="applyUpdate()" @skipUpdate="skipUpdate()"></Setting>

    <el-dialog :title="ui.urlDialog.title" v-model="state.showUrlDlg" width="90%" class="max-w-md">
      <p class="mb-4 text-gray-500">{{ui.urlDialog.hint}}</p>
      <el-input  type="textarea" :autosize="{minRows: 4, maxRows: 6}" :placeholder="ui.urlDialog.placeholder" v-model="state.urlInput" spellcheck="false"></el-input>
      <template #footer>
        <span class="dialog-footer">
          <el-button  @click="state.showUrlDlg = false" class="focus:outline-none">{{ui.common.cancel}}</el-button>
          <el-button  type="primary" @click="state.showUrlDlg = false, fetchData(state.urlInput)" class="focus:outline-none">{{ui.common.ok}}</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog :title="ui.button.solution" v-model="state.showCacheCleanDlg" width="90%" class="max-w-md cache-clean-dialog">
      <el-button plain icon="folder" type="success" @click="openCacheFolder">{{ui.button.cacheFolder}}</el-button>
      <p class="my-2 flex flex-col text-teal-800 text-[13px]">
        <span class="my-1" v-for="txt of cacheCleanTextList">{{ txt }}</span>
      </p>
      <p class="my-2 text-gray-500 text-xs">{{ui.extra.findCacheFolder}}</p>
      <template #footer>
        <div class="dialog-footer text-center">
          <el-button  type="primary" @click="state.showCacheCleanDlg = false" class="focus:outline-none">{{ui.common.ok}}</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
const { ipcRenderer } = require('electron')
import { reactive, computed, watch, onMounted, onUnmounted, h } from 'vue'
import PieChart from './components/PieChart.vue'
import GachaDetail from './components/GachaDetail.vue'
import Setting from './components/Setting.vue'
import WaiwaiPanel from './components/WaiwaiPanel.vue'
import gachaDetail from './gachaDetail'
import { version } from '../../package.json'
import { ElMessage, ElMessageBox } from 'element-plus'

const state = reactive({
  status: 'init',
  log: '',
  data: null,
  dataMap: new Map(),
  current: 0,
  game: 'hkrpg',
  gameInfo: null,
  showSetting: false,
  i18n: null,
  showUrlDlg: false,
  showCacheCleanDlg: false,
  urlInput: '',
  authkeyTimeout: false,
  config: {},
  tab: 'stats',
  waiwaiStats: null,
  // 自动更新状态（主进程 GET_UPDATE_INFO / UPDATE_STATUS 推送，经 normalizeUpdateInfo 归一化）
  updateInfo: { status: 'init', available: false, version: '', notes: '', progress: null, error: '' },
  // 正在进行的更新操作：'' | 'check' | 'apply' | 'skip'（用于设置页按钮 loading）
  updateAction: ''
})

const gameOptions = computed(() => {
  if (!state.i18n) return []
  return [
    { value: 'genshin', label: state.i18n.ui.game.genshin },
    { value: 'hkrpg', label: state.i18n.ui.game.hkrpg },
    { value: 'nap', label: state.i18n.ui.game.nap }
  ]
})

const dataMap = computed(() => {
  const result = new Map()
  for (let [uid, data] of state.dataMap) {
    if (!data.deleted) {
      result.set(uid, data)
    }
  }
  return result
})

const dataInfo = computed(() => {
  const result = []
  for (let [uid, data] of state.dataMap) {
    result.push({
      uid, time: data.time, deleted: data.deleted
    })
  }
  return result
})

const ui = computed(() => {
  if (state.i18n) {
    return state.i18n.ui
  }
})

const cacheCleanTextList = computed(() => {
  if (ui.value) {
    return ui.value.extra?.cacheClean?.split('\n')
  }
  return []
})

const gachaData = computed(() => {
  return state.dataMap.get(state.current)
})

const uidSelectText = computed(() => {
  if (state.current === 0) {
    return state.i18n.ui.select.newAccount
  } else {
    return state.current
  }
})

const allowClick = () => {
  const data = state.dataMap.get(state.current)
  if (!data) return true
  if (Date.now() - data.time < 1000 * 10) {
    return false
  }
  return true
}

// 隐藏指定卡池（新手祈愿 / 新手跃迁 / 常驻频段，由各游戏配置决定）
const hidePool = (key) => {
  if (!state.gameInfo) return false
  return !!state.config[state.gameInfo.hideKey] && key === state.gameInfo.hidePool
}

const hint = computed(() => {
  const data = state.dataMap.get(state.current)
  if (!state.i18n) {
    return 'Loading...'
  }
  const { hint } = state.i18n.ui
  const { colon } = state.i18n.symbol
  if (state.status === 'init') {
    return hint.init
  } else if (state.status === 'loaded') {
    // data 可能不存在（抓取到的账号与当前账号不匹配）
    const time = data && data.time ? new Date(data.time).toLocaleString() : '-'
    return `${hint.lastUpdate}${colon}${time}`
  } else if (state.status === 'loading') {
    return state.log || 'Loading...'
  } else if (state.status === 'updated') {
    return state.log
  } else if (state.status === 'failed') {
    return state.log + ` - ${hint.failed}`
  }
  return '　'
})

const detail = computed(() => {
  const data = dataMap.value.get(state.current)
  if (data && state.gameInfo) {
    return gachaDetail(data.result, state.gameInfo)
  }
})

const typeMap = computed(() => {
  const result = new Map()
  if (state.gameInfo) {
    for (let { key, name } of state.gameInfo.types) {
      result.set(key, name)
    }
  }
  return result
})

// 数据加载的请求序号：快速切换游戏/账号时，
// 较早发出的请求可能更晚返回，不能让它覆盖更新的状态
let loadSeq = 0

const applyData = (data) => {
  state.dataMap = data.dataMap
  state.current = data.current
  state.game = data.game
}

const fetchData = async (url) => {
  state.log = ''
  state.status = 'loading'
  const seq = ++loadSeq
  try {
    const data = await ipcRenderer.invoke('FETCH_DATA', url)
    // 已有更新的请求发出，丢弃本次响应
    if (seq !== loadSeq) return
    if (data) {
      applyData(data)
      state.status = 'loaded'
      await loadWaiwai()
    } else {
      state.status = 'failed'
    }
  } catch (e) {
    // IPC 异常必须复位状态，否则按钮永久转圈
    if (seq !== loadSeq) return
    state.status = 'failed'
    state.log = e?.message || String(e)
  }
}

const readData = async (force = false) => {
  const seq = ++loadSeq
  try {
    const data = await ipcRenderer.invoke(force ? 'FORCE_READ_DATA' : 'READ_DATA')
    if (seq !== loadSeq) return
    if (data) {
      applyData(data)
      if (data.dataMap.get(data.current)) {
        state.status = 'loaded'
      }
      await loadWaiwai()
    }
  } catch (e) {
    if (seq !== loadSeq) return
    state.status = 'failed'
    state.log = e?.message || String(e)
  }
}

// 拉取歪率分析数据（独立标签页）
const loadWaiwai = async () => {
  try {
    const data = await ipcRenderer.invoke('GET_WAIWAI_STATS')
    state.waiwaiStats = data
  } catch (e) {
    // 统计失败不影响其它功能
    console.error('load waiwai stats failed', e)
    state.waiwaiStats = null
  }
}

const changeGame = async (gameId) => {
  // 快速连续切换游戏时，旧请求可能晚于新请求返回，
  // 复用 loadSeq 丢弃过期的 SWITCH_GAME 响应
  const seq = ++loadSeq
  try {
    const data = await ipcRenderer.invoke('SWITCH_GAME', gameId)
    if (seq !== loadSeq) return
    if (data) {
      applyData(data)
      state.status = data.dataMap.get(data.current) ? 'loaded' : 'init'
      state.authkeyTimeout = false
      state.log = ''
    }
  } catch (e) {
    if (seq !== loadSeq) return
    state.status = 'failed'
    state.log = e?.message || String(e)
    return
  }
  await getI18nData()
  await updateConfig()
  await loadWaiwai()
  ipcRenderer.invoke('MAYBE_SYNC_BANNERS', state.game).catch(() => {})
}

const getI18nData = async () => {
  try {
    const data = await ipcRenderer.invoke('I18N_DATA')
    if (data) {
      state.i18n = data
      setTitle()
    }
    // 切换语言后 gameInfo（卡池类型名等）仍停留在旧语言，
    // 必须同步刷新，否则要等切游戏或重启才更新
    await updateConfig()
  } catch (e) {
    console.error('load i18n failed', e)
  }
  // 卡池名称跟随语言，切换语言后刷新统计
  await loadWaiwai()
}

const saveExcel = async () => {
  try {
    await ipcRenderer.invoke('SAVE_EXCEL')
  } catch (e) {
    console.error('save excel failed', e)
    ElMessage.error(e?.message || String(e))
  }
}

const exportUIGFJSON = () => {
  let uidList = []
  dataMap.value.forEach(item => {
    uidList.push(item.uid)
  })

  // uid 来自导入文件，内容不可控。
  // 旧实现把 uid 直接拼进 HTML 字符串并开启 dangerouslyUseHTMLString，
  // 配合 nodeIntegration:true 等于任意代码执行。
  // 这里改用 h() 渲染函数构造 VNode，并用受控的选中集合跟踪勾选状态，
  // 不从 DOM 里反查，避免依赖 Element Plus 的内部结构。
  const selected = new Set()
  const message = h('div', uidList.map((uid, index) => {
    const id = `uigf-uid-${index}`
    return h('div', [
      h('input', {
        type: 'checkbox',
        id,
        checked: selected.has(String(uid)),
        onChange: (e) => {
          if (e.target.checked) selected.add(String(uid))
          else selected.delete(String(uid))
        }
      }),
      h('label', { for: id }, String(uid))
    ])
  }))

  ElMessageBox({
    title: state.i18n.ui.uigf.title,
    message,
    showCancelButton: true,
    confirmButtonText: state.i18n.ui.common.ok,
    cancelButtonText: state.i18n.ui.common.cancel,
    beforeClose: (action, instance, done) => {
      if (action === 'confirm') {
        // IPC 失败不能让确认弹窗永远停在安装中状态
        ipcRenderer.invoke('EXPORT_UIGF_JSON', Array.from(selected)).catch((e) => {
          console.error('export uigf failed', e)
          ElMessage.error(e?.message || String(e))
        })
      }
      done();
    }
  }).then(() => {
  }).catch(() => {
  });
}

const importData = async () => {
  state.status = 'loading'
  const seq = ++loadSeq
  try {
    const data = await ipcRenderer.invoke('IMPORT_UIGF_JSON')
    if (seq !== loadSeq) return
    if (data) {
      applyData(data)
      state.status = 'loaded'
      await loadWaiwai()
    } else {
      state.status = 'failed'
    }
  } catch (e) {
    if (seq !== loadSeq) return
    state.status = 'failed'
    state.log = e?.message || String(e)
  }
}

const exportCommand = (type) => {
  if (type === 'excel') {
    saveExcel()
  } else if (type === 'uigf-json') {
    exportUIGFJSON()
  } else if (type === 'import-json') {
    importData()
  }
}

const openCacheFolder = async () => {
  try {
    await ipcRenderer.invoke('OPEN_CACHE_FOLDER')
  } catch (e) {
    console.error('open cache folder failed', e)
    ElMessage.error(e?.message || String(e))
  }
}

const changeCurrent = async (uid) => {
  if (uid === 0) {
    state.status = 'init'
  } else {
    state.status = 'loaded'
  }
  state.current = uid
  try {
    await ipcRenderer.invoke('CHANGE_UID', uid)
  } catch (e) {
    console.error('change uid failed', e)
  }
  await loadWaiwai()
}

const newUser = async () => {
  await changeCurrent(0)
}

const relaunch = async () => {
  try {
    await ipcRenderer.invoke('RELAUNCH')
  } catch (e) {
    console.error('relaunch failed', e)
    ElMessage.error(e?.message || String(e))
  }
}

const maskUid = (uid) => {
  return `${uid}`.replace(/(.{3})(.+)(.{3})$/, '$1***$3')
}

const showSetting = (show) => {
  if (show) {
    state.showSetting = true
  } else {
    state.showSetting = false
    updateConfig()
    // 设置页可能修改了卡池排期，关闭时刷新歪率分析
    loadWaiwai()
  }
}

const optionCommand = (type) => {
  if (type === 'setting') {
    showSetting(true)
  } else if (type === 'url') {
    state.urlInput = ''
    state.showUrlDlg = true
  } else if (type === 'proxy') {
    fetchData('proxy')
  } else if (type === 'copyUrl') {
    copyUrl()
  } else if (type === 'copyApiUrl') {
    copyApiUrl()
  }
}

const setTitle = () => {
  document.title = `${state.i18n.ui.win.title} - v${version}`
}

const updateConfig = async () => {
  try {
    const config = await ipcRenderer.invoke('GET_CONFIG')
    state.config = config
    state.gameInfo = config.gameInfo
    if (config.game && config.game !== state.game) {
      state.game = config.game
    }
  } catch (e) {
    // 配置读取失败时保留现有状态，避免把 gameInfo 清空导致渲染层连锁异常
    console.error('load config failed', e)
  }
}

// ---- 自动更新（渲染层只负责触发与展示，检测/下载/切换都在主进程完成）----

// 主进程推送的更新状态结构不可控（handler 未实现/抛错/旧版本），
// 统一在这里归一化，避免渲染层各处重复做类型防御
const normalizeUpdateInfo = (raw) => {
  const info = raw && typeof raw === 'object' ? raw : {}
  const progress = typeof info.progress === 'number' && Number.isFinite(info.progress)
    ? Math.min(100, Math.max(0, Math.round(info.progress)))
    : null
  const status = typeof info.status === 'string' && info.status ? info.status : 'init'
  return {
    status,
    // 主进程回推的 UPDATE_STATUS 可能只带 status 不带 available，
    // 这里按状态推断一次，避免「立即更新」按钮一直不可用
    available: !!info.available || status === 'available',
    version: info.version == null ? '' : String(info.version),
    notes: info.notes == null ? '' : String(info.notes),
    progress,
    error: info.error == null ? '' : String(info.error)
  }
}

// 更新流程中主进程正在忙的状态：此时不允许再次触发检查/更新/跳过
// 'restoring' 是校验失败后从备份恢复的阶段，同样不能被用户打断
const updateBusyStatus = ['checking', 'downloading', 'verifying', 'backing-up', 'backingUp', 'staging', 'moving', 'validating', 'restoring', 'ready']
const updateBusy = computed(() => updateBusyStatus.includes(state.updateInfo.status))

// 启动时同步一次主进程的更新状态（如启动检测已发现新版本）
const initUpdateInfo = async () => {
  try {
    const info = await ipcRenderer.invoke('GET_UPDATE_INFO')
    state.updateInfo = normalizeUpdateInfo(info)
  } catch (e) {
    // 主进程尚未注册该 IPC（旧版本/未合并 update 模块）时保持默认值，不影响其它功能
  }
}

const setUpdateResult = (result, fallbackInfo) => {
  // 契约：{ ok: true, data } | { ok: false, error }
  if (result && result.ok) {
    if (result.data) {
      state.updateInfo = normalizeUpdateInfo(result.data)
    }
  } else {
    state.updateInfo = normalizeUpdateInfo({
      ...fallbackInfo,
      status: 'failed',
      error: result && result.error
    })
  }
}

const checkUpdate = async () => {
  if (state.updateAction || updateBusy.value) return
  state.updateAction = 'check'
  try {
    const result = await ipcRenderer.invoke('CHECK_UPDATE')
    setUpdateResult(result, {})
  } catch (e) {
    // IPC 异常（handler 未注册/抛错）不能让按钮永久 loading
    state.updateInfo = normalizeUpdateInfo({ status: 'failed', error: e?.message || String(e) })
  } finally {
    state.updateAction = ''
  }
}

const applyUpdate = async () => {
  if (state.updateAction || updateBusy.value || !state.updateInfo.available) return
  state.updateAction = 'apply'
  const fallbackInfo = {
    available: true,
    version: state.updateInfo.version
  }
  try {
    const result = await ipcRenderer.invoke('APPLY_UPDATE')
    // 下载/备份/暂存的后续进度由主进程通过 UPDATE_STATUS 推送
    setUpdateResult(result, fallbackInfo)
  } catch (e) {
    state.updateInfo = normalizeUpdateInfo({ ...fallbackInfo, status: 'failed', error: e?.message || String(e) })
  } finally {
    state.updateAction = ''
  }
}

const skipUpdate = async () => {
  if (state.updateAction || updateBusy.value || !state.updateInfo.available) return
  state.updateAction = 'skip'
  try {
    const result = await ipcRenderer.invoke('SKIP_UPDATE', { version: state.updateInfo.version })
    if (result && result.ok) {
      // 主进程记录跳过版本；渲染层本地收敛为「已跳过」，
      // 避免主进程不回推状态时界面仍显示「发现新版本」
      state.updateInfo = normalizeUpdateInfo({ ...state.updateInfo, status: 'skipped', available: false })
    } else {
      state.updateInfo = normalizeUpdateInfo({ ...state.updateInfo, status: 'failed', error: result && result.error })
    }
  } catch (e) {
    state.updateInfo = normalizeUpdateInfo({ ...state.updateInfo, status: 'failed', error: e?.message || String(e) })
  } finally {
    state.updateAction = ''
  }
}

const copyUrl = async () => {
  try {
    const successed = await ipcRenderer.invoke('COPY_URL')
    if (successed) {
      ElMessage.success(ui.value.extra.urlCopied)
    } else {
      ElMessage.error(state.i18n.log.url.notFound)
    }
  } catch (e) {
    console.error('copy url failed', e)
    ElMessage.error(e?.message || String(e))
  }
}

const copyApiUrl = async () => {
  try {
    const successed = await ipcRenderer.invoke('COPY_API_URL')
    if (successed) {
      ElMessage.success(ui.value.extra.apiUrlCopied)
    } else {
      ElMessage.error(state.i18n.log.url.notFound)
    }
  } catch (e) {
    console.error('copy api url failed', e)
    ElMessage.error(e?.message || String(e))
  }
}

// 最近一条 UPDATE_HINT 消息：用于启动期事件早于数据加载完成时的补偿展示
let updateHintMessage = null

// IPC 监听器引用：组件卸载时必须移除，否则会累积并操作已销毁的组件状态
const ipcHandlers = {
  LOAD_DATA_STATUS: (event, message) => {
    state.log = message
  },
  ERROR: (event, err) => {
    console.error(err)
    ipcRenderer.invoke('LOG_ERROR', err && err.stack ? err.stack : String(err)).catch(() => {})
  },
  // 真正的更新完成信号（仅「升级后数据校验通过」会发）：
  // 展示消息并进入 updated 状态，让顶部的「直接更新」重启按钮出现
  UPDATE_HINT: (event, message) => {
    // 启动阶段该事件可能先于数据加载完成到达（监听器已提前注册），
    // onMounted 末尾会补一次展示，避免被 readData 的结果覆盖
    updateHintMessage = message
    state.log = message
    state.status = 'updated'
  },
  // 其它更新提示（校验后从备份恢复、正在回滚、旧版本程序缺失、
  // 上次更新失败、检测到未完成更新、备份清单缺失等）：
  // 只写日志并 toast，绝不改 status，否则会误报成「更新完成」并显示重启按钮
  UPDATE_MESSAGE: (event, message) => {
    state.log = message
    ElMessage.info(message)
  },
  // 主进程在检测/下载/备份/暂存/校验各阶段推送的更新状态对象
  UPDATE_STATUS: (event, message) => {
    state.updateInfo = normalizeUpdateInfo(message)
    // 新状态到达后复位按钮 loading，由状态本身决定后续可操作性
    state.updateAction = ''
  },
  AUTHKEY_TIMEOUT: (event, message) => {
    state.authkeyTimeout = message
  }
}

onMounted(async () => {
  // IPC 监听器必须先于任何 await 注册：
  // 主进程可能在首个 await（updateConfig/readData）期间就发出
  // LOAD_DATA_STATUS / ERROR / UPDATE_STATUS，晚注册会丢失启动期进度与错误事件
  for (const [channel, handler] of Object.entries(ipcHandlers)) {
    ipcRenderer.on(channel, handler)
  }

  await updateConfig()
  await readData()
  await getI18nData()

  // 同步一次主进程的更新状态；主进程未注册该 IPC 时静默跳过
  initUpdateInfo()

  // 启动期间收到过 UPDATE_HINT 时补展示（readData 可能已把 status 覆盖为 loaded）
  if (updateHintMessage !== null && state.status !== 'loading') {
    state.log = updateHintMessage
    state.status = 'updated'
  }

  // 按设置中的间隔自动同步卡池数据（失败不影响其它功能）
  ipcRenderer.invoke('MAYBE_SYNC_BANNERS', state.game).catch(() => {})
})

onUnmounted(() => {
  for (const [channel, handler] of Object.entries(ipcHandlers)) {
    ipcRenderer.removeListener(channel, handler)
  }
})
</script>
