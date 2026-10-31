import { api } from '@/api'
import { nui } from '@/api/nui'
import type { WifiBandConf, WifiCfg, WifiIface } from './ext'

/**
 * fe-core 数据层：概览 / 互联网 / 无线 / 终端 四页的 RPC 封装。
 *
 * 约定（对齐 docs/api-official.md）：
 *  - 方法名一律以官方视图 bundle 的实测调用为准，不猜 get_config/get_status；
 *  - GL 的业务错误可能出现在 result.err_code/err_msg（HTTP 仍 200），这里统一抛 Error；
 *  - 页面需要的多源数据用 attempt() 并行取，单块失败不影响整页（返回 errors[] 供降级文案）；
 *  - 写操作统一「读当前配置 → 合并 → 写 → 回读确认」，写接口入参结构见每个函数注释。
 */

export type AnyRec = Record<string, any>

export const isObj = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v)

export function errText(e: unknown): string {
  if (!e) return '未知错误'
  if (typeof e === 'string') return e
  const any = e as AnyRec
  const m = any?.rpc?.message ?? any?.message ?? any?.err_msg
  if (m) return String(m)
  try {
    return JSON.stringify(e).slice(0, 200)
  } catch {
    return String(e)
  }
}

/** 浏览器侧硬超时：断网时后端探测请求可能很慢，页面不能跟着无限等待 */
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

/** 带业务错误判定的调用：result.err_code/err_msg 也当失败；opts.timeout 用于扫描/写配置等长任务 */
export async function rpc<T = any>(
  obj: string,
  method: string,
  args: Record<string, unknown> = {},
  opts: { timeout?: number } = {},
): Promise<T> {
  const r = await api.call<T>(obj, method, args, opts)
  if (isObj(r) && (r.err_code != null || r.err_msg)) {
    throw new Error(String(r.err_msg || `业务错误 ${r.err_code}`))
  }
  return r
}

export interface Sourced<T> {
  ok: boolean
  data: T | null
  error?: string
}

/** 安全调用：失败不抛，页面按块降级 */
export async function attempt<T>(p: Promise<T>): Promise<Sourced<T>> {
  try {
    return { ok: true, data: await p }
  } catch (e) {
    return { ok: false, data: null, error: errText(e) }
  }
}

/** NUI 插件桥（可用性由 be-lua 的 rpc/nui 决定，失败返回 null） */
export async function nuiData<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return nui.invoke<T>(method, args)
}

const toNum = (v: unknown, d = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

export function egressLabel(name: string): string {
  const n = String(name || '').toLowerCase()
  if (n === 'wan') return '以太网 WAN'
  if (n === 'secondwan') return '第二 WAN'
  if (n === 'wwan') return 'WWAN（中继 / 模组）'
  if (n === 'tethering') return 'USB 网络共享'
  if (n === 'apcli0' || n === 'apclii0') return '中继上行'
  if (n.endsWith('6')) return `${name}（IPv6）`
  return name || '—'
}

export function fmtIpList(v: unknown): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || '—'
  if (v == null || v === '') return '—'
  return String(v)
}

/* ==========================================================================
 * 1. 概览
 * ========================================================================== */

export interface HealthEx {
  source: 'glass' | 'system'
  cpu: number | null
  cores: number[]
  memTotal: number
  memUsed: number
  memAvailable: number
  memCached: number
  memFree: number
  disk: { total: number; used: number; available: number; percent: number } | null
  temps: { name: string; temp: number }[]
  fan: { speed: number | null; status: boolean; percent: number | null } | null
  load: number[]
  uptime: number
  localtime: number | null
  hostname: string
  note: string
}

/** 健康指标：优先 glass.get_status；没部署 glass 时退回官方 system.get_status/get_load + fan + NUI enh.overview/sys.details */
export async function loadHealth(): Promise<HealthEx> {
  const g = await attempt(rpc<AnyRec>('glass', 'get_status'))
  if (g.ok && isObj(g.data) && (Array.isArray(g.data.cpu) || isObj(g.data.memory))) {
    const d = g.data
    const mem = isObj(d.memory) ? d.memory : {}
    const fan = isObj(d.fan) ? d.fan : null
    return {
      source: 'glass',
      cpu: d.cpu_avg == null ? null : toNum(d.cpu_avg),
      cores: Array.isArray(d.cpu) ? d.cpu.map((x: unknown) => (x == null ? 0 : toNum(x))) : [],
      memTotal: toNum(mem.total),
      memUsed: toNum(mem.used),
      memAvailable: toNum(mem.available),
      memCached: toNum(mem.cached),
      memFree: toNum(mem.free),
      disk: isObj(d.disk)
        ? {
            total: toNum(d.disk.total),
            used: toNum(d.disk.used),
            available: toNum(d.disk.available),
            percent: toNum(d.disk.percent),
          }
        : null,
      temps: Array.isArray(d.temps)
        ? d.temps.filter((t: AnyRec) => t && typeof t.temp === 'number').map((t: AnyRec) => ({ name: String(t.name), temp: toNum(t.temp) }))
        : [],
      fan: fan ? { speed: fan.speed == null ? null : toNum(fan.speed), status: !!fan.status, percent: null } : null,
      load: Array.isArray(d.load) ? d.load.map((x: unknown) => toNum(x)) : [0, 0, 0],
      uptime: toNum(d.uptime),
      localtime: d.localtime == null ? null : toNum(d.localtime),
      hostname: String(d.hostname ?? ''),
      note: '',
    }
  }

  // ---- 兜底：官方对象 + NUI 桥 ----
  const [st, ld, fan, ov, det] = await Promise.all([
    attempt(rpc<AnyRec>('system', 'get_status')),
    attempt(rpc<AnyRec>('system', 'get_load')),
    attempt(rpc<AnyRec>('fan', 'get_status')),
    attempt(nuiData<AnyRec>('enh.overview')),
    attempt(nuiData<AnyRec>('sys.details')),
  ])
  const sys = isObj(st.data?.system) ? st.data!.system : {}
  const load = isObj(ld.data) ? ld.data : {}
  const dmem = isObj(det.data?.memory) ? det.data!.memory : {}
  const total = toNum(sys.memory_total) || toNum(load.memory_total) || toNum(dmem.total)
  const available = toNum(dmem.available) || toNum(sys.memory_available)
  const used = total && available ? total - available : total - toNum(sys.memory_free) - toNum(sys.memory_buff_cache)
  const temps: { name: string; temp: number }[] = []
  const socTemp = toNum(sys.cpu?.temperature, -1)
  if (socTemp >= 0 && socTemp !== 0) temps.push({ name: 'soc_thermal', temp: socTemp })
  const fanInfo = isObj(ov.data?.fan) ? ov.data!.fan : null
  if (fanInfo && isObj(fanInfo.temps)) {
    for (const [k, v] of Object.entries(fanInfo.temps)) {
      if (typeof v === 'number') temps.push({ name: `${k}_thermal`, temp: v })
    }
  }
  const storage = Array.isArray(det.data?.storage) ? (det.data!.storage as AnyRec[]) : []
  const overlay = storage.find((s) => String(s.mount) === '/overlay') || null
  const up = toNum(sys.uptime) || toNum(det.data?.runtime?.uptime)
  return {
    source: 'system',
    cpu: null,
    cores: [],
    memTotal: total,
    memUsed: Math.max(0, used),
    memAvailable: available,
    memCached: toNum(sys.memory_buff_cache) || toNum(dmem.cached),
    memFree: toNum(sys.memory_free) || toNum(dmem.free),
    disk: overlay
      ? { total: toNum(overlay.total), used: toNum(overlay.used), available: toNum(overlay.avail), percent: 0 }
      : null,
    temps,
    fan: fan.ok && isObj(fan.data)
      ? { speed: fan.data.speed == null ? null : toNum(fan.data.speed), status: !!fan.data.status, percent: fanInfo ? toNum(fanInfo.percent) : null }
      : null,
    load: Array.isArray(load.load_average) ? load.load_average.map((x: unknown) => toNum(x)) : [0, 0, 0],
    uptime: up,
    localtime: toNum(det.data?.runtime?.localtime) || null,
    hostname: String(det.data?.device?.hostname ?? ''),
    note: g.error
      ? `glass 扩展不可用（${g.error}），CPU 占用率/各核与多传感器温度已降级为官方 system 数据`
      : '',
  }
}

