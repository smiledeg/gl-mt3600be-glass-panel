import { api } from '@/api'

/**
 * NUI 插件后端桥客户端（设备侧 rpc 对象 `nui`，见 docs/nui-bridge.md）
 *
 *   await nui.invoke('cell.status', { bus: '1_1' })
 *
 * 桥的 RPC 形态：
 *   POST /rpc  {"method":"call","params":[sid,"nui","invoke",{method:"xxx",args:{...}}]}
 *   返回 {"ok":true,"data":...} 或 {"ok":false,"code":"...","error":"..."}
 */
export class NuiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'NuiError'
    this.code = code
  }
}

export interface NuiEnvelope<T = unknown> {
  ok: boolean
  data?: T
  code?: string
  error?: string
}

let methodsCache: { name: string; write?: boolean; module?: string }[] | null = null
/** 桥加载模块失败的信息（module -> error），页面可据此提示“插件后端缺失” */
export let nuiErrors: Record<string, string> = {}

export const nui = {
  /** 调插件后端方法；失败抛 NuiError（message 已是人话） */
  async invoke<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const env = await api.call<NuiEnvelope<T>>('nui', 'invoke', { method, args })
    if (env && typeof env === 'object' && 'ok' in env) {
      if (!env.ok) throw new NuiError(env.error || '插件后端调用失败', env.code)
      return env.data as T
    }
    // 兼容：某些方法直接返回 data
    return env as unknown as T
  },

  /** 方法清单（探测/文档用）；桥返回 {ok,data:{version,count,methods,errors}} */
  async methods(force = false): Promise<{ name: string; write?: boolean; module?: string }[]> {
    if (methodsCache && !force) return methodsCache
    const env = await api.call<any>('nui', 'methods', {})
    const d = env && typeof env === 'object' && 'ok' in env ? env.data : env
    const list: { name: string; write?: boolean; module?: string }[] = Array.isArray(d) ? d : Array.isArray(d?.methods) ? d.methods : []
    methodsCache = list
    nuiErrors = d?.errors ?? {}
    return list
  },

  /** 桥是否可用（没装或加载失败时为 false） */
  async available(): Promise<boolean> {
    try {
      await api.call('nui', 'methods', {})
      return true
    } catch {
      return false
    }
  },
}

/** 便捷：探测某方法是否可用（只调 methods，不真调） */
export async function hasNuiMethod(name: string): Promise<boolean> {
  try {
    const list = await nui.methods()
    return list.some((m) => m.name === name)
  } catch {
    return false
  }
}
