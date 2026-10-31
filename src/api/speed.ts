import { nui } from '@/api/nui'

/**
 * 网络测速数据层 —— 与 NUI 插件「网络测速」页完全相同的后端方法（luci.nui.m_speed / cnspeed / nui-speedtest / nui-exptest）。
 *
 * 方法矩阵（详见 docs/api-plugin.md 与设备端 /usr/lib/lua/luci/nui/m_speed.lua）：
 *   外网测速：speed.servers / speed.probe / speed.cn_nodes / speed.start / speed.poll / speed.stop / speed.history_clear
 *   网页性能：speed.exp_items / speed.exp_start{kind:'web'} / speed.exp_poll{kind:'web'} / speed.exp_stop
 *   视频测速：speed.exp_start{kind:'video',duration,conn,cap} / speed.exp_poll{kind:'video'}
 *   局域网：  speed.lan_ticket / speed.lan_http → 浏览器直连路由器 8098 端口测速
 */

export interface SpeedHist {
  time: number
  server?: string
  ping?: number
  jitter?: number
  dl?: number
  ul?: number
  dl_bytes?: number
  ul_bytes?: number
  engine?: string
  area?: string
  fallback?: string
}

export interface SpeedServers {
  servers: { idx: number; name: string; host: string; group?: string }[]
  cdns: string[]
  history: SpeedHist[]
  client?: string
}

export interface CnNodes {
  loc?: { province?: string; city?: string; operator?: string; ip?: string }
  nodes: [string, string, string, string, string][]
  updated?: number
  error?: string
}

export interface WanState {
  phase?: string
  engine?: string
  server?: string
  node?: string
  area?: string
  ping?: number
  jitter?: number
  dl?: number
  ul?: number
  cur?: number
  avg?: number
  progress?: number
  bytes?: number
  dl_bytes?: number
  ul_bytes?: number
  time?: number
  error?: string
  fallback?: string
  trying?: string
  running?: boolean
  cdn?: number
  server_idx?: number
}

export interface WebItem {
  id: string
  name: string
  catg?: string
  url: string
}

export interface VideoItem {
  id: string
  name: string
  url: string
  height?: number
  bitrate?: number
}

export interface ExpItems {
  web: WebItem[]
  video: VideoItem[]
  updated?: number
  error?: string
}

export interface WebResult {
  id: string
  name: string
  catg?: string
  url: string
  status: string
  ok?: boolean
  error?: string
  code?: number
  dns?: number
  connect?: number
  tls?: number
  ttfb?: number
  total?: number
  size?: number
  redirects?: number
  /** 客户端计算：打开速度 KB/s */
  speed?: number
}

export interface VideoResult {
  id: string
  name: string
  url: string
  height?: number
  bitrate?: number
  status: string
  ok?: boolean
  error?: string
  segments?: number
  bytes?: number
  ms?: number
  ttfb?: number
  speed?: number
}

export interface ExpState<R = WebResult | VideoResult> {
  kind: string
  phase: string
  started?: number
  running?: boolean
  results: R[]
  cur?: number
  progress?: number
  error?: string
}

export interface LanTicket {
  ticket: string
  expires: number
  port?: number
}

const call = <T>(method: string, args: Record<string, unknown> = {}) => nui.invoke<T>(method, args)

