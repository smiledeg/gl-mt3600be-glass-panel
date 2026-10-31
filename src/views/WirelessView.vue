<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NDataTable,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NRadio,
  NRadioGroup,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  GitNetworkOutline,
  LinkOutline,
  LockClosedOutline,
  RefreshOutline,
  ScanOutline,
  WifiOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import { useAsync } from '@/composables/useAsync'
import { useDeviceStore } from '@/stores/device'
import {
  loadBwl,
  loadRepeaterPage,
  loadWifiPage,
  repeaterBareMode,
  repeaterConnect,
  repeaterDisconnect,
  repeaterForget,
  saveBwl,
  saveMloConfig,
  saveRepeaterConfig,
  saveWifiEnvironment,
  saveWifiIface,
  scanRepeater,
  type AnyRec,
  type BwlState,
  type RepeaterPage,
  type ScanApEx,
  type WifiIfaceEx,
  type WifiPage,
} from '@/api/core'

const props = defineProps<{ section?: string }>()
const message = useMessage()
const router = useRouter()
const device = useDeviceStore()

const section = computed(() => {
  const s = String(props.section || 'wifi')
  return ['wifi', 'guest', 'repeater', 'acl'].includes(s) ? s : 'wifi'
})

const wifiData = useAsync<WifiPage>(loadWifiPage, { interval: 0, immediate: false })
const repData = useAsync<RepeaterPage>(loadRepeaterPage, { interval: 20000, immediate: false })
const aclData = useAsync<BwlState>(loadBwl, { interval: 0, immediate: false })

function activate() {
  if (section.value === 'repeater') {
    wifiData.stop()
    aclData.stop()
    repData.start()
    void repData.reload()
  } else if (section.value === 'acl') {
    wifiData.stop()
    repData.stop()
    aclData.start()
    void aclData.reload()
  } else {
    repData.stop()
    aclData.stop()
    wifiData.start()
    void wifiData.reload()
  }
}
onMounted(activate)
watch(section, activate)

const page = computed(() => wifiData.data.value)
const bands = computed(() => page.value?.bands ?? [])
const mains = computed(() => (page.value?.ifaces ?? []).filter((i) => !i.guest && !i.iot))
const radioState = computed(() => page.value?.radios ?? {})
const bandLabel = (band: string) => (String(band).toUpperCase() === '2G' ? '2.4 GHz' : String(band).toUpperCase() === '5G' ? '5 GHz' : String(band))
const ifaceStatus = (name: string) => (page.value?.status ?? []).find((x) => String(x.name) === name) ?? null
const radioOf = (band: string) => (radioState.value[String(band).toLowerCase()] ?? null) as AnyRec | null

/* ================= Wi-Fi 主网络草稿 ================= */
interface BandDraft {
  iface: string
  band: string
  device: string
  ssid: string
  key: string
  encryption: string
  hidden: boolean
  enabled: boolean
  txpower: string
  htmode: string
  channel: number
  adv: boolean
}
const drafts = ref<BandDraft[]>([])
const savingBand = ref('')

function syncDrafts() {
  const p = page.value
  if (!p) return
  drafts.value = mains.value.map((i: WifiIfaceEx) => ({
    iface: String(i.name ?? ''),
    band: i.band,
    device: i.device,
    ssid: String(i.ssid ?? ''),
    key: String(i.key ?? ''),
    encryption: String(i.encryption ?? 'psk2'),
    hidden: !!i.hidden,
    enabled: i.enabled !== false,
    txpower: String(i.bandConf.txpower ?? 'Max'),
    htmode: String(i.bandConf.htmode ?? 'auto'),
    channel: Number(i.bandConf.channel ?? 0),
    adv: false,
  }))
}
watch(page, syncDrafts, { immediate: true })

const ENC_LABEL: Record<string, string> = {
  none: '开放（无密码）',
  psk2: 'WPA2-Personal',
  'psk-mixed': 'WPA/WPA2-Personal',
  sae: 'WPA3-Personal',
  'sae-mixed': 'WPA2/WPA3-Personal',
}
const encOptions = (d: BandDraft) => {
  const band = bands.value.find((b) => String(b.band) === d.band)
  const list = band?.encryptions ?? ['psk2', 'sae-mixed']
  return list.map((e) => ({ label: ENC_LABEL[e] ?? e.toUpperCase(), value: e }))
}
const htmodeOptions = (d: BandDraft) => {
  const band = bands.value.find((b) => String(b.band) === d.band)
  const ht = (band?.htmodes ?? {}) as Record<string, unknown>
  const base = Number(ht[String(band?.hwmode ?? '')] ?? 0)
  const opts: { label: string; value: string }[] = []
  if (base > 0) {
    for (let v = base; v >= 20; v = Math.floor(v / 2)) opts.push({ label: `${v} MHz`, value: String(v) })
  }
  if (ht.auto) opts.push({ label: '自动（最大带宽）', value: 'auto' })
  if (!opts.length) opts.push({ label: '自动', value: 'auto' })
  return opts
}
const channelOptions = (d: BandDraft) => {
  const band = bands.value.find((b) => String(b.band) === d.band)
  const chans = band?.channels ?? []
  return [{ label: '自动', value: 0 }].concat(
    chans.map((c) => ({ label: `${c.channel}${c.dfs ? '（DFS）' : ''}`, value: c.channel })),
  )
}
const txpowerOptions = [
  { label: '最大', value: 'Max' },
  { label: '高', value: 'High' },
  { label: '中', value: 'Medium' },
  { label: '低', value: 'Low' },
]
const dfsHint = (d: BandDraft) => {
  const band = bands.value.find((b) => String(b.band) === d.band)
  const ch = (band?.channels ?? []).find((c) => c.channel === d.channel)
  return ch?.dfs ? '该信道属于 DFS 雷达频段，切换后需等待 CAC 静默检测（约 60 秒）才可用。' : ''
}
const currentChannel = (d: BandDraft) => {
  const st = ifaceStatus(d.iface)
  const radio = radioOf(d.band)
  return Number(radio?.channel ?? st?.channel ?? 0)
}

