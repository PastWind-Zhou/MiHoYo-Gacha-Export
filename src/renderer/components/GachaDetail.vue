<template>
  <p class="text-gray-500 text-xs mb-2 text-center whitespace-nowrap">
    <span class="mx-2" :title="formatDate(detail.date[0])">{{formatDate(detail.date[0], true)}}</span>
    -
    <span class="mx-2" :title="formatDate(detail.date[1])">{{formatDate(detail.date[1], true)}}</span>
  </p>
  <p class="text-gray-600 text-xs mb-1">
    <span class="mr-1">{{text.total}}
      <span class="text-blue-600">{{detail.total}}</span> {{text.times}}
    </span>
    <span v-if="type !== '100'">{{text.sum}}<span class="mx-1 text-green-600">{{detail.countMio}}</span>{{text.no5star}}</span>
  </p>
  <p class="text-gray-600 text-xs mb-1">
    <span :title="`${text.character}${colon}${detail.count5c}\n${text.weapon}${colon}${detail.count5w}${bangText('5')}`" class="mr-3 whitespace-pre cursor-help text-yellow-500">
      <span class="min-w-10 inline-block">{{text.star5}}{{colon}}{{detail.count5}}</span>
      [{{percent(detail.count5, detail.total)}}]
    </span>
    <br><span :title="`${text.character}${colon}${detail.count4c}\n${text.weapon}${colon}${detail.count4w}${bangText('4')}`" class="mr-3 whitespace-pre cursor-help text-purple-600">
      <span class="min-w-10 inline-block">{{text.star4}}{{colon}}{{detail.count4}}</span>
      [{{percent(detail.count4, detail.total)}}]
    </span>
    <br><span :title="`${text.weapon}${colon}${detail.count3w}${bangText('3')}`" class="text-blue-500 whitespace-pre">
      <span class="min-w-10 inline-block">{{text.star3}}{{colon}}{{detail.count3}}</span>
      [{{percent(detail.count3, detail.total)}}]
    </span>
  </p>

  <p class="text-gray-600 text-xs mb-1" v-if="detail.ssrPos.length">
    {{text.history}}{{colon}}
    <span :title="`${item[2]}${item[3] === '400' ? '\n' + wish2Text : ''}`" :class="{wish2: item[3] === '400'}" class="cursor-help mr-1" :style="`color:${colorList[index]}`"
      v-for="(item, index) of detail.ssrPos" :key="item"
    >
      {{item[0]}}[{{item[1]}}]
    </span>
  </p>
  <p v-if="detail.ssrPos.length" class="text-gray-600 text-xs">{{text.average}}{{colon}}<span class="text-green-600">{{avg5(detail.ssrPos)}}</span></p>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: Object,
  typeMap: Map,
  i18n: Object,
  gameInfo: Object
})

const type = computed(() => props.data[0])
const detail = computed(() => props.data[1])
// i18n 未加载完成时 props.i18n 可能为 null，
// 直接 props.i18n.ui.data 会抛错并中断整个页面渲染
const text = computed(() => props.i18n?.ui?.data || {})
const colon = computed(() => props.i18n?.symbol?.colon || ':')
// 「跃迁2」提示文案（仅原神 400 池用）
const wish2Text = computed(() => props.i18n?.excel?.wish2 || '')

// 时间戳无效时（0 或 NaN）显示 '-'，避免渲染成 1970/1/1
const formatDate = (ts, dateOnly = false) => {
  const num = Number(ts)
  if (!Number.isFinite(num) || num <= 0) return '-'
  const d = new Date(num)
  if (isNaN(d.getTime())) return '-'
  return dateOnly ? d.toLocaleDateString() : d.toLocaleString()
}

// 绝区零有邦布分类，标题里追加邦布数量
const bangText = (level) => {
  if (!props.gameInfo || !props.gameInfo.bangboo) return ''
  const count = level === '5' ? detail.value.count5b : level === '4' ? detail.value.count4b : detail.value.count3b
  if (!count) return ''
  return `\n${text.value.bang}${colon.value}${count}`
}

const avg5 = (list) => {
  let n = 0
  list.forEach(item => {
    n += item[1]
  })
  return parseInt((n / list.length) * 100) / 100
}

const percent = (num, total) => {
  return `${Math.round(num / total * 10000) / 100}%`
}

const colors = [
  '#5470c6', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#2ab7ca',
  '#005b96', '#ff8b94', '#72a007','#b60d1b', '#16570d'
]

const colorList = computed(() => {
  let colorsTemp = [...colors]
  const result = []
  const map = new Map()
  props.data[1].ssrPos.forEach(item => {
    if (map.has(item[0])) {
      return result.push(map.get(item[0]))
    }
    const num = Math.abs(hashCode(`${Math.floor(Date.now() / (1000 * 60 * 10))}-${item[0]}`))
    if (!colorsTemp.length) colorsTemp = [...colors]
    const color = colorsTemp.splice(num % colorsTemp.length, 1)[0]
    map.set(item[0], color)
    result.push(color)
  })
  return result
})

function hashCode(str) {
  return Array.from(str)
    .reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0)
}
</script>
