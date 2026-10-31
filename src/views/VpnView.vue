<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  GlobeOutline,
  KeyOutline,
  LockClosedOutline,
  PulseOutline,
  SwapHorizontalOutline,
} from '@vicons/ionicons5'
import PanelCard from '@/components/PanelCard.vue'
import InfoRow from '@/components/InfoRow.vue'
import PageState from '@/components/PageState.vue'
import { useAsync } from '@/composables/useAsync'
import { fmtBytes } from '@/utils/format'
import { ovpnServer, tailscale, tor, vpnClient, wgServer, zerotier, type Dict } from '@/api/vpn'

const props = defineProps<{ section: string }>()
const message = useMessage()
const router = useRouter()
const busy = ref('')

/* 当前 section 的复合加载：只拉当前页需要的数据 */
async function load(): Promise<Dict> {
  const s = props.section
  if (s === 'dashboard') {
    const [vs, ws, os, ts, zt, tr] = await Promise.all([
      vpnClient.status().catch(() => null),
      wgServer.status().catch(() => null),
      ovpnServer.config().catch(() => null),
      tailscale.status().catch(() => null),
      zerotier.status().catch(() => null),
      tor.status().catch(() => null),
    ])
    return { vs, ws, os, ts, zt, tr }
  }
  if (s === 'client') {
    const [tun, cfgs, using] = await Promise.all([
      vpnClient.tunnel(),
      vpnClient.allConfigs().catch(() => ({ configs: {} })),
      vpnClient.usingStatus().catch(() => []),
    ])
    return { tun, cfgs, using }
  }
  if (s === 'wg-server') {
    const [cfg, set, st, peers] = await Promise.all([
      wgServer.config(),
      wgServer.setting().catch(() => ({})),
      wgServer.status().catch(() => null),
      wgServer.peers().catch(() => ({ peers: [] })),
    ])
    return { cfg, set, st, peers }
  }
  if (s === 'ovpn-server') {
    const [cfg, set, users] = await Promise.all([
      ovpnServer.config(),
      ovpnServer.setting().catch(() => ({})),
      ovpnServer.users().catch(() => ({ user_list: [] })),
    ])
    return { cfg, set, users }
  }
  if (s === 'tailscale') {
    const [cfg, st, ex] = await Promise.all([
      tailscale.config().catch(() => ({})),
      tailscale.status().catch(() => ({})),
      tailscale.exitNodes().catch(() => []),
    ])
    return { cfg, st, ex }
  }
  if (s === 'zerotier') return { cfg: await zerotier.config().catch(() => ({})), st: await zerotier.status().catch(() => []) }
  if (s === 'tor') return { cfg: await tor.config().catch(() => ({})), st: await tor.status().catch(() => []) }
  return {}
}

const { data, loading, error, reload } = useAsync<Dict>(load, { watchSource: computed(() => props.section) })

const dash = computed(() => data.value ?? {})
const wgRunning = computed(() => !!(dash.value.ws?.server?.status || dash.value.ws?.server?.initialization))
const ovpnRunning = computed(() => !!(dash.value.os?.initialization))
const tsOn = computed(() => !!(dash.value.ts?.status === 'Running' || dash.value.ts?.enabled))
const tunnels = computed<Dict[]>(() => [...(data.value?.tun?.tunnels ?? []), ...(data.value?.tun?.default_tunnels ?? [])])
const globalEnabled = computed(() => !!data.value?.tun?.global_enabled)
const vpnConfigs = computed<{ type: string; list: Dict[] }[]>(() => {
  const c = data.value?.cfgs?.configs ?? {}
  const out: { type: string; list: Dict[] }[] = []
  if (Array.isArray(c.wireguard)) out.push({ type: 'WireGuard', list: c.wireguard })
  if (Array.isArray(c.openvpn)) out.push({ type: 'OpenVPN', list: c.openvpn })
  return out
})
const wgCfg = computed<Dict>(() => (props.section === 'wg-server' ? (data.value?.cfg ?? {}) : (dash.value.ws ?? {})))
const wgSet = computed<Dict>(() => data.value?.set ?? {})
const wgSt = computed<Dict>(() => data.value?.st ?? {})
const wgPeers = computed<Dict[]>(() => data.value?.peers?.peers ?? [])
const ovpnCfg = computed<Dict>(() => data.value?.cfg ?? {})
const ovpnSet = computed<Dict>(() => data.value?.set ?? {})
const ovpnUsers = computed<Dict[]>(() => data.value?.users?.user_list ?? [])
const tsCfg = computed<Dict>(() => data.value?.cfg ?? {})
const tsSt = computed<Dict>(() => data.value?.st ?? {})
const exitNodes = computed<Dict[]>(() => (Array.isArray(data.value?.ex) ? data.value!.ex : []))
const ztCfg = computed<Dict>(() => data.value?.cfg ?? {})
const ztStatus = computed<Dict[]>(() => (Array.isArray(data.value?.st) ? data.value!.st : []))
const torCfg = computed<Dict>(() => data.value?.cfg ?? {})
const torStatus = computed<Dict[]>(() => (Array.isArray(data.value?.st) ? data.value!.st : []))

