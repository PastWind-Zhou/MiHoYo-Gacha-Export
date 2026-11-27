<template>
  <div class="text-xs">
    <!-- 远程数据源 -->
    <div class="border border-gray-200 rounded p-3 mb-3">
      <p class="text-sm text-gray-700 mb-2 font-medium">{{text.remoteSource}}</p>
      <div class="flex flex-wrap gap-3 items-center">
        <div class="flex items-center gap-2 grow">
          <span class="text-gray-500 shrink-0">{{text.url}}</span>
          <el-input v-model="sourceForm.url" :placeholder="text.urlPlaceholder" class="!w-80" clearable></el-input>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-500">{{text.interval}}</span>
          <el-input v-model.number="sourceForm.interval" type="number" min="1" class="!w-20"></el-input>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-500">{{text.timeout}}</span>
          <el-input v-model.number="sourceForm.timeout" type="number" min="1" class="!w-20"></el-input>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-500">{{text.retry}}</span>
          <el-input v-model.number="sourceForm.retry" type="number" min="0" class="!w-20"></el-input>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-gray-500">{{text.autoSync}}</span>
          <el-switch v-model="sourceForm.autoSync"></el-switch>
        </div>
      </div>
      <div class="flex gap-2 mt-3 items-center">
        <el-button size="small" type="primary" plain :loading="state.syncing" @click="doSync">{{text.syncNow}}</el-button>
        <el-button size="small" type="warning" plain :loading="state.working" @click="doClearRemote">{{text.clearRemote}}</el-button>
        <el-button size="small" type="success" plain :loading="state.working" @click="doImport">{{text.importJson}}</el-button>
        <span class="text-gray-400 ml-2">{{text.lastSync}}{{sourceForm.lastSync ? formatTime(sourceForm.lastSync) : text.never}}</span>
      </div>
      <p v-if="state.message" class="mt-2" :class="state.failed ? 'text-red-500' : 'text-green-600'">{{state.message}}</p>
      <p class="text-gray-400 mt-2">{{text.sourceHint}}</p>
    </div>

    <!-- 卡池表 -->
    <div class="flex items-center gap-3 mb-2">
      <p class="text-sm text-gray-700 font-medium">{{text.table}} ({{filtered.length}}/{{rows.length}})</p>
      <el-select v-model="state.channel" class="!w-36">
        <el-option :label="text.all" value=""></el-option>
        <el-option v-for="item of channelOptions" :key="item.value" :label="item.label" :value="item.value"></el-option>
      </el-select>
      <el-input v-model="state.keyword" :placeholder="text.search" class="!w-56" clearable></el-input>
    </div>
    <el-table :data="filtered" border stripe height="360" size="small">
      <el-table-column prop="version" :label="text.version" width="70"></el-table-column>
      <el-table-column prop="phase" :label="text.phase" width="70"></el-table-column>
      <el-table-column :label="text.channel" width="90">
        <template #default="scope">{{channelName(scope.row.channel)}}</template>
      </el-table-column>
      <el-table-column prop="title" :label="text.titleCol" width="140" show-overflow-tooltip></el-table-column>
      <el-table-column prop="start" :label="text.start" width="150"></el-table-column>
      <el-table-column prop="end" :label="text.end" width="150"></el-table-column>
      <el-table-column :label="text.up" min-width="180" show-overflow-tooltip>
        <template #default="scope">
          <span v-if="scope.row.up && scope.row.up.length">{{scope.row.up.join('、')}}</span>
          <span v-else-if="scope.row.needsManual" class="text-orange-500">{{text.needsManual}}{{scope.row.candidates.join('、')}}</span>
          <span v-else class="text-gray-300">-</span>
        </template>
      </el-table-column>
      <el-table-column :label="text.source" width="90">
        <template #default="scope">{{sourceName(scope.row.source)}}</template>
      </el-table-column>
      <el-table-column :label="text.action" width="90" fixed="right">
        <template #default="scope">
          <el-button size="small" plain type="primary" @click="openEdit(scope.row)">{{text.edit}}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 修正 UP -->
    <el-dialog v-model="state.editVisible" :title="text.editTitle" width="480px" append-to-body>
      <p class="text-gray-500 mb-2">{{editRow.channel}} {{editRow.start}} ~ {{editRow.end}}</p>
      <el-input v-model="editForm.up" type="textarea" :rows="3" :placeholder="text.upPlaceholder"></el-input>
      <template #footer>
        <el-button @click="state.editVisible = false">{{text.cancel}}</el-button>
        <el-button type="primary" @click="doSaveUp">{{text.save}}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, computed, onMounted } from 'vue'

const props = defineProps({
  i18n: Object,
  gameInfo: Object,
  game: String
})

// 当前游戏 id：优先用父组件显式传入的 game，
// 否则退回 gameInfo.game（主进程 getGameInfo 会返回 game 字段）
const currentGame = computed(() => props.game || props.gameInfo?.game || '')

const { ipcRenderer } = require('electron')
const { ElMessage } = require('element-plus')

const text = computed(() => props.i18n?.ui?.banner || {})

const state = reactive({
  rows: [],
  channel: '',
  keyword: '',
  syncing: false,
  working: false,
  message: '',
  failed: false,
  editVisible: false
})

const sourceForm = reactive({
  url: '',
  interval: 24,
  timeout: 30,
  retry: 1,
  autoSync: false,
  lastSync: 0
})

