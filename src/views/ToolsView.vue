<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NDataTable,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NPopconfirm,
  NProgress,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  AnalyticsOutline,
  InformationCircleOutline,
  PulseOutline,
  RefreshOutline,
  SpeedometerOutline,
  StopOutline,
  TrashOutline,
  WifiOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import Sparkline from '@/components/Sparkline.vue'
import { shortError } from '@/composables/useAsync'
import { useUiStore } from '@/stores/ui'
import { fmtAgo, fmtBytes } from '@/utils/format'
import {
  connCheck,
  diagPoll,
  diagStart,
  diagStop,
  diagSupported,
  getDiagOptions,
  getRateHistory,
  getSpeedBundle,
  glassSpeedtest,
  officialDiagPing,
  officialDiagTrace,
  sampleSystem,
  speedClearHistory,
  speedPhaseLabel,
  speedPoll,
  speedProbe,
  speedStart,
  speedStop,
  speedSupported,
  wanHealth,
  wanSpeed,
  type ConnResult,
  type DiagChunk,
  type DiagKind,
  type DiagOptions,
  type DiagStartInput,
  type SpeedBundle,
  type SpeedHistoryItem,
  type SpeedProbeResult,
  type SpeedState,
  type WanHealth,
} from '@/api/cellular'

/**
 * 工具页（/tools/*）
 *   speedtest：NUI 桥 speed.*（真机可用）；桥不可用时退回官方 glass.speedtest
 *   diag：NUI 桥 diag.*（流式）；桥不可用时退回官方 diag.ping/traceroute（一次性）
 *   monitor：sys.details + clients.get_wan_speed 本地滑窗（sys.rate_history 有数据时回填）
 *   conn：glass.conn_check 优先，未部署时 kmwan + 官方 diag.ping 组合（真实探测）
 */
const props = withDefaults(defineProps<{ section?: string }>(), { section: 'speedtest' })
const section = computed(() => props.section || 'speedtest')
const message = useMessage()
const ui = useUiStore()

/* =========================================================================
 * 测速
 * ========================================================================= */
const speedBundle = ref<SpeedBundle | null>(null)
const speedLoading = ref(false)
const speedError = ref('')
const speedBridgeOk = ref(true)
const serverValue = ref('auto')
const duration = ref(10)
const speedConn = ref(4)
const cap = ref(300)
const probeResult = ref<SpeedProbeResult | null>(null)
const probing = ref(false)
const speedState = ref<SpeedState | null>(null)
const chartDl = ref<number[]>([])
const chartUl = ref<number[]>([])
const glassUrl = ref('http://speedtest1.online.sh.cn:8080/hello')
const glassSec = ref(10)
const glassBusy = ref(false)
const glassResult = ref<Record<string, any> | null>(null)
let speedTimer: number | undefined

const speedPhase = computed(() => speedState.value?.phase || 'idle')
const speedRunning = computed(() => !!speedState.value?.running)
const speedActive = computed(
  () => speedRunning.value || ['starting', 'select', 'ping', 'dl', 'ul'].includes(speedPhase.value),
)
const speedProgress = computed(() => {
  if (speedPhase.value === 'done') return 100
  return Math.max(0, Math.min(100, Math.round(speedState.value?.progress ?? 0)))
})
const localLatency = computed(() => probeResult.value?.latency ?? {})
const probeReachable = computed(() => Object.keys(localLatency.value).length)

const serverOptions = computed(() => {
  const groups = new Map<string, { label: string; value: string }[]>()
  for (const s of speedBundle.value?.servers ?? []) {
    const g = s.group || '备用节点'
    const lat = localLatency.value[String(s.idx)]
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push({
      label: `${s.name}${lat ? ` · ${lat}ms` : ''}`,
      value: `ookla:${s.idx}`,
    })
  }
  const out: { label: string; value?: string; children?: { label: string; value: string }[] }[] = [
    { label: '自动优选（全球网测）', value: 'auto' },
  ]
  for (const [label, children] of groups) out.push({ label, children })
  return out
})

const speedHistoryColumns: DataTableColumns<SpeedHistoryItem> = [
  { title: '时间', key: 'time', width: 140, render: (r) => fmtTime(r.time) },
  { title: '服务器', key: 'server', ellipsis: { tooltip: true } },
  { title: '延迟', key: 'ping', width: 78, render: (r) => (r.ping != null ? `${r.ping} ms` : '—') },
  { title: '抖动', key: 'jitter', width: 78, render: (r) => (r.jitter != null ? `${r.jitter} ms` : '—') },
  { title: '下载', key: 'dl', width: 100, render: (r) => (r.dl != null ? `${r.dl} Mbps` : '—') },
  { title: '上传', key: 'ul', width: 100, render: (r) => (r.ul != null ? `${r.ul} Mbps` : '—') },
  {
    title: '流量',
    key: 'bytes',
    width: 110,
    render: (r) => fmtBytes((r.dl_bytes ?? 0) + (r.ul_bytes ?? 0)),
  },
]