export interface EgressIface {
  name: string
  up: boolean
  online: boolean
}

export interface ExternalIp {
  ipv4?: string
  ipv6?: string
  location?: string
  isp?: string
  time?: string
  source?: string
}

export interface WanInfoEx {
  interface: string
  ip: string
  netmask: string
  gateway: string
  dns: string[]
  prefix: number | null
}

export interface DdnsState {
  enabled: boolean
  deviceId: string
  domain: string
  status: number
  ips: { interface: string; ip: string[] }[]
}

export interface RepeaterBrief {
  ssid: string
  bssid: string
  signal: number | null
  ip: string
  gateway: string
  dns: string[]
  connected: string
  band: string
  htmode: string
  channel: number | null
  running: boolean
  encryption: string
  portal: boolean
}

export interface OverviewNet {
  mode: string
  egress: string
  egressLabel: string
  network: EgressIface[]
  external: ExternalIp | null
  publicIp: string
  ddns: DdnsState | null
  wanInfo: WanInfoEx | null
  cable: { inserted: boolean; enabled: boolean; protocol: string; initInternet: boolean } | null
  repeater: RepeaterBrief | null
  tethering: { devices: number; status: number } | null
  errors: string[]
}

function briefRepeater(r: unknown): RepeaterBrief | null {
  if (!isObj(r)) return null
  const v4 = isObj(r.ipv4) ? r.ipv4 : {}
  let encryption = ''
  const wpa = isObj(r.wpa_status) ? r.wpa_status : null
  if (wpa) encryption = String(wpa.key_mgmt ?? '')
  return {
    ssid: String(r.ssid ?? ''),
    bssid: String(r.bssid ?? ''),
    signal: r.signal == null ? null : toNum(r.signal),
    ip: String(v4.ip ?? '').split('/')[0] ?? '',
    gateway: String(v4.gateway ?? ''),
    dns: Array.isArray(v4.dns) ? v4.dns.map((x: unknown) => String(x)) : [],
    connected: String(r.connected ?? ''),
    band: String(r.band ?? ''),
    htmode: String(r.htmode ?? ''),
    channel: r.channel == null ? null : toNum(r.channel),
    running: !!r.running,
    encryption,
    portal: !!r.portal,
  }
}

export async function loadOverviewNet(): Promise<OverviewNet> {
  const [st, wanInfo, cableCheck, cableCfg, rep, ddnsCfg, ddnsStatus, ext, mode] = await Promise.all([
    attempt(rpc<AnyRec>('system', 'get_status')),
    attempt(rpc<AnyRec>('lan', 'get_wan_info')),
    attempt(rpc<AnyRec>('network', 'check_wan_cable')),
    attempt(rpc<AnyRec>('cable', 'get_config', { secondwan: false, usbwan: false })),
    attempt(rpc<AnyRec>('repeater', 'get_status')),
    attempt(rpc<AnyRec>('ddns', 'get_config')),
    attempt(rpc<AnyRec>('ddns', 'get_status')),
    attempt(withTimeout(nuiData<AnyRec>('net.public_ip'), 3500, 'net.public_ip')),
    attempt(rpc<AnyRec>('netmode', 'get_mode')),
  ])
  const errors: string[] = []
  for (const [tag, s] of [
    ['system.get_status', st],
    ['lan.get_wan_info', wanInfo],
    ['network.check_wan_cable', cableCheck],
    ['cable.get_config', cableCfg],
    ['repeater.get_status', rep],
    ['ddns.get_config', ddnsCfg],
    ['ddns.get_status', ddnsStatus],
    ['nui net.public_ip', ext],
    ['netmode.get_mode', mode],
  ] as const) {
    if (!s.ok) errors.push(`${tag}: ${s.error}`)
  }

  const netArr: EgressIface[] = Array.isArray(st.data?.network)
    ? (st.data!.network as AnyRec[])
        .filter((x) => !String(x.interface).endsWith('6'))
        .map((x) => ({ name: String(x.interface), up: !!x.up, online: !!x.online }))
    : []
  // 真正的当前出口：up=true 的接口优先；官方 system.get_status 的 up 才代表链路真实状态
  const upList = netArr.filter((x) => x.up)
  const egress = upList[0]?.name ?? netArr.find((x) => x.online)?.name ?? ''

  // WAN 地址信息（lan.get_wan_info 的 wan_info 数组，取 up 的那条）
  let wan: WanInfoEx | null = null
  const wi = Array.isArray(wanInfo.data?.wan_info) ? (wanInfo.data!.wan_info as AnyRec[]) : []
  const pickWan = wi.find((x) => String(x.info?.ipaddr ?? x.info?.ip ?? '') !== '') ?? wi[0]
  if (pickWan && isObj(pickWan.info)) {
    wan = {
      interface: String(pickWan.interface ?? ''),
      ip: String(pickWan.info.ipaddr ?? pickWan.info.ip ?? ''),
      netmask: String(pickWan.info.netmask ?? ''),
      gateway: String(pickWan.info.gateway ?? ''),
      dns: Array.isArray(pickWan.info.dns) ? pickWan.info.dns.map((x: unknown) => String(x)) : [],
      prefix: pickWan.info.prefix == null ? null : toNum(pickWan.info.prefix),
    }
  }

  const repBrief = briefRepeater(rep.data)
  if (wan) {
    if (!wan.gateway && repBrief?.gateway) wan.gateway = repBrief.gateway
    if (!wan.dns.length && repBrief?.dns.length) wan.dns = repBrief.dns
  }

  const cfg = isObj(ddnsCfg.data) ? ddnsCfg.data : null
  const dst = isObj(ddnsStatus.data) ? ddnsStatus.data : null
  const ddns: DdnsState | null = cfg
    ? {
        enabled: !!cfg.enable_ddns,
        deviceId: String(cfg.device_id ?? ''),
        domain: cfg.device_id ? `${cfg.device_id}.glddns.com` : '',
        status: toNum(dst?.status),
        ips: Array.isArray(dst?.ips)
          ? (dst!.ips as AnyRec[]).map((x) => ({
              interface: String(x.interface ?? ''),
              ip: Array.isArray(x.ip) ? x.ip.map((v: unknown) => String(v)) : [],
            }))
          : [],
      }
    : null

  const external: ExternalIp | null = isObj(ext.data)
    ? {
        ipv4: ext.data.ipv4 ? String(ext.data.ipv4) : '',
        ipv6: ext.data.ipv6 ? String(ext.data.ipv6) : '',
        location: String(ext.data.location ?? ''),
        isp: String(ext.data.isp ?? ''),
        time: String(ext.data.time ?? ''),
        source: String(ext.data.source ?? ''),
      }
    : null

  const ddnsWwanIp = ddns?.ips.find((x) => x.interface === 'wwan' && x.ip.length)?.ip[0] ?? ''
  const publicIp = external?.ipv4 || ddnsWwanIp || wan?.ip || ''

  return {
    mode: String(mode.data?.mode ?? ''),
    egress,
    egressLabel: egressLabel(egress),
    network: netArr,
    external,
    publicIp,
    ddns,
    wanInfo: wan,
    cable: cableCheck.ok && isObj(cableCheck.data)
      ? {
          inserted: !!cableCheck.data.cable_inserted,
          enabled: !!cableCheck.data.cable_enabled,
          protocol: String(cableCfg.data?.protocol ?? ''),
          initInternet: false,
        }
      : null,
    repeater: repBrief,
    tethering: null,
    errors,
  }
}

