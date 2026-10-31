<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NDrawer,
  NDrawerContent,
  NDropdown,
  NIcon,
  NLayout,
  NLayoutContent,
  NLayoutSider,
  NMenu,
  NTooltip,
  useMessage,
  type MenuOption,
} from 'naive-ui'
import {
  AnalyticsOutline,
  AppsOutline,
  CardOutline,
  CellularOutline,
  ChatbubbleEllipsesOutline,
  CheckmarkCircleOutline,
  CloudDownloadOutline,
  CloudOutline,
  ColorPaletteOutline,
  ConstructOutline,
  DesktopOutline,
  DocumentTextOutline,
  EarthOutline,
  EllipseOutline,
  ExtensionPuzzleOutline,
  EyeOffOutline,
  EyeOutline,
  FlameOutline,
  FolderOpenOutline,
  GitBranchOutline,
  GitNetworkOutline,
  GlobeOutline,
  GridOutline,
  HomeOutline,
  InformationCircleOutline,
  KeyOutline,
  LayersOutline,
  LinkOutline,
  ListOutline,
  LockClosedOutline,
  LogInOutline,
  MenuOutline,
  MoonOutline,
  OpenOutline,
  OptionsOutline,
  PeopleCircleOutline,
  PeopleOutline,
  PersonOutline,
  PinOutline,
  PlanetOutline,
  PulseOutline,
  RadioButtonOnOutline,
  RadioOutline,
  RefreshOutline,
  RepeatOutline,
  ServerOutline,
  SettingsOutline,
  ShareSocialOutline,
  ShieldCheckmarkOutline,
  ShieldOutline,
  SpeedometerOutline,
  StatsChartOutline,
  SunnyOutline,
  SwapHorizontalOutline,
  SwapVerticalOutline,
  TerminalOutline,
  ThermometerOutline,
  TimeOutline,
  WifiOutline,
} from '@vicons/ionicons5'
import { useAuthStore } from '@/stores/auth'
import { useDeviceStore, type PageKey } from '@/stores/device'
import { useUiStore } from '@/stores/ui'
import { useAppearanceSync } from '@/composables/useAppearanceSync'
import { splitSpeed } from '@/utils/format'
import { NAV, NAV_FLAT, titleFor } from '@/router'
import { pkgApps, type InstalledApp } from '@/api/pkg'
import { luciEntryUrl } from '@/utils/luci'
import { officialUrl } from '@/utils/official'
import { BUILD_VERSION } from '@/version'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
useAppearanceSync()
const auth = useAuthStore()
const device = useDeviceStore()
const message = useMessage()

/* 版本自检：后台文件已更新、但当前标签页还跑着旧 bundle 时提示刷新 */
const latestVersion = ref('')
const verDismissed = ref(false)
const latestBase = computed(() => String(latestVersion.value || '').split('-')[0])
const outdated = computed(() => !!latestBase.value && latestBase.value !== BUILD_VERSION && !verDismissed.value)
function reloadPage() {
  window.location.reload()
}
async function checkBuildVersion() {
  try {
    const r = await fetch('/glass/build.txt', { cache: 'no-store' })
    if (!r.ok) return
    const m = (await r.text()).match(/version=(\S+)/)
    if (m) latestVersion.value = m[1]
  } catch {
    /* ignore */
  }
}

const icon = (comp: unknown) => () => h(NIcon, null, { default: () => h(comp as never) })

const TOP_ICON: Record<string, unknown> = {
  '/overview': GridOutline,
  '/clients': PeopleOutline,
  '/cloud/goodcloud': CloudOutline,
  '/about': InformationCircleOutline,
}

/** 分组图标：折叠态（64px）下分组也要有图标，否则整组菜单在折叠时“消失” */
const GROUP_ICON: Record<string, unknown> = {
  蜂窝网络: CellularOutline,
  互联网: GlobeOutline,
  无线: WifiOutline,
  网络: GitNetworkOutline,
  安全: ShieldCheckmarkOutline,
  流控: SpeedometerOutline,
  'VPN 与组网': LockClosedOutline,
  云服务: CloudOutline,
  应用: AppsOutline,
  工具: ConstructOutline,
  系统: SettingsOutline,
}

