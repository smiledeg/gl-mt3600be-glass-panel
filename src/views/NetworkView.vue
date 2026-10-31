<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NDataTable,
  NEmpty,
  NForm,
  NFormItemGi,
  NGrid,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  GitNetworkOutline,
  GlobeOutline,
  LayersOutline,
  SaveOutline,
  ServerOutline,
  SwapHorizontalOutline,
  WifiOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import SettingsForm, { type Field } from '@/components/SettingsForm.vue'
import { useAsync } from '@/composables/useAsync'
import * as net from '@/api/net'
import { fmtDuration } from '@/utils/format'

const props = defineProps<{ section?: string }>()
const section = computed(() => String(props.section || 'lan'))
const message = useMessage()
const router = useRouter()

/* ---------------- 小工具 ---------------- */
const isIp = (s: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(String(s || '').trim()) && String(s).split('.').every((x) => Number(x) <= 255)
const ip2n = (s: string) => String(s).split('.').reduce((a, x) => (a << 8) + (Number(x) & 255), 0) >>> 0
const sameSubnet = (a: string, b: string, mask: string) => {
  if (!isIp(a) || !isIp(b) || !isIp(mask)) return false
  const m = ip2n(mask)
  return ((ip2n(a) & m) >>> 0) === ((ip2n(b) & m) >>> 0)
}

const soft = ref('')
async function softLoad<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const t = `${label}：${net.errText(e)}`
    soft.value = soft.value ? `${soft.value}；${t}` : t
    return fallback
  }
}

/* ================= 数据装载 ================= */

/* --- LAN --- */
const lanIfaces = ref<net.LanIface[]>([])
const lanForm = reactive({
  ip: '',
  netmask: '255.255.255.0',
  dhcp: true,
  start: '',
  end: '',
  leasetimeMin: 720,
  gateway: '',
  dns1: '',
  dns2: '',
  apIsolate: false,
})
const lanSaving = ref(false)

async function loadLan() {
  const list = await net.getLanInterfaces()
  lanIfaces.value = list
  const main = list.find((i) => i.interface === 'lan') ?? list[0]
  if (!main) throw new Error('lan.get_config_list 未返回任何接口')
  lanForm.ip = main.ip
  lanForm.netmask = main.netmask
  lanForm.dhcp = !!Number(main.enable)
  lanForm.start = main.start
  lanForm.end = main.end
  lanForm.leasetimeMin = net.leaseToMinutes(main.leasetime)
  lanForm.gateway = main.gateway ?? ''
  lanForm.dns1 = (main.dns ?? [])[0] ?? ''
  lanForm.dns2 = (main.dns ?? [])[1] ?? ''
  lanForm.apIsolate = !!Number(main.ap_isolate)
  return true
}

const lanWarns = computed(() => {
  const out: string[] = []
  if (!isIp(lanForm.ip)) out.push('路由器地址不是合法 IPv4')
  if (!isIp(lanForm.netmask)) out.push('子网掩码不是合法 IPv4')
  if (isIp(lanForm.ip) && /\.(0|255)$/.test(lanForm.ip)) out.push('路由器地址不能以 .0 / .255 结尾（网络号/广播地址）')
  if (lanForm.dhcp) {
    if (!isIp(lanForm.start) || !isIp(lanForm.end)) out.push('DHCP 地址池起止必须是合法 IPv4')
    else {
      if (!sameSubnet(lanForm.ip, lanForm.start, lanForm.netmask)) out.push('地址池起始不在 LAN 网段内')
      if (!sameSubnet(lanForm.ip, lanForm.end, lanForm.netmask)) out.push('地址池结束不在 LAN 网段内')
      if (ip2n(lanForm.start) > ip2n(lanForm.end)) out.push('地址池起始必须小于结束')
      if (isIp(lanForm.ip) && ip2n(lanForm.ip) >= ip2n(lanForm.start) && ip2n(lanForm.ip) <= ip2n(lanForm.end))
        out.push('路由器地址落在 DHCP 地址池内，可能被重复分配（建议池起始从 .100 之后开始）')
    }
  }
  for (const i of lanIfaces.value) {
    if (i.interface === 'lan') continue
    if (isIp(lanForm.ip) && sameSubnet(lanForm.ip, i.ip, lanForm.netmask))
      out.push(`与 ${i.interface} 网段（${i.ip}/${i.netmask}）重叠，保存会被固件拒绝（错误码 -8/-9）`)
  }
  if (lanForm.dns1 && !isIp(lanForm.dns1)) out.push('DNS1 不是合法 IPv4')
  if (lanForm.dns2 && !isIp(lanForm.dns2)) out.push('DNS2 不是合法 IPv4')
  return out
})

async function saveLan() {
  if (lanWarns.value.length) {
    message.warning('请先处理页面上的提示项')
    return
  }
  const confirmIp = lanForm.ip
  lanSaving.value = true
  try {
    await net.saveLanAddr({ interface: 'lan', ip: lanForm.ip, netmask: lanForm.netmask, ap_isolate: lanForm.apIsolate ? 1 : 0 })
    await net.saveLanDhcp({
      interface: 'lan',
      enable: lanForm.dhcp,
      leasetimeMin: lanForm.leasetimeMin,
      gateway: lanForm.gateway,
      start: lanForm.start,
      end: lanForm.end,
      dns: [lanForm.dns1, lanForm.dns2],
    })
    if (confirmIp !== (lanIfaces.value.find((i) => i.interface === 'lan')?.ip ?? '')) {
      message.warning('LAN 地址已改：本页稍后会断开，请用新地址重新打开后台')
    }
    await loadLan()
    message.success('LAN / DHCP 已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    lanSaving.value = false
  }
}

/* --- DHCP 静态绑定 / 租约 --- */
const binds = ref<net.StaticBind[]>([])
const leases = ref<net.DhcpLease[]>([])
const dhcpState = ref<net.DhcpState | null>(null)
const bindSaving = ref(false)
const bindForm = reactive({ mac: '', ip: '', name: '' })
const editingMac = ref('')

async function loadDhcp() {
  binds.value = await net.getStaticBinds()
  leases.value = await softLoad(() => net.getDhcpLeases(), [], 'DHCP 租约（插件桥 net.dhcp_leases）')
  dhcpState.value = await softLoad(() => net.getDhcpState(), null, 'DHCP 实际生效配置（插件桥 net.dhcp_get）')
  return true
}

function resetBindForm() {
  bindForm.mac = ''
  bindForm.ip = ''
  bindForm.name = ''
  editingMac.value = ''
}

function editBind(row: net.StaticBind) {
  bindForm.mac = row.mac
  bindForm.ip = row.ip
  bindForm.name = row.name ?? ''
  editingMac.value = row.mac
}

function bindFromLease(l: net.DhcpLease) {
  bindForm.mac = l.mac
  bindForm.ip = l.ip
  bindForm.name = (l.hostname || '').replace(/[^\w-]/g, '').slice(0, 32)
  editingMac.value = ''
  message.info('已填入表单，确认后点「添加绑定」')
}

async function submitBind() {
  if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(bindForm.mac)) {
    message.warning('MAC 格式应为 AA:BB:CC:DD:EE:FF')
    return
  }
  if (!isIp(bindForm.ip)) {
    message.warning('IP 格式不正确')
    return
  }
  bindSaving.value = true
  try {
    const payload = { mac: bindForm.mac, ip: bindForm.ip, name: bindForm.name }
    if (editingMac.value) await net.setStaticBind(payload)
    else await net.addStaticBind(payload)
    const after = await net.getStaticBinds()
    const hit = after.find((b) => String(b.mac).toUpperCase() === bindForm.mac.toUpperCase())
    if (!hit || hit.ip !== bindForm.ip) throw new Error('保存后回读不到该条目，设备可能拒绝了本次修改')
    binds.value = after
    message.success(editingMac.value ? '绑定已更新并回读确认' : '绑定已添加并回读确认')
    resetBindForm()
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    bindSaving.value = false
  }
}

const bindSavingMap = ref<Record<string, boolean>>({})
async function clearAllBinds() {
  try {
    await net.delStaticBind()
    const after = await net.getStaticBinds()
    if (after.length) throw new Error('清空后仍有条目，设备可能拒绝了本次操作')
    binds.value = after
    resetBindForm()
    message.success('已清空全部静态绑定')
  } catch (e) {
    message.error(net.errText(e))
  }
}
async function removeBind(row: net.StaticBind) {
  bindSavingMap.value[row.mac] = true
  try {
    await net.delStaticBind(row.mac)
    const after = await net.getStaticBinds()
    if (after.some((b) => String(b.mac).toUpperCase() === row.mac.toUpperCase())) throw new Error('删除后条目仍在，设备可能拒绝了本次操作')
    binds.value = after
    message.success('绑定已删除并回读确认')
    if (editingMac.value === row.mac) resetBindForm()
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    bindSavingMap.value[row.mac] = false
  }
}

