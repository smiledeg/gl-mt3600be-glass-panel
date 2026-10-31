<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NDataTable,
  NIcon,
  NInput,
  NInputNumber,
  NPopconfirm,
  NSelect,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  GitNetworkOutline,
  GlobeOutline,
  LinkOutline,
  PulseOutline,
  RefreshOutline,
  SwapHorizontalOutline,
  WifiOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import { useAsync } from '@/composables/useAsync'
import { useDeviceStore } from '@/stores/device'
import { fmtAgo, splitSpeed } from '@/utils/format'
import {
  loadMultiwan,
  loadWanPage,
  repeaterDisconnect,
  saveCableConfig,
  saveKmwanInterface,
  saveKmwanMode,
  saveKmwanSensitivity,
  sleep,
  type AnyRec,
  type MwanIfaceCfg,
  type MultiwanPage,
  type WanPage,
} from '@/api/core'

const props = defineProps<{ section?: string }>()
const message = useMessage()
const router = useRouter()
const device = useDeviceStore()

const section = computed(() => (props.section === 'multiwan' ? 'multiwan' : 'wan'))

const wan = useAsync<WanPage>(loadWanPage, { interval: 10000, immediate: false })
const mwan = useAsync<MultiwanPage>(loadMultiwan, { interval: 10000, immediate: false })

function activate() {
  if (section.value === 'multiwan') {
    wan.stop()
    mwan.start()
    void mwan.reload()
  } else {
    mwan.stop()
    wan.start()
    void wan.reload()
  }
}
onMounted(activate)
watch(section, activate)

const w = computed(() => wan.data.value)
const mw = computed(() => mwan.data.value)
/** 本机有无蜂窝能力：没有就隐藏“蜂窝”相关行（旁路由信息保留） */
const showCellular = computed(() => device.hasCellular)
const rep = computed(() => w.value?.repeater ?? null)
const cable = computed(() => w.value?.cable ?? null)
const edge = computed(() => w.value?.edge ?? null)
const modem = computed(() => w.value?.modem ?? null)
const rx = computed(() => splitSpeed(device.speed.rx))
const tx = computed(() => splitSpeed(device.speed.tx))

/* ================= 以太网 WAN 设置（cable.set_config） ================= */
const cableForm = reactive({
  protocol: 'dhcp',
  ip: '',
  netmask: '255.255.255.0',
  gateway: '',
  dns1: '',
  dns2: '',
  username: '',
  password: '',
  vlanid: null as number | null,
  mtu: null as number | null,
})
const cableDirty = ref(false)
const savingCable = ref(false)

function syncCableForm() {
  const cfg = cable.value?.config
  const base = cfg?.ipv4 ?? {}
  cableForm.protocol = cfg?.protocol || 'dhcp'
  cableForm.ip = base.ip || ''
  cableForm.netmask = base.netmask || '255.255.255.0'
  cableForm.gateway = base.gateway || ''
  const dns = Array.isArray(base.dns) ? base.dns : []
  cableForm.dns1 = dns[0] || ''
  cableForm.dns2 = dns[1] || ''
  cableForm.username = String(cfg?.username ?? '')
  cableForm.password = String(cfg?.password ?? '')
  cableForm.vlanid = cfg?.vlanid == null ? null : Number(cfg.vlanid)
  cableForm.mtu = cfg?.mtu == null ? null : Number(cfg.mtu)
  cableDirty.value = false
}
watch(() => cable.value?.config, syncCableForm, { immediate: true })

const protocolOptions = [
  { label: 'DHCP（自动获取）', value: 'dhcp' },
  { label: '静态地址', value: 'static' },
  { label: 'PPPoE 拨号', value: 'pppoe' },
]

async function saveCable() {
  const f = cableForm
  if (f.protocol === 'static' && (!f.ip || !f.netmask || !f.gateway)) {
    message.warning('静态地址需要填写 IP / 掩码 / 网关')
    return
  }
  if (f.protocol === 'pppoe' && !f.username) {
    message.warning('PPPoE 需要填写宽带账号')
    return
  }
  savingCable.value = true
  try {
    const patch: AnyRec = { protocol: f.protocol }
    if (f.protocol === 'static') {
      patch.ipv4 = { ip: f.ip, netmask: f.netmask, gateway: f.gateway, dns: [f.dns1, f.dns2].filter(Boolean) }
    } else if (f.protocol === 'pppoe') {
      patch.username = f.username
      patch.password = f.password
      patch.ipv4 = { ip: '', netmask: '', gateway: '', dns: [f.dns1, f.dns2].filter(Boolean) }
    } else {
      patch.ipv4 = { ip: '', netmask: '', gateway: '', dns: [f.dns1, f.dns2].filter(Boolean) }
      delete patch.username
      delete patch.password
    }
    if (f.vlanid != null) patch.vlanid = f.vlanid
    if (f.mtu != null) patch.mtu = f.mtu
    await saveCableConfig(patch)
    message.success('WAN 配置已保存（接口会重建，约 3-5 秒）')
    cableDirty.value = false
    await wan.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingCable.value = false
  }
}

