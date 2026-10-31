import type { Client, CloudBundle, DeviceApi, Health, SysInfo, WanInfo, WifiConfig, WifiStatus } from './types'

/* 离线演示实现：没有真机时用它跑通整个界面（?demo=1） */

let t = 0
const jitter = (base: number, amp: number) => Math.max(0, base + Math.sin(t / 7) * amp + (Math.random() - 0.5) * amp)

const NAMES = [
  ['iPhone 16 Pro', '5g', 'A4:83:E7:2C:19:5B'],
  ['MacBook Pro', '5g', '3C:22:FB:8D:41:07'],
  ['MacBook Air', '5g', '9E:1B:4A:66:02:CD'],
  ['客厅电视', '5g', 'B8:27:EB:11:8F:20'],
  ['小爱音箱', '2g', '64:6E:97:03:AA:12'],
  ['米家台灯', '2g', 'F0:B4:29:71:3D:88'],
  ['iPad mini', '5g', 'DA:31:5C:90:BE:44'],
  ['Switch', '5g', '98:B6:E9:27:04:6A'],
  ['台式机', 'lan', '1C:69:7A:33:0D:F1'],
] as const

const clients = (): Client[] =>
  NAMES.map(([name, iface, mac], i) => ({
    name,
    iface,
    mac,
    ip: `192.168.8.${100 + i}`,
    online: i < 7,
    online_time: 3600 * (3 + i * 5),
    rx: Math.round(jitter(120_000 * (1 + i / 3), 40_000)),
    tx: Math.round(jitter(30_000 * (1 + i / 4), 12_000)),
    total_rx: 1_240_000_000 * (i + 1),
    total_tx: 320_000_000 * (i + 1),
  }))

const wifiConfig: WifiConfig = {
  bands: [
    { band: '2.4G', ssid: 'Beryl-7-2.4G', channel: 6, enabled: true, enc: 'WPA2/WPA3', device: 'mt7990', wifi_type: '11be' },
    { band: '5G', ssid: 'Beryl-7', channel: 149, enabled: true, enc: 'WPA2/WPA3', device: 'mt7990', wifi_type: '11be' },
    { band: '5G', ssid: 'Beryl-7-Guest', channel: 149, enabled: true, enc: 'WPA2', device: 'mt7990', guest: true },
  ],
}

const wifiStatus: WifiStatus = {
  count: 7,
  bands: [
    { band: '2.4G', ssid: 'Beryl-7-2.4G', channel: 6, enabled: true, device: 'mt7990' },
    { band: '5G', ssid: 'Beryl-7', channel: 149, enabled: true, device: 'mt7990' },
  ],
}

const wanInfo: WanInfo = {
  interface: 'wan',
  protocol: 'dhcp',
  ip: '192.168.1.23',
  netmask: '255.255.255.0',
  gateway: '192.168.1.1',
  dns: ['223.5.5.5', '119.29.29.29'],
  up: true,
  mac: '94:83:C4:AF:20:6E',
  uptime: 86_400,
}


