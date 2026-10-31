<script setup lang="ts">
/**
 * 网络测速 —— 与 NUI 插件「网络测速」页（/nui/#/network/speedtest）四个 tab 功能一致：
 *   外网测速 / 网页性能 / 视频测速 / 局域网测速
 * 后端全部走面板内置的 NUI 运行时（speed.*），不依赖外部插件。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton,
  NIcon,
  NPopconfirm,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  DownloadOutline,
  PlayOutline,
  RefreshOutline,
  StopOutline,
  TimerOutline,
  TrashOutline,
  CloudUploadOutline,
} from '@vicons/ionicons5'
import PageState from '@/components/PageState.vue'
import Sparkline from '@/components/Sparkline.vue'
import GaugeArc from '@/components/GaugeArc.vue'
import { BUILD_VERSION } from '@/version'
import { shortError } from '@/composables/useAsync'
import { fmtBytes } from '@/utils/format'
import { api } from '@/api'
import { mbps, runLanCgiTest, speedApi, type CnNodes, type ExpState, type SpeedHist, type SpeedServers, type VideoResult, type VideoItem, type WanState, type WebResult } from '@/api/speed'

type Tab = 'wan' | 'web' | 'video' | 'lan'
const TABS: { key: Tab; label: string }[] = [
  { key: 'wan', label: '外网测速' },
  { key: 'web', label: '网页性能' },
  { key: 'video', label: '视频测速' },
  { key: 'lan', label: '局域网测速' },
]

const route = useRoute()
const router = useRouter()
const message = useMessage()
const isHttps = location.protocol === 'https:'

/** 把数值平滑地趋向目标值（rAF），仪表盘/数字就不会一跳一跳 */
function useSmooth(get: () => number, ease = 0.16) {
  const v = ref(0)
  let raf = 0
  const tick = () => {
    const t = Number(get()) || 0
    v.value += (t - v.value) * ease
    if (Math.abs(t - v.value) < 0.05) v.value = t
    raf = requestAnimationFrame(tick)
  }
  onMounted(() => {
    raf = requestAnimationFrame(tick)
  })
  onBeforeUnmount(() => cancelAnimationFrame(raf))
  return v
}

function niceMax(v: number) {
  const steps = [10, 20, 50, 100, 150, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000]
  const need = Math.max(1, Number(v) || 0) * 1.2
  return steps.find((s) => s >= need) ?? Math.ceil(need / 1000) * 1000
}

const tabSlide = ref<'left' | 'right'>('left')
function switchTab(k: Tab) {
  if (k === tab.value) return
  const a = TABS.findIndex((x) => x.key === tab.value)
  const b = TABS.findIndex((x) => x.key === k)
  tabSlide.value = b >= a ? 'left' : 'right'
  tab.value = k
}
const tab = ref<Tab>((['wan', 'web', 'video', 'lan'] as string[]).includes(String(route.query.tab)) ? (String(route.query.tab) as Tab) : 'wan')
watch(() => route.query.tab, (q) => {
  const v = String(q || '')
  if ((['wan', 'web', 'video', 'lan'] as string[]).includes(v) && v !== tab.value) tab.value = v as Tab
})
watch(tab, (t) => {
  void router.replace({ query: { ...route.query, tab: t } })
  if (t === 'web') void ensureWeb()
  if (t === 'video') void ensureVideo()
})

/* ============================ 外网测速 ============================ */
const srv = ref<SpeedServers | null>(null)
const cn = ref<CnNodes | null>(null)
const probe = ref<Record<string, number>>({})
const wanLoading = ref(true)
const wanError = ref('')
const serverSel = ref<string>('auto')
const duration = ref(10)
const conn = ref(4)
const cap = ref(300)
const wanState = ref<WanState>({})
const wanRunning = ref(false)
/** 左侧仪表盘的实时采样序列（像 NUI 一样画实时曲线） */
const wanDlSeries = ref<number[]>([])
const wanUlSeries = ref<number[]>([])
/** 仪表盘平滑显示的目标值：测试中是实时速率，完成后定格为最终下载 */
const wanLiveTarget = computed(() => {
  const s = wanState.value
  if (s.phase === 'dl' || s.phase === 'ul') return Number(s.avg || s.cur || 0)
  if (s.phase === 'done') return Number(s.dl || 0)
  return 0
})
const wanDisplay = useSmooth(() => wanLiveTarget.value, 0.08)
/** 量程在单次测速过程中固定，只在开始/结束按结果调整，避免实时值带着量程一起跳 */
const wanMax = ref(1500)
const hist = ref<SpeedHist[]>([])
let wanTimer: number | undefined

const serverOptions = computed(() => {
  const loc = cn.value?.loc ?? {}
  const province = String(loc.province || '')
  const city = String(loc.city || '')
  const op = String(loc.operator || '')
  const out: any[] = [{ label: '自动优选（全球网测，同城同运营商优先）', value: 'auto' }]
  // 全球网测节点按省分组，本省排最前，本省节点按「同运营商/同城」优先排序（与官方匹配算法一致）
  const groups = new Map<string, { host: string; name: string; city: string; op: string }[]>()
  for (const n of cn.value?.nodes ?? []) {
    const p = n[2] || '其他'
    if (!groups.has(p)) groups.set(p, [])
    groups.get(p)!.push({ host: n[0], name: n[1], city: n[3], op: n[4] })
  }
  const score = (x: { city: string; op: string }) => (x.op === op ? 2 : 0) + (x.city === city ? 1 : 0)
  const provs = [...groups.keys()]
  if (province && groups.has(province)) {
    provs.splice(provs.indexOf(province), 1)
    provs.unshift(province)
  }
  for (const p of provs) {
    const list = [...(groups.get(p) ?? [])]
    if (p === province) list.sort((a, b) => score(b) - score(a))
    out.push({
      type: 'group',
      label: p === province ? `${p}（本省）` : p,
      key: `p:${p}`,
      children: list.map((x) => ({
        label: x.name + (x.city && !x.name.includes(x.city) ? ` · ${x.city}` : ''),
        value: `cn:${x.host}`,
      })),
    })
  }
  // 备用 speedtest 节点：按探测到的建连时延排序，不可达的置灰
  const lat = probe.value || {}
  const probed = Object.keys(lat).length > 0
  const oo: any[] = [{ label: '备用节点（自动选择）', value: 'ookla:auto' }]
  const servers = [...(srv.value?.servers ?? [])].sort(
    (a, b) => (lat[String(a.idx)] ?? 1e9) - (lat[String(b.idx)] ?? 1e9),
  )
  for (const s of servers) {
    const t = lat[String(s.idx)]
    oo.push({
      label: s.name + (probed ? (t == null ? ' · 不可达' : ` · ${t} ms`) : ''),
      value: `ookla:${s.idx}`,
      disabled: probed && t == null,
    })
  }
  out.push({ type: 'group', label: '备用：speedtest 节点', key: 'ookla', children: oo })
  return out
})
const cnLocText = computed(() => {
  const loc = cn.value?.loc
  if (!loc) return ''
  return [loc.province, loc.city, loc.operator].filter(Boolean).join(' · ')
})
const wanPhase = computed(() => {
  const p = String(wanState.value.phase || '')
  if (p === 'select') return wanState.value.trying ? `正在匹配节点：${wanState.value.trying}` : '正在选择测速服务器'
  const map: Record<string, string> = {
    starting: '准备中', select: '正在选择测速服务器', ping: '正在测量延迟', dl: '下载测速中',
    ul: '上传测速中', done: '测速完成', stopped: '已停止', error: '测速失败',
  }
  return map[p] ?? (p ? p : '等待开始')
})