const bindCols = computed<DataTableColumns<net.StaticBind>>(() => [
  { title: '名称', key: 'name', render: (r) => r.name || r.hostname || '—' },
  { title: 'MAC', key: 'mac', render: (r) => h('span', { class: 'nui-mono' }, r.mac) },
  { title: 'IP', key: 'ip', render: (r) => h('span', { class: 'nui-mono' }, r.ip) },
  {
    title: '操作',
    key: 'op',
    width: 130,
    render: (r) =>
      h('div', { class: 'nui-row' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => editBind(r) }, { default: () => '编辑' }),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeBind(r) },
          {
            trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error', loading: !!bindSavingMap.value[r.mac] }, { default: () => '删除' }),
            default: () => `删除 ${r.mac} → ${r.ip} 的静态绑定？该终端将回到动态分配。`,
          },
        ),
      ]),
  },
])

const leaseCols = computed<DataTableColumns<net.DhcpLease>>(() => [
  { title: '主机名', key: 'hostname', width: 110, ellipsis: { tooltip: true }, render: (r) => r.hostname || '—' },
  { title: 'IP', key: 'ip', width: 122, render: (r) => h('span', { class: 'nui-mono' }, r.ip) },
  { title: 'MAC', key: 'mac', width: 142, render: (r) => h('span', { class: 'nui-mono nui-small' }, r.mac) },
  {
    title: '剩余',
    key: 'expires',
    width: 100,
    render: (r) => (r.expires === false ? '永久' : fmtDuration(Number(r.expires))),
  },
  {
    title: '',
    key: 'op',
    width: 76,
    render: (r) => h(NButton, { size: 'tiny', quaternary: true, onClick: () => bindFromLease(r) }, { default: () => '绑定' }),
  },
])

/* --- DNS --- */
const dnsCfg = ref<net.DnsConfig>({})
const dnsSaving = ref(false)
const dnsMode = ref('auto')
const dnsFlags = reactive({ force_dns: false, rebind_protection: false, override_vpn: true })
const manualText = ref('')
const proxyText = ref('')
const secureForm = reactive({ provider: 'controld', proto: 'dot', server: '', controldId: '', nextdnsId: '', manualText: '' })
const providers = ref<net.DnsProvider[]>([])
const providersLoaded = ref(false)

async function loadDns() {
  const cfg = await net.getDnsConfig()
  dnsCfg.value = cfg
  dnsMode.value = String(cfg.mode ?? 'auto')
  dnsFlags.force_dns = !!cfg.force_dns
  dnsFlags.rebind_protection = !!cfg.rebind_protection
  dnsFlags.override_vpn = cfg.override_vpn !== false
  manualText.value = (cfg.manual_list ?? []).join('\n')
  proxyText.value = (cfg.proxy_list ?? []).join('\n')
  secureForm.provider = String(cfg.provider || 'controld')
  secureForm.proto = String(cfg.proto || 'dot')
  secureForm.controldId = String(cfg.controld_id ?? '')
  secureForm.nextdnsId = String(cfg.nextdns_id ?? '')
  secureForm.server = String((cfg.servers_list ?? [])[0] ?? '')
  secureForm.manualText = (cfg.secure_manual_list ?? []).join('\n')
  if (dnsMode.value === 'secure') void ensureProviders()
  return true
}

async function ensureProviders() {
  if (providersLoaded.value) return
  try {
    providers.value = await net.getDnsProviders()
    providersLoaded.value = true
  } catch (e) {
    soft.value = `${soft.value ? soft.value + '；' : ''}加密 DNS 服务商清单（dns.get_info）：${net.errText(e)}`
  }
}

const providerOptions = computed(() =>
  providers.value.map((p) => ({
    label:
      ({ controld: 'Control D', nextdns: 'NextDNS', quad9: 'Quad9', cloudflare: 'Cloudflare', adguard_dns: 'AdGuard DNS', google_dns: 'Google DNS', opendns: 'OpenDNS', cleanbrowsing: 'CleanBrowsing', manual: '手动' } as Record<string, string>)[
        p.provider
      ] || p.provider,
    value: p.provider,
  })),
)
const currentProvider = computed(() => providers.value.find((p) => p.provider === secureForm.provider))
const protoOptions = computed(() =>
  (currentProvider.value?.sup_proto ?? ['dot', 'doh']).map((p) => ({
    label: ({ dot: 'DNS over TLS', doh: 'DNS over HTTPS', doq: 'DNS over QUIC', odoh: 'Oblivious DoH', dnscrypt: 'DNSCrypt' } as Record<string, string>)[p] || p,
    value: p,
  })),
)
const serverOptions = computed(() => {
  const p = currentProvider.value
  if (!p || p.provider === 'manual' || p.provider === 'nextdns') return []
  return (p.server_list ?? []).map((s) => ({
    label: `${s.name ?? ''}${s.description ? ' · ' + s.description : ''}`,
    value: s.name ?? '',
  }))
})

