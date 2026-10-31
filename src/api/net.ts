import { api } from './index'
import { nui } from './nui'

/**
 * 网络 / 安全 / 流控 数据层（fe-net 负责）
 *
 * 三个来源，按优先级：
 *   1. GL 官方 RPC 对象（lan/dns/ipv6/firewall/local-access/parental-control/dpi/qos/sqm/…）
 *      —— 方法名与入参逐条对照 /www/views/gl-sdk4-ui-*.common.js 原文，不做猜测。
 *   2. NUI 插件桥 `nui.invoke(...)`（tools/glrpc.mjs nui methods）—— 官方没暴露的
 *      uci 能力：hosts / TTL / 日志存储 / HW NAT / 静态路由 / DHCP 租约 / 网卡 MTU。
 *   3. 读不到就抛错，视图层用 PageState 明确降级（不许造假数据）。
 *
 * 约定：写操作一律「读 → 改 → 写 → 回读」，失败抛 Error（message 已是人话）。
 */

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** RPC / 桥错误 → 人话；顺便把桥缺 厂商专有模块的报错翻译掉 */
export function errText(e: unknown, fallback = '操作失败'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e
  const any = e as any
  const msg = String(any?.rpc?.message ?? any?.message ?? '')
  if (!msg) {
    try {
      return JSON.stringify(e).slice(0, 200)
    } catch {
      return fallback
    }
  }
  if (厂商_MISSING.test(msg)) return '当前固件缺少 厂商专有模块 luci.nradio，该功能不可用（GL 4.9 原厂固件没有）'
  const code = Number(any?.rpc?.code ?? any?.code)
  if (code === -8) return '与 LAN IP 冲突（IP/掩码与其它内网段重叠）'
  if (code === -9) return '与访客网络 IP 冲突'
  if (code === -4) return 'DNS 协议握手失败，请检查所选服务器是否可用'
  if (code === -32601) return `接口不存在：${msg}`
  return msg || fallback
}

const 厂商_MISSING = /luci\.nradio|module .* not found/i

/** 调 NUI 插件桥（失败抛 Error，message 已是人话） */
export async function bridge<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await nui.invoke<T>(method, args)
  } catch (e) {
    throw new Error(errText(e, `插件桥 ${method} 调用失败`))
  }
}

/** 桥方法可用性探测（只看清单，不真调） */
export async function bridgeHas(method: string): Promise<boolean> {
  try {
    const list = await nui.methods()
    return list.some((m: any) => m?.name === method)
  } catch {
    return false
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? {})) as T

/* ------------------------------------------------------------------ *
 * 局域网 / DHCP
 * ------------------------------------------------------------------ */

export interface LanIface {
  interface: string
  ip: string
  netmask: string
  /** DHCP 服务开关：1 开 / 0 关 */
  enable: number | boolean
  start: string
  end: string
  /** 形如 12h / 30m */
  leasetime: string
  gateway?: string
  dns?: string[]
  lpr?: string[]
  ap_isolate?: number
  wan_isolate?: number
  [k: string]: unknown
}

/** `lan.get_config_list` → 三段（lan / guest / iot） */
export async function getLanInterfaces(): Promise<LanIface[]> {
  const r = await api.call<any>('lan', 'get_config_list')
  const list = Array.isArray(r) ? r : (r?.interfaces ?? [])
  return list as LanIface[]
}

/** `lan.set_config`：地址段（官方 lanip 只会带这些字段 + interface） */
export async function saveLanAddr(p: {
  interface: string
  ip: string
  netmask: string
  ap_isolate?: number
  wan_isolate?: number
}): Promise<void> {
  await api.call('lan', 'set_config', { ...p })
}

/** `lan.set_config`：DHCP 段（官方把租期换算成分钟：leasetime = `${minutes}m`） */
export async function saveLanDhcp(p: {
  interface: string
  enable: boolean
  /** 分钟 */
  leasetimeMin: number
  gateway?: string
  start: string
  end: string
  dns?: string[]
  lpr?: string[]
}): Promise<void> {
  const body: Record<string, unknown> = {
    interface: p.interface,
    enable: p.enable ? 1 : 0,
    leasetime: `${Math.max(2, Math.round(p.leasetimeMin))}m`,
    gateway: p.gateway ?? '',
    start: p.start,
    end: p.end,
    dns: (p.dns ?? []).filter((x) => !!x && x.trim() !== ''),
  }
  const lpr = (p.lpr ?? []).filter((x) => !!x && x.trim() !== '')
  if (lpr.length) body.lpr = lpr
  await api.call('lan', 'set_config', body)
}

/** 租期字符串（12h / 30m / 3600s）→ 分钟 */
export function leaseToMinutes(v: string | number | undefined): number {
  if (typeof v === 'number') return v
  const m = String(v ?? '').match(/^(\d+)([hms]?)$/)
  if (!m) return 720
  const n = Number(m[1])
  if (m[2] === 'h') return n * 60
  if (m[2] === 's') return Math.max(2, Math.round(n / 60))
  return n
}

export interface StaticBind {
  mac: string
  ip: string
  name?: string
  hostname?: string
  [k: string]: unknown
}

/** `lan.get_static_bind_list` */
export async function getStaticBinds(): Promise<StaticBind[]> {
  const r = await api.call<any>('lan', 'get_static_bind_list')
  return (r?.static_bind_list ?? (Array.isArray(r) ? r : [])) as StaticBind[]
}