export const speedApi = {
  /* ---------- 外网 ---------- */
  servers: () => call<SpeedServers>('speed.servers'),
  probe: (force = false) => call<{ time: number; latency: Record<string, number> }>('speed.probe', { force }),
  cnNodes: (force = false) => call<CnNodes>('speed.cn_nodes', { force }),
  start: (opts: { server: string; duration: number; conn: number; cap: number }) =>
    call<{ started: boolean }>('speed.start', opts),
  poll: () => call<WanState>('speed.poll'),
  stop: () => call<unknown>('speed.stop'),
  clearHistory: () => call<unknown>('speed.history_clear'),

  /* ---------- 体验测速 ---------- */
  expItems: (force = false) => call<ExpItems>('speed.exp_items', { force }),
  expStartWeb: (ids?: string[]) => call<{ started: boolean }>('speed.exp_start', { kind: 'web', ids: ids ?? [] }),
  expStartVideo: (opts: { duration: number; conn: number; cap: number; ids?: string[] }) =>
    call<{ started: boolean }>('speed.exp_start', { kind: 'video', ...opts, ids: opts.ids ?? [] }),
  expPoll: <R>(kind: 'web' | 'video') => call<ExpState<R>>('speed.exp_poll', { kind }),
  expStop: (kind: 'web' | 'video') => call<unknown>('speed.exp_stop', { kind }),

  /* ---------- 局域网 ---------- */
  lanTicket: () => call<LanTicket>('speed.lan_ticket'),
  lanHttp: () => call<LanTicket>('speed.lan_http'),
}

/* ========================================================================
 * 局域网测速（浏览器 ↔ 路由器，走路由器上独立的 8098 端口 HTTP 小服务）
 * 下载：/dl/<ticket>.bin（uhttpd 直接发 2GB 稀疏文件，读多少算多少）
 * 上传：POST /cgi-bin/nui-speed?ul&t=<ticket>（CGI 读后丢弃）
 * ====================================================================== */

export interface LanProgress {
  phase: 'dl' | 'ul' | 'done' | 'error' | 'stopped'
  cur: number
  avg: number
  progress: number
  dl?: number
  ul?: number
  dlBytes?: number
  ulBytes?: number
  error?: string
}

/** 绕过 caches 的 fetch；支持 AbortSignal */
function lanFetch(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { cache: 'no-store', signal, mode: 'cors', credentials: 'omit' })
}

/**
 * 在浏览器里跑局域网测速（HTTPS 页面会被浏览器拦混合内容，调用方需先判断 location.protocol）。
 * 与插件页算法一致：固定时长多线程，丢弃前 1.5s 慢启动，按字节数/稳定期时间算 Mbps。
 */
