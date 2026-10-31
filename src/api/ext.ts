import { api } from './index'

/** 浏览器侧硬超时：断网时后端探测可能卡住，这里兜底 */
function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${tag} 超时`)), ms)
    p.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** 通用调用（探测与兜底用） */
export type Call = <T = any>(obj: string, method: string, params?: Record<string, unknown>) => Promise<T>

/** 能力探测：get_config / get_status 任一通即为支持 */
const capCache = new Map<string, boolean>()

export async function probe(obj: string): Promise<boolean> {
  if (capCache.has(obj)) return capCache.get(obj)!
  let ok = false
  for (const m of ['get_config', 'get_status']) {
    try {
      await api.call(obj, m)
      ok = true
      break
    } catch {
      /* 继续试下一个 */
    }
  }
  capCache.set(obj, ok)
  return ok
}

export const clearCaps = () => capCache.clear()

/* ---------------- WiFi ---------------- */
export interface WifiIface {
  /** 接口名：ra0 / rai0 / guest2g / guest5g / iot2g / iot5g / wlanmld0 */
  name?: string
  ssid?: string
  key?: string
  password?: string
  encryption?: string
  enabled?: boolean
  hidden?: boolean
  guest?: boolean
  iot?: boolean
  bssid?: string
  /** 所属频段 2G / 5G */
  band?: string
  [k: string]: unknown
}

export interface WifiBandConf {
  band: string
  ifaces: WifiIface[]
  channels?: { channel: number; dfs: boolean; psc?: boolean }[]
  device?: string
  hwmode?: string
  hwmodes?: string[]
  htmode?: string
  htmodes?: Record<string, number | boolean>
  encryptions?: string[]
  txpower?: string
  /** 当前信道，0 = 自动 */
  channel?: number
  [k: string]: unknown
}

export interface WifiCfg {
  res?: WifiBandConf[]
  dfs_support?: boolean
  bandmode?: Record<string, unknown>
  [k: string]: unknown
}

/** 把 get_config 的 res[].ifaces[] 摊平成接口列表（并带上 band/device） */
export function wifiBands(cfg: WifiCfg | null): WifiBandConf[] {
  if (!cfg) return []
  if (Array.isArray(cfg.res)) return cfg.res
  return []
}

export function wifiList(cfg: WifiCfg | null): WifiIface[] {
  const out: WifiIface[] = []
  for (const b of wifiBands(cfg)) {
    for (const i of b.ifaces ?? []) out.push({ ...i, band: b.band, device: b.device })
  }
  return out
}

/** 主接口（非访客、非 IoT） */
export function mainIfaces(cfg: WifiCfg | null): WifiIface[] {
  return wifiList(cfg).filter((i) => !i.guest && !i.iot)
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** 读-改-写：按接口名合并 patch（闭源驱动要求整包回写 res[]） */
export async function saveWifiIface(name: string, patch: Partial<WifiIface>): Promise<void> {
  const cfg = clone((await api.call<WifiCfg>('wifi', 'get_config')) || {})
  let hit = false
  for (const b of cfg.res ?? []) {
    for (const it of b.ifaces ?? []) {
      if (it.name === name) {
        Object.assign(it, patch)
        if (patch.password) {
          it.key = patch.password
          delete it.password
        }
        hit = true
      }
    }
  }
  if (!hit) throw new Error(`未找到接口 ${name}`)
  await api.call('wifi', 'set_config', cfg as Record<string, unknown>)
}

/** 按频段合并 patch（channel / htmode / txpower） */
export async function saveWifiBand(band: string, patch: Partial<WifiBandConf>): Promise<void> {
  const cfg = clone((await api.call<WifiCfg>('wifi', 'get_config')) || {})
  let hit = false
  for (const b of cfg.res ?? []) {
    if (String(b.band).toUpperCase() === String(band).toUpperCase()) {
      Object.assign(b, patch)
      hit = true
    }
  }
  if (!hit) throw new Error(`未找到频段 ${band}`)
  await api.call('wifi', 'set_config', cfg as Record<string, unknown>)
}

export const getMlo = () => api.call<Record<string, unknown>>('wifi', 'get_mlo_config')
export const setMlo = (p: Record<string, unknown>) => api.call('wifi', 'set_mlo_config', p)

/** 信道扫描（原厂无线页没有独立 scan，走 repeater.scan） */
export interface ScanAp {
  ssid?: string
  bssid?: string
  channel?: number | string
  signal?: number
  encryption?: string
  band?: string
}
export const scanWifi = async (): Promise<ScanAp[]> => {
  const r = await api.call<any>('repeater', 'scan')
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.res)) return r.res
  if (Array.isArray(r?.list)) return r.list
  return []
}

/* ---------------- 黑白名单 ---------------- */
export interface BwlCfg {
  mode?: string
  black_mac?: string[]
  white_mac?: string[]
  [k: string]: unknown
}
export const getBwl = () => api.call<BwlCfg>('black_white_list', 'get_config')
export const setBwl = (p: Partial<BwlCfg>) => api.call('black_white_list', 'set_config', p as Record<string, unknown>)

/* ---------------- 局域网 / DHCP ---------------- */
export const getLanConfig = () => api.call<any>('lan', 'get_config_list')
export const setLanConfig = (p: Record<string, unknown>) => api.call('lan', 'set_config', p)
export const getStaticBind = () => api.call<any>('lan', 'get_static_bind_list')
export const addStaticBind = (p: Record<string, unknown>) => api.call('lan', 'add_static_bind', p)
export const delStaticBind = (p: Record<string, unknown>) => api.call('lan', 'remove_static_bind', p)

/* ---------------- 防火墙：端口映射 / DMZ / 访问控制 ---------------- */
export const getPortForward = () => api.call<any>('firewall', 'get_port_forward_list')
export const addPortForward = (p: Record<string, unknown>) => api.call('firewall', 'add_port_forward', p)
export const setPortForward = (p: Record<string, unknown>) => api.call('firewall', 'set_port_forward', p)
export const delPortForward = (p: Record<string, unknown>) => api.call('firewall', 'remove_port_forward', p)
export const getDmz = () => api.call<any>('firewall', 'get_dmz')
export const setDmz = (p: Record<string, unknown>) => api.call('firewall', 'set_dmz', p)
export const getZones = () => api.call<any>('firewall', 'get_zone_list')

export const getRules = () => api.call<any>('firewall', 'get_rule_list')
export const addRule = (p: Record<string, unknown>) => api.call('firewall', 'add_rule', p)
export const setRule = (p: Record<string, unknown>) => api.call('firewall', 'set_rule', p)
export const delRule = (p: Record<string, unknown>) => api.call('firewall', 'remove_rule', p)
export const getWanAccess = () => api.call<any>('firewall', 'get_wan_access')
export const setWanAccess = (p: Record<string, unknown>) => api.call('firewall', 'set_wan_access', p)

/* ---------------- 更多网络设置 ---------------- */
export const getAdvance = () => api.call<any>('network', 'get_advance_config')
export const setAdvance = (p: Record<string, unknown>) => api.call('network', 'set_advance_config', p)
export const getNetnat = () => api.call<any>('network', 'get_netnat_config')
export const setNetnat = (p: Record<string, unknown>) => api.call('network', 'set_netnat_config', p)

/* ---------------- 网络诊断 ---------------- */
export const ping = (target: string, count = 4) => api.call<any>('glass', 'diag_ping', { host: target, count })
export const traceroute = (target: string) => api.call<any>('glass', 'diag_trace', { host: target })
export const diagPort = (host: string, port: number) => api.call<any>('glass', 'diag_port', { host, port })

/* ---------------- 系统 ---------------- */
export const setPassword = (p: Record<string, unknown>) => api.call('system', 'set_password', p)
export const reboot = () => api.call('system', 'reboot')

export const getTimer = (kind: 'reboot' | 'wifi' | 'led' | 'screen') => api.call<any>('timer', `get_${kind}`)
export const setTimer = (kind: 'reboot' | 'wifi' | 'led' | 'screen', p: Record<string, unknown>) =>
  api.call('timer', `set_${kind}`, p)

export const getLog = (kind: 'system' | 'kernel' | 'crash' | 'nginx', p: Record<string, unknown> = {}) =>
  api.call<any>('logread', `get_${kind}_log`, p)
export const getLogConfig = () => api.call<any>('logread', 'get_config')
export const setLogConfig = (p: Record<string, unknown>) => api.call('logread', 'set_config', p)

export const getLed = () => api.call<any>('led', 'get_config')
export const setLed = (p: Record<string, unknown>) => api.call('led', 'set_config', p)

export const getSwitchButton = () => api.call<any>('switch-button', 'get_config')
export const setSwitchButton = (p: Record<string, unknown>) => api.call('switch-button', 'set_config', p)
export const getSwitchFuncs = () => api.call<any>('switch-button', 'get_funcs')

/* ---------------- 风扇：优先插件 fanctrl，退回原厂 fan ---------------- */
export interface FanState {
  source: 'fanctrl' | 'fan'
  enabled?: boolean
  mode?: string
  start_temp?: number
  wall_temp?: number
  critical_temp?: number
  hysteresis?: number
  start_percent?: number
  max_percent?: number
  manual_percent?: number
  poll_interval?: number
  speed?: number | null
  temp?: number | null
  raw?: Record<string, unknown>
}

export async function getFan(): Promise<FanState | null> {
  try {
    const r = await api.call<any>('fanctrl', 'get_status')
    if (r) return { source: 'fanctrl', ...(r as object) } as FanState
  } catch {
    /* 插件没装 */
  }
  try {
    const r = await api.call<any>('fan', 'get_status')
    if (r) return { source: 'fan', ...(r as object) } as FanState
  } catch {
    /* 无风扇对象 */
  }
  return null
}

export async function saveFan(patch: Record<string, unknown>, source: FanState['source']): Promise<void> {
  if (source === 'fanctrl') await api.call('fanctrl', 'set_config', patch)
  else await api.call('fan', 'set_config', patch)
}

export async function fanManual(percent: number): Promise<void> {
  await api.call('fanctrl', 'set_manual', { manual_percent: percent })
}

/* ---------------- 联网检测（对齐原厂：走 kmwan 链路跟踪，不看 wan 标志） ---------------- */
export interface ConnIface {
  name: string
  online: boolean
  status?: string
  ip?: string
  gateway?: string
  latency?: number | null
  weight?: number
}

export interface ConnState {
  /** 真的能上网 */
  ok: boolean
  level: 'ok' | 'link' | 'down'
  active?: string
  ifaces: ConnIface[]
  latency?: number | null
  checkedAt: number
  source: 'kmwan' | 'probe'
}

function pickArr(r: any): any[] {
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.data)) return r.data
  if (Array.isArray(r?.list)) return r.list
  if (Array.isArray(r?.interfaces)) return r.interfaces
  if (r && typeof r === 'object') {
    const out: any[] = []
    for (const [k, v] of Object.entries(r)) {
      if (v && typeof v === 'object') out.push({ name: k, ...(v as object) })
    }
    return out
  }
  return []
}

const isUp = (s?: string) =>
  !!s && /^(up|online|connected|active|ok|1|true)$/i.test(s)

/** 联网检测：kmwan.get_status → 逐接口跟踪状态；无 kmwan 时退回 cable + 真实 ping */
export async function getConn(): Promise<ConnState> {
  // 1) 首选自有 Lua 模块的 conn_check（原厂 4.9 没有这个 RPC，参考实现也是自己写的后端）
  try {
    const r = await withTimeout(api.call<any>('glass', 'conn_check'), 5000, 'glass.conn_check')
    if (r && typeof r.online === 'boolean') {
      return {
        ok: !!r.online,
        level: (r.level as ConnState['level']) || (r.online ? 'ok' : 'down'),
        active: r.iface || undefined,
        ifaces: [
          {
            name: r.iface || 'wan',
            online: !!r.online,
            status: r.online ? 'online' : r.gateway_ok ? 'gateway only' : 'offline',
            ip: '',
            gateway: r.gateway || '',
            latency: r.latency ?? null,
          },
        ],
        latency: typeof r.latency === 'number' ? r.latency : null,
        checkedAt: (r.checked_at ? r.checked_at * 1000 : Date.now()),
        source: 'kmwan',
      }
    }
  } catch {
    /* 模块未装或旧版本 */
  }

  // 2) kmwan 链路跟踪
  try {
    const r = await api.call<any>('kmwan', 'get_status')
    const raw = pickArr(r)
    const ifaces: ConnIface[] = raw.map((it) => ({
      name: String(it.name ?? it.interface ?? it.iface ?? '—'),
      online: isUp(it.status) || it.online === true || isUp(it.state) || it.alive === true,
      status: String(it.status ?? it.state ?? ''),
      ip: it.ip ?? it.ipv4 ?? it.address ?? '',
      gateway: it.gateway ?? it.gw ?? '',
      latency: it.latency ?? it.rtt ?? it.ping ?? null,
      weight: it.weight,
    }))
    if (ifaces.length) {
      const act = ifaces.find((i) => i.online)
      const latency = act?.latency ?? null
      return {
        ok: !!act,
        level: act ? 'ok' : ifaces.some((i) => i.ip) ? 'link' : 'down',
        active: act?.name,
        ifaces,
        latency: typeof latency === 'number' ? latency : null,
        checkedAt: Date.now(),
        source: 'kmwan',
      }
    }
  } catch {
    /* 没有 kmwan，走探针 */
  }

  // 退回：链路状态 + 真实可达性探测（不是看 up 标志）
  let ip = ''
  try {
    const c = await api.call<any>('cable', 'get_config', { secondwan: false, usbwan: false })
    ip = c?.ipv4?.ip ?? c?.ipv4 ?? c?.ip ?? ''
    if (typeof ip !== 'string') ip = ''
  } catch {
    /* ignore */
  }

  let ok = false
  let latency: number | null = null
  for (const host of ['223.5.5.5', '1.1.1.1']) {
    try {
      const p = await api.call<any>('diag', 'ping', { target: host, host, count: 1 })
      const text = String(p?.output ?? p?.result ?? '')
      const m = text.match(/time[=<]\s*([\d.]+)\s*ms/)
      if (m || /1 (packets )?received|1 received/i.test(text)) {
        ok = true
        latency = m ? Number(m[1]) : null
        break
      }
    } catch {
      /* 换下一个目标 */
    }
  }

  return {
    ok,
    level: ok ? 'ok' : ip ? 'link' : 'down',
    active: ok || ip ? 'wan' : undefined,
    ifaces: [{ name: 'wan', online: ok, ip, latency }],
    latency,
    checkedAt: Date.now(),
    source: 'probe',
  }
}


/* ---------------- WAN 健康检查（wanchk）与静态路由，走自有 Lua ---------------- */
export const wanchkGet = () => api.call<any>('glass', 'wanchk_get')
export const wanchkSet = (p: Record<string, unknown>) => api.call('glass', 'wanchk_set', p)
export const routeList = () => api.call<any>('glass', 'route_list')
export const routeSave = (p: Record<string, unknown>) => api.call<any>('glass', 'route_save', p)
export const routeDel = (id: string) => api.call<any>('glass', 'route_del', { id })


/** 一次读改写：同时改主接口与所在频段（闭源驱动一次 set_config 落地） */
export async function saveWifiFull(
  band: string,
  ifaceName: string,
  ifacePatch: Partial<WifiIface>,
  bandPatch: Partial<WifiBandConf> = {},
): Promise<void> {
  const cfg = clone((await api.call<WifiCfg>('wifi', 'get_config')) || {})
  let hit = false
  for (const b of cfg.res ?? []) {
    if (String(b.band).toUpperCase() !== String(band).toUpperCase()) continue
    Object.assign(b, bandPatch)
    for (const it of b.ifaces ?? []) {
      if (it.name !== ifaceName) continue
      Object.assign(it, ifacePatch)
      if (ifacePatch.password) {
        it.key = ifacePatch.password
        delete it.password
      }
      hit = true
    }
  }
  if (!hit) throw new Error(`未找到接口 ${ifaceName}`)
  await api.call('wifi', 'set_config', cfg as Record<string, unknown>)
}
