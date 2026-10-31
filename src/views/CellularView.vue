<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NDataTable,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  AnalyticsOutline,
  CellularOutline,
  HardwareChipOutline,
  InformationCircleOutline,
  LockClosedOutline,
  RadioOutline,
  SpeedometerOutline,
  WarningOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import RingGauge from '@/components/RingGauge.vue'
import Sparkline from '@/components/Sparkline.vue'
import { useAsync, shortError, usePolling } from '@/composables/useAsync'
import { fmtAgo, fmtBytes, splitSpeed } from '@/utils/format'
import {
  cellCfgSet,
  cellLockSet,
  cellPinSet,
  cellSetRoaming,
  clearCellularCache,
  getCellAt,
  getCellData,
  getCellLock,
  getCellSim,
  getCellStatus,
  type CellAtBundle,
  type CellDataBundle,
  type CellLockBundle,
  type CellSimBundle,
  type CellStatusBundle,
  type CellularProbe,
} from '@/api/cellular'

/**
 * 蜂窝网络页（/cellular/*）
 *  - section: status / sim / lock / data / at（路由 props）
 *  - 本机（GL-MT3600BE）无蜂窝模组：所有 section 都必须能打开，并给出「为什么不可用」的真实证据；
 *    有模组时按 官方 modem.* → NUI 桥 cell.* 的优先级取数。
 */
const props = withDefaults(defineProps<{ section?: string }>(), { section: 'status' })
const message = useMessage()
const section = computed(() => props.section || 'status')

interface SectionData {
  status?: CellStatusBundle
  sim?: CellSimBundle
  lock?: CellLockBundle
  data?: CellDataBundle
  at?: CellAtBundle
}

const { data, loading, error, reload, lastAt } = useAsync<SectionData>(
  async () => {
    switch (section.value) {
      case 'sim':
        return { sim: await getCellSim() }
      case 'lock':
        return { lock: await getCellLock() }
      case 'data':
        return { data: await getCellData() }
      case 'at':
        return { at: await getCellAt() }
      default:
        return { status: await getCellStatus() }
    }
  },
  { watchSource: section },
)

/** 状态页 10 秒静默刷新；其它 section 不轮询（读接口没有副作用，但没必要打设备） */
usePolling(() => {
  if (section.value === 'status') void reload(true)
}, 10000)

const probe = computed<CellularProbe | null>(
  () =>
    data.value?.status?.probe ??
    data.value?.sim?.probe ??
    data.value?.lock?.probe ??
    data.value?.data?.probe ??
    data.value?.at?.probe ??
    null,
)
const status = computed(() => data.value?.status ?? null)
const simData = computed(() => data.value?.sim ?? null)
const lockData = computed(() => data.value?.lock ?? null)
const dataUsage = computed(() => data.value?.data ?? null)
const atData = computed(() => data.value?.at ?? null)

const pageError = computed(() => (data.value ? '' : error.value))
const noModemTitle = '未检测到蜂窝模组'
const noModemText = computed(() => {
  const reasons = probe.value?.reasons ?? []
  return reasons.length ? reasons[0] : '本机没有可用的蜂窝模组'
})

function refresh(force = false) {
  if (force) {
    clearCellularCache()
    message.success('已重新探测模组')
  }
  void reload()
}

/* ---------------- 通用展示 ---------------- */
const dash = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}
const jsonText = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
const toneType = (tone: 'ok' | 'warn' | 'err' | 'mute') =>
  tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : tone === 'err' ? 'error' : 'default'

const capsList = computed(() => {
  const s = probe.value?.supports
  if (!s) return []
  return [
    { label: 'SIM 卡', on: s.sim },
    { label: '短信', on: s.sms },
    { label: '锁频段', on: s.lockTower },
    { label: '锁运营商', on: s.lockCarrier },
    { label: '信号上报', on: s.signal },
    { label: '网络制式', on: s.networkType },
    { label: 'PIN 码', on: s.pin },
  ]
})

/* ---------------- 状态页 ---------------- */
const signal = computed(() => status.value?.signal ?? null)
const rsrpPct = computed(() => {
  const v = signal.value?.rsrp
  if (v === null || v === undefined) return 0
  return Math.max(0, Math.min(100, Math.round(((v + 140) / 60) * 100)))
})
const bars = computed(() => Array.from({ length: 5 }, (_, i) => i < (signal.value?.level ?? 0)))
const modemDetails = computed(() => {
  const mi = probe.value?.modemInfo ?? {}
  const dev = probe.value?.devices?.[0]
  const imei = Array.isArray(mi.imei)
    ? mi.imei
        .map((x: any) => (typeof x === 'string' ? x : x?.imei))
        .filter(Boolean)
        .join(', ')
    : dash(mi.imei)
  return {
    vendor: dash(mi.vendor) === '—' ? dash(dev?.vendor) : dash(mi.vendor),
    name: dash(mi.name),
    imei,
    version: dash(mi.version),
    bus: dash(probe.value?.bus),
    protocols: Array.isArray(mi.protocols) ? mi.protocols.join(', ') : dash(mi.protocols),
    atPort: dash((mi as any).at_port),
    dataPort: dash((mi as any).data_port),
    type: dash(mi.type),
    signalSupport: !!mi.signal_support,
  }
})
const simSnapshot = computed(() => status.value?.sim ?? null)
const rates = computed(() => status.value?.rates ?? { down: 0, up: 0 })
const downSplit = computed(() => splitSpeed(rates.value.down))
const upSplit = computed(() => splitSpeed(rates.value.up))
const towerRows = computed(() => {
  const t = status.value?.tower
  if (!t) return []
  const out: { k: string; v: string }[] = []
  const walk = (o: Record<string, any>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (v === null || v === undefined || v === '') continue
      if (typeof v === 'object' && !Array.isArray(v)) {
        walk(v as Record<string, any>, prefix ? `${prefix}.${k}` : k)
      } else if (Array.isArray(v)) {
        out.push({ k: prefix ? `${prefix}.${k}` : k, v: v.map((x) => String(x)).join(', ') })
      } else {
        out.push({ k: prefix ? `${prefix}.${k}` : k, v: String(v) })
      }
    }
  }
  walk(t as Record<string, any>, '')
  return out.slice(0, 14)
})
const operatorRows = computed(() => {
  const o = status.value?.operatorCfg
  if (!o) return []
  const out: { k: string; v: string }[] = []
  const walk = (obj: Record<string, any>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue
      if (typeof v === 'object' && !Array.isArray(v)) walk(v as Record<string, any>, prefix ? `${prefix}.${k}` : k)
      else out.push({ k: prefix ? `${prefix}.${k}` : k, v: Array.isArray(v) ? v.join(', ') : String(v) })
    }
  }
  walk(o as Record<string, any>, '')
  return out.slice(0, 14)
})

const capabilityRows = computed(() => {
  const p = probe.value
  const base = p ? '' : '探测失败'
  return [
    { name: '蜂窝状态 / 信号', ok: !!p?.available, reason: p?.available ? '可用' : base || '无模组' },
    { name: 'SIM 与 APN', ok: !!p?.available, reason: p?.supports.sim ? '有卡上报' : '无模组或未识别 SIM' },
    { name: '锁频 / 锁小区', ok: !!(p?.supports.lockTower || p?.supports.lockCarrier), reason: p?.supports.lockTower ? '模组支持' : '当前固件无 厂商 锁频模块（luci.nradio）' },
    { name: '流量统计', ok: !!p?.available, reason: p?.available ? '可用（官方累计值）' : '无模组' },
    { name: '短信', ok: !!p?.supports.sms, reason: p?.supports.sms ? '模组支持' : '无模组 / sms_support=false' },
    { name: 'AT 调试', ok: !!p?.available, reason: p?.available ? '可用（官方 send_at_command）' : '无模组 / 无 AT 口' },
  ]
})

