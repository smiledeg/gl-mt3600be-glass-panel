<script setup lang="ts">
/**
 * 应用（3 个 section）：store / nas / adguard
 *
 * 数据来源：
 *  - 插件/软件源：官方 `plugins.get_config / get_repository_status / get_list`（get_list 必须带 {limit,page,status}）
 *  - 网络存储：`nas-web.*`（本机 software_feature.ksmbd=false，对象名动态选择）
 *  - AdGuard Home：`adguardhome.get_config / set_config`
 * 危险操作（安装/卸载软件包、磁盘格式化/弹出）一律不做，给官方入口与 opkg 命令提示。
 */
import { computed, h, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NDataTable,
  NIcon,
  NInput,
  NPopconfirm,
  NProgress,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  AppsOutline,
  CloudDownloadOutline,
  FolderOpenOutline,
  InformationCircleOutline,
  RefreshOutline,
  SaveOutline,
  ServerOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import { useAsync, shortError } from '@/composables/useAsync'
import * as sys from '@/api/sys'
import { installIpk, pkgApps, pkgInstallStatus, pkgList, pkgManager, uploadIpk } from '@/api/pkg'
import { fmtAgo, fmtBytes, pct } from '@/utils/format'

const props = defineProps<{ section?: string }>()
const section = computed(() => props.section || 'store')
const message = useMessage()
const errText = (e: unknown) => shortError(e) || '操作失败'

/* 设备能力位（三页共用，进页面读一次） */
const INFO_A = useAsync(() => sys.getSystemInfo(), { immediate: true })
const { data: sysInfo, reload: reloadInfo } = INFO_A
const feature = computed(() => sysInfo.value?.software_feature ?? {})
const board = computed(() => sysInfo.value?.board_info ?? {})

/* ======================================================================
 * store —— 插件 / 软件源
 * ==================================================================== */
const STORE_A = useAsync(
  async () => ({
    cfg: await sys.getPluginsConfig().catch(() => null),
    repo: await sys.getRepoStatus().catch(() => null),
    list: await sys.getPluginList({ limit: 200, page: 1, status: 1 }).catch(() => null),
    mgr: await pkgManager(),
    pkgs: await pkgList(),
  }),
  { immediate: false },
)
const { data: storeData, loading: storeLoading, error: storeError, reload: reloadStore } = STORE_A
const sources = computed(() => storeData.value?.cfg?.source ?? [])
const repo = computed(() => storeData.value?.repo ?? null)
const pkgMgr = computed(() => storeData.value?.mgr ?? 'opkg')
const installed = computed(() => {
  const off = storeData.value?.list?.packages ?? []
  return off.length ? off : storeData.value?.pkgs ?? []
})
const search = ref('')
const installedRows = computed(() =>
  installed.value
    .map((p) => ({ name: String(p.name ?? '—'), version: String(p.version ?? '—') }))
    .filter((p) => !search.value.trim() || p.name.toLowerCase().includes(search.value.trim().toLowerCase())),
)
const installedColumns: DataTableColumns<{ name: string; version: string }> = [
  { title: '软件包', key: 'name', ellipsis: { tooltip: true } },
  { title: '版本', key: 'version', width: 220, ellipsis: { tooltip: true } },
]
const sourceColumns: DataTableColumns<{ name: string; url: string; system: boolean }> = [
  { title: '名称', key: 'name', width: 180 },
  { title: '地址', key: 'url', ellipsis: { tooltip: true } },
  {
    title: '类型',
    key: 'system',
    width: 90,
    align: 'center',
    render: (r) => h(NTag, { size: 'small', bordered: false, type: r.system ? 'info' : 'default' }, { default: () => (r.system ? '系统源' : '自定义') }),
  },
]
const sourceRowKey = (r: { name: string }) => r.name
const repoBusy = ref(false)
async function refreshRepo() {
  repoBusy.value = true
  try {
    await sys.updateRepository()
    await reloadStore(true)
    message.success('软件源已刷新')
  } catch (e) {
    message.error(`刷新失败：${errText(e)}`)
  } finally {
    repoBusy.value = false
  }
}
const lastUpdateText = computed(() => {
  const t = Number(repo.value?.time_last_update ?? 0)
  return t ? fmtAgo(t * 1000) : '从未刷新'
})

/* ---- 手动安装插件包（ipk） ---- */
const ipkFile = ref<HTMLInputElement | null>(null)
const ipkBusy = ref(false)
const ipkPct = ref(0)
const ipkLog = ref('')
const ipkDone = ref(false)
const ipkOk = ref(false)
function pickIpk() {
  ipkFile.value?.click()
}
async function onIpkFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  const ext = pkgMgr.value === 'apk' ? '.apk' : '.ipk'
  if (!new RegExp(ext.replace('.', '\\.') + '$', 'i').test(f.name)) {
    message.warning(pkgMgr.value === 'apk' ? '请选择 .apk 安装包（OpenWrt 25.12/apk）' : '请选择 .ipk 安装包（OpenWrt 21.02/opkg）')
    return
  }
  ipkBusy.value = true
  ipkPct.value = 0
  ipkLog.value = ''
  ipkDone.value = false
  ipkOk.value = false
  try {
    const id = await uploadIpk(f, (p) => (ipkPct.value = p))
    const r = await installIpk(id)
    if (!r.ok) throw new Error(r.err || '安装启动失败')
    let st: { log: string; done: boolean; code: number | null } | null = null
    for (let i = 0; i < 180; i++) {
      await new Promise((res) => setTimeout(res, 1000))
      st = await pkgInstallStatus(id)
      if (st.log) ipkLog.value = st.log
      if (st.done) break
    }
    ipkDone.value = true
    if (st && st.code === 0) {
      ipkOk.value = true
      message.success('插件安装成功')
      await pkgApps()
      window.dispatchEvent(new Event('glass-pkg-changed'))
      await reloadStore(true)
    } else {
      message.error('安装失败，请查看日志')
    }
  } catch (err) {
    ipkLog.value += `\n${errText(err)}`
    message.error(`安装失败：${errText(err)}`)
  } finally {
    ipkBusy.value = false
  }
}
const PKG_HINTS = computed(() =>
  pkgMgr.value === 'apk'
    ? ['apk update', 'apk info', 'apk add --allow-untrusted --force-non-repository /tmp/luci-app-xxx.apk', 'apk del luci-app-xxx']
    : ['opkg update', 'opkg list-installed | grep -i nui', 'opkg install /tmp/luci-app-xxx.ipk', 'opkg remove luci-app-xxx'],
)

