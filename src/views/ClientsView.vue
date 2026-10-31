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
  NModal,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { PeopleOutline, RefreshOutline, SearchOutline } from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import { useAsync } from '@/composables/useAsync'
import { fmtBytes, fmtDuration, ifaceLabel, num, splitSpeed } from '@/utils/format'
import {
  addStaticBind,
  cleanTraffic,
  loadClientsPage,
  removeOfflineClient,
  removeSpeedLimit,
  removeStaticBind,
  renameClient,
  setAutoRemoveOffline,
  setClientBlock,
  setSpeedLimit,
  type AnyRec,
  type ClientsPage,
} from '@/api/core'

const message = useMessage()
const router = useRouter()

const cls = useAsync<ClientsPage>(loadClientsPage, { interval: 10000 })
const pageData = computed(() => cls.data.value)
const rows = computed(() => pageData.value?.clients ?? [])
const bwl = computed(() => pageData.value?.bwl ?? { mode: 'black' as const, black_mac: [], white_mac: [] })
const supportSpeed = computed(() => pageData.value?.supportSpeed ?? false)
const binds = computed(() => pageData.value?.binds ?? [])

const keyword = ref('')
const accessFilter = ref('all')
const onlineNow = computed(() => rows.value.filter((c) => c.online !== false))
const stats = computed(() => {
  const online = onlineNow.value
  const cable = online.filter((c) => /cable|eth|wired/i.test(String(c.iface ?? ''))).length
  const g24 = online.filter((c) => /^(2g|2\.4g)$/i.test(String(c.iface ?? ''))).length
  const g5 = online.filter((c) => /^5g$/i.test(String(c.iface ?? ''))).length
  return {
    online: online.length,
    total: rows.value.length,
    cable,
    wireless: online.length - cable,
    g24,
    g5,
    rx: online.reduce((a, c) => a + num(c.rx), 0),
    tx: online.reduce((a, c) => a + num(c.tx), 0),
  }
})

const accessOptions = [
  { label: '全部', value: 'all' },
  { label: '在线', value: 'online' },
  { label: '离线', value: 'offline' },
  { label: '有线', value: 'cable' },
  { label: '2.4 GHz', value: '2g' },
  { label: '5 GHz', value: '5g' },
]

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  const f = accessFilter.value
  return rows.value.filter((c) => {
    if (k) {
      const hay = [c.alias, c.name, c.mac, c.ip].map((v) => String(v ?? '').toLowerCase()).join(' ')
      if (!hay.includes(k)) return false
    }
    if (f === 'online') return c.online !== false
    if (f === 'offline') return c.online === false
    if (f === 'cable') return /cable|eth|wired/i.test(String(c.iface ?? ''))
    if (f === '2g') return /^(2g|2\.4g)$/i.test(String(c.iface ?? ''))
    if (f === '5g') return /^5g$/i.test(String(c.iface ?? ''))
    return true
  })
})

/* online_time 在本固件是「上线时刻」的时间戳（实测 ~1.79e9），并不是持续秒数；
   为避免算出超出开机时长的假数据，这里按绝对时间显示；若固件给的是秒数则按时长显示。 */
function onlineSince(c: AnyRec): string {
  const t = num(c.online_time)
  if (!t) return c.online === false ? '离线' : '—'
  if (t > 1_000_000_000) {
    const d = new Date(t * 1000)
    const p2 = (n: number) => String(n).padStart(2, '0')
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
  }
  return fmtDuration(t)
}

const bindMap = computed(() => {
  const map = new Map<string, { ip: string; tag: string }>()
  for (const b of binds.value) map.set(b.mac.toUpperCase(), { ip: b.ip, tag: b.tag ?? '' })
  return map
})
const isBound = (c: AnyRec) => bindMap.value.has(String(c.mac).toUpperCase())
function isBlocked(c: AnyRec): boolean {
  const mac = String(c.mac).toUpperCase()
  return bwl.value.mode === 'white' ? !bwl.value.white_mac.includes(mac) : bwl.value.black_mac.includes(mac)
}

