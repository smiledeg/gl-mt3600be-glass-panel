import { loginHash } from './crypto'
import type { Client, CloudBundle, DeviceApi, Health, SysInfo, WanInfo, WifiConfig, WifiStatus } from './types'

const ENDPOINT = '/rpc'
const SID_KEY = 'nui.sid'
const SHARED_SID_KEY = 'nui.sid.shared'
const USER_KEY = 'nui.user'

class RpcError extends Error {
  code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

/* ---------------- 会话过期通知 ----------------
 * GL 的 gl-session：默认 session_timeout=300 秒，最多 5 个并发会话（第 6 个登录会踢掉最久未用的）。
 * 会话失效后所有 /rpc call 都返回 -32000 Access denied / "not logged in"，页面若不处理就会停在
 * “全部指标为空”的状态（看起来像断网）。这里统一检测并通知 UI 跳回登录页。 */
type ExpiredHandler = () => void
const expiredHandlers: ExpiredHandler[] = []

export function onAuthExpired(fn: ExpiredHandler): void {
  expiredHandlers.push(fn)
}

function notifyExpired(silent = false): void {
  for (const fn of expiredHandlers) {
    try {
      fn()
    } catch {
      /* 忽略单个监听器异常 */
    }
  }
  if (!silent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gl-auth-expired'))
  }
}

/** 判断是否是“会话失效”类错误（GL 的 code 不统一，message 也判一下） */
function isAuthError(code?: number, message?: string): boolean {
  if (code === -32000 || code === 401 || code === -32602) return true
  const m = String(message || '')
  return /access denied|not logged|not login|unauthori[sz]ed|session (invalid|expired|not found)|invalid session/i.test(m)
}

/** GL SDK4 JSON-RPC 客户端（与官方后台同源同权） */
class GlRpc {
  /** 同标签页用 sessionStorage；同时共享到 localStorage，避免多标签页各开一个会话（gl-session 最多 5 个） */
  sid: string | null = sessionStorage.getItem(SID_KEY) || localStorage.getItem(SHARED_SID_KEY)
  private expired = false

  get isExpired(): boolean {
    return this.expired
  }

  private markExpired(): void {
    if (this.expired) return
    this.expired = true
    this.sid = null
    sessionStorage.removeItem(SID_KEY)
    localStorage.removeItem(SHARED_SID_KEY)
    notifyExpired()
  }

  /** 页面重新登录成功后复位过期标记 */
  private resetExpired(): void {
    this.expired = false
  }

