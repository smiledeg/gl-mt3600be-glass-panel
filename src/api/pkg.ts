import { api } from '@/api'

export interface InstalledApp {
  package: string
  label: string
  version: string
  url: string
}

/** 分片上传 ipk 到 /tmp，返回 install id */
export async function uploadIpk(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const begin = await api.call<{ ok: boolean; err?: string }>('glass', 'pkg_upload_begin', { id })
  if (!begin?.ok) throw new Error(begin?.err || '无法创建上传文件')
  const chunk = 512 * 1024
  let sent = 0
  while (sent < file.size) {
    const buf = new Uint8Array(await file.slice(sent, sent + chunk).arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    const r = await api.call<{ ok: boolean; err?: string }>('glass', 'pkg_upload_chunk', { id, data: btoa(bin) })
    if (!r?.ok) throw new Error(r?.err || '上传中断')
    sent += buf.length
    onProgress?.(Math.min(99, Math.round((sent / file.size) * 100)))
  }
  const fin = await api.call<{ ok: boolean; err?: string }>('glass', 'pkg_upload_finish', { id })
  if (!fin?.ok) throw new Error(fin?.err || '保存安装包失败')
  onProgress?.(100)
  return id
}

export async function installIpk(id: string) {
  return api.call<{ ok: boolean; id?: string; log?: string; err?: string }>('glass', 'pkg_install', { id })
}

export async function pkgInstallStatus(id: string) {
  return api.call<{ id: string; log: string; done: boolean; code: number | null }>('glass', 'pkg_install_status', { id })
}

export async function pkgApps(): Promise<InstalledApp[]> {
  try {
    const r = await api.call<{ apps: InstalledApp[] }>('glass', 'pkg_apps')
    return Array.isArray(r?.apps) ? r.apps : []
  } catch {
    return []
  }
}


export type PkgManager = 'opkg' | 'apk'

export interface InstalledPkg {
  name: string
  version: string
}

/** 当前设备的包管理器：apk 或 opkg */
export async function pkgManager(): Promise<PkgManager> {
  try {
    const r = await api.call<{ manager?: string }>('glass', 'pkg_manager')
    return r?.manager === 'apk' ? 'apk' : 'opkg'
  } catch {
    return 'opkg'
  }
}

/** 已安装软件包（两种包管理器通用） */
export async function pkgList(): Promise<InstalledPkg[]> {
  try {
    const r = await api.call<{ packages?: InstalledPkg[] }>('glass', 'pkg_list')
    return Array.isArray(r?.packages) ? r.packages : []
  } catch {
    return []
  }
}