function fmtTime(sec: number): string {
  if (!sec) return '—'
  const d = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function loadSpeed(force = false) {
  speedLoading.value = true
  speedError.value = ''
  try {
    speedBridgeOk.value = await speedSupported()
    if (!speedBridgeOk.value) return
    speedBundle.value = await getSpeedBundle()
    if (force) message.success('测速节点与历史已刷新')
  } catch (e) {
    speedError.value = shortError(e)
  } finally {
    speedLoading.value = false
  }
}

async function doProbe() {
  probing.value = true
  try {
    probeResult.value = await speedProbe(true)
    message.success(`节点探测完成：${probeReachable.value} 个节点可达`)
  } catch (e) {
    message.error(shortError(e))
  } finally {
    probing.value = false
  }
}

function stopSpeedPoll() {
  if (speedTimer) {
    clearInterval(speedTimer)
    speedTimer = undefined
  }
}

async function pollSpeed() {
  try {
    const st = await speedPoll()
    speedState.value = st
    if (st.phase === 'dl' && st.cur != null) chartDl.value = [...chartDl.value, st.cur].slice(-120)
    if (st.phase === 'ul' && st.cur != null) chartUl.value = [...chartUl.value, st.cur].slice(-120)
    if (!st.running && st.phase !== 'starting') {
      stopSpeedPoll()
      if (st.phase === 'done') {
        message.success(`测速完成：↓ ${st.dl ?? '—'} Mbps / ↑ ${st.ul ?? '—'} Mbps`)
        void loadSpeed()
      }
    }
  } catch (e) {
    stopSpeedPoll()
    message.error(shortError(e))
  }
}

async function startSpeed() {
  if (!speedBridgeOk.value) {
    message.warning('NUI 测速桥不可用；请用下方「官方兜底」面板')
    return
  }
  chartDl.value = []
  chartUl.value = []
  speedState.value = {
    phase: 'starting',
    running: true,
    dl: null,
    ul: null,
    ping: null,
    jitter: null,
    cur: null,
    progress: 0,
    bytes: null,
    dl_bytes: null,
    ul_bytes: null,
    server: '',
    engine: '',
    area: '',
    error: '',
    time: null,
  }
  try {
    await speedStart({ server: serverValue.value, duration: duration.value, conn: speedConn.value, cap: cap.value })
    stopSpeedPoll()
    speedTimer = window.setInterval(() => void pollSpeed(), 500)
  } catch (e) {
    speedState.value = null
    message.error(shortError(e))
  }
}

async function stopSpeed() {
  try {
    await speedStop()
    message.info('已请求停止测速')
  } catch (e) {
    message.error(shortError(e))
  } finally {
    stopSpeedPoll()
    if (speedState.value) speedState.value = { ...speedState.value, running: false, phase: 'stopped' }
  }
}

async function clearSpeedHistory() {
  try {
    await speedClearHistory()
    message.success('测速历史已清空')
    await loadSpeed()
  } catch (e) {
    message.error(shortError(e))
  }
}

async function runGlassSpeedtest() {
  glassBusy.value = true
  glassResult.value = null
  try {
    glassResult.value = await glassSpeedtest(glassUrl.value, glassSec.value, 100)
    message.success('官方兜底测速完成')
  } catch (e) {
    message.error(`官方 glass.speedtest 不可用：${shortError(e)}`)
  } finally {
    glassBusy.value = false
  }
}

/* =========================================================================
 * 诊断
 * ========================================================================= */
const diagBridgeOk = ref(true)
const diagOpts = ref<DiagOptions | null>(null)
const diagLoading = ref(false)
const diagError = ref('')
const diagKind = ref<DiagKind>('ping')
const diagHost = ref('223.5.5.5')
const diagCount = ref(4)
const diagSize = ref<number | null>(null)
const diagInterval = ref<number | null>(null)
const diagTtl = ref<number | null>(null)
const diagHops = ref(30)
const diagProbes = ref(1)
const diagWait = ref(2)
const diagResolve = ref(false)
const diagDev = ref('')
const diagFamily = ref<'' | '4' | '6'>('')
const diagPort = ref<number | null>(80)
const diagUrl = ref('http://www.baidu.com')
const diagMethod = ref('GET')
const diagFollow = ref(true)
const diagInsecure = ref(false)
const diagServer = ref('')
const diagTimeout = ref(15)
const diagOutput = ref('')
const diagOffset = ref(0)
const diagRunning = ref(false)
const diagDone = ref(false)
const diagRc = ref<number | null>(null)
const diagCmd = ref('')
const diagSource = ref('NUI 桥 diag.*')
let diagTimer: number | undefined

const diagExitOptions = computed(() =>
  (diagOpts.value?.exits ?? []).map((e) => ({ label: `${e.iface}（${e.dev}）`, value: e.dev })),
)
const diagKindOptions = [
  { label: 'Ping', value: 'ping' },
  { label: '路由追踪', value: 'traceroute' },
  { label: 'DNS 解析', value: 'nslookup' },
  { label: 'HTTP 请求', value: 'http' },
  { label: 'TCP 端口', value: 'tcp' },
]
const diagPresets = [
  { label: '阿里 DNS', value: '223.5.5.5' },
  { label: '腾讯 DNS', value: '119.29.29.29' },
  { label: '百度', value: 'www.baidu.com' },
  { label: 'Cloudflare', value: '1.1.1.1' },
]

async function loadDiag(force = false) {
  diagLoading.value = true
  diagError.value = ''
  try {
    diagBridgeOk.value = await diagSupported()
    if (!diagBridgeOk.value) return
    diagOpts.value = await getDiagOptions()
    if (force) message.success('诊断选项已刷新')
  } catch (e) {
    diagError.value = shortError(e)
  } finally {
    diagLoading.value = false
  }
}

function stopDiagPoll() {
  if (diagTimer) {
    clearInterval(diagTimer)
    diagTimer = undefined
  }
}

function buildDiagInput(): DiagStartInput {
  const base: DiagStartInput = {
    kind: diagKind.value,
    count: diagCount.value,
    size: diagSize.value ?? undefined,
    interval: diagInterval.value ?? undefined,
    ttl: diagTtl.value ?? undefined,
    dev: diagDev.value || undefined,
    family: diagFamily.value || undefined,
  }
  switch (diagKind.value) {
    case 'traceroute':
      return { ...base, host: diagHost.value, hops: diagHops.value, probes: diagProbes.value, wait: diagWait.value, resolve: diagResolve.value }
    case 'nslookup':
      return { kind: 'nslookup', host: diagHost.value, server: diagServer.value || undefined }
    case 'http':
      return {
        kind: 'http',
        url: diagUrl.value,
        timeout: diagTimeout.value,
        method: diagMethod.value,
        follow: diagFollow.value,
        insecure: diagInsecure.value,
        family: diagFamily.value || undefined,
        dev: diagDev.value || undefined,
        count: diagCount.value,
      }
    case 'tcp':
      return { kind: 'tcp', host: diagHost.value, port: diagPort.value ?? 80, count: diagCount.value, family: diagFamily.value || undefined, dev: diagDev.value || undefined }
    default:
      return { ...base, host: diagHost.value }
  }
}

async function pollDiag() {
  try {
    const c: DiagChunk = await diagPoll(diagOffset.value)
    diagOffset.value = c.offset
    if (c.text) diagOutput.value += c.text
    diagDone.value = c.done
    diagRc.value = c.rc
    if (c.done) {
      stopDiagPoll()
      diagRunning.value = false
      message.success('诊断完成')
    }
  } catch (e) {
    stopDiagPoll()
    diagRunning.value = false
    message.error(shortError(e))
  }
}

async function startDiag() {
  diagOutput.value = ''
  diagOffset.value = 0
  diagDone.value = false
  diagRc.value = null
  diagCmd.value = ''
  if (!diagBridgeOk.value) {
    await runOfficialDiag()
    return
  }
  if ((diagKind.value === 'http' ? !diagUrl.value : !diagHost.value)) {
    message.warning('请输入目标地址')
    return
  }
  try {
    const r = await diagStart(buildDiagInput())
    diagCmd.value = r.cmd
    diagSource.value = 'NUI 桥 diag.start/poll'
    diagRunning.value = true
    stopDiagPoll()
    diagTimer = window.setInterval(() => void pollDiag(), 500)
  } catch (e) {
    message.error(shortError(e))
  }
}

async function stopDiag() {
  try {
    await diagStop()
    message.info('诊断已停止')
  } catch (e) {
    message.error(shortError(e))
  } finally {
    stopDiagPoll()
    diagRunning.value = false
    diagDone.value = true
  }
}

/** 桥不可用时的官方一次性诊断（仅 ping / traceroute） */
async function runOfficialDiag() {
  if (diagKind.value !== 'ping' && diagKind.value !== 'traceroute') {
    message.warning('官方 diag 对象只支持 ping / traceroute；其它类型需要 NUI 桥')
    return
  }
  diagRunning.value = true
  diagOutput.value = '执行中…\n'
  diagSource.value = '官方 diag.' + diagKind.value
  try {
    if (diagKind.value === 'ping') {
      const r = await officialDiagPing(diagHost.value)
      diagOutput.value = r.output || '（无输出）'
      diagRc.value = r.loss === 0 ? 0 : 1
    } else {
      diagOutput.value = (await officialDiagTrace(diagHost.value)) || '（无输出）'
      diagRc.value = 0
    }
    diagDone.value = true
    message.success('官方诊断完成')
  } catch (e) {
    diagOutput.value = `${diagOutput.value}\n失败：${shortError(e)}`
    message.error(shortError(e))
  } finally {
    diagRunning.value = false
  }
}

/* =========================================================================
 * 历史监控（本地滑窗）
 * ========================================================================= */
interface Sample {
  at: number
  cpu: number | null
  memPct: number | null
  down: number
  up: number
  source: string
}
const samples = ref<Sample[]>([])
const monWindow = ref(2)
const monRunning = ref(false)
const monError = ref('')
const monLoading = ref(false)
const monSource = ref('')
const nowTick = ref(Date.now())
let monTimer: number | undefined
let monActive = false

const monWindowOptions = [
  { label: '2 分钟', value: 2 },
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 },
]
const maxSamples = 220

