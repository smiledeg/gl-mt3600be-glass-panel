/**
 * fe-sys 数据层：系统 + 应用（信息/密码/SSH/升级/定时/时区/按钮/风扇/重置/日志/高级/界面 + 应用商店/NAS/AdGuard）
 *
 * 方法名来源：`docs/api-official.md`（52 个官方视图逐页接口 + 真机实测）与
 * `_recon_official/views/*.common.js`。真机实测版本：GL-MT3600BE / 4.9.0。
 *
 * 约定：
 *  - 视图里不写 fetch，本文件统一走 `api.call`（`/rpc`）与 `nui.invoke`（插件桥）；
 *  - 唯一例外是 nginx 独立 location：`/upload`（固件上传）、`/download`（日志导出下载）、
 *    `/cgi-bin/cgi-backup`（配置备份），它们是官方前端的同一套非 RPC 通道，由本文件封装；
 *  - 长任务（在线升级检查 / 本地固件校验 / 软件源刷新）显式传 timeout。
 */
import { api } from './index'
import { nui } from './nui'

/** 失败兜底：探测类调用失败返回 fallback，不打断整页 */
const swallow = async <T>(p: Promise<T>, fb: T): Promise<T> =>
  p.catch(() => fb)

/** 部分官方读写需要更长的超时（毫秒） */
export const TIMEOUT = {
  check: 60_000,
  upgrade: 180_000,
  repo: 180_000,
  nas: 35_000,
}

/* ========================================================================
 * 1. 系统信息
 * ===================================================================== */

export interface SysInfo {
  vendor?: string
  firmware_type?: string
  firmware_version?: string
  firmware_date?: string
  mac?: string
  sn?: string
  sn_bak?: string
  model?: string
  ddns?: string
  country_code?: string
  cpu_num?: number
  hardware_version?: string
  hardware_feature?: Record<string, any>
  software_feature?: Record<string, any>
  board_info?: {
    architecture?: string
    hostname?: string
    kernel_version?: string
    openwrt_version?: string
    model?: string
  }
  [k: string]: unknown
}

export interface SysLoad {
  memory_total?: number
  memory_free?: number
  memory_buff_cache?: number
  swap_total?: number
  swap_free?: number
  load_average?: number[]
}

export interface SysStatusSystem {
  lan_ip?: string
  uptime?: number
  timestamp?: number
  tzoffset?: string
  memory_total?: number
  memory_free?: number
  flash_total?: number
  flash_free?: number
  flash_app?: number
  cpu?: { temperature?: number }
  load_average?: number[]
  /** 0 = 路由模式 */
  mode?: number
  ipv6_enabled?: boolean
  netnat_enabled?: boolean
  qos_enabled?: boolean
  sqm_enabled?: boolean
  ddns_enabled?: boolean
  time_sync_status?: boolean
  [k: string]: unknown
}

export interface SysStatus {
  network?: { online?: boolean; up?: boolean; interface?: string }[]
  wifi?: Record<string, any>[]
  service?: { name: string; status: number }[]
  client?: Record<string, any>[]
  system?: SysStatusSystem
  [k: string]: unknown
}

/** 自有 glass RPC 的实时状态（温度/风扇/内存/磁盘/CPU） */
export interface GlassStatus {
  hostname?: string
  uptime?: number
  localtime?: number
  cpu_avg?: number
  cpu?: number[]
  load?: number[]
  temps?: { name: string; temp: number }[]
  fan?: { speed?: number; status?: boolean }
  memory?: { total?: number; used?: number; free?: number; cached?: number; buffers?: number; available?: number }
  disk?: { used?: number; total?: number; percent?: number; available?: number }
  [k: string]: unknown
}

/** 插件桥 sys.details 的精简结构（只用到的字段） */
export interface SysDetails {
  device?: Record<string, any>
  runtime?: {
    uptime?: number
    timezone?: string
    ntp_servers?: string[]
    ntp?: boolean
    localtime?: number
    load?: number[]
    procs?: number
    conntrack?: number
    conntrack_max?: number
  }
  memory?: Record<string, number>
  swap?: { total?: number; free?: number }
  storage?: { fs?: string; mount?: string; total?: number; used?: number; avail?: number }[]
  cpu?: { freq_khz?: number; freq_max_khz?: number; usage?: number; cores?: number; model?: string }
  sensors?: { name?: string; temp?: number }[]
  netdevs?: Record<string, any>[]
  interfaces?: Record<string, any>[]
}