/* ======================================================================
 * nas —— 网络存储
 * ==================================================================== */
const NAS_A = useAsync(
  async () => ({
    status: await sys.getNasStatus(),
    disks: await sys.getNasDiskList(),
    protos: await sys.getNasProtos(),
    wan: await sys.getNasWanAccess(),
  }),
  { immediate: false },
)
const { data: nasData, loading: nasLoading, error: nasError, reload: reloadNas } = NAS_A
const nasObjName = computed(() => (feature.value.ksmbd ? 'ksmbd' : 'nas-web'))
const nasEnabled = computed(() => Number(nasData.value?.status?.enable ?? 0) === 1)
const diskRows = computed(() => {
  const out: { key: string; label: string; dev: string; fs: string; totalMb: number; freeMb: number; usedPct: number }[] = []
  const disks = nasData.value?.disks?.disk ?? []
  disks.forEach((d, i) => {
    for (const p of d.part ?? []) {
      const total = Number(p.total_len ?? 0)
      const free = Number(p.free_size ?? 0)
      out.push({
        key: String(p.uid ?? `${i}-${p.dev_name ?? out.length}`),
        label: String(p.label ?? p.disk_name ?? '—'),
        dev: String(p.dev_name ?? '—'),
        fs: String(p.fs_type ?? '—'),
        totalMb: total,
        freeMb: free,
        usedPct: total > 0 ? pct(total - free, total) : 0,
      })
    }
  })
  return out
})
const diskColumns: DataTableColumns<{ key: string; label: string; dev: string; fs: string; totalMb: number; freeMb: number; usedPct: number }> = [
  { title: '分区', key: 'label', width: 150 },
  { title: '设备', key: 'dev', width: 110 },
  { title: '文件系统', key: 'fs', width: 110 },
  {
    title: '可用 / 容量',
    key: 'totalMb',
    width: 170,
    render: (r) => h('span', { class: 'nui-mono' }, `${fmtBytes(r.freeMb * 1048576, 0)} / ${fmtBytes(r.totalMb * 1048576, 0)}`),
  },
  {
    title: '使用率',
    key: 'usedPct',
    width: 180,
    render: (r) =>
      h(NProgress, {
        type: 'line',
        percentage: r.usedPct,
        height: 8,
        showIndicator: false,
        status: r.usedPct > 90 ? 'error' : r.usedPct > 75 ? 'warning' : 'success',
      }),
  },
]
const diskRowKey = (r: { key: string }) => r.key
const protos = computed(() => nasData.value?.protos ?? [])
const wanAccess = computed(() => {
  const v = nasData.value?.wan?.enable
  if (v === undefined || v === null) return '—'
  return String(v) === 'open' ? '允许 WAN 访问' : '仅局域网'
})
const nasBusy = ref(false)
async function startNas() {
  nasBusy.value = true
  try {
    await sys.startNas()
    await reloadNas(true)
    message.success('NAS 服务已启动')
  } catch (e) {
    message.error(`启动失败：${errText(e)}`)
  } finally {
    nasBusy.value = false
  }
}

