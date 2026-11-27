<template>
  <div>
    <!-- 全部池被排除时 visiblePools 为空：有数据（都在 hiddenPools 里），
         不能误报“暂无数据”，被隐藏说明必须在 v-else 之外渲染 -->
    <p v-if="!visiblePools.length && !hiddenPools.length" class="text-gray-500 text-xs text-center py-8">{{text.noData}}</p>
    <div v-else-if="visiblePools.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <div v-for="pool of visiblePools" :key="pool.poolKey"
        class="border-2 border-gray-300 rounded-lg p-3 bg-white">
        <p class="text-center text-gray-700 my-1 font-medium">{{pool.name}}</p>

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
          <span class="text-right">{{pool.stats.minTopPulls ?? '-'}} / {{pool.stats.maxTopPulls ?? '-'}}</span>

          <span>{{text.upHitRate}}</span>
          <span class="text-right text-yellow-500">{{percent(pool.stats.upHitRate)}}</span>

          <span>{{text.guaranteed}}</span>
          <span class="text-right">{{pool.stats.guaranteedCount}}</span>

          <span>{{text.maxDeviation}}</span>
          <span class="text-right text-purple-600">{{pool.stats.maxDeviationStreak ?? 0}} {{text.times}}</span>

          <span>{{text.currentDeviation}}</span>
          <span class="text-right text-purple-600">{{pool.stats.currentDeviationStreak ?? 0}} {{text.times}}</span>
        </div>

        <!-- 歪次数分布：连续歪的 5 星个数 -->
        <p v-if="dist(pool).length" class="text-xs text-gray-600 mt-2">
          {{text.deviationDist}}{{colon}}
          <span v-for="item of dist(pool)" :key="item.n" class="ml-2">{{deviationItem(item.n)}}:{{item.count}}</span>
        </p>

        <!-- 连歪次数分布：歪 / 不歪严格交替的段里累计了几个歪 -->
        <div v-if="streakDist(pool).length" class="text-xs text-gray-600 mt-2">
          <p class="mb-1">{{text.streakDist}}{{colon}}</p>
          <div v-for="item of streakDist(pool)" :key="item.n" class="flex items-center gap-2 mb-0.5">
            <span class="w-14 shrink-0 text-gray-500">{{streakItem(item.n)}}</span>
            <span class="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
              <span class="block h-full bg-purple-400" :style="{ width: barWidth(item) }"></span>
            </span>
            <span class="w-10 shrink-0 text-right">{{item.count}}</span>
            <span class="w-10 shrink-0 text-right text-gray-400">{{percent(item.ratio)}}</span>
          </div>
        </div>

        <p v-if="pool.stats.unknownCount" class="text-xs text-orange-500 mt-1">
          {{pool.stats.unknownCount}} {{text.unknown}}
        </p>
      </div>
    </div>

    <!-- 被隐藏的池（不参与歪率统计）：说明去向，避免用户以为数据丢了。
         放在 v-else 分支之外：全部池被排除时（visiblePools 为空）也要渲染 -->
    <p v-if="hiddenPools.length" class="text-xs text-gray-400 mt-3 text-center">
      {{text.excludedHidden}}
    </p>
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

// 不参与歪率统计的池不展示（没有 UP 概念：常驻/新手/邦布池）
const visiblePools = computed(() => (props.stats?.pools || []).filter((p) => !p.excluded))
const hiddenPools = computed(() => (props.stats?.pools || []).filter((p) => p.excluded))

const percent = (value) => {
  const num = Number(value || 0)
  return `${Math.round(num * 10000) / 100}%`
}

// 连续歪的次数分布：[{'1': 次数}, ...] → [{ n, count }]
// 预先算好并按 poolKey 缓存，避免模板里重复计算
const distMap = computed(() => {
  const map = {}
  for (const pool of props.stats?.pools || []) {
    const hist = pool?.stats?.deviationHistogram || {}
    map[pool.poolKey] = Object.keys(hist)
      .map((n) => ({ n: Number(n), count: hist[n] }))
      .sort((a, b) => a.n - b.n)
  }
  return map
})
const dist = (pool) => distMap.value[pool?.poolKey] || []

// 连歪次数分布：[{'2': 段数}, ...] → [{ n, count, ratio }]
// ratio = 该段数占全部连歪段的比例，用于条形图旁的百分比
const streakDistMap = computed(() => {
  const map = {}
  for (const pool of props.stats?.pools || []) {
    const hist = pool?.stats?.deviationStreakHistogram || {}
    const items = Object.keys(hist)
      .map((n) => ({ n: Number(n), count: hist[n] }))
      .sort((a, b) => a.n - b.n)
    const total = items.reduce((s, item) => s + item.count, 0)
    map[pool.poolKey] = items.map((item) => ({ ...item, ratio: total ? item.count / total : 0 }))
  }
  return map
})
const streakDist = (pool) => streakDistMap.value[pool?.poolKey] || []

// 条形图宽度 = 该连歪段占全部连歪段的比例（频率分布）
const barWidth = (item) => `${Math.max(4, Math.round(item.ratio * 100))}%`

// 「歪{n}次」模板
const deviationItem = (n) => {
  const template = text.value.deviationItem || '歪{n}次'
  return template.replace('{n}', n)
}

// 「连歪{n}次」模板
const streakItem = (n) => {
  const template = text.value.streakItem || '连歪{n}次'
  return template.replace('{n}', n)
}
</script>
