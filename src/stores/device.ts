import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { api } from '@/api'
import { getConn, type ConnState } from '@/api/ext'
import type { Client, CloudBundle, Health, SysInfo, WanInfo, WifiConfig, WifiStatus } from '@/api/types'

export type PageKey = string

const SERIES_LEN = 60

export const useDeviceStore = defineStore('device', () => {
  const info = ref<SysInfo | null>(null)
  const health = ref<Health | null>(null)
  const wan = ref<WanInfo | null>(null)
  const wifiConfig = ref<WifiConfig | null>(null)
  const wifiStatus = ref<WifiStatus | null>(null)
  const clients = ref<Client[]>([])
  const cloud = ref<CloudBundle | null>(null)

  const speed = ref({ rx: 0, tx: 0 })
  const series = ref<{ down: number[]; up: number[] }>({ down: [], up: [] })

  const publicIp = ref<string | null>(null)
  const cableOk = ref<boolean | null>(null)
  const netStatus = ref<Record<string, any> | null>(null)
  const lanConf = ref<Record<string, any> | null>(null)
  const arp = shallowRef<Record<string, any>[]>([])

  const conn = ref<ConnState | null>(null)
  const lastUpdate = ref<number | null>(null)
  const loading = ref(false)

  /* ---------------- 硬件能力探测（决定是否显示蜂窝入口） ----------------
   * 官方优先：system.get_info.hardware_feature.build_in_modem（内置模组）
   *        → modem.get_debug_msg.modem_info.devices（外接/USB 模组）
   *        → NUI 桥 nui.caps（若设备上有插件运行时）
   * 拿不到任何证据时保持“显示”，避免误隐藏。 */
  const caps = ref<Record<string, any> | null>(null)
  const capsKnown = ref(false)
  /** 硬件能力：null=还没探测完（先按有处理），false=明确没有，页面/菜单降级 */
  const hasFan = ref<boolean | null>(null)
  const hasButton = ref<boolean | null>(null)
  let hwCapsKnown = false
  async function checkHardwareCaps() {
    if (hwCapsKnown) return
    hwCapsKnown = true
    try {
      const hw = await api.call<any>('glass', 'hw_caps').catch(() => null)
      if (hw && typeof hw.fan === 'boolean') {
        hasFan.value = hw.fan
      } else {
        let f = await api.call<any>('fanctrl', 'get_status').catch(() => null)
        if (!f || f.supported === false) f = await api.call<any>('fan', 'get_status').catch(() => null)
        hasFan.value = !!f && f.supported !== false && (f.speed !== undefined || f.status !== undefined || f.config !== undefined || f.rpm !== undefined)
      }
    } catch {
      hasFan.value = false
    }
    try {
      const r = await api.call<any>('switch-button', 'get_funcs')
      const funcs = r?.funcs ?? r
      hasButton.value = Array.isArray(funcs) && funcs.length > 0
    } catch {
      hasButton.value = false
    }
  }
  const hasCellular = computed(() => {
    if (!caps.value) return true
    return !!(caps.value.cellular || caps.value.modem || caps.value.sim || caps.value.modemDevices)
  })

  async function checkCaps() {
    if (capsKnown.value) return
    // 1) 官方 system.get_info 的硬件能力位
    try {
      const inf = info.value ?? (await api.info().catch(() => null))
      if (inf) info.value = inf
      const hf = (inf as any)?.hardware_feature
      if (hf && typeof hf === 'object') {
        const buildIn = String(hf.build_in_modem ?? '')
        let cellular = buildIn !== ''
        // 2) 再探一次模组总线（外接 USB 模组时 build_in_modem 仍为空）
        const dbg = await api.call<any>('modem', 'get_debug_msg').catch(() => null)
        const devs = dbg?.modem_info?.devices
        if (Array.isArray(devs) && devs.length > 0) cellular = true
        caps.value = { cellular, source: 'system.get_info+modem' }
        capsKnown.value = true
        return
      }
    } catch {
      /* 继续 */
    }
    // 3) 直接问模组
    try {
      const dbg = await api.call<any>('modem', 'get_debug_msg')
      const devs = dbg?.modem_info?.devices
      caps.value = { cellular: Array.isArray(devs) && devs.length > 0, source: 'modem.get_debug_msg' }
      capsKnown.value = true
      return
    } catch {
      /* 继续 */
    }
    // 4) NUI 桥（可选运行时）
    try {
      const c = await api.call<any>('nui', 'caps')
      const cc = c?.caps ?? c
      caps.value = { cellular: !!(cc?.cellular || cc?.modem || cc?.sim), sms: !!cc?.sms, source: 'nui.caps' }
      capsKnown.value = true
    } catch {
      /* 都拿不到就不隐藏蜂窝入口 */
    }
  }

  let timer: number | undefined
  let connTimer: number | undefined
  let lastConnCheck = 0

  /** 联网检测：kmwan 跟踪 / 真实可达性探测，15 秒内不重复 */
  async function checkConn(force = false) {
    if (!force && Date.now() - lastConnCheck < 15000) return
    lastConnCheck = Date.now()
    conn.value = await getConn().catch(() => null)
  }
  let page: PageKey = 'overview'

  function pushSeries(rx: number, tx: number) {
    const d = series.value.down.slice(-(SERIES_LEN - 1))
    const u = series.value.up.slice(-(SERIES_LEN - 1))
    d.push(rx)
    u.push(tx)
    series.value = { down: d, up: u }
  }

  /** 演示模式首屏没有历史采样，先铺一段基线，图表不至于空白 */
  function seedSeries(rx: number, tx: number) {
    const d: number[] = []
    const u: number[] = []
    for (let i = 0; i < SERIES_LEN - 1; i++) {
      const k = 0.35 + Math.random() * 0.9
      d.push(rx * k)
      u.push(tx * k)
    }
    d.push(rx)
    u.push(tx)
    series.value = { down: d, up: u }
  }

  async function refresh(p: PageKey = page) {
    page = p
    loading.value = true
    try {
      switch (p) {
        case 'overview':
          await Promise.all([
            api.health().then((v) => (health.value = v)),
            api.speed().then((v) => {
              if (!v) return
              speed.value = v
              if (api.kind === 'demo' && !series.value.down.length) seedSeries(v.rx, v.tx)
              else pushSeries(v.rx, v.tx)
            }),
            api.info().then((v) => (info.value = v)),
            api.wan().then((v) => (wan.value = v)),
            api
              .wifi()
              .then((v) => {
                wifiConfig.value = v.config
                wifiStatus.value = v.status
              }),
            api.clients().then((v) => (clients.value = v)),
            api.cloud().then((v) => (cloud.value = v)),
          ])
          break

        case 'internet':
          await Promise.all([
            api.wan().then((v) => (wan.value = v)),
            api.info().then((v) => (info.value = v)),
            api.cable().then((v) => (cableOk.value = v)),
            api.networkStatus().then((v) => (netStatus.value = v)),
            api.publicIp().then((v) => (publicIp.value = v)),
          ])
          break

        case 'wireless':
          await Promise.all([
            pollSpeed(),
            api.wifi().then((v) => {
              wifiConfig.value = v.config
              wifiStatus.value = v.status
            }),
            api.clients().then((v) => (clients.value = v)),
          ])
          break

        case 'clients':
          await Promise.all([
            api.clients().then((v) => (clients.value = v)),
            api.speed().then((v) => {
              if (!v) return
              speed.value = v
              if (api.kind === 'demo' && !series.value.down.length) seedSeries(v.rx, v.tx)
              else pushSeries(v.rx, v.tx)
            }),
          ])
          break

        case 'network':
          await Promise.all([
            api.lanConfig().then((v) => (lanConf.value = v)),
            api.arp().then((v) => (arp.value = v)),
            api.wan().then((v) => (wan.value = v)),
          ])
          break

        case 'cloud':
          await Promise.all([
            api.cloud().then((v) => (cloud.value = v)),
            api.info().then((v) => (info.value = v)),
            api.wan().then((v) => (wan.value = v)),
          ])
          break

        case 'system':
          await Promise.all([
            api.info().then((v) => (info.value = v)),
            api.health().then((v) => (health.value = v)),
            pollSpeed(),
          ])
          break

        default:
          // 其它页面维护顶栏需要的轻量数据（含实时速率与公网 IP），页面自己取业务数据
          await Promise.all([
            api.info().then((v) => (info.value = v)),
            api.health().then((v) => (health.value = v)),
            api.wan().then((v) => (wan.value = v)),
            pollSpeed(),
            api.publicIp().then((v) => (publicIp.value = v)),
          ])
          break
      }
      if (p === 'overview' || p === 'internet') void checkConn()
      lastUpdate.value = Date.now()
    } finally {
      loading.value = false
    }
  }

  /** 顶栏实时速率：任何页面都要刷新，否则离开概览后 ↓/↑ 会停在旧值 */
  async function pollSpeed() {
    const v = await api.speed().catch(() => null)
    if (!v) return
    speed.value = v
    if (api.kind === 'demo' && !series.value.down.length) seedSeries(v.rx, v.tx)
    else pushSeries(v.rx, v.tx)
  }

  function startPolling(ms = 5000) {
    stopPolling()
    void checkConn(true)
    connTimer = window.setInterval(() => { if (!document.hidden) void checkConn() }, 15000)
    timer = window.setInterval(() => {
      if (document.hidden) return
      void refresh()
    }, ms)
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (connTimer) {
      clearInterval(connTimer)
      connTimer = undefined
    }
  }

  async function toggleCloud(patch: Record<string, unknown>) {
    await api.setCloud(patch)
    cloud.value = await api.cloud()
  }

  async function toggleDdns(enable: boolean) {
    await api.setDdns(enable)
    cloud.value = await api.cloud()
  }

  return {
    info,
    health,
    wan,
    wifiConfig,
    wifiStatus,
    clients,
    cloud,
    speed,
    series,
    publicIp,
    cableOk,
    netStatus,
    lanConf,
    arp,
    lastUpdate,
    loading,
    refresh,
    conn,
    caps,
    capsKnown,
    hasCellular,
    hasFan,
    hasButton,
    checkHardwareCaps,
    checkCaps,
    checkConn,
    startPolling,
    stopPolling,
    toggleCloud,
    toggleDdns,
  }
})