/** 每个一级/分组/子页面都有图标：折叠态和手机抽屉里才都能看见、能点 */
const SECTION_ICON: Record<string, unknown> = {
  // 蜂窝
  '/cellular/status': CellularOutline,
  '/cellular/sim': CardOutline,
  '/cellular/lock': LockClosedOutline,
  '/cellular/data': StatsChartOutline,
  '/cellular/at': TerminalOutline,
  '/cellular/sms': ChatbubbleEllipsesOutline,
  // 互联网
  '/internet/wan': GlobeOutline,
  '/internet/multiwan': GitNetworkOutline,
  // 无线
  '/wireless/wifi': WifiOutline,
  '/wireless/guest': PeopleCircleOutline,
  '/wireless/repeater': ShareSocialOutline,
  '/wireless/acl': ListOutline,
  // 网络
  '/network/lan': HomeOutline,
  '/network/dhcp': PinOutline,
  '/network/dns': ServerOutline,
  '/network/ipv6': SwapHorizontalOutline,
  '/network/nat': RepeatOutline,
  '/network/routes': GitBranchOutline,
  '/network/igmp': RadioOutline,
  '/network/adv': OptionsOutline,
  // 安全
  '/security/firewall': FlameOutline,
  '/security/acl': ShieldCheckmarkOutline,
  '/security/remote': DesktopOutline,
  '/security/parental': PeopleOutline,
  '/security/dpi': AppsOutline,
  // 流控
  '/flow/stats': StatsChartOutline,
  '/flow/qos': SpeedometerOutline,
  '/flow/sqm': SwapVerticalOutline,
  // VPN
  '/vpn/dashboard': EyeOutline,
  '/vpn/client': LogInOutline,
  '/vpn/wg-server': KeyOutline,
  '/vpn/ovpn-server': ShieldOutline,
  '/vpn/tailscale': PlanetOutline,
  '/vpn/zerotier': LayersOutline,
  '/vpn/tor': EyeOffOutline,
  // 云服务
  '/cloud/goodcloud': CloudOutline,
  '/cloud/ddns': LinkOutline,
  '/cloud/sdwan': GitNetworkOutline,
  // 应用
  '/apps/store': ExtensionPuzzleOutline,
  '/apps/nas': FolderOpenOutline,
  '/apps/adguard': ShieldCheckmarkOutline,
  // 工具
  '/tools/speedtest': SpeedometerOutline,
  '/tools/diag': PulseOutline,
  '/tools/monitor': AnalyticsOutline,
  '/tools/conn': CheckmarkCircleOutline,
  // 系统
  '/system/info': InformationCircleOutline,
  '/system/password': PersonOutline,
  '/system/upgrade': CloudDownloadOutline,
  '/system/timer': TimeOutline,
  '/system/timezone': EarthOutline,
  '/system/button': RadioButtonOnOutline,
  '/system/fan': ThermometerOutline,
  '/system/reset': RefreshOutline,
  '/system/logs': DocumentTextOutline,
  '/system/advanced': OptionsOutline,
  '/system/ui': ColorPaletteOutline,
}

const extraApps = ref<InstalledApp[]>([])
async function loadExtraApps() {
  extraApps.value = await pkgApps()
}

const menuOptions = computed<MenuOption[]>(() =>
  NAV.filter((item: any) => !(item.children && item.label === '蜂窝网络' && device.hasCellular === false)).map(
    (item: any) => {
      if (item.children) {
        return {
          key: `grp-${item.label}`,
          label: item.label,
          icon: icon(GROUP_ICON[item.label] ?? LayersOutline),
          children: [
            ...item.children.map((c: any) => ({
              key: c.key,
              label: c.label,
              icon: icon(SECTION_ICON[c.key] ?? EllipseOutline),
            })),
            ...(item.label === '应用'
              ? extraApps.value.map((a) => ({
                  key: `/apps/app/${a.package}`,
                  label: a.label,
                  icon: icon(LinkOutline),
                }))
              : []),
          ],
        }
      }
      return {
        key: item.key,
        label: item.label,
        icon: icon(TOP_ICON[item.key] ?? SECTION_ICON[item.key] ?? GridOutline),
      }
    },
  ),
)

