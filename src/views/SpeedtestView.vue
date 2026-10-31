<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NIcon, NTab, NTabs } from 'naive-ui'
import { OpenOutline } from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'wan', label: '外网测速' },
  { key: 'web', label: '网页性能' },
  { key: 'video', label: '视频测速' },
  { key: 'lan', label: '局域网测速' },
]
const tab = computed(() => String(route.query.tab || 'wan'))
function goTab(t: string) {
  router.replace({ path: '/network/speedtest', query: { tab: t } })
}

const frameSrc = computed(() => `/nui/#/network/speedtest?tab=${tab.value}`)
const available = ref<boolean | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const r = await fetch('/nui/index.html', { method: 'HEAD' })
    available.value = r.ok
  } catch {
    available.value = false
  }
  loading.value = false
})
</script>

<template>
  <div class="nui-page">
    <PanelCard>
      <template #extra>
        <a :href="frameSrc" target="_blank" class="ext">
          <n-icon :size="13"><OpenOutline /></n-icon>
          新窗口打开
        </a>
      </template>

      <n-tabs :value="tab" type="line" animated @update:value="goTab">
        <n-tab v-for="t in TABS" :key="t.key" :name="t.key">{{ t.label }}</n-tab>
      </n-tabs>

      <div v-if="loading" class="placeholder">正在载入原版测速页…</div>

      <div v-else-if="available === false" class="placeholder">
        <div class="ph-title">未检测到 NUI 原版页面</div>
        <div class="ph-sub">
          需要先安装移植包 <span class="nui-mono">gl-nui-speed</span>（把 <span class="nui-mono">/www/nui</span>
          与 LuCI 后端一起装进来），装好后本页将直接内嵌原版测速界面。
        </div>
      </div>

      <iframe v-else :src="frameSrc" class="frame" title="NUI 测速" />
    </PanelCard>
  </div>
</template>

<style scoped>
.ext {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--nui-accent);
}
.frame {
  width: 100%;
  height: calc(100vh - 230px);
  min-height: 620px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  margin-top: 8px;
}
.placeholder {
  padding: 60px 20px;
  text-align: center;
  font-size: 12.5px;
  opacity: 0.6;
}
.ph-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  opacity: 1;
}
.ph-sub {
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.8;
}
</style>