/* ---------------- SIM / APN 页 ---------------- */
const simCfg = computed(() => simData.value?.config ?? null)
const simSlots = computed(() => (simData.value?.slots?.slots as Record<string, any>[] | undefined) ?? [])
const simSel = computed(() => simCfg.value?.sel ?? null)
const simCfgs = computed(() => (simCfg.value?.sims as Record<string, any>[] | undefined) ?? [])
const simHistory = computed(() => (simData.value?.slots?.history as Record<string, any>[] | undefined) ?? [])
const failoverRows = computed(() => {
  const fo = simData.value?.failover
  if (Array.isArray(fo)) return fo
  return []
})
const pinOk = computed(() => !!simData.value?.pin?.ok)
const pinInfo = computed(() => simData.value?.pin?.data ?? null)
const pinReason = computed(() => simData.value?.pin?.error || '')
const roaming = computed(() => !!simCfgs.value[0]?.roaming)
const pinValue = ref('')
const pinBusy = ref(false)
const roamBusy = ref(false)

const apnLabel: Record<string, string> = {
  apn: 'APN',
  name: '名称',
  profile: '配置名',
  auth: '认证',
  username: '用户名',
  ip_type: 'IP 类型',
  used: '使用中',
  active: '使用中',
  enable: '启用',
  pdp_type: 'PDP 类型',
}
const apnRows = computed<Record<string, any>[]>(() => (simData.value?.simConfig ?? []).map((x, i) => ({ key: i, ...x })))
const apnColumns = computed<DataTableColumns<Record<string, any>>>(() => {
  const keys: string[] = []
  for (const r of apnRows.value) {
    for (const k of Object.keys(r)) {
      if (k === 'key' || keys.includes(k)) continue
      const v = r[k]
      if (v === null || v === undefined || typeof v === 'object') continue
      keys.push(k)
    }
  }
  return keys.slice(0, 8).map((k) => ({
    title: apnLabel[k] || k,
    key: k,
    ellipsis: { tooltip: true },
    render: (row: Record<string, any>) => dash(row[k]),
  }))
})

async function unlockPin() {
  if (!pinOk.value) {
    message.warning(`PIN 管理不可用：${pinReason.value || '本机没有蜂窝模组/没有 厂商 PIN 模块'}`)
    return
  }
  if (!pinValue.value) {
    message.warning('请输入 PIN 码（4-8 位数字）')
    return
  }
  pinBusy.value = true
  try {
    await cellPinSet(pinValue.value)
    message.success('已向模组发送 PIN 解锁指令')
    pinValue.value = ''
    refresh()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    pinBusy.value = false
  }
}

async function toggleRoaming(v: boolean) {
  roamBusy.value = true
  try {
    await cellSetRoaming(v)
    message.success(v ? '已请求开启数据漫游' : '已请求关闭数据漫游')
    refresh()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    roamBusy.value = false
  }
}

/* ---------------- 锁频 / 锁小区 ---------------- */
const lockState = computed(() => lockData.value?.lock?.data ?? null)
const lockOk = computed(() => !!lockData.value?.lock?.ok)
const cfgState = computed(() => lockData.value?.cfg?.data ?? null)
const cfgOk = computed(() => !!lockData.value?.cfg?.ok)
const lockReason = computed(() => lockData.value?.lock?.error || '')
const cfgReason = computed(() => lockData.value?.cfg?.error || '')
const lockBusy = ref(false)
const cfgBusy = ref(false)

const freqOptions = computed(() => {
  const groups = (lockState.value?.groups as { kind: string; bands: number[] }[] | undefined) ?? []
  return groups.map((g) => ({
    kind: g.kind,
    label: g.kind.toUpperCase(),
    options: (g.bands ?? []).map((b) => ({ label: `B${b}`, value: b })),
  }))
})
const earfreqOptions = computed(() => {
  const s = lockState.value
  const out: { label: string; value: string }[] = []
  if (s?.lock_band) out.push({ label: '锁频段', value: 'band' })
  if (s?.one_mode) {
    if (s?.lte) out.push({ label: '4G 锁小区（EARFCN）', value: 'earfcn4' })
    if (s?.nr) out.push({ label: '5G 锁小区（NR-ARFCN）', value: 'earfcn5' })
  } else if (s?.nr || s?.lte) {
    out.push({ label: '不锁定（自动）', value: '' })
  }
  if (!out.length) out.push({ label: '不锁定（自动）', value: '' })
  return out
})
const mobilityOptions = [
  { label: '无偏好（默认）', value: '0' },
  { label: '智能模式', value: '2' },
  { label: '强制锁定', value: '1' },
]

const lockForm = ref({
  earfreq_mode: '',
  mobility: '0',
  freq: {} as Record<string, number[]>,
  cell4: { on: false, mode: '0', earfcn: '', pci: '', band: '' },
  cell5: { on: false, mode: '0', earfcn: '', pci: '', band: '' },
})

watch(lockState, (s) => {
  if (!s) return
  const freq: Record<string, number[]> = {}
  for (const g of (s.freq as { kind: string; bands: number[] }[] | undefined) ?? []) {
    freq[g.kind] = Array.isArray(g.bands) ? g.bands.map(Number) : []
  }
  const pickCell = (tag: '4' | '5') => {
    const c = (s as any)[`cell${tag}`] ?? {}
    return {
      on: !!c.on,
      mode: String(c.mode ?? '0'),
      earfcn: String(c.earfcn ?? ''),
      pci: String(c.pci ?? ''),
      band: String(c.band ?? ''),
    }
  }
  lockForm.value = {
    earfreq_mode: String(s.earfreq_mode ?? ''),
    mobility: String(s.mobility ?? '0'),
    freq,
    cell4: pickCell('4'),
    cell5: pickCell('5'),
  }
}, { immediate: true })

async function saveLock() {
  if (!lockOk.value) {
    message.warning(`锁频/锁小区不可用：${lockReason.value || '本机不支持'}。请改用原厂后台（本机无 厂商 锁频模块）`)
    return
  }
  lockBusy.value = true
  try {
    const freq = Object.entries(lockForm.value.freq)
      .filter(([, bands]) => Array.isArray(bands) && bands.length)
      .map(([kind, bands]) => ({ kind, bands }))
    await cellLockSet({
      earfreq_mode: lockForm.value.earfreq_mode,
      mobility: lockForm.value.mobility,
      freq,
      cell4: lockForm.value.cell4,
      cell5: lockForm.value.cell5,
    })
    message.success('锁频设置已提交（模组会重新注网）')
    refresh()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    lockBusy.value = false
  }
}

const cfgForm = ref({
  mode: 'auto',
  nrrc: true,
  roaming: false,
  r16: true,
  lte_fallback: false,
  ippass: false,
  compatible_nr: false,
  compatibility: false,
})
const cfgModeOptions = computed(() => {
  const modes = (cfgState.value?.modes as { value: string; label: string }[] | undefined) ?? []
  return modes.length ? modes : [{ label: '自动', value: 'auto' }]
})
watch(cfgState, (s) => {
  if (!s) return
  cfgForm.value = {
    mode: String(s.mode ?? 'auto'),
    nrrc: s.nrrc !== false,
    roaming: !!s.roaming,
    r16: s.r16 !== false,
    lte_fallback: !!s.lte_fallback,
    ippass: !!s.ippass,
    compatible_nr: !!s.compatible_nr,
    compatibility: !!s.compatibility,
  }
}, { immediate: true })

async function saveCfg() {
  if (!cfgOk.value) {
    message.warning(`网络模式设置不可用：${cfgReason.value || '本机不支持'}。该功能依赖 厂商专有模块 luci.nradio`)
    return
  }
  cfgBusy.value = true
  try {
    await cellCfgSet({ ...cfgForm.value })
    message.success('网络模式与参数已保存')
    refresh()
  } catch (e) {
    message.error(shortError(e))
  } finally {
    cfgBusy.value = false
  }
}

