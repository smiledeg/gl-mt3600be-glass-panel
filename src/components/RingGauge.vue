<script setup lang="ts">
import { computed } from 'vue'

/** 环形进度：用于 CPU / 内存 / 信号等单值指标 */
const props = withDefaults(
  defineProps<{
    value: number
    size?: number
    thickness?: number
    color?: string
    /** 环内大号文字，不传则显示 value% */
    text?: string
    label?: string
    caption?: string
  }>(),
  { size: 132, thickness: 10, color: 'var(--nui-accent)' },
)

const r = computed(() => (props.size - props.thickness) / 2)
const c = computed(() => 2 * Math.PI * r.value)
const dash = computed(() => {
  const v = Math.max(0, Math.min(100, props.value))
  return `${(c.value * v) / 100} ${c.value}`
})
</script>

<template>
  <div class="gauge" :style="{ width: `${size}px` }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        :stroke-width="thickness"
        class="track"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        :stroke="color"
        :stroke-width="thickness"
        stroke-linecap="round"
        :stroke-dasharray="dash"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        class="bar"
      />
    </svg>
    <div class="center">
      <strong>{{ text ?? `${Math.round(value)}%` }}</strong>
      <span v-if="label">{{ label }}</span>
      <em v-if="caption">{{ caption }}</em>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  display: grid;
  place-items: center;
}
svg {
  display: block;
}
.track {
  stroke: var(--line);
}
.bar {
  transition: stroke-dasharray 0.45s ease;
}
.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  pointer-events: none;
}
.center strong {
  font-size: 22px;
  font-weight: 650;
  color: var(--nui-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.center span {
  font-size: 10px;
  color: var(--nui-muted);
}
.center em {
  font-size: 10px;
  font-style: normal;
  color: var(--nui-ok);
}
</style>
