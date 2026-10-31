import { api } from '@/api'
import { nui, nuiErrors, type NuiError } from '@/api/nui'

/**
 * 蜂窝 / 短信 / 工具（测速、诊断、监控、联网检测）数据层。
 *
 * 数据来源优先级（PLAN-v3 §5 / docs/api-official.md / docs/api-plugin.md）：
 *   蜂窝：官方 modem.*  →  NUI 桥 cell.* 与 at.*  →  ubus cellular.*（RPC 未暴露，页面不直接调）
 *   工具：NUI 桥 speed.* 、diag.* 、sys.details  →  官方 glass.*（be-lua 后续部署）→ 官方 diag.*
 *
 * 本机（GL-MT3600BE，4.9.0）实测没有蜂窝模组、没有 luci.nradio，
 * 因此每个 get* 都返回「数据 + 失败原因/证据」，页面只负责展示，不伪造数据。
 */

/* =========================================================================
 * 通用工具
 * ========================================================================= */

/** 统一调用（官方 rpc 已在 rpc.ts 里把 result.err_code 转成异常） */
const call = <T = any>(obj: string, method: string, args: Record<string, unknown> = {}) =>
  api.call<T>(obj, method, args)

/** 长任务调用：speed.start / send_at_command / glass.speedtest 这类需要显式超时 */
type LongCall = (
  obj: string,
  method: string,
  args: Record<string, unknown>,
  opts?: { timeout?: number },
) => Promise<any>
const callLong = (obj: string, method: string, args: Record<string, unknown>, timeout: number) =>
  (api.call as unknown as LongCall)(obj, method, args, { timeout })

export function msgOf(e: unknown): string {
  if (!e) return ''
  if (typeof e === 'string') return e
  const any = e as any
  return String(any?.rpc?.message ?? any?.message ?? any?.error ?? any)
}

/** 是不是「厂商专有模块缺失」类错误（GL 4.9 上必然出现） */
export function isVendorLibMissing(e: unknown): boolean {
  return /luci\.nradio|luci\/nradio|厂商|NOT_SUPPORTED|MODULE_MISSING/i.test(msgOf(e))
}

/** 把桥/固件的原始错误翻成人话（截断 Lua 堆栈） */
export function friendlyError(e: unknown, fallback = '调用失败'): string {
  const raw = msgOf(e)
  if (!raw) return fallback
  if (isVendorLibMissing(e)) {
    return '本机 GL 4.9 固件缺少 厂商 专有库 luci.nradio，该功能仅在 原厂固件可用'
  }
  // 去掉 Lua 堆栈（"xxx.lua:12: ..." 只留最后一段）
  const first = raw.split('\n')[0]
  return first.replace(/^.*?:\d+:\s*/, '').slice(0, 180) || fallback
}

function swallow<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback)
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.+-]/g, '')) : Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/* =========================================================================
 * NUI 桥能力探测
 * ========================================================================= */

export interface BridgeCaps {
  available: boolean
  methods: Set<string>
  errors: Record<string, string>
  reason: string
  /** nui.caps 的 caps 段（桥自己算的能力开关，比逐项探测更稳） */
  caps: Record<string, any> | null
  device: Record<string, any> | null
  /** 桥禁用的方法 → 原因（nui.caps.blocked） */
  blocked: Record<string, string>
}

let capsCache: BridgeCaps | null = null

export async function bridgeCaps(force = false): Promise<BridgeCaps> {
  if (capsCache && !force) return capsCache
  let capsData: Record<string, any> | null = null
  try {
    capsData = await call<Record<string, any>>('nui', 'caps')
  } catch {
    /* 旧版桥没有 caps 方法，走逐项探测 */
  }
  try {
    const list = await nui.methods(force)
    capsCache = {
      available: true,
      methods: new Set(list.map((m) => m.name)),
      errors: { ...nuiErrors },
      reason: '',
      caps: (capsData?.caps as Record<string, any>) ?? null,
      device: (capsData?.device as Record<string, any>) ?? null,
      blocked: (capsData?.blocked as Record<string, string>) ?? {},
    }
  } catch (e) {
    capsCache = {
      available: false,
      methods: new Set(),
      errors: {},
      reason: friendlyError(e, 'NUI 插件后端未安装或未加载'),
      caps: (capsData?.caps as Record<string, any>) ?? null,
      device: (capsData?.device as Record<string, any>) ?? null,
      blocked: (capsData?.blocked as Record<string, string>) ?? {},
    }
  }
  return capsCache
}

export interface NuiResult<T = any> {
  ok: boolean
  data: T | null
  error: string
  code?: string
  /** 能力缺失（厂商 模块/方法不存在），不是临时错误 */
  unsupported: boolean
}

/** 调桥方法：永不抛异常，统一返回结果对象 */
export async function nuiSafe<T = any>(method: string, args: Record<string, unknown> = {}): Promise<NuiResult<T>> {
  const caps = await bridgeCaps()
  if (!caps.available) return { ok: false, data: null, error: caps.reason, unsupported: true }
  if (!caps.methods.has(method)) {
    return { ok: false, data: null, error: `插件后端没有 ${method} 方法（桥版本过旧）`, unsupported: true }
  }
  try {
    const data = await nui.invoke<T>(method, args)
    return { ok: true, data, error: '', unsupported: false }
  } catch (e) {
    const nuiErr = e as NuiError
    return {
      ok: false,
      data: null,
      error: friendlyError(e),
      code: nuiErr?.code,
      unsupported: isVendorLibMissing(e) || nuiErr?.code === 'UNSUPPORTED' || nuiErr?.code === 'NOTFOUND',
    }
  }
}

/* =========================================================================
 * 蜂窝：模组探测
 * ========================================================================= */

export interface ModemDevice {
  bus: string
  name?: string
  vendor?: string
  raw?: Record<string, unknown>
}

export interface CellSupport {
  sim: boolean
  sms: boolean
  lockTower: boolean
  lockCarrier: boolean
  signal: boolean
  networkType: boolean
  pin: boolean
}

export interface CellEvidence {
  label: string
  value: string
  tone: 'ok' | 'warn' | 'err' | 'mute'
}

export interface CellBridgeState {
  modules: Record<string, any>[]
  config: Record<string, any> | null
  slots: Record<string, any> | null
  errors: Record<string, string>
}

export interface CellularProbe {
  checkedAt: number
  available: boolean
  bus: string
  devices: ModemDevice[]
  sims: Record<string, any>[]
  supports: CellSupport
  modemInfo: Record<string, any>
  debug: Record<string, any> | null
  bridge: CellBridgeState
  hardware: {
    model: string
    firmware: string
    buildInModem: string
    slot: string
    /** 当前实际上网接口（用于证明「没模组也能上网」） */
    wanIface: string
    wanIp: string
  } | null
  /** 页面顶部的诊断证据（无模组时逐条展示） */
  evidence: CellEvidence[]
  reasons: string[]
}

const ERR_HINT =
  'modem.get_debug_msg / cellular.* 只在本机插有蜂窝模组时才有数据；本机为纯路由型号（无 4G/5G 模组）'

/** 从 get_debug_msg 里归一化 modem_info（两种固件结构都认） */
function pickModemInfo(debug: Record<string, any> | null): Record<string, any> {
  if (!debug) return {}
  const nested = debug.modem_info
  if (nested && typeof nested === 'object') return nested as Record<string, any>
  // 官方 internet 视图把字段全铺平在 info 对象里
  return debug
}