export async function runLanTest(
  port: number,
  ticket: string,
  opts: { seconds: number; threads: number; onProgress: (p: LanProgress) => void; signal: AbortSignal },
): Promise<{ dl: number; ul: number; dlBytes: number; ulBytes: number }> {
  const { seconds, threads, onProgress, signal } = opts
  const base = `http://${location.hostname}:${port}`
  const dlUrl = `${base}/dl/${ticket}.bin`
  const ulUrl = `${base}/cgi-bin/nui-speed?ul&t=${ticket}`
  const t0 = performance.now() + 200
  const end = t0 + seconds * 1000
  const startAt = t0

  /* ---------- 下载 ---------- */
  let dlBytes = 0
  let done = false
  const dlWorkers: Promise<void>[] = []
  for (let i = 0; i < threads; i++) {
    dlWorkers.push(
      (async () => {
        while (!done && !signal.aborted && performance.now() < end) {
          try {
            const res = await lanFetch(`${dlUrl}?_=${Date.now()}-${i}`, signal)
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
            const reader = res.body.getReader()
            while (!done && !signal.aborted) {
              const { done: fin, value } = await reader.read()
              if (fin) break
              dlBytes += value?.byteLength ?? 0
            }
            try {
              await reader.cancel()
            } catch {
              /* ignore */
            }
          } catch (e) {
            if (signal.aborted) return
            if (performance.now() < end) throw e
          }
        }
      })(),
    )
  }
  const timer = window.setInterval(() => {
    const now = performance.now()
    const elapsed = Math.max(0.001, (now - startAt) / 1000)
    const stable = Math.max(0.001, elapsed - 1.5)
    const avg = (dlBytes * 8) / stable / 1e6
    onProgress({
      phase: 'dl',
      cur: avg,
      avg,
      progress: Math.min(100, (elapsed / seconds) * 100),
      dlBytes,
    })
    if (now >= end) done = true
  }, 250)

  await Promise.all(dlWorkers)
  done = true
  clearInterval(timer)
  const dlElapsed = Math.max(0.001, (performance.now() - startAt) / 1000 - 1.5)
  const dl = (dlBytes * 8) / Math.max(0.001, Math.min(seconds, dlElapsed)) / 1e6
  if (signal.aborted) {
    onProgress({ phase: 'stopped', cur: 0, avg: 0, progress: 0 })
    return { dl, ul: 0, dlBytes, ulBytes: 0 }
  }
  onProgress({ phase: 'ul', cur: 0, avg: dl, progress: 0, dl, dlBytes })

  /* ---------- 上传 ---------- */
  const blob = new Blob([new Uint8Array(32 * 1048576)])
  let ulBytes = 0
  const ulStart = performance.now()
  const ulEnd = ulStart + seconds * 1000
  let lastTick: Record<number, number> = {}
  const ulWorkers: Promise<void>[] = []
  for (let i = 0; i < threads; i++) {
    ulWorkers.push(
      (async () => {
        while (!signal.aborted && performance.now() < ulEnd) {
          await new Promise<void>((resolve) => {
            const xhr = new XMLHttpRequest()
            let loaded = 0
            lastTick[i] = 0
            xhr.open('POST', `${ulUrl}&_=${Date.now()}-${i}`)
            xhr.upload.onprogress = (e) => {
              ulBytes += e.loaded - loaded
              loaded = e.loaded
              lastTick[i] = performance.now()
            }
            xhr.onloadend = () => resolve()
            xhr.onerror = () => resolve()
            xhr.onabort = () => resolve()
            signal.addEventListener('abort', () => xhr.abort(), { once: true })
            xhr.send(blob)
          })
        }
      })(),
    )
  }
  const ulTimer = window.setInterval(() => {
    const elapsed = Math.max(0.001, (performance.now() - ulStart) / 1000)
    const stable = Math.max(0.001, elapsed - 1.5)
    const avg = (ulBytes * 8) / stable / 1e6
    onProgress({
      phase: 'ul',
      cur: avg,
      avg,
      progress: Math.min(100, (elapsed / seconds) * 100),
      dl,
      dlBytes,
      ulBytes,
    })
  }, 250)
  await Promise.all(ulWorkers)
  clearInterval(ulTimer)
  const ulElapsed = Math.max(0.001, (performance.now() - ulStart) / 1000 - 1.5)
  const ul = (ulBytes * 8) / Math.max(0.001, Math.min(seconds, ulElapsed)) / 1e6
  if (signal.aborted) {
    onProgress({ phase: 'stopped', cur: 0, avg: 0, progress: 0, dl, ul, dlBytes, ulBytes })
    return { dl, ul, dlBytes, ulBytes }
  }
  onProgress({ phase: 'done', cur: 0, avg: ul, progress: 100, dl, ul, dlBytes, ulBytes })
  return { dl, ul, dlBytes, ulBytes }
}

/**
 * 同源 CGI 兜底测速（与 NUI 1.2.0-16 的 ur()/er() 等价）：
 * 不走 8098 HTTP 小服务时，页面直接用本域已登录的 /cgi-bin/nui-speed（带 speed.lan_ticket 的凭据）测，
 * 下载 = fetch ?dl=1024 循环读流，上传 = XHR POST ?ul；结果会受 HTTPS 加密开销影响，但保证有数据。
 */
