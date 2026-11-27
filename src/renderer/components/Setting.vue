<template>
  <!-- z-50 必须高于 el-tabs 的 z-index（--el-index-normal + 1 = 2）：
       fixed 元素虽会创建层叠上下文，但 z-index 为 auto 时视作 0，
       会被 el-tabs__nav（position:relative; z-index:2）压在下面，
       导致底层的「抽卡统计 / 歪率分析」标签透到设置页上方。 -->
  <div class="bg-white py-4 px-6 w-screen h-screen fixed inset-0 z-50 overflow-y-auto">
    <div class="flex content-center items-center mb-4 justify-between">
      <h3 class="text-lg">{{text.title}}</h3>
      <!-- 关闭按钮必须带 z-index：设置页内容可滚动，滚动后表单内容会盖住
           fixed 定位的按钮（按钮 z-index:auto，表单在 DOM 中更靠后），
           导致滚到底部时点不到关闭按钮 -->
      <el-button icon="close" @click="closeSetting" plain circle type="default" class="w-8 h-8 shadow-md focus:shadow-none focus:outline-none fixed top-4 right-6 z-50"></el-button>
    </div>
    <el-form :model="settingForm" label-width="120px">
      <el-form-item :label="text.language">
        <el-select @change="saveLang" v-model="settingForm.lang" class="!w-44">
          <el-option v-for="item of data.langMap" :key="item[0]" :label="item[1]" :value="item[0]"></el-option>
        </el-select>
        <p class="text-gray-400 text-xs m-1.5">{{text.languageHint}}</p>
      </el-form-item>
      <el-form-item :label="text.logType">
        <el-radio-group @change="saveSetting" v-model.number="settingForm.logType">
          <el-radio-button :label="0">{{text.auto}}</el-radio-button>
          <el-radio-button :label="1">{{text.cnServer}}</el-radio-button>
          <el-radio-button :label="2">{{text.seaServer}}</el-radio-button>
        </el-radio-group>
        <p class="text-gray-400 text-xs m-1.5">{{text.logTypeHint}}</p>
      </el-form-item>
      <el-form-item :label="common.data">
        <el-button type="primary" plain @click="state.showDataDialog = true">{{common.dataManage}}</el-button>
        <p class="text-gray-400 text-xs m-1.5">{{text.dataManagerHint}}</p>
      </el-form-item>
      <el-form-item :label="text.bannerData">
        <el-button type="primary" plain @click="state.showBannerDialog = true">{{text.bannerManage}}</el-button>
        <p class="text-gray-400 text-xs m-1.5">{{text.bannerHint}}</p>
      </el-form-item>
      <el-form-item :label="text.autoUpdate">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.autoUpdate">
        </el-switch>
        <p class="text-gray-400 text-xs m-1.5">{{text.updateHint}}</p>
        <!-- 检测/下载/切换都在主进程完成，按钮只负责触发；
             进度与阶段由 UPDATE_STATUS 推送，loading 由 updateAction 驱动 -->
        <div class="flex flex-wrap gap-2 mt-1">
          <el-button size="small" plain icon="refresh-right" :loading="updateAction === 'check'" :disabled="!!updateAction || updateBusy || state.settingSaving" @click="emit('checkUpdate')">{{text.updateCheck}}</el-button>
          <el-button size="small" plain type="primary" icon="refresh" :loading="updateAction === 'apply'" :disabled="!!updateAction || updateBusy || state.settingSaving || !updateInfo.available" @click="emit('applyUpdate')">{{text.updateApply}}</el-button>
          <el-button size="small" plain type="info" :loading="updateAction === 'skip'" :disabled="!!updateAction || updateBusy || state.settingSaving || !updateInfo.available" @click="emit('skipUpdate')">{{text.updateSkip}}</el-button>
        </div>
        <p class="text-gray-400 text-xs m-1.5">{{updateStatusText}}</p>
        <p v-if="updateInfo.notes" class="text-gray-400 text-xs m-1.5 whitespace-pre-wrap">{{updateInfo.notes}}</p>
      </el-form-item>
      <el-form-item v-if="gameInfo?.hideKey === 'hideNovice'" :label="text.hideNovice">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.hideNovice">
        </el-switch>
      </el-form-item>
      <el-form-item v-else-if="gameInfo?.hideKey === 'hideStandard'" :label="text.hideStandard">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.hideStandard">
        </el-switch>
      </el-form-item>
      <el-form-item :label="text.fetchFullHistory">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.fetchFullHistory">
        </el-switch>
        <p class="text-gray-400 text-xs m-1.5">{{text.fetchFullHistoryHint}}</p>
      </el-form-item>
      <el-form-item :label="text.proxyMode">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.proxyMode">
        </el-switch>
        <p class="text-gray-400 text-xs m-1.5">{{text.proxyModeHint}}</p>
        <el-button class="focus:outline-none" :loading="state.proxyLoading" :disabled="state.proxyLoading" @click="disableProxy">{{text.closeProxy}}</el-button>
        <p class="text-gray-400 text-xs m-1.5">{{text.closeProxyHint}}</p>
      </el-form-item>
    </el-form>
    <h3 class="text-lg my-4">{{about.title}}</h3>
    <p class="text-gray-600 text-xs mt-1">{{text.idVersion}} {{gameInfo?.idVersion || '-'}}</p>
    <!-- 版本与构建标识：版本号不变时（如覆盖重发同一版本），
         用户靠构建时间就能分辨手上是新包还是旧包 -->
    <p class="text-gray-600 text-xs mt-1">Version: v{{version}}<span v-if="buildId"> · Build: {{buildId}}</span></p>
    <p class="text-gray-600 text-xs mt-1">{{about.license}}</p>
    <p class="text-gray-600 text-xs mt-1">GitHub:
      <a @click="openLink('https://github.com/PastWind-Zhou/MiHoYo-Gacha-Export')" class="cursor-pointer text-blue-400">MiHoYo-Gacha-Export</a>
    </p>
    <p class="text-gray-600 text-xs mt-1 pb-6">UIGF: <a @click="openLink('https://uigf.org/')" class="cursor-pointer text-blue-400">https://uigf.org/</a></p>
    <el-dialog v-model="state.showDataDialog" :title="common.dataManage" width="90%">
      <div class="">
        <el-table :data="gachaDataInfo" border stripe>
          <el-table-column property="uid" label="UID" width="128" />
          <el-table-column property="time" :label="common.updateTime">
            <template #default="scope">
              {{ formatTime(scope.row.time) }}
            </template>
          </el-table-column>
          <el-table-column property="deleted" :label="common.status" width="128">
            <template #default="scope">
              <el-tag type="info" size="small" v-if="scope.row.deleted">{{common.deleted}}</el-tag>
              <el-tag type="success" size="small" v-else>{{common.normal}}</el-tag>
            </template>
          </el-table-column>
          <el-table-column property="deleted" :label="common.action" width="128">
            <template #default="scope">
              <el-tooltip :content="scope.row.deleted ? common.restore : common.delete" placement="top">
                <el-button :loading="state.dataActionLoading" size="small" icon="refresh" plain type="success" @click="deleteData(scope.row.uid, false)" v-if="scope.row.deleted"></el-button>
                <el-button :loading="state.dataActionLoading" size="small" icon="delete" plain type="danger" @click="deleteData(scope.row.uid, true)" v-else></el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
    <el-dialog v-model="state.showBannerDialog" :title="banner.title" width="92%">
      <banner-manager :i18n="i18n" :game-info="gameInfo"></banner-manager>
    </el-dialog>
  </div>

