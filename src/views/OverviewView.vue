<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NIcon, NProgress, NTag } from 'naive-ui'
import {
  GlobeOutline,
  HardwareChipOutline,
  LayersOutline,
  OpenOutline,
  PeopleOutline,
  PulseOutline,
  RefreshOutline,
  SpeedometerOutline,
  ThermometerOutline,
  WifiOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import PageState from '@/components/PageState.vue'
import RingGauge from '@/components/RingGauge.vue'
import Sparkline from '@/components/Sparkline.vue'
import { useDeviceStore } from '@/stores/device'
import { useUiStore } from '@/stores/ui'
import { getRateHistory } from '@/api/rates'
import { fmtAgo, fmtBytes, fmtDuration, ifaceLabel, loadLevel, num, pct, splitSpeed } from '@/utils/format'
import { useAsync } from '@/composables/useAsync'
import { COLORS } from '@/theme'
import {
  loadConn,
  loadFan,
  loadHealth,
  loadModem,
  loadOverviewNet,
  loadSummary,
  type AnyRec,
  type ConnResult,
  type FanConfig,
  type HealthEx,
  type ModemState,
  type OverviewNet,
  type SummaryState,
} from '@/api/core'

const device = useDeviceStore()
const ui = useUiStore()
const router = useRouter()

/* ---------------- 数据 ---------------- */
const health = useAsync<HealthEx>(loadHealth, { interval: 5000 })
const summary = useAsync<SummaryState>(loadSummary, { interval: 10000 })
const net = useAsync<OverviewNet>(loadOverviewNet, { interval: 15000 })
const conn = useAsync<ConnResult>(() => loadConn(net.data.value), { interval: 15000 })
const fan = useAsync<FanConfig | null>(loadFan, { interval: 30000 })
const modem = useAsync<ModemState>(loadModem, { interval: 0 })

const h = computed(() => health.data.value)
const s = computed(() => summary.data.value)
const n = computed(() => net.data.value)
const c = computed(() => conn.data.value)
const m = computed(() => modem.data.value)
/** 本机有无蜂窝能力：没有就整块隐藏（侧栏入口也隐藏） */
const showCellular = computed(() => device.hasCellular)

const info = computed(() => device.info)
const boardInfo = computed<AnyRec | null>(() => (info.value?.board_info ?? null) as AnyRec | null)
const modelName = computed(() => String(boardInfo.value?.model || info.value?.model || 'GL-MT3600BE'))
const firmware = computed(() => String(info.value?.firmware_version ?? '—'))
const kernel = computed(() => String(boardInfo.value?.kernel_version ?? '—'))
const uptime = computed(() => h.value?.uptime ?? device.health?.uptime ?? 0)
const modeText = computed(() => {
  const map: Record<string, string> = { router: '路由模式', bridge: '桥接模式', repeater: '中继模式' }
  return map[n.value?.mode ?? ''] ?? (n.value?.mode || '—')
})
const onlineText = computed(() => {
  const v = c.value
  if (!v) return '检测中…'
  return v.level === 'ok' ? '已联网' : v.level === 'link' ? '链路通但无法上网' : '未联网'
})
const onlineType = computed(() => (c.value?.level === 'ok' ? 'success' : c.value?.level === 'link' ? 'warning' : 'error'))

const memPct = computed(() => {
  const v = h.value
  if (!v || !v.memTotal) return 0
  return Math.round((v.memUsed / v.memTotal) * 100)
})
const fanSpeed = computed(() => h.value?.fan?.speed ?? fan.data.value?.speed ?? null)
const warnTemp = computed(() => fan.data.value?.warnTemperature ?? null)
const top5 = computed(() =>
  [...(s.value?.clients.list ?? [])]
    .sort((a, b) => num(b.rx) + num(b.tx) - (num(a.rx) + num(a.tx)))
    .slice(0, 5),
)
const vpnRunning = computed(() => (s.value?.vpn ?? []).filter((v) => v.running))
const ssidMain = computed(() => (s.value?.ssids ?? []).filter((x) => !x.guest && !x.iot))
const ssidGuest = computed(() => (s.value?.ssids ?? []).filter((x) => x.guest || x.iot))
const rx = computed(() => splitSpeed(device.speed.rx))
const tx = computed(() => splitSpeed(device.speed.tx))
const peakDown = computed(() => Math.max(0, ...device.series.down))
const peakUp = computed(() => Math.max(0, ...device.series.up))
const seriesDown = computed(() => device.series.down.slice(-60))
const seriesUp = computed(() => device.series.up.slice(-60))

/* ---------------- 首页速率历史（路由器内存记录） ---------------- */
// 开启「实时速率显示最近记录」时，打开首页先用服务端最近 3 分钟的采样把曲线铺满，再继续实时追加
onMounted(async () => {
  const h = await getRateHistory(60)
  ui.setRateHistory(!!h.enabled)
  if (!h.enabled || h.points.length < 2) return
  device.series = {
    down: h.points.map((p) => p.rx),
    up: h.points.map((p) => p.tx),
  }
})

/* ---------------- 操作 ---------------- */
const refreshing = ref(false)
async function refreshAll() {
  refreshing.value = true
  try {
    await Promise.all([
      health.reload(),
      summary.reload(),
      net.reload(),
      conn.reload(),
      fan.reload(),
      modem.reload(),
      device.refresh('overview'),
    ])
  } finally {
    refreshing.value = false
  }
}
const openOfficial = () => window.open('/gl_home.html', '_blank')
const go = (path: string) => router.push(path)
const tempColor = (t: number) => (t >= 75 ? COLORS.err : t >= 65 ? COLORS.warn : COLORS.ok)
const ifaceName = (name: string) => ifaceLabel(name)
const corePct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
</script>

<template>
  <div class="nui-page">
    <div class="nui-grid">
      <!-- ================= 设备卡 ================= -->
      <PanelCard class="span-8" title="设备状态">
        <template #icon><n-icon><HardwareChipOutline /></n-icon></template>
        <template #extra>
          <div class="nui-row">
            <n-tag size="small" :bordered="false" :type="onlineType" round>{{ onlineText }}</n-tag>
            <n-tag size="small" :bordered="false">{{ modeText }}</n-tag>
            <n-button size="tiny" quaternary :loading="refreshing" @click="refreshAll">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新
            </n-button>
          </div>
        </template>

        <div class="device">
          <div class="device-main">
            <div class="nui-mid">{{ modelName }}</div>
            <div class="nui-small nui-muted">
              MediaTek MT7987 · 双频 Wi-Fi 7 · 固件 {{ firmware }} · 内核 {{ kernel }}
            </div>
            <div class="kv-grid">
              <div>
                <div class="k">运行时间</div>
                <div class="v">{{ fmtDuration(uptime) }}</div>
              </div>
              <div>
                <div class="k">当前出口</div>
                <div class="v">
                  <span class="nui-mono">{{ n?.egress || '—' }}</span>
                  <span class="nui-small nui-muted"> · {{ n?.egressLabel || '—' }}</span>
                </div>
              </div>
              <div>
                <div class="k">公网 IPv4</div>
                <div class="v nui-mono">{{ n?.publicIp || '—' }}</div>
              </div>
              <div>
                <div class="k">DDNS 域名</div>
                <div class="v nui-mono">
                  {{ n?.ddns?.domain || '未配置' }}
                  <n-tag v-if="n?.ddns" size="tiny" :bordered="false" :type="n.ddns.enabled ? 'success' : 'default'">
                    {{ n.ddns.enabled ? '已启用' : '未启用' }}
                  </n-tag>
                </div>
              </div>
              <div>
                <div class="k">系统负载</div>
                <div class="v nui-mono">{{ (h?.load ?? device.health?.load ?? []).map((x) => x.toFixed(2)).join(' / ') }}</div>
              </div>
              <div>
                <div class="k">在线终端</div>
                <div class="v">{{ s?.clients.online ?? 0 }} 台<span class="nui-small nui-muted">（有线 {{ s?.clients.cable ?? 0 }} / 无线 {{ s?.clients.wireless ?? 0 }}）</span></div>
              </div>
            </div>
          </div>
          <div class="device-side">
            <div class="side-item">
              <span class="k">出口接口</span>
              <div v-for="i in (n?.network ?? []).filter((x) => x.up)" :key="i.name" class="nui-row">
                <i class="dot on" />
                <span class="nui-mono nui-small">{{ i.name }}</span>
              </div>
              <div v-if="!(n?.network ?? []).some((x) => x.up)" class="nui-small nui-muted">无启用链路</div>
            </div>
            <div class="side-item">
              <span class="k">上游 / 中继</span>
              <div v-if="n?.repeater" class="nui-small">
                <div class="ellipsis">{{ n.repeater.ssid }}</div>
                <div class="nui-muted nui-mono" style="font-size: 11px">
                  {{ n.repeater.band }} CH{{ n.repeater.channel }} · {{ n.repeater.signal }} dBm
                </div>
              </div>
              <div v-else class="nui-small nui-muted">未连接中继</div>
            </div>
            <div class="side-item">
              <span class="k">固件</span>
              <div class="nui-small">{{ firmware }} · {{ info?.firmware_type || 'release' }}</div>
              <div class="nui-muted" style="font-size: 11px">构建 {{ String(info?.firmware_date || '—') }}</div>
            </div>
          </div>
        </div>
      </PanelCard>

      <!-- ================= 实时速率 ================= -->
      <PanelCard class="span-4" title="实时速率">
        <template #icon><n-icon><SpeedometerOutline /></n-icon></template>
        <template #extra><span class="nui-small nui-muted">{{ ui.rateHistory ? '3s 采样 · 最近 3 分钟（内存记录）' : '5s 采样 · 60 点' }}</span></template>
        <div class="speed">
          <div class="speed-item">
            <span class="m-label"><i class="d" :style="{ background: ui.appearance.accent }" />下载</span>
            <div><span class="nui-big">{{ rx.value }}</span><span class="nui-unit">{{ rx.unit }}</span></div>
            <div class="nui-small nui-muted">峰值 {{ splitSpeed(peakDown).value }}{{ splitSpeed(peakDown).unit }}</div>
          </div>
          <div class="speed-item">
            <span class="m-label"><i class="d" style="background: #18a058" />上传</span>
            <div><span class="nui-big">{{ tx.value }}</span><span class="nui-unit">{{ tx.unit }}</span></div>
            <div class="nui-small nui-muted">峰值 {{ splitSpeed(peakUp).value }}{{ splitSpeed(peakUp).unit }}</div>
          </div>
        </div>
        <Sparkline :series="[seriesDown, seriesUp]" :colors="[ui.appearance.accent, '#18a058']" :height="94" />
        <div class="nui-between" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line)">
          <span class="nui-small nui-muted">数据源 clients.get_wan_speed</span>
          <span class="nui-small nui-muted">{{ fmtAgo(device.lastUpdate) }}</span>
        </div>
      </PanelCard>

      <!-- ================= 健康区 ================= -->
      <PanelCard class="span-8" title="系统健康">
        <template #icon><n-icon><PulseOutline /></n-icon></template>
        <template #extra><span class="nui-small nui-muted">{{ h?.source === 'glass' ? 'glass.get_status' : '官方 system 降级' }}</span></template>

        <PageState :loading="health.loading.value" :error="health.error.value" :empty="!h" empty-text="读取不到设备健康数据（glass 与 system 均不可用）" @retry="health.reload()">
          <div class="health">
            <div class="health-rings">
              <RingGauge
                :value="h?.cpu ?? 0"
                :color="COLORS[loadLevel(h?.cpu ?? 0)]"
                :text="h?.cpu == null ? '—' : `${Math.round(h.cpu)}%`"
                label="CPU"
                :caption="h?.cpu == null ? '需 glass' : undefined"
              />
              <RingGauge :value="memPct" color="#8a7ef0" :text="`${memPct}%`" label="内存" />
            </div>

            <div class="health-body">
              <div class="block">
                <div class="block-title">各核占用</div>
                <div v-if="(h?.cores ?? []).length" class="cores">
                  <div v-for="(v, i) in h?.cores ?? []" :key="i" class="core">
                    <span class="core-label">CPU{{ i }}</span>
                    <n-progress
                      type="line"
                      :percentage="corePct(v)"
                      :height="5"
                      :show-indicator="false"
                      :color="COLORS[loadLevel(v)]"
                      rail-color="rgba(128,128,128,0.18)"
                    />
                    <span class="core-val nui-mono">{{ corePct(v) }}%</span>
                  </div>
                </div>
                <div v-else class="nui-small nui-muted">
                  当前固件没有可用的 CPU 采样（glass 扩展不可用时各核数据缺失）
                </div>
              </div>

              <div class="block">
                <div class="block-title">内存</div>
                <div class="mem">
                  <div class="mem-row"><span>已用</span><b class="nui-mono">{{ fmtBytes(h?.memUsed, 0) }} / {{ fmtBytes(h?.memTotal, 0) }}</b></div>
                  <n-progress type="line" :percentage="memPct" :height="5" :show-indicator="false" color="#8a7ef0" rail-color="rgba(128,128,128,0.18)" />
                  <div class="mem-sub nui-small nui-muted">
                    可用 {{ fmtBytes(h?.memAvailable, 0) }} · 缓存 {{ fmtBytes(h?.memCached, 0) }} · 空闲 {{ fmtBytes(h?.memFree, 0) }}
                  </div>
                </div>
              </div>

              <div class="block">
                <div class="block-title">温度 · 风扇</div>
                <div class="temps">
                  <div v-for="t in h?.temps ?? []" :key="t.name" class="temp">
                    <i class="dot" :style="{ background: tempColor(t.temp) }" />
                    <span class="nui-small ellipsis">{{ t.name }}</span>
                    <b class="nui-mono">{{ t.temp.toFixed(1) }}</b><span class="nui-small nui-muted">℃</span>
                  </div>
                  <div v-if="!(h?.temps ?? []).length" class="nui-small nui-muted">无温度传感器数据</div>
                </div>
                <div class="nui-row nui-wrap" style="margin-top: 8px; gap: 14px">
                  <span class="nui-small">
                    <n-icon :size="14" style="vertical-align: -2px"><ThermometerOutline /></n-icon>
                    风扇 <b class="nui-mono">{{ fanSpeed ?? '—' }}</b> RPM
                  </span>
                  <n-tag size="tiny" :bordered="false" :type="h?.fan?.status ? 'success' : 'default'">
                    {{ h?.fan?.status ? '运转中' : '停转 / 未检测' }}
                  </n-tag>
                  <span v-if="warnTemp != null" class="nui-small nui-muted">告警阈值 {{ warnTemp }}℃</span>
                </div>
              </div>

              <div class="block">
                <div class="block-title">负载 · 磁盘</div>
                <div class="load-disk">
                  <div>
                    <div class="mem-row"><span>1/5/15 分钟</span><b class="nui-mono">{{ (h?.load ?? []).map((x) => x.toFixed(2)).join(' / ') }}</b></div>
                  </div>
                  <div v-if="h?.disk">
                    <div class="mem-row">
                      <span>磁盘（overlay）</span>
                      <b class="nui-mono">{{ fmtBytes(h.disk.used, 0) }} / {{ fmtBytes(h.disk.total, 0) }}</b>
                    </div>
                    <n-progress
                      type="line"
                      :percentage="h.disk.total ? pct(h.disk.used, h.disk.total) : 0"
                      :height="5"
                      :show-indicator="false"
                      :color="(h.disk.total ? pct(h.disk.used, h.disk.total) : 0) >= 85 ? COLORS.err : COLORS.info"
                      rail-color="rgba(128,128,128,0.18)"
                    />
                  </div>
                  <div v-else class="nui-small nui-muted">磁盘占用不可用</div>
                </div>
              </div>
            </div>
          </div>
          <p v-if="h?.note" class="nui-small nui-muted" style="margin: 10px 0 0">{{ h.note }}</p>
        </PageState>
      </PanelCard>

      <!-- ================= 联网检测 ================= -->
      <PanelCard class="span-4" title="联网检测">
        <template #icon><n-icon><GlobeOutline /></n-icon></template>
        <template #extra>
          <n-button size="tiny" quaternary :loading="conn.loading.value" @click="conn.reload()">重新检测</n-button>
        </template>

        <PageState :loading="conn.loading.value" :error="conn.error.value" :empty="!c" empty-text="没有可用的联网检测接口" compact @retry="conn.reload()">
          <div class="conn-head">
            <n-tag size="small" :bordered="false" :type="onlineType" round>{{ onlineText }}</n-tag>
            <span class="nui-small nui-muted">{{ c?.source }} · {{ c ? fmtAgo(c.checkedAt) : '' }}</span>
          </div>
          <div class="rows">
            <div class="row"><span class="rk">出口接口</span><span class="rv nui-mono">{{ c?.iface || '—' }}</span></div>
            <div class="row"><span class="rk">默认网关</span><span class="rv nui-mono">{{ c?.gateway || '—' }}</span></div>
            <div class="row">
              <span class="rk">网关可达</span>
              <span class="rv">{{ c?.gatewayOk == null ? '—' : c.gatewayOk ? '是' : '否' }}</span>
            </div>
            <div class="row"><span class="rk">外网延迟</span><span class="rv nui-mono">{{ c?.latency != null ? `${c.latency.toFixed(1)} ms` : '—' }}</span></div>
            <div class="row">
              <span class="rk">DNS 解析</span>
              <span class="rv">{{ c?.dnsOk == null ? '—' : c.dnsOk ? '正常' : '失败' }}</span>
            </div>
          </div>
          <div class="ifaces">
            <div v-for="i in c?.ifaces ?? []" :key="i.name" class="iface">
              <i class="dot" :class="i.up ? 'on' : 'off'" />
              <span class="nui-mono nui-small" style="width: 78px">{{ i.name }}</span>
              <span class="nui-small nui-muted ellipsis" style="flex: 1">{{ i.note }}</span>
              <span v-if="i.ip" class="nui-mono nui-small">{{ i.ip }}</span>
            </div>
          </div>
          <p v-if="(c?.errors ?? []).length" class="nui-small" style="margin: 8px 0 0; color: var(--warn)">
            {{ (c?.errors ?? []).join('；') }}
          </p>
        </PageState>
      </PanelCard>

      <!-- ================= 模组状态 ================= -->
      <PanelCard v-if="showCellular" class="span-4" title="蜂窝模组">
        <template #icon><n-icon><WifiOutline /></n-icon></template>
        <template #extra>
          <n-button size="tiny" quaternary :loading="modem.loading.value" @click="modem.reload()">检测</n-button>
        </template>

        <PageState :loading="modem.loading.value" :error="modem.error.value" :empty="!m" empty-text="modem.get_debug_msg 不可用" compact @retry="modem.reload()">
          <div v-if="m?.present" class="modem-on">
            <n-tag size="small" :bordered="false" type="success">检测到蜂窝模组</n-tag>
            <div class="rows">
              <div class="row"><span class="rk">设备</span><span class="rv nui-mono">{{ (m?.devices ?? []).join(', ') || '—' }}</span></div>
              <div class="row"><span class="rk">SIM</span><span class="rv">{{ (m?.sims ?? []).length }} 张</span></div>
              <div class="row"><span class="rk">短信</span><span class="rv">{{ m?.smsSupport ? '支持' : '不支持' }}</span></div>
            </div>
          </div>
          <div v-else class="modem-off">
            <div class="modem-title">
              <n-tag size="small" :bordered="false" type="warning" round>未检测到蜂窝模组</n-tag>
            </div>
            <p class="nui-small nui-muted" style="margin: 6px 0 8px">
              本机当前通过<strong>{{ n?.repeater ? '中继（' + n.repeater.ssid + '）' : '有线 / 中继' }}</strong>上网，蜂窝能力不可用。
            </p>
            <ul class="diag">
              <li v-for="(d, i) in m?.diagnostics ?? []" :key="i">{{ d }}</li>
            </ul>
            <div class="nui-small nui-muted">判定依据：modem.get_debug_msg / system.get_info / NUI cell.modules</div>
          </div>
        </PageState>
      </PanelCard>

      <!-- ================= 网络与终端摘要 ================= -->
      <PanelCard class="span-8" title="网络与终端摘要">
        <template #icon><n-icon><LayersOutline /></n-icon></template>
        <template #extra>
          <n-button size="tiny" quaternary @click="go('/clients')">全部终端</n-button>
        </template>

        <div class="summary">
          <div class="sum-col">
            <div class="block-title">WAN / 上网方式</div>
            <div class="rows">
              <div class="row"><span class="rk">接入方式</span><span class="rv">{{ n?.repeater ? '中继（Wi-Fi STA）' : (n?.cable?.protocol || '—').toUpperCase() }}</span></div>
              <div class="row"><span class="rk">出口地址</span><span class="rv nui-mono">{{ n?.wanInfo?.ip || n?.repeater?.ip || '—' }}</span></div>
              <div class="row"><span class="rk">网关</span><span class="rv nui-mono">{{ n?.wanInfo?.gateway || n?.repeater?.gateway || '—' }}</span></div>
              <div class="row"><span class="rk">DNS</span><span class="rv nui-mono ellipsis">{{ (n?.wanInfo?.dns ?? []).join(', ') || '—' }}</span></div>
              <div class="row"><span class="rk">网线（WAN 口）</span><span class="rv">{{ n?.cable?.inserted ? '已插入' : '未插入' }}</span></div>
            </div>

            <div class="block-title" style="margin-top: 12px">无线 SSID</div>
            <div class="ssids">
              <div v-for="w in [...ssidMain, ...ssidGuest]" :key="w.name" class="ssid">
                <i class="dot" :class="w.up ? 'on' : 'off'" />
                <span class="ellipsis" style="flex: 1">{{ w.ssid || w.name }}</span>
                <n-tag size="tiny" :bordered="false" :type="w.guest ? 'warning' : w.iot ? 'info' : 'default'">
                  {{ w.guest ? '访客' : w.iot ? 'IoT' : w.band }}
                </n-tag>
              </div>
              <div v-if="!(s?.ssids ?? []).length" class="nui-small nui-muted">未读取到 SSID 状态</div>
            </div>
          </div>

          <div class="sum-col">
            <div class="block-title">终端 Top 5</div>
            <div v-for="cl in top5" :key="cl.mac" class="rank">
              <span class="ellipsis" style="flex: 1">{{ cl.alias || cl.name || cl.mac }}</span>
              <span class="nui-small nui-muted">{{ ifaceName(String(cl.iface || '')) }}</span>
              <span class="nui-mono nui-small">{{ splitSpeed(num(cl.rx) + num(cl.tx)).value }}{{ splitSpeed(num(cl.rx) + num(cl.tx)).unit }}</span>
            </div>
            <div v-if="!top5.length" class="nui-small nui-muted">暂无在线终端</div>

            <div class="block-title" style="margin-top: 12px">云服务 / VPN</div>
            <div class="rows">
              <div class="row"><span class="rk">GoodCloud</span><span class="rv">{{ s?.cloud?.enabled ? `已启用（${s.cloud.bindtype || '—'}）` : '未启用' }}</span></div>
              <div class="row"><span class="rk">DDNS</span><span class="rv nui-mono">{{ n?.ddns?.domain || '未配置' }}</span></div>
              <div class="row"><span class="rk">VPN 运行</span><span class="rv">{{ vpnRunning.length }} 个<span v-if="vpnRunning.length" class="nui-small nui-muted">（{{ vpnRunning.map((v) => v.name).join('/') }}）</span></span></div>
              <div class="row"><span class="rk">访客 / IoT 网段</span><span class="rv nui-mono">{{ s?.lan?.guestIp || '—' }} / {{ s?.lan?.iotIp || '—' }}</span></div>
            </div>
          </div>
        </div>
        <p v-if="(s?.errors ?? []).length" class="nui-small" style="margin: 8px 0 0; color: var(--warn)">
          {{ (s?.errors ?? []).join('；') }}
        </p>
      </PanelCard>

      <!-- ================= 快捷操作 ================= -->
      <PanelCard class="span-12" title="快捷操作">
        <div class="quicks">
          <n-button secondary size="small" :loading="refreshing" @click="refreshAll">
            <template #icon><n-icon><RefreshOutline /></n-icon></template>
            刷新全部
          </n-button>
          <n-button secondary size="small" @click="openOfficial">
            <template #icon><n-icon><OpenOutline /></n-icon></template>
            打开官方后台
          </n-button>
          <n-button secondary size="small" @click="go('/clients')">
            <template #icon><n-icon><PeopleOutline /></n-icon></template>
            终端设备
          </n-button>
          <n-button secondary size="small" @click="go('/wireless/wifi')">
            <template #icon><n-icon><WifiOutline /></n-icon></template>
            Wi-Fi 设置
          </n-button>
          <n-button secondary size="small" @click="go('/wireless/repeater')">中继与桥接</n-button>
          <n-button secondary size="small" @click="go('/internet/wan')">上网设置</n-button>
          <n-button secondary size="small" @click="go('/internet/multiwan')">多 WAN</n-button>
          <n-button secondary size="small" @click="go('/system/info')">系统信息</n-button>
          <n-button secondary size="small" @click="go('/system/fan')">风扇与温度</n-button>
          <n-button secondary size="small" @click="go('/tools/monitor')">历史监控</n-button>
          <n-button secondary size="small" @click="go('/tools/conn')">联网检测</n-button>
          <n-button v-if="showCellular" secondary size="small" @click="go('/cellular/status')">蜂窝状态</n-button>
        </div>
        <div class="nui-small nui-muted" style="margin-top: 10px">
          数据全部来自设备 RPC：健康区 glass.get_status（失败自动降级 system.get_status）；速率 clients.get_wan_speed；
          联网 glass.conn_check；摘要 system.get_status + clients.get_list + cloud.get_config；公网 IP NUI net.public_ip。
        </div>
      </PanelCard>
    </div>
  </div>