const visibleSamples = computed(() => {
  const from = nowTick.value - monWindow.value * 60000
  return samples.value.filter((s) => s.at >= from)
})
const cpuSeries = computed(() => visibleSamples.value.map((s) => s.cpu ?? 0))
const memSeries = computed(() => visibleSamples.value.map((s) => s.memPct ?? 0))
const downSeries = computed(() => visibleSamples.value.map((s) => s.down))
const upSeries = computed(() => visibleSamples.value.map((s) => s.up))
const lastSample = computed(() => samples.value[samples.value.length - 1] ?? null)

function pushSample(s: Sample) {
  samples.value = [...samples.value, s].slice(-maxSamples)
  nowTick.value = Date.now()
}

async function tickMonitor() {
  if (!monActive || document.hidden) return
  try {
    const [sys, rate] = await Promise.all([sampleSystem(), wanSpeed()])
    monSource.value = sys.source
    pushSample({
      at: Date.now(),
      cpu: sys.cpu,
      memPct: sys.memPct,
      down: rate.down,
      up: rate.up,
      source: sys.source,
    })
    monError.value = ''
  } catch (e) {
    monError.value = shortError(e)
  }
}

async function loopMonitor() {
  await tickMonitor()
  if (monActive) monTimer = window.setTimeout(() => void loopMonitor(), 3000)
}