/** 统一执行写操作：busy 标记 + toast + 重载 */
async function act(key: string, fn: () => Promise<unknown>, okMsg = '已执行') {
  busy.value = key
  try {
    await fn()
    message.success(okMsg)
    await reload(true)
  } catch (e: any) {
    message.error(e?.message ? String(e.message).slice(0, 160) : '操作失败')
  } finally {
    busy.value = ''
  }
}

/* ---------------- WireGuard 服务端 ---------------- */
const wgForm = ref<Dict>({
  port: wgCfg.value.port ?? 51820,
  address_v4: wgCfg.value.address_v4 ?? '',
  address_v6: wgCfg.value.address_v6 ?? '',
})
const wgPeerForm = ref({ name: '', public_key: '' })
const wgKeyPair = ref<Dict | null>(null)

/* ---------------- OpenVPN 服务端 ---------------- */
const ovpnForm = ref<Dict>({
  mode: 'tun',
  proto: 'udp',
  port: 1194,
  cipher: 'AES-256-GCM',
  auth: 'SHA256',
  start: '10.8.0.2',
  end: '10.8.0.100',
  subnetv4: '10.8.0.0',
  mask: '255.255.255.0',
  client_to_client: false,
})
const ovpnUserForm = ref({ name: '' })

const tsAuth = ref('')
async function tsLogin() {
  await act('ts-login', async () => {
    const r: any = await tailscale.authUrl()
    tsAuth.value = r?.url || r?.auth_url || (typeof r === 'string' ? r : '')
    if (tsAuth.value) window.open(tsAuth.value, '_blank')
  }, '已获取登录链接')
}

function copyText(v: string, label = '内容') {
  navigator.clipboard
    .writeText(v)
    .then(() => message.success(`${label}已复制`))
    .catch(() => message.warning('浏览器不允许访问剪贴板'))
}

const goto = (k: string) => router.push(`/vpn/${k}`)
const raw = (v: unknown) => JSON.stringify(v, null, 2)
</script>

