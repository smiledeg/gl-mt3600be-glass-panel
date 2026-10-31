<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NFormItemGi,
  NGrid,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  AppsOutline,
  BanOutline,
  LockClosedOutline,
  ShieldOutline,
  TimeOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import SettingsForm, { type Field } from '@/components/SettingsForm.vue'
import { useAsync } from '@/composables/useAsync'
import * as net from '@/api/net'

const props = defineProps<{ section?: string }>()
const section = computed(() => String(props.section || 'firewall'))
const message = useMessage()
const router = useRouter()

/* ---------------- 公共 ---------------- */
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

const CATEGORY_LABEL: Record<string, string> = {
  gambling: '赌博',
  adult: '成人内容',
  malware: '恶意软件',
  game: '游戏',
  social_entertainment: '社交娱乐',
  shopping: '购物',
  malicious_content: '恶意内容',
  sexual_content: '色情内容',
  education: '教育',
  work: '办公',
  meeting: '会议',
  webpage: '网页浏览',
  other: '其它',
  advertisement: '广告',
  dangerous_website: '危险网站',
}
const catLabel = (k: string) => CATEGORY_LABEL[k] ?? k

/* ================= 防火墙 ================= */
const fwRules = ref<net.FirewallRule[]>([])
const zones = reactive<net.FirewallZones>({ internals: [], externals: [] })
const dmzState = ref<net.DmzConfig | null>(null)
const wanAccess = ref<net.WanAccess | null>(null)
const ruleShow = ref(false)
const ruleSaving = ref(false)
const ruleEditing = ref(false)
const ruleForm = reactive<net.FirewallRule>({ name: '', src: 'wan', proto: 'tcp udp', dest_port: '', target: 'ACCEPT', enabled: true })

async function loadFirewall() {
  fwRules.value = await net.getFirewallRules()
  const z = await net.getZones()
  zones.internals = z.internals
  zones.externals = z.externals
  dmzState.value = await softLoad(() => net.getDmz(), null, 'DMZ（firewall.get_dmz）')
  wanAccess.value = await softLoad(() => net.getWanAccess(), null, 'WAN 访问控制（firewall.get_wan_access）')
  return true
}

function openRule(row?: net.FirewallRule) {
  ruleEditing.value = !!row
  if (row) Object.assign(ruleForm, { ...row })
  else Object.assign(ruleForm, { name: '', src: 'wan', proto: 'tcp udp', dest_port: '', target: 'ACCEPT', enabled: true, id: undefined })
  ruleShow.value = true
}

async function submitRule() {
  if (!ruleForm.name.trim()) {
    message.warning('规则名必填')
    return
  }
  ruleSaving.value = true
  try {
    const body: net.FirewallRule = { ...ruleForm, name: ruleForm.name.trim() }
    if (ruleEditing.value && body.id != null) await net.setFirewallRule(body)
    else await net.addFirewallRule(body)
    const after = await net.getFirewallRules()
    if (!after.some((r) => r.name === body.name)) throw new Error('保存后回读不到该规则，固件可能拒绝了本次修改')
    fwRules.value = after
    ruleShow.value = false
    message.success(ruleEditing.value ? '规则已更新并回读确认' : '规则已添加并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    ruleSaving.value = false
  }
}

const fwBusy = ref<Record<string, boolean>>({})
async function toggleRule(row: net.FirewallRule, enabled: boolean) {
  try {
    await net.setFirewallRule({ ...row, enabled })
    fwRules.value = await net.getFirewallRules()
    message.success(enabled ? '规则已启用' : '规则已停用')
  } catch (e) {
    message.error(net.errText(e))
    fwRules.value = await net.getFirewallRules().catch(() => fwRules.value)
  }
}
async function removeRule(row: net.FirewallRule) {
  fwBusy.value[String(row.id)] = true
  try {
    await net.delFirewallRule(row.id as string | number)
    const after = await net.getFirewallRules()
    if (after.some((r) => r.id === row.id)) throw new Error('删除后规则仍在，设备可能拒绝了本次操作')
    fwRules.value = after
    message.success('规则已删除并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    fwBusy.value[String(row.id)] = false
  }
}

const fwCols = computed<DataTableColumns<net.FirewallRule>>(() => [
  { title: '名称', key: 'name', render: (r) => r.name || '—' },
  { title: '源区域', key: 'src', width: 90, render: (r) => h('span', { class: 'nui-mono' }, r.src) },
  { title: '协议', key: 'proto', width: 90, render: (r) => h('span', { class: 'nui-mono' }, String(r.proto || '').toUpperCase()) },
  { title: '目标端口', key: 'dest_port', width: 100, render: (r) => h('span', { class: 'nui-mono' }, r.dest_port || '全部') },
  {
    title: '动作',
    key: 'target',
    width: 90,
    render: (r) => h(NTag, { size: 'small', bordered: false, type: r.target === 'DROP' ? 'error' : 'success' }, { default: () => r.target }),
  },
  {
    title: '启用',
    key: 'enabled',
    width: 76,
    render: (r) => h(NSwitch, { size: 'small', value: r.enabled !== false, onUpdateValue: (v: boolean) => toggleRule(r, v) }),
  },
  {
    title: '操作',
    key: 'op',
    width: 128,
    render: (r) =>
      h('div', { class: 'nui-row' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openRule(r) }, { default: () => '编辑' }),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeRule(r) },
          {
            trigger: () =>
              h(NButton, { size: 'tiny', quaternary: true, type: 'error', loading: !!fwBusy.value[String(r.id)] }, { default: () => '删除' }),
            default: () => `删除规则「${r.name}」？WAN 侧对应端口的放行/拦截会立即失效。`,
          },
        ),
      ]),
  },
])

/* ================= 访问控制（ACL） ================= */
const aclRules = ref<net.AclRule[]>([])
const aclZones = reactive<net.FirewallZones>({ internals: [], externals: [] })
const aclShow = ref(false)
const aclSaving = ref(false)
const aclEditing = ref(false)
const aclForm = reactive({
  id: undefined as string | number | undefined,
  name: '',
  family: 'ipv4 ipv6',
  src: 'lan',
  srcIpText: '',
  src_port: '',
  dest: 'wan',
  destIpText: '',
  dest_port: '',
  proto: 'tcp udp',
  target: 'ACCEPT',
  enabled: true,
})

function blankAcl() {
  Object.assign(aclForm, {
    id: undefined,
    name: '',
    family: 'ipv4 ipv6',
    src: aclZones.internals[0] ?? 'lan',
    srcIpText: '',
    src_port: '',
    dest: aclZones.externals[0] ?? 'wan',
    destIpText: '',
    dest_port: '',
    proto: 'tcp udp',
    target: 'ACCEPT',
    enabled: true,
  })
}

