import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { isDemo } from '@/api'

/**
 * 高级后台 v3 路由表（由 Lead 统一维护，队员不要修改本文件）
 *
 * 约定：
 *  - 一个「功能域」= 一个 .vue 组件，域内多个 section 通过 props.section 切换
 *  - NAV 同时驱动侧栏菜单与面包屑；新增页面必须同时进 NAV
 *  - 动态 import 的组件路径必须真实存在（构建期校验）
 */
const router = createRouter({
  // 部署在 /www/glass/ 下，用 hash 路由避免依赖 nginx rewrite
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      redirect: '/overview',
      children: [
        { path: 'overview', name: 'overview', component: () => import('@/views/OverviewView.vue') },
        { path: 'clients', name: 'clients', component: () => import('@/views/ClientsView.vue') },
        { path: 'about', name: 'about', component: () => import('@/views/AboutView.vue') },

        // 蜂窝网络
        {
          path: 'cellular/:section',
          name: 'cellular',
          component: () => import('@/views/CellularView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'status') }),
        },
        { path: 'cellular/sms', name: 'sms', component: () => import('@/views/SmsView.vue') },

        // 互联网
        {
          path: 'internet/:section',
          name: 'internet',
          component: () => import('@/views/InternetView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'wan') }),
        },

        // 无线
        {
          path: 'wireless/:section',
          name: 'wireless',
          component: () => import('@/views/WirelessView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'wifi') }),
        },

        // 网络
        {
          path: 'network/:section',
          name: 'network',
          component: () => import('@/views/NetworkView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'lan') }),
        },

        // 安全
        {
          path: 'security/:section',
          name: 'security',
          component: () => import('@/views/SecurityView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'firewall') }),
        },

        // 流控
        {
          path: 'flow/:section',
          name: 'flow',
          component: () => import('@/views/FlowView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'stats') }),
        },

        // VPN 与组网
        {
          path: 'vpn/:section',
          name: 'vpn',
          component: () => import('@/views/VpnView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'dashboard') }),
        },

        // 云服务
        {
          path: 'cloud/:section',
          name: 'cloud',
          component: () => import('@/views/CloudView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'goodcloud') }),
        },

        // 应用
        {
          path: 'apps/app/:pkg',
          name: 'app-detail',
          component: () => import('@/views/AppView.vue'),
        },
        {
          path: 'apps/:section',
          name: 'apps',
          component: () => import('@/views/AppsView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'store') }),
        },

        // 工具
        // 网络测速用独立页面（与 NUI 插件四 tab 一致），放在动态 :section 之前
        {
          path: 'tools/speedtest',
          name: 'speedtest',
          component: () => import('@/views/SpeedTestPage.vue'),
        },
        {
          path: 'tools/:section',
          name: 'tools',
          component: () => import('@/views/ToolsView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'diag') }),
        },

        // 系统
        {
          path: 'system/:section',
          name: 'system',
          component: () => import('@/views/SystemView.vue'),
          props: (r) => ({ section: sectionFor(r.path) ?? String(r.params.section || 'info') }),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/overview' },
  ],
})

/** 侧栏导航（顺序即界面顺序）；label 即面包屑与页面标题 */
export const NAV = [
  { key: '/overview', label: '概览' },
  {
    label: '蜂窝网络',
    children: [
      { key: '/cellular/status', label: '蜂窝状态', section: 'status' },
      { key: '/cellular/sim', label: 'SIM 与 APN', section: 'sim' },
      { key: '/cellular/lock', label: '锁频与锁小区', section: 'lock' },
      { key: '/cellular/data', label: '流量统计', section: 'data' },
      { key: '/cellular/at', label: 'AT 调试', section: 'at' },
      { key: '/cellular/sms', label: '短信', view: 'sms' },
    ],
  },
  {
    label: '互联网',
    children: [
      { key: '/internet/wan', label: '上网设置', section: 'wan' },
      { key: '/internet/multiwan', label: '多 WAN 与切网', section: 'multiwan' },
    ],
  },
  {
    label: '无线',
    children: [
      { key: '/wireless/wifi', label: 'Wi-Fi 设置', section: 'wifi' },
      { key: '/wireless/guest', label: '访客与 IoT', section: 'guest' },
      { key: '/wireless/repeater', label: '中继与桥接', section: 'repeater' },
      { key: '/wireless/acl', label: '黑白名单', section: 'acl' },
    ],
  },
  { key: '/clients', label: '终端设备' },
  {
    label: '网络',
    children: [
      { key: '/network/lan', label: '局域网与 DHCP', section: 'lan' },
      { key: '/network/dhcp', label: '静态地址绑定', section: 'dhcp' },
      { key: '/network/dns', label: 'DNS', section: 'dns' },
      { key: '/network/ipv6', label: 'IPv6', section: 'ipv6' },
      { key: '/network/nat', label: '端口映射与 DMZ', section: 'nat' },
      { key: '/network/routes', label: '静态路由', section: 'routes' },
      { key: '/network/igmp', label: 'IGMP Snooping', section: 'igmp' },
      { key: '/network/adv', label: '高级网络', section: 'adv' },
    ],
  },
  {
    label: '安全',
    children: [
      { key: '/security/firewall', label: '防火墙', section: 'firewall' },
      { key: '/security/acl', label: '访问控制', section: 'acl' },
      { key: '/security/remote', label: '远程访问管理', section: 'remote' },
      { key: '/security/parental', label: '家长控制', section: 'parental' },
      { key: '/security/dpi', label: '应用管控', section: 'dpi' },
    ],
  },
  {
    label: '流控',
    children: [
      { key: '/flow/stats', label: '流量统计', section: 'stats' },
      { key: '/flow/qos', label: 'QoS 限速', section: 'qos' },
      { key: '/flow/sqm', label: 'SQM 智能队列', section: 'sqm' },
    ],
  },
  {
    label: 'VPN 与组网',
    children: [
      { key: '/vpn/dashboard', label: 'VPN 概览', section: 'dashboard' },
      { key: '/vpn/client', label: 'VPN 客户端', section: 'client' },
      { key: '/vpn/wg-server', label: 'WireGuard 服务端', section: 'wg-server' },
      { key: '/vpn/ovpn-server', label: 'OpenVPN 服务端', section: 'ovpn-server' },
      { key: '/vpn/tailscale', label: 'Tailscale', section: 'tailscale' },
      { key: '/vpn/zerotier', label: 'ZeroTier', section: 'zerotier' },
      { key: '/vpn/tor', label: 'Tor', section: 'tor' },
    ],
  },
  {
    label: '云服务',
    children: [
      { key: '/cloud/goodcloud', label: 'GoodCloud 远程', section: 'goodcloud' },
      { key: '/cloud/ddns', label: 'DDNS', section: 'ddns' },
      { key: '/cloud/sdwan', label: 'SD-WAN / AstroWarp', section: 'sdwan' },
    ],
  },
  {
    label: '应用',
    children: [
      { key: '/apps/store', label: '插件管理', section: 'store' },
      { key: '/apps/nas', label: '文件共享', section: 'nas' },
      { key: '/apps/adguard', label: 'AdGuard Home', section: 'adguard' },
    ],
  },
  {
    label: '工具',
    children: [
      { key: '/tools/speedtest', label: '网络测速', section: 'speedtest' },
      { key: '/tools/diag', label: '网络诊断', section: 'diag' },
      { key: '/tools/monitor', label: '历史监控', section: 'monitor' },
      { key: '/tools/conn', label: '联网检测', section: 'conn' },
    ],
  },
  {
    label: '系统',
    children: [
      { key: '/system/info', label: '系统信息', section: 'info' },
      { key: '/system/password', label: '账号与 SSH', section: 'password' },
      { key: '/system/upgrade', label: '固件升级', section: 'upgrade' },
      { key: '/system/timer', label: '定时任务', section: 'timer' },
      { key: '/system/timezone', label: '时区与 NTP', section: 'timezone' },
      { key: '/system/button', label: '按钮设置', section: 'button' },
      { key: '/system/fan', label: '风扇与温度', section: 'fan' },
      { key: '/system/reset', label: '重启与恢复', section: 'reset' },
      { key: '/system/logs', label: '系统日志', section: 'logs' },
      { key: '/system/advanced', label: '高级设置', section: 'advanced' },
      { key: '/system/ui', label: '界面设置', section: 'ui' },
    ],
  },
  { key: '/about', label: '关于' },
] as const

export interface NavItem {
  key: string
  label: string
  group: string
  section?: string
}

export const NAV_FLAT: NavItem[] = (() => {
  const out: NavItem[] = []
  for (const g of NAV as readonly any[]) {
    if (g.children) {
      for (const c of g.children) out.push({ key: c.key, label: c.label, group: g.label, section: c.section })
    } else {
      out.push({ key: g.key, label: g.label, group: '' })
    }
  }
  return out
})()

/** 当前路由应渲染的页面内 section（同一个页面组件按 section 切换内容） */
export function sectionFor(path: string): string | undefined {
  return NAV_FLAT.find((c) => c.key === path)?.section
}

/** 面包屑标题 */
export function titleFor(path: string): { group: string; title: string } {
  const hit = NAV_FLAT.find((c) => c.key === path)
  if (hit) return { group: hit.group, title: hit.label }
  return { group: '', title: '概览' }
}

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  if (!isDemo && !auth.loggedIn) return { path: '/login', query: { next: to.fullPath } }
  return true
})

export default router
