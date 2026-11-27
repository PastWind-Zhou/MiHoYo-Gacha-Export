<template>
  <div>
    <div class="flex flex-wrap gap-2 justify-between items-center mb-2">
      <!-- 基础统计：抽数、星级分布、按池归一的抽数 -->
      <div v-if="records.length" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>{{dataText.total}} <span class="text-blue-600">{{records.length}}</span> {{dataText.times}}</span>
        <span class="whitespace-nowrap text-yellow-500">
          <span class="min-w-10 inline-block">{{dataText.star5}}{{colon}}</span>{{count5}} [{{percent(count5)}}]
        </span>
        <span class="whitespace-nowrap text-purple-600">
          <span class="min-w-10 inline-block">{{dataText.star4}}{{colon}}</span>{{count4}} [{{percent(count4)}}]
        </span>
        <span v-if="count3" class="whitespace-nowrap text-blue-500">
          <span class="min-w-10 inline-block">{{dataText.star3}}{{colon}}</span>{{count3}}
        </span>
        <span v-for="pool of poolStats" :key="pool.name" class="whitespace-nowrap text-gray-500">
          {{pool.name}}{{colon}}{{pool.count}} {{dataText.times}}
        </span>
      </div>
      <p v-else-if="status === 'loading'" class="text-xs text-gray-400">Loading...</p>
      <p v-else-if="status === 'failed'" class="text-xs text-red-500">{{text.loadFailed}}<span v-if="log">{{colon}}{{log}}</span></p>
      <p v-else-if="status === 'init'" class="text-xs text-gray-400">{{text.hint}}</p>
      <p v-else class="text-xs text-gray-400">{{text.noData}}</p>
      <div class="flex gap-2">
        <el-button size="small" plain icon="refresh" :disabled="status === 'loading'" @click="emit('refresh')">{{button.ugcRefresh}}</el-button>
        <el-button size="small" plain type="primary" icon="download" :loading="status === 'loading'" @click="emit('fetch')">{{button.ugcUpdate}}</el-button>
      </div>
    </div>
    <el-table v-if="records.length" :data="records" border stripe size="small" max-height="520">
      <el-table-column property="time" :label="text.time" width="150" />
      <el-table-column property="item_name" :label="text.name" min-width="140" />
      <el-table-column property="item_type" :label="text.type" width="90" />
      <el-table-column :label="text.rank" width="70">
        <template #default="scope">
          <span :class="rankClass(scope.row.rank_type)">{{scope.row.rank_type}}</span>
        </template>
      </el-table-column>
      <el-table-column :label="text.pool" width="150">
        <template #default="scope">
          {{poolName(scope.row.op_gacha_type)}}
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 主进程返回的 data：账号对象 { uid, timezone, lang, list } 或裸记录数组
  data: Object,
  // 'init' | 'loading' | 'loaded' | 'failed'
  status: String,
  // 失败时的错误文本
  log: String,
  i18n: Object
})

const emit = defineEmits(['refresh', 'fetch'])

// i18n 未加载完成时 props.i18n 可能为 null，
// 直接 props.i18n.ui.xxx 会抛错并中断整个页面渲染
const text = computed(() => props.i18n?.ui?.ugc || {})
const button = computed(() => props.i18n?.ui?.button || {})
// 抽数/星级文案复用 ui.data.*（该键族在基线语言中已存在）
const dataText = computed(() => props.i18n?.ui?.data || {})
const colon = computed(() => props.i18n?.symbol?.colon || ':')

// 兼容两种返回形态：账号对象 / 裸记录数组；按时间倒序展示最新在前。
// 记录字段与 normalizeUGCAccount 落盘结构一致：
//   { id, schedule_id, item_type, item_id, item_name, rank_type, time, op_gacha_type }
const records = computed(() => {
  const data = props.data
  if (!data) return []
  const list = Array.isArray(data) ? data : (Array.isArray(data.list) ? data.list : [])
  return list
    .filter(rec => rec && typeof rec === 'object' && rec.time)
    .slice()
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
})

const countOf = (rank) => records.value.filter(rec => String(rec.rank_type) === rank).length
const count5 = computed(() => countOf('5'))
const count4 = computed(() => countOf('4'))
const count3 = computed(() => countOf('3'))

const percent = (num) => {
  const total = records.length
  if (!total) return '0%'
  return `${Math.round(num / total * 10000) / 100}%`
}

// 20011/20012/20021/20022 是 2000 池的细分类型（无公开排期数据），
// 统计与展示统一归一到 2000；无法识别的类型显示原始代号
const poolKeyOf = (op) => {
  const t = String(op ?? '')
  if (t === '1000' || t === '2000') return t
  if (/^200(1|2)[12]$/.test(t)) return '2000'
  return ''
}

const poolName = (op) => {
  const key = poolKeyOf(op)
  if (key) return text.value[`type${key}`] || key
  return `${text.value.poolUnknown || 'Unknown pool'}(${op})`
}

const poolStats = computed(() => {
  const map = new Map()
  for (const rec of records.value) {
    const key = poolKeyOf(rec.op_gacha_type)
    if (!key) continue
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => ({
    name: text.value[`type${key}`] || key,
    count
  }))
})

// 星级配色与 GachaDetail 一致：5 黄 / 4 紫 / 3 蓝
const rankClass = (rank) => {
  const t = String(rank)
  if (t === '5') return 'text-yellow-500'
  if (t === '4') return 'text-purple-600'
  if (t === '3') return 'text-blue-500'
  return ''
}
</script>