/** 移动端（<900px）：侧栏改为抽屉，避免折叠后分组菜单无法进入 */
const isMobile = ref(false)
const drawerOpen = ref(false)

function goPage(key: string) {
  drawerOpen.value = false
  if (key.startsWith('grp-')) return
  void router.push(key)
}

function onMenuButton() {
  if (isMobile.value) drawerOpen.value = true
  else ui.toggleCollapsed()
}

const activeKey = computed(() => route.path)
/** 侧栏里存在的页面才算合法路由；旧链接（如 /system/enhance）显示 404 卡片而不是白屏 */
const knownPath = computed(() => route.path.startsWith('/apps/app/') || NAV_FLAT.some((i) => i.key === route.path))
const crumb = computed(() => titleFor(route.path))
const pageTitle = computed(() => crumb.value.title)
const pageGroup = computed(() => crumb.value.group)
const deviceName = computed(() => String(device.info?.model ?? 'GL-MT3600BE').toUpperCase())
const firmware = computed(() => String(device.info?.firmware_version ?? '—'))
const tempText = computed(() => (device.health?.temp != null ? `${device.health.temp.toFixed(0)}°C` : '—'))
const connLevel = computed(() => device.conn?.level ?? 'down')
const connText = computed(() => {
  // 基础信息都拿不到 = 接口层问题（会话失效/固件异常），不要误报成“未联网”
  if (!device.info && !device.loading) return '接口异常'
  const c = device.conn
  if (!c) return '检测中…'
  if (c.level === 'ok') return c.active ? `已联网 · ${c.active}` : '已联网'
  if (c.level === 'link') return '链路通，无法上网'
  return '未联网'
})
const connLatency = computed(() => (device.conn?.latency != null ? `${device.conn.latency} ms` : ''))
const connSource = computed(() => (device.conn?.source === 'kmwan' ? 'kmwan 链路跟踪' : '可达性探测'))
const connDetail = computed(() =>
  (device.conn?.ifaces ?? []).map((i) => `${i.name}: ${i.online ? '在线' : '离线'}${i.ip ? ' ' + i.ip : ''}`).join(' / '),
)
const rx = computed(() => splitSpeed(device.speed.rx))

const userOptions = [
  { label: '切换到原厂界面', key: 'official' },
  { label: 'OpenWrt LuCI', key: 'luci' },
  { type: 'divider' as const, key: 'd1' },
  { label: '退出登录', key: 'logout' },
]

function openOfficial() {
  window.open(officialUrl(), '_blank')
}

async function onUserMenu(key: string) {
  if (key === 'logout') {
    await auth.logout()
    message.success('已退出登录')
    router.replace('/login')
  } else if (key === 'official') {
    window.location.href = officialUrl()
  } else if (key === 'luci') {
    window.open(luciEntryUrl(), '_blank')
  }
}

async function manualRefresh() {
  try {
    await device.refresh(route.name as PageKey)
    message.success('已刷新')
  } catch {
    message.error('刷新失败：接口暂不可用')
  }
}

/** 会话失效（gl-session 默认 300s 过期 / 最多 5 个会话被踢）→ 回登录页，避免停在“全空”的假断网界面 */
function handleExpired() {
  if (route.meta?.public || route.path === '/login') return
  auth.markExpired()
  message.warning('登录已过期，请重新登录')
  router.replace({ path: '/login', query: { next: route.fullPath, expired: '1' } })
}

/** 标签页切回前台：先校验会话，再刷新数据（后台标签页被节流时数据会停更，会话也可能过期） */
async function onVisible() {
  if (document.visibilityState !== 'visible' || !auth.loggedIn) return
  const ok = await auth.keepAlive()
  if (!ok) {
    handleExpired()
    return
  }
  void device.refresh(route.name as PageKey)
  void device.checkConn(true)
}