const fallbackText = computed(() => {
  const f = String(wanState.value.fallback || '')
  if (!f) return ''
  const map: Record<string, string> = {
    dl_failed: '全球网测下载没有数据', timeout: '全球网测节点没有响应', busy: '全球网测节点都在排队',
    no_node: '全球网测没有可用节点', unreachable: '全球网测节点都连不上',
  }
  return `已自动改用备用 speedtest 节点（${map[f] || f}）`
})

async function onServerShow(show: boolean) {
  if (show && !Object.keys(probe.value).length) {
    try {
      const p = await speedApi.probe(false)
      probe.value = p.latency ?? {}
    } catch {
      /* ignore */
    }
  }
}
async function loadWan(force = false) {
  // 已有数据时静默刷新（测速完成刷新历史记录时不要整页 loading，否则页面会闪）
  if (!srv.value) wanLoading.value = true
  wanError.value = ''
  try {
    const [s, n] = await Promise.all([speedApi.servers(), speedApi.cnNodes(force).catch(() => null as CnNodes | null)])
    srv.value = s
    cn.value = n
    hist.value = s.history ?? []
    if (s.client) {
      lanClient.value = s.client
      void loadLanClientDetail()
    } else {
      void loadLanClientIp()
    }
    void speedApi.probe(force).then((p) => (probe.value = p.latency ?? {})).catch(() => {})
  } catch (e) {
    wanError.value = shortError(e)
  } finally {
    wanLoading.value = false
  }
}
function stopWanPoll() {
  if (wanTimer) {
    clearInterval(wanTimer)
    wanTimer = undefined
  }
}
async function wanPoll() {
  try {
    const st = await speedApi.poll()
    wanState.value = st
    wanRunning.value = !!st.running
    // 实时曲线：下载/上传阶段把当前速率采样下来
    if (st.running && (st.phase === 'dl' || st.phase === 'ul')) {
      const v = Number(st.avg || st.cur || 0)
      if (v > 0.5) {
        if (st.phase === 'dl') wanDlSeries.value = [...wanDlSeries.value.slice(-200), v]
        else wanUlSeries.value = [...wanUlSeries.value.slice(-200), v]
      }
    }
    if (!st.running && st.phase === 'done') {
      wanMax.value = niceMax(Math.max(Number(st.dl || 0), Number(st.ul || 0), 10) * 1.15)
      stopWanPoll()
      void loadWan(true)
    } else if (!st.running && (st.phase === 'error' || st.phase === 'stopped')) {
      stopWanPoll()
    }
  } catch (e) {
    wanState.value = { ...wanState.value, phase: 'error', error: shortError(e) }
    stopWanPoll()
  }
}
async function startWan() {
  try {
    await speedApi.start({ server: serverSel.value, duration: duration.value, conn: conn.value, cap: cap.value })
    const prev = Math.max(Number(wanState.value.dl || 0), Number(wanState.value.ul || 0))
    if (prev > 0) wanMax.value = niceMax(prev * 1.25)
    wanDlSeries.value = []
    wanUlSeries.value = []
    wanState.value = { phase: 'starting' }
    wanRunning.value = true
    stopWanPoll()
    wanTimer = window.setInterval(wanPoll, 350)
    void wanPoll()
  } catch (e) {
    message.error(shortError(e))
  }
}
async function stopWan() {
  await speedApi.stop().catch(() => {})
  void wanPoll()
}
async function clearHistory() {
  await speedApi.clearHistory().catch(() => {})
  hist.value = []
  message.success('已清空测速记录')
}
const fmtTime = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '—')

/* ============================ 网页性能 ============================ */
const webItems = ref<{ id: string; name: string; catg?: string; url: string }[]>([])
const webCats = ref<string[]>([])
const webPicked = ref<Set<string>>(new Set())
const webState = ref<ExpState<WebResult> | null>(null)
const webBusy = ref(false)
let webTimer: number | undefined
let webStartAt = 0
let webLoaded = false

async function ensureWeb() {
  if (webLoaded) return
  webBusy.value = true
  try {
    const r = await speedApi.expItems()
    webItems.value = r.web ?? []
    webCats.value = [...new Set(webItems.value.map((x) => x.catg || '其他'))]
    webPicked.value = new Set(webCats.value)
    webLoaded = true
    webState.value = await speedApi.expPoll<WebResult>('web')
  } catch (e) {
    message.error(shortError(e))
  } finally {
    webBusy.value = false
  }
}
function stopWebPoll() {
  if (webTimer) {
    clearInterval(webTimer)
    webTimer = undefined
  }
}
async function webPoll() {
  try {
    const st = await speedApi.expPoll<WebResult>('web')
    webState.value = st
    const terminal = ['done', 'error', 'stopped'].includes(String(st.phase))
    // 刚启动的前几秒进程可能还没写 pid，不能一看到 running=false 就停轮询
    if (!st.running && (terminal || Date.now() - webStartAt > 12000)) stopWebPoll()
  } catch {
    stopWebPoll()
  }
}
const webIds = computed(() => webItems.value.filter((x) => webPicked.value.has(x.catg || '其他')).map((x) => x.id))
const webRes = computed(() => (webState.value?.results ?? []).map((r) => ({
  ...r,
  speed: r.ok && r.total ? Math.round((r.size ?? 0) / (r.total / 1000) / 1024) : undefined,
})))
const webRows = computed<WebResult[]>(() => {
  const res = webRes.value
  if (res.length) return res
  return webItems.value.map((it) => ({ ...it, status: 'waiting' as const }))
})
const webSummary = computed(() => {
  const ok = webRes.value.filter((r) => r.ok)
  const avg = (k: 'total' | 'ttfb') => (ok.length ? Math.round(ok.reduce((a, r) => a + (r[k] ?? 0), 0) / ok.length) : null)
  return { ok: ok.length, total: webRes.value.length, open: avg('total'), ttfb: avg('ttfb') }
})
async function startWeb() {
  if (!webIds.value.length) return message.warning('至少选一个分类')
  try {
    webBusy.value = true
    await speedApi.expStartWeb(webIds.value.length === webItems.value.length ? [] : webIds.value)
    webStartAt = Date.now()
    webState.value = { kind: 'web', phase: 'starting', results: [] }
    stopWebPoll()
    webTimer = window.setInterval(webPoll, 700)
    void webPoll()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    webBusy.value = false
  }
}
async function stopWeb() {
  await speedApi.expStop('web').catch(() => {})
  void webPoll()
}
const webCell = (r: WebResult) => {
  if (r.status === 'waiting') return '等待'
  if (r.status === 'testing') return '测试中'
  if (!r.ok) return r.error || '失败'
  return `${r.total ?? '—'} ms`
}
const wfWidth = (ms?: number, base?: number) => (ms && base ? Math.max(1, Math.round((ms / Math.max(base, 1)) * 100)) : 0)

