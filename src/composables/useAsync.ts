import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { useUiStore } from '@/stores/ui'

export interface AsyncOptions<T> {
  /** 轮询间隔（毫秒），0/不传 = 不轮询 */
  interval?: number
  /** 挂载后立即加载，默认 true */
  immediate?: boolean
  /** 依赖变化时重新加载（例如 section 切换） */
  watchSource?: Ref<unknown>
  /** 加载成功后的转换 */
  transform?: (raw: T) => T
}

/**
 * 统一的「加载 + 轮询 + 错误兜底」组合式函数。
 *
 *   const { data, loading, error, reload } = useAsync(() => api.call('wifi', 'get_config'), { interval: 10000 })
 *
 * 约定：error 只记最近一次失败的简短消息；data 保留上一次成功值（避免页面闪烁）。
 */
export function useAsync<T>(loader: () => Promise<T>, opts: AsyncOptions<T> = {}) {
  const ui = useUiStore()
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref('')
  const lastAt = ref(0)
  const firstLoaded = ref(false)
  let timer: number | undefined
  let seq = 0
  let inflight = false

  async function reload(silent = false) {
    // 断网时单次加载可能变慢，避免定时器叠加出并发请求把后端/浏览器连接占满
    if (inflight) return
    inflight = true
    const my = ++seq
    if (!silent && !data.value) loading.value = true
    try {
      const raw = await loader()
      if (my !== seq) return
      data.value = opts.transform ? opts.transform(raw) : raw
      error.value = ''
      lastAt.value = Date.now()
    } catch (e) {
      if (my !== seq) return
      error.value = shortError(e)
    } finally {
      inflight = false
      if (my === seq) {
        loading.value = false
        firstLoaded.value = true
      }
    }
  }

  function start() {
    stop()
    // 轮询间隔统一由「界面设置 → 刷新频率」控制（全局生效）
    if (opts.interval && opts.interval > 0) {
      timer = window.setInterval(() => {
        if (document.hidden) return
        void reload(true)
      }, ui.refreshMs)
      watch(
        () => ui.refreshSec,
        () => start(),
      )
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  if (opts.immediate !== false) void reload()
  start()
  if (opts.watchSource) {
    watch(
      opts.watchSource,
      () => {
        data.value = null
        firstLoaded.value = false
        void reload()
      },
      { flush: 'post' },
    )
  }
  onBeforeUnmount(stop)

  return { data, loading, error, lastAt, firstLoaded, reload, stop, start }
}

/** RPC 错误 → 人话（GL 的 error 可能是对象） */
export function shortError(e: unknown): string {
  if (!e) return '未知错误'
  if (typeof e === 'string') return e
  const any = e as any
  const m = any?.rpc?.message ?? any?.message
  if (m) return String(m)
  try {
    return JSON.stringify(e).slice(0, 200)
  } catch {
    return String(e)
  }
}

/**
 * 轮询一个 promise 函数（无状态版），用于速率/曲线等轻量刷新。
 * 返回停止函数。
 */
export function usePolling(fn: () => void | Promise<void>, ms?: number): () => void {
  const ui = useUiStore()
  const t = window.setInterval(() => {
    if (document.hidden) return
    void fn()
  }, ms ?? ui.refreshMs)
  onBeforeUnmount(() => clearInterval(t))
  return () => clearInterval(t)
}