/** 窄屏：<900px 时侧栏改为抽屉（折叠成 64px 图标栏会让分组菜单进不去） */
function syncCollapsed() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 900
  if (isMobile.value) drawerOpen.value = false
  if (!isMobile.value && window.innerWidth < 1100 && !ui.collapsed) ui.collapsed = true
}

let heartbeat: number | undefined
onMounted(() => {
  syncCollapsed()
  window.addEventListener('resize', syncCollapsed)
  window.addEventListener('gl-auth-expired', handleExpired)
  document.addEventListener('visibilitychange', onVisible)
  // 60s 心跳：既保活 gl-session（默认 300s），也及时发现被其它登录挤掉
  heartbeat = window.setInterval(async () => {
    if (document.visibilityState !== 'visible' || !auth.loggedIn) return
    const ok = await auth.keepAlive()
    if (!ok) handleExpired()
  }, 60000)
  void device.refresh(route.name as PageKey)
  void loadExtraApps()
  window.addEventListener('glass-pkg-changed', loadExtraApps)
  device.startPolling(ui.refreshMs)
  void checkBuildVersion()
  // 硬件能力探测：无蜂窝模组时隐藏「蜂窝网络」入口（结果拿到前先显示，避免误隐藏）
  void device.checkCaps()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncCollapsed)
  window.removeEventListener('gl-auth-expired', handleExpired)
  window.removeEventListener('glass-pkg-changed', loadExtraApps)
  document.removeEventListener('visibilitychange', onVisible)
  if (heartbeat) clearInterval(heartbeat)
  device.stopPolling()
})
// 「界面设置 → 刷新频率」变更后立即重启顶栏/设备指标轮询（无需刷新页面）
watch(
  () => ui.refreshSec,
  () => {
    device.stopPolling()
    device.startPolling(ui.refreshMs)
  },
)
/** 无蜂窝模组时不进入蜂窝页面（含直接输 URL / 旧书签） */
function guardCellular() {
  if (device.hasCellular === false && route.path.startsWith('/cellular')) {
    message.info('本机未检测到蜂窝模组，已隐藏蜂窝功能')
    void router.replace('/overview')
  }
}

watch(
  () => route.path,
  () => {
    drawerOpen.value = false
    guardCellular()
  },
)
watch(() => device.hasCellular, guardCellular)
watch(
  () => route.name,
  (n) => {
    if (n) void device.refresh(n as PageKey)
  },
)
</script>