/* ---------------- 弹窗：改名 / 绑定 / 限速 ---------------- */
const renameOpen = ref(false)
const renameForm = reactive({ mac: '', alias: '' })
function openRename(c: AnyRec) {
  renameForm.mac = String(c.mac)
  renameForm.alias = String(c.alias ?? c.name ?? '')
  renameOpen.value = true
}
const renaming = ref(false)
async function doRename() {
  renaming.value = true
  try {
    await renameClient(renameForm.mac, renameForm.alias.trim())
    message.success('设备名称已更新')
    renameOpen.value = false
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '改名失败')
  } finally {
    renaming.value = false
  }
}

const bindOpen = ref(false)
const bindForm = reactive({ mac: '', name: '', ip: '', hostname: '' })
function openBind(c: AnyRec) {
  bindForm.mac = String(c.mac)
  bindForm.name = String(c.alias || c.name || '')
  bindForm.ip = String(c.ip || '')
  bindForm.hostname = String(c.name || '')
  bindOpen.value = true
}
const binding = ref(false)
async function doBind() {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(bindForm.ip)) {
    message.warning('IP 地址格式不正确')
    return
  }
  binding.value = true
  try {
    await addStaticBind({ name: bindForm.name, mac: bindForm.mac, ip: bindForm.ip, hostname: bindForm.hostname })
    message.success('已绑定静态地址')
    bindOpen.value = false
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '绑定失败')
  } finally {
    binding.value = false
  }
}

const limitOpen = ref(false)
const limitForm = reactive({ mac: '', down: 0, up: 0, has: false })
function openLimit(c: AnyRec) {
  limitForm.mac = String(c.mac)
  // limit_rx/limit_tx 单位 MB/s（官方 set-speed 换算后的值），展示时换算为 Mbps
  limitForm.down = Math.round(num(c.limit_rx) * 8 * 10) / 10
  limitForm.up = Math.round(num(c.limit_tx) * 8 * 10) / 10
  limitForm.has = num(c.limit_rx) > 0 || num(c.limit_tx) > 0
  limitOpen.value = true
}
const limiting = ref(false)
async function doLimit() {
  limiting.value = true
  try {
    await setSpeedLimit(limitForm.mac, Number(limitForm.down), Number(limitForm.up))
    message.success('限速规则已保存')
    limitOpen.value = false
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    limiting.value = false
  }
}
async function doRemoveLimit() {
  limiting.value = true
  try {
    await removeSpeedLimit(limitForm.mac)
    message.success('已移除限速')
    limitOpen.value = false
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '移除失败')
  } finally {
    limiting.value = false
  }
}

/* ---------------- 行操作 ---------------- */
const acting = ref('')
async function toggleBlock(c: AnyRec) {
  const mac = String(c.mac)
  const blocked = isBlocked(c)
  acting.value = mac
  try {
    await setClientBlock(bwl.value.mode, !blocked, mac)
    message.success(blocked ? '已解除阻断' : '已阻断该设备')
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    acting.value = ''
  }
}

async function toggleBind(c: AnyRec) {
  const mac = String(c.mac).toUpperCase()
  if (isBound(c)) {
    acting.value = mac
    try {
      await removeStaticBind(mac)
      message.success('已取消静态绑定')
      await cls.reload(true)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败')
    } finally {
      acting.value = ''
    }
    return
  }
  openBind(c)
}

async function removeOffline(c: AnyRec) {
  acting.value = String(c.mac)
  try {
    await removeOfflineClient(String(c.mac))
    message.success('已从离线缓存移除')
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    acting.value = ''
  }
}

const autoRemove = ref(false)
const autoRemoveSaving = ref(false)
function syncAutoRemove() {
  if (pageData.value?.status) autoRemove.value = pageData.value.status.auto_remove_offline
  else autoRemove.value = false
}
onMounted(syncAutoRemove)
const clsWatch = computed(() => pageData.value?.status?.auto_remove_offline)
watch(clsWatch, (v) => {
  autoRemove.value = !!v
})
async function onAutoRemove(v: boolean) {
  autoRemoveSaving.value = true
  try {
    await setAutoRemoveOffline(v)
    message.success(v ? '已开启：离线终端自动从缓存移除' : '已关闭自动移除')
    await cls.reload(true)
  } catch (e) {
    autoRemove.value = !v
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    autoRemoveSaving.value = false
  }
}

