<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NIcon, NTag } from 'naive-ui'
import { ArrowBackOutline, OpenOutline, RefreshOutline } from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import { pkgApps, type InstalledApp } from '@/api/pkg'
import { useUiStore } from '@/stores/ui'

/**
 * 插件页面（与官方 gl-app-openclash 同机制）：
 *  - OpenClash：顶栏三标签 + 全高 iframe：LuCI 页走同源反代(/cgi-bin/luci)，两个仪表盘直连 :9090；
 *  - 其他插件：单标签 iframe 指向其 LuCI 页（同源反代）。
 *  - 不跳地址栏、不在面板外开新窗口；iframe 加载后注入样式隐藏 LuCI 顶栏/页脚并同步深浅色。
 */
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const pkg = computed(() => String(route.params.pkg || ''))
const app = ref<InstalledApp | null>(null)
const active = ref(0)
const frameKey = ref(0)
const frame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)

const isOpenClash = computed(() => pkg.value === 'luci-app-openclash')
const tabs = computed(() => {
  if (isOpenClash.value) {
    const host = location.hostname
    return [
      { label: 'OpenClash', src: '/cgi-bin/luci/admin/services/openclash/' },
      { label: 'MetaCubeXD', src: `http://${host}:9090/ui/metacubexd/` },
      { label: 'Zashboard', src: `http://${host}:9090/ui/zashboard/` },
    ]
  }
  return [{ label: app.value?.label || pkg.value, src: app.value?.url || '/cgi-bin/luci/' }]
})
const src = computed(() => tabs.value[active.value]?.src || '/cgi-bin/luci/')

function injectFrameChrome() {
  const frm = frame.value
  if (!frm) return
  try {
    const d = frm.contentDocument
    if (!d || !d.head) return
    // 隐藏 LuCI 自己的顶栏/页脚，只保留插件内容（与官方补丁一致）
    if (!d.getElementById('glass-app-chrome')) {
      const st = d.createElement('style')
      st.id = 'glass-app-chrome'
      st.textContent =
        'body>header,#tabmenu,footer,.cbi-page-actions~footer{display:none!important}' +
        'body>.main{top:0!important;padding-top:0!important}' +
        '.main{padding-top:0!important}'
      d.head.appendChild(st)
    }
    d.documentElement.setAttribute('data-darkmode', ui.dark ? 'true' : 'false')
  } catch {
    /* 跨域（:9090 仪表盘）忽略 */
  }
}
function reload() {
  frameKey.value++
}
function back() {
  router.push('/apps/store')
}
function openDash() {
  window.open(src.value, '_blank')
}

onMounted(async () => {
  const apps = await pkgApps()
  app.value = apps.find((a) => a.package === pkg.value) || null
  loading.value = false
})
</script>

<template>
  <div class="app-page">
    <PanelCard :title="app?.label || (isOpenClash ? 'OpenClash' : pkg)">
      <template #extra>
        <div class="nui-row" style="gap: 8px">
          <n-tag v-if="app" size="small" :bordered="false">v{{ app.version }}</n-tag>
          <n-tag size="small" :bordered="false" type="info">面板内</n-tag>
          <n-button size="tiny" secondary @click="reload">
            <template #icon><n-icon><RefreshOutline /></n-icon></template>刷新
          </n-button>
          <n-button size="tiny" quaternary @click="openDash">
            <template #icon><n-icon><OpenOutline /></n-icon></template>新窗口
          </n-button>
          <n-button size="tiny" quaternary @click="back">
            <template #icon><n-icon><ArrowBackOutline /></n-icon></template>返回
          </n-button>
        </div>
      </template>

      <div class="tabs">
        <button v-for="(t, i) in tabs" :key="t.label" class="tab" :class="{ on: i === active }" @click="active = i">
          {{ t.label }}
        </button>
      </div>

      <div class="frame-wrap">
        <iframe
          :key="frameKey + ':' + active"
          ref="frame"
          class="frame"
          :src="src"
          title="plugin"
          allow="clipboard-read; clipboard-write; fullscreen"
          @load="injectFrameChrome"
        />
      </div>
      <p class="nui-small nui-muted" style="margin: 8px 0 0">
        页面以同源方式嵌在面板里（与官方 gl-app-openclash 的做法一致）；LuCI 若未登录，会在框内显示登录页，登录一次即可。
      </p>
    </PanelCard>
  </div>
</template>

<style scoped>
.app-page { display: flex; flex-direction: column; gap: 12px; }
.tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.tab { background: none; border: 0; padding: 8px 14px; font-size: 13px; color: inherit; opacity: 0.6; cursor: pointer; border-bottom: 2px solid transparent; }
.tab.on { opacity: 1; font-weight: 600; border-bottom-color: var(--nui-accent); }
.frame-wrap { border-radius: 10px; overflow: hidden; background: var(--card); }
.frame { width: 100%; height: calc(100vh - 230px); min-height: 520px; border: 0; display: block; }
</style>