/* 重新应用当前 WAN 配置（等价官方「保存后重连」，会短暂断网） */
const reapplying = ref(false)
async function reapplyCable() {
  reapplying.value = true
  try {
    const cfg = cable.value?.config
    if (!cfg) throw new Error('读不到 WAN 配置')
    await saveCableConfig({ protocol: cfg.protocol })
    message.success('WAN 已重新应用')
    await wan.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重连失败')
  } finally {
    reapplying.value = false
  }
}

/* 断开中继 */
const disconnecting = ref(false)
async function disconnectRepeater() {
  disconnecting.value = true
  try {
    await repeaterDisconnect()
    message.success('已断开中继，设备可能暂时断开网络')
    await wan.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '断开失败')
  } finally {
    disconnecting.value = false
  }
}

/* ================= 多 WAN ================= */
const ifaceOptions = computed(() =>
  (mw.value?.config?.interfaces ?? []).map((i) => ({ label: `${i.interface}（${i.interface}）`, value: i.interface })),
)
const modeValue = ref<number>(0)
const priorityOrder = ref<string[]>([])
const weights = reactive<Record<string, number>>({})
const sensitivityLevel = ref('medium')
const sensitivityVal = ref(5)
const mwanSaving = ref(false)
const trackTarget = ref('')
const trackForm = reactive({
  enable_check: true,
  track_proto: 2,
  track_method: 0,
  track_mode: 1,
  track_ipv4: '223.5.5.5\n223.6.6.6\n119.29.29.29',
  track_ipv6: '2400:3200::1\n2400:3200:baba::1',
  enable_ssl: false,
})

function syncMwan() {
  const cfg = mw.value?.config
  if (!cfg) return
  modeValue.value = cfg.mode ?? 0
  const list = [...(cfg.interfaces ?? [])]
  priorityOrder.value = [...list].sort((a, b) => (a.metric ?? 99) - (b.metric ?? 99)).map((i) => i.interface)
  for (const i of list) weights[i.interface] = i.weight ?? 1
  const sens = mw.value?.sensitivity
  if (sens) {
    sensitivityLevel.value = sens.level
    sensitivityVal.value = sens.val
  }
  if (!trackTarget.value && list.length) trackTarget.value = list[0].interface
  syncTrackForm()
}
watch(mw, syncMwan, { immediate: true })

function syncTrackForm() {
  const list = mw.value?.config?.interfaces ?? []
  const hit: MwanIfaceCfg | undefined = list.find((i) => i.interface === trackTarget.value)
  if (!hit) return
  trackForm.enable_check = hit.enable_check !== false
  trackForm.track_proto = hit.track_proto ?? 2
  trackForm.track_method = hit.track_method ?? 0
  trackForm.track_mode = hit.track_mode ?? 1
  trackForm.enable_ssl = !!hit.enable_ssl
  trackForm.track_ipv4 = (hit.track_ipv4 ?? []).join('\n')
  trackForm.track_ipv6 = (hit.track_ipv6 ?? []).join('\n')
}
watch(trackTarget, syncTrackForm)

const trackProtoOptions = [
  { label: 'IPv4 + IPv6', value: 2 },
  { label: '仅 IPv4', value: 0 },
  { label: '仅 IPv6', value: 1 },
]
const trackModeOptions = [
  { label: '普通模式', value: 1 },
  { label: '低数据量模式', value: 0 },
  { label: '严格模式', value: 2 },
]
const sensitivityOptions = [
  { label: '低（切换迟钝）', value: 'low' },
  { label: '中（默认）', value: 'medium' },
  { label: '高（切换灵敏）', value: 'high' },
  { label: '自定义间隔', value: 'custom' },
]

function movePriority(idx: number, dir: -1 | 1) {
  const arr = [...priorityOrder.value]
  const next = idx + dir
  if (next < 0 || next >= arr.length) return
  const tmp = arr[idx]
  arr[idx] = arr[next]
  arr[next] = tmp
  priorityOrder.value = arr
}

async function saveMode() {
  if (!priorityOrder.value.length) return
  mwanSaving.value = true
  try {
    if (modeValue.value === 0) {
      await saveKmwanMode(0, priorityOrder.value.map((name, i) => ({ interface: name, metric: i + 1 })))
    } else {
      const interfaces = (mw.value?.config?.interfaces ?? []).map((i) => ({
        interface: i.interface,
        weight: Number(weights[i.interface] ?? i.weight ?? 1),
      }))
      await saveKmwanMode(1, interfaces)
    }
    message.success('多 WAN 策略已保存')
    await sleep(4000)
    await mwan.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    mwanSaving.value = false
  }
}