async function startMonitor() {
  if (monActive) return
  monActive = true
  monRunning.value = true
  monLoading.value = samples.value.length === 0
  try {
    // 有设备端历史时先回填（[设备ms, down, up]），时间按设备/浏览器时钟差换算
    const rh = await getRateHistory().catch(() => null)
    if (rh && rh.points.length) {
      const offset = (rh.now || Date.now()) - Date.now()
      const seeded: Sample[] = rh.points.map((p) => ({
        at: p[0] - offset,
        cpu: null,
        memPct: null,
        down: p[1],
        up: p[2],
        source: 'sys.rate_history',
      }))
      samples.value = [...seeded, ...samples.value].slice(-maxSamples)
      monSource.value = 'sys.rate_history + sys.details'
      nowTick.value = Date.now()
    }
  } catch {
    /* 历史为空不影响本地采样 */
  }
  monLoading.value = false
  void loopMonitor()
}

function stopMonitor() {
  monActive = false
  monRunning.value = false
  if (monTimer) {
    clearTimeout(monTimer)
    monTimer = undefined
  }
}

/* =========================================================================
 * 联网检测
 * ========================================================================= */
const conn = ref<ConnResult | null>(null)
const connHealth = ref<WanHealth | null>(null)
const connBusy = ref(false)
const connError = ref('')

const connLevelText = computed(() => {
  const c = conn.value
  if (!c) return '检测中…'
  if (c.level === 'ok') return '已联网'
  if (c.level === 'link') return '链路通但无法上网'
  return '未联网'
})
const connLevelType = computed(() =>
  conn.value?.level === 'ok' ? 'success' : conn.value?.level === 'link' ? 'warning' : 'error',
)
const connCheckedText = computed(() => (conn.value ? fmtAgo(conn.value.checkedAt) : '—'))
const connIfaceColumns: DataTableColumns<ConnResult['ifaces'][number]> = [
  { title: '接口', key: 'name', width: 110 },
  {
    title: '状态',
    key: 'online',
    width: 96,
    render: (r) =>
      r.online
        ? '在线'
        : '离线',
  },
  { title: '说明', key: 'status' },
  { title: '地址', key: 'ip', render: (r) => r.ip || '—' },
  {
    title: '延迟',
    key: 'latency',
    width: 90,
    render: (r) => (r.latency != null ? `${r.latency} ms` : '—'),
  },
]

async function loadConn(force = false) {
  if (connBusy.value) return
  connBusy.value = true
  connError.value = ''
  try {
    const [c, h] = await Promise.all([connCheck(), wanHealth()])
    conn.value = c
    connHealth.value = h
    if (force) message.success('联网检测完成')
  } catch (e) {
    connError.value = shortError(e)
    if (force) message.error(shortError(e))
  } finally {
    connBusy.value = false
  }
}

const kmwanColumns: DataTableColumns<Record<string, any>> = [
  { title: '接口', key: 'interface', width: 110 },
  { title: 'IPv4 跟踪', key: 'track_ipv4', render: (r) => (Array.isArray(r.track_ipv4) ? r.track_ipv4.join(', ') : '—') },
  { title: '协议', key: 'track_proto', width: 80 },
  { title: '权重', key: 'weight', width: 70 },
  { title: '启用', key: 'enable_check', width: 80, render: (r) => (r.enable_check ? '是' : '否') },
]

/* =========================================================================
 * section 切换：进入对应板块时才初始化（避免四个板块一起打设备）
 * ========================================================================= */
function initSection() {
  switch (section.value) {
    case 'diag':
      void loadDiag()
      break
    case 'monitor':
      void startMonitor()
      break
    case 'conn':
      void loadConn()
      break
    default:
      void loadSpeed()
      break
  }
}

watch(
  section,
  (s, old) => {
    if (s !== 'speedtest') stopSpeedPoll()
    if (s !== 'diag') stopDiagPoll()
    if (s !== 'monitor') stopMonitor()
    if (!old || old !== s) initSection()
  },
  { immediate: true },
)

