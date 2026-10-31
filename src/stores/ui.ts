import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

type ThemeMode = 'auto' | 'dark' | 'light'
export type RadiusMode = 'sm' | 'md' | 'lg'
export type BgMode = 'aurora' | 'pure' | 'wallpaper' | 'video'
export type WallpaperFit = 'cover' | 'contain' | 'stretch'
export type AuroraPreset = 'default' | 'violet' | 'ocean' | 'sunset' | 'forest'

export interface Appearance {
  /** 启用美化：关闭后恢复默认深色/浅色皮肤（不加载自定义背景/毛玻璃） */
  beautify: boolean
  accent: string
  radius: RadiusMode
  bg: BgMode
  /** 壁纸：dataURL 或 http(s) 图片链接，空 = 未设置 */
  wallpaper: string
  /** 壁纸适配：铺满裁剪 / 完整显示 / 拉伸铺满 */
  wallpaperFit: WallpaperFit
  /** 极光渐变配色 */
  aurora: AuroraPreset
  /** 纯色背景（空 = 跟随深浅主题默认底色） */
  pureColor: string
  /** 视频背景：/glass-media/xxx.mp4 或 http(s) 视频链接，空 = 未设置 */
  video: string
  frosted: boolean
  /** 卡片不透明度 30-100（%） */
  cardAlpha: number
}

const THEME_KEY = 'nui.theme'
const REFRESH_KEY = 'nui.refreshSec'
const APPEAR_KEY = 'nui.appearance'
const RATE_KEY = 'nui.rateHistory'
const REFRESH_DEFAULT = 5
const REFRESH_MIN = 2
const REFRESH_MAX = 60

const RADIUS_PX: Record<RadiusMode, number> = { sm: 8, md: 14, lg: 20 }

const DEFAULT_APPEARANCE: Appearance = {
  beautify: true,
  accent: '#2080f0',
  radius: 'md',
  bg: 'aurora',
  wallpaper: '',
  wallpaperFit: 'cover',
  aurora: 'default',
  pureColor: '',
  video: '',
  frosted: true,
  cardAlpha: 70,
}

function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

function loadAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(APPEAR_KEY) || '{}') || {}
    return { ...DEFAULT_APPEARANCE, ...raw }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export const useUiStore = defineStore('ui', () => {
  const stored = (localStorage.getItem(THEME_KEY) as ThemeMode) || 'dark'
  const mode = ref<ThemeMode>(stored)
  const dark = ref(mode.value === 'dark' || (mode.value === 'auto' && systemDark()))
  const collapsed = ref(localStorage.getItem('nui.collapsed') === '1')
  /** 全局刷新频率（秒）：所有页面的轮询间隔统一按它走，保存在浏览器本地 */
  const refreshSec = ref(clampRefresh(Number(localStorage.getItem(REFRESH_KEY)) || REFRESH_DEFAULT))
  const refreshMs = computed(() => refreshSec.value * 1000)

  /** 外观（主题色/圆角/背景/壁纸/毛玻璃/卡片透明度），保存浏览器本地 */
  const appearance = ref<Appearance>(loadAppearance())
  const radiusPx = computed(() => RADIUS_PX[appearance.value.radius] ?? RADIUS_PX.md)

  /** 首页实时速率显示最近记录（路由器内存里 3 分钟采样） */
  const rateHistory = ref(localStorage.getItem(RATE_KEY) === '1')

  function clampRefresh(v: number) {
    const n = Math.round(Number(v) || REFRESH_DEFAULT)
    return Math.min(REFRESH_MAX, Math.max(REFRESH_MIN, n))
  }
  function setRefreshSec(v: number) {
    refreshSec.value = clampRefresh(v)
    localStorage.setItem(REFRESH_KEY, String(refreshSec.value))
  }

  function apply() {
    dark.value = mode.value === 'dark' || (mode.value === 'auto' && systemDark())
    document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'
    localStorage.setItem(THEME_KEY, mode.value)
  }

  function setMode(m: ThemeMode) {
    mode.value = m
    apply()
  }

  function toggleDark() {
    setMode(dark.value ? 'light' : 'dark')
  }

  function toggleCollapsed() {
    collapsed.value = !collapsed.value
    localStorage.setItem('nui.collapsed', collapsed.value ? '1' : '0')
  }

  function setAppearance(patch: Partial<Appearance>) {
    appearance.value = { ...appearance.value, ...patch }
    localStorage.setItem(APPEAR_KEY, JSON.stringify(appearance.value))
  }

  function setRateHistory(on: boolean) {
    rateHistory.value = on
    localStorage.setItem(RATE_KEY, on ? '1' : '0')
  }

  watch(
    () => mode.value,
    () => apply(),
  )
  apply()
  if (typeof matchMedia !== 'undefined') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (mode.value === 'auto') apply()
    })
  }

  return {
    mode,
    dark,
    collapsed,
    refreshSec,
    refreshMs,
    appearance,
    radiusPx,
    rateHistory,
    setRefreshSec,
    setMode,
    toggleDark,
    toggleCollapsed,
    setAppearance,
    setRateHistory,
  }
})