<template>
  <n-layout has-sider class="shell">
    <n-layout-sider
      v-if="!isMobile"
      bordered
      collapse-mode="width"
      :width="220"
      :collapsed-width="64"
      :collapsed="ui.collapsed"
      :native-scrollbar="false"
      class="sider"
    >
      <div class="brand" :class="{ mini: ui.collapsed }">
        <div class="logo">
          <svg viewBox="0 0 32 32" width="22" height="22">
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
                <stop stop-color="#38bdf8" />
                <stop offset="1" stop-color="#2080f0" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#lg)" />
            <path d="M9 20.5c4-8 10-8 14 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" />
            <circle cx="16" cy="23" r="2.2" fill="#fff" />
          </svg>
        </div>
        <div v-if="!ui.collapsed" class="brand-text">
          <div class="brand-name ellipsis">{{ deviceName }}</div>
          <div class="brand-sub ellipsis">Beryl 7 · {{ firmware }}</div>
        </div>
      </div>

      <n-menu
        :value="activeKey"
        :options="menuOptions"
        :collapsed="ui.collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="20"
        :indent="18"
        @update:value="goPage"
      />
    </n-layout-sider>

    <!-- 移动端抽屉导航：<=900px 时不显示固定侧栏，用汉堡按钮打开完整菜单 -->
    <n-drawer v-model:show="drawerOpen" placement="left" :width="250" class="mobile-drawer">
      <n-drawer-content :native-scrollbar="false" closable body-content-style="padding: 0">
        <div class="brand drawer-brand">
          <div class="logo">
            <svg viewBox="0 0 32 32" width="22" height="22">
              <defs>
                <linearGradient id="lgd" x1="0" y1="0" x2="1" y2="1">
                  <stop stop-color="#38bdf8" />
                  <stop offset="1" stop-color="#2080f0" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="9" fill="url(#lgd)" />
              <path d="M9 20.5c4-8 10-8 14 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" />
              <circle cx="16" cy="23" r="2.2" fill="#fff" />
            </svg>
          </div>
          <div class="brand-text">
            <div class="brand-name ellipsis">{{ deviceName }}</div>
            <div class="brand-sub ellipsis">Beryl 7 · {{ firmware }}</div>
          </div>
        </div>
        <n-menu :value="activeKey" :options="menuOptions" :indent="18" :default-expand-all="true" @update:value="goPage" />
      </n-drawer-content>
    </n-drawer>

    <n-layout class="main">
      <header class="header">
        <div class="header-left">
          <n-button quaternary circle size="small" @click="onMenuButton">
            <template #icon><n-icon><MenuOutline /></n-icon></template>
          </n-button>
          <div class="crumb">
            <span v-if="pageGroup" class="crumb-group">{{ pageGroup }}</span>
            <span v-if="pageGroup" class="crumb-sep">/</span>
            <span class="crumb-title">{{ pageTitle }}</span>
          </div>
        </div>

        <div class="header-right">
          <n-tooltip trigger="hover">
            <template #trigger>
              <span class="net-chip">
                <i class="dot" :class="connLevel === 'ok' ? 'on' : connLevel === 'link' ? 'warn' : 'off'" />
                <span class="net-op">{{ connText }}</span>
                <span v-if="connLatency" class="nui-mono nui-small" style="opacity: 0.6">{{ connLatency }}</span>
              </span>
            </template>
            {{ connSource }}<template v-if="connDetail">：{{ connDetail }}</template>
          </n-tooltip>
          <span class="net-chip nui-mono hide-sm">{{ device.wan?.ip || device.publicIp || '—' }}</span>
          <span class="net-chip hide-sm nui-mono">↓ {{ rx.value }}{{ rx.unit }}</span>
          <span class="temp-chip">
            <n-icon :size="15"><ThermometerOutline /></n-icon>
            {{ tempText }}
          </span>

          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button quaternary circle size="small" @click="manualRefresh">
                <template #icon><n-icon><RefreshOutline /></n-icon></template>
              </n-button>
            </template>
            刷新
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button quaternary circle size="small" @click="ui.toggleDark()">
                <template #icon>
                  <n-icon><component :is="ui.dark ? SunnyOutline : MoonOutline" /></n-icon>
                </template>
              </n-button>
            </template>
            {{ ui.dark ? '浅色' : '深色' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button quaternary circle size="small" class="hide-xs" @click="openOfficial">
                <template #icon><n-icon><OpenOutline /></n-icon></template>
              </n-button>
            </template>
            官方后台
          </n-tooltip>

          <n-dropdown :options="userOptions" trigger="click" @select="onUserMenu">
            <n-button quaternary circle size="small">
              <template #icon>
                <span class="avatar">{{ auth.user.slice(0, 1).toUpperCase() }}</span>
              </template>
            </n-button>
          </n-dropdown>
        </div>
      </header>

      <n-layout-content :native-scrollbar="false" class="content">
        <div class="container">
          <n-alert v-if="outdated" type="warning" :bordered="false" closable style="margin-bottom: 12px" @close="verDismissed = true">
            后台已更新到 <b>{{ latestVersion }}</b>，当前页面还是 <b>{{ BUILD_VERSION }}</b>；刷新后才能看到新功能。
            <n-button size="tiny" type="primary" style="margin-left: 10px" @click="reloadPage">立即刷新</n-button>
          </n-alert>
          <router-view v-slot="{ Component }">
            <component :is="Component" v-if="knownPath" class="nui-route-in" />
            <div v-else class="notfound">
              <div class="nf-code">404</div>
              <div class="nf-title">页面不存在</div>
              <p class="nf-desc">
                当前地址 <code>{{ route.path }}</code> 不在本面板的页面清单里。<br />
                如果你是从旧链接（例如 NUI 增强设置的 <code>/system/enhance</code>）点进来的：
                NUI 前端页面已随插件移除，相关设置已合并到本面板（风扇与温度、账号与 SSH、界面设置）。
              </p>
              <div class="nf-actions">
                <n-button size="small" type="primary" @click="router.replace('/overview')">返回概览</n-button>
                <n-button size="small" quaternary @click="router.replace('/system/fan')">风扇与温度</n-button>
                <n-button size="small" quaternary @click="router.replace('/system/ui')">界面设置</n-button>
              </div>
            </div>
          </router-view>
        </div>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.shell {
  height: 100vh;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 64px;
  padding: 0 18px;
  flex-shrink: 0;
}
.brand.mini {
  padding: 0 16px;
  justify-content: center;
}
.mobile-drawer .drawer-brand {
  padding: 0 16px;
  height: 64px;
}
.logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  box-shadow: 0 6px 16px -6px rgba(32, 128, 240, 0.6);
}
.brand-text {
  min-width: 0;
  line-height: 1.2;
}
.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.brand-sub {
  font-size: 12px;
  opacity: 0.55;
  line-height: 1.3;
}

.header {
  height: var(--nui-header-h);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px 0 12px;
  border-bottom: 1px solid var(--line);
  position: relative;
  z-index: 10;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: auto;
  min-width: 0;
}
.crumb {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.crumb-group { opacity: 0.5; }
.crumb-sep { opacity: 0.3; }
.crumb-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.net-chip,
.temp-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: 17px;
  background: var(--chip);
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
}
.temp-chip { gap: 4px; }
.net-op { font-weight: 500; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.6);
}
.dot.on { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.off { background: var(--err); }
.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--nui-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.notfound {
  max-width: 560px;
  margin: 60px auto;
  padding: 28px 26px;
  border-radius: 16px;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: 0 12px 40px -28px rgba(0, 0, 0, 0.45);
}
.nf-code { font-size: 44px; font-weight: 700; letter-spacing: -2px; opacity: 0.18; line-height: 1; }
.nf-title { font-size: 18px; font-weight: 700; margin: 6px 0 10px; }
.nf-desc { font-size: 13px; line-height: 1.9; opacity: 0.68; margin: 0 0 16px; }
.nf-desc code { padding: 1px 6px; border-radius: 6px; background: var(--chip); font-size: 12px; }
.nf-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 24px 40px;
}