/* ============================ 视频测速 ============================ */
const videoItems = ref<VideoItem[]>([])
const videoState = ref<ExpState<VideoResult> | null>(null)
const videoBusy = ref(false)
const vDuration = ref(5)
const vThreads = ref(4)
const vCap = ref(40)
let videoTimer: number | undefined
let videoStartAt = 0
let videoLoaded = false

async function ensureVideo() {
  if (videoLoaded) return
  videoBusy.value = true
  try {
    const r = await speedApi.expItems()
    videoItems.value = r.video ?? []
    videoLoaded = true
    videoState.value = await speedApi.expPoll<VideoResult>('video')
  } catch (e) {
    message.error(shortError(e))
  } finally {
    videoBusy.value = false
  }
}
function stopVideoPoll() {
  if (videoTimer) {
    clearInterval(videoTimer)
    videoTimer = undefined
  }
}
async function videoPoll() {
  try {
    const st = await speedApi.expPoll<VideoResult>('video')
    videoState.value = st
    const terminal = ['done', 'error', 'stopped'].includes(String(st.phase))
    if (!st.running && (terminal || Date.now() - videoStartAt > 12000)) stopVideoPoll()
  } catch {
    stopVideoPoll()
  }
}
async function startVideo() {
  try {
    videoBusy.value = true
    await speedApi.expStartVideo({ duration: vDuration.value, conn: vThreads.value, cap: vCap.value })
    videoStartAt = Date.now()
    videoState.value = { kind: 'video', phase: 'starting', results: [] }
    stopVideoPoll()
    videoTimer = window.setInterval(videoPoll, 700)
    void videoPoll()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    videoBusy.value = false
  }
}
async function stopVideo() {
  await speedApi.expStop('video').catch(() => {})
  void videoPoll()
}
const videoRes = computed(() => videoState.value?.results ?? [])
const videoCards = computed<VideoResult[]>(() => {
  const res = videoRes.value
  if (res.length) return res
  return videoItems.value.map((it) => ({ ...it, status: 'waiting' as const }))
})
const videoVerdict = (r: VideoResult) => {
  if (!r.ok || !r.speed) return { text: r.status === 'testing' ? '测速中…' : r.error || '等待', type: 'default' as const }
  const need = (r.bitrate ?? 0) / 1e6
  if (r.speed >= need * 1.2) return { text: '流畅', type: 'success' as const }
  if (r.speed >= need * 0.9) return { text: '基本流畅', type: 'warning' as const }
  return { text: '可能卡顿', type: 'error' as const }
}

/* ============================ 局域网测速 ============================ */
const lanSecs = ref(10)
const lanThreads = ref(4)
const lanBusy = ref(false)
const lanRunning = ref(false)
const lanSeq = ref(0)
const lanLastCur = ref(0)
/** 局域网测速的下载/上传实时曲线（像 NUI 一样画双线面积图） */
const lanDlSeries = ref<number[]>([])
const lanUlSeries = ref<number[]>([])
const lanLiveTarget = computed(() => {
  const s = lanState.value
  if (s.phase === 'dl' || s.phase === 'ul') return Number(s.cur || lanLastCur.value || 0)
  if (s.phase === 'done') return Number(s.dl || 0)
  return 0
})
const lanDisplay = useSmooth(() => lanLiveTarget.value, 0.08)
const lanMax = ref(2500)
const lanState = ref<{ phase: string; dl?: number; ul?: number; cur: number; progress: number; dlBytes?: number; ulBytes?: number; error?: string }>({ phase: 'idle', cur: 0, progress: 0 })
const lanClient = ref('')
interface LanClientDetail { ip: string; text: string; wired: boolean }
const lanClientDetail = ref<LanClientDetail | null>(null)
const lanClientBusy = ref(false)
async function loadLanClientIp() {
  try {
    const r = await fetch('/glass/clientinfo', { cache: 'no-store' })
    if (!r.ok) return
    const j = await r.json()
    if (j?.ip) {
      lanClient.value = String(j.ip)
      await loadLanClientDetail()
    }
  } catch {
    /* 同源接口不可用时保持原值 */
  }
}
async function loadLanClientDetail() {
  const ip = lanClient.value
  if (!ip) return
  lanClientBusy.value = true
  try {
    const r = await api.call<{ clients?: Record<string, unknown>[] }>('clients', 'get_list')
    const c = (r.clients ?? []).find((x) => String(x.ipaddr ?? x.ip ?? '') === ip)
    if (!c) {
      lanClientDetail.value = { ip, text: '', wired: false }
      return
    }
    const rawType = String(c.type ?? c.iface ?? '')
    const iface = String(c.iface ?? '')
    const wireless = Number(c.type) === 1 || /wireless|wifi|5g|2g/i.test(iface + rawType)
    const mac = String(c.mac ?? '')
    let link: { ok?: boolean; wired?: boolean; band?: string; ssid?: string; signal?: number; txrate?: number; rxrate?: number; linkspeed?: number } | null = null
    if (mac) {
      try { link = await api.call('glass', 'client_link', { mac }) } catch { link = null }
    }
    if (link?.ok && link.wired === false) {
      const parts = [`${link.band || 'Wi-Fi'} Wi-Fi`]
      if (link.ssid) parts.push(link.ssid)
      if (link.signal !== undefined && link.signal !== null) parts.push(`信号 ${link.signal} dBm`)
      if (link.txrate) parts.push(`协商速率 ${Math.round(link.txrate)}/${Math.round(link.rxrate || 0)} Mbps`)
      lanClientDetail.value = { ip, text: parts.join(' · '), wired: false }
    } else if (wireless) {
      // 无线终端即使后端没匹配到关联信息，也不能误显示成“有线连接”
      const bandText = /5g/i.test(iface) ? '5G Wi-Fi' : /2g/i.test(iface) ? '2.4G Wi-Fi' : 'Wi-Fi'
      const parts = [bandText]
      if (c.ssid) parts.push(String(c.ssid))
      if (c.rssi !== undefined && c.rssi !== null && c.rssi !== '') parts.push(`信号 ${c.rssi} dBm`)
      lanClientDetail.value = { ip, text: parts.join(' · '), wired: false }
    } else if (link?.ok && link.wired) {
      lanClientDetail.value = { ip, text: link.linkspeed ? `有线连接 · 网口 ${link.linkspeed} Mbps` : '有线连接', wired: true }
    } else {
      lanClientDetail.value = { ip, text: '有线连接', wired: true }
    }
  } catch {
    lanClientDetail.value = { ip, text: '', wired: false }
  } finally {
    lanClientBusy.value = false
  }
}
let lanCgiAbort: AbortController | null = null
let lanPopup: Window | null = null
let lanIframe: HTMLIFrameElement | null = null
let lanMsgListener: ((ev: MessageEvent) => void) | null = null
let lanWatchdog: number | undefined
let lanReadyAt = 0

