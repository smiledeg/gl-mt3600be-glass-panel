<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NIcon,
  NPopconfirm,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import { CloudOutline, GlobeOutline, LinkOutline, SwapHorizontalOutline } from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import InfoRow from '@/components/InfoRow.vue'
import PageState from '@/components/PageState.vue'
import { useAsync } from '@/composables/useAsync'
import { api } from '@/api'
import { cloud, ddns, ddnsIps, sdwan, type Dict } from '@/api/vpn'

const props = defineProps<{ section: string }>()
const message = useMessage()
const busy = ref('')
const bindUrl = ref('')

async function load(): Promise<Dict> {
  const s = props.section
  // glass.get_cloud_info 内部会跑 pgrep/ubus，比较慢，和业务请求并行发，不串行阻塞
  const metaP = api.call<Dict>('glass', 'get_cloud_info').catch(() => null)
  if (s === 'goodcloud') {
    // 注意：不要自动调用 cloud.bind_info / cloud.get_bind_url：
    //   bind_info 在云端没返回绑定信息时会清掉 uci 的 username/bindtime → 官方后台显示未连接；
    //   get_bind_url 会让 gl-cloud 重新申请绑定 token。
    // 绑定状态直接读 cloud.get_config 的 username/bindtime；绑定链接只在用户点按钮时获取。
    const [meta, cfg] = await Promise.all([metaP, cloud.config()])
    const bind = cfg && cfg.username ? { username: cfg.username, bind_time: cfg.bindtime } : null
    return { cfg, bind, url: null, meta }
  }
  if (s === 'ddns') {
    const [meta, cfg, st] = await Promise.all([metaP, ddns.config(), ddns.status().catch(() => null)])
    return { cfg, st, meta }
  }
  if (s === 'sdwan') {
    const [meta, cfg, iprb, started] = await Promise.all([
      metaP,
      sdwan.config().catch(() => null),
      sdwan.iprb().catch(() => null),
      sdwan.started().catch(() => null),
    ])
    return { cfg, iprb, started, meta }
  }
  return { meta: await metaP }
}

const { data, loading, error, reload } = useAsync<Dict>(load, { watchSource: computed(() => props.section) })

const meta = computed<Dict>(() => data.value?.meta ?? {})
const cfg = computed<Dict>(() => data.value?.cfg ?? {})
const bind = computed<Dict | null>(() => data.value?.bind ?? null)
const ddnsCfg = computed<Dict>(() => (props.section === 'ddns' ? cfg.value : {}))
const ddnsSt = computed<Dict>(() => data.value?.st ?? {})
const ips = computed(() => ddnsIps(data.value?.st ?? null))
const deviceId = computed(() => String(data.value?.cfg?.device_id ?? meta.value.device_id ?? '—'))
const ddnsSuffix = computed(() => String(meta.value.ddns_suffix || 'glddns.com'))
const remoteUrl = computed(() => {
  const id = deviceId.value
  if (!id || id === '—') return ''
  const httpsPort = String(meta.value.remote_https_port || '443')
  return httpsPort === '443' ? `https://${id}.${ddnsSuffix.value}` : `https://${id}.${ddnsSuffix.value}:${httpsPort}`
})
const mptunIfaces = computed<Dict[]>(() => (Array.isArray(data.value?.cfg?.interfaces) ? data.value!.cfg.interfaces : []))
const iprb = computed<Dict>(() => data.value?.iprb?.status ?? {})
const bindUrlText = computed(() => {
  const u = data.value?.url
  return String(bindUrl.value || (typeof u === 'string' ? u : u?.url || ''))
})

async function act(key: string, fn: () => Promise<unknown>, okMsg = '已保存') {
  busy.value = key
  try {
    await fn()
    message.success(okMsg)
    await reload(true)
  } catch (e: any) {
    message.error(e?.message ? String(e.message).slice(0, 180) : '操作失败')
  } finally {
    busy.value = ''
  }
}

function copyText(v: string, label = '内容') {
  navigator.clipboard
    .writeText(v)
    .then(() => message.success(`${label}已复制`))
    .catch(() => message.warning('浏览器不允许访问剪贴板'))
}