const cleaning = ref(false)
async function doCleanTraffic() {
  cleaning.value = true
  try {
    await cleanTraffic()
    message.success('累计流量统计已清零')
    await cls.reload(true)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '清除失败')
  } finally {
    cleaning.value = false
  }
}

/* ---------------- 表格 ---------------- */
const columns: DataTableColumns<AnyRec> = [
  {
    title: '设备',
    key: 'name',
    minWidth: 190,
    sorter: (a, b) => String(a.alias || a.name || '').localeCompare(String(b.alias || b.name || ''), 'zh-CN'),
    render: (r) =>
      h('div', { style: 'display:flex;flex-direction:column;line-height:1.3;min-width:0' }, [
        h('span', { style: 'font-size:13px;font-weight:500', class: 'ellipsis' }, String(r.alias || r.name || '未知设备')),
        h('span', { class: 'nui-mono nui-muted', style: 'font-size:11px' }, String(r.mac)),
      ]),
  },
  {
    title: 'IP 地址',
    key: 'ip',
    width: 130,
    sorter: (a, b) => String(a.ip ?? '').localeCompare(String(b.ip ?? ''), undefined, { numeric: true }),
    render: (r) => h('span', { class: 'nui-mono' }, String(r.ip || '—')),
  },
  {
    title: '接入',
    key: 'iface',
    width: 88,
    render: (r) => h(NTag, { size: 'small', bordered: false, type: /cable|eth/i.test(String(r.iface)) ? 'info' : 'success' }, { default: () => ifaceLabel(String(r.iface ?? '')) }),
  },
  {
    title: '状态',
    key: 'online',
    width: 78,
    render: (r) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: r.online === false ? 'default' : isBlocked(r) ? 'error' : 'success' },
        { default: () => (r.online === false ? '离线' : isBlocked(r) ? '已阻断' : '在线') },
      ),
  },
  {
    title: '实时速率',
    key: 'rx',
    width: 112,
    sorter: (a, b) => num(a.rx) + num(a.tx) - (num(b.rx) + num(b.tx)),
    render: (r) => {
      const s = splitSpeed(num(r.rx) + num(r.tx))
      return h('span', { class: 'nui-mono' }, `${s.value} ${s.unit}`)
    },
  },
  {
    title: '累计流量',
    key: 'total_rx',
    width: 112,
    sorter: (a, b) => num(a.total_rx) + num(a.total_tx) - (num(b.total_rx) + num(b.total_tx)),
    render: (r) => h('span', { class: 'nui-mono nui-muted' }, fmtBytes(num(r.total_rx) + num(r.total_tx))),
  },
  {
    title: '上线时间',
    key: 'online_time',
    width: 110,
    sorter: (a, b) => num(a.online_time) - num(b.online_time),
    render: (r) => h('span', { class: 'nui-muted nui-mono' }, onlineSince(r)),
  },
  {
    title: '信号',
    key: 'signal',
    width: 80,
    render: (r) => h('span', { class: 'nui-mono' }, r.signal != null ? `${r.signal} dBm` : '—'),
  },
  {
    title: '操作',
    key: 'op',
    width: 236,
    render: (r) =>
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        h(
          NPopconfirm,
          { onPositiveClick: () => toggleBlock(r) },
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'tiny',
                  quaternary: true,
                  type: isBlocked(r) ? 'primary' : 'error',
                  loading: acting.value === String(r.mac),
                  disabled: r.online === false && !isBlocked(r),
                },
                { default: () => (isBlocked(r) ? '解阻断' : '阻断') },
              ),
            default: () => (isBlocked(r) ? '解除阻断后该设备重新可接入。确认？' : '阻断后该设备将无法连接 Wi-Fi（加入黑名单）。确认？'),
          },
        ),
        h(NButton, { size: 'tiny', quaternary: true, onClick: () => openRename(r) }, { default: () => '改名' }),
        h(
          NButton,
          { size: 'tiny', quaternary: true, type: isBound(r) ? 'primary' : 'default', onClick: () => toggleBind(r), loading: acting.value === String(r.mac).toUpperCase() },
          { default: () => (isBound(r) ? '解绑' : '绑定') },
        ),
        h(
          NButton,
          { size: 'tiny', quaternary: true, disabled: !supportSpeed || r.online === false, onClick: () => openLimit(r) },
          { default: () => '限速' },
        ),
        r.online === false
          ? h(NButton, { size: 'tiny', quaternary: true, type: 'error', onClick: () => removeOffline(r) }, { default: () => '移除' })
          : null,
      ]),
  },
]
</script>

