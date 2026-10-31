import { demoApi } from './mock'
import { rpcApi } from './rpc'
import type { DeviceApi } from './types'

/**
 * 演示开关：
 *   ?demo=1        强制演示数据（无真机也能看全部页面）
 *   VITE_DEMO=1    构建期打开
 * 默认走 GL 原厂 /rpc。
 */
const search = typeof location !== 'undefined' ? location.search : ''
// demo 参数可能写在 hash 里（#/overview?demo=1），两处都认
const hashQuery = typeof location !== 'undefined' ? location.hash.split('?')[1] ?? '' : ''
const wantsDemo =
  typeof location !== 'undefined' &&
  ([search, hashQuery].some((q) => new URLSearchParams(q).get('demo') === '1') ||
    import.meta.env.VITE_DEMO === '1')

export const api: DeviceApi = wantsDemo ? demoApi : rpcApi

export const isDemo = api.kind === 'demo'
export type { DeviceApi }
