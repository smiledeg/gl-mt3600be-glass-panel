<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NConfigProvider,
  NDialogProvider,
  NLoadingBarProvider,
  NMessageProvider,
  dateZhCN,
  darkTheme,
  zhCN,
} from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { buildThemeOverrides } from '@/theme'

const ui = useUiStore()
const theme = computed(() => (ui.dark ? darkTheme : null))
const overrides = computed(() => buildThemeOverrides(ui.appearance.accent, ui.radiusPx))
const videoUrl = computed(() => {
  const a = ui.appearance
  return a.beautify && a.bg === 'video' && a.video ? a.video : ''
})

const AURORA_PRESETS: Record<string, [string, string, string]> = {
  default: ['rgba(124, 92, 255, 0.28)', 'rgba(32, 128, 240, 0.26)', 'rgba(0, 184, 217, 0.2)'],
  violet: ['rgba(168, 85, 247, 0.32)', 'rgba(99, 102, 241, 0.26)', 'rgba(236, 72, 153, 0.2)'],
  ocean: ['rgba(14, 165, 233, 0.3)', 'rgba(6, 182, 212, 0.25)', 'rgba(16, 185, 129, 0.18)'],
  sunset: ['rgba(251, 146, 60, 0.3)', 'rgba(244, 63, 94, 0.24)', 'rgba(168, 85, 247, 0.18)'],
  forest: ['rgba(34, 197, 94, 0.28)', 'rgba(16, 185, 129, 0.22)', 'rgba(132, 204, 22, 0.18)'],
}

/** 把外观设置落到 :root（CSS 变量 + data-*），全局立即生效 */
function applyAppearance() {
  const a = ui.appearance
  const el = document.documentElement
  el.style.setProperty('--nui-accent', a.accent)
  el.style.setProperty('--nui-radius', `${ui.radiusPx}px`)
  const alpha = Math.min(100, Math.max(30, Number(a.cardAlpha) || 70)) / 100
  el.style.setProperty('--nui-card-alpha', String(alpha))
  el.dataset.beautify = a.beautify ? '1' : '0'
  el.dataset.bg = a.beautify ? a.bg : 'pure'
  el.dataset.frosted = a.beautify && a.frosted ? '1' : '0'
  // 极光渐变预设
  const aurora = AURORA_PRESETS[a.aurora] || AURORA_PRESETS.default
  el.style.setProperty('--nui-aurora-1', aurora[0])
  el.style.setProperty('--nui-aurora-2', aurora[1])
  el.style.setProperty('--nui-aurora-3', aurora[2])
  // 纯色背景（空则跟随主题底色）
  if (a.pureColor) el.style.setProperty('--nui-pure-bg', a.pureColor)
  else el.style.removeProperty('--nui-pure-bg')
  if (a.beautify && a.bg === 'wallpaper' && a.wallpaper) {
    el.style.setProperty('--nui-wallpaper', `url("${a.wallpaper.replace(/"/g, '%22')}")`)
    const fit = a.wallpaperFit || 'cover'
    if (fit === 'stretch') {
      el.style.setProperty('--nui-wallpaper-size', '100% 100%')
      el.style.setProperty('--nui-wallpaper-repeat', 'no-repeat')
    } else if (fit === 'contain') {
      // 完整显示：不裁切，空白方向重复平铺（效果同设置页缩略图）
      if (wallAspect.value === 'portrait') {
        el.style.setProperty('--nui-wallpaper-size', 'auto 100%')
        el.style.setProperty('--nui-wallpaper-repeat', 'repeat-x')
      } else if (wallAspect.value === 'landscape') {
        el.style.setProperty('--nui-wallpaper-size', '100% auto')
        el.style.setProperty('--nui-wallpaper-repeat', 'repeat-y')
      } else {
        el.style.setProperty('--nui-wallpaper-size', 'contain')
        el.style.setProperty('--nui-wallpaper-repeat', 'repeat')
      }
    } else {
      el.style.setProperty('--nui-wallpaper-size', 'cover')
      el.style.setProperty('--nui-wallpaper-repeat', 'no-repeat')
    }
    loadWallAspect(a.wallpaper)
  } else {
    el.style.removeProperty('--nui-wallpaper')
  }
}

/** 记录壁纸横竖方向，供“完整显示”决定平铺方向 */
const wallAspect = ref<'portrait' | 'landscape' | ''>('')
let wallAspectUrl = ''
function loadWallAspect(url: string) {
  if (!url || url === wallAspectUrl) return
  wallAspectUrl = url
  wallAspect.value = ''
  const img = new Image()
  img.onload = () => {
    if (wallAspectUrl !== url) return
    wallAspect.value = img.naturalHeight > img.naturalWidth ? 'portrait' : 'landscape'
    applyAppearance()
  }
  img.src = url
}
watch([() => ui.appearance, () => ui.radiusPx], applyAppearance, { deep: true, immediate: true })
</script>

<template>
  <div class="app-root">
    <video v-if="videoUrl" class="app-video" :src="videoUrl" autoplay muted loop playsinline preload="auto" />
    <div v-if="videoUrl" class="app-video-mask" />
    <div class="app-content">
      <n-config-provider :theme="theme" :theme-overrides="overrides" :locale="zhCN" :date-locale="dateZhCN">
        <n-loading-bar-provider>
          <n-message-provider>
            <n-dialog-provider>
              <router-view />
            </n-dialog-provider>
          </n-message-provider>
        </n-loading-bar-provider>
      </n-config-provider>
    </div>
  </div>
</template>