async function saveBand(d: BandDraft) {
  if (!d.ssid.trim()) {
    message.warning('SSID 不能为空')
    return
  }
  savingBand.value = d.iface
  try {
    await saveWifiIface(d.iface, {
      ssid: d.ssid,
      key: d.key || undefined,
      encryption: d.encryption,
      hidden: d.hidden,
      enabled: d.enabled,
      txpower: d.txpower,
      htmode: d.htmode,
      channel: Number(d.channel),
    })
    message.success(`${bandLabel(d.band)} 已保存（无线会重建，约 5-10 秒）`)
    await wifiData.reload(true)
    syncDrafts()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingBand.value = ''
  }
}

/* ================= 访客 / IoT 草稿 ================= */
interface GuestDraft {
  iface: string
  band: string
  ssid: string
  key: string
  encryption: string
  hidden: boolean
  enabled: boolean
}
const guestDrafts = ref<GuestDraft[]>([])
function syncGuests() {
  const p = page.value
  if (!p) return
  guestDrafts.value = [...p.ifaces.filter((i) => i.guest || i.iot)].map((i) => ({
    iface: String(i.name ?? ''),
    band: i.band,
    ssid: String(i.ssid ?? ''),
    key: String(i.key ?? ''),
    encryption: String(i.encryption ?? 'psk2'),
    hidden: !!i.hidden,
    enabled: i.enabled !== false,
  }))
}
watch(page, syncGuests, { immediate: true })
const savingGuest = ref('')
async function saveGuest(g: GuestDraft) {
  savingGuest.value = g.iface
  try {
    await saveWifiIface(g.iface, {
      ssid: g.ssid,
      key: g.key || undefined,
      encryption: g.encryption,
      hidden: g.hidden,
      enabled: g.enabled,
    })
    message.success('已保存')
    await wifiData.reload(true)
    syncGuests()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingGuest.value = ''
  }
}

/* ================= MLO / 使用环境 ================= */
const mloForm = reactive({ enable: false, ssid: '', key: '', encryption: 'sae-mixed', hidden: false })
const savingMlo = ref(false)
function syncMlo() {
  const mf = page.value?.mlo?.iface
  if (!mf) return
  mloForm.enable = !!mf.mlo_enable
  mloForm.ssid = String(mf.ssid ?? '')
  mloForm.encryption = String(mf.encryption ?? 'sae-mixed')
  mloForm.hidden = !!mf.hidden
  mloForm.key = String(mf.key ?? '')
}
watch(page, syncMlo, { immediate: true })
const mloEncOptions = computed(() => {
  const list = page.value?.mlo?.encryptions ?? ['psk2', 'sae-mixed']
  return list.map((e) => ({ label: ENC_LABEL[e] ?? e.toUpperCase(), value: e }))
})
async function saveMlo() {
  savingMlo.value = true
  try {
    await saveMloConfig({
      mlo_enable: mloForm.enable,
      ssid: mloForm.ssid,
      key: mloForm.key || undefined,
      encryption: mloForm.encryption,
      hidden: mloForm.hidden,
    })
    message.success('Wi-Fi 7（MLO）配置已保存')
    await wifiData.reload(true)
    syncMlo()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingMlo.value = false
  }
}

const envMode = ref(1)
const savingEnv = ref(false)
function syncEnv() {
  envMode.value = page.value?.env?.use_environment ?? 1
}
watch(page, syncEnv, { immediate: true })
async function saveEnv() {
  savingEnv.value = true
  try {
    await saveWifiEnvironment(Number(envMode.value))
    message.success('使用环境已保存（室内/室外影响射频参数）')
    await wifiData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingEnv.value = false
  }
}

/* ================= 中继 ================= */
const rp = computed(() => repData.data.value)
const repStatus = computed<any>(() => rp.value?.status ?? null)
const repConfig = computed<any>(() => rp.value?.config ?? null)
const repSaved = computed(() => rp.value?.saved ?? [])
const netmodeText = computed(() => {
  const map: Record<string, string> = { router: '路由模式', bridge: '桥接模式', repeater: '中继模式' }
  return map[rp.value?.netmode ?? ''] ?? (rp.value?.netmode || '—')
})
const repCfg = reactive({ auto: true, lock_band: '' })
const repCfgDirty = ref(false)
function syncRepCfg() {
  if (repCfgDirty.value || !repConfig.value) return
  repCfg.auto = repConfig.value.auto !== false
  repCfg.lock_band = String(repConfig.value.lock_band ?? '')
}
watch(repConfig, syncRepCfg, { immediate: true })
const savingRepCfg = ref(false)
async function saveRepCfg() {
  savingRepCfg.value = true
  try {
    await saveRepeaterConfig({ auto: repCfg.auto, ...(repCfg.lock_band ? { lock_band: repCfg.lock_band } : {}) })
    message.success('中继设置已保存')
    repCfgDirty.value = false
    await repData.reload(true)
    void wifiData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingRepCfg.value = false
  }
}

const scanLoading = ref(false)
const scanList = ref<ScanApEx[]>([])
const scanElapsed = ref(0)
async function doScan() {
  scanLoading.value = true
  scanElapsed.value = 0
  const t0 = Date.now()
  const timer = window.setInterval(() => {
    scanElapsed.value = Math.round((Date.now() - t0) / 1000)
  }, 1000)
  try {
    scanList.value = await scanRepeater()
    message.success(`扫描完成，发现 ${scanList.value.length} 个 AP`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '扫描失败')
  } finally {
    window.clearInterval(timer)
    scanLoading.value = false
  }
}

