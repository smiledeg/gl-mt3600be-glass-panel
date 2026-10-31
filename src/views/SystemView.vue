<script setup lang="ts">
/**
 * 系统（11 个 section）：info / password / upgrade / timer / timezone / button / fan / reset / logs / advanced / ui
 *
 * 数据全部来自真机：官方 RPC 对象（system/timer/fan/fanctrl/upgrade/logread/switch-button/luci/local-access/ui）
 * + 自有 glass RPC（温度/风扇/内存/磁盘）+ NUI 插件桥（enh.ssh_get、enh.fan_get、enh.overview、sys.details、ui.config）。
 * 方法名与入参来源见 docs/fe-sys.md（对照 docs/api-official.md 与 _recon_official/views/*.common.js）。
 */
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NColorPicker,
  NDataTable,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSlider,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  CloudDownloadOutline,
  ColorPaletteOutline,
  CopyOutline,
  DocumentTextOutline,
  HardwareChipOutline,
  InformationCircleOutline,
  KeyOutline,
  OpenOutline,
  PowerOutline,
  RefreshOutline,
  SaveOutline,
  ServerOutline,
  ShieldCheckmarkOutline,
  ThermometerOutline,
  TimeOutline,
  TimerOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import RingGauge from '@/components/RingGauge.vue'
import { usePolling, useAsync, shortError } from '@/composables/useAsync'
import * as sys from '@/api/sys'
import { luciEntryUrl } from '@/utils/luci'
import { getRateHistory, setRateHistory } from '@/api/rates'
import { uploadImage, uploadVideo } from '@/api/media'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { BUILD_VERSION } from '@/version'
import { fmtBytes, fmtDuration, pct } from '@/utils/format'

const props = defineProps<{ section?: string }>()
const section = computed(() => props.section || 'info')
const message = useMessage()
const ui = useUiStore()
const auth = useAuthStore()
const router = useRouter()

const errText = (e: unknown) => shortError(e) || '操作失败'

/**
 * 把「设备本地墙钟」格式化出来。
 * 注意：system.get_timezone_config 的 localtime 已经加过时区偏移（真机 timestamp/localtime 相差 8h），
 * 直接用 new Date(localtime) 会二次偏移，所以这里统一用 epoch(timestamp) + zonename 格式化。
 */
function fmtDeviceTime(ts: number | null | undefined, zone?: string): string {
  const n = Number(ts)
  if (!isFinite(n) || n <= 0) return '—'
  const d = new Date(n * 1000)
  const opts: Intl.DateTimeFormatOptions = {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }
  if (zone) {
    try {
      return d.toLocaleString('zh-CN', { ...opts, timeZone: zone })
    } catch {
      /* 浏览器不认识这个时区名，退回本机时区 */
    }
  }
  return d.toLocaleString('zh-CN', opts)
}

/* ================= 危险操作统一确认（输入确认词） ================= */
const danger = reactive({
  show: false,
  title: '',
  text: '',
  word: '',
  input: '',
  busy: false,
  run: ((): Promise<void> => Promise.resolve()) as () => Promise<void>,
})
function askDanger(o: { title: string; text: string; word: string; run: () => Promise<void> }) {
  danger.title = o.title
  danger.text = o.text
  danger.word = o.word
  danger.input = ''
  danger.busy = false
  danger.run = o.run
  danger.show = true
}
async function confirmDanger() {
  if (danger.input !== danger.word) return
  danger.busy = true
  try {
    await danger.run()
    danger.show = false
  } catch (e) {
    message.error(errText(e))
  } finally {
    danger.busy = false
  }
}

/* ======================================================================
 * info —— 系统信息
 * ==================================================================== */
const INFO_A = useAsync(
  async () => ({
    bundle: await sys.getSystemBundle(),
    details: await sys.getSysDetails(),
    disks: await sys.getNasDiskList(),
  }),
  { immediate: false },
)
const { data: infoData, loading: infoLoading, error: infoError, reload: reloadInfo } = INFO_A

const iInfo = computed(() => infoData.value?.bundle.info ?? null)
const iLoad = computed(() => infoData.value?.bundle.load ?? null)
const iStat = computed(() => infoData.value?.bundle.status?.system ?? null)
const iGlass = computed(() => infoData.value?.bundle.glass ?? null)
const iDetail = computed(() => infoData.value?.details ?? null)
const iTz = computed(() => infoData.value?.bundle.tz ?? null)
const iUsb = computed(() => infoData.value?.bundle.usbConfig?.protocol ?? '')
const iUsbOpts = computed(() => infoData.value?.bundle.usbInfo ?? [])
const iDisks = computed(() => infoData.value?.disks?.disk ?? [])
/** USB 磁盘摘要（dt/dd 成对渲染，避免模板里出现未使用变量） */
const iDiskRows = computed(() =>
  iDisks.value.map((d, i) => ({
    idx: i + 1,
    text:
      (d.part ?? [])
        .map(
          (p) =>
            `${p.label || p.dev_name} ${fmtBytes(Number(p.free_size ?? 0) * 1048576, 0)} 可用 / ${fmtBytes(Number(p.total_len ?? 0) * 1048576, 0)}`,
        )
        .join('；') || '无分区信息',
  })),
)
const cpuPct = computed(() => {
  const u = iDetail.value?.cpu?.usage
  if (typeof u === 'number' && isFinite(u)) return Math.round(u)
  const avg = iGlass.value?.cpu_avg
  return typeof avg === 'number' ? Math.round(avg) : 0
})
const memPct = computed(() => {
  const m = iGlass.value?.memory
  if (m?.total) return pct(Number(m.used ?? 0), Number(m.total))
  const l = iLoad.value
  if (l?.memory_total) return pct(Number(l.memory_total) - Number(l.memory_free ?? 0), Number(l.memory_total))
  return 0
})
const diskPct = computed(() => Number(iGlass.value?.disk?.percent ?? 0))
const temps = computed(() => {
  const t = iGlass.value?.temps
  if (Array.isArray(t) && t.length) return t.map((x) => ({ name: x.name, temp: x.temp }))
  return (iDetail.value?.sensors ?? []).map((x) => ({ name: String(x.name ?? 'sensor'), temp: Number(x.temp ?? 0) }))
})
const tempRows = computed(() => temps.value.map((t) => ({ name: t.name, temp: Math.round(t.temp * 10) / 10 })))
const tempColumns: DataTableColumns<{ name: string; temp: number }> = [
  { title: '传感器', key: 'name' },
  {
    title: '温度',
    key: 'temp',
    align: 'right',
    render: (r) => h('span', { class: 'nui-mono' }, `${r.temp} ℃`),
  },
]
const tempRowKey = (r: { name: string }) => r.name
const flashUsed = computed(() => Number(iStat.value?.flash_total ?? 0) - Number(iStat.value?.flash_free ?? 0))
const flashPct = computed(() => pct(flashUsed.value, Number(iStat.value?.flash_total ?? 0)))
const serviceRows = computed(() =>
  (infoData.value?.bundle.status?.service ?? []).map((s) => ({ name: s.name, status: Number(s.status) })),
)
const serviceColumns: DataTableColumns<{ name: string; status: number }> = [
  { title: '服务', key: 'name' },
  {
    title: '状态',
    key: 'status',
    align: 'right',
    render: (r) => h(NTag, { size: 'small', bordered: false, type: r.status ? 'success' : 'default' }, { default: () => (r.status ? '运行中' : '未启用') }),
  },
]
const serviceRowKey = (r: { name: string }) => r.name
const fanRpmInfo = computed(() => Number(iGlass.value?.fan?.speed ?? 0))
const uptimeText = computed(() => fmtDuration(iGlass.value?.uptime ?? iStat.value?.uptime ?? 0))
const localTime = computed(() => {
  const ts = iGlass.value?.localtime ?? iTz.value?.timestamp
  return fmtDeviceTime(ts, iTz.value?.zonename)
})

function diagText(): string {
  const i = iInfo.value
  const s = iStat.value
  const lines = [
    '===== GL-MT3600BE 诊断信息 =====',
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `型号：${String(i?.board_info?.model ?? i?.model ?? '—')}`,
    `厂商：${i?.vendor ?? '—'} / 类型：${i?.firmware_type ?? '—'}`,
    `固件：${i?.firmware_version ?? '—'}（${i?.firmware_date ?? '—'}）`,
    `主机名：${String(i?.board_info?.hostname ?? iGlass.value?.hostname ?? '—')}`,
    `内核：${i?.board_info?.kernel_version ?? '—'} / ${i?.board_info?.openwrt_version ?? '—'}`,
    `架构：${i?.board_info?.architecture ?? '—'}`,
    `序列号：${i?.sn ?? '—'}`,
    `MAC：${i?.mac ?? '—'}`,
    `时区：${iTz.value?.zonename ?? '—'}（${iTz.value?.tzoffset ?? '—'}） 本地时间：${localTime.value}`,
    `运行时长：${uptimeText.value}`,
    `CPU：${cpuPct.value}% 负载 ${(iGlass.value?.load ?? iLoad.value?.load_average ?? []).map((n) => Number(n).toFixed(2)).join(' / ')}`,
    `内存：${fmtBytes(Number(iGlass.value?.memory?.used ?? 0), 0)} / ${fmtBytes(Number(iGlass.value?.memory?.total ?? 0), 0)}（${memPct.value}%）`,
    `存储：${fmtBytes(Number(iGlass.value?.disk?.used ?? 0), 0)} / ${fmtBytes(Number(iGlass.value?.disk?.total ?? 0), 0)}（${diskPct.value}%）`,
    `温度：${tempRows.value.map((t) => `${t.name}=${t.temp}℃`).join(' ') || '—'}`,
    `风扇：${iGlass.value?.fan?.speed ?? '—'} RPM`,
    `LAN IP：${String(s?.lan_ip ?? '—')}`,
    `USB：${iUsb.value || '—'}`,
    `USB 存储：${iDisks.value.length ? `${iDisks.value.length} 个磁盘` : '未检测到'}`,
  ]
  return lines.join('\n')
}
const diagCopied = ref(false)
async function copyDiag() {
  const text = diagText()
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  diagCopied.value = true
  message.success('诊断信息已复制到剪贴板')
  setTimeout(() => (diagCopied.value = false), 2500)
}

/* ======================================================================
 * password —— 管理员密码 + SSH
 * ==================================================================== */
const PWD_A = useAsync(
  async () => ({ ssh: await sys.getSsh(), la: await sys.getLocalAccess() }),
  { immediate: false },
)
const { data: pwdData, loading: pwdLoading, error: pwdError, reload: reloadPwd } = PWD_A
const pwd = reactive({ old: '', next: '', confirm: '' })
const pwdBusy = ref(false)
const pwdDone = ref(false)
const pwdScore = computed(() => {
  const v = pwd.next
  if (!v) return 0
  let s = 0
  if (v.length >= 10) s++
  if (v.length >= 14) s++
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++
  if (/\d/.test(v)) s++
  if (/[^A-Za-z0-9]/.test(v)) s++
  return Math.min(s, 4)
})
const pwdScoreText = computed(() => ['太短', '偏弱', '一般', '较强', '很强'][pwdScore.value] ?? '太短')
async function submitPwd() {
  if (!pwd.old) return message.warning('请输入当前密码')
  if (pwd.next.length < 10 || pwd.next.length > 63) return message.warning('新密码长度需为 10-63 位')
  if (pwd.next !== pwd.confirm) return message.warning('两次输入的新密码不一致')
  if (pwd.next === pwd.old) return message.warning('新密码不能与当前密码相同')
  pwdBusy.value = true
  try {
    await sys.changePassword(pwd.old, pwd.next)
    pwd.old = ''
    pwd.next = ''
    pwd.confirm = ''
    pwdDone.value = true
    message.success('管理员密码已修改')
  } catch (e) {
    message.error(`修改失败：${errText(e)}`)
  } finally {
    pwdBusy.value = false
  }
}
async function relogin() {
  await auth.logout()
  await router.replace('/login')
}