// 联网检测：停留本页时 30 秒刷新一次；测速/诊断不自动重跑
let connTimer: number | undefined
watch(
  section,
  (s) => {
    if (connTimer) {
      clearInterval(connTimer)
      connTimer = undefined
    }
    if (s === 'conn') {
      connTimer = window.setInterval(() => {
        if (!document.hidden && !connBusy.value) void loadConn(true)
      }, ui.refreshMs)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopSpeedPoll()
  stopDiagPoll()
  stopMonitor()
  if (connTimer) clearInterval(connTimer)
})
</script>

<template>
  <div class="nui-page">
    <!-- ======================= 网络测速 ======================= -->
    <template v-if="section === 'speedtest'">
      <div class="nui-grid">
        <PanelCard class="span-12" title="网络测速（路由器自身出网测速）" action="刷新" @action="loadSpeed(true)">
          <template #icon><n-icon><SpeedometerOutline /></n-icon></template>
          <n-alert v-if="!speedBridgeOk" type="warning" :bordered="false" title="NUI 测速桥不可用">
            插件后端没有 speed.start/poll 方法，无法使用全球网测节点。可改用下方「官方兜底」：
            glass.speedtest（需要 be-lua 部署 glass RPC，当前可能未部署）。
          </n-alert>
          <PageState v-else :loading="speedLoading && !speedBundle" :error="speedError" :empty="!speedBundle" empty-text="读取测速节点失败" @retry="loadSpeed(true)">
            <div class="speed-form">
              <n-form-item label="测速节点" :show-feedback="false">
                <n-select v-model:value="serverValue" :options="serverOptions" size="small" style="min-width: 260px" />
              </n-form-item>
              <n-form-item label="每项时长" :show-feedback="false">
                <n-select
                  v-model:value="duration"
                  :options="[5, 10, 15, 20, 30].map((v) => ({ label: `${v} 秒`, value: v }))"
                  size="small"
                  style="width: 110px"
                />
              </n-form-item>
              <n-form-item label="并发连接" :show-feedback="false">
                <n-select
                  v-model:value="speedConn"
                  :options="[1, 2, 4, 8, 16].map((v) => ({ label: `${v} 线程`, value: v }))"
                  size="small"
                  style="width: 110px"
                />
              </n-form-item>
              <n-form-item label="下载上限" :show-feedback="false">
                <n-select
                  v-model:value="cap"
                  :options="[100, 300, 500, 1000].map((v) => ({ label: v >= 1000 ? `${v / 1000} GB` : `${v} MB`, value: v }))"
                  size="small"
                  style="width: 110px"
                />
              </n-form-item>
              <n-button size="small" secondary :loading="probing" @click="doProbe">探测节点</n-button>
              <span class="nui-small nui-muted">
                {{ probeReachable ? `${probeReachable} 个节点可达` : '未探测（探测会请求各节点 /hello，3s 超时）' }}
              </span>
            </div>
            <div class="speed-run">
              <n-button type="primary" :disabled="speedActive" @click="startSpeed">开始测速</n-button>
              <n-button v-if="speedActive" secondary type="error" @click="stopSpeed">
                <template #icon><n-icon><StopOutline /></n-icon></template>
                停止
              </n-button>
              <n-tag size="small" :bordered="false" :type="speedActive ? 'info' : 'default'">{{ speedPhaseLabel(speedPhase) }}</n-tag>
              <n-progress type="line" :percentage="speedProgress" :show-indicator="false" style="flex: 1; min-width: 120px" />
              <span class="nui-small nui-muted">{{ speedProgress }}%</span>
            </div>
            <div class="speed-stats">
              <div><span class="nui-small nui-muted">延迟</span><div><span class="nui-mid">{{ speedState?.ping ?? '—' }}</span><span class="nui-unit">ms</span></div></div>
              <div><span class="nui-small nui-muted">抖动</span><div><span class="nui-mid">{{ speedState?.jitter ?? '—' }}</span><span class="nui-unit">ms</span></div></div>
              <div><span class="nui-small nui-muted">下载</span><div><span class="nui-mid">{{ speedState?.dl ?? '—' }}</span><span class="nui-unit">Mbps</span></div></div>
              <div><span class="nui-small nui-muted">上传</span><div><span class="nui-mid">{{ speedState?.ul ?? '—' }}</span><span class="nui-unit">Mbps</span></div></div>
              <div><span class="nui-small nui-muted">本次消耗</span><div><span class="nui-mid">{{ fmtBytes((speedState?.dl_bytes ?? 0) + (speedState?.ul_bytes ?? 0)) }}</span></div></div>
            </div>
            <div v-if="speedState?.server || speedState?.area" class="nui-small nui-muted">
              节点：{{ speedState?.server || '—' }}<template v-if="speedState?.area"> · {{ speedState.area }}</template>
              <template v-if="speedState?.engine"> · 引擎 {{ speedState.engine }}</template>
            </div>
            <n-alert v-if="speedState?.error" type="error" :bordered="false" style="margin-top: 10px">
              测速失败：{{ speedState.error }}
            </n-alert>
            <Sparkline v-if="chartDl.length" :series="[chartDl, chartUl]" :colors="['#2080f0', '#18a058']" :height="110" />
          </PageState>
        </PanelCard>

        <PanelCard v-if="!speedBridgeOk" class="span-12" title="官方兜底：glass.speedtest">
          <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
          <p class="nui-small nui-muted" style="margin: 0 0 10px">
            服务端 curl 下载测速（glass RPC 由 be-lua 部署后可用；本机 18:xx 探针仍返回 Method not found）。
          </p>
          <div class="glass-form">
            <n-input v-model:value="glassUrl" placeholder="测速文件 URL（http/https）" size="small" style="min-width: 320px" />
            <n-input-number v-model:value="glassSec" :min="3" :max="30" size="small" style="width: 130px" />
            <n-button size="small" type="primary" :loading="glassBusy" @click="runGlassSpeedtest">开始下载测速</n-button>
          </div>
          <pre v-if="glassResult" class="raw">{{ JSON.stringify(glassResult, null, 2) }}</pre>
        </PanelCard>

        <PanelCard v-if="speedBundle && speedBridgeOk" class="span-12" title="测速记录（最近 20 条）">
          <template #icon><n-icon><AnalyticsOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-popconfirm @positive-click="clearSpeedHistory">
                <template #trigger>
                  <n-button size="tiny" secondary type="error">
                    <template #icon><n-icon><TrashOutline /></n-icon></template>
                    清空记录
                  </n-button>
                </template>
                清空设备上的测速历史（/etc/nui/speedtest-history.json）？
              </n-popconfirm>
            </div>
          </template>
          <n-data-table
            size="small"
            :columns="speedHistoryColumns"
            :data="speedBundle.history"
            :bordered="false"
            :scroll-x="720"
            :pagination="false"
          />
          <p v-if="!speedBundle.history.length" class="nui-small nui-muted" style="margin: 8px 0 0">
            还没有测速记录。跑一次测速后结果会自动写入设备历史。
          </p>
          <p v-else class="nui-small nui-muted" style="margin: 8px 0 0">
            速度单位 Mbps；「流量」为该次测速的下载+上传字节数。
          </p>
        </PanelCard>
      </div>
    </template>

    <!-- ======================= 网络诊断 ======================= -->
    <template v-if="section === 'diag'">
      <div class="nui-grid">
        <PanelCard class="span-12" title="网络诊断" action="刷新选项" @action="loadDiag(true)">
          <template #icon><n-icon><PulseOutline /></n-icon></template>
          <n-alert v-if="!diagBridgeOk" type="warning" :bordered="false" title="NUI 诊断桥不可用">
            只能使用官方 diag.ping / diag.traceroute（一次性输出，不支持流式与 DNS/HTTP/TCP 诊断）。
          </n-alert>
          <PageState v-else :loading="diagLoading" :error="diagError" :empty="false">
            <div class="diag-form">
              <n-select v-model:value="diagKind" :options="diagKindOptions" size="small" style="width: 130px" />
              <n-input v-if="diagKind !== 'http'" v-model:value="diagHost" placeholder="域名或 IP（如 223.5.5.5 / www.baidu.com）" size="small" style="min-width: 240px" />
              <n-input v-else v-model:value="diagUrl" placeholder="http:// 或 https:// 地址" size="small" style="min-width: 300px" />
              <n-input-number v-if="diagKind === 'tcp'" v-model:value="diagPort" :min="1" :max="65535" size="small" style="width: 120px" />
              <n-select
                v-model:value="diagDev"
                :options="[{ label: '自动（按路由）', value: '' }, ...diagExitOptions]"
                size="small"
                style="width: 180px"
              />
              <n-button type="primary" size="small" :loading="diagRunning" @click="startDiag">开始</n-button>
              <n-button v-if="diagRunning" size="small" secondary type="error" @click="stopDiag">停止</n-button>
            </div>

            <div class="diag-extra">
              <template v-if="diagKind === 'ping'">
                <n-input-number v-model:value="diagCount" :min="1" :max="1000" size="small" style="width: 120px">
                  <template #prefix>次数</template>
                </n-input-number>
                <n-input-number v-model:value="diagSize" :min="0" :max="65500" size="small" style="width: 130px" placeholder="包大小" />
                <n-input-number v-model:value="diagInterval" :min="0.2" :max="10" size="small" style="width: 130px" placeholder="间隔(s)" />
                <n-input-number v-model:value="diagTtl" :min="1" :max="255" size="small" style="width: 120px" placeholder="TTL" />
              </template>
              <template v-if="diagKind === 'traceroute'">
                <n-input-number v-model:value="diagHops" :min="1" :max="64" size="small" style="width: 130px" placeholder="最大跳数" />
                <n-input-number v-model:value="diagProbes" :min="1" :max="3" size="small" style="width: 130px" placeholder="每跳探测" />
                <n-input-number v-model:value="diagWait" :min="1" :max="5" size="small" style="width: 130px" placeholder="每跳等待" />
                <span class="nui-row nui-small"><n-switch v-model:value="diagResolve" size="small" /> 显示主机名</span>
              </template>
              <template v-if="diagKind === 'nslookup'">
                <n-input v-model:value="diagServer" placeholder="DNS 服务器（留空用系统 DNS）" size="small" style="min-width: 240px" />
              </template>
              <template v-if="diagKind === 'http'">
                <n-select v-model:value="diagMethod" :options="[{ label: 'GET', value: 'GET' }, { label: 'HEAD', value: 'HEAD' }]" size="small" style="width: 100px" />
                <n-input-number v-model:value="diagTimeout" :min="1" :max="60" size="small" style="width: 130px" placeholder="超时(s)" />
                <n-input-number v-model:value="diagCount" :min="1" :max="10" size="small" style="width: 120px" placeholder="次数" />
                <span class="nui-row nui-small"><n-switch v-model:value="diagFollow" size="small" /> 跟随跳转</span>
                <span class="nui-row nui-small"><n-switch v-model:value="diagInsecure" size="small" /> 忽略证书</span>
              </template>
              <template v-if="diagKind !== 'http' && diagKind !== 'nslookup'">
                <n-select
                  v-model:value="diagFamily"
                  :options="[{ label: '自动', value: '' }, { label: 'IPv4', value: '4' }, { label: 'IPv6', value: '6' }]"
                  size="small"
                  style="width: 110px"
                />
                <span class="nui-row nui-small nui-wrap">
                  常用：
                  <a v-for="p in diagPresets" :key="p.value" class="preset" @click="diagHost = p.value">{{ p.label }}</a>
                </span>
              </template>
            </div>

            <div class="diag-meta nui-small nui-muted">
              <span>来源：{{ diagSource }}</span>
              <span v-if="diagCmd" class="nui-mono">cmd: {{ diagCmd }}</span>
              <span v-if="diagDone">退出码 {{ diagRc ?? '—' }}</span>
              <span v-if="diagOpts && diagBridgeOk">可用出口：{{ diagOpts.exits.length ? diagOpts.exits.map((e) => e.iface).join(', ') : '无（按路由）' }}</span>
            </div>

            <pre class="diag-out">{{ diagOutput || '输出区：点击「开始」后在这里实时显示（poll 增量追加）' }}</pre>
          </PageState>
        </PanelCard>
      </div>
    </template>

    <!-- ======================= 历史监控 ======================= -->
    <template v-if="section === 'monitor'">
      <div class="nui-grid">
        <PanelCard class="span-12" title="历史监控（本地滑动窗口，每 3 秒采样）" action="刷新采样" @action="startMonitor">
          <template #icon><n-icon><AnalyticsOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-tag size="small" :bordered="false" :type="monRunning ? 'success' : 'default'">
                {{ monRunning ? '采样中' : '已停止' }}
              </n-tag>
              <span class="nui-small nui-muted">来源 {{ monSource || '—' }}</span>
            </div>
          </template>
          <div class="mon-toolbar">
            <span class="nui-small nui-muted">时间窗口</span>
            <n-button
              v-for="w in monWindowOptions"
              :key="w.value"
              size="tiny"
              :type="monWindow === w.value ? 'primary' : 'default'"
              :secondary="monWindow !== w.value"
              @click="monWindow = w.value"
            >
              {{ w.label }}
            </n-button>
            <span class="nui-right nui-small nui-muted">
              当前：CPU {{ lastSample?.cpu != null ? lastSample.cpu.toFixed(1) + '%' : '—' }} · 内存
              {{ lastSample?.memPct != null ? lastSample.memPct + '%' : '—' }} · ↓ {{ (lastSample?.down ?? 0) / 1024 | 0 }} KB/s
            </span>
          </div>
          <n-alert v-if="monError" type="warning" :bordered="false" style="margin-bottom: 10px">{{ monError }}</n-alert>

          <div class="mon-panels">
            <div class="mon-panel">
              <div class="nui-between">
                <strong class="nui-small">CPU / 内存（%）</strong>
                <span class="nui-small nui-muted">{{ visibleSamples.length }} 个采样点</span>
              </div>
              <Sparkline :series="[cpuSeries, memSeries]" :colors="['#2080f0', '#f0a020']" :max="100" :height="130" />
              <div class="legend nui-small nui-muted">
                <span><i class="c1" /> CPU</span><span><i class="c2" /> 内存</span>
              </div>
            </div>
            <div class="mon-panel">
              <div class="nui-between">
                <strong class="nui-small">上行 / 下行（B/s）</strong>
                <span class="nui-small nui-muted">{{ monWindow }} 分钟窗口</span>
              </div>
              <Sparkline :series="[downSeries, upSeries]" :colors="['#18a058', '#d03050']" :height="130" />
              <div class="legend nui-small nui-muted">
                <span><i class="c3" /> 下行</span><span><i class="c4" /> 上行</span>
              </div>
            </div>
          </div>

          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            设备端速率历史（sys.rate_history）为空时（nui-monitor 未运行），曲线由本页每 3 秒用
            sys.details（CPU/内存）+ clients.get_wan_speed（上下行）采样本地产出；时间窗口只影响显示，数据不要求设备存历史。
          </p>
        </PanelCard>
      </div>
    </template>

    <!-- ======================= 联网检测 ======================= -->
    <template v-if="section === 'conn'">
      <div class="nui-grid">
        <PanelCard class="span-12" title="联网检测" action="重新检测" @action="loadConn(true)">
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-tag size="small" :bordered="false" :type="connLevelType">{{ connLevelText }}</n-tag>
              <span class="nui-small nui-muted">最近检测 {{ connCheckedText }}</span>
              <n-button size="tiny" secondary :loading="connBusy" @click="loadConn(true)">
                <template #icon><n-icon><RefreshOutline /></n-icon></template>
                重测
              </n-button>
            </div>
          </template>

          <n-alert v-if="connError" type="warning" :bordered="false" style="margin-bottom: 10px">{{ connError }}</n-alert>

          <div class="conn-head">
            <div>
              <div class="nui-small nui-muted">出口接口</div>
              <div class="nui-big nui-mono">{{ conn?.active || '—' }}</div>
            </div>
            <div>
              <div class="nui-small nui-muted">往返延迟</div>
              <div><span class="nui-big">{{ conn?.latency ?? '—' }}</span><span class="nui-unit">ms</span></div>
            </div>
            <div>
              <div class="nui-small nui-muted">DNS 解析</div>
              <div>
                <n-tag size="small" :bordered="false" :type="conn?.dnsOk === false ? 'error' : conn?.dnsOk ? 'success' : 'default'">
                  {{ conn?.dnsOk === null || conn?.dnsOk === undefined ? '未检测' : conn.dnsOk ? '正常' : '失败' }}
                </n-tag>
              </div>
            </div>
            <div>
              <div class="nui-small nui-muted">探测目标</div>
              <div class="nui-mono">{{ conn?.target || '—' }}</div>
            </div>
            <div>
              <div class="nui-small nui-muted">判定来源</div>
              <div class="nui-small">{{ conn?.source || '—' }}</div>
            </div>
          </div>

          <n-alert v-if="conn?.note" type="default" :bordered="false" class="nui-small" style="margin: 10px 0">
            {{ conn.note }}
          </n-alert>

          <div class="nui-sec">逐接口状态（{{ conn?.source?.includes('kmwan') ? 'kmwan.get_status' : 'glass.conn_check' }}）</div>
          <n-data-table
            size="small"
            :columns="connIfaceColumns"
            :data="conn?.ifaces ?? []"
            :bordered="false"
            :pagination="false"
            :scroll-x="640"
          />
          <p v-if="!(conn?.ifaces ?? []).length" class="nui-small nui-muted">没有接口状态数据。</p>
        </PanelCard>

        <PanelCard class="span-12" title="WAN 健康检查">
          <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
          <div class="nui-row nui-wrap" style="margin-bottom: 10px">
            <n-tag size="small" :bordered="false" :type="connHealth?.supported ? 'success' : 'warning'">
              {{ connHealth?.supported ? '配置接口可用' : '配置接口不可用（降级只读）' }}
            </n-tag>
            <span class="nui-small nui-muted">来源：{{ connHealth?.source || '—' }}</span>
          </div>
          <n-alert v-if="connHealth && !connHealth.supported && connHealth.reason" type="warning" :bordered="false" class="nui-small">
            桥 adv.wanchk_get 不可用：{{ connHealth.reason }}。以下用官方 kmwan.get_config 的链路跟踪配置做只读展示；
            修改请到「互联网 → 多 WAN 与切网」。
          </n-alert>

          <template v-if="connHealth?.lines.length">
            <div class="nui-sec">wanchk 线路</div>
            <div v-for="(l, i) in connHealth.lines" :key="i" class="nui-list-row nui-small">
              <span class="nui-mono">{{ l.name || l.label }}</span>
              <n-tag size="tiny" :bordered="false" :type="l.pingopen ? 'success' : 'default'">Ping {{ l.pingopen ? '开' : '关' }}</n-tag>
              <n-tag size="tiny" :bordered="false" :type="l.dnsopen ? 'success' : 'default'">DNS {{ l.dnsopen ? '开' : '关' }}</n-tag>
              <span class="nui-muted">超时 {{ l.timeout ?? '—' }}s / 重试 {{ l.try ?? '—' }}</span>
            </div>
          </template>
          <template v-else>
            <div class="nui-sec">kmwan 链路跟踪（官方）</div>
            <p class="nui-small nui-muted" style="margin: 0 0 8px">
              {{ connHealth?.source }} 返回 0 条 wanchk 线路配置；GL 实际用官方 kmwan 做链路跟踪，下面读的是 kmwan.get_config（只读）。
            </p>
            <n-data-table
              size="small"
              :columns="kmwanColumns"
              :data="connHealth?.kmwan ?? []"
              :bordered="false"
              :pagination="false"
              :scroll-x="620"
            />
            <p v-if="!(connHealth?.kmwan ?? []).length" class="nui-small nui-muted">kmwan.get_config 无数据。</p>
          </template>

          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            联网判定说明：优先调用自有 glass.conn_check（默认路由 → 网关 → 外网 ping → DNS 解析）；
            未部署时退回「kmwan 逐接口状态 + 官方 diag.ping 真延迟 + DNS 探测」。两种方式都不看 WAN 的 up 标志，避免假在线。
          </p>
        </PanelCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.speed-form,
.diag-form,
.glass-form {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.speed-run {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0 10px;
  flex-wrap: wrap;
}
.speed-stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.diag-extra {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.preset {
  color: var(--nui-accent);
  cursor: pointer;
  margin-right: 8px;
  text-decoration: none;
}
.preset:hover {
  text-decoration: underline;
}
.diag-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 10px 0 6px;
}
.diag-out {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  min-height: 220px;
  max-height: 460px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  line-height: 1.65;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.raw {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  font-size: 12px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
}
.mon-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.mon-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}
.mon-panel {
  padding: 12px;
  border-radius: 12px;
  background: rgba(128, 128, 128, 0.05);
}
.legend {
  display: flex;
  gap: 16px;
  margin-top: 6px;
}
.legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 5px;
}
.c1 { background: var(--nui-accent); }
.c2 { background: #f0a020; }
.c3 { background: #18a058; }
.c4 { background: #d03050; }
.conn-head {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  padding: 10px 0 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
@media (max-width: 1200px) {
  .speed-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mon-panels { grid-template-columns: 1fr; }
  .conn-head { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