function pickSims(debug: Record<string, any> | null): Record<string, any>[] {
  if (!debug) return []
  const nested = debug.sim_info?.sims ?? debug.sim_status?.sims
  if (Array.isArray(nested)) return nested
  const flat = (debug as any).simInfo ?? (debug as any).sims
  return Array.isArray(flat) ? flat : []
}

function pickDevices(debug: Record<string, any> | null, mi: Record<string, any>): ModemDevice[] {
  const raw = mi.devices ?? debug?.devices
  if (!Array.isArray(raw)) return []
  const out: ModemDevice[] = []
  for (const d of raw) {
    if (typeof d === 'string') {
      if (d) out.push({ bus: d })
    } else if (d && typeof d === 'object') {
      const o = d as Record<string, any>
      const bus = str(o.bus ?? o.device ?? o.name ?? o.id)
      if (bus) out.push({ bus, name: str(o.name) || undefined, vendor: str(o.vendor) || undefined, raw: o })
    }
  }
  return out
}

/** 从 modem.get_cellular_info / get_cellular_status 的 modems[] 里补充模组列表 */
function devicesFromModems(list: unknown): ModemDevice[] {
  if (!Array.isArray(list)) return []
  const out: ModemDevice[] = []
  for (const d of list) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, any>
    const bus = str(o.bus ?? o.device ?? o.name)
    if (bus) out.push({ bus, name: str(o.name) || undefined, vendor: str(o.vendor) || undefined, raw: o })
  }
  return out
}

/** 合并去重（debug_msg 与 get_cellular_info 可能给同一总线） */
function uniqueDevices(list: ModemDevice[]): ModemDevice[] {
  const seen = new Set<string>()
  const out: ModemDevice[] = []
  for (const d of list) {
    if (!d.bus || seen.has(d.bus)) continue
    seen.add(d.bus)
    out.push(d)
  }
  return out
}

let hardCache: CellularProbe['hardware'] | null = null
async function readHardware(): Promise<CellularProbe['hardware']> {
  if (hardCache) return hardCache
  const info = await swallow(call<Record<string, any>>('system', 'get_info'), null)
  const wan = await swallow(call<Record<string, any>>('lan', 'get_wan_info'), null)
  const w = (wan?.wan_info as any[] | undefined)?.[0]
  const hw = (info?.hardware_feature ?? {}) as Record<string, any>
  hardCache = {
    model: str(info?.model) || 'GL-MT3600BE',
    firmware: str(info?.firmware_version),
    buildInModem: str(hw.build_in_modem),
    slot: str(hw.slot),
    wanIface: str(w?.interface),
    wanIp: str(w?.info?.ipaddr ?? w?.info?.ip),
  }
  return hardCache
}

let probeCache: { at: number; value: CellularProbe } | null = null

/** 探测蜂窝模组（8 秒内复用，页面切换 section 时不会重复打设备） */
export async function probeCellular(force = false): Promise<CellularProbe> {
  if (!force && probeCache && Date.now() - probeCache.at < 8000) return probeCache.value

  const evidence: CellEvidence[] = []
  const reasons: string[] = []

  const caps = await bridgeCaps()
  const debug = await swallow(call<Record<string, any>>('modem', 'get_debug_msg', { bus: '' }), null)
  const mi = pickModemInfo(debug)
  const hardware = await readHardware()

  // 轻量状态接口（官方页面用它做轮询；无模组时分别是 {modems:[]} / {sims:[]}）
  const [cellInfo, cellStatus, simInfo] = await Promise.all([
    swallow(call<Record<string, any>>('modem', 'get_cellular_info', {}), null),
    swallow(call<Record<string, any>>('modem', 'get_cellular_status', {}), null),
    swallow(call<Record<string, any>>('modem', 'get_sim_info', {}), null),
  ])
  const extraDevices = [...devicesFromModems(cellInfo?.modems), ...devicesFromModems(cellStatus?.modems)]
  const devices = uniqueDevices([...pickDevices(debug, mi), ...extraDevices])
  const sims = [...pickSims(debug), ...((Array.isArray(simInfo?.sims) ? simInfo?.sims : []) as Record<string, any>[])]

  const modulesRes = await nuiSafe<Record<string, any>[]>('cell.modules')
  const configRes = await nuiSafe<Record<string, any>>('cell.config')
  const slotsRes = await nuiSafe<Record<string, any>>('cell.slots')

  const modules = Array.isArray(modulesRes.data) ? modulesRes.data : []
  const errors: Record<string, string> = {}
  if (!modulesRes.ok) errors['cell.modules'] = modulesRes.error
  if (!configRes.ok) errors['cell.config'] = configRes.error
  if (!slotsRes.ok) errors['cell.slots'] = slotsRes.error

  const bus = devices[0]?.bus || str(mi.bus) || ''

  const supports: CellSupport = {
    sim: sims.length > 0 || Number(mi.sim_slot_num) > 0,
    sms: !!mi.sms_support,
    lockTower: !!mi.lock_tower_support,
    lockCarrier: !!mi.lock_carrier_support,
    signal: !!mi.signal_support,
    networkType: !!mi.network_type_support,
    pin: !!mi.support_pin_count,
  }

  const available = devices.length > 0 || sims.length > 0 || modules.length > 0 || caps.caps?.modem === true
  const capModem = caps.caps ? !!caps.caps.modem : null

  /* ---- 诊断证据（无模组时这些就是页面上的「为什么不可用」） ---- */
  if (!debug) {
    evidence.push({ label: 'modem.get_debug_msg', value: '调用失败（官方 modem RPC 无响应）', tone: 'err' })
    reasons.push('官方 modem RPC 调用失败')
  } else {
    evidence.push({
      label: 'modem.get_debug_msg · modem_info.devices',
      value: `[${devices.map((d) => d.bus).join(', ')}]`,
      tone: devices.length ? 'ok' : 'warn',
    })
    evidence.push({
      label: 'modem.get_debug_msg · sim_info.sims',
      value: `${sims.length} 条`,
      tone: sims.length ? 'ok' : 'warn',
    })
    evidence.push({
      label: '模组能力开关',
      value: `sms=${String(!!mi.sms_support)} · signal=${String(!!mi.signal_support)} · lock_tower=${String(!!mi.lock_tower_support)} · pin=${String(!!mi.support_pin_count)}`,
      tone: available ? 'mute' : 'warn',
    })
  }
  evidence.push({
    label: '硬件能力 system.get_info',
    value: hardware
      ? `build_in_modem="${hardware.buildInModem}" · slot="${hardware.slot}" · ${hardware.model} / ${hardware.firmware || '—'}`
      : '读取失败',
    tone: hardware?.buildInModem ? 'ok' : 'warn',
  })
  evidence.push({
    label: 'modem.get_cellular_info · modems',
    value: cellInfo ? `${Array.isArray(cellInfo.modems) ? cellInfo.modems.length : 0} 个` : '调用失败',
    tone: Array.isArray(cellInfo?.modems) && cellInfo.modems.length ? 'ok' : 'warn',
  })
  evidence.push({
    label: 'modem.get_sim_info · sims',
    value: simInfo ? `${Array.isArray(simInfo.sims) ? simInfo.sims.length : 0} 条` : '调用失败',
    tone: Array.isArray(simInfo?.sims) && simInfo.sims.length ? 'ok' : 'warn',
  })
  evidence.push({
    label: 'NUI 桥 cell.modules',
    value: modules.length
      ? modules.map((m) => `${m.iface}${m.disabled ? '(disabled)' : ''}`).join(', ')
      : `[]${modulesRes.ok ? '' : `（${modulesRes.error}）`}`,
    tone: modules.length ? 'ok' : 'warn',
  })
  if (!caps.available) {
    evidence.push({ label: 'NUI 插件后端', value: caps.reason, tone: 'err' })
    reasons.push('NUI 插件后端不可用')
  } else if (caps.caps) {
    evidence.push({
      label: 'NUI 桥 nui.caps · modem/cellular/sim/sms',
      value: `modem=${String(!!caps.caps.modem)} · cellular=${String(!!caps.caps.cellular)} · sim=${String(!!caps.caps.sim)} · sms=${String(!!caps.caps.sms)}`,
      tone: capModem ? 'ok' : 'warn',
    })
  }
  if (hardware?.wanIface || hardware?.wanIp) {
    evidence.push({
      label: '当前上网接口（lan.get_wan_info）',
      value: `${hardware.wanIface || '—'}${hardware.wanIp ? ` · ${hardware.wanIp}` : ''}（非蜂窝）`,
      tone: 'mute',
    })
  }

  if (!available) {
    if (!hardware?.buildInModem) reasons.push('system.get_info.hardware_feature.build_in_modem 为空：本机没有内置蜂窝模组')
    if (capModem === false) reasons.push('nui.caps.modem = false：NUI 桥判定本机没有蜂窝模组')
    if (debug && devices.length === 0) reasons.push('modem_info.devices = []：模组管理进程没有发现任何模组总线')
    if (debug && sims.length === 0) reasons.push('sim_info.sims = []：未识别到 SIM 卡')
    if (caps.available && modules.length === 0) reasons.push('NUI 桥 cell.modules = []：没有 cpe/wwan 蜂窝接口')
    reasons.push(ERR_HINT)
  } else {
    evidence.push({
      label: '当前模组总线',
      value: bus || '未上报',
      tone: bus ? 'ok' : 'warn',
    })
  }

  const value: CellularProbe = {
    checkedAt: Date.now(),
    available,
    bus,
    devices,
    sims,
    supports,
    modemInfo: mi,
    debug,
    bridge: {
      modules,
      config: configRes.data ?? null,
      slots: slotsRes.data ?? null,
      errors,
    },
    hardware,
    evidence,
    reasons,
  }
  probeCache = { at: Date.now(), value }
  return value
}

