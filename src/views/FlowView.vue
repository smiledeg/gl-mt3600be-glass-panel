<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDataTable,
  NForm,
  NFormItemGi,
  NGrid,
  NIcon,
  NInput,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { BarChartOutline, PulseOutline, SpeedometerOutline, SwapHorizontalOutline } from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import Sparkline from '@/components/Sparkline.vue'
import { useAsync } from '@/composables/useAsync'
import * as net from '@/api/net'
import { fmtBytes, fmtSpeed } from '@/utils/format'

const props = defineProps<{ section?: string }>()
const section = computed(() => String(props.section || 'stats'))
const message = useMessage()
const router = useRouter()

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
  video: '视频',
  download: '下载',
}
const catLabel = (k: string) => CATEGORY_LABEL[k] ?? k

/* ================= 流量统计 ================= */
const flowRule = ref<net.FlowRule>({ enable: false, type: 'app', time: 'day' })
const flowRows = ref<net.FlowRow[]>([])
const topFlow = ref<net.FlowTop>({ max_bytes: 0, top_apps: [] })
const flags = ref<net.SysFlags | null>(null)
const rate = ref<net.RateHistory | null>(null)
const ruleBusy = ref(false)
const clearBusy = ref(false)

async function loadStats() {
  flags.value = await softLoad(() => net.getSystemFlags(), null, '全局功能开关（system.get_status）')
  flowRule.value = await net.getFlowRule()
  flowRows.value = await net.getFlowStats()
  topFlow.value = await softLoad(() => net.getTopAppFlow(), { max_bytes: 0, top_apps: [] }, 'Top 应用（flow_statistics.get_top_app_flow_statistics）')
  rate.value = await softLoad(() => net.getRateHistory(), null, '实时速率历史（插件桥 sys.rate_history）')
  return true
}

const flowEnabled = computed(() => !!flowRule.value.enable)
const flowEmpty = computed(() => !flowRows.value.length)

const totalBytes = computed(() => flowRows.value.reduce((a, x) => a + (x.total || 0), 0))
const totalUp = computed(() => flowRows.value.reduce((a, x) => a + (x.upload || 0), 0))
const totalDown = computed(() => flowRows.value.reduce((a, x) => a + (x.download || 0), 0))

function pctOf(v: number): number {
  if (!totalBytes.value) return 0
  return Math.max(1, Math.round((v / totalBytes.value) * 100))
}

async function saveRule(patch: Partial<net.FlowRule>) {
  ruleBusy.value = true
  try {
    const next: net.FlowRule = { ...flowRule.value, ...patch }
    await net.saveFlowRule(next)
    const after = await net.getFlowRule()
    if (!!after.enable !== !!next.enable) throw new Error('回读开关与提交不一致，固件可能拒绝了本次修改')
    flowRule.value = after
    message.success('统计规则已保存并回读确认')
    await loadStats()
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    ruleBusy.value = false
  }
}

async function clearStats() {
  clearBusy.value = true
  try {
    await net.clearFlowStats()
    flowRows.value = await net.getFlowStats()
    message.success('统计数据已清空')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    clearBusy.value = false
  }
}

const flowCols = computed<DataTableColumns<net.FlowRow>>(() => [
  { title: '应用', key: 'application_name', render: (r) => r.application_name || '未知' },
  { title: '下载', key: 'download', width: 110, render: (r) => h('span', { class: 'nui-mono' }, fmtBytes(r.download)) },
  { title: '上传', key: 'upload', width: 110, render: (r) => h('span', { class: 'nui-mono' }, fmtBytes(r.upload)) },
  { title: '合计', key: 'total', width: 110, render: (r) => h('span', { class: 'nui-mono' }, fmtBytes(r.total)) },
  {
    title: '占比',
    key: 'pct',
    width: 150,
    render: (r) =>
      h('div', { class: 'bar' }, [
        h('i', { style: { width: `${pctOf(r.total)}%` } }),
        h('span', { class: 'nui-small nui-muted' }, `${pctOf(r.total)}%`),
      ]),
  },
])

const topCols = computed<DataTableColumns<net.FlowRow>>(() => [
  { title: '应用', key: 'application_name', render: (r) => r.application_name || '未知' },
  {
    title: '流量',
    key: 'total',
    render: (r) =>
      h('div', { class: 'bar' }, [
        h('i', {
          style: { width: `${topFlow.value.max_bytes ? Math.max(2, Math.round((r.total / topFlow.value.max_bytes) * 100)) : 0}%` },
        }),
        h('span', { class: 'nui-mono nui-small' }, fmtBytes(r.total)),
      ]),
  },
])