async function saveSensitivity() {
  mwanSaving.value = true
  try {
    await saveKmwanSensitivity(sensitivityLevel.value, Number(sensitivityVal.value))
    message.success('切换灵敏度已保存')
    await mwan.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    mwanSaving.value = false
  }
}

async function saveTrack() {
  if (!trackTarget.value) return
  mwanSaving.value = true
  try {
    const ipv4 = trackForm.track_ipv4.split(/\n|,|\s+/).map((x) => x.trim()).filter(Boolean)
    const ipv6 = trackForm.track_ipv6.split(/\n|,|\s+/).map((x) => x.trim()).filter(Boolean)
    await saveKmwanInterface({
      interface: trackTarget.value,
      enable_check: trackForm.enable_check,
      track_proto: Number(trackForm.track_proto),
      track_method: Number(trackForm.track_method),
      track_mode: Number(trackForm.track_mode),
      track_ipv4: ipv4,
      track_ipv6: ipv6,
      enable_ssl: !!trackForm.enable_ssl,
    })
    message.success('接口健康检查已保存')
    await sleep(3000)
    await mwan.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    mwanSaving.value = false
  }
}

/* 接口状态表（多 WAN） */
const mwanRows = computed<AnyRec[]>(() => {
  const cfg = mw.value?.config?.interfaces ?? []
  const st = mw.value?.status?.interfaces ?? []
  const net = mw.value?.network ?? []
  return cfg.map((c) => {
    const s = st.find((x) => x.interface === c.interface)
    const n = net.find((x) => x.name === c.interface)
    return {
      interface: c.interface,
      up: !!n?.up,
      track4: s?.status_v4 ?? 0,
      track6: s?.status_v6 ?? 0,
      metric: c.metric ?? 0,
      weight: c.weight ?? 0,
      enable_check: c.enable_check !== false,
      track_proto: c.track_proto ?? 2,
      track_mode: c.track_mode ?? 1,
      track_ips: (c.track_ipv4 ?? []).join(', '),
    }
  })
})
const mwanCols: DataTableColumns<AnyRec> = [
  { title: '接口', key: 'interface', width: 110, render: (r) => h('span', { class: 'nui-mono' }, r.interface) },
  {
    title: '链路',
    key: 'up',
    width: 78,
    render: (r) =>
      h(NTag, { size: 'small', bordered: false, type: r.up ? 'success' : 'default' }, { default: () => (r.up ? 'UP' : 'DOWN') }),
  },
  {
    title: 'kmwan v4',
    key: 'track4',
    width: 96,
    render: (r) =>
      h(NTag, { size: 'small', bordered: false, type: r.track4 > 0 ? 'success' : 'error' }, { default: () => (r.track4 > 0 ? '正常' : '失败') }),
  },
  {
    title: 'kmwan v6',
    key: 'track6',
    width: 96,
    render: (r) =>
      h(NTag, { size: 'small', bordered: false, type: r.track6 > 0 ? 'success' : 'default' }, { default: () => (r.track6 > 0 ? '正常' : '—') }),
  },
  { title: '优先级 metric', key: 'metric', width: 110, render: (r) => h('span', { class: 'nui-mono' }, String(r.metric)) },
  { title: '权重', key: 'weight', width: 70, render: (r) => h('span', { class: 'nui-mono' }, String(r.weight)) },
  {
    title: '健康检查',
    key: 'enable_check',
    width: 92,
    render: (r) => h('span', {}, r.enable_check ? '已启用' : '关闭'),
  },
  { title: '检测目标', key: 'track_ips', minWidth: 200, render: (r) => h('span', { class: 'nui-mono nui-small' }, r.track_ips || '—') },
]

const errors = computed(() => (section.value === 'wan' ? w.value?.errors ?? [] : mw.value?.errors ?? []))
</script>