export function clearCellularCache(): void {
  probeCache = null
  hardCache = null
}

/* =========================================================================
 * 蜂窝：状态页
 * ========================================================================= */

export interface SignalInfo {
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  rssi: number | null
  /** 0-5 格 */
  level: number
  band: string
  bandwidth: string
  tech: string
  cellId: string
  pci: string
  earfcn: string
  carrier: string
  registered: boolean | null
  raw: Record<string, any>
}

export interface SimSnapshot {
  present: boolean
  slot: number | null
  iccid: string
  imsi: string
  operator: string
  number: string
  roaming: boolean
  ready: boolean
  alias: string
  source: string
}

export interface CellStatusBundle {
  probe: CellularProbe
  signal: SignalInfo | null
  tower: Record<string, any> | null
  operatorCfg: Record<string, any> | null
  sim: SimSnapshot
  rates: { down: number; up: number }
  sources: string[]
}

/** RSRP → 0-5 格（3GPP 常用档位） */
function rsrpBars(rsrp: number | null): number {
  if (rsrp === null) return 0
  if (rsrp >= -80) return 5
  if (rsrp >= -90) return 4
  if (rsrp >= -100) return 3
  if (rsrp >= -110) return 2
  if (rsrp >= -120) return 1
  return 0
}

/** 把模组上报的「信号对象」从几种可能的嵌套里挖出来 */
function findNetworkObjects(debug: Record<string, any> | null): Record<string, any>[] {
  if (!debug) return []
  const out: Record<string, any>[] = []
  const push = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === 'object') out.push(x as Record<string, any>)
    } else if (v && typeof v === 'object') {
      out.push(v as Record<string, any>)
    }
  }
  push(debug.network_status)
  push((debug as any).networkStatus)
  push(debug.network_info)
  push((debug as any).networkInfo)
  push((debug as any).network)
  return out
}

function pickNum(o: Record<string, any>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k]
    const n = num(v)
    if (n !== null) return n
  }
  return null
}

function pickStr(o: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = o?.[k]
    if (v !== null && v !== undefined && v !== '') return String(v)
  }
  return ''
}

function extractSignal(
  debug: Record<string, any> | null,
  tower: Record<string, any> | null,
  operatorCfg: Record<string, any> | null,
  extras: (Record<string, any> | null)[] = [],
): SignalInfo | null {
  const objs = findNetworkObjects(debug)
  for (const ex of extras) {
    if (!ex) continue
    objs.push(ex, ...findNetworkObjects(ex))
  }
  const towerSlots = tower ? Object.values(tower).filter((v) => v && typeof v === 'object') : []
  const opSlots = operatorCfg ? Object.values(operatorCfg).filter((v) => v && typeof v === 'object') : []
  // 合并所有候选对象；后写的不覆盖已有值
  const merged: Record<string, any> = {}
  for (const o of [...towerSlots, ...opSlots, ...objs] as Record<string, any>[]) {
    for (const [k, v] of Object.entries(o)) {
      if (merged[k] === undefined && v !== null && v !== undefined && v !== '') merged[k] = v
    }
  }
  if (!Object.keys(merged).length) return null

  const rsrp = pickNum(merged, ['rsrp', 'RSRP', 'nr5g_rsrp', 'lte_rsrp'])
  const rsrq = pickNum(merged, ['rsrq', 'RSRQ', 'nr5g_rsrq', 'lte_rsrq'])
  const sinr = pickNum(merged, ['sinr', 'SINR', 'nr5g_sinr', 'lte_sinr'])
  const rssi = pickNum(merged, ['rssi', 'RSSI', 'nr5g_rssi', 'lte_rssi'])
  const reg = merged.registered ?? merged.reg_status ?? merged.registration ?? merged.status
  const registered =
    typeof reg === 'boolean' ? reg : typeof reg === 'number' ? reg > 0 : typeof reg === 'string' ? /reg|online|connect|1/i.test(reg) : null

  return {
    rsrp,
    rsrq,
    sinr,
    rssi,
    level: rsrpBars(rsrp),
    band: pickStr(merged, ['band', 'Band', 'nr_band', 'lte_band']),
    bandwidth: (() => {
      const ul = pickStr(merged, ['ul_bandwidth', 'ul_bw'])
      const dl = pickStr(merged, ['dl_bandwidth', 'dl_bw'])
      if (!ul && !dl) return ''
      return `${dl || '—'}↓ / ${ul || '—'}↑ MHz`
    })(),
    tech: pickStr(merged, ['network_mode', 'network_type', 'technology', 'mode', 'nr_mode', 'net_type']),
    cellId: pickStr(merged, ['cellid', 'cell_id', 'ci', 'nci']),
    pci: pickStr(merged, ['pci', 'PCI', 'physcellid']),
    earfcn: pickStr(merged, ['earfcn', 'EARFCN', 'arfcn', 'nrarfcn']),
    carrier: pickStr(merged, ['carrier', 'operator', 'isp', 'network_operator', 'plmn', 'mcc_mnc']),
    registered,
    raw: merged,
  }
}

