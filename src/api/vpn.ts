import { api } from '@/api'

/**
 * VPN 与云服务数据层（官方 GL SDK4 rpc 对象）
 * 方法名全部来自官方视图产物提取 + 真机实测（见 docs/fe-vpn.md）
 */
export type Dict = Record<string, any>

/* ---------------- VPN 客户端（隧道 + 配置） ---------------- */
export const vpnClient = {
  status: () => api.call<Dict>('vpn-client', 'get_status'),
  allConfigs: () => api.call<Dict>('vpn-client', 'get_all_config_list'),
  connectionMethods: () => api.call<Dict>('vpn-client', 'get_connection_methods'),
  tunnel: () => api.call<Dict>('vpn-client', 'get_tunnel'),
  usingStatus: () => api.call<Dict[]>('vpn-client', 'get_vpn_using_status'),
  setTunnel: (p: Dict) => api.call('vpn-client', 'set_tunnel', p),
  removeTunnel: (p: Dict) => api.call('vpn-client', 'remove_tunnel', p),
  setDefaultTunnel: (p: Dict) => api.call('vpn-client', 'set_default_tunnel', p),
  setOptions: (p: Dict) => api.call('vpn-client', 'set_options', p),
  setTapS2s: (p: Dict) => api.call('vpn-client', 'set_tap_s2s', p),
  stop: () => api.call('vpn-client', 'stop'),
  addTunnel: (p: Dict) => api.call('vpn-client', 'add_tunnel', p),
  /* 各协议配置组 */
  wgGroups: () => api.call<Dict>('wg-client', 'get_group_list'),
  wgConfigs: () => api.call<Dict>('wg-client', 'get_config_list'),
  ovpnGroups: () => api.call<Dict>('ovpn-client', 'get_group_list'),
  ovpnConfigs: () => api.call<Dict>('ovpn-client', 'get_config_list'),
}

/* ---------------- WireGuard 服务端 ---------------- */
export const wgServer = {
  config: () => api.call<Dict>('wg-server', 'get_config'),
  setting: () => api.call<Dict>('wg-server', 'get_setting'),
  status: () => api.call<Dict>('wg-server', 'get_status'),
  peers: () => api.call<Dict>('wg-server', 'get_peer_list'),
  setConfig: (p: Dict) => api.call('wg-server', 'set_config', p),
  setSetting: (p: Dict) => api.call('wg-server', 'set_setting', p),
  start: () => api.call('wg-server', 'start'),
  stop: () => api.call('wg-server', 'stop'),
  genKey: () => api.call<Dict>('wg-server', 'generate_key'),
  generatePeer: (p: Dict) => api.call<Dict>('wg-server', 'generate_peer', p),
  generatePublickey: (p: Dict) => api.call<Dict>('wg-server', 'generate_publickey', p),
  addPeer: (p: Dict) => api.call('wg-server', 'add_peer', p),
  setPeer: (p: Dict) => api.call('wg-server', 'set_peer', p),
  removePeer: (p: Dict) => api.call('wg-server', 'remove_peer', p),
}

/* ---------------- OpenVPN 服务端 ---------------- */
export const ovpnServer = {
  config: () => api.call<Dict>('ovpn-server', 'get_config'),
  setting: () => api.call<Dict>('ovpn-server', 'get_setting'),
  users: () => api.call<Dict>('ovpn-server', 'get_user_list'),
  setConfig: (p: Dict) => api.call('ovpn-server', 'set_config', p),
  setSetting: (p: Dict) => api.call('ovpn-server', 'set_setting', p),
  addUser: (p: Dict) => api.call('ovpn-server', 'add_user', p),
  removeUser: (p: Dict) => api.call('ovpn-server', 'remove_user', p),
  generateCertificate: (p: Dict) => api.call<Dict>('ovpn-server', 'generate_certificate', p),
  exportConfig: (p: Dict) => api.call<Dict | string>('ovpn-server', 'export_config', p),
}

/* ---------------- 三方组网 ---------------- */
export const tailscale = {
  status: () => api.call<Dict>('tailscale', 'get_status'),
  config: () => api.call<Dict>('tailscale', 'get_config'),
  authUrl: () => api.call<Dict>('tailscale', 'get_auth_url'),
  exitNodes: () => api.call<Dict[]>('tailscale', 'get_exit_node_list'),
  setConfig: (p: Dict) => api.call('tailscale', 'set_config', p),
  logout: () => api.call('tailscale', 'logout'),
}

export const zerotier = {
  config: () => api.call<Dict>('zerotier', 'get_config'),
  status: () => api.call<Dict>('zerotier', 'get_status'),
  setConfig: (p: Dict) => api.call('zerotier', 'set_config', p),
}

export const tor = {
  config: () => api.call<Dict>('tor', 'get_config'),
  status: () => api.call<Dict>('tor', 'get_status'),
  setConfig: (p: Dict) => api.call('tor', 'set_config', p),
}

/* ---------------- 云服务 ---------------- */
export const cloud = {
  config: () => api.call<Dict>('cloud', 'get_config'),
  bindInfo: () => api.call<Dict | Dict[]>('cloud', 'bind_info'),
  bindUrl: () => api.call<Dict>('cloud', 'get_bind_url'),
  setConfig: (p: Dict) => api.call('cloud', 'set_config', p),
}

export const ddns = {
  config: () => api.call<Dict>('ddns', 'get_config'),
  status: () => api.call<Dict>('ddns', 'get_status'),
  setConfig: (p: Dict) => api.call('ddns', 'set_config', p),
}

export const sdwan = {
  config: () => api.call<Dict>('mptun', 'get_config'),
  started: () => api.call<Dict>('mptun', 'get_started', { bus: '' }),
  iprb: () => api.call<Dict>('mptun', 'get_IPRB_status'),
  token: () => api.call<Dict>('mptun', 'get_token'),
  setConfig: (p: Dict) => api.call('mptun', 'set_config', p),
  startService: () => api.call('mptun', 'start_service'),
  pauseService: () => api.call('mptun', 'pause_service'),
  startConnect: () => api.call('mptun', 'start_connect'),
  setUseExitNode: (p: Dict) => api.call('mptun', 'set_use_exit_node', p),
  reset: () => api.call('mptun', 'reset'),
}

/** 从 ddns.get_status 里挑出有 IP 的记录 */
export function ddnsIps(status: Dict | null): { interface: string; ip: string[] }[] {
  const list = Array.isArray(status?.ips) ? status!.ips : []
  return list
    .map((x: any) => ({ interface: String(x.interface ?? ''), ip: Array.isArray(x.ip) ? x.ip.map(String) : [] }))
    .filter((x) => x.ip.length > 0)
}