</template>

<script setup>
const { ipcRenderer, shell } = require('electron')
import { reactive, onMounted, computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import BannerManager from './BannerManager.vue'
import { version } from '../../../package.json'

const emit = defineEmits(['close', 'changeLang', 'refreshData', 'checkUpdate', 'applyUpdate', 'skipUpdate'])

// 构建标识：来自主进程的 build-info.json（打包时由 tools/package.js 写入）。
// 版本号不变时（如覆盖重发同一版本），用户靠它分辨新旧包
const buildId = ref('')

const props = defineProps({
  i18n: Object,
  gachaDataInfo: Array,
  gameInfo: Object,
  // 更新状态由父组件（App.vue）统一持有，这里只做展示与触发，
  // 避免设置页卸载/重开时与主进程状态失去同步
  updateInfo: {
    type: Object,
    default: () => ({ status: 'init', available: false, version: '', notes: '', progress: null, error: '' })
  },
  updateAction: { type: String, default: '' },
  updateBusy: { type: Boolean, default: false }
})

const data = reactive({
  langMap: new Map(),
})

const settingForm = reactive({
  lang: 'zh-cn',
  logType: 1,
  proxyMode: true,
  autoUpdate: true,
  fetchFullHistory: false,
  hideNovice: true,
  hideStandard: false
})

const state = reactive({
  showDataDialog: false,
  showBannerDialog: false,
  dataActionLoading: false,
  settingSaving: false,
  proxyLoading: false
})

// i18n 可能还没加载完成（props.i18n 为 null），
// 直接 props.i18n.ui.xxx 会抛 TypeError，
// 导致整个设置页渲染失败、按钮点击无响应。
// 这里统一用可选链兜底。
const common = computed(() => props.i18n?.ui?.common || {})
const text = computed(() => props.i18n?.ui?.setting || {})
const about = computed(() => props.i18n?.ui?.about || {})
const banner = computed(() => props.i18n?.ui?.banner || {})
const gameInfo = computed(() => props.gameInfo)

// 更新状态文案：status 来自主进程状态机，部分阶段名用连字符（backing-up），
// 这里统一映射到 i18n 键；未收录的状态回退到 init，避免界面出现 undefined。
// I18N_DATA 返回的是原始字典（未走主进程 parseText），占位符在渲染层替换。
const updateStatusText = computed(() => {
  const info = props.updateInfo || {}
  const dict = props.i18n?.ui?.update?.status || {}
  const status = info.status || 'init'
  const alias = { 'backing-up': 'backingUp', backing_up: 'backingUp', moving: 'staging' }
  const key = alias[status] || status
  let text = dict[key] || dict.init || ''
  text = String(text)
    .replace('${version}', info.version || '')
    .replace('${progress}', info.progress == null ? '--' : `${info.progress}%`)
  if (status === 'failed' && info.error) {
    text = `${text} ${info.error}`
  }
  return text
})

// 时间格式化：无有效时间时显示 '-'
const formatTime = (t) => {
  if (t === undefined || t === null || t === '') return '-'
  const d = new Date(t)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString()
}

const saveSetting = async () => {
  const keys = ['lang', 'logType', 'proxyMode', 'autoUpdate', 'fetchFullHistory', 'hideNovice', 'hideStandard']
  state.settingSaving = true
  try {
    for (let key of keys) {
      await ipcRenderer.invoke('SAVE_CONFIG', [key, settingForm[key]])
    }
  } catch (e) {
    console.error('save setting failed', e)
    ElMessage.error(e?.message || String(e))
  } finally {
    // IPC 异常必须复位，避免后续操作被旧的 loading 状态挡住
    state.settingSaving = false
  }
}

const saveLang = async () => {
  try {
    await saveSetting()
  } catch (e) {
    console.error('save lang failed', e)
  } finally {
    // 无论是否保存成功都刷新界面语言，避免切换后停留在旧文案
    emit('changeLang')
  }
}

const closeSetting = () => emit('close')

const disableProxy = async () => {
  state.proxyLoading = true
  try {
    await ipcRenderer.invoke('DISABLE_PROXY')
  } catch (e) {
    console.error('disable proxy failed', e)
    ElMessage.error(e?.message || String(e))
  } finally {
    state.proxyLoading = false
  }
}

const openLink = (link) => shell.openExternal(link).catch((e) => {
  console.error('open link failed', e)
  ElMessage.error(e?.message || String(e))
})

const deleteData = async (uid, action) => {
  state.dataActionLoading = true
  try {
    await ipcRenderer.invoke('DELETE_DATA', uid, action)
    emit('refreshData')
  } catch (e) {
    console.error('delete data failed', e)
  } finally {
    // 必须复位，否则 IPC 异常时按钮会永久禁用
    state.dataActionLoading = false
  }
}

onMounted(async () => {
  try {
    data.langMap = await ipcRenderer.invoke('LANG_MAP')
    const config = await ipcRenderer.invoke('GET_CONFIG')
    Object.assign(settingForm, config)
    // 构建标识：主进程从 resources/app/build-info.json 读取
    buildId.value = (config && config.buildInfo && config.buildInfo.buildId) || ''
  } catch (e) {
    // 单个 IPC 失败不能让整个设置页白屏
    console.error('load setting failed', e)
  } finally {
    state.settingSaving = false
  }
})

</script>

<style>
.el-form-item__label {
  line-height: normal !important;
  position: relative;
  top: 6px;
}
.el-form-item__content {
  flex-direction: column;
  align-items: start !important;
}
.el-form-item--default {
  margin-bottom: 14px !important;
}
</style>