export interface SystemBundle {
  info: SysInfo | null
  load: SysLoad | null
  status: SysStatus | null
  glass: GlassStatus | null
  usbInfo: { value: string; label: string }[] | null
  usbConfig: { protocol?: string } | null
  tz: TimezoneConfig | null
}

/** 系统信息页一次拿全（并发；单项失败不影响其它项） */
export async function getSystemBundle(): Promise<SystemBundle> {
  const [info, load, status, glass, usbInfo, usbConfig, tz] = await Promise.all([
    swallow(api.call<SysInfo>('system', 'get_info'), null),
    swallow(api.call<SysLoad>('system', 'get_load'), null),
    swallow(api.call<SysStatus>('system', 'get_status'), null),
    swallow(api.call<GlassStatus>('glass', 'get_status'), null),
    swallow(api.call<{ value: string; label: string }[]>('system', 'get_usb_info'), null),
    swallow(api.call<{ protocol?: string }>('system', 'get_usb_config'), null),
    swallow(api.call<TimezoneConfig>('system', 'get_timezone_config'), null),
  ])
  return { info, load, status, glass, usbInfo, usbConfig, tz }
}

/** 插件桥系统详情（传感器/存储/运行时长/NTP）；桥不可用时返回 null */
export async function getSysDetails(): Promise<SysDetails | null> {
  try {
    return await nui.invoke<SysDetails>('sys.details', {})
  } catch {
    return null
  }
}

/** 设置 USB 口协议（官方 overview 页同款；会重新枚举 USB，慎用） */
export const setUsbProtocol = (protocol: string) =>
  api.call('system', 'set_usb_config', { protocol })

/** 单个读取（应用页用来取能力位：software_feature.adguard / nas / ksmbd） */
export const getSystemInfo = () => api.call<SysInfo>('system', 'get_info')

/** 单个读取（应用页用来取服务运行状态：service[]） */
export const getSystemStatus = () => api.call<SysStatus>('system', 'get_status')
export const getGlassStatus = () => api.call<GlassStatus>('glass', 'get_status')

/* ========================================================================
 * 2. 管理员密码 / SSH
 * ===================================================================== */

/** 修改 root 管理员密码（官方 admin-password 页同款；服务端做哈希与强度校验） */
export async function changePassword(oldPwd: string, newPwd: string): Promise<void> {
  await api.call(
    'system',
    'set_password',
    { old_password: oldPwd, new_password: newPwd, username: 'root' },
    { timeout: TIMEOUT.check },
  )
}

export interface SshState {
  enabled?: boolean
  running?: boolean
  boot?: boolean
  port?: number
  password_auth?: boolean
  root_password_auth?: boolean
  keys?: string[]
  firewall?: string
  adbd_supported?: boolean
  legacy_plugin?: boolean
  [k: string]: unknown
}

/** SSH 状态：插件桥 enh.ssh_get（dropbear uci + 进程 + 公钥） */
export const getSsh = () => nui.invoke<SshState>('enh.ssh_get', {})

/**
 * SSH 开关 / 端口 / 认证方式（插件桥 enh.ssh_set）。
 * 注意：该接口会 reload 防火墙并重启 dropbear；关闭密码登录前必须已有公钥（后端会拦）。
 */
export async function saveSsh(patch: Partial<SshState>): Promise<SshState> {
  return nui.invoke<SshState>('enh.ssh_set', {
    enabled: patch.enabled,
    port: patch.port,
    password_auth: patch.password_auth,
    root_password_auth: patch.root_password_auth,
    keys: patch.keys,
  })
}

/* ========================================================================
 * 3. 定时任务（timer.*）
 * ===================================================================== */

export type TimerKind = 'reboot' | 'wifi' | 'led' | 'screen'

export interface TimerReboot {
  enable?: boolean
  week?: number[]
  hour?: string
  min?: string
}

