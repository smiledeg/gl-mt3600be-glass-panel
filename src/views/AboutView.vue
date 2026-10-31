<script setup lang="ts">
import { computed, ref } from 'vue'
import { NCard, NButton, NIcon, NTag, NModal } from 'naive-ui'
import { OpenOutline, CubeOutline, LogoGithub } from '@vicons/ionicons5'
import { useDeviceStore } from '@/stores/device'
import { luciEntryUrl } from '@/utils/luci'
import { officialUrl } from '@/utils/official'
import { BUILD_VERSION } from '@/version'
import { CHANGELOG } from '@/data/changelog'

const device = useDeviceStore()
const showChangelog = ref(false)

const model = computed(() => String(device.info?.model ?? 'GL-MT3600BE'))
const firmware = computed(() => String(device.info?.firmware_version ?? '—'))
const open = (u: string) => window.open(u, '_blank')

const entries = [
  { title: '官方 GL 后台', desc: '原厂界面，功能最全、参数最原始', url: officialUrl(), icon: OpenOutline },
  { title: 'LuCI（OpenWrt）', desc: '如果固件启用了 LuCI，从这里进入', url: luciEntryUrl(), icon: CubeOutline },
  { title: 'GitHub 项目', desc: '查看源码 / 提交 Issue / 下载最新构建', url: 'https://github.com/smiledeg/gl-mt3600be-glass-panel', icon: LogoGithub },
]
</script>

<template>
  <div class="about">
    <n-card class="hero">
      <div class="hero-top">
        <div class="logo">
          <svg viewBox="0 0 32 32" width="34" height="34">
            <defs>
              <linearGradient id="ag" x1="0" y1="0" x2="1" y2="1">
                <stop stop-color="#38bdf8" />
                <stop offset="1" stop-color="#2080f0" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#ag)" />
            <path d="M9 20.5c4-8 10-8 14 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" />
            <circle cx="16" cy="23" r="2.2" fill="#fff" />
          </svg>
        </div>
        <div class="hero-text">
          <div class="hero-title">{{ model }} · 高级后台</div>
          <div class="hero-sub">Glass Panel v{{ BUILD_VERSION }} · 面向 GL.iNet MT3600BE 的全功能管理面板</div>
          <div class="tags">
            <n-tag size="small" type="info" :bordered="false">固件 {{ firmware }}</n-tag>
            <n-tag size="small" :bordered="false">Vue 3 + Naive UI</n-tag>
            <n-tag size="small" :bordered="false">本地面板 / 无云端依赖</n-tag>
          </div>
        </div>
      </div>
    </n-card>

    <n-card title="功能覆盖" class="card">
      <p class="p">
        本面板在同一套界面里覆盖两类能力：<b>原厂 GL 后台</b>的全部可配置项（上网、无线、终端、网络、安全、流控、VPN、云服务、应用、系统），
        以及内置增强能力（<template v-if="device.hasCellular">蜂窝深度信息、锁频锁小区、短信、AT 调试，</template>测速、诊断、历史监控曲线、风扇与温度策略、SSH / HTTPS 开关、界面设置）。
        增强能力基于面板自带的轻量后端运行时，不依赖原先那套 NUI 前端页面；运行时缺失时自动降级。
      </p>
      <p class="p dim">
        所有数据均来自设备真实接口（GL JSON-RPC + 设备端 Lua 后端），不依赖任何外部服务；设备不支持的能力会明确标注而不是伪造数据。
      </p>
    </n-card>

    <n-card title="其它入口" class="card">
      <div class="entries">
        <button v-for="e in entries" :key="e.url" class="entry" @click="open(e.url)">
          <n-icon :size="18"><component :is="e.icon" /></n-icon>
          <div class="entry-text">
            <div class="entry-title">{{ e.title }}</div>
            <div class="entry-desc">{{ e.desc }}</div>
          </div>
        </button>
      </div>
    </n-card>

    <n-card title="关于" class="card">
      <div class="kv">
        <div class="k">面板版本</div>
        <div class="v nui-mono">v{{ BUILD_VERSION }}</div>
        <div class="k">设备型号</div>
        <div class="v nui-mono">{{ model }}</div>
        <div class="k">固件版本</div>
        <div class="v nui-mono">{{ firmware }}</div>
        <div class="k">部署路径</div>
        <div class="v nui-mono">/www/glass/</div>
      </div>
      <div class="actions">
        <n-button size="small" type="primary" secondary @click="showChangelog = true">查看更新内容</n-button>
      </div>
    </n-card>
  </div>

    <n-modal v-model:show="showChangelog" preset="card" title="更新内容" style="width: 680px; max-width: 92vw">
      <div class="log">
        <div v-for="e in CHANGELOG" :key="e.version" class="log-entry" :class="{ early: e.early }">
          <div class="log-head">
            <n-tag size="small" :bordered="false" :type="e.version === BUILD_VERSION ? 'success' : 'default'">
              v{{ e.version }}
            </n-tag>
            <span class="log-title">{{ e.title }}</span>
            <span class="log-date">{{ e.date }}</span>
          </div>
          <ul class="log-items">
            <li v-for="(it, i) in e.items" :key="i">{{ it }}</li>
          </ul>
        </div>
      </div>
    </n-modal>
</template>


<style scoped>
.about { display: grid; gap: 16px; }
.hero-top { display: flex; gap: 16px; align-items: center; }
.logo { flex: none; }
.hero-title { font-size: 20px; font-weight: 700; letter-spacing: -0.2px; }
.hero-sub { font-size: 12.5px; opacity: 0.6; margin-top: 3px; }
.tags { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.card { border-radius: 14px; }
.p { font-size: 13px; line-height: 1.9; margin: 0 0 10px; }
.p.dim, .dim { opacity: 0.6; }
.entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.entry {
  display: flex; gap: 10px; align-items: center; text-align: left;
  padding: 12px 14px; border-radius: 12px; cursor: pointer;
  background: var(--chip); border: 1px solid var(--line); color: inherit;
  transition: transform 0.15s, border-color 0.15s;
}
.entry:hover { transform: translateY(-1px); border-color: var(--nui-accent); }
.entry-title { font-size: 13px; font-weight: 600; }
.entry-desc { font-size: 11.5px; opacity: 0.55; margin-top: 2px; }
.kv { display: grid; grid-template-columns: 110px 1fr; gap: 10px 16px; font-size: 13px; }
.k { opacity: 0.55; }
.v { text-align: right; word-break: break-all; }
.foot { font-size: 12px; margin-top: 16px; }
.actions { margin-top: 14px; }
@media (max-width: 640px) {
  .kv { grid-template-columns: 92px 1fr; }
  .v { text-align: left; }
}

.log { max-height: 62vh; overflow: auto; padding-right: 6px; }
.log-entry { padding: 12px 0; border-bottom: 1px dashed var(--line); }
.log-entry:last-child { border-bottom: 0; padding-bottom: 2px; }
.log-entry.early { opacity: 0.72; }
.log-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.log-title { font-size: 13.5px; font-weight: 600; }
.log-date { margin-left: auto; font-size: 11.5px; opacity: 0.5; }
.log-items { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.8; opacity: 0.82; }
.log-items li + li { margin-top: 2px; }
</style>