function buildSimSnapshot(probe: CellularProbe): SimSnapshot {
  const bridgeSlots = (probe.bridge.slots?.slots as Record<string, any>[] | undefined) ?? []
  const cur = Number(probe.bridge.slots?.cur ?? probe.bridge.config?.sel?.cur ?? NaN)
  const current = bridgeSlots.find((s) => Number(s.index) === cur) || bridgeSlots.find((s) => s.current) || bridgeSlots[0]
  const cfgSims = (probe.bridge.config?.sims as Record<string, any>[] | undefined) ?? []
  const cfgCur = cfgSims[Math.max(0, (Number.isFinite(cur) ? cur : 1) - 1)] ?? cfgSims[0]
  const dSim = probe.sims[0] ?? {}
  const imeiSlot = Array.isArray(probe.modemInfo.imei) ? probe.modemInfo.imei[0] : null
  const iccid = str(current?.iccid) || str(dSim.iccid) || str(imeiSlot?.iccid)
  const imsi = str(current?.imsi) || str(dSim.imsi)
  return {
    present: !!(iccid || imsi || probe.sims.length),
    slot: Number.isFinite(cur) ? cur : current ? Number(current.index) : null,
    iccid,
    imsi,
    operator: str(current?.operator) || str(dSim.isp) || str(dSim.operator) || str(cfgCur?.carrier),
    number: str(current?.number) || str(dSim.simnumber) || str(dSim.phone_number),
    roaming: !!(cfgCur?.roaming ?? false),
    ready: !!(current?.ready ?? (iccid && iccid !== '')),
    alias: str(current?.alias ?? cfgCur?.alias),
    source: str(current?.source ?? (iccid ? 'live' : '')),
  }
}

/** 当前 WAN 实时速率（官方 clients.get_wan_speed，单位 B/s；rx=下行） */
export async function wanSpeed(): Promise<{ down: number; up: number }> {
  const r = await swallow(call<Record<string, any>>('clients', 'get_wan_speed'), null)
  return { down: Math.max(0, Number(r?.speed_rx) || 0), up: Math.max(0, Number(r?.speed_tx) || 0) }
}

export async function getCellStatus(): Promise<CellStatusBundle> {
  const probe = await probeCellular()
  const sources: string[] = []
  const rates = await wanSpeed()

  let tower: Record<string, any> | null = null
  let operatorCfg: Record<string, any> | null = null
  let extraStatus: Record<string, any> | null = null
  const slot = Number(probe.bridge.slots?.cur ?? 1) || 1
  if (probe.bus) {
    tower = await swallow(call<Record<string, any>>('modem', 'get_cell_tower', { bus: probe.bus }), null)
    operatorCfg = await swallow(
      call<Record<string, any>>('modem', 'get_operator_config', { bus: probe.bus, slot }),
      null,
    )
    const [cs, ci] = await Promise.all([
      swallow(call<Record<string, any>>('modem', 'get_cellular_status', { bus: probe.bus }), null),
      swallow(call<Record<string, any>>('modem', 'get_cellular_info', { bus: probe.bus }), null),
    ])
    extraStatus = cs ?? ci
    if (tower) sources.push('modem.get_cell_tower')
    if (operatorCfg) sources.push('modem.get_operator_config')
    if (cs) sources.push('modem.get_cellular_status')
    if (ci) sources.push('modem.get_cellular_info')
  } else {
    // 无 bus 时也试一次无参（本机返回 {slot:[]}/err，作为降级证据而非报错）
    tower = await swallow(call<Record<string, any>>('modem', 'get_cell_tower', {}), null)
  }

  const signal = extractSignal(probe.debug, tower, operatorCfg, [extraStatus])
  if (probe.sims.length) sources.push('modem.get_debug_msg · sim_info')
  if (probe.bridge.slots) sources.push('NUI 桥 cell.slots')
  if (probe.bridge.config) sources.push('NUI 桥 cell.config')
  if (rates.down || rates.up) sources.push('clients.get_wan_speed')

  return {
    probe,
    signal,
    tower,
    operatorCfg,
    sim: buildSimSnapshot(probe),
    rates,
    sources,
  }
}

/* =========================================================================
 * 蜂窝：SIM / APN 页
 * ========================================================================= */

export interface CellSimBundle {
  probe: CellularProbe
  config: Record<string, any> | null
  slots: Record<string, any> | null
  simConfig: Record<string, any>[] | null
  profiles: Record<string, any>[] | null
  failover: Record<string, any>[] | null
  pin: NuiResult<Record<string, any>>
  notes: string[]
}

export async function getCellSim(): Promise<CellSimBundle> {
  const probe = await probeCellular()
  const notes: string[] = []
  const slot = Number(probe.bridge.slots?.cur ?? 1) || 1

  let simConfig: Record<string, any>[] | null = null
  let profiles: Record<string, any>[] | null = null
  let failover: Record<string, any>[] | null = null

  if (probe.bus) {
    simConfig = await swallow(call<any>('modem', 'get_sim_config', { bus: probe.bus, slot }), null)
    if (simConfig && !Array.isArray(simConfig)) simConfig = [simConfig as Record<string, any>]
    const pl = await swallow(call<any>('modem', 'get_profile_list', { bus: probe.bus, slot }), null)
    profiles = Array.isArray(pl) ? pl : (pl?.custom_profiles as Record<string, any>[] | undefined) ?? null
    const fo = await swallow(call<any>('modem', 'get_slot_failover_config', { bus: probe.bus }), null)
    failover = Array.isArray(fo) ? fo : null
    if (simConfig) notes.push('官方 modem.get_sim_config')
    if (profiles) notes.push('官方 modem.get_profile_list')
    if (failover) notes.push('官方 modem.get_slot_failover_config')
  } else {
    notes.push('无模组总线（bus 为空）：官方 modem.get_sim_config / get_profile_list / get_slot_failover_config 均不会返回数据')
  }

  const pin = await nuiSafe<Record<string, any>>('cell.pin_get', { iface: ifaceOf(probe) })
  if (!pin.ok) notes.push(`PIN 状态：${pin.error}`)

  return {
    probe,
    config: probe.bridge.config,
    slots: probe.bridge.slots,
    simConfig,
    profiles,
    failover,
    pin,
    notes,
  }
}

function ifaceOf(probe: CellularProbe): string {
  const m = probe.bridge.modules.find((x) => x?.iface)
  return m ? String(m.iface) : 'cpe'
}

/** 解锁 PIN（桥 cell.pin_set）；失败时抛出可读错误 */
export async function cellPinSet(pin: string): Promise<Record<string, any>> {
  const probe = await probeCellular()
  const r = await nuiSafe<Record<string, any>>('cell.pin_set', { iface: ifaceOf(probe), pin })
  if (!r.ok) throw new Error(r.error)
  return r.data ?? {}
}

/** 漫游开关（桥 cell.cfg_set 的 roaming 字段，厂商 专有） */
export async function cellSetRoaming(roaming: boolean): Promise<Record<string, any>> {
  const probe = await probeCellular()
  const r = await nuiSafe<Record<string, any>>('cell.cfg_set', { iface: ifaceOf(probe), roaming })
  if (!r.ok) throw new Error(r.error)
  return r.data ?? {}
}

/* =========================================================================
 * 蜂窝：锁频 / 锁小区 / 网络模式页
 * ========================================================================= */

export interface CellLockBundle {
  probe: CellularProbe
  lock: NuiResult<Record<string, any>>
  cfg: NuiResult<Record<string, any>>
  config: Record<string, any> | null
  notes: string[]
}

export async function getCellLock(): Promise<CellLockBundle> {
  const probe = await probeCellular()
  const iface = ifaceOf(probe)
  const [lock, cfg] = await Promise.all([
    nuiSafe<Record<string, any>>('cell.lock_get', { iface }),
    nuiSafe<Record<string, any>>('cell.cfg_get', { iface }),
  ])
  const notes: string[] = []
  if (!lock.ok) notes.push(`cell.lock_get：${lock.error}`)
  if (!cfg.ok) notes.push(`cell.cfg_get：${cfg.error}`)
  if (!probe.available) notes.push('本机未检测到蜂窝模组，锁频/锁制式没有可写入的模组对象')
  return { probe, lock, cfg, config: probe.bridge.config, notes }
}