export interface TimerOnOff {
  enable?: boolean
  week?: number[]
  turnon_hour?: string
  turnon_min?: string
  turnoff_hour?: string
  turnoff_min?: string
}

export interface TimerWifiEntry {
  band?: string
  guest?: number
  func?: 'turn_onoff' | 'power_switch'
  enable?: boolean
  week?: number[]
  /* turn_onoff */
  turnon_hour?: string
  turnon_min?: string
  turnoff_hour?: string
  turnoff_min?: string
  /* power_switch */
  switch_hour?: string
  switch_min?: string
  restore_hour?: string
  restore_min?: string
  switch_power?: string
  restore_power?: string
  [k: string]: unknown
}

export interface TimerWifiResp {
  wifi?: TimerWifiEntry[]
  wifi_func_2g?: string
  wifi_func_5g?: string
  [k: string]: unknown
}

export interface TimerAll {
  reboot: TimerReboot | null
  wifi: TimerWifiResp | null
  led: TimerOnOff | null
  screen: TimerOnOff | null
}

/** 四类定时任务一次读全 */
export async function getTimers(): Promise<TimerAll> {
  const [reboot, wifi, led, screen] = await Promise.all([
    swallow(api.call<TimerReboot>('timer', 'get_reboot'), null),
    swallow(api.call<TimerWifiResp>('timer', 'get_wifi'), null),
    swallow(api.call<TimerOnOff>('timer', 'get_led'), null),
    swallow(api.call<TimerOnOff>('timer', 'get_screen'), null),
  ])
  return { reboot, wifi, led, screen }
}

export const getTimer = (kind: TimerKind) => api.call<Record<string, unknown>>('timer', `get_${kind}`)

/** 保存定时任务；payload 与 get_* 同构（官方视图同款） */
export const setTimer = (kind: TimerKind, payload: Record<string, unknown>) =>
  api.call('timer', `set_${kind}`, payload, { timeout: TIMEOUT.check })

/* ========================================================================
 * 4. 时区 / NTP
 * ===================================================================== */

export interface TimezoneConfig {
  zonename?: string
  timezone?: string
  tzoffset?: string
  autotimezone_enabled?: boolean
  localtime?: number
  timestamp?: number
}

export interface TimezoneItem {
  zonename: string
  timezone: string
  links?: string[]
}

export const getTimezoneConfig = () => api.call<TimezoneConfig>('system', 'get_timezone_config')

let tzListCache: TimezoneItem[] | null = null
/** 时区列表（45 KB，成功一次后进程内缓存；可按 force 重新拉） */
export async function getTimezoneList(force = false): Promise<TimezoneItem[]> {
  if (tzListCache && !force) return tzListCache
  const r = await api.call<{ timezone_list?: TimezoneItem[] }>('system', 'get_timezone_list', {}, { timeout: TIMEOUT.check })
  tzListCache = Array.isArray(r?.timezone_list) ? r.timezone_list : []
  return tzListCache
}

/** 写时区：{zonename, timezone, localtime?}（官方 timezone 页 handleApply / handleSync 同款） */
export const setTimezoneConfig = (p: TimezoneConfig & { localtime?: number }) =>
  api.call('system', 'set_timezone_config', { ...p }, { timeout: TIMEOUT.check })

/* ========================================================================
 * 5. 拨动开关（switch-button.*）
 * ===================================================================== */

export interface SwitchButtonConfig {
  func?: string
  sub_func?: string
  [k: string]: unknown
}

export interface SwitchFuncItem {
  func: string
  sub_func?: { func: string }[]
}

export const getSwitchButton = () => api.call<SwitchButtonConfig>('switch-button', 'get_config')
export const getSwitchFuncs = () => api.call<{ funcs?: SwitchFuncItem[] }>('switch-button', 'get_funcs')

/**
 * 保存拨动开关功能。官方 view 会先 check_sync_status（mesh 同步），单体机不需要；
 * 这里直接 set_config，sync=false 表示不做 mesh 同步。
 */
export const setSwitchButton = (p: { func?: string; sub_func?: string }) =>
  api.call('switch-button', 'set_config', { func: p.func, sub_func: p.sub_func, sync: false }, { timeout: TIMEOUT.check })