const connectOpen = ref(false)
const connectTarget = ref<ScanApEx | null>(null)
const connectPassword = ref('')
const connecting = ref(false)
function askConnect(ap: ScanApEx) {
  connectTarget.value = ap
  connectPassword.value = ''
  if (ap.secure) {
    connectOpen.value = true
  } else {
    void doConnect()
  }
}
async function doConnect() {
  const ap = connectTarget.value
  if (!ap) return
  if (ap.secure && !connectPassword.value) {
    message.warning('该 AP 已加密，请输入密码')
    return
  }
  connecting.value = true
  try {
    await repeaterConnect({
      ssid: ap.ssid,
      key: connectPassword.value,
      band: ap.band,
      channel: ap.channel,
      bssid: ap.bssid,
      remember: true,
    })
    message.success('已提交连接请求，设备正在重建中继（约 10-20 秒）')
    connectOpen.value = false
    await repData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '连接失败')
  } finally {
    connecting.value = false
  }
}

const connectingSaved = ref('')
async function connectSaved(ap: AnyRec) {
  connectingSaved.value = String(ap.ssid ?? '')
  try {
    await repeaterConnect({ ...ap, remember: true })
    message.success(`正在连接到 ${ap.ssid}`)
    await repData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '连接失败')
  } finally {
    connectingSaved.value = ''
  }
}

const disconnecting = ref(false)
async function disconnect() {
  disconnecting.value = true
  try {
    await repeaterDisconnect()
    message.success('已断开中继')
    await repData.reload(true)
    void wifiData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '断开失败')
  } finally {
    disconnecting.value = false
  }
}

const forgetting = ref('')
async function forget(ssid: string) {
  forgetting.value = ssid
  try {
    await repeaterForget(ssid)
    message.success('已忘记该网络')
    await repData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    forgetting.value = ''
  }
}

const bareBusy = ref(false)
async function toggleBare(enter: boolean) {
  bareBusy.value = true
  try {
    await repeaterBareMode(enter)
    message.success(enter ? '已进入裸模式（中继暂停，供门户认证）' : '已退出裸模式')
    await repData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    bareBusy.value = false
  }
}

const scanCols: DataTableColumns<ScanApEx> = [
  {
    title: 'SSID',
    key: 'ssid',
    minWidth: 180,
    render: (r) =>
      h('div', { style: 'display:flex;flex-direction:column;line-height:1.3' }, [
        h('span', { style: 'font-size:13px;font-weight:500' }, r.ssid || '(隐藏 SSID)'),
        h('span', { class: 'nui-mono nui-muted', style: 'font-size:11px' }, r.bssid || '—'),
      ]),
  },
  {
    title: '频段',
    key: 'band',
    width: 84,
    render: (r) => h(NTag, { size: 'small', bordered: false, type: 'info' }, { default: () => bandLabel(r.band) }),
  },
  { title: '信道', key: 'channel', width: 72, render: (r) => h('span', { class: 'nui-mono' }, String(r.channel)) },
  {
    title: '信号',
    key: 'signal',
    width: 92,
    render: (r) => h('span', { class: 'nui-mono' }, r.signal == null ? '—' : `${r.signal} dBm`),
  },
  {
    title: '加密',
    key: 'encryption',
    width: 96,
    render: (r) => h('span', {}, r.secure ? r.encryption || '加密' : '开放'),
  },
  {
    title: '操作',
    key: 'op',
    width: 96,
    render: (r) =>
      h(
        NButton,
        { size: 'tiny', secondary: true, type: 'primary', onClick: () => askConnect(r) },
        { default: () => (r.saved ? '重连' : '连接') },
      ),
  },
]

/* ================= 黑白名单 ================= */
const bwl = computed<BwlState>(() => aclData.data.value ?? { mode: 'black', black_mac: [], white_mac: [] })
const bwlMode = ref<'black' | 'white'>('black')
watch(bwl, (v) => (bwlMode.value = v.mode), { immediate: true })
const activeList = computed(() => (bwlMode.value === 'white' ? bwl.value.white_mac : bwl.value.black_mac))
const macText = ref('')
const savingAcl = ref(false)
watch(activeList, (v) => (macText.value = v.join('\n')), { immediate: true })
const selfMac = computed(() => String(device.info?.mac ?? '').toUpperCase())