export async function cellLockSet(patch: Record<string, unknown>): Promise<Record<string, any>> {
  const probe = await probeCellular()
  const r = await nuiSafe<Record<string, any>>('cell.lock_set', { iface: ifaceOf(probe), ...patch })
  if (!r.ok) throw new Error(r.error)
  probeCache = null
  return r.data ?? {}
}

export async function cellCfgSet(patch: Record<string, unknown>): Promise<Record<string, any>> {
  const probe = await probeCellular()
  const r = await nuiSafe<Record<string, any>>('cell.cfg_set', { iface: ifaceOf(probe), ...patch })
  if (!r.ok) throw new Error(r.error)
  probeCache = null
  return r.data ?? {}
}

/* =========================================================================
 * 蜂窝：流量统计页
 * ========================================================================= */

export interface TrafficLimit {
  slot: number | null
  type: string
  enable: boolean
  threshold: string
  unit: string
  reset?: string
}

export interface TrafficUsage {
  slot: number | null
  type: string
  total: number
  label: string
}

export interface CellDataBundle {
  probe: CellularProbe
  /** 官方 modem.get_traffic_config；null=无模组或接口报错 */
  trafficCfg: Record<string, any> | null
  trafficError: string
  usages: TrafficUsage[]
  limits: TrafficLimit[]
  /** 兜底：clients.get_list 累计（LAN 终端口径，非蜂窝） */
  clientTotals: { tx: number; rx: number; count: number } | null
  /** 兜底：终端口径按接口细分（wwan/5G 等） */
  byIface: { iface: string; tx: number; rx: number }[]
  rates: { down: number; up: number }
  rateHistory: RateHistory | null
  sources: string[]
}

export async function getCellData(): Promise<CellDataBundle> {
  const probe = await probeCellular()
  const sources: string[] = []
  const slot = Number(probe.bridge.slots?.cur ?? 1) || 1
  let trafficCfg: Record<string, any> | null = null
  let trafficError = ''

  if (probe.bus) {
    try {
      trafficCfg = await call<Record<string, any>>('modem', 'get_traffic_config', { bus: probe.bus, slot })
      sources.push('modem.get_traffic_config')
    } catch (e) {
      trafficError = friendlyError(e)
    }
  } else {
    trafficError = '无模组总线（bus 为空）：官方 modem.get_traffic_config 需要 bus 参数'
  }

  if (!trafficCfg) {
    try {
      trafficCfg = await call<Record<string, any>>('modem', 'get_traffic_config', {})
    } catch (e) {
      if (!trafficError) trafficError = friendlyError(e)
    }
  }

  const usages: TrafficUsage[] = []
  const limits: TrafficLimit[] = []
  const tra = (trafficCfg?.traffic as Record<string, any>[] | undefined) ?? []
  for (const t of tra) {
    usages.push({
      slot: num(t.slot),
      type: str(t.type),
      total: Number(t.traffic_total) || 0,
      label: `卡槽 ${str(t.slot) || '?'}${t.type !== undefined ? ` · 类型 ${str(t.type)}` : ''}`,
    })
  }
  const lim = (trafficCfg?.limit as Record<string, any>[] | undefined) ?? []
  for (const l of lim) {
    limits.push({
      slot: num(l.slot),
      type: str(l.type),
      enable: !!l.enable,
      threshold: str(l.threshold),
      unit: str(l.unit) || 'GB',
      reset: str(l.reset_period) || undefined,
    })
  }

  // 兜底：终端累计流量（官方 clients.get_list；非蜂窝口径，必须标注来源）
  let clientTotals: CellDataBundle['clientTotals'] = null
  const byIfaceMap = new Map<string, { tx: number; rx: number }>()
  const clients = await swallow(call<Record<string, any>>('clients', 'get_list'), null)
  const list = (clients?.clients as Record<string, any>[] | undefined) ?? []
  if (list.length) {
    let tx = 0
    let rx = 0
    for (const c of list) {
      const ctx = Number(c.total_tx) || 0
      const crx = Number(c.total_rx) || 0
      tx += ctx
      rx += crx
      const key = str(c.iface) || '未知'
      const prev = byIfaceMap.get(key) ?? { tx: 0, rx: 0 }
      byIfaceMap.set(key, { tx: prev.tx + ctx, rx: prev.rx + crx })
    }
    clientTotals = { tx, rx, count: list.length }
    sources.push('clients.get_list（终端累计，非蜂窝口径）')
  }

  const rates = await wanSpeed()
  if (rates.down || rates.up) sources.push('clients.get_wan_speed')

  const rateHistory = await getRateHistory()
  if (rateHistory && rateHistory.points.length) sources.push('NUI 桥 sys.rate_history')

  return {
    probe,
    trafficCfg,
    trafficError,
    usages,
    limits,
    clientTotals,
    byIface: [...byIfaceMap.entries()].map(([iface, v]) => ({ iface, ...v })),
    rates,
    rateHistory,
    sources,
  }
}

/* =========================================================================
 * 蜂窝：AT 调试页
 * ========================================================================= */

export interface CellAtBundle {
  probe: CellularProbe
  /** at_debug_msgs（无模组时是 {ret:2,resp:"Invalid parameter"}） */
  atMsgs: unknown
  atInfo: NuiResult<Record<string, any>>
  /** 官方 modem.get_at_result（有模组时是最近 AT 交互结果） */
  atResult: Record<string, any> | null
  interfaces: Record<string, any>[]
  notes: string[]
}

export async function getCellAt(): Promise<CellAtBundle> {
  const probe = await probeCellular()
  const notes: string[] = []
  const atInfo = await nuiSafe<Record<string, any>>('at.devinfo_get', { iface: ifaceOf(probe) })
  if (!atInfo.ok) notes.push(`at.devinfo_get：${atInfo.error}（该桥方法依赖 cpetools.sh/AT 口，本机无模组）`)
  const iface = await swallow(call<Record<string, any>>('modem', 'get_modem_current_interface'), null)
  const interfaces = (iface?.interfaces as Record<string, any>[] | undefined) ?? []
  if (!interfaces.length) notes.push('modem.get_modem_current_interface.interfaces = []（没有蜂窝数据接口）')
  const atResult = await getAtResult(probe.bus, Number(probe.bridge.slots?.cur ?? 1) || 1)
  if (!atResult) notes.push('modem.get_at_result 无返回（无模组时为空）')
  return {
    probe,
    atMsgs: probe.debug?.at_debug_msgs ?? null,
    atInfo,
    atResult,
    interfaces,
    notes,
  }
}

/** 读取最近一次 AT 命令结果（官方 modem.get_at_result） */
export async function getAtResult(bus = '', slot = 1): Promise<Record<string, any> | null> {
  const r = await swallow(call<Record<string, any>>('modem', 'get_at_result', bus ? { bus, slot } : {}), null)
  return r ?? null
}

/** 发送 AT 命令（官方 modem.send_at_command，需要真实模组总线） */
export async function cellSendAt(bus: string, command: string, slot: number): Promise<Record<string, any>> {
  return callLong('modem', 'send_at_command', { bus, command, slot }, 120000)
}

/* =========================================================================
 * 短信
 * ========================================================================= */

export interface SmsItem {
  status: number
  name: string
  phone: string
  body: string
  date: string
  slot: number | null
  unread: boolean
  sending: boolean
  failed: boolean
  raw: Record<string, any>
}

export interface SmsSlot {
  slot: number
  number: string
}