export async function runLanCgiTest(opts: {
  ticket: string
  seconds: number
  threads: number
  onProgress: (p: LanProgress) => void
  signal: AbortSignal
}): Promise<{ dl: number; ul: number; dlBytes: number; ulBytes: number }> {
  const { ticket, seconds, onProgress, signal } = opts
  const threads = Math.max(1, Math.min(3, opts.threads || 3))
  const dlT0 = performance.now()
  const dlEnd = dlT0 + seconds * 1000
  let dlBytes = 0
  let dlDone = false
  const dlWorkers: Promise<void>[] = []
  for (let i = 0; i < threads; i++) {
    dlWorkers.push(
      (async () => {
        while (!dlDone && !signal.aborted && performance.now() < dlEnd) {
          try {
            const res = await fetch(`/cgi-bin/nui-speed?dl=1024&t=${ticket}&_=${Date.now()}-${i}`, { cache: 'no-store', signal })
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
            const reader = res.body.getReader()
            while (!dlDone && !signal.aborted) {
              const { done, value } = await reader.read()
              if (done) break
              dlBytes += value?.byteLength ?? 0
            }
            try {
              await reader.cancel()
            } catch {
              /* ignore */
            }
          } catch (e) {
            if (signal.aborted) return
            if (performance.now() < dlEnd) throw e
          }
        }
      })(),
    )
  }
  const dlTimer = window.setInterval(() => {
    const elapsed = Math.max(0.001, (performance.now() - dlT0) / 1000)
    const stable = Math.max(0.001, elapsed - 1.5)
    const avg = (dlBytes * 8) / stable / 1e6
    onProgress({ phase: 'dl', cur: avg, avg, progress: Math.min(100, (elapsed / seconds) * 100), dlBytes })
    if (performance.now() >= dlEnd) dlDone = true
  }, 250)
  await Promise.all(dlWorkers)
  dlDone = true
  clearInterval(dlTimer)
  const dl = (dlBytes * 8) / Math.max(0.001, Math.min(seconds, Math.max(0.1, (performance.now() - dlT0) / 1000 - 1.5))) / 1e6
  if (signal.aborted) {
    onProgress({ phase: 'stopped', cur: 0, avg: 0, progress: 0 })
    return { dl, ul: 0, dlBytes, ulBytes: 0 }
  }
  onProgress({ phase: 'ul', cur: 0, avg: dl, progress: 0, dl, dlBytes })

  const ulT0 = performance.now()
  const ulEnd = ulT0 + seconds * 1000
  let ulBytes = 0
  const blob = new Blob([new Uint8Array(32 * 1048576)])
  const ulWorkers: Promise<void>[] = []
  for (let i = 0; i < threads; i++) {
    ulWorkers.push(
      new Promise<void>((resolve) => {
        const loop = () => {
          if (signal.aborted || performance.now() >= ulEnd) return resolve()
          const xhr = new XMLHttpRequest()
          let loaded = 0
          xhr.open('POST', `/cgi-bin/nui-speed?ul&t=${ticket}&_=${Date.now()}-${i}`)
          xhr.upload.onprogress = (e) => {
            ulBytes += e.loaded - loaded
            loaded = e.loaded
          }
          xhr.onloadend = () => loop()
          xhr.onerror = () => resolve()
          signal.addEventListener('abort', () => xhr.abort(), { once: true })
          xhr.send(blob)
        }
        loop()
      }),
    )
  }
  const ulTimer = window.setInterval(() => {
    const elapsed = Math.max(0.001, (performance.now() - ulT0) / 1000)
    const stable = Math.max(0.001, elapsed - 1.5)
    const avg = (ulBytes * 8) / stable / 1e6
    onProgress({ phase: 'ul', cur: avg, avg, progress: Math.min(100, (elapsed / seconds) * 100), dl, dlBytes, ulBytes })
  }, 250)
  await Promise.all(ulWorkers)
  clearInterval(ulTimer)
  const ul = (ulBytes * 8) / Math.max(0.001, Math.min(seconds, Math.max(0.1, (performance.now() - ulT0) / 1000 - 1.5))) / 1e6
  if (signal.aborted) {
    onProgress({ phase: 'stopped', cur: 0, avg: 0, progress: 0, dl, ul, dlBytes, ulBytes })
    return { dl, ul, dlBytes, ulBytes }
  }
  onProgress({ phase: 'done', cur: 0, avg: ul, progress: 100, dl, ul, dlBytes, ulBytes })
  return { dl, ul, dlBytes, ulBytes }
}

/** 格式化 Mbps */
export const mbps = (v?: number | null) => (typeof v === 'number' && isFinite(v) ? v.toFixed(v >= 100 ? 0 : 1) : '--')