function parseMacs(text: string): { list: string[]; bad: string[] } {
  const parts = text.split(/[\n,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
  const re = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/
  const list: string[] = []
  const bad: string[] = []
  for (const p of parts) {
    if (!re.test(p)) bad.push(p)
    else if (!list.includes(p)) list.push(p)
  }
  return { list, bad }
}

async function saveMacList() {
  const { list, bad } = parseMacs(macText.value)
  if (bad.length) {
    message.error(`MAC 格式不正确：${bad.slice(0, 3).join(', ')}`)
    return
  }
  savingAcl.value = true
  try {
    await saveBwl(bwlMode.value, list)
    message.success(`已保存 ${bwlMode.value === 'white' ? '白' : '黑'}名单（${list.length} 条）`)
    await aclData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingAcl.value = false
  }
}

async function switchMode(mode: 'black' | 'white') {
  savingAcl.value = true
  try {
    const list = mode === 'white' ? bwl.value.white_mac : bwl.value.black_mac
    await saveBwl(mode, list)
    bwlMode.value = mode
    message.success(`已切换为${mode === 'white' ? '白名单' : '黑名单'}模式`)
    await aclData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '切换失败')
  } finally {
    savingAcl.value = false
  }
}

async function addSelfMac() {
  if (!selfMac.value) {
    message.warning('读不到本机 MAC')
    return
  }
  const list = [...activeList.value]
  if (!list.includes(selfMac.value)) list.push(selfMac.value)
  macText.value = list.join('\n')
  savingAcl.value = true
  try {
    await saveBwl(bwlMode.value, list)
    message.success('已把本机 MAC 加入白名单')
    await aclData.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingAcl.value = false
  }
}

const lanOf = (name: string) => (page.value?.lanIfaces ?? []).find((x) => String(x.interface) === name) ?? null
const openOfficial = (hash = '') => window.open('/gl_home.html' + hash, '_blank')
const guestLan = computed(() => lanOf('guest'))
const iotLan = computed(() => lanOf('iot'))
const errs = computed(() => (section.value === 'repeater' ? rp.value?.errors ?? [] : section.value === 'acl' ? [] : page.value?.errors ?? []))
</script>

<template>
  <div class="nui-page">
    <!-- ==================== Wi-Fi 设置 ==================== -->
    <template v-if="section === 'wifi'">
      <div class="nui-grid">
        <!-- NUI 布局：双频合一 / MLO 在最上面，然后 2.4G、5G 两张卡 -->
        <PanelCard class="span-12" title="双频合一 / Wi-Fi 7 MLO">
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <n-switch v-model:value="mloForm.enable" size="small" />
          </template>
          <PageState :loading="wifiData.loading.value" :error="wifiData.error.value" :empty="!page" compact empty-text="wifi.get_mlo_config 不可用" @retry="wifiData.reload()">
            <div class="frow"><span class="flabel">MLO SSID</span><n-input v-model:value="mloForm.ssid" size="small" /></div>
            <div class="frow">
              <span class="flabel">加密方式</span>
              <n-select v-model:value="mloForm.encryption" size="small" :options="mloEncOptions" />
            </div>
            <div class="frow">
              <span class="flabel">密码</span>
              <n-input v-model:value="mloForm.key" size="small" type="password" show-password-on="click" placeholder="Wi-Fi 密码（点击眼睛查看）" />
            </div>
            <div class="frow"><span class="flabel">隐藏 SSID</span><n-switch v-model:value="mloForm.hidden" size="small" /></div>
            <div class="nui-small nui-muted" style="margin: 6px 0 10px">
              开启后 2.4G 与 5G 使用同一条链路（MLO），设备自动连接更合适的频段；支持频段
              {{ (page?.mlo?.bandSupport ?? []).map((b) => bandLabel(b)).join(' + ') || '—' }}，
              接口 <span class="nui-mono">{{ page?.mlo?.iface?.name || '—' }}</span>。
              部分终端不支持 MLO 会回落到普通频段。
            </div>
            <n-button size="small" type="primary" :loading="savingMlo" @click="saveMlo">保存 MLO 配置</n-button>
          </PageState>
        </PanelCard>

        <PanelCard
          v-for="(d, di) in drafts"
          :key="d.iface"
          class="span-6"
          :title="`主网络 · ${bandLabel(d.band)}`"
        >
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-tag size="tiny" :bordered="false" :type="d.enabled ? 'success' : 'default'">{{ d.enabled ? '已启用' : '已停用' }}</n-tag>
              <n-switch v-model:value="drafts[di].enabled" size="small" />
            </div>
          </template>

          <div class="frow"><span class="flabel">Wi-Fi SSID</span><n-input v-model:value="drafts[di].ssid" size="small" maxlength="32" /></div>
          <div class="frow">
            <span class="flabel">加密方式</span>
            <n-select v-model:value="drafts[di].encryption" size="small" :options="encOptions(d)" />
          </div>
          <div class="frow">
            <span class="flabel">密码</span>
            <n-input
              v-model:value="drafts[di].key"
              size="small"
              type="password"
              show-password-on="click"
              placeholder="Wi-Fi 密码（点击眼睛查看）"
            />
          </div>
          <div class="frow"><span class="flabel">隐藏 SSID</span><n-switch v-model:value="drafts[di].hidden" size="small" /></div>

          <button class="adv-toggle" @click="drafts[di].adv = !drafts[di].adv">
            <span>射频设置（信道 / 带宽 / 功率）</span>
            <span class="chev" :class="{ open: drafts[di].adv }">›</span>
          </button>
          <div v-if="drafts[di].adv" class="adv-body">
            <div class="frow">
              <span class="flabel">发射功率</span>
              <n-select v-model:value="drafts[di].txpower" size="small" :options="txpowerOptions" />
            </div>
            <div class="frow">
              <span class="flabel">频宽</span>
              <n-select v-model:value="drafts[di].htmode" size="small" :options="htmodeOptions(d)" />
            </div>
            <div class="frow">
              <span class="flabel">信道</span>
              <n-select v-model:value="drafts[di].channel" size="small" :options="channelOptions(d)" />
            </div>
            <p v-if="dfsHint(d)" class="nui-small" style="color: var(--warn); margin: 2px 0 8px">{{ dfsHint(d) }}</p>
            <div class="nui-small nui-muted">
              接口 <span class="nui-mono">{{ d.iface }}</span> · 设备 <span class="nui-mono">{{ d.device }}</span> ·
              当前信道 <span class="nui-mono">{{ currentChannel(d) || '自动' }}</span>
            </div>
          </div>

          <div class="nui-row" style="margin-top: 14px">
            <n-button size="small" type="primary" :loading="savingBand === d.iface" @click="saveBand(drafts[di])">保存</n-button>
            <n-button size="small" quaternary :loading="wifiData.loading.value" @click="wifiData.reload()">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              重读
            </n-button>
          </div>
        </PanelCard>

        <PageState
          v-if="!drafts.length"
          class="span-12"
          :loading="wifiData.loading.value"
          :error="wifiData.error.value"
          :empty="!page"
          empty-text="wifi.get_config 不可用"
          @retry="wifiData.reload()"
        />

        <!-- 射频状态 -->
        <PanelCard class="span-12" title="射频状态">
          <template #icon><n-icon><LinkOutline /></n-icon></template>
          <template #extra><span class="nui-small nui-muted">wifi.get_status + NUI wifi.radios</span></template>
          <div v-for="b in bands" :key="String(b.band)" class="radio-row">
            <div class="nui-between">
              <span style="font-weight: 600">{{ bandLabel(String(b.band)) }}</span>
              <n-tag size="tiny" :bordered="false" :type="radioOf(String(b.band)) ? 'success' : 'default'">
                {{ (radioOf(String(b.band))?.mode as string) || ifaceStatus(String(b.ifaces?.[0]?.name ?? ''))?.state || '—' }}
              </n-tag>
            </div>
            <div class="radio-kv">
              <span>当前信道 <b class="nui-mono">{{ radioOf(String(b.band))?.channel ?? ifaceStatus(String(b.ifaces?.[0]?.name ?? ''))?.channel ?? '—' }}</b></span>
              <span>频宽 <b class="nui-mono">{{ radioOf(String(b.band))?.htmode ?? b.htmode ?? '—' }}</b></span>
              <span>功率 <b class="nui-mono">{{ radioOf(String(b.band))?.txpower ?? b.txpower ?? '—' }}</b> dBm</span>
              <span>频率 <b class="nui-mono">{{ radioOf(String(b.band))?.freq ?? '—' }}</b> GHz</span>
            </div>
            <div class="nui-small nui-muted">
              DFS 支持：{{ page?.config?.dfs_support ? '是' : '否' }}
              <span v-if="radioOf(String(b.band))?.dfs" style="color: var(--warn)"> · 当前信道为 DFS</span>
            </div>
          </div>
        </PanelCard>

        <PanelCard class="span-6" title="使用环境">
          <template #extra><span class="nui-small nui-muted">wifi.set_environment_config</span></template>
          <div class="env">
            <NRadioGroup v-model:value="envMode">
              <NRadio :value="1">室内（默认）</NRadio>
              <NRadio :value="0">室外</NRadio>
            </NRadioGroup>
          </div>
          <p class="nui-small nui-muted" style="margin: 10px 0">
            室外模式会放宽部分射频参数（对应官方页面右上的「使用环境」）。修改会重建无线。
          </p>
          <n-button size="small" type="primary" :loading="savingEnv" @click="saveEnv">保存</n-button>
        </PanelCard>

        <PanelCard class="span-12" title="无线网络清单">
          <template #extra>
            <n-button size="tiny" quaternary @click="router.push('/wireless/guest')">访客与 IoT</n-button>
          </template>
          <div class="ssid-list">
            <div v-for="i in page?.ifaces ?? []" :key="String(i.name)" class="ssid-item">
              <i class="dot" :class="ifaceStatus(String(i.name))?.state === 'ready' || i.enabled ? 'on' : 'off'" />
              <span class="nui-mono nui-small" style="width: 74px">{{ i.name }}</span>
              <span class="ellipsis" style="flex: 1">{{ i.ssid }}</span>
              <n-tag size="tiny" :bordered="false" :type="i.guest ? 'warning' : i.iot ? 'info' : 'default'">
                {{ i.guest ? '访客' : i.iot ? 'IoT' : bandLabel(i.band) }}
              </n-tag>
              <span class="nui-mono nui-small nui-muted" style="width: 150px; text-align: right">{{ i.encryption }}</span>
            </div>
          </div>
        </PanelCard>
      </div>
    </template>

    <!-- ==================== 访客与 IoT ==================== -->
    <template v-else-if="section === 'guest'">
      <div class="nui-grid">
        <PanelCard v-for="(g, gi) in guestDrafts" :key="g.iface" class="span-6" :title="`${g.iface.startsWith('iot') ? 'IoT' : '访客'} · ${bandLabel(g.band)}`">
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-tag size="tiny" :bordered="false" :type="g.enabled ? 'success' : 'default'">{{ g.enabled ? '已启用' : '已停用' }}</n-tag>
              <n-switch v-model:value="guestDrafts[gi].enabled" size="small" />
            </div>
          </template>
          <div class="frow"><span class="flabel">SSID</span><n-input v-model:value="guestDrafts[gi].ssid" size="small" maxlength="32" /></div>
          <div class="frow">
            <span class="flabel">加密方式</span>
            <n-select
              v-model:value="guestDrafts[gi].encryption"
              size="small"
              :options="(bands.find((b) => String(b.band) === g.band)?.encryptions ?? ['psk2']).map((e) => ({ label: ENC_LABEL[e] ?? e, value: e }))"
            />
          </div>
          <div class="frow">
            <span class="flabel">密码</span>
            <n-input v-model:value="guestDrafts[gi].key" size="small" type="password" show-password-on="click" placeholder="Wi-Fi 密码（点击眼睛查看）" />
          </div>
          <div class="frow"><span class="flabel">隐藏 SSID</span><n-switch v-model:value="guestDrafts[gi].hidden" size="small" /></div>
          <div class="nui-small nui-muted" style="margin: 4px 0 12px">
            接口 <span class="nui-mono">{{ g.iface }}</span> · 独立网段，与主网络隔离
          </div>
          <n-button size="small" type="primary" :loading="savingGuest === g.iface" @click="saveGuest(guestDrafts[gi])">保存</n-button>
        </PanelCard>

        <PageState
          v-if="!guestDrafts.length"
          class="span-12"
          :loading="wifiData.loading.value"
          :error="wifiData.error.value"
          :empty="!page"
          empty-text="没有访客 / IoT 接口（当前固件 wifi.get_config 未返回 guest/iot）"
          @retry="wifiData.reload()"
        />

        <PanelCard class="span-6" title="访客网段">
          <template #extra>
            <n-button size="tiny" quaternary @click="router.push('/network/lan')">编辑</n-button>
          </template>
          <div v-if="guestLan" class="rows">
            <div class="row"><span class="rk">地址</span><span class="rv nui-mono">{{ guestLan?.ip }} / {{ guestLan?.netmask }}</span></div>
            <div class="row"><span class="rk">DHCP 池</span><span class="rv nui-mono">{{ guestLan?.start }} - {{ guestLan?.end }}</span></div>
            <div class="row"><span class="rk">租期</span><span class="rv">{{ guestLan?.leasetime }}</span></div>
            <div class="row"><span class="rk">启用</span><span class="rv">{{ guestLan?.enable ? '是' : '否' }}</span></div>
            <div class="row"><span class="rk">客户端隔离</span><span class="rv">{{ guestLan?.ap_isolate ? '开启' : '关闭' }}</span></div>
          </div>
          <div v-else class="nui-small nui-muted">lan.get_config_list 未返回 guest 接口</div>
        </PanelCard>

        <PanelCard class="span-6" title="IoT 网段">
          <template #extra>
            <n-button size="tiny" quaternary @click="router.push('/network/lan')">编辑</n-button>
          </template>
          <div v-if="iotLan" class="rows">
            <div class="row"><span class="rk">地址</span><span class="rv nui-mono">{{ iotLan?.ip }} / {{ iotLan?.netmask }}</span></div>
            <div class="row"><span class="rk">DHCP 池</span><span class="rv nui-mono">{{ iotLan?.start }} - {{ iotLan?.end }}</span></div>
            <div class="row"><span class="rk">租期</span><span class="rv">{{ iotLan?.leasetime }}</span></div>
            <div class="row"><span class="rk">启用</span><span class="rv">{{ iotLan?.enable ? '是' : '否' }}</span></div>
            <div class="row"><span class="rk">客户端隔离</span><span class="rv">{{ iotLan?.ap_isolate ? '开启' : '关闭' }}</span></div>
          </div>
          <div v-else class="nui-small nui-muted">lan.get_config_list 未返回 iot 接口</div>
        </PanelCard>

        <PanelCard class="span-12" title="访客 / IoT SSID 清单">
          <div class="ssid-list">
            <div v-for="i in page?.ifaces ?? []" :key="String(i.name)" class="ssid-item">
              <span class="nui-mono nui-small" style="width: 74px">{{ i.name }}</span>
              <span class="ellipsis" style="flex: 1">{{ i.ssid }}</span>
              <n-tag size="tiny" :bordered="false" :type="i.guest ? 'warning' : i.iot ? 'info' : 'default'">
                {{ i.guest ? '访客' : i.iot ? 'IoT' : '主网络' }}
              </n-tag>
              <span class="nui-small nui-muted">{{ i.enabled ? '启用' : '停用' }}</span>
            </div>
          </div>
        </PanelCard>
      </div>
    </template>

    <!-- ==================== 中继与桥接 ==================== -->
    <template v-else-if="section === 'repeater'">
      <div class="nui-grid">
        <PanelCard class="span-8" title="中继状态">
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" quaternary :loading="repData.loading.value" @click="repData.reload()">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新
            </n-button>
          </template>
          <PageState :loading="repData.loading.value" :error="repData.error.value" :empty="!rp" empty-text="repeater.get_status 不可用" @retry="repData.reload()">
            <div v-if="repStatus?.running" class="rep">
              <div class="rep-hero">
                <div>
                  <div class="nui-mid">{{ repStatus.ssid }}</div>
                  <div class="nui-small nui-muted">
                    {{ bandLabel(repStatus.band) }} · CH{{ repStatus.channel }} · {{ repStatus.htmode }} ·
                    {{ repStatus.wifi_generation ? 'Wi-Fi ' + repStatus.wifi_generation : '' }}
                  </div>
                </div>
                <div class="signal">
                  <div class="nui-mid nui-mono">{{ repStatus.signal }}<span class="nui-unit">dBm</span></div>
                  <div class="nui-small nui-muted">{{ repStatus.state_s || 'connected' }}</div>
                </div>
              </div>
              <div class="kv-grid">
                <div><div class="k">上游 BSSID</div><div class="v nui-mono">{{ repStatus.bssid }}</div></div>
                <div><div class="k">加密方式</div><div class="v">{{ repStatus.wpa_status?.key_mgmt || '—' }} / {{ repStatus.wpa_status?.pairwise_cipher || '—' }}</div></div>
                <div><div class="k">上游 IP / 网关</div><div class="v nui-mono">{{ repStatus.ipv4?.ip || '—' }}<br />{{ repStatus.ipv4?.gateway || '—' }}</div></div>
                <div><div class="k">DNS</div><div class="v nui-mono">{{ (repStatus.ipv4?.dns ?? []).join(', ') || '—' }}</div></div>
                <div><div class="k">连接时长</div><div class="v">{{ repStatus.connected || '—' }}</div></div>
                <div><div class="k">门户认证</div><div class="v">{{ repStatus.portal ? '检测到门户认证' : '不需要' }}</div></div>
              </div>
              <div class="actions" style="margin-top: 12px">
                <n-popconfirm @positive-click="disconnect">
                  <template #trigger>
                    <n-button size="small" secondary type="warning" :loading="disconnecting">断开中继</n-button>
                  </template>
                  断开后设备会失去当前上游网络（LAN 访问不受影响）。确认？
                </n-popconfirm>
                <n-popconfirm @positive-click="toggleBare(!repStatus.bare_mode)">
                  <template #trigger>
                    <n-button size="small" secondary :loading="bareBusy">{{ repStatus.bare_mode ? '退出裸模式' : '进入裸模式' }}</n-button>
                  </template>
                  裸模式会暂停中继，用于在酒店/机场门户完成网页认证。确认？
                </n-popconfirm>
              </div>
            </div>
            <div v-else class="nui-small nui-muted">
              当前未连接中继（repeater.get_status.running=false）。可在下方扫描周边 AP 并连接。
            </div>
          </PageState>
        </PanelCard>

        <PanelCard class="span-4" title="已保存的网络">
          <template #extra><span class="nui-small nui-muted">repeater.get_saved_ap_list</span></template>
          <div v-for="ap in repSaved" :key="String(ap.ssid)" class="saved-row">
            <div style="flex: 1; min-width: 0">
              <div class="ellipsis" style="font-size: 13px">{{ ap.ssid }}</div>
              <div class="nui-small nui-muted nui-mono">{{ ap.bssid || ap.protocol || '' }} {{ ap.ip || '' }}</div>
            </div>
            <n-button size="tiny" secondary :loading="connectingSaved === ap.ssid" @click="connectSaved(ap)">连接</n-button>
            <n-popconfirm @positive-click="forget(String(ap.ssid))">
              <template #trigger>
                <n-button size="tiny" quaternary type="error" :loading="forgetting === ap.ssid">忘记</n-button>
              </template>
              忘记后需重新扫码/输入密码才能连接该网络。确认？
            </n-popconfirm>
          </div>
          <div v-if="!repSaved.length" class="nui-small nui-muted">还没有已保存的上游网络</div>
        </PanelCard>

        <PanelCard class="span-12" title="扫描周边 AP">
          <template #icon><n-icon><ScanOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <span v-if="scanLoading" class="nui-small nui-muted">扫描中 {{ scanElapsed }}s（约 10-20 秒，请勿关闭页面）</span>
              <n-button size="small" type="primary" secondary :loading="scanLoading" @click="doScan">开始扫描</n-button>
            </div>
          </template>
          <n-data-table
            :columns="scanCols"
            :data="scanList"
            size="small"
            :bordered="false"
            :single-line="false"
            :row-key="(r: ScanApEx) => r.bssid || r.ssid"
            :loading="scanLoading"
            :scroll-x="780"
          />
          <p v-if="!scanList.length && !scanLoading" class="nui-small nui-muted" style="margin: 8px 0 0">
            点击「开始扫描」调用 repeater.scan（{all_band:true, refresh:true}），真机实测约 10 秒返回。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="中继设置">
          <template #extra><span class="nui-small nui-muted">repeater.set_config</span></template>
          <div class="frow"><span class="flabel">自动切换</span><n-switch v-model:value="repCfg.auto" size="small" @update:value="repCfgDirty = true" /></div>
          <div class="frow">
            <span class="flabel">锁定频段</span>
            <n-select
              v-model:value="repCfg.lock_band"
              size="small"
              :options="[{ label: '不锁定（自动）', value: '' }, { label: '仅 2.4 GHz', value: '2g' }, { label: '仅 5 GHz', value: '5g' }]"
              @update:value="repCfgDirty = true"
            />
          </div>
          <p class="nui-small nui-muted" style="margin: 8px 0 12px">
            自动切换会在当前上游掉线时尝试已保存网络；锁定频段可避免弱 5G 反复切换。保存后按 repeater.set_config 整包提交。
          </p>
          <n-button size="small" type="primary" :loading="savingRepCfg" :disabled="!repCfgDirty" @click="saveRepCfg">保存</n-button>
          <div class="nui-small nui-muted" style="margin-top: 10px">
            设备 MAC：<span class="nui-mono">{{ repConfig?.macaddr || '—' }}</span> · DFS 支持：{{ repConfig?.dfs_support ? '是' : '否' }}
          </div>
        </PanelCard>

        <PanelCard class="span-6" title="桥接与网络模式">
          <template #icon><n-icon><GitNetworkOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" quaternary @click="openOfficial('#/bridge')">官方后台</n-button>
          </template>
          <div class="rows">
            <div class="row"><span class="rk">当前模式</span><span class="rv">{{ netmodeText }}（netmode.get_mode）</span></div>
            <div class="row"><span class="rk">WAN 口</span><span class="rv">{{ rp?.check?.cable_inserted ? '已插入' : '未插入' }}</span></div>
          </div>
          <div class="ports">
            <div v-for="p in rp?.ports ?? []" :key="String(p.name)" class="port">
              <span class="nui-mono">{{ p.name }}</span>
              <span class="nui-small nui-muted">{{ p.silk }} · {{ p.mode }}</span>
              <span class="nui-small nui-muted nui-mono">{{ p.macaddr?.macaddr || p.macaddr?.defmacaddr || '' }}</span>
            </div>
          </div>
          <p class="nui-small nui-muted" style="margin: 8px 0 0">
            切换路由/桥接/中继模式（netmode.set_mode）会重建全部网络且官方要求先断开中继，本后台只读展示，切换请走官方 #/bridge 页面。
          </p>
        </PanelCard>
      </div>

      <NModal v-model:show="connectOpen" preset="card" title="连接上游 Wi-Fi" style="max-width: 420px">
        <div class="nui-small nui-muted" style="margin-bottom: 10px">
          {{ connectTarget?.ssid }} · {{ bandLabel(connectTarget?.band || '') }} · {{ connectTarget?.signal }} dBm
        </div>
        <n-input v-model:value="connectPassword" type="password" show-password-on="click" placeholder="Wi-Fi 密码" @keyup.enter="doConnect" />
        <p class="nui-small nui-muted" style="margin: 8px 0 0">
          提交后设备会重建中继（约 10-20 秒），期间可能短暂断网。
        </p>
        <template #footer>
          <div class="nui-row" style="justify-content: flex-end">
            <n-button size="small" @click="connectOpen = false">取消</n-button>
            <n-button size="small" type="primary" :loading="connecting" @click="doConnect">连接</n-button>
          </div>
        </template>
      </NModal>
    </template>

    <!-- ==================== 黑白名单 ==================== -->
    <template v-else>
      <div class="nui-grid">
        <PanelCard class="span-12" title="访问控制模式">
          <template #icon><n-icon><LockClosedOutline /></n-icon></template>
          <div class="mode-row">
            <NRadioGroup :value="bwlMode" @update:value="(v: 'black' | 'white') => switchMode(v)">
              <NRadio value="black">黑名单（列表内设备禁止接入）</NRadio>
              <NRadio value="white">白名单（仅列表内设备可接入）</NRadio>
            </NRadioGroup>
            <n-tag size="small" :bordered="false" type="info">{{ bwlMode === 'white' ? '白名单' : '黑名单' }} · {{ activeList.length }} 条</n-tag>
          </div>
          <NAlert type="warning" :bordered="false" style="margin-top: 12px">
            本固件的 black_white_list 只有「黑名单 / 白名单」两种模式（实测 disable/off/空模式均 Invalid params），
            没有「关闭」选项——这与官方客户端的访问控制弹窗一致。
            <span v-if="bwlMode === 'white'">白名单必须包含本机管理 MAC（<span class="nui-mono">{{ selfMac || '—' }}</span>），否则会把自己的管理入口挡掉。</span>
          </NAlert>
          <div v-if="bwlMode === 'white'" style="margin-top: 10px">
            <n-button size="small" secondary @click="addSelfMac">把本机 MAC 加入白名单</n-button>
          </div>
        </PanelCard>

        <PanelCard class="span-12" title="MAC 名单">
          <template #extra>
            <div class="nui-row">
              <n-button size="tiny" quaternary :loading="aclData.loading.value" @click="aclData.reload()">重读</n-button>
            </div>
          </template>
          <PageState :loading="aclData.loading.value" :error="aclData.error.value" :empty="!aclData.data.value" empty-text="black_white_list.get_config 不可用" @retry="aclData.reload()">
            <p class="nui-small nui-muted" style="margin: 0 0 8px">
              每行一个 MAC（支持换行 / 逗号 / 分号分隔，可一次粘贴多条）。保存走 black_white_list.set_config → {mode, mac:[...]}，写后回读校验条数。
            </p>
            <n-input v-model:value="macText" type="textarea" :rows="8" placeholder="AA:BB:CC:DD:EE:FF" class="nui-mono" />
            <div class="nui-row" style="margin-top: 10px">
              <n-button size="small" type="primary" :loading="savingAcl" @click="saveMacList">保存名单</n-button>
              <n-button size="small" secondary :disabled="!macText" @click="macText = activeList.join('\n')">还原</n-button>
            </div>
            <p class="nui-small" style="margin: 8px 0 0; color: var(--warn)">{{ parseMacs(macText).bad.length ? `有 ${parseMacs(macText).bad.length} 行格式不正确` : '' }}</p>
          </PageState>
        </PanelCard>

        <PanelCard class="span-6" title="黑名单（black_mac）">
          <div v-for="m in bwl.black_mac" :key="m" class="mac-row">
            <span class="nui-mono">{{ m }}</span>
            <n-tag size="tiny" :bordered="false">黑</n-tag>
          </div>
          <div v-if="!bwl.black_mac.length" class="nui-small nui-muted">空</div>
        </PanelCard>

        <PanelCard class="span-6" title="白名单（white_mac）">
          <div v-for="m in bwl.white_mac" :key="m" class="mac-row">
            <span class="nui-mono">{{ m }}</span>
            <n-tag size="tiny" :bordered="false">白</n-tag>
          </div>
          <div v-if="!bwl.white_mac.length" class="nui-small nui-muted">空</div>
        </PanelCard>
      </div>
    </template>

    <div v-if="errs.length" style="margin-top: 4px">
      <NAlert type="warning" :bordered="false">{{ errs.join('；') }}</NAlert>
    </div>
  </div>
</template>

<style scoped>
.k { font-size: 11.5px; opacity: 0.55; }
.v { font-size: 13px; word-break: break-all; }
.rows { display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12.5px; }
.rk { opacity: 0.58; flex: none; }
.rv { text-align: right; min-width: 0; word-break: break-all; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(128, 128, 128, 0.5); flex: none; display: inline-block; }
.dot.on { background: var(--ok); }
.dot.off { background: var(--err); }

.frow { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 12px; margin-bottom: 10px; }
.flabel { font-size: 12.5px; opacity: 0.62; }
.adv-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  margin: 4px 0;
  padding: 6px 0;
  border: 0;
  border-top: 1px dashed var(--line-dash);
  background: transparent;
  color: var(--nui-accent);
  font-size: 12.5px;
  cursor: pointer;
}
.adv-toggle .chev { transition: transform 0.15s; display: inline-block; }
.adv-toggle .chev.open { transform: rotate(90deg); }
.adv-body { padding-top: 10px; }

.radio-row { padding: 8px 0; border-bottom: 1px dashed var(--line-dash); }
.radio-row:last-child { border-bottom: 0; }
.radio-kv { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; margin: 4px 0; }
.env { margin: 6px 0; }

.ssid-list { display: flex; flex-direction: column; }
.ssid-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; border-bottom: 1px dashed var(--line-dash); }
.ssid-item:last-child { border-bottom: 0; }

.rep-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.signal { text-align: right; }
.kv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 18px; }
.actions { display: flex; align-items: center; gap: 10px; }

.saved-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed var(--line-dash); }
.saved-row:last-child { border-bottom: 0; }

.ports { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.port { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 8px; background: rgba(128, 128, 128, 0.08); }

.mode-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.mac-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed var(--line-dash); }
.mac-row:last-child { border-bottom: 0; }

@media (max-width: 1100px) {
  .kv-grid { grid-template-columns: 1fr 1fr; }
  .frow { grid-template-columns: 86px minmax(0, 1fr); }
}
</style>