/* ---------------- 流量统计 ---------------- */
const trafficUsages = computed(() => dataUsage.value?.usages ?? [])
const trafficLimits = computed(() => dataUsage.value?.limits ?? [])
const clientTotals = computed(() => dataUsage.value?.clientTotals ?? null)
const rateSeries = ref<{ down: number[]; up: number[] }>({ down: [], up: [] })
const rateNow = computed(() => dataUsage.value?.rates ?? { down: 0, up: 0 })
const rateHistoryPoints = computed(() => dataUsage.value?.rateHistory?.points ?? [])

watch(
  () => section.value === 'data' && data.value?.data,
  (v) => {
    if (!v) return
    const pts = dataUsage.value?.rateHistory?.points ?? []
    if (pts.length) {
      rateSeries.value = {
        down: pts.slice(-60).map((p) => p[1]),
        up: pts.slice(-60).map((p) => p[2]),
      }
    }
  },
)

usePolling(async () => {
  if (section.value !== 'data' || document.hidden) return
  const { wanSpeed } = await import('@/api/cellular')
  const r = await wanSpeed().catch(() => null)
  if (!r) return
  rateSeries.value = {
    down: [...rateSeries.value.down, r.down].slice(-60),
    up: [...rateSeries.value.up, r.up].slice(-60),
  }
}, 3000)

const dataSourceRows = computed(() => {
  const d = dataUsage.value
  if (!d) return []
  return [
    { label: '实时速率', value: '官方 clients.get_wan_speed（WAN 口径）' },
    { label: '蜂窝累计流量', value: d.usages.length ? '官方 modem.get_traffic_config（每卡累计字节）' : `不可用：${d.trafficError || '无模组'}` },
    { label: '终端累计（兜底）', value: d.clientTotals ? `官方 clients.get_list · ${d.clientTotals.count} 台终端（非蜂窝口径）` : '无数据' },
    { label: '设备端速率历史', value: d.rateHistory ? `NUI 桥 sys.rate_history（${d.rateHistory.points.length} 个采样点，窗口 ${d.rateHistory.window}s）` : '桥不可用' },
    { label: '本月 / 当日拆分', value: '当前固件未提供按日/月统计的 RPC，只有每卡累计值，不做估算' },
  ]
})

/* ---------------- AT 调试 ---------------- */
const atBus = ref('')
const atSlot = ref<number | null>(1)
const atCmd = ref('AT+CGSN')
const atBusy = ref(false)
const atOutput = ref('')
const atResult = ref<Record<string, any> | null>(null)
watch(
  () => atData.value?.atResult,
  (v) => {
    atResult.value = v ?? null
  },
  { immediate: true },
)
const atResultText = computed(() => (atResult.value ? jsonText(atResult.value) : ''))
const atDevices = computed(() => probe.value?.devices ?? [])
const atBusOptions = computed(() => {
  const list = atDevices.value.map((d) => ({ label: d.bus + (d.name ? ` · ${d.name}` : ''), value: d.bus }))
  if (probe.value?.bus && !list.some((x) => x.value === probe.value?.bus)) {
    list.unshift({ label: probe.value.bus, value: probe.value.bus })
  }
  return list
})
watch(
  () => probe.value?.bus,
  (v) => {
    if (v) atBus.value = v
  },
  { immediate: true },
)
const atDebugText = computed(() => {
  const m = atData.value?.atMsgs
  if (!m) return ''
  return jsonText(m)
})
const atSendResult = computed(() => atOutput.value)

async function sendAt() {
  if (!probe.value?.available || !atBus.value) {
    message.warning('没有可用的模组总线：AT 命令需要真实蜂窝模组（bus），本机未检测到模组')
    return
  }
  if (!atCmd.value.trim()) {
    message.warning('请输入 AT 命令')
    return
  }
  atBusy.value = true
  atOutput.value = '发送中…'
  try {
    const { cellSendAt, getAtResult } = await import('@/api/cellular')
    const r = await cellSendAt(atBus.value, atCmd.value.trim(), Number(atSlot.value) || 1)
    atOutput.value = jsonText(r)
    // get_at_result 由模组管理进程异步写入，稍等再读
    await new Promise((resolve) => setTimeout(resolve, 800))
    atResult.value = await getAtResult(atBus.value, Number(atSlot.value) || 1).catch(() => null)
    message.success('AT 命令已执行')
  } catch (e) {
    atOutput.value = shortError(e)
    message.error(shortError(e))
  } finally {
    atBusy.value = false
  }
}

/* ---------------- 顶部动作 ---------------- */
const refreshText = computed(() => (lastAt.value ? `更新于 ${fmtAgo(lastAt.value)}` : '读取中…'))

const SIM_TITLE = 'SIM 与 APN'
const tableScroll = { x: 720 }

function columnTitle(k: string): string {
  return apnLabel[k] || k
}
const apnColumnsSafe = computed<DataTableColumns<Record<string, any>>>(() =>
  apnColumns.value.map((c: any) => ({ ...c, title: columnTitle(String(c.key)) })),
)
const bytesText = (v: number | null | undefined) => fmtBytes(v ?? 0)
const rateHistorySeries = computed(() => {
  const pts = rateHistoryPoints.value
  return [pts.map((p) => p[1]), pts.map((p) => p[2])]
})

/** 供模板里判断 AT 页能否操作 */
const atUsable = computed(() => !!probe.value?.available && atDevices.value.length > 0)
</script>