/* ---- 局域网测速：与 NUI 1.2.0-16 同样的三条通道 ----
 *  HTTPS 页面 → 弹窗 http://<路由器>:8098（speed.html，postMessage 回传）
 *  HTTP 页面  → 隐藏 iframe（1px，随机端口，不受弹窗拦截）
 *  小服务不可用/超时 → 同源 CGI 兜底（/cgi-bin/nui-speed?dl/ul + 一次性凭据），保证有数据
 */
function cleanupLanTransport() {
  if (lanWatchdog) {
    clearInterval(lanWatchdog)
    lanWatchdog = undefined
  }
  if (lanMsgListener) {
    window.removeEventListener('message', lanMsgListener)
    lanMsgListener = null
  }
  if (lanPopup && !lanPopup.closed) {
    try {
      lanPopup.close()
    } catch {
      /* ignore */
    }
  }
  lanPopup = null
  if (lanIframe) {
    try {
      lanIframe.remove()
    } catch {
      /* ignore */
    }
    lanIframe = null
  }
}

function pushLanSeries(phase: string, live: number) {
  if (live <= 0.5) return
  if (phase === 'dl') lanDlSeries.value = [...lanDlSeries.value.slice(-200), live]
  else if (phase === 'ul') lanUlSeries.value = [...lanUlSeries.value.slice(-200), live]
}

function lanHandleMessage(seq: number, d: any) {
  if (seq !== lanSeq.value || !d) return
  // 任何一条消息都刷新活跃时间（与 NUI 的 ar 相同），用于判断小服务是否卡死
  lanReadyAt = performance.now()
  if (d.type === 'ready') {
    lanState.value = { ...lanState.value, phase: 'dl' }
  } else if (d.type === 'progress') {
    const cur = Number(d.cur) || 0
    if (cur > 0) lanLastCur.value = cur
    const live = cur || lanLastCur.value
    pushLanSeries(String(d.phase || ''), live)
    lanState.value = { ...lanState.value, phase: d.phase, cur: live, progress: d.progress || 0 }
  } else if (d.type === 'phase') {
    if (d.phase === 'dl') lanState.value = { ...lanState.value, dl: d.avg, dlBytes: d.bytes, cur: 0, progress: 0 }
    else lanState.value = { ...lanState.value, ul: d.avg, ulBytes: d.bytes, cur: 0, progress: 0 }
  } else if (d.type === 'done') {
    lanMax.value = niceMax(Math.max(Number(d.dl || 0), Number(d.ul || 0), 10) * 1.15)
    lanState.value = { phase: 'done', dl: d.dl, ul: d.ul, cur: 0, progress: 100, dlBytes: d.dlBytes, ulBytes: d.ulBytes }
    lanRunning.value = false
    cleanupLanTransport()
  } else if (d.type === 'stopped') {
    lanState.value = { ...lanState.value, phase: 'stopped', cur: 0, progress: 0 }
    lanRunning.value = false
    cleanupLanTransport()
  } else if (d.type === 'error') {
    lanState.value = { phase: 'error', cur: 0, progress: 0, error: String(d.error || '测速失败') }
    lanRunning.value = false
    cleanupLanTransport()
  }
}

async function lanCgiFallback(seq: number, reason?: string) {
  cleanupLanTransport()
  if (reason) message.warning(reason)
  lanCgiAbort = new AbortController()
  lanLastCur.value = 0
  lanDlSeries.value = []
  lanUlSeries.value = []
  lanState.value = { phase: 'dl', cur: 0, progress: 0 }
  try {
    const ticket = (await speedApi.lanTicket()).ticket
    if (seq !== lanSeq.value) return
    const r = await runLanCgiTest({
      ticket,
      seconds: lanSecs.value,
      threads: lanThreads.value,
      signal: lanCgiAbort.signal,
      onProgress: (p) => {
        if (seq !== lanSeq.value) return
        const cur = Number(p.cur) || 0
        if (cur > 0) lanLastCur.value = cur
        const live = cur || lanLastCur.value
        pushLanSeries(p.phase, live)
        lanState.value = { phase: p.phase, dl: p.dl, ul: p.ul, cur: live, progress: p.progress, dlBytes: p.dlBytes, ulBytes: p.ulBytes }
      },
    })
    if (seq !== lanSeq.value) return
    lanMax.value = niceMax(Math.max(Number(r.dl || 0), Number(r.ul || 0), 10) * 1.15)
    lanState.value = { phase: 'done', dl: r.dl, ul: r.ul, cur: 0, progress: 100, dlBytes: r.dlBytes, ulBytes: r.ulBytes }
  } catch (e) {
    if (seq === lanSeq.value) lanState.value = { phase: 'error', cur: 0, progress: 0, error: shortError(e) }
  } finally {
    if (seq === lanSeq.value) lanRunning.value = false
    lanBusy.value = false
  }
}

async function startLan() {
  if (lanRunning.value || lanBusy.value) return
  const seq = ++lanSeq.value
  cleanupLanTransport()
  lanBusy.value = true
  const prevLan = Math.max(Number(lanState.value.dl || 0), Number(lanState.value.ul || 0))
  if (prevLan > 0) lanMax.value = niceMax(prevLan * 1.25)
  lanLastCur.value = 0
  lanDlSeries.value = []
  lanUlSeries.value = []
  lanState.value = { phase: 'starting', cur: 0, progress: 0 }
  const isHttpsPage = location.protocol === 'https:'
  let popup: Window | null = null
  // HTTPS 页面必须在点击的同一拍先开好弹窗（异步后会被当成广告拦截）
  if (isHttpsPage) {
    popup = window.open('', 'nui-lan-speed', 'popup,width=440,height=520')
    if (!popup) {
      lanState.value = { phase: 'error', cur: 0, progress: 0, error: '浏览器拦截了测速小窗口，请允许本站弹出窗口后重试' }
      lanRunning.value = false
      lanBusy.value = false
      return
    }
    lanPopup = popup
  }
  lanRunning.value = true
  try {
    const t = await speedApi.lanHttp()
    if (seq !== lanSeq.value) return
    if (!t.port) throw new Error('测速小服务没有响应，请重试')
    lanClient.value = srv.value?.client ?? ''
    const host = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname
    const origin = `http://${host}:${t.port}`
    const url = `${origin}/?${new URLSearchParams({
      t: t.ticket,
      d: String(lanSecs.value),
      n: String(lanThreads.value),
      l: 'zh-CN',
      o: location.origin,
    })}`
    lanMsgListener = (ev: MessageEvent) => {
      if (ev.origin !== origin) return
      const d = ev.data
      if (!d || d.src !== 'nui-lan') return
      lanHandleMessage(seq, d)
    }
    window.addEventListener('message', lanMsgListener)
    lanReadyAt = 0
    const t0 = performance.now()
    lanWatchdog = window.setInterval(() => {
      if (seq !== lanSeq.value) {
        cleanupLanTransport()
        return
      }
      const closed = popup ? popup.closed : false
      // 8 秒还没收到 ready：小服务没起来/被拦，改同源 CGI 兜底
      if (!lanReadyAt && !closed) {
        if (performance.now() - t0 < 8000) return
        void lanCgiFallback(seq, '测速小服务没有回应，改为本页直接测速')
        return
      }
      // 超过 15 秒没有任何消息视为卡死（测速过程中每 0.5 秒都有 progress）
      if (!closed && lanReadyAt && performance.now() - lanReadyAt > 15000) {
        if (lanState.value.phase === 'done' || lanState.value.phase === 'error' || lanState.value.phase === 'stopped') return
        cleanupLanTransport()
        lanState.value = { phase: 'error', cur: 0, progress: 0, error: '测速小服务没有响应，请重试' }
        lanRunning.value = false
      }
    }, 800)
    if (popup) {
      popup.location.href = url
    } else {
      lanIframe = document.createElement('iframe')
      lanIframe.src = url
      lanIframe.title = 'LAN speed test'
      lanIframe.tabIndex = -1
      lanIframe.setAttribute('aria-hidden', 'true')
      lanIframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
      document.body.appendChild(lanIframe)
    }
  } catch (e) {
    if (seq !== lanSeq.value) return
    void lanCgiFallback(seq, 'HTTP 测速小服务不可用，改为本页直接测速')
  } finally {
    lanBusy.value = false
  }
}