/** 拨动开关当前物理位置（glass 对象，读 GL 官方 get_switch_button_status / sysfs gpio） */
export interface SwitchStatus {
  position?: 'on' | 'off' | null
  supported?: boolean
  raw_status?: string
  func?: string | null
  sub_func?: string | null
  model?: string | null
  gpio?: string | null
}

/** 当前开关位置：on / off；无硬件开关时 position 为 null、supported=false */
export const getSwitchStatus = () => api.call<SwitchStatus>('glass', 'switch_status')
/** 官方内置功能名 → 中文说明（来自官方 i18n btnsettings.*，本机 get_funcs 实测只有这 5 项） */
export const SWITCH_FUNC_LABEL: Record<string, string> = {
  none: '无功能',
  led: '指示灯开关',
  wifi: 'Wi-Fi 开关',
  main_wifi: '主 Wi-Fi 开关',
  repeater: '中继开关',
  tor: 'Tor 开关',
  adguardhome: 'AdGuard Home 开关',
  vpn: 'VPN 开关',
  cellular: '蜂窝开关',
}

/* ========================================================================
 * 6. 风扇 / 温度
 * ===================================================================== */

/** fanctrl（gl-fanctrl 插件提供的 RPC 对象，真机可用；非原厂对象） */
export interface FanctrlConfig {
  enabled: number
  mode: 'auto' | 'manual'
  start_temp: number
  wall_temp: number
  critical_temp: number
  hysteresis: number
  start_percent: number
  max_percent: number
  manual_percent: number
  poll_interval: number
}

export interface FanctrlStatus {
  config: FanctrlConfig
  rpm?: number
  temp?: number
  temperature?: number | null
  state?: string
  pwm?: number
  pwm_max?: number
  supported?: boolean
  takeover?: boolean
  official_running?: boolean
  plugin_running?: boolean
  temp_path?: string
  cooling_path?: string
  hwmon_path?: string
  model?: string
  [k: string]: unknown
}

export interface FanOfficialStatus {
  speed?: number
  status?: boolean
}

export interface FanOfficialConfig {
  /** 告警温度（overview 卡片里的阈值展示） */
  warn_temperature?: number
  temperature?: number
}

/** 风扇状态：优先 fanctrl（有 config/state/pwm），退回原厂 fan.get_status */
export async function getFanState(): Promise<
  { source: 'fanctrl' | 'fan'; fanctrl: FanctrlStatus | null; official: FanOfficialStatus | null }
> {
  const [fc, off] = await Promise.all([
    swallow(api.call<FanctrlStatus>('fanctrl', 'get_status'), null),
    swallow(api.call<FanOfficialStatus>('fan', 'get_status'), null),
  ])
  return { source: fc ? 'fanctrl' : 'fan', fanctrl: fc, official: off }
}

export const getFanOfficialConfig = () => api.call<FanOfficialConfig>('fan', 'get_config')

/** 写风扇策略（fanctrl.set_config：整包 config，字段范围与真机视图一致） */
export const saveFanctrlConfig = (cfg: FanctrlConfig) =>
  api.call<FanctrlStatus>('fanctrl', 'set_config', { ...cfg }, { timeout: TIMEOUT.check })

/** 手动转速（fanctrl.set_manual {percent, persist}；persist=true 时写入配置） */
export const setFanManual = (percent: number, persist = false) =>
  api.call<FanctrlStatus>('fanctrl', 'set_manual', { percent, persist }, { timeout: TIMEOUT.check })

/** 恢复 fanctrl 默认策略（fanctrl.restore_defaults，和插件页面的“恢复默认”一致） */
export const restoreFanctrlDefaults = () =>
  api.call<FanctrlStatus>('fanctrl', 'restore_defaults', {}, { timeout: TIMEOUT.check })

/** 插件增强温控（NUI 桥 enh.fan_get；含多传感器温度与 smart 曲线，只读展示） */
export interface EnhFan {
  rpm?: number
  temps?: { soc?: number; mcu?: number; eth?: number }
  mode?: string
  available?: boolean
  smart?: { min?: number; hyst?: number; source?: string; points?: { temp: number; speed: number }[] }
  percent?: number
  speed?: number
  pwm?: number
  [k: string]: unknown
}