export interface ConnIfaceState {
  name: string
  up: boolean
  online: boolean
  ip: string
  note: string
}

export interface ConnResult {
  level: 'ok' | 'link' | 'down'
  online: boolean
  iface: string
  gateway: string
  latency: number | null
  dnsOk: boolean | null
  gatewayOk: boolean | null
  source: string
  checkedAt: number
  ifaces: ConnIfaceState[]
  errors: string[]
}

/** 联网检测：glass.conn_check 优先（默认路由 → 网关 → 外网 ping → DNS），无 glass 时用 kmwan + 公网 IP 兜底 */
export async function loadConn(net?: OverviewNet | null): Promise<ConnResult> {
  const g = await attempt(withTimeout(rpc<AnyRec>('glass', 'conn_check'), 5000, 'glass.conn_check'))
  const errors: string[] = []
  const base = net ?? (await loadOverviewNet())
  const ifaces: ConnIfaceState[] = base.network.map((x) => ({
    name: x.name,
    up: x.up,
    online: x.online,
    ip: '',
    note: x.up ? '链路已启用' : '链路未启用',
  }))
  if (wanIpFor(base) && !ifaces.length) {
    ifaces.push({ name: base.egress || 'wan', up: true, online: true, ip: wanIpFor(base), note: '当前出口' })
  }

  if (g.ok && isObj(g.data) && typeof g.data.online === 'boolean') {
    const d = g.data
    const level = (String(d.level ?? '') as ConnResult['level']) || (d.online ? 'ok' : 'down')
    const hit = ifaces.find((i) => i.name === String(d.iface ?? ''))
    if (hit) {
      hit.ip = wanIpFor(base)
      hit.note = d.online ? '可上网' : d.gateway_ok ? '仅网关可达' : '不可达'
    }
    return {
      level,
      online: !!d.online,
      iface: String(d.iface ?? ''),
      gateway: String(d.gateway ?? ''),
      latency: d.latency == null ? (d.gateway_latency == null ? null : toNum(d.gateway_latency)) : toNum(d.latency),
      dnsOk: typeof d.dns_ok === 'boolean' ? d.dns_ok : null,
      gatewayOk: typeof d.gateway_ok === 'boolean' ? d.gateway_ok : null,
      source: 'glass.conn_check',
      checkedAt: d.checked_at ? toNum(d.checked_at) * 1000 : Date.now(),
      ifaces,
      errors,
    }
  }
  if (!g.ok) errors.push(`glass.conn_check: ${g.error}`)

  // 兜底：kmwan 链路跟踪 + 公网 IP 可达性
  const [km, pub] = await Promise.all([
    attempt(rpc<AnyRec>('kmwan', 'get_status')),
    attempt(withTimeout(nuiData<AnyRec>('net.public_ip'), 3500, 'net.public_ip')),
  ])
  if (!km.ok) errors.push(`kmwan.get_status: ${km.error}`)
  const kmIfaces = Array.isArray(km.data?.interfaces) ? (km.data!.interfaces as AnyRec[]) : []
  for (const k of kmIfaces) {
    const name = String(k.interface ?? '')
    const hit = ifaces.find((i) => i.name === name)
    const online = toNum(k.status_v4) > 0
    if (hit) {
      hit.note = online ? '跟踪正常' : '跟踪失败'
    } else {
      ifaces.push({ name, up: online, online, ip: '', note: online ? '跟踪正常' : '跟踪失败' })
    }
  }
  const pubIp = String(pub.data?.ipv4 ?? '')
  const anyUp = ifaces.some((i) => i.up)
  const online = !!pubIp || (g.ok && !!g.data?.online)
  return {
    level: !g.ok && online ? 'ok' : !g.ok && anyUp ? 'link' : online ? 'ok' : anyUp ? 'link' : 'down',
    online,
    iface: base.egress,
    gateway: base.wanInfo?.gateway ?? base.repeater?.gateway ?? '',
    latency: null,
    dnsOk: null,
    gatewayOk: null,
    source: pubIp ? 'NUI 公网 IP 探测' : 'kmwan 链路跟踪',
    checkedAt: Date.now(),
    ifaces,
    errors,
  }
}

function wanIpFor(net: OverviewNet): string {
  return net.wanInfo?.ip || net.repeater?.ip || ''
}

export interface ModemState {
  present: boolean
  buildInModem: string
  devices: string[]
  bus: string
  sims: AnyRec[]
  modules: AnyRec[]
  smsSupport: boolean
  signalSupport: boolean
  slotNum: number
  diagnostics: string[]
}

/** 蜂窝模组状态卡：本机（Beryl 7）无模组 → present=false + 具体诊断文案 */
export async function loadModem(): Promise<ModemState> {
  const [dbg, info, cellMods] = await Promise.all([
    attempt(rpc<AnyRec>('modem', 'get_debug_msg')),
    attempt(rpc<AnyRec>('system', 'get_info')),
    attempt(nuiData<AnyRec[]>('cell.modules')),
  ])
  const d = isObj(dbg.data) ? dbg.data : {}
  const mi = isObj(d.modem_info) ? d.modem_info : {}
  const ms = isObj(d.modem_status) ? d.modem_status : {}
  const simInfo = isObj(d.sim_info) ? d.sim_info : {}
  const sims = Array.isArray(simInfo.sims) ? (simInfo.sims as AnyRec[]) : []
  const devices = Array.isArray(mi.devices) ? mi.devices.map((x: unknown) => String(x)) : []
  const modules = Array.isArray(cellMods.data) ? (cellMods.data as AnyRec[]) : []
  const buildInModem = String(info.data?.hardware_feature?.build_in_modem ?? '')
  const present = devices.length > 0 || modules.length > 0 || sims.length > 0
  const diagnostics: string[] = []
  if (!buildInModem) diagnostics.push('固件 hardware_feature.build_in_modem 为空：该型号没有内置蜂窝模组')
  if (!devices.length) diagnostics.push('modem.get_debug_msg 未返回任何设备（无 USB/PCIe 模组枚举）')
  if (!sims.length) diagnostics.push('cellular SIM 列表为空：未检测到 SIM 卡')
  if (mi.sms_support === false) diagnostics.push('固件报告 sms_support=false：短信能力不可用')
  if (!('bus' in ms) || !ms.bus) diagnostics.push('modem_status.bus 为空：没有可用的蜂窝总线（本机蜂窝由中继上网代替）')
  return {
    present,
    buildInModem,
    devices,
    bus: String(ms.bus ?? ''),
    sims,
    modules,
    smsSupport: !!mi.sms_support,
    signalSupport: !!mi.signal_support,
    slotNum: toNum(mi.sim_slot_num),
    diagnostics,
  }
}