function stopLan() {
  lanSeq.value++
  if (lanCgiAbort) {
    lanCgiAbort.abort()
    lanCgiAbort = null
  }
  if (lanPopup) {
    try {
      lanPopup.postMessage({ cmd: 'stop' }, '*')
    } catch {
      /* ignore */
    }
  }
  cleanupLanTransport()
  lanRunning.value = false
  lanState.value = { ...lanState.value, phase: 'stopped', cur: 0, progress: 0 }
}

/* ============================ 生命周期 ============================ */
onMounted(() => {
  void loadWan()
  if (tab.value === 'web') void ensureWeb()
  if (tab.value === 'video') void ensureVideo()
})
onBeforeUnmount(() => {
  stopWanPoll()
  stopWebPoll()
  stopVideoPoll()
  if (lanCgiAbort) lanCgiAbort.abort()
  stopLan()
})
</script>

<template>
  <div class="speed-page">
    <!-- 页头 tabs -->
    <div class="sp-card sp-tabs-card">
      <div class="sp-tabs">
        <button v-for="t in TABS" :key="t.key" class="sp-tab" :class="{ active: tab === t.key }" @click="switchTab(t.key)">
          {{ t.label }}
        </button>
        <span class="sp-ver">v{{ BUILD_VERSION }}</span>
      </div>

      <div :key="tab" class="sp-tab-body" :class="`slide-${tabSlide}`">
      <!-- ======================= 外网测速 ======================= -->
      <PageState v-if="tab === 'wan'" :loading="wanLoading" :error="wanError" @retry="loadWan">
        <div class="pane">
          <div class="sp-alert">
            由路由器直接向测速节点发起，结果是路由器自身的上网速度，不受终端 Wi-Fi 影响。会消耗 SIM 卡流量：下载最多约 {{ cap }} MB、
            上传最多约 {{ Math.floor(cap / 3) }} MB；测速期间其它设备的上网流量可能会计入结果。
            测速节点用全球网测（泰尔测速）的全国各省三大运营商节点，列表实时获取。“自动优选”与全球网测 App 一致：按出口 IP 归属和 SIM 卡运营商，
            依次在同城同运营商、同省同运营商、同运营商、同城、同省的节点里找，取最先找到的一档（多于 10 个随机抽 10 个），测 TCP 建连时延选最快的。
            节点繁忙会换下一个。全球网测不可用时自动改用备用的 speedtest 节点。
          </div>

          <div class="opts">
            <label class="opt wide">
              <span>测速节点</span>
              <n-select v-model:value="serverSel" size="small" :options="serverOptions" filterable @update:show="onServerShow" />
            </label>
            <label class="opt">
              <span>&nbsp;</span>
              <n-button size="small" secondary :loading="wanLoading" @click="loadWan(true)">
                <template #icon><n-icon><RefreshOutline /></n-icon></template>刷新节点
              </n-button>
            </label>
            <label class="opt">
              <span>每项时长</span>
              <n-select v-model:value="duration" size="small" :options="[5, 10, 15, 20, 30].map((v) => ({ label: `${v} 秒`, value: v }))" />
            </label>
            <label class="opt">
              <span>并发线程</span>
              <n-select v-model:value="conn" size="small" :options="[1, 2, 4, 8, 16].map((v) => ({ label: `${v} 线程`, value: v }))" />
            </label>
            <label class="opt">
              <span>下载流量上限</span>
              <n-select v-model:value="cap" size="small" :options="[100, 300, 500, 1000, 2000].map((v) => ({ label: `${v} MB`, value: v }))" />
            </label>
          </div>
          <div class="loc small">
            <span v-if="srv?.client">本机：{{ srv?.client }}</span>
            <span v-if="cnLocText">本机归属：{{ cnLocText }}</span>
            <span v-if="cn?.nodes?.length">全球网测节点 {{ cn.nodes.length }} 个</span>
            <span v-if="cn?.error" class="warn">{{ cn.error }}</span>
          </div>
          <div v-if="fallbackText" class="fb-tip">{{ fallbackText }}</div>

          <div class="stage wan">
            <div class="gauge-wrap">
              <GaugeArc
                :value="wanDisplay"
                :max="wanMax"
                :label="wanState.phase === 'ul' ? '上传' : '下载'"
                unit="Mbps"
                :color="wanState.phase === 'ul' ? '#22c55e' : '#f472b6'"
                :size="190"
              />
              <span class="g-pill">{{ wanPhase }}</span>
              <div class="actions" style="margin-top: 8px">
                <n-button v-if="!wanRunning" type="primary" class="go" @click="startWan">
                  <template #icon><n-icon><PlayOutline /></n-icon></template>
                  {{ wanState.phase === 'done' || wanState.phase === 'stopped' || wanState.phase === 'error' ? '重新测速' : '开始测速' }}
                </n-button>
                <n-button v-else type="error" class="go" @click="stopWan">
                  <template #icon><n-icon><StopOutline /></n-icon></template>停止
                </n-button>
              </div>
              <span v-if="wanState.error" class="warn small">{{ wanState.error }}</span>
            </div>

            <div class="chart-col">
              <div class="legend" style="margin-bottom: 2px">
                <span class="lg"><i style="background: #f472b6" />下载</span>
                <span class="lg"><i style="background: #22c55e" />上传</span>
              </div>
              <Sparkline
                :series="[wanDlSeries, wanUlSeries]"
                :colors="['#f472b6', '#22c55e']"
                :height="140"
                :capacity="duration * 3 + 20"
              />
              <div class="axis-row"><span>0s</span><span>{{ duration }}s</span></div>
              <div class="meta">
                <span v-if="wanState.server">{{ wanState.server }}</span>
                <span v-if="wanState.area">{{ wanState.area }}</span>
                <span v-if="wanState.engine">{{ wanState.engine === 'cn' ? '全球网测' : '备用节点' }}</span>
                <span v-if="wanRunning && (wanState.cur || wanState.avg)">实时 {{ mbps(wanState.cur || wanState.avg) }} Mbps</span>
              </div>
            </div>

            <div class="side">
              <div class="tiles">
                <div class="tile"><div class="t-label">延迟</div><div class="t-val">{{ wanState.ping ?? '--' }}<span class="t-unit">ms</span></div></div>
                <div class="tile"><div class="t-label">抖动</div><div class="t-val">{{ wanState.jitter ?? '--' }}<span class="t-unit">ms</span></div></div>
                <div class="tile"><div class="t-label">下载</div><div class="t-val">{{ wanState.dl ? mbps(wanState.dl) : '--' }}<span class="t-unit">Mbps</span></div></div>
                <div class="tile"><div class="t-label">上传</div><div class="t-val">{{ wanState.ul ? mbps(wanState.ul) : '--' }}<span class="t-unit">Mbps</span></div></div>
              </div>
              <div class="prog-row">
                <span class="small">0s</span>
                <div class="prog"><i :style="{ width: `${wanState.progress ?? 0}%` }" /></div>
                <span class="small">{{ duration }}s</span>
              </div>
            </div>
          </div>
        </div>
      </PageState>

      <!-- ======================= 网页性能 ======================= -->
      <div v-else-if="tab === 'web'" class="pane">
        <div class="sp-alert">
          由路由器依次打开全球网测清单里的常用网站首页（3 路并发），记录 DNS 解析、建连、TLS 握手、等待首字节和下载各阶段的耗时；只取首页 HTML，不含图片等资源，消耗流量很少。
        </div>
        <div class="cats-row">
          <span class="small muted">分类</span>
          <button
            v-for="c in webCats" :key="c" class="cat-chip" :class="{ on: webPicked.has(c) }"
            @click="webPicked.has(c) ? webPicked.delete(c) : webPicked.add(c)"
          >
            {{ c }}
          </button>
        </div>
        <div class="cats-row">
          <span class="small muted">共 {{ webIds.length }} 个网站，点“开始测试”</span>
          <div class="grow" />
          <n-button v-if="!webState?.running" type="primary" size="small" :loading="webBusy" @click="startWeb">
            <template #icon><n-icon><PlayOutline /></n-icon></template>开始测试
          </n-button>
          <n-button v-else type="error" size="small" @click="stopWeb">
            <template #icon><n-icon><StopOutline /></n-icon></template>停止
          </n-button>
        </div>
        <div class="list">
          <div class="legend">
            <span class="lg"><i style="background:#f472b6" />DNS</span>
            <span class="lg"><i style="background:#a855f7" />建连</span>
            <span class="lg"><i style="background:#f59e0b" />TLS</span>
            <span class="lg"><i style="background:#38bdf8" />首字节</span>
            <span class="lg"><i style="background:#22c55e" />传输</span>
            <span class="grow" />
            <span v-if="webSummary.ok" class="small muted">
              平均打开 {{ webSummary.open }} ms · 平均首字节 {{ webSummary.ttfb }} ms · 成功 {{ webSummary.ok }}/{{ webSummary.total }}
            </span>
          </div>
          <div v-for="r in webRows" :key="r.id" class="row" :class="{ fail: r.status === 'done' && !r.ok }">
            <div class="name">
              <span class="nm">{{ r.name }}</span>
              <span class="catg muted">{{ r.catg || '其他' }}</span>
            </div>
            <div class="wf" v-if="r.ok && r.total">
              <i class="seg" :style="{ width: `${wfWidth(r.dns, r.total)}%`, background: '#f472b6' }" />
              <i class="seg" :style="{ width: `${wfWidth(r.connect, r.total)}%`, background: '#a855f7' }" />
              <i class="seg" :style="{ width: `${wfWidth(r.tls, r.total)}%`, background: '#f59e0b' }" />
              <i class="seg" :style="{ width: `${wfWidth(r.ttfb, r.total)}%`, background: '#38bdf8' }" />
              <i class="seg" :style="{ width: `${wfWidth((r.total ?? 0) - (r.ttfb ?? 0), r.total)}%`, background: '#22c55e' }" />
            </div>
            <div class="wf placeholder" v-else />
            <div class="vals">
              <span class="small" :class="{ warn: r.status === 'done' && !r.ok }">{{ webCell(r) }}</span>
              <span class="small muted">{{ r.ok ? `${r.speed ?? '—'} KB/s · ${fmtBytes(r.size ?? 0)}` : `HTTP ${r.code ?? '—'}` }}</span>
            </div>
          </div>
        </div>
        <div v-if="!webRows.length" class="empty-small">{{ webBusy ? '正在读取清单…' : '暂无网站清单' }}</div>
      </div>

      <!-- ======================= 视频测速 ======================= -->
      <div v-else-if="tab === 'video'" class="pane">
        <div class="sp-alert">
          由路由器解析哔哩哔哩、搜狐、央视网测速视频的真实播放地址，再多线程下载一段时间，看加载速率够不够流畅播放（与该视频的码率比较）。会消耗 SIM 卡流量：每个视频最多 {{ vCap }} MB。
        </div>
        <div class="opts">
          <label class="opt"><span>每个视频时长</span>
            <n-select v-model:value="vDuration" size="small" :options="[3, 5, 8, 10, 15].map((v) => ({ label: `${v} 秒`, value: v }))" />
          </label>
          <label class="opt"><span>并发线程</span>
            <n-select v-model:value="vThreads" size="small" :options="[1, 2, 4, 8].map((v) => ({ label: `${v} 线程`, value: v }))" />
          </label>
          <label class="opt"><span>每个视频流量上限</span>
            <n-select v-model:value="vCap" size="small" :options="[10, 20, 40, 80, 200].map((v) => ({ label: `${v} MB`, value: v }))" />
          </label>
          <label class="opt go">
            <span>&nbsp;</span>
            <n-button v-if="!videoState?.running" type="primary" size="small" :loading="videoBusy" @click="startVideo">
              <template #icon><n-icon><PlayOutline /></n-icon></template>开始测试
            </n-button>
            <n-button v-else type="error" size="small" @click="stopVideo">
              <template #icon><n-icon><StopOutline /></n-icon></template>停止
            </n-button>
          </label>
        </div>
        <div class="v-cards">
          <div v-for="r in videoCards" :key="r.id" class="vcard">
            <div class="v-head">
              <span class="vname">{{ r.name }}</span>
              <n-tag size="tiny" :bordered="false" :type="videoVerdict(r).type">{{ videoVerdict(r).text }}</n-tag>
            </div>
            <div class="big">{{ r.ok ? mbps(r.speed) : '--' }}<span class="t-unit">Mbps</span></div>
            <div class="kv small">
              <span>清晰度</span><b>{{ r.height ? `${r.height}P` : '—' }}</b>
              <span>所需码率</span><b>{{ r.bitrate ? `${(r.bitrate / 1e6).toFixed(1)} Mbps` : '—' }}</b>
              <span>解析耗时</span><b>{{ r.status === 'resolving' ? '解析中…' : '—' }}</b>
              <span>首包时延</span><b>{{ r.ttfb ? `${r.ttfb} ms` : '—' }}</b>
              <span>下载量</span><b>{{ r.bytes ? fmtBytes(r.bytes) : '—' }}</b>
            </div>
            <div v-if="r.status === 'testing' && videoState?.cur" class="small muted">
              实时 {{ mbps(videoState.cur) }} Mbps · {{ videoState.progress ?? 0 }}%
            </div>
            <div v-else-if="r.error" class="small warn">{{ r.error }}</div>
          </div>
        </div>
        <div v-if="!videoCards.length" class="empty-small">{{ videoBusy ? '正在读取清单…' : '暂无视频清单' }}</div>
      </div>

      <!-- ======================= 局域网测速 ======================= -->
      <div v-else class="pane">
        <div class="sp-alert">
          测的是当前这台设备（手机/电脑）与路由器之间的速度，用来判断 Wi-Fi 或网线连接的好坏，不消耗 SIM 卡流量。由路由器上独立的测速小服务处理：
          下载是拉取一个大文件，上传是推送大文件，结果取稳定阶段的速率（去掉开头的爬坡和偶发的掉速）。Wi-Fi 的实际速度一般只有协商速率的五到七成。
        </div>
        <div class="opts">
          <label class="opt"><span>每项时长</span>
            <n-select v-model:value="lanSecs" size="small" :options="[5, 10, 15, 20, 30].map((v) => ({ label: `${v} 秒`, value: v }))" />
          </label>
          <label class="opt"><span>并发线程</span>
            <n-select v-model:value="lanThreads" size="small" :options="[1, 2, 4, 8].map((v) => ({ label: `${v} 线程`, value: v }))" />
          </label>
          <label class="opt wide"><span>本机</span>
            <div class="me-val">
              <b class="me-ip">{{ lanClient || '—' }}</b>
              <span class="small muted">{{ lanClientDetail?.text || (lanClient ? (lanClientBusy ? '正在读取连接方式…' : '浏览器 ↔ 路由器 直连测速') : '当前设备（浏览器所在终端）') }}</span>
            </div>
          </label>
        </div>
        <div class="stage lan">
          <div class="gauge-wrap">
            <GaugeArc
              :value="lanDisplay"
              :max="lanMax"
              :label="lanState.phase === 'ul' ? '上传' : '下载'"
              unit="Mbps"
              :color="lanState.phase === 'ul' ? '#22c55e' : '#f472b6'"
              :size="190"
            />
            <span class="g-pill">
              {{ lanState.phase === 'starting' ? '正在启动测速小服务…' : lanState.phase === 'dl' ? '下载测速中' : lanState.phase === 'ul' ? '上传测速中' : lanState.phase === 'done' ? '测速完成' : lanState.phase === 'stopped' ? '已停止' : lanState.phase === 'error' ? '测速失败' : '等待开始' }}
            </span>
            <div class="actions" style="margin-top: 8px">
              <n-button v-if="!lanRunning" type="primary" class="go" :loading="lanBusy" @click="startLan">
                <template #icon><n-icon><PlayOutline /></n-icon></template>
                {{ lanState.phase === 'done' || lanState.phase === 'stopped' || lanState.phase === 'error' ? '重新测速' : '开始测速' }}
              </n-button>
              <n-button v-else type="error" class="go" @click="stopLan">
                <template #icon><n-icon><StopOutline /></n-icon></template>停止
              </n-button>
            </div>
            <span v-if="lanState.error" class="warn small">{{ lanState.error }}</span>
          </div>
          <div class="chart-col">
            <div class="legend" style="margin-bottom: 2px">
              <span class="lg"><i style="background: #f472b6" />下载</span>
              <span class="lg"><i style="background: #22c55e" />上传</span>
            </div>
            <Sparkline :series="[lanDlSeries, lanUlSeries]" :colors="['#f472b6', '#22c55e']" :height="140" :capacity="lanSecs * 4 + 20" />
            <div class="axis-row"><span>0s</span><span>{{ lanSecs }}s</span></div>
            <div class="meta">
              <span v-if="lanRunning && lanLiveTarget">实时 {{ mbps(lanLiveTarget) }} Mbps</span>
              <span v-if="lanState.dlBytes || lanState.ulBytes">共传输 {{ fmtBytes((lanState.dlBytes ?? 0) + (lanState.ulBytes ?? 0)) }}</span>
            </div>
          </div>
          <div class="side">
            <!-- 右侧：最终结果 + 进度（与外网测速同样的布局） -->
            <div class="tiles two">
              <div class="tile">
                <div class="t-label"><n-icon :size="16" style="opacity:.8"><DownloadOutline /></n-icon>下载（路由器 → 本机）</div>
                <div class="t-val">{{ lanState.dl ? mbps(lanState.dl) : '--' }}<span class="t-unit">Mbps</span></div>
                <div class="t-sub small muted">{{ lanState.dlBytes ? fmtBytes(lanState.dlBytes) : '—' }}</div>
              </div>
              <div class="tile">
                <div class="t-label"><n-icon :size="16" style="opacity:.8"><CloudUploadOutline /></n-icon>上传（本机 → 路由器）</div>
                <div class="t-val">{{ lanState.ul ? mbps(lanState.ul) : '--' }}<span class="t-unit">Mbps</span></div>
                <div class="t-sub small muted">{{ lanState.ulBytes ? fmtBytes(lanState.ulBytes) : '—' }}</div>
              </div>
            </div>
            <div class="prog-row">
              <span class="small">0s</span>
              <div class="prog"><i :style="{ width: `${lanState.progress || 0}%` }" /></div>
              <span class="small">{{ lanSecs }}s</span>
            </div>
            <span v-if="isHttps" class="small muted">HTTPS 下会弹出 HTTP 小窗口测速（需允许弹窗）</span>
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- 测速记录（仅外网 tab 显示，与插件页一致） -->
    <div v-if="tab === 'wan'" class="sp-card hist-card">
      <div class="hist-head">
        <span class="h-title"><n-icon><TimerOutline /></n-icon>测速记录</span>
        <span class="small muted">记录保存在路由器上，最多保留 20 条</span>
        <div class="grow" />
        <n-popconfirm @positive-click="clearHistory">
          <template #trigger>
            <n-button size="tiny" quaternary :disabled="!hist.length">
              <template #icon><n-icon><TrashOutline /></n-icon></template>清空
            </n-button>
          </template>
          确定清空全部测速记录？
        </n-popconfirm>
      </div>
      <div v-if="hist.length" class="hist">
        <div class="h-row h-head">
          <span>时间</span><span>服务器</span><span class="r">延迟</span><span class="r">下载</span><span class="r">上传</span><span class="r">流量</span>
        </div>
        <div v-for="h in hist" :key="h.time" class="h-row">
          <span class="small">{{ fmtTime(h.time) }}</span>
          <span class="small ellipsis">{{ h.server || '—' }}<span v-if="h.area" class="muted"> · {{ h.area }}</span></span>
          <span class="r small">{{ h.ping ?? '—' }} ms</span>
          <span class="r small">{{ mbps(h.dl) }}</span>
          <span class="r small">{{ mbps(h.ul) }}</span>
          <span class="r small muted">{{ fmtBytes((h.dl_bytes ?? 0) + (h.ul_bytes ?? 0)) }}</span>
        </div>
      </div>
      <div v-else class="empty-small">还没有测速记录</div>
    </div>
  </div>