<template>
  <div class="nui-page">
    <div class="nui-grid">
      <!-- 统计条 -->
      <PanelCard class="span-12" title="终端统计">
        <template #icon><n-icon><PeopleOutline /></n-icon></template>
        <template #extra>
          <div class="nui-row">
            <n-switch :value="autoRemove" size="small" :loading="autoRemoveSaving" @update:value="onAutoRemove">
              <template #checked>离线自动移除</template>
              <template #unchecked>离线自动移除</template>
            </n-switch>
            <n-button size="tiny" quaternary :loading="cls.loading.value" @click="cls.reload()">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新
            </n-button>
          </div>
        </template>
        <div class="stats">
          <div class="stat">
            <div class="stat-v">{{ stats.online }}<span class="nui-unit">台</span></div>
            <div class="stat-k">在线 / 共 {{ stats.total }} 台</div>
          </div>
          <div class="stat">
            <div class="stat-v">{{ stats.cable }}</div>
            <div class="stat-k">有线</div>
          </div>
          <div class="stat">
            <div class="stat-v">{{ stats.wireless }}</div>
            <div class="stat-k">无线</div>
          </div>
          <div class="stat">
            <div class="stat-v">{{ stats.g24 }}</div>
            <div class="stat-k">2.4 GHz</div>
          </div>
          <div class="stat">
            <div class="stat-v">{{ stats.g5 }}</div>
            <div class="stat-k">5 GHz</div>
          </div>
          <div class="stat">
            <div class="stat-v">
              {{ splitSpeed(stats.rx).value }}<span class="nui-unit">{{ splitSpeed(stats.rx).unit }}</span>
            </div>
            <div class="stat-k">实时下载</div>
          </div>
          <div class="stat">
            <div class="stat-v">
              {{ splitSpeed(stats.tx).value }}<span class="nui-unit">{{ splitSpeed(stats.tx).unit }}</span>
            </div>
            <div class="stat-k">实时上传</div>
          </div>
        </div>
      </PanelCard>

      <!-- 访问控制状态 -->
      <div class="span-12 alert-row">
        <NAlert type="info" :bordered="false">
          访问控制当前为
          <b>{{ bwl.mode === 'white' ? '白名单' : '黑名单' }}</b>
          （{{ bwl.mode === 'white' ? bwl.white_mac.length : bwl.black_mac.length }} 条）· 阻断/解阻断即维护该名单。
          <a class="link" @click="router.push('/wireless/acl')">管理黑白名单</a>
        </NAlert>
        <NAlert v-if="!supportSpeed" type="warning" :bordered="false">
          本机 QoS（qos_enabled=false）与 SQM（sqm_enabled=false）均未启用，限速接口不可用：
          请在「流控 → QoS」开启后再使用终端限速（官方客户端页同样会隐藏该入口）。
        </NAlert>
      </div>

      <!-- 终端列表 -->
      <PanelCard class="span-12" title="终端设备" flush>
        <template #icon><n-icon><PeopleOutline /></n-icon></template>
        <template #extra>
          <div class="nui-row" style="gap: 8px">
            <n-input v-model:value="keyword" size="small" placeholder="搜索名称 / IP / MAC" clearable style="width: 200px">
              <template #prefix><n-icon><SearchOutline /></n-icon></template>
            </n-input>
            <n-select v-model:value="accessFilter" size="small" :options="accessOptions" style="width: 120px" />
            <n-popconfirm @positive-click="doCleanTraffic">
              <template #trigger>
                <n-button size="small" secondary :loading="cleaning">清除流量统计</n-button>
              </template>
              将把所有终端累计流量清零（不可恢复）。确认？
            </n-popconfirm>
          </div>
        </template>

        <PageState :loading="cls.loading.value" :error="cls.error.value" :empty="!pageData" empty-text="clients.get_list 不可用" @retry="cls.reload()">
          <n-data-table
            :columns="columns"
            :data="filtered"
            :bordered="false"
            :single-line="false"
            size="small"
            :row-key="(r: AnyRec) => r.mac"
            :scroll-x="1180"
            :pagination="{ pageSize: 20, showSizePicker: false }"
          />
          <p class="nui-small nui-muted" style="margin: 10px 0 4px">
            数据源：clients.get_list（每 10s 轮询）+ clients.get_status + lan.get_static_bind_list + black_white_list.get_config。
            无线信号强度（signal）官方通过 WebSocket 推送，本后台未接 WS，因此该列多为「—」；设备名可用「改名」写入 clients.set_info。
          </p>
          <p v-if="(pageData?.errors ?? []).length" class="nui-small" style="margin: 4px 0 0; color: var(--warn)">
            {{ (pageData?.errors ?? []).join('；') }}
          </p>
        </PageState>
      </PanelCard>
    </div>

    <!-- 改名 -->
    <NModal v-model:show="renameOpen" preset="card" title="修改设备名称" style="max-width: 420px">
      <div class="nui-small nui-muted" style="margin-bottom: 8px">
        MAC <span class="nui-mono">{{ renameForm.mac }}</span> · 写入 clients.set_info（alias）
      </div>
      <n-input v-model:value="renameForm.alias" placeholder="设备别名，留空恢复主机名" maxlength="32" />
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button size="small" @click="renameOpen = false">取消</n-button>
          <n-button size="small" type="primary" :loading="renaming" @click="doRename">保存</n-button>
        </div>
      </template>
    </NModal>

    <!-- 绑定静态地址 -->
    <NModal v-model:show="bindOpen" preset="card" title="绑定静态地址" style="max-width: 440px">
      <div class="nui-small nui-muted" style="margin-bottom: 8px">
        MAC <span class="nui-mono">{{ bindForm.mac }}</span> · 写入 lan.add_static_bind（DHCP 固定租约）
      </div>
      <div class="dialog-form">
        <div class="frow"><span class="flabel">名称</span><n-input v-model:value="bindForm.name" size="small" placeholder="设备别名" /></div>
        <div class="frow"><span class="flabel">IP 地址</span><n-input v-model:value="bindForm.ip" size="small" placeholder="192.168.8.x" /></div>
      </div>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button size="small" @click="bindOpen = false">取消</n-button>
          <n-button size="small" type="primary" :loading="binding" @click="doBind">绑定</n-button>
        </div>
      </template>
    </NModal>

    <!-- 限速 -->
    <NModal v-model:show="limitOpen" preset="card" title="终端限速" style="max-width: 440px">
      <div class="nui-small nui-muted" style="margin-bottom: 8px">
        MAC <span class="nui-mono">{{ limitForm.mac }}</span> · 写入 qos.set_speed_limit_rule（单位 Mbps，提交时按官方约定换算 MB/s）
      </div>
      <div class="dialog-form">
        <div class="frow"><span class="flabel">下载 (Mbps)</span><n-input-number v-model:value="limitForm.down" size="small" :min="0" :max="10000" /></div>
        <div class="frow"><span class="flabel">上传 (Mbps)</span><n-input-number v-model:value="limitForm.up" size="small" :min="0" :max="10000" /></div>
      </div>
      <p class="nui-small nui-muted" style="margin: 6px 0 0">
        填 0 表示不限。值按官方换算约定（提交 MB/s、界面 Mbps）展示；本机 QoS 未启用，无法回读校准单位。
      </p>
      <template #footer>
        <div class="nui-row" style="justify-content: flex-end">
          <n-button v-if="limitForm.has" size="small" secondary type="warning" :loading="limiting" @click="doRemoveLimit">移除限速</n-button>
          <n-button size="small" @click="limitOpen = false">取消</n-button>
          <n-button size="small" type="primary" :loading="limiting" @click="doLimit">保存</n-button>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 12px;
}
.stat {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.08);
}
.stat-v {
  font-size: 22px;
  font-weight: 650;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.stat-k {
  font-size: 11.5px;
  opacity: 0.6;
  margin-top: 2px;
}
.alert-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.link {
  color: var(--nui-accent);
  cursor: pointer;
  border-bottom: 1px dashed rgba(32, 128, 240, 0.5);
}
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.frow {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.flabel {
  font-size: 12.5px;
  opacity: 0.62;
}
@media (max-width: 1100px) {
  .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