export interface SsidState {
  name: string
  ssid: string
  band: string
  up: boolean
  guest: boolean
  iot: boolean
  encryption: string
  hidden: boolean
}

export interface SummaryState {
  clients: { total: number; online: number; cable: number; wireless: number; list: AnyRec[] }
  ssids: SsidState[]
  cloud: { enabled: boolean; bindtype: string; bound: boolean; apiUrl: string } | null
  vpn: { name: string; running: boolean }[]
  lan: { ip: string; guestIp: string; iotIp: string; netmask: string } | null
  wifiUp: number
  wifiTotal: number
  errors: string[]
}

const VPN_SERVICES = ['wgserver', 'ovpnserver', 'tailscale', 'zerotier', 'tor', 'mptun']

export async function loadSummary(): Promise<SummaryState> {
  const [st, clients, cloud] = await Promise.all([
    attempt(rpc<AnyRec>('system', 'get_status')),
    attempt(rpc<AnyRec>('clients', 'get_list')),
    attempt(rpc<AnyRec>('cloud', 'get_config')),
  ])
  const errors: string[] = []
  if (!st.ok) errors.push(`system.get_status: ${st.error}`)
  if (!clients.ok) errors.push(`clients.get_list: ${clients.error}`)
  if (!cloud.ok) errors.push(`cloud.get_config: ${cloud.error}`)

  const sys = isObj(st.data?.system) ? st.data!.system : {}
  const clientArr = Array.isArray(clients.data?.clients) ? (clients.data!.clients as AnyRec[]) : []
  const onlineList = clientArr.filter((c) => c.online !== false)
  const cable = onlineList.filter((c) => /cable|eth|wired/i.test(String(c.iface ?? ''))).length
  const wireless = onlineList.length - cable

  const ssids: SsidState[] = Array.isArray(st.data?.wifi)
    ? (st.data!.wifi as AnyRec[]).map((w) => ({
        name: String(w.name ?? ''),
        ssid: String(w.ssid ?? ''),
        band: String(w.band ?? ''),
        up: !!w.up,
        guest: !!w.guest,
        iot: !!w.iot,
        encryption: String(w.encryption ?? ''),
        hidden: !!w.hidden,
      }))
    : []

  const services: AnyRec[] = Array.isArray(st.data?.service) ? (st.data!.service as AnyRec[]) : []
  const vpn = VPN_SERVICES.map((name) => {
    const hit = services.find((s) => String(s.name) === name)
    return { name, running: toNum(hit?.status) > 0 }
  })
  const cfg = isObj(cloud.data) ? cloud.data : null
  return {
    clients: {
      total: clientArr.length,
      online: onlineList.length,
      cable,
      wireless,
      list: onlineList,
    },
    ssids,
    cloud: cfg
      ? {
          enabled: !!cfg.cloud_enable,
          bindtype: String(cfg.bindtype ?? ''),
          bound: !!cfg.bindtype,
          apiUrl: String(cfg.api_url ?? ''),
        }
      : null,
    vpn,
    lan: isObj(st.data?.system)
      ? {
          ip: String(sys.lan_ip ?? ''),
          guestIp: String(sys.guest_ip ?? ''),
          iotIp: String(sys.iot_ip ?? ''),
          netmask: String(sys.lan_netmask ?? ''),
        }
      : null,
    wifiUp: ssids.filter((s) => s.up).length,
    wifiTotal: ssids.length,
    errors,
  }
}

export interface FanConfig {
  warnTemperature: number | null
  threshold: number | null
  speed: number | null
  status: boolean
}

/** 官方风扇对象（非 fanctrl）：fan.get_status 转速 + fan.get_config 告警阈值 */
export async function loadFan(): Promise<FanConfig | null> {
  const [st, cfg] = await Promise.all([
    attempt(rpc<AnyRec>('fan', 'get_status')),
    attempt(rpc<AnyRec>('fan', 'get_config')),
  ])
  if (!st.ok && !cfg.ok) return null
  return {
    warnTemperature: cfg.data?.warn_temperature == null ? null : toNum(cfg.data.warn_temperature),
    threshold: cfg.data?.temperature == null ? null : toNum(cfg.data.temperature),
    speed: st.data?.speed == null ? null : toNum(st.data.speed),
    status: !!st.data?.status,
  }
}

/* ==========================================================================
 * 2. 互联网（wan / multiwan）
 * ========================================================================== */

export interface CableIpv4 {
  ip?: string
  netmask?: string
  gateway?: string
  dns?: string[]
}

export interface CableConfig {
  protocol: string
  ipv4?: CableIpv4
  ipv6?: unknown
  username?: string
  password?: string
  vlanid?: number | null
  ttl?: number | null
  ttl_ipv6?: number | null
  mtu?: number | null
  [k: string]: unknown
}

export interface WanPage {
  mode: string
  netmode: string
  network: EgressIface[]
  wanInfo: WanInfoEx | null
  cable: {
    config: CableConfig | null
    ports: AnyRec[]
    portsStatus: AnyRec[]
    check: AnyRec | null
    init: AnyRec | null
  }
  repeater: AnyRec | null
  tethering: { config: AnyRec[]; status: AnyRec | null }
  external: ExternalIp | null
  ddns: { config: AnyRec | null; status: AnyRec | null }
  edge: { config: AnyRec | null; status: AnyRec | null }
  modem: ModemState
  errors: string[]
}

