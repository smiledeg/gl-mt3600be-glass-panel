<script setup lang="ts">
import { computed } from 'vue'

/**
 * 轻量折线图：纯 SVG，无第三方图表库（路由器上省体积）。
 * 支持多序列、渐变填充、网格线。
 */
const props = withDefaults(
  defineProps<{
    series: number[][]
    colors?: string[]
    height?: number
    fill?: boolean
    grid?: boolean
    /** 固定上限，不传则按数据自适应 */
    max?: number
    capacity?: number
  }>(),
  {
    colors: () => ['#2080f0', '#18a058'],
    height: 120,
    fill: true,
    grid: true,
    capacity: 0,
  },
)

const W = 600
const H = computed(() => props.height)
const PAD = 2

const peak = computed(() => {
  const all = props.series.flat().filter((n) => isFinite(n))
  const m = props.max ?? Math.max(...all, 1)
  return m * 1.12 || 1
})

function pathFor(input: number[], close: boolean): string {
  // 只有一个采样点时画成水平线，避免首屏空白
  const data = input.length === 1 ? [input[0], input[0]] : input
  if (!data.length) return ''
  const n = Math.max(data.length, 2)
  const step = (W - PAD * 2) / (n - 1)
  const y = (v: number) => PAD + (H.value - PAD * 2) * (1 - Math.min(v / peak.value, 1))
  const pts = data.map((v, i) => `${(PAD + i * step).toFixed(1)},${y(v).toFixed(1)}`)
  if (!close) return `M${pts.join('L')}`
  return `M${PAD},${H.value}L${pts.join('L')}L${PAD + (data.length - 1) * step},${H.value}Z`
}

const linePaths = computed(() => props.series.map((s) => pathFor(s, false)))
const areaPaths = computed(() => props.series.map((s) => pathFor(s, true)))
</script>

<template>
  <svg class="spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" :style="{ height: `${H}px` }">
    <defs>
      <linearGradient v-for="(c, i) in colors" :id="`sg-${i}`" :key="i" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="c" stop-opacity="0.22" />
        <stop offset="100%" :stop-color="c" stop-opacity="0" />
      </linearGradient>
    </defs>

    <g v-if="grid" class="grid">
      <line v-for="i in 4" :key="i" x1="0" :x2="W" :y1="(H / 4) * (i - 1)" :y2="(H / 4) * (i - 1)" />
    </g>

    <template v-if="fill">
      <path v-for="(p, i) in areaPaths" :key="`a${i}`" :d="p" :fill="`url(#sg-${i % colors.length})`" />
    </template>

    <path
      v-for="(p, i) in linePaths"
      :key="`l${i}`"
      :d="p"
      fill="none"
      :stroke="colors[i % colors.length]"
      stroke-width="1.8"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.spark {
  width: 100%;
  display: block;
  overflow: visible;
}
.grid line {
  stroke: currentColor;
  stroke-opacity: 0.07;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
</style>