<template>
  <div class="nui-page">
    <PageState :loading="loading" :error="error" @retry="reload">
      <!-- ============ 概览 ============ -->
      <div v-if="props.section === 'dashboard'" class="nui-grid">
        <PanelCard class="span-8" title="VPN 与远程组网">
          <template #icon><n-icon><LockClosedOutline /></n-icon></template>
          <div class="status-cards">
            <div class="sc" @click="goto('client')">
              <div class="sc-h"><n-icon><SwapHorizontalOutline /></n-icon><b>VPN 客户端</b></div>
              <n-tag size="small" :bordered="false" :type="(dash.vs?.status_list ?? []).length ? 'success' : 'default'">
                {{ (dash.vs?.status_list ?? []).length ? '使用中' : '未连接' }}
              </n-tag>
              <div class="sc-sub">模式 {{ dash.vs?.mode ?? 0 }} · 隧道 {{ (dash.vs?.status_list ?? []).length }}</div>
            </div>
            <div class="sc" @click="goto('wg-server')">
              <div class="sc-h"><n-icon><KeyOutline /></n-icon><b>WireGuard</b></div>
              <n-tag size="small" :bordered="false" :type="wgRunning ? 'success' : 'default'">{{ wgRunning ? '运行中' : '未启动' }}</n-tag>
              <div class="sc-sub">接收 {{ fmtBytes(dash.ws?.server?.rx_bytes) }} · 发送 {{ fmtBytes(dash.ws?.server?.tx_bytes) }}</div>
            </div>
            <div class="sc" @click="goto('ovpn-server')">
              <div class="sc-h"><n-icon><LockClosedOutline /></n-icon><b>OpenVPN</b></div>
              <n-tag size="small" :bordered="false" :type="ovpnRunning ? 'success' : 'default'">{{ ovpnRunning ? '运行中' : '未启动' }}</n-tag>
              <div class="sc-sub">{{ dash.os?.proto ?? '—' }} / {{ dash.os?.port ?? '—' }}</div>
            </div>
            <div class="sc" @click="goto('tailscale')">
              <div class="sc-h"><n-icon><GlobeOutline /></n-icon><b>Tailscale</b></div>
              <n-tag size="small" :bordered="false" :type="tsOn ? 'success' : 'default'">{{ tsOn ? '在线' : '未启用' }}</n-tag>
              <div class="sc-sub">{{ dash.ts?.dns?.[0] ?? '—' }}</div>
            </div>
            <div class="sc" @click="goto('zerotier')">
              <div class="sc-h"><n-icon><GlobeOutline /></n-icon><b>ZeroTier</b></div>
              <n-tag size="small" :bordered="false" :type="(dash.zt ?? []).length ? 'success' : 'default'">{{ (dash.zt ?? []).length ? '已加入' : '未加入' }}</n-tag>
              <div class="sc-sub">网络 {{ Array.isArray(dash.zt) ? dash.zt.length : 0 }} 个</div>
            </div>
            <div class="sc" @click="goto('tor')">
              <div class="sc-h"><n-icon><PulseOutline /></n-icon><b>Tor</b></div>
              <n-tag size="small" :bordered="false" :type="(dash.tr ?? []).length ? 'success' : 'default'">{{ (dash.tr ?? []).length ? '运行中' : '未启用' }}</n-tag>
              <div class="sc-sub">匿名网络</div>
            </div>
          </div>
          <div class="sub dim">状态来自官方接口；未启用/未配置时对应页面会给出配置入口。</div>
        </PanelCard>

        <PanelCard class="span-4" title="接口原始数据" flush>
          <n-collapse>
            <n-collapse-item title="vpn-client.get_status" name="1"><pre class="raw">{{ raw(dash.vs) }}</pre></n-collapse-item>
            <n-collapse-item title="wg-server.get_status" name="2"><pre class="raw">{{ raw(dash.ws) }}</pre></n-collapse-item>
            <n-collapse-item title="tailscale.get_status" name="3"><pre class="raw">{{ raw(dash.ts) }}</pre></n-collapse-item>
          </n-collapse>
        </PanelCard>
      </div>

      <!-- ============ VPN 客户端 ============ -->
      <div v-else-if="props.section === 'client'" class="nui-grid">
        <PanelCard class="span-12" title="隧道与分流策略">
          <template #extra>
            <n-tag size="small" :bordered="false" :type="globalEnabled ? 'success' : 'default'">
              {{ globalEnabled ? '全局启用' : '未全局启用' }}
            </n-tag>
            <n-button size="tiny" quaternary :loading="busy === 'stop'" @click="act('stop', () => vpnClient.stop(), '已停止全部 VPN')">停止全部</n-button>
          </template>
          <PageState :empty="!tunnels.length" empty-text="尚未配置 VPN 隧道。请在官方后台「VPN → 客户端」导入 WireGuard / OpenVPN 配置后回到本页。">
            <table class="tb">
              <thead><tr><th>名称</th><th>走向</th><th>来源</th><th>状态</th><th>kill switch</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="t in tunnels" :key="t.id">
                  <td class="b">{{ t.name || t.id }}</td>
                  <td class="mono">{{ t.via?.via ?? '—' }}</td>
                  <td class="mono">{{ t.from?.type ?? '—' }}</td>
                  <td><n-tag size="tiny" :bordered="false" :type="t.enabled ? 'success' : 'default'">{{ t.enabled ? '启用' : '停用' }}</n-tag></td>
                  <td>{{ t.killswitch ? '开' : '关' }}</td>
                  <td class="ops">
                    <a @click="act('t-' + t.id, () => vpnClient.setTunnel({ ...t, enabled: !t.enabled }), t.enabled ? '已停用' : '已启用')">{{ t.enabled ? '停用' : '启用' }}</a>
                    <a @click="act('d-' + t.id, () => vpnClient.setDefaultTunnel({ id: t.id }), '已设为默认')">设默认</a>
                    <n-popconfirm @positive-click="act('r-' + t.id, () => vpnClient.removeTunnel({ id: t.id }), '已删除')">
                      <template #trigger><a class="danger">删除</a></template>
                      确认删除隧道 {{ t.name || t.id }}？
                    </n-popconfirm>
                  </td>
                </tr>
              </tbody>
            </table>
          </PageState>
        </PanelCard>

        <PanelCard class="span-6" title="已导入的配置">
          <PageState :empty="!vpnConfigs.length" empty-text="没有已导入的 VPN 配置">
            <div v-for="g in vpnConfigs" :key="g.type" class="cfg-group">
              <div class="cfg-title">{{ g.type }} · {{ g.list.length }}</div>
              <div v-for="(c, i) in g.list" :key="i" class="cfg-item">
                <span>{{ c.name || c.id || '配置 ' + (i + 1) }}</span>
                <span class="dim mono">{{ c.type || c.proto || '' }}</span>
              </div>
            </div>
          </PageState>
        </PanelCard>

        <PanelCard class="span-6" title="各客户端 VPN 使用状态">
          <PageState :empty="!(data?.using ?? []).length" empty-text="没有客户端正在使用 VPN">
            <table class="tb compact">
              <thead><tr><th>MAC</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="u in data?.using ?? []" :key="u.mac">
                  <td class="mono">{{ u.mac }}</td>
                  <td><n-tag size="tiny" :bordered="false" :type="u.status ? 'success' : 'default'">{{ u.status ? '走 VPN' : '直连' }}</n-tag></td>
                </tr>
              </tbody>
            </table>
          </PageState>
        </PanelCard>
      </div>

      <!-- ============ WireGuard 服务端 ============ -->
      <div v-else-if="props.section === 'wg-server'" class="nui-grid">
        <PanelCard class="span-6" title="服务端状态">
          <template #extra>
            <n-button size="tiny" type="primary" :loading="busy === 'wg-start'" :disabled="wgRunning" @click="act('wg-start', () => wgServer.start(), 'WireGuard 已启动')">启动</n-button>
            <n-button size="tiny" :loading="busy === 'wg-stop'" :disabled="!wgRunning" @click="act('wg-stop', () => wgServer.stop(), '已停止')">停止</n-button>
          </template>
          <InfoRow label="运行状态" :value="wgRunning ? '运行中' : '未启动'" />
          <InfoRow label="隧道 IP" :value="wgSt.tunnel_ip || '—'" mono />
          <InfoRow label="接收 / 发送" :value="`${fmtBytes(wgSt.rx_bytes)} / ${fmtBytes(wgSt.tx_bytes)}`" mono />
          <InfoRow label="对端数" :value="wgPeers.length" />
          <InfoRow label="日志" :value="wgSt.log || '—'" />
        </PanelCard>

        <PanelCard class="span-6" title="服务端配置">
          <template #extra>
            <n-button size="tiny" type="primary" :loading="busy === 'wg-save'" @click="act('wg-save', () => wgServer.setConfig({ ...wgCfg, ...wgForm }), '配置已保存')">保存</n-button>
          </template>
          <n-form label-placement="left" label-width="110" size="small">
            <n-form-item label="监听端口"><n-input-number v-model:value="wgForm.port" :min="1" :max="65535" style="width: 100%" /></n-form-item>
            <n-form-item label="IPv4 网段"><n-input v-model:value="wgForm.address_v4" placeholder="10.1.0.1/24" /></n-form-item>
            <n-form-item label="IPv6 网段"><n-input v-model:value="wgForm.address_v6" placeholder="fd00::1/64" /></n-form-item>
            <n-form-item label="私钥"><n-input :value="wgCfg.private_key || '（未生成）'" readonly type="password" show-password-on="click" /></n-form-item>
            <n-form-item label="公钥"><n-input :value="wgCfg.public_key || '（未生成）'" readonly /></n-form-item>
            <n-form-item label="本机访问"><n-switch :value="!!wgSet.local_access" @update:value="(v) => act('wg-set', () => wgServer.setSetting({ ...wgSet, local_access: v }), '设置已保存')" /></n-form-item>
            <n-form-item label="客户端互访"><n-switch :value="!!wgSet.client_to_client" @update:value="(v) => act('wg-set2', () => wgServer.setSetting({ ...wgSet, client_to_client: v }), '设置已保存')" /></n-form-item>
            <n-form-item label="密钥">
              <n-button size="small" @click="act('wg-key', async () => { wgKeyPair = await wgServer.genKey() }, '已生成密钥对')">生成密钥对</n-button>
            </n-form-item>
          </n-form>
          <pre v-if="wgKeyPair" class="raw">{{ raw(wgKeyPair) }}</pre>
        </PanelCard>

        <PanelCard class="span-12" title="客户端（对端）">
          <div class="peer-add">
            <n-input v-model:value="wgPeerForm.name" placeholder="名称，如 phone" size="small" style="width: 160px" />
            <n-input v-model:value="wgPeerForm.public_key" placeholder="客户端公钥（留空则由设备生成）" size="small" />
            <n-button size="small" type="primary" :loading="busy === 'wg-peer'" @click="act('wg-peer', async () => { await wgServer.addPeer({ ...wgPeerForm }); wgPeerForm = { name: '', public_key: '' } }, '已添加客户端')">添加</n-button>
          </div>
          <PageState :empty="!wgPeers.length" empty-text="还没有客户端。先「生成密钥对」或「添加」创建。">
            <table class="tb">
              <thead><tr><th>名称</th><th>公钥</th><th>允许 IP</th><th>最近握手</th><th>流量</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="p in wgPeers" :key="p.name || p.public_key">
                  <td class="b">{{ p.name || '—' }}</td>
                  <td class="mono ellip">{{ p.public_key || '—' }}</td>
                  <td class="mono">{{ Array.isArray(p.allowed_ips) ? p.allowed_ips.join(', ') : p.allowed_ips || '—' }}</td>
                  <td class="mono">{{ p.latest_handshake || '—' }}</td>
                  <td class="mono">{{ fmtBytes(p.rx_bytes) }} / {{ fmtBytes(p.tx_bytes) }}</td>
                  <td class="ops">
                    <n-popconfirm @positive-click="act('wg-rm-' + (p.name || p.public_key), () => wgServer.removePeer({ name: p.name, public_key: p.public_key }), '已删除')">
                      <template #trigger><a class="danger">删除</a></template>
                      确认删除客户端 {{ p.name || p.public_key }}？
                    </n-popconfirm>
                  </td>
                </tr>
              </tbody>
            </table>
          </PageState>
        </PanelCard>
      </div>

      <!-- ============ OpenVPN 服务端 ============ -->
      <div v-else-if="props.section === 'ovpn-server'" class="nui-grid">
        <PanelCard class="span-6" title="服务端参数">
          <template #extra>
            <n-button size="tiny" type="primary" :loading="busy === 'o-save'" @click="act('o-save', () => ovpnServer.setConfig({ ...ovpnCfg, ...ovpnForm }), '配置已保存')">保存</n-button>
          </template>
          <n-form label-placement="left" label-width="96" size="small">
            <n-form-item label="模式"><n-select v-model:value="ovpnForm.mode" :options="[{ label: 'TUN', value: 'tun' }, { label: 'TAP', value: 'tap' }]" /></n-form-item>
            <n-form-item label="协议"><n-select v-model:value="ovpnForm.proto" :options="[{ label: 'UDP', value: 'udp' }, { label: 'TCP', value: 'tcp' }]" /></n-form-item>
            <n-form-item label="端口"><n-input-number v-model:value="ovpnForm.port" :min="1" :max="65535" style="width: 100%" /></n-form-item>
            <n-form-item label="加密"><n-select v-model:value="ovpnForm.cipher" :options="['AES-256-GCM', 'AES-128-GCM', 'AES-256-CBC', 'AES-128-CBC'].map((x) => ({ label: x, value: x }))" /></n-form-item>
            <n-form-item label="认证"><n-select v-model:value="ovpnForm.auth" :options="['SHA256', 'SHA1', 'SHA512'].map((x) => ({ label: x, value: x }))" /></n-form-item>
            <n-form-item label="网段"><n-input v-model:value="ovpnForm.subnetv4" /></n-form-item>
            <n-form-item label="掩码"><n-input v-model:value="ovpnForm.mask" /></n-form-item>
            <n-form-item label="起始 IP"><n-input v-model:value="ovpnForm.start" /></n-form-item>
            <n-form-item label="结束 IP"><n-input v-model:value="ovpnForm.end" /></n-form-item>
            <n-form-item label="客户端互访"><n-switch v-model:value="ovpnForm.client_to_client" /></n-form-item>
          </n-form>
        </PanelCard>

        <PanelCard class="span-6" title="运行设置">
          <n-form label-placement="left" label-width="96" size="small">
            <n-form-item label="NAT 转发"><n-switch :value="!!ovpnSet.masq" @update:value="(v) => act('o-set', () => ovpnServer.setSetting({ ...ovpnSet, masq: v }), '设置已保存')" /></n-form-item>
            <n-form-item label="本机访问"><n-switch :value="!!ovpnSet.local_access" @update:value="(v) => act('o-set2', () => ovpnServer.setSetting({ ...ovpnSet, local_access: v }), '设置已保存')" /></n-form-item>
            <n-form-item label="证书"><n-button size="small" :loading="busy === 'o-cert'" @click="act('o-cert', () => ovpnServer.generateCertificate({}), '证书已生成')">重新生成证书</n-button></n-form-item>
          </n-form>
          <InfoRow label="初始化状态" :value="ovpnCfg.initialization ? '已初始化' : '未初始化'" />
          <InfoRow label="DH 参数" :value="ovpnCfg.dh ? '已存在' : '未生成'" />
          <InfoRow label="IPv6 网段" :value="ovpnCfg.subnetv6 || '—'" mono />
          <div class="sub dim">生成证书可能耗时较久（官方超时 180s）。</div>
        </PanelCard>

        <PanelCard class="span-12" title="客户端账号">
          <div class="peer-add">
            <n-input v-model:value="ovpnUserForm.name" placeholder="用户名，如 phone" size="small" style="width: 200px" />
            <n-button size="small" type="primary" :loading="busy === 'o-user'" @click="act('o-user', async () => { await ovpnServer.addUser({ name: ovpnUserForm.name }); ovpnUserForm = { name: '' } }, '账号已添加')">添加账号</n-button>
          </div>
          <PageState :empty="!ovpnUsers.length" empty-text="还没有客户端账号">
            <table class="tb">
              <thead><tr><th>用户名</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="u in ovpnUsers" :key="u.name || u.user">
                  <td class="b">{{ u.name || u.user }}</td>
                  <td>{{ u.status ?? '—' }}</td>
                  <td class="ops">
                    <a @click="act('o-exp', async () => { const r = await ovpnServer.exportConfig({ name: u.name || u.user }); copyText(typeof r === 'string' ? r : JSON.stringify(r), '配置') }, '配置已复制')">导出配置</a>
                    <n-popconfirm @positive-click="act('o-rm-' + (u.name || u.user), () => ovpnServer.removeUser({ name: u.name || u.user }), '已删除')">
                      <template #trigger><a class="danger">删除</a></template>
                      确认删除账号 {{ u.name || u.user }}？
                    </n-popconfirm>
                  </td>
                </tr>
              </tbody>
            </table>
          </PageState>
        </PanelCard>
      </div>

      <!-- ============ Tailscale ============ -->
      <div v-else-if="props.section === 'tailscale'" class="nui-grid">
        <PanelCard class="span-6" title="Tailscale 状态">
          <template #extra>
            <n-button size="tiny" type="primary" :loading="busy === 'ts-login'" @click="tsLogin">登录</n-button>
            <n-popconfirm @positive-click="act('ts-out', () => tailscale.logout(), '已退出 Tailscale')">
              <template #trigger><n-button size="tiny" :loading="busy === 'ts-out'">退出登录</n-button></template>
              确认退出 Tailscale 登录？
            </n-popconfirm>
          </template>
          <InfoRow label="启用" :value="tsCfg.enabled ? '已启用' : '未启用'" />
          <InfoRow label="本机 IP" :value="tsSt.ip || tsSt.tailscale_ip || '—'" mono />
          <InfoRow label="DNS" :value="Array.isArray(tsSt.dns) ? tsSt.dns.join(', ') : '—'" mono />
          <InfoRow label="后端状态" :value="String(tsSt.status ?? '—')" />
          <div v-if="tsAuth" class="login-url">
            <div class="dim">登录链接：</div>
            <div class="mono ellip">{{ tsAuth }}</div>
            <n-button size="tiny" @click="copyText(tsAuth, '登录链接')">复制</n-button>
          </div>
          <n-collapse style="margin-top: 12px">
            <n-collapse-item title="原始状态" name="r"><pre class="raw">{{ raw(tsSt) }}</pre></n-collapse-item>
          </n-collapse>
        </PanelCard>

        <PanelCard class="span-6" title="Tailscale 配置">
          <div class="sw">
            <span><b>启用 Tailscale</b><em>启动 tailscaled 并加入网络</em></span>
            <n-switch :value="!!tsCfg.enabled" :loading="busy === 'ts-en'" @update:value="(v) => act('ts-en', () => tailscale.setConfig({ ...tsCfg, enabled: v }), v ? '已启用' : '已停用')" />
          </div>
          <div class="sw">
            <span><b>作为出口节点</b><em>让其它设备经本机出网</em></span>
            <n-switch :value="!!tsCfg.run_exit_node" :loading="busy === 'ts-exit'" @update:value="(v) => act('ts-exit', () => tailscale.setConfig({ ...tsCfg, run_exit_node: v }), '已保存')" />
          </div>
          <div class="sw">
            <span><b>允许局域网访问</b><em>其它节点可访问本机 LAN</em></span>
            <n-switch :value="!!tsCfg.lan_enabled" :loading="busy === 'ts-lan'" @update:value="(v) => act('ts-lan', () => tailscale.setConfig({ ...tsCfg, lan_enabled: v }), '已保存')" />
          </div>
          <div class="sw">
            <span><b>允许访问 WAN</b><em>通过 WAN 侧访问</em></span>
            <n-switch :value="!!tsCfg.wan_enabled" :loading="busy === 'ts-wan'" @update:value="(v) => act('ts-wan', () => tailscale.setConfig({ ...tsCfg, wan_enabled: v }), '已保存')" />
          </div>
          <PageState :empty="!exitNodes.length" empty-text="没有可用的出口节点（需先在 Tailscale 后台授权）">
            <div class="cfg-title">可用出口节点</div>
            <div v-for="(n, i) in exitNodes" :key="i" class="cfg-item">
              <span>{{ n.name || n.hostname || n.ip || '节点 ' + (i + 1) }}</span>
              <span class="mono dim">{{ n.ip || '' }}</span>
            </div>
          </PageState>
        </PanelCard>
      </div>

      <!-- ============ ZeroTier ============ -->
      <div v-else-if="props.section === 'zerotier'" class="nui-grid">
        <PanelCard class="span-6" title="ZeroTier">
          <div class="sw">
            <span><b>启用 ZeroTier</b><em>虚拟二层组网</em></span>
            <n-switch :value="!!ztCfg.enabled" :loading="busy === 'zt-en'" @update:value="(v) => act('zt-en', () => zerotier.setConfig({ ...ztCfg, enabled: v }), v ? '已启用' : '已停用')" />
          </div>
          <div class="sw">
            <span><b>允许局域网访问</b><em>ZeroTier 网络可访问本机 LAN</em></span>
            <n-switch :value="!!ztCfg.lan_enabled" :loading="busy === 'zt-lan'" @update:value="(v) => act('zt-lan', () => zerotier.setConfig({ ...ztCfg, lan_enabled: v }), '已保存')" />
          </div>
          <div class="sw">
            <span><b>允许访问 WAN</b><em>ZeroTier 网络可访问 WAN 侧</em></span>
            <n-switch :value="!!ztCfg.wan_enabled" :loading="busy === 'zt-wan'" @update:value="(v) => act('zt-wan', () => zerotier.setConfig({ ...ztCfg, wan_enabled: v }), '已保存')" />
          </div>
          <div class="sub dim">加入/离开网络请在官方后台 ZeroTier 页操作；本页展示状态与开关。</div>
        </PanelCard>
        <PanelCard class="span-6" title="网络状态">
          <PageState :empty="!ztStatus.length" empty-text="尚未加入任何 ZeroTier 网络">
            <div v-for="(n, i) in ztStatus" :key="i" class="cfg-item">
              <span class="mono">{{ n.network_id || n.nwid || ('网络 ' + (i + 1)) }}</span>
              <span class="mono dim">{{ n.status ?? n.assigned_addresses ?? '' }}</span>
            </div>
          </PageState>
          <pre class="raw">{{ raw(ztCfg) }}</pre>
        </PanelCard>
      </div>

      <!-- ============ Tor ============ -->
      <div v-else-if="props.section === 'tor'" class="nui-grid">
        <PanelCard class="span-6" title="Tor 匿名网络">
          <div class="sw">
            <span><b>启用 Tor</b><em>通过 Tor 网络转发（速度较慢）</em></span>
            <n-switch :value="!!torCfg.enable" :loading="busy === 'tor-en'" @update:value="(v) => act('tor-en', () => tor.setConfig({ ...torCfg, enable: v }), v ? '已启用' : '已停用')" />
          </div>
          <div class="sw">
            <span><b>手动出口节点</b><em>自定义 ExitNodes</em></span>
            <n-switch :value="!!torCfg.manual" :loading="busy === 'tor-man'" @update:value="(v) => act('tor-man', () => tor.setConfig({ ...torCfg, manual: v }), '已保存')" />
          </div>
          <InfoRow label="国家限制" :value="Array.isArray(torCfg.countries) && torCfg.countries.length ? torCfg.countries.join(', ') : '不限'" />
          <InfoRow label="状态" :value="torStatus.length ? '运行中' : '未启用'" />
          <n-collapse style="margin-top: 12px"><n-collapse-item title="原始数据" name="r"><pre class="raw">{{ raw(data) }}</pre></n-collapse-item></n-collapse>
        </PanelCard>
        <PanelCard class="span-6" title="Tor 说明">
          <p class="p">GL 固件的 Tor 页面支持两种模式：全局透明代理与手动出口节点（国家/节点列表）。本面板提供启停与手动模式开关，节点列表编辑请使用官方后台（/gl_home.html 的 Tor 页）。</p>
          <p class="p dim">提示：Tor 会显著降低速率，测速前请先关闭。</p>
        </PanelCard>
      </div>

      <div v-else class="nui-grid">
        <PanelCard class="span-12" title="未知分区"><PageState empty empty-text="未知的 VPN 分区" /></PanelCard>
      </div>
    </PageState>
  </div>