</template>

<style scoped>
.speed-page {
  --sp-accent: #f472b6;
  --sp-purple: #a855f7;
  --sp-tile: rgba(128, 128, 128, 0.09);
  --sp-line: rgba(128, 128, 128, 0.22);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sp-card {
  border-radius: 14px;
  background: var(--card, rgba(24, 24, 28, 0.92));
  border: 1px solid var(--line, rgba(128, 128, 128, 0.18));
  padding: 16px 18px;
}
.sp-tabs {
  display: flex;
  align-items: center;
  gap: 22px;
  border-bottom: 1px solid var(--sp-line);
  margin: -4px -2px 14px;
  padding: 0 2px;
}
.sp-tab {
  position: relative;
  background: none;
  border: 0;
  padding: 8px 2px 10px;
  font-size: 13.5px;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}
.sp-tab.active { opacity: 1; font-weight: 600; }
.sp-ver { margin-left: auto; font-size: 11px; line-height: 1; opacity: 0.45; }
.sp-tab-body { will-change: transform, opacity; }
.sp-tab-body.slide-left { animation: sp-slide-left 0.28s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
.sp-tab-body.slide-right { animation: sp-slide-right 0.28s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
@keyframes sp-slide-left {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: none; }
}
@keyframes sp-slide-right {
  from { opacity: 0; transform: translateX(-16px); }
  to { opacity: 1; transform: none; }
}
.sp-tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--sp-accent);
}
.pane { display: flex; flex-direction: column; gap: 14px; }
.sp-alert {
  font-size: 12.5px;
  line-height: 1.8;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.22);
  color: var(--text, inherit);
}
.opts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  align-items: end;
}
.opt { display: flex; flex-direction: column; gap: 6px; font-size: 12px; min-width: 0; }
.opt > span { opacity: 0.65; }
.opt.wide { grid-column: span 2; }
.opt.go { align-items: flex-start; }
.loc { display: flex; gap: 16px; flex-wrap: wrap; opacity: 0.75; }
.fb-tip { font-size: 12px; color: var(--warn, #f59e0b); }
.small { font-size: 12px; }
.muted { opacity: 0.62; }
.warn { color: var(--warn, #f59e0b); }
.grow { flex: 1; }

.stage { display: grid; gap: 18px; align-items: start; }
.stage.wan { grid-template-columns: 200px minmax(0, 1fr) 340px; }
.stage.lan { grid-template-columns: 200px minmax(0, 1fr) 340px; }
@media (max-width: 1100px) {
  .stage.wan, .stage.lan { grid-template-columns: 200px minmax(0, 1fr); }
  .stage.wan .side, .stage.lan .side { grid-column: 1 / -1; }
  .stage.wan .side .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 820px) {
  .stage.wan, .stage.lan { grid-template-columns: minmax(0, 1fr); }
  .stage.wan .side .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.g-pill {
  font-size: 12px;
  line-height: 1.5;
  padding: 3px 12px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.14);
  opacity: 0.9;
  white-space: nowrap;
}
.chart-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  background: var(--sp-tile);
  border-radius: 12px;
  padding: 12px 14px 8px;
}
.stage.lan .side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.stage.wan .side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.stage.wan .side .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.tiles.two { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tile {
  background: var(--sp-tile);
  border-radius: 12px;
  padding: 12px 14px;
  min-width: 0;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.t-label {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-val {
  margin-top: 6px;
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 24px;
  font-weight: 650;
  line-height: 1.1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.t-unit { font-size: 12px; font-weight: 400; line-height: 1; opacity: 0.6; }
.t-sub { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; line-height: 1.4; }
.lan-chart { background: var(--sp-tile); border-radius: 12px; padding: 12px 14px 8px; }
.axis-row { display: flex; justify-content: space-between; font-size: 11px; opacity: 0.5; margin-top: 2px; }
.legend { display: flex; align-items: center; gap: 12px; font-size: 12px; opacity: 0.8; }
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.prog-row { display: flex; align-items: center; gap: 10px; }
.prog { flex: 1; height: 8px; border-radius: 6px; background: rgba(128, 128, 128, 0.16); overflow: hidden; }
.prog i { display: block; height: 100%; border-radius: 6px; background: var(--nui-accent, #2080f0);
  background: linear-gradient(90deg, var(--nui-accent, #2080f0), color-mix(in srgb, var(--nui-accent, #2080f0) 55%, #ffffff));
  transition: width 0.25s; }
.meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; line-height: 1.6; opacity: 0.78; min-height: 18px; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.go { min-width: 150px; }

.cats-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cat-chip {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--sp-line);
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}
.cat-chip.on { opacity: 1; background: rgba(244, 114, 182, 0.16); border-color: rgba(244, 114, 182, 0.55); }
.list { display: flex; flex-direction: column; gap: 6px; }
.legend { display: flex; align-items: center; gap: 12px; font-size: 12px; opacity: 0.85; flex-wrap: wrap; }
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.row { display: grid; grid-template-columns: 170px minmax(0, 1fr) 210px; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--sp-line); }
@media (max-width: 640px) { .row { grid-template-columns: minmax(0, 1fr) auto; } .wf { grid-column: 1 / -1; } }
.name { display: flex; flex-direction: column; min-width: 0; }
.nm { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.catg { font-size: 12px; }
.row.fail .nm { opacity: 0.6; }
.wf { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: rgba(128, 128, 128, 0.12); }
.wf.placeholder { background: rgba(128, 128, 128, 0.08); }
.seg { height: 100%; min-width: 1px; }
.vals { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.empty-small { font-size: 12px; opacity: 0.5; padding: 14px 0; text-align: center; }

.v-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.vcard { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--sp-line); border-radius: 12px; padding: 12px 14px; }
.v-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vname { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.big { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; }
.kv span { opacity: 0.65; }
.kv b { text-align: right; font-weight: 500; }
.me-val { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.me-ip { font-size: 15px; font-weight: 650; letter-spacing: .2px; }

.hist-card { padding-top: 12px; }
.hist-head { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.h-title { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; }
.hist { display: flex; flex-direction: column; font-size: 13px; }
.h-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) 70px 80px 80px 90px; gap: 8px; align-items: center; padding: 8px 4px; border-bottom: 1px solid var(--sp-line); }
.h-row.h-head { opacity: 0.6; font-size: 12px; }
.h-row .r { text-align: right; }
.ellipsis { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
@media (max-width: 640px) {
  .h-row { grid-template-columns: 74px minmax(0, 1fr) 54px 58px 58px; font-size: 12px; }
  .h-row > :last-child { display: none; }
  .opts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .opt.wide { grid-column: 1 / -1; }
}
@media (prefers-reduced-motion: reduce) {
  .sp-tab-body { animation: none !important; }
}
</style>