export interface SmsBundle {
  probe: CellularProbe
  bus: string
  supported: boolean
  reason: string
  slots: SmsSlot[]
  list: SmsItem[]
  unread: number
  error: string
}

function toSmsItem(x: Record<string, any>): SmsItem {
  const status = Number(x.status) || 0
  return {
    status,
    name: str(x.name),
    phone: str(x.phone_number ?? x.phone ?? x.sender),
    body: str(x.body ?? x.content),
    date: str(x.date ?? x.time),
    slot: num(x.slot),
    unread: status === 0,
    sending: status === 3 || status === 4,
    failed: status === 5,
    raw: x,
  }
}

export async function getSmsPage(busArg = ''): Promise<SmsBundle> {
  const probe = await probeCellular()
  const bus = busArg || probe.bus
  const slots: SmsSlot[] = probe.sims
    .filter((s) => !bus || !s.bus || s.bus === bus)
    .map((s) => ({ slot: Number(s.slot) || 1, number: str(s.phone_number ?? s.simnumber) }))
  const supported = probe.available
  let reason = ''
  let list: SmsItem[] = []
  let error = ''

  if (!supported) {
    reason = probe.reasons[0] || '未检测到蜂窝模组'
  } else if (!bus) {
    reason = '模组已检测到但总线为空的：官方 modem.get_sms_list 需要 bus 参数'
  } else {
    try {
      const r = await call<Record<string, any>>('modem', 'get_sms_list', { bus })
      const raw = (r?.list as Record<string, any>[] | undefined) ?? (Array.isArray(r) ? (r as Record<string, any>[]) : [])
      list = raw.map(toSmsItem)
      if (!slots.length) slots.push({ slot: Number(probe.bridge.slots?.cur ?? 1) || 1, number: '' })
    } catch (e) {
      error = friendlyError(e)
    }
  }

  return {
    probe,
    bus,
    supported,
    reason,
    slots,
    list,
    unread: list.filter((s) => s.unread).length,
    error,
  }
}

/** 标记单条已读（官方 modem.set_sms，status=1） */
export async function smsMarkRead(bus: string, name: string): Promise<void> {
  await call('modem', 'set_sms', { bus, name, status: 1 })
}

/** 全部标记已读（官方 sms 页面：set_sms {bus,status:6}） */
export async function smsMarkAllRead(bus: string): Promise<void> {
  await call('modem', 'set_sms', { bus, status: 6 })
}

/** 删除单条（官方 sms 页面：remove_sms {name,scope:10}） */
export async function smsRemove(bus: string, name: string): Promise<void> {
  await call('modem', 'remove_sms', { bus, name, scope: 10 })
}

/** 删除已读（scope=1） / 删除收件（scope=12） / 删除发件（scope=13） */
export async function smsRemoveScope(bus: string, scope: 1 | 12 | 13): Promise<void> {
  await call('modem', 'remove_sms', { bus, scope })
}

export interface SendSmsInput {
  bus: string
  slot: number
  phone: string
  body: string
  sender?: string
}

/** 发送短信（官方 modem.send_sms） */
export async function smsSend(input: SendSmsInput): Promise<void> {
  await callLong(
    'modem',
    'send_sms',
    {
      slot: input.slot,
      bus: input.bus,
      phone_number: input.phone,
      body: input.body,
      timeout: 0,
      ...(input.sender ? { sender: input.sender } : {}),
    },
    60000,
  )
}

/** 短信转发配置（官方 sms-forward.get_config，需要 modem_mode） */
export async function getSmsForward(bus: string, modemMode: 'single' | 'dual'): Promise<Record<string, any> | null> {
  return swallow(call<Record<string, any>>('sms-forward', 'get_config', { bus, modem_mode: modemMode }), null)
}

/* =========================================================================
 * 工具：测速（NUI 桥 m_speed）
 * ========================================================================= */

export interface SpeedServer {
  idx: number
  name: string
  host: string
  group?: string
}

export interface SpeedHistoryItem {
  time: number
  server: string
  ping: number | null
  jitter: number | null
  dl: number | null
  ul: number | null
  dl_bytes: number | null
  ul_bytes: number | null
  engine?: string
  area?: string
  fallback?: number
}

export interface SpeedBundle {
  servers: SpeedServer[]
  cdns: string[]
  history: SpeedHistoryItem[]
  client: string
}

export interface SpeedProbeResult {
  time: number
  /** server idx → 建连毫秒 */
  latency: Record<string, number>
}

export interface SpeedState {
  phase: string
  running: boolean
  dl: number | null
  ul: number | null
  ping: number | null
  jitter: number | null
  cur: number | null
  progress: number | null
  bytes: number | null
  dl_bytes: number | null
  ul_bytes: number | null
  server: string
  engine: string
  area: string
  error: string
  time: number | null
  node?: string
}

const SPEED_PHASES = ['starting', 'select', 'ping', 'dl', 'ul', 'done', 'stopped', 'error'] as const

export function speedPhaseLabel(phase: string): string {
  const map: Record<string, string> = {
    starting: '准备中…',
    select: '正在选择测速节点…',
    ping: '正在测量延迟…',
    dl: '下载测速中',
    ul: '上传测速中',
    done: '测速完成',
    stopped: '已停止',
    error: '测速失败',
  }
  return map[phase] || phase || '空闲'
}

/** 桥是否提供测速方法（用于决定是否退回官方 glass.speedtest） */
export async function speedSupported(): Promise<boolean> {
  const caps = await bridgeCaps()
  if (caps.caps && caps.caps.speed === false) return false
  return caps.available && caps.methods.has('speed.start') && caps.methods.has('speed.poll')
}

export async function getSpeedBundle(): Promise<SpeedBundle> {
  const r = await nuiSafe<Record<string, any>>('speed.servers')
  if (!r.ok) throw new Error(r.error)
  const d = r.data ?? {}
  const servers = (Array.isArray(d.servers) ? d.servers : []).map((s: Record<string, any>) => ({
    idx: Number(s.idx) || 0,
    name: str(s.name) || str(s.host),
    host: str(s.host),
    group: str(s.group) || undefined,
  }))
  const history = (Array.isArray(d.history) ? d.history : []).map((h: Record<string, any>) => ({
    time: Number(h.time) || 0,
    server: str(h.server) || str(h.name),
    ping: num(h.ping),
    jitter: num(h.jitter),
    dl: num(h.dl),
    ul: num(h.ul),
    dl_bytes: num(h.dl_bytes),
    ul_bytes: num(h.ul_bytes),
    engine: str(h.engine) || undefined,
    area: str(h.area) || undefined,
    fallback: num(h.fallback) ?? undefined,
  }))
  return {
    servers,
    cdns: Array.isArray(d.cdns) ? d.cdns.map((x: unknown) => String(x)) : [],
    history: history.sort((a, b) => b.time - a.time),
    client: str(d.client),
  }
}

export async function speedProbe(force = true): Promise<SpeedProbeResult | null> {
  const r = await nuiSafe<Record<string, any>>('speed.probe', { force: force ? '1' : '0' })
  if (!r.ok) throw new Error(r.error)
  const d = r.data ?? {}
  return { time: Number(d.time) || 0, latency: (d.latency as Record<string, number>) ?? {} }
}

/** 开始测速：server = auto | ookla:<idx> | cn:<ip:port> */
export async function speedStart(opts: {
  server: string
  duration: number
  conn: number
  cap: number
}): Promise<void> {
  const r = await nuiSafe('speed.start', {
    server: opts.server,
    duration: opts.duration,
    conn: opts.conn,
    cap: opts.cap,
  })
  if (!r.ok) throw new Error(r.error)
}