</template>

<style scoped>
.k {
  font-size: 11.5px;
  opacity: 0.55;
}
.v {
  font-size: 13px;
  word-break: break-all;
}

/* 设备卡 */
.device {
  display: flex;
  gap: 18px;
}
.device-main {
  flex: 1;
  min-width: 0;
}
.device-side {
  flex: 0 0 208px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 16px;
  border-left: 1px dashed var(--line-dash);
}
.side-item .k {
  display: block;
  margin-bottom: 2px;
}
.kv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
  margin-top: 14px;
}

/* 速率 */
.speed {
  display: flex;
  gap: 26px;
  margin: 2px 0 4px;
}
.speed-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.6;
}
.d {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.5);
  flex: none;
  display: inline-block;
}
.dot.on { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.off { background: var(--err); }

/* 健康 */
.health {
  display: flex;
  gap: 18px;
}
.health-rings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
/* RingGauge 的轨道色用的是未定义的 --nui-border，这里补一层可见轨道 */
.health-rings :deep(.gauge .track) {
  stroke: rgba(128, 128, 128, 0.22);
}
.health-body {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 18px;
}
.block-title {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 6px;
}
.cores {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.core {
  display: grid;
  grid-template-columns: 34px 1fr 30px;
  gap: 6px;
  align-items: center;
}
.core-label {
  font-size: 11px;
  opacity: 0.6;
}
.core-val {
  font-size: 11px;
  text-align: right;
}
.mem-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  margin-bottom: 4px;
}
.mem-sub {
  margin-top: 3px;
}
.temps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.temp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.load-disk {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 联网检测 */
.conn-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
}
.rk { opacity: 0.58; flex: none; }
.rv { text-align: right; min-width: 0; word-break: break-all; }
.ifaces {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--line-dash);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.iface {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 模组 */
.modem-title { margin-bottom: 2px; }
.diag {
  margin: 0 0 8px;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.8;
  opacity: 0.72;
}

/* 摘要 */
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.sum-col { min-width: 0; }
.ssids {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ssid {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.rank {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  padding: 3px 0;
}

/* 快捷 */
.quicks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 1100px) {
  .device { flex-direction: column; }
  .device-side { flex: none; padding-left: 0; border-left: 0; border-top: 1px dashed var(--line-dash); padding-top: 10px; }
  .health { flex-direction: column; }
  .health-rings { flex-direction: row; justify-content: flex-start; }
  .health-body { grid-template-columns: 1fr; }
  .summary { grid-template-columns: 1fr; }
  .kv-grid { grid-template-columns: 1fr 1fr; }
}
</style>