export async function loadWanPage(): Promise<WanPage> {
  const [st, netmode, wanInfo, cableCfg, ports, portsStatus, check, init, rep, tethCfg, tethStatus, ext, ddnsCfg, ddnsStatus, edgeCfg, edgeStatus, modem] =
    await Promise.all([
      attempt(rpc<AnyRec>('system', 'get_status')),
      attempt(rpc<AnyRec>('netmode', 'get_mode')),
      attempt(rpc<AnyRec>('lan', 'get_wan_info')),
      attempt(rpc<AnyRec>('cable', 'get_config', { secondwan: false, usbwan: false })),
      attempt(rpc<AnyRec>('cable', 'get_ports_config')),
      attempt(rpc<AnyRec>('cable', 'get_ports_status')),
      attempt(rpc<AnyRec>('network', 'check_wan_cable')),
      attempt(rpc<AnyRec>('cable', 'init_status')),
      attempt(rpc<AnyRec>('repeater', 'get_status')),
      attempt(rpc<AnyRec>('tethering', 'get_config')),
      attempt(rpc<AnyRec>('tethering', 'get_status')),
      attempt(withTimeout(nuiData<AnyRec>('net.public_ip'), 3500, 'net.public_ip')),
      attempt(rpc<AnyRec>('ddns', 'get_config')),
      attempt(rpc<AnyRec>('ddns', 'get_status')),
      attempt(rpc<AnyRec>('edgerouter', 'get_config')),
      attempt(rpc<AnyRec>('edgerouter', 'get_status')),
      loadModem(),
    ])
  const errors: string[] = []
  const tagErrors: [string, Sourced<any>][] = [
    ['system.get_status', st],
    ['netmode.get_mode', netmode],
    ['lan.get_wan_info', wanInfo],
    ['cable.get_config', cableCfg],
    ['cable.get_ports_config', ports],
    ['cable.get_ports_status', portsStatus],
    ['network.check_wan_cable', check],
    ['cable.init_status', init],
    ['repeater.get_status', rep],
    ['tethering.get_config', tethCfg],
    ['tethering.get_status', tethStatus],
    ['nui net.public_ip', ext],
    ['ddns.get_config', ddnsCfg],
    ['ddns.get_status', ddnsStatus],
    ['edgerouter.get_config', edgeCfg],
    ['edgerouter.get_status', edgeStatus],
  ]
  for (const [tag, s] of tagErrors) if (!s.ok) errors.push(`${tag}: ${s.error}`)

  const netArr: EgressIface[] = Array.isArray(st.data?.network)
    ? (st.data!.network as AnyRec[])
        .filter((x) => !String(x.interface).endsWith('6'))
        .map((x) => ({ name: String(x.interface), up: !!x.up, online: !!x.online }))
    : []
  let wan: WanInfoEx | null = null
  const wi = Array.isArray(wanInfo.data?.wan_info) ? (wanInfo.data!.wan_info as AnyRec[]) : []
  const pickWan = wi.find((x) => String(x.info?.ipaddr ?? x.info?.ip ?? '') !== '') ?? wi[0]
  if (pickWan && isObj(pickWan.info)) {
    wan = {
      interface: String(pickWan.interface ?? ''),
      ip: String(pickWan.info.ipaddr ?? pickWan.info.ip ?? ''),
      netmask: String(pickWan.info.netmask ?? ''),
      gateway: String(pickWan.info.gateway ?? ''),
      dns: Array.isArray(pickWan.info.dns) ? pickWan.info.dns.map((x: unknown) => String(x)) : [],
      prefix: pickWan.info.prefix == null ? null : toNum(pickWan.info.prefix),
    }
  }
  const repBrief = briefRepeater(rep.data)
  if (wan && repBrief) {
    if (!wan.gateway) wan.gateway = repBrief.gateway
    if (!wan.dns.length) wan.dns = repBrief.dns
  }

  return {
    mode: String(st.data?.system?.mode ?? ''),
    netmode: String(netmode.data?.mode ?? ''),
    network: netArr,
    wanInfo: wan,
    cable: {
      config: isObj(cableCfg.data) ? (cableCfg.data as CableConfig) : null,
      ports: Array.isArray(ports.data?.ports) ? (ports.data!.ports as AnyRec[]) : [],
      portsStatus: Array.isArray(portsStatus.data?.ports) ? (portsStatus.data!.ports as AnyRec[]) : [],
      check: isObj(check.data) ? check.data : null,
      init: isObj(init.data) ? init.data : null,
    },
    repeater: isObj(rep.data) ? rep.data : null,
    tethering: {
      config: Array.isArray(tethCfg.data) ? (tethCfg.data as AnyRec[]) : [],
      status: isObj(tethStatus.data) ? tethStatus.data : null,
    },
    external: isObj(ext.data)
      ? {
          ipv4: String(ext.data.ipv4 ?? ''),
          ipv6: String(ext.data.ipv6 ?? ''),
          location: String(ext.data.location ?? ''),
          isp: String(ext.data.isp ?? ''),
          time: String(ext.data.time ?? ''),
          source: String(ext.data.source ?? ''),
        }
      : null,
    ddns: { config: isObj(ddnsCfg.data) ? ddnsCfg.data : null, status: isObj(ddnsStatus.data) ? ddnsStatus.data : null },
    edge: { config: isObj(edgeCfg.data) ? edgeCfg.data : null, status: isObj(edgeStatus.data) ? edgeStatus.data : null },
    modem,
    errors,
  }
}

/**
 * 写 WAN 上网方式：cable.set_config（入参与 get_config 同构 + secondwan/usbwan 开关）。
 * 实测 no-op 回写成功；协议切换未在真机切换（避免断网），仅保证 payload 与官方视图一致。
 */
export async function saveCableConfig(patch: Partial<CableConfig>): Promise<void> {
  const cur = (await rpc<AnyRec>('cable', 'get_config', { secondwan: false, usbwan: false })) || {}
  const next: AnyRec = { ...cur, ...patch, secondwan: false, usbwan: false }
  await rpc('cable', 'set_config', next, { timeout: 30000 })
  await sleep(3000)
  const after = await rpc<AnyRec>('cable', 'get_config', { secondwan: false, usbwan: false })
  if (after && after.protocol !== next.protocol) throw new Error('配置未生效（回读协议不一致）')
}

export interface MwanIfaceCfg {
  interface: string
  metric?: number
  weight?: number
  enable_check?: boolean
  track_proto?: number
  track_method?: number
  track_mode?: number
  track_ipv4?: string[]
  track_ipv6?: string[]
  enable_ssl?: boolean
  [k: string]: unknown
}

export interface MultiwanPage {
  config: { mode: number; interfaces: MwanIfaceCfg[] } | null
  status: { interfaces: { interface: string; status_v4: number; status_v6: number }[] } | null
  sensitivity: { level: string; val: number } | null
  network: EgressIface[]
  errors: string[]
}

export async function loadMultiwan(): Promise<MultiwanPage> {
  const [cfg, status, sens, st] = await Promise.all([
    attempt(rpc<AnyRec>('kmwan', 'get_config')),
    attempt(rpc<AnyRec>('kmwan', 'get_status')),
    attempt(rpc<AnyRec>('kmwan', 'get_sensitivity')),
    attempt(rpc<AnyRec>('system', 'get_status')),
  ])
  const errors: string[] = []
  for (const [tag, s] of [
    ['kmwan.get_config', cfg],
    ['kmwan.get_status', status],
    ['kmwan.get_sensitivity', sens],
    ['system.get_status', st],
  ] as const) {
    if (!s.ok) errors.push(`${tag}: ${s.error}`)
  }
  const netArr: EgressIface[] = Array.isArray(st.data?.network)
    ? (st.data!.network as AnyRec[])
        .filter((x) => !String(x.interface).endsWith('6'))
        .map((x) => ({ name: String(x.interface), up: !!x.up, online: !!x.online }))
    : []
  return {
    config: cfg.ok && isObj(cfg.data)
      ? {
          mode: toNum(cfg.data.mode),
          interfaces: Array.isArray(cfg.data.interfaces) ? (cfg.data.interfaces as MwanIfaceCfg[]) : [],
        }
      : null,
    status: status.ok && isObj(status.data)
      ? {
          interfaces: Array.isArray(status.data.interfaces)
            ? (status.data.interfaces as AnyRec[]).map((x) => ({
                interface: String(x.interface ?? ''),
                status_v4: toNum(x.status_v4),
                status_v6: toNum(x.status_v6),
              }))
            : [],
        }
      : null,
    sensitivity: sens.ok && isObj(sens.data?.sensitivity)
      ? { level: String(sens.data!.sensitivity.level ?? 'medium'), val: toNum(sens.data!.sensitivity.val, 5) }
      : null,
    network: netArr,
    errors,
  }
}

