<script setup lang="ts">
import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui'

/**
 * 页面数据状态统一壳：加载中 / 加载失败（可重试）/ 空数据（明确说明为什么空）。
 * 用法：
 *   <PageState :loading="loading" :error="error" :empty="!data" empty-text="当前固件不支持该功能" @retry="reload">
 *     ... 正常内容 ...
 *   </PageState>
 */
withDefaults(
  defineProps<{
    loading?: boolean
    error?: string
    empty?: boolean
    emptyText?: string
    /** 紧凑模式（卡片内使用） */
    compact?: boolean
  }>(),
  { loading: false, error: '', empty: false, emptyText: '暂无数据', compact: false },
)

defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <div class="page-state" :class="{ compact }">
    <div v-if="loading" class="center">
      <n-spin size="small" />
      <span class="tip">正在读取设备…</span>
    </div>
    <n-alert v-else-if="error" type="warning" :bordered="false" class="alert">
      <div class="err-row">
        <span>{{ error }}</span>
        <n-button size="tiny" quaternary type="primary" @click="$emit('retry')">重试</n-button>
      </div>
    </n-alert>
    <n-empty v-else-if="empty" :description="emptyText" size="small" class="empty" />
    <div v-else class="ps-body"><slot /></div>
  </div>
</template>

<style scoped>
.center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 0;
}
.compact .center {
  padding: 18px 0;
}
.tip {
  font-size: 12px;
  opacity: 0.5;
}
.alert {
  margin: 4px 0;
}
.err-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.empty {
  padding: 26px 0;
}
.ps-body {
  animation: ps-body-in 0.34s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
@keyframes ps-body-in {
  from { opacity: 0; transform: translateY(-9px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ps-body { animation: none; }
}
.compact .empty {
  padding: 12px 0;
}
</style>