<template>
  <div class="nui-page">
    <PageState :loading="loading && !data" :error="pageError" :empty="!data" empty-text="没有读到蜂窝数据" @retry="refresh()">
      <template v-if="data">
        <!-- ======================= 状态 ======================= -->
        <div v-if="section === 'status' && status" class="nui-grid">
          <PanelCard
            v-if="!probe?.available"
            class="span-12"
            :title="noModemTitle"
            action="重新探测"
            @action="refresh(true)"
          >
            <template #icon><n-icon><WarningOutline /></n-icon></template>
            <n-alert type="warning" :bordered="false" title="本机的蜂窝相关功能不可用">
              <ul class="reason-list">
                <li v-for="(r, i) in probe?.reasons ?? []" :key="i">{{ r }}</li>
              </ul>
            </n-alert>

            <div class="nui-sec" style="margin-top: 14px">诊断证据（真机实测，非推测）</div>
            <div class="evidence">
              <div v-for="(e, i) in probe?.evidence ?? []" :key="i" class="ev-row">
                <span class="ev-label">{{ e.label }}</span>
                <n-tag size="small" :bordered="false" :type="toneType(e.tone)" class="nui-mono">{{ e.value }}</n-tag>
              </div>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              当前页面不会伪造任何信号/流量数据。插上 USB 蜂窝模组或使用内置蜂窝型号后，本页会自动切换为真实数据；
              也可以到 <a href="/gl_home.html#/internet" target="_blank" class="link">原厂后台 → 互联网</a> 查看官方蜂窝页。
            </p>
          </PanelCard>

          <PanelCard v-if="!probe?.available" class="span-6" title="本机蜂窝功能矩阵">
            <template #icon><n-icon><CellularOutline /></n-icon></template>
            <div v-for="c in capabilityRows" :key="c.name" class="cap-row">
              <span class="cap-name">{{ c.name }}</span>
              <n-tag size="small" :bordered="false" :type="c.ok ? 'success' : 'default'">
                {{ c.ok ? '可用' : '不可用' }}
              </n-tag>
              <span class="cap-reason nui-small nui-muted">{{ c.reason }}</span>
            </div>
          </PanelCard>

          <PanelCard v-if="!probe?.available" class="span-6" title="当前实际联网方式">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <dl class="nui-kv">
              <dt>设备型号</dt>
              <dd>{{ probe?.hardware?.model || '—' }}</dd>
              <dt>固件版本</dt>
              <dd>{{ probe?.hardware?.firmware || '—' }}</dd>
              <dt>内置模组</dt>
              <dd class="nui-mono">{{ probe?.hardware?.buildInModem || '(空：无内置蜂窝模组)' }}</dd>
              <dt>SIM 卡槽</dt>
              <dd class="nui-mono">{{ probe?.hardware?.slot || '—' }}</dd>
              <dt>当前上行接口</dt>
              <dd class="nui-mono">{{ probe?.hardware?.wanIface || '—' }}</dd>
              <dt>上行地址</dt>
              <dd class="nui-mono">{{ probe?.hardware?.wanIp || '—' }}</dd>
              <dt>实测速率</dt>
              <dd class="nui-mono">↓ {{ downSplit.value }} {{ downSplit.unit }} / ↑ {{ upSplit.value }} {{ upSplit.unit }}</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              MT3600BE 是纯路由型号（`hardware_feature.build_in_modem` 为空），当前通过
              {{ probe?.hardware?.wanIface || '非蜂窝接口' }} 上网；蜂窝相关页面只做能力说明，不显示假数据。
            </p>
          </PanelCard>

          <!-- 有模组时的状态展示 -->
          <template v-if="probe?.available">
            <PanelCard class="span-12" title="模组信息" action="刷新" @action="refresh(true)">
              <template #icon><n-icon><HardwareChipOutline /></n-icon></template>
              <template #extra>
                <div class="nui-row">
                  <n-tag size="small" type="success" :bordered="false">已检测到蜂窝模组</n-tag>
                  <span class="nui-small nui-muted">{{ refreshText }}</span>
                </div>
              </template>
              <div class="kv-grid">
                <dl class="nui-kv">
                  <dt>厂商</dt><dd>{{ modemDetails.vendor }}</dd>
                  <dt>型号</dt><dd>{{ modemDetails.name }}</dd>
                  <dt>IMEI</dt><dd class="nui-mono">{{ modemDetails.imei }}</dd>
                  <dt>固件</dt><dd class="nui-mono">{{ modemDetails.version }}</dd>
                </dl>
                <dl class="nui-kv">
                  <dt>总线</dt><dd class="nui-mono">{{ modemDetails.bus }}</dd>
                  <dt>协议</dt><dd class="nui-mono">{{ modemDetails.protocols }}</dd>
                  <dt>AT / 数据口</dt><dd class="nui-mono">{{ modemDetails.atPort }} / {{ modemDetails.dataPort }}</dd>
                  <dt>模组类型</dt><dd>{{ modemDetails.type }}</dd>
                </dl>
              </div>
              <div class="caps">
                <n-tag v-for="c in capsList" :key="c.label" size="small" :bordered="false" :type="c.on ? 'success' : 'default'">
                  {{ c.label }}{{ c.on ? '' : ' · 不支持' }}
                </n-tag>
              </div>
            </PanelCard>

            <PanelCard class="span-4" title="信号质量">
              <template #icon><n-icon><RadioOutline /></n-icon></template>
              <div class="signal">
                <RingGauge
                  :value="rsrpPct"
                  :size="120"
                  :text="signal?.rsrp != null ? String(signal.rsrp) : '—'"
                  label="RSRP dBm"
                />
                <div class="signal-side">
                  <div class="bars">
                    <i v-for="(on, i) in bars" :key="i" class="bar" :class="{ on }" />
                  </div>
                  <div class="nui-small nui-muted">信号 {{ signal?.level ?? 0 }}/5 格</div>
                  <n-tag size="small" :bordered="false" :type="signal?.registered ? 'success' : 'warning'">
                    {{ signal?.registered ? '已注网' : '未注网 / 未上报' }}
                  </n-tag>
                </div>
              </div>
              <dl class="nui-kv" style="margin-top: 12px">
                <dt>RSRQ</dt><dd class="nui-mono">{{ dash(signal?.rsrq) }} dB</dd>
                <dt>SINR</dt><dd class="nui-mono">{{ dash(signal?.sinr) }} dB</dd>
                <dt>RSSI</dt><dd class="nui-mono">{{ dash(signal?.rssi) }} dBm</dd>
                <dt>制式</dt><dd>{{ dash(signal?.tech) }}</dd>
                <dt>频段 / 带宽</dt><dd>{{ dash(signal?.band) }} · {{ dash(signal?.bandwidth) }}</dd>
              </dl>
              <p v-if="signal?.rsrp == null" class="nui-small nui-muted" style="margin: 8px 0 0">
                模组存在但未上报 RSRP（可能未插卡 / 未注网 / 信号能力未开启）。
              </p>
            </PanelCard>

            <PanelCard class="span-4" :title="SIM_TITLE">
              <template #icon><n-icon><CellularOutline /></n-icon></template>
              <dl class="nui-kv">
                <dt>卡状态</dt>
                <dd>
                  <n-tag size="small" :bordered="false" :type="simSnapshot?.present ? 'success' : 'warning'">
                    {{ simSnapshot?.present ? '已识别' : '未识别到 SIM' }}
                  </n-tag>
                </dd>
                <dt>运营商</dt><dd>{{ dash(simSnapshot?.operator) }}</dd>
                <dt>ICCID</dt><dd class="nui-mono">{{ dash(simSnapshot?.iccid) }}</dd>
                <dt>IMSI</dt><dd class="nui-mono">{{ dash(simSnapshot?.imsi) }}</dd>
                <dt>手机号</dt><dd class="nui-mono">{{ dash(simSnapshot?.number) }}</dd>
                <dt>卡槽</dt><dd>{{ dash(simSnapshot?.slot) }} · {{ dash(simSnapshot?.alias) }}</dd>
                <dt>数据漫游</dt><dd>{{ simSnapshot?.roaming ? '已开启' : '关闭' }}</dd>
              </dl>
              <router-link to="/cellular/sim" class="link nui-small">SIM 与 APN 设置 →</router-link>
            </PanelCard>

            <PanelCard class="span-4" title="注册网络与速率">
              <template #icon><n-icon><SpeedometerOutline /></n-icon></template>
              <dl class="nui-kv">
                <dt>网络制式</dt><dd>{{ dash(signal?.tech) }}</dd>
                <dt>载波</dt><dd>{{ dash(signal?.carrier) }}</dd>
                <dt>小区 ID</dt><dd class="nui-mono">{{ dash(signal?.cellId) }}</dd>
                <dt>PCI</dt><dd class="nui-mono">{{ dash(signal?.pci) }}</dd>
                <dt>EARFCN / ARFCN</dt><dd class="nui-mono">{{ dash(signal?.earfcn) }}</dd>
              </dl>
              <div class="rates">
                <div>
                  <span class="nui-small nui-muted">下载</span>
                  <div><span class="nui-mid">{{ downSplit.value }}</span><span class="nui-unit">{{ downSplit.unit }}</span></div>
                </div>
                <div>
                  <span class="nui-small nui-muted">上传</span>
                  <div><span class="nui-mid">{{ upSplit.value }}</span><span class="nui-unit">{{ upSplit.unit }}</span></div>
                </div>
              </div>
              <router-link to="/cellular/data" class="link nui-small">流量统计 →</router-link>
            </PanelCard>

            <PanelCard class="span-6" title="小区与运营商上报">
              <template #icon><n-icon><AnalyticsOutline /></n-icon></template>
              <div class="nui-sec">modem.get_cell_tower</div>
              <div v-if="towerRows.length" class="raw-grid">
                <span v-for="r in towerRows" :key="r.k" class="raw-k nui-small">{{ r.k }}</span>
                <span v-for="r in towerRows" :key="r.k + 'v'" class="raw-v nui-small nui-mono">{{ r.v }}</span>
              </div>
              <n-alert v-else type="default" :bordered="false" class="nui-small">
                模组未返回小区信息（get_cell_tower 为空；通常需要当前卡已注网）。
              </n-alert>
              <div class="nui-sec" style="margin-top: 14px">modem.get_operator_config</div>
              <div v-if="operatorRows.length" class="raw-grid">
                <span v-for="r in operatorRows" :key="r.k" class="raw-k nui-small">{{ r.k }}</span>
                <span v-for="r in operatorRows" :key="r.k + 'v'" class="raw-v nui-small nui-mono">{{ r.v }}</span>
              </div>
              <n-alert v-else type="default" :bordered="false" class="nui-small">运营商配置为空。</n-alert>
            </PanelCard>

            <PanelCard class="span-6" title="数据来源与降级说明">
              <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
              <div class="nui-sec">本页数据来源</div>
              <ul class="reason-list">
                <li v-for="s in status?.sources ?? []" :key="s">{{ s }}</li>
                <li v-if="!(status?.sources ?? []).length">无数据源（所有接口都为空）</li>
              </ul>
              <div class="nui-sec" style="margin-top: 14px">优先级</div>
              <p class="nui-small nui-muted" style="margin: 0">
                官方 modem.* → NUI 桥 cell.* → ubus cellular.*（RPC 未暴露，前端不直接调用）。
                信号字段兼容三种固件结构（network_status / networkStatus / network_info），取不到就显示「未上报」，不做估算。
              </p>
              <div class="evidence" style="margin-top: 10px">
                <div v-for="(e, i) in probe?.evidence ?? []" :key="i" class="ev-row">
                  <span class="ev-label">{{ e.label }}</span>
                  <span class="ev-value nui-small nui-mono">{{ e.value }}</span>
                </div>
              </div>
            </PanelCard>
          </template>
        </div>

        <!-- ======================= SIM / APN ======================= -->
        <div v-if="section === 'sim' && simData" class="nui-grid">
          <PanelCard v-if="!probe?.available" class="span-12" title="SIM / APN 不可用" action="重新探测" @action="refresh(true)">
            <template #icon><n-icon><WarningOutline /></n-icon></template>
            <n-alert type="warning" :bordered="false" title="未检测到蜂窝模组">
              <ul class="reason-list">
                <li v-for="(r, i) in probe?.reasons ?? []" :key="i">{{ r }}</li>
              </ul>
            </n-alert>
            <div class="cap-row" style="margin-top: 10px">
              <span class="cap-name">官方 modem.get_sim_config</span>
              <n-tag size="small" :bordered="false" :type="simData.simConfig ? 'success' : 'default'">
                {{ simData.simConfig ? '有返回' : '无数据/报错' }}
              </n-tag>
              <span class="cap-reason nui-small nui-muted">需要真实模组总线（bus）</span>
            </div>
          </PanelCard>

          <PanelCard class="span-5" title="SIM 卡槽">
            <template #icon><n-icon><CellularOutline /></n-icon></template>
            <div v-if="simSlots.length" class="slot-list">
              <div v-for="s in simSlots" :key="s.index" class="slot-item" :class="{ cur: s.current }">
                <div class="nui-between">
                  <strong>{{ s.alias || `卡槽 ${s.index}` }}</strong>
                  <n-tag size="small" :bordered="false" :type="s.current ? 'success' : 'default'">
                    {{ s.current ? '当前使用' : '备用' }}
                  </n-tag>
                </div>
                <dl class="nui-kv">
                  <dt>ICCID</dt><dd class="nui-mono">{{ dash(s.iccid) }}</dd>
                  <dt>IMSI</dt><dd class="nui-mono">{{ dash(s.imsi) }}</dd>
                  <dt>运营商</dt><dd>{{ dash(s.operator) }}</dd>
                  <dt>手机号</dt><dd class="nui-mono">{{ dash(s.number) }}</dd>
                  <dt>就绪</dt><dd>{{ s.ready ? '是' : '否' }} · 来源 {{ dash(s.source) }}</dd>
                </dl>
              </div>
            </div>
            <PageState v-else compact empty empty-text="桥 cell.slots 没有卡槽数据（本机无模组 / 无 厂商 卡槽配置）" />
            <dl class="nui-kv" style="margin-top: 12px">
              <dt>切卡方式</dt>
              <dd>{{ simSel?.mode === '1' ? '手动指定' : '自动切卡' }} · 槽位 {{ dash(simSel?.cur) }}/{{ dash(simSel?.max) }}</dd>
              <dt>高级 SIM</dt><dd>{{ simSel?.adv_sim ? '启用' : '关闭' }}</dd>
            </dl>
            <n-alert type="default" :bordered="false" class="nui-small" style="margin-top: 10px">
              本机固件没有 mvas.switch_sim_slot RPC 可用（`mvas` 对象不存在），切卡按钮不做假动作；
              官方后台的切卡依赖同一接口，本机同样不可用。
            </n-alert>
          </PanelCard>

          <PanelCard class="span-7" title="APN 配置">
            <template #icon><n-icon><RadioOutline /></n-icon></template>
            <n-data-table
              v-if="apnRows.length"
              size="small"
              :columns="apnColumnsSafe"
              :data="apnRows"
              :bordered="false"
              :scroll-x="tableScroll.x"
              :pagination="false"
            />
            <PageState v-else compact empty empty-text="官方 modem.get_sim_config 未返回 APN 列表（本机无模组，或当前卡未识别）" />
            <div v-if="simCfgs.length" class="nui-sec" style="margin-top: 14px">桥 cell.config（厂商 卡配置）</div>
            <dl v-if="simCfgs.length" class="nui-kv">
              <dt>配置名</dt><dd>{{ dash(simCfgs[0]?.alias) }}</dd>
              <dt>APN 覆盖</dt><dd class="nui-mono">{{ dash(simCfgs[0]?.apn_cfg) }}</dd>
              <dt>制式偏好</dt><dd>{{ dash(simCfgs[0]?.mode) }}</dd>
              <dt>NR 载波</dt><dd>{{ simCfgs[0]?.nrrc ? '启用' : '关闭' }}</dd>
              <dt>强制 IMS</dt><dd>{{ simCfgs[0]?.force_ims ? '是' : '否' }}</dd>
            </dl>
            <div class="nui-sec" style="margin-top: 14px">识别过的卡（桥 cell.slots.history）</div>
            <div v-if="simHistory.length" class="nui-small">
              <div v-for="(h, i) in simHistory" :key="i" class="nui-list-row">
                <span class="nui-mono">{{ dash(h.iccid) }}</span>
                <n-tag size="tiny" :bordered="false" type="default">{{ dash(h.operator) }}</n-tag>
                <span class="nui-muted">卡槽 {{ dash(h.slot) }}</span>
              </div>
            </div>
            <span v-else class="nui-small nui-muted">无历史记录。</span>
          </PanelCard>

          <PanelCard class="span-6" title="双卡策略 / 卡槽优先级">
            <template #icon><n-icon><AnalyticsOutline /></n-icon></template>
            <div v-if="failoverRows.length">
              <div v-for="(f, i) in failoverRows" :key="i" class="nui-list-row nui-small">
                <span class="nui-mono">{{ jsonText(f) }}</span>
              </div>
            </div>
            <PageState v-else compact empty empty-text="modem.get_slot_failover_config 返回空（本机无模组）" />
            <dl class="nui-kv" style="margin-top: 10px">
              <dt>当前槽位</dt><dd>{{ dash(simSel?.cur) }}</dd>
              <dt>最大槽位</dt><dd>{{ dash(simSel?.max) }}</dd>
              <dt>策略模式</dt><dd>{{ simSel?.mode === '1' ? '手动' : '自动' }}</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              双卡策略由固件内部管理（modem_config_file.slot_multi_priority 等），本机返回空数组。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="PIN 码与漫游">
            <template #icon><n-icon><LockClosedOutline /></n-icon></template>
            <div v-if="pinOk">
              <dl class="nui-kv">
                <dt>PIN 状态</dt><dd>{{ pinInfo?.need_pin ? '需要 PIN 码' : '无需 PIN' }}（state {{ dash(pinInfo?.state) }}）</dd>
                <dt>解锁方式</dt><dd>{{ pinInfo?.manual ? '手动' : '自动' }}</dd>
              </dl>
            </div>
            <n-alert v-else type="warning" :bordered="false" :title="pinReason || 'PIN 管理不可用'">
              <span class="nui-small">
                PIN 管理走桥 cell.pin_get/cell.pin_set，依赖 厂商 的 cpetools.sh 与 AT 口；本机 GL 4.9 没有
                厂商专有模块 luci.nradio，也没有模组，所以这里只能展示状态说明。
              </span>
            </n-alert>
            <div class="nui-row" style="margin-top: 8px">
              <n-input v-model:value="pinValue" type="password" placeholder="PIN 码（4-8 位数字）" style="max-width: 220px" />
              <n-button size="small" type="primary" :loading="pinBusy" @click="unlockPin">解锁</n-button>
            </div>

            <div class="nui-sec" style="margin-top: 14px">数据漫游</div>
            <div class="nui-row">
              <n-switch :value="roaming" :loading="roamBusy" :disabled="!probe?.available" @update:value="toggleRoaming" />
              <span class="nui-small nui-muted">{{ roaming ? '已开启数据漫游' : '关闭数据漫游' }}</span>
            </div>
            <p class="nui-small nui-muted" style="margin: 8px 0 0">
              漫游开关写桥 cell.cfg_set（厂商 uci cpecfg）。本机无模组/无 厂商 → 切换会返回明确错误。
            </p>
            <div class="nui-sec" style="margin-top: 14px">备注</div>
            <ul class="reason-list">
              <li v-for="(n, i) in simData.notes" :key="i">{{ n }}</li>
            </ul>
          </PanelCard>
        </div>

        <!-- ======================= 锁频 / 锁小区 ======================= -->
        <div v-if="section === 'lock' && lockData" class="nui-grid">
          <PanelCard class="span-12" :title="lockOk ? '频段 / 小区锁定' : '锁频 / 锁小区（本机不可用，UI 预览）'" action="重新探测" @action="refresh(true)">
            <template #icon><n-icon><LockClosedOutline /></n-icon></template>
            <n-alert v-if="!lockOk" type="warning" :bordered="false" title="锁频/锁小区接口不可用">
              <div class="reason">{{ lockReason || '桥 cell.lock_get 调用失败' }}</div>
              <ul class="reason-list">
                <li v-for="(n, i) in lockData.notes" :key="i">{{ n }}</li>
                <li>该功能依赖 原厂固件的 cpetools.sh + cpecfg uci + luci.nradio（本机 GL 4.9 均不具备）</li>
              </ul>
            </n-alert>
            <div v-if="!lockOk" class="evidence" style="margin-top: 12px">
              <div v-for="(e, i) in probe?.evidence ?? []" :key="i" class="ev-row">
                <span class="ev-label">{{ e.label }}</span>
                <n-tag
                  size="small"
                  :bordered="false"
                  :type="e.tone === 'ok' ? 'success' : e.tone === 'warn' ? 'warning' : e.tone === 'err' ? 'error' : 'default'"
                  class="nui-mono"
                >
                  {{ e.value }}
                </n-tag>
              </div>
            </div>
            <div v-else class="nui-row nui-wrap">
              <n-tag size="small" :bordered="false" type="success">接口可用</n-tag>
              <n-tag size="small" :bordered="false">iface {{ dash(lockState?.iface) }}</n-tag>
              <n-tag size="small" :bordered="false">SIM {{ dash(lockState?.sim) }}</n-tag>
              <n-tag size="small" :bordered="false">锁频段 {{ lockState?.lock_band ? '支持' : '不支持' }}</n-tag>
              <n-tag size="small" :bordered="false">锁小区 {{ lockState?.one_mode ? '支持' : '不支持' }}</n-tag>
              <n-tag size="small" :bordered="false">多频段 {{ lockState?.multi ? '支持' : '单频段' }}</n-tag>
            </div>
          </PanelCard>

          <PanelCard class="span-6" title="锁定方式与策略">
            <n-form-item label="锁频策略（mobility）" :show-feedback="false">
              <n-select v-model:value="lockForm.mobility" :options="mobilityOptions" :disabled="!lockOk" size="small" />
            </n-form-item>
            <n-form-item label="锁定方式（earfreq_mode）" :show-feedback="false">
              <n-select v-model:value="lockForm.earfreq_mode" :options="earfreqOptions" :disabled="!lockOk" size="small" />
            </n-form-item>
            <p class="nui-small nui-muted" style="margin: 0">
              智能模式/强制锁定与「锁频段 / 4G 锁小区 / 5G 锁小区」的可用项由模组能力决定；
              这里按 cell.lock_get 返回的 groups/nr/lte 动态生成，没有硬编码。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="频段选择">
            <n-form-item v-for="g in freqOptions" :key="g.kind" :label="g.label + ' 频段'" :show-feedback="false">
              <n-select
                v-model:value="lockForm.freq[g.kind]"
                multiple
                :options="g.options"
                :disabled="!lockOk || lockForm.earfreq_mode !== 'band'"
                placeholder="不选 = 不锁频段"
                size="small"
              />
            </n-form-item>
            <PageState v-if="!freqOptions.length" compact empty empty-text="模组没有上报可锁频段（lock_get.groups 为空）" />
          </PanelCard>

          <PanelCard class="span-6" title="4G 小区锁定（EARFCN）">
            <n-form-item label="启用" :show-feedback="false">
              <n-switch v-model:value="lockForm.cell4.on" :disabled="!lockOk" />
            </n-form-item>
            <n-form-item label="锁定模式（0=按频段 1=扫描锁定）" :show-feedback="false">
              <n-select
                v-model:value="lockForm.cell4.mode"
                :options="[{ label: '按频段', value: '0' }, { label: '扫描锁定', value: '1' }]"
                size="small"
                :disabled="!lockOk"
              />
            </n-form-item>
            <n-form-item label="EARFCN / PCI / 频段" :show-feedback="false">
              <div class="nui-row">
                <n-input v-model:value="lockForm.cell4.earfcn" placeholder="EARFCN" :disabled="!lockOk" size="small" />
                <n-input v-model:value="lockForm.cell4.pci" placeholder="PCI" :disabled="!lockOk" size="small" />
                <n-input v-model:value="lockForm.cell4.band" placeholder="Band" :disabled="!lockOk" size="small" />
              </div>
            </n-form-item>
          </PanelCard>

          <PanelCard class="span-6" title="5G 小区锁定（NR-ARFCN）">
            <n-form-item label="启用" :show-feedback="false">
              <n-switch v-model:value="lockForm.cell5.on" :disabled="!lockOk" />
            </n-form-item>
            <n-form-item label="锁定模式" :show-feedback="false">
              <n-select
                v-model:value="lockForm.cell5.mode"
                :options="[{ label: '按频段', value: '0' }, { label: '扫描锁定', value: '1' }]"
                size="small"
                :disabled="!lockOk"
              />
            </n-form-item>
            <n-form-item label="NR-ARFCN / PCI / 频段" :show-feedback="false">
              <div class="nui-row">
                <n-input v-model:value="lockForm.cell5.earfcn" placeholder="NR-ARFCN" :disabled="!lockOk" size="small" />
                <n-input v-model:value="lockForm.cell5.pci" placeholder="PCI" :disabled="!lockOk" size="small" />
                <n-input v-model:value="lockForm.cell5.band" placeholder="Band" :disabled="!lockOk" size="small" />
              </div>
            </n-form-item>
          </PanelCard>

          <PanelCard class="span-12" title="网络模式与参数">
            <template #icon><n-icon><RadioOutline /></n-icon></template>
            <n-alert v-if="!cfgOk" type="warning" :bordered="false" title="网络模式接口不可用">
              {{ cfgReason || '桥 cell.cfg_get 调用失败' }}
            </n-alert>
            <div class="nui-grid inner">
              <n-form-item label="网络制式" :show-feedback="false">
                <n-select v-model:value="cfgForm.mode" :options="cfgModeOptions" :disabled="!cfgOk" size="small" />
              </n-form-item>
              <n-form-item label="NR 载波聚合" :show-feedback="false">
                <n-switch v-model:value="cfgForm.nrrc" :disabled="!cfgOk" />
              </n-form-item>
              <n-form-item label="数据漫游" :show-feedback="false">
                <n-switch v-model:value="cfgForm.roaming" :disabled="!cfgOk" />
              </n-form-item>
              <n-form-item label="R16 回落" :show-feedback="false">
                <n-switch v-model:value="cfgForm.r16" :disabled="!cfgOk" />
              </n-form-item>
              <n-form-item label="智能回落 LTE" :show-feedback="false">
                <n-switch v-model:value="cfgForm.lte_fallback" :disabled="!cfgOk" />
              </n-form-item>
              <n-form-item label="IP 透传" :show-feedback="false">
                <n-switch v-model:value="cfgForm.ippass" :disabled="!cfgOk" />
              </n-form-item>
              <n-form-item label="5G 兼容性（compatible_nr）" :show-feedback="false">
                <n-switch v-model:value="cfgForm.compatible_nr" :disabled="!cfgOk" />
              </n-form-item>
              <n-form-item label="n79 兼容" :show-feedback="false">
                <n-switch v-model:value="cfgForm.compatibility" :disabled="!cfgOk" />
              </n-form-item>
            </div>
            <div class="save-row">
              <n-button type="primary" :loading="lockBusy" @click="saveLock">保存锁频设置</n-button>
              <n-button :loading="cfgBusy" @click="saveCfg">保存网络模式</n-button>
              <span class="nui-small nui-muted">保存后模组会重新注网，可能短暂断网 10-60 秒。</span>
            </div>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              本机（{{ probe?.hardware?.model || 'GL-MT3600BE' }}）无蜂窝模组且缺 厂商专有模块：
              表单按返回结构渲染，保存时会得到明确错误，不会静默失败、也不会伪造成功。
            </p>
          </PanelCard>
        </div>

        <!-- ======================= 流量统计 ======================= -->
        <div v-if="section === 'data' && dataUsage" class="nui-grid">
          <PanelCard v-if="!probe?.available" class="span-12" title="蜂窝流量不可用" action="重新探测" @action="refresh(true)">
            <template #icon><n-icon><WarningOutline /></n-icon></template>
            <n-alert type="warning" :bordered="false" title="未检测到蜂窝模组">
              <div class="reason">{{ noModemText }}</div>
              <p class="nui-small" style="margin: 6px 0 0">
                官方 modem.get_traffic_config 需要 bus 参数，本机返回：{{ dataUsage.trafficError || '无数据' }}。
                下面的「实时速率 / 终端累计」是真实可用的兜底数据，已标明来源，不与蜂窝流量混淆。
              </p>
            </n-alert>
          </PanelCard>

          <PanelCard class="span-6" title="实时速率（WAN 口径）">
            <template #icon><n-icon><SpeedometerOutline /></n-icon></template>
            <div class="rates big">
              <div>
                <span class="nui-small nui-muted">下载</span>
                <div><span class="nui-big">{{ splitSpeed(rateNow.down).value }}</span><span class="nui-unit">{{ splitSpeed(rateNow.down).unit }}</span></div>
              </div>
              <div>
                <span class="nui-small nui-muted">上传</span>
                <div><span class="nui-big">{{ splitSpeed(rateNow.up).value }}</span><span class="nui-unit">{{ splitSpeed(rateNow.up).unit }}</span></div>
              </div>
            </div>
            <Sparkline :series="[rateSeries.down, rateSeries.up]" :colors="['#2080f0', '#18a058']" :height="120" />
            <div class="legend nui-small nui-muted">
              <span><i class="dot-down" /> 下行</span>
              <span><i class="dot-up" /> 上行</span>
              <span class="nui-right">来源：clients.get_wan_speed，页面本地滑动窗口</span>
            </div>
          </PanelCard>

          <PanelCard class="span-6" title="每卡累计流量（官方）">
            <template #icon><n-icon><AnalyticsOutline /></n-icon></template>
            <div v-if="trafficUsages.length" class="usage-list">
              <div v-for="(u, i) in trafficUsages" :key="i" class="usage-item">
                <div class="nui-between">
                  <span>{{ u.label }}</span>
                  <strong class="nui-mono">{{ bytesText(u.total) }}</strong>
                </div>
                <div v-for="(l, j) in trafficLimits.filter((x) => x.slot === u.slot)" :key="j" class="nui-small nui-muted">
                  限额：{{ l.enable ? `${l.threshold} ${l.unit} / ${l.reset || 'month'}` : '未启用' }}
                </div>
              </div>
            </div>
            <PageState
              v-else
              compact
              empty
              :empty-text="`官方 modem.get_traffic_config 无数据：${dataUsage.trafficError || '无模组'}。固件只提供每卡累计值，没有按月/当日拆分接口。`"
            />
            <div v-if="trafficLimits.length" class="nui-sec" style="margin-top: 12px">流量限额</div>
            <dl v-if="trafficLimits.length" class="nui-kv">
              <template v-for="(l, i) in trafficLimits" :key="i">
                <dt>卡槽 {{ dash(l.slot) }} · {{ l.type }}</dt>
                <dd>{{ l.enable ? `${l.threshold} ${l.unit}（${l.reset || 'month'}）` : '未启用' }}</dd>
              </template>
            </dl>
          </PanelCard>

          <PanelCard class="span-6" title="兜底：终端累计流量（非蜂窝口径）">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <dl v-if="clientTotals" class="nui-kv">
              <dt>终端数</dt><dd>{{ clientTotals.count }} 台</dd>
              <dt>累计上传</dt><dd class="nui-mono">{{ bytesText(clientTotals.tx) }}</dd>
              <dt>累计下载</dt><dd class="nui-mono">{{ bytesText(clientTotals.rx) }}</dd>
            </dl>
            <PageState v-else compact empty empty-text="clients.get_list 无数据" />
            <div v-if="dataUsage.byIface.length" class="nui-sec" style="margin-top: 12px">按接入方式</div>
            <dl v-if="dataUsage.byIface.length" class="nui-kv">
              <template v-for="b in dataUsage.byIface" :key="b.iface">
                <dt>{{ b.iface }}</dt>
                <dd class="nui-mono">↓ {{ bytesText(b.rx) }} / ↑ {{ bytesText(b.tx) }}</dd>
              </template>
            </dl>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              这是 LAN 终端累计（clients.get_list），不是蜂窝模组自己的流量；只在没有模组流量接口时兜底展示，并明确标注来源。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="设备端速率历史（sys.rate_history）">
            <template #icon><n-icon><AnalyticsOutline /></n-icon></template>
            <template v-if="rateHistoryPoints.length">
              <Sparkline :series="rateHistorySeries" :colors="['#2080f0', '#18a058']" :height="120" />
              <div class="legend nui-small nui-muted">
                <span>{{ rateHistoryPoints.length }} 个采样点 · 窗口 {{ dataUsage.rateHistory?.window }}s · 间隔 {{ dataUsage.rateHistory?.interval }}s</span>
                <span class="nui-right">NUI 桥 sys.rate_history</span>
              </div>
            </template>
            <PageState
              v-else
              compact
              empty
              empty-text="设备端速率历史为空：nui-monitor 服务未运行（/tmp/nui-rates.json 无数据）。页面用本地采样兜底，不补造历史。"
            />
          </PanelCard>

          <PanelCard class="span-12" title="数据来源与口径说明">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <div v-for="(r, i) in dataSourceRows" :key="i" class="ev-row">
              <span class="ev-label">{{ r.label }}</span>
              <span class="ev-value nui-small nui-mono">{{ r.value }}</span>
            </div>
            <div class="nui-sec" style="margin-top: 12px">数据源清单</div>
            <ul class="reason-list">
              <li v-for="s in dataUsage.sources" :key="s">{{ s }}</li>
              <li v-if="!dataUsage.sources.length">无可用数据源</li>
            </ul>
          </PanelCard>
        </div>

        <!-- ======================= AT 调试 ======================= -->
        <div v-if="section === 'at' && atData" class="nui-grid">
          <PanelCard v-if="!probe?.available" class="span-12" title="AT 调试不可用" action="重新探测" @action="refresh(true)">
            <template #icon><n-icon><WarningOutline /></n-icon></template>
            <n-alert type="warning" :bordered="false" title="未检测到蜂窝模组">
              <div class="reason">{{ noModemText }}</div>
              <p class="nui-small" style="margin: 6px 0 0">
                AT 命令需要真实模组总线（modem_info.devices）与 AT 口；本机
                devices={{ atDevices.length }}、interfaces={{ atData.interfaces.length }}，
                所以只展示 AT 调试的接口与用法，不提供「假执行」。
              </p>
            </n-alert>
          </PanelCard>

          <PanelCard class="span-5" title="模组与总线">
            <template #icon><n-icon><HardwareChipOutline /></n-icon></template>
            <dl class="nui-kv">
              <dt>检测到的模组</dt><dd>{{ atDevices.length }} 个</dd>
              <dt>总线</dt>
              <dd class="nui-mono">{{ atDevices.length ? atDevices.map((d) => d.bus).join(', ') : '—' }}</dd>
              <dt>AT 口</dt><dd class="nui-mono">{{ dash((probe?.modemInfo as any)?.at_port) }}</dd>
              <dt>数据口</dt><dd class="nui-mono">{{ dash((probe?.modemInfo as any)?.data_port) }}</dd>
              <dt>IMEI（桥 at.devinfo_get）</dt>
              <dd class="nui-mono">{{ atData.atInfo.ok ? dash(atData.atInfo.data?.imei) : '不可用' }}</dd>
              <dt>IMEI 备份</dt>
              <dd class="nui-mono">{{ atData.atInfo.ok ? dash(atData.atInfo.data?.backup) : '—' }}</dd>
            </dl>
            <div class="nui-sec" style="margin-top: 12px">蜂窝数据接口</div>
            <div v-if="atData.interfaces.length">
              <div v-for="(it, i) in atData.interfaces" :key="i" class="nui-small nui-mono">{{ jsonText(it) }}</div>
            </div>
            <span v-else class="nui-small nui-muted">modem.get_modem_current_interface.interfaces = []</span>
            <ul class="reason-list" style="margin-top: 10px">
              <li v-for="(n, i) in atData.notes" :key="i">{{ n }}</li>
            </ul>
          </PanelCard>

          <PanelCard class="span-7" title="at_debug_msgs（模组管理日志）">
            <template #icon><n-icon><DocumentTextOutline /></n-icon></template>
            <pre v-if="atDebugText" class="raw">{{ atDebugText }}</pre>
            <PageState v-else compact empty empty-text="modem.get_debug_msg 未返回 at_debug_msgs（本机无模组时固件返回 ret:2 Invalid parameter）" />
          </PanelCard>

          <PanelCard class="span-12" title="发送 AT 命令（写操作，高风险）">
            <template #icon><n-icon><RadioOutline /></n-icon></template>
            <n-alert type="warning" :bordered="false" style="margin-bottom: 12px">
              AT 命令直通模组，错误的指令可能导致掉网甚至模组需要重启恢复。本页只在你确认风险后发送，
              不会自动执行；无模组时点击会给出明确错误（不会伪造执行结果）。
            </n-alert>
            <div class="at-form">
              <n-form-item label="模组总线" :show-feedback="false">
                <n-select v-model:value="atBus" :options="atBusOptions" :disabled="!atUsable" placeholder="无可用总线" size="small" />
              </n-form-item>
              <n-form-item label="SIM 槽位" :show-feedback="false">
                <n-input-number v-model:value="atSlot" :min="1" :max="8" :disabled="!atUsable" size="small" style="width: 110px" />
              </n-form-item>
              <n-form-item label="命令" :show-feedback="false">
                <n-input v-model:value="atCmd" placeholder="AT+CGSN" :disabled="!atUsable" size="small" />
              </n-form-item>
              <n-button type="primary" :loading="atBusy" @click="sendAt">发送</n-button>
            </div>
            <pre v-if="atSendResult" class="raw" style="margin-top: 12px">{{ atSendResult }}</pre>
            <template v-if="atResultText">
              <div class="nui-sec" style="margin-top: 14px">modem.get_at_result（最近一次 AT 交互）</div>
              <pre class="raw">{{ atResultText }}</pre>
            </template>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              有模组时本页调用官方 <code>modem.send_at_command</code>（真写，超时 120s）并读 <code>modem.get_at_result</code>；
              无模组时按钮给出原因。
            </p>
          </PanelCard>

          <PanelCard class="span-12" title="gl_modem / AT 用法提示">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <p class="nui-small" style="margin: 0 0 8px">
              官方后台的 AT 调试能力来自 <code>/usr/bin/gl_modem</code>（设备端命令行），前台 RPC 只有
              <code>modem.send_at_command</code>。没有 RPC 能力时可在 SSH（root）里用：
            </p>
            <pre class="raw hint">gl_modem -B &lt;bus&gt; -U &lt;slot&gt; AT AT+CGSN        # 读 IMEI
