<script setup lang="ts">
import { computed } from 'vue'

/**
 * NUI 风格的圆弧仪表盘（不是完整圆）：135° 起、顺时针 270° 扫过，底部留缺口。
 * 支持平滑数值（传 display 值即可）、末端圆点、量程标签。
 */
const props = withDefaults(
  defineProps<{
    value: number
    /** 量程上限，不传则自动取一个好看的刻度 */
    max?: number
    label?: string
    unit?: string
    color?: string
    size?: number
  }>(),
  {
    value: 0,
    max: 0,
    label: '下载',
    unit: 'Mbps',
    color: '#f472b6',
    size: 190,
  },
)

const R = 78
const CX = 100
const CY = 100
const START = 135
const SWEEP = 270

function pt(angle: number, r = R) {
  const rad = (angle * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

function arcPath(from: number, to: number) {
  const a = pt(from)
  const b = pt(to)
  const large = Math.abs(to - from) > 180 ? 1 : 0
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

const track = computed(() => arcPath(START, START + SWEEP))
const maxValue = computed(() => {
  if (props.max > 0) return props.max
  const steps = [10, 20, 50, 100, 150, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000]
  const need = Math.max(1, Number(props.value) || 0) * 1.2
  return steps.find((s) => s >= need) ?? Math.ceil(need / 1000) * 1000
})
const frac = computed(() => Math.max(0, Math.min(1, (Number(props.value) || 0) / maxValue.value)))
const progress = computed(() => arcPath(START, START + Math.max(0.5, frac.value * SWEEP)))
const endDot = computed(() => pt(START + frac.value * SWEEP))
const startDot = computed(() => pt(START, R - 0))
const shown = computed(() => {
  const v = Number(props.value) || 0
  if (v <= 0.05) return '--'
  return v.toFixed(v >= 100 ? 0 : 1)
})
</script>

<template>
  <div class="gauge-arc" :style="{ width: `${size}px`, height: `${Math.round(size * 0.86)}px` }">
    <svg viewBox="0 0 200 186" :width="size" :height="Math.round(size * 0.86)">
      <path :d="track" fill="none" stroke="rgba(128,128,128,.18)" stroke-width="12" stroke-linecap="round" />
      <path :d="progress" fill="none" :stroke="color" stroke-width="12" stroke-linecap="round" />
      <circle :cx="startDot.x" :cy="startDot.y" r="4" :fill="color" opacity="0.85" />
      <circle :cx="endDot.x" :cy="endDot.y" r="6" :fill="color" stroke="rgba(0,0,0,.35)" stroke-width="1.5" />
    </svg>
    <div class="g-center">
      <div class="g-label">{{ label }}</div>
      <div class="g-value">{{ shown }}</div>
      <div class="g-unit">{{ unit }}</div>
    </div>
    <div class="g-scale">{{ maxValue }} {{ unit }}</div>
  </div>
</template>

<style scoped>
.gauge-arc {
  position: relative;
  display: flex;
  justify-content: center;
}
.g-center {
  position: absolute;
  top: 30%;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
}
.g-label {
  font-size: 12px;
  opacity: 0.7;
}
.g-value {
  font-size: 34px;
  font-weight: 650;
  letter-spacing: -1px;
  line-height: 1.08;
  font-variant-numeric: tabular-nums;
}
.g-unit {
  font-size: 12px;
  opacity: 0.7;
}
.g-scale {
  position: absolute;
  right: 8px;
  bottom: 2px;
  font-size: 10px;
  opacity: 0.45;
  white-space: nowrap;
}
</style>