/* ======================================================================
 * adguard —— AdGuard Home
 * ==================================================================== */
const AGH_A = useAsync(
  async () => ({ cfg: await sys.getAdguard(), status: await sys.getSystemStatus().catch(() => null) }),
  { immediate: false },
)
const { data: aghData, loading: aghLoading, error: aghError, reload: reloadAgh } = AGH_A
const agForm = reactive({ enabled: false, dns_enabled: false })
watch(
  () => aghData.value?.cfg,
  (c) => {
    if (!c) return
    agForm.enabled = !!c.enabled
    agForm.dns_enabled = !!c.dns_enabled
  },
)
const aghService = computed(() => (aghData.value?.status?.service ?? []).find((s) => s.name === 'adguard') ?? null)
const aghRunning = computed(() => Number(aghService.value?.status ?? 0) === 1)
const adguardSupported = computed(() => feature.value.adguard === true)
const aghUrl = computed(() => `http://${location.hostname || '192.168.8.1'}:3000/`)
const aghBusy = ref(false)
async function saveAgh() {
  aghBusy.value = true
  try {
    await sys.setAdguard({ enabled: agForm.enabled, dns_enabled: agForm.dns_enabled })
    await reloadAgh(true)
    message.success('AdGuard Home 设置已保存（DNS 接管生效可能需要约 10 秒）')
  } catch (e) {
    message.error(`保存失败：${errText(e)}`)
  } finally {
    aghBusy.value = false
  }
}

/* ======================================================================
 * 激活
 * ==================================================================== */
const reloaders: Record<string, () => void> = {
  store: () => reloadStore(),
  nas: () => reloadNas(),
  adguard: () => reloadAgh(),
}
watch(
  section,
  (s) => {
    const fn = reloaders[s]
    if (fn) fn()
    if (!sysInfo.value) void reloadInfo()
  },
  { immediate: true },
)
</script>