/* ---------- 演示用的通用 RPC 路由 ---------- */
const DEMO_STATE: Record<string, unknown> = {
  'black_white_list.get_config': { mode: 'disable', black_mac: ['B8:27:EB:11:8F:20'], white_mac: [] },
  'lan.get_static_bind_list': [{ mac: '1C:69:7A:33:0D:F1', ip: '192.168.8.150', name: '台式机' }],
  'firewall.get_port_forward_list': [
    { name: 'NAS', proto: 'tcp', ext_port: '5000', int_ip: '192.168.8.150', int_port: '5000', enabled: true },
  ],
  'firewall.get_dmz': { enabled: false, ip: '' },
  'firewall.get_zone_list': [{ name: 'wan', networks: ['wan'] }, { name: 'lan', networks: ['lan'] }],
  'firewall.get_rule_list': [
    { name: '限制电视上网', mac: 'B8:27:EB:11:8F:20', enabled: true, start: '22:00', end: '07:00' },
  ],
  'firewall.get_wan_access': { enable: false, port: 80, https: true },
  'network.get_advance_config': { nat: true, upnp: true, sip: false, igmp: true, hwnat: true },
  'network.get_netnat_config': { enable: true, mode: 'auto' },
  'wifi.get_mlo_config': { res: true, data: [{ name: 'wlanmld0', mlo_enable: true, mlo_band: ['2', '5'] }] },
  'timer.get_reboot': { enable: false, hour: 4, minute: 0, week: [1, 2, 3, 4, 5, 6, 0] },
  'timer.get_wifi': { enable: false, hour: 0, minute: 0 },
  'timer.get_led': { enable: true, start: '08:00', end: '23:00' },
  'logread.get_config': { level: 3, size: 512 },
  'led.get_config': { enable: true, brightness: 100, status: 'on' },
  'switch-button.get_config': { funcs: ['wifi', 'led', 'vpn'], mode: 'toggle' },
  'switch-button.get_funcs': [
    { value: 'wifi', label: 'WiFi 开关' },
    { value: 'led', label: '指示灯' },
    { value: 'vpn', label: 'VPN' },
    { value: 'none', label: '不启用' },
  ],
  'fanctrl.get_status': {
    enabled: true,
    mode: 'auto',
    start_temp: 70,
    wall_temp: 76,
    critical_temp: 88,
    hysteresis: 3,
    start_percent: 35,
    max_percent: 100,
    manual_percent: 0,
    poll_interval: 2,
    speed: 1900,
    temp: 52,
  },
  'kmwan.get_status': {
    data: [
      { name: 'wan', status: 'online', ip: '192.168.1.23', gateway: '192.168.1.1', latency: 9, weight: 1 },
      { name: 'wan6', status: 'online', ip: '2408:8207:1a2b::5e21', gateway: 'fe80::1', latency: 11, weight: 1 },
    ],
  },
  'cable.get_config': { protocol: 'dhcp', ipv4: { ip: '192.168.1.23' }, ipv6: true },
  'repeater.scan': [
    { ssid: 'TP-LINK_5G', bssid: 'A0:BD:1D:22:33:44', channel: 149, signal: -48, encryption: 'WPA2', band: '5G' },
    { ssid: 'ChinaNet-8x2k', bssid: 'C4:12:34:56:78:90', channel: 6, signal: -61, encryption: 'WPA2', band: '2.4G' },
    { ssid: 'Xiaomi_AX3000', bssid: '5C:02:14:AA:BB:CC', channel: 44, signal: -72, encryption: 'WPA3', band: '5G' },
  ],
  'diag.ping': { output: 'PING 223.5.5.5: 56 data bytes\n64 bytes from 223.5.5.5: seq=0 ttl=118 time=8.2 ms\n64 bytes from 223.5.5.5: seq=1 ttl=118 time=7.9 ms\n\n--- 223.5.5.5 statistics ---\n2 packets transmitted, 2 received, 0% packet loss' },
  'diag.traceroute': { output: 'traceroute to 223.5.5.5\n 1  192.168.8.1  0.9 ms\n 2  10.10.10.1  4.1 ms\n 3  223.5.5.5  8.4 ms' },
  'logread.get_system_log': { log: 'Thu Oct 24 17:00:01 2026 daemon.info dnsmasq[2311]: started\nThu Oct 24 17:00:02 2026 user.notice firewall: reload done' },
  'logread.get_kernel_log': { log: '[    0.000000] Booting Linux on physical CPU 0x0000000000\n[    0.412000] mt7987-pinctrl 1001f000.pinctrl: initialized' },
}

function demoCall<T>(obj: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const key = `${obj}.${method}`
  if (method.startsWith('set_') || method.startsWith('add_') || method.startsWith('remove_') || method === 'reboot') {
    return new Promise((r) => setTimeout(() => r({ res: true } as T), 260))
  }
  if (key === 'wifi.get_config') return Promise.resolve(wifiConfig as T)
  if (key === 'lan.get_config_list') return Promise.resolve({ lan: [{ interface: 'lan', ip: '192.168.8.1', netmask: '255.255.255.0', dhcp: true, start: '192.168.8.100', end: '192.168.8.249' }] } as T)
  if (key === 'system.get_info') return Promise.resolve({ model: 'GL-MT3600BE', firmware_version: '4.9.0' } as T)
  if (key in DEMO_STATE) return Promise.resolve(structuredClone(DEMO_STATE[key]) as T)
  return Promise.resolve({ res: true, params } as T)
}