@media (max-width: 1100px) {
  .hide-sm { display: none; }
}
@media (max-width: 768px) {
  .container { padding: 12px 12px 32px; }
  .header { padding: 0 6px 0 2px; gap: 6px; }
  .header-right { gap: 0; }
  .net-chip { padding: 0 8px; margin-right: 4px; gap: 6px; }
}
/* 手机端：左侧菜单按钮/标题与右侧状态不能互相压住（此前 header-left 被压成 3px） */
@media (max-width: 900px) {
  .temp-chip { display: none; }
}
@media (max-width: 768px) {
  .header { padding: 0 8px; gap: 8px; }
  .header-left { flex: 1 1 auto; min-width: 0; overflow: hidden; }
  .crumb { font-size: 14px; }
  .crumb-group,
  .crumb-sep { display: none; }
  .crumb-title { max-width: 118px; }
  .header-right { flex: 0 0 auto; gap: 2px; }
  .net-chip { height: 30px; padding: 0 8px; gap: 5px; font-size: 12px; margin-right: 0; }
  .net-chip .nui-small { display: none; }
}
@media (max-width: 520px) {
  .crumb-title { max-width: 72px; }
  .net-op { max-width: 62px; overflow: hidden; text-overflow: ellipsis; }
  .hide-xs { display: none !important; }
}
</style>