/** kmwan.set_config：mode=0 接口优先级（metric 越小越优先）；mode=1 负载比例（weight） */
export async function saveKmwanMode(mode: number, interfaces: { interface: string; metric?: number; weight?: number }[]): Promise<void> {
  await rpc('kmwan', 'set_config', { mode, interfaces }, { timeout: 30000 })
}

/** kmwan.set_interface：单接口健康检查配置 */
export async function saveKmwanInterface(cfg: MwanIfaceCfg): Promise<void> {
  await rpc('kmwan', 'set_interface', { ...cfg }, { timeout: 30000 })
}

/** kmwan.set_sensitivity：{sensitivity:{level:low|medium|high|custom, val:检测间隔秒}} */
export async function saveKmwanSensitivity(level: string, val: number): Promise<void> {
  await rpc('kmwan', 'set_sensitivity', { sensitivity: { level, val } }, { timeout: 30000 })
}

/* ==========================================================================
 * 3. 无线（wifi / guest / repeater / acl）
 * ========================================================================== */

export interface WifiIfaceEx extends WifiIface {
  band: string
  device: string
  bandConf: WifiBandConf
}

export interface MloState {
  iface: AnyRec | null
  bandSupport: string[]
  encryptions: string[]
}

export interface WifiPage {
  config: WifiCfg | null
  status: AnyRec[]
  radios: Record<string, AnyRec>
  mlo: MloState
  env: { use_environment: number } | null
  bands: WifiBandConf[]
  ifaces: WifiIfaceEx[]
  /** lan.get_config_list：guest/iot 网段（只读展示，编辑在「网络」页） */
  lanIfaces: AnyRec[]
  errors: string[]
}

export async function loadWifiPage(): Promise<WifiPage> {
  const [cfg, status, mlo, env, radios, lan] = await Promise.all([
    attempt(rpc<WifiCfg>('wifi', 'get_config')),
    attempt(rpc<AnyRec>('wifi', 'get_status')),
    attempt(rpc<AnyRec>('wifi', 'get_mlo_config')),
    attempt(rpc<AnyRec>('wifi', 'get_environment_config')),
    attempt(nuiData<AnyRec>('wifi.radios')),
    attempt(rpc<AnyRec>('lan', 'get_config_list')),
  ])
  const errors: string[] = []
  for (const [tag, s] of [
    ['wifi.get_config', cfg],
    ['wifi.get_status', status],
    ['wifi.get_mlo_config', mlo],
    ['wifi.get_environment_config', env],
    ['nui wifi.radios', radios],
    ['lan.get_config_list', lan],
  ] as const) {
    if (!s.ok) errors.push(`${tag}: ${s.error}`)
  }
  const config = isObj(cfg.data) ? cfg.data : null
  const bands: WifiBandConf[] = Array.isArray(config?.res) ? (config!.res as WifiBandConf[]) : []
  const ifaces: WifiIfaceEx[] = []
  for (const b of bands) {
    for (const i of b.ifaces ?? []) ifaces.push({ ...i, band: String(b.band ?? ''), device: String(b.device ?? ''), bandConf: b })
  }
  const mloRes = isObj(mlo.data?.res) ? mlo.data!.res : {}
  const mloIfaces = Array.isArray(mloRes.ifaces) ? (mloRes.ifaces as AnyRec[]) : []
  return {
    config,
    status: Array.isArray(status.data?.res) ? (status.data!.res as AnyRec[]) : [],
    radios: isObj(radios.data) ? (radios.data as Record<string, AnyRec>) : {},
    mlo: {
      iface: mloIfaces[0] ?? null,
      bandSupport: Array.isArray(mloRes.mlo_bandsupport) ? mloRes.mlo_bandsupport.map((x: unknown) => String(x)) : [],
      encryptions: Array.isArray(mloRes.encryptions) ? mloRes.encryptions.map((x: unknown) => String(x)) : [],
    },
    env: isObj(env.data) ? { use_environment: toNum(env.data.use_environment) } : null,
    bands,
    ifaces,
    lanIfaces: Array.isArray(lan.data?.interfaces) ? (lan.data!.interfaces as AnyRec[]) : [],
    errors,
  }
}

export interface WifiSavePatch {
  ssid?: string
  key?: string
  encryption?: string
  hidden?: boolean
  enabled?: boolean
  txpower?: string
  hwmode?: string
  htmode?: string
  channel?: number
}

/**
 * 写单个 SSID / 射频。
 * 官方 wifi.set_config 入参 = 单接口 patch（不是整包 res[]）：
 *   {init, iface_name, ssid, encryption, key, hidden, random_bssid,
 *    main 接口再加 device/txpower/hwmode/htmode/channel}
 * 真机 no-op 回写验证通过；返回 []。
 */
export async function saveWifiIface(ifaceName: string, patch: WifiSavePatch): Promise<void> {
  const cfg = (await rpc<WifiCfg>('wifi', 'get_config')) || {}
  let band: WifiBandConf | null = null
  let iface: WifiIface | null = null
  for (const b of cfg.res ?? []) {
    for (const i of b.ifaces ?? []) {
      if (String(i.name) === ifaceName) {
        band = b
        iface = i
      }
    }
  }
  if (!band || !iface) throw new Error(`未找到 Wi-Fi 接口 ${ifaceName}`)
  const main = !iface.guest && !iface.iot
  const payload: AnyRec = {
    init: iface.init !== false,
    iface_name: ifaceName,
    ssid: patch.ssid ?? iface.ssid,
    encryption: patch.encryption ?? iface.encryption,
    key: patch.key || iface.key,
    hidden: patch.hidden ?? !!iface.hidden,
    random_bssid: iface.random_bssid ?? true,
  }
  if (patch.enabled !== undefined) payload.enabled = patch.enabled
  if (main) {
    payload.device = band.device
    payload.txpower = patch.txpower ?? band.txpower ?? 'Max'
    payload.hwmode = patch.hwmode ?? band.hwmode
    payload.htmode = patch.htmode ?? band.htmode ?? 'auto'
    payload.channel = patch.channel !== undefined ? patch.channel : band.channel ?? 0
  }
  await rpc('wifi', 'set_config', payload, { timeout: 30000 })
  await sleep(4000)
  await verifyWifiIface(ifaceName, patch)
}

async function verifyWifiIface(ifaceName: string, patch: WifiSavePatch): Promise<void> {
  const cfg = await rpc<WifiCfg>('wifi', 'get_config')
  for (const b of cfg.res ?? []) {
    for (const i of b.ifaces ?? []) {
      if (String(i.name) !== ifaceName) continue
      if (patch.ssid !== undefined && i.ssid !== patch.ssid) throw new Error(`回读 SSID 不一致（${i.ssid}）`)
      if (patch.enabled !== undefined && !!i.enabled !== patch.enabled) throw new Error('回读启用状态不一致')
      if (patch.hidden !== undefined && !!i.hidden !== patch.hidden) throw new Error('回读隐藏状态不一致')
      return
    }
  }
}