</template>

<style scoped>
.status-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.sc { padding: 14px 16px; border-radius: 12px; background: var(--chip); border: 1px solid var(--line); cursor: pointer; transition: transform 0.15s, border-color 0.15s; }
.sc:hover { transform: translateY(-1px); border-color: var(--nui-accent); }
.sc-h { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; color: var(--nui-accent); }
.sc-h b { color: var(--text); }
.sc-sub { font-size: 11.5px; opacity: 0.55; margin-top: 6px; }
.tb { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tb th { text-align: left; font-weight: 500; opacity: 0.55; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.tb td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.tb tr:last-child td { border-bottom: 0; }
.tb.compact td, .tb.compact th { padding: 6px 8px; }
.b { font-weight: 600; }
.mono { font-family: var(--nui-mono, Consolas, monospace); font-size: 12px; }
.ellip { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle; }
.ops { display: flex; gap: 12px; white-space: nowrap; }
.ops a { color: var(--nui-accent); cursor: pointer; font-size: 12px; }
.ops a.danger { color: var(--err); }
.sw { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; border-bottom: 1px dashed var(--line); }
.sw:last-of-type { border-bottom: 0; }
.sw b { font-size: 13px; font-weight: 600; display: block; }
.sw em { font-style: normal; font-size: 11.5px; opacity: 0.55; }
.cfg-group { margin-bottom: 12px; }
.cfg-title { font-size: 12px; font-weight: 600; opacity: 0.7; margin: 10px 0 6px; }
.cfg-item { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.peer-add { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.raw { font-size: 11px; max-height: 240px; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-all; opacity: 0.8; }
.login-url { margin-top: 12px; padding: 10px; border-radius: 10px; background: var(--chip); font-size: 12px; display: grid; gap: 6px; }
.p { font-size: 13px; line-height: 1.9; margin: 0 0 10px; }
.dim { opacity: 0.6; }
.sub { font-size: 11.5px; margin-top: 12px; }
</style>