async function saveDnsBasic() {
  dnsSaving.value = true
  try {
    const patch: Partial<net.DnsConfig> = {
      mode: dnsMode.value,
      force_dns: dnsFlags.force_dns,
      rebind_protection: dnsFlags.rebind_protection,
      override_vpn: dnsFlags.override_vpn,
    }
    if (dnsMode.value === 'manual') patch.manual_list = net.splitList(manualText.value)
    if (dnsMode.value === 'proxy') patch.proxy_list = net.splitList(proxyText.value)
    await net.saveDnsConfig(patch)
    const after = await net.getDnsConfig()
    if (String(after.mode) !== dnsMode.value) throw new Error('回读的 DNS 模式与提交不一致，固件可能拒绝了本次修改')
    dnsCfg.value = after
    message.success('DNS 配置已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    dnsSaving.value = false
  }
}

async function saveDnsSecure() {
  dnsSaving.value = true
  try {
    const patch: Partial<net.DnsConfig> = { provider: secureForm.provider, proto: secureForm.proto }
    if (secureForm.provider === 'controld') {
      patch.controld_type = secureForm.controldId ? 0 : 1
      if (secureForm.controldId) patch.controld_id = secureForm.controldId
      else patch.servers_list = [secureForm.server || 'p0']
    } else if (secureForm.provider === 'nextdns') {
      patch.nextdns_id = secureForm.nextdnsId
    } else if (secureForm.provider === 'manual') {
      const list = net.splitList(secureForm.manualText)
      if (!list.length) throw new Error('手动加密 DNS 至少填一条地址（tls:// / https://）')
      patch.secure_manual_list = list
    } else {
      patch.servers_list = [secureForm.server]
    }
    await net.saveDnsConfig(patch)
    const after = await net.getDnsConfig()
    if (String(after.provider ?? '') !== secureForm.provider) throw new Error('回读的服务商与提交不一致，固件可能拒绝了本次修改')
    dnsCfg.value = after
    message.success('加密 DNS 已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    dnsSaving.value = false
  }
}

/* 自定义 hosts（NUI 桥） */
const hosts = ref<net.HostEntry[]>([])
const hostsState = ref<net.HostState | null>(null)
const hostsSaving = ref(false)
const hostTestName = ref('')
const hostTestResult = ref('')

async function loadHosts() {
  const st = await softLoad(() => net.getHostEntries(), null, '自定义 hosts（插件桥 adv.hosts_get）')
  hostsState.value = st
  hosts.value = (st?.list ?? []).map((x) => ({ ...x }))
  return true
}

function addHostRow() {
  hosts.value.push({ ip: '', names: '', enabled: true, note: '' })
}

async function saveHosts() {
  hostsSaving.value = true
  try {
    const st = await net.saveHostEntries(hosts.value.filter((x) => x.ip || x.names))
    hostsState.value = st
    hosts.value = (st?.list ?? []).map((x) => ({ ...x }))
    message.success(`自定义 hosts 已保存（${hosts.value.length} 条，dnsmasq 已重载）`)
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    hostsSaving.value = false
  }
}

async function runHostTest() {
  const name = hostTestName.value.trim()
  if (!name) return
  hostTestResult.value = '解析中…'
  try {
    const r = await net.testHost(name)
    hostTestResult.value = r.addrs?.length ? `${name} → ${r.addrs.join(', ')}` : `${name} 未解析出地址`
  } catch (e) {
    hostTestResult.value = net.errText(e)
  }
}

/* 系统 hosts 文件（官方 dns.get_host / set_host） */
const sysHosts = ref('')
const sysHostsSaving = ref(false)
async function loadSysHosts() {
  sysHosts.value = await softLoad(() => net.getDnsHost(), '', '系统 hosts（dns.get_host）')
  return true
}
async function saveSysHosts() {
  sysHostsSaving.value = true
  try {
    await net.saveDnsHost(sysHosts.value)
    const after = await net.getDnsHost()
    if (after.replace(/\s+/g, '') !== sysHosts.value.replace(/\s+/g, '')) throw new Error('回读内容与提交不一致')
    message.success('/etc/hosts 已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    sysHostsSaving.value = false
  }
}

/* --- IPv6 --- */
const ipv6Cfg = ref<net.Ipv6Config | null>(null)
const ipv6LanAddr = ref('')
async function loadIpv6() {
  ipv6Cfg.value = await net.getIpv6Config()
  advFlags.value = await softLoad(() => net.getSystemFlags(), null, '全局功能开关（system.get_status）')
  const d = await softLoad(() => net.getNetdevs(), null, '网卡信息（插件桥 sys.details）')
  const lan = d?.interfaces?.find((i) => i.name === 'lan')
  ipv6LanAddr.value = (lan?.ipv6 ?? []).join(', ')
  return true
}
const ipv6Fields = computed<Field[]>(() => [
  { key: 'enable', label: '启用 IPv6', type: 'switch', span: 24 },
  {
    key: 'lan_mode',
    label: '局域网模式',
    type: 'select',
    span: 24,
    options: [
      { label: 'Native（原生地址）', value: 'native' },
      { label: 'Passthrough（中继，终端直接拿公网 IPv6）', value: 'relay' },
      { label: 'NAT6（默认）', value: 'nat6' },
      { label: 'Static IPv6（静态前缀）', value: 'static' },
    ],
  },
  { key: 'lan_dns_mode', label: '从上游获取 IPv6 DNS', type: 'switch', span: 24 },
  { key: 'lan_dns1', label: 'IPv6 DNS 1', span: 12, placeholder: '2400:3200::1' },
  { key: 'lan_dns2', label: 'IPv6 DNS 2', span: 12, placeholder: '2400:3200:baba::1' },
  { key: 'lan_ip', label: 'LAN IPv6 地址/前缀（Static 模式）', span: 24, placeholder: 'fd05:0e25:8607::1/64' },
])
async function saveIpv6(v: Record<string, unknown>) {
  const cfg: net.Ipv6Config = {
    enable: !!v.enable,
    lan_mode: String(v.lan_mode || 'nat6'),
    lan_dns_mode: !!v.lan_dns_mode,
    lan_dns1: String(v.lan_dns1 ?? ''),
    lan_dns2: String(v.lan_dns2 ?? ''),
    lan_ip: String(v.lan_ip ?? ''),
  }
  await net.saveIpv6Config(cfg)
  const after = await net.getIpv6Config()
  if (!!after.enable !== cfg.enable || String(after.lan_mode) !== cfg.lan_mode) throw new Error('回读与提交不一致，固件可能拒绝了本次修改')
  ipv6Cfg.value = after
}

/* --- NAT --- */
const forwards = ref<net.PortForward[]>([])
const zones = reactive<net.FirewallZones>({ internals: [], externals: [] })
const dmzForm = reactive<net.DmzConfig>({ enabled: false, dest_ip: '', priority: true })
const dmzSaving = ref(false)
const upnpBusy = ref(false)
const wanAccess = ref<net.WanAccess | null>(null)
const pfShow = ref(false)
const pfSaving = ref(false)
const pfEditing = ref(false)
const pfForm = reactive<net.PortForward>({
  name: '',
  proto: 'tcp udp',
  src: 'wan',
  src_dport: '',
  dest: 'lan',
  dest_ip: '',
  dest_port: '',
  enabled: true,
})

async function loadNat() {
  forwards.value = await net.getPortForwards()
  const z = await net.getZones()
  zones.internals = z.internals
  zones.externals = z.externals
  if (!zones.externals.includes('wan')) zones.externals.push('wan')
  if (!zones.internals.includes('lan')) zones.internals.push('lan')
  const d = await net.getDmz()
  Object.assign(dmzForm, d)
  wanAccess.value = await softLoad(() => net.getWanAccess(), null, 'WAN 访问控制（firewall.get_wan_access）')
  return true
}

function openPf(row?: net.PortForward) {
  pfEditing.value = !!row
  if (row) {
    Object.assign(pfForm, {
      name: row.name ?? '',
      proto: row.proto || 'tcp udp',
      src: row.src || 'wan',
      src_dport: row.src_dport ?? '',
      dest: row.dest || 'lan',
      dest_ip: row.dest_ip ?? '',
      dest_port: row.dest_port ?? '',
      enabled: row.enabled !== false,
      id: row.id,
    })
  } else {
    Object.assign(pfForm, { name: '', proto: 'tcp udp', src: 'wan', src_dport: '', dest: 'lan', dest_ip: '', dest_port: '', enabled: true, id: undefined })
  }
  pfShow.value = true
}

async function submitPf() {
  if (!pfForm.src_dport || !isIp(pfForm.dest_ip)) {
    message.warning('外部端口与内部 IP 必填，且 IP 需为合法 IPv4')
    return
  }
  pfSaving.value = true
  try {
    const body: net.PortForward = {
      ...pfForm,
      dest_port: pfForm.dest_port || pfForm.src_dport,
      name: pfForm.name || `rule-${pfForm.src_dport}`,
    }
    if (pfEditing.value && body.id != null) await net.setPortForward(body)
    else await net.addPortForward(body)
    const after = await net.getPortForwards()
    const hit = after.find((x) => x.src_dport === body.src_dport && x.dest_ip === body.dest_ip)
    if (!hit) throw new Error('保存后回读不到该规则，固件可能拒绝了本次修改')
    forwards.value = after
    pfShow.value = false
    message.success(pfEditing.value ? '端口映射已更新并回读确认' : '端口映射已添加并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    pfSaving.value = false
  }
}

async function toggleForward(row: net.PortForward, enabled: boolean) {
  try {
    await net.setPortForward({ ...row, enabled })
    const after = await net.getPortForwards()
    const hit = after.find((x) => x.id === row.id)
    if (hit && hit.enabled !== enabled) throw new Error('开关回读不一致')
    forwards.value = after
    message.success(enabled ? '已启用' : '已停用')
  } catch (e) {
    message.error(net.errText(e))
    forwards.value = await net.getPortForwards().catch(() => forwards.value)
  }
}

const fwdBusy = ref<Record<string, boolean>>({})
async function removeForward(row: net.PortForward) {
  fwdBusy.value[String(row.id)] = true
  try {
    await net.delPortForward(row.id as string | number)
    const after = await net.getPortForwards()
    if (after.some((x) => x.id === row.id)) throw new Error('删除后规则仍在，设备可能拒绝了本次操作')
    forwards.value = after
    message.success('端口映射已删除并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    fwdBusy.value[String(row.id)] = false
  }
}

const fwdCols = computed<DataTableColumns<net.PortForward>>(() => [
  { title: '名称', key: 'name', render: (r) => r.name || '—' },
  { title: '协议', key: 'proto', width: 90, render: (r) => h('span', { class: 'nui-mono' }, String(r.proto || '').toUpperCase()) },
  { title: '外部端口', key: 'src_dport', width: 110, render: (r) => h('span', { class: 'nui-mono' }, r.src_dport) },
  {
    title: '内部地址',
    key: 'dest_ip',
    render: (r) => h('span', { class: 'nui-mono' }, `${r.dest_ip}:${r.dest_port || r.src_dport}`),
  },
  {
    title: '启用',
    key: 'enabled',
    width: 80,
    render: (r) => h(NSwitch, { size: 'small', value: r.enabled !== false, onUpdateValue: (v: boolean) => toggleForward(r, v) }),
  },
  {
    title: '操作',
    key: 'op',
    width: 130,
    render: (r) =>
      h('div', { class: 'nui-row' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openPf(r) }, { default: () => '编辑' }),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeForward(r) },
          {
            trigger: () =>
              h(NButton, { size: 'tiny', quaternary: true, type: 'error', loading: !!fwdBusy.value[String(r.id)] }, { default: () => '删除' }),
            default: () => `删除端口映射 ${r.src_dport} → ${r.dest_ip}？公网将无法再从该端口访问内网服务。`,
          },
        ),
      ]),
  },
])

async function saveDmz() {
  dmzSaving.value = true
  try {
    if (dmzForm.enabled && !isIp(dmzForm.dest_ip ?? '')) throw new Error('启用 DMZ 需要填一个合法主机 IP')
    await net.saveDmz({ ...dmzForm })
    const after = await net.getDmz()
    if (!!after.enabled !== !!dmzForm.enabled) throw new Error('回读不一致，固件可能拒绝了本次修改')
    Object.assign(dmzForm, after)
    message.success('DMZ 已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    dmzSaving.value = false
  }
}

async function doUpnp(enabled: boolean) {
  upnpBusy.value = true
  try {
    await net.setUpnp(enabled)
    message.success(`UPnP 已请求${enabled ? '启用' : '禁用'}（该桥无读取方法，最终状态请以官方后台为准）`)
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    upnpBusy.value = false
  }
}

/* --- 路由 --- */
const routes = ref<net.StaticRoute[]>([])
const routeIfaces = ref<string[]>([])
const routeCanToggle = ref(false)
const routeSource = ref<'glass' | 'bridge'>('glass')
const policy = ref<net.PolicyIface[]>([])
const rtShow = ref(false)
const rtSaving = ref(false)
const rtForm = reactive({ id: '', interface: 'lan', target: '', netmask: '255.255.255.0', gateway: '', metric: '' })

async function loadRoutes() {
  const r = await net.getRoutes()
  routes.value = r.routes
  routeIfaces.value = r.interfaces
  routeCanToggle.value = r.canToggle
  routeSource.value = r.source
  policy.value = await softLoad(() => net.getPolicyRouting(), [], '策略路由（kmwan.get_config/get_status）')
  return true
}

function openRoute(row?: net.StaticRoute) {
  if (row) Object.assign(rtForm, { ...row, metric: String(row.metric ?? '') })
  else Object.assign(rtForm, { id: '', interface: routeIfaces.value[0] ?? 'lan', target: '', netmask: '255.255.255.0', gateway: '', metric: '' })
  rtShow.value = true
}

async function submitRoute() {
  if (!isIp(rtForm.target)) {
    message.warning('目标网络必须是合法 IPv4')
    return
  }
  rtSaving.value = true
  try {
    await net.saveRoute({
      id: rtForm.id || undefined,
      interface: rtForm.interface,
      target: rtForm.target,
      netmask: rtForm.netmask,
      gateway: rtForm.gateway,
      metric: rtForm.metric,
      enabled: true,
    })
    const r = await net.getRoutes()
    const hit = r.routes.find((x) => x.target === rtForm.target && x.interface === rtForm.interface)
    if (!hit) throw new Error('保存后回读不到该路由，固件可能拒绝了本次修改')
    routes.value = r.routes
    rtShow.value = false
    message.success('静态路由已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    rtSaving.value = false
  }
}

async function removeRoute(row: net.StaticRoute) {
  try {
    await net.delRoute(row.id)
    const r = await net.getRoutes()
    if (r.routes.some((x) => x.id === row.id)) throw new Error('删除后路由仍在')
    routes.value = r.routes
    message.success('路由已删除并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  }
}

async function toggleRoute(row: net.StaticRoute, enabled: boolean) {
  try {
    await net.saveRoute({ ...row, enabled })
    const r = await net.getRoutes()
    routes.value = r.routes
    message.success(enabled ? '路由已启用' : '路由已停用')
  } catch (e) {
    message.error(net.errText(e))
  }
}

const routeCols = computed<DataTableColumns<net.StaticRoute>>(() => {
  const cols: DataTableColumns<net.StaticRoute> = [
    {
      title: '目标网段',
      key: 'target',
      render: (r) => h('span', { class: 'nui-mono' }, r.netmask ? `${r.target}/${r.netmask}` : r.target),
    },
    { title: '网关', key: 'gateway', render: (r) => h('span', { class: 'nui-mono' }, r.gateway || '—') },
    { title: '接口', key: 'interface', width: 100, render: (r) => h('span', { class: 'nui-mono nui-small' }, r.interface) },
    { title: '跃点', key: 'metric', width: 70, render: (r) => r.metric || '—' },
  ]
  if (routeCanToggle.value) {
    cols.push({
      title: '启用',
      key: 'enabled',
      width: 80,
      render: (r: net.StaticRoute) =>
        h(NSwitch, { size: 'small', value: r.enabled !== false, onUpdateValue: (v: boolean) => toggleRoute(r, v) }),
    })
  }
  cols.push({
    title: '操作',
    key: 'op',
    width: 130,
    render: (r: net.StaticRoute) =>
      h('div', { class: 'nui-row' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openRoute(r) }, { default: () => '编辑' }),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeRoute(r) },
          {
            trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
            default: () => `删除去往 ${r.target} 的静态路由？`,
          },
        ),
      ]),
  })
  return cols
})

/* --- IGMP --- */
const igmpFields = computed<Field[]>(() => [
  { key: 'enable', label: '启用 IGMP Snooping', type: 'switch', span: 24, hint: '开启后交换机只把组播转发给真正订阅的端口，IPTV 常需要' },
  {
    key: 'version',
    label: 'IGMP 版本',
    type: 'select',
    span: 24,
    options: [
      { label: 'v2', value: 2 },
      { label: 'v3（默认）', value: 3 },
    ],
  },
])
async function saveIgmp(v: Record<string, unknown>) {
  await net.saveIgmpConfig({ enable: !!v.enable, version: Number(v.version) || 3 })
  const after = await net.getIgmpConfig()
  if (after.enable !== !!v.enable || after.version !== (Number(v.version) || 3)) throw new Error('回读与提交不一致')
}

/* --- 高级网络 --- */
const advFlags = ref<net.SysFlags | null>(null)
const netdevs = ref<net.Netdev[]>([])
const hnatNote = ref('')
const ttlNote = ref('')
const logstorePath = ref('')
const wanchk = ref<net.WanchkState | null>(null)
const repeater = ref<any>(null)

const advFields = computed<Field[]>(() => [
  { key: 'nat_enable', label: '软件 NAT 加速（原厂「网络加速」）', type: 'switch', span: 24 },
  { key: 'sip_enable', label: 'SIP ALG（VoIP 穿透）', type: 'switch', span: 24 },
])
const netnatFields = computed<Field[]>(() => [
  { key: 'enable', label: '启用网络加速', type: 'switch', span: 24 },
  {
    key: 'actype',
    label: '加速类型',
    type: 'select',
    span: 24,
    options: [
      { label: '自动', value: 0 },
      { label: '硬件加速（HW NAT）', value: 1 },
      { label: '软件加速', value: 2 },
    ],
    hint: advFlags.value?.netnat_enabled === false ? '当前未启用' : '',
  },
  { key: 'wifi_reload', label: '应用后重载 Wi-Fi', type: 'switch', span: 24 },
])
const ttlFields: Field[] = [
  { key: 'ipv4', label: 'IPv4 TTL（1–255，留空/0 = 系统默认 64）', type: 'number', min: 0, max: 255, span: 12 },
  { key: 'ipv6', label: 'IPv6 跳数限制（本机不支持时可忽略）', type: 'number', min: 0, max: 255, span: 12 },
]
const ttlLoad = async () => {
  const t = await net.getTtl()
  ttlNote.value = t.ipv6_supported ? `当前内核 ip_default_ttl = ${t.current}` : `本机仅支持 IPv4（当前生效 ${t.current}，IPv6 跳数限制不可设）`
  return { ipv4: Number(t.ipv4 || t.current || 0), ipv6: Number(t.ipv6 || 0) } as Record<string, unknown>
}

async function loadAdv() {
  advFlags.value = await softLoad(() => net.getSystemFlags(), null, '全局功能开关（system.get_status）')
  const d = await softLoad(() => net.getNetdevs(), null, '网卡信息（插件桥 sys.details）')
  netdevs.value = d?.netdevs ?? []
  const h = await softLoad(() => net.getHnat(), null, 'HW NAT（插件桥 adv.hnat_get）')
  hnatNote.value = h ? (h.available ? '' : '本机没有 mtkhnat 配置，不支持硬件 NAT 开关') : ''
  const t = await softLoad(() => net.getTtl(), null, 'TTL（插件桥 adv.ttl_get）')
  ttlNote.value = t ? (t.ipv6_supported ? `当前内核 ip_default_ttl = ${t.current}` : `本机仅支持 IPv4 TTL（当前 ${t.current}）`) : ''
  const l = await softLoad(() => net.getLogstore(), null, '日志存储（插件桥 adv.logstore_get）')
  logstorePath.value = l?.path || ''
  wanchk.value = await softLoad(() => net.getWanchk(), null, 'WAN 健康检查（glass.wanchk_get）')
  repeater.value = await softLoad(() => net.getRepeaterStatus(), null, '中继状态（repeater.get_status）')
  return true
}

async function saveAdv(v: Record<string, unknown>) {
  await net.saveAdvanceConfig({ nat_enable: v.nat_enable ? 1 : 0, sip_enable: v.sip_enable ? 1 : 0 })
  const after = await net.getAdvanceConfig()
  if ((after.nat_enable ? 1 : 0) !== (v.nat_enable ? 1 : 0)) throw new Error('回读与提交不一致')
}
async function saveNetnat(v: Record<string, unknown>) {
  await net.saveNetnatConfig({ enable: !!v.enable, actype: Number(v.actype ?? 0), wifi_reload: !!v.wifi_reload })
  const after = await net.getNetnatConfig()
  if (!!after.enable !== !!v.enable || Number(after.actype) !== Number(v.actype ?? 0)) throw new Error('回读与提交不一致，固件可能拒绝了本次修改')
}
async function saveHnat(v: Record<string, unknown>) {
  const r = await net.setHnat(!!v.enable)
  if (!r || !!r.enable !== !!v.enable) throw new Error('回读与提交不一致')
  hnatNote.value = r.available ? '' : '本机不支持'
}
async function saveTtl(v: Record<string, unknown>) {
  const v4 = Number(v.ipv4) > 0 ? String(Number(v.ipv4)) : ''
  const v6 = Number(v.ipv6) > 0 ? String(Number(v.ipv6)) : ''
  const r = await net.setTtl({ ipv4: v4, ipv6: v6 })
  if (String(r?.ipv4 ?? '') !== v4) throw new Error('回读与提交不一致')
  ttlNote.value = `当前内核 ip_default_ttl = ${r?.current ?? '—'}`
}
async function saveLogstore(v: Record<string, unknown>) {
  const r = await net.setLogstore(!!v.sync)
  if (!r || !!r.sync !== !!v.sync) throw new Error('回读与提交不一致')
}

/* ================= 装载调度 ================= */
const { loading, error, reload } = useAsync(
  async () => {
    soft.value = ''
    const s = section.value
    if (s === 'lan') return loadLan()
    if (s === 'dhcp') return loadDhcp()
    if (s === 'dns') return Promise.all([loadDns(), loadHosts(), loadSysHosts()]).then(() => true)
    if (s === 'ipv6') return loadIpv6()
    if (s === 'nat') return loadNat()
    if (s === 'routes') return loadRoutes()
    if (s === 'igmp') return true
    if (s === 'adv') return loadAdv()
    return true
  },
  { watchSource: section },
)

const natConflict = computed(() => {
  const f = advFlags.value
  if (!f) return ''
  const busy = [
    f.qos_enabled ? 'QoS' : '',
    f.sqm_enabled ? 'SQM' : '',
    f.flow_statistics_enabled ? '流量统计' : '',
    f.content_protection_enabled ? '内容保护' : '',
  ].filter(Boolean)
  if (busy.length && !f.netnat_enabled) return ''
  if (busy.length) return `网络加速与 ${busy.join('、')} 互斥：官方后台在开启这些功能时会自动关闭网络加速（反之亦然）。`
  return ''
})
</script>

<template>
  <div class="nui-page">
    <n-alert v-if="soft" type="warning" :bordered="false" closable @close="soft = ''">
      {{ soft }}
    </n-alert>

    <PageState :loading="loading" :error="error" @retry="reload">
      <!-- ==================== LAN ==================== -->
      <div v-if="section === 'lan'" class="nui-grid">
        <PanelCard class="span-7" title="局域网与 DHCP">
          <template #icon><n-icon><ServerOutline /></n-icon></template>
          <n-form label-placement="top" :show-feedback="false">
            <n-grid :cols="24" responsive="screen" item-responsive :x-gap="14" :y-gap="12">
              <n-form-item-gi :span="'24 m:14'" label="路由器地址（LAN IP）">
                <n-input v-model:value="lanForm.ip" placeholder="192.168.8.1" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:10'" label="子网掩码">
                <n-input v-model:value="lanForm.netmask" placeholder="255.255.255.0" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:6'" label="DHCP 服务">
                <n-switch v-model:value="lanForm.dhcp" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:9'" label="地址池起始">
                <n-input v-model:value="lanForm.start" :disabled="!lanForm.dhcp" placeholder="192.168.8.100" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:9'" label="地址池结束">
                <n-input v-model:value="lanForm.end" :disabled="!lanForm.dhcp" placeholder="192.168.8.249" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="租期（分钟）">
                <n-input-number v-model:value="lanForm.leasetimeMin" :min="2" :max="100000" style="width: 100%" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:16'" label="下发的网关（留空 = 路由器本身）">
                <n-input v-model:value="lanForm.gateway" placeholder="留空即可" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:12'" label="下发的 DNS 1">
                <n-input v-model:value="lanForm.dns1" placeholder="留空 = 用路由器 DNS" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:12'" label="下发的 DNS 2">
                <n-input v-model:value="lanForm.dns2" placeholder="可选" />
              </n-form-item-gi>
              <n-form-item-gi :span="24" label="AP 隔离（客户端之间不能互访）">
                <n-switch v-model:value="lanForm.apIsolate" />
              </n-form-item-gi>
            </n-grid>
          </n-form>

          <n-alert v-if="lanWarns.length" type="warning" :bordered="false" style="margin-top: 12px">
            <div v-for="(w, i) in lanWarns" :key="i">· {{ w }}</div>
          </n-alert>
          <n-alert v-else type="info" :bordered="false" style="margin-top: 12px">
            校验通过。修改 LAN IP 后本页会立刻断开，需要用新地址重新打开后台（官方界面也是这个行为）。
          </n-alert>

          <div class="nui-row" style="margin-top: 14px">
            <n-button type="primary" :loading="lanSaving" :disabled="lanWarns.length > 0" @click="saveLan">
              保存并应用
            </n-button>
            <n-button secondary @click="loadLan()">重新读取</n-button>
            <span class="nui-small nui-muted">写接口：<code>lan.set_config</code>（地址段 + DHCP 段两次提交）</span>
          </div>
        </PanelCard>

        <PanelCard class="span-5" title="三个内网接口">
          <template #icon><n-icon><LayersOutline /></n-icon></template>
          <div v-for="i in lanIfaces" :key="i.interface" class="nui-item" style="margin-bottom: 10px">
            <div class="nui-between">
              <span class="nui-mono">{{ i.interface }}</span>
              <n-tag size="small" :bordered="false" :type="Number(i.enable) ? 'success' : 'default'">
                {{ Number(i.enable) ? 'DHCP 开' : 'DHCP 关' }}
              </n-tag>
            </div>
            <div class="nui-small nui-mono nui-muted" style="margin-top: 6px">
              {{ i.ip }}/{{ i.netmask }}
            </div>
            <div class="nui-small nui-muted" style="margin-top: 2px">
              池 {{ i.start }} – {{ i.end }} · 租期 {{ i.leasetime }}
            </div>
          </div>
          <p class="nui-small nui-muted" style="margin: 6px 0 0">
            访客 / IoT 网段的独立配置在官方「访客网络 / IoT 网络」页，这里只读展示，避免误改。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== DHCP 静态绑定 ==================== -->
      <div v-if="section === 'dhcp'" class="nui-grid">
        <PanelCard class="span-7" title="静态地址绑定">
          <template #icon><n-icon><SaveOutline /></n-icon></template>
          <div class="row3">
            <n-input v-model:value="bindForm.mac" size="small" placeholder="MAC  AA:BB:CC:DD:EE:FF" />
            <n-input v-model:value="bindForm.ip" size="small" placeholder="IP  192.168.8.50" />
            <n-input v-model:value="bindForm.name" size="small" placeholder="名称（可选）" />
          </div>
          <div class="nui-row" style="margin: 10px 0 12px">
            <n-button size="small" type="primary" :loading="bindSaving" @click="submitBind">
              {{ editingMac ? '保存修改' : '添加绑定' }}
            </n-button>
            <n-button v-if="editingMac" size="small" secondary @click="resetBindForm()">取消编辑</n-button>
            <n-popconfirm v-if="binds.length" @positive-click="clearAllBinds">
              <template #trigger><n-button size="small" quaternary type="error">清空全部</n-button></template>
              清空全部静态绑定？所有终端将回到动态分配。
            </n-popconfirm>
          </div>
          <n-data-table
            :columns="bindCols"
            :data="binds"
            size="small"
            :bordered="false"
            :scroll-x="560"
            :row-key="(r: net.StaticBind) => r.mac"
          >
            <template #empty>
              <n-empty description="还没有静态绑定（lan.get_static_bind_list 返回空）" size="small" />
            </template>
          </n-data-table>
        </PanelCard>

        <PanelCard class="span-5" title="当前租约">
          <template #icon><n-icon><WifiOutline /></n-icon></template>
          <template #extra>
            <a class="act" @click="loadDhcp()">刷新</a>
          </template>
          <div v-if="dhcpState" class="nui-small nui-muted" style="margin-bottom: 8px">
            dnsmasq 实际生效：起始偏移 {{ dhcpState.start }} · 数量 {{ dhcpState.limit }} · 租期
            {{ dhcpState.leasetime }} 分钟 · {{ dhcpState.enabled ? 'DHCP 已开' : 'DHCP 已关' }}
          </div>
          <n-data-table
            :columns="leaseCols"
            :data="leases"
            size="small"
            :bordered="false"
            :scroll-x="480"
            :row-key="(r: net.DhcpLease) => r.mac"
            max-height="360"
          >
            <template #empty>
              <n-empty description="没有读到 DHCP 租约（/tmp/dhcp.leases 为空，或当前没有终端通过 DHCP 拿到地址）" size="small" />
            </template>
          </n-data-table>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            租约来自插件桥 <code>net.dhcp_leases</code>（与官方 dhcplease_status 同源），点「绑定」把该终端一键写进静态绑定。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== DNS ==================== -->
      <div v-if="section === 'dns'" class="nui-grid">
        <PanelCard class="span-7" title="上游 DNS">
          <template #icon><n-icon><GlobeOutline /></n-icon></template>
          <n-form label-placement="top" :show-feedback="false">
            <n-grid :cols="24" responsive="screen" item-responsive :x-gap="14" :y-gap="12">
              <n-form-item-gi :span="24" label="DNS 模式">
                <n-select
                  v-model:value="dnsMode"
                  :options="[
                    { label: '自动（跟随 WAN 下发的 DNS）', value: 'auto' },
                    { label: '手动（自定义 IPv4/IPv6 DNS）', value: 'manual' },
                    { label: '加密 DNS（DoT / DoH / DoQ）', value: 'secure' },
                    { label: 'DNS 代理（把查询转发到代理地址）', value: 'proxy' },
                  ]"
                  @update:value="dnsMode === 'secure' && ensureProviders()"
                />
              </n-form-item-gi>

              <n-form-item-gi v-if="dnsMode === 'manual'" :span="24" label="手动 DNS（一行一个）">
                <n-input v-model:value="manualText" type="textarea" :rows="3" placeholder="223.5.5.5&#10;2400:3200::1" />
              </n-form-item-gi>

              <n-form-item-gi v-if="dnsMode === 'proxy'" :span="24" label="代理地址（ip#port，可多行）">
                <n-input v-model:value="proxyText" type="textarea" :rows="3" placeholder="8.8.8.8#53" />
              </n-form-item-gi>

              <template v-if="dnsMode === 'secure'">
                <n-form-item-gi :span="'24 m:12'" label="服务商">
                  <n-select v-model:value="secureForm.provider" :options="providerOptions" filterable placeholder="读取 dns.get_info…" />
                </n-form-item-gi>
                <n-form-item-gi :span="'24 m:12'" label="协议">
                  <n-select v-model:value="secureForm.proto" :options="protoOptions" />
                </n-form-item-gi>
                <n-form-item-gi v-if="secureForm.provider === 'controld'" :span="24" label="配置档（Control D 免费档）">
                  <n-select v-model:value="secureForm.server" :options="serverOptions" filterable placeholder="p0 = Unfiltered" />
                </n-form-item-gi>
                <n-form-item-gi v-else-if="secureForm.provider === 'nextdns'" :span="24" label="NextDNS 配置 ID">
                  <n-input v-model:value="secureForm.nextdnsId" placeholder="形如 abcdef" />
                </n-form-item-gi>
                <n-form-item-gi v-else-if="secureForm.provider === 'manual'" :span="24" label="手动加密服务器（一行一个）">
                  <n-input v-model:value="secureForm.manualText" type="textarea" :rows="3" placeholder="tls://dns.example.com" />
                </n-form-item-gi>
                <n-form-item-gi v-else :span="24" label="服务器">
                  <n-select v-model:value="secureForm.server" :options="serverOptions" filterable />
                </n-form-item-gi>
              </template>

              <n-form-item-gi :span="'24 m:8'" label="强制所有 DNS 走此处">
                <n-switch v-model:value="dnsFlags.force_dns" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="防 DNS 重绑定保护">
                <n-switch v-model:value="dnsFlags.rebind_protection" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="VPN 时仍用此 DNS">
                <n-switch v-model:value="dnsFlags.override_vpn" />
              </n-form-item-gi>
            </n-grid>
          </n-form>

          <div class="nui-row" style="margin-top: 14px">
            <n-button type="primary" :loading="dnsSaving" @click="saveDnsBasic">保存模式与开关</n-button>
            <n-button v-if="dnsMode === 'secure'" secondary :loading="dnsSaving" @click="saveDnsSecure">保存加密设置</n-button>
          </div>

          <div class="nui-sec" style="margin-top: 18px">当前自动获取的 DNS</div>
          <div v-if="(dnsCfg.server_auto ?? []).length" class="nui-col nui-gap-4">
            <span v-for="s in dnsCfg.server_auto" :key="s" class="nui-mono nui-small">{{ s }}</span>
          </div>
          <p v-else class="nui-small nui-muted" style="margin: 0">WAN 没有下发 DNS（或 DNS 模式不是自动）。</p>
        </PanelCard>

        <PanelCard class="span-5" title="自定义 Hosts（路由器本机解析）">
          <template #icon><n-icon><ServerOutline /></n-icon></template>
          <PageState compact>
            <div v-if="hostsState && !hostsState.active" class="nui-small nui-muted" style="margin-bottom: 8px">
              插件桥还没给 dnsmasq 挂上额外 hosts 文件；保存第一条后会自动挂载（会重启一次 dnsmasq）。
            </div>
            <div v-for="(h, i) in hosts" :key="i" class="host-row">
              <n-input v-model:value="h.ip" size="tiny" placeholder="IP" style="width: 42%" />
              <n-input v-model:value="h.names" size="tiny" placeholder="域名（空格分隔）" style="flex: 1" />
              <n-switch v-model:value="h.enabled" size="small" />
              <n-button size="tiny" quaternary type="error" @click="hosts.splice(i, 1)">×</n-button>
            </div>
            <div class="nui-row" style="margin-top: 10px">
              <n-button size="small" secondary @click="addHostRow">添加条目</n-button>
              <n-button size="small" type="primary" :loading="hostsSaving" @click="saveHosts">保存全部</n-button>
            </div>
          </PageState>
          <div class="nui-row" style="margin-top: 12px">
            <n-input v-model:value="hostTestName" size="small" placeholder="测试域名" style="flex: 1" />
            <n-button size="small" secondary @click="runHostTest">解析测试</n-button>
          </div>
          <div v-if="hostTestResult" class="nui-small nui-mono" style="margin-top: 8px; opacity: 0.75">{{ hostTestResult }}</div>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            条目写到 <code>/etc/nui/hosts.json</code> 并生成 dnsmasq 的 addnhosts，保存后 SIGHUP 重载，不会重启网络。
          </p>
        </PanelCard>

        <PanelCard class="span-12" title="系统 hosts 文件（高级）">
          <template #icon><n-icon><LayersOutline /></n-icon></template>
          <n-input v-model:value="sysHosts" type="textarea" :rows="6" class="nui-mono" placeholder="/etc/hosts 内容" />
          <div class="nui-row" style="margin-top: 10px">
            <n-button size="small" type="primary" :loading="sysHostsSaving" @click="saveSysHosts">保存 /etc/hosts</n-button>
            <span class="nui-small nui-muted">
              写接口 <code>dns.set_host</code>（官方 DNS 页的同一份数据）。改错会导致域名解析异常，优先用上面的条目化 Hosts。
            </span>
          </div>
        </PanelCard>
      </div>

      <!-- ==================== IPv6 ==================== -->
      <div v-if="section === 'ipv6'" class="nui-grid">
        <PanelCard class="span-7" title="IPv6 设置">
          <template #icon><n-icon><GlobeOutline /></n-icon></template>
          <SettingsForm :fields="ipv6Fields" :load="async () => (await net.getIpv6Config()) as any" :save="saveIpv6" />
        </PanelCard>
        <PanelCard class="span-5" title="当前状态">
          <dl class="nui-kv">
            <dt>全局开关</dt>
            <dd>{{ advFlags?.ipv6_enabled ? '已启用' : '未启用' }}</dd>
            <dt>模式</dt>
            <dd>{{ ipv6Cfg?.lan_mode || '—' }}</dd>
            <dt>LAN IPv6</dt>
            <dd class="nui-mono">{{ ipv6LanAddr || '—' }}</dd>
          </dl>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            这里写的是官方 <code>ipv6.set_ipv6</code>（同一份数据）。WAN 侧 IPv6（DHCPv6/PPPoE、二级前缀）在官方「互联网」页。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== NAT ==================== -->
      <div v-if="section === 'nat'" class="nui-grid">
        <PanelCard class="span-8" title="端口映射 / 端口转发">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" type="primary" secondary @click="openPf()">新增规则</n-button>
          </template>
          <n-data-table
            :columns="fwdCols"
            :data="forwards"
            size="small"
            :bordered="false"
            :scroll-x="680"
            :row-key="(r: net.PortForward) => String(r.id ?? r.name)"
          >
            <template #empty>
              <n-empty description="还没有端口映射（firewall.get_port_forward_list 返回空）" size="small" />
            </template>
          </n-data-table>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            写接口：<code>firewall.add/set/remove_port_forward</code>。外部端口支持 <code>80</code> 或 <code>8000-8010</code>，
            两端端口范围长度必须一致（官方前端的校验也是这条）。
          </p>
        </PanelCard>

        <PanelCard class="span-4" title="DMZ 主机">
          <template #icon><n-icon><ServerOutline /></n-icon></template>
          <div class="nui-between">
            <span class="nui-small">启用 DMZ</span>
            <n-switch v-model:value="dmzForm.enabled" />
          </div>
          <n-input v-model:value="dmzForm.dest_ip" size="small" placeholder="DMZ 主机 IP" style="margin: 10px 0" :disabled="!dmzForm.enabled" />
          <div class="nui-between" style="margin-bottom: 10px">
            <span class="nui-small">DMZ 优先于端口映射</span>
            <n-switch v-model:value="dmzForm.priority" size="small" :disabled="!dmzForm.enabled" />
          </div>
          <n-button size="small" type="primary" secondary :loading="dmzSaving" @click="saveDmz">保存 DMZ</n-button>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            写接口 <code>firewall.set_dmz</code>（<code>{enabled,dest_ip,priority}</code>）。DMZ 会把所有未映射端口转发到该主机，等于完全暴露在公网。
          </p>

          <div class="nui-sec" style="margin-top: 18px">WAN 访问控制</div>
          <dl v-if="wanAccess" class="nui-kv">
            <dt>WAN Ping</dt>
            <dd>{{ wanAccess.enable_ping ? '放行' : '拦截' }}</dd>
            <dt>WAN SSH</dt>
            <dd>{{ wanAccess.enable_ssh ? '放行' : '拦截' }}</dd>
            <dt>WAN HTTPS</dt>
            <dd>{{ wanAccess.enable_https ? '放行' : '拦截' }}</dd>
          </dl>
          <n-button size="tiny" secondary style="margin-top: 8px" @click="router.push('/security/remote')">去「远程访问管理」设置</n-button>
        </PanelCard>

        <PanelCard class="span-12" title="UPnP">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
          <div class="nui-row nui-wrap">
            <n-button size="small" type="primary" secondary :loading="upnpBusy" @click="doUpnp(true)">启用 UPnP</n-button>
            <n-popconfirm @positive-click="doUpnp(false)">
              <template #trigger><n-button size="small" quaternary type="error">停用 UPnP</n-button></template>
              停用 UPnP 会让依赖自动打洞的应用（BT / 游戏联机 / 部分监控）失去外网可达性。
            </n-popconfirm>
            <span class="nui-small nui-muted">
              写接口 <code>adv.upnp_set</code>（插件桥，改 uci <code>upnpd.config.enabled</code> 并重启 miniupnpd）；
              当前桥只有写入方法、没有读取方法，所以开关状态以官方后台为准 —— 这是明确的降级项。
            </span>
          </div>
        </PanelCard>
      </div>

      <!-- ==================== 静态路由 ==================== -->
      <div v-if="section === 'routes'" class="nui-grid">
        <PanelCard class="span-8" title="静态路由">
          <template #icon><n-icon><GitNetworkOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-tag size="tiny" :bordered="false" type="info">{{ routeSource === 'glass' ? 'glass.route_*' : '桥 net.route_*' }}</n-tag>
              <n-button size="tiny" type="primary" secondary @click="openRoute()">新增路由</n-button>
            </div>
          </template>
          <n-data-table
            :columns="routeCols"
            :data="routes"
            size="small"
            :bordered="false"
            :scroll-x="700"
            :row-key="(r: net.StaticRoute) => r.id"
          >
            <template #empty>
              <n-empty description="还没有静态路由（uci network.@route 为空）" size="small" />
            </template>
          </n-data-table>
          <p v-if="!routeCanToggle" class="nui-small nui-muted" style="margin: 10px 0 0">
            当前只有插件桥可用，桥不支持路由启停（uci disabled 字段）；要启停请部署带 <code>glass.route_*</code> 的后端。
          </p>
        </PanelCard>

        <PanelCard class="span-4" title="策略路由（kmwan，只读）">
          <template #icon><n-icon><LayersOutline /></n-icon></template>
          <div v-for="p in policy" :key="p.interface" class="nui-item" style="margin-bottom: 10px">
            <div class="nui-between">
              <span class="nui-mono">{{ p.interface }}</span>
              <n-tag size="tiny" :bordered="false" :type="p.status_v4 ? 'success' : 'default'">
                {{ p.status_v4 ? '链路通' : '不可用' }}
              </n-tag>
            </div>
            <div class="nui-small nui-muted" style="margin-top: 4px">
              跃点 {{ p.metric }} · 权重 {{ p.weight }} · {{ p.enable_check ? '跟踪开启' : '跟踪关闭' }}
            </div>
          </div>
          <n-empty v-if="!policy.length" description="没有读到 kmwan 策略路由配置" size="small" />
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            GL 的「策略路由」就是 kmwan 各上行的优先级 + 链路跟踪；改优先级请到官方「多线负载」页，这里按你的分工只读展示。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== IGMP ==================== -->
      <div v-if="section === 'igmp'" class="nui-grid">
        <PanelCard class="span-7" title="IGMP Snooping">
          <template #icon><n-icon><LayersOutline /></n-icon></template>
          <SettingsForm
            :fields="igmpFields"
            :load="async () => (await net.getIgmpConfig()) as any"
            :save="saveIgmp"
          />
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            写接口 <code>igmp.set_config</code>（<code>{enable,version}</code>，与 get_config 同构）。
          </p>
        </PanelCard>
        <PanelCard class="span-5" title="说明">
          <p class="nui-small nui-muted" style="margin: 0; line-height: 1.9">
            IGMP Snooping 让交换机只把组播流量转发给真正订阅的端口，避免 IPTV / 组播把全屋端口打满。
            只有接 IPTV 组播或做组播源时才需要开；普通上网开着也无副作用，但和「组播转单播」类插件不要重复配。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== 高级网络 ==================== -->
      <div v-if="section === 'adv'" class="nui-grid">
        <PanelCard class="span-6" title="NAT 加速 / SIP ALG">
          <SettingsForm
            :fields="advFields"
            :load="async () => (await net.getAdvanceConfig()) as any"
            :save="saveAdv"
          />
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            <code>network.get/set_advance_config</code>：<code>nat_enable</code>（软件 NAT 加速）、<code>sip_enable</code>（SIP ALG，VoIP 穿透）。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="网络加速（netnat）">
          <SettingsForm
            :fields="netnatFields"
            :load="async () => (await net.getNetnatConfig()) as any"
            :save="saveNetnat"
          />
          <n-alert v-if="natConflict" type="warning" :bordered="false" style="margin-top: 10px">{{ natConflict }}</n-alert>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            <code>network.get/set_netnat_config</code>；actype 受硬件限制（后端 get 返回的可选值见「硬件 NAT」卡片）。
            开 QoS / SQM / 流量统计 / 内容保护 时官方会自动关掉网络加速。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="硬件 NAT（mtkhnat）">
          <SettingsForm
            :fields="[{ key: 'enable', label: '启用硬件加速（性能模式）', type: 'switch', span: 24, hint: hnatNote }]"
            :load="async () => (await net.getHnat()) as any"
            :save="saveHnat"
          />
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            插件桥 <code>adv.hnat_get/set</code>（uci <code>mtkhnat.global.enable</code>，1 = 性能模式 / 0 = 流畅模式）。硬件加速会绕过部分 QoS/DPI 处理。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="TTL（运营商识别）">
          <SettingsForm
            :fields="ttlFields"
            :load="ttlLoad"
            :save="saveTtl"
          />
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            插件桥 <code>adv.ttl_get/set</code>：写入 <code>/etc/config/ttl</code> 并立即 <code>sysctl -w net.ipv4.ip_default_ttl</code>，不断网重拨。
            留空 / 0 = 恢复系统默认 64。<span v-if="ttlNote">（{{ ttlNote }}）</span>
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="日志本地存储">
          <SettingsForm
            :fields="[{ key: 'sync', label: '把系统日志保存到本地存储', type: 'switch', span: 24 }]"
            :load="async () => (await net.getLogstore()) as any"
            :save="saveLogstore"
          />
          <div v-if="logstorePath" class="nui-small nui-muted" style="margin-top: 8px">路径：<span class="nui-mono">{{ logstorePath }}</span></div>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            插件桥 <code>adv.logstore_get/set</code>（uci <code>logservice.root.sync</code>）。本机若无 logservice 段会返回 available=false。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="接口 MTU（只读）">
          <div v-for="d in netdevs.filter((x) => x.name === 'br-lan' || x.name === 'eth0' || x.name === 'eth1' || x.name === 'apclii0')" :key="d.name" class="nui-between nui-list-row">
            <span class="nui-mono nui-small">{{ d.name }}</span>
            <span class="nui-mono nui-small nui-muted">MTU {{ d.mtu }}</span>
            <n-tag size="tiny" :bordered="false" :type="d.up ? 'success' : 'default'">{{ d.up ? 'UP' : 'DOWN' }}</n-tag>
          </div>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            MTU 来自插件桥 <code>sys.details</code> 读 <code>/proc/net/dev</code>；GL 4.9 没有 MTU 的 RPC 写接口，所以这里只读展示。
          </p>
        </PanelCard>

        <PanelCard class="span-12" title="WAN 健康检查 / 中继（AP-Client）">
          <template #icon><n-icon><ServerOutline /></n-icon></template>
          <div class="nui-grid">
            <div class="span-6">
              <div class="nui-sec">wanchk</div>
              <PageState
                :empty="!wanchk || !wanchk.profiles.length"
                empty-text="本机 /etc/config/wanchk 没有配置任何 profile（GL 4.9 的链路检测走 kmwan，见「静态路由 → 策略路由」）"
                compact
              >
                <div v-for="p in wanchk?.profiles ?? []" :key="p.name" class="nui-item" style="margin-bottom: 8px">
                  <div class="nui-between">
                    <span class="nui-mono">{{ p.name }}</span>
                    <n-tag size="tiny" :bordered="false" type="info">{{ p.interface || 'wan' }}</n-tag>
                  </div>
                  <div class="nui-small nui-muted" style="margin-top: 4px">
                    DNS 检测 {{ p.dnsopen ? '开' : '关' }} · ICMP 检测 {{ p.pingopen ? '开' : '关' }}
                  </div>
                </div>
              </PageState>
              <p class="nui-small nui-muted" style="margin: 8px 0 0">
                读 <code>glass.wanchk_get</code>；插件桥的 <code>adv.wanchk_get</code> 依赖 厂商专有模块 <code>luci.nradio</code>，在 GL 固件上不可用。
              </p>
            </div>
            <div class="span-6">
              <div class="nui-sec">中继</div>
              <dl v-if="repeater" class="nui-kv">
                <dt>状态</dt>
                <dd>{{ repeater.running ? '已连接' : '未连接' }}</dd>
                <dt>SSID</dt>
                <dd class="nui-mono">{{ repeater.wpa_status?.ssid || '—' }}</dd>
                <dt>BSSID</dt>
                <dd class="nui-mono">{{ repeater.bssid || '—' }}</dd>
                <dt>频段</dt>
                <dd class="nui-mono">{{ repeater.wpa_status?.freq ? repeater.wpa_status.freq + ' MHz' : '—' }}</dd>
                <dt>密钥协商</dt>
                <dd class="nui-mono">{{ repeater.wpa_status?.key_mgmt || '—' }} / {{ repeater.wpa_status?.wpa_state || '—' }}</dd>
              </dl>
              <p class="nui-small nui-muted" style="margin: 8px 0 0">
                读 <code>repeater.get_status</code>。插件桥 <code>adv.apcli_get/set</code>（改 apcli 无线配置）同样依赖 <code>luci.nradio</code>，
                在本机不可用 → 中继的 SSID/密码请到官方「中继」页修改。
              </p>
            </div>
          </div>
        </PanelCard>
      </div>
    </PageState>

    <!-- 端口映射弹窗 -->
    <n-modal v-model:show="pfShow" preset="card" style="width: 620px; max-width: 94vw" :title="pfEditing ? '编辑端口映射' : '新增端口映射'">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="24" responsive="screen" item-responsive :x-gap="12" :y-gap="10">
          <n-form-item-gi :span="24" label="名称">
            <n-input v-model:value="pfForm.name" placeholder="例如 NAS Web" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="协议">
            <n-select
              v-model:value="pfForm.proto"
              :options="[
                { label: 'TCP/UDP', value: 'tcp udp' },
                { label: 'TCP', value: 'tcp' },
                { label: 'UDP', value: 'udp' },
              ]"
            />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="外部端口">
            <n-input v-model:value="pfForm.src_dport" placeholder="80 或 8000-8010" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="源区域">
            <n-select v-model:value="pfForm.src" :options="zones.externals.map((x) => ({ label: x, value: x }))" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="目的区域">
            <n-select v-model:value="pfForm.dest" :options="zones.internals.map((x) => ({ label: x, value: x }))" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="内部 IP">
            <n-input v-model:value="pfForm.dest_ip" placeholder="192.168.8.50" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="内部端口（留空 = 外部端口）">
            <n-input v-model:value="pfForm.dest_port" placeholder="80" />
          </n-form-item-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button @click="pfShow = false">取消</n-button>
          <n-button type="primary" :loading="pfSaving" @click="submitPf">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 静态路由弹窗 -->
    <n-modal v-model:show="rtShow" preset="card" style="width: 560px; max-width: 94vw" :title="rtForm.id ? '编辑静态路由' : '新增静态路由'">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="24" responsive="screen" item-responsive :x-gap="12" :y-gap="10">
          <n-form-item-gi :span="24" label="接口">
            <n-select v-model:value="rtForm.interface" :options="routeIfaces.map((x) => ({ label: x, value: x }))" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="目标网络">
            <n-input v-model:value="rtForm.target" placeholder="10.0.0.0" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="子网掩码">
            <n-input v-model:value="rtForm.netmask" placeholder="255.255.255.0" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="网关（可空）">
            <n-input v-model:value="rtForm.gateway" placeholder="192.168.8.2" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="跃点（可空）">
            <n-input v-model:value="rtForm.metric" placeholder="0" />
          </n-form-item-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button @click="rtShow = false">取消</n-button>
          <n-button type="primary" :loading="rtSaving" @click="submitRoute">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.row3 {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 8px;
}
.host-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.host-row + .host-row {
  border-top: 1px dashed var(--line-dash);
}
.act {
  cursor: pointer;
  font-size: 12px;
  opacity: 0.6;
}
.act:hover {
  opacity: 1;
}
code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11.5px;
  opacity: 0.8;
}
@media (max-width: 768px) {
  .row3 {
    grid-template-columns: 1fr;
  }
}
</style>