export const demoApi: DeviceApi = {
  kind: 'demo',

  call: demoCall,

  async login() {
    await new Promise((r) => setTimeout(r, 420))
  },
  async logout() {},
  async alive() {
    return true
  },

  async health(): Promise<Health> {
    t += 1
    const cores = [0, 1, 2, 3].map((i) => Math.round(jitter(8 + i * 4, 10)))
    return {
      cpu: Math.round(cores.reduce((a, b) => a + b, 0) / cores.length),
      cores,
      memTotal: 512 * 1024 * 1024,
      memUsed: Math.round(205 * 1024 * 1024),
      memPct: 40,
      temps: [
        { name: 'soc_thermal', temp: Math.round(jitter(52, 3) * 10) / 10 },
        { name: 'wifi_thermal', temp: Math.round(jitter(61, 3) * 10) / 10 },
      ],
      temp: Math.round(jitter(52, 3) * 10) / 10,
      fan: Math.round(jitter(1900, 220)),
      disk: { total: 512, used: 176 },
      uptime: 3 * 86400 + 7 * 3600 + 12 * 60,
      load: [0.32, 0.28, 0.21],
    }
  },

  async speed() {
    t += 1
    const spike = Math.sin(t / 11) > 0.86 ? 8 : 1
    return { rx: Math.round(jitter(2_400_000 * spike, 700_000)), tx: Math.round(jitter(420_000, 160_000)) }
  },

  async info(): Promise<SysInfo> {
    return {
      model: 'GL-MT3600BE',
      firmware_version: '4.9.0',
      firmware_type: 'release1',
      hardware: 'MT7987A',
      sn: 'MT3600BE2409150037',
      ddns: 'mt3600be-37.glddns.com',
    }
  },

  async wan() {
    return wanInfo
  },

  async wifi() {
    return { config: wifiConfig, status: wifiStatus }
  },

  async clients() {
    return clients()
  },

  async cable() {
    return true
  },

  async networkStatus() {
    return {
      wan: { up: true, dns: ['223.5.5.5', '119.29.29.29'], gateway: '192.168.1.1' },
      lan: { ip: '192.168.8.1', netmask: '255.255.255.0' },
      dns: ['223.5.5.5', '119.29.29.29'],
    }
  },

  async publicIp() {
    return '113.87.24.196'
  },

  async lanConfig() {
    return {
      lan: [{ interface: 'lan', ip: '192.168.8.1', netmask: '255.255.255.0', dhcp: true, start: '192.168.8.100', end: '192.168.8.249' }],
      guest: [{ interface: 'guest', ip: '192.168.9.1', netmask: '255.255.255.0', dhcp: true }],
    }
  },

  async arp() {
    return clients().map((c) => ({ ip: c.ip, mac: c.mac, iface: c.iface }))
  },

  async cloud(): Promise<CloudBundle> {
    return {
      cfg: { cloud_enable: true, rtty_ssh: true, rtty_web: false, server: 'ap' },
      bind: { username: 'kou@example.com', bind_time: '2026-09-18 21:04:11' },
      meta: { cloud_url: 'cloud.gl-inet.cn', region: 'CN', running: true },
      ddns: { enable_ddns: true, ddns_id: 'mt3600be-37' },
      ddnsStatus: { ipv4: '113.87.24.196', ipv6: '2408:8207:1a2b::5e21', status: 'ok' },
      sdbundle: { enable: false },
      bindUrl: 'https://cloud.gl-inet.cn/bind?dev=mt3600be-37',
    }
  },

  async setCloud() {
    await new Promise((r) => setTimeout(r, 260))
  },
  async setDdns() {
    await new Promise((r) => setTimeout(r, 260))
  },
}