  private async post(payload: unknown, timeoutMs = 20000): Promise<any> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
      if (!r.ok) throw new RpcError(`HTTP ${r.status}`)
      // 某些固件在会话失效时返回非 JSON，这里兜住
      const text = await r.text()
      try {
        return JSON.parse(text)
      } catch {
        throw new RpcError('接口返回非 JSON（可能未登录或固件不支持）')
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new RpcError(`请求超时（${Math.round(timeoutMs / 1000)}s）`)
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  async login(username: string, password: string): Promise<void> {
    const ch = await this.post({ jsonrpc: '2.0', id: 1, method: 'challenge', params: { username } })
    if (ch.error) throw new RpcError(ch.error.message || 'challenge 失败', ch.error.code)
    const d = ch.result || {}
    if (!d.salt || !d.nonce) throw new RpcError('登录接口异常：未返回 salt/nonce')

    const hash = loginHash(username, password, d.salt, d.nonce)
    const res = await this.post({
      jsonrpc: '2.0',
      id: 2,
      method: 'login',
      params: { username, hash },
    })
    if (res.error) throw new RpcError(res.error.message || '用户名或密码错误', res.error.code)
    if (!res.result?.sid) throw new RpcError('未获取到会话')
    this.sid = res.result.sid
    this.resetExpired()
    sessionStorage.setItem(SID_KEY, this.sid!)
    try {
      localStorage.setItem(SHARED_SID_KEY, this.sid!)
    } catch {
      /* localStorage 可能被禁用，忽略 */
    }
    sessionStorage.setItem(USER_KEY, username)
  }

  /**
   * 调用一个 rpc 方法。
   * GL 的错误有两层：JSON-RPC 的 error，以及业务层的 result.err_code（HTTP 仍 200），
   * 这里统一抛 RpcError，视图只需要 catch 一次。
   */
  async call<T = any>(
    object: string,
    method: string,
    args: Record<string, unknown> = {},
    opts: { timeout?: number } = {},
  ): Promise<T> {
    if (!this.sid) {
      this.markExpired()
      throw new RpcError('登录已过期，请重新登录')
    }
    const res = await this.post(
      {
        jsonrpc: '2.0',
        id: Date.now() % 1e9,
        method: 'call',
        params: [this.sid, object, method, args],
      },
      opts.timeout ?? 20000,
    )
    if (res.error) {
      if (isAuthError(res.error.code, res.error.message)) this.markExpired()
      throw new RpcError(res.error.message || '调用失败', res.error.code)
    }
    const out = res.result
    if (out && typeof out === 'object' && 'err_code' in out) {
      const code = Number((out as any).err_code)
      const msg = String((out as any).err_msg || '')
      if (Number.isFinite(code) && code !== 0) {
        // 业务错误里也可能带 “Access denied / not logged in”
        if (isAuthError(undefined, msg)) this.markExpired()
        throw new RpcError(msg || `调用失败（err_code ${code}）`, code)
      }
    }
    return out as T
  }

  /** 会话保活（gl-session 的 timeout=300s，定期 touch 才不会被回收） */
  async alive(): Promise<boolean> {
    if (!this.sid) return false
    const res = await this.post({ jsonrpc: '2.0', id: 3, method: 'alive', params: { sid: this.sid } })
    if (res.error) {
      if (isAuthError(res.error.code, res.error.message)) this.markExpired()
      return false
    }
    return true
  }

  async logout(): Promise<void> {
    const sid = this.sid
    this.sid = null
    this.expired = false
    sessionStorage.removeItem(SID_KEY)
    localStorage.removeItem(SHARED_SID_KEY)
    if (!sid) return
    await this.post({ jsonrpc: '2.0', id: 4, method: 'logout', params: { sid } }).catch(() => {})
  }
}

const rpc = new GlRpc()
const swallow = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback)

function pickTemps(raw: any): { temps: Health['temps']; temp: number | null } {
  const temps: Health['temps'] = Array.isArray(raw)
    ? raw
        .filter((t: any) => t && typeof t.temp === 'number')
        .map((t: any) => ({ name: String(t.name ?? 'sensor'), temp: t.temp }))
    : []
  const soc = temps.find((t) => /soc|cpu|cpu-thermal/i.test(t.name)) || temps[0]
  return { temps, temp: soc ? soc.temp : null }
}

/** 真实设备实现 */
export const rpcApi: DeviceApi = {
  kind: 'rpc',

  call: <T = any>(
    object: string,
    method: string,
    params: Record<string, unknown> = {},
    opts: { timeout?: number } = {},
  ) => rpc.call<T>(object, method, params, opts),

  login: (u, p) => rpc.login(u, p),
  logout: () => rpc.logout(),
  alive: () => rpc.alive(),

  async health(): Promise<Health | null> {
    const r = await swallow(rpc.call<any>('glass', 'get_status'), null)
    if (!r) return null
    const { temps, temp } = pickTemps(r.temps)
    const total = r.memory?.total ?? 0
    const used = r.memory?.used ?? 0
    return {
      cpu: r.cpu_avg ?? 0,
      cores: Array.isArray(r.cpu) ? r.cpu.map((v: number) => v ?? 0) : [],
      memTotal: total,
      memUsed: used,
      memPct: total ? Math.round((used / total) * 100) : 0,
      temps,
      temp,
      fan: r.fan?.speed ?? null,
      disk: r.disk ?? null,
      uptime: r.uptime ?? 0,
      load: Array.isArray(r.load) ? r.load : [0, 0, 0],
    }
  },

  async speed() {
    const r = await swallow(rpc.call<any>('clients', 'get_wan_speed'), null)
    if (!r) return null
    return { rx: Number(r.speed_rx) || 0, tx: Number(r.speed_tx) || 0 }
  },

  async info(): Promise<SysInfo | null> {
    return swallow(rpc.call<SysInfo>('system', 'get_info'), null)
  },

  async wan(): Promise<WanInfo | null> {
    const r = await swallow(rpc.call<any>('lan', 'get_wan_info'), null)
    const w = r?.wan_info?.[0]
    if (!w) return null
    // 4.9 的结构是 { interface, info: { ipaddr, netmask, network, broadcast, prefix } }
    const i = w.info || {}
    const ip = i.ipaddr || i.ip || ''
    return {
      interface: w.interface || '',
      ip,
      netmask: i.netmask || '',
      gateway: i.gateway || '',
      dns: i.dns || r?.dns,
      protocol: i.proto || i.protocol || w.proto || '',
      up: !!ip,
    } as WanInfo
  },

  async wifi(): Promise<{ config: WifiConfig | null; status: WifiStatus | null }> {
    const [config, status] = await Promise.all([
      swallow(rpc.call<WifiConfig>('wifi', 'get_config'), null),
      swallow(rpc.call<WifiStatus>('wifi', 'get_status'), null),
    ])
    return { config, status }
  },

  async clients(): Promise<Client[]> {
    const r = await swallow(rpc.call<any>('clients', 'get_list'), null)
    return (r?.clients ?? []) as Client[]
  },

  cable: () => swallow(rpc.call<boolean>('network', 'check_wan_cable'), null),
  networkStatus: () => swallow(rpc.call<any>('system', 'get_network_status'), null),

  async publicIp(): Promise<string | null> {
    const r = await swallow(rpc.call<any>('network', 'get_public_ip'), null)
    if (!r) return null
    return r.ipv4 || r.ip || (Array.isArray(r) ? r[0] : null) || null
  },

  lanConfig: () => swallow(rpc.call<any>('lan', 'get_config_list'), null),

  async arp() {
    const r = await swallow(rpc.call<any>('network', 'get_arp_list'), null)
    return Array.isArray(r) ? r : (r?.list ?? [])
  },

  async cloud(): Promise<CloudBundle> {
    // 注意：不要自动调用 cloud.bind_info —— 官方实现会在“云端未返回绑定信息”时
    // 清掉 uci 里的 username/bindtime，导致官方后台 GoodCloud 变“未连接”。
    // 绑定信息直接从 cloud.get_config 的 username/bindtime 读取。
    const [cfg, meta, ddns, ddnsStatus, sdbundle] = await Promise.all([
      swallow(rpc.call<any>('cloud', 'get_config'), null),
      swallow(rpc.call<any>('glass', 'get_cloud_info'), null),
      swallow(rpc.call<any>('ddns', 'get_config'), null),
      swallow(rpc.call<any>('ddns', 'get_status'), null),
      swallow(rpc.call<any>('mptun', 'get_config'), null),
    ])
    const bundle: CloudBundle = {
      cfg,
      bind: cfg && cfg.username ? { username: cfg.username, bind_time: cfg.bindtime } : null,
      meta,
      ddns,
      ddnsStatus,
      sdbundle,
      // 不在轮询里自动 get_bind_url：该调用会让 gl-cloud 重新取绑定 token，
      // 已绑定设备可能因此掉线/官方后台显示“未连接”。绑定链接由“生成绑定链接”按钮按需获取。
      bindUrl: null,
    }
    return bundle
  },

  async setCloud(patch) {
    await rpc.call('cloud', 'set_config', patch)
  },

  async setDdns(enable) {
    await rpc.call('ddns', 'set_config', { enable_ddns: !!enable })
  },
}