export interface EnhAlertCfg {
  enabled?: boolean
  module_temp?: number
  soc_temp?: number
  interval?: number
  recover?: boolean
  sms?: boolean
  sms_number?: string
  webhook?: boolean
  webhook_url?: string
  webhook_method?: string
  webhook_body?: string
  app?: boolean
  [k: string]: unknown
}

export interface EnhOverview {
  ssh?: SshState
  fan?: EnhFan
  alert?: EnhAlertCfg
  alert_history?: Record<string, any>[]
  wifi?: Record<string, any>
}

/** 插件桥 enh.overview：ssh + fan(含多传感器) + alert 全量配置 + 提醒历史 */
export async function getEnhOverview(): Promise<EnhOverview | null> {
  try {
    return await nui.invoke<EnhOverview>('enh.overview', {})
  } catch {
    return null
  }
}

/* ========================================================================
 * 7. 固件升级（upgrade.*）
 * ===================================================================== */

export interface UpgradeConfig {
  upgrade_enable?: boolean
  prompt?: boolean
  [k: string]: unknown
}

export interface OnlineCheck {
  current_version?: string
  current_compile_time?: string
  current_type?: string
  new_version?: string
  new_version_date?: string
  release_note?: string
  release_note_cn?: string
  download_url?: string
  [k: string]: unknown
}

export interface LocalVerify {
  status?: number
  version?: string
  firmware_type?: string
  sha256?: string
  release_note?: string
  release_note_cn?: string
  [k: string]: unknown
}

export interface OnlineUpgradeStatus {
  status?: number
  progress?: number
  [k: string]: unknown
}

export const getUpgradeConfig = () => api.call<UpgradeConfig>('upgrade', 'get_config')
export const setUpgradeConfig = (p: UpgradeConfig) =>
  api.call('upgrade', 'set_config', { ...p }, { timeout: TIMEOUT.check })

/** 在线检查最新固件（只读，但会联网，官方默认 20s 超时不够，这里给 60s） */
export const checkFirmwareOnline = () =>
  api.call<OnlineCheck>('upgrade', 'check_firmware_online', {}, { timeout: TIMEOUT.check })

export const getOnlineUpgradeStatus = () =>
  api.call<OnlineUpgradeStatus[]>('upgrade', 'get_online_upgrade_status', {}, { timeout: TIMEOUT.check })

/** 在线升级（危险操作；页面必须二次确认，本机未执行过） */
export const upgradeOnline = (keepConfig = true) =>
  api.call('upgrade', 'upgrade_online', { keep_config: keepConfig }, { timeout: TIMEOUT.upgrade })

export const upgradeOnlineCancel = () => api.call('upgrade', 'upgrade_online_cancel', {})

/** 校验 /tmp/firmware.img（官方 LocalUpgrade 同款；须先 POST /upload） */
export const checkFirmwareLocal = () =>
  api.call<LocalVerify>('upgrade', 'check_firmware_local', {}, { timeout: TIMEOUT.upgrade })

/** 安装本地固件（危险操作；页面必须二次确认，本机未执行过） */
export const upgradeLocal = (keepConfig = true) =>
  api.call('upgrade', 'upgrade_local', { keep_config: keepConfig, keep_package: keepConfig }, { timeout: TIMEOUT.upgrade })

/** 本地固件校验状态码 → 中文（官方 upgrade 视图 verifyMsg 同款） */
export const UPGRADE_STATUS_TEXT: Record<number, string> = {
  0: '固件校验通过，可以升级',
  1: '固件版本比当前版本旧',
  2: '建议升级时不要保留设置',
  3: '未知固件版本',
  4: '固件文件过大',
  5: '未找到固件文件（请先上传）',
  6: 'sysupgrade 测试失败',
  7: '当前设备不支持该固件',
  8: '固件平台不匹配（不是本机固件）',
  9: '不是 GL.iNet 官方固件',
  10: '未知错误',
}