const sshForm = reactive({ enabled: true, port: 22, password_auth: true, root_password_auth: true })
const sshBusy = ref(false)
function syncSsh() {
  const s = pwdData.value?.ssh
  if (!s) return
  sshForm.enabled = !!s.enabled
  sshForm.port = Number(s.port ?? 22)
  sshForm.password_auth = s.password_auth !== false
  sshForm.root_password_auth = s.root_password_auth !== false
}
watch(pwdData, syncSsh)
async function saveSsh() {
  if (sshForm.port < 1 || sshForm.port > 65535) return message.warning('SSH 端口需在 1-65535 之间')
  sshBusy.value = true
  try {
    await sys.saveSsh({ ...sshForm })
    await reloadPwd(true)
    message.success('SSH 设置已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    sshBusy.value = false
  }
}
const sshInfo = computed(() => pwdData.value?.ssh ?? null)
const laInfo = computed(() => pwdData.value?.la ?? null)

/* ======================================================================
 * upgrade —— 固件升级
 * ==================================================================== */
const UP_A = useAsync(async () => {
  const cfg = await sys.getUpgradeConfig().catch(() => null)
  const online = await sys.checkFirmwareOnline().catch(() => null)
  return { cfg, online }
}, { immediate: false })
const { data: upData, loading: upLoading, error: upError, reload: reloadUp } = UP_A
const upCfg = reactive({ upgrade_enable: true, prompt: true })
const upCfgBusy = ref(false)
watch(upData, () => {
  const c = upData.value?.cfg
  if (!c) return
  upCfg.upgrade_enable = c.upgrade_enable !== false
  upCfg.prompt = c.prompt !== false
})
const online = computed(() => upData.value?.online ?? null)
const currentVer = computed(() => String(online.value?.current_version ?? iInfo.value?.firmware_version ?? '—'))
const currentBuild = computed(() => String(online.value?.current_compile_time ?? iInfo.value?.firmware_date ?? '—'))
const currentType = computed(() => String(online.value?.current_type ?? iInfo.value?.firmware_type ?? '—'))
const hasNewVersion = computed(() => {
  const v = online.value?.new_version
  return !!v && String(v) !== currentVer.value
})
async function recheckOnline() {
  try {
    const r = await sys.checkFirmwareOnline()
    if (upData.value) upData.value = { ...upData.value, online: r }
    message.success(r?.new_version ? `发现新固件 ${r.new_version}` : '检查完成：未发现新版本')
  } catch (e) {
    message.error(`在线检查失败：${errText(e)}`)
  }
}
async function saveUpCfg() {
  upCfgBusy.value = true
  try {
    await sys.setUpgradeConfig({ ...upCfg })
    await reloadUp(true)
    message.success('更新设置已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    upCfgBusy.value = false
  }
}

/* --- 本地固件 --- */
const fileInput = ref<HTMLInputElement | null>(null)
const pickedName = ref('')
const upPct = ref(0)
const upStage = ref<'idle' | 'uploading' | 'verifying' | 'ready' | 'error'>('idle')
const upStageText = computed(
  () =>
    ({
      idle: '未选择固件',
      uploading: `正在上传… ${upPct.value}%`,
      verifying: '正在校验固件（约 10-30 秒）…',
      ready: '校验完成',
      error: '上传/校验失败',
    })[upStage.value],
)
const verify = ref<sys.LocalVerify | null>(null)
const verifyText = computed(() => {
  const s = Number(verify.value?.status ?? -1)
  return sys.UPGRADE_STATUS_TEXT[s] ?? (s >= 0 ? `未知状态 ${s}` : '—')
})
const keepConfig = ref(true)
const localInstallBusy = ref(false)
function chooseFile() {
  fileInput.value?.click()
}
async function onFilePicked(ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  if (!/\.(img|bin|trx|tar|gz)$/i.test(f.name) && !f.name.toLowerCase().includes('firmware')) {
    if (!confirmLike(`文件「${f.name}」看起来不是固件镜像，仍要上传校验吗？`)) return
  }
  pickedName.value = f.name
  verify.value = null
  upPct.value = 0
  upStage.value = 'uploading'
  try {
    await sys.uploadFirmware(f, (p) => (upPct.value = p))
    upStage.value = 'verifying'
    const v = await sys.checkFirmwareLocal()
    verify.value = v
    upStage.value = 'ready'
    if (Number(v?.status) === 0) message.success('固件校验通过')
    else message.warning(`固件校验结果：${verifyText.value}`)
  } catch (e) {
    upStage.value = 'error'
    message.error(`上传失败：${errText(e)}`)
  }
}
function confirmLike(text: string): boolean {
  return window.confirm(text)
}
function installLocal() {
  if (Number(verify.value?.status) !== 0) return message.warning('请先选择并校验通过固件')
  askDanger({
    title: '本地固件升级',
    text: `即将用 ${pickedName.value} 刷写固件${keepConfig.value ? '（保留现有配置）' : '（不保留配置）'}。\n升级期间设备会自动重启，约 3-5 分钟不可访问；切勿断电。`,
    word: 'UPGRADE',
    run: async () => {
      localInstallBusy.value = true
      try {
        await sys.upgradeLocal(keepConfig.value)
        message.success('升级指令已下发，设备将自动重启')
      } finally {
        localInstallBusy.value = false
      }
    },
  })
}
const onlineBusy = ref(false)
const onlineStatus = ref<sys.OnlineUpgradeStatus[] | null>(null)
let onlineTimer: number | undefined
async function pollOnlineStatus() {
  try {
    const r = await sys.getOnlineUpgradeStatus()
    onlineStatus.value = Array.isArray(r) ? r : null
  } catch {
    /* 忽略轮询错误 */
  }
}
function installOnline() {
  if (!hasNewVersion.value) return message.warning('未检测到新版本')
  askDanger({
    title: '在线固件升级',
    text: `即将从 GL.iNet 服务器下载并升级到 ${online.value?.new_version}。\n升级期间设备会自动重启，约 3-5 分钟不可访问；切勿断电。`,
    word: 'UPGRADE',
    run: async () => {
      onlineBusy.value = true
      try {
        await sys.upgradeOnline(true)
        message.success('在线升级已开始，正在下载固件…')
        if (onlineTimer) clearInterval(onlineTimer)
        onlineTimer = window.setInterval(() => void pollOnlineStatus(), 4000)
      } finally {
        onlineBusy.value = false
      }
    },
  })
}
const onlineStatusText = computed(() => {
  const list = onlineStatus.value
  if (!list || !list.length) return ''
  const one = list[0] as Record<string, unknown>
  const p = one.progress ?? one.percent ?? one.download_percent
  return `状态 ${String(one.status ?? '—')}${typeof p === 'number' ? `，进度 ${p}%` : ''}`
})

/* ======================================================================
 * timer —— 定时任务
 * ==================================================================== */
const TIMER_A = useAsync(async () => {
  const [timers, info] = await Promise.all([sys.getTimers(), sys.getSystemBundle().then((b) => b.info)])
  return { timers, info }
}, { immediate: false })
const { data: timerData, loading: timerLoading, error: timerError, reload: reloadTimer } = TIMER_A
const hw = computed(() => timerData.value?.info?.hardware_feature ?? {})
const hasLed = computed(() => hw.value.noled !== true)
const hasScreen = computed(() => hw.value.lcd_sched === true || hw.value.screen === true)

const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六']
const weekOptions = WEEK_LABEL.map((l, v) => ({ label: l, value: v }))

const tReboot = reactive({ enable: false, week: [0, 1, 2, 3, 4, 5, 6] as number[], hour: 3, min: 0 })
const tLed = reactive({ enable: false, week: [0, 1, 2, 3, 4, 5, 6] as number[], onH: 7, onM: 0, offH: 22, offM: 0 })
interface WifiRow {
  band: string
  enable: boolean
  func: 'turn_onoff' | 'power_switch'
  week: number[]
  onH: number
  onM: number
  offH: number
  offM: number
  swH: number
  swM: number
  rsH: number
  rsM: number
  switch_power: string
  restore_power: string
  exists: boolean
}
const wifiRows = ref<WifiRow[]>([])
const timerBusy = ref('')
const toNum = (v: unknown, d = 0) => {
  const n = Number(v)
  return isFinite(n) ? n : d
}
const pad2 = (n: number) => String(Math.max(0, Math.min(99, Math.floor(n)))).padStart(2, '0')
function buildWifiRows() {
  const arr = timerData.value?.timers.wifi?.wifi ?? []
  const rows: WifiRow[] = []
  for (const band of ['2G', '5G']) {
    const hit = arr.find((e) => String(e.band) === band && Number(e.guest ?? 0) === 0)
    if (!hit) {
      rows.push({
        band,
        enable: false,
        func: 'turn_onoff',
        week: [0, 1, 2, 3, 4, 5, 6],
        onH: 7,
        onM: 0,
        offH: 22,
        offM: 0,
        swH: 22,
        swM: 0,
        rsH: 7,
        rsM: 0,
        switch_power: 'Low',
        restore_power: 'Max',
        exists: false,
      })
      continue
    }
    rows.push({
      band,
      enable: !!hit.enable,
      func: hit.func === 'power_switch' ? 'power_switch' : 'turn_onoff',
      week: Array.isArray(hit.week) && hit.week.length ? hit.week.map(Number) : [0, 1, 2, 3, 4, 5, 6],
      onH: toNum(hit.turnon_hour, 7),
      onM: toNum(hit.turnon_min, 0),
      offH: toNum(hit.turnoff_hour, 22),
      offM: toNum(hit.turnoff_min, 0),
      swH: toNum(hit.switch_hour, 22),
      swM: toNum(hit.switch_min, 0),
      rsH: toNum(hit.restore_hour, 7),
      rsM: toNum(hit.restore_min, 0),
      switch_power: String(hit.switch_power ?? 'Low'),
      restore_power: String(hit.restore_power ?? 'Max'),
      exists: true,
    })
  }
  wifiRows.value = rows
}
watch(timerData, () => {
  const t = timerData.value?.timers
  if (!t) return
  if (t.reboot) {
    tReboot.enable = !!t.reboot.enable
    tReboot.week = (t.reboot.week ?? [0, 1, 2, 3, 4, 5, 6]).map(Number)
    tReboot.hour = toNum(t.reboot.hour, 3)
    tReboot.min = toNum(t.reboot.min, 0)
  }
  if (t.led) {
    tLed.enable = !!t.led.enable
    tLed.week = (t.led.week ?? [0, 1, 2, 3, 4, 5, 6]).map(Number)
    tLed.onH = toNum(t.led.turnon_hour, 7)
    tLed.onM = toNum(t.led.turnon_min, 0)
    tLed.offH = toNum(t.led.turnoff_hour, 22)
    tLed.offM = toNum(t.led.turnoff_min, 0)
  }
  buildWifiRows()
})
async function saveRebootTimer() {
  timerBusy.value = 'reboot'
  try {
    await sys.setTimer('reboot', {
      enable: tReboot.enable,
      hour: pad2(tReboot.hour),
      min: pad2(tReboot.min),
      week: [...tReboot.week].sort((a, b) => a - b),
    })
    await reloadTimer(true)
    message.success('定时重启已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    timerBusy.value = ''
  }
}
async function saveLedTimer() {
  timerBusy.value = 'led'
  try {
    await sys.setTimer('led', {
      enable: tLed.enable,
      turnon_hour: pad2(tLed.onH),
      turnon_min: pad2(tLed.onM),
      turnoff_hour: pad2(tLed.offH),
      turnoff_min: pad2(tLed.offM),
      week: [...tLed.week].sort((a, b) => a - b),
    })
    await reloadTimer(true)
    message.success('指示灯定时已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    timerBusy.value = ''
  }
}
async function saveWifiTimer() {
  timerBusy.value = 'wifi'
  try {
    const origin = timerData.value?.timers.wifi?.wifi ?? []
    const arr = JSON.parse(JSON.stringify(origin)) as sys.TimerWifiEntry[]
    for (const row of wifiRows.value) {
      let entry = arr.find((e) => String(e.band) === row.band && Number(e.guest ?? 0) === 0)
      if (!entry) {
        entry = { band: row.band, guest: 0 }
        arr.push(entry)
      }
      entry.func = row.func
      entry.enable = row.enable
      entry.week = [...row.week].sort((a, b) => a - b)
      if (row.func === 'turn_onoff') {
        entry.turnon_hour = pad2(row.onH)
        entry.turnon_min = pad2(row.onM)
        entry.turnoff_hour = pad2(row.offH)
        entry.turnoff_min = pad2(row.offM)
        delete entry.switch_power
        delete entry.restore_power
      } else {
        entry.switch_hour = pad2(row.swH)
        entry.switch_min = pad2(row.swM)
        entry.restore_hour = pad2(row.rsH)
        entry.restore_min = pad2(row.rsM)
        entry.switch_power = row.switch_power
        entry.restore_power = row.restore_power
        delete entry.turnon_hour
        delete entry.turnon_min
        delete entry.turnoff_hour
        delete entry.turnoff_min
      }
    }
    await sys.setTimer('wifi', { wifi: arr as unknown as Record<string, unknown>[] })
    await reloadTimer(true)
    message.success('Wi-Fi 定时已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    timerBusy.value = ''
  }
}

/* ======================================================================
 * timezone —— 时区 / NTP
 * ==================================================================== */
const TZ_A = useAsync(
  async () => ({ cfg: await sys.getTimezoneConfig(), details: await sys.getSysDetails() }),
  { immediate: false },
)
const { data: tzData, loading: tzLoading, error: tzError, reload: reloadTz } = TZ_A
const zonesA = useAsync(() => sys.getTimezoneList(), { immediate: false })
const zones = computed(() => zonesA.data.value ?? [])
const zoneOptions = computed(() =>
  zones.value.map((z) => ({ label: `${z.zonename}（${z.timezone}）`, value: z.zonename })),
)
const tzPick = ref<string | null>(null)
const tzBusy = ref('')
const tzCfg = computed(() => tzData.value?.cfg ?? null)
const ntpServers = computed(() => tzData.value?.details?.runtime?.ntp_servers ?? [])
const ntpOk = computed(() => tzData.value?.details?.runtime?.ntp === true || tzCfg.value?.autotimezone_enabled === true)
const tzNow = computed(() => fmtDeviceTime(tzCfg.value?.timestamp, tzCfg.value?.zonename))
watch(tzData, () => {
  if (tzCfg.value?.zonename) tzPick.value = String(tzCfg.value.zonename)
})
function currentZone(): { zonename: string; timezone: string } | null {
  const name = tzPick.value || tzCfg.value?.zonename
  if (!name) return null
  const hit = zones.value.find((z) => z.zonename === name)
  if (hit) return { zonename: hit.zonename, timezone: hit.timezone }
  if (name === tzCfg.value?.zonename && tzCfg.value?.timezone) {
    return { zonename: name, timezone: String(tzCfg.value.timezone) }
  }
  return null
}
async function applyTimezone(syncNow: boolean) {
  const z = currentZone()
  if (!z) return message.warning('请选择有效时区')
  tzBusy.value = syncNow ? 'sync' : 'apply'
  try {
    const payload: { zonename: string; timezone: string; localtime?: number } = { ...z }
    if (syncNow) payload.localtime = Math.floor(Date.now() / 1000)
    await sys.setTimezoneConfig(payload)
    await reloadTz(true)
    message.success(syncNow ? '已按本机时间校准设备时间' : '时区已保存')
  } catch (e) {
    message.error(`设置失败：${errText(e)}`)
  } finally {
    tzBusy.value = ''
  }
}

/* ======================================================================
 * button —— 拨动开关
 * ==================================================================== */
const BTN_A = useAsync(
  async () => ({
    cfg: await sys.getSwitchButton(),
    funcs: await sys.getSwitchFuncs(),
    pos: await sys.getSwitchStatus().catch(() => null),
  }),
  { immediate: false },
)
const { data: btnData, loading: btnLoading, error: btnError, reload: reloadBtn } = BTN_A
const btnFunc = ref<string | null>(null)
const btnSub = ref<string | null>(null)
const btnBusy = ref(false)
const btnFuncList = computed(() => btnData.value?.funcs?.funcs ?? [])
const btnOptions = computed(() =>
  btnFuncList.value.map((f) => ({ label: sys.SWITCH_FUNC_LABEL[f.func] ?? f.func, value: f.func })),
)
const btnSubOptions = computed(() => {
  const hit = btnFuncList.value.find((f) => f.func === btnFunc.value)
  return (hit?.sub_func ?? []).map((s) => ({ label: sys.SWITCH_FUNC_LABEL[s.func] ?? s.func, value: s.func }))
})
watch(btnData, () => {
  const c = btnData.value?.cfg
  btnFunc.value = c?.func ? String(c.func) : null
  btnSub.value = typeof c?.sub_func === 'string' ? c.sub_func : null
})
const btnPos = computed(() => btnData.value?.pos ?? null)
const btnPosText = computed(() => {
  const p = btnPos.value
  if (!p) return '不可用'
  if (p.supported === false || p.position == null) return '本机不支持'
  return p.position === 'on' ? 'ON（开）' : 'OFF（关）'
})
const btnPosOn = computed(() => btnPos.value?.position === 'on')
const btnPosFunc = computed(() => {
  const f = btnPos.value?.func || btnData.value?.cfg?.func
  if (!f) return '未配置'
  const sub = btnPos.value?.sub_func || btnData.value?.cfg?.sub_func
  const subLabel = sub ? (sys.SWITCH_FUNC_LABEL[String(sub)] ?? String(sub)) : ''
  return (sys.SWITCH_FUNC_LABEL[String(f)] ?? String(f)) + (subLabel ? `（${subLabel}）` : '')
})
const btnCurrentText = computed(() => {
  const f = btnData.value?.cfg?.func
  if (!f) return '未配置'
  const sub = btnData.value?.cfg?.sub_func
  return (sys.SWITCH_FUNC_LABEL[String(f)] ?? String(f)) + (sub ? `（${sys.SWITCH_FUNC_LABEL[String(sub)] ?? String(sub)}）` : '')
})
let btnPosTimer: number | undefined
function syncBtnPosTimer() {
  if (section.value === 'button') {
    if (!btnPosTimer) btnPosTimer = window.setInterval(() => void reloadBtn(true), ui.refreshMs)
  } else if (btnPosTimer) {
    clearInterval(btnPosTimer)
    btnPosTimer = undefined
  }
}
watch(section, syncBtnPosTimer, { immediate: true })
onBeforeUnmount(() => {
  if (btnPosTimer) clearInterval(btnPosTimer)
})
async function saveButton() {
  if (!btnFunc.value) return message.warning('请选择功能')
  btnBusy.value = true
  try {
    await sys.setSwitchButton({
      func: btnFunc.value,
      sub_func: btnSubOptions.value.length ? (btnSub.value ?? undefined) : undefined,
    })
    await reloadBtn(true)
    message.success('拨动开关功能已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    btnBusy.value = false
  }
}

/* ======================================================================
 * fan —— 风扇与温度
 * ==================================================================== */
const FAN_A = useAsync(
  async () => ({
    fan: await sys.getFanState(),
    enh: await sys.getEnhOverview(),
    officialCfg: await sys.getFanOfficialConfig().catch(() => null),
  }),
  { immediate: false },
)
const { data: fanData, loading: fanLoading, error: fanError, reload: reloadFan } = FAN_A
const fcStatus = computed(() => fanData.value?.fan.fanctrl ?? null)
const fcCfg = computed(() => fcStatus.value?.config ?? null)
const enhFan = computed(() => fanData.value?.enh?.fan ?? null)
const enhAlert = computed(() => fanData.value?.enh?.alert ?? null)
const alertHistory = computed(() => (fanData.value?.enh?.alert_history ?? []).slice(0, 6))
const fanRpm = computed(() => Number(fcStatus.value?.rpm ?? fanData.value?.fan.official?.speed ?? 0))
const fanTemp = computed(() => {
  const t = fcStatus.value?.temperature ?? fcStatus.value?.temp
  return typeof t === 'number' ? t : null
})
const fanTemps = computed(() => {
  const t = enhFan.value?.temps
  if (!t) return []
  return [
    { label: 'SoC', value: t.soc },
    { label: '模组', value: t.mcu },
    { label: '以太网', value: t.eth },
  ].filter((x) => typeof x.value === 'number') as { label: string; value: number }[]
})
/** 当前谁在控制风扇（fanctrl 插件接管 / 官方服务 / 空闲） */
const fanOwner = computed(() => {
  const s = fcStatus.value
  if (!s) return '未知'
  if (s.takeover === true && s.plugin_running === true) return '风扇控制插件（已接管）'
  if (s.plugin_running === true) return '风扇控制插件（未接管）'
  if (s.official_running === true) return '原厂 fan 服务'
  return '未接管（PWM 固定）'
})
/** 插件状态语义（对应插件页 i18n 的 status_ready / status_safe / status_error / 已停止） */
const fanStateText = computed(() => {
  const s = fcStatus.value
  if (!s) return '不可用'
  if (!s.plugin_running) return '已停止'
  const raw = String(s.state || '')
  if (/critical|safe|protect|fail/i.test(raw)) return s.plugin_running ? '安全保护' : '异常'
  if (/error/i.test(raw)) return '异常'
  return '就绪'
})
const fanStateType = computed<'success' | 'warning' | 'error' | 'default'>(() => {
  const t = fanStateText.value
  return t === '就绪' ? 'success' : t === '安全保护' ? 'warning' : t === '异常' ? 'error' : 'default'
})
/** 插件是否检测到可用 PWM 风扇（supported=false 时页面按插件语义降级） */
const fanSupported = computed(() => fcStatus.value?.supported !== false)
/** 插件增强温控曲线的温度点（只读展示） */
const smartPoints = computed(() => enhFan.value?.smart?.points ?? [])
const fanForm = reactive<sys.FanctrlConfig>({
  enabled: 1,
  mode: 'auto',
  start_temp: 50,
  wall_temp: 80,
  critical_temp: 90,
  hysteresis: 1,
  start_percent: 35,
  max_percent: 100,
  manual_percent: 100,
  poll_interval: 2,
})
watch(fcCfg, (c) => {
  if (c) Object.assign(fanForm, c)
})
const clampN = (v: number, min: number, max: number) => {
  const n = Number(v)
  const x = isFinite(n) ? n : min
  return Math.floor(Math.max(min, Math.min(max, x)))
}
function normalizeFan(c: sys.FanctrlConfig): sys.FanctrlConfig {
  const next = { ...c }
  next.enabled = next.enabled === 1 || (next.enabled as unknown) === true ? 1 : 0
  next.mode = next.mode === 'manual' ? 'manual' : 'auto'
  next.start_temp = clampN(next.start_temp, 35, 85)
  next.wall_temp = clampN(next.wall_temp, 40, 95)
  if (next.wall_temp < next.start_temp + 5) next.wall_temp = next.start_temp + 5
  if (next.wall_temp > 95) next.wall_temp = 95
  next.critical_temp = clampN(next.critical_temp, 43, 105)
  if (next.critical_temp < next.wall_temp + 3) next.critical_temp = next.wall_temp + 3
  if (next.critical_temp > 105) next.critical_temp = 105
  next.hysteresis = clampN(next.hysteresis, 1, 10)
  next.start_percent = clampN(next.start_percent, 0, 100)
  next.max_percent = clampN(next.max_percent, 0, 100)
  if (next.max_percent < next.start_percent) next.max_percent = next.start_percent
  next.manual_percent = clampN(next.manual_percent, 0, 100)
  next.poll_interval = clampN(next.poll_interval, 1, 30)
  return next
}
const fanBusy = ref('')
async function saveFanCfg() {
  fanBusy.value = 'save'
  try {
    await sys.saveFanctrlConfig(normalizeFan({ ...fanForm }))
    await reloadFan(true)
    message.success('风扇策略已保存')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    fanBusy.value = ''
  }
}
const manualPct = ref(100)
const onFanEnabled = (v: boolean) => {
  fanForm.enabled = v ? 1 : 0
}
const onFanMode = (v: string | number | boolean) => {
  fanForm.mode = String(v) === 'manual' ? 'manual' : 'auto'
}
async function applyManual(persist: boolean) {
  fanBusy.value = persist ? 'manual' : 'test'
  try {
    await sys.setFanManual(clampN(manualPct.value, 0, 100), persist)
    await reloadFan(true)
    message.success(persist ? `已切到手动模式：${clampN(manualPct.value, 0, 100)}%` : '已下发临时转速（不保存）')
  } catch (e) {
    message.error(`设置失败：${errText(e)}`)
  } finally {
    fanBusy.value = ''
  }
}
/** 恢复 fanctrl 默认策略（与插件页面「恢复默认」相同接口） */
async function restoreFanDefaults() {
  fanBusy.value = 'restore'
  try {
    await sys.restoreFanctrlDefaults()
    await reloadFan(true)
    message.success('已恢复风扇控制默认设置')
  } catch (e) {
    message.error(`恢复失败：${errText(e)}`)
  } finally {
    fanBusy.value = ''
  }
}

/* ======================================================================
 * reset —— 重启 / 恢复出厂 / 配置备份
 * ==================================================================== */
const RESET_A = useAsync(
  async () => ({ luci: await sys.getLuciStatus().catch(() => null), la: await sys.getLocalAccess().catch(() => null) }),
  { immediate: false },
)
const { data: resetData, loading: resetLoading, error: resetError, reload: reloadReset } = RESET_A
const rebootBusy = ref(false)
async function doReboot() {
  rebootBusy.value = true
  try {
    await sys.reboot(1)
    message.success('重启指令已下发，设备将在 1 分钟后恢复')
  } catch (e) {
    message.error(`重启失败：${errText(e)}`)
  } finally {
    rebootBusy.value = false
  }
}
const resetBusy = ref(false)
function doResetFirmware() {
  askDanger({
    title: '恢复出厂设置',
    text: '将清空全部配置（Wi-Fi、网络、密码、插件、本后台安装的页面都会丢失），设备回到首次开机向导。此操作不可撤销。',
    word: 'RESET',
    run: async () => {
      resetBusy.value = true
      try {
        await sys.resetFirmware()
        message.success('恢复出厂指令已下发，设备将重启')
      } finally {
        resetBusy.value = false
      }
    },
  })
}
const backupBusy = ref(false)
const backupErr = ref('')
async function doBackup() {
  backupBusy.value = true
  backupErr.value = ''
  try {
    const blob = await sys.backupConfig()
    const d = new Date()
    const name = `backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.tar.gz`
    sys.triggerBrowserDownload(blob, name)
    message.success('配置备份已开始下载')
  } catch (e) {
    backupErr.value = errText(e)
    message.warning(backupErr.value)
  } finally {
    backupBusy.value = false
  }
}
const luciInstalled = computed(() => Number(resetData.value?.luci?.status ?? -1) === 2)
const luciFlashUrl = computed(() => luciEntryUrl('/cgi-bin/luci/admin/system/flashops'))

/* ======================================================================
 * logs —— 日志
 * ==================================================================== */
const LOG_KINDS: { label: string; value: sys.LogKind }[] = [
  { label: '系统日志', value: 'system' },
  { label: '内核日志', value: 'kernel' },
  { label: '崩溃日志', value: 'crash' },
  { label: 'Nginx 日志', value: 'nginx' },
]
const logKind = ref<sys.LogKind>('system')
const logLinesOpt = ref(800)
const logLineOptions = [
  { label: '最近 200 行', value: 200 },
  { label: '最近 800 行', value: 800 },
  { label: '最近 2000 行', value: 2000 },
]
const logBusy = ref(false)
const logError = ref('')
const logText = ref('')
const logKeyword = ref('')
const logPage = ref(0)
const LOG_PAGE_SIZE = 200
const logAllLines = computed(() => (logText.value ? logText.value.split('\n').filter((l) => l.trim().length) : []))
const logFiltered = computed(() => {
  const kw = logKeyword.value.trim().toLowerCase()
  if (!kw) return logAllLines.value
  return logAllLines.value.filter((l) => l.toLowerCase().includes(kw))
})
const logPageCount = computed(() => Math.max(1, Math.ceil(logFiltered.value.length / LOG_PAGE_SIZE)))
const logWindow = computed(() => {
  const all = logFiltered.value
  const end = Math.max(0, all.length - logPage.value * LOG_PAGE_SIZE)
  const start = Math.max(0, end - LOG_PAGE_SIZE)
  return { lines: all.slice(start, end), from: start + 1, to: end }
})
async function loadLog() {
  logBusy.value = true
  logError.value = ''
  logPage.value = 0
  try {
    logText.value = await sys.getLog(logKind.value, logLinesOpt.value)
  } catch (e) {
    logError.value = errText(e)
    logText.value = ''
  } finally {
    logBusy.value = false
  }
}
const logExportBusy = ref(false)
async function exportLog() {
  logExportBusy.value = true
  try {
    await sys.exportLogs(false)
    message.success('日志压缩包已开始下载')
  } catch (e) {
    message.error(`导出失败：${errText(e)}`)
  } finally {
    logExportBusy.value = false
  }
}
async function copyLog() {
  const text = logWindow.value.lines.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    message.success('当前页日志已复制')
  } catch {
    message.warning('浏览器不允许访问剪贴板')
  }
}

/* ======================================================================
 * advanced —— 高级设置（LuCI / 本地访问）
 * ==================================================================== */
const ADV_A = useAsync(
  async () => ({ luci: await sys.getLuciStatus(), la: await sys.getLocalAccess(), root: await sys.getRootMode().catch(() => null) }),
  { immediate: false },
)
const { data: advData, loading: advLoading, error: advError, reload: reloadAdv } = ADV_A
const luciStatus = computed(() => Number(advData.value?.luci?.status ?? -1))
const luciStatusText = computed(() => sys.LUCI_STATUS_TEXT[luciStatus.value] ?? '未知')
const advLa = computed(() => advData.value?.la ?? null)
const advLuciUrl = computed(() => luciEntryUrl())
const rootEnabled = computed(() => !!advData.value?.root?.enabled)
const rootBusy = ref(false)
async function toggleRoot(v: boolean) {
  rootBusy.value = true
  try {
    const r = await sys.setRootMode(v)
    if (!r.ok) throw new Error(r.err || '切换失败')
    message.success(v ? '已开启：访问路由器地址将进入增强后台' : '已关闭：恢复原厂默认后台')
    await reloadAdv(true)
  } catch (e) {
    message.error(`切换失败：${errText(e)}`)
  } finally {
    rootBusy.value = false
  }
}
const advBusy = ref('')
async function installLuci() {
  advBusy.value = 'install'
  try {
    await sys.installLuci()
    await pollLuci(60)
    message.success('LuCI 安装流程已启动（下载需要外网，可能需要 1-3 分钟）')
  } catch (e) {
    message.error(`安装失败：${errText(e)}`)
  } finally {
    advBusy.value = ''
  }
}
async function uninstallLuci() {
  advBusy.value = 'uninstall'
  try {
    await sys.uninstallLuci()
    await pollLuci(30)
    message.success('LuCI 卸载指令已下发')
  } catch (e) {
    message.error(`卸载失败：${errText(e)}`)
  } finally {
    advBusy.value = ''
  }
}
async function pollLuci(times: number) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const s = await sys.getLuciStatus()
      if (advData.value) advData.value = { ...advData.value, luci: s }
      if (Number(s.status) === 2 || Number(s.status) === 0) break
    } catch {
      break
    }
  }
  await reloadAdv(true)
}

/* ======================================================================
 * ui —— 界面设置（本地面板 + 只读展示 NUI 配置）
 * ==================================================================== */
const UI_A = useAsync(
  async () => ({ lang: await sys.getOfficialLang().catch(() => null), nui: await sys.getNuiUiConfig() }),
  { immediate: false },
)
const { data: uiData, loading: uiLoading, error: uiError, reload: reloadUi } = UI_A
const officialLang = computed(() => {
  const v = uiData.value?.lang?.lang
  return uiData.value?.lang?.list?.find((x) => x.value === v)?.label ?? v ?? '—'
})
const nuiCfg = computed(() => uiData.value?.nui ?? null)
const THEME_OPTIONS = [
  { label: '深色', value: 'dark' },
  { label: '浅色', value: 'light' },
  { label: '跟随系统', value: 'auto' },
] as const
function setTheme(v: unknown) {
  const m = String(v)
  if (m === 'dark' || m === 'light' || m === 'auto') ui.setMode(m)
}
const ACCENT_PRESETS = ['#2080f0', '#18a058', '#7b61ff', '#f0a020', '#d03050', '#00b8d9']
const REFRESH_OPTIONS = [2, 3, 5, 10, 15, 30, 60].map((v) => ({ label: `${v} 秒`, value: v }))
const openExternal = (u: string) => window.open(u, '_blank')
function setRefreshSec(v: unknown) {
  ui.setRefreshSec(Number(v) || 5)
  message.success(`刷新频率已改为每 ${ui.refreshSec} 秒（全部页面立即生效）`)
}
const RADIUS_OPTIONS = [
  { label: '小', value: 'sm' },
  { label: '中', value: 'md' },
  { label: '大', value: 'lg' },
]
const BG_OPTIONS = [
  { label: '极光渐变', value: 'aurora' },
  { label: '纯色', value: 'pure' },
  { label: '壁纸', value: 'wallpaper' },
  { label: '视频', value: 'video' },
]
type AuroraPreset = 'default' | 'violet' | 'ocean' | 'sunset' | 'forest'
const AURORA_OPTIONS: { value: AuroraPreset; label: string; colors: [string, string, string] }[] = [
  { value: 'default', label: '默认', colors: ['#7c5cff', '#2080f0', '#00b8d9'] },
  { value: 'violet', label: '紫罗兰', colors: ['#a855f7', '#6366f1', '#ec4899'] },
  { value: 'ocean', label: '海洋', colors: ['#0ea5e9', '#06b6d4', '#10b981'] },
  { value: 'sunset', label: '日落', colors: ['#fb923c', '#f43f5e', '#a855f7'] },
  { value: 'forest', label: '森林', colors: ['#22c55e', '#10b981', '#84cc16'] },
]
const auroraPreview = (colors: [string, string, string]) => `linear-gradient(135deg, ${colors[0]}, ${colors[1]} 55%, ${colors[2]})`
const PURE_SWATCHES = ['#101014', '#18181c', '#1e1e2e', '#0f172a', '#1e293b', '#f5f6f8', '#eef2ff', '#fff7ed', '#ecfdf5']
function setAuroraPreset(v: AuroraPreset) {
  ui.setAppearance({ aurora: v })
}
function setPureColor(v: string) {
  ui.setAppearance({ pureColor: v })
}
const purePickValue = computed(() => ui.appearance.pureColor || (ui.dark ? '#101014' : '#f5f6f8'))

const fitCss = computed(() => {
  const f = ui.appearance.wallpaperFit || 'cover'
  return f === 'contain' ? 'contain' : f === 'stretch' ? '100% 100%' : 'cover'
})
function setWallpaperFit(v: string) {
  if (v === 'cover' || v === 'contain' || v === 'stretch') ui.setAppearance({ wallpaperFit: v })
}
const wallpaperFile = ref<HTMLInputElement | null>(null)
const wallpaperUrl = ref('')
const wallpaperBusy = ref(false)
const rateBusy = ref(false)

function setAccent(v: string) {
  if (!/^#[0-9a-f]{6}$/i.test(v)) return
  ui.setAppearance({ accent: v })
}
function setRadius(v: unknown) {
  const m = String(v)
  if (m === 'sm' || m === 'md' || m === 'lg') ui.setAppearance({ radius: m })
}
function setBg(v: unknown) {
  const m = String(v)
  if (m === 'aurora' || m === 'pure' || m === 'wallpaper' || m === 'video') ui.setAppearance({ bg: m })
}
function pickWallpaper() {
  wallpaperFile.value?.click()
}
/** 浏览器里压缩：长边 ≤2560、JPEG，避免 localStorage 塞爆 */
async function onWallpaperFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  wallpaperBusy.value = true
  try {
    const url = await uploadImage(file)
    ui.setAppearance({ wallpaper: url, bg: 'wallpaper' })
    message.success('壁纸已上传到路由器，所有设备同步')
  } catch (err) {
    message.error(`壁纸处理失败：${shortError(err)}`)
  } finally {
    wallpaperBusy.value = false
    input.value = ''
  }
}
function applyWallpaperUrl() {
  const u = wallpaperUrl.value.trim()
  if (!u) return
  if (!/^(https?:\/\/|data:image\/)/i.test(u)) {
    message.warning('请填 http(s) 图片地址')
    return
  }
  ui.setAppearance({ wallpaper: u, bg: 'wallpaper' })
  message.success('壁纸链接已应用')
}
function clearWallpaper() {
  ui.setAppearance({ wallpaper: '', bg: 'aurora' })
  wallpaperUrl.value = ''
}

const videoFile = ref<HTMLInputElement | null>(null)
const videoUrlInput = ref('')
const videoBusy = ref(false)
const videoPct = ref(0)
function pickVideo() {
  videoFile.value?.click()
}
async function onVideoFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  if (f.size > 40 * 1024 * 1024) {
    message.warning('视频不能超过 40MB（建议先压缩）')
    input.value = ''
    return
  }
  videoBusy.value = true
  videoPct.value = 0
  try {
    const url = await uploadVideo(f, (p) => (videoPct.value = p))
    ui.setAppearance({ video: url, bg: 'video' })
    message.success('视频背景已应用')
  } catch (err) {
    message.error(`视频上传失败：${shortError(err)}`)
  } finally {
    videoBusy.value = false
    input.value = ''
  }
}
function applyVideoUrl() {
  const u = videoUrlInput.value.trim()
  if (!u) return
  if (!/^(https?:\/\/|\/glass-media\/)/i.test(u)) {
    message.warning('请填 http(s) 视频地址')
    return
  }
  ui.setAppearance({ video: u, bg: 'video' })
  message.success('视频链接已应用')
}
function clearVideo() {
  ui.setAppearance({ video: '', bg: 'aurora' })
  videoUrlInput.value = ''
}
async function toggleRateHistory(v: boolean) {
  rateBusy.value = true
  try {
    const on = await setRateHistory(v)
    ui.setRateHistory(on)
    message.success(on ? '已开启：首页曲线会直接显示最近 3 分钟记录' : '已关闭：首页只显示本次打开后的实时曲线')
  } catch (err) {
    message.error(`设置失败：${shortError(err)}`)
  } finally {
    rateBusy.value = false
  }
}

/* ======================================================================
 * 激活 / 轮询
 * ==================================================================== */
const reloaders: Record<string, (silent?: boolean) => Promise<void> | void> = {
  info: () => reloadInfo(),
  password: () => reloadPwd(),
  upgrade: () => reloadUp(),
  timer: () => reloadTimer(),
  timezone: () => {
    void reloadTz()
    if (!zonesA.data.value) void zonesA.reload()
  },
  button: () => reloadBtn(),
  fan: () => reloadFan(),
  reset: () => reloadReset(),
  logs: () => loadLog(),
  advanced: () => reloadAdv(),
  ui: () => reloadUi(),
}
function activate(s: string) {
  const fn = reloaders[s]
  if (fn) void fn()
}
watch(section, (s) => activate(s), { immediate: true })

usePolling(() => {
  const s = section.value
  if (s === 'info') void reloadInfo(true)
  else if (s === 'fan') void reloadFan(true)
}, 5000)

onMounted(async () => {
  try {
    const h = await getRateHistory(60)
    ui.setRateHistory(!!h.enabled)
  } catch {
    /* 读取失败保持本地值 */
  }
})

// 离开页面时清掉在线升级轮询
watch(section, (s) => {
  if (s !== 'upgrade' && onlineTimer) {
    clearInterval(onlineTimer)
    onlineTimer = undefined
  }
})
</script>

<template>
  <div class="nui-page">
    <!-- ================= info ================= -->
    <template v-if="section === 'info'">
      <PageState :loading="infoLoading" :error="infoError" :empty="!infoData" empty-text="设备信息接口不可用" @retry="reloadInfo">
        <div class="nui-grid">
          <PanelCard class="span-8" title="设备信息">
            <template #icon><n-icon><HardwareChipOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" type="success">{{ iInfo?.firmware_type || 'release' }}</n-tag>
            </template>
            <div class="nui-mid">{{ iInfo?.board_info?.model || 'GL-MT3600BE' }}</div>
            <div class="nui-small nui-muted" style="margin-bottom: 14px">
              {{ iInfo?.vendor || 'GL.iNet' }} · {{ iInfo?.board_info?.architecture || '—' }} · 内核 {{ iInfo?.board_info?.kernel_version || '—' }}
            </div>
            <dl class="nui-kv">
              <dt>固件版本</dt>
              <dd>{{ iInfo?.firmware_version || '—' }}</dd>
              <dt>固件日期</dt>
              <dd>{{ iInfo?.firmware_date || '—' }}</dd>
              <dt>OpenWrt</dt>
              <dd>{{ String(iInfo?.board_info?.openwrt_version || '—').trim() }}</dd>
              <dt>主机名</dt>
              <dd>{{ iInfo?.board_info?.hostname || iGlass?.hostname || '—' }}</dd>
              <dt>序列号</dt>
              <dd class="nui-mono nui-small">{{ iInfo?.sn || '—' }}</dd>
              <dt>MAC 地址</dt>
              <dd class="nui-mono nui-small">{{ iInfo?.mac || '—' }}</dd>
              <dt>运行时长</dt>
              <dd>{{ uptimeText }}</dd>
              <dt>本地时间</dt>
              <dd>{{ localTime }}（{{ iTz?.zonename || '—' }} {{ iTz?.tzoffset || '' }}）</dd>
              <dt>LAN IP</dt>
              <dd class="nui-mono">{{ iStat?.lan_ip || '—' }}</dd>
            </dl>
          </PanelCard>

          <PanelCard class="span-4" title="健康度">
            <template #icon><n-icon><ShieldCheckmarkOutline /></n-icon></template>
            <div class="gauges">
              <RingGauge :value="cpuPct" :size="96" :thickness="8" label="CPU" />
              <RingGauge :value="memPct" :size="96" :thickness="8" label="内存" color="var(--ok)" />
              <RingGauge :value="diskPct" :size="96" :thickness="8" label="存储" color="var(--warn)" />
            </div>
            <dl class="nui-kv" style="margin-top: 14px">
              <dt>负载（1/5/15 分）</dt>
              <dd class="nui-mono">
                {{ (iGlass?.load ?? iLoad?.load_average ?? []).map((n) => Number(n).toFixed(2)).join(' / ') || '—' }}
              </dd>
              <dt>内存可用</dt>
              <dd>{{ fmtBytes(iGlass?.memory?.available ?? iLoad?.memory_free, 0) }}</dd>
              <dt>Swap</dt>
              <dd>{{ fmtBytes(iLoad?.swap_free ?? 0, 0) }} / {{ fmtBytes(iLoad?.swap_total ?? 0, 0) }}</dd>
            </dl>
          </PanelCard>

          <PanelCard class="span-4" title="温度与风扇">
            <template #icon><n-icon><ThermometerOutline /></n-icon></template>
            <div class="nui-between" style="margin-bottom: 8px">
              <div>
                <div class="nui-big">{{ fanRpmInfo }}<span class="nui-unit">RPM</span></div>
                <div class="nui-small nui-muted">当前风扇转速</div>
              </div>
              <n-tag size="small" :bordered="false" :type="(iGlass?.fan?.status ?? true) ? 'success' : 'warning'">
                {{ iGlass?.fan?.status === false ? '停转' : '运转中' }}
              </n-tag>
            </div>
            <n-data-table
              :columns="tempColumns"
              :data="tempRows"
              :row-key="tempRowKey"
              size="small"
              :bordered="false"
            />
            <p v-if="!tempRows.length" class="nui-small nui-muted" style="margin: 8px 0 0">未读到温度传感器</p>
          </PanelCard>

          <PanelCard class="span-4" title="内存与存储">
            <template #icon><n-icon><ServerOutline /></n-icon></template>
            <div class="nui-small nui-muted">内存</div>
            <n-progress type="line" :percentage="memPct" :height="8" :show-indicator="false" style="margin: 6px 0" />
            <div class="nui-small nui-mono">
              {{ fmtBytes(iGlass?.memory?.used ?? 0, 0) }} / {{ fmtBytes(iGlass?.memory?.total ?? iLoad?.memory_total ?? 0, 0) }}
            </div>
            <div class="nui-small nui-muted" style="margin-top: 14px">系统分区（overlay）</div>
            <n-progress type="line" :percentage="flashPct" :height="8" :show-indicator="false" status="warning" style="margin: 6px 0" />
            <div class="nui-small nui-mono">{{ fmtBytes(flashUsed, 0) }} / {{ fmtBytes(iStat?.flash_total ?? 0, 0) }}</div>
            <div class="nui-small nui-muted" style="margin-top: 14px">
              缓存 {{ fmtBytes(iGlass?.memory?.cached ?? iLoad?.memory_buff_cache, 0) }} ·
              Buffers {{ fmtBytes(iGlass?.memory?.buffers ?? 0, 0) }}
            </div>
          </PanelCard>

          <PanelCard class="span-4" title="USB 与外设">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <dl class="nui-kv">
              <dt>USB 协议</dt>
              <dd>{{ iUsb || '—' }}</dd>
              <dt>可选协议</dt>
              <dd class="nui-small">{{ iUsbOpts.map((x) => x.label).join(' / ') || '—' }}</dd>
              <dt>USB 存储</dt>
              <dd>{{ iDisks.length ? `${iDisks.length} 个磁盘` : '未检测到' }}</dd>
              <dt v-for="d in iDiskRows" :key="d.idx">磁盘 {{ d.idx }}</dt>
              <dd v-for="d in iDiskRows" :key="`p${d.idx}`" class="nui-small">{{ d.text }}</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              USB 协议（2.0/3.0）切换与磁盘管理在官方后台「网络存储 / 系统」里操作，这里只做展示。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="服务状态">
            <template #icon><n-icon><ServerOutline /></n-icon></template>
            <n-data-table
              :columns="serviceColumns"
              :data="serviceRows"
              :row-key="serviceRowKey"
              size="small"
              :bordered="false"
            />
            <p v-if="!serviceRows.length" class="nui-small nui-muted" style="margin: 8px 0 0">无服务状态数据</p>
          </PanelCard>

          <PanelCard class="span-6" title="诊断信息">
            <template #icon><n-icon><DocumentTextOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              一键复制设备信息、版本、负载、温度、风扇、网络地址，便于反馈问题（纯前端拼接，不会上传到任何地方）。
            </p>
            <n-button size="small" type="primary" :loading="false" @click="copyDiag">
              <template #icon><n-icon><CopyOutline /></n-icon></template>
              {{ diagCopied ? '已复制' : '复制诊断信息' }}
            </n-button>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= password ================= -->
    <template v-if="section === 'password'">
      <PageState :loading="pwdLoading" :error="pwdError" :empty="!pwdData" empty-text="密码 / SSH 接口不可用" @retry="reloadPwd">
        <div class="nui-grid">
          <PanelCard class="span-6" title="管理员密码">
            <template #icon><n-icon><KeyOutline /></n-icon></template>
            <div class="nui-col nui-gap-8">
              <n-input v-model:value="pwd.old" size="small" type="password" show-password-on="click" placeholder="当前密码" />
              <n-input v-model:value="pwd.next" size="small" type="password" show-password-on="click" placeholder="新密码（10-63 位）" />
              <n-input v-model:value="pwd.confirm" size="small" type="password" show-password-on="click" placeholder="再次输入新密码" />
              <div class="nui-row">
                <n-tag v-if="pwd.next" size="small" :bordered="false" :type="pwdScore >= 3 ? 'success' : pwdScore === 2 ? 'warning' : 'error'">
                  强度：{{ pwdScoreText }}
                </n-tag>
                <span class="nui-small nui-muted">建议 10 位以上，大小写字母 + 数字 + 符号混合</span>
              </div>
              <n-button size="small" type="primary" :loading="pwdBusy" @click="submitPwd">修改密码</n-button>
            </div>
            <n-alert v-if="pwdDone" type="success" :bordered="false" style="margin-top: 12px">
              密码已修改。当前会话仍然有效，<b>下次登录请使用新密码</b>（SSH 与 Web 后台共用）。
              <div style="margin-top: 8px">
                <n-button size="tiny" secondary @click="relogin">立即重新登录</n-button>
              </div>
            </n-alert>
            <p v-else class="nui-small nui-muted" style="margin: 12px 0 0">
              密码由官方接口校验（本机 security_rule=1：长度 10-63 位且需满足强度规则），修改后官方后台与 SSH 同时生效。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="SSH 服务">
            <template #icon><n-icon><ServerOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" :type="sshInfo?.running ? 'success' : 'default'">
                {{ sshInfo?.running ? '运行中' : '未运行' }}
              </n-tag>
            </template>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">启用 SSH</span>
              <n-switch v-model:value="sshForm.enabled" />
            </div>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">端口</span>
              <n-input-number v-model:value="sshForm.port" :min="1" :max="65535" size="small" style="width: 140px" />
            </div>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">允许密码登录</span>
              <n-switch v-model:value="sshForm.password_auth" />
            </div>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">允许 root 密码登录</span>
              <n-switch v-model:value="sshForm.root_password_auth" />
            </div>
            <dl class="nui-kv">
              <dt>已授权公钥</dt>
              <dd>{{ (sshInfo?.keys ?? []).length }} 个</dd>
              <dt>开机自启</dt>
              <dd>{{ sshInfo?.boot ? '是' : '否' }}</dd>
              <dt>防火墙规则</dt>
              <dd class="nui-mono nui-small">{{ sshInfo?.firewall || '—' }}</dd>
              <dt>Web / HTTPS 端口</dt>
              <dd>{{ laInfo?.http_port || '—' }} / {{ laInfo?.https_port || '—' }}</dd>
            </dl>
            <n-button size="small" type="primary" :loading="sshBusy" style="margin-top: 12px" @click="saveSsh">
              <template #icon><n-icon><SaveOutline /></n-icon></template>
              保存 SSH 设置
            </n-button>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              保存会重载防火墙并重启 dropbear；关闭密码登录前请先通过官方/插件添加至少一个公钥，否则会把自己锁在门外。
              公钥管理请在 NUI「系统增强」页操作。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= upgrade ================= -->
    <template v-if="section === 'upgrade'">
      <PageState :loading="upLoading" :error="upError" :empty="!upData" empty-text="升级接口不可用" @retry="reloadUp">
        <div class="nui-grid">
          <PanelCard class="span-6" title="当前固件">
            <template #icon><n-icon><HardwareChipOutline /></n-icon></template>
            <div class="nui-mid">{{ currentVer }}</div>
            <div class="nui-small nui-muted" style="margin-bottom: 12px">编译于 {{ currentBuild }} · {{ currentType }}</div>
            <dl class="nui-kv">
              <dt>固件类型</dt>
              <dd>{{ currentType }}</dd>
              <dt>在线检查</dt>
              <dd>
                <n-tag size="small" :bordered="false" :type="hasNewVersion ? 'warning' : 'success'">
                  {{ hasNewVersion ? `发现 ${online?.new_version}` : '未发现新版本' }}
                </n-tag>
              </dd>
            </dl>
            <div class="nui-row" style="margin-top: 12px">
              <n-button size="small" secondary :loading="false" @click="recheckOnline">
                <template #icon><n-icon><RefreshOutline /></n-icon></template>
                重新检查
              </n-button>
              <n-button size="small" quaternary tag="a" href="/gl_home.html?official=1#/upgrade" target="_blank">官方升级页</n-button>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              在线检查需要设备能访问 fw.gl-inet.cn；本机 4.9.0 为当前发布版。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="在线升级">
            <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
            <template v-if="hasNewVersion">
              <dl class="nui-kv">
                <dt>新版本</dt>
                <dd>{{ online?.new_version }}</dd>
                <dt>发布日期</dt>
                <dd>{{ online?.new_version_date || '—' }}</dd>
              </dl>
              <p v-if="online?.release_note_cn || online?.release_note" class="nui-small" style="white-space: pre-wrap; margin: 10px 0">
                {{ online?.release_note_cn || online?.release_note }}
              </p>
              <n-button size="small" type="warning" :loading="onlineBusy" @click="installOnline">在线升级到 {{ online?.new_version }}</n-button>
              <p v-if="onlineStatusText" class="nui-small nui-mono" style="margin: 10px 0 0">{{ onlineStatusText }}</p>
            </template>
            <p v-else class="nui-small nui-muted" style="margin: 0">
              当前已是最新版本（在线检查未返回更新的版本号）。如需重刷固件，请使用右侧的本地升级或官方升级页。
            </p>
          </PanelCard>

          <PanelCard class="span-7" title="本地固件升级">
            <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              上传官方 .img 固件到设备 /tmp/firmware.img → 校验（sha256/平台/版本）→ 安装。上传走官方 /upload 通道，与官方后台一致。
            </p>
            <div class="nui-row nui-wrap" style="margin-bottom: 10px">
              <input ref="fileInput" type="file" accept=".img,.bin,.trx,.tar,.gz" style="display: none" @change="onFilePicked" />
              <n-button size="small" secondary :disabled="upStage === 'uploading' || upStage === 'verifying'" @click="chooseFile">选择固件文件</n-button>
              <span class="nui-small nui-mono">{{ pickedName || '未选择' }}</span>
            </div>
            <n-progress
              type="line"
              :percentage="upStage === 'uploading' ? upPct : upStage === 'ready' ? 100 : upStage === 'verifying' ? 100 : 0"
              :height="8"
              :processing="upStage === 'uploading' || upStage === 'verifying'"
              :show-indicator="false"
            />
            <div class="nui-small" style="margin: 6px 0 10px">
              {{ upStageText }}
              <span v-if="upStage === 'ready'" class="nui-muted"> · {{ verifyText }}</span>
            </div>
            <dl v-if="verify?.sha256" class="nui-kv">
              <dt>固件版本</dt>
              <dd>{{ verify?.version || '—' }}</dd>
              <dt>SHA256</dt>
              <dd class="nui-mono nui-small ellipsis">{{ verify?.sha256 }}</dd>
              <dt>校验结论</dt>
              <dd>{{ verifyText }}</dd>
            </dl>
            <div class="nui-row" style="margin: 12px 0">
              <span class="nui-small" style="flex: 1">升级时保留现有配置</span>
              <n-switch v-model:value="keepConfig" />
            </div>
            <n-button
              size="small"
              type="error"
              secondary
              :loading="localInstallBusy"
              :disabled="Number(verify?.status) !== 0"
              @click="installLocal"
            >
              开始本地升级
            </n-button>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              只有校验状态为「固件校验通过」才可安装；刷写期间切勿断电。若不确定固件来源，请改用官方升级页。
            </p>
          </PanelCard>

          <PanelCard class="span-5" title="更新提醒设置">
            <template #icon><n-icon><SaveOutline /></n-icon></template>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">启用自动检查更新</span>
              <n-switch v-model:value="upCfg.upgrade_enable" />
            </div>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">有新版本时弹窗提醒</span>
              <n-switch v-model:value="upCfg.prompt" />
            </div>
            <n-button size="small" type="primary" :loading="upCfgBusy" @click="saveUpCfg">保存</n-button>
            <n-alert type="warning" :bordered="false" style="margin-top: 14px">
              升级属于高风险操作：本面板只做与官方相同的调用，不额外修改固件校验逻辑。若设备上有重要配置，建议先备份。
            </n-alert>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= timer ================= -->
    <template v-if="section === 'timer'">
      <PageState :loading="timerLoading" :error="timerError" :empty="!timerData" empty-text="定时任务接口不可用" @retry="reloadTimer">
        <div class="nui-grid">
          <PanelCard class="span-6" title="定时重启">
            <template #icon><n-icon><TimerOutline /></n-icon></template>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="flex: 1">启用</span>
              <n-switch v-model:value="tReboot.enable" />
            </div>
            <div class="nui-row" style="margin-bottom: 12px">
              <span class="nui-small" style="width: 60px">时间</span>
              <n-input-number v-model:value="tReboot.hour" :min="0" :max="23" size="small" style="width: 100px" />
              <span class="nui-small nui-muted">时</span>
              <n-input-number v-model:value="tReboot.min" :min="0" :max="59" size="small" style="width: 100px" />
              <span class="nui-small nui-muted">分</span>
            </div>
            <div class="nui-row nui-wrap" style="margin-bottom: 12px">
              <span class="nui-small" style="width: 60px">星期</span>
              <n-checkbox-group v-model:value="tReboot.week">
                <n-checkbox v-for="o in weekOptions" :key="o.value" :value="o.value" :label="o.label" />
              </n-checkbox-group>
            </div>
            <n-button size="small" type="primary" :loading="timerBusy === 'reboot'" @click="saveRebootTimer">保存</n-button>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              到点后设备会重启一次（网络中断 40-60 秒），适合夜间维护。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="定时指示灯">
            <template #icon><n-icon><TimeOutline /></n-icon></template>
            <template v-if="hasLed">
              <div class="nui-row" style="margin-bottom: 12px">
                <span class="nui-small" style="flex: 1">启用</span>
                <n-switch v-model:value="tLed.enable" />
              </div>
              <div class="nui-row" style="margin-bottom: 10px">
                <span class="nui-small" style="width: 60px">开启</span>
                <n-input-number v-model:value="tLed.onH" :min="0" :max="23" size="small" style="width: 90px" />
                <span class="nui-small nui-muted">时</span>
                <n-input-number v-model:value="tLed.onM" :min="0" :max="59" size="small" style="width: 90px" />
                <span class="nui-small nui-muted">分</span>
              </div>
              <div class="nui-row" style="margin-bottom: 12px">
                <span class="nui-small" style="width: 60px">关闭</span>
                <n-input-number v-model:value="tLed.offH" :min="0" :max="23" size="small" style="width: 90px" />
                <span class="nui-small nui-muted">时</span>
                <n-input-number v-model:value="tLed.offM" :min="0" :max="59" size="small" style="width: 90px" />
                <span class="nui-small nui-muted">分</span>
              </div>
              <div class="nui-row nui-wrap" style="margin-bottom: 12px">
                <span class="nui-small" style="width: 60px">星期</span>
                <n-checkbox-group v-model:value="tLed.week">
                  <n-checkbox v-for="o in weekOptions" :key="o.value" :value="o.value" :label="o.label" />
                </n-checkbox-group>
              </div>
              <n-button size="small" type="primary" :loading="timerBusy === 'led'" @click="saveLedTimer">保存</n-button>
            </template>
            <p v-else class="nui-small nui-muted" style="margin: 0">本机没有可编程指示灯，官方也隐藏了这一项。</p>
            <n-alert v-if="!hasScreen" type="info" :bordered="false" style="margin-top: 14px">
              本机没有 LCD 屏幕（hardware_feature.screen=false），因此不显示「屏幕定时」。
            </n-alert>
          </PanelCard>

          <PanelCard class="span-12" title="定时 Wi-Fi 开关">
            <template #icon><n-icon><TimeOutline /></n-icon></template>
            <div v-for="row in wifiRows" :key="row.band" class="wifi-row">
              <div class="nui-row nui-wrap" style="margin-bottom: 8px">
                <n-tag size="small" :bordered="false" type="info">{{ row.band }}</n-tag>
                <span class="nui-small" style="flex: 1">{{ row.func === 'turn_onoff' ? '定时开/关 Wi-Fi' : '定时切换发射功率' }}</span>
                <n-switch v-model:value="row.enable" size="small" />
              </div>
              <div class="nui-row nui-wrap" style="gap: 10px">
                <n-select
                  v-model:value="row.func"
                  size="small"
                  style="width: 190px"
                  :options="[
                    { label: '定时开/关 Wi-Fi', value: 'turn_onoff' },
                    { label: '定时切换发射功率', value: 'power_switch' },
                  ]"
                />
                <template v-if="row.func === 'turn_onoff'">
                  <span class="nui-small nui-muted">开</span>
                  <n-input-number v-model:value="row.onH" :min="0" :max="23" size="small" style="width: 84px" />
                  <span class="nui-small nui-muted">:</span>
                  <n-input-number v-model:value="row.onM" :min="0" :max="59" size="small" style="width: 84px" />
                  <span class="nui-small nui-muted">关</span>
                  <n-input-number v-model:value="row.offH" :min="0" :max="23" size="small" style="width: 84px" />
                  <span class="nui-small nui-muted">:</span>
                  <n-input-number v-model:value="row.offM" :min="0" :max="59" size="small" style="width: 84px" />
                </template>
                <template v-else>
                  <span class="nui-small nui-muted">切换</span>
                  <n-input-number v-model:value="row.swH" :min="0" :max="23" size="small" style="width: 84px" />
                  <span class="nui-small nui-muted">:</span>
                  <n-input-number v-model:value="row.swM" :min="0" :max="59" size="small" style="width: 84px" />
                  <n-select
                    v-model:value="row.switch_power"
                    size="small"
                    style="width: 100px"
                    :options="[{ label: 'Low', value: 'Low' }, { label: 'Medium', value: 'Medium' }, { label: 'High', value: 'High' }, { label: 'Max', value: 'Max' }]"
                  />
                  <span class="nui-small nui-muted">恢复</span>
                  <n-input-number v-model:value="row.rsH" :min="0" :max="23" size="small" style="width: 84px" />
                  <span class="nui-small nui-muted">:</span>
                  <n-input-number v-model:value="row.rsM" :min="0" :max="59" size="small" style="width: 84px" />
                  <n-select
                    v-model:value="row.restore_power"
                    size="small"
                    style="width: 100px"
                    :options="[{ label: 'Low', value: 'Low' }, { label: 'Medium', value: 'Medium' }, { label: 'High', value: 'High' }, { label: 'Max', value: 'Max' }]"
                  />
                </template>
              </div>
              <div class="nui-row nui-wrap" style="margin-top: 8px">
                <span class="nui-small nui-muted">星期</span>
                <n-checkbox-group v-model:value="row.week">
                  <n-checkbox v-for="o in weekOptions" :key="o.value" :value="o.value" :label="o.label" />
                </n-checkbox-group>
              </div>
            </div>
            <n-button size="small" type="primary" :loading="timerBusy === 'wifi'" style="margin-top: 6px" @click="saveWifiTimer">
              保存 Wi-Fi 定时
            </n-button>
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              保存时会读取当前整份定时配置再回写（只改主网络 2.4G/5G 的条目），不影响访客网络与官方页面里的其它设置。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= timezone ================= -->
    <template v-if="section === 'timezone'">
      <PageState :loading="tzLoading" :error="tzError" :empty="!tzData" empty-text="时区接口不可用" @retry="reloadTz">
        <div class="nui-grid">
          <PanelCard class="span-7" title="时间与时区">
            <template #icon><n-icon><TimeOutline /></n-icon></template>
            <dl class="nui-kv">
              <dt>当前时区</dt>
              <dd>{{ tzCfg?.zonename || '—' }}</dd>
              <dt>时区偏移</dt>
              <dd>{{ tzCfg?.tzoffset || '—' }}</dd>
              <dt>POSIX TZ</dt>
              <dd class="nui-mono nui-small">{{ tzCfg?.timezone || '—' }}</dd>
              <dt>设备本地时间</dt>
              <dd>{{ tzNow }}</dd>
              <dt>自动时区</dt>
              <dd>{{ tzCfg?.autotimezone_enabled ? '已开启' : '已关闭' }}</dd>
            </dl>
            <div class="nui-row nui-wrap" style="margin-top: 14px; gap: 10px">
              <n-select
                v-model:value="tzPick"
                size="small"
                filterable
                :loading="zonesA.loading.value"
                :options="zoneOptions"
                placeholder="选择时区（可搜索）"
                style="width: 360px; max-width: 100%"
              />
              <n-button size="small" type="primary" :loading="tzBusy === 'apply'" @click="applyTimezone(false)">保存时区</n-button>
              <n-button size="small" secondary :loading="tzBusy === 'sync'" @click="applyTimezone(true)">用本机时间校准设备</n-button>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              时区列表来自 `system.get_timezone_list`（45 KB，首次加载后缓存）；保存对应官方 `system.set_timezone_config`。
            </p>
          </PanelCard>

          <PanelCard class="span-5" title="NTP 时间同步">
            <template #icon><n-icon><RefreshOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" :type="ntpOk ? 'success' : 'default'">{{ ntpOk ? '已同步' : '未同步' }}</n-tag>
            </template>
            <dl class="nui-kv">
              <dt>NTP 服务</dt>
              <dd v-for="(s, i) in ntpServers" :key="i" class="nui-mono nui-small">{{ s }}</dd>
              <dt v-if="!ntpServers.length">NTP 服务器</dt>
              <dd v-if="!ntpServers.length">—</dd>
            </dl>
            <n-alert v-if="!tzData?.details" type="warning" :bordered="false" style="margin-top: 12px">
              NTP 服务器信息来自插件桥 `sys.details`，当前桥不可用（未安装插件或后端缺失），只能显示时区。
            </n-alert>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              本机固件没有提供修改 NTP 服务器的 RPC（官方时区页也只改时区），如需自定义 NTP 请用 LuCI 或 UCI 操作。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= button ================= -->
    <template v-if="section === 'button'">
      <PageState :loading="btnLoading" :error="btnError" :empty="!btnData" empty-text="拨动开关接口不可用" @retry="reloadBtn">
        <div class="nui-grid">
          <PanelCard class="span-6" title="当前开关位置">
            <template #icon><n-icon><ToggleOutline /></n-icon></template>
            <template #extra>
              <n-button size="tiny" quaternary :loading="btnLoading" @click="reloadBtn(true)">刷新</n-button>
            </template>
            <div class="switch-visual" :class="btnPosOn ? 'on' : 'off'">
              <div class="sw-side"><b>关</b><span>OFF</span></div>
              <div class="sw-track"><div class="sw-knob" :class="{ right: btnPosOn }" /></div>
              <div class="sw-side"><b>开</b><span>ON</span></div>
            </div>
            <div class="switch-pos-text" :class="{ on: btnPosOn }">当前：{{ btnPosText }}</div>
            <dl class="nui-kv" style="margin-top: 12px">
              <dt>拨到 ON 时执行</dt>
              <dd>{{ btnPosFunc }}</dd>
              <dt>硬件开关</dt>
              <dd>{{ btnPos?.supported === false ? '本机不支持' : '支持（GPIO 已连接）' }}</dd>
              <dt>原始读数</dt>
              <dd class="nui-mono nui-small">{{ btnPos?.raw_status || '—' }}</dd>
              <dt>GPIO</dt>
              <dd class="nui-mono nui-small" style="word-break: break-all">{{ btnPos?.gpio || '—' }}</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              位置读取自 GL 官方的 <code>get_switch_button_status</code>（<code>/sys/kernel/debug/gpio</code>），
              拨动后会自动更新（跟随「界面设置 → 刷新频率」），也可点右上角刷新。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="拨动开关功能">
            <template #icon><n-icon><ServerOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" type="info">{{ btnCurrentText }}</n-tag>
            </template>
            <div class="nui-col nui-gap-8">
              <div>
                <div class="nui-small nui-muted" style="margin-bottom: 6px">拨到另一侧时执行的功能</div>
                <n-select v-model:value="btnFunc" size="small" :options="btnOptions" placeholder="选择功能" />
              </div>
              <div v-if="btnSubOptions.length">
                <div class="nui-small nui-muted" style="margin-bottom: 6px">子功能</div>
                <n-select v-model:value="btnSub" size="small" :options="btnSubOptions" placeholder="选择子功能" />
              </div>
              <n-button size="small" type="primary" :loading="btnBusy" @click="saveButton">保存</n-button>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              机身侧面拨动开关（GPIO {{ btnPos?.gpio ? '已连接' : String(timerData?.info?.hardware_feature?.switch_button || '—') }}）。
              修改后立即生效，拨动开关会按新功能执行（例如关闭 Wi-Fi）。
            </p>
          </PanelCard>

          <PanelCard class="span-12" title="可用功能">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <div v-for="f in btnFuncList" :key="f.func" class="nui-list-row">
              <n-tag size="small" :bordered="false" type="default">{{ f.func }}</n-tag>
              <span class="nui-small" style="flex: 1">{{ sys.SWITCH_FUNC_LABEL[f.func] ?? f.func }}</span>
              <span class="nui-small nui-muted">
                {{ f.sub_func?.length ? `子项：${f.sub_func.map((s) => sys.SWITCH_FUNC_LABEL[s.func] ?? s.func).join('、')}` : '' }}
              </span>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              功能清单一来自设备 `switch-button.get_funcs`；保存调用 `switch-button.set_config`（不参与 mesh 同步）。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= fan ================= -->
    <template v-if="section === 'fan'">
      <PageState :loading="fanLoading" :error="fanError" :empty="!fanData" empty-text="风扇接口不可用" @retry="reloadFan">
        <div class="nui-grid">
          <PanelCard class="span-4" title="风扇状态">
            <template #icon><n-icon><ThermometerOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" :type="fanStateType">
                {{ fcStatus ? fanStateText : fanData?.fan.source === 'fan' ? '原厂 fan' : '不可用' }}
              </n-tag>
            </template>
            <div class="nui-big">{{ fanRpm }}<span class="nui-unit">RPM</span></div>
            <div class="nui-small nui-muted">当前转速</div>
            <n-alert v-if="fcStatus && !fanSupported" type="warning" :bordered="false" style="margin-top: 12px">
              当前设备未检测到可用的 PWM 风扇（缺少温度传感器或 cooling device），风扇控制不可用。
            </n-alert>
            <dl class="nui-kv" style="margin-top: 14px">
              <dt>当前温度</dt>
              <dd>{{ fanTemp ?? '—' }} ℃</dd>
              <dt>PWM</dt>
              <dd class="nui-mono">{{ fcStatus?.pwm ?? '—' }} / {{ fcStatus?.pwm_max ?? 255 }}</dd>
              <dt>模式</dt>
              <dd>{{ fcCfg?.mode ?? '—' }}{{ fcCfg?.enabled ? '' : '（已停用）' }}</dd>
              <dt>控制来源</dt>
              <dd>{{ fanOwner }}</dd>
              <dt>进程状态</dt>
              <dd class="nui-small">
                插件 {{ fcStatus?.plugin_running ? '运行' : '停止' }} · 官方 {{ fcStatus?.official_running ? '运行' : '停止' }} · 接管 {{ fcStatus?.takeover ? '是' : '否' }}
              </dd>
              <dt>原厂告警温度</dt>
              <dd>{{ fanData?.officialCfg?.warn_temperature ?? '—' }} ℃</dd>
              <dt>状态原始值</dt>
              <dd class="nui-mono nui-small">{{ fcStatus?.state || '—' }}</dd>
            </dl>
            <div class="fan-temps" v-if="fanTemps.length">
              <div v-for="t in fanTemps" :key="t.label" class="fan-temp">
                <b>{{ t.value }}<span class="nui-unit">℃</span></b>
                <span class="nui-small nui-muted">{{ t.label }}</span>
              </div>
            </div>
            <p v-if="!fcStatus" class="nui-small nui-muted" style="margin: 12px 0 0">
              当前固件没有 fanctrl 扩展（或未加载），只能显示原厂风扇转速，无法调整策略。
            </p>
          </PanelCard>

          <PanelCard class="span-8" title="风扇策略">
            <template #icon><n-icon><SaveOutline /></n-icon></template>
            <template v-if="fcCfg">
              <div class="nui-row nui-wrap" style="gap: 8px; margin-bottom: 12px">
                <n-tag size="small" :bordered="false" :type="fanStateType">{{ fanStateText }}</n-tag>
                <n-tag size="small" :bordered="false" :type="fcStatus?.takeover ? 'success' : 'default'">
                  接管 {{ fcStatus?.takeover ? '是' : '否' }}
                </n-tag>
                <n-tag size="small" :bordered="false">插件服务 {{ fcStatus?.plugin_running ? '运行中' : '已停止' }}</n-tag>
                <n-tag size="small" :bordered="false">官方服务 {{ fcStatus?.official_running ? '运行中' : '已停止' }}</n-tag>
              </div>
              <div class="nui-row nui-wrap" style="gap: 22px; margin-bottom: 14px">
                <div class="nui-row">
                  <span class="nui-small" style="margin-right: 8px">启用自动调速</span>
                  <n-switch :value="fanForm.enabled === 1" @update:value="onFanEnabled" />
                </div>
                <div class="nui-row">
                  <span class="nui-small" style="margin-right: 8px">模式</span>
                  <n-radio-group :value="fanForm.mode" size="small" @update:value="onFanMode">
                    <n-radio-button value="auto">自动（按温度）</n-radio-button>
                    <n-radio-button value="manual">手动（固定转速）</n-radio-button>
                  </n-radio-group>
                </div>
              </div>
              <div class="fan-fields">
                <div class="fan-field"><span>起始温度 ℃</span><n-input-number v-model:value="fanForm.start_temp" size="small" :min="35" :max="85" /></div>
                <div class="fan-field"><span>全速温度 ℃</span><n-input-number v-model:value="fanForm.wall_temp" size="small" :min="40" :max="95" /></div>
                <div class="fan-field"><span>保护温度 ℃</span><n-input-number v-model:value="fanForm.critical_temp" size="small" :min="43" :max="105" /></div>
                <div class="fan-field"><span>回差 ℃</span><n-input-number v-model:value="fanForm.hysteresis" size="small" :min="1" :max="10" /></div>
                <div class="fan-field"><span>起始转速 %</span><n-input-number v-model:value="fanForm.start_percent" size="small" :min="0" :max="100" /></div>
                <div class="fan-field"><span>最高转速 %</span><n-input-number v-model:value="fanForm.max_percent" size="small" :min="0" :max="100" /></div>
                <div class="fan-field"><span>轮询间隔 秒</span><n-input-number v-model:value="fanForm.poll_interval" size="small" :min="1" :max="30" /></div>
                <div class="fan-field"><span>手动转速 %</span><n-input-number v-model:value="fanForm.manual_percent" size="small" :min="0" :max="100" /></div>
              </div>
              <div class="nui-row nui-wrap" style="gap: 10px; margin-top: 14px">
                <n-button size="small" type="primary" :loading="fanBusy === 'save'" @click="saveFanCfg">保存策略</n-button>
                <n-popconfirm @positive-click="restoreFanDefaults">
                  <template #trigger>
                    <n-button size="small" :loading="fanBusy === 'restore'">恢复默认</n-button>
                  </template>
                  确认恢复风扇控制默认设置？（与插件页面「恢复默认」一致：enabled=0、auto、70/76/88℃、回差 3、起始 35%、最高 100%）
                </n-popconfirm>
                <n-button size="small" quaternary :loading="fanLoading" @click="reloadFan(true)">刷新</n-button>
              </div>
            </template>
            <p v-else class="nui-small nui-muted" style="margin: 0">没有 fanctrl 接口，无法编辑风扇策略。</p>

            <div v-if="fcStatus" class="manual-box">
              <div class="nui-small nui-muted" style="margin-bottom: 6px">手动调速（会切到手动模式）</div>
              <div class="nui-row nui-wrap" style="gap: 14px">
                <n-slider v-model:value="manualPct" :step="5" :min="0" :max="100" style="flex: 1; min-width: 220px" />
                <span class="nui-mono nui-small" style="width: 48px">{{ manualPct }}%</span>
                <n-button size="small" secondary :loading="fanBusy === 'test'" @click="applyManual(false)">试转（不保存）</n-button>
                <n-button size="small" type="warning" :loading="fanBusy === 'manual'" @click="applyManual(true)">应用并保存</n-button>
              </div>
              <div class="nui-small nui-muted" style="margin-top: 8px">
                0% 关闭风扇，1%–100% 直接接管 PWM；「应用并保存」会写入配置并重启风扇服务，重启设备后仍生效。
              </div>
            </div>
          </PanelCard>

          <PanelCard class="span-12" title="增强温控曲线（智能模式，只读）">
            <template #icon><n-icon><ThermometerOutline /></n-icon></template>
            <template v-if="smartPoints.length">
              <div class="smart-curve">
                <div v-for="(p, i) in smartPoints" :key="i" class="smart-point">
                  <b>{{ p.temp }}<span class="nui-unit">℃</span></b>
                  <span class="nui-small nui-muted">→ {{ p.speed }}%</span>
                </div>
                <div class="smart-meta nui-small nui-muted">
                  最低转速 {{ enhFan?.smart?.min ?? '—' }}% · 回差 {{ enhFan?.smart?.hyst ?? '—' }}℃ · 取值来源 {{ enhFan?.smart?.source ?? '—' }}
                </div>
              </div>
              <p class="nui-small nui-muted" style="margin: 12px 0 0">
                这条曲线由增强运行时的「smart」温控维护（<code>enh.fan_get.smart</code>），与上面 fanctrl 是两套语义：
                smart 模式会停掉原厂 fanctrl，按曲线调速。本面板只读展示，避免与 fanctrl 策略互相覆盖。
              </p>
            </template>
            <p v-else class="nui-small nui-muted" style="margin: 0">插件桥未返回增强温控曲线（enh.fan_get 不可用或未启用 smart 模式）。</p>
          </PanelCard>

          <PanelCard class="span-6" title="温度提醒（增强运行时）">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <template v-if="enhAlert">
              <dl class="nui-kv">
                <dt>提醒开关</dt>
                <dd>{{ enhAlert.enabled ? '已开启' : '已关闭' }}</dd>
                <dt>SoC 阈值</dt>
                <dd>{{ enhAlert.soc_temp ?? '—' }} ℃</dd>
                <dt>模组阈值</dt>
                <dd>{{ enhAlert.module_temp ?? '—' }} ℃</dd>
                <dt>重复间隔</dt>
                <dd>{{ enhAlert.interval ?? '—' }} 分钟</dd>
                <dt>通知渠道</dt>
                <dd class="nui-small">
                  {{ [enhAlert.sms ? `短信 ${enhAlert.sms_number || ''}` : '', enhAlert.webhook ? 'Webhook' : '', enhAlert.app ? '官方 App' : ''].filter(Boolean).join(' / ') || '未配置' }}
                </dd>
              </dl>
              <div v-if="alertHistory.length" style="margin-top: 10px">
                <div class="nui-small nui-muted" style="margin-bottom: 4px">最近提醒</div>
                <div v-for="(h, i) in alertHistory" :key="i" class="nui-small nui-mono">{{ h.time || h.ts || '' }} {{ h.text || h.title || JSON.stringify(h) }}</div>
              </div>
              <n-alert type="info" :bordered="false" style="margin-top: 12px">
                温度提醒的阈值/短信/Webhook 由增强运行时（面板自带）维护，本面板只读展示。
              </n-alert>
            </template>
            <p v-else class="nui-small nui-muted" style="margin: 0">插件桥不可用（enh.overview 调用失败），无法读取温度提醒配置。</p>
          </PanelCard>

          <PanelCard class="span-6" title="说明">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 8px">
              风扇控制由 <b>gl-fanctrl 插件（0.1.3）</b> 提供：RPC 对象 <code>fanctrl</code>（非原厂接口）+ <code>gl-fanctrl-daemon</code> 守护进程；
              本页读写 <code>get_status</code> / <code>set_config</code> / <code>set_manual</code> / <code>restore_defaults</code>，
              与插件页 <code>gl_home.html#/fanctrl</code> 的功能一一对应。未装插件时自动退回只读的原厂 <code>fan.get_status</code>。
            </p>
            <p class="nui-small nui-muted" style="margin: 0 0 8px">
              写入前会按官方视图的边界做收敛（起始 35-85℃、全速 40-95℃、保护 43-105℃、回差 1-10℃、转速 0-100%），
              避免把无效值写进配置导致风扇逻辑异常。
            </p>
            <p class="nui-small nui-muted" style="margin: 0">
              温度来源：glass.get_status.temps（soc/mcusys/eth2p5g）与插件桥 enh.fan_get.temps。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= reset ================= -->
    <template v-if="section === 'reset'">
      <PageState :loading="resetLoading" :error="resetError" :empty="!resetData" empty-text="系统操作接口不可用" @retry="reloadReset">
        <div class="nui-grid">
          <PanelCard class="span-6" title="重启设备">
            <template #icon><n-icon><PowerOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              设备会立即重启，Wi-Fi 与网络中断约 40-60 秒；已保存的配置不受影响。
            </p>
            <n-popconfirm @positive-click="doReboot">
              <template #trigger>
                <n-button size="small" type="warning" secondary :loading="rebootBusy">重启设备</n-button>
              </template>
              确定要重启吗？设备将在 1 分钟后恢复。
            </n-popconfirm>
          </PanelCard>

          <PanelCard class="span-6" title="恢复出厂设置">
            <template #icon><n-icon><PowerOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              清空全部配置（Wi-Fi / 网络 / 管理员密码 / 插件 / 本后台），回到首次开机向导。此固件没有「保留设置」选项，操作不可撤销。
            </p>
            <n-button size="small" type="error" secondary :loading="resetBusy" @click="doResetFirmware">恢复出厂设置</n-button>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              调用官方 <code>system.reset_firmware</code>；执行前需要输入确认词。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="配置备份">
            <template #icon><n-icon><SaveOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              导出当前配置（官方 cgi-backup，内部为 sysupgrade 打包）。
            </p>
            <n-button size="small" type="primary" :loading="backupBusy" @click="doBackup">导出配置备份</n-button>
            <n-alert v-if="backupErr" type="warning" :bordered="false" style="margin-top: 12px">
              {{ backupErr }}。<br />
              这是固件限制：<code>cgi-backup</code> 只认 LuCI 会话，不认 /rpc 会话。
              <span v-if="luciInstalled">可打开 <a :href="luciFlashUrl" target="_blank" style="text-decoration: underline">LuCI 备份/刷机页</a> 手动导出。</span>
              <span v-else>本机未安装 LuCI，可先在「高级设置」里安装，或使用官方升级页。</span>
            </n-alert>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              备份文件名形如 backup-YYYY-MM-DD.tar.gz；导出后请自己妥善保存（含 Wi-Fi 密码与密钥）。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="配置恢复与固件">
            <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              官方固件**没有**提供配置恢复的 RPC/HTTP 接口（cgi-backup 只能导出），因此本面板不支持「上传配置恢复」。
              需要恢复时：用官方后台或 LuCI 的「备份/刷机 → 恢恢复备份」，或直接恢复出厂后重配。
            </p>
            <div class="nui-row nui-wrap">
              <n-button size="small" secondary tag="a" href="/gl_home.html?official=1#/upgrade" target="_blank">官方升级 / 备份页</n-button>
              <n-button v-if="luciInstalled" size="small" secondary tag="a" :href="luciFlashUrl" target="_blank">LuCI 备份 / 刷机页</n-button>
            </div>
          </PanelCard>
        </div>
      </PageState>
    </template>

    <!-- ================= logs ================= -->
    <template v-if="section === 'logs'">
      <div class="nui-grid">
        <PanelCard class="span-12" title="系统日志" flush>
          <template #icon><n-icon><DocumentTextOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row nui-wrap">
              <n-select v-model:value="logKind" size="small" style="width: 132px" :options="LOG_KINDS" @update:value="loadLog" />
              <n-select
                v-if="logKind === 'system'"
                v-model:value="logLinesOpt"
                size="small"
                style="width: 132px"
                :options="logLineOptions"
                @update:value="loadLog"
              />
              <n-input v-model:value="logKeyword" size="small" placeholder="关键字过滤（前端）" clearable style="width: 180px" />
              <n-button size="small" secondary :loading="logBusy" @click="loadLog">
                <template #icon><n-icon><RefreshOutline /></n-icon></template>
                刷新
              </n-button>
              <n-button size="small" secondary :loading="logExportBusy" @click="exportLog">导出</n-button>
              <n-button size="small" quaternary @click="copyLog">复制本页</n-button>
            </div>
          </template>

          <div class="log-meta">
            <span class="nui-small nui-muted">
              {{ logKind === 'kernel' ? '内核日志接口返回全量 dmesg，这里按行分页显示' : logKind === 'crash' ? '崩溃日志' : '系统日志' }} ·
              共 {{ logFiltered.length }} 行<span v-if="logKeyword">（已过滤，原始 {{ logAllLines.length }} 行）</span>
              · 第 {{ logPage + 1 }} / {{ logPageCount }} 页
            </span>
            <div class="nui-row">
              <n-button size="tiny" quaternary :disabled="logPage <= 0" @click="logPage--">较新</n-button>
              <n-button size="tiny" quaternary :disabled="logPage >= logPageCount - 1" @click="logPage++">较旧</n-button>
              <n-button size="tiny" quaternary :disabled="logPage === 0" @click="logPage = 0">回到最新</n-button>
            </div>
          </div>

          <PageState :loading="logBusy" :error="logError" :empty="!logBusy && !logFiltered.length" :empty-text="logKind === 'crash' ? '没有崩溃日志（正常）' : '没有日志内容或关键字无匹配'">
            <pre class="log">{{ logWindow.lines.join('\n') || '加载中…' }}</pre>
          </PageState>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            日志导出走官方 <code>logread.export_logs</code> + <code>/download</code>（生成 /tmp/logread.tar 后取回）；关键字过滤在前端做，不会把关键字发给设备。
          </p>
        </PanelCard>
      </div>
    </template>

    <!-- ================= advanced ================= -->
    <template v-if="section === 'advanced'">
      <PageState :loading="advLoading" :error="advError" :empty="!advData" empty-text="高级设置接口不可用" @retry="reloadAdv">
        <div class="nui-grid">
          <PanelCard class="span-12" title="默认后台">
            <template #icon><n-icon><ServerOutline /></n-icon></template>
            <div class="nui-between" style="gap: 14px">
              <div>
                <b>访问路由器地址时打开增强 WebUI</b>
                <p class="nui-small nui-muted" style="margin: 6px 0 0; line-height: 1.7">
                  开启后访问 http://路由器地址/、原厂登录页和原厂首页都会进入本界面；要用原厂界面，
                  在登录页点「使用原厂界面」或在右上角菜单选「切换到原厂界面」。关闭即恢复原厂首页
                  （不修改官方文件；本面板只增删自己的 nginx 片段，可逐字节还原）。
                </p>
              </div>
              <n-switch :value="rootEnabled" :loading="rootBusy" @update:value="toggleRoot" />
            </div>
          </PanelCard>

          <PanelCard class="span-6" title="LuCI / OpenWrt 原生界面">
            <template #icon><n-icon><ServerOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" :type="luciStatus === 2 ? 'success' : luciStatus === 1 || luciStatus === 3 ? 'warning' : 'default'">
                {{ luciStatusText }}
              </n-tag>
            </template>
            <dl class="nui-kv">
              <dt>状态码</dt>
              <dd class="nui-mono">{{ luciStatus }}</dd>
              <dt>LuCI 端口</dt>
              <dd>{{ advLa?.luci_http_port || '—' }} / {{ advLa?.luci_https_port || '—' }}</dd>
              <dt>访问地址</dt>
              <dd class="nui-small nui-mono">{{ advLuciUrl }}</dd>
            </dl>
            <div class="nui-row nui-wrap" style="margin-top: 12px">
              <n-button v-if="luciStatus === 2" size="small" type="primary" secondary tag="a" :href="advLuciUrl" target="_blank">打开 LuCI</n-button>
              <n-popconfirm v-if="luciStatus !== 2" @positive-click="installLuci">
                <template #trigger>
                  <n-button size="small" type="primary" :loading="advBusy === 'install'">安装 LuCI</n-button>
                </template>
                将从 GL 软件源下载并安装 LuCI（约 1-3 分钟，需要外网）。继续？
              </n-popconfirm>
              <n-popconfirm v-if="luciStatus === 2" @positive-click="uninstallLuci">
                <template #trigger>
                  <n-button size="small" type="error" secondary :loading="advBusy === 'uninstall'">卸载 LuCI</n-button>
                </template>
                卸载会移除 OpenWrt 原生后台（不影响本面板），确定继续？
              </n-popconfirm>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              LuCI 由 <code>luci.get_status</code> / <code>install_luci</code> / <code>uninstall_luci</code> 管理；
              本机 uhttpd 监听 8080/8443，与 nginx 的 80/443 互不影响。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="本地访问">
            <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
            <dl class="nui-kv">
              <dt>HTTP / HTTPS 端口</dt>
              <dd>{{ advLa?.http_port ?? '—' }} / {{ advLa?.https_port ?? '—' }}</dd>
              <dt>强制 HTTPS</dt>
              <dd>{{ advLa?.redirect_https ? '是' : '否' }}</dd>
              <dt>LuCI 强制 HTTPS</dt>
              <dd>{{ advLa?.luci_redirect_https ? '是' : '否' }}</dd>
              <dt>SSH</dt>
              <dd>{{ advLa?.ssh_enabled ? `已启用（${advLa?.ssh_port ?? 22}）` : '已禁用' }}</dd>
              <dt>会话超时</dt>
              <dd>{{ advLa?.session_timeout ?? '—' }} 秒</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              本地访问端口由官方「安全 → 管理员访问」页管理（<code>local-access.set_config</code>），
              为避免把自己挡在门外，本面板只读展示。
            </p>
            <p class="nui-small nui-muted" style="margin: 8px 0 0">
              SSH 开关/端口在「账号与 SSH」页修改（插件桥 <code>enh.ssh_set</code>）。
            </p>
          </PanelCard>
          <PanelCard class="span-12" title="官方入口">
            <template #icon><n-icon><OpenOutline /></n-icon></template>
            <div class="official-links">
              <button class="official-link" @click="openExternal('/gl_home.html')">
                <b>GL 官方后台</b><span>原厂首页（所有官方功能的入口）</span>
              </button>
              <button class="official-link" @click="openExternal('/gl_home.html#/fanctrl')">
                <b>官方风扇控制</b><span>gl-fanctrl 插件页面（接管/手动/PWM）</span>
              </button>
              <button class="official-link" @click="openExternal('/gl_home.html#/button')">
                <b>官方按钮设置</b><span>拨动开关功能（与上方位置卡片对应）</span>
              </button>
              <button class="official-link" @click="openExternal('/gl_home.html#/upgrade')">
                <b>官方固件升级</b><span>在线升级 / 本地固件 / 自动升级</span>
              </button>
              <button class="official-link" @click="openExternal('/gl_home.html#/log')">
                <b>官方系统日志</b><span>系统 / 内核 / 崩溃日志</span>
              </button>
              <button class="official-link" @click="openExternal('/gl_home.html#/reset')">
                <b>官方重启 / 恢复</b><span>重启、恢复出厂、配置备份</span>
              </button>
              <button class="official-link" @click="openExternal('/gl_home.html#/network')">
                <b>官方网络设置</b><span>WAN / LAN / IPv6 等原始参数</span>
              </button>
              <button class="official-link" :disabled="luciStatus !== 2" @click="openExternal(advLuciUrl)">
                <b>OpenWrt LuCI</b><span>{{ luciStatus === 2 ? '原生 LuCI（已安装）' : '未安装 LuCI（可在左侧卡片安装）' }}</span>
              </button>
            </div>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              以上都是官方页面，新标签页打开，不经过本面板的封装；官方页面里的改动会同时反映到本面板。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>
    <template v-if="section === 'ui'">
      <div class="nui-grid">
        <PanelCard class="span-12" title="启用美化">
          <template #icon><n-icon><ColorPaletteOutline /></n-icon></template>
          <div class="nui-between" style="gap: 16px; align-items: flex-start">
            <div>
              <b>给面板叠加主题色、圆角、背景和卡片不透明度</b>
              <p class="nui-small nui-muted" style="margin: 4px 0 0">
                关闭后恢复默认深色 / 浅色皮肤；这些设置保存在浏览器本地，不影响官方后台。
              </p>
            </div>
            <n-switch :value="ui.appearance.beautify" @update:value="(v: boolean) => ui.setAppearance({ beautify: v })" />
          </div>
          <div class="nui-row" style="margin: 16px 0 0">
            <span class="nui-small" style="flex: 1">折叠侧栏</span>
            <n-switch :value="ui.collapsed" @update:value="ui.toggleCollapsed()" />
          </div>
        </PanelCard>

        <PanelCard class="span-6" title="配色模式">
          <template #icon><n-icon><ColorPaletteOutline /></n-icon></template>
          <n-radio-group :value="ui.mode" size="small" @update:value="setTheme">
            <n-radio-button v-for="o in THEME_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
          </n-radio-group>
          <div class="nui-small nui-muted" style="margin: 16px 0 8px">主题色</div>
          <div class="nui-row nui-wrap" style="gap: 10px">
            <button
              v-for="c in ACCENT_PRESETS"
              :key="c"
              class="swatch"
              :class="{ active: ui.appearance.accent.toLowerCase() === c.toLowerCase() }"
              :style="{ background: c }"
              :aria-label="c"
              @click="setAccent(c)"
            />
            <label class="color-wrap">
              <input :value="ui.appearance.accent" type="color" class="color-input" @input="setAccent(($event.target as HTMLInputElement).value)" />
              <span class="nui-small">自定义</span>
            </label>
          </div>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">主色会立即同步到按钮、菜单、选中态和图表强调色。</p>
        </PanelCard>

        <PanelCard class="span-6" title="圆角">
          <template #icon><n-icon><ColorPaletteOutline /></n-icon></template>
          <n-radio-group :value="ui.appearance.radius" size="small" @update:value="setRadius">
            <n-radio-button v-for="o in RADIUS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
          </n-radio-group>
          <div class="radius-demo" :style="{ borderRadius: `${ui.radiusPx}px` }">
            <span class="nui-small nui-muted">卡片 / 按钮 / 弹窗统一 {{ ui.radiusPx }}px 圆角</span>
          </div>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            圆角同时作用于 Naive 组件与面板卡片；个别第三方图表内部圆角不跟随。
          </p>
        </PanelCard>

        <PanelCard class="span-12" title="背景">
          <template #icon><n-icon><ColorPaletteOutline /></n-icon></template>
          <n-radio-group :value="ui.appearance.bg" size="small" @update:value="setBg">
            <n-radio-button v-for="o in BG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
          </n-radio-group>

          <div v-if="ui.appearance.bg === 'aurora'" class="bg-custom">
            <div class="nui-small nui-muted" style="margin-bottom: 8px">极光配色（立即生效，随外观设置跨设备同步）</div>
            <div class="nui-row nui-wrap" style="gap: 8px">
              <button v-for="o in AURORA_OPTIONS" :key="o.value" class="aurora-btn" :class="{ on: ui.appearance.aurora === o.value }" @click="setAuroraPreset(o.value)">
                <span class="aurora-dot" :style="{ background: auroraPreview(o.colors) }" />
                {{ o.label }}
              </button>
            </div>
          </div>
          <div v-else-if="ui.appearance.bg === 'pure'" class="bg-custom">
            <div class="nui-between" style="gap: 12px">
              <div>
                <b>纯色颜色</b>
                <p class="nui-small nui-muted" style="margin: 4px 0 0">可点下方预设或右侧取色器自定义；立即生效并同步到其它设备。</p>
              </div>
              <n-color-picker :value="purePickValue" size="small" :modes="['hex']" style="width: 180px" @update:value="setPureColor" />
            </div>
            <div class="nui-row nui-wrap" style="gap: 8px; margin-top: 10px">
              <button v-for="c in PURE_SWATCHES" :key="c" class="pure-swatch" :class="{ on: (ui.appearance.pureColor || '').toLowerCase() === c.toLowerCase() }" :style="{ background: c }" :title="c" @click="setPureColor(c)" />
              <n-button size="tiny" quaternary @click="ui.setAppearance({ pureColor: '' })">跟随主题</n-button>
            </div>
          </div>
          <div v-if="ui.appearance.bg === 'wallpaper'" class="wallpaper-row">
            <div class="wallpaper-preview" :style="{ backgroundImage: ui.appearance.wallpaper ? `url(${ui.appearance.wallpaper})` : 'none', backgroundSize: fitCss }">
              <span v-if="!ui.appearance.wallpaper" class="nui-small nui-muted">未选择壁纸</span>
            </div>
            <div class="wallpaper-ops">
              <div class="nui-row nui-wrap" style="gap: 8px">
                <n-button size="small" type="primary" secondary :loading="wallpaperBusy" @click="pickWallpaper">上传图片</n-button>
                <input ref="wallpaperFile" type="file" accept="image/*" style="display: none" @change="onWallpaperFile" />
                <n-input v-model:value="wallpaperUrl" size="small" placeholder="或填写图片链接 https://..." style="flex: 1; min-width: 240px" />
                <n-button size="small" @click="applyWallpaperUrl">应用链接</n-button>
                <n-button size="small" quaternary :disabled="!ui.appearance.wallpaper" @click="clearWallpaper">清除壁纸</n-button>
              </div>
              <div class="nui-between" style="margin-top: 14px; gap: 12px">
                <div>
                  <b>壁纸适配</b>
                  <p class="nui-small nui-muted" style="margin: 4px 0 0">按图片尺寸自适应屏幕：铺满裁剪 / 完整显示（空白处重复平铺）/ 拉伸铺满</p>
                </div>
                <n-radio-group :value="ui.appearance.wallpaperFit" size="small" @update:value="setWallpaperFit">
                  <n-radio-button value="cover">铺满裁剪</n-radio-button>
                  <n-radio-button value="contain">完整显示</n-radio-button>
                  <n-radio-button value="stretch">拉伸铺满</n-radio-button>
                </n-radio-group>
              </div>
              <p class="nui-small nui-muted" style="margin: 8px 0 0">
                上传的图片会先在浏览器里压缩（长边 ≤ 2560px，JPEG）并保存到路由器 /www/glass-media/，手机 / 电脑所有设备自动同步。
              </p>
            </div>
          </div>
          <div v-else-if="ui.appearance.bg === 'video'" class="wallpaper-row">
            <video v-if="ui.appearance.video" class="wallpaper-preview" :src="ui.appearance.video" muted loop autoplay playsinline />
            <div v-else class="wallpaper-preview"><span class="nui-small nui-muted">未选择视频</span></div>
            <div class="wallpaper-ops">
              <div class="nui-row nui-wrap" style="gap: 8px">
                <n-button size="small" type="primary" secondary :loading="videoBusy" @click="pickVideo">上传视频</n-button>
                <input ref="videoFile" type="file" accept="video/mp4,video/webm,video/*" style="display: none" @change="onVideoFile" />
                <n-input v-model:value="videoUrlInput" size="small" placeholder="或填写视频链接 https://...mp4" style="flex: 1; min-width: 240px" />
                <n-button size="small" @click="applyVideoUrl">应用链接</n-button>
                <n-button size="small" quaternary :disabled="!ui.appearance.video" @click="clearVideo">清除视频</n-button>
              </div>
              <p class="nui-small nui-muted" style="margin: 8px 0 0">
                视频会上传到路由器 /www/glass-media/（建议 ≤40MB，MP4/WebM），背景自动静音循环播放；也支持外链视频。所有设备同步。
              </p>
              <n-progress v-if="videoBusy" :percentage="videoPct" style="margin-top: 8px" />
            </div>
          </div>
          <p v-else class="nui-small nui-muted" style="margin: 10px 0 0">
            极光渐变可选 5 套配色；纯色可选取色器 / 预设颜色或「跟随主题」；选「壁纸」后可以上传图片或填图片链接。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="毛玻璃与不透明度">
          <template #icon><n-icon><ColorPaletteOutline /></n-icon></template>
          <div class="nui-between">
            <div>
              <b>毛玻璃</b>
              <p class="nui-small nui-muted" style="margin: 4px 0 0">卡片半透明并模糊背景；配合壁纸效果最好，老设备可关闭。</p>
            </div>
            <n-switch :value="ui.appearance.frosted" @update:value="(v: boolean) => ui.setAppearance({ frosted: v })" />
          </div>
          <div class="nui-small nui-muted" style="margin: 16px 0 6px">卡片不透明度 {{ ui.appearance.cardAlpha }}%</div>
          <n-slider
            :value="ui.appearance.cardAlpha"
            :min="30"
            :max="100"
            :step="1"
            @update:value="(v: number) => ui.setAppearance({ cardAlpha: v })"
          />
          <p class="nui-small nui-muted" style="margin: 10px 0 0">数值越低越透明；关闭毛玻璃时此项不生效。</p>
        </PanelCard>

        <PanelCard class="span-6" title="首页">
          <template #icon><n-icon><TimeOutline /></n-icon></template>
          <div class="nui-between" style="gap: 16px; align-items: flex-start">
            <div>
              <b>实时速率显示最近记录</b>
              <p class="nui-small nui-muted" style="margin: 4px 0 0">
                开启后路由器每 3 秒在内存里记一次总速率，只保留首页曲线能显示的最近 3 分钟（重启即清空）；
                打开首页时曲线直接是满的，只用于首页显示，不会保存长期历史。
              </p>
            </div>
            <n-switch :value="ui.rateHistory" :loading="rateBusy" @update:value="toggleRateHistory" />
          </div>
        </PanelCard>

        <PanelCard class="span-6" title="刷新频率">
          <template #icon><n-icon><TimeOutline /></n-icon></template>
          <div class="nui-small nui-muted" style="margin-bottom: 6px">整个后台的轮询刷新间隔（所有页面统一生效，立即应用并记住）</div>
          <n-select :value="ui.refreshSec" size="small" :options="REFRESH_OPTIONS" style="max-width: 200px" @update:value="setRefreshSec" />
          <div class="nui-row nui-wrap" style="gap: 8px; margin-top: 12px">
            <n-tag size="small" :bordered="false" type="info">当前：每 {{ ui.refreshSec }} 秒</n-tag>
            <span class="nui-small nui-muted">2 秒最实时；60 秒最省请求 / 最省电</span>
          </div>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            影响到概览指标、互联网状态、无线、终端、系统信息、风扇、按钮位置等所有自动刷新的页面；
            测速 / 诊断这类“正在跑的任务”按任务自身节奏刷新，不受影响。登录会话心跳固定 60 秒，也不受此设置影响。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="语言与增强运行时">
          <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
          <template v-if="!uiLoading && !uiError">
            <dl class="nui-kv">
              <dt>官方后台语言</dt>
              <dd>{{ officialLang }}</dd>
              <dt>本面板语言</dt>
              <dd>简体中文（暂只提供中文）</dd>
              <dt>增强运行时</dt>
              <dd>{{ nuiCfg ? '已内置（测速 / 诊断 / 监控 / SSH / 风扇增强）' : '不可用（相关页面自动降级）' }}</dd>
              <dt>NUI 前端页面</dt>
              <dd>已随插件移除（/nui/ 不再使用）</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 14px 0 0">
              面板已内置所需的最小后端运行时；主题、配色、界面增强都在本面板内设置，不再依赖 NUI 页面。
            </p>
          </template>
          <PageState v-else :loading="uiLoading" :error="uiError" empty-text="读取失败" @retry="reloadUi" />
        </PanelCard>

        <PanelCard class="span-6" title="关于本面板">
          <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
          <dl class="nui-kv">
            <dt>面板版本</dt>
            <dd>{{ BUILD_VERSION }}</dd>
            <dt>界面</dt>
            <dd>Vue 3 + Naive UI</dd>
            <dt>数据源</dt>
            <dd class="nui-mono nui-small">GL SDK4 /rpc + glass + nui 桥</dd>
            <dt>设备</dt>
            <dd>{{ iInfo?.model || 'GL-MT3600BE' }}</dd>
            <dt>NUI 桥</dt>
            <dd>{{ nuiCfg ? '可用' : '不可用' }}</dd>
          </dl>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            NUI 桥（<code>nui.invoke</code>）用于 SSH / 风扇增强 / 温度提醒 / 系统详情；桥缺失时相关卡片会显示降级说明。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="数据与刷新">
          <template #icon><n-icon><RefreshOutline /></n-icon></template>
          <p class="nui-small nui-muted" style="margin: 0 0 10px">
            系统信息与风扇状态每 5 秒自动刷新（页面隐藏时暂停）；其余页面首屏加载一次，写操作后自动回读。
          </p>
          <div class="nui-row nui-wrap">
            <n-button size="small" secondary @click="reloadInfo(true)">刷新系统信息</n-button>
            <n-button size="small" secondary @click="reloadFan(true)">刷新风扇</n-button>
            <n-button size="small" secondary @click="reloadUi(true)">刷新界面配置</n-button>
          </div>
        </PanelCard>
      </div>
    </template>

    <!-- 危险操作统一确认 -->
    <n-modal v-model:show="danger.show" preset="card" style="width: 520px; max-width: 92vw" :title="danger.title" :bordered="false">
      <p class="nui-small" style="white-space: pre-wrap; margin-top: 0">{{ danger.text }}</p>
      <p class="nui-small nui-muted">
        请输入 <b class="nui-mono">{{ danger.word }}</b> 确认：
      </p>
      <n-input v-model:value="danger.input" :placeholder="danger.word" @keyup.enter="confirmDanger" />
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button size="small" @click="danger.show = false">取消</n-button>
          <n-button size="small" type="error" :disabled="danger.input !== danger.word" :loading="danger.busy" @click="confirmDanger">
            确认执行
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.gauges {
  display: flex;
  justify-content: space-around;
  gap: 8px;
  flex-wrap: wrap;
}
.wifi-row {
  padding: 10px 0;
  border-top: 1px dashed var(--line-dash);
}
.wifi-row:first-of-type {
  border-top: none;
}
.fan-temps {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.fan-temp {
  flex: 1;
  min-width: 84px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--chip);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fan-temp b {
  font-size: 18px;
  font-weight: 650;
}
.fan-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 12px;
}
.fan-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--chip);
}
.fan-field :deep(.n-input-number) {
  width: 92px;
}
.manual-box {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--line-dash);
}
.smart-curve {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.smart-point {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--chip);
}
.smart-point b {
  font-size: 17px;
  font-weight: 650;
}
.smart-meta {
  margin-left: auto;
}
.log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 4px 10px 8px;
}
.log {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  font-size: 11.5px;
  line-height: 1.62;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60vh;
  overflow: auto;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.color-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.radius-demo {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--nui-radius);
  background: rgba(128, 128, 128, 0.08);
}
.wallpaper-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.wallpaper-preview {
  width: 200px;
  height: 116px;
  flex: 0 0 auto;
  border-radius: 10px;
  border: 1px solid var(--line);
  background-color: rgba(128, 128, 128, 0.1);
  background-size: cover;
  background-position: center;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.wallpaper-ops {
  flex: 1;
  min-width: 300px;
  padding-top: 2px;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.swatch.active {
  border-color: var(--text);
}
.color-input {
  width: 34px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.switch-visual {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 6px 0 10px;
}
.sw-side { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 13px; opacity: 0.5; min-width: 30px; }
.sw-side span { font-size: 10px; letter-spacing: 1px; }
.switch-visual.on .sw-side:last-child, .switch-visual.off .sw-side:first-child { opacity: 1; }
.sw-track {
  position: relative;
  width: 96px;
  height: 40px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.22);
  border: 1px solid var(--line);
  transition: background 0.2s;
}
.switch-visual.on .sw-track { background: rgba(34, 197, 94, 0.32); border-color: rgba(34, 197, 94, 0.6); }
.sw-knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #e5e7eb;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  transition: left 0.18s ease;
}
.sw-knob.right { left: 60px; }
.switch-pos-text { font-size: 22px; font-weight: 650; letter-spacing: 0.5px; }
.switch-pos-text.on { color: #22c55e; }
.official-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.official-link {
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(128, 128, 128, 0.06);
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.official-link:hover { border-color: var(--nui-accent, var(--nui-accent)); }
.official-link:disabled { opacity: 0.45; cursor: not-allowed; }
.official-link b { font-size: 13px; font-weight: 600; }
.official-link span { font-size: 12px; opacity: 0.6; }

.bg-custom {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line-dash);
}
.aurora-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--card-2);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.aurora-btn.on { border-color: var(--nui-accent); box-shadow: 0 0 0 1px var(--nui-accent); }
.aurora-dot { width: 22px; height: 14px; border-radius: 4px; display: inline-block; }
.pure-swatch {
  width: 30px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--line);
  cursor: pointer;
}
.pure-swatch.on { outline: 2px solid var(--nui-accent); outline-offset: 1px; }
</style>