const raw = (v: unknown) => JSON.stringify(v, null, 2)
const open = (u: string) => u && window.open(u, '_blank')
</script>

<template>
  <div class="nui-page">
    <PageState :loading="loading" :error="error" @retry="reload">
      <!-- ================= GoodCloud ================= -->
      <div v-if="props.section === 'goodcloud'" class="nui-grid">
        <PanelCard class="span-6" title="GoodCloud 云服务">
          <template #icon><n-icon><CloudOutline /></n-icon></template>
          <template #extra>
            <n-tag size="small" :bordered="false" :type="cfg.cloud_enable ? 'success' : 'default'">
              {{ cfg.cloud_enable ? '已启用' : '未启用' }}
            </n-tag>
          </template>
          <div class="sw">
            <span><b>云服务</b><em>允许通过 GoodCloud 远程管理本机</em></span>
            <n-switch
              :value="!!cfg.cloud_enable"
              :loading="busy === 'en'"
              @update:value="(v) => act('en', () => cloud.setConfig({ ...cfg, cloud_enable: v }), v ? '云服务已启用' : '云服务已关闭')"
            />
          </div>
          <div class="sw">
            <span><b>远程 SSH</b><em>云端穿透到本机 SSH 端口</em></span>
            <n-switch
              :value="!!cfg.rtty_ssh"
              :loading="busy === 'ssh'"
              @update:value="(v) => act('ssh', () => cloud.setConfig({ ...cfg, rtty_ssh: v }), '已保存')"
            />
          </div>
          <div class="sw">
            <span><b>远程 Web</b><em>云端穿透到本机 Web 端口</em></span>
            <n-switch
              :value="!!cfg.rtty_web"
              :loading="busy === 'web'"
              @update:value="(v) => act('web', () => cloud.setConfig({ ...cfg, rtty_web: v }), '已保存')"
            />
          </div>

          <InfoRow label="绑定状态" :value="bind ? (bind.username || bind.email || '已绑定') : '未绑定'" />
          <InfoRow label="绑定类型" :value="cfg.bindtype || '—'" />
          <InfoRow label="云服务地址" :value="cfg.cloud_url || meta.goodcloud_url || '—'" mono />
          <InfoRow label="API 地址" :value="cfg.api_url || meta.goodcloud_api || '—'" mono />
          <InfoRow label="MQTT 长连接" :value="meta.mqtt_connected == null ? '服务未运行' : meta.mqtt_connected ? '在线' : '离线'" />
          <InfoRow label="gl-cloud 进程" :value="meta.gl_cloud_running ? '运行中' : '未运行'" />
          <InfoRow label="rtty 进程" :value="meta.rtty_running ? '运行中' : '未运行'" />
          <InfoRow label="设备 ID" :value="deviceId" mono />
        </PanelCard>

        <PanelCard class="span-6" title="账号绑定">
          <template #icon><n-icon><LinkOutline /></n-icon></template>
          <PageState :empty="!bind" empty-text="设备尚未绑定 GL 账号">
            <div class="kv-box">
              <div class="k">账号</div><div class="v">{{ bind?.username || bind?.email || '—' }}</div>
              <div class="k">绑定时间</div><div class="v mono">{{ bind?.bind_time || bind?.time || '—' }}</div>
              <div class="k">设备别名</div><div class="v">{{ bind?.name || bind?.alias || '—' }}</div>
            </div>
          </PageState>

          <div class="bind-area">
            <div class="dim" style="font-size: 12px; margin-bottom: 8px">
              在 GoodCloud 控制台绑定本设备：
              <a class="link" @click="open(cfg.cloud_url || meta.goodcloud_url || 'https://www.goodcloud.xyz')">打开控制台</a>
            </div>
            <n-button v-if="!bindUrlText" size="small" :loading="busy === 'url'" @click="act('url', async () => { const r = await cloud.bindUrl(); bindUrl = String((r as any)?.url || ''); }, '已生成绑定链接')">
              生成绑定链接
            </n-button>
            <div v-else class="url-box">
              <div class="mono ellip">{{ bindUrlText }}</div>
              <div class="row">
                <n-button size="tiny" @click="copyText(bindUrlText, '绑定链接')">复制</n-button>
                <n-button size="tiny" type="primary" @click="open(bindUrlText)">打开</n-button>
              </div>
            </div>
          </div>

          <n-collapse style="margin-top: 14px">
            <n-collapse-item title="cloud.get_config" name="1"><pre class="raw">{{ raw(cfg) }}</pre></n-collapse-item>
            <n-collapse-item title="glass.get_cloud_info" name="2"><pre class="raw">{{ raw(meta) }}</pre></n-collapse-item>
          </n-collapse>
        </PanelCard>
      </div>

      <!-- ================= DDNS ================= -->
      <div v-else-if="props.section === 'ddns'" class="nui-grid">
        <PanelCard class="span-6" title="GL DDNS 动态域名">
          <template #icon><n-icon><GlobeOutline /></n-icon></template>
          <template #extra>
            <n-tag size="small" :bordered="false" :type="ddnsCfg.enable_ddns ? 'success' : 'default'">
              {{ ddnsCfg.enable_ddns ? '已开启' : '已关闭' }}
            </n-tag>
          </template>
          <div class="sw">
            <span><b>启用 DDNS</b><em>用固定域名访问本机（IP 变化自动更新）</em></span>
            <n-switch
              :value="!!ddnsCfg.enable_ddns"
              :loading="busy === 'ddns'"
              @update:value="(v) => act('ddns', () => ddns.setConfig({ ...ddnsCfg, enable_ddns: v }), v ? 'DDNS 已开启' : 'DDNS 已关闭')"
            />
          </div>
          <InfoRow label="设备 ID" :value="deviceId" mono />
          <InfoRow label="DDNS 域名" :value="deviceId !== '—' ? `${deviceId}.${ddnsSuffix}` : '—'" mono />
          <InfoRow label="解析状态" :value="ddnsSt.status === 2 ? '正常' : ddnsSt.status === 1 ? '更新中' : ddnsSt.status === 0 ? '未启用' : '—'" />
          <InfoRow label="远程访问" :value="remoteUrl || '—'" mono />
          <div class="row" style="margin-top: 10px">
            <n-button size="small" :disabled="!remoteUrl" @click="open(remoteUrl)">打开远程地址</n-button>
            <n-button size="small" :disabled="!remoteUrl" @click="copyText(remoteUrl, '远程地址')">复制地址</n-button>
          </div>
          <div class="sub dim">提示：远程访问依赖 GoodCloud/DDNS 的端口映射；若打不开，请检查云服务是否启用与端口设置。</div>
        </PanelCard>

        <PanelCard class="span-6" title="当前公网 / 接口地址">
          <PageState :empty="!ips.length" empty-text="设备当前没有解析到公网 IP（可能处于中继/NAT 后）">
            <table class="tb">
              <thead><tr><th>接口</th><th>地址</th></tr></thead>
              <tbody>
                <tr v-for="i in ips" :key="i.interface">
                  <td class="b mono">{{ i.interface }}</td>
                  <td class="mono">{{ i.ip.join(' / ') }}</td>
                </tr>
              </tbody>
            </table>
          </PageState>
          <n-collapse style="margin-top: 12px">
            <n-collapse-item title="ddns.get_status" name="1"><pre class="raw">{{ raw(ddnsSt) }}</pre></n-collapse-item>
          </n-collapse>
        </PanelCard>
      </div>

      <!-- ================= SD-WAN / AstroWarp ================= -->
      <div v-else-if="props.section === 'sdwan'" class="nui-grid">
        <PanelCard class="span-6" title="SD-WAN（AstroWarp）">
          <template #icon><n-icon><SwapHorizontalOutline /></n-icon></template>
          <template #extra>
            <n-tag size="small" :bordered="false" :type="iprb.enabled === '1' ? 'success' : 'default'">
              {{ iprb.enabled === '1' ? '已启用' : '未启用' }}
            </n-tag>
          </template>
          <InfoRow label="服务状态" :value="iprb.state || '—'" />
          <InfoRow label="上次连接" :value="iprb.lastConnectedTime || '—'" />
          <InfoRow label="是否 P2P" :value="iprb.is_p2p === '1' ? '是' : '否'" />
          <InfoRow label="身份 ID" :value="iprb.identity || '—'" mono />
          <InfoRow label="SD-WAN 全局" :value="meta.mptun_enable ? '已启用' : '未启用'" />
          <div class="row" style="margin-top: 12px">
            <n-button size="small" :loading="busy === 'svc-start'" @click="act('svc-start', () => sdwan.startService(), 'SD-WAN 服务已启动')">启动服务</n-button>
            <n-popconfirm @positive-click="act('svc-pause', () => sdwan.pauseService(), 'SD-WAN 服务已暂停')">
              <template #trigger><n-button size="small" :loading="busy === 'svc-pause'">暂停服务</n-button></template>
              确认暂停 SD-WAN 服务？已建立的隧道会断开。
            </n-popconfirm>
            <n-button size="small" @click="open('https://my.astrowarp.net')">打开 AstroWarp</n-button>
          </div>
          <div class="sub dim">AstroWarp / SD-WAN 需要 GL 账号与订阅；本机为固件自带能力，实际可用性以云端授权为准。</div>
        </PanelCard>

        <PanelCard class="span-6" title="参与 SD-WAN 的接口">
          <PageState :empty="!mptunIfaces.length" empty-text="当前固件没有返回 SD-WAN 接口配置">
            <table class="tb">
              <thead><tr><th>接口</th><th>启用</th></tr></thead>
              <tbody>
                <tr v-for="i in mptunIfaces" :key="i.name">
                  <td class="b mono">{{ i.name }}</td>
                  <td>
                    <n-switch
                      size="small"
                      :value="!!i.enable"
                      :loading="busy === 'i-' + i.name"
                      @update:value="(v) => act('i-' + i.name, () => sdwan.setConfig({ interfaces: mptunIfaces.map((x) => (x.name === i.name ? { ...x, enable: v } : x)) }), '已保存')"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </PageState>
          <n-collapse style="margin-top: 12px">
            <n-collapse-item title="mptun.get_IPRB_status" name="1"><pre class="raw">{{ raw(data?.iprb) }}</pre></n-collapse-item>
            <n-collapse-item title="mptun.get_started" name="2"><pre class="raw">{{ raw(data?.started) }}</pre></n-collapse-item>
          </n-collapse>
        </PanelCard>
      </div>

      <div v-else class="nui-grid">
        <PanelCard class="span-12" title="未知分区"><PageState empty empty-text="未知的云服务分区" /></PanelCard>
      </div>
    </PageState>
  </div>
</template>

<style scoped>
.sw { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; border-bottom: 1px dashed var(--line); }
.sw:last-of-type { border-bottom: 0; }
.sw b { font-size: 13px; font-weight: 600; display: block; }
.sw em { font-style: normal; font-size: 11.5px; opacity: 0.55; }
.kv-box { display: grid; grid-template-columns: 96px 1fr; gap: 10px 14px; font-size: 13px; }
.kv-box .k { opacity: 0.55; }
.bind-area { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--line); }
.url-box { padding: 10px 12px; border-radius: 10px; background: var(--chip); font-size: 12px; display: grid; gap: 8px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.link { color: var(--nui-accent); cursor: pointer; }
.tb { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tb th { text-align: left; font-weight: 500; opacity: 0.55; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.tb td { padding: 9px 10px; border-bottom: 1px solid var(--line); }
.tb tr:last-child td { border-bottom: 0; }
.mono { font-family: var(--nui-mono, Consolas, monospace); font-size: 12px; }
.ellip { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.raw { font-size: 11px; max-height: 240px; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-all; opacity: 0.8; }
.dim { opacity: 0.6; }
.sub { font-size: 11.5px; margin-top: 12px; }
.b { font-weight: 600; }
</style>
