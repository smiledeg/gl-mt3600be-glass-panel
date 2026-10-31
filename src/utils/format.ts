/** 展示层格式化工具（不依赖组件） */

export function fmtBytes(n: number | string | null | undefined, digits = 1): string {
  const num = typeof n === 'string' ? Number(n) : n
  const v = Number(num)
  if (!isFinite(v) || v < 0) return '—'
  if (v > 1e15) return '> 1 PB'
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  let x = v
  do {
    x /= 1024
    i++
  } while (x >= 1024 && i < units.length - 1)
  return `${x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(digits) : x.toFixed(2)} ${units[i]}`
}

export function fmtSpeed(bps: number | string | null | undefined): string {
  const v = Number(bps)
  if (!isFinite(v) || v < 0) return '—'
  if (v < 1024) return `${v.toFixed(0)} B/s`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`
  return `${(v / 1024 / 1024).toFixed(2)} MB/s`
}

/** 拆分数值与单位，便于界面用大号数字 + 小号单位 */
export function splitSpeed(bps: number | string | null | undefined): { value: string; unit: string } {
  const v = Number(bps)
  if (!isFinite(v) || v < 0) return { value: '—', unit: '' }
  if (v < 1024) return { value: v.toFixed(0), unit: 'B/s' }
  if (v < 1024 * 1024) return { value: (v / 1024).toFixed(1), unit: 'KB/s' }
  if (v < 1024 * 1024 * 1024) return { value: (v / 1024 / 1024).toFixed(2), unit: 'MB/s' }
  return { value: (v / 1024 / 1024 / 1024).toFixed(2), unit: 'GB/s' }
}

export function fmtDuration(sec: number | string | null | undefined): string {
  let s = typeof sec === 'string' ? parseInt(sec, 10) : Number(sec) || 0
  if (!isFinite(s) || s <= 0) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} 天 ${h} 小时`
  if (h) return `${h} 小时 ${m} 分`
  return `${m} 分`
}

export function fmtAgo(ts: number | null): string {
  if (!ts) return '—'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 5) return '刚刚'
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  return `${Math.floor(s / 3600)} 小时前`
}

export function pct(used: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)))
}

/** Wi-Fi 接入方式显示名 */
export function ifaceLabel(v?: string): string {
  const s = String(v || '')
  if (/^(cable|eth|lan|wired)$/i.test(s)) return '有线'
  if (/^5g$/i.test(s)) return '5 GHz'
  if (/^(2g|2\.4g)$/i.test(s)) return '2.4 GHz'
  if (/guest/i.test(s)) return '访客'
  return s || '—'
}

/** CPU 占用 → 语义色 */
export function loadLevel(v: number): 'ok' | 'warn' | 'err' {
  if (v >= 85) return 'err'
  if (v >= 65) return 'warn'
  return 'ok'
}


/** 安全的数值转换：字符串/NaN/负数一律归 0 */
export function num(v: unknown): number {
  const n = Number(v)
  return isFinite(n) && n > 0 ? n : 0
}

/** 累加（避免字符串拼接） */
export function sumBy<T>(list: T[], pick: (x: T) => unknown): number {
  return list.reduce((a, x) => a + num(pick(x)), 0)
}