<template>
  <div class="nui-page">
    <!-- ==================== 上网设置 ==================== -->
    <template v-if="section === 'wan'">
      <div class="nui-grid">
        <!-- 概览 -->
        <PanelCard class="span-8" title="当前出口与公网地址">
          <template #icon><n-icon><GlobeOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" quaternary :loading="wan.loading.value" @click="wan.reload()">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新
            </n-button>
          </template>
          <PageState :loading="wan.loading.value" :error="wan.error.value" :empty="!w" empty-text="读取不到 WAN 数据" @retry="wan.reload()">
            <div class="wan-hero">
              <div class="hero-main">
                <div class="k">当前出口</div>
                <div class="nui-mid">
                  {{ w?.repeater ? '中继（Wi-Fi STA）' : (cable?.config?.protocol || '—').toUpperCase() }}
                  <span class="nui-small nui-muted nui-mono">{{ w?.wanInfo?.interface || '' }}</span>
                </div>
                <div class="nui-small nui-muted">
                  公网 IPv4 <b class="nui-mono">{{ w?.external?.ipv4 || '—' }}</b>
                  <span v-if="w?.external?.location"> · {{ w.external.location }}</span>
                  <span v-if="w?.external?.isp"> · {{ w.external.isp }}</span>
                </div>
              </div>
              <div class="hero-rates">
                <div>
                  <div class="k">实时下载</div>
                  <div><span class="nui-mid">{{ rx.value }}</span><span class="nui-unit">{{ rx.unit }}</span></div>
                </div>
                <div>
                  <div class="k">实时上传</div>
                  <div><span class="nui-mid">{{ tx.value }}</span><span class="nui-unit">{{ tx.unit }}</span></div>
                </div>
              </div>
            </div>

            <div class="kv-grid">
              <div><div class="k">IP / 掩码</div><div class="v nui-mono">{{ w?.wanInfo?.ip || '—' }} / {{ w?.wanInfo?.netmask || '—' }}</div></div>
              <div><div class="k">默认网关</div><div class="v nui-mono">{{ w?.wanInfo?.gateway || w?.repeater?.ipv4?.gateway || '—' }}</div></div>
              <div><div class="k">DNS</div><div class="v nui-mono ellipsis">{{ (w?.wanInfo?.dns ?? []).join(', ') || (w?.repeater?.ipv4?.dns ?? []).join(', ') || '—' }}</div></div>
              <div><div class="k">WAN 口网线</div><div class="v">{{ cable?.check?.cable_inserted ? '已插入' : '未插入' }}<span v-if="cable?.check" class="nui-small nui-muted">（使能 {{ cable.check.cable_enabled ? '是' : '否' }}）</span></div></div>
              <div><div class="k">上游连接时长</div><div class="v">{{ w?.repeater?.connected || '—' }}</div></div>
              <div><div class="k">网络模式</div><div class="v">{{ w?.netmode || '—' }}</div></div>
            </div>

            <div class="ifaces">
              <div v-for="i in w?.network ?? []" :key="i.name" class="iface">
                <i class="dot" :class="i.up ? 'on' : 'off'" />
                <span class="nui-mono" style="width: 92px">{{ i.name }}</span>
                <span class="nui-small nui-muted" style="flex: 1">{{ i.up ? '链路启用' : i.online ? '在线但未启用' : '未启用' }}</span>
                <span v-if="i.name === w?.wanInfo?.interface" class="nui-mono nui-small">{{ w?.wanInfo?.ip }}</span>
              </div>
            </div>
          </PageState>
        </PanelCard>

        <!-- 联网检测（store，shell 每 15s 刷新） -->
        <PanelCard class="span-4" title="联网检测">
          <template #icon><n-icon><PulseOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" quaternary @click="device.checkConn(true)">重新检测</n-button>
          </template>
          <div class="conn-head">
            <n-tag
              size="small"
              :bordered="false"
              :type="device.conn?.level === 'ok' ? 'success' : device.conn?.level === 'link' ? 'warning' : 'error'"
              round
            >
              {{ device.conn?.level === 'ok' ? '已联网' : device.conn?.level === 'link' ? '链路通但无法上网' : device.conn ? '未联网' : '检测中…' }}
            </n-tag>
            <span class="nui-small nui-muted">{{ device.conn ? fmtAgo(device.conn.checkedAt) : '' }}</span>
          </div>
          <div class="rows">
            <div class="row"><span class="rk">出口接口</span><span class="rv nui-mono">{{ device.conn?.active || w?.wanInfo?.interface || '—' }}</span></div>
            <div class="row"><span class="rk">外网延迟</span><span class="rv nui-mono">{{ device.conn?.latency != null ? device.conn.latency + ' ms' : '—' }}</span></div>
            <div class="row"><span class="rk">检测方式</span><span class="rv">{{ device.conn?.source || '—' }}</span></div>
            <div class="row"><span class="rk">上游连接</span><span class="rv">{{ w?.repeater?.connected || '—' }}</span></div>
          </div>
          <div class="ifaces" style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--line-dash)">
            <div v-for="i in device.conn?.ifaces ?? []" :key="i.name" class="iface">
              <i class="dot" :class="i.online ? 'on' : 'off'" />
              <span class="nui-mono nui-small" style="width: 82px">{{ i.name }}</span>
              <span class="nui-small nui-muted ellipsis" style="flex: 1">{{ i.status || (i.online ? '在线' : '离线') }}</span>
              <span class="nui-mono nui-small">{{ i.ip || '' }}</span>
            </div>
          </div>
          <div class="nui-small nui-muted" style="margin-top: 8px">
            出口判断依据：glass.conn_check（默认路由 → 网关 → 外网 → DNS）；失败退回 kmwan 链路跟踪。
          </div>
        </PanelCard>

        <!-- 以太网 WAN 设置 -->
        <PanelCard class="span-8" title="上网方式（以太网 WAN）">
          <template #icon><n-icon><LinkOutline /></n-icon></template>
          <template #extra><span class="nui-small nui-muted">cable.set_config</span></template>
          <NAlert type="info" :bordered="false" style="margin-bottom: 12px">
            这里配置的是 <b>WAN 口（eth0）</b>。本机当前通过中继上行，修改此项不会影响中继，但会重建以太网 WAN 接口。
          </NAlert>
          <div class="form">
            <div class="frow">
              <span class="flabel">上网方式</span>
              <n-select v-model:value="cableForm.protocol" size="small" :options="protocolOptions" @update:value="cableDirty = true" />
            </div>
            <template v-if="cableForm.protocol === 'static'">
              <div class="frow"><span class="flabel">IP 地址</span><n-input v-model:value="cableForm.ip" size="small" placeholder="192.168.1.100" @update:value="cableDirty = true" /></div>
              <div class="frow"><span class="flabel">子网掩码</span><n-input v-model:value="cableForm.netmask" size="small" @update:value="cableDirty = true" /></div>
              <div class="frow"><span class="flabel">网关</span><n-input v-model:value="cableForm.gateway" size="small" placeholder="192.168.1.1" @update:value="cableDirty = true" /></div>
            </template>
            <template v-if="cableForm.protocol === 'pppoe'">
              <div class="frow"><span class="flabel">宽带账号</span><n-input v-model:value="cableForm.username" size="small" @update:value="cableDirty = true" /></div>
              <div class="frow"><span class="flabel">宽带密码</span><n-input v-model:value="cableForm.password" size="small" type="password" show-password-on="click" @update:value="cableDirty = true" /></div>
            </template>
            <div class="frow"><span class="flabel">DNS 1</span><n-input v-model:value="cableForm.dns1" size="small" placeholder="留空使用运营商 DNS" @update:value="cableDirty = true" /></div>
            <div class="frow"><span class="flabel">DNS 2</span><n-input v-model:value="cableForm.dns2" size="small" @update:value="cableDirty = true" /></div>
            <div class="frow"><span class="flabel">VLAN ID</span><n-input-number v-model:value="cableForm.vlanid" size="small" :min="0" :max="4095" placeholder="不启用" @update:value="cableDirty = true" /></div>
            <div class="frow"><span class="flabel">MTU</span><n-input-number v-model:value="cableForm.mtu" size="small" :min="576" :max="1500" placeholder="默认 1500" @update:value="cableDirty = true" /></div>
            <div class="frow actions">
              <n-popconfirm @positive-click="saveCable">
                <template #trigger>
                  <n-button size="small" type="primary" :loading="savingCable" :disabled="!cableDirty">保存并重连</n-button>
                </template>
                保存会重建 WAN 接口，若 WAN 口正在上网会短暂断网。确认保存？
              </n-popconfirm>
              <n-button size="small" secondary :disabled="!cableDirty" @click="syncCableForm">还原</n-button>
              <n-popconfirm @positive-click="reapplyCable">
                <template #trigger>
                  <n-button size="small" secondary :loading="reapplying">重新应用当前配置</n-button>
                </template>
                将按当前配置重新连接 WAN（短暂断网）。确认？
              </n-popconfirm>
            </div>
          </div>
          <p class="nui-small nui-muted" style="margin: 8px 0 0">
            入参说明：与 cable.get_config 同构 + {secondwan:false, usbwan:false}；写后 3 秒回读校验协议是否落地。
          </p>
        </PanelCard>

        <!-- 中继上游 -->
        <PanelCard class="span-4" title="中继上游">
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" quaternary @click="router.push('/wireless/repeater')">管理</n-button>
          </template>
          <PageState :loading="wan.loading.value" :error="wan.error.value" :empty="!w" compact empty-text="中继接口不可用" @retry="wan.reload()">
            <div v-if="rep && rep.running" class="rows">
              <div class="row"><span class="rk">上游 SSID</span><span class="rv ellipsis">{{ rep.ssid || '—' }}</span></div>
              <div class="row"><span class="rk">BSSID</span><span class="rv nui-mono nui-small">{{ rep.bssid || '—' }}</span></div>
              <div class="row"><span class="rk">信号</span><span class="rv nui-mono">{{ rep.signal }} dBm <span class="nui-small nui-muted">{{ rep.band }} · CH{{ rep.channel }} · {{ rep.htmode }}</span></span></div>
              <div class="row"><span class="rk">加密</span><span class="rv">{{ rep.wpa_status?.key_mgmt || '—' }}<span v-if="rep.dfs" class="nui-small nui-muted">（DFS 信道）</span></span></div>
              <div class="row"><span class="rk">上游 IP / 网关</span><span class="rv nui-mono nui-small">{{ rep.ipv4?.ip || '—' }}<br />{{ rep.ipv4?.gateway || '—' }}</span></div>
              <div class="row"><span class="rk">连接时长</span><span class="rv">{{ rep.connected || '—' }}</span></div>
              <div class="row"><span class="rk">门户认证</span><span class="rv">{{ rep.portal ? '检测到门户' : '无' }}</span></div>
            </div>
            <div v-else class="nui-small nui-muted">当前未连接中继（repeater.get_status：running=false）</div>
            <div class="actions" style="margin-top: 10px">
              <n-popconfirm @positive-click="disconnectRepeater">
                <template #trigger>
                  <n-button size="small" secondary type="warning" :disabled="!rep?.running" :loading="disconnecting">断开中继</n-button>
                </template>
                断开中继会立即失去当前上游网络，确认断开？
              </n-popconfirm>
            </div>
          </PageState>
        </PanelCard>

        <!-- 热点共享 -->
        <PanelCard class="span-4" title="热点共享（Tethering）">
          <template #extra><span class="nui-small nui-muted">tethering.get_status</span></template>
          <PageState :loading="wan.loading.value" :error="wan.error.value" :empty="!w" compact empty-text="tethering 不可用" @retry="wan.reload()">
            <div v-if="(w?.tethering.config ?? []).length || (w?.tethering.status?.devices ?? []).length" class="rows">
              <div class="row"><span class="rk">状态</span><span class="rv">{{ w?.tethering.status?.status === 1 ? '已连接' : '未连接' }}</span></div>
              <div class="row"><span class="rk">设备数</span><span class="rv">{{ (w?.tethering.status?.devices ?? []).length }}</span></div>
            </div>
            <div v-else>
              <n-tag size="small" :bordered="false" type="default">未检测到 USB 网络共享设备</n-tag>
              <p class="nui-small nui-muted" style="margin: 8px 0 0">
                tethering.get_config 返回空数组、get_status.devices=[]：本机没有可用的 USB 共享/手机热点来源。
                插入支持 USB 网络共享的设备后此处会出现配置项。
              </p>
            </div>
          </PageState>
        </PanelCard>

        <!-- DDNS -->
        <PanelCard class="span-4" title="DDNS">
          <template #extra>
            <n-button size="tiny" quaternary @click="router.push('/cloud/ddns')">配置</n-button>
          </template>
          <PageState :loading="wan.loading.value" :error="wan.error.value" :empty="!w" compact empty-text="ddns 不可用" @retry="wan.reload()">
            <div class="rows">
              <div class="row"><span class="rk">状态</span><span class="rv"><n-tag size="small" :bordered="false" :type="w?.ddns?.config?.enable_ddns ? 'success' : 'default'">{{ w?.ddns?.config?.enable_ddns ? '已启用' : '未启用' }}</n-tag></span></div>
              <div class="row"><span class="rk">设备 ID</span><span class="rv nui-mono">{{ w?.ddns?.config?.device_id || '—' }}</span></div>
              <div class="row"><span class="rk">域名</span><span class="rv nui-mono">{{ w?.ddns?.config?.device_id ? w.ddns.config.device_id + '.glddns.com' : '—' }}</span></div>
              <div class="row"><span class="rk">解析状态</span><span class="rv">{{ w?.ddns?.status?.status === 2 ? '解析正常' : w?.ddns?.status?.status === 1 ? '更新中' : '未生效' }}</span></div>
            </div>
            <div class="ddns-ips">
              <div v-for="i in w?.ddns?.status?.ips ?? []" :key="i.interface" class="row">
                <span class="rk nui-mono">{{ i.interface }}</span>
                <span class="rv nui-mono nui-small">{{ (i.ip ?? []).join(', ') || '—' }}</span>
              </div>
            </div>
          </PageState>
        </PanelCard>

        <!-- 旁路由 / 蜂窝 / 接口总表 -->
        <PanelCard class="span-4" :title="showCellular ? '旁路由与蜂窝' : '旁路由'">
          <template #extra><span class="nui-small nui-muted">edgerouter / modem</span></template>
          <div class="rows">
            <div class="row"><span class="rk">旁路由 detected</span><span class="rv nui-mono">{{ edge?.status?.detected ?? '—' }}</span></div>
            <div class="row"><span class="rk">旁路由开关</span><span class="rv">{{ edge?.config?.enable ? '已启用' : '未启用' }}<span class="nui-small nui-muted">（ignore={{ edge?.config?.ignore ? '1' : '0' }}）</span></span></div>
          </div>
          <p class="nui-small nui-muted" style="margin: 6px 0 12px">
            旁路由模式会改变 LAN 网关行为，属官方高风险写操作；本后台只读展示，切换请到官方后台。
          </p>
          <div v-if="showCellular" class="rows">
            <div class="row"><span class="rk">蜂窝模组</span><span class="rv">{{ modem?.present ? '已检测到' : '未检测到' }}</span></div>
            <div v-if="!modem?.present" class="row"><span class="rk">诊断</span><span class="rv nui-small nui-muted" style="max-width: 66%">{{ (modem?.diagnostics ?? [])[0] || '本机无蜂窝模组' }}</span></div>
          </div>
        </PanelCard>

        <PanelCard class="span-12" title="接口状态总表">
          <template #icon><n-icon><GitNetworkOutline /></n-icon></template>
          <div class="iface-grid">
            <div v-for="i in w?.network ?? []" :key="i.name" class="iface-card">
              <div class="nui-between">
                <span class="nui-mono">{{ i.name }}</span>
                <i class="dot" :class="i.up ? 'on' : 'off'" />
              </div>
              <div class="nui-small nui-muted">{{ i.up ? '链路 UP' : i.online ? '在线' : '未启用' }}</div>
              <div v-if="i.name === w?.wanInfo?.interface" class="nui-mono nui-small">{{ w?.wanInfo?.ip || '—' }}</div>
            </div>
          </div>
        </PanelCard>
      </div>
    </template>

    <!-- ==================== 多 WAN ==================== -->
    <template v-else>
      <div class="nui-grid">
        <PanelCard class="span-8" title="接口跟踪状态">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" quaternary :loading="mwan.loading.value" @click="mwan.reload()">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新
            </n-button>
          </template>
          <PageState :loading="mwan.loading.value" :error="mwan.error.value" :empty="!mw?.config" empty-text="kmwan.get_config 不可用（当前固件没有多 WAN 能力）" @retry="mwan.reload()">
            <n-data-table
              :columns="mwanCols"
              :data="mwanRows"
              :bordered="false"
              :single-line="false"
              size="small"
              :scroll-x="900"
              :row-key="(r: AnyRec) => r.interface"
            />
          </PageState>
        </PanelCard>

        <PanelCard class="span-4" title="切换灵敏度">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
          <div class="rows">
            <div class="row"><span class="rk">当前</span><span class="rv">{{ mw?.sensitivity?.level || '—' }}（间隔 {{ mw?.sensitivity?.val ?? '—' }}s）</span></div>
          </div>
          <div class="frow" style="margin-top: 10px">
            <span class="flabel">等级</span>
            <n-select v-model:value="sensitivityLevel" size="small" :options="sensitivityOptions" />
          </div>
          <div class="frow">
            <span class="flabel">检测间隔(s)</span>
            <n-input-number v-model:value="sensitivityVal" size="small" :min="1" :max="90" />
          </div>
          <n-button size="small" type="primary" :loading="mwanSaving" @click="saveSensitivity">保存灵敏度</n-button>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            kmwan.set_sensitivity → {sensitivity:{level, val}}；level 取 low/medium/high/custom，val 为链路检测间隔（秒）。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="接口优先级（mode 0）">
          <template #extra><span class="nui-small nui-muted">metric 越小越优先</span></template>
          <div class="prio">
            <div v-for="(name, i) in priorityOrder" :key="name" class="prio-row">
              <span class="prio-idx">{{ i + 1 }}</span>
              <span class="nui-mono" style="flex: 1">{{ name }}</span>
              <n-button size="tiny" quaternary :disabled="i === 0" @click="movePriority(i, -1)">↑</n-button>
              <n-button size="tiny" quaternary :disabled="i === priorityOrder.length - 1" @click="movePriority(i, 1)">↓</n-button>
            </div>
            <div v-if="!priorityOrder.length" class="nui-small nui-muted">无接口</div>
          </div>
          <div class="actions" style="margin-top: 10px">
            <n-button size="small" secondary :disabled="modeValue !== 0" @click="modeValue = 0; saveMode()" :loading="mwanSaving">保存优先级</n-button>
            <span class="nui-small nui-muted">当前模式：{{ mw?.config?.mode === 1 ? '负载均衡' : '接口优先级' }}</span>
          </div>
        </PanelCard>

        <PanelCard class="span-6" title="负载比例（mode 1）">
          <template #extra><span class="nui-small nui-muted">weight 权重</span></template>
          <div class="weights">
            <div v-for="i in mw?.config?.interfaces ?? []" :key="i.interface" class="wrow">
              <span class="nui-mono" style="width: 92px">{{ i.interface }}</span>
              <n-input-number v-model:value="weights[i.interface]" size="small" :min="1" :max="99" style="width: 120px" />
            </div>
          </div>
          <div class="actions" style="margin-top: 10px">
            <n-button size="small" secondary :loading="mwanSaving" @click="modeValue = 1; saveMode()">保存权重（切到负载均衡）</n-button>
          </div>
          <p class="nui-small nui-muted" style="margin: 8px 0 0">
            kmwan.set_config → {mode:1, interfaces:[{interface, weight}]}；两接口权重都为 0 时会被固件拒绝。
          </p>
        </PanelCard>

        <PanelCard class="span-12" title="接口健康检查">
          <template #icon><n-icon><PulseOutline /></n-icon></template>
          <template #extra>
            <n-select v-model:value="trackTarget" size="small" :options="ifaceOptions" style="width: 180px" />
          </template>
          <div class="track-form">
            <div class="frow"><span class="flabel">启用检测</span><n-switch v-model:value="trackForm.enable_check" size="small" /></div>
            <div class="frow"><span class="flabel">协议</span><n-select v-model:value="trackForm.track_proto" size="small" :options="trackProtoOptions" /></div>
            <div class="frow"><span class="flabel">检测模式</span><n-select v-model:value="trackForm.track_mode" size="small" :options="trackModeOptions" /></div>
            <div class="frow"><span class="flabel">IPv4 目标</span><n-input v-model:value="trackForm.track_ipv4" size="small" type="textarea" :rows="3" placeholder="每行一个 IP" /></div>
            <div class="frow"><span class="flabel">IPv6 目标</span><n-input v-model:value="trackForm.track_ipv6" size="small" type="textarea" :rows="3" placeholder="每行一个 IPv6" /></div>
          </div>
          <div class="actions">
            <n-button size="small" type="primary" :loading="mwanSaving" :disabled="!trackTarget" @click="saveTrack">保存健康检查</n-button>
          </div>
          <p class="nui-small nui-muted" style="margin: 8px 0 0">
            kmwan.set_interface → {interface, enable_check, track_proto, track_method, track_mode, track_ipv4[], track_ipv6[], enable_ssl}
          </p>
        </PanelCard>

        <PanelCard v-if="mw?.config?.mode !== undefined" class="span-12" title="多 WAN 说明">
          <div class="nui-small nui-muted" style="line-height: 1.9">
            · 本机接口：<span class="nui-mono">{{ (mw?.config?.interfaces ?? []).map((i) => i.interface).join(' / ') || '—' }}</span>；
            实际只有 wwan（中继上行）在线，其余接口无物理链路，因此「链路」列为 DOWN。<br />
            · kmwan v4/v6 是 kmwan 自己上报的跟踪结果（status_v4/status_v6），与物理链路 up 可能不一致（例如 wan 未插线但配置跟踪正常）。<br />
            · 优先级模式（mode 0）：metric 越小越优先，切换按 metric 顺序找可用链路；负载均衡（mode 1）按 weight 比例分流。<br />
            · 写操作均先读当前 kmwan.get_config 再整包提交，保存后等待 4 秒回读确认。
          </div>
        </PanelCard>
      </div>
    </template>

    <div v-if="errors.length" class="errs">
      <NAlert type="warning" :bordered="false">{{ errors.join('；') }}</NAlert>
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

