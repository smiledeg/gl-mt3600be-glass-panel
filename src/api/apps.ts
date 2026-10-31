import { api } from '@/api'

export interface AppService {
  script: string
  running: boolean
  enabled: boolean
}

export interface OpenClashInfo {
  enable: boolean
  en_mode: string
  proxy_mode: string
  cn_port: string
  http_port: string
  socks_port: string
  mixed_port: string
  proxy_port: string
  dns_port: string
  core_version: string
  dashboard_type: string
  dashboard_password: string
  config_present: boolean
}

export interface AppDetail {
  ok: boolean
  err?: string
  package: string
  short: string
  version: string
  arch: string
  size: string
  description: string
  status: string
  depends: string
  service: AppService
  core_present?: boolean
  core_downloading?: boolean
  log: string
  openclash?: OpenClashInfo
}

export const appDetail = (pkg: string) => api.call<AppDetail>('glass', 'app_detail', { package: pkg })

export const appAction = (pkg: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable') =>
  api.call<{ ok: boolean; err?: string; message?: string }>('glass', 'app_action', { package: pkg, action })

export const setOpenclash = (patch: Record<string, unknown>) =>
  api.call<{ ok: boolean; err?: string }>('glass', 'app_openclash_set', patch as Record<string, unknown>)