/** 上传固件到设备 /tmp/firmware.img（nginx 独立 location，非 RPC） */
export function uploadFirmware(file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const sid = sessionStorage.getItem('nui.sid') || ''
    if (!sid) return reject(new Error('会话已失效，请重新登录'))
    const fd = new FormData()
    // 顺序很重要：oui-upload.lua 边读边处理，sid/path/size 必须在 file 之前
    fd.append('sid', sid)
    fd.append('path', '/tmp/firmware.img')
    fd.append('size', String(file.size))
    fd.append('file', file, file.name || 'firmware.img')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/upload')
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      const hint =
        xhr.status === 401
          ? '未通过会话校验'
          : xhr.status === 403
            ? '上传路径不被允许'
            : xhr.status === 413
              ? '固件文件过大'
              : xhr.status === 507
                ? '设备存储空间不足'
                : `HTTP ${xhr.status}`
      reject(new Error(`上传失败：${hint}`))
    }
    xhr.onerror = () => reject(new Error('上传失败：网络错误'))
    xhr.ontimeout = () => reject(new Error('上传超时'))
    xhr.send(fd)
  })
}

/* ========================================================================
 * 8. 日志（logread.*）
 * ===================================================================== */

export type LogKind = 'system' | 'kernel' | 'crash' | 'nginx'

export interface LogResult {
  log?: string
  [k: string]: unknown
}

/** 读日志；系统日志默认只取最近 800 行（内核日志接口不带行数参数，返回全量 dmesg） */
export async function getLog(kind: LogKind, lines = 800): Promise<string> {
  if (kind === 'kernel') {
    const r = await api.call<LogResult>('logread', 'get_kernel_log', {}, { timeout: TIMEOUT.check })
    return String(r?.log ?? '')
  }
  if (kind === 'crash') {
    const r = await api.call<LogResult>('logread', 'get_crash_log', {}, { timeout: TIMEOUT.check })
    return String(r?.log ?? '')
  }
  if (kind === 'nginx') {
    const r = await api.call<LogResult>('logread', 'get_nginx_log', { type: 'error' }, { timeout: TIMEOUT.check })
    return String(r?.log ?? '')
  }
  const r = await api.call<LogResult>('logread', 'get_system_log', { lines }, { timeout: TIMEOUT.check })
  return String(r?.log ?? '')
}

/** 系统日志可选模块（对应官方日志页的模块下拉） */
export async function getLogModules(): Promise<string[]> {
  const r = await swallow(api.call<{ modules?: string[] }>('logread', 'get_module_name'), null)
  return Array.isArray(r?.modules) ? r!.modules : []
}

/** 导出日志：跑 export_logs 生成 /tmp/logread.tar，再经 /download 取回 */
export async function exportLogs(debugLogsEn = false): Promise<void> {
  await api.call('logread', 'export_logs', { debug_logs_en: debugLogsEn }, { timeout: TIMEOUT.upgrade })
  const blob = await downloadFile('/tmp/logread.tar')
  triggerBrowserDownload(blob, 'logread.tar')
}

/** POST /download（nginx 独立 location，官方日志导出同款）→ Blob */
export async function downloadFile(path: string): Promise<Blob> {
  const sid = sessionStorage.getItem('nui.sid') || ''
  if (!sid) throw new Error('会话已失效，请重新登录')
  const res = await fetch('/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ path, sid }).toString(),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`下载失败：HTTP ${res.status}${t ? `（${t.slice(0, 60)}）` : ''}`)
  }
  return res.blob()
}

/** 触发浏览器保存 Blob */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/* ========================================================================
 * 9. 重启 / 恢复出厂 / 配置备份
 * ===================================================================== */

/** 重启；delay 秒后执行（官方 home 视图用 {delay:1}） */
export const reboot = (delay = 1) => api.call('system', 'reboot', { delay }, { timeout: TIMEOUT.check })

/** 恢复出厂（官方 reset 页 system.reset_firmware({})；本固件没有「保留设置」参数） */
export const resetFirmware = () => api.call('system', 'reset_firmware', {}, { timeout: TIMEOUT.check })