async function loadAcl() {
  aclRules.value = await net.getAclRules()
  const z = await net.getAclZones()
  aclZones.internals = z.internals
  aclZones.externals = z.externals
  bwl.value = await softLoad(() => net.getBwlConfig(), null, 'MAC 黑白名单（black_white_list.get_config）')
  bwlMode.value = String(bwl.value?.mode ?? 'black')
  return true
}

function openAcl(row?: net.AclRule) {
  aclEditing.value = !!row
  if (row) {
    Object.assign(aclForm, {
      id: row.id,
      name: row.name ?? '',
      family: row.family || 'ipv4 ipv6',
      src: row.src || 'lan',
      srcIpText: (row.src_ip ?? []).filter(Boolean).join('\n'),
      src_port: row.src_port ?? '',
      dest: row.dest || 'wan',
      destIpText: (row.dest_ip ?? []).filter(Boolean).join('\n'),
      dest_port: row.dest_port ?? '',
      proto: row.proto || 'tcp udp',
      target: row.target || 'ACCEPT',
      enabled: row.enabled !== false,
    })
  } else blankAcl()
  aclShow.value = true
}

function buildAclBody(): net.AclRule {
  const list = (t: string) => {
    const arr = [...new Set(net.splitList(t))]
    return arr.length ? arr : ['']
  }
  const showPort = ['tcp', 'udp', 'tcp udp'].includes(aclForm.proto)
  const body: net.AclRule = {
    name: aclForm.name.trim(),
    family: aclForm.family,
    src: aclForm.src,
    src_ip: list(aclForm.srcIpText),
    dest: aclForm.dest,
    dest_ip: list(aclForm.destIpText),
    proto: aclForm.proto,
    target: aclForm.target,
    enabled: aclForm.enabled,
  }
  // 官方行为：协议不是 tcp/udp 时不下发端口字段；端口留空 = 任意
  if (showPort) {
    body.src_port = aclForm.src_port || ''
    body.dest_port = aclForm.dest_port || ''
  }
  if (aclForm.id != null) body.id = aclForm.id
  return body
}

async function submitAcl() {
  if (!aclForm.name.trim()) {
    message.warning('规则名必填')
    return
  }
  aclSaving.value = true
  try {
    const body = buildAclBody()
    if (aclEditing.value && body.id != null) await net.editAclRule(body)
    else await net.addAclRule(body)
    const after = await net.getAclRules()
    if (!after.some((r) => r.name === body.name)) throw new Error('保存后回读不到该规则，固件可能拒绝了本次修改')
    aclRules.value = after
    aclShow.value = false
    message.success(aclEditing.value ? 'ACL 规则已更新并回读确认' : 'ACL 规则已添加并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    aclSaving.value = false
  }
}

async function removeAcl(row: net.AclRule) {
  try {
    await net.delAclRule(row.id as string | number)
    const after = await net.getAclRules()
    if (after.some((r) => r.id === row.id)) throw new Error('删除后规则仍在')
    aclRules.value = after
    message.success('ACL 规则已删除并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  }
}

async function toggleAcl(row: net.AclRule, enabled: boolean) {
  try {
    await net.editAclRule({ ...row, enabled })
    aclRules.value = await net.getAclRules()
    message.success(enabled ? '已启用' : '已停用')
  } catch (e) {
    message.error(net.errText(e))
    aclRules.value = await net.getAclRules().catch(() => aclRules.value)
  }
}

async function moveAcl(index: number, dir: -1 | 1) {
  const arr = [...aclRules.value]
  const to = index + dir
  if (to < 0 || to >= arr.length) return
  const [x] = arr.splice(index, 1)
  arr.splice(to, 0, x)
  try {
    await net.orderAclRules(arr.map((r) => r.id as string | number))
    aclRules.value = await net.getAclRules()
    message.success('优先级已保存')
  } catch (e) {
    message.error(net.errText(e))
  }
}

const aclCols = computed<DataTableColumns<net.AclRule>>(() => [
  { title: '#', key: 'idx', width: 46, render: (_r, i) => String(i + 1) },
  { title: '名称', key: 'name', render: (r) => r.name || '—' },
  {
    title: '源 → 目的',
    key: 'flow',
    render: (r) =>
      h(
        'span',
        { class: 'nui-mono nui-small' },
        `${r.src}(${(r.src_ip ?? []).filter(Boolean).join(',') || '任意'}) → ${r.dest}(${(r.dest_ip ?? []).filter(Boolean).join(',') || '任意'})`,
      ),
  },
  { title: '协议', key: 'proto', width: 90, render: (r) => h('span', { class: 'nui-mono' }, String(r.proto || '').toUpperCase() || '任意') },
  {
    title: '端口',
    key: 'port',
    width: 110,
    render: (r) => h('span', { class: 'nui-mono nui-small' }, `${r.src_port || '任意'} → ${r.dest_port || '任意'}`),
  },
  {
    title: '动作',
    key: 'target',
    width: 84,
    render: (r) => h(NTag, { size: 'small', bordered: false, type: r.target === 'ACCEPT' ? 'success' : 'error' }, { default: () => r.target }),
  },
  {
    title: '启用',
    key: 'enabled',
    width: 70,
    render: (r) => h(NSwitch, { size: 'small', value: r.enabled !== false, onUpdateValue: (v: boolean) => toggleAcl(r, v) }),
  },
  {
    title: '操作',
    key: 'op',
    width: 200,
    render: (r, i) =>
      h('div', { class: 'nui-row' }, [
        h(NButton, { size: 'tiny', quaternary: true, disabled: i === 0, onClick: () => moveAcl(i, -1) }, { default: () => '↑' }),
        h(NButton, { size: 'tiny', quaternary: true, disabled: i >= aclRules.value.length - 1, onClick: () => moveAcl(i, 1) }, { default: () => '↓' }),
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openAcl(r) }, { default: () => '编辑' }),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeAcl(r) },
          {
            trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
            default: () => `删除 ACL 规则「${r.name}」？`,
          },
        ),
      ]),
  },
])