export async function speedPoll(): Promise<SpeedState> {
  const r = await nuiSafe<Record<string, any>>('speed.poll')
  if (!r.ok) throw new Error(r.error)
  const d = r.data ?? {}
  const phase = str(d.phase)
  return {
    phase,
    running: !!d.running,
    dl: num(d.dl),
    ul: num(d.ul),
    ping: num(d.ping),
    jitter: num(d.jitter),
    cur: num(d.cur),
    progress: num(d.progress),
    bytes: num(d.bytes),
    dl_bytes: num(d.dl_bytes),
    ul_bytes: num(d.ul_bytes),
    server: str(d.server) || str(d.node),
    engine: str(d.engine),
    area: str(d.area),
    error: str(d.error),
    time: num(d.time),
    node: str(d.node) || undefined,
  }
}

export async function speedStop(): Promise<void> {
  await nuiSafe('speed.stop')
}

export async function speedClearHistory(): Promise<void> {
  const r = await nuiSafe('speed.history_clear')
  if (!r.ok) throw new Error(r.error)
}

/**
 * 官方兜底：glass.speedtest（be-lua 部署后可用；服务端 curl 下载测速）
 * 返回 speed_mbps / bytes / http_code 等
 */
export async function glassSpeedtest(url: string, seconds = 10, maxMb = 100): Promise<Record<string, any>> {
  return callLong('glass', 'speedtest', { url, seconds, max_mb: maxMb }, 40000)
}

export function isSpeedPhase(p: string): p is (typeof SPEED_PHASES)[number] {
  return (SPEED_PHASES as readonly string[]).includes(p)
}

/* =========================================================================
 * 工具：网络诊断（NUI 桥 m_diag + 官方 diag.* 兜底）
 * ========================================================================= */

export interface DiagExit {
  iface: string
  dev: string
}

export interface DiagOptions {
  exits: DiagExit[]
  traceroute6: boolean
}

export type DiagKind = 'ping' | 'traceroute' | 'nslookup' | 'http' | 'tcp'

export interface DiagStartInput {
  kind: DiagKind
  host?: string
  url?: string
  port?: number | null
  count?: number
  size?: number
  interval?: number
  ttl?: number
  dev?: string
  family?: '4' | '6' | ''
  probes?: number
  wait?: number
  hops?: number
  resolve?: boolean
  server?: string
  timeout?: number
  method?: string
  follow?: boolean
  insecure?: boolean
}

export interface DiagChunk {
  text: string
  offset: number
  done: boolean
  rc: number | null
}

export async function diagSupported(): Promise<boolean> {
  const caps = await bridgeCaps()
  if (caps.caps && caps.caps.diag && typeof caps.caps.diag === 'object' && caps.caps.diag.ping === false) {
    // 桥声明 ping 不可用（traceroute 本机也可能 false），diag 页仍可给出说明
    return false
  }
  return caps.available && caps.methods.has('diag.start') && caps.methods.has('diag.poll')
}

export async function getDiagOptions(): Promise<DiagOptions> {
  const r = await nuiSafe<Record<string, any>>('diag.options')
  if (!r.ok) throw new Error(r.error)
  const d = r.data ?? {}
  return {
    exits: (Array.isArray(d.exits) ? d.exits : []).map((e: Record<string, any>) => ({
      iface: str(e.iface),
      dev: str(e.dev),
    })),
    traceroute6: !!d.traceroute6,
  }
}

export async function diagStart(input: DiagStartInput): Promise<{ cmd: string }> {
  const args: Record<string, unknown> = { kind: input.kind }
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') args[k] = v
  }
  put('host', input.host)
  put('url', input.url)
  put('port', input.port)
  put('count', input.count)
  put('size', input.size)
  put('interval', input.interval)
  put('ttl', input.ttl)
  put('dev', input.dev)
  put('family', input.family)
  put('probes', input.probes)
  put('wait', input.wait)
  put('hops', input.hops)
  put('resolve', input.resolve)
  put('server', input.server)
  put('timeout', input.timeout)
  put('method', input.method)
  put('follow', input.follow)
  put('insecure', input.insecure)
  const r = await nuiSafe<Record<string, any>>('diag.start', args)
  if (!r.ok) throw new Error(r.error)
  return { cmd: str(r.data?.cmd) }
}

export async function diagPoll(offset: number): Promise<DiagChunk> {
  const r = await nuiSafe<Record<string, any>>('diag.poll', { offset })
  if (!r.ok) throw new Error(r.error)
  const d = r.data ?? {}
  return {
    text: str(d.text),
    offset: Number(d.offset) || 0,
    done: !!d.done,
    rc: num(d.rc),
  }
}

export async function diagStop(): Promise<void> {
  await nuiSafe('diag.stop')
}