/**
 * 配置备份：官方走 LuCI 的 cgi-io `/cgi-bin/cgi-backup`（内部 `sysupgrade --create-backup`）。
 * 该接口要求 LuCI 会话（ACL backup 权限），GL 的 /rpc sid 会被 403 拒绝 —— 真机实测，
 * 因此本面板提供「尝试导出 + 失败时给 LuCI 入口」的降级路径。
 */
export async function backupConfig(): Promise<Blob> {
  const sid = sessionStorage.getItem('nui.sid') || ''
  const res = await fetch('/cgi-bin/cgi-backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionid: sid }).toString(),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(res.status === 403 ? '当前会话无权导出配置（cgi-backup 需要 LuCI 会话）' : `导出失败：HTTP ${res.status}${t ? `（${t.slice(0, 60)}）` : ''}`)
  }
  return res.blob()
}

/* ========================================================================
 * 10. 高级设置（LuCI / 本地访问）
 * ===================================================================== */

export interface LuciStatus {
  /** {NOT_INSTALL:0, INSTALLING:1, INSTALLED:2, UNINSTALLING:3, DOWNLOAD_FAIL:4} */
  status?: number
}

export interface LocalAccess {
  ssh_enabled?: boolean
  ssh_port?: number
  http_port?: number
  https_port?: number
  luci_http_port?: number
  luci_https_port?: number
  redirect_https?: boolean
  luci_redirect_https?: boolean
  session_timeout?: number
  [k: string]: unknown
}

export const LUCI_STATUS_TEXT: Record<number, string> = {
  0: '未安装',
  1: '安装中',
  2: '已安装',
  3: '卸载中',
  4: '下载失败',
}

export const getLuciStatus = () => api.call<LuciStatus>('luci', 'get_status')
export const installLuci = () => api.call('luci', 'install_luci', {}, { timeout: TIMEOUT.repo })
export const uninstallLuci = () => api.call('luci', 'uninstall_luci', {}, { timeout: TIMEOUT.repo })
export const getLocalAccess = () => api.call<LocalAccess>('local-access', 'get_config')

/* ========================================================================
 * 11. 界面设置（本地 + 只读展示 NUI 配置）
 * ===================================================================== */

export interface OfficialLang {
  lang?: string
  list?: { value: string; label: string; id?: number }[]
}

/** 官方后台语言（只读展示；本面板仅中文） */
export const getOfficialLang = () => api.call<OfficialLang>('ui', 'get_lang')

export interface NuiUiConfig {
  version?: string
  theme?: string
  accent?: string
  is_default?: boolean
  skin?: { installed?: boolean; enabled?: boolean; active?: boolean }
  app_url?: string
  [k: string]: unknown
}

/** NUI 插件自己的界面配置（只读展示：不改它，避免影响 /nui/ 页面） */
export async function getNuiUiConfig(): Promise<NuiUiConfig | null> {
  try {
    return await nui.invoke<NuiUiConfig>('ui.config', {})
  } catch {
    return null
  }
}

/* ========================================================================
 * 12. 应用：插件 / 软件源（plugins.*）
 * ===================================================================== */

export interface PluginSource {
  name: string
  url: string
  system?: boolean
}

export interface PluginsConfig {
  source?: PluginSource[]
}

export interface RepoStatus {
  status?: number
  count_all?: number
  count_installed?: number
  count_not_installed?: number
  count_reserve?: number
  count_updatable?: number
  time_last_update?: number
  time_current?: number
}

export interface PluginPackage {
  name?: string
  version?: string
  /** 1 = 已安装（status=1 过滤已装包） */
  status?: number | string
  uninstallable?: boolean
  [k: string]: unknown
}

export interface PluginListResp {
  packages?: PluginPackage[]
  count_search?: number
  [k: string]: unknown
}

export const getPluginsConfig = () => api.call<PluginsConfig>('plugins', 'get_config')
export const getRepoStatus = () => api.call<RepoStatus>('plugins', 'get_repository_status', {}, { timeout: TIMEOUT.check })

/**
 * 已安装包列表。官方 get_list 需要带分页/状态参数（空参数返回 []）：
 *   {limit, page, status}  status: 1=已安装 0=未安装 2=可更新 3=保留
 */