/* MAC 黑白名单 */
const bwl = ref<net.BwlConfig | null>(null)
const bwlMode = ref('black')
const bwlSaving = ref(false)
async function saveBwl(mode: string) {
  bwlSaving.value = true
  try {
    await net.saveBwlConfig({ mode })
    const after = await net.getBwlConfig()
    if (String(after.mode) !== mode) throw new Error('回读模式与提交不一致')
    bwl.value = after
    bwlMode.value = String(after.mode)
    message.success('MAC 过滤模式已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    bwlSaving.value = false
  }
}

/* ================= 远程访问 ================= */
const wanForm = ref<net.WanAccess | null>(null)
const wanSaving = ref(false)
const whiteIp = ref('')
const whiteName = ref('')

async function loadRemote() {
  wanForm.value = await net.getWanAccess()
  wanAccess.value = wanForm.value
  fwRules.value = await softLoad(() => net.getFirewallRules(), [], 'WAN 规则（firewall.get_rule_list）')
  return true
}

async function saveWan() {
  if (!wanForm.value) return
  wanSaving.value = true
  try {
    const before = wanForm.value
    await net.saveWanAccess(before)
    const after = await net.getWanAccess()
    if (!!after.enable_ping !== !!before.enable_ping || !!after.enable_ssh !== !!before.enable_ssh)
      throw new Error('回读与提交不一致，固件可能拒绝了本次修改')
    wanForm.value = after
    wanAccess.value = after
    message.success('WAN 侧访问控制已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    wanSaving.value = false
  }
}

async function addWhite() {
  if (!wanForm.value) return
  const ip = whiteIp.value.trim()
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    message.warning('白名单需要一个合法 IPv4')
    return
  }
  wanForm.value.whitelist = [...(wanForm.value.whitelist ?? []), { name: whiteName.value.trim(), ipaddr: ip }]
  whiteIp.value = ''
  whiteName.value = ''
  await saveWan()
}

async function removeWhite(i: number) {
  if (!wanForm.value) return
  const list = [...(wanForm.value.whitelist ?? [])]
  list.splice(i, 1)
  wanForm.value.whitelist = list
  await saveWan()
}

/* 本地访问（local-access） */
const localFields: Field[] = [
  { key: 'ssh_enabled', label: '允许 SSH 登录', type: 'switch', span: 24 },
  { key: 'ssh_port', label: 'SSH 端口', type: 'number', min: 1, max: 65535, span: 12 },
  { key: 'session_timeout_min', label: '会话超时（分钟）', type: 'number', min: 1, max: 1440, span: 12 },
  { key: 'http_port', label: '后台 HTTP 端口', type: 'number', min: 1, max: 65535, span: 12 },
  { key: 'https_port', label: '后台 HTTPS 端口', type: 'number', min: 1, max: 65535, span: 12 },
  { key: 'redirect_https', label: 'HTTP 强制跳转 HTTPS', type: 'switch', span: 12 },
  { key: 'luci_http_port', label: 'LuCI HTTP 端口', type: 'number', min: 1, max: 65535, span: 12 },
  { key: 'luci_https_port', label: 'LuCI HTTPS 端口', type: 'number', min: 1, max: 65535, span: 12 },
  { key: 'luci_redirect_https', label: 'LuCI 强制 HTTPS', type: 'switch', span: 24 },
]
async function loadLocalAccess(): Promise<Record<string, unknown>> {
  const r = await net.getLocalAccess()
  return { ...r, session_timeout_min: Math.max(1, Math.round(Number(r.session_timeout) / 60)) }
}
async function saveLocalAccess(v: Record<string, unknown>): Promise<void> {
  const p: net.LocalAccess = {
    ssh_enabled: !!v.ssh_enabled,
    ssh_port: Number(v.ssh_port),
    http_port: Number(v.http_port),
    https_port: Number(v.https_port),
    redirect_https: !!v.redirect_https,
    luci_http_port: Number(v.luci_http_port),
    luci_https_port: Number(v.luci_https_port),
    luci_redirect_https: !!v.luci_redirect_https,
    session_timeout: Math.round(Number(v.session_timeout_min ?? 5) * 60),
  }
  await net.saveLocalAccess(p)
  const after = await net.getLocalAccess()
  if (Number(after.ssh_port) !== p.ssh_port || Number(after.http_port) !== p.http_port)
    throw new Error('回读与提交不一致，固件可能拒绝了本次修改')
}

/* ================= 家长控制 ================= */
const parental = ref<net.ParentalConfig | null>(null)
const parentalSaving = ref(false)
const clients = ref<net.ClientLite[]>([])
const parentalApps = ref<net.AppCategory[]>([])
const appsLoaded = ref(false)
const grpShow = ref(false)
const grpSaving = ref(false)
const grpEditing = ref(false)
const grpForm = reactive({
  id: undefined as string | number | undefined,
  name: '',
  enabled: true,
  macs: [] as string[],
  category: [] as string[],
  apps: [] as string[],
  blacklistText: '',
  schedules_enabled: true,
  schedules_days: 'everyday',
  everydayBegin: '22:00',
  everydayEnd: '07:00',
  custom: [] as { week: number; enabled: boolean; begin: string; end: string }[],
  appKeyword: '',
})

const PARENTAL_CATS = ['sexual_content', 'gambling', 'game', 'malicious_content', 'social_entertainment', 'shopping']

async function loadParental() {
  parental.value = await net.getParentalConfig()
  clients.value = await softLoad(() => net.getClients(), [], '终端列表（clients.get_list）')
  return true
}

async function ensureParentalApps() {
  if (appsLoaded.value) return
  try {
    parentalApps.value = await net.getParentalApps()
    appsLoaded.value = true
  } catch (e) {
    soft.value = `${soft.value ? soft.value + '；' : ''}家长控制应用库（parental-control.get_app_list）：${net.errText(e)}`
  }
}

async function toggleParental(enable: boolean) {
  parentalSaving.value = true
  try {
    await net.setParentalEnable(enable)
    const after = await net.getParentalConfig()
    if (!!after.enable !== enable) throw new Error('回读开关与提交不一致')
    parental.value = after
    message.success(enable ? '家长控制已启用并回读确认' : '家长控制已关闭')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    parentalSaving.value = false
  }
}

function blankGroup() {
  Object.assign(grpForm, {
    id: undefined,
    name: '',
    enabled: true,
    macs: [],
    category: [],
    apps: [],
    blacklistText: '',
    schedules_enabled: true,
    schedules_days: 'everyday',
    everydayBegin: '22:00',
    everydayEnd: '07:00',
    custom: Array.from({ length: 7 }, (_, i) => ({ week: i + 1, enabled: true, begin: '22:00', end: '07:00' })),
    appKeyword: '',
  })
}

function openGroup(g?: net.ParentalGroup) {
  grpEditing.value = !!g
  blankGroup()
  if (g) {
    const sch = (g.schedules ?? []).slice()
    const everyday = !sch.length || sch[0]?.week === 0
    Object.assign(grpForm, {
      id: g.id,
      name: g.name ?? '',
      enabled: g.enabled !== false,
      macs: [...(g.macs ?? [])],
      category: [...(g.category ?? [])],
      apps: [...(g.apps ?? [])],
      blacklistText: (g.blacklist ?? []).join('\n'),
      schedules_enabled: g.schedules_enabled !== false,
      schedules_days: everyday ? 'everyday' : 'customize',
      everydayBegin: everyday ? sch[0]?.begin || '22:00' : '22:00',
      everydayEnd: everyday ? sch[0]?.end || '07:00' : '07:00',
      custom: [1, 2, 3, 4, 5, 6, 7].map((w) => {
        const hit = sch.find((s) => Number(s.week) === w)
        return { week: w, enabled: hit ? hit.enabled !== false : true, begin: hit?.begin || '22:00', end: hit?.end || '07:00' }
      }),
    })
    void ensureParentalApps()
  }
  grpShow.value = true
}

function buildGroup(): net.ParentalGroup {
  const schedules: net.ParentalSchedule[] =
    grpForm.schedules_days === 'everyday'
      ? [{ week: 0, enabled: true, begin: grpForm.everydayBegin || '22:00', end: grpForm.everydayEnd || '07:00' }]
      : grpForm.custom.map((c) => ({ week: c.week, enabled: c.enabled, begin: c.begin || '22:00', end: c.end || '07:00' }))
  const g: net.ParentalGroup = {
    name: grpForm.name.trim(),
    enabled: grpForm.enabled,
    macs: grpForm.macs,
    category: grpForm.category,
    apps: grpForm.apps,
    blacklist: net.splitList(grpForm.blacklistText),
    schedules_enabled: grpForm.schedules_enabled,
    schedules_days: grpForm.schedules_days,
    schedules,
  }
  if (grpForm.id != null) g.id = grpForm.id
  return g
}

async function submitGroup() {
  if (!grpForm.name.trim()) {
    message.warning('组名必填')
    return
  }
  grpSaving.value = true
  try {
    const g = buildGroup()
    if (grpEditing.value && g.id != null) await net.setParentalGroup(g)
    else await net.addParentalGroup(g)
    const after = await net.getParentalConfig()
    if (!(after.groups ?? []).some((x) => x.name === g.name)) throw new Error('保存后回读不到该组，固件可能拒绝了本次修改')
    parental.value = after
    grpShow.value = false
    message.success(grpEditing.value ? '规则组已更新并回读确认' : '规则组已添加并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    grpSaving.value = false
  }
}

async function removeGroup(g: net.ParentalGroup) {
  try {
    await net.delParentalGroup(g.id as string | number)
    const after = await net.getParentalConfig()
    if ((after.groups ?? []).some((x) => x.id === g.id)) throw new Error('删除后组仍在')
    parental.value = after
    message.success('规则组已删除并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  }
}

const clientsOptions = computed(() =>
  clients.value.map((c) => ({ label: `${c.alias || c.name || c.mac} · ${c.ip || ''}`, value: c.mac })),
)
const appOptions = computed(() => {
  const kw = grpForm.appKeyword.trim().toLowerCase()
  const out: { label: string; value: string }[] = []
  for (const c of parentalApps.value) {
    for (const a of c.apps ?? []) {
      if (kw && !`${a.name} ${a.label ?? ''}`.toLowerCase().includes(kw)) continue
      out.push({ label: `${a.label || a.name}（${catLabel(c.category_name)}）`, value: a.name })
      if (out.length > 400) return out
    }
  }
  return out
})

/* ================= 应用管控（DPI） ================= */
const dpiCfg = ref<net.DpiConfig | null>(null)
const dpiStats = ref<net.DpiStats | null>(null)
const cp = reactive({ enable: false, category: [] as string[], apps: [] as string[], domainText: '' })
const cpSaving = ref(false)
const cpTrialBusy = ref(false)
const dpiApps = ref<net.AppCategory[]>([])
const dpiAppsLoaded = ref(false)
const dpiAppCat = ref('')
const dpiAppKw = ref('')

async function loadDpi() {
  dpiCfg.value = await softLoad(() => net.getDpiConfig(), null, 'DPI 引擎信息（dpi.get_dpi_config）')
  dpiStats.value = await softLoad(() => net.getDpiStats(), null, 'DPI 统计（dpi.get_dpi_stats）')
  const c = await net.getContentProtection()
  cp.enable = !!c.enable
  cp.category = [...(c.category_list ?? [])]
  cp.apps = (c.app_list ?? []).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean)
  cp.domainText = (c.domain_list ?? []).join('\n')
  return true
}

async function ensureDpiApps() {
  if (dpiAppsLoaded.value) return
  try {
    dpiApps.value = await net.getDpiApps()
    dpiAppsLoaded.value = true
    if (!dpiAppCat.value && dpiApps.value.length) dpiAppCat.value = dpiApps.value[0].category_name
    if (!engCat.value && dpiApps.value.length) engCat.value = dpiApps.value[0].category_name
  } catch (e) {
    soft.value = `${soft.value ? soft.value + '；' : ''}应用库（dpi.get_apps）：${net.errText(e)}`
  }
}

const dpiAppList = computed(() => {
  const cat = dpiApps.value.find((c) => c.category_name === dpiAppCat.value)
  const kw = dpiAppKw.value.trim().toLowerCase()
  const apps = (cat?.apps ?? []).filter((a) => !kw || `${a.name} ${a.label ?? ''}`.toLowerCase().includes(kw))
  return apps.slice(0, 300)
})

/* 应用库浏览（「应用管控」卡片，只读） */
const engCat = ref('')
const engKw = ref('')
const dpiAppTotal = computed(() => dpiApps.value.reduce((a, c) => a + (c.apps ?? []).length, 0))
const engAppList = computed(() => {
  const cat = dpiApps.value.find((c) => c.category_name === engCat.value)
  const kw = engKw.value.trim().toLowerCase()
  const apps = (cat?.apps ?? []).filter((a) => !kw || `${a.name} ${a.label ?? ''}`.toLowerCase().includes(kw))
  return apps.slice(0, 400)
})
const dpiRunning = computed(() => {
  const st = dpiStats.value
  return !!st && (Number(st.traffic_day ?? 0) > 0 || Number(st.content_protection_all ?? 0) > 0)
})

function toggleDpiApp(name: string, on: boolean) {
  const set = new Set(cp.apps)
  if (on) set.add(name)
  else set.delete(name)
  cp.apps = [...set]
}

async function saveCp() {
  cpSaving.value = true
  try {
    await net.saveContentProtection({
      enable: cp.enable,
      category_list: cp.category,
      app_list: cp.apps,
      domain_list: net.splitList(cp.domainText),
    })
    const after = await net.getContentProtection()
    if (!!after.enable !== cp.enable) throw new Error('回读开关与提交不一致，固件可能拒绝了本次修改')
    cp.enable = !!after.enable
    cp.category = [...(after.category_list ?? [])]
    cp.apps = (after.app_list ?? []).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean)
    message.success('内容保护已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    cpSaving.value = false
  }
}

async function trialDpi() {
  cpTrialBusy.value = true
  try {
    const r = await net.enableDpiBase(true)
    if (r?.status === 0) message.success('DPI 基础服务已启用（status=0）')
    else message.warning(`DPI 服务返回状态码 ${r?.status}（-8 = 需要激活/试用许可，详见官方 DPI 引擎页）`)
    dpiCfg.value = await softLoad(() => net.getDpiConfig(), dpiCfg.value, 'DPI 引擎信息')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    cpTrialBusy.value = false
  }
}

/* ================= 装载调度 ================= */
const { loading, error, reload } = useAsync(
  async () => {
    soft.value = ''
    const s = section.value
    if (s === 'firewall') return loadFirewall()
    if (s === 'acl') return loadAcl()
    if (s === 'remote') return loadRemote()
    if (s === 'parental') return loadParental()
    if (s === 'dpi') return loadDpi()
    return true
  },
  { watchSource: section },
)
</script>

<template>
  <div class="nui-page">
    <n-alert v-if="soft" type="warning" :bordered="false" closable @close="soft = ''">{{ soft }}</n-alert>

    <PageState :loading="loading" :error="error" @retry="reload">
      <!-- ==================== 防火墙 ==================== -->
      <div v-if="section === 'firewall'" class="nui-grid">
        <PanelCard class="span-8" title="WAN → 设备 放行规则">
          <template #icon><n-icon><ShieldOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" type="primary" secondary @click="openRule()">新增规则</n-button>
          </template>
          <n-data-table
            :columns="fwCols"
            :data="fwRules"
            size="small"
            :bordered="false"
            :scroll-x="720"
            :row-key="(r: any) => String(r.id ?? r.name)"
          >
            <template #empty>
              <n-empty description="没有任何 WAN 侧放行规则（firewall.get_rule_list 返回空）" size="small" />
            </template>
          </n-data-table>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            写接口：<code>firewall.add/set/remove_rule</code>；结构与官方「管理员访问 → 远程访问」里的端口规则表一致。
          </p>
        </PanelCard>

        <PanelCard class="span-4" title="区域与快捷入口">
          <template #icon><n-icon><LockClosedOutline /></n-icon></template>
          <div class="nui-sec">防火墙区域</div>
          <dl class="nui-kv">
            <dt>内部区域</dt>
            <dd class="nui-mono nui-small">{{ zones.internals.join(', ') || '—' }}</dd>
            <dt>外部区域</dt>
            <dd class="nui-mono nui-small">{{ zones.externals.join(', ') || '—' }}</dd>
          </dl>

          <div class="nui-sec" style="margin-top: 16px">WAN 访问控制</div>
          <dl v-if="wanAccess" class="nui-kv">
            <dt>Ping</dt>
            <dd>{{ wanAccess.enable_ping ? '放行' : '拦截' }}</dd>
            <dt>SSH</dt>
            <dd>{{ wanAccess.enable_ssh ? '放行' : '拦截' }}</dd>
            <dt>HTTPS</dt>
            <dd>{{ wanAccess.enable_https ? '放行' : '拦截' }}</dd>
            <dt>IP 白名单</dt>
            <dd>{{ wanAccess.enable_whitelist ? `开（${(wanAccess.whitelist ?? []).length} 条）` : '关' }}</dd>
          </dl>
          <n-button size="tiny" secondary style="margin-top: 8px" @click="router.push('/security/remote')">去设置远程访问</n-button>

          <div class="nui-sec" style="margin-top: 16px">DMZ</div>
          <dl v-if="dmzState" class="nui-kv">
            <dt>状态</dt>
            <dd>{{ dmzState.enabled ? '已启用' : '未启用' }}</dd>
            <dt>主机</dt>
            <dd class="nui-mono">{{ dmzState.dest_ip || '—' }}</dd>
          </dl>
          <n-button size="tiny" secondary style="margin-top: 8px" @click="router.push('/network/nat')">去「端口映射与 DMZ」</n-button>
        </PanelCard>
      </div>

      <!-- ==================== 访问控制 ==================== -->
      <div v-if="section === 'acl'" class="nui-grid">
        <PanelCard class="span-12" title="访问控制规则（ACL）">
          <template #icon><n-icon><BanOutline /></n-icon></template>
          <template #extra>
            <n-button size="tiny" type="primary" secondary @click="openAcl()">新增规则</n-button>
          </template>
          <n-data-table
            :columns="aclCols"
            :data="aclRules"
            size="small"
            :bordered="false"
            :scroll-x="980"
            :row-key="(r: any) => String(r.id ?? r.name)"
          >
            <template #empty>
              <n-empty description="还没有 ACL 规则（firewall.get_acl_rule_list 返回空）" size="small" />
            </template>
          </n-data-table>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            写接口：<code>firewall.add_acl_rule / edit_acl_rule / delete_acl_rule / order_acl_rule</code>（对象是 firewall，不是 acl）。
            规则自上而下匹配；<code>ipv4 ipv6</code> 表示同时下发两套 nftables 规则。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="MAC 黑白名单（black_white_list）">
          <template #icon><n-icon><LockClosedOutline /></n-icon></template>
          <n-form label-placement="top" :show-feedback="false">
            <n-form-item label="过滤模式">
              <n-select
                v-model:value="bwlMode"
                :options="[
                  { label: '黑名单（禁止列表内 MAC 上网）', value: 'black' },
                  { label: '白名单（只允许列表内 MAC 上网）', value: 'white' },
                ]"
              />
            </n-form-item>
          </n-form>
          <n-button size="small" type="primary" secondary :loading="bwlSaving" style="margin-top: 10px" @click="saveBwl(bwlMode)">
            保存模式
          </n-button>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            接口 <code>black_white_list.get_config / set_config</code>。当前固件只返回 <code>{mode}</code>（本机 mode={{ bwl?.mode ?? '—' }}），
            MAC 清单本身由 Wi-Fi 黑白名单维护（官方「无线 → 黑白名单」页，本系统在 /wireless/acl），这里只切模式。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="说明">
          <p class="nui-small nui-muted" style="margin: 0; line-height: 1.9">
            ACL 是「按源/目的区域 + IP/端口」的防火墙规则，适合放行或拦截特定网段与端口；
            MAC 黑白名单是「按终端」的接入控制，适合禁止某个设备上网。两者可以叠加。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== 远程访问管理 ==================== -->
      <div v-if="section === 'remote'" class="nui-grid">
        <PanelCard class="span-6" title="WAN 侧放行">
          <template #icon><n-icon><ShieldOutline /></n-icon></template>
          <div v-if="wanForm">
            <div class="nui-between nui-list-row">
              <span>允许从 WAN ping 设备</span>
              <n-switch v-model:value="wanForm.enable_ping" />
            </div>
            <div class="nui-between nui-list-row">
              <span>允许从 WAN SSH 登录</span>
              <n-switch v-model:value="wanForm.enable_ssh" />
            </div>
            <div class="nui-between nui-list-row">
              <span>允许从 WAN 访问 HTTPS 后台</span>
              <n-switch v-model:value="wanForm.enable_https" />
            </div>
            <div class="nui-between nui-list-row">
              <span>仅允许白名单 IP（其余拒绝）</span>
              <n-switch v-model:value="wanForm.enable_whitelist" />
            </div>
            <n-button size="small" type="primary" :loading="wanSaving" style="margin-top: 12px" @click="saveWan">保存 WAN 放行</n-button>
            <n-alert type="warning" :bordered="false" style="margin-top: 12px">
              从公网开放后台/SSH 有被爆破风险：优先开白名单，或改用 GoodCloud / AstroWarp 远程通道。
            </n-alert>
          </div>
          <PageState v-else empty empty-text="当前固件没有 firewall.get_wan_access" compact />
        </PanelCard>

        <PanelCard class="span-6" title="IP 白名单">
          <div v-if="wanForm" class="nui-col nui-gap-8">
            <div v-for="(w, i) in wanForm.whitelist ?? []" :key="i" class="nui-between nui-list-row">
              <span class="nui-mono">{{ w.ipaddr || '—' }}</span>
              <span class="nui-small nui-muted">{{ w.name || '' }}</span>
              <n-button size="tiny" quaternary type="error" @click="removeWhite(i)">删除</n-button>
            </div>
            <n-empty v-if="!(wanForm.whitelist ?? []).length" description="白名单为空（未开启时无意义）" size="small" />
            <div class="nui-row" style="margin-top: 6px">
              <n-input v-model:value="whiteIp" size="small" placeholder="IP" style="flex: 1" />
              <n-input v-model:value="whiteName" size="small" placeholder="备注" style="width: 110px" />
              <n-button size="small" secondary @click="addWhite">加入</n-button>
            </div>
            <p class="nui-small nui-muted" style="margin: 6px 0 0">
              写 <code>firewall.set_wan_access</code>（整包），白名单结构 <code>[{name,ipaddr}]</code>。
            </p>
          </div>
        </PanelCard>

        <PanelCard class="span-6" title="后台 / SSH 端口">
          <template #icon><n-icon><LockClosedOutline /></n-icon></template>
          <SettingsForm :fields="localFields" :load="loadLocalAccess" :save="saveLocalAccess" />
          <n-alert type="warning" :bordered="false" style="margin-top: 10px">
            改 HTTP/HTTPS/SSH 端口后会立刻生效，当前页面需要用新端口重新访问。写接口 <code>local-access.set_config</code>。
          </n-alert>
        </PanelCard>

        <PanelCard class="span-6" title="WAN 端口规则">
          <div v-for="r in fwRules" :key="String(r.id)" class="nui-between nui-list-row">
            <span class="nui-mono nui-small">{{ String(r.proto || '').toUpperCase() }} {{ r.dest_port || 'all' }}</span>
            <n-tag size="tiny" :bordered="false" :type="r.target === 'DROP' ? 'error' : 'success'">{{ r.target }}</n-tag>
            <n-tag size="tiny" :bordered="false" :type="r.enabled !== false ? 'info' : 'default'">{{ r.enabled !== false ? '开' : '关' }}</n-tag>
          </div>
          <n-empty v-if="!fwRules.length" description="没有额外的 WAN 端口规则" size="small" />
          <n-button size="tiny" secondary style="margin-top: 10px" @click="router.push('/security/firewall')">去「防火墙」增删规则</n-button>
        </PanelCard>
      </div>

      <!-- ==================== 家长控制 ==================== -->
      <div v-if="section === 'parental'" class="nui-grid">
        <PanelCard class="span-12" title="家长控制">
          <template #icon><n-icon><TimeOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <span class="nui-small nui-muted">总开关</span>
              <n-switch :value="!!parental?.enable" :loading="parentalSaving" @update:value="toggleParental" />
              <n-button size="tiny" type="primary" secondary @click="openGroup()">新建规则组</n-button>
            </div>
          </template>

          <div v-for="g in parental?.groups ?? []" :key="String(g.id)" class="grp">
            <div class="nui-between">
              <div class="nui-row">
                <n-tag size="small" :bordered="false" :type="g.enabled !== false ? 'success' : 'default'">
                  {{ g.enabled !== false ? '生效中' : '已停用' }}
                </n-tag>
                <span class="grp-name">{{ g.name }}</span>
              </div>
              <div class="nui-row">
                <n-button size="tiny" quaternary type="primary" @click="openGroup(g)">编辑</n-button>
                <n-popconfirm @positive-click="removeGroup(g)">
                  <template #trigger><n-button size="tiny" quaternary type="error">删除</n-button></template>
                  删除规则组「{{ g.name }}」？该组所有设备的上网限制会立即解除。
                </n-popconfirm>
              </div>
            </div>
            <div class="nui-small nui-muted" style="margin-top: 6px">
              设备 {{ (g.macs ?? []).length }} 台 · 分类 {{ (g.category ?? []).map(catLabel).join('、') || '无' }} ·
              应用 {{ (g.apps ?? []).length }} 个 · 域名 {{ (g.blacklist ?? []).length }} 条 ·
              {{
                g.schedules_enabled === false
                  ? '不限制时段'
                  : (g.schedules ?? []).map((s) => `${s.week === 0 ? '每天' : '周' + s.week} ${s.begin}-${s.end}`).join('，')
              }}
            </div>
          </div>
          <n-empty v-if="!(parental?.groups ?? []).length" description="还没有规则组（parental-control.get_config.groups 为空）" size="small" />
          <n-alert type="info" :bordered="false" style="margin-top: 12px">
            实测固件行为：新增第一个规则组时会把「总开关」一并打开（parental-control.add_group 的副作用），保存后请看右上角开关状态。
          </n-alert>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            写接口：<code>parental-control.set_config</code>（总开关）、<code>add_group / set_group / remove_group</code>（规则组）。
            分类与应用库来自 <code>parental-control.get_app_list</code>（约 65 KB，仅在编辑规则组时按需拉取）。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== 应用管控（官方 dpifeatures） ==================== -->
      <div v-if="section === 'dpi'" class="nui-grid">
        <PanelCard class="span-12" title="① 应用管控 / DPI 引擎（官方 dpifeatures）">
          <template #icon><n-icon><AppsOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-tag size="small" :bordered="false" :type="dpiRunning ? 'success' : 'default'">{{ dpiRunning ? '引擎运行中' : '引擎未就绪' }}</n-tag>
              <n-button size="tiny" type="primary" secondary :loading="cpTrialBusy" @click="trialDpi">启用 DPI 基础服务</n-button>
            </div>
          </template>

          <div class="nui-grid" style="margin-bottom: 6px">
            <div class="span-3"><div class="nui-small nui-muted">库版本</div><div class="nui-mono">{{ dpiCfg?.lib_version || '—' }}</div></div>
            <div class="span-3"><div class="nui-small nui-muted">OTA 版本</div><div class="nui-mono">{{ dpiCfg?.ota_version || '—' }}</div></div>
            <div class="span-2"><div class="nui-small nui-muted">今日流量</div><div class="nui-mono">{{ dpiStats?.traffic_day ?? 0 }}</div></div>
            <div class="span-2"><div class="nui-small nui-muted">今日拦截</div><div class="nui-mono">{{ dpiStats?.content_protection_day ?? 0 }}</div></div>
            <div class="span-2"><div class="nui-small nui-muted">累计拦截</div><div class="nui-mono">{{ dpiStats?.content_protection_all ?? 0 }}</div></div>
          </div>

          <div class="nui-sec" style="margin-top: 10px">应用库（dpi.get_apps）</div>
          <div class="nui-row nui-wrap" style="margin-bottom: 8px">
            <n-button size="tiny" secondary @click="ensureDpiApps">{{ dpiAppsLoaded ? `已加载 ${dpiApps.length} 个分类` : '加载应用库（355 KB）' }}</n-button>
            <n-select
              v-if="dpiApps.length"
              v-model:value="engCat"
              size="tiny"
              style="width: 170px"
              :options="dpiApps.map((c) => ({ label: `${catLabel(c.category_name)}（${(c.apps ?? []).length}）`, value: c.category_name }))"
            />
            <n-input v-model:value="engKw" size="tiny" placeholder="搜索应用" style="width: 150px" />
            <span class="nui-small nui-muted">共 {{ dpiAppTotal }} 个应用</span>
          </div>
          <div v-if="dpiApps.length" class="app-list">
            <span v-for="a in engAppList" :key="a.name" class="nui-small">{{ a.label || a.name }}</span>
            <div v-if="!engAppList.length" class="nui-small nui-muted">没有匹配的应用</div>
          </div>
          <p v-else class="nui-small nui-muted" style="margin: 4px 0 0">
            应用库不会首屏自动拉取（355 KB），点上面的按钮按需加载；它同时给「内容保护」的指定应用选择器用。
          </p>

          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            读 <code>dpi.get_apps / dpi.get_dpi_config / dpi.get_dpi_stats</code>，写 <code>dpi.enable_dpi_base_service</code>。
            DPI 库升级（<code>dpi.check_lib_upgrade / set_lib_upgrade</code>）会联网下载，属长任务，留给官方「DPI 引擎」页执行。
            按应用分级限速在 <a class="lnk" @click="router.push('/flow/qos')">/flow/qos</a>。
          </p>
        </PanelCard>

        <PanelCard class="span-12" title="② 内容保护 / 分类与域名过滤（官方 contentprotection）">
          <template #icon><n-icon><BanOutline /></n-icon></template>
          <div class="nui-between nui-list-row">
            <span>启用内容保护</span>
            <n-switch v-model:value="cp.enable" />
          </div>

          <div class="nui-sec" style="margin-top: 12px">分类拦截（category_list）</div>
          <n-checkbox-group v-model:value="cp.category">
            <div class="cats">
              <n-checkbox v-for="c in ['gambling', 'adult', 'malware']" :key="c" :value="c" :label="catLabel(c)" />
            </div>
          </n-checkbox-group>

          <div class="nui-sec" style="margin-top: 14px">指定应用（app_list）</div>
          <div class="nui-row nui-wrap" style="margin-bottom: 8px">
            <n-button size="tiny" secondary @click="ensureDpiApps">{{ dpiAppsLoaded ? '重新加载应用库' : '加载应用清单（dpi.get_apps）' }}</n-button>
            <n-select
              v-if="dpiApps.length"
              v-model:value="dpiAppCat"
              size="tiny"
              style="width: 160px"
              :options="dpiApps.map((c) => ({ label: catLabel(c.category_name), value: c.category_name }))"
            />
            <n-input v-model:value="dpiAppKw" size="tiny" placeholder="搜索应用" style="width: 140px" />
            <span class="nui-small nui-muted">已选 {{ cp.apps.length }} 个</span>
            <n-button size="tiny" quaternary @click="cp.apps = []">清空</n-button>
          </div>
          <div v-if="dpiApps.length" class="app-list">
            <n-checkbox
              v-for="a in dpiAppList"
              :key="a.name"
              :checked="cp.apps.includes(a.name)"
              :label="a.label || a.name"
              @update:checked="(v: boolean) => toggleDpiApp(a.name, v)"
            />
            <div v-if="!dpiAppList.length" class="nui-small nui-muted">该分类下没有匹配的应用</div>
          </div>
          <div v-else class="nui-small nui-muted" style="padding: 6px 0">未加载应用库时也能保存分类与域名规则。</div>

          <div class="nui-sec" style="margin-top: 14px">手动拦截域名（domain_list）</div>
          <n-input v-model:value="cp.domainText" type="textarea" :rows="3" placeholder="一行一个域名，例如 example.com" />

          <div class="nui-row" style="margin-top: 12px">
            <n-button size="small" type="primary" :loading="cpSaving" @click="saveCp">保存内容保护</n-button>
            <span class="nui-small nui-muted">
              写 <code>dpi.set_content_protection</code>（<code>app_list</code> 传应用名字符串数组）。与 DPI 引擎、QoS 共用引擎，开启后会自动关闭「网络加速」。
            </span>
          </div>
        </PanelCard>
      </div>
    </PageState>

    <!-- WAN 规则弹窗 -->
    <n-modal v-model:show="ruleShow" preset="card" style="width: 560px; max-width: 94vw" :title="ruleEditing ? '编辑 WAN 规则' : '新增 WAN 规则'">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="24" responsive="screen" item-responsive :x-gap="12" :y-gap="10">
          <n-form-item-gi :span="24" label="规则名">
            <n-input v-model:value="ruleForm.name" placeholder="例如 allow-ssh" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="源区域">
            <n-select v-model:value="ruleForm.src" :options="(zones.externals.length ? zones.externals : ['wan']).map((x) => ({ label: x, value: x }))" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="协议">
            <n-select
              v-model:value="ruleForm.proto"
              :options="[
                { label: 'TCP/UDP', value: 'tcp udp' },
                { label: 'TCP', value: 'tcp' },
                { label: 'UDP', value: 'udp' },
              ]"
            />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="目标端口（留空 = 全部）">
            <n-input v-model:value="ruleForm.dest_port" placeholder="22" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="动作">
            <n-select
              v-model:value="ruleForm.target"
              :options="[
                { label: 'ACCEPT（放行）', value: 'ACCEPT' },
                { label: 'DROP（丢弃）', value: 'DROP' },
              ]"
            />
          </n-form-item-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button @click="ruleShow = false">取消</n-button>
          <n-button type="primary" :loading="ruleSaving" @click="submitRule">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- ACL 弹窗 -->
    <n-modal v-model:show="aclShow" preset="card" style="width: 720px; max-width: 96vw" :title="aclEditing ? '编辑 ACL 规则' : '新增 ACL 规则'">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="24" responsive="screen" item-responsive :x-gap="12" :y-gap="10">
          <n-form-item-gi :span="'24 m:12'" label="规则名">
            <n-input v-model:value="aclForm.name" placeholder="例如 block-iot-to-wan" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="IP 族">
            <n-select
              v-model:value="aclForm.family"
              :options="[
                { label: 'IPv4 & IPv6', value: 'ipv4 ipv6' },
                { label: '仅 IPv4', value: 'ipv4' },
                { label: '仅 IPv6', value: 'ipv6' },
              ]"
            />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="源区域">
            <n-select v-model:value="aclForm.src" :options="aclZones.internals.map((x) => ({ label: x, value: x }))" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="目的区域">
            <n-select v-model:value="aclForm.dest" :options="aclZones.externals.map((x) => ({ label: x, value: x }))" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="源 IP / CIDR（一行一个，留空 = 任意）">
            <n-input v-model:value="aclForm.srcIpText" type="textarea" :rows="2" placeholder="192.168.10.0/24" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="目的 IP / CIDR（一行一个，留空 = 任意）">
            <n-input v-model:value="aclForm.destIpText" type="textarea" :rows="2" placeholder="8.8.8.8" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="协议">
            <n-select
              v-model:value="aclForm.proto"
              :options="[
                { label: 'TCP', value: 'tcp' },
                { label: 'UDP', value: 'udp' },
                { label: 'TCP+UDP', value: 'tcp udp' },
                { label: 'ICMP', value: 'icmp' },
              ]"
            />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="动作">
            <n-select
              v-model:value="aclForm.target"
              :options="[
                { label: 'ACCEPT（放行）', value: 'ACCEPT' },
                { label: 'DROP（拦截）', value: 'DROP' },
              ]"
            />
          </n-form-item-gi>
          <n-form-item-gi v-if="['tcp', 'udp', 'tcp udp'].includes(aclForm.proto)" :span="'24 m:12'" label="源端口（空 = 任意，可 80-90）">
            <n-input v-model:value="aclForm.src_port" placeholder="任意" />
          </n-form-item-gi>
          <n-form-item-gi v-if="['tcp', 'udp', 'tcp udp'].includes(aclForm.proto)" :span="'24 m:12'" label="目标端口（空 = 任意）">
            <n-input v-model:value="aclForm.dest_port" placeholder="任意" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="启用">
            <n-switch v-model:value="aclForm.enabled" />
          </n-form-item-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button @click="aclShow = false">取消</n-button>
          <n-button type="primary" :loading="aclSaving" @click="submitAcl">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 家长控制规则组弹窗 -->
    <n-modal v-model:show="grpShow" preset="card" style="width: 760px; max-width: 96vw" :title="grpEditing ? '编辑规则组' : '新建规则组'">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="24" responsive="screen" item-responsive :x-gap="12" :y-gap="10">
          <n-form-item-gi :span="'24 m:12'" label="组名">
            <n-input v-model:value="grpForm.name" placeholder="例如 孩子的设备" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:12'" label="启用">
            <n-switch v-model:value="grpForm.enabled" />
          </n-form-item-gi>
          <n-form-item-gi :span="24" label="管辖设备（MAC，可从终端列表选，也可手填）">
            <n-select v-model:value="grpForm.macs" multiple filterable tag :options="clientsOptions" placeholder="选择或输入 MAC" />
          </n-form-item-gi>
          <n-form-item-gi :span="24" label="内容分类拦截">
            <n-checkbox-group v-model:value="grpForm.category">
              <div class="cats">
                <n-checkbox v-for="c in PARENTAL_CATS" :key="c" :value="c" :label="catLabel(c)" />
              </div>
            </n-checkbox-group>
          </n-form-item-gi>
          <n-form-item-gi :span="24" label="指定应用（先加载应用库）">
            <div style="width: 100%">
              <n-button size="tiny" secondary style="margin-bottom: 6px" @click="ensureParentalApps">
                {{ appsLoaded ? `已加载 ${parentalApps.length} 个分类` : '加载应用库（parental-control.get_app_list）' }}
              </n-button>
              <n-select
                v-model:value="grpForm.apps"
                multiple
                filterable
                :options="appOptions"
                :max-tag-count="4"
                placeholder="选择要限制的应用"
                @update:show="(v: boolean) => v && ensureParentalApps()"
              />
              <n-input v-model:value="grpForm.appKeyword" size="tiny" placeholder="输入关键字过滤应用" style="margin-top: 6px" />
            </div>
          </n-form-item-gi>
          <n-form-item-gi :span="24" label="手动拦截域名（一行一个）">
            <n-input v-model:value="grpForm.blacklistText" type="textarea" :rows="2" placeholder="example.com" />
          </n-form-item-gi>

          <n-form-item-gi :span="'24 m:10'" label="时段限制">
            <n-switch v-model:value="grpForm.schedules_enabled" />
          </n-form-item-gi>
          <n-form-item-gi :span="'24 m:14'" label="日期模式">
            <n-select
              v-model:value="grpForm.schedules_days"
              :options="[
                { label: '每天同一时段', value: 'everyday' },
                { label: '按星期分别设置', value: 'customize' },
              ]"
            />
          </n-form-item-gi>

          <template v-if="grpForm.schedules_enabled && grpForm.schedules_days === 'everyday'">
            <n-form-item-gi :span="'24 m:12'" label="开始（断网）">
              <n-input v-model:value="grpForm.everydayBegin" placeholder="22:00" />
            </n-form-item-gi>
            <n-form-item-gi :span="'24 m:12'" label="结束（恢复）">
              <n-input v-model:value="grpForm.everydayEnd" placeholder="07:00" />
            </n-form-item-gi>
          </template>

          <template v-if="grpForm.schedules_enabled && grpForm.schedules_days === 'customize'">
            <n-form-item-gi :span="24" label="按星期时段">
              <div class="week-rows">
                <div v-for="(c, i) in grpForm.custom" :key="c.week" class="week-row">
                  <span class="nui-small" style="width: 60px">{{ ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i] }}</span>
                  <n-switch v-model:value="grpForm.custom[i].enabled" size="small" />
                  <n-input v-model:value="grpForm.custom[i].begin" size="small" style="width: 92px" placeholder="22:00" />
                  <span class="nui-small nui-muted">→</span>
                  <n-input v-model:value="grpForm.custom[i].end" size="small" style="width: 92px" placeholder="07:00" />
                </div>
              </div>
            </n-form-item-gi>
          </template>
        </n-grid>
      </n-form>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button @click="grpShow = false">取消</n-button>
          <n-button type="primary" :loading="grpSaving" @click="submitGroup">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.grp {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(128, 128, 128, 0.08);
  margin-bottom: 10px;
}
.grp-name {
  font-weight: 600;
  font-size: 14px;
}
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
}
.app-list {
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.06);
}
.week-rows {
  width: 100%;
}
.week-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
}
code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11.5px;
  opacity: 0.8;
}
.lnk {
  cursor: pointer;
  color: var(--nui-accent);
}
.lnk:hover {
  text-decoration: underline;
}
</style>