<template>
  <div class="nui-page">
    <!-- ================= store ================= -->
    <template v-if="section === 'store'">
      <div class="nui-grid">
        <PanelCard class="span-8" title="软件源">
          <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-popconfirm v-if="pkgMgr === 'opkg'" @positive-click="refreshRepo">
                <template #trigger>
                  <n-button size="small" secondary :loading="repoBusy">
                    <template #icon><n-icon><RefreshOutline /></n-icon></template>
                    刷新软件源
                  </n-button>
                </template>
                将执行官方 plugins.update_repository（内部 opkg update，需要外网，可能 1-3 分钟）。继续？
              </n-popconfirm>
              <n-button size="small" quaternary tag="a" href="/gl_home.html?official=1#/plugins" target="_blank">官方插件页</n-button>
            </div>
          </template>
          <PageState :loading="storeLoading" :error="storeError" :empty="!storeData" empty-text="插件接口不可用" @retry="reloadStore">
            <n-data-table :columns="sourceColumns" :data="sources" :row-key="sourceRowKey" size="small" :bordered="false" />
            <p class="nui-small nui-muted" style="margin: 10px 0 0">
              软件源由官方 plugins.get_config 提供；系统源自带且不可删，自定义源可在官方插件页添加。
            </p>
          </PageState>
        </PanelCard>

        <PanelCard class="span-4" title="仓库状态">
          <template #icon><n-icon><ServerOutline /></n-icon></template>
          <template #extra>
            <n-tag size="small" :bordered="false" :type="Number(repo?.status ?? 0) === 0 ? 'success' : 'warning'">
              {{ Number(repo?.status ?? 0) === 0 ? '就绪' : `状态 ${repo?.status}` }}
            </n-tag>
          </template>
          <dl class="nui-kv">
            <dt>已安装</dt>
            <dd>{{ repo?.count_installed ?? '—' }}</dd>
            <dt>全部软件包</dt>
            <dd>{{ repo?.count_all ?? '—' }}</dd>
            <dt>可更新</dt>
            <dd>{{ repo?.count_updatable ?? '—' }}</dd>
            <dt>未安装</dt>
            <dd>{{ repo?.count_not_installed ?? '—' }}</dd>
            <dt>上次刷新</dt>
            <dd>{{ lastUpdateText }}</dd>
          </dl>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">数据来自官方 plugins.get_repository_status。</p>
        </PanelCard>

        <PanelCard class="span-12" title="手动安装插件包">
          <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
          <template #extra>
            <n-button size="small" type="primary" secondary :loading="ipkBusy" @click="pickIpk">选择 {{ pkgMgr === 'apk' ? 'apk' : 'ipk' }} 安装</n-button>
            <input ref="ipkFile" type="file" :accept="pkgMgr === 'apk' ? '.apk' : '.ipk'" style="display: none" @change="onIpkFile" />
          </template>
          <p class="nui-small nui-muted" style="margin: 0 0 10px">
            选择当前设备的 {{ pkgMgr === 'apk' ? '.apk（OpenWrt 25.12 / apk）' : '.ipk（OpenWrt 21.02 / opkg）' }} 插件包。安装完成后，
            LuCI 插件会自动出现在左侧「应用」菜单里，点击即可打开。
          </p>
          <n-progress v-if="ipkBusy || ipkPct" :percentage="ipkPct" :status="ipkBusy ? 'info' : ipkOk ? 'success' : ipkDone ? 'error' : 'default'" style="margin-bottom: 10px" />
          <pre v-if="ipkLog" class="ipk-log">{{ ipkLog }}</pre>
          <div class="nui-row nui-wrap" style="gap: 8px; margin-top: 10px">
            <n-button size="small" quaternary tag="a" href="/gl_home.html?official=1#/plugins" target="_blank">官方插件页</n-button>
          </div>
        </PanelCard>

        <PanelCard class="span-12" title="已安装软件包" flush>
          <template #icon><n-icon><AppsOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <n-input v-model:value="search" size="small" placeholder="按包名过滤" clearable style="width: 200px" />
              <n-button size="small" secondary :loading="storeLoading" @click="reloadStore(true)">刷新</n-button>
            </div>
          </template>
          <PageState
            :loading="storeLoading"
            :error="storeError"
            :empty="!installed.length"
            :empty-text="repo?.count_installed ? '已安装包列表为空（官方 get_list 需要刷新软件源后才有索引）' : '暂无已安装包数据'"
            @retry="reloadStore"
          >
            <div class="nui-small nui-muted" style="padding: 4px 10px 8px">
              显示已安装包 {{ installed.length }} 个<span v-if="repo?.count_installed && Number(repo.count_installed) > installed.length">（共 {{ repo.count_installed }}，列表只取前 200）</span>
              <span v-if="search.trim()"> · 过滤后 {{ installedRows.length }} 个</span>
            </div>
            <n-data-table :columns="installedColumns" :data="installedRows" size="small" :bordered="false" :max-height="380" virtual-scroll />
          </PageState>
          <n-alert type="info" :bordered="false" style="margin: 10px 6px 0">
            手动安装仅接受 {{ pkgMgr === 'apk' ? '.apk' : '.ipk' }}；请确认架构匹配，误装/误删系统包可能导致设备失联。也可用 SSH 执行下面的命令。
          </n-alert>
        </PanelCard>

        <PanelCard class="span-6" :title="`${pkgMgr} 命令提示`">
          <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
          <pre class="cmd">{{ PKG_HINTS.join('\n') }}</pre>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            安装前先确认包架构与当前固件匹配；apk 与 ipk 不能混用。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="设备信息">
          <template #icon><n-icon><InformationCircleOutline /></n-icon></template>
          <dl class="nui-kv">
            <dt>型号</dt>
            <dd>{{ String(board.model ?? '—') }}</dd>
            <dt>固件</dt>
            <dd>{{ sysInfo?.firmware_version ?? '—' }}</dd>
            <dt>OpenWrt</dt>
            <dd>{{ String(board.openwrt_version ?? '—').trim() }}</dd>
            <dt>内核</dt>
            <dd>{{ board.kernel_version ?? '—' }}</dd>
            <dt>架构</dt>
            <dd>{{ board.architecture ?? '—' }}</dd>
          </dl>
        </PanelCard>
      </div>
    </template>

    <!-- ================= nas ================= -->
    <template v-if="section === 'nas'">
      <div class="nui-grid">
        <PanelCard class="span-4" title="NAS 服务">
          <template #icon><n-icon><ServerOutline /></n-icon></template>
          <template #extra>
            <n-tag size="small" :bordered="false" :type="nasEnabled ? 'success' : 'default'">{{ nasEnabled ? '已启用' : '未启用' }}</n-tag>
          </template>
          <dl class="nui-kv">
            <dt>RPC 对象</dt>
            <dd class="nui-mono nui-small">{{ nasObjName }}</dd>
            <dt>NAS 能力位</dt>
            <dd>{{ feature.nas ? '支持' : '不支持' }}</dd>
            <dt>WAN 访问</dt>
            <dd>{{ wanAccess }}</dd>
            <dt>磁盘数量</dt>
            <dd>{{ nasData?.disks?.disk_number ?? diskRows.length }}</dd>
          </dl>
          <n-popconfirm v-if="!nasEnabled" @positive-click="startNas">
            <template #trigger>
              <n-button size="small" type="primary" :loading="nasBusy" style="margin-top: 14px">启用 NAS 服务</n-button>
            </template>
            将启动 samba / webdav 等共享服务（官方 nas-web.start）。继续？
          </n-popconfirm>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            本机 {{ feature.ksmbd ? '使用 ksmbd' : '未启用 ksmbd，使用 nas-web' }}；启用后共享协议配置才可读。
          </p>
        </PanelCard>

        <PanelCard class="span-8" title="共享协议" flush>
          <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
          <template #extra>
            <n-button size="small" quaternary tag="a" href="/gl_home.html#/nasview" target="_blank">官方网络存储页</n-button>
          </template>
          <PageState
            :loading="nasLoading"
            :error="nasError"
            :empty="!protos.length"
            :empty-text="nasEnabled ? '协议配置读取失败（官方接口返回 Unknown）' : 'NAS 服务未启用，协议配置不可读；请先启用 NAS 或到官方页面查看'"
            @retry="reloadNas"
          >
            <div v-for="p in protos" :key="String(p.name)" class="proto-row">
              <div style="flex: 1">
                <b>{{ p.name === 'samba' ? 'Samba（SMB/CIFS）' : p.name === 'webdav' ? 'WebDAV' : p.name }}</b>
                <div class="nui-small nui-muted">端口 {{ p.port || '默认' }} · WAN 访问 {{ p.wan_access ? '允许' : '禁止' }}</div>
              </div>
              <n-tag size="small" :bordered="false" :type="p.enable ? 'success' : 'default'">{{ p.enable ? '开启' : '关闭' }}</n-tag>
            </div>
            <n-alert type="info" :bordered="false" style="margin: 10px 6px 0">
              协议开关的写入参数官方视图未暴露可验证的结构（set_proto_config 需要整包 res 数组），为避免写坏共享配置，
              本面板只做只读展示；需要改共享协议/用户/文件夹请到官方「网络存储」页。
            </n-alert>
          </PageState>
        </PanelCard>

        <PanelCard class="span-12" title="磁盘与分区" flush>
          <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
          <template #extra>
            <n-button size="small" secondary :loading="nasLoading" @click="reloadNas(true)">刷新</n-button>
          </template>
          <PageState
            :loading="nasLoading"
            :error="nasError"
            :empty="!diskRows.length"
            empty-text="没有检测到磁盘（U 盘未插入或未识别）"
            @retry="reloadNas"
          >
            <n-data-table :columns="diskColumns" :data="diskRows" :row-key="diskRowKey" size="small" :bordered="false" :scroll-x="760" />
            <p class="nui-small nui-muted" style="margin: 10px 0 6px">
              容量单位换算自官方返回的 MB。磁盘的格式化/弹出属危险操作，本面板只读；需要时在官方网络存储页操作。
            </p>
          </PageState>
        </PanelCard>
      </div>
    </template>

    <!-- ================= adguard ================= -->
    <template v-if="section === 'adguard'">
      <PageState :loading="aghLoading" :error="aghError" :empty="!aghData" empty-text="AdGuard Home 接口不可用" @retry="reloadAgh">
        <div class="nui-grid">
          <PanelCard class="span-6" title="AdGuard Home">
            <template #icon><n-icon><ShieldCheckmarkOutline /></n-icon></template>
            <template #extra>
              <n-tag size="small" :bordered="false" :type="agForm.enabled ? 'success' : 'default'">
                {{ agForm.enabled ? '已启用' : '未启用' }}
              </n-tag>
            </template>
            <n-alert v-if="!adguardSupported" type="warning" :bordered="false" style="margin-bottom: 12px">
              当前固件的软件能力位里没有 AdGuard（software_feature.adguard=false），接口可能不可用。
            </n-alert>
            <div class="nui-row" style="margin-bottom: 14px">
              <span style="flex: 1">
                <b class="nui-small">启用 AdGuard Home</b>
                <div class="nui-small nui-muted">广告过滤 / DNS 安全解析服务</div>
              </span>
              <n-switch v-model:value="agForm.enabled" />
            </div>
            <div class="nui-row" style="margin-bottom: 14px">
              <span style="flex: 1">
                <b class="nui-small">DNS 接管</b>
                <div class="nui-small nui-muted">把局域网 DNS 请求重定向到 AdGuard（端口 3053）</div>
              </span>
              <n-switch v-model:value="agForm.dns_enabled" />
            </div>
            <n-button size="small" type="primary" :loading="aghBusy" @click="saveAgh">
              <template #icon><n-icon><SaveOutline /></n-icon></template>
              保存
            </n-button>
            <dl class="nui-kv" style="margin-top: 14px">
              <dt>服务运行状态</dt>
              <dd>{{ aghService ? (aghRunning ? '运行中' : '未运行') : '—' }}</dd>
              <dt>DNS 上游端口</dt>
              <dd>3053（config.yaml）</dd>
            </dl>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              读写使用官方 adguardhome.get_config / set_config；启停后设备会重载 DNS 重定向，生效约 10 秒。
            </p>
          </PanelCard>

          <PanelCard class="span-6" title="管理面板入口">
            <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
            <p class="nui-small nui-muted" style="margin: 0 0 12px">
              AdGuard Home 自带 Web 管理面板（设备侧 /etc/AdGuardHome/config.yaml 的 bind_port=3000）。
              只有启用后该端口才会监听。
            </p>
            <div class="nui-row nui-wrap">
              <n-button size="small" type="primary" secondary tag="a" :href="aghUrl" target="_blank">打开 AdGuard 面板（:3000）</n-button>
              <n-button size="small" quaternary tag="a" href="/gl_home.html#/adguardhome" target="_blank">官方 AdGuard 页</n-button>
            </div>
            <n-alert type="info" :bordered="false" style="margin-top: 14px">
              若 :3000 打不开：确认已启用 AdGuard，且本机没有改过面板端口；也可以在官方后台的 AdGuard 卡片里点「打开管理页面」。
            </n-alert>
            <p class="nui-small nui-muted" style="margin: 12px 0 0">
              过滤规则、上游 DNS、查询日志等都在 AdGuard 自己的面板里配置，本面板不重复实现。
            </p>
          </PanelCard>
        </div>
      </PageState>
    </template>
  </div>
</template>

<style scoped>
.proto-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-top: 1px dashed var(--line-dash);
}
.proto-row:first-of-type {
  border-top: none;
}
.cmd {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.ipk-log {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11.5px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
}
</style>
