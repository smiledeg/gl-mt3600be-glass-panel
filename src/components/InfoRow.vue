<script setup lang="ts">
/** 键值行：左侧灰色标签，右侧值（可含副标题 / 徽标） */
defineProps<{ label: string; value?: string | number | null; sub?: string; mono?: boolean }>()
</script>

<template>
  <div class="kv">
    <span class="k">{{ label }}</span>
    <span class="v" :class="{ mono }">
      <slot>{{ value ?? '—' }}</slot>
      <em v-if="sub">{{ sub }}</em>
    </span>
  </div>
</template>

<style scoped>
.v em {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: var(--nui-muted);
  font-weight: 400;
}
</style>