/** 官方 diag.ping（一次性输出，不能流式；参数是 addr，只支持 IPv4/域名） */
export async function officialDiagPing(addr: string): Promise<{ output: string; loss: number | null; avg: number | null }> {
  const r = await call<Record<string, any>>('diag', 'ping', { addr })
  const output = str(r?.ping_result)
  const loss = num(r?.loss) ?? (() => {
    const m = output.match(/(\d+)%\s*(?:packet )?loss/)
    return m ? Number(m[1]) : null
  })()
  const avg = (() => {
    const m = output.match(/min\/avg\/max[^=]*=\s*[\d.]+\/([\d.]+)\//)
    return m ? Number(m[1]) : null
  })()
  return { output, loss, avg }
}

/** 官方 diag.traceroute（一次性输出） */
export async function officialDiagTrace(addr: string): Promise<string> {
  const r = await call<Record<string, any>>('diag', 'traceroute', { addr })
  return str(r?.trace_result)
}

/* =========================================================================
 * 工具：历史监控（sys.details + clients.get_wan_speed + sys.rate_history）
 * ========================================================================= */

export interface RateHistory {
  enabled: boolean
  interval: number
  window: number
  /** [设备毫秒时间戳, 下行 B/s, 上行 B/s] */
  points: [number, number, number][]
  now: number
}

export async function getRateHistory(): Promise<RateHistory | null> {
  const r = await nuiSafe<Record<string, any>>('sys.rate_history')
  if (!r.ok) return null
  const d = r.data ?? {}
  const points = (Array.isArray(d.points) ? d.points : [])
    .map((p: any) => {
      if (!Array.isArray(p) || p.length < 3) return null
      const t = Number(p[0])
      const down = Number(p[1])
      const up = Number(p[2])
      if (!Number.isFinite(t) || !Number.isFinite(down) || !Number.isFinite(up)) return null
      return [t, down, up] as [number, number, number]
    })
    .filter((x: [number, number, number] | null): x is [number, number, number] => !!x)
  return {
    enabled: d.enabled !== false,
    interval: Number(d.interval) || 3,
    window: Number(d.window) || 180,
    points,
    now: Number(d.now) || Date.now(),
  }
}

export interface SystemSample {
  cpu: number | null
  memUsed: number | null
  memTotal: number | null
  memPct: number | null
  uptime: number | null
  /** glass / sys.details */
  source: string
}

/** 读一次 CPU/内存（glass.get_status 优先，不可用时用 NUI sys.details） */
export async function sampleSystem(): Promise<SystemSample> {
  const g = await swallow(call<Record<string, any>>('glass', 'get_status'), null)
  if (g) {
    const total = Number(g.memory?.total) || 0
    const used = Number(g.memory?.used) || 0
    return {
      cpu: num(g.cpu_avg),
      memUsed: total ? used : null,
      memTotal: total || null,
      memPct: total ? Math.round((used / total) * 100) : null,
      uptime: num(g.uptime),
      source: 'glass.get_status',
    }
  }
  const r = await nuiSafe<Record<string, any>>('sys.details')
  if (!r.ok) throw new Error(r.error)
  const d = r.data ?? {}
  const total = Number(d.memory?.total) || 0
  const avail = Number(d.memory?.available) || 0
  const used = total ? total - avail : 0
  return {
    cpu: num(d.cpu?.usage),
    memUsed: total ? used : null,
    memTotal: total || null,
    memPct: total ? Math.round((used / total) * 100) : null,
    uptime: num(d.runtime?.uptime),
    source: 'NUI 桥 sys.details',
  }
}

/** 采样详情里的网卡列表（诊断/监控明细用） */
export async function getNetdevs(): Promise<{ name: string; up: boolean; rx: number; tx: number }[]> {
  const r = await nuiSafe<Record<string, any>>('sys.details')
  if (!r.ok) return []
  const list = (r.data?.netdevs as Record<string, any>[] | undefined) ?? []
  return list.map((n) => ({
    name: str(n.name),
    up: !!n.up,
    rx: Number(n.rx) || 0,
    tx: Number(n.tx) || 0,
  }))
}

/* =========================================================================
 * 工具：联网检测 / WAN 健康检查
 * ========================================================================= */

export interface ConnResult {
  ok: boolean
  level: 'ok' | 'link' | 'down'
  active: string
  ifaces: {
    name: string
    online: boolean
    status: string
    ip?: string
    gateway?: string
    latency?: number | null
    v4?: boolean
    v6?: boolean
  }[]
  latency: number | null
  gateway: string
  gatewayOk: boolean | null
  target: string
  dnsOk: boolean | null
  checkedAt: number
  source: string
  note: string
}

/** 联网检测：glass.conn_check 优先；未部署时用 kmwan + 真 ping 组合（不伪造） */
export async function connCheck(): Promise<ConnResult> {
  // 1) 自有 glass 模块（be-lua 部署后可用，一次调用给出 level/iface/gateway/latency/dns_ok）
  const g = await swallow(call<Record<string, any>>('glass', 'conn_check'), null)
  if (g && typeof g.online === 'boolean') {
    return {
      ok: !!g.online,
      level: (str(g.level) as ConnResult['level']) || (g.online ? 'ok' : 'down'),
      active: str(g.iface) || 'wan',
      ifaces: [
        {
          name: str(g.iface) || 'wan',
          online: !!g.online,
          status: g.online ? 'online' : g.gateway_ok ? '仅网关可达' : 'offline',
          ip: '',
          gateway: str(g.gateway),
          latency: num(g.latency),
        },
      ],
      latency: num(g.latency),
      gateway: str(g.gateway),
      gatewayOk: typeof g.gateway_ok === 'boolean' ? g.gateway_ok : null,
      target: str(g.target),
      dnsOk: typeof g.dns_ok === 'boolean' ? g.dns_ok : null,
      checkedAt: Number(g.checked_at) ? Number(g.checked_at) * 1000 : Date.now(),
      source: 'glass.conn_check',
      note: '',
    }
  }

  // 2) 降级：kmwan 逐接口状态 + 官方 diag.ping 真探测
  const km = await swallow(call<Record<string, any>>('kmwan', 'get_status'), null)
  const kmIfaces = (km?.interfaces as Record<string, any>[] | undefined) ?? []
  const ifaces: ConnResult['ifaces'] = kmIfaces.map((i) => {
    const v4 = Number(i.status_v4) === 1
    const v6 = Number(i.status_v6) === 1
    return {
      name: str(i.interface),
      online: v4 || v6,
      status: v4 ? 'IPv4 在线' : v6 ? '仅 IPv6 在线' : '离线',
      v4,
      v6,
    }
  })

  const wan = await swallow(call<Record<string, any>>('lan', 'get_wan_info'), null)
  const w0 = (wan?.wan_info as Record<string, any>[] | undefined)?.[0]
  const wanIface = str(w0?.interface)
  const wanIp = str(w0?.info?.ipaddr ?? w0?.info?.ip)
  if (wanIface && !ifaces.some((i) => i.name === wanIface)) {
    ifaces.push({ name: wanIface, online: !!wanIp, status: wanIface === 'wwan' ? '中继上行' : '已连接', ip: wanIp })
  } else if (wanIface) {
    const hit = ifaces.find((i) => i.name === wanIface)
    if (hit) hit.ip = wanIp
  }

  const cable = await swallow(call<Record<string, any>>('network', 'check_wan_cable'), null)
  const cableInserted = !!cable?.cable_inserted

  // 真延迟：官方 diag.ping（spawn ping -c4，一次性返回）
  let latency: number | null = null
  let target = ''
  let note = ''
  try {
    const p = await officialDiagPing('223.5.5.5')
    latency = p.avg
    target = '223.5.5.5'
    if (!p.output) note = 'diag.ping 无输出'
  } catch (e) {
    note = `diag.ping 不可用：${friendlyError(e)}`
  }
  const ok = latency !== null
  let dnsOk: boolean | null = null
  if (ok) {
    try {
      const p = await officialDiagPing('www.baidu.com')
      dnsOk = !!p.output && !/bad address|unknown host|not found/i.test(p.output)
    } catch {
      dnsOk = false
    }
  }

  const gateway = ''
  return {
    ok,
    level: ok ? 'ok' : ifaces.some((i) => i.online) || cableInserted ? 'link' : 'down',
    active: ifaces.find((i) => i.online)?.name || wanIface,
    ifaces,
    latency,
    gateway,
    gatewayOk: null,
    target,
    dnsOk,
    checkedAt: Date.now(),
    source: 'kmwan.get_status + diag.ping',
    note: note || (g ? '' : 'glass.conn_check 未部署（be-lua Wave2 后可用），当前用官方 kmwan + 真 ping 组合判定'),
  }
}

export interface WanHealth {
  supported: boolean
  source: string
  reason: string
  /** 桥 adv.wanchk_get 的线路配置 */
  lines: Record<string, any>[]
  /** 官方 kmwan 的链路跟踪配置（只读展示） */
  kmwan: Record<string, any>[]
}

/** WAN 健康检查：glass.wanchk_get → 桥 adv.wanchk_get → 官方 kmwan.get_config（只读兜底） */
export async function wanHealth(): Promise<WanHealth> {
  const km = await swallow(call<Record<string, any>>('kmwan', 'get_config'), null)
  const kmwan = (km?.interfaces as Record<string, any>[] | undefined) ?? []
  const g = await swallow(call<Record<string, any>>('glass', 'wanchk_get'), null)
  if (g && Array.isArray(g.profiles)) {
    return {
      supported: !!g.supported,
      source: 'glass.wanchk_get',
      reason: '',
      lines: g.profiles as Record<string, any>[],
      kmwan,
    }
  }
  const adv = await nuiSafe<Record<string, any>>('adv.wanchk_get')
  if (adv.ok) {
    const lines = ((adv.data?.lines ?? adv.data?.profiles) as Record<string, any>[] | undefined) ?? []
    return { supported: true, source: 'NUI 桥 adv.wanchk_get', reason: '', lines, kmwan }
  }
  return {
    supported: false,
    source: kmwan.length ? '官方 kmwan.get_config（只读）' : '不可用',
    reason: adv.error || '本机没有 wanchk 配置接口',
    lines: [],
    kmwan,
  }
}

/* =========================================================================
 * 页面级错误兜底（视图里 catch 后统一调用）
 * ========================================================================= */
export { swallow }
