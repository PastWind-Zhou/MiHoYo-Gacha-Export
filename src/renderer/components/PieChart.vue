<template>
  <div class="chart mb-2 relative h-48 lg:h-56 xl:h-64 2xl:h-72">
    <div ref="chart" class="absolute inset-0"></div>
  </div>
</template>

<script setup>
import { reactive, computed, ref, onMounted, onUpdated, onUnmounted } from "vue";
import { use, init } from "echarts/core";
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { PieChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import throttle from "lodash-es/throttle";
import { canResize } from '@renderer/chartResize.cjs';

use([
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  PieChart,
  CanvasRenderer,
]);

const props = defineProps({
  data: Object,
  typeMap: Map,
  i18n: Object,
  gameInfo: Object,
});

const chart = ref(null);

// ECharts 内置了对容器的 ResizeObserver：
// 容器从 display:none 恢复显示时，它会在尺寸仍为 0 的瞬间把 canvas 缩成 0×0
// 并清空内容；之后容器尺寸不再变化，于是没有人来补救 —— 图表就一直空白。
// 这里自己观察容器尺寸，一旦恢复为可见尺寸就重新 resize。
let resizeObserver = null;

// 绝区零有邦布分类，图例与配色与原版绝区零工具一致
const hasBangboo = () => !!(props.gameInfo && props.gameInfo.bangboo);

const colors = ["#fac858", "#ee6666", "#5470c6", "#91cc75", "#73c0de"];
const bangColors = ["#fac858", "#fac858", "#ee6666", "#5470c6", "#5470c6", "#91cc75", "#73c0de"];

const parseData = (detail, type) => {
  // i18n 未加载完成时 props.i18n 可能为 null，直接访问会抛错并中断渲染
  const text = props.i18n?.ui?.data || {};
  // 最低档（星铁/原神 3 星、绝区零 B 级）不参与饼图统计
  const keys = hasBangboo()
    ? [
        [text.bang5, "count5b"],
        [text.chara5, "count5c"],
        [text.weapon5, "count5w"],
        [text.chara4, "count4c"],
        [text.bang4, "count4b"],
        [text.weapon4, "count4w"]
      ]
    : [
        [text.chara5, "count5c"],
        [text.weapon5, "count5w"],
        [text.chara4, "count4c"],
        [text.weapon4, "count4w"]
      ];
  const palette = hasBangboo() ? bangColors : colors;
  const result = [];
  const color = [];
  const selected = {};
  keys.forEach((key, index) => {
    if (!detail[key[1]]) return;
    result.push({
      value: detail[key[1]],
      name: key[0],
    });
    color.push(palette[index]);
  });
  return [result, color, selected];
};

let pieChart = null;
const updateChart = throttle(() => {
  if (!pieChart) {
    pieChart = init(chart.value);
  }

  const colon = props.i18n?.symbol?.colon || ':';
  const result = parseData(props.data[1], props.data[0]);

  const option = {
    tooltip: {
      trigger: "item",
      formatter: `{b0}${colon}{c0}`,
      padding: 4,
      textStyle: {
        fontSize: 12,
      },
    },
    legend: {
      top: "2%",
      left: "center",
      selected: result[2],
    },
    selectedMode: "single",
    color: result[1],
    series: [
      {
        name: props.typeMap.get(props.data[0]),
        type: "pie",
        top: 50,
        startAngle: 70,
        radius: ["0%", "90%"],
        // avoidLabelOverlap: false,
        labelLine: {
          length: 0,
          length2: 10,
        },
        label: {
          overflow: "break",
        },
        data: result[0],
      },
    ],
  };

  pieChart.setOption(option);
  // 容器不可见时不要 resize：此时 ECharts 会把 canvas 缩成 0×0 并清空内容，
  // 反而弄巧成拙。恢复可见后由 ResizeObserver 补做 resize。
  if (canResize(pieChart, chart.value)) {
    pieChart.resize();
  }
}, 1000);

onUpdated(() => {
  updateChart();
});

onMounted(() => {
  updateChart();
  window.addEventListener("resize", updateChart);

  // 监听容器尺寸：隐藏→显示 时 ECharts 已把 canvas 清空，这里补一次 resize。
  // 用 requestAnimationFrame 打断，避免与 ECharts 内部的观察器形成回调循环。
  if (typeof ResizeObserver !== "undefined" && chart.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!canResize(pieChart, chart.value)) return;
      requestAnimationFrame(() => {
        if (canResize(pieChart, chart.value)) {
          pieChart.resize();
        }
      });
    });
    resizeObserver.observe(chart.value);
  }
});

// 卸载时必须移除监听并释放 ECharts 实例：
// 否则切换游戏/账号时实例会不断累积，且 throttle 的尾部调用
// 可能在卸载后访问已失效的组件状态
onUnmounted(() => {
  window.removeEventListener("resize", updateChart);
  updateChart.cancel();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (pieChart) {
    pieChart.dispose();
    pieChart = null;
  }
});
</script>
