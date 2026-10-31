/** 全局数据类型。GL SDK4 返回的字段随固件版本略有差异，因此关键结构用可选字段 + 索引签名兜底。 */

export interface TempReading {
  name: string
  temp: number
}

export interface Health {
  cpu: number
  cores: number[]
  memTotal: number
  memUsed: number
  memPct: number
  temps: TempReading[]
  temp: number | null
  fan: number | null
  disk: Record<string, unknown> | null
  uptime: number
  load: number[]
}

export interface WanInfo {
  interface?: string
  protocol?: string
  ip?: string
  netmask?: string
  gateway?: string
  dns?: string[] | string
  up?: boolean
  [key: string]: unknown
}

export interface WifiBand {
  band?: string
  ssid?: string
  channel?: number | string
  enabled?: boolean
  enc?: string
  device?: string
  wifi_type?: string
  guest?: boolean
  [key: string]: unknown
}

export interface WifiConfig {
  bands?: WifiBand[]
  [key: string]: unknown
}

export interface WifiStatus {
  bands?: WifiBand[]
  count?: number
  [key: string]: unknown
}

export interface Client {
  mac: string
  ip: string
  name?: string
  iface?: string
  online?: boolean
  online_time?: number | string
  rx?: number
  tx?: number
  total_rx?: number
  total_tx?: number
}

export interface SysInfo {
  model?: string
  firmware_version?: string
  [key: string]: unknown
}

export interface CloudBundle {
  cfg: Record<string, any> | null
  bind: Record<string, any> | null
  meta: Record<string, any> | null
  ddns: Record<string, any> | null
  ddnsStatus: Record<string, any> | null
  sdbundle: Record<string, any> | null
  bindUrl: string | null
}

/** 数据适配层：GL 原厂 /rpc 与离线演示两套实现共用这套接口 */
export interface DeviceApi {
  readonly kind: 'rpc' | 'demo'
  /** 通用 JSON-RPC 调用：call(object, method, params, opts) */
  call<T = any>(
    object: string,
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeout?: number },
  ): Promise<T>
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
  alive(): Promise<boolean>
  health(): Promise<Health | null>
  speed(): Promise<{ rx: number; tx: number } | null>
  info(): Promise<SysInfo | null>
  wan(): Promise<WanInfo | null>
  wifi(): Promise<{ config: WifiConfig | null; status: WifiStatus | null }>
  clients(): Promise<Client[]>
  cable(): Promise<boolean | null>
  networkStatus(): Promise<Record<string, any> | null>
  publicIp(): Promise<string | null>
  lanConfig(): Promise<Record<string, any> | null>
  arp(): Promise<Record<string, any>[]>
  cloud(): Promise<CloudBundle>
  setCloud(patch: Record<string, unknown>): Promise<void>
  setDdns(enable: boolean): Promise<void>
}