/** wifi.set_mlo_config（Wi-Fi 7 双频合一）：入参为单个 MLO 接口 patch */
export async function saveMloConfig(patch: { mlo_enable?: boolean; ssid?: string; key?: string; encryption?: string; hidden?: boolean }): Promise<void> {
  const cur = await rpc<AnyRec>('wifi', 'get_mlo_config')
  const res = isObj(cur?.res) ? cur.res : {}
  const iface = Array.isArray(res.ifaces) ? (res.ifaces[0] as AnyRec) : null
  if (!iface) throw new Error('当前固件没有 MLO 接口')
  const payload: AnyRec = {
    init: !!iface.init,
    name: String(iface.name ?? 'mld0'),
    mlo_enable: patch.mlo_enable ?? !!iface.mlo_enable,
    mlo_band: Array.isArray(iface.mlo_band) ? iface.mlo_band : ['2g', '5g'],
    ssid: patch.ssid ?? iface.ssid,
    encryption: patch.encryption ?? iface.encryption,
    key: patch.key || iface.key,
    hidden: patch.hidden ?? !!iface.hidden,
  }
  await rpc('wifi', 'set_mlo_config', payload, { timeout: 30000 })
  await sleep(4000)
  const after = await rpc<AnyRec>('wifi', 'get_mlo_config')
  const a = Array.isArray(after?.res?.ifaces) ? after.res.ifaces[0] : null
  if (a && payload.mlo_enable !== undefined && !!a.mlo_enable !== payload.mlo_enable) throw new Error('MLO 状态回读不一致')
}

/** wifi.set_environment_config：{use_environment: 0|1|…}（官方「使用环境」） */
export async function saveWifiEnvironment(mode: number): Promise<void> {
  await rpc('wifi', 'set_environment_config', { use_environment: mode }, { timeout: 30000 })
  const after = await rpc<AnyRec>('wifi', 'get_environment_config')
  if (toNum(after?.use_environment, -1) !== mode) throw new Error('使用环境回读不一致')
}

export interface BwlState {
  mode: 'black' | 'white'
  black_mac: string[]
  white_mac: string[]
}

/**
 * 黑白名单（black_white_list）：
 *  - 读：get_config → {mode:'black'|'white', black_mac?:[], white_mac?:[]}
 *  - 写：set_config → {mode, mac:[...]}（注意 key 是 mac，不是 black_mac/white_mac）
 *  - 单条增删：set_single_mac → {mode, operate:'add'|'del', mac}
 * 本固件只有黑/白两种模式，没有「关闭」（实测 disable/off/空 均 Invalid params）。
 */
export async function loadBwl(): Promise<BwlState> {
  const r = await rpc<AnyRec>('black_white_list', 'get_config')
  const mode = String(r?.mode ?? 'black') === 'white' ? 'white' : 'black'
  return {
    mode,
    black_mac: Array.isArray(r?.black_mac) ? r.black_mac.map((x: unknown) => String(x).toUpperCase()) : [],
    white_mac: Array.isArray(r?.white_mac) ? r.white_mac.map((x: unknown) => String(x).toUpperCase()) : [],
  }
}

export async function saveBwl(mode: 'black' | 'white', macs: string[]): Promise<void> {
  const list = macs.map((m) => m.trim().toUpperCase()).filter(Boolean)
  await rpc('black_white_list', 'set_config', { mode, mac: list })
  await sleep(1200)
  const after = await loadBwl()
  const got = after.mode === 'white' ? after.white_mac : after.black_mac
  if (got.length !== list.length) throw new Error(`回读数量不一致（设备 ${got.length} 条 / 提交 ${list.length} 条）`)
}

/** 单条增删（终端页阻断/解阻断，官方客户端页同款） */
export async function setSingleMac(mode: 'black' | 'white', operate: 'add' | 'del', mac: string): Promise<void> {
  await rpc('black_white_list', 'set_single_mac', { mode, operate, mac: mac.toUpperCase() })
  await sleep(1000)
}

export interface ScanApEx {
  band: string
  ssid: string
  bssid: string
  channel: number
  signal: number | null
  dfs: boolean
  saved: boolean
  encryption: string
  secure: boolean
}

/** repeater.scan：真机实测 10s 左右返回 {res:[{band,ssid,bssid,channel,signal,dfs,saved,encryption:{enabled,description}}]} */
export async function scanRepeater(): Promise<ScanApEx[]> {
  const r = await rpc<AnyRec>('repeater', 'scan', { all_band: true, refresh: true }, { timeout: 180000 })
  const list = Array.isArray(r?.res) ? (r.res as AnyRec[]) : Array.isArray(r) ? (r as AnyRec[]) : []
  return list.map((x) => {
    const enc = isObj(x.encryption) ? x.encryption : {}
    const secure = !!enc.enabled && String(enc.description ?? '').toUpperCase() !== 'NONE'
    return {
      band: String(x.band ?? ''),
      ssid: String(x.ssid ?? ''),
      bssid: String(x.bssid ?? ''),
      channel: toNum(x.channel),
      signal: x.signal == null ? null : toNum(x.signal),
      dfs: !!x.dfs,
      saved: !!x.saved,
      encryption: String(enc.description ?? ''),
      secure,
    }
  })
}

export interface RepeaterPage {
  status: AnyRec | null
  config: AnyRec | null
  saved: AnyRec[]
  netmode: string
  ports: AnyRec[]
  check: AnyRec | null
  edges: { config: AnyRec | null; status: AnyRec | null } | null
  errors: string[]
}

export async function loadRepeaterPage(): Promise<RepeaterPage> {
  const [st, cfg, saved, mode, ports, check, edgeCfg, edgeStatus] = await Promise.all([
    attempt(rpc<AnyRec>('repeater', 'get_status')),
    attempt(rpc<AnyRec>('repeater', 'get_config')),
    attempt(rpc<AnyRec>('repeater', 'get_saved_ap_list')),
    attempt(rpc<AnyRec>('netmode', 'get_mode')),
    attempt(rpc<AnyRec>('cable', 'get_ports_config')),
    attempt(rpc<AnyRec>('network', 'check_wan_cable')),
    attempt(rpc<AnyRec>('edgerouter', 'get_config')),
    attempt(rpc<AnyRec>('edgerouter', 'get_status')),
  ])
  const errors: string[] = []
  for (const [tag, s] of [
    ['repeater.get_status', st],
    ['repeater.get_config', cfg],
    ['repeater.get_saved_ap_list', saved],
    ['netmode.get_mode', mode],
    ['cable.get_ports_config', ports],
    ['network.check_wan_cable', check],
    ['edgerouter.get_config', edgeCfg],
    ['edgerouter.get_status', edgeStatus],
  ] as const) {
    if (!s.ok) errors.push(`${tag}: ${s.error}`)
  }
  return {
    status: isObj(st.data) ? st.data : null,
    config: isObj(cfg.data) ? cfg.data : null,
    saved: Array.isArray(saved.data?.res) ? (saved.data!.res as AnyRec[]) : [],
    netmode: String(mode.data?.mode ?? ''),
    ports: Array.isArray(ports.data?.ports) ? (ports.data!.ports as AnyRec[]) : [],
    check: isObj(check.data) ? check.data : null,
    edges: edgeCfg.ok && edgeStatus.ok ? { config: edgeCfg.data, status: edgeStatus.data } : null,
    errors,
  }
}