export const getPluginList = (p: { limit?: number; page?: number; status?: number } = {}) =>
  api.call<PluginListResp>('plugins', 'get_list', { limit: p.limit ?? 200, page: p.page ?? 1, status: p.status ?? 1 }, { timeout: TIMEOUT.check })

/** 刷新软件源（opkg update；官方「刷新」按钮同款，耗时较长） */
export const updateRepository = () => api.call('plugins', 'update_repository', {}, { timeout: TIMEOUT.repo })

/* ========================================================================
 * 13. 应用：网络存储（nas-web / ksmbd —— 对象名按 software_feature.ksmbd 动态选择）
 * ===================================================================== */

export interface NasDiskPart {
  uid?: string
  disk_name?: string
  label?: string
  dev_name?: string
  fs_type?: string
  /** 单位：MB（真机返回 27552 对应 32GB U 盘） */
  total_len?: number
  free_size?: number
  [k: string]: unknown
}

export interface NasDisk {
  part?: NasDiskPart[]
  sd_card?: number
  part_num?: number
}

export interface NasDiskList {
  disk?: NasDisk[]
  disk_number?: number
}

export interface NasProto {
  name?: string
  enable?: number
  port?: number
  wan_access?: number
  [k: string]: unknown
}

export interface NasProtoResp {
  res?: NasProto[]
  [k: string]: unknown
}

/** NAS RPC 对象名：ksmbd=true 用 ksmbd，本机 false → nas-web */
let nasObj: string | null = null
export async function nasObject(): Promise<string> {
  if (nasObj) return nasObj
  const info = await swallow(api.call<SysInfo>('system', 'get_info'), null)
  nasObj = info?.software_feature?.ksmbd ? 'ksmbd' : 'nas-web'
  return nasObj
}

export async function getNasStatus(): Promise<{ enable?: number } | null> {
  const obj = await nasObject()
  return swallow(api.call<{ enable?: number }>(obj, 'get_status'), null)
}

export async function getNasWanAccess(): Promise<{ enable?: string } | null> {
  const obj = await nasObject()
  return swallow(api.call<{ enable?: string }>(obj, 'get_nas_wan_access'), null)
}

export async function getNasDiskList(): Promise<NasDiskList | null> {
  const obj = await nasObject()
  return swallow(api.call<NasDiskList>(obj, 'get_disk_list'), null)
}

/** 共享协议配置（NAS 服务未启动时官方会返回 code=1 Unknown，这里降级成 null） */
export async function getNasProtos(): Promise<NasProto[] | null> {
  const obj = await nasObject()
  try {
    const r = await api.call<NasProtoResp>(obj, 'get_proto_config', {}, { timeout: TIMEOUT.nas })
    return Array.isArray(r?.res) ? r.res : null
  } catch {
    return null
  }
}

/** 启动 NAS 服务（官方 nasview「启用」同款；会拉起 samba/webdav 等进程） */
export async function startNas(): Promise<void> {
  const obj = await nasObject()
  await api.call(obj, 'start', {}, { timeout: TIMEOUT.repo })
}

/* ========================================================================
 * 14. 应用：AdGuard Home（adguardhome.*）
 * ===================================================================== */

export interface AdguardConfig {
  enabled?: boolean
  dns_enabled?: boolean
}

export const getAdguard = () => api.call<AdguardConfig>('adguardhome', 'get_config')
export const setAdguard = (p: AdguardConfig) =>
  api.call('adguardhome', 'set_config', { enabled: !!p.enabled, dns_enabled: !!p.dns_enabled }, { timeout: TIMEOUT.check })


/* ========================================================================
 * 15. 默认后台（glass.root_mode_*）—— 路由器地址/原厂登录页是否进入增强 WebUI
 * ===================================================================== */
export interface RootMode {
  ok: boolean
  enabled: boolean
}
export const getRootMode = () => api.call<RootMode>('glass', 'root_mode_get')
export const setRootMode = (enabled: boolean) =>
  api.call<{ ok: boolean; enabled: boolean; err?: string }>('glass', 'root_mode_set', { enabled }, { timeout: TIMEOUT.check })