gl_modem -B &lt;bus&gt; -U &lt;slot&gt; AT AT+CPIN?       # PIN 状态
gl_modem -B &lt;bus&gt; -U &lt;slot&gt; AT AT+CSQ         # 信号强度
gl_modem -B &lt;bus&gt; -U &lt;slot&gt; AT AT^PHYNUM?     # 模组串号
cpetools.sh -c iccid -i cpe                   # 读 ICCID（厂商 专有，本机没有）</pre>
            <p class="nui-small nui-muted" style="margin: 8px 0 0">
              `cpetools.sh` / `cpecfg` / `cpesel` 是 原厂固件专有；GL 4.9 只有 modem.so + gl_modem。
              本机无蜂窝模组，以上命令都会报 "No modem found for bus"（日志可证）。
            </p>
          </PanelCard>
        </div>
      </template>
    </PageState>
  </div>
</template>

<style scoped>
.link {
  color: var(--nui-accent);
  cursor: pointer;
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.reason {
  font-size: 13px;
  margin-bottom: 6px;
}
.reason-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.9;
  opacity: 0.78;
}
.evidence {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ev-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12.5px;
}
.ev-label {
  min-width: 220px;
  opacity: 0.6;
  flex: none;
}
.ev-value {
  word-break: break-all;
}
.cap-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
}
.cap-row + .cap-row {
  border-top: 1px dashed var(--line-dash);
}
.cap-name {
  width: 180px;
  flex: none;
}
.cap-reason {
  margin-left: auto;
  text-align: right;
}
.kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 28px;
}
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.signal {
  display: flex;
  align-items: center;
  gap: 18px;
}
.signal-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 26px;
}
.bar {
  width: 7px;
  border-radius: 2px;
  background: var(--line-dash);
}
.bar:nth-child(1) { height: 30%; }
.bar:nth-child(2) { height: 45%; }
.bar:nth-child(3) { height: 62%; }
.bar:nth-child(4) { height: 80%; }
.bar:nth-child(5) { height: 100%; }
.bar.on {
  background: var(--nui-accent);
}
.rates {
  display: flex;
  gap: 28px;
  margin-top: 12px;
}
.rates.big {
  margin: 6px 0 10px;
}
.legend {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 6px;
}
.legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 5px;
}
.dot-down { background: var(--nui-accent); }
.dot-up { background: #18a058; }
.slot-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slot-item {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.07);
  border: 1px solid transparent;
}
.slot-item.cur {
  border-color: rgba(32, 128, 240, 0.4);
}
.usage-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.usage-item {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.07);
}
.save-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.raw {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  font-size: 12px;
  line-height: 1.6;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.raw.hint {
  max-height: none;
}
.raw-grid {
  display: grid;
  grid-template-columns: minmax(120px, 40%) minmax(0, 1fr);
  gap: 4px 14px;
  font-size: 12.5px;
}
.raw-k {
  opacity: 0.6;
  word-break: break-all;
}
.raw-v {
  word-break: break-all;
}
.at-form {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.nui-grid.inner {
  gap: 6px 18px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
@media (max-width: 1200px) {
  .kv-grid,
  .nui-grid.inner {
    grid-template-columns: 1fr;
  }
  .signal {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
