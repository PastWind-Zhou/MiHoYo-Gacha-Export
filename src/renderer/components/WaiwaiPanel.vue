<template>
  <div>
    <p v-if="!pools.length" class="text-gray-500 text-xs text-center py-8">{{text.noData}}</p>
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <div v-for="pool of pools" :key="pool.poolKey"
        class="border border-gray-200 rounded-lg p-3 bg-white"
        :class="{ 'opacity-60': pool.excluded }">
        <p class="text-center text-gray-600 my-1 font-medium">{{pool.name}}</p>

        <div class="grid grid-cols-2 gap-y-1 text-xs text-gray-600">
          <span>{{text.noDeviation}}</span>
          <span class="text-right">
            <span class="text-blue-600">{{percent(pool.stats.noDeviationRate)}}</span>
            <span class="text-gray-400">({{pool.stats.noDeviationCount}}/{{pool.stats.upCount}})</span>
          </span>

          <span>{{text.avgUp}}</span>
          <span class="text-right text-green-600">{{pool.stats.avgUpPulls}} {{text.pulls}}</span>

          <span>{{text.avgTop}}</span>
          <span class="text-right text-green-600">{{pool.stats.avgTopPulls}} {{text.pulls}}</span>

          <span>{{text.luckiest}} / {{text.unluckiest}}</span>
          <span class="text-right">{{pool.stats.minTopPulls}} / {{pool.stats.maxTopPulls}}</span>

          <span>{{text.upHitRate}}</span>
          <span class="text-right text-yellow-500">{{percent(pool.stats.upHitRate)}}</span>

          <span>{{text.guaranteed}}</span>
          <span class="text-right">{{pool.stats.guaranteedCount}}</span>
        </div>

        <p v-if="dist(pool).length" class="text-xs text-gray-600 mt-2">
          {{text.deviationDist}}{{colon}}
          <span v-for="item of dist(pool)" :key="item.n" class="ml-2">{{deviationItem(item.n)}}:{{item.count}}</span>
        </p>

        <p v-if="pool.stats.unknownCount" class="text-xs text-orange-500 mt-1">
          {{pool.stats.unknownCount}} {{text.unknown}}
        </p>
        <p v-if="pool.excluded" class="text-xs text-gray-400 mt-1">{{text.excluded}}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  stats: Object,
  i18n: Object
})

const text = computed(() => props.i18n?.ui?.waiwai || {})
const colon = computed(() => props.i18n?.symbol?.colon || ':')
const pools = computed(() => (props.stats?.pools || []))

const percent = (value) => {
  const num = Number(value || 0)
  return `${Math.round(num * 10000) / 100}%`
}

// 连续歪的次数分布：[{'1': 次数}, ...] → [{ n, count }]
const dist = (pool) => {
  const map = pool?.stats?.deviationHistogram || {}
  return Object.keys(map)
    .map((n) => ({ n: Number(n), count: map[n] }))
    .sort((a, b) => a.n - b.n)
}

// 「歪{n}次」模板
const deviationItem = (n) => {
  const template = text.value.deviationItem || '歪{n}次'
  return template.replace('{n}', n)
}
</script>
