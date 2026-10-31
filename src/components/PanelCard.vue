<script setup lang="ts">
import { NCard } from 'naive-ui'

/** 统一卡片：对齐 NUI 的卡头（15px/600 + 右侧动作） */
defineProps<{
  title?: string
  action?: string
  /** 去掉内边距（表格类内容自己控制） */
  flush?: boolean
}>()

defineEmits<{ (e: 'action'): void }>()
</script>

<template>
  <n-card :bordered="true" size="small" :content-style="flush ? 'padding:0 6px 6px' : undefined">
    <template v-if="title || $slots.extra" #header>
      <span class="nui-card-title">
        <slot name="icon" />
        {{ title }}
        <slot name="badge" />
      </span>
    </template>
    <template v-if="$slots.extra || action" #header-extra>
      <slot name="extra">
        <a v-if="action" class="act" @click="$emit('action')">{{ action }}</a>
      </slot>
    </template>
    <slot />
  </n-card>
</template>

<style scoped>
.nui-card-title :deep(.n-icon) {
  color: var(--nui-accent);
  display: inline-flex;
}
.act {
  cursor: pointer;
  font-size: 12px;
  opacity: 0.55;
  border-bottom: 1px dashed rgba(128, 128, 128, 0.45);
  transition: opacity 0.15s;
}
.act:hover {
  opacity: 0.9;
}
</style>