const rateSeries = computed(() => {
  const pts = rate.value?.points ?? []
  return [pts.map((p) => p.rx), pts.map((p) => p.tx)]
})
const rateNow = computed(() => {
  const pts = rate.value?.points ?? []
  const last = pts[pts.length - 1]
  return { rx: last?.rx ?? 0, tx: last?.tx ?? 0 }
})

/* ================= QoS ================= */
const qos = reactive<net.QosConfig>({ enable: false, upload: '', download: '', mode: '1', high: [], middle: [], low: [] })
const qosSaving = ref(false)
const netnatFlags = ref({ dpi_enabled: false, qos_enabled: false, enable: false })
const qosCats = ['meeting', 'game', 'webpage', 'video', 'education', 'work', 'social_entertainment', 'shopping', 'advertisement', 'other']

async function loadQos() {
  const cfg = await net.getQosConfig()
  Object.assign(qos, cfg)
  flags.value = await softLoad(() => net.getSystemFlags(), null, '全局功能开关（system.get_status）')
  netnatFlags.value = await softLoad(() => net.getNetnatFlags(), { dpi_enabled: false, qos_enabled: false, enable: false }, '网络加速状态（network.get_netnat_config）')
  return true
}

async function saveQos() {
  qosSaving.value = true
  try {
    if (qos.enable && (!String(qos.upload).trim() || !String(qos.download).trim())) {
      throw new Error('启用 QoS 前请先填最大上传/下载带宽（1–10000，单位 Mbps）')
    }
    await net.saveQosConfig({ ...qos })
    const after = await net.getQosConfig()
    if (!!after.enable !== !!qos.enable) throw new Error('回读开关与提交不一致，固件可能拒绝了本次修改')
    Object.assign(qos, after)
    netnatFlags.value = await net.getNetnatFlags().catch(() => netnatFlags.value)
    message.success('QoS 已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    qosSaving.value = false
  }
}

function setCatLevel(list: 'high' | 'middle' | 'low', cat: string, on: boolean) {
  const cur = new Set(qos[list])
  for (const k of ['high', 'middle', 'low'] as const) {
    if (k !== list && on) {
      const s = new Set(qos[k])
      s.delete(cat)
      qos[k] = [...s]
    }
  }
  if (on) cur.add(cat)
  else cur.delete(cat)
  qos[list] = [...cur]
}

const qosModeOptions = [
  { label: '关闭（不限速）', value: '0' },
  { label: '会议优先', value: '1' },
  { label: '游戏优先', value: '2' },
  { label: '网页浏览优先', value: '3' },
  { label: '视频优先', value: '4' },
  { label: '自定义优先级', value: '5' },
]

/* ================= SQM ================= */
const sqm = reactive<net.SqmConfig>({ enable: false, download: '', upload: '', qdisc: 'cake' })
const sqmSaving = ref(false)

async function loadSqm() {
  const cfg = await net.getSqmConfig()
  Object.assign(sqm, cfg)
  flags.value = await softLoad(() => net.getSystemFlags(), null, '全局功能开关（system.get_status）')
  netnatFlags.value = await softLoad(() => net.getNetnatFlags(), { dpi_enabled: false, qos_enabled: false, enable: false }, '网络加速状态（network.get_netnat_config）')
  return true
}

async function saveSqm() {
  sqmSaving.value = true
  try {
    if (sqm.enable && (!String(sqm.upload).trim() || !String(sqm.download).trim())) {
      throw new Error('启用 SQM 前请先填上/下行带宽（Mbps），否则 cake 无法算队列')
    }
    await net.saveSqmConfig({ ...sqm })
    const after = await net.getSqmConfig()
    if (!!after.enable !== !!sqm.enable) throw new Error('回读开关与提交不一致，固件可能了本次修改')
    Object.assign(sqm, after)
    netnatFlags.value = await net.getNetnatFlags().catch(() => netnatFlags.value)
    message.success('SQM 已保存并回读确认')
  } catch (e) {
    message.error(net.errText(e))
  } finally {
    sqmSaving.value = false
  }
}

/* ================= 装载调度 ================= */
const { loading, error, reload } = useAsync(
  async () => {
    soft.value = ''
    const s = section.value
    if (s === 'stats') return loadStats()
    if (s === 'qos') return loadQos()
    if (s === 'sqm') return loadSqm()
    return true
  },
  { watchSource: section, interval: 10000 },
)
</script>

<template>
  <div class="nui-page">
    <n-alert v-if="soft" type="warning" :bordered="false" closable @close="soft = ''">{{ soft }}</n-alert>

    <PageState :loading="loading" :error="error" @retry="reload">
      <!-- ==================== 流量统计 ==================== -->
      <div v-if="section === 'stats'" class="nui-grid">
        <PanelCard class="span-8" title="应用流量统计">
          <template #icon><n-icon><BarChartOutline /></n-icon></template>
          <template #extra>
            <div class="nui-row">
              <span class="nui-small nui-muted">统计开关</span>
              <n-switch :value="flowEnabled" :loading="ruleBusy" @update:value="(v: boolean) => saveRule({ enable: v })" />
              <n-select
                :value="flowRule.time"
                size="tiny"
                style="width: 96px"
                :options="[
                  { label: '今日', value: 'day' },
                  { label: '本周', value: 'week' },
                  { label: '本月', value: 'month' },
                ]"
                @update:value="(v: string) => saveRule({ time: v })"
              />
              <n-popconfirm @positive-click="clearStats">
                <template #trigger><n-button size="tiny" quaternary type="error" :loading="clearBusy">清空</n-button></template>
                清空已累计的流量统计？历史数据无法恢复。
              </n-popconfirm>
            </div>
          </template>

          <PageState
            v-if="!flowEnabled"
            empty
            empty-text="当前固件未启用流量统计（flow_statistics.get_statistics_rule.enable = false），打开右上角开关并等几分钟后这里会有数据"
            compact
          />
          <PageState v-else-if="flowEmpty" empty empty-text="流量统计已开启，但 flow_statistics.get_flow_statistics 目前没有数据（DPI 引擎需先运行一段时间，或该功能在本机未真正采集）" compact>
          </PageState>
          <template v-else>
            <div class="totals">
              <div><span class="nui-small nui-muted">合计</span><div class="nui-mid nui-mono">{{ fmtBytes(totalBytes) }}</div></div>
              <div><span class="nui-small nui-muted">下载</span><div class="nui-mid nui-mono">{{ fmtBytes(totalDown) }}</div></div>
              <div><span class="nui-small nui-muted">上传</span><div class="nui-mid nui-mono">{{ fmtBytes(totalUp) }}</div></div>
            </div>
            <n-data-table
              :columns="flowCols"
              :data="flowRows"
              size="small"
              :bordered="false"
              :scroll-x="640"
              :row-key="(r: any) => String(r.application_id ?? r.application_name)"
              max-height="380"
            />
          </template>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            读 <code>flow_statistics.get_flow_statistics</code> / <code>get_statistics_rule</code>，写 <code>set_statistics_rule</code> /
            <code>clear_statistics</code>。它依赖 DPI 引擎，与「网络加速」互斥。
          </p>
        </PanelCard>

        <PanelCard class="span-4" title="实时总速率">
          <template #icon><n-icon><PulseOutline /></n-icon></template>
          <div v-if="rateNow" class="rates">
            <div>
              <span class="nui-small nui-muted">下行</span>
              <div class="nui-mid nui-mono">{{ fmtSpeed(rateNow.rx) }}</div>
            </div>
            <div>
              <span class="nui-small nui-muted">上行</span>
              <div class="nui-mid nui-mono">{{ fmtSpeed(rateNow.tx) }}</div>
            </div>
          </div>
          <Sparkline v-if="(rate?.points ?? []).length > 1" :series="rateSeries" :colors="['#2080f0', '#f0a020']" :height="90" />
          <PageState
            v-else
            empty
            empty-text="插件桥 sys.rate_history 还没有采样点（采集器未跑或刚开机），曲线为空；上面的数值来自系统状态"
            compact
          />
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            桥 <code>sys.rate_history</code>：window {{ rate?.window ?? 0 }} 秒、采样间隔 {{ rate?.interval ?? 0 }} 秒、{{ rate?.enabled ? '采集已启用' : '采集未启用' }}。
          </p>
        </PanelCard>

        <PanelCard class="span-6" title="Top 应用（带宽使用）">
          <template #icon><n-icon><SpeedometerOutline /></n-icon></template>
          <n-data-table
            v-if="topFlow.top_apps.length"
            :columns="topCols"
            :data="topFlow.top_apps"
            size="small"
            :bordered="false"
            :scroll-x="380"
            :row-key="(r: any) => String(r.application_id ?? r.application_name)"
          />
          <PageState v-else empty empty-text="没有 Top 应用数据（flow_statistics.get_top_app_flow_statistics 返回空，功能未启用或无流量）" compact />
        </PanelCard>

        <PanelCard class="span-6" title="统计范围">
          <div class="nui-between nui-list-row">
            <span>DPI 引擎</span>
            <n-tag size="small" :bordered="false" :type="flags?.dpi_info?.status && flags.dpi_info.status !== '0' ? 'success' : 'default'">
              {{ flags?.dpi_info?.status && flags.dpi_info.status !== '0' ? '运行中' : '未就绪' }}
            </n-tag>
          </div>
          <div class="nui-between nui-list-row">
            <span>流量统计（system.get_status）</span>
            <n-tag size="small" :bordered="false" :type="flags?.flow_statistics_enabled ? 'success' : 'default'">
              {{ flags?.flow_statistics_enabled ? '已启用' : '未启用' }}
            </n-tag>
          </div>
          <div class="nui-between nui-list-row">
            <span>网络加速（互斥）</span>
            <n-tag size="small" :bordered="false" :type="flags?.netnat_enabled ? 'info' : 'default'">
              {{ flags?.netnat_enabled ? '开着' : '关着' }}
            </n-tag>
          </div>
          <div class="nui-between nui-list-row">
            <span>DPI 库版本</span>
            <span class="nui-mono nui-small">{{ flags?.dpi_info?.lib_version || '—' }}</span>
          </div>
          <p class="nui-small nui-muted" style="margin: 10px 0 0">
            统计由 DPI 引擎按应用识别；开启后会被记入「DPI 统计」，关闭则回落到无数据。
          </p>
        </PanelCard>
      </div>

      <!-- ==================== QoS ==================== -->
      <div v-if="section === 'qos'" class="nui-grid">
        <PanelCard class="span-7" title="应用 QoS（dpi.get_qos / set_qos）">
          <template #icon><n-icon><SpeedometerOutline /></n-icon></template>
          <n-form label-placement="top" :show-feedback="false">
            <n-grid :cols="24" responsive="screen" item-responsive :x-gap="14" :y-gap="12">
              <n-form-item-gi :span="'24 m:8'" label="启用 QoS">
                <n-switch v-model:value="qos.enable" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="最大下载（Mbps）">
                <n-input v-model:value="qos.download" placeholder="例如 300" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="最大上传（Mbps）">
                <n-input v-model:value="qos.upload" placeholder="例如 30" />
              </n-form-item-gi>
              <n-form-item-gi :span="24" label="优先级模式">
                <n-select v-model:value="qos.mode" :options="qosModeOptions" />
              </n-form-item-gi>
            </n-grid>
          </n-form>

          <div class="nui-sec" style="margin-top: 8px">自定义分级（模式选「自定义优先级」时生效）</div>
          <n-checkbox-group :value="[...qos.high, ...qos.middle, ...qos.low]">
            <div class="level-table">
              <div v-for="c in qosCats" :key="c" class="level-row">
                <span class="lv-name">{{ catLabel(c) }}</span>
                <n-checkbox :checked="qos.high.includes(c)" label="高" @update:checked="(v: boolean) => setCatLevel('high', c, v)" />
                <n-checkbox :checked="qos.middle.includes(c)" label="中" @update:checked="(v: boolean) => setCatLevel('middle', c, v)" />
                <n-checkbox :checked="qos.low.includes(c)" label="低" @update:checked="(v: boolean) => setCatLevel('low', c, v)" />
              </div>
            </div>
          </n-checkbox-group>

          <n-alert v-if="flags?.sqm_enabled" type="warning" :bordered="false" style="margin-top: 12px">
            当前 SQM 正在使用：官方 QoS 页在 SQM 开启时会把整块配置隐藏，两者不能同时生效。要改 QoS 请先去 /flow/sqm 关掉 SQM。
          </n-alert>
          <n-alert v-else-if="netnatFlags.enable" type="info" :bordered="false" style="margin-top: 12px">
            网络加速开着：官方提示「此功能无法与网络加速同时使用，启用后将自动关闭网络加速」。
          </n-alert>

          <n-button size="small" type="primary" :loading="qosSaving" style="margin-top: 12px" @click="saveQos">保存 QoS</n-button>
        </PanelCard>

        <PanelCard class="span-5" title="当前状态">
          <dl class="nui-kv">
            <dt>QoS（system.get_status）</dt>
            <dd>{{ flags?.qos_enabled ? '已启用' : '未启用' }}</dd>
            <dt>SQM</dt>
            <dd>{{ flags?.sqm_enabled ? '已启用' : '未启用' }}</dd>
            <dt>网络加速</dt>
            <dd>{{ netnatFlags.enable ? '开' : '关' }}（DPI {{ netnatFlags.dpi_enabled ? '占' : '未占' }} / QoS {{ netnatFlags.qos_enabled ? '占' : '未占' }}）</dd>
            <dt>优先级模式</dt>
            <dd>{{ qosModeOptions.find((x) => x.value === qos.mode)?.label ?? qos.mode }}</dd>
            <dt>带宽</dt>
            <dd class="nui-mono">{{ qos.download || '—' }} / {{ qos.upload || '—' }} Mbps</dd>
          </dl>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            QoS 是「按应用分类给优先级 + 总带宽上限」。官方 4.9 没有「按客户端限速」的规则表（那是旧 qos 对象，本机 get_client_list 为空），
            所以这里也没有规则增删，只有模式与分类优先级。
          </p>
          <n-button size="tiny" secondary style="margin-top: 10px" @click="router.push('/security/dpi')">DPI / 内容保护设置</n-button>
        </PanelCard>
      </div>

      <!-- ==================== SQM ==================== -->
      <div v-if="section === 'sqm'" class="nui-grid">
        <PanelCard class="span-7" title="SQM 智能队列（sqm.get_config / set_config）">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
          <n-form label-placement="top" :show-feedback="false">
            <n-grid :cols="24" responsive="screen" item-responsive :x-gap="14" :y-gap="12">
              <n-form-item-gi :span="'24 m:8'" label="启用 SQM">
                <n-switch v-model:value="sqm.enable" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="下行带宽（Mbps）">
                <n-input v-model:value="sqm.download" placeholder="例如 300" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:8'" label="上行带宽（Mbps）">
                <n-input v-model:value="sqm.upload" placeholder="例如 30" />
              </n-form-item-gi>
              <n-form-item-gi :span="'24 m:12'" label="队列算法">
                <n-select
                  v-model:value="sqm.qdisc"
                  :options="[
                    { label: 'cake（推荐，带智能队列）', value: 'cake' },
                    { label: 'fq_codel（轻量）', value: 'fq_codel' },
                  ]"
                />
              </n-form-item-gi>
            </n-grid>
          </n-form>
          <n-alert v-if="flags?.qos_enabled" type="warning" :bordered="false" style="margin-top: 12px">
            当前 QoS 正在使用：官方 SQM 页在 QoS 开启时会跳过读取 SQM 配置，两者不能同时生效。要改 SQM 请先去 /flow/qos 关掉 QoS。
          </n-alert>
          <n-alert v-else-if="netnatFlags.enable" type="info" :bordered="false" style="margin-top: 12px">
            网络加速开着：官方提示「此功能无法与网络加速同时使用，启用后将自动关闭网络加速」。
          </n-alert>
          <n-button size="small" type="primary" :loading="sqmSaving" style="margin-top: 12px" @click="saveSqm">保存 SQM</n-button>
        </PanelCard>

        <PanelCard class="span-5" title="当前队列 / 带宽">
          <dl class="nui-kv">
            <dt>启用状态</dt>
            <dd>{{ flags?.sqm_enabled ? '已启用' : '未启用' }}</dd>
            <dt>队列算法</dt>
            <dd class="nui-mono">{{ sqm.qdisc || '—' }}</dd>
            <dt>下行</dt>
            <dd class="nui-mono">{{ sqm.download || '未设' }}</dd>
            <dt>上行</dt>
            <dd class="nui-mono">{{ sqm.upload || '未设' }}</dd>
            <dt>QoS</dt>
            <dd>{{ flags?.qos_enabled ? '已启用（互斥）' : '未启用' }}</dd>
          </dl>
          <p class="nui-small nui-muted" style="margin: 12px 0 0">
            SQM 用 cake/fq_codel 做整形与排队，能显著降低 bufferbloat（游戏/视频通话更稳）。
            官方 4.9 的 sqm 对象没有运行期统计接口（无丢包/队列深度读取），所以这里只展示生效配置与
            <code>system.get_status.sqm_enabled</code> 的实际状态。
          </p>
        </PanelCard>
      </div>
    </PageState>
  </div>
</template>

<style scoped>
.totals {
  display: flex;
  gap: 32px;
  padding: 4px 0 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 10px;
}
.rates {
  display: flex;
  gap: 32px;
  margin-bottom: 10px;
}
.bar {
  position: relative;
  height: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar > i {
  display: block;
  height: 6px;
  min-width: 2px;
  border-radius: 3px;
  background: var(--nui-accent);
  flex: none;
}
.bar > span {
  position: relative;
  white-space: nowrap;
}
.level-table {
  width: 100%;
}
.level-row {
  display: flex;
  align-items: center;
  gap: 26px;
  padding: 4px 0;
}
.level-row + .level-row {
  border-top: 1px dashed var(--line-dash);
}
.lv-name {
  width: 96px;
  font-size: 13px;
}
code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11.5px;
  opacity: 0.8;
}
</style>