/** `lan.add_static_bind`：{ip, mac, name, hostname} */
export async function addStaticBind(p: StaticBind): Promise<void> {
  await api.call('lan', 'add_static_bind', {
    ip: p.ip,
    mac: p.mac.toUpperCase(),
    name: p.name ?? '',
    hostname: p.hostname ?? '',
  })
}

/** `lan.set_static_bind`：同上（按 mac 定位） */
export async function setStaticBind(p: StaticBind): Promise<void> {
  await api.call('lan', 'set_static_bind', {
    ip: p.ip,
    mac: p.mac.toUpperCase(),
    name: p.name ?? '',
    hostname: p.hostname ?? '',
  })
}

/** `lan.remove_static_bind`：mode 0 = 单条（带 mac），1 = 全部清空 */
export async function delStaticBind(mac?: string): Promise<void> {
  await api.call('lan', 'remove_static_bind', mac ? { mode: 0, mac: mac.toUpperCase() } : { mode: 1 })
}

/** 当前租约：NUI 桥 `net.dhcp_leases`（读 /tmp/dhcp.leases，与官方 dhcplease_status 同源） */
export interface DhcpLease {
  mac: string
  ip: string
  hostname: string
  /** 剩余秒数；false = 永久 */
  expires: number | false
}

export async function getDhcpLeases(): Promise<DhcpLease[]> {
  const r = await bridge<DhcpLease[]>('net.dhcp_leases')
  return Array.isArray(r) ? r : []
}

/** NUI 桥 `net.dhcp_get`：dnsmasq 实际生效的地址池（只读，用来核对官方接口） */
export interface DhcpState {
  enabled: boolean
  start: number
  limit: number
  leasetime: number
  lan_ip: string
  netmask: string
  hosts: { id: string; ip: string; mac: string; name: string }[]
}

export async function getDhcpState(): Promise<DhcpState> {
  return bridge<DhcpState>('net.dhcp_get')
}

export interface ClientLite {
  mac: string
  ip: string
  name?: string
  alias?: string
  online?: boolean
  [k: string]: unknown
}

/** `clients.get_list`（选设备用：静态绑定 / 家长控制 / ACL） */
export async function getClients(): Promise<ClientLite[]> {
  const r = await api.call<any>('clients', 'get_list')
  const list = (r?.clients ?? []) as ClientLite[]
  return list.filter((c) => !!c?.mac)
}