const editForm = reactive({ up: '' })
const editRow = reactive({ channel: '', start: '', end: '', version: '', phase: '', title: '', up4: [] })

const channelOptions = computed(() => {
  const t = text.value
  return [
    { value: 'character', label: t.channelCharacter || 'character' },
    { value: 'weapon', label: t.channelWeapon || 'weapon' },
    { value: 'lightcone', label: t.channelLightcone || 'lightcone' },
    { value: 'engine', label: t.channelEngine || 'engine' },
    { value: 'jilu', label: t.channelJilu || 'jilu' }
  ]
})

const filtered = computed(() => {
  const keyword = (state.keyword || '').trim().toLowerCase()
  return state.rows.filter((row) => {
    if (state.channel && row.channel !== state.channel) return false
    if (!keyword) return true
    const haystack = [
      row.version, row.phase, row.title, row.channel,
      ...(row.up || []), ...(row.candidates || [])
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

const channelName = (channel) => {
  const map = {
    character: text.value.channelCharacter,
    weapon: text.value.channelWeapon,
    lightcone: text.value.channelLightcone,
    engine: text.value.channelEngine,
    jilu: text.value.channelJilu
  }
  return map[channel] || channel
}

const sourceName = (source) => {
  const map = {
    builtin: text.value.sourceBuiltin,
    local: text.value.sourceLocal,
    manual: text.value.sourceManual,
    remote: text.value.sourceRemote
  }
  return map[source] || source
}

const formatTime = (t) => {
  if (!t) return '-'
  const d = new Date(t)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString()
}

const setMessage = (msg, failed = false) => {
  state.message = msg
  state.failed = failed
}

const loadTable = async () => {
  const data = await ipcRenderer.invoke('GET_BANNER_TABLE', currentGame.value)
  state.rows = data?.banners || []
}

const loadConfig = async () => {
  const data = await ipcRenderer.invoke('GET_BANNER_SOURCE_CONFIG')
  if (data) Object.assign(sourceForm, data)
}

const saveConfig = async () => {
  await ipcRenderer.invoke('SAVE_BANNER_SOURCE_CONFIG', {
    url: sourceForm.url,
    interval: sourceForm.interval,
    timeout: sourceForm.timeout,
    retry: sourceForm.retry,
    autoSync: sourceForm.autoSync
  })
}

const doSync = async () => {
  state.syncing = true
  setMessage('')
  try {
    await saveConfig()
    const result = await ipcRenderer.invoke('SYNC_BANNERS', currentGame.value)
    if (result?.action === 'failed') {
      setMessage(result.message || text.value.syncFailed, true)
    } else {
      setMessage(result?.message || text.value.syncSuccess)
    }
    await loadTable()
    await loadConfig()
  } catch (e) {
    setMessage(`${text.value.syncFailed}: ${e.message}`, true)
  } finally {
    state.syncing = false
  }
}

const doClearRemote = async () => {
  state.working = true
  try {
    const result = await ipcRenderer.invoke('CLEAR_REMOTE_BANNERS', currentGame.value)
    setMessage(`${text.value.cleared} (${result?.removed ?? 0})`)
    await loadTable()
  } catch (e) {
    setMessage(`${text.value.clearFailed}: ${e.message}`, true)
  } finally {
    state.working = false
  }
}

const doImport = async () => {
  state.working = true
  try {
    const result = await ipcRenderer.invoke('IMPORT_BANNER_JSON', currentGame.value)
    if (result?.canceled) {
      setMessage('')
    } else if (result?.ok) {
      setMessage(`${text.value.imported}: ${result.imported}${result.invalid ? ` (${result.invalid} ${text.value.invalidItems})` : ''}`)
      await loadTable()
    } else {
      setMessage(`${text.value.importFailed}: ${result?.error || ''}`, true)
    }
  } catch (e) {
    setMessage(`${text.value.importFailed}: ${e.message}`, true)
  } finally {
    state.working = false
  }
}

const openEdit = (row) => {
  Object.assign(editRow, {
    channel: row.channel,
    start: row.start,
    end: row.end,
    version: row.version,
    phase: row.phase,
    title: row.title,
    up4: row.up4 || []
  })
  editForm.up = (row.up || []).join('、')
  state.editVisible = true
}

const doSaveUp = async () => {
  const up = editForm.up
    .split(/[,，、\n;；]/)
    .map((x) => x.trim())
    .filter(Boolean)
  state.working = true
  let result
  try {
    // 主进程签名是 (gameId, edit)，两个参数都要传
    result = await ipcRenderer.invoke('SAVE_BANNER_UP', currentGame.value, {
      channel: editRow.channel,
      start: editRow.start,
      end: editRow.end,
      version: editRow.version,
      phase: editRow.phase,
      title: editRow.title,
      up4: editRow.up4,
      up
    })
  } catch (e) {
    setMessage(`${text.value.saveFailed}: ${e.message}`, true)
    state.working = false
    return
  }
  if (result?.ok) {
    state.editVisible = false
    setMessage(text.value.saved)
    await loadTable()
  } else {
    setMessage(`${text.value.saveFailed}: ${result?.error || ''}`, true)
  }
  state.working = false
}

onMounted(async () => {
  await loadConfig()
  await loadTable()
})
</script>