/** repeater.connect：已保存 AP 传 {..ap, remember:true}；扫描列表传 {ssid,key,band,channel,bssid,remember:true} */
export async function repeaterConnect(payload: AnyRec): Promise<void> {
  await rpc('repeater', 'connect', payload, { timeout: 60000 })
  await sleep(5000)
}

export async function repeaterDisconnect(): Promise<void> {
  await rpc('repeater', 'disconnect')
  await sleep(3000)
}

export async function repeaterForget(ssid: string): Promise<void> {
  await rpc('repeater', 'remove_saved_ap', { ssid })
  await sleep(1000)
}

/** repeater.set_config：{auto, lock_band?} */
export async function saveRepeaterConfig(patch: AnyRec): Promise<void> {
  const cur = await rpc<AnyRec>('repeater', 'get_config')
  const payload: AnyRec = { auto: cur?.auto !== false }
  if (cur?.lock_band) payload.lock_band = cur.lock_band
  Object.assign(payload, patch)
  await rpc('repeater', 'set_config', payload, { timeout: 30000 })
}

/** 802.11 固定 BSSID / 随机 MAC（repeater.macaddr）走 set_config 的 macaddr 字段时需整包，官方 UI 单独处理；这里只暴露桥接模式信息 */
export const repeaterBareMode = (enter: boolean) => rpc('repeater', enter ? 'enter_bare_mode' : 'exit_bare_mode')

/* ==========================================================================
 * 4. 终端设备
 * ========================================================================== */

export interface StaticBind {
  mac: string
  ip: string
  tag?: string
}

export interface ClientsPage {
  clients: AnyRec[]
  status: { cable_total: number; wireless_total: number; auto_remove_offline: boolean } | null
  binds: StaticBind[]
  bwl: BwlState
  supportSpeed: boolean
  qosEnabled: boolean
  sqmEnabled: boolean
  leases: { mac: string; ip: string; hostname: string; expires: number }[]
  errors: string[]
}

export async function loadClientsPage(): Promise<ClientsPage> {
  const [list, status, binds, bwl, st, leases] = await Promise.all([
    attempt(rpc<AnyRec>('clients', 'get_list')),
    attempt(rpc<AnyRec>('clients', 'get_status')),
    attempt(rpc<AnyRec>('lan', 'get_static_bind_list')),
    attempt(loadBwl()),
    attempt(rpc<AnyRec>('system', 'get_status')),
    attempt(nuiData<AnyRec[]>('net.dhcp_leases')),
  ])
  const errors: string[] = []
  for (const [tag, s] of [
    ['clients.get_list', list],
    ['clients.get_status', status],
    ['lan.get_static_bind_list', binds],
    ['black_white_list.get_config', bwl],
    ['system.get_status', st],
    ['nui net.dhcp_leases', leases],
  ] as const) {
    if (!s.ok) errors.push(`${tag}: ${s.error}`)
  }
  const sys = isObj(st.data?.system) ? st.data!.system : {}
  const qosEnabled = !!sys.qos_enabled
  const sqmEnabled = !!sys.sqm_enabled
  return {
    clients: Array.isArray(list.data?.clients) ? (list.data!.clients as AnyRec[]) : [],
    status: isObj(status.data)
      ? {
          cable_total: toNum(status.data.cable_total),
          wireless_total: toNum(status.data.wireless_total),
          auto_remove_offline: !!status.data.auto_remove_offline,
        }
      : null,
    binds: Array.isArray(binds.data?.static_bind_list)
      ? (binds.data!.static_bind_list as AnyRec[]).map((x) => ({
          mac: String(x.mac ?? '').toUpperCase(),
          ip: String(x.ip ?? ''),
          tag: String(x.tag ?? ''),
        }))
      : [],
    bwl: bwl.data ?? { mode: 'black', black_mac: [], white_mac: [] },
    supportSpeed: qosEnabled || sqmEnabled,
    qosEnabled,
    sqmEnabled,
    leases: Array.isArray(leases.data)
      ? (leases.data as AnyRec[]).map((x) => ({
          mac: String(x.mac ?? '').toUpperCase(),
          ip: String(x.ip ?? ''),
          hostname: String(x.hostname ?? ''),
          expires: toNum(x.expires),
        }))
      : [],
    errors,
  }
}

/** 阻断/解阻断：black_white_list.set_single_mac；黑名单 add=阻断，白名单 del=阻断 */
export async function setClientBlock(mode: 'black' | 'white', blocked: boolean, mac: string): Promise<void> {
  const operate: 'add' | 'del' = mode === 'black' ? (blocked ? 'add' : 'del') : blocked ? 'del' : 'add'
  await setSingleMac(mode, operate, mac)
}

/** 改名：clients.set_info {mac, alias, class}（alias 空 = 恢复主机名） */
export async function renameClient(mac: string, alias: string): Promise<void> {
  await rpc('clients', 'set_info', { mac: mac.toUpperCase(), alias, class: '' })
  await sleep(1200)
}

/** 静态地址绑定：lan.add_static_bind {name, mac, ip, hostname, one_click}（真机回读 tag=name） */
export async function addStaticBind(p: { name: string; mac: string; ip: string; hostname?: string }): Promise<void> {
  await rpc('lan', 'add_static_bind', {
    name: p.name || p.hostname || p.mac,
    mac: p.mac.toUpperCase(),
    ip: p.ip,
    hostname: p.hostname ?? '',
    one_click: true,
  })
  await sleep(1500)
}

export async function removeStaticBind(mac: string): Promise<void> {
  await rpc('lan', 'remove_static_bind', { mac: mac.toUpperCase(), mode: 0 })
  await sleep(1500)
}

/** 限速：qos.set_speed_limit_rule {mac, download, upload}（官方单位 MB/s；本机 QoS/SQM 均未启用时不可用） */
export async function setSpeedLimit(mac: string, downMbps: number, upMbps: number): Promise<void> {
  await rpc('qos', 'set_speed_limit_rule', {
    mac: mac.toUpperCase(),
    download: downMbps > 0 ? downMbps / 8 : 0,
    upload: upMbps > 0 ? upMbps / 8 : 0,
  })
  await sleep(1500)
}

export async function removeSpeedLimit(mac: string): Promise<void> {
  await rpc('qos', 'remove_speed_limit_rule', { mac: mac.toUpperCase() })
  await sleep(1500)
}

export async function cleanTraffic(): Promise<void> {
  await rpc('clients', 'clean_traffic')
}

export async function removeOfflineClient(mac: string): Promise<void> {
  await rpc('clients', 'remove_offline', { mac })
}

export async function setAutoRemoveOffline(v: boolean): Promise<void> {
  await rpc('clients', 'set_cache_offline', { auto_remove_offline: v })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms))
}