.wan-hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
.hero-rates { display: flex; gap: 26px; }
.kv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 18px; }
.ifaces { margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--line-dash); display: flex; flex-direction: column; gap: 4px; }
.iface { display: flex; align-items: center; gap: 8px; }
.iface-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.iface-card { padding: 10px 12px; border-radius: 10px; background: rgba(128, 128, 128, 0.08); display: flex; flex-direction: column; gap: 3px; }
.conn-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }

.form { max-width: 620px; }
.frow { display: grid; grid-template-columns: 108px minmax(0, 1fr); align-items: center; gap: 12px; margin-bottom: 10px; }
.flabel { font-size: 12.5px; opacity: 0.62; }
.frow.actions { display: flex; gap: 10px; margin-top: 14px; }
.actions { display: flex; align-items: center; gap: 10px; }

.ddns-ips { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--line-dash); display: flex; flex-direction: column; gap: 3px; }

.prio { display: flex; flex-direction: column; gap: 6px; }
.prio-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 8px; background: rgba(128, 128, 128, 0.08); }
.prio-idx { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--nui-accent); color: #fff; font-size: 11px; }
.weights { display: flex; flex-direction: column; gap: 8px; }
.wrow { display: flex; align-items: center; gap: 12px; }
.track-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
.track-form .frow { margin-bottom: 0; grid-template-columns: 86px minmax(0, 1fr); }
.errs { margin-top: 4px; }

@media (max-width: 1100px) {
  .kv-grid { grid-template-columns: 1fr 1fr; }
  .iface-grid { grid-template-columns: 1fr 1fr; }
  .track-form { grid-template-columns: 1fr; }
  .wan-hero { flex-direction: column; }
}
</style>