/** `network.get_arp_list` → 在线的 IPv4 邻居 */
export async function getArpList(): Promise<{ ip: string; mac: string; name?: string }[]> {
  const r = await api.call<any>('network', 'get_arp_list')
  const entries = r?.entries ?? (Array.isArray(r) ? r : [])
  const out: { ip: string; mac: string; name?: string }[] = []
  for (const e of entries as any[]) {
    if (e?.ip) out.push({ ip: e.ip, mac: e.mac ?? '', name: e.name ?? '' })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * DNS
 * ------------------------------------------------------------------ */

export interface DnsConfig {
  mode?: 'auto' | 'manual' | 'secure' | 'proxy' | string
  force_dns?: boolean
  rebind_protection?: boolean
  override_vpn?: boolean
  /** 加密 DNS */
  provider?: string
  proto?: string
  controld_type?: number
  controld_id?: string
  nextdns_id?: string
  servers_list?: string[]
  secure_manual_list?: string[]
  manual_list?: string[]
  proxy_list?: string[]
  /** 上游自动获取到的 DNS（只读） */
  server_auto?: string[]
  [k: string]: unknown
}

export async function getDnsConfig(): Promise<DnsConfig> {
  return (await api.call<DnsConfig>('dns', 'get_config')) ?? {}
}

/**
 * `dns.set_config`：官方是「只传要改的字段」（handleApply 里 Object.assign 后整体传），
 * 后端按字段合并。这里把 patch 原样提交，不整包回写，避免覆盖 server_auto。
 */
export async function saveDnsConfig(patch: Partial<DnsConfig>): Promise<void> {
  await api.call('dns', 'set_config', patch as Record<string, unknown>, { timeout: 30000 })
}

export interface DnsProvider {
  provider: string
  sup_proto: string[]
  server_list: {
    name?: string
    description?: string
    url_dot?: string
    url_doh?: string
    url_doq?: string
    address?: string[]
    address6?: string[]
  }[]
}

/** `dns.get_info`：加密 DNS 的服务商 / 协议 / 预设服务器清单（约 17 KB，缓存） */
let dnsInfoCache: DnsProvider[] | null = null
export async function getDnsProviders(force = false): Promise<DnsProvider[]> {
  if (dnsInfoCache && !force) return dnsInfoCache
  const r = await api.call<any>('dns', 'get_info')
  dnsInfoCache = (Array.isArray(r) ? r : []) as DnsProvider[]
  return dnsInfoCache
}

/** `dns.get_host` / `dns.set_host`：系统 hosts 文件（原厂页面里是纯文本编辑） */
export async function getDnsHost(): Promise<string> {
  const r = await api.call<any>('dns', 'get_host')
  return String(r?.content ?? '')
}

export async function saveDnsHost(content: string): Promise<void> {
  await api.call('dns', 'set_host', { content })
}

/** 自定义 hosts（NUI 桥，条目化，存 /etc/nui/hosts.json 并挂给 dnsmasq） */
export interface HostEntry {
  ip: string
  names: string
  enabled: boolean
  note?: string
}
export interface HostState {
  list: HostEntry[]
  active: boolean
  max: number
}

export const getHostEntries = () => bridge<HostState>('adv.hosts_get')

export const saveHostEntries = (list: HostEntry[]) => bridge<HostState>('adv.hosts_set', { list })

/** 用路由器自己的 dnsmasq 解析，验证 hosts 是否生效 */
export const testHost = (name: string) => bridge<{ name: string; addrs: string[] }>('adv.hosts_test', { name })

/* ------------------------------------------------------------------ *
 * IPv6
 * ------------------------------------------------------------------ */

export interface Ipv6Config {
  enable: boolean
  /** native / relay / nat6 / static */
  lan_mode: string
  lan_dns_mode: boolean
  lan_dns1?: string | null
  lan_dns2?: string | null
  lan_ip?: string | null
  [k: string]: unknown
}

export async function getIpv6Config(): Promise<Ipv6Config> {
  const r = await api.call<any>('ipv6', 'get_ipv6')
  return { enable: false, lan_mode: 'nat6', lan_dns_mode: true, ...(r ?? {}) } as Ipv6Config
}

/** `ipv6.set_ipv6`：整包回写（官方就是把 ipv6 表单整体提交） */
export async function saveIpv6Config(cfg: Ipv6Config): Promise<void> {
  await api.call('ipv6', 'set_ipv6', {
    enable: !!cfg.enable,
    lan_mode: cfg.lan_mode,
    lan_dns_mode: !!cfg.lan_dns_mode,
    lan_dns1: cfg.lan_dns1 || '',
    lan_dns2: cfg.lan_dns2 || '',
    lan_ip: cfg.lan_ip || '',
  })
}

/* ------------------------------------------------------------------ *
 * NAT：端口映射 / DMZ / UPnP / WAN 访问
 * ------------------------------------------------------------------ */

export interface PortForward {
  id?: string | number
  name: string
  /** 'tcp' | 'udp' | 'tcp udp' */
  proto: string
  /** 源区域，默认 wan */
  src: string
  /** 源端口，支持 80 / 8000-8010 */
  src_dport: string
  src_dip?: string
  /** 目的区域，默认 lan */
  dest: string
  dest_ip: string
  dest_port: string
  enabled: boolean
  [k: string]: unknown
}

export interface FirewallZones {
  internals: string[]
  externals: string[]
}

export async function getZones(): Promise<FirewallZones> {
  const r = await api.call<any>('firewall', 'get_zone_list')
  return { internals: r?.internals ?? [], externals: r?.externals ?? [] }
}

export async function getPortForwards(): Promise<PortForward[]> {
  const r = await api.call<any>('firewall', 'get_port_forward_list')
  return (r?.res ?? (Array.isArray(r) ? r : [])) as PortForward[]
}

export async function addPortForward(p: PortForward): Promise<any> {
  const { id: _id, ...body } = p
  return api.call('firewall', 'add_port_forward', body)
}

export async function setPortForward(p: PortForward): Promise<void> {
  await api.call('firewall', 'set_port_forward', { ...p })
}

export async function delPortForward(id: string | number): Promise<void> {
  await api.call('firewall', 'remove_port_forward', { id })
}

export async function orderPortForwards(idList: (string | number)[]): Promise<void> {
  await api.call('firewall', 'order_port_forward', { id_list: idList })
}

export interface DmzConfig {
  enabled: boolean
  dest_ip?: string
  priority?: boolean
}

export async function getDmz(): Promise<DmzConfig> {
  const r = await api.call<any>('firewall', 'get_dmz')
  return { enabled: false, dest_ip: '', priority: true, ...(r?.data ?? r ?? {}) } as DmzConfig
}

/** `firewall.set_dmz`：关闭时官方只发 {enabled:false} */
export async function saveDmz(p: DmzConfig): Promise<void> {
  const body: Record<string, unknown> = { enabled: !!p.enabled }
  if (p.enabled) {
    body.dest_ip = p.dest_ip ?? ''
    body.priority = p.priority !== false
  }
  await api.call('firewall', 'set_dmz', body)
}

/** UPnP：桥只有写入方法（m_adv adv.upnp_set → uci upnpd.config.enabled） */
export const setUpnp = (enabled: boolean) => bridge<Record<string, unknown>>('adv.upnp_set', { enabled })

export interface WanAccess {
  enable_https: boolean
  enable_ping: boolean
  enable_ssh: boolean
  enable_whitelist: boolean
  whitelist: { name: string; ipaddr: string }[]
  [k: string]: unknown
}

export async function getWanAccess(): Promise<WanAccess> {
  const r = await api.call<any>('firewall', 'get_wan_access')
  return {
    enable_https: false,
    enable_ping: false,
    enable_ssh: false,
    enable_whitelist: false,
    whitelist: [],
    ...(r ?? {}),
  } as WanAccess
}

/** `firewall.set_wan_access`：整包（官方把整个表单传上去） */
export async function saveWanAccess(p: WanAccess): Promise<void> {
  await api.call('firewall', 'set_wan_access', {
    enable_https: !!p.enable_https,
    enable_ping: !!p.enable_ping,
    enable_ssh: !!p.enable_ssh,
    enable_whitelist: !!p.enable_whitelist,
    whitelist: (p.whitelist ?? []).map((w) => ({ name: w.name ?? '', ipaddr: w.ipaddr ?? '' })),
  })
}

/* ------------------------------------------------------------------ *
 * 静态路由（NUI 桥 net.route_*，官方 4.9 没有路由 RPC）
 * ------------------------------------------------------------------ */

export interface StaticRoute {
  id: string
  interface: string
  target: string
  netmask?: string
  gateway?: string
  metric?: string
  /** 桥不返回该字段（只认 glass） */
  enabled?: boolean
  [k: string]: unknown
}

export interface RouteState {
  routes: StaticRoute[]
  interfaces: string[]
}

/**
 * 静态路由：两条后端都可用。
 *  - `glass.route_*`（自有 Lua，已部署）支持「启停」(uci disabled)，接口清单带 proto；
 *  - NUI 桥 `net.route_*` 不支持启停、只给接口名。
 * 优先 glass，失败退回桥（此时启停开关置灰并说明）。
 */
export async function getRoutes(): Promise<RouteState & { canToggle: boolean; source: 'glass' | 'bridge' }> {
  try {
    const r = await api.call<any>('glass', 'route_list')
    const routes = ((r?.routes ?? []) as StaticRoute[]).map((x) => ({ ...x, enabled: x.enabled !== false }))
    const ifaces = ((r?.interfaces ?? []) as any[])
      .map((x) => (typeof x === 'string' ? x : String(x?.name ?? '')))
      .filter((n) => n && n !== 'loopback')
    return { routes, interfaces: ifaces, canToggle: true, source: 'glass' }
  } catch {
    const r = await bridge<RouteState>('net.route_list')
    return {
      routes: (r?.routes ?? []) as StaticRoute[],
      interfaces: (r?.interfaces ?? []) as string[],
      canToggle: false,
      source: 'bridge',
    }
  }
}

/** 新建/修改路由：interface + target 必填；空字段不写进 uci */
export async function saveRoute(p: {
  id?: string
  interface: string
  target: string
  netmask?: string
  gateway?: string
  metric?: string
  enabled?: boolean
}): Promise<void> {
  try {
    const r = await api.call<any>('glass', 'route_save', { ...p }, { timeout: 30000 })
    if (r?.err_msg) throw new Error(String(r.err_msg))
  } catch (e) {
    // glass 不可用时退回桥（桥没有 enabled 语义）
    const r = await bridge<any>('net.route_save', { ...p }).catch(() => {
      throw e instanceof Error ? e : new Error(errText(e))
    })
    if (r?.err_msg) throw new Error(String(r.err_msg))
  }
}

export async function delRoute(id: string): Promise<void> {
  try {
    const r = await api.call<any>('glass', 'route_del', { id }, { timeout: 30000 })
    if (r?.err_msg) throw new Error(String(r.err_msg))
  } catch (e) {
    const r = await bridge<any>('net.route_del', { id }).catch(() => {
      throw e instanceof Error ? e : new Error(errText(e))
    })
    if (r?.err_msg) throw new Error(String(r.err_msg))
  }
}

/** 路由启停（只支持 glass 后端；桥只读） */
export async function toggleRoute(route: StaticRoute): Promise<void> {
  await saveRoute({
    id: route.id,
    interface: route.interface,
    target: route.target,
    netmask: route.netmask,
    gateway: route.gateway,
    metric: route.metric,
    enabled: !(route.enabled !== false),
  })
}

/** WAN 健康检查（glass.wanchk_*，uci /etc/config/wanchk；GL 4.9 默认不配 profile） */
export interface WanchkState {
  supported: boolean
  profiles: { name: string; interface: string; dnsopen: boolean; pingopen: boolean; timeout?: number; try_count?: number }[]
}

export async function getWanchk(): Promise<WanchkState> {
  const r = await api.call<any>('glass', 'wanchk_get')
  return { supported: r?.supported !== false, profiles: (r?.profiles ?? []) as any }
}

export async function setWanchk(p: {
  name: string
  interface?: string
  dnsopen?: boolean
  pingopen?: boolean
  timeout?: number
  try_count?: number
}): Promise<void> {
  const r = await api.call<any>('glass', 'wanchk_set', { ...p })
  if (r?.err_msg) throw new Error(String(r.err_msg))
}

export interface PolicyIface {
  interface: string
  metric: number
  weight: number
  track_mode?: number
  track_proto?: number
  enable_check?: boolean
  track_ipv4?: string[]
  track_ipv6?: string[]
  /** kmwan 跟踪结果：1 通 / 0 不通 */
  status_v4?: number
  status_v6?: number
}

/** GL 的「策略路由」= kmwan 多 WAN 优先级 + 链路跟踪（官方 /internet/multiwan 页），只读展示 */
export async function getPolicyRouting(): Promise<PolicyIface[]> {
  const [cfg, st] = await Promise.all([
    api.call<any>('kmwan', 'get_config').catch(() => null),
    api.call<any>('kmwan', 'get_status').catch(() => null),
  ])
  const list = (cfg?.interfaces ?? []) as PolicyIface[]
  const status = new Map<string, any>()
  for (const s of (st?.interfaces ?? []) as any[]) status.set(String(s.interface), s)
  return list.map((it) => ({ ...it, ...(status.get(String(it.interface)) ?? {}) }))
}

/* ------------------------------------------------------------------ *
 * IGMP Snooping
 * ------------------------------------------------------------------ */

export interface IgmpConfig {
  enable: boolean
  version: number
}

export async function getIgmpConfig(): Promise<IgmpConfig> {
  const r = await api.call<any>('igmp', 'get_config')
  return { enable: !!r?.enable, version: Number(r?.version ?? 3) }
}

export async function saveIgmpConfig(p: IgmpConfig): Promise<void> {
  await api.call('igmp', 'set_config', { enable: !!p.enable, version: Number(p.version) || 3 })
}

/* ------------------------------------------------------------------ *
 * 高级网络（netadvanced / netnat / mtkhnat / ttl / logstore / MTU）
 * ------------------------------------------------------------------ */

export interface AdvanceConfig {
  /** 0/1：软件 NAT 加速（原厂「网络加速」） */
  nat_enable: number
  /** 0/1：SIP ALG */
  sip_enable: number
}

export async function getAdvanceConfig(): Promise<AdvanceConfig> {
  const r = await api.call<any>('network', 'get_advance_config')
  return { nat_enable: Number(r?.nat_enable ?? 0), sip_enable: Number(r?.sip_enable ?? 0) }
}

export async function saveAdvanceConfig(p: AdvanceConfig): Promise<void> {
  await api.call('network', 'set_advance_config', {
    nat_enable: Number(p.nat_enable) ? 1 : 0,
    sip_enable: Number(p.sip_enable) ? 1 : 0,
  })
}

export interface NetnatConfig {
  enable: boolean
  /** 0 = 自动 / 1 = 硬件加速(HW NAT) / 2 = 软件 */
  actype: number
  wifi_reload: boolean
  /** 后端给出的可选 actype 列表 */
  list?: number[]
  /** 与 DPI / QoS 的互斥状态（只读） */
  dpi_enabled?: boolean
  qos_enabled?: boolean
  conflict_features?: string[]
  [k: string]: unknown
}

export async function getNetnatConfig(): Promise<NetnatConfig> {
  const r = await api.call<any>('network', 'get_netnat_config')
  return {
    enable: !!r?.enable,
    actype: Number(r?.actype ?? 0),
    wifi_reload: !!r?.wifi_reload,
    list: Array.isArray(r?.list) ? r.list.map((x: any) => Number(x)) : [],
    ...(r ?? {}),
  } as NetnatConfig
}

export async function saveNetnatConfig(p: NetnatConfig): Promise<void> {
  await api.call('network', 'set_netnat_config', {
    enable: !!p.enable,
    actype: Number(p.actype ?? 0),
    wifi_reload: !!p.wifi_reload,
  })
}

export interface HnatState {
  available: boolean
  enable: boolean
}

export const getHnat = () => bridge<HnatState>('adv.hnat_get')

/** HW NAT（mtkhnat.global.enable）：1 = 性能模式，0 = 流畅模式 */
export const setHnat = (enable: boolean) => bridge<HnatState>('adv.hnat_set', { enable })

export interface TtlState {
  ipv4: string
  ipv6: string
  ipv6_supported: boolean
  current: number
}

export const getTtl = () => bridge<TtlState>('adv.ttl_get')

export const setTtl = (p: { ipv4: string; ipv6: string }) => bridge<TtlState>('adv.ttl_set', { ...p })

export interface LogstoreState {
  available: boolean
  sync: boolean
  path: string
}

export const getLogstore = () => bridge<LogstoreState>('adv.logstore_get')

export const setLogstore = (sync: boolean) => bridge<LogstoreState>('adv.logstore_set', { sync })

/** 网卡 MTU / 收发字节（桥 sys.details → /proc/net/dev + ubus network.interface） */
export interface Netdev {
  name: string
  mtu: number
  up: boolean
  rx: number
  tx: number
  speed?: number
  mac?: string
}

export interface SysDetails {
  netdevs: Netdev[]
  interfaces: { name: string; up: boolean; proto: string; device?: string; ipv4?: string[]; ipv6?: string[]; dns?: string[] }[]
}

let sysDetailsAt = 0
let sysDetailsCache: SysDetails | null = null
export async function getNetdevs(force = false): Promise<SysDetails> {
  if (sysDetailsCache && !force && Date.now() - sysDetailsAt < 15000) return sysDetailsCache
  const r = await bridge<SysDetails>('sys.details')
  sysDetailsCache = { netdevs: r?.netdevs ?? [], interfaces: r?.interfaces ?? [] }
  sysDetailsAt = Date.now()
  return sysDetailsCache
}

/** 中继（AP-Client）状态：官方 repeater 对象（adv.apcli_get 依赖 厂商专有模块，本机不可用） */
export async function getRepeaterStatus(): Promise<any> {
  return api.call<any>('repeater', 'get_status')
}

/**
 * `system.get_status` 里的全局功能开关 —— 官方前端就是靠它做跨页互斥/灰度
 * （netnat / qos / sqm / flowstatistics / contentprotection / ipv6）。
 */
export interface SysFlags {
  netnat_enabled: boolean
  ipv6_enabled: boolean
  flow_statistics_enabled: boolean
  content_protection_enabled: boolean
  qos_enabled: boolean
  sqm_enabled: boolean
  prio_enabled: boolean
  dpi_info: { status?: string; lib_version?: string; lib_update_time?: string }
  service: { name: string; status: number }[]
  lan_ip?: string
  guest_ip?: string
  iot_ip?: string
  lan_netmask?: string
}

export async function getSystemFlags(): Promise<SysFlags> {
  const r = await api.call<any>('system', 'get_status')
  const s = r?.system ?? {}
  return {
    netnat_enabled: !!s.netnat_enabled,
    ipv6_enabled: !!s.ipv6_enabled,
    flow_statistics_enabled: !!s.flow_statistics_enabled,
    content_protection_enabled: !!s.content_protection_enabled,
    qos_enabled: !!s.qos_enabled,
    sqm_enabled: !!s.sqm_enabled,
    prio_enabled: !!s.prio_enabled,
    dpi_info: s.dpi_info ?? {},
    service: (r?.service ?? []) as { name: string; status: number }[],
    lan_ip: s.lan_ip,
    guest_ip: s.guest_ip,
    iot_ip: s.iot_ip,
    lan_netmask: s.lan_netmask,
  }
}

/* ------------------------------------------------------------------ *
 * 防火墙（WAN 侧规则 / 区域）
 * ------------------------------------------------------------------ */

export interface FirewallRule {
  id?: string | number
  name: string
  /** 源区域，通常是 wan */
  src: string
  /** 'tcp' | 'udp' | 'tcp udp' */
  proto: string
  dest_port: string
  /** ACCEPT / DROP */
  target: string
  enabled: boolean
  [k: string]: unknown
}

export async function getFirewallRules(): Promise<FirewallRule[]> {
  const r = await api.call<any>('firewall', 'get_rule_list')
  return (r?.res ?? (Array.isArray(r) ? r : [])) as FirewallRule[]
}

export async function addFirewallRule(p: FirewallRule): Promise<any> {
  const { id: _id, ...body } = p
  return api.call('firewall', 'add_rule', body)
}

export async function setFirewallRule(p: FirewallRule): Promise<void> {
  await api.call('firewall', 'set_rule', { ...p })
}

export async function delFirewallRule(id: string | number): Promise<void> {
  await api.call('firewall', 'remove_rule', { id })
}

/* ------------------------------------------------------------------ *
 * 访问控制（ACL）+ MAC 黑白名单
 * ------------------------------------------------------------------ */

export interface AclRule {
  id?: string | number
  name: string
  /** 'ipv4 ipv6' | 'ipv4' | 'ipv6' */
  family: string
  src: string
  src_ip: string[]
  src_port?: string
  dest: string
  dest_ip: string[]
  dest_port?: string
  proto: string
  /** ACCEPT / DROP */
  target: string
  enabled: boolean
  [k: string]: unknown
}

export async function getAclRules(): Promise<AclRule[]> {
  const r = await api.call<any>('firewall', 'get_acl_rule_list')
  return (Array.isArray(r) ? r : (r?.res ?? [])) as AclRule[]
}

export async function getAclZones(): Promise<FirewallZones> {
  const r = await api.call<any>('firewall', 'get_acl_zone_list')
  return { internals: r?.internals ?? [], externals: r?.externals ?? [] }
}

export async function addAclRule(p: AclRule): Promise<void> {
  const { id: _id, ...body } = p
  await api.call('firewall', 'add_acl_rule', body)
}

export async function editAclRule(p: AclRule): Promise<void> {
  await api.call('firewall', 'edit_acl_rule', { ...p })
}

export async function delAclRule(id: string | number): Promise<void> {
  await api.call('firewall', 'delete_acl_rule', { id })
}

export async function orderAclRules(idList: (string | number)[]): Promise<void> {
  await api.call('firewall', 'order_acl_rule', { id_list: idList })
}

export interface BwlConfig {
  mode: string
  [k: string]: unknown
}

export async function getBwlConfig(): Promise<BwlConfig> {
  const r = await api.call<any>('black_white_list', 'get_config')
  return { mode: 'black', ...(r ?? {}) } as BwlConfig
}

export async function saveBwlConfig(patch: Partial<BwlConfig>): Promise<void> {
  await api.call('black_white_list', 'set_config', patch as Record<string, unknown>)
}

/* ------------------------------------------------------------------ *
 * 本地访问（SSH / 后台端口 / 会话超时）
 * ------------------------------------------------------------------ */

export interface LocalAccess {
  ssh_enabled: boolean
  ssh_port: number
  http_port: number
  https_port: number
  redirect_https: boolean
  luci_http_port: number
  luci_https_port: number
  luci_redirect_https: boolean
  /** 秒（官方 UI 里按分钟填，提交时 ×60） */
  session_timeout: number
}

export async function getLocalAccess(): Promise<LocalAccess> {
  const r = await api.call<any>('local-access', 'get_config')
  return {
    ssh_enabled: false,
    ssh_port: 22,
    http_port: 80,
    https_port: 443,
    redirect_https: false,
    luci_http_port: 8080,
    luci_https_port: 8443,
    luci_redirect_https: false,
    session_timeout: 300,
    ...(r ?? {}),
  } as LocalAccess
}

/** `local-access.set_config`：session_timeout 传秒 */
export async function saveLocalAccess(p: LocalAccess): Promise<void> {
  await api.call('local-access', 'set_config', {
    ssh_enabled: !!p.ssh_enabled,
    ssh_port: Number(p.ssh_port),
    http_port: Number(p.http_port),
    https_port: Number(p.https_port),
    redirect_https: !!p.redirect_https,
    luci_http_port: Number(p.luci_http_port),
    luci_https_port: Number(p.luci_https_port),
    luci_redirect_https: !!p.luci_redirect_https,
    session_timeout: Math.max(60, Math.round(Number(p.session_timeout) || 300)),
  })
}

/* ------------------------------------------------------------------ *
 * 家长控制
 * ------------------------------------------------------------------ */

export interface ParentalSchedule {
  /** 0 = 每天，1..7 = 周一..周日 */
  week: number
  enabled: boolean
  begin: string
  end: string
}

export interface ParentalGroup {
  id?: string | number
  name: string
  enabled: boolean
  macs: string[]
  /** 内容分类：gambling / malicious_content / sexual_content / game / social_entertainment / shopping */
  category: string[]
  apps: string[]
  blacklist: string[]
  schedules_enabled: boolean
  /** 'everyday' | 'customize' */
  schedules_days: string
  schedules: ParentalSchedule[]
  [k: string]: unknown
}

export interface ParentalConfig {
  enable: boolean
  groups: ParentalGroup[]
  init?: boolean
}

export async function getParentalConfig(): Promise<ParentalConfig> {
  const r = await api.call<any>('parental-control', 'get_config')
  return { enable: !!r?.enable, groups: (r?.groups ?? []) as ParentalGroup[], init: r?.init }
}

/** `parental-control.set_config`：全局开关只有 enable */
export async function setParentalEnable(enable: boolean): Promise<void> {
  await api.call('parental-control', 'set_config', { enable: !!enable })
}

export async function addParentalGroup(g: ParentalGroup): Promise<void> {
  const { id: _id, ...body } = g
  await api.call('parental-control', 'add_group', body)
}

export async function setParentalGroup(g: ParentalGroup): Promise<void> {
  await api.call('parental-control', 'set_group', { ...g })
}

export async function delParentalGroup(id: string | number): Promise<void> {
  await api.call('parental-control', 'remove_group', { id })
}

export interface AppCategory {
  category_name: string
  apps: { icon?: string; name: string; label?: string }[]
}

/** `parental-control.get_app_list`：65 KB 应用库，按需懒加载 + 缓存 */
let parentalApps: AppCategory[] | null = null
export async function getParentalApps(force = false): Promise<AppCategory[]> {
  if (parentalApps && !force) return parentalApps
  const r = await api.call<any>('parental-control', 'get_app_list')
  parentalApps = (Array.isArray(r) ? r : []) as AppCategory[]
  return parentalApps
}

/* ------------------------------------------------------------------ *
 * DPI（应用管控 / 内容保护）
 * ------------------------------------------------------------------ */

export interface DpiConfig {
  lib_version?: string
  ota_version?: string
  ota_update_auto?: boolean
  lib_update_auto?: boolean
  [k: string]: unknown
}

export async function getDpiConfig(): Promise<DpiConfig> {
  return (await api.call<DpiConfig>('dpi', 'get_dpi_config')) ?? {}
}

export interface DpiStatus {
  /** '0' = 未启用 / 其它 = 状态码 */
  status: string
  lib_version?: string
  lib_update_time?: string
}

export async function getDpiStatus(): Promise<DpiStatus> {
  return (await api.call<DpiStatus>('dpi', 'get_dpi_status')) ?? { status: '0' }
}

export interface DpiStats {
  qos: number
  content_protection_all: number
  traffic_day: number
  content_protection_day: number
}

export async function getDpiStats(): Promise<DpiStats> {
  const r = await api.call<any>('dpi', 'get_dpi_stats')
  return { qos: 0, content_protection_all: 0, traffic_day: 0, content_protection_day: 0, ...(r ?? {}) }
}

export interface ContentProtection {
  enable: boolean
  category_list: string[]
  app_list: (string | { name: string })[]
  domain_list?: string[]
  [k: string]: unknown
}

export async function getContentProtection(): Promise<ContentProtection> {
  const r = await api.call<any>('dpi', 'get_content_protection')
  return { enable: false, category_list: [], app_list: [], ...(r ?? {}) } as ContentProtection
}

/** `dpi.set_content_protection`：app_list 必须传「应用名数组」 */
export async function saveContentProtection(p: {
  enable: boolean
  category_list: string[]
  app_list: string[]
  domain_list?: string[]
}): Promise<void> {
  const body: Record<string, unknown> = {
    enable: !!p.enable,
    category_list: p.category_list ?? [],
    app_list: p.app_list ?? [],
  }
  if (p.domain_list) body.domain_list = p.domain_list
  await api.call('dpi', 'set_content_protection', body, { timeout: 30000 })
}

/** `dpi.enable_dpi_base_service`：官方「试用启用」入口，返回 {status} */
export async function enableDpiBase(enable = true): Promise<{ status: number }> {
  return api.call<any>('dpi', 'enable_dpi_base_service', { enable }, { timeout: 60000 })
}

/** `dpi.get_apps`：355 KB 大包，只在用户真的展开应用清单时拉 + 缓存 */
let dpiApps: AppCategory[] | null = null
export async function getDpiApps(force = false): Promise<AppCategory[]> {
  if (dpiApps && !force) return dpiApps
  const r = await api.call<any>('dpi', 'get_apps')
  dpiApps = (Array.isArray(r) ? r : []) as AppCategory[]
  return dpiApps
}

/* ------------------------------------------------------------------ *
 * 流控：流量统计 / QoS / SQM
 * ------------------------------------------------------------------ */

export interface FlowRule {
  enable: boolean
  /** 'app' */
  type: string
  /** day / week / month */
  time: string
}

export async function getFlowRule(): Promise<FlowRule> {
  const r = await api.call<any>('flow_statistics', 'get_statistics_rule')
  return { enable: !!r?.enable, type: String(r?.type ?? 'app'), time: String(r?.time ?? 'day') }
}

export async function saveFlowRule(p: FlowRule): Promise<void> {
  await api.call('flow_statistics', 'set_statistics_rule', {
    enable: !!p.enable,
    type: p.type || 'app',
    time: p.time || 'day',
  })
}

export async function clearFlowStats(): Promise<void> {
  await api.call('flow_statistics', 'clear_statistics', {})
}

export interface FlowRow {
  application_id?: string
  application_name: string
  icon?: string
  total: number
  upload: number
  download: number
  /** 占比（后端已算好时直接用） */
  percent?: number
}

/** `flow_statistics.get_flow_statistics`：功能未启用时后端返回 [] */
export async function getFlowStats(): Promise<FlowRow[]> {
  const r = await api.call<any>('flow_statistics', 'get_flow_statistics')
  const apps = Array.isArray(r) ? [] : (r?.applications ?? [])
  return (apps as any[]).map((x) => ({
    application_id: x.application_id,
    application_name: x.application_name ?? x.name ?? '未知',
    icon: x.icon,
    total: Number(x.total ?? 0),
    upload: Number(x.upload ?? 0),
    download: Number(x.download ?? 0),
    percent: x.percent != null ? Number(x.percent) : undefined,
  }))
}

export interface FlowTop {
  max_bytes: number
  top_apps: FlowRow[]
}

export async function getTopAppFlow(): Promise<FlowTop> {
  const r = await api.call<any>('flow_statistics', 'get_top_app_flow_statistics')
  if (Array.isArray(r)) return { max_bytes: 0, top_apps: [] }
  return {
    max_bytes: Number(r?.max_bytes ?? 0),
    top_apps: (r?.top_apps ?? []) as FlowRow[],
  }
}

/** 实时总速率历史（桥 sys.rate_history；points 由插件采集器攒，空表示还没采样） */
export interface RateHistory {
  enabled: boolean
  now: number
  interval: number
  window: number
  points: { t: number; rx: number; tx: number }[]
}

export async function getRateHistory(): Promise<RateHistory> {
  const r = await bridge<any>('sys.rate_history')
  const pts = (r?.points ?? []) as any[]
  return {
    enabled: !!r?.enabled,
    now: Number(r?.now ?? Date.now()),
    interval: Number(r?.interval ?? 3),
    window: Number(r?.window ?? 180),
    points: pts.map((p) => ({
      t: Number(p.t ?? p.time ?? 0),
      rx: Number(p.rx ?? p.download ?? p.down ?? 0),
      tx: Number(p.tx ?? p.upload ?? p.up ?? 0),
    })),
  }
}

export interface QosConfig {
  enable: boolean
  /** 单位 Mbps（原厂输入框是纯数字） */
  upload: string
  download: string
  /** '0' 关闭 / '1'..'5' 预设：会议/游戏/网页/视频/自定义 */
  mode: string
  high: string[]
  middle: string[]
  low: string[]
  [k: string]: unknown
}

/** 官方 qos 页用 dpi.get_qos / dpi.set_qos；老对象 qos.get_config 只作兜底展示 */
export async function getQosConfig(): Promise<QosConfig> {
  try {
    const r = await api.call<any>('dpi', 'get_qos')
    return { enable: !!r?.enable, upload: String(r?.upload ?? ''), download: String(r?.download ?? ''), mode: String(r?.mode ?? '0'), high: r?.high ?? [], middle: r?.middle ?? [], low: r?.low ?? [] }
  } catch {
    const r = await api.call<any>('qos', 'get_config')
    return { enable: !!r?.enable, upload: '', download: '', mode: String(r?.mode ?? '0'), high: [], middle: [], low: [] }
  }
}

export async function saveQosConfig(p: QosConfig): Promise<void> {
  await api.call('dpi', 'set_qos', {
    enable: !!p.enable,
    upload: String(p.upload ?? ''),
    download: String(p.download ?? ''),
    mode: String(p.mode ?? '0'),
    high: p.high ?? [],
    middle: p.middle ?? [],
    low: p.low ?? [],
  })
}

export interface SqmConfig {
  enable: boolean
  download: string
  upload: string
  /** cake / fq_codel */
  qdisc: string
  [k: string]: unknown
}

export async function getSqmConfig(): Promise<SqmConfig> {
  const r = await api.call<any>('sqm', 'get_config')
  return { enable: !!r?.enable, download: String(r?.download ?? ''), upload: String(r?.upload ?? ''), qdisc: String(r?.qdisc ?? 'cake'), ...(r ?? {}) }
}

export async function saveSqmConfig(p: SqmConfig): Promise<void> {
  await api.call('sqm', 'set_config', {
    enable: !!p.enable,
    download: String(p.download ?? ''),
    upload: String(p.upload ?? ''),
    qdisc: p.qdisc || 'cake',
  })
}

/** 只读工具：判断某项功能是否被 netnat（网络加速）占用/冲突 */
export async function getNetnatFlags(): Promise<{ dpi_enabled: boolean; qos_enabled: boolean; enable: boolean }> {
  const r = await api.call<any>('network', 'get_netnat_config').catch(() => null)
  return {
    dpi_enabled: !!r?.dpi_enabled,
    qos_enabled: !!r?.qos_enabled,
    enable: !!r?.enable,
  }
}

/** 清空内部缓存（切换账号/重登时用） */
export function clearNetCaches(): void {
  dnsInfoCache = null
  parentalApps = null
  dpiApps = null
  sysDetailsCache = null
  sysDetailsAt = 0
}

/** 便捷：把「DNS 上游」文本拆成数组（页面输入用） */
export function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  return String(v ?? '')
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export { clone }
